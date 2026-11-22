// SPDX-License-Identifier: Apache-2.0

// Node 22/24/26 executable example of the batch-figure recipe (docs/QUICK_START.md, "Batch figure renders in Node"): persistent
// worker threads, row bands as the unit of work, one prepared view per request per worker, bands dealt dearest first by
// estimateDisplayViewRender, and each file joined from its bands. The engine itself is browser-safe; the workers are Node's.
import console from "node:console";
import { availableParallelism, freemem } from "node:os";
import { URL } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { estimateDisplayViewRender, prepareDisplayView } from "@photivra/engine";

/** Two figures of one comparison (f/8 and f/2.8), each a display file of 192 × 128; real figures are larger (768 × 512 and up). */
const request = (fNumber) => ({ scene: { preset: "siemens-star" }, subjectDistanceM: 2, fast: false,
  lens: { prime: 50, fNumber, diffraction: "circular-aperture" }, output: { width: 1200, height: 800, format: "srgb-8" } });
const FIGURES = [{ id: "f8", request: request(8) }, { id: "f2.8", request: request(2.8) }];
const FILE = { width: 192, height: 128, samplesPerAxis: 4 };
const BAND_ROWS = 32;

if (isMainThread) {
  // Bands of every file, with a cost estimate each (synchronous; it renders nothing).
  const bands = [];
  for (const figure of FIGURES) {
    const prepared = await prepareDisplayView(figure.request, { gpu: "off" });
    for (let y = 0; y < FILE.height; y += BAND_ROWS) {
      const view = { ...FILE, region: { x: 0, y, width: FILE.width, height: Math.min(BAND_ROWS, FILE.height - y) } };
      const e = estimateDisplayViewRender(prepared, view);
      bands.push({ figure: figure.id, view, cost: e.nativeSites * e.signal.tapsPerSite * e.signal.spectralNodes * e.signal.temporalMidpoints });
    }
  }
  // Dearest first, but a request's bands stay together so each worker keeps one prepared view at a time.
  const costOf = new Map(FIGURES.map((f) => [f.id, bands.filter((b) => b.figure === f.id).reduce((s, b) => s + b.cost, 0)]));
  bands.sort((a, b) => costOf.get(b.figure) - costOf.get(a.figure) || b.cost - a.cost);
  // One worker per core that does real work, and about 1 GiB of free memory each.
  const workers = Math.max(1, Math.min(availableParallelism() - 1, Math.floor(freemem() / 2 ** 30), 4));
  const done = new Map();
  await Promise.all(Array.from({ length: workers }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url));
    const next = () => { const band = bands.shift(); if (band) worker.postMessage(band); else worker.terminate().then(resolve); };
    worker.on("message", (m) => { done.set(m.figure + ":" + m.y, m.samples); next(); });
    worker.on("error", reject);
    next();
  })));
  // Bands join to the same bytes as the file rendered in one piece.
  for (const figure of FIGURES) {
    const parts = [];
    for (let y = 0; y < FILE.height; y += BAND_ROWS) parts.push(done.get(figure.id + ":" + y));
    const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { file.set(p, at); at += p.length; }
    const whole = await (await prepareDisplayView(figure.request, { gpu: "off" })).render(FILE);
    if (!file.every((v, i) => v === whole.image.samples[i])) throw new Error("Bands did not join to the one-piece render");
    console.log({ figure: figure.id, bytes: file.length, workers });
  }
} else {
  // A persistent worker: one prepared view at a time, reused for every band of its request.
  let current, prepared;
  parentPort.on("message", async (band) => {
    if (current !== band.figure) { prepared = await prepareDisplayView(FIGURES.find((f) => f.id === band.figure).request, { gpu: "off" }); current = band.figure; }
    const result = await prepared.render(band.view);
    parentPort.postMessage({ figure: band.figure, y: band.view.region.y, samples: result.image.samples });
  });
}
