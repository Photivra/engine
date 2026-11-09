// SPDX-License-Identifier: Apache-2.0

/**
 * Physical vignetting models derived from pupil geometry. They are separate from the
 * calculateIlluminationVignetting() polynomial, whose coefficients the caller supplies.
 *
 * Apply at most one field-throughput model to a signal. Do not stack these results on top of a
 * supplied field-throughput profile.
 *
 * Natural vignetting (relative illumination of an aberration-free system with a uniform Lambertian
 * exit pupil):
 * - cosine-fourth: E(theta) / E(0) = cos^4(theta), theta the image-space chief-ray angle with
 *   tan(theta) = h / z for image height h and exit-pupil distance z (Greivenkamp, OPTI-502 course
 *   notes, University of Arizona, sec. 11, free. Also see: Slater 1980 Photographic Systems for
 *   Engineers; Kingslake, Lens Design Fundamentals, 2nd ed., sec. 6.5; Ray, Applied Photographic
 *   Optics, 3rd ed., sec. 12). It is the small-pupil limit of the next model.
 * - finite-lambertian-pupil: exact irradiance from a uniform Lambertian disk of radius a at distance z
 *   onto a parallel plane at lateral offset h (Foote 1915, Bull. Bureau of Standards 12:583):
 *   E = (pi L / 2) [1 - (z^2 + h^2 - a^2) / sqrt((z^2 + h^2 + a^2)^2 - 4 a^2 h^2)],
 *   normalised by its on-axis value pi L a^2 / (z^2 + a^2). For a -> 0 it tends to cos^4(theta).
 *   Pupil aberration and pupil distortion are not modeled.
 *
 * Mechanical (optical) vignetting and the cat's-eye pupil:
 * - At field angle theta, each clipping aperture (a lens barrel or element rim, referred to the
 *   entrance-pupil plane) appears as a circle of its declared radius. The circle is shifted by
 *   shiftPerTanFieldMm * tan(theta) along the field azimuth.
 * - The open pupil is where the entrance-pupil circle overlaps every shifted circle. Off axis, the
 *   bundle stays circular and centred on the chief ray, and an aperture passes only the part of it
 *   that it covers (Greivenkamp, OPTI-502 course notes, University of Arizona, sec. 10, free. Also
 *   see: Kingslake, Lens Design Fundamentals, sec. 6.4; Smith, Modern Optical Engineering, 4th ed.,
 *   sec. 6.3).
 * - With one aperture, the area is the exact area of the two-circle overlap.
 * - With any number of apertures, the exact convex boundary is also returned, sampled as a polygon
 *   in pupil-plane mm (+X right, +Y up). Use it as a polygon pupil for
 *   calculatePolygonPupilFraunhoferPsf() or as a mask for createWavefrontPupilGrid().
 * The combined relative illumination is cos^4(theta) x open-area ratio. This assumes an object at
 * infinity, a stop imaged without pupil aberration, and an object-space field angle equal to the
 * chief-ray angle.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  approximationResult,
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite
} from "../core/validation.js";
import { requireInputKeys, requireNamedFinite as requireFinite } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export type NaturalVignettingModel =
  | "cosine-fourth"
  | "finite-lambertian-pupil";

export interface CalculateNaturalVignettingInput {
  model: NaturalVignettingModel;
  /** Image-plane point relative to the optical axis, mm. */
  imagePointMm: { x: number; y: number };
  /** Axial distance from the exit pupil to the image plane, mm. */
  exitPupilDistanceMm: number;
  /** Exit-pupil diameter, mm; required for finite-lambertian-pupil. */
  exitPupilDiameterMm?: number;
}

export interface NaturalVignetting {
  model: NaturalVignettingModel;
  /** Image-space chief-ray angle, radians. */
  chiefRayAngleRadians: number;
  /** Relative illumination E / E(axis), in (0, 1]. */
  relativeIllumination: number;
  /** Positive exposure loss, stops. */
  attenuationStops: number;
  /** cos^4 of the chief-ray angle, reported for comparison. */
  cosineFourthFactor: number;
}

