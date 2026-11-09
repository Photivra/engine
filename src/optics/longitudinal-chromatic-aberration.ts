// SPDX-License-Identifier: Apache-2.0

/**
 * Longitudinal (axial) chromatic aberration: wavelength-dependent focal length and the resulting
 * per-wavelength image-plane defocus for a sensor focused at a reference wavelength.
 *
 * Two dispersion inputs:
 * - thin-singlet-abbe: an ideal thin singlet whose index follows a two-term Cauchy dispersion
 *   n(lambda) = A + B / lambda^2 fitted to n_d and the Abbe number V_d = (n_d - 1) / (n_F - n_C)
 *   (Cauchy 1836; Oh 2023, arXiv:2309.09375, sec. 2.3.1(b), free; Abbe number: Greivenkamp,
 *   OPTI-502 course notes, University of Arizona, sec. 17, free. Also see: Born & Wolf, Principles
 *   of Optics, sec. 2.3; Hecht, Optics, 5th ed., sec. 3.5 and 6.3). Lensmaker scaling gives
 *   f(lambda) = f_ref (n_ref - 1) / (n(lambda) - 1), so f_C - f_F ~ f_d / V_d (Greivenkamp,
 *   OPTI-502 course notes, sec. 20, free. Also see: Hecht sec. 6.3.2; Kingslake & Johnson, Lens
 *   Design Fundamentals, 2nd ed., ch. 5). The Fraunhofer d, F and C wavelengths (587.5618, 486.1327, 656.2725 nm) are standard
 *   spectral-line constants (SCHOTT Technical Information TIE-29, 2023, free; also specified in
 *   ISO 7944). A real multi-element lens is not a singlet, so this is an educational
 *   approximation.
 * - declared-focal-shift: a caller-supplied table of focal-length shift versus wavelength
 *   (for example a corrected lens's secondary spectrum), interpolated linearly without extrapolation.
 *
 * How defocus is computed:
 * - The sensor sits at the Gaussian thin-lens image distance for focusDistanceM at the reference
 *   wavelength.
 * - At each wavelength, the image distance of subjectDistanceM uses f(lambda).
 * - The signed image-plane defocus dz is the sensor distance minus that image distance.
 * - The geometric blur diameter is D |dz| / v(lambda), where D = f_ref / N is the entrance-pupil
 *   diameter. This is the same thin-lens form as calculateDefocusCircle().
 * The defocus also feeds calculateDefocusWavefront(), so a complex-pupil PSF (point-spread function)
 * can be evaluated per wavelength.
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
import { calculateDefocusWavefront } from "./zernike-wavefront.js";
import { requireInputKeys, requireNamedFinite as requireFinite } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

/** Fraunhofer spectral-line wavelengths in nm (SCHOTT TIE-29 table; also ISO 7944 reference wavelengths). */
export const FRAUNHOFER_D_LINE_NM = 587.5618;
export const FRAUNHOFER_F_LINE_NM = 486.1327;
export const FRAUNHOFER_C_LINE_NM = 656.2725;

const CAUCHY_MINIMUM_WAVELENGTH_NM = 360;
const CAUCHY_MAXIMUM_WAVELENGTH_NM = 830;

export type LongitudinalChromaticDispersion =
  | {
      kind: "thin-singlet-abbe";
      /** Refractive index at the d line. */
      refractiveIndexD: number;
      /** Abbe number V_d = (n_d - 1) / (n_F - n_C). */
      abbeNumberD: number;
    }
  | {
      kind: "declared-focal-shift";
      /** Strictly increasing wavelengths; shift is f(lambda) - f_nominal in micrometres. */
      samples: readonly {
        wavelengthNm: number;
        focalLengthShiftMicrometers: number;
      }[];
    };

