// SPDX-License-Identifier: Apache-2.0

/**
 * CIE colour-matching functions (CMFs) and spectrum → CIE XYZ integration.
 *
 * Two CMF sources are supported:
 * 1. The engine's own analytic APPROXIMATION of the CIE 1931 2° observer. Each of x̄, ȳ, z̄ is a sum
 *    of split Gaussian lobes (a lobe has an amplitude, a centre, and separate widths below and above
 *    the centre): three lobes for x̄, two each for ȳ and z̄. The engine fitted the coefficients itself
 *    by non-negative least squares to the CIE 1931 2° table (DOI 10.25039/CIE.DS.xvudnb9b) at 1 nm
 *    from 360 to 830 nm, with `scripts/fit-cie-1931-cmf.mjs`. The table is used only when the fit is
 *    run and is not stored in the repository. Measured fit error (maximum absolute / RMS): x̄ 0.0122 /
 *    0.00426, ȳ 0.00733 / 0.00265, z̄ 0.0221 / 0.00397; see docs/COLORIMETRY.md.
 * 2. Caller-supplied tabulated CMFs, for example the official CIE datasets. The CIE
 *    distributes those under CC BY-SA 4.0, so they are NOT bundled with this Apache-2.0
 *    package. Tables are linearly interpolated. Outside their declared range they throw
 *    (fail closed); there is no extrapolation.
 *
 * Integration uses explicit wavelength quadrature nodes `{wavelengthNanometers,
 * wavelengthMeasureNanometers}`. Nodes from `calculateSensorSpectralQuadrature()` have the
 * same shape and can be passed directly. X = k Σ S(λᵢ) R(λᵢ) x̄(λᵢ) Δλᵢ: a quadrature of the tristimulus
 * integral X = ∫ L(λ) x̄(λ) dλ with stimulus L = S·R (Wyman, Sloan & Shirley 2013, JCGT 2(2), Eq. 1, free;
 * also CIE 15:2018 §7.1). The normalization k and the quadrature nodes are explicit choices.
 * @see docs/COLORIMETRY.md for equations, coordinate/unit conventions and limits.
 */

import { approximationResult, calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import type { SpectralWavelengthRangeNanometers, SpectralWavelengthSample } from "../core/spectral.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  chromaticityOfXyz,
  requireFiniteNumber,
  requireFiniteResult,
  requirePositiveNumber,
  requireRecordValue,
  type CieXyChromaticity,
  type CieXyzTristimulus
} from "./colorimetry-math.js";
import { rejectUnknownFields, requireInputKeys, requireTrimmedConfigString } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export const COLORIMETRY_MODEL_VERSION = "2.0.0" as const;
/** Upper bound on quadrature nodes per integration call. */
export const MAX_COLORIMETRIC_QUADRATURE_NODES = 100_000;
/** Upper bound on samples in a caller-supplied tabulated spectrum or CMF table. */
export const MAX_COLORIMETRIC_TABLE_SAMPLES = 100_000;

/** Wavelength domain over which the analytic CIE 1931 fit is accepted (the domain it was fitted on). */
export const ANALYTIC_CIE_1931_CMF_DOMAIN_NANOMETERS: Readonly<SpectralWavelengthRangeNanometers> = /* @__PURE__ */ Object.freeze({ minimum: 360, maximum: 830 });

/** One wavelength quadrature node; d-lambda is in nanometres. */
export interface ColorimetricQuadratureNode {
  wavelengthNanometers: number;
  wavelengthMeasureNanometers: number;
}

/** One tabulated spectral value at one wavelength. */
export interface ColorimetricSpectralSample extends SpectralWavelengthSample {
  value: number;
}

/**
 * A spectral distribution or spectral factor (reflectance, transmittance, relative SPD,
 * sensitivity).
 * - `tabulated` is the JSON form: strictly increasing wavelengths, linear interpolation, and an
 *   error (fail closed) outside the table.
 * - `function` is an in-process evaluator (for example a Planckian SPD). It must be finite over
 *   its declared range.
 */
export type ColorimetricSpectrum =
  | { kind: "tabulated"; samples: readonly ColorimetricSpectralSample[] }
  | { kind: "function"; wavelengthRangeNanometers: SpectralWavelengthRangeNanometers; evaluate: (wavelengthNanometers: number) => number };

