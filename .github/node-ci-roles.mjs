// SPDX-License-Identifier: Apache-2.0
// The Node.js roles of the CI matrix, derived from the reviewed lifecycle snapshot in
// node-lts-policy.mjs, and a check that `.github/workflows/ci.yml`, `publish.yml`,
// `NODE_SUPPORT.md` and `package.json` agree with them (photivra/photivra#231).
//
// Roles: the exact public minimum (`engines.node`), the maintained LTS majors, the Current
// major, the primary leg (`lts/*`: coverage, static, documentation and package gates) and the
// tooling major (`toolingNodeMajor`: typings and `publish.yml`).
//
// The alias resolution here is a model of setup-node's aliases over the reviewed snapshot,
// not a lookup of Node's release index: `lts/*` is the newest major in an LTS window, `lts/-N`
// the N-th before it, `node` the major in its Current window (the newest LTS when there is
// none). A major the snapshot does not know (an unreviewed new Current line) is invisible to
// it; the policy guard in every CI job catches that one at run time.
//
// `node .github/node-ci-roles.mjs` checks the repository's files for today: drift fails, and
// the findings that need an owner decision (two legs on one major, a primary leg off the
// tooling major, a maintained line tested only at its exact minimum) print as notices.
import assert from "node:assert/strict";
import { error, log } from "node:console";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";
import { lifecycleAt, supportedNodeMajors, toolingNodeMajor } from "./node-lts-policy.mjs";

export const primaryAlias = "lts/*";
const exactVersion = /^\d+\.\d+\.\d+$/;

// The `node-version` values of one job of a workflow: the matrix list, if any, and every
// scalar `node-version:` (a setup-node input). Handles the shapes the workflows use: a flow
// list (`[a, b]`), a block list (`- a` lines) and a scalar; fails closed on a missing job.
export function jobNodeVersions(workflowText, job) {
  const lines = workflowText.split("\n");
  const start = lines.findIndex((line) => line === `  ${job}:`);
  assert.ok(start !== -1, `The workflow has no job \`${job}\`.`);
  let end = lines.findIndex((line, i) => i > start && /^ {0,2}\S/.test(line));
  if (end === -1) end = lines.length;
  const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, "$2");
  let matrix;
  const setup = [];
  for (let i = start + 1; i < end; i++) {
    const match = /^(\s+)node-version:\s*(.*?)\s*$/.exec(lines[i]);
    if (!match || lines[i].trim().startsWith("#")) continue;
    const [, indent, value] = match;
    if (value.startsWith("[")) {
      assert.ok(value.endsWith("]"), `Unreadable node-version list in job \`${job}\`.`);
      matrix = value.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else if (value === "") {
      matrix = [];
      for (let k = i + 1; k < end; k++) {
        const line = lines[k];
        if (line.trim() === "" || line.trim().startsWith("#")) continue;
        const item = /^(\s+)-\s+(.*?)\s*$/.exec(line);
        if (!item || item[1].length <= indent.length) break;
        matrix.push(unquote(item[2]));
      }
    } else {
      setup.push(unquote(value));
    }
  }
  return { matrix, setup };
}

// The supported major an alias stands for on a date, or undefined (none, or an EOL exact
// version). Exact versions keep their major only while that major is in a reviewed window.
export function resolveLeg(alias, at = new Date()) {
  const { maintainedLts, current } = lifecycleAt(at);
  if (alias === "node") return current ?? maintainedLts[0];
  if (alias === "lts/*") return maintainedLts[0];
  const older = /^lts\/-(\d+)$/.exec(alias);
  if (older) return maintainedLts[Number(older[1])];
  const major = /^(\d+)(?:\.\d+\.\d+)?$/.exec(alias);
  assert.ok(major, `Unknown Node version selector \`${alias}\`; use lts/*, lts/-N, node, a major or the exact minimum.`);
  const value = Number(major[1]);
  return value === current || maintainedLts.includes(value) ? value : undefined;
}

// The roles on a date, from the policy snapshot and the `engines.node` minimum.
export function ciNodeRoles(enginesNode, at = new Date()) {
  const minimum = /^>=\s*(\d+\.\d+\.\d+)$/.exec(enginesNode ?? "")?.[1];
  assert.ok(minimum, `engines.node must be an exact minimum (">=x.y.z"), not \`${enginesNode}\`.`);
  const { maintainedLts, current } = lifecycleAt(at);
  return { minimum, maintainedLts, current, primary: primaryAlias, toolingMajor: toolingNodeMajor };
}

