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

// 16-neighbour kernel (the 8 neighbours plus the 8 knight moves) keeps burn shapes close to true ellipses.
const KERNEL: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
];

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
      const slopeDeg = (Math.atan2(z[j]! - z[idx]!, dist[n]!) * 180) / Math.PI;
      const rate = dirRate[n]! * slopeFactor(slopeDeg); // m/min
      if (rate <= 1e-6) continue;
      const nt = tm + dist[n]! / rate;
      if (nt < arrival[j]!) { arrival[j] = nt; heap.push(nt, j); }
    }
  }
  return { arrival, ffdi: fdi, headMperMin };
}
