// SPDX-License-Identifier: Apache-2.0
/**
 * #593, #601 (2.22.0): the display view's coupled rendering moments (src/facade/display-view-rendering.ts) against seeded Monte
 * Carlo of the same deterministic chain on normal camera channels: the luminance tone curves by conditioning on luminance, the
 * reconstruct blend and the desaturation by the 3-D Gauss–Hermite rule; the expected slopes against Stein's lemma; and the
 * measured gap between the fast and full rules (the bounds stated in docs/DISPLAY_VIEW.md, "Coupled rendering"). #656 (2.27.0):
 * the fast rule's 3-point order (where the channels are quiet and the kink probe allows it) in the same sweep, a sweep straddling
 * the highlight blend's kinks, and Monte Carlo.
 */
import { describe, expect, it } from "vitest";
import { createDisplayViewCoupledRendering, gaussHermite, type DisplayViewRenderingChoice } from "../src/facade/display-view-rendering.js";
import { calculateSdrRendering, desaturateToLuminance, SDR_LUMINANCE_WEIGHTS } from "../src/output/sdr-rendering.js";
import { simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/** Seeded normal pairs (a 32-bit linear congruential generator and Box–Muller); test-only. */
function normals(seed: number): () => number {
  let state = seed >>> 0, spare: number | null = null;
  const uniform = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + 0.5) / 4294967296; };
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    const r = Math.sqrt(-2 * Math.log(uniform())), t = 2 * Math.PI * uniform();
    spare = r * Math.sin(t);
    return r * Math.cos(t);
  };
}
/** Monte Carlo of the chain: mean, variance and the Stein slopes E[∂out/∂c] = C⁻¹·E[(c − μ)·out] (C invertible). */
function monteCarlo(render: (c: Float64Array, out: Float64Array) => void, cm: number[], C: number[], n: number, seed = 7): { mean: number[]; variance: number[]; slopes: number[] } {
  const z = normals(seed), l00 = Math.sqrt(C[0]!), l10 = C[3]! / l00, l20 = C[6]! / l00, l11 = Math.sqrt(C[4]! - l10 * l10), l21 = (C[7]! - l20 * l10) / l11, l22 = Math.sqrt(C[8]! - l20 * l20 - l21 * l21);
  const c = new Float64Array(3), out = new Float64Array(3), s1 = [0, 0, 0], s2 = [0, 0, 0], cross = new Array<number>(9).fill(0);
  for (let i = 0; i < n; i++) {
    const a = z(), b = z(), d = z();
    c[0] = cm[0]! + l00 * a; c[1] = cm[1]! + l10 * a + l11 * b; c[2] = cm[2]! + l20 * a + l21 * b + l22 * d;
    render(c, out);
    for (let k = 0; k < 3; k++) { s1[k] = s1[k]! + out[k]!; s2[k] = s2[k]! + out[k]! * out[k]!; for (let j = 0; j < 3; j++) cross[k * 3 + j] = cross[k * 3 + j]! + out[k]! * (c[j]! - cm[j]!); }
  }
  const mean = s1.map((v) => v / n), variance = s2.map((v, k) => v / n - mean[k]! ** 2);
  // Solve C·x = cross_k for each output component (3 × 3 by Cramer's rule).
  const det = (m: number[]): number => m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  const D = det(C), slopes: number[] = [];
  for (let k = 0; k < 3; k++) {
    const rhs = [0, 1, 2].map((j) => cross[k * 3 + j]! / n);
    for (let j = 0; j < 3; j++) { const m = [...C]; for (let r = 0; r < 3; r++) m[r * 3 + j] = rhs[r]!; slopes.push(det(m) / D); }
  }
  return { mean, variance, slopes };
}

