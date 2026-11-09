// SPDX-License-Identifier: Apache-2.0

/**
 * RAW readout: turns the expected charge in a sensor site into a RAW code, with shot noise, read
 * noise and the ADC (analogue-to-digital converter).
 *
 * The steps, in order:
 * 1. expected charge;
 * 2. separately seeded random photo and dark draws (Poisson shot noise);
 * 3. signed electronic read noise;
 * 4. the upper pre-ADC clipping threshold;
 * 5. the black pedestal (offset);
 * 6. ADC quantization, rounding to nearest with ties up;
 * 7. limits on the unsigned code.
 *
 * Values below black stay signed until the final code clamp. Physical storage saturation, pre-ADC
 * clipping and digital clipping are reported separately. The ISO setting never invents a conversion
 * regime; regimes are declared.
 * @see docs/SENSOR_RAW_PRODUCER.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceBackedFact,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  createDeterministicUniformStream,
  sampleDeterministicStandardNormal,
  samplePortableStandardNormal,
  type DeterministicUniformStream
} from "./stochastic-seed.js";
import { portableExp, portableLog } from "../core/portable-math.js";
import type {
  SensorPhotoAccumulatedChargeComposition as SensorAccumulatedChargeComposition
} from "./accumulated-charge.js";
import type {
  SensorPhysicalChargeCapacityAssessment
} from "./physical-charge-capacity.js";
import type {
  SensorSpectralResponseScientificStatus
} from "./spectral-response.js";
import { requireInputKeys, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigFinite as requireFinite, parseConfigScientificStatus as parseStatus, parseConfigLimitations as parseLimitations, requireConfigFiniteAboveZero as requirePositiveFinite, requireConfigFiniteAtLeastZero as requireNonNegativeFinite } from "../core/record-validation.js";
import {
  evaluateParsedFixedPatternSite,
  parseSensorFixedPatternNoiseProfile,
  type SensorFixedPatternNoiseProfile,
  type SensorFixedPatternSiteValues
} from "./fixed-pattern-noise.js";

export const SENSOR_CHARGE_SAMPLING_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;
export const SENSOR_READOUT_CONVERSION_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;

export type SensorAdditionalChargeSamplingModel =
  | "poisson"
  | "deterministic-expected-electron-equivalent";

export interface SensorAdditionalChargeSamplingPolicy {
  componentId: string;
  model:
    SensorAdditionalChargeSamplingModel;
}

export interface SensorChargeSamplingProfile {
  schemaVersion:
    typeof SENSOR_CHARGE_SAMPLING_PROFILE_SCHEMA_VERSION;
  profileId: string;
  completenessProfileId: string;
  scientificStatus: "approximation";
  photoShotNoiseModel: "poisson";
  darkShotNoiseModel: "poisson";
  additionalComponentPolicies:
    readonly SensorAdditionalChargeSamplingPolicy[];
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface SimulateSensorChargeRealizationInput {
  accumulatedCharge:
    SensorAccumulatedChargeComposition;
  samplingProfile:
    SensorChargeSamplingProfile;
  seedUint32: number;
  /**
   * Optional fixed-pattern noise for this sensor. PRNU (photo-response non-uniformity) scales the
   * photo Poisson mean; DSNU (dark-signal non-uniformity) and hot pixels scale the dark Poisson mean.
   * If omitted, the result is exactly the uniform population model.
   */
  fixedPatternNoise?:
    SensorFixedPatternNoiseProfile;
}

export interface SensorChargeRealization {
  samplingProfileId: string;
  completenessProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  seedUint32: number;
  photoExpectedElectronCount: number;
  photoRealizedElectronCount: number;
  darkExpectedElectronCount: number;
  darkRealizedElectronCount: number;
  /** Fixed-pattern profile applied to this realization, or null for the uniform population model. */
  fixedPatternNoiseProfileId:
    string | null;
  /** PRNU gain applied to the photo expectation (exactly 1 without a fixed pattern). */
  photoResponseGainFactor: number;
  /** DSNU/hot-pixel factor applied to the dark expectation (exactly 1 without a fixed pattern). */
  darkCurrentFactor: number;
  hotPixel: boolean;
  /** Poisson means actually sampled: expectation × the site's fixed-pattern factor. */
  photoSampledMeanElectronCount: number;
  darkSampledMeanElectronCount: number;
  additionalComponents:
    readonly {
      componentId: string;
      expectedElectronCount: number;
      realizedElectronEquivalentCount:
        number;
      model:
        SensorAdditionalChargeSamplingModel;
    }[];
  totalExpectedStoredElectronCount:
    number;
  totalRealizedStoredElectronEquivalentCount:
    number;
  photoShotNoiseApplied: true;
  darkShotNoiseApplied: true;
  electronicReadNoiseApplied: false;
  physicalSaturationApplied: false;
  bloomingModeled: false;
  conversionGainApplied: false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  stochasticModel:
    "independent-poisson-photo-dark-explicit-additional-policy";
  deterministicSeededRealization:
    true;
}

/**
 * Optional ADC integral non-linearity (INL): an offset in code units (LSB, least significant bit),
 * piecewise linear in the ideal continuous ADC input code, added before quantization. The points must
 * start at code 0 and end at the ADC maximum code. If omitted, the ADC is ideal and uniform.
 */
export interface SensorAdcIntegralNonLinearity {
  kind: "piecewise-linear-code-offset";
  knots: readonly { code: number; offsetCodes: number }[];
  evidence: readonly EvidenceProvenance[];
}

/**
 * Optional record of how one regime's ISO gain was derived (the exposure index of CIPA DC-004,
 * relative to the base exposure index). The readout equations still use
 * systemConversionGainElectronsPerCode (analog, before the ADC) and adc.digitalGain (after the ADC).
 * This record must agree with them and never replaces them.
 */
export interface SensorReadoutExposureIndexGain {
  exposureIndex: number;
  baseExposureIndex: number;
  /** Analog (pre-ADC) gain relative to the base-exposure-index regime. */
  analogGain: number;
  /** Post-ADC digital gain; equals adc.digitalGain (1 when omitted). */
  digitalGain: number;
  conversionGainMode:
    | "single-conversion-gain"
    | "low-conversion-gain"
    | "high-conversion-gain";
  evidence: readonly EvidenceProvenance[];
}

export interface SensorElectronicReadNoiseComponent {
  componentId: string;
  rmsElectrons:
    EvidenceBackedFact<number>;
  evidence:
    readonly EvidenceProvenance[];
}

/**
 * One explicitly selected electronic conversion regime. It has a sourced number of
 * electrons per code, an upper pre-ADC threshold in electron equivalents, separate
 * read-noise components (RMS electrons) and an unsigned ADC coding policy. The black
 * pedestal and digital saturation are in code units. The regime does not guess its
 * hardware mechanism, is not chosen from ISO automatically, and does not replace
 * physical storage capacity.
 */
