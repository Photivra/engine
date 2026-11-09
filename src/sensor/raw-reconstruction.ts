// SPDX-License-Identifier: Apache-2.0

/**
 * RAW reconstruction (demosaicing): estimates every colour channel at each pixel from the RAW samples
 * of nearby CFA (colour filter array) sites, using declared linear kernels.
 *
 * It uses native RAW samples (after the ADC) that are explicitly bound to their sites, and declared
 * normalized kernels for each channel. The CFA phase is absolute; orientation and crop are applied
 * later. This is a fixed linear reconstruction. It does not infer the sensor's spectral primaries or
 * calibrated colour, and is not a general demosaic algorithm. Built-in bilinear Bayer kernels are
 * provided.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { computeEffectiveSaturationCode } from "../capture/raw-white-level.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type {
  ResolvedCaptureModeColorSamplingContributors
} from "./capture-color-sampling-binding.js";
import {
  parseSensorColorSamplingProfile,
  resolveColorSamplingSite,
  type SensorColorSamplingProfile
} from "./color-sampling.js";
import type {
  SensorAdcIntegralNonLinearity,
  SensorRawCodeSample
} from "./raw-readout.js";
import type {
  SensorSpectralResponseScientificStatus
} from "./spectral-response.js";
import { requireInputObject, requireInputKeys, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigFinite as requireFinite, parseConfigScientificStatus as parseStatus, requireInputNonNegativeSafeInteger as requireNonNegativeSafeIntegerInput, parseConfigLimitations as parseLimitations } from "../core/record-validation.js";
import { requireSafeInteger } from "./raw-readout.js";

export const SENSOR_RAW_CAPTURE_SAMPLE_VERSION =
  "0.1.0" as const;
export const SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;

export interface CreateSensorRawCaptureSampleInput {
  rawCode:
    SensorRawCodeSample;
  contributors:
    ResolvedCaptureModeColorSamplingContributors;
  /**
   * The selected readout regime's declared ADC integral non-linearity (INL), if any. The code sample
   * records INL only at its own code, but the effective white level needs it at saturation.
   */
  adcIntegralNonLinearity?:
    SensorAdcIntegralNonLinearity;
}

export interface SensorRawCaptureSample {
  version:
    typeof SENSOR_RAW_CAPTURE_SAMPLE_VERSION;
  captureModeId: string;
  modeSampleCoordinateSystem:
    "capture-mode-full-frame-effective-sample-index";
  modeSampleIndexFullFrame: {
    x: number;
    y: number;
  };
  colorSamplingProfileId: string;
  colorSamplingSite: {
    x: number;
    y: number;
  };
  channelId: string;
  rawCode: number;
  blackLevelCode: number;
  digitalSaturationCode: number;
  blackSubtractedNormalizedCode:
    number;
  /** Full-saturation code from `calculateEffectiveSaturationCode`; constant per CFA phase. */
  effectiveSaturationCode: number;
  /** Regime system conversion gain, e⁻ per code (DNG NoiseProfile input). */
  systemConversionGainElectronsPerCode: number;
  /** Total read noise in e⁻: the square root of the sum of the squared RMS components (DNG NoiseProfile input). */
  readNoiseRmsElectrons: number;
  readoutProfileId: string;
  readoutRegimeId: string;
  sourceChargeSeedUint32: number;
  sourceReadNoiseSeedUint32: number;
  physicalScalarSaturationApplied:
    boolean;
  digitalSaturationApplied:
    boolean;
  cfaPhasePreservedInNativeCoordinates:
    true;
  physicalOrientationApplied:
    false;
  outputRotationApplied:
    false;
  groupedModeCombinationApplied:
    false;
  reconstructionApplied: false;
  aliasingModeled: false;
  moireModeled: false;
}

export interface SensorRawReconstructionKernelContribution {
  offsetX: number;
  offsetY: number;
  sourceChannelId: string;
  weight: number;
}

export interface SensorRawReconstructionChannelKernel {
  outputChannelId: string;
  contributions:
    readonly SensorRawReconstructionKernelContribution[];
}

