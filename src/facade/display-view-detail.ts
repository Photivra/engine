// SPDX-License-Identifier: Apache-2.0

/**
 * #628: `output.lensCorrections` and `output.sharpening` in the display view, loaded on demand (a view without them never loads this).
 *
 * Lens corrections. The capture corrects its developed linear colour before the tone curve: output channel c of pixel q reads the
 * developed image at its source point s_c(q) (lateral colour, distortion and the fill magnification) and multiplies it by the vignetting
 * gain. The view renders through the renderer's `correction` hook (`createDisplayViewLensCorrection`, src/output/developed-lens-corrections.ts),
 * once per distinct channel map: with lateral colour each channel has its own, so the view renders three passes and takes each component's
 * mean from its own pass and the noise covariance from the green pass (an approximation: the channels' footprints differ by the lateral
 * colour's shift, a fraction of a display pixel).
 *
 * Sharpening. The capture's unsharp mask acts on the encoded rendered values before quantization: y = x + a·(x − G_σ∗x) where
 * |x − G_σ∗x| ≥ threshold, clipped to [0, 1]. The view renders the real output pixels of the region and the mask's reach (a 1:1 render,
 * with the corrections), applies the capture's own mask (`applyUnsharpMask`) to their encoded expected values and area-averages the result in
 * linear light; the region's pixels are those of the whole view. The noise is drawn with the unsharpened view's covariance times the mask's
 * noise gain Σh² at display scale, h = (1 + a)·δ − a·(W ⊗ W), W_n = Σ_j Σ_k ω₀(j)·ω_n(k)·g(j − k) / s the capture's Gaussian g averaged over
 * display pixels (ω_n the real pixels' overlaps with display pixel n): the capture's own gain at 1:1, tending to 1 as the display pixels grow.
 * Approximations: the mask acts on expected values (the noise's interaction with the threshold and the clip is not modelled), and the noise
 * gain treats display pixels as independent. A coarser method at display scale was measured and left out (no better than no mask; see
 * docs/DISPLAY_VIEW.md).
 *
 * Cost (#649). The passes of one call share a site store (each native site's expected electrons, as the signal integrated them for that
 * site, keyed by its coordinates) and a store of real pixels' recorded terms (the renderer's per-real-pixel memo, which under the fast
 * method does not depend on the channel map: the gain is taken at the developed pixel's centre), both bounded and dropped when the call
 * returns. The passes run band by band of whole rows so that a band's records are still held when its next pass reads them; with the mask
 * the view-size render runs for the first channel map only, and passes whose samples are not used draw no noise. Each step forms the same
 * values from the same operands, so the result is unchanged. The exact correction keeps its memos off, as before.
 */

import type { DisplayViewCorrection, DisplayViewExpectedSignal, DisplayViewPixelStore, DisplayViewRenderResult, DisplayViewSetup, drawDisplayPixel, overlaps, renderDisplayView, unsharpNoiseGain } from "./display-view.js";
import { encodeSrgbComponentPortable } from "../color/srgb-transfer.js";
import { portablePow } from "../core/portable-math.js";
import { applyUnsharpMask, unsharpMaskKernel, type UnsharpMaskSettings } from "../processing/development-detail.js";

/** #628: what a display view develops after the view's own pixels. */
export interface DisplayViewDetail {
  /** The renderer's functions, passed in so this module (in the opt-in kit, which captures load too) never imports the renderer. */
  view: { render: typeof renderDisplayView; draw: typeof drawDisplayPixel; overlaps: typeof overlaps; noiseGain: typeof unsharpNoiseGain };
  /** The lens corrections: the renderer's hook for one channel (0, 1, 2) at a view size; `channels` the distinct channel maps (green first). */
  lens?: { hook(channel: number, viewWidth: number, viewHeight: number): DisplayViewCorrection; channels: readonly number[] };
  sharpening?: UnsharpMaskSettings;
}
type Rect = { x: number; y: number; width: number; height: number };
const decode = (e: number): number => (e <= 0.04045 ? e / 12.92 : portablePow((e + 0.055) / 1.055, 2.4));
const clip01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** #649: each per-call store's byte budget (32 MiB). */
const STORE_BYTES = 1 << 25;
/** #649 (internal; tests make it smaller): the most real pixels of one band of a call's renders; their terms fill about 80 % of the store. */
export const displayViewDetailBand = { pixels: 3 << 15 };

