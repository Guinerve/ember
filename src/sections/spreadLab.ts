import { blackbodyCss } from "../physics/blackbody";
import { DEFAULT_PARTICLE, ignitionTemperature, type ParticleParams } from "../physics/particle";
import { flameNormal, receiverNormal, type Flame } from "../physics/radiation";
import { solveBedSpread, type BedSpreadInput, type BedSpreadResult } from "../physics/spread1d";
import { $, cssVar, deg, fmt, group, sliders, toggle } from "../ui/dom";
import { equation, equationLive } from "../ui/tex";

export interface SpreadLabInputs {
  windMs: number;
  flameK: number;
  emissivity: number;
  fuelLoad: number;
  bedDepthM: number;
  moisture: number;
  flameLengthM: number;
  closeFlame: boolean;
  losses: boolean;
}

export function bedInput(i: SpreadLabInputs): BedSpreadInput {
  const particle: ParticleParams = { ...DEFAULT_PARTICLE, moisture: i.moisture };
  return {
    flameK: i.flameK, flameEmissivity: i.emissivity, flameLengthM: i.flameLengthM, windMs: i.windMs,
    fuelLoad: i.fuelLoad, bedDepthM: i.bedDepthM, ignitionK: ignitionTemperature(particle), particle,
    closeFlame: i.closeFlame, losses: i.losses,
  };
}

