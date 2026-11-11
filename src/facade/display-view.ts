// SPDX-License-Identifier: Apache-2.0

/**
 * Display view (`simulateDisplayView`): the image that the real full-resolution capture of a `simulateCapture`
 * request would give after it is resized to a small display size by area averaging in linear light, computed
 * without rendering the full-resolution capture. Internal; the public entry point and the renderer that sets it up live in
 * `simulate-display-view.ts`, the option parsing in `simulate-capture.ts`. The design and its error analysis are in docs/DISPLAY_VIEW.md.
 *
 * Definition (the reference this module estimates): let L_j be the linear-light value of output pixel j of the
 * real capture (its sRGB samples decoded with the sRGB EOTF). Display pixel P covers the rectangle F_P of
 * real output pixels [P_x·s_x, (P_x + 1)·s_x) × [P_y·s_y, (P_y + 1)·s_y), s = frame size ÷ view size, and
 *   D_P = Σ_j (w_j / A) · L_j,
 * w_j = the area of pixel j inside F_P, A = s_x·s_y (the "area" or box resampling filter). D_P is then
 * sRGB-encoded and rounded.
 *
 * Estimation, per display pixel:
 * 1. Expected value. The expectation E[D_P] = Σ_j (w_j/A)·E[L_j] is estimated by stratified Monte Carlo over the
 *    footprint: K × K strata, one uniformly jittered point in each (deterministic, seeded by the capture seed and the
 *    display pixel index); the real pixel containing the point is the sample. A point drawn uniformly in F_P lands in
 *    pixel j with probability w_j/A, so the sample mean is unbiased for E[D_P]. For each sampled pixel the module
 *    computes, at the real pitch, the exact expected electrons of the real sites its demosaic reads (the scene sampled
 *    at those sites, through the declared pixel aperture, anti-aliasing filter and diffraction kernels, so the real
 *    colour mosaic and its aliasing are kept), the moments of each site's normalized RAW value (shot, dark, read and
 *    ADC noise; clipped at the white level), the demosaic's linear kernels, the development (white balance,
 *    highlight clip, colour matrix) and the output rendering (tone curve, clip to [0, 1]). The non-linear steps act
 *    on the pixel's own distribution, approximated as normal with the propagated mean and variance, so a clipped
 *    noise floor or a clipped highlight moves the mean as it does in the real image.
 * 2. Noise. D_P − E[D_P] is a weighted sum of the independent site noises. Linearizing the non-linear steps with
 *    their expected slopes (Stein's lemma), its covariance is A·Γ·diag(B_c·σ_c²)·Γᵀ·Aᵀ, where σ_c² is the site
 *    variance of CFA channel c and B_c = Σ_k β_k² with β_k the total weight of site k in the display pixel after
 *    demosaicing and averaging. B_c holds the demosaic correlation exactly for the linear kernels and is computed in
 *    closed form from the footprint. The rest of each pixel's variance that the linearization misses (clipping) is
 *    added as independent per-pixel variance, weighted by Σ_j (w_j/A)², as is the output quantization (Δ²/12).
 *    One correlated normal draw per display pixel (the sum of hundreds of independent site noises) gives the noise.
 */

import { createDeterministicUniformStream, deriveNativeSiteStreamSeedUint32, samplePortableStandardNormal } from "../sensor/stochastic-seed.js";
import { encodeSrgbComponentPortable } from "../color/srgb-transfer.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { portableCbrt, portablePow } from "../core/portable-math.js";

/** Stream IDs of the display view's two seeded streams, distinct from the native charge (0) and read-noise (1) streams. */
export const DISPLAY_VIEW_JITTER_STREAM_ID = 32 as const;
export const DISPLAY_VIEW_NOISE_STREAM_ID = 33 as const;

export { createDisplayViewExpectedSignal, type DisplayViewExpectedSignal, type DisplayViewExpectedSignalInput, type DisplayViewQueryOffset,
  type DisplayViewScene } from "./expected-signal.js";
import type { DisplayViewExpectedSignal, DisplayViewExpectedSignalInput } from "./expected-signal.js";
import { CLIP_REACH_SIGMA, GL, bigPhi, phi } from "./display-view-normal.js";
// Type only: the coupled steps are loaded on demand (setup.coupled), never by the default path.
import type { DisplayViewCoupledRendering, DisplayViewRenderingChoice } from "./display-view-rendering.js";
import type { SdrToneCurve } from "../output/sdr-rendering.js";
import type { ResolvedChartScene } from "./chart-scenes.js";
import type { ResolvedChartMaterialLayers } from "./chart-material-layers.js";

/**
 * #478: what a GPU renderer needs beyond the CPU setup, which reads the scene only through `signal`: the expected signal's
 * input (query offsets and points, the materials table, the channel responses) and the resolved chart (null for caller
 * scenes), from which it builds its material lookup. The CPU renderer ignores it.
 */
export interface DisplayViewGpuSetup {
  signalInput: DisplayViewExpectedSignalInput;
  /** The resolved chart (portable), or null for a caller scene or a declared `material-layers` scene. */
  chart: ResolvedChartScene | null;
  /** #491: the declared `material-layers` scene (its `chart` is the chart under the layers), or null. */
  layers?: ResolvedChartMaterialLayers | null;
  /**
   * #491: a fixed-size chart's placement (`chartSize`): chart-local frame units per frame unit (the metres per frame unit over the
   * chart's half width) and the chart's aspect; outside |cu| ≤ 1, |cv| ≤ aspect the material is the surround, the materials' last entry.
   */
  placement?: { chartUnitsPerFrameUnit: number; aspect: number } | null;
  /**
   * #492: the defocus disc's radius in sites when the expected signal's kernels carry it (`lens.defocus` out of focus); absent in
   * focus. The GPU Quality site pass then sums each site's taps in blocks (src/gpu/display-view-quality-gpu.ts).
   */
  defocusRadius?: number;
}
// ---------------------------------------------------------------------------------------------------------------
// Normal-distribution helpers.
/**
 * Internal (exported for tests). Moments of min(Y, top) for Y ~ N(m, v): mean, variance and the slope d E/d m = P(Y < top). Exact for a normal Y:
 * E[min(Y,t)] = m − s·(φ(z) − z·(1 − Φ(z))), z = (t − m)/s.
 */
export function upperClip(m: number, v: number, top: number, out: Float64Array): void {
  if (!(v > 0)) { const c = m < top ? m : top; out[0] = c; out[1] = 0; out[2] = m < top ? 1 : 0; return; }
  const s = Math.sqrt(v), z = (top - m) / s;
  if (z > CLIP_REACH_SIGMA) { out[0] = m; out[1] = v; out[2] = 1; return; }
  if (z < -CLIP_REACH_SIGMA) { out[0] = top; out[1] = 0; out[2] = 0; return; }
  const P = bigPhi(z), d = phi(z);
  const mean = m - s * (d - z * (1 - P));
  // E[min(Y,t)²] = m²Φ − 2msφ + s²(Φ − zφ) + t²(1 − Φ).
  const second = m * m * P - 2 * m * s * d + v * (P - z * d) + top * top * (1 - P);
  out[0] = mean; out[1] = Math.max(0, second - mean * mean); out[2] = P;
}
/**
 * Internal (exported for tests). Moments of clip(Y, 0, 1) for Y with mean m, variance v and standardized skewness γ
 * (default 0: normal, closed form). The mean carries the first-order Edgeworth term of a skewed Y: for
 * E[(Y − t)₊] it adds s·γ·z·φ(z)/6 at z = (t − m)/s, so E[clip] gains (s·γ/6)·(a·φ(a) − b·φ(b)) with a = −m/s,
 * b = (1 − m)/s (docs/DISPLAY_VIEW.md, "Readout"). |γ| is limited to 1, where the first-order term is still a small part.
 */
export function unitClip(m: number, v: number, out: Float64Array, skewness = 0): void {
  if (!(v > 0)) { const c = m < 0 ? 0 : m > 1 ? 1 : m; out[0] = c; out[1] = 0; out[2] = m > 0 && m < 1 ? 1 : 0; return; }
  const s = Math.sqrt(v), a = -m / s, b = (1 - m) / s;
  if (a < -CLIP_REACH_SIGMA && b > CLIP_REACH_SIGMA) { out[0] = m; out[1] = v; out[2] = 1; return; }
  const Pa = a < -CLIP_REACH_SIGMA ? 0 : bigPhi(a), Pb = b > CLIP_REACH_SIGMA ? 1 : bigPhi(b), da = a < -CLIP_REACH_SIGMA ? 0 : phi(a), db = b > CLIP_REACH_SIGMA ? 0 : phi(b);
  const inside = Pb - Pa, gamma = skewness > 1 ? 1 : skewness < -1 ? -1 : skewness;
  const mean = m * inside + s * (da - db) + (1 - Pb) + (gamma === 0 ? 0 : s * gamma / 6 * ((a < -CLIP_REACH_SIGMA ? 0 : a * da) - (b > CLIP_REACH_SIGMA ? 0 : b * db)));
  // E[Y² 1(0<Y<1)] = (m² + s²)(Φb − Φa) + 2ms(φa − φb) + s²(aφa − bφb); plus P(Y ≥ 1).
  const aa = a < -CLIP_REACH_SIGMA ? 0 : a * da, bb = b > CLIP_REACH_SIGMA ? 0 : b * db;
  const second = (m * m + v) * inside + 2 * m * s * (da - db) + v * (aa - bb) + (1 - Pb);
  out[0] = mean; out[1] = Math.max(0, second - mean * mean); out[2] = inside;
}
/** Internal (exported for tests). Positive Reinhard per channel then the clip to [0, 1]: h(x) = x/(1 + x) for x > 0, else 0 (its slope h' = 1/(1 + x)²). */
export function reinhardMoments(m: number, v: number, out: Float64Array): void {
  if (!(v > 0)) { out[0] = m > 0 ? m / (1 + m) : 0; out[1] = 0; out[2] = m > 0 ? 1 / ((1 + m) * (1 + m)) : 0; return; }
  const s = Math.sqrt(v), lo = Math.max(0, m - CLIP_REACH_SIGMA * s), hi = m + CLIP_REACH_SIGMA * s;
  if (!(hi > lo)) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
  // Composite 16-point Gauss–Legendre over [lo, hi] in 4 panels; h is smooth there (the kink at 0 is an end point).
  let e1 = 0, e2 = 0, ed = 0;
  const panels = 4, width = (hi - lo) / panels;
  for (let p = 0; p < panels; p++) {
    const c = lo + (p + 0.5) * width, half = width / 2;
    for (let k = 0; k < 16; k++) {
      const x = c + half * GL.x[k]!, weight = half * GL.w[k]! * phi((x - m) / s) / s, h = x / (1 + x);
      e1 += weight * h; e2 += weight * h * h; ed += weight / ((1 + x) * (1 + x));
    }
  }
  out[0] = e1; out[1] = Math.max(0, e2 - e1 * e1); out[2] = ed;
}

// ---------------------------------------------------------------------------------------------------------------
// The display view renderer.

/** Per CFA channel: normalized RAW value = (code − black)/(white − black) of a site with e expected electrons. */
export interface DisplayViewChannelReadout {
  /** Normalized value per electron: digitalGain / (conversionGain·(white − black)). */
  perElectron: number;
  /** Mean dark electrons per site during the exposure. */
  darkElectrons: number;
  /** Variance of the normalized value not proportional to the electrons: read noise and ADC quantization. */
  constantVariance: number;
}