/**
 * #649: a per-call store of `size` values per native site (x, y) (`DisplayViewPixelStore`): fixed tiles of 2^shift × 2^shift sites at
 * absolute positions, at most `budgetBytes` in all, the least recently used tile dropped first. Each record is followed by its flag (1 when
 * filled). It lives for one render call.
 */
export function createDisplayViewCallStore(shift: number, budgetBytes: number): DisplayViewPixelStore {
  const side = 1 << shift, area = side * side, tiles = new Map<number, Float64Array>();
  let size = 0, capacity = 0, key = -1, flag = 0;
  const store = { records: new Float64Array(0) as Float64Array, offset: 0,
    find(x: number, y: number, n: number): boolean {
      if (n !== size) { tiles.clear(); size = n; key = -1; capacity = Math.max(1, Math.floor(budgetBytes / (8 * area * (n + 1)))); }
      const k = (y >> shift) * 67108864 + (x >> shift);
      if (k !== key) {
        let t = tiles.get(k);
        if (t) tiles.delete(k);
        else if (tiles.size < capacity) t = new Float64Array(area * (n + 1));
        else { const [oldest, reused] = tiles.entries().next().value!; tiles.delete(oldest); t = reused.fill(0); }
        tiles.set(k, t); key = k; store.records = t;
      }
      store.offset = ((y & (side - 1)) * side + (x & (side - 1))) * (n + 1); flag = store.offset + n;
      return store.records[flag] === 1;
    },
    filled(): void { store.records[flag] = 1; } };
  return store;
}

/**
 * #649: `signal` with a per-call site store in front: each native site's expected electrons, the value `signal.site` returned when the site
 * was first read (and, where the window tracks it, its uniform material), keyed by the site's coordinates only. Every pass of the call reads
 * it; it holds no value for a material, a channel or a signal level. Everything else is the signal's own.
 */
export function createDisplayViewSiteStore(signal: DisplayViewExpectedSignal, budgetBytes = STORE_BYTES): DisplayViewExpectedSignal {
  const s = createDisplayViewCallStore(6, budgetBytes);
  let material = -1;
  return Object.create(signal, { uniformMaterial: { get: () => material }, site: { value(x: number, y: number): number {
    const tracked = signal.tracksMaterial, hit = s.find(x, y, 2), r = s.records, o = s.offset;
    // A site stored where materials were not tracked (−2) is read again in a window that tracks them.
    if (hit && (!tracked || r[o + 1] !== -2)) { material = tracked ? r[o + 1]! : -1; return r[o]!; }
    const v = signal.site(x, y);
    material = signal.uniformMaterial; r[o] = v; r[o + 1] = tracked ? material : -2; s.filled();
    return v;
  } } }) as DisplayViewExpectedSignal;
}

/**
 * Renders `rect` with each channel's lens map (`hooks`, green first): the first pass's result, and the composed expected values and the first
 * pass's covariances. Only the first pass draws its noise, and none with `means` (#649: the other passes' samples are not used).
 */