export interface SensorRawReconstructionProfile {
  schemaVersion:
    typeof SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  captureModeId: string;
  colorSamplingProfileId: string;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  method:
    "explicit-linear-native-neighborhood";
  normalization:
    "weights-sum-to-one-per-output-channel";
  negativeBlackSubtractedValuesAllowed:
    true;
  kernels:
    readonly SensorRawReconstructionChannelKernel[];
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface ResolveSensorRawReconstructionInput {
  profile:
    SensorRawReconstructionProfile;
  colorSamplingProfile:
    SensorColorSamplingProfile;
  centerSite: {
    x: number;
    y: number;
  };
  samples:
    readonly SensorRawCaptureSample[];
}

export interface SensorRawReconstructedPixel {
  reconstructionProfileId:
    string;
  reconstructionProfileVersion:
    string;
  captureModeId: string;
  colorSamplingProfileId: string;
  centerSite: {
    x: number;
    y: number;
  };
  outputChannels:
    readonly {
      channelId: string;
      linearBlackSubtractedNormalizedValue:
        number;
      sourceContributions:
        readonly {
          site: {
            x: number;
            y: number;
          };
          sourceChannelId: string;
          weight: number;
          sourceValue: number;
        }[];
    }[];
  method:
    "explicit-linear-native-neighborhood";
  cfaAware: true;
  captureModeAware: true;
  physicalOrientationApplied:
    false;
  outputRotationApplied: false;
  sharpeningApplied: false;
  denoisingApplied: false;
  aliasingModeled: false;
  moireModeled: false;
  preSamplingOpticalTransferAdequacyEstablished:
    false;
  reconstructionDoesNotModifyRawSamples:
    true;
}

function parseContribution(
  value: unknown,
  path: string
): SensorRawReconstructionKernelContribution {
  const record =
    requireRecord(value, path, ["offsetX", "offsetY", "sourceChannelId", "weight"]);
  return {
    offsetX:
      requireSafeInteger(
        record.offsetX,
        path + ".offsetX"
      ),
    offsetY:
      requireSafeInteger(
        record.offsetY,
        path + ".offsetY"
      ),
    sourceChannelId:
      requireNonEmptyString(
        record.sourceChannelId,
        path + ".sourceChannelId"
      ),
    weight:
      requireFinite(
        record.weight,
        path + ".weight"
      )
  };
}

function parseKernel(
  value: unknown,
  path: string
): SensorRawReconstructionChannelKernel {
  const record =
    requireRecord(value, path, ["contributions", "outputChannelId"]);
  if (
    !Array.isArray(
      record.contributions
    ) ||
    record.contributions
      .length === 0
  ) {
    throw new InvalidConfigurationError(
      path +
        ".contributions must be a non-empty array."
    );
  }
  const contributions =
    record.contributions.map(
      (entry, index) =>
        parseContribution(
          entry,
          path +
            ".contributions[" +
            index +
            "]"
        )
    );
  const keys =
    contributions.map(
      (entry) =>
        entry.offsetX +
        ":" +
        entry.offsetY +
        ":" +
        entry.sourceChannelId
    );
  if (
    new Set(keys).size !==
    keys.length
  ) {
    throw new InvalidConfigurationError(
      path +
        ".contributions must not contain duplicate site/channel references."
    );
  }

  const sum =
    contributions.reduce(
      (valueSum, entry) =>
        valueSum + entry.weight,
      0
    );
  if (
    !Number.isFinite(sum) ||
    Math.abs(sum - 1) >
      1e-12
  ) {
    throw new InvalidConfigurationError(
      path +
        ".contribution weights must sum to one."
    );
  }

  return {
    outputChannelId:
      requireNonEmptyString(
        record.outputChannelId,
        path +
          ".outputChannelId"
      ),
    contributions
  };
}

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The profile declares a normalized linear kernel for each output channel. It does not infer the
 * sensor's spectral primaries or calibrated colour.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseSensorRawReconstructionProfile(
  value: unknown
): SensorRawReconstructionProfile {
  const record =
    requireRecord(
      value,
      "sensorRawReconstructionProfile", ["schemaVersion", "method", "normalization", "negativeBlackSubtractedValuesAllowed", "kernels", "profileId", "profileVersion", "captureModeId", "colorSamplingProfileId", "scientificStatus", "evidence", "limitations"]
    );
  if (
    record.schemaVersion !==
    SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sensorRawReconstructionProfile.schemaVersion must be "' +
        SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.method !==
    "explicit-linear-native-neighborhood"
  ) {
    throw new InvalidConfigurationError(
      'sensorRawReconstructionProfile.method must be "explicit-linear-native-neighborhood".'
    );
  }
  if (
    record.normalization !==
    "weights-sum-to-one-per-output-channel"
  ) {
    throw new InvalidConfigurationError(
      "sensorRawReconstructionProfile.normalization is invalid."
    );
  }
  if (
    record
      .negativeBlackSubtractedValuesAllowed !==
    true
  ) {
    throw new InvalidConfigurationError(
      "sensorRawReconstructionProfile.negativeBlackSubtractedValuesAllowed must be true."
    );
  }
  if (
    !Array.isArray(
      record.kernels
    ) ||
    record.kernels.length === 0
  ) {
    throw new InvalidConfigurationError(
      "sensorRawReconstructionProfile.kernels must be a non-empty array."
    );
  }

  const kernels =
    record.kernels.map(
      (entry, index) =>
        parseKernel(
          entry,
          "sensorRawReconstructionProfile.kernels[" +
            index +
            "]"
        )
    );
  const outputIds =
    kernels.map(
      (kernel) =>
        kernel.outputChannelId
    );
  if (
    new Set(outputIds).size !==
    outputIds.length
  ) {
    throw new InvalidConfigurationError(
      "sensorRawReconstructionProfile.kernels must not contain duplicate outputChannelId values."
    );
  }

  return {
    schemaVersion:
      SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "sensorRawReconstructionProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "sensorRawReconstructionProfile.profileVersion"
      ),
    captureModeId:
      requireNonEmptyString(
        record.captureModeId,
        "sensorRawReconstructionProfile.captureModeId"
      ),
    colorSamplingProfileId:
      requireNonEmptyString(
        record.colorSamplingProfileId,
        "sensorRawReconstructionProfile.colorSamplingProfileId"
      ),
    scientificStatus:
      parseStatus(
        record.scientificStatus,
        "sensorRawReconstructionProfile.scientificStatus"
      ),
    method:
      "explicit-linear-native-neighborhood",
    normalization:
      "weights-sum-to-one-per-output-channel",
    negativeBlackSubtractedValuesAllowed:
      true,
    kernels,
    evidence:
      parseEvidenceList(
        record.evidence,
        "sensorRawReconstructionProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "sensorRawReconstructionProfile.limitations"
      )
  };
}