export interface CalculateLongitudinalChromaticFocusInput {
  /** Focal length at the reference wavelength, in mm. */
  focalLengthMm: number;
  /** Wavelength at which the sensor is focused, in nm. */
  referenceWavelengthNm: number;
  /** Wavelength to evaluate, in nm (same wavelength basis as the dispersion data). */
  wavelengthNm: number;
  /** Nominal f-number at the reference wavelength (entrance-pupil diameter = f / N). */
  apertureFNumber: number;
  /** Focus (object) distance at the reference wavelength, metres from the principal plane. */
  focusDistanceM: number;
  /** Subject distance in metres; defaults to focusDistanceM. */
  subjectDistanceM?: number;
  dispersion: LongitudinalChromaticDispersion;
}

export interface LongitudinalChromaticFocus {
  wavelengthNm: number;
  referenceWavelengthNm: number;
  focalLengthAtWavelengthMm: number;
  /** f(lambda) - f(reference), micrometres. */
  focalShiftMicrometers: number;
  /** Sensor plane distance (reference-wavelength image of the focus plane), mm. */
  sensorImageDistanceMm: number;
  /** Image distance of the subject at this wavelength, mm. */
  imageDistanceAtWavelengthMm: number;
  /** Sensor minus image distance, micrometres. */
  signedDefocusImagePlaneMicrometers: number;
  /** Geometric thin-lens blur-circle diameter at the sensor, mm. */
  geometricBlurDiameterMm: number;
  /** Image-side working f-number v(lambda) / D. */
  workingFNumberAtWavelength: number;
  /** Defocus wave aberration W020 for the complex-pupil PSF, micrometres. */
  w020Micrometers: number;
  /** Equivalent Noll Z4 coefficient, micrometres. */
  zernikeZ4Micrometers: number;
}

function cauchyIndex(
  refractiveIndexD: number,
  abbeNumberD: number,
  wavelengthNm: number
): number {
  const inverseSquare = (nm: number): number => 1 / (nm / 1000) ** 2;
  const b =
    (refractiveIndexD - 1) /
    abbeNumberD /
    (inverseSquare(FRAUNHOFER_F_LINE_NM) - inverseSquare(FRAUNHOFER_C_LINE_NM));
  return (
    refractiveIndexD +
    b * (inverseSquare(wavelengthNm) - inverseSquare(FRAUNHOFER_D_LINE_NM))
  );
}

/**
 * Two-term Cauchy refractive index fitted to n_d and V_d. Valid as an approximation over
 * 360-830 nm only.
 */
export function calculateCauchyRefractiveIndex(input: {
  refractiveIndexD: number;
  abbeNumberD: number;
  wavelengthNm: number;
}): CalculationResult<{ refractiveIndex: number }> {
  requireInputKeys(input, "calculateCauchyRefractiveIndex", ["refractiveIndexD", "abbeNumberD", "wavelengthNm"]);
  validateAbbe(input.refractiveIndexD, input.abbeNumberD);
  validateCauchyWavelength("wavelengthNm", input.wavelengthNm);
  return approximationResult(
    {
      refractiveIndex: cauchyIndex(
        input.refractiveIndexD,
        input.abbeNumberD,
        input.wavelengthNm
      )
    },
    "two-term-cauchy-abbe-dispersion",
    "1.0.0",
    [
      "n(lambda) = A + B / lambda^2 fitted exactly to n_d and V_d = (n_d - 1) / (n_F - n_C)",
      "Two-term Cauchy dispersion is an approximation for normal dispersion in the visible (360-830 nm)"
    ]
  );
}

function validateAbbe(refractiveIndexD: unknown, abbeNumberD: unknown): void {
  const n = requireFinite("dispersion.refractiveIndexD", refractiveIndexD);
  const v = requireFinite("dispersion.abbeNumberD", abbeNumberD);
  if (n <= 1 || n > 4) {
    throw new InvalidScientificInputError(
      "dispersion.refractiveIndexD must lie in (1, 4]."
    );
  }
  if (v < 5 || v > 200) {
    throw new InvalidScientificInputError(
      "dispersion.abbeNumberD must lie in [5, 200]."
    );
  }
}

