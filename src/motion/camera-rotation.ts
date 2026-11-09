// SPDX-License-Identifier: Apache-2.0

/**
 * Where a still point in the world appears on the image plane while the camera rotates.
 *
 * Forward mapping: given the point's image position at exposure start (t=0), find its image position
 * at a later time t.
 * - The starting image point defines the world ray in the camera frame at t=0.
 * - Constant angular velocity is integrated as a single axis-angle rotation vector. This avoids any
 *   dependence on Euler-angle order.
 * - The world ray is expressed in the rotated camera frame with the inverse camera rotation, then
 *   projected rectilinearly back onto the image plane.
 * Only rotation is modelled. Camera translation is deliberately left out, because the image motion it
 * causes (optical flow) depends on scene depth.
 *
 * Inverse mapping: given a ray captured at a non-negative time, find where it was at exposure start.
 * For this constant-axis, pure-rotation model the inverse is analytic: apply the forward camera
 * rotation to the captured ray, then project rectilinearly. No iterative solver is needed.
 * @see docs/MOTION_AND_SIGNAL.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite
} from "../core/validation.js";
import { calculateThinLensImageDistance } from "../optics/thin-lens.js";
import { rejectUnknownFields, requireInputKeys, requireInputObject, assertNamedFinite as requireFinite } from "../core/record-validation.js";

/** Checks the nested objects of a rotation-mapping input before any of their fields are read. */
function requireRotationMappingSubObjects(input: {
  imagePointMm: unknown; angularVelocityRadPerSec: unknown; samplingPitchMicrometers?: unknown;
}): void {
  requireInputObject(input.imagePointMm, "imagePointMm");
  rejectUnknownFields(input.imagePointMm as object, ["x", "y"], "imagePointMm");
  requireInputObject(input.angularVelocityRadPerSec, "angularVelocityRadPerSec");
  rejectUnknownFields(input.angularVelocityRadPerSec as object, ["pitch", "yaw", "roll"], "angularVelocityRadPerSec");
  if (input.samplingPitchMicrometers !== undefined) {
    requireInputObject(input.samplingPitchMicrometers, "samplingPitchMicrometers");
    rejectUnknownFields(input.samplingPitchMicrometers as object, ["x", "y"], "samplingPitchMicrometers");
  }
}

/**
 * Camera angular velocity in radians per second about the exposure-start
 * camera axes (+X right, +Y up, +Z forward along the optical axis).
 *
 * Signs follow the physical right-hand rule about each named axis. These axes
 * form a left-handed basis. So a positive rotation is the mirror image of what
 * the plain component Rodrigues (cross-product) formula would give in it:
 *
 * - Positive pitch tilts the optical axis up. Still scene content moves
 *   toward image -Y (down).
 * - Positive yaw turns the optical axis left (counter-clockwise seen from
 *   above). Still scene content moves toward image +X (right).
 * - Positive roll turns the camera clockwise, as seen by the photographer
 *   looking along +Z. Still scene content rotates counter-clockwise in the
 *   +X-right/+Y-up image plane.
 */
export interface CameraAngularVelocityRadPerSec {
  /** Right-hand rotation rate about camera +X (right): positive tilts the optical axis up. */
  pitch: number;
  /** Right-hand rotation rate about camera +Y (up): positive turns the optical axis left. */
  yaw: number;
  /** Right-hand rotation rate about camera +Z (forward): positive rolls the camera clockwise as seen from behind it. */
  roll: number;
}

export interface ImagePlanePointMm {
  /** Image-plane X coordinate relative to the optical axis, in millimetres. */
  x: number;
  /** Image-plane Y coordinate relative to the optical axis, in millimetres. */
  y: number;
}

export interface AxisSamplingPitchMicrometers {
  x: number;
  y: number;
}

export interface CalculateCameraRotationImageMappingInput {
  /** Physical focal length in millimetres. */
  focalLengthMm: number;
  /**
   * Stationary-world-ray image-plane position at exposure start.
   *
   * Image-plane coordinates have their origin on the optical axis, +X right, +Y up.
   */
  imagePointMm: ImagePlanePointMm;
  /**
   * Time in seconds from exposure start. Must be greater than or equal to zero.
   */
  timeSecondsFromExposureStart: number;
  /**
   * Constant camera angular-velocity vector in radians per second.
   *
   * Components are given in the camera axes at exposure start and follow the
   * physical right-hand rule:
   * - pitch about +X: positive tilts up; content moves toward image -Y;
   * - yaw about +Y: positive turns left; content moves toward image +X;
   * - roll about +Z: positive is clockwise seen from behind the camera.
   * See CameraAngularVelocityRadPerSec.
   */
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  /** Optional focus distance in metres for thin-lens projection distance. */
  focusDistanceM?: number;
  /**
   * Optional sampling pitch per axis, used to also report the displacement in
   * samples. This is the geometric spacing of samples, not the light-collecting
   * area of a photosite.
   */
  samplingPitchMicrometers?: AxisSamplingPitchMicrometers;
}