const MATRIX = [[1.9, -0.75, -0.15], [-0.25, 1.55, -0.3], [0.02, -0.5, 1.48]];
const GAINS = [2.1, 1, 1.6];
const STANDARD = { exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 }, FLAT = { exponent: 1, semiSaturation: 0.8465, whiteLuminance: 32 };
const choice = (extra: Partial<DisplayViewRenderingChoice>): DisplayViewRenderingChoice => ({ toneCurve: "identity", highlightMode: "clip", gamutHandling: "clip-components", fast: false, ...extra });

describe("Gauss–Hermite rule", () => {
  it("integrates the normal's moments exactly up to degree 2n − 1", () => {
    for (const n of [1, 2, 4, 8, 16]) {
      const { x, w } = gaussHermite(n);
      const moment = (p: number): number => Array.from(x).reduce((s, xi, i) => s + w[i]! * xi ** p, 0);
      expect(moment(0)).toBeCloseTo(1, 14);
      for (let p = 1; p < 2 * n; p++) {
        const exact = p % 2 === 1 ? 0 : Array.from({ length: p / 2 }, (_, i) => 2 * i + 1).reduce((a, b) => a * b, 1);
        const size = Array.from(x).reduce((t, xi, i) => t + w[i]! * Math.abs(xi) ** p, 0);
        expect(Math.abs(moment(p) - exact)).toBeLessThan(1e-12 * size + 1e-15);
      }
    }
  });
});

