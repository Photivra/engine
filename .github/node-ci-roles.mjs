// SPDX-License-Identifier: Apache-2.0
// The Node.js roles of the CI matrix, derived from the reviewed lifecycle snapshot in
// node-lts-policy.mjs, and a check that `.github/workflows/ci.yml`, `publish.yml`,
// `NODE_SUPPORT.md` and `package.json` agree with them (Photivra/engine#231).
//
// Roles: the exact public minimum (`engines.node`), the maintained LTS majors, the Current
// major, the primary leg (Node 24, pinned to the tooling major since 2.20.0: coverage, static,
// documentation and package gates; its required check keeps the name `verify (lts/*)`) and the
// tooling major (`toolingNodeMajor`: typings and `publish.yml`). A `test` leg that resolves to
// the primary leg's major skips its test work (`--same-as-primary` in node-lts-lookahead.mjs);
// its required `verify` check still runs (owner decision for 2.20.0, #231; by major, not patch,
// since 2.28.0: ci-08 in #703).
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

export const primaryNodeMajor = 24;
export const primaryAlias = String(primaryNodeMajor);
// The primary leg's required check: named before the pin, and kept (renaming needs a ruleset change).
export const primaryCheckName = "verify (lts/*)";
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

// A workflow's text without its whole-line comments (YAML comments, and shell comments in `run:`
// blocks), so that a rule never reads a comment as a setting.
export function withoutCommentLines(workflowText) {
  return workflowText.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
}

// The jobs of a workflow, by id, each with the text of its block (the lines from `  <id>:` to
// the next line at two spaces' indent or less), comment lines left out.
export function workflowJobs(workflowText) {
  const lines = withoutCommentLines(workflowText).split("\n");
  const start = lines.indexOf("jobs:");
  assert.ok(start !== -1, "The workflow has no `jobs:`.");
  const jobs = new Map();
  let id, from;
  for (let i = start + 1; i <= lines.length; i++) {
    const header = i < lines.length ? /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]) : null;
    if (i === lines.length || header || (lines[i] !== "" && /^\S/.test(lines[i]))) {
      if (id) jobs.set(id, lines.slice(from, i).join("\n"));
      id = header?.[1];
      from = i;
      if (!header && i < lines.length) break;
    }
  }
  return jobs;
}

// The ids of the jobs that run as a matrix. GitHub keeps one value of a matrix job's output for
// the whole matrix (the one written last), so `needs.<matrix job>.outputs` reads one part's
// value as if it were the job's (#666).
export function matrixJobs(workflowText) {
  const isMatrix = (block) => {
    const lines = block.split("\n");
    const strategy = lines.indexOf("    strategy:");
    if (strategy === -1) return false;
    for (const line of lines.slice(strategy + 1)) {
      if (/^ {0,4}\S/.test(line)) return false;
      if (/^ {6}matrix:/.test(line)) return true;
    }
    return false;
  };
  return [...workflowJobs(workflowText)].filter(([, block]) => isMatrix(block)).map(([id]) => id);
}