/** One tabulated colour-matching sample. */
export interface TabulatedColorMatchingSample extends SpectralWavelengthSample {
  xBar: number;
  yBar: number;
  zBar: number;
}

export type ColorimetricObserver = "cie-1931-2-degree" | "cie-1964-10-degree" | "caller-defined";

/** Selects a colour-matching-function source. */
export type ColorMatchingFunctionsSource =
  | { kind: "analytic-cie-1931-multi-lobe-fit" }
  | {
      kind: "tabulated";
      observer: ColorimetricObserver;
      /** Caller identity for the dataset (for example a DOI); recorded in provenance. */
      datasetId: string;
      samples: readonly TabulatedColorMatchingSample[];
    };

/** Validated, reusable colour-matching functions. */
export interface PreparedColorMatchingFunctions {
  observer: ColorimetricObserver;
  sourceKind: ColorMatchingFunctionsSource["kind"];
  datasetId: string;
  scientificStatus: "approximation" | "caller-tabulated";
  wavelengthRangeNanometers: SpectralWavelengthRangeNanometers;
  /** x̄, ȳ, z̄ at one wavelength in nm; throws outside the declared range. */
  evaluate(wavelengthNanometers: number): CieXyzTristimulus;
}

// The engine's own fit (scripts/fit-cie-1931-cmf.mjs): per lobe the amplitude, the centre (nm),
// and the standard deviation (nm) used below and above the centre.
type Lobe = readonly [amplitude: number, centreNanometers: number, sigmaBelowNanometers: number, sigmaAboveNanometers: number];
const X_LOBES: readonly Lobe[] = [[0.375817, 441.559, 15.3475, 94.5181], [-0.322164, 497.643, 23.3464, 30.5255], [0.968784, 600.86, 33.6528, 29.7704]];
const Y_LOBES: readonly Lobe[] = [[0.285798, 530.874, 16.3146, 31.077], [0.820879, 568.79, 46.8848, 40.4965]];
const Z_LOBES: readonly Lobe[] = [[1.2165, 436.962, 11.8408, 35.9867], [0.681263, 459.034, 25.9609, 13.7926]];

function lobes(wavelength: number, set: readonly Lobe[]): number {
  let sum = 0;
  for (const [amplitude, centre, sigmaBelow, sigmaAbove] of set) {
    const t = (wavelength - centre) / (wavelength < centre ? sigmaBelow : sigmaAbove);
    sum += amplitude * Math.exp(-0.5 * t * t);
  }
  return sum;
}

function requireWavelengthIn(wavelength: number, range: SpectralWavelengthRangeNanometers, what: string): void {
  if (!Number.isFinite(wavelength) || wavelength < range.minimum || wavelength > range.maximum) {
    throw new InvalidScientificInputError(what + " is outside its declared wavelength range [" + range.minimum + ", " + range.maximum + "] nm.");
  }
}

/**
 * Evaluates the engine's multi-lobe analytic approximation of the CIE 1931 2° colour-matching
 * functions at one wavelength (nm, standard-air wavelength as in the CIE tables). Approximation:
 * see the module notes for the measured fit error. The values are non-negative over the domain.
 */
export function estimateCie1931ColorMatchingFunctions(wavelengthNanometers: number): CieXyzTristimulus {
  requireWavelengthIn(wavelengthNanometers, ANALYTIC_CIE_1931_CMF_DOMAIN_NANOMETERS, "Analytic CIE 1931 CMF wavelength");
  return { x: lobes(wavelengthNanometers, X_LOBES), y: lobes(wavelengthNanometers, Y_LOBES), z: lobes(wavelengthNanometers, Z_LOBES) };
}

function parseIncreasingSamples<T extends SpectralWavelengthSample>(
  samples: unknown,
  path: string,
  sampleKeys: readonly string[],
  parseValue: (sample: Record<string, unknown>, samplePath: string) => T
): T[] {
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > MAX_COLORIMETRIC_TABLE_SAMPLES) {
    throw new InvalidScientificInputError(path + " must contain between 2 and " + MAX_COLORIMETRIC_TABLE_SAMPLES + " samples.");
  }
  const parsed: T[] = [];
  let previous = -Infinity;
  samples.forEach((raw: unknown, i) => {
    const samplePath = path + "[" + i + "]";
    const record = requireRecordValue(raw, samplePath);
    rejectUnknownFields(record, sampleKeys, samplePath);
    const wavelength = requirePositiveNumber(record.wavelengthNanometers, samplePath + ".wavelengthNanometers");
    if (!(wavelength > previous)) throw new InvalidScientificInputError(path + " wavelengths must be strictly increasing.");
    previous = wavelength;
    parsed.push(parseValue(record, samplePath));
  });
  return parsed;
}

