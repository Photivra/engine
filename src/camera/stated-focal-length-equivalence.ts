// SPDX-License-Identifier: Apache-2.0

/**
 * The imaging area, and so the crop factor, that a file's stated focal lengths imply: FocalLength (the lens's real focal
 * length f) and FocalLengthIn35mmFilm (F35, Exif 2.32, CIPA DC-008-2019: the equivalent focal length on 35 mm film, a whole
 * number of millimeters), with the image's aspect ratio.
 *
 * It inverts the engine's 35 mm equivalence (`calculateEquivalentFocalLength35Mm`: F35 = k·f with the diagonal crop factor
 * k = 43.27 mm / diagonal): k = F35 / f, diagonal = 43.27 mm · f / F35, split into width and height by the image's aspect ratio.
 * Exif does not say whether a writer rounded F35 to the nearest millimeter or computed it on the diagonal; the result states both
 * assumptions, and the interval of F35 values that round to the stated one (F35 ± resolution / 2) carries through to every
 * quantity, so a caller can label a number exact or approximate.
 *
 * The area is that of the recorded image. It equals the sensor's active area only when the image is not cropped; a writer that
 * includes a digital zoom or an aspect-ratio crop in F35 gives the cropped area (docs/PHYSICS_FOUNDATION.md, "Sensor equivalence
 * from a file's 35 mm-equivalent focal length").
 */

