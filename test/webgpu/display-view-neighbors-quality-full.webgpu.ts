// SPDX-License-Identifier: Apache-2.0
/**
 * #605: the real-GPU Quality full case of `highlightMode: "reconstruct-neighbors"` (the harmonic fill) in four bands of whole rows
 * of the view, one test each (2.23.0, owner decision 2026-11-12: on CI's SwiftShader the whole view took more than the 600 s test
 * limit). A region render equals the whole view (test/display-view-neighbors-gpu.test.ts), so the bands check the same pixels.
 * The other cases: test/webgpu/display-view-neighbors.webgpu.ts; the suite: test/webgpu/display-view-neighbors-suite.ts.
 */
import { SMALL_VIEW } from "../helpers/display-view-gpu-fixture.js";
import { NEIGHBOR_GPU_CASES } from "../helpers/display-view-neighbor-cases.js";
import { NEIGHBOR_WHOLE_VIEW, neighborBands } from "../helpers/display-view-neighbor-gpu-check.js";
import { describeNeighborWebGpuCases } from "./display-view-neighbors-suite.js";

const BANDS = 4;
const [name, options, quality] = NEIGHBOR_GPU_CASES[3]!;
describeNeighborWebGpuCases(neighborBands(NEIGHBOR_WHOLE_VIEW, BANDS).map((region, i) => [`${name}, band ${i + 1} of ${BANDS} (rows ${region.y}–${region.y + region.height - 1})`, options, quality, { ...SMALL_VIEW, region }]));
