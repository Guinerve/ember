import { describe, expect, it } from "vitest";
import { computeSpread, type Terrain } from "./spread";

const flat = (n: number): Terrain => ({ width: n, height: n, cellSizeM: 50, elevation: new Float32Array(n * n) });
const weather = { temp: 35, humidity: 20, wind: 0, drought: 8 };

describe("cellular spread", () => {
  const N = 61;
  const c = 30;
  const run = (over: Partial<Parameters<typeof computeSpread>[0]> = {}) =>
    computeSpread({ terrain: flat(N), weather, windToDeg: 0, fuelLoadTha: 12, ignitions: [{ x: c, y: c }], ...over });

  it("flat ground, no wind: spread is symmetric under reflection and 90° rotation", () => {
    const { arrival } = run();
    const at = (dx: number, dy: number) => arrival[(c + dy) * N + (c + dx)]!;
    for (const [dx, dy] of [[5, 0], [7, 3], [10, 4], [12, 12]] as const) {
      const v = at(dx, dy);
      for (const [a, b] of [[-dx, dy], [dx, -dy], [-dx, -dy], [dy, dx], [-dy, dx]] as [number, number][]) {
        expect(at(a, b)).toBeCloseTo(v, 4);
      }
    }
  });

  it("flat ground, no wind: arrival time is roughly distance / rate (circular front)", () => {
    const r = run();
    const rate = r.headMperMin;
    const d = 20 * 50; // 20 cells east
    expect(r.arrival[c * N + c + 20]!).toBeCloseTo(d / rate, 5);
    // diagonal: within ~4% of the Euclidean ideal (kernel anisotropy)
    const diag = Math.hypot(14, 14) * 50 / rate;
    expect(Math.abs(r.arrival[(c + 14) * N + c + 14]! / diag - 1)).toBeLessThan(0.04);
  });

  it("wind blowing east moves the head east faster than west", () => {
    const r = run({ weather: { ...weather, wind: 40 }, windToDeg: 90 });
    const east = r.arrival[c * N + c + 15]!;
    const west = r.arrival[c * N + c - 15]!;
    expect(east).toBeLessThan(west / 3);
  });

  it("fire runs uphill faster than downhill", () => {
    const n = 61;
    const elevation = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) elevation[y * n + x] = (n - y) * 15; // rises to the north, ~16.7°
    const r = computeSpread({ terrain: { width: n, height: n, cellSizeM: 50, elevation }, weather, windToDeg: 0, fuelLoadTha: 12, ignitions: [{ x: 30, y: 30 }] });
    expect(r.arrival[(30 - 15) * n + 30]!).toBeLessThan(r.arrival[(30 + 15) * n + 30]! / 4);
  });

  it("more fuel burns faster", () => {
    expect(run({ fuelLoadTha: 20 }).arrival[c * N + c + 10]!).toBeLessThan(run({ fuelLoadTha: 8 }).arrival[c * N + c + 10]!);
  });
});
