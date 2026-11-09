// SPDX-License-Identifier: Apache-2.0

/**
 * Atmospheric haze as a scene-radiance modifier along a horizontal, homogeneous line of sight
 * (Koschmieder 1924, Beitr. Phys. freien Atmos. 12:33; Middleton, Vision Through the Atmosphere,
 * 1952; McCartney, Optics of the Atmosphere, 1976, ch. 1):
 *   L(d, lambda) = L0(lambda) t + L_air(lambda) (1 - t),  t = exp(-beta(lambda) d)
 * with extinction coefficient beta = beta_Rayleigh + beta_aerosol:
 *   beta_Rayleigh(lambda) = beta_R,ref (lambda / lambda_ref)^(-rayleighExponent)  (Rayleigh: 4;
 *     Bucholtz 1995, Appl. Opt. 34:2765, gives about 4.0-4.1 for air in the visible),
 *   beta_aerosol(lambda) = beta_A,ref (lambda / lambda_ref)^(-alpha)  (Angstrom 1929, Geogr. Ann.
 *     11:156; alpha typically about 0-2.5).
 * L_air is the caller-supplied horizon (airlight) radiance at the same wavelength.
 *
 * This is an approximation. It assumes a uniform atmosphere and a single line of sight. It ignores
 * the angular structure of multiple scattering and any gradient in sky luminance. The caller
 * supplies the reference extinction values; none are built in.
 *
 * Meteorological visibility: Koschmieder's relation V = -ln(epsilon) / beta for a black target at
 * contrast threshold epsilon (0.02 gives 3.912 / beta; the WMO meteorological optical range uses
 * 0.05, about 3.0 / beta; WMO-No. 8, 2018, vol. I ch. 9).
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
import { rejectUnknownFields, requireInputKeys, requireNamedFinite as requireFinite } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export interface AtmosphericExtinctionModel {
  /** Wavelength at which the reference coefficients apply, nm. */
  referenceWavelengthNm: number;
  /** Molecular (Rayleigh) extinction coefficient at the reference wavelength, 1/m (>= 0). */
  rayleighExtinctionPerMeter: number;
  /** Aerosol extinction coefficient at the reference wavelength, 1/m (>= 0). */
  aerosolExtinctionPerMeter: number;
  /** Angstrom exponent alpha for the aerosol term (finite, typically 0-2.5). */
  angstromExponent: number;
  /** Rayleigh wavelength exponent; defaults to 4. */
  rayleighExponent?: number;
}

export interface CalculateAtmosphericHazeInput {
  /** Line-of-sight distance through the homogeneous haze, metres (>= 0). */
  pathLengthM: number;
  /** Wavelength, nm (same basis as the extinction data). */
  wavelengthNm: number;
  /** Scene (object) radiance at zero distance, any linear radiance unit (>= 0). */
  sceneRadiance: number;
  /** Horizon/airlight radiance in the same unit (>= 0). */
  airlightRadiance: number;
  extinction: AtmosphericExtinctionModel;
}

export interface AtmosphericHaze {
  wavelengthNm: number;
  pathLengthM: number;
  rayleighExtinctionPerMeter: number;
  aerosolExtinctionPerMeter: number;
  extinctionPerMeter: number;
  opticalDepth: number;
  /** Direct transmittance t = exp(-beta d). */
  transmittance: number;
  /** L0 t. */
  attenuatedSceneRadiance: number;
  /** L_air (1 - t). */
  airlightContribution: number;
  /** L0 t + L_air (1 - t), in the input radiance unit. */
  hazedRadiance: number;
  /** Apparent contrast against the horizon divided by the intrinsic contrast: (L - L_air)/(L0 - L_air) = t. */
  contrastTransmittance: number;
}

export interface CalculateExtinctionFromVisibilityInput {
  /** Meteorological visibility, metres. */
  visibilityM: number;
  /** Contrast threshold epsilon in (0, 1); Koschmieder 0.02 by default, WMO MOR uses 0.05. */
  contrastThreshold?: number;
}

function requireNonNegativeFinite(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new InvalidScientificInputError(`${name} must be finite and non-negative.`);
  }
  return value;
}

/**
 * Koschmieder haze at one wavelength: attenuated scene radiance plus airlight, with Rayleigh and
 * Angstrom-law aerosol extinction.
 */