export interface DisplayViewSetup {
  frameWidth: number;
  frameHeight: number;
  /** Native site of output pixel (0, 0). */
  margin: number;
  nativeWidth: number;
  nativeHeight: number;
  viewWidth: number;
  viewHeight: number;
  region: { x: number; y: number; width: number; height: number };
  /** Samples per axis in display pixels whose pilot finds detail. */
  samplesPerAxis: number;
  /** Samples per axis in uniform ones: a quarter (at least 1), the fast method; `samplesPerAxis` exact (2.20.0). Default a quarter. */
  uniformSamplesPerAxis?: number;
  /** Sites beyond the footprint that can affect its pixels (demosaic, filter and kernel reach), for the pilot. */
  reachSites: number;
  bitDepth: 8 | 16;
  seed: number;
  signal: DisplayViewExpectedSignal;
  readout: readonly [DisplayViewChannelReadout, DisplayViewChannelReadout, DisplayViewChannelReadout];
  /** Bilinear demosaic kernels per absolute CFA phase (phaseY·2 + phaseX): for each output channel, (dx, dy, weight) triples. */
  demosaic: readonly (readonly (readonly DisplayViewKernelTap[])[])[];
  /**
   * The demosaic whose pixel statistics the view reproduces, per phase: one candidate (bilinear) or AHD's two directional
   * linear candidates (`ahdCandidateKernels`), each a kernel per output channel. Default: the bilinear kernels.
   */
  candidates?: readonly (readonly (readonly (readonly DisplayViewKernelTap[])[])[])[];
  /** White-balance gains applied to the normalized camera channels and the highlight clip level (the smallest gain). */
  gains: readonly [number, number, number];
  clipLevel: number;
  /** Camera channels (after WB and the highlight clip) → linear sRGB: rows are output components. */
  matrix: readonly (readonly number[])[];
  toneCurve: SdrToneCurve;
  /**
   * #593, #601 (2.22.0): the tone curve's parameters, the highlight mode, the gamut handling and whether the fast rules run, when
   * the view renders a luminance tone curve, `highlightMode: "reconstruct"` or `desaturate-to-luminance`
   * (src/facade/display-view-rendering.ts). Absent: the per-channel highlight clip and the component clip.
   */
  rendering?: DisplayViewRenderingChoice;
  /**
   * The coupled steps of `rendering` (`createDisplayViewCoupledRendering`, src/facade/display-view-rendering.ts), created by the
   * caller where it loaded that module on demand; present exactly when `rendering` is.
   */
  coupled?: DisplayViewCoupledRendering;
  /**
   * AHD only: `labMatrix` is the camera → XYZ matrix AHD measures homogeneity with (the profile's matrix times the
   * white-balance gains), for AHD's choice on the noise-free mosaic (#457). 2.22.0: the view no longer adds a low-signal
   * correction for the noise's effect on the choice (docs/DISPLAY_VIEW.md, "AHD at low signal").
   */
  ahdChoice?: { labMatrix: readonly (readonly number[])[] };
  yieldControl(): Promise<void>;
  checkAbort(): void;
  /** #478: the inputs a GPU renderer builds its scene lookup from (see {@link DisplayViewGpuSetup}); not read by `renderDisplayView`. */
  gpu?: DisplayViewGpuSetup;
}

export interface DisplayViewRenderResult {
  samples: Uint8Array | Uint16Array;
  /** Mean linear-light value of each display pixel before the noise draw (diagnostics and validation). */
  expected: Float64Array;
  /** Noise standard deviation of each display pixel's components in linear light (square root of the covariance diagonal). */
  noiseStd: Float64Array;
  sampleCount: number;
  siteCount: number;
  /** Display pixels whose pilot found detail (full samples) and uniform ones (a quarter per axis). */
  detailPixelCount: number;
  uniformPixelCount: number;
  /**
   * 2.8 (#393): "exact-area-mean" when each display pixel averaged every real pixel of its footprint once, with its exact
   * overlap weight (views where a footprint holds at most K² real pixels); "stratified-monte-carlo" otherwise.
   */
  estimation: "exact-area-mean" | "stratified-monte-carlo";
  /**
   * #533: per display pixel (region row-major), the expected number of the real capture's output pixels in its rectangle that
   * have at least one clipped contributing site (`simulateCapture`'s `diagnostics.highlight.saturatedPixelCount`, counted on
   * the capture's one noise sample): Σ_j w_j·P_j, w_j the area of real pixel j inside the rectangle and P_j the probability,
   * under the view's site model, that a site j's demosaic reads is at or above the white level. Estimated as the expected value
   * is (exact area mean or stratified Monte Carlo); it never changes a sample.
   */
  saturated: Float64Array;
  /** #533: Σ of `saturated` in region row-major order: the region's expected saturated-pixel count (additive over regions). */
  saturatedPixelCount: number;
}

/** One tap of a linear demosaic kernel: the site at (dx, dy) from the pixel, and its weight. */
export interface DisplayViewKernelTap { dx: number; dy: number; weight: number }

/**
 * AHD's two directional candidates (`createAhdDemosaicTask`, after Hirakawa & Parks 2005) as linear kernels, for a pixel of
 * CFA phase (phaseX, phaseY) of an RGGB mosaic: green along the rows (or columns) with the 5-tap filter
 * [−1/4, 1/2, 1/2, 1/2, −1/4], then red and blue from bilinearly interpolated colour differences against that green. Each
 * candidate is linear in the mosaic, so its kernel is its response to a unit site; AHD then picks one candidate per pixel
 * by homogeneity, which is the only non-linear step. Returns [horizontal, vertical], each [red, green, blue] kernels.
 */
export function ahdCandidateKernels(phaseX: number, phaseY: number): DisplayViewKernelTap[][][] {
  const role = (dx: number, dy: number): number => { const x = (phaseX + dx) & 1, y = (phaseY + dy) & 1; return y === 0 ? (x === 0 ? 0 : 1) : (x === 0 ? 1 : 2); };
  const evaluate = (site: (dx: number, dy: number) => number, horizontal: boolean): number[] => {
    const green = (dx: number, dy: number): number => {
      const c = site(dx, dy);
      if (role(dx, dy) === 1) return c;
      return horizontal ? (site(dx - 1, dy) + site(dx + 1, dy)) / 2 + (2 * c - site(dx - 2, dy) - site(dx + 2, dy)) / 4
        : (site(dx, dy - 1) + site(dx, dy + 1)) / 2 + (2 * c - site(dx, dy - 2) - site(dx, dy + 2)) / 4;
    };
    const diff = (dx: number, dy: number): number => site(dx, dy) - green(dx, dy);
    const out = [0, 0, 0], own = role(0, 0), g = green(0, 0);
    out[1] = g;
    if (own === 1) {
      const hRole = role(1, 0), vRole = 2 - hRole;
      out[hRole] = g + (diff(-1, 0) + diff(1, 0)) / 2;
      out[vRole] = g + (diff(0, -1) + diff(0, 1)) / 2;
    } else {
      out[own] = site(0, 0);
      out[2 - own] = g + (diff(-1, -1) + diff(1, -1) + diff(-1, 1) + diff(1, 1)) / 4;
    }
    return out;
  };
  return [true, false].map((horizontal) => {
    const kernels: DisplayViewKernelTap[][] = [[], [], []];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const response = evaluate((x, y) => (x === dx && y === dy ? 1 : 0), horizontal);
      for (let c = 0; c < 3; c++) if (response[c] !== 0) kernels[c]!.push({ dx, dy, weight: response[c]! });
    }
    return kernels;
  });
}

/** 1-D overlaps of real output columns with one display column: first column index and the overlaps. */
export function overlaps(start: number, end: number, limit: number): { first: number; w: Float64Array } {
  const first = Math.floor(start), last = Math.min(limit - 1, Math.ceil(end) - 1), w = new Float64Array(last - first + 1);
  for (let k = first; k <= last; k++) w[k - first] = Math.min(end, k + 1) - Math.max(start, k);
  return { first, w };
}
/**
 * Internal (#533, the GPU renderers' host): the saturated-pixel share `renderDisplayView` gives a display pixel on the exact path
 * when every real pixel's saturation probability is exactly 0 or 1: bit j·nx + i of the 36-bit mask (`low` bits 0–31, `high` bits
 * 32–35) is 1 for P = 1, nx the columns' overlap count. The arithmetic is the render's own (Σ_j a_j·P_j in its order, a_j = w_x·w_y / A,
 * then times A), so the value has the reference's bits.
 */
export function displayViewDecidedSaturation(columns: { w: Float64Array }, rows: { w: Float64Array }, area: number, low: number, high: number): number {
  const nx = columns.w.length;
  let sat = 0;
  for (let j = 0; j < rows.w.length; j++) for (let i = 0; i < nx; i++) {
    const bit = j * nx + i, set = bit < 32 ? (low >>> bit) & 1 : (high >>> (bit - 32)) & 1;
    sat += columns.w[i]! * rows.w[j]! / area * (set === 1 ? 1 : 0);
  }
  return (sat / 1) * area;
}
/**
 * Internal (exported for tests). Footprint sums along one axis, for the closed-form B_c (docs/DISPLAY_VIEW.md, "Demosaic correlation"). Native
 * coordinate parity decides the CFA: red columns/rows are even, blue odd. With w(k) the overlap of real column k:
 * - b(k) = w(k) + ½(w(k − 1) + w(k + 1)), the bilinear red/blue spread; sums of b² over even and odd native k;
 * - p(k) = w(k), q(k) = ¼(w(k − 1) + w(k + 1)) for green: sums of p², q² and p·q over even and odd native k;
 * - Σ w².
 */
export interface AxisSums { bEven: number; bOdd: number; ppEven: number; ppOdd: number; qqEven: number; qqOdd: number; pqEven: number; pqOdd: number; ww: number }
export function axisSums(start: number, end: number, limit: number, margin: number): AxisSums {
  const { first, w } = overlaps(start, end, limit);
  const at = (k: number): number => (k >= first && k < first + w.length ? w[k - first]! : 0);
  const s: AxisSums = { bEven: 0, bOdd: 0, ppEven: 0, ppOdd: 0, qqEven: 0, qqOdd: 0, pqEven: 0, pqOdd: 0, ww: 0 };
  for (let k = first - 1; k <= first + w.length; k++) {
    const p = at(k), q = (at(k - 1) + at(k + 1)) / 4, b = p + 2 * q, even = ((k + margin) & 1) === 0;
    if (even) { s.bEven += b * b; s.ppEven += p * p; s.qqEven += q * q; s.pqEven += p * q; } else { s.bOdd += b * b; s.ppOdd += p * p; s.qqOdd += q * q; s.pqOdd += p * q; }
    s.ww += p * p;
  }
  return s;
}
/** Internal (exported for tests). B for red, green and blue (Σ β² over the channel's sites, β normalized to unit sum) and Σ (w/A)². */
export function footprintWeights(x: AxisSums, y: AxisSums, area: number, out: Float64Array): void {
  const a2 = area * area;
  const green = (xpp: number, xqq: number, xpq: number, ypp: number, yqq: number, ypq: number): number =>
    xpp * ypp + xqq * ypp + xpp * yqq + 2 * xpq * ypp + 2 * xpp * ypq + 2 * xpq * ypq;
  out[0] = x.bEven * y.bEven / a2;
  // Green sites: (odd x, even y) and (even x, odd y).
  out[1] = (green(x.ppOdd, x.qqOdd, x.pqOdd, y.ppEven, y.qqEven, y.pqEven) + green(x.ppEven, x.qqEven, x.pqEven, y.ppOdd, y.qqOdd, y.pqOdd)) / a2;
  out[2] = x.bOdd * y.bOdd / a2;
  out[3] = x.ww * y.ww / a2;
}
/** AHD's dependence reach in sites (directional green ±2, colour differences ±1, homogeneity 4-neighbours and 3 × 3 sum). */
const AHD_REACH = 5;
/** x², as one correctly rounded product (`**` is implementation-approximated in ECMA-262). */
function square(x: number): number { return x * x; }
/** CIELAB's f(t) constants (CIE 15:2004): linear below (6/29)³ with slope (29/3)³/116. */
const LAB_EPSILON = 216 / 24389, LAB_KAPPA = 24389 / 27;
/**
 * Internal (exported for tests, #442): the window offset of each slot, slot (dy + reach)·(2·reach + 1) + dx + reach, as
 * two integer tables: dx[slot] = (slot mod side) − reach and dy[slot] = ⌊slot / side⌋ − reach. The render loop reads them
 * instead of taking a modulo and a division per site read; they are the same integers.
 */
