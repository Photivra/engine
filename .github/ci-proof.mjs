// SPDX-License-Identifier: Apache-2.0
// Test-once proofs for CI (Photivra/engine#510).
//
// A CI job that passes every step uploads an empty artifact named by `proofName`: the tree
// it tested, the job and its runtime. A later run on the same tree and runtime (the merge
// queue after a pull request, or main after the queue) looks that name up and skips the work
// it already proved, instead of running the same tests on the same tree again.
//
//   node .github/ci-proof.mjs name <job>    prints name=<proof name> for this checkout
//   node .github/ci-proof.mjs find <job> [<workflow file>]
//                                            prints found=true|false (and run=<id>)
//
// A proof counts only when it was uploaded by the same workflow file (or the one given, as
// publish.yml asks for ci.yml's coverage proof) in a run of this
// repository (not a fork) that has not expired, that completed with success, whose event is a
// pull request, a merge-queue entry, or a push or manual run on main, and that ran on the tree
// the proof names: its head commit has that tree, or (a pull request, which tests its merge
// with the base) its head commit is a parent of the commit being checked, whose tree the
// proof names. So a run proves only its own tree, or a merge of its own pull request's head.
// Any doubt, an API error included, is found=false, so the job runs in full.
import console from "node:console";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export function proofName(tree, job, runtime) {
  if (!/^[0-9a-f]{40}$/.test(tree)) throw new Error(`not a tree SHA: ${tree}`);
  return `ci-proof-${tree}-${job}-${runtime}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

// Whether a run's event and branch may prove a tree (see the header).
export function provingEvent(run) {
  const branch = String(run.head_branch);
  switch (run.event) {
    case "pull_request": return true;
    case "merge_group": return branch.startsWith("gh-readonly-queue/main/");
    case "push": case "workflow_dispatch": return branch === "main";
    default: return false;
  }
}

// `tree` is the tree the proof names (the checked commit's tree), `parents` the checked commit's parent SHAs and `trees` maps a
// run's head commit SHA to its tree SHA.
export function acceptedRun(artifacts, runs, repositoryId, workflow, tree, trees, parents = []) {
  for (const artifact of artifacts) {
    if (artifact.expired) continue;
    const run = runs.get(artifact.workflow_run?.id);
    if (!run) continue;
    if (String(artifact.workflow_run.head_repository_id) !== String(repositoryId)) continue;
    if (String(run.head_repository?.id) !== String(repositoryId)) continue;
    if (String(run.path).split("@")[0] !== workflow) continue;
    if (run.status !== "completed" || run.conclusion !== "success" || !provingEvent(run)) continue;
    if (!/^[0-9a-f]{40}$/.test(String(tree))) continue;
    if (trees.get(run.head_sha) !== tree && !(run.event === "pull_request" && parents.includes(run.head_sha))) continue;
    return run.id;
  }
  return undefined;
}

function output(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function currentTree() {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
}

function currentName(job) {
  return proofName(currentTree(), job, process.version);
}

async function api(path) {
  const response = await globalThis.fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28"
    }
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function find(job, wanted) {
  const name = currentName(job);
  const repository = process.env.GITHUB_REPOSITORY;
  try {
    const { artifacts } = await api(`/repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=10`);
    const runs = new Map(), trees = new Map();
    for (const artifact of artifacts) {
      const id = artifact.workflow_run?.id;
      if (id && !runs.has(id)) runs.set(id, await api(`/repos/${repository}/actions/runs/${id}`));
    }
    for (const run of runs.values())
      if (/^[0-9a-f]{40}$/.test(String(run.head_sha)) && !trees.has(run.head_sha)) trees.set(run.head_sha, (await api(`/repos/${repository}/git/commits/${run.head_sha}`)).tree?.sha);
    const workflow = wanted ?? String(process.env.GITHUB_WORKFLOW_REF).split("@")[0].slice(repository.length + 1);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const parents = artifacts.length ? ((await api(`/repos/${repository}/git/commits/${head}`)).parents ?? []).map((p) => p.sha) : [];
    const run = acceptedRun(artifacts, runs, process.env.GITHUB_REPOSITORY_ID, workflow, currentTree(), trees, parents);
    if (run === undefined) {
      console.log(`No proof ${name}: this job runs in full.`);
      output("found", "false");
      return;
    }
    console.log(`Proof ${name} from run ${run}: this tree passed this job on ${process.version}; its work is skipped.`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Skipped: tree already passed this job on ${process.version} in run ${run} (${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${run}).\n`);
    }
    output("found", "true");
    output("run", run);
  } catch (error) {
    console.log(`Proof lookup failed (${error.message}): this job runs in full.`);
    output("found", "false");
  }
}

async function main([command, job, workflow]) {
  if (!job) throw new Error("usage: ci-proof.mjs name|find <job>");
  if (command === "name") output("name", currentName(job));
  else if (command === "find") await find(job, workflow);
  else throw new Error(`unknown command ${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
