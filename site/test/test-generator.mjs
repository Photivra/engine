// SPDX-License-Identifier: Apache-2.0
// Unit tests of the site generator (node --test site/test/). They read the repository's real sources.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { headings } from "../../scripts/lib/anchors.mjs";
import { loadDocument, idsIn } from "../lib/markdown.mjs";
import { LinkMap } from "../lib/links.mjs";
import { splitChangelog, publicationGuard, statusLine } from "../lib/changelog.mjs";
import { parseCitation, parseNotice, readSources } from "../lib/sources.mjs";
import { firstSentence, cut, longDate } from "../lib/html.mjs";
import { buildPages } from "../lib/pages.mjs";
import { codeBlock } from "../lib/examples.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const config = JSON.parse(read("site/site.config.json"));
const REPO = "https://github.com/Photivra/engine";

test("heading ids equal the shared anchors module on every heading of every published file (#709, gaps 3 and 4)", () => {
  const manifest = JSON.parse(read("docs/api/exports.json"));
  const files = ["README.md", "CHANGELOG.md", "NODE_SUPPORT.md", "THIRD_PARTY.md", "docs/API_REFERENCE.md", ...config.documents.map((d) => d.source),
    ...new Set(manifest.exports.map((e) => `docs/api/${e.source.replace(/^src\//u, "").replace(/\.ts$/u, "").replace(/\//gu, "-")}.md`))];
  let count = 0;
  for (const file of files) {
    const text = read(file);
    const doc = loadDocument(file, text);
    assert.deepEqual(idsIn(doc.tokens), headings(text).map((h) => h.id), file);
    count += doc.headings.length;
  }
  assert.ok(count > 3000, `${count} headings`);
});

test("a relative and an absolute GitHub link to a published page give the same site address", () => {
  const links = new LinkMap({ root, repository: REPO });
  links.publish("docs/USAGE.md", "/guides/usage/", new Map([["depth-of-field-and-defocus", "/guides/usage/depth-of-field-and-defocus/"], ["usage-guide", "/guides/usage/"]]));
  links.publish("CHANGELOG.md", "/releases/", new Map([["unreleased", null]]));
  assert.equal(links.resolve("USAGE.md#depth-of-field-and-defocus", "docs/QUICK_START.md"), "/guides/usage/depth-of-field-and-defocus/");
  assert.equal(links.resolve(`${REPO}/blob/main/docs/USAGE.md#depth-of-field-and-defocus`, "README.md"), "/guides/usage/depth-of-field-and-defocus/");
  assert.equal(links.resolve("../../docs/USAGE.md", "site/content/404.md"), "/guides/usage/");
  // Unpublished files go to GitHub, directories as tree addresses; a heading of an unpublished part of a published file too.
  assert.equal(links.resolve("DEVELOPERS.md#x", "docs/USAGE.md"), `${REPO}/blob/main/docs/DEVELOPERS.md#x`);
  assert.equal(links.resolve("api", "docs/USAGE.md"), `${REPO}/tree/main/docs/api`);
  assert.equal(links.resolve("../CHANGELOG.md#unreleased", "docs/USAGE.md"), `${REPO}/blob/main/CHANGELOG.md#unreleased`);
  assert.equal(links.resolve("https://example.org/a", "docs/USAGE.md"), "https://example.org/a");
  assert.throws(() => links.resolve("NOPE.md", "docs/USAGE.md"), /Missing navigation/);
  assert.throws(() => links.resolve("USAGE.md#no-such-heading", "docs/QUICK_START.md"), /Missing heading/);
  assert.throws(() => links.resolve("../../../x.md", "docs/USAGE.md"), /outside the repository/);
});

