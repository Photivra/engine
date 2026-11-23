// SPDX-License-Identifier: Apache-2.0

/**
 * The layered sum at one lattice point (2.29.0 group L0; the model is in `layered-scene-signal.ts`):
 *   S(p)[n] = Σ_k Σ_t D_k(t)·V_k(p, t)·L_k(p − t)[n],
 * surface k's defocus kernel D_k, the share V_k of tap t's pupil region whose rays reach surface k (`layered-visibility.ts`) and
 * the surface's spectral radiance L_k at lattice point p − t (read from the per-surface tiles). A lattice point whose rays all
 * reach one surface (the geometry's `surfaceOf`) takes that surface's kernel sum alone (V = 1); an edge point sums every surface
 * its rays can reach, nearest first, and stops after a surface that takes all of them.
 *
 * Kernel groups. A surface's kernel is given per group of spectral nodes, {@link LayeredKernelGroup} `{ nodes, kernel }`: the
 * nodes [from, to) take that kernel. Today every surface has one group over all nodes ({@link layeredKernelGroups}: the disc or
 * shaped kernel, or with a cat's eye its field zone's kernel at the lattice point), so the sum is the same at every node.
 *
 * Runs (2.29.0, #749 and #750). The sum is regrouped by kernel rows, without changing what is summed. Each kernel row is split into
 * segments of equal weight (the disc: one interior run, the cells the circle crosses and the centre on their own; blades likewise;
 * spherical aberration: mostly single taps). A run of taps whose pupil regions all reach surface k (V = 1) costs one row sum of
 * the surface tile (`spectral-lattice-tiles.ts`, `rowSum`: block and row sums, about one read per 32 taps) instead of one read
 * per tap; taps whose regions reach no part of surface k are skipped (V = 0); the others take V by rows as before
 * (`visibility.share`). Which taps are which comes from the open Px intervals of pupil rows (`visibility.rowIntervals`), read
 * twice per segment between row breaks for each point and surface (`bands`) and interpolated for each kernel row (`classify`):
 * an interval's end points are linear in Py within a segment, so a cell inside an interval at both ends of the row's band is
 * inside it at every occlusion row of `share`, and a cell outside its hull at both ends is outside it at every row. Interpolated
 * ends are moved inward by a margin far below a tap's width, so a cell within rounding of an end is integrated as before. A
 * point that sees one surface sums every row by runs (V = 1). Cost per edge point and surface: O(R) rows of a few runs and the
 * O(R) taps along card edges, instead of (2R + 1)² taps with V each. The result equals the direct sum within the equivalence
 * tolerance (rule 3 of the 2.29.0 plan; measured in test/layered-scene-edge-runs.test.ts: within 1e-13 relative at radii 3 to
 * 64), not bit for bit; `method: "direct"` keeps the direct sum as the reference. Run sums of non-negative radiance add only
 * non-negative terms, so no term cancels.
 *
 * Interface for the later 2.29.0 groups:
 * - {@link checkLayeredSurfaceKernel} and {@link checkLayeredKernelGroups}: the kernel checks and the edge bound
 *   ({@link LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES}: `LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites` of #764, 512 sites for
 *   the disc, `DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES`, and 128 for a shaped kernel: blades, spherical aberration, cat's eye). A
 *   shaped kernel with few equal neighbours (spherical aberration) sums its taps one by one, so its cost per edge point grows as
 *   (2R + 1)²: at 128 sites it is about that of the disc at 512 by runs (measured per edge point on the module's lattices).
 * - `capacityBytes` ({@link LayeredEdgeSumInput}): the bytes the edge sum's own stores may hold. It keeps none: the row sums are in
 *   the surface tiles (the lattice's surface share of the budget).
 * - {@link LayeredEdgeSum.sumAt}`(group, p, q, out, at)` adds S at lattice point (p, q) of a group into `out[at … at + N)`
 *   (zero on entry); {@link LayeredEdgeSum.sumRows} a block of points with the same bits, one surface at a time. Each value
 *   depends only on the point, so tiles keep their bits whatever was read before.
 * - The visibility is read only through `rowIntervals`, `rowBreaks` and `share` (whose buffers grow to the counts they return),
 *   card edges only through `layeredBoxRelation`; the tap-to-pupil scale ρ_k is taken in one place per kernel group
 *   (`pupilScale`), so #741 (group LC) may give a kernel group its own.
 * - #741 (group LC) passes several kernel groups per surface (a kernel per spectral node or per node group for axial color);
 *   the wave-4 wiring builds them in `layered-scene-setup.ts`. The order of the sum per node does not depend on the grouping.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { SiteKernelFieldZones } from "./diffraction-provider.js";
import { LAYERED_CHART_LIMITS } from "./layered-chart-scene.js";
import { layeredBoxRelation, type LayeredLatticeGeometry } from "./layered-lattice-geometry.js";
import type { LayeredVisibility } from "./layered-visibility.js";

/**
 * Largest defocus kernel radius of a surface in a scene of more than one surface, for the uniform disc and for a shaped kernel:
 * `LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites` (#764), the one place the values live.
 */