/** Finds the bracketing interval for linear interpolation (binary search). */
function bracket(samples: readonly SpectralWavelengthSample[], wavelength: number): [number, number] {
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.wavelengthNanometers <= wavelength) lo = mid;
    else hi = mid;
  }
  const a = samples[lo]!.wavelengthNanometers;
  const b = samples[hi]!.wavelengthNanometers;
  return [lo, (wavelength - a) / (b - a)];
}

/**
 * Validates a colour-matching-function source once for repeated evaluation.
 * Tabulated values may be signed only for `caller-defined` observers; CIE observers
 * require non-negative values.
 */
export function prepareColorMatchingFunctions(source: ColorMatchingFunctionsSource): PreparedColorMatchingFunctions {
  const record = requireRecordValue(source, "colorMatchingFunctions");
  rejectUnknownFields(record, ["kind", "observer", "datasetId", "samples"], "colorMatchingFunctions");
  if (record.kind === "analytic-cie-1931-multi-lobe-fit") {
    rejectUnknownFields(record, ["kind"], "colorMatchingFunctions");
    return Object.freeze({
      observer: "cie-1931-2-degree" as const,
      sourceKind: "analytic-cie-1931-multi-lobe-fit" as const,
      datasetId: "photivra-cie-1931-multi-lobe-fit-2026-10-17",
      scientificStatus: "approximation" as const,
      wavelengthRangeNanometers: { ...ANALYTIC_CIE_1931_CMF_DOMAIN_NANOMETERS },
      evaluate: estimateCie1931ColorMatchingFunctions
    });
  }
  if (record.kind !== "tabulated") throw new InvalidConfigurationError("colorMatchingFunctions.kind is not supported.");
  rejectUnknownFields(record, ["kind", "observer", "datasetId", "samples"], "colorMatchingFunctions");
  const observer = record.observer;
  if (observer !== "cie-1931-2-degree" && observer !== "cie-1964-10-degree" && observer !== "caller-defined") {
    throw new InvalidConfigurationError("colorMatchingFunctions.observer is not supported.");
  }
  const datasetId = requireTrimmedConfigString(record.datasetId, "colorMatchingFunctions.datasetId");
  const signed = observer === "caller-defined";
  const samples = parseIncreasingSamples<TabulatedColorMatchingSample>(record.samples, "colorMatchingFunctions.samples",
    ["wavelengthNanometers", "xBar", "yBar", "zBar"], (s, p) => {
    const v = (key: "xBar" | "yBar" | "zBar"): number => {
      const n = requireFiniteNumber(s[key], p + "." + key);
      if (!signed && n < 0) throw new InvalidScientificInputError(p + "." + key + " must not be negative for a CIE observer.");
      return n;
    };
    return { wavelengthNanometers: s.wavelengthNanometers as number, xBar: v("xBar"), yBar: v("yBar"), zBar: v("zBar") };
  });
  const range = { minimum: samples[0]!.wavelengthNanometers, maximum: samples[samples.length - 1]!.wavelengthNanometers };
  return Object.freeze({
    observer,
    sourceKind: "tabulated" as const,
    datasetId,
    scientificStatus: "caller-tabulated" as const,
    wavelengthRangeNanometers: range,
    evaluate(wavelengthNanometers: number): CieXyzTristimulus {
      requireWavelengthIn(wavelengthNanometers, range, "Tabulated CMF wavelength");
      const [i, t] = bracket(samples, wavelengthNanometers);
      const a = samples[i]!;
      const b = samples[Math.min(i + 1, samples.length - 1)]!;
      return { x: a.xBar + (b.xBar - a.xBar) * t, y: a.yBar + (b.yBar - a.yBar) * t, z: a.zBar + (b.zBar - a.zBar) * t };
    }
  });
}

/** A validated spectrum ready for evaluation. */
export interface PreparedColorimetricSpectrum {
  wavelengthRangeNanometers: SpectralWavelengthRangeNanometers;
  evaluate(wavelengthNanometers: number): number;
}

