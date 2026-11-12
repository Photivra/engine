// SPDX-License-Identifier: Apache-2.0
/**
 * #605 (2.23.0): the Quality kernels, fast, with `highlightMode: "reconstruct-neighbors"` on the float32 emulation against the
 * CPU reference: band 1 of 2 of the whole view (rows 0–67). The case is split into 2 bands of whole rows, one per file, so that each CI
 * job fits its 20-minute limit (owner decision 2026-11-12); together the bands check the same pixels
 * (test/helpers/display-view-neighbor-gpu-check.ts, `neighborBands`). The other bands: test/display-view-neighbors-gpu-quality-*.test.ts.
 */
import { describe, it } from "vitest";
import { NEIGHBOR_GPU_CASES } from "./helpers/display-view-neighbor-cases.js";
import { NEIGHBOR_WHOLE_VIEW, neighborBands, neighborCaseReport, runNeighborCase } from "./helpers/display-view-neighbor-gpu-check.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const report = neighborCaseReport();
const [name, options, quality] = NEIGHBOR_GPU_CASES[2]!, region = neighborBands(NEIGHBOR_WHOLE_VIEW, 2)[0]!;
describe("display view GPU kernels with reconstruct-neighbors (float32 emulation) vs the CPU reference (#605)", () => {
  // The deadline is 900 s (300 s for the other cases): the whole-view Quality fast case took 302 s on CI without coverage (#608).
  it(`${name}, band 1 of 2: inside the a-priori bounds; samples differ by at most one code`, async () => {
    await runNeighborCase(report, name, options, quality, region);
  }, scaledTimeout(900_000));
});