/** Bed preheat colour: cool litter → dry tan at 100 °C → scorched → glowing at ignition. */
function bedColor(T: number, Tig: number): string {
  const c = T - 273.15;
  const stops: [number, [number, number, number]][] = [[30, [96, 112, 70]], [100, [168, 140, 82]], [200, [140, 84, 40]], [Tig - 273.15, [214, 70, 12]]];
  if (c <= stops[0]![0]) return `rgb(${stops[0]![1].join(" ")})`;
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!, [t0, c0] = stops[i - 1]!;
    if (c <= t1) {
      const f = (c - t0) / (t1 - t0);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k]! - v) * f)).join(" ")})`;
    }
  }
  return `rgb(${stops[stops.length - 1]![1].join(" ")})`;
}

export function initSpreadLab(): void {
  const root = $("#spread-controls");
  const read = sliders(root, [
    { id: "s-wind", label: "Wind at flame height", min: 0, max: 15, step: 0.1, value: 3, format: (v) => `${v.toFixed(1)} m/s (${Math.round(v * 3.6)} km/h)` },
    { id: "s-fuel", label: "Fine fuel load", min: 5, max: 30, step: 0.5, value: 15.6, format: (v) => `${v} t/ha` },
    { id: "s-depth", label: "Fuel bed depth", min: 1, max: 20, step: 0.5, value: 4, format: (v) => `${v} cm` },
    { id: "s-moist", label: "Fuel moisture", min: 2, max: 30, step: 0.5, value: 6, format: (v) => `${v}%` },
    { id: "s-temp", label: "Flame temperature", min: 900, max: 1400, step: 10, value: 1090, format: (v) => `${v} K` },
    { id: "s-eps", label: "Flame emissivity", min: 0.3, max: 1, step: 0.01, value: 0.95, format: (v) => v.toFixed(2) },
  ], () => schedule());
  const g = group(root, "Flame");
  const closure = toggle(g, "s-close", "Flame sized by the fire (Byram)", true, () => { syncLen(); schedule(); });
  const readLen = sliders(g, [{ id: "s-len", label: "Flame length (when set by hand)", min: 0.5, max: 25, step: 0.5, value: 4, format: (v) => `${v} m` }], () => schedule());
  const losses = toggle(g, "s-loss", "Heated fuel loses heat (re-radiation, air cooling)", true, () => schedule());
  const lenInput = document.getElementById("s-len") as HTMLInputElement;
  const syncLen = () => { lenInput.disabled = closure(); lenInput.closest("label")!.style.opacity = closure() ? "0.45" : "1"; };
  syncLen();

  equation($("#eq-balance"), "Energy balance on the fuel bed (per metre of fire line)",
    String.raw`R\,w\,Q_{\text{ig}} = \alpha\!\int_0^{\infty}\! q_{\text{top}}(x)\,dx \;+\; \alpha\,q_{\text{face}}\,\delta \;-\; \text{losses}`);
  equation($("#eq-qig"), "Heat to bring a kilogram of fuel to ignition",
    String.raw`Q_{\text{ig}} = c\,(T_{\text{ig}} - T_a) + M\,\big[c_w(100^\circ\text{C} - T_a) + L_v\big]`);
  equation($("#eq-byram"), "Flame length from fireline intensity (Byram 1959)",
    String.raw`L = 0.0775\,I^{0.46},\qquad I = H\,w\,R`);

  const canvas = $<HTMLCanvasElement>("#spread-canvas");
  const ctx = canvas.getContext("2d")!;
  let last: { res: BedSpreadResult; inp: BedSpreadInput } | null = null;

  function compute(): void {
    const inputs: SpreadLabInputs = {
      windMs: read("s-wind"), flameK: read("s-temp"), emissivity: read("s-eps"), fuelLoad: read("s-fuel") / 10,
      bedDepthM: read("s-depth") / 100, moisture: read("s-moist") / 100, flameLengthM: readLen("s-len"),
      closeFlame: closure(), losses: losses(),
    };
    const inp = bedInput(inputs);
    const res = solveBedSpread(inp);
    last = { res, inp };
    const mpm = res.rateMs * 60;
    $("#spread-result").innerHTML = res.status === "none"
      ? `<span class="num">0</span><span class="unit">m/min<br>no steady spread</span><span class="sub">The flame cannot heat the bed to ignition faster than the bed loses heat. Radiation alone cannot carry this fire.</span>`
      : `<span class="num">${fmt(mpm, 1)}</span><span class="unit">m/min<br>radiation-driven spread rate</span>
         <span class="sub">Flame ${fmt(res.flame.length, 1)} m long, leaning ${fmt(deg(res.flame.tiltRad), 0)}°. Fireline intensity ${fmt(res.intensityKWm, 0)} kW/m. Ignition at ${fmt(inp.ignitionK - 273.15, 0)} °C needs Q<sub>ig</sub> = ${fmt(res.qIg / 1000, 0)} kJ/kg.</span>`;
    const need = res.rateMs * inp.fuelLoad * res.qIg;
    const rows: [string, number, string][] = [
      ["Absorbed through top", res.powerTop, "var(--series-rad)"],
      ["Absorbed through face", res.powerFace, "var(--series-rad)"],
      ["Lost by heated fuel", res.powerLost, "var(--series-conv)"],
      ["Used: R·w·Q_ig", need, "var(--ink)"],
    ];
    const max = Math.max(1, ...rows.map((r) => r[1]));
    $("#spread-budget").innerHTML = `<p class="note"><b>Power per metre of fire line</b></p>` + rows
      .map(([l, v, c]) => `<div class="row"><span>${l}</span><span class="bar"><i style="width:${(100 * v) / max}%;background:${c}"></i></span><b>${fmt(v / 1000, 0)} kW/m</b></div>`)
      .join("");
    equationLive($("#eq-balance"), res.status === "ok"
      ? `${fmt(res.rateMs, 4)} m/s × ${fmt(inp.fuelLoad, 2)} kg/m² × ${fmt(res.qIg / 1000, 0)} kJ/kg = <b>${fmt(need / 1000, 0)} kW/m</b>`
      : "no positive R satisfies the balance");
    equationLive($("#eq-qig"), `${fmt(inp.particle.cp / 1000, 1)} kJ/kgK × ${fmt(inp.ignitionK - inp.particle.ambientK, 0)} K + ${fmt(inp.particle.moisture * 100, 1)}% water = <b>${fmt(res.qIg / 1000, 0)} kJ/kg</b>`);
    equationLive($("#eq-byram"), `I = ${fmt(res.intensityKWm, 0)} kW/m → L = ${fmt(0.0775 * Math.pow(res.intensityKWm, 0.46), 2)} m${inp.closeFlame ? ` (converged in ${res.iterations} steps)` : " (shown for comparison; flame set by hand)"}`);
    draw();
  }

  function draw(): void {
    if (!last) return;
    const { res, inp } = last;
    const dpr = Math.min(2, window.devicePixelRatio);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (W < 10) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const f: Flame = res.flame;
    const xMin = -Math.max(1.5, f.length * 0.35), xMax = Math.max(6, f.length * 2.6);
    const groundY = H * 0.78;
    const scale = Math.min(W / (xMax - xMin), (groundY - 18) / Math.max(1, f.length * Math.cos(f.tiltRad) * 1.05));
    const X = (x: number) => (x - xMin) * scale;
    const Z = (z: number) => groundY - z * scale;
    ctx.fillStyle = cssVar("--viewport") || "#0f1311";
    ctx.fillRect(0, 0, W, H);

    // bed depth exaggerated for visibility (at least 6 px)
    const bedPx = Math.max(6, inp.bedDepthM * scale);
    // unburnt bed coloured by preheat
    for (let i = 0; i < res.preheat.length - 1; i++) {
      const [x0, T0] = res.preheat[i]!, [x1] = res.preheat[i + 1]!;
      if (x0 > xMax) break;
      ctx.fillStyle = bedColor(T0, inp.ignitionK);
      ctx.fillRect(X(Math.max(0, x0)), groundY - bedPx, Math.max(1, X(Math.min(xMax, x1)) - X(Math.max(0, x0))) + 0.5, bedPx);
    }
    // burning zone and burnt ground behind
    ctx.fillStyle = "#3a1206";
    ctx.fillRect(0, groundY - bedPx * 0.4, X(0), bedPx * 0.4);
    const ember = ctx.createLinearGradient(X(-Math.min(1.2, f.length * 0.3)), 0, X(0), 0);
    ember.addColorStop(0, "rgba(255,62,0,0)"); ember.addColorStop(1, blackbodyCss(1000));
    ctx.fillStyle = ember;
    ctx.fillRect(X(-Math.min(1.2, f.length * 0.3)), groundY - bedPx, X(0) - X(-Math.min(1.2, f.length * 0.3)), bedPx);
    ctx.fillStyle = "#2a2f2b";
    ctx.fillRect(0, groundY, W, H - groundY);

    // flame: a glow, then a body that leans with the panel and breaks into tongues near the tip
    const tipX = f.length * Math.sin(f.tiltRad), tipZ = f.length * Math.cos(f.tiltRad);
    const depth = Math.min(1.4, Math.max(0.35, f.length * 0.28));
    const glow = ctx.createRadialGradient(X(tipX * 0.35), Z(tipZ * 0.35), 4, X(tipX * 0.35), Z(tipZ * 0.35), f.length * scale * 0.9);
    glow.addColorStop(0, "rgba(255,90,20,.32)"); glow.addColorStop(1, "rgba(255,60,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, groundY);
    const along = (u: number, off: number) => {
      // point at fraction u up the flame, offset `off` metres behind the front face (horizontal)
      const w = 1 - Math.pow(u, 1.6);
      return [X(u * tipX - off * w), Z(u * tipZ)] as const;
    };
    const body = ctx.createLinearGradient(X(0), Z(0), X(tipX), Z(tipZ));
    body.addColorStop(0, blackbodyCss(f.tempK + 220));
    body.addColorStop(0.45, blackbodyCss(f.tempK));
    body.addColorStop(1, "rgba(255,40,0,0)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(...along(0, 0));
    for (let i = 1; i <= 40; i++) {
      const u = i / 40;
      const flick = u > 0.55 ? Math.sin(u * 38) * 0.18 * depth * (u - 0.55) * 2.2 : 0;
      const [x, z] = along(u, -flick);
      ctx.lineTo(x, z);
    }
    for (let i = 40; i >= 0; i--) {
      const u = i / 40;
      const flick = u > 0.5 ? Math.cos(u * 31) * 0.25 * depth * (u - 0.5) * 2 : 0;
      const [x, z] = along(u * 0.92, depth + flick);
      ctx.lineTo(x, z);
    }
    ctx.closePath();
    ctx.globalCompositeOperation = "lighter";
    ctx.fill();
    // a brighter inner core near the base
    const core = ctx.createLinearGradient(X(0), Z(0), X(tipX * 0.5), Z(tipZ * 0.5));
    core.addColorStop(0, "rgba(255,200,120,.55)"); core.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(...along(0, 0.05));
    for (let i = 1; i <= 20; i++) ctx.lineTo(...along((i / 20) * 0.55, 0.05));
    for (let i = 20; i >= 0; i--) ctx.lineTo(...along((i / 20) * 0.5, depth * 0.55));
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // the radiating panel (the model's idealisation) as a thin line
    ctx.strokeStyle = "rgba(255,210,170,.85)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(0), Z(0)); ctx.lineTo(X(tipX), Z(tipZ)); ctx.stroke();

    // rays from the panel to one bed point, with θ₁ and θ₂
    const target = Math.min(xMax * 0.8, Math.max(0.6, f.length * 0.9));
    const tp = { x: target, z: inp.bedDepthM };
    ctx.lineWidth = 1;
    for (let i = 1; i <= 9; i++) {
      const s = (i / 10) * f.length;
      const px = s * Math.sin(f.tiltRad), pz = s * Math.cos(f.tiltRad);
      ctx.strokeStyle = `rgba(255,160,96,${0.18 + 0.05 * (10 - i)})`;
      ctx.beginPath(); ctx.moveTo(X(px), Z(pz)); ctx.lineTo(X(tp.x), groundY - bedPx); ctx.stroke();
    }
    const sMid = f.length * 0.45;
    const mp = { x: sMid * Math.sin(f.tiltRad), z: sMid * Math.cos(f.tiltRad) };
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(mp.x), Z(mp.z)); ctx.lineTo(X(tp.x), groundY - bedPx); ctx.stroke();
    const n1 = flameNormal(f), n2 = receiverNormal(0);
    const rayAng = Math.atan2(-(groundY - bedPx - Z(mp.z)), X(tp.x) - X(mp.x)); // screen angle of the ray
    const n1Ang = Math.atan2(-n1[2], n1[0]); // screen angle (y down) of the flame normal
    const arc = (cx: number, cy: number, a0: number, a1: number, r: number, label: string) => {
      ctx.strokeStyle = "#fff"; ctx.beginPath();
      ctx.arc(cx, cy, r, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
      const am = (a0 + a1) / 2;
      ctx.font = "italic 500 14px Newsreader, serif";
      const tw = ctx.measureText(label).width;
      const lx = cx + Math.cos(am) * (r + 16) - tw / 2, ly = cy + Math.sin(am) * (r + 16) + 5;
      ctx.fillStyle = "rgba(15,19,17,.78)"; ctx.fillRect(lx - 4, ly - 13, tw + 8, 18);
      ctx.fillStyle = "#fff"; ctx.fillText(label, lx, ly);
    };
    // normals
    const nLen = 44;
    ctx.strokeStyle = "rgba(223,229,222,.9)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(mp.x), Z(mp.z)); ctx.lineTo(X(mp.x) + Math.cos(n1Ang) * nLen, Z(mp.z) + Math.sin(n1Ang) * nLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(tp.x), groundY - bedPx); ctx.lineTo(X(tp.x), groundY - bedPx - nLen); ctx.stroke();
    const rayScreen = -rayAng; // canvas angle (y down)
    const theta1 = Math.acos(Math.max(-1, Math.min(1, n1[0] * (tp.x - mp.x) / Math.hypot(tp.x - mp.x, tp.z - mp.z) + n1[2] * (tp.z - mp.z) / Math.hypot(tp.x - mp.x, tp.z - mp.z))));
    const theta2 = Math.acos(Math.max(-1, Math.min(1, -(n2[2] * (tp.z - mp.z)) / Math.hypot(tp.x - mp.x, tp.z - mp.z))));
    arc(X(mp.x), Z(mp.z), n1Ang, rayScreen, 26, `θ₁ ${fmt(deg(theta1), 0)}°`);
    const back = Math.atan2(Z(mp.z) - (groundY - bedPx), X(mp.x) - X(tp.x));
    arc(X(tp.x), groundY - bedPx, -Math.PI / 2, back, 26, `θ₂ ${fmt(deg(theta2), 0)}°`);

    // zone labels from the preheat profile
    ctx.font = "500 12px Barlow, sans-serif"; ctx.fillStyle = "#c8d0c9";
    const firstAt = (pred: (T: number) => boolean) => res.preheat.find(([, T]) => pred(T))?.[0];
    const dryEnd = res.preheat.slice().reverse().find(([, T]) => T > 373.2)?.[0];
    const wetStart = firstAt((T) => T <= 373.16);
    const label = (x: number | undefined, text: string, row: number) => {
      if (x === undefined || x > xMax || x < 0.05) return;
      ctx.strokeStyle = "rgba(200,208,201,.5)"; ctx.beginPath(); ctx.moveTo(X(x), groundY + 2); ctx.lineTo(X(x), groundY + 10 + row * 14); ctx.stroke();
      ctx.fillText(text, Math.min(W - ctx.measureText(text).width - 6, X(x) + 4), groundY + 14 + row * 14);
    };
    label(dryEnd, "drying finished", 0);
    label(wetStart !== undefined && wetStart > 0.05 ? res.preheat.find(([, T]) => T >= 373.1)?.[0] : undefined, "reaches 100 °C", 1);
    ctx.fillText("fire line", X(0) - 48, groundY + 14);
    ctx.fillStyle = "#9aa59d";
    const scaleM = xMax > 30 ? 10 : xMax > 12 ? 5 : 1;
    ctx.fillRect(W - 16 - scaleM * scale, H - 14, scaleM * scale, 2);
    ctx.fillText(`${scaleM} m`, W - 16 - scaleM * scale, H - 20);
  }

  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = window.setTimeout(compute, 40); };
  new ResizeObserver(() => draw()).observe(canvas);
  compute();
}
