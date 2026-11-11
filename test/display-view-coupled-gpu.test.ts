// SPDX-License-Identifier: Apache-2.0
/**
 * #593, #601 (2.22.0): the coupled rendering steps in the Quality kernels (luminance tone curves, reconstruct and the
 * desaturation, src/gpu/wgsl-display-view-coupled.ts) on the float32 emulation against the CPU reference, with the checks of
 * the other Quality cases (every component inside the a-priori bounds, at most one code, flagged pixels recomputed). The Speed
 * kernel's coupled cases are in test/display-view-speed-gpu.test.ts; real-device runs in test/webgpu/display-view.webgpu.ts.
 */
import { afterAll, describe, it } from "vitest";
import { COUPLED_QUALITY_CASES, runQualityCase } from "./helpers/display-view-quality-cases.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const report: Record<string, unknown>[] = [];
afterAll(() => { if (report.length) process.stdout.write("[display-view coupled Quality emulation] " + JSON.stringify(report.map((r) => ({ case: r.case, flagged: r.flagged,
  largestExpectedBoundRatio: r.largestExpectedBoundRatio, largestVarianceBoundRatio: r.largestVarianceBoundRatio, deltaE2000Maximum: r.deltaE2000Maximum }))) + "\n"); });

describe("display view Quality kernels with the coupled steps (float32 emulation) vs the CPU reference (#593, #601)", () => {
  it.each(COUPLED_QUALITY_CASES)("%s: inside the a-priori bounds; samples differ by at most one code", async (name, options) => {
    await runQualityCase(name, options, report);
  }, scaledTimeout(300_000));
});
