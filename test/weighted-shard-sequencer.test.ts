// SPDX-License-Identifier: Apache-2.0
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { partition } from "./helpers/weighted-shard-sequencer.js";
import weights from "./shard-weights.json" with { type: "json" };

describe("weighted coverage shards", () => {
  const files = readdirSync("test").filter((name) => /\.test\.(ts|mjs)$/.test(name)).map((name) => `test/${name}`);

  it("runs every test file in exactly one part, for every part count CI uses", () => {
    for (const count of [3, 10]) {
      const parts = partition(files, count, weights.files);
      expect(parts).toHaveLength(count);
      expect(parts.flat().sort()).toEqual([...files].sort());
    }
  });

  it("gives the same partition whatever order the files come in", () => {
    expect(partition([...files].reverse(), 6, weights.files)).toEqual(partition(files, 6, weights.files));
  });

  it("assigns longest first to the lightest part", () => {
    const parts = partition(["a", "b", "c", "d", "e"], 2, { a: 5, b: 4, c: 3, d: 3, e: 1 });
    expect(parts).toEqual([["a", "d"], ["b", "c", "e"]]);
  });

  it("gives each file listed alone a part of its own, and spreads the rest over the other parts (2.24.0)", () => {
    const parts = partition(["a", "b", "c", "d", "e"], 3, { a: 5, b: 4, c: 3, d: 3, e: 1 }, ["b", "missing"]);
    expect(parts).toEqual([["b"], ["a", "e"], ["c", "d"]]);
    // Never every part: one stays open for the rest.
    expect(partition(["a", "b"], 1, { a: 1, b: 1 }, ["a"])).toEqual([["a", "b"]]);
    const listed = (weights as { alone?: string[] }).alone ?? [];
    expect(listed).toContain("test/display-view-neighbors-gpu.test.ts");
    const coverage = partition(files, 10, weights.files, listed);
    expect(coverage.flat().sort()).toEqual([...files].sort());
    for (const file of listed) expect(coverage.find((part) => part.includes(file)), file).toEqual([file]);
  });

  it("weighs a file without a recorded time as the median", () => {
    expect(partition(["new", "a", "b", "c"], 2, { a: 1, b: 2, c: 9 })).toEqual([["c"], ["b", "new", "a"]]);
  });
});
