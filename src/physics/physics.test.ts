import { describe, expect, it } from "vitest";
import { blackbodyRGB, wienPeak } from "./blackbody";
import { bedConductionFlux, convectionCoefficient } from "./convection";
import { DEFAULT_PARTICLE, heatParticle, ignitionTemperature } from "./particle";
import { A_PRE, arrheniusRate, tgaCurve, TGA_PEAK_K } from "./pyrolysis";
import { emissivePower, froudeTilt, radiantFlux, receiverNormal, SIGMA, viewFactor, viewFactorParallelCorner, type Flame } from "./radiation";
import { bedProfile, integrateProfile, solveBedSpread, type BedSpreadInput } from "./spread1d";

const flame = (over: Partial<Flame> = {}): Flame => ({ length: 10, width: 100, tiltRad: 0, tempK: 1090, emissivity: 0.95, ...over });

describe("Stefan–Boltzmann", () => {
  it("a 1000 K black body emits σT⁴ ≈ 56.7 kW/m²", () => {
    expect(emissivePower(1000)).toBeCloseTo(56703.7, 0);
  });
  it("doubling temperature multiplies emission by 16", () => {
    expect(emissivePower(1200) / emissivePower(600)).toBeCloseTo(16, 10);
  });
});

describe("view factor", () => {
  it("numerical quadrature matches the exact parallel-rectangle form", () => {
    // upright 10 m × 100 m flame, receiver facing it 5 m away at ground level, on the bottom edge's centre:
    // two corner rectangles, each 50 m × 10 m
    const exact = 2 * viewFactorParallelCorner(50, 10, 5);
    const numeric = viewFactor(flame(), [5, 0, 0], [-1, 0, 0], { ns: 200, bothFaces: false });
    expect(Math.abs(numeric / exact - 1)).toBeLessThan(0.01);
  });

  it("horizontal ground element vs an infinitely wide upright flame: F = ½(1 − x/√(x² + L²))", () => {
    const L = 8, x = 6;
    const exact = 0.5 * (1 - x / Math.hypot(x, L));
    const numeric = viewFactor(flame({ length: L, width: 4000 }), [x, 0, 0], [0, 0, 1], { ns: 200 });
    expect(Math.abs(numeric / exact - 1)).toBeLessThan(0.01);
  });

  it("a flame leaning over the fuel radiates more onto it (the angle terms, not just distance)", () => {
    const up = receiverNormal(0);
    const upright = radiantFlux(flame(), [3, 0, 0], up);
    const leaning = radiantFlux(flame({ tiltRad: (40 * Math.PI) / 180 }), [3, 0, 0], up);
    expect(leaning).toBeGreaterThan(1.8 * upright);
  });

  it("flux falls with distance and never exceeds the emissive power", () => {
    const f = flame();
    const n = receiverNormal(Math.PI / 2);
    let prev = Infinity;
    for (const x of [0.5, 2, 5, 10, 20, 40]) {
      const q = radiantFlux(f, [x, 0, 0.5], n);
      expect(q).toBeLessThan(prev);
      expect(q).toBeLessThan(emissivePower(f.tempK, f.emissivity));
      prev = q;
    }
  });

  it("Froude tilt: no wind is upright, stronger wind leans the flame further", () => {
    expect(froudeTilt(0, 5)).toBe(0);
    expect(froudeTilt(10, 5)).toBeGreaterThan(froudeTilt(5, 5));
    expect(froudeTilt(5, 20)).toBeLessThan(froudeTilt(5, 5)); // taller flames are more buoyant
  });
});

describe("convection and conduction", () => {
  it("finer particles have higher heat-transfer coefficients", () => {
    expect(convectionCoefficient("twig", 0.0005, 1, 400, 300)).toBeGreaterThan(convectionCoefficient("twig", 0.005, 1, 400, 300));
  });
  it("bed conduction is negligible a centimetre ahead of a moving front", () => {
    expect(bedConductionFlux(0.01, 0.1, 800)).toBeLessThan(1e-6);
  });
});

describe("pyrolysis kinetics", () => {
  it("a simulated 10 K/min TGA peaks at the calibration temperature (345 °C)", () => {
    const curve = tgaCurve();
    let peak = curve[0]!;
    for (const c of curve) if (c[2] > peak[2]) peak = c;
    expect(Math.abs(peak[0] - TGA_PEAK_K)).toBeLessThan(3);
    expect(A_PRE).toBeGreaterThan(1e17);
    expect(A_PRE).toBeLessThan(1e19);
  });
  it("rate rises steeply with temperature", () => {
    expect(arrheniusRate(650) / arrheniusRate(600)).toBeGreaterThan(20);
  });
});

