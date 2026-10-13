/**
 * Pyrolysis: the thermal breakdown of fuel into flammable gases, before anything burns.
 *
 * A single first-order Arrhenius step stands in for cellulose decomposition:
 *   dY/dt = −k(T)·(Y − Y_char),   k(T) = A·exp(−E / (R T))
 * Y is the remaining fraction of the dry mass; Y_char is what is left as char.
 *
 * E = 238 kJ mol⁻¹ is the activation energy Várhegyi, Jakab & Antal (1994) found for a single first-order
 * reaction describing cellulose pyrolysis. A is not copied from a table. It is set from E with Kissinger's
 * relation so that a 10 K/min thermogravimetric run peaks at 345 °C, the typical observed peak for
 * cellulose, and a test checks this by integrating the rate law.
 */

/** Universal gas constant, J mol⁻¹ K⁻¹. */
export const R_GAS = 8.314462618;
/** Activation energy, J mol⁻¹. */
export const E_ACT = 238e3;
/** Peak mass-loss temperature at 10 K/min used to fix A, K. */
export const TGA_PEAK_K = 618.15;
/** Heating rate of that reference run, K s⁻¹. */
export const TGA_RATE = 10 / 60;

/** Kissinger: β E / (R Tp²) = A exp(−E / (R Tp)) for a first-order reaction. */
export function kissingerPreExponential(e: number, peakK: number, rateKs: number): number {
  return ((rateKs * e) / (R_GAS * peakK * peakK)) * Math.exp(e / (R_GAS * peakK));
}

/** Pre-exponential factor, s⁻¹ (≈1.6 × 10¹⁸). */
export const A_PRE = kissingerPreExponential(E_ACT, TGA_PEAK_K, TGA_RATE);

export function arrheniusRate(tempK: number, a = A_PRE, e = E_ACT): number {
  return a * Math.exp(-e / (R_GAS * tempK));
}

/** Temperature (K) at which k(T) reaches `rate` (s⁻¹). */
export function temperatureForRate(rate: number, a = A_PRE, e = E_ACT): number {
  return e / (R_GAS * Math.log(a / rate));
}

/** Simulated thermogravimetric run: returns [T (K), Y, −dY/dt (s⁻¹)] samples from 300 K. */
export function tgaCurve(rateKs = TGA_RATE, charYield = 0.2, endK = 750, steps = 4000): [number, number, number][] {
  const out: [number, number, number][] = [];
  const dT = (endK - 300) / steps, dt = dT / rateKs;
  let y = 1;
  for (let i = 0; i <= steps; i++) {
    const t = 300 + i * dT;
    const r = arrheniusRate(t) * (y - charYield);
    out.push([t, y, r]);
    // exact update over the step at fixed T keeps this stable at any step size
    y = charYield + (y - charYield) * Math.exp(-arrheniusRate(t + dT / 2) * dt);
  }
  return out;
}
