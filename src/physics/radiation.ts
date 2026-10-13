/**
 * Radiant heat from a flame front, from first principles.
 *
 * The flame is a flat rectangular emitter (the "radiating panel" idealisation used by AS 3959): it stands
 * on the fire line, is `length` long and `width` wide, and leans forward over the unburnt fuel by `tiltRad`
 * from vertical. Coordinates: x points from the fire line into unburnt fuel, y runs along the fire line,
 * z is up. The fire line is x = 0.
 *
 * Flux arriving at a small receiving surface is q = ε σ T⁴ · F, where F is the view factor
 *   F = ∫ cosθ₁ cosθ₂ / (π r²) dA₁
 * θ₁ is the angle between the flame normal and the ray, θ₂ the angle between the receiver normal and the
 * ray. The angles are the point: flux depends on how squarely each surface faces the other, not only on
 * distance.
 */

/** Stefan–Boltzmann constant, W m⁻² K⁻⁴ (CODATA 2018, exact). */
export const SIGMA = 5.670374419e-8;
/** Standard gravity, m s⁻². */
export const G = 9.81;

export type Vec3 = [number, number, number];

/** Emissive power of a grey surface: E = ε σ T⁴ (W m⁻²). */
export function emissivePower(tempK: number, emissivity = 1): number {
  return emissivity * SIGMA * tempK ** 4;
}

export interface Flame {
  /** flame length along its axis, m */
  length: number;
  /** extent along the fire line, m */
  width: number;
  /** forward lean from vertical, radians (0 = upright, towards π/2 = lying on the fuel) */
  tiltRad: number;
  /** flame temperature, K */
  tempK: number;
  /** flame emissivity, 0–1 */
  emissivity: number;
}

/** Point on the flame surface: s ∈ [0, length] up the flame axis, y along the fire line. */
export function flamePoint(f: Flame, s: number, y: number): Vec3 {
  return [s * Math.sin(f.tiltRad), y, s * Math.cos(f.tiltRad)];
}

/** Unit normal of the flame's front face (the side facing unburnt fuel). */
export function flameNormal(f: Flame): Vec3 {
  return [Math.cos(f.tiltRad), 0, -Math.sin(f.tiltRad)];
}

/** Horizontal reach of the flame tip ahead of the fire line, m. */
export function flameReach(f: Flame): number {
  return f.length * Math.sin(f.tiltRad);
}

/**
 * Flame tilt from a Froude-number scaling: tan α = U / √(g L).
 * The wind's momentum (U) against the buoyant velocity scale (√(gL)). Laboratory correlations put a
 * coefficient of order 1–1.4 in front; we use 1, so this is a scaling estimate, not a fitted model.
 */
export function froudeTilt(windMs: number, flameLengthM: number): number {
  return Math.atan(Math.max(0, windMs) / Math.sqrt(G * Math.max(0.01, flameLengthM)));
}

export interface ViewFactorOptions {
  /** minimum number of samples up the flame (more are used close to the flame) */
  ns?: number;
  /** the flame is a thin sheet that radiates from both faces (true) or only the front face (false) */
  bothFaces?: boolean;
}

/** ∫ du / (ρ² + u²)² */
const strip = (u: number, rho2: number, rho: number) => u / (2 * rho2 * (rho2 + u * u)) + Math.atan(u / rho) / (2 * rho2 * rho);

/**
 * View factor from the flame panel to a differential receiver at `p` with unit normal `n`.
 *
 * The receiver normal must lie in the x–z plane (receivers tilt towards or away from the fire, not
 * sideways). Then, for one horizontal strip of flame at height s, cosθ₁·r and cosθ₂·r do not depend on
 * the position y along the strip, so the strip integral ∫ dy / (ρ² + y²)² is done exactly. Only the
 * integral up the flame is numerical (midpoint rule), refined automatically when the receiver is close
 * to the flame. Only parts of the flame the receiver can see (cosθ₁ > 0 and cosθ₂ > 0) count.
 */
