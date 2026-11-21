// SPDX-License-Identifier: Apache-2.0
/**
 * #685 steps 2–3 (loaded on demand, in the Quality kit): the display view's fast method `lens.catalogue/view-offset-expansion` for a
 * catalogue lens's PSF on a chart or material scene with more than one query offset (the box pixel aperture, the four-spot filter).
 * The lens signal's pre-integrated lattice point B(p)[n] = Σ_o w_o·F(p + o)·L(p + o)[n] maps every query offset through the lens
 * (display-view-lens-signal.ts, `bPoint`). Here each offset's plane point (u, v) and field factor F come instead from a second-order
 * expansion about its nearest site centre c: value, central-difference gradient and Hessian of the 3 × 3 mapped site centres around
 * c, evaluated at the offset's displacement d from c (|d| ≤ ½ site per axis): q(d) = q₀ + ∇q·d + ½·dᵀH·d. Each offset still reads its
 * own material at its own (u, v); where all offsets of a point read one material m, B = (Σ_o w_o·F_o)·L_m per node. The mapped
 * centres and each centre's 18 coefficients are kept in rings tagged with the centre and the instant, so a centre's coefficients depend
 * only on its 3 × 3 centres: regions equal the whole view. Measured against the full method in
 * test/display-view-lens-offset-expansion.test.ts. Per-site integration is unchanged: B holds spectra only.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { DisplayViewLensSetup } from "./display-view-lens-signal.js";
import type { DisplayViewExpectedSignalInput } from "./expected-signal.js";

export interface OffsetExpansion {
  /** Sizes the rings to `rows` × `cols` centres per midpoint (powers of two; 0 rows keeps none). */
  resize(rows: number, cols: number): void;
  /**
   * B of lattice point (p, q) at midpoint ti and instant `time` into out[at..at + nodes); returns its single material or −1, with
   * `factor` = Σ_o w_o·F_o.
   */
  point(ti: number, p: number, q: number, out: Float64Array, at: number, time: number): number;
  readonly factor: number;
  /** Scene lookups so far. */
  readonly lookups: number;
}

/**
 * The expansion of one lens signal: the lens setup and the expected-signal input (a chart or material scene), the material spectra,
 * and the query offsets in the signal's order (group shift fx, fy; integer member offset ix, iy; weight).
 */
