// SPDX-License-Identifier: Apache-2.0

/**
 * Shutter time that keeps the same exposure after neutral-density (or any passive) filters are put
 * in front of the lens.
 *
 * Focal-plane exposure is H = 0.65·L·t/N² (CIPA DC-004-2020 §5.5 (4), free:
 * https://www.cipa.jp/e/std/std-sec.html) and, more generally, the time integral of image-plane
 * irradiance, H = E·t (EMVA Standard 1288 Release 4.0 Linear, §2, free). A front-of-lens filter
 * with intensity transmittance T multiplies the light reaching the lens, and so E, by T. The same
 * exposure at the same f-number therefore needs
 *
 *   t_filtered = t / T = t · 2^stops,  stops = −log2 T = OD / log10 2,
 *
 * exact under the linear (reciprocity) model of a digital sensor, whose collected charge is
 * proportional to H. Film reciprocity failure is not modelled. T comes from the caller's
 * front-of-lens filter profiles through `composeFrontOfLensFilterTransmission`, so nominal filter
 * values (a "10-stop" filter, or OD 3.0 = 9.97 stops) are only as good as the profile: real filters
 * vary from their nominal rating and with wavelength.
 * @see docs/PHYSICS_FOUNDATION.md "Exposure time with an ND filter".
 */

