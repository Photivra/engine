// SPDX-License-Identifier: Apache-2.0

/**
 * Meter targets: a frozen metering result that camera-control logic uses as its exposure target.
 *
 * The target copies the meter snapshot by value. Later changes to the scene or light do not change
 * it. This is what the engine provides for AE lock (auto-exposure lock).
 *
 * Exposure compensation is set as an absolute value. It is always worked out again from the base
 * target without compensation, so repeated UI updates cannot build up floating-point or control
 * drift. Positive compensation asks for more exposure.
 * @see docs/USAGE.md for the equations, units, coordinate conventions, known blockers and support
 * limits.
 */

import { InvalidScientificInputError } from "../core/validation.js";
import type {
  ExposureMeteringResult
} from "./metering.js";
import type {
  SceneRadianceTemporalExposureMeteringResult
} from "./metering-temporal.js";
import { requireInputObject, requireInputKeys, requireTrimmedConfigString as requireNonEmptyString, requireInputFinite as requireFinite, requireInputFiniteAboveZero as requirePositiveFinite, requireInputFiniteAtLeastZero as requireNonNegativeFinite } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export const EXPOSURE_METER_TARGET_SCHEMA_VERSION =
  "0.1.0" as const;

export type ExposureMeterTargetSourceResult =
  | ExposureMeteringResult
  | SceneRadianceTemporalExposureMeteringResult;

export type ExposureMeterTargetSourceKind =
  | "spatial-metering-result"
  | "temporal-metering-result";

export interface ExposureMeterSnapshotIdentity {
  sourceKind:
    ExposureMeterTargetSourceKind;
  measurementId: string;
  sceneStateId: string;
  meteringProfileId: string;
}

interface ExposureMeterTargetBase {
  schemaVersion:
    typeof EXPOSURE_METER_TARGET_SCHEMA_VERSION;
  targetId: string;
  sourceMeterSnapshot:
    ExposureMeterSnapshotIdentity;
  scientificStatus: "approximation";
  inputDomain:
    "relative-pre-exposure-linear-signal";
  baseTargetRelativeSignal: number;
  meteredRelativeSignal: number;
  exposureCompensationStops: number;
  exposureCompensationApplied: boolean;
  meterMeasurementMutated: false;
  sourceMeterSnapshotPreserved: true;
  resultReusableForAeLock: true;
  automaticExposureResolved: false;
  intendedConsumer:
    "exposure-mode-resolver";
}

export type ExposureMeterTarget =
  | (ExposureMeterTargetBase & {
      status: "resolved";
      baseRequiredExposureScaleToTarget:
        number;
      baseExposureOffsetStopsToTarget:
        number;
      requiredExposureScaleToTarget:
        number;
      exposureOffsetStopsToTarget:
        number;
    })
  | (ExposureMeterTargetBase & {
      status: "no-signal";
      baseRequiredExposureScaleResolved:
        false;
      baseExposureOffsetStopsResolved:
        false;
      requiredExposureScaleResolved:
        false;
      exposureOffsetStopsResolved:
        false;
    });

export interface CreateExposureMeterTargetInput {
  targetId: string;
  meterResult:
    ExposureMeterTargetSourceResult;
}

export interface SetExposureCompensationOnMeterTargetInput {
  targetId: string;
  baseTarget: ExposureMeterTarget;
  exposureCompensationStops: number;
}

function meterSnapshotIdentity(
  result:
    ExposureMeterTargetSourceResult
): ExposureMeterSnapshotIdentity {
  const hasSpatialId =
    "measurementId" in result;
  const hasTemporalId =
    "temporalMeasurementId" in
    result;

  if (
    hasSpatialId === hasTemporalId
  ) {
    throw new InvalidScientificInputError(
      "meterResult must identify exactly one spatial or temporal metering result."
    );
  }

  return {
    sourceKind: hasSpatialId
      ? "spatial-metering-result"
      : "temporal-metering-result",
    measurementId:
      requireNonEmptyString(
        hasSpatialId
          ? result.measurementId
          : result
              .temporalMeasurementId,
        hasSpatialId
          ? "meterResult.measurementId"
          : "meterResult.temporalMeasurementId"
      ),
    sceneStateId:
      requireNonEmptyString(
        result.sceneStateId,
        "meterResult.sceneStateId"
      ),
    meteringProfileId:
      requireNonEmptyString(
        result.profileId,
        "meterResult.profileId"
      )
  };
}

