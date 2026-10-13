# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "httpx"]
# ///
"""Fetch terrain tiles around the Brindabellas and write a compact elevation grid.

Source: AWS Terrain Tiles (Terrarium encoding, SRTM-derived at this latitude).
A Geoscience Australia ELVIS tile would give a finer, more recent grid.

Output: public/dem.bin (Int16 little-endian, row-major, north at top) and public/dem.json.
Run:  uv run scripts/fetch_dem.py
"""
import io
import json
import math
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

Z = 12
CENTER_LAT, CENTER_LON = -35.38, 148.80
RADIUS = 1  # tiles each side -> 3x3
DOWNSAMPLE = 2
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tile_origin(x: int, y: int, z: int) -> tuple[float, float]:
    n = 2**z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


def main() -> None:
    cx, cy = tile_xy(CENTER_LAT, CENTER_LON, Z)
    size = 256 * (2 * RADIUS + 1)
    elev = np.zeros((size, size), dtype=np.float32)
    with httpx.Client(timeout=30) as client:
        for dy in range(-RADIUS, RADIUS + 1):
            for dx in range(-RADIUS, RADIUS + 1):
                r = client.get(URL.format(z=Z, x=cx + dx, y=cy + dy))
                r.raise_for_status()
                rgb = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"), dtype=np.float32)
                tile = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
                oy, ox = (dy + RADIUS) * 256, (dx + RADIUS) * 256
                elev[oy : oy + 256, ox : ox + 256] = tile
    k = DOWNSAMPLE
    h = size // k
    elev = elev[: h * k, : h * k].reshape(h, k, h, k).mean(axis=(1, 3))

    north, west = tile_origin(cx - RADIUS, cy - RADIUS, Z)
    south, east = tile_origin(cx + RADIUS + 1, cy + RADIUS + 1, Z)
    mid_lat = (north + south) / 2
    metres_per_px_x = (east - west) * 111_320 * math.cos(math.radians(mid_lat)) / h
    metres_per_px_y = (north - south) * 110_540 / h
    cell = (metres_per_px_x + metres_per_px_y) / 2

    out = Path(__file__).resolve().parent.parent / "public"
    out.mkdir(exist_ok=True)
    elev.round().astype("<i2").tofile(out / "dem.bin")
    meta = {
        "width": h, "height": h, "cellSizeM": round(cell, 2),
        "north": north, "south": south, "west": west, "east": east,
        "minElevation": float(elev.min()), "maxElevation": float(elev.max()),
        "source": "AWS Terrain Tiles (Terrarium), zoom 12, downsampled x2",
    }
    (out / "dem.json").write_text(json.dumps(meta, indent=2))
    print(meta)


if __name__ == "__main__":
    main()
