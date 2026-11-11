// SPDX-License-Identifier: Apache-2.0
/**
 * The display view's Speed kernel on the GPU (#478) against the CPU reference, on the in-process float32 emulation of the
 * WGSL (test/helpers/fake-webgpu-display-view.ts): per-pixel agreement of the expected value in ΔE2000 and noise-σ units
 * and of the noise standard deviation, inside the result's a-priori bounds; the noise draw bit-identical to the CPU's;
 * flagged pixels recomputed with the reference; banding; the support check. Real-device conformance:
 * test/webgpu/display-view.webgpu.ts.
 */
import { describe, expect, it } from "vitest";
import { DISPLAY_VIEW_NOISE_STREAM_ID, renderDisplayView } from "../src/facade/display-view.js";
import { createDeterministicUniformStream, deriveNativeSiteStreamSeedUint32, samplePortableStandardNormal } from "../src/sensor/stochastic-seed.js";
import { DISPLAY_VIEW_SPEED_CONFORMANCE_CASE, displayViewSpeedGpuRelativeBounds, displayViewSpeedGpuUnsupportedReason, finishDisplayViewPixel,
  registerDisplayViewSpeedGpuRenderer } from "../src/gpu/display-view-speed-gpu.js";
import { setDisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.js";
import { chartPresetMaterialModule, chartPresetMaterialWgsl } from "../src/gpu/display-view-chart-material-module.js";
import { assembleDisplayViewSpeedWgsl } from "../src/gpu/wgsl-display-view-speed-kernel.js";
import { ImageKernelExecutionError, prepareDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { resolvePortableChartScene } from "../src/facade/chart-scenes.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, renderOnGpu, runtimeOf, type DisplayViewAgreement } from "./helpers/display-view-gpu-fixture.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
const output = { ...SMALL_FRAME, format: "srgb-8" as const };
/** The small fixtures: five chart presets at ISO 100, plus the clips (a bright wedge at the white level, a dark wedge at ISO 6400) and the Reinhard curve. */
const cases: [string, SimulateCaptureOptions][] = [
  ["slanted edge", { scene: { preset: "slanted-edge", angleDegrees: 5 }, lens: { prime: 50, fNumber: 8 }, sensor, output }],
  ["Siemens star (bar)", { scene: { preset: "siemens-star", cycles: 36 }, lens: { prime: 50, fNumber: 8 }, sensor, output }],
  ["step wedge", { scene: { preset: "step-wedge", steps: 11 }, lens: { prime: 50, fNumber: 8 }, sensor, output }],
  ["checkerboard", { scene: { preset: "checkerboard", squaresAcross: 12 }, lens: { prime: 50, fNumber: 8 }, sensor, output }],
  ["spectral patches", { scene: { preset: "patches", columns: 4, patches: Array.from({ length: 8 }, (_, i) => ({ patchId: `p${i}`, reflectance: i % 2 === 0 ?
    { kind: "tabulated" as const, samples: [380, 480, 580, 680, 780].map((w, j) => ({ wavelengthNanometers: w, value: 0.1 + 0.08 * i + 0.1 * j })) } : 0.05 + 0.1 * i })) },
    lens: { prime: 50, fNumber: 8 }, sensor, output }],
  ["step wedge at the white clip", { scene: { preset: "step-wedge", steps: 11 }, lens: { prime: 50, fNumber: 8 }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 15 }, sensor, output }],
  ["step wedge at ISO 6400", { scene: { preset: "step-wedge", steps: 11 }, lens: { prime: 50, fNumber: 8 }, exposure: { mode: "manual", iso: 6400, shutterSeconds: 1 / 8000 }, sensor, output }],
  ["step wedge, Reinhard", { scene: { preset: "step-wedge", steps: 11 }, lens: { prime: 50, fNumber: 8 }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 }, sensor,
    output: { ...output, toneCurve: "positive-reinhard-per-channel" } }],
  // #593: the luminance tone curves (Photivra's Standard and Flat looks), fast (8-point rule) and full (4 × 16 points), and in the clip.
  ["step wedge, Standard look", { scene: { preset: "step-wedge", steps: 11 }, lens: { prime: 50, fNumber: 8 }, exposure: { mode: "manual", iso: 1600, shutterSeconds: 1 / 250 }, sensor,
    output: { ...output, toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 } } }],
  ["spectral patches, Flat look (full rule)", { scene: { preset: "patches", columns: 4, patches: Array.from({ length: 8 }, (_, i) => ({ patchId: `p${i}`, reflectance: i % 2 === 0 ?
    { kind: "tabulated" as const, samples: [380, 480, 580, 680, 780].map((w, j) => ({ wavelengthNanometers: w, value: 0.1 + 0.08 * i + 0.1 * j })) } : 0.05 + 0.1 * i })) },
    lens: { prime: 50, fNumber: 8 }, sensor, fast: false, output: { ...output, toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1, semiSaturation: 0.8465, whiteLuminance: 32 } } }],
  ["step wedge at the white clip, extended Reinhard", { scene: { preset: "step-wedge", steps: 11 }, lens: { prime: 50, fNumber: 8 }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 15 }, sensor,
    output: { ...output, toneCurve: "extended-reinhard-luminance", toneCurveParameters: { whiteLuminance: 4 } } }]
];

