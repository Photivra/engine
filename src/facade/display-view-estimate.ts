// SPDX-License-Identifier: Apache-2.0

/**
 * 2.27.0 (#651): the counts of `PreparedDisplayView.estimateRender`, loaded on demand (the first estimate loads it; a render never does).
 */

import type { DisplayViewCorrection, DisplayViewExpectedSignal, DisplayViewSetup, overlaps } from "./display-view.js";
import type { DisplayViewCountRange, DisplayViewRenderEstimate } from "./simulate-display-view.js";

type Detail = { lens?: { hook(channel: number, viewWidth: number, viewHeight: number): DisplayViewCorrection; channels: readonly number[] }; sharpening?: { radiusPixels: number } };
/** What the prepared view knows of one render (simulate-display-view.ts): its setup and signal, and the methods its cost choices took. */
export interface DisplayViewEstimateFacts {
  setup: DisplayViewSetup; signal: DisplayViewExpectedSignal; detail: Detail | undefined;
  /** The renderer's own `overlaps` and exact-area-mean threshold (passed in so this module does not import the renderer). */
  overlaps: typeof overlaps; exactMaximum: number;
  method: DisplayViewRenderEstimate["signal"]["method"]; radius: number; disc: number | null; offsets: number; nodes: number; midpoints: number; bandRows: number | null;
  zoneSites: number | null; uniformWindows: boolean | null; chain: DisplayViewRenderEstimate["chainPointsPerAxis"];
}

/** {@link PreparedDisplayView.estimateRender}'s result from the facts of one render. */
export function estimateDisplayViewRender(f: DisplayViewEstimateFacts): DisplayViewRenderEstimate {
  const { setup: { region, frameWidth: W, frameHeight: H, viewWidth: VW, viewHeight: VH, nativeWidth, nativeHeight, reachSites } } = f;
  return Object.freeze({ ...estimateDisplayViewPasses(f.setup, f.signal, f.detail, f.overlaps, f.exactMaximum),
    nativeSites: Math.min(nativeWidth, Math.ceil(region.width * W / VW) + 2 * reachSites) * Math.min(nativeHeight, Math.ceil(region.height * H / VH) + 2 * reachSites),
    signal: Object.freeze({ method: f.method, kernelRadiusSites: f.radius, tapsPerSite: (2 * f.radius + 1) ** 2, discRadiusSites: f.disc, queryOffsets: f.offsets, spectralNodes: f.nodes,
      temporalMidpoints: f.midpoints, rollingBandRows: f.bandRows, lensPsfZoneSites: f.zoneSites, uniformWindows: f.uniformWindows }), chainPointsPerAxis: f.chain });
}

/** The real pixels a pass reads for display pixel (vx, vy) of a view, and the pilot's choice (see {@link estimateDisplayViewPasses}). */
type DisplayViewEstimateCounts = Omit<DisplayViewRenderEstimate, "nativeSites" | "signal" | "chainPointsPerAxis">;
/**
 * #651: counts the renderer's passes of one view without rendering (`renderDisplayView` and, with lens corrections or sharpening,
 * `renderDisplayViewDetail`), with the renderer's own rules: the exact area mean below EXACT_AREA_MEAN_MAX_PIXELS and K² real pixels per
 * display pixel (every real pixel of the footprint once), else K² or the uniform count of seeded samples where the pilot (the scene at a fixed
 * grid over the footprint and its reach, a pixel next to a detailed one counting as detailed) finds detail or not. A real pixel reads its
 * phase's demosaic sites (the bilinear kernels and AHD's candidates). With sharpening the view-size pass runs for the first channel map and
 * the 1:1 passes cover the region's real pixels and the mask's reach. The bands of the detail passes split the same pixels, so they do not
 * change a count.
 */
