// SPDX-License-Identifier: Apache-2.0

/**
 * Estimates blur on the sensor from a simple handheld-shake profile: the camera turns at a constant
 * angular velocity. An optional stabilization rating reduces that motion.
 *
 * With focusDistanceM, angular motion is projected using the ideal thin-lens sensor distance, like
 * the other focus-aware projection functions. Without it, the nominal focal length is used, which
 * keeps the older approximation.
 *
 * The optical projection is physically calculated. But turning a stabilization rating in stops into
 * residual angular motion by 2^-stops is an educational approximation. It is not a CIPA DC-011
 * measurement or a real-camera rating.
 * @see docs/STABILIZATION.md for the equations, units, coordinate conventions, known blockers and
 * support limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite
} from "../core/validation.js";
import { portableHypot } from "../core/portable-math.js";
import { calculateThinLensImageDistance } from "../optics/thin-lens.js";
import { rejectUnknownFields, requireInputKeys, requireInputObject, assertNamedFinite as requireFinite } from "../core/record-validation.js";

export interface EstimateCameraShakeBlurInput {
  focalLengthMm: number;
  shutterSeconds: number;
  /**
   * Constant camera angular velocity in radians per second. Signs follow the
   * same physical right-hand rule as calculateCameraRotationImageMapping().
   * The camera axes are +X right, +Y up, +Z forward (a left-handed basis).
   * - Positive yaw turns the optical axis left and moves still image content
   *   toward +X.
   * - Positive pitch tilts the optical axis up and moves still image content
   *   toward -Y.
   */
  angularVelocityRadPerSec: {
    yaw: number;
    pitch: number;
  };
  stabilizationStopsEquivalent: number;
  /** Optional focus distance in metres for focus-aware sensor-plane projection. */
  focusDistanceM?: number;
  pixelPitchMicrometers?: number;
}

/**
 * How far a still world point on the optical axis moves in the image during
 * the exposure, in image-plane axes (+X right, +Y up). For a single axis it
 * equals the deltaMm from calculateCameraRotationImageMapping() at the
 * optical axis.
 */
export interface CameraShakeBlurSample {
  /** +X-right image displacement in millimetres: +d·tan(yaw·t). */
  deltaXmm: number;
  /** +Y-up image displacement in millimetres: -d·tan(pitch·t). */
  deltaYmm: number;
  distanceMm: number;
  distancePixels?: number;
  deltaXPixels?: number;
  deltaYPixels?: number;
}

export interface CameraShakeEstimate {
  residualMotionFactor: number;
  projectionDistanceMm: number;
  unstabilized: CameraShakeBlurSample;
  stabilized: CameraShakeBlurSample;
}

function projectAngularDisplacement(
  projectionDistanceMm: number,
  yawRad: number,
  pitchRad: number,
  pixelPitchMicrometers?: number
): CameraShakeBlurSample {
  // Physical right-hand rule in the left-handed camera basis: positive yaw
  // (turn left) moves content toward +X; positive pitch (tilt up) toward -Y.
  const deltaXmm = projectionDistanceMm * Math.tan(yawRad);
  // "0 -" keeps zero pitch at +0 rather than -0.
  const deltaYmm = 0 - projectionDistanceMm * Math.tan(pitchRad);
  const distanceMm = portableHypot(deltaXmm, deltaYmm);

  if (pixelPitchMicrometers === undefined) {
    return { deltaXmm, deltaYmm, distanceMm };
  }

  const pitchMm = pixelPitchMicrometers / 1000;
  return {
    deltaXmm,
    deltaYmm,
    distanceMm,
    distancePixels: distanceMm / pitchMm,
    deltaXPixels: deltaXmm / pitchMm,
    deltaYPixels: deltaYmm / pitchMm
  };
}

/**
 * Estimates blur on the sensor from a simple handheld-shake profile, where
 * the camera turns at a constant angular velocity. An optional stabilization
 * rating reduces that motion.
 *
 * With focusDistanceM, angular motion is projected using the ideal thin-lens
 * sensor distance, like the other focus-aware projection functions. Without
 * it, the nominal focal length is used, which keeps the older approximation.
 *
 * The optical projection is physically calculated. But turning a
 * stabilization rating in stops into residual angular motion by 2^-stops is
 * an educational approximation. It is not a CIPA DC-011 measurement or a
 * real-camera rating.
 *
 * Each axis's rotation during the exposure must stay below a quarter turn
 * (π/2 rad).
 */
