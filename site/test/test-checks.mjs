// SPDX-License-Identifier: Apache-2.0
// Each hand-written check of site/checks/ with a passing and a failing fixture (docs/design/engine-site.md, section 15).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { layout } from "../lib/templates.mjs";
import { readSources } from "../lib/sources.mjs";
import { checkRequests } from "../checks/requests.mjs";
import { checkLinks } from "../checks/links.mjs";
import { checkMeta } from "../checks/meta.mjs";
import { checkBudgets, pageKind } from "../checks/budgets.mjs";
import { checkFonts, parseCharset } from "../checks/fonts.mjs";
import { checkHtml } from "../checks/html.mjs";
import { samplePages } from "../checks/browser.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "site/site.config.json"), "utf8"));
const sources = readSources(root);
const site = {
  config, sources, placeholders: { repository: sources.repository, package: sources.packageName, citationUrl: sources.citation.url },
  assets: { "icon.svg": "/assets/icon.0123456789.svg", "fonts/inter-400.woff2": "/assets/inter-400.0123456789.woff2", "search.js": "/assets/search.0123456789.js" },
  socialAlt: "Photivra."
};
const page = (url, body, extra = {}) => ({
  path: url === "/404.html" ? url : `${url}index.html`,
  url,
  html: layout(site, { url, title: `Page ${url} · Photivra engine`, description: `About ${url}.`, section: "x", body, ...extra })
});
const good = () => [
  page("/install/", "<div class=\"wrap\"><article class=\"prose\"><h1 id=\"a\">A</h1><p><a href=\"/license/#here\">B</a> <a href=\"https://example.org/\">elsewhere</a></p></article></div>"),
  page("/license/", "<div class=\"wrap\"><article class=\"prose\"><h1 id=\"here\">B</h1><pre class=\"code\" tabindex=\"0\" role=\"region\" aria-label=\"Example code 1\"><code>x</code></pre></article></div>"),
  page("/search/", "<div><h1>Search</h1><form class=\"bigsearch\" role=\"search\" action=\"/search/\" method=\"get\"><label for=\"s\">Search</label><input type=\"search\" id=\"s\" name=\"q\"><button type=\"submit\">Search</button></form></div>", { script: "/assets/search.0123456789.js" }),
  page("/404.html", "<div><h1>Not found</h1></div>", { noindex: true, description: undefined })
];
const files = (pages) => new Set([...pages.map((p) => p.path), "/assets/icon.0123456789.svg", "/assets/inter-400.0123456789.woff2", "/assets/search.0123456789.js", "/social.png", "/favicon.ico", "/apple-touch-icon.png", "/sitemap.xml"]);
const script = [{ path: "/assets/search.0123456789.js", text: "export const a = 1;" }];

test("requests.mjs passes a clean site and fails each broken promise", () => {
  assert.deepEqual(checkRequests(good(), script, ["body{color:red}"], config).failures, []);
  const bad = good();
  bad[0].html = bad[0].html.replace("<p>", "<p style=\"color:red\" onclick=\"x()\"><img src=\"https://cdn.example.com/a.png\" alt=\"\">").replace("</body>", "<script src=\"/x.js\"></script></body>")
    .replace("<a href=\"/license/\">", "<a href=\"https://example.org/\">");
  bad[1].html = bad[1].html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/u, "");
  const failures = checkRequests(bad, [...script, { path: "/x.js", text: "fetch('/a'); localStorage.x = 1;" }], ["@import url(https://fonts.example.com/a.css);"], config).failures.join("\n");
  for (const expected of ["2 script files", "contains fetch(", "contains localStorage", "@import", "not the search filter", "style attribute", "event handler", "does not load from this site", "Content-Security-Policy", "template link to example.org"]) {
    assert.match(failures, new RegExp(expected.replace(/[()]/gu, "\\$&"), "u"), expected);
  }
});

test("links.mjs resolves pages and fragments and fails a broken one", () => {
  const raw = (url, body) => ({ path: `${url}index.html`, url, html: `<!DOCTYPE html><html><body>${body}</body></html>` });
  const pages = () => [raw("/a/", "<h1 id=\"top\">A</h1><a href=\"/b/#here\">B</a> <a href=\"https://example.org/\">E</a> <img src=\"/x.png\" alt=\"\">"), raw("/b/", "<h1 id=\"here\">B</h1><a href=\"#here\">self</a>")];
  const fileSet = new Set(["/a/index.html", "/b/index.html", "/x.png"]);
  assert.deepEqual(checkLinks(pages(), fileSet).findings.failures, []);
  const bad = pages();
  bad[0].html = bad[0].html.replace("/b/#here", "/b/#nowhere").replace("https://example.org/", "http://example.org/").replace("/x.png", "/y.png") + "<a href=\"/missing/\">m</a>";
  const failures = checkLinks(bad, fileSet).findings.failures.join("\n");
  assert.match(failures, /fragment the page does not have/u);
  assert.match(failures, /uses http:/u);
  assert.match(failures, /\/missing\/ has no page/u);
  assert.match(failures, /\/y\.png has no file/u);
});

