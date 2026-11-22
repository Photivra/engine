// SPDX-License-Identifier: Apache-2.0

/**
 * Centred crop that keeps the aspect ratio: the pixel dimensions left after cropping by a
 * linear crop factor.
 * @see docs/PROCESSED_OUTPUT.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite,
  requirePositiveInteger
} from "../core/validation.js";
import { requireInputKeys } from "../core/record-validation.js";

/** How close a quotient may be to the next whole pixel, in ULPs (units in the last place), and still count as it. */
const WHOLE_PIXEL_SNAP_ULPS = 4;

/**
 * The largest whole-pixel count not exceeding `length` (at least 1).
 *
 * A value at most 4 ULPs below the next integer counts as that integer. For example,
 * 4480 / (7 / 3) = 1919.9999999999998 is really 1920 plus the divisor's rounding
 * error, so floorWholePixels(4480 / (7 / 3)) returns 1920 instead of losing a pixel.
 *
 * The tolerance scales with the double-precision spacing of `length`, not with a
 * fixed fraction of it. So a truly fractional count (6000 / 1.0000000001, or
 * 1e9 / 1.5) is always rounded down, and the result never exceeds `length` by more
 * than that rounding error.
 * Internal to the repository; not exported from the package.
 */
export function floorWholePixels(length: number): number {
  const floor = Math.floor(length);
  const next = floor + 1;
  return Math.max(
    1,
    next - length <= WHOLE_PIXEL_SNAP_ULPS * Number.EPSILON * length ? next : floor
  );
}

/**
 * A pixel count within the same tolerance of a whole number, as that whole number; any other count unchanged. For counts
 * derived from exact sizes through binary64 unit conversions (30.48 cm / 25.4 × 300 = 3600.0000000000005). Internal.
 */
export function snapWholePixels(count: number): number {
  const whole = Math.round(count);
  return Math.abs(whole - count) <= WHOLE_PIXEL_SNAP_ULPS * Number.EPSILON * count ? whole : count;
}

export interface CalculateCenteredCropInput {
  /** Original image width in pixels. */
  pixelWidth: number;
  /** Original image height in pixels. */
  pixelHeight: number;
  /**
   * Linear crop factor. 1 means no crop; 1.5 keeps at most 1 / 1.5 of each
   * dimension. The shorter axis is floor(dimension / cropFactor). The longer
   * axis is the integer that best matches the source aspect ratio, capped at
   * floor(dimension / cropFactor). This keeps the aspect ratio as close as
   * whole pixels allow.
   */
  cropFactor: number;
}

export interface CenteredCrop {
  pixelWidth: number;
  pixelHeight: number;
  megapixels: number;
  /** Fraction of original pixel area retained, from 0 to 1. */
  retainedAreaFraction: number;
}

/**
 * Calculates the dimensions left after a centred crop that keeps the aspect ratio.
 *
 * @param input Original dimensions and linear crop factor.
 * @returns Remaining pixel dimensions and area fraction.
 */
export function calculateCenteredCrop(
  input: CalculateCenteredCropInput
): CalculationResult<CenteredCrop> {
  requireInputKeys(input, "calculateCenteredCrop", ["pixelWidth", "pixelHeight", "cropFactor"]);
  requirePositiveInteger("pixelWidth", input.pixelWidth);
  requirePositiveInteger("pixelHeight", input.pixelHeight);
  requirePositiveFinite("cropFactor", input.cropFactor);

  if (input.cropFactor < 1) {
    throw new InvalidScientificInputError(
      "cropFactor must be greater than or equal to 1."
    );
  }

  // Round the shorter axis down (never more than 1 / cropFactor of it). Then
  // derive the longer axis from that integer so the ratio is as close as whole
  // pixels allow. The longer axis is also capped at floor(longer / cropFactor),
  // so a crop never keeps more than 1 / cropFactor of either dimension.
  const landscape = input.pixelWidth >= input.pixelHeight;
  const shortSource = landscape ? input.pixelHeight : input.pixelWidth;
  const longSource = landscape ? input.pixelWidth : input.pixelHeight;
  const shortAxis = floorWholePixels(shortSource / input.cropFactor);
  const longAxis = Math.max(
    1,
    Math.min(
      floorWholePixels(longSource / input.cropFactor),
      Math.round((shortAxis * longSource) / shortSource)
    )
  );
  const pixelWidth = landscape ? longAxis : shortAxis;
  const pixelHeight = landscape ? shortAxis : longAxis;

  return calculatedResult(
    {
      pixelWidth,
      pixelHeight,
      megapixels: (pixelWidth * pixelHeight) / 1_000_000,
      retainedAreaFraction:
        (pixelWidth * pixelHeight) / (input.pixelWidth * input.pixelHeight)
    },
    "centered-same-aspect-crop",
    "2.0.0",
    [
      "Centered crop",
      "Original aspect ratio is preserved to integer-pixel precision: the shorter axis is floor(dimension / cropFactor) and the longer axis is the nearest integer to the source ratio, capped at floor(dimension / cropFactor)"
    ]
  );
}