/** Validates a tabulated or functional spectrum (values must be finite; sign is not restricted). */
export function prepareColorimetricSpectrum(spectrum: ColorimetricSpectrum, path = "spectrum"): PreparedColorimetricSpectrum {
  const record = requireRecordValue(spectrum, path);
  rejectUnknownFields(record, ["kind", "samples", "wavelengthRangeNanometers", "evaluate"], path);
  if (record.kind === "function") {
    rejectUnknownFields(record, ["kind", "wavelengthRangeNanometers", "evaluate"], path);
    const range = requireRecordValue(record.wavelengthRangeNanometers, path + ".wavelengthRangeNanometers");
    rejectUnknownFields(range, ["minimum", "maximum"], path + ".wavelengthRangeNanometers");
    const minimum = requirePositiveNumber(range.minimum, path + ".wavelengthRangeNanometers.minimum");
    const maximum = requirePositiveNumber(range.maximum, path + ".wavelengthRangeNanometers.maximum");
    if (!(minimum < maximum)) throw new InvalidScientificInputError(path + ".wavelengthRangeNanometers.minimum must be less than maximum.");
    if (typeof record.evaluate !== "function") throw new InvalidConfigurationError(path + ".evaluate must be a function.");
    const evaluate = record.evaluate as (w: number) => number;
    const declared = { minimum, maximum };
    return {
      wavelengthRangeNanometers: declared,
      evaluate(w: number): number {
        requireWavelengthIn(w, declared, path);
        const v = evaluate(w);
        if (typeof v !== "number" || !Number.isFinite(v)) throw new InvalidScientificInputError(path + " evaluated to a non-finite value.");
        return v;
      }
    };
  }
  if (record.kind !== "tabulated") throw new InvalidConfigurationError(path + ".kind is not supported.");
  rejectUnknownFields(record, ["kind", "samples"], path);
  const samples = parseIncreasingSamples<ColorimetricSpectralSample>(record.samples, path + ".samples", ["wavelengthNanometers", "value"], (s, p) => ({
    wavelengthNanometers: s.wavelengthNanometers as number,
    value: requireFiniteNumber(s.value, p + ".value")
  }));
  const range = { minimum: samples[0]!.wavelengthNanometers, maximum: samples[samples.length - 1]!.wavelengthNanometers };
  return {
    wavelengthRangeNanometers: range,
    evaluate(w: number): number {
      requireWavelengthIn(w, range, path);
      const [i, t] = bracket(samples, w);
      const a = samples[i]!.value;
      const b = samples[Math.min(i + 1, samples.length - 1)]!.value;
      return a + (b - a) * t;
    }
  };
}

export interface CreateColorimetricMidpointQuadratureInput {
  wavelengthRangeNanometers: SpectralWavelengthRangeNanometers;
  /** Hard upper bound on each midpoint subinterval width, nm. */
  maximumSubintervalWidthNanometers: number;
}

/**
 * Builds deterministic uniform midpoint wavelength nodes covering the range. Every
 * node carries its d-lambda measure in nm; the measures sum to the range width.
 */
export function createColorimetricMidpointQuadrature(input: CreateColorimetricMidpointQuadratureInput): ColorimetricQuadratureNode[] {
  requireInputKeys(input, "createColorimetricMidpointQuadrature", ["wavelengthRangeNanometers", "maximumSubintervalWidthNanometers"]);
  const range = requireRecordValue(input.wavelengthRangeNanometers, "wavelengthRangeNanometers");
  rejectUnknownFields(range, ["minimum", "maximum"], "wavelengthRangeNanometers");
  const minimum = requirePositiveNumber(range.minimum, "wavelengthRangeNanometers.minimum");
  const maximum = requirePositiveNumber(range.maximum, "wavelengthRangeNanometers.maximum");
  if (!(minimum < maximum)) throw new InvalidScientificInputError("wavelengthRangeNanometers.minimum must be less than maximum.");
  const width = requirePositiveNumber(input.maximumSubintervalWidthNanometers, "maximumSubintervalWidthNanometers");
  // foundation-12: at least one node, also when the width is so large that the quotient is below the 1e-9 allowance.
  const count = Math.max(1, Math.ceil((maximum - minimum) / width - 1e-9));
  if (count > MAX_COLORIMETRIC_QUADRATURE_NODES) throw new InvalidScientificInputError("Quadrature would exceed " + MAX_COLORIMETRIC_QUADRATURE_NODES + " nodes.");
  const step = (maximum - minimum) / count;
  const nodes: ColorimetricQuadratureNode[] = [];
  for (let i = 0; i < count; i++) nodes.push({ wavelengthNanometers: minimum + (i + 0.5) * step, wavelengthMeasureNanometers: step });
  return nodes;
}