export function displayViewSlotOffsets(reach: number): { dx: Int32Array; dy: Int32Array } {
  const side = 2 * reach + 1, slotsCount = side * side;
  return { dx: Int32Array.from({ length: slotsCount }, (_, slot) => (slot % side) - reach), dy: Int32Array.from({ length: slotsCount }, (_, slot) => ((slot / side) | 0) - reach) };
}
/** The per-phase candidate tables of a render, flat (#442): index phase·2 + candidate, and ·3 + channel for the slots and weights. */
export interface DisplayViewCandidateTables {
  /** Candidates per phase: 1 (bilinear) or 2 (AHD), the same for every phase. */
  count: number;
  denseAt: Float64Array[];
  listAt: Int32Array[];
  slotsAt: Int32Array[];
  weightsAt: Float64Array[];
}
/**
 * Internal (exported for tests, #442): the nested per-phase tables [phase][candidate] (and [channel]) as flat arrays holding
 * the same typed arrays. Plain arrays of typed arrays with one element kind keep the render loop's keyed loads on one hidden
 * class each, where the nested arrays (arrays of arrays of typed arrays) made V8 deoptimize the render loop. Every phase must
 * have the same number of candidates, 1 or 2 (the record layout and the choice variance assume it), each with 3 channels.
 */
export function flatDisplayViewCandidateTables(slots: readonly (readonly (readonly Int32Array[])[])[], weights: readonly (readonly (readonly Float64Array[])[])[],
  dense: readonly (readonly Float64Array[])[], list: readonly (readonly Int32Array[])[]): DisplayViewCandidateTables {
  const count = slots[0]?.length ?? 0;
  if (slots.length !== 4 || (count !== 1 && count !== 2)) throw new InvalidConfigurationError("display view: each of the 4 CFA phases needs 1 or 2 demosaic candidates.");
  const denseAt: Float64Array[] = [], listAt: Int32Array[] = [], slotsAt: Int32Array[] = [], weightsAt: Float64Array[] = [];
  for (let p = 0; p < 4; p++) {
    if (slots[p]!.length !== count || weights[p]?.length !== count || dense[p]?.length !== count || list[p]?.length !== count)
      throw new InvalidConfigurationError("display view: every CFA phase needs the same number of demosaic candidates.");
    for (let d = 0; d < count; d++) {
      if (slots[p]![d]!.length !== 3 || weights[p]![d]!.length !== 3) throw new InvalidConfigurationError("display view: each demosaic candidate needs a kernel per camera channel.");
      denseAt[p * 2 + d] = dense[p]![d]!; listAt[p * 2 + d] = list[p]![d]!;
      for (let c = 0; c < 3; c++) { slotsAt[(p * 2 + d) * 3 + c] = slots[p]![d]![c]!; weightsAt[(p * 2 + d) * 3 + c] = weights[p]![d]![c]!; }
    }
  }
  return { count, denseAt, listAt, slotsAt, weightsAt };
}
/**
 * 2.10 (#447), deprecated in 2.22.0: the AHD low-signal correction states of one setup, as a realm sent them to another. The
 * display view keeps no correction states since 2.22.0, so {@link serializeDisplayViewCorrectionStates} returns none.
 * Kept until 3.0.0.
 * @deprecated Since 2.22.0: the display view has no AHD correction states. Removed in 3.0.0.
 */
export interface DisplayViewCorrectionStateSet { key: string; gridKeys: Int32Array; values: Float64Array }
/**
 * 2.10 (#447), deprecated in 2.22.0: the grid keys of the states a region needs (`PreparedDisplayView.collectCorrectionStates`).
 * @deprecated Since 2.22.0: the display view has no AHD correction states. Removed in 3.0.0.
 */
export interface DisplayViewCorrectionStateKeys { key: string; gridKeys: Int32Array }
/** True for a typed array of the named kind from any realm (a structured clone arrives as one of the receiving realm). */
function isTypedArray(value: unknown, tag: "Int32Array" | "Float64Array"): boolean {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object " + tag + "]";
}
/** Internal (deprecated API): checks that `gridKeys` is an Int32Array of grid keys, as 2.10 to 2.21 required. */
export function checkDeprecatedGridKeys(gridKeys: unknown, caller: string): Int32Array {
  if (!isTypedArray(gridKeys, "Int32Array")) throw new InvalidConfigurationError(caller + ": gridKeys must be an Int32Array.");
  const keys = gridKeys as Int32Array;
  // 97³ grid keys, as 2.10 to 2.21 counted them (12 octaves of 8 steps, 97 levels per channel).
  for (let i = 0; i < keys.length; i++) if (!(keys[i]! >= 0 && keys[i]! < 97 * 97 * 97))
    throw new InvalidConfigurationError(caller + ": gridKeys[" + i + "] (" + keys[i] + ") is not a grid key, an integer in [0, " + 97 * 97 * 97 + ").");
  return keys;
}
/**
 * 2.10 (#447), deprecated in 2.22.0: returned the AHD low-signal correction states this realm held. The display view keeps no
 * correction states since 2.22.0 (the correction was removed; docs/DISPLAY_VIEW.md, "AHD at low signal"), so this returns an
 * empty array. Kept until 3.0.0.
 * @deprecated Since 2.22.0: returns `[]`; there is nothing to move between realms. Removed in 3.0.0.
 */
export function serializeDisplayViewCorrectionStates(): DisplayViewCorrectionStateSet[] { return []; }
/**
 * 2.10 (#447), deprecated in 2.22.0: added states another realm computed to this realm's cache. The display view keeps no
 * correction states since 2.22.0, so this checks `entries` as before (an array of `{ key, gridKeys, values }` with a non-empty
 * string key, an Int32Array of grid keys and a Float64Array of 3 finite values per key; otherwise an
 * InvalidConfigurationError) and returns 0: nothing is stored and no render reads them. Kept until 3.0.0.
 * @deprecated Since 2.22.0: a checked no-op that returns 0. Removed in 3.0.0.
 */
export function bindDisplayViewCorrectionStates(entries: readonly DisplayViewCorrectionStateSet[]): number {
  const caller = "bindDisplayViewCorrectionStates";
  if (!Array.isArray(entries)) throw new InvalidConfigurationError(caller + ": entries must be an array of { key, gridKeys, values }.");
  for (let e = 0; e < entries.length; e++) {
    const entry: unknown = entries[e], at = caller + ": entries[" + e + "]";
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new InvalidConfigurationError(at + " must be an object { key, gridKeys, values }.");
    for (const field of Object.keys(entry)) if (field !== "key" && field !== "gridKeys" && field !== "values") throw new InvalidConfigurationError(at + " has unknown field " + JSON.stringify(field) + ".");
    const { key, gridKeys, values } = entry as Record<string, unknown>;
    if (typeof key !== "string" || key.length === 0) throw new InvalidConfigurationError(at + ".key must be a non-empty string.");
    const keys = checkDeprecatedGridKeys(gridKeys, at);
    if (!isTypedArray(values, "Float64Array")) throw new InvalidConfigurationError(at + ".values must be a Float64Array.");
    const v = values as Float64Array;
    if (v.length !== 3 * keys.length) throw new InvalidConfigurationError(at + ".values must hold 3 values per grid key (" + 3 * keys.length + "), not " + v.length + ".");
    for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) throw new InvalidConfigurationError(at + ".values[" + i + "] (" + v[i] + ") is not finite.");
  }
  return 0;
}
/**
 * Recorded terms of a one-material sample: [0, 3) the channel site variances csv; [3, 21) per candidate d and channel c the
 * linear slopes a (3 + (3d + c)·3); [21, 27) per candidate the residual terms; [27, 30) the expected-value sums; [30, 33) the
 * AHD choice terms; 33 the real pixel's saturation probability (#533: the probability that at least one site its demosaic
 * reads is clipped at the white level).
 */
const MEMO_SIZE = 34;
/** Most real pixels a display pixel's footprint may have for the per-real-pixel memo (#392); larger footprints rarely repeat a real pixel. */
const PIXEL_MEMO_LIMIT = 1 << 16;
/**
 * Most real pixels a footprint may hold for the exact area mean (#393). Measured on 8-row strips of a 24 MP view (Siemens star
 * and dead leaves, one thread): the exact path matched the stratified estimator's time within run-to-run spread up to 25 real
 * pixels per display pixel and was slower above (1.2× at 36, 1.4–1.5× at 64, 1.5–2.4× at 144), because every real pixel is
 * evaluated while the stratified estimator takes a quarter of its samples per axis where the pilot finds no detail.
 */
export const EXACT_AREA_MEAN_MAX_PIXELS = 25;
/** Most entries of the site ring (a native site's value, material and readout moments, kept across the display pixels of a render). */
const SITE_RING_LIMIT = 1 << 18;
/** Pilot points per axis: about one per two sites of the footprint plus its reach, 4 to 16. */
function pilotCount(span: number): number { return Math.max(4, Math.min(16, Math.ceil(span / 2))); }

/**
 * #457: AHD's direction at real pixels of the noise-free mosaic, as `createAhdDemosaicTask` computes it on the whole raster
 * (every neighbour read at its reflect-101 position, so a position's greens, candidates, CIELAB and homogeneity are those of
 * the task's planes), with each per-position quantity computed once and kept in rings of native rows. `direction(x, y)` is 0
 * horizontal, 1 vertical, 2 equal homogeneity; `site(x, y)` gives the normalized expected value of an in-raster site, clipped
 * at white. The kept columns are [x0, x0 + columns), set by `origin(x0)` (which also forgets every kept value); they must hold
 * every real pixel asked about and 5 sites around it, clipped to the raster. `rows` is a power of two at least the native rows
 * the real pixels asked about between two `origin` calls span plus 10. The arithmetic is the task's, in binary64 (the task
 * stores its planes in float32), with `portableCbrt` and products for squares, as `createAhdCentreSteps`.
 */