export function viewFactor(f: Flame, p: Vec3, n: Vec3, opts: ViewFactorOptions = {}): number {
  const both = opts.bothFaces ?? true;
  const [n1x, , n1z] = flameNormal(f);
  const st = Math.sin(f.tiltRad), ct = Math.cos(f.tiltRad);
  // distance from the receiver to the flame's axis in the x–z plane sets how finely to sample up the flame
  const along = Math.min(f.length, Math.max(0, p[0] * st + p[2] * ct));
  const dmin = Math.max(1e-3, Math.hypot(p[0] - along * st, p[2] - along * ct));
  const ns = Math.min(4000, Math.max(opts.ns ?? 40, Math.ceil((6 * f.length) / dmin)));
  const ds = f.length / ns;
  const u1 = -f.width / 2 - p[1], u2 = f.width / 2 - p[1];
  let sum = 0;
  for (let i = 0; i < ns; i++) {
    const s = (i + 0.5) * ds;
    const rx = p[0] - s * st, rz = p[2] - s * ct;
    let a = n1x * rx + n1z * rz; // r·cosθ₁
    if (both) a = Math.abs(a);
    const b = -(n[0] * rx + n[2] * rz); // r·cosθ₂
    if (a <= 0 || b <= 0) continue;
    const rho2 = rx * rx + rz * rz, rho = Math.sqrt(rho2);
    sum += a * b * (strip(u2, rho2, rho) - strip(u1, rho2, rho));
  }
  return (sum * ds) / Math.PI;
}

/**
 * Exact view factor from a differential area to a parallel rectangle a × b, with the area's normal
 * passing through one corner of the rectangle at distance c (the standard closed form tabulated in Howell's catalogue of configuration factors).
 */
export function viewFactorParallelCorner(a: number, b: number, c: number): number {
  const A = a / c, B = b / c;
  const sa = Math.sqrt(1 + A * A), sb = Math.sqrt(1 + B * B);
  return (1 / (2 * Math.PI)) * ((A / sa) * Math.atan(B / sa) + (B / sb) * Math.atan(A / sb));
}

/** Radiant flux (W m⁻²) on a receiver at `p` facing `n`. No atmospheric attenuation (τ = 1). */
export function radiantFlux(f: Flame, p: Vec3, n: Vec3, opts?: ViewFactorOptions): number {
  return emissivePower(f.tempK, f.emissivity) * viewFactor(f, p, n, opts);
}

export interface RayContribution {
  /** point on the flame */
  from: Vec3;
  /** angle between flame normal and ray, rad */
  theta1: number;
  /** angle between receiver normal and ray, rad */
  theta2: number;
  /** distance, m */
  r: number;
  /** cosθ₁ cosθ₂ / (π r²): this patch's view-factor density, m⁻² */
  density: number;
}

/** Per-patch contributions to the receiver, for drawing which part of the flame heats it. */
export function contributions(f: Flame, p: Vec3, n: Vec3, ns = 16, ny = 24): RayContribution[] {
  const out: RayContribution[] = [];
  const [n1x, , n1z] = flameNormal(f);
  for (let i = 0; i < ns; i++) for (let j = 0; j < ny; j++) {
    const from = flamePoint(f, ((i + 0.5) / ns) * f.length, -f.width / 2 + ((j + 0.5) / ny) * f.width);
    const rx = p[0] - from[0], ry = p[1] - from[1], rz = p[2] - from[2];
    const r = Math.hypot(rx, ry, rz);
    const c1 = Math.abs(n1x * rx + n1z * rz) / r;
    const c2 = -(n[0] * rx + n[1] * ry + n[2] * rz) / r;
    const density = c2 > 0 ? (c1 * c2) / (Math.PI * r * r) : 0;
    out.push({ from, theta1: Math.acos(Math.min(1, c1)), theta2: Math.acos(Math.max(-1, Math.min(1, c2))), r, density });
  }
  return out;
}

/** Normal for a receiver tilted `tiltRad` from horizontal-facing-up towards facing the flame (−x). */
export function receiverNormal(tiltRad: number): Vec3 {
  return [-Math.sin(tiltRad), 0, Math.cos(tiltRad)];
}
