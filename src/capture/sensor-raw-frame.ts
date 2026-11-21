// SPDX-License-Identifier: Apache-2.0

/**
 * Sensor RAW frames: native CFA (colour filter array) samples attached to a committed capture.
 *
 * The parser checks that every native site has exactly one sample, within size limits, and that CFA,
 * capture mode, site and code identities match exactly. Committing a frame stores the samples and
 * capture metadata only: no demosaicing, white balance (WB), tone mapping or file packing.
 * @see docs/SENSOR_RAW_FRAME.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { requireAllowlistedRecord, requirePublicOpaqueId } from "../core/record-validation.js";
import { RAW_ATTACHMENT_MAX_NATIVE_SITES } from "./raw-frame-limits.js";

import { freezeOwnedData } from "../core/owned-data.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { parseSimulatedCapture, type SimulatedCapture } from "./simulated-capture.js";
import { parseSensorColorSamplingProfile, type SensorColorSamplingProfile } from "../sensor/color-sampling.js";
import { parseCaptureModeProfile, type CaptureModeProfile } from "../sensor/capture-mode.js";
import { parseNativeEffectiveRasterColorSamplingBindingProfile, prepareCaptureModeColorSamplingContributors,
  type NativeEffectiveRasterColorSamplingBindingProfile } from "../sensor/capture-color-sampling-binding.js";
import { type SensorRawCaptureSample } from "../sensor/raw-reconstruction.js";

export const SENSOR_RAW_FRAME_SCHEMA_VERSION = "0.1.0" as const;
/** Declares that native CFA samples from the sensor model belong to a committed photographic capture. */
export interface SensorRawFrameInput {
  frameId: string;
  capture: SimulatedCapture;
  modeId: string;
  captureModeProfile: CaptureModeProfile;
  colorSamplingProfile: SensorColorSamplingProfile;
  bindingProfile: NativeEffectiveRasterColorSamplingBindingProfile;
  containerBitDepth: 16;
  /** Exactly one sample per native site, row-major. Not processed RGB with a mask applied. */
  samples: readonly SensorRawCaptureSample[];
}
/** Immutable attached RAW frame. Passing the structural checks does not prove the producer was correct or that the data is DNG-compatible. */
export interface SensorRawFrame extends SensorRawFrameInput {
  schemaVersion: typeof SENSOR_RAW_FRAME_SCHEMA_VERSION;
  sampleDomain: "native-cfa-raw-code";
  sampleOrder: "native-row-major";
  producerBinding: "caller-declared-capture-attachment";
  reconstructionApplied: false;
  renderingApplied: false;
  nativePixelWidth: number;
  nativePixelHeight: number;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return requireAllowlistedRecord(value, keys, "Invalid RAW-frame fields.");
}
function id(value: unknown): string {
  return requirePublicOpaqueId(value, "Invalid public RAW-frame ID.");
}
function integer(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new InvalidConfigurationError("Invalid RAW-frame integer.");
  }
  return Object.is(value, -0) ? 0 : value;
}
function point(value: unknown): { x: number; y: number } {
  const r = object(value, ["x", "y"]); return { x: integer(r.x, 65535), y: integer(r.y, 65535) };
}
const sampleKeys = ["version", "captureModeId", "modeSampleCoordinateSystem", "modeSampleIndexFullFrame",
  "colorSamplingProfileId", "colorSamplingSite", "channelId", "rawCode", "blackLevelCode", "digitalSaturationCode",
  "blackSubtractedNormalizedCode", "effectiveSaturationCode", "systemConversionGainElectronsPerCode",
  "readNoiseRmsElectrons", "readoutProfileId", "readoutRegimeId", "sourceChargeSeedUint32",
  "sourceReadNoiseSeedUint32", "physicalScalarSaturationApplied", "digitalSaturationApplied",
  "cfaPhasePreservedInNativeCoordinates", "physicalOrientationApplied", "outputRotationApplied",
  "groupedModeCombinationApplied", "reconstructionApplied", "aliasingModeled", "moireModeled"] as const;
