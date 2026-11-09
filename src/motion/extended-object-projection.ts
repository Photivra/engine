// SPDX-License-Identifier: Apache-2.0

/**
 * Projection of an extended object: several explicit points (in metres) on one rigid object that
 * moves in a straight line.
 *
 * The points are evaluated at deterministic physical times, or at deterministic midpoint time
 * samples inside each point's local exposure window (from the capture exposure schedule).
 *
 * This is geometry only. It does not build a blur kernel, decide visibility, integrate radiance,
 * deform the object, rotate the camera or apply a universal scale.
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
import type {
  RasterPoint
} from "../output/capture-geometry.js";
import {
  calculateThinLensImageDistance
} from "../optics/thin-lens.js";
import type {
  Vector3
} from "../schema/scene.js";
import type {
  ResolvedCaptureModeTiming
} from "../sensor/capture-mode-timing.js";
import { requireInputKeys, requireInputObject, requireTrimmedConfigString as requireNonEmptyString } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { sameSite as samePoint } from "../core/shared-helpers.js";
import { requireFiniteVector } from "./capture-translation-parallax-temporal-quadrature.js";
import { requireScientificFinite as requireFiniteTime } from "../color/white-balance.js";
import { settingEquals as approximatelyEqual } from "../composition/image-formation-plan.js";

export interface ExtendedObjectMetricPoint {
  pointId: string;
  /**
   * Point in camera space, in metres, at the shared reference phase.
   *
   * +X right, +Y up, +Z forward/away from the camera.
   */
  positionCameraM: Vector3;
}

export interface ExtendedObjectFrontoparallelPlaneDeclaration {
  kind: "fronto-parallel-planar-patch";
  referenceDepthM: number;
}

export interface CalculateExtendedObjectProjectionTrajectoryInput {
  objectId: string;
  focalLengthMm: number;
  focusDistanceM?: number;
  objectTranslationVelocityMps:
    Vector3;
  cameraTranslationVelocityMps:
    Vector3;
  sampleTimesSecondsFromReference:
    readonly number[];
  points:
    readonly ExtendedObjectMetricPoint[];
  frontoparallelPlane?:
    ExtendedObjectFrontoparallelPlaneDeclaration;
}

export interface ExtendedObjectProjectionNode {
  sampleIndex: number;
  timeSecondsFromReference: number;
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
  depthM: number;
  planarMagnificationScaleFromReference:
    number | null;
}

export interface ExtendedObjectPointProjectionTrajectory {
  pointId: string;
  referencePositionCameraM:
    Vector3;
  referenceImagePointMm: {
    x: number;
    y: number;
  };
  nodes:
    readonly ExtendedObjectProjectionNode[];
}

export interface ExtendedObjectPlanarMagnificationDiagnostic {
  geometry:
    "declared-fronto-parallel-planar-patch";
  referenceDepthM: number;
  uniformScaleAuthorizedWithinDeclaredPatch:
    true;
  scaleByTime:
    readonly {
      sampleIndex: number;
      timeSecondsFromReference:
        number;
      scaleFromReference: number;
    }[];
  lateralRigidTranslationDoesNotChangePatchScale:
    true;
  notAuthorizedForArbitrary3dGeometry:
    true;
}

export interface ExtendedObjectProjectionTrajectory {
  objectId: string;
  timeReference:
    "caller-declared-common-reference-phase";
  projectionDistanceMm: number;
  objectTranslationVelocityMps:
    Vector3;
  cameraTranslationVelocityMps:
    Vector3;
  relativeTranslationVelocityMps:
    Vector3;
  rigidTranslationOnly: true;
  pointTrajectories:
    readonly ExtendedObjectPointProjectionTrajectory[];
  planarMagnificationDiagnostic:
    ExtendedObjectPlanarMagnificationDiagnostic | null;
  metricSceneDepthRequired: true;
  oneGlobalHomographyAuthorized:
    false;
  oneGlobalScaleAuthorizedForArbitrary3dGeometry:
    false;
  cameraRotationComposed: false;
  visibilityOcclusionModeled: false;
  deformationModeled: false;
  accelerationModeled: false;
  blurKernelCalculated: false;
  radianceIntegrated: false;
  timeVaryingDefocusMayBeRequired:
    boolean;
}

