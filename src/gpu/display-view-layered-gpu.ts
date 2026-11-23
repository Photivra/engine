// SPDX-License-Identifier: Apache-2.0

/**
 * Host side of the layered chart scene's display view on the GPU (#750, 2.29.0 group LGPU): passes 1 and 2 of the Quality path for a
 * layered scene (`wgsl-display-view-layered-kernel.ts`), handed to the Quality host (`display-view-quality-gpu.ts`, its passes input
 * `lens`), which runs pass 3, the float64 finishing and the recomputation of flagged display pixels; this module recomputes them with
 * the view's own layered signal. Its own on-demand chunk: only the layered-scene code loads it (the wiring's loader, behind
 * `prepareLayeredChartScenes()`), and only the display-view GPU session calls it (`DisplayViewGpuRequest.layeredGpu`). Nothing else
 * imports it, so a build without it renders every layered view on the CPU, as 2.28.0 did.
 *
 * The float64 reference is the layered sum of `facade/layered-scene-signal.ts` (`createLayeredSceneSignal`) through
 * `renderDisplayView`. Per lattice point p of each lattice group the spectral radiance S(p)[n] = Σ_k Σ_t D_k(t)·V_k(p, t)·L_k(p − t)[n]
 * (`layered-edge-sum.ts`), and per native site of channel c the site electrons Σ_g Σ_d Σ_n C_{n,c}(d)·S_g(x + d)[n] + dark_c (the
 * reference's combined kernels per node; a site that sees one surface delegates to that surface's single-plane signal, the same sum
 * with the surface's kernel convolved into C). The GPU forms the same terms:
 *
 * - **On the host (float64, the reference's own functions).** Each lattice point's surface (`geometry.surfaceOf`). For a point at a
 *   card edge, surface by surface in the reference's order (skipped when its card is outside the point's reach, last when the card
 *   holds all of it), and kernel row by kernel row, the taps whose pupil regions certainly reach the surface (runs with factor 1),
 *   certainly miss it (left out), or may reach part of it, whose V is the reference's own `visibility.share` with the reference's
 *   own arguments. One surface's spans at a point form a list, shared by every point where it is provably the same: away from
 *   every card edge of one axis, `share` reads the point's coordinate on that axis only through relations that are then certain,
 *   so along a card's edge one list serves the whole edge (`listKey`). A tap is "certain" only when every card's relation to its region's ray box (`layeredBoxRelation`, as `share`
 *   decides it) holds with a margin far above float64 rounding (`DISPLAY_VIEW_LAYERED_MARGIN`), so the factor of every tap is the
 *   value `share` returns for it: 1 and 0 exactly where it decides, V elsewhere. The reference's run sum (#749) takes the same V per
 *   tap (its runs are taps whose V is 1); only its order of summation differs. Each surface's radiance at the lattice points comes
 *   from the lattice's own tiles (`lattice.tiles.surfaces`), the reference's values rounded once to float32.
 * - **On the GPU.** The sums over the taps (pass 1) and over the sites' combined kernels and nodes (pass 2), in float32, with the
 *   a-priori bound of the WGSL module's comment. No lattice point is flagged (no material is decided on the GPU); a display pixel the
 *   Quality pixel pass flags (an AHD choice, a highlight left undecided, a non-finite value) is recomputed on the host with the view's
 *   layered signal, so it is the reference's.
 *
 * What it covers (the first envelope of #750): the planar map (a still camera, a rectilinear lens without distortion or vignetting:
 * `geometry.planar`), one illuminant, chart-material surfaces, disc and shaped kernels without a cat's eye up to
 * `DISPLAY_VIEW_LAYERED_MAXIMUM_KERNEL_RADIUS` sites, each surface's one kernel group over all nodes (the default
 * `layeredKernelGroups`), and the Quality path's own limits (tone curves, footprints, demosaic, at most 64 lattice groups, 96
 * spectral nodes). Everything else runs the CPU reference, labelled `unsupported-on-backend` with the reason.
 */

import type { DisplayViewRenderResult, DisplayViewSetup } from "../facade/display-view.js";
import { renderDisplayView } from "../facade/display-view.js";
import type { DisplayViewGpuConformanceCase, DisplayViewGpuPart, DisplayViewGpuRenderOutput, DisplayViewGpuRenderer, DisplayViewGpuRequest,
  DisplayViewGpuRuntimeHandle } from "../facade/display-view-gpu.js";
import { displayViewSignalTables, type DisplayViewExpectedSignalInput, type DisplayViewScene } from "../facade/expected-signal.js";
import { LAYERED_LATTICE_GROUP_LIMIT, layeredBoxRelation, type LayeredCardEdges } from "../facade/layered-lattice-geometry.js";
import { createLayeredSceneLattice, createLayeredSceneSignal, type LayeredSceneLattice, type LayeredSceneLayer } from "../facade/layered-scene-signal.js";
import { createDefocusDiscSiteKernel } from "../optics/defocus-disc-kernel.js";
import { DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES, renderDisplayViewQualityOnGpu, type DisplayViewQualityGpuResult, type DisplayViewQualityLensPasses } from "./display-view-quality-gpu.js";
import { CONFORMANCE_FRAME, conformanceChannelAt, conformanceChart, conformanceResponses, conformanceSetup, conformanceVerdict, sceneToneAndOffsetsReason, withConformanceAbort } from "./display-view-speed-gpu.js";
import { ImageKernelExecutionError, WEBGPU_F32_UNIT_ROUNDOFF } from "./image-kernel-execution.js";
import { BUFFER_USAGE, GpuResourceScope, abortedError, createComputePipeline, linearDispatch, runComputePass, throwIfAborted, type WebGpuRuntime } from "./webgpu-runtime.js";
import { DISPLAY_VIEW_QUALITY_COMMON_WGSL, DISPLAY_VIEW_QUALITY_GROUP_WORDS, DISPLAY_VIEW_QUALITY_MAXIMUM_NODES, DISPLAY_VIEW_QUALITY_SITE_TAIL_WGSL,
  DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE } from "./wgsl-display-view-quality-kernel.js";
import { DISPLAY_VIEW_LAYERED_POINT_WORDS, DISPLAY_VIEW_LAYERED_SINGLE, DISPLAY_VIEW_LAYERED_SITE_PARAM_WORDS, DISPLAY_VIEW_LAYERED_SPAN_WORDS, DISPLAY_VIEW_LAYERED_SUM_PARAM_WORDS,
  displayViewLayeredSitesWgsl, displayViewLayeredSumWgsl } from "./wgsl-display-view-layered-kernel.js";

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;
type YieldControl = ((signal: AbortSignal) => Promise<void>) | undefined;

/**
 * What the wiring puts in `setup.gpu.layered` for a layered view on the GPU: the layer list of the view's lattice (its rectangles,
 * blur radii, scenes and kernels). The lattice itself is the view's own expected signal's (`setup.signal.lattice`), so the sums and
 * the host's recomputed pixels read one lattice.
 */
export interface DisplayViewLayeredGpuInput { layers: readonly LayeredSceneLayer[] }

