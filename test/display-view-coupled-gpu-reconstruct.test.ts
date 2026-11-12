// SPDX-License-Identifier: Apache-2.0
/**
 * #593 (2.22.0): the `highlightMode: "reconstruct"` case of test/display-view-coupled-gpu.test.ts (the coupled steps in the Quality
 * kernels on the float32 emulation against the CPU reference), in a file of its own so that the coverage shards balance. The checks
 * are the same (test/helpers/display-view-quality-cases.ts).
 */
import { afterAll, describe, it } from "vitest";
import { COUPLED_QUALITY_CASES, runQualityCase } from "./helpers/display-view-quality-cases.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const report: Record<string, unknown>[] = [];
afterAll(() => { if (report.length) process.stdout.write("[display-view coupled Quality emulation, reconstruct] " + JSON.stringify(report.map((r) => ({ case: r.case, flagged: r.flagged,
  largestExpectedBoundRatio: r.largestExpectedBoundRatio, largestVarianceBoundRatio: r.largestVarianceBoundRatio, deltaE2000Maximum: r.deltaE2000Maximum }))) + "\n"); });

describe("display view Quality kernels with the coupled steps (float32 emulation) vs the CPU reference: reconstruct (#593)", () => {
  it.each(COUPLED_QUALITY_CASES.filter(([, options]) => options.output?.highlightMode === "reconstruct"))("%s: inside the a-priori bounds; samples differ by at most one code", async (name, options) => {
    await runQualityCase(name, options, report);
    // 2.24.0: 900 s with margin (561 s under coverage on #608's run; the 300 s deadline ran out once in a Node 22.13.0 test part).
  }, scaledTimeout(900_000));
});
