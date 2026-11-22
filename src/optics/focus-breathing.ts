// SPDX-License-Identifier: Apache-2.0

/**
 * Focus breathing: the change in framing (magnification) as a lens focuses.
 *
 * The declared-scale model applies a caller-supplied projection scale to the ideal Gaussian thin-lens
 * projection for one focus state. Photivra does not guess the scale from focal length, focus
 * distance, lens identity or marketing data. A scale of 1 keeps the thin-lens projection exactly.
 * This is a generic approximation of how projection and magnification change with focus. It is not a
 * calibrated real-lens model. The physical focal length is never changed and stays authoritative.
 *
 * The field-of-view function gives the one-axis field of view (FOV) under this model, and the ideal
 * thin-lens FOV for comparison. A breathingProjectionScale of 1 reproduces the focus-aware thin-lens
 * FOV exactly.
 *
 * The geometric model derives breathing from ideal focusing geometry instead of a declared scale.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite
} from "../core/validation.js";
import { calculateThinLensImageDistance } from "./thin-lens.js";
import { requireInputKeys } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export interface CalculateFocusBreathingProjectionInput {
  /** Physical lens focal length in millimetres. This value is never rewritten. */
  focalLengthMm: number;
  /** Selected focus distance in metres. */
  focusDistanceM: number;
  /**
   * Caller-declared projection scale for this focus state, relative to the
   * ideal thin-lens image distance.
   *
   * 1 means no breathing beyond the thin-lens model. Values above 1 narrow the
   * framing (more magnification). Values below 1 widen it (less
   * magnification).
   */
  breathingProjectionScale: number;
}

export interface FocusBreathingProjection {
  /** Authoritative physical focal length supplied by the caller. */
  physicalFocalLengthMm: number;
  focusDistanceM: number;
  /** Ideal Gaussian thin-lens image distance before breathing adjustment. */
  idealProjectionDistanceMm: number;
  /**
   * Effective projection distance used by the generic breathing model.
   *
   * This is a projection (magnification) parameter. It does not replace the
   * physical focal length.
   */
  effectiveProjectionDistanceMm: number;
  /** Caller-declared scale relative to ideal thin-lens projection. */
  breathingProjectionScale: number;
  /** Ideal Gaussian thin-lens magnification at the selected focus distance. */
  idealMagnification: number;
  /** Generic breathing-adjusted magnification. */
  effectiveMagnification: number;
}

export interface CalculateFocusBreathingFieldOfViewInput
  extends CalculateFocusBreathingProjectionInput {
  /** Sensor/capture dimension corresponding to the requested FOV, in millimetres. */
  sensorDimensionMm: number;
}

export interface FocusBreathingFieldOfView {
  physicalFocalLengthMm: number;
  focusDistanceM: number;
  sensorDimensionMm: number;
  breathingProjectionScale: number;
  idealProjectionDistanceMm: number;
  effectiveProjectionDistanceMm: number;
  idealDegrees: number;
  effectiveDegrees: number;
  deltaDegrees: number;
}

/**
 * Applies a caller-declared focus-breathing projection scale to the ideal
 * Gaussian thin-lens projection for one focus state.
 *
 * Photivra does not guess the scale from focal length, focus distance, lens
 * identity or marketing data. A scale of 1 keeps the thin-lens projection
 * exactly.
 *
 * This is a generic approximation of how projection and magnification change
 * with focus. It is not a calibrated real-lens model. The physical focal
 * length is never changed and stays authoritative.
 */
