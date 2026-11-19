// SPDX-License-Identifier: Apache-2.0

/**
 * #651: the display view's lens signal with camera rotation under a rolling shutter and a defocus disc, regrouped (loaded with the
 * lens signal, `display-view-lens-signal.ts`).
 *
 * What it computes. With a rolling shutter each native row y has its own temporal midpoints t_{y,i} (i < T). The lens signal's tap sum
 * forms, for site (x, y) of channel c and the disc D (the combined kernel being the in-focus kernel ⊛ D at every node and group),
 *   μ_c(x, y) = (1/T) Σ_i Σ_s D(s)·E_c((x, y) − s; t_{y,i}),
 * E_c(p; t) the in-focus expected electrons of channel c at site position p with the scene read at instant t (each lattice group's
 * points through the lens, the in-focus kernels: each node's diffraction kernel, or a unit tap). The disc is the same at every node,
 * group and instant, so it commutes with those sums (#564, #612): μ_c(x, y) = Σ_s D(s)·Ē_c((x, y) − s), Ē_c the mean of E_c over row
 * y's instants. That is the same sum in another order; only the rounding differs.
 *
 * Row blocks. Sites are computed in fixed blocks of `bandRows` rows × 128 columns at absolute positions (rows [b·h, b·h + h), columns
 * [128k, 128k + 128)). A block reads Ē at one set of instants over its rows and columns widened by the disc radius (all channels its rows
 * hold, from one lattice lookup per point), then convolves it with D by runs (`convolveSiteKernelRuns`, prefix sums from the block's
 * fixed left edge), each site taking its own channel. Every value depends only on its block and the request, so regions and parts
 * equal the whole view.
 *
 * - The full method (`bandRows` 1): a block is one row at that row's own instants: the tap sum regrouped (2R + 1 in-focus rows per row
 *   instead of (2R + 1)² taps per site).
 * - The fast method (#651 step 3, `motion.shutter.rolling/view-row-bands`): a block is a band of h rows (odd, at most 63) that all read the
 *   scene at the band's middle row's instants, so a band is one global-shutter problem: (h + 2R)/h in-focus rows per row. h is chosen
 *   ({@link rollingLensBands}) so that the in-focus image of any row moves by at most 1/128 site between its own instants and its
 *   band's (an approximation: a shift of the image by up to 1/128 site; reported in `view.defocus`). The plan's 1/32 site failed its
 *   go/no-go on a Siemens star through the frame centre (0.14 code RMS against the full method, the bound 0.1): the point-sampled
 *   in-focus image there is aliased, so the error does not shrink with the shift as a gradient bound would (0.106 at 1/64, 0.094 at 1/128).
 *
 * Caches (memory only): the convolved blocks, each site's own channel value (electrons formed at that site from the spectrum), least
 * recently used first within LENS_ROW_CACHE_BYTES. The in-focus rows are computed per block and released. No value is keyed by
 * material or level.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { convolveSiteKernelRuns, type SiteKernelRunsRowPattern } from "../optics/site-kernel-runs.js";
import type { PreparedDefocusImageSpaceGeometry } from "./defocus-image-space-provider.js";
import type { DisplayViewExpectedSignal, DisplayViewExpectedSignalInput } from "./expected-signal.js";

/** Block width (native columns) and the bytes of convolved blocks kept per signal. */
export const LENS_ROW_SEGMENT = 128, LENS_ROW_CACHE_BYTES = 32 * 1048576;
/** The fast method's band: at most this many rows, and at most this shift (sites) of the in-focus image between a row's instants and its band's. */
export const LENS_ROW_BAND_MAXIMUM_ROWS = 64, LENS_ROW_BAND_MAXIMUM_SHIFT_SITES = 1 / 128;

/** The fast method's band height (rows) and the largest image shift it measured (sites, at most 1/128). */
export interface RollingLensBands { rows: number; shiftSites: number }

/** Whether each native row ("rows"), each column ("columns") or no line ("none") of a rolling shutter has its own instants. */
export function rollingScanLines(timesAt: (x: number, y: number) => readonly number[], W: number, H: number): "rows" | "columns" | "none" {
  const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((t, i) => t === b[i]);
  const origin = timesAt(0, 0);
  if (H > 1 && !same(origin, timesAt(0, H - 1))) return "rows";
  if (W > 1 && !same(origin, timesAt(W - 1, 0))) return "columns";
  return "none";
}

