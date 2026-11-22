// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coverageExcludedTests } from "./helpers/coverage-excluded-tests.js";

describe("test files left out of coverage runs", () => {
  it("are only the files named in the helper, and each still exists", () => {
    expect(coverageExcludedTests).toEqual(["test/display-view-lens-offset-expansion.test.ts"]);
    for (const file of coverageExcludedTests) expect(existsSync(file), file).toBe(true);
  });
});