/**
 * Commits one validated native RAW sample, with its exact site, channel and exposure event, for use
 * in reconstruction.
 * @param input - The input; see `CreateSensorRawCaptureSampleInput` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function createSensorRawCaptureSample(
  input:
    CreateSensorRawCaptureSampleInput
): SensorRawCaptureSample {
  requireInputKeys(input, "createSensorRawCaptureSample", ["rawCode", "contributors", "adcIntegralNonLinearity"]);
  const raw =
    input.rawCode;
  const contributors =
    input.contributors;

  requireInputObject(contributors, "contributors input");
  if (
    contributors
      .modeSamplingKind !==
      "native-effective-raster" ||
    contributors.grouping !==
      null ||
    contributors
      .totalContributorSites !==
      1 ||
    contributors
      .colorSamplingSiteRect
      .width !== 1 ||
    contributors
      .colorSamplingSiteRect
      .height !== 1
  ) {
    throw new InvalidScientificInputError(
      "RAW site creation schema 0.1.0 requires one ungrouped native-effective capture-mode sample bound to exactly one color-sampling site; grouped/remosaic modes need explicit signal-combination weights."
    );
  }

  if (
    contributors
      .colorSamplingProfileId !==
      raw.colorSamplingProfileId
  ) {
    throw new InvalidScientificInputError(
      "RAW readout color-sampling profile identity must match the capture-mode contributor binding."
    );
  }

  if (
    contributors
      .channelComposition.kind !==
      "single-channel" ||
    contributors
      .channelComposition
      .channelId !==
      raw.channelId
  ) {
    throw new InvalidScientificInputError(
      "RAW readout channel must match the capture-mode color-sampling contributor channel."
    );
  }

  if (
    raw.site.x !==
      contributors
        .colorSamplingSiteRect.x ||
    raw.site.y !==
      contributors
        .colorSamplingSiteRect.y
  ) {
    throw new InvalidScientificInputError(
      "RAW readout site must match the exact capture-mode color-sampling contributor site."
    );
  }

  const denominator =
    raw.digitalSaturationCode -
    raw.blackLevelCode;
  if (denominator <= 0) {
    throw new InvalidScientificInputError(
      "RAW black/white code span must be positive."
    );
  }

  return {
    version:
      SENSOR_RAW_CAPTURE_SAMPLE_VERSION,
    captureModeId:
      contributors.modeId,
    modeSampleCoordinateSystem:
      "capture-mode-full-frame-effective-sample-index",
    modeSampleIndexFullFrame: {
      ...contributors
        .modeSampleIndexFullFrame
    },
    colorSamplingProfileId:
      raw.colorSamplingProfileId,
    colorSamplingSite: {
      ...raw.site
    },
    channelId:
      raw.channelId,
    rawCode:
      raw.rawCode,
    blackLevelCode:
      raw.blackLevelCode,
    digitalSaturationCode:
      raw.digitalSaturationCode,
    blackSubtractedNormalizedCode:
      (
        raw.rawCode -
        raw.blackLevelCode
      ) /
      denominator,
    effectiveSaturationCode:
      computeEffectiveSaturationCode(
        input.adcIntegralNonLinearity ===
          undefined
          ? raw
          : {
              ...raw,
              integralNonLinearity:
                input.adcIntegralNonLinearity
            }
      ),
    systemConversionGainElectronsPerCode:
      raw.systemConversionGainElectronsPerCode,
    readNoiseRmsElectrons:
      Math.sqrt(
        raw.electronicReadNoiseComponents.reduce(
          (sum, component) =>
            sum +
            component.rmsElectrons *
              component.rmsElectrons,
          0
        )
      ),
    readoutProfileId:
      raw.readoutProfileId,
    readoutRegimeId:
      raw.regimeId,
    sourceChargeSeedUint32:
      raw.chargeSeedUint32,
    sourceReadNoiseSeedUint32:
      raw.readNoiseSeedUint32,
    physicalScalarSaturationApplied:
      raw
        .physicalScalarSaturationApplied,
    digitalSaturationApplied:
      raw
        .digitalSaturationApplied,
    cfaPhasePreservedInNativeCoordinates:
      true,
    physicalOrientationApplied:
      false,
    outputRotationApplied:
      false,
    groupedModeCombinationApplied:
      false,
    reconstructionApplied:
      false,
    aliasingModeled:
      false,
    moireModeled: false
  };
}

function requireCenterSite(
  value: {
    x: number;
    y: number;
  }
): {
  x: number;
  y: number;
} {
  return {
    x:
      requireNonNegativeSafeIntegerInput(
        value.x,
        "centerSite.x"
      ),
    y:
      requireNonNegativeSafeIntegerInput(
        value.y,
        "centerSite.y"
      )
  };
}

/**
 * Combines the supplied native samples through explicit normalized kernels, keeping CFA identity
 * and signed black-subtracted values.
 *
 * The CFA phase is absolute; orientation and crop come later. This fixed linear reconstruction does
 * not infer spectral primaries or calibrated colour, and is not a general demosaic algorithm.
 * @param input - The input; see `ResolveSensorRawReconstructionInput` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function resolveSensorRawReconstruction(
  input:
    ResolveSensorRawReconstructionInput
): CalculationResult<SensorRawReconstructedPixel> {
  requireInputKeys(input, "resolveSensorRawReconstruction", ["profile", "colorSamplingProfile", "centerSite", "samples"]);
  const profile =
    parseSensorRawReconstructionProfile(
      input.profile
    );
  const center =
    requireCenterSite(
      input.centerSite
    );
  const colorSamplingProfile =
    parseSensorColorSamplingProfile(
      input.colorSamplingProfile
    );
  if (
    colorSamplingProfile.profileId !==
    profile.colorSamplingProfileId
  ) {
    throw new InvalidScientificInputError(
      "Reconstruction color-sampling profile identity must match the reconstruction profile."
    );
  }

  if (
    !Array.isArray(input.samples) ||
    input.samples.length === 0
  ) {
    throw new InvalidScientificInputError(
      "samples must be a non-empty RAW neighborhood."
    );
  }

  for (
    const sample of
    input.samples
  ) {
    if (
      sample.captureModeId !==
        profile.captureModeId ||
      sample
        .colorSamplingProfileId !==
        profile
          .colorSamplingProfileId
    ) {
      throw new InvalidScientificInputError(
        "Every RAW neighborhood sample must match the reconstruction profile capture-mode and color-sampling identities."
      );
    }
    const resolvedSite =
      resolveColorSamplingSite({
        profile:
          colorSamplingProfile,
        site:
          sample
            .colorSamplingSite
      });
    if (
      resolvedSite.mapping
        .channelId !==
      sample.channelId
    ) {
      throw new InvalidScientificInputError(
        "RAW neighborhood sample channelId must match the declared color-sampling topology at its native site."
      );
    }
  }

  const sampleMap =
    new Map(
      input.samples.map(
        (sample) => [
          sample.colorSamplingSite.x +
            ":" +
            sample.colorSamplingSite.y +
            ":" +
            sample.channelId,
          sample
        ] as const
      )
    );
  if (
    sampleMap.size !==
    input.samples.length
  ) {
    throw new InvalidScientificInputError(
      "RAW neighborhood must not contain duplicate site/channel samples."
    );
  }

  const outputChannels = profile.kernels.map(kernel => calculateRawReconstructionChannel(kernel, center, (x, y, channelId) => {
    const sample = sampleMap.get(x + ":" + y + ":" + channelId);
    if (sample === undefined) throw new InvalidScientificInputError("RAW reconstruction neighborhood is missing a required site/channel contribution.");
    return sample.blackSubtractedNormalizedCode;
  }));

  return approximationResult(
    {
      reconstructionProfileId:
        profile.profileId,
      reconstructionProfileVersion:
        profile.profileVersion,
      captureModeId:
        profile.captureModeId,
      colorSamplingProfileId:
        profile
          .colorSamplingProfileId,
      centerSite:
        center,
      outputChannels,
      method:
        "explicit-linear-native-neighborhood",
      cfaAware: true,
      captureModeAware:
        true,
      physicalOrientationApplied:
        false,
      outputRotationApplied:
        false,
      sharpeningApplied:
        false,
      denoisingApplied: false,
      aliasingModeled: false,
      moireModeled: false,
      preSamplingOpticalTransferAdequacyEstablished:
        false,
      reconstructionDoesNotModifyRawSamples:
        true
    },
    "sensor-raw-explicit-linear-reconstruction",
    "1.0.0",
    [
      "Reconstruction uses only explicitly declared linear native-neighborhood weights tied to exact capture-mode and color-sampling identities.",
      "No manufacturer-specific CFA algorithm or branded demosaic behavior is inferred from topology labels.",
      "RAW samples remain in invariant native sensor/CFA coordinates; physical orientation and final output rotation are downstream.",
      "Negative black-subtracted values are preserved through the linear reconstruction instead of being silently clamped.",
      "Sharpening and denoising are not part of RAW reconstruction.",
      "Aliasing and moire are explicitly not modeled because this reconstruction contract does not establish an adequate pre-sampling optical transfer/scene-frequency model."
    ]
  );
}

/**
 * Internal: sums one channel's weighted contributions. The reference and packed paths use the same
 * order of operations. With `mirrorBounds`, a contribution site outside the native frame is read from
 * its mirror image (reflect-101, see `reflectRawSiteIndex`). Without it (the default), such a site is
 * rejected.
 */