export function calculateAtmosphericHaze(
  input: CalculateAtmosphericHazeInput
): CalculationResult<AtmosphericHaze> {
  requireInputKeys(input, "calculateAtmosphericHaze", ["pathLengthM", "wavelengthNm", "sceneRadiance", "airlightRadiance", "extinction"]);
  const d = requireNonNegativeFinite("pathLengthM", input.pathLengthM);
  requirePositiveFinite("wavelengthNm", input.wavelengthNm);
  const l0 = requireNonNegativeFinite("sceneRadiance", input.sceneRadiance);
  const lAir = requireNonNegativeFinite("airlightRadiance", input.airlightRadiance);
  const model = input.extinction;
  if (typeof model !== "object" || model === null) {
    throw new InvalidConfigurationError("extinction must be an object.");
  }
  // A misspelt optional field (for example rayleighExponet) must not silently fall back to the default.
  rejectUnknownFields(model, ["referenceWavelengthNm", "rayleighExtinctionPerMeter", "aerosolExtinctionPerMeter", "angstromExponent", "rayleighExponent"], "extinction");
  requirePositiveFinite("extinction.referenceWavelengthNm", model.referenceWavelengthNm);
  const betaR = requireNonNegativeFinite(
    "extinction.rayleighExtinctionPerMeter",
    model.rayleighExtinctionPerMeter
  );
  const betaA = requireNonNegativeFinite(
    "extinction.aerosolExtinctionPerMeter",
    model.aerosolExtinctionPerMeter
  );
  const alpha = requireFinite("extinction.angstromExponent", model.angstromExponent);
  const rayleighExponent =
    model.rayleighExponent === undefined
      ? 4
      : requireFinite("extinction.rayleighExponent", model.rayleighExponent);
  if (alpha < -1 || alpha > 4 || rayleighExponent < 3.5 || rayleighExponent > 4.5) {
    throw new InvalidScientificInputError(
      "extinction.angstromExponent must lie in [-1, 4] and rayleighExponent in [3.5, 4.5]."
    );
  }

  const ratio = input.wavelengthNm / model.referenceWavelengthNm;
  const rayleigh = betaR * ratio ** -rayleighExponent;
  const aerosol = betaA * ratio ** -alpha;
  const beta = rayleigh + aerosol;
  const opticalDepth = beta * d;
  const transmittance = Math.exp(-opticalDepth);
  const attenuated = l0 * transmittance;
  // -expm1(-tau) = 1 - t without cancellation for thin haze.
  const airlight = lAir * -Math.expm1(-opticalDepth);
  return approximationResult(
    {
      wavelengthNm: input.wavelengthNm,
      pathLengthM: d,
      rayleighExtinctionPerMeter: rayleigh,
      aerosolExtinctionPerMeter: aerosol,
      extinctionPerMeter: beta,
      opticalDepth,
      transmittance,
      attenuatedSceneRadiance: attenuated,
      airlightContribution: airlight,
      hazedRadiance: attenuated + airlight,
      contrastTransmittance: transmittance
    },
    "koschmieder-homogeneous-haze",
    "1.0.0",
    [
      "Koschmieder model: L = L0 exp(-beta d) + L_air (1 - exp(-beta d)) along one homogeneous horizontal line of sight",
      `Extinction = Rayleigh (lambda^-${rayleighExponent}) + aerosol Angstrom law (lambda^-${alpha}) scaled from caller reference coefficients`,
      "Airlight radiance is caller-supplied; sky gradients, multiple-scattering angular structure, absorption bands and slant-path density changes are not modeled",
      "Radiance unit is whatever the caller supplies; the model is linear in it"
    ]
  );
}

/**
 * Extinction coefficient from meteorological visibility with Koschmieder's relation
 * beta = -ln(epsilon) / V.
 */
export function calculateExtinctionFromVisibility(
  input: CalculateExtinctionFromVisibilityInput
): CalculationResult<{ extinctionPerMeter: number; contrastThreshold: number }> {
  requireInputKeys(input, "calculateExtinctionFromVisibility", ["visibilityM", "contrastThreshold"]);
  requirePositiveFinite("visibilityM", input.visibilityM);
  const epsilon = input.contrastThreshold ?? 0.02;
  if (typeof epsilon !== "number" || !(epsilon > 0) || !(epsilon < 1)) {
    throw new InvalidScientificInputError("contrastThreshold must lie in (0, 1).");
  }
  return calculatedResult(
    {
      extinctionPerMeter: -Math.log(epsilon) / input.visibilityM,
      contrastThreshold: epsilon
    },
    "koschmieder-visibility-extinction",
    "1.0.0",
    [
      "Koschmieder relation for a black target against the horizon in a homogeneous atmosphere",
      "Threshold 0.02 is Koschmieder's; WMO meteorological optical range uses 0.05"
    ]
  );
}
