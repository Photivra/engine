// SPDX-License-Identifier: Apache-2.0
/**
 * #533: the display view reports the saturated (clipped highlight) pixels of the real capture in the region it rendered,
 * `diagnostics.highlight.saturatedPixelCount`, as the expected value of `simulateCapture`'s count. Checked here:
 * - where every contributing site is far from white (P_j exactly 0 or 1) it equals the capture's count of the same pixels,
 *   bit for bit, with the bilinear demosaic and with AHD, at 1:1 and on a coarser exact view;
 * - near white it is the expected value: the mean of the capture's count over noise seeds agrees with it;
 * - regions are additive (each display pixel's share is the same in every region), and a prepared view reports what
 *   `simulateDisplayView` reports;
 * - on the GPU (the float32 emulation of the Speed and Quality kernels) the count is the CPU reference's, bit for bit, where
 *   the kernel decides each real pixel and where the host recomputes undecided ones.
 * That the count changes no sample is held by the hash locks of test/display-view.test.ts, display-view-pixel-memo.test.ts and
 * display-view-speed-material.test.ts, which leave `diagnostics.highlight` out of their digests and keep their recorded hashes.
 */
import { describe, expect, it } from "vitest";
import { prepareDisplayView, simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { displayViewDecidedSaturation, overlaps } from "../src/facade/display-view.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { displayViewGpuFixture, renderOnGpu, renderOnGpuQuality, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

/** Light squares 3 stops over the white level, dark ones well below: with point sites every site is far from white. */
const CHECKER: SimulateCaptureOptions = { scene: { preset: "checkerboard", squaresAcross: 6 }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 15 }, output: { width: 60, height: 40 } };
/** A uniform grey whose green sites sit at the white level (about half the pixels clip on any one noise sample). */
const NEAR_WHITE: SimulateCaptureOptions = { scene: { preset: "uniform", reflectance: 0.5 }, exposure: { mode: "manual", iso: 100, shutterSeconds: 0.022 }, output: { width: 40, height: 30 } };