describe("the coupled rendering moments", () => {
  it("is absent for the per-channel tone curves with the clip (their arithmetic is unchanged)", () => {
    expect(createDisplayViewCoupledRendering(choice({}), GAINS, 1, MATRIX)).toBeNull();
    expect(createDisplayViewCoupledRendering(choice({ toneCurve: "positive-reinhard-per-channel" }), GAINS, 1, MATRIX)).toBeNull();
  });

  it("matches Monte Carlo for the luminance tone curves (conditioning on luminance), with the Stein slopes", () => {
    const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const cases: [DisplayViewRenderingChoice, number[], number[]][] = [
      [choice({ toneCurve: "naka-rushton-luminance", toneCurveParameters: STANDARD }), [0.18, 0.2, 0.15], [4e-4, 1e-4, 0, 1e-4, 3e-4, 0, 0, 0, 5e-4]],
      [choice({ toneCurve: "naka-rushton-luminance", toneCurveParameters: FLAT }), [0.9, 0.4, 0.08], [0.01, 0.002, 0, 0.002, 0.004, 0, 0, 0, 0.003]],
      [choice({ toneCurve: "extended-reinhard-luminance", toneCurveParameters: { whiteLuminance: 2 } }), [1.6, 0.9, 0.3], [0.02, 0.004, 0.001, 0.004, 0.01, 0.001, 0.001, 0.001, 0.008]],
      // Dark and noisy: the luminance range crosses 0, where the curves leave the pixel unchanged.
      [choice({ toneCurve: "naka-rushton-luminance", toneCurveParameters: STANDARD }), [0.01, 0.012, 0.008], [1e-4, 2e-5, 0, 2e-5, 8e-5, 0, 0, 0, 1.2e-4]]
    ];
    for (const [rendering, mu, S] of cases) {
      const coupled = createDisplayViewCoupledRendering(rendering, [1, 1, 1], 1e6, identity)!;
      const hm = new Float64Array(3), hv = new Float64Array(3), J = new Float64Array(9);
      expect(coupled.tone(Float64Array.from(mu), Float64Array.from(S), hm, hv, J)).toBe(true);
      const mc = monteCarlo((c, out) => coupled.pixel(c[0]!, c[1]!, c[2]!, out), mu, S, 400_000);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(hm[k]! - mc.mean[k]!)).toBeLessThan(4 * Math.sqrt(mc.variance[k]! / 400_000) + 1e-6);
        expect(Math.abs(hv[k]! - mc.variance[k]!)).toBeLessThan(0.02 * mc.variance[k]! + 1e-9);
      }
      for (let i = 0; i < 9; i++) expect(Math.abs(J[i]! - mc.slopes[i]!)).toBeLessThan(0.03 * Math.max(1, Math.abs(mc.slopes[i]!)));
    }
  }, scaledTimeout(60_000));

  it("matches Monte Carlo through the whole chain for reconstruct and the desaturation", () => {
    const cases: [DisplayViewRenderingChoice, number[], number[]][] = [
      // Red channel in the blend (0.8 to white), clipped in the WB step.
      [choice({ highlightMode: "reconstruct" }), [0.45, 0.85, 0.5], [4e-4, 1e-4, 0, 1e-4, 6e-4, 0, 0, 0, 5e-4]],
      [choice({ highlightMode: "reconstruct", toneCurve: "naka-rushton-luminance", toneCurveParameters: STANDARD }), [0.7, 0.95, 0.62], [9e-4, 2e-4, 1e-4, 2e-4, 1e-3, 1e-4, 1e-4, 1e-4, 8e-4]],
      [choice({ gamutHandling: "desaturate-to-luminance", toneCurve: "naka-rushton-luminance", toneCurveParameters: FLAT }), [0.45, 0.2, 0.05], [5e-4, 1e-4, 0, 1e-4, 3e-4, 0, 0, 0, 2e-4]],
      [choice({ gamutHandling: "desaturate-to-luminance" }), [0.5, 0.3, 0.1], [5e-4, 1e-4, 0, 1e-4, 3e-4, 0, 0, 0, 2e-4]]
    ];
    for (const [rendering, cm, C] of cases) {
      const coupled = createDisplayViewCoupledRendering(rendering, GAINS, 1, MATRIX)!;
      const hm = new Float64Array(3), hv = new Float64Array(3), A = new Float64Array(9);
      expect(coupled.chain(Float64Array.from(cm), Float64Array.from(C), hm, hv, A)).toBe(16 ** 3);
      const mc = monteCarlo((c, out) => coupled.pixel(c[0]!, c[1]!, c[2]!, out), cm, C, 400_000);
      for (let k = 0; k < 3; k++) {
        // The rule's own error (kinks inside the 16-point rule) plus four standard errors of the Monte Carlo mean.
        expect(Math.abs(hm[k]! - mc.mean[k]!)).toBeLessThan(4 * Math.sqrt(mc.variance[k]! / 400_000) + 1e-3);
        expect(Math.abs(hv[k]! - mc.variance[k]!)).toBeLessThan(0.1 * mc.variance[k]! + 2e-6);
      }
      for (let i = 0; i < 9; i++) expect(Math.abs(A[i]! - mc.slopes[i]!)).toBeLessThan(0.15 * Math.max(0.5, Math.abs(mc.slopes[i]!)));
    }
  }, scaledTimeout(120_000));

  it("is the deterministic chain when the channels have no noise", () => {
    const coupled = createDisplayViewCoupledRendering(choice({ highlightMode: "reconstruct", toneCurve: "extended-reinhard-luminance", toneCurveParameters: { whiteLuminance: 4 } }), GAINS, 1, MATRIX)!;
    const hm = new Float64Array(3), hv = new Float64Array(3), A = new Float64Array(9), out = new Float64Array(3);
    expect(coupled.chain(Float64Array.of(0.6, 0.9, 0.7), new Float64Array(9), hm, hv, A)).toBe(1);
    coupled.pixel(0.6, 0.9, 0.7, out);
    expect(Array.from(hm)).toEqual(Array.from(out));
    expect(Array.from(hv)).toEqual([0, 0, 0]);
  });

  it("keeps the fast rules within their measured bounds of the full ones", () => {
    // A seeded sweep of means and covariances over the reach of each step; the largest gap is the bound stated in the docs.
    const z = normals(3), uniform = (): number => 0.5 + 0.5 * Math.tanh(z());
    let toneGap = 0, chainGap = 0, quietGap = 0, low = 0;
    for (let trial = 0; trial < 300; trial++) {
      const scale = 10 ** (-5 + 2.4 * uniform()), cm = [uniform(), uniform(), uniform()].map((v) => 0.98 * v), a = [z(), z(), z()].map((v) => v * Math.sqrt(scale));
      const C = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => (i === j ? scale : 0) + 0.5 * a[i]! * a[j]!));
      const parameters = trial % 2 === 0 ? STANDARD : FLAT;
      {
        const rf = createDisplayViewCoupledRendering(choice({ toneCurve: "naka-rushton-luminance", toneCurveParameters: parameters, fast: true }), GAINS, 1, MATRIX)!;
        const rx = createDisplayViewCoupledRendering(choice({ toneCurve: "naka-rushton-luminance", toneCurveParameters: parameters, fast: false }), GAINS, 1, MATRIX)!;
        const mu = Float64Array.from([0, 1, 2], (r) => MATRIX[r]!.reduce((s, m, c) => s + m * Math.min(1, GAINS[c]! * cm[c]!), 0));
        const S = Float64Array.from({ length: 9 }, (_, i) => MATRIX[Math.floor(i / 3)]!.reduce((s, m, p) => s + m * MATRIX[i % 3]!.reduce((t, n, q) => t + n * GAINS[p]! * GAINS[q]! * C[p * 3 + q]!, 0), 0));
        const h1 = new Float64Array(3), h2 = new Float64Array(3), v = new Float64Array(3), J = new Float64Array(9);
        rf.tone(mu, S, h1, v, J); rx.tone(mu, S, h2, v, J);
        for (let k = 0; k < 3; k++) toneGap = Math.max(toneGap, Math.abs(h1[k]! - h2[k]!));
        const cf = createDisplayViewCoupledRendering(choice({ highlightMode: "reconstruct", fast: true }), GAINS, 1, MATRIX)!;
        const cx = createDisplayViewCoupledRendering(choice({ highlightMode: "reconstruct", fast: false }), GAINS, 1, MATRIX)!;
        if (cf.chain(Float64Array.from(cm), Float64Array.from(C), h1, v, J) === 27) low++;
        cx.chain(Float64Array.from(cm), Float64Array.from(C), h2, v, J);
        const quiet = Math.max(C[0]!, C[4]!, C[8]!) <= 1e-4;
        for (let k = 0; k < 3; k++) { chainGap = Math.max(chainGap, Math.abs(h1[k]! - h2[k]!)); if (quiet) quietGap = Math.max(quietGap, Math.abs(h1[k]! - h2[k]!)); }
      }
    }
    console.log("fast vs full, largest gap of the expected value (linear light):", { tone: toneGap, chain: chainGap, chainUpToSigma001: quietGap, lowOrder: low });
    // Measured 2026-11-11: tone 6.7e-6; chain 1.5e-2 with channel σ up to 0.076 (ISO 6400 on small sites), 2.4e-4 up to σ = 0.01.
    // 2026-11-18 (#656, the fast rule's 3-point order on 24 of the 300): the same, 1.45e-2 and 2.41e-4.
    expect(low).toBeGreaterThan(0);
    expect(toneGap).toBeLessThan(2e-5);
    expect(chainGap).toBeLessThan(2e-2);
    expect(quietGap).toBeLessThan(2e-3);
  }, scaledTimeout(60_000));

  it("keeps the fast rule's 3-point order (#656) within the 6-point rule's gap where the highlight blend's kinks are straddled", () => {
    // Means placed within 3σ of 0.8 of white, of white and of a channel's clip level (the kinks the 3-point order integrates
    // across), with the identity and Standard curves; the 3-point order's gap to the full rule against the 6-point rule's.
    const z = normals(11), uniform = (): number => 0.5 + 0.5 * Math.tanh(z());
    const gaps = { low: 0, six: 0, lowQuiet: 0, sixQuiet: 0, lowCases: 0, lowOrderOnly: 0, sixOnThose: 0 };
    for (let trial = 0; trial < 300; trial++) {
      const scale = 10 ** (-5.6 + 3 * uniform()), sigma = Math.sqrt(scale), k = trial % 3, cm = [uniform(), uniform(), uniform()].map((v) => 0.98 * v);
      const level = [0.8, 1, 1 / GAINS[k]!][Math.floor(trial / 3) % 3]!;
      cm[k] = level + 6 * sigma * (uniform() - 0.5);
      if (level !== 0.8) cm[(k + 1) % 3] = Math.max(cm[(k + 1) % 3]!, 0.75);
      const a = [z(), z(), z()].map((v) => v * Math.sqrt(scale));
      const C = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => (i === j ? scale : 0) + 0.5 * a[i]! * a[j]!));
      const quiet = Math.max(C[0]!, C[4]!, C[8]!) <= 1e-4;
      const rendering = trial % 2 === 0 ? choice({ highlightMode: "reconstruct" }) : choice({ highlightMode: "reconstruct", toneCurve: "naka-rushton-luminance", toneCurveParameters: STANDARD });
      const adaptive = createDisplayViewCoupledRendering({ ...rendering, fast: true }, GAINS, 1, MATRIX)!, six = createDisplayViewCoupledRendering({ ...rendering, fast: true }, GAINS, 1, MATRIX, false)!;
      const full = createDisplayViewCoupledRendering({ ...rendering, fast: false }, GAINS, 1, MATRIX)!;
      if (!adaptive.reconstructInReach(Float64Array.from(cm), Float64Array.from(C))) continue;
      const h1 = new Float64Array(3), h6 = new Float64Array(3), hx = new Float64Array(3), v = new Float64Array(3), J = new Float64Array(9);
      const nodes = adaptive.chain(Float64Array.from(cm), Float64Array.from(C), h1, v, J);
      expect(six.chain(Float64Array.from(cm), Float64Array.from(C), h6, v, J)).toBe(216);
      full.chain(Float64Array.from(cm), Float64Array.from(C), hx, v, J);
      if (nodes === 27) gaps.lowCases++; else expect(Array.from(h1)).toEqual(Array.from(h6));
      for (let c = 0; c < 3; c++) {
        const g1 = Math.abs(h1[c]! - hx[c]!), g6 = Math.abs(h6[c]! - hx[c]!);
        gaps.low = Math.max(gaps.low, g1); gaps.six = Math.max(gaps.six, g6);
        if (quiet) { gaps.lowQuiet = Math.max(gaps.lowQuiet, g1); gaps.sixQuiet = Math.max(gaps.sixQuiet, g6); }
        if (nodes === 27) { gaps.lowOrderOnly = Math.max(gaps.lowOrderOnly, g1); gaps.sixOnThose = Math.max(gaps.sixOnThose, g6); }
      }
    }
    console.log("straddled kinks, largest gap to the full rule (linear light):", gaps);
    expect(gaps.lowCases).toBeGreaterThan(20);
    expect(gaps.low).toBeLessThanOrEqual(gaps.six);
    expect(gaps.lowQuiet).toBeLessThanOrEqual(gaps.sixQuiet);
    // Measured 2026-11-18: 42 of the 300 take the 3-point order; their largest gap 1.9e-3 (the 6-point rule's on them 4.1e-4),
    // inside the 6-point rule's own 2.5e-3 for σ ≤ 0.01 (2.4e-2 overall) on this sweep.
    expect(gaps.lowOrderOnly).toBeLessThanOrEqual(gaps.sixQuiet);
  }, scaledTimeout(60_000));

  it("matches Monte Carlo with the fast rule's 3-point order (#656)", () => {
    const quiet = (s: number): number[] => [s, 0.2 * s, 0.1 * s, 0.2 * s, 1.3 * s, 0, 0.1 * s, 0, 0.8 * s];
    const cases: [DisplayViewRenderingChoice, number[], number[]][] = [
      // Inside the blend, across 0.8 of white, across white and across the red channel's clip level (1/2.1), quiet channels.
      [choice({ highlightMode: "reconstruct", fast: true }), [0.2, 0.88, 0.25], quiet(2.5e-5)],
      [choice({ highlightMode: "reconstruct", fast: true }), [0.3, 0.5, 0.802], quiet(1e-5)],
      [choice({ highlightMode: "reconstruct", toneCurve: "naka-rushton-luminance", toneCurveParameters: STANDARD, fast: true }), [0.3, 0.999, 0.3], quiet(2.5e-5)],
      [choice({ highlightMode: "reconstruct", toneCurve: "naka-rushton-luminance", toneCurveParameters: STANDARD, fast: true }), [0.3, 0.85, 0.3], quiet(6e-5)],
      [choice({ highlightMode: "reconstruct", fast: true }), [0.2, 0.75, 0.476], quiet(4e-6)]
    ];
    for (const [rendering, cm, C] of cases) {
      const coupled = createDisplayViewCoupledRendering(rendering, GAINS, 1, MATRIX)!;
      const hm = new Float64Array(3), hv = new Float64Array(3), A = new Float64Array(9);
      expect(coupled.chain(Float64Array.from(cm), Float64Array.from(C), hm, hv, A)).toBe(27);
      const mc = monteCarlo((c, out) => coupled.pixel(c[0]!, c[1]!, c[2]!, out), cm, C, 400_000);
      // The bound of the full rule's comparison: 1·10⁻³ plus four standard errors of the Monte Carlo mean.
      for (let k = 0; k < 3; k++) expect(Math.abs(hm[k]! - mc.mean[k]!)).toBeLessThan(4 * Math.sqrt(mc.variance[k]! / 400_000) + 1e-3);
    }
  }, scaledTimeout(120_000));
});

