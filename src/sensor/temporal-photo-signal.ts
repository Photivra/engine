// SPDX-License-Identifier: Apache-2.0

/**
 * Time-resolved photo signal: a compact record of the expected photon and electron counts for one site
 * over one exposure, with the rate at each midpoint time.
 *
 * Creating it re-evaluates the physical input at every time. Parsing it recomputes the midpoint sums
 * exactly. Neither proves the light source is correct.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { requireAllowlistedRecord, requirePublicOpaqueId, requireInputKeys } from "../core/record-validation.js";
import { sumTemporalEqeRateExpectations } from "./temporal-eqe-sum.js";
import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { parseEvidenceList, type EvidenceProvenance } from "../core/evidence-provenance.js";
import { freezeOwnedData } from "../core/owned-data.js";
import type { SensorEqeExposureIntegration } from "./constant-rate-temporal-integration.js";
import { calculateSensorEqeTemporalExposure, type CalculateSensorEqeTemporalExposureInput } from "./eqe-temporal-exposure.js";

/** Compact expected photo signal, before any processing. Being tied to a time window is not evidence that the light was constant. */
export interface SensorEqeTemporalPhotoSignal extends Omit<SensorEqeExposureIntegration,
  "kind" | "stationarityProfileId" | "stationarityStatus" | "integrationMethod" | "timeStationarityEstablished" |
  "timeVaryingSignalIntegrated" | "incidentPhotonRatePerSecond" | "expectedGeneratedElectronRatePerSecond" | "componentEvidence"> {
  kind: "eqe-temporal-photo-signal";
  temporalIntegrationId: string;
  stationarityProfileId?: never;
  integrationMethod: "uniform-midpoint-rate-quadrature";
  timeStationarityEstablished: false;
  timeVaryingSignalIntegrated: true;
  temporalSamples: readonly {
    timeSecondsFromOpeningReference: number;
    incidentPhotonRatePerSecond: number;
    expectedGeneratedElectronRatePerSecond: number;
  }[];
  componentEvidence: {
    temporalResponse: readonly EvidenceProvenance[];
    exposureBinding: SensorEqeExposureIntegration["componentEvidence"]["exposureBinding"];
  };
}

export type SensorEqePhotoExposure = SensorEqeExposureIntegration | SensorEqeTemporalPhotoSignal;

/** The photo-signal flags that must be true, and (after the first) false, shared with the RAW producer's checks. */
export const PHOTO_SIGNAL_TRUE_FIELDS = ["temporalIntegrationApplied", "exposureDurationApplied", "countsAreExpectationValues"] as const;
export const PHOTO_SIGNAL_DOWNSTREAM_FALSE_FIELDS = ["multiFrameSequenceIntegrated", "darkChargeIncluded", "otherChargeIncluded",
  "physicalFullWellAssessmentAuthorized", "cameraSaturationAssessmentAuthorized", "saturationAssessed", "shotNoiseApplied",
  "readNoiseApplied", "adcQuantizationApplied", "rawCodeValueProduced", "integerPhotonCountSampled", "integerElectronCountSampled",
  "chargeCalculated", "currentCalculated"] as const;