test("the changelog splits into releases, the engine API history and unpublished work; an unknown heading fails", () => {
  const { releases, history, unreleased } = splitChangelog(loadDocument("CHANGELOG.md", read("CHANGELOG.md")));
  assert.ok(releases.length >= 47, `${releases.length} releases`);
  assert.equal(new Set(releases.map((r) => r.version)).size, releases.length);
  assert.ok(history.length >= 19);
  assert.equal(releases.at(-1).version, "0.1.0");
  assert.equal(releases.at(-1).date, "2026-09-20");
  assert.ok(Array.isArray(unreleased));
  const doc = (text) => loadDocument("CHANGELOG.md", text);
  assert.throws(() => splitChangelog(doc("# Changelog\n\n## 1.0.0 — published October 2, 2026\n\nx\n\n## Something else\n\ny\n")), /neither a version/);
  const split = splitChangelog(doc("# Changelog\n\n## Unreleased\n\n- a\n\n## 2.0.0 — tagged; not published to npm\n\n## 1.0.0 - 2026-09-20\n"));
  assert.equal(split.unreleased.length, 1);
  assert.deepEqual(split.releases.map((r) => [r.version, r.published, r.tagged, r.date]), [["2.0.0", false, true, undefined], ["1.0.0", false, false, "2026-09-20"]]);
  assert.equal(statusLine(split.releases[1], undefined, longDate), "September 20, 2026");
  assert.equal(statusLine(split.releases[0], "2.0.0", longDate), "Published");
});

test("the publication guard deploys only a published newest version equal to package.json's", () => {
  const doc = (heading) => loadDocument("CHANGELOG.md", `# Changelog\n\n## ${heading}\n\n- x\n\n## 2.26.0 — published November 16, 2026\n`);
  assert.equal(publicationGuard(doc("2.27.0 — published November 19, 2026"), "2.27.0").deploy, true);
  assert.equal(publicationGuard(doc("2.28.0 — unreleased (prepared November 22, 2026)"), "2.28.0").deploy, false);
  assert.equal(publicationGuard(doc("Unreleased"), "2.27.0").deploy, false);
  assert.equal(publicationGuard(doc("2.27.0 — published November 19, 2026"), "2.28.0").deploy, false);
});

test("sources: CITATION.cff, NOTICE and llms.txt are read, not retyped", () => {
  const citation = parseCitation(read("CITATION.cff"));
  assert.equal(citation["repository-code"], REPO);
  assert.equal(citation.authors[0]["family-names"], "Shackelford");
  assert.throws(() => parseCitation("title: x\n  weird: [1, 2]\n"), /does not understand/);
  const notice = parseNotice(read("NOTICE"));
  assert.equal(notice.holder, "Shackelford Creative, LLC");
  assert.match(notice.trademark, /^Photivra trade names/u);
  assert.throws(() => parseNotice("no copyright here"), /Copyright/);
  const sources = readSources(root);
  assert.equal(sources.version, JSON.parse(read("package.json")).version);
});

test("text helpers cut at word boundaries", () => {
  assert.equal(firstSentence("One two. Three four."), "One two.");
  assert.equal(firstSentence("Use `x`. Then y."), "Use `x`.");
  assert.equal(cut("alpha beta gamma", 12), "alpha beta…");
  assert.equal(longDate("2026-11-19"), "November 19, 2026");
});

test("code blocks are counted as docs:check counts them", () => {
  assert.equal(codeBlock("```ts\na\n```\n```sh\nb\n```\n```js\nc\n```\n", 1), "c");
  assert.throws(() => codeBlock("```ts\na\n```\n", 1), /No code block 1/);
});

test("every page has a unique title and description, and the page list covers the design's addresses", () => {
  const sources = readSources(root);
  const site = { root, config, sources, examples: [], exampleUrls: {}, assets: { "search.js": "/assets/search.0000000000.js" }, placeholders: {} };
  const { pages } = buildPages(site);
  const urls = new Set(pages.map((p) => p.url));
  for (const url of ["/", "/install/", "/quick-start/", "/guides/", "/guides/usage/", "/guides/usage/depth-of-field-and-defocus/", "/guides/display-view/",
    "/guides/layered-scenes/", "/guides/agent-guide/", "/guides/color-patches/", "/guides/image-plane/", "/guides/mixed-illumination/", "/guides/light-sources/",
    "/guides/content-credentials/", "/api/", "/api/optics-depth-of-field/", "/search/", "/releases/", `/releases/${sources.version}/`, "/license/", "/notices/",
    "/third-party/", "/404.html"]) assert.ok(urls.has(url), url);
  assert.equal(pages.filter((p) => p.url.startsWith("/api/") && p.url !== "/api/").length, new Set(sources.exportsManifest.exports.map((e) => e.source)).size);
  const titles = pages.map((p) => p.title);
  assert.equal(new Set(titles).size, titles.length, "titles are unique");
  const descriptions = pages.filter((p) => p.description).map((p) => p.description);
  assert.equal(new Set(descriptions).size, descriptions.length, "descriptions are unique");
  for (const description of descriptions) assert.ok(description.length <= 160, description);
});
