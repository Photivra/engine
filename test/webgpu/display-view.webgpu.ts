// SPDX-License-Identifier: Apache-2.0
/**
 * Real-GPU conformance of the display view's Speed kernel (#478) and Quality kernels (#479) against the float64 CPU reference
 * (`npm run test:webgpu`): the small chart-preset fixtures of test/display-view-speed-gpu.test.ts and
 * test/display-view-quality-gpu.test.ts, every component inside the result's a-priori bounds, the agreement reported in ΔE2000
 * and noise-σ units, banding and regions, and the renderers' self-check cases; (#491) the composite material module on the app's
 * scene shape (every composite element under a label layer as a declared material-layers scene, frame-filling and as a fixed-size
 * chart) and on 2.3 elements as plain charts, with the flagged fraction per element and the #480 acceptance thresholds
 * (test/display-view-composite-gpu.test.ts on the emulation); and the Quality kernels on a material-layers scene. Skips with a
 * message when no browser or adapter is available, unless PHOTIVRA_WEBGPU_REQUIRED=1. Timings from a software adapter
 * (SwiftShader) are not GPU performance and none are asserted; the Quality cases report the per-stage wall-clock times for the record.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { ImageKernelExecution, SimulateCaptureOptions } from "../../src/index.js";
import { simulateDisplayViewWithInternals } from "../../src/facade/simulate-display-view.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews, type ComparableGpuResult } from "../helpers/display-view-gpu-fixture.js";
import { acceptanceOf } from "../helpers/display-view-acceptance-metrics.js";
import { allElementsComposite, COMPOSITE_ELEMENTS, FIXTURE_ASPECT, labelLayer, layeredScene } from "../helpers/chart-composite-fixtures.js";
import { chartGeometry } from "../../src/facade/chart-scenes.js";
import { resolveChartScene } from "../../src/index.js";
import { DEFOCUS_GPU_EXTRA, DEFOCUS_GPU_GRID } from "../helpers/display-view-defocus-gpu-fixtures.js";
import { adapterSkipReason, findChromium, isSoftwareAdapter, openBrowserPage, type BrowserPage, type WebGpuAdapterProbe } from "./chromium.js";
import { decodeTransport, encodeTransport } from "./codec.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const required = process.env.PHOTIVRA_WEBGPU_REQUIRED === "1";
let page: BrowserPage | null = null, skip: string | null = null;
const report: Record<string, unknown>[] = [];

async function call<T>(fn: string, payload: unknown): Promise<T> {
  const text = await page!.evaluate<string>(`import('/test/webgpu/page-runner.js').then(m => m.${fn}(${JSON.stringify(encodeTransport(payload))}))`);
  return decodeTransport<T>(text);
}
function guard(): boolean {
  if (skip === null) return false;
  if (required) throw new Error(`WebGPU conformance required but unavailable: ${skip}`);
  console.warn(`[test:webgpu] skipped: ${skip}`);
  return true;
}
beforeAll(async () => {
  const binary = findChromium();
  if (!binary) { skip = "no Chromium binary found (set PHOTIVRA_WEBGPU_BROWSER or PLAYWRIGHT_BROWSERS_PATH)"; return; }
  page = await openBrowserPage(binary, root);
  const probe = await page.evaluate<WebGpuAdapterProbe>("import('/test/webgpu/page-runner.js').then(m => m.probe())");
  skip = adapterSkipReason(probe);
  if (skip === null) report.push({ adapter: probe.adapter, softwareAdapter: isSoftwareAdapter(probe) });
});
afterAll(async () => {
  await page?.close();
  if (report.length) process.stdout.write(`[test:webgpu display-view] ${JSON.stringify(report, null, 1)}\n`);
});

interface PageResult { cpu: { samples: Uint8Array; expected: Float64Array; noiseStd: Float64Array; saturated: Float64Array }; gpu: ComparableGpuResult & { saturated: Float64Array };
  flaggedPixelIndices: Uint32Array; hostRecomputedPixelIndices: Uint32Array; highlightRecomputedPixelIndices: Uint32Array; execution: ImageKernelExecution; gpuMilliseconds: number }

const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
const output = { ...SMALL_FRAME, format: "srgb-8" as const };
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
    output: { ...output, toneCurve: "positive-reinhard-per-channel" } }]
];

describe("webgpu-f32 display view (Speed) vs the float64 reference", () => {
  it.each(cases)("%s: every component inside the a-priori bounds; samples within one code", async (name, options) => {
    if (guard()) return;
    const result = await call<PageResult>("displayViewSpeed", { options, view: SMALL_VIEW });
    // The GPU is compared with the CPU reference of the same realm (the browser's). The Node reference's bytes are reported too:
    // they agree except where the browser's Math (atan2 in the Siemens star's geometry) differs in the last bit (docs/DISPLAY_VIEW.md,
    // "Same bytes in every engine").
    const node = await simulateDisplayViewWithInternals(options, SMALL_VIEW);
    let browserVersusNode = 0;
    for (let i = 0; i < node.internals.samples.length; i++) if (result.cpu.samples[i] !== node.internals.samples[i]) browserVersusNode++;
    const a = compareDisplayViews(result.cpu, result.gpu);
    expect(result.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.differingSamples).toBeLessThanOrEqual(0.01 * a.pixels * 3);
    expect(Array.from(result.hostRecomputedPixelIndices)).toEqual(Array.from(result.flaggedPixelIndices));
    // #533: every display pixel's highlight count is the reference's, bit for bit.
    expect(Array.from(result.gpu.saturated)).toEqual(Array.from(result.cpu.saturated));
    report.push({ case: name, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaUnitsRms: a.sigmaUnitsRms,
      sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples, flagged: result.flaggedPixelIndices.length, browserCpuVersusNodeCpuSamples: browserVersusNode,
      largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio, softwareAdapterMilliseconds: result.gpuMilliseconds });
  });
  it("banding never changes a byte, and a region equals the same pixels of the whole view", async () => {
    if (guard()) return;
    const options = cases[1]![1];
    const whole = await call<PageResult>("displayViewSpeed", { options, view: SMALL_VIEW });
    const banded = await call<PageResult>("displayViewSpeed", { options, view: SMALL_VIEW, maximumBandBytes: 4096 });
    expect(Array.from(banded.gpu.samples)).toEqual(Array.from(whole.gpu.samples));
    expect(Array.from(banded.gpu.expected)).toEqual(Array.from(whole.gpu.expected));
    const region = { x: 90, y: 60, width: 24, height: 16 };
    const part = await call<PageResult>("displayViewSpeed", { options, view: { ...SMALL_VIEW, region } });
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let c = 0; c < 3; c++) {
      const o = ((region.y + y) * SMALL_VIEW.width + region.x + x) * 3 + c, p = (y * region.width + x) * 3 + c;
      expect(part.gpu.samples[p]).toBe(whole.gpu.samples[o]);
      expect(part.gpu.expected[p]).toBe(whole.gpu.expected[o]);
    }
  });
  // #491: the composite material module. The ceilings on the flagged fraction of display pixels are those of the emulation test (a display
  // pixel is flagged when any of its ~36 to 100 query points is uncertain; the 1024-level elements, the label's glyph levels met exactly by
  // this frame's lattice and the bar star's diagonals flag many; each flagged pixel costs one CPU pixel, never an error).
  const declared = layeredScene(FIXTURE_ASPECT), lens = { prime: 50 as const, fNumber: 8 }, placed = { chartSize: { widthM: 0.042 }, subjectDistanceM: 0.63 };
  const composites: [string, SimulateCaptureOptions, number][] = [
    ["composite under the label layer (material-layers), frame-filling", { scene: declared, lens, sensor, output }, 0.06],
    ["composite under the label layer (material-layers), fixed-size chart with surround", { scene: declared, lens, sensor, output, ...placed }, 0.06],
    ["zone plate (2.3 element as a plain chart)", { scene: { preset: "zone-plate", maximumCyclesPerPictureHeight: 200 }, lens, sensor, output }, 0.3],
    ["Siemens star (sine, 64 cycles)", { scene: { preset: "siemens-star", profile: "sine", cycles: 64 }, lens, sensor, output }, 0.05]
  ];
  const ELEMENT_FLAGGED_CEILING: Record<string, number> = { "grey-ramp": 0.25, "zone-plate": 0.7, "label layer": 0.6, "siemens-star-bar": 0.15 };
  function ownerOf(index: number): string {
    const g = chartGeometry(resolveChartScene({ scene: allElementsComposite(), aspect: FIXTURE_ASPECT })), label = labelLayer(FIXTURE_ASPECT).rectangle;
    if (g.kind !== "composite") throw new Error("composite expected");
    const rx = index % SMALL_VIEW.width, ry = Math.floor(index / SMALL_VIEW.width), u = -1 + (rx + 0.5) * 2 / SMALL_VIEW.width, v = FIXTURE_ASPECT - (ry + 0.5) * 2 * FIXTURE_ASPECT / SMALL_VIEW.height;
    if (u >= label.u0 && u <= label.u1 && v >= label.v0 && v <= label.v1) return "label layer";
    for (let i = g.elements.length - 1; i >= 0; i--) {
      const e = g.elements[i]!, du = u - e.cu, dv = v - e.cv;
      if (du < -e.hw || du > e.hw || dv < -e.hh || dv > e.hh) continue;
      if (e.ellipse && (du / e.hw) ** 2 + (dv / e.hh) ** 2 > 1) continue;
      return COMPOSITE_ELEMENTS[i]![0];
    }
    return "background (line grid)";
  }
  it.each(composites)("composite module, %s: inside the a-priori bounds; samples within one code; the #480 thresholds met", async (name, options, ceiling) => {
    if (guard()) return;
    const result = await call<PageResult>("displayViewSpeed", { options, view: SMALL_VIEW });
    const node = await simulateDisplayViewWithInternals(options, SMALL_VIEW);
    let browserVersusNode = 0;
    for (let i = 0; i < node.internals.samples.length; i++) if (result.cpu.samples[i] !== node.internals.samples[i]) browserVersusNode++;
    const a = compareDisplayViews(result.cpu, result.gpu), { metrics, verdict } = acceptanceOf(SMALL_VIEW.width, SMALL_VIEW.height, result.cpu, result.gpu);
    expect(result.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.differingSamples).toBeLessThanOrEqual(0.01 * a.pixels * 3);
    expect(verdict.pass, JSON.stringify(verdict.checks)).toBe(true);
    expect(Array.from(result.hostRecomputedPixelIndices)).toEqual(Array.from(result.flaggedPixelIndices));
    expect(result.flaggedPixelIndices.length / a.pixels).toBeLessThanOrEqual(ceiling);
    let byElement: Record<string, { pixels: number; flagged: number; fraction: number }> | undefined;
    if (options.scene === declared) {
      byElement = {};
      for (let i = 0; i < a.pixels; i++) { const o = ownerOf(i); (byElement[o] ??= { pixels: 0, flagged: 0, fraction: 0 }).pixels++; }
      for (const i of result.flaggedPixelIndices) byElement[ownerOf(i)]!.flagged++;
      for (const [owner, row] of Object.entries(byElement)) { row.fraction = row.flagged / row.pixels; expect(row.fraction, owner).toBeLessThanOrEqual(ELEMENT_FLAGGED_CEILING[owner] ?? 0.1); }
    }
    report.push({ case: name, module: "chart-composite", pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaUnitsRms: a.sigmaUnitsRms,
      sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples, flagged: result.flaggedPixelIndices.length, flaggedFraction: result.flaggedPixelIndices.length / a.pixels,
      browserCpuVersusNodeCpuSamples: browserVersusNode, largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio, softwareAdapterMilliseconds: result.gpuMilliseconds,
      acceptance: { withinFraction: metrics.withinFraction, maxDeltaE: metrics.maxDeltaE, meanDeltaE: metrics.meanDeltaE, maxSigma: metrics.maxSigma, maxCode8: metrics.maxCode8, pass: verdict.pass },
      ...(byElement ? { flaggedByElement: byElement } : {}) });
  });
  it("the renderer's self-check case passes on the device", async () => {
    if (guard()) return;
    const { outcome } = await call<{ outcome: true | string }>("displayViewConformance", {});
    expect(outcome).toBe(true);
  });
});

interface QualityPageResult extends PageResult { cpu: PageResult["cpu"] & { ahdCorrectedPixelCount: number }; stageMilliseconds: Record<string, number>; tapsPerSite: number; statesComputed: number; ahdCorrectedPixelCount: number;
  cpuStages: { fullMs: number; restMs: number; signalMs: number; statesMs: number; restBitIdentical: boolean } | null }
const qualitySensor = { ...sensor, antiAliasing: { kind: "four-spot" as const } };
const qualityOutput = { ...output, demosaic: "ahd" as const };
const qualityLens = { prime: 50 as const, fNumber: 8, diffraction: "circular-aperture" as const };
/** The Quality fixtures of test/display-view-quality-gpu.test.ts: diffraction, the four-spot filter and AHD on the small charts. */
const qualityCases: [string, SimulateCaptureOptions][] = [
  ["slanted edge", { scene: { preset: "slanted-edge", angleDegrees: 5 }, lens: qualityLens, sensor: qualitySensor, output: qualityOutput }],
  ["Siemens star (bar)", { scene: { preset: "siemens-star", cycles: 36 }, lens: qualityLens, sensor: qualitySensor, output: qualityOutput }],
  ["step wedge", { scene: { preset: "step-wedge", steps: 11 }, lens: qualityLens, sensor: qualitySensor, output: qualityOutput }],
  ["checkerboard", { scene: { preset: "checkerboard", squaresAcross: 12 }, lens: qualityLens, sensor: qualitySensor, output: qualityOutput }],
  ["spectral patches", { scene: { preset: "patches", columns: 4, patches: Array.from({ length: 8 }, (_, i) => ({ patchId: `p${i}`, reflectance: i % 2 === 0 ?
    { kind: "tabulated" as const, samples: [380, 480, 580, 680, 780].map((w, j) => ({ wavelengthNanometers: w, value: 0.1 + 0.08 * i + 0.1 * j })) } : 0.05 + 0.1 * i })) },
    lens: qualityLens, sensor: qualitySensor, output: qualityOutput }],
  ["step wedge at the white clip", { scene: { preset: "step-wedge", steps: 11 }, lens: qualityLens, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 15 }, sensor: qualitySensor, output: qualityOutput }],
  ["step wedge at ISO 6400 (the low-signal correction)", { scene: { preset: "step-wedge", steps: 11 }, lens: qualityLens, exposure: { mode: "manual", iso: 6400, shutterSeconds: 1 / 8000 }, sensor: qualitySensor, output: qualityOutput }],
  ["step wedge, Reinhard", { scene: { preset: "step-wedge", steps: 11 }, lens: qualityLens, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 }, sensor: qualitySensor,
    output: { ...qualityOutput, toneCurve: "positive-reinhard-per-channel" } }],
  ["AHD without diffraction", { scene: { preset: "checkerboard", squaresAcross: 12 }, lens: { prime: 50, fNumber: 8 }, sensor: qualitySensor, output: qualityOutput }]
];

