// SPDX-License-Identifier: Apache-2.0
// Re-records test/shard-weights.json from Vitest JSON reports (Photivra/engine#510).
//
//   node scripts/record-shard-weights.mjs <report.json>... [--source "<where they ran>"]
//
// Each report is the output of `vitest run --reporter=json` (the CI coverage shards write
// one each, kept as the `coverage-timings-k` artifacts). A file's weight is its wall time
// in ms. The weights only balance --shard parts; they change no test.
import console from "node:console";
import process from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

const args = process.argv.slice(2);
const sourceAt = args.indexOf("--source");
const source = sourceAt === -1 ? "unrecorded host" : args.splice(sourceAt, 2)[1];
if (args.length === 0) throw new Error("usage: record-shard-weights.mjs <report.json>... [--source <text>]");

const files = {};
for (const report of args) {
  for (const result of JSON.parse(readFileSync(report, "utf8")).testResults) {
    const path = relative(process.cwd(), result.name).split("\\").join("/").replace(/^.*?(test\/)/, "$1");
    files[path] = Math.max(1, Math.round(result.endTime - result.startTime));
  }
}
const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
const about = `Per-file wall time in ms of the Vitest coverage run (${source}, ${new Date().toISOString().slice(0, 10)}), used only to balance --shard parts (test/helpers/weighted-shard-sequencer.ts). Re-record with scripts/record-shard-weights.mjs when the shard times drift.`;
// The files that get a coverage part of their own (2.24.0) are kept as they were.
let alone;
try { alone = JSON.parse(readFileSync("test/shard-weights.json", "utf8")).alone; } catch { alone = undefined; }
writeFileSync("test/shard-weights.json", `${JSON.stringify({ about, ...(alone ? { alone } : {}), files: sorted }, null, 1)}\n`);
console.log(`Recorded ${Object.keys(sorted).length} files from ${args.length} report(s).`);
