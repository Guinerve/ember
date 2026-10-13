import { bedConductionFlux, convectionCoefficient } from "../physics/convection";
import { flameReach, radiantFlux, SIGMA } from "../physics/radiation";
import { radiationState } from "../state";
import { $, fmt } from "../ui/dom";
import { LineChart } from "../ui/chart";
import { equation } from "../ui/tex";

const T_AMB = 303.15;

/** Flame-gas temperature at x ahead: flame temperature at the fire line, falling linearly to ambient at the leaning flame's reach. */
export function contactGasTemp(x: number, reach: number, flameK: number): number {
  if (reach <= 0 || x >= reach) return T_AMB;
  return flameK + (T_AMB - flameK) * Math.max(0, x / reach);
}

export function initHeatPaths(): void {
  const paths = new LineChart($("#paths-chart"));
  const t4 = new LineChart($("#t4-chart"));

  equation($("#eq-conv"), "Convection: needs contact with hot gas", String.raw`q_{\text{conv}} = h\,(T_{\text{gas}} - T)`);
  equation($("#eq-cond"), "Conduction ahead of a front moving at R", String.raw`q_{\text{cond}} = \frac{k\,\Delta T}{\ell}\,e^{-x/\ell},\quad \ell = \frac{a}{R}`);

  radiationState.subscribe((s) => {
    const { flame } = s;
    const reach = flameReach(flame);
    const xs: number[] = [];
    for (let i = 0; i <= 120; i++) xs.push(1e-4 * Math.pow(40 / 1e-4, i / 120));
    // fuel at ground level, facing like the leaf in section 1; from 1 cm out, since a flat flame sheet
    // that touches the ground gives a sharp geometric step within a receiver-height of the fire line
    const rad = xs.filter((x) => x >= 0.01).map((x) => [x, radiantFlux(flame, [x, 0, 0.002], s.receiverNormal) / 1000] as [number, number]);
    const conv = xs
      .map((x) => {
        const gas = contactGasTemp(x, reach, flame.tempK);
        const h = convectionCoefficient("leaf", 0.015, 2, T_AMB, gas);
        return [x, (h * (gas - T_AMB)) / 1000] as [number, number];
      })
      .filter((p) => p[1] > 0.005);
    const cond = xs.map((x) => [x, bedConductionFlux(x, 0.1, flame.tempK - T_AMB) / 1000] as [number, number]).filter((p) => p[1] > 0.005);
    paths.set({
      series: [
        { name: "Radiation", color: "var(--series-rad)", points: rad },
        { name: "Convection (flame contact)", color: "var(--series-conv)", points: conv },
        { name: "Conduction in the bed", color: "var(--series-cond)", points: cond },
      ],
      x: { min: 1e-4, max: 40, log: true, title: "Distance ahead of the fire line (m)", format: (v) => (v < 0.01 ? `${v * 1000} mm` : v < 1 ? `${v * 100} cm` : `${v} m`) },
      y: { min: 0.01, max: 300, log: true, title: "kW/m²", format: (v) => (v < 1 ? String(v) : fmt(v, 0)) },
      vlines: reach > 0.05 ? [{ x: reach, label: "flame tip reach" }] : [],
      tipFormat: (v) => `${fmt(v, v < 1 ? 2 : 1)} kW/m²`,
      xTipFormat: (v) => (v < 0.01 ? `${fmt(v * 1000, 2)} mm` : v < 1 ? `${fmt(v * 100, 1)} cm` : `${fmt(v, 1)} m`),
    });
  });

  // radiation vs convection as a surface heats
  const temps: number[] = [];
  for (let T = 310; T <= 1500; T += 10) temps.push(T);
  const rad = temps.map((T) => [T, (0.9 * SIGMA * (T ** 4 - T_AMB ** 4)) / 1000] as [number, number]);
  const c25 = temps.map((T) => [T, (25 * (T - T_AMB)) / 1000] as [number, number]);
  const c100 = temps.map((T) => [T, (100 * (T - T_AMB)) / 1000] as [number, number]);
  const cross = (h: number) => { for (const T of temps) if (0.9 * SIGMA * (T ** 4 - T_AMB ** 4) > h * (T - T_AMB)) return T; return NaN; };
  const x25 = cross(25), x100 = cross(100);
  t4.set({
    series: [
      { name: "Radiation", color: "var(--series-rad)", points: rad },
      { name: "Convection, h = 100", color: "var(--series-conv)", points: c100 },
      { name: "Convection, h = 25", color: "var(--series-conv)", points: c25, dash: "5 4" },
    ],
    x: { min: 300, max: 1500, title: "Surface temperature (K)" },
    y: { min: 0, max: 300, title: "kW/m²" },
    markers: [
      { x: x25, y: (25 * (x25 - T_AMB)) / 1000, label: `${x25} K`, color: "var(--ink)", detail: `Radiation passes convection in still air (h = 25 W/m²K) at ${x25} K` },
      { x: x100, y: (100 * (x100 - T_AMB)) / 1000, label: `${x100} K`, color: "var(--ink)", detail: `Radiation passes convection in wind (h = 100 W/m²K) at ${x100} K` },
    ],
    vlines: [{ x: 1090, label: "1090 K flame" }],
    tipFormat: (v) => `${fmt(v, 1)} kW/m²`,
    xTipFormat: (v) => `${fmt(v, 0)} K`,
  });
}
