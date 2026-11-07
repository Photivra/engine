// SPDX-License-Identifier: Apache-2.0

/**
 * Builds an environment radiance request from points on the physical sensor. It uses the existing
 * focus-aware ideal projection and the analytic inverse camera rotation.
 *
 * Native Y (+Y down) is inverted explicitly. The direction sent to the provider points opposite the
 * look ray at exposure start, because radiance travels toward the camera. This module does not
 * intersect the scene, compute radiance or render anything.
 *
 * Optional lens field mapping (2.0):
 * 1. The physical sensor point is inverse-distorted (radial or Brown-Conrady) to the ideal image
 *    point.
 * 2. That point is unprojected with the declared ideal projection (rectilinear, fisheye or
 *    equirectangular), at the same focus-aware projection scale.
 * 3. The ray is rotated to the camera axes at exposure start.
 * The local area factor 1 / det(d distorted / d ideal) is reported. The caller applies it to
 * irradiance exactly once. Without the mapping, the existing rectilinear computation is unchanged.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { applyPhysicalCameraRotation, calculateInverseCameraRotationImageMapping,
  type CameraAngularVelocityRadPerSec } from "../motion/camera-rotation.js";
import { lensProjectionDirectionValue, parseLensProjectionModel, type LensProjectionModel } from "../camera/lens-projection.js";
import {
  calculateInverseRadialSourcePointValue, validateRadialDistortionProfile, type RadialDistortionProfile, type ValidatedRadialProfile
} from "./radial-distortion.js";
import {
  brownConradyForwardValue, brownConradyInverseValue, validateBrownConradyDistortionProfile,
  type BrownConradyDistortionProfile, type ValidatedBrownConradyDistortionProfile
} from "./brown-conrady-distortion.js";
import { calculateThinLensImageDistance } from "./thin-lens.js";
import { parseSceneRadianceEvaluationRequest, type SceneRadianceEvaluationRequest } from "../schema/scene-radiance.js";
import { parseFocusPlane, type FocusPlane } from "./focus-state.js";
import { requireInputKeys } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { hypot3 } from "../core/portable-math.js";

/**
 * Lens field mapping between the physical (distorted) sensor point and the scene ray (2.0).
 * `radiometricAreaCorrection` states who applies the distortion area factor. The environment
 * photo signal multiplies irradiance by 1 / det(d distorted / d ideal) exactly once. A supplied
 * field-throughput profile must therefore not include it as well.
 */
export interface EnvironmentLensFieldMapping {
  projectionModel: LensProjectionModel;
  distortion:
    | { kind: "none" }
    | { kind: "radial"; profile: RadialDistortionProfile }
    | { kind: "brown-conrady"; profile: BrownConradyDistortionProfile };
  radiometricAreaCorrection: "inverse-distortion-jacobian";
}

/** @internal Parsed mapping with validated profiles, reused across one plan's queries. */
export interface PreparedEnvironmentLensFieldMapping {
  mapping: EnvironmentLensFieldMapping;
  radial?: ValidatedRadialProfile;
  brownConrady?: ValidatedBrownConradyDistortionProfile;
}

