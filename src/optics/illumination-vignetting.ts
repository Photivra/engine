// SPDX-License-Identifier: Apache-2.0

/**
 * Generic illumination falloff across the image (vignetting), as a factor that multiplies linear
 * light.
 *
 * A profile is accepted only if its relative throughput stays strictly positive and never exceeds 1
 * (the value on the optical axis) anywhere in its declared range.
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
import type { LensFieldPointMm } from "./radial-distortion.js";
import { requireInputObject, requireInputKeys } from "../core/record-validation.js";

export interface IlluminationVignettingCoefficients {
  /** Coefficient on normalized radius squared. */
  r2: number;
  /** Coefficient on normalized radius to the fourth power. */
  r4: number;
  /** Coefficient on normalized radius to the sixth power. */
  r6: number;
}

export interface IlluminationVignettingProfile {
  /** Physical image-plane radius used to normalize field position, in mm. */
  normalizationRadiusMm: number;
  /** Maximum normalized image-plane radius over which the profile is valid. */
  maximumNormalizedRadius: number;
  /**
   * Generic radial relative-illumination coefficients.
   *
   * Relative linear throughput is:
   *   1 + r2 * rho^2 + r4 * rho^4 + r6 * rho^6
   *
   * where rho is physical image-plane radius / normalizationRadiusMm.
   */
  coefficients: IlluminationVignettingCoefficients;
}

export interface CalculateIlluminationVignettingInput {
  /**
   * Ideal image-plane field position relative to the optical axis, in mm.
   *
   * Throughput is evaluated at this ideal field coordinate. Geometric
   * distortion is neither applied nor inverted.
   */
  imagePointMm: LensFieldPointMm;
  profile: IlluminationVignettingProfile;
}

export interface IlluminationVignetting {
  imagePointMm: LensFieldPointMm;
  normalizedRadius: number;
  /**
   * Factor that multiplies scene-linear or channel-linear signal.
   *
   * 1 means no attenuation. Values must stay in (0, 1].
   */
  linearThroughputFactor: number;
  /** Positive exposure loss relative to the optical axis, in stops. */
  attenuationStops: number;
  profileMinimumThroughputFactor: number;
  profileMaximumThroughputFactor: number;
}

interface ValidatedIlluminationProfile {
  normalizationRadiusMm: number;
  maximumNormalizedRadius: number;
  coefficients: IlluminationVignettingCoefficients;
  minimumThroughputFactor: number;
  maximumThroughputFactor: number;
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new InvalidScientificInputError(`${name} must be finite.`);
  }
}

function throughputFromSquaredRadius(
  squaredRadius: number,
  coefficients: IlluminationVignettingCoefficients
): number {
  return (
    1 +
    coefficients.r2 * squaredRadius +
    coefficients.r4 * squaredRadius * squaredRadius +
    coefficients.r6 *
      squaredRadius *
      squaredRadius *
      squaredRadius
  );
}

/**
 * Real roots of dT/ds, where s = rho². Every interior maximum or minimum of the throughput lies at
 * one of these roots. The validator checks them along with both ends of the range. So a profile
 * that dips below zero, or rises above one, mid-field is rejected even when both ends are valid.
 *
 * The quadratic is scaled before solving and uses the numerically stable q-form roots. This stops a
 * tiny cubic term from erasing the smaller root through cancellation. The radial-distortion
 * validator uses the same scheme.
 */
function throughputCriticalSquaredRadii(
  coefficients: IlluminationVignettingCoefficients
): number[] {
  // T(s) = 1 + r2*s + r4*s² + r6*s³
  // dT/ds = r2 + 2*r4*s + 3*r6*s²
  const a = 3 * coefficients.r6;
  const b = 2 * coefficients.r4;
  const c = coefficients.r2;
  const coefficientScale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (coefficientScale === 0) {
    return [];
  }
  const scaledA = a / coefficientScale;
  const scaledB = b / coefficientScale;
  const scaledC = c / coefficientScale;

  if (scaledA === 0) {
    return scaledB === 0 ? [] : [-scaledC / scaledB];
  }

  const discriminant = scaledB * scaledB - 4 * scaledA * scaledC;
  if (discriminant < 0) {
    return [];
  }
  const root = Math.sqrt(discriminant);
  const q = -0.5 * (scaledB + (scaledB >= 0 ? root : -root));
  if (q === 0) {
    // Only when b = c = 0: the double root is s = 0.
    return [0];
  }
  return [q / scaledA, scaledC / q];
}

