// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { ciNodeRoles, jobNodeVersions, matrixDrift, readRepositoryFiles, resolveLeg } from "./node-ci-roles.mjs";
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
  assert.deepEqual(ciNodeRoles(">=22.13.0", afterNode26Lts), { minimum: "22.13.0", maintainedLts: [26, 24, 22], current: undefined, primary: "lts/*", toolingMajor: 24 });
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
  assert.deepEqual(jobNodeVersions(files.ciText, "coverage-shard"), { matrix: undefined, setup: ["lts/*"] });
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
test("since Node 26 entered LTS the node and lts/* legs converge and the primary leg left the tooling major", () => {
  assert.deepEqual(matrixDrift(files, afterNode26Lts).notices, [
    "Legs node and lts/* both test the newest Node 26: the same runtime twice.",
    "The primary leg lts/* is Node 26, not tooling major 24 (typings and publish.yml).",
    "Node 22 is tested only at its exact minimum 22.13.0, not at its newest release."
  ]);
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
    [({ ciText }) => ({ ciText: ciText.replace('- "lts/-1"', '- "lts/*"') }), /must not also be a `test` matrix leg/],
    [({ ciText }) => ({ ciText: ciText.replace('- "lts/-1"', '- "lts/-2"').replace('"lts/-1", "node"]', '"lts/-2", "node"]') }), /Supported Node 24 has no CI leg/],
    [({ ciText }) => ({ ciText: ciText.replace(/(coverage-shard:[\s\S]*?node-version: )"lts\/\*"/, '$1"24"') }), /`coverage-shard` must run on the primary leg/],
    [({ publishText }) => ({ publishText: publishText.replace('node-version: "24"', 'node-version: "lts/*"') }), /publish.yml must pin tooling major 24/],
    [({ supportText }) => ({ supportText: supportText.replace("| `lts/-1` |", "| `lts/-2` |") }), /alias table/]
  ];
  for (const [change, expected] of cases) assert.match(errorsOf(change).join("\n"), expected);
});