/** @internal Strict parse and validation of a lens field mapping. Unknown fields are rejected. */
export function prepareEnvironmentLensFieldMapping(value: unknown): PreparedEnvironmentLensFieldMapping {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidConfigurationError("lensFieldMapping must be an object.");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["projectionModel", "distortion", "radiometricAreaCorrection"].includes(key)) {
      throw new InvalidConfigurationError(`lensFieldMapping has unknown field ${JSON.stringify(key)}.`);
    }
  }
  if (record.radiometricAreaCorrection !== "inverse-distortion-jacobian") {
    throw new InvalidConfigurationError("lensFieldMapping.radiometricAreaCorrection must be \"inverse-distortion-jacobian\".");
  }
  const projectionModel = parseLensProjectionModel(record.projectionModel);
  const distortion = record.distortion as EnvironmentLensFieldMapping["distortion"] | undefined;
  if (typeof distortion !== "object" || distortion === null) {
    throw new InvalidConfigurationError("lensFieldMapping.distortion must be an object.");
  }
  if (distortion.kind === "none") {
    return { mapping: { projectionModel, distortion: { kind: "none" }, radiometricAreaCorrection: "inverse-distortion-jacobian" } };
  }
  if (distortion.kind === "radial") {
    const radial = validateRadialDistortionProfile(distortion.profile);
    return { mapping: { projectionModel, distortion: { kind: "radial", profile: distortion.profile },
      radiometricAreaCorrection: "inverse-distortion-jacobian" }, radial };
  }
  if (distortion.kind === "brown-conrady") {
    const brownConrady = validateBrownConradyDistortionProfile(distortion.profile);
    return { mapping: { projectionModel, distortion: { kind: "brown-conrady", profile: distortion.profile },
      radiometricAreaCorrection: "inverse-distortion-jacobian" }, brownConrady };
  }
  throw new InvalidConfigurationError("lensFieldMapping.distortion.kind must be none, radial or brown-conrady.");
}

export interface CalculateSensorEnvironmentRadianceQueryInput {
  /** Optical sample point before the anti-aliasing filter or PSF. Native +X right, +Y down, in mm from the optical axis. */
  sourcePointNativeSensorMm: { x: number; y: number };
  focalLengthMm: number;
  focus: FocusPlane;
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  /** States that the moment the shutter opens is t=0 in the rotation model. */
  timeReference: "first-opening-boundary-phase";
  timeSecondsFromOpeningReference: number;
  /** The request uses the direction radiance travels: toward the camera, opposite the look ray. */
  environmentDirectionConvention: "outgoing-radiance-toward-camera";
  request: Omit<SceneRadianceEvaluationRequest, "target" | "timeSecondsFromExposureStart">;
  /** Optional 2.0 lens field mapping. Omit it for the ideal rectilinear, distortion-free query. */
  lensFieldMapping?: EnvironmentLensFieldMapping;
}

export interface SensorEnvironmentLensFieldMappingResult {
  projectionModel: LensProjectionModel;
  distortionKind: "none" | "radial" | "brown-conrady";
  /** Ideal (undistorted) image-plane point, +X right / +Y up, mm. */
  idealImagePointMm: { x: number; y: number };
  /** Projection scale: thin-lens image distance at finite focus, focal length at infinity, mm. */
  projectionScaleMm: number;
  /** 1 / det(d distorted / d ideal) at this point; 1 without distortion. */
  distortionAreaFactor: number;
}

export interface SensorEnvironmentRadianceQuery {
  request: SceneRadianceEvaluationRequest;
  sourcePointNativeSensorMm: { x: number; y: number };
  sourcePointImagePlaneMm: { x: number; y: number };
  referenceLookDirectionUnitVector: { x: number; y: number; z: number };
  /** Rectilinear rotation mapping. Null when a non-rectilinear lens field mapping is used. */
  projection: ReturnType<typeof calculateInverseCameraRotationImageMapping> | null;
  /** Present only when the input declared a lens field mapping. */
  lensFieldMapping?: SensorEnvironmentLensFieldMappingResult;
  targetMeaning: "environment-direction-in-exposure-start-camera-axes";
  directionConvention: "outgoing-radiance-toward-camera";
  geometricRayProjectionCalculated: true;
  sceneIntersectionCalculated: false;
  visibilityCalculated: false;
  providerExecuted: false;
}

/**
 * Builds an environment radiance request from points on the physical sensor,
 * using the existing focus-aware ideal projection and the analytic inverse
 * camera rotation.
 *
 * Native Y (+Y down) is inverted explicitly. The provider direction points
 * opposite the look ray at exposure start. Nothing intersects the scene,
 * computes radiance or renders.
 */
