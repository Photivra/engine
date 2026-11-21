// SPDX-License-Identifier: Apache-2.0
// Unit tests of the documentation, licence and identity gates' logic (node --test scripts/test-gates.mjs).
// Named test-*.mjs, not *.test.*, so Vitest does not collect it (it needs no recorded shard time).
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { anchors, headings, headingSlug } from "./lib/anchors.mjs";
import { checkLinks, repositoryWebUrl } from "./check-release-docs.mjs";
import { licenseAllowed, checkLockfile } from "./check-license-policy.mjs";
import { identityViolations, isText } from "./check-project-identity.mjs";

const REPO = "https://github.com/Photivra/engine";

function tree(files) {
  return { read: (path) => files[path], exists: (path) => path in files || Object.keys(files).some((file) => file.startsWith(`${path}/`)) };
}

test("heading ids follow GitHub's rule and skip fenced code (#709, gaps 3 and 4)", () => {
  assert.equal(headingSlug("Depth of field and defocus"), "depth-of-field-and-defocus");
  assert.equal(headingSlug("`calculateDepthOfField`"), "calculatedepthoffield");
  assert.equal(headingSlug("Limits and refusals (2.27.0)"), "limits-and-refusals-2270");
  assert.equal(headingSlug("optics/depth-of-field.ts"), "opticsdepth-of-fieldts");
  const text = "# Title\n\n## Usage\n\n```sh\n# not a heading\n## nor this\n```\n\n## Usage\n\n~~~\n## inside a tilde fence\n~~~\n### Usage\n";
  assert.deepEqual(headings(text).map((h) => [h.level, h.id]), [[1, "title"], [2, "usage"], [2, "usage-1"], [3, "usage-2"]]);
  assert.ok(!anchors(text).has("not-a-heading"));
  // A longer fence is closed only by a fence at least as long.
  assert.deepEqual([...anchors("````md\n```\n# x\n````\n# y\n")], ["y"]);
});

test("docs:check resolves absolute links to the repository (#694)", () => {
  assert.equal(repositoryWebUrl("git+https://github.com/Photivra/engine.git"), REPO);
  const files = { "README.md": "", "docs/USAGE.md": "# Usage\n\n## Depth of field\n", "docs/api/x.md": "" };
  const good = { ...files, "README.md": `[a](${REPO}/blob/main/docs/USAGE.md#depth-of-field) [b](${REPO}/tree/main/docs/api) [c](docs/USAGE.md)` };
  const { read, exists } = tree(good);
  assert.deepEqual(checkLinks(["README.md"], read, exists, REPO), { links: 3, repositoryLinks: 2 });
  const missing = tree({ ...files, "README.md": `[x](${REPO}/blob/main/docs/NOPE.md)` });
  assert.throws(() => checkLinks(["README.md"], missing.read, missing.exists, REPO), /Missing navigation/);
  const heading = tree({ ...files, "README.md": `[x](${REPO}/blob/main/docs/USAGE.md#no-such-heading)` });
  assert.throws(() => checkLinks(["README.md"], heading.read, heading.exists, REPO), /Missing heading/);
  // Relative links and fragment-only links behave as before.
  const relative = tree({ ...files, "docs/A.md": "## Here\n[x](#here) [y](USAGE.md#usage) [z](../README.md)" });
  assert.deepEqual(checkLinks(["docs/A.md"], relative.read, relative.exists, REPO), { links: 3, repositoryLinks: 0 });
  const broken = tree({ ...files, "docs/A.md": "[x](MISSING.md)" });
  assert.throws(() => checkLinks(["docs/A.md"], broken.read, broken.exists, REPO), /Missing navigation/);
});

test("docs:check fails when it resolved no absolute link although the documents hold some (#694)", () => {
  // A link form the link pattern does not read (here, with a title) leaves the repository's address unresolved.
  const { read, exists } = tree({ "README.md": `[x](${REPO}/blob/main/README.md "title")` });
  assert.throws(() => checkLinks(["README.md"], read, exists, REPO), /no longer matches/);
});

test("the licence gate refuses compound expressions with AND (ci-11 in #703)", () => {
  // Licence identifiers are assembled from parts so the repository's licence scan reads none in this file.
  const id = (...parts) => parts.join("-");
  const [mit, apache, gpl3, lgpl3, mpl, zeroBsd, cc0] = [id("MIT"), id("Apache", "2.0"), id("GPL", "3.0", "only"), id("LGPL", "3.0", "only"), id("MPL", "2.0"), id("0BSD"), id("CC0", "1.0")];
  assert.equal(licenseAllowed(`(${mit} OR Unlicense) AND (${gpl3} OR ${lgpl3})`, false), false);
  assert.equal(licenseAllowed(`${mit} AND ${gpl3}`, false), false);
  assert.equal(licenseAllowed(gpl3, false), false);
  assert.equal(licenseAllowed(`${mit} OR ${apache}`, false), true);
  assert.equal(licenseAllowed(`(${mit} OR ${cc0})`, false), true);
  assert.equal(licenseAllowed(`${apache} WITH LLVM-exception`, false), false);
  assert.equal(licenseAllowed(mpl, false), false);
  assert.equal(licenseAllowed(mpl, true), true);
  assert.equal(licenseAllowed(zeroBsd, true), true);
  assert.equal(licenseAllowed(zeroBsd, false), false);
  const lock = { packages: { "": {}, "node_modules/a": { license: mit }, "node_modules/b": {}, "node_modules/s": { link: true, resolved: "stub" }, stub: { license: apache, dev: true } } };
  assert.deepEqual(checkLockfile(lock, "x").violations, ["x: node_modules/b: missing license metadata"]);
});

test("the identity gate reads every text file and any host domain (#696)", () => {
  const host = (domain) => `https://app-${"stag"}ing.${domain}/`;
  for (const domain of ["example.com", "example.xyz", "pages.dev", "example.co.uk"]) {
    assert.equal(identityViolations("NODE_SUPPORT.md", `see ${host(domain)}`).length, 1, domain);
  }
  assert.equal(identityViolations("x.md", `${"stag"}ing.example.com`).length, 1);
  assert.deepEqual(identityViolations("x.md", `${"stag"}ing buffers`), []);
  assert.deepEqual(identityViolations("x.ts", `${"stag"}ingBuffer.size; i < ${"stag"}ing.length; ${"stag"}ing.getMappedRange().slice(0)`), []);
  assert.equal(isText("site/index.html", Buffer.from("<p>")), true);
  assert.equal(isText("scripts/verify.py", Buffer.from("print()")), true);
  assert.equal(isText("a.png", Buffer.from("text")), false);
  assert.equal(isText("a.bin", Buffer.from([1, 0, 2])), false);
});
