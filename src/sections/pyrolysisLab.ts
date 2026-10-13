import { blackbodyCss } from "../physics/blackbody";
import { convectionCoefficient } from "../physics/convection";
import { DEFAULT_PARTICLE, heatParticle, ignitionTemperature, surfaceToVolume, type ParticleParams, type ParticleRun } from "../physics/particle";
import { A_PRE, arrheniusRate, E_ACT, tgaCurve } from "../physics/pyrolysis";
import { radiationState } from "../state";
import { $, fmt, frameThrottle, readouts, reducedMotion, sliders, toggle } from "../ui/dom";
import { LineChart } from "../ui/chart";
import { equation, equationLive } from "../ui/tex";

const C = (k: number) => k - 273.15;

export function initPyrolysisLab(): void {
  const root = $("#pyro-controls");
  const useFlux = document.createElement("p");
  useFlux.className = "note";
  root.append(useFlux);
  const get = sliders(root, [
    { id: "p-q", label: "Radiant flux on the leaf", min: 0, max: 150, step: 0.5, value: 60, format: (v) => `${v} kW/m²` },
    { id: "p-u", label: "Air speed past the leaf", min: 0.1, max: 6, step: 0.1, value: 1, format: (v) => `${v.toFixed(1)} m/s` },
    { id: "p-d", label: "Thickness (leaf) or diameter (twig)", min: 0.1, max: 6, step: 0.05, value: 0.3, format: (v) => `${v.toFixed(2)} mm` },
    { id: "p-m", label: "Moisture content", min: 0, max: 40, step: 1, value: 8, format: (v) => `${v}% of dry mass` },
  ], () => schedule());
  const contact = toggle(root, "p-contact", "Bathed in flame gas at 1,000 K (flame contact)", false, () => schedule());
  const twig = toggle(root, "p-twig", "Twig (cylinder) instead of a flat leaf", false, () => schedule());

  let sectionFlux = 0;
  radiationState.subscribe((s) => {
    sectionFlux = s.flux / 1000;
    useFlux.innerHTML = `The leaf in section 1 receives <b>${fmt(sectionFlux, 1)} kW/m²</b>. <button type="button" class="linkish" id="p-use">Use it here</button>`;
    $("#p-use").addEventListener("click", () => {
      const el = document.getElementById("p-q") as HTMLInputElement;
      el.value = String(Math.round(sectionFlux * 2) / 2);
      el.dispatchEvent(new Event("input"));
    });
  });

  const tempChart = new LineChart($("#pyro-temp"));
  const massChart = new LineChart($("#pyro-mass"));
  const fluxChart = new LineChart($("#pyro-flux"));
  const tga = new LineChart($("#tga-chart"));

  equation($("#eq-leaf"), "Energy balance per unit volume of a thermally thin leaf",
    String.raw`\rho\,(c + M c_w)\,\frac{dT}{dt} = \frac{\alpha\,q_{\text{rad}}}{t} + \frac{2}{t}\Big[h\,(T_{\text{gas}} - T) - \varepsilon\sigma\,(T^4 - T_a^4)\Big]`);
  equation($("#eq-arr"), "Pyrolysis rate (Arrhenius, single step)",
    String.raw`\frac{dY}{dt} = -A\,e^{-E/RT}\,(Y - Y_{\text{char}})`,
    `E = ${E_ACT / 1000} kJ/mol, A = ${A_PRE.toExponential(2)} s⁻¹`);

  // kinetics chart (fixed)
  const curve = tgaCurve();
  const peak = curve.reduce((a, c) => (c[2] > a[2] ? c : a), curve[0]!);
  tga.set({
    series: [{ name: "Mass-loss rate", color: "var(--series-rad)", points: curve.map(([T, , r]) => [C(T), r * 60 * 100]), area: true, endLabel: false }],
    x: { min: 200, max: 450, title: "Temperature (°C)" },
    y: { min: 0, max: Math.ceil(peak[2] * 6000 / 5) * 5, title: "% per minute" },
    markers: [{ x: C(peak[0]), y: peak[2] * 6000, label: `${fmt(C(peak[0]), 0)} °C`, color: "var(--series-rad)", detail: `Peak mass loss at ${fmt(C(peak[0]), 0)} °C, ${fmt(peak[2] * 6000, 1)}% per minute` }],
    tipFormat: (v) => `${fmt(v, 1)} %/min`,
    xTipFormat: (v) => `${fmt(v, 0)} °C`,
  });

  let anim = 0;
  function update(): void {
    const p: ParticleParams = {
      ...DEFAULT_PARTICLE,
      shape: twig() ? "twig" : "leaf",
      thicknessM: get("p-d") / 1000,
      moisture: get("p-m") / 100,
    };
    const qRad = get("p-q") * 1000;
    const gasK = contact() ? 1000 : p.ambientK;
    const tMax = 180;
    const run = heatParticle(p, () => ({ qRad, gasK, gasSpeed: get("p-u") }), { tMax, recordEvery: 0.1, stopAtIgnition: false });
    const tIg = run.tIgnition;
    const tEnd = tIg !== null ? Math.min(tMax, Math.max(10, tIg * 1.8)) : tMax;
    const states = run.states.filter((s) => s.t <= tEnd);
    const Tig = ignitionTemperature(p);

    // drying band: from first reaching 100 °C until dry
    const tBoil = states.find((s) => s.tempK >= 373.1 && p.moisture > 0)?.t;
    const bands = tBoil !== undefined && run.tDry !== null && run.tDry <= tEnd ? [{ x0: tBoil, x1: run.tDry, label: "drying" }] : [];
    const xAxis = { min: 0, max: tEnd, title: "Time (s)" };
    tempChart.set({
      series: [{ name: "Leaf temperature", color: "var(--series-rad)", points: states.map((s) => [s.t, C(s.tempK)]), endLabel: false }],
      x: xAxis,
      y: { min: 0, max: Math.max(500, Math.ceil(Math.max(...states.map((s) => C(s.tempK))) / 100) * 100 + 50), title: "°C" },
      bands,
      hlines: [{ y: C(Tig), label: `ignition at the critical gas flux ≈ ${fmt(C(Tig), 0)} °C` }],
      vlines: tIg !== null ? [{ x: tIg, label: `ignites at ${fmt(tIg, 1)} s` }] : [],
      tipFormat: (v) => `${fmt(v, 0)} °C`,
      xTipFormat: (v) => `${fmt(v, 1)} s`,
    });
    massChart.set({
      series: [{ name: "Dry mass remaining", color: "var(--series-cond)", points: states.map((s) => [s.t, s.y * 100]), endLabel: false }],
      x: xAxis,
      y: { min: 0, max: 100, title: "% of dry mass" },
      hlines: [{ y: p.charYield * 100, label: "char" }],
      tipFormat: (v) => `${fmt(v, 0)}%`,
      xTipFormat: (v) => `${fmt(v, 1)} s`,
    });
    const fluxMax = Math.max(3, ...states.map((s) => s.volatileFlux * 1000));
    fluxChart.set({
      series: [{ name: "Flammable-gas flux", color: "var(--series-obs)", points: states.map((s) => [s.t, s.volatileFlux * 1000]), endLabel: false }],
      x: xAxis,
      y: { min: 0, max: Math.min(60, Math.ceil(fluxMax * 1.1)), title: "g/m²/s" },
      hlines: [{ y: p.critMassFlux * 1000, label: "critical" }],
      tipFormat: (v) => `${fmt(v, 2)} g/m²/s`,
      xTipFormat: (v) => `${fmt(v, 1)} s`,
    });

    const last = states[states.length - 1]!;
    const hNow = convectionCoefficient(p.shape, p.shape === "leaf" ? p.chordM : p.thicknessM, get("p-u"), last.tempK, gasK);
    const maxT = Math.max(...run.states.map((s) => s.tempK));
    readouts($("#pyro-readouts"), [
      ["Time to ignition", tIg !== null ? fmt(tIg, 1) : "no ignition", tIg !== null ? "s" : undefined],
      ["Hottest it gets", fmt(C(maxT), 0), "°C"],
      ["Surface-to-volume σ", fmt(surfaceToVolume(p), 0), "m⁻¹"],
      ["Convective h", fmt(hNow, 0), "W/m²K"],
    ]);
    $("#pyro-caption").textContent = tIg !== null
      ? `Ignites after ${fmt(tIg, 1)} s.${bands.length ? " Shaded: the 100 °C drying stall." : ""}`
      : maxT > Tig - 40
        ? "No ignition: the leaf pyrolyses slowly and chars away without ever releasing gas fast enough."
        : `No ignition in ${tMax} s: heat lost to the air and re-radiated balances what it absorbs.`;
    equationLive($("#eq-arr"), `E = ${E_ACT / 1000} kJ/mol, A = ${A_PRE.toExponential(2)} s⁻¹. At ${fmt(C(Tig), 0)} °C, k = ${fmt(arrheniusRate(Tig), 3)} s⁻¹; at 300 °C only ${arrheniusRate(573.15).toExponential(1)} s⁻¹.`);

    playLeaf(run, tEnd);
  }

  // leaf glyph: replays the heating in ~3 s (or shows the end state with reduced motion)
  function playLeaf(run: ParticleRun, tEnd: number): void {
    cancelAnimationFrame(anim);
    const glyph = $("#leaf-glyph");
    const draw = (t: number) => {
      const s = run.states.find((x) => x.t >= t) ?? run.states[run.states.length - 1]!;
      const lit = run.tIgnition !== null && t >= run.tIgnition;
      const charF = (1 - s.y) / (1 - DEFAULT_PARTICLE.charYield);
      const dry = s.moisture <= 0.001;
      const base = charF > 0.05 ? mix([120, 92, 50], [28, 24, 20], Math.min(1, charF)) : dry ? [150, 120, 64] : [130, 150, 92];
      const glow = s.tempK > 750 ? blackbodyCss(s.tempK) : "transparent";
      glyph.innerHTML = `<svg viewBox="0 0 240 92" role="img" aria-label="Leaf at ${fmt(t, 1)} s: ${fmt(C(s.tempK), 0)} °C">
        <defs><radialGradient id="lg"><stop offset="0" stop-color="${glow}" stop-opacity=".9"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs>
        ${s.tempK > 750 ? `<ellipse cx="80" cy="46" rx="60" ry="34" fill="url(#lg)"/>` : ""}
        <path d="M30 46 Q80 6 130 46 Q80 86 30 46 Z" fill="rgb(${base.map((v) => v | 0).join(" ")})" stroke="rgb(255 255 255 / .25)"/>
        <path d="M30 46 L130 46" stroke="rgb(255 255 255 / .25)"/>
        ${lit ? `<path d="M70 44 C64 26 82 22 78 4 C92 20 100 30 92 44 C88 34 84 40 82 44 Z" fill="${blackbodyCss(1300)}" opacity=".95"/>` : ""}
        <text x="150" y="40" fill="#dfe5de" font-family="Barlow, sans-serif" font-size="13" font-weight="600">${fmt(t, 1)} s, ${fmt(C(s.tempK), 0)} °C</text>
        <text x="150" y="60" fill="#9aa59d" font-family="Barlow, sans-serif" font-size="12">${lit ? "flaming" : charF > 0.05 ? "pyrolysing" : !dry && s.tempK >= 372 ? "drying" : "heating"}</text>
      </svg>`;
    };
    if (reducedMotion()) { draw(run.tIgnition ?? tEnd); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / 3000);
      draw(f * tEnd);
      if (f < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  const schedule = frameThrottle(update);
  update();
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i]! - v) * t);
}
