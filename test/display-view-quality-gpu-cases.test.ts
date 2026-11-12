// SPDX-License-Identifier: Apache-2.0
/**
 * The display view's Quality kernels on the float32 emulation against the CPU reference: the Quality cases after the first five
 * (the step wedge at the white clip, at ISO 6400 and with Reinhard, and AHD without diffraction), in a file of their own since
 * 2.22.0 so that the coverage shards balance (test/display-view-quality-gpu.test.ts held them and measured about 19 minutes under
 * coverage on CI). The checks are the same (test/helpers/display-view-quality-cases.ts); the first five cases are in
 * test/display-view-quality-gpu-charts.test.ts.
 */
import { describe, it } from "vitest";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { QUALITY_CASES, runQualityCase } from "./helpers/display-view-quality-cases.js";

const report: Record<string, unknown>[] = [];

describe("display view Quality kernels (float32 emulation) vs the CPU reference: cases after the charts", () => {
  it.each(QUALITY_CASES.slice(5))("%s: every component is inside the a-priori bounds; samples differ by at most one code", async (name, options) => {
    await runQualityCase(name, options, report);
  }, scaledTimeout(900_000));

  it("reports the measured agreement", () => {
    process.stdout.write("[display-view quality gpu emulation, cases] " + JSON.stringify(report, null, 1) + "\n");
  });
});
