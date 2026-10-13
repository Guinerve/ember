import "./style.css";
import { initHeatPaths } from "./sections/heatPaths";
import { initLandscape } from "./sections/landscape";
import { initPyrolysisLab } from "./sections/pyrolysisLab";
import { initRadiationLab } from "./sections/radiationLab";
import { initReference } from "./sections/referenceSection";
import { initSpreadLab } from "./sections/spreadLab";

/** Start each section on its own so one failure (say, no WebGL) does not take down the rest. */
function start(name: string, fn: () => void | Promise<void>, fallbackHost?: string): void {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch((e) => report(name, e, fallbackHost));
  } catch (e) {
    report(name, e, fallbackHost);
  }
}

function report(name: string, e: unknown, host?: string): void {
  console.error(`${name} failed to start`, e);
  if (!host) return;
  const el = document.querySelector(host);
  if (el) {
    el.removeAttribute("hidden");
    el.setAttribute("role", "alert");
    el.textContent = `This part of the page could not start (${name}). Reload the page to retry. The rest of the page still works.`;
  }
}

// heat paths and pyrolysis subscribe to the radiation lab, so they start first
start("heat paths", initHeatPaths, "#paths-chart");
start("pyrolysis", initPyrolysisLab, "#pyro-temp");
start("radiation", initRadiationLab, "#rad-gl");
start("spread", initSpreadLab, "#spread-result");
start("landscape", initLandscape, "#map-busy");
start("reference", initReference, "#ref-chart");
