// SPDX-License-Identifier: Apache-2.0
/**
 * #605: real-GPU conformance of `highlightMode: "reconstruct-neighbors"` in the display view's Speed and Quality kernels against
 * the float64 CPU reference of the same realm (`npm run test:webgpu`; on hardware with `PHOTIVRA_WEBGPU_ADAPTER=hardware`): the
 * emulation's cases (test/display-view-neighbors-gpu-*.test.ts) on the whole view. This file holds Speed fast and full and Quality
 * fast; the Quality full case runs in bands of the whole view in test/webgpu/display-view-neighbors-quality-full.webgpu.ts (2.23.0:
 * on CI's SwiftShader it took more than the 600 s test limit in one piece). The suite: test/webgpu/display-view-neighbors-suite.ts.
 */
import { SMALL_VIEW } from "../helpers/display-view-gpu-fixture.js";
import { NEIGHBOR_GPU_CASES } from "../helpers/display-view-neighbor-cases.js";
import { describeNeighborWebGpuCases } from "./display-view-neighbors-suite.js";

describeNeighborWebGpuCases(NEIGHBOR_GPU_CASES.slice(0, 3).map(([name, options, quality]) => [name, options, quality, SMALL_VIEW]));
