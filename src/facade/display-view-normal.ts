// SPDX-License-Identifier: Apache-2.0

/**
 * The display view's normal-distribution helpers (shared by the default path, display-view.ts, and the on-demand coupled
 * rendering steps, display-view-rendering.ts, which must not be imported statically by the default path).
 */

import { portableCosTwoPi, portableExp } from "../core/portable-math.js";

/** Beyond this many standard deviations from a clip level the clip changes the moments by less than 1e-15 of σ². */
export const CLIP_REACH_SIGMA = 8.5;
/** Standard normal density. */
export function phi(z: number): number { return 0.3989422804014327 * portableExp(-0.5 * z * z); }
/**
 * Standard normal distribution function, Φ(z) = 1 − Q(z), with Q from the rational approximation 26.2.17 of
 * Abramowitz & Stegun, Handbook of Mathematical Functions (NBS AMS 55, 1964; free, US government work):
 * absolute error below 7.5e-8.
 */
export function bigPhi(z: number): number {
  const x = Math.abs(z), t = 1 / (1 + 0.2316419 * x);
  const q = phi(x) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - q : q;
}
/** Gauss–Legendre nodes and weights on [−1, 1], 16 points (computed once by Newton iteration on P_16 from cos(π(i + ¾)/(n + ½))). */
export const GL = /* @__PURE__ */ ((): { x: Float64Array; w: Float64Array } => {
  const n = 16, x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = portableCosTwoPi((i + 0.75) / (2 * n + 1)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = n * (z * p1 - p0) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x[i] = z; w[i] = 2 / ((1 - z * z) * dp * dp);
  }
  return { x, w };
})();

