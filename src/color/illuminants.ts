// SPDX-License-Identifier: Apache-2.0

/**
 * Illuminant spectra and correlated-colour-temperature (CCT) helpers.
 *
 * - Planckian radiator: exact Planck law (BIPM Mise en pratique for the kelvin, Absolute Primary
 *   Radiometry 2018, Eq. 1, free) with the exact SI defining constants (h, c, k; BIPM SI Brochure
 *   9th ed. 2019), so c₂ = hc/k = 1.438776877…e-2 m·K (NIST CODATA 2022). Wavelength is the vacuum
 *   wavelength.
 * - CIE standard illuminant A: Planck's law relative to 560 nm with the CIE's defining constants
 *   c₂ = 1.435e-2 m·K and T = 2848 K (also CIE 15:2018 Eq. 4.1 / ISO/CIE 11664-2, paid):
 *   S_A(λ) = 100 (560/λ)^5 (exp(1.435e7/(2848·560)) − 1)/(exp(1.435e7/(2848 λ)) − 1)
 *   (≈ 2856 K with the exact c₂). Computed from the formula, not a copied table; it reproduces the
 *   free CIE 1 nm table (DOI 10.25039/CIE.DS.8jsxjrsn) to its six significant digits.
 * - CIE daylight: the CIE daylight-locus chromaticity polynomial and the M₁/M₂ weights (CIE 15:2018,
 *   paid; no free text of the formulas found). With three-decimal rounding they reproduce the free
 *   CIE D55 and D65 tables. The S₀/S₁/S₂ basis is a CIE dataset (CC BY-SA 4.0, not bundled);
 *   callers supply it.
 * - Planckian locus: the chromaticity of a Planckian radiator at T, computed by integrating Planck's
 *   law against colour-matching functions. The default uses the engine's analytic CIE 1931 fit with
 *   1 nm nodes from 360 to 830 nm (so it inherits that fit's approximation); callers may select
 *   tabulated CMFs and their own nodes. Valid 1000–100000 K.
 * - CCT from chromaticity: McCamy (1992) cubic (approximation), or a nearest-point
 *   search on the Planckian locus in the CIE 1960 UCS (CCT and signed Duv as defined in Smet et al.,
 *   LEUKOS 2023, free archival copy from the US DOE; also CIE 15:2018). Duv sign: positive above the
 *   locus (toward green), negative below (toward magenta), following Ohno, "Calculation of CCT and Duv
 *   and Practical Conversion Formulae", CORM 2011 slides (free), slide 5; the engine documents and
 *   tests it.
 * @see docs/COLORIMETRY.md for equations, coordinate/unit conventions and limits.
 */

import { approximationResult, calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import type { SpectralWavelengthRangeNanometers } from "../core/spectral.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  COLORIMETRY_MODEL_VERSION,
  integrateSampledXyz,
  prepareColorMatchingFunctions,
  prepareColorimetricSpectrum,
  sampleColorimetricBasis,
  type ColorMatchingFunctionsSource,
  type ColorimetricQuadratureNode,
  type ColorimetricSpectralSample,
  type ColorimetricSpectrum
} from "./color-matching-functions.js";
import {
  chromaticityOfUv,
  chromaticityOfXyz,
  parseChromaticity,
  requireFiniteNumber,
  requireFiniteResult,
  requirePositiveNumber,
  requireRecordValue,
  uvOfChromaticity,
  type Cie1960UvChromaticity,
  type CieXyChromaticity
} from "./colorimetry-math.js";
import { rejectUnknownFields, requireInputKeys, requireTrimmedConfigString } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { portableExpm1, portableHypot, portablePow } from "../core/portable-math.js";

/** Exact SI defining constants (BIPM SI Brochure, 9th edition, 2019). */
export const PLANCK_CONSTANT_JOULE_SECONDS = 6.62607015e-34;
export const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;
export const BOLTZMANN_CONSTANT_JOULES_PER_KELVIN = 1.380649e-23;
/** Second radiation constant c₂ = hc/k in m·K (derived from the exact constants). */
export const SECOND_RADIATION_CONSTANT_METER_KELVIN = (PLANCK_CONSTANT_JOULE_SECONDS * SPEED_OF_LIGHT_METERS_PER_SECOND) / BOLTZMANN_CONSTANT_JOULES_PER_KELVIN;
const FIRST_RADIATION_CONSTANT_RADIANCE = 2 * PLANCK_CONSTANT_JOULE_SECONDS * SPEED_OF_LIGHT_METERS_PER_SECOND ** 2;
/** The same constant with c² as one correctly rounded product (the portable evaluation below). */
const FIRST_RADIATION_CONSTANT_RADIANCE_PORTABLE = 2 * PLANCK_CONSTANT_JOULE_SECONDS * (SPEED_OF_LIGHT_METERS_PER_SECOND * SPEED_OF_LIGHT_METERS_PER_SECOND);
/**
 * The portable functions the display view's evaluations use. They are passed as an argument rather than called directly
 * from the shared code, so a bundle that never calls a portable variant (every capture) does not contain them.
 */
interface PortableOps { pow(x: number, y: number): number; expm1(x: number): number; hypot(x: number, y: number): number }
const PORTABLE: PortableOps = { pow: portablePow, expm1: portableExpm1, hypot: portableHypot };

