// SPDX-License-Identifier: Apache-2.0

/**
 * Parallax from camera movement (translation): nearer points shift more in the image than distant
 * ones. It is evaluated at deterministic midpoint time samples across each scene point's local
 * exposure window.
 *
 * The model works point by point, on purpose. Camera movement and optional subject movement combine
 * as relative linear motion; neither is recast as the other. Camera rotation, and visibility or
 * occlusion, are separate models.
 * @see docs/MOTION_AND_SIGNAL.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite,
  requirePositiveInteger
} from "../core/validation.js";
import {
  transformNativeRasterVectorToOriented,
  type CaptureOrientation,
  type RasterPoint
} from "../output/capture-geometry.js";
import { calculateThinLensImageDistance } from "../optics/thin-lens.js";
import type { Vector3 } from "../schema/scene.js";
import type {
  ResolvedCaptureModeTiming
} from "../sensor/capture-mode-timing.js";
import type {
  SensorImagingArea
} from "../sensor/sensor-geometry.js";
import { requireInputObject, requireInputKeys, requireTrimmedConfigString as requireNonEmptyString } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { sameSite as samePoint } from "../core/shared-helpers.js";

export interface CaptureTranslationParallaxSceneSample {
  sampleId: string;
  /**
   * Native destination point. Its local exposure window applies to this scene
   * sample.
   */
  destinationPointNative:
    RasterPoint;
  /**
   * Point position in metres, in the camera axes at the first opening-boundary
   * phase. +X right, +Y up, +Z forward (away from the camera).
   */
  positionCameraM: Vector3;
  /**
   * Optional constant velocity of the subject (world point), in the same
   * starting camera axes. If omitted, the world point is still.
   */
  subjectVelocityMps?: Vector3;
}

export interface CalculateCaptureTranslationParallaxTemporalQuadratureInput {
  timing:
    ResolvedCaptureModeTiming;
  imagingArea:
    SensorImagingArea;
  focalLengthMm: number;
  focusDistanceM?: number;
  orientation:
    CaptureOrientation;
  /**
   * Constant movement of the camera centre, in camera axes at the capture
   * reference phase. Rotation is handled separately, on purpose.
   */
  cameraTranslationVelocityMps:
    Vector3;
  temporalSampleCount: number;
  sceneSamples:
    readonly CaptureTranslationParallaxSceneSample[];
}

export interface CaptureTranslationParallaxTemporalNode {
  temporalSampleIndex: number;
  localExposurePhase: number;
  captureTimeSecondsFromReference:
    number;
  normalizedTimeWeight: number;
  timeMeasureSeconds: number;
  relativePositionCameraM:
    Vector3;
  mappedImagePointMm: {
    x: number;
    y: number;
  };
  deltaFromReferenceImagePlaneMm: {
    x: number;
    y: number;
    distance: number;
  };
  deltaNativeSamples: {
    x: number;
    y: number;
    distance: number;
  };
  deltaOrientedSamples: {
    x: number;
    y: number;
    distance: number;
  };
}

export interface CaptureTranslationParallaxTemporalSample {
  sampleId: string;
  destinationPointNative:
    RasterPoint;
  referencePositionCameraM:
    Vector3;
  subjectVelocityMps: Vector3;
  localExposureWindow: {
    startSecondsFromCaptureReference:
      number;
    endSecondsFromCaptureReference:
      number;
    durationSeconds: number;
  };
  referenceImagePointMm: {
    x: number;
    y: number;
  };
  nodes:
    readonly CaptureTranslationParallaxTemporalNode[];
}