export function calculateSensorEnvironmentRadianceQuery(
  input: CalculateSensorEnvironmentRadianceQueryInput
): CalculationResult<SensorEnvironmentRadianceQuery> {
  requireInputKeys(input, "calculateSensorEnvironmentRadianceQuery", ["sourcePointNativeSensorMm", "focalLengthMm", "focus", "angularVelocityRadPerSec", "timeReference", "timeSecondsFromOpeningReference", "environmentDirectionConvention", "request", "lensFieldMapping"]);
  if (input.lensFieldMapping !== undefined) {
    return calculateMappedSensorEnvironmentRadianceQuery(input, prepareEnvironmentLensFieldMapping(input.lensFieldMapping));
  }
  if (input.timeReference !== "first-opening-boundary-phase" ||
    input.environmentDirectionConvention !== "outgoing-radiance-toward-camera") {
    throw new InvalidScientificInputError("Environment projection requires explicit opening-boundary time and outgoing-toward-camera direction conventions.");
  }
  const focus = parseFocusPlane(input.focus);
  const sourcePointImagePlaneMm = { x: input.sourcePointNativeSensorMm.x, y: -input.sourcePointNativeSensorMm.y };
  const projection = calculateInverseCameraRotationImageMapping({ focalLengthMm: input.focalLengthMm,
    imagePointMm: sourcePointImagePlaneMm, angularVelocityRadPerSec: input.angularVelocityRadPerSec,
    timeSecondsFromExposureStart: input.timeSecondsFromOpeningReference,
    ...(focus.kind === "finite" ? { focusDistanceM: focus.distanceM } : {}) });
  const point = projection.value.referenceImagePointMm, z = projection.value.projectionDistanceMm;
  const length = hypot3(point.x, point.y, z);
  const referenceLookDirectionUnitVector = { x: point.x/length, y: point.y/length, z: z/length };
  const ray = referenceLookDirectionUnitVector;
  const request = parseSceneRadianceEvaluationRequest({ ...input.request,
    timeSecondsFromExposureStart: input.timeSecondsFromOpeningReference,
    target: { kind: "environment-direction", outgoingDirectionUnitVector: { x: -ray.x, y: -ray.y, z: -ray.z } } });
  return approximationResult({ request, sourcePointNativeSensorMm: { ...input.sourcePointNativeSensorMm },
    sourcePointImagePlaneMm, referenceLookDirectionUnitVector, projection,
    targetMeaning: "environment-direction-in-exposure-start-camera-axes", directionConvention: "outgoing-radiance-toward-camera",
    geometricRayProjectionCalculated: true, sceneIntersectionCalculated: false, visibilityCalculated: false, providerExecuted: false
  }, "sensor-environment-radiance-query", "0.1.0", [
    "Ideal focus-aware rectilinear projection and constant-axis pure camera rotation; reference ray must stay in the forward hemisphere.",
    "The environment and rotation reference axes coincide with camera axes at the first opening boundary by explicit convention.",
    "Lens distortion, breathing, chromatic field mapping, translation/parallax and scene intersections remain separate."
  ]);
}

/**
 * @internal The ideal (undistorted) image point of a physical sensor point (+X right, +Y up, mm) and the distortion area
 * factor 1 / det(d distorted / d ideal) there; the ideal point is the sensor point itself without distortion. Shared by
 * the mapped query below and the image-space defocus of `simulateCapture` (#548), so both use one arithmetic.
 */
