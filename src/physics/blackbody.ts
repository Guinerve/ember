/**
 * The colour of a hot body, from Planck's law. Used to paint flames in the colour their temperature
 * actually produces (a 1090 K flame is a deep orange-red, not the yellow of a candle tip).
 *
 * Spectrum → CIE 1931 XYZ via the multi-lobe Gaussian fits of Wyman, Sloan & Shirley (2013),
 * → linear sRGB (D65) → gamma-encoded sRGB, normalised so the brightest channel is 1.
 */
const H = 6.62607015e-34, C = 2.99792458e8, KB = 1.380649e-23;

/** Spectral radiance B(λ, T), W sr⁻¹ m⁻³. */
export function planck(lambdaM: number, tempK: number): number {
  return (2 * H * C * C) / (lambdaM ** 5 * (Math.exp((H * C) / (lambdaM * KB * tempK)) - 1));
}

/** Wavelength of peak emission, m (Wien's displacement law). */
export function wienPeak(tempK: number): number {
  return 2.897771955e-3 / tempK;
}

const g = (x: number, mu: number, s1: number, s2: number) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};
const xBar = (l: number) => 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2);
const yBar = (l: number) => 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1);
const zBar = (l: number) => 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8);

const gamma = (u: number) => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055);

/** sRGB colour (0–1 per channel, brightest channel = 1) of a blackbody at `tempK`. */
export function blackbodyRGB(tempK: number): [number, number, number] {
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const b = planck(l * 1e-9, tempK);
    X += b * xBar(l); Y += b * yBar(l); Z += b * zBar(l);
  }
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let gr = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let bl = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  r = Math.max(0, r); gr = Math.max(0, gr); bl = Math.max(0, bl);
  const m = Math.max(r, gr, bl) || 1;
  return [gamma(r / m), gamma(gr / m), gamma(bl / m)];
}

export function blackbodyCss(tempK: number): string {
  const [r, g2, b] = blackbodyRGB(tempK);
  return `rgb(${Math.round(r * 255)} ${Math.round(g2 * 255)} ${Math.round(b * 255)})`;
}
