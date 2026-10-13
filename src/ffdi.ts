/** McArthur Mk5 forest fire danger (Noble, Bary & Gill 1980). */
export interface Weather {
  /** air temperature, °C */
  temp: number;
  /** relative humidity, % */
  humidity: number;
  /** 10 m open wind speed, km/h */
  wind: number;
  /** drought factor, 0–10 */
  drought: number;
}

export function ffdi(w: Weather): number {
  const df = Math.min(10, Math.max(0.01, w.drought));
  return 2 * Math.exp(-0.45 + 0.987 * Math.log(df) - 0.0345 * w.humidity + 0.0338 * w.temp + 0.0234 * w.wind);
}

export function ffdiCategory(v: number): string {
  if (v >= 100) return "Catastrophic";
  if (v >= 75) return "Extreme";
  if (v >= 50) return "Severe";
  if (v >= 25) return "Very high";
  if (v >= 12) return "High";
  return "Low–moderate";
}

/** Mk5 forest head-fire rate of spread on flat ground, km/h: R = 0.0012 · FFDI · w (w = fuel load, t/ha). */
export function headRateOfSpread(fdi: number, fuelLoadTha: number): number {
  return 0.0012 * fdi * fuelLoadTha;
}

/** McArthur slope rule of thumb: spread doubles per 10° upslope and halves per 10° downslope, with slope capped at ±20°. */
export function slopeFactor(slopeDeg: number): number {
  const s = Math.min(20, Math.max(-20, slopeDeg));
  return Math.pow(2, s / 10);
}

/**
 * Length-to-breadth ratio of a point-ignition fire ellipse, from the 10 m open wind speed (km/h).
 *
 * L/B = 1 + 8.729·(1 − e^(−0.030·U))^2.155: Equation 79 of the Canadian Fire Behavior Prediction System
 * (Forestry Canada Fire Danger Group 1992, ST-X-3), fitted to Alexander's (1985) forest-fire shapes.
 * Australian systems have no widely used eucalypt-forest L/B relation; CSIRO's Spark elliptical template
 * points to Alexander (1985) for this ratio. The fit saturates near 9.7 instead of growing without bound,
 * and gives L/B ≈ 5.7 at 46 km/h, close to the L:B of 5 mapped for the Kilmore East fire in dry
 * sclerophyll forest at that wind (Cruz et al. 2012); see reference.ts.
 */
export function lengthToBreadth(windKmh: number): number {
  const u = Math.max(0, windKmh);
  return 1 + 8.729 * Math.pow(1 - Math.exp(-0.03 * u), 2.155);
}

/**
 * Rate of spread (m/min) at angle `phi` (rad) from the wind direction, for an ellipse with the ignition at a focus.
 * R(φ) = R_head (1 − e) / (1 − e cos φ), e = sqrt(1 − 1/LB²).
 */
export function directionalSpread(headMperMin: number, windKmh: number, phi: number): number {
  const lb = lengthToBreadth(windKmh);
  const e = Math.sqrt(1 - 1 / (lb * lb));
  return (headMperMin * (1 - e)) / (1 - e * Math.cos(phi));
}
