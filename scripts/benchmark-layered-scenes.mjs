// SPDX-License-Identifier: Apache-2.0

/**
 * Repository-only cost of layered chart scenes through the public API (#652, docs/LAYERED_SCENES.md). Informational only:
 * host-dependent, no CI threshold.
 *
 * The tabletop preset on a 6000 × 4000 sensor of 6 µm sites, an ideal 50 mm lens focused at 1 m, a 2 × 2 box pixel aperture, and a
 * 192 × 128 region on the right edge of the card at the focus distance: the display view (a 1:1 region of a whole-frame view,
 * `prepareDisplayView(…, { gpu: "off" })` then `render`) and the capture region (`simulateCapture` with `output.region`), fast and
 * full, at f/2 and f/8. The figure is the CPU time of the process (user + system) per render.
 *
 *   npm run build && node scripts/benchmark-layered-scenes.mjs [repeats]
 *
 * Environment: DIST (another build's `dist` directory to time instead of this checkout's).
 */
import console from "node:console";
import process from "node:process";
import { loadavg } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const dist = resolve(process.env.DIST ?? fileURLToPath(new URL("../dist", import.meta.url)));
const repeats = Number(process.argv[2] ?? 2);
if (!Number.isInteger(repeats) || repeats < 1) throw new Error("Usage: node scripts/benchmark-layered-scenes.mjs [repeats, a positive integer]");
const engine = await import(pathToFileURL(join(dist, "index.js")).href);
await engine.prepareLayeredChartScenes();
const W = 6000, H = 4000, aspect = H / W;
const scene = engine.resolveLayeredChartPreset({ scale: "tabletop", focusDistanceM: 1, lens: { focalLengthMm: 50 }, aspect });
// A region on the right edge of the card at the focus distance (the middle of the edge), in output pixels.
const card = scene.cards[2], u = card.centerU + card.width / 2, v = card.centerV + card.height / 2;
const px = Math.round((u + 1) / 2 * W), py = Math.round((aspect - v) / (2 * aspect) * W);
const region = { x: px - 96, y: py - 64, width: 192, height: 128 };
const cpu = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1e6; };
console.log("dist", dist, "load", loadavg().map((x) => x.toFixed(1)).join(" "), "region", JSON.stringify(region));
for (const fNumber of [2, 8]) for (const fast of [true, false]) {
  const options = { scene, subjectDistanceM: 1, lens: { ideal: { focalLengthMm: 50 }, fNumber, focusDistanceM: 1 }, sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box", samplesPerAxis: 2 } },
    output: { width: W, height: H, maximumPixels: (W + 2) * (H + 2) }, exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 }, fast };
  let t = cpu();
  const prepared = await engine.prepareDisplayView(options, { gpu: "off" });
  const prep = cpu() - t;
  for (let r = 0; r < repeats; r++) {
    t = cpu();
    const view = await prepared.render({ width: W, height: H, region });
    const viewS = cpu() - t;
    t = cpu();
    await engine.simulateCapture({ ...options, output: { ...options.output, region } });
    const captureS = cpu() - t;
    const layers = view.assumptions.find((a) => a.id === "scene.layers").value;
    console.log(`f/${fNumber} ${fast ? "fast" : "full"} run ${r + 1}: prepare ${prep.toFixed(2)} s, view ${viewS.toFixed(2)} s (${(viewS / (192 * 128) * 1e6).toFixed(1)} µs/pixel, ` +
      `${view.diagnostics.siteEvaluations} site evaluations), capture region ${captureS.toFixed(2)} s, rows ${layers.occlusionSamples}, radii ${layers.kernelRadiusSites.join(" ")}`);
  }
  if (fast) {
    // The share of edge sites (the layered sum) among the region's sites, from the build's internal module.
    const { simulateDisplayViewWithInternals } = await import(pathToFileURL(join(dist, "facade/simulate-display-view.js")).href);
    const { signal } = await simulateDisplayViewWithInternals(options, { width: W, height: H, region });
    console.log(`f/${fNumber}: edge sites ${(100 * signal.edgeSites / (signal.edgeSites + signal.delegatedSites)).toFixed(1)} % of ${signal.edgeSites + signal.delegatedSites}`);
  }
}
