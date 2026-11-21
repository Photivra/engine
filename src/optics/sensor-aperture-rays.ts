// SPDX-License-Identifier: Apache-2.0
/**
 * Ideal rays through a symmetric thin-lens pupil. This module does not intersect rays with the
 * scene and does no radiometry.
 */
import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { parseEvidenceList, type EvidenceProvenance } from "../core/evidence-provenance.js";
import { InvalidScientificInputError, requirePositiveFinite } from "../core/validation.js";
import { calculateFocusPlaneImageDistance, parseFocusPlane, type FocusPlane } from "./focus-state.js";
import { applyPhysicalCameraRotation, calculateInverseCameraRotationImageMapping,
  type CameraAngularVelocityRadPerSec } from "../motion/camera-rotation.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { hypot3 } from "../core/portable-math.js";
export interface IdealCircularPupil {
  kind: "ideal-uniform-circular-pupil";
  radialSampleCount: number;
  angularSampleCount: number;
  evidence: readonly EvidenceProvenance[];
  limitation: string;
}
export interface SensorApertureRay {
  /** Lens principal-plane origin and look direction in exposure-opening camera axes. */
  originM: { x: number; y: number; z: number };
  directionUnitVector: { x: number; y: number; z: number };
  pupilPointMm: { x: number; y: number };
  weight: number;
  pupilSampleIndex: number;
}
export interface CalculateSensorApertureRaysInput {
  sourcePointNativeSensorMm: { x: number; y: number };
  focalLengthMm: number;
  nominalFNumber: number;
  focus: FocusPlane;
  pupil: IdealCircularPupil;
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  timeSecondsFromOpeningReference: number;
}
export interface SensorApertureRays {
  rays: readonly SensorApertureRay[];
  projectionDistanceMm: number;
  pupilRadiusMm: number;
  focus: FocusPlane;
  pupil: IdealCircularPupil;
  sceneVisibilityCalculated: false;
  radiometryCalculated: false;
  apertureAreaApplied: false;
}
/**
 * Polar midpoint rule with equal-area cells. Weights are normalized as an average, so they never
 * apply the f-number a second time.
 */
export function calculateSensorApertureRays(input: CalculateSensorApertureRaysInput): CalculationResult<SensorApertureRays> {
  requireInputKeys(input, "calculateSensorApertureRays", ["sourcePointNativeSensorMm", "focalLengthMm", "nominalFNumber", "focus", "pupil", "angularVelocityRadPerSec", "timeSecondsFromOpeningReference"]);
  // 2.28.0 (#726): a value that cannot be copied (a function, for example) is a configuration error, not a DOMException.
  let owned: CalculateSensorApertureRaysInput;
  try { owned = structuredClone(input); } catch { throw new InvalidConfigurationError("calculateSensorApertureRays input must hold plain data only."); }
  const pupil = owned.pupil;
  requireInputObject(owned.sourcePointNativeSensorMm, "sourcePointNativeSensorMm");
  requirePositiveFinite("nominalFNumber", owned.nominalFNumber);
  if (!pupil || pupil.kind !== "ideal-uniform-circular-pupil" ||
    !Number.isSafeInteger(pupil.radialSampleCount) || pupil.radialSampleCount < 1 || pupil.radialSampleCount > 32 ||
    !Number.isSafeInteger(pupil.angularSampleCount) || pupil.angularSampleCount < 4 || pupil.angularSampleCount > 64 ||
    pupil.radialSampleCount*pupil.angularSampleCount > 256 || typeof pupil.limitation !== "string" || !pupil.limitation.trim()) {
    throw new InvalidScientificInputError("Circular pupil requires 1..32 radial, 4..64 angular midpoints, at most 256 rays and explicit limitations.");
  }
  pupil.evidence = parseEvidenceList(pupil.evidence, "circularPupil.evidence");
  const focus = parseFocusPlane(owned.focus);
  const { rays, v, radius } = sensorApertureRayValues(owned, pupil, focus);
  return approximationResult({ rays, projectionDistanceMm: v, pupilRadiusMm: radius, focus, pupil,
    sceneVisibilityCalculated: false, radiometryCalculated: false, apertureAreaApplied: false }, "ideal-thin-lens-circular-pupil-rays", "0.1.0", [
    "Ideal symmetric paraxial thin lens, unity pupil magnification and uniform circular pupil; no diffraction, aberrations, lens housing or pupil clipping.",
    "Normalized pupil averaging is separate from the existing working-f-number radiometric factor; no aperture area or solid-angle factor is applied here.",
    "Pure camera rotation about the lens principal-plane origin; no translation or depth-dependent camera motion.",
    "Finite polar midpoint quadrature does not establish scene visibility, transport calibration or convergence."
  ]);
}