function validateProfile(
  profile: IlluminationVignettingProfile
): ValidatedIlluminationProfile {
  requirePositiveFinite(
    "profile.normalizationRadiusMm",
    profile.normalizationRadiusMm
  );
  requirePositiveFinite(
    "profile.maximumNormalizedRadius",
    profile.maximumNormalizedRadius
  );
  requireFinite("profile.coefficients.r2", profile.coefficients.r2);
  requireFinite("profile.coefficients.r4", profile.coefficients.r4);
  requireFinite("profile.coefficients.r6", profile.coefficients.r6);

  const maximumSquaredRadius =
    profile.maximumNormalizedRadius * profile.maximumNormalizedRadius;
  const candidates = [
    0,
    maximumSquaredRadius,
    ...throughputCriticalSquaredRadii(profile.coefficients).filter(
      (value) => value > 0 && value < maximumSquaredRadius
    )
  ];
  const throughputs = candidates.map((squaredRadius) =>
    throughputFromSquaredRadius(squaredRadius, profile.coefficients)
  );
  const minimumThroughputFactor = Math.min(...throughputs);
  const maximumThroughputFactor = Math.max(...throughputs);

  if (
    !Number.isFinite(minimumThroughputFactor) ||
    minimumThroughputFactor <= 0
  ) {
    throw new InvalidScientificInputError(
      "Illumination vignetting profile must keep relative linear throughput strictly greater than zero over maximumNormalizedRadius."
    );
  }

  if (
    !Number.isFinite(maximumThroughputFactor) ||
    maximumThroughputFactor > 1
  ) {
    throw new InvalidScientificInputError(
      "Illumination vignetting profile must not amplify relative linear throughput above the optical-axis value of 1."
    );
  }

  return {
    normalizationRadiusMm: profile.normalizationRadiusMm,
    maximumNormalizedRadius: profile.maximumNormalizedRadius,
    coefficients: { ...profile.coefficients },
    minimumThroughputFactor,
    maximumThroughputFactor
  };
}

/** The normalized radius and throughput factor at an image point, for a validated profile (the arithmetic of calculateIlluminationVignetting). */
function throughputAt(profile: ValidatedIlluminationProfile, imagePointMm: LensFieldPointMm): { normalizedRadius: number; linearThroughputFactor: number } {
  const radiusMm = Math.hypot(imagePointMm.x, imagePointMm.y);
  const normalizedRadius = radiusMm / profile.normalizationRadiusMm;

  if (normalizedRadius > profile.maximumNormalizedRadius) {
    throw new InvalidScientificInputError(
      "imagePointMm lies outside the illumination vignetting profile maximumNormalizedRadius."
    );
  }

  const squaredRadius = normalizedRadius * normalizedRadius;
  return { normalizedRadius, linearThroughputFactor: throughputFromSquaredRadius(squaredRadius, profile.coefficients) };
}

/**
 * @internal (#563) The `linearThroughputFactor` that {@link calculateIlluminationVignetting} returns, from a profile validated once:
 * the same arithmetic and the same errors, without the result envelope, for callers that evaluate one profile at many points
 * (the image-space field factor of `prepareDefocusImageSpaceGeometry`).
 */
export function prepareIlluminationVignettingThroughput(profile: IlluminationVignettingProfile): (imagePointMm: LensFieldPointMm) => number {
  const validated = validateProfile(profile);
  return (imagePointMm) => {
    requireFinite("imagePointMm.x", imagePointMm.x);
    requireFinite("imagePointMm.y", imagePointMm.y);
    return throughputAt(validated, imagePointMm).linearThroughputFactor;
  };
}

function assumptions(): readonly string[] {
  return [
    "Generic rotationally symmetric illumination-vignetting approximation evaluated from ideal image-plane field radius",
    "Relative linear throughput is normalized to 1 on the optical axis",
    "The model attenuates scene-linear/channel-linear signal only and must be applied before display/gamma encoding",
    "The model changes throughput only; it does not alter field coordinates, pupil shape, PSF shape, bokeh, or focus",
    "Mechanical/pupil vignetting and cat's-eye bokeh are separate pupil/PSF effects",
    "The profile is a generic caller-supplied radial approximation, not calibrated radiometry or a named-lens measurement"
  ];
}

/**
 * Calculates generic illumination falloff across the image (vignetting) as a
 * factor that multiplies linear light.
 *
 * A profile is accepted only if its relative throughput stays strictly
 * positive and never exceeds 1 (the value on the optical axis) anywhere in
 * its declared range.
 */
export function calculateIlluminationVignetting(
  input: CalculateIlluminationVignettingInput
): CalculationResult<IlluminationVignetting> {
  requireInputKeys(input, "calculateIlluminationVignetting", ["imagePointMm", "profile"]);
  requireInputObject(input.imagePointMm, "imagePointMm");
  requireFinite("imagePointMm.x", input.imagePointMm.x);
  requireFinite("imagePointMm.y", input.imagePointMm.y);

  const profile = validateProfile(input.profile);
  const { normalizedRadius, linearThroughputFactor } = throughputAt(profile, input.imagePointMm);

  const attenuationStops =
    linearThroughputFactor === 1
      ? 0
      : -Math.log2(linearThroughputFactor);

  return approximationResult(
    {
      imagePointMm: { ...input.imagePointMm },
      normalizedRadius,
      linearThroughputFactor,
      attenuationStops,
      profileMinimumThroughputFactor: profile.minimumThroughputFactor,
      profileMaximumThroughputFactor: profile.maximumThroughputFactor
    },
    "generic-radial-illumination-vignetting",
    "1.0.0",
    assumptions()
  );
}
