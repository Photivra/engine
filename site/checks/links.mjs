// SPDX-License-Identifier: Apache-2.0
// Link check (docs/design/engine-site.md, section 15): every internal link and fragment resolves to a file or an id in the
// built site, no address uses http:, and the search page links every export, module, task and guide heading. Links to
// other sites are counted and listed, never fetched.
//
//   node site/checks/links.mjs [_site]
import { readFileSync } from "node:fs";
import process from "node:process";
import { Findings, listFiles, readPages, tags } from "./lib.mjs";
import { escapeHtml } from "../lib/html.mjs";
import { loadDocument, plainInline } from "../lib/markdown.mjs";

/** The ids of a page (every id attribute). */
export function idsOf(html) {
  return new Set(tags(html, "*").map((tag) => tag.id).filter((id) => id !== undefined));
}

/**
 * @param {{ path: string, url: string, html: string }[]} pages
 * @param {Set<string>} files Every file of the site, as site paths.
 * @param {{ exports?: { name: string }[], modules?: string[] }} [expected] What the search page must link.
 */
export function checkLinks(pages, files, expected = {}) {
  const findings = new Findings("Links (links.mjs)");
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const idCache = new Map();
  const ids = (page) => {
    if (!idCache.has(page.url)) idCache.set(page.url, idsOf(page.html));
    return idCache.get(page.url);
  };
  const external = new Set();
  let internal = 0;
  for (const page of pages) {
    for (const tag of tags(page.html, "*")) {
      for (const attribute of ["href", "src"]) {
        const value = tag[attribute];
        if (value === undefined) continue;
        if (/^http:/iu.test(value)) findings.fail(`${page.url}: ${attribute}="${value}" uses http:`);
        if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) {
          if (tag.tagName === "a") external.add(value);
          continue;
        }
        internal++;
        const [pathPart, fragment] = value.split("#");
        const path = pathPart.split("?")[0];
        let target = page;
        if (path) {
          if (!path.startsWith("/")) {
            findings.fail(`${page.url}: a relative address ${value}`);
            continue;
          }
          if (path.endsWith("/")) {
            target = byUrl.get(path);
            if (!target) findings.fail(`${page.url}: ${value} has no page`);
          } else {
            target = byUrl.get(path);
            if (!target && !files.has(path)) findings.fail(`${page.url}: ${value} has no file`);
          }
        }
        if (fragment !== undefined && fragment !== "" && target?.html) {
          if (!ids(target).has(decodeURIComponent(fragment))) findings.fail(`${page.url}: ${value} names a fragment the page does not have`);
        }
      }
    }
  }
  const search = byUrl.get("/search/");
  if (search && expected.exports) {
    const linked = new Set([...search.html.matchAll(/<code>([^<]+)<\/code><\/a><span class="what">(?:Function|Class|Constant|Type) ·/gu)].map((match) => match[1]));
    for (const item of expected.exports) if (!linked.has(item.name)) findings.fail(`/search/: the export ${item.name} is not linked`);
    findings.note(`/search/ links ${linked.size} exports`);
  }
  if (search && expected.modules) {
    for (const module of expected.modules) if (!search.html.includes(`<code>${module}</code></a><span class="what">Module ·`)) findings.fail(`/search/: the module ${module} is not linked`);
  }
  if (search && expected.tasks) {
    for (const task of expected.tasks) if (!search.html.includes(`>${escapeHtml(task)}</a><span class="what">Task index`)) findings.fail(`/search/: the task "${task}" is not linked`);
  }
  if (search && expected.sections) {
    for (const section of expected.sections) if (!search.html.includes(`>${escapeHtml(section)}</a><span class="what">Guide ·`)) findings.fail(`/search/: the guide section "${section}" is not linked`);
  }
  findings.note(`${internal} internal links and fragments resolved; ${external.size} distinct links to other sites (listed, not fetched)`);
  return { findings, external };
}

export function main(directory = "_site", expected = {}) {
  const pages = readPages(directory);
  const { findings, external } = checkLinks(pages, new Set(listFiles(directory)), expected);
  if (process.env.SITE_LIST_EXTERNAL) for (const link of [...external].sort()) process.stdout.write(`  external: ${link}\n`);
  findings.report();
}

/** What the search page must link, read from the sources: every export, module, task and guide `##` heading. */
export function expectedIndex() {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const manifest = JSON.parse(read("docs/api/exports.json"));
  const config = JSON.parse(read("site/site.config.json"));
  const reference = loadDocument("docs/API_REFERENCE.md", read("docs/API_REFERENCE.md"));
  const table = reference.sections.find((section) => section.id === "task-index").tokens.find((token) => token.type === "table");
  return {
    exports: manifest.exports,
    modules: [...new Set(manifest.exports.map((item) => item.source.replace(/^src\//u, "")))],
    tasks: table.rows.map((row) => plainInline(row[0].tokens)),
    sections: config.documents.flatMap((entry) => loadDocument(entry.source, read(entry.source)).sections.map((section) => section.title))
  };
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2], expectedIndex());
