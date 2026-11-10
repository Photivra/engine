// SPDX-License-Identifier: Apache-2.0

/**
 * Synthetic catalog data, owned by the project, for generic camera tiers. Bodies (capabilities and
 * readout) and lenses (optical and correction profiles) are defined separately.
 *
 * Choosing a tier changes explicit profile values. It never applies a universal quality multiplier.
 * The caller still supplies the CFA (colour filter array) and light-collection geometry and the
 * actual capture raster. The numbers are not measured calibration.
 * @see docs/RELEASE_1_0.md and the corresponding domain guide.
 */

import type { EvidenceBackedFact, EvidenceProvenance } from "../core/evidence-provenance.js";
import { parseGenericBodyExposureCapabilityProfile, parseGenericLensExposureCapabilityProfile,
  type GenericBodyExposureCapabilityProfile, type GenericLensExposureCapabilityProfile } from "./exposure-capabilities.js";
import { parseIsoCapabilityProfile, type IsoCapabilityProfile } from "./iso-capabilities.js";
import { parseGenericReleaseCapabilityProfile, type GenericReleaseCapabilityProfile } from "./release-capabilities.js";
import { parseFocusControlProfile, type FocusControlProfile } from "../capture/focus-control.js";
import { parseWhiteBalanceProfile, type WhiteBalanceProfile } from "../color/white-balance.js";
import { parseStabilizationSystemProfile, STABILIZATION_UNMODELED_SCOPE, type StabilizationSystemProfile } from "../stabilization/system.js";
import { parseSensorReadoutConversionProfile, type SensorReadoutConversionProfile } from "../sensor/raw-readout.js";
import { parseGenericIsoSignalChainProfile, type GenericIsoSignalChainProfile } from "../sensor/iso-signal-chain.js";
import { parseExposureMeteringProfile, type ExposureMeteringProfile } from "../exposure/metering.js";
import { parseGenericBodyMeteringCapabilityProfile, type GenericBodyMeteringCapabilityProfile } from "./metering-capabilities.js";
import { parseFlashSyncCapabilityProfile, type FlashSyncCapabilityProfile } from "../exposure/flash.js";
import type { SensorReadoutTimingDeclaration } from "../sensor/readout-timing.js";
import { createIsoGainReadoutRegimes } from "../sensor/iso-gain.js";
import { parseSensorFixedPatternNoiseProfile, type SensorFixedPatternNoiseProfile } from "../sensor/fixed-pattern-noise.js";

export type GenericEquipmentTier = "consumer" | "prosumer" | "professional";
export interface GenericVersionedAsset<T> { assetId: string; assetVersion: string; profile: T }
export interface GenericTierBodyAssets {
  exposure: GenericBodyExposureCapabilityProfile;
  iso: IsoCapabilityProfile;
  signalChain: GenericIsoSignalChainProfile;
  readout: readonly GenericVersionedAsset<SensorReadoutConversionProfile>[];
  /** Global data readout (no skew across the frame). The default timing asset. */
  readoutTiming: GenericVersionedAsset<SensorReadoutTimingDeclaration>;
  /** Optional rolling readout variant, with an explicit top-to-bottom skew across the frame. */
  rollingReadoutTiming: GenericVersionedAsset<SensorReadoutTimingDeclaration>;
  /** Optional synthetic fixed-pattern noise for this body. Never applied unless a caller attaches it. */
  fixedPatternNoise: GenericVersionedAsset<SensorFixedPatternNoiseProfile>;
  release: GenericReleaseCapabilityProfile;
  focus: FocusControlProfile;
  stabilization: StabilizationSystemProfile;
  whiteBalance: WhiteBalanceProfile;
  metering: readonly GenericVersionedAsset<ExposureMeteringProfile>[];
  meteringCapabilities: GenericBodyMeteringCapabilityProfile;
  flashSync: FlashSyncCapabilityProfile;
}
export interface GenericTierLensAssets {
  form: "prime";
  exposure: GenericLensExposureCapabilityProfile;
  /** Explicit synthetic coefficients, not measured calibration or a quality score. */
  matchedReference: {
    focalLengthMm: 50; aperture: 4; focusDistanceM: 5; wavelengthNm: 550;
    normalizationRadiusMm: number;
    distortionK1: number; lateralCaK1Offset: number; vignettingR2: number;
    breathingProjectionScale: number; transmission: number;
    correctionGainStrength: number; correctionCaFraction: number;
    ghostPowerFraction: number; veilPowerFraction: number;
    pupilAmplitudeByField: readonly (readonly number[])[];
    pupilOpdMicrometersByDefocus: readonly (readonly number[])[];
    pupilThroughputByField: readonly number[];
  };
  profileReferences: readonly { profileId: string; profileVersion: string }[];
  limitations: readonly string[];
}
export interface GenericEquipmentTierPreset {
  tier: GenericEquipmentTier;
  label: "Consumer" | "Prosumer" | "Professional";
  presetId: string; presetVersion: GenericTierPresetVersion;
  scientificStatus: "approximation";
  evidence: readonly EvidenceProvenance[];
  body: GenericTierBodyAssets;
  lens: GenericTierLensAssets;
  tradeoffs: readonly string[];
}