export interface CameraRotationImageMapping {
  projectionDistanceMm: number;
  timeSecondsFromExposureStart: number;
  angularDisplacementRad: {
    pitch: number;
    yaw: number;
    roll: number;
    magnitude: number;
  };
  startImagePointMm: ImagePlanePointMm;
  mappedImagePointMm: ImagePlanePointMm;
  deltaMm: {
    x: number;
    y: number;
    distance: number;
  };
  /**
   * Optional displacement in samples, in image-plane axes (+X right, +Y up).
   * This is not a vector in native raster axes.
   */
  deltaImagePlaneSamples?: {
    x: number;
    y: number;
    distance: number;
  };
}

export interface CalculateInverseCameraRotationImageMappingInput {
  /** Physical focal length in millimetres. */
  focalLengthMm: number;
  /**
   * Captured image-plane location of a stationary world ray at the requested
   * time. Coordinates have their origin on the optical axis, +X right, +Y up.
   */
  imagePointMm: ImagePlanePointMm;
  /**
   * Capture time in seconds from exposure start. Must be greater than or equal
   * to zero.
   */
  timeSecondsFromExposureStart: number;
  /**
   * Constant camera angular-velocity vector in radians per second, with the
   * same sign/axis semantics as calculateCameraRotationImageMapping().
   */
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  /** Optional focus distance in metres for thin-lens projection distance. */
  focusDistanceM?: number;
  /**
   * Optional sampling pitch per axis, used to also report the inverse
   * displacement in samples.
   */
  samplingPitchMicrometers?: AxisSamplingPitchMicrometers;
}

export interface InverseCameraRotationImageMapping {
  projectionDistanceMm: number;
  timeSecondsFromExposureStart: number;
  angularDisplacementRad: {
    pitch: number;
    yaw: number;
    roll: number;
    magnitude: number;
  };
  capturedImagePointMm: ImagePlanePointMm;
  referenceImagePointMm: ImagePlanePointMm;
  /**
   * Reference-minus-captured displacement in the image-plane basis.
   */
  deltaMm: {
    x: number;
    y: number;
    distance: number;
  };
  deltaImagePlaneSamples?: {
    x: number;
    y: number;
    distance: number;
  };
}

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

function requireNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidScientificInputError(
      `${name} must be finite and greater than or equal to zero.`
    );
  }
}

/**
 * Internal Rodrigues rotation in component form:
 * v cos a + (k x v) sin a + k (k . v)(1 - cos a), with the cross product
 * computed by its usual component formula. In the left-handed camera basis
 * this is a physical left-hand rotation. Camera-rotation code must call
 * applyPhysicalCameraRotation() instead, so the right-hand sign convention
 * lives in one place.
 */
export function rotateVectorByAxisAngle(
  vector: Vector3,
  axis: Vector3,
  angleRad: number
): Vector3 {
  if (angleRad === 0) {
    return { ...vector };
  }

  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  const oneMinusCosine = 1 - cosine;
  const dot =
    axis.x * vector.x +
    axis.y * vector.y +
    axis.z * vector.z;
  const cross = {
    x: axis.y * vector.z - axis.z * vector.y,
    y: axis.z * vector.x - axis.x * vector.z,
    z: axis.x * vector.y - axis.y * vector.x
  };

  return {
    x:
      vector.x * cosine +
      cross.x * sine +
      axis.x * dot * oneMinusCosine,
    y:
      vector.y * cosine +
      cross.y * sine +
      axis.y * dot * oneMinusCosine,
    z:
      vector.z * cosine +
      cross.z * sine +
      axis.z * dot * oneMinusCosine
  };
}

