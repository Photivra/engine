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
 */

import type { DisplayViewCorrection, DisplayViewRenderResult, DisplayViewSetup, drawDisplayPixel, overlaps, renderDisplayView, unsharpNoiseGain } from "./display-view.js";
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
/** Renders `rect` of a view with each channel's lens map: the green pass's result, and the composed expected values and covariances. */
async function passes(setup: DisplayViewSetup, rect: Rect, detail: DisplayViewDetail): Promise<{ base: DisplayViewRenderResult; expected: Float64Array; covariance: Float64Array; sampleCount: number; siteCount: number }> {
  const n = rect.width * rect.height, channels = detail.lens ? detail.lens.channels : [-1];
  let base: DisplayViewRenderResult | undefined, expected = new Float64Array(0), covariance = new Float64Array(0), sampleCount = 0, siteCount = 0;
  for (const channel of channels) {
    const own = new Float64Array(base ? 0 : 6 * n);
    const result = await detail.view.render({ ...setup, region: rect, ...(base ? {} : { covariance: own }),
      ...(channel >= 0 ? { correction: detail.lens!.hook(channel, setup.viewWidth, setup.viewHeight) } : {}) });
    sampleCount += result.sampleCount; siteCount += result.siteCount;
    if (!base) { base = result; expected = Float64Array.from(result.expected); covariance = own; continue; }
    // This pass's component's mean; the noise is the green pass's.
    for (let p = 0; p < n; p++) expected[3 * p + channel] = result.expected[3 * p + channel]!;
  }
  return { base: base!, expected, covariance, sampleCount, siteCount };
}

/** The display view with lens corrections and sharpening (see the module comment). */
export async function renderDisplayViewDetail(setup: DisplayViewSetup, detail: DisplayViewDetail): Promise<DisplayViewRenderResult> {
  const { viewWidth: VW, viewHeight: VH, frameWidth: W, frameHeight: H, region } = setup, sx = W / VW, sy = H / VH, sh = detail.sharpening;
  // One channel map and no mask: the corrected pass is the view.
  const { render, draw, overlaps, noiseGain: unsharpNoiseGain } = detail.view;
  if (!sh && detail.lens && detail.lens.channels.length === 1) return render({ ...setup, correction: detail.lens.hook(detail.lens.channels[0]!, VW, VH) });
  const g = sh ? unsharpMaskKernel(sh.radiusPixels) : undefined, r = g ? (g.length - 1) / 2 : 0;
  const rendered = await passes(setup, region, detail);
  let { sampleCount, siteCount } = rendered;
  const N = region.width * region.height, expected = rendered.expected, covariance = rendered.covariance;
  let noiseGain = 1;
  if (sh) {
    noiseGain = unsharpNoiseGain(g!, sx, sy, sh.amount);
    // The real output pixels of the region and the mask's reach, at 1:1, the capture's own mask, then the area mean in linear light.
    const x0 = Math.max(0, Math.floor(region.x * sx) - r), y0 = Math.max(0, Math.floor(region.y * sy) - r);
    const real = { x: x0, y: y0, width: Math.min(W, Math.ceil((region.x + region.width) * sx) + r) - x0, height: Math.min(H, Math.ceil((region.y + region.height) * sy) + r) - y0 };
    const one = await passes({ ...setup, viewWidth: W, viewHeight: H }, real, detail);
    sampleCount += one.sampleCount; siteCount += one.siteCount;
    const sharpened = applyUnsharpMask(Float64Array.from(one.expected, (v) => encodeSrgbComponentPortable(clip01(v))), real.width, real.height, sh).samples;
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
  // The green pass's counts and highlight statistics (of the region).
  return { ...rendered.base, samples, expected, noiseStd, sampleCount, siteCount };
}

