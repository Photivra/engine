// SPDX-License-Identifier: Apache-2.0

/**
 * Generic Brown-Conrady lens distortion: radial (k1, k2, k3) plus tangential/decentering (p1, p2)
 * terms on normalized image-plane coordinates (x, y) = point / normalizationRadiusMm, r^2 = x^2 + y^2:
 *   x_d = x (1 + k1 r^2 + k2 r^4 + k3 r^6) + 2 p1 x y + p2 (r^2 + 2 x^2)
 *   y_d = y (1 + k1 r^2 + k2 r^4 + k3 r^6) + p1 (r^2 + 2 y^2) + 2 p2 x y
 * In vector form the tangential term is r^2 P + 2 (P . u) u with P = (p2, p1), so (p1, p2) rotate as
 * a vector with the image.
 *
 * Sources: Conrady 1919 (MNRAS 79:384, decentred lens systems); Brown 1966
 * (Photogrammetric Engineering 32:444, "Decentering distortion of lenses"); Brown 1971 (Photogramm.
 * Eng. 37:855, close-range camera calibration). The coefficient layout follows the widely used
 * Brown-Conrady convention (for example Heikkila & Silven 1997, CVPR). The coefficient names match
 * that convention, but the values only mean something together with the declared normalization
 * radius.
 *
 * Validity checks (matching the radial-distortion validator):
 * - The radial part must be strictly monotonic over the envelope (the valid radius range).
 * - The Jacobian determinant must stay positive at a dense, fixed polar grid of samples over the
 *   envelope disk.
 * - The mapped envelope boundary must have strictly increasing polar angle, so it is a simple
 *   star-shaped curve.
 * A smooth, locally invertible map of a closed disk that is one-to-one on its boundary is one-to-one
 * everywhere. So these conditions make the inverse single-valued. Note that the Jacobian and boundary
 * conditions are checked at samples, not proven between them.
 *
 * The inverse uses damped Newton iteration, starting from the radial-only inverse.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  calculateInverseRadialSourcePointValue,
  validateRadialDistortionProfile,
  type LensFieldPointMm,
  type ValidatedRadialProfile
} from "./radial-distortion.js";
import { requireInputKeys, requireNamedFinite as requireFinite } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export interface BrownConradyDistortionCoefficients {
  /** Radial r^2 coefficient. */
  k1: number;
  /** Radial r^4 coefficient. */
  k2: number;
  /** Radial r^6 coefficient. */
  k3: number;
  /** Tangential (decentering) coefficient p1 (couples to y; see module equation). */
  p1: number;
  /** Tangential (decentering) coefficient p2 (couples to x; see module equation). */
  p2: number;
}

export interface BrownConradyDistortionProfile {
  /** Physical image-plane radius used to normalize field position, in mm. */
  normalizationRadiusMm: number;
  /** Maximum undistorted normalized radius of the operating envelope. */
  maximumNormalizedRadius: number;
  coefficients: BrownConradyDistortionCoefficients;
}

export interface CalculateBrownConradyDistortionMappingInput {
  /** Ideal/undistorted image-plane point, in mm. */
  imagePointMm: LensFieldPointMm;
  profile: BrownConradyDistortionProfile;
}

export interface CalculateInverseBrownConradyDistortionMappingInput {
  /** Distorted image-plane point to map back to ideal coordinates, in mm. */
  distortedImagePointMm: LensFieldPointMm;
  profile: BrownConradyDistortionProfile;
}

export interface BrownConradyDistortionMapping {
  direction: "undistorted-to-distorted";
  sourceImagePointMm: LensFieldPointMm;
  mappedImagePointMm: LensFieldPointMm;
  sourceNormalizedRadius: number;
  /** Determinant of d(mapped)/d(source) at the source point (dimensionless area scale). */
  jacobianDeterminant: number;
  deltaMm: { x: number; y: number; distance: number };
  profileMinimumJacobianDeterminant: number;
}

export interface InverseBrownConradyDistortionMapping {
  direction: "distorted-to-undistorted";
  distortedImagePointMm: LensFieldPointMm;
  sourceImagePointMm: LensFieldPointMm;
  sourceNormalizedRadius: number;
  jacobianDeterminantAtSource: number;
  newtonIterations: number;
  /** Forward-mapping residual of the solved source point, in mm. */
  residualMm: number;
  deltaMm: { x: number; y: number; distance: number };
  profileMinimumJacobianDeterminant: number;
}

interface ValidatedBrownConradyProfile {
  radial: ValidatedRadialProfile;
  coefficients: BrownConradyDistortionCoefficients;
  minimumJacobianDeterminant: number;
}

const VALIDATION_RINGS = 64;
const VALIDATION_AZIMUTHS = 256;
const MAXIMUM_NEWTON_ITERATIONS = 100;

