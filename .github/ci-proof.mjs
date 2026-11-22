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
// pull request into main (its run lists only pull requests into main, or, once merged or closed, every
// pull request with its head commit is into main), a merge-queue entry, a push or manual run on main, or
// a manual run on a release tag that names the run's head commit (`gh workflow run webgpu.yml --ref <tag>`,
// CONTRIBUTING.md), and that ran on the tree
// the proof names: its head commit has that tree, or (a pull request, which tests its merge
// with the base) its head commit is a parent of the commit being checked, whose tree the
// proof names. So a run proves only its own tree, or a merge of its own pull request's head.
// Any doubt, an API error included, is found=false, so the job runs in full.
import console from "node:console";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function proofName(tree, job, runtime) {
  if (!/^[0-9a-f]{40}$/.test(tree)) throw new Error(`not a tree SHA: ${tree}`);
  return `ci-proof-${tree}-${job}-${runtime}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

const releaseTag = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// Whether every pull request in `pulls` is from this repository into its main branch (and there is at least one).
function intoMain(pulls, repositoryId) {
  return Array.isArray(pulls) && pulls.length > 0 &&
    pulls.every((pull) => pull?.base?.ref === "main" && String(pull.base.repo?.id) === String(repositoryId));
}

// Whether a run's event and branch may prove a tree (see the header). `tags` maps a release tag to its commit SHA;
// `pulls` maps a head commit SHA to the pull requests with that head (for a run that no longer lists its pull request).
export function provingEvent(run, repositoryId, tags = new Map(), pulls = new Map()) {
  const branch = String(run.head_branch);
  switch (run.event) {
    case "pull_request": {
      if (intoMain(run.pull_requests, repositoryId)) return true;
      if (!Array.isArray(run.pull_requests) || run.pull_requests.length) return false;
      const heads = (pulls.get(run.head_sha) ?? []).filter((pull) => pull?.head?.sha === run.head_sha && String(pull.head.repo?.id) === String(repositoryId));
      return intoMain(heads, repositoryId) && heads.length === (pulls.get(run.head_sha) ?? []).length;
    }
    case "merge_group": return branch.startsWith("gh-readonly-queue/main/");
    case "push": return branch === "main";
    case "workflow_dispatch": return branch === "main" || (releaseTag.test(branch) && tags.get(branch) === run.head_sha);
    default: return false;
  }
}

// `tree` is the tree the proof names (the checked commit's tree), `parents` the checked commit's parent SHAs and `trees` maps a
// run's head commit SHA to its tree SHA; `tags` and `pulls` as for `provingEvent`.
export function acceptedRun(artifacts, runs, repositoryId, workflow, tree, trees, parents = [], tags = new Map(), pulls = new Map()) {
  for (const artifact of artifacts) {
    if (artifact.expired) continue;
    const run = runs.get(artifact.workflow_run?.id);
    if (!run) continue;
    if (String(artifact.workflow_run.head_repository_id) !== String(repositoryId)) continue;
    if (String(run.head_repository?.id) !== String(repositoryId)) continue;
    if (String(run.path).split("@")[0] !== workflow) continue;
    if (run.status !== "completed" || run.conclusion !== "success" || !provingEvent(run, repositoryId, tags, pulls)) continue;
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
    // A manual run on a release tag (`gh workflow run webgpu.yml --ref <tag>`): the commit the tag names.
    const tags = new Map(), pulls = new Map();
    for (const run of runs.values()) {
      const branch = String(run.head_branch);
      if (run.event === "workflow_dispatch" && releaseTag.test(branch) && !tags.has(branch)) {
        tags.set(branch, undefined);
        try {
          let object = (await api(`/repos/${repository}/git/ref/tags/${encodeURIComponent(branch)}`)).object;
          if (object?.type === "tag") object = (await api(`/repos/${repository}/git/tags/${object.sha}`)).object;
          if (object?.type === "commit") tags.set(branch, object.sha);
        } catch (error) {
          console.log(`No tag ${branch} (${error.message}): its runs prove nothing.`);
        }
      }
      // A pull request's run lists its pull request only while it is open; after the merge, ask which pull requests had that head.
      if (run.event === "pull_request" && Array.isArray(run.pull_requests) && !run.pull_requests.length && /^[0-9a-f]{40}$/.test(String(run.head_sha)) && !pulls.has(run.head_sha))
        pulls.set(run.head_sha, await api(`/repos/${repository}/commits/${run.head_sha}/pulls?per_page=100`));
    }
    const workflow = wanted ?? String(process.env.GITHUB_WORKFLOW_REF).split("@")[0].slice(repository.length + 1);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const parents = artifacts.length ? ((await api(`/repos/${repository}/git/commits/${head}`)).parents ?? []).map((p) => p.sha) : [];
    const run = acceptedRun(artifacts, runs, process.env.GITHUB_REPOSITORY_ID, workflow, currentTree(), trees, parents, tags, pulls);
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

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main(process.argv.slice(2));