import { approximationResult, calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { portableLog2 } from "../core/portable-math.js";
import { requireInputKeys } from "../core/record-validation.js";
import type { SpectralWavelengthBasis } from "../core/spectral.js";
import { InvalidScientificResultError, requirePositiveFinite } from "../core/validation.js";
import {
  composeFrontOfLensFilterTransmission,
  type ComposedFrontOfLensFilterTransmission,
  type FrontOfLensFilterProfile,
  type LinearPolarizationState
} from "../optics/front-of-lens-filter.js";

/** Wavelength used when the caller gives none: 550 nm, near the photopic peak. Neutral filters do not depend on it. */
export const FILTERED_EXPOSURE_DEFAULT_WAVELENGTH_NANOMETERS = 550 as const;

export interface CalculateFilteredExposureTimeInput {
  /** Shutter time without the filter, in seconds. */
  shutterSeconds: number;
  /**
   * One front-of-lens filter profile, or several in light-path order (scene side first), as
   * accepted by `composeFrontOfLensFilterTransmission`.
   */
  filter: FrontOfLensFilterProfile | readonly FrontOfLensFilterProfile[];
  /**
   * Optional shutter dial, in seconds (for example `GENERIC_THIRD_STOP_SHUTTER_SECONDS`). When
   * given, the result also reports the nearest dial value (nearest in stops, the shorter on a tie).
   */
  shutterDialSeconds?: readonly number[];
  /** Wavelength at which the filters are resolved. Defaults to 550 nm. Neutral filters do not depend on it. */
  wavelengthNanometers?: number;
  /** Wavelength basis; defaults to the first filter profile's basis and must match every profile. */
  wavelengthBasis?: Exclude<SpectralWavelengthBasis, "unspecified">;
  /** Incident polarization, which matters only when a polarizer is in the stack. Omitted means unpolarized. */
  incidentPolarization?: LinearPolarizationState;
}

/** The dial value nearest the exact filtered shutter time. */
export interface FilteredExposureDialSetting {
  /** Nearest dial value in seconds. */
  shutterSeconds: number;
  /**
   * log2(dial / exact filtered time): exposure of the dial setting relative to the unfiltered
   * exposure, in stops. Positive is brighter (longer), negative darker.
   */
  exposureErrorStops: number;
  /** `"maximum"` when the exact time is longer than every dial value (use bulb for the exact time), `"minimum"` when shorter than every one. */
  clamped: false | "minimum" | "maximum";
  /** How the dial value was chosen. */
  quantizationPolicy: "nearest-log2-shorter-on-tie";
}

export interface FilteredExposureTime {
  /** Shutter time without the filter, in seconds. */
  shutterSeconds: number;
  /** Shutter time that gives the same exposure with the filter: shutterSeconds / linearTransmissionFactor. */
  filteredShutterSeconds: number;
  /** Combined intensity transmittance T of the filter stack, in (0, 1]. */
  linearTransmissionFactor: number;
  /** Combined attenuation −log2 T, in stops. */
  attenuationStops: number;
  /** Shutter multiplier 1/T = 2^attenuationStops. */
  exposureFactor: number;
  /** Wavelength at which the filters were resolved, in nanometres. */
  wavelengthNanometers: number;
  /** The filter-stack transmission this result is based on, with each filter's identity and evidence. */
  filterTransmission: ComposedFrontOfLensFilterTransmission;
  /** Nearest shutter-dial value; present only when `shutterDialSeconds` was given. */
  dial?: FilteredExposureDialSetting;
}

function nearestDialValue(exactSeconds: number, dial: readonly number[]): FilteredExposureDialSetting {
  const values = [...dial].sort((a, b) => a - b);
  const first = values[0]!, last = values[values.length - 1]!;
  let selected = first;
  let clamped: FilteredExposureDialSetting["clamped"] = false;
  if (exactSeconds < first) {
    clamped = "minimum";
  } else if (exactSeconds > last) {
    selected = last;
    clamped = "maximum";
  } else {
    let best = Math.abs(portableLog2(exactSeconds / first));
    for (let index = 1; index < values.length; index += 1) {
      const candidate = values[index]!;
      const distance = Math.abs(portableLog2(exactSeconds / candidate));
      // Ascending order: a later candidate wins only when strictly nearer, so a tie keeps the shorter time.
      if (distance < best - 1e-12) {
        selected = candidate;
        best = distance;
      }
    }
  }
  return {
    shutterSeconds: selected,
    exposureErrorStops: portableLog2(selected / exactSeconds),
    clamped,
    quantizationPolicy: "nearest-log2-shorter-on-tie"
  };
}

/**
 * Shutter time that keeps the same exposure after adding front-of-lens filters, such as a
 * neutral-density (ND) filter: t / T, with T the combined transmittance of the filter profiles.
 * Aperture and ISO are unchanged.
 *
 * Exact under the linear sensor model (exposure H = E·t); film reciprocity failure is not modelled.
 * Nominal filters vary: a "10-stop" or ND1000 (OD 3.0, 9.97 stops) filter transmits roughly, not
 * exactly, its rating, so the result is only as good as the profile. The envelope is an
 * approximation whenever any profile's `scientificStatus` is `"approximation"`.
 *
 * Example: 1/125 s with a 10-stop filter gives 1024/125 ≈ 8.19 s; on a third-stop dial, 8 s.
 *
 * @param input Unfiltered shutter time, filter profile(s), optional dial, wavelength and polarization.
 * @returns The filtered shutter time, the filter attenuation and, with a dial, the nearest dial value.
 */
export function calculateFilteredExposureTime(
  input: CalculateFilteredExposureTimeInput
): CalculationResult<FilteredExposureTime> {
  requireInputKeys(input, "calculateFilteredExposureTime",
    ["shutterSeconds", "filter", "shutterDialSeconds", "wavelengthNanometers", "wavelengthBasis", "incidentPolarization"]);
  requirePositiveFinite("shutterSeconds", input.shutterSeconds);
  const filters: readonly FrontOfLensFilterProfile[] = Array.isArray(input.filter)
    ? input.filter
    : [input.filter as FrontOfLensFilterProfile];
  const firstFilter: unknown = filters[0];
  if (typeof firstFilter !== "object" || firstFilter === null) {
    throw new InvalidConfigurationError("filter must be a front-of-lens filter profile or a non-empty array of them.");
  }
  const wavelengthNanometers = input.wavelengthNanometers ?? FILTERED_EXPOSURE_DEFAULT_WAVELENGTH_NANOMETERS;
  const wavelengthBasis = input.wavelengthBasis ?? (firstFilter as FrontOfLensFilterProfile).wavelengthBasis;
  if (input.shutterDialSeconds !== undefined) {
    if (!Array.isArray(input.shutterDialSeconds) || input.shutterDialSeconds.length === 0) {
      throw new InvalidConfigurationError("shutterDialSeconds must be a non-empty array of shutter times in seconds.");
    }
    input.shutterDialSeconds.forEach((value: unknown, index) => {
      requirePositiveFinite(`shutterDialSeconds[${index}]`, value as number);
    });
  }

  const filterTransmission = composeFrontOfLensFilterTransmission({
    filters,
    wavelengthNanometers,
    wavelengthBasis,
    ...(input.incidentPolarization === undefined ? {} : { incidentPolarization: input.incidentPolarization })
  });
  const linearTransmissionFactor = filterTransmission.combinedLinearTransmissionFactor;
  const exposureFactor = 1 / linearTransmissionFactor;
  const filteredShutterSeconds = input.shutterSeconds / linearTransmissionFactor;
  if (!Number.isFinite(exposureFactor) || !Number.isFinite(filteredShutterSeconds)) {
    throw new InvalidScientificResultError("Filtered shutter time must remain finite.");
  }

  const value: FilteredExposureTime = {
    shutterSeconds: input.shutterSeconds,
    filteredShutterSeconds,
    linearTransmissionFactor,
    attenuationStops: filterTransmission.combinedAttenuationStops,
    exposureFactor,
    wavelengthNanometers: filterTransmission.wavelengthNanometers,
    filterTransmission,
    ...(input.shutterDialSeconds === undefined ? {} : { dial: nearestDialValue(filteredShutterSeconds, input.shutterDialSeconds) })
  };
  const assumptions = [
    "Same exposure at the same f-number and ISO: filtered time = shutter time / T, from exposure H = E·t (linear sensor, CIPA DC-004-2020 §5.5; EMVA 1288 §2).",
    "Reciprocity failure is not modelled: digital sensors respond linearly to exposure; film does not at long times.",
    "T is the filter profiles' combined transmittance; nominal filters vary from their rating and with wavelength.",
    `Filters resolved at ${filterTransmission.wavelengthNanometers} nm (${wavelengthBasis}); neutral filters do not depend on wavelength.`,
    "Inter-filter reflections, flare, light leaks around the filter and through the viewfinder are not modelled."
  ];
  return filterTransmission.scientificStatus === "approximation"
    ? approximationResult(value, "filtered-exposure-time", "1.0.0", assumptions)
    : calculatedResult(value, "filtered-exposure-time", "1.0.0", assumptions);
}