/**
 * Internal: applies the physical camera rotation for one right-hand angular
 * displacement (pitch/yaw/roll about camera +X/+Y/+Z, radians) to a vector in
 * camera components.
 *
 * - "camera-to-reference" applies R: a ray expressed in the rotated camera
 *   frame is re-expressed in the exposure-start (reference) camera frame.
 * - "reference-to-camera" applies R^-1: a stationary reference ray is
 *   expressed in the rotated camera frame.
 *
 * Because the camera basis is left-handed, the physical right-hand rotation R
 * is the component Rodrigues formula with the angle negated.
 */
export function applyPhysicalCameraRotation(
  vector: Vector3,
  angularDisplacementRad: { pitch: number; yaw: number; roll: number },
  direction: "camera-to-reference" | "reference-to-camera"
): Vector3 {
  const magnitude = Math.hypot(
    angularDisplacementRad.pitch,
    angularDisplacementRad.yaw,
    angularDisplacementRad.roll
  );
  if (magnitude === 0) {
    return { ...vector };
  }
  const axis = {
    x: angularDisplacementRad.pitch / magnitude,
    y: angularDisplacementRad.yaw / magnitude,
    z: angularDisplacementRad.roll / magnitude
  };
  return rotateVectorByAxisAngle(
    vector,
    axis,
    direction === "camera-to-reference" ? -magnitude : magnitude
  );
}

/** Internal: projection distance, shared with the lean native environment executor. Not exported from the package root. */
export function resolveProjectionDistanceMm(
  focalLengthMm: number,
  focusDistanceM: number | undefined
): {
  projectionDistanceMm: number;
  focusAware: boolean;
} {
  const projection =
    focusDistanceM === undefined
      ? undefined
      : calculateThinLensImageDistance({
          focalLengthMm,
          objectDistanceM: focusDistanceM
        });

  return {
    projectionDistanceMm:
      projection?.value.imageDistanceMm ?? focalLengthMm,
    focusAware: projection !== undefined
  };
}

/**
 * Maps one stationary-world ray to its image-plane location after pure camera
 * rotation at an arbitrary physical time from exposure start.
 *
 * The starting image point defines the world ray in the camera frame at t=0.
 * Constant angular velocity is integrated as a single axis-angle rotation
 * vector, which avoids any dependence on Euler-angle order. The world ray is
 * then expressed in the rotated camera frame with the inverse camera rotation,
 * and projected rectilinearly back onto the image plane.
 *
 * Only rotation is modelled. Camera translation is deliberately left out,
 * because the image motion it causes depends on scene depth.
 *
 * @returns Field-position-dependent image-plane mapping and displacement.
 */