/** One WGSL rounding of + − × in either direction (E = 2⁻²³). */
const E = 2 * WEBGPU_F32_UNIT_ROUNDOFF;
/** The smallest positive normal float32 (WGSL allows a device to flush values below it), and the largest value the sums take. */
const FLOAT32_MINIMUM_NORMAL = 2 ** -126, FLOAT32_SAFE_MAGNITUDE = 2 ** 120;
/** Largest defocus kernel radius the GPU sum takes: the Quality kernels' cap (the largest site kernel they gather). */
export const DISPLAY_VIEW_LAYERED_MAXIMUM_KERNEL_RADIUS = 96;
/** Most surfaces (a span's surface index is 16 bits; the reference's scenes have a few). */
const MAXIMUM_SURFACES = 256;
/**
 * The host's margin on a card relation, relative to the magnitudes it compares (sites): a tap is classified only when its ray box
 * clears every card edge by this much, far above the float64 rounding of the reference's own comparison (a few 2⁻⁵³ relative).
 */
export const DISPLAY_VIEW_LAYERED_MARGIN = 2 ** -36;
/** Span words held for one sum dispatch at most (4 MiB of spans), and the bytes the Quality host counts for them in a band. */
const SPAN_CHUNK_WORDS = 1 << 20;
/** The tap cache's key range (`tapV`): surfaces nearest first up to this many, lattice coordinates within ±this. */
const TAP_CACHE_SURFACES = 12, TAP_CACHE_COORDINATE = 32768;
/** Span words the host keeps for the lists of one render before it starts a new store (64 MiB). */
const STORE_CAP_WORDS = 1 << 24;
const UNIT = /* @__PURE__ */ Float64Array.of(1);

/** The layered input of a setup, or undefined. */
const layeredOf = (setup: DisplayViewSetup): DisplayViewLayeredGpuInput | undefined => (setup.gpu as { layered?: DisplayViewLayeredGpuInput } | undefined)?.layered;
/** The lattice of the setup's own layered signal, or undefined. */
const latticeOf = (setup: DisplayViewSetup): LayeredSceneLattice | undefined => (setup.signal as { lattice?: LayeredSceneLattice }).lattice;

/**
 * Why the layered passes do not take a prepared request, or true: a layered view on the planar map (no lens signal: a projection,
 * distortion, vignetting, catalogue lens or camera rotation keeps the CPU), one illuminant, and the Quality path's tone curves and
 * at most 64 query offsets. The facts of the setup (the map, the kernels, the node count) are checked per render.
 */
export function displayViewLayeredGpuSupports(request: DisplayViewGpuRequest): true | string {
  if (!request.layered) return "not a layered chart scene";
  if (request.lens) return "a layered scene through a lens map (lens.projection, lens.distortion, lens.vignetting, lens.catalogue or camera rotation) runs on the CPU";
  if (request.mixedIllumination) return "a layered scene under mixed illumination runs on the CPU";
  if (request.detail) return "lens corrections and sharpening run on the CPU (#628)";
  if (request.largeDefocus) return "a defocus kernel convolved by runs runs on the CPU";
  // The surfaces are chart materials (the layered scene's cards and back plane).
  return sceneToneAndOffsetsReason({ ...request, scene: "chart" }, 64);
}

/** Why the layered passes do not cover a setup, or null (the facts a render can check; see the module comment). */
export function displayViewLayeredGpuUnsupportedReason(setup: DisplayViewSetup): string | null {
  const input = layeredOf(setup), lattice = latticeOf(setup), signalInput = setup.gpu?.signalInput;
  if (!input || !lattice || !signalInput) return "the setup carries no layered GPU input";
  const geometry = lattice.parts.geometry, K = geometry.surfaces, N = signalInput.wavelengthsNm.length;
  if (!geometry.planar) return "a layered scene through a lens map runs on the CPU";
  if (input.layers.length !== K || K > MAXIMUM_SURFACES) return "the layer list does not match the lattice";
  if (lattice.nodes !== N || N < 1 || N > DISPLAY_VIEW_QUALITY_MAXIMUM_NODES) return "the layered passes integrate 1 to " + DISPLAY_VIEW_QUALITY_MAXIMUM_NODES + " spectral nodes per site";
  for (const layer of input.layers) {
    if (layer.zones) return "the cat's eye (field zones per surface) runs on the CPU";
    const kernel = layer.kernel;
    if (kernel && (kernel.radius > DISPLAY_VIEW_LAYERED_MAXIMUM_KERNEL_RADIUS || kernel.weights.some((w) => !(w >= 0 && w <= FLOAT32_SAFE_MAGNITUDE))))
      return "a defocus kernel above " + DISPLAY_VIEW_LAYERED_MAXIMUM_KERNEL_RADIUS + " sites (or with weights outside the float32 domain) runs on the CPU";
  }
  if (!input.layers.some((l) => l.scene.kind === "materials")) return "radiance surfaces run on the CPU";
  return null;
}

/** The expected-signal input the Quality host reads for a layered view: the view's offsets, responses and diffraction kernels (unit taps without). */
function qualityInput(setup: DisplayViewSetup, layers: readonly LayeredSceneLayer[]): DisplayViewExpectedSignalInput {
  const s = setup.gpu!.signalInput, N = s.wavelengthsNm.length;
  return { nativeWidth: s.nativeWidth, nativeHeight: s.nativeHeight, outputWidth: s.outputWidth, wavelengthsNm: s.wavelengthsNm, electronsPerRadiance: s.electronsPerRadiance,
    offsets: s.offsets, channelAt: s.channelAt, kernels: s.kernels ?? { radius: 0, perNode: Array.from({ length: N }, () => UNIT) },
    scene: layers.find((l) => l.scene.kind === "materials")!.scene as Extract<DisplayViewScene, { kind: "materials" }> };
}

/** Grows a Uint32Array to at least `size` words (doubling). */
function grow(a: Uint32Array<ArrayBuffer>, size: number): Uint32Array<ArrayBuffer> {
  if (size <= a.length) return a;
  const b = new Uint32Array(Math.max(size, 2 * a.length));
  b.set(a);
  return b;
}