/** Temperature range of the Planckian-locus models, K. */
export const PLANCKIAN_LOCUS_RANGE_KELVIN = /* @__PURE__ */ Object.freeze({ minimum: 1000, maximum: 100000 });
/** CIE daylight-locus validity, K. */
export const CIE_DAYLIGHT_LOCUS_RANGE_KELVIN = /* @__PURE__ */ Object.freeze({ minimum: 4000, maximum: 25000 });
/**
 * Engine limit: no CCT beyond |Duv| = 0.05, the range over which Smet et al. (2023, free) evaluate CCT
 * methods for nominally white light (CIE 15:2018 §9.5, paid, gives the same limit).
 */
export const MAX_CORRELATED_COLOR_TEMPERATURE_DUV = 0.05;

/**
 * Planck's law for blackbody spectral radiance per unit (vacuum) wavelength:
 * L(λ, T) = 2hc² / λ⁵ / (exp(hc/(λkT)) − 1). Returns W·m⁻²·sr⁻¹·nm⁻¹.
 */
export function calculatePlanckianSpectralRadiance(input: { temperatureKelvin: number; wavelengthNanometers: number }): number {
  requireInputKeys(input, "calculatePlanckianSpectralRadiance", ["temperatureKelvin", "wavelengthNanometers"]);
  const t = requirePositiveNumber(input.temperatureKelvin, "temperatureKelvin");
  const nm = requirePositiveNumber(input.wavelengthNanometers, "wavelengthNanometers");
  // foundation-10: a NaN arises only as ∞ / ∞ or 0 / 0, where λ⁵ or λT is outside the double range and the radiance tends to 0; an infinite
  // radiance is refused. The shared evaluation keeps its operation order (the capture and the display view call it).
  const radiance = planckianRadiancePerNanometer(t, nm, undefined);
  if (Number.isNaN(radiance)) return 0;
  requireFiniteResult([radiance], "calculatePlanckianSpectralRadiance");
  return radiance;
}
/**
 * Planck's law at temperature t (K) and wavelength nm. `portable` evaluates λ⁵ and e^x − 1 with the engine's portable
 * functions (`portablePow`, `portableExpm1`; within 1 and 2 ulps) instead of `**` and Math.expm1, whose last bits differ
 * between JavaScript engines (V8 12 and V8 13 differ in about 10 % of λ⁵); the display view uses it.
 */
function planckianRadiancePerNanometer(t: number, nm: number, portable: PortableOps | undefined): number {
  const lambda = nm * 1e-9;
  const exponent = SECOND_RADIATION_CONSTANT_METER_KELVIN / (lambda * t);
  // expm1 keeps precision in the Rayleigh–Jeans limit; overflow gives radiance 0.
  const radiancePerMeter = portable ? FIRST_RADIATION_CONSTANT_RADIANCE_PORTABLE / portable.pow(lambda, 5) / portable.expm1(exponent)
    : FIRST_RADIATION_CONSTANT_RADIANCE / lambda ** 5 / Math.expm1(exponent);
  return radiancePerMeter * 1e-9;
}

/** Planckian spectral radiance (W·m⁻²·sr⁻¹·nm⁻¹) as a function spectrum over the given range. */
export function createPlanckianSpectrum(input: { temperatureKelvin: number; wavelengthRangeNanometers: SpectralWavelengthRangeNanometers }): ColorimetricSpectrum {
  return planckianSpectrum(input, undefined);
}
/** Internal (not exported from the package): {@link createPlanckianSpectrum} evaluated with the portable functions (the display view). */
export function createPortablePlanckianSpectrum(input: { temperatureKelvin: number; wavelengthRangeNanometers: SpectralWavelengthRangeNanometers }): ColorimetricSpectrum {
  return planckianSpectrum(input, PORTABLE);
}
function planckianSpectrum(input: { temperatureKelvin: number; wavelengthRangeNanometers: SpectralWavelengthRangeNanometers }, portable: PortableOps | undefined): ColorimetricSpectrum {
  requireInputKeys(input, "createPlanckianSpectrum", ["temperatureKelvin", "wavelengthRangeNanometers"]);
  const temperatureKelvin = requirePositiveNumber(input.temperatureKelvin, "temperatureKelvin");
  const range = requireRecordValue(input.wavelengthRangeNanometers, "wavelengthRangeNanometers");
  rejectUnknownFields(range, ["minimum", "maximum"], "wavelengthRangeNanometers");
  const spectrum: ColorimetricSpectrum = {
    kind: "function",
    wavelengthRangeNanometers: { minimum: range.minimum as number, maximum: range.maximum as number },
    evaluate: portable ? (wavelengthNanometers): number => planckianRadiancePerNanometer(temperatureKelvin, requirePositiveNumber(wavelengthNanometers, "wavelengthNanometers"), portable)
      : (wavelengthNanometers): number => calculatePlanckianSpectralRadiance({ temperatureKelvin, wavelengthNanometers })
  };
  prepareColorimetricSpectrum(spectrum, "planckianSpectrum");
  return spectrum;
}

/** CIE illuminant A defining range (nm). */
export const CIE_ILLUMINANT_A_RANGE_NANOMETERS = /* @__PURE__ */ Object.freeze({ minimum: 300, maximum: 830 });

