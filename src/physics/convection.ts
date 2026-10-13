/**
 * Convective and conductive heat transfer to fine fuel particles.
 *
 * Air properties are power-law fits to standard tables (300–1000 K, within ~8%):
 *   k(T) ≈ 0.0263 (T/300)^0.83 W m⁻¹ K⁻¹,   ν(T) ≈ 1.59×10⁻⁵ (T/300)^1.73 m² s⁻¹,   Pr ≈ 0.71.
 */

export const PR_AIR = 0.71;

export function airConductivity(tempK: number): number {
  return 0.0263 * Math.pow(Math.max(200, tempK) / 300, 0.83);
}

export function airViscosity(tempK: number): number {
  return 1.59e-5 * Math.pow(Math.max(200, tempK) / 300, 1.73);
}

/** Churchill–Bernstein (1977) average Nusselt number for a cylinder in cross-flow, valid for Re·Pr > 0.2. */
export function nusseltCylinder(re: number, pr = PR_AIR): number {
  const a = (0.62 * Math.sqrt(re) * Math.cbrt(pr)) / Math.pow(1 + Math.pow(0.4 / pr, 2 / 3), 0.25);
  return 0.3 + a * Math.pow(1 + Math.pow(re / 282000, 5 / 8), 4 / 5);
}

/** Laminar flat plate, average over length: Nu = 0.664 Re^½ Pr^⅓. */
export function nusseltPlate(re: number, pr = PR_AIR): number {
  return 0.664 * Math.sqrt(re) * Math.cbrt(pr);
}

export type ParticleShape = "leaf" | "twig";

/**
 * Convective heat-transfer coefficient (W m⁻² K⁻¹) for a fuel particle in a gas stream.
 * A leaf is a flat plate of chord `lengthM` in the flow; a twig is a cylinder of diameter `lengthM`.
 * Properties are taken at the film temperature. A natural-convection floor (vertical plate,
 * h ≈ 1.42 (ΔT/L)^¼) stops h vanishing in still air.
 */
export function convectionCoefficient(shape: ParticleShape, lengthM: number, gasSpeedMs: number, surfaceK: number, gasK: number): number {
  const film = 0.5 * (surfaceK + gasK);
  const k = airConductivity(film), nu = airViscosity(film);
  const re = (Math.max(0, gasSpeedMs) * lengthM) / nu;
  const forced = ((shape === "leaf" ? nusseltPlate(re) : nusseltCylinder(re)) * k) / lengthM;
  const natural = 1.42 * Math.pow(Math.abs(surfaceK - gasK) / lengthM + 1e-9, 0.25);
  return Math.max(forced, natural);
}

/**
 * Conduction through a fuel bed ahead of a front moving at R (m s⁻¹). For a steadily moving front the
 * conductive temperature tail decays as e^(−x/ℓ), ℓ = a/R, a = k/(ρc) the bed's thermal diffusivity.
 * The flux it can deliver at distance x is q = k ΔT / ℓ · e^(−x/ℓ). For porous litter, a ≈ 10⁻⁶ m² s⁻¹,
 * so at any realistic R the tail is a fraction of a millimetre long.
 */
export function bedConductionFlux(xM: number, rateMs: number, deltaT: number, bedConductivity = 0.1, bedDiffusivity = 2e-6): number {
  const ell = bedDiffusivity / Math.max(1e-6, rateMs);
  return ((bedConductivity * deltaT) / ell) * Math.exp(-Math.max(0, xM) / ell);
}
