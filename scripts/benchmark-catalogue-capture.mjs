// SPDX-License-Identifier: Apache-2.0
/**
 * #568: whole-frame `simulateCapture` cost with `lens.catalogue`, exact and fast (`fast: true`), against the same capture with
 * `lens.prime` (the issue's benchmark: Siemens star, full frame 36 × 24 mm, f/8, default 20 nm spectral step, one thread).
 * Uses the built `dist` (run `npm run build` first). Each width runs in one process; the captures alternate (prime, fast,
 * exact) so machine load affects them alike; the first round warms the process and is reported apart.
 *
 *   node scripts/benchmark-catalogue-capture.mjs                  # widths 48, 192, 384, 768; exact up to 384
 *
 * Environment: WIDTHS (default 48,192,384,768), EXACT_MAX_WIDTH (default 384), LENS (default pv-50-1.8, the app's default
 * lens), F (default 8), REPEATS (timed rounds after the warm-up, default 5; exact runs once per width).
 */
import "./require-fresh-dist.mjs";
import console from "node:console";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = new URL("..", import.meta.url);
const { simulateCapture } = await import(pathToFileURL(fileURLToPath(new URL("dist/index.js", root))).href);
const widths = (process.env.WIDTHS ?? "48,192,384,768").split(",").map(Number), exactMax = Number(process.env.EXACT_MAX_WIDTH ?? 384);
const lensId = process.env.LENS ?? "pv-50-1.8", N = Number(process.env.F ?? 8), repeats = Number(process.env.REPEATS ?? 5);

const capture = async (W, lens, fast) => {
  const started = performance.now();
  const r = await simulateCapture({ scene: { preset: "siemens-star" }, subjectDistanceM: 5, output: { width: W, height: W * 2 / 3, format: "srgb-16" },
    sensor: { pixelPitchMicrometers: 36000 / W }, lens: { ...lens, fNumber: N }, exposure: { mode: "manual", shutterSeconds: (N / 8) ** 2 / 125, iso: 100 }, fast });
  return { ms: performance.now() - started, applied: r.diagnostics.fast.applied["lens.catalogue"] ?? null, samples: r.image.samples };
};
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const rows = [];
for (const W of widths) {
  const prime = [], fast = [];
  let exact = null, fastSamples, fastApplied;
  for (let round = 0; round <= repeats; round++) {
    const p = await capture(W, { prime: 50 }, false), f = await capture(W, { catalogue: lensId }, true);
    if (round > 0) { prime.push(p.ms); fast.push(f.ms); }
    fastSamples = f.samples; fastApplied = f.applied;
  }
  let codeDifference = null;
  if (W <= exactMax) {
    const e = await capture(W, { catalogue: lensId }, false);
    exact = e.ms;
    codeDifference = 0;
    for (let i = 0; i < e.samples.length; i++) codeDifference = Math.max(codeDifference, Math.abs(e.samples[i] - fastSamples[i]));
  }
  const row = { width: W, height: W * 2 / 3, lens: lensId, fNumber: N, primeMedianS: +(median(prime) / 1000).toFixed(3), fastMedianS: +(median(fast) / 1000).toFixed(3),
    fastOverPrime: +(median(fast) / median(prime)).toFixed(2), exactS: exact === null ? null : +(exact / 1000).toFixed(2), fastApplied,
    largestSrgb16CodeDifferenceFastVsExact: codeDifference, loadAverage: +loadavg()[0].toFixed(1) };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log("\n| Width × height | lens.prime 50 (median) | lens.catalogue fast (median) | Fast ÷ prime | lens.catalogue exact | Largest sRGB-16 code difference, fast vs exact |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const r of rows) console.log("| " + r.width + " × " + r.height + " | " + r.primeMedianS + " s | " + r.fastMedianS + " s | " + r.fastOverPrime + " | " +
  (r.exactS === null ? "not run" : r.exactS + " s") + " | " + (r.largestSrgb16CodeDifferenceFastVsExact ?? "—") + " |");
console.log("\nNode " + process.version + ", load average " + rows.map((r) => r.loadAverage).join(" / ") + ", " + repeats + " timed rounds per width after one warm-up.");
