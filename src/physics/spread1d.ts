/**
 * Rate of spread from an energy balance on the fuel bed, driven by flame radiation.
 *
 * A front moving at R (m s⁻¹) consumes w kg of fine fuel per m² of ground, and each kilogram has to be
 * heated to ignition first, costing Q_ig J kg⁻¹ (sensible heat plus drying). That energy has to come
 * from somewhere. Here it is the radiant power the flame puts into the unburnt bed ahead, per metre of
 * fire line:
 *
 *   R · w · Q_ig = α ∫₀^∞ q_top(x) dx + α q_face δ
 *
 * q_top is the flux onto the top of the bed at distance x ahead of the fire line, from the view-factor
 * integral in radiation.ts, so the flame's lean and size enter only through the cosθ₁ cosθ₂ / πr²
 * geometry. q_face δ is radiation from the burning bed through the bed's own leading face (depth δ).
 *
 * This is the conservation-of-energy idea behind Frandsen (1971) and Rothermel (1972), with radiation as
 * the only heating path. With `losses` on, the warming bed also gives heat back: it re-radiates
 * (ε σ (T⁴ − T_a⁴)) and is cooled by the air (h (T − T_a)), so the balance becomes an equation along x,
 *
 *   R w de/dx = −[α q_top(x) − ε σ (T⁴ − T_a⁴) − h (T − T_a)],   e(∞) = 0,
 *
 * where e is the heat taken up per kg of fuel, and R is the speed at which e(0) plus the face term just
 * reaches Q_ig. Below a critical flux the bed never gets there and radiation cannot carry the fire.
 * Flame-contact convection is left out on purpose; it matters a great deal in wind (Finney et al. 2015).
 * Treat the output as "how fast radiation alone could carry the fire", not a forecast.
 *
 * With `closeFlame`, flame length is not an input: it follows from the fire's own intensity through
 * Byram's (1959) correlation L = 0.0775 I^0.46 (I in kW m⁻¹), with I = H·w·R. Faster spread makes a
 * longer flame, which radiates more and drives faster spread; the fixed point of that loop is the answer.
 */
import { heatOfPreignition, surfaceToVolume, type ParticleParams } from "./particle";
import { froudeTilt, radiantFlux, SIGMA, type Flame } from "./radiation";

/** Heat yield of fine eucalypt fuel, J kg⁻¹ (the value used with Mk5 in CSIRO's AMICUS model library). */
export const HEAT_YIELD = 18.6e6;

export interface BedSpreadInput {
  /** flame temperature, K */
  flameK: number;
  flameEmissivity: number;
  /** flame length, m (ignored when closeFlame is true) */
  flameLengthM: number;
  /** wind at flame height, m s⁻¹; sets the flame's lean via the Froude scaling */
  windMs: number;
  /** override the lean (rad); otherwise it comes from the wind */
  tiltRad?: number;
  /** fine fuel load, kg m⁻² */
  fuelLoad: number;
  /** fuel bed depth, m */
  bedDepthM: number;
  /** ignition temperature of the fuel, K (from the pyrolysis kinetics) */
  ignitionK: number;
  particle: ParticleParams;
  closeFlame: boolean;
  /** include re-radiation and convective cooling of the heated bed */
  losses: boolean;
  /** convective cooling coefficient of the bed surface, W m⁻² K⁻¹ */
  bedCoolingH?: number;
}

export interface BedSpreadResult {
  rateMs: number;
  flame: Flame;
  /** radiant power absorbed through the bed top, W per m of fire line */
  powerTop: number;
  /** radiant power absorbed through the bed's leading face, W m⁻¹ */
  powerFace: number;
  /** power the heated bed loses again by re-radiation and convection, W m⁻¹ */
  powerLost: number;
  /** "ok", or "none" when radiation cannot bring the bed to ignition at any speed */
  status: "ok" | "none";
  /** energy to bring a kg of fuel to ignition, J kg⁻¹ */
  qIg: number;
  /** Byram fireline intensity, kW m⁻¹ */
  intensityKWm: number;
  /** flux onto the bed top, [x m, q W m⁻²] */
  profile: [number, number][];
  /** steady preheating temperature of the bed ahead, [x m, T K] (water held at 100 °C while it boils off) */
  preheat: [number, number][];
  iterations: number;
}

/** Sample points dense near the fire line, where the flux changes fastest. */
function stations(xMax: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(0.005 + xMax * Math.pow(i / (n - 1), 2.2));
  return out;
}

/** Flux onto the bed top along the fire's axis, for an effectively infinite fire line. */
export function bedProfile(flame: Flame, bedDepthM: number, n = 90): [number, number][] {
  const xMax = Math.max(60, 12 * flame.length);
  const f = { ...flame, width: 4000 };
  return stations(xMax, n).map((x) => [x, radiantFlux(f, [x, 0, bedDepthM], [0, 0, 1], { ns: 30 })]);
}

/** Trapezoid integral of q dx, plus an analytic tail (flux falls off as 1/x² far from a finite flame). */
export function integrateProfile(profile: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < profile.length; i++) {
    const [x0, q0] = profile[i - 1]!, [x1, q1] = profile[i]!;
    s += 0.5 * (q0 + q1) * (x1 - x0);
  }
  const [xe, qe] = profile[profile.length - 1]!;
  return s + qe * xe;
}