function requirePoint(name: string, point: unknown): LensFieldPointMm {
  if (typeof point !== "object" || point === null) {
    throw new InvalidConfigurationError(
      `${name} must be an object with finite numeric x and y coordinates.`
    );
  }
  const record = point as Record<string, unknown>;
  return {
    x: requireFinite(`${name}.x`, record.x),
    y: requireFinite(`${name}.y`, record.y)
  };
}

/** Forward map on normalized coordinates. */
function forwardNormalized(
  x: number,
  y: number,
  c: BrownConradyDistortionCoefficients
): { x: number; y: number } {
  const r2 = x * x + y * y;
  const radial = 1 + r2 * (c.k1 + r2 * (c.k2 + r2 * c.k3));
  return {
    x: x * radial + 2 * c.p1 * x * y + c.p2 * (r2 + 2 * x * x),
    y: y * radial + c.p1 * (r2 + 2 * y * y) + 2 * c.p2 * x * y
  };
}

/** Jacobian [[a, b], [c, d]] of the normalized forward map. */
function jacobianNormalized(
  x: number,
  y: number,
  c: BrownConradyDistortionCoefficients
): { a: number; b: number; c: number; d: number } {
  const r2 = x * x + y * y;
  const s = 1 + r2 * (c.k1 + r2 * (c.k2 + r2 * c.k3));
  const ds = c.k1 + r2 * (2 * c.k2 + 3 * c.k3 * r2);
  const off = 2 * x * y * ds + 2 * c.p1 * x + 2 * c.p2 * y;
  return {
    a: s + 2 * x * x * ds + 2 * c.p1 * y + 6 * c.p2 * x,
    b: off,
    c: off,
    d: s + 2 * y * y * ds + 6 * c.p1 * y + 2 * c.p2 * x
  };
}

function determinant(j: { a: number; b: number; c: number; d: number }): number {
  return j.a * j.d - j.b * j.c;
}

function validateProfile(
  profile: BrownConradyDistortionProfile
): ValidatedBrownConradyProfile {
  if (typeof profile !== "object" || profile === null) {
    throw new InvalidConfigurationError("profile must be an object.");
  }
  if (typeof profile.coefficients !== "object" || profile.coefficients === null) {
    throw new InvalidConfigurationError("profile.coefficients must be an object.");
  }
  const coefficients: BrownConradyDistortionCoefficients = {
    k1: requireFinite("profile.coefficients.k1", profile.coefficients.k1),
    k2: requireFinite("profile.coefficients.k2", profile.coefficients.k2),
    k3: requireFinite("profile.coefficients.k3", profile.coefficients.k3),
    p1: requireFinite("profile.coefficients.p1", profile.coefficients.p1),
    p2: requireFinite("profile.coefficients.p2", profile.coefficients.p2)
  };
  const radial = validateRadialDistortionProfile({
    normalizationRadiusMm: profile.normalizationRadiusMm,
    maximumNormalizedRadius: profile.maximumNormalizedRadius,
    coefficients: {
      k1: coefficients.k1,
      k2: coefficients.k2,
      k3: coefficients.k3
    }
  });

  const maximum = radial.maximumNormalizedRadius;
  let minimumJacobianDeterminant = Number.POSITIVE_INFINITY;
  for (let ring = 0; ring <= VALIDATION_RINGS; ring += 1) {
    const rho = (maximum * ring) / VALIDATION_RINGS;
    const azimuths = ring === 0 ? 1 : VALIDATION_AZIMUTHS;
    for (let index = 0; index < azimuths; index += 1) {
      const phi = (2 * Math.PI * index) / VALIDATION_AZIMUTHS;
      const det = determinant(
        jacobianNormalized(rho * Math.cos(phi), rho * Math.sin(phi), coefficients)
      );
      minimumJacobianDeterminant = Math.min(minimumJacobianDeterminant, det);
    }
  }
  if (!Number.isFinite(minimumJacobianDeterminant) || minimumJacobianDeterminant <= 0) {
    throw new InvalidScientificInputError(
      "Brown-Conrady profile must keep a positive Jacobian determinant over maximumNormalizedRadius so the mapping stays locally invertible."
    );
  }

  // The mapped boundary must be star-shaped about the mapped centre (the origin): its polar angle
  // must increase strictly around the circle, so the boundary curve is simple.
  let previous: number | undefined;
  let accumulated = 0;
  for (let index = 0; index <= VALIDATION_AZIMUTHS; index += 1) {
    const phi = (2 * Math.PI * index) / VALIDATION_AZIMUTHS;
    const mapped = forwardNormalized(
      maximum * Math.cos(phi),
      maximum * Math.sin(phi),
      coefficients
    );
    const angle = Math.atan2(mapped.y, mapped.x);
    if (previous !== undefined) {
      let step = angle - previous;
      if (step <= -Math.PI) step += 2 * Math.PI;
      if (step > Math.PI) step -= 2 * Math.PI;
      if (!(step > 0)) {
        throw new InvalidScientificInputError(
          "Brown-Conrady profile maps the envelope boundary to a curve that is not star-shaped about the optical axis; the inverse would not be single-valued."
        );
      }
      accumulated += step;
    }
    previous = angle;
  }
  if (Math.abs(accumulated - 2 * Math.PI) > 1e-9) {
    throw new InvalidScientificInputError(
      "Brown-Conrady profile boundary must wind exactly once around the optical axis."
    );
  }

  return { radial, coefficients, minimumJacobianDeterminant };
}