export function calculateFocusBreathingProjection(
  input: CalculateFocusBreathingProjectionInput
): CalculationResult<FocusBreathingProjection> {
  requireInputKeys(input, "calculateFocusBreathingProjection", ["focalLengthMm", "focusDistanceM", "breathingProjectionScale"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requirePositiveFinite("focusDistanceM", input.focusDistanceM);
  requirePositiveFinite(
    "breathingProjectionScale",
    input.breathingProjectionScale
  );

  const thinLens = calculateThinLensImageDistance({
    focalLengthMm: input.focalLengthMm,
    objectDistanceM: input.focusDistanceM
  });
  const idealProjectionDistanceMm = thinLens.value.imageDistanceMm;
  const effectiveProjectionDistanceMm =
    idealProjectionDistanceMm * input.breathingProjectionScale;
  const objectDistanceMm = input.focusDistanceM * 1000;

  return approximationResult(
    {
      physicalFocalLengthMm: input.focalLengthMm,
      focusDistanceM: input.focusDistanceM,
      idealProjectionDistanceMm,
      effectiveProjectionDistanceMm,
      breathingProjectionScale: input.breathingProjectionScale,
      idealMagnification: thinLens.value.magnification,
      effectiveMagnification:
        effectiveProjectionDistanceMm / objectDistanceMm
    },
    "declared-scale-focus-breathing-projection",
    "1.0.0",
    [
      "Base projection is the ideal Gaussian thin-lens image distance for the selected focus distance",
      "The focus-breathing projection scale is supplied explicitly by the caller and is not inferred",
      "One declared scale applies uniformly to the current focus state",
      "Physical focal length remains unchanged and authoritative",
      "The model represents focus-dependent framing/magnification only; distortion, pupil magnification, aberrations, and named-lens calibration are not modeled"
    ]
  );
}

/**
 * Calculates the one-axis field of view under the declared-scale
 * focus-breathing model, and reports the ideal thin-lens field of view for
 * comparison.
 *
 * A breathingProjectionScale of 1 reproduces the focus-aware thin-lens field
 * of view exactly.
 */
export function calculateFocusBreathingFieldOfView(
  input: CalculateFocusBreathingFieldOfViewInput
): CalculationResult<FocusBreathingFieldOfView> {
  requireInputKeys(input, "calculateFocusBreathingFieldOfView", ["sensorDimensionMm", "focalLengthMm", "focusDistanceM", "breathingProjectionScale"]);
  requirePositiveFinite("sensorDimensionMm", input.sensorDimensionMm);

  const projection = calculateFocusBreathingProjection({
    focalLengthMm: input.focalLengthMm,
    focusDistanceM: input.focusDistanceM,
    breathingProjectionScale: input.breathingProjectionScale
  });
  const idealRadians =
    2 *
    Math.atan(
      input.sensorDimensionMm /
        (2 * projection.value.idealProjectionDistanceMm)
    );
  const effectiveRadians =
    2 *
    Math.atan(
      input.sensorDimensionMm /
        (2 * projection.value.effectiveProjectionDistanceMm)
    );
  const idealDegrees = (idealRadians * 180) / Math.PI;
  const effectiveDegrees = (effectiveRadians * 180) / Math.PI;

  return approximationResult(
    {
      physicalFocalLengthMm: input.focalLengthMm,
      focusDistanceM: input.focusDistanceM,
      sensorDimensionMm: input.sensorDimensionMm,
      breathingProjectionScale: input.breathingProjectionScale,
      idealProjectionDistanceMm:
        projection.value.idealProjectionDistanceMm,
      effectiveProjectionDistanceMm:
        projection.value.effectiveProjectionDistanceMm,
      idealDegrees,
      effectiveDegrees,
      deltaDegrees: effectiveDegrees - idealDegrees
    },
    "declared-scale-focus-breathing-field-of-view",
    "1.0.0",
    [
      ...(projection.provenance.assumptions ?? []),
      "Rectilinear field of view is calculated from the declared sensor/capture dimension and effective projection distance"
    ]
  );
}

/** Ideal focusing geometry for {@link calculateGeometricFocusBreathing}. */
export type GeometricFocusingMethod =
  | "unit-focus"
  | "fixed-image-distance-internal-focus";

export interface CalculateGeometricFocusBreathingInput {
  /** Focal length at infinity focus, mm. */
  focalLengthMm: number;
  /**
   * Photographic focus distance measured from the subject plane to the sensor (image) plane, in
   * metres, as marked on lens distance scales.
   */
  subjectToSensorDistanceM: number;
  /** Sensor/capture dimension along the axis of interest, mm. */
  sensorDimensionMm: number;
  focusingMethod: GeometricFocusingMethod;
  /**
   * Signed distance between the front and rear principal planes (the "hiatus"), in mm. Default 0
   * (thin lens). The subject-to-sensor distance is u + hiatus + v.
   */
  principalPlaneSeparationMm?: number;
}

export interface GeometricFocusBreathing {
  focusingMethod: GeometricFocusingMethod;
  infinityFocalLengthMm: number;
  /** Focal length of the focused system (changes only for internal focus), mm. */
  effectiveFocalLengthMm: number;
  /** Subject distance from the front principal plane, mm. */
  objectDistanceMm: number;
  /** Rear principal plane to sensor distance (projection distance), mm. */
  imageDistanceMm: number;
  /** Lateral magnification v / u. */
  magnification: number;
  /** v / f_infinity: framing scale relative to infinity focus. */
  projectionScaleRelativeToInfinity: number;
  /**
   * v divided by the ideal thin-lens image distance, at objectDistanceMm, of a lens with the same
   * infinity focal length. Exactly 1 for unit focus. You can pass it as breathingProjectionScale to
   * calculateFocusBreathingProjection() with focusDistanceM = objectDistanceMm / 1000.
   */
  equivalentBreathingProjectionScale: number;
  fieldOfViewDegrees: number;
  infinityFieldOfViewDegrees: number;
  deltaDegrees: number;
}

/**
 * Focus breathing derived from ideal focusing geometry, instead of a declared scale.
 *
 * - unit-focus: the whole lens moves. u + v = L - hiatus and 1/u + 1/v = 1/f, so
 *   v = (T - sqrt(T^2 - 4 f T)) / 2, where T = L - hiatus >= 4 f. The field narrows as v grows.
 * - fixed-image-distance-internal-focus: an idealised internal-focus lens keeps the rear principal
 *   plane at v = f_infinity and shortens its focal length to f' = u v / (u + v). The angular field
 *   at the rear nodal point then stays the same, and the magnification is f_infinity / u.
 * Both use paraxial Gaussian optics with the nodal points at the principal planes (unit pupil
 * magnification; Greivenkamp, OPTI-502 course notes, University of Arizona, sec. 3 and 5, free. Also
 * see: Kingslake & Johnson, Lens Design Fundamentals, 2nd ed., ch. 3; Ray, Applied Photographic
 * Optics, 3rd ed., ch. 9 and 14). Real internal-focus lenses also move their pupils and
 * principal planes, so modelling their breathing needs a calibrated profile.
 */
export function calculateGeometricFocusBreathing(
  input: CalculateGeometricFocusBreathingInput
): CalculationResult<GeometricFocusBreathing> {
  requireInputKeys(input, "calculateGeometricFocusBreathing", ["focalLengthMm", "subjectToSensorDistanceM", "sensorDimensionMm", "focusingMethod", "principalPlaneSeparationMm"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requirePositiveFinite("subjectToSensorDistanceM", input.subjectToSensorDistanceM);
  requirePositiveFinite("sensorDimensionMm", input.sensorDimensionMm);
  const hiatus = input.principalPlaneSeparationMm ?? 0;
  if (typeof hiatus !== "number" || !Number.isFinite(hiatus)) {
    throw new InvalidScientificInputError("principalPlaneSeparationMm must be finite.");
  }
  const f = input.focalLengthMm;
  const conjugateSum = input.subjectToSensorDistanceM * 1000 - hiatus;

  let imageDistanceMm: number;
  let objectDistanceMm: number;
  let effectiveFocalLengthMm: number;
  if (input.focusingMethod === "unit-focus") {
    if (!(conjugateSum >= 4 * f)) {
      throw new InvalidScientificInputError(
        "Unit focus requires subject-to-sensor distance minus hiatus of at least 4 x focal length (1:1 limit)."
      );
    }
    // Stable smaller root of v^2 - T v + f T = 0: v = 2 f T / (T + sqrt(T^2 - 4 f T)).
    // 2.28.0 (optics-25): when T^2 overflows, the root is taken as T sqrt(1 - 4f/T), which cannot; finite T^2 keeps
    // the expression as before.
    const squared = conjugateSum * conjugateSum;
    const root = Number.isFinite(squared)
      ? Math.sqrt(squared - 4 * f * conjugateSum)
      : conjugateSum * Math.sqrt(1 - (4 * f) / conjugateSum);
    imageDistanceMm = (2 * f * conjugateSum) / (conjugateSum + root);
    objectDistanceMm = conjugateSum - imageDistanceMm;
    effectiveFocalLengthMm = f;
  } else if (input.focusingMethod === "fixed-image-distance-internal-focus") {
    imageDistanceMm = f;
    objectDistanceMm = conjugateSum - f;
    if (!(objectDistanceMm > f)) {
      throw new InvalidScientificInputError(
        "Internal focus requires the subject to lie more than one focal length in front of the lens."
      );
    }
    effectiveFocalLengthMm = (objectDistanceMm * f) / (objectDistanceMm + f);
  } else {
    throw new InvalidConfigurationError(
      "focusingMethod must be unit-focus or fixed-image-distance-internal-focus."
    );
  }

  const thinLens = calculateThinLensImageDistance({
    focalLengthMm: f,
    objectDistanceM: objectDistanceMm / 1000
  }).value.imageDistanceMm;
  const fov = (projection: number): number =>
    (2 * Math.atan(input.sensorDimensionMm / (2 * projection)) * 180) / Math.PI;
  const fieldOfViewDegrees = fov(imageDistanceMm);
  const infinityFieldOfViewDegrees = fov(f);

  return approximationResult(
    {
      focusingMethod: input.focusingMethod,
      infinityFocalLengthMm: f,
      effectiveFocalLengthMm,
      objectDistanceMm,
      imageDistanceMm,
      magnification: imageDistanceMm / objectDistanceMm,
      projectionScaleRelativeToInfinity: imageDistanceMm / f,
      equivalentBreathingProjectionScale:
        input.focusingMethod === "unit-focus" ? 1 : imageDistanceMm / thinLens,
      fieldOfViewDegrees,
      infinityFieldOfViewDegrees,
      deltaDegrees: fieldOfViewDegrees - infinityFieldOfViewDegrees
    },
    "geometric-focus-breathing",
    "1.0.0",
    [
      "Paraxial Gaussian optics with nodal points at the principal planes (unit pupil magnification)",
      input.focusingMethod === "unit-focus"
        ? "Unit focus: the whole lens moves; focal length is constant"
        : "Idealised internal focus: image distance fixed at the infinity focal length; focal length shortens",
      "Subject-to-sensor distance = object distance + principal-plane separation + image distance",
      "Rectilinear field of view from the rear-principal-plane projection distance; distortion, pupil shifts and named-lens behaviour are not modeled"
    ]
  );
}