const evidence: readonly EvidenceProvenance[] = [{ sourceOrigin: "photivra", sourceReference: "photivra:generic-tier-assets-v1",
  reuseStatus: "photivra-owned" }];
const limitations = ["Synthetic educational design values; no named camera/lens calibration or population ranking."];
const fact = <T>(value: T): EvidenceBackedFact<T> => ({ value, evidence });
/**
 * The exact versions of the generic tier presets (no "latest" alias). 2.1.0 (2.14, round 5) adds the third-stop ISO
 * settings; 2.0.0 is kept, whole-stop, so saved selections and records of it still resolve to exactly what they named.
 */
export type GenericTierPresetVersion = "2.0.0" | "2.1.0";
/** Whole-stop ISO settings of the 2.0.0 bodies (each body's list stops at its maximum). */
export const GENERIC_WHOLE_STOP_ISO_SETTINGS = /* @__PURE__ */ Object.freeze([100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600] as const);
/**
 * Third-stop ISO settings of the 2.1.0 bodies: the conventional rounded markings of S = 100·2^(k/3), k = 0 … 24 (125 for
 * 126.0, 160 for 158.7 …; each within 2 % of the exact value). The engine takes the setting as the exact ISO speed.
 */
/**
 * The standard third-stop shutter times, seconds, from 1/8000 s to 30 s: the conventional markings of t = 2^(k/3) s
 * (1/8000 for 2^−13, 1/6 for 2^−8/3, 0.3 for 2^−5/3, 30 for 2^5; each within 7 % of the exact value). The generic bodies'
 * shutters are continuous over 1/8000–30 s and take any time as exact, so these are the values to offer in a third-stop
 * dial, not a restriction.
 */
export const GENERIC_THIRD_STOP_SHUTTER_SECONDS = /* @__PURE__ */ Object.freeze([1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000,
  1 / 1600, 1 / 1250, 1 / 1000, 1 / 800, 1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250, 1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40,
  1 / 30, 1 / 25, 1 / 20, 1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3.2, 4, 5, 6, 8, 10, 13,
  15, 20, 25, 30] as const);
export const GENERIC_THIRD_STOP_ISO_SETTINGS = /* @__PURE__ */ Object.freeze([100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600,
  2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600] as const);
const disk = [0,0,1,0,0, 0,1,1,1,0, 1,1,1,1,1, 0,1,1,1,0, 0,0,1,0,0];
const clipped = [0,0,1,0,0, 0,1,1,1,0, 0,1,1,1,1, 0,1,1,1,0, 0,0,1,0,0];
const clippedMore = [0,0,0,0,0, 0,0,1,1,0, 0,0,1,1,1, 0,0,1,1,0, 0,0,0,0,0];
const near = [0,0,.12,0,0, 0,.06,0,.06,0, .12,0,-.04,0,.12, 0,.06,0,.06,0, 0,0,.12,0,0];
const flat = Array<number>(25).fill(0);
const far = near.map((v) => -v);

/**
 * Synthetic, educational sensor design values for each tier: ADC (analogue-to-digital converter),
 * saturation signal Q0 at base ISO, analogue gain range, read noise for each conversion-gain mode,
 * and fixed-pattern noise sizes. They are plausible orders of magnitude for consumer
 * interchangeable-lens sensors. They are not data from any real camera.
 */
