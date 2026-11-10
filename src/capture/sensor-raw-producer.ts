// SPDX-License-Identifier: Apache-2.0

/**
 * Produces a sensor RAW frame from per-site exposure inputs, using the existing sensor steps:
 * accumulated charge → capacity → Poisson (shot) noise → read noise and ADC → native sample →
 * immutable frame.
 *
 * Inputs must be complete. Charge, noise or RAW codes cannot be passed in as a shortcut.
 * @see docs/SIMULATED_CAPTURE.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { requireAllowlistedRecord, requirePublicOpaqueId } from "../core/record-validation.js";

import { parseSensorEqeTemporalPhotoSignal, PHOTO_SIGNAL_DOWNSTREAM_FALSE_FIELDS, PHOTO_SIGNAL_TRUE_FIELDS } from "../sensor/temporal-photo-signal.js";
import { RAW_REFERENCE_MAX_NATIVE_SITES } from "./raw-frame-limits.js";

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { parseEvidenceList } from "../core/evidence-provenance.js";
import { parseSimulatedCapture } from "./simulated-capture.js";
import { createSensorRawFrame, type SensorRawFrameInput, type SensorRawFrame } from "./sensor-raw-frame.js";
import { composeSensorAccumulatedCharge, parseSensorAccumulatedChargeCompletenessProfile, parseSensorAdditionalStoredChargeComponent,
  type ComposeSensorPhotoAccumulatedChargeInput as ComposeSensorAccumulatedChargeInput } from "../sensor/accumulated-charge.js";
import { assessSensorPhysicalChargeCapacity, parseSensorPhysicalChargeCapacityProfile,
  type SensorPhysicalChargeCapacityProfile } from "../sensor/physical-charge-capacity.js";
import { simulateSensorChargeRealization, simulateSensorRawCode, parseSensorChargeSamplingProfile,
  parseSensorReadoutConversionProfile, resolveSensorReadoutRegime, type SensorChargeSamplingProfile, type SensorReadoutConversionProfile } from "../sensor/raw-readout.js";
import { createSensorRawCaptureSample } from "../sensor/raw-reconstruction.js";
import type { ExposureBuildUpStage } from "./exposure-build-up-stage.js";
import { parseSensorFixedPatternNoiseProfile, type SensorFixedPatternNoiseProfile } from "../sensor/fixed-pattern-noise.js";
import { deriveNativeSiteStreamSeedUint32, NATIVE_SITE_CHARGE_STREAM_ID, NATIVE_SITE_READ_NOISE_STREAM_ID } from "../sensor/stochastic-seed.js";
import { parseSensorColorSamplingProfile } from "../sensor/color-sampling.js";
import { parseCaptureModeProfile } from "../sensor/capture-mode.js";
import { parseNativeEffectiveRasterColorSamplingBindingProfile, resolveCaptureModeColorSamplingContributors } from "../sensor/capture-color-sampling-binding.js";
import { calculateCaptureExposureWindows, type CalculateCaptureExposureWindowsInput, type CaptureExposureWindows } from "../sensor/exposure-window.js";

export const SENSOR_RAW_PRODUCER_SCHEMA_VERSION = "0.3.0" as const;
/**
 * Version of the capture noise model. It fixes the hashed per-site seed schedule and the signed electronic
 * readout behaviour.
 *
 * 0.4.0: exact ADC rounding with ties up, normal-approximation Poisson draws for means of 1e9 and above,
 * optional post-ADC digital gain and INL (integral non-linearity), and optional per-sensor fixed-pattern noise.
 */
export const SENSOR_RAW_PRODUCER_NOISE_MODEL = /* @__PURE__ */ Object.freeze({ id: "photivra-native-raw-noise", version: "0.4.0" } as const);
/** For each native site: one declared exposure event (EQE photo signal, dark signal, charge completeness) and its readout state. */
export interface SensorRawProducerSiteInput {
  charge: ComposeSensorAccumulatedChargeInput;
  samplingProfile: SensorChargeSamplingProfile;
  capacityProfile: SensorPhysicalChargeCapacityProfile;
  operatingStateId: string;
  readoutProfile: SensorReadoutConversionProfile;
  regimeId: string;
  /** Optional fixed-pattern noise (FPN) for this sensor; one profile for the whole frame. Omit it to disable FPN. */
  fixedPatternNoise?: SensorFixedPatternNoiseProfile;
}
/** Exposure schedule for the full sensor. The producer owns the sampling coordinates. */
export type SensorRawProducerExposureWindowInput = Omit<CalculateCaptureExposureWindowsInput,
  "nativeRaster" | "activeCaptureRect" | "samplePointsNative">;