export function createAhdDirectionPlane(labMatrix: readonly (readonly number[])[], nativeWidth: number, nativeHeight: number, columns: number, rows: number,
  site: (x: number, y: number) => number): { origin(x0: number): void; direction(x: number, y: number): number } {
  const lab = labMatrix, labWhite = Float64Array.from(lab, (row) => row[0]! + row[1]! + row[2]!);
  const l00 = lab[0]![0]!, l01 = lab[0]![1]!, l02 = lab[0]![2]!, l10 = lab[1]![0]!, l11 = lab[1]![1]!, l12 = lab[1]![2]!, l20 = lab[2]![0]!, l21 = lab[2]![1]!, l22 = lab[2]![2]!;
  const lw0 = labWhite[0]!, lw1 = labWhite[1]!, lw2 = labWhite[2]!;
  const W = columns, mask = rows - 1, n = rows * W;
  // Per position (slot (y & mask)·W + x − x0): the site value, the two greens, the two candidates' RGB and CIELAB and the two
  // homogeneity counts, each valid while its stamp is epoch·2^24 + the position's row + 1 (exact in binary64; rows < 2^24).
  const siteV = new Float64Array(n), siteS = new Float64Array(n), gH = new Float64Array(n), gV = new Float64Array(n), gS = new Float64Array(n);
  const rgb = new Float64Array(6 * n), labs = new Float64Array(6 * n), cS = new Float64Array(n), hom = new Uint8Array(2 * n), hS = new Float64Array(n);
  let x0 = 0, epoch = 0;
  const rx = (x: number): number => (x < 0 ? -x : x >= nativeWidth ? 2 * nativeWidth - 2 - x : x);
  const ry = (y: number): number => (y < 0 ? -y : y >= nativeHeight ? 2 * nativeHeight - 2 - y : y);
  const role = (x: number, y: number): number => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2));
  /** The site at (x, y) read reflect-101 (`at` of the task). */
  function at(x: number, y: number): number {
    const X = rx(x), Y = ry(y), q = (Y & mask) * W + X - x0;
    if (siteS[q] !== epoch + Y + 1) { siteV[q] = site(X, Y); siteS[q] = epoch + Y + 1; }
    return siteV[q]!;
  }
  /** Fills the two greens of in-raster position (x, y) (step 1) and returns its slot. */
  function greens(x: number, y: number): number {
    const q = (y & mask) * W + x - x0;
    if (gS[q] === epoch + y + 1) return q;
    const c = at(x, y);
    if (role(x, y) === 1) { gH[q] = c; gV[q] = c; }
    else {
      gH[q] = (at(x - 1, y) + at(x + 1, y)) / 2 + (2 * c - at(x - 2, y) - at(x + 2, y)) / 4;
      gV[q] = (at(x, y - 1) + at(x, y + 1)) / 2 + (2 * c - at(x, y - 2) - at(x, y + 2)) / 4;
    }
    gS[q] = epoch + y + 1;
    return q;
  }
  /** s − g of direction d at the reflected position of (x, y). */
  function difference(x: number, y: number, d: number): number {
    const X = rx(x), Y = ry(y), q = greens(X, Y);
    return at(X, Y) - (d === 0 ? gH[q]! : gV[q]!);
  }
  /** Fills the two candidates and their CIELAB at in-raster position (x, y) (steps 2 and 3) and returns its slot. */
  function candidates(x: number, y: number): number {
    const q = (y & mask) * W + x - x0;
    if (cS[q] === epoch + y + 1) return q;
    greens(x, y);
    const own = role(x, y);
    for (let d = 0; d < 2; d++) {
      const gi = d === 0 ? gH[q]! : gV[q]!, o = 6 * q + 3 * d;
      rgb[o + 1] = gi;
      if (own === 1) {
        const hRole = role(x + 1, y), vRole = 2 - hRole;
        const a = difference(x - 1, y, d), b = difference(x + 1, y, d);
        rgb[o + hRole] = gi + (a + b) / 2;
        const cc = difference(x, y - 1, d), dd = difference(x, y + 1, d);
        rgb[o + vRole] = gi + (cc + dd) / 2;
      } else {
        rgb[o + own] = at(x, y);
        rgb[o + 2 - own] = gi + (difference(x - 1, y - 1, d) + difference(x + 1, y - 1, d) + difference(x - 1, y + 1, d) + difference(x + 1, y + 1, d)) / 4;
      }
      const R = rgb[o]!, G = rgb[o + 1]!, Bc = rgb[o + 2]!;
      let tx = (l00 * R + l01 * G + l02 * Bc) / lw0, ty = (l10 * R + l11 * G + l12 * Bc) / lw1, tz = (l20 * R + l21 * G + l22 * Bc) / lw2;
      tx = tx > LAB_EPSILON ? portableCbrt(tx) : (LAB_KAPPA * tx + 16) / 116;
      ty = ty > LAB_EPSILON ? portableCbrt(ty) : (LAB_KAPPA * ty + 16) / 116;
      tz = tz > LAB_EPSILON ? portableCbrt(tz) : (LAB_KAPPA * tz + 16) / 116;
      labs[o] = 116 * ty - 16; labs[o + 1] = 500 * (tx - ty); labs[o + 2] = 200 * (ty - tz);
    }
    cS[q] = epoch + y + 1;
    return q;
  }
  /** The two homogeneity counts of in-raster position (x, y) (step 4), at hom[2·slot] and hom[2·slot + 1]. */
  function homogeneity(x: number, y: number): number {
    const q = (y & mask) * W + x - x0;
    if (hS[q] === epoch + y + 1) return q;
    const i = 6 * candidates(x, y), jl = 6 * candidates(rx(x - 1), y), jr = 6 * candidates(rx(x + 1), y), ju = 6 * candidates(x, ry(y - 1)), jd = 6 * candidates(x, ry(y + 1));
    const h = labs;
    // Direction 0 at offsets +0, direction 1 at +3; neighbours left, right, up, down.
    const hL0 = Math.abs(h[i]! - h[jl]!), hL1 = Math.abs(h[i]! - h[jr]!), hL2 = Math.abs(h[i]! - h[ju]!), hL3 = Math.abs(h[i]! - h[jd]!);
    const vL0 = Math.abs(h[i + 3]! - h[jl + 3]!), vL1 = Math.abs(h[i + 3]! - h[jr + 3]!), vL2 = Math.abs(h[i + 3]! - h[ju + 3]!), vL3 = Math.abs(h[i + 3]! - h[jd + 3]!);
    const hC0 = square(h[i + 1]! - h[jl + 1]!) + square(h[i + 2]! - h[jl + 2]!), hC1 = square(h[i + 1]! - h[jr + 1]!) + square(h[i + 2]! - h[jr + 2]!);
    const hC2 = square(h[i + 1]! - h[ju + 1]!) + square(h[i + 2]! - h[ju + 2]!), hC3 = square(h[i + 1]! - h[jd + 1]!) + square(h[i + 2]! - h[jd + 2]!);
    const vC0 = square(h[i + 4]! - h[jl + 4]!) + square(h[i + 5]! - h[jl + 5]!), vC1 = square(h[i + 4]! - h[jr + 4]!) + square(h[i + 5]! - h[jr + 5]!);
    const vC2 = square(h[i + 4]! - h[ju + 4]!) + square(h[i + 5]! - h[ju + 5]!), vC3 = square(h[i + 4]! - h[jd + 4]!) + square(h[i + 5]! - h[jd + 5]!);
    const epsL = Math.min(Math.max(hL0, hL1), Math.max(vL2, vL3)), epsC = Math.min(Math.max(hC0, hC1), Math.max(vC2, vC3));
    hom[2 * q] = (hL0 <= epsL && hC0 <= epsC ? 1 : 0) + (hL1 <= epsL && hC1 <= epsC ? 1 : 0) + (hL2 <= epsL && hC2 <= epsC ? 1 : 0) + (hL3 <= epsL && hC3 <= epsC ? 1 : 0);
    hom[2 * q + 1] = (vL0 <= epsL && vC0 <= epsC ? 1 : 0) + (vL1 <= epsL && vC1 <= epsC ? 1 : 0) + (vL2 <= epsL && vC2 <= epsC ? 1 : 0) + (vL3 <= epsL && vC3 <= epsC ? 1 : 0);
    hS[q] = epoch + y + 1;
    return q;
  }
  return {
    origin(first: number): void { x0 = first; epoch += 16777216; },
    /** Step 5: the 3 × 3 sums of homogeneity (reflected) select the direction. */
    direction(x: number, y: number): number {
      let sh = 0, sv = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = homogeneity(rx(x + dx), ry(y + dy)); sh += hom[2 * q]!; sv += hom[2 * q + 1]!; }
      return sh > sv ? 0 : sv > sh ? 1 : 2;
    }
  };
}

