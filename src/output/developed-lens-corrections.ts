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
import { genericLensDispersion } from "../equipment/generic-lens-dispersion.js";

/**
 * Effective wavelengths of the red, green and blue channels for the lateral-colour map, nm: a generic approximation of where
 * a camera's channel responses peak, not a measured camera. The default of `createGenericLensCorrectionProfile` without a
 * `channelDispersion`; `simulateCapture`'s `output.lensCorrections` uses the capture's own channels instead (#589).
 */
export const GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM: Readonly<Record<LensCorrectionChannel, number>> = /* @__PURE__ */ Object.freeze({ red: 610, green: 540, blue: 465 });

/** A normalized dispersion per channel (`genericLensDispersion` units: 0 at the d line, F minus C = 1). */
export type ChannelDispersion = Readonly<Record<LensCorrectionChannel, number>>;

/**
 * @internal #589: each channel's effective dispersion D̄_c = Σ_n w_c,n·D(λ_n) / Σ_n w_c,n, w_c,n = response_c(λ_n)·illuminant(λ_n), the
 * dispersion a neutral surface's image in that channel carries (its centroid moves by L·r·D̄_c under lateral colour L·r·D(λ)).
 * `response` holds the red, green and blue values at the nodes `wavelengthsNm`; each channel needs a positive total weight.
 */
export function channelEffectiveDispersion(wavelengthsNm: readonly number[], response: readonly ArrayLike<number>[], illuminant: ArrayLike<number>): ChannelDispersion {
  const [red, green, blue] = response.map((r) => {
    let weighted = 0, total = 0;
    wavelengthsNm.forEach((nm, n) => { const w = r[n]! * illuminant[n]!; weighted += w * genericLensDispersion(nm); total += w; });
    return weighted / total;
  }) as [number, number, number];
  return { red, green, blue };
}

/**
 * @internal The lateral-colour scale of one channel, 1 + L·D̄ with D̄ the channel's effective dispersion, or D(λ_channel) at
 * {@link GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM} without one (`D` the catalogue's normalized dispersion).
 */