describe("webgpu-f32 display view (Quality) vs the float64 reference", () => {
  it.each(qualityCases)("%s: every component inside the a-priori bounds; samples within one code", async (name, options) => {
    if (guard()) return;
    // The CPU reference's stages are timed in the page too (the same realm and host), for the AHD placement (docs/WEBGPU.md).
    const result = await call<QualityPageResult>("displayViewQuality", { options, view: SMALL_VIEW, timeCpu: true });
    const node = await simulateDisplayViewWithInternals(options, SMALL_VIEW);
    let browserVersusNode = 0;
    for (let i = 0; i < node.internals.samples.length; i++) if (result.cpu.samples[i] !== node.internals.samples[i]) browserVersusNode++;
    const a = compareDisplayViews(result.cpu, result.gpu);
    expect(result.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.differingSamples).toBeLessThanOrEqual(0.01 * a.pixels * 3);
    expect(Array.from(result.hostRecomputedPixelIndices)).toEqual(Array.from(result.flaggedPixelIndices));
    // #533: every display pixel's highlight count is the reference's, bit for bit.
    expect(Array.from(result.gpu.saturated)).toEqual(Array.from(result.cpu.saturated));
    expect(result.ahdCorrectedPixelCount).toBe(result.cpu.ahdCorrectedPixelCount);
    report.push({ case: "quality: " + name, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaUnitsRms: a.sigmaUnitsRms,
      sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples, flagged: result.flaggedPixelIndices.length, browserCpuVersusNodeCpuSamples: browserVersusNode,
      largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio, tapsPerSite: result.tapsPerSite, correctedPixels: result.ahdCorrectedPixelCount,
      statesComputed: result.statesComputed, softwareAdapterMilliseconds: result.gpuMilliseconds, softwareAdapterStageMilliseconds: result.stageMilliseconds, browserCpuStageMilliseconds: result.cpuStages });
  });
  it("banding never changes a byte, and a region equals the same pixels of the whole view", async () => {
    if (guard()) return;
    const options = qualityCases[3]![1];
    const whole = await call<QualityPageResult>("displayViewQuality", { options, view: SMALL_VIEW });
    const banded = await call<QualityPageResult>("displayViewQuality", { options, view: SMALL_VIEW, maximumBandBytes: 1 << 20 });
    expect(Array.from(banded.gpu.samples)).toEqual(Array.from(whole.gpu.samples));
    expect(Array.from(banded.gpu.expected)).toEqual(Array.from(whole.gpu.expected));
    const region = { x: 90, y: 60, width: 24, height: 16 };
    const part = await call<QualityPageResult>("displayViewQuality", { options, view: { ...SMALL_VIEW, region } });
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let c = 0; c < 3; c++) {
      const o = ((region.y + y) * SMALL_VIEW.width + region.x + x) * 3 + c, p = (y * region.width + x) * 3 + c;
      expect(part.gpu.samples[p]).toBe(whole.gpu.samples[o]);
      expect(part.gpu.expected[p]).toBe(whole.gpu.expected[o]);
    }
  });
  it("#491: a material-layers scene (every composite element under the label layer) renders Quality through the composite module, within its bounds", async () => {
    if (guard()) return;
    const options: SimulateCaptureOptions = { scene: layeredScene(FIXTURE_ASPECT), lens: qualityLens, sensor: qualitySensor, output: qualityOutput };
    const view = { ...SMALL_VIEW, region: { x: 50, y: 70, width: 64, height: 48 } };
    const result = await call<QualityPageResult>("displayViewQuality", { options, view });
    const a = compareDisplayViews(result.cpu, result.gpu);
    expect(result.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(Array.from(result.hostRecomputedPixelIndices)).toEqual(Array.from(result.flaggedPixelIndices));
    report.push({ case: "quality: material-layers composite, 64 × 48 region", pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, sigmaUnitsMaximum: a.sigmaUnitsMaximum,
      differingSamples: a.differingSamples, flagged: result.flaggedPixelIndices.length, largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio,
      softwareAdapterMilliseconds: result.gpuMilliseconds, softwareAdapterStageMilliseconds: result.stageMilliseconds });
  });
  it("the Quality self-check case passes on the device", async () => {
    if (guard()) return;
    const { outcome } = await call<{ outcome: true | string }>("displayViewQualityConformance", {});
    expect(outcome).toBe(true);
  });
});

