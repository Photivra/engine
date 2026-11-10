// SPDX-License-Identifier: Apache-2.0

/**
 * @internal `output.lensCorrections` (#570): a catalogue lens's generic correction profile (`createGenericLensCorrectionProfile`)
 * applied to the developed linear RGB of `simulateCapture`, after demosaic, colour and white balance and before the tone curve.
 * The RAW and the DNG are never corrected.
 *
 * For an output pixel at p (pixels from the frame centre, +y up) and channel c, the source point is read by inverse mapping,
 * as the profile composes it (lateral colour, then distortion):
 *   q = m · a_c · p,   s = q · (1 + k1·|q|²/R²),
 * with a_c = 1 + L·D(λ_c) the channel's lateral-colour scale, k1 the lens's corner distortion, R the half-diagonal and m ≤ 1 the
 * fill factor (the largest that keeps every output pixel centre's source inside the frame for every channel, so the output keeps
 * its size with no missing pixels; the image is magnified by 1/m). The channel is sampled bilinearly at s.
 *
 * Vignetting is corrected to a flat field: the sample is multiplied by det J(ρ_i) / E(ρ_s), the inverse of the relative
 * illumination the capture delivered at s: the lens's E(ρ) = (1 − bρ²)² at the sensor point and its distortion's area factor
 * 1/det J, det J = (1 + k1ρ_i²)(1 + 3k1ρ_i²) at the ideal point ρ_i that the lens images to ρ_s (the capture's
 * "inverse-distortion-jacobian"; a relative illumination measured on a flat field contains it too). From profile 1.1.0 (#584) the
 * profile's vignetting component carries the same area factor (`distortionAreaFactor`), and its gain equals this kernel's.
 * Every position is computed in whole-frame pixel coordinates, so a region renders the same values as the whole frame.
 */

import { InvalidScientificResultError } from "../core/validation.js";
import type { LensCorrectionChannel } from "./lens-corrections.js";

/**
 * Effective wavelengths of the red, green and blue channels for the lateral-colour map, nm: a generic approximation of where
 * a camera's channel responses peak, not a measured camera.
 */
export const GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM: Readonly<Record<LensCorrectionChannel, number>> = /* @__PURE__ */ Object.freeze({ red: 610, green: 540, blue: 465 });

/** @internal The lateral-colour scale of one channel, 1 + L·D(λ_channel) (`D` the catalogue's normalized dispersion). */
export function genericLensChannelScale(fraction: number, dispersion: (wavelengthNm: number) => number, channel: LensCorrectionChannel): number {
  return 1 + fraction * dispersion(GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM[channel]);
}

/** @internal Which corrections run. */
export interface DevelopedLensCorrectionSelection { distortion: boolean; lateralColor: boolean; vignetting: boolean }
/** @internal A prepared correction for one frame (pixel units). */
export interface DevelopedLensCorrection {
  width: number; height: number;
  /** Half-diagonal R in pixels. */
  radius: number;
  /** k1 (0 when distortion is off), the lens's own k1, and the red, green and blue scales a_c (1 when lateral colour is off). */
  k1: number; lensK1: number; scales: readonly [number, number, number];
  /** Fill factor m ≤ 1 (1/m is the magnification). */
  fill: number;
}
type Rect = { x: number; y: number; width: number; height: number };

/** Source position (pixel-centre coordinates of the whole frame, unclamped) of output pixel (x, y), channel c. */
function sourceOf(c: DevelopedLensCorrection, m: number, x: number, y: number, channel: number, out: Float64Array): void {
  const a = m * c.scales[channel]!, px = (x + 0.5 - c.width / 2) * a, py = (c.height / 2 - y - 0.5) * a;
  const s = 1 + c.k1 * (px * px + py * py) / (c.radius * c.radius);
  out[0] = px * s + c.width / 2 - 0.5; out[1] = c.height / 2 - 0.5 - py * s;
}
/** Calls `visit` for every pixel centre on the border of `r`. */
function border(r: Rect, visit: (x: number, y: number) => void): void {
  for (let x = r.x; x < r.x + r.width; x++) { visit(x, r.y); visit(x, r.y + r.height - 1); }
  for (let y = r.y; y < r.y + r.height; y++) { visit(r.x, y); visit(r.x + r.width - 1, y); }
}

/**
 * @internal Prepares the correction of a W × H frame. `lens` is the resolved catalogue lens (`resolveGenericLens`) on the
 * frame; `dispersion` is `genericLensDispersion`. The mapping's source radius grows with the output radius (the catalogue's
 * distortion is monotonic over the frame), so the sources of the border pixel centres bound every source, and the fill factor
 * is found by bisection on them.
 */