/** Input for one bounded frame. It is never a conversion from separate RGB pixels. */
export interface SensorRawProducerInput {
  frame: Omit<SensorRawFrameInput, "samples">;
  sites: readonly SensorRawProducerSiteInput[];
  /** If omitted, every event uses the existing global window 0..shutterSeconds. */
  exposureWindow?: SensorRawProducerExposureWindowInput;
}
/** Codes produced by the engine, with per-step diagnostics. The upstream radiance and response are as declared, not verified. */
export interface SensorRawProducerResult {
  schemaVersion: typeof SENSOR_RAW_PRODUCER_SCHEMA_VERSION;
  codeProducer: "engine-charge-capacity-noise-adc";
  upstreamOrigin: "declared-eqe-and-dark-exposure-results";
  upstreamRadiometryVerified: false;
  seedSchedule: "murmur3-capture-seed-native-index-stream-v2";
  frame: SensorRawFrame;
  localExposureWindows?: CalculationResult<CaptureExposureWindows>;
  sites: readonly {
    accumulatedCharge: ReturnType<typeof composeSensorAccumulatedCharge>;
    capacity: ReturnType<typeof assessSensorPhysicalChargeCapacity>;
    realization: ReturnType<typeof simulateSensorChargeRealization>;
    readout: ReturnType<typeof simulateSensorRawCode>;
  }[];
}
function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  return requireAllowlistedRecord(value, allowed, "Invalid sensor RAW producer fields.");
}
function publicId(value: unknown): string {
  return requirePublicOpaqueId(value, "Expected public producer identity.");
}
const KEY_RECURSE = 0, KEY_IDENTITY = 1, KEY_IDENTITY_LIST = 2;
/** Bounded cache of how the identity check classifies each property name (it depends only on the name). */
const IDENTITY_KEY_KINDS = new Map<string, number>();
/** Bounded cache of strings already known to be valid public IDs (validity depends only on the string). */
const VALID_PUBLIC_IDS = new Set<string>();
const IDENTITY_WALK_MEMO_LIMIT = 4096;
function identityKeyKind(key: string): number {
  // Array indices and other names ending in a digit match neither suffix.
  const last = key.charCodeAt(key.length - 1);
  if (last >= 48 && last <= 57) return KEY_RECURSE;
  let kind = IDENTITY_KEY_KINDS.get(key);
  if (kind === undefined) {
    kind = /(?:Id|Version)$/.test(key) ? KEY_IDENTITY : /Ids$/.test(key) ? KEY_IDENTITY_LIST : KEY_RECURSE;
    if (IDENTITY_KEY_KINDS.size < IDENTITY_WALK_MEMO_LIMIT) IDENTITY_KEY_KINDS.set(key, kind);
  }
  return kind;
}
function memoizedPublicId(value: unknown): void {
  if (typeof value === "string" && VALID_PUBLIC_IDS.has(value)) return;
  publicId(value);
  if (VALID_PUBLIC_IDS.size < IDENTITY_WALK_MEMO_LIMIT) VALID_PUBLIC_IDS.add(value as string);
}
/**
 * At any depth, every property whose name ends in Id or Version must hold a public ID, and every property
 * ending in Ids a bounded dense list of them. Order, keys and errors are the same as the earlier
 * Object.entries walk. Key classification and already-valid IDs are cached, because each depends only on
 * its string.
 */