function validateCauchyWavelength(name: string, value: unknown): void {
  const wavelength = requireFinite(name, value);
  if (
    wavelength < CAUCHY_MINIMUM_WAVELENGTH_NM ||
    wavelength > CAUCHY_MAXIMUM_WAVELENGTH_NM
  ) {
    throw new InvalidScientificInputError(
      `${name} must lie in ${CAUCHY_MINIMUM_WAVELENGTH_NM}-${CAUCHY_MAXIMUM_WAVELENGTH_NM} nm for the Cauchy dispersion approximation.`
    );
  }
}

function interpolateShift(
  samples: readonly { wavelengthNm: number; focalLengthShiftMicrometers: number }[],
  wavelengthNm: number,
  name: string
): number {
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (wavelengthNm < first.wavelengthNm || wavelengthNm > last.wavelengthNm) {
    throw new InvalidScientificInputError(
      `${name} lies outside the declared focal-shift wavelength range; extrapolation is not performed.`
    );
  }
  for (let index = 1; index < samples.length; index += 1) {
    const right = samples[index]!;
    if (wavelengthNm <= right.wavelengthNm) {
      const left = samples[index - 1]!;
      const t = (wavelengthNm - left.wavelengthNm) / (right.wavelengthNm - left.wavelengthNm);
      return (
        left.focalLengthShiftMicrometers +
        t * (right.focalLengthShiftMicrometers - left.focalLengthShiftMicrometers)
      );
    }
  }
  return first.focalLengthShiftMicrometers;
}

