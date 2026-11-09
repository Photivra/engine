// SPDX-License-Identifier: Apache-2.0

/**
 * Metering over time: a declared weighted time average of relative meter samples taken before the
 * exposure (pre-exposure) and derived from scene radiance. Useful for flickering light.
 *
 * Each time sample must already be bound to one temporal illumination profile and one capture time.
 * Times are measured from the first opening-boundary phase (when the shutter starts to open). Each
 * time sample is metered spatially first, with the same declared profile. The resulting single
 * values are then combined linearly using normalized time weights that the caller declares.
 * @see docs/USAGE.md for the equations, units, coordinate conventions, known blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  meterRelativeExposure,
  parseExposureMeteringProfile,
  type ExposureMeteringPolicy,
  type ExposureMeteringProfile
} from "./metering.js";
import type {
  SceneRadianceDerivedExposureMeteringSampleSet
} from "./metering-scene-radiance.js";
import { requireInputKeys, requireInputObject, requireTrimmedConfigString as requireNonEmptyString } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

const NORMALIZED_WEIGHT_TOLERANCE =
  1e-9;

export interface SceneRadianceTemporalMeteringSample {
  normalizedTimeWeight: number;
  sampleSet:
    SceneRadianceDerivedExposureMeteringSampleSet;
}

export interface MeterSceneRadianceTemporalExposureInput {
  temporalMeasurementId: string;
  profile: ExposureMeteringProfile;
  policy: {
    kind: "weighted-time-average";
    timeReference:
      "first-opening-boundary-phase";
  };
  temporalSamples:
    readonly SceneRadianceTemporalMeteringSample[];
}

interface SceneRadianceTemporalExposureMeteringResultBase {
  temporalMeasurementId: string;
  sceneStateId: string;
  profileId: string;
  scientificStatus: "approximation";
  inputDomain:
    "relative-pre-exposure-linear-signal";
  captureRegion:
    "oriented-active-capture";
  spatialPolicyKind:
    ExposureMeteringPolicy["kind"];
  temporalPolicyKind:
    "weighted-time-average";
  timeReference:
    "first-opening-boundary-phase";
  temporalSampleCount: number;
  normalizedTimeWeightSum: number;
  captureTimeRangeSecondsFromReference: {
    minimum: number;
    maximum: number;
  };
  targetRelativeSignal: number;
  meteredRelativeSignal: number;
  outputCropUsedForMetering: false;
  exposureCompensationApplied: false;
  finalToneMappingUsed: false;
  displayGammaUsed: false;
  calibratedLuminanceClaimAuthorized:
    false;
  calibratedSceneRadianceClaimAuthorized:
    false;
  automaticExposureResolved: false;
  resultReusableForAeLock: true;
  temporalAveragingExplicit: true;
  flashTtlMeteringPerformed: false;
}

export type SceneRadianceTemporalExposureMeteringResult =
  | (SceneRadianceTemporalExposureMeteringResultBase & {
      status: "resolved";
      requiredExposureScaleToTarget:
        number;
      exposureOffsetStopsToTarget:
        number;
    })
  | (SceneRadianceTemporalExposureMeteringResultBase & {
      status: "no-signal";
      requiredExposureScaleResolved:
        false;
      exposureOffsetStopsResolved:
        false;
    });

function requireNormalizedWeight(
  value: unknown,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1
  ) {
    throw new InvalidScientificInputError(
      path +
        " must be finite and in (0, 1]."
    );
  }
  return value;
}

function contextKey(
  sampleSet:
    SceneRadianceDerivedExposureMeteringSampleSet
): string {
  const context =
    sampleSet.sourceContext;
  const geometry =
    sampleSet.captureGeometry;
  return JSON.stringify({
    sceneId: context.sceneId,
    sceneStateId:
      context.sceneStateId,
    providerProfileId:
      context.providerProfileId,
    illuminationProfileId:
      context.illuminationProfileId,
    materialResponseProfileId:
      context.materialResponseProfileId,
    derivationProfileId:
      context.derivationProfileId,
    materialResponseFidelity:
      context.materialResponseFidelity,
    orientation:
      geometry.orientedCapture
        .orientation,
    activeNativeRect:
      geometry.activeCapture.nativeRect,
    activeImagingArea:
      geometry.activeCapture.imagingArea,
    orientedImagingArea:
      geometry.orientedCapture
        .imagingArea
  });
}

/**
 * Meters a declared weighted time average of relative pre-exposure samples
 * derived from scene radiance.
 *
 * Each time sample must already be bound to one temporal illumination profile
 * and one capture time, measured from the first opening-boundary phase. Each
 * time sample is metered spatially first, with the same declared profile. The
 * resulting single values are then combined linearly using normalized time
 * weights that the caller declares.
 */