async function passes(setup: DisplayViewSetup, rect: Rect, hooks: readonly (DisplayViewCorrection | undefined)[], channels: readonly number[], render: typeof renderDisplayView, means: boolean):
  Promise<{ base: DisplayViewRenderResult; expected: Float64Array; covariance: Float64Array; sampleCount: number; siteCount: number }> {
  const n = rect.width * rect.height;
  let base: DisplayViewRenderResult | undefined, expected = new Float64Array(0), covariance = new Float64Array(0), sampleCount = 0, siteCount = 0;
  for (let i = 0; i < hooks.length; i++) {
    const own = new Float64Array(base ? 0 : 6 * n), hook = hooks[i], channel = channels[i]!;
    // One object shape for every render of the call (an absent field is undefined), so the renderer's compiled code serves them all.
    const result = await render({ ...setup, region: rect, covariance: base ? undefined : own, correction: hook, meansOnly: means || base !== undefined });
    sampleCount += result.sampleCount; siteCount += result.siteCount;
    if (!base) { base = result; expected = Float64Array.from(result.expected); covariance = own; continue; }
    // This pass's component's mean; the noise is the first pass's.
    for (let p = 0; p < n; p++) expected[3 * p + channel] = result.expected[3 * p + channel]!;
  }
  return { base: base!, expected, covariance, sampleCount, siteCount };
}
/** Copies `stride` values per pixel of `rect` (row-major) into `out`, the row-major values of `into`. */
function place(values: Float64Array, rect: Rect, out: Float64Array, into: Rect, stride: number): void {
  for (let y = 0; y < rect.height; y++) out.set(values.subarray(y * rect.width * stride, (y + 1) * rect.width * stride), ((rect.y - into.y + y) * into.width + rect.x - into.x) * stride);
}

