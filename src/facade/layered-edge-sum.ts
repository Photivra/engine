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
 * Interface for the later 2.29.0 groups:
 * - {@link checkLayeredSurfaceKernel} and {@link checkLayeredKernelGroups}: the kernel checks and the edge bound
 *   ({@link LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES}, 64 sites for discs and shaped kernels alike today). A kernel says whether
 *   it is `shaped` (blades, spherical aberration, cat's eye) or a disc, so that #749 (group LE) can enforce separate bounds
 *   for the two (`LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites: { disc, shaped }` of #764, group LQ) after both merge.
 * - `capacityBytes` ({@link LayeredEdgeSumInput}): the bytes the edge sum's own stores may hold. It keeps none today; #749's
 *   prefix rows take their store from it.
 * - {@link LayeredEdgeSum.sumAt}`(group, p, q, out, at)` adds S at lattice point (p, q) of a group into `out[at … at + N)`
 *   (zero on entry). Each value depends only on the point, so tiles keep their bits whatever was read before.
 * - #749 and #750 (group LE) replace the direct sum over (2R + 1)² taps at edge points by row runs over
 *   `visibility.rowIntervals` (prefix rows of the surface radiance), here and in `spectral-lattice-tiles.ts`.
 * - #741 (group LC) passes several kernel groups per surface (a kernel per spectral node or per node group for axial color);
 *   the wave-4 wiring builds them in `layered-scene-setup.ts`. The order of the sum per node does not depend on the grouping.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES } from "../optics/site-kernel-runs.js";
import type { SiteKernelFieldZones } from "./diffraction-provider.js";
import { layeredBoxRelation, type LayeredLatticeGeometry } from "./layered-lattice-geometry.js";
import type { LayeredVisibility } from "./layered-visibility.js";

/** Largest defocus kernel radius of a surface in a scene of more than one surface (edge sites sum it directly). */
export const LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES = DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES;

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
}

export interface LayeredEdgeSumInput {
  geometry: LayeredLatticeGeometry;
  visibility: LayeredVisibility;
  surfaces: LayeredSurfaceTileReader;
  /** Per surface (nearest first), its kernel groups; together they cover the nodes [0, N) once ({@link checkLayeredKernelGroups}). */
  kernelGroups: readonly (readonly LayeredKernelGroup[])[];
  /** Bytes the edge sum's own stores may hold (the lattice's whole budget; it keeps none today, see the module comment). */
  capacityBytes: number;
}

/** The layered sum at a lattice point (see the module comment). */
export interface LayeredEdgeSum {
  /** Adds S at lattice point (p, q) of a group, at each node, into `out[at … at + N)` (zero on entry). */
  sumAt(group: number, p: number, q: number, out: Float64Array, at: number): void;
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
  const R = layer.kernel ? layer.kernel.radius : 0;
  if (layer.kernel && layer.kernel.weights.length !== (2 * R + 1) ** 2) fail("Layered scene: a kernel must have (2R + 1)² taps.");
  if (surfaces > 1 && R > LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES)
    fail("Layered scene: a surface's blur needs a kernel radius of " + R + " sites; at card edges the layered sum takes at most " +
      LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES + ". Reduce the defocus or the f-number's aperture.");
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

/** Internal: the layered sum over a geometry, its visibility and the surface tiles (see the module comment). */
export function createLayeredEdgeSum(input: LayeredEdgeSumInput): LayeredEdgeSum {
  const { geometry, visibility, surfaces, kernelGroups } = input, K = geometry.surfaces, rho = geometry.blurRadiusSites, reachOf = geometry.reachSites;
  let edgePoints = 0;
  function sumAt(group: number, p: number, q: number, out: Float64Array, at: number): void {
    const r = geometry.edges(group, p, q), x = p, y = q, single = geometry.surfaceOf(group, p, q);
    if (single < 0) edgePoints++;
    for (let k = single < 0 ? 0 : single; k < (single < 0 ? K : single + 1); k++) {
      const rect = r[k]!;
      if (single < 0 && rect !== null && layeredBoxRelation(rect, x - reachOf[k]!, y - reachOf[k]!, x + reachOf[k]!, y + reachOf[k]!) === 0) continue;
      const s = rho[k]!;
      for (const { nodes: { from, to }, kernel } of kernelGroups[k]!) {
        const weights = kernel.weightsAt(p, q), R = weights ? kernel.radius : 0;
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
          const o = surfaces.at(k, group, p - tu, q - tv), L = surfaces.tile;
          for (let n = from; n < to; n++) out[at + n] = out[at + n]! + f * L[o + n]!;
        }
      }
      // Every ray of this point reaches surface k or a nearer one: farther surfaces add nothing.
      if (single < 0 && rect !== null && layeredBoxRelation(rect, x - reachOf[k]!, y - reachOf[k]!, x + reachOf[k]!, y + reachOf[k]!) === 1) break;
    }
  }
  return { sumAt, get edgePoints(): number { return edgePoints; } };
}
