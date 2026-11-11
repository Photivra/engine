// SPDX-License-Identifier: Apache-2.0
/**
 * The display view's composite material module under fused contraction (2.11.0, the owner's M5 Pro run of October 27, 2026), on the
 * fake device's emulation (test/helpers/fake-webgpu-composite.ts): with a multiply and an add fused into one rounding wherever the
 * dataflow allows (W3C WGSL, § 15.7.5 "Reassociation and Fusion"), the probe picks the fma product path, and the Speed and Quality
 * views of the #491 fixtures (material-layers scenes, the 2.3 elements as plain charts, a fixed-size chart) render inside their
 * a-priori bounds and the #480 acceptance thresholds. The unfused (Dekker) renders of the same cases are
 * test/display-view-composite-gpu.test.ts. The contraction model covers the composite kernel's classification, its probe and the
 * lattice recovery (where the error-free transforms are); the Speed and Quality kernels' own sample arithmetic runs as in the other
 * emulation tests. The emulation under contraction is slow (a full 203 × 135 view of a frame-filling chart takes about 40 s per model
 * without coverage, measured on an M5 Pro), so a frame-filling case renders one fixed 48 × 36 region of the view, as the Quality case
 * does; the fixed-size charts render the whole view, chart edge and surround. Every query of both composite scenes under contraction
 * is checked against the reference in test/chart-composite-contraction.test.ts. Through `prepareDisplayView`, the probe record is in
 * `diagnostics.fast.execution.compositeProbe`, on a GPU render and on a refusal's CPU fallback alike.
 */
import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prepareDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { setDisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.js";
import { qualityMaterialModule } from "../src/gpu/display-view-quality-gpu.js";
import { registerDisplayViewGpuRenderer } from "../src/gpu/display-view-gpu-renderer.js";
import { chartCompositeMaterialModuleId } from "../src/gpu/display-view-composite-material-module.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import type { CompositeArithmetic } from "./helpers/fake-webgpu-composite.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, materialModuleOf, materialModulesOf, renderOnGpu, renderOnGpuQuality, runtimeOf,
  type DisplayViewAgreement } from "./helpers/display-view-gpu-fixture.js";
import { acceptanceOf } from "./helpers/display-view-acceptance-metrics.js";
import { FIXTURE_ASPECT, layeredScene } from "./helpers/chart-composite-fixtures.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
const output = { ...SMALL_FRAME, format: "srgb-8" as const };
const lens = { prime: 50 as const, fNumber: 8 };
const declared = layeredScene(FIXTURE_ASPECT);
const placed = { chartSize: { widthM: 0.042 }, subjectDistanceM: 0.63 };
/** A 48 × 36 region of the 203 × 135 view at column x, row y. */
const at = (x: number, y: number): { x: number; y: number; width: number; height: number } => ({ x, y, width: 48, height: 36 });
/** The #491 Speed cases (test/display-view-composite-gpu.test.ts) with their flagged-fraction ceilings and, for a frame-filling chart, the region rendered. */
const cases: [string, SimulateCaptureOptions, number, ReturnType<typeof at> | null][] = [
  ["composite under the label layer (material-layers), frame-filling", { scene: declared, lens, sensor, output }, 0.06, at(78, 50)],
  ["composite under the label layer (material-layers), fixed-size chart with surround", { scene: declared, lens, sensor, output, ...placed }, 0.06, null],
  ["composite under the label layer (material-layers), Reinhard at the white clip", { scene: declared, lens, sensor, output: { ...output, toneCurve: "positive-reinhard-per-channel" },
    exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 } }, 0.06, at(20, 12)],
  ["zone plate (2.3 element as a plain chart)", { scene: { preset: "zone-plate", maximumCyclesPerPictureHeight: 200 }, lens, sensor, output }, 0.3, at(120, 40)],
  ["Siemens star (sine, 64 cycles)", { scene: { preset: "siemens-star", profile: "sine", cycles: 64 }, lens, sensor, output }, 0.05, at(78, 50)],
  ["dead leaves", { scene: { preset: "dead-leaves", seed: 491 }, lens, sensor, output }, 0.05, at(30, 80)],
  ["bar groups with numerals", { scene: { preset: "bar-groups", numerals: true }, lens, sensor, output }, 0.05, at(100, 30)],
  ["checkerboard, fixed-size chart with surround", { scene: { preset: "checkerboard", squaresAcross: 12 }, lens, sensor, output, ...placed }, 0.05, null]
];
const UNFUSED: [string, CompositeArithmetic] = ["unfused", { kind: "nearest" }];
const CONTRACTIONS: [string, CompositeArithmetic][] = [
  ["fused contraction (first product operand)", { kind: "fused-contraction", choose: "first" }],
  ["fused contraction (random per site, seed 7)", { kind: "fused-contraction", choose: { seed: 7 } }]
];

