// SPDX-License-Identifier: Apache-2.0
/**
 * The Quality kernels' chart cases (test/display-view-quality-gpu.test.ts and test/display-view-quality-gpu-charts.test.ts, split
 * in 2.21.0 so that no coverage shard holds them all): each case on the float32 emulation against the CPU reference.
 */
import { expect } from "vitest";
import type { SimulateCaptureOptions } from "../../src/index.js";
import { createFakeGpu } from "./fake-webgpu.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, renderOnGpuQuality, runtimeOf, type DisplayViewAgreement } from "./display-view-gpu-fixture.js";

const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" as const } };
const output = { ...SMALL_FRAME, format: "srgb-8" as const, demosaic: "ahd" as const };
const lens = { prime: 50 as const, fNumber: 8, diffraction: "circular-aperture" as const };

/** The small Quality fixtures: the Speed fixtures' charts with diffraction, the four-spot filter and AHD, plus the clips, low signal and the Reinhard curve. */
export const QUALITY_CASES: [string, SimulateCaptureOptions][] = [
  ["slanted edge", { scene: { preset: "slanted-edge", angleDegrees: 5 }, lens, sensor, output }],
  ["Siemens star (bar)", { scene: { preset: "siemens-star", cycles: 36 }, lens, sensor, output }],
  ["step wedge", { scene: { preset: "step-wedge", steps: 11 }, lens, sensor, output }],
  ["checkerboard", { scene: { preset: "checkerboard", squaresAcross: 12 }, lens, sensor, output }],
  ["spectral patches", { scene: { preset: "patches", columns: 4, patches: Array.from({ length: 8 }, (_, i) => ({ patchId: `p${i}`, reflectance: i % 2 === 0 ?
    { kind: "tabulated" as const, samples: [380, 480, 580, 680, 780].map((w, j) => ({ wavelengthNanometers: w, value: 0.1 + 0.08 * i + 0.1 * j })) } : 0.05 + 0.1 * i })) },
    lens, sensor, output }],
  ["step wedge at the white clip", { scene: { preset: "step-wedge", steps: 11 }, lens, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 15 }, sensor, output }],
  ["step wedge at ISO 6400 (low signal)", { scene: { preset: "step-wedge", steps: 11 }, lens, exposure: { mode: "manual", iso: 6400, shutterSeconds: 1 / 8000 }, sensor, output }],
  ["step wedge, Reinhard", { scene: { preset: "step-wedge", steps: 11 }, lens, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 }, sensor, output: { ...output, toneCurve: "positive-reinhard-per-channel" } }],
  ["AHD without diffraction", { scene: { preset: "checkerboard", squaresAcross: 12 }, lens: { prime: 50, fNumber: 8 }, sensor, output }]
];

const STANDARD = { exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 }, FLAT = { exponent: 1, semiSaturation: 0.8465, whiteLuminance: 32 };
/** #593, #601: the coupled rendering steps in the Quality kernels (luminance tone curves, reconstruct, the desaturation). */
export const COUPLED_QUALITY_CASES: [string, SimulateCaptureOptions][] = [
  ["step wedge, Standard look", { scene: { preset: "step-wedge", steps: 11 }, lens, exposure: { mode: "manual", iso: 1600, shutterSeconds: 1 / 250 }, sensor,
    output: { ...output, toneCurve: "naka-rushton-luminance", toneCurveParameters: STANDARD } }],
  ["checkerboard, Flat look", { scene: { preset: "checkerboard", squaresAcross: 12 }, lens, sensor, output: { ...output, toneCurve: "naka-rushton-luminance", toneCurveParameters: FLAT } }],
  ["step wedge at the white clip, reconstruct", { scene: { preset: "step-wedge", steps: 11 }, lens, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 15 }, sensor,
    output: { ...output, highlightMode: "reconstruct" } }],
  ["step wedge over white, desaturation with extended Reinhard", { scene: { preset: "step-wedge", steps: 11 }, lens, exposure: { mode: "manual", iso: 400, shutterSeconds: 1 / 30 }, sensor,
    output: { ...output, gamutHandling: "desaturate-to-luminance", toneCurve: "extended-reinhard-luminance", toneCurveParameters: { whiteLuminance: 4 } } }],
  ["step wedge, Naka–Rushton below exponent 1", { scene: { preset: "step-wedge", steps: 11 }, lens, exposure: { mode: "manual", iso: 800, shutterSeconds: 1 / 125 }, sensor,
    output: { ...output, toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 0.7, semiSaturation: 0.4, whiteLuminance: 8 } } }]
];


/** One case's run and checks; `report` collects the measured agreement. */
export async function runQualityCase(name: string, options: SimulateCaptureOptions, report: Record<string, unknown>[]): Promise<void> {
  const record = (a: DisplayViewAgreement, extra: Record<string, unknown>): void => {
    report.push({ case: name, ...extra, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaUnitsRms: a.sigmaUnitsRms,
      sigmaRelativeMaximum: a.sigmaRelativeMaximum, differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference,
      largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio });
  };
    const fixture = await displayViewGpuFixture(options, SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
  const t = performance.now();
  const gpu = await renderOnGpuQuality(runtime, fixture), emulationMs = Math.round(performance.now() - t), a = compareDisplayViews(fixture.cpu, gpu);
  record(a, { flagged: gpu.flaggedPixelIndices.length, recomputed: gpu.hostRecomputedPixelIndices.length, tapsPerSite: gpu.tapsPerSite, 
    emulationMs, stageMilliseconds: gpu.stageMilliseconds, expectedValueBound: gpu.expectedValueBound, varianceBound: gpu.varianceBound });
  expect(gpu.estimation).toBe("exact-area-mean");
  expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32", bitIdenticalToReference: false, fast: true, diagnosticsExact: true });
  expect(gpu.execution.errorBound).toEqual(gpu.expectedValueBound);
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
}