export function prepareDevelopedLensCorrection(lens: { halfDiagonalMm: number; character: { distortion: { corner: number }; lateralColor: { fraction: number } } },
  selection: DevelopedLensCorrectionSelection, width: number, height: number, pitchMm: number, dispersion: (wavelengthNm: number) => number): DevelopedLensCorrection {
  const fraction = selection.lateralColor ? lens.character.lateralColor.fraction : 0;
  const c: DevelopedLensCorrection = { width, height, radius: lens.halfDiagonalMm / pitchMm,
    k1: selection.distortion ? lens.character.distortion.corner : 0, lensK1: lens.character.distortion.corner,
    scales: [genericLensChannelScale(fraction, dispersion, "red"), genericLensChannelScale(fraction, dispersion, "green"), genericLensChannelScale(fraction, dispersion, "blue")], fill: 1 };
  const p = new Float64Array(2), frame = { x: 0, y: 0, width, height };
  const fits = (m: number): boolean => {
    let ok = true;
    border(frame, (x, y) => {
      for (let k = 0; k < 3 && ok; k++) { sourceOf(c, m, x, y, k, p); ok = p[0]! >= 0 && p[0]! <= width - 1 && p[1]! >= 0 && p[1]! <= height - 1; }
    });
    return ok;
  };
  if (!fits(1)) {
    let lo = 0.5, hi = 1;
    for (let i = 0; i < 52; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    c.fill = lo;
  }
  return c;
}

/**
 * @internal The developed pixels (a rectangle of the whole frame) that the corrected pixels of `region` read: the bounding box of
 * the region border's sources over the three channels, with their bilinear neighbours, one pixel of margin, clipped to the frame.
 */
export function developedLensCorrectionSourceRect(c: DevelopedLensCorrection, region: Rect): Rect {
  const p = new Float64Array(2);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  border(region, (x, y) => {
    for (let k = 0; k < 3; k++) {
      sourceOf(c, c.fill, x, y, k, p);
      x0 = Math.min(x0, p[0]!); x1 = Math.max(x1, p[0]!); y0 = Math.min(y0, p[1]!); y1 = Math.max(y1, p[1]!);
    }
  });
  const left = Math.max(0, Math.floor(x0) - 1), top = Math.max(0, Math.floor(y0) - 1);
  return { x: left, y: top, width: Math.min(c.width - 1, Math.floor(x1) + 2) - left + 1, height: Math.min(c.height - 1, Math.floor(y1) + 2) - top + 1 };
}

/**
 * @internal Corrects developed linear RGB (`rgb`, interleaved, the frame's pixels in `source`) into the pixels of `region`, both
 * rectangles of the whole frame. `cornerStops` is the lens's vignetting at the capture's f-number, or null to leave it.
 * Positions outside the frame (none after the fill, up to rounding) are clamped to the edge pixel centres.
 */
export function applyDevelopedLensCorrection(c: DevelopedLensCorrection, rgb: Float64Array, source: Rect, region: Rect, cornerStops: number | null): Float64Array {
  const out = new Float64Array(region.width * region.height * 3), W = c.width, H = c.height, cx = W / 2 - 0.5, cy = H / 2 - 0.5, r2 = c.radius * c.radius;
  const b = cornerStops === null ? 0 : 1 - 2 ** (-cornerStops / 2), k1 = c.k1, lensK1 = c.lensK1;
  for (let y = 0, o = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let k = 0; k < 3; k++, o++) {
    // sourceOf, inlined (a call per sample is about 5 times slower here): the same arithmetic, so the region bounds hold.
    const a = c.fill * c.scales[k]!, px = (region.x + x + 0.5 - W / 2) * a, py = (H / 2 - (region.y + y) - 0.5) * a, f = 1 + k1 * (px * px + py * py) / r2;
    const su = px * f + W / 2 - 0.5, sv = H / 2 - 0.5 - py * f;
    const u = Math.min(W - 1, Math.max(0, su)), v = Math.min(H - 1, Math.max(0, sv));
    const i = Math.floor(u), j = Math.floor(v), dx = u - i, dy = v - j, i1 = dx === 0 ? i : i + 1, j1 = dy === 0 ? j : j + 1;
    if (i < source.x || j < source.y || i1 >= source.x + source.width || j1 >= source.y + source.height)
      throw new InvalidScientificResultError("Lens correction read outside the developed rectangle.");
    const row = (j - source.y) * source.width, row1 = (j1 - source.y) * source.width, a0 = i - source.x, a1 = i1 - source.x;
    let value = (1 - dy) * ((1 - dx) * rgb[(row + a0) * 3 + k]! + dx * rgb[(row + a1) * 3 + k]!) + dy * ((1 - dx) * rgb[(row1 + a0) * 3 + k]! + dx * rgb[(row1 + a1) * 3 + k]!);
    if (b !== 0) {
      // ρ_s², then ρ_i from ρ_s = ρ_i(1 + k1ρ_i²) by Newton's method (monotonic over the frame; converged to rounding in 4 steps).
      const s2 = ((su - cx) * (su - cx) + (sv - cy) * (sv - cy)) / r2, rs = Math.sqrt(s2), e = 1 - b * s2;
      let ri = rs;
      for (let n = 0; n < 4; n++) ri -= (ri * (1 + lensK1 * ri * ri) - rs) / (1 + 3 * lensK1 * ri * ri);
      value *= (1 + lensK1 * ri * ri) * (1 + 3 * lensK1 * ri * ri) / (e * e);
    }
    out[o] = value;
  }
  return out;
}