function publicIdentities(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>, keys = Object.keys(record);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!, kind = identityKeyKind(key), child = record[key];
    if (kind === KEY_IDENTITY) memoizedPublicId(child);
    else if (kind === KEY_IDENTITY_LIST) dense(child, 256).forEach(memoizedPublicId);
    else if (child !== null && typeof child === "object") publicIdentities(child);
  }
}
function dense(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Array.from({ length: value.length }, (_, i) => i in value).includes(false)) {
    throw new InvalidConfigurationError("Expected bounded dense producer array.");
  }
  return value;
}
function optionalEvidence(value: unknown): ReturnType<typeof parseEvidenceList> {
  return dense(value, 256).length === 0 ? [] : parseEvidenceList(value, "optionalExposureEvidence");
}
function exposureEvidence(value: unknown, temporalPhoto?: Record<string, unknown>): ComposeSensorAccumulatedChargeInput["photoSignal"]["componentEvidence"] {
  if (temporalPhoto !== undefined) return parseSensorEqeTemporalPhotoSignal({ ...temporalPhoto, componentEvidence: value }).componentEvidence;
  const r = fields(value, ["stationarity", "exposureBinding"]);
  const b = fields(r.exposureBinding, ["binding", "colorSamplingProfile", "nominalExposureDuration", "openingBoundary", "closingBoundary"]);
  return { stationarity: parseEvidenceList(r.stationarity, "stationarity"), exposureBinding: {
    binding: parseEvidenceList(b.binding, "binding"), colorSamplingProfile: parseEvidenceList(b.colorSamplingProfile, "colorSamplingProfile"),
    nominalExposureDuration: parseEvidenceList(b.nominalExposureDuration, "nominalExposureDuration"),
    openingBoundary: optionalEvidence(b.openingBoundary), closingBoundary: optionalEvidence(b.closingBoundary) } };
}
const common = ["colorSamplingProfileId", "channelId", "site", "bindingId", "stationarityProfileId", "timeReference",
  "startOffsetSecondsFromOpeningReference", "endOffsetSecondsFromOpeningReference", "localExposureDurationSeconds", "componentEvidence"];