export function createOffsetExpansion(lens: DisplayViewLensSetup, input: DisplayViewExpectedSignalInput, spectra: readonly (Float64Array | undefined)[],
  offsets: readonly { fx: number; fy: number; ix: number; iy: number; weight: number }[]): OffsetExpansion {
  const nodes = input.wavelengthsNm.length, T = lens.times.length, rolling = lens.timesAt !== undefined, count = offsets.length, W = input.nativeWidth, H = input.nativeHeight;
  const { geometry, distanceM, metresPerFrameUnit } = lens, mmPerSite = lens.pitch / 1000, scene = input.scene as Extract<DisplayViewExpectedSignalInput["scene"], { kind: "materials" }>;
  // Each offset's nearest site centre (integer, from the lattice point) and its displacement from it, in sites.
  const cx = new Int32Array(count), cy = new Int32Array(count), dx = new Float64Array(count), dy = new Float64Array(count), w = new Float64Array(count);
  offsets.forEach((o, k) => { const rx = Math.round(o.fx), ry = Math.round(o.fy); cx[k] = o.ix + rx; cy[k] = o.iy + ry; dx[k] = o.fx - rx; dy[k] = o.fy - ry; w[k] = o.weight; });
  let rows = 0, cols = 0, mTagQ = new Int32Array(0), mTagP = new Int32Array(0), mTagT = new Float64Array(0), mValues = new Float64Array(0),
    cTagQ = new Int32Array(0), cTagP = new Int32Array(0), cTagT = new Float64Array(0), cValues = new Float64Array(0);
  const near = new Float64Array(27), loose = new Float64Array(18), material = new Int32Array(count), weight = new Float64Array(count);
  let factor = 0, lookups = 0, now = 0;
  const slot = (ti: number, p: number, q: number): number => (rows > 0 ? (ti * rows + (q & (rows - 1))) * cols + (p & (cols - 1)) : -1);
  /** Site centre (p, q) at midpoint ti through the lens (the lens signal's own mapping) into near[at..at + 2]: u, v, F. */
  function centre(ti: number, p: number, q: number, at: number): void {
    const k = slot(ti, p, q);
    if (k >= 0 && mTagQ[k] === q && mTagP[k] === p && (!rolling || mTagT[k] === now)) { near[at] = mValues[3 * k]!; near[at + 1] = mValues[3 * k + 1]!; near[at + 2] = mValues[3 * k + 2]!; return; }
    const look = geometry.lookOf((p + 0.5 - W / 2) * mmPerSite, (q + 0.5 - H / 2) * mmPerSite, now);
    if (!(look.z > 0)) throw new InvalidConfigurationError("simulateDisplayView: a query ray does not point toward the scene plane.");
    const s = distanceM / look.z, u = look.x * s / metresPerFrameUnit, v = look.y * s / metresPerFrameUnit;
    near[at] = u; near[at + 1] = v; near[at + 2] = look.factor;
    if (k >= 0) { mTagQ[k] = q; mTagP[k] = p; mTagT[k] = now; mValues[3 * k] = u; mValues[3 * k + 1] = v; mValues[3 * k + 2] = look.factor; }
  }
  /**
   * Centre (p, q)'s coefficients at midpoint ti, per quantity (u, v, F): value, ∂x, ∂y, ∂xx, ∂yy, ∂xy, into `coefficientsOf` at the
   * returned index (the coefficient ring, or the loose record when there is no ring).
   */
  let coefficientsOf = loose, lastP = 0, lastQ = 0, lastT = -1, lastNow = NaN, lastB = 0;
  function coefficients(ti: number, p: number, q: number): number {
    // The offsets of one lattice point often share their centre (a 2 × 2 box: all four): the last centre's coefficients are still in place.
    if (p === lastP && q === lastQ && ti === lastT && now === lastNow) return lastB;
    lastP = p; lastQ = q; lastT = ti; lastNow = now;
    return (lastB = centreCoefficients(ti, p, q));
  }
  function centreCoefficients(ti: number, p: number, q: number): number {
    const k = slot(ti, p, q);
    coefficientsOf = k >= 0 ? cValues : loose;
    if (k >= 0 && cTagQ[k] === q && cTagP[k] === p && (!rolling || cTagT[k] === now)) return 18 * k;
    // near[3·(3·(j + 1) + i + 1) + c]: centre (p + i, q + j), quantity c.
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) centre(ti, p + i, q + j, 3 * (3 * (j + 1) + i + 1));
    const out = coefficientsOf, b = k >= 0 ? 18 * k : 0;
    for (let c = 0; c < 3; c++) {
      // Rows j = −1, 0, 1 of the 3 × 3 centres start at near[c], near[9 + c], near[18 + c]; columns step by 3.
      const f0 = near[12 + c]!, xm = near[9 + c]!, xp = near[15 + c]!, ym = near[3 + c]!, yp = near[21 + c]!, o = b + 6 * c;
      out[o] = f0; out[o + 1] = (xp - xm) / 2; out[o + 2] = (yp - ym) / 2; out[o + 3] = xp - 2 * f0 + xm; out[o + 4] = yp - 2 * f0 + ym;
      out[o + 5] = (near[24 + c]! - near[18 + c]! - near[6 + c]! + near[c]!) / 4;
    }
    if (k >= 0) { cTagQ[k] = q; cTagP[k] = p; cTagT[k] = now; }
    return b;
  }
  return {
    get factor(): number { return factor; },
    get lookups(): number { return lookups; },
    resize(r: number, c: number): void {
      rows = r; cols = c;
      const n = T * r * c;
      mTagQ = new Int32Array(n).fill(-2147483648); mTagP = new Int32Array(n); mTagT = new Float64Array(n); mValues = new Float64Array(3 * n);
      cTagQ = new Int32Array(n).fill(-2147483648); cTagP = new Int32Array(n); cTagT = new Float64Array(n); cValues = new Float64Array(18 * n);
    },
    point(ti: number, p: number, q: number, out: Float64Array, at: number, time: number): number {
      let m = -2, f = 0;
      now = time;
      for (let o = 0; o < count; o++) {
        const b = coefficients(ti, p + cx[o]!, q + cy[o]!), e = coefficientsOf, x = dx[o]!, y = dy[o]!, xx = x * x / 2, yy = y * y / 2, xy = x * y;
        const u = e[b]! + e[b + 1]! * x + e[b + 2]! * y + e[b + 3]! * xx + e[b + 4]! * yy + e[b + 5]! * xy;
        const v = e[b + 6]! + e[b + 7]! * x + e[b + 8]! * y + e[b + 9]! * xx + e[b + 10]! * yy + e[b + 11]! * xy;
        const lm = scene.materialAt(u, v), wf = w[o]! * (e[b + 12]! + e[b + 13]! * x + e[b + 14]! * y + e[b + 15]! * xx + e[b + 16]! * yy + e[b + 17]! * xy);
        if (spectra[lm] === undefined) throw new InvalidConfigurationError("Unknown chart material.");
        lookups++; material[o] = lm; weight[o] = wf; f += wf;
        m = m === -2 || m === lm ? lm : -1;
      }
      out.fill(0, at, at + nodes);
      // One material: (Σ_o w_o·F_o)·L_m, one multiply per node; else the weighted sum in offset order.
      if (m >= 0) { const L = spectra[m]!; for (let n = 0; n < nodes; n++) out[at + n] = f * L[n]!; }
      else for (let o = 0; o < count; o++) { const L = spectra[material[o]!]!, wf = weight[o]!; for (let n = 0; n < nodes; n++) out[at + n] = out[at + n]! + wf * L[n]!; }
      factor = f;
      return m < 0 ? -1 : m;
    }
  };
}