export function calculateCameraRotationImageMapping(
  input: CalculateCameraRotationImageMappingInput
): CalculationResult<CameraRotationImageMapping> {
  requireInputKeys(input, "calculateCameraRotationImageMapping", ["focalLengthMm", "imagePointMm", "timeSecondsFromExposureStart", "angularVelocityRadPerSec", "focusDistanceM", "samplingPitchMicrometers"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requireRotationMappingSubObjects(input);
  requireFinite("imagePointMm.x", input.imagePointMm.x);
  requireFinite("imagePointMm.y", input.imagePointMm.y);
  requireNonNegativeFinite(
    "timeSecondsFromExposureStart",
    input.timeSecondsFromExposureStart
  );
  requireFinite(
    "angularVelocityRadPerSec.pitch",
    input.angularVelocityRadPerSec.pitch
  );
  requireFinite(
    "angularVelocityRadPerSec.yaw",
    input.angularVelocityRadPerSec.yaw
  );
  requireFinite(
    "angularVelocityRadPerSec.roll",
    input.angularVelocityRadPerSec.roll
  );

  if (input.samplingPitchMicrometers !== undefined) {
    requirePositiveFinite(
      "samplingPitchMicrometers.x",
      input.samplingPitchMicrometers.x
    );
    requirePositiveFinite(
      "samplingPitchMicrometers.y",
      input.samplingPitchMicrometers.y
    );
  }

  const { projectionDistanceMm, focusAware } =
    resolveProjectionDistanceMm(
      input.focalLengthMm,
      input.focusDistanceM
    );

  const angularDisplacementRad = {
    pitch:
      input.angularVelocityRadPerSec.pitch *
      input.timeSecondsFromExposureStart,
    yaw:
      input.angularVelocityRadPerSec.yaw *
      input.timeSecondsFromExposureStart,
    roll:
      input.angularVelocityRadPerSec.roll *
      input.timeSecondsFromExposureStart
  };
  const angularMagnitude = Math.hypot(
    angularDisplacementRad.pitch,
    angularDisplacementRad.yaw,
    angularDisplacementRad.roll
  );

  const initialRay: Vector3 = {
    x: input.imagePointMm.x / projectionDistanceMm,
    y: input.imagePointMm.y / projectionDistanceMm,
    z: 1
  };

  const mappedRay = applyPhysicalCameraRotation(
    initialRay,
    angularDisplacementRad,
    "reference-to-camera"
  );

  if (!Number.isFinite(mappedRay.z) || mappedRay.z <= 0) {
    throw new InvalidScientificInputError(
      "Camera rotation maps the requested world ray to or behind the camera plane."
    );
  }

  const mappedImagePointMm = {
    x: projectionDistanceMm * (mappedRay.x / mappedRay.z),
    y: projectionDistanceMm * (mappedRay.y / mappedRay.z)
  };
  const deltaMm = {
    x: mappedImagePointMm.x - input.imagePointMm.x,
    y: mappedImagePointMm.y - input.imagePointMm.y,
    distance: Math.hypot(
      mappedImagePointMm.x - input.imagePointMm.x,
      mappedImagePointMm.y - input.imagePointMm.y
    )
  };

  let deltaImagePlaneSamples:
    | {
        x: number;
        y: number;
        distance: number;
      }
    | undefined;
  if (input.samplingPitchMicrometers !== undefined) {
    const pitchXmm = input.samplingPitchMicrometers.x / 1000;
    const pitchYmm = input.samplingPitchMicrometers.y / 1000;
    const sampleX = deltaMm.x / pitchXmm;
    const sampleY = deltaMm.y / pitchYmm;
    deltaImagePlaneSamples = {
      x: sampleX,
      y: sampleY,
      distance: Math.hypot(sampleX, sampleY)
    };
  }

  return calculatedResult(
    {
      projectionDistanceMm,
      timeSecondsFromExposureStart:
        input.timeSecondsFromExposureStart,
      angularDisplacementRad: {
        ...angularDisplacementRad,
        magnitude: angularMagnitude
      },
      startImagePointMm: { ...input.imagePointMm },
      mappedImagePointMm,
      deltaMm,
      ...(deltaImagePlaneSamples === undefined
        ? {}
        : { deltaImagePlaneSamples })
    },
    focusAware
      ? "focus-aware-spatial-camera-rotation-mapping"
      : "spatial-camera-rotation-mapping",
    "2.0.0",
    [
      "Ideal rectilinear projection",
      focusAware
        ? "Thin-lens image distance for the selected focus plane is used as the projection distance"
        : "Nominal focal length is used as the infinity-focus projection distance",
      "Camera angular velocity is constant during the evaluated interval",
      "Angular velocity components are resolved in the camera axes at exposure start and integrated as one axis-angle vector",
      "Positive pitch/yaw/roll follow the physical right-hand rule about camera +X/+Y/+Z (pitch up, yaw left, roll clockwise seen from behind); the camera basis is left-handed",
      "The world ray is stationary; subject motion is not included",
      "Camera translation and depth-dependent parallax are not modeled",
      "The stationary world ray is transformed by the inverse camera rotation before rectilinear projection"
    ]
  );
}

/**
 * Maps a captured stationary-world ray at one non-negative capture time back
 * to its image-plane location at exposure start.
 *
 * For this constant-axis, pure-rotation model the inverse is analytic: apply
 * the forward camera rotation to the captured ray, then project
 * rectilinearly. No iterative solver is needed.
 */
export function calculateInverseCameraRotationImageMapping(
  input: CalculateInverseCameraRotationImageMappingInput
): CalculationResult<InverseCameraRotationImageMapping> {
  requireInputKeys(input, "calculateInverseCameraRotationImageMapping", ["focalLengthMm", "imagePointMm", "timeSecondsFromExposureStart", "angularVelocityRadPerSec", "focusDistanceM", "samplingPitchMicrometers"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requireRotationMappingSubObjects(input);
  requireFinite("imagePointMm.x", input.imagePointMm.x);
  requireFinite("imagePointMm.y", input.imagePointMm.y);
  requireNonNegativeFinite(
    "timeSecondsFromExposureStart",
    input.timeSecondsFromExposureStart
  );
  requireFinite(
    "angularVelocityRadPerSec.pitch",
    input.angularVelocityRadPerSec.pitch
  );
  requireFinite(
    "angularVelocityRadPerSec.yaw",
    input.angularVelocityRadPerSec.yaw
  );
  requireFinite(
    "angularVelocityRadPerSec.roll",
    input.angularVelocityRadPerSec.roll
  );

  if (input.samplingPitchMicrometers !== undefined) {
    requirePositiveFinite(
      "samplingPitchMicrometers.x",
      input.samplingPitchMicrometers.x
    );
    requirePositiveFinite(
      "samplingPitchMicrometers.y",
      input.samplingPitchMicrometers.y
    );
  }

  const { projectionDistanceMm, focusAware } =
    resolveProjectionDistanceMm(
      input.focalLengthMm,
      input.focusDistanceM
    );

  const angularDisplacementRad = {
    pitch:
      input.angularVelocityRadPerSec.pitch *
      input.timeSecondsFromExposureStart,
    yaw:
      input.angularVelocityRadPerSec.yaw *
      input.timeSecondsFromExposureStart,
    roll:
      input.angularVelocityRadPerSec.roll *
      input.timeSecondsFromExposureStart
  };
  const angularMagnitude = Math.hypot(
    angularDisplacementRad.pitch,
    angularDisplacementRad.yaw,
    angularDisplacementRad.roll
  );

  const capturedRay: Vector3 = {
    x: input.imagePointMm.x / projectionDistanceMm,
    y: input.imagePointMm.y / projectionDistanceMm,
    z: 1
  };

  const referenceRay = applyPhysicalCameraRotation(
    capturedRay,
    angularDisplacementRad,
    "camera-to-reference"
  );

  if (!Number.isFinite(referenceRay.z) || referenceRay.z <= 0) {
    throw new InvalidScientificInputError(
      "Inverse camera rotation maps the requested captured ray to or behind the reference camera plane."
    );
  }

  const referenceImagePointMm = {
    x: projectionDistanceMm * (referenceRay.x / referenceRay.z),
    y: projectionDistanceMm * (referenceRay.y / referenceRay.z)
  };
  const deltaMm = {
    x: referenceImagePointMm.x - input.imagePointMm.x,
    y: referenceImagePointMm.y - input.imagePointMm.y,
    distance: Math.hypot(
      referenceImagePointMm.x - input.imagePointMm.x,
      referenceImagePointMm.y - input.imagePointMm.y
    )
  };

  let deltaImagePlaneSamples:
    | {
        x: number;
        y: number;
        distance: number;
      }
    | undefined;
  if (input.samplingPitchMicrometers !== undefined) {
    const pitchXmm = input.samplingPitchMicrometers.x / 1000;
    const pitchYmm = input.samplingPitchMicrometers.y / 1000;
    const sampleX = deltaMm.x / pitchXmm;
    const sampleY = deltaMm.y / pitchYmm;
    deltaImagePlaneSamples = {
      x: sampleX,
      y: sampleY,
      distance: Math.hypot(sampleX, sampleY)
    };
  }

  return calculatedResult(
    {
      projectionDistanceMm,
      timeSecondsFromExposureStart:
        input.timeSecondsFromExposureStart,
      angularDisplacementRad: {
        ...angularDisplacementRad,
        magnitude: angularMagnitude
      },
      capturedImagePointMm: { ...input.imagePointMm },
      referenceImagePointMm,
      deltaMm,
      ...(deltaImagePlaneSamples === undefined
        ? {}
        : { deltaImagePlaneSamples })
    },
    focusAware
      ? "focus-aware-inverse-spatial-camera-rotation-mapping"
      : "inverse-spatial-camera-rotation-mapping",
    "2.0.0",
    [
      "Ideal rectilinear projection",
      focusAware
        ? "Thin-lens image distance for the selected focus plane is used as the projection distance"
        : "Nominal focal length is used as the infinity-focus projection distance",
      "Camera angular velocity is constant during the evaluated interval",
      "Angular velocity components are resolved in the camera axes at exposure start and integrated as one axis-angle vector",
      "Positive pitch/yaw/roll follow the physical right-hand rule about camera +X/+Y/+Z (pitch up, yaw left, roll clockwise seen from behind); the camera basis is left-handed",
      "The inverse is analytic under the same constant-axis pure-rotation model; no iterative solve is used",
      "The captured stationary-world ray is transformed by the forward camera rotation to recover its exposure-start reference ray",
      "Camera translation, scene depth parallax and subject motion are not modeled"
    ]
  );
}