/**
 * CIE standard illuminant A relative SPD from its defining formula (100 at 560 nm),
 * with c₂ = 1.435e-2 m·K and T = 2848 K as in the standard (≈ 2856 K with the
 * current c₂). Valid 300–830 nm.
 */
export function calculateCieIlluminantARelativeSpectralPower(wavelengthNanometers: number): number {
  return cieIlluminantA(wavelengthNanometers, undefined);
}
/** CIE illuminant A; `portable` evaluates the power and e^x − 1 with the portable functions (see planckianRadiancePerNanometer). */
function cieIlluminantA(wavelengthNanometers: number, portable: PortableOps | undefined): number {
  const nm = requireFiniteNumber(wavelengthNanometers, "wavelengthNanometers");
  if (nm < CIE_ILLUMINANT_A_RANGE_NANOMETERS.minimum || nm > CIE_ILLUMINANT_A_RANGE_NANOMETERS.maximum) {
    throw new InvalidScientificInputError("CIE illuminant A is defined from 300 nm to 830 nm.");
  }
  const c = 1.435e7 / 2848; // nm·K / K
  return portable ? 100 * portable.pow(560 / nm, 5) * (portable.expm1(c / 560) / portable.expm1(c / nm)) : 100 * (560 / nm) ** 5 * (Math.expm1(c / 560) / Math.expm1(c / nm));
}

/** CIE illuminant A as a function spectrum over its defining range. */
export function createCieIlluminantASpectrum(): ColorimetricSpectrum {
  return { kind: "function", wavelengthRangeNanometers: { ...CIE_ILLUMINANT_A_RANGE_NANOMETERS }, evaluate: calculateCieIlluminantARelativeSpectralPower };
}
/** Internal (not exported from the package): {@link createCieIlluminantASpectrum} evaluated with the portable functions (the display view). */
export function createPortableCieIlluminantASpectrum(): ColorimetricSpectrum {
  return { kind: "function", wavelengthRangeNanometers: { ...CIE_ILLUMINANT_A_RANGE_NANOMETERS }, evaluate: (nm) => cieIlluminantA(nm, PORTABLE) };
}

function requireTemperatureIn(t: unknown, range: { minimum: number; maximum: number }, what: string): number {
  const value = requirePositiveNumber(t, what);
  if (value < range.minimum || value > range.maximum) {
    throw new InvalidScientificInputError(what + " must lie in [" + range.minimum + ", " + range.maximum + "] K.");
  }
  return value;
}

function daylightChromaticity(t: number, portable?: PortableOps): CieXyChromaticity {
  const t3 = portable ? portable.pow(t, 3) : t ** 3, t2 = portable ? t * t : t ** 2;
  const x = t <= 7000
    ? -4.6070e9 / t3 + 2.9678e6 / t2 + 0.09911e3 / t + 0.244063
    : -2.0064e9 / t3 + 1.9018e6 / t2 + 0.24748e3 / t + 0.237040;
  return { x, y: -3.000 * x * x + 2.870 * x - 0.275 };
}

export interface CieDaylightComponentWeights {
  correlatedColorTemperatureKelvin: number;
  chromaticity: CieXyChromaticity;
  m1: number;
  m2: number;
  coefficientRounding: "none" | "cie-three-decimals";
}

/**
 * CIE daylight-locus chromaticity and S₁/S₂ weights for a CCT in 4000–25000 K
 * (CIE 15:2018 §4.1.2, paid; no free text of the formulas found). M₁, M₂ rounded to three decimals
 * reproduce the free CIE D55 and D65 tables (DOI 10.25039/CIE.DS.qewfb3kp, 10.25039/CIE.DS.hjfjmt59)
 * to their rounding; `coefficientRounding` makes that rounding explicit.
 * The temperature is used as given: D65's nominal 6500 K corresponds to 6504 K here.
 */
export function calculateCieDaylightComponentWeights(input: {
  correlatedColorTemperatureKelvin: number;
  coefficientRounding: "none" | "cie-three-decimals";
}): CalculationResult<CieDaylightComponentWeights> {
  return cieDaylightComponentWeights(input, undefined);
}
function cieDaylightComponentWeights(input: { correlatedColorTemperatureKelvin: number; coefficientRounding: "none" | "cie-three-decimals" },
  portable: PortableOps | undefined): CalculationResult<CieDaylightComponentWeights> {
  requireInputKeys(input, "calculateCieDaylightComponentWeights", ["correlatedColorTemperatureKelvin", "coefficientRounding"]);
  const t = requireTemperatureIn(input.correlatedColorTemperatureKelvin, CIE_DAYLIGHT_LOCUS_RANGE_KELVIN, "correlatedColorTemperatureKelvin");
  if (input.coefficientRounding !== "none" && input.coefficientRounding !== "cie-three-decimals") {
    throw new InvalidConfigurationError("coefficientRounding must be \"none\" or \"cie-three-decimals\".");
  }
  const xy = daylightChromaticity(t, portable);
  const m = 0.0241 + 0.2562 * xy.x - 0.7341 * xy.y;
  let m1 = (-1.3515 - 1.7703 * xy.x + 5.9114 * xy.y) / m;
  let m2 = (0.0300 - 31.4424 * xy.x + 30.0717 * xy.y) / m;
  if (input.coefficientRounding === "cie-three-decimals") {
    m1 = Math.round(m1 * 1000) / 1000;
    m2 = Math.round(m2 * 1000) / 1000;
  }
  return calculatedResult({ correlatedColorTemperatureKelvin: t, chromaticity: xy, m1, m2, coefficientRounding: input.coefficientRounding },
    "cie-daylight-locus", COLORIMETRY_MODEL_VERSION, ["CIE daylight-locus polynomial and M1/M2 weights, checked against the free CIE D55 and D65 datasets (no free formula text found); valid 4000–25000 K"]);
}

