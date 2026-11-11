// SPDX-License-Identifier: Apache-2.0

/**
 * #593 (2.22.0): the display view's rendering steps that couple a pixel's three components: the luminance tone curves
 * (`extended-reinhard-luminance`, `naka-rushton-luminance`), `highlightMode: "reconstruct"` and (#601) the hue-preserving
 * gamut handling `desaturate-to-luminance`. The view never draws a pixel's noise; it propagates the mean and covariance of the
 * pixel's camera channels (normal, docs/DISPLAY_VIEW.md) through development, so a coupled step needs the moments of a function
 * of three correlated normals. Two methods, both acting on each pixel's own developed values at use (no lookup tables):
 *
 * - **Tone curves by conditioning on luminance.** With the developed linear sRGB y ~ N(μ, Σ) and the luminance L = wᵀy (w the
 *   sRGB Y row), y_k given L is normal with mean μ_k + β_k(L − μ_L), β = Σw/(wᵀΣw), and variance Σ_kk − β_k·(Σw)_k (standard
 *   Gaussian conditioning). The rendered component clip(y_k·r(L), 0, 1), r = f(L)/L, then has the closed-form clipped-normal
 *   moments for each L, and its expectation is a 1-D integral over L: full, a composite 16-point Gauss–Legendre rule over
 *   μ_L ± 8.5σ_L in 4 panels (split at L = 0, where the curves leave a pixel unchanged), the structure of the per-channel Reinhard
 *   moments; fast, an 8-point Gauss–Hermite rule in L where the range does not reach L = 0 (else the full rule). The expected
 *   slopes (Stein's lemma, for the view's linear noise part) are E[∂out_k/∂y_j] = E[1_in·(δ_kj·r + y_k·r′(L)·w_j)], from the
 *   same conditional moments. Derived for this engine from standard Gaussian conditioning; the curves are those of
 *   src/output/sdr-rendering.ts (Reinhard et al. 2002; Naka & Rushton 1966).
 * - **Reconstruct and desaturation by a 3-D rule.** The blend of `reconstruct` (src/color/sensor-color-development.ts) depends on
 *   the largest camera channel and the clipped channels' largest value, and the desaturation on the largest rendered component:
 *   piecewise-smooth functions of all three. Where a pixel's camera channels reach the blend (any channel within 8.5σ of 0.8 of
 *   white or above) or, with the desaturation, a rendered component reaches 1, the whole chain (white balance, highlight,
 *   matrix, tone curve, desaturation, clip) is integrated over the pixel's normal camera channels with a tensor Gauss–Hermite
 *   rule in Cholesky coordinates (nodes and weights from the Jacobi matrix's eigenvalues, Golub & Welsch 1969; NIST DLMF
 *   §3.5(v)): full 16 points per axis (4,096 nodes), fast 6 per axis (216). Elsewhere `reconstruct` is the unclipped white
 *   balance (exactly linear) and the desaturation leaves the pixel unchanged.
 * The fast rules are the registered fast methods `output.toneCurve/view-luminance-moments` and
 * `output.highlightMode.reconstruct/view-moments` (src/facade/fast-methods.ts); their measured bounds are in docs/DISPLAY_VIEW.md.
 */

import { portableCosTwoPi, portableExp, portablePow } from "../core/portable-math.js";
import { desaturateToLuminance, SDR_LUMINANCE_WEIGHTS, type SdrToneCurve, type SdrToneCurveParameters } from "../output/sdr-rendering.js";
import { RAW_HIGHLIGHT_RECONSTRUCTION_START } from "../color/sensor-color-development.js";

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

/**
 * Internal (exported for tests). The n-point Gauss–Hermite rule of the standard normal: Σ w_i f(x_i) ≈ E[f(Z)], Z ~ N(0, 1).
 * The nodes are the eigenvalues of the Jacobi matrix of the orthonormal Hermite polynomials (zero diagonal, off-diagonal √k),
 * found by Sturm-sequence bisection, and w_i = 1/Σ_k p_k(x_i)² (Golub & Welsch 1969). Only correctly rounded operations, so the
 * rule has the same bits in every JavaScript engine.
 */
