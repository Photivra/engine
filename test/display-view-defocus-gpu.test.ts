// SPDX-License-Identifier: Apache-2.0
/**
 * #492 step 2c: the display view's defocus on the GPU, on the in-process float32 emulation of the WGSL
 * (test/helpers/fake-webgpu-display-view-quality.ts). Out of focus the expected signal carries the defocus disc, or each node's
 * diffraction kernel convolved with it, as site kernels; the Quality site pass gathers them with a factored table and a blocked
 * sum (a defocused Speed request runs the Quality passes with its bilinear demosaic). Per case, against the CPU reference of the
 * same view: every component inside the result's a-priori bounds, the bound fraction used, ΔE2000, |Δ|/σ, samples within one
 * code, the flagged fraction, and the #480 thresholds (scripts/lib/display-view-acceptance.mjs). Also: the support check, the
 * route through `prepareDisplayView`, the split of the site pass over dispatches, the device-limit refusal and its CPU
 * fallback, the bound terms, and the self-check case. Real-device runs: test/webgpu/display-view.webgpu.ts.
 */
import { describe, expect, it } from "vitest";
import { DISPLAY_VIEW_QUALITY_CONFORMANCE_CASE, DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES, DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE } from "../src/gpu/display-view-quality-gpu.js";
import { createDisplayViewGpuRenderer, displayViewQualityGpuSupports, registerDisplayViewGpuRenderer } from "../src/gpu/display-view-gpu-renderer.js";
import { DISPLAY_VIEW_SPEED_CONFORMANCE_CASE } from "../src/gpu/display-view-speed-gpu.js";
import { DISPLAY_VIEW_QUALITY_FLAG, DISPLAY_VIEW_QUALITY_LATTICE_WGSL, DISPLAY_VIEW_QUALITY_PIXELS_WGSL, DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL, DISPLAY_VIEW_QUALITY_SITES_WGSL,
  assembleDisplayViewQualityLatticeWgsl } from "../src/gpu/wgsl-display-view-quality-kernel.js";
import { DISPLAY_VIEW_SPEED_KERNEL_WGSL, assembleDisplayViewSpeedWgsl } from "../src/gpu/wgsl-display-view-speed-kernel.js";
import { chartPresetMaterialWgsl } from "../src/gpu/display-view-chart-material-module.js";
import { chartCompositeMaterialWgsl } from "../src/gpu/display-view-composite-material-module.js";
import { setDisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.js";
import { prepareDisplayView } from "../src/index.js";
import { WEBGPU_F32_UNIT_ROUNDOFF } from "../src/gpu/image-kernel-execution.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { compareDisplayViews, displayViewGpuFixture, renderOnGpuQuality, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { acceptanceOf } from "./helpers/display-view-acceptance-metrics.js";
import { DEFOCUS_GPU_EXTRA, DEFOCUS_GPU_GRID, type DefocusGpuCase } from "./helpers/display-view-defocus-gpu-fixtures.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const E = 2 * WEBGPU_F32_UNIT_ROUNDOFF;
const report: Record<string, unknown>[] = [];

/** Renders a case on the emulation, compares it with the CPU reference and checks every requirement; returns the record. */
async function checkCase(c: DefocusGpuCase): Promise<Record<string, unknown>> {
  const fixture = await displayViewGpuFixture(c.options, c.view), runtime = await runtimeOf(createFakeGpu().gpu);
  try {
    expect(fixture.input.signalInput.kernels?.radius).toBe(c.kernelRadius);
    expect(fixture.input.setup.gpu?.defocusRadius).toBeGreaterThan(0);
    const t = performance.now();
    const gpu = await renderOnGpuQuality(runtime, fixture), emulationMs = Math.round(performance.now() - t);
    const a = compareDisplayViews(fixture.cpu, gpu), region = c.view.region!, { metrics, verdict } = acceptanceOf(region.width, region.height, fixture.cpu, gpu);
    expect(gpu.blockedSum).toBe(true);
    expect(gpu.estimation).toBe("exact-area-mean");
    expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32", bitIdenticalToReference: false });
    expect(gpu.ahdCorrectedPixelCount).toBe(fixture.cpu.ahdCorrectedPixelCount);
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.deltaEMaximum).toBeLessThan(0.01);
    expect(a.sigmaUnitsMaximum).toBeLessThan(0.01);
    expect(verdict.pass, JSON.stringify(verdict.checks)).toBe(true);
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    // The host resolved every uncertain lattice point, so no site carries material uncertainty and no pixel is flagged for it.
    expect(gpu.pixelFlags.some((flag) => (flag & DISPLAY_VIEW_QUALITY_FLAG.materialUncertain) !== 0)).toBe(false);
    for (const i of gpu.flaggedPixelIndices) for (let k = 0; k < 3; k++) expect(gpu.expected[3 * i + k]).toBe(fixture.cpu.expected[3 * i + k]);
    return { case: c.name, kernelRadius: c.kernelRadius, tapsPerSite: gpu.tapsPerSite, siteSumRelativeBound: gpu.siteSumRelativeBound, pixels: a.pixels,
      deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaRelativeMaximum: a.sigmaRelativeMaximum,
      differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference, largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio,
      expectedValueBoundAbsolute: gpu.expectedValueBound.absolute, flagged: gpu.flaggedPixelIndices.length, flaggedFraction: gpu.flaggedPixelIndices.length / a.pixels,
      acceptance: { withinFraction: metrics.withinFraction, maxDeltaE: metrics.maxDeltaE, maxSigma: metrics.maxSigma, maxCode8: metrics.maxCode8, pass: verdict.pass },
      latticePointsResolved: gpu.latticePointsResolved, siteDispatches: gpu.stageMilliseconds.siteDispatches, emulationMs };
  } finally { runtime.destroy(); }
}

