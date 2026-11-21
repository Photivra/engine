// SPDX-License-Identifier: Apache-2.0
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { partition, startOrder } from "./helpers/weighted-shard-sequencer.js";
import weights from "./shard-weights.json" with { type: "json" };

describe("weighted coverage shards", () => {
  const files = readdirSync("test").filter((name) => /\.test\.(ts|mjs)$/.test(name)).map((name) => `test/${name}`);

  it("runs every test file in exactly one part, for every part count CI uses", () => {
    for (const count of [4, 10]) {
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
    // The list is empty since 2.28.0 (#665); the mechanism stays for the next file that needs it.
    const listed = (weights as { alone?: string[] }).alone ?? [];
    const coverage = partition(files, 10, weights.files, listed);
    expect(coverage.flat().sort()).toEqual([...files].sort());
    for (const file of listed) expect(coverage.find((part) => part.includes(file)), file).toEqual([file]);
  });

  it("weighs a file without a recorded time as the median", () => {
    expect(partition(["new", "a", "b", "c"], 2, { a: 1, b: 2, c: 9 })).toEqual([["c"], ["b", "new", "a"]]);
  });

  // #665 (owner decision 2026-11-21): a file without a recorded time may be the slowest of its part, so it starts first.
  it("starts files without a recorded time first, then the recorded ones longest first", () => {
    expect(startOrder(["a", "new", "b", "c"], { a: 1, b: 2, c: 9 })).toEqual(["new", "c", "b", "a"]);
    expect(startOrder(["a", "zeta", "b", "alpha"], { a: 1, b: 2 })).toEqual(["alpha", "zeta", "b", "a"]);
  });

  it("breaks equal weights by file name, whatever order the files come in", () => {
    expect(startOrder(["c", "a", "b"], { a: 5, b: 5, c: 5 })).toEqual(["a", "b", "c"]);
    expect(startOrder(["b", "a", "c"], { a: 5, b: 5, c: 5 })).toEqual(["a", "b", "c"]);
  });

  it("orders every test file of the suite exactly once", () => {
    const order = startOrder(files, weights.files);
    expect([...order].sort()).toEqual([...files].sort());
  });

  // #665 (owner decision 2026-11-21): a new test file needs its recorded time in the pull request that adds it, from that pull
  // request's first run (`coverage-timings-k` artifacts, scripts/record-shard-weights.mjs), so several new slow files cannot
  // land in one part at the median's weight. The table also names no file that no longer exists.
  it("has a recorded time for every test file, and none for a file that no longer exists", () => {
    const recorded = Object.keys(weights.files);
    expect(files.filter((file) => !recorded.includes(file)), "test files with no recorded time in test/shard-weights.json").toEqual([]);
    expect(recorded.filter((file) => !files.includes(file)), "recorded times of files that no longer exist").toEqual([]);
  });
});