export function gaussHermite(n: number): { x: Float64Array; w: Float64Array } {
  const x = new Float64Array(n), w = new Float64Array(n), limit = 2 * Math.sqrt(n) + 1;
  /** The number of eigenvalues below λ (Sturm count of the LDLᵀ pivots). */
  const below = (lambda: number): number => {
    let count = 0, q = -lambda;
    for (let k = 1; ; k++) {
      if (q < 0) count++;
      if (k === n) return count;
      q = -lambda - k / (q === 0 ? 1e-300 : q);
    }
  };
  for (let i = 0; i < n; i++) {
    let lo = -limit, hi = limit;
    for (let it = 0; it < 200 && hi - lo > 0; it++) { const mid = (lo + hi) / 2; if (mid === lo || mid === hi) break; if (below(mid) > i) hi = mid; else lo = mid; }
    const z = (lo + hi) / 2;
    let p0 = 1, p1 = z, sum = 1 + (n > 1 ? z * z : 0);
    for (let k = 1; k < n - 1; k++) { const p2 = (z * p1 - Math.sqrt(k) * p0) / Math.sqrt(k + 1); p0 = p1; p1 = p2; sum += p2 * p2; }
    x[i] = z; w[i] = 1 / sum;
  }
  // Symmetric rule: the middle node of an odd rule is 0 exactly, and mirrored nodes share their weight.
  for (let i = 0; i < n >> 1; i++) { const a = (x[n - 1 - i]! - x[i]!) / 2, b = (w[i]! + w[n - 1 - i]!) / 2; x[i] = -a; x[n - 1 - i] = a; w[i] = b; w[n - 1 - i] = b; }
  if (n & 1) x[n >> 1] = 0;
  let total = 0;
  for (let i = 0; i < n; i++) total += w[i]!;
  for (let i = 0; i < n; i++) w[i] = w[i]! / total;
  return { x, w };
}

/** Points per axis of the 3-D rule (full and fast) and of the fast 1-D luminance rule. */
export const DISPLAY_VIEW_CHAIN_POINTS = /* @__PURE__ */ Object.freeze({ full: 16, fast: 6 });
export const DISPLAY_VIEW_LUMINANCE_FAST_POINTS = 8;

/** What the view renders: the request's tone curve, highlight mode and gamut handling (#601), and whether the fast rules run. */
export interface DisplayViewRenderingChoice {
  toneCurve: SdrToneCurve;
  toneCurveParameters?: SdrToneCurveParameters;
  highlightMode: "clip" | "reconstruct";
  gamutHandling: "clip-components" | "desaturate-to-luminance";
  fast: boolean;
}

/** The coupled steps of one view (see the module notes), or null for a view without them (its arithmetic is unchanged). */
export interface DisplayViewCoupledRendering {
  readonly luminanceTone: boolean;
  readonly reconstruct: boolean;
  readonly desaturate: boolean;
  /** Renders one deterministic camera pixel (WB, highlight, matrix, tone, gamut, clip) into out (the AHD correction's pixels). */
  pixel(c0: number, c1: number, c2: number, out: Float64Array): void;
  /**
   * The moments of the rendered pixel for camera channels c ~ N(cm, C) (C row-major 3 × 3), integrated over the whole chain:
   * mean (hm), variance (hv) and the expected slopes ∂out_k/∂c_j (A, row-major 3 × 3). Returns the number of nodes evaluated.
   */
  chain(cm: Float64Array, C: Float64Array, hm: Float64Array, hv: Float64Array, A: Float64Array): number;
  /**
   * Whether the reconstruct blend is within reach of channels c ~ N(cm, C): some channel's mean + 8.5σ above the blend's start.
   * Out of reach the highlight step is the unclipped white balance.
   */
  reconstructInReach(cm: Float64Array, C: Float64Array): boolean;
  /**
   * The luminance tone curve on developed values y ~ N(μ, Σ) (Σ row-major 3 × 3): mean (hm), variance (hv) and the expected
   * slopes J = E[∂out/∂y] (row-major). Returns false when a component reaches 1 within reach and the desaturation is on (the
   * caller then integrates the chain), else true.
   */
  tone(mu: Float64Array, S: Float64Array, hm: Float64Array, hv: Float64Array, J: Float64Array): boolean;
}

