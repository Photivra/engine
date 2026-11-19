// SPDX-License-Identifier: Apache-2.0

/**
 * Large defocus kernels (#564): an exact convolution with a site kernel whose cost per output grows with the kernel's
 * perimeter, not its area, for kernels of radius above {@link DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES}.
 *
 * Method. Each kernel row is split into runs of consecutive taps with the same weight (run-length encoding). A run's
 * contribution to the output, w·Σ_{u = u0}^{u1} L(x − u, y − v), is the difference of two prefix sums of the source row
 * y − v, so it costs two reads however long the run is. Runs with the same weight are summed first and multiplied once.
 * This is the summed-area (integral image) evaluation of a box filter applied row by row: Crow, "Summed-area tables for
 * texture mapping", SIGGRAPH 1984 (ACM, free to read), and Heckbert, "Filtering by repeated integration", SIGGRAPH 1986
 * (free), which convolves any piecewise-constant kernel this way.
 *
 * The geometric defocus disc (`createDefocusDiscSiteKernel`) has one weight for every cell wholly inside the disc (the
 * cell's area is exactly 1, so its weight is 1 divided by the total, the same double for all of them); only the cells the
 * circle crosses, and the centre (which takes up the normalization's rounding), have their own weights. So the disc of
 * radius R costs one run per row (2R + 1 of them) plus about 8R single taps, against (2R + 1)² taps of the direct gather:
 * about 1,800 reads per output at R = 179 against 128,881. The shaped kernels of #553 without spherical aberration (blade
 * polygons, the cat's eye) have the same structure (a uniform interior, exact polygon areas at the edge); a kernel with
 * no equal neighbouring weights (spherical aberration's ray binning) has no runs and costs as much as the direct gather,
 * so {@link siteKernelRuns} refuses one whose reads per output exceed {@link SITE_KERNEL_RUNS_MAXIMUM_READS}.
 *
 * It is not an approximation: every output is the same sum of the same products as the direct gather, regrouped. The
 * regrouping changes only the rounding. The prefix sums of a row are accumulated from the left edge of the source tile,
 * so a run's difference carries an absolute rounding error of a few ulps of the row's prefix (at most the sum over the tile's
 * source row, (T + 2R) samples), and an output sums 2R + 1 run sums instead of (2R + 1)² products. Measured on the Siemens
 * star, slanted edge and dead leaves at radii 65, 179 and 512 against a compensated (Neumaier) sum of the same products: within
 * 2.5e-14 relative, where the direct gather itself was up to 1e-11 off (scripts/benchmark-large-defocus.mjs accuracy). Prefix
 * sums of non-negative samples never decrease, so every run sum, and every output, is non-negative.
 *
 * Window independence. Outputs are computed in fixed square tiles of T × T lattice points at absolute positions
 * (tile (tx, ty) holds [tx·T, (tx + 1)·T) × [ty·T, (ty + 1)·T)), each from its own source rectangle, the tile plus R on
 * every side. A value therefore depends only on its lattice point and the request, never on the window, region or order
 * of the queries: regions and parts are bit-identical to the whole frame.
 *
 * Rows on demand (#653, `rowBlock`). An output row reads only its own 2R + 1 source rows, and each source row's prefix sums
 * start at the tile's fixed left edge, so a row's bits do not depend on which other rows of the tile are computed. A lattice
 * with `rowBlock` B computes a tile's rows in fixed blocks of B rows (rows [b·B, (b + 1)·B) of the tile), each from its own
 * source rows (the block plus R above and below), when a value of the block is first read: a band of rows costs its blocks
 * and the source rows 2R beyond them, not whole tiles, and the values are the same bits as those of whole tiles.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/**
 * Largest kernel radius convolved directly ((2R + 1)² taps per output, the method of 2.16.0 and earlier). Requests within it
 * render byte-identically to 2.16.0; above it, the run convolution of this module applies.
 */
export const DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES = 64;

/**
 * Most reads per output the run convolution accepts: the tap count of the direct gather at radius 64, (2·64 + 1)², so a large
 * kernel never costs more per output than the largest direct one. The disc stays far below it (6,145 at radius 512).
 */
export const SITE_KERNEL_RUNS_MAXIMUM_READS = 129 * 129;

/** Shortest run summed by prefix differences; shorter runs are read tap by tap (fewer reads). */
const MINIMUM_RUN = 3;
const MAXIMUM_SAMPLE = 2 ** 100;

