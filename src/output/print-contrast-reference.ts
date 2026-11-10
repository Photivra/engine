// SPDX-License-Identifier: Apache-2.0
// castleCSF numerical model material: Copyright (c) 2023 Graphics and Displays
// group - University of Cambridge. MIT terms retained in NOTICE (the full
// licence text). Original bounded TypeScript adapter.

/** Contrast detection threshold for a static, neutral (D65 white) Gabor patch, from the castleCSF
 * contrast sensitivity function (CSF) model. A Gabor patch is a sine grating under a Gaussian envelope.
 * It does not say whether detail in a photograph will be visible.
 * @see docs/PRINT_CONTRAST_REFERENCE.md for exact source, applicability and review gates.
 */
import { estimatedResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { freezeOwnedData } from "../core/owned-data.js";
import { requireAllowlistedRecord, requirePublicOpaqueId } from "../core/record-validation.js";
import { ENGINE_API_VERSION } from "../core/version.js";

export const PRINT_CONTRAST_REFERENCE_MODEL_VERSION = "0.1.0" as const;
/** Identifies the exact MIT-licensed model source. It is not a local calibration. */
export const PRINT_CONTRAST_REFERENCE_UPSTREAM_REVISION = "f4b0b722af83001d7af979281e06ca642d36e4e8" as const;

/** The narrow reference stimulus. It is separate from any measured photographic region of interest (ROI).
 * Positive values outside the model's range return "unsupported" instead of being extrapolated.
 */
export interface PrintContrastReferenceInput {
  referenceId: string;
  stimulus: "static-neutral-d65-gabor";
  observer: "published-binocular-natural-pupil-reference";
  /** Mean luminance of the uniform D65 background and grating. Not the average of a photographic ROI. */
  meanLuminanceCdPerSquareMeter: number;
  spatialFrequencyCyclesPerDegree: number;
  gaussianEnvelopeSigmaDegrees: number;
  temporalFrequencyHz: number;
  eccentricityDegrees: number;
  /** Fractional amplitude of the neutral grating before the Gaussian envelope. Not taken from ROI minimum and maximum values. */
  modulationMichelson: number;
}
export interface PrintContrastReference {
  referenceId: string;
  engineApiVersion: string;
  modelVersion: typeof PRINT_CONTRAST_REFERENCE_MODEL_VERSION;
  upstreamRevision: typeof PRINT_CONTRAST_REFERENCE_UPSTREAM_REVISION;
  input: PrintContrastReferenceInput;
  status: "model-estimate" | "unsupported";
  blockers: string[];
  estimate: { contrastSensitivity: number; thresholdModulationMichelson: number; suppliedModulationToModelThresholdRatio: number } | null;
  observerApplicability: "population-reference-unverified-for-individual";
  naturalImageVisibility: "unassessed";
  printStimulusMatch: "unassessed";
  uncertainty: "not-quantified";
  overallPrintVerdict: "not-offered";
}

/** Strictly parses and copies the explicit reference conditions. No defaults are filled in to imply an observer. */
export function parsePrintContrastReferenceInput(value: unknown): PrintContrastReferenceInput {
  const r = requireAllowlistedRecord(value, ["referenceId", "stimulus", "observer", "meanLuminanceCdPerSquareMeter", "spatialFrequencyCyclesPerDegree",
    "gaussianEnvelopeSigmaDegrees", "temporalFrequencyHz", "eccentricityDegrees", "modulationMichelson"], "Invalid Print contrast reference fields.");
  const number = (key: string, positive: boolean): number => {
    const v = r[key];
    if (typeof v !== "number" || !Number.isFinite(v) || (positive ? v <= 0 : v < 0)) throw new InvalidConfigurationError("Print contrast reference quantities must be finite and in their numeric domain.");
    return v === 0 ? 0 : v;
  };
  if (r.stimulus !== "static-neutral-d65-gabor" || r.observer !== "published-binocular-natural-pupil-reference") throw new InvalidConfigurationError("Unknown Print reference stimulus/observer.");
  const modulationMichelson = number("modulationMichelson", false);
  if (modulationMichelson > 1) throw new InvalidConfigurationError("Reference Michelson modulation must be at most one.");
  return { referenceId: requirePublicOpaqueId(r.referenceId, "Invalid public Print contrast reference identity."), stimulus: r.stimulus, observer: r.observer,
    meanLuminanceCdPerSquareMeter: number("meanLuminanceCdPerSquareMeter", true), spatialFrequencyCyclesPerDegree: number("spatialFrequencyCyclesPerDegree", true),
    gaussianEnvelopeSigmaDegrees: number("gaussianEnvelopeSigmaDegrees", true), temporalFrequencyHz: number("temporalFrequencyHz", false),
    eccentricityDegrees: number("eccentricityDegrees", false), modulationMichelson };
}

// Independently written scalar evaluation of the licensed numerical model.
// Using log1p/expm1 keeps the hyperbolic terms accurate where the small quantity k_s4/Y (about 5.6e-10 at 1000 cd/m²) would cancel.
function luminanceDependency(p: readonly number[], luminance: number): number {
  if (p.length === 2) return p[1]! * luminance ** p[0]!;
  const first = p[0]! * Math.exp(-p[2]! * Math.log1p(p[1]! / luminance));
  return p.length === 3 ? first : first * -Math.expm1(-p[4]! * Math.log1p(p[3]! / luminance));
}
function component(frequency: number, area: number, peak: number, peakFrequency: number, bandwidth: number, lowFrequencyFloor: number, a0: number, f0: number): number {
  const logDifference = Math.log10(frequency) - Math.log10(peakFrequency);
  const parabola = 10 ** (-logDifference * logDifference / 2 ** bandwidth);
  const shape = frequency < peakFrequency ? Math.max(parabola, lowFrequencyFloor) : parabola;
  const criticalArea = a0 / (1 + (frequency / f0) ** 2);
  return peak * shape * Math.sqrt(criticalArea / (1 + criticalArea / area)) * frequency;
}
function staticNeutralSensitivity(luminance: number, frequency: number): number {
  const area = Math.PI * 1.5 ** 2;
  const sustained = component(frequency, area, luminanceDependency([56.4947, 7.54726, .144532, 5.58341e-7, 9.66862e9], luminance),
    luminanceDependency([1.78119, 91.5718, .256682], luminance), .000213047, 1 - .100207, 157.103, .702338);
  const transient = component(frequency, area, luminanceDependency([.193434, 2748.09], luminance), .000316696, 2.6761, 1 - .000241177, 3.81611, 3.01389);
  const omegaPeak = Math.log10(luminance) * 2.41482 + 4.7036;
  const achromatic = sustained + transient * Math.exp(-((omegaPeak ** .1898) ** 2) / .0844836);
  const redGreen = component(frequency, area, luminanceDependency([681.434, 38.0038, .480386], luminance), .0178364, 2.42104, 1, 2816.44, .0711058);
  const yellowViolet = component(frequency, area, luminanceDependency([166.683, 62.8974, .41193], luminance), .00425753, 2.68197, 1, 2.82789e7, .000635093);
  // Modulate each cone channel of the D65 LMS background [L,M,S] by the same fraction.
  // All three mechanism responses are kept, including nonzero colour-opponent parts.
  const redGreenProjection = Math.abs(.6991 - 2.3112 * .3009);
  const yellowVioletProjection = Math.abs(-.6991 - .3009 + 50.9875 * .0198);
  return Math.hypot(achromatic, redGreenProjection * redGreen, yellowVioletProjection * yellowViolet);
}

/** Estimates the detection threshold from the published model, within its limited range. It does not claim that detail is invisible to any particular person. */
export function calculatePrintContrastReference(value: PrintContrastReferenceInput): CalculationResult<PrintContrastReference> {
  const input = parsePrintContrastReferenceInput(value), l = input.meanLuminanceCdPerSquareMeter, f = input.spatialFrequencyCyclesPerDegree;
  const result: PrintContrastReference = { referenceId: input.referenceId, engineApiVersion: ENGINE_API_VERSION, modelVersion: PRINT_CONTRAST_REFERENCE_MODEL_VERSION,
    upstreamRevision: PRINT_CONTRAST_REFERENCE_UPSTREAM_REVISION, input, status: "unsupported", blockers: [], estimate: null,
    observerApplicability: "population-reference-unverified-for-individual", naturalImageVisibility: "unassessed", printStimulusMatch: "unassessed",
    uncertainty: "not-quantified", overallPrintVerdict: "not-offered" };
  if (l < 1 || l > 1000 || f < .25 || f > 16 || input.gaussianEnvelopeSigmaDegrees !== 1.5 || input.temporalFrequencyHz !== 0 || input.eccentricityDegrees !== 0) result.blockers.push("outside-static-neutral-reference-domain");
  else {
    const sensitivity = staticNeutralSensitivity(l, f), threshold = 1 / sensitivity, ratio = input.modulationMichelson * sensitivity;
    if (![sensitivity, threshold, ratio].every(Number.isFinite) || sensitivity <= 0 || threshold <= 0) result.blockers.push("contrast-reference-numeric-range-unsupported");
    else { result.status = "model-estimate"; result.estimate = { contrastSensitivity: sensitivity, thresholdModulationMichelson: threshold, suppliedModulationToModelThresholdRatio: ratio }; }
  }
  return freezeOwnedData(estimatedResult(result, "castlecsf-static-neutral-d65-reference", PRINT_CONTRAST_REFERENCE_MODEL_VERSION,
    ["Static foveal D65 equal-fraction LMS Gabor; Gaussian envelope sigma is exactly 1.5 degrees.",
      "Published population model reference; personal eyesight, natural-image masking and actual print-stimulus matching remain unassessed.",
      "The numerical envelope is restricted; published model-fit errors do not become an individual confidence interval or a print verdict."], {
      validRanges: [
        { parameterPath: "meanLuminanceCdPerSquareMeter", unit: "cd/m^2", minimum: 1, maximum: 1000, note: "Restricted numerical reference envelope; no individual calibration." },
        { parameterPath: "spatialFrequencyCyclesPerDegree", unit: "cycles/degree", minimum: .25, maximum: 16 },
        { parameterPath: "gaussianEnvelopeSigmaDegrees", unit: "degree", minimum: 1.5, maximum: 1.5 },
        { parameterPath: "temporalFrequencyHz", unit: "Hz", minimum: 0, maximum: 0 },
        { parameterPath: "eccentricityDegrees", unit: "degree", minimum: 0, maximum: 0 }
      ], notes: ["Uncertainty is not quantified; numerical conformance is distinct from stimulus/observer qualification."]
    }));
}
