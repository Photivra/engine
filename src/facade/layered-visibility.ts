// SPDX-License-Identifier: Apache-2.0

/**
 * The layered sum's visibility (2.29.0 groups L0 and LG; the model is in `layered-scene-signal.ts`): which of a lattice point's
 * rays reach surface k past every nearer card. The ray through lattice point (x, y) and pupil point P = (Px, Py) (pupil-radius
 * units, native axes; the pupil is the unit disc) meets surface j's image at (x − ρ_j·Px, y − ρ_j·Py) (`layered-lattice-geometry.ts`).
 *
 * Rows of the pupil. Along a row of constant Py the ray points on surface j move along a line, so each card's part of the row
 * is one interval of Px (a card is an intersection of half-planes: the box on the planar map, the tangent parallelogram with a
 * lens map); the row's open part for surface k is the pupil's chord, within surface k's own card (if it has one), minus the
 * intervals of the nearer cards. That part is exact for the cards as the geometry gives them. Every interval end is a line in
 * (Py, Px) (one card edge each); between two consecutive breaks ({@link LayeredVisibility.rowBreaks}: where a row meets a card
 * edge that is constant in Py, and where two edge lines cross) the order of all these lines is fixed, so the open intervals keep
 * their edges and their ends are linear in Py (constant on the planar map, where only the chord's ends change).
 *
 * Interface for the later 2.29.0 groups. Everything takes a lattice point (p, q) of a lattice group, and reads the cards only
 * through the geometry's `edges(group, p, q)`.
 * - {@link LayeredVisibility.rowIntervals}`(group, k, p, q, py, lo, hi, out)`: the open Px intervals of pupil row Py for
 *   surface k, within [lo, hi] (the caller's clip: the chord [−√(1 − Py²), √(1 − Py²)], a kernel tap's Px range, or both; ±Infinity
 *   allowed), sorted and disjoint, as [lo₀, hi₀, lo₁, hi₁, …] in `out` (at most {@link LayeredVisibility.rowIntervalsCapacity}
 *   values); returns their count. The edge sum of #749 (group LE) reads it (it does not edit this module).
 * - {@link LayeredVisibility.rowBreaks}`(group, k, p, q, b0, b1, out)`: b0, b1 and every break strictly between them, sorted, in
 *   `out` (at most {@link LayeredVisibility.rowBreaksCapacity} values); returns their count.
 * - {@link LayeredVisibility.rowsHold}`(group, p, q)`: whether the point's rows hold for every tap: false with a lens map where an
 *   edge that crosses the point's reach deviates from its tangent by more than `LAYERED_EDGE_CURVATURE_TOLERANCE_SITES`. Then the
 *   point's sum must take `share` per kernel tap (which takes each tap's own tangents), not runs over `rowIntervals`.
 * - {@link LayeredVisibility.share}`(group, k, p, q, a0, a1, b0, b1)`: V_k, the share of the pupil region [a0, a1] × [b0, b1]
 *   (a kernel tap's) whose rays reach surface k: 0 or 1 when the region's ray boxes are inside or outside the cards; otherwise
 *   integrated in rows of Py (the module comment of `layered-scene-signal.ts`; `occlusionSamples` rows per site of the widest
 *   footprint, midpoints, each row weighted by its height, the rows spread over the segments between the row breaks by length).
 *   The rows of one region are clamped at 1024: a footprint wider than 1024 / `occlusionSamples` sites (64 at the full method's
 *   16) gets fewer rows per site than stated. With a lens map and `rowsHold` false the region's cards are each tangent at the
 *   region's own footprint on them (`geometry.edgesNear`).
 */

import { LAYERED_EDGE_CURVATURE_TOLERANCE_SITES, layeredBoxRelation, type LayeredCardEdges, type LayeredLatticeGeometry } from "./layered-lattice-geometry.js";

