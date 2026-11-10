// SPDX-License-Identifier: Apache-2.0

/**
 * Internal (#534): a seeded binomial draw, for splitting a realized charge count between an earlier and a later part of one
 * exposure. Not exported from the package.
 *
 * - Mean n·min(p, 1 − p) below 10: inversion, the sequential search of the cumulative distribution from 0 with the recurrence
 *   f(x) = f(x − 1)·((n + 1)·s / x − s), s = p/(1 − p) (L. Devroye, Non-Uniform Random Variate Generation, Springer 1986, free
 *   from the author's site, chapter X, section 4 "The binomial distribution").
 * - Otherwise: BTRS, transformed rejection with squeeze (W. Hörmann, "The generation of binomial random variates", Preprint Series
 *   of the Department of Applied Statistics and Data Processing, WU Vienna, no. 1, April 1992, free,
 *   doi:10.57938/79ec156b-9c3d-4b5d-a939-07a1846443fd), the binomial companion of the PTRS Poisson sampler `samplePoisson` uses.
 *   Its acceptance test compares log(f(k)/f(m)) at the mode m with Stirling's series for log x! (tail terms 1/12, −1/360, 1/1260
 *   in 1/(x + 1); exact sums below 10). The hat constants (b, a, c, v_r, α) are BTRS's as implemented in widely used libraries;
 *   they could not be checked against the preprint's text here, so the chi-square tests of the probability mass function in
 *   test/binomial-sample.test.ts are the evidence that the draws follow the binomial distribution.
 * - p > 1/2 draws n − Binomial(n, 1 − p).
 *
 * Both methods are exact (they draw from the binomial distribution itself, not an approximation of it) up to floating-point
 * rounding of the probabilities. The same n, p and stream reproduce the same draw. The tests check the probability mass
 * function by a chi-square test and the moments.
 */

import { InvalidScientificInputError } from "../core/validation.js";
import type { DeterministicUniformStream } from "./stochastic-seed.js";

const HALF_LOG_TWO_PI = 0.5 * Math.log(2 * Math.PI);
/** log x! − ((x + ½)·log(x + 1) − (x + 1) + ½·log 2π) for x = 0 … 9, from the exact sums. */
const SMALL_TAILS = ((): Float64Array => {
  const table = new Float64Array(10);
  let logFactorial = 0;
  for (let x = 0; x < 10; x++) {
    if (x > 1) logFactorial += Math.log(x);
    table[x] = logFactorial - ((x + 0.5) * Math.log(x + 1) - (x + 1) + HALF_LOG_TWO_PI);
  }
  return table;
})();
function stirlingTail(x: number): number {
  if (x < 10) return SMALL_TAILS[x]!;
  const z = x + 1, z2 = z * z;
  return (1 / 12 - (1 / 360 - 1 / 1260 / z2) / z2) / z;
}

/** Draws Binomial(n, p): n a non-negative safe integer, 0 ≤ p ≤ 1. */
export function sampleBinomial(n: number, p: number, random: DeterministicUniformStream): number {
  if (!Number.isSafeInteger(n) || n < 0 || !(p >= 0 && p <= 1)) throw new InvalidScientificInputError("Binomial draws need a non-negative integer count and a probability in [0, 1].");
  if (n === 0 || p === 0) return 0;
  if (p === 1) return n;
  if (p > 0.5) return n - sampleBinomial(n, 1 - p, random);
  const q = 1 - p;
  if (n * p < 10) {
    const s = p / q, a = (n + 1) * s, start = Math.exp(n * Math.log(q));
    for (;;) {
      let u = random.next(), f = start, x = 0;
      // Rounding can leave a remainder above the last probability: draw again (the remainder is of the order of 1e-16).
      while (u > f && x < n) { u -= f; x++; f *= a / x - s; }
      if (u <= f) return x;
    }
  }
  const spq = Math.sqrt(n * p * q), b = 1.15 + 2.53 * spq, a = -0.0873 + 0.0248 * b + 0.01 * p, c = n * p + 0.5, vr = 0.92 - 4.2 / b;
  const r = p / q, alpha = (2.83 + 5.1 / b) * spq, m = Math.floor((n + 1) * p);
  const modeTerm = (m + 0.5) * Math.log((m + 1) / (r * (n - m + 1))) + stirlingTail(m) + stirlingTail(n - m);
  for (;;) {
    const u = random.next() - 0.5, us = 0.5 - Math.abs(u);
    let v = random.next();
    if (us <= 0) continue;
    const k = Math.floor((2 * a / us + b) * u + c);
    if (k < 0 || k > n) continue;
    if (us >= 0.07 && v <= vr) return k;
    v = Math.log(v * alpha / (a / (us * us) + b));
    // log(f(k)/f(m)) by Stirling's series, in a form without the cancellation of large log-factorials.
    const bound = modeTerm + (n + 1) * Math.log((n - m + 1) / (n - k + 1)) + (k + 0.5) * Math.log(r * (n - k + 1) / (k + 1)) - stirlingTail(k) - stirlingTail(n - k);
    if (v <= bound) return k;
  }
}