export interface CaptureExtendedObjectMetricPoint
  extends ExtendedObjectMetricPoint {
  /**
   * Native destination point. It selects the local exposure window (from the
   * capture exposure schedule) for this object point.
   */
  destinationPointNative:
    RasterPoint;
}

export interface CalculateCaptureExtendedObjectTemporalProjectionInput {
  objectId: string;
  timing:
    ResolvedCaptureModeTiming;
  focalLengthMm: number;
  focusDistanceM?: number;
  objectTranslationVelocityMps:
    Vector3;
  cameraTranslationVelocityMps:
    Vector3;
  temporalSampleCount: number;
  points:
    readonly CaptureExtendedObjectMetricPoint[];
  frontoparallelPlane?:
    ExtendedObjectFrontoparallelPlaneDeclaration;
}

export interface CaptureExtendedObjectTemporalNode
  extends ExtendedObjectProjectionNode {
  localExposurePhase: number;
  normalizedTimeWeight: number;
  timeMeasureSeconds: number;
}

export interface CaptureExtendedObjectPointTrajectory {
  pointId: string;
  destinationPointNative:
    RasterPoint;
  referencePositionCameraM:
    Vector3;
  referenceImagePointMm: {
    x: number;
    y: number;
  };
  localExposureWindow: {
    startSecondsFromCaptureReference:
      number;
    endSecondsFromCaptureReference:
      number;
    durationSeconds: number;
  };
  nodes:
    readonly CaptureExtendedObjectTemporalNode[];
}

export interface CaptureExtendedObjectTemporalProjection {
  objectId: string;
  timeReference:
    "first-opening-boundary-phase";
  timingProfileIdentity: {
    profileId: string;
    profileVersion: string;
    captureModeId: string;
  };
  projectionDistanceMm: number;
  temporalSampleCount: number;
  objectTranslationVelocityMps:
    Vector3;
  cameraTranslationVelocityMps:
    Vector3;
  relativeTranslationVelocityMps:
    Vector3;
  rigidTranslationOnly: true;
  pointTrajectories:
    readonly CaptureExtendedObjectPointTrajectory[];
  planarMagnificationDiagnosticAvailable:
    boolean;
  metricSceneDepthRequired: true;
  oneGlobalHomographyAuthorized:
    false;
  oneGlobalScaleAuthorizedForArbitrary3dGeometry:
    false;
  cameraRotationComposed: false;
  visibilityOcclusionModeled: false;
  deformationModeled: false;
  accelerationModeled: false;
  blurKernelCalculated: false;
  radianceIntegrated: false;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
  timeVaryingDefocusMayBeRequired:
    boolean;
}

function resolveProjectionDistanceMm(
  focalLengthMm: number,
  focusDistanceM:
    number | undefined
): number {
  requirePositiveFinite(
    "focalLengthMm",
    focalLengthMm
  );
  return focusDistanceM ===
    undefined
    ? focalLengthMm
    : calculateThinLensImageDistance({
        focalLengthMm,
        objectDistanceM:
          focusDistanceM
      }).value.imageDistanceMm;
}