/** Visibility of the surfaces at a lattice point (see the module comment). */
export interface LayeredVisibility {
  /** V_k(p, t): the share of pupil region [a0, a1] × [b0, b1] whose rays at lattice point (p, q) of a group reach surface k. */
  share(group: number, k: number, p: number, q: number, a0: number, a1: number, b0: number, b1: number): number;
  /** The open Px intervals of pupil row `py` for surface k within [lo, hi], as pairs in `out` (`rowIntervalsCapacity` values suffice); their count. */
  rowIntervals(group: number, k: number, p: number, q: number, py: number, lo: number, hi: number, out: Float64Array): number;
  /** b0, b1 and the rows' breaks strictly between them, sorted, in `out` (`rowBreaksCapacity` values suffice); their count. */
  rowBreaks(group: number, k: number, p: number, q: number, b0: number, b1: number, out: Float64Array): number;
  /** Values `rowIntervals` writes at most: 2 · surfaces. */
  readonly rowIntervalsCapacity: number;
  /**
   * Values `rowBreaks` writes at most: 2 · surfaces + 2 on the planar map; with a lens map 2 + L + L(L − 1)/2 for the L = 4 · surfaces
   * edge lines (each line's own break, every crossing of two lines).
   */
  readonly rowBreaksCapacity: number;
  /** Whether the point's rows (`rowIntervals`, `rowBreaks`) hold for every kernel tap; always true on the planar map (see the module comment). */
  rowsHold(group: number, p: number, q: number): boolean;
}

export interface LayeredVisibilityInput {
  geometry: LayeredLatticeGeometry;
  /** Occlusion rows per site of a pupil region's widest footprint (`LAYERED_OCCLUSION_SAMPLES`), validated by the caller. */
  occlusionSamples: number;
}

/** Most occlusion rows of one pupil region. */
const MAXIMUM_SAMPLES_PER_AXIS = 1024;
/** With a lens map: most times a region whose cards curve within it is split in four (at most 4⁶ pieces). */
const MAXIMUM_SPLIT_DEPTH = 6;