/** Renders the display view (docs/DISPLAY_VIEW.md). */
export async function renderDisplayView(setup: DisplayViewSetup): Promise<DisplayViewRenderResult> {
  const { frameWidth, frameHeight, margin, nativeWidth, nativeHeight, viewWidth, viewHeight, region, seed, reachSites } = setup;
  const sx = frameWidth / viewWidth, sy = frameHeight / viewHeight, area = sx * sy, g = 2 / frameWidth;
  const fullK = setup.samplesPerAxis, uniformK = setup.uniformSamplesPerAxis ?? Math.max(1, Math.round(fullK / 4));
  // Exact area mean (#393): where a footprint holds at most EXACT_AREA_MEAN_MAX_PIXELS real pixels and at most K², every real
  // pixel it touches is evaluated once with its exact overlap weight a_j = w_j / A, so the expected value is D_P = Σ_j a_j·E[L_j]
  // with no sampling error at no more cost than sampling; coarser views keep the stratified estimator, whose cost does not
  // grow with the footprint.
  const exactView = area <= Math.min(EXACT_AREA_MEAN_MAX_PIXELS, fullK * fullK);
  const columnOverlaps = exactView ? Array.from({ length: region.width }, (_, i) => overlaps((region.x + i) * sx, (region.x + i + 1) * sx, frameWidth)) : [];
  // On the exact path a real pixel's recorded terms are shared by the 2–4 display pixels whose footprints touch it: they are
  // kept for the region's native columns in a ring of native rows (a power of two, at least twice a footprint's height plus
  // one), valid while a slot's stamp is its native row + 1.
  const exactX0 = Math.floor(region.x * sx) + margin, exactWidth = Math.min(frameWidth - 1, Math.ceil((region.x + region.width) * sx) - 1) + margin - exactX0 + 1;
  let exactRows = 1;
  while (exactRows < 2 * (Math.ceil(sy) + 1)) exactRows *= 2;
  const exactMemo = exactView && exactRows * exactWidth <= PIXEL_MEMO_LIMIT * 4;
  const exactStamp = new Int32Array(exactMemo ? exactRows * exactWidth : 0), exactRecords = new Float64Array(exactMemo ? exactRows * exactWidth * MEMO_SIZE : 0);
  const maximum = setup.bitDepth === 8 ? 255 : 65535, step = 1 / maximum;
  const pixelCount = region.width * region.height;
  const samples = setup.bitDepth === 8 ? new Uint8Array(pixelCount * 3) : new Uint16Array(pixelCount * 3);
  const expected = new Float64Array(pixelCount * 3), noiseStd = new Float64Array(pixelCount * 3), saturated = new Float64Array(pixelCount);
  let saturatedTotal = 0;
  const columns = Array.from({ length: region.width }, (_, i) => axisSums((region.x + i) * sx, (region.x + i + 1) * sx, frameWidth, margin));
  const M = setup.matrix, m00 = M[0]![0]!, m01 = M[0]![1]!, m02 = M[0]![2]!, m10 = M[1]![0]!, m11 = M[1]![1]!, m12 = M[1]![2]!, m20 = M[2]![0]!, m21 = M[2]![1]!, m22 = M[2]![2]!;
  const g0 = setup.gains[0], g1 = setup.gains[1], g2 = setup.gains[2], L = setup.clipLevel, reinhard = setup.toneCurve === "positive-reinhard-per-channel";
  // Small per-render tables as Float64Arrays (#442): the same doubles as plain arrays, with one element kind for the keyed loads.
  const k = Float64Array.from(setup.readout, (r) => r.perElectron), dark = Float64Array.from(setup.readout, (r) => r.darkElectrons), c0 = Float64Array.from(setup.readout, (r) => r.constantVariance);
  // Site window: 3 × 3 for the bilinear kernels, 7 × 7 when AHD's candidates read up to 3 sites away. Slot (dy + r)·(2r + 1) + dx + r.
  const candidates = setup.candidates ?? setup.demosaic.map((phase) => [phase]);
  const reach = Math.max(1, ...candidates.flat(3).map((t) => Math.max(Math.abs(t.dx), Math.abs(t.dy)))), side = 2 * reach + 1, slotsCount = side * side;
  const slotOf = (t: DisplayViewKernelTap): number => (t.dy + reach) * side + t.dx + reach;
  const { dx: slotDx, dy: slotDy } = displayViewSlotOffsets(reach);
  /** The raster index of native site (x, y) read reflect-101, as the sample loop reads it. */
  const reflectedSite = (x: number, y: number): number =>
    (y < 0 ? -y : y >= nativeHeight ? 2 * nativeHeight - 2 - y : y) * nativeWidth + (x < 0 ? -x : x >= nativeWidth ? 2 * nativeWidth - 2 - x : x);
  // Per phase: the bilinear kernels (for the site variance of each channel), the candidates, and the slots they read.
  const phaseSlots: Int32Array[][] = [], phaseWeights: Float64Array[][] = [], phaseW2: Float64Array[] = [], phaseList: Int32Array[] = [];
  const candidateSlots: Int32Array[][][] = [], candidateWeights: Float64Array[][][] = [], candidateDense: Float64Array[][] = [], candidateList: Int32Array[][] = [];
  for (let p = 0; p < 4; p++) {
    const kernels = setup.demosaic[p]!;
    phaseSlots[p] = kernels.map((list) => Int32Array.from(list, slotOf));
    phaseWeights[p] = kernels.map((list) => Float64Array.from(list, (t) => t.weight));
    phaseW2[p] = Float64Array.from(kernels, (list) => list.reduce((sum, t) => sum + t.weight * t.weight, 0));
    candidateSlots[p] = candidates[p]!.map((candidate) => candidate.map((list) => Int32Array.from(list, slotOf)));
    candidateDense[p] = candidates[p]!.map((candidate) => { const dense = new Float64Array(3 * slotsCount); candidate.forEach((list, c) => { for (const t of list) { const i = c * slotsCount + slotOf(t); dense[i] = dense[i]! + t.weight; } }); return dense; });
    candidateWeights[p] = candidates[p]!.map((candidate) => candidate.map((list) => Float64Array.from(list, (t) => t.weight)));
    const used = new Set<number>([...phaseSlots[p]!.flatMap((a) => Array.from(a)), ...candidateSlots[p]!.flat().flatMap((a) => Array.from(a))]);
    phaseList[p] = Int32Array.from([...used].sort((a, b) => a - b));
    // The slots of phaseList (same order) where a candidate has a non-zero weight in some channel. A sum over phaseList adds
    // ±0 at the other slots, which leaves a sum that starts at +0 unchanged, so the sums below skip them.
    candidateList[p] = candidateDense[p]!.map((dense) => phaseList[p]!.filter((slot) => dense[slot] !== 0 || dense[slotsCount + slot] !== 0 || dense[2 * slotsCount + slot] !== 0));
  }
  // The same tables flat (phase·2 + candidate, ·3 + channel), read by the sample loop below.
  const { count: candidateCount, denseAt, listAt, slotsAt, weightsAt } = flatDisplayViewCandidateTables(candidateSlots, candidateWeights, candidateDense, candidateList);
  const siteElectrons = new Float64Array(slotsCount), siteClip = new Float64Array(slotsCount), siteMean = new Float64Array(slotsCount), siteVar = new Float64Array(slotsCount), siteThird = new Float64Array(slotsCount), siteChannel = new Int32Array(slotsCount), clip = new Float64Array(3), B = new Float64Array(4), C = new Float64Array(9);
  const cm = new Float64Array(3), cv = new Float64Array(3), csv = new Float64Array(3), bm = new Float64Array(3), bv = new Float64Array(3), bs = new Float64Array(3);
  const hm = new Float64Array(3), hv = new Float64Array(3), hs = new Float64Array(3), an = new Float64Array(9);
  // #593, #601: the coupled rendering steps (display-view-rendering.ts); null keeps the per-component arithmetic below unchanged.
  const coupled = setup.coupled ?? null;
  const coupledA = new Float64Array(9), muY = new Float64Array(3), sY = new Float64Array(9), jY = new Float64Array(9);
  let coupledUsed = false;
  // #602: the neighbor reconstruction finds its clipped regions from this render's noise-free channels.
  coupled?.bindView?.(setup);
  const reach2 = CLIP_REACH_SIGMA * CLIP_REACH_SIGMA;
  // Site ring (#441, exact path with filled windows only): a native site's expected electrons, chart material and readout moments depend on the
  // site alone, so they are computed once per render and kept for the region's native columns (plus the reach) in a ring of
  // native rows, a power of two holding two display rows' footprints and their reach. An entry is valid while its stamp is
  // its row + 1 (negated when the window did not track materials, so a material read in one mode is never used in the other).
  // The ~27 (AHD) or ~7 (bilinear) sites a real pixel reads are copied from the ring instead of being read through the
  // signal and clipped again for each real pixel that shares them; the signal's window is still told which of its sites were
  // read (markReads), so its lookup count is the count reading them would give.
  const siteX0 = Math.max(0, Math.floor(region.x * sx) + margin - reach), siteX1 = Math.min(nativeWidth - 1, Math.ceil((region.x + region.width) * sx) - 1 + margin + reach), siteW = siteX1 - siteX0 + 1;
  let siteRows = 1;
  while (siteRows < 2 * Math.ceil(sy) + 2 + 2 * reach) siteRows *= 2;
  // Coarse (stratified) views read a few scattered real pixels per display pixel, where the ring measured slower; windows
  // without diffraction kernels read their sites from the signal's own direct ring, cheaply enough that the ring measured
  // 2–4 % slower there (Speed, #441). Both keep the per-read path below.
  const siteMask = siteRows - 1, ringCapacity = siteRows * siteW, ringUsable = exactView && ringCapacity <= SITE_RING_LIMIT;
  // Allocated at the first display pixel that uses the ring (a render whose windows never fill allocates nothing).
  let ringStamp = new Int32Array(0), ringStatStamp = ringStamp, ringMat = ringStamp, siteSlotQ = ringStamp, siteSlotStamp = ringStamp, markX = ringStamp, markY = ringStamp, markM = ringStamp;
  let ringV = new Float64Array(0), ringMean = ringV, ringVar = ringV, ringThird = ringV, ringClip = ringV, markV = ringV;
  // (No closure assigns them, so they stay locals of the render loop.)
  // With AHD the windows reach 5 sites around a footprint, the sites #457's choice on the noise-free mosaic reads.
  const ahdChoice = setup.ahdChoice, windowReach = ahdChoice ? Math.max(reach, AHD_REACH) : reach;
  // #457: AHD's choice on the noise-free mosaic. Per candidate the rendered mean and the camera-channel means of the sample.
  const candidateRendered = new Float64Array(6), candidateChannels = new Float64Array(6);
  /** The normalized expected value of an in-raster site, clipped at white (the noise-free mosaic AHD's choice reads). */
  const noiseFreeSite = (x: number, y: number): number => { const c = (y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2), v = k[c]! * (setup.signal.site(x, y) + dark[c]!); return v < 1 ? v : 1; };
  // The exact path keeps the region's columns for the whole render; the stratified estimator keeps one display pixel's
  // footprint at a time (its samples are scattered over it), so its plane is set to each display pixel's columns.
  let choiceRows = 1;
  while (choiceRows < Math.ceil(sy) + 2 + 2 * AHD_REACH) choiceRows *= 2;
  const choiceX0 = Math.max(0, exactX0 - AHD_REACH), choiceColumns = exactView ? Math.min(nativeWidth - 1, exactX0 + exactWidth - 1 + AHD_REACH) - choiceX0 + 1 : Math.ceil(sx) + 2 + 2 * AHD_REACH;
  const choicePlane = ahdChoice ? createAhdDirectionPlane(ahdChoice.labMatrix, nativeWidth, nativeHeight, choiceColumns, exactView ? 2 * choiceRows : choiceRows, noiseFreeSite) : undefined;
  if (choicePlane && exactView) choicePlane.origin(choiceX0);
  /** Normalized site value of a slot: normal with mean k·e and variance k²·e + constant, clipped at the white level (1). */
  function siteStatistics(slot: number): void {
    // The channel and electrons are read from the slot arrays: a double passed to a call that is not inlined is boxed.
    const c = siteChannel[slot]!, e = siteElectrons[slot]!, kc = k[c]!, mean = kc * e, variance = kc * kc * e + c0[c]!, gap = 1 - mean;
    // Third cumulant of the normalized value: Poisson electrons have κ₃ = e (read and rounding noise add none).
    siteThird[slot] = kc * kc * kc * e;
    // #533: the clip probability P(value ≥ 1) is 1 − P(value < 1), the clip's own slope (0 where the clip is out of reach).
    if (gap > 0 && gap * gap > reach2 * variance) { siteMean[slot] = mean; siteVar[slot] = variance; siteClip[slot] = 0; }
    else { upperClip(mean, variance, 1, clip); siteMean[slot] = clip[0]!; siteVar[slot] = clip[1]!; siteClip[slot] = 1 - clip[2]!; }
  }
  let siteCount = 0, sampleCount = 0, detail = 0, uniform = 0, lastYield = Date.now();
  // Per-real-pixel memo (#392): a sample's recorded terms depend only on its real pixel (its sites' expected electrons and its
  // CFA phase), not on the display pixel or the sample, so a later sample of the same real pixel in the same display pixel
  // replays them (the same values added to the same sums in the same order, as the one-material memo does). Slots cover the
  // display pixel's footprint and are valid while their stamp equals the display pixel's generation. A replayed sample still
  // counts its sites; it is used only where every site lies in the window's site cache, where reading it again would have
  // cost no work and no scene lookup.
  let pixelStamp = new Int32Array(0), pixelRecords = new Float64Array(0), pixelGeneration = 0;
  // Pilot: the scene at a deterministic grid over each display pixel's footprint widened by the reach; a pixel is uniform when
  // every point returns the same value. Pixels next to a detailed pixel count as detailed too, so an edge that only clips a
  // footprint's corner (too thin for the grid) still gets the full samples. The grid is fixed, so the sample count is not
  // random and the estimate stays unbiased either way.
  const pilotUniform = (vx: number, vy: number): boolean => {
    const ax0 = vx * sx + margin - reachSites, ax1 = (vx + 1) * sx + margin + reachSites, ay0 = vy * sy + margin - reachSites, ay1 = (vy + 1) * sy + margin + reachSites;
    const px = pilotCount(ax1 - ax0), py = pilotCount(ay1 - ay0);
    let first = NaN;
    for (let j = 0; j < py; j++) {
      const v = -(ay0 + (j + 0.5) * (ay1 - ay0) / py - nativeHeight / 2) * g;
      for (let i = 0; i < px; i++) {
        const value = setup.signal.pilot((ax0 + (i + 0.5) * (ax1 - ax0) / px - nativeWidth / 2) * g, v);
        if (i === 0 && j === 0) first = value; else if (value !== first) return false;
      }
    }
    return true;
  };
  // Pilot flags for the region and a one-pixel ring (clipped to the view), three rows at a time.
  const ringWidth = region.width + 2, flagRows: Uint8Array[] = [];
  const pilotRow = (vy: number): Uint8Array => {
    const row = new Uint8Array(ringWidth);
    // The exact area mean needs no pilot: every pixel evaluates its whole footprint.
    if (exactView || vy < 0 || vy >= viewHeight) return row.fill(1);
    for (let i = 0; i < ringWidth; i++) { const vx = region.x - 1 + i; row[i] = vx < 0 || vx >= viewWidth ? 1 : pilotUniform(vx, vy) ? 1 : 0; }
    return row;
  };
  flagRows.push(pilotRow(region.y - 1), pilotRow(region.y));
  for (let ry = 0; ry < region.height; ry++) {
    const vy = region.y + ry, rows = axisSums(vy * sy, (vy + 1) * sy, frameHeight, margin), rowOverlaps = exactView ? overlaps(vy * sy, (vy + 1) * sy, frameHeight) : undefined;
    flagRows.push(pilotRow(vy + 1));
    if (flagRows.length > 3) flagRows.shift();
    for (let rx = 0; rx < region.width; rx++) {
      const vx = region.x + rx, index = vy * viewWidth + vx;
      footprintWeights(columns[rx]!, rows, area, B);
      let same = true;
      for (let j = 0; j < 3 && same; j++) for (let i = rx; i <= rx + 2; i++) if (flagRows[j]![i] === 0) { same = false; break; }
      const K = same ? uniformK : fullK, Q = K * K;
      // On the exact path every pixel counts as detailed (its whole footprint is evaluated).
      if (exactView) detail++; else if (same) uniform++; else detail++;
      const cols = exactView ? columnOverlaps[rx]! : undefined, nx = cols ? cols.w.length : 0, sampleTotal = exactView ? nx * rowOverlaps!.w.length : Q;
      const wx0 = Math.floor(vx * sx) + margin - windowReach, wy0 = Math.floor(vy * sy) + margin - windowReach;
      const wx1 = Math.ceil((vx + 1) * sx) + margin + windowReach, wy1 = Math.ceil((vy + 1) * sy) + margin + windowReach;
      setup.signal.window(wx0, wy0, wx1, wy1);
      // The jitter stream is only drawn from by the stratified estimator; the exact path reads no jitter.
      const jitter = exactView ? undefined : createDeterministicUniformStream(deriveNativeSiteStreamSeedUint32(seed, index, DISPLAY_VIEW_JITTER_STREAM_ID)), tracking = setup.signal.tracksMaterial;
      const ringOn = ringUsable && setup.signal.marksReads, ringSign = tracking ? 1 : -1;
      if (ringOn && ringStamp.length === 0) {
        ringStamp = new Int32Array(ringCapacity); ringStatStamp = new Int32Array(ringCapacity); ringMat = new Int32Array(ringCapacity);
        ringV = new Float64Array(ringCapacity); ringMean = new Float64Array(ringCapacity); ringVar = new Float64Array(ringCapacity); ringThird = new Float64Array(ringCapacity); ringClip = new Float64Array(ringCapacity);
        siteSlotQ = new Int32Array(slotsCount); siteSlotStamp = new Int32Array(slotsCount);
        markX = new Int32Array(slotsCount); markY = new Int32Array(slotsCount); markV = new Float64Array(slotsCount); markM = new Int32Array(slotsCount);
      }
      const mx0 = Math.floor(vx * sx) + margin, my0 = Math.floor(vy * sy) + margin;
      if (choicePlane && !exactView) choicePlane.origin(Math.max(0, mx0 - AHD_REACH));
      const mw = Math.min(frameWidth - 1, Math.ceil((vx + 1) * sx)) + margin - mx0 + 1, mh = Math.min(frameHeight - 1, Math.ceil((vy + 1) * sy)) + margin - my0 + 1;
      const pixelMemo = !exactView && setup.signal.cachesSites && mw * mh <= PIXEL_MEMO_LIMIT;
      if (pixelMemo) {
        if (pixelStamp.length < mw * mh) { pixelStamp = new Int32Array(mw * mh); pixelRecords = new Float64Array(mw * mh * MEMO_SIZE); pixelGeneration = 0; }
        pixelGeneration++;
      }
      let s0 = 0, s1 = 0, s2 = 0, c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0, r0 = 0, r1 = 0, r2 = 0, sat = 0;
      for (let n = 0; n < sampleTotal; n++) {
        // A sample's weights: 1 for the stratified estimator (its sums are divided by Q below); a_j for the expected value and
        // linear covariance and a_j² for the independent residual on the exact path. Multiplying by 1 leaves every value's bits.
        let x: number, y: number, wE = 1, wR = 1;
        if (cols) {
          const i = n % nx, j = (n - i) / nx, aj = cols.w[i]! * rowOverlaps!.w[j]! / area;
          x = cols.first + i + margin; y = rowOverlaps!.first + j + margin; wE = aj; wR = aj * aj;
        } else {
          const a = n % K, b = (n - a) / K;
          const fx = (vx + (a + jitter!.next()) / K) * sx, fy = (vy + (b + jitter!.next()) / K) * sy;
          x = Math.min(frameWidth - 1, Math.floor(fx)) + margin; y = Math.min(frameHeight - 1, Math.floor(fy)) + margin;
        }
        const phase = (y & 1) * 2 + (x & 1), list = phaseList[phase]!;
        let material = -2, statistics = false;
        const px = x - mx0, py = y - my0;
        const inside = x >= reach && y >= reach && x + reach < nativeWidth && y + reach < nativeHeight;
        const stamps = exactMemo ? exactStamp : pixelStamp, records = exactMemo ? exactRecords : pixelRecords, stamp = exactMemo ? y + 1 : pixelGeneration;
        const pk = exactMemo ? (inside && x >= exactX0 && x - exactX0 < exactWidth ? (y & (exactRows - 1)) * exactWidth + x - exactX0 : -1)
          : pixelMemo && px >= 0 && py >= 0 && px < mw && py < mh && inside ? py * mw + px : -1;
        let memo: Float64Array | undefined, mo = 0;
        if (pk >= 0 && stamps[pk] === stamp) { memo = records; mo = pk * MEMO_SIZE; siteCount += list.length; }
        // The expected electrons of the sites the demosaic reads (sites outside the raster, at mirror borders, are read
        // reflect-101); where the signal tracks it, whether they all read one chart material, with the statistics below only
        // when the sample is not replayed; otherwise the statistics at once.
        if (!memo && ringOn) {
          let marks = 0;
          for (let li = 0; li < list.length; li++) {
            const slot = list[li]!;
            siteCount++;
            let sxs = x + slotDx[slot]!, sys = y + slotDy[slot]!;
            if (sxs < 0) sxs = -sxs; else if (sxs >= nativeWidth) sxs = 2 * nativeWidth - 2 - sxs;
            if (sys < 0) sys = -sys; else if (sys >= nativeHeight) sys = 2 * nativeHeight - 2 - sys;
            const c = (sys & 1) === 0 ? ((sxs & 1) === 0 ? 0 : 1) : ((sxs & 1) === 0 ? 1 : 2);
            siteChannel[slot] = c;
            // The site's ring entry, for a site inside the ring's columns and the signal's window (a site outside the window
            // is read through the signal, which counts it as it counts any read outside its window).
            const rowStamp = ringSign * (sys + 1), q = ringOn && sxs >= siteX0 && sxs <= siteX1 && sxs >= wx0 && sxs < wx1 && sys >= wy0 && sys < wy1 ? (sys & siteMask) * siteW + sxs - siteX0 : -1;
            siteSlotQ[slot] = q; siteSlotStamp[slot] = rowStamp;
            let e: number;
            if (q >= 0 && ringStamp[q] === rowStamp) {
              // The value and material the signal returned for this site; the window is told it was read (markReads below).
              const v = ringV[q]!, own = ringMat[q]!;
              e = v + dark[c]!;
              markX[marks] = sxs; markY[marks] = sys; markV[marks] = v; markM[marks] = own; marks++;
              if (tracking) { siteElectrons[slot] = e; material = material === -2 || material === own ? own : -1; continue; }
            } else {
              const v = setup.signal.site(sxs, sys), own = tracking ? setup.signal.uniformMaterial : -1;
              e = v + dark[c]!;
              if (q >= 0) { ringStamp[q] = rowStamp; ringV[q] = v; ringMat[q] = own; ringStatStamp[q] = 0; }
              if (tracking) { siteElectrons[slot] = e; material = material === -2 || material === own ? own : -1; continue; }
            }
            if (q >= 0 && ringStatStamp[q] === rowStamp) { siteMean[slot] = ringMean[q]!; siteVar[slot] = ringVar[q]!; siteThird[slot] = ringThird[q]!; siteClip[slot] = ringClip[q]!; continue; }
            // As siteStatistics, written out here for the untracked (Speed) path.
            const kc = k[c]!, mean = kc * e, variance = kc * kc * e + c0[c]!, gap = 1 - mean, third = kc * kc * kc * e;
            let sm: number, sv: number, sp: number;
            if (gap > 0 && gap * gap > reach2 * variance) { sm = mean; sv = variance; sp = 0; }
            else { upperClip(mean, variance, 1, clip); sm = clip[0]!; sv = clip[1]!; sp = 1 - clip[2]!; }
            siteMean[slot] = sm; siteVar[slot] = sv; siteThird[slot] = third; siteClip[slot] = sp;
            if (q >= 0) { ringStatStamp[q] = rowStamp; ringMean[q] = sm; ringVar[q] = sv; ringThird[q] = third; ringClip[q] = sp; }
          }
          if (marks > 0) setup.signal.markReads(markX, markY, markV, markM, marks);
        } else if (!memo) for (let li = 0; li < list.length; li++) {
          // Without the ring (coarse views, windows without diffraction kernels or with lazy caches): each site through the signal.
          const slot = list[li]!;
          siteCount++;
          let sxs = x + slotDx[slot]!, sys = y + slotDy[slot]!;
          if (sxs < 0) sxs = -sxs; else if (sxs >= nativeWidth) sxs = 2 * nativeWidth - 2 - sxs;
          if (sys < 0) sys = -sys; else if (sys >= nativeHeight) sys = 2 * nativeHeight - 2 - sys;
          const c = (sys & 1) === 0 ? ((sxs & 1) === 0 ? 0 : 1) : ((sxs & 1) === 0 ? 1 : 2);
          const e = setup.signal.site(sxs, sys) + dark[c]!;
          siteChannel[slot] = c;
          if (tracking && !statistics) {
            siteElectrons[slot] = e; const own = setup.signal.uniformMaterial; material = material === -2 || material === own ? own : -1;
            if (material >= 0) continue;
            // The first site of a second material: the sample is not replayed, so the statistics are taken now, for the earlier
            // sites and inline from this site on, instead of in a second pass (#444; each site's statistics depend on its own
            // slot only, so the order leaves every value's bits).
            statistics = true;
            for (let lj = 0; lj < li; lj++) siteStatistics(list[lj]!);
          }
          // As siteStatistics, written out here for the untracked (Speed) path.
          const kc = k[c]!, mean = kc * e, variance = kc * kc * e + c0[c]!, gap = 1 - mean;
          siteThird[slot] = kc * kc * kc * e;
          if (gap > 0 && gap * gap > reach2 * variance) { siteMean[slot] = mean; siteVar[slot] = variance; siteClip[slot] = 0; }
          else { upperClip(mean, variance, 1, clip); siteMean[slot] = clip[0]!; siteVar[slot] = clip[1]!; siteClip[slot] = 1 - clip[2]!; }
        }
        if (!tracking) material = -1;
        const count = candidateCount, share = 1 / count;
        if (memo) {
          for (let d = 0; d < count; d++) {
            for (let c = 0; c < 3; c++) {
              const o = mo + 3 + (d * 3 + c) * 3, a0 = memo[o]!, a1 = memo[o + 1]!, a2 = memo[o + 2]!, wgt = wE * share * B[c]! * memo[mo + c]!;
              c00 += wgt * a0 * a0; c01 += wgt * a0 * a1; c02 += wgt * a0 * a2; c11 += wgt * a1 * a1; c12 += wgt * a1 * a2; c22 += wgt * a2 * a2;
            }
            r0 += wR * memo[mo + 21 + d * 3]!; r1 += wR * memo[mo + 22 + d * 3]!; r2 += wR * memo[mo + 23 + d * 3]!;
          }
          s0 += wE * memo[mo + 27]!; s1 += wE * memo[mo + 28]!; s2 += wE * memo[mo + 29]!;
          if (count === 2) { r0 += wR * memo[mo + 30]!; r1 += wR * memo[mo + 31]!; r2 += wR * memo[mo + 32]!; }
          sat += wE * memo[mo + 33]!;
          continue;
        }
        // The terms are written where they are kept: the real pixel's memo slot; no typed-array view per sample.
        const rt = pk >= 0 ? records : undefined, ro = pk >= 0 ? pk * MEMO_SIZE : 0;
        // Every field of the record (MEMO_SIZE layout) that the propagation below does not write for this sample is zeroed, as a
        // fill of the whole record would leave it. Always written: [0, 3), [27, 30) and candidate 0's [3, 12) and [21, 24); with
        // two candidates also candidate 1's [12, 21) and [24, 27) and the choice terms [30, 33).
        if (rt && count === 1) { for (let o = 12; o < 21; o++) rt[ro + o] = 0; rt[ro + 24] = 0; rt[ro + 25] = 0; rt[ro + 26] = 0; rt[ro + 30] = 0; rt[ro + 31] = 0; rt[ro + 32] = 0; }
        if (tracking && !ringOn) { if (!statistics) for (let li = 0; li < list.length; li++) siteStatistics(list[li]!); }
        else if (tracking) for (let li = 0; li < list.length; li++) {
          const slot = list[li]!, q = siteSlotQ[slot]!, rowStamp = siteSlotStamp[slot]!;
          if (q >= 0 && ringStatStamp[q] === rowStamp) { siteMean[slot] = ringMean[q]!; siteVar[slot] = ringVar[q]!; siteThird[slot] = ringThird[q]!; siteClip[slot] = ringClip[q]!; continue; }
          siteStatistics(slot);
          if (q >= 0) { ringStatStamp[q] = rowStamp; ringMean[q] = siteMean[slot]!; ringVar[q] = siteVar[slot]!; ringThird[q] = siteThird[slot]!; ringClip[q] = siteClip[slot]!; }
        }
        // Site variance of each channel through the bilinear kernels (for B_c), then the demosaic's own pixel statistics: the
        // mean and covariance of its camera channels, averaged over its candidates (AHD picks one per pixel).
        const slots = phaseSlots[phase]!, weights = phaseWeights[phase]!, w2 = phaseW2[phase]!;
        for (let c = 0; c < 3; c++) {
          const sl = slots[c]!, wt = weights[c]!;
          let variance = 0;
          for (let t = 0; t < sl.length; t++) variance += wt[t]! * wt[t]! * siteVar[sl[t]!]!;
          csv[c] = variance / w2[c]!;
        }
        // Each candidate of the demosaic (one for bilinear; AHD's horizontal and vertical ones, of which AHD picks one per pixel)
        // is propagated on its own: camera-channel mean and covariance, white balance and highlight clip, colour matrix and
        // rendering; the pixel's statistics are their average.
        let e0 = 0, e1 = 0, e2 = 0;
        for (let d = 0; d < count; d++) {
          for (let c = 0; c < 3; c++) {
            const sl = slotsAt[(phase * 2 + d) * 3 + c]!, wt = weightsAt[(phase * 2 + d) * 3 + c]!;
            let mean = 0;
            for (let t = 0; t < sl.length; t++) mean += wt[t]! * siteMean[sl[t]!]!;
            cm[c] = mean;
          }
          // Covariance of channels i, j: Σ over the sites of w_i·w_j·Var(site), with the kernels as dense weights over the window.
          const dense = denseAt[phase * 2 + d]!, list = listAt[phase * 2 + d]!;
          let v00 = 0, v01 = 0, v02 = 0, v11 = 0, v12 = 0, v22 = 0;
          for (let li = 0; li < list.length; li++) {
            const slot = list[li]!, v = siteVar[slot]!, w0 = dense[slot]!, w1 = dense[slotsCount + slot]!, w2 = dense[2 * slotsCount + slot]!;
            v00 += w0 * w0 * v; v01 += w0 * w1 * v; v02 += w0 * w2 * v; v11 += w1 * w1 * v; v12 += w1 * w2 * v; v22 += w2 * w2 * v;
          }
          C[0] = v00; C[1] = v01; C[2] = v02; C[3] = v01; C[4] = v11; C[5] = v12; C[6] = v02; C[7] = v12; C[8] = v22;
          // #593: where the reconstruct blend is within reach the whole chain is integrated (display-view-rendering.ts); out of
          // its reach reconstruct is the unclipped white balance.
          let chainRun = coupled !== null && coupled.reconstruct && coupled.reconstructInReach(cm, C);
          coupledUsed = chainRun;
          if (!chainRun) {
            // White balance and the highlight clip at the smallest gain (per channel; covariances scaled by the expected slopes).
            for (let c = 0; c < 3; c++) {
              const mean = cm[c]!, variance = C[c * 4]!;
              cv[c] = variance;
              const gc = c === 0 ? g0 : c === 1 ? g1 : g2, um = gc * mean, uv = gc * gc * variance, gap = L - um;
              if (coupled?.reconstruct || gap > 0 && gap * gap > reach2 * uv) { bm[c] = um; bv[c] = uv; bs[c] = gc; }
              else { upperClip(um, uv, L, clip); bm[c] = clip[0]!; bv[c] = clip[1]!; bs[c] = gc * clip[2]!; }
            }
          }
          if (!chainRun && coupled?.luminanceTone) {
            // The developed y = M·b: mean and covariance (diagonal from the clipped variances, off-diagonal through the slopes).
            for (let r = 0; r < 3; r++) muY[r] = M[r]![0]! * bm[0]! + M[r]![1]! * bm[1]! + M[r]![2]! * bm[2]!;
            for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) {
              let v = 0;
              for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) v += M[r]![i]! * M[q]![j]! * (i === j ? bv[i]! : bs[i]! * bs[j]! * C[i * 3 + j]!);
              sY[r * 3 + q] = v;
            }
            if (coupled.tone(muY, sY, hm, hv, jY)) {
              for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) coupledA[r * 3 + c] = (jY[r * 3]! * M[0]![c]! + jY[r * 3 + 1]! * M[1]![c]! + jY[r * 3 + 2]! * M[2]![c]!) * bs[c]!;
              coupledUsed = true;
            } else chainRun = true;
          } else if (!chainRun) {
            // Colour matrix, then the rendering of each component (tone curve, clip to [0, 1]).
            for (let comp = 0; comp < 3; comp++) {
              const r0m = comp === 0 ? m00 : comp === 1 ? m10 : m20, r1m = comp === 0 ? m01 : comp === 1 ? m11 : m21, r2m = comp === 0 ? m02 : comp === 1 ? m12 : m22;
              const mean = r0m * bm[0]! + r1m * bm[1]! + r2m * bm[2]!;
              const variance = r0m * r0m * bv[0]! + r1m * r1m * bv[1]! + r2m * r2m * bv[2]! +
                2 * (r0m * r1m * bs[0]! * bs[1]! * C[1]! + r0m * r2m * bs[0]! * bs[2]! * C[2]! + r1m * r2m * bs[1]! * bs[2]! * C[5]!);
              if (!reinhard && mean > 0 && mean < 1 && mean * mean > reach2 * variance && (1 - mean) * (1 - mean) > reach2 * variance) { hm[comp] = mean; hv[comp] = variance; hs[comp] = 1; }
              else if (reinhard) { reinhardMoments(mean, variance, clip); hm[comp] = clip[0]!; hv[comp] = clip[1]!; hs[comp] = clip[2]!; }
              else {
                // The component is a linear combination of the sites: κ₃ = Σ (Σ_c M·Γ_c·w_c,site)³·κ₃(site).
                const dense = denseAt[phase * 2 + d]!, list = listAt[phase * 2 + d]!;
                let third = 0;
                for (let li = 0; li < list.length; li++) {
                  const slot = list[li]!, coefficient = r0m * bs[0]! * dense[slot]! + r1m * bs[1]! * dense[slotsCount + slot]! + r2m * bs[2]! * dense[2 * slotsCount + slot]!;
                  third += coefficient * coefficient * coefficient * siteThird[slot]!;
                }
                unitClip(mean, variance, clip, variance > 0 ? third / (variance * Math.sqrt(variance)) : 0);
                hm[comp] = clip[0]!; hv[comp] = clip[1]!; hs[comp] = clip[2]!;
              }
            }
            // #601: a component that reaches 1 within reach is desaturated with the others: the chain is integrated.
            if (coupled?.desaturate && !reinhard) for (let comp = 0; comp < 3; comp++) {
              const mean = hm[comp]!;
              // The test is taken at 0.999 rather than 1, so a component clipped to 1 is decided in float32 too (the GPU kernels).
              if (mean > 0 && hm[comp]! + CLIP_REACH_SIGMA * Math.sqrt(hv[comp]!) >= 0.999) chainRun = true;
            }
          }
          if (chainRun) { coupled!.at?.(x, y); coupled!.chain(cm, C, hm, hv, coupledA); coupledUsed = true; }
          e0 += share * hm[0]!; e1 += share * hm[1]!; e2 += share * hm[2]!;
          candidateRendered[3 * d] = hm[0]!; candidateRendered[3 * d + 1] = hm[1]!; candidateRendered[3 * d + 2] = hm[2]!;
          candidateChannels[3 * d] = cm[0]!; candidateChannels[3 * d + 1] = cm[1]!; candidateChannels[3 * d + 2] = cm[2]!;
          // Linear (Stein) part: a_c = J ∘ M[:, c]·Γ_c, accumulated with B_c·σ_c² (site variance of channel c); the pixel's own
          // linear variance (aᵀ·C·a, full channel covariance) for the residual.
          let l0 = 0, l1 = 0, l2 = 0;
          for (let c = 0; c < 3; c++) {
            const a0 = coupledUsed ? coupledA[c]! : hs[0]! * (c === 0 ? m00 : c === 1 ? m01 : m02) * bs[c]!, a1 = coupledUsed ? coupledA[3 + c]! : hs[1]! * (c === 0 ? m10 : c === 1 ? m11 : m12) * bs[c]!,
              a2 = coupledUsed ? coupledA[6 + c]! : hs[2]! * (c === 0 ? m20 : c === 1 ? m21 : m22) * bs[c]!;
            const wgt = wE * share * B[c]! * csv[c]!;
            c00 += wgt * a0 * a0; c01 += wgt * a0 * a1; c02 += wgt * a0 * a2; c11 += wgt * a1 * a1; c12 += wgt * a1 * a2; c22 += wgt * a2 * a2;
            an[c] = a0; an[3 + c] = a1; an[6 + c] = a2;
            if (rt) { const o = 3 + (d * 3 + c) * 3; rt[ro + o] = a0; rt[ro + o + 1] = a1; rt[ro + o + 2] = a2; }
          }
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const cij = C[i * 3 + j]!; l0 += an[i]! * an[j]! * cij; l1 += an[3 + i]! * an[3 + j]! * cij; l2 += an[6 + i]! * an[6 + j]! * cij; }
          const t0 = share * Math.max(0, hv[0]! - l0), t1 = share * Math.max(0, hv[1]! - l1), t2 = share * Math.max(0, hv[2]! - l2);
          r0 += wR * t0; r1 += wR * t1; r2 += wR * t2;
          if (rt) { rt[ro + 21 + d * 3] = t0; rt[ro + 22 + d * 3] = t1; rt[ro + 23 + d * 3] = t2; }
        }
        // #457: AHD chooses one candidate per pixel by homogeneity. Where the scene decides that choice (structure finer than a
        // few sites, such as a Siemens star's centre), the expected value is the chosen candidate's, not the candidates' average:
        // the steps run on the noise-free mosaic (the expected normalized site values, clipped at white, mirrored at the raster
        // edges as the capture's AHD reads them), and a decided direction takes that candidate's rendered mean. A tie (every flat
        // neighbourhood, where the noise decides) keeps the average, and the low-signal correction below stays the noise's
        // bias of a flat neighbourhood. Skipped where the two candidates' channel means are equal (the choice cannot change the
        // value) and for one-material samples (equal up to rounding). The noise terms are unchanged.
        // (2.21.0: a one-material sample's terms are computed like any other sample's; no record is kept per material.)
        if (choicePlane && count === 2 && material < 0 && (candidateChannels[0] !== candidateChannels[3] || candidateChannels[1] !== candidateChannels[4] || candidateChannels[2] !== candidateChannels[5])) {
          const direction = choicePlane.direction(x, y);
          if (direction !== 2) { e0 = candidateRendered[3 * direction]!; e1 = candidateRendered[3 * direction + 1]!; e2 = candidateRendered[3 * direction + 2]!; }
        }
        s0 += wE * e0; s1 += wE * e1; s2 += wE * e2;
        if (rt) { rt[ro + 0] = csv[0]!; rt[ro + 1] = csv[1]!; rt[ro + 2] = csv[2]!; rt[ro + 27] = e0; rt[ro + 28] = e1; rt[ro + 29] = e2; }
        // #533: the real pixel's saturation probability, 1 − Π_k (1 − p_k) over the distinct sites its demosaic reads (the
        // capture counts a pixel with at least one clipped contributing site; the sites' noises are independent). A site read
        // twice through the mirrored border counts once.
        let unclipped = 1;
        if (inside) for (let li = 0; li < list.length; li++) unclipped *= 1 - siteClip[list[li]!]!;
        else for (let li = 0; li < list.length; li++) {
          const slot = list[li]!, at = reflectedSite(x + slotDx[slot]!, y + slotDy[slot]!);
          let repeated = false;
          for (let lj = 0; lj < li && !repeated; lj++) repeated = reflectedSite(x + slotDx[list[lj]!]!, y + slotDy[list[lj]!]!) === at;
          if (!repeated) unclipped *= 1 - siteClip[slot]!;
        }
        const saturation = 1 - unclipped;
        sat += wE * saturation;
        if (rt) rt[ro + 33] = saturation;
        if (count === 2) {
          // AHD's per-pixel choice between the candidates adds independent variance: with a noise-driven choice each pixel
          // deviates from the candidates' average by ±½(H − V), variance ¼·Var(H − V) (linear in the sites, at the last
          // candidate's slopes).
          const dh = denseAt[phase * 2]!, dv = denseAt[phase * 2 + 1]!, list = phaseList[phase]!;
          let x0 = 0, x1 = 0, x2 = 0;
          for (let li = 0; li < list.length; li++) {
            const slot = list[li]!, d0 = bs[0]! * (dh[slot]! - dv[slot]!), d1 = bs[1]! * (dh[slotsCount + slot]! - dv[slotsCount + slot]!), d2 = bs[2]! * (dh[2 * slotsCount + slot]! - dv[2 * slotsCount + slot]!);
            const v = siteVar[slot]!;
            let a: number, b: number, c: number;
            if (coupledUsed) {
              // #593: the coupled slopes ∂out/∂c (camera channels) of the last candidate.
              const e0 = dh[slot]! - dv[slot]!, e1 = dh[slotsCount + slot]! - dv[slotsCount + slot]!, e2 = dh[2 * slotsCount + slot]! - dv[2 * slotsCount + slot]!;
              a = coupledA[0]! * e0 + coupledA[1]! * e1 + coupledA[2]! * e2; b = coupledA[3]! * e0 + coupledA[4]! * e1 + coupledA[5]! * e2; c = coupledA[6]! * e0 + coupledA[7]! * e1 + coupledA[8]! * e2;
            } else { a = hs[0]! * (m00 * d0 + m01 * d1 + m02 * d2); b = hs[1]! * (m10 * d0 + m11 * d1 + m12 * d2); c = hs[2]! * (m20 * d0 + m21 * d1 + m22 * d2); }
            x0 += a * a * v; x1 += b * b * v; x2 += c * c * v;
          }
          r0 += wR * (x0 / 4); r1 += wR * (x1 / 4); r2 += wR * (x2 / 4);
          if (rt) { rt[ro + 30] = x0 / 4; rt[ro + 31] = x1 / 4; rt[ro + 32] = x2 / 4; }
        }
        if (pk >= 0) stamps[pk] = stamp;
      }
      sampleCount += sampleTotal;
      // Stratified: means over Q samples. Exact: the weights already sum to 1 (Σ a_j = 1) and the residual carries Σ a_j²·r_j.
      const Qd = exactView ? 1 : Q, mean0 = s0 / Qd, mean1 = s1 / Qd, mean2 = s2 / Qd, pixels = B[3]!;
      // #533: the expected saturated real pixels of the rectangle (A real pixels): A·Σ_j a_j·P_j, or A times the samples' mean.
      const saturatedHere = (sat / Qd) * area;
      saturated[ry * region.width + rx] = saturatedHere; saturatedTotal += saturatedHere;
      // The real pixels' output rounding (Δ²/12 in the encoded domain), mapped to linear light at the mean.
      const q0 = quantizationVariance(mean0, step), q1 = quantizationVariance(mean1, step), q2 = quantizationVariance(mean2, step);
      // Covariance in linear light: the linear part plus the independent per-pixel residuals and rounding.
      const v00 = exactView ? c00 + r0 + pixels * q0 : c00 / Q + pixels * (r0 / Q + q0), v01 = c01 / Qd, v02 = c02 / Qd,
        v11 = exactView ? c11 + r1 + pixels * q1 : c11 / Q + pixels * (r1 / Q + q1), v12 = c12 / Qd, v22 = exactView ? c22 + r2 + pixels * q2 : c22 / Q + pixels * (r2 / Q + q2);
      const noise = createDeterministicUniformStream(deriveNativeSiteStreamSeedUint32(seed, index, DISPLAY_VIEW_NOISE_STREAM_ID));
      const z0 = samplePortableStandardNormal(noise), z1 = samplePortableStandardNormal(noise), z2 = samplePortableStandardNormal(noise);
      // Cholesky factor of the 3 × 3 covariance (positive semidefinite; tiny negative pivots are treated as 0).
      const l00 = Math.sqrt(Math.max(0, v00)), l10 = l00 > 0 ? v01 / l00 : 0, l20 = l00 > 0 ? v02 / l00 : 0;
      const l11 = Math.sqrt(Math.max(0, v11 - l10 * l10)), l21 = l11 > 0 ? (v12 - l20 * l10) / l11 : 0;
      const l22 = Math.sqrt(Math.max(0, v22 - l20 * l20 - l21 * l21));
      const o = (ry * region.width + rx) * 3;
      // The drawn value is clipped to [0, 1] like any light level; where the noise reaches a bound, the normal's centre is
      // moved so that the clipped draw keeps the expected value (the mean of real pixels in [0, 1] is in [0, 1] already).
      const n0 = clipCentre(mean0, v00) + l00 * z0, n1 = clipCentre(mean1, v11) + l10 * z0 + l11 * z1, n2 = clipCentre(mean2, v22) + l20 * z0 + l21 * z1 + l22 * z2;
      samples[o] = Math.round(encodeSrgbComponentPortable(n0 < 0 ? 0 : n0 > 1 ? 1 : n0) * maximum);
      samples[o + 1] = Math.round(encodeSrgbComponentPortable(n1 < 0 ? 0 : n1 > 1 ? 1 : n1) * maximum);
      samples[o + 2] = Math.round(encodeSrgbComponentPortable(n2 < 0 ? 0 : n2 > 1 ? 1 : n2) * maximum);
      expected[o] = mean0; expected[o + 1] = mean1; expected[o + 2] = mean2;
      noiseStd[o] = Math.sqrt(Math.max(0, v00)); noiseStd[o + 1] = Math.sqrt(Math.max(0, v11)); noiseStd[o + 2] = Math.sqrt(Math.max(0, v22));
      // The clock is read every 16 display pixels and at the end of each row (yield timing never changes the output).
      if (((rx & 15) === 15 || rx === region.width - 1) && Date.now() - lastYield >= 8) { await setup.yieldControl(); setup.checkAbort(); lastYield = Date.now(); }
    }
  }
  return { samples, expected, noiseStd, sampleCount, siteCount, detailPixelCount: detail, uniformPixelCount: uniform,
    estimation: exactView ? "exact-area-mean" : "stratified-monte-carlo", saturated, saturatedPixelCount: saturatedTotal };
}

/**
 * The centre c of a normal of variance v whose clip to [0, 1] has mean `target` (bisection; c = target when the noise does
 * not reach a bound, or when the target lies outside (0, 1)).
 */
export function clipCentre(target: number, v: number): number {
  if (!(v > 0) || !(target > 0 && target < 1)) return target;
  const s = Math.sqrt(v);
  if (target > 4 * s && 1 - target > 4 * s) return target;
  const moments = new Float64Array(3);
  let lo = target - 10 * s, hi = target + 10 * s;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; unitClip(mid, v, moments); if (moments[0]! < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
/** Variance in linear light of rounding an sRGB-encoded value to steps of `step`: (dEOTF/de)²·step²/12 at the encoded mean. */
export function quantizationVariance(linear: number, step: number): number {
  const e = encodeSrgbComponentPortable(linear < 0 ? 0 : linear > 1 ? 1 : linear), slope = e <= 0.04045 ? 1 / 12.92 : 2.4 / 1.055 * portablePow((e + 0.055) / 1.055, 1.4);
  return slope * slope * step * step / 12;
}
