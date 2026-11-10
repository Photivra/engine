// SPDX-License-Identifier: Apache-2.0

/**
 * Generic image stabilization: profiles, disturbance trajectories, the stabilized rotation and its
 * effect on capture timing samples.
 *
 * The parsers validate untrusted input and return the normalized typed contract. Unknown enum values,
 * missing required fields and incompatible scientific data are rejected.
 *
 * The generic stabilizer takes a declared angular disturbance (camera shake) and applies a per-axis
 * response, latency, travel limits and a panning policy. The leftover (residual) motion feeds the
 * existing temporal mapping. No commercial IBIS (in-body) or OIS (optical) calibration is supplied,
 * no arbitrary "stops" rating is used, and body/lens coordination is never inferred.
 * @see docs/STABILIZATION.md for the equations, units, coordinate conventions, known blockers and
 * support limits.
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
import {
  InvalidScientificInputError,
  requirePositiveInteger
} from "../core/validation.js";
import type {
  RasterPoint
} from "../output/capture-geometry.js";
import type {
  ResolvedCaptureModeTiming
} from "../sensor/capture-mode-timing.js";
import { requireInputKeys, requireInputObject, rejectUnknownVariantFields, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigFinite as requireFinite, parseConfigLimitations as parseLimitations, requireConfigFiniteAtLeastZero as requireNonNegativeFinite, requireConfigUnitInterval as requireFraction } from "../core/record-validation.js";
import { parseNonNegativeFact, parsePositiveFact } from "../sensor/raw-readout.js";

/** The scope flags every stabilization profile declares false, in this order (shared with the generic tier assets). */
export const STABILIZATION_UNMODELED_SCOPE = /* @__PURE__ */ Object.freeze({ controlTransientModeled: false as const, spontaneousDriftModeled: false as const,
  cameraTranslationCorrectionModeled: false as const, digitalStabilizationIncluded: false as const, supportPolicyIncluded: false as const,
  stopRatingUsedAsDynamicResponse: false as const });

export const STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;
export const STABILIZATION_DISTURBANCE_TRAJECTORY_VERSION =
  "0.1.0" as const;

export type StabilizationRotationAxis =
  | "pitch"
  | "yaw"
  | "roll";

export type PhysicalStabilizationArchitecture =
  | "off"
  | "sensor-shift"
  | "lens-optical"
  | "coordinated-physical";

export type StabilizationCaptureKind =
  | "still"
  | "video";