export function calculateRawReconstructionChannel(kernel: SensorRawReconstructionChannelKernel,
  center: {x:number;y:number}, read: (x:number,y:number,channelId:string)=>number,
  mirrorBounds?: {width:number;height:number}): SensorRawReconstructedPixel["outputChannels"][number] {
  let value = 0;
  const sourceContributions = kernel.contributions.map(contribution => {
    let x = center.x + contribution.offsetX, y = center.y + contribution.offsetY;
    if (mirrorBounds !== undefined) { x = reflectRawSiteIndex(x, mirrorBounds.width); y = reflectRawSiteIndex(y, mirrorBounds.height); }
    if (x < 0 || y < 0) throw new InvalidScientificInputError("RAW reconstruction kernel references a site outside the non-negative native sensor coordinate domain.");
    const sourceValue = read(x,y,contribution.sourceChannelId);
    value += sourceValue*contribution.weight;
    return {site:{x,y},sourceChannelId:contribution.sourceChannelId,weight:contribution.weight,sourceValue};
  });
  if (!Number.isFinite(value)) throw new InvalidScientificInputError("Reconstructed linear channel value must remain finite.");
  return {channelId:kernel.outputChannelId,linearBlackSubtractedNormalizedValue:value,sourceContributions};
}

// ------------------------------------------------------------------ built-in Bayer kernels and borders

