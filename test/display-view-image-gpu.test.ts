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
import { prepareImagePlaneScenes, prepareDisplayView, simulateDisplayView } from "../src/index.js";
import { IMAGE_PLANE_GPU_CASES, IMAGE_PLANE_GPU_LENS, IMAGE_PLANE_GPU_LIT_CASES, IMAGE_PLANE_GPU_QUALITY_CASES, photo, syntheticPhoto } from "./helpers/image-plane-fixtures.js";
import type { SimulateCaptureOptions } from "../src/index.js";
import { registerDisplayViewGpuRenderer } from "../src/gpu/display-view-quality-gpu.js";
import { imagePlaneMaterialModuleId } from "../src/gpu/display-view-image-material-module.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, materialModuleOf, renderOnGpu, renderOnGpuQuality, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
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

  it("Speed: a photo larger than one storage binding renders in bands, each with the pixel rows it reaches, identical to the whole upload, built 4 MiB at a time, each row once", async () => {
    // 2400 × 1600 pixels of 12 bytes is 46 MB of signals; the smallest binding limit a runtime takes (16 MB) and small bands make the
    // module upload per band.
    const options: SimulateCaptureOptions = { ...cases[0]![1], scene: photo(syntheticPhoto(2400, 1600)) };
    const fixture = await displayViewGpuFixture(options, SMALL_VIEW);
    const small = await runtimeOf(createFakeGpu({ maxStorageBufferBindingSize: 16 * 1024 * 1024 }).gpu), large = await runtimeOf(createFakeGpu().gpu);
    const module = await materialModuleOf(small, fixture.input.setup);
    expect(module.bindings).toHaveLength(0);
    expect(module.bandRows!(fixture.input.setup.frameHeight / SMALL_VIEW.height)).toBeLessThan(SMALL_VIEW.height);
    // The host builds the pixel signals 4 MiB of rows at a time, banded or whole (owner decision 2026-11-09): no write is larger.
    const writes: number[] = [];
    let bandBytes = 0;
    for (const runtime of [small, large]) {
      const queue = runtime.device.queue, write = queue.writeBuffer.bind(queue);
      queue.writeBuffer = ((buffer: GPUBuffer, offset: number, data: ArrayBuffer, dataOffset?: number, size?: number) => {
        if (buffer.label.includes("image-signal")) writes.push(size!);
        if (buffer.label.includes("image-signal-band")) bandBytes += size!;
        write(buffer, offset, data, dataOffset, size);
      }) as typeof queue.writeBuffer;
    }
    const banded = await renderOnGpu(small, fixture, 64 * 1024), whole = await renderOnGpu(large, fixture), a = compareDisplayViews(fixture.cpu, banded);
    expect(writes.length).toBeGreaterThan(20);
    expect(Math.max(...writes)).toBeLessThanOrEqual(4 << 20);
    // Rows two bands share are copied on the device from the previous band: each photo row the render reaches is built once.
    expect(bandBytes).toBeLessThanOrEqual(1600 * 2400 * 12);
    expect(a.outsideExpectedBound + a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(banded.samples).toEqual(whole.samples);
    expect(banded.expected).toEqual(whole.expected);
    report.push({ case: "speed: 2400 × 1600 photo in bands (16 MB binding limit)", deltaE2000Maximum: a.deltaEMaximum, largestExpectedBoundRatio: a.largestExpectedRatio });
    small.destroy(); large.destroy();
  }, scaledTimeout(300_000));

  // #581 (owner decision 2026-11-09): the Quality passes for photos: diffraction, the four-spot filter and AHD, defocus of the plane.
  const qualityCases = IMAGE_PLANE_GPU_QUALITY_CASES;
  it.each(qualityCases)("Quality: %s: inside the a-priori bounds, samples within one code", async (name, options, caseView) => {
    const fixture = await displayViewGpuFixture(options, caseView), runtime = await runtimeOf(createFakeGpu().gpu);
    const gpu = await renderOnGpuQuality(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
    let byLattice = 0, byChoice = 0;
    for (const i of gpu.flaggedPixelIndices) { if ((gpu.pixelFlags[i]! & 1) !== 0) byLattice++; if ((gpu.pixelFlags[i]! & 32) !== 0) byChoice++; }
    report.push({ case: "quality: " + name, pixels: a.pixels, taps: gpu.tapsPerSite, flagged: gpu.flaggedPixelIndices.length, flaggedByLatticePoint: byLattice, flaggedByAhdChoice: byChoice, resolved: gpu.latticePointsResolved, deltaE2000Maximum: a.deltaEMaximum,
      sigmaUnitsMaximum: a.sigmaUnitsMaximum, largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio, siteSumRelativeBound: gpu.siteSumRelativeBound });
    expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.deltaEMaximum).toBeLessThan(0.01);
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    expect(gpu.ahdCorrectedPixelCount).toBe(fixture.cpu.ahdCorrectedPixelCount);
    if (name.startsWith("defocus")) expect(gpu.tapsPerSite).toBeGreaterThan(100);

    runtime.destroy();
  }, scaledTimeout(300_000));

  it("Quality: a print edge exactly on the lattice: with kernels the host resolves the flagged points, without kernels their pixels are recomputed", async () => {
    // The print's right edge at the lattice points u = (p + 0.5 + 0.75 − W/2)·g of the 2 × 2 box's 0.75 group: half its width is
    // that u times the metres per frame unit, so cu = 1 there up to the reference's rounding, within every bound of the edge.
    const base = cases[1]![1], outW = base.output!.width!, W = outW + 2, p = W / 2 + outW / 4 - 1, u = (p + 0.5 + 0.75 - W / 2) * 2 / outW;
    const framed = (await simulateDisplayView(base, { width: 4, height: 4 })).scene.framedWidthM;
    const placedAtLattice = { ...base, chartSize: { widthM: u * framed } }, edgeView = { ...SMALL_VIEW, region: { x: 140, y: 50, width: 40, height: 30 } };
    for (const [options, kernels] of [[{ ...placedAtLattice, lens: { ...lens, diffraction: "circular-aperture" as const } }, true], [{ ...placedAtLattice, output: { ...base.output, demosaic: "ahd" as const } }, false]] as const) {
      const fixture = await displayViewGpuFixture(options, edgeView), runtime = await runtimeOf(createFakeGpu().gpu);
      const gpu = await renderOnGpuQuality(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
      let byLattice = 0;
      for (const i of gpu.flaggedPixelIndices) if ((gpu.pixelFlags[i]! & 1) !== 0) byLattice++;
      report.push({ case: "quality: print edge on the lattice, " + (kernels ? "diffraction" : "AHD without kernels"), resolved: gpu.latticePointsResolved, flaggedByLatticePoint: byLattice, flagged: gpu.flaggedPixelIndices.length });
      if (kernels) { expect(gpu.latticePointsResolved).toBeGreaterThan(0); expect(byLattice).toBe(0); } else expect(byLattice).toBeGreaterThan(0);
      expect(a.outsideExpectedBound + a.outsideVarianceBound).toBe(0);
      expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
      runtime.destroy();
    }
  }, scaledTimeout(300_000));

  // #597 (owner decision 2026-11-10): mixed light over the print on the device, through the print's Quality passes (Speed requests too).
  it.each(IMAGE_PLANE_GPU_LIT_CASES)("mixed light: %s: inside the a-priori bounds, samples within one code", async (name, options, caseView) => {
    const fixture = await displayViewGpuFixture(options, caseView), runtime = await runtimeOf(createFakeGpu().gpu);
    expect((fixture.input.signalInput.scene as { signalAt?: unknown }).signalAt).toBeUndefined();
    const gpu = await renderOnGpuQuality(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
    report.push({ case: "mixed light: " + name, pixels: a.pixels, flagged: gpu.flaggedPixelIndices.length, resolved: gpu.latticePointsResolved, deltaE2000Maximum: a.deltaEMaximum,
      largestExpectedBoundRatio: a.largestExpectedRatio, siteSumRelativeBound: gpu.siteSumRelativeBound });
    expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(a.outsideExpectedBound + a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.deltaEMaximum).toBeLessThan(0.01);
    expect(gpu.flaggedPixelIndices.length / a.pixels).toBeLessThanOrEqual(0.1);
    runtime.destroy();
  }, scaledTimeout(300_000));

  it("mixed light: a hard light edge exactly on the lattice: with kernels the host resolves the flagged points, without kernels their pixels are recomputed", async () => {
    // A regions edge at the print-local u of lattice points of the 2 × 2 box's 0.75 group (u frame units × k chart units per frame unit).
    const base = cases[0]![1], outW = base.output!.width!, W = outW + 2, p = W / 2 + 3, u = (p + 0.5 + 0.75 - W / 2) * 2 / outW;
    const framed = (await simulateDisplayView(base, { width: 4, height: 4 })).scene.framedWidthM, cu = u * (framed / 2) / (base.chartSize!.widthM / 2);
    const illumination = { sources: [{ illuminant: { kind: "planckian" as const, temperatureKelvin: 6500 }, illuminanceLux: 8000 }, { illuminant: { kind: "cie-a" as const }, illuminanceLux: 3000 }],
      blend: { kind: "regions" as const, regions: [{ source: 1, uMin: cu, uMax: 2, vMin: -2, vMax: 2 }], outsideSource: 0 } };
    const edgeView = { ...SMALL_VIEW, region: { x: 90, y: 50, width: 24, height: 20 } };
    for (const [options, kernels] of [[{ ...base, illumination, lens: { ...lens, diffraction: "circular-aperture" as const } }, true], [{ ...base, illumination }, false]] as const) {
      const fixture = await displayViewGpuFixture(options, edgeView), runtime = await runtimeOf(createFakeGpu().gpu);
      const gpu = await renderOnGpuQuality(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
      let byLattice = 0;
      for (const i of gpu.flaggedPixelIndices) if ((gpu.pixelFlags[i]! & 1) !== 0) byLattice++;
      report.push({ case: "mixed light: hard edge on the lattice, " + (kernels ? "diffraction" : "Speed request"), resolved: gpu.latticePointsResolved, flaggedByLatticePoint: byLattice });
      if (kernels) { expect(gpu.latticePointsResolved).toBeGreaterThan(0); expect(byLattice).toBe(0); } else expect(byLattice).toBeGreaterThan(0);
      expect(a.outsideExpectedBound + a.outsideVarianceBound).toBe(0);
      expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
      runtime.destroy();
    }
  }, scaledTimeout(300_000));

  it("through prepareDisplayView: gpu \"auto\" renders a photo on the device, labeled, in the Speed and the Quality paths", async () => {
    const previous = registerDisplayViewGpuRenderer();
    try {
      const options = cases[0]![1], gpu = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu }), cpu = await prepareDisplayView(options);
      try {
        const view = await gpu.render(SMALL_VIEW), reference = await cpu.render(SMALL_VIEW);
        expect(view.diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, arithmetic: "float32" });
        expect(view.diagnostics.fast.execution.conformance).toMatchObject({ passed: true });
        for (let i = 0; i < reference.image.samples.length; i++) expect(Math.abs(view.image.samples[i]! - reference.image.samples[i]!)).toBeLessThanOrEqual(1);
      } finally { gpu.dispose(); cpu.dispose(); }
      // #581 (owner decision 2026-11-09): a request that needs the Quality passes renders on the device too.
      const quality = await prepareDisplayView({ ...options, lens: { ...lens, diffraction: "circular-aperture" } }, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      try {
        const execution = (await quality.render({ ...SMALL_VIEW, region: { x: 70, y: 40, width: 24, height: 18 } })).diagnostics.fast.execution;
        expect(execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null });
      } finally { quality.dispose(); }
    } finally { (await import("../src/facade/display-view-gpu.js")).setDisplayViewGpuRendererFactory(previous); }
    console.log("[display-view image-plane gpu] " + JSON.stringify(report));
  }, scaledTimeout(300_000));
});
