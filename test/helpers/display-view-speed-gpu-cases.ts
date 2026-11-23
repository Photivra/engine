// SPDX-License-Identifier: Apache-2.0
/**
 * Shared by test/display-view-speed-gpu.test.ts and -2.test.ts (#742: split so that no file nears the 900 s per-file cap under
 * coverage; run 44981939443 recorded 908 s for the single file): the small fixtures of the display view's Speed kernel on the
 * in-process float32 emulation, and the per-fixture check against the CPU reference.
 */
import { expect } from "vitest";
import { displayViewSpeedGpuRelativeBounds } from "../../src/gpu/display-view-speed-gpu.js";
import type { SimulateCaptureOptions } from "../../src/index.js";
import { createFakeGpu } from "./fake-webgpu.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, renderOnGpu, runtimeOf, type DisplayViewAgreement } from "./display-view-gpu-fixture.js";

export const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
export const output = { ...SMALL_FRAME, format: "srgb-8" as const };
/** The small fixtures: five chart presets at ISO 100, plus the clips (a bright wedge at the white level, a dark wedge at ISO 6400) and the Reinhard curve. */
export const cases: [string, SimulateCaptureOptions][] = [
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
    output: { ...output, toneCurve: "extended-reinhard-luminance", toneCurveParameters: { whiteLuminance: 4 } } }],
  // #593, #601: reconstruct and the desaturation (the chain's 3-D rule), fast and full, at and over the white clip.
  ["step wedge at the white clip, reconstruct", { scene: { preset: "step-wedge", steps: 11 }, lens: { prime: 50, fNumber: 8 }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 15 }, sensor,
    output: { ...output, highlightMode: "reconstruct" } }],
  ["spectral patches over white, reconstruct and desaturation with the Flat look", { scene: { preset: "patches", columns: 4, patches: Array.from({ length: 8 }, (_, i) => ({ patchId: `p${i}`, reflectance: i % 2 === 0 ?
    { kind: "tabulated" as const, samples: [380, 480, 580, 680, 780].map((w, j) => ({ wavelengthNanometers: w, value: 0.1 + 0.08 * i + 0.1 * j })) } : 0.05 + 0.1 * i })) },
    lens: { prime: 50, fNumber: 8 }, exposure: { mode: "manual", iso: 400, shutterSeconds: 1 / 30 }, sensor,
    output: { ...output, highlightMode: "reconstruct", gamutHandling: "desaturate-to-luminance", toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1, semiSaturation: 0.8465, whiteLuminance: 32 } } }],
  ["step wedge over white, desaturation, identity curve", { scene: { preset: "step-wedge", steps: 11 }, lens: { prime: 50, fNumber: 8 }, exposure: { mode: "manual", iso: 800, shutterSeconds: 1 / 60 }, sensor,
    output: { ...output, gamutHandling: "desaturate-to-luminance" } }]
];

/** The two slowest fixtures under coverage (240 and 259 s of the file's 908 s on run 44981939443), run by -2.test.ts. */
export const SLOW_CASES: readonly string[] = ["step wedge at the white clip, reconstruct", "step wedge over white, desaturation, identity curve"];

/** One fixture: every component inside the a-priori bounds, samples at most one code apart, flagged pixels equal to the reference. */
export async function checkSpeedCase(name: string, options: SimulateCaptureOptions, record: (name: string, a: DisplayViewAgreement, extra?: Record<string, unknown>) => void): Promise<void> {
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
}