/** The passes of one render (see `DisplayViewQualityLensPasses`). */
export function createDisplayViewLayeredPasses(runtime: WebGpuRuntime, setup: DisplayViewSetup, quality: DisplayViewExpectedSignalInput, pipelines: PipelineSource):
  DisplayViewQualityLensPasses & { stats: { edgePoints: number; spans: number; lists: number; shares: number; sumDispatches: number; hostMilliseconds: number };
    spansAt(group: number, p: number, q: number): { k: number; tv: number; u0: number; u1: number; f: number }[] } {
  const lattice = latticeOf(setup)!, layers = layeredOf(setup)!.layers, geometry = lattice.parts.geometry, visibility = lattice.parts.visibility, tiles = lattice.tiles.surfaces;
  const K = geometry.surfaces, rho = geometry.blurRadiusSites, reach = geometry.reachSites, N = quality.wavelengthsNm.length, TILE = tiles.tile;
  const tables = displayViewSignalTables(quality), G = tables.groups.length, layeredGroup = tables.groups.map((g) => lattice.groupOf(g.fx, g.fy));
  const Rd = quality.kernels!.radius;
  // Kernels: per surface its weights (a unit tap in focus), rounded once; per kernel row its first and last non-zero tap.
  const radius = layers.map((l) => (l.kernel ? l.kernel.radius : 0)), kernelOffset: number[] = [];
  let kernelWords = 0;
  for (const R of radius) { kernelOffset.push(kernelWords); kernelWords += (2 * R + 1) ** 2; }
  const kernelTable = new Float32Array(kernelWords), rowLo: Int32Array[] = [], rowHi: Int32Array[] = [], weightSum: number[] = [];
  layers.forEach((l, k) => {
    const R = radius[k]!, w = l.kernel ? l.kernel.weights : UNIT, side = 2 * R + 1, lo = new Int32Array(side), hi = new Int32Array(side);
    let sum = 0;
    for (let v = 0; v < side; v++) {
      lo[v] = 1; hi[v] = 0;
      for (let u = 0; u < side; u++) { const x = w[v * side + u]!; sum += x; if (x !== 0) { if (lo[v]! > hi[v]!) lo[v] = u - R; hi[v] = u - R; } }
    }
    kernelTable.set(w, kernelOffset[k]!); rowLo.push(lo); rowHi.push(hi); weightSum.push(sum);
  });
  const Rmax = Math.max(0, ...radius);
  // The combined kernel table C_{n,c}(t) at (n·3 + c)·T + t (the reference's per-node kernels, rounded once), with the groups' rectangles.
  let T = 0, cwMax = 0, chMax = 0, refTaps = 0;
  const firstTap = tables.groups.map((g) => { const t = T; T += g.cw * g.ch; cwMax = Math.max(cwMax, g.cw); chMax = Math.max(chMax, g.ch); refTaps += (g.cw + 2 * Rmax) * (g.ch + 2 * Rmax); return t; });
  const table = new Float32Array(N * 3 * T);
  let tinyC = 0, cMass = 0;
  tables.groups.forEach((g, gi) => {
    for (let c = 0; c < 3; c++) {
      const nk = g.nodeKernels[c]!;
      let mass = 0;
      for (let t = 0; t < g.cw * g.ch; t++) for (let n = 0; n < N; n++) {
        const value = nk[t * N + n]!;
        if (!(value >= 0 && value <= FLOAT32_SAFE_MAGNITUDE)) throw new ImageKernelExecutionError("unsupported-on-backend", "A combined kernel value of the layered view is outside the float32 domain.");
        table[(n * 3 + c) * T + firstTap[gi]! + t] = value;
        mass += value;
        if (value > 0 && value < FLOAT32_MINIMUM_NORMAL) tinyC += value;
      }
      cMass = Math.max(cMass, mass);
    }
  });
  // A sum term passes at most 2R additions in its row, 2R in its surface and K − 1 over the surfaces; a site term at most N + cw + ch + G − 3
  // more and the dark electrons (see the WGSL module). The reference's own float64 sums (its run sum, its delegated combined kernels)
  // carry at most a few hundred thousand roundings of 2⁻⁵³ each: `reference`, far below the float32 terms.
  const reference = (K * (2 * Rmax + 1) ** 2 + refTaps + (2 * Rd + 1) ** 2 + N + 64) * 2 ** -52;
  const siteGamma = (4 * Rmax + K + N + cwMax + chMax + G + 4) * E + reference;
  // Per S value: the radiance values a device may flush (each below 2⁻¹²⁶, Σ w·f ≤ the kernel's sum per surface) and the products and partials.
  const sumTerms = K * (2 * Rmax + 1) ** 2, sTiny = (K * Math.max(1, ...weightSum) + 2 * sumTerms + 2) * FLOAT32_MINIMUM_NORMAL;
  const sumLabel = "photivra-display-view-layered-sum", sitesLabel = "photivra-display-view-layered-sites";
  /** Counts (`lists`: the surface lists built), and the host's own time (the points' surfaces, the radiance windows and the edge points' spans; uploads and dispatches apart). */
  const stats = { edgePoints: 0, spans: 0, lists: 0, shares: 0, sumDispatches: 0, hostMilliseconds: 0 };

  // ---------------------------------------------------------------------------------------------------------------
  // Surface lists (see the module comment): an edge point's spans for one surface, in kernel-row order. A list is kept in `store`
  // (span words) with its factors in float64 (`storeFactors`, for the tests) and shared by every point whose list is provably the same
  // (`listKey`).
  let store = new Uint32Array(1 << 14), storeFactors = new Float64Array(1 << 12), storeSpans = 0;
  const lists: { first: number; count: number; taps: number }[] = [], cache = new Map<string, number>(), tapCache: (Map<number, number> | undefined)[] = [];
  // Kept rows (see `rowSpans`): per row its first span and count in `rowStore` (u0, u1 per span) and `rowFactors`.
  const rowCache: (Map<number, number> | undefined)[] = [], rowFirst: number[] = [], rowCount: number[] = [];
  let rowStore = new Uint32Array(1 << 12), rowFactors = new Float64Array(1 << 11), rowSpanCount = 0;
  let listFirst = 0;
  /** Appends a span (surface k, kernel row tv, taps u0 … u1, factor f) to the list being built, merging an open span into the one before it. */
  function push(k: number, tv: number, u0: number, u1: number, f: number): void {
    const key = k * 65536 + tv + radius[k]!;
    if (f === 1 && storeSpans > listFirst) {
      const o = (storeSpans - 1) * DISPLAY_VIEW_LAYERED_SPAN_WORDS;
      if (store[o] === key && storeFactors[storeSpans - 1] === 1 && (store[o + 2]! | 0) === u0 - 1) { store[o + 2] = u1 >>> 0; return; }
    }
    store = grow(store, (storeSpans + 1) * DISPLAY_VIEW_LAYERED_SPAN_WORDS);
    if (storeFactors.length <= storeSpans) { const b = new Float64Array(2 * storeSpans); b.set(storeFactors); storeFactors = b; }
    const o = storeSpans * DISPLAY_VIEW_LAYERED_SPAN_WORDS;
    store[o] = key; store[o + 1] = u0 >>> 0; store[o + 2] = u1 >>> 0; storeFactors[storeSpans] = f;
    storeSpans++;
  }
  // Per card j ≤ k of one kernel row: its Y relation (1 inside, 0 outside, 2 maybe) and the taps whose X range is inside it
  // [inLo, inHi] and outside it (tu < outBelow or tu ≥ outAbove), all with the margin.
  const yRel = new Int8Array(MAXIMUM_SURFACES), inLo = new Float64Array(MAXIMUM_SURFACES), inHi = new Float64Array(MAXIMUM_SURFACES),
    outBelow = new Float64Array(MAXIMUM_SURFACES), outAbove = new Float64Array(MAXIMUM_SURFACES), breaks: number[] = [];
  /** The class of tap tu on card j: 1 its region's ray box is inside the card, 0 outside, 2 maybe (as `share`'s box relation decides it). */
  const cardClass = (j: number, tu: number): number => {
    const x = tu >= inLo[j]! && tu <= inHi[j]! ? 1 : tu < outBelow[j]! || tu >= outAbove[j]! ? 0 : 2, y = yRel[j]!;
    return y === 0 || x === 0 ? 0 : y === 1 && x === 1 ? 1 : 2;
  };
  /** The tap's factor class for surface k: 0 every ray misses it, 1 every ray reaches it, 2 `share` decides. */
  function tapClass(rects: readonly (LayeredCardEdges | null)[], k: number, tu: number): number {
    const own = rects[k] === null ? 1 : cardClass(k, tu);
    if (own === 0) return 0;
    let nearer = 0;
    for (let j = 0; j < k; j++) { const c = cardClass(j, tu); if (c === 1) return 0; if (c === 2) nearer = 2; }
    return own === 1 && nearer === 0 ? 1 : 2;
  }
  /**
   * The margin of card j's relations for surface k in group coordinates (sites): far above the float64 rounding of `share`'s own
   * comparisons, whose operands are the card's edges, the point and the ray offsets |r|·(R + ½) (r = ρ_j/ρ_k).
   */
  const marginOf = (rect: LayeredCardEdges, r: number, R: number): number =>
    DISPLAY_VIEW_LAYERED_MARGIN * (Math.abs(rect[0]!) + Math.abs(rect[1]!) + Math.abs(rect[2]!) + Math.abs(rect[3]!) + 2 * (quality.nativeWidth + quality.nativeHeight) + 4 * Rmax + Math.abs(r) * (R + 1) + 1);
  /** The spans of kernel row tv of surface k at edge point (p, q) of layered group lg (a kernel with s ≠ 0). */
  function rowSpans(lg: number, rects: readonly (LayeredCardEdges | null)[], k: number, p: number, q: number, tv: number, s: number, weights: Float64Array): void {
    const R = radius[k]!, row = tv + R, lo = rowLo[k]![row]!, hi = rowHi[k]![row]!;
    if (lo > hi) return;
    // The Y relations (the row's), then with every one certain the row's key: its spans are then a function of p and those relations
    // (as for a tap, `tapV`), kept per row.
    for (let j = 0; j <= k; j++) {
      const rect = rects[j];
      if (!rect) continue;
      // The ray box of tap (tu, tv) on card j: centre (p − r·tu, q − r·tv), half-width |r|/2, r = ρ_j/ρ_k (share's x − ρ_j·a over the tap's cell a ∈ (tu ∓ ½)/ρ_k).
      const r = rho[j]! / s, h = Math.abs(r) / 2, Y0 = rect[1]!, Y1 = rect[3]!, delta = marginOf(rect, r, R), yc = q - r * tv;
      yRel[j] = yc - h >= Y0 + delta && yc + h <= Y1 - delta ? 1 : yc + h < Y0 - delta || yc - h > Y1 + delta ? 0 : 2;
    }
    let yBits = 0, yCertain = k < TAP_CACHE_SURFACES && Math.abs(p) < TAP_CACHE_COORDINATE && Math.abs(q) < TAP_CACHE_COORDINATE;
    for (let j = 0; j <= k && yCertain; j++) if (rects[j]) { if (yRel[j] === 2) yCertain = false; else yBits = 2 * yBits + yRel[j]!; }
    const side = 2 * R + 1, rowKey = yCertain ? ((row * 65536 + p + TAP_CACHE_COORDINATE) * 2 ** (k + 1) + yBits) : -1;
    const rows = rowKey < 0 ? undefined : (rowCache[lg * K + k] ??= new Map<number, number>()), kept = rows?.get(rowKey);
    if (kept !== undefined) {
      for (let i = rowFirst[kept]!, end = i + rowCount[kept]!; i < end; i++) push(k, tv, rowStore[2 * i]! | 0, rowStore[2 * i + 1]! | 0, rowFactors[i]!);
      return;
    }
    const start = storeSpans;
    breaks.length = 0;
    breaks.push(lo, hi + 1);
    const clamp = (v: number): number => (v < -R - 2 ? -R - 2 : v > R + 2 ? R + 2 : v);
    for (let j = 0; j <= k; j++) {
      const rect = rects[j];
      if (!rect) continue;
      const r = rho[j]! / s, h = Math.abs(r) / 2, X0 = rect[0]!, X1 = rect[2]!, delta = marginOf(rect, r, R);
      // X inside: B ≤ r·tu ≤ A; outside: r·tu > C or r·tu < D.
      const A = p - h - X0 - delta, B = p + h - X1 + delta, C = p + h - X0 + delta, D = p - h - X1 - delta;
      if (r > 0) { inLo[j] = clamp(Math.ceil(B / r)); inHi[j] = clamp(Math.floor(A / r)); outAbove[j] = clamp(Math.floor(C / r) + 1); outBelow[j] = clamp(Math.ceil(D / r)); }
      else if (r < 0) { inLo[j] = clamp(Math.ceil(A / r)); inHi[j] = clamp(Math.floor(B / r)); outBelow[j] = clamp(Math.ceil(C / r)); outAbove[j] = clamp(Math.floor(D / r) + 1); }
      else {
        const inside = B <= 0 && 0 <= A, outside = 0 > C || 0 < D;
        inLo[j] = inside ? -R - 2 : R + 2; inHi[j] = inside ? R + 2 : -R - 2; outBelow[j] = outside ? R + 3 : -R - 3; outAbove[j] = outside ? -R - 3 : R + 3;
      }
      for (const b of [inLo[j]!, inHi[j]! + 1, outBelow[j]!, outAbove[j]!]) if (b > lo && b <= hi) breaks.push(b);
    }
    breaks.sort((a, b) => a - b);
    for (let i = 0; i + 1 < breaks.length; i++) {
      const first = breaks[i]!, last = breaks[i + 1]! - 1;
      if (last < first) continue;
      const c = tapClass(rects, k, first);
      if (c === 0) continue;
      if (c === 1) { push(k, tv, first, last, 1); continue; }
      for (let tu = first; tu <= last; tu++) {
        if (weights[row * side + tu + R] === 0) continue;
        const V = tapV(lg, rects, k, p, q, tv, tu, s, side, yCertain ? yBits : -1);
        if (V > 0) push(k, tv, tu, tu, V);
      }
    }
    if (rows) {
      // Keep the row's spans (the list's spans from `start`; none merged into the row before it, whose key differs).
      const count = storeSpans - start, at = rowSpanCount;
      rowStore = grow(rowStore, 2 * (at + count));
      if (rowFactors.length < at + count) { const b = new Float64Array(2 * (at + count)); b.set(rowFactors); rowFactors = b; }
      for (let i = 0; i < count; i++) {
        const o = (start + i) * DISPLAY_VIEW_LAYERED_SPAN_WORDS;
        rowStore[2 * (at + i)] = store[o + 1]!; rowStore[2 * (at + i) + 1] = store[o + 2]!; rowFactors[at + i] = storeFactors[start + i]!;
      }
      rowSpanCount += count;
      rows.set(rowKey, rowFirst.length);
      rowFirst.push(at); rowCount.push(count);
    }
  }
  /**
   * V of tap (tu, tv) of surface k at edge point (p, q): `share` with the reference's arguments, kept per tap. With every card's Y
   * relation certain for the tap's region (`yBits` ≥ 0), no card's horizontal edge crosses its rays: `share` then reads q only through
   * those relations (no row break, no row's presence moves), so V is a function of p and the relations, and the value is kept by them.
   * With every card's X relation certain, `share`'s interval ends are the region's own (or empty) whatever p is, so V is a function of
   * q and those relations. Otherwise `share` runs.
   */
  function tapV(lg: number, rects: readonly (LayeredCardEdges | null)[], k: number, p: number, q: number, tv: number, tu: number, s: number, side: number, yBits: number): number {
    let key = -1;
    if (yBits >= 0) key = (((tv + radius[k]!) * side + tu + radius[k]!) * 65536 + p + TAP_CACHE_COORDINATE) * 2 ** (k + 1) * 2 + yBits * 2;
    else if (k < TAP_CACHE_SURFACES && Math.abs(q) < TAP_CACHE_COORDINATE) {
      let xBits = 0;
      for (let j = 0; j <= k && xBits >= 0; j++) if (rects[j]) {
        const x = tu >= inLo[j]! && tu <= inHi[j]! ? 1 : tu < outBelow[j]! || tu >= outAbove[j]! ? 0 : 2;
        xBits = x === 2 ? -1 : 2 * xBits + x;
      }
      if (xBits >= 0) key = (((tv + radius[k]!) * side + tu + radius[k]!) * 65536 + q + TAP_CACHE_COORDINATE) * 2 ** (k + 1) * 2 + xBits * 2 + 1;
    }
    const cache = key < 0 ? undefined : (tapCache[lg * K + k] ??= new Map<number, number>());
    const kept = cache?.get(key);
    if (kept !== undefined) return kept;
    let a0 = (tu - 0.5) / s, a1 = (tu + 0.5) / s, b0 = (tv - 0.5) / s, b1 = (tv + 0.5) / s;
    if (s < 0) { [a0, a1] = [a1, a0]; [b0, b1] = [b1, b0]; }
    const V = visibility.share(lg, k, p, q, a0, a1, b0, b1);
    stats.shares++;
    cache?.set(key, V);
    return V;
  }
  /**
   * The key of surface k's list at edge point (p, q) of layered group lg, or null when it is the point's own. Away from every card
   * edge of one axis by more than any tap's ray reaches (|r|·(R + 1) plus twice the margin), every relation on that axis is certain
   * and the same at every tap, and `share` reads the point's coordinate on that axis only through those relations (no row break, no
   * row's presence and no interval end moves with it). The list is then a function of the group, the surface, the point's other
   * coordinate and which cards' ranges contain it on the first axis: on a card's vertical edge, one list serves the whole edge.
   */
  function listKey(lg: number, rects: readonly (LayeredCardEdges | null)[], k: number, p: number, q: number, s: number): string | null {
    let yFree = true, xFree = true, yBits = "", xBits = "";
    const R = radius[k]!;
    for (let j = 0; j <= k; j++) {
      const rect = rects[j];
      if (!rect) continue;
      const r = rho[j]! / s, reachJ = Math.abs(r) * (R + 1) + 2 * marginOf(rect, r, R);
      if (yFree) { if (Math.min(Math.abs(q - rect[1]!), Math.abs(q - rect[3]!)) > reachJ) yBits += q > rect[1]! && q < rect[3]! ? "1" : "0"; else yFree = false; }
      if (xFree) { if (Math.min(Math.abs(p - rect[0]!), Math.abs(p - rect[2]!)) > reachJ) xBits += p > rect[0]! && p < rect[2]! ? "1" : "0"; else xFree = false; }
    }
    return yFree ? lg + " " + k + " y " + p + " " + yBits : xFree ? lg + " " + k + " x " + q + " " + xBits : null;
  }
  /** Surface k's list at edge point (p, q) of layered group lg: its id in `lists`, built on first use (see `listKey`). */
  function surfaceList(lg: number, rects: readonly (LayeredCardEdges | null)[], k: number, p: number, q: number): number {
    const kernel = layers[k]!.kernel, s = rho[k]!, R = radius[k]!, key = !kernel || s === 0 ? null : listKey(lg, rects, k, p, q, s);
    if (key !== null) { const id = cache.get(key); if (id !== undefined) return id; }
    listFirst = storeSpans;
    if (!kernel || s === 0) {
      // The reference's direct sum: every tap's region is the whole pupil, so every tap takes one V.
      const V = visibility.share(lg, k, p, q, -1, 1, -1, 1);
      stats.shares++;
      if (V > 0) for (let tv = -R; tv <= R; tv++) { const lo = rowLo[k]![tv + R]!, hi = rowHi[k]![tv + R]!; if (lo <= hi) push(k, tv, lo, hi, V); }
    } else for (let tv = -R; tv <= R; tv++) rowSpans(lg, rects, k, p, q, tv, s, kernel.weights);
    let taps = 0;
    for (let i = listFirst; i < storeSpans; i++) taps += (store[i * DISPLAY_VIEW_LAYERED_SPAN_WORDS + 2]! | 0) - (store[i * DISPLAY_VIEW_LAYERED_SPAN_WORDS + 1]! | 0) + 1;
    const id = lists.length;
    lists.push({ first: listFirst, count: storeSpans - listFirst, taps });
    stats.lists++;
    if (key !== null) cache.set(key, id);
    return id;
  }
  /** The lists of edge point (p, q) of layered group lg, surface by surface as the reference's `sumAt` visits them, into `entries`; returns their count. */
  const entries = new Uint32Array(MAXIMUM_SURFACES);
  function edgeLists(lg: number, p: number, q: number): number {
    const rects = geometry.edges(lg, p, q);
    let n = 0;
    for (let k = 0; k < K; k++) {
      const rect = rects[k]!, h = reach[k]!;
      if (rect !== null && layeredBoxRelation(rect, p - h, q - h, p + h, q + h) === 0) continue;
      entries[n++] = surfaceList(lg, rects, k, p, q);
      if (rect !== null && layeredBoxRelation(rect, p - h, q - h, p + h, q + h) === 1) break;
    }
    return n;
  }
  /** Forgets every list (when the store has grown past its cap between dispatches). */
  function clearLists(): void { lists.length = 0; cache.clear(); tapCache.length = 0; storeSpans = 0; rowCache.length = 0; rowFirst.length = 0; rowCount.length = 0; rowSpanCount = 0; }

  // ---------------------------------------------------------------------------------------------------------------
  const windowBytes = (lw: number, lh: number): number => radius.reduce((sum, R) => sum + (lw + 2 * R) * (lh + 2 * R) * N * 4, 0);
  return {
    siteGamma, stats,
    /** Internal, for tests: the spans of edge point (p, q) of layered group `group`, in order (the factors in float64, before the GPU's rounding). */
    spansAt(group, p, q): { k: number; tv: number; u0: number; u1: number; f: number }[] {
      const out = [], count = edgeLists(group, p, q);
      for (let e = 0; e < count; e++) {
        const list = lists[entries[e]!]!;
        for (let i = list.first; i < list.first + list.count; i++) {
          const o = i * DISPLAY_VIEW_LAYERED_SPAN_WORDS, k = store[o]! >>> 16;
          out.push({ k, tv: (store[o]! & 0xffff) - radius[k]!, u0: store[o + 1]! | 0, u1: store[o + 2]! | 0, f: storeFactors[i]! });
        }
      }
      return out;
    },
    latticeWords: N + DISPLAY_VIEW_LAYERED_POINT_WORDS,
    tapsPerSite: T,
    bandBytes(siteW: number, siteH: number): number {
      let bytes = SPAN_CHUNK_WORDS * 4 + table.byteLength + kernelTable.byteLength;
      for (const g of tables.groups) bytes += windowBytes(siteW + g.cw - 1, siteH + g.ch - 1);
      return bytes;
    },
    async recompute(view, _signalInput, indices, abort, take): Promise<void> {
      // The reference's own pixels, with the view's layered signal (a region renders the whole view's pixels bit for bit).
      const region = view.region;
      for (let r = 0; r < indices.length;) {
        throwIfAborted(abort.signal);
        const first = indices[r]!, rx = first % region.width, ry = (first - rx) / region.width;
        let run = 1;
        while (r + run < indices.length && indices[r + run] === first + run && rx + run < region.width) run++;
        take(first, run, await renderDisplayView({ ...view, region: { x: region.x + rx, y: region.y + ry, width: run, height: 1 } }));
        r += run;
      }
    },
    async runBand(band, io, signal): Promise<{ latticeMs: number; sitesMs: number; dispatches: number; resolved: number }> {
      const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
      let t0 = now();
      const { groupWords, groupBuffer, latticeTotal, siteW, siteH, siteBuffer, sitesParams } = io, gi32 = new Int32Array(groupWords.buffer, groupWords.byteOffset, groupWords.length);
      const window = (g: number): { x0: number; y0: number; w: number; h: number; first: number } => {
        const base = g * DISPLAY_VIEW_QUALITY_GROUP_WORDS;
        return { x0: gi32[base]!, y0: gi32[base + 1]!, w: groupWords[base + 2]!, h: groupWords[base + 3]!, first: groupWords[base + 4]! };
      };
      // Phase 1: each point's surface (or −1 at an edge), and the radiance windows the band reads.
      const surfaceOf = new Int32Array(latticeTotal), needed = new Uint8Array(K * G);
      for (let g = 0; g < G; g++) {
        const { x0, y0, w, h, first } = window(g), lg = layeredGroup[g]!;
        for (let j = 0, i = first; j < h; j++) for (let c = 0; c < w; c++, i++) {
          const s = geometry.surfaceOf(lg, x0 + c, y0 + j);
          surfaceOf[i] = s;
          if (s >= 0) needed[s * G + g] = 1; else for (let k = 0; k < K; k++) needed[k * G + g] = 1;
        }
      }
      // The radiance windows: surface k's values over group g's lattice window widened by its kernel radius, from the lattice's tiles.
      const windowTable = new Uint32Array(2 * K + 4 * K * G), windowInts = new Int32Array(windowTable.buffer);
      let values = 0;
      for (let k = 0; k < K; k++) {
        windowTable[2 * k] = kernelOffset[k]!; windowTable[2 * k + 1] = radius[k]!;
        for (let g = 0; g < G; g++) if (needed[k * G + g]) { const { w, h } = window(g), R = radius[k]!; values += (w + 2 * R) * (h + 2 * R) * N; }
      }
      if (4 * values > runtime.maximumStorageBindingBytes) throw new ImageKernelExecutionError("insufficient-limits", "The layered view's radiance windows (" + 4 * values +
        " bytes) exceed the device's storage binding limit of " + runtime.maximumStorageBindingBytes + " bytes.");
      const radiance = new Float32Array(Math.max(1, values));
      let at = 0, largest = 0;
      for (let k = 0; k < K; k++) for (let g = 0; g < G; g++) {
        if (!needed[k * G + g]) continue;
        const { x0: wx, y0: wy, w, h } = window(g), R = radius[k]!, x0 = wx - R, y0 = wy - R, ww = w + 2 * R, wh = h + 2 * R, key = k * LAYERED_LATTICE_GROUP_LIMIT + layeredGroup[g]!;
        const o = 2 * K + 4 * (k * G + g);
        windowTable[o] = at; windowInts[o + 1] = x0; windowInts[o + 2] = y0; windowTable[o + 3] = ww;
        for (let y = y0; y < y0 + wh; y++) {
          const ty = Math.floor(y / TILE), row = y - ty * TILE;
          for (let x = x0; x < x0 + ww;) {
            const tx = Math.floor(x / TILE), tile = tiles.tileAt(key, tx, ty), end = Math.min(x0 + ww, (tx + 1) * TILE);
            for (; x < end; x++) {
              const from = (row * TILE + x - tx * TILE) * N;
              for (let n = 0; n < N; n++) {
                const v = tile[from + n]!;
                if (!(v >= 0 && v <= FLOAT32_SAFE_MAGNITUDE)) throw new ImageKernelExecutionError("unsupported-on-backend", "A layered surface's radiance is outside the float32 domain.");
                radiance[at++] = v;
                if (v > largest) largest = v;
              }
            }
          }
        }
      }
      // Every S value and sum stays in range: S ≤ Σ_k (kernel sum)·L_max; a site at most C's mass times that.
      stats.hostMilliseconds += now() - t0;
      const sMax = K * Math.max(1, ...weightSum) * largest;
      if (!(sMax * Math.max(1, cMass) <= FLOAT32_SAFE_MAGNITUDE)) throw new ImageKernelExecutionError("unsupported-on-backend", "The layered view's sums are outside the float32 domain.");
      const sums = band.buffer("photivra-display-view-layered-sums", Math.max(4, latticeTotal * N * 4), BUFFER_USAGE.STORAGE);
      const kernelsBuffer = band.upload("photivra-display-view-layered-kernels", kernelTable, BUFFER_USAGE.STORAGE);
      const windowsBuffer = band.upload("photivra-display-view-layered-windows", windowTable, BUFFER_USAGE.STORAGE), radianceBuffer = band.upload("photivra-display-view-layered-radiance", radiance, BUFFER_USAGE.STORAGE);
      const sumPipeline = await pipelines(sumLabel, displayViewLayeredSumWgsl(DISPLAY_VIEW_QUALITY_GROUP_WORDS, DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE));
      // Phase 2: the sums, in dispatches of contiguous points whose taps stay within the budget and whose spans within a chunk. A
      // dispatch's point words are two per point (its code, its first entry), then two per entry (a list's first span and count in the
      // dispatch's spans); each list it reads is copied into its spans once.
      let dispatches = 0, first = 0, count = 0, work = 0, words = 0, pointCodes = new Uint32Array(1024), entryIds = new Uint32Array(1024), entryCount = 0;
      const budget = Math.max(1, io.maximumSiteTapsPerDispatch), inDispatch = new Map<number, number>();
      const dispatch = async (): Promise<void> => {
        throwIfAborted(signal);
        const pointWords = new Uint32Array(2 * (count + entryCount)), spanWords = new Uint32Array(Math.max(DISPLAY_VIEW_LAYERED_SPAN_WORDS, words)), spanFloat = new Float32Array(spanWords.buffer);
        const offsets = new Map<number, number>();
        let at = 0;
        for (let e = 0; e < entryCount; e++) {
          const id = entryIds[e]!, list = lists[id]!;
          let o = offsets.get(id);
          if (o === undefined) {
            o = at;
            offsets.set(id, o);
            spanWords.set(store.subarray(list.first * DISPLAY_VIEW_LAYERED_SPAN_WORDS, (list.first + list.count) * DISPLAY_VIEW_LAYERED_SPAN_WORDS), o * DISPLAY_VIEW_LAYERED_SPAN_WORDS);
            for (let i = 0; i < list.count; i++) spanFloat[(o + i) * DISPLAY_VIEW_LAYERED_SPAN_WORDS + 3] = storeFactors[list.first + i]!;
            at += list.count;
          }
          pointWords[2 * (count + e)] = o; pointWords[2 * (count + e) + 1] = list.count;
        }
        pointWords.set(pointCodes.subarray(0, 2 * count));
        for (let i = 0; i < count; i++) if ((pointWords[2 * i]! & DISPLAY_VIEW_LAYERED_SINGLE) === 0) pointWords[2 * i + 1] = pointWords[2 * i + 1]! + count;
        const chunk = new GpuResourceScope(runtime);
        try {
          const params = new Uint32Array(DISPLAY_VIEW_LAYERED_SUM_PARAM_WORDS);
          params[0] = count * N; params[1] = first; params[2] = G; params[3] = N; params[4] = K;
          const group = runtime.device.createBindGroup({ layout: sumPipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: chunk.upload("photivra-display-view-layered-sum-params", params, BUFFER_USAGE.UNIFORM) } },
            { binding: 1, resource: { buffer: groupBuffer } },
            { binding: 2, resource: { buffer: chunk.upload("photivra-display-view-layered-points", pointWords, BUFFER_USAGE.STORAGE) } },
            { binding: 3, resource: { buffer: chunk.upload("photivra-display-view-layered-spans", spanWords, BUFFER_USAGE.STORAGE) } },
            { binding: 4, resource: { buffer: kernelsBuffer } }, { binding: 5, resource: { buffer: windowsBuffer } }, { binding: 6, resource: { buffer: radianceBuffer } },
            { binding: 7, resource: { buffer: sums } }] });
          await runComputePass(runtime, chunk, sumPipeline, group, linearDispatch(count * N, DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE, runtime.maximumWorkgroupsPerDimension), [], signal);
        } finally { chunk.release(); }
        dispatches++; stats.sumDispatches++;
        count = 0; work = 0; words = 0; entryCount = 0; inDispatch.clear();
        // Between dispatches no point holds a list: past the store's cap, start a new store.
        if (storeSpans * DISPLAY_VIEW_LAYERED_SPAN_WORDS > STORE_CAP_WORDS) clearLists();
      };
      for (let g = 0; g < G; g++) {
        const { x0, y0, w, h, first: g0 } = window(g), lg = layeredGroup[g]!;
        for (let j = 0, i = g0; j < h; j++) for (let c = 0; c < w; c++, i++) {
          const s = surfaceOf[i]!;
          let n = 0, taps = 0, newWords = 0;
          if (s >= 0) taps = (2 * radius[s]! + 1) ** 2;
          else {
            const h0 = now();
            n = edgeLists(lg, x0 + c, y0 + j);
            stats.hostMilliseconds += now() - h0;
            for (let e = 0; e < n; e++) { const list = lists[entries[e]!]!; taps += list.taps; if (!inDispatch.has(entries[e]!)) newWords += list.count * DISPLAY_VIEW_LAYERED_SPAN_WORDS; }
          }
          if (count > 0 && (work + taps > budget || words + newWords > SPAN_CHUNK_WORDS)) {
            await dispatch();
            // The new store (if one was started) no longer holds this point's lists: build them again.
            if (s < 0 && lists.length === 0) { n = edgeLists(lg, x0 + c, y0 + j); }
            newWords = 0;
            for (let e = 0; e < n; e++) newWords += lists[entries[e]!]!.count * DISPLAY_VIEW_LAYERED_SPAN_WORDS;
          }
          if (count === 0) first = i;
          pointCodes = grow(pointCodes, 2 * (count + 1));
          if (s >= 0) { pointCodes[2 * count] = (DISPLAY_VIEW_LAYERED_SINGLE | s) >>> 0; pointCodes[2 * count + 1] = 0; }
          else {
            entryIds = grow(entryIds, entryCount + n);
            // The point's first entry pair (absolute: after the dispatch's point words, which `dispatch` lays out first).
            pointCodes[2 * count] = n; pointCodes[2 * count + 1] = entryCount;
            for (let e = 0; e < n; e++) { entryIds[entryCount++] = entries[e]!; inDispatch.set(entries[e]!, 1); stats.spans += lists[entries[e]!]!.count; }
            stats.edgePoints++;
          }
          count++; work += taps; words += newWords;
        }
      }
      if (count > 0) await dispatch();
      const latticeMs = now() - t0;
      // Phase 3: the sites, as the Quality host splits its own site pass (at most the tap budget per dispatch).
      t0 = now();
      const sitesPipeline = await pipelines(sitesLabel, displayViewLayeredSitesWgsl(DISPLAY_VIEW_QUALITY_COMMON_WGSL, DISPLAY_VIEW_QUALITY_SITE_TAIL_WGSL, DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE));
      const tableBuffer = band.upload("photivra-display-view-layered-table", table, BUFFER_USAGE.STORAGE);
      // What a flushing device can drop from a site: the S values' own (sTiny, through C's mass), C below the normal range times S's largest, and the site's products and partials.
      const tiny = Math.max(FLOAT32_MINIMUM_NORMAL, Math.fround((sTiny * cMass + tinyC * sMax + (2 * T * N + 2 * G + 4) * FLOAT32_MINIMUM_NORMAL) * (1 + 8 * E)));
      const siteParams = new Float32Array(DISPLAY_VIEW_LAYERED_SITE_PARAM_WORDS);
      siteParams[0] = tiny;
      const layeredUniform = band.upload("photivra-display-view-layered-site-params", siteParams, BUFFER_USAGE.UNIFORM);
      const siteTotal = siteW * siteH, perDispatch = Math.max(DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE, Math.floor(budget / Math.max(1, T) / DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE) * DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE);
      let siteDispatches = 0;
      for (let siteFirst = 0; siteFirst < siteTotal; siteFirst += perDispatch) {
        throwIfAborted(signal);
        const chunk = new GpuResourceScope(runtime);
        try {
          const n = Math.min(perDispatch, siteTotal - siteFirst);
          const group = runtime.device.createBindGroup({ layout: sitesPipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: chunk.upload("photivra-display-view-layered-site-quality", sitesParams(n, siteFirst), BUFFER_USAGE.UNIFORM) } },
            { binding: 1, resource: { buffer: groupBuffer } }, { binding: 3, resource: { buffer: tableBuffer } }, { binding: 4, resource: { buffer: sums } },
            { binding: 5, resource: { buffer: siteBuffer } }, { binding: 6, resource: { buffer: layeredUniform } }] });
          await runComputePass(runtime, chunk, sitesPipeline, group, linearDispatch(n, DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE, runtime.maximumWorkgroupsPerDimension), [], signal);
        } finally { chunk.release(); }
        siteDispatches++;
      }
      return { latticeMs, sitesMs: now() - t0, dispatches: siteDispatches + dispatches, resolved: 0 };
    }
  };
}

