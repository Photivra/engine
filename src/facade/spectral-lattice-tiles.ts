// SPDX-License-Identifier: Apache-2.0

/**
 * Spectral lattice tiles (2.27.0 plan, "Shared work"): a byte-bounded store of per-lattice-point spectral values in fixed
 * square tiles at absolute lattice positions, filled on demand row by row.
 *
 * What a tile holds is decided by the caller's `fill`: spectral radiance at the spectral nodes of each lattice point (N
 * values per point), possibly multiplied by a field factor or pre-integrated over a pixel aperture's query offsets. It must
 * never hold a value in which a channel response has been summed over the spectrum: the sites that read a tile integrate
 * its spectra against their own channel response when they are read, on every render path. The store adds nothing of its
 * own to the values; it only keeps and returns what `fill` wrote.
 *
 * Layout and determinism. Tile (tx, ty) of a key covers lattice points [tx·T, (tx + 1)·T) × [ty·T, (ty + 1)·T), T the tile
 * side. Its values are row-major, point by point, node by node: point (x, y) node n is at ((y − ty·T)·T + x − tx·T)·N + n.
 * Rows are filled only when asked for (`rows`), by runs of consecutive missing rows; `fill` must compute each point from its
 * absolute position alone, so a row's values do not depend on which other rows were asked for or in which order, and a tile
 * dropped from the store and computed again has the same bits.
 *
 * Bounds. The store keeps at most `capacityBytes` (each tile counts its values and its row flags), dropping the least
 * recently used tile first. A returned array stays valid after its tile is dropped (the store never reuses a dropped tile's
 * memory), but it no longer receives rows asked for later.
 */
import { InvalidConfigurationError } from "../core/configuration-error.js";

/** A store of fixed spectral lattice tiles, filled on demand. */
export interface SpectralLatticeTiles {
  /** Tile (tx, ty) of `key` (a lattice group and instant): tile × tile × nodes values, row-major, read only. */
  tileAt(key: number, tx: number, ty: number): Float64Array;
  /**
   * Rows [row0, row1) of that tile are filled; other rows may be zero until asked for. Returns the whole tile's array (the
   * same layout as `tileAt`); 0 ≤ row0 ≤ row1 ≤ tile.
   */
  rows(key: number, tx: number, ty: number, row0: number, row1: number): Float64Array;
  /** Drops every tile (counters are kept). */
  clear(): void;
  readonly tile: number;
  readonly nodes: number;
  /** Tiles created so far: first created, or created again after being dropped. */
  readonly tilesComputed: number;
  /** Tile rows filled so far (each `fill` call fills one or more). */
  readonly rowsComputed: number;
  /** Bytes the store holds now (values and row flags of the tiles it keeps); at most the capacity. */
  readonly bytesHeld: number;
}

export interface SpectralLatticeTilesInput {
  /** Tile side in lattice points (a positive integer). */
  tile: number;
  /** Values per lattice point: the spectral nodes (a positive integer). */
  nodes: number;
  /** Bytes the store may hold; at least one tile (tile² · nodes · 8 bytes plus `tile` bytes of row flags). */
  capacityBytes: number;
  /**
   * Writes the values of lattice points [x0, x0 + width) × [y0, y0 + height) of `key` into `out`, row-major, point by point,
   * node by node (`out` has width · height · nodes values and is zero on entry). Each point's values must depend on its
   * absolute position and `key` only. Spectral values only: no channel response summed over the spectrum.
   */
  fill(key: number, x0: number, y0: number, width: number, height: number, out: Float64Array): void;
}

interface Tile { key: number; position: number; values: Float64Array; filled: Uint8Array }

/** Tile position key: tiles within ±2^20 of the origin in each direction (as `createSiteKernelRunsLattice`). */
const LIMIT = 1048576;
const positionKey = (tx: number, ty: number): number => (ty + LIMIT) * 2097152 + tx + LIMIT;

