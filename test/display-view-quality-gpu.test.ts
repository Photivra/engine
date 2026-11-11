// SPDX-License-Identifier: Apache-2.0
/**
 * The display view's Quality kernels on the GPU (#479: diffraction kernels, the four-spot filter, the AHD candidates and the
 * low-signal correction) against the CPU reference, on the in-process float32 emulation of the WGSL
 * (test/helpers/fake-webgpu-display-view-quality.ts): per-pixel agreement of the expected value in ΔE2000 and noise-σ units and
 * of the noise standard deviation, inside the result's a-priori bounds; the correction states computed on the host and shared
 * across renders; flagged pixels recomputed with the reference; banding; the support check; the combined renderer through
 * `prepareDisplayView({ gpu: "auto" })`. Real-device conformance: test/webgpu/display-view.webgpu.ts.
 */
import { describe, expect, it } from "vitest";
import { renderDisplayView } from "../src/facade/display-view.js";
import { CorrectionStateStore, DISPLAY_VIEW_QUALITY_CONFORMANCE_CASE, DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES, DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE, displayViewQualityGpuUnsupportedReason } from "../src/gpu/display-view-quality-gpu.js";
import { createDisplayViewGpuRenderer, displayViewQualityGpuSupports, registerDisplayViewGpuRenderer } from "../src/gpu/display-view-gpu-renderer.js";
import { DISPLAY_VIEW_SPEED_CONFORMANCE_CASE } from "../src/gpu/display-view-speed-gpu.js";
import { DISPLAY_VIEW_QUALITY_CHOICE_SIGMA, DISPLAY_VIEW_QUALITY_FLAG, DISPLAY_VIEW_QUALITY_LATTICE_WGSL, DISPLAY_VIEW_QUALITY_PIXELS_WGSL, DISPLAY_VIEW_QUALITY_SITES_WGSL, assembleDisplayViewQualityLatticeWgsl } from "../src/gpu/wgsl-display-view-quality-kernel.js";
import { setDisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.js";
import { DISPLAY_VIEW_GPU_BUILT_IN_CASES } from "../src/facade/display-view-gpu-session.js";
import { chartPresetMaterialWgsl } from "../src/gpu/display-view-chart-material-module.js";
import { prepareDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, renderOnGpuQuality, runtimeOf, type DisplayViewAgreement } from "./helpers/display-view-gpu-fixture.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { QUALITY_CASES, runQualityCase } from "./helpers/display-view-quality-cases.js";
import { CHART_COMPOSITE_MATERIAL_MODULE_ID } from "../src/gpu/display-view-composite-material-module.js";
import { FIXTURE_ASPECT, layeredScene } from "./helpers/chart-composite-fixtures.js";
import { materialModulesOf } from "./helpers/display-view-gpu-fixture.js";
import { qualityMaterialModule, qualityMaterialSetup } from "../src/gpu/display-view-quality-gpu.js";

const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" as const } };
const output = { ...SMALL_FRAME, format: "srgb-8" as const, demosaic: "ahd" as const };
const lens = { prime: 50 as const, fNumber: 8, diffraction: "circular-aperture" as const };
// The first QUALITY_CHART_CASES chart cases run in test/display-view-quality-gpu-charts.test.ts (2.21.0: split for the coverage shards).
const QUALITY_CHART_CASES = 5;
const report: Record<string, unknown>[] = [];
function record(name: string, a: DisplayViewAgreement, extra: Record<string, unknown> = {}): void {
  report.push({ case: name, ...extra, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaUnitsRms: a.sigmaUnitsRms,
    sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference,
    largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio });
}
describe("display view Quality kernels (float32 emulation) vs the CPU reference", () => {
  it.each(QUALITY_CASES.slice(QUALITY_CHART_CASES))("%s: every component is inside the a-priori bounds; samples differ by at most one code", async (name, options) => {
    await runQualityCase(name, options, report);
  }, scaledTimeout(900_000));

  it("the correction states are computed once per store: a second render of the same region computes none and gives the same bytes", async () => {
    const fixture = await displayViewGpuFixture(QUALITY_CASES[6]![1], { ...SMALL_VIEW, region: { x: 60, y: 40, width: 40, height: 24 } }), runtime = await runtimeOf(createFakeGpu().gpu);
    const states = new CorrectionStateStore();
    const first = await renderOnGpuQuality(runtime, fixture, undefined, true, states), second = await renderOnGpuQuality(runtime, fixture, undefined, true, states);
    expect(first.ahdCorrectedPixelCount).toBeGreaterThan(0);
    expect(first.statesComputed).toBeGreaterThan(0);
    expect(first.stageMilliseconds.pixelRedispatches).toBe(1);
    expect(second.statesComputed).toBe(0);
    expect(second.stageMilliseconds.pixelRedispatches).toBe(0);
    expect(second.statesHeld).toBe(first.statesHeld);
    expect(second.samples).toEqual(first.samples);
    expect(second.expected).toEqual(first.expected);
    expect(second.noiseStd).toEqual(first.noiseStd);
    runtime.destroy();
  }, scaledTimeout(600_000));

  it("a Siemens star's diagonals flag pixels (lattice points exactly on a sector boundary); without recomputation they keep the kernel's values", async () => {
    const fixture = await displayViewGpuFixture(QUALITY_CASES[1]![1], { ...SMALL_VIEW, region: { x: 80, y: 50, width: 40, height: 30 } }), runtime = await runtimeOf(createFakeGpu().gpu);
    const raw = await renderOnGpuQuality(runtime, fixture, undefined, false);
    expect(raw.flaggedPixelIndices.length).toBeGreaterThan(0);
    expect(raw.hostRecomputedPixelIndices.length).toBe(0);
    expect(raw.execution.diagnosticUncertaintySampleCount).toBe(raw.flaggedPixelIndices.length);
    expect(raw.execution.diagnosticsExact).toBe(false);
    let uncertain = 0;
    for (const i of raw.flaggedPixelIndices) if ((raw.pixelFlags[i]! & DISPLAY_VIEW_QUALITY_FLAG.materialUncertain) !== 0) uncertain++;
    expect(uncertain).toBeGreaterThan(0);
    runtime.destroy();
  }, scaledTimeout(600_000));

  it("#457: where AHD's choice can move a pixel the kernel flags it (recompute) instead of keeping the candidates' average", async () => {
    // The star's centre: the reference takes AHD's choice on the noise-free mosaic there, which the kernel does not compute.
    const fixture = await displayViewGpuFixture(QUALITY_CASES[1]![1], { ...SMALL_VIEW, region: { x: 80, y: 50, width: 40, height: 30 } }), runtime = await runtimeOf(createFakeGpu().gpu);
    const raw = await renderOnGpuQuality(runtime, fixture, undefined, false);
    let choice = 0, moved = 0;
    for (let i = 0; i < raw.pixelFlags.length; i++) {
      if ((raw.pixelFlags[i]! & DISPLAY_VIEW_QUALITY_FLAG.ahdChoice) === 0) continue;
      choice++;
      // Kept unrecomputed, such a pixel is the candidates' average; some of them differ from the reference by more than the
      // tolerance the flag guards (DISPLAY_VIEW_QUALITY_CHOICE_SIGMA of the pixel's noise σ).
      for (let c = 0; c < 3; c++) if (Math.abs(raw.expected[3 * i + c]! - fixture.cpu.expected[3 * i + c]!) > DISPLAY_VIEW_QUALITY_CHOICE_SIGMA * fixture.cpu.noiseStd[3 * i + c]!) { moved++; break; }
    }
    expect(choice).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
    // A uniform patch never flags it: its two candidates are equal everywhere.
    const flat = await displayViewGpuFixture({ ...QUALITY_CASES[0]![1], scene: { preset: "uniform", reflectance: 0.18 } }, { ...SMALL_VIEW, region: { x: 80, y: 50, width: 16, height: 12 } });
    const uniform = await renderOnGpuQuality(runtime, flat, undefined, false);
    expect(uniform.pixelFlags.every((flag) => (flag & DISPLAY_VIEW_QUALITY_FLAG.ahdChoice) === 0)).toBe(true);
    runtime.destroy();
  }, scaledTimeout(600_000));

  it("banding never changes a byte, and a region equals the same pixels of the whole view", async () => {
    const fixture = await displayViewGpuFixture(QUALITY_CASES[3]![1], SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const whole = await renderOnGpuQuality(runtime, fixture), banded = await renderOnGpuQuality(runtime, fixture, 1 << 20);
    expect(banded.samples).toEqual(whole.samples);
    expect(banded.expected).toEqual(whole.expected);
    expect(banded.noiseStd).toEqual(whole.noiseStd);
    expect(Array.from(banded.flaggedPixelIndices)).toEqual(Array.from(whole.flaggedPixelIndices));
    const region = { x: 90, y: 60, width: 24, height: 16 };
    const part = await displayViewGpuFixture(QUALITY_CASES[3]![1], { ...SMALL_VIEW, region }), partGpu = await renderOnGpuQuality(runtime, part);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let c = 0; c < 3; c++) {
      const o = ((region.y + y) * SMALL_VIEW.width + region.x + x) * 3 + c, p = (y * region.width + x) * 3 + c;
      expect(partGpu.samples[p]).toBe(whole.samples[o]);
      expect(partGpu.expected[p]).toBe(whole.expected[o]);
    }
    runtime.destroy();
  }, scaledTimeout(900_000));

  it("refuses what the kernels do not cover, naming the reason", async () => {
    const base = QUALITY_CASES[3]![1];
    const probe = async (options: SimulateCaptureOptions, view = SMALL_VIEW): Promise<string | null> => {
      const f = await displayViewGpuFixture(options, view);
      return displayViewQualityGpuUnsupportedReason(f.input.setup, f.input.signalInput);
    };
    expect(await probe(base)).toBeNull();
    expect(await probe(base, { width: 60, height: 40 })).toMatch(/stratified/u);
    const fixture = await displayViewGpuFixture(base, SMALL_VIEW), setup = fixture.input.setup;
    expect(displayViewQualityGpuUnsupportedReason({ ...setup, ahdCollect: new Set() }, fixture.input.signalInput)).toMatch(/collect/u);
    expect(displayViewQualityGpuUnsupportedReason({ ...setup, candidates: setup.candidates!.map((p) => [...p, p[0]!]) }, fixture.input.signalInput)).toMatch(/1 or 2/u);
    expect(displayViewQualityGpuUnsupportedReason({ ...setup, candidates: setup.candidates!.map((p) => p.map((d) => d.map((k) => k.map((t) => ({ ...t, weight: t.weight * 0.3 }))))) }, fixture.input.signalInput)).toMatch(/dyadic/u);
    expect(displayViewQualityGpuUnsupportedReason({ ...setup, toneCurve: "other" as never }, fixture.input.signalInput)).toMatch(/tone curve/u);
    expect(displayViewQualityGpuUnsupportedReason(setup, { ...fixture.input.signalInput, scene: { kind: "radiance", radianceAt: () => 1 } })).toMatch(/radiance/u);
    expect(displayViewQualityGpuSupports({ ahd: true, diffraction: true, antiAliasing: true, boxSamples: 2, toneCurve: "identity", scene: "chart" })).toBe(true);
    expect(displayViewQualityGpuSupports({ ahd: true, diffraction: true, antiAliasing: true, boxSamples: 5, toneCurve: "identity", scene: "chart" })).toMatch(/64 query offsets/u);
    expect(displayViewQualityGpuSupports({ ahd: true, diffraction: true, antiAliasing: true, boxSamples: 2, toneCurve: "identity", scene: "material-function" })).toMatch(/caller/u);
    const runtime = await runtimeOf(createFakeGpu().gpu);
    await expect(renderOnGpuQuality(runtime, { ...fixture, input: { ...fixture.input, setup: { ...setup, ahdCollect: new Set() } } })).rejects.toMatchObject({ reason: "unsupported-on-backend" });
    runtime.destroy();
  }, scaledTimeout(300_000));

  it("the lattice pass assembles with both material modules without declaring a name twice (the fake device does not compile WGSL)", async () => {
    const { chartCompositeMaterialWgsl } = await import("../src/gpu/display-view-composite-material-module.js");
    const declared = (code: string): string[] => [...code.matchAll(/\b(?:fn|const|struct|var<private>|var<uniform>|var<storage[^>]*>|alias)\s+([A-Za-z_][A-Za-z0-9_]*)/gu)].map((m) => m[1]!);
    for (const module of [chartPresetMaterialWgsl(), chartCompositeMaterialWgsl()]) {
      const names = declared(assembleDisplayViewQualityLatticeWgsl(module)), seen = new Set<string>(), twice: string[] = [];
      for (const name of names) { if (seen.has(name)) twice.push(name); seen.add(name); }
      expect(twice).toEqual([]);
    }
  });

  it("the three kernels assemble: the lattice pass takes the material module, the others are self-contained", () => {
    const lattice = assembleDisplayViewQualityLatticeWgsl(chartPresetMaterialWgsl());
    expect(lattice).toContain("fn material_at(p: vec2<f32>) -> u32");
    expect(lattice.match(/const E: f32/gu)).toHaveLength(1);
    expect(lattice.match(/const SLACK: f32/gu)).toHaveLength(1);
    expect(DISPLAY_VIEW_QUALITY_LATTICE_WGSL).not.toContain("fn material_at(");
    for (const code of [DISPLAY_VIEW_QUALITY_SITES_WGSL, DISPLAY_VIEW_QUALITY_PIXELS_WGSL]) {
      expect(code).toContain("@compute @workgroup_size(64)");
      expect(code).not.toContain("material_at");
    }
    // The pixel kernel binds eight storage buffers (the WebGPU default limit per stage) and one uniform.
    expect(DISPLAY_VIEW_QUALITY_PIXELS_WGSL.match(/var<storage/gu)).toHaveLength(8);
  });

  it("through prepareDisplayView({ gpu: \"auto\" }): the combined renderer routes a Quality request to the Quality kernels and a Speed request to the Speed kernel, within their bounds", async () => {
    const previous = registerDisplayViewGpuRenderer();
    try {
      const options = QUALITY_CASES[3]![1], view = { width: 203, height: 135, region: { x: 70, y: 50, width: 40, height: 24 } };
      const cpu = await prepareDisplayView(options), gpu = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      try {
        const reference = await cpu.render(view), rendered = await gpu.render(view), execution = rendered.diagnostics.fast.execution;
        expect(execution.backend).toBe("webgpu-f32");
        expect(execution.fallbackReason).toBeNull();
        expect(execution.conformance).toMatchObject({ passed: true, failedCase: null });
        expect(execution.conformance!.cases).toContain(DISPLAY_VIEW_SPEED_CONFORMANCE_CASE.id);
        // #594: the Quality cases ran before this first Quality render, after the device's own cases.
        expect(execution.conformance!.cases).toEqual([...DISPLAY_VIEW_GPU_BUILT_IN_CASES.map((c) => c.id), DISPLAY_VIEW_SPEED_CONFORMANCE_CASE.id,
          DISPLAY_VIEW_QUALITY_CONFORMANCE_CASE.id, DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE.id]);
        expect(rendered.assumptions.some((a) => a.id === "view.execution")).toBe(true);
        let differing = 0;
        for (let i = 0; i < reference.image.samples.length; i++) { const d = Math.abs(rendered.image.samples[i]! - reference.image.samples[i]!); expect(d).toBeLessThanOrEqual(1); if (d) differing++; }
        expect(differing).toBeLessThanOrEqual(0.01 * reference.image.samples.length);
        expect(rendered.diagnostics.ahdCorrectedPixelCount).toBe(reference.diagnostics.ahdCorrectedPixelCount);
      } finally { cpu.dispose(); gpu.dispose(); }
      // A Speed request through the same renderer.
      const speed = { scene: { preset: "checkerboard" as const, squaresAcross: 12 }, lens: { prime: 50 as const, fNumber: 8 }, sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } }, output: { ...SMALL_FRAME, format: "srgb-8" as const } };
      const speedGpu = await prepareDisplayView(speed, { gpu: "require", gpuDevice: createFakeGpu().gpu });
      // #594: a Speed-only view never runs the Quality cases (nor loads their code for them).
      try {
        expect((await speedGpu.render(view)).diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null,
          conformance: { passed: true, cases: [...DISPLAY_VIEW_GPU_BUILT_IN_CASES.map((c) => c.id), DISPLAY_VIEW_SPEED_CONFORMANCE_CASE.id] } });
      } finally { speedGpu.dispose(); }
      // A caller scene still falls back, and a coarse view is refused at render time.
      const coarse = await prepareDisplayView(options, { gpu: "require", gpuDevice: createFakeGpu().gpu });
      await expect(coarse.render({ width: 60, height: 40 })).rejects.toMatchObject({ reason: "unsupported-on-backend" });
      coarse.dispose();
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(900_000));

  it("the combined renderer's id, cases and support check", async () => {
    const runtime = await runtimeOf(createFakeGpu().gpu), renderer = createDisplayViewGpuRenderer(runtime);
    expect(renderer.id).toBe("photivra-display-view");
    // #594: the Speed case runs at the device's first render; the Quality cases load with the Quality code (onDemandConformanceCases).
    expect(renderer.conformanceCases!.map((c) => c.id)).toEqual([DISPLAY_VIEW_SPEED_CONFORMANCE_CASE.id]);
    expect(DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES.map((c) => c.id)).toEqual([DISPLAY_VIEW_QUALITY_CONFORMANCE_CASE.id, DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE.id]);
    expect(renderer.supports({ ahd: false, diffraction: false, antiAliasing: false, boxSamples: 2, toneCurve: "identity", scene: "chart" })).toBe(true);
    expect(renderer.supports({ ahd: true, diffraction: true, antiAliasing: true, boxSamples: 2, toneCurve: "identity", scene: "chart" })).toBe(true);
    expect(renderer.supports({ ahd: true, diffraction: true, antiAliasing: true, boxSamples: 2, toneCurve: "identity", scene: "radiance-function" })).toMatch(/caller/u);
    runtime.destroy();
  });

  it("the Quality self-check case passes on the emulation and honours an abort", async () => {
    const runtime = await runtimeOf(createFakeGpu().gpu);
    expect(await DISPLAY_VIEW_QUALITY_CONFORMANCE_CASE.run(runtime, undefined)).toBe(true);
    const aborted = new AbortController();
    aborted.abort();
    await expect(DISPLAY_VIEW_QUALITY_CONFORMANCE_CASE.run(runtime, aborted.signal)).rejects.toMatchObject({ reason: "aborted" });
    runtime.destroy();
  }, scaledTimeout(120_000));

  it("a one-pixel region render of the reference is the whole view's pixel with the Quality options (the recomputation of flagged pixels relies on it)", async () => {
    const fixture = await displayViewGpuFixture(QUALITY_CASES[1]![1], SMALL_VIEW), setup = fixture.input.setup;
    const { createDisplayViewExpectedSignal } = await import("../src/facade/display-view.js");
    for (const [x, y] of [[0, 0], [101, 67], [202, 134]] as const) {
      const pixel = await renderDisplayView({ ...setup, signal: createDisplayViewExpectedSignal(fixture.input.signalInput), region: { x, y, width: 1, height: 1 } });
      const o = (y * SMALL_VIEW.width + x) * 3;
      expect(Array.from(pixel.samples)).toEqual(Array.from(fixture.cpu.samples.subarray(o, o + 3)));
      expect(Array.from(pixel.expected)).toEqual(Array.from(fixture.cpu.expected.subarray(o, o + 3)));
    }
  }, scaledTimeout(120_000));

  it("#491: a material-layers scene (every composite element under the label layer) renders Quality through the composite module, within its bounds", async () => {
    const declared = layeredScene(FIXTURE_ASPECT), region = { x: 50, y: 70, width: 48, height: 36 };
    const variants: [string, SimulateCaptureOptions][] = [
      ["material-layers, frame-filling, diffraction + four-spot + AHD", { scene: declared, lens, sensor, output }],
      ["material-layers, fixed-size chart with surround, AHD without diffraction", { scene: declared, lens: { prime: 50, fNumber: 8 }, sensor, output, chartSize: { widthM: 0.042 }, subjectDistanceM: 0.63 }]
    ];
    for (const [name, options] of variants) {
      const fixture = await displayViewGpuFixture(options, { ...SMALL_VIEW, region }), runtime = await runtimeOf(createFakeGpu().gpu);
      const module = await qualityMaterialModule(materialModulesOf(runtime), fixture.input.setup.gpu!, new AbortController().signal);
      expect(module.id).toBe(CHART_COMPOSITE_MATERIAL_MODULE_ID);
      // The scene records are buffers the module holds on the device (the bindings' buffer form).
      expect(module.bindings.some((b) => b.buffer !== undefined)).toBe(true);
      const gpu = await renderOnGpuQuality(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
      record("#491 " + name + " (48 × 36 region)", a, { flagged: gpu.flaggedPixelIndices.length, tapsPerSite: gpu.tapsPerSite });
      expect(a.outsideExpectedBound).toBe(0);
      expect(a.outsideVarianceBound).toBe(0);
      expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
      expect(a.deltaEMaximum).toBeLessThan(0.01);
      expect(a.sigmaUnitsMaximum).toBeLessThan(0.01);
      expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
      for (const i of gpu.flaggedPixelIndices) for (let c = 0; c < 3; c++) expect(gpu.expected[3 * i + c]).toBe(fixture.cpu.expected[3 * i + c]);
      runtime.destroy();
    }
  }, scaledTimeout(900_000));

  it("#491: with diffraction the composite module is given the lattice groups as its offsets and the reference's lattice formula as its query points", async () => {
    const fixture = await displayViewGpuFixture({ scene: layeredScene(FIXTURE_ASPECT), lens, sensor, output }, { ...SMALL_VIEW, region: { x: 0, y: 0, width: 4, height: 4 } });
    const gpu = fixture.input.setup.gpu!, derived = qualityMaterialSetup(gpu), input = gpu.signalInput;
    expect(input.kernels).toBeDefined();
    expect(derived.signalInput.kernels).toBeUndefined();
    expect(derived.signalInput.offsets).toHaveLength(4);
    // The query point of group o at lattice point (p, q) is the reference's lattice formula (createDisplayViewExpectedSignal).
    const W = input.nativeWidth, H = input.nativeHeight, g = 2 / input.outputWidth, point = new Float64Array(2);
    derived.signalInput.offsets.forEach((o, index) => {
      for (const [p, q] of [[0, 0], [17, 5], [W - 1, H - 1]] as const) {
        derived.signalInput.queryPoint!(p, q, index, point);
        expect(point[0]).toBe(o.x === 0 ? (p + 0.5 - W / 2) * g : (p + 0.5 + o.x - W / 2) * g);
        expect(point[1]).toBe(-(o.y === 0 ? (q + 0.5 - H / 2) : (q + 0.5 + o.y - H / 2)) * g);
      }
    });
    // Without diffraction the setup is the request's own.
    const plain = await displayViewGpuFixture({ scene: layeredScene(FIXTURE_ASPECT), lens: { prime: 50, fNumber: 8 }, sensor, output }, { ...SMALL_VIEW, region: { x: 0, y: 0, width: 4, height: 4 } });
    expect(qualityMaterialSetup(plain.input.setup.gpu!)).toBe(plain.input.setup.gpu!);
  }, scaledTimeout(120_000));

  it("#492: lens.defocus is supported by the GPU renderer; in focus the request is the in-focus render, out of focus the GPU gathers the disc", async () => {
    const quality = { ahd: true, diffraction: true, antiAliasing: true, boxSamples: 2, toneCurve: "identity" as const, scene: "chart" as const };
    expect(displayViewQualityGpuSupports({ ...quality, defocus: true })).toBe(true);
    const runtime = await runtimeOf(createFakeGpu().gpu), renderer = createDisplayViewGpuRenderer(runtime);
    expect(renderer.supports({ ...quality, defocus: true })).toBe(true);
    expect(renderer.supports({ ...quality, ahd: false, diffraction: false, antiAliasing: false, defocus: true })).toBe(true);
    expect(renderer.supports({ ...quality, defocus: false })).toBe(true);
    renderer.dispose?.();
    runtime.destroy();
    const previous = registerDisplayViewGpuRenderer();
    try {
      const base = QUALITY_CASES[3]![1], view = { ...SMALL_VIEW, region: { x: 90, y: 60, width: 12, height: 8 } };
      // In focus: the option resolves a zero disc and the GPU renders the view with the tap-list site pass, as without the option.
      const plain = await prepareDisplayView(base, { gpu: "require", gpuDevice: createFakeGpu().gpu });
      const inFocus = await prepareDisplayView({ ...base, lens: { ...lens, defocus: { model: "geometric-disc" } } }, { gpu: "require", gpuDevice: createFakeGpu().gpu });
      try {
        const a = await plain.render(view), b = await inFocus.render(view);
        expect(b.diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null });
        expect(Array.from(b.image.samples)).toEqual(Array.from(a.image.samples));
      } finally { plain.dispose(); inFocus.dispose(); }
      // Out of focus (#492 step 2c): the GPU renders it, within one code of the CPU reference (test/display-view-defocus-gpu.test.ts has the bounds).
      const defocused = { ...base, lens: { ...lens, focusDistanceM: 1.5, defocus: { model: "geometric-disc" as const } }, subjectDistanceM: 3 };
      const off = await prepareDisplayView(defocused), gpu = await prepareDisplayView(defocused, { gpu: "require", gpuDevice: createFakeGpu().gpu });
      try {
        const cpu = await off.render(view), rendered = await gpu.render(view);
        expect(rendered.diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null });
        for (let i = 0; i < cpu.image.samples.length; i++) expect(Math.abs(rendered.image.samples[i]! - cpu.image.samples[i]!)).toBeLessThanOrEqual(1);
      } finally { off.dispose(); gpu.dispose(); }
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(300_000));

  it("reports the measured agreement", () => {
    process.stdout.write("[display-view quality gpu emulation] " + JSON.stringify(report, null, 1) + "\n");
  });
});