/** A site kernel as weighted runs (prefix differences) and single taps, in a fixed order. */
export interface SiteKernelRuns {
  /** Kernel radius R: the window is (2R + 1)². */
  readonly radius: number;
  /** Distinct run weights, in order of first appearance (row-major). */
  readonly groupWeights: Float64Array;
  /** Runs of group g are runStart[g] … runStart[g + 1] − 1. */
  readonly runStart: Int32Array;
  /** Each run's kernel row v and columns u0 ≤ u1 (offsets from the centre). */
  readonly runV: Int32Array;
  readonly runU0: Int32Array;
  readonly runU1: Int32Array;
  /** Single taps: row v, column u, weight. */
  readonly tapV: Int32Array;
  readonly tapU: Int32Array;
  readonly tapW: Float64Array;
  /** Reads per output: 2 per run plus 1 per tap. */
  readonly readsPerOutput: number;
}

/**
 * The run decomposition of a site kernel of radius R ((2R + 1)² row-major weights, out(p) = Σ_t K(t)·L(p − t)). Zero taps are
 * skipped. Fails with `InvalidConfigurationError` when the kernel would need more than {@link SITE_KERNEL_RUNS_MAXIMUM_READS}
 * reads per output, with a short `lens.defocus:` message (the kernels it takes are `lens.defocus`'s; spherical aberration's ray binning
 * is the one that can reach the limit).
 */
export function siteKernelRuns(weights: Float64Array, radius: number): SiteKernelRuns {
  const width = 2 * radius + 1;
  if (!Number.isInteger(radius) || radius < 0 || weights.length !== width * width) throw new InvalidConfigurationError("Site kernels must be (2R + 1)² taps.");
  const groups = new Map<number, number[]>(), tapV: number[] = [], tapU: number[] = [], tapW: number[] = [];
  for (let v = -radius; v <= radius; v++) {
    const row = (v + radius) * width;
    for (let u = -radius; u <= radius;) {
      const w = weights[row + u + radius]!;
      let end = u;
      while (end + 1 <= radius && weights[row + end + 1 + radius] === w) end++;
      if (w !== 0) {
        if (end - u + 1 >= MINIMUM_RUN) {
          let list = groups.get(w);
          if (!list) { list = []; groups.set(w, list); }
          list.push(v, u, end);
        } else for (let k = u; k <= end; k++) { tapV.push(v); tapU.push(k); tapW.push(w); }
      }
      u = end + 1;
    }
  }
  const groupWeights = Float64Array.from(groups.keys()), runStart = new Int32Array(groupWeights.length + 1), runV: number[] = [], runU0: number[] = [], runU1: number[] = [];
  let g = 0;
  for (const list of groups.values()) {
    for (let k = 0; k < list.length; k += 3) { runV.push(list[k]!); runU0.push(list[k + 1]!); runU1.push(list[k + 2]!); }
    runStart[++g] = runV.length;
  }
  const readsPerOutput = 2 * runV.length + tapW.length;
  if (readsPerOutput > SITE_KERNEL_RUNS_MAXIMUM_READS)
    throw new InvalidConfigurationError("lens.defocus: this blur needs " + grouped(readsPerOutput) + " reads per site; above a kernel radius of " +
      DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES + " sites the limit is " + grouped(SITE_KERNEL_RUNS_MAXIMUM_READS) + ". Reduce the spherical aberration or the defocus.");
  return { radius, groupWeights, runStart, runV: Int32Array.from(runV), runU0: Int32Array.from(runU0), runU1: Int32Array.from(runU1),
    tapV: Int32Array.from(tapV), tapU: Int32Array.from(tapU), tapW: Float64Array.from(tapW), readsPerOutput };
}

/** A non-negative integer with comma thousands separators (no locale data). */
const grouped = (value: number): string => String(value).replace(/\B(?=(\d{3})+$)/gu, ",");

/** Which outputs of a tile row to compute: columns start, start + step, … (tile coordinates); null skips the row. */
export type SiteKernelRunsRowPattern = (tileRow: number) => { start: number; step: number } | null;

