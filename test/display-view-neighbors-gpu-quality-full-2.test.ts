// SPDX-License-Identifier: Apache-2.0
/**
 * #605 (2.23.0): the Quality kernels, full, with `highlightMode: "reconstruct-neighbors"` on the float32 emulation against the
 * CPU reference: band 2 of 4 of the 40 × 30 part (rows 58–65). The case is split into 4 bands of whole rows, one per file, so that each CI
 * job fits its 20-minute limit (owner decision 2026-11-12); together the bands check the same pixels
 * (test/helpers/display-view-neighbor-gpu-check.ts, `neighborBands`). The other bands: test/display-view-neighbors-gpu-quality-full-*.test.ts.
 */
import { describe, it } from "vitest";
import { NEIGHBOR_GPU_CASES } from "./helpers/display-view-neighbor-cases.js";
import { NEIGHBOR_PART, neighborBands, neighborCaseReport, runNeighborCase } from "./helpers/display-view-neighbor-gpu-check.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const report = neighborCaseReport();
// The flag-share check of the whole 40 × 30 part (bit 0 on under 5 % of its 1,200 pixels, so at most 59) is split between the
// bands: the flagged pixels sit in three columns (57 in all, measured November 12, 2026: 24, 19, 7 and 7 by band), so each band
// takes a share of the whole part's limit instead of 5 % of its own pixels: under 26, 21, 8 and 8 (together at most 59).
const FLAG_LIMIT = 21;
const [name, options, quality] = NEIGHBOR_GPU_CASES[3]!, region = neighborBands(NEIGHBOR_PART, 4)[1]!;
describe("display view GPU kernels with reconstruct-neighbors (float32 emulation) vs the CPU reference (#605)", () => {
  // The deadline is 900 s (300 s for the other cases): the whole-view Quality fast case took 302 s on CI without coverage (#608).
  it(`${name}, band 2 of 4: inside the a-priori bounds; samples differ by at most one code`, async () => {
    await runNeighborCase(report, name, options, quality, region, FLAG_LIMIT);
  }, scaledTimeout(900_000));
});
