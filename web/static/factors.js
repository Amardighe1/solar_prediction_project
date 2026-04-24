const sunlightInput = document.getElementById("sunlight");
const cloudInput = document.getElementById("cloudCover");
const windInput = document.getElementById("wind");
const sunlightLabel = document.getElementById("sunlightLabel");
const cloudLabel = document.getElementById("cloudLabel");
const windLabel = document.getElementById("windLabel");
const irrText = document.getElementById("irrText");
const genText = document.getElementById("genText");
const msgText = document.getElementById("msgText");
const irrBar = document.getElementById("irrBar");
const genBar = document.getElementById("genBar");
const sun = document.getElementById("sun");
const cloud = document.getElementById("cloud");
const ambText = document.getElementById("ambText");
const modText = document.getElementById("modText");
const predText = document.getElementById("predText");
const isEmbed = new URLSearchParams(window.location.search).get("embed") === "1";
const DEFAULT_API_BASE = (window.API_BASE_URL || "").replace(/\/$/, "");
let API_BASE_URL = "";

if (isEmbed) document.body.classList.add("embed");

let t = 0;
let lastPred = 9000;
let lag1 = 9000;
let lag2 = 8900;
let lag3 = 8800;
let lastIrr = 0.62;
let frameCount = 0;
let usingLiveModel = false;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function resolveApiBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryApi = (params.get("api") || "").trim();
  const storedApi = (localStorage.getItem("solar_api_base_url") || "").trim();
  API_BASE_URL = (queryApi || storedApi || DEFAULT_API_BASE || "").replace(/\/$/, "");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function estimatedKwFallback(state) {
  // Physical fallback estimation for stable UX when backend/tunnel is unavailable.
  const efficiencyFactor = 1 - 0.03 * (state.wind / 12);
  return clamp(state.irradiation * 13000 * efficiencyFactor, 0, 30000);
}

function buildStateManual() {
  const sunlight = Number(sunlightInput.value);
  const cloudCover = Number(cloudInput.value);
  const wind = Number(windInput.value);
  const effectiveSun = Math.max(0, sunlight * (1 - cloudCover / 100));
  const irradiation = clamp(effectiveSun / 100 * 1.05, 0, 1.2);
  const ambientTemperature = clamp(22 + 0.10 * sunlight - 0.02 * cloudCover, 18, 42);
  const moduleTemperature = clamp(ambientTemperature + 4 + 0.09 * effectiveSun - 0.08 * wind, 20, 65);
  return { sunlight, cloudCover, wind, irradiation, ambientTemperature, moduleTemperature };
}

function buildStateAuto() {
  t += 0.22;
  // Deterministic cloud pass over a fixed sun for physically consistent demo behavior.
  const sceneWidth = 820;
  const cloudSpan = 220;
  const travel = sceneWidth + cloudSpan * 2;
  const phase = (t * 0.02) % 1;
  const cloudPos = -cloudSpan + phase * travel;
  const sunCenter = 128;

  // Overlap factor: 0 means cloud away from sun, 1 means cloud centered on sun.
  const overlap = clamp(1 - Math.abs(cloudPos - sunCenter) / 170, 0, 1);

  // Clear-sky irradiance baseline drifts slowly (day variability), then cloud overlap attenuates it.
  const clearSkySunlight = clamp(84 + 8 * Math.sin(t * 0.18), 70, 95);
  const sunlight = clamp(clearSkySunlight * (1 - 0.88 * overlap), 5, 100);
  const cloudCover = clamp(overlap * 100, 0, 100);
  const wind = clamp(2.2 + 1.4 * Math.sin(t * 0.65) + 1.0 * Math.sin(t * 1.3), 0.4, 12);

  const irradiation = clamp((sunlight / 100) * 1.05, 0, 1.2);
  const ambientTemperature = clamp(24 + 7 * (clearSkySunlight / 100) - 2.4 * overlap, 18, 42);
  const effectiveSun = sunlight;
  const moduleTemperature = clamp(ambientTemperature + 5 + 0.1 * effectiveSun - 0.08 * wind, 20, 65);
  return { sunlight, cloudCover, wind, irradiation, ambientTemperature, moduleTemperature, cloudPos };
}