export interface MechanicalVignettingAperture {
  /** Aperture radius referred to the entrance-pupil plane, mm. */
  radiusMm: number;
  /**
   * Signed shift of the aperture's projected centre per unit tan(field angle), in mm, along the
   * field azimuth. Positive means toward the field point.
   */
  shiftPerTanFieldMm: number;
}

export interface CalculateMechanicalVignettingInput {
  /** Unclipped entrance-pupil diameter, mm. */
  entrancePupilDiameterMm: number;
  /** Object-space field angle from the optical axis, degrees, in [0, 90). */
  fieldAngleDegrees: number;
  /** Image-plane direction of the field point, degrees counter-clockwise from +X. */
  fieldAzimuthDegrees: number;
  /** One through eight clipping apertures. */
  apertures: readonly MechanicalVignettingAperture[];
  /** Boundary samples per circle for the polygon, from 16 to 4096 (default 256). */
  boundarySamplesPerCircle?: number;
}

export interface MechanicalVignetting {
  fieldAngleDegrees: number;
  fieldAzimuthDegrees: number;
  entrancePupilAreaSquareMm: number;
  /** Open area in mm^2. Exact for a single aperture; the polygon area otherwise. */
  openAreaSquareMm: number;
  areaMethod: "exact-circle-circle-intersection" | "boundary-polygon";
  /** Open area / unclipped pupil area, in [0, 1]. */
  openAreaRatio: number;
  /** cos^4(field angle). */
  cosineFourthFactor: number;
  /** cos^4(theta) x openAreaRatio. */
  combinedRelativeIllumination: number;
  /** Counter-clockwise convex boundary of the open pupil (empty when fully vignetted), mm. */
  openPupilPolygonMm: readonly { x: number; y: number }[];
  /** Area centroid of the boundary polygon, mm (null when fully vignetted). */
  openPupilCentroidMm: { x: number; y: number } | null;
}

/**
 * Natural (cos^4 or finite Lambertian pupil) relative illumination at one image point.
 */
export function calculateNaturalVignetting(
  input: CalculateNaturalVignettingInput
): CalculationResult<NaturalVignetting> {
  requireInputKeys(input, "calculateNaturalVignetting", ["model", "imagePointMm", "exitPupilDistanceMm", "exitPupilDiameterMm"]);
  if (input.model !== "cosine-fourth" && input.model !== "finite-lambertian-pupil") {
    throw new InvalidConfigurationError(
      "model must be cosine-fourth or finite-lambertian-pupil."
    );
  }
  if (typeof input.imagePointMm !== "object" || input.imagePointMm === null) {
    throw new InvalidConfigurationError("imagePointMm must be an object.");
  }
  const h = Math.hypot(
    requireFinite("imagePointMm.x", input.imagePointMm.x),
    requireFinite("imagePointMm.y", input.imagePointMm.y)
  );
  requirePositiveFinite("exitPupilDistanceMm", input.exitPupilDistanceMm);
  const z = input.exitPupilDistanceMm;
  const theta = Math.atan2(h, z);
  const cos2 = (z * z) / (z * z + h * h);
  const cosineFourthFactor = cos2 * cos2;

  let relativeIllumination: number;
  if (input.model === "cosine-fourth") {
    if (input.exitPupilDiameterMm !== undefined) {
      throw new InvalidScientificInputError(
        "exitPupilDiameterMm is not used by the cosine-fourth model; omit it."
      );
    }
    relativeIllumination = cosineFourthFactor;
  } else {
    requirePositiveFinite("exitPupilDiameterMm", input.exitPupilDiameterMm as number);
    const a = (input.exitPupilDiameterMm as number) / 2;
    const z2 = z * z;
    const h2 = h * h;
    const a2 = a * a;
    // Bracket term written as 2 a^2 (...) / (sqrt + ...) to avoid cancellation for small pupils:
    // 1 - P / Q = (Q - P) / Q with Q - P = (Q^2 - P^2) / (Q + P) = 4 a^2 z^2 / (Q + P).
    const p = z2 + h2 - a2;
    const q = Math.sqrt((z2 + h2 + a2) ** 2 - 4 * a2 * h2);
    const offAxis = (4 * a2 * z2) / (q * (q + p)) / 2;
    const onAxis = a2 / (z2 + a2);
    relativeIllumination = offAxis / onAxis;
  }
  if (!(relativeIllumination > 0) || !Number.isFinite(relativeIllumination)) {
    throw new InvalidScientificInputError(
      "Natural vignetting relative illumination must remain finite and positive."
    );
  }
  relativeIllumination = Math.min(1, relativeIllumination);

  return calculatedResult(
    {
      model: input.model,
      chiefRayAngleRadians: theta,
      relativeIllumination,
      attenuationStops: relativeIllumination === 1 ? 0 : -Math.log2(relativeIllumination),
      cosineFourthFactor
    },
    input.model === "cosine-fourth"
      ? "cosine-fourth-natural-vignetting"
      : "finite-lambertian-pupil-natural-vignetting",
    "1.0.0",
    [
      input.model === "cosine-fourth"
        ? "Relative illumination cos^4 of the image-space chief-ray angle from the exit-pupil centre"
        : "Exact irradiance from a uniform Lambertian circular exit pupil onto a parallel image plane, normalised on axis",
      "Aberration-free pupil: pupil aberration, pupil distortion and mechanical clipping are not modeled",
      "Throughput only; apply at most one field-throughput model, in scene-linear signal"
    ]
  );
}

