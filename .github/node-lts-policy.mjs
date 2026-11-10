// SPDX-License-Identifier: Apache-2.0
// Upstream lifecycle reviewed 2026-10-02: https://github.com/nodejs/Release
import assert from "node:assert/strict";
import { log } from "node:console";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

export const supportedNodeMajors = Object.freeze([22, 24, 26]);
export const toolingNodeMajor = 24;
const ltsWindows = new Map([
  [22, ["2024-10-29", "2027-04-30"]],
  [24, ["2025-10-28", "2028-04-30"]],
  [26, ["2026-10-28", "2029-04-30"]]
]);

const currentWindows = new Map([
  [26, ["2026-05-05", "2026-10-28"]]
]);

// The LTS window opens at 00:00 UTC on the scheduled date, but Node publishes the first LTS
// build later that day: in https://nodejs.org/dist/index.json the first LTS build of every line
// from Node 4 to Node 24 is dated on its scheduled LTS date (0 days late, 11 of 11 lines), and
// setup-node can only offer it after that. For this many days from the LTS start, a build of
// that major without the marker is still accepted. Seven days is a margin over that record (a
// full week for a slipped release), not a measured delay; `node .github/node-lts-lookahead.mjs`,
// run by hand, reports 14 days ahead when it will end with no LTS build published.
export const ltsMarkerGraceDays = 7;
const dayMs = 86_400_000;

function withinWindow(window, at) {
  assert.ok(at instanceof Date && Number.isFinite(at.getTime()), "Invalid policy evaluation date.");
  if (!window) return false;
  const [start, end] = window.map((value) => Date.parse(`${value}T00:00:00Z`));
  return at.getTime() >= start && at.getTime() < end;
}

export function assertMaintainedLts(major, at = new Date()) {
  const window = ltsWindows.get(major);
  assert.ok(window, `Node ${major} is not an approved maintained LTS line; review NODE_SUPPORT.md.`);
  assert.ok(withinWindow(window, at), `Node ${major} is outside its approved LTS support window.`);
}

// The reviewed lifecycle on a date: the supported majors in an LTS window, newest first, and the
// supported major in its Current window, if any. `.github/node-ci-roles.mjs` derives the CI
// matrix roles from it.
export function lifecycleAt(at = new Date()) {
  const maintainedLts = supportedNodeMajors.filter((major) => withinWindow(ltsWindows.get(major), at)).sort((a, b) => b - a);
  const current = supportedNodeMajors.filter((major) => withinWindow(currentWindows.get(major), at)).sort((a, b) => b - a)[0];
  return { maintainedLts, current };
}

function withinLtsMarkerGrace(major, at) {
  const window = ltsWindows.get(major);
  if (!window) return false;
  const start = Date.parse(`${window[0]}T00:00:00Z`);
  return at.getTime() >= start && at.getTime() < start + ltsMarkerGraceDays * dayMs;
}

function pinnedMajor(version) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "Use a stable, exact Node/typings version, not a prerelease or open-ended range.");
  return Number(version.split(".")[0]);
}

export function assertSupportedRuntime(version, lts, at = new Date()) {
  const major = pinnedMajor(version);
  assert.ok(supportedNodeMajors.includes(major), `Node ${major} is not in this repository's tested support set.`);
  if (withinWindow(currentWindows.get(major), at)) {
    assert.equal(lts, undefined, "A Current Node build must not claim an LTS marker.");
  } else {
    assertMaintainedLts(major, at);
    if (lts === undefined && withinLtsMarkerGrace(major, at)) return;
    assert.ok(typeof lts === "string" && lts.length > 0, "An LTS Node build must carry its LTS marker.");
  }
}

export function assertSupportedTypes(version, at = new Date()) {
  assert.equal(pinnedMajor(version), toolingNodeMajor, `@types/node must stay on approved tooling major ${toolingNodeMajor}; major upgrades require coordinated review.`);
  assertMaintainedLts(toolingNodeMajor, at);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assertSupportedRuntime(process.versions.node, process.release.lts);
  assertSupportedTypes(manifest.devDependencies["@types/node"]);
  log(`Node support policy passed: Node ${process.versions.node}; @types/node ${manifest.devDependencies["@types/node"]}.`);
}
