// SPDX-License-Identifier: Apache-2.0

/**
 * Lateral colour of a catalogue lens as a fringe width (#580): the red–blue image displacement in micrometres and in pixels at
 * one field position, for the app's Guide page on color fringing.
 *
 * It reads the lens's own lateral-colour model (`docs/LENS_CATALOGUE.md`, "Models"), the one `simulateCapture` renders and
 * `createGenericLensCorrectionProfile` corrects: a radial image displacement Δr(λ) = L·R·H·D(λ), with L the lens's
 * `lateralColor.fraction`, R the sensor's half-diagonal, H the field height (fraction of R) and D(λ) the normalised Cauchy
 * dispersion (0 at the Fraunhofer d line, F minus C = 1). The red and blue channels are taken at the effective wavelengths of
 * the lens corrections, `GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM` (610 and 465 nm), so the blue-minus-red displacement
 * is L·R·H·(D(465) − D(610)). With `channelDispersion` (2.21.0, #589's `calculateChannelEffectiveDispersion` for the camera's
 * channels and the light) it is L·R·H·(D̄_blue − D̄_red), the displacement `simulateCapture` renders in RAW. The lens's lateral
 * colour does not change with the f-number or the focus distance.
 *
 * Every value is an approximation: the lens is a generic Photivra design, not a measured product, and a real channel spans a
 * band of wavelengths, not one.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { genericLensDispersion, resolveGenericLens } from "../equipment/generic-lens-catalogue.js";
import { GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM, type ChannelDispersion } from "../output/developed-lens-corrections.js";

export interface CalculateLateralColorFringeInput {
  /** A catalogue id (`GENERIC_LENS_IDS`). */
  lensId: string;
  /** The sensor's active capture area, mm (the lens is scaled to it as in `resolveGenericLens`). */
  activeImagingArea: { widthMm: number; heightMm: number };
  /** The sensor's pixel pitch, µm. */
  pixelPitchMicrometers: number;
  /**
   * The field position as fractions of the frame's half-width (x, +right) and half-height (y, +up) from the optical axis, each
   * in [−1, 1]. Default `{ x: 1, y: 1 }`: the top-right corner.
   */
  fieldPosition?: { x: number; y: number };
  /**
   * 2.21.0: each channel's effective dispersion (`calculateChannelEffectiveDispersion` for the camera's channels and the light;
   * only `red` and `blue` are read). Default: D at the single wavelengths 610 and 465 nm.
   */
  channelDispersion?: ChannelDispersion;
}

/** A signed displacement of the blue image from the red one: radial (positive: blue farther from the axis) and its x and y parts. */
export interface LateralColorDisplacement {
  radial: number;
  x: number;
  y: number;
}

export interface LateralColorFringe {
  lensId: string;
  /** The image-plane point, mm from the optical axis (+x right, +y up). */
  imagePointMm: { x: number; y: number };
  /** Field height H: the point's distance from the axis as a fraction of the half-diagonal (1 at the corner). */
  fieldHeight: number;
  /** The channel wavelengths the displacement is taken at, nm; null with a given `channelDispersion`. */
  channelWavelengthsNm: { red: number; blue: number } | null;
  /** The red and blue dispersions D used (normalized: 0 at the d line, F minus C = 1). */
  channelDispersion: { red: number; blue: number };
  /** Blue-minus-red image displacement, µm. */
  blueMinusRedMicrometers: LateralColorDisplacement;
  /** The same in pixels of the given pitch. */
  blueMinusRedPixels: LateralColorDisplacement;
  /** The fringe width: |radial| displacement, µm and pixels. */
  fringeWidthMicrometers: number;
  fringeWidthPixels: number;
  /** The lens's own F-to-C (486 to 656 nm) displacement at this point, L·R·H, µm. */
  fToCMicrometers: number;
}

function positiveFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new InvalidScientificInputError(name + " must be a positive finite number.");
  return value;
}
function fieldCoordinate(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) throw new InvalidScientificInputError(name + " must be a finite number in [-1, 1].");
  return value;
}

