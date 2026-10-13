/**
 * One fine fuel particle (a leaf or a twig) heated by a fire: heating, drying, pyrolysis, ignition.
 *
 * The particle is thermally thin: thin enough that its temperature is uniform through its thickness
 * (Biot number hd/k ≪ 1, true for sub-millimetre leaves). Energy per unit particle volume:
 *
 *   ρ (c + M c_w) dT/dt = S_abs·α·q_rad + S_loss·[ h (T_gas − T) − ε σ (T⁴ − T_amb⁴) ]
 *
 * S_abs and S_loss are absorbing and exposed surface per unit volume:
 *   leaf of thickness t, one face towards the flame:  S_abs = 1/t,       S_loss = 2/t
 *   twig of diameter d, lit from one side:            S_abs = 4/(π d),   S_loss = 4/d
 * While water remains, the particle sits at 100 °C and the net heat evaporates water instead.
 * Pyrolysis then follows the Arrhenius law in pyrolysis.ts. The particle "ignites" when the
 * flammable-gas flux leaving its surface reaches a critical value for piloted ignition (~1–4 g m⁻² s⁻¹,
 * Lyon & Quintiere 2007), with a flame there to light it.
 */
import { convectionCoefficient, type ParticleShape } from "./convection";
import { arrheniusRate, temperatureForRate } from "./pyrolysis";
import { SIGMA } from "./radiation";

const C_WATER = 4186; // J kg⁻¹ K⁻¹
const L_VAP = 2.257e6; // J kg⁻¹
const T_BOIL = 373.15;

export interface ParticleParams {
  shape: ParticleShape;
  /** leaf thickness or twig diameter, m */
  thicknessM: number;
  /** leaf chord in the flow, m (leaves only; sets the convective length) */
  chordM: number;
  /** oven-dry particle density, kg m⁻³ */
  density: number;
  /** dry specific heat, J kg⁻¹ K⁻¹ */
  cp: number;
  /** moisture content, fraction of dry mass */
  moisture: number;
  absorptivity: number;
  emissivity: number;
  charYield: number;
  /** critical volatile mass flux for piloted ignition, kg m⁻² s⁻¹ */
  critMassFlux: number;
  ambientK: number;
}

export const DEFAULT_PARTICLE: ParticleParams = {
  shape: "leaf",
  thicknessM: 0.0003,
  chordM: 0.015,
  density: 600,
  cp: 1500,
  moisture: 0.05,
  absorptivity: 0.9,
  emissivity: 0.9,
  charYield: 0.2,
  critMassFlux: 0.002,
  ambientK: 303.15,
};

export interface Exposure {
  /** incident radiant flux on the particle's lit face, W m⁻² */
  qRad: number;
  /** temperature of the gas around the particle, K */
  gasK: number;
  /** gas speed past the particle, m s⁻¹ */
  gasSpeed: number;
}

export interface ParticleState {
  t: number;
  tempK: number;
  /** remaining moisture, fraction of dry mass */
  moisture: number;
  /** remaining dry mass fraction (1 → char yield) */
  y: number;
  /** flammable-gas flux from the surface, kg m⁻² s⁻¹ */
  volatileFlux: number;
  /** heat flux terms per unit exposed surface, W m⁻² (positive = heating) */
  qRadAbs: number;
  qConv: number;
  qReradiation: number;
}

function geometry(p: ParticleParams) {
  const d = p.thicknessM;
  return p.shape === "leaf"
    ? { sAbs: 1 / d, sLoss: 2 / d, hLength: p.chordM }
    : { sAbs: 4 / (Math.PI * d), sLoss: 4 / d, hLength: d };
}

/** Surface-area-to-volume ratio, m⁻¹ (what fire scientists call σ). */
export function surfaceToVolume(p: ParticleParams): number {
  return geometry(p).sLoss;
}

export interface ParticleRun {
  states: ParticleState[];
  /** time of ignition, s, or null */
  tIgnition: number | null;
  ignition: ParticleState | null;
  /** time water was gone, s, or null */
  tDry: number | null;
}

/**
 * Integrate a particle under an exposure that may change with time. Explicit Heun (RK2) on temperature
 * with a step limited to a fraction of the thermal time constant; pyrolysis is advanced exactly over
 * each step at the mid-step temperature.
 */
