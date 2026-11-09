// SPDX-License-Identifier: Apache-2.0
/**
 * #571: time and memory of `simulateCaptureFromParts` at 24 MP (6000 × 4000 output pixels), the app's "Applying … to the
 * whole image" step. Uses the built `dist` (run `npm run build` first). The parts (a COLUMNS × ROWS grid of region renders of a
 * slanted edge at f/8 with lens.diffraction) are rendered once and written to a temporary directory; each timed case then runs in
 * its own Node process that reads them and develops the whole frame, so its peak resident set (`process.resourceUsage().maxRSS`)
 * is that case's alone (the parts' RAW, 7 bytes per native site, included).
 *
 *   node scripts/benchmark-joined-development.mjs
 *
 * Environment: WIDTH, HEIGHT (default 6000, 4000), COLUMNS, ROWS (default 4, 2), CASES (default none,sharpening,correction,both,whole).
 * `whole` is `simulateCapture` of the whole frame with both stages, for comparison (it renders the RAW too).
 */
import "./require-fresh-dist.mjs";
import { spawnSync } from "node:child_process";
import console from "node:console";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = new URL("..", import.meta.url), index = pathToFileURL(fileURLToPath(new URL("dist/index.js", root))).href;
const width = Number(process.env.WIDTH ?? 6000), height = Number(process.env.HEIGHT ?? 4000);
const columns = Number(process.env.COLUMNS ?? 4), rows = Number(process.env.ROWS ?? 2);
const cases = (process.env.CASES ?? "none,sharpening,correction,both,whole").split(",");
const detail = { none: {}, sharpening: { sharpening: {} }, correction: { diffractionCorrection: {} }, both: { diffractionCorrection: {}, sharpening: {} }, whole: { diffractionCorrection: {}, sharpening: {} } };
const request = (extra) => ({ scene: { preset: "slanted-edge" }, lens: { fNumber: 8, diffraction: "circular-aperture" },
  output: { width, height, format: "srgb-8", maximumPixels: 2 ** 27, ...extra } });
const FIELDS = ["codes", "blackLevels", "digitalSaturationCodes", "saturationFlags", "effectiveSaturationCodes"];

async function renderParts(directory) {
  const { simulateCapture } = await import(index);
  const edge = (i, count, length) => (i === count ? length : 2 * Math.round((i * length) / count / 2));
  const meta = [];
  const started = performance.now();
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const x = edge(c, columns, width), y = edge(r, rows, height);
    const region = { x, y, width: edge(c + 1, columns, width) - x, height: edge(r + 1, rows, height) - y };
    const result = await simulateCapture(request({ region }));
    const k = meta.length;
    for (const field of FIELDS) writeFileSync(join(directory, k + "." + field), result.raw[field]);
    meta.push({ nativeRect: result.region.nativeRect });
  }
  writeFileSync(join(directory, "parts.json"), JSON.stringify(meta));
  return performance.now() - started;
}

async function child(directory, name) {
  const { simulateCaptureFromParts, simulateCapture } = await import(index);
  const types = { codes: Uint16Array, blackLevels: Uint16Array, digitalSaturationCodes: Uint16Array, saturationFlags: Uint8Array, effectiveSaturationCodes: Uint16Array };
  const parts = name === "whole" ? [] : JSON.parse(readFileSync(join(directory, "parts.json"), "utf8")).map((part, k) => ({ region: part,
    raw: Object.fromEntries(FIELDS.map((field) => { const bytes = readFileSync(join(directory, k + "." + field)); return [field, new types[field](bytes.buffer, bytes.byteOffset, bytes.byteLength / types[field].BYTES_PER_ELEMENT)]; })) }));
  const stages = {};
  let last;
  const options = { ...request(detail[name]), onProgress: (p) => { const now = performance.now(); if (p.stage !== last) { stages[p.stage] = now; last = p.stage; } stages[p.stage + ".end"] = now; } };
  const started = performance.now();
  const result = name === "whole" ? await simulateCapture(options) : await simulateCaptureFromParts(options, parts);
  const totalMs = performance.now() - started;
  const stageMs = Object.fromEntries(Object.keys(stages).filter((k) => !k.endsWith(".end")).map((k) => [k, Math.round(stages[k + ".end"] - stages[k])]));
  process.stdout.write(JSON.stringify({ case: name, parts: parts.length, totalMs: Math.round(totalMs), timingsMs: result.diagnostics.timingsMs, progressSpanMs: stageMs,
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }) + "\n");
}

if (process.argv[2] === "--child") await child(process.argv[3], process.argv[4]);
else {
  const directory = mkdtempSync(join(tmpdir(), "photivra-joined-"));
  try {
    console.log(JSON.stringify({ width, height, columns, rows, node: process.version, loadAverage: loadavg().map((v) => Math.round(v * 10) / 10) }));
    console.log(JSON.stringify({ partsRenderedMs: Math.round(await renderParts(directory)) }));
    for (const name of cases) {
      const run = spawnSync(process.execPath, ["--max-old-space-size=8192", fileURLToPath(import.meta.url), "--child", directory, name], { encoding: "utf8", maxBuffer: 1 << 20 });
      if (run.status !== 0) throw new Error(name + ": " + run.stderr);
      process.stdout.write(run.stdout);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
