// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { approximationResult, calculatedResult, InvalidScientificResultError } from "../src/index.js";
import { calculationValueContainsNonFiniteNumber, calculationValueContainsNonFiniteNumberExact } from "../src/core/calculation-result.js";

/** Independent copy of the diagnostic path walk: the error message contract that must not change. */
function referencePath(value: unknown, path = "value", seen = new WeakSet<object>()): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? undefined : path;
  if (typeof value !== "object" || value === null || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    let found: string | undefined;
    value.forEach((entry, index) => { found ??= referencePath(entry, `${path}[${index}]`, seen); });
    return found;
  }
  for (const [key, entry] of Object.entries(value)) {
    const found = referencePath(entry, `${path}.${key}`, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function thrown(value: unknown): unknown {
  try { calculatedResult(value, "finite-test", "1"); } catch (error) { return error; }
  return undefined;
}

describe("calculation result finite-number validation", () => {
  it.each([
    ["top level", NaN, "value"],
    ["nested arrays and records", { a: { b: [1, 2, { c: NaN }] } }, "value.a.b[2].c"],
    ["first failure in key order", { a: 1, b: Infinity, c: -Infinity }, "value.b"],
    ["nested result envelope", { inner: approximationResult({ x: [1, 2] }, "m", "1", ["a"]), tail: { y: [0, -Infinity] } }, "value.tail.y[1]"],
    ["sparse array holes skipped", [, , NaN], "value[2]"], // eslint-disable-line no-sparse-arrays
    ["typed-array entries", { t: Float64Array.of(1, 2, NaN) }, "value.t.2"]
  ])("throws the unchanged error type and path for %s", (_name, value, path) => {
    const error = thrown(value);
    expect(error).toBeInstanceOf(InvalidScientificResultError);
    expect((error as Error).message).toBe(`Calculation produced a non-finite number at ${path}.`);
  });

  it("reports the first path through shared references and skips cycles", () => {
    const shared = { x: NaN }, cyclic: Record<string, unknown> = { n: 1 };
    cyclic.self = cyclic; cyclic.bad = -Infinity;
    expect((thrown({ a: shared, b: shared }) as Error).message).toBe("Calculation produced a non-finite number at value.a.x.");
    expect((thrown({ c: cyclic }) as Error).message).toBe("Calculation produced a non-finite number at value.c.bad.");
    const finite: Record<string, unknown> = { n: 1, list: [1, 2] };
    finite.self = finite;
    expect(calculatedResult({ a: finite, b: finite }, "finite-test", "1").value.a).toBe(finite);
  });

  it("matches the diagnostic walk on seeded random nested values", () => {
    let state = 0x2750_0001;
    const random = (): number => { state = (Math.imul(state, 1664525)+1013904223) >>> 0; return state/2**32; };
    const leaf = (): unknown => { const r = random();
      return r < .03 ? NaN : r < .05 ? Infinity : r < .07 ? -Infinity : r < .5 ? random()*1e6-5e5 : r < .7 ? "s" : r < .8 ? null : true; };
    const pool: object[] = [];
    const tree = (depth: number): unknown => {
      const r = random();
      if (depth > 4 || r < .35) return leaf();
      if (r < .4 && pool.length > 0) return pool[Math.floor(random()*pool.length)];
      const node: unknown = r < .7 ? Array.from({ length: Math.floor(random()*5) }, () => tree(depth+1))
        : Object.fromEntries(Array.from({ length: Math.floor(random()*5) }, (_, i) => [`k${i}`, tree(depth+1)]));
      pool.push(node as object);
      return node;
    };
    let failures = 0;
    for (let trial = 0; trial < 400; trial++) {
      pool.length = 0;
      const value = tree(0), path = referencePath(value), error = thrown(value);
      if (path === undefined) { expect(error).toBeUndefined(); continue; }
      failures++;
      expect(error).toBeInstanceOf(InvalidScientificResultError);
      expect((error as Error).message).toBe(`Calculation produced a non-finite number at ${path}.`);
    }
    expect(failures).toBeGreaterThan(50);
  });

  describe("memo-free pre-scan (2.0 performance)", () => {
    const same = (value: unknown): void => {
      expect(calculationValueContainsNonFiniteNumber(value)).toBe(calculationValueContainsNonFiniteNumberExact(value));
    };

    it("matches the exact visited-set scan on cycles, shared references, typed arrays, frozen and null-prototype objects", () => {
      const cyclic: Record<string, unknown> = { a: 1 }; cyclic.self = cyclic;
      const cyclicBad: Record<string, unknown> = { a: 1 }; cyclicBad.self = cyclicBad; cyclicBad.z = NaN;
      const shared = { x: [1, 2, 3] }, sharedBad = { x: [1, -Infinity] };
      const bare = Object.assign(Object.create(null) as Record<string, unknown>, { n: 1, m: { k: Infinity } });
      for (const value of [0, NaN, Infinity, -Infinity, "x", null, undefined, true, 1n, Symbol("s"), (): number => NaN,
        cyclic, cyclicBad, { a: shared, b: shared, c: [shared, shared] }, { a: shared, b: sharedBad },
        Float64Array.of(1, 2, 3), Float64Array.of(1, NaN), Float32Array.of(Infinity), new Uint8Array(4), new Map([[1, NaN]]), new Set([NaN]),
        Object.freeze({ a: Object.freeze([1, 2]), b: Object.freeze({ c: 3 }) }), Object.freeze({ a: Object.freeze([1, NaN]) }),
        bare, [, , 1], [, NaN], Object.assign([1, 2], { extra: NaN }), new Date(NaN), { get g(): number { return NaN; } }]) same(value); // eslint-disable-line no-sparse-arrays
    });

    it("falls back past its depth and visit budgets with the same answer", () => {
      // Depth beyond the memo-free bound, finite and non-finite at the bottom.
      let deep: unknown = 1, deepBad: unknown = NaN;
      for (let depth = 0; depth < 200; depth++) { deep = { next: deep }; deepBad = [deepBad]; }
      same(deep); same(deepBad);
      expect(calculationValueContainsNonFiniteNumber(deep)).toBe(false);
      expect(calculationValueContainsNonFiniteNumber(deepBad)).toBe(true);
      // A 40-level diamond chain has 2^40 paths: the visit budget is exhausted and the exact scan decides.
      let diamond: unknown = { leaf: 1 }, diamondBad: unknown = { leaf: Infinity };
      for (let level = 0; level < 40; level++) { diamond = { left: diamond, right: diamond }; diamondBad = { left: diamondBad, right: diamondBad }; }
      same(diamond); same(diamondBad);
      expect(calculationValueContainsNonFiniteNumber(diamond)).toBe(false);
      expect(calculationValueContainsNonFiniteNumber(diamondBad)).toBe(true);
      // Wide trees with more objects than the visit budget.
      const wide = Array.from({ length: 70_000 }, (_, i) => ({ i })), wideBad = [...wide, { i: NaN }];
      same(wide); same(wideBad);
    });

    it("restores its budget across a re-entrant scan from an accessor", () => {
      let inner: boolean | undefined;
      const value = { get nested(): number { inner = calculationValueContainsNonFiniteNumber({ q: [1, 2, { r: 3 }] }); return 1; }, bad: NaN };
      expect(calculationValueContainsNonFiniteNumber(value)).toBe(true);
      expect(inner).toBe(false);
    });

    it("matches on seeded random graphs with cycles, sharing and typed arrays", () => {
      let state = 0x2750_0003;
      const random = (): number => { state = (Math.imul(state, 1664525)+1013904223) >>> 0; return state/2**32; };
      for (let trial = 0; trial < 500; trial++) {
        const nodes: (Record<string, unknown> | unknown[])[] = [];
        const count = 1+Math.floor(random()*30);
        for (let i = 0; i < count; i++) nodes.push(random() < .4 ? [] : random() < .1 ? Object.create(null) as Record<string, unknown> : {});
        for (const node of nodes) {
          const edges = Math.floor(random()*5);
          for (let e = 0; e < edges; e++) {
            const r = random();
            const child: unknown = r < .5 ? nodes[Math.floor(random()*count)] : r < .55 ? Float64Array.of(random(), random() < .02 ? NaN : 1)
              : r < .6 ? (random() < .5 ? NaN : Infinity) : r < .8 ? random() : "s";
            if (Array.isArray(node)) { if (random() < .1) node.length++; node.push(child); } else node[`k${e}`] = child;
          }
          if (random() < .2) Object.freeze(node);
        }
        same(nodes[0]);
      }
    });
  });
});

// foundation-13 (#699): typed arrays are walked by index, not through Object.keys (one string per element).
describe("typed arrays in a result value", () => {
  it("are scanned by index with the same answers and path", () => {
    const keys = Object.keys;
    const viewsWalked: unknown[] = [];
    Object.keys = ((o: object) => { if (ArrayBuffer.isView(o)) viewsWalked.push(o); return keys(o); }) as typeof Object.keys;
    try {
      for (const samples of [new Float64Array(1000), new Float32Array(1000), new Uint8Array(1000), new Int32Array(10), new Uint16Array(0)]) {
        expect(calculatedResult({ samples }, "m", "1.0.0", []).value.samples).toBe(samples);
        expect(calculationValueContainsNonFiniteNumber({ samples })).toBe(false);
        expect(calculationValueContainsNonFiniteNumberExact({ samples })).toBe(false);
      }
      for (const [samples, index] of [[new Float64Array(8), 3], [new Float32Array(8), 7], [new Float64Array(1), 0]] as const) {
        samples[index] = index === 0 ? Number.NEGATIVE_INFINITY : Number.NaN;
        expect(calculationValueContainsNonFiniteNumber({ samples })).toBe(true);
        expect(calculationValueContainsNonFiniteNumberExact({ samples })).toBe(true);
        expect(() => calculatedResult({ samples }, "m", "1.0.0", [])).toThrow(InvalidScientificResultError);
        expect(() => calculatedResult({ samples }, "m", "1.0.0", [])).toThrow("Calculation produced a non-finite number at value.samples." + index + ".");
      }
    } finally {
      Object.keys = keys;
    }
    expect(viewsWalked).toEqual([]);
  });
});
