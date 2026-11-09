// SPDX-License-Identifier: Apache-2.0

/**
 * White balance (WB): generic presets, manual gains, colour temperature and tint, custom (grey-card)
 * WB, auto white balance (AWB), WB lock, and parsing of a committed WB state.
 *
 * The profile defines preset gains and AWB correction strength. A label such as "Daylight" is not
 * treated as a universal Kelvin value or as any manufacturer's behaviour.
 * @see docs/CAPTURE_COLOR.md for the equations, units, coordinate conventions, known blockers and
 * support limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceBackedFact,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputObject, requireInputKeys, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireTrimmedConfigString as requireScientificNonEmptyString, requireConfigFinite as requireFinite, requireConfigNonNegativeSafeInteger as requireNonNegativeSafeInteger, parseConfigLimitations as parseLimitations, requireConfigFiniteAboveZero as requirePositiveFinite } from "../core/record-validation.js";
import {
  calculateChromaticityFromCorrelatedColorTemperature,
  calculatePortableChromaticityFromCorrelatedColorTemperature,
  type PlanckianLocusModel,
  type WhiteLocus
} from "./illuminants.js";
import {
  multiplyMatrixVector,
  parseMatrix3x3,
  xyzOfChromaticity,
  type CieXyChromaticity,
  type ColorMatrix3x3
} from "./colorimetry-math.js";

export const WHITE_BALANCE_PROFILE_SCHEMA_VERSION = "0.1.0" as const;
export const WHITE_BALANCE_STATE_VERSION = "0.1.0" as const;
export const COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION =
  "0.1.0" as const;

export type WhiteBalanceInputDomain =
  "relative-pre-wb-camera-linear-rgb";

export interface WhiteBalanceChannelGains {
  red: number;
  green: number;
  blue: number;
}

export type WhiteBalanceAwbIntent =
  | "neutral-priority"
  | "standard"
  | "ambience-preserving";

export interface WhiteBalancePresetDefinition {
  presetId: string;
  label: string;
  channelGains: EvidenceBackedFact<WhiteBalanceChannelGains>;
  nominalColorTemperatureKelvin?: number;
  nominalTint?: number;
  limitations?: readonly string[];
}

export interface WhiteBalanceAwbPolicy {
  policyId: string;
  intent: WhiteBalanceAwbIntent;
  /**
   * How much of a grey-world neutralizing correction to apply, measured in
   * logarithmic gain space. 1 applies the full correction (neutral priority).
   * Lower values keep more of the observed colour cast.
   */
  correctionStrength: EvidenceBackedFact<number>;
  limitations?: readonly string[];
}

