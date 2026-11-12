// SPDX-License-Identifier: Apache-2.0
/**
 * #605: the neighbor reconstruction's full method on the host (float64 SOR, the reference) against red-black SOR in float32 on
 * the device, per region size (test/webgpu/neighbor-fill-page.ts; `npm run bench:webgpu -- test/webgpu/neighbor-fill.timing.ts`,
 * with `PHOTIVRA_WEBGPU_ADAPTER=hardware` on hardware). The record behind docs/WEBGPU.md, "Neighbor highlight reconstruction";
 * nothing is asserted beyond the run completing. Software-adapter (SwiftShader) times are not GPU performance.
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import { fileURLToPath } from "node:url";
import { adapterSkipReason, findChromium, isSoftwareAdapter, openBrowserPage, type BrowserPage, type WebGpuAdapterProbe } from "./chromium.js";
import { decodeTransport, encodeTransport } from "./codec.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
let page: BrowserPage | null = null, skip: string | null = null;
const report: Record<string, unknown>[] = [];
beforeAll(async () => {
  const binary = findChromium();
  if (!binary) { skip = "no Chromium binary found"; return; }
  page = await openBrowserPage(binary, root);
  const probe = await page.evaluate<WebGpuAdapterProbe>("import('/test/webgpu/page-runner.js').then(m => m.probe())");
  skip = adapterSkipReason(probe);
  if (skip === null) report.push({ adapter: probe.adapter, softwareAdapter: isSoftwareAdapter(probe) });
});
afterAll(async () => {
  await page?.close();
  if (report.length) process.stdout.write(`[bench:webgpu neighbor fill] ${JSON.stringify(report, null, 1)}\n`);
});

describe("neighbor reconstruction's harmonic fill: host float64 SOR vs device float32 red-black SOR (#605)", () => {
  it.each([16, 64, 256])("a clipped square of side %i", async (side) => {
    if (skip !== null) { console.warn(`[bench:webgpu] skipped: ${skip}`); return; }
    const checkpoints = [10, 25, 50, 100, 200, 400, 800, 1600, 3200];
    const text = await page!.evaluate<string>(`import('/test/webgpu/neighbor-fill-page.js').then(m => m.neighborFill(${JSON.stringify(encodeTransport({ side, checkpoints }))}))`);
    report.push(decodeTransport<Record<string, unknown>>(text));
  });
});
