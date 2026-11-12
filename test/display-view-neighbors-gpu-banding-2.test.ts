// SPDX-License-Identifier: Apache-2.0
/**
 * #605 (2.23.0): banding never changes a byte with `highlightMode: "reconstruct-neighbors"` (the second dispatch per band) on the
 * Speed kernel's float32 emulation: band 2 of 2 of the whole view (rows 68–134). The check is split into two bands of whole rows, one
 * per file, so that each CI job fits its 20-minute limit (owner decision 2026-11-12); a region render equals the whole view
 * (test/display-view-neighbors-gpu.test.ts), so the two bands check the same pixels. The other band:
 * test/display-view-neighbors-gpu-banding-1.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_VIEW, displayViewGpuFixture, renderOnGpu, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { NEIGHBOR_GPU_CASES } from "./helpers/display-view-neighbor-cases.js";
import { NEIGHBOR_WHOLE_VIEW, neighborBands } from "./helpers/display-view-neighbor-gpu-check.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

describe("display view GPU kernels with reconstruct-neighbors (float32 emulation) vs the CPU reference (#605)", () => {
  it("banding never changes a byte (the second dispatch per band), band 2 of 2", async () => {
    const [, options] = NEIGHBOR_GPU_CASES[0]!, region = neighborBands(NEIGHBOR_WHOLE_VIEW, 2)[1]!;
    const fixture = await displayViewGpuFixture(options, { ...SMALL_VIEW, region }), runtime = await runtimeOf(createFakeGpu().gpu);
    const whole = await renderOnGpu(runtime, fixture), banded = await renderOnGpu(runtime, fixture, 8192);
    expect(banded.samples).toEqual(whole.samples);
    expect(banded.expected).toEqual(whole.expected);
    runtime.destroy();
  }, scaledTimeout(300_000));
});
