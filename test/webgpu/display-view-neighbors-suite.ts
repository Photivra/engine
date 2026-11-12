// SPDX-License-Identifier: Apache-2.0
/**
 * #605: the shared suite of the real-GPU `highlightMode: "reconstruct-neighbors"` files (test/webgpu/display-view-neighbors*.webgpu.ts):
 * each case rendered on the device against the float64 CPU reference of the same realm, every component inside the a-priori
 * bounds, at most one code. Skips with a message when no browser or adapter is available, unless PHOTIVRA_WEBGPU_REQUIRED=1.
 * Software-adapter (SwiftShader) times are not GPU performance; none are asserted.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { ImageKernelExecution, SimulateCaptureOptions } from "../../src/index.js";
import { compareDisplayViews, type ComparableGpuResult } from "../helpers/display-view-gpu-fixture.js";
import { adapterSkipReason, findChromium, isSoftwareAdapter, openBrowserPage, type BrowserPage, type WebGpuAdapterProbe } from "./chromium.js";
import { decodeTransport, encodeTransport } from "./codec.js";

/** [test name, options, Quality kernels, view (the display view, or a region of it)]. */
export type NeighborWebGpuCase = [string, SimulateCaptureOptions, boolean, { width: number; height: number; region?: { x: number; y: number; width: number; height: number } }];

interface PageResult { cpu: { samples: Uint8Array; expected: Float64Array; noiseStd: Float64Array }; gpu: ComparableGpuResult;
  flaggedPixelIndices: Uint32Array; hostRecomputedPixelIndices: Uint32Array; execution: ImageKernelExecution; gpuMilliseconds: number; stageMilliseconds?: unknown }

export function describeNeighborWebGpuCases(cases: NeighborWebGpuCase[]): void {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const required = process.env.PHOTIVRA_WEBGPU_REQUIRED === "1";
  let page: BrowserPage | null = null, skip: string | null = null;
  const report: Record<string, unknown>[] = [];
  async function call<T>(fn: string, payload: unknown): Promise<T> {
    const text = await page!.evaluate<string>(`import('/test/webgpu/page-runner.js').then(m => m.${fn}(${JSON.stringify(encodeTransport(payload))}))`);
    return decodeTransport<T>(text);
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
    if (report.length) process.stdout.write(`[test:webgpu display-view neighbors] ${JSON.stringify(report, null, 1)}\n`);
  });

  describe("webgpu-f32 display view with reconstruct-neighbors vs the float64 reference (#605)", () => {
    it.each(cases)("%s: every component inside the a-priori bounds; samples within one code", async (name, options, quality, view) => {
      if (skip !== null) {
        if (required) throw new Error(`WebGPU conformance required but unavailable: ${skip}`);
        console.warn(`[test:webgpu] skipped: ${skip}`);
        return;
      }
      await page!.evaluate("import('/src/gpu/wgsl-display-view-neighbors.js').then(m => Object.assign(m.displayViewNeighborStats, { dispatches: 0, pixels: 0, realPixels: 0, hostMilliseconds: 0 }))");
      const result = await call<PageResult>(quality ? "displayViewQuality" : "displayViewSpeed", { options, view });
      const stats = await page!.evaluate<Record<string, number>>("import('/src/gpu/wgsl-display-view-neighbors.js').then(m => ({ ...m.displayViewNeighborStats }))");
      const a = compareDisplayViews(result.cpu, result.gpu);
      report.push({ case: name, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, sigmaUnitsMaximum: a.sigmaUnitsMaximum, differingSamples: a.differingSamples,
        largestCodeDifference: a.largestCodeDifference, flagged: result.flaggedPixelIndices.length, largestExpectedBoundRatio: a.largestExpectedRatio,
        largestVarianceBoundRatio: a.largestVarianceRatio, gpuMilliseconds: result.gpuMilliseconds, stageMilliseconds: result.stageMilliseconds, neighbors: stats });
      expect(result.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
      expect(stats.pixels).toBeGreaterThan(0);
      expect(a.outsideExpectedBound).toBe(0);
      expect(a.outsideVarianceBound).toBe(0);
      expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
      expect(a.differingSamples).toBeLessThanOrEqual(0.01 * a.pixels * 3);
      expect(Array.from(result.hostRecomputedPixelIndices)).toEqual(Array.from(result.flaggedPixelIndices));
    });
  });
}
