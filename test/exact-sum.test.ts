// SPDX-License-Identifier: Apache-2.0
// 2.21.0: the display view kernels' integer sum (src/gpu/wgsl-exact-sum.ts), through its JavaScript mirror: one rounding of the exact sum.
import { describe, expect, it } from "vitest";
import { ExactSum } from "./helpers/exact-sum-emulation.js";
import { EXACT_SUM_WGSL } from "../src/gpu/wgsl-exact-sum.js";

const f = Math.fround;
/** The exact sum of float32 values (as a BigInt in units of 2^-200, every term here a multiple of it), and that sum as a double. */
function exact(values: readonly number[]): number {
  let total = 0n;
  for (const v of values) {
    if (v === 0) continue;
    const e = Math.floor(Math.log2(v)) - 30, m = v / 2 ** e;
    total += BigInt(m) << BigInt(e + 200);
  }
  const bits = total.toString(2).length, shift = Math.max(0, bits - 60);
  return Number(total >> BigInt(shift)) * 2 ** (shift - 200);
}

describe("integer sum of the display view kernels (2.21.0)", () => {
  it("is within one float32 rounding of the exact sum of up to 255 non-negative terms", () => {
    let seed = 581;
    const random = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const sum = new ExactSum();
    for (let trial = 0; trial < 3000; trial++) {
      const n = 1 + Math.floor(random() * 255), spread = Math.floor(random() * 40);
      const values = Array.from({ length: n }, () => (random() < 0.05 ? 0 : f((0.5 + random()) * 2 ** (Math.floor(random() * spread) - 20))));
      sum.reset(Math.max(1, ...values.filter((v) => v > 0).map((v) => ExactSum.exponent(v))));
      for (const v of values) sum.add(v);
      const want = exact(values), got = sum.round();
      expect(Math.abs(got - want)).toBeLessThanOrEqual(want * (2 ** -23 + 2 ** -30));
    }
  });
  it("sums exactly representable totals exactly", () => {
    const sum = new ExactSum();
    sum.reset(ExactSum.exponent(1)); sum.add(1); sum.add(2 ** -23); sum.add(2 ** -24); sum.add(2 ** -24);
    expect(sum.round()).toBe(f(1 + 2 ** -22));
    sum.reset(1); expect(sum.round()).toBe(0);
  });
  it("declares each helper once", () => {
    for (const name of ["exact_exponent", "exact_add", "exact_round"]) expect(EXACT_SUM_WGSL.match(new RegExp(`fn ${name}\\(`, "gu"))).toHaveLength(1);
  });
});
