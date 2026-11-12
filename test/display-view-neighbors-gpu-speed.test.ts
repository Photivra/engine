// SPDX-License-Identifier: Apache-2.0
/**
 * #605 (2.23.0): the Speed kernel, fast and full, with `highlightMode: "reconstruct-neighbors"` on the float32 emulation against the CPU reference, in a
 * file of its own so that the CI parts balance (the checks: test/helpers/display-view-neighbor-gpu-check.ts; the other cases
 * and the region-order checks: test/display-view-neighbors-gpu*.test.ts).
 */
import { describe, it } from "vitest";
import { NEIGHBOR_GPU_CASES } from "./helpers/display-view-neighbor-cases.js";
import { neighborCaseReport, runNeighborCase } from "./helpers/display-view-neighbor-gpu-check.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const report = neighborCaseReport();
describe("display view GPU kernels with reconstruct-neighbors (float32 emulation) vs the CPU reference (#605)", () => {
  it.each(NEIGHBOR_GPU_CASES.slice(0, 2))("%s: inside the a-priori bounds; samples differ by at most one code", async (name, options, quality) => {
    await runNeighborCase(report, name, options, quality);
  }, scaledTimeout(300_000));
});
