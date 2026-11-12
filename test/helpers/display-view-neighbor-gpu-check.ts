// SPDX-License-Identifier: Apache-2.0
/**
 * #605 (2.23.0): the check of one `highlightMode: "reconstruct-neighbors"` case on the display view's GPU kernels (float32
 * emulation) against the CPU reference, shared by test/display-view-neighbors-gpu*.test.ts. The cases are split over several
 * files so that the CI parts balance (one file holding all four measured more than the 20-minute job limit on CI): every
 * component inside the a-priori bounds, at most one code, flagged pixels recomputed.
 */
import { afterAll, expect } from "vitest";
import type { SimulateCaptureOptions } from "../../src/index.js";
import { displayViewNeighborStats } from "../../src/gpu/wgsl-display-view-neighbors.js";
import { createFakeGpu } from "./fake-webgpu.js";
import { SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, renderOnGpu, renderOnGpuQuality, runtimeOf } from "./display-view-gpu-fixture.js";

/** The part the full cases render: the full rule's 4,096 nodes per real pixel are slow to emulate; it holds four clipped regions. */
export const NEIGHBOR_PART = { x: 120, y: 50, width: 40, height: 30 };

/** Collects each case's measurements and prints them once after the file's tests. */
export function neighborCaseReport(): Record<string, unknown>[] {
  const report: Record<string, unknown>[] = [];
  afterAll(() => { if (report.length) process.stdout.write("[display-view neighbors GPU emulation] " + JSON.stringify(report) + "\n"); });
  return report;
}

/** A display-view region: a part of SMALL_VIEW. */
export interface NeighborRegion { x: number; y: number; width: number; height: number }

/**
 * `region` cut into `count` bands of whole rows (top first; the first bands take the extra rows). The CPU reference's ratios do
 * not depend on where a render reaches a region (test/display-view-neighbors-gpu.test.ts checks a region render against the whole
 * view), so checking every band checks the same pixels as checking `region` once (2.23.0: the Quality cases are split this way so
 * that each CI job fits its limit).
 */
export function neighborBands(region: NeighborRegion, count: number): NeighborRegion[] {
  const bands: NeighborRegion[] = [];
  for (let i = 0, y = region.y; i < count; i++) {
    const height = Math.floor(region.height / count) + (i < region.height % count ? 1 : 0);
    bands.push({ ...region, y, height });
    y += height;
  }
  return bands;
}

/** The whole view as a region. */
export const NEIGHBOR_WHOLE_VIEW: NeighborRegion = { x: 0, y: 0, ...SMALL_VIEW };

/**
 * Checks one case (`flagLimit`: see the Quality full halves). The full rule's 4,096 nodes per real pixel are slow to emulate: by default the full cases take a 40 × 30 part
 * holding four clipped regions and the fast cases the whole view; `region` renders a part instead.
 */
export async function runNeighborCase(report: Record<string, unknown>[], name: string, options: SimulateCaptureOptions, quality: boolean, region?: NeighborRegion, flagLimit?: number): Promise<void> {
  const part = region ?? (options.fast === false ? NEIGHBOR_PART : undefined);
  const view = part ? { ...SMALL_VIEW, region: part } : SMALL_VIEW;
  const fixture = await displayViewGpuFixture(options, view), runtime = await runtimeOf(createFakeGpu().gpu);
  Object.assign(displayViewNeighborStats, { dispatches: 0, pixels: 0, realPixels: 0, hostMilliseconds: 0 });
  const t = performance.now();
  const gpu = quality ? await renderOnGpuQuality(runtime, fixture) : await renderOnGpu(runtime, fixture);
  const ms = Math.round(performance.now() - t), a = compareDisplayViews(fixture.cpu, gpu);
  report.push({ case: name, ...(region ? { region } : {}), ms, ...displayViewNeighborStats, hostMilliseconds: Math.round(displayViewNeighborStats.hostMilliseconds), flagged: gpu.flaggedPixelIndices.length,
    deltaE2000Maximum: a.deltaEMaximum, sigmaUnitsMaximum: a.sigmaUnitsMaximum, differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference,
    largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio, expectedAbsolute: gpu.expectedValueBound.absolute });
  expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
  // The ratios reached the kernel: pixels took them in a second dispatch.
  expect(displayViewNeighborStats.pixels).toBeGreaterThan(0);
  expect(a.outsideExpectedBound).toBe(0);
  expect(a.outsideVarianceBound).toBe(0);
  expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
  expect(a.differingSamples).toBeLessThanOrEqual(0.01 * a.pixels * 3);
  expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
  // The coupled steps' recompute flag (bit 0; the Quality kernels also flag AHD's choice, bit 5) is set on a small share: the
  // rebuild itself ran on the GPU. Under 5 % of the rendered pixels, or below `flagLimit` (a half's share of a whole region's limit).
  const pixelFlags = (gpu as { pixelFlags?: Uint32Array }).pixelFlags, flags = pixelFlags ? pixelFlags.filter((v) => (v & 1) !== 0).length : gpu.flaggedPixelIndices.length;
  expect(flags).toBeLessThan(flagLimit ?? 0.05 * a.pixels);
  runtime.destroy();
}