/**
 * The fast method's band height for a row scan: the largest odd h ≤ 63 such that, for every band of h rows at its fixed position
 * (rows [b·h, b·h + h)), the in-focus image at the band's first and last rows (columns 0, W/2 and W − 1, every midpoint) moves by at
 * most 1/128 site between the row's own instants and those of the band's middle row b·h + ⌊h/2⌋. The image shift of sensor point s
 * between instants t and t′ is |s′ − s|, s′ the sensor point whose ray at t′ is s's ray at t (the lens geometry's own inverse). A
 * start value comes from the largest shift between neighbouring rows; each band is then checked and h lowered until all pass (h = 1
 * is every row at its own instants, the full method's blocks).
 */
export function rollingLensBands(geometry: PreparedDefocusImageSpaceGeometry, timesAt: (x: number, y: number) => readonly number[], W: number, H: number, pitch: number): RollingLensBands {
  if (H < 2) return { rows: 1, shiftSites: 0 };
  const mm = pitch / 1000, columns = [...new Set([0, W >> 1, W - 1])];
  const shift = (x: number, row: number, mid: number): number => {
    const own = timesAt(x, row), band = timesAt(x, mid), xMm = (x + 0.5 - W / 2) * mm, yMm = (row + 0.5 - H / 2) * mm;
    let worst = 0;
    for (let i = 0; i < own.length; i++) {
      if (own[i] === band[i]) continue;
      const s = geometry.sensorPointOf(geometry.lookOf(xMm, yMm, own[i]!), band[i]!);
      if (!s) return Infinity;
      worst = Math.max(worst, Math.hypot(s.x - xMm, s.y - yMm) / mm);
    }
    return worst;
  };
  let perRow = 0;
  for (const row of [...new Set([0, H >> 1, H - 2])]) for (const x of columns) perRow = Math.max(perRow, shift(x, row, row + 1));
  let rows = perRow > 0 ? 2 * Math.floor(LENS_ROW_BAND_MAXIMUM_SHIFT_SITES / perRow) + 1 : LENS_ROW_BAND_MAXIMUM_ROWS - 1;
  rows = Math.max(1, Math.min(LENS_ROW_BAND_MAXIMUM_ROWS - 1, rows));
  for (;;) {
    if (rows === 1) return { rows: 1, shiftSites: 0 };
    let worst = 0;
    for (let y0 = 0; y0 < H && worst <= LENS_ROW_BAND_MAXIMUM_SHIFT_SITES; y0 += rows) {
      const mid = Math.min(H - 1, y0 + (rows >> 1)), last = Math.min(H, y0 + rows) - 1;
      for (const x of columns) worst = Math.max(worst, shift(x, y0, mid), shift(x, last, mid));
    }
    if (worst <= LENS_ROW_BAND_MAXIMUM_SHIFT_SITES) return { rows, shiftSites: worst };
    rows = Math.max(1, rows - 2);
  }
}

/**
 * #651: whether the regrouped lens defocus costs less than the tap sum for one render under a global shutter whose sites lie in a native
 * rectangle of w × h sites, `sites` of them read at most, counted in reads per spectral node (the form of `regroupedDefocusCheaper`,
 * expected-signal.ts, with the temporal midpoints). The tap sum reads (2R_c + 1)² taps per site and midpoint; the fixed tiles compute the
 * in-focus signal of all three channels ((2R_f + 1)² taps per midpoint) over the rectangle widened by the disc radius R = R_c − R_f and
 * 192 sites per axis, then the disc by runs once (about 12R + 2 reads per channel without the nodes). Both are the same sum, so the
 * choice moves only the rounding. A rolling shutter that scans by rows takes the row blocks for every render (one method per request,
 * so a region equals the same pixels of the whole view bit for bit); this rule is not asked there.
 */
export function regroupedLensDefocusCheaper(w: number, h: number, sites: number, combinedRadius: number, inFocusRadius: number, nodes: number, midpoints: number): boolean {
  const R = combinedRadius - inFocusRadius, inFocusTaps = (2 * inFocusRadius + 1) ** 2, runs = (12 * R + 2) / nodes, widen = 2 * R + 192;
  return (w + widen) * (h + widen) * 3 * (inFocusTaps * midpoints + runs) < Math.min(sites, w * h) * (2 * combinedRadius + 1) ** 2 * midpoints;
}

/** What the row blocks need from the lens signal. */
export interface RollingRegroupedLensInput {
  /** The regrouped expected-signal input: the in-focus kernels in `kernels` and the disc in `largeKernel`. */
  input: DisplayViewExpectedSignalInput;
  /** Rows per block: 1 (every row at its own instants, the full method) or the fast method's band ({@link rollingLensBands}). */
  bandRows: number;
  /** The temporal midpoints of native row y (a row scan: every site of the row has them). */
  instantsOfRow(y: number): readonly number[];
  /**
   * Ē_c of the native site positions [x0, x0 + w) × [y0, y0 + h), row-major, with the scene read at `instants` (the mean over them),
   * for the channels whose bit is set in `channels` (bit c for channel c); the others are 0.
   */
  inFocus(x0: number, y0: number, w: number, h: number, instants: readonly number[], channels: number): Float64Array[];
  lookups(): number;
  pilot(u: number, v: number): number;
}