function sample(value: unknown): SensorRawCaptureSample {
  const s = object(value, sampleKeys);
  if (s.version !== "0.1.0" || s.modeSampleCoordinateSystem !== "capture-mode-full-frame-effective-sample-index" ||
      s.cfaPhasePreservedInNativeCoordinates !== true || ["physicalOrientationApplied", "outputRotationApplied",
        "groupedModeCombinationApplied", "reconstructionApplied", "aliasingModeled", "moireModeled"].some((key) => s[key] !== false) ||
      typeof s.physicalScalarSaturationApplied !== "boolean" || typeof s.digitalSaturationApplied !== "boolean") {
    throw new InvalidConfigurationError("RAW-frame requires native unreconstructed sensor-pipeline samples with explicit flags.");
  }
  const rawCode = integer(s.rawCode, 65535), blackLevelCode = integer(s.blackLevelCode, 65535),
    digitalSaturationCode = integer(s.digitalSaturationCode, 65535);
  if (digitalSaturationCode <= blackLevelCode || rawCode > digitalSaturationCode ||
      (s.digitalSaturationApplied && rawCode !== digitalSaturationCode) ||
      typeof s.blackSubtractedNormalizedCode !== "number" ||
      s.blackSubtractedNormalizedCode !== (rawCode-blackLevelCode)/(digitalSaturationCode-blackLevelCode)) {
    throw new InvalidConfigurationError("RAW-frame code/black/white/normalization mismatch.");
  }
  const effectiveSaturationCode = integer(s.effectiveSaturationCode, 65535), gain = s.systemConversionGainElectronsPerCode, readNoise = s.readNoiseRmsElectrons;
  if (effectiveSaturationCode <= blackLevelCode || effectiveSaturationCode > digitalSaturationCode ||
      typeof gain !== "number" || !Number.isFinite(gain) || gain <= 0 || typeof readNoise !== "number" || !Number.isFinite(readNoise) || readNoise < 0) {
    throw new InvalidConfigurationError("RAW-frame effective white level, conversion gain or read noise is invalid.");
  }
  return { version: "0.1.0", captureModeId: id(s.captureModeId), modeSampleCoordinateSystem: s.modeSampleCoordinateSystem,
    modeSampleIndexFullFrame: point(s.modeSampleIndexFullFrame), colorSamplingProfileId: id(s.colorSamplingProfileId),
    colorSamplingSite: point(s.colorSamplingSite), channelId: id(s.channelId), rawCode, blackLevelCode, digitalSaturationCode,
    blackSubtractedNormalizedCode: s.blackSubtractedNormalizedCode, effectiveSaturationCode,
    systemConversionGainElectronsPerCode: gain, readNoiseRmsElectrons: Object.is(readNoise, -0) ? 0 : readNoise, readoutProfileId: id(s.readoutProfileId),
    readoutRegimeId: id(s.readoutRegimeId), sourceChargeSeedUint32: integer(s.sourceChargeSeedUint32, 0xffffffff),
    sourceReadNoiseSeedUint32: integer(s.sourceReadNoiseSeedUint32, 0xffffffff),
    physicalScalarSaturationApplied: s.physicalScalarSaturationApplied, digitalSaturationApplied: s.digitalSaturationApplied,
    cfaPhasePreservedInNativeCoordinates: true, physicalOrientationApplied: false, outputRotationApplied: false,
    groupedModeCombinationApplied: false, reconstructionApplied: false, aliasingModeled: false, moireModeled: false };
}
/** Checks that every native site has one sample, within limits, and that CFA, mode, site and code identities match exactly. No I/O. */
export function parseSensorRawFrameInput(value: unknown): SensorRawFrameInput {
  const r = object(value, ["frameId", "capture", "modeId", "captureModeProfile", "colorSamplingProfile",
    "bindingProfile", "containerBitDepth", "samples"]);
  const capture = parseSimulatedCapture(r.capture), modeId = id(r.modeId), frameId = id(r.frameId);
  const captureModeProfile = parseCaptureModeProfile(r.captureModeProfile),
    colorSamplingProfile = parseSensorColorSamplingProfile(r.colorSamplingProfile),
    bindingProfile = parseNativeEffectiveRasterColorSamplingBindingProfile(r.bindingProfile);
  const native = capture.geometry.nativeRaster, count = native.pixelWidth*native.pixelHeight;
  const mode = captureModeProfile.modes.find((m) => m.modeId === modeId);
  if (r.containerBitDepth !== 16 || count > RAW_ATTACHMENT_MAX_NATIVE_SITES || !Array.isArray(r.samples) || r.samples.length !== count ||
      Array.from({ length: count }, (_, i) => i in (r.samples as unknown[])).includes(false) ||
      colorSamplingProfile.layout.kind !== "periodic-mosaic" || !mode || mode.acquisition.kind !== "single-frame" ||
      mode.perFrameSampling.kind !== "native-effective-raster" || (mode.reconstructionStages?.length ?? 0) !== 0) {
    throw new InvalidConfigurationError("RAW-frame requires bounded single-frame native periodic CFA coverage and uint16 storage.");
  }
  const samples = r.samples.map(sample), layout = colorSamplingProfile.layout, phaseSample: (SensorRawCaptureSample | undefined)[] = [];
  for (let i = 0; i < samples.length; i++) {
    // Readout constants are per CFA phase: one white level, gain and read noise for every site of a phase.
    const s = samples[i]!, phase = (Math.floor(i/native.pixelWidth)%layout.repeatHeightSites)*layout.repeatWidthSites + (i%native.pixelWidth)%layout.repeatWidthSites;
    const first = phaseSample[phase] ??= s;
    if (first.effectiveSaturationCode !== s.effectiveSaturationCode || first.systemConversionGainElectronsPerCode !== s.systemConversionGainElectronsPerCode ||
        first.readNoiseRmsElectrons !== s.readNoiseRmsElectrons) throw new InvalidConfigurationError("RAW-frame readout white level, gain and read noise must be constant per CFA phase.");
  }
  // sensor-27: the binding and mode are parsed and resolved once for every site.
  const contributorsAt = prepareCaptureModeColorSamplingContributors({ nativeRaster: native, captureModeProfile, modeId, colorSamplingProfile, bindingProfile });
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!, x = i%native.pixelWidth, y = Math.floor(i/native.pixelWidth);
    const c = contributorsAt({ x, y });
    if (c.totalContributorSites !== 1 || c.channelComposition.kind !== "single-channel" ||
        s.captureModeId !== modeId || s.colorSamplingProfileId !== colorSamplingProfile.profileId ||
        s.modeSampleIndexFullFrame.x !== x || s.modeSampleIndexFullFrame.y !== y ||
        s.colorSamplingSite.x !== c.colorSamplingSiteRect.x || s.colorSamplingSite.y !== c.colorSamplingSiteRect.y ||
        s.channelId !== c.channelComposition.channelId || s.readoutProfileId !== samples[0]!.readoutProfileId ||
        s.readoutRegimeId !== samples[0]!.readoutRegimeId) {
      throw new InvalidConfigurationError("RAW-frame site/phase/channel/readout binding mismatch.");
    }
  }
  return { frameId, capture, modeId, captureModeProfile, colorSamplingProfile, bindingProfile, containerBitDepth: 16, samples };
}
/** Commits native RAW samples and capture metadata. No demosaicing, WB, tone mapping or file packing. */
export function createSensorRawFrame(input: SensorRawFrameInput): SensorRawFrame {
  const value = parseSensorRawFrameInput(input);
  const frame: SensorRawFrame = { ...value, schemaVersion: SENSOR_RAW_FRAME_SCHEMA_VERSION, sampleDomain: "native-cfa-raw-code",
    sampleOrder: "native-row-major", producerBinding: "caller-declared-capture-attachment", reconstructionApplied: false,
    renderingApplied: false, nativePixelWidth: value.capture.geometry.nativeRaster.pixelWidth,
    nativePixelHeight: value.capture.geometry.nativeRaster.pixelHeight };
  // Copy all profile/evidence arrays before freezing; never freeze caller-owned inputs.
  return freezeOwnedData(JSON.parse(JSON.stringify(frame)) as SensorRawFrame);
}