/**
 * Convolves a source rectangle with the runs: out(x, y) = Σ_t K(t)·source(x + R − t_u, y + R − t_v) for 0 ≤ x < width,
 * 0 ≤ y < height, the source holding (width + 2R) × (height + 2R) samples row-major. Each output is the sum over the weight
 * groups, in order, of the group weight times its runs' prefix differences (runs in order), then the single taps in order.
 * Outputs a `pattern` skips are 0. Samples are checked as `calculateIrradianceConvolution` checks them.
 */
export function convolveSiteKernelRuns(source: Float64Array, width: number, height: number, runs: SiteKernelRuns, pattern?: SiteKernelRunsRowPattern): Float64Array {
  const R = runs.radius, sw = width + 2 * R, sh = height + 2 * R, pw = sw + 1;
  if (source.length !== sw * sh) throw new InvalidConfigurationError("The run convolution's source must hold the tile and the kernel radius on every side.");
  // Row prefix sums from the source tile's left edge: P(r, k) = Σ_{c < k} source(c, r).
  const prefix = new Float64Array(pw * sh);
  for (let r = 0; r < sh; r++) {
    let sum = 0;
    const s = r * sw, p = r * pw;
    for (let c = 0; c < sw; c++) {
      const value = source[s + c]!;
      if (!(value >= 0 && value <= MAXIMUM_SAMPLE)) throw new InvalidConfigurationError("Irradiance samples must be finite, non-negative and within the declared magnitude.");
      sum += value;
      prefix[p + c + 1] = sum;
    }
  }
  const out = new Float64Array(width * height), group = new Float64Array(width);
  const { groupWeights, runStart, runV, runU0, runU1, tapV, tapU, tapW } = runs;
  for (let y = 0; y < height; y++) {
    const row = pattern ? pattern(y) : { start: 0, step: 1 };
    if (!row) continue;
    const { start, step } = row, o = y * width;
    for (let g = 0; g < groupWeights.length; g++) {
      group.fill(0);
      for (let k = runStart[g]!; k < runStart[g + 1]!; k++) {
        // Σ_{u = u0}^{u1} source(x + R − u, y + R − v) = P(y + R − v, x + R − u0 + 1) − P(y + R − v, x + R − u1).
        const p = (y + R - runV[k]!) * pw, hi = p + R - runU0[k]! + 1, lo = p + R - runU1[k]!;
        for (let x = start; x < width; x += step) group[x] = group[x]! + (prefix[hi + x]! - prefix[lo + x]!);
      }
      const w = groupWeights[g]!;
      for (let x = start; x < width; x += step) out[o + x] = out[o + x]! + w * group[x]!;
    }
    for (let k = 0; k < tapW.length; k++) {
      const s = (y + R - tapV[k]!) * sw + R - tapU[k]!, w = tapW[k]!;
      for (let x = start; x < width; x += step) out[o + x] = out[o + x]! + w * source[s + x]!;
    }
  }
  return out;
}

/**
 * The source of one tile: called with the source rectangle's origin and size (lattice coordinates; the tile plus the radius on
 * every side), it returns a function giving each field's samples, row-major, called once per field in order (so a caller can
 * share work between fields, such as one material lookup per point, and keep only one field's samples at a time).
 */
export type SiteKernelRunsTileSource = (x0: number, y0: number, width: number, height: number) => (field: number) => Float64Array;

export interface SiteKernelRunsLatticeInput {
  runs: SiteKernelRuns;
  /** Tile side T in lattice points (even, so CFA parity patterns are the same in every tile). */
  tile: number;
  fields: number;
  source: SiteKernelRunsTileSource;
  /** Per field, the outputs of each tile row to compute (absolute row parity is the tile row's, T being even). Default all. */
  pattern?: (field: number) => SiteKernelRunsRowPattern | undefined;
  /** Bytes of output tiles kept (least recently used dropped first). Default 64 MiB. */
  capacityBytes?: number;
  /**
   * #653: rows on demand. A divisor B of the tile side: a tile's rows are computed in fixed blocks of B rows when a value of
   * the block is first read (`source` is then called with the block's source rectangle, the block plus R on every side).
   * Default: whole tiles. The values are the same bits either way (see the module comment).
   */
  rowBlock?: number;
  /** Called with the duration in ms of each tile (diagnostics only). */
  onTile?: (milliseconds: number) => void;
}

