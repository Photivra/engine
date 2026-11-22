// SPDX-License-Identifier: Apache-2.0
// The search filter's matching and ordering (site/assets/search.js; docs/design/engine-site.md, 6.3).
import assert from "node:assert/strict";
import test from "node:test";
import { matches, rank, compare } from "../assets/search.js";

test("every term must occur, case ignored", () => {
  assert.equal(matches("calculatedepthoffield function optics/depth-of-field.ts", ["depth", "optics"]), true);
  assert.equal(matches("calculatedepthoffield function optics/depth-of-field.ts", ["depth", "sensor"]), false);
});

test("an exact name, then a prefix, then a word start inside a camel-case or hyphenated name, then any match", () => {
  assert.equal(rank("DepthOfField", "depthoffield"), 0);
  assert.equal(rank("DepthOfField", "depth"), 1);
  assert.equal(rank("calculateDepthOfField", "depth"), 2);
  assert.equal(rank("optics/depth-of-field.ts", "field"), 2);
  assert.equal(rank("calculateDepthOfField", "pthof"), 3);
});

test("ties: functions, classes, constants, types, then the name", () => {
  const rows = [{ rank: 2, kind: 3, name: "B" }, { rank: 2, kind: 0, name: "z" }, { rank: 1, kind: 3, name: "c" }, { rank: 2, kind: 0, name: "a" }];
  assert.deepEqual(rows.sort(compare).map((row) => row.name), ["c", "a", "z", "B"]);
});
