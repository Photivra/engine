// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { InvalidConfigurationError } from "../src/index.js";
import { createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import { SITE_KERNEL_RUNS_MAXIMUM_READS, convolveSiteKernelRuns, createSiteKernelRunsLattice, siteKernelRuns } from "../src/optics/site-kernel-runs.js";

/*
 * #564: the run convolution of large site kernels is the direct gather regrouped: equal to it to rounding, for the disc and
 * for any kernel, and its tiled lattice gives every value independently of the order of the queries.
 */

/** A deterministic pseudo-random sample stream (xorshift32) in [0, 1). */
function stream(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** out(x, y) = Σ_t K(t)·source(x + R − t_u, y + R − t_v), the direct gather. */
function direct(source: Float64Array, width: number, height: number, weights: Float64Array, R: number): Float64Array {
  const sw = width + 2 * R, kw = 2 * R + 1, out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) sum += weights[(v + R) * kw + u + R]! * source[(y + R - v) * sw + x + R - u]!;
    out[y * width + x] = sum;
  }
  return out;
}

describe("siteKernelRuns and convolveSiteKernelRuns (#564)", () => {
  it("decompose the disc into one run per row and its edge cells", () => {
    for (const [diameter, radius] of [[131, 65], [358.1, 179], [1025, 512]] as const) {
      const kernel = createDefocusDiscSiteKernel(diameter)!;
      expect(kernel.radius).toBe(radius);
      const runs = siteKernelRuns(kernel.weights, kernel.radius);
      // The interior cells share one weight: a single group (the centre row splits around the centre's own weight).
      expect(runs.groupWeights.length).toBe(1);
      expect(runs.runV.length).toBeLessThanOrEqual(2 * radius + 2);
      expect(runs.readsPerOutput).toBeLessThan(13 * radius);
      expect(runs.readsPerOutput).toBeLessThanOrEqual(SITE_KERNEL_RUNS_MAXIMUM_READS);
    }
  });

  it("equal the direct gather to rounding for the disc, with non-negative outputs", () => {
    const kernel = createDefocusDiscSiteKernel(150.7)!, R = kernel.radius, width = 24, height = 10;
    const random = stream(7), source = Float64Array.from({ length: (width + 2 * R) * (height + 2 * R) }, () => (random() < 0.5 ? 0 : 0.1 + random()));
    const expected = direct(source, width, height, kernel.weights, R), actual = convolveSiteKernelRuns(source, width, height, siteKernelRuns(kernel.weights, R));
    let worst = 0;
    for (let k = 0; k < expected.length; k++) { worst = Math.max(worst, Math.abs(actual[k]! - expected[k]!) / expected[k]!); expect(actual[k]).toBeGreaterThanOrEqual(0); }
    expect(worst).toBeLessThan(1e-13);
  });

  it("equal the direct gather for an arbitrary kernel with runs, taps and several weights", () => {
    const R = 4, kw = 2 * R + 1, weights = new Float64Array(kw * kw);
    for (let k = 0; k < weights.length; k++) weights[k] = [0, 0.25, 0.25, 0.25, 0.5, 0.125][k % 6]! / 20;
    const width = 9, height = 5, random = stream(3), source = Float64Array.from({ length: (width + 2 * R) * (height + 2 * R) }, () => random());
    const expected = direct(source, width, height, weights, R), actual = convolveSiteKernelRuns(source, width, height, siteKernelRuns(weights, R));
    for (let k = 0; k < expected.length; k++) expect(actual[k]).toBeCloseTo(expected[k]!, 14);
  });

  it("refuse a kernel with no uniform runs whose reads per site exceed the direct gather at radius 64", () => {
    const R = 70, kw = 2 * R + 1, random = stream(11), weights = Float64Array.from({ length: kw * kw }, () => random() / (kw * kw));
    expect(() => siteKernelRuns(weights, R)).toThrow(InvalidConfigurationError);
    expect(() => siteKernelRuns(weights, R)).toThrow(/^lens\.defocus: this blur needs [0-9,]+ reads per site; above a kernel radius of 64 sites the limit is 16,641\. Reduce the spherical aberration or the defocus\.$/u);
  });

  it("refuse bad samples and shapes", () => {
    const runs = siteKernelRuns(createDefocusDiscSiteKernel(5)!.weights, 2);
    expect(() => convolveSiteKernelRuns(new Float64Array(10), 2, 2, runs)).toThrow(InvalidConfigurationError);
    const bad = new Float64Array(36); bad[3] = -1;
    expect(() => convolveSiteKernelRuns(bad, 2, 2, runs)).toThrow(/non-negative/u);
    expect(() => siteKernelRuns(new Float64Array(8), 1)).toThrow(InvalidConfigurationError);
  });
});

describe("createSiteKernelRunsLattice (#564)", () => {
  it("gives the same value for a lattice point whatever the order of the queries and the cache size", () => {
    const kernel = createDefocusDiscSiteKernel(140)!, runs = siteKernelRuns(kernel.weights, kernel.radius);
    // A sharp-edged scene: 1 left of x = 5, 0.2 right of it, as a function of the lattice point.
    const source = (x0: number, y0: number, w: number, h: number) => (field: number): Float64Array =>
      Float64Array.from({ length: w * h }, (_, k) => ((x0 + (k % w)) < 5 ? 1 : 0.2) * (field + 1) + ((y0 + Math.floor(k / w)) % 7) * 0.01);
    const a = createSiteKernelRunsLattice({ runs, tile: 16, fields: 2, source });
    const b = createSiteKernelRunsLattice({ runs, tile: 16, fields: 2, source, capacityBytes: 1 });
    const points = [[3, 4], [-40, 2], [17, -33], [5, 5], [100, 9]] as const;
    const first = points.map(([x, y]) => [a.valueAt(0, x, y), a.valueAt(1, x, y)]);
    const reversed = [...points].reverse().map(([x, y]) => [b.valueAt(0, x, y), b.valueAt(1, x, y)]).reverse();
    expect(reversed).toEqual(first);
    // Far from the edge (beyond the radius) the value is the uniform level plus the row ripple's disc average.
    expect(a.valueAt(0, 100, 9)).toBeGreaterThan(0.2);
    expect(a.valueAt(0, 100, 9)).toBeLessThan(0.3);
  });

  it("computes only the outputs a CFA pattern asks for", () => {
    const runs = siteKernelRuns(createDefocusDiscSiteKernel(9)!.weights, 4);
    const source = (_x0: number, _y0: number, w: number, h: number) => (): Float64Array => new Float64Array(w * h).fill(1);
    const lattice = createSiteKernelRunsLattice({ runs, tile: 4, fields: 1, source, pattern: () => (row: number): { start: number; step: number } | null => (row % 2 === 0 ? { start: 1, step: 2 } : null) });
    expect(lattice.valueAt(0, 1, 0)).toBeCloseTo(1, 14);
    expect(lattice.valueAt(0, 0, 0)).toBe(0);
    expect(lattice.valueAt(0, 1, 1)).toBe(0);
  });
});
