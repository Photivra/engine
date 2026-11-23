// SPDX-License-Identifier: Apache-2.0
/**
 * The composite-chart and mask-layer material module of the GPU display view (#491) on the float32 emulation of the Speed
 * kernel and of the composite kernel's classification (test/helpers/fake-webgpu-display-view.ts, fake-webgpu-composite.ts):
 * the app's scene shape (one composite element of every kind under a label layer, as a declared `material-layers` scene,
 * frame-filling and as a fixed-size chart with its surround) against the CPU reference per pixel, inside the a-priori
 * bounds, in ΔE2000 and noise-σ units, the flagged fraction per element, the #480 acceptance thresholds; the lattice
 * recovery of the exact query point; the device probe gating the module while the preset module keeps serving the 2.0
 * presets; `prepareDisplayView({ gpu: "auto" })` on the declared scene, and `gpu: "off"` byte-identical to the caller-scene
 * form. Real-device conformance: test/webgpu/display-view.webgpu.ts.
 */
import { describe, expect, it } from "vitest";
import { ImageKernelExecutionError, prepareDisplayView, resolveChartMaterialLayers, resolveChartScene, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { chartGeometry } from "../src/facade/chart-scenes.js";
import type { DisplayViewExpectedSignalInput } from "../src/facade/expected-signal.js";
import { setDisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.js";
import { registerDisplayViewSpeedGpuRenderer, displayViewSpeedGpuSupports } from "../src/gpu/display-view-speed-gpu.js";
import { CHART_COMPOSITE_MATERIAL_MODULE_ID, chartCompositeMaterialWgsl, displayViewLatticeConstants, DISPLAY_VIEW_LATTICE } from "../src/gpu/display-view-composite-material-module.js";
import { assembleDisplayViewSpeedWgsl } from "../src/gpu/wgsl-display-view-speed-kernel.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { createCompositeDisplayViewMaterialEmulator, createCompositeMaterialEmulator, setCompositeProbeCorruption } from "./helpers/fake-webgpu-composite.js";
import { packChartScene } from "../src/gpu/chart-composite-gpu.js";
import type { ChartRadianceBatchPlan } from "../src/facade/chart-radiance-batch.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, materialModuleOf, materialModulesOf, renderOnGpu, runtimeOf, type DisplayViewGpuFixture } from "./helpers/display-view-gpu-fixture.js";
import { acceptanceOf } from "./helpers/display-view-acceptance-metrics.js";
import { allElementsComposite, COMPOSITE_ELEMENTS, elementRect, FIXTURE_ASPECT, labelLayer, layeredScene } from "./helpers/chart-composite-fixtures.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { wgslCount, wgslIncludes } from "./helpers/wgsl-text.js";

const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
const output = { ...SMALL_FRAME, format: "srgb-8" as const };
const lens = { prime: 50 as const, fNumber: 8 };
/** The app's scene shape at the small frame: every composite element under the label layer, declared as material-layers (aspect 2/3). */
const declared = layeredScene(FIXTURE_ASPECT);
/** The same scene as the app passes it today: the resolved scene's callerScene (a material function). */
const callerForm = resolveChartMaterialLayers({ scene: declared, aspect: FIXTURE_ASPECT }).callerScene;
/** The app's request shape (scripts/lib/display-view-app-request.mjs) scaled to the small frame: a fixed-size chart at 0.63 m (the 3.6 mm imaging area frames 45 mm). */
const placed = { chartSize: { widthM: 0.042 }, subjectDistanceM: 0.63 };
/**
 * The cases, each with the ceiling on the flagged fraction of display pixels (a display pixel is flagged when any of its ~36
 * query points is uncertain, so the 1024-level elements, whose points flag at about 0.5 % each as #477 measured, flag about a
 * fifth of their display pixels: a cost, one CPU pixel each, never an error) and on the relative difference of the noise σ
 * (larger where the clips leave a tiny variance, while inside the a-priori bound).
 */
const cases: [string, SimulateCaptureOptions, { flagged: number; sigmaRelative: number }][] = [
  ["composite under the label layer (material-layers), frame-filling", { scene: declared, lens, sensor, output }, { flagged: 0.06, sigmaRelative: 0.01 }],
  ["composite under the label layer (material-layers), fixed-size chart with surround", { scene: declared, lens, sensor, output, ...placed }, { flagged: 0.06, sigmaRelative: 0.01 }],
  ["composite under the label layer (material-layers), Reinhard at the white clip", { scene: declared, lens, sensor, output: { ...output, toneCurve: "positive-reinhard-per-channel" },
    exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 } }, { flagged: 0.06, sigmaRelative: 0.02 }],
  ["zone plate (2.3 element as a plain chart)", { scene: { preset: "zone-plate", maximumCyclesPerPictureHeight: 200 }, lens, sensor, output }, { flagged: 0.3, sigmaRelative: 0.01 }],
  ["Siemens star (sine, 64 cycles)", { scene: { preset: "siemens-star", profile: "sine", cycles: 64 }, lens, sensor, output }, { flagged: 0.05, sigmaRelative: 0.01 }],
  ["dead leaves", { scene: { preset: "dead-leaves", seed: 491 }, lens, sensor, output }, { flagged: 0.05, sigmaRelative: 0.01 }],
  ["bar groups with numerals", { scene: { preset: "bar-groups", numerals: true }, lens, sensor, output }, { flagged: 0.05, sigmaRelative: 0.01 }],
  ["checkerboard, fixed-size chart with surround (a 2.0 preset through the composite module)", { scene: { preset: "checkerboard", squaresAcross: 12 }, lens, sensor, output, ...placed }, { flagged: 0.05, sigmaRelative: 0.01 }]
];
/**
 * Per element of the composite fixture, the ceiling on the flagged fraction of its display pixels: the 1024-level elements above
 * (the zone plate at 347 cycles per picture height on a 97-site element is aliased, so its ~100 query points per display pixel
 * flag independently); the label layer, whose glyph coordinates (integers and thirds of the 320 × 80 mask) the frame-filling
 * query lattice of this frame meets exactly every 33rd row (the winding test flags a point on an edge's level, see the finding
 * in docs/WEBGPU.md); the bar star, whose diagonals the lattice meets exactly (points on a sector boundary are flagged by design).
 */
const ELEMENT_FLAGGED_CEILING: Record<string, number> = { "grey-ramp": 0.25, "zone-plate": 0.7, "label layer": 0.6, "siemens-star-bar": 0.15 };

const report: Record<string, unknown>[] = [];

/** Which fixture element (or the label layer, or the background) owns a display pixel, by its centre in frame units. */
function ownerOf(viewWidth: number, viewHeight: number): (index: number) => string {
  const g = chartGeometry(resolveChartScene({ scene: allElementsComposite(), aspect: FIXTURE_ASPECT })), label = labelLayer(FIXTURE_ASPECT).rectangle;
  if (g.kind !== "composite") throw new Error("composite expected");
  return (index: number): string => {
    const rx = index % viewWidth, ry = Math.floor(index / viewWidth), u = -1 + (rx + 0.5) * 2 / viewWidth, v = FIXTURE_ASPECT - (ry + 0.5) * 2 * FIXTURE_ASPECT / viewHeight;
    if (u >= label.u0 && u <= label.u1 && v >= label.v0 && v <= label.v1) return "label layer";
    for (let i = g.elements.length - 1; i >= 0; i--) {
      const e = g.elements[i]!, du = u - e.cu, dv = v - e.cv;
      if (du < -e.hw || du > e.hw || dv < -e.hh || dv > e.hh) continue;
      if (e.ellipse && (du / e.hw) ** 2 + (dv / e.hh) ** 2 > 1) continue;
      return COMPOSITE_ELEMENTS[i]![0];
    }
    return "background (line grid)";
  };
}
/** Flagged display pixels per owner, as a fraction of the owner's pixels. */
function flaggedByOwner(fixture: DisplayViewGpuFixture, flagged: Uint32Array): Record<string, { pixels: number; flagged: number; fraction: number }> {
  const owner = ownerOf(fixture.viewWidth, fixture.viewHeight), rows: Record<string, { pixels: number; flagged: number; fraction: number }> = {};
  for (let i = 0; i < fixture.viewWidth * fixture.viewHeight; i++) { const o = owner(i); (rows[o] ??= { pixels: 0, flagged: 0, fraction: 0 }).pixels++; }
  for (const i of flagged) rows[owner(i)]!.flagged++;
  for (const row of Object.values(rows)) row.fraction = row.flagged / row.pixels;
  return rows;
}

describe("display view Speed kernel with the composite material module (float32 emulation) vs the CPU reference (#491)", () => {
  it.each(cases)("%s: inside the a-priori bounds, samples within one code, the #480 thresholds met", async (name, options, ceiling) => {
    const fixture = await displayViewGpuFixture(options, SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const module = await materialModuleOf(runtime, fixture.input.setup);
    expect(module.id).toBe(CHART_COMPOSITE_MATERIAL_MODULE_ID);
    const gpu = await renderOnGpu(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
    const { metrics, verdict } = acceptanceOf(fixture.viewWidth, fixture.viewHeight, fixture.cpu, gpu);
    const byOwner = options.scene === declared ? flaggedByOwner(fixture, gpu.flaggedPixelIndices) : undefined;
    report.push({ case: name, pixels: a.pixels, flagged: gpu.flaggedPixelIndices.length, flaggedFraction: gpu.flaggedPixelIndices.length / a.pixels, recomputed: gpu.hostRecomputedPixelIndices.length,
      deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaUnitsRms: a.sigmaUnitsRms, sigmaRelativeMaximum: a.sigmaRelativeMaximum,
      differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference, largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio,
      acceptance: { withinFraction: metrics.withinFraction, maxDeltaE: metrics.maxDeltaE, meanDeltaE: metrics.meanDeltaE, maxSigma: metrics.maxSigma, maxCode8: metrics.maxCode8, identicalFraction: metrics.identicalFraction, pass: verdict.pass },
      ...(byOwner ? { flaggedByElement: byOwner } : {}) });
    expect(gpu.estimation).toBe("exact-area-mean");
    expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32", bitIdenticalToReference: false, fast: true, diagnosticsExact: true });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.differingSamples).toBeLessThanOrEqual(0.01 * a.pixels * 3);
    expect(a.deltaEMaximum).toBeLessThan(0.01);
    expect(a.sigmaUnitsMaximum).toBeLessThan(0.01);
    expect(a.sigmaRelativeMaximum).toBeLessThan(ceiling.sigmaRelative);
    expect(verdict.pass, JSON.stringify(verdict.checks)).toBe(true);
    // Flagged display pixels are recomputed with the reference and equal it exactly.
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    for (const i of gpu.flaggedPixelIndices) for (let c = 0; c < 3; c++) {
      expect(gpu.samples[3 * i + c]).toBe(fixture.cpu.samples[3 * i + c]);
      expect(gpu.expected[3 * i + c]).toBe(fixture.cpu.expected[3 * i + c]);
    }
    // The flagged fraction of display pixels (see the cases): each flagged pixel costs one CPU pixel.
    expect(gpu.flaggedPixelIndices.length / a.pixels).toBeLessThanOrEqual(ceiling.flagged);
    if (byOwner) for (const [owner, row] of Object.entries(byOwner)) expect(row.fraction, owner + ": flagged display pixels above the element's ceiling is a finding").toBeLessThanOrEqual(ELEMENT_FLAGGED_CEILING[owner] ?? 0.1);
    runtime.destroy();
  }, scaledTimeout(300_000));

  it("the scene records are uploaded once per renderer and reused across a view's parts; release frees them", async () => {
    const fixture = await displayViewGpuFixture(cases[0]![1], SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu), modules = materialModulesOf(runtime);
    const whole = await renderOnGpu(runtime, fixture);
    expect(modules.uploadedScenes).toBe(1);
    const region = { x: 60, y: 90, width: 20, height: 16 };
    const part = await displayViewGpuFixture(cases[0]![1], { ...SMALL_VIEW, region }), partGpu = await renderOnGpu(runtime, { ...part, input: { ...part.input, setup: { ...part.input.setup, gpu: fixture.input.setup.gpu! } } });
    expect(modules.uploadedScenes).toBe(1);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let c = 0; c < 3; c++) {
      const o = ((region.y + y) * SMALL_VIEW.width + region.x + x) * 3 + c, p = (y * region.width + x) * 3 + c;
      expect(partGpu.samples[p]).toBe(whole.samples[o]);
      expect(partGpu.expected[p]).toBe(whole.expected[o]);
    }
    // A second prepared scene is uploaded on its own; banding never changes a byte.
    await renderOnGpu(runtime, part);
    expect(modules.uploadedScenes).toBe(2);
    const banded = await renderOnGpu(runtime, fixture, 4096);
    expect(banded.samples).toEqual(whole.samples);
    expect(banded.expected).toEqual(whole.expected);
    modules.release();
    expect(modules.uploadedScenes).toBe(0);
    runtime.destroy();
  }, scaledTimeout(300_000));

  it("the device probe gates the module: a reassociating device refuses composite scenes with unsupported-on-backend, the preset module still serves the 2.0 presets, and the probe is retried", async () => {
    const composite = await displayViewGpuFixture(cases[3]![1], SMALL_VIEW), preset = await displayViewGpuFixture({ scene: { preset: "step-wedge", steps: 11 }, lens, sensor, output }, SMALL_VIEW);
    const runtime = await runtimeOf(createFakeGpu().gpu);
    setCompositeProbeCorruption(true);
    try {
      await expect(renderOnGpu(runtime, composite)).rejects.toMatchObject({ reason: "unsupported-on-backend" });
      const presetModule = await materialModuleOf(runtime, preset.input.setup);
      expect(presetModule.id).toBe("chart-preset:step-wedge");
      const gpu = await renderOnGpu(runtime, preset), a = compareDisplayViews(preset.cpu, gpu);
      expect(a.outsideExpectedBound + a.outsideVarianceBound).toBe(0);
    } finally { setCompositeProbeCorruption(false); }
    const retried = await renderOnGpu(runtime, composite);
    expect(retried.execution.backend).toBe("webgpu-f32");
    runtime.destroy();
  }, scaledTimeout(120_000));

  it("through prepareDisplayView: the declared scene renders on the GPU with gpu \"auto\" and is labelled; a failed probe falls back labelled, or fails with \"require\"; gpu \"off\" is byte-identical to the caller-scene form", async () => {
    const previous = registerDisplayViewSpeedGpuRenderer();
    try {
      const options = cases[1]![1], gpu = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu }), cpu = await prepareDisplayView(options);
      try {
        const view = await gpu.render(SMALL_VIEW), reference = await cpu.render(SMALL_VIEW), execution = view.diagnostics.fast.execution;
        expect(execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, arithmetic: "float32" });
        expect(execution.conformance).toMatchObject({ passed: true });
        expect(view.assumptions.some((a) => a.id === "view.execution")).toBe(true);
        let differing = 0;
        for (let i = 0; i < reference.image.samples.length; i++) { const d = Math.abs(view.image.samples[i]! - reference.image.samples[i]!); expect(d).toBeLessThanOrEqual(1); if (d) differing++; }
        expect(differing).toBeLessThanOrEqual(0.01 * reference.image.samples.length);
        // The same request as the app passes it today (the resolved scene's callerScene) is the same CPU render, byte for byte.
        const caller = await simulateDisplayView({ ...options, scene: callerForm }, SMALL_VIEW);
        expect(caller.image.samples).toEqual(reference.image.samples);
        expect(caller.scene.sceneId).toBe(reference.scene.sceneId);
        expect(caller.diagnostics.fast.execution.backend).toBe("cpu-reference");
      } finally { gpu.dispose(); cpu.dispose(); }
      setCompositeProbeCorruption(true);
      try {
        const fallback = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
        const view = await fallback.render(SMALL_VIEW);
        expect(view.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
        expect(view.diagnostics.fast.execution.limitations.join(" ")).toMatch(/double-float32/u);
        fallback.dispose();
        const required = await prepareDisplayView(options, { gpu: "require", gpuDevice: createFakeGpu().gpu });
        await expect(required.render(SMALL_VIEW)).rejects.toMatchObject({ reason: "unsupported-on-backend" });
        required.dispose();
        // The 2.0 presets keep rendering on the GPU on that device.
        const presets = await prepareDisplayView({ scene: { preset: "checkerboard", squaresAcross: 12 }, lens, sensor, output }, { gpu: "require", gpuDevice: createFakeGpu().gpu });
        expect((await presets.render(SMALL_VIEW)).diagnostics.fast.execution.backend).toBe("webgpu-f32");
        presets.dispose();
      } finally { setCompositeProbeCorruption(false); }
      // A caller scene function is still refused by supports().
      const refused = await prepareDisplayView({ ...options, scene: callerForm }, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      expect((await refused.render(SMALL_VIEW)).diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
      refused.dispose();
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(300_000));

  it("supports() accepts charts and material-layers scenes and refuses caller functions", () => {
    const base = { ahd: false, diffraction: false, antiAliasing: false, boxSamples: 2, toneCurve: "identity" as const };
    expect(displayViewSpeedGpuSupports({ ...base, scene: "chart" })).toBe(true);
    expect(displayViewSpeedGpuSupports({ ...base, scene: "material-layers" })).toBe(true);
    expect(displayViewSpeedGpuSupports({ ...base, scene: "material-function" })).toMatch(/material-layers/u);
    expect(displayViewSpeedGpuSupports({ ...base, scene: "radiance-function" })).toMatch(/caller/u);
  });

  it("the lattice constants: the 2 × 2 box lattice is recovered (scale, offsets as hi + lo, tolerance), and offsets too close modulo one site are refused", async () => {
    const fixture = await displayViewGpuFixture(cases[0]![1], SMALL_VIEW), signalInput = fixture.input.signalInput;
    const lattice = displayViewLatticeConstants(signalInput, null, 7), words = new Uint32Array(lattice.params), floats = new Float32Array(lattice.params);
    expect(words[DISPLAY_VIEW_LATTICE.offsets]).toBe(4);
    expect(words[DISPLAY_VIEW_LATTICE.placed]).toBe(0);
    expect(words[DISPLAY_VIEW_LATTICE.surround]).toBe(7);
    expect(floats[DISPLAY_VIEW_LATTICE.scaleUHi]).toBe(Math.fround(lattice.scaleU));
    expect(lattice.scaleU).toBeCloseTo(2 / SMALL_FRAME.width, 12);
    expect(lattice.scaleV).toBeCloseTo(-2 / SMALL_FRAME.width, 12);
    for (let o = 0; o < 4; o++) {
      const cu = 0.5 + signalInput.offsets[o]!.x - signalInput.nativeWidth / 2;
      expect(lattice.offsets[4 * o]! + lattice.offsets[4 * o + 1]!).toBe(cu);
      expect(lattice.offsets[4 * o]).toBe(Math.fround(cu));
    }
    // 8E·max|x + c| + 2^-12 for the 604-site frame: well under the quarter-site separation of the box lattice.
    expect(lattice.tolerance).toBeLessThan(0.002);
    expect(lattice.tolerance).toBeGreaterThan(2 ** -12);
    const placed = displayViewLatticeConstants(signalInput, { chartUnitsPerFrameUnit: 1.25, aspect: 2 / 3 }, 7), placedFloats = new Float32Array(placed.params);
    expect(new Uint32Array(placed.params)[DISPLAY_VIEW_LATTICE.placed]).toBe(1);
    expect(placedFloats[DISPLAY_VIEW_LATTICE.chartKHi]).toBe(1.25);
    expect(placedFloats[DISPLAY_VIEW_LATTICE.chartAspect]).toBe(Math.fround(2 / 3));
    // A lattice with other offsets (its query points formed as the reference forms them, (x + 0.5 + o − W/2)·g).
    const W = signalInput.nativeWidth, H = signalInput.nativeHeight, g = 2 / SMALL_FRAME.width;
    const withOffsets = (offsets: { x: number; y: number; weight: number }[]): DisplayViewExpectedSignalInput => ({ ...signalInput, offsets,
      queryPoint: (x, y, o, out): void => { out[0] = (x + 0.5 + offsets[o]!.x - W / 2) * g; out[1] = -(y + 0.5 + offsets[o]!.y - H / 2) * g; } });
    // Two offsets a hair apart (mod one site) cannot be told apart on the device: refused, not misclassified.
    const close = withOffsets([{ x: -0.25, y: -0.25, weight: 0.5 }, { x: -0.25 + 1e-6, y: 0.25, weight: 0.5 }]);
    expect(() => displayViewLatticeConstants(close, null, 7)).toThrow(ImageKernelExecutionError);
    expect(() => displayViewLatticeConstants(close, null, 7)).toThrow(/too close/u);
    // Offsets an exact site apart share a lattice and are fine; so are the centre-sampling lattice and the 3 × 3 box (thirds, not representable in float32: hi + lo).
    expect(displayViewLatticeConstants(withOffsets([{ x: -0.25, y: -0.25, weight: 0.5 }, { x: 0.75, y: 0.25, weight: 0.5 }]), null, 7).tolerance).toBeCloseTo(lattice.tolerance, 6);
    expect(new Uint32Array(displayViewLatticeConstants(withOffsets([{ x: 0, y: 0, weight: 1 }]), null, 7).params)[DISPLAY_VIEW_LATTICE.offsets]).toBe(1);
    const thirds = displayViewLatticeConstants(withOffsets([-1 / 3, 0, 1 / 3].flatMap((y) => [-1 / 3, 0, 1 / 3].map((x) => ({ x, y, weight: 1 / 9 })))), null, 7);
    expect(thirds.offsets[1]).not.toBe(0);
    expect(thirds.offsets[0]! + thirds.offsets[1]!).toBeCloseTo(0.5 - 1 / 3 - W / 2, 10);
    // A query function that is not a site lattice is refused.
    const skewed: DisplayViewExpectedSignalInput = { ...signalInput, queryPoint: (x, y, o, out): void => { signalInput.queryPoint!(x, y, o, out); out[0] = out[0]! * (1 + 1e-9 * y); } };
    expect(() => displayViewLatticeConstants(skewed, null, 7)).toThrow(/rectilinear/u);
  }, scaledTimeout(120_000));

  it("the recovered lattice point classifies as the reference's float64 point does: every unflagged material is the reference's, and the flags are the composite kernel's own", async () => {
    // The module on the kernel's float32 points, p = fl(fl(x + c)·scale) as the Speed kernel forms them, against the float64 reference and
    // against the composite kernel on the reference's own query points split hi + lo (the composite kernel's input form): for every site and
    // offset in the label layer, the zone plate and the bar star of the frame-filling fixture, and on a stride over the whole frame. The two
    // points differ by about 2^-46 relative, so at a point within its margin of a boundary both flag (the material may then differ: both are
    // recomputed), and the flag itself can differ only where that difference crosses the margin, which is counted.
    const fixture = await displayViewGpuFixture(cases[0]![1], SMALL_VIEW), gpu = fixture.input.setup.gpu!, layers = gpu.layers!, signalInput = fixture.input.signalInput;
    const packed = packChartScene({ chart: layers.chart, layers, materials: layers.materials } as unknown as ChartRadianceBatchPlan);
    const reference = createCompositeMaterialEmulator(packed.af, packed.ai), lattice = displayViewLatticeConstants(signalInput, null, layers.materials.length);
    const module = createCompositeDisplayViewMaterialEmulator(new Uint32Array(lattice.params), new Float32Array(lattice.params), lattice.offsets, packed.af, packed.ai);
    const scaleU = Math.fround(lattice.scaleU), scaleV = Math.fround(lattice.scaleV), f = Math.fround, point = new Float64Array(2);
    const rects = [labelLayer(FIXTURE_ASPECT).rectangle, ...["zone-plate", "siemens-star-bar"].map((n) => elementRect(COMPOSITE_ELEMENTS.find(([name]) => name === n)![1]))];
    let points = 0, flagged = 0, flagDifferences = 0;
    for (let y = 0; y < signalInput.nativeHeight; y++) for (let x = 0; x < signalInput.nativeWidth; x++) for (let o = 0; o < signalInput.offsets.length; o++) {
      signalInput.queryPoint!(x, y, o, point);
      const u = point[0]!, v = point[1]!;
      if (!(rects.some((r) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1) || (x % 7 === 0 && y % 5 === 0))) continue;
      points++;
      reference.reset();
      const want = reference.material(f(u), f(u - f(u)), f(v), f(v - f(v))), wantFlag = reference.flagged;
      // The kernel's point: the exact float32 sum (the quarter-site offsets are representable) times the scale rounded once.
      const pu = f(f(x + lattice.offsets[4 * o]!) * scaleU), pv = f(f(y + lattice.offsets[4 * o + 2]!) * scaleV);
      module.reset();
      const got = module.material(pu, pv), gotFlag = module.flagged;
      const truth = layers.materialAt(u, v);
      if (!gotFlag && got !== truth) expect.fail(`site (${x}, ${y}) offset ${o}: unflagged material ${got} against the reference's ${truth}`);
      if (!wantFlag && want !== truth) expect.fail(`site (${x}, ${y}) offset ${o}: the composite kernel's unflagged material ${want} against the reference's ${truth}`);
      if (gotFlag !== wantFlag) flagDifferences++;
      else if (!gotFlag && got !== want) expect.fail(`site (${x}, ${y}) offset ${o}: material ${got} against the composite kernel's ${want}`);
      if (gotFlag) flagged++;
    }
    expect(points).toBeGreaterThan(100_000);
    expect(flagDifferences).toBeLessThanOrEqual(2);
    report.push({ check: "recovered lattice point vs the reference point", points, flagged, flaggedFraction: flagged / points, flagDifferences });
  }, scaledTimeout(120_000));

  it("the module's WGSL: the composite kernel's classification renamed, its records at group 1, one definition of each shared constant", () => {
    const wgsl = chartCompositeMaterialWgsl(), shader = assembleDisplayViewSpeedWgsl(wgsl);
    expect(wgslIncludes(wgsl, "fn material_at(p: vec2<f32>) -> u32")).toBe(true);
    expect(wgslIncludes(wgsl, "var<private> material_uncertain: bool;")).toBe(true);
    expect(wgslIncludes(wgsl, "@group(1) @binding(0) var<storage, read> af: array<f32>;")).toBe(true);
    expect(wgslIncludes(wgsl, "@group(1) @binding(1) var<storage, read> ai: array<u32>;")).toBe(true);
    expect(wgslIncludes(wgsl, "fn material(p: vec4<f32>) -> u32")).toBe(true);
    expect(wgslIncludes(wgsl, "fn bmargin(x: B) -> f32")).toBe(true);
    expect(wgsl).not.toMatch(/\bflagged\b|@group\(0\)|struct Params|\bparams\.|\bmargin\(|@compute/u);
    expect(wgslCount(shader, "const E: f32")).toBe(1);
    expect(wgslCount(shader, "const SLACK: f32")).toBe(1);
    expect(wgslCount(shader, "const SAFETY: f32 = 4.0;")).toBe(1);
  });

  it("reports the measured agreement", () => {
    process.stdout.write("[display-view composite gpu emulation] " + JSON.stringify(report, null, 1) + "\n");
  });
});
