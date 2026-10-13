import { describe, expect, it } from "vitest";
import { cellAt, loadTerrain } from "./terrain";

const meta = { width: 2, height: 2, cellSizeM: 60, minElevation: 100, maxElevation: 130, source: "test terrain" };
const samples = new Int16Array([100, 110, 120, 130]);
const server = (metadata: unknown = meta, binary: ArrayBuffer = samples.buffer): typeof fetch =>
  async (url) => String(url).endsWith("dem.json")
    ? Response.json(metadata)
    : new Response(binary);

describe("terrain loading", () => {
  it("loads the grid and metadata from the configured base path", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => { urls.push(String(url)); return server()(url, init); };
    const loaded = await loadTerrain("/ember/", fetcher);
    expect(urls).toEqual(["/ember/dem.json", "/ember/dem.bin"]);
    expect(loaded.meta).toEqual(meta);
    expect(loaded.terrain).toEqual({ width: 2, height: 2, cellSizeM: 60, elevation: Float32Array.from(samples) });
  });

  it("reports HTTP errors rather than interpreting an error page as elevation", async () => {
    await expect(loadTerrain("/", async () => new Response("missing", { status: 404 }))).rejects.toThrow("HTTP 404");
    const fetcher: typeof fetch = async (url) => String(url).endsWith("dem.json")
      ? Response.json(meta) : new Response("missing", { status: 404 });
    await expect(loadTerrain("/", fetcher)).rejects.toThrow("HTTP 404");
  });

  it.each([null, { ...meta, width: 0 }, { ...meta, height: 1.5 }, { ...meta, cellSizeM: -1 }, { ...meta, source: null }, { ...meta, minElevation: 200 }])(
    "rejects invalid grid metadata: %j", async (metadata) => {
      await expect(loadTerrain("/", server(metadata))).rejects.toThrow("Invalid terrain metadata");
    },
  );

  it("rejects truncated or mixed-build elevation data", async () => {
    await expect(loadTerrain("/", server(meta, new ArrayBuffer(6)))).rejects.toThrow("Terrain grid size");
  });
});

describe("cellAt (map clicks and typed coordinates to grid cells)", () => {
  it("maps fractions of the map to the cell under them", () => {
    expect(cellAt(0, 0, 384, 384)).toEqual({ x: 0, y: 0 });
    expect(cellAt(0.5, 0.25, 384, 384)).toEqual({ x: 192, y: 96 });
  });
  it("keeps a click on the far edge inside the grid (regression: x = 1 gave cell 384 of 0..383)", () => {
    expect(cellAt(1, 1, 384, 384)).toEqual({ x: 383, y: 383 });
    expect(cellAt(1.01, -0.01, 384, 384)).toEqual({ x: 383, y: 0 });
  });
});
