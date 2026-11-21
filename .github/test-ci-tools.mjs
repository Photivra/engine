// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { acceptedRun, proofName } from "./ci-proof.mjs";
import { docsOnlyReason } from "./ci-scope.mjs";
import { coverageDecision } from "./coverage-parts.mjs";

const readers = [{ file: "test/fast-flag-convention.test.ts", text: 'new URL("../docs/API_STYLE.md", import.meta.url)' }];

test("a change to Markdown that no test reads is docs-only", () => {
  assert.equal(docsOnlyReason(["README.md", "docs/WEBGPU.md"], readers), undefined);
});
test("Markdown that a test reads runs the tests", () => {
  assert.match(docsOnlyReason(["docs/API_STYLE.md"], readers), /read by test\/fast-flag-convention/);
});
test("any non-Markdown file, code directory or empty diff runs the tests", () => {
  assert.match(docsOnlyReason(["docs/validation/tier-acceptance-report-v1.json"], readers), /not Markdown/);
  assert.match(docsOnlyReason(["README.md", "src/index.ts"], readers), /not Markdown/);
  assert.match(docsOnlyReason(["test/fixtures/producer-export-acceptance/README.md"], readers), /code directory/);
  assert.match(docsOnlyReason([".github/pull_request_template.md"], readers), /code directory/);
  assert.match(docsOnlyReason([], readers), /no changed files/);
});

const tree = "0123456789abcdef0123456789abcdef01234567";
test("a proof name is the tree, the job and the runtime", () => {
  assert.equal(proofName(tree, "verify", "v24.11.0"), `ci-proof-${tree}-verify-v24.11.0`);
  assert.throws(() => proofName("main", "verify", "v24.11.0"));
});

const repo = 1001;
const ci = ".github/workflows/ci.yml";
const artifact = (run, extra = {}) => ({ expired: false, workflow_run: { id: run, head_repository_id: repo }, ...extra });
const head = "fedcba9876543210fedcba9876543210fedcba98";
const trees = new Map([[head, tree]]);
const intoMain = [{ base: { ref: "main", repo: { id: repo } }, head: { sha: head, repo: { id: repo } } }];
const run = (id, extra = {}) => [id, { id, path: ".github/workflows/ci.yml", head_repository: { id: repo }, event: "pull_request", head_branch: "feature",
  status: "completed", conclusion: "success", head_sha: head, pull_requests: intoMain, ...extra }];
test("a proof counts only from this repository's same workflow and before it expires", () => {
  assert.equal(acceptedRun([artifact(7)], new Map([run(7)]), repo, ci, tree, trees), 7);
  assert.equal(acceptedRun([artifact(7, { expired: true })], new Map([run(7)]), repo, ci, tree, trees), undefined);
  assert.equal(acceptedRun([artifact(7, { workflow_run: { id: 7, head_repository_id: 2002 } })], new Map([run(7)]), repo, ci, tree, trees), undefined);
  assert.equal(acceptedRun([artifact(7)], new Map([run(7, { head_repository: { id: 2002 } })]), repo, ci, tree, trees), undefined);
  assert.equal(acceptedRun([artifact(7)], new Map([run(7, { path: ".github/workflows/webgpu.yml" })]), repo, ci, tree, trees), undefined);
  assert.equal(acceptedRun([artifact(7)], new Map(), repo, ci, tree, trees), undefined);
});
test("a proof counts only from a successful run of a proving event on the tree it names", () => {
  const accepted = (extra, wanted = tree) => acceptedRun([artifact(7)], new Map([run(7, extra)]), repo, ci, wanted, trees);
  for (const extra of [{ event: "merge_group", head_branch: "gh-readonly-queue/main/pr-12-abc" }, { event: "push", head_branch: "main" }, { event: "workflow_dispatch", head_branch: "main" }])
    assert.equal(accepted(extra), 7);
  for (const extra of [{ conclusion: "failure" }, { status: "in_progress", conclusion: null }, { conclusion: "cancelled" }, { event: "push", head_branch: "feature" },
    { event: "workflow_dispatch", head_branch: "feature" }, { event: "merge_group", head_branch: "gh-readonly-queue/other/pr-1" }, { event: "schedule", head_branch: "main" },
    { event: "pull_request_target" }, { head_sha: "0000000000000000000000000000000000000000" }])
    assert.equal(accepted(extra), undefined, JSON.stringify(extra));
  // The proof's tree must be the run's head tree: a run cannot prove another tree.
  assert.equal(accepted({}, "1111111111111111111111111111111111111111"), undefined);
  assert.equal(accepted({}, "main"), undefined);
  // A pull request's run also proves a merge of its head (the merge queue's commit has that head as a parent); other events do not.
  const other = "1111111111111111111111111111111111111111", base = "2222222222222222222222222222222222222222";
  assert.equal(acceptedRun([artifact(7)], new Map([run(7)]), repo, ci, other, trees, [base, head]), 7);
  assert.equal(acceptedRun([artifact(7)], new Map([run(7)]), repo, ci, other, trees, [base]), undefined);
  assert.equal(acceptedRun([artifact(7)], new Map([run(7, { event: "push", head_branch: "main" })]), repo, ci, other, trees, [base, head]), undefined);
});