const report: Record<string, unknown>[] = [];
function record(name: string, a: DisplayViewAgreement, extra: Record<string, unknown> = {}): void {
  report.push({ case: name, ...extra, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaUnitsRms: a.sigmaUnitsRms,
    sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference,
    largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio });
}

describe("display view Speed kernel (float32 emulation) vs the CPU reference", () => {
  it.each(cases)("%s: every component is inside the a-priori bounds; samples differ by at most one code", async (name, options) => {
    const fixture = await displayViewGpuFixture(options, SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const gpu = await renderOnGpu(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
    record(name, a, { flagged: gpu.flaggedPixelIndices.length, recomputed: gpu.hostRecomputedPixelIndices.length });
    expect(gpu.estimation).toBe("exact-area-mean");
    expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32", bitIdenticalToReference: false, fast: true, diagnosticsExact: true });
    expect(gpu.execution.errorBound).toEqual(gpu.expectedValueBound);
    expect(gpu.expectedValueBound.relative).toBe(displayViewSpeedGpuRelativeBounds(fixture.input.setup.toneCurve).mean);
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.differingSamples).toBeLessThanOrEqual(0.01 * a.pixels * 3);
    // Agreement in perceptual and noise units, far below one 8-bit code and one noise standard deviation.
    expect(a.deltaEMaximum).toBeLessThan(0.01);
    expect(a.sigmaUnitsMaximum).toBeLessThan(0.01);
    expect(a.sigmaRelativeMaximum).toBeLessThan(0.01);
    // Flagged pixels are recomputed with the reference, so they equal it exactly.
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    for (const i of gpu.flaggedPixelIndices) for (let c = 0; c < 3; c++) {
      expect(gpu.samples[3 * i + c]).toBe(fixture.cpu.samples[3 * i + c]);
      expect(gpu.expected[3 * i + c]).toBe(fixture.cpu.expected[3 * i + c]);
    }
    runtime.destroy();
  }, scaledTimeout(120_000));

  it("a Siemens star's diagonals flag pixels (query points exactly on a sector boundary), and without recomputation they stay the kernel's values", async () => {
    const fixture = await displayViewGpuFixture(cases[1]![1], SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const raw = await renderOnGpu(runtime, fixture, undefined, false);
    expect(raw.flaggedPixelIndices.length).toBeGreaterThan(0);
    expect(raw.hostRecomputedPixelIndices.length).toBe(0);
    expect(raw.execution.diagnosticUncertaintySampleCount).toBe(raw.flaggedPixelIndices.length);
    expect(raw.execution.diagnosticsExact).toBe(false);
    runtime.destroy();
  }, scaledTimeout(60_000));

  it("banding never changes a byte, and a region equals the same pixels of the whole view", async () => {
    const fixture = await displayViewGpuFixture(cases[1]![1], SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const whole = await renderOnGpu(runtime, fixture), banded = await renderOnGpu(runtime, fixture, 4096);
    expect(banded.samples).toEqual(whole.samples);
    expect(banded.expected).toEqual(whole.expected);
    expect(banded.noiseStd).toEqual(whole.noiseStd);
    expect(Array.from(banded.flaggedPixelIndices)).toEqual(Array.from(whole.flaggedPixelIndices));
    const region = { x: 90, y: 60, width: 24, height: 16 };
    const part = await displayViewGpuFixture(cases[1]![1], { ...SMALL_VIEW, region }), partGpu = await renderOnGpu(runtime, part);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let c = 0; c < 3; c++) {
      const o = ((region.y + y) * SMALL_VIEW.width + region.x + x) * 3 + c, p = (y * region.width + x) * 3 + c;
      expect(partGpu.samples[p]).toBe(whole.samples[o]);
      expect(partGpu.expected[p]).toBe(whole.expected[o]);
    }
    runtime.destroy();
  }, scaledTimeout(120_000));

  it("the noise draw is the CPU's: the same stream, seed and three portable normals per display pixel", async () => {
    // The finishing function draws from createDeterministicUniformStream(deriveNativeSiteStreamSeedUint32(seed, index, 33)), as renderDisplayView.
    const fixture = await displayViewGpuFixture(cases[2]![1], SMALL_VIEW), setup = fixture.input.setup;
    for (const index of [0, 777, SMALL_VIEW.width * SMALL_VIEW.height - 1]) {
      const stream = createDeterministicUniformStream(deriveNativeSiteStreamSeedUint32(setup.seed, index, DISPLAY_VIEW_NOISE_STREAM_ID));
      const z = [samplePortableStandardNormal(stream), samplePortableStandardNormal(stream), samplePortableStandardNormal(stream)];
      // With a diagonal covariance and no clip, the finished sample is round(encode(mean + σ·z)·255) for the CPU's z.
      const samples = new Uint8Array(3), expected = new Float64Array(3), noiseStd = new Float64Array(3), v = 1e-6;
      finishDisplayViewPixel([0.4, 0.5, 0.6, v, v, v, 0, 0, 0], 0, setup.seed, index, 1 / 255, 255, samples, expected, noiseStd, 0);
      const { encodeSrgbComponentPortable } = await import("../src/color/srgb-transfer.js");
      for (let c = 0; c < 3; c++) expect(samples[c]).toBe(Math.round(encodeSrgbComponentPortable(0.4 + 0.1 * c + Math.sqrt(v) * z[c]!) * 255));
    }
    // End to end on a uniform chart (every pixel's moments equal within the bound): the samples equal the CPU's bytes.
    const uniform = await displayViewGpuFixture({ scene: { preset: "uniform", reflectance: 0.18 }, lens: { prime: 50, fNumber: 8 }, sensor, output }, SMALL_VIEW);
    const runtime = await runtimeOf(createFakeGpu().gpu), gpu = await renderOnGpu(runtime, uniform), a = compareDisplayViews(uniform.cpu, gpu);
    record("uniform 18 % grey", a);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.outsideExpectedBound + a.outsideVarianceBound).toBe(0);
    runtime.destroy();
  }, scaledTimeout(60_000));

  it("refuses what the kernel does not cover, naming the reason", async () => {
    const base = cases[0]![1];
    const probe = async (options: SimulateCaptureOptions, view = SMALL_VIEW): Promise<string | null> => {
      const f = await displayViewGpuFixture(options, view);
      return displayViewSpeedGpuUnsupportedReason(f.input.setup, f.input.signalInput);
    };
    expect(await probe(base)).toBeNull();
    expect(await probe({ ...base, lens: { prime: 50, fNumber: 8, diffraction: "circular-aperture" } })).toMatch(/diffraction/u);
    expect(await probe({ ...base, output: { ...output, demosaic: "ahd" } })).toMatch(/AHD/u);
    expect(await probe(base, { width: 60, height: 40 })).toMatch(/stratified/u);
    const fixture = await displayViewGpuFixture(base, SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    await expect(renderOnGpu(runtime, { ...fixture, input: { ...fixture.input, setup: { ...fixture.input.setup, toneCurve: "identity", candidates: fixture.input.setup.demosaic.map((p) => [p]) } } }))
      .rejects.toMatchObject({ reason: "unsupported-on-backend" });
    expect(() => chartPresetMaterialModule(resolvePortableChartScene({ scene: { preset: "dead-leaves" }, aspect: 2 / 3 }))).toThrow(ImageKernelExecutionError);
    expect(() => chartPresetMaterialModule(resolvePortableChartScene({ scene: { preset: "siemens-star", profile: "sine" }, aspect: 2 / 3 }))).toThrow(/sine|composite/u);
    runtime.destroy();
  }, scaledTimeout(60_000));

  it("the material module renames the chart kernel's classification and binds it at group 1", () => {
    const wgsl = chartPresetMaterialWgsl(), shader = assembleDisplayViewSpeedWgsl(wgsl);
    expect(wgsl).toContain("fn material_at(p: vec2<f32>) -> u32");
    expect(wgsl).toContain("var<private> material_uncertain: bool;");
    expect(wgsl).toContain("@group(1) @binding(0) var<uniform> chart: ChartParams;");
    expect(wgsl).not.toMatch(/\bparams\.|\baux\[|\bflagged\b/u);
    expect(shader).toContain("const SAFETY: f32 = 8.0;");
    // One definition of each shared constant.
    expect(shader.match(/const E: f32/gu)).toHaveLength(1);
    expect(shader.match(/const SLACK: f32/gu)).toHaveLength(1);
  });

  it("a one-pixel region render of the reference is the whole view's pixel (the recomputation of flagged pixels relies on it)", async () => {
    const fixture = await displayViewGpuFixture(cases[3]![1], SMALL_VIEW), setup = fixture.input.setup;
    const { createDisplayViewExpectedSignal } = await import("../src/facade/display-view.js");
    for (const [x, y] of [[0, 0], [101, 67], [202, 134]] as const) {
      const pixel = await renderDisplayView({ ...setup, signal: createDisplayViewExpectedSignal(fixture.input.signalInput), region: { x, y, width: 1, height: 1 } });
      const o = (y * SMALL_VIEW.width + x) * 3;
      expect(Array.from(pixel.samples)).toEqual(Array.from(fixture.cpu.samples.subarray(o, o + 3)));
      expect(Array.from(pixel.expected)).toEqual(Array.from(fixture.cpu.expected.subarray(o, o + 3)));
    }
  }, scaledTimeout(60_000));

  it("through prepareDisplayView({ gpu: \"auto\" }): the registered renderer passes the self-check, renders the view within its bound and labels it", async () => {
    const previous = registerDisplayViewSpeedGpuRenderer();
    try {
      const options = cases[3]![1], cpu = await prepareDisplayView(options), gpu = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      try {
        const reference = await cpu.render(SMALL_VIEW), view = await gpu.render(SMALL_VIEW), execution = view.diagnostics.fast.execution;
        expect(execution.backend).toBe("webgpu-f32");
        expect(execution.fallbackReason).toBeNull();
        expect(execution.conformance).toMatchObject({ passed: true, failedCase: null });
        expect(execution.conformance!.cases).toContain(DISPLAY_VIEW_SPEED_CONFORMANCE_CASE.id);
        expect(execution.errorBound).toMatchObject({ kind: "relative-to-reference" });
        expect(view.assumptions.some((a) => a.id === "view.execution")).toBe(true);
        let differing = 0;
        for (let i = 0; i < reference.image.samples.length; i++) { const d = Math.abs(view.image.samples[i]! - reference.image.samples[i]!); expect(d).toBeLessThanOrEqual(1); if (d) differing++; }
        expect(differing).toBeLessThanOrEqual(0.01 * reference.image.samples.length);
        // A request the renderer does not cover falls back with the reason, and fails with "require".
        const ahd = { ...options, output: { ...output, demosaic: "ahd" as const } };
        const fallback = await prepareDisplayView(ahd, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
        expect((await fallback.render(SMALL_VIEW)).diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
        fallback.dispose();
        await expect(prepareDisplayView(ahd, { gpu: "require", gpuDevice: createFakeGpu().gpu })).rejects.toMatchObject({ reason: "unsupported-on-backend" });
        // A view coarser than the exact area mean is refused at render time ("require" surfaces the reason).
        const coarse = await prepareDisplayView(options, { gpu: "require", gpuDevice: createFakeGpu().gpu });
        await expect(coarse.render({ width: 60, height: 40 })).rejects.toMatchObject({ reason: "unsupported-on-backend" });
        coarse.dispose();
      } finally { cpu.dispose(); gpu.dispose(); }
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(120_000));

  it("the self-check case passes on the emulation and reports a sentence when the device disagrees", async () => {
    const runtime = await runtimeOf(createFakeGpu().gpu);
    expect(await DISPLAY_VIEW_SPEED_CONFORMANCE_CASE.run(runtime, undefined)).toBe(true);
    const aborted = new AbortController();
    aborted.abort();
    await expect(DISPLAY_VIEW_SPEED_CONFORMANCE_CASE.run(runtime, aborted.signal)).rejects.toMatchObject({ reason: "aborted" });
    runtime.destroy();
  }, scaledTimeout(60_000));

  it("reports the measured agreement", () => {
    process.stdout.write("[display-view gpu emulation] " + JSON.stringify(report, null, 1) + "\n");
  });
});
