// SPDX-License-Identifier: Apache-2.0

/**
 * The display view's in-focus mask (#752, 2.29.0): its record, label and per-pixel score, shared by the single-plane view
 * (`simulate-display-view.ts`, one value for the frame) and the layered scene's per-pixel mask (`layered-chart-query.ts`). See
 * `layered-chart-query.ts` for the model.
 */

/** The in-focus mask of a display view (#752), for the rendered rectangle, row-major. */
export interface DisplayViewFocusMask {
  width: number;
  height: number;
  /** The circle of confusion c₀ the score is relative to, mm (default the frame's diagonal / 1500). */
  circleOfConfusionMm: number;
  /** Per pixel max(0, 1 − c / c₀), c the geometric blur-circle diameter of the surface the pixel centre sees: above 0 within the depth of field. */
  score: Float32Array;
  label: string;
}

/** The mask's label (`view.focusMask.label`). */
export const FOCUS_MASK_LABEL = "Geometric thin-lens focus guide (no diffraction or aberrations): above 0 within the depth of field";

/** The score of a blur-circle diameter c against the circle of confusion c₀ (same units): max(0, 1 − c / c₀). */
export function focusMaskScore(diameterMm: number, circleOfConfusionMm: number): number {
  return Math.max(0, 1 - diameterMm / circleOfConfusionMm);
}