export interface CaptureTranslationParallaxTemporalQuadrature {
  timeReference:
    "first-opening-boundary-phase";
  timingProfileIdentity: {
    profileId: string;
    profileVersion: string;
    captureModeId: string;
  };
  orientation:
    CaptureOrientation;
  projectionDistanceMm: number;
  temporalSampleCount: number;
  cameraTranslationVelocityMps:
    Vector3;
  samples:
    readonly CaptureTranslationParallaxTemporalSample[];
  geometryModel:
    "metric-depth-dependent-constant-linear-translation";
  relativeMotionComposition:
    "subject-minus-camera-translation";
  metricSceneDepthRequired: true;
  oneGlobalHomographyAuthorized: false;
  cameraRotationComposed: false;
  visibilityOcclusionModeled: false;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
}

export function requireFiniteVector(
  value: Vector3,
  path: string
): Vector3 {
  requireInputObject(value, path);
  for (
    const axis of
    ["x", "y", "z"] as const
  ) {
    if (
      !Number.isFinite(
        value[axis]
      )
    ) {
      throw new InvalidScientificInputError(
        path +
          "." +
          axis +
          " must be finite."
      );
    }
  }
  return {
    ...value
  };
}

function projectPoint(
  positionM: Vector3,
  projectionDistanceMm: number,
  path: string
): {
  x: number;
  y: number;
} {
  if (
    positionM.z <= 0
  ) {
    throw new InvalidScientificInputError(
      path +
        " must remain in front of the camera plane."
    );
  }
  const mapped = {
    x:
      projectionDistanceMm *
      (positionM.x /
        positionM.z),
    y:
      projectionDistanceMm *
      (positionM.y /
        positionM.z)
  };
  if (
    !Number.isFinite(mapped.x) ||
    !Number.isFinite(mapped.y)
  ) {
    throw new InvalidScientificInputError(
      path +
        " projection must remain finite."
    );
  }
  return mapped;
}

function localExposureForPoint(
  timing:
    ResolvedCaptureModeTiming,
  point:
    RasterPoint
): ResolvedCaptureModeTiming["exposureWindows"]["samples"][number] {
  requireInputObject(point, "destinationPointNative");
  const matches =
    timing.exposureWindows.samples.filter(
      (sample) =>
        samePoint(
          sample.pointNative,
          point
        )
    );
  if (matches.length !== 1) {
    throw new InvalidScientificInputError(
      "Each translation/parallax scene sample must match exactly one committed exposure-window sample point."
    );
  }
  return matches[0]!;
}

/**
 * Evaluates depth-dependent parallax from camera movement at deterministic
 * midpoint time samples across each scene point's local exposure window.
 *
 * The model works point by point, on purpose. Camera movement and optional
 * subject movement combine as relative linear motion; neither is recast as
 * the other. Camera rotation, and visibility or occlusion, are separate
 * models.
 */
