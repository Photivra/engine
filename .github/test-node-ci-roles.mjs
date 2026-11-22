// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { ciNodeRoles, jobNodeVersions, matrixDrift, matrixJobs, readRepositoryFiles, resolveLeg, workflowJobs, workflowRuleErrors } from "./node-ci-roles.mjs";
import { lifecycleAt } from "./node-lts-policy.mjs";

const files = readRepositoryFiles();
// Dates on each side of the reviewed lifecycle transitions (node-lts-policy.mjs).
const beforeNode26Lts = new Date("2026-10-02T12:00:00Z");
const afterNode26Lts = new Date("2026-11-09T12:00:00Z");
const afterNode22Eol = new Date("2027-04-30T00:00:00Z");
const edit = (change) => ({ ...files, ...change(files) });
const errorsOf = (change, at = afterNode26Lts) => matrixDrift(edit(change), at).errors;

test("the lifecycle snapshot gives the maintained LTS majors newest first and the Current major", () => {
  assert.deepEqual(lifecycleAt(beforeNode26Lts), { maintainedLts: [24, 22], current: 26 });
  assert.deepEqual(lifecycleAt(afterNode26Lts), { maintainedLts: [26, 24, 22], current: undefined });
  assert.deepEqual(lifecycleAt(afterNode22Eol), { maintainedLts: [26, 24], current: undefined });
});
test("the roles come from engines.node and the policy", () => {
  assert.deepEqual(ciNodeRoles(">=22.13.0", afterNode26Lts), { minimum: "22.13.0", maintainedLts: [26, 24, 22], current: undefined, primary: "24", toolingMajor: 24 });
  assert.throws(() => ciNodeRoles("^22.13.0", afterNode26Lts), /exact minimum/);
});
test("aliases resolve over the snapshot through the lifecycle transitions", () => {
  const at = (date) => ["lts/*", "lts/-1", "lts/-2", "node", "22.13.0", "24"].map((alias) => resolveLeg(alias, date));
  assert.deepEqual(at(beforeNode26Lts), [24, 22, undefined, 26, 22, 24]);
  assert.deepEqual(at(afterNode26Lts), [26, 24, 22, 26, 22, 24]);
  assert.deepEqual(at(afterNode22Eol), [26, 24, undefined, 26, undefined, 24]);
  assert.throws(() => resolveLeg("latest", afterNode26Lts), /Unknown Node version selector/);
});
test("the workflow reader takes block lists, flow lists and setup inputs, and fails closed", () => {
  assert.deepEqual(jobNodeVersions(files.ciText, "test").matrix, ["22.13.0", "lts/-1", "node"]);
  assert.deepEqual(jobNodeVersions(files.ciText, "verify").matrix, ["22.13.0", "lts/-1", "node"]);
  assert.deepEqual(jobNodeVersions(files.ciText, "coverage-shard"), { matrix: undefined, setup: ["24"] });
  assert.throws(() => jobNodeVersions(files.ciText, "no-such-job"), /no job/);
});