describe("display view highlight count (#533)", () => {
  it.each(["bilinear", "ahd"] as const)("equals the capture's count where every site is far from white (%s)", async (demosaic) => {
    const options: SimulateCaptureOptions = { ...CHECKER, output: { ...CHECKER.output, demosaic } };
    const capture = (await simulateCapture(options)).diagnostics.highlight.saturatedPixelCount;
    expect(capture).toBeGreaterThan(0);
    expect(capture).toBeLessThan(60 * 40);
    for (const view of [{ width: 60, height: 40 }, { width: 30, height: 20 }, { width: 20, height: 10 }]) {
      const result = await simulateDisplayView(options, view);
      expect(result.diagnostics.highlight).toEqual({ saturatedPixelCount: capture, statistic: "expected-value" });
    }
    // A coarse view takes the stratified estimate: unbiased, so close to the count but not equal to it.
    const coarse = (await simulateDisplayView(options, { width: 10, height: 8 })).diagnostics.highlight.saturatedPixelCount;
    expect(Math.abs(coarse - capture)).toBeLessThan(0.01 * capture);
  }, testTimeout(60_000));

  it("is the expected value of the capture's count near white", async () => {
    const counts: number[] = [];
    for (let seed = 1; seed <= 8; seed++) counts.push((await simulateCapture({ ...NEAR_WHITE, sensor: { noiseSeed: seed } })).diagnostics.highlight.saturatedPixelCount);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const spread = Math.sqrt(counts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (counts.length - 1));
    // The capture's count is a noise sample: it changes with the seed.
    expect(new Set(counts).size).toBeGreaterThan(1);
    for (const view of [{ width: 40, height: 30 }, { width: 20, height: 15 }, { width: 8, height: 6 }]) {
      const expected = (await simulateDisplayView(NEAR_WHITE, view)).diagnostics.highlight.saturatedPixelCount;
      expect(expected).toBeGreaterThan(0.2 * 1200);
      expect(expected).toBeLessThan(0.8 * 1200);
      expect(Number.isInteger(expected)).toBe(false);
      // Within four standard errors of the seeds' mean, and 2 % of the frame.
      expect(Math.abs(expected - mean)).toBeLessThan(Math.max(4 * spread / Math.sqrt(counts.length), 0.02 * 1200));
    }
  }, testTimeout(60_000));

  it("is additive over regions, per display pixel, and a prepared view reports the same count", async () => {
    for (const view of [{ width: 20, height: 15 }, { width: 8, height: 6 }]) {
      const whole = await simulateDisplayViewWithInternals(NEAR_WHITE, view);
      const halfW = Math.floor(view.width / 2), halfH = Math.floor(view.height / 2);
      const parts = [{ x: 0, y: 0, width: halfW, height: halfH }, { x: halfW, y: 0, width: view.width - halfW, height: halfH },
        { x: 0, y: halfH, width: halfW, height: view.height - halfH }, { x: halfW, y: halfH, width: view.width - halfW, height: view.height - halfH }];
      let sum = 0;
      for (const region of parts) {
        const part = await simulateDisplayViewWithInternals(NEAR_WHITE, { ...view, region });
        sum += part.result.diagnostics.highlight.saturatedPixelCount;
        for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++)
          expect(part.internals.saturated[y * region.width + x]).toBe(whole.internals.saturated[(region.y + y) * view.width + region.x + x]);
      }
      expect(sum).toBeCloseTo(whole.result.diagnostics.highlight.saturatedPixelCount, 9);
      const prepared = await prepareDisplayView(NEAR_WHITE);
      expect((await prepared.render(view)).diagnostics.highlight).toEqual(whole.result.diagnostics.highlight);
    }
  }, testTimeout(60_000));

  it("takes a decided display pixel's share with the reference's arithmetic", () => {
    // 2.96 real pixels per display pixel: four columns and rows with fractional overlaps; mask bits are j·nx + i.
    const sx = 600 / 203, columns = overlaps(7 * sx, 8 * sx, 600), rows = overlaps(5 * sx, 6 * sx, 400), nx = columns.w.length;
    let reference = 0, low = 0;
    for (let j = 0; j < rows.w.length; j++) for (let i = 0; i < nx; i++) {
      const set = (i + j) % 2 === 0 ? 1 : 0;
      if (set) low |= 1 << (j * nx + i);
      reference += columns.w[i]! * rows.w[j]! / (sx * sx) * set;
    }
    expect(displayViewDecidedSaturation(columns, rows, sx * sx, low >>> 0, 0)).toBe((reference / 1) * (sx * sx));
    expect(displayViewDecidedSaturation(columns, rows, sx * sx, 0, 0)).toBe(0);
    // Bits past 31 come from the high word (a 6 × 6 footprint).
    const wide = overlaps(0, 5.5, 100);
    expect(displayViewDecidedSaturation(wide, wide, 5.5 * 5.5, 0xffffffff, 0xf)).toBeCloseTo(5.5 * 5.5, 12);
  });
});

describe("display view highlight count on the GPU (#533, float32 emulation)", () => {
  const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
  const cases: [string, SimulateCaptureOptions][] = [
    ["Speed, light squares over white", { ...CHECKER, sensor, output: { width: 120, height: 80 } }],
    ["Speed, near white", { ...NEAR_WHITE, sensor, output: { width: 120, height: 80 } }],
    ["Quality, light squares over white, diffraction and AHD", { ...CHECKER, lens: { fNumber: 8, diffraction: "circular-aperture" }, sensor, output: { width: 120, height: 80, demosaic: "ahd" } }],
    ["Quality, near white, diffraction", { ...NEAR_WHITE, lens: { fNumber: 8, diffraction: "circular-aperture" }, sensor, output: { width: 120, height: 80 } }]
  ];
  it.each(cases)("%s: the count is the reference's, bit for bit", async (name, options) => {
    const fixture = await displayViewGpuFixture(options, { width: 41, height: 27 }), runtime = await runtimeOf(createFakeGpu().gpu);
    const gpu = name.startsWith("Speed") ? await renderOnGpu(runtime, fixture) : await renderOnGpuQuality(runtime, fixture);
    expect(fixture.cpu.saturatedPixelCount).toBeGreaterThan(0);
    expect(Array.from(gpu.saturated)).toEqual(Array.from(fixture.cpu.saturated));
    expect(gpu.saturatedPixelCount).toBe(fixture.cpu.saturatedPixelCount);
    expect(gpu.execution.diagnosticsExact).toBe(true);
    // Near white the kernel leaves real pixels undecided and the host takes the reference's count for those display pixels only;
    // far from white it decides them.
    if (name.includes("near white")) expect(gpu.highlightRecomputedPixelIndices.length).toBeGreaterThan(0);
    else expect(gpu.highlightRecomputedPixelIndices.length).toBeLessThan(0.5 * 41 * 27);
  }, testTimeout(120_000));
});
