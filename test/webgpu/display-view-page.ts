// SPDX-License-Identifier: Apache-2.0
/**
 * The browser page of the display view's real-GPU suites (test/webgpu/display-view.webgpu.ts and, since 2.22.0,
 * test/webgpu/display-view-quality.webgpu.ts, split so that CI can run them as two parallel jobs): opens Chromium once per file,
 * probes the adapter, runs page-runner functions, and prints the file's report at the end. Skips with a message when no browser
 * or adapter is available, unless PHOTIVRA_WEBGPU_REQUIRED=1.
 */
import { afterAll, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import type { ImageKernelExecution } from "../../src/index.js";
import type { ComparableGpuResult } from "../helpers/display-view-gpu-fixture.js";
import { adapterSkipReason, findChromium, isSoftwareAdapter, openBrowserPage, type BrowserPage, type WebGpuAdapterProbe } from "./chromium.js";
import { decodeTransport, encodeTransport } from "./codec.js";

export interface PageResult { cpu: { samples: Uint8Array; expected: Float64Array; noiseStd: Float64Array; saturated: Float64Array }; gpu: ComparableGpuResult & { saturated: Float64Array };
  flaggedPixelIndices: Uint32Array; hostRecomputedPixelIndices: Uint32Array; highlightRecomputedPixelIndices: Uint32Array; execution: ImageKernelExecution; gpuMilliseconds: number }

export interface QualityPageResult extends PageResult { stageMilliseconds: Record<string, number>; tapsPerSite: number;
  cpuStages: { fullMs: number; restMs: number; signalMs: number; statesMs: number; restBitIdentical: boolean } | null }

/** Registers the file's page (beforeAll/afterAll) and returns its call, skip guard and report. */
export function useDisplayViewPage(label: string): { call<T>(fn: string, payload: unknown): Promise<T>; guard(): boolean; report: Record<string, unknown>[] } {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const required = process.env.PHOTIVRA_WEBGPU_REQUIRED === "1";
  let page: BrowserPage | null = null, skip: string | null = null;
  const report: Record<string, unknown>[] = [];
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
    if (report.length) process.stdout.write(`[test:webgpu ${label}] ${JSON.stringify(report, null, 1)}\n`);
  });
  return {
    async call<T>(fn: string, payload: unknown): Promise<T> {
      const text = await page!.evaluate<string>(`import('/test/webgpu/page-runner.js').then(m => m.${fn}(${JSON.stringify(encodeTransport(payload))}))`);
      return decodeTransport<T>(text);
    },
    guard(): boolean {
      if (skip === null) return false;
      if (required) throw new Error(`WebGPU conformance required but unavailable: ${skip}`);
      console.warn(`[test:webgpu] skipped: ${skip}`);
      return true;
    },
    report
  };
}