test("the repository's CI, publish workflow, NODE_SUPPORT.md and engines.node agree", () => {
  for (const at of [beforeNode26Lts, afterNode26Lts]) assert.deepEqual(matrixDrift(files, at).errors, []);
});
test("before Node 26 entered LTS every leg tested a different line", () => {
  const { legs, notices } = matrixDrift(files, beforeNode26Lts);
  assert.deepEqual(legs.map(({ major }) => major), [22, 22, 26, 24]);
  assert.deepEqual(notices, []);
});
test("since Node 26 entered LTS the lts/-1 leg runs the primary leg's Node 24 and skips its test work; node tests Node 26", () => {
  const { legs, skipping, notices } = matrixDrift(files, afterNode26Lts);
  assert.deepEqual(legs.map(({ leg, major }) => leg + ":" + major), ["22.13.0:22", "lts/-1:24", "node:26", "24:24"]);
  assert.deepEqual(skipping, ["lts/-1"]);
  assert.deepEqual(notices, ["Node 22 is tested only at its exact minimum 22.13.0, not at its newest release."]);
});
test("a leg on the primary leg's major must skip its test work", () => {
  const unskipped = edit(({ ciText }) => ({ ciText: ciText.replace(/(name: Test suite, this part\n\s+if: [^\n]*?) && steps\.same\.outputs\.skip != 'true'/, "$1") }));
  assert.match(matrixDrift(unskipped, afterNode26Lts).errors.join("\n"), /must skip its test work/);
});
test("the leg compares its runtime's major with the primary leg's major, with no network call (ci-08 in #703)", async () => {
  const { sameRelease } = await import("./node-lts-lookahead.mjs");
  assert.equal(sameRelease("24.19.0", 24), true);
  assert.equal(sameRelease("v24.19.0", 24), true);
  // Two patches of one major on the hosted images during a roll-out are one release line for this decision.
  assert.equal(sameRelease("24.18.0", 24), true);
  assert.equal(sameRelease("24.22.2"), true);
  assert.equal(sameRelease("26.13.0", 24), false);
  assert.equal(sameRelease("2.4.0", 24), false);
  const source = readFileSync(new URL("./node-lts-lookahead.mjs", import.meta.url), "utf8");
  const sameBranch = source.slice(source.indexOf('"--same-as-primary"'), source.indexOf("const response = await globalThis.fetch"));
  assert.ok(source.indexOf('"--same-as-primary"') < source.indexOf("globalThis.fetch"), "--same-as-primary must be decided before the release index is fetched");
  assert.doesNotMatch(sameBranch, /fetch|releases/);
});
test("at Node 22's end of life the minimum leg fails until engines.node rises", () => {
  assert.match(matrixDrift(files, afterNode22Eol).errors.join("\n"), /Leg 22\.13\.0 resolves to no supported/);
  const raised = edit(({ ciText, supportText }) => ({
    enginesNode: ">=24.11.0",
    ciText: ciText.replaceAll('"22.13.0"', '"24.11.0"'),
    supportText: supportText.replace("Node 22.13.0 minimum", "Node 24.11.0 minimum")
  }));
  assert.deepEqual(matrixDrift(raised, afterNode22Eol).errors, []);
});

test("drift between the workflow and the policy fails", () => {
  const cases = [
    [({ ciText }) => ({ ciText: ciText.replace('node-version: ["22.13.0", "lts/-1", "node"]', 'node-version: ["22.13.0", "node"]') }), /required `verify` checks/],
    [({ ciText }) => ({ ciText: ciText.replace('- "lts/-1"', '- "lts/-1"\n          - "24.1.0"') }), /only exact-version leg/],
    [({ ciText }) => ({ ciText: ciText.replace('- "22.13.0"', '- "22.14.0"') }), /only exact-version leg must be the engines.node minimum 22\.13\.0/],
    [() => ({ enginesNode: ">=22.14.0" }), /engines.node minimum 22\.14\.0/],
    [({ ciText }) => ({ ciText: ciText.replace('- "lts/-1"', '- "24"').replace('"lts/-1", "node"]', '"24", "node"]') }), /must not also be a `test` matrix leg/],
    [({ ciText }) => ({ ciText: ciText.replace('- "node"', '- "lts/-2"').replace('"lts/-1", "node"]', '"lts/-1", "lts/-2"]') }), /Supported Node 26 has no CI leg/],
    [({ ciText }) => ({ ciText: ciText.replace(/(coverage-shard:[\s\S]*?node-version: )"24"/, '$1"lts/*"') }), /`coverage-shard` must run on the primary leg/],
    [({ publishText }) => ({ publishText: publishText.replace('node-version: "24"', 'node-version: "lts/*"') }), /publish.yml must pin tooling major 24/],
    [({ supportText }) => ({ supportText: supportText.replace("| `lts/-1` |", "| `lts/-2` |") }), /alias table/]
  ];
  for (const [change, expected] of cases) assert.match(errorsOf(change).join("\n"), expected);
});