describe("desaturateToLuminance (#601)", () => {
  it("keeps the luminance and the chromaticity line through white, and leaves in-gamut pixels alone", () => {
    const w = SDR_LUMINANCE_WEIGHTS;
    expect(w[0]! + w[1]! + w[2]!).toBeCloseTo(1, 4);
    const inGamut = [0.3, 0.9, 1];
    const copy = [...inGamut];
    desaturateToLuminance(copy);
    expect(copy).toEqual(inGamut);
    for (const p of [[1.8, 0.6, 0.1], [0.1, 1.2, 0.05], [1.6, 0.3, -0.1]]) {
      const q = [...p], y = w[0]! * p[0]! + w[1]! * p[1]! + w[2]! * p[2]!;
      desaturateToLuminance(q);
      expect(Math.max(...q)).toBeCloseTo(1, 12);
      expect(w[0]! * q[0]! + w[1]! * q[1]! + w[2]! * q[2]!).toBeCloseTo(y, 4);
      // q − Y is parallel to p − Y: the same direction from the gray, so the same hue.
      const d = p.map((v) => v - y), e = q.map((v) => v - y), ratio = e[0]! / d[0]!;
      for (let k = 0; k < 3; k++) expect(e[k]!).toBeCloseTo(ratio * d[k]!, 12);
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
    }
    const white = [3, 2, 2];
    desaturateToLuminance(white);
    expect(white).toEqual([1, 1, 1]);
  });
});