interface SyntheticSensorDesign {
  bitDepth: number; blackLevelCode: number; saturationElectrons: number; maximumAnalogGain: number;
  lowGainReadNoise: number; highGainReadNoise: number; highGainFromIso: number; highGainMaximumCharge: number;
  prnu: number; dsnu: number; hotFraction: number; hotMultiplier: number; rowRms: number; columnRms: number; instanceSeed: number;
}
/** Used only to build data. Tier labels never enter any scientific equation. */
function bodyAssets(version: GenericTierPresetVersion, id: string, isoMax: number, cadence: number, frames: number, sensor: SyntheticSensorDesign,
  dataReadoutSeconds: number, gain: number, maxAngle: number, continuousAf: boolean, advancedPolicies: boolean): GenericTierBodyAssets {
  const isoValues: number[] = (version === "2.0.0" ? GENERIC_WHOLE_STOP_ISO_SETTINGS : GENERIC_THIRD_STOP_ISO_SETTINGS).filter((v) => v <= isoMax);
  const exposure = parseGenericBodyExposureCapabilityProfile({ schemaVersion: "0.1.0", profileId: id+":exposure", profileVersion: version,
    scientificStatus: "approximation", evidence, shutter: { durationSecondsRange: fact({ minimum: 1/8000, maximum: 30 }), settingGrid: { kind: "continuous-within-range" } },
    iso: { range: fact({ minimum: 100, maximum: isoMax }), settingGrid: { kind: "discrete-values", values: fact(isoValues) }, autoIso: fact("supported") } });
  const iso = parseIsoCapabilityProfile({ schemaVersion: "0.1.0", profileId: id+":iso", profileVersion: version,
    capabilityMeaning: "reported-exposure-index-capability-not-physical-gain", standard: { exposureIndexRange: { minimum: 100, maximum: isoMax },
      settingGrid: { kind: "discrete-values", values: isoValues } }, expandedSettings: [], autoIso: { availability: "supported", standardExposureIndexRange: { minimum: 100, maximum: isoMax }, evidence },
    captureModePolicies: [], evidence });
  const isoGain = createIsoGainReadoutRegimes({ regimeIdPrefix: "", scientificStatus: "approximation", baseExposureIndex: 100,
    exposureIndices: isoValues, baseSaturationElectronEquivalent: fact(sensor.saturationElectrons), maximumAnalogGain: fact(sensor.maximumAnalogGain),
    adc: { bitDepth: sensor.bitDepth, blackLevelCode: sensor.blackLevelCode, digitalSaturationCode: 2**sensor.bitDepth-1 },
    conversionGainModes: [{ mode: "low-conversion-gain", minimumExposureIndex: 100, readNoiseRmsElectrons: fact(sensor.lowGainReadNoise) },
      { mode: "high-conversion-gain", minimumExposureIndex: sensor.highGainFromIso, readNoiseRmsElectrons: fact(sensor.highGainReadNoise),
        maximumChargeElectrons: fact(sensor.highGainMaximumCharge) }],
    evidence, limitations: [...limitations, "ISO gain follows the declared base-ISO saturation signal and analog range; read noise per conversion-gain mode is a synthetic design value."] });
  const readout = ["red", "green", "blue"].map((channelId): GenericVersionedAsset<SensorReadoutConversionProfile> => ({ assetId: id+":readout:"+channelId, assetVersion: version,
    profile: parseSensorReadoutConversionProfile({ schemaVersion: "0.1.0", profileId: id+":readout", colorSamplingProfileId: "photivra-generic-bayer", channelId,
      regimeSelectionOwnedBy: "explicit-upstream-camera-state-not-inferred-from-iso", evidence, regimes: isoGain.regimes }) }));
  const signalChain = parseGenericIsoSignalChainProfile({ schemaVersion: "0.1.0", profileId: id+":signal-chain", profileVersion: version,
    scientificStatus: "approximation", isoCapabilityProfileId: iso.profileId, readoutProfileId: id+":readout",
    behaviorMeaning: "iso-state-selects-explicit-readout-regime-not-noise-equation", captureModeBindings: [{ captureModeId: "native-still",
      standardRegimeBands: isoGain.standardRegimeBands, expandedRegimeBindings: [], evidence }],
    photonShotNoiseOwnedUpstream: true, processedImageBehaviorIncluded: false, fixedPatternNoiseModeled: false, lowSignalColorDegradationModeled: false,
    evidence, limitations });
  const release = parseGenericReleaseCapabilityProfile({ schemaVersion: "0.1.0", profileId: id+":release", profileVersion: version,
    scientificStatus: "approximation", evidence, supportedDriveModes: fact(["single", "burst", "self-timer"]), maximumLogicalFramesPerSequence: fact(frames),
    maximumCadenceFps: fact(cadence), minimumInterFrameGapSeconds: fact(0), overlappingOrdinaryStillExposures: false,
    exposureBracketing: { availability: fact("supported"), supportedAxes: ["shutter", "iso"] }, focusBracketing: { availability: fact("unsupported") } });
  const focus = parseFocusControlProfile({ schemaVersion: "0.1.0", profileId: id+":focus", profileVersion: version, scientificStatus: "approximation",
    supportedModes: continuousAf ? ["manual", "single-af", "continuous-af"] : ["manual", "single-af"], actuator: { kind: "ideal-instantaneous", evidence },
    continuousTargetLossPolicy: "hold-last-focus-require-explicit-reacquisition", supportedReleasePriorities: ["focus-priority", "release-priority", "balanced"],
    evidence, limitations: [...limitations, "AF actuator speed and subject recognition are not tier performance claims."] });
  const stabilization = parseStabilizationSystemProfile({ schemaVersion: "0.1.0", profileId: id+":stabilization", profileVersion: version,
    profileKind: "generic-synthetic", scientificStatus: "approximation", architecture: "sensor-shift", captureKind: "still",
    axisResponses: ["pitch", "yaw", "roll"].map((axis) => ({ axis, correctionGain: fact(gain), latencySeconds: fact(.001), maximumCorrectionAngleRad: fact(maxAngle) })),
    panningPolicy: { kind: "none" }, ...STABILIZATION_UNMODELED_SCOPE, evidence, limitations });
  const whiteBalance = parseWhiteBalanceProfile({ schemaVersion: "0.1.0", profileId: id+":white-balance", profileVersion: version,
    scientificStatus: "approximation", inputDomain: "relative-pre-wb-camera-linear-rgb", presets: [{ presetId: "neutral", label: "Neutral reference",
      channelGains: fact({ red: 1, green: 1, blue: 1 }) }], awbPolicies: [
      { policyId: "neutral-priority", intent: "neutral-priority", correctionStrength: fact(1) },
      ...(advancedPolicies ? [{ policyId: "ambience", intent: "ambience-preserving", correctionStrength: fact(.5) }] : [])], evidence, limitations });
  const metering = [{ kind: "multi-zone-uniform" }, ...(advancedPolicies ? [{ kind: "highlight-weighted", minimumWeightFraction: .2, exponent: 2 }] : [])]
    .map((policy): GenericVersionedAsset<ExposureMeteringProfile> => ({ assetId: id+":meter:"+policy.kind, assetVersion: version,
      profile: parseExposureMeteringProfile({ schemaVersion: "0.1.0", profileId: id+":meter:"+policy.kind, scientificStatus: "approximation",
        inputDomain: "relative-pre-exposure-linear-signal", captureRegion: "oriented-active-capture", policy,
        target: { kind: "relative-signal-reference", targetRelativeSignal: .18, evidence }, evidence,
        limitations: [...limitations, "0.18 is a declared target policy, not universal scene/camera truth."] }) }));
  const meteringCapabilities = parseGenericBodyMeteringCapabilityProfile({ schemaVersion: "0.1.0", profileId: id+":metering-capabilities", profileVersion: version,
    scientificStatus: "approximation", evidence, supportedMeteringProfiles: metering.map((m) => ({ meteringProfileId: m.profile.profileId, policyKind: m.profile.policy.kind, evidence })),
    spotFocusPointLinkage: { availability: "unsupported", evidence } });
  const timingId = id+":data-readout";
  const fixedPatternNoise = parseSensorFixedPatternNoiseProfile({ schemaVersion: "0.1.0", profileId: id+":fixed-pattern",
    colorSamplingProfileId: "photivra-generic-bayer", scientificStatus: "approximation", sensorInstanceSeedUint32: sensor.instanceSeed,
    photoResponseNonUniformity: { relativeStandardDeviation: fact(sensor.prnu) }, darkSignalNonUniformity: { relativeStandardDeviation: fact(sensor.dsnu) },
    hotPixels: { siteFraction: fact(sensor.hotFraction), darkCurrentMultiplier: fact(sensor.hotMultiplier) },
    rowOffset: { rmsElectrons: fact(sensor.rowRms) }, columnOffset: { rmsElectrons: fact(sensor.columnRms) },
    patternDistribution: "normal-factors-truncated-at-zero", evidence,
    limitations: [...limitations, "Synthetic fixed-pattern magnitudes for teaching; opt-in only and not a measured sensor population."] });
  return { exposure, iso, signalChain, readout, release, focus, stabilization, whiteBalance, metering, meteringCapabilities,
    readoutTiming: { assetId: timingId, assetVersion: version, profile: { readoutMode: "global", captureReadoutDurationSeconds: {
      value: dataReadoutSeconds, unit: "s", evidence } } },
    rollingReadoutTiming: { assetId: id+":rolling-data-readout", assetVersion: version, profile: { readoutMode: "rolling",
      captureReadoutDurationSeconds: { value: dataReadoutSeconds, unit: "s", evidence }, scanDirectionNative: fact("top-to-bottom"),
      spatialSamplingSkewSeconds: { value: dataReadoutSeconds, unit: "s", evidence } } },
    fixedPatternNoise: { assetId: id+":fixed-pattern", assetVersion: version, profile: fixedPatternNoise },
    flashSync: parseFlashSyncCapabilityProfile({ schemaVersion: "0.1.0", profileId: id+":flash-sync", profileVersion: version,
      captureModeId: "native-still", timingProfileId: timingId, supportedOrdinarySyncModes: ["front-curtain", "rear-curtain"],
      highSpeedSyncSupported: false, ordinarySyncRequiresWholeActiveFrameSimultaneouslyExposed: true, evidence, limitations }) };
}
function lensAssets(version: GenericTierPresetVersion, id: string, r: GenericTierLensAssets["matchedReference"]): GenericTierLensAssets {
  return { form: "prime", exposure: parseGenericLensExposureCapabilityProfile({ schemaVersion: "0.1.0", profileId: id+":exposure", profileVersion: version,
    scientificStatus: "approximation", evidence, focalLengthMmRange: fact({ minimum: 50, maximum: 50 }), aperture: { widestAvailableFNumber: {
      kind: "constant", fNumber: fact(4) }, narrowestAvailableFNumber: fact(16), settingGrid: { kind: "continuous-within-range" } } }),
    matchedReference: r, profileReferences: ["radial", "lateral-ca", "vignetting", "breathing", "transmission", "pupil", "stray", "correction"]
      .map((role) => ({ profileId: id+":"+role, profileVersion: version })),
    limitations: [...limitations, "Optical reference response is limited to 50 mm, f/4, focus 5 m and explicit field/defocus/wavelength slices; capabilities do not authorize extrapolation.",
      "The initial prime has no OIS; body stabilization is separate."] };
}
const common = { focalLengthMm: 50 as const, aperture: 4 as const, focusDistanceM: 5 as const, wavelengthNm: 550 as const,
  normalizationRadiusMm: Math.hypot(18,12), correctionCaFraction: .8 };