export const LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES = LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites;

/** A surface's defocus kernel on the site lattice: light from s lands at s + t with weight D(t). */
export interface LayeredSurfaceKernel {
  /** Kernel radius R in sites (the weights are (2R + 1)², row-major). */
  readonly radius: number;
  /** A shaped kernel (blades, spherical aberration, cat's eye) rather than the uniform disc; undefined is a disc. */
  readonly shaped?: boolean | undefined;
  /** The weights at lattice point (p, q) (a cat's eye: its field zone's kernel), or null for a unit tap (in focus). Read only. */
  weightsAt(p: number, q: number): Float64Array | null;
}

/** The spectral nodes [nodes.from, nodes.to) of a surface that take one kernel. */
export interface LayeredKernelGroup {
  readonly nodes: { readonly from: number; readonly to: number };
  readonly kernel: LayeredSurfaceKernel;
}

/** Surface radiance at the lattice points, from the per-surface tiles: `at` returns the offset of the point's first node in `tile`. */
export interface LayeredSurfaceTileReader {
  /** Surface k's values at lattice point (p, q) of a group: sets `tile` and returns the offset of node 0 in it. */
  at(k: number, group: number, p: number, q: number): number;
  /** The tile array of the last `at` call. */
  readonly tile: Float64Array;
  /**
   * Optional (2.29.0, #749): adds Σ_{p = p0 … p1} L_k(p, q) at nodes [from, to) into out[from … to), from the tiles' row sums
   * (`spectral-lattice-tiles.ts`, `rowSum`; the same bits for the same arguments, whatever was read before). Without it every
   * tap is read on its own.
   */
  rowSum?(k: number, group: number, p0: number, p1: number, q: number, out: Float64Array, from: number, to: number): void;
}

export interface LayeredEdgeSumInput {
  geometry: LayeredLatticeGeometry;
  visibility: LayeredVisibility;
  surfaces: LayeredSurfaceTileReader;
  /** Per surface (nearest first), its kernel groups; together they cover the nodes [0, N) once ({@link checkLayeredKernelGroups}). */
  kernelGroups: readonly (readonly LayeredKernelGroup[])[];
  /** Bytes the edge sum's own stores may hold (the lattice's whole budget; it keeps none: its prefix rows are in the surface tiles). */
  capacityBytes: number;
  /** Internal (tests and benchmarks): "direct" sums every tap on its own, the method of 2.28.0 (the reference of the run sum). */
  method?: "runs" | "direct";
}

/** The layered sum at a lattice point (see the module comment). */
export interface LayeredEdgeSum {
  /** Adds S at lattice point (p, q) of a group, at each node, into `out[at … at + N)` (zero on entry). */
  sumAt(group: number, p: number, q: number, out: Float64Array, at: number): void;
  /**
   * S at lattice points [x0, x0 + width) × [y0, y0 + height) of a group, row-major, point by point, node by node, into `out` (zero
   * on entry): each point's value has the bits of `sumAt`'s (the same additions in the same order), with the reads of one surface
   * kept together (2.29.0: the surface tiles a block reads at once are one surface's).
   */
  sumRows(group: number, x0: number, y0: number, width: number, height: number, out: Float64Array): void;
  /** Lattice points whose S was computed as an edge point (diagnostics). */
  readonly edgePoints: number;
}

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };

/** A surface's kernel as the layer list gives it: (2R + 1)² row-major weights, and whether it is shaped. */
export interface LayeredLayerKernel { radius: number; weights: Float64Array; shaped?: boolean | undefined }