/** The tone ratio r(L) = f(L)/L and its derivative of a luminance curve, for L > 0. */
/** The limit r(0+) of a luminance curve's ratio (where the curves meet the unchanged pixels at L = 0): 1, 0, 1/(σ·g(Lw)) or ∞. */
function ratioAtZero(curve: SdrToneCurve, p: SdrToneCurveParameters | undefined): number {
  if (curve === "extended-reinhard-luminance" || !p || !("exponent" in p)) return 1;
  const q = p as Extract<SdrToneCurveParameters, { exponent: number }>;
  return q.exponent > 1 ? 0 : q.exponent < 1 ? Infinity : (1 + q.semiSaturation / q.whiteLuminance) / q.semiSaturation;
}
function luminanceRatio(curve: SdrToneCurve, p: SdrToneCurveParameters | undefined): (l: number, out: Float64Array) => void {
  if (curve === "extended-reinhard-luminance" && p && !("exponent" in p)) {
    const inverseWhite2 = 1 / (p.whiteLuminance * p.whiteLuminance);
    // f(L) = L(1 + L/Lw²)/(1 + L): r = (1 + L/Lw²)/(1 + L), r′ = (1/Lw² − 1)/(1 + L)².
    return (l, out) => { const d = 1 + l; out[0] = (1 + l * inverseWhite2) / d; out[1] = (inverseWhite2 - 1) / (d * d); };
  }
  const q = p as Extract<SdrToneCurveParameters, { exponent: number }>, n = q.exponent, sigma = q.semiSaturation;
  // g(L) = 1/(1 + u), u = (σ/L)ⁿ; f = g/g(Lw); r = g/(g(Lw)·L), r′ = g·(n·u·g − 1)/(g(Lw)·L²).
  const white = 1 / (1 + portablePow(sigma / q.whiteLuminance, n));
  return (l, out) => { const u = portablePow(sigma / l, n), g = 1 / (1 + u); out[0] = g / (white * l); out[1] = g * (n * u * g - 1) / (white * l * l); };
}

/**
 * Internal: the coupled rendering of a view, or null when its tone curve is per channel, its highlight mode `clip` and its gamut
 * handling the component clip (the view's own per-component arithmetic then runs, byte for byte as before).
 */
