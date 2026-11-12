// SPDX-License-Identifier: Apache-2.0
/**
 * #605 (2.23.0): the full neighbor method's SOR with the optimal relaxation factor of the region's bounding rectangle
 * (`neighborHighlightOmega`, src/color/neighbor-highlight-reconstruction.ts) against 2.22.0's fixed ω = 1.8: both stop at the
 * same tolerance (the largest change of a sweep below 10⁻⁹); the new factor needs far fewer sweeps and lands at least as close
 * to the converged harmonic fill.
 */
import { describe, expect, it } from "vitest";
import { NEIGHBOR_HIGHLIGHT_MARGIN, NEIGHBOR_HIGHLIGHT_SOR, neighborHighlightOmega, neighborHighlightRatios } from "../src/color/neighbor-highlight-reconstruction.js";

/** A clipped square of side n in a smoothly colored field (the timing file's scene, test/webgpu/neighbor-fill-page.ts). */
function field(n: number): { W: number; clippedAt: (i: number) => boolean; valueAt: (i: number, out: Float64Array) => void } {
  const pad = NEIGHBOR_HIGHLIGHT_MARGIN + 4, W = n + 2 * pad;
  return {
    W,
    clippedAt: (i): boolean => { const x = i % W, y = (i - x) / W; return x >= pad && x < pad + n && y >= pad && y < pad + n; },
    valueAt: (i, out): void => { const x = i % W, y = (i - x) / W; out[0] = 0.5 + 0.3 * Math.sin(x / 7); out[1] = 0.6 + 0.2 * Math.cos(y / 5); out[2] = 0.4 + 0.2 * Math.sin((x + y) / 9); }
  };
}
/** SOR over the unknown pixels (row-major order) from start values, with factor ω, until the largest change is below `tolerance`. */
function sor(W: number, unknown: Uint8Array, start: Float64Array, omega: number, tolerance: number): { ratios: Float64Array; sweeps: number } {
  const ratios = Float64Array.from(start);
  let sweeps = 0, change = Infinity;
  while (change > tolerance && sweeps < 200_000) {
    change = 0; sweeps++;
    for (let p = 0; p < W * W; p++) {
      if (unknown[p] === 0) continue;
      const x = p % W, y = (p - x) / W, q = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < W - 1 ? p + W : -1].filter((v) => v >= 0);
      for (let c = 0; c < 3; c++) {
        let a = 0;
        for (const v of q) a += ratios[3 * v + c]!;
        const old = ratios[3 * p + c]!, next = old + omega * (a / q.length - old);
        ratios[3 * p + c] = next;
        change = Math.max(change, Math.abs(next - old));
      }
    }
  }
  return { ratios, sweeps };
}

describe("the full neighbor method's relaxation factor (#605)", () => {
  it("is Young's optimum of the bounding rectangle (2/(1 + sin(π/(n + 1))) for a square)", () => {
    for (const n of [1, 8, 64, 260]) expect(neighborHighlightOmega(n, n)).toBeCloseTo(2 / (1 + Math.sin(Math.PI / (n + 1))), 12);
    expect(neighborHighlightOmega(10, 200)).toBeGreaterThan(neighborHighlightOmega(10, 10));
    expect(neighborHighlightOmega(10, 200)).toBeLessThan(2);
  });

  it("reaches the same tolerance in far fewer sweeps than ω = 1.8, at least as close to the converged fill", () => {
    const records: Record<string, number>[] = [];
    for (const n of [16, 64, 128]) {
      const { W, clippedAt, valueAt } = field(n), fast = neighborHighlightRatios(W, W, clippedAt, valueAt, true);
      let t = performance.now();
      const full = neighborHighlightRatios(W, W, clippedAt, valueAt, false);
      const newMs = performance.now() - t;
      expect(full.converged).toBe(true);
      // The unknown pixels (the clipped square widened by the margin) and the converged fill (a 10⁻¹⁴ tolerance).
      const unknown = new Uint8Array(W * W), m = NEIGHBOR_HIGHLIGHT_MARGIN, pad = m + 4;
      for (let p = 0; p < W * W; p++) { const x = p % W, y = (p - x) / W; if (x >= pad - m && x < pad + n + m && y >= pad - m && y < pad + n + m) unknown[p] = 1; }
      const side = n + 2 * m, omega = neighborHighlightOmega(side, side);
      const exact = sor(W, unknown, fast.ratios, omega, 1e-14).ratios;
      t = performance.now();
      const old = sor(W, unknown, fast.ratios, 1.8, NEIGHBOR_HIGHLIGHT_SOR.tolerance);
      const oldMs = performance.now() - t;
      let newError = 0, oldError = 0;
      for (let p = 0; p < W * W; p++) if (unknown[p]) for (let c = 0; c < 3; c++) {
        newError = Math.max(newError, Math.abs(full.ratios[3 * p + c]! - exact[3 * p + c]!));
        oldError = Math.max(oldError, Math.abs(old.ratios[3 * p + c]! - exact[3 * p + c]!));
      }
      records.push({ n, newSweeps: full.iterations, oldSweeps: old.sweeps, newError, oldError, newMs: Math.round(newMs), oldMs: Math.round(oldMs) });
      expect(newError).toBeLessThanOrEqual(Math.max(oldError, 1e-9));
      expect(newError).toBeLessThan(1e-7);
      if (n >= 64) expect(full.iterations).toBeLessThan(0.4 * old.sweeps);
    }
    process.stdout.write("[neighbor SOR] " + JSON.stringify(records) + "\n");
  }, 120_000);
});
