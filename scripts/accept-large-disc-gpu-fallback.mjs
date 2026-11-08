// SPDX-License-Identifier: Apache-2.0
// 2.17.0 release gate (#564): after npm run build, PHOTIVRA_WEBGPU_ADAPTER=hardware node scripts/accept-large-disc-gpu-fallback.mjs .
// Repository tooling; not published.
// Renders a large-disc display view (kernel radius 179) and an in-focus control with prepareDisplayView(request, { gpu: "auto" })
// in Chromium on the built engine, and prints each render's diagnostics.fast.execution and view.defocus.
import console from "node:console";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]);
const driver = await import(pathToFileURL(root + "/test/webgpu/chromium.ts").href);
const binary = driver.findChromium();
const page = await driver.openBrowserPage(binary, root);
const base = { scene: { preset: "siemens-star" }, subjectDistanceM: 2, output: { width: 600, height: 400 }, sensor: { spectralStepNanometers: 40 } };
const cases = [
  ["large disc, R 179 (50 mm f/4, subject 2 m, focus 0.298 m)", { ...base, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 0.298, defocus: { model: "geometric-disc" } } }],
  ["in-focus control (same request, focus 2 m)", { ...base, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 2, defocus: { model: "geometric-disc" } } }]
];
try {
  const adapter = JSON.parse(await page.evaluate(`(async () => { const a = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" }); return JSON.stringify(a ? { vendor: a.info?.vendor, architecture: a.info?.architecture, isFallbackAdapter: a.info?.isFallbackAdapter ?? a.isFallbackAdapter } : null); })()`));
  const ua = await page.evaluate("navigator.userAgent");
  console.log(JSON.stringify({ browser: ua, adapter, flags: driver.webGpuFlags() }));
  for (const [name, request] of cases) {
    const out = await page.evaluate(`(async () => {
      const engine = await import("/dist/index.js");
      const t = performance.now();
      const prepared = await engine.prepareDisplayView(${JSON.stringify(request)}, { gpu: "auto" });
      const view = await prepared.render({ width: 300, height: 200 });
      const ms = performance.now() - t;
      await prepared.dispose?.();
      const d = view.assumptions.find((a) => a.id === "view.defocus");
      return JSON.stringify({ ms: Math.round(ms), execution: view.diagnostics.fast.execution, viewDefocus: d ? d.value : null });
    })()`);
    console.log(JSON.stringify({ case: name, ...JSON.parse(out) }));
  }
} finally { await page.close(); }
