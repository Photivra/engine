// SPDX-License-Identifier: Apache-2.0
// Re-records test/shard-weights.json from Vitest JSON reports (Photivra/engine#510).
//
//   node scripts/record-shard-weights.mjs <report.json>... [--source "<where they ran>"]
//
// Each report is the output of `vitest run --reporter=json` (the CI coverage shards write
// one each, kept as the `coverage-timings-k` artifacts). A file's weight is its wall time
// in ms. The weights only balance --shard parts; they change no test.
//
// 2.29.0 (#742, #755): the reports of several runs may be given together (all ten parts of
// each run); a file timed in more than one report weighs the mean of its times, which evens
// out the hosted runners' speed differences between jobs. A test file that no report times
// (left out of the coverage run, or new) keeps its weight from the current table, so the
// table still names every test file; a file that no longer exists is dropped.
import console from "node:console";
import process from "node:process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

const args = process.argv.slice(2);
const sourceAt = args.indexOf("--source");
const source = sourceAt === -1 ? "unrecorded host" : args.splice(sourceAt, 2)[1];
if (args.length === 0) throw new Error("usage: record-shard-weights.mjs <report.json>... [--source <text>]");

const times = new Map();
for (const report of args) {
  for (const result of JSON.parse(readFileSync(report, "utf8")).testResults) {
    const path = relative(process.cwd(), result.name).split("\\").join("/").replace(/^.*?(test\/)/, "$1");
    times.set(path, [...(times.get(path) ?? []), result.endTime - result.startTime]);
  }
}
let previous;
try { previous = JSON.parse(readFileSync("test/shard-weights.json", "utf8")); } catch { previous = {}; }
const testFiles = readdirSync("test").filter((name) => /\.test\.(ts|mjs)$/.test(name)).map((name) => `test/${name}`);
const files = {};
for (const [path, measured] of times) files[path] = Math.max(1, Math.round(measured.reduce((a, b) => a + b, 0) / measured.length));
const carried = testFiles.filter((path) => files[path] === undefined && previous.files?.[path] !== undefined);
for (const path of carried) files[path] = previous.files[path];
for (const path of Object.keys(files)) if (!testFiles.includes(path)) delete files[path];
const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
const about = `Per-file wall time in ms of the Vitest coverage run (${source}, ${new Date().toISOString().slice(0, 10)}), used only to balance --shard parts (test/helpers/weighted-shard-sequencer.ts). Re-record with scripts/record-shard-weights.mjs when the shard times drift.` +
  (carried.length > 0 ? ` Kept from the previous table (no coverage time in these reports): ${carried.join(", ")}.` : "");
// The files that get a coverage part of their own (2.24.0) are kept as they were.
const alone = previous.alone;
writeFileSync("test/shard-weights.json", `${JSON.stringify({ about, ...(alone ? { alone } : {}), files: sorted }, null, 1)}\n`);
console.log(`Recorded ${Object.keys(sorted).length} files from ${args.length} report(s)` + (carried.length > 0 ? `; kept ${carried.length} from the previous table.` : "."));