const photoTrue: string[] = ["timeStationarityEstablished", ...PHOTO_SIGNAL_TRUE_FIELDS];
const photoFalse: string[] = ["timeVaryingSignalIntegrated", ...PHOTO_SIGNAL_DOWNSTREAM_FALSE_FIELDS];
function chargeInput(value: unknown): ComposeSensorAccumulatedChargeInput {
  const r = fields(value, ["photoSignal", "darkCharge", "additionalChargeComponents", "completenessProfile"]);
  const temporal = r.photoSignal !== null && typeof r.photoSignal === "object" &&
    (r.photoSignal as Record<string, unknown>).kind === "eqe-temporal-photo-signal";
  const p = temporal ? parseSensorEqeTemporalPhotoSignal(r.photoSignal) as unknown as Record<string, unknown> : fields(r.photoSignal, [...common, ...photoTrue, ...photoFalse, "kind", "stationarityStatus", "integrationMethod",
    "accumulatedSignalCompleteness", "incidentPhotonRatePerSecond", "expectedGeneratedElectronRatePerSecond", "expectedIncidentPhotonCount", "expectedGeneratedElectronCount"]);
  const darkFalse = ["integerDarkElectronCountSampled", "darkShotNoiseApplied", "darkCurrentCompensationApplied", "photoSignalIncluded",
    "otherChargeIncluded", "physicalFullWellAssessmentAuthorized", "saturationAssessed"];
  const d = fields(r.darkCharge, [...common, ...darkFalse, "darkCurrentProfileId", "operatingTemperatureC", "temperatureModel",
    "temperatureInterpolationUsed", "temporalIntegrationId", "darkCurrentElectronsPerSecond", "expectedDarkElectronCount", "countMeaning", "expectationValueOnly", "spatialDarkCurrentNonuniformityModeled"]);
  if ((!temporal && (p.kind !== "eqe-expected-counts" || p.integrationMethod !== "constant-rate-times-local-exposure-duration" ||
      p.accumulatedSignalCompleteness !== "photo-signal-only" || (p.stationarityStatus !== "established" && p.stationarityStatus !== "approximation") ||
      photoTrue.some((k) => p[k] !== true) || photoFalse.some((k) => p[k] !== false))) || darkFalse.some((k) => d[k] !== false) ||
      d.expectationValueOnly !== true || d.countMeaning !== "expected-thermally-generated-electrons" ||
      typeof d.spatialDarkCurrentNonuniformityModeled !== "boolean" || typeof d.temperatureInterpolationUsed !== "boolean" ||
      (d.temperatureModel !== "fixed-reference-temperature" && d.temperatureModel !== "piecewise-linear-temperature-table" &&
        d.temperatureModel !== "log-linear-temperature-table")) {
    throw new InvalidConfigurationError("Producer requires untreated EQE/dark exposure expectations, not sampled, clipped or A/W charge.");
  }
  if (d.temperatureModel === "fixed-reference-temperature" && d.temperatureInterpolationUsed !== false) {
    throw new InvalidConfigurationError("Fixed-temperature dark result cannot claim temperature interpolation.");
  }
  for (const record of [p, d]) {
    for (const k of ["colorSamplingProfileId", "channelId", "bindingId", temporal ? "temporalIntegrationId" : "stationarityProfileId"]) publicId(record[k]);
    fields(record.site, ["x", "y"]);
    if (record.timeReference !== "first-opening-boundary-phase") throw new InvalidConfigurationError("Unsupported producer time origin.");
  }
  publicId(d.darkCurrentProfileId);
  for (const [record, keys] of [[p, ["incidentPhotonRatePerSecond", "expectedGeneratedElectronRatePerSecond", "expectedIncidentPhotonCount", "expectedGeneratedElectronCount"]],
    [d, ["darkCurrentElectronsPerSecond", "expectedDarkElectronCount"]]] as const) {
    for (const k of keys) if (!(temporal && record === p && k.endsWith("RatePerSecond")) && (typeof record[k] !== "number" || !Number.isFinite(record[k]) || record[k] < 0)) throw new InvalidConfigurationError("Invalid expected rates/counts.");
  }
  const duration = p.localExposureDurationSeconds;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 ||
      (!temporal && (p.expectedIncidentPhotonCount !== (p.incidentPhotonRatePerSecond as number)*duration ||
      p.expectedGeneratedElectronCount !== (p.expectedGeneratedElectronRatePerSecond as number)*duration)) ||
      d.expectedDarkElectronCount !== (d.darkCurrentElectronsPerSecond as number)*duration ||
      (p.expectedGeneratedElectronCount as number) > (p.expectedIncidentPhotonCount as number)) {
    throw new InvalidConfigurationError("Exposure expectations must match their exact temporal integral or constant-rate products and EQE domain.");
  }
  const e = fields(d.componentEvidence, ["darkCurrent", "siteApproximation", "exposure"]);
  const charge = { photoSignal: { ...p, componentEvidence: exposureEvidence(p.componentEvidence, temporal ? p : undefined) },
    darkCharge: { ...d, componentEvidence: { darkCurrent: parseEvidenceList(e.darkCurrent, "darkCurrent"),
      siteApproximation: optionalEvidence(e.siteApproximation), exposure: exposureEvidence(e.exposure, temporal ? p : undefined) } },
    completenessProfile: parseSensorAccumulatedChargeCompletenessProfile(r.completenessProfile),
    ...(r.additionalChargeComponents === undefined ? {} : { additionalChargeComponents:
      dense(r.additionalChargeComponents, 32).map(parseSensorAdditionalStoredChargeComponent) }) } as unknown as ComposeSensorAccumulatedChargeInput;
  // The existing charge composition checks that photo, dark, additional and completeness events agree exactly.
  composeSensorAccumulatedCharge(charge);
  return charge;
}
function localWindows(frame: SensorRawProducerInput["frame"], value: unknown): CalculationResult<CaptureExposureWindows> {
  const r = fields(value, ["shutterMechanism", "nominalExposureDurationSeconds", "opening", "closing"]);
  fields(r.nominalExposureDurationSeconds, ["value", "unit", "evidence"]);
  for (const boundary of [r.opening, r.closing]) {
    const b = fields(boundary, ["kind", "directionNative", "traversalDurationSeconds"]);
    if (b.directionNative !== undefined) fields(b.directionNative, ["value", "evidence"]);
    if (b.traversalDurationSeconds !== undefined) fields(b.traversalDurationSeconds, ["value", "unit", "evidence"]);
  }
  const native = frame.capture.geometry.nativeRaster;
  const timing = calculateCaptureExposureWindows({
    ...r as unknown as SensorRawProducerExposureWindowInput,
    nativeRaster: native,
    samplePointsNative: Array.from({ length: native.pixelWidth*native.pixelHeight }, (_, i) => ({
      x: i%native.pixelWidth+0.5, y: Math.floor(i/native.pixelWidth)+0.5
    }))
  });
  if (timing.value.nominalExposureDurationSeconds.value !== frame.capture.exposure.shutterSeconds) {
    throw new InvalidConfigurationError("Exposure schedule nominal duration differs from committed capture.");
  }
  return timing;
}
function sourceBoundary(schedule: CaptureExposureWindows["opening"]["schedule"]): SensorRawProducerExposureWindowInput["opening"] {
  return schedule.kind === "simultaneous" ? { kind: "simultaneous" } : {
    kind: "uniform-linear-native-scan", directionNative: schedule.directionNative,
    traversalDurationSeconds: schedule.traversalDurationSeconds
  };
}
/** Internal: per-site validation shared by the reference path and bounded packed execution. */
export type NativeRawProducerFrameContext = Omit<SensorRawProducerInput["frame"], "capture"> & {
  capture: Pick<SensorRawProducerInput["frame"]["capture"], "geometry" | "exposure" | "noise" | "focus" | "sceneStateId" | "sceneTimeSeconds">;
};
export function parseNativeRawProducerSite(site: unknown, i: number, frame: NativeRawProducerFrameContext,
  window?: CaptureExposureWindows["samples"][number]): SensorRawProducerSiteInput {
  const native = frame.capture.geometry.nativeRaster;
    const s = fields(site, ["charge", "samplingProfile", "capacityProfile", "operatingStateId", "readoutProfile", "regimeId", "fixedPatternNoise"]);
    const charge = chargeInput(s.charge), p = charge.photoSignal;
    const contributors = resolveCaptureModeColorSamplingContributors({ nativeRaster: native, captureModeProfile: frame.captureModeProfile,
      modeId: frame.modeId, colorSamplingProfile: frame.colorSamplingProfile, bindingProfile: frame.bindingProfile,
      modeSampleIndexFullFrame: { x: i%native.pixelWidth, y: Math.floor(i/native.pixelWidth) } });

    if (contributors.totalContributorSites !== 1 || contributors.channelComposition.kind !== "single-channel" ||
        p.colorSamplingProfileId !== frame.colorSamplingProfile.profileId || p.channelId !== contributors.channelComposition.channelId ||
        p.site.x !== contributors.colorSamplingSiteRect.x || p.site.y !== contributors.colorSamplingSiteRect.y ||
        p.bindingId !== frame.bindingProfile.bindingId || p.startOffsetSecondsFromOpeningReference !== (window?.startOffsetSecondsFromOpeningReference ?? 0) ||
        p.endOffsetSecondsFromOpeningReference !== (window?.endOffsetSecondsFromOpeningReference ?? frame.capture.exposure.shutterSeconds) ||
        p.localExposureDurationSeconds !== (window?.localExposureDurationSeconds ?? frame.capture.exposure.shutterSeconds)) {
      throw new InvalidConfigurationError("Charge site/channel/binding/local exposure differs from committed capture.");
    }
    const readoutProfile = parseSensorReadoutConversionProfile(s.readoutProfile);
    const isoGain = readoutProfile.regimes.find((regime) => regime.regimeId === s.regimeId)?.exposureIndexGain;
    if (isoGain !== undefined && isoGain.exposureIndex !== frame.capture.exposure.iso) {
      throw new InvalidConfigurationError("Readout regime ISO gain differs from the committed capture ISO.");
    }
    return { charge, samplingProfile: parseSensorChargeSamplingProfile(s.samplingProfile), capacityProfile: parseSensorPhysicalChargeCapacityProfile(s.capacityProfile),
      operatingStateId: publicId(s.operatingStateId), readoutProfile, regimeId: publicId(s.regimeId),
      ...(s.fixedPatternNoise === undefined ? {} : { fixedPatternNoise: parseSensorFixedPatternNoiseProfile(s.fixedPatternNoise) }) };
}
export function validateNativeRawReadoutIdentity(s: SensorRawProducerSiteInput, first: SensorRawProducerSiteInput): void {
    publicIdentities(s);
    const readout = resolveSensorReadoutRegime({ profile: s.readoutProfile, regimeId: s.regimeId });
    if (s.readoutProfile.profileId !== first.readoutProfile.profileId || s.regimeId !== first.regimeId ||
        readout.regime.adc.bitDepth > 16 || readout.regime.adc.digitalSaturationCode <= readout.regime.adc.blackLevelCode ||
        s.readoutProfile.colorSamplingProfileId !== s.charge.photoSignal.colorSamplingProfileId ||
        s.readoutProfile.channelId !== s.charge.photoSignal.channelId || s.samplingProfile.completenessProfileId !== s.charge.completenessProfile.profileId ||
        s.fixedPatternNoise?.profileId !== first.fixedPatternNoise?.profileId ||
        s.fixedPatternNoise?.sensorInstanceSeedUint32 !== first.fixedPatternNoise?.sensorInstanceSeedUint32) {
      throw new InvalidConfigurationError("Frame requires one readout identity/regime, one fixed-pattern identity and a positive uint16 RAW code span.");
    }
}
/** The shared per-site pipeline holds all the charge, capacity, random-noise and ADC equations. `i` is the absolute native row-major index. */
export function calculateNativeRawSite(s: SensorRawProducerSiteInput, seed: number, i: number,
  /** Internal (#534): a build-up fraction's stage, which splits the realized counts down to the fraction and reads with its own stream. */
  b?: ExposureBuildUpStage): SensorRawProducerResult["sites"][number] {
  const accumulatedCharge = composeSensorAccumulatedCharge(s.charge);
  const capacity = assessSensorPhysicalChargeCapacity({ accumulatedCharge: accumulatedCharge.value, capacityProfile: s.capacityProfile,
    operatingStateId: s.operatingStateId, operatingTemperatureC: s.charge.darkCharge.operatingTemperatureC });
  const pattern = s.fixedPatternNoise === undefined ? {} : { fixedPatternNoise: s.fixedPatternNoise };
  let realization = simulateSensorChargeRealization({ accumulatedCharge: accumulatedCharge.value, samplingProfile: s.samplingProfile,
    seedUint32: deriveNativeSiteStreamSeedUint32(seed, i, NATIVE_SITE_CHARGE_STREAM_ID), ...pattern });
  if (b) {
    const v = realization.value, photo = b.thin(v.photoRealizedElectronCount, i, 0), dark = b.thin(v.darkRealizedElectronCount, i, 1);
    if (v.additionalComponents.length) throw new InvalidConfigurationError("An exposure build-up takes photo and dark charge only.");
    realization = { ...realization, value: { ...v, photoRealizedElectronCount: photo, darkRealizedElectronCount: dark, totalRealizedStoredElectronEquivalentCount: photo + dark + 0 } };
  }
  const readout = simulateSensorRawCode({ chargeRealization: realization.value, physicalCapacityAssessment: capacity.value,
    readoutProfile: s.readoutProfile, regimeId: s.regimeId,
    readNoiseSeedUint32: deriveNativeSiteStreamSeedUint32(seed, i, b ? b.read : NATIVE_SITE_READ_NOISE_STREAM_ID), ...pattern });
  return { accumulatedCharge, capacity, realization, readout };
}
/** The selected regime's declared INL, which the effective white level needs at saturation. */
function regimeInl(site: SensorRawProducerSiteInput): { adcIntegralNonLinearity?: NonNullable<SensorReadoutConversionProfile["regimes"][number]["adc"]["integralNonLinearity"]> } {
  const inl = site.readoutProfile.regimes.find((r) => r.regimeId === site.regimeId)?.adc.integralNonLinearity;
  return inl === undefined ? {} : { adcIntegralNonLinearity: inl };
}
/** Validates the complete per-site exposure inputs. Charge, noise or RAW codes are never accepted as a shortcut. */
export function parseSensorRawProducerInput(value: unknown): SensorRawProducerInput {
  const r = fields(value, ["frame", "sites", "exposureWindow"]), f = fields(r.frame, ["frameId", "capture", "modeId", "captureModeProfile", "colorSamplingProfile", "bindingProfile", "containerBitDepth"]);
  const capture = parseSimulatedCapture(f.capture), native = capture.geometry.nativeRaster, count = native.pixelWidth*native.pixelHeight;
  const sites = dense(r.sites, RAW_REFERENCE_MAX_NATIVE_SITES);
  const frame = { frameId: publicId(f.frameId), capture, modeId: publicId(f.modeId), containerBitDepth: 16 as const,
    captureModeProfile: parseCaptureModeProfile(f.captureModeProfile), colorSamplingProfile: parseSensorColorSamplingProfile(f.colorSamplingProfile),
    bindingProfile: parseNativeEffectiveRasterColorSamplingBindingProfile(f.bindingProfile) };
  const mode = frame.captureModeProfile.modes.find((m) => m.modeId === frame.modeId);
  if (f.containerBitDepth !== 16 || count > RAW_REFERENCE_MAX_NATIVE_SITES || sites.length !== count ||
      capture.noise.model.id !== SENSOR_RAW_PRODUCER_NOISE_MODEL.id || capture.noise.model.version !== SENSOR_RAW_PRODUCER_NOISE_MODEL.version ||
      frame.colorSamplingProfile.layout.kind !== "periodic-mosaic" || !mode || mode.acquisition.kind !== "single-frame" ||
      mode.perFrameSampling.kind !== "native-effective-raster" || (mode.reconstructionStages?.length ?? 0) !== 0) {
    throw new InvalidConfigurationError("Producer requires exact noise identity and bounded single-frame native CFA coverage.");
  }
  const timing = r.exposureWindow === undefined ? undefined : localWindows(frame, r.exposureWindow);
  const parsed = sites.map((site, i) => parseNativeRawProducerSite(site, i, frame, timing?.value.samples[i]));
  for (const site of parsed) validateNativeRawReadoutIdentity(site, parsed[0]!);
  publicIdentities(frame);
  return { frame, sites: parsed, ...(timing === undefined ? {} : { exposureWindow: {
    shutterMechanism: timing.value.shutterMechanism,
    nominalExposureDurationSeconds: timing.value.nominalExposureDurationSeconds,
    opening: sourceBoundary(timing.value.opening.schedule), closing: sourceBoundary(timing.value.closing.schedule)
  } }) };
}
/** Runs accumulated charge → capacity → Poisson noise → read noise and ADC → native sample → immutable frame. */
export function simulateSensorRawFrame(input: SensorRawProducerInput): CalculationResult<SensorRawProducerResult> {
  const v = parseSensorRawProducerInput(input), seed = v.frame.capture.noise.seedUint32;
  const sites = v.sites.map((s, i) => calculateNativeRawSite(s, seed, i));
  const native = v.frame.capture.geometry.nativeRaster;
  const samples = sites.map((s, i) => createSensorRawCaptureSample({ rawCode: s.readout.value,
    ...regimeInl(v.sites[i]!),
    contributors: resolveCaptureModeColorSamplingContributors({ nativeRaster: native, captureModeProfile: v.frame.captureModeProfile,
      modeId: v.frame.modeId, colorSamplingProfile: v.frame.colorSamplingProfile, bindingProfile: v.frame.bindingProfile,
      modeSampleIndexFullFrame: { x: i%native.pixelWidth, y: Math.floor(i/native.pixelWidth) } }) }));
  return approximationResult({ schemaVersion: SENSOR_RAW_PRODUCER_SCHEMA_VERSION, codeProducer: "engine-charge-capacity-noise-adc",
    upstreamOrigin: "declared-eqe-and-dark-exposure-results", upstreamRadiometryVerified: false,
    seedSchedule: "murmur3-capture-seed-native-index-stream-v2", frame: createSensorRawFrame({ ...v.frame, samples }), sites,
    ...(v.exposureWindow === undefined ? {} : { localExposureWindows: localWindows(v.frame, v.exposureWindow) }) },
  "native-sensor-raw-frame-producer", SENSOR_RAW_PRODUCER_SCHEMA_VERSION, [
    "Untreated EQE/dark exposure results and completeness evidence are upstream declarations; source radiometry is not independently verified",
    "Native row-major site seeds are MurmurHash3_x86_32 of (capture seed, absolute native index, stream 0 charge / 1 read noise); deterministic and non-cryptographic",
    "Existing scalar capacity/noise/readout approximations retain distinct physical/pre-ADC/digital saturation diagnostics; no blooming",
    "Optional fixed-pattern noise is deterministic per sensor instance (its own seed and absolute colour-sampling site), independent of the capture seed",
    "Stationarity applies separately to every exact local window; no time-varying radiance integration, multi-frame acquisition, RGB-to-RAW conversion or production-stage activation",
    "Stored capture float planes remain independent; same-RAW export must use the returned frame's reconstruction handoff"]);
}