export function createSpectralLatticeTiles(input: SpectralLatticeTilesInput): SpectralLatticeTiles {
  const fail = (message: string): never => { throw new InvalidConfigurationError("createSpectralLatticeTiles: " + message); };
  const { tile: T, nodes: N, capacityBytes, fill } = input;
  if (!Number.isInteger(T) || T < 1 || T > 4096) fail("tile must be an integer from 1 to 4096.");
  if (!Number.isInteger(N) || N < 1 || N > 4096) fail("nodes must be an integer from 1 to 4096.");
  if (typeof fill !== "function") fail("fill must be a function.");
  const tileBytes = T * T * N * 8 + T;
  if (typeof capacityBytes !== "number" || !(capacityBytes >= tileBytes) || !Number.isFinite(capacityBytes)) fail(`capacityBytes must be finite and at least one tile (${tileBytes} bytes).`);
  /** Tiles by key, then by position. */
  const byKey = new Map<number, Map<number, Tile>>();
  /** Every kept tile, least recently used first. */
  const order = new Set<Tile>();
  let tilesComputed = 0, rowsComputed = 0, bytesHeld = 0, last: Tile | undefined;

  function drop(t: Tile): void {
    order.delete(t);
    const tiles = byKey.get(t.key)!;
    tiles.delete(t.position);
    if (tiles.size === 0) byKey.delete(t.key);
    bytesHeld -= tileBytes;
    if (last === t) last = undefined;
  }

  function tileOf(key: number, tx: number, ty: number): Tile {
    if (!Number.isSafeInteger(key)) fail("key must be a safe integer.");
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || Math.abs(tx) >= LIMIT || Math.abs(ty) >= LIMIT) fail("tile indices must be integers within ±2^20.");
    const position = positionKey(tx, ty);
    if (last !== undefined && last.key === key && last.position === position) return last;
    let tiles = byKey.get(key), t = tiles?.get(position);
    if (t) { order.delete(t); order.add(t); }
    else {
      t = { key, position, values: new Float64Array(T * T * N), filled: new Uint8Array(T) };
      if (!tiles) { tiles = new Map(); byKey.set(key, tiles); }
      tiles.set(position, t); order.add(t); bytesHeld += tileBytes; tilesComputed++;
      for (const old of order) { if (bytesHeld <= capacityBytes) break; if (old !== t) drop(old); }
    }
    last = t;
    return t;
  }

  function rows(key: number, tx: number, ty: number, row0: number, row1: number): Float64Array {
    if (!Number.isInteger(row0) || !Number.isInteger(row1) || row0 < 0 || row1 > T || row0 > row1) fail(`rows must satisfy 0 ≤ row0 ≤ row1 ≤ ${T}.`);
    const t = tileOf(key, tx, ty), { values, filled } = t, stride = T * N;
    for (let r = row0; r < row1;) {
      if (filled[r]) { r++; continue; }
      let end = r + 1;
      while (end < row1 && !filled[end]) end++;
      try { fill(key, tx * T, ty * T + r, T, end - r, values.subarray(r * stride, end * stride)); }
      catch (error) { values.fill(0, r * stride, end * stride); throw error; }
      filled.fill(1, r, end);
      rowsComputed += end - r;
      r = end;
    }
    return values;
  }

  return {
    tileAt: (key, tx, ty) => rows(key, tx, ty, 0, T),
    rows,
    clear(): void { for (const t of [...order]) drop(t); },
    tile: T,
    nodes: N,
    get tilesComputed(): number { return tilesComputed; },
    get rowsComputed(): number { return rowsComputed; },
    get bytesHeld(): number { return bytesHeld; }
  };
}

/**
 * A store of spectral lattice tiles that also sums runs of a row (2.29.0, #749 and #750): the store above for the values, and per
 * tile row the sum of each block of `block` points and of the whole row (tile / block + 1 values per node and row: about a
 * sixth of the values' bytes at block = tile / 8), computed when a row is first summed and kept with its tile.
 *
 * `rowSum` adds a row's values over [x0, x1] at nodes [from, to): per tile it crosses, the row's sum when it covers the whole tile
 * row, otherwise the points before the first whole block one by one, the whole blocks' sums, then the points after them. A long
 * run costs one read per tile it crosses and at most 2·(block − 1) + tile / block more at its ends, instead of one per point
 * (block sums of a summed-area table: Crow, "Summed-area tables for texture mapping", SIGGRAPH 1984). Only sums are added, never
 * differences, so no term cancels: a bright point beside a dark run cannot cost the run its digits. Every block sum depends only
 * on its row's values (added left to right), so a run's sum has the same bits whatever was asked before. Spectral values only,
 * as the values themselves.
 *
 * Bytes: `capacityBytes` counts the values and the sums of every tile held (the values' store takes its share of it). The 16 tiles
 * summed last are also kept by reference, so that runs over them skip the store's lookups: up to that many tiles beyond the
 * capacity stay in memory after the store drops them (their filled rows stay valid; nothing is filled into them again). `tileAt`
 * reads through the same 16 tiles.
 */
export interface SpectralLatticeRowSumTiles extends SpectralLatticeTiles {
  /** Adds Σ_{x = x0 … x1} value(x, y)[n] of `key` into out[n] for n in [from, to); x0 ≤ x1, 0 ≤ from ≤ to ≤ nodes. */
  rowSum(key: number, x0: number, x1: number, y: number, out: Float64Array, from: number, to: number): void;
}

export interface SpectralLatticeRowSumTilesInput extends SpectralLatticeTilesInput {
  /** Points per block of the row sums: a positive divisor of `tile`. */
  block: number;
}