export interface SensorReadoutConversionRegime {
  regimeId: string;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  systemConversionGainElectronsPerCode:
    EvidenceBackedFact<number>;
  preAdcSaturationElectronEquivalent:
    EvidenceBackedFact<number>;
  readNoiseComponents:
    readonly SensorElectronicReadNoiseComponent[];
  adc: {
    bitDepth: number;
    blackLevelCode: number;
    digitalSaturationCode: number;
    transfer:
      "uniform-round-half-up";
    /**
     * Optional post-ADC digital gain (>= 1) applied about the black level:
     * code = roundHalfUp((adcCode - black) * digitalGain + black). Omission means 1.
     */
    digitalGain?: number;
    integralNonLinearity?:
      SensorAdcIntegralNonLinearity;
  };
  exposureIndexGain?:
    SensorReadoutExposureIndexGain;
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface SensorReadoutConversionProfile {
  schemaVersion:
    typeof SENSOR_READOUT_CONVERSION_PROFILE_SCHEMA_VERSION;
  profileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  regimes:
    readonly SensorReadoutConversionRegime[];
  regimeSelectionOwnedBy:
    "explicit-upstream-camera-state-not-inferred-from-iso";
  evidence:
    readonly EvidenceProvenance[];
}

export interface ResolveSensorReadoutRegimeInput {
  profile:
    SensorReadoutConversionProfile;
  regimeId: string;
}

export interface ResolvedSensorReadoutRegime {
  profileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  regime:
    SensorReadoutConversionRegime;
  regimeSelectionOwnedBy:
    "explicit-upstream-camera-state-not-inferred-from-iso";
  adcMaximumCode: number;
  combinedReadNoiseRmsElectrons:
    number;
}

export interface CalculateExpectedSensorReadoutInput {
  accumulatedCharge:
    SensorAccumulatedChargeComposition;
  physicalCapacityAssessment:
    SensorPhysicalChargeCapacityAssessment;
  readoutProfile:
    SensorReadoutConversionProfile;
  regimeId: string;
}

export interface SensorExpectedReadoutSignal {
  readoutProfileId: string;
  regimeId: string;
  completenessProfileId: string;
  capacityProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  expectedStoredElectronCount:
    number;
  expectedStoredChargeBelowOrAtPhysicalCapacity:
    true;
  expectedElectronEquivalentAfterPreAdcSaturation:
    number;
  preAdcSaturationAppliedToExpectation:
    boolean;
  systemConversionGainElectronsPerCode:
    number;
  expectedCodeBeforeBlackOffset:
    number;
  blackLevelCode: number;
  /** Continuous ADC input code including any declared INL offset. */
  expectedCodeBeforeQuantization:
    number;
  adcIntegralNonLinearityOffsetCodes:
    number;
  digitalGain: number;
  /** Continuous code after post-ADC digital gain about black (equals the ADC input without one). */
  expectedCodeAfterDigitalGain:
    number;
  adcBitDepth: number;
  adcMaximumCode: number;
  digitalSaturationCode: number;
  expectedDigitalSaturation:
    boolean;
  electronicReadNoiseMeanElectrons:
    0;
  electronicReadNoiseRmsElectrons:
    number;
  electronicReadNoiseSampled: false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  isoUsedToInferRegime: false;
}

export interface SimulateSensorRawCodeInput {
  chargeRealization:
    SensorChargeRealization;
  physicalCapacityAssessment:
    SensorPhysicalChargeCapacityAssessment;
  readoutProfile:
    SensorReadoutConversionProfile;
  regimeId: string;
  readNoiseSeedUint32: number;
  /**
   * Optional fixed pattern; must be the same profile used for the charge realization. Its static
   * row/column offsets are added with read noise before the pre-ADC threshold.
   */
  fixedPatternNoise?:
    SensorFixedPatternNoiseProfile;
}

export interface SensorRawCodeSample {
  readoutProfileId: string;
  regimeId: string;
  samplingProfileId: string;
  completenessProfileId: string;
  capacityProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  chargeSeedUint32: number;
  readNoiseSeedUint32: number;
  realizedStoredElectronEquivalentCountBeforePhysicalCapacity:
    number;
  physicalChargeCapacityElectrons:
    number;
  electronEquivalentAfterPhysicalScalarSaturation:
    number;
  physicalScalarSaturationApplied:
    boolean;
  overflowElectronEquivalentDiagnostic:
    number;
  bloomingModeled: false;
  electronicReadNoiseComponents:
    readonly {
      componentId: string;
      rmsElectrons: number;
      sampledElectrons: number;
    }[];
  totalElectronicReadNoiseElectrons:
    number;
  /** Fixed-pattern profile applied at readout, or null. */
  fixedPatternNoiseProfileId:
    string | null;
  /** Static fixed-pattern row + column offset in input-referred electrons (0 without a pattern). */
  fixedPatternReadoutOffsetElectrons:
    number;
  electronEquivalentAfterReadNoise:
    number;
  preAdcSaturationElectronEquivalent:
    number;
  /** Signed electronic signal after the upper (pre-ADC) clip, before conversion and the black pedestal. */
  electronEquivalentAfterPreAdcSaturation:
    number;
  preAdcSaturationApplied:
    boolean;
  systemConversionGainElectronsPerCode:
    number;
  blackLevelCode: number;
  /** Continuous ADC input code including any declared integral non-linearity offset. */
  codeBeforeQuantization:
    number;
  /** INL offset added before quantization (0 for an ideal ADC). */
  adcIntegralNonLinearityOffsetCodes:
    number;
  /** ADC output after quantization and the ADC code-range limit, before digital gain. */
  adcCodeBeforeDigitalGain:
    number;
  /** Post-ADC digital gain (1 when the regime declares none). */
  digitalGain: number;
  quantizedCodeBeforeDigitalClamp:
    number;
  adcBitDepth: number;
  adcMaximumCode: number;
  digitalSaturationCode: number;
  rawCode: number;
  digitalSaturationApplied:
    boolean;
  lowerCodeClampApplied:
    boolean;
  adcTransfer:
    "uniform-round-half-up";
  physicalSaturationApplied: boolean;
  electronicReadNoiseApplied:
    boolean;
  conversionGainApplied: true;
  adcQuantizationApplied: true;
  rawCodeValueProduced: true;
  isoUsedToInferRegime: false;
  deterministicSeededRealization:
    true;
}

function requireUint32(
  value: unknown,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0xffff_ffff
  ) {
    throw new InvalidScientificInputError(
      path +
        " must be an unsigned 32-bit integer."
    );
  }
  return value;
}

export function requireSafeInteger(
  value: unknown,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value)
  ) {
    throw new InvalidConfigurationError(
      path + " must be a safe integer."
    );
  }
  return value;
}

export function parsePositiveFact(
  value: unknown,
  path: string
): EvidenceBackedFact<number> {
  const record =
    requireRecord(value, path, ["value", "evidence"]);
  return {
    value:
      requirePositiveFinite(
        record.value,
        path + ".value"
      ),
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
  };
}

export function parseNonNegativeFact(
  value: unknown,
  path: string
): EvidenceBackedFact<number> {
  const record =
    requireRecord(value, path, ["value", "evidence"]);
  return {
    value:
      requireNonNegativeFinite(
        record.value,
        path + ".value"
      ),
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
  };
}

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The profile sets how expected charge is sampled into random photo and dark counts.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseSensorChargeSamplingProfile(
  value: unknown
): SensorChargeSamplingProfile {
  const record =
    requireRecord(
      value,
      "sensorChargeSamplingProfile", ["schemaVersion", "scientificStatus", "photoShotNoiseModel", "darkShotNoiseModel", "additionalComponentPolicies", "profileId", "completenessProfileId", "evidence", "limitations"]
    );

  if (
    record.schemaVersion !==
    SENSOR_CHARGE_SAMPLING_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sensorChargeSamplingProfile.schemaVersion must be "' +
        SENSOR_CHARGE_SAMPLING_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      'sensorChargeSamplingProfile.scientificStatus must be "approximation".'
    );
  }
  if (
    record.photoShotNoiseModel !==
      "poisson" ||
    record.darkShotNoiseModel !==
      "poisson"
  ) {
    throw new InvalidConfigurationError(
      "sensorChargeSamplingProfile photo/dark shot-noise models must be Poisson."
    );
  }
  if (
    !Array.isArray(
      record.additionalComponentPolicies
    )
  ) {
    throw new InvalidConfigurationError(
      "sensorChargeSamplingProfile.additionalComponentPolicies must be an array."
    );
  }

  const additionalComponentPolicies =
    record.additionalComponentPolicies.map(
      (entry, index) => {
        const path =
          "sensorChargeSamplingProfile.additionalComponentPolicies[" +
          index +
          "]";
        const policy =
          requireRecord(
            entry,
            path, ["model", "componentId"]
          );
        if (
          policy.model !==
            "poisson" &&
          policy.model !==
            "deterministic-expected-electron-equivalent"
        ) {
          throw new InvalidConfigurationError(
            path +
              ".model is invalid."
          );
        }
        return {
          componentId:
            requireNonEmptyString(
              policy.componentId,
              path +
                ".componentId"
            ),
          model:
            policy.model
        } as SensorAdditionalChargeSamplingPolicy;
      }
    );

  const ids =
    additionalComponentPolicies.map(
      (policy) =>
        policy.componentId
    );
  if (
    new Set(ids).size !==
    ids.length
  ) {
    throw new InvalidConfigurationError(
      "sensorChargeSamplingProfile.additionalComponentPolicies must not contain duplicate componentId values."
    );
  }

  return {
    schemaVersion:
      SENSOR_CHARGE_SAMPLING_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "sensorChargeSamplingProfile.profileId"
      ),
    completenessProfileId:
      requireNonEmptyString(
        record.completenessProfileId,
        "sensorChargeSamplingProfile.completenessProfileId"
      ),
    scientificStatus:
      "approximation",
    photoShotNoiseModel:
      "poisson",
    darkShotNoiseModel:
      "poisson",
    additionalComponentPolicies,
    evidence:
      parseEvidenceList(
        record.evidence,
        "sensorChargeSamplingProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "sensorChargeSamplingProfile.limitations"
      )
  };
}