/** The display view with lens corrections and sharpening (see the module comment). */
export async function renderDisplayViewDetail(setup: DisplayViewSetup, detail: DisplayViewDetail): Promise<DisplayViewRenderResult> {
  const { viewWidth: VW, viewHeight: VH, frameWidth: W, frameHeight: H, region } = setup, sx = W / VW, sy = H / VH, sh = detail.sharpening, lens = detail.lens;
  // One channel map and no mask: the corrected pass is the view.
  const { render, draw, overlaps, noiseGain: unsharpNoiseGain } = detail.view;
  if (!sh && lens && lens.channels.length === 1) return render({ ...setup, correction: lens.hook(lens.channels[0]!, VW, VH) });
  const g = sh ? unsharpMaskKernel(sh.radiusPixels) : undefined, r = g ? (g.length - 1) / 2 : 0;
  // #649: the passes share the call's site store and store of real pixels' terms, and run band by band of whole rows (regions equal the whole
  // view), so that a band's sites and real pixels are still held when its next pass reads them. With the mask, the view-size render runs for the
  // first channel map only: the mask replaces every component's mean, and the noise and counts are the first pass's.
  const shared: DisplayViewSetup = { ...setup, signal: createDisplayViewSiteStore(setup.signal), pixelStore: createDisplayViewCallStore(4, STORE_BYTES) };
  const channels = lens ? lens.channels : [-1], hooksAt = (w: number, h: number): (DisplayViewCorrection | undefined)[] => channels.map((c) => (c >= 0 ? lens!.hook(c, w, h) : undefined));
  const viewHooks = hooksAt(VW, VH).slice(0, sh ? 1 : channels.length), realHooks = sh ? hooksAt(W, H) : [];
  const N = region.width * region.height, expected = new Float64Array(3 * N), covariance = new Float64Array(6 * N), saturated = new Float64Array(N);
  // The real output pixels of the region and the mask's reach, rendered at 1:1.
  const x0 = Math.max(0, Math.floor(region.x * sx) - r), y0 = Math.max(0, Math.floor(region.y * sy) - r);
  const real = { x: x0, y: y0, width: Math.min(W, Math.ceil((region.x + region.width) * sx) + r) - x0, height: Math.min(H, Math.ceil((region.y + region.height) * sy) + r) - y0 };
  const one = new Float64Array(sh ? 3 * real.width * real.height : 0);
  let sampleCount = 0, siteCount = 0, detailPixelCount = 0, uniformPixelCount = 0, estimation: DisplayViewRenderResult["estimation"] = "exact-area-mean";
  // Bands of equal height (the last one shorter), each at most `displayViewDetailBand.pixels` real pixels where a row allows it.
  const count = Math.ceil(region.height / Math.max(1, Math.floor(displayViewDetailBand.pixels / (region.width * sx * sy)))), band = Math.ceil(region.height / count);
  for (let by = region.y; by < region.y + region.height; by += band) {
    const rect = { x: region.x, y: by, width: region.width, height: Math.min(band, region.y + region.height - by) };
    const view = await passes(shared, rect, viewHooks, channels, render, false);
    sampleCount += view.sampleCount; siteCount += view.siteCount; detailPixelCount += view.base.detailPixelCount; uniformPixelCount += view.base.uniformPixelCount; estimation = view.base.estimation;
    place(view.expected, rect, expected, region, 3); place(view.covariance, rect, covariance, region, 6); place(view.base.saturated, rect, saturated, region, 1);
    if (!sh) continue;
    // The band's real rows at 1:1: from its first display row's to the next band's; the outer bands reach the mask's reach.
    const uy0 = by === region.y ? real.y : Math.floor(by * sy), uy1 = by + band >= region.y + region.height ? real.y + real.height : Math.min(real.y + real.height, Math.floor((by + band) * sy));
    if (uy1 <= uy0) continue;
    const part = { x: real.x, y: uy0, width: real.width, height: uy1 - uy0 }, rendered = await passes({ ...shared, viewWidth: W, viewHeight: H }, part, realHooks, channels, render, true);
    sampleCount += rendered.sampleCount; siteCount += rendered.siteCount;
    place(rendered.expected, part, one, real, 3);
  }
  let saturatedPixelCount = 0;
  for (let p = 0; p < N; p++) saturatedPixelCount += saturated[p]!;
  let noiseGain = 1;
  if (sh) {
    noiseGain = unsharpNoiseGain(g!, sx, sy, sh.amount);
    // The capture's own mask on the 1:1 values, then the area mean in linear light.
    const sharpened = applyUnsharpMask(Float64Array.from(one, (v) => encodeSrgbComponentPortable(clip01(v))), real.width, real.height, sh).samples;
    for (let y = 0; y < region.height; y++) {
      const rows = overlaps((region.y + y) * sy, (region.y + y + 1) * sy, H);
      for (let x = 0; x < region.width; x++) {
        const cols = overlaps((region.x + x) * sx, (region.x + x + 1) * sx, W);
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let j = 0; j < rows.w.length; j++) for (let i = 0; i < cols.w.length; i++)
            sum += cols.w[i]! * rows.w[j]! * decode(sharpened[3 * ((rows.first + j - real.y) * real.width + cols.first + i - real.x) + c]!);
          expected[3 * (y * region.width + x) + c] = sum / (sx * sy);
        }
      }
    }
  }
  const maximum = setup.bitDepth === 8 ? 255 : 65535, samples = setup.bitDepth === 8 ? new Uint8Array(3 * N) : new Uint16Array(3 * N);
  const noiseStd = new Float64Array(3 * N);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const p = y * region.width + x, c = covariance.subarray(6 * p, 6 * p + 6).map((v) => v * noiseGain);
    draw(setup.seed, (region.y + y) * VW + region.x + x, expected[3 * p]!, expected[3 * p + 1]!, expected[3 * p + 2]!, c[0]!, c[1]!, c[2]!, c[3]!, c[4]!, c[5]!, samples, 3 * p, maximum);
    for (let k = 0; k < 3; k++) noiseStd[3 * p + k] = Math.sqrt(Math.max(0, c[[0, 3, 5][k]!]!));
  }
  // The first pass's counts and highlight statistics (of the region).
  return { samples, expected, noiseStd, sampleCount, siteCount, detailPixelCount, uniformPixelCount, estimation, saturated, saturatedPixelCount };
}