export function undistortedImagePoint(prepared: PreparedEnvironmentLensFieldMapping, imagePointMm: { x: number; y: number }):
  { ideal: { x: number; y: number }; distortionAreaFactor: number } {
  let ideal = imagePointMm;
  let distortionAreaFactor = 1;
  if (prepared.radial !== undefined) {
    ideal = calculateInverseRadialSourcePointValue(imagePointMm, prepared.radial, "sourcePointNativeSensorMm").sourceImagePointMm;
    // Radial map p -> s(r) p: det = s (s + r ds/dr) with r ds/dr = 2 r^2 s'(r^2).
    const { k1, k2, k3 } = prepared.radial.coefficients;
    const r2 = (ideal.x*ideal.x+ideal.y*ideal.y)/prepared.radial.normalizationRadiusMm**2;
    const scale = 1+k1*r2+k2*r2*r2+k3*r2*r2*r2;
    const radialDerivative = 1+3*k1*r2+5*k2*r2*r2+7*k3*r2*r2*r2;
    distortionAreaFactor = 1/(scale*radialDerivative);
  } else if (prepared.brownConrady !== undefined) {
    ideal = brownConradyInverseValue(prepared.brownConrady, imagePointMm);
    const j = brownConradyForwardValue(prepared.brownConrady, ideal).jacobian;
    distortionAreaFactor = 1/(j[0]*j[3]-j[1]*j[2]);
  }
  if (!(distortionAreaFactor > 0) || !Number.isFinite(distortionAreaFactor)) {
    throw new InvalidScientificInputError("Distortion area factor must remain finite and positive.");
  }
  return { ideal, distortionAreaFactor };
}

/**
 * @internal The forward distortion of an ideal image point (+X right, +Y up, mm) to the physical sensor point, with the
 * singular values of d distorted / d ideal there (the largest and smallest local scale of the map; 1 and 1 without
 * distortion). The inverse of {@link undistortedImagePoint} up to its solver's rounding (#548).
 */
export function distortedImagePoint(prepared: PreparedEnvironmentLensFieldMapping, ideal: { x: number; y: number }):
  { pointMm: { x: number; y: number }; largestScale: number; smallestScale: number } {
  if (prepared.radial !== undefined) {
    const { k1, k2, k3 } = prepared.radial.coefficients;
    const r2 = (ideal.x*ideal.x+ideal.y*ideal.y)/prepared.radial.normalizationRadiusMm**2;
    const scale = 1+k1*r2+k2*r2*r2+k3*r2*r2*r2;
    // Tangential scale s, radial scale s + r ds/dr (the two eigenvalues of the symmetric Jacobian of p -> s(r) p).
    const radialDerivative = 1+3*k1*r2+5*k2*r2*r2+7*k3*r2*r2*r2;
    return { pointMm: { x: ideal.x*scale, y: ideal.y*scale }, largestScale: Math.max(scale, radialDerivative), smallestScale: Math.min(scale, radialDerivative) };
  }
  if (prepared.brownConrady !== undefined) {
    const forward = brownConradyForwardValue(prepared.brownConrady, ideal), [a, b, c, d] = forward.jacobian;
    // Singular values of [[a, b], [c, d]]: sqrt of the eigenvalues of J^T J.
    const p = a*a+b*b+c*c+d*d, q = Math.abs(a*d-b*c), root = Math.sqrt(Math.max(0, p*p-4*q*q));
    const largest = Math.sqrt((p+root)/2);
    return { pointMm: forward.mappedImagePointMm, largestScale: largest, smallestScale: largest > 0 ? q/largest : 0 };
  }
  return { pointMm: { ...ideal }, largestScale: 1, smallestScale: 1 };
}

/**
 * @internal Query with a lens field mapping that is already validated. The environment photo-signal
 * planner shares it, so profiles are validated once per plan.
 */
