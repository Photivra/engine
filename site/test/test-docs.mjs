// SPDX-License-Identifier: Apache-2.0
// Published documents the site renders: the Color Patches guide names its closest reference colors by set and kind (#756).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { describeReference } from "../../scripts/check-color-patch-distinctness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("the Color Patches result table names each brands-set color by its kind and release, never by its brand (#756)", () => {
  const text = readFileSync(`${root}docs/COLOR_PATCHES.md`, "utf8");
  const table = text.slice(text.indexOf("**Result.**"), text.indexOf("**Sources of the \"Its sRGB\" column.**"));
  const rows = [...table.matchAll(/^\| PV-[A-Z]\d \| `[^`]+` \| `#[0-9A-F]{6}` \| ([^|]+?) \| ([a-z-]+) \| `(#[0-9A-F]{6})` \| [\d.]+ \|$/gmu)];
  assert.equal(rows.length, 30);
  const brands = rows.filter((row) => row[2] === "brands");
  for (const [, cell, , hex] of brands) {
    const release = /\(Simple Icons ([0-9.]+)\)$/u.exec(cell)?.[1];
    assert.ok(release, cell);
    assert.equal(cell, describeReference({ set: "brands", name: `(Simple Icons ${release})`, hex }));
  }
  // The credits count the same rows.
  assert.equal(Number(/`brands` \((\d+) values\)/u.exec(text)?.[1]), brands.length);
});

test("brands-set colors are described by kind; other sets keep their own color names", () => {
  assert.equal(describeReference({ set: "brands", name: "Any Name (Simple Icons 9.21.0)", hex: "#C8332D" }), "a brand red (Simple Icons 9.21.0)");
  assert.equal(describeReference({ set: "brands", name: "Any Name (Simple Icons 1.20.0)", hex: "#7289DA" }), "a brand blue (Simple Icons 1.20.0)");
  assert.equal(describeReference({ set: "brands", name: "Any Name (Simple Icons 2.19.0)", hex: "#8D6748" }), "a brand brown (Simple Icons 2.19.0)");
  assert.equal(describeReference({ set: "brands", name: "Any Name (Simple Icons 2.19.0)", hex: "#7B7B7B" }), "a brand gray (Simple Icons 2.19.0)");
  assert.equal(describeReference({ set: "css", name: "teal", hex: "#008080" }), "teal");
});