/** Caller-supplied CIE daylight basis S₀, S₁, S₂ (tabulated; CIE dataset not bundled). */
export interface CieDaylightBasis {
  s0: readonly ColorimetricSpectralSample[];
  s1: readonly ColorimetricSpectralSample[];
  s2: readonly ColorimetricSpectralSample[];
  /** Caller identity of the basis dataset (for example a DOI). */
  datasetId: string;
}

/**
 * Builds a CIE D-series relative SPD S(λ) = S₀ + M₁S₁ + M₂S₂ on the S₀ wavelengths from
 * caller-supplied basis tables (S₁, S₂ linearly interpolated; fail closed outside range).
 */
export function createCieDaylightSpectrum(input: {
  correlatedColorTemperatureKelvin: number;
  coefficientRounding: "none" | "cie-three-decimals";
  basis: CieDaylightBasis;
}): ColorimetricSpectrum {
  return cieDaylightSpectrum(input, undefined);
}
/** Internal (not exported from the package): {@link createCieDaylightSpectrum} with the portable daylight-locus powers (the display view). */
export function createPortableCieDaylightSpectrum(input: Parameters<typeof createCieDaylightSpectrum>[0]): ColorimetricSpectrum {
  return cieDaylightSpectrum(input, PORTABLE);
}
function cieDaylightSpectrum(input: Parameters<typeof createCieDaylightSpectrum>[0], portable: PortableOps | undefined): ColorimetricSpectrum {
  requireInputKeys(input, "createCieDaylightSpectrum", ["correlatedColorTemperatureKelvin", "coefficientRounding", "basis"]);
  const weights = cieDaylightComponentWeights({
    correlatedColorTemperatureKelvin: input.correlatedColorTemperatureKelvin,
    coefficientRounding: input.coefficientRounding
  }, portable).value;
  const basis = requireRecordValue(input.basis, "basis");
  rejectUnknownFields(basis, ["s0", "s1", "s2", "datasetId"], "basis");
  requireTrimmedConfigString(basis.datasetId, "basis.datasetId");
  const s0 = prepareColorimetricSpectrum({ kind: "tabulated", samples: input.basis.s0 }, "basis.s0");
  const s1 = prepareColorimetricSpectrum({ kind: "tabulated", samples: input.basis.s1 }, "basis.s1");
  const s2 = prepareColorimetricSpectrum({ kind: "tabulated", samples: input.basis.s2 }, "basis.s2");
  const samples = input.basis.s0.map((sample) => {
    const w = sample.wavelengthNanometers;
    return { wavelengthNanometers: w, value: s0.evaluate(w) + weights.m1 * s1.evaluate(w) + weights.m2 * s2.evaluate(w) };
  });
  return { kind: "tabulated", samples };
}

/** Selects how the Planckian locus is evaluated. */
export type PlanckianLocusModel =
  | {
      /** Planck's law integrated against the engine's analytic CIE 1931 CMFs, 1 nm nodes 360–830 nm (the default). */
      kind: "planck-analytic-cmf";
    }
  | {
      kind: "planck-integration";
      colorMatchingFunctions: ColorMatchingFunctionsSource;
      quadratureNodes: readonly ColorimetricQuadratureNode[];
    };

/** Number of intervals of the coarse reciprocal-temperature scan that brackets the CCT search. */
const CCT_SCAN_STEPS = 200;
/**
 * Convergence tolerance of the CCT root-find: it stops once a Newton (or bisection) step changes T by
 * at most this fraction of T (1e-6 K at 10000 K).
 */
const CCT_RELATIVE_TOLERANCE = 1e-10;

/**
 * Locus uv and its first and second derivatives with respect to the reciprocal temperature x = 1/T
 * (K⁻¹), from the analytic derivatives of Planck's law integrated in the locus quadrature.
 */
interface LocusSample {
  u: number;
  v: number;
  du: number;
  dv: number;
  d2u: number;
  d2v: number;
}

interface PreparedLocus {
  range: { minimum: number; maximum: number };
  approximation: boolean;
  model: string;
  chromaticity(t: number): CieXyChromaticity;
  /** uv and its x = 1/T derivatives at reciprocal temperature x. */
  sample(x: number): LocusSample;
  /** CIE 1960 uv at the coarse scan temperatures; computed once per prepared locus. */
  scan(): readonly Cie1960UvChromaticity[];
}

/**
 * Prepares a Planck-integration locus: the CMF values and 1/λ⁵ factors are sampled once, so each
 * temperature costs one exponential per node. Planck's constant factor 2hc² cancels in chromaticity.
 *
 * Derivatives: with x = 1/T, aᵢ = c₂/λᵢ and rᵢ = 1/(exp(aᵢx) − 1), Planck's law is proportional to
 * λᵢ⁻⁵ rᵢ, and exactly dr/dx = −a(r + r²) and d²r/dx² = a²(r + 3r² + 2r³) (differentiate
 * r = 1/(E − 1), E = exp(ax), and use E = 1 + 1/r). They are summed in the same quadrature as X, Y, Z.
 */
