// SPDX-License-Identifier: Apache-2.0
/**
 * The display view's Speed kernel on the GPU (#478) against the CPU reference, on the in-process float32 emulation: the two slowest
 * fixtures of test/display-view-speed-gpu.test.ts (reconstruct at the white clip, and the desaturation over white), run apart so that
 * the coverage shards can spread them (#742; test/helpers/display-view-speed-gpu-cases.ts).
 */
import { describe, it } from "vitest";
import type { DisplayViewAgreement } from "./helpers/display-view-gpu-fixture.js";
import { SLOW_CASES, cases, checkSpeedCase } from "./helpers/display-view-speed-gpu-cases.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const report: Record<string, unknown>[] = [];
function record(name: string, a: DisplayViewAgreement, extra: Record<string, unknown> = {}): void {
  report.push({ case: name, ...extra, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaUnitsRms: a.sigmaUnitsRms,
    sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference,
    largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio });
}

describe("display view Speed kernel (float32 emulation) vs the CPU reference, the slowest fixtures", () => {
  it.each(cases.filter(([name]) => SLOW_CASES.includes(name)))("%s: every component is inside the a-priori bounds; samples differ by at most one code", async (name, options) => {
    await checkSpeedCase(name, options, record);
  }, scaledTimeout(120_000));

  it("reports the measured agreement", () => {
    process.stdout.write("[display-view gpu emulation] " + JSON.stringify(report, null, 1) + "\n");
  });
});
