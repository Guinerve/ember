import type { Terrain } from "./spread";

export interface TerrainMeta {
  width: number;
  height: number;
  cellSizeM: number;
  minElevation: number;
  maxElevation: number;
  source: string;
}

function isMeta(value: unknown): value is TerrainMeta {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m.width === "number" && Number.isSafeInteger(m.width) && m.width > 0
    && typeof m.height === "number" && Number.isSafeInteger(m.height) && m.height > 0
    && typeof m.cellSizeM === "number" && Number.isFinite(m.cellSizeM) && m.cellSizeM > 0
    && typeof m.minElevation === "number" && Number.isFinite(m.minElevation)
    && typeof m.maxElevation === "number" && Number.isFinite(m.maxElevation) && m.maxElevation >= m.minElevation
    && typeof m.source === "string";
}

/** Validate the two static files before sending the terrain to the spread solver. */
export async function loadTerrain(base: string, fetcher: typeof fetch = fetch): Promise<{ meta: TerrainMeta; terrain: Terrain }> {
  const response = await fetcher(`${base}dem.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status} for terrain metadata`);
  const meta: unknown = await response.json();
  if (!isMeta(meta)) throw new Error("Invalid terrain metadata");
  const binary = await fetcher(`${base}dem.bin`);
  if (!binary.ok) throw new Error(`HTTP ${binary.status} for terrain grid`);
  const buffer = await binary.arrayBuffer();
  if (buffer.byteLength !== meta.width * meta.height * Int16Array.BYTES_PER_ELEMENT) {
    throw new Error("Terrain grid size does not match metadata");
  }
  const elevation = Float32Array.from(new Int16Array(buffer));
  return { meta, terrain: { width: meta.width, height: meta.height, cellSizeM: meta.cellSizeM, elevation } };
}

/** Grid cell under a point given as fractions (0 to 1) across and down the map, clamped to the grid. */
export function cellAt(fx: number, fy: number, width: number, height: number): { x: number; y: number } {
  const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v * n)));
  return { x: clamp(fx, width), y: clamp(fy, height) };
}