function preparePlanckIntegrationLocus(cmfSource: ColorMatchingFunctionsSource, quadratureNodes: readonly ColorimetricQuadratureNode[], model: string,
  portable?: PortableOps): PreparedLocus {
  // `portable` (the display view): λ⁻⁵ and e^x − 1 from the portable functions, whose bits are the same in every engine.
  const expm1 = portable ? portable.expm1 : Math.expm1;
  const cmf = prepareColorMatchingFunctions(cmfSource);
  const unit = prepareColorimetricSpectrum({ kind: "function", wavelengthRangeNanometers: cmf.wavelengthRangeNanometers, evaluate: () => 1 });
  const basis = sampleColorimetricBasis(quadratureNodes, unit, cmf);
  const n = basis.nodes.length;
  const exponentPerKelvin = new Float64Array(n), inverseFifth = new Float64Array(n);
  // Per-node constants of the derivative sums: weight × CMF × λ⁻⁵ for X, Y and Z.
  const wx = new Float64Array(n), wy = new Float64Array(n), wz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lambda = basis.nodes[i]!.wavelengthNanometers * 1e-9;
    exponentPerKelvin[i] = SECOND_RADIATION_CONSTANT_METER_KELVIN / lambda;
    inverseFifth[i] = 1 / (portable ? portable.pow(lambda, 5) : lambda ** 5);
    const w = basis.weights[i]! * inverseFifth[i]!;
    wx[i] = w * basis.xBar[i]!; wy[i] = w * basis.yBar[i]!; wz[i] = w * basis.zBar[i]!;
  }
  const factor = new Float64Array(n);
  const range = PLANCKIAN_LOCUS_RANGE_KELVIN;
  let scanCache: readonly Cie1960UvChromaticity[] | undefined;
  const locus: PreparedLocus = {
    range,
    approximation: cmf.scientificStatus === "approximation",
    model,
    chromaticity(t: number): CieXyChromaticity {
      // expm1 keeps precision at long wavelengths; overflow at short ones gives 0, as in Planck's law.
      for (let i = 0; i < n; i++) factor[i] = inverseFifth[i]! / expm1(exponentPerKelvin[i]! / t);
      return chromaticityOfXyz(integrateSampledXyz(basis, factor));
    },
    sample(x: number): LocusSample {
      let sx = 0, sy = 0, sz = 0, sx1 = 0, sy1 = 0, sz1 = 0, sx2 = 0, sy2 = 0, sz2 = 0;
      for (let i = 0; i < n; i++) {
        const a = exponentPerKelvin[i]!;
        // An overflowing expm1 gives r = 0 and zero derivatives, the exact limit.
        const r = 1 / expm1(a * x), r2 = r * r;
        const q1 = r + r2, k1 = -a * q1, k2 = a * a * (q1 + 2 * r2 * (1 + r));
        const cx = wx[i]!, cy = wy[i]!, cz = wz[i]!;
        sx += cx * r; sy += cy * r; sz += cz * r;
        sx1 += cx * k1; sy1 += cy * k1; sz1 += cz * k1;
        sx2 += cx * k2; sy2 += cy * k2; sz2 += cz * k2;
      }
      // u = 4X/d, v = 6Y/d, d = X + 15Y + 3Z; quotient rule: q' = (N' − q d')/d, q'' = (N'' − 2q'd' − q d'')/d.
      const d = sx + 15 * sy + 3 * sz, d1 = sx1 + 15 * sy1 + 3 * sz1, d2 = sx2 + 15 * sy2 + 3 * sz2;
      if (!(d > 0) || !Number.isFinite(d)) throw new InvalidScientificInputError("Chromaticity requires X + Y + Z > 0.");
      const u = (4 * sx) / d, v = (6 * sy) / d;
      const du = (4 * sx1 - u * d1) / d, dv = (6 * sy1 - v * d1) / d;
      return { u, v, du, dv, d2u: (4 * sx2 - 2 * du * d1 - u * d2) / d, d2v: (6 * sy2 - 2 * dv * d1 - v * d2) / d };
    },
    scan(): readonly Cie1960UvChromaticity[] {
      if (scanCache === undefined) {
        const lo = 1e6 / range.maximum, hi = 1e6 / range.minimum;
        scanCache = Array.from({ length: CCT_SCAN_STEPS + 1 }, (_, i) => uvOfChromaticity(locus.chromaticity(1e6 / (lo + ((hi - lo) * i) / CCT_SCAN_STEPS))));
      }
      return scanCache;
    }
  };
  return locus;
}

/** 1 nm nodes at 360, 361, …, 830 nm with Δλ = 1 nm (the CIE 15 summation convention). */
const DEFAULT_LOCUS_NODES: readonly ColorimetricQuadratureNode[] = Object.freeze(
  Array.from({ length: 471 }, (_, i) => Object.freeze({ wavelengthNanometers: 360 + i, wavelengthMeasureNanometers: 1 }))
);
let defaultLocus: PreparedLocus | undefined, defaultPortableLocus: PreparedLocus | undefined;

