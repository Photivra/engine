// SPDX-License-Identifier: Apache-2.0
/**
 * The display view's Quality kernels (#479) at the app's view size: a 24 MP, 6 µm, 6000 × 4000 frame with the 2 × 2 box, the
 * four-spot filter, diffraction at f/8 and AHD, shown at 2028 × 1352 (2.96 real pixels per display pixel, the exact area mean),
 * one band of 32 display rows across the whole width (64 896 display pixels), the float32 emulation against the CPU reference
 * per pixel. The emulation of the pixel pass costs about 0.5 ms per display pixel in JavaScript on this host, so CI runs the band
 * (about 40 s), which exercises the full-width geometry, banding and the 24 MP lattice windows; PHOTIVRA_DISPLAY_VIEW_WHOLE=1
 * renders the whole 2028 × 1352 view instead (about 25 minutes; the record in docs/WEBGPU.md). Runs apart from the small fixtures
 * (test/display-view-quality-gpu.test.ts).
 */
import { describe, expect, it } from "vitest";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { compareDisplayViews, displayViewGpuFixture, renderOnGpuQuality, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { NATIVE_RAW_LIMITS } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const whole = process.env.PHOTIVRA_DISPLAY_VIEW_WHOLE === "1";
describe("display view Quality kernels at 2028 × 1352 on the 24 MP frame (" + (whole ? "the whole view" : "one 32-row band") + ")", () => {
  it("checkerboard with diffraction, the four-spot filter and AHD: every component inside the a-priori bounds; ΔE2000 and σ-unit agreement reported", async () => {
    const options = { scene: { preset: "checkerboard" as const, squaresAcross: 12 }, lens: { prime: 50 as const, fNumber: 8, diffraction: "circular-aperture" as const },
      sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" as const } },
      output: { width: 6000, height: 4000, format: "srgb-8" as const, maximumPixels: NATIVE_RAW_LIMITS.ceilingPixels, demosaic: "ahd" as const } };
    const view = { width: 2028, height: 1352, region: whole ? { x: 0, y: 0, width: 2028, height: 1352 } : { x: 0, y: 660, width: 2028, height: 32 } };
    let t = performance.now();
    const fixture = await displayViewGpuFixture(options, view);
    const cpuMs = performance.now() - t;
    const runtime = await runtimeOf(createFakeGpu().gpu);
    t = performance.now();
    const gpu = await renderOnGpuQuality(runtime, fixture, 64 * 1024 * 1024);
    const emulationMs = performance.now() - t;
    const a = compareDisplayViews(fixture.cpu, gpu);
    process.stdout.write("[display-view quality gpu emulation " + view.region.width + "x" + view.region.height + " of 2028x1352] " + JSON.stringify({ ...a, flagged: gpu.flaggedPixelIndices.length, recomputed: gpu.hostRecomputedPixelIndices.length,
      tapsPerSite: gpu.tapsPerSite, cpuReferenceMs: Math.round(cpuMs), float32EmulationMs: Math.round(emulationMs), stageMilliseconds: gpu.stageMilliseconds,
      expectedValueBound: gpu.expectedValueBound, varianceBound: gpu.varianceBound }, null, 1) + "\n");
    expect(a.pixels).toBe(view.region.width * view.region.height);
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.deltaEMaximum).toBeLessThan(0.01);
    expect(a.sigmaUnitsMaximum).toBeLessThan(0.01);
    expect(a.sigmaRelativeMaximum).toBeLessThan(0.01);
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    runtime.destroy();
  }, scaledTimeout(whole ? 7_200_000 : 1_800_000));
});