/**
 * Internal: the kernel checks of one surface of `surfaces` (`createLayeredSceneLattice` calls it for each layer, in its
 * validation order): the weight count, the edge bound in a scene of more than one surface, and field zones' axis kernel.
 */
export function checkLayeredSurfaceKernel(layer: { readonly kernel: LayeredLayerKernel | null; readonly zones?: unknown }, surfaces: number): void {
  const R = layer.kernel ? layer.kernel.radius : 0, bound = layer.kernel?.shaped ? LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES.shaped : LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES.disc;
  if (layer.kernel && layer.kernel.weights.length !== (2 * R + 1) ** 2) fail("Layered scene: a kernel must have (2R + 1)² taps.");
  if (surfaces > 1 && R > bound)
    fail("Layered scene: a surface's blur needs a kernel radius of " + R + " sites; at card edges the layered sum takes at most " +
      bound + (layer.kernel?.shaped ? " for a shaped kernel" : "") + ". Reduce the defocus or the f-number's aperture.");
  if (layer.zones && !layer.kernel) fail("Layered scene: field zones need the surface's axis kernel (its radius).");
}

/** Internal: kernel groups cover each surface's nodes [0, nodes) in order, each of radius at most the surface kernel's. */
export function checkLayeredKernelGroups(kernelGroups: readonly (readonly LayeredKernelGroup[])[], layers: readonly { readonly kernel: { readonly radius: number } | null }[], nodes: number): void {
  if (kernelGroups.length !== layers.length || kernelGroups.some((groups, k) => groups.length < 1 || groups.some((g, i) => g.nodes.from !== (i === 0 ? 0 : groups[i - 1]!.nodes.to) ||
    !(g.nodes.to > g.nodes.from) || !Number.isInteger(g.kernel.radius) || g.kernel.radius < 0 || g.kernel.radius > (layers[k]!.kernel ? layers[k]!.kernel!.radius : 0)) ||
    groups[groups.length - 1]!.nodes.to !== nodes)) fail("Layered scene: each surface's kernel groups must cover the spectral nodes in order, each within the surface's kernel radius.");
}

/**
 * Internal: today's kernel groups of a layer list: per surface one group over all N nodes, the surface's kernel (null in focus)
 * or, with field zones, its zone's kernel at the lattice point (zone kernels kept in one cache of at most 256 for all surfaces).
 */
export function layeredKernelGroups(layers: readonly { readonly kernel: LayeredLayerKernel | null; readonly zones?: SiteKernelFieldZones | undefined }[],
  nativeWidth: number, nativeHeight: number, nodes: number): LayeredKernelGroup[][] {
  const W = nativeWidth, H = nativeHeight;
  const zoneCache = new Map<number, Float64Array>();
  function zoneKernel(k: number, zone: number): Float64Array {
    const key = k * 65536 + zone;
    let w = zoneCache.get(key);
    if (!w) {
      w = layers[k]!.zones!.kernelOf(zone);
      if (w.length !== layers[k]!.kernel!.weights.length) fail("Layered scene: a zone kernel must have the surface's kernel radius.");
      zoneCache.set(key, w);
      if (zoneCache.size > 256) zoneCache.delete(zoneCache.keys().next().value!);
    }
    return w;
  }
  return layers.map((layer, k): LayeredKernelGroup[] => {
    const z = layer.zones, kernel = layer.kernel;
    const weightsAt = !kernel ? (): null => null : !z ? (): Float64Array => kernel.weights : (p: number, q: number): Float64Array => {
      const zx = Math.min(z.columns - 1, Math.floor(Math.min(W - 1, Math.max(0, p)) / z.size)),
        zy = Math.min(z.rows - 1, Math.floor(Math.min(H - 1, Math.max(0, q)) / z.size));
      return zoneKernel(k, zy * z.columns + zx);
    };
    return [{ nodes: { from: 0, to: nodes }, kernel: { radius: kernel ? kernel.radius : 0, shaped: kernel?.shaped, weightsAt } }];
  });
}

/** Shortest run of equal weights summed by prefix differences; shorter runs are read tap by tap (as `site-kernel-runs.ts`). */
const MINIMUM_RUN = 3;
/** Where a segment between two row breaks is read, as a share of its height from each end (inside every occlusion row of it). */
const SEGMENT_INSET = 2 ** -12;