const report: Record<string, unknown>[] = [];
afterAll(() => {
  if (!report.length) return;
  console.info(`[display-view-composite-contraction] ${JSON.stringify(report)}`);
  if (process.env.PHOTIVRA_REPORT_FILE) writeFileSync(process.env.PHOTIVRA_REPORT_FILE, JSON.stringify(report, null, 1));
});
function row(a: DisplayViewAgreement, flagged: number): Record<string, unknown> {
  return { flagged, flaggedFraction: flagged / a.pixels, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaRelativeMaximum: a.sigmaRelativeMaximum,
    differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference, largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio };
}

describe("display view with the composite material module under fused contraction (float32 emulation, 2.11.0)", () => {
  it.each(cases)("%s (Speed): the fma path under contraction renders inside the bounds and the #480 thresholds", async (name, options, ceiling, region) => {
    const fixture = await displayViewGpuFixture(options, region ? { ...SMALL_VIEW, region } : SMALL_VIEW), rows: Record<string, unknown> = {};
    const width = region?.width ?? fixture.viewWidth, height = region?.height ?? fixture.viewHeight;
    // The flagged-fraction ceilings are of the whole view (asserted unfused in test/display-view-composite-gpu.test.ts); a region's
    // fraction depends on what it shows, so there the contracted render may flag no more pixels than the unfused render of the region.
    let flaggedCeiling = ceiling;
    if (region) {
      const runtime = await runtimeOf(createFakeGpu({ compositeArithmetic: UNFUSED[1] }).gpu), gpu = await renderOnGpu(runtime, fixture);
      flaggedCeiling = gpu.flaggedPixelIndices.length / (width * height);
      rows[UNFUSED[0]] = { flagged: gpu.flaggedPixelIndices.length, flaggedFraction: flaggedCeiling };
      runtime.destroy();
    }
    for (const [model, arithmetic] of CONTRACTIONS) {
      const runtime = await runtimeOf(createFakeGpu({ compositeArithmetic: arithmetic }).gpu), module = await materialModuleOf(runtime, fixture.input.setup);
      expect(module.id).toBe(chartCompositeMaterialModuleId("fma"));
      expect(module.compositeProbe).toMatchObject({ productPath: "fma", deviceClass: "contracted" });
      const gpu = await renderOnGpu(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu), { metrics, verdict } = acceptanceOf(width, height, fixture.cpu, gpu);
      rows[model] = { ...row(a, gpu.flaggedPixelIndices.length), acceptance: { withinFraction: metrics.withinFraction, maxDeltaE: metrics.maxDeltaE, maxSigma: metrics.maxSigma, pass: verdict.pass } };
      expect(a.outsideExpectedBound).toBe(0);
      expect(a.outsideVarianceBound).toBe(0);
      expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
      expect(a.deltaEMaximum).toBeLessThan(0.01);
      expect(a.sigmaUnitsMaximum).toBeLessThan(0.01);
      expect(verdict.pass, JSON.stringify(verdict.checks)).toBe(true);
      expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
      for (const i of gpu.flaggedPixelIndices) for (let c = 0; c < 3; c++) expect(gpu.expected[3 * i + c]).toBe(fixture.cpu.expected[3 * i + c]);
      expect(gpu.flaggedPixelIndices.length / a.pixels).toBeLessThanOrEqual(flaggedCeiling);
      runtime.destroy();
    }
    report.push({ case: name + " (Speed)", ...(region ? { region } : {}), pixels: width * height, ...rows });
  }, scaledTimeout(900_000));

  it("material-layers (Quality: diffraction, four-spot, AHD; and a fixed-size chart): the fma path under contraction stays inside the bounds", async () => {
    const qsensor = { ...sensor, antiAliasing: { kind: "four-spot" as const } }, qoutput = { ...output, demosaic: "ahd" as const }, region = { x: 50, y: 70, width: 48, height: 36 };
    const variants: [string, SimulateCaptureOptions][] = [
      ["material-layers, frame-filling, diffraction + four-spot + AHD", { scene: declared, lens: { ...lens, diffraction: "circular-aperture" }, sensor: qsensor, output: qoutput }],
      ["material-layers, fixed-size chart with surround, AHD without diffraction", { scene: declared, lens, sensor: qsensor, output: qoutput, ...placed }]
    ];
    for (const [name, options] of variants) {
      const fixture = await displayViewGpuFixture(options, { ...SMALL_VIEW, region }), rows: Record<string, unknown> = {};
      for (const [model, arithmetic] of [UNFUSED, CONTRACTIONS[0]!]) {
        const runtime = await runtimeOf(createFakeGpu({ compositeArithmetic: arithmetic }).gpu);
        const module = await qualityMaterialModule(materialModulesOf(runtime), fixture.input.setup.gpu!, new AbortController().signal);
        expect(module.id).toBe(chartCompositeMaterialModuleId(arithmetic.kind === "nearest" ? "dekker" : "fma"));
        const gpu = await renderOnGpuQuality(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
        rows[model] = row(a, gpu.flaggedPixelIndices.length);
        expect(a.outsideExpectedBound).toBe(0);
        expect(a.outsideVarianceBound).toBe(0);
        expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
        expect(a.deltaEMaximum).toBeLessThan(0.01);
        expect(a.sigmaUnitsMaximum).toBeLessThan(0.01);
        for (const i of gpu.flaggedPixelIndices) for (let c = 0; c < 3; c++) expect(gpu.expected[3 * i + c]).toBe(fixture.cpu.expected[3 * i + c]);
        runtime.destroy();
      }
      report.push({ case: name + " (Quality, 48 × 36 region)", ...rows });
    }
  }, scaledTimeout(900_000));

  it("through prepareDisplayView: the probe record is in diagnostics.fast.execution; a contracted device renders with the fma path, one with an unfused fma falls back (\"auto\") or fails (\"require\") saying why", async () => {
    const previous = registerDisplayViewGpuRenderer(), options = cases[1]![1];
    try {
      const exact = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      expect((await exact.render(SMALL_VIEW)).diagnostics.fast.execution.compositeProbe).toMatchObject({ deviceClass: "exact", productPath: "dekker", fmaFused: true });
      exact.dispose();
      const contracted = await prepareDisplayView(options, { gpu: "require", gpuDevice: createFakeGpu({ compositeArithmetic: CONTRACTIONS[0]![1] }).gpu });
      const execution = (await contracted.render(SMALL_VIEW)).diagnostics.fast.execution;
      expect(execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, compositeProbe: { deviceClass: "contracted", productPath: "fma", fmaFused: true } });
      expect(execution.compositeProbe!.mismatchCounts["double-word-multiply"]).toBeGreaterThan(0);
      contracted.dispose();
      const unfusedFma: CompositeArithmetic = { kind: "fused-contraction", choose: "first", fma: "unfused" };
      const fallback = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu({ compositeArithmetic: unfusedFma }).gpu });
      const fell = (await fallback.render(SMALL_VIEW)).diagnostics.fast.execution;
      expect(fell).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend", compositeProbe: { deviceClass: "contracted", productPath: null, fmaFused: false } });
      expect(fell.limitations.join(" ")).toMatch(/class contracted, product path none, fma not fused/u);
      fallback.dispose();
      const required = await prepareDisplayView(options, { gpu: "require", gpuDevice: createFakeGpu({ compositeArithmetic: { kind: "reassociation" } }).gpu });
      const error = await required.render(SMALL_VIEW).then(() => null, (e: unknown) => e) as { reason?: string; message?: string; probe?: unknown };
      expect(error).toMatchObject({ reason: "unsupported-on-backend", probe: { deviceClass: "reassociated", productPath: null } });
      expect(error.message).toMatch(/class reassociated/u);
      required.dispose();
      // A 2.0 preset filling the frame never runs the probe.
      const preset = await prepareDisplayView({ scene: { preset: "checkerboard", squaresAcross: 12 }, lens, sensor, output }, { gpu: "require", gpuDevice: createFakeGpu({ compositeArithmetic: unfusedFma }).gpu });
      expect((await preset.render(SMALL_VIEW)).diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", compositeProbe: null });
      preset.dispose();
      const off = await prepareDisplayView(options);
      expect((await off.render(SMALL_VIEW)).diagnostics.fast.execution.compositeProbe).toBeNull();
      off.dispose();
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(600_000));
});