/** #651: the rolling-shutter lens signal by row blocks (see the module comment). */
export function createRollingRegroupedLensSignal(source: RollingRegroupedLensInput): DisplayViewExpectedSignal & { readonly blocksComputed: number } {
  const { input, instantsOfRow, inFocus } = source, maybeRuns = input.largeKernel;
  if (!maybeRuns || !input.kernels) throw new InvalidConfigurationError("The regrouped lens defocus needs the in-focus kernels and the disc as runs.");
  const runs = maybeRuns, W = input.nativeWidth, H = input.nativeHeight, S = LENS_ROW_SEGMENT, D = runs.radius, channelAt = input.channelAt;
  const h = Math.max(1, Math.min(LENS_ROW_BAND_MAXIMUM_ROWS, Math.floor(source.bandRows)));
  // Which sites of a block row hold channel c: the CFA's 2 × 2 period (block columns start at even positions; rows at any).
  const phase = [0, 1].map((py) => [0, 1].map((px) => channelAt(px, py)));
  const patterns = (c: number, y0: number): SiteKernelRunsRowPattern => (row: number) => {
    const p = phase[(y0 + row) & 1]!, even = p[0] === c, odd = p[1] === c;
    return even && odd ? { start: 0, step: 1 } : even ? { start: 0, step: 2 } : odd ? { start: 1, step: 2 } : null;
  };
  const blocks = new Map<number, Float64Array>(), capacity = Math.max(4, Math.floor(LENS_ROW_CACHE_BYTES / (S * h * 8)));
  let computed = 0, lastKey = -1, last: Float64Array = new Float64Array(0);
  function block(b: number, k: number): Float64Array {
    const y0 = b * h, y1 = Math.min(H, y0 + h), rows = y1 - y0, instants = instantsOfRow(Math.min(H - 1, y0 + (h >> 1)));
    let mask = 0;
    for (let y = y0; y < Math.min(y1, y0 + 2); y++) for (let x = 0; x < 2; x++) mask |= 1 << channelAt(x, y);
    // The in-focus rectangle: the block and the disc radius on every side; positions more than the radius beyond the raster feed no
    // site, so they stay 0 and are never mapped (the lens profiles are checked only up to the view's reach).
    const sx0 = k * S - D, sw = S + 2 * D, sy0 = y0 - D, sh = rows + 2 * D;
    const xa = Math.max(sx0, -D), xb = Math.min(sx0 + sw, W + D), ya = Math.max(sy0, -D), yb = Math.min(sy0 + sh, H + D);
    const part = inFocus(xa, ya, xb - xa, yb - ya, instants, mask), whole = xa === sx0 && xb === sx0 + sw && ya === sy0 && yb === sy0 + sh;
    const out = new Float64Array(S * rows);
    for (let c = 0; c < 3; c++) {
      if ((mask & (1 << c)) === 0) continue;
      let samples: Float64Array = part[c]!;
      if (!whole) {
        samples = new Float64Array(sw * sh);
        for (let y = ya; y < yb; y++) samples.set(part[c]!.subarray((y - ya) * (xb - xa), (y - ya + 1) * (xb - xa)), (y - sy0) * sw + xa - sx0);
      }
      // Sites of another channel are 0 in this channel's result, and x + 0 = x exactly.
      const convolved = convolveSiteKernelRuns(samples, S, rows, runs, patterns(c, y0));
      for (let i = 0; i < out.length; i++) out[i] = out[i]! + convolved[i]!;
    }
    computed++;
    return out;
  }
  return {
    get lookups(): number { return source.lookups(); },
    get blocksComputed(): number { return computed; },
    uniformMaterial: -1,
    tracksMaterial: false,
    cachesSites: false,
    marksReads: false,
    markReads(): void { /* never called: marksReads is false */ },
    window(): void { /* the blocks are fixed and kept for the signal; a window changes nothing */ },
    site(x: number, y: number): number {
      const b = Math.floor(y / h), k = Math.floor(x / S), key = b * 65536 + k;
      if (key !== lastKey) {
        let found = blocks.get(key);
        if (found) { blocks.delete(key); blocks.set(key, found); }
        else {
          found = block(b, k);
          blocks.set(key, found);
          if (blocks.size > capacity) blocks.delete(blocks.keys().next().value!);
        }
        lastKey = key; last = found;
      }
      return last[(y - b * h) * S + x - k * S]!;
    },
    pilot: source.pilot
  };
}