interface DefocusPageResult extends QualityPageResult { blockedSum: boolean; siteSumRelativeBound: number; latticePointsResolved: number; pixelFlags: Uint32Array }
/**
 * #492 step 2c: the defocus fixtures of test/display-view-defocus-gpu.test.ts on the device (the Quality site pass with the
 * factored table, the blocked sum and the host's lattice resolution; a defocused Speed request runs the Quality passes with its
 * bilinear demosaic). Per-stage times on a software adapter are recorded, not GPU performance.
 */
describe("webgpu-f32 display view with lens.defocus vs the float64 reference", () => {
  it.each([...DEFOCUS_GPU_GRID, ...DEFOCUS_GPU_EXTRA].map((c) => [c.name, c] as const))("%s: inside the a-priori bounds; samples within one code; the #480 thresholds met", async (name, c) => {
    if (guard()) return;
    const result = await call<DefocusPageResult>("displayViewQuality", { options: c.options, view: c.view });
    const a = compareDisplayViews(result.cpu, result.gpu), region = c.view.region!, { metrics, verdict } = acceptanceOf(region.width, region.height, result.cpu, result.gpu);
    expect(result.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(result.blockedSum).toBe(true);
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(verdict.pass, JSON.stringify(verdict.checks)).toBe(true);
    expect(Array.from(result.hostRecomputedPixelIndices)).toEqual(Array.from(result.flaggedPixelIndices));
    expect(result.ahdCorrectedPixelCount).toBe(result.cpu.ahdCorrectedPixelCount);
    report.push({ case: "defocus: " + name, kernelRadius: c.kernelRadius, tapsPerSite: result.tapsPerSite, siteSumRelativeBound: result.siteSumRelativeBound, pixels: a.pixels,
      deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples,
      largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio, flagged: result.flaggedPixelIndices.length,
      flaggedFraction: result.flaggedPixelIndices.length / a.pixels, latticePointsResolved: result.latticePointsResolved,
      acceptance: { withinFraction: metrics.withinFraction, maxDeltaE: metrics.maxDeltaE, maxSigma: metrics.maxSigma, maxCode8: metrics.maxCode8, pass: verdict.pass },
      softwareAdapterMilliseconds: result.gpuMilliseconds, softwareAdapterStageMilliseconds: result.stageMilliseconds });
  });
  it("the defocus self-check case passes on the device", async () => {
    if (guard()) return;
    const { outcome } = await call<{ outcome: true | string }>("displayViewQualityDefocusConformance", {});
    expect(outcome).toBe(true);
  });
});