/** The default locus, prepared on first use and shared (its scan cache is computed once); `portable` for the display view. */
function analyticCmfLocus(portable?: PortableOps): PreparedLocus {
  if (portable) {
    defaultPortableLocus ??= preparePlanckIntegrationLocus({ kind: "analytic-cie-1931-multi-lobe-fit" }, DEFAULT_LOCUS_NODES, "planck-analytic-cmf", portable);
    return defaultPortableLocus;
  }
  defaultLocus ??= preparePlanckIntegrationLocus({ kind: "analytic-cie-1931-multi-lobe-fit" }, DEFAULT_LOCUS_NODES, "planck-analytic-cmf");
  return defaultLocus;
}

/**
 * Planckian-locus chromaticity at T (1000–100000 K): Planck's law integrated against the engine's
 * analytic CIE 1931 CMFs with 1 nm nodes from 360 to 830 nm. An approximation, because the CMFs are
 * an analytic fit; with tabulated CMFs use {@link calculatePlanckianChromaticity}.
 */
export function estimatePlanckianLocusChromaticity(input: { temperatureKelvin: number }): CalculationResult<CieXyChromaticity> {
  requireInputKeys(input, "estimatePlanckianLocusChromaticity", ["temperatureKelvin"]);
  const t = requireTemperatureIn(input.temperatureKelvin, PLANCKIAN_LOCUS_RANGE_KELVIN, "temperatureKelvin");
  return approximationResult(analyticCmfLocus().chromaticity(t), "planckian-locus-planck-analytic-cmf", COLORIMETRY_MODEL_VERSION,
    ["Planck's law integrated against the engine's analytic CIE 1931 CMF fit, 1 nm nodes 360–830 nm; valid 1000–100000 K"]);
}

function prepareLocus(model: PlanckianLocusModel, portable?: PortableOps): PreparedLocus {
  const record = requireRecordValue(model, "locus");
  if (record.kind === "planck-analytic-cmf") {
    rejectUnknownFields(record, ["kind"], "locus");
    return analyticCmfLocus(portable);
  }
  if (record.kind !== "planck-integration") throw new InvalidConfigurationError("locus.kind is not supported.");
  rejectUnknownFields(record, ["kind", "colorMatchingFunctions", "quadratureNodes"], "locus");
  const m = model as Extract<PlanckianLocusModel, { kind: "planck-integration" }>;
  const cmf = prepareColorMatchingFunctions(m.colorMatchingFunctions);
  return preparePlanckIntegrationLocus(m.colorMatchingFunctions, m.quadratureNodes, "planck-integration-" + cmf.sourceKind, portable);
}

/** Planckian chromaticity at T using either locus model. */
export function calculatePlanckianChromaticity(input: { temperatureKelvin: number; locus: PlanckianLocusModel }): CalculationResult<CieXyChromaticity> {
  requireInputKeys(input, "calculatePlanckianChromaticity", ["temperatureKelvin", "locus"]);
  const locus = prepareLocus(input.locus);
  const t = requireTemperatureIn(input.temperatureKelvin, locus.range, "temperatureKelvin");
  const value = locus.chromaticity(t);
  const assumptions = ["Planckian locus model: " + locus.model];
  return locus.approximation
    ? approximationResult(value, "planckian-chromaticity", COLORIMETRY_MODEL_VERSION, assumptions)
    : calculatedResult(value, "planckian-chromaticity", COLORIMETRY_MODEL_VERSION, assumptions);
}

/**
 * McCamy (1992) cubic estimate of CCT from CIE 1931 xy:
 * n = (x − 0.3320)/(0.1858 − y), CCT = 449 n³ + 3525 n² + 6823.3 n + 5520.33.
 * An approximation that carries no Duv. Measured for this engine (October 17, 2026) on points of a
 * Planckian locus integrated from the CIE 1931 2° 1 nm table (360–830 nm, exact c₂): it deviates by up
 * to 10 K over 2856–6504 K (largest near 3500 K), 19 K at 2000 K, 17 K at 8000 K, 118 K at 10000 K
 * and 442 K at 12500 K. See docs/COLORIMETRY.md.
 */
export function estimateCorrelatedColorTemperatureMcCamy(input: { chromaticity: CieXyChromaticity }): CalculationResult<{ correlatedColorTemperatureKelvin: number }> {
  requireInputKeys(input, "estimateCorrelatedColorTemperatureMcCamy", ["chromaticity"]);
  const xy = parseChromaticity(input.chromaticity, "chromaticity");
  const n = (xy.x - 0.3320) / (0.1858 - xy.y);
  const cct = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
  if (!Number.isFinite(cct) || cct <= 0) throw new InvalidScientificInputError("Chromaticity is outside the McCamy approximation domain.");
  return approximationResult({ correlatedColorTemperatureKelvin: cct }, "cct-mccamy-1992", COLORIMETRY_MODEL_VERSION,
    ["McCamy (1992) cubic; intended for chromaticities near the Planckian locus, about 2000–12500 K"]);
}

/** The "above-locus" unit normal at a sample: the increasing-T unit tangent (−du/dx, −dv/dx) turned by −90°. */
function locusNormal(s: LocusSample, portable?: PortableOps): Cie1960UvChromaticity {
  const len = portable ? portable.hypot(s.du, s.dv) : Math.hypot(s.du, s.dv);
  const tangent = { u: -s.du / len, v: -s.dv / len };
  // u decreases as T rises, so turning the tangent by −90° points toward larger v (above the locus).
  return { u: tangent.v, v: -tangent.u };
}