function parseReadNoiseComponent(
  value: unknown,
  path: string
): SensorElectronicReadNoiseComponent {
  const record =
    requireRecord(value, path, ["componentId", "rmsElectrons", "evidence"]);
  return {
    componentId:
      requireNonEmptyString(
        record.componentId,
        path + ".componentId"
      ),
    rmsElectrons:
      parseNonNegativeFact(
        record.rmsElectrons,
        path + ".rmsElectrons"
      ),
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
  };
}

function parseIntegralNonLinearity(
  value: unknown,
  path: string,
  adcMaximumCode: number
): SensorAdcIntegralNonLinearity {
  const record =
    requireRecord(value, path, ["kind", "knots", "evidence"]);
  if (
    record.kind !==
    "piecewise-linear-code-offset"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.kind must be "piecewise-linear-code-offset".'
    );
  }
  if (
    !Array.isArray(record.knots) ||
    record.knots.length < 2 ||
    record.knots.length > 4096
  ) {
    throw new InvalidConfigurationError(
      path +
        ".knots must contain 2 through 4096 knots."
    );
  }
  const knots =
    record.knots.map(
      (entry: unknown, index: number) => {
        const knot =
          requireRecord(
            entry,
            path + ".knots[" + index + "]", ["code", "offsetCodes"]
          );
        return {
          code: requireFinite(
            knot.code,
            path + ".knots[" + index + "].code"
          ),
          offsetCodes: requireFinite(
            knot.offsetCodes,
            path + ".knots[" + index + "].offsetCodes"
          )
        };
      }
    );
  if (
    knots[0]!.code !== 0 ||
    knots[knots.length - 1]!.code !==
      adcMaximumCode ||
    knots.some(
      (knot, index) =>
        index > 0 &&
        knot.code <=
          knots[index - 1]!.code
    ) ||
    knots.some(
      (knot) =>
        Math.abs(knot.offsetCodes) >
        adcMaximumCode
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        ".knots must strictly increase from code 0 to the ADC maximum code with bounded offsets."
    );
  }
  return {
    kind:
      "piecewise-linear-code-offset",
    knots,
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
  };
}

function parseExposureIndexGain(
  value: unknown,
  path: string,
  adcDigitalGain: number
): SensorReadoutExposureIndexGain {
  const record =
    requireRecord(value, path, ["exposureIndex", "baseExposureIndex", "analogGain", "digitalGain", "conversionGainMode", "evidence"]);
  const exposureIndex =
    requirePositiveFinite(
      record.exposureIndex,
      path + ".exposureIndex"
    );
  const baseExposureIndex =
    requirePositiveFinite(
      record.baseExposureIndex,
      path + ".baseExposureIndex"
    );
  const analogGain =
    requirePositiveFinite(
      record.analogGain,
      path + ".analogGain"
    );
  const digitalGain =
    requirePositiveFinite(
      record.digitalGain,
      path + ".digitalGain"
    );
  const mode =
    record.conversionGainMode;
  if (
    mode !== "single-conversion-gain" &&
    mode !== "low-conversion-gain" &&
    mode !== "high-conversion-gain"
  ) {
    throw new InvalidConfigurationError(
      path +
        ".conversionGainMode is invalid."
    );
  }
  const ratio =
    exposureIndex /
    baseExposureIndex;
  if (
    digitalGain !==
      adcDigitalGain ||
    Math.abs(
      analogGain * digitalGain -
        ratio
    ) >
      1e-12 * ratio
  ) {
    throw new InvalidConfigurationError(
      path +
        " must satisfy analogGain x digitalGain = exposureIndex / baseExposureIndex and digitalGain = adc.digitalGain."
    );
  }
  return {
    exposureIndex,
    baseExposureIndex,
    analogGain,
    digitalGain,
    conversionGainMode: mode,
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
  };
}

function parseRegime(
  value: unknown,
  path: string
): SensorReadoutConversionRegime {
  const record =
    requireRecord(value, path, ["adc", "readNoiseComponents", "systemConversionGainElectronsPerCode", "exposureIndexGain", "regimeId", "scientificStatus", "preAdcSaturationElectronEquivalent", "evidence", "limitations"]);
  const adc =
    requireRecord(
      record.adc,
      path + ".adc", ["bitDepth", "blackLevelCode", "digitalSaturationCode", "transfer", "digitalGain", "integralNonLinearity"]
    );
  const bitDepth =
    requireSafeInteger(
      adc.bitDepth,
      path + ".adc.bitDepth"
    );
  if (
    bitDepth < 1 ||
    bitDepth > 30
  ) {
    throw new InvalidConfigurationError(
      path +
        ".adc.bitDepth must be from 1 through 30."
    );
  }
  const adcMaximumCode =
    2 ** bitDepth - 1;
  const blackLevelCode =
    requireSafeInteger(
      adc.blackLevelCode,
      path + ".adc.blackLevelCode"
    );
  const digitalSaturationCode =
    requireSafeInteger(
      adc.digitalSaturationCode,
      path +
        ".adc.digitalSaturationCode"
    );

  if (
    blackLevelCode < 0 ||
    blackLevelCode >
      adcMaximumCode
  ) {
    throw new InvalidConfigurationError(
      path +
        ".adc.blackLevelCode must lie inside the unsigned ADC code range."
    );
  }
  if (
    digitalSaturationCode <=
      blackLevelCode ||
    digitalSaturationCode >
      adcMaximumCode
  ) {
    throw new InvalidConfigurationError(
      path +
        ".adc.digitalSaturationCode must be greater than blackLevelCode and at most the ADC maximum code."
    );
  }
  if (
    adc.transfer !==
    "uniform-round-half-up"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.adc.transfer must be "uniform-round-half-up".'
    );
  }
  if (
    !Array.isArray(
      record.readNoiseComponents
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        ".readNoiseComponents must be an array."
    );
  }
  const readNoiseComponents =
    record.readNoiseComponents.map(
      (entry, index) =>
        parseReadNoiseComponent(
          entry,
          path +
            ".readNoiseComponents[" +
            index +
            "]"
        )
    );
  const componentIds =
    readNoiseComponents.map(
      (entry) =>
        entry.componentId
    );
  if (
    new Set(componentIds).size !==
    componentIds.length
  ) {
    throw new InvalidConfigurationError(
      path +
        ".readNoiseComponents must not contain duplicate componentId values."
    );
  }

  const digitalGain =
    adc.digitalGain === undefined
      ? undefined
      : requireFinite(
          adc.digitalGain,
          path + ".adc.digitalGain"
        );
  if (
    digitalGain !== undefined &&
    (digitalGain < 1 ||
      digitalGain > 65536)
  ) {
    throw new InvalidConfigurationError(
      path +
        ".adc.digitalGain must be from 1 through 65536."
    );
  }
  const integralNonLinearity =
    adc.integralNonLinearity === undefined
      ? undefined
      : parseIntegralNonLinearity(
          adc.integralNonLinearity,
          path + ".adc.integralNonLinearity",
          adcMaximumCode
        );
  const systemConversionGainElectronsPerCode =
    parsePositiveFact(
      record
        .systemConversionGainElectronsPerCode,
      path +
        ".systemConversionGainElectronsPerCode"
    );
  const exposureIndexGain =
    record.exposureIndexGain === undefined
      ? undefined
      : parseExposureIndexGain(
          record.exposureIndexGain,
          path + ".exposureIndexGain",
          digitalGain ?? 1
        );

  return {
    regimeId:
      requireNonEmptyString(
        record.regimeId,
        path + ".regimeId"
      ),
    scientificStatus:
      parseStatus(
        record.scientificStatus,
        path +
          ".scientificStatus"
      ),
    systemConversionGainElectronsPerCode,
    preAdcSaturationElectronEquivalent:
      parsePositiveFact(
        record
          .preAdcSaturationElectronEquivalent,
        path +
          ".preAdcSaturationElectronEquivalent"
      ),
    readNoiseComponents,
    adc: {
      bitDepth,
      blackLevelCode,
      digitalSaturationCode,
      transfer:
        "uniform-round-half-up",
      ...(digitalGain === undefined
        ? {}
        : { digitalGain }),
      ...(integralNonLinearity === undefined
        ? {}
        : { integralNonLinearity })
    },
    ...(exposureIndexGain === undefined
      ? {}
      : { exposureIndexGain }),
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        path + ".limitations"
      )
  };
}

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The profile lists the declared conversion regimes. ISO never invents a regime.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseSensorReadoutConversionProfile(
  value: unknown
): SensorReadoutConversionProfile {
  const record =
    requireRecord(
      value,
      "sensorReadoutConversionProfile", ["schemaVersion", "regimeSelectionOwnedBy", "regimes", "profileId", "colorSamplingProfileId", "channelId", "evidence"]
    );
  if (
    record.schemaVersion !==
    SENSOR_READOUT_CONVERSION_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sensorReadoutConversionProfile.schemaVersion must be "' +
        SENSOR_READOUT_CONVERSION_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.regimeSelectionOwnedBy !==
    "explicit-upstream-camera-state-not-inferred-from-iso"
  ) {
    throw new InvalidConfigurationError(
      'sensorReadoutConversionProfile.regimeSelectionOwnedBy must be "explicit-upstream-camera-state-not-inferred-from-iso".'
    );
  }
  if (
    !Array.isArray(
      record.regimes
    ) ||
    record.regimes.length === 0
  ) {
    throw new InvalidConfigurationError(
      "sensorReadoutConversionProfile.regimes must be a non-empty array."
    );
  }
  const regimes =
    record.regimes.map(
      (entry, index) =>
        parseRegime(
          entry,
          "sensorReadoutConversionProfile.regimes[" +
            index +
            "]"
        )
    );
  const ids =
    regimes.map(
      (regime) =>
        regime.regimeId
    );
  if (
    new Set(ids).size !==
    ids.length
  ) {
    throw new InvalidConfigurationError(
      "sensorReadoutConversionProfile.regimes must not contain duplicate regimeId values."
    );
  }

  return {
    schemaVersion:
      SENSOR_READOUT_CONVERSION_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "sensorReadoutConversionProfile.profileId"
      ),
    colorSamplingProfileId:
      requireNonEmptyString(
        record.colorSamplingProfileId,
        "sensorReadoutConversionProfile.colorSamplingProfileId"
      ),
    channelId:
      requireNonEmptyString(
        record.channelId,
        "sensorReadoutConversionProfile.channelId"
      ),
    regimes,
    regimeSelectionOwnedBy:
      "explicit-upstream-camera-state-not-inferred-from-iso",
    evidence:
      parseEvidenceList(
        record.evidence,
        "sensorReadoutConversionProfile.evidence"
      )
  };
}