// Rules on the workflow texts that are not about Node.js roles: each one guards a defect that a
// green run would not show. `errors` lists the broken rules.
export function workflowRuleErrors({ ciText, publishText, webgpuText }) {
  const errors = [];
  const workflows = { "ci.yml": ciText, "publish.yml": publishText, "webgpu.yml": webgpuText };
  for (const [file, text] of Object.entries(workflows)) {
    const matrix = matrixJobs(text);
    // Code only: whole-line comments and trailing ` # ...` comments are left out. Both spellings, needs.<job> and needs['<job>'].
    const code = withoutCommentLines(text).split("\n").map((line) => line.replace(/\s#\s.*$/, "")).join("\n");
    for (const [, dotted, quoted] of code.matchAll(/needs(?:\.([A-Za-z0-9_-]+)|\[\s*['"]([A-Za-z0-9_-]+)['"]\s*\])\.outputs\b/g)) {
      const job = dotted ?? quoted;
      if (matrix.includes(job)) errors.push(`${file} reads \`needs.${job}.outputs\`, but \`${job}\` is a matrix job: GitHub keeps one part's value for the whole matrix (#666).`);
    }
  }
  // #666: the coverage gates decide from the ten parts (a blob or a proof marker each), not from a count of blobs.
  for (const [file, text, job] of [["ci.yml", ciText, "verify-primary"], ["publish.yml", publishText, "coverage"]]) {
    const block = workflowJobs(text).get(job) ?? "";
    if (!/\n\s+node \.github\/coverage-parts\.mjs \.vitest-reports 10\n\s+grep -qxE 'action=\(merge\|proven\)' "\$GITHUB_OUTPUT"\n/.test(block))
      errors.push(`The coverage gate (${file}, job \`${job}\`) must decide from the ten parts with \`node .github/coverage-parts.mjs .vitest-reports 10\` and fail unless it printed \`action=merge\` or \`action=proven\` (#666).`);
    if (block.includes('test "$(find')) errors.push(`The coverage gate (${file}, job \`${job}\`) must not count blob files itself; .github/coverage-parts.mjs decides (#666).`);
    if (!/name: Merge the ten parts[^\n]*\n\s+if: [^\n]*steps\.parts\.outputs\.action == 'merge'/.test(block))
      errors.push(`The coverage gate (${file}, job \`${job}\`) must merge the parts only when .github/coverage-parts.mjs says \`merge\` (#666).`);
  }
  const shardJobs = [["ci.yml", ciText], ["publish.yml", publishText]];
  for (const [file, text] of shardJobs) {
    const block = workflowJobs(text).get("coverage-shard") ?? "";
    if (!/name: coverage-part-\$\{\{ matrix\.shard \}\}/.test(block) || !block.includes("proven-${{ matrix.shard }}.txt"))
      errors.push(`Each coverage shard (${file}) must upload one part, \`coverage-part-<k>\`: its blob or its proof marker (#666).`);
  }
  // A proven decision did not run the suite under coverage on this runner's release: it must name no new proof (#666).
  const verifyPrimary = workflowJobs(ciText).get("verify-primary") ?? "";
  if (!/id: proof-name\n\s+if: [^\n]*steps\.parts\.outputs\.action == 'merge'/.test(verifyPrimary))
    errors.push("`verify (lts/*)` must name the `coverage` proof only after a merge of ten blobs (#666).");
  // ci-20 (#703): a failed proof upload must not fail a job whose work passed. ci-21: no job of ci.yml sets job-level
  // `continue-on-error`, which leaves a failed job's check result `failure` (a required check still blocks) while it hides the
  // failure from the run's result.
  for (const [file, text] of [["ci.yml", ciText], ["webgpu.yml", webgpuText]])
    for (const [id, block] of workflowJobs(text)) {
      if (/^ {4}continue-on-error:/m.test(block)) errors.push(`${file}: job \`${id}\` must not set job-level \`continue-on-error\` (ci-21 in #703).`);
      for (const step of block.split(/\n(?= {6}- )/).filter((step) => /^ {6}- name: Keep the proof\s*$/m.test(step)))
        if (!/^ {8}continue-on-error: true\s*$/m.test(step)) errors.push(`${file}: the "Keep the proof" step of job \`${id}\` must set \`continue-on-error: true\` (ci-20 in #703).`);
    }
  // ci-19 (#703): with GitHub's default fail-fast, one matrix part's failure cancels its siblings, so which required checks show
  // `failure` and which `cancelled` depended on which job finished first. Every matrix job sets `fail-fast: false`.
  for (const [file, text] of Object.entries(workflows))
    for (const id of matrixJobs(text))
      if (!/^ {4}strategy:\n(?: {6}.*\n)*? {6}fail-fast: false[ \t]*$/m.test(workflowJobs(text).get(id)))
        errors.push(`${file}: matrix job \`${id}\` must set \`fail-fast: false\` in its \`strategy\` (ci-19 in #703).`);
  // #713: a release waits for every part of the WebGPU conformance suite on its tree, looked up on webgpu.yml's Node.js release.
  const conformance = workflowJobs(publishText).get("conformance") ?? "";
  const parts = [...(workflowJobs(webgpuText).get("webgpu-conformance") ?? "").matchAll(/^\s+- part: (\d+)\s*$/gm)].map((m) => m[1]);
  if (parts.length === 0) errors.push("webgpu.yml's `webgpu-conformance` job has no `part:` matrix entries.");
  for (const part of parts)
    if (!conformance.includes(`run: node .github/ci-proof.mjs find webgpu-swiftshader-${part} .github/workflows/webgpu.yml`))
      errors.push(`publish.yml's \`conformance\` job must look up the proof of WebGPU conformance part ${part} (#713).`);
  const lookups = [...conformance.matchAll(/find webgpu-swiftshader-(\d+) /g)].map((m) => m[1]);
  if (!/if \[ "\$FOUND" != "(true ?)+" \]/.test(conformance) || (conformance.match(/\$\{\{ steps\.part-\d+\.outputs\.found \}\}/g) ?? []).length !== lookups.length)
    errors.push("publish.yml's `conformance` job must fail unless every proof lookup found its proof (#713).");
  const selector = JSON.stringify(jobNodeVersions(webgpuText, "webgpu-conformance").setup);
  if (JSON.stringify(jobNodeVersions(publishText, "conformance").setup) !== selector)
    errors.push(`publish.yml's \`conformance\` job must set up Node.js as webgpu.yml does (${selector}): the proofs are named by its release (#713).`);
  // The runner image's cached release can differ from the newest one (two patch releases in one run, #666), and a proof is named by
  // the exact release: both sides take the newest release, so the lookup asks for the name the conformance run uploaded.
  for (const [file, text, job] of [["publish.yml", publishText, "conformance"], ["webgpu.yml", webgpuText, "webgpu-conformance"]]) {
    const setups = (workflowJobs(text).get(job) ?? "").split(/\n(?= {6}- )/).filter((step) => /uses: actions\/setup-node@/.test(step));
    if (setups.length === 0 || setups.some((step) => !/^ {10}check-latest: true\s*$/m.test(step)))
      errors.push(`${file}: every setup-node step of job \`${job}\` must set \`check-latest: true\`, so the proof lookup and the conformance run take the same, newest Node.js release (#713).`);
  }
  if (!/^ {4}needs: \[[^\]]*\bconformance\b[^\]]*\]/m.test(workflowJobs(publishText).get("publish") ?? ""))
    errors.push("publish.yml's `publish` job must need `conformance` (#713).");
  // A version that is already published passes only when the registry holds the verified tarball (its dist.integrity).
  const publishStep = (workflowJobs(publishText).get("publish") ?? "").split(/\n(?= {6}- )/).find((step) => /^ {6}- name: Publish\s*$/m.test(step)) ?? "";
  if (!publishStep.includes("dist.integrity") || !publishStep.includes("openssl dgst -sha512 -binary \"$TARBALL\""))
    errors.push("publish.yml's Publish step must compare the registry's `dist.integrity` with the verified tarball's SHA-512 before it treats a published version as done.");
  return errors;
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
  if (!ciText.includes(`name: ${primaryCheckName}`)) errors.push(`No required check named \`${primaryCheckName}\` for the primary leg.`);
  if (!/node-version: \$\{\{ steps\.newest\.outputs\.version \|\| matrix\.node-version \}\}/.test(ciText))
    errors.push("The `test` job must set up the resolved newest stable release for the `node` leg, else its matrix value.");

  // Every publish.yml job but `conformance` runs on the tooling major; that job only looks up webgpu.yml's proofs, which are
  // named by webgpu.yml's Node.js release, so it uses webgpu.yml's selector (checked in workflowRuleErrors, #713).
  const publishVersions = [...workflowJobs(publishText)].filter(([job]) => job !== "conformance")
    .flatMap(([, block]) => [...block.matchAll(/^\s+node-version:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]));
  if (publishVersions.length === 0 || publishVersions.some((v) => v !== String(roles.toolingMajor)))
    errors.push(`publish.yml must pin tooling major ${roles.toolingMajor}; found ${publishVersions.join(", ") || "none"}.`);

  const tableAliases = [...supportText.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  const aliasLegs = [roles.primary, ...legs.filter((leg) => !exactVersion.test(leg))];
  if (JSON.stringify([...tableAliases].sort()) !== JSON.stringify([...aliasLegs].sort()))
    errors.push(`NODE_SUPPORT.md's alias table (${tableAliases.join(", ")}) does not match the CI legs (${aliasLegs.join(", ")}).`);
  if (!supportText.includes(`Node ${roles.minimum} minimum`)) errors.push(`NODE_SUPPORT.md does not name the Node ${roles.minimum} minimum.`);
  if (!supportText.includes(`tooling major ${roles.toolingMajor}`)) errors.push(`NODE_SUPPORT.md does not name tooling major ${roles.toolingMajor}.`);

  const resolved = [...legs, roles.primary].map((leg) => ({ leg, major: resolveLeg(leg, at) }));
  const primaryMajor = resolveLeg(roles.primary, at);
  // A moving leg on the primary's major runs the primary's release: it must skip its test work.
  const onPrimary = resolved.filter(({ leg, major }) => leg !== roles.primary && !exactVersion.test(leg) && major === primaryMajor).map(({ leg }) => leg);
  const skips = ciText.includes("run: node .github/node-lts-lookahead.mjs --same-as-primary") &&
    /name: Test suite, this part\n\s+if: [^\n]*steps\.same\.outputs\.skip != 'true'/.test(ciText);
  if (!skips) errors.push("The `test` job must skip its test work on a leg that runs the primary leg's major (step `same`, `--same-as-primary`).");
  for (const { leg, major } of resolved)
    if (major === undefined || !supportedNodeMajors.includes(major))
      errors.push(`Leg ${leg} resolves to no supported, maintained Node line on ${at.toISOString().slice(0, 10)}.`);
  const required = [...new Set([...roles.maintainedLts, ...(roles.current === undefined ? [] : [roles.current])])];
  for (const major of required)
    if (!resolved.some((leg) => leg.major === major)) errors.push(`Supported Node ${major} has no CI leg.`);

  // Owner-decision findings: they cost runner time or leave a role open, but change nothing.
  const moving = resolved.filter(({ leg, major }) => major !== undefined && !exactVersion.test(leg));
  for (const major of new Set(moving.map((leg) => leg.major))) {
    // Legs on the primary's release skip their test work (above), so they do not run it twice.
    const same = moving.filter((leg) => leg.major === major && !(skips && onPrimary.includes(leg.leg))).map((leg) => leg.leg);
    if (same.length > 1) notices.push(`Legs ${same.join(" and ")} both test the newest Node ${major}: the same runtime twice.`);
  }
  if (primaryMajor !== undefined && primaryMajor !== roles.toolingMajor)
    notices.push(`The primary leg ${roles.primary} is Node ${primaryMajor}, not tooling major ${roles.toolingMajor} (typings and publish.yml).`);
  for (const major of required)
    if (!moving.some((leg) => leg.major === major))
      notices.push(`Node ${major} is tested only at its exact minimum ${roles.minimum}, not at its newest release.`);
  return { roles, legs: resolved, skipping: skips ? onPrimary : [], errors, notices };
}

export function readRepositoryFiles(root = new URL("../", import.meta.url)) {
  const read = (path) => readFileSync(new URL(path, root), "utf8");
  return {
    ciText: read(".github/workflows/ci.yml"),
    publishText: read(".github/workflows/publish.yml"),
    webgpuText: read(".github/workflows/webgpu.yml"),
    supportText: read("NODE_SUPPORT.md"),
    enginesNode: JSON.parse(read("package.json")).engines?.node
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = new Date();
  const files = readRepositoryFiles();
  const { legs, skipping, errors: drift, notices } = matrixDrift(files, at);
  const errors = [...drift, ...workflowRuleErrors(files)];
  log(`CI Node legs on ${at.toISOString().slice(0, 10)}: ${legs.map(({ leg, major }) => `${leg} → ${major ?? "none"}`).join(", ")}` +
    (skipping.length ? `; ${skipping.join(", ")} skip their test work (the primary leg's major).` : "."));
  for (const notice of notices) log(`::notice title=CI Node roles::${notice}`);
  for (const message of drift) error(`::error title=CI Node matrix drift::${message}`);
  for (const message of errors.slice(drift.length)) error(`::error title=CI workflow rule::${message}`);
  if (errors.length > 0) process.exitCode = 1;
  else log("The CI Node matrix matches the reviewed support policy, and the workflow rules hold.");
}