describe("fuel particle", () => {
  const exposure = (q: number) => () => ({ qRad: q, gasK: DEFAULT_PARTICLE.ambientK, gasSpeed: 1 });

  it("holds at 100 °C while it dries, then heats further", () => {
    const run = heatParticle({ ...DEFAULT_PARTICLE, moisture: 0.3 }, exposure(60e3), { tMax: 120, recordEvery: 0.05 });
    expect(run.tDry).not.toBeNull();
    const plateau = run.states.filter((s) => s.moisture > 0 && s.moisture < 0.29);
    expect(plateau.length).toBeGreaterThan(3);
    for (const s of plateau) expect(s.tempK).toBeCloseTo(373.15, 1);
    expect(Math.max(...run.states.map((s) => s.tempK))).toBeGreaterThan(500);
  });

  it("there is a critical flux: a leaf ignites under strong radiation and not under weak", () => {
    expect(heatParticle(DEFAULT_PARTICLE, exposure(80e3), { tMax: 120 }).tIgnition).not.toBeNull();
    expect(heatParticle(DEFAULT_PARTICLE, exposure(10e3), { tMax: 600 }).tIgnition).toBeNull();
  });

  it("wetter fuel takes longer to ignite", () => {
    const dry = heatParticle({ ...DEFAULT_PARTICLE, moisture: 0.04 }, exposure(80e3), { tMax: 300 }).tIgnition!;
    const wet = heatParticle({ ...DEFAULT_PARTICLE, moisture: 0.2 }, exposure(80e3), { tMax: 300 }).tIgnition!;
    expect(wet).toBeGreaterThan(1.3 * dry);
  });

  it("energy is conserved before pyrolysis: absorbed − lost = stored heat", () => {
    const p = { ...DEFAULT_PARTICLE, moisture: 0, emissivity: 0, absorptivity: 1 };
    // no re-radiation; with gas at ambient, the particle approaches T_amb + q_abs/h
    const run = heatParticle(p, () => ({ qRad: 2000, gasK: p.ambientK, gasSpeed: 1 }), { tMax: 200 });
    const last = run.states[run.states.length - 1]!;
    expect(Math.abs(last.qRadAbs + last.qConv)).toBeLessThan(5); // W/m², steady state
  });
});

describe("spread from a radiative energy balance", () => {
  const base: BedSpreadInput = {
    flameK: 1090, flameEmissivity: 0.95, flameLengthM: 3, windMs: 0, fuelLoad: 1.56, bedDepthM: 0.04,
    ignitionK: ignitionTemperature(DEFAULT_PARTICLE), particle: DEFAULT_PARTICLE, closeFlame: false, losses: true,
  };

  it("∫ q dx onto the ground from an upright, infinitely wide flame is εσT⁴·L/2 (exact)", () => {
    const L = 5;
    const prof = bedProfile({ length: L, width: 4000, tiltRad: 0, tempK: 1090, emissivity: 1 }, 0, 400);
    expect(integrateProfile(prof) / (emissivePower(1090) * L / 2)).toBeCloseTo(1, 2);
  });

  it("closes the energy budget: R·w·Q_ig = absorbed − lost", () => {
    const lossless = solveBedSpread({ ...base, losses: false });
    expect(lossless.rateMs * base.fuelLoad * lossless.qIg).toBeCloseTo(lossless.powerTop + lossless.powerFace, 6);
    const r = solveBedSpread(base);
    const budget = r.powerTop + r.powerFace - r.powerLost;
    expect(Math.abs((r.rateMs * base.fuelLoad * r.qIg) / budget - 1)).toBeLessThan(0.02);
    expect(r.rateMs).toBeLessThan(lossless.rateMs);
  });

  it("a flame cooler than the ignition temperature can never carry the fire (second law)", () => {
    expect(solveBedSpread({ ...base, flameLengthM: 0.3, flameK: 620 }).status).toBe("none");
  });

  it("wind leans the flame over the fuel and speeds the fire up", () => {
    expect(solveBedSpread({ ...base, windMs: 4 }).rateMs).toBeGreaterThan(1.3 * solveBedSpread(base).rateMs);
  });

  it("wetter fuel and heavier fuel spread slower for the same flame", () => {
    const r0 = solveBedSpread(base).rateMs;
    expect(solveBedSpread({ ...base, particle: { ...DEFAULT_PARTICLE, moisture: 0.15 } }).rateMs).toBeLessThan(r0);
    expect(solveBedSpread({ ...base, fuelLoad: 2.5 }).rateMs).toBeLessThan(r0);
  });

  it("with Byram's flame-length closure, the loop converges to a fixed point", () => {
    const r = solveBedSpread({ ...base, closeFlame: true });
    expect(r.iterations).toBeLessThan(60);
    expect(r.flame.length).toBeCloseTo(0.0775 * Math.pow(r.intensityKWm, 0.46), 1);
  });

  it("the preheated bed reaches close to ignition temperature at the fire line", () => {
    const r = solveBedSpread({ ...base, losses: false });
    const atLine = r.preheat[0]![1];
    expect(atLine).toBeGreaterThan(base.ignitionK - 60);
    expect(atLine).toBeLessThanOrEqual(base.ignitionK + 1);
  });

  it("the kinetics put the ignition temperature of a 0.3 mm leaf near 350 °C", () => {
    expect(ignitionTemperature(DEFAULT_PARTICLE) - 273.15).toBeGreaterThan(320);
    expect(ignitionTemperature(DEFAULT_PARTICLE) - 273.15).toBeLessThan(390);
  });
});

describe("blackbody colour", () => {
  it("Wien: peak emission of a 1090 K flame is in the infrared (~2.7 µm)", () => {
    expect(wienPeak(1090) * 1e6).toBeCloseTo(2.66, 2);
  });
  it("a 1000 K body glows red-orange; 6500 K is near white", () => {
    const [r, g, b] = blackbodyRGB(1000);
    expect(r).toBeGreaterThan(g); expect(g).toBeGreaterThan(b);
    const w = blackbodyRGB(6500);
    expect(Math.min(...w)).toBeGreaterThan(0.85);
  });
  it("σ is the CODATA value", () => expect(SIGMA).toBe(5.670374419e-8));
});