export function heatParticle(
  p: ParticleParams,
  exposure: (t: number, s: ParticleState) => Exposure,
  opts: { tMax: number; stopAtIgnition?: boolean; recordEvery?: number; dtMax?: number },
): ParticleRun {
  const g = geometry(p);
  const rec = opts.recordEvery ?? 0.25;
  const dtMax = opts.dtMax ?? 0.25;
  let s: ParticleState = { t: 0, tempK: p.ambientK, moisture: p.moisture, y: 1, volatileFlux: 0, qRadAbs: 0, qConv: 0, qReradiation: 0 };
  const states: ParticleState[] = [s];
  let nextRec = rec, tIgnition: number | null = null, ignition: ParticleState | null = null;
  let tDry: number | null = p.moisture <= 0 ? 0 : null;
  const volumePerLossArea = 1 / g.sLoss;

  const fluxes = (T: number, ex: Exposure) => {
    const h = convectionCoefficient(p.shape, g.hLength, ex.gasSpeed, T, ex.gasK);
    const qRadAbs = (g.sAbs / g.sLoss) * p.absorptivity * ex.qRad; // per unit exposed surface
    const qConv = h * (ex.gasK - T);
    const qReradiation = -p.emissivity * SIGMA * (T ** 4 - p.ambientK ** 4);
    return { qRadAbs, qConv, qReradiation, net: qRadAbs + qConv + qReradiation, h };
  };

  while (s.t <= opts.tMax) {
    const ex = exposure(s.t, s);
    const f = fluxes(s.tempK, ex);
    const heatCap = p.density * (p.cp + s.moisture * C_WATER) * volumePerLossArea; // J m⁻² K⁻¹
    const tau = heatCap / (f.h + 4 * p.emissivity * SIGMA * s.tempK ** 3 + 1e-9);
    const dt = Math.min(dtMax, 0.2 * tau);

    let T = s.tempK, M = s.moisture;
    if (M > 0 && T >= T_BOIL - 1e-9 && f.net > 0) {
      // drying plateau: all net heat goes into evaporating water
      M = Math.max(0, M - (f.net * dt) / (p.density * volumePerLossArea * L_VAP));
      T = T_BOIL;
      if (M === 0 && tDry === null) tDry = s.t + dt;
    } else {
      const k1 = f.net / heatCap;
      const T1 = T + dt * k1;
      const f2 = fluxes(T1, exposure(s.t + dt, s));
      T = T + 0.5 * dt * (k1 + f2.net / heatCap);
      if (M > 0 && T > T_BOIL) T = T_BOIL; // land on the plateau
    }
    const kMid = arrheniusRate(0.5 * (s.tempK + T));
    const y = p.charYield + (s.y - p.charYield) * Math.exp(-kMid * dt);
    const volatileFlux = (p.density * volumePerLossArea * (s.y - y)) / dt;
    s = { t: s.t + dt, tempK: T, moisture: M, y, volatileFlux, qRadAbs: f.qRadAbs, qConv: f.qConv, qReradiation: f.qReradiation };

    if (s.t >= nextRec) { states.push(s); nextRec += rec; }
    if (tIgnition === null && volatileFlux >= p.critMassFlux) {
      tIgnition = s.t; ignition = s;
      states.push(s);
      if (opts.stopAtIgnition) break;
    }
  }
  return { states, tIgnition, ignition, tDry };
}

/** Energy to bring 1 kg of dry fuel from ambient to `igK`, drying its water on the way (J kg⁻¹). */
export function heatOfPreignition(p: ParticleParams, igK: number): number {
  return p.cp * (igK - p.ambientK) + p.moisture * (C_WATER * (T_BOIL - p.ambientK) + L_VAP);
}

/**
 * Ignition temperature implied by the kinetics: the temperature at which fresh (unpyrolysed) fuel gives
 * off gas at the critical flux. Volatile flux per unit surface = ρ (V/A) (1 − Y_char) k(T).
 */
export function ignitionTemperature(p: ParticleParams): number {
  const g = geometry(p);
  const k = p.critMassFlux / (p.density * (1 / g.sLoss) * (1 - p.charYield));
  return temperatureForRate(k);
}