const decode = (code: number, maximum: number): number => { const e = code / maximum; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
/** The reference definition: the full-resolution capture's 16-bit samples decoded, then area-averaged per display pixel. */
function areaAverage(samples: ArrayLike<number>, frameWidth: number, frameHeight: number, viewWidth: number, viewHeight: number): Float64Array {
  const sx = frameWidth / viewWidth, sy = frameHeight / viewHeight, out = new Float64Array(viewWidth * viewHeight * 3);
  for (let j = 0; j < viewHeight; j++) for (let i = 0; i < viewWidth; i++) for (let y = j * sy; y < (j + 1) * sy; y++) for (let x = i * sx; x < (i + 1) * sx; x++)
    for (let k = 0; k < 3; k++) out[(j * viewWidth + i) * 3 + k] = out[(j * viewWidth + i) * 3 + k]! + decode(samples[(y * frameWidth + x) * 3 + k]!, 65535) / (sx * sy);
  return out;
}
const channel = (a: ArrayLike<number>, k: number): number[] => Array.from({ length: a.length / 3 }, (_, i) => a[3 * i + k]!);
const average = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: readonly number[]): number => { const m = average(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

describe("the display view with coupled rendering steps against the capture (#593, #601)", () => {
  const sensor = { pixelPitchMicrometers: 3 };
  const cases: [string, SimulateCaptureOptions, number][] = [
    ["Standard look (Naka–Rushton n = 1.5, Lw = 8)", { scene: { preset: "step-wedge" }, exposure: { iso: 3200, shutterSeconds: 1 / 4000 }, sensor,
      output: { width: 192, height: 128, toneCurve: "naka-rushton-luminance", toneCurveParameters: STANDARD } }, 0.5],
    ["Flat look (Naka–Rushton n = 1, Lw = 32)", { scene: { preset: "color-patches" }, exposure: { shutterSeconds: 1 / 30 }, sensor,
      output: { width: 192, height: 128, toneCurve: "naka-rushton-luminance", toneCurveParameters: FLAT } }, 0.5],
    ["extended Reinhard, two stops over", { scene: { preset: "uniform", reflectance: 0.6 }, exposure: { shutterSeconds: 1 / 30 }, sensor,
      output: { width: 192, height: 128, toneCurve: "extended-reinhard-luminance", toneCurveParameters: { whiteLuminance: 4 } } }, 0.5],
    ["reconstruct, two stops over", { scene: { preset: "uniform", reflectance: 0.6 }, exposure: { shutterSeconds: 1 / 30 }, sensor, output: { width: 192, height: 128, highlightMode: "reconstruct" } }, 0.5],
    ["reconstruct and desaturation on a bright color chart", { scene: { preset: "color-patches" }, exposure: { shutterSeconds: 1 / 15 }, sensor,
      output: { width: 192, height: 128, highlightMode: "reconstruct", gamutHandling: "desaturate-to-luminance", toneCurve: "naka-rushton-luminance", toneCurveParameters: FLAT } }, 0.6]
  ];
  it.each(cases)("%s: the expected value is the downsized capture's mean, exact and fast", async (_name, options, limit) => {
    const capture = await simulateCapture({ ...options, output: { ...options.output, format: "srgb-16" } });
    const reference = areaAverage(capture.image.samples, 192, 128, 24, 16);
    for (const fast of [true, false]) {
      const { result, internals } = await simulateDisplayViewWithInternals({ ...options, fast }, { width: 24, height: 16, format: "srgb-16" });
      expect(result.assumptions.find((a) => a.id === "view.rendering")?.value).toMatchObject({ fast });
      // Per display pixel: 64 real pixels each, so the reference's own noise is small; within the limit plus three standard errors.
      let worst = 0;
      for (let i = 0; i < reference.length; i++) worst = Math.max(worst, Math.abs(encode8(internals.expected[i]!) - encode8(reference[i]!)));
      for (const k of [0, 1, 2]) {
        const r = channel(reference, k), e = channel(internals.expected, k), standardError = sd(r) / Math.sqrt(r.length), m = average(r);
        expect(Math.abs(encode8(average(e)) - encode8(m))).toBeLessThan(limit + encode8(m + 3 * standardError) - encode8(m));
      }
      // At ISO 3200 a 64-pixel mean of the capture is itself noisy (±8 codes in the shadows, as with the identity curve); elsewhere per pixel.
      if (options.exposure?.iso !== 3200) expect(worst).toBeLessThan(4);
    }
  }, scaledTimeout(240_000));

  it("leaves requests without the coupled steps unchanged and reports the steps", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "uniform", reflectance: 0.6 }, exposure: { shutterSeconds: 1 / 30 }, output: { width: 32, height: 32 } };
    const plain = await simulateDisplayView(options, { width: 8, height: 8 });
    expect(plain.assumptions.some((a) => a.id === "view.rendering")).toBe(false);
    const explicit = await simulateDisplayView({ ...options, output: { ...options.output, gamutHandling: "clip-components", highlightMode: "clip" } }, { width: 8, height: 8 });
    expect(Array.from(explicit.image.samples)).toEqual(Array.from(plain.image.samples));
    const coupled = await simulateDisplayView({ ...options, output: { ...options.output, highlightMode: "reconstruct" } }, { width: 8, height: 8 });
    expect(coupled.assumptions.find((a) => a.id === "view.rendering")?.value).toMatchObject({ highlightMode: "reconstruct", chainPointsPerAxis: 6, fast: true });
  }, scaledTimeout(60_000));
});