const trueFields = PHOTO_SIGNAL_TRUE_FIELDS;
const falseFields = ["timeStationarityEstablished", ...PHOTO_SIGNAL_DOWNSTREAM_FALSE_FIELDS] as const;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return requireAllowlistedRecord(value, keys, "Invalid temporal photo-signal fields.");
}
function identity(value: unknown): string {
  return requirePublicOpaqueId(value, "Temporal photo signal requires public identities.");
}
function finite(value: unknown, nonnegative = true): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (nonnegative && value < 0)) {
    throw new InvalidConfigurationError("Temporal photo-signal numeric quantity is invalid.");
  }
  return value;
}
/** Parses a time-resolved photo signal and recomputes its midpoint sums exactly. Declarations do not prove the source is correct. */
export function parseSensorEqeTemporalPhotoSignal(value: unknown): SensorEqeTemporalPhotoSignal {
  const r = record(value, [...trueFields, ...falseFields, "kind", "temporalIntegrationId", "colorSamplingProfileId", "channelId", "site",
    "bindingId", "timeReference", "startOffsetSecondsFromOpeningReference", "endOffsetSecondsFromOpeningReference",
    "localExposureDurationSeconds", "integrationMethod", "timeVaryingSignalIntegrated", "accumulatedSignalCompleteness",
    "expectedIncidentPhotonCount", "expectedGeneratedElectronCount", "temporalSamples", "componentEvidence"]);
  if (r.kind !== "eqe-temporal-photo-signal" || r.integrationMethod !== "uniform-midpoint-rate-quadrature" ||
    r.timeReference !== "first-opening-boundary-phase" || r.timeVaryingSignalIntegrated !== true ||
    r.accumulatedSignalCompleteness !== "photo-signal-only" || trueFields.some(k => r[k] !== true) || falseFields.some(k => r[k] !== false)) {
    throw new InvalidConfigurationError("Temporal photo signal requires untreated midpoint-integrated EQE expectations.");
  }
  const site = record(r.site, ["x", "y"]);
  for (const v of [site.x, site.y]) if (!Number.isSafeInteger(v) || (v as number) < 0) throw new InvalidConfigurationError("Invalid temporal photo site.");
  const start = finite(r.startOffsetSecondsFromOpeningReference), end = finite(r.endOffsetSecondsFromOpeningReference);
  const duration = finite(r.localExposureDurationSeconds);
  if (!(end > start) || duration !== end-start) throw new InvalidConfigurationError("Temporal photo signal requires exact local duration.");
  if (!Array.isArray(r.temporalSamples) || r.temporalSamples.length < 1 || r.temporalSamples.length > 256) {
    throw new InvalidConfigurationError("Temporal photo signal requires 1 through 256 dense midpoint samples.");
  }
  const measure = duration / r.temporalSamples.length;
  let previous = -Infinity;
  const temporalSamples = Array.from(r.temporalSamples, (v, i) => {
    const s = record(v, ["timeSecondsFromOpeningReference", "incidentPhotonRatePerSecond", "expectedGeneratedElectronRatePerSecond"]);
    const time = finite(s.timeSecondsFromOpeningReference), pr = finite(s.incidentPhotonRatePerSecond), er = finite(s.expectedGeneratedElectronRatePerSecond);
    if (time !== start + (i+0.5)*measure || !(time > start && time > previous && time < end) || er > pr) {
      throw new InvalidConfigurationError("Temporal photo midpoint time or EQE rate domain is invalid.");
    }
    previous = time;
    return { timeSecondsFromOpeningReference: time, incidentPhotonRatePerSecond: pr, expectedGeneratedElectronRatePerSecond: er };
  });
  const { photonCount: photons, electronCount: electrons } = sumTemporalEqeRateExpectations(temporalSamples, measure);
  if (!Number.isFinite(photons) || !Number.isFinite(electrons) ||
    finite(r.expectedIncidentPhotonCount) !== photons || finite(r.expectedGeneratedElectronCount) !== electrons) {
    throw new InvalidConfigurationError("Temporal photo counts do not match the exact midpoint rate integral.");
  }
  const e = record(r.componentEvidence, ["temporalResponse", "exposureBinding"]);
  const b = record(e.exposureBinding, ["binding", "colorSamplingProfile", "nominalExposureDuration", "openingBoundary", "closingBoundary"]);
  const optional = (v: unknown): readonly EvidenceProvenance[] => Array.isArray(v) && v.length === 0 ? [] : parseEvidenceList(v, "temporalExposureEvidence");
  return { ...r, colorSamplingProfileId: identity(r.colorSamplingProfileId), channelId: identity(r.channelId),
    bindingId: identity(r.bindingId), temporalIntegrationId: identity(r.temporalIntegrationId), site: { x: site.x as number, y: site.y as number }, temporalSamples,
    componentEvidence: { temporalResponse: parseEvidenceList(e.temporalResponse, "temporalResponse"), exposureBinding: {
      binding: parseEvidenceList(b.binding, "binding"), colorSamplingProfile: parseEvidenceList(b.colorSamplingProfile, "colorSamplingProfile"),
      nominalExposureDuration: parseEvidenceList(b.nominalExposureDuration, "nominalExposureDuration"),
      openingBoundary: optional(b.openingBoundary), closingBoundary: optional(b.closingBoundary) } }
  } as unknown as SensorEqeTemporalPhotoSignal;
}

/**
 * Re-evaluates the physical input at every time, then commits a compact photo
 * signal. Detailed per-step evidence and uncertainty stay in the returned
 * exposure diagnostics. This does not show that a renderer or source actually ran.
 */
export function createSensorEqeTemporalPhotoSignal(input: {
  temporalIntegrationId: string;
  exposure: CalculateSensorEqeTemporalExposureInput;
}): CalculationResult<{ photoSignal: SensorEqeTemporalPhotoSignal; exposure: ReturnType<typeof calculateSensorEqeTemporalExposure> }> {
  requireInputKeys(input, "createSensorEqeTemporalPhotoSignal", ["temporalIntegrationId", "exposure"]);
  identity(input.temporalIntegrationId);
  const exposure = calculateSensorEqeTemporalExposure(input.exposure), v = exposure.value;
  const p = { kind: "eqe-temporal-photo-signal", temporalIntegrationId: input.temporalIntegrationId,
    colorSamplingProfileId: v.colorSamplingProfileId, channelId: v.channelId, site: v.site, bindingId: v.bindingId,
    timeReference: v.timeReference, startOffsetSecondsFromOpeningReference: v.startOffsetSecondsFromOpeningReference,
    endOffsetSecondsFromOpeningReference: v.endOffsetSecondsFromOpeningReference, localExposureDurationSeconds: v.localExposureDurationSeconds,
    expectedIncidentPhotonCount: v.expectedIncidentPhotonCount, expectedGeneratedElectronCount: v.expectedGeneratedElectronCount,
    integrationMethod: v.integrationMethod, timeVaryingSignalIntegrated: true, accumulatedSignalCompleteness: "photo-signal-only",
    temporalSamples: v.samples.map(s => ({ timeSecondsFromOpeningReference: s.timeSecondsFromOpeningReference,
      incidentPhotonRatePerSecond: s.stages.electronRate.value.incidentPhotonRatePerSecond,
      expectedGeneratedElectronRatePerSecond: s.stages.electronRate.value.expectedGeneratedElectronRatePerSecond })),
    componentEvidence: { temporalResponse: v.samples[0]!.stages.spectralQuadrature.value.componentEvidence.profile,
      exposureBinding: v.samples[0]!.stages.exposureBinding.value.componentEvidence },
    ...Object.fromEntries(trueFields.map(k => [k, true])), ...Object.fromEntries(falseFields.map(k => [k, false])) };
  const photoSignal = freezeOwnedData(parseSensorEqeTemporalPhotoSignal(p));
  return approximationResult({ photoSignal, exposure }, "sensor-eqe-temporal-photo-signal", "0.1.0", [
    "Photo signal commits explicit midpoint EQE rate expectations, not stationarity or source-truth evidence.",
    "Child diagnostics retain separate validity, evidence and uncombined uncertainty; no convergence bound is inferred."
  ]);
}
