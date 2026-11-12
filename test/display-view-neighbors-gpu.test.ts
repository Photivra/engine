// SPDX-License-Identifier: Apache-2.0
/**
 * #605 (2.23.0): `highlightMode: "reconstruct-neighbors"` (#602) in the display view's GPU kernels, Speed and Quality, fast and
 * full, on the float32 emulation (test/helpers/fake-webgpu-display-view*.ts) against the CPU reference: every component inside
 * the a-priori bounds, at most one code, flagged pixels recomputed. The ratios come from the host in a second dispatch per band
 * (src/gpu/wgsl-display-view-neighbors.ts). Real-device runs: test/webgpu/display-view.webgpu.ts.
 */
import { afterAll, describe, expect, it } from "vitest";
import { displayViewNeighborStats } from "../src/gpu/wgsl-display-view-neighbors.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, renderOnGpu, renderOnGpuQuality, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { NEIGHBOR_GPU_CASES } from "./helpers/display-view-neighbor-cases.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const report: Record<string, unknown>[] = [];
const PART = { x: 120, y: 50, width: 40, height: 30 };
afterAll(() => { if (report.length) process.stdout.write("[display-view neighbors GPU emulation] " + JSON.stringify(report) + "\n"); });

describe("display view GPU kernels with reconstruct-neighbors (float32 emulation) vs the CPU reference (#605)", () => {
  it.each(NEIGHBOR_GPU_CASES)("%s: inside the a-priori bounds; samples differ by at most one code", async (name, options, quality) => {
    // The full rule's 4,096 nodes per real pixel are slow to emulate: the full cases take a 40 × 30 part holding four clipped regions.
    const view = options.fast === false ? { ...SMALL_VIEW, region: PART } : SMALL_VIEW;
    const fixture = await displayViewGpuFixture(options, view), runtime = await runtimeOf(createFakeGpu().gpu);
    Object.assign(displayViewNeighborStats, { dispatches: 0, pixels: 0, realPixels: 0, hostMilliseconds: 0 });
    const t = performance.now();
    const gpu = quality ? await renderOnGpuQuality(runtime, fixture) : await renderOnGpu(runtime, fixture);
    const ms = Math.round(performance.now() - t), a = compareDisplayViews(fixture.cpu, gpu);
    report.push({ case: name, ms, ...displayViewNeighborStats, hostMilliseconds: Math.round(displayViewNeighborStats.hostMilliseconds), flagged: gpu.flaggedPixelIndices.length,
      deltaE2000Maximum: a.deltaEMaximum, sigmaUnitsMaximum: a.sigmaUnitsMaximum, differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference,
      largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio, expectedAbsolute: gpu.expectedValueBound.absolute });
    expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    // The ratios reached the kernel: pixels took them in a second dispatch.
    expect(displayViewNeighborStats.pixels).toBeGreaterThan(0);
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.differingSamples).toBeLessThanOrEqual(0.01 * a.pixels * 3);
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    // The coupled steps' recompute flag (bit 0; the Quality kernels also flag AHD's choice, bit 5) is set on a small share: the
    // rebuild itself ran on the GPU.
    const pixelFlags = (gpu as { pixelFlags?: Uint32Array }).pixelFlags, flags = pixelFlags ? pixelFlags.filter((v) => (v & 1) !== 0).length : gpu.flaggedPixelIndices.length;
    expect(flags).toBeLessThan(0.05 * a.pixels);
    runtime.destroy();
  }, scaledTimeout(300_000));

  it("the CPU reference's region ratios do not depend on where the render reaches the region (a region equals the whole view)", async () => {
    const [, options] = NEIGHBOR_GPU_CASES[1]!;
    const whole = await displayViewGpuFixture(options, SMALL_VIEW), region = PART;
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
