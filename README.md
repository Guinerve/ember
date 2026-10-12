# ember

> Bushfire spread on real Canberra terrain, in the browser.

**Status:** v0.1 core built (model verified; UI not yet visually checked in a browser) · Portfolio project #10 · see `../README.md`

## The idea

A cellular-automaton fire model using McArthur Mk5 forest fire danger and rate-of-spread equations, real slope from a Geoscience Australia elevation tile around the Brindabellas, and wind and fuel sliders. Links naturally to the High-Distinction bushfire capstone.

## Stack

TypeScript, Vite, Canvas/WebGL, Vitest; Python for DEM preprocessing.

Dev server binds to `0.0.0.0` on port **5194** so it's reachable over Tailscale (`vite --host 0.0.0.0 --port 5194 --strictPort`). Deploy to GitHub Pages.

## Build plan (v1)

- [ ] (partly done) Preprocess an elevation tile (`scripts/fetch_dem.py`): done with **AWS Terrain Tiles (SRTM-derived)**, not ELVIS. 384×384 grid, ~62 m cells, 439–1600 m relief, west of Canberra. Swap in an ELVIS tile later. into a compact slope/aspect grid
- [x] McArthur Mk5 FFDI and rate of spread, with slope correction
- [x] Cellular spread with wind direction and fuel load (minimum-travel-time over a 16-neighbour kernel, elliptical wind shape, per-edge slope from the DEM) direction and fuel load
- [x] Sliders: temperature, humidity, wind speed/direction, drought factor, fuel load
- [x] Click to ignite; time-lapse playback; time-lapse playback

## Run it

```bash
npm install
uv run scripts/fetch_dem.py   # only to regenerate public/dem.bin
npm run dev                    # http://0.0.0.0:5194
npm test                       # 13 tests
```

## How I know it's right

13 unit tests pass (`src/ffdi.test.ts`, `src/spread.test.ts`):

- FFDI equals the Noble et al. (1980) formula for hand-computed inputs (DF 10, T 40 °C, RH 10 %, wind 60 km/h → ~138) and is monotonic in each input.
- Hillshade: a north-west-facing slope is lit and a south-east-facing one is dark (a review found the light was coming from the north-east; fixed, with a regression test).
- Play uses a float clock, so it also works on 120 Hz screens (a `step=1` slider had been rounding the increments away).
- Slope rule: ×2 per 10° up, ×0.5 per 10° down, capped at ±20°.
- **Flat ground, no wind**: arrival times are identical under reflection and 90° rotation; 20 cells east takes exactly `distance / rate`; the diagonal is within 4 % of the Euclidean ideal.
- Wind from the west makes the head more than 3× faster than the back; uphill is more than 4× faster than downhill on a ~17° slope.
- Full 384×384 solve takes ~160 ms in Node, so sliders recompute live. Default scenario (FFDI 51, head 12 m/min) burns ~98 ha in 6 h.

**Not yet done:** the README asks for "published worked examples". The FFDI tests are hand calculations of the published formula, not values copied from a published table. Find a table in the CSIRO/BoM material and add it.

## Limits

The L/B ratio `1 + 0.125·U` is a simple placeholder, not a published forest relationship. Rate of spread assumes uniform fuel.

**Educational model, not an operational prediction tool.** No spotting, fuel moisture dynamics or suppression.

## Next (tomorrow)

- Look at it in a browser. The canvas hillshade and fire colours are untested by eye.
- Replace the placeholder L/B relationship; add published FFDI table values to the tests.
- ELVIS tile in place of the SRTM-derived one.

## Stretch

Overlay a historical fire perimeter for a qualitative comparison.

## Definition of done

- [ ] Hero GIF or screenshot at the top of this README
- [x] Live demo link or one-command run (`npm install && npm run dev`)
- [ ] "How I know it's right" section filled in with real results
- [ ] Tests passing in CI, badge added
- [ ] "Limits" section written
- [ ] Licence chosen, repo description and topics set
- [ ] Pinned on GitHub profile and added to guinerve.github.io
- [ ] Added to `career-radar/data/cv/portfolio.json`