/** Exact area of the intersection of two circles. */
function circleIntersectionArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
  const a1 = Math.acos(clamp((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)));
  const a2 = Math.acos(clamp((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)));
  const k = Math.sqrt(
    Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2))
  );
  return r1 * r1 * a1 + r2 * r2 * a2 - k / 2;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

function insideAll(
  point: { x: number; y: number },
  circles: readonly Circle[],
  skip: number
): boolean {
  return circles.every(
    (circle, index) =>
      index === skip ||
      Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.r * (1 + 1e-12)
  );
}

/** Convex boundary of the intersection of circles, sampled with vertices on the true boundary. */
function intersectionPolygon(
  circles: readonly Circle[],
  samples: number
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  circles.forEach((circle, index) => {
    for (let k = 0; k < samples; k += 1) {
      const angle = (2 * Math.PI * k) / samples;
      const point = {
        x: circle.x + circle.r * Math.cos(angle),
        y: circle.y + circle.r * Math.sin(angle)
      };
      if (insideAll(point, circles, index)) points.push(point);
    }
  });
  // Pairwise boundary intersection points (the cusps of the cat's eye).
  for (let i = 0; i < circles.length; i += 1) {
    for (let j = i + 1; j < circles.length; j += 1) {
      const a = circles[i]!;
      const b = circles[j]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d === 0 || d >= a.r + b.r || d <= Math.abs(a.r - b.r)) continue;
      const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
      const half = Math.sqrt(Math.max(0, a.r * a.r - along * along));
      const ux = (b.x - a.x) / d;
      const uy = (b.y - a.y) / d;
      for (const sign of [1, -1]) {
        const point = {
          x: a.x + along * ux - sign * half * uy,
          y: a.y + along * uy + sign * half * ux
        };
        if (circles.every((c) => Math.hypot(point.x - c.x, point.y - c.y) <= c.r * (1 + 1e-9))) {
          points.push(point);
        }
      }
    }
  }
  if (points.length < 3) return [];
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  points.sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
  // Drop coincident neighbours.
  const unique = points.filter((p, index) => {
    const prev = points[(index + points.length - 1) % points.length]!;
    return index === 0 || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-12 * (1 + Math.abs(p.x) + Math.abs(p.y));
  });
  return unique.length >= 3 ? unique : [];
}

function polygonAreaAndCentroid(
  polygon: readonly { x: number; y: number }[]
): { area: number; centroid: { x: number; y: number } } {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return {
    area: twiceArea / 2,
    centroid: { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) }
  };
}

/**
 * Mechanical vignetting at one field angle: the open (cat's-eye) pupil from intersecting the
 * entrance pupil with displaced clipping apertures, its area ratio, and cos^4 x area ratio.
 */