function assumptions(): readonly string[] {
  return [
    "Generic Brown-Conrady radial (k1, k2, k3) plus tangential/decentering (p1, p2) polynomial field mapping",
    "Coordinates are normalized by the caller-declared normalizationRadiusMm; the optical axis maps to itself",
    "Validity: monotonic radial part, positive Jacobian at a 64-ring x 256-azimuth polar sample and a strictly star-shaped mapped boundary; checked at samples, not proven between them",
    "Coefficients are generic caller inputs and do not represent a named lens unless separately calibrated with defensible provenance",
    "Thin-prism, anamorphic and higher-order decentering terms are not modeled"
  ];
}

/** @internal Opaque validated profile for repeated in-package evaluation. */
export type ValidatedBrownConradyDistortionProfile = ValidatedBrownConradyProfile;

/** @internal Validates one profile for repeated evaluation (geometric mapping, ray queries). */
export function validateBrownConradyDistortionProfile(
  profile: BrownConradyDistortionProfile
): ValidatedBrownConradyDistortionProfile {
  return validateProfile(profile);
}

/** @internal Forward map in mm with its Jacobian d(distorted)/d(ideal), row-major. */
export function brownConradyForwardValue(
  profile: ValidatedBrownConradyDistortionProfile,
  point: LensFieldPointMm
): { mappedImagePointMm: LensFieldPointMm; jacobian: readonly [number, number, number, number] } {
  const scale = profile.radial.normalizationRadiusMm;
  const x = point.x / scale;
  const y = point.y / scale;
  if (Math.hypot(x, y) > profile.radial.maximumNormalizedRadius) {
    throw new InvalidScientificInputError(
      "Point lies outside the Brown-Conrady profile maximumNormalizedRadius."
    );
  }
  const mapped = forwardNormalized(x, y, profile.coefficients);
  const j = jacobianNormalized(x, y, profile.coefficients);
  return {
    mappedImagePointMm: { x: mapped.x * scale, y: mapped.y * scale },
    jacobian: [j.a, j.b, j.c, j.d]
  };
}

/** @internal Inverse map in mm (distorted to ideal). */
export function brownConradyInverseValue(
  profile: ValidatedBrownConradyDistortionProfile,
  point: LensFieldPointMm
): LensFieldPointMm {
  const solved = solveInverseBrownConrady(profile, point);
  const scale = profile.radial.normalizationRadiusMm;
  return { x: solved.x * scale, y: solved.y * scale };
}

function solveInverseBrownConrady(
  profile: ValidatedBrownConradyProfile,
  point: LensFieldPointMm
): { x: number; y: number; iterations: number; residual: number; sourceNormalizedRadius: number } {
  const scale = profile.radial.normalizationRadiusMm;
  const maximum = profile.radial.maximumNormalizedRadius;
  const tx = point.x / scale;
  const ty = point.y / scale;
  const tolerance = 1e-12 * Math.max(1, Math.hypot(tx, ty));

  // Starting point: the radial-only inverse if inside its mapped envelope, otherwise the target itself.
  let x = tx;
  let y = ty;
  if (Math.hypot(tx, ty) <= profile.radial.maximumMappedNormalizedRadius) {
    const seed = calculateInverseRadialSourcePointValue(
      point,
      profile.radial,
      "distortedImagePointMm"
    ).sourceImagePointMm;
    x = seed.x / scale;
    y = seed.y / scale;
  }

  let iterations = 0;
  let residual = Number.POSITIVE_INFINITY;
  for (; iterations < MAXIMUM_NEWTON_ITERATIONS; iterations += 1) {
    const f = forwardNormalized(x, y, profile.coefficients);
    const rx = f.x - tx;
    const ry = f.y - ty;
    residual = Math.hypot(rx, ry);
    if (residual <= tolerance) {
      break;
    }
    const j = jacobianNormalized(x, y, profile.coefficients);
    const det = determinant(j);
    if (!(Math.abs(det) > 0) || !Number.isFinite(det)) {
      break;
    }
    const stepX = (j.d * rx - j.b * ry) / det;
    const stepY = (-j.c * rx + j.a * ry) / det;
    // Damping: halve the step until the residual decreases (at most 30 halvings).
    let lambda = 1;
    let accepted = false;
    for (let halving = 0; halving < 30; halving += 1) {
      const nx = x - lambda * stepX;
      const ny = y - lambda * stepY;
      const g = forwardNormalized(nx, ny, profile.coefficients);
      if (Math.hypot(g.x - tx, g.y - ty) < residual) {
        x = nx;
        y = ny;
        accepted = true;
        break;
      }
      lambda /= 2;
    }
    if (!accepted) {
      break;
    }
  }

  const sourceNormalizedRadius = Math.hypot(x, y);
  if (
    !(residual <= tolerance) ||
    sourceNormalizedRadius > maximum * (1 + 1e-12)
  ) {
    throw new InvalidScientificInputError(
      "distortedImagePointMm lies outside the mapped Brown-Conrady profile operating envelope."
    );
  }

  return { x, y, iterations, residual, sourceNormalizedRadius };
}