test("a pull request's proof counts only when its base is main", () => {
  const accepted = (extra, pulls = new Map()) => acceptedRun([artifact(7)], new Map([run(7, extra)]), repo, ci, tree, trees, [], new Map(), pulls);
  assert.equal(accepted({}), 7);
  // Into another branch, into main of another repository, or into main and another branch at once: no proof.
  assert.equal(accepted({ pull_requests: [{ base: { ref: "release", repo: { id: repo } } }] }), undefined);
  assert.equal(accepted({ pull_requests: [{ base: { ref: "main", repo: { id: 2002 } } }] }), undefined);
  assert.equal(accepted({ pull_requests: [...intoMain, { base: { ref: "release", repo: { id: repo } } }] }), undefined);
  // The run lists no pull request (it was merged or closed): the pull requests whose head is the run's head decide.
  assert.equal(accepted({ pull_requests: [] }), undefined);
  assert.equal(accepted({ pull_requests: [] }, new Map([[head, intoMain]])), 7);
  assert.equal(accepted({ pull_requests: [] }, new Map([[head, [{ base: { ref: "release", repo: { id: repo } }, head: { sha: head, repo: { id: repo } } }]]])), undefined);
  assert.equal(accepted({ pull_requests: [] }, new Map([[head, [{ ...intoMain[0], head: { sha: "3".repeat(40), repo: { id: repo } } }]]])), undefined);
  assert.equal(accepted({ pull_requests: [] }, new Map([[head, [{ ...intoMain[0], head: { sha: head, repo: { id: 2002 } } }]]])), undefined);
  assert.equal(accepted({ pull_requests: [] }, new Map([[head, [...intoMain, { base: { ref: "release", repo: { id: repo } }, head: { sha: head, repo: { id: repo } } }]]])), undefined);
  assert.equal(accepted({ pull_requests: undefined }), undefined);
});
test("a manual run on a release tag counts when the tag names the run's head commit", () => {
  const tags = new Map([["v2.28.0", head]]);
  const accepted = (extra, known = tags) => acceptedRun([artifact(7)], new Map([run(7, extra)]), repo, ci, tree, trees, [], known);
  assert.equal(accepted({ event: "workflow_dispatch", head_branch: "v2.28.0" }), 7);
  // The tag must exist and name this commit; a push to it, or a branch or tag of another name, does not count.
  assert.equal(accepted({ event: "workflow_dispatch", head_branch: "v2.28.0" }, new Map()), undefined);
  assert.equal(accepted({ event: "workflow_dispatch", head_branch: "v2.28.0" }, new Map([["v2.28.0", "4".repeat(40)]])), undefined);
  assert.equal(accepted({ event: "push", head_branch: "v2.28.0" }), undefined);
  assert.equal(accepted({ event: "workflow_dispatch", head_branch: "release" }, new Map([["release", head]])), undefined);
});
// #666: each coverage shard leaves one part, its blob report or a proof marker, and the gate decides from the ten parts.
const parts = (kinds) => kinds.map((kind, i) => (kind === "b" ? `blob-${i + 1}-10.json` : `proven-${i + 1}.txt`));
test("the 2.27.0 publish run (nine shards proven, shard 2 ran) passes without a merge", () => {
  assert.deepEqual(coverageDecision(parts([..."pbpppppppp"])), { action: "proven", parts: [1, 3, 4, 5, 6, 7, 8, 9, 10] });
});
test("ten blobs merge; ten markers pass; the order of the files does not matter", () => {
  assert.deepEqual(coverageDecision(parts([..."bbbbbbbbbb"]).reverse()), { action: "merge" });
  assert.deepEqual(coverageDecision(parts([..."pppppppppp"])), { action: "proven", parts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  assert.deepEqual(coverageDecision(["blob-1-4.json", "proven-2.txt", "blob-3-4.json", "blob-4-4.json"], 4), { action: "proven", parts: [2] });
});
test("a missing part fails and names it", () => {
  const nine = parts([..."pbpppppppp"]).filter((name) => !name.startsWith("proven-7."));
  assert.throws(() => coverageDecision(nine), /part 7 of 10 missing/);
  assert.throws(() => coverageDecision([]), /parts 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 of 10 missing/);
});
test("a part present twice (a blob and a marker) fails: a stale part is never merged silently", () => {
  assert.throws(() => coverageDecision([...parts([..."pbpppppppp"]), "blob-3-10.json"]), /part 3 is present twice/);
});
test("any other file fails", () => {
  for (const name of ["blob-11-10.json", "blob-2-8.json", "blob-0-10.json", "proven-02.txt", "notes.txt"])
    assert.throws(() => coverageDecision([...parts([..."bbbbbbbbbb"]), name]), /Unexpected file/, name);
});

const parts10 = (kinds) => [...kinds].map((kind, i) => (kind === "b" ? `blob-${i + 1}-10.json` : `proven-${i + 1}.txt`));
// The command line must run, and decide, from any path: a missed entry check would print nothing and exit 0 (#666).
test("the coverage-parts command decides from a path with a space and through a symbolic link", (t) => {
  const root = mkdtempSync(join(tmpdir(), "coverage parts "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, "with space", "coverage-parts.mjs"), link = join(root, "link.mjs"), parts = join(root, "parts"), output = join(root, "output.txt");
  mkdirSync(join(root, "with space"));
  mkdirSync(parts);
  copyFileSync(fileURLToPath(new URL("./coverage-parts.mjs", import.meta.url)), script);
  symlinkSync(script, link);
  for (const name of parts10("pbpppppppp")) writeFileSync(join(parts, name), "44453452116\n");
  for (const path of [script, link]) {
    writeFileSync(output, "");
    const run = spawnSync(process.execPath, [path, parts, "10"], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /action=proven/);
    assert.equal(readFileSync(output, "utf8"), "action=proven\n");
  }
  rmSync(join(parts, "proven-7.txt"));
  const missing = spawnSync(process.execPath, [link, parts, "10"], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output } });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /::error title=Coverage::Coverage part 7 of 10 missing/);
});