test("meta.mjs passes consistent metadata and fails a repeated title, a missing canonical and wrong structured data", () => {
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["/install/", "/license/", "/search/"].map((url) => `<url><loc>${config.origin}${url}</loc><lastmod>2026-11-21</lastmod></url>`).join("\n")}\n</urlset>\n`;
  const text = { "/sitemap.xml": sitemap, "/robots.txt": `User-agent: *\nAllow: /\nSitemap: ${config.origin}/sitemap.xml\n`, "/CNAME": "engine.photivra.com\n", "/llms.txt": "llms" };
  const context = { files: files(good()), read: (path) => text[path] ?? "", sources, config, readme: "", llms: "llms", manifest: [] };
  assert.deepEqual(checkMeta(good(), context).failures, []);
  const bad = good();
  bad[1].html = bad[1].html.replace(/<title>[^<]*<\/title>/u, "<title>Page /install/ · Photivra engine</title>").replace(/<link rel="canonical"[^>]*>/u, "")
    .replace("</head>", "<script type=\"application/ld+json\">{\"@type\":\"SoftwareSourceCode\",\"version\":\"0.0.1\"}</script></head>");
  const failures = checkMeta(bad, { ...context, read: (path) => (path === "/robots.txt" ? "" : text[path] ?? "") }).failures.join("\n");
  for (const expected of ["is used 2 times", "canonical is not", "SoftwareSourceCode differs", "robots.txt"]) assert.match(failures, new RegExp(expected, "u"), expected);
});

test("budgets.mjs passes small files and fails an oversized page, CSS and font", () => {
  const budgets = JSON.parse(readFileSync(join(root, "site/checks/budgets.json"), "utf8"));
  const bytes = { "/assets/site.0123456789.css": Buffer.from("a{}"), "/assets/inter-400.0123456789.woff2": Buffer.alloc(20_000), "/favicon.ico": Buffer.alloc(600), "/social.png": Buffer.alloc(50_000) };
  const fileList = Object.keys(bytes);
  const pages = good();
  assert.deepEqual(checkBudgets(pages, (path) => bytes[path], fileList, budgets).failures, []);
  const big = { ...bytes, "/assets/site.0123456789.css": Buffer.from(Array.from({ length: 40_000 }, (_, i) => `.c${i * 7919}{}`).join("")), "/assets/inter-400.0123456789.woff2": Buffer.alloc(90_000) };
  const heavy = [{ url: "/", html: Array.from({ length: 4000 }, (_, i) => `<p>${(i * 2654435761) % 1000003}</p>`).join("") }];
  const failures = checkBudgets(heavy, (path) => big[path], fileList, budgets).failures.join("\n");
  for (const expected of ["CSS:", "Fonts:", "over the home budget", "first view"]) assert.match(failures, new RegExp(expected, "u"), expected);
  assert.equal(pageKind("/guides/usage/x/"), "guide-section");
  assert.equal(pageKind("/guides/color-patches/"), "guide");
});

test("fonts.mjs passes characters in the subset or the fallback list and fails others", () => {
  const charset = "U+0020-007E\n# Not in Inter\nU+2207\n";
  assert.deepEqual([...parseCharset(charset).fallback], [0x2207]);
  const pages = [{ url: "/", html: "<body><p>Text ∇</p><pre><code>µ in code is not set in Inter</code></pre></body>" }];
  assert.deepEqual(checkFonts(pages, charset).findings.failures, []);
  const failures = checkFonts([{ url: "/", html: "<body><p>µm</p></body>" }], charset).findings.failures;
  assert.match(failures[0], /U\+00B5/u);
});

test("html.mjs passes valid markup and fails invalid markup", async () => {
  assert.deepEqual((await checkHtml(good())).failures, []);
  const bad = good();
  bad[0].html = bad[0].html.replace("<p>", "<p><div>block in a paragraph</div><span id=\"x\"></span><span id=\"x\"></span>");
  assert.ok((await checkHtml(bad)).failures.length >= 2);
});

test("the browser pass samples one page of each kind and the heaviest of each kind", () => {
  const sample = samplePages([{ url: "/api/a/", html: "x" }, { url: "/api/b/", html: "x".repeat(100) + Math.random().toString(36).repeat(50) }, { url: "/", html: "h" }]);
  assert.deepEqual(sample, ["/", "/api/a/", "/api/b/"]);
});