// Compares the files with the roles. `errors` is drift (the check fails); `notices` are
// findings for an owner decision (the check passes and reports them).
export function matrixDrift({ ciText, publishText, supportText, enginesNode }, at = new Date()) {
  const errors = [];
  const notices = [];
  const roles = ciNodeRoles(enginesNode, at);
  const test = jobNodeVersions(ciText, "test");
  const verify = jobNodeVersions(ciText, "verify");
  const legs = test.matrix ?? [];
  if (legs.length === 0) errors.push("The `test` job has no node-version matrix.");
  if (JSON.stringify(verify.matrix) !== JSON.stringify(legs))
    errors.push(`The required \`verify\` checks (${verify.matrix?.join(", ")}) do not match the \`test\` matrix (${legs.join(", ")}).`);
  if (legs.includes(roles.primary)) errors.push(`The primary leg ${roles.primary} must not also be a \`test\` matrix leg.`);

  const exact = legs.filter((leg) => exactVersion.test(leg));
  if (exact.length !== 1 || exact[0] !== roles.minimum)
    errors.push(`The only exact-version leg must be the engines.node minimum ${roles.minimum}; found ${exact.join(", ") || "none"}. No point-release legs.`);

  for (const job of ["coverage-shard", "verify-primary"]) {
    const { setup } = jobNodeVersions(ciText, job);
    if (setup.length !== 1 || setup[0] !== roles.primary)
      errors.push(`Job \`${job}\` must run on the primary leg ${roles.primary}; found ${setup.join(", ") || "none"}.`);
  }
  if (!ciText.includes(`name: verify (${roles.primary})`)) errors.push(`No required check named \`verify (${roles.primary})\`.`);
  if (!/node-version: \$\{\{ steps\.newest\.outputs\.version \|\| matrix\.node-version \}\}/.test(ciText))
    errors.push("The `test` job must set up the resolved newest stable release for the `node` leg, else its matrix value.");

  const publishVersions = [...publishText.matchAll(/^\s+node-version:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  if (publishVersions.length === 0 || publishVersions.some((v) => v !== String(roles.toolingMajor)))
    errors.push(`publish.yml must pin tooling major ${roles.toolingMajor}; found ${publishVersions.join(", ") || "none"}.`);

  const tableAliases = [...supportText.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  const aliasLegs = [roles.primary, ...legs.filter((leg) => !exactVersion.test(leg))];
  if (JSON.stringify([...tableAliases].sort()) !== JSON.stringify([...aliasLegs].sort()))
    errors.push(`NODE_SUPPORT.md's alias table (${tableAliases.join(", ")}) does not match the CI legs (${aliasLegs.join(", ")}).`);
  if (!supportText.includes(`Node ${roles.minimum} minimum`)) errors.push(`NODE_SUPPORT.md does not name the Node ${roles.minimum} minimum.`);
  if (!supportText.includes(`tooling major ${roles.toolingMajor}`)) errors.push(`NODE_SUPPORT.md does not name tooling major ${roles.toolingMajor}.`);

  const resolved = [...legs, roles.primary].map((leg) => ({ leg, major: resolveLeg(leg, at) }));
  for (const { leg, major } of resolved)
    if (major === undefined || !supportedNodeMajors.includes(major))
      errors.push(`Leg ${leg} resolves to no supported, maintained Node line on ${at.toISOString().slice(0, 10)}.`);
  const required = [...new Set([...roles.maintainedLts, ...(roles.current === undefined ? [] : [roles.current])])];
  for (const major of required)
    if (!resolved.some((leg) => leg.major === major)) errors.push(`Supported Node ${major} has no CI leg.`);

  // Owner-decision findings: they cost runner time or leave a role open, but change nothing.
  const moving = resolved.filter(({ leg, major }) => major !== undefined && !exactVersion.test(leg));
  for (const major of new Set(moving.map((leg) => leg.major))) {
    const same = moving.filter((leg) => leg.major === major).map((leg) => leg.leg);
    if (same.length > 1) notices.push(`Legs ${same.join(" and ")} both test the newest Node ${major}: the same runtime twice.`);
  }
  const primaryMajor = resolveLeg(roles.primary, at);
  if (primaryMajor !== undefined && primaryMajor !== roles.toolingMajor)
    notices.push(`The primary leg ${roles.primary} is Node ${primaryMajor}, not tooling major ${roles.toolingMajor} (typings and publish.yml).`);
  for (const major of required)
    if (!moving.some((leg) => leg.major === major))
      notices.push(`Node ${major} is tested only at its exact minimum ${roles.minimum}, not at its newest release.`);
  return { roles, legs: resolved, errors, notices };
}

export function readRepositoryFiles(root = new URL("../", import.meta.url)) {
  const read = (path) => readFileSync(new URL(path, root), "utf8");
  return {
    ciText: read(".github/workflows/ci.yml"),
    publishText: read(".github/workflows/publish.yml"),
    supportText: read("NODE_SUPPORT.md"),
    enginesNode: JSON.parse(read("package.json")).engines?.node
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = new Date();
  const { legs, errors, notices } = matrixDrift(readRepositoryFiles(), at);
  log(`CI Node legs on ${at.toISOString().slice(0, 10)}: ${legs.map(({ leg, major }) => `${leg} → ${major ?? "none"}`).join(", ")}.`);
  for (const notice of notices) log(`::notice title=CI Node roles::${notice}`);
  for (const message of errors) error(`::error title=CI Node matrix drift::${message}`);
  if (errors.length > 0) process.exitCode = 1;
  else log("The CI Node matrix matches the reviewed support policy.");
}