/** Validates explicit quadrature nodes (positive wavelengths and positive measures). */
export function parseColorimetricQuadratureNodes(nodes: unknown): ColorimetricQuadratureNode[] {
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > MAX_COLORIMETRIC_QUADRATURE_NODES) {
    throw new InvalidScientificInputError("quadratureNodes must contain between 1 and " + MAX_COLORIMETRIC_QUADRATURE_NODES + " nodes.");
  }
  return nodes.map((raw: unknown, i) => {
    const r = requireRecordValue(raw, "quadratureNodes[" + i + "]");
    rejectUnknownFields(r, ["wavelengthNanometers", "wavelengthMeasureNanometers"], "quadratureNodes[" + i + "]");
    return {
      wavelengthNanometers: requirePositiveNumber(r.wavelengthNanometers, "quadratureNodes[" + i + "].wavelengthNanometers"),
      wavelengthMeasureNanometers: requirePositiveNumber(r.wavelengthMeasureNanometers, "quadratureNodes[" + i + "].wavelengthMeasureNanometers")
    };
  });
}

/**
 * Normalization of integrated tristimulus values.
 * - `white-luminance-one`: k = 1 / Σ S ȳ Δλ, so the perfect reflecting diffuser (or the
 *   illuminant itself) has Y = 1 (relative colorimetry with Y scaled to 1; also CIE 15:2018).
 * - `scale`: X = factor · Σ …; for example 683.002 lm/W with spectral radiance in
 *   W·m⁻²·sr⁻¹·nm⁻¹ yields luminance in cd/m² (the caller owns the unit semantics).
 */
export type TristimulusNormalization = { kind: "white-luminance-one" } | { kind: "scale"; factor: number };

export interface IntegrateSpectrumToXyzInput {
  quadratureNodes: readonly ColorimetricQuadratureNode[];
  /** Illuminant SPD or emitted spectral radiance S(λ). */
  spectralDistribution: ColorimetricSpectrum;
  /** Optional spectral reflectance/transmittance factor R(λ); omitted means R = 1. */
  spectralFactor?: ColorimetricSpectrum;
  colorMatchingFunctions: ColorMatchingFunctionsSource;
  normalization: TristimulusNormalization;
}

export interface IntegratedSpectrumXyz {
  xyz: CieXyzTristimulus;
  /** Tristimulus values of S(λ) alone under the same normalization (the adopted white). */
  whiteXyz: CieXyzTristimulus;
  chromaticity: CieXyChromaticity | null;
  normalizationFactor: number;
  observer: ColorimetricObserver;
  nodeCount: number;
}

/** Internal: per-node weights S·Δλ and CMF values; reused by matrix fitting. */
export interface SampledColorimetricBasis {
  nodes: readonly ColorimetricQuadratureNode[];
  weights: Float64Array;
  xBar: Float64Array;
  yBar: Float64Array;
  zBar: Float64Array;
  cmf: PreparedColorMatchingFunctions;
}

export function sampleColorimetricBasis(
  quadratureNodes: readonly ColorimetricQuadratureNode[],
  spectralDistribution: PreparedColorimetricSpectrum,
  cmf: PreparedColorMatchingFunctions
): SampledColorimetricBasis {
  const nodes = parseColorimetricQuadratureNodes(quadratureNodes);
  const n = nodes.length;
  const weights = new Float64Array(n), xBar = new Float64Array(n), yBar = new Float64Array(n), zBar = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    const c = cmf.evaluate(node.wavelengthNanometers);
    weights[i] = spectralDistribution.evaluate(node.wavelengthNanometers) * node.wavelengthMeasureNanometers;
    xBar[i] = c.x; yBar[i] = c.y; zBar[i] = c.z;
  }
  return { nodes, weights, xBar, yBar, zBar, cmf };
}

export function sampleFactor(basis: SampledColorimetricBasis, factor: PreparedColorimetricSpectrum | undefined): Float64Array {
  const out = new Float64Array(basis.nodes.length);
  for (let i = 0; i < out.length; i++) out[i] = factor === undefined ? 1 : factor.evaluate(basis.nodes[i]!.wavelengthNanometers);
  return out;
}

