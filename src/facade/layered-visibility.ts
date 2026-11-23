// SPDX-License-Identifier: Apache-2.0

/**
 * The layered sum's visibility (2.29.0 group L0; the model is in `layered-scene-signal.ts`): which of a lattice point's rays
 * reach surface k past every nearer card. The ray through lattice point (x, y) and pupil point P = (Px, Py) (pupil-radius units,
 * native axes; the pupil is the unit disc) meets surface j at (x − ρ_j·Px, y − ρ_j·Py) (`layered-lattice-geometry.ts`).
 *
 * Rows of the pupil. Along a row of constant Py the ray points on surface j move along a line, so each card's part of the row
 * is one interval of Px; the row's open part for surface k is the pupil's chord, within surface k's own card (if it has one),
 * minus the intervals of the nearer cards. That part is exact. Between two consecutive Py values where a row meets a card's
 * edge ({@link LayeredVisibility.rowBreaks}), only the chord's end points change.
 *
 * Interface for the later 2.29.0 groups. Everything takes a lattice point (p, q) of a lattice group, and reads the cards only
 * through the geometry's `edges(group, p, q)`.
 * - {@link LayeredVisibility.rowIntervals}`(group, k, p, q, py, lo, hi, out)`: the open Px intervals of pupil row Py for
 *   surface k, within [lo, hi] (the caller's clip: the chord [−√(1 − Py²), √(1 − Py²)], a kernel tap's Px range, or both),
 *   sorted and disjoint, as [lo₀, hi₀, lo₁, hi₁, …] in `out`; returns their count. The edge sum of #749 (group LE) reads it
 *   (it does not edit this module); #744 (group LG) generalizes it to the half-planes of curved card edges in this module.
 * - {@link LayeredVisibility.rowBreaks}`(group, k, p, q, b0, b1, out)`: b0, b1 and every Py strictly between them where a row
 *   meets an edge of surface k's or a nearer card, sorted, in `out`; returns their count.
 * - {@link LayeredVisibility.share}`(group, k, p, q, a0, a1, b0, b1)`: V_k, the share of the pupil region [a0, a1] × [b0, b1]
 *   (a kernel tap's) whose rays reach surface k: 0 or 1 when the region's ray boxes are inside or outside the cards; otherwise
 *   integrated in rows of Py (the module comment of `layered-scene-signal.ts`; `occlusionSamples` rows per site of the widest
 *   footprint, midpoints, each row weighted by its height, the rows spread over the segments between the row breaks by length).
 */

import { layeredBoxRelation, type LayeredCardEdges, type LayeredLatticeGeometry } from "./layered-lattice-geometry.js";

/** Visibility of the surfaces at a lattice point (see the module comment). */
export interface LayeredVisibility {
  /** V_k(p, t): the share of pupil region [a0, a1] × [b0, b1] whose rays at lattice point (p, q) of a group reach surface k. */
  share(group: number, k: number, p: number, q: number, a0: number, a1: number, b0: number, b1: number): number;
  /** The open Px intervals of pupil row `py` for surface k within [lo, hi], as pairs in `out` (2 · surfaces values suffice); their count. */
  rowIntervals(group: number, k: number, p: number, q: number, py: number, lo: number, hi: number, out: Float64Array): number;
  /** b0, b1 and the card edges' Py strictly between them, sorted, in `out` (2 · surfaces + 2 values suffice); their count. */
  rowBreaks(group: number, k: number, p: number, q: number, b0: number, b1: number, out: Float64Array): number;
}

export interface LayeredVisibilityInput {
  geometry: LayeredLatticeGeometry;
  /** Occlusion rows per site of a pupil region's widest footprint (`LAYERED_OCCLUSION_SAMPLES`), validated by the caller. */
  occlusionSamples: number;
}

/** Most occlusion rows of one pupil region. */
const MAXIMUM_SAMPLES_PER_AXIS = 1024;

/** Internal: the visibility rows of a geometry (see the module comment). */
export function createLayeredVisibility(input: LayeredVisibilityInput): LayeredVisibility {
  const { geometry, occlusionSamples: samples } = input, K = geometry.surfaces, rho = geometry.blurRadiusSites;
  /** The Px interval [spanLo, spanHi] of row Py whose rays meet rectangle `rect` at scale s; false when the row misses it. */
  let spanLo = 0, spanHi = 0;
  const cutLo = new Float64Array(K), cutHi = new Float64Array(K), breakBuffer = new Float64Array(2 * K + 2);
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
    if (own !== null && !intervalOf(own, rho[k]!, x, y, py)) return -1;
    if (own !== null) { lo = Math.max(lo, spanLo); hi = Math.min(hi, spanHi); if (!(hi > lo)) return -1; }
    clipLo = lo; clipHi = hi;
    // Nearer cards remove their intervals: sorted by start.
    let count = 0;
    for (let j = 0; j < k; j++) if (intervalOf(r[j]!, rho[j]!, x, y, py) && spanHi > lo && spanLo < hi) { cutLo[count] = spanLo; cutHi[count] = spanHi; count++; }
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
  function share(group: number, k: number, x: number, y: number, a0: number, a1: number, b0: number, b1: number): number {
    const r = geometry.edges(group, x, y);
    // The widest footprint, in sites, of the region's rays on a rectangle they cross.
    let across = 0;
    const span = Math.max(a1 - a0, b1 - b0);
    for (let j = 0; j <= k; j++) {
      const rect = r[j]!;
      if (rect === null) continue;
      const s = rho[j]!, xa = x - s * a0, xb = x - s * a1, ya = y - s * b0, yb = y - s * b1;
      const rel = layeredBoxRelation(rect, Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb));
      if (j === k ? rel === 0 : rel === 1) return 0;
      if (rel === 2) across = Math.max(across, Math.abs(s) * span, 1e-300);
    }
    if (across === 0) return 1;
    // n rows per site of that footprint (n = occlusionSamples), at least n per region.
    const m = Math.min(MAXIMUM_SAMPLES_PER_AXIS, samples * Math.max(1, Math.ceil(across - 1e-9)));
    // Rows of the region: along each row the open part is exact (the pupil's chord and each rectangle's interval in Px). The rows
    // are split at every rectangle's edge in Py, so within a segment only the chord changes, and rows are spread over the
    // segments by length (midpoints, each row weighted by its height).
    const breaks = breaksOf(r, k, y, b0, b1, breakBuffer), cuts = breakBuffer;
    let kept = 0, visible = 0;
    for (let pass = 0; pass < 2 && !(kept > 0); pass++) for (let segment = 0; segment + 1 < breaks; segment++) {
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
    rowBreaks: (group, k, p, q, b0, b1, out) => breaksOf(geometry.edges(group, p, q), k, q, b0, b1, out)
  };
}