function validateCommonMeterResult(
  result:
    ExposureMeterTargetSourceResult
): void {
  requireInputObject(result, "result input");
  if (
    result.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      'meterResult.scientificStatus must be "approximation" for schema 0.1.0.'
    );
  }
  if (
    result.inputDomain !==
    "relative-pre-exposure-linear-signal"
  ) {
    throw new InvalidConfigurationError(
      'meterResult.inputDomain must be "relative-pre-exposure-linear-signal".'
    );
  }
  if (
    result.exposureCompensationApplied !==
    false
  ) {
    throw new InvalidScientificInputError(
      "meterResult must be the uncompensated base metering result."
    );
  }
  if (
    result.automaticExposureResolved !==
    false
  ) {
    throw new InvalidScientificInputError(
      "meterResult must precede automatic exposure resolution."
    );
  }
  if (
    result.resultReusableForAeLock !==
    true
  ) {
    throw new InvalidScientificInputError(
      "meterResult must preserve reusable meter-result identity."
    );
  }

  requirePositiveFinite(
    result.targetRelativeSignal,
    "meterResult.targetRelativeSignal"
  );
  requireNonNegativeFinite(
    result.meteredRelativeSignal,
    "meterResult.meteredRelativeSignal"
  );
}

function createBaseTargetFields(
  targetId: string,
  meterResult:
    ExposureMeterTargetSourceResult
): ExposureMeterTargetBase {
  validateCommonMeterResult(
    meterResult
  );

  return {
    schemaVersion:
      EXPOSURE_METER_TARGET_SCHEMA_VERSION,
    targetId:
      requireNonEmptyString(
        targetId,
        "targetId"
      ),
    sourceMeterSnapshot:
      meterSnapshotIdentity(
        meterResult
      ),
    scientificStatus: "approximation",
    inputDomain:
      "relative-pre-exposure-linear-signal",
    baseTargetRelativeSignal:
      meterResult.targetRelativeSignal,
    meteredRelativeSignal:
      meterResult.meteredRelativeSignal,
    exposureCompensationStops: 0,
    exposureCompensationApplied:
      false,
    meterMeasurementMutated: false,
    sourceMeterSnapshotPreserved:
      true,
    resultReusableForAeLock: true,
    automaticExposureResolved: false,
    intendedConsumer:
      "exposure-mode-resolver"
  };
}

/**
 * Freezes one metering result into a stable relative exposure target, for
 * camera-control logic to use.
 *
 * The target copies the meter snapshot by value. Later changes to the scene or
 * light do not change it. This is what the engine provides for AE lock
 * (auto-exposure lock).
 */
export function createExposureMeterTargetFromMeteringResult(
  input:
    CreateExposureMeterTargetInput
): ExposureMeterTarget {
  requireInputKeys(input, "createExposureMeterTargetFromMeteringResult", ["targetId", "meterResult"]);
  const base =
    createBaseTargetFields(
      input.targetId,
      input.meterResult
    );

  if (
    input.meterResult.status ===
    "no-signal"
  ) {
    if (
      input.meterResult
        .meteredRelativeSignal !== 0
    ) {
      throw new InvalidScientificInputError(
        "A no-signal meter result must have meteredRelativeSignal equal to zero."
      );
    }
    return {
      ...base,
      status: "no-signal",
      baseRequiredExposureScaleResolved:
        false,
      baseExposureOffsetStopsResolved:
        false,
      requiredExposureScaleResolved:
        false,
      exposureOffsetStopsResolved:
        false
    };
  }

  const meteredRelativeSignal =
    requirePositiveFinite(
      input.meterResult
        .meteredRelativeSignal,
      "meterResult.meteredRelativeSignal"
    );
  const baseScale =
    base.baseTargetRelativeSignal /
    meteredRelativeSignal;
  if (
    !Number.isFinite(baseScale) ||
    baseScale <= 0
  ) {
    throw new InvalidScientificInputError(
      "Base required exposure scale must remain finite and greater than zero."
    );
  }
  const baseStops =
    Math.log2(baseScale);
  if (!Number.isFinite(baseStops)) {
    throw new InvalidScientificInputError(
      "Base exposure offset must remain finite."
    );
  }

  return {
    ...base,
    status: "resolved",
    baseRequiredExposureScaleToTarget:
      baseScale,
    baseExposureOffsetStopsToTarget:
      baseStops,
    requiredExposureScaleToTarget:
      baseScale,
    exposureOffsetStopsToTarget:
      baseStops
  };
}