export function integrateSampledXyz(basis: SampledColorimetricBasis, factor: Float64Array): CieXyzTristimulus {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < factor.length; i++) {
    const w = basis.weights[i]! * factor[i]!;
    x += w * basis.xBar[i]!; y += w * basis.yBar[i]!; z += w * basis.zBar[i]!;
  }
  return { x, y, z };
}

export function resolveNormalizationFactor(normalization: TristimulusNormalization, unnormalizedWhiteY: number): number {
  const r = requireRecordValue(normalization, "normalization");
  if (r.kind === "white-luminance-one") {
    if (!(unnormalizedWhiteY > 0) || !Number.isFinite(unnormalizedWhiteY)) {
      throw new InvalidScientificInputError("White-luminance normalization requires a positive integrated Y of the spectral distribution.");
    }
    return 1 / unnormalizedWhiteY;
  }
  if (r.kind === "scale") return requirePositiveNumber(r.factor, "normalization.factor");
  throw new InvalidConfigurationError("normalization.kind is not supported.");
}

function scaleXyz(xyz: CieXyzTristimulus, k: number): CieXyzTristimulus {
  return { x: xyz.x * k, y: xyz.y * k, z: xyz.z * k };
}

/**
 * Integrates a spectrum (optionally multiplied by a reflectance/transmittance factor)
 * against colour-matching functions with caller-explicit quadrature (the tristimulus integral of
 * Wyman, Sloan & Shirley 2013, Eq. 1; also CIE 15:2018 §7).
 * Provenance is `approximation` for the analytic CMF fit and `calculated` for
 * caller-tabulated CMFs. Either way, the caller chooses the quadrature.
 */
export function integrateSpectrumToXyz(input: IntegrateSpectrumToXyzInput): CalculationResult<IntegratedSpectrumXyz> {
  requireInputKeys(input, "integrateSpectrumToXyz", ["quadratureNodes", "spectralDistribution", "spectralFactor", "colorMatchingFunctions", "normalization"]);
  const cmf = prepareColorMatchingFunctions(input.colorMatchingFunctions);
  const distribution = prepareColorimetricSpectrum(input.spectralDistribution, "spectralDistribution");
  const factor = input.spectralFactor === undefined ? undefined : prepareColorimetricSpectrum(input.spectralFactor, "spectralFactor");
  const basis = sampleColorimetricBasis(input.quadratureNodes, distribution, cmf);
  const rawWhite = integrateSampledXyz(basis, sampleFactor(basis, undefined));
  const rawSample = factor === undefined ? rawWhite : integrateSampledXyz(basis, sampleFactor(basis, factor));
  const k = resolveNormalizationFactor(input.normalization, rawWhite.y);
  const xyz = scaleXyz(rawSample, k);
  const whiteXyz = scaleXyz(rawWhite, k);
  requireFiniteResult([xyz.x, xyz.y, xyz.z, whiteXyz.x, whiteXyz.y, whiteXyz.z], "Spectral integration");
  const sum = xyz.x + xyz.y + xyz.z;
  const value: IntegratedSpectrumXyz = {
    xyz, whiteXyz, chromaticity: sum > 0 ? chromaticityOfXyz(xyz) : null, normalizationFactor: k,
    observer: cmf.observer, nodeCount: basis.nodes.length
  };
  const assumptions = [
    "Tristimulus integral evaluated as Σ S(λ)·R(λ)·CMF(λ)·Δλ over the caller's quadrature nodes",
    "Caller owns quadrature convergence and wavelength coverage; tabulated inputs are linearly interpolated and fail closed outside their range"
  ];
  return cmf.scientificStatus === "approximation"
    ? approximationResult(value, "cie-xyz-spectral-integration-analytic-cmf", COLORIMETRY_MODEL_VERSION,
      [...assumptions, "CIE 1931 2° CMFs from the engine's multi-lobe analytic fit (measured max abs CMF error 0.0122/0.00733/0.0221)"])
    : calculatedResult(value, "cie-xyz-spectral-integration-tabulated-cmf", COLORIMETRY_MODEL_VERSION,
      [...assumptions, "Caller-supplied tabulated CMFs: " + cmf.datasetId]);
}
