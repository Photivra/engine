// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { acceptedRun, proofName } from "./ci-proof.mjs";
import { docsOnlyReason } from "./ci-scope.mjs";

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
test("a change confined to the documentation site or its design runs no engine tests (#709, gap 2)", () => {
  assert.equal(docsOnlyReason(["site/build.mjs", "site/styles/site.css", "site/package-lock.json", "site/content/404.md"], readers), undefined);
  assert.equal(docsOnlyReason(["docs/design/engine-site.md", "docs/design/screens/site-home.png", "README.md"], readers), undefined);
  assert.match(docsOnlyReason(["site/build.mjs", "src/index.ts"], readers), /src\/index\.ts is not Markdown/);
  assert.match(docsOnlyReason(["site/build.mjs", "scripts/lib/anchors.mjs"], readers), /not Markdown/);
});

const tree = "0123456789abcdef0123456789abcdef01234567";
test("a proof name is the tree, the job and the runtime", () => {
  assert.equal(proofName(tree, "verify", "v24.11.0"), `ci-proof-${tree}-verify-v24.11.0`);
  assert.throws(() => proofName("main", "verify", "v24.11.0"));
});

const repo = 1001;
const ci = ".github/workflows/ci.yml";
const artifact = (run, extra = {}) => ({ expired: false, workflow_run: { id: run, head_repository_id: repo }, ...extra });
const run = (id, extra = {}) => [id, { id, path: ".github/workflows/ci.yml", head_repository: { id: repo }, ...extra }];
test("a proof counts only from this repository's same workflow and before it expires", () => {
  assert.equal(acceptedRun([artifact(7)], new Map([run(7)]), repo, ci), 7);
  assert.equal(acceptedRun([artifact(7, { expired: true })], new Map([run(7)]), repo, ci), undefined);
  assert.equal(acceptedRun([artifact(7, { workflow_run: { id: 7, head_repository_id: 2002 } })], new Map([run(7)]), repo, ci), undefined);
  assert.equal(acceptedRun([artifact(7)], new Map([run(7, { head_repository: { id: 2002 } })]), repo, ci), undefined);
  assert.equal(acceptedRun([artifact(7)], new Map([run(7, { path: ".github/workflows/webgpu.yml" })]), repo, ci), undefined);
  assert.equal(acceptedRun([artifact(7)], new Map(), repo, ci), undefined);
});
