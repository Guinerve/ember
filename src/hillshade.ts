import type { Terrain } from "./spread";

/** Lambert hillshade with the sun in the north-west, plus a faint elevation tint. */
export function hillshade(t: Terrain): Uint8ClampedArray {
  const { width: W, height: H, cellSizeM: cs, elevation: z } = t;
  const out = new Uint8ClampedArray(W * H * 4);
  const az = (315 * Math.PI) / 180, alt = (40 * Math.PI) / 180;
  let zmin = Infinity, zmax = -Infinity;
  for (const v of z) { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); }
  const relief = zmax > zmin ? zmax - zmin : 1; // a flat grid gets the low-ground tint, not NaN
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const g = (xx: number, yy: number) => z[Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))]!;
    const dzdx = (g(x + 1, y) - g(x - 1, y)) / (2 * cs); // rise per metre going east
    const dzdn = (g(x, y - 1) - g(x, y + 1)) / (2 * cs); // rise per metre going north (north is up the screen)
    // Lambert shading: dot product of the surface normal (-dzdx, -dzdn, 1) with the unit vector towards the sun.
    const sx = Math.sin(az) * Math.cos(alt), sn = Math.cos(az) * Math.cos(alt), sz = Math.sin(alt);
    const lit = (-dzdx * sx - dzdn * sn + sz) / Math.sqrt(dzdx * dzdx + dzdn * dzdn + 1);
    const s = 0.25 + 0.75 * Math.max(0, lit);
    const e = (z[y * W + x]! - zmin) / relief;
    const i = (y * W + x) * 4;
    out[i] = (70 + 80 * e) * s;
    out[i + 1] = (95 + 60 * e) * s;
    out[i + 2] = (60 + 70 * e) * s;
    out[i + 3] = 255;
  }
  return out;
}