import { approximationResult, calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { portableHypot } from "../core/portable-math.js";
import { requireInputKeys, requireInputNonNegativeFinite, requireInputPositiveFinite } from "../core/record-validation.js";
import type { SensorImagingArea } from "../sensor/sensor-geometry.js";
import { calculateSensorEquivalence, type EquivalenceExactness, type SensorEquivalence } from "./sensor-equivalence.js";

/** The diagonal of the 36 × 24 mm frame, mm. */
const FULL_FRAME_DIAGONAL_MM = portableHypot(36, 24);

export interface CalculateImagingAreaFromFocalLength35MmInput {
  /** The lens's real focal length (Exif FocalLength), mm. */
  focalLengthMm: number;
  /** The stated 35 mm-equivalent focal length (Exif FocalLengthIn35mmFilm), mm. */
  focalLength35MmEquivalentMm: number;
  /** The recorded image's width and height, pixels (stored or oriented; only their ratio is used, square pixels assumed). */
  imageWidthPixels: number;
  imageHeightPixels: number;
  /**
   * The step the 35 mm value was stated to, mm: the true value is taken to lie within ± half of it. Default 1, Exif's whole-number
   * tag; 0 when the value is known exactly.
   */
  focalLength35MmResolutionMm?: number;
}

/** A closed interval. */
export interface StatedValueInterval { minimum: number; maximum: number }

export interface ImagingAreaFromFocalLength35Mm {
  /** The imaging area at the stated value. */
  imagingArea: SensorImagingArea;
  /** The imaging areas at the ends of the 35 mm value's interval (the largest at its lower end). */
  imagingAreaInterval: { smallest: SensorImagingArea; largest: SensorImagingArea };
  /** The area's diagonal at the stated value, mm. */
  diagonalMm: number;
  /** Diagonal crop factor F35 / f at the stated value. */
  cropFactor: number;
  cropFactorInterval: StatedValueInterval;
  /** (maximum − minimum) / (2 · cropFactor): the crop factor's relative uncertainty from the rounding; the same for the diagonal. */
  cropFactorRelativeHalfWidth: number;
  /** The 35 mm values that round to the stated one. */
  focalLength35MmInterval: StatedValueInterval;
  /** "exact" only when the resolution is 0; otherwise "approximation". */
  exactness: EquivalenceExactness;
  basis: {
    kind: "focal-length-in-35mm-film";
    /** Plain statement of the basis, its rounding and its assumptions. */
    statement: string;
  };
}

function area(diagonalMm: number, widthPixels: number, heightPixels: number): SensorImagingArea {
  const pixels = portableHypot(widthPixels, heightPixels);
  return { widthMm: (diagonalMm * widthPixels) / pixels, heightMm: (diagonalMm * heightPixels) / pixels };
}

function deriveArea(input: CalculateImagingAreaFromFocalLength35MmInput, name: string, extraKeys: readonly string[]): ImagingAreaFromFocalLength35Mm {
  requireInputKeys(input, name, ["focalLengthMm", "focalLength35MmEquivalentMm", "imageWidthPixels", "imageHeightPixels", "focalLength35MmResolutionMm", ...extraKeys]);
  const f = requireInputPositiveFinite(input.focalLengthMm, "focalLengthMm");
  const f35 = requireInputPositiveFinite(input.focalLength35MmEquivalentMm, "focalLength35MmEquivalentMm");
  const width = requireInputPositiveFinite(input.imageWidthPixels, "imageWidthPixels"), height = requireInputPositiveFinite(input.imageHeightPixels, "imageHeightPixels");
  const resolution = input.focalLength35MmResolutionMm === undefined ? 1 : requireInputNonNegativeFinite(input.focalLength35MmResolutionMm, "focalLength35MmResolutionMm");
  const low = f35 - resolution / 2, high = f35 + resolution / 2;
  if (!(low > 0)) throw new InvalidScientificInputError("focalLength35MmEquivalentMm must exceed half of focalLength35MmResolutionMm.");
  const diagonalMm = (FULL_FRAME_DIAGONAL_MM * f) / f35;
  const imagingArea = area(diagonalMm, width, height);
  if (!(imagingArea.widthMm > 0 && imagingArea.heightMm > 0 && Number.isFinite(imagingArea.widthMm) && Number.isFinite(imagingArea.heightMm))) {
    throw new InvalidScientificInputError("the focal lengths and image size must give a finite imaging area greater than zero.");
  }
  const cropFactor = f35 / f, cropFactorInterval = { minimum: low / f, maximum: high / f };
  const exact = resolution === 0;
  return {
    imagingArea,
    imagingAreaInterval: { smallest: area((FULL_FRAME_DIAGONAL_MM * f) / high, width, height), largest: area((FULL_FRAME_DIAGONAL_MM * f) / low, width, height) },
    diagonalMm, cropFactor, cropFactorInterval, cropFactorRelativeHalfWidth: (cropFactorInterval.maximum - cropFactorInterval.minimum) / (2 * cropFactor),
    focalLength35MmInterval: { minimum: low, maximum: high },
    exactness: exact ? "exact" : "approximation",
    basis: {
      kind: "focal-length-in-35mm-film",
      statement: "Imaging area from the file's 35 mm-equivalent focal length: crop factor = FocalLengthIn35mmFilm / FocalLength on the diagonal of the " +
        "36 × 24 mm frame, split by the image's aspect ratio (square pixels). " +
        (exact ? "The 35 mm value is taken as exact. " : "The 35 mm value is taken as rounded to the nearest " + resolution + " mm, so it lies within ±" + resolution / 2 + " mm. ") +
        "The area is that of the recorded image, which is the sensor's active area only when the image is not cropped."
    }
  };
}

const AREA_ASSUMPTIONS = [
  "35 mm equivalence is diagonal-based against the 36 × 24 mm frame; Exif does not say which convention a writer used.",
  "The image's aspect ratio is its pixel aspect ratio (square pixels).",
  "The area is that of the recorded image; a digital zoom or aspect crop included in the 35 mm value gives the cropped area, not the sensor's."
] as const;

/**
 * The imaging area (and diagonal crop factor) that a file's FocalLength and FocalLengthIn35mmFilm imply, with the interval the
 * 35 mm value's rounding allows and the basis used.
 *
 * Example: 6.2 mm stated as 27 mm on a 4:3 image gives crop factor 4.35 (4.27–4.44, ±1.9 %) and about 7.95 × 5.96 mm (7.80 × 5.85 to
 * 8.10 × 6.07 mm).
 *
 * @param input Focal length, stated 35 mm-equivalent focal length, image size in pixels and the 35 mm value's resolution.
 * @returns The area at the stated value, its interval, the crop factor and the exactness label.
 */
export function calculateImagingAreaFromFocalLength35Mm(input: CalculateImagingAreaFromFocalLength35MmInput): CalculationResult<ImagingAreaFromFocalLength35Mm> {
  const value = deriveArea(input, "calculateImagingAreaFromFocalLength35Mm", []);
  return value.exactness === "exact"
    ? calculatedResult(value, "imaging-area-from-35mm-focal-length", "1.0.0", AREA_ASSUMPTIONS)
    : approximationResult(value, "imaging-area-from-35mm-focal-length", "1.0.0", [...AREA_ASSUMPTIONS, "The 35 mm value's rounding gives an interval; see cropFactorInterval."]);
}

export interface CalculateSensorEquivalenceFromFocalLength35MmInput extends CalculateImagingAreaFromFocalLength35MmInput {
  /** f-number on the lens (Exif FNumber). */
  fNumber: number;
  /** Format to compare against. Defaults to the 36 × 24 mm frame. */
  reference?: SensorImagingArea;
}

export interface SensorEquivalenceFromFocalLength35Mm {
  /** The imaging area derived from the stated focal lengths. */
  derivedImagingArea: ImagingAreaFromFocalLength35Mm;
  /** `calculateSensorEquivalence` on the area at the stated value, with its per-quantity basis. */
  equivalence: SensorEquivalence;
  /** The same quantities over the 35 mm value's interval (from the largest and smallest areas). */
  intervals: {
    cropFactor: StatedValueInterval;
    equivalentFocalLengthMm: StatedValueInterval;
    equivalentFNumber: StatedValueInterval;
    areaRatio: StatedValueInterval;
    totalLightDifferenceStops: StatedValueInterval;
  };
}

/**
 * Sensor equivalence from a file's statements: the imaging area from FocalLength and FocalLengthIn35mmFilm
 * ({@link calculateImagingAreaFromFocalLength35Mm}), then `calculateSensorEquivalence` with the file's focal length and f-number,
 * plus each quantity's interval from the 35 mm value's rounding.
 *
 * Example: 6.2 mm f/1.8 stated as 27 mm on a 4:3 image gives an equivalent f-number of about f/7.84 (f/7.69–f/7.98) and −4.19
 * stops of total light (−4.24 to −4.14) against full frame.
 *
 * @param input The area inputs plus the f-number and an optional reference format.
 * @returns The derived area, the equivalence at the stated value and the intervals.
 */
export function calculateSensorEquivalenceFromFocalLength35Mm(
  input: CalculateSensorEquivalenceFromFocalLength35MmInput
): CalculationResult<SensorEquivalenceFromFocalLength35Mm> {
  const derived = deriveArea(input, "calculateSensorEquivalenceFromFocalLength35Mm", ["fNumber", "reference"]);
  const call = (sensor: SensorImagingArea): SensorEquivalence => calculateSensorEquivalence({ sensor, focalLengthMm: input.focalLengthMm, fNumber: input.fNumber,
    ...(input.reference === undefined ? {} : { reference: input.reference }) }).value;
  const equivalence = call(derived.imagingArea);
  const large = call(derived.imagingAreaInterval.largest), small = call(derived.imagingAreaInterval.smallest);
  const span = (key: "cropFactor" | "equivalentFocalLengthMm" | "equivalentFNumber" | "areaRatio" | "totalLightDifferenceStops"): StatedValueInterval => ({
    minimum: Math.min(large[key], small[key]), maximum: Math.max(large[key], small[key]) });
  return approximationResult(
    { derivedImagingArea: derived, equivalence, intervals: { cropFactor: span("cropFactor"), equivalentFocalLengthMm: span("equivalentFocalLengthMm"),
      equivalentFNumber: span("equivalentFNumber"), areaRatio: span("areaRatio"), totalLightDifferenceStops: span("totalLightDifferenceStops") } },
    "sensor-equivalence-from-35mm-focal-length",
    "1.0.0",
    [...AREA_ASSUMPTIONS, "Equivalence quantities carry the basis of calculateSensorEquivalence; the equivalent f-number is a thin-lens approximation.",
      derived.exactness === "exact" ? "The 35 mm value is taken as exact." : "The 35 mm value's rounding gives an interval for every quantity; see intervals."]
  );
}