/**
 * Nearest locus point to `target` in CIE 1960 uv: the root of the derivative of the squared distance
 * F = (u − u₀)² + (v − v₀)². Roots of dF/dT and of dF/dx (x = 1/T) coincide, since dx/dT = −1/T² ≠ 0;
 * the root-find runs in x with g = ½ dF/dx = (u − u₀)u′ + (v − v₀)v′ and
 * g′ = u′² + v′² + (u − u₀)u″ + (v − v₀)v″ (analytic, see {@link preparePlanckIntegrationLocus}).
 * The cached coarse scan brackets the minimum; a Newton step falls back to bisection whenever it would
 * leave the bracket. Returns the root and the locus sample there, or undefined when the nearest point
 * lies beyond the model's range (by more than the tolerance).
 */
function nearestLocusPoint(locus: PreparedLocus, target: Cie1960UvChromaticity): { x: number; sample: LocusSample } | undefined {
  const steps = CCT_SCAN_STEPS;
  const lo = 1e6 / locus.range.maximum, hi = 1e6 / locus.range.minimum, step = (hi - lo) / steps;
  const gridX = (i: number): number => (lo + step * i) * 1e-6;
  const scan = locus.scan();
  const f = (i: number): number => (scan[i]!.u - target.u) ** 2 + (scan[i]!.v - target.v) ** 2;
  let best = 0, bestValue = Infinity;
  for (let i = 0; i <= steps; i++) {
    const value = f(i);
    if (value < bestValue) { bestValue = value; best = i; }
  }
  const tolerance = (x: number): number => CCT_RELATIVE_TOLERANCE * x;
  const derivatives = (s: LocusSample): { g: number; gp: number } => {
    const eu = s.u - target.u, ev = s.v - target.v;
    return { g: eu * s.du + ev * s.dv, gp: s.du * s.du + s.dv * s.dv + eu * s.d2u + ev * s.d2v };
  };
  let a: number, b: number, x: number;
  if (best === 0 || best === steps) {
    // The scan minimum is a range limit: the nearest point is inside only if F still falls inward.
    x = gridX(best);
    const s = locus.sample(x), { g, gp } = derivatives(s);
    if (best === 0 ? g >= 0 : g <= 0) {
      // At the limit within the tolerance (one Newton step estimates the distance), or beyond it.
      return g === 0 || (gp > 0 && Math.abs(g / gp) <= tolerance(x)) ? { x, sample: s } : undefined;
    }
    a = best === 0 ? x : gridX(steps - 1);
    b = best === 0 ? gridX(1) : x;
  } else {
    // A discrete minimum between its neighbours brackets a local minimum; start at the parabola vertex.
    a = gridX(best - 1); b = gridX(best + 1);
    const fm = f(best - 1), fp = f(best + 1), curvature = fm - 2 * bestValue + fp;
    x = gridX(best) + (curvature > 0 ? (step * 1e-6 * (fm - fp)) / (2 * curvature) : 0);
  }
  let s = locus.sample(x);
  for (let i = 0; i < 100; i++) {
    const { g, gp } = derivatives(s);
    if (g === 0) break;
    if (g < 0) a = x; else b = x;
    let next = x - g / gp;
    if (!(gp > 0) || !(next > a && next < b)) next = 0.5 * (a + b);
    const converged = Math.abs(next - x) <= tolerance(next) || b - a <= tolerance(next);
    x = next;
    s = locus.sample(x);
    if (converged) break;
  }
  return { x, sample: s };
}

export interface CorrelatedColorTemperatureResult {
  correlatedColorTemperatureKelvin: number;
  /** Signed CIE 1960 uv distance from the locus; positive above (greenish), negative below (the engine's convention). */
  duv: number;
}

/**
 * CCT and Duv of a chromaticity as the nearest point of the Planckian locus in the CIE
 * 1960 UCS (Smet et al. 2023; also CIE 15:2018). Finds the root of the analytic temperature derivative
 * of the squared uv distance (safeguarded Newton with bisection fallback, bracketed by a cached coarse
 * scan in reciprocal temperature), converged until a step changes T by at most 1e-10 of T. Throws
 * (fails closed) when the nearest point lies beyond the model's range, or when |Duv| > 0.05 (see
 * {@link MAX_CORRELATED_COLOR_TEMPERATURE_DUV}). Duv is positive above the locus (toward green) and
 * negative below it, the engine's documented sign convention.
 */