/** How a reconstruction neighbourhood that leaves the native frame is handled. */
export type RawReconstructionBorderHandling = "reject" | "mirror";

/**
 * Mirror index ("reflect-101"): −1 → 1, −2 → 2, n → n−2. The edge site itself is not repeated, so
 * for a CFA that repeats every 2 sites (Bayer) each mirrored site has the same channel as the site the
 * repeating pattern would put there. Requires size ≥ 1; for size 1 every index maps to 0.
 */
export function reflectRawSiteIndex(index: number, size: number): number {
  if (index >= 0 && index < size) return index;
  if (size === 1) return 0;
  const period = 2 * size - 2, m = ((index % period) + period) % period;
  return m < size ? m : period - m;
}

/**
 * Internal: proves that mirrored (reflect-101) reads at the border return the channel the repeating
 * CFA would put at every virtual site within `reach` of each frame edge, for every row and column
 * phase. Mirroring works per axis, so checking each axis over every phase also covers the corners.
 * Throws otherwise.
 */
export function validateMirrorBorderCfaConsistency(layout: { repeatWidthSites: number; repeatHeightSites: number;
  siteChannelIds: readonly string[] }, width: number, height: number, reach: number): void {
  const rw = layout.repeatWidthSites, rh = layout.repeatHeightSites, ids = layout.siteChannelIds;
  const at = (x: number, y: number): string => ids[(((y % rh) + rh) % rh) * rw + ((x % rw) + rw) % rw]!;
  if (reach >= width || reach >= height) {
    throw new InvalidConfigurationError("Mirror border handling requires a native frame larger than the kernel reach.");
  }
  for (let d = 1; d <= reach; d++) {
    for (let p = 0; p < Math.max(rw, rh); p++) {
      if (at(-d, p) !== at(reflectRawSiteIndex(-d, width), p) || at(width - 1 + d, p) !== at(reflectRawSiteIndex(width - 1 + d, width), p) ||
          at(p, -d) !== at(p, reflectRawSiteIndex(-d, height)) || at(p, height - 1 + d) !== at(p, reflectRawSiteIndex(height - 1 + d, height))) {
        throw new InvalidConfigurationError("Mirror border handling would change the CFA channel of a reflected site; this CFA/frame size needs reject handling or a smaller region.");
      }
    }
  }
}