/**
 * The red–blue image displacement of a catalogue lens at a field position on a sensor, in micrometres and pixels, from the
 * lens's own lateral-colour model Δr(λ) = L·R·H·D(λ) at the lens corrections' channel wavelengths (610 and 465 nm), or at the
 * given `channelDispersion`. Exact for the model (no fast mode); an approximation of a generic lens, not a measured product.
 */
export function calculateLateralColorFringe(input: CalculateLateralColorFringeInput): CalculationResult<LateralColorFringe> {
  requireInputObject(input, "calculateLateralColorFringe input");
  requireInputKeys(input, "calculateLateralColorFringe", ["lensId", "activeImagingArea", "pixelPitchMicrometers", "fieldPosition", "channelDispersion"]);
  const lens = resolveGenericLens({ lensId: input.lensId, activeImagingArea: input.activeImagingArea });
  const pitch = positiveFinite(input.pixelPitchMicrometers, "pixelPitchMicrometers");
  let u = 1, v = 1;
  if (input.fieldPosition !== undefined) {
    requireInputObject(input.fieldPosition, "fieldPosition");
    requireInputKeys(input.fieldPosition, "fieldPosition", ["x", "y"]);
    u = fieldCoordinate(input.fieldPosition.x, "fieldPosition.x"); v = fieldCoordinate(input.fieldPosition.y, "fieldPosition.y");
  }
  const x = u * input.activeImagingArea.widthMm / 2, y = v * input.activeImagingArea.heightMm / 2, r = Math.hypot(x, y);
  const fieldHeight = r / lens.halfDiagonalMm, { red, blue } = GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM, given = input.channelDispersion;
  let dispersion = { red: genericLensDispersion(red), blue: genericLensDispersion(blue) };
  if (given !== undefined) {
    requireInputObject(given, "channelDispersion");
    requireInputKeys(given, "channelDispersion", ["red", "green", "blue"]);
    // D spans −1.08 (1100 nm) to 4.30 (300 nm), as createGenericLensCorrectionProfile checks.
    for (const c of ["red", "blue"] as const) if (typeof given[c] !== "number" || !(given[c] >= -1.1 && given[c] <= 4.4))
      throw new InvalidScientificInputError("channelDispersion." + c + " must be a number in [−1.1, 4.4], D between 1100 and 300 nm.");
    dispersion = { red: given.red, blue: given.blue };
  }
  const fToCMicrometers = lens.character.lateralColor.fraction * lens.halfDiagonalMm * 1000 * fieldHeight;
  const radial = fToCMicrometers * (dispersion.blue - dispersion.red);
  const cos = r > 0 ? x / r : 0, sin = r > 0 ? y / r : 0;
  // `+ 0` turns a −0 (from a negative zero cosine or sine) into 0.
  const um: LateralColorDisplacement = { radial, x: radial * cos + 0, y: radial * sin + 0 };
  return approximationResult({ lensId: lens.lensId, imagePointMm: { x, y }, fieldHeight, channelWavelengthsNm: given ? null : { red, blue }, channelDispersion: dispersion,
    blueMinusRedMicrometers: um, blueMinusRedPixels: { radial: um.radial / pitch, x: um.x / pitch, y: um.y / pitch },
    fringeWidthMicrometers: Math.abs(radial), fringeWidthPixels: Math.abs(radial) / pitch, fToCMicrometers },
  "generic-lens-lateral-color-fringe", "1.0.0", [
    "The catalogue lens's lateral-colour model: radial displacement L·R·H·D(λ), D the normalised Cauchy dispersion (Fraunhofer d, F and C lines).",
    given ? "Red and blue at the given channel dispersions (a neutral surface's weighting of each channel's band)." :
      "Red and blue at single effective wavelengths of 610 and 465 nm (GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM); a real channel spans a band.",
    "A generic Photivra lens, not a measured product; lateral colour does not change with the f-number or the focus distance in this model.",
    "Geometric displacement only: the rendered fringe also depends on the lens's blur, the demosaic and the colour conversion."]);
}