/** Renders one region of a layered view on the GPU (see the module comment): the layered passes with the Quality host's pass 3 and finishing. */
export async function renderDisplayViewLayeredOnGpu(runtime: WebGpuRuntime, bandBytes: number, setup: DisplayViewSetup, abort: AbortController, yieldControl: YieldControl,
  pipelines: PipelineSource, options: { maximumSiteTapsPerDispatch?: number } = {}): Promise<DisplayViewQualityGpuResult & { layered: ReturnType<typeof createDisplayViewLayeredPasses>["stats"] }> {
  const reason = displayViewLayeredGpuUnsupportedReason(setup);
  if (reason) throw new ImageKernelExecutionError("unsupported-on-backend", "webgpu-f32 display view (layered): " + reason + "; use cpu-reference.");
  const quality = qualityInput(setup, layeredOf(setup)!.layers), passes = createDisplayViewLayeredPasses(runtime, setup, quality, pipelines);
  const result = await renderDisplayViewQualityOnGpu(runtime, bandBytes, { setup, signalInput: quality, material: { id: "layered", wgsl: "", bindings: [] }, lens: passes,
    ...(options.maximumSiteTapsPerDispatch !== undefined ? { maximumSiteTapsPerDispatch: options.maximumSiteTapsPerDispatch } : {}) }, abort, yieldControl, pipelines);
  return { ...result, layered: passes.stats };
}