export function solveBedSpread(input: BedSpreadInput): BedSpreadResult {
  const p = input.particle;
  const qIg = heatOfPreignition(p, input.ignitionK);
  const energyPerArea = input.fuelLoad * qIg; // J per m² of ground
  const faceFlux = input.flameEmissivity * SIGMA * input.flameK ** 4;
  const powerFace = p.absorptivity * faceFlux * input.bedDepthM;

  const C_W = 4186, L_V = 2.257e6, BOIL = 373.15;
  const Ta = p.ambientK;
  const cWet = p.cp + p.moisture * C_W;
  const eBoil = cWet * (BOIL - Ta), eDry = eBoil + p.moisture * L_V;
  const tempOf = (e: number) => (e < eBoil ? Ta + e / cWet : e < eDry ? BOIL : BOIL + (e - eDry) / p.cp);
  const h = input.bedCoolingH ?? 15;
  const loss = (T: number) => (input.losses ? p.emissivity * SIGMA * (T ** 4 - Ta ** 4) + h * (T - Ta) : 0);

  // Radiation from the burning bed enters the unburnt bed through its leading face and is absorbed within
  // about one extinction length λ = 4 / (σ β) (σ: surface-to-volume ratio, β: packing ratio). It is spread
  // over at least 2δ so no strip of bed sees the face with a view factor above ½; packing it tighter
  // would let the bed outshine the flame, which the second law forbids.
  const packing = input.fuelLoad / input.bedDepthM / p.density;
  const lambda = Math.max(2 * input.bedDepthM, 4 / (surfaceToVolume(p) * packing));
  const faceSource = (x: number) => (x < lambda ? (p.absorptivity * faceFlux * input.bedDepthM) / lambda : 0);

  /**
   * March from far ahead to the fire line at speed R; returns e(0) and the preheating profile.
   * Each step is implicit (backward Euler, solved by bisection), so it stays stable at any R; at very
   * slow speeds it settles onto the local balance α q = losses, which is the physically right limit.
   */
  const march = (profile: [number, number][], R: number, keep: boolean) => {
    const Rw = R * input.fuelLoad;
    const out: [number, number][] = [];
    const [xe, qe] = profile[profile.length - 1]!;
    let e = Math.min(qIg * 0.05, (p.absorptivity * qe * xe) / Rw); // weak far-field tail
    let lost = 0;
    if (keep) out.push([xe, tempOf(e)]);
    for (let i = profile.length - 1; i > 0; i--) {
      const [x1, q1] = profile[i]!, [x0, q0] = profile[i - 1]!;
      const n = x0 < lambda ? Math.max(1, Math.ceil((x1 - x0) / (lambda / 6))) : 1;
      const hdx = (x1 - x0) / n;
      for (let k = 0; k < n; k++) {
        const w = (k + 0.5) / n;
        const xm = x1 - (x1 - x0) * w;
        const gain = p.absorptivity * (q1 + (q0 - q1) * w) + faceSource(xm);
        const c = hdx / Rw;
        let lo = 0, hi = e + c * gain;
        for (let it = 0; it < 36; it++) {
          const mid = 0.5 * (lo + hi);
          if (mid - e - c * (gain - loss(tempOf(mid))) > 0) hi = mid; else lo = mid;
        }
        lost += loss(tempOf(lo)) * hdx;
        e = lo;
      }
      if (keep) out.push([x0, tempOf(e)]);
    }
    return { e0: e, lost, preheat: out.reverse() };
  };

  const solveR = (profile: [number, number][]) => {
    const absorbed = p.absorptivity * integrateProfile(profile);
    const lossless = (absorbed + powerFace) / energyPerArea;
    if (!input.losses) return { rateMs: lossless, absorbed, ok: true };
    // e0(R) falls as R rises; losses only slow the fire, so the answer lies below the lossless rate
    let lo = 1e-6, hi = lossless;
    if (march(profile, lo, false).e0 < qIg) return { rateMs: 0, absorbed, ok: false };
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      if (march(profile, mid, false).e0 >= qIg) lo = mid; else hi = mid;
    }
    return { rateMs: lo, absorbed, ok: true };
  };

  const evaluate = (L: number) => {
    const flame: Flame = {
      length: L, width: 4000, tempK: input.flameK, emissivity: input.flameEmissivity,
      tiltRad: input.tiltRad ?? froudeTilt(input.windMs, L),
    };
    const profile = bedProfile(flame, input.bedDepthM);
    const r = solveR(profile);
    return { flame, profile, powerTop: r.absorbed, rateMs: r.rateMs, ok: r.ok };
  };

  let L = Math.max(0.1, input.flameLengthM);
  let r = evaluate(L), iterations = 1;
  if (input.closeFlame) {
    for (; iterations < 60 && r.ok; iterations++) {
      const I = (HEAT_YIELD * input.fuelLoad * r.rateMs) / 1000;
      const Lnew = Math.max(0.05, 0.0775 * Math.pow(I, 0.46));
      if (Math.abs(Lnew - L) < 1e-3 * L) { L = Lnew; break; }
      L = 0.5 * (L + Lnew); // damped: the loop converges, but can overshoot
      r = evaluate(L);
    }
    r = evaluate(L);
  }
  const intensityKWm = (HEAT_YIELD * input.fuelLoad * r.rateMs) / 1000;
  const m = march(r.profile, Math.max(r.rateMs, 1e-6), true);
  return {
    rateMs: r.rateMs, status: r.ok ? "ok" : "none", flame: r.flame, powerTop: r.powerTop, powerFace,
    powerLost: input.losses && r.ok ? m.lost : 0, qIg, intensityKWm, profile: r.profile, preheat: m.preheat, iterations,
  };
}