/**
 * Internal (2.0 performance): the rays of calculateSensorApertureRays, by the same code, for a pupil and focus it has
 * already validated and parsed. The lean native executor calls it per site after one full validation per template.
 * It still runs the rotation, time, image-distance and forward-hemisphere checks, and throws where the full function
 * would. Not exported from the package.
 */
export function sensorApertureRayValues(owned: Pick<CalculateSensorApertureRaysInput, "sourcePointNativeSensorMm" | "focalLengthMm" | "nominalFNumber" |
  "angularVelocityRadPerSec" | "timeSecondsFromOpeningReference">, pupil: Pick<IdealCircularPupil, "radialSampleCount" | "angularSampleCount">,
  focus: ReturnType<typeof parseFocusPlane>): { rays: SensorApertureRay[]; v: number; radius: number } {
  const v = calculateFocusPlaneImageDistance({ focalLengthMm: owned.focalLengthMm, focus }).value.imageDistanceMm;
  // Reuse the existing rotation and time validation, and the check that rays point forward.
  const inverse = calculateInverseCameraRotationImageMapping({ focalLengthMm: owned.focalLengthMm,
    imagePointMm: { x: owned.sourcePointNativeSensorMm.x, y: -owned.sourcePointNativeSensorMm.y },
    angularVelocityRadPerSec: owned.angularVelocityRadPerSec, timeSecondsFromExposureStart: owned.timeSecondsFromOpeningReference,
    ...(focus.kind === "finite" ? { focusDistanceM: focus.distanceM } : {}) }).value;
  const displacement = inverse.angularDisplacementRad;
  const radius = owned.focalLengthMm/(2*owned.nominalFNumber), count = pupil.radialSampleCount*pupil.angularSampleCount;
  if (!Number.isFinite(radius) || radius <= 0) throw new InvalidScientificInputError("Pupil radius must remain positive and finite.");
  const rays = Array.from({ length: count }, (_, i): SensorApertureRay => {
    const r = radius*Math.sqrt((Math.floor(i/pupil.angularSampleCount)+.5)/pupil.radialSampleCount);
    const theta = 2*Math.PI*((i%pupil.angularSampleCount)+.5)/pupil.angularSampleCount;
    const point = { x: r*Math.cos(theta), y: r*Math.sin(theta) };
    const origin = { x: point.x/1000, y: point.y/1000, z: 0 };
    const x = owned.sourcePointNativeSensorMm.x/v, y = -owned.sourcePointNativeSensorMm.y/v;
    const direction = focus.kind === "finite" ? { x: x*focus.distanceM-origin.x, y: y*focus.distanceM-origin.y, z: focus.distanceM }
      : { x, y, z: 1 };
    const length = hypot3(direction.x,direction.y,direction.z);
    const unit = { x: direction.x/length, y: direction.y/length, z: direction.z/length };
    // Same physical right-hand camera rotation as the inverse mapping above.
    const rotatedOrigin = applyPhysicalCameraRotation(origin, displacement, "camera-to-reference"),
      rotatedDirection = applyPhysicalCameraRotation(unit, displacement, "camera-to-reference");
    if (![...Object.values(rotatedOrigin),...Object.values(rotatedDirection)].every(Number.isFinite) || rotatedDirection.z <= 0) {
      throw new InvalidScientificInputError("A pupil ray leaves the supported forward hemisphere or finite coordinate domain.");
    }
    return { originM: rotatedOrigin, directionUnitVector: rotatedDirection, pupilPointMm: point, weight: 1/count, pupilSampleIndex: i };
  });
  return { rays, v, radius };
}
