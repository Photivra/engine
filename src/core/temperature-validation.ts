// SPDX-License-Identifier: Apache-2.0

/**
 * #742 (2.29.0): temperatures in degrees Celsius must lie above absolute zero, 0 K = -273.15 °C (the definition of the
 * kelvin and the Celsius scale, BIPM, The International System of Units, 9th edition, 2019, sections 2.3.1 and 2.3.3, free).
 * Every Celsius input of the engine is checked with this after its finite check; Kelvin inputs are checked as positive or
 * against their model's range where they are read.
 */

import { InvalidConfigurationError } from "./configuration-error.js";

/** The value, if it is above absolute zero; else `<path> must be above absolute zero (-273.15 °C).` as `ErrorType`. */
export function requireAboveAbsoluteZeroCelsius(value: number, path: string, ErrorType: new (message: string) => Error = InvalidConfigurationError): number {
  if (!(value > -273.15)) throw new ErrorType(path + " must be above absolute zero (-273.15 °C).");
  return value;
}
