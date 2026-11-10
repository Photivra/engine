// SPDX-License-Identifier: Apache-2.0
/**
 * The display view's Quality kernels on the float32 emulation against the CPU reference: the first five chart cases of
 * test/display-view-quality-gpu.test.ts (slanted edge, Siemens star, step wedge, checkerboard, spectral patches), in a file of
 * their own since 2.21.0 so that the coverage shards can balance them (the chart design-around made the Quality site passes
 * integrate every spectral node). The checks are the same (test/helpers/display-view-quality-cases.ts).
 */
import { describe, it } from "vitest";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { QUALITY_CASES, runQualityCase } from "./helpers/display-view-quality-cases.js";

const report: Record<string, unknown>[] = [];

describe("display view Quality kernels (float32 emulation) vs the CPU reference: chart cases", () => {
  it.each(QUALITY_CASES.slice(0, 5))("%s: every component is inside the a-priori bounds; samples differ by at most one code", async (name, options) => {
    await runQualityCase(name, options, report);
  }, scaledTimeout(900_000));

  it("reports the measured agreement", () => {
    process.stdout.write("[display-view quality gpu emulation, charts] " + JSON.stringify(report, null, 1) + "\n");
  });
});