export function createSpectralLatticeRowSumTiles(input: SpectralLatticeRowSumTilesInput): SpectralLatticeRowSumTiles {
  const fail = (message: string): never => { throw new InvalidConfigurationError("createSpectralLatticeRowSumTiles: " + message); };
  const { tile: T, nodes: N, block: B, capacityBytes } = input;
  if (!Number.isInteger(B) || B < 1 || !(Number.isInteger(T) && T % B === 0)) fail("block must be a positive integer that divides tile.");
  // Per tile row: the block sums, then the row's sum.
  const blocks = T / B, sums = blocks + 1, valueBytes = T * T * N * 8 + T, sumBytes = T * sums * N * 8 + T;
  if (typeof capacityBytes !== "number" || !(capacityBytes >= valueBytes + sumBytes) || !Number.isFinite(capacityBytes))
    fail(`capacityBytes must be finite and at least one tile (${valueBytes + sumBytes} bytes).`);
  const store = createSpectralLatticeTiles({ tile: T, nodes: N, fill: input.fill, capacityBytes: capacityBytes * valueBytes / (valueBytes + sumBytes) });
  /** Each held tile's sums, by its values array (a dropped tile's array is never reused, so its sums go with it). */
  interface Sums { key: number; tx: number; ty: number; values: Float64Array; sums: Float64Array | null; summed: Uint8Array; whole: boolean }
  const extra = new WeakMap<Float64Array, Sums>(), recent: (Sums | undefined)[] = new Array<Sums | undefined>(16).fill(undefined);
  const slotOf = (key: number, tx: number, ty: number): number => (key * 31 + tx * 7 + ty * 13) & 15;
  /** The entry of a tile's values array, made the recent one of its slot. */
  function entry(key: number, tx: number, ty: number, values: Float64Array): Sums {
    let s = extra.get(values);
    if (!s) { s = { key, tx, ty, values, sums: null, summed: new Uint8Array(T), whole: false }; extra.set(values, s); }
    recent[slotOf(key, tx, ty)] = s;
    return s;
  }
  function tileAt(key: number, tx: number, ty: number): Float64Array {
    const s = recent[slotOf(key, tx, ty)];
    if (s !== undefined && s.key === key && s.tx === tx && s.ty === ty && s.whole) return s.values;
    const values = store.tileAt(key, tx, ty);
    entry(key, tx, ty, values).whole = true;
    return values;
  }
  function rowSum(key: number, x0: number, x1: number, y: number, out: Float64Array, from: number, to: number): void {
    if (!Number.isInteger(x0) || !Number.isInteger(x1) || !Number.isInteger(y) || !(x0 <= x1) || !(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from <= to && to <= N))
      fail("rowSum needs integer points x0 ≤ x1 and nodes 0 ≤ from ≤ to ≤ nodes.");
    const ty = Math.floor(y / T), row = y - ty * T, o = row * T * N, so = row * sums * N;
    for (let x = x0; x <= x1;) {
      const tx = Math.floor(x / T), left = tx * T, a = x - left, e = Math.min(x1, left + T - 1) - left;
      x = left + e + 1;
      let s = recent[slotOf(key, tx, ty)];
      // A row summed before was filled then: its values hold, so a recent tile needs no store lookup.
      if (s === undefined || s.key !== key || s.tx !== tx || s.ty !== ty || !s.summed[row]) s = entry(key, tx, ty, store.rows(key, tx, ty, row, row + 1));
      const S = s.sums ?? (s.sums = new Float64Array(T * sums * N)), values = s.values;
      if (!s.summed[row]) {
        for (let n = 0; n < N; n++) {
          let total = 0;
          for (let b = 0, i = o + n; b < blocks; b++) {
            let sum = 0;
            for (let k = 0; k < B; k++, i += N) sum += values[i]!;
            S[so + b * N + n] = sum;
            total += sum;
          }
          S[so + blocks * N + n] = total;
        }
        s.summed[row] = 1;
      }
      if (a === 0 && e === T - 1) { for (let n = from, v = so + blocks * N + from; n < to; n++, v++) out[n] = out[n]! + S[v]!; continue; }
      // The points before the first whole block, the whole blocks fb … lb, the points after them.
      const fb = Math.ceil(a / B), lb = Math.floor((e + 1) / B) - 1, head = fb <= lb ? fb * B - 1 : e;
      for (let v = o + a * N, end = o + (head + 1) * N; v < end; v += N) for (let n = from; n < to; n++) out[n] = out[n]! + values[v + n]!;
      if (fb > lb) continue;
      for (let b = fb; b <= lb; b++) for (let n = from, v = so + b * N + from; n < to; n++, v++) out[n] = out[n]! + S[v]!;
      for (let v = o + (lb + 1) * B * N, end = o + (e + 1) * N; v < end; v += N) for (let n = from; n < to; n++) out[n] = out[n]! + values[v + n]!;
    }
  }
  return {
    tileAt, rows: store.rows, clear(): void { recent.fill(undefined); store.clear(); }, rowSum, tile: T, nodes: N,
    get tilesComputed(): number { return store.tilesComputed; },
    get rowsComputed(): number { return store.rowsComputed; },
    get bytesHeld(): number { return store.bytesHeld / valueBytes * (valueBytes + sumBytes); }
  };
}
