// SPDX-License-Identifier: Apache-2.0
/**
 * JavaScript mirror of `EXACT_SUM_WGSL` (src/gpu/wgsl-exact-sum.ts), line by line in 32-bit integer arithmetic: the sum of
 * non-negative float32 values in a 64-bit accumulator; the final conversion rounds to nearest (one of the WGSL-permitted neighbours).
 */
const bitsOf = new Float32Array(1), wordOf = new Uint32Array(bitsOf.buffer);
const toBits = (v: number): number => { bitsOf[0] = v; return wordOf[0]!; };
const f = Math.fround;

export class ExactSum {
  lo = 0;
  hi = 0;
  anchor = 1;
  /** Resets the accumulator with the largest biased exponent of the terms to come. */
  reset(anchor: number): void { this.lo = 0; this.hi = 0; this.anchor = anchor; }
  static exponent(v: number): number { return Math.max((toBits(v) >>> 23) & 0xff, 1); }
  add(v: number): void {
    const bits = toBits(v), be = (bits >>> 23) & 0xff, m = ((bits & 0x7fffff) | (be !== 0 ? 0x800000 : 0)) >>> 0, s = this.anchor - Math.max(be, 1);
    let lo = 0, hi = 0;
    if (s === 0) hi = m; else if (s < 32) { hi = m >>> s; lo = (m << (32 - s)) >>> 0; } else if (s < 56) lo = m >>> (s - 32);
    const t = (this.lo + lo) >>> 0;
    this.hi = (this.hi + hi + (t < lo ? 1 : 0)) >>> 0;
    this.lo = t;
  }
  round(): number {
    // Shift amounts are taken modulo 32, as in WGSL: a zero high word (z = 32) leaves the low word.
    const z = Math.clz32(this.hi), t = ((this.hi << z) | (z !== 0 ? this.lo >>> (32 - z) : 0)) >>> 0;
    return f(f(t) * 2 ** (this.anchor - 150 - z));
  }
}
