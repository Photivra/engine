// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { sampleBinomial } from "../src/sensor/binomial-sample.js";
import { createDeterministicUniformStream } from "../src/sensor/stochastic-seed.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/** The binomial probability mass function over the mode ± 12 standard deviations (the rest is below 1e-30), normalized there. */
function pmf(n: number, p: number): { from: number; values: Float64Array } {
  const q = 1 - p, sd = Math.sqrt(n * p * q), m = Math.floor((n + 1) * p);
  const from = Math.max(0, Math.floor(m - 12 * sd - 12)), to = Math.min(n, Math.ceil(m + 12 * sd + 12));
  const values = new Float64Array(to - from + 1);
  values[m - from] = 1;
  for (let k = m; k < to; k++) values[k + 1 - from] = values[k - from]! * (n - k) / (k + 1) * p / q;
  for (let k = m; k > from; k--) values[k - 1 - from] = values[k - from]! * k / (n - k + 1) * q / p;
  const total = values.reduce((a, b) => a + b, 0);
  return { from, values: values.map((v) => v / total) };
}

/** Pearson's chi-square of `draws` against the PMF, cells merged until each expects at least 10 draws; with its degrees of freedom. */
function chiSquare(draws: Int32Array | number[], n: number, p: number): { statistic: number; df: number } {
  const { from, values } = pmf(n, p), counts = new Float64Array(values.length);
  for (const k of draws) {
    expect(k >= from && k < from + values.length, "draw " + k + " outside the mode ± 12 sd").toBe(true);
    counts[k - from]! += 1;
  }
  const total = draws.length;
  let statistic = 0, cells = 0, expected = 0, observed = 0;
  for (let i = 0; i < values.length; i++) {
    expected += values[i]! * total; observed += counts[i]!;
    if (expected >= 10 && values.slice(i + 1).reduce((a, b) => a + b, 0) * total >= 10) { statistic += (observed - expected) ** 2 / expected; cells++; expected = 0; observed = 0; }
  }
  if (expected > 0) { statistic += (observed - expected) ** 2 / expected; cells++; }
  return { statistic, df: cells - 1 };
}

describe("sampleBinomial (#534)", () => {
  // Inversion (n·p < 10), the symmetric branch (p > 1/2) and BTRS (n·min(p, 1 − p) ≥ 10), from small to full-well-sized counts.
  const cases: [number, number][] = [[1, 0.5], [20, 0.3], [9, 0.9], [200, 0.04], [40, 0.25], [1000, 0.37], [60000, 0.5], [60000, 0.999], [123457, 0.8], [10_000_000, 0.2]];
  for (const [n, p] of cases) {
    it("follows Binomial(" + n + ", " + p + "): chi-square of the PMF and the moments", () => {
      const random = createDeterministicUniformStream(0x5eed + n), count = 200_000, draws = new Int32Array(count);
      for (let i = 0; i < count; i++) draws[i] = sampleBinomial(n, p, random);
      const { statistic, df } = chiSquare(draws, n, p);
      // A five-sigma bound on the chi-square statistic (mean df, variance 2·df).
      expect(statistic, "chi-square " + statistic + " with " + df + " df").toBeLessThan(df + 5 * Math.sqrt(2 * Math.max(df, 1)));
      const mean = draws.reduce((a, b) => a + b, 0) / count, variance = draws.reduce((a, b) => a + (b - mean) ** 2, 0) / (count - 1);
      const expectedVariance = n * p * (1 - p);
      expect(Math.abs(mean - n * p)).toBeLessThan(5 * Math.sqrt(expectedVariance / count) + 1e-12);
      if (expectedVariance > 0.1) expect(Math.abs(variance / expectedVariance - 1)).toBeLessThan(5 * Math.sqrt(2 / count) * 1.5);
      // 2.24.0: an explicit deadline with margin (the 10,000,000-trial case took up to 7 s under coverage and timed out once at the
      // 5 s default on a slow runner).
    }, scaledTimeout(60_000));
  }

  it("returns the edges exactly, reproduces its draws and refuses bad input", () => {
    const random = createDeterministicUniformStream(1);
    expect(sampleBinomial(0, 0.3, random)).toBe(0);
    expect(sampleBinomial(17, 0, random)).toBe(0);
    expect(sampleBinomial(17, 1, random)).toBe(17);
    const a = createDeterministicUniformStream(9), b = createDeterministicUniformStream(9);
    for (let i = 0; i < 100; i++) expect(sampleBinomial(5000, 0.3, a)).toBe(sampleBinomial(5000, 0.3, b));
    for (const [n, p] of [[-1, 0.5], [2.5, 0.5], [10, -0.1], [10, 1.5], [10, Number.NaN], [Number.POSITIVE_INFINITY, 0.5]])
      expect(() => sampleBinomial(n!, p!, random)).toThrow("Binomial draws need");
  }, scaledTimeout(60_000));
});
