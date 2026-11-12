// SPDX-License-Identifier: Apache-2.0
/**
 * #605 (2.23.0): `highlightMode: "reconstruct-neighbors"` (#602) in the display view's GPU kernels on the float32 emulation
 * (test/helpers/fake-webgpu-display-view*.ts) against the CPU reference. This file holds the region-order and banding checks;
 * the four kernel cases (Speed and Quality, fast and full) are in test/display-view-neighbors-gpu-speed.test.ts,
 * test/display-view-neighbors-gpu-quality.test.ts and test/display-view-neighbors-gpu-quality-full.test.ts, split so that the
 * CI parts balance (test/helpers/display-view-neighbor-gpu-check.ts holds their check). The ratios come from the host in a
 * second dispatch per band (src/gpu/wgsl-display-view-neighbors.ts). Real-device runs: test/webgpu/display-view-neighbors.webgpu.ts.
 */
import { describe, expect, it } from "vitest";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_VIEW, displayViewGpuFixture, renderOnGpu, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { NEIGHBOR_GPU_CASES } from "./helpers/display-view-neighbor-cases.js";
import { NEIGHBOR_PART } from "./helpers/display-view-neighbor-gpu-check.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

describe("display view GPU kernels with reconstruct-neighbors (float32 emulation) vs the CPU reference (#605)", () => {
  it("the CPU reference's region ratios do not depend on where the render reaches the region (a region equals the whole view)", async () => {
    const [, options] = NEIGHBOR_GPU_CASES[1]!;
    const whole = await displayViewGpuFixture(options, SMALL_VIEW), region = NEIGHBOR_PART;
    const part = await displayViewGpuFixture(options, { ...SMALL_VIEW, region });
    expect(part.input.setup.coupled!.neighborRegions.measured).toBeGreaterThan(0);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let c = 0; c < 3; c++) {
      expect(part.cpu.expected[(y * region.width + x) * 3 + c]).toBe(whole.cpu.expected[((region.y + y) * SMALL_VIEW.width + region.x + x) * 3 + c]);
    }
  }, scaledTimeout(300_000));

  it("a region above the search cap is solved per tile, so a region render equals the whole view there too", async () => {
    // 1/15 s: the clipped area joins into regions above the fast cap (65,536 pixels).
    const [, base] = NEIGHBOR_GPU_CASES[0]!, options = { ...base, exposure: { mode: "manual" as const, iso: 100, shutterSeconds: 1 / 15 } };
    const whole = await displayViewGpuFixture(options, SMALL_VIEW), region = { x: 44, y: 56, width: 24, height: 16 };
    expect(whole.input.setup.coupled!.neighborRegions.capped).toBeGreaterThan(0);
    const part = await displayViewGpuFixture(options, { ...SMALL_VIEW, region });
    expect(part.input.setup.coupled!.neighborRegions.capped).toBeGreaterThan(0);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let c = 0; c < 3; c++) {
      expect(part.cpu.expected[(y * region.width + x) * 3 + c]).toBe(whole.cpu.expected[((region.y + y) * SMALL_VIEW.width + region.x + x) * 3 + c]);
    }
  }, scaledTimeout(300_000));

  it("banding never changes a byte (the second dispatch per band)", async () => {
    const [, options] = NEIGHBOR_GPU_CASES[0]!;
    const fixture = await displayViewGpuFixture(options, SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const whole = await renderOnGpu(runtime, fixture), banded = await renderOnGpu(runtime, fixture, 8192);
    expect(banded.samples).toEqual(whole.samples);
    expect(banded.expected).toEqual(whole.expected);
    runtime.destroy();
  }, scaledTimeout(300_000));
});
