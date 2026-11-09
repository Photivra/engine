// SPDX-License-Identifier: Apache-2.0

/**
 * Wavelength types and parsers: a wavelength basis (air or vacuum), a single wavelength and a
 * wavelength interval, all in nanometres.
 * @see docs/API_STYLE.md for equations, coordinate/unit conventions, blockers and support limits.
 */

import { InvalidConfigurationError } from "./configuration-error.js";
import { requireConfigRecord as requireRecord, requireConfigPositiveFinite as requirePositiveFinite } from "./record-validation.js";


/**
 * Whether wavelengths are measured in air or in vacuum.
 *
 * "unspecified" is allowed only where a downstream contract explicitly accepts
 * unresolved or approximate wavelengths. Calibrated physical calculations must
 * resolve the basis first.
 */
export type SpectralWavelengthBasis =
  | "air"
  | "vacuum"
  | "unspecified";

/**
 * One wavelength coordinate expressed in nanometres.
 */
export interface SpectralWavelengthSample {
  wavelengthNanometers: number;
}

/**
 * Closed wavelength interval expressed in nanometres.
 */
export interface SpectralWavelengthRangeNanometers {
  minimum: number;
  maximum: number;
}

/**
 * Parses a wavelength basis. It never converts between air and vacuum.
 */
export function parseSpectralWavelengthBasis(
  value: unknown,
  path = "wavelengthBasis"
): SpectralWavelengthBasis {
  if (
    value !== "air" &&
    value !== "vacuum" &&
    value !== "unspecified"
  ) {
    throw new InvalidConfigurationError(
      path + " is invalid."
    );
  }
  return value;
}

/**
 * Parses one positive wavelength coordinate in nanometres.
 */
export function parseSpectralWavelengthSample(
  value: unknown,
  path = "spectralSample"
): SpectralWavelengthSample {
  const record = requireRecord(value, path, ["wavelengthNanometers"]);
  return {
    wavelengthNanometers:
      requirePositiveFinite(
        record.wavelengthNanometers,
        path + ".wavelengthNanometers"
      )
  };
}

/**
 * Parses a positive non-empty wavelength interval in nanometres.
 */
export function parseSpectralWavelengthRangeNanometers(
  value: unknown,
  path = "wavelengthRangeNanometers"
): SpectralWavelengthRangeNanometers {
  const record = requireRecord(value, path, ["minimum", "maximum"]);
  const minimum = requirePositiveFinite(
    record.minimum,
    path + ".minimum"
  );
  const maximum = requirePositiveFinite(
    record.maximum,
    path + ".maximum"
  );

  if (!(minimum < maximum)) {
    throw new InvalidConfigurationError(
      path + ".minimum must be less than maximum."
    );
  }

  return { minimum, maximum };
}