export function calculateMechanicalVignetting(
  input: CalculateMechanicalVignettingInput
): CalculationResult<MechanicalVignetting> {
  requireInputKeys(input, "calculateMechanicalVignetting", ["entrancePupilDiameterMm", "fieldAngleDegrees", "fieldAzimuthDegrees", "apertures", "boundarySamplesPerCircle"]);
  requirePositiveFinite("entrancePupilDiameterMm", input.entrancePupilDiameterMm);
  const fieldAngleDegrees = requireFinite("fieldAngleDegrees", input.fieldAngleDegrees);
  if (fieldAngleDegrees < 0 || fieldAngleDegrees >= 90) {
    throw new InvalidScientificInputError("fieldAngleDegrees must lie in [0, 90).");
  }
  const fieldAzimuthDegrees = requireFinite("fieldAzimuthDegrees", input.fieldAzimuthDegrees);
  if (!Array.isArray(input.apertures) || input.apertures.length < 1 || input.apertures.length > 8) {
    throw new InvalidScientificInputError("apertures must contain 1 through 8 entries.");
  }
  const samples = input.boundarySamplesPerCircle ?? 256;
  if (!Number.isSafeInteger(samples) || samples < 16 || samples > 4096) {
    throw new InvalidScientificInputError(
      "boundarySamplesPerCircle must be an integer from 16 through 4096."
    );
  }
  const theta = (fieldAngleDegrees * Math.PI) / 180;
  const azimuth = (fieldAzimuthDegrees * Math.PI) / 180;
  const tanTheta = Math.tan(theta);
  const pupilRadius = input.entrancePupilDiameterMm / 2;
  const circles: Circle[] = [{ x: 0, y: 0, r: pupilRadius }];
  input.apertures.forEach((aperture, index) => {
    if (typeof aperture !== "object" || aperture === null) {
      throw new InvalidConfigurationError(`apertures[${index}] must be an object.`);
    }
    requirePositiveFinite(`apertures[${index}].radiusMm`, aperture.radiusMm);
    const shift =
      requireFinite(`apertures[${index}].shiftPerTanFieldMm`, aperture.shiftPerTanFieldMm) *
      tanTheta;
    circles.push({
      x: shift * Math.cos(azimuth),
      y: shift * Math.sin(azimuth),
      r: aperture.radiusMm
    });
  });

  const pupilArea = Math.PI * pupilRadius * pupilRadius;
  const polygon = intersectionPolygon(circles, samples);
  const geometry = polygon.length >= 3 ? polygonAreaAndCentroid(polygon) : undefined;
  let openArea: number;
  let areaMethod: MechanicalVignetting["areaMethod"];
  if (circles.length === 2) {
    const other = circles[1]!;
    openArea = circleIntersectionArea(pupilRadius, other.r, Math.hypot(other.x, other.y));
    areaMethod = "exact-circle-circle-intersection";
  } else {
    openArea = geometry?.area ?? 0;
    areaMethod = "boundary-polygon";
  }
  const openAreaRatio = Math.min(1, Math.max(0, openArea / pupilArea));
  const cos2 = Math.cos(theta) ** 2;
  const cosineFourthFactor = cos2 * cos2;

  return approximationResult(
    {
      fieldAngleDegrees,
      fieldAzimuthDegrees,
      entrancePupilAreaSquareMm: pupilArea,
      openAreaSquareMm: openArea,
      areaMethod,
      openAreaRatio,
      cosineFourthFactor,
      combinedRelativeIllumination: cosineFourthFactor * openAreaRatio,
      openPupilPolygonMm: polygon,
      openPupilCentroidMm: geometry?.centroid ?? null
    },
    "cats-eye-mechanical-vignetting",
    "1.0.0",
    [
      "Clipping apertures are circles referred to the entrance-pupil plane, displaced linearly with tan(field angle) along the field azimuth",
      "Open pupil = intersection of the entrance pupil with every displaced aperture; boundary vertices lie exactly on the circles",
      "Combined relative illumination cos^4(theta) x open-area ratio assumes an object at infinity and no pupil aberration",
      "Pupil coordinates are metric and aligned with the image plane (+X right, +Y up)",
      "Geometry is caller-declared; no named-lens barrel data is implied"
    ]
  );
}