describe("#492: defocus in the GPU display view (float32 emulation) vs the CPU reference", () => {
  it.each(DEFOCUS_GPU_GRID.map((c) => [c.name, c] as const))("%s: inside the a-priori bounds; samples within one code; the #480 thresholds met", async (_name, c) => {
    report.push(await checkCase(c));
  }, scaledTimeout(900_000));

  it.each(DEFOCUS_GPU_EXTRA.map((c) => [c.name, c] as const))("%s: inside the a-priori bounds; samples within one code; the #480 thresholds met", async (_name, c) => {
    const row = await checkCase(c);
    // The composite's label glyphs and 1024-level elements and the star's diagonals put lattice points exactly on boundaries.
    if (!/cap, 1\.4 µm f\/|disc at its cap/u.test(c.name)) expect(row.latticePointsResolved).toBeGreaterThan(0);
    report.push(row);
  }, scaledTimeout(1_800_000));

  it("the blocked sum's bound grows with the kernel's width, not its tap count: (cw + ch + G + 3)·E", async () => {
    const c = DEFOCUS_GPU_EXTRA[4]!, fixture = await displayViewGpuFixture(c.options, { ...c.view, region: { ...c.view.region!, width: 1, height: 1 } });
    const runtime = await runtimeOf(createFakeGpu().gpu), gpu = await renderOnGpuQuality(runtime, fixture);
    // Radius 94 with the four-spot filter: four groups of 2 × 2 members, each a dense (2·94 + 2)² rectangle.
    expect(gpu.tapsPerSite).toBe(4 * 190 * 190);
    expect(gpu.siteSumRelativeBound).toBe(Math.fround((190 + 190 + 4 + 3) * E));
    // The tap-list sum would carry (T + 3)·E: 1.7 % here.
    expect((gpu.tapsPerSite + 3) * E).toBeGreaterThan(0.017);
    runtime.destroy();
  }, scaledTimeout(600_000));

  it("splitting a band's site pass over several dispatches never changes a byte", async () => {
    const c = DEFOCUS_GPU_GRID[1]!, fixture = await displayViewGpuFixture(c.options, c.view), runtime = await runtimeOf(createFakeGpu().gpu);
    const whole = await renderOnGpuQuality(runtime, fixture);
    const { renderDisplayViewQualityOnGpu, qualityMaterialModule } = await import("../src/gpu/display-view-quality-gpu.js");
    const { materialModulesOf } = await import("./helpers/display-view-gpu-fixture.js");
    const { createComputePipeline } = await import("../src/gpu/webgpu-runtime.js");
    const material = await qualityMaterialModule(materialModulesOf(runtime), fixture.input.setup.gpu!, new AbortController().signal);
    const split = await renderDisplayViewQualityOnGpu(runtime, 64 * 1024 * 1024, { ...fixture.input, material, maximumSiteTapsPerDispatch: 200 * whole.tapsPerSite }, new AbortController(), undefined,
      (label, code) => createComputePipeline(runtime, label, code, undefined));
    expect(whole.stageMilliseconds.siteDispatches).toBe(1);
    expect(split.stageMilliseconds.siteDispatches).toBeGreaterThan(3);
    expect(split.samples).toEqual(whole.samples);
    expect(split.expected).toEqual(whole.expected);
    expect(split.noiseStd).toEqual(whole.noiseStd);
    expect(split.expectedValueAbsoluteBound).toEqual(whole.expectedValueAbsoluteBound);
    runtime.destroy();
  }, scaledTimeout(600_000));

  it("supports() accepts lens.defocus for Speed and Quality requests on engine charts and material-layers scenes, and refuses what it did not", async () => {
    const quality = { ahd: true, diffraction: true, antiAliasing: true, boxSamples: 2, toneCurve: "identity" as const, scene: "chart" as const, defocus: true };
    const speed = { ...quality, ahd: false, diffraction: false, antiAliasing: false };
    expect(displayViewQualityGpuSupports(quality)).toBe(true);
    const runtime = await runtimeOf(createFakeGpu().gpu), renderer = createDisplayViewGpuRenderer(runtime);
    expect(renderer.supports(quality)).toBe(true);
    expect(renderer.supports(speed)).toBe(true);
    expect(renderer.supports({ ...speed, scene: "material-layers" })).toBe(true);
    expect(renderer.supports({ ...speed, scene: "material-function" })).toMatch(/caller/u);
    expect(renderer.supports({ ...quality, boxSamples: 5 })).toMatch(/64 query offsets/u);
    expect(renderer.supports({ ...speed, toneCurve: "other" as never })).toMatch(/tone curve/u);
    // #594: the Speed case runs at the device's first render; the Quality cases load with the Quality code (onDemandConformanceCases).
    expect(renderer.conformanceCases!.map((x) => x.id)).toEqual([DISPLAY_VIEW_SPEED_CONFORMANCE_CASE.id]);
    expect(DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES.map((x) => x.id)).toEqual([DISPLAY_VIEW_QUALITY_CONFORMANCE_CASE.id, DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE.id]);
    renderer.dispose?.();
    runtime.destroy();
  });

  it("through prepareDisplayView: defocused Speed and Quality requests render on the GPU, within one code of the CPU", async () => {
    const previous = registerDisplayViewGpuRenderer();
    try {
      for (const c of [DEFOCUS_GPU_GRID[0]!, DEFOCUS_GPU_GRID[1]!]) {
        const view = { ...c.view, region: { ...c.view.region!, width: 8, height: 6 } };
        const cpu = await prepareDisplayView(c.options), gpu = await prepareDisplayView(c.options, { gpu: "require", gpuDevice: createFakeGpu().gpu });
        try {
          const reference = await cpu.render(view), rendered = await gpu.render(view), execution = rendered.diagnostics.fast.execution;
          expect(execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null });
          expect(execution.conformance!.cases).toContain(DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE.id);
          expect(rendered.assumptions.some((a) => a.id === "view.defocus")).toBe(true);
          for (let i = 0; i < reference.image.samples.length; i++) expect(Math.abs(rendered.image.samples[i]! - reference.image.samples[i]!)).toBeLessThanOrEqual(1);
        } finally { cpu.dispose(); gpu.dispose(); }
      }
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(900_000));

  it("a kernel table past the device's storage binding limit is refused by name (insufficient-limits): \"auto\" renders the CPU reference with that label, \"require\" fails", async () => {
    // Radius 94, the patches chart: 3 channels × 144 400 taps × 21 spectral nodes × 4 bytes ≈ 36 MB of per-node kernel values (2.21.0).
    const c = DEFOCUS_GPU_EXTRA[4]!, options = { ...c.options, scene: { preset: "patches" as const, columns: 2, patches: Array.from({ length: 4 }, (_, i) => ({ patchId: `p${i}`, reflectance: i % 2 === 0 ?
      { kind: "tabulated" as const, samples: [380, 580, 780].map((w, j) => ({ wavelengthNanometers: w, value: 0.1 + 0.1 * i + 0.1 * j })) } : 0.2 + 0.1 * i })) } };
    const view = { ...c.view, region: { ...c.view.region!, width: 2, height: 2 } };
    const fixture = await displayViewGpuFixture(options, view), small = await runtimeOf(createFakeGpu({ maxStorageBufferBindingSize: 16 * 1024 * 1024 }).gpu);
    // The table does not fit the runtime's limit, scaled down to 4 MiB as a smaller device's.
    const runtime = Object.create(small, { maximumStorageBindingBytes: { value: 4 * 1024 * 1024 } }) as typeof small;
    await expect(renderOnGpuQuality(runtime, fixture)).rejects.toMatchObject({ reason: "insufficient-limits", message: expect.stringMatching(/kernel table .* exceeds the device's storage binding limit/u) });
    small.destroy();
  }, scaledTimeout(600_000));

  it("the session falls back to the CPU on insufficient-limits under \"auto\" and fails under \"require\"", async () => {
    const { ImageKernelExecutionError } = await import("../src/gpu/image-kernel-execution.js");
    const c = DEFOCUS_GPU_GRID[0]!, view = { ...c.view, region: { ...c.view.region!, width: 4, height: 4 } };
    const failing = (): ReturnType<typeof createDisplayViewGpuRenderer> => ({ id: "test-limits", supports: () => true,
      render: async (): Promise<never> => { throw new ImageKernelExecutionError("insufficient-limits", "The display view's kernel table exceeds the device's storage binding limit."); } });
    const previous = setDisplayViewGpuRendererFactory(failing);
    try {
      const off = await prepareDisplayView(c.options), auto = await prepareDisplayView(c.options, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      try {
        const cpu = await off.render(view), fallback = await auto.render(view);
        expect(fallback.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "insufficient-limits" });
        expect(Array.from(fallback.image.samples)).toEqual(Array.from(cpu.image.samples));
      } finally { off.dispose(); auto.dispose(); }
      const required = await prepareDisplayView(c.options, { gpu: "require", gpuDevice: createFakeGpu().gpu });
      try { await expect(required.render(view)).rejects.toMatchObject({ reason: "insufficient-limits" }); } finally { required.dispose(); }
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(600_000));

  it("the defocus self-check case passes on the emulation (blocked sum, several site dispatches) and honours an abort", async () => {
    const runtime = await runtimeOf(createFakeGpu().gpu);
    expect(await DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE.run(runtime, undefined)).toBe(true);
    const aborted = new AbortController();
    aborted.abort();
    await expect(DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE.run(runtime, aborted.signal)).rejects.toMatchObject({ reason: "aborted" });
    runtime.destroy();
  }, scaledTimeout(120_000));

  it("every assembled display-view shader declares no name twice (the fake device does not compile WGSL; SwiftShader does)", () => {
    const declared = (code: string): string[] => [...code.matchAll(/\b(?:fn|const|struct|var<private>|var<uniform>|var<storage[^>]*>|var<workgroup>|override|alias)\s+([A-Za-z_][A-Za-z0-9_]*)/gu)].map((m) => m[1]!);
    const shaders: [string, string][] = [["quality sites", DISPLAY_VIEW_QUALITY_SITES_WGSL], ["quality sites, blocked", DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL],
      ["quality pixels", DISPLAY_VIEW_QUALITY_PIXELS_WGSL], ["quality lattice (no module)", DISPLAY_VIEW_QUALITY_LATTICE_WGSL], ["speed (no module)", DISPLAY_VIEW_SPEED_KERNEL_WGSL]];
    for (const [name, module] of [["chart preset", chartPresetMaterialWgsl()], ["composite", chartCompositeMaterialWgsl()]] as const) {
      shaders.push(["quality lattice + " + name, assembleDisplayViewQualityLatticeWgsl(module)], ["speed + " + name, assembleDisplayViewSpeedWgsl(module)]);
    }
    for (const [name, code] of shaders) {
      const seen = new Set<string>(), twice: string[] = [];
      for (const id of declared(code)) { if (seen.has(id)) twice.push(id); seen.add(id); }
      expect(twice, name).toEqual([]);
    }
    // The blocked pass binds no tap records; since 2.21.0 it reads the tap-list pass's spectral table (no material rows).
    expect(DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL).not.toMatch(/@binding\(2\)/u);
    expect(DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL).not.toMatch(/@binding\(7\)/u);
    expect(DISPLAY_VIEW_QUALITY_SITES_WGSL).toMatch(/@binding\(2\) var<storage, read> taps/u);
    expect(DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL.match(/var<storage/gu)!.length).toBeLessThanOrEqual(8);
  });

  it("reports the measured agreement", () => {
    process.stdout.write("[display-view defocus gpu emulation] " + JSON.stringify(report, null, 1) + "\n");
  });
});