export function calculateCorrelatedColorTemperature(input: { chromaticity: CieXyChromaticity; locus: PlanckianLocusModel }): CalculationResult<CorrelatedColorTemperatureResult> {
  requireInputKeys(input, "calculateCorrelatedColorTemperature", ["chromaticity", "locus"]);
  const xy = parseChromaticity(input.chromaticity, "chromaticity");
  const locus = prepareLocus(input.locus);
  const target = uvOfChromaticity(xy);
  const nearest = nearestLocusPoint(locus, target);
  if (nearest === undefined) throw new InvalidScientificInputError("Chromaticity's nearest Planckian point lies outside the locus model range.");
  const t = Math.min(locus.range.maximum, Math.max(locus.range.minimum, 1 / nearest.x));
  const point = nearest.sample, normal = locusNormal(point);
  const duv = (target.u - point.u) * normal.u + (target.v - point.v) * normal.v;
  // foundation-11: within 1e-12 of the limit is the limit (a chromaticity made at |Duv| = 0.05 reads back 1 ulp above it).
  if (Math.abs(duv) > MAX_CORRELATED_COLOR_TEMPERATURE_DUV + 1e-12) {
    throw new InvalidScientificInputError("|Duv| exceeds 0.05; no CCT is reported this far from the Planckian locus (the range evaluated by Smet et al. 2023).");
  }
  const value = { correlatedColorTemperatureKelvin: t, duv: Math.min(MAX_CORRELATED_COLOR_TEMPERATURE_DUV, Math.max(-MAX_CORRELATED_COLOR_TEMPERATURE_DUV, duv)) };
  const assumptions = ["Nearest point on the Planckian locus in CIE 1960 uv; locus model: " + locus.model, "Duv sign: positive above the locus (toward green), negative below (engine convention)"];
  return locus.approximation
    ? approximationResult(value, "cct-duv-locus-search", COLORIMETRY_MODEL_VERSION, assumptions)
    : calculatedResult(value, "cct-duv-locus-search", COLORIMETRY_MODEL_VERSION, assumptions);
}

/** Locus whose temperature defines a white for CCT + Duv. */
export type WhiteLocus = "planckian" | "cie-daylight";

/**
 * Chromaticity for CCT and Duv: the locus point (Planckian or CIE daylight) offset by
 * Duv along the unit normal of the Planckian locus at the same temperature in the CIE
 * 1960 UCS. For `cie-daylight`, Duv = 0 returns the daylight-locus point itself.
 * Throws InvalidScientificInputError when the offset point is not a physical chromaticity
 * (x ≥ 0, y > 0, x + y ≤ 1), for example 2000 K with Duv +0.02 (x + y ≈ 1.06).
 */
export function calculateChromaticityFromCorrelatedColorTemperature(input: {
  correlatedColorTemperatureKelvin: number;
  duv: number;
  whiteLocus: WhiteLocus;
  locus: PlanckianLocusModel;
}): CalculationResult<CieXyChromaticity> {
  return chromaticityFromCorrelatedColorTemperature(input, undefined);
}
/**
 * Internal (not exported from the package): {@link calculateChromaticityFromCorrelatedColorTemperature} with the locus's
 * λ⁻⁵, e^x − 1 and normal length and the daylight-locus powers from the portable functions (the display view's Kelvin
 * white balance), so the result has the same bits in every JavaScript engine.
 */
export function calculatePortableChromaticityFromCorrelatedColorTemperature(input: Parameters<typeof calculateChromaticityFromCorrelatedColorTemperature>[0]):
  CalculationResult<CieXyChromaticity> {
  return chromaticityFromCorrelatedColorTemperature(input, PORTABLE);
}
function chromaticityFromCorrelatedColorTemperature(input: Parameters<typeof calculateChromaticityFromCorrelatedColorTemperature>[0], portable: PortableOps | undefined):
  CalculationResult<CieXyChromaticity> {
  requireInputKeys(input, "calculateChromaticityFromCorrelatedColorTemperature", ["correlatedColorTemperatureKelvin", "duv", "whiteLocus", "locus"]);
  const locus = prepareLocus(input.locus, portable);
  const duv = requireFiniteNumber(input.duv, "duv");
  if (Math.abs(duv) > MAX_CORRELATED_COLOR_TEMPERATURE_DUV) throw new InvalidScientificInputError("|duv| must not exceed 0.05.");
  if (input.whiteLocus !== "planckian" && input.whiteLocus !== "cie-daylight") throw new InvalidConfigurationError("whiteLocus is not supported.");
  const range = input.whiteLocus === "cie-daylight"
    ? { minimum: Math.max(locus.range.minimum, CIE_DAYLIGHT_LOCUS_RANGE_KELVIN.minimum), maximum: Math.min(locus.range.maximum, CIE_DAYLIGHT_LOCUS_RANGE_KELVIN.maximum) }
    : locus.range;
  const t = requireTemperatureIn(input.correlatedColorTemperatureKelvin, range, "correlatedColorTemperatureKelvin");
  const normal = locusNormal(locus.sample(1 / t), portable);
  const base = uvOfChromaticity(input.whiteLocus === "cie-daylight" ? daylightChromaticity(t, portable) : locus.chromaticity(t));
  const value = chromaticityOfUv({ u: base.u + duv * normal.u, v: base.v + duv * normal.v });
  // The same domain parseChromaticity enforces on input, so every result can be passed back in.
  if (!(value.x >= 0) || !(value.y > 0) || !(value.x + value.y <= 1)) {
    throw new InvalidScientificInputError("correlatedColorTemperatureKelvin and duv give a chromaticity outside x >= 0, y > 0, x + y <= 1.");
  }
  const assumptions = ["White locus: " + input.whiteLocus + "; Duv offset along the Planckian-locus normal (" + locus.model + ") in CIE 1960 uv"];
  const exactDaylightPoint = input.whiteLocus === "cie-daylight" && duv === 0;
  return locus.approximation && !exactDaylightPoint
    ? approximationResult(value, "chromaticity-from-cct-duv", COLORIMETRY_MODEL_VERSION, assumptions)
    : calculatedResult(value, "chromaticity-from-cct-duv", COLORIMETRY_MODEL_VERSION, assumptions);
}
