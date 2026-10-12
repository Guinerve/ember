import { ffdi, ffdiCategory, headRateOfSpread } from "./ffdi";
import { hillshade } from "./hillshade";
import { computeSpread, type SpreadResult, type Terrain } from "./spread";

interface Meta { width: number; height: number; cellSizeM: number }

const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const canvas = $<HTMLCanvasElement>("#map");
const ctx = canvas.getContext("2d")!;
const BURNOUT_MIN = 45; // visual only: how long a cell glows before it is drawn as burnt

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg: number) => COMPASS[Math.round(deg / 22.5) % 16]!;

let terrain: Terrain;
let shade: Uint8ClampedArray;
let ignitions: { x: number; y: number }[] = [{ x: 150, y: 200 }];
let result: SpreadResult | null = null;
let playing = false;
let simT = 0; // float simulation clock; the slider only displays it (a step=1 range input rounds away small increments)
let lastFrame = 0;

async function loadTerrain(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const meta: Meta = await (await fetch(`${base}dem.json`)).json();
  const buf = await (await fetch(`${base}dem.bin`)).arrayBuffer();
  const raw = new Int16Array(buf);
  terrain = { width: meta.width, height: meta.height, cellSizeM: meta.cellSizeM, elevation: Float32Array.from(raw) };
  shade = hillshade(terrain);
}

const val = (id: string) => Number($<HTMLInputElement>(`#${id}`).value);

function readInputs() {
  const weather = { temp: val("temp"), humidity: val("humidity"), wind: val("wind"), drought: val("drought") };
  const windFrom = val("windFrom");
  const set = (k: string, t: string) => { document.querySelector(`output[data-for="${k}"]`)!.textContent = t; };
  set("temp", `${weather.temp} °C`); set("humidity", `${weather.humidity}%`); set("wind", `${weather.wind} km/h`);
  set("windFrom", `${compass(windFrom)} (${windFrom}°)`); set("drought", `${weather.drought}`); set("fuel", `${val("fuel")} t/ha`);
  return { weather, windToDeg: (windFrom + 180) % 360, fuel: val("fuel") };
}

function recompute(): void {
  const { weather, windToDeg, fuel } = readInputs();
  result = computeSpread({ terrain, weather, windToDeg, fuelLoadTha: fuel, ignitions });
  const f = ffdi(weather);
  $("#ffdi").innerHTML = `FFDI <b>${f.toFixed(0)}</b> · ${ffdiCategory(f)}<br><small>Head-fire spread on flat ground ${(headRateOfSpread(f, fuel)).toFixed(2)} km/h</small>`;
  draw();
}

function draw(): void {
  const { width: W, height: H, cellSizeM: cs } = terrain;
  const t = val("time");
  const img = new ImageData(new Uint8ClampedArray(shade), W, H);
  let burnt = 0;
  if (result) {
    const a = result.arrival;
    for (let i = 0; i < W * H; i++) {
      const at = a[i]!;
      if (at > t) continue;
      burnt++;
      const age = t - at;
      const p = i * 4;
      if (age < BURNOUT_MIN) {
        const k = 1 - age / BURNOUT_MIN;
        img.data[p] = 255; img.data[p + 1] = 60 + 150 * k * k; img.data[p + 2] = 10 + 30 * k; 
      } else {
        img.data[p] = img.data[p]! * 0.25 + 20; img.data[p + 1] = img.data[p + 1]! * 0.2 + 12; img.data[p + 2] = img.data[p + 2]! * 0.2 + 10;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const ig of ignitions) { ctx.fillStyle = "#fff"; ctx.fillRect(ig.x - 2, ig.y - 2, 5, 5); }
  drawWind();
  const h = Math.floor(t / 60), m = Math.round(t % 60);
  $("#timeOut").textContent = `${h} h ${String(m).padStart(2, "0")} min`;
  const ha = (burnt * cs * cs) / 10000;
  canvas.setAttribute("aria-label", `Fire map: ${burnt} cells burnt (${((burnt * cs * cs) / 10000).toFixed(0)} hectares) after ${Math.round(t)} minutes, ${ignitions.length} ignition point(s)`);
  $("#stats").innerHTML = `<span>Area burnt <b>${ha.toFixed(0)} ha</b></span><span>Ignitions <b>${ignitions.length}</b></span>`;
}

function drawWind(): void {
  const to = (((val("windFrom") + 180) % 360) * Math.PI) / 180;
  const cx = 44, cy = 44, r = 24;
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = "#000a"; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
  ctx.rotate(to); ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, r); ctx.lineTo(0, -r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -r - 6); ctx.lineTo(-8, -r + 8); ctx.lineTo(8, -r + 8); ctx.fill();
  ctx.restore();
}

function tick(now: number): void {
  if (playing) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    const slider = $<HTMLInputElement>("#time");
    simT += dt * 40; // 40 simulated minutes per second
    if (simT >= Number(slider.max)) { simT = Number(slider.max); playing = false; $("#play").textContent = "▶ Play"; }
    slider.value = String(Math.round(simT));
    draw();
  }
  lastFrame = now;
  requestAnimationFrame(tick);
}

let pending = false;
const schedule = () => { if (pending || !terrain) return; pending = true; requestAnimationFrame(() => { pending = false; recompute(); }); };

canvas.addEventListener("click", (e) => {
  if (!terrain) return;
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * terrain.width);
  const y = Math.floor(((e.clientY - r.top) / r.height) * terrain.height);
  ignitions.push({ x, y });
  recompute();
});
$("#ignite-btn").addEventListener("click", () => {
  if (!terrain) return;
  ignitions.push({ x: Math.min(terrain.width - 1, Math.max(0, val("ix"))), y: Math.min(terrain.height - 1, Math.max(0, val("iy"))) });
  recompute();
});
$("#clear").addEventListener("click", () => { ignitions = []; recompute(); });
$("#play").addEventListener("click", () => {
  if (simT >= 360) { simT = 0; $<HTMLInputElement>("#time").value = "0"; }
  playing = !playing; $("#play").textContent = playing ? "⏸ Pause" : "▶ Play";
});
$("#time").addEventListener("input", () => { simT = val("time"); draw(); });
["temp", "humidity", "wind", "windFrom", "drought", "fuel"].forEach((id) => $(`#${id}`).addEventListener("input", schedule));

loadTerrain().then(() => { recompute(); requestAnimationFrame(tick); });
