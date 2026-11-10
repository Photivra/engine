// SPDX-License-Identifier: Apache-2.0

/**
 * How much to crop an image from a shorter lens so it matches a longer lens's framing, and the
 * pixels that leaves.
 *
 * For an ideal rectilinear lens focused at infinity, a scene point at field angle θ images at
 * height y' = f·tan θ (Greivenkamp, OPTI-502 course notes, sec. 12 (Objectives), free:
 * https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-12-Objectives.pdf).
 * From the same camera position the image of focal length F is the image of f scaled by F/f, so a
 * centred crop by the linear factor F/f gives the same framing and the same perspective: exact at
 * infinity focus, to whole pixels.
 *
 * At close focus the thin-lens magnification is m = f/(d − f) for an object distance d from the
 * lens, so at the same d the factor is F·(d − f)/(f·(d − F)), larger than F/f and tending to it when
 * d is much greater than F. That correction, distortion and focus breathing are not modelled.
 * @see docs/PHYSICS_FOUNDATION.md "Crop to match a longer focal length".
 */

import { calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { requireInputKeys } from "../core/record-validation.js";
import { InvalidScientificInputError, requirePositiveFinite } from "../core/validation.js";
import { calculateCenteredCrop } from "./crop.js";

export interface CalculateCropToMatchFocalLengthInput {
  /** Focal length the image was taken with, in millimetres. */
  focalLengthMm: number;
  /** Longer focal length whose framing the crop should match, in millimetres. At least `focalLengthMm`. */
  targetFocalLengthMm: number;
  /** Image width in pixels (for example the sensor's output width). */
  pixelWidth: number;
  /** Image height in pixels. */
  pixelHeight: number;
}

export interface CropToMatchFocalLength {
  /** Focal length supplied by the caller, in millimetres. */
  focalLengthMm: number;
  /** Target focal length supplied by the caller, in millimetres. */
  targetFocalLengthMm: number;
  /** Linear crop factor targetFocalLengthMm / focalLengthMm (1 means no crop). */
  cropFactor: number;
  /** Width left after the centred crop, in pixels (as `calculateCenteredCrop`). */
  pixelWidth: number;
  /** Height left after the centred crop, in pixels. */
  pixelHeight: number;
  /** Pixels left, in millions. */
  megapixels: number;
  /** Megapixels of the uncropped image. */
  sourceMegapixels: number;
  /** Fraction of the original pixel area retained, about 1 / cropFactor². */
  retainedAreaFraction: number;
}

/**
 * The centred crop that makes an image from a shorter lens match a longer lens's framing from the
 * same position: crop factor target ÷ focal length, and the pixels and megapixels left.
 *
 * Exact for ideal rectilinear lenses focused at infinity, to whole pixels (the crop is
 * `calculateCenteredCrop`'s, which keeps the aspect ratio). At close focus the matching factor is
 * larger, F·(d − f)/(f·(d − F)) at object distance d (thin lens); that, distortion and focus
 * breathing are not modelled. The crop has the longer lens's framing and perspective but fewer
 * pixels: it records no more detail than the cropped part of the shorter lens's image.
 *
 * Example: a 24 MP (6000 × 4000) image at 50 mm cropped to match 100 mm: factor 2, 3000 × 2000,
 * 6 MP.
 *
 * @param input Focal length, longer target focal length and the image's pixel dimensions.
 * @returns Crop factor and the remaining pixel dimensions.
 */
export function calculateCropToMatchFocalLength(
  input: CalculateCropToMatchFocalLengthInput
): CalculationResult<CropToMatchFocalLength> {
  requireInputKeys(input, "calculateCropToMatchFocalLength", ["focalLengthMm", "targetFocalLengthMm", "pixelWidth", "pixelHeight"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requirePositiveFinite("targetFocalLengthMm", input.targetFocalLengthMm);
  if (input.targetFocalLengthMm < input.focalLengthMm) {
    throw new InvalidScientificInputError(
      "targetFocalLengthMm must be greater than or equal to focalLengthMm: a crop cannot widen the framing."
    );
  }
  const cropFactor = input.targetFocalLengthMm / input.focalLengthMm;
  const crop = calculateCenteredCrop({ pixelWidth: input.pixelWidth, pixelHeight: input.pixelHeight, cropFactor }).value;
  return calculatedResult(
    {
      focalLengthMm: input.focalLengthMm,
      targetFocalLengthMm: input.targetFocalLengthMm,
      cropFactor,
      pixelWidth: crop.pixelWidth,
      pixelHeight: crop.pixelHeight,
      megapixels: crop.megapixels,
      sourceMegapixels: (input.pixelWidth * input.pixelHeight) / 1_000_000,
      retainedAreaFraction: crop.retainedAreaFraction
    },
    "crop-to-match-focal-length",
    "1.0.0",
    [
      "Crop factor = target focal length / focal length: exact for ideal rectilinear lenses focused at infinity, from the same camera position.",
      "At close focus the thin-lens matching factor is F·(d − f)/(f·(d − F)) at object distance d, larger than F/f; not modelled.",
      "Distortion and focus breathing are not modelled.",
      "Centred crop that keeps the aspect ratio to whole pixels (calculateCenteredCrop)."
    ]
  );
}
