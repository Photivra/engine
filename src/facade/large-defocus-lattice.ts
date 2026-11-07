// SPDX-License-Identifier: Apache-2.0

/**
 * Internal (#564): the providers' lattice for a defocus kernel above the direct radius (64 sites). For each spectral node n
 * the value at lattice point p is (K_n ⊛ D ⊛ S_n)(p): S_n the provider's samples on the lattice (scene radiance, or with
 * image-space defocus the field factor times the radiance), D the defocus kernel convolved by runs (`site-kernel-runs.ts`,
 * exact, in fixed tiles), and K_n the node's diffraction kernel when `lens.diffraction` is on, gathered directly from the
 * D-convolved tiles (also in fixed tiles). Below the direct radius the providers keep the combined kernel K_n ⊛ D of 2.16.0.
 *
 * Convolution is associative, so K_n ⊛ (D ⊛ S) is the combined kernel's sum (K_n ⊛ D) ⊛ S regrouped: the same quantity, with
 * different rounding. Every value depends only on its lattice point (fixed tiles), so regions and parts equal the whole frame.
 */

import { createSiteKernelRunsLattice, type SiteKernelRuns, type SiteKernelRunsTileSource } from "../optics/site-kernel-runs.js";
import { checkedSiteKernel, gatherInterior, kernelTaps } from "./diffraction-provider.js";

/** Tile side of the providers' run lattice, in lattice points (also the diffraction tiles'). */
export const LARGE_DEFOCUS_TILE = 64;

/** A defocus kernel above the direct radius, as runs, with the diffraction kernels applied after it. */
export interface LargeDefocusKernel {
  runs: SiteKernelRuns;
  /** `lens.diffraction`: each node's site kernel of radius `radius` ((2·radius + 1)² row-major taps). */
  diffraction?: { radius: number; kernelAt(wavelengthNm: number): Float64Array } | undefined;
}

/** (K_n ⊛ D ⊛ S_n)(x, y) for node index n at lattice point (x, y). */
export interface LargeDefocusNodeLattice { valueAt(node: number, x: number, y: number): number }

/** Bytes of tiles the providers keep for one request, shared by its lattices (shifts, and times with camera rotation). */
export const LARGE_DEFOCUS_CACHE_BYTES = 96 * 1048576;

/**
 * `capacityBytes`: this lattice's share of {@link LARGE_DEFOCUS_CACHE_BYTES} (half for the run tiles, half for the diffraction
 * tiles when there are any). Tiles are dropped least recently used first; a dropped tile is computed again with the same bits.
 */
export function createLargeDefocusNodeLattice(input: { kernel: LargeDefocusKernel; wavelengthsNm: readonly number[]; source: SiteKernelRunsTileSource;
  capacityBytes: number; onTile?: (milliseconds: number) => void }): LargeDefocusNodeLattice {
  const { kernel, wavelengthsNm } = input, nodes = wavelengthsNm.length, T = LARGE_DEFOCUS_TILE, share = kernel.diffraction ? input.capacityBytes / 2 : input.capacityBytes;
  const blurred = createSiteKernelRunsLattice({ runs: kernel.runs, tile: T, fields: nodes, source: input.source, capacityBytes: share, ...(input.onTile ? { onTile: input.onTile } : {}) });
  const diffraction = kernel.diffraction;
  if (!diffraction) return { valueAt: (node, x, y) => blurred.valueAt(node, x, y) };
  // The diffraction gather over the D-convolved values: tile plus Rd on each side, read from the fixed run tiles.
  const Rd = diffraction.radius, gridWidth = T + 2 * Rd;
  const taps = wavelengthsNm.map((nm) => kernelTaps(checkedSiteKernel(diffraction.kernelAt(nm), Rd), Rd, gridWidth));
  return createSiteKernelLatticeFromTiles(nodes, T, share, (tx, ty, node) => {
    // The tile plus Rd on each side, copied row segment by row segment from the run tiles it overlaps.
    const grid = new Float64Array(gridWidth * gridWidth), x0 = tx * T - Rd, y0 = ty * T - Rd;
    for (let by = Math.floor(y0 / T); by * T < y0 + gridWidth; by++) for (let bx = Math.floor(x0 / T); bx * T < x0 + gridWidth; bx++) {
      const values = blurred.tileAt(bx, by)[node]!, ax = Math.max(x0, bx * T), ex = Math.min(x0 + gridWidth, (bx + 1) * T);
      for (let y = Math.max(y0, by * T); y < Math.min(y0 + gridWidth, (by + 1) * T); y++)
        grid.set(values.subarray((y - by * T) * T + ax - bx * T, (y - by * T) * T + ex - bx * T), (y - y0) * gridWidth + ax - x0);
    }
    return gatherInterior(grid, taps[node]!, gridWidth, T, T, Rd);
  });
}

/** A lattice of `fields` values per point from fixed T × T tiles computed by `compute`, least recently used dropped beyond `bytes`. */
function createSiteKernelLatticeFromTiles(fields: number, T: number, bytes: number, compute: (tx: number, ty: number, field: number) => Float64Array): LargeDefocusNodeLattice {
  const cache = new Map<number, Float64Array[]>(), capacity = Math.max(1, Math.floor(bytes / (fields * T * T * 8)));
  return {
    valueAt(field, x, y): number {
      const tx = Math.floor(x / T), ty = Math.floor(y / T), key = (ty + 1048576) * 2097152 + tx + 1048576;
      let values = cache.get(key);
      if (values) { cache.delete(key); cache.set(key, values); }
      else {
        values = Array.from({ length: fields }, (_, f) => compute(tx, ty, f));
        cache.set(key, values);
        if (cache.size > capacity) cache.delete(cache.keys().next().value!);
      }
      return values[field]![(y - ty * T) * T + x - tx * T]!;
    }
  };
}