/**
 * Selects a declared readout regime and checks it against the exact channel and profile identity.
 * The regime is never inferred from ISO.
 * @param input - The input; see `ResolveSensorReadoutRegimeInput` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function resolveSensorReadoutRegime(
  input:
    ResolveSensorReadoutRegimeInput
): ResolvedSensorReadoutRegime {
  requireInputKeys(input, "resolveSensorReadoutRegime", ["profile", "regimeId"]);
  const profile =
    parseSensorReadoutConversionProfile(
      input.profile
    );
  if (
    typeof input.regimeId !==
      "string" ||
    input.regimeId.trim().length ===
      0
  ) {
    throw new InvalidConfigurationError(
      "regimeId must be a non-empty string."
    );
  }
  const regimeId =
    input.regimeId.trim();
  const regime =
    profile.regimes.find(
      (entry) =>
        entry.regimeId === regimeId
    );
  if (regime === undefined) {
    throw new InvalidScientificInputError(
      "regimeId is not declared by the sensor readout conversion profile."
    );
  }
  const combinedReadNoiseRmsElectrons =
    Math.sqrt(
      regime.readNoiseComponents.reduce(
        (sum, component) =>
          sum +
          component
            .rmsElectrons.value *
            component
              .rmsElectrons.value,
        0
      )
    );

  return {
    profileId:
      profile.profileId,
    colorSamplingProfileId:
      profile.colorSamplingProfileId,
    channelId:
      profile.channelId,
    regime,
    regimeSelectionOwnedBy:
      profile
        .regimeSelectionOwnedBy,
    adcMaximumCode:
      2 **
        regime.adc.bitDepth -
      1,
    combinedReadNoiseRmsElectrons
  };
}

function validateChargeIdentity(
  charge:
    SensorAccumulatedChargeComposition,
  capacity:
    SensorPhysicalChargeCapacityAssessment,
  readout:
    ResolvedSensorReadoutRegime
): true {
  if (
    charge.completenessProfileId !==
      capacity
        .completenessProfileId ||
    charge.colorSamplingProfileId !==
      capacity
        .colorSamplingProfileId ||
    charge.channelId !==
      capacity.channelId ||
    charge.site.x !==
      capacity.site.x ||
    charge.site.y !==
      capacity.site.y ||
    charge.bindingId !==
      capacity.bindingId
  ) {
    throw new InvalidScientificInputError(
      "Physical capacity assessment identity must match the accumulated charge."
    );
  }
  // The assessment copies the complete expected stored-electron total exactly from the charge it
  // assessed. So the match must be exact: an assessment made for any other charge is out of date.
  if (
    charge
      .totalExpectedStoredElectronCount !==
    capacity
      .totalExpectedStoredElectronCount
  ) {
    throw new InvalidScientificInputError(
      "Physical capacity assessment must be computed for the supplied accumulated charge; its total expected stored electrons differ."
    );
  }
  if (
    readout
      .colorSamplingProfileId !==
      charge.colorSamplingProfileId ||
    readout.channelId !==
      charge.channelId
  ) {
    throw new InvalidScientificInputError(
      "Sensor readout profile color/channel identity must match the accumulated charge."
    );
  }
  const belowOrAtCapacity =
    capacity
      .totalExpectedStoredElectronCount <=
    capacity
      .physicalChargeCapacityElectrons;
  if (
    capacity
      .expectedChargeCapacityStatus ===
      "above-capacity" ||
    !belowOrAtCapacity
  ) {
    throw new InvalidScientificInputError(
      "Expected stored charge above physical capacity cannot enter linear expected readout; the actual post-saturation stored charge is not defined by the upstream assessment."
    );
  }
  if (
    charge.saturationAssessed !==
      false ||
    charge.adcQuantizationApplied !==
      false ||
    charge.rawCodeValueProduced !==
      false
  ) {
    throw new InvalidScientificInputError(
      "Sensor readout requires the unmodified accumulated-charge result."
    );
  }
  return belowOrAtCapacity;
}

function additionalPolicyMap(
  profile:
    SensorChargeSamplingProfile,
  charge:
    SensorAccumulatedChargeComposition
): ReadonlyMap<
  string,
  SensorAdditionalChargeSamplingPolicy
> {
  if (
    profile.completenessProfileId !==
    charge.completenessProfileId
  ) {
    throw new InvalidScientificInputError(
      "Charge sampling profile completenessProfileId must match the accumulated charge."
    );
  }

  const chargeIds =
    charge.additionalComponents.map(
      (component) =>
        component.componentId
    ).sort();
  const policyIds =
    profile
      .additionalComponentPolicies
      .map(
        (policy) =>
          policy.componentId
      )
      .sort();

  if (
    chargeIds.length !==
      policyIds.length ||
    chargeIds.some(
      (id, index) =>
        id !== policyIds[index]
    )
  ) {
    throw new InvalidScientificInputError(
      "Charge sampling profile must declare exactly one policy for every accumulated additional-charge component."
    );
  }

  return new Map(
    profile.additionalComponentPolicies.map(
      (policy) => [
        policy.componentId,
        policy
      ] as const
    )
  );
}

type DeterministicRandom = DeterministicUniformStream;

function createRandom(
  seedUint32: number
): DeterministicRandom {
  return createDeterministicUniformStream(seedUint32);
}

/**
 * log(n!) for n < 256: entry n is ln 2 + ln 3 + … + ln n, summed in that order, so each entry
 * is bit-identical to summing the logarithms on demand (the partial sums of one loop).
 */
const SMALL_LOG_FACTORIALS = ((): Float64Array => {
  const table = new Float64Array(256);
  let sum = 0;
  for (let value = 2; value < 256; value += 1) {
    sum += Math.log(value);
    table[value] = sum;
  }
  return table;
})();