export function estimateCameraShakeBlur(
  input: EstimateCameraShakeBlurInput
): CalculationResult<CameraShakeEstimate> {
  requireInputKeys(input, "estimateCameraShakeBlur", ["focalLengthMm", "shutterSeconds", "angularVelocityRadPerSec", "stabilizationStopsEquivalent", "focusDistanceM", "pixelPitchMicrometers"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requirePositiveFinite("shutterSeconds", input.shutterSeconds);
  requireInputObject(input.angularVelocityRadPerSec, "angularVelocityRadPerSec");
  rejectUnknownFields(input.angularVelocityRadPerSec, ["yaw", "pitch"], "angularVelocityRadPerSec");
  requireFinite(
    "angularVelocityRadPerSec.yaw",
    input.angularVelocityRadPerSec.yaw
  );
  requireFinite(
    "angularVelocityRadPerSec.pitch",
    input.angularVelocityRadPerSec.pitch
  );

  if (
    !Number.isFinite(input.stabilizationStopsEquivalent) ||
    input.stabilizationStopsEquivalent < 0
  ) {
    throw new InvalidScientificInputError(
      "stabilizationStopsEquivalent must be finite and greater than or equal to zero."
    );
  }

  if (input.pixelPitchMicrometers !== undefined) {
    requirePositiveFinite(
      "pixelPitchMicrometers",
      input.pixelPitchMicrometers
    );
  }

  const focusProjection =
    input.focusDistanceM === undefined
      ? undefined
      : calculateThinLensImageDistance({
          focalLengthMm: input.focalLengthMm,
          objectDistanceM: input.focusDistanceM
        });
  const projectionDistanceMm =
    focusProjection?.value.imageDistanceMm ?? input.focalLengthMm;
  const yawRad =
    input.angularVelocityRadPerSec.yaw * input.shutterSeconds;
  const pitchRad =
    input.angularVelocityRadPerSec.pitch * input.shutterSeconds;
  // tan() flips sign past a quarter turn, which would break the sign
  // convention. The rotation mapping likewise rejects a world ray that maps to
  // or behind the camera plane.
  if (Math.abs(yawRad) >= Math.PI / 2 || Math.abs(pitchRad) >= Math.PI / 2) {
    throw new InvalidScientificInputError(
      "Camera-shake rotation over the exposure must stay below a quarter turn (|angular velocity × shutterSeconds| < π/2 rad) on each axis."
    );
  }
  const residualMotionFactor =
    2 ** -input.stabilizationStopsEquivalent;

  return approximationResult(
    {
      residualMotionFactor,
      projectionDistanceMm,
      unstabilized: projectAngularDisplacement(
        projectionDistanceMm,
        yawRad,
        pitchRad,
        input.pixelPitchMicrometers
      ),
      stabilized: projectAngularDisplacement(
        projectionDistanceMm,
        yawRad * residualMotionFactor,
        pitchRad * residualMotionFactor,
        input.pixelPitchMicrometers
      )
    },
    focusProjection === undefined
      ? "constant-angular-velocity-stabilization-equivalent"
      : "focus-aware-constant-angular-velocity-stabilization-equivalent",
    "2.0.0",
    [
      "Camera rotation is constant during the exposure",
      focusProjection === undefined
        ? "Nominal focal length is used as the infinity-focus projection distance"
        : "Thin-lens image distance for the selected focus plane is used as the projection distance",
      "Yaw and pitch are treated independently",
      "Positive yaw/pitch follow the physical right-hand rule about camera +Y/+X (yaw left moves content toward +X; pitch up moves content toward -Y)",
      "Equivalent stabilization stops attenuate angular displacement by 2^-stops",
      "This is not a CIPA DC-011 compliance measurement",
      "Roll, translation, subject motion, and stabilization limits are not modeled"
    ]
  );
}