function renderState(s, predictedKw) {
  sunlightLabel.textContent = `${s.sunlight.toFixed(0)}%`;
  cloudLabel.textContent = `${s.cloudCover.toFixed(0)}%`;
  windLabel.textContent = s.wind.toFixed(1);
  ambText.textContent = `${s.ambientTemperature.toFixed(1)} C`;
  modText.textContent = `${s.moduleTemperature.toFixed(1)} C`;
  irrText.textContent = s.irradiation.toFixed(3);
  genText.textContent = `${predictedKw.toFixed(0)} kW`;
  predText.textContent = `${predictedKw.toFixed(2)} kW ${usingLiveModel ? "(Live Model)" : "(Estimated Fallback)"}`;
  irrBar.style.width = `${Math.min(100, s.irradiation * 100)}%`;
  genBar.style.width = `${Math.min(100, predictedKw / 140)}%`;

  sun.style.left = "80px";
  sun.style.top = "40px";
  if (isEmbed && s.cloudPos !== undefined) cloud.style.left = `${s.cloudPos}px`;
  else cloud.style.left = `${320 - s.cloudCover * 2.1}px`;
  cloud.style.opacity = `${0.1 + s.cloudCover / 105}`;
  cloud.style.transform = `scale(${0.9 + s.cloudCover / 260})`;

  if (s.cloudCover > 60 || s.sunlight < 35) {
    sun.classList.add("sun-dim");
    msgText.textContent = usingLiveModel
      ? "Clouds cover the sun, reducing irradiance and live model output."
      : "Clouds cover the sun. Backend offline, using fallback estimation.";
  } else {
    sun.classList.remove("sun-dim");
    msgText.textContent = usingLiveModel
      ? "Clear sunlight increases irradiance and live model output."
      : "Clear sunlight increases irradiance. Backend offline, using fallback estimation.";
  }
}

async function fetchPrediction(s) {
  const payload = {
    datetime_iso: new Date().toISOString(),
    dc_power: Math.max(0, 1500 + s.irradiation * 11500),
    ambient_temperature: s.ambientTemperature,
    module_temperature: s.moduleTemperature,
    irradiation: s.irradiation,
    wind_speed_10m: s.wind,
    ac_power_lag_1: lag1,
    ac_power_lag_2: lag2,
    ac_power_lag_3: lag3,
    irrad_lag_1: lastIrr
  };
  const res = await fetchWithTimeout(apiUrl("/predict"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, 4500);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.predicted_ac_power_kw;
}

async function tick() {
  const state = isEmbed ? buildStateAuto() : buildStateManual();
  frameCount += 1;
  const shouldPredict = !isEmbed || frameCount % 10 === 0;
  if (shouldPredict) {
    try {
      const pred = await fetchPrediction(state);
      lastPred = pred;
      usingLiveModel = true;
      lag3 = lag2;
      lag2 = lag1;
      lag1 = pred;
      lastIrr = state.irradiation;
    } catch (_e) {
      usingLiveModel = false;
      lastPred = estimatedKwFallback(state);
      lag3 = lag2;
      lag2 = lag1;
      lag1 = lastPred;
      lastIrr = state.irradiation;
    }
  } else if (!usingLiveModel) {
    // Keep fallback dynamic even between request intervals.
    lastPred = estimatedKwFallback(state);
  }
  renderState(state, lastPred);
}

resolveApiBaseUrl();
if (!isEmbed) {
  [sunlightInput, cloudInput, windInput].forEach((el) => el.addEventListener("input", tick));
}

setInterval(tick, isEmbed ? 120 : 1800);
tick();