export function calculateCaptureTranslationParallaxTemporalQuadrature(
  input:
    CalculateCaptureTranslationParallaxTemporalQuadratureInput
): CalculationResult<CaptureTranslationParallaxTemporalQuadrature> {
  requireInputKeys(input, "calculateCaptureTranslationParallaxTemporalQuadrature", ["timing", "imagingArea", "focalLengthMm", "focusDistanceM", "orientation", "cameraTranslationVelocityMps", "temporalSampleCount", "sceneSamples"]);
  requireInputObject(input.imagingArea, "imagingArea");
  requireInputObject(input.timing, "timing");
  requireInputObject(input.timing.nativeRaster, "timing.nativeRaster");
  requireInputObject(input.timing.exposureWindows, "timing.exposureWindows");
  if (!Array.isArray(input.timing.exposureWindows.samples)) throw new InvalidConfigurationError("timing.exposureWindows.samples must be an array.");
  input.timing.exposureWindows.samples.forEach((sample, index) => {
    requireInputObject(sample, "timing.exposureWindows.samples[" + index + "]");
    requireInputObject(sample.pointNative, "timing.exposureWindows.samples[" + index + "].pointNative");
  });
  requirePositiveFinite(
    "imagingArea.widthMm",
    input.imagingArea.widthMm
  );
  requirePositiveFinite(
    "imagingArea.heightMm",
    input.imagingArea.heightMm
  );
  requirePositiveFinite(
    "focalLengthMm",
    input.focalLengthMm
  );
  requirePositiveInteger(
    "temporalSampleCount",
    input.temporalSampleCount
  );

  if (
    !Array.isArray(
      input.sceneSamples
    ) ||
    input.sceneSamples.length === 0
  ) {
    throw new InvalidConfigurationError(
      "sceneSamples must be a non-empty array."
    );
  }

  input.sceneSamples.forEach((sample, index) => requireInputObject(sample, "sceneSamples[" + index + "]"));
  const ids =
    input.sceneSamples.map(
      (sample) =>
        requireNonEmptyString(
          sample.sampleId,
          "sceneSamples[].sampleId"
        )
    );
  if (
    new Set(ids).size !==
    ids.length
  ) {
    throw new InvalidScientificInputError(
      "sceneSamples must not contain duplicate sampleId values."
    );
  }

  const cameraVelocity =
    requireFiniteVector(
      input
        .cameraTranslationVelocityMps,
      "cameraTranslationVelocityMps"
    );

  const projectionDistanceMm =
    input.focusDistanceM ===
    undefined
      ? input.focalLengthMm
      : calculateThinLensImageDistance({
          focalLengthMm:
            input.focalLengthMm,
          objectDistanceM:
            input.focusDistanceM
        }).value.imageDistanceMm;

  const pitchX =
    input.imagingArea.widthMm /
    input.timing.nativeRaster
      .pixelWidth;
  const pitchY =
    input.imagingArea.heightMm /
    input.timing.nativeRaster
      .pixelHeight;

  if (
    !Number.isFinite(pitchX) ||
    !Number.isFinite(pitchY) ||
    pitchX <= 0 ||
    pitchY <= 0
  ) {
    throw new InvalidScientificInputError(
      "Resolved translation/parallax sampling pitch must remain finite and positive."
    );
  }

  const samples =
    input.sceneSamples.map(
      (sceneSample, sampleIndex) => {
        const samplePath =
          "sceneSamples[" +
          sampleIndex +
          "]";
        const sampleId =
          requireNonEmptyString(
            sceneSample.sampleId,
            samplePath +
              ".sampleId"
          );
        const referencePosition =
          requireFiniteVector(
            sceneSample
              .positionCameraM,
            samplePath +
              ".positionCameraM"
          );
        if (
          referencePosition.z <= 0
        ) {
          throw new InvalidScientificInputError(
            samplePath +
              ".positionCameraM.z must place the scene point in front of the camera."
          );
        }
        const subjectVelocity =
          sceneSample
            .subjectVelocityMps ===
          undefined
            ? {
                x: 0,
                y: 0,
                z: 0
              }
            : requireFiniteVector(
                sceneSample
                  .subjectVelocityMps,
                samplePath +
                  ".subjectVelocityMps"
              );

        const exposure =
          localExposureForPoint(
            input.timing,
            sceneSample
              .destinationPointNative
          );
        const duration =
          exposure
            .localExposureDurationSeconds;
        if (
          !Number.isFinite(
            duration
          ) ||
          duration <= 0
        ) {
          throw new InvalidScientificInputError(
            "Translation/parallax requires a positive finite local exposure duration."
          );
        }

        const referenceImagePoint =
          projectPoint(
            referencePosition,
            projectionDistanceMm,
            samplePath +
              ".positionCameraM"
          );

        const normalizedTimeWeight =
          1 /
          input.temporalSampleCount;
        const timeMeasureSeconds =
          duration /
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
                (temporalSampleIndex +
                  0.5) /
                input.temporalSampleCount;
              const captureTime =
                exposure
                  .startOffsetSecondsFromOpeningReference +
                localExposurePhase *
                  duration;

              const relativePosition = {
                x:
                  referencePosition.x +
                  (subjectVelocity.x -
                    cameraVelocity.x) *
                    captureTime,
                y:
                  referencePosition.y +
                  (subjectVelocity.y -
                    cameraVelocity.y) *
                    captureTime,
                z:
                  referencePosition.z +
                  (subjectVelocity.z -
                    cameraVelocity.z) *
                    captureTime
              };

              const mapped =
                projectPoint(
                  relativePosition,
                  projectionDistanceMm,
                  samplePath +
                    ".relativePositionCameraM"
                );
              const deltaMm = {
                x:
                  mapped.x -
                  referenceImagePoint.x,
                y:
                  mapped.y -
                  referenceImagePoint.y
              };
              const deltaNative = {
                x:
                  deltaMm.x /
                  pitchX,
                y:
                  -deltaMm.y /
                  pitchY
              };
              const oriented =
                transformNativeRasterVectorToOriented({
                  vector:
                    deltaNative,
                  orientation:
                    input.orientation
                });

              return {
                temporalSampleIndex,
                localExposurePhase,
                captureTimeSecondsFromReference:
                  captureTime,
                normalizedTimeWeight,
                timeMeasureSeconds,
                relativePositionCameraM:
                  relativePosition,
                mappedImagePointMm:
                  mapped,
                deltaFromReferenceImagePlaneMm: {
                  ...deltaMm,
                  distance:
                    Math.hypot(
                      deltaMm.x,
                      deltaMm.y
                    )
                },
                deltaNativeSamples: {
                  ...deltaNative,
                  distance:
                    Math.hypot(
                      deltaNative.x,
                      deltaNative.y
                    )
                },
                deltaOrientedSamples: {
                  ...oriented,
                  distance:
                    Math.hypot(
                      oriented.x,
                      oriented.y
                    )
                }
              };
            }
          );

        return {
          sampleId,
          destinationPointNative: {
            ...sceneSample
              .destinationPointNative
          },
          referencePositionCameraM:
            referencePosition,
          subjectVelocityMps:
            subjectVelocity,
          localExposureWindow: {
            startSecondsFromCaptureReference:
              exposure
                .startOffsetSecondsFromOpeningReference,
            endSecondsFromCaptureReference:
              exposure
                .endOffsetSecondsFromOpeningReference,
            durationSeconds:
              duration
          },
          referenceImagePointMm:
            referenceImagePoint,
          nodes
        };
      }
    );

  return approximationResult(
    {
      timeReference:
        "first-opening-boundary-phase",
      timingProfileIdentity: {
        profileId:
          input.timing
            .timingProfileId,
        profileVersion:
          input.timing
            .timingProfileVersion,
        captureModeId:
          input.timing
            .captureModeId
      },
      orientation:
        input.orientation,
      projectionDistanceMm,
      temporalSampleCount:
        input.temporalSampleCount,
      cameraTranslationVelocityMps:
        cameraVelocity,
      samples,
      geometryModel:
        "metric-depth-dependent-constant-linear-translation",
      relativeMotionComposition:
        "subject-minus-camera-translation",
      metricSceneDepthRequired:
        true,
      oneGlobalHomographyAuthorized:
        false,
      cameraRotationComposed:
        false,
      visibilityOcclusionModeled:
        false,
      sensorReadoutTimingUsedAsExposureTiming:
        false
    },
    "capture-translation-parallax-temporal-quadrature",
    "1.0.0",
    [
      "Translation is evaluated independently for each metric scene point because translational image motion depends on depth.",
      "Camera and subject translation coexist as explicit relative linear motion; subject motion is not reclassified as camera motion.",
      "The camera-axis basis is fixed at the first-opening-boundary phase; camera rotation remains a separate model.",
      "The destination native point selects the authoritative local exposure window; sensor data-readout timing is not substituted for exposure time.",
      "Oriented sample displacement is a coordinate transform of the same physical image-plane mapping and does not change the translation physics.",
      "No one global homography/warp is authorized for arbitrary 3D scenes.",
      "Visibility, occlusion, deformation, acceleration and rolling scene geometry remain outside this model."
    ]
  );
}
