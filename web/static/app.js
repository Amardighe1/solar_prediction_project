const resultEl = document.getElementById("result");
const curveInfoEl = document.getElementById("curveInfo");
const canvas = document.getElementById("windCanvas");
const ctx = canvas.getContext("2d");

const particles = Array.from({ length: 120 }, () => ({
  x: Math.random() * canvas.width,
  y: Math.random() * canvas.height,
  vx: 0.4 + Math.random() * 0.7,
  size: 1 + Math.random() * 2
}));

function payloadFromInputs() {
  return {
    datetime_iso: new Date(document.getElementById("datetime_iso").value || Date.now()).toISOString(),
    dc_power: Number(document.getElementById("dc_power").value),
    ambient_temperature: Number(document.getElementById("ambient_temperature").value),
    module_temperature: Number(document.getElementById("module_temperature").value),
    irradiation: Number(document.getElementById("irradiation").value),
    wind_speed_10m: Number(document.getElementById("wind_speed_10m").value)
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

let curve = [];
async function simulateWind() {
  try {
    curveInfoEl.textContent = "Running wind simulation...";
    const res = await fetch("/simulate-wind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFromInputs())
    });
    if (!res.ok) {
      const txt = await res.text();
      curveInfoEl.textContent = `Simulation failed (${res.status}): ${txt}`;
      return;
    }
    const data = await res.json();
    curve = data.curve || [];
    if (curve.length) {
      const minY = Math.min(...curve.map(p => p.predicted_kw));
      const maxY = Math.max(...curve.map(p => p.predicted_kw));
      curveInfoEl.textContent = `Wind sweep simulated. Predicted range: ${minY.toFixed(2)} to ${maxY.toFixed(2)} kW`;
    }
  } catch (err) {
    curveInfoEl.textContent = `Simulation error: ${err.message}. Is API running?`;
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const wind = Number(document.getElementById("wind_speed_10m").value || 0);
  const speedFactor = 0.5 + wind / 8;

  for (const p of particles) {
    p.x += p.vx * speedFactor;
    if (p.x > canvas.width + 10) p.x = -10;
    ctx.beginPath();
    ctx.fillStyle = "rgba(110, 220, 255, 0.8)";
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  if (curve.length > 1) {
    const pad = 28;
    const xs = curve.map((_, i) => pad + (i / (curve.length - 1)) * (canvas.width - 2 * pad));
    const ysRaw = curve.map(p => p.predicted_kw);
    const yMin = Math.min(...ysRaw);
    const yMax = Math.max(...ysRaw);
    const ys = ysRaw.map(v => canvas.height - pad - ((v - yMin) / ((yMax - yMin) || 1)) * (canvas.height - 2 * pad));

    ctx.beginPath();
    ctx.strokeStyle = "#34f5c5";
    ctx.lineWidth = 2.4;
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.stroke();
  }
  requestAnimationFrame(draw);
}

document.getElementById("predictBtn").addEventListener("click", predict);
document.getElementById("simulateBtn").addEventListener("click", simulateWind);

document.getElementById("datetime_iso").value = new Date().toISOString().slice(0, 16);
fetch("/health")
  .then(r => r.json())
  .then(d => {
    resultEl.textContent = `API connected. Model: ${d.model}. Click Predict Now.`;
  })
  .catch(() => {
    resultEl.textContent = "API not reachable. Start server with: uvicorn api.app:app --reload";
  });
draw();