/**
 * Computes log(n!) without forming the factorial, which would overflow. Small counts
 * sum the logarithms directly (read from a table of the same partial sums). Larger counts
 * use Stirling's formula with the correction terms 1/(12n) - 1/(360n³). This is internal
 * to the Poisson rejection sampler; it is not a claim about physical accuracy or uncertainty.
 */
function logFactorial(
  n: number
): number {
  if (n < 2) {
    return 0;
  }
  if (n < 256) {
    return SMALL_LOG_FACTORIALS[n]!;
  }

  const inverse = 1 / n;
  const inverseCubed =
    inverse * inverse * inverse;
  return (
    (n + 0.5) * Math.log(n) -
    n +
    0.5 *
      Math.log(
        2 * Math.PI
      ) +
    inverse / 12 -
    inverseCubed / 360
  );
}

/** Means at or above this use the continuity-corrected normal approximation. */
const POISSON_NORMAL_APPROXIMATION_MINIMUM_MEAN =
  1e9;

/**
 * Draws a nonnegative integer from a Poisson distribution with the given mean.
 *
 * - Mean 0 returns exactly 0.
 * - Mean below 30: multiply uniform random numbers until the product drops below e^(−mean).
 * - Mean from 30 to below 1e9: Hörmann's (1993) PTRS transformed rejection, comparing log
 *   probabilities to avoid overflow.
 * - Mean of 1e9 and above: a continuity-corrected normal approximation, because the log terms lose
 *   precision there.
 *
 * The same mean and random stream reproduce the same draw. Increasing the mean does not guarantee
 * that each individual draw increases. Exported internally for the lean native executor, which must
 * draw exactly as simulateSensorChargeRealization does; not exported from the package.
 */
export function samplePoisson(
  mean: number,
  random:
    DeterministicRandom
): number {
  if (
    !Number.isFinite(mean) ||
    mean < 0
  ) {
    throw new InvalidScientificInputError(
      "Poisson mean must be finite and nonnegative."
    );
  }
  if (mean === 0) {
    return 0;
  }

  if (
    mean >=
    POISSON_NORMAL_APPROXIMATION_MINIMUM_MEAN
  ) {
    // Above 1e9 the log-probability terms of the rejection test reach about 1e10 and cancel badly
    // (variance/mean is 1.012 at 1e14). Here the continuity-corrected normal approximation has a
    // relative skewness error of 1/sqrt(mean) <= 3.2e-5 (Poisson skewness 1/sqrt(mean): NIST/SEMATECH
    // e-Handbook of Statistical Methods, sec. 1.3.6.6.19, free; normal approximation with continuity
    // correction: SOCR, University of Michigan, free. Also see: Johnson, Kemp & Kotz, Univariate
    // Discrete Distributions, 3rd ed., section 4.4).
    return Math.max(
      0,
      Math.floor(
        mean +
          Math.sqrt(mean) *
            sampleStandardNormal(
              random
            ) +
          0.5
      )
    );
  }

  if (mean < 30) {
    const threshold =
      Math.exp(-mean);
    let product = 1;
    let count = 0;
    do {
      count += 1;
      product *=
        random.next();
    } while (
      product > threshold
    );
    return count - 1;
  }

  const sqrtMean =
    Math.sqrt(mean);
  const b =
    0.931 +
    2.53 * sqrtMean;
  const a =
    -0.059 +
    0.02483 * b;
  const inverseAlpha =
    1.1239 +
    1.1328 /
      (b - 3.4);
  const vR =
    0.9277 -
    3.6224 /
      (b - 2);

  for (;;) {
    const u =
      random.next() - 0.5;
    const v =
      random.next();
    const uS =
      0.5 - Math.abs(u);
    if (uS <= 0) {
      continue;
    }
    const k =
      Math.floor(
        (2 * a / uS + b) *
          u +
          mean +
          0.43
      );

    if (
      uS >= 0.07 &&
      v <= vR &&
      k >= 0
    ) {
      return k;
    }
    if (
      k < 0 ||
      (
        uS < 0.013 &&
        v > uS
      )
    ) {
      continue;
    }

    const lhs =
      Math.log(
        v *
          inverseAlpha /
          (a /
            (uS * uS) +
            b)
      );
    const rhs =
      -mean +
      k * Math.log(mean) -
      logFactorial(k);

    if (lhs <= rhs) {
      return k;
    }
  }
}

/** log(n!) as `logFactorial` computes it, with the portable logarithm (`portableLog`) in place of Math.log. */
let portableSmallLogFactorials: Float64Array | undefined;
function portableLogFactorial(n: number): number {
  if (n < 2) return 0;
  if (n < 256) {
    if (!portableSmallLogFactorials) {
      const table = new Float64Array(256);
      let sum = 0;
      for (let value = 2; value < 256; value += 1) { sum += portableLog(value); table[value] = sum; }
      portableSmallLogFactorials = table;
    }
    return portableSmallLogFactorials[n]!;
  }
  const inverse = 1 / n, inverseCubed = inverse * inverse * inverse;
  // 0.5·ln(2π), as logFactorial forms it; computed on first use, so a bundle without the portable sampler need not evaluate it.
  portableHalfLogTwoPi ??= 0.5 * portableLog(2 * Math.PI);
  return (n + 0.5) * portableLog(n) - n + portableHalfLogTwoPi + inverse / 12 - inverseCubed / 360;
}
let portableHalfLogTwoPi: number | undefined;

/**
 * Internal (not exported from the package): `samplePoisson` for one fixed mean, with the per-mean constants (e^(−mean),
 * the PTRS constants and ln mean) computed once. Each draw takes the same branch, reads the same random values and
 * forms every value with the same expressions as `samplePoisson(mean, random)`, so the draws are identical; it is for
 * callers that draw many times with one mean (the display view's AHD correction).
 *
 * With `portable` true, every exponential, logarithm and normal draw uses the engine's portable functions
 * (`portableExp`, `portableLog`, `samplePortableStandardNormal`) instead of Math.exp, Math.log and the Box–Muller of
 * Math.log/Math.cos, so the draws are the same in every JavaScript engine; they then equal `samplePoisson`'s except
 * where a comparison falls within the last-bit difference of those functions. The display view uses this form.
 */
export function createPoissonSampler(
  mean: number,
  portable = false
): (random: DeterministicRandom) => number {
  if (
    !Number.isFinite(mean) ||
    mean < 0
  ) {
    throw new InvalidScientificInputError(
      "Poisson mean must be finite and nonnegative."
    );
  }
  if (mean === 0) {
    return () => 0;
  }
  const exp = portable ? portableExp : Math.exp, log = portable ? portableLog : Math.log;
  const logFactorialOf = portable ? portableLogFactorial : logFactorial;
  if (
    mean >=
    POISSON_NORMAL_APPROXIMATION_MINIMUM_MEAN
  ) {
    if (!portable) return (random) => samplePoisson(mean, random);
    const sqrtMean = Math.sqrt(mean);
    return (random) => Math.max(0, Math.floor(mean + sqrtMean * samplePortableStandardNormal(random) + 0.5));
  }
  if (mean < 30) {
    const threshold =
      exp(-mean);
    return (random) => {
      let product = 1;
      let count = 0;
      do {
        count += 1;
        product *=
          random.next();
      } while (
        product > threshold
      );
      return count - 1;
    };
  }
  const sqrtMean =
    Math.sqrt(mean);
  const b =
    0.931 +
    2.53 * sqrtMean;
  const a =
    -0.059 +
    0.02483 * b;
  const inverseAlpha =
    1.1239 +
    1.1328 /
      (b - 3.4);
  const vR =
    0.9277 -
    3.6224 /
      (b - 2);
  const logMean =
    log(mean);
  return (random) => {
    for (;;) {
      const u =
        random.next() - 0.5;
      const v =
        random.next();
      const uS =
        0.5 - Math.abs(u);
      if (uS <= 0) {
        continue;
      }
      const k =
        Math.floor(
          (2 * a / uS + b) *
            u +
            mean +
            0.43
        );
      if (
        uS >= 0.07 &&
        v <= vR &&
        k >= 0
      ) {
        return k;
      }
      if (
        k < 0 ||
        (
          uS < 0.013 &&
          v > uS
        )
      ) {
        continue;
      }
      const lhs =
        log(
          v *
            inverseAlpha /
            (a /
              (uS * uS) +
              b)
        );
      const rhs =
        -mean +
        k * logMean -
        logFactorialOf(k);
      if (lhs <= rhs) {
        return k;
      }
    }
  };
}

