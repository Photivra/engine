// SPDX-License-Identifier: Apache-2.0
// Size budgets (docs/design/engine-site.md, sections 7.4 and 11), in bytes as transferred with gzip; fonts and images as
// they are. The first view of a page is its HTML, the CSS, both fonts and the icons.
//
//   node site/checks/budgets.mjs [_site]
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { Findings, listFiles, readPages, tags } from "./lib.mjs";

const gzip = (bytes) => gzipSync(bytes, { level: 9 }).length;

/** The page kind for the HTML budgets, from the address. */
export function pageKind(url) {
  if (url === "/") return "home";
  if (url === "/404.html") return "not-found";
  if (url === "/install/") return "install";
  if (url === "/search/") return "search";
  if (url === "/api/") return "api-index";
  if (url.startsWith("/api/")) return "api-module";
  if (url === "/releases/") return "releases-index";
  if (url.startsWith("/releases/")) return "release";
  if (url === "/guides/") return "guides-index";
  if (url === "/license/") return "license";
  if (url === "/notices/") return "notices";
  if (url === "/third-party/") return "third-party";
  if (/^\/(?:quick-start|guides\/usage|guides\/display-view)\/$/u.test(url)) return "guide-contents";
  if (/^\/(?:quick-start|guides\/usage|guides\/display-view)\/[^/]+\/$/u.test(url)) return "guide-section";
  if (url.startsWith("/guides/")) return "guide";
  return "unknown";
}

/**
 * @param {{ url: string, html: string }[]} pages
 * @param {(path: string) => Buffer} read
 * @param {string[]} files
 * @param {object} budgets budgets.json
 */
export function checkBudgets(pages, read, files, budgets) {
  const findings = new Findings("Size budgets (budgets.mjs)");
  const largest = new Map();
  const css = files.filter((path) => path.endsWith(".css"));
  const fonts = files.filter((path) => path.endsWith(".woff2"));
  const scripts = files.filter((path) => path.endsWith(".js"));
  const cssBytes = css.reduce((sum, path) => sum + gzip(read(path)), 0);
  const fontBytes = fonts.reduce((sum, path) => sum + read(path).length, 0);
  const iconBytes = ["/favicon.ico", ...files.filter((path) => /^\/assets\/icon\.[0-9a-f]{10}\.svg$/u.test(path))].reduce((sum, path) => sum + gzip(read(path)), 0);
  if (css.length !== 1) findings.fail(`${css.length} CSS files; the site has one`);
  if (cssBytes > budgets.css) findings.fail(`CSS: ${cssBytes} bytes gzip, over ${budgets.css}`);
  if (fonts.length > budgets.fonts.files) findings.fail(`${fonts.length} font files, over ${budgets.fonts.files}`);
  if (fontBytes > budgets.fonts.bytes) findings.fail(`Fonts: ${fontBytes} bytes, over ${budgets.fonts.bytes}`);
  if (iconBytes > budgets.icons) findings.fail(`Icons: ${iconBytes} bytes, over ${budgets.icons}`);
  for (const path of scripts) {
    const size = gzip(read(path));
    if (size > budgets.searchScript) findings.fail(`${path}: ${size} bytes gzip, over ${budgets.searchScript}`);
  }
  for (const page of pages) {
    const kind = pageKind(page.url);
    const budget = budgets.html[kind];
    const size = gzip(Buffer.from(page.html));
    if (budget === undefined) findings.fail(`${page.url}: no HTML budget for the page kind ${kind}`);
    else if (size > budget) findings.fail(`${page.url}: HTML ${size} bytes gzip, over the ${kind} budget of ${budget}`);
    if (!largest.has(kind) || largest.get(kind).size < size) largest.set(kind, { url: page.url, size });
    const firstView = size + cssBytes + fontBytes + iconBytes;
    const limit = kind === "home" ? budgets.firstViewHome : budgets.firstView;
    if (firstView > limit) findings.fail(`${page.url}: first view ${firstView} bytes, over ${limit}`);
    const images = tags(page.html, "img");
    if (images.length > budgets.exampleImagesPerPage) findings.fail(`${page.url}: ${images.length} example images, over ${budgets.exampleImagesPerPage}`);
    if (page.html.includes("<script type=\"module\"") && page.url !== "/search/") findings.fail(`${page.url}: JavaScript on a page other than search`);
  }
  const examples = files.filter((path) => path.startsWith("/examples/"));
  let all = 0;
  for (const path of examples) {
    const size = read(path).length;
    all += size;
    if (size > budgets.exampleImage) findings.fail(`${path}: ${size} bytes, over ${budgets.exampleImage}`);
  }
  if (all > budgets.exampleImagesAll) findings.fail(`Example images: ${all} bytes, over ${budgets.exampleImagesAll}`);
  const social = files.includes("/social.png") ? read("/social.png").length : 0;
  if (!social) findings.fail("No social image");
  if (social > budgets.socialImage) findings.fail(`social.png: ${social} bytes, over ${budgets.socialImage}`);
  findings.note(`CSS ${cssBytes} gzip; fonts ${fontBytes} (${fonts.length} files); icons ${iconBytes}; search script ${scripts.map((path) => gzip(read(path))).join(", ")} gzip; social image ${social}; example images ${examples.map((path) => read(path).length).join(", ")}`);
  for (const [kind, { url, size }] of [...largest].sort()) findings.note(`largest ${kind}: ${url} ${size} gzip (budget ${budgets.html[kind]}); first view ${size + cssBytes + fontBytes + iconBytes}`);
  return findings;
}

export function main(directory = "_site") {
  const budgets = JSON.parse(readFileSync(new URL("./budgets.json", import.meta.url), "utf8"));
  const files = listFiles(directory);
  checkBudgets(readPages(directory), (path) => readFileSync(join(directory, path)), files, budgets).report();
  return statSync(directory);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2]);