function buildGenericTierAssets(version: GenericTierPresetVersion): readonly GenericEquipmentTierPreset[] {
  return [
  { tier: "consumer", label: "Consumer", presetId: "photivra-consumer", presetVersion: version, scientificStatus: "approximation", evidence,
    body: bodyAssets(version, "photivra-consumer-body", 6400, 4, 8, { bitDepth: 12, blackLevelCode: 256, saturationElectrons: 20000,
      maximumAnalogGain: 32, lowGainReadNoise: 6, highGainReadNoise: 2.5, highGainFromIso: 800, highGainMaximumCharge: 6000,
      prnu: .01, dsnu: .3, hotFraction: 2e-4, hotMultiplier: 50, rowRms: .6, columnRms: .4, instanceSeed: 0x51ed270b }, .03, .35, .005, false, false),
    lens: lensAssets(version, "photivra-consumer-prime", { ...common, distortionK1: -.06, lateralCaK1Offset: .008, vignettingR2: -.5,
      breathingProjectionScale: 1.03, transmission: .75, correctionGainStrength: .8, ghostPowerFraction: .006, veilPowerFraction: .012,
      pupilAmplitudeByField: [disk, clipped, clippedMore], pupilOpdMicrometersByDefocus: [near, flat, far], pupilThroughputByField: [1,.85,.65] }),
    tradeoffs: ["Limited continuous AF; heavier digital correction and edge pupil clipping in matched reference."] },
  { tier: "prosumer", label: "Prosumer", presetId: "photivra-prosumer", presetVersion: version, scientificStatus: "approximation", evidence,
    body: bodyAssets(version, "photivra-prosumer-body", 12800, 8, 16, { bitDepth: 14, blackLevelCode: 1024, saturationElectrons: 40000,
      maximumAnalogGain: 64, lowGainReadNoise: 3, highGainReadNoise: 1.4, highGainFromIso: 800, highGainMaximumCharge: 12000,
      prnu: .006, dsnu: .2, hotFraction: 1e-4, hotMultiplier: 40, rowRms: .3, columnRms: .2, instanceSeed: 0x2c1b3c6d }, .015, .65, .01, true, true),
    lens: lensAssets(version, "photivra-prosumer-prime", { ...common, distortionK1: -.025, lateralCaK1Offset: .004, vignettingR2: -.25,
      breathingProjectionScale: 1.015, transmission: .85, correctionGainStrength: .6, ghostPowerFraction: .003, veilPowerFraction: .006,
      pupilAmplitudeByField: [disk, disk, clipped], pupilOpdMicrometersByDefocus: [near.map((v)=>v*.7), flat, far.map((v)=>v*.7)], pupilThroughputByField: [1,.95,.85] }),
    tradeoffs: ["Lower matched-reference peripheral gain/noise amplification than Professional; not universally inferior."] },
  { tier: "professional", label: "Professional", presetId: "photivra-professional", presetVersion: version, scientificStatus: "approximation", evidence,
    body: bodyAssets(version, "photivra-professional-body", 25600, 12, 24, { bitDepth: 14, blackLevelCode: 1024, saturationElectrons: 60000,
      maximumAnalogGain: 128, lowGainReadNoise: 2, highGainReadNoise: 1.1, highGainFromIso: 800, highGainMaximumCharge: 16000,
      prnu: .004, dsnu: .15, hotFraction: 5e-5, hotMultiplier: 30, rowRms: .15, columnRms: .1, instanceSeed: 0x6a09e667 }, .008, .85, .02, true, true),
    lens: lensAssets(version, "photivra-professional-prime", { ...common, distortionK1: -.01, lateralCaK1Offset: .002, vignettingR2: -.35,
      breathingProjectionScale: 1.005, transmission: .9, correctionGainStrength: .8, ghostPowerFraction: .001, veilPowerFraction: .002,
      pupilAmplitudeByField: [disk, disk, disk], pupilOpdMicrometersByDefocus: [near.map((v)=>v*.9), flat, far.map((v)=>v*.6)], pupilThroughputByField: [1,.98,.95] }),
    tradeoffs: ["Less edge clipping/stray light, with greater f/4 falloff/gain cost than Prosumer and asymmetric near/far wavefront character."] }
  ];
}

/** The presets of the current version, 2.1.0 (third-stop ISO settings). */
export const GENERIC_TIER_ASSETS: readonly GenericEquipmentTierPreset[] = buildGenericTierAssets("2.1.0");
let historical: readonly GenericEquipmentTierPreset[] | undefined;
/** The presets of an exact version; 2.0.0 (whole-stop ISO) is built on first use. */
export function genericTierAssets(version: GenericTierPresetVersion): readonly GenericEquipmentTierPreset[] {
  if (version === "2.1.0") return GENERIC_TIER_ASSETS;
  return historical ??= buildGenericTierAssets("2.0.0");
}