function parseSamples(
  value: unknown
): readonly { wavelengthNm: number; focalLengthShiftMicrometers: number }[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 1024) {
    throw new InvalidScientificInputError(
      "dispersion.samples must contain 2 through 1024 entries."
    );
  }
  let previous = 0;
  return value.map((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new InvalidConfigurationError(`dispersion.samples[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const wavelengthNm = requireFinite(`dispersion.samples[${index}].wavelengthNm`, record.wavelengthNm);
    if (wavelengthNm <= previous) {
      throw new InvalidScientificInputError(
        "dispersion.samples wavelengths must be positive and strictly increasing."
      );
    }
    previous = wavelengthNm;
    return {
      wavelengthNm,
      focalLengthShiftMicrometers: requireFinite(
        `dispersion.samples[${index}].focalLengthShiftMicrometers`,
        record.focalLengthShiftMicrometers
      )
    };
  });
}

function imageDistanceMm(focalLengthMm: number, objectDistanceM: number): number {
  const objectMm = objectDistanceM * 1000;
  if (objectMm <= focalLengthMm) {
    throw new InvalidScientificInputError(
      "Object distances must lie beyond the wavelength-dependent focal length."
    );
  }
  return (focalLengthMm * objectMm) / (objectMm - focalLengthMm);
}

/**
 * Wavelength-dependent focus for one wavelength: focal length, image distance, signed defocus at
 * a sensor focused at the reference wavelength, geometric blur and the defocus wavefront.
 */
export function calculateLongitudinalChromaticFocus(
  input: CalculateLongitudinalChromaticFocusInput
): CalculationResult<LongitudinalChromaticFocus> {
  requireInputKeys(input, "calculateLongitudinalChromaticFocus", ["focalLengthMm", "referenceWavelengthNm", "wavelengthNm", "apertureFNumber", "focusDistanceM", "subjectDistanceM", "dispersion"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requirePositiveFinite("referenceWavelengthNm", input.referenceWavelengthNm);
  requirePositiveFinite("wavelengthNm", input.wavelengthNm);
  requirePositiveFinite("apertureFNumber", input.apertureFNumber);
  requirePositiveFinite("focusDistanceM", input.focusDistanceM);
  const subjectDistanceM = input.subjectDistanceM ?? input.focusDistanceM;
  requirePositiveFinite("subjectDistanceM", subjectDistanceM);
  const dispersion = input.dispersion;
  if (typeof dispersion !== "object" || dispersion === null) {
    throw new InvalidConfigurationError("dispersion must be an object.");
  }

  let focalLengthAtWavelengthMm: number;
  let model: string;
  let dispersionAssumption: string;
  if (dispersion.kind === "thin-singlet-abbe") {
    validateAbbe(dispersion.refractiveIndexD, dispersion.abbeNumberD);
    validateCauchyWavelength("referenceWavelengthNm", input.referenceWavelengthNm);
    validateCauchyWavelength("wavelengthNm", input.wavelengthNm);
    const nRef = cauchyIndex(dispersion.refractiveIndexD, dispersion.abbeNumberD, input.referenceWavelengthNm);
    const nLambda = cauchyIndex(dispersion.refractiveIndexD, dispersion.abbeNumberD, input.wavelengthNm);
    focalLengthAtWavelengthMm = (input.focalLengthMm * (nRef - 1)) / (nLambda - 1);
    model = "thin-singlet-abbe-longitudinal-chromatic-focus";
    dispersionAssumption =
      "Ideal thin singlet with two-term Cauchy dispersion fitted to n_d and V_d; f(lambda) = f_ref (n_ref - 1) / (n(lambda) - 1)";
  } else if (dispersion.kind === "declared-focal-shift") {
    const samples = parseSamples(dispersion.samples);
    const shiftRef = interpolateShift(samples, input.referenceWavelengthNm, "referenceWavelengthNm");
    const shift = interpolateShift(samples, input.wavelengthNm, "wavelengthNm");
    focalLengthAtWavelengthMm = input.focalLengthMm + (shift - shiftRef) / 1000;
    model = "declared-focal-shift-longitudinal-chromatic-focus";
    dispersionAssumption =
      "Caller-declared focal-length shift table, linearly interpolated and re-referenced to the reference wavelength; no extrapolation";
  } else {
    throw new InvalidConfigurationError("dispersion.kind is invalid.");
  }
  if (!(focalLengthAtWavelengthMm > 0) || !Number.isFinite(focalLengthAtWavelengthMm)) {
    throw new InvalidScientificInputError(
      "Wavelength-dependent focal length must remain finite and positive."
    );
  }

  const sensorImageDistanceMm = imageDistanceMm(input.focalLengthMm, input.focusDistanceM);
  const imageDistanceAtWavelengthMm = imageDistanceMm(focalLengthAtWavelengthMm, subjectDistanceM);
  const pupilDiameterMm = input.focalLengthMm / input.apertureFNumber;
  const defocusMm = sensorImageDistanceMm - imageDistanceAtWavelengthMm;
  const workingFNumberAtWavelength = imageDistanceAtWavelengthMm / pupilDiameterMm;
  const wavefront = calculateDefocusWavefront({
    signedDefocusImagePlaneMicrometers: defocusMm * 1000,
    workingFNumber: workingFNumberAtWavelength
  }).value;

  return approximationResult(
    {
      wavelengthNm: input.wavelengthNm,
      referenceWavelengthNm: input.referenceWavelengthNm,
      focalLengthAtWavelengthMm,
      focalShiftMicrometers: (focalLengthAtWavelengthMm - input.focalLengthMm) * 1000,
      sensorImageDistanceMm,
      imageDistanceAtWavelengthMm,
      signedDefocusImagePlaneMicrometers: defocusMm * 1000,
      geometricBlurDiameterMm:
        (pupilDiameterMm * Math.abs(defocusMm)) / imageDistanceAtWavelengthMm,
      workingFNumberAtWavelength,
      w020Micrometers: wavefront.w020Micrometers,
      zernikeZ4Micrometers: wavefront.zernikeZ4Micrometers
    },
    model,
    "1.0.0",
    [
      dispersionAssumption,
      "Gaussian thin-lens imaging; the sensor is focused on focusDistanceM at the reference wavelength",
      "Entrance-pupil diameter f_ref / N is wavelength independent; distances are measured from ideal principal planes",
      "Longitudinal chromatic focus only: lateral chromatic magnification, spherochromatism and sensor response are separate",
      "Wavelength basis must match the dispersion data; no air/vacuum conversion is performed"
    ]
  );
}