describe("the capture's desaturate-to-luminance gamut handling (#601)", () => {
  it("is off by default, keeps hue where the clip shifts it, and is refused off the sRGB rendering", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "color-patches" }, exposure: { shutterSeconds: 1 / 8 }, output: { width: 48, height: 32, format: "srgb-16",
      toneCurve: "naka-rushton-luminance", toneCurveParameters: FLAT } };
    const clip = await simulateCapture(options), same = await simulateCapture({ ...options, output: { ...options.output, gamutHandling: "clip-components" } });
    expect(Array.from(same.image.samples)).toEqual(Array.from(clip.image.samples));
    expect(clip.assumptions.some((a) => a.id === "output.gamutHandling")).toBe(false);
    const desaturated = await simulateCapture({ ...options, output: { ...options.output, gamutHandling: "desaturate-to-luminance" } });
    expect(desaturated.assumptions.find((a) => a.id === "output.gamutHandling")?.value).toMatchObject({ method: "desaturate-to-luminance" });
    // Pixels the clip changed (a component at 65535) differ; the others are equal.
    let changed = 0;
    for (let i = 0; i < clip.image.samples.length; i += 3) {
      const a = [0, 1, 2].map((k) => clip.image.samples[i + k]!), b = [0, 1, 2].map((k) => desaturated.image.samples[i + k]!);
      if (Math.max(...a) < 65535) expect(b).toEqual(a); else if (b.some((v, k) => v !== a[k])) changed++;
    }
    expect(changed).toBeGreaterThan(0);
    await expect(simulateCapture({ ...options, output: { width: 16, height: 16, format: "png", colorEncoding: "display-p3", gamutHandling: "desaturate-to-luminance" } })).rejects.toThrow(/gamutHandling/u);
  }, scaledTimeout(60_000));
});