export function genericLensChannelScale(fraction: number, channel: LensCorrectionChannel, channels?: ChannelDispersion): number {
  return 1 + fraction * (channels ? channels[channel] : genericLensDispersion(GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM[channel]));
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
 * frame; `channels` the channels' effective dispersion (#589). Without it the scales span every channel's possible dispersion
 * (red and green at D(780 nm), blue at D(380 nm), the spectral range's ends): `simulateCapture` prepares that first, so the
 * developed rectangle a region reads (`developedLensCorrectionSourceRect`) holds the sources of any channel scales. The mapping's source radius grows with the output radius (the catalogue's
 * distortion is monotonic over the frame), so the sources of the border pixel centres bound every source, and the fill factor
 * is found by bisection on them.
 */
export function prepareDevelopedLensCorrection(lens: { halfDiagonalMm: number; character: { distortion: { corner: number }; lateralColor: { fraction: number } } },
  selection: DevelopedLensCorrectionSelection, width: number, height: number, pitchMm: number,
  channels: ChannelDispersion = { red: genericLensDispersion(780), green: genericLensDispersion(780), blue: genericLensDispersion(380) }): DevelopedLensCorrection {
  const fraction = selection.lateralColor ? lens.character.lateralColor.fraction : 0, scale = (c: LensCorrectionChannel): number => genericLensChannelScale(fraction, c, channels);
  const c: DevelopedLensCorrection = { width, height, radius: lens.halfDiagonalMm / pitchMm,
    k1: selection.distortion ? lens.character.distortion.corner : 0, lensK1: lens.character.distortion.corner, scales: [scale("red"), scale("green"), scale("blue")], fill: 1 };
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

/**
 * @internal #628: the gain det J(ρ_i) / E(ρ_s) at source point (su, sv) (pixel-centre coordinates of the whole frame), b = 1 − 2^(−stops/2):
 * {@link applyDevelopedLensCorrection}'s vignetting arithmetic, the same expressions in the same order.
 */
export function developedLensCorrectionGain(c: DevelopedLensCorrection, b: number, su: number, sv: number): number {
  const cx = c.width / 2 - 0.5, cy = c.height / 2 - 0.5, lensK1 = c.lensK1;
  const s2 = ((su - cx) * (su - cx) + (sv - cy) * (sv - cy)) / (c.radius * c.radius), rs = Math.sqrt(s2), e = 1 - b * s2;
  let ri = rs;
  for (let n = 0; n < 4; n++) ri -= (ri * (1 + lensK1 * ri * ri) - rs) / (1 + 3 * lensK1 * ri * ri);
  return (1 + lensK1 * ri * ri) * (1 + 3 * lensK1 * ri * ri) / (e * e);
}

/**
 * @internal #628: how a display view reads the corrected image of channel `channel` (0 red, 1 green, 2 blue) at view size viewWidth ×
 * viewHeight (the renderer's `DisplayViewCorrection`, frame pixels, +y down). The corrected frame's point (X, Y) reads the developed image
 * at S = q·(1 + k1|q|²/R²) + centre, q = m·a_c·((X, Y) − centre) (+y up), the continuous form of {@link applyDevelopedLensCorrection}'s
 * pixel-centre map.
 * - Fast: display pixel P reads the developed rectangle between the maps of its edges' midpoints (neighbours share them, so the
 *   rectangles tile the frame along rows and columns), each developed pixel with the gain at its own centre. Approximations: the
 *   rectangle for the mapped quadrilateral, the gain at the developed pixel's centre for the one at each output pixel's source point,
 *   and the area mean for the capture's bilinear reading.
 * - Exact: each output pixel of P reads its source point's four developed pixels with the capture's bilinear weights, with the gain at
 *   the source point; only the tone curve, applied per developed pixel, comes before the interpolation instead of after it.
 */
export function createDisplayViewLensCorrection(c: DevelopedLensCorrection, cornerStops: number | null, channel: number, viewWidth: number, viewHeight: number, exact: boolean):
  { footprint(vx: number, vy: number, out: Float64Array): void; reach: number; gain?: (x: number, y: number) => number;
    sources?: (x: number, y: number, out: Float64Array) => number } {
  const W = c.width, H = c.height, sx = W / viewWidth, sy = H / viewHeight, a = c.fill * c.scales[channel]!, r2 = c.radius * c.radius, k1 = c.k1;
  const b = cornerStops === null ? 0 : 1 - 2 ** (-cornerStops / 2);
  const along = (X: number, Y: number, xAxis: boolean): number => {
    const px = (X - W / 2) * a, py = (H / 2 - Y) * a, f = 1 + k1 * (px * px + py * py) / r2;
    return xAxis ? px * f + W / 2 : H / 2 - py * f;
  };
  const clamp = (v: number, limit: number): number => (v < 0 ? 0 : v > limit ? limit : v);
  const footprint = (vx: number, vy: number, out: Float64Array): void => {
    const xc = (vx + 0.5) * sx, yc = (vy + 0.5) * sy;
    out[0] = clamp(along(vx * sx, yc, true), W); out[1] = clamp(along((vx + 1) * sx, yc, true), W);
    out[2] = clamp(along(xc, vy * sy, false), H); out[3] = clamp(along(xc, (vy + 1) * sy, false), H);
    // A rectangle squeezed to nothing at a clamped edge keeps a sliver of its last pixel.
    if (!(out[1]! > out[0]!)) out[0] = Math.max(0, out[1]! - 1e-9 * W);
    if (!(out[3]! > out[2]!)) out[2] = Math.max(0, out[3]! - 1e-9 * H);
  };
  // The local scale of the map is at most a·(1 + 3|k1|·(a·R)²/R²) over the frame.
  const reach = Math.ceil(Math.max(sx, sy) * a * (1 + 3 * Math.abs(k1) * a * a)) + 2;
  if (!exact) return { footprint, reach, ...(b === 0 ? {} : { gain: (x: number, y: number): number => developedLensCorrectionGain(c, b, x, y) }) };
  return { footprint, reach, sources(x, y, out): number {
    // applyDevelopedLensCorrection's source point and bilinear weights (zero weights left out).
    const px = (x + 0.5 - W / 2) * a, py = (H / 2 - y - 0.5) * a, f = 1 + k1 * (px * px + py * py) / r2;
    const su = px * f + W / 2 - 0.5, sv = H / 2 - 0.5 - py * f;
    const u = Math.min(W - 1, Math.max(0, su)), v = Math.min(H - 1, Math.max(0, sv)), i = Math.floor(u), j = Math.floor(v), dx = u - i, dy = v - j;
    out[12] = b === 0 ? 1 : developedLensCorrectionGain(c, b, su, sv);
    let n = 0;
    const add = (p: number, q: number, w: number): void => { if (w > 0) { out[3 * n] = p; out[3 * n + 1] = q; out[3 * n + 2] = w; n++; } };
    add(i, j, (1 - dx) * (1 - dy)); add(i + 1, j, dx * (1 - dy)); add(i, j + 1, (1 - dx) * dy); add(i + 1, j + 1, dx * dy);
    return n;
  } };
}