/** Internal: the visibility rows of a geometry (see the module comment). */
export function createLayeredVisibility(input: LayeredVisibilityInput): LayeredVisibility {
  const { geometry, occlusionSamples: samples } = input, K = geometry.surfaces, rho = geometry.blurRadiusSites, planar = geometry.planar;
  // With a lens map: L edge lines; each has its own break and crosses every other once, and share also adds its clip's crossings.
  const L = 4 * K, breaksCapacity = planar ? 2 * K + 2 : 2 + L + L * (L - 1) / 2;
  /** The Px interval [spanLo, spanHi] of row Py whose rays meet rectangle `rect` at scale s; false when the row misses it. */
  let spanLo = 0, spanHi = 0;
  const cutLo = new Float64Array(K), cutHi = new Float64Array(K), breakBuffer = new Float64Array(planar ? 2 * K + 2 : breaksCapacity + 2 * L);
  /** The same for a card of four half-planes a·X + b·Y + c ≥ 0: the ray point (x − s·Px, y − s·Py) is inside where a·s·Px ≤ a·x + b·(y − s·Py) + c. */
  function intervalOfHalfPlanes(e: LayeredCardEdges, s: number, x: number, y: number, py: number): boolean {
    let lo = -Infinity, hi = Infinity;
    for (let i = 0; i < 16; i += 4) {
      const a = e[i]!, w = a * x + e[i + 1]! * (y - s * py) + e[i + 2]!, as = a * s;
      if (as === 0) { if (!(w >= 0)) return false; } else if (as > 0) hi = Math.min(hi, w / as); else lo = Math.max(lo, w / as);
    }
    if (!(hi >= lo)) return false;
    spanLo = lo; spanHi = hi;
    return true;
  }
  const interval = planar ? intervalOf : intervalOfHalfPlanes;
  function intervalOf(rect: LayeredCardEdges, s: number, x: number, y: number, py: number): boolean {
    const ry = y - s * py;
    if (!(ry >= rect[1]! && ry <= rect[3]!)) return false;
    if (s === 0) { if (!(x >= rect[0]! && x <= rect[2]!)) return false; spanLo = -Infinity; spanHi = Infinity; return true; }
    const e0 = (x - rect[0]!) / s, e1 = (x - rect[2]!) / s;
    spanLo = Math.min(e0, e1); spanHi = Math.max(e0, e1);
    return true;
  }
  /**
   * Row Py within [lo, hi]: clips [lo, hi] to surface k's own card into `clipLo`/`clipHi` and gathers the nearer cards' intervals
   * that overlap it, sorted by start, into cutLo/cutHi. Returns their count, or −1 when nothing of the row is left.
   */
  let clipLo = 0, clipHi = 0;
  function rowCuts(r: readonly (LayeredCardEdges | null)[], k: number, x: number, y: number, py: number, lo: number, hi: number): number {
    // The own rectangle: X0 ≤ x − ρ_k·Px ≤ X1 and Y0 ≤ y − ρ_k·Py ≤ Y1.
    const own = r[k]!;
    if (own !== null && !interval(own, rho[k]!, x, y, py)) return -1;
    if (own !== null) { lo = Math.max(lo, spanLo); hi = Math.min(hi, spanHi); if (!(hi > lo)) return -1; }
    clipLo = lo; clipHi = hi;
    // Nearer cards remove their intervals: sorted by start.
    let count = 0;
    for (let j = 0; j < k; j++) if (interval(r[j]!, rho[j]!, x, y, py) && spanHi > lo && spanLo < hi) { cutLo[count] = spanLo; cutHi[count] = spanHi; count++; }
    for (let a = 1; a < count; a++) for (let b = a; b > 0 && cutLo[b - 1]! > cutLo[b]!; b--) {
      const tl = cutLo[b]!, th = cutHi[b]!; cutLo[b] = cutLo[b - 1]!; cutHi[b] = cutHi[b - 1]!; cutLo[b - 1] = tl; cutHi[b - 1] = th;
    }
    return count;
  }
  /** The open length of row Py within [lo, hi]: what is left of it once the nearer cards' intervals are removed (0 if none). */
  function rowOpen(r: readonly (LayeredCardEdges | null)[], k: number, x: number, y: number, py: number, lo: number, hi: number): number {
    const count = rowCuts(r, k, x, y, py, lo, hi);
    if (count < 0) return 0;
    lo = clipLo; hi = clipHi;
    let open = hi - lo;
    if (count > 0) {
      let at = lo;
      for (let c = 0; c < count; c++) {
        const cl = Math.max(cutLo[c]!, at), ch = Math.min(cutHi[c]!, hi);
        if (ch > cl) { open -= ch - cl; at = ch; }
      }
    }
    return open;
  }
  function breaksOf(r: readonly (LayeredCardEdges | null)[], k: number, y: number, b0: number, b1: number, out: Float64Array): number {
    let breaks = 0;
    out[breaks++] = b0; out[breaks++] = b1;
    for (let j = 0; j <= k; j++) {
      const rect = r[j]!, s = rho[j]!;
      if (rect === null || s === 0) continue;
      for (const e of [(y - rect[1]!) / s, (y - rect[3]!) / s]) if (e > b0 && e < b1) out[breaks++] = e;
    }
    out.subarray(0, breaks).sort();
    return breaks;
  }
  /**
   * With a lens map: b0, b1 and, strictly between them, each Px-free edge's Py and every crossing of two edge lines Px = α + β·Py of
   * surface k's and the nearer cards; with a clip [clipLo, clipHi] (share) only crossings within it, and each line's crossings of
   * the clip's ends. Sorted, in `out`; returns the count.
   */
  const alpha = new Float64Array(L), beta = new Float64Array(L);
  function breaksOfHalfPlanes(r: readonly (LayeredCardEdges | null)[], k: number, x: number, y: number, b0: number, b1: number, out: Float64Array, clipLo: number, clipHi: number): number {
    let breaks = 0, lines = 0;
    out[breaks++] = b0; out[breaks++] = b1;
    for (let j = 0; j <= k; j++) {
      const e = r[j]!, s = rho[j]!;
      if (e === null || s === 0) continue;
      for (let i = 0; i < 16; i += 4) {
        const a = e[i]!, b = e[i + 1]!, w0 = a * x + b * y + e[i + 2]!;
        if (a === 0) { if (b !== 0) { const py = w0 / (b * s); if (py > b0 && py < b1) out[breaks++] = py; } continue; }
        alpha[lines] = w0 / (a * s); beta[lines] = -b / a; lines++;
      }
    }
    const clipped = clipLo > -Infinity || clipHi < Infinity;
    for (let i = 0; i < lines; i++) {
      const ai = alpha[i]!, bi = beta[i]!;
      for (let j = i + 1; j < lines; j++) {
        const db = bi - beta[j]!;
        if (db === 0) continue;
        const py = (alpha[j]! - ai) / db;
        if (!(py > b0 && py < b1)) continue;
        if (clipped) { const px = ai + bi * py; if (!(px >= clipLo && px <= clipHi)) continue; }
        out[breaks++] = py;
      }
      if (clipped && bi !== 0) for (const c of [clipLo, clipHi]) { const py = (c - ai) / bi; if (py > b0 && py < b1) out[breaks++] = py; }
    }
    out.subarray(0, breaks).sort();
    return breaks;
  }
  /** rowsHold of the last point asked. */
  let holdGroup = -1, holdP = NaN, holdQ = NaN, hold = true;
  function rowsHold(group: number, p: number, q: number): boolean {
    if (planar) return true;
    if (group === holdGroup && p === holdP && q === holdQ) return hold;
    const r = geometry.edges(group, p, q), reach = geometry.reachSites;
    hold = true;
    for (let j = 0; j < K && hold; j++) {
      const e = r[j]!;
      if (e === null) continue;
      const h = reach[j]!, x0 = p - h, x1 = p + h, y0 = q - h, y1 = q + h;
      for (let i = 0; i < 16; i += 4) {
        const a = e[i]!, b = e[i + 1]!, c = e[i + 2]!, d = e[i + 3]!;
        const high = c + Math.max(a * x0, a * x1) + Math.max(b * y0, b * y1), low = c + Math.min(a * x0, a * x1) + Math.min(b * y0, b * y1);
        // An edge that may cross the reach box and deviates more than the tolerance there.
        if (high >= -d && low < d && !(d <= LAYERED_EDGE_CURVATURE_TOLERANCE_SITES)) { hold = false; break; }
      }
    }
    holdGroup = group; holdP = p; holdQ = q;
    return hold;
  }
  // The row sums of a region (or of the pieces of one): Σ h·(chord within the region) and Σ h·(open part).
  let kept = 0, visible = 0;
  /**
   * Adds the rows of region [a0, a1] × [b0, b1] (m rows over its Py range, spread over the segments between its `breaks` in
   * `cuts`) to `kept` and `visible`: pass 0 within the pupil's chord, pass 1 the region as it is.
   */
  function rowsOf(r: readonly (LayeredCardEdges | null)[], k: number, x: number, y: number, a0: number, a1: number, b0: number, b1: number, m: number, pass: number,
    breaks: number, cuts: Float64Array): void {
    for (let segment = 0; segment + 1 < breaks; segment++) {
      const c0 = cuts[segment]!, c1 = cuts[segment + 1]!;
      if (!(c1 > c0)) continue;
      const rows = Math.max(1, Math.round(m * (c1 - c0) / (b1 - b0))), h = (c1 - c0) / rows;
      for (let sj = 0; sj < rows; sj++) {
        const py = c0 + (sj + 0.5) * h;
        let lo = a0, hi = a1;
        if (pass === 0) {
          const w2 = 1 - py * py;
          if (!(w2 > 0)) continue;
          const w = Math.sqrt(w2);
          lo = Math.max(lo, -w); hi = Math.min(hi, w);
        }
        if (!(hi > lo)) continue;
        kept += h * (hi - lo);
        visible += h * rowOpen(r, k, x, y, py, lo, hi);
      }
    }
  }
  /** The widest footprint, in sites, of the region's rays on a card they cross; −1 when the relations decide V (`decided`: 0 or 1). */
  let decided = 0;
  function acrossOf(r: readonly (LayeredCardEdges | null)[], k: number, x: number, y: number, a0: number, a1: number, b0: number, b1: number): number {
    let across = 0;
    const span = Math.max(a1 - a0, b1 - b0);
    for (let j = 0; j <= k; j++) {
      const rect = r[j]!;
      if (rect === null) continue;
      const s = rho[j]!, xa = x - s * a0, xb = x - s * a1, ya = y - s * b0, yb = y - s * b1;
      const rel = layeredBoxRelation(rect, Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb));
      if (j === k ? rel === 0 : rel === 1) { decided = 0; return -1; }
      if (rel === 2) across = Math.max(across, Math.abs(s) * span, 1e-300);
    }
    if (across === 0) { decided = 1; return -1; }
    return across;
  }
  /** With a lens map and rows that do not hold: each piece's cards, tangent at the piece's own footprint on them. */
  const tapCards: (LayeredCardEdges | null)[] = Array.from({ length: K }, () => null), tapBuffers = Array.from({ length: K }, () => new Float64Array(16));
  /**
   * Adds a piece of a region to `kept` and `visible` (one pass): its cards tangent at its footprints; a piece where an edge that
   * may cross a footprint deviates by more than the tolerance is split in four (at most {@link MAXIMUM_SPLIT_DEPTH} times, and not
   * below a footprint of an eighth of a site, where only the map's blow-up near 90° keeps an edge's deviation above the tolerance).
   */
  function piece(group: number, k: number, x: number, y: number, a0: number, a1: number, b0: number, b1: number, depth: number, pass: number): void {
    // Pass 0 counts rays in the pupil only: a piece that misses it adds nothing, and the footprints are those of its part in the
    // pupil's square (so a tap region reaching past the pupil is not judged by rays it does not have).
    let ca0 = a0, ca1 = a1, cb0 = b0, cb1 = b1;
    if (pass === 0) {
      ca0 = Math.max(a0, -1); ca1 = Math.min(a1, 1); cb0 = Math.max(b0, -1); cb1 = Math.min(b1, 1);
      const nx = Math.min(Math.max(0, ca0), ca1), ny = Math.min(Math.max(0, cb0), cb1);
      if (!(ca1 > ca0 && cb1 > cb0) || nx * nx + ny * ny >= 1) return;
    }
    const pcx = (ca0 + ca1) / 2, pcy = (cb0 + cb1) / 2, half = Math.max(ca1 - ca0, cb1 - cb0) / 2;
    let split = false;
    for (let j = 0; j <= k && !split; j++) {
      const own = geometry.edges(group, x, y)[j]!;
      if (own === null) { tapCards[j] = null; continue; }
      const cx = x - rho[j]! * pcx, cy = y - rho[j]! * pcy, h = Math.abs(rho[j]!) * half;
      // The point's own half-planes where they are certain over this footprint (their deviation included): no new tangents.
      if (layeredBoxRelation(own, cx - h, cy - h, cx + h, cy + h) !== 2) { tapCards[j] = own; continue; }
      const e = geometry.edgesNear(group, j, cx, cy, h, tapBuffers[j]!);
      tapCards[j] = e;
      // Split while the footprint is wider than an eighth of a site, at most MAXIMUM_SPLIT_DEPTH times.
      if (depth < MAXIMUM_SPLIT_DEPTH && h > 0.125) for (let i = 0; i < 16; i += 4) {
        const a = e[i]!, b = e[i + 1]!, c = e[i + 2]!, d = e[i + 3]!;
        const high = c + Math.abs(a) * h + Math.abs(b) * h + a * cx + b * cy, low = c - Math.abs(a) * h - Math.abs(b) * h + a * cx + b * cy;
        // A piece at the horizon (no deviation: a sample sees no scene) is not split: the horizon rule is approximate anyway.
        if (high >= -d && low < d && d > LAYERED_EDGE_CURVATURE_TOLERANCE_SITES && d < Infinity) { split = true; break; }
      }
    }
    if (split) {
      const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
      piece(group, k, x, y, a0, am, b0, bm, depth + 1, pass); piece(group, k, x, y, am, a1, b0, bm, depth + 1, pass);
      piece(group, k, x, y, a0, am, bm, b1, depth + 1, pass); piece(group, k, x, y, am, a1, bm, b1, depth + 1, pass);
      return;
    }
    const across = acrossOf(tapCards, k, x, y, a0, a1, b0, b1);
    const m = across < 0 ? samples : Math.min(MAXIMUM_SAMPLES_PER_AXIS, samples * Math.max(1, Math.ceil(across - 1e-9)));
    if (across >= 0) { rowsOf(tapCards, k, x, y, a0, a1, b0, b1, m, pass, breaksOfHalfPlanes(tapCards, k, x, y, b0, b1, breakBuffer, a0, a1), breakBuffer); return; }
    // Decided by the relations (all open or all hidden): the piece's chord rows only.
    const h = (b1 - b0) / m;
    let area = 0;
    for (let sj = 0; sj < m; sj++) {
      const py = b0 + (sj + 0.5) * h;
      let lo = a0, hi = a1;
      if (pass === 0) { const w2 = 1 - py * py; if (!(w2 > 0)) continue; const w = Math.sqrt(w2); lo = Math.max(lo, -w); hi = Math.min(hi, w); }
      if (hi > lo) area += h * (hi - lo);
    }
    kept += area;
    if (decided === 1) visible += area;
  }
  function share(group: number, k: number, x: number, y: number, a0: number, a1: number, b0: number, b1: number): number {
    const r = geometry.edges(group, x, y);
    if (!planar && !rowsHold(group, x, y)) {
      kept = 0; visible = 0;
      for (let pass = 0; pass < 2 && !(kept > 0); pass++) piece(group, k, x, y, a0, a1, b0, b1, 0, pass);
      return kept > 0 ? Math.min(1, Math.max(0, visible / kept)) : 0;
    }
    // The widest footprint, in sites, of the region's rays on a rectangle they cross.
    const across = acrossOf(r, k, x, y, a0, a1, b0, b1);
    if (across < 0) return decided;
    // n rows per site of that footprint (n = occlusionSamples), at least n per region.
    const m = Math.min(MAXIMUM_SAMPLES_PER_AXIS, samples * Math.max(1, Math.ceil(across - 1e-9)));
    // Rows of the region: along each row the open part is exact (the pupil's chord and each card's interval in Px). The rows
    // are split at every break in Py, so within a segment the open intervals keep their edges, and rows are spread over the
    // segments by length (midpoints, each row weighted by its height).
    const breaks = planar ? breaksOf(r, k, y, b0, b1, breakBuffer) : breaksOfHalfPlanes(r, k, x, y, b0, b1, breakBuffer, a0, a1);
    kept = 0; visible = 0;
    for (let pass = 0; pass < 2 && !(kept > 0); pass++) rowsOf(r, k, x, y, a0, a1, b0, b1, m, pass, breaks, breakBuffer);
    return kept > 0 ? Math.min(1, Math.max(0, visible / kept)) : 0;
  }
  return {
    share,
    rowIntervals(group, k, p, q, py, lo, hi, out): number {
      const count = rowCuts(geometry.edges(group, p, q), k, p, q, py, lo, hi);
      if (count < 0) return 0;
      let at = clipLo, intervals = 0;
      for (let c = 0; c < count; c++) {
        const cl = Math.max(cutLo[c]!, at), ch = Math.min(cutHi[c]!, clipHi);
        if (!(ch > cl)) continue;
        if (cl > at) { out[2 * intervals] = at; out[2 * intervals + 1] = cl; intervals++; }
        at = ch;
      }
      if (clipHi > at) { out[2 * intervals] = at; out[2 * intervals + 1] = clipHi; intervals++; }
      return intervals;
    },
    rowBreaks: (group, k, p, q, b0, b1, out) => planar ? breaksOf(geometry.edges(group, p, q), k, q, b0, b1, out) :
      breaksOfHalfPlanes(geometry.edges(group, p, q), k, p, q, b0, b1, out, -Infinity, Infinity),
    rowIntervalsCapacity: 2 * K,
    rowBreaksCapacity: breaksCapacity,
    rowsHold
  };
}
