// SPDX-License-Identifier: Apache-2.0
// Node release-index helpers for the support policy. `--newest-stable` gives CI's `node` leg its
// version; `--same-as-primary` tells a `test` leg whether its runtime is the primary leg's release
// (the newest stable build of primaryNodeMajor), so it can skip work the primary leg does (#231). Without arguments it evaluates the newest published build of each supported major
// against node-lts-policy.mjs for today and the next days, so a date boundary (an LTS start,
// the end of the LTS marker grace period, an end of life) can be checked before it fails the
// required CI checks; run it by hand (`node .github/node-lts-lookahead.mjs`), for example
// before a release. No scheduled workflow runs it.
import assert from "node:assert/strict";
import { error, log } from "node:console";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { assertSupportedRuntime, supportedNodeMajors } from "./node-lts-policy.mjs";
import { primaryNodeMajor } from "./node-ci-roles.mjs";

export const nodeReleaseIndexUrl = "https://nodejs.org/dist/index.json";
export const lookAheadDays = 14;
const dayMs = 86_400_000;

function parseRelease(release) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(release?.version ?? "");
  if (!match) return undefined;
  return { version: match[0].slice(1), parts: match.slice(1).map(Number), lts: release.lts || undefined };
}

// The newest stable release of a major, by version number rather than by list order.
export function newestRelease(releases, major) {
  let newest;
  for (const release of releases.map(parseRelease)) {
    if (!release || release.parts[0] !== major) continue;
    if (!newest || release.parts[1] > newest.parts[1] || (release.parts[1] === newest.parts[1] && release.parts[2] > newest.parts[2]))
      newest = release;
  }
  return newest;
}

// The newest stable release of any major: what the CI `node` leg tests. setup-node's own `node`
// alias takes the first entry of the index, which can be a prerelease (v27.0.0-alpha.0.0.0 was
// listed first on 2026-10-29, #510), and the policy guard rightly refuses a prerelease.
export function newestStableRelease(releases) {
  let newest;
  for (const release of releases.map(parseRelease)) {
    if (!release) continue;
    const i = newest ? release.parts.findIndex((part, k) => part !== newest.parts[k]) : -1;
    if (!newest || (i !== -1 && release.parts[i] > newest.parts[i])) newest = release;
  }
  return newest;
}

// True when a leg's runtime is exactly the primary leg's release (#231: it then skips its test work).
export function sameRelease(runtimeVersion, primaryVersion) {
  return runtimeVersion.replace(/^v/, "") === primaryVersion.replace(/^v/, "");
}

// Evaluates the policy at 00:00 UTC of `from`'s date and of each of the next `days` dates (the
// policy's windows change only at 00:00 UTC). Returns the first failing date of each major.
export function lookAheadFailures(releases, from = new Date(), days = lookAheadDays) {
  assert.ok(Array.isArray(releases), "The Node release index must be an array.");
  assert.ok(from instanceof Date && Number.isFinite(from.getTime()), "Invalid look-ahead start date.");
  const firstDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const failures = [];
  for (const major of supportedNodeMajors) {
    const newest = newestRelease(releases, major);
    for (let day = 0; day <= days; day++) {
      const at = new Date(firstDay + day * dayMs);
      const date = at.toISOString().slice(0, 10);
      if (!newest) {
        failures.push({ major, date, version: undefined, reason: `No stable Node ${major} release is published.` });
        break;
      }
      try {
        assertSupportedRuntime(newest.version, newest.lts, at);
      } catch (failure) {
        failures.push({ major, date, version: newest.version, reason: failure.message });
        break;
      }
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const response = await globalThis.fetch(nodeReleaseIndexUrl);
  assert.ok(response.ok, `Fetching ${nodeReleaseIndexUrl} failed: HTTP ${response.status}.`);
  const releases = await response.json();
  if (process.argv[2] === "--newest-stable") {
    // `node .github/node-lts-lookahead.mjs --newest-stable` prints version=<x.y.z> for CI.
    const newest = newestStableRelease(releases);
    assert.ok(newest, "The Node release index lists no stable release.");
    log(`version=${newest.version}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${newest.version}\n`);
    process.exit(0);
  }
  if (process.argv[2] === "--same-as-primary") {
    // Prints skip=true when this runtime is the release the primary leg (setup-node "<primaryNodeMajor>") installs.
    const primary = newestRelease(releases, primaryNodeMajor);
    assert.ok(primary, `The Node release index lists no stable Node ${primaryNodeMajor} release.`);
    const skip = sameRelease(process.versions.node, primary.version);
    log(`This leg runs Node ${process.versions.node}; the primary leg runs Node ${primary.version}: skip=${skip}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\n`);
    process.exit(0);
  }
  const from = new Date();
  const failures = lookAheadFailures(releases, from);
  for (const { major, date, version, reason } of failures)
    error(`::error title=Node ${major} support policy::From ${date}, Node ${major} (newest published build ${version ?? "none"}) fails the support policy: ${reason}`);
  if (failures.length > 0) {
    process.exitCode = 1;
  } else {
    const newest = supportedNodeMajors.map((major) => `${major}: ${newestRelease(releases, major).version}`).join(", ");
    log(`Node support policy look-ahead passed from ${from.toISOString().slice(0, 10)} for ${lookAheadDays} days (newest builds ${newest}).`);
  }
}