/** Internal: largest absolute site offset of any contribution (the neighbourhood reach). */
export function rawReconstructionKernelReach(profiles: readonly { profile: SensorRawReconstructionProfile }[]): number {
  let reach = 0;
  for (const { profile } of profiles) for (const kernel of profile.kernels) for (const c of kernel.contributions) {
    reach = Math.max(reach, Math.abs(c.offsetX), Math.abs(c.offsetY));
  }
  return reach;
}

export type BuiltInBayerDemosaicKernel = "bilinear";
export const BUILT_IN_BAYER_DEMOSAIC_MODEL_VERSION = "1.0.0" as const;

export interface CreateBuiltInBayerDemosaicProfilesInput {
  kernel: BuiltInBayerDemosaicKernel;
  /** Capture mode the RAW frame belongs to; copied into every phase profile. */
  captureModeId: string;
  /** Must be a 2×2 periodic Bayer mosaic: one red, one blue and two diagonal green sites. */
  colorSamplingProfile: SensorColorSamplingProfile;
  /** CFA channel IDs for the red, green and blue roles. This is also the output channel order. */
  channelRoles: { red: string; green: string; blue: string };
}

export interface BuiltInBayerDemosaicProfiles {
  kernel: BuiltInBayerDemosaicKernel;
  /** One profile per absolute CFA phase, row-major (`phaseY`, then `phaseX`). */
  phaseProfiles: { phaseX: number; phaseY: number; profile: SensorRawReconstructionProfile }[];
  outputChannelIds: [string, string, string];
  /** Largest |offset| of any contribution: 1 for bilinear. */
  kernelReachSites: number;
}