export function createDisplayViewCoupledRendering(choice: DisplayViewRenderingChoice, gains: readonly number[], clipLevel: number,
  matrix: readonly (readonly number[])[]): DisplayViewCoupledRendering | null {
  const luminanceTone = choice.toneCurve === "extended-reinhard-luminance" || choice.toneCurve === "naka-rushton-luminance";
  const reconstruct = choice.highlightMode === "reconstruct", desaturate = choice.gamutHandling === "desaturate-to-luminance";
  if (!luminanceTone && !reconstruct && !desaturate) return null;
  const reinhard = choice.toneCurve === "positive-reinhard-per-channel", ratio = luminanceTone ? luminanceRatio(choice.toneCurve, choice.toneCurveParameters) : null;
  const ratioZero = ratioAtZero(choice.toneCurve, choice.toneCurveParameters);
  const w0 = SDR_LUMINANCE_WEIGHTS[0]!, w1 = SDR_LUMINANCE_WEIGHTS[1]!, w2 = SDR_LUMINANCE_WEIGHTS[2]!, w = [w0, w1, w2];
  const g = Float64Array.from(gains), L = clipLevel, M = Float64Array.from(matrix.flat()), start = RAW_HIGHLIGHT_RECONSTRUCTION_START;
  const chainRule = gaussHermite(choice.fast ? DISPLAY_VIEW_CHAIN_POINTS.fast : DISPLAY_VIEW_CHAIN_POINTS.full), hermite8 = gaussHermite(DISPLAY_VIEW_LUMINANCE_FAST_POINTS);
  const rr = new Float64Array(2), b = new Float64Array(3), Jb = new Float64Array(9), y = new Float64Array(3), z = new Float64Array(3), Jt = new Float64Array(9), Jz = new Float64Array(9);
  const T = new Float64Array(9), c = new Float64Array(3), out = new Float64Array(3), Jo = new Float64Array(9), chol = new Float64Array(9);
  /** The highlight step b(c) and its slopes Jb = ∂b/∂c (a.e.), as `prepareSensorColorDevelopment` develops. */
  function highlight(c0: number, c1: number, c2: number): void {
    const u0 = c0 * g[0]!, u1 = c1 * g[1]!, u2 = c2 * g[2]!;
    Jb.fill(0);
    if (!reconstruct) {
      b[0] = u0 > L ? L : u0; b[1] = u1 > L ? L : u1; b[2] = u2 > L ? L : u2;
      Jb[0] = u0 > L ? 0 : g[0]!; Jb[4] = u1 > L ? 0 : g[1]!; Jb[8] = u2 > L ? 0 : g[2]!;
      return;
    }
    const s = c0 > c1 ? (c0 > c2 ? c0 : c2) : (c1 > c2 ? c1 : c2);
    if (!(s > start)) { b[0] = u0; b[1] = u1; b[2] = u2; Jb[0] = g[0]!; Jb[4] = g[1]!; Jb[8] = g[2]!; return; }
    const sIndex = c0 > c1 ? (c0 > c2 ? 0 : 2) : (c1 > c2 ? 1 : 2);
    const k0 = u0 > L ? L : u0, k1 = u1 > L ? L : u1, k2 = u2 > L ? L : u2, n = k0 > k1 ? (k0 > k2 ? k0 : k2) : (k1 > k2 ? k1 : k2);
    const nIndex = k0 > k1 ? (k0 > k2 ? 0 : 2) : (k1 > k2 ? 1 : 2), nSlope = (nIndex === 0 ? u0 : nIndex === 1 ? u1 : u2) > L ? 0 : g[nIndex]!;
    const t = s >= 1 ? 1 : (s - start) / (1 - start), tSlope = s >= 1 ? 0 : 1 / (1 - start);
    b[0] = (1 - t) * u0 + t * n; b[1] = (1 - t) * u1 + t * n; b[2] = (1 - t) * u2 + t * n;
    for (let k = 0; k < 3; k++) {
      const uk = k === 0 ? u0 : k === 1 ? u1 : u2;
      Jb[k * 4] = (1 - t) * g[k]!;
      Jb[k * 3 + nIndex] = Jb[k * 3 + nIndex]! + t * nSlope;
      Jb[k * 3 + sIndex] = Jb[k * 3 + sIndex]! + (n - uk) * tSlope;
    }
  }
  /** Tone, gamut and clip of developed y into out, with the slopes Jo = ∂out/∂y (a.e.). */
  function render(): void {
    Jt.fill(0);
    if (ratio) {
      const l = w0 * y[0]! + w1 * y[1]! + w2 * y[2]!;
      if (l > 0) {
        ratio(l, rr);
        const r = rr[0]!, rp = rr[1]!;
        for (let k = 0; k < 3; k++) { z[k] = y[k]! * r; for (let j = 0; j < 3; j++) Jt[k * 3 + j] = (k === j ? r : 0) + y[k]! * rp * w[j]!; }
      } else for (let k = 0; k < 3; k++) { z[k] = y[k]!; Jt[k * 4] = 1; }
    } else for (let k = 0; k < 3; k++) {
      const v = y[k]!;
      if (reinhard && v > 0) { z[k] = v / (1 + v); Jt[k * 4] = 1 / ((1 + v) * (1 + v)); } else { z[k] = v; Jt[k * 4] = 1; }
    }
    // #601: toward the luminance until the largest component is 1 (src/output/sdr-rendering.ts, desaturateToLuminance).
    const top = z[0]! > z[1]! ? (z[0]! > z[2]! ? 0 : 2) : (z[1]! > z[2]! ? 1 : 2), zt = z[top]!;
    if (desaturate && zt > 1) {
      const lp = w0 * z[0]! + w1 * z[1]! + w2 * z[2]!;
      if (lp >= 1) { out.fill(1); Jo.fill(0); return; }
      const d = zt - lp, a = (1 - lp) / d;
      // ∂a/∂z_j = (−w_j·d − (1 − lp)·(δ_tj − w_j))/d².
      for (let j = 0; j < 9; j++) Jz[j] = 0;
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) {
        const da = (-w[j]! * d - (1 - lp) * ((j === top ? 1 : 0) - w[j]!)) / (d * d);
        Jz[k * 3 + j] = w[j]! * (1 - a) + (k === j ? a : 0) + (z[k]! - lp) * da;
      }
      desaturateToLuminance(z);
    } else { Jz.fill(0); Jz[0] = 1; Jz[4] = 1; Jz[8] = 1; }
    // Jo = diag(inside)·Jz·Jt.
    for (let k = 0; k < 3; k++) {
      const v = z[k]!, inside = v > 0 && v < 1;
      out[k] = v < 0 ? 0 : v > 1 ? 1 : v;
      for (let j = 0; j < 3; j++) Jo[k * 3 + j] = inside ? Jz[k * 3]! * Jt[j]! + Jz[k * 3 + 1]! * Jt[3 + j]! + Jz[k * 3 + 2]! * Jt[6 + j]! : 0;
    }
  }
  function develop(c0: number, c1: number, c2: number): void {
    highlight(c0, c1, c2);
    for (let k = 0; k < 3; k++) y[k] = M[k * 3]! * b[0]! + M[k * 3 + 1]! * b[1]! + M[k * 3 + 2]! * b[2]!;
    render();
  }
  function pixel(c0: number, c1: number, c2: number, result: Float64Array): void {
    develop(c0, c1, c2);
    result[0] = out[0]!; result[1] = out[1]!; result[2] = out[2]!;
  }
  function chain(cm: Float64Array, C: Float64Array, hm: Float64Array, hv: Float64Array, A: Float64Array): number {
    // Cholesky factor of C (positive semidefinite; tiny negative pivots are treated as 0).
    chol.fill(0);
    const l00 = Math.sqrt(Math.max(0, C[0]!)), l10 = l00 > 0 ? C[3]! / l00 : 0, l20 = l00 > 0 ? C[6]! / l00 : 0;
    const l11 = Math.sqrt(Math.max(0, C[4]! - l10 * l10)), l21 = l11 > 0 ? (C[7]! - l20 * l10) / l11 : 0, l22 = Math.sqrt(Math.max(0, C[8]! - l20 * l20 - l21 * l21));
    const rule = l00 > 0 || l11 > 0 || l22 > 0 ? chainRule : { x: Float64Array.of(0), w: Float64Array.of(1) }, n = rule.x.length;
    let e0 = 0, e1 = 0, e2 = 0, q0 = 0, q1 = 0, q2 = 0;
    T.fill(0);
    for (let i = 0; i < n; i++) {
      const x0 = rule.x[i]!, wi = rule.w[i]!;
      for (let j = 0; j < (l11 > 0 || l21 !== 0 || l22 > 0 ? n : 1); j++) {
        const x1 = l11 > 0 || l21 !== 0 || l22 > 0 ? rule.x[j]! : 0, wj = l11 > 0 || l21 !== 0 || l22 > 0 ? wi * rule.w[j]! : wi;
        for (let k = 0; k < (l22 > 0 ? n : 1); k++) {
          const x2 = l22 > 0 ? rule.x[k]! : 0, weight = l22 > 0 ? wj * rule.w[k]! : wj;
          c[0] = cm[0]! + l00 * x0; c[1] = cm[1]! + l10 * x0 + l11 * x1; c[2] = cm[2]! + l20 * x0 + l21 * x1 + l22 * x2;
          develop(c[0], c[1], c[2]);
          e0 += weight * out[0]!; e1 += weight * out[1]!; e2 += weight * out[2]!;
          q0 += weight * out[0]! * out[0]!; q1 += weight * out[1]! * out[1]!; q2 += weight * out[2]! * out[2]!;
          // ∂out/∂c = Jo·M·Jb.
          for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) {
            const ms = M[r * 3]! * Jb[s]! + M[r * 3 + 1]! * Jb[3 + s]! + M[r * 3 + 2]! * Jb[6 + s]!;
            for (let o = 0; o < 3; o++) T[o * 3 + s] = T[o * 3 + s]! + weight * Jo[o * 3 + r]! * ms;
          }
        }
      }
    }
    hm[0] = e0; hm[1] = e1; hm[2] = e2;
    hv[0] = Math.max(0, q0 - e0 * e0); hv[1] = Math.max(0, q1 - e1 * e1); hv[2] = Math.max(0, q2 - e2 * e2);
    A.set(T);
    return n ** ((l00 > 0 ? 1 : 0) + (l11 > 0 || l21 !== 0 || l22 > 0 ? 1 : 0) + (l22 > 0 ? 1 : 0));
  }
  function reconstructInReach(cm: Float64Array, C: Float64Array): boolean {
    for (let k = 0; k < 3; k++) if (!(cm[k]! + CLIP_REACH_SIGMA * Math.sqrt(Math.max(0, C[k * 4]!)) < start)) return true;
    return false;
  }
  const m1 = new Float64Array(3), m2 = new Float64Array(3), sw = new Float64Array(3), beta = new Float64Array(3), cv = new Float64Array(3);
  /**
   * The clipped-normal terms of Z ~ N(m, v) on [0, 1]: P(0 < Z < 1), E[Z·1(0 < Z < 1)], E[Z²·1(0 < Z < 1)] and P(Z ≥ 1), into
   * rr-like slots (q). Closed form, as `unitClip` without its skewness term.
   */
  const q = new Float64Array(4);
  function clipped(m: number, v: number): void {
    if (!(v > 0)) { const inside = m > 0 && m < 1; q[0] = inside ? 1 : 0; q[1] = inside ? m : 0; q[2] = inside ? m * m : 0; q[3] = m >= 1 ? 1 : 0; return; }
    const s = Math.sqrt(v), a = -m / s, bb = (1 - m) / s;
    const Pa = a < -CLIP_REACH_SIGMA ? 0 : a > CLIP_REACH_SIGMA ? 1 : bigPhi(a), Pb = bb > CLIP_REACH_SIGMA ? 1 : bb < -CLIP_REACH_SIGMA ? 0 : bigPhi(bb);
    const da = a < -CLIP_REACH_SIGMA || a > CLIP_REACH_SIGMA ? 0 : phi(a), db = bb > CLIP_REACH_SIGMA || bb < -CLIP_REACH_SIGMA ? 0 : phi(bb);
    const inside = Pb - Pa;
    q[0] = inside; q[1] = m * inside + s * (da - db); q[2] = (m * m + v) * inside + 2 * m * s * (da - db) + v * (a * da - bb * db); q[3] = 1 - Pb;
  }
  function tone(mu: Float64Array, S: Float64Array, hm: Float64Array, hv: Float64Array, J: Float64Array): boolean {
    const muL = w0 * mu[0]! + w1 * mu[1]! + w2 * mu[2]!;
    for (let k = 0; k < 3; k++) sw[k] = S[k * 3]! * w0 + S[k * 3 + 1]! * w1 + S[k * 3 + 2]! * w2;
    const vL = w0 * sw[0]! + w1 * sw[1]! + w2 * sw[2]!, sL = vL > 0 ? Math.sqrt(vL) : 0;
    for (let k = 0; k < 3; k++) { beta[k] = sL > 0 ? sw[k]! / vL : 0; cv[k] = Math.max(0, S[k * 4]! - (sL > 0 ? beta[k]! * sw[k]! : 0)); }
    m1.fill(0); m2.fill(0); J.fill(0);
    let reachesTop = false;
    const node = (l: number, weight: number): void => {
      let r = 1, rp = 0;
      if (l > 0) { ratio!(l, rr); r = rr[0]!; rp = rr[1]!; }
      for (let k = 0; k < 3; k++) {
        const m = mu[k]! + beta[k]! * (l - muL);
        clipped(r * m, r * r * cv[k]!);
        m1[k] = m1[k]! + weight * (q[1]! + q[3]!);
        m2[k] = m2[k]! + weight * (q[2]! + q[3]!);
        if (q[3]! > 0) reachesTop = true;
        // E[∂out_k/∂y_j | L] = δ_kj·r·P_in + r′·w_j·E[y_k·1_in] (E[y_k·1_in] = E[Z·1_in]/r).
        for (let j = 0; j < 3; j++) J[k * 3 + j] = J[k * 3 + j]! + weight * ((k === j ? r * q[0]! : 0) + (rp === 0 ? 0 : rp * w[j]! * q[1]! / r));
      }
    };
    if (!(sL > 0)) node(muL, 1);
    else {
      const lo = muL - CLIP_REACH_SIGMA * sL, hi = muL + CLIP_REACH_SIGMA * sL;
      if (choice.fast && (muL > 2 * CLIP_REACH_SIGMA * sL || hi < 0)) for (let i = 0; i < hermite8.x.length; i++) node(muL + sL * hermite8.x[i]!, hermite8.w[i]!);
      else {
        // Composite 16-point Gauss–Legendre in 4 panels over [lo, hi], split at L = 0 where the curves leave the pixel unchanged; in
        // standardized units z = (L − μ_L)/σ_L, so a node's density is formed without the cancellation L − μ_L.
        const pieces = lo < 0 && hi > 0 ? [-CLIP_REACH_SIGMA, -muL / sL, CLIP_REACH_SIGMA] : [-CLIP_REACH_SIGMA, CLIP_REACH_SIGMA];
        for (let piece = 0; piece + 1 < pieces.length; piece++) {
          const a = pieces[piece]!, width = (pieces[piece + 1]! - a) / 4, half = width / 2;
          for (let p = 0; p < 4; p++) {
            const centre = a + (p + 0.5) * width;
            for (let k = 0; k < 16; k++) { const z = centre + half * GL.x[k]!; node(muL + sL * z, half * GL.w[k]! * phi(z)); }
          }
        }
      }
    }
    // Where the luminance's range holds L = 0 and the ratio jumps there (r(0+) ≠ 1), the rendered value jumps across the plane
    // wᵀy = 0, and the expected slopes gain p_L(0)·E[out(0+) − out(0−) | L = 0]·w_j (the jump's term of Stein's lemma).
    if (sL > 0 && ratioZero !== 1 && Math.abs(muL) < CLIP_REACH_SIGMA * sL) {
      const density = phi(muL / sL) / sL;
      for (let k = 0; k < 3; k++) {
        const m = mu[k]! - beta[k]! * muL, v = cv[k]!;
        clipped(m, v);
        const below = q[1]! + q[3]!;
        let above: number;
        if (ratioZero === Infinity) above = v > 0 ? bigPhi(m / Math.sqrt(v)) : m > 0 ? 1 : 0;
        else { clipped(ratioZero * m, ratioZero * ratioZero * v); above = q[1]! + q[3]!; }
        for (let j = 0; j < 3; j++) J[k * 3 + j] = J[k * 3 + j]! + density * (above - below) * w[j]!;
      }
    }
    for (let k = 0; k < 3; k++) { hm[k] = m1[k]!; hv[k] = Math.max(0, m2[k]! - m1[k]! * m1[k]!); }
    return !(desaturate && reachesTop);
  }
  return { luminanceTone, reconstruct, desaturate, pixel, chain, reconstructInReach, tone };
}
