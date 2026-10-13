import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ffdi, ffdiCategory, headRateOfSpread, lengthToBreadth } from "../ffdi";
import { hillshade } from "../hillshade";
import { KILMORE_EAST } from "../reference";
import type { SpreadInput, SpreadResult } from "../spread";
import { loadTerrain } from "../terrain";
import { $, fmt, reducedMotion, segmented, setSlider, whenVisible } from "../ui/dom";
import { LineChart } from "../ui/chart";
import { equation, equationLive } from "../ui/tex";

const BURNOUT_MIN = 45; // visual only: how long a cell glows before it is drawn as burnt
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (d: number) => COMPASS[Math.round(d / 22.5) % 16]!;
const EXAGGERATION = 1.6;

export async function initLandscape(): Promise<void> {
  const canvas = $<HTMLCanvasElement>("#map");
  const ctx = canvas.getContext("2d")!;
  const val = (id: string) => Number((document.getElementById(id) as HTMLInputElement).value);

  const base = import.meta.env.BASE_URL;
  const { meta, terrain } = await loadTerrain(base);
  const shade = hillshade(terrain);
  const { width: W, height: H, cellSizeM: cs } = terrain;

  // the fire image without overlays; it also textures the 3D terrain
  const image = document.createElement("canvas");
  image.width = W; image.height = H;
  const imgCtx = image.getContext("2d")!;

  let ignitions: { x: number; y: number }[] = [{ x: 150, y: 200 }];
  let result: SpreadResult | null = null;
  let playing = false, simT = val("time"), lastFrame = 0;

  // ---- spread in a worker ----------------------------------------------------------------------
  const worker = new Worker(new URL("../spread.worker.ts", import.meta.url), { type: "module" });
  let reqId = 0, inFlight = false, queued: SpreadInput | null = null, workerFailed = false;
  const busy = $("#map-busy");
  const failWorker = (message: string) => {
    workerFailed = true; inFlight = false; queued = null; result = null;
    worker.terminate();
    busy.textContent = `Could not compute spread: ${message}. Reload the page to retry.`;
    busy.hidden = false;
    draw();
  };
  worker.onerror = (event) => failWorker(event.message || "the worker stopped");
  worker.onmessageerror = () => failWorker("the worker returned unreadable data");
  const solve = (input: SpreadInput) => {
    if (workerFailed) return;
    if (inFlight) { queued = input; return; }
    inFlight = true;
    busy.hidden = false;
    worker.postMessage({ id: ++reqId, input });
  };
  worker.onmessage = (e: MessageEvent<{ id: number; result: SpreadResult }>) => {
    inFlight = false;
    if (queued) { const q = queued; queued = null; solve(q); return; }
    result = e.data.result;
    busy.hidden = true;
    draw();
  };

  function readInputs() {
    const weather = { temp: val("temp"), humidity: val("humidity"), wind: val("wind"), drought: val("drought") };
    const windFrom = val("windFrom"), fuel = val("fuel");
    const set = (k: string, t: string) => { document.querySelector(`output[data-for="${k}"]`)!.textContent = t; };
    set("temp", `${weather.temp} °C`); set("humidity", `${weather.humidity}%`); set("wind", `${weather.wind} km/h`);
    set("windFrom", `${compass(windFrom)} (${windFrom}°)`); set("drought", `${weather.drought}`); set("fuel", `${fuel} t/ha`);
    return { weather, windFrom, windToDeg: (windFrom + 180) % 360, fuel };
  }

  function recompute(): void {
    const { weather, windFrom, windToDeg, fuel } = readInputs();
    solve({ terrain, weather, windToDeg, fuelLoadTha: fuel, ignitions });
    const f = ffdi(weather);
    const ros = headRateOfSpread(f, fuel);
    const lb = lengthToBreadth(weather.wind);
    $("#ffdi").innerHTML = `<span class="num">${fmt(f, 0)}</span><span><span class="cat">FFDI, ${ffdiCategory(f)}</span><br><span class="sub">Head fire on flat ground ${fmt(ros, 2)} km/h (${fmt((ros * 1000) / 60, 0)} m/min)</span></span>`;
    $("#assumptions").innerHTML = [
      ["Terrain", `SRTM-derived ${fmt(cs, 0)} m grid (${meta.source.split(",")[0]}), ${fmt(meta.minElevation, 0)}–${fmt(meta.maxElevation, 0)} m, ${fmt((W * cs) / 1000, 1)} km square west of Canberra. Slope doubles spread per 10° uphill, capped at 20°.`],
      ["Fuel", `Dry eucalypt forest with ${fuel} t/ha of fine fuel everywhere, continuous, with no breaks, roads or clearings.`],
      ["Weather", `${weather.temp} °C, ${weather.humidity}% humidity, ${weather.wind} km/h wind from the ${compass(windFrom)}, drought factor ${weather.drought}. Held constant for 6 hours; wind is not bent by terrain.`],
      ["Model", `McArthur Mk5 head-fire rate, ellipse length-to-breadth ${fmt(lb, 1)} (FBP Eq. 79). No spotting. Mk5 tends to under-predict wildfire spread by 2 to 3 times.`],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    equationLive($("#eq-ffdi"), `= ${fmt(f, 1)} (${ffdiCategory(f)})`);
    equationLive($("#eq-lb"), `U = ${weather.wind} km/h → L/B = ${fmt(lb, 2)}`);
    draw();
  }

  function paint(t: number): number {
    const img = new ImageData(new Uint8ClampedArray(shade), W, H);
    let burnt = 0;
    if (result) {
      const a = result.arrival;
      for (let i = 0; i < W * H; i++) {
        const at = a[i]!;
        if (at > t) continue;
        burnt++;
        const age = t - at, p = i * 4;
        if (age < BURNOUT_MIN) {
          const k = 1 - age / BURNOUT_MIN;
          img.data[p] = 255; img.data[p + 1] = 62 + 150 * k * k; img.data[p + 2] = 10 + 40 * k;
        } else {
          img.data[p] = img.data[p]! * 0.25 + 20; img.data[p + 1] = img.data[p + 1]! * 0.2 + 12; img.data[p + 2] = img.data[p + 2]! * 0.2 + 10;
        }
      }
    }
    imgCtx.putImageData(img, 0, 0);
    return burnt;
  }

  function draw(): void {
    const t = val("time");
    const burnt = paint(t);
    ctx.drawImage(image, 0, 0);
    for (const ig of ignitions) { ctx.fillStyle = "#fff"; ctx.fillRect(ig.x - 2, ig.y - 2, 5, 5); }
    drawWind();
    const h = Math.floor(t / 60), m = Math.round(t % 60);
    $("#timeOut").textContent = `${h} h ${String(m).padStart(2, "0")} min`;
    const ha = (burnt * cs * cs) / 10000;
    canvas.setAttribute("aria-label", `Fire map: ${fmt(ha, 0)} hectares burnt after ${Math.round(t)} minutes from ${ignitions.length} ignition point(s)`);
    $("#stats").innerHTML = `<span>Area burnt <b>${fmt(ha, 0)} ha</b></span><span>Ignitions <b>${ignitions.length}</b></span><span>Elapsed <b>${h} h ${String(m).padStart(2, "0")}</b></span>`;
    if (terrainTex) { terrainTex.needsUpdate = true; terrainDirty = true; }
  }

  function drawWind(): void {
    const to = (((val("windFrom") + 180) % 360) * Math.PI) / 180;
    ctx.save(); ctx.translate(40, 40);
    ctx.fillStyle = "rgb(15 19 17 / .7)"; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.fill();
    ctx.rotate(to); ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 18); ctx.lineTo(0, -18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(-7, -12); ctx.lineTo(7, -12); ctx.fill();
    ctx.restore();
  }

  // ---- 3D terrain ---------------------------------------------------------------------------------
  const glHost = $("#terrain-gl");
  let renderer: THREE.WebGLRenderer | null = null, camera: THREE.PerspectiveCamera, scene: THREE.Scene, controls: OrbitControls;
  let terrainTex: THREE.CanvasTexture | null = null, terrainMesh: THREE.Mesh;
  let terrainDirty = true, show3d = false, visible = false;

  function build3d(): void {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x0f1311);
    glHost.append(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    camera.position.set(-6, 14, 22);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reducedMotion();
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.addEventListener("change", () => { terrainDirty = true; });
    const size = (W * cs) / 1000;
    const geo = new THREE.PlaneGeometry(size, size, W - 1, H - 1);
    const pos = geo.attributes.position!;
    const zMid = (meta.minElevation + meta.maxElevation) / 2;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, ((terrain.elevation[i]! - zMid) / 1000) * EXAGGERATION);
    geo.computeVertexNormals();
    terrainTex = new THREE.CanvasTexture(image);
    terrainTex.colorSpace = THREE.SRGBColorSpace;
    terrainTex.anisotropy = 8;
    terrainMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: terrainTex }));
    terrainMesh.rotation.x = -Math.PI / 2;
    scene.add(terrainMesh);
    // north marker
    const north = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-size / 2 - 0.6, 0.8, -size / 2 + 2.5), 2.2, 0xdfe5de, 0.5, 0.35);
    scene.add(north);
    const ro = new ResizeObserver(() => {
      const w = glHost.clientWidth, h = glHost.clientHeight;
      if (!renderer || w === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix(); terrainDirty = true;
    });
    ro.observe(glHost);
    // click to ignite in 3D
    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || !renderer) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObject(terrainMesh)[0];
      if (!hit?.uv) return;
      ignitions.push({ x: Math.floor(hit.uv.x * W), y: Math.floor((1 - hit.uv.y) * H) });
      recompute();
    });
  }

  const loop = () => {
    if (show3d && visible && renderer) {
      controls.update();
      if (terrainDirty) { renderer.render(scene, camera); terrainDirty = false; }
    }
    requestAnimationFrame(loop);
  };

  segmented($(".map-tools .seg"), "view", (v) => {
    show3d = v === "3d";
    if (show3d && !renderer) {
      try { build3d(); } catch { glHost.textContent = "3D view needs WebGL, which this browser has turned off."; }
    }
    glHost.hidden = !show3d;
    terrainDirty = true;
  });
  whenVisible($(".map-stack"), (v) => { visible = v; });

  // ---- time + inputs ------------------------------------------------------------------------------
  const tick = (now: number) => {
    if (playing) {
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      const slider = $<HTMLInputElement>("#time");
      simT += dt * 40; // 40 simulated minutes per second
      if (simT >= Number(slider.max)) { simT = Number(slider.max); playing = false; $("#play").textContent = "Play"; }
      slider.value = String(Math.round(simT));
      draw();
    }
    lastFrame = now;
    requestAnimationFrame(tick);
  };

  let pending = false;
  const schedule = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; recompute(); }); };

  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect();
    ignitions.push({ x: Math.floor(((e.clientX - r.left) / r.width) * W), y: Math.floor(((e.clientY - r.top) / r.height) * H) });
    recompute();
  });
  $("#ignite-btn").addEventListener("click", () => {
    const x = val("ix"), y = val("iy");
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ignitions.push({ x: Math.min(W - 1, Math.max(0, Math.round(x))), y: Math.min(H - 1, Math.max(0, Math.round(y))) });
    recompute();
  });
  $("#clear").addEventListener("click", () => { ignitions = []; recompute(); });
  $("#play").addEventListener("click", () => {
    if (simT >= 360) { simT = 0; $<HTMLInputElement>("#time").value = "0"; }
    playing = !playing; $("#play").textContent = playing ? "Pause" : "Play";
  });
  $("#time").addEventListener("input", () => { simT = val("time"); draw(); });
  ["temp", "humidity", "wind", "windFrom", "drought", "fuel"].forEach((id) => $(`#${id}`).addEventListener("input", schedule));
  $("#load-kilmore").addEventListener("click", () => {
    const k = KILMORE_EAST[0]!;
    setSlider("temp", k.weather.temp); setSlider("humidity", k.weather.humidity); setSlider("wind", k.weather.wind);
    setSlider("drought", k.weather.drought); setSlider("fuel", k.fuelLoadTha); setSlider("windFrom", 338);
  });

  // ---- equations and the L/B chart ----------------------------------------------------------------
  equation($("#eq-ffdi"), "McArthur Mk5 forest fire danger index (Noble et al. 1980)",
    String.raw`\text{FFDI} = 2\exp(-0.45 + 0.987\ln D - 0.0345\,H + 0.0338\,T + 0.0234\,U)`);
  equation($("#eq-lb"), "Fire-ellipse length-to-breadth ratio (FBP Eq. 79)",
    String.raw`L/B = 1 + 8.729\,\big(1 - e^{-0.030\,U}\big)^{2.155}`);
  const lbChart = new LineChart($("#lb-chart"));
  const us = Array.from({ length: 81 }, (_, i) => i);
  lbChart.set({
    series: [
      { name: "FBP Eq. 79", color: "var(--series-rad)", points: us.map((u) => [u, lengthToBreadth(u)]) },
      { name: "Old placeholder", color: "var(--ink-3)", points: us.map((u) => [u, Math.min(8, 1 + 0.125 * u)]), dash: "5 4" },
    ],
    x: { min: 0, max: 80, title: "Wind, 10 m open (km/h)" },
    y: { min: 0, max: 10, title: "L/B" },
    markers: [{ x: 46, y: 5, label: "Kilmore East", color: "var(--series-obs)", detail: "Kilmore East, 14:00–15:00: L:B ≈ 5 at 46 km/h (Cruz et al. 2012)" }],
    tipFormat: (v) => fmt(v, 2),
    xTipFormat: (v) => `${fmt(v, 0)} km/h`,
  });

  recompute();
  requestAnimationFrame(tick);
  requestAnimationFrame(loop);
}