export interface WhiteBalanceProfile {
  schemaVersion: typeof WHITE_BALANCE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  inputDomain: WhiteBalanceInputDomain;
  presets: readonly WhiteBalancePresetDefinition[];
  awbPolicies: readonly WhiteBalanceAwbPolicy[];
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface PreWhiteBalanceRgbSample {
  sampleId: string;
  red: number;
  green: number;
  blue: number;
  weight: number;
  clipped: boolean;
}

export interface PreWhiteBalanceRgbSampleSet {
  imageStateId: string;
  inputDomain: WhiteBalanceInputDomain;
  samples: readonly PreWhiteBalanceRgbSample[];
}

export interface ResolvedWhiteBalanceState {
  version: typeof WHITE_BALANCE_STATE_VERSION;
  stateId: string;
  inputDomain: WhiteBalanceInputDomain;
  source:
    | "preset"
    | "manual-gains"
    | "custom-measurement"
    | "auto-white-balance"
    | "color-temperature";
  channelGains: WhiteBalanceChannelGains;
  locked: boolean;
  sourceProfile?: {
    profileId: string;
    profileVersion: string;
  };
  presetId?: string;
  awbPolicy?: {
    policyId: string;
    intent: WhiteBalanceAwbIntent;
    correctionStrength: number;
  };
  measurement?: {
    imageStateId: string;
    usableSampleCount: number;
    rejectedClippedSampleCount: number;
    weightedMeanPreWbSignal: {
      red: number;
      green: number;
      blue: number;
    };
  };
  /** Present for `color-temperature` states: the declared CCT/tint and its camera neutral. */
  colorTemperature?: ResolvedColorTemperatureWhiteBalance;
  sourceStateId?: string;
  trueIlluminantMetadataUsed: false;
  sceneIlluminationModified: false;
  rawCaptureDestructivelyModified: false;
  physicalExposureModified: false;
  focusModified: false;
  limitations: readonly string[];
}

export interface ColorTemperatureWhiteBalanceIntent {
  version: typeof COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION;
  intentId: string;
  colorTemperatureKelvin: number;
  tint: number;
  channelGainsResolved: false;
  requiresCameraProfileColorimetry: true;
  sceneIlluminationModified: false;
}

/** Locus/tint interpretation and camera neutral behind a Kelvin + tint WB state. */
export interface ResolvedColorTemperatureWhiteBalance {
  intentId: string;
  colorTemperatureKelvin: number;
  tint: number;
  whiteLocus: WhiteLocus;
  tintInterpretation: "duv-cie-1960-uv";
  planckianLocusModel: "planck-analytic-cmf" | "planck-integration";
  /** CIE 1931 xy of the declared white (CCT + Duv). */
  adoptedWhiteChromaticity: CieXyChromaticity;
  /** Pre-WB camera response to that white (XYZ with Y = 1 through xyzToCameraRgb). */
  cameraNeutralRgb: WhiteBalanceChannelGains;
}

/** Camera colour model used to turn a declared white into channel gains. */
export interface ColorTemperatureWhiteBalanceCameraModel {
  profileId: string;
  profileVersion: string;
  /** Row-major CIE XYZ (white Y = 1) → relative pre-WB camera-linear RGB. */
  xyzToCameraRgb: ColorMatrix3x3;
}

export interface ResolveColorTemperatureWhiteBalanceInput {
  stateId: string;
  intent: ColorTemperatureWhiteBalanceIntent;
  /** Locus whose temperature defines the white: Planckian or CIE daylight. */
  whiteLocus: WhiteLocus;
  /** Tint is read as Duv in the CIE 1960 UCS (positive = above the Planckian locus, greenish). */
  tintInterpretation: "duv-cie-1960-uv";
  /** Defaults to Planck's law integrated against the engine's analytic CIE 1931 CMFs (`planck-analytic-cmf`). */
  planckianLocus?: PlanckianLocusModel;
  camera: ColorTemperatureWhiteBalanceCameraModel;
}

export interface ResolvePresetWhiteBalanceInput {
  stateId: string;
  profile: WhiteBalanceProfile;
  presetId: string;
}

export interface ResolveManualWhiteBalanceInput {
  stateId: string;
  channelGains: WhiteBalanceChannelGains;
}

export interface CreateColorTemperatureWhiteBalanceIntentInput {
  intentId: string;
  colorTemperatureKelvin: number;
  tint: number;
}

export interface ResolveCustomWhiteBalanceInput {
  stateId: string;
  sampleSet: PreWhiteBalanceRgbSampleSet;
}

export interface EstimateAutoWhiteBalanceInput {
  stateId: string;
  profile: WhiteBalanceProfile;
  policyId: string;
  sampleSet: PreWhiteBalanceRgbSampleSet;
}

export interface CreateLockedWhiteBalanceStateInput {
  stateId: string;
  sourceState: ResolvedWhiteBalanceState;
}

export function requireFraction(value: unknown, path: string): number {
  const parsed = requireFinite(value, path);
  if (parsed < 0 || parsed > 1) {
    throw new InvalidConfigurationError(
      path + " must be from zero through one."
    );
  }
  return parsed;
}

function parseChannelGains(
  value: unknown,
  path: string
): WhiteBalanceChannelGains {
  const record = requireRecord(value, path, ["red", "green", "blue"]);
  return {
    red: requirePositiveFinite(record.red, path + ".red"),
    green: requirePositiveFinite(record.green, path + ".green"),
    blue: requirePositiveFinite(record.blue, path + ".blue")
  };
}

function parseOptionalLimitations(
  value: unknown,
  path: string
): readonly string[] | undefined {
  return value === undefined ? undefined : parseLimitations(value, path);
}

function parsePreset(
  value: unknown,
  path: string
): WhiteBalancePresetDefinition {
  const record = requireRecord(value, path, ["channelGains", "limitations", "presetId", "label", "nominalColorTemperatureKelvin", "nominalTint"]);
  const gainsFact = requireRecord(record.channelGains, path + ".channelGains", ["value", "evidence"]);
  const limitations = parseOptionalLimitations(
    record.limitations,
    path + ".limitations"
  );

  return {
    presetId: requireNonEmptyString(record.presetId, path + ".presetId"),
    label: requireNonEmptyString(record.label, path + ".label"),
    channelGains: {
      value: parseChannelGains(
        gainsFact.value,
        path + ".channelGains.value"
      ),
      evidence: parseEvidenceList(
        gainsFact.evidence,
        path + ".channelGains.evidence"
      )
    },
    ...(record.nominalColorTemperatureKelvin === undefined
      ? {}
      : {
          nominalColorTemperatureKelvin: requirePositiveFinite(
            record.nominalColorTemperatureKelvin,
            path + ".nominalColorTemperatureKelvin"
          )
        }),
    ...(record.nominalTint === undefined
      ? {}
      : {
          nominalTint: requireFinite(
            record.nominalTint,
            path + ".nominalTint"
          )
        }),
    ...(limitations === undefined
      ? {}
      : {
          limitations
        })
  };
}

function parseAwbIntent(
  value: unknown,
  path: string
): WhiteBalanceAwbIntent {
  if (
    value !== "neutral-priority" &&
    value !== "standard" &&
    value !== "ambience-preserving"
  ) {
    throw new InvalidConfigurationError(path + " is invalid.");
  }
  return value;
}

function parseAwbPolicy(
  value: unknown,
  path: string
): WhiteBalanceAwbPolicy {
  const record = requireRecord(value, path, ["correctionStrength", "limitations", "policyId", "intent"]);
  const strengthFact = requireRecord(
    record.correctionStrength,
    path + ".correctionStrength", ["value", "evidence"]
  );
  const limitations = parseOptionalLimitations(
    record.limitations,
    path + ".limitations"
  );

  return {
    policyId: requireNonEmptyString(record.policyId, path + ".policyId"),
    intent: parseAwbIntent(record.intent, path + ".intent"),
    correctionStrength: {
      value: requireFraction(
        strengthFact.value,
        path + ".correctionStrength.value"
      ),
      evidence: parseEvidenceList(
        strengthFact.evidence,
        path + ".correctionStrength.evidence"
      )
    },
    ...(limitations === undefined ? {} : { limitations })
  };
}

/**
 * Parses generic WB presets and AWB policies.
 *
 * The profile defines preset gains and AWB correction strength. A label is not
 * treated as a universal Kelvin value or as any manufacturer's behaviour.
 */
export function parseWhiteBalanceProfile(
  value: unknown
): WhiteBalanceProfile {
  const record = requireRecord(value, "whiteBalanceProfile", ["schemaVersion", "scientificStatus", "inputDomain", "presets", "awbPolicies", "profileId", "profileVersion", "evidence", "limitations"]);

  if (record.schemaVersion !== WHITE_BALANCE_PROFILE_SCHEMA_VERSION) {
    throw new InvalidConfigurationError(
      'whiteBalanceProfile.schemaVersion must be "' +
        WHITE_BALANCE_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (record.scientificStatus !== "approximation") {
    throw new InvalidConfigurationError(
      'whiteBalanceProfile.scientificStatus must be "approximation".'
    );
  }
  if (record.inputDomain !== "relative-pre-wb-camera-linear-rgb") {
    throw new InvalidConfigurationError(
      'whiteBalanceProfile.inputDomain must be "relative-pre-wb-camera-linear-rgb".'
    );
  }
  if (!Array.isArray(record.presets)) {
    throw new InvalidConfigurationError(
      "whiteBalanceProfile.presets must be an array."
    );
  }
  if (!Array.isArray(record.awbPolicies) || record.awbPolicies.length === 0) {
    throw new InvalidConfigurationError(
      "whiteBalanceProfile.awbPolicies must be a non-empty array."
    );
  }

  const presets = record.presets.map((entry, index) =>
    parsePreset(entry, "whiteBalanceProfile.presets[" + index + "]")
  );
  const policies = record.awbPolicies.map((entry, index) =>
    parseAwbPolicy(entry, "whiteBalanceProfile.awbPolicies[" + index + "]")
  );

  const presetIds = presets.map((entry) => entry.presetId);
  const policyIds = policies.map((entry) => entry.policyId);
  if (new Set(presetIds).size !== presetIds.length) {
    throw new InvalidConfigurationError(
      "whiteBalanceProfile.presets must not contain duplicate presetId values."
    );
  }
  if (new Set(policyIds).size !== policyIds.length) {
    throw new InvalidConfigurationError(
      "whiteBalanceProfile.awbPolicies must not contain duplicate policyId values."
    );
  }

  return {
    schemaVersion: WHITE_BALANCE_PROFILE_SCHEMA_VERSION,
    profileId: requireNonEmptyString(
      record.profileId,
      "whiteBalanceProfile.profileId"
    ),
    profileVersion: requireNonEmptyString(
      record.profileVersion,
      "whiteBalanceProfile.profileVersion"
    ),
    scientificStatus: "approximation",
    inputDomain: "relative-pre-wb-camera-linear-rgb",
    presets,
    awbPolicies: policies,
    evidence: parseEvidenceList(record.evidence, "whiteBalanceProfile.evidence"),
    limitations: parseLimitations(
      record.limitations,
      "whiteBalanceProfile.limitations"
    )
  };
}

export function requireScientificFinite(
  value: number,
  path: string
): number {
  if (!Number.isFinite(value)) {
    throw new InvalidScientificInputError(path + " must be finite.");
  }
  return value;
}

function requireScientificPositiveFinite(
  value: number,
  path: string
): number {
  const parsed = requireScientificFinite(value, path);
  if (parsed <= 0) {
    throw new InvalidScientificInputError(
      path + " must be greater than zero."
    );
  }
  return parsed;
}

function requireScientificNonNegativeFinite(
  value: number,
  path: string
): number {
  const parsed = requireScientificFinite(value, path);
  if (parsed < 0) {
    throw new InvalidScientificInputError(
      path + " must be greater than or equal to zero."
    );
  }
  return parsed;
}

function validateResolvedGains(
  gains: WhiteBalanceChannelGains,
  path: string
): WhiteBalanceChannelGains {
  return {
    red: requireScientificPositiveFinite(gains.red, path + ".red"),
    green: requireScientificPositiveFinite(gains.green, path + ".green"),
    blue: requireScientificPositiveFinite(gains.blue, path + ".blue")
  };
}

function immutableState(
  state: ResolvedWhiteBalanceState
): ResolvedWhiteBalanceState {
  return Object.freeze({
    ...state,
    channelGains: Object.freeze({ ...state.channelGains }),
    limitations: Object.freeze([...state.limitations]),
    ...(state.sourceProfile === undefined
      ? {}
      : { sourceProfile: Object.freeze({ ...state.sourceProfile }) }),
    ...(state.awbPolicy === undefined
      ? {}
      : { awbPolicy: Object.freeze({ ...state.awbPolicy }) }),
    ...(state.colorTemperature === undefined
      ? {}
      : {
          colorTemperature: Object.freeze({
            ...state.colorTemperature,
            adoptedWhiteChromaticity: Object.freeze({ ...state.colorTemperature.adoptedWhiteChromaticity }),
            cameraNeutralRgb: Object.freeze({ ...state.colorTemperature.cameraNeutralRgb })
          })
        }),
    ...(state.measurement === undefined
      ? {}
      : {
          measurement: Object.freeze({
            ...state.measurement,
            weightedMeanPreWbSignal: Object.freeze({
              ...state.measurement.weightedMeanPreWbSignal
            })
          })
        })
  });
}

function stateBase(
  stateId: string,
  source: ResolvedWhiteBalanceState["source"],
  gains: WhiteBalanceChannelGains,
  limitations: readonly string[]
): Pick<
  ResolvedWhiteBalanceState,
  | "version"
  | "stateId"
  | "inputDomain"
  | "source"
  | "channelGains"
  | "locked"
  | "trueIlluminantMetadataUsed"
  | "sceneIlluminationModified"
  | "rawCaptureDestructivelyModified"
  | "physicalExposureModified"
  | "focusModified"
  | "limitations"
> {
  return {
    version: WHITE_BALANCE_STATE_VERSION,
    stateId: requireScientificNonEmptyString(stateId, "stateId"),
    inputDomain: "relative-pre-wb-camera-linear-rgb",
    source,
    channelGains: validateResolvedGains(gains, "channelGains"),
    locked: false,
    trueIlluminantMetadataUsed: false,
    sceneIlluminationModified: false,
    rawCaptureDestructivelyModified: false,
    physicalExposureModified: false,
    focusModified: false,
    limitations: [...limitations]
  };
}

/** Resolves a WB preset defined by the profile. No universal label-to-Kelvin rule is applied. */
export function resolvePresetWhiteBalance(
  input: ResolvePresetWhiteBalanceInput
): ResolvedWhiteBalanceState {
  requireInputKeys(input, "resolvePresetWhiteBalance", ["stateId", "profile", "presetId"]);
  const profile = parseWhiteBalanceProfile(input.profile);
  const presetId = requireScientificNonEmptyString(
    input.presetId,
    "presetId"
  );
  const preset = profile.presets.find((entry) => entry.presetId === presetId);
  if (preset === undefined) {
    throw new InvalidScientificInputError(
      "presetId is not declared by the selected white-balance profile."
    );
  }

  return immutableState({
    ...stateBase(
      input.stateId,
      "preset",
      preset.channelGains.value,
      [
        ...profile.limitations,
        ...(preset.limitations ?? [])
      ]
    ),
    sourceProfile: {
      profileId: profile.profileId,
      profileVersion: profile.profileVersion
    },
    presetId
  });
}

/** Resolves explicit manual camera-linear channel gains. */
export function resolveManualWhiteBalance(
  input: ResolveManualWhiteBalanceInput
): ResolvedWhiteBalanceState {
  requireInputKeys(input, "resolveManualWhiteBalance", ["stateId", "channelGains"]);
  return immutableState(
    stateBase(
      input.stateId,
      "manual-gains",
      input.channelGains,
      [
        "Manual gains are caller-selected WB intent, not a measured physical illuminant."
      ]
    )
  );
}

/**
 * Records independent color-temperature and tint intent.
 *
 * No channel gains are fabricated here; use
 * `resolveColorTemperatureWhiteBalance()` with an explicit camera colour model to
 * resolve gains.
 */
export function createColorTemperatureWhiteBalanceIntent(
  input: CreateColorTemperatureWhiteBalanceIntentInput
): ColorTemperatureWhiteBalanceIntent {
  requireInputKeys(input, "createColorTemperatureWhiteBalanceIntent", ["intentId", "colorTemperatureKelvin", "tint"]);
  return Object.freeze({
    version: COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION,
    intentId: requireScientificNonEmptyString(input.intentId, "intentId"),
    colorTemperatureKelvin: requireScientificPositiveFinite(
      input.colorTemperatureKelvin,
      "colorTemperatureKelvin"
    ),
    tint: requireScientificFinite(input.tint, "tint"),
    channelGainsResolved: false,
    requiresCameraProfileColorimetry: true,
    sceneIlluminationModified: false
  });
}

/**
 * Resolves a Kelvin + tint WB intent into camera channel gains, for an explicit camera
 * colour model:
 * - white xy = locus(CCT), offset by Duv = tint along the Planckian-locus normal in CIE 1960 uv;
 * - camera neutral n = M_XYZ→camera · XYZ(white, Y = 1);
 * - gains = (n_G/n_R, 1, n_G/n_B).
 * A neutral surface lit by light of exactly that chromaticity then renders with equal channels.
 * The CCT and tint are the white the photographer declares, not a measured scene illuminant.
 * Accuracy is limited by the camera matrix (exact only under the Luther–Ives condition) and by
 * the locus model.
 */
export function resolveColorTemperatureWhiteBalance(
  input: ResolveColorTemperatureWhiteBalanceInput
): ResolvedWhiteBalanceState {
  return colorTemperatureWhiteBalance(input, calculateChromaticityFromCorrelatedColorTemperature);
}
/**
 * Internal (not exported from the package): {@link resolveColorTemperatureWhiteBalance} with the white point from
 * `calculatePortableChromaticityFromCorrelatedColorTemperature`, so the gains have the same bits in every JavaScript
 * engine. The display view uses it for a Kelvin white balance; captures keep {@link resolveColorTemperatureWhiteBalance}.
 */
export function resolvePortableColorTemperatureWhiteBalance(input: ResolveColorTemperatureWhiteBalanceInput): ResolvedWhiteBalanceState {
  return colorTemperatureWhiteBalance(input, calculatePortableChromaticityFromCorrelatedColorTemperature);
}
// The white point is computed by the function passed in (the portable one only from resolvePortableColorTemperatureWhiteBalance), so
// a bundle that never resolves the portable white balance does not contain the portable functions.
function colorTemperatureWhiteBalance(input: ResolveColorTemperatureWhiteBalanceInput,
  chromaticityFromCct: typeof calculateChromaticityFromCorrelatedColorTemperature): ResolvedWhiteBalanceState {
  requireInputKeys(input, "resolveColorTemperatureWhiteBalance", ["stateId", "intent", "whiteLocus", "tintInterpretation", "planckianLocus", "camera"]);
  const intent = input.intent;
  if (
    typeof intent !== "object" ||
    intent === null ||
    intent.version !== COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION
  ) {
    throw new InvalidConfigurationError(
      "intent must be a color-temperature WB intent of version " +
        COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION +
        "."
    );
  }
  const intentId = requireScientificNonEmptyString(intent.intentId, "intent.intentId");
  const kelvin = requireScientificPositiveFinite(intent.colorTemperatureKelvin, "intent.colorTemperatureKelvin");
  const tint = requireScientificFinite(intent.tint, "intent.tint");
  if (input.tintInterpretation !== "duv-cie-1960-uv") {
    throw new InvalidConfigurationError('tintInterpretation must be "duv-cie-1960-uv".');
  }
  const camera = input.camera;
  if (typeof camera !== "object" || camera === null) {
    throw new InvalidConfigurationError("camera must be an object.");
  }
  const profileId = requireScientificNonEmptyString(camera.profileId, "camera.profileId");
  const profileVersion = requireScientificNonEmptyString(camera.profileVersion, "camera.profileVersion");
  const matrix = parseMatrix3x3(camera.xyzToCameraRgb, "camera.xyzToCameraRgb");
  const locus: PlanckianLocusModel = input.planckianLocus ?? { kind: "planck-analytic-cmf" };
  const white = chromaticityFromCct({
    correlatedColorTemperatureKelvin: kelvin,
    duv: tint,
    whiteLocus: input.whiteLocus,
    locus
  }).value;
  const xyz = xyzOfChromaticity(white);
  const [red, green, blue] = multiplyMatrixVector(matrix, [xyz.x, xyz.y, xyz.z]);
  if (!(red > 0) || !(green > 0) || !(blue > 0)) {
    throw new InvalidScientificInputError(
      "The camera response to the declared white must be positive in every channel."
    );
  }
  return immutableState({
    ...stateBase(
      input.stateId,
      "color-temperature",
      { red: green / red, green: 1, blue: green / blue },
      [
        "Kelvin/tint gains neutralize the declared white through the supplied camera matrix; they do not identify the scene illuminant.",
        "Tint is Duv in CIE 1960 uv; accuracy is bounded by the camera matrix and the locus model."
      ]
    ),
    sourceProfile: { profileId, profileVersion },
    colorTemperature: {
      intentId,
      colorTemperatureKelvin: kelvin,
      tint,
      whiteLocus: input.whiteLocus,
      tintInterpretation: "duv-cie-1960-uv",
      planckianLocusModel: locus.kind,
      adoptedWhiteChromaticity: { x: white.x, y: white.y },
      cameraNeutralRgb: { red, green, blue }
    }
  });
}

function reduceSampleSet(
  sampleSet: PreWhiteBalanceRgbSampleSet,
  clippedPolicy: "reject-any" | "exclude"
): {
  imageStateId: string;
  usableSampleCount: number;
  rejectedClippedSampleCount: number;
  weightedMean: {
    red: number;
    green: number;
    blue: number;
  };
} {
  requireInputObject(sampleSet, "sampleSet input");
  if (sampleSet.inputDomain !== "relative-pre-wb-camera-linear-rgb") {
    throw new InvalidConfigurationError(
      'sampleSet.inputDomain must be "relative-pre-wb-camera-linear-rgb".'
    );
  }
  const imageStateId = requireScientificNonEmptyString(
    sampleSet.imageStateId,
    "sampleSet.imageStateId"
  );
  if (!Array.isArray(sampleSet.samples) || sampleSet.samples.length === 0) {
    throw new InvalidConfigurationError(
      "sampleSet.samples must be a non-empty array."
    );
  }

  let weightSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let rejectedClippedSampleCount = 0;
  const ids = new Set<string>();

  sampleSet.samples.forEach((sample, index) => {
    const path = "sampleSet.samples[" + index + "]";
    const sampleId = requireScientificNonEmptyString(
      sample.sampleId,
      path + ".sampleId"
    );
    if (ids.has(sampleId)) {
      throw new InvalidScientificInputError(
        "sampleSet.samples must not contain duplicate sampleId values."
      );
    }
    ids.add(sampleId);

    const red = requireScientificNonNegativeFinite(sample.red, path + ".red");
    const green = requireScientificNonNegativeFinite(
      sample.green,
      path + ".green"
    );
    const blue = requireScientificNonNegativeFinite(
      sample.blue,
      path + ".blue"
    );
    const weight = requireScientificPositiveFinite(
      sample.weight,
      path + ".weight"
    );

    if (sample.clipped) {
      rejectedClippedSampleCount += 1;
      if (clippedPolicy === "reject-any") {
        throw new InvalidScientificInputError(
          "Custom white-balance measurement must not contain clipped samples."
        );
      }
      return;
    }

    weightSum += weight;
    redSum += red * weight;
    greenSum += green * weight;
    blueSum += blue * weight;
  });

  if (weightSum <= 0) {
    throw new InvalidScientificInputError(
      "White-balance estimation requires at least one usable unclipped sample."
    );
  }

  const weightedMean = {
    red: redSum / weightSum,
    green: greenSum / weightSum,
    blue: blueSum / weightSum
  };

  if (
    weightedMean.red <= 0 ||
    weightedMean.green <= 0 ||
    weightedMean.blue <= 0
  ) {
    throw new InvalidScientificInputError(
      "White-balance estimation requires positive signal in every camera-linear channel."
    );
  }

  return {
    imageStateId,
    usableSampleCount:
      sampleSet.samples.length - rejectedClippedSampleCount,
    rejectedClippedSampleCount,
    weightedMean
  };
}

function neutralizingGains(
  mean: {
    red: number;
    green: number;
    blue: number;
  }
): WhiteBalanceChannelGains {
  return {
    red: mean.green / mean.red,
    green: 1,
    blue: mean.green / mean.blue
  };
}

/**
 * Resolves a user-declared neutral/gray custom-WB measurement.
 *
 * The engine validates and reduces the selected pre-WB sample, but it does not
 * claim the selected object is spectrally neutral in the real scene.
 */
export function resolveCustomWhiteBalance(
  input: ResolveCustomWhiteBalanceInput
): ResolvedWhiteBalanceState {
  requireInputKeys(input, "resolveCustomWhiteBalance", ["stateId", "sampleSet"]);
  const reduced = reduceSampleSet(input.sampleSet, "reject-any");

  return immutableState({
    ...stateBase(
      input.stateId,
      "custom-measurement",
      neutralizingGains(reduced.weightedMean),
      [
        "Custom WB assumes the caller-selected measurement target is intended to be neutral.",
        "Resolved gains are camera-linear relative corrections, not a recovered physical illuminant spectrum."
      ]
    ),
    measurement: {
      imageStateId: reduced.imageStateId,
      usableSampleCount: reduced.usableSampleCount,
      rejectedClippedSampleCount: reduced.rejectedClippedSampleCount,
      weightedMeanPreWbSignal: reduced.weightedMean
    }
  });
}

/**
 * Estimates one global AWB state from declared pre-WB camera-linear samples.
 *
 * It deliberately does not accept metadata about the true illuminant. A
 * grey-world neutralizing estimate is softened by the profile's
 * correctionStrength, so different generic AWB priorities can keep different
 * amounts of colour cast.
 */
export function estimateAutoWhiteBalance(
  input: EstimateAutoWhiteBalanceInput
): ResolvedWhiteBalanceState {
  requireInputKeys(input, "estimateAutoWhiteBalance", ["stateId", "profile", "policyId", "sampleSet"]);
  const profile = parseWhiteBalanceProfile(input.profile);
  const policyId = requireScientificNonEmptyString(
    input.policyId,
    "policyId"
  );
  const policy = profile.awbPolicies.find(
    (entry) => entry.policyId === policyId
  );
  if (policy === undefined) {
    throw new InvalidScientificInputError(
      "policyId is not declared by the selected white-balance profile."
    );
  }

  const reduced = reduceSampleSet(input.sampleSet, "exclude");
  const neutral = neutralizingGains(reduced.weightedMean);
  const strength = policy.correctionStrength.value;
  const gains = {
    red: Math.pow(neutral.red, strength),
    green: 1,
    blue: Math.pow(neutral.blue, strength)
  };

  return immutableState({
    ...stateBase(
      input.stateId,
      "auto-white-balance",
      gains,
      [
        ...profile.limitations,
        ...(policy.limitations ?? []),
        "AWB is a deterministic gray-world-style global estimate over camera-observable pre-WB signal.",
        "One global WB may leave local color casts under mixed illumination."
      ]
    ),
    sourceProfile: {
      profileId: profile.profileId,
      profileVersion: profile.profileVersion
    },
    awbPolicy: {
      policyId: policy.policyId,
      intent: policy.intent,
      correctionStrength: strength
    },
    measurement: {
      imageStateId: reduced.imageStateId,
      usableSampleCount: reduced.usableSampleCount,
      rejectedClippedSampleCount: reduced.rejectedClippedSampleCount,
      weightedMeanPreWbSignal: reduced.weightedMean
    }
  });
}

/**
 * Freezes a resolved WB state under a new stable identity.
 *
 * Locking changes neither the scene nor the gains. Later AWB estimates may
 * differ, but this locked state stays the same.
 */
export function createLockedWhiteBalanceState(
  input: CreateLockedWhiteBalanceStateInput
): ResolvedWhiteBalanceState {
  requireInputKeys(input, "createLockedWhiteBalanceState", ["stateId", "sourceState"]);
  const stateId = requireScientificNonEmptyString(input.stateId, "stateId");
  const source = input.sourceState;

  return immutableState({
    ...source,
    stateId,
    channelGains: validateResolvedGains(
      source.channelGains,
      "sourceState.channelGains"
    ),
    locked: true,
    sourceStateId: requireScientificNonEmptyString(
      source.stateId,
      "sourceState.stateId"
    ),
    limitations: [...source.limitations]
  });
}

function requirePositiveSafeInteger(
  value: unknown,
  path: string
): number {
  const parsed =
    requireNonNegativeSafeInteger(
      value,
      path
    );
  if (parsed <= 0) {
    throw new InvalidConfigurationError(
      path + " must be greater than zero."
    );
  }
  return parsed;
}

function parseResolvedWhiteBalanceMeasurement(
  value: unknown,
  path: string
): NonNullable<
  ResolvedWhiteBalanceState["measurement"]
> {
  const record =
    requireRecord(value, path, ["weightedMeanPreWbSignal", "imageStateId", "usableSampleCount", "rejectedClippedSampleCount"]);
  const mean =
    requireRecord(
      record.weightedMeanPreWbSignal,
      path +
        ".weightedMeanPreWbSignal", ["red", "green", "blue"]
    );

  return {
    imageStateId:
      requireNonEmptyString(
        record.imageStateId,
        path + ".imageStateId"
      ),
    usableSampleCount:
      requirePositiveSafeInteger(
        record.usableSampleCount,
        path +
          ".usableSampleCount"
      ),
    rejectedClippedSampleCount:
      requireNonNegativeSafeInteger(
        record
          .rejectedClippedSampleCount,
        path +
          ".rejectedClippedSampleCount"
      ),
    weightedMeanPreWbSignal: {
      red:
        requirePositiveFinite(
          mean.red,
          path +
            ".weightedMeanPreWbSignal.red"
        ),
      green:
        requirePositiveFinite(
          mean.green,
          path +
            ".weightedMeanPreWbSignal.green"
        ),
      blue:
        requirePositiveFinite(
          mean.blue,
          path +
            ".weightedMeanPreWbSignal.blue"
        )
    }
  };
}

function parseResolvedColorTemperature(
  value: unknown,
  path: string
): ResolvedColorTemperatureWhiteBalance {
  const record = requireRecord(value, path, ["whiteLocus", "tintInterpretation", "planckianLocusModel", "adoptedWhiteChromaticity", "intentId", "colorTemperatureKelvin", "tint", "cameraNeutralRgb"]);
  if (record.whiteLocus !== "planckian" && record.whiteLocus !== "cie-daylight") {
    throw new InvalidConfigurationError(path + ".whiteLocus is invalid.");
  }
  if (record.tintInterpretation !== "duv-cie-1960-uv") {
    throw new InvalidConfigurationError(path + ".tintInterpretation is invalid.");
  }
  if (
    record.planckianLocusModel !== "planck-analytic-cmf" &&
    record.planckianLocusModel !== "planck-integration"
  ) {
    throw new InvalidConfigurationError(path + ".planckianLocusModel is invalid.");
  }
  const white = requireRecord(record.adoptedWhiteChromaticity, path + ".adoptedWhiteChromaticity", ["x", "y"]);
  return {
    intentId: requireNonEmptyString(record.intentId, path + ".intentId"),
    colorTemperatureKelvin: requirePositiveFinite(record.colorTemperatureKelvin, path + ".colorTemperatureKelvin"),
    tint: requireFinite(record.tint, path + ".tint"),
    whiteLocus: record.whiteLocus,
    tintInterpretation: "duv-cie-1960-uv",
    planckianLocusModel: record.planckianLocusModel,
    adoptedWhiteChromaticity: {
      x: requirePositiveFinite(white.x, path + ".adoptedWhiteChromaticity.x"),
      y: requirePositiveFinite(white.y, path + ".adoptedWhiteChromaticity.y")
    },
    cameraNeutralRgb: parseChannelGains(record.cameraNeutralRgb, path + ".cameraNeutralRgb")
  };
}

/**
 * Parses a committed, resolved white-balance state from untrusted JSON,
 * without estimating WB again.
 *
 * This is deliberately a state parser, not an AWB estimator. It keeps the
 * resolved gains, policy and measurement identity that a capture committed
 * earlier.
 */
export function parseResolvedWhiteBalanceState(
  value: unknown
): ResolvedWhiteBalanceState {
  const record =
    requireRecord(
      value,
      "resolvedWhiteBalanceState", ["version", "inputDomain", "source", "locked", "sourceProfile", "awbPolicy", "measurement", "colorTemperature", "presetId", "sourceStateId", "stateId", "channelGains", "limitations", "trueIlluminantMetadataUsed", "sceneIlluminationModified", "rawCaptureDestructivelyModified", "physicalExposureModified", "focusModified"]
    );

  if (
    record.version !==
    WHITE_BALANCE_STATE_VERSION
  ) {
    throw new InvalidConfigurationError(
      'resolvedWhiteBalanceState.version must be "' +
        WHITE_BALANCE_STATE_VERSION +
        '".'
    );
  }
  if (
    record.inputDomain !==
    "relative-pre-wb-camera-linear-rgb"
  ) {
    throw new InvalidConfigurationError(
      'resolvedWhiteBalanceState.inputDomain must be "relative-pre-wb-camera-linear-rgb".'
    );
  }
  if (
    record.source !== "preset" &&
    record.source !==
      "manual-gains" &&
    record.source !==
      "custom-measurement" &&
    record.source !==
      "auto-white-balance" &&
    record.source !==
      "color-temperature"
  ) {
    throw new InvalidConfigurationError(
      "resolvedWhiteBalanceState.source is invalid."
    );
  }
  if (
    typeof record.locked !==
    "boolean"
  ) {
    throw new InvalidConfigurationError(
      "resolvedWhiteBalanceState.locked must be boolean."
    );
  }

  for (const key of [
    "trueIlluminantMetadataUsed",
    "sceneIlluminationModified",
    "rawCaptureDestructivelyModified",
    "physicalExposureModified",
    "focusModified"
  ] as const) {
    if (record[key] !== false) {
      throw new InvalidConfigurationError(
        "resolvedWhiteBalanceState." +
          key +
          " must remain false."
      );
    }
  }

  const sourceProfile =
    record.sourceProfile === undefined
      ? undefined
      : ((): NonNullable<ResolvedWhiteBalanceState["sourceProfile"]> => {
          const profile =
            requireRecord(
              record.sourceProfile,
              "resolvedWhiteBalanceState.sourceProfile", ["profileId", "profileVersion"]
            );
          return {
            profileId:
              requireNonEmptyString(
                profile.profileId,
                "resolvedWhiteBalanceState.sourceProfile.profileId"
              ),
            profileVersion:
              requireNonEmptyString(
                profile.profileVersion,
                "resolvedWhiteBalanceState.sourceProfile.profileVersion"
              )
          };
        })();

  const awbPolicy =
    record.awbPolicy === undefined
      ? undefined
      : ((): NonNullable<ResolvedWhiteBalanceState["awbPolicy"]> => {
          const policy =
            requireRecord(
              record.awbPolicy,
              "resolvedWhiteBalanceState.awbPolicy", ["policyId", "intent", "correctionStrength"]
            );
          return {
            policyId:
              requireNonEmptyString(
                policy.policyId,
                "resolvedWhiteBalanceState.awbPolicy.policyId"
              ),
            intent:
              parseAwbIntent(
                policy.intent,
                "resolvedWhiteBalanceState.awbPolicy.intent"
              ),
            correctionStrength:
              requireFraction(
                policy.correctionStrength,
                "resolvedWhiteBalanceState.awbPolicy.correctionStrength"
              )
          };
        })();

  const measurement =
    record.measurement === undefined
      ? undefined
      : parseResolvedWhiteBalanceMeasurement(
          record.measurement,
          "resolvedWhiteBalanceState.measurement"
        );

  const colorTemperature =
    record.colorTemperature === undefined
      ? undefined
      : parseResolvedColorTemperature(
          record.colorTemperature,
          "resolvedWhiteBalanceState.colorTemperature"
        );

  const presetId =
    record.presetId === undefined
      ? undefined
      : requireNonEmptyString(
          record.presetId,
          "resolvedWhiteBalanceState.presetId"
        );

  const sourceStateId =
    record.sourceStateId ===
    undefined
      ? undefined
      : requireNonEmptyString(
          record.sourceStateId,
          "resolvedWhiteBalanceState.sourceStateId"
        );

  if (
    record.source === "preset" &&
    (sourceProfile === undefined ||
      presetId === undefined)
  ) {
    throw new InvalidConfigurationError(
      "A preset WB state requires sourceProfile and presetId."
    );
  }

  if (
    record.source ===
      "custom-measurement" &&
    measurement === undefined
  ) {
    throw new InvalidConfigurationError(
      "A custom-measurement WB state requires measurement identity."
    );
  }

  if (
    record.source ===
      "auto-white-balance" &&
    (sourceProfile === undefined ||
      awbPolicy === undefined ||
      measurement === undefined)
  ) {
    throw new InvalidConfigurationError(
      "An auto-white-balance state requires sourceProfile, awbPolicy, and measurement identity."
    );
  }

  if (
    (record.source === "color-temperature") !==
      (colorTemperature !== undefined) ||
    (record.source === "color-temperature" &&
      sourceProfile === undefined)
  ) {
    throw new InvalidConfigurationError(
      "A color-temperature WB state requires sourceProfile and colorTemperature; other sources must not declare colorTemperature."
    );
  }

  if (
    record.locked &&
    sourceStateId === undefined
  ) {
    throw new InvalidConfigurationError(
      "A locked WB state requires sourceStateId."
    );
  }

  if (
    !record.locked &&
    sourceStateId !== undefined
  ) {
    throw new InvalidConfigurationError(
      "An unlocked WB state must not declare sourceStateId."
    );
  }

  return immutableState({
    version:
      WHITE_BALANCE_STATE_VERSION,
    stateId:
      requireNonEmptyString(
        record.stateId,
        "resolvedWhiteBalanceState.stateId"
      ),
    inputDomain:
      "relative-pre-wb-camera-linear-rgb",
    source: record.source,
    channelGains:
      parseChannelGains(
        record.channelGains,
        "resolvedWhiteBalanceState.channelGains"
      ),
    locked: record.locked,
    ...(sourceProfile === undefined
      ? {}
      : {
          sourceProfile
        }),
    ...(presetId === undefined
      ? {}
      : {
          presetId
        }),
    ...(awbPolicy === undefined
      ? {}
      : {
          awbPolicy
        }),
    ...(measurement === undefined
      ? {}
      : {
          measurement
        }),
    ...(colorTemperature === undefined
      ? {}
      : {
          colorTemperature
        }),
    ...(sourceStateId === undefined
      ? {}
      : {
          sourceStateId
        }),
    trueIlluminantMetadataUsed:
      false,
    sceneIlluminationModified:
      false,
    rawCaptureDestructivelyModified:
      false,
    physicalExposureModified:
      false,
    focusModified: false,
    limitations:
      parseLimitations(
        record.limitations,
        "resolvedWhiteBalanceState.limitations"
      )
  });
}