function projectMetricPoint(
  positionCameraM:
    Vector3,
  projectionDistanceMm: number,
  path: string
): {
  x: number;
  y: number;
} {
  if (
    !Number.isFinite(
      positionCameraM.z
    ) ||
    positionCameraM.z <= 0
  ) {
    throw new InvalidScientificInputError(
      path +
        " must remain in front of the camera plane."
    );
  }

  const mapped = {
    x:
      projectionDistanceMm *
      (
        positionCameraM.x /
        positionCameraM.z
      ),
    y:
      projectionDistanceMm *
      (
        positionCameraM.y /
        positionCameraM.z
      )
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

function validateUniquePoints<T extends ExtendedObjectMetricPoint>(
  points: readonly T[]
): readonly {
  point:
    T;
  pointId: string;
  referencePosition:
    Vector3;
}[] {
  if (
    !Array.isArray(points) ||
    points.length === 0
  ) {
    throw new InvalidConfigurationError(
      "points must be a non-empty array."
    );
  }

  const parsed =
    points.map(
      (point, index) => {
        const path =
          "points[" +
          index +
          "]";
        requireInputObject(point, path);
        const pointId =
          requireNonEmptyString(
            point.pointId,
            path + ".pointId"
          );
        const referencePosition =
          requireFiniteVector(
            point.positionCameraM,
            path +
              ".positionCameraM"
          );
        if (
          referencePosition.z <= 0
        ) {
          throw new InvalidScientificInputError(
            path +
              ".positionCameraM.z must place the point in front of the camera."
          );
        }
        return {
          point,
          pointId,
          referencePosition
        };
      }
    );

  const ids =
    parsed.map(
      (entry) =>
        entry.pointId
    );
  if (
    new Set(ids).size !==
    ids.length
  ) {
    throw new InvalidScientificInputError(
      "points must not contain duplicate pointId values."
    );
  }
  return parsed;
}

function validateSampleTimes(
  times:
    readonly number[]
): readonly number[] {
  if (
    !Array.isArray(times) ||
    times.length === 0
  ) {
    throw new InvalidConfigurationError(
      "sampleTimesSecondsFromReference must be a non-empty array."
    );
  }
  let prior =
    Number.NEGATIVE_INFINITY;
  return times.map(
    (value, index) => {
      const time =
        requireFiniteTime(
          value,
          "sampleTimesSecondsFromReference[" +
            index +
            "]"
        );
      if (time <= prior) {
        throw new InvalidScientificInputError(
          "sampleTimesSecondsFromReference must be strictly increasing."
        );
      }
      prior = time;
      return time;
    }
  );
}

function relativeVelocity(
  objectVelocity:
    Vector3,
  cameraVelocity:
    Vector3
): Vector3 {
  return {
    x:
      objectVelocity.x -
      cameraVelocity.x,
    y:
      objectVelocity.y -
      cameraVelocity.y,
    z:
      objectVelocity.z -
      cameraVelocity.z
  };
}

function positionAtTime(
  reference:
    Vector3,
  velocity:
    Vector3,
  timeSeconds: number
): Vector3 {
  return {
    x:
      reference.x +
      velocity.x *
        timeSeconds,
    y:
      reference.y +
      velocity.y *
        timeSeconds,
    z:
      reference.z +
      velocity.z *
        timeSeconds
  };
}

function validatePlanarDeclaration(
  declaration:
    ExtendedObjectFrontoparallelPlaneDeclaration |
    undefined,
  points:
    readonly {
      referencePosition:
        Vector3;
    }[]
): number | null {
  if (
    declaration === undefined
  ) {
    return null;
  }
  requireInputObject(declaration, "frontoparallelPlane");
  if (
    declaration.kind !==
    "fronto-parallel-planar-patch"
  ) {
    throw new InvalidConfigurationError(
      "frontoparallelPlane.kind is invalid."
    );
  }
  requirePositiveFinite(
    "frontoparallelPlane.referenceDepthM",
    declaration.referenceDepthM
  );
  for (
    const entry of points
  ) {
    if (
      !approximatelyEqual(
        entry.referencePosition.z,
        declaration.referenceDepthM
      )
    ) {
      throw new InvalidScientificInputError(
        "Every declared fronto-parallel point must lie at frontoparallelPlane.referenceDepthM."
      );
    }
  }
  return declaration
    .referenceDepthM;
}

function createPointTrajectory(
  pointId: string,
  referencePosition:
    Vector3,
  relativeTranslationVelocityMps:
    Vector3,
  sampleTimes:
    readonly number[],
  projectionDistanceMm:
    number,
  planarReferenceDepthM:
    number | null,
  path: string
): ExtendedObjectPointProjectionTrajectory {
  const referenceImagePoint =
    projectMetricPoint(
      referencePosition,
      projectionDistanceMm,
      path +
        ".positionCameraM"
    );

  const nodes =
    sampleTimes.map(
      (
        timeSeconds,
        sampleIndex
      ) => {
        const position =
          positionAtTime(
            referencePosition,
            relativeTranslationVelocityMps,
            timeSeconds
          );
        const mapped =
          projectMetricPoint(
            position,
            projectionDistanceMm,
            path +
              ".positionAtTime"
          );
        const deltaX =
          mapped.x -
          referenceImagePoint.x;
        const deltaY =
          mapped.y -
          referenceImagePoint.y;

        return {
          sampleIndex,
          timeSecondsFromReference:
            timeSeconds,
          relativePositionCameraM:
            position,
          mappedImagePointMm:
            mapped,
          deltaFromReferenceImagePlaneMm: {
            x: deltaX,
            y: deltaY,
            distance:
              Math.hypot(
                deltaX,
                deltaY
              )
          },
          depthM:
            position.z,
          planarMagnificationScaleFromReference:
            planarReferenceDepthM ===
              null
              ? null
              : planarReferenceDepthM /
                position.z
        };
      }
    );

  return {
    pointId,
    referencePositionCameraM:
      referencePosition,
    referenceImagePointMm:
      referenceImagePoint,
    nodes
  };
}

/**
 * Evaluates multiple explicit metric points on one rigidly translating object
 * at deterministic physical times.
 *
 * This is geometry only. It does not build a blur kernel, decide visibility,
 * integrate radiance, deform the object, rotate the camera or apply a
 * universal scale.
 */
export function calculateExtendedObjectProjectionTrajectory(
  input:
    CalculateExtendedObjectProjectionTrajectoryInput
): CalculationResult<ExtendedObjectProjectionTrajectory> {
  requireInputKeys(input, "calculateExtendedObjectProjectionTrajectory", ["objectId", "focalLengthMm", "focusDistanceM", "objectTranslationVelocityMps", "cameraTranslationVelocityMps", "sampleTimesSecondsFromReference", "points", "frontoparallelPlane"]);
  const objectId =
    requireNonEmptyString(
      input.objectId,
      "objectId"
    );
  const projectionDistanceMm =
    resolveProjectionDistanceMm(
      input.focalLengthMm,
      input.focusDistanceM
    );
  const objectVelocity =
    requireFiniteVector(
      input
        .objectTranslationVelocityMps,
      "objectTranslationVelocityMps"
    );
  const cameraVelocity =
    requireFiniteVector(
      input
        .cameraTranslationVelocityMps,
      "cameraTranslationVelocityMps"
    );
  const relative =
    relativeVelocity(
      objectVelocity,
      cameraVelocity
    );
  const sampleTimes =
    validateSampleTimes(
      input
        .sampleTimesSecondsFromReference
    );
  const points =
    validateUniquePoints(
      input.points
    );
  const planarDepth =
    validatePlanarDeclaration(
      input.frontoparallelPlane,
      points
    );

  const pointTrajectories =
    points.map(
      (
        entry,
        pointIndex
      ) =>
        createPointTrajectory(
          entry.pointId,
          entry.referencePosition,
          relative,
          sampleTimes,
          projectionDistanceMm,
          planarDepth,
          "points[" +
            pointIndex +
            "]"
        )
    );

  const scaleByTime =
    planarDepth === null
      ? null
      : sampleTimes.map(
          (
            timeSeconds,
            sampleIndex
          ) => {
            const currentDepth =
              planarDepth +
              relative.z *
                timeSeconds;
            if (
              currentDepth <= 0
            ) {
              throw new InvalidScientificInputError(
                "Declared fronto-parallel patch reaches or crosses the camera plane."
              );
            }
            return {
              sampleIndex,
              timeSecondsFromReference:
                timeSeconds,
              scaleFromReference:
                planarDepth /
                currentDepth
            };
          }
        );

  return approximationResult(
    {
      objectId,
      timeReference:
        "caller-declared-common-reference-phase",
      projectionDistanceMm,
      objectTranslationVelocityMps:
        objectVelocity,
      cameraTranslationVelocityMps:
        cameraVelocity,
      relativeTranslationVelocityMps:
        relative,
      rigidTranslationOnly: true,
      pointTrajectories,
      planarMagnificationDiagnostic:
        scaleByTime === null
          ? null
          : {
              geometry:
                "declared-fronto-parallel-planar-patch",
              referenceDepthM:
                planarDepth!,
              uniformScaleAuthorizedWithinDeclaredPatch:
                true,
              scaleByTime,
              lateralRigidTranslationDoesNotChangePatchScale:
                true,
              notAuthorizedForArbitrary3dGeometry:
                true
            },
      metricSceneDepthRequired:
        true,
      oneGlobalHomographyAuthorized:
        false,
      oneGlobalScaleAuthorizedForArbitrary3dGeometry:
        false,
      cameraRotationComposed:
        false,
      visibilityOcclusionModeled:
        false,
      deformationModeled: false,
      accelerationModeled: false,
      blurKernelCalculated:
        false,
      radianceIntegrated: false,
      timeVaryingDefocusMayBeRequired:
        relative.z !== 0
    },
    "extended-object-time-varying-projection",
    "1.0.0",
    [
      "Every object point is projected independently from explicit metric camera-space depth.",
      "Object and camera translation remain separate inputs and compose only as object-minus-camera relative translation.",
      "One global homography or one global scale is not authorized for arbitrary 3D geometry.",
      "A uniform magnification diagnostic is emitted only for an explicitly declared and validated fronto-parallel planar patch under the shared rigid-translation model.",
      "Constant rigid translation is the only object motion modeled; acceleration, rotation, articulation and deformation are excluded.",
      "Visibility, occlusion/disocclusion, frame-boundary coverage, radiance integration and blur-kernel synthesis remain downstream.",
      "When relative Z translation is nonzero, downstream defocus/PSF state may also vary with time."
    ]
  );
}

function localExposureForPoint(
  timing:
    ResolvedCaptureModeTiming,
  point:
    RasterPoint
): ResolvedCaptureModeTiming["exposureWindows"]["samples"][number] {
  requireInputObject(timing, "timing");
  requireInputObject(timing.exposureWindows, "timing.exposureWindows");
  if (!Array.isArray(timing.exposureWindows.samples)) throw new InvalidConfigurationError("timing.exposureWindows.samples must be an array.");
  timing.exposureWindows.samples.forEach((sample, index) => {
    requireInputObject(sample, "timing.exposureWindows.samples[" + index + "]");
    requireInputObject(sample.pointNative, "timing.exposureWindows.samples[" + index + "].pointNative");
  });
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
      "Each extended-object capture point must match exactly one committed exposure-window sample point."
    );
  }
  return matches[0]!;
}