/**
 * Internal (not exported from the package): draws `count` Poisson samples of one mean from one seeded
 * stream, exactly as the charge realization does. Used by the sampler's distribution tests.
 */
export function samplePoissonStreamForValidation(
  mean: number,
  seedUint32: number,
  count: number
): number[] {
  const random =
    createRandom(seedUint32);
  return Array.from(
    { length: count },
    () =>
      samplePoisson(
        mean,
        random
      )
  );
}

/**
 * Internal (not exported from the package): draws `count` standard normal values from one seeded
 * stream, exactly as the read-noise path does. Used by the sampler's distribution tests.
 */
export function sampleStandardNormalStreamForValidation(
  seedUint32: number,
  count: number
): number[] {
  const random =
    createRandom(seedUint32);
  return Array.from(
    { length: count },
    () =>
      sampleStandardNormal(
        random
      )
  );
}

function sampleStandardNormal(
  random:
    DeterministicRandom
): number {
  return sampleDeterministicStandardNormal(random);
}

/**
 * Draws deterministic, separately seeded Poisson counts for photo and dark charge, and applies the
 * declared policies for additional components, starting from the expected accumulated charge.
 *
 * This is steps 1–2 of the readout order (see the module notes). Physical storage saturation is
 * reported separately from later clipping.
 * @param input - The input; see `SimulateSensorChargeRealizationInput` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function simulateSensorChargeRealization(
  input:
    SimulateSensorChargeRealizationInput
): CalculationResult<SensorChargeRealization> {
  requireInputKeys(input, "simulateSensorChargeRealization", ["accumulatedCharge", "samplingProfile", "seedUint32", "fixedPatternNoise"]);
  const profile =
    parseSensorChargeSamplingProfile(
      input.samplingProfile
    );
  const seed =
    requireUint32(
      input.seedUint32,
      "seedUint32"
    );
  const charge =
    input.accumulatedCharge;

  if (
    charge.accumulatedChargeCompleteness !==
      "complete-for-physical-storage-capacity-assessment" ||
    charge.saturationAssessed !==
      false ||
    charge.adcQuantizationApplied !==
      false ||
    charge.rawCodeValueProduced !==
      false
  ) {
    throw new InvalidScientificInputError(
      "Charge realization requires a complete unsaturated pre-readout accumulated-charge result."
    );
  }

  const policies =
    additionalPolicyMap(
      profile,
      charge
    );
  const pattern =
    input.fixedPatternNoise === undefined
      ? null
      : fixedPatternAtSite(
          parseSensorFixedPatternNoiseProfile(
            input.fixedPatternNoise
          ),
          charge
            .colorSamplingProfileId,
          charge.site
        );
  const photoGain =
    pattern === null
      ? 1
      : pattern
          .photoResponseGainFactor;
  const darkFactor =
    pattern === null
      ? 1
      : pattern.darkCurrentFactor;
  const photoMean =
    pattern === null
      ? charge
          .photoExpectedElectronCount
      : charge
          .photoExpectedElectronCount *
        photoGain;
  const darkMean =
    pattern === null
      ? charge
          .darkExpectedElectronCount
      : charge
          .darkExpectedElectronCount *
        darkFactor;
  const random =
    createRandom(seed);
  const photoRealized =
    samplePoisson(
      photoMean,
      random
    );
  const darkRealized =
    samplePoisson(
      darkMean,
      random
    );

  const additionalComponents =
    charge.additionalComponents.map(
      (component) => {
        const policy =
          policies.get(
            component.componentId
          )!;
        const realized =
          policy.model ===
          "poisson"
            ? samplePoisson(
                component
                  .expectedElectronCount,
                random
              )
            : component
                .expectedElectronCount;
        return {
          componentId:
            component.componentId,
          expectedElectronCount:
            component
              .expectedElectronCount,
          realizedElectronEquivalentCount:
            realized,
          model:
            policy.model
        };
      }
    );

  const additionalRealized =
    additionalComponents.reduce(
      (sum, component) =>
        sum +
        component
          .realizedElectronEquivalentCount,
      0
    );
  const totalRealized =
    photoRealized +
    darkRealized +
    additionalRealized;

  if (
    !Number.isFinite(
      totalRealized
    ) ||
    totalRealized < 0
  ) {
    throw new InvalidScientificInputError(
      "Realized stored charge must remain finite and nonnegative."
    );
  }

  return approximationResult(
    {
      samplingProfileId:
        profile.profileId,
      completenessProfileId:
        charge
          .completenessProfileId,
      colorSamplingProfileId:
        charge
          .colorSamplingProfileId,
      channelId:
        charge.channelId,
      site: {
        ...charge.site
      },
      bindingId:
        charge.bindingId,
      seedUint32:
        seed,
      photoExpectedElectronCount:
        charge
          .photoExpectedElectronCount,
      photoRealizedElectronCount:
        photoRealized,
      darkExpectedElectronCount:
        charge
          .darkExpectedElectronCount,
      darkRealizedElectronCount:
        darkRealized,
      fixedPatternNoiseProfileId:
        pattern === null
          ? null
          : pattern.profileId,
      photoResponseGainFactor:
        photoGain,
      darkCurrentFactor:
        darkFactor,
      hotPixel:
        pattern?.hotPixel ?? false,
      photoSampledMeanElectronCount:
        photoMean,
      darkSampledMeanElectronCount:
        darkMean,
      additionalComponents,
      totalExpectedStoredElectronCount:
        charge
          .totalExpectedStoredElectronCount,
      totalRealizedStoredElectronEquivalentCount:
        totalRealized,
      photoShotNoiseApplied:
        true,
      darkShotNoiseApplied:
        true,
      electronicReadNoiseApplied:
        false,
      physicalSaturationApplied:
        false,
      bloomingModeled: false,
      conversionGainApplied:
        false,
      adcQuantizationApplied:
        false,
      rawCodeValueProduced:
        false,
      stochasticModel:
        "independent-poisson-photo-dark-explicit-additional-policy",
      deterministicSeededRealization:
        true
    },
    "sensor-charge-stochastic-realization",
    "3.0.0",
    [
      "An optional explicit fixed-pattern profile multiplies the photo Poisson mean by the site's PRNU gain and the dark Poisson mean by its DSNU/hot-pixel factor; without one the uniform population expectation is sampled. Fixed-pattern values are deterministic per sensor instance and colour-sampling site.",
      "Poisson means of 1e9 electrons and above use a continuity-corrected normal approximation.",
      "Photo-generated and dark-generated electron counts are sampled independently from Poisson distributions using an explicit deterministic seed.",
      "Each additional stored-charge component uses its explicitly declared Poisson or deterministic electron-equivalent policy; Photivra does not infer defect/leakage statistics from the component name.",
      "This is a pre-saturation, pre-electronic-read-noise charge realization and remains separate from expectation-value calculations.",
      "The seeded PRNG is a deterministic simulation mechanism and is not cryptographically secure; its seed is scrambled by the MurmurHash3 fmix32 finalizer so nearby seeds give unrelated streams."
    ]
  );
}

function fixedPatternAtSite(
  profile:
    SensorFixedPatternNoiseProfile,
  colorSamplingProfileId: string,
  site: { x: number; y: number }
): SensorFixedPatternSiteValues {
  if (
    profile.colorSamplingProfileId !==
    colorSamplingProfileId
  ) {
    throw new InvalidScientificInputError(
      "Fixed-pattern noise profile colour-sampling identity must match the charge."
    );
  }
  return evaluateParsedFixedPatternSite(
    profile,
    site
  );
}

function fixedPatternForRealization(
  value:
    SensorFixedPatternNoiseProfile | undefined,
  charge:
    SensorChargeRealization
): SensorFixedPatternSiteValues | null {
  if (value === undefined) {
    if (
      charge.fixedPatternNoiseProfileId !==
        null &&
      charge.fixedPatternNoiseProfileId !==
        undefined
    ) {
      throw new InvalidScientificInputError(
        "A charge realization with a fixed pattern requires the same fixed-pattern profile at readout."
      );
    }
    return null;
  }
  const profile =
    parseSensorFixedPatternNoiseProfile(
      value
    );
  if (
    charge.fixedPatternNoiseProfileId !==
    profile.profileId
  ) {
    throw new InvalidScientificInputError(
      "Readout fixed-pattern profile must be the profile used for the charge realization."
    );
  }
  return fixedPatternAtSite(
    profile,
    charge.colorSamplingProfileId,
    charge.site
  );
}

function validateCapacityAgainstRealization(
  charge:
    SensorChargeRealization,
  capacity:
    SensorPhysicalChargeCapacityAssessment,
  readout:
    ResolvedSensorReadoutRegime
): void {
  if (
    charge.completenessProfileId !==
      capacity
        .completenessProfileId ||
    charge.colorSamplingProfileId !==
      capacity
        .colorSamplingProfileId ||
    charge.channelId !==
      capacity.channelId ||
    charge.site.x !==
      capacity.site.x ||
    charge.site.y !==
      capacity.site.y ||
    charge.bindingId !==
      capacity.bindingId
  ) {
    throw new InvalidScientificInputError(
      "Physical capacity assessment identity must match the charge realization."
    );
  }
  if (
    charge
      .totalExpectedStoredElectronCount !==
    capacity
      .totalExpectedStoredElectronCount
  ) {
    throw new InvalidScientificInputError(
      "Physical capacity assessment must be computed for the charge behind the realization; its total expected stored electrons differ."
    );
  }
  if (
    readout
      .colorSamplingProfileId !==
      charge.colorSamplingProfileId ||
    readout.channelId !==
      charge.channelId
  ) {
    throw new InvalidScientificInputError(
      "Sensor readout profile color/channel identity must match the charge realization."
    );
  }
}

/**
 * Maps the expected charge through the declared gain, offset and readout limits, with no random
 * sampling. Each kind of clipping (physical storage, pre-ADC, digital) is reported separately.
 * @param input - The input; see `CalculateExpectedSensorReadoutInput` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function calculateExpectedSensorReadout(
  input:
    CalculateExpectedSensorReadoutInput
): CalculationResult<SensorExpectedReadoutSignal> {
  requireInputKeys(input, "calculateExpectedSensorReadout", ["accumulatedCharge", "physicalCapacityAssessment", "readoutProfile", "regimeId"]);
  const readout =
    resolveSensorReadoutRegime({
      profile:
        input.readoutProfile,
      regimeId:
        input.regimeId
    });
  const expectedStoredChargeBelowOrAtPhysicalCapacity =
    validateChargeIdentity(
      input.accumulatedCharge,
      input
        .physicalCapacityAssessment,
      readout
    );

  const expected =
    input.accumulatedCharge
      .totalExpectedStoredElectronCount;
  const threshold =
    readout.regime
      .preAdcSaturationElectronEquivalent
      .value;
  const afterPreAdc =
    Math.min(
      expected,
      threshold
    );
  const codeSignal =
    afterPreAdc /
    readout.regime
      .systemConversionGainElectronsPerCode
      .value;
  const inlOffset =
    integralNonLinearityOffset(
      readout.regime.adc
        .integralNonLinearity,
      codeSignal +
        readout.regime
          .adc.blackLevelCode
    );
  const codeBeforeQuantization =
    codeSignal +
    readout.regime
      .adc.blackLevelCode +
    inlOffset;
  const digitalGain =
    readout.regime.adc
      .digitalGain ?? 1;
  const codeAfterDigitalGain =
    readout.regime.adc
      .digitalGain === undefined
      ? codeBeforeQuantization
      : (Math.min(
          codeBeforeQuantization,
          readout.adcMaximumCode
        ) -
          readout.regime.adc
            .blackLevelCode) *
          digitalGain +
        readout.regime.adc
          .blackLevelCode;

  return approximationResult(
    {
      readoutProfileId:
        readout.profileId,
      regimeId:
        readout.regime
          .regimeId,
      completenessProfileId:
        input.accumulatedCharge
          .completenessProfileId,
      capacityProfileId:
        input
          .physicalCapacityAssessment
          .capacityProfileId,
      colorSamplingProfileId:
        input.accumulatedCharge
          .colorSamplingProfileId,
      channelId:
        input.accumulatedCharge
          .channelId,
      site: {
        ...input
          .accumulatedCharge
          .site
      },
      bindingId:
        input.accumulatedCharge
          .bindingId,
      expectedStoredElectronCount:
        expected,
      expectedStoredChargeBelowOrAtPhysicalCapacity,
      expectedElectronEquivalentAfterPreAdcSaturation:
        afterPreAdc,
      preAdcSaturationAppliedToExpectation:
        afterPreAdc < expected,
      systemConversionGainElectronsPerCode:
        readout.regime
          .systemConversionGainElectronsPerCode
          .value,
      expectedCodeBeforeBlackOffset:
        codeSignal,
      blackLevelCode:
        readout.regime
          .adc.blackLevelCode,
      expectedCodeBeforeQuantization:
        codeBeforeQuantization,
      adcIntegralNonLinearityOffsetCodes:
        inlOffset,
      digitalGain,
      expectedCodeAfterDigitalGain:
        codeAfterDigitalGain,
      adcBitDepth:
        readout.regime
          .adc.bitDepth,
      adcMaximumCode:
        readout.adcMaximumCode,
      digitalSaturationCode:
        readout.regime
          .adc
          .digitalSaturationCode,
      expectedDigitalSaturation:
        codeAfterDigitalGain >=
        readout.regime
          .adc
          .digitalSaturationCode,
      electronicReadNoiseMeanElectrons:
        0,
      electronicReadNoiseRmsElectrons:
        readout
          .combinedReadNoiseRmsElectrons,
      electronicReadNoiseSampled:
        false,
      adcQuantizationApplied:
        false,
      rawCodeValueProduced:
        false,
      isoUsedToInferRegime:
        false
    },
    "sensor-expected-electronic-readout",
    "2.0.0",
    [
      "Expected readout uses complete expected stored charge only after the upstream physical-capacity assessment confirms the expectation is not above physical capacity.",
      "Electronic read-noise mean is zero and is not sampled in this expectation result.",
      "The explicitly selected conversion regime is not inferred from ISO, sensor technology family or marketing mode names; an ISO signal chain may bind an exposure index to a declared regime.",
      "Declared ADC integral non-linearity and post-ADC digital gain are applied to the continuous expectation without quantization.",
      "Pre-ADC electron-equivalent saturation, black offset and ADC/digital saturation remain separate domains.",
      "ADC quantization is not applied to the expectation value."
    ]
  );
}

/**
 * Nearest integer, with ties going towards +infinity. Math.round is exact for every double. (In
 * contrast, floor(x + 0.5) returns 1 for 0.49999999999999994, because the addition rounds up.)
 * Adding 0 turns -0 into +0.
 */