/** A kernel's rows as segments of equal, non-zero weights: row v's are segStart[v] … segStart[v + 1] − 1, columns u0 … u1. */
interface KernelRows { segStart: Int32Array; u0: Int32Array; u1: Int32Array; w: Float64Array }

function kernelRowsOf(weights: Float64Array, R: number): KernelRows {
  const width = 2 * R + 1, segStart = new Int32Array(width + 1), u0: number[] = [], u1: number[] = [], w: number[] = [];
  for (let v = 0; v < width; v++) {
    const row = v * width;
    for (let u = 0; u < width;) {
      const x = weights[row + u]!;
      let end = u;
      while (end + 1 < width && weights[row + end + 1] === x) end++;
      if (x !== 0) { u0.push(u - R); u1.push(end - R); w.push(x); }
      u = end + 1;
    }
    segStart[v + 1] = w.length;
  }
  return { segStart, u0: Int32Array.from(u0), u1: Int32Array.from(u1), w: Float64Array.from(w) };
}

/** A growable list of closed intervals [lo, hi] (pairs). */
class Intervals {
  v = new Float64Array(16);
  n = 0;
  push(lo: number, hi: number): void {
    if (2 * this.n + 2 > this.v.length) { const g = new Float64Array(2 * this.v.length); g.set(this.v); this.v = g; }
    this.v[2 * this.n] = lo; this.v[2 * this.n + 1] = hi; this.n++;
  }
}

/** a ∩ b into out (sorted, disjoint closed intervals); empty intersections and single points are dropped. */
function intersect(a: Intervals, b: Intervals, out: Intervals): void {
  out.n = 0;
  for (let i = 0, j = 0; i < a.n && j < b.n;) {
    const lo = Math.max(a.v[2 * i]!, b.v[2 * j]!), hi = Math.min(a.v[2 * i + 1]!, b.v[2 * j + 1]!);
    if (hi > lo) out.push(lo, hi);
    if (a.v[2 * i + 1]! < b.v[2 * j + 1]!) i++; else j++;
  }
}

