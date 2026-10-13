import { directionalSpread, ffdi, headRateOfSpread, slopeFactor, type Weather } from "./ffdi";

export interface Terrain {
  width: number;
  height: number;
  cellSizeM: number;
  /** metres, row-major, north at row 0 */
  elevation: Float32Array;
}

export interface SpreadInput {
  terrain: Terrain;
  weather: Weather;
  /** direction the wind blows TOWARDS, degrees clockwise from north */
  windToDeg: number;
  fuelLoadTha: number;
  ignitions: { x: number; y: number }[];
}

export interface SpreadResult {
  /** minutes after ignition at which each cell burns; Infinity if never */
  arrival: Float64Array;
  ffdi: number;
  headMperMin: number;
}

/**
 * Neighbour kernel: every lattice step (dx, dy) with max(|dx|, |dy|) ≤ radius and gcd(dx, dy) = 1.
 *
 * Minimum travel time over a fixed set of directions can only reach the convex hull of the rate polar
 * sampled at those directions. A focal fire ellipse is widest about arccos(e) off the wind axis, only ~10°
 * at L/B ≈ 5.7, and the old 16-neighbour kernel's nearest direction there was 26.6°, which made
 * wind-driven fires ~35% too narrow. Radius 5 adds directions at 11.3° and 14.0° and brings the burnt
 * shape within a few percent of the model ellipse (reference.test.ts).
 */
export function makeKernel(radius: number): [number, number][] {
  const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
  const k: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if ((dx !== 0 || dy !== 0) && gcd(dx, dy) === 1) k.push([dx, dy]);
  }
  return k;
}

const KERNEL = makeKernel(5);

// slopeFactor saturates at ±20°, so a table over rise/run ∈ [−tan 20°, tan 20°] covers every edge
const TAN_MAX = Math.tan((20 * Math.PI) / 180), SLOPE_BINS = 4096;
const SLOPE_LUT = Float64Array.from({ length: SLOPE_BINS + 1 }, (_, i) =>
  slopeFactor((Math.atan(-TAN_MAX + (2 * TAN_MAX * i) / SLOPE_BINS) * 180) / Math.PI));
function slopeLookup(riseOverRun: number): number {
  const u = (riseOverRun + TAN_MAX) / (2 * TAN_MAX);
  return SLOPE_LUT[u <= 0 ? 0 : u >= 1 ? SLOPE_BINS : Math.round(u * SLOPE_BINS)]!;
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number): void {
    const { k, v } = this;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      k[i] = k[p]!; v[i] = v[p]!; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): [number, number] {
    const { k, v } = this;
    const topK = k[0]!, topV = v[0]!;
    const lastK = k.pop()!, lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1]! < k[c]!) c++;
        if (k[c]! >= lastK) break;
        k[i] = k[c]!; v[i] = v[c]!; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return [topK, topV];
  }
}

/** Minimum-travel-time fire spread: each edge takes distance / directional rate of spread. */
export function computeSpread(input: SpreadInput): SpreadResult {
  const { terrain: t, weather, windToDeg, fuelLoadTha, ignitions } = input;
  const { width: W, height: H, cellSizeM: cs, elevation: z } = t;
  const fdi = ffdi(weather);
  const headMperMin = (headRateOfSpread(fdi, fuelLoadTha) * 1000) / 60;
  const windRad = (windToDeg * Math.PI) / 180;
  // grid x = east, grid y = south; bearing from north clockwise: east=(sin), north=(cos)
  const arrival = new Float64Array(W * H).fill(Infinity);
  const heap = new MinHeap();
  for (const ig of ignitions) {
    const i = ig.y * W + ig.x;
    if (ig.x < 0 || ig.y < 0 || ig.x >= W || ig.y >= H) continue;
    arrival[i] = 0;
    heap.push(0, i);
  }
  const dist = KERNEL.map(([dx, dy]) => Math.hypot(dx, dy) * cs);
  const invDist = dist.map((d) => 1 / d);
  // angle between each kernel direction and the wind; direction bearing = atan2(dx, -dy)
  const phi = KERNEL.map(([dx, dy]) => Math.atan2(dx, -dy) - windRad);
  const dirRate = KERNEL.map((_, n) => directionalSpread(headMperMin, weather.wind, phi[n]!));

  while (heap.size > 0) {
    const [tm, idx] = heap.pop();
    if (tm > arrival[idx]!) continue;
    const x = idx % W, y = (idx / W) | 0;
    for (let n = 0; n < KERNEL.length; n++) {
      const nx = x + KERNEL[n]![0], ny = y + KERNEL[n]![1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      const rate = dirRate[n]! * slopeLookup((z[j]! - z[idx]!) * invDist[n]!); // m/min
      if (rate <= 1e-6) continue;
      const nt = tm + dist[n]! / rate;
      if (nt < arrival[j]!) { arrival[j] = nt; heap.push(nt, j); }
    }
  }
  return { arrival, ffdi: fdi, headMperMin };
}