function estimateDisplayViewPasses(setup: DisplayViewSetup, signal: DisplayViewExpectedSignal, detail: Detail | undefined, overlaps: DisplayViewEstimateFacts["overlaps"], exactMaximum: number): DisplayViewEstimateCounts {
  const { frameWidth: W, frameHeight: H, margin, nativeWidth, nativeHeight, viewWidth: VW, viewHeight: VH, region, samplesPerAxis: fullK, reachSites } = setup;
  const uniformK = setup.uniformSamplesPerAxis ?? Math.max(1, Math.round(fullK / 4));
  // Sites per real pixel of each CFA phase: the union of the demosaic kernels' and the candidates' taps (the renderer's phase lists).
  const candidates = setup.candidates ?? setup.demosaic.map((phase) => [phase]);
  const phaseSites = [0, 1, 2, 3].map((p) => new Set([...setup.demosaic[p]!.flat(), ...candidates[p]!.flat(2)].map((t) => t.dx + "," + t.dy)).size);
  const fewest = Math.min(...phaseSites), most = Math.max(...phaseSites);
  const range = (a: DisplayViewCountRange, minimum: number, maximum: number): void => { a.minimum += minimum; a.maximum += maximum; };
  const samples = { minimum: 0, maximum: 0 }, sites = { minimum: 0, maximum: 0 }, source = new Float64Array(13), fp = new Float64Array(4), pf = new Float64Array(4);
  const g = 2 / W;
  let detailPixels = 0, uniformPixels = 0, exactEstimation = true;
  /** One pass over `rect` of a view of vw × vh, through `corr`; `first` counts its pixels' pilot choices. */
  const pass = (vw: number, vh: number, rect: { x: number; y: number; width: number; height: number }, corr: DisplayViewCorrection | undefined, first: boolean): void => {
    const sx = W / vw, sy = H / vh, exactView = sx * sy <= Math.min(exactMaximum, fullK * fullK), bilinear = corr?.sources !== undefined;
    if (first) exactEstimation = exactView;
    const footprintOf = (vx: number, vy: number, out: Float64Array): void => {
      if (corr) corr.footprint(vx, vy, out); else { out[0] = vx * sx; out[1] = (vx + 1) * sx; out[2] = vy * sy; out[3] = (vy + 1) * sy; }
    };
    const extra = reachSites + (bilinear ? 2 : 0);
    const uniform = (vx: number, vy: number): boolean => {
      if (vx < 0 || vy < 0 || vx >= vw || vy >= vh) return true;
      footprintOf(vx, vy, pf);
      const ax0 = pf[0]! + margin - extra, ax1 = pf[1]! + margin + extra, ay0 = pf[2]! + margin - extra, ay1 = pf[3]! + margin + extra;
      const px = Math.max(4, Math.min(16, Math.ceil((ax1 - ax0) / 2))), py = Math.max(4, Math.min(16, Math.ceil((ay1 - ay0) / 2)));
      let value = NaN;
      for (let j = 0; j < py; j++) {
        const v = -(ay0 + (j + 0.5) * (ay1 - ay0) / py - nativeHeight / 2) * g;
        for (let i = 0; i < px; i++) {
          const here = signal.pilot((ax0 + (i + 0.5) * (ax1 - ax0) / px - nativeWidth / 2) * g, v);
          if (i === 0 && j === 0) value = here; else if (here !== value) return false;
        }
      }
      return true;
    };
    const flags = new Map<number, boolean>(), flag = (vx: number, vy: number): boolean => {
      const key = vy * (vw + 2) + vx + 1;
      let f = flags.get(key);
      if (f === undefined) { f = uniform(vx, vy); flags.set(key, f); }
      return f;
    };
    /** Sites of the real pixel (x, y) (frame coordinates). */
    const sitesOf = (x: number, y: number): number => phaseSites[((y + margin) & 1) * 2 + ((x + margin) & 1)]!;
    for (let vy = rect.y; vy < rect.y + rect.height; vy++) for (let vx = rect.x; vx < rect.x + rect.width; vx++) {
      footprintOf(vx, vy, fp);
      if (exactView) {
        if (first) detailPixels++;
        // The exact correction samples the display pixel's own output pixels (then their sources); the fast one its developed footprint.
        const cols = bilinear ? overlaps(vx * sx, (vx + 1) * sx, W) : overlaps(fp[0]!, fp[1]!, W), rows = bilinear ? overlaps(vy * sy, (vy + 1) * sy, H) : overlaps(fp[2]!, fp[3]!, H);
        let n = 0, s = 0;
        for (let j = 0; j < rows.w.length; j++) for (let i = 0; i < cols.w.length; i++) {
          const x = cols.first + i, y = rows.first + j;
          if (bilinear) { const m = corr!.sources!(x, y, source); for (let e = 0; e < m; e++) { n++; s += sitesOf(source[3 * e]!, source[3 * e + 1]!); } }
          else { n++; s += sitesOf(x, y); }
        }
        range(samples, n, n); range(sites, s, s);
        continue;
      }
      let same = true;
      for (let dy = -1; dy <= 1 && same; dy++) for (let dx = -1; dx <= 1; dx++) if (!flag(vx + dx, vy + dy)) { same = false; break; }
      if (first) { if (same) uniformPixels++; else detailPixels++; }
      const Q = (same ? uniformK : fullK) ** 2;
      // Through the exact correction each sample becomes its output pixel's 1–4 developed sources.
      range(samples, Q, bilinear ? 4 * Q : Q); range(sites, Q * fewest, (bilinear ? 4 * Q : Q) * most);
    }
  };
  const lens = detail?.lens, sharpening = detail?.sharpening;
  let viewPasses = 1, realPasses = 0;
  if (!detail) pass(VW, VH, region, setup.correction, true);
  else if (!sharpening && lens && lens.channels.length === 1) pass(VW, VH, region, lens.hook(lens.channels[0]!, VW, VH), true);
  else {
    const channels = lens ? lens.channels : [-1], hookAt = (c: number, w: number, h: number): DisplayViewCorrection | undefined => (c >= 0 ? lens!.hook(c, w, h) : undefined);
    const viewChannels = sharpening ? channels.slice(0, 1) : channels;
    viewChannels.forEach((c, i) => pass(VW, VH, region, hookAt(c, VW, VH), i === 0));
    viewPasses = viewChannels.length;
    if (sharpening) {
      // The 1:1 render of the region's real pixels and the mask's reach (renderDisplayViewDetail's `real`).
      const sx = W / VW, sy = H / VH, r = Math.ceil(3 * sharpening.radiusPixels); // unsharpMaskKernel's reach
      const x0 = Math.max(0, Math.floor(region.x * sx) - r), y0 = Math.max(0, Math.floor(region.y * sy) - r);
      const real = { x: x0, y: y0, width: Math.min(W, Math.ceil((region.x + region.width) * sx) + r) - x0, height: Math.min(H, Math.ceil((region.y + region.height) * sy) + r) - y0 };
      for (const c of channels) pass(W, H, real, hookAt(c, W, H), false);
      realPasses = channels.length;
    }
  }
  return { displayPixels: region.width * region.height, estimation: exactEstimation ? "exact-area-mean-over-real-pixels" : "stratified-monte-carlo-over-real-pixels",
    realPixelsPerDisplayPixel: (W / VW) * (H / VH), passes: Object.freeze({ view: viewPasses, realPixels: realPasses }), sampleCount: Object.freeze(samples), siteEvaluations: Object.freeze(sites),
    detailPixelCount: detailPixels, uniformPixelCount: uniformPixels };
}
