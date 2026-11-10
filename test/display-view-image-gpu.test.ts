// SPDX-License-Identifier: Apache-2.0
/**
 * The image-plane module of the GPU display view (#581) on the float32 emulation of the Speed kernel and of the module
 * (test/helpers/fake-webgpu-display-view.ts, fake-webgpu-composite.ts): a synthetic photo (smooth gradients, hard edges,
 * saturated colors, fine texture) as a print against the CPU reference per pixel, inside the a-priori bounds, samples within
 * one code, the #480 acceptance thresholds; the bilinear and nearest reconstructions, a fixed-size print and the default fit,
 * linear RGBA input, Reinhard at the white clip; `prepareDisplayView({ gpu: "auto" })` labeled, and a Quality request
 * (diffraction) falling back labeled. Real-device conformance: test/webgpu/display-view.webgpu.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prepareImagePlaneScenes, prepareDisplayView } from "../src/index.js";
import { IMAGE_PLANE_GPU_CASES, IMAGE_PLANE_GPU_LENS } from "./helpers/image-plane-fixtures.js";
import { registerDisplayViewGpuRenderer } from "../src/gpu/display-view-quality-gpu.js";
import { imagePlaneMaterialModuleId } from "../src/gpu/display-view-image-material-module.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, materialModuleOf, renderOnGpu, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { acceptanceOf } from "./helpers/display-view-acceptance-metrics.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const cases = IMAGE_PLANE_GPU_CASES, lens = IMAGE_PLANE_GPU_LENS;
const report: Record<string, unknown>[] = [];

describe("display view Speed kernel with the image-plane module (float32 emulation) vs the CPU reference (#581)", () => {
  beforeAll(async () => { await prepareImagePlaneScenes(); });
  it.each(cases)("%s: inside the a-priori bounds, samples within one code, the #480 thresholds met", async (name, options) => {
    const fixture = await displayViewGpuFixture(options, SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const module = await materialModuleOf(runtime, fixture.input.setup);
    expect(module.id).toBe(imagePlaneMaterialModuleId("dekker"));
    const gpu = await renderOnGpu(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
    const { verdict } = acceptanceOf(fixture.viewWidth, fixture.viewHeight, fixture.cpu, gpu);
    report.push({ case: name, pixels: a.pixels, flagged: gpu.flaggedPixelIndices.length, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum,
      sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples, largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio,
      relativeBound: gpu.expectedValueBound.relative });
    expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32", bitIdenticalToReference: false, diagnosticsExact: true });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.differingSamples).toBeLessThanOrEqual(0.01 * a.pixels * 3);
    expect(a.deltaEMaximum).toBeLessThan(0.01);
    expect(verdict.pass, JSON.stringify(verdict.checks)).toBe(true);
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    for (const i of gpu.flaggedPixelIndices) for (let c = 0; c < 3; c++) expect(gpu.samples[3 * i + c]).toBe(fixture.cpu.samples[3 * i + c]);
    // Flagged display pixels (near the print's edge, or a weight moved next to a much brighter pixel) cost one CPU pixel each.
    expect(gpu.flaggedPixelIndices.length / a.pixels).toBeLessThanOrEqual(0.1);
    runtime.destroy();
  }, scaledTimeout(300_000));

  it("through prepareDisplayView: gpu \"auto\" renders a photo on the device, labeled; a request that needs the Quality passes runs the CPU reference, labeled", async () => {
    const previous = registerDisplayViewGpuRenderer();
    try {
      const options = cases[0]![1], gpu = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu }), cpu = await prepareDisplayView(options);
      try {
        const view = await gpu.render(SMALL_VIEW), reference = await cpu.render(SMALL_VIEW);
        expect(view.diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, arithmetic: "float32" });
        expect(view.diagnostics.fast.execution.conformance).toMatchObject({ passed: true });
        for (let i = 0; i < reference.image.samples.length; i++) expect(Math.abs(view.image.samples[i]! - reference.image.samples[i]!)).toBeLessThanOrEqual(1);
      } finally { gpu.dispose(); cpu.dispose(); }
      const quality = await prepareDisplayView({ ...options, lens: { ...lens, diffraction: "circular-aperture" } }, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      try {
        const execution = (await quality.render(SMALL_VIEW)).diagnostics.fast.execution;
        expect(execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
        expect(execution.limitations.join(" ")).toMatch(/image-plane prints render on the GPU in the Speed path only/u);
      } finally { quality.dispose(); }
    } finally { (await import("../src/facade/display-view-gpu.js")).setDisplayViewGpuRendererFactory(previous); }
    console.log("[display-view image-plane gpu] " + JSON.stringify(report));
  }, scaledTimeout(300_000));
});