/**
 * Evaluates extended-object projection at deterministic midpoint time samples
 * inside each point's local exposure window (from the capture exposure
 * schedule).
 */
export function calculateCaptureExtendedObjectTemporalProjection(
  input:
    CalculateCaptureExtendedObjectTemporalProjectionInput
): CalculationResult<CaptureExtendedObjectTemporalProjection> {
  requireInputKeys(input, "calculateCaptureExtendedObjectTemporalProjection", ["objectId", "timing", "focalLengthMm", "focusDistanceM", "objectTranslationVelocityMps", "cameraTranslationVelocityMps", "temporalSampleCount", "points", "frontoparallelPlane"]);
  requirePositiveInteger(
    "temporalSampleCount",
    input.temporalSampleCount
  );
  const objectId =
    requireNonEmptyString(
      input.objectId,
      "objectId"
    );
  const projectionDistanceMm =
    resolveProjectionDistanceMm(
      input.focalLengthMm,
      input.focusDistanceM
    );
  const objectVelocity =
    requireFiniteVector(
      input
        .objectTranslationVelocityMps,
      "objectTranslationVelocityMps"
    );
  const cameraVelocity =
    requireFiniteVector(
      input
        .cameraTranslationVelocityMps,
      "cameraTranslationVelocityMps"
    );
  const relative =
    relativeVelocity(
      objectVelocity,
      cameraVelocity
    );
  const points =
    validateUniquePoints(
      input.points
    );
  const planarDepth =
    validatePlanarDeclaration(
      input.frontoparallelPlane,
      points
    );

  const totalNodeCount =
    input.temporalSampleCount *
    points.length;
  if (
    !Number.isSafeInteger(
      totalNodeCount
    )
  ) {
    throw new InvalidScientificInputError(
      "temporalSampleCount × points.length must remain a safe integer."
    );
  }

  const pointTrajectories =
    points.map(
      (
        entry,
        pointIndex
      ) => {
        const capturePoint =
          entry.point as
            CaptureExtendedObjectMetricPoint;
        const exposure =
          localExposureForPoint(
            input.timing,
            capturePoint
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
            "Extended-object capture projection requires a positive finite local exposure duration."
          );
        }

        const times =
          Array.from(
            {
              length:
                input.temporalSampleCount
            },
            (
              _,
              temporalSampleIndex
            ) =>
              exposure
                .startOffsetSecondsFromOpeningReference +
              (
                temporalSampleIndex +
                0.5
              ) /
                input.temporalSampleCount *
                duration
          );
        const trajectory =
          createPointTrajectory(
            entry.pointId,
            entry.referencePosition,
            relative,
            times,
            projectionDistanceMm,
            planarDepth,
            "points[" +
              pointIndex +
              "]"
          );
        const normalizedTimeWeight =
          1 /
          input.temporalSampleCount;
        const timeMeasureSeconds =
          duration /
          input.temporalSampleCount;

        return {
          pointId:
            entry.pointId,
          destinationPointNative: {
            ...capturePoint
              .destinationPointNative
          },
          referencePositionCameraM:
            trajectory
              .referencePositionCameraM,
          referenceImagePointMm:
            trajectory
              .referenceImagePointMm,
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
          nodes:
            trajectory.nodes.map(
              (
                node,
                temporalSampleIndex
              ) => ({
                ...node,
                localExposurePhase:
                  (
                    temporalSampleIndex +
                    0.5
                  ) /
                  input
                    .temporalSampleCount,
                normalizedTimeWeight,
                timeMeasureSeconds
              })
            )
        };
      }
    );

  return approximationResult(
    {
      objectId,
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
      projectionDistanceMm,
      temporalSampleCount:
        input.temporalSampleCount,
      objectTranslationVelocityMps:
        objectVelocity,
      cameraTranslationVelocityMps:
        cameraVelocity,
      relativeTranslationVelocityMps:
        relative,
      rigidTranslationOnly: true,
      pointTrajectories,
      planarMagnificationDiagnosticAvailable:
        planarDepth !== null,
      metricSceneDepthRequired:
        true,
      oneGlobalHomographyAuthorized:
        false,
      oneGlobalScaleAuthorizedForArbitrary3dGeometry:
        false,
      cameraRotationComposed:
        false,
      visibilityOcclusionModeled:
        false,
      deformationModeled: false,
      accelerationModeled: false,
      blurKernelCalculated:
        false,
      radianceIntegrated: false,
      sensorReadoutTimingUsedAsExposureTiming:
        false,
      timeVaryingDefocusMayBeRequired:
        relative.z !== 0
    },
    "capture-local-extended-object-time-varying-projection",
    "1.0.0",
    [
      "Every point is evaluated at deterministic midpoint nodes in its own authoritative local exposure interval of the exposure-window model.",
      "Sensor data-readout timing is not substituted for exposure time.",
      "Rolling/local exposure may cause different native destinations to integrate different portions of the same rigid object trajectory.",
      "The result remains geometry only and does not authorize endpoint interpolation as a complete visibility/radiance blur solution.",
      "Camera rotation and subject deformation remain separate; object and camera translation compose only through explicit relative translation.",
      "When relative depth changes, downstream defocus/PSF evaluation may need to vary at the same physical-time nodes."
    ]
  );
}
