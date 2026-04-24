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

if (isEmbed) document.body.classList.add("embed");

let t = 0;
let lastPred = 9000;
let lag1 = 9000;
let lag2 = 8900;
let lag3 = 8800;
let lastIrr = 0.62;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
  t += 0.035;
  const sunlight = clamp(68 + 22 * Math.sin(t * 0.23), 30, 95);
  const cloudPos = 190 + 430 * ((Math.sin(t * 0.8) + 1) / 2);
  const sunCenter = 128;
  const overlap = clamp(1 - Math.abs(cloudPos - sunCenter) / 210, 0, 1);
  const cloudCover = clamp(15 + overlap * 75 + 10 * (Math.sin(t * 1.4) + 1) / 2, 5, 95);
  const wind = clamp(2.2 + 1.6 * Math.sin(t * 0.65) + 1.1 * Math.sin(t * 1.3), 0.4, 12);
  const effectiveSun = Math.max(0, sunlight * (1 - cloudCover / 100));
  const irradiation = clamp(effectiveSun / 100 * 1.05, 0, 1.2);
  const ambientTemperature = clamp(24 + 7 * (sunlight / 100) - 1.2 * (cloudCover / 100), 18, 42);
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
  predText.textContent = `${predictedKw.toFixed(2)} kW`;
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
    msgText.textContent = "Clouds cover the sun, reducing irradiance and ML-predicted output.";
  } else {
    sun.classList.remove("sun-dim");
    msgText.textContent = "Clear sunlight increases irradiance and ML-predicted output.";
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
  const res = await fetch("/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.predicted_ac_power_kw;
}

async function tick() {
  const state = isEmbed ? buildStateAuto() : buildStateManual();
  try {
    const pred = await fetchPrediction(state);
    lastPred = pred;
    lag3 = lag2;
    lag2 = lag1;
    lag1 = pred;
    lastIrr = state.irradiation;
  } catch (_e) {}
  renderState(state, lastPred);
}

if (!isEmbed) {
  [sunlightInput, cloudInput, windInput].forEach((el) => el.addEventListener("input", tick));
}

setInterval(tick, isEmbed ? 1200 : 1800);
tick();

