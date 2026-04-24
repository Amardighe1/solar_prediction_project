const resultEl = document.getElementById("result");
const liveStatusEl = document.getElementById("liveStatus");

const inputIds = [
  "datetime_iso",
  "dc_power",
  "ambient_temperature",
  "module_temperature",
  "irradiation",
  "wind_speed_10m"
];

function getLocalDateTimeValue() {
  const raw = document.getElementById("datetime_iso").value;
  if (!raw) return new Date().toISOString().slice(0, 19);
  // Keep local wall-clock time stable (avoid UTC shift from toISOString()).
  return raw.length === 16 ? `${raw}:00` : raw;
}

function clampNumber(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function payloadFromInputs() {
  const irradiation = clampNumber(Number(document.getElementById("irradiation").value), 0, 1.2);
  const wind = clampNumber(Number(document.getElementById("wind_speed_10m").value), 0, 60);
  const ambient = clampNumber(Number(document.getElementById("ambient_temperature").value), -20, 70);
  const module = clampNumber(Number(document.getElementById("module_temperature").value), -20, 90);
  let dcPower = clampNumber(Number(document.getElementById("dc_power").value), 0, 40000);
  if (irradiation <= 0.01) dcPower = 0;

  return {
    datetime_iso: getLocalDateTimeValue(),
    dc_power: dcPower,
    ambient_temperature: ambient,
    module_temperature: module,
    irradiation: irradiation,
    wind_speed_10m: wind
  };
}

async function predict() {
  try {
    resultEl.textContent = "Predicting...";
    const res = await fetch("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFromInputs())
    });
    if (!res.ok) {
      const txt = await res.text();
      resultEl.textContent = `Prediction failed (${res.status}): ${txt}`;
      return;
    }
    const data = await res.json();
    resultEl.textContent = `Predicted AC Power: ${data.predicted_ac_power_kw} kW`;
  } catch (err) {
    resultEl.textContent = `Prediction error: ${err.message}. Is API running?`;
  }
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

async function autofillFromLocation(lat, lon) {
  try {
    liveStatusEl.textContent = "Fetching live weather for your location...";
    const res = await fetch(`/live-context?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    if (!res.ok) {
      liveStatusEl.textContent = `Live weather failed (${res.status}). You can still enter values manually.`;
      return;
    }
    const data = await res.json();
    setInputValue("datetime_iso", String(data.datetime_iso).slice(0, 16));
    setInputValue("dc_power", data.dc_power);
    setInputValue("ambient_temperature", data.ambient_temperature);
    setInputValue("module_temperature", data.module_temperature);
    setInputValue("irradiation", data.irradiation);
    setInputValue("wind_speed_10m", data.wind_speed_10m);
    liveStatusEl.textContent = `Live weather applied from ${data.source} at ${data.provider_time_local} (cloud ${data.cloud_cover}%).`;
    await predict();
  } catch (err) {
    liveStatusEl.textContent = `Live weather error: ${err.message}`;
  }
}

async function useLiveWeather() {
  if (!navigator.geolocation) {
    liveStatusEl.textContent = "Geolocation unavailable. Falling back to Pune.";
    await autofillFromLocation(18.5204, 73.8567);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      await autofillFromLocation(pos.coords.latitude, pos.coords.longitude);
    },
    async () => {
      liveStatusEl.textContent = "Location denied. Falling back to Pune.";
      await autofillFromLocation(18.5204, 73.8567);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
  );
}

document.getElementById("predictBtn").addEventListener("click", predict);
document.getElementById("liveBtn").addEventListener("click", useLiveWeather);

for (const id of inputIds) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("change", () => {
      liveStatusEl.textContent = "Using user-edited values.";
    });
  }
}

const now = new Date();
const tzOffsetMs = now.getTimezoneOffset() * 60000;
document.getElementById("datetime_iso").value = new Date(now.getTime() - tzOffsetMs)
  .toISOString()
  .slice(0, 16);
fetch("/health")
  .then(r => r.json())
  .then(d => {
    resultEl.textContent = `API connected. Model: ${d.model}. Click Predict Now.`;
  })
  .catch(() => {
    resultEl.textContent = "API not reachable. Start server with: uvicorn api.app:app --reload";
  });
useLiveWeather();