type BayerRole = "R" | "G" | "B";
type BayerTap = readonly [dx: number, dy: number, role: BayerRole, weight: number];
const CROSS1 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIAG1 = [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
function bayerTaps(points: readonly (readonly [number, number])[], role: BayerRole, weight: number): BayerTap[] {
  return points.map(([x, y]) => [x, y, role, weight] as const);
}

/**
 * Kernels for one kind of site. `own` is the site's channel; `horizontal` is the colour channel on the
 * same row, for a green site.
 *
 * Bilinear: the average of the nearest sites of the wanted channel. Every kernel sums to one and
 * reproduces signals that vary linearly (affine) exactly.
 */
function bayerSiteKernels(own: BayerRole, horizontal: BayerRole | null): Record<BayerRole, BayerTap[]> {
  if (own !== "G") {
    const other: BayerRole = own === "R" ? "B" : "R";
    const green: BayerTap[] = bayerTaps(CROSS1, "G", 1 / 4);
    const opposite: BayerTap[] = bayerTaps(DIAG1, other, 1 / 4);
    const result = { G: green } as Record<BayerRole, BayerTap[]>;
    result[own] = [[0, 0, own, 1]]; result[other] = opposite;
    return result;
  }
  const h = horizontal!, v: BayerRole = h === "R" ? "B" : "R";
  const along = (role: BayerRole, horizontalAxis: boolean): BayerTap[] => {
    const near = horizontalAxis ? [[1, 0], [-1, 0]] as const : [[0, 1], [0, -1]] as const;
    return bayerTaps(near, role, 1 / 2);
  };
  const identity: BayerTap[] = [[0, 0, "G", 1]];
  const result = { G: identity } as Record<BayerRole, BayerTap[]>;
  result[h] = along(h, true); result[v] = along(v, false);
  return result;
}

const BAYER_DEMOSAIC_EVIDENCE: Readonly<Record<BuiltInBayerDemosaicKernel, readonly EvidenceProvenance[]>> = {
  bilinear: [{ sourceOrigin: "third-party", reuseStatus: "factual-reference-only",
    sourceReference: "Gunturk, Glotzbach, Altunbasak, Schafer & Mersereau, Demosaicking: color filter array interpolation, IEEE Signal Processing Magazine 22(1), 2005",
    note: "Bilinear interpolation of each Bayer channel from its nearest same-channel sites; weights derived in Photivra from that published definition." }]
};

/**
 * Builds the per-phase linear reconstruction profiles of the built-in bilinear Bayer demosaic kernel.
 *
 * The result is the ordinary `explicit-linear-native-neighborhood` profile used by RAW frame
 * reconstruction, native RAW development and `createCfaPlaneReconstructionTask`; there is no special
 * code path. Edge pixels need either a region whose neighbourhood stays inside the frame, or mirror
 * border handling.
 *
 * Approximation: fixed linear interpolation, not a calibrated or adaptive demosaic. Bilinear blurs
 * and shows "zipper" artefacts at edges. Aliasing and moiré are not modelled. The adaptive AHD method
 * is `createAhdDemosaicTask`.
 */
export function createBuiltInBayerDemosaicProfiles(input: CreateBuiltInBayerDemosaicProfilesInput): CalculationResult<BuiltInBayerDemosaicProfiles> {
  requireInputKeys(input, "createBuiltInBayerDemosaicProfiles", ["kernel", "captureModeId", "colorSamplingProfile", "channelRoles"]);
  const kernel = input.kernel;
  if (kernel !== "bilinear") throw new InvalidConfigurationError("Unknown built-in Bayer demosaic kernel.");
  const captureModeId = requireNonEmptyString(input.captureModeId, "captureModeId");
  const cfa = parseSensorColorSamplingProfile(input.colorSamplingProfile), layout = cfa.layout;
  const roles = requireRecord(input.channelRoles, "channelRoles", ["red", "green", "blue"]);
  const ids: Record<BayerRole, string> = { R: requireNonEmptyString(roles.red, "channelRoles.red"),
    G: requireNonEmptyString(roles.green, "channelRoles.green"), B: requireNonEmptyString(roles.blue, "channelRoles.blue") };
  if (new Set(Object.values(ids)).size !== 3) throw new InvalidConfigurationError("channelRoles must name three distinct channels.");
  if (layout.kind !== "periodic-mosaic" || layout.repeatWidthSites !== 2 || layout.repeatHeightSites !== 2) {
    throw new InvalidScientificInputError("Built-in Bayer kernels require a 2×2 periodic mosaic.");
  }
  const tile = layout.siteChannelIds.map((id): BayerRole => {
    const found = (["R", "G", "B"] as const).find((r) => ids[r] === id);
    if (found === undefined) throw new InvalidScientificInputError("Bayer CFA channel is not one of channelRoles.");
    return found;
  });
  const red = tile.indexOf("R"), blue = tile.indexOf("B");
  if (tile.filter((r) => r === "G").length !== 2 || red < 0 || blue < 0 || red + blue !== 3) {
    throw new InvalidScientificInputError("Built-in Bayer kernels require one red, one blue and two diagonal green sites.");
  }
  const phaseProfiles = [0, 1, 2, 3].map((i) => {
    const phaseX = i % 2, phaseY = (i - phaseX) / 2, own = tile[i]!;
    const byRole = bayerSiteKernels(own, own === "G" ? tile[phaseY * 2 + (1 - phaseX)]! : null);
    const profile = parseSensorRawReconstructionProfile({
      schemaVersion: SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION, profileId: "photivra-builtin-" + kernel + "-phase-" + phaseX + "-" + phaseY,
      profileVersion: BUILT_IN_BAYER_DEMOSAIC_MODEL_VERSION, captureModeId, colorSamplingProfileId: cfa.profileId, scientificStatus: "approximation",
      method: "explicit-linear-native-neighborhood", normalization: "weights-sum-to-one-per-output-channel", negativeBlackSubtractedValuesAllowed: true,
      kernels: (["R", "G", "B"] as const).map((r) => ({ outputChannelId: ids[r], contributions: byRole[r].map(([offsetX, offsetY, source, weight]) =>
        ({ offsetX, offsetY, sourceChannelId: ids[source], weight })) })),
      evidence: BAYER_DEMOSAIC_EVIDENCE[kernel].map((e) => ({ ...e })),
      limitations: ["Fixed linear Bayer interpolation; not adaptive, calibrated or manufacturer-specific.", "Aliasing, moire and colour fringing are not modelled or suppressed."]
    });
    return { phaseX, phaseY, profile };
  });
  return approximationResult({ kernel, phaseProfiles, outputChannelIds: [ids.R, ids.G, ids.B], kernelReachSites: 1 },
    "built-in-bayer-demosaic-" + kernel, BUILT_IN_BAYER_DEMOSAIC_MODEL_VERSION, [
      "Nearest same-channel bilinear interpolation.",
      "Weights sum to one per output channel and reproduce affine channel signals exactly.",
      "Linear kernels only; adaptive (edge-directed) reconstruction is a separate non-linear path."
    ]);
}
