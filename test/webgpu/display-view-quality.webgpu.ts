// SPDX-License-Identifier: Apache-2.0
/**
 * Real-GPU conformance of the display view's Quality kernels (#479) and of lens.defocus on the GPU (#492) against the float64 CPU
 * reference (`npm run test:webgpu`): the Quality fixtures of test/display-view-quality-gpu.test.ts (diffraction, the four-spot
 * filter and AHD; #593 and #601's coupled steps), banding and regions, a material-layers scene, the defocus fixtures of
 * test/display-view-defocus-gpu.test.ts, and the Quality and defocus self-check cases. In its own file since 2.22.0 (from
 * test/webgpu/display-view.webgpu.ts) so that CI runs the suite as two parallel jobs. Timings from a software adapter are recorded,
 * not GPU performance, and none are asserted.
 */
import { describe, expect, it } from "vitest";
import type { SimulateCaptureOptions } from "../../src/index.js";
import { simulateDisplayViewWithInternals } from "../../src/facade/simulate-display-view.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews } from "../helpers/display-view-gpu-fixture.js";
import { acceptanceOf } from "../helpers/display-view-acceptance-metrics.js";
import { FIXTURE_ASPECT, layeredScene } from "../helpers/chart-composite-fixtures.js";
import { DEFOCUS_GPU_EXTRA, DEFOCUS_GPU_GRID } from "../helpers/display-view-defocus-gpu-fixtures.js";
import { useDisplayViewPage, type QualityPageResult } from "./display-view-page.js";
import { COUPLED_QUALITY_CASES } from "../helpers/display-view-quality-cases.js";

const { call, guard, report } = useDisplayViewPage("display-view-quality");
const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
const output = { ...SMALL_FRAME, format: "srgb-8" as const };

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
  ["step wedge at ISO 6400 (low signal)", { scene: { preset: "step-wedge", steps: 11 }, lens: qualityLens, exposure: { mode: "manual", iso: 6400, shutterSeconds: 1 / 8000 }, sensor: qualitySensor, output: qualityOutput }],
  ["step wedge, Reinhard", { scene: { preset: "step-wedge", steps: 11 }, lens: qualityLens, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 }, sensor: qualitySensor,
    output: { ...qualityOutput, toneCurve: "positive-reinhard-per-channel" } }],
  ["AHD without diffraction", { scene: { preset: "checkerboard", squaresAcross: 12 }, lens: { prime: 50, fNumber: 8 }, sensor: qualitySensor, output: qualityOutput }],
  // #593, #601: the coupled steps in the Quality kernels (the emulation's cases), and the full rules.
  ...COUPLED_QUALITY_CASES,
  ["step wedge over white, reconstruct and desaturation, Flat look (full rules)", { scene: { preset: "step-wedge", steps: 11 }, lens: qualityLens, exposure: { mode: "manual", iso: 400, shutterSeconds: 1 / 30 },
    sensor: qualitySensor, fast: false, output: { ...qualityOutput, highlightMode: "reconstruct", gamutHandling: "desaturate-to-luminance", toneCurve: "naka-rushton-luminance",
      toneCurveParameters: { exponent: 1, semiSaturation: 0.8465, whiteLuminance: 32 } } }]
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
    report.push({ case: "quality: " + name, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaUnitsRms: a.sigmaUnitsRms,
      sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples, flagged: result.flaggedPixelIndices.length, browserCpuVersusNodeCpuSamples: browserVersusNode,
      largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio, tapsPerSite: result.tapsPerSite,
      softwareAdapterMilliseconds: result.gpuMilliseconds, softwareAdapterStageMilliseconds: result.stageMilliseconds, browserCpuStageMilliseconds: result.cpuStages });
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