/** Internal: the layered sum over a geometry, its visibility and the surface tiles (see the module comment). */
export function createLayeredEdgeSum(input: LayeredEdgeSumInput): LayeredEdgeSum {
  const { geometry, visibility, surfaces, kernelGroups } = input, K = geometry.surfaces, rho = geometry.blurRadiusSites, reachOf = geometry.reachSites;
  const runs = typeof surfaces.rowSum === "function", N = kernelGroups.length > 0 ? kernelGroups[0]![kernelGroups[0]!.length - 1]!.nodes.to : 0;
  const direct = input.method === "direct";
  let edgePoints = 0;
  const rowsCache = new WeakMap<Float64Array, KernelRows>();
  const rowsOf = (weights: Float64Array, R: number): KernelRows => {
    let r = rowsCache.get(weights);
    if (!r) { r = kernelRowsOf(weights, R); rowsCache.set(weights, r); }
    return r;
  };
  /**
   * The tap-to-pupil scale of surface k's kernel groups: tap t covers the pupil region cell(t)/s. The one place it is taken (once
   * per kernel group), so that a kernel group may have its own scale later (#741).
   */
  const pupilScale = (k: number): number => rho[k]!;
  let acc = new Float64Array(0);
  /** Σ_{x = x0 … x1} L_k(x, y) at nodes [from, to) from the tiles' row sums, times w, added into out. */
  function addRun(k: number, group: number, x0: number, x1: number, y: number, w: number, from: number, to: number, out: Float64Array, at: number): void {
    if (acc.length < to) acc = new Float64Array(to);
    for (let n = from; n < to; n++) acc[n] = 0;
    surfaces.rowSum!(k, group, x0, x1, y, acc, from, to);
    for (let n = from; n < to; n++) out[at + n] = out[at + n]! + w * acc[n]!;
  }
  // Classification of one kernel row's taps (see sumAt): buffers.
  let breaks = new Float64Array(16), rowA = new Float64Array(16), rowB = new Float64Array(16);
  const open = new Intervals(), closed = new Intervals(), segOpen = new Intervals(), segClosed = new Intervals(), scratch = new Intervals();
  function breaksOf(group: number, k: number, p: number, q: number, b0: number, b1: number): number {
    let n = visibility.rowBreaks(group, k, p, q, b0, b1, breaks);
    if (n > breaks.length) { breaks = new Float64Array(2 * n); n = visibility.rowBreaks(group, k, p, q, b0, b1, breaks); }
    return n;
  }
  function intervalsAt(group: number, k: number, p: number, q: number, py: number, second: boolean): number {
    let out = second ? rowB : rowA, n = visibility.rowIntervals(group, k, p, q, py, -Infinity, Infinity, out);
    if (2 * n > out.length) {
      out = new Float64Array(4 * n);
      if (second) rowB = out; else rowA = out;
      n = visibility.rowIntervals(group, k, p, q, py, -Infinity, Infinity, out);
    }
    return n;
  }
  // The segments of a point's pupil between the row breaks of surface k (`bands`): for each, two rows read inside it near its
  // ends (y0 < y1) and the open intervals there (lo, hi at y0, then at y1, four values an interval), or −1 intervals when the
  // counts differ (unknown).
  let segY0 = new Float64Array(16), segY1 = new Float64Array(16), segC0 = new Float64Array(16), segC1 = new Float64Array(16), segN = new Int32Array(16),
    segAt = new Int32Array(16), segValues = new Float64Array(64), segCount = 0;
  function growSegments(count: number): void {
    if (count <= segN.length) return;
    const size = 2 * count, grow = <A extends Float64Array | Int32Array>(a: A): A => { const g = new (a.constructor as new (n: number) => A)(size); g.set(a); return g; };
    segY0 = grow(segY0); segY1 = grow(segY1); segC0 = grow(segC0); segC1 = grow(segC1); segN = grow(segN); segAt = grow(segAt);
  }
  /**
   * The row breaks of surface k over pupil band [b0, b1] (all of a kernel's rows) and each segment's open intervals near both its
   * ends. Within a segment an interval's end points are linear in Py (no edge of the surface's or a nearer card starts or ends
   * there), so the intervals at any Py of the segment are the linear interpolation of these two reads.
   */
  function bands(group: number, k: number, p: number, q: number, b0: number, b1: number): void {
    const nb = breaksOf(group, k, p, q, b0, b1);
    segCount = 0;
    let used = 0;
    growSegments(nb);
    for (let j = 0; j + 1 < nb; j++) {
      const c0 = breaks[j]!, c1 = breaks[j + 1]!;
      if (!(c1 > c0)) continue;
      const g = segCount++, y0 = c0 + (c1 - c0) * SEGMENT_INSET, y1 = c1 - (c1 - c0) * SEGMENT_INSET;
      segC0[g] = c0; segC1[g] = c1; segY0[g] = y0; segY1[g] = y1; segAt[g] = used; segN[g] = -1;
      if (!(y0 > c0 && y1 < c1 && y1 > y0)) continue;
      const na = intervalsAt(group, k, p, q, y0, false), nc = intervalsAt(group, k, p, q, y1, true);
      if (na !== nc) continue;
      if (used + 4 * na > segValues.length) { const v = new Float64Array(2 * (used + 4 * na)); v.set(segValues); segValues = v; }
      let linear = true;
      for (let i = 0; i < na && linear; i++) {
        const lo0 = rowA[2 * i]!, hi0 = rowA[2 * i + 1]!, lo1 = rowB[2 * i]!, hi1 = rowB[2 * i + 1]!;
        // An end that is infinite at one read and finite at the other is not linear: unknown.
        linear = (lo0 === -Infinity) === (lo1 === -Infinity) && (hi0 === Infinity) === (hi1 === Infinity);
        segValues[used + 4 * i] = lo0; segValues[used + 4 * i + 1] = hi0; segValues[used + 4 * i + 2] = lo1; segValues[used + 4 * i + 3] = hi1;
      }
      if (!linear) continue;
      segN[g] = na;
      used += 4 * na;
    }
  }
  /** An interval end at Py c of a segment read at y0 and y1 (values v0, v1): the linear interpolation; ±∞ stays. */
  const endAt = (v0: number, v1: number, y0: number, y1: number, c: number): number => (v0 === v1 ? v0 : v0 + (v1 - v0) * ((c - y0) / (y1 - y0)));
  /**
   * Margin of an interpolated end (v0 ≠ v1): the rounding of the interpolation, far below a tap's width in the pupil (1/512 at
   * least). An end read the same at both rows is exact (no margin).
   */
  const margin = (v0: number, v1: number, v: number): number => (v0 === v1 ? 0 : 1e-9 * (1 + Math.abs(v)));
  /**
   * The Px sets of pupil band [b0, b1] (a kernel row) where every occlusion row of `share` is open (`open`) or closed (`closed`)
   * for surface k, from the segments of `bands`: in each segment the band crosses, a cell inside interval i at both ends of the
   * crossing is inside it at every row between (the ends are linear in Py), and a cell outside each interval's hull at both ends
   * is outside them all. The interpolated ends are moved inward by a margin, so a cell within rounding of an end is neither (its V
   * is integrated as before). An unknown segment makes the band unknown (both sets empty).
   */
  function classify(b0: number, b1: number): void {
    open.n = 0; closed.n = 0;
    open.push(-Infinity, Infinity); closed.push(-Infinity, Infinity);
    let crossed = 0;
    for (let g = 0; g < segCount; g++) {
      const c0 = Math.max(b0, segC0[g]!), c1 = Math.min(b1, segC1[g]!);
      if (!(c1 > c0)) continue;
      crossed++;
      const n = segN[g]!;
      if (n < 0) { open.n = 0; closed.n = 0; return; }
      const y0 = segY0[g]!, y1 = segY1[g]!, at = segAt[g]!;
      segOpen.n = 0; segClosed.n = 0;
      let gap = -Infinity;
      for (let i = 0; i < n; i++) {
        const lo0 = segValues[at + 4 * i]!, hi0 = segValues[at + 4 * i + 1]!, lo1 = segValues[at + 4 * i + 2]!, hi1 = segValues[at + 4 * i + 3]!;
        const la = endAt(lo0, lo1, y0, y1, c0), lb = endAt(lo0, lo1, y0, y1, c1), ha = endAt(hi0, hi1, y0, y1, c0), hb = endAt(hi0, hi1, y0, y1, c1);
        const inLo = Math.max(la, lb), inHi = Math.min(ha, hb), outLo = Math.min(la, lb), outHi = Math.max(ha, hb);
        const mLo = margin(lo0, lo1, inLo), mHi = margin(hi0, hi1, inHi), openLo = inLo + mLo, openHi = inHi - mHi, hullLo = outLo - mLo, hullHi = outHi + mHi;
        if (openHi > openLo) segOpen.push(openLo, openHi);
        if (hullLo > gap) segClosed.push(gap, hullLo);
        gap = Math.max(gap, hullHi);
      }
      if (gap < Infinity) segClosed.push(gap, Infinity);
      intersect(open, segOpen, scratch); swap(open, scratch);
      intersect(closed, segClosed, scratch); swap(closed, scratch);
    }
    if (crossed === 0) { open.n = 0; closed.n = 0; }
  }
  /** The taps t of [−R, R] whose cell [(t ∓ ½)/s] lies within [lo, hi] (a contiguous range), as [first, last] in tapRange. */
  const tapRange = new Int32Array(2);
  function tapsWithin(lo: number, hi: number, s: number, R: number): boolean {
    // cell(t) = [(t − ½)/s, (t + ½)/s], ends swapped for s < 0: the edge sum's own expressions, so the test is exact.
    const inside = (t: number): boolean => (s > 0 ? (t - 0.5) / s >= lo && (t + 0.5) / s <= hi : (t + 0.5) / s >= lo && (t - 0.5) / s <= hi);
    // A cell inside [lo, hi] has its centre t/s there: t within [s·lo, s·hi] (ordered), give or take a tap of rounding.
    const e0 = s * lo, e1 = s * hi, m0 = Math.max(-R - 1, Math.min(R + 1, Math.min(e0, e1))), m1 = Math.max(-R - 1, Math.min(R + 1, Math.max(e0, e1)));
    const end = Math.min(R, Math.floor(m1) + 1);
    let first = Math.max(-R, Math.ceil(m0) - 1);
    while (first <= end && !inside(first)) first++;
    if (first > end) return false;
    let last = end;
    while (!inside(last)) last--;
    tapRange[0] = first; tapRange[1] = last;
    return true;
  }
  // Tap ranges of one kernel row: class 1 open, 0 closed, sorted by first tap.
  let rangeFirst = new Int32Array(16), rangeLast = new Int32Array(16), rangeClass = new Uint8Array(16), ranges = 0;
  function addRange(first: number, last: number, c: number): void {
    if (ranges === rangeFirst.length) {
      const f = new Int32Array(2 * ranges), l = new Int32Array(2 * ranges), k = new Uint8Array(2 * ranges);
      f.set(rangeFirst); l.set(rangeLast); k.set(rangeClass); rangeFirst = f; rangeLast = l; rangeClass = k;
    }
    let i = ranges++;
    for (; i > 0 && rangeFirst[i - 1]! > first; i--) { rangeFirst[i] = rangeFirst[i - 1]!; rangeLast[i] = rangeLast[i - 1]!; rangeClass[i] = rangeClass[i - 1]!; }
    rangeFirst[i] = first; rangeLast[i] = last; rangeClass[i] = c;
  }
  function tapRanges(s: number, R: number): void {
    ranges = 0;
    for (let i = 0; i < open.n; i++) if (tapsWithin(open.v[2 * i]!, open.v[2 * i + 1]!, s, R)) addRange(tapRange[0]!, tapRange[1]!, 1);
    for (let i = 0; i < closed.n; i++) if (tapsWithin(closed.v[2 * i]!, closed.v[2 * i + 1]!, s, R)) addRange(tapRange[0]!, tapRange[1]!, 0);
  }

  function sumAt(group: number, p: number, q: number, out: Float64Array, at: number): void {
    const single = geometry.surfaceOf(group, p, q);
    if (single < 0) edgePoints++;
    for (let k = single < 0 ? 0 : single; k < (single < 0 ? K : single + 1); k++) if (surfaceAt(group, p, q, k, single, out, at)) break;
  }
  /**
   * Surface k's part of S at lattice point (p, q) (`single`: the point's one surface, or −1 at an edge point), added into out;
   * true when every ray of the point reaches surface k or a nearer one (farther surfaces add nothing).
   */
  function surfaceAt(group: number, p: number, q: number, k: number, single: number, out: Float64Array, at: number): boolean {
    const x = p, y = q;
    {
      const rect = geometry.edges(group, p, q)[k]!;
      if (single < 0 && rect !== null && layeredBoxRelation(rect, x - reachOf[k]!, y - reachOf[k]!, x + reachOf[k]!, y + reachOf[k]!) === 0) return false;
      for (const kernelGroup of kernelGroups[k]!) {
        const { nodes: { from, to }, kernel } = kernelGroup, s = pupilScale(k);
        const weights = kernel.weightsAt(p, q), R = weights ? kernel.radius : 0;
        if (!weights || direct || (single < 0 && s === 0)) { directSum(group, k, x, y, s, single, weights, R, from, to, out, at); continue; }
        const rows = rowsOf(weights, R);
        if (single < 0) bands(group, k, x, y, Math.min((-R - 0.5) / s, (R + 0.5) / s), Math.max((-R - 0.5) / s, (R + 0.5) / s));
        for (let tv = -R; tv <= R; tv++) {
          const row = tv + R, yy = q - tv;
          if (single >= 0) {
            for (let g = rows.segStart[row]!; g < rows.segStart[row + 1]!; g++) addOpen(group, k, p, yy, rows.u0[g]!, rows.u1[g]!, rows.w[g]!, from, to, out, at);
            continue;
          }
          let b0 = (tv - 0.5) / s, b1 = (tv + 0.5) / s;
          if (s < 0) [b0, b1] = [b1, b0];
          classify(b0, b1);
          tapRanges(s, R);
          let i = 0;
          for (let g = rows.segStart[row]!; g < rows.segStart[row + 1]!; g++) {
            const u1 = rows.u1[g]!, w = rows.w[g]!;
            for (let t = rows.u0[g]!; t <= u1;) {
              while (i < ranges && rangeLast[i]! < t) i++;
              if (i < ranges && rangeFirst[i]! <= t) {
                const e = Math.min(u1, rangeLast[i]!);
                if (rangeClass[i] === 1) addOpen(group, k, p, yy, t, e, w, from, to, out, at);
                t = e + 1;
                continue;
              }
              // Taps up to the next classified range: V by rows (the visibility's share), as the direct sum.
              const e = Math.min(u1, i < ranges ? rangeFirst[i]! - 1 : u1);
              for (; t <= e; t++) {
                let a0 = (t - 0.5) / s, a1 = (t + 0.5) / s;
                if (s < 0) [a0, a1] = [a1, a0];
                const vis = visibility.share(group, k, x, y, a0, a1, b0, b1);
                if (vis === 0) continue;
                const f = w * vis, o = surfaces.at(k, group, p - t, yy), L = surfaces.tile;
                for (let n = from; n < to; n++) out[at + n] = out[at + n]! + f * L[o + n]!;
              }
            }
          }
        }
      }
      // Every ray of this point reaches surface k or a nearer one: farther surfaces add nothing.
      return single < 0 && rect !== null && layeredBoxRelation(rect, x - reachOf[k]!, y - reachOf[k]!, x + reachOf[k]!, y + reachOf[k]!) === 1;
    }
  }
  // sumRows: each point's surfaces in the order of sumAt, surface by surface over the block (the reads of one surface together).
  let state = new Int32Array(0);
  function sumRows(group: number, x0: number, y0: number, width: number, height: number, out: Float64Array): void {
    const count = width * height;
    if (state.length < count) state = new Int32Array(count);
    // state: the point's one surface (≥ 0), −1 at an edge point, −2 once its sum is complete.
    for (let j = 0, i = 0; j < height; j++) for (let c = 0; c < width; c++, i++) { state[i] = geometry.surfaceOf(group, x0 + c, y0 + j); if (state[i]! < 0) edgePoints++; }
    for (let k = 0; k < K; k++) for (let j = 0, i = 0; j < height; j++) for (let c = 0; c < width; c++, i++) {
      const single = state[i]!;
      if (single === -2 || (single >= 0 && single !== k)) continue;
      if (surfaceAt(group, x0 + c, y0 + j, k, single, out, i * N) || single >= 0) state[i] = -2;
    }
  }
  /** Taps u0 … u1 of a kernel row (weight w) whose whole pupil regions reach surface k: one run, or tap by tap when short. */
  function addOpen(group: number, k: number, p: number, yy: number, u0: number, u1: number, w: number, from: number, to: number, out: Float64Array, at: number): void {
    if (runs && u1 - u0 + 1 >= MINIMUM_RUN) { addRun(k, group, p - u1, p - u0, yy, w, from, to, out, at); return; }
    for (let t = u0; t <= u1; t++) {
      const o = surfaces.at(k, group, p - t, yy), L = surfaces.tile;
      for (let n = from; n < to; n++) out[at + n] = out[at + n]! + w * L[o + n]!;
    }
  }
  /** The direct sum over every tap (a unit tap in focus, or ρ = 0 at an edge point: every tap's region is the whole pupil). */
  function directSum(group: number, k: number, x: number, y: number, s: number, single: number, weights: Float64Array | null, R: number, from: number, to: number,
    out: Float64Array, at: number): void {
    for (let tv = -R, t = 0; tv <= R; tv++) for (let tu = -R; tu <= R; tu++, t++) {
      const w = weights ? weights[t]! : 1;
      if (w === 0) continue;
      let f = w;
      if (single < 0) {
        let a0 = -1, a1 = 1, b0 = -1, b1 = 1;
        if (R > 0 && s !== 0) { a0 = (tu - 0.5) / s; a1 = (tu + 0.5) / s; b0 = (tv - 0.5) / s; b1 = (tv + 0.5) / s; if (s < 0) { [a0, a1] = [a1, a0]; [b0, b1] = [b1, b0]; } }
        const vis = visibility.share(group, k, x, y, a0, a1, b0, b1);
        if (vis === 0) continue;
        f = w * vis;
      }
      const o = surfaces.at(k, group, x - tu, y - tv), L = surfaces.tile;
      for (let n = from; n < to; n++) out[at + n] = out[at + n]! + f * L[o + n]!;
    }
  }
  return { sumAt, sumRows, get edgePoints(): number { return edgePoints; } };
}

function swap(a: Intervals, b: Intervals): void { const v = a.v, n = a.n; a.v = b.v; a.n = b.n; b.v = v; b.n = n; }
