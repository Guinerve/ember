import { describe, expect, it } from "vitest";
import { lengthToBreadth } from "./ffdi";
import { compareReference, KILMORE_EAST } from "./reference";
import { computeSpread, type Terrain } from "./spread";

const [bp4, bp5] = KILMORE_EAST as [typeof KILMORE_EAST[0], typeof KILMORE_EAST[0]];

describe("Kilmore East reference case (Cruz et al. 2012)", () => {
  it("our FFDI reproduces the published hourly FFDI (Table A2: 106 at 14:00, 155 at 15:00)", () => {
    expect(compareReference(bp4).ffdi).toBeCloseTo(106, -0.5);
    expect(compareReference(bp5).ffdi).toBeCloseTo(155, -0.5);
  });

  it("Mk5 under-predicts the observed spread by a factor of 2–3.5, as the literature reports", () => {
    for (const c of [bp4, bp5]) {
      const r = compareReference(c);
      expect(r.underprediction).toBeGreaterThan(2);
      expect(r.underprediction).toBeLessThan(3.5);
    }
  });

  it("the published L/B (FBP Eq. 79) is nearer the observed L:B of 5 than the old 1 + 0.125·U placeholder", () => {
    const fbp = lengthToBreadth(bp4.weather.wind);
    const placeholder = 1 + 0.125 * bp4.weather.wind;
    expect(Math.abs(fbp - 5)).toBeLessThan(Math.abs(placeholder - 5));
    expect(fbp).toBeCloseTo(5.67, 1);
  });

  it("FBP Eq. 79 spot values: 1 at calm, saturating below 9.73", () => {
    expect(lengthToBreadth(0)).toBe(1);
    expect(lengthToBreadth(10)).toBeCloseTo(1.476, 2);
    expect(lengthToBreadth(500)).toBeLessThan(9.73);
  });

  it("on flat ground the simulator's head fire runs at the Mk5 rate and its burnt shape has the model L/B", () => {
    const n = 241, cs = 25;
    const terrain: Terrain = { width: n, height: n, cellSizeM: cs, elevation: new Float32Array(n * n) };
    const c = 60; // ignite near the west edge; wind blows east
    const r = computeSpread({ terrain, weather: bp4.weather, windToDeg: 90, fuelLoadTha: bp4.fuelLoadTha, ignitions: [{ x: c, y: (n - 1) / 2 }] });
    const t = 60;
    const mid = (n - 1) / 2;
    let head = 0, back = 0, top = mid, bottom = mid;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (r.arrival[y * n + x]! > t) continue;
      head = Math.max(head, x - c); back = Math.max(back, c - x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const headRate = (head * cs) / t;
    const mk5 = compareReference(bp4).mk5MperMin;
    expect(Math.abs(headRate / mk5 - 1)).toBeLessThan(0.05);
    const lb = (head + back + 1) / (bottom - top + 1);
    expect(Math.abs(lb / lengthToBreadth(bp4.weather.wind) - 1)).toBeLessThan(0.15);
  });
});
