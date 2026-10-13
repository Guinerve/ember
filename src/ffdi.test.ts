import { describe, expect, it } from "vitest";
import { directionalSpread, ffdi, ffdiCategory, headRateOfSpread, lengthToBreadth, slopeFactor } from "./ffdi";

describe("McArthur Mk5 FFDI", () => {
  // Values computed by hand from FFDI = 2·exp(−0.45 + 0.987·ln DF − 0.0345·H + 0.0338·T + 0.0234·V).
  it("matches a hand calculation: DF=10, T=40, H=10, V=60 → ≈138", () => {
    const v = ffdi({ drought: 10, temp: 40, humidity: 10, wind: 60 });
    expect(v).toBeCloseTo(2 * Math.exp(-0.45 + 0.987 * Math.log(10) - 0.345 + 1.352 + 1.404), 6);
    expect(v).toBeGreaterThan(130);
    expect(v).toBeLessThan(145);
  });
  it("is monotonic in each input", () => {
    const base = { drought: 6, temp: 30, humidity: 30, wind: 30 };
    const f0 = ffdi(base);
    expect(ffdi({ ...base, temp: 35 })).toBeGreaterThan(f0);
    expect(ffdi({ ...base, wind: 40 })).toBeGreaterThan(f0);
    expect(ffdi({ ...base, drought: 8 })).toBeGreaterThan(f0);
    expect(ffdi({ ...base, humidity: 40 })).toBeLessThan(f0);
  });
  it("categories follow the 2010 rating bands", () => {
    expect(ffdiCategory(5)).toBe("Low to moderate");
    expect(ffdiCategory(30)).toBe("Very high");
    expect(ffdiCategory(60)).toBe("Severe");
    expect(ffdiCategory(80)).toBe("Extreme");
    expect(ffdiCategory(120)).toBe("Catastrophic");
  });
  it("rate of spread R = 0.0012·FFDI·w", () => {
    expect(headRateOfSpread(50, 12)).toBeCloseTo(0.72, 10); // km/h
  });
});

describe("slope and wind shaping", () => {
  it("slope factor doubles per 10° up, halves per 10° down, capped at ±20°", () => {
    expect(slopeFactor(10)).toBeCloseTo(2, 10);
    expect(slopeFactor(-10)).toBeCloseTo(0.5, 10);
    expect(slopeFactor(45)).toBeCloseTo(4, 10);
  });
  it("no wind gives a circle; strong wind gives a head faster than the back", () => {
    expect(lengthToBreadth(0)).toBe(1);
    expect(directionalSpread(10, 0, 0)).toBeCloseTo(10, 10);
    expect(directionalSpread(10, 0, Math.PI)).toBeCloseTo(10, 10);
    expect(directionalSpread(10, 40, 0)).toBeCloseTo(10, 10);
    expect(directionalSpread(10, 40, Math.PI)).toBeLessThan(2);
  });
});