/** Applies the Brown-Conrady forward mapping to one ideal image-plane point. */
export function calculateBrownConradyDistortionMapping(
  input: CalculateBrownConradyDistortionMappingInput
): CalculationResult<BrownConradyDistortionMapping> {
  requireInputKeys(input, "calculateBrownConradyDistortionMapping", ["imagePointMm", "profile"]);
  const point = requirePoint("imagePointMm", input.imagePointMm);
  const profile = validateProfile(input.profile);
  const scale = profile.radial.normalizationRadiusMm;
  const x = point.x / scale;
  const y = point.y / scale;
  const sourceNormalizedRadius = Math.hypot(x, y);
  if (sourceNormalizedRadius > profile.radial.maximumNormalizedRadius) {
    throw new InvalidScientificInputError(
      "imagePointMm lies outside the Brown-Conrady profile maximumNormalizedRadius."
    );
  }
  const mapped = forwardNormalized(x, y, profile.coefficients);
  const mappedImagePointMm = { x: mapped.x * scale, y: mapped.y * scale };
  const dx = mappedImagePointMm.x - point.x;
  const dy = mappedImagePointMm.y - point.y;
  return approximationResult(
    {
      direction: "undistorted-to-distorted",
      sourceImagePointMm: point,
      mappedImagePointMm,
      sourceNormalizedRadius,
      jacobianDeterminant: determinant(jacobianNormalized(x, y, profile.coefficients)),
      deltaMm: { x: dx, y: dy, distance: Math.hypot(dx, dy) },
      profileMinimumJacobianDeterminant: profile.minimumJacobianDeterminant
    },
    "generic-brown-conrady-lens-distortion",
    "1.0.0",
    assumptions()
  );
}

/**
 * Inverse-maps one distorted image-plane point to its ideal source point, for destination-to-source
 * resampling. Damped Newton iteration starts from the radial-only inverse. The solution must lie
 * inside the declared envelope and must reproduce the distorted point within a relative tolerance of
 * 1e-12.
 */
export function calculateInverseBrownConradyDistortionMapping(
  input: CalculateInverseBrownConradyDistortionMappingInput
): CalculationResult<InverseBrownConradyDistortionMapping> {
  requireInputKeys(input, "calculateInverseBrownConradyDistortionMapping", ["distortedImagePointMm", "profile"]);
  const point = requirePoint("distortedImagePointMm", input.distortedImagePointMm);
  const profile = validateProfile(input.profile);
  const solved = solveInverseBrownConrady(profile, point);
  const scale = profile.radial.normalizationRadiusMm;
  const { x, y, iterations, residual, sourceNormalizedRadius } = solved;
  const sourceImagePointMm = { x: x * scale, y: y * scale };
  const dx = sourceImagePointMm.x - point.x;
  const dy = sourceImagePointMm.y - point.y;
  return approximationResult(
    {
      direction: "distorted-to-undistorted",
      distortedImagePointMm: point,
      sourceImagePointMm,
      sourceNormalizedRadius,
      jacobianDeterminantAtSource: determinant(
        jacobianNormalized(x, y, profile.coefficients)
      ),
      newtonIterations: iterations,
      residualMm: residual * scale,
      deltaMm: { x: dx, y: dy, distance: Math.hypot(dx, dy) },
      profileMinimumJacobianDeterminant: profile.minimumJacobianDeterminant
    },
    "generic-inverse-brown-conrady-lens-distortion",
    "1.0.0",
    [
      ...assumptions(),
      `Inverse uses damped Newton iteration (at most ${MAXIMUM_NEWTON_ITERATIONS} steps) seeded by the radial-only inverse, accepted at a normalized residual of 1e-12`
    ]
  );
}