/** Convolved fields on a lattice, by fixed tiles (see the module comment), computed on first use and kept within a byte budget. */
export interface SiteKernelRunsLattice {
  /** Field `field` of the convolved lattice at lattice point (x, y) (any integers). */
  valueAt(field: number, x: number, y: number): number;
  /** The fields of tile (tx, ty): T × T values each, row-major, for lattice points [tx·T, (tx + 1)·T) × [ty·T, (ty + 1)·T). Read only. */
  tileAt(tx: number, ty: number): readonly Float64Array[];
  /** Tiles computed so far (diagnostics). */
  readonly tilesComputed: number;
  /** Row blocks computed so far (#653, diagnostics; one per tile without `rowBlock`). */
  readonly rowBlocksComputed: number;
}

/** Tile key: tiles within ±2^20 of the origin in each direction. */
const tileKey = (tx: number, ty: number): number => (ty + 1048576) * 2097152 + tx + 1048576;

export function createSiteKernelRunsLattice(input: SiteKernelRunsLatticeInput): SiteKernelRunsLattice {
  const { runs, tile: T, fields } = input, R = runs.radius, B = input.rowBlock ?? T;
  if (!Number.isInteger(T) || T < 2 || T % 2 !== 0) throw new InvalidConfigurationError("The run lattice's tile side must be an even integer of 2 or more.");
  if (!Number.isInteger(B) || B < 1 || T % B !== 0) throw new InvalidConfigurationError("The run lattice's row block must divide its tile side.");
  const capacity = Math.max(1, Math.floor((input.capacityBytes ?? 64 * 1048576) / (fields * T * T * 8)));
  const blocks = T / B;
  /** A tile's fields (T × T values each) and which of its row blocks are computed. */
  interface Tile { values: Float64Array[]; done: Uint8Array; missing: number }
  const cache = new Map<number, Tile>();
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  let computed = 0, blocksComputed = 0, lastKey = NaN, last: Tile | undefined;
  function tileOf(tx: number, ty: number): Tile {
    const key = tileKey(tx, ty);
    if (key === lastKey) return last!;
    let t = cache.get(key);
    if (t) { cache.delete(key); cache.set(key, t); }
    else {
      t = { values: Array.from({ length: fields }, () => new Float64Array(T * T)), done: new Uint8Array(blocks), missing: blocks };
      cache.set(key, t);
      if (cache.size > capacity) cache.delete(cache.keys().next().value!);
      computed++;
    }
    lastKey = key; last = t;
    return t;
  }
  /** Computes row blocks [b0, b1) of tile (tx, ty) (all missing) from one source rectangle. */
  function fillBlocks(t: Tile, tx: number, ty: number, b0: number, b1: number): void {
    const started = input.onTile ? now() : 0, row0 = b0 * B, rows = (b1 - b0) * B;
    const fieldSource = input.source(tx * T - R, ty * T + row0 - R, T + 2 * R, rows + 2 * R);
    for (let f = 0; f < fields; f++) {
      const pattern = input.pattern?.(f);
      const out = convolveSiteKernelRuns(fieldSource(f), T, rows, runs, pattern && row0 !== 0 ? (row: number): ReturnType<SiteKernelRunsRowPattern> => pattern(row + row0) : pattern);
      t.values[f]!.set(out, row0 * T);
    }
    t.done.fill(1, b0, b1); t.missing -= b1 - b0; blocksComputed += b1 - b0;
    if (input.onTile) input.onTile(now() - started);
  }
  /** Tile (tx, ty) with its row blocks [b0, b1) computed (runs of missing blocks, each from one source rectangle). */
  function rowsOf(tx: number, ty: number, b0: number, b1: number): Tile {
    const t = tileOf(tx, ty);
    if (t.missing === 0) return t;
    for (let b = b0; b < b1;) {
      if (t.done[b]) { b++; continue; }
      let end = b + 1;
      while (end < b1 && !t.done[end]) end++;
      fillBlocks(t, tx, ty, b, end);
      b = end;
    }
    return t;
  }
  return {
    valueAt(field: number, x: number, y: number): number {
      const tx = Math.floor(x / T), ty = Math.floor(y / T), ly = y - ty * T, b = Math.floor(ly / B);
      return rowsOf(tx, ty, b, b + 1).values[field]![ly * T + x - tx * T]!;
    },
    tileAt: (tx: number, ty: number): readonly Float64Array[] => rowsOf(tx, ty, 0, blocks).values,
    get tilesComputed(): number { return computed; },
    get rowBlocksComputed(): number { return blocksComputed; }
  };
}