export function calculateMappedSensorEnvironmentRadianceQuery(
  input: CalculateSensorEnvironmentRadianceQueryInput,
  prepared: PreparedEnvironmentLensFieldMapping
): CalculationResult<SensorEnvironmentRadianceQuery> {
  if (input.timeReference !== "first-opening-boundary-phase" ||
    input.environmentDirectionConvention !== "outgoing-radiance-toward-camera") {
    throw new InvalidScientificInputError("Environment projection requires explicit opening-boundary time and outgoing-toward-camera direction conventions.");
  }
  const focus = parseFocusPlane(input.focus);
  const sourcePointImagePlaneMm = { x: input.sourcePointNativeSensorMm.x, y: -input.sourcePointNativeSensorMm.y };
  const mapping = prepared.mapping;
  const { ideal, distortionAreaFactor } = undistortedImagePoint(prepared, sourcePointImagePlaneMm);
  let projection: ReturnType<typeof calculateInverseCameraRotationImageMapping> | null = null;
  let look: { x: number; y: number; z: number };
  let projectionScaleMm: number;
  if (mapping.projectionModel === "rectilinear") {
    projection = calculateInverseCameraRotationImageMapping({ focalLengthMm: input.focalLengthMm,
      imagePointMm: ideal, angularVelocityRadPerSec: input.angularVelocityRadPerSec,
      timeSecondsFromExposureStart: input.timeSecondsFromOpeningReference,
      ...(focus.kind === "finite" ? { focusDistanceM: focus.distanceM } : {}) });
    const point = projection.value.referenceImagePointMm, z = projection.value.projectionDistanceMm;
    const length = hypot3(point.x, point.y, z);
    look = { x: point.x/length, y: point.y/length, z: z/length };
    projectionScaleMm = z;
  } else {
    projectionScaleMm = focus.kind === "finite"
      ? calculateThinLensImageDistance({ focalLengthMm: input.focalLengthMm, objectDistanceM: focus.distanceM }).value.imageDistanceMm
      : input.focalLengthMm;
    const velocity = input.angularVelocityRadPerSec;
    const t = input.timeSecondsFromOpeningReference;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) {
      throw new InvalidScientificInputError("timeSecondsFromOpeningReference must be finite and non-negative.");
    }
    const captured = lensProjectionDirectionValue(mapping.projectionModel, projectionScaleMm, ideal.x, ideal.y);
    const reference = applyPhysicalCameraRotation(captured,
      { pitch: velocity.pitch*t, yaw: velocity.yaw*t, roll: velocity.roll*t }, "camera-to-reference");
    const length = hypot3(reference.x, reference.y, reference.z);
    if (!(length > 0) || !Number.isFinite(length)) throw new InvalidScientificInputError("Mapped reference ray must be finite.");
    look = { x: reference.x/length, y: reference.y/length, z: reference.z/length };
  }
  const request = parseSceneRadianceEvaluationRequest({ ...input.request,
    timeSecondsFromExposureStart: input.timeSecondsFromOpeningReference,
    target: { kind: "environment-direction", outgoingDirectionUnitVector: { x: -look.x, y: -look.y, z: -look.z } } });
  return approximationResult({ request, sourcePointNativeSensorMm: { ...input.sourcePointNativeSensorMm },
    sourcePointImagePlaneMm, referenceLookDirectionUnitVector: look, projection,
    lensFieldMapping: { projectionModel: mapping.projectionModel, distortionKind: mapping.distortion.kind,
      idealImagePointMm: { ...ideal }, projectionScaleMm, distortionAreaFactor },
    targetMeaning: "environment-direction-in-exposure-start-camera-axes", directionConvention: "outgoing-radiance-toward-camera",
    geometricRayProjectionCalculated: true, sceneIntersectionCalculated: false, visibilityCalculated: false, providerExecuted: false
  }, "lens-mapped-sensor-environment-radiance-query", "0.1.0", [
    "The physical sensor point is inverse-distorted to the ideal image point, then unprojected with the declared ideal projection and rotated by the constant-axis pure camera rotation.",
    "Projection scale is the thin-lens image distance at finite focus (focal length at infinity) for every projection model; a calibrated finite-focus fisheye scale is not modeled.",
    "The distortion area factor 1/det(d distorted/d ideal) is reported for exactly-once application to irradiance; field throughput, PSF and pupil models are not changed by this query.",
    "Breathing, chromatic field mapping, translation/parallax and scene intersections remain separate."
  ]);
}