function roundHalfUp(
  value: number
): number {
  return Math.round(value) + 0;
}

function integralNonLinearityOffset(
  inl:
    SensorAdcIntegralNonLinearity | undefined,
  code: number
): number {
  if (inl === undefined) {
    return 0;
  }
  const knots = inl.knots;
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  if (code <= first.code) {
    return first.offsetCodes;
  }
  if (code >= last.code) {
    return last.offsetCodes;
  }
  let low = 0;
  let high = knots.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (knots[middle]!.code <= code) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const a = knots[low]!;
  const b = knots[high]!;
  return (
    a.offsetCodes +
    ((code - a.code) /
      (b.code - a.code)) *
      (b.offsetCodes - a.offsetCodes)
  );
}

/**
 * Shared ADC transfer function: continuous input code (signal/gain + black + INL), rounded half up
 * and limited to the ADC code range, then optional post-ADC digital gain about black, rounded again.
 * The caller applies the final clamp to [0, digitalSaturationCode]. Exported internally for the lean
 * native executor; not exported from the package.
 */
export function adcTransfer(
  regime:
    SensorReadoutConversionRegime,
  adcMaximumCode: number,
  electronEquivalent: number
): {
  codeBeforeQuantization: number;
  inlOffset: number;
  adcCode: number;
  digitalGain: number;
  quantized: number;
} {
  const ideal =
    electronEquivalent /
      regime
        .systemConversionGainElectronsPerCode
        .value +
    regime.adc.blackLevelCode;
  const inlOffset =
    integralNonLinearityOffset(
      regime.adc.integralNonLinearity,
      ideal
    );
  const codeBeforeQuantization =
    ideal + inlOffset;
  const quantizedAdc =
    roundHalfUp(
      codeBeforeQuantization
    );
  const digitalGain =
    regime.adc.digitalGain ?? 1;
  if (
    regime.adc.digitalGain ===
    undefined
  ) {
    return {
      codeBeforeQuantization,
      inlOffset,
      adcCode:
        quantizedAdc,
      digitalGain,
      quantized:
        quantizedAdc
    };
  }
  const adcCode =
    Math.max(
      0,
      Math.min(
        quantizedAdc,
        adcMaximumCode
      )
    );
  return {
    codeBeforeQuantization,
    inlOffset,
    adcCode,
    digitalGain,
    quantized:
      roundHalfUp(
        (adcCode -
          regime.adc
            .blackLevelCode) *
          digitalGain +
          regime.adc
            .blackLevelCode
      )
  };
}