export interface StabilizationAngularStateRad {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface StabilizationDisturbanceSample {
  timeSecondsFromCaptureReference:
    number;
  angularDisplacementRad:
    StabilizationAngularStateRad;
}

export interface StabilizationDisturbanceTrajectory {
  version:
    typeof STABILIZATION_DISTURBANCE_TRAJECTORY_VERSION;
  trajectoryId: string;
  timeReference:
    "first-opening-boundary-phase";
  samples:
    readonly StabilizationDisturbanceSample[];
  initialAngularDisplacementIsZero:
    true;
  cameraTranslationIncluded:
    false;
  subjectMotionIncluded:
    false;
  supportStateEncoded:
    false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface StabilizationAxisResponseProfile {
  axis: StabilizationRotationAxis;
  correctionGain:
    EvidenceBackedFact<number>;
  latencySeconds:
    EvidenceBackedFact<number>;
  maximumCorrectionAngleRad:
    EvidenceBackedFact<number>;
}

export type StabilizationPanningPolicy =
  | {
      kind: "none";
    }
  | {
      kind:
        "declared-axis-bypass";
      axis:
        StabilizationRotationAxis;
      evidence:
        readonly EvidenceProvenance[];
    };

export interface StabilizationCoordinatedAllocation {
  bodyFraction: number;
  lensFraction: number;
  evidence: readonly EvidenceProvenance[];
  totalCorrectionAppliedOnce:
    true;
}

export interface StabilizationSystemProfile {
  schemaVersion:
    typeof STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  profileKind:
    "generic-synthetic";
  scientificStatus:
    "approximation";
  architecture:
    PhysicalStabilizationArchitecture;
  captureKind:
    StabilizationCaptureKind;
  axisResponses:
    readonly StabilizationAxisResponseProfile[];
  panningPolicy:
    StabilizationPanningPolicy;
  coordinatedAllocation?:
    StabilizationCoordinatedAllocation;
  controlTransientModeled: false;
  spontaneousDriftModeled: false;
  cameraTranslationCorrectionModeled:
    false;
  digitalStabilizationIncluded:
    false;
  supportPolicyIncluded: false;
  stopRatingUsedAsDynamicResponse:
    false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface CalculateStabilizedRotationTrajectoryInput {
  disturbance:
    StabilizationDisturbanceTrajectory;
  profile:
    StabilizationSystemProfile;
  captureKind:
    StabilizationCaptureKind;
}

export interface StabilizationAxisResolution {
  axis: StabilizationRotationAxis;
  disturbanceAngleRad: number;
  delayedMeasuredAngleRad: number;
  requestedCorrectionAngleRad:
    number;
  appliedCorrectionAngleRad:
    number;
  residualAngleRad: number;
  correctionGain: number;
  latencySeconds: number;
  maximumCorrectionAngleRad:
    number;
  bypassedForDeclaredPan:
    boolean;
  correctionLimitReached:
    boolean;
}

export interface StabilizedRotationSample {
  timeSecondsFromCaptureReference:
    number;
  disturbanceAngularDisplacementRad:
    StabilizationAngularStateRad;
  appliedCorrectionAngularDisplacementRad:
    StabilizationAngularStateRad;
  residualAngularDisplacementRad:
    StabilizationAngularStateRad;
  axes:
    readonly StabilizationAxisResolution[];
}

export interface StabilizedRotationTrajectory {
  profileId: string;
  profileVersion: string;
  trajectoryId: string;
  architecture:
    PhysicalStabilizationArchitecture;
  captureKind:
    StabilizationCaptureKind;
  timeReference:
    "first-opening-boundary-phase";
  samples:
    readonly StabilizedRotationSample[];
  correctionModel:
    "delayed-linear-image-equivalent-angular-response";
  supportStateConsumed: false;
  translationCorrectionModeled:
    false;
  digitalStabilizationApplied:
    false;
  digitalStabilizationOwnedBy:
    "downstream-geometric-correction-composition";
  coordinatedCorrectionDoubleCounted:
    false;
  zeroDisturbanceCanCreateMotion:
    false;
}

export interface CalculateStabilizedCaptureTemporalSamplesInput {
  disturbance:
    StabilizationDisturbanceTrajectory;
  profile:
    StabilizationSystemProfile;
  captureKind:
    StabilizationCaptureKind;
  timing:
    ResolvedCaptureModeTiming;
  samplePointsNative:
    readonly RasterPoint[];
  temporalSampleCount: number;
}

export interface StabilizedCaptureTemporalNode {
  temporalSampleIndex: number;
  localExposurePhase: number;
  captureTimeSecondsFromReference:
    number;
  normalizedTimeWeight: number;
  timeMeasureSeconds: number;
  stabilization:
    StabilizedRotationSample;
}

export interface StabilizedCaptureTemporalPoint {
  destinationPointNative:
    RasterPoint;
  localExposureWindow: {
    startSecondsFromCaptureReference:
      number;
    endSecondsFromCaptureReference:
      number;
    durationSeconds: number;
  };
  nodes:
    readonly StabilizedCaptureTemporalNode[];
}

export interface StabilizedCaptureTemporalSamples {
  profileId: string;
  trajectoryId: string;
  captureModeId: string;
  timingProfileId: string;
  captureKind:
    StabilizationCaptureKind;
  architecture:
    PhysicalStabilizationArchitecture;
  timeReference:
    "first-opening-boundary-phase";
  quadratureScheme:
    "uniform-midpoint";
  temporalSampleCount: number;
  points:
    readonly StabilizedCaptureTemporalPoint[];
  sensorReadoutTimingUsedAsExposureTiming:
    false;
  supportStateConsumed: false;
  translationCorrectionModeled:
    false;
  digitalStabilizationApplied:
    false;
}

const AXES =
  new Set<StabilizationRotationAxis>([
    "pitch",
    "yaw",
    "roll"
  ]);

const ARCHITECTURES =
  new Set<PhysicalStabilizationArchitecture>([
    "off",
    "sensor-shift",
    "lens-optical",
    "coordinated-physical"
  ]);

const CAPTURE_KINDS =
  new Set<StabilizationCaptureKind>([
    "still",
    "video"
  ]);

function parseFractionFact(
  value: unknown,
  path: string
): EvidenceBackedFact<number> {
  const record =
    requireRecord(value, path, ["value", "evidence"]);
  return {
    value:
      requireFraction(
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

function parseAxis(
  value: unknown,
  path: string
): StabilizationRotationAxis {
  if (
    typeof value !== "string" ||
    !AXES.has(
      value as
        StabilizationRotationAxis
    )
  ) {
    throw new InvalidConfigurationError(
      path + " is invalid."
    );
  }
  return value as
    StabilizationRotationAxis;
}

function parseAxisResponse(
  value: unknown,
  path: string
): StabilizationAxisResponseProfile {
  const record =
    requireRecord(value, path, ["axis", "correctionGain", "latencySeconds", "maximumCorrectionAngleRad"]);
  return {
    axis:
      parseAxis(
        record.axis,
        path + ".axis"
      ),
    correctionGain:
      parseFractionFact(
        record.correctionGain,
        path +
          ".correctionGain"
      ),
    latencySeconds:
      parseNonNegativeFact(
        record.latencySeconds,
        path +
          ".latencySeconds"
      ),
    maximumCorrectionAngleRad:
      parsePositiveFact(
        record
          .maximumCorrectionAngleRad,
        path +
          ".maximumCorrectionAngleRad"
      )
  };
}

function parsePanningPolicy(
  value: unknown,
  path: string
): StabilizationPanningPolicy {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", { none: ["kind"], "declared-axis-bypass": ["kind", "axis", "evidence"] }, path);
  if (record.kind === "none") {
    return {
      kind: "none"
    };
  }
  if (
    record.kind ===
    "declared-axis-bypass"
  ) {
    return {
      kind:
        "declared-axis-bypass",
      axis:
        parseAxis(
          record.axis,
          path + ".axis"
        ),
      evidence:
        parseEvidenceList(
          record.evidence,
          path + ".evidence"
        )
    };
  }
  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseCoordinatedAllocation(
  value: unknown,
  path: string
): StabilizationCoordinatedAllocation {
  const record =
    requireRecord(value, path, ["totalCorrectionAppliedOnce", "bodyFraction", "lensFraction", "evidence"]);
  if (
    record
      .totalCorrectionAppliedOnce !==
    true
  ) {
    throw new InvalidConfigurationError(
      path +
        ".totalCorrectionAppliedOnce must be true."
    );
  }
  const bodyFraction =
    requireFraction(
      record.bodyFraction,
      path + ".bodyFraction"
    );
  const lensFraction =
    requireFraction(
      record.lensFraction,
      path + ".lensFraction"
    );
  if (
    Math.abs(
      bodyFraction +
        lensFraction -
        1
    ) >
    1e-12
  ) {
    throw new InvalidConfigurationError(
      path +
        " bodyFraction + lensFraction must equal one."
    );
  }
  return {
    bodyFraction,
    lensFraction,
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      ),
    totalCorrectionAppliedOnce:
      true
  };
}

/**
 * Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
 * missing required fields and incompatible scientific data are rejected here.
 *
 * The generic stabilizer takes a declared angular disturbance (camera shake) and applies a per-axis
 * response, latency, travel limits and a panning policy. The leftover (residual) motion feeds the
 * existing temporal mapping. No commercial IBIS (in-body) or OIS (optical) calibration is supplied,
 * no arbitrary "stops" rating is used, and body/lens coordination is never inferred.
 * @param value - unknown. Untrusted input; TypeScript types alone are not validation.
 * @returns StabilizationSystemProfile. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function parseStabilizationSystemProfile(
  value: unknown
): StabilizationSystemProfile {
  const record =
    requireRecord(
      value,
      "stabilizationSystemProfile", ["schemaVersion", "profileKind", "scientificStatus", "architecture", "captureKind", "axisResponses", "panningPolicy", "coordinatedAllocation", "profileId", "profileVersion", "evidence", "limitations", "controlTransientModeled", "spontaneousDriftModeled", "cameraTranslationCorrectionModeled", "digitalStabilizationIncluded", "supportPolicyIncluded", "stopRatingUsedAsDynamicResponse"]
    );
  if (
    record.schemaVersion !==
    STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'stabilizationSystemProfile.schemaVersion must be "' +
        STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.profileKind !==
      "generic-synthetic" ||
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      'stabilizationSystemProfile schema 0.1.0 requires profileKind "generic-synthetic" and scientificStatus "approximation".'
    );
  }
  if (
    typeof record.architecture !==
      "string" ||
    !ARCHITECTURES.has(
      record.architecture as
        PhysicalStabilizationArchitecture
    )
  ) {
    throw new InvalidConfigurationError(
      "stabilizationSystemProfile.architecture is invalid."
    );
  }
  if (
    typeof record.captureKind !==
      "string" ||
    !CAPTURE_KINDS.has(
      record.captureKind as
        StabilizationCaptureKind
    )
  ) {
    throw new InvalidConfigurationError(
      "stabilizationSystemProfile.captureKind is invalid."
    );
  }

  for (
    const key of [
      "controlTransientModeled",
      "spontaneousDriftModeled",
      "cameraTranslationCorrectionModeled",
      "digitalStabilizationIncluded",
      "supportPolicyIncluded",
      "stopRatingUsedAsDynamicResponse"
    ] as const
  ) {
    if (record[key] !== false) {
      throw new InvalidConfigurationError(
        "stabilizationSystemProfile." +
          key +
          " must be false in schema 0.1.0."
      );
    }
  }

  if (
    !Array.isArray(
      record.axisResponses
    )
  ) {
    throw new InvalidConfigurationError(
      "stabilizationSystemProfile.axisResponses must be an array."
    );
  }
  const axisResponses =
    record.axisResponses.map(
      (entry, index) =>
        parseAxisResponse(
          entry,
          "stabilizationSystemProfile.axisResponses[" +
            index +
            "]"
        )
    );
  const axes =
    axisResponses.map(
      (entry) =>
        entry.axis
    );
  if (
    new Set(axes).size !==
    axes.length
  ) {
    throw new InvalidConfigurationError(
      "stabilizationSystemProfile.axisResponses must not contain duplicate axes."
    );
  }

  const architecture =
    record.architecture as
      PhysicalStabilizationArchitecture;
  if (
    architecture === "off" &&
    axisResponses.length !== 0
  ) {
    throw new InvalidConfigurationError(
      "An off stabilization profile must not declare axis responses."
    );
  }
  if (
    architecture !== "off" &&
    axisResponses.length === 0
  ) {
    throw new InvalidConfigurationError(
      "An enabled physical stabilization profile must declare at least one axis response."
    );
  }

  const panningPolicy =
    parsePanningPolicy(
      record.panningPolicy,
      "stabilizationSystemProfile.panningPolicy"
    );
  if (
    architecture === "off" &&
    panningPolicy.kind !== "none"
  ) {
    throw new InvalidConfigurationError(
      "An off stabilization profile must use panningPolicy.kind \"none\"."
    );
  }
  if (
    panningPolicy.kind ===
      "declared-axis-bypass" &&
    !axisResponses.some(
      (entry) =>
        entry.axis ===
        panningPolicy.axis
    )
  ) {
    throw new InvalidConfigurationError(
      "Declared panning bypass axis must exist in axisResponses."
    );
  }

  const coordinatedAllocation =
    record.coordinatedAllocation ===
    undefined
      ? undefined
      : parseCoordinatedAllocation(
          record.coordinatedAllocation,
          "stabilizationSystemProfile.coordinatedAllocation"
        );
  if (
    architecture ===
      "coordinated-physical" &&
    coordinatedAllocation ===
      undefined
  ) {
    throw new InvalidConfigurationError(
      "Coordinated physical stabilization requires an explicit body/lens correction allocation."
    );
  }
  if (
    architecture !==
      "coordinated-physical" &&
    coordinatedAllocation !==
      undefined
  ) {
    throw new InvalidConfigurationError(
      "Only coordinated physical stabilization may declare coordinatedAllocation."
    );
  }

  return {
    schemaVersion:
      STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "stabilizationSystemProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "stabilizationSystemProfile.profileVersion"
      ),
    profileKind:
      "generic-synthetic",
    scientificStatus:
      "approximation",
    architecture,
    captureKind:
      record.captureKind as
        StabilizationCaptureKind,
    axisResponses,
    panningPolicy,
    ...(coordinatedAllocation ===
    undefined
      ? {}
      : {
          coordinatedAllocation
        }),
    ...STABILIZATION_UNMODELED_SCOPE,
    evidence:
      parseEvidenceList(
        record.evidence,
        "stabilizationSystemProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "stabilizationSystemProfile.limitations"
      )
  };
}

function parseAngularState(
  value: unknown,
  path: string
): StabilizationAngularStateRad {
  const record =
    requireRecord(value, path, ["pitch", "yaw", "roll"]);
  return {
    pitch:
      requireFinite(
        record.pitch,
        path + ".pitch"
      ),
    yaw:
      requireFinite(
        record.yaw,
        path + ".yaw"
      ),
    roll:
      requireFinite(
        record.roll,
        path + ".roll"
      )
  };
}

/**
 * Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
 * missing required fields and incompatible scientific data are rejected here.
 *
 * The generic stabilizer takes a declared angular disturbance (camera shake) and applies a per-axis
 * response, latency, travel limits and a panning policy. The leftover (residual) motion feeds the
 * existing temporal mapping. No commercial IBIS (in-body) or OIS (optical) calibration is supplied,
 * no arbitrary "stops" rating is used, and body/lens coordination is never inferred.
 * @param value - unknown. Untrusted input; TypeScript types alone are not validation.
 * @returns StabilizationDisturbanceTrajectory. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function parseStabilizationDisturbanceTrajectory(
  value: unknown
): StabilizationDisturbanceTrajectory {
  const record =
    requireRecord(
      value,
      "stabilizationDisturbanceTrajectory", ["version", "timeReference", "initialAngularDisplacementIsZero", "cameraTranslationIncluded", "subjectMotionIncluded", "supportStateEncoded", "samples", "trajectoryId", "evidence", "limitations"]
    );
  if (
    record.version !==
      STABILIZATION_DISTURBANCE_TRAJECTORY_VERSION ||
    record.timeReference !==
      "first-opening-boundary-phase" ||
    record
      .initialAngularDisplacementIsZero !==
      true ||
    record
      .cameraTranslationIncluded !==
      false ||
    record.subjectMotionIncluded !==
      false ||
    record.supportStateEncoded !==
      false
  ) {
    throw new InvalidConfigurationError(
      "stabilizationDisturbanceTrajectory metadata is invalid for version 0.1.0."
    );
  }
  if (
    !Array.isArray(record.samples) ||
    record.samples.length < 2
  ) {
    throw new InvalidConfigurationError(
      "stabilizationDisturbanceTrajectory.samples must contain at least two samples."
    );
  }

  let previousTime =
    Number.NEGATIVE_INFINITY;
  const samples =
    record.samples.map(
      (entry, index) => {
        const path =
          "stabilizationDisturbanceTrajectory.samples[" +
          index +
          "]";
        const sample =
          requireRecord(
            entry,
            path, ["timeSecondsFromCaptureReference", "angularDisplacementRad"]
          );
        const time =
          requireNonNegativeFinite(
            sample
              .timeSecondsFromCaptureReference,
            path +
              ".timeSecondsFromCaptureReference"
          );
        if (time <= previousTime) {
          throw new InvalidConfigurationError(
            "stabilizationDisturbanceTrajectory sample times must be strictly increasing."
          );
        }
        previousTime = time;
        return {
          timeSecondsFromCaptureReference:
            time,
          angularDisplacementRad:
            parseAngularState(
              sample
                .angularDisplacementRad,
              path +
                ".angularDisplacementRad"
            )
        };
      }
    );

  const first =
    samples[0]!;
  if (
    first
      .timeSecondsFromCaptureReference !==
      0 ||
    first
      .angularDisplacementRad
      .pitch !== 0 ||
    first
      .angularDisplacementRad
      .yaw !== 0 ||
    first
      .angularDisplacementRad
      .roll !== 0
  ) {
    throw new InvalidConfigurationError(
      "stabilizationDisturbanceTrajectory must begin at capture-reference t=0 with zero angular displacement."
    );
  }

  return {
    version:
      STABILIZATION_DISTURBANCE_TRAJECTORY_VERSION,
    trajectoryId:
      requireNonEmptyString(
        record.trajectoryId,
        "stabilizationDisturbanceTrajectory.trajectoryId"
      ),
    timeReference:
      "first-opening-boundary-phase",
    samples,
    initialAngularDisplacementIsZero:
      true,
    cameraTranslationIncluded:
      false,
    subjectMotionIncluded:
      false,
    supportStateEncoded:
      false,
    evidence:
      parseEvidenceList(
        record.evidence,
        "stabilizationDisturbanceTrajectory.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "stabilizationDisturbanceTrajectory.limitations"
      )
  };
}

/**
 * Lookup index over a parsed disturbance trajectory, built for evaluation. Support times are copied
 * once into a Float64Array (exact IEEE-754 values). Each lookup is then an O(log n) binary search
 * instead of an O(n) scan. The interpolation arithmetic is unchanged.
 */
interface DisturbanceIndex {
  readonly samples:
    StabilizationDisturbanceTrajectory["samples"];
  readonly times: Float64Array;
}

function indexDisturbance(
  trajectory:
    StabilizationDisturbanceTrajectory
): DisturbanceIndex {
  const times =
    new Float64Array(
      trajectory.samples.length
    );
  for (
    let index = 0;
    index < times.length;
    index += 1
  ) {
    times[index] =
      trajectory.samples[index]!
        .timeSecondsFromCaptureReference;
  }
  return {
    samples:
      trajectory.samples,
    times
  };
}

/**
 * Returns the left index of the support segment used for `timeSeconds`. Returns -1 for the final support
 * time, which uses its stored value. The chosen segment is exactly the one a first-match linear scan
 * would pick: the smallest `i` with `t[i] <= timeSeconds <= t[i + 1]`. Support times strictly
 * increase, so a time that equals an interior support time uses the segment on its left.
 */
function locateDisturbanceSegment(
  disturbance: DisturbanceIndex,
  timeSeconds: number
): number {
  const times =
    disturbance.times;
  const lastIndex =
    times.length - 1;
  if (
    timeSeconds < times[0]! ||
    timeSeconds > times[lastIndex]!
  ) {
    throw new InvalidScientificInputError(
      "Requested stabilization evaluation time lies outside the disturbance trajectory support."
    );
  }

  if (
    timeSeconds ===
    times[lastIndex]!
  ) {
    return -1;
  }

  // Lower bound: first index whose support time is >= timeSeconds.
  let low = 0;
  let high = lastIndex;
  while (low < high) {
    const middle =
      (low + high) >>> 1;
    if (
      times[middle]! >=
      timeSeconds
    ) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  const index =
    low === 0 ? 0 : low - 1;
  if (
    !(
      timeSeconds >=
        times[index]! &&
      timeSeconds <=
        times[index + 1]!
    )
  ) {
    throw new InvalidScientificInputError(
      "Disturbance trajectory interpolation failed."
    );
  }
  return index;
}

function interpolateDisturbanceSegment(
  disturbance: DisturbanceIndex,
  segmentIndex: number,
  timeSeconds: number,
  axis:
    StabilizationRotationAxis
): number {
  const samples =
    disturbance.samples;
  if (segmentIndex < 0) {
    return samples[
      samples.length - 1
    ]!
      .angularDisplacementRad[
        axis
      ];
  }
  const left =
    samples[segmentIndex]!;
  const right =
    samples[
      segmentIndex + 1
    ]!;
  const duration =
    right
      .timeSecondsFromCaptureReference -
    left
      .timeSecondsFromCaptureReference;
  const phase =
    duration === 0
      ? 0
      : (
          timeSeconds -
          left
            .timeSecondsFromCaptureReference
        ) /
        duration;
  const a =
    left
      .angularDisplacementRad[
        axis
      ];
  const b =
    right
      .angularDisplacementRad[
        axis
      ];
  return (
    a +
    (b - a) * phase
  );
}

function interpolateAxis(
  disturbance: DisturbanceIndex,
  timeSeconds: number,
  axis:
    StabilizationRotationAxis
): number {
  return interpolateDisturbanceSegment(
    disturbance,
    locateDisturbanceSegment(
      disturbance,
      timeSeconds
    ),
    timeSeconds,
    axis
  );
}

function axisValue(
  state:
    StabilizationAngularStateRad,
  axis:
    StabilizationRotationAxis
): number {
  return state[axis];
}

function setAxisValue(
  state:
    StabilizationAngularStateRad,
  axis:
    StabilizationRotationAxis,
  value: number
): void {
  state[axis] = value;
}

function clampSymmetric(
  value: number,
  limit: number
): number {
  return Math.max(
    -limit,
    Math.min(limit, value)
  );
}

type AxisResponseIndex = ReadonlyMap<
  StabilizationRotationAxis,
  StabilizationSystemProfile["axisResponses"][number]
>;

/** Built once per calculation. Later entries win, as with a per-evaluation Map. */
function indexAxisResponses(
  profile:
    StabilizationSystemProfile
): AxisResponseIndex {
  return new Map(
    profile.axisResponses.map(
      (response) => [
        response.axis,
        response
      ] as const
    )
  );
}

function evaluateAtTime(
  disturbance: DisturbanceIndex,
  profile:
    StabilizationSystemProfile,
  responses: AxisResponseIndex,
  timeSeconds: number
): StabilizedRotationSample {
  // One segment lookup serves all three axes at the same time.
  const segment =
    locateDisturbanceSegment(
      disturbance,
      timeSeconds
    );
  const current:
    StabilizationAngularStateRad = {
      pitch:
        interpolateDisturbanceSegment(
          disturbance,
          segment,
          timeSeconds,
          "pitch"
        ),
      yaw:
        interpolateDisturbanceSegment(
          disturbance,
          segment,
          timeSeconds,
          "yaw"
        ),
      roll:
        interpolateDisturbanceSegment(
          disturbance,
          segment,
          timeSeconds,
          "roll"
        )
    };
  const correction:
    StabilizationAngularStateRad = {
      pitch: 0,
      yaw: 0,
      roll: 0
    };
  const residual:
    StabilizationAngularStateRad = {
      ...current
    };

  const axes =
    ["pitch", "yaw", "roll"] as const;
  const resolvedAxes =
    axes.map((axis) => {
      const response =
        responses.get(axis);
      const bypassed =
        profile.panningPolicy.kind ===
          "declared-axis-bypass" &&
        profile.panningPolicy.axis ===
          axis;

      if (
        profile.architecture ===
          "off" ||
        response === undefined ||
        bypassed
      ) {
        return {
          axis,
          disturbanceAngleRad:
            axisValue(
              current,
              axis
            ),
          delayedMeasuredAngleRad:
            0,
          requestedCorrectionAngleRad:
            0,
          appliedCorrectionAngleRad:
            0,
          residualAngleRad:
            axisValue(
              current,
              axis
            ),
          correctionGain:
            response?.correctionGain
              .value ?? 0,
          latencySeconds:
            response?.latencySeconds
              .value ?? 0,
          maximumCorrectionAngleRad:
            response
              ?.maximumCorrectionAngleRad
              .value ?? 0,
          bypassedForDeclaredPan:
            bypassed,
          correctionLimitReached:
            false
        };
      }

      const delayedTime =
        timeSeconds -
        response
          .latencySeconds.value;
      const delayedMeasured =
        delayedTime < 0
          ? 0
          : interpolateAxis(
              disturbance,
              delayedTime,
              axis
            );
      const requested =
        delayedMeasured *
        response
          .correctionGain.value;
      const applied =
        clampSymmetric(
          requested,
          response
            .maximumCorrectionAngleRad
            .value
        );
      const residualAngle =
        axisValue(
          current,
          axis
        ) -
        applied;

      setAxisValue(
        correction,
        axis,
        applied
      );
      setAxisValue(
        residual,
        axis,
        residualAngle
      );

      return {
        axis,
        disturbanceAngleRad:
          axisValue(
            current,
            axis
          ),
        delayedMeasuredAngleRad:
          delayedMeasured,
        requestedCorrectionAngleRad:
          requested,
        appliedCorrectionAngleRad:
          applied,
        residualAngleRad:
          residualAngle,
        correctionGain:
          response
            .correctionGain.value,
        latencySeconds:
          response
            .latencySeconds.value,
        maximumCorrectionAngleRad:
          response
            .maximumCorrectionAngleRad
            .value,
        bypassedForDeclaredPan:
          false,
        correctionLimitReached:
          applied !== requested
      };
    });

  return {
    timeSecondsFromCaptureReference:
      timeSeconds,
    disturbanceAngularDisplacementRad:
      current,
    appliedCorrectionAngularDisplacementRad:
      correction,
    residualAngularDisplacementRad:
      residual,
    axes:
      resolvedAxes
  };
}

/**
 * Runs the declared generic per-axis controller against an explicit angular disturbance trajectory.
 * Returns the residual motion, with diagnostics for latency and travel limits.
 *
 * The generic stabilizer takes a declared angular disturbance (camera shake) and applies a per-axis
 * response, latency, travel limits and a panning policy. The leftover (residual) motion feeds the
 * existing temporal mapping. No commercial IBIS (in-body) or OIS (optical) calibration is supplied,
 * no arbitrary "stops" rating is used, and body/lens coordination is never inferred.
 * @param input - CalculateStabilizedRotationTrajectoryInput. See that type for coordinates, units and profile binding.
 * @returns CalculationResult<StabilizedRotationTrajectory>. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function calculateStabilizedRotationTrajectory(
  input:
    CalculateStabilizedRotationTrajectoryInput
): CalculationResult<StabilizedRotationTrajectory> {
  requireInputKeys(input, "calculateStabilizedRotationTrajectory", ["disturbance", "profile", "captureKind"]);
  const disturbance =
    parseStabilizationDisturbanceTrajectory(
      input.disturbance
    );
  const profile =
    parseStabilizationSystemProfile(
      input.profile
    );

  if (
    input.captureKind !==
      profile.captureKind
  ) {
    throw new InvalidScientificInputError(
      "captureKind must exactly match the stabilization profile captureKind."
    );
  }

  const disturbanceIndex =
    indexDisturbance(disturbance);
  const responses =
    indexAxisResponses(profile);
  const samples =
    disturbance.samples.map(
      (sample) =>
        evaluateAtTime(
          disturbanceIndex,
          profile,
          responses,
          sample
            .timeSecondsFromCaptureReference
        )
    );

  return approximationResult(
    {
      profileId:
        profile.profileId,
      profileVersion:
        profile.profileVersion,
      trajectoryId:
        disturbance.trajectoryId,
      architecture:
        profile.architecture,
      captureKind:
        input.captureKind,
      timeReference:
        "first-opening-boundary-phase",
      samples,
      correctionModel:
        "delayed-linear-image-equivalent-angular-response",
      supportStateConsumed:
        false,
      translationCorrectionModeled:
        false,
      digitalStabilizationApplied:
        false,
      digitalStabilizationOwnedBy:
        "downstream-geometric-correction-composition",
      coordinatedCorrectionDoubleCounted:
        false,
      zeroDisturbanceCanCreateMotion:
        false
    },
    "generic-time-domain-physical-stabilization",
    "1.0.0",
    [
      "The stabilization response is a generic synthetic image-equivalent rotational correction, not a manufacturer-specific IBIS/OIS calibration.",
      "Correction uses explicit per-axis gain, latency and symmetric angular correction limits.",
      "A coordinated profile allocates one total correction between body and lens for descriptive ownership only; the total correction is applied once.",
      "Support state is not an input and never silently toggles stabilization.",
      "Declared panning bypass suppresses correction only on the explicitly selected axis; pan intent is never inferred.",
      "Camera translation/parallax correction is not modeled because translational image motion depends on scene depth.",
      "Digital stabilization is a separate downstream geometric/crop/resampling domain.",
      "CIPA-style stop ratings are not used as a dynamic response function.",
      "The legacy stabilizationStopsEquivalent approximation remains unchanged."
    ]
  );
}

type ExposureWindowSample =
  ResolvedCaptureModeTiming["exposureWindows"]["samples"][number];
type ExposureWindowIndex = ReadonlyMap<
  unknown,
  ReadonlyMap<unknown, readonly ExposureWindowSample[]>
>;

/**
 * Groups the committed exposure-window samples by native point, once per calculation, and keeps their
 * order. Map keys compare with SameValueZero, so lookups are filtered again with the original `===`
 * test: NaN never matches, and +0 matches -0.
 */
function indexExposureWindows(
  timing:
    ResolvedCaptureModeTiming
): ExposureWindowIndex {
  requireInputObject(timing, "timing");
  requireInputObject(timing.exposureWindows, "timing.exposureWindows");
  if (!Array.isArray(timing.exposureWindows.samples)) throw new InvalidConfigurationError("timing.exposureWindows.samples must be an array.");
  timing.exposureWindows.samples.forEach((sample, index) => {
    requireInputObject(sample, "timing.exposureWindows.samples[" + index + "]");
    requireInputObject(sample.pointNative, "timing.exposureWindows.samples[" + index + "].pointNative");
  });
  const byX =
    new Map<
      unknown,
      Map<unknown, ExposureWindowSample[]>
    >();
  for (const sample of timing.exposureWindows.samples) {
    let byY =
      byX.get(sample.pointNative.x);
    if (byY === undefined) {
      byY = new Map();
      byX.set(
        sample.pointNative.x,
        byY
      );
    }
    const bucket =
      byY.get(sample.pointNative.y);
    if (bucket === undefined) {
      byY.set(
        sample.pointNative.y,
        [sample]
      );
    } else {
      bucket.push(sample);
    }
  }
  return byX;
}

function localExposureForPoint(
  windows: ExposureWindowIndex,
  point:
    RasterPoint
): {
  start: number;
  end: number;
  duration: number;
} {
  const matches =
    (
      windows
        .get(point.x)
        ?.get(point.y) ?? []
    ).filter(
      (sample) =>
        sample.pointNative.x ===
          point.x &&
        sample.pointNative.y ===
          point.y
    );
  if (matches.length !== 1) {
    throw new InvalidScientificInputError(
      "Each stabilization sample point must match exactly one committed exposure-window sample point."
    );
  }
  const match =
    matches[0]!;
  return {
    start:
      match
        .startOffsetSecondsFromOpeningReference,
    end:
      match
        .endOffsetSecondsFromOpeningReference,
    duration:
      match
        .localExposureDurationSeconds
  };
}

/**
 * Feeds the residual stabilized rotation into the existing local-exposure temporal mapping. Shutter
 * timing is not changed, and no blur radius is invented.
 *
 * The generic stabilizer takes a declared angular disturbance (camera shake) and applies a per-axis
 * response, latency, travel limits and a panning policy. The leftover (residual) motion feeds the
 * existing temporal mapping. No commercial IBIS (in-body) or OIS (optical) calibration is supplied,
 * no arbitrary "stops" rating is used, and body/lens coordination is never inferred.
 * @param input - CalculateStabilizedCaptureTemporalSamplesInput. See that type for coordinates, units and profile binding.
 * @returns CalculationResult<StabilizedCaptureTemporalSamples>. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function calculateStabilizedCaptureTemporalSamples(
  input:
    CalculateStabilizedCaptureTemporalSamplesInput
): CalculationResult<StabilizedCaptureTemporalSamples> {
  requireInputKeys(input, "calculateStabilizedCaptureTemporalSamples", ["disturbance", "profile", "captureKind", "timing", "samplePointsNative", "temporalSampleCount"]);
  requireInputObject(input.timing, "timing");
  const disturbance =
    parseStabilizationDisturbanceTrajectory(
      input.disturbance
    );
  const profile =
    parseStabilizationSystemProfile(
      input.profile
    );
  if (
    input.captureKind !==
      profile.captureKind
  ) {
    throw new InvalidScientificInputError(
      "captureKind must exactly match the stabilization profile captureKind."
    );
  }
  requirePositiveInteger(
    "temporalSampleCount",
    input.temporalSampleCount
  );
  if (
    !Array.isArray(
      input.samplePointsNative
    ) ||
    input.samplePointsNative.length ===
      0
  ) {
    throw new InvalidConfigurationError(
      "samplePointsNative must be a non-empty array."
    );
  }
  input.samplePointsNative.forEach((point, index) => requireInputObject(point, "samplePointsNative[" + index + "]"));

  const totalNodeCount =
    input.temporalSampleCount *
    input.samplePointsNative.length;
  if (
    !Number.isSafeInteger(
      totalNodeCount
    )
  ) {
    throw new InvalidScientificInputError(
      "temporalSampleCount × samplePointsNative.length must remain a safe integer."
    );
  }

  const disturbanceIndex =
    indexDisturbance(disturbance);
  const responses =
    indexAxisResponses(profile);
  let exposureWindowIndex:
    ExposureWindowIndex | undefined;
  const points =
    input.samplePointsNative.map(
      (point) => {
        exposureWindowIndex ??=
          indexExposureWindows(
            input.timing
          );
        const exposure =
          localExposureForPoint(
            exposureWindowIndex,
            point
          );
        const normalizedTimeWeight =
          1 /
          input.temporalSampleCount;
        const timeMeasureSeconds =
          exposure.duration /
          input.temporalSampleCount;

        const nodes =
          Array.from(
            {
              length:
                input.temporalSampleCount
            },
            (
              _,
              temporalSampleIndex
            ) => {
              const localExposurePhase =
                (
                  temporalSampleIndex +
                  0.5
                ) /
                input.temporalSampleCount;
              const captureTime =
                exposure.start +
                localExposurePhase *
                  exposure.duration;
              return {
                temporalSampleIndex,
                localExposurePhase,
                captureTimeSecondsFromReference:
                  captureTime,
                normalizedTimeWeight,
                timeMeasureSeconds,
                stabilization:
                  evaluateAtTime(
                    disturbanceIndex,
                    profile,
                    responses,
                    captureTime
                  )
              };
            }
          );

        return {
          destinationPointNative: {
            ...point
          },
          localExposureWindow: {
            startSecondsFromCaptureReference:
              exposure.start,
            endSecondsFromCaptureReference:
              exposure.end,
            durationSeconds:
              exposure.duration
          },
          nodes
        };
      }
    );

  return approximationResult(
    {
      profileId:
        profile.profileId,
      trajectoryId:
        disturbance.trajectoryId,
      captureModeId:
        input.timing.captureModeId,
      timingProfileId:
        input.timing.timingProfileId,
      captureKind:
        input.captureKind,
      architecture:
        profile.architecture,
      timeReference:
        "first-opening-boundary-phase",
      quadratureScheme:
        "uniform-midpoint",
      temporalSampleCount:
        input.temporalSampleCount,
      points,
      sensorReadoutTimingUsedAsExposureTiming:
        false,
      supportStateConsumed:
        false,
      translationCorrectionModeled:
        false,
      digitalStabilizationApplied:
        false
    },
    "capture-local-stabilization-temporal-sampling",
    "1.0.0",
    [
      "Stabilization is evaluated at deterministic midpoint nodes inside each authoritative local exposure window of the exposure-window model.",
      "Sensor data-readout timing is not substituted for exposure timing.",
      "The result is rotational disturbance/correction/residual state only; it does not itself calculate image-plane mapping, radiance, blur, PSF or output pixels.",
      "Translation/parallax, subject motion, shutter shock, support vibration sources and digital stabilization remain separate domains."
    ]
  );
}