const ruleErrorsOf = (change) => workflowRuleErrors(edit(change)).join("\n");
test("the workflow reader finds each job and the matrix jobs", () => {
  assert.deepEqual([...workflowJobs(files.publishText).keys()].slice(0, 3), ["verify", "coverage-shard", "coverage"]);
  assert.deepEqual(matrixJobs(files.ciText), ["test", "verify", "coverage-shard"]);
  assert.deepEqual(matrixJobs(files.publishText), ["coverage-shard"]);
});
test("the rule reader skips comments: a commented job, matrix or output read is not one", () => {
  const text = "jobs:\n# a comment at column 0\n  a:\n    # strategy:\n    #   matrix:\n    runs-on: x\n  b:\n    strategy:\n      # fail-fast: false\n      matrix:\n        k: [1]\n";
  assert.deepEqual([...workflowJobs(text).keys()], ["a", "b"]);
  assert.deepEqual(matrixJobs(text), ["b"]);
  const comment = (publishText) => publishText.replace("    steps:\n", "    # needs.coverage-shard.outputs.proven was read here before #666\n    steps:\n");
  assert.deepEqual(workflowRuleErrors(edit(({ publishText }) => ({ publishText: comment(publishText) }))), []);
  assert.match(ruleErrorsOf(({ publishText }) => ({ publishText: publishText.replace("if: steps.parts.outputs.action == 'merge'", "if: needs['coverage-shard'].outputs.proven != 'true'") })),
    /reads `needs\.coverage-shard\.outputs`/);
});
test("the workflow rules hold for the repository's workflows", () => {
  assert.deepEqual(workflowRuleErrors(files), []);
});
test("a gate that reads a matrix job's output, or counts blobs instead of deciding from the parts, fails (#666)", () => {
  const cases = [
    [({ publishText }) => ({ publishText: publishText.replace("if: steps.parts.outputs.action == 'merge'", "if: needs.coverage-shard.outputs.proven != 'true'") }), /reads `needs\.coverage-shard\.outputs`/],
    [({ ciText }) => ({ ciText: ciText.replace("node .github/coverage-parts.mjs .vitest-reports 10\n", 'test "$(find .vitest-reports -name \'blob-*\' | wc -l)" = "10"\n') }), /\(ci\.yml, job `verify-primary`\) must decide from the ten parts[\s\S]*must not count blob files/],
    [({ publishText }) => ({ publishText: publishText.replace("node .github/coverage-parts.mjs .vitest-reports 10\n", "true\n") }), /\(publish\.yml, job `coverage`\) must decide from the ten parts/],
    [({ publishText }) => ({ publishText: publishText.replace(/\n\s+grep -qxE 'action=\(merge\|proven\)' "\$GITHUB_OUTPUT"/, "") }), /\(publish\.yml, job `coverage`\) must decide[^\n]*fail unless it printed/],
    [({ publishText }) => ({ publishText: publishText.replace(/(name: Merge the ten parts[^\n]*\n\s+)if: [^\n]*/, "$1if: always()") }), /\(publish\.yml, job `coverage`\) must merge the parts only when/],
    [({ ciText }) => ({ ciText: ciText.replace("name: coverage-part-${{ matrix.shard }}", "name: coverage-blob-${{ matrix.shard }}") }), /Each coverage shard \(ci\.yml\) must upload one part/],
    [({ ciText }) => ({ ciText: ciText.replace(/(id: proof-name\n\s+if: [^\n]*?) && steps\.parts\.outputs\.action == 'merge'/, "$1") }), /must name the `coverage` proof only after a merge/]
  ];
  for (const [change, expected] of cases) assert.match(ruleErrorsOf(change), expected);
});
test("a release that does not wait for every part of the WebGPU conformance suite fails (#713)", () => {
  const cases = [
    [({ publishText }) => ({ publishText: publishText.replace(/\n {6}- name: Proof of conformance part 3\n(?: {8}.*\n)+/, "\n") }), /look up the proof of WebGPU conformance part 3/],
    [({ webgpuText }) => ({ webgpuText: webgpuText.replace('            files: "test/webgpu/display-view-neighbors"', '            files: "test/webgpu/display-view-neighbors"\n          - part: 4\n            files: "x"') }), /look up the proof of WebGPU conformance part 4/],
    [({ publishText }) => ({ publishText: publishText.replace(' ${{ steps.part-3.outputs.found }}', "") }), /must fail unless every proof lookup found its proof/],
    [({ publishText }) => ({ publishText: publishText.replace(/(Use Node\.js as webgpu\.yml does\n[\s\S]*?node-version: )"lts\/\*"/, '$1"24"') }), /must set up Node\.js as webgpu\.yml does/],
    [({ publishText }) => ({ publishText: publishText.replace("needs: [verify, coverage, conformance]", "needs: [verify, coverage]") }), /`publish` job must need `conformance`/],
    [({ publishText }) => ({ publishText: publishText.replace(/dist\.integrity/g, "version") }), /Publish step must compare the registry's `dist\.integrity`/],
    [({ publishText }) => ({ publishText: publishText.replace("          check-latest: true\n", "") }), /publish\.yml: every setup-node step of job `conformance` must set `check-latest: true`/],
    [({ webgpuText }) => ({ webgpuText: webgpuText.replace("          check-latest: true\n", "") }), /webgpu\.yml: every setup-node step of job `webgpu-conformance` must set `check-latest: true`/]
  ];
  for (const [change, expected] of cases) assert.match(ruleErrorsOf(change), expected);
  // The conformance job's own selector is not the tooling-major pin that every other publish.yml job keeps.
  assert.deepEqual(matrixDrift(files, afterNode26Lts).errors, []);
});
test("a proof upload that can fail a passing job, or a job that hides its failure, fails (ci-20 and ci-21 in #703)", () => {
  assert.equal((files.ciText.match(/- name: Keep the proof\n(?: {8}#.*\n)* {8}continue-on-error: true\n/g) ?? []).length, 4);
  const cases = [
    [({ ciText }) => ({ ciText: ciText.replace(/(- name: Keep the proof\n(?: {8}#.*\n)*) {8}continue-on-error: true\n/, "$1") }), /"Keep the proof" step of job `test` must set `continue-on-error: true`/],
    [({ webgpuText }) => ({ webgpuText: webgpuText.replace("        continue-on-error: true\n", "") }), /webgpu\.yml: the "Keep the proof" step of job `webgpu-conformance`/],
    [({ ciText }) => ({ ciText: ciText.replace("    runs-on: macos-latest\n", "    runs-on: macos-latest\n    continue-on-error: true\n") }), /job `hash-locks-macos` must not set job-level `continue-on-error`/]
  ];
  for (const [change, expected] of cases) assert.match(ruleErrorsOf(change), expected);
});
test("every matrix job of ci.yml sets fail-fast: false, so one line's failure cancels no other line (ci-19 in #703)", () => {
  assert.deepEqual(matrixJobs(files.ciText), ["test", "verify", "coverage-shard"]);
  for (const job of matrixJobs(files.ciText)) assert.match(workflowJobs(files.ciText).get(job), /^ {4}strategy:\n(?: {6}#.*\n)* {6}fail-fast: false\n/m, job);
  const cases = [
    [({ ciText }) => ({ ciText: ciText.replace(/(\n {2}verify:\n[\s\S]*?\n {4}strategy:\n(?: {6}#.*\n)*) {6}fail-fast: false\n/, "$1") }), /ci\.yml: matrix job `verify` must set `fail-fast: false`/],
    [({ ciText }) => ({ ciText: ciText.replace(/(\n {2}test:\n[\s\S]*?\n {4}strategy:\n(?: {6}#.*\n)*) {6}fail-fast: false\n/, "$1") }), /ci\.yml: matrix job `test` must set `fail-fast: false`/],
    [({ ciText }) => ({ ciText: ciText.replace(/(\n {2}coverage-shard:\n[\s\S]*?\n {4}strategy:\n(?: {6}#.*\n)*) {6}fail-fast: false\n/, "$1      # fail-fast: false\n") }), /matrix job `coverage-shard` must set `fail-fast: false`/],
    [({ ciText }) => ({ ciText: ciText.replace(/(\n {2}verify:\n[\s\S]*?\n {4}strategy:\n(?: {6}#.*\n)*) {6}fail-fast: false\n/, "$1      fail-fast: true\n") }), /matrix job `verify` must set `fail-fast: false`/]
  ];
  for (const [change, expected] of cases) assert.match(ruleErrorsOf(change), expected);
});