// ---------------------------------------------------------------------------------------------------------------
// The renderer the GPU session takes for a layered view.

/**
 * The display-view GPU renderer for a layered view (`DisplayViewGpuRequest.layeredGpu`): the layered passes for the requests and setups
 * they cover, on the device and pipeline cache of the engine's renderer `base`, whose Speed self-check it keeps; the Quality kernels'
 * cases and the layered case run before the first render. `dispose` disposes `base`.
 */
export function createLayeredDisplayViewGpuRenderer(base: DisplayViewGpuRenderer, handle: DisplayViewGpuRuntimeHandle, options: { maximumBandBytes?: number } = {}): DisplayViewGpuRenderer {
  const runtime = handle as WebGpuRuntime, bandBytes = options.maximumBandBytes ?? Math.min(64 * 1024 * 1024, runtime.maximumStorageBindingBytes);
  const source: PipelineSource = (label, code) => createComputePipeline(runtime, label, code);
  return {
    id: "photivra-display-view-layered",
    supports: displayViewLayeredGpuSupports,
    ...(base.conformanceCases ? { conformanceCases: base.conformanceCases } : {}),
    onDemandConformanceCases: (): Promise<readonly DisplayViewGpuConformanceCase[]> => Promise.resolve([...DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES, DISPLAY_VIEW_LAYERED_CONFORMANCE_CASE]),
    async render(part: DisplayViewGpuPart): Promise<DisplayViewGpuRenderOutput> {
      const { setup, signal } = part, abort = new AbortController(), onAbort = (): void => abort.abort();
      if (signal?.aborted) throw abortedError();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const result = await renderDisplayViewLayeredOnGpu(runtime, bandBytes, setup, abort, undefined, source);
        return { samples: result.samples, expected: result.expected, noiseStd: result.noiseStd, sampleCount: result.sampleCount, siteCount: result.siteCount, detailPixelCount: result.detailPixelCount,
          uniformPixelCount: result.uniformPixelCount, estimation: result.estimation, saturated: result.saturated, saturatedPixelCount: result.saturatedPixelCount,
          errorBound: result.expectedValueBound, diagnosticUncertaintySampleCount: result.execution.diagnosticUncertaintySampleCount };
      } finally { signal?.removeEventListener("abort", onAbort); }
    },
    dispose(): void { base.dispose?.(); }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Run-time self-check.

/**
 * The layered passes' self-check (`display-view:layered:checkerboard-13x9-cards`): the Quality self-checks' 38 × 26 frame of 6 µm
 * sites at 13 × 9 with the 2 × 2 box (four lattice groups), three surfaces of the checkerboard (a card in front of the focus plane,
 * one behind it, the back plane) with defocus discs of radius 2 to 4, synthetic radius-1 diffraction kernels, the GPU against
 * `renderDisplayView` with the layered signal within the a-priori bounds, the sums split over several dispatches.
 */
async function runLayeredConformance(handle: DisplayViewGpuRuntimeHandle, signal: AbortSignal | undefined): Promise<true | string> {
  const runtime = handle as WebGpuRuntime, { nativeWidth, nativeHeight, frameWidth, nodes } = CONFORMANCE_FRAME, { scene } = conformanceChart();
  const offsets = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].map(([x, y]) => ({ x: x!, y: y!, weight: 0.25 }));
  const diffraction = { radius: 1, perNode: nodes.map((_, n) => { const side = 0.04 + 0.02 * n, corner = 0.01, k = Float64Array.of(corner, side, corner, side, 0, side, corner, side, corner); k[4] = 1 - 4 * (side + corner); return k; }) };
  const disc = (rho: number): { radius: number; weights: Float64Array } => { const d = createDefocusDiscSiteKernel(2 * Math.abs(rho))!; return { radius: d.radius, weights: d.weights }; };
  const layers: LayeredSceneLayer[] = [
    { rect: { u0: -0.7, v0: -0.25, u1: 0.05, v1: 0.3 }, blurRadiusSites: -2.3, scene, kernel: disc(2.3) },
    { rect: { u0: -0.2, v0: -0.4, u1: 0.6, v1: 0.15 }, blurRadiusSites: 1.6, scene, kernel: disc(1.6) },
    { rect: null, blurRadiusSites: 3.4, scene, kernel: disc(3.4) }];
  const latticeInput = { nativeWidth, nativeHeight, outputWidth: frameWidth, wavelengthsNm: nodes, layers, occlusionSamples: 4, diffraction, offsets,
    electronsPerRadiance: conformanceResponses(1), channelAt: conformanceChannelAt };
  const layered = createLayeredSceneSignal(latticeInput, createLayeredSceneLattice(latticeInput));
  const signalInput: DisplayViewExpectedSignalInput = { nativeWidth, nativeHeight, outputWidth: frameWidth, wavelengthsNm: nodes, electronsPerRadiance: conformanceResponses(1), offsets,
    kernels: diffraction, scene, channelAt: conformanceChannelAt };
  const setup = conformanceSetup(signalInput, { perElectron: 1 / 40000, darkElectrons: 0.07, constantVariance: 2.5e-7 }, 750, 5 + 4 + 1, signal,
    { signal: layered, gpu: { signalInput, chart: null, layered: { layers } } as NonNullable<DisplayViewSetup["gpu"]> });
  const reference: DisplayViewRenderResult = await renderDisplayView(setup);
  return await withConformanceAbort(runtime, signal, async (abort, pipelines) => {
    const gpu = await renderDisplayViewLayeredOnGpu(runtime, 1 << 20, setup, abort, undefined, pipelines, { maximumSiteTapsPerDispatch: 4096 });
    if (gpu.layered.edgePoints === 0 || gpu.layered.sumDispatches < 2) return "the self-check did not sum edge points over several dispatches.";
    return conformanceVerdict(reference, gpu);
  });
}
/** #750's self-check of the layered passes (see `runLayeredConformance`). */
export const DISPLAY_VIEW_LAYERED_CONFORMANCE_CASE: DisplayViewGpuConformanceCase = { id: "display-view:layered:checkerboard-13x9-cards", run: runLayeredConformance };
