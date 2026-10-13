/**
 * Published reference case: the Black Saturday Kilmore East fire, 7 February 2009.
 *
 * Cruz, M.G., Sullivan, A.L., Gould, J.S., et al. (2012) Anatomy of a catastrophic wildfire: the Black
 * Saturday Kilmore East fire in Victoria, Australia. Forest Ecology and Management 284, 269–285.
 * doi:10.1016/j.foreco.2012.02.035
 *
 * Weather: Table A2, Kilmore Gap AWS, at the start of each burning period (10 m mean wind).
 * Observed spread: Table 4, average forward rate of spread per burning period.
 * Fuel: Table 3, dry sclerophyll forest with low understorey (DSFL): litter 1.10 + near-surface 0.43 +
 *   elevated 0.03 kg m⁻² = 15.6 t ha⁻¹ of fine fuel. Bark (0.51 kg m⁻²) is left out, as Mk5 uses fine fuel.
 * Drought factor 10 (Section 3.2.1). L:B of about 5 at the end of burning period 4 (Section 3.4.4).
 */
import { ffdi, headRateOfSpread, lengthToBreadth, type Weather } from "./ffdi";

export interface ReferenceCase {
  id: string;
  label: string;
  time: string;
  fuel: string;
  weather: Weather;
  fuelLoadTha: number;
  /** observed average forward spread, m/min */
  observedMperMin: number;
  /** observed length-to-breadth ratio, if reported */
  observedLB: number | null;
}

export const KILMORE_EAST: ReferenceCase[] = [
  {
    id: "bp4",
    label: "Burning period 4",
    time: "14:00 to 15:00",
    fuel: "Dry sclerophyll forest, low understorey",
    weather: { temp: 42, humidity: 10, wind: 46, drought: 10 },
    fuelLoadTha: 15.6,
    observedMperMin: 68,
    observedLB: 5,
  },
  {
    id: "bp5",
    label: "Burning period 5",
    time: "15:00 to 16:00",
    fuel: "Dry sclerophyll forest, low understorey",
    weather: { temp: 41.4, humidity: 10, wind: 63, drought: 10 },
    fuelLoadTha: 15.6,
    observedMperMin: 153,
    observedLB: null,
  },
];

export const KILMORE_SOURCE = {
  citation: "Cruz et al. (2012) Forest Ecology and Management 284, 269 to 285",
  doi: "https://doi.org/10.1016/j.foreco.2012.02.035",
};

export interface ReferenceComparison {
  ffdi: number;
  /** Mk5 head-fire rate of spread, m/min */
  mk5MperMin: number;
  /** Cruz & Alexander (2019) rule of thumb: forward spread ≈ 10% of the 10 m open wind speed, m/min */
  tenPercentMperMin: number;
  /** observed ÷ Mk5 */
  underprediction: number;
  modelLB: number;
}

export function compareReference(c: ReferenceCase): ReferenceComparison {
  const f = ffdi(c.weather);
  const mk5 = (headRateOfSpread(f, c.fuelLoadTha) * 1000) / 60;
  return {
    ffdi: f,
    mk5MperMin: mk5,
    tenPercentMperMin: (0.1 * c.weather.wind * 1000) / 60,
    underprediction: c.observedMperMin / mk5,
    modelLB: lengthToBreadth(c.weather.wind),
  };
}
