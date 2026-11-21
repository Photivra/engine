// SPDX-License-Identifier: Apache-2.0
// The coverage gate's decision, made from the parts the coverage shards left (Photivra/engine#666).
//
// Each coverage shard uploads one part, `coverage-part-<k>`: its Vitest blob report
// (`blob-<k>-<count>.json`) when it ran its share of the suite under coverage, or a marker
// (`proven-<k>.txt`, holding the proof's run id) when it found ci.yml's `coverage` proof for
// the tree and skipped that repeat (.github/ci-proof.mjs, #510). Each shard decides on its own
// runner, so one run can mix the two (the 2.27.0 publish run had nine markers and one blob).
//
//   node .github/coverage-parts.mjs <directory> [count]
//                                   prints action=merge|proven (and appends it to $GITHUB_OUTPUT)
//
// Every part from 1 to count must be there exactly once. Ten blobs: merge them and enforce the
// thresholds. At least one marker and every other part a blob or a marker: pass without a merge,
// because a marker exists only when ci.yml's `verify (lts/*)` passed the whole suite under
// coverage, thresholds enforced, on this exact tree. Anything else fails.
import console from "node:console";
import process from "node:process";
import { appendFileSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function coverageDecision(names, count = 10) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`not a part count: ${count}`);
  const found = new Map();
  for (const name of names) {
    const blob = /^blob-([1-9]\d*)-([1-9]\d*)\.json$/.exec(name);
    const marker = /^proven-([1-9]\d*)\.txt$/.exec(name);
    const part = Number((blob ?? marker)?.[1]);
    if (!(blob || marker) || (blob && Number(blob[2]) !== count) || part > count)
      throw new Error(`Unexpected file ${name} among the coverage parts (expected blob-<k>-${count}.json or proven-<k>.txt, k from 1 to ${count}). Re-run all jobs.`);
    if (found.has(part)) throw new Error(`Coverage part ${part} is present twice (${found.get(part).name} and ${name}). Re-run all jobs.`);
    found.set(part, { kind: blob ? "blob" : "marker", name });
  }
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((part) => !found.has(part));
  if (missing.length > 0) throw new Error(`Coverage part${missing.length > 1 ? "s" : ""} ${missing.join(", ")} of ${count} missing. Re-run all jobs.`);
  const parts = [...found].filter(([, { kind }]) => kind === "marker").map(([part]) => part).sort((a, b) => a - b);
  return parts.length === 0 ? { action: "merge" } : { action: "proven", parts };
}

function main([directory, count = "10"]) {
  if (!directory) throw new Error("usage: coverage-parts.mjs <directory> [count]");
  let names;
  try { names = readdirSync(directory); } catch { names = []; }
  const decision = coverageDecision(names, Number(count));
  if (decision.action === "proven") {
    const runs = [...new Set(decision.parts.map((part) => readFileSync(join(directory, `proven-${part}.txt`), "utf8").trim()))];
    console.log(`Parts ${decision.parts.join(", ")} found ci.yml's coverage proof of this tree (run ${runs.join(", ")}); ` +
      `${Number(count) - decision.parts.length} ran here. The proof's run passed the whole suite under coverage with the thresholds: no merge.`);
  } else {
    console.log(`All ${count} parts ran here: merge them and enforce the thresholds.`);
  }
  console.log(`action=${decision.action}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `action=${decision.action}\n`);
}

// Run as a command whatever the path looks like (spaces, a symbolic link): a check that missed would print nothing, exit 0 and
// leave the gate without a decision. The workflows also require one of the two actions in the step's output.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.log(`::error title=Coverage::${error.message}`);
    process.exitCode = 1;
  }
}