/**
 * Simulates one RAW code from a charge realization with the declared seed and regime: steps 3–7 of
 * the readout order (see the module notes). Signed read noise is kept through the black pedestal and
 * quantization, and only the final code is clamped. Returns the bounded native ADC code and per-step
 * diagnostics.
 * @param input - The input; see `SimulateSensorRawCodeInput` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function simulateSensorRawCode(
  input:
    SimulateSensorRawCodeInput
): CalculationResult<SensorRawCodeSample> {
  requireInputKeys(input, "simulateSensorRawCode", ["chargeRealization", "physicalCapacityAssessment", "readoutProfile", "regimeId", "readNoiseSeedUint32", "fixedPatternNoise"]);
  const readout =
    resolveSensorReadoutRegime({
      profile:
        input.readoutProfile,
      regimeId:
        input.regimeId
    });
  validateCapacityAgainstRealization(
    input.chargeRealization,
    input
      .physicalCapacityAssessment,
    readout
  );
  const readNoiseSeed =
    requireUint32(
      input.readNoiseSeedUint32,
      "readNoiseSeedUint32"
    );
  const random =
    createRandom(
      readNoiseSeed
    );

  const realized =
    input.chargeRealization
      .totalRealizedStoredElectronEquivalentCount;
  if (
    !Number.isFinite(realized) ||
    realized < 0
  ) {
    throw new InvalidScientificInputError(
      "Charge realization total must be finite and nonnegative."
    );
  }

  const physicalCapacity =
    input
      .physicalCapacityAssessment
      .physicalChargeCapacityElectrons;
  const afterPhysical =
    Math.min(
      realized,
      physicalCapacity
    );
  const physicalSaturation =
    afterPhysical < realized;
  const overflow =
    Math.max(
      0,
      realized -
        physicalCapacity
    );

  const readNoiseComponents =
    readout.regime
      .readNoiseComponents.map(
        (component) => {
          const sampled =
            component
              .rmsElectrons.value ===
            0
              ? 0
              : sampleStandardNormal(
                  random
                ) *
                component
                  .rmsElectrons.value;
          return {
            componentId:
              component
                .componentId,
            rmsElectrons:
              component
                .rmsElectrons
                .value,
            sampledElectrons:
              sampled
          };
        }
      );
  const totalReadNoise =
    readNoiseComponents.reduce(
      (sum, component) =>
        sum +
        component
          .sampledElectrons,
      0
    );
  const pattern =
    fixedPatternForRealization(
      input.fixedPatternNoise,
      input.chargeRealization
    );
  const fixedPatternOffset =
    pattern === null
      ? 0
      : pattern
          .readoutOffsetElectrons;

  const afterReadNoise =
    afterPhysical +
    totalReadNoise +
    fixedPatternOffset;
  const preAdcThreshold =
    readout.regime
      .preAdcSaturationElectronEquivalent
      .value;
  // Stored charge is nonnegative, but the electronic signal after it is signed.
  // Keep negative read noise until the black pedestal and the unsigned ADC limit.
  const afterPreAdc =
    Math.min(
      afterReadNoise,
      preAdcThreshold
    );
  const preAdcSaturation =
    afterReadNoise >
    preAdcThreshold;

  const transfer =
    adcTransfer(
      readout.regime,
      readout.adcMaximumCode,
      afterPreAdc
    );
  const codeBeforeQuantization =
    transfer.codeBeforeQuantization;
  const quantized =
    transfer.quantized;
  const rawCode =
    Math.max(
      0,
      Math.min(
        quantized,
        readout.regime
          .adc
          .digitalSaturationCode
      )
    );

  return approximationResult(
    {
      readoutProfileId:
        readout.profileId,
      regimeId:
        readout.regime
          .regimeId,
      samplingProfileId:
        input.chargeRealization
          .samplingProfileId,
      completenessProfileId:
        input.chargeRealization
          .completenessProfileId,
      capacityProfileId:
        input
          .physicalCapacityAssessment
          .capacityProfileId,
      colorSamplingProfileId:
        input.chargeRealization
          .colorSamplingProfileId,
      channelId:
        input.chargeRealization
          .channelId,
      site: {
        ...input
          .chargeRealization.site
      },
      bindingId:
        input.chargeRealization
          .bindingId,
      chargeSeedUint32:
        input.chargeRealization
          .seedUint32,
      readNoiseSeedUint32:
        readNoiseSeed,
      realizedStoredElectronEquivalentCountBeforePhysicalCapacity:
        realized,
      physicalChargeCapacityElectrons:
        physicalCapacity,
      electronEquivalentAfterPhysicalScalarSaturation:
        afterPhysical,
      physicalScalarSaturationApplied:
        physicalSaturation,
      overflowElectronEquivalentDiagnostic:
        overflow,
      bloomingModeled: false,
      electronicReadNoiseComponents:
        readNoiseComponents,
      totalElectronicReadNoiseElectrons:
        totalReadNoise,
      fixedPatternNoiseProfileId:
        pattern === null
          ? null
          : pattern.profileId,
      fixedPatternReadoutOffsetElectrons:
        fixedPatternOffset,
      electronEquivalentAfterReadNoise:
        afterReadNoise,
      preAdcSaturationElectronEquivalent:
        preAdcThreshold,
      electronEquivalentAfterPreAdcSaturation:
        afterPreAdc,
      preAdcSaturationApplied:
        preAdcSaturation,
      systemConversionGainElectronsPerCode:
        readout.regime
          .systemConversionGainElectronsPerCode
          .value,
      blackLevelCode:
        readout.regime
          .adc.blackLevelCode,
      codeBeforeQuantization,
      adcIntegralNonLinearityOffsetCodes:
        transfer.inlOffset,
      adcCodeBeforeDigitalGain:
        transfer.adcCode,
      digitalGain:
        transfer.digitalGain,
      quantizedCodeBeforeDigitalClamp:
        quantized,
      adcBitDepth:
        readout.regime
          .adc.bitDepth,
      adcMaximumCode:
        readout.adcMaximumCode,
      digitalSaturationCode:
        readout.regime
          .adc
          .digitalSaturationCode,
      rawCode,
      digitalSaturationApplied:
        quantized >=
        readout.regime
          .adc
          .digitalSaturationCode,
      lowerCodeClampApplied:
        quantized < 0,
      adcTransfer:
        "uniform-round-half-up",
      physicalSaturationApplied:
        physicalSaturation,
      electronicReadNoiseApplied:
        readNoiseComponents
          .some(
            (component) =>
              component
                .rmsElectrons >
              0
          ),
      conversionGainApplied:
        true,
      adcQuantizationApplied:
        true,
      rawCodeValueProduced:
        true,
      isoUsedToInferRegime:
        false,
      deterministicSeededRealization:
        true
    },
    "sensor-raw-code-stochastic-readout",
    "4.0.0",
    [
      "A stochastic stored-charge realization is scalar-clamped at the explicit physical storage capacity; this is a bounded saturation approximation and does not model blooming, neighbor transport or anti-blooming behavior.",
      "Independent input-referred Gaussian electronic read-noise components, plus any declared static fixed-pattern row/column offsets, are added after physical charge saturation and before the explicit pre-ADC electron-equivalent saturation threshold.",
      "System conversion gain is expressed in electrons per digital-number code unit for the explicitly selected regime; an ISO-dependent gain exists only where an explicit ISO signal chain binds the setting to a declared regime.",
      "Signed electronic read noise survives the upper-only pre-ADC saturation threshold. Black level and any declared ADC integral non-linearity are added before uniform round-half-up quantization (exact ties toward +infinity); an optional post-ADC digital gain about black is re-quantized; codes are then clamped to zero/digital saturation and valid below-black codes are retained.",
      "Physical storage capacity, pre-ADC saturation and digital/ADC saturation remain separate thresholds.",
      "The charge seed and read-noise seed are separate deterministic simulation identities; neither is cryptographically secure."
    ]
  );
}