function validateBaseTarget(
  target: ExposureMeterTarget
): void {
  requireInputObject(target, "target input");
  if (
    target.schemaVersion !==
    EXPOSURE_METER_TARGET_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'baseTarget.schemaVersion must be "' +
        EXPOSURE_METER_TARGET_SCHEMA_VERSION +
        '".'
    );
  }
  requireNonEmptyString(
    target.targetId,
    "baseTarget.targetId"
  );
  requireInputObject(target.sourceMeterSnapshot, "baseTarget.sourceMeterSnapshot");
  requireNonEmptyString(
    target
      .sourceMeterSnapshot
      .measurementId,
    "baseTarget.sourceMeterSnapshot.measurementId"
  );
  requireNonEmptyString(
    target
      .sourceMeterSnapshot
      .sceneStateId,
    "baseTarget.sourceMeterSnapshot.sceneStateId"
  );
  requireNonEmptyString(
    target
      .sourceMeterSnapshot
      .meteringProfileId,
    "baseTarget.sourceMeterSnapshot.meteringProfileId"
  );
  if (
    target
      .sourceMeterSnapshot
      .sourceKind !==
      "spatial-metering-result" &&
    target
      .sourceMeterSnapshot
      .sourceKind !==
      "temporal-metering-result"
  ) {
    throw new InvalidConfigurationError(
      "baseTarget.sourceMeterSnapshot.sourceKind is invalid."
    );
  }
  if (
    target.scientificStatus !==
      "approximation" ||
    target.inputDomain !==
      "relative-pre-exposure-linear-signal" ||
    target.meterMeasurementMutated !==
      false ||
    target.sourceMeterSnapshotPreserved !==
      true ||
    target.resultReusableForAeLock !==
      true ||
    target.automaticExposureResolved !==
      false ||
    target.intendedConsumer !==
      "exposure-mode-resolver"
  ) {
    throw new InvalidScientificInputError(
      "baseTarget does not satisfy the exposure-meter target boundary."
    );
  }
  requirePositiveFinite(
    target.baseTargetRelativeSignal,
    "baseTarget.baseTargetRelativeSignal"
  );
  requireNonNegativeFinite(
    target.meteredRelativeSignal,
    "baseTarget.meteredRelativeSignal"
  );

  if (target.status === "resolved") {
    requirePositiveFinite(
      target
        .baseRequiredExposureScaleToTarget,
      "baseTarget.baseRequiredExposureScaleToTarget"
    );
    requireFinite(
      target
        .baseExposureOffsetStopsToTarget,
      "baseTarget.baseExposureOffsetStopsToTarget"
    );
  } else if (
    target.meteredRelativeSignal !== 0
  ) {
    throw new InvalidScientificInputError(
      "A no-signal baseTarget must preserve zero meteredRelativeSignal."
    );
  }
}

/**
 * Sets an absolute exposure-compensation value on a frozen meter target.
 *
 * Compensation is always worked out again from the base target without
 * compensation, so repeated UI updates cannot build up floating-point or
 * control drift. Positive compensation asks for more exposure.
 */
export function setExposureCompensationOnMeterTarget(
  input:
    SetExposureCompensationOnMeterTargetInput
): ExposureMeterTarget {
  requireInputKeys(input, "setExposureCompensationOnMeterTarget", ["targetId", "baseTarget", "exposureCompensationStops"]);
  validateBaseTarget(
    input.baseTarget
  );
  const targetId =
    requireNonEmptyString(
      input.targetId,
      "targetId"
    );
  if (
    targetId ===
    input.baseTarget.targetId
  ) {
    throw new InvalidScientificInputError(
      "A compensated target must use a new targetId so changed control state cannot hide behind the same identity."
    );
  }

  const compensation =
    requireFinite(
      input.exposureCompensationStops,
      "exposureCompensationStops"
    );
  const common = {
    ...input.baseTarget,
    targetId,
    exposureCompensationStops:
      compensation,
    exposureCompensationApplied:
      compensation !== 0,
    meterMeasurementMutated:
      false as const,
    sourceMeterSnapshotPreserved:
      true as const,
    resultReusableForAeLock:
      true as const,
    automaticExposureResolved:
      false as const
  };

  if (
    input.baseTarget.status ===
    "no-signal"
  ) {
    return {
      ...common,
      status: "no-signal",
      baseRequiredExposureScaleResolved:
        false,
      baseExposureOffsetStopsResolved:
        false,
      requiredExposureScaleResolved:
        false,
      exposureOffsetStopsResolved:
        false
    };
  }

  const compensatedStops =
    input.baseTarget
      .baseExposureOffsetStopsToTarget +
    compensation;
  const compensatedScale =
    input.baseTarget
      .baseRequiredExposureScaleToTarget *
    Math.pow(2, compensation);

  if (
    !Number.isFinite(
      compensatedStops
    ) ||
    !Number.isFinite(
      compensatedScale
    ) ||
    compensatedScale <= 0
  ) {
    throw new InvalidScientificInputError(
      "Compensated exposure target must remain finite and greater than zero."
    );
  }

  return {
    ...common,
    status: "resolved",
    baseRequiredExposureScaleToTarget:
      input.baseTarget
        .baseRequiredExposureScaleToTarget,
    baseExposureOffsetStopsToTarget:
      input.baseTarget
        .baseExposureOffsetStopsToTarget,
    requiredExposureScaleToTarget:
      compensatedScale,
    exposureOffsetStopsToTarget:
      compensatedStops
  };
}
