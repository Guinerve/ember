import { ffdi, headRateOfSpread } from "../ffdi";
import { solveBedSpread } from "../physics/spread1d";
import { compareReference, KILMORE_EAST, KILMORE_SOURCE } from "../reference";
import { $, fmt, whenVisible } from "../ui/dom";
import { LineChart } from "../ui/chart";
import { bedInput } from "./spreadLab";

/**
 * Physics inputs for Kilmore East: fine fuel 1.56 kg/m² (Table 3, DSFL), forest fine fuel moisture 4.5%
 * (Table A2, 4–5% at 14:00), and wind at flame height taken as one third of the 10 m open wind, a common
 * sub-canopy reduction for dry eucalypt forest. The wind reduction is our assumption, not the paper's.
 */
const WIND_REDUCTION = 1 / 3;
const physicsAt = (u10Kmh: number) =>
  solveBedSpread(bedInput({
    windMs: (u10Kmh / 3.6) * WIND_REDUCTION, flameK: 1090, emissivity: 0.95, fuelLoad: 1.56, bedDepthM: 0.04,
    moisture: 0.045, flameLengthM: 3, closeFlame: true, losses: true,
  }));

export function initReference(): void {
  const chart = new LineChart($("#ref-chart"));
  const [bp4] = KILMORE_EAST;
  const w = bp4!.weather;
  const us = Array.from({ length: 17 }, (_, i) => i * 5);
  const mk5 = us.map((u) => [u, (headRateOfSpread(ffdi({ ...w, wind: u }), bp4!.fuelLoadTha) * 1000) / 60] as [number, number]);
  const tenPct = us.map((u) => [u, (0.1 * u * 1000) / 60] as [number, number]);
  const phys: [number, number][] = [];
  const markers = KILMORE_EAST.map((c) => ({
    x: c.weather.wind, y: c.observedMperMin, label: `Observed, ${c.time}`, color: "var(--series-obs)",
    detail: `${c.label} (${c.time}): ${c.observedMperMin} m/min observed at ${c.weather.wind} km/h, ${c.weather.temp} °C, ${c.weather.humidity}% RH`,
  }));

  const render = () => chart.set({
    series: [
      { name: "10% of wind speed rule", color: "var(--series-cond)", points: tenPct, dash: "5 4" },
      { name: "McArthur Mk5", color: "var(--series-conv)", points: mk5 },
      { name: "Physics, radiation only", color: "var(--series-rad)", points: phys },
    ],
    x: { min: 0, max: 80, title: "Wind, 10 m open (km/h)" },
    y: { min: 0, max: 170, title: "m/min" },
    markers,
    tipFormat: (v) => `${fmt(v, 0)} m/min`,
    xTipFormat: (v) => `${fmt(v, 0)} km/h`,
  });

  // table
  const rows = KILMORE_EAST.map((c) => ({ c, r: compareReference(c), p: physicsAt(c.weather.wind) }));
  const ratio = (obs: number, v: number) => `<small class="ratio">observed is ${fmt(obs / v, 1)}×</small>`;
  $("#ref-table").innerHTML = `
    <caption>Kilmore East, dry sclerophyll forest, Kilmore Gap weather (Cruz et al. 2012, Tables 3, 4, A2)</caption>
    <thead><tr><th scope="col"></th>${rows.map(({ c }) => `<th scope="col">${c.time}<small>${c.weather.temp} °C, ${c.weather.humidity}% RH, ${c.weather.wind} km/h, DF ${c.weather.drought}</small></th>`).join("")}</tr></thead>
    <tbody>
      <tr class="obs"><td>Observed forward spread</td>${rows.map(({ c }) => `<td>${c.observedMperMin} m/min</td>`).join("")}</tr>
      <tr><td>FFDI, ours<small>published: 106 and 155</small></td>${rows.map(({ r }) => `<td>${fmt(r.ffdi, 0)}</td>`).join("")}</tr>
      <tr><td>McArthur Mk5 (map model)<small>15.6 t/ha fine fuel</small></td>${rows.map(({ c, r }) => `<td>${fmt(r.mk5MperMin, 0)} m/min${ratio(c.observedMperMin, r.mk5MperMin)}</td>`).join("")}</tr>
      <tr><td>10% of wind speed<small>Cruz &amp; Alexander 2019</small></td>${rows.map(({ c, r }) => `<td>${fmt(r.tenPercentMperMin, 0)} m/min${ratio(c.observedMperMin, r.tenPercentMperMin)}</td>`).join("")}</tr>
      <tr><td>Physics, radiation only<small>section 4, flame sized by the fire</small></td>${rows.map(({ c, p }) => `<td>${fmt(p.rateMs * 60, 0)} m/min${ratio(c.observedMperMin, p.rateMs * 60)}</td>`).join("")}</tr>
      <tr><td>Length to breadth<small>model, FBP Eq. 79</small></td>${rows.map(({ c, r }) => `<td>${fmt(r.modelLB, 1)}<small>${c.observedLB ? `observed ≈ ${c.observedLB}` : "not reported"}</small></td>`).join("")}</tr>
    </tbody>`;
  $("#ref-note").innerHTML = `Mk5 gives the published FFDI. It under-predicts the observed spread by ${fmt(rows[0]!.r.underprediction, 1)} and ${fmt(rows[1]!.r.underprediction, 1)} times. Published studies report 2 to 3 times for summer wildfires, so the second hour is a little above that range. The model with radiation only falls further short. That is the point of section 4: radiation preheats the fuel, but flame contact, turbulence and dense spotting over short distances carried the fire in these hours. Physics inputs: forest fuel moisture 4.5% (Table A2). Wind at flame height is one third of the 10 m wind (my assumption). Source: <a href="${KILMORE_SOURCE.doi}">${KILMORE_SOURCE.citation}</a>.`;

  // physics curve: computed in small chunks once the section is near the screen
  let started = false;
  render();
  whenVisible($("#ref-chart"), (v) => {
    if (!v || started) return;
    started = true;
    let i = 0;
    const step = () => {
      const u = us[i]!;
      phys.push([u, physicsAt(u).rateMs * 60]);
      render();
      if (++i < us.length) setTimeout(step, 0);
    };
    step();
  });
}