describe("calculateSdrRendering with desaturate-to-luminance (#601)", () => {
  it("desaturates out-of-gamut pixels before the clip and keeps the tone samples as mapped", () => {
    const profile = { schemaVersion: "0.1.0" as const, profileId: "p", profileVersion: "1", renderingExposureEv: 0, toneCurve: "identity" as const,
      outputDynamicRange: "sdr" as const, transferFunction: "srgb" as const, bitDepth: 16 as const, rounding: "nearest-ties-up" as const, dither: "none" as const };
    const input = { sourceImageStateId: "s", inputImageState: "color-transformed-linear-rgb" as const, inputColorSpace: "linear-srgb-d65" as const,
      whiteBalanceHandling: "not-required" as const, pixelWidth: 2, pixelHeight: 1, referenceWhiteValue: 1, samples: [1.6, 0.3, 0.1, 0.2, 0.4, 0.6] };
    const clip = calculateSdrRendering({ ...input, profile: { ...profile, gamutHandling: "clip-components" } }).value;
    const desat = calculateSdrRendering({ ...input, profile: { ...profile, gamutHandling: "desaturate-to-luminance" } }).value;
    expect(desat.toneMappedLinearSamples).toEqual(clip.toneMappedLinearSamples);
    const expected = [1.6, 0.3, 0.1];
    desaturateToLuminance(expected);
    expect(desat.outputLinearSamples.slice(0, 3)).toEqual(expected.map((v) => Math.min(1, Math.max(0, v))));
    expect(desat.outputLinearSamples.slice(3)).toEqual(clip.outputLinearSamples.slice(3));
  });
});
