// SPDX-License-Identifier: Apache-2.0

/**
 * A sum of non-negative float32 values in integer arithmetic (2.21.0), for the display view's kernels, which integrate a site's
 * signal from the material spectrum per site: Σ_n A_c(λ_n)·L_m(λ_n) (Speed) and the per-node partials Σ_n P_n plus the dark
 * electrons (Quality). Integer operations are exact on every device (W3C WGSL § 8.6), so the sum depends on no rounding mode,
 * fusion or reassociation, and only the final conversion rounds:
 *
 * - **Accumulator.** 64 bits in two words. The caller first takes `anchor`, the largest biased exponent among the terms
 *   (`exact_exponent`); each term's 24-bit significand m is added with its least significant bit at bit 32 − (anchor − e), so the
 *   largest term occupies bits 32 … 55 and up to 255 terms cannot carry past bit 63.
 * - **Truncation.** Bits that fall below bit 0 are dropped: each term loses less than one unit of 2^(anchor − 182), so N ≤ 255
 *   terms lose less than 2⁻⁴⁷ of the largest term, relative.
 * - **Result.** The accumulator's top 32 bits (truncated: below 2⁻³¹ relative; with a zero high word, the low word, as WGSL takes
 *   shift amounts modulo 32) converted to float32, which rounds to one of the
 *   two neighbours (W3C WGSL, "Floating Point Conversion"), then scaled by a power of two with `ldexp` (exact): at most one
 *   rounding, E relative, for any number of terms. A result below the float32 normal range may be flushed to 0 (an absolute error
 *   below 2⁻¹²⁶, which the hosts' absolute terms cover); the hosts keep every sum far below the float32 overflow threshold.
 *
 * Mirrored line by line in JavaScript by test/helpers/exact-sum-emulation.ts.
 */
export const EXACT_SUM_WGSL = /* wgsl */ `
struct ExactSum { lo: u32, hi: u32, anchor: u32 }
fn exact_exponent(v: f32) -> u32 { return max((bitcast<u32>(v) >> 23u) & 0xffu, 1u); }
fn exact_add(a: ptr<function, ExactSum>, v: f32) {
  let bits = bitcast<u32>(v);
  let be = (bits >> 23u) & 0xffu;
  let m = (bits & 0x7fffffu) | select(0u, 0x800000u, be != 0u);
  let s = (*a).anchor - max(be, 1u);
  var lo = 0u;
  var hi = 0u;
  if (s == 0u) { hi = m; } else if (s < 32u) { hi = m >> s; lo = m << (32u - s); } else if (s < 56u) { lo = m >> (s - 32u); }
  let t = (*a).lo + lo;
  (*a).hi = (*a).hi + hi + select(0u, 1u, t < lo);
  (*a).lo = t;
}
fn exact_round(a: ptr<function, ExactSum>) -> f32 {
  let z = countLeadingZeros((*a).hi);
  let t = ((*a).hi << z) | select(0u, (*a).lo >> (32u - z), z != 0u);
  return ldexp(f32(t), i32((*a).anchor) - 150 - i32(z));
}
`;