export function meterSceneRadianceTemporalExposure(
  input:
    MeterSceneRadianceTemporalExposureInput
): CalculationResult<
  SceneRadianceTemporalExposureMeteringResult
> {
  requireInputKeys(input, "meterSceneRadianceTemporalExposure", ["temporalMeasurementId", "profile", "policy", "temporalSamples"]);
  const temporalMeasurementId =
    requireNonEmptyString(
      input.temporalMeasurementId,
      "temporalMeasurementId"
    );

  const profile =
    parseExposureMeteringProfile(
      input.profile
    );

  if (
    profile.policy.kind ===
    "highlight-priority"
  ) {
    // A time average of per-snapshot quantiles is not the quantile of the time-averaged signal.
    throw new InvalidScientificInputError(
      "highlight-priority is a spatial quantile, not a linear signal mean; temporal averaging of snapshot quantiles is not defined by this model."
    );
  }
  requireInputObject(input.policy, "policy");
  if (
    input.policy.kind !==
    "weighted-time-average"
  ) {
    throw new InvalidConfigurationError(
      'policy.kind must be "weighted-time-average".'
    );
  }
  if (
    input.policy.timeReference !==
    "first-opening-boundary-phase"
  ) {
    throw new InvalidConfigurationError(
      'policy.timeReference must be "first-opening-boundary-phase".'
    );
  }
  if (
    !Array.isArray(
      input.temporalSamples
    ) ||
    input.temporalSamples.length === 0
  ) {
    throw new InvalidConfigurationError(
      "temporalSamples must be a non-empty array."
    );
  }

  input.temporalSamples.forEach((entry, index) => {
    const path = "temporalSamples[" + index + "]";
    requireInputObject(entry, path);
    const sampleSet = entry.sampleSet;
    requireInputObject(sampleSet, path + ".sampleSet");
    requireInputObject(sampleSet.sourceContext, path + ".sampleSet.sourceContext");
    requireInputObject(sampleSet.sourceContext.temporal, path + ".sampleSet.sourceContext.temporal");
    requireInputObject(sampleSet.captureGeometry, path + ".sampleSet.captureGeometry");
    requireInputObject(sampleSet.captureGeometry.orientedCapture, path + ".sampleSet.captureGeometry.orientedCapture");
    requireInputObject(sampleSet.captureGeometry.activeCapture, path + ".sampleSet.captureGeometry.activeCapture");
  });
  const firstSampleSet =
    input.temporalSamples[0]!
      .sampleSet;
  const firstContext =
    firstSampleSet.sourceContext;
  if (
    firstContext.temporal.kind !==
    "registered-time-varying"
  ) {
    throw new InvalidScientificInputError(
      "Temporal metering requires scene-radiance sample sets with registered-time-varying source context."
    );
  }

  const expectedContextKey =
    contextKey(firstSampleSet);
  const sceneStateId =
    firstSampleSet.sceneStateId;
  const temporalProfileId =
    firstContext.temporal
      .illuminationTemporalProfileId;

  let weightSum = 0;
  let meteredRelativeSignal = 0;
  let previousTime =
    Number.NEGATIVE_INFINITY;
  let minimumTime =
    Number.POSITIVE_INFINITY;
  let maximumTime =
    Number.NEGATIVE_INFINITY;

  for (
    let index = 0;
    index <
    input.temporalSamples.length;
    index += 1
  ) {
    const entry =
      input.temporalSamples[index]!;
    const path =
      "temporalSamples[" +
      index +
      "]";
    const weight =
      requireNormalizedWeight(
        entry.normalizedTimeWeight,
        path +
          ".normalizedTimeWeight"
      );
    const sampleSet =
      entry.sampleSet;
    const context =
      sampleSet.sourceContext;

    if (
      context.temporal.kind !==
      "registered-time-varying"
    ) {
      throw new InvalidScientificInputError(
        path +
          ".sampleSet must use registered-time-varying source context."
      );
    }
    if (
      context.temporal
        .illuminationTemporalProfileId !==
      temporalProfileId
    ) {
      throw new InvalidScientificInputError(
        "All temporal metering samples must bind the same illuminationTemporalProfileId."
      );
    }
    if (
      sampleSet.sceneStateId !==
      sceneStateId ||
      context.sceneStateId !==
      sceneStateId
    ) {
      throw new InvalidScientificInputError(
        "All temporal metering samples must bind the same sceneStateId."
      );
    }
    if (
      contextKey(sampleSet) !==
      expectedContextKey
    ) {
      throw new InvalidScientificInputError(
        "All temporal metering samples must share the same scene/provider/material/derivation/capture-geometry context."
      );
    }

    const captureTime =
      context.temporal
        .captureTimeSecondsFromReference;
    if (
      !Number.isFinite(captureTime)
    ) {
      throw new InvalidScientificInputError(
        path +
          " capture time must be finite."
      );
    }
    if (
      captureTime <= previousTime
    ) {
      throw new InvalidScientificInputError(
        "Temporal metering capture times must be strictly increasing."
      );
    }
    previousTime = captureTime;
    minimumTime = Math.min(
      minimumTime,
      captureTime
    );
    maximumTime = Math.max(
      maximumTime,
      captureTime
    );

    const spatialMeter =
      meterRelativeExposure({
        profile,
        sampleSet
      });
    meteredRelativeSignal +=
      spatialMeter.value
        .meteredRelativeSignal *
      weight;
    weightSum += weight;
  }

  if (
    !Number.isFinite(weightSum) ||
    Math.abs(weightSum - 1) >
      NORMALIZED_WEIGHT_TOLERANCE
  ) {
    throw new InvalidScientificInputError(
      "temporalSamples normalizedTimeWeight values must sum to 1."
    );
  }
  if (
    !Number.isFinite(
      meteredRelativeSignal
    ) ||
    meteredRelativeSignal < 0
  ) {
    throw new InvalidScientificInputError(
      "Temporal metered relative signal must remain finite and non-negative."
    );
  }

  const base = {
    temporalMeasurementId,
    sceneStateId,
    profileId:
      profile.profileId,
    scientificStatus:
      "approximation" as const,
    inputDomain:
      "relative-pre-exposure-linear-signal" as const,
    captureRegion:
      "oriented-active-capture" as const,
    spatialPolicyKind:
      profile.policy.kind,
    temporalPolicyKind:
      "weighted-time-average" as const,
    timeReference:
      "first-opening-boundary-phase" as const,
    temporalSampleCount:
      input.temporalSamples.length,
    normalizedTimeWeightSum: 1,
    captureTimeRangeSecondsFromReference: {
      minimum: minimumTime,
      maximum: maximumTime
    },
    targetRelativeSignal:
      profile.target
        .targetRelativeSignal,
    meteredRelativeSignal,
    outputCropUsedForMetering:
      false as const,
    exposureCompensationApplied:
      false as const,
    finalToneMappingUsed:
      false as const,
    displayGammaUsed:
      false as const,
    calibratedLuminanceClaimAuthorized:
      false as const,
    calibratedSceneRadianceClaimAuthorized:
      false as const,
    automaticExposureResolved:
      false as const,
    resultReusableForAeLock:
      true as const,
    temporalAveragingExplicit:
      true as const,
    flashTtlMeteringPerformed:
      false as const
  };

  const result:
    SceneRadianceTemporalExposureMeteringResult =
    meteredRelativeSignal === 0
      ? {
          ...base,
          status: "no-signal",
          requiredExposureScaleResolved:
            false,
          exposureOffsetStopsResolved:
            false
        }
      : {
          ...base,
          status: "resolved",
          requiredExposureScaleToTarget:
            profile.target
              .targetRelativeSignal /
            meteredRelativeSignal,
          exposureOffsetStopsToTarget:
            Math.log2(
              profile.target
                .targetRelativeSignal /
                meteredRelativeSignal
            )
        };

  return approximationResult(
    result,
    "scene-radiance-relative-temporal-metering",
    "1.0.0",
    [
      "Each temporal sample is a renderer/provider-supplied relative pre-exposure reduction bound to the same scene-radiance provider context.",
      "Spectral radiance is not converted to calibrated luminance or a camera spectral-meter response by this model.",
      "Time averaging is explicit and linear in the declared relative pre-exposure signal domain.",
      "Temporal sample weights are caller-declared, positive, normalized to one, and are not inferred from source waveform frequency or sensor readout timing.",
      "All temporal samples share one committed sceneStateId and one provider/material/derivation/capture-geometry context.",
      "Exposure compensation and automatic aperture/shutter/ISO resolution remain downstream.",
      "This ambient meter does not implement flash/TTL metering."
    ]
  );
}
