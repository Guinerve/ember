import { describe, expect, it } from "vitest";
import { hillshade } from "./hillshade";

const ramp = (f: (x: number, y: number) => number) => {
  const n = 9, z = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) z[y * n + x] = f(x, y);
  return hillshade({ width: n, height: n, cellSizeM: 50, elevation: z })[(4 * n + 4) * 4 + 1]!; // green channel, centre cell
};

describe("hillshade (sun in the north-west)", () => {
  // x grows east, y grows south on screen. Elevation rising to the south-east means the face looks north-west.
  it("lights a north-west-facing slope and darkens a south-east-facing one", () => {
    const nwFacing = ramp((x, y) => 20 * (x + y));
    const seFacing = ramp((x, y) => -20 * (x + y));
    const flat = ramp((x) => 0.001 * x); // near-flat: a perfectly flat grid has zero relief range and a NaN tint
    expect(nwFacing).toBeGreaterThan(flat);
    expect(seFacing).toBeLessThan(flat);
  });
  it("north-east faces are not the brightest (regression: light used to come from the NE)", () => {
    const neFacing = ramp((x, y) => 20 * (-x + y)); // rises to the south-west => faces north-east
    const nwFacing = ramp((x, y) => 20 * (x + y));
    expect(nwFacing).toBeGreaterThan(neFacing);
  });
});
