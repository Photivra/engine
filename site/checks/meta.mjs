// SPDX-License-Identifier: Apache-2.0
// Search engines, single sources and markup rules (docs/design/engine-site.md, sections 10, 12 and 15): one h1, lang,
// canonical, unique titles and descriptions, Open Graph, sitemap, robots.txt, CNAME, noindex on the not-found page only,
// structured data equal to its source files, the footer equal to NOTICE and package.json, one version everywhere, home
// text from the README, images with dimensions and lazy loading, example files produced by the manifest, tables and code in
// named focusable regions, and llms.txt served unchanged.
//
//   node site/checks/meta.mjs [_site]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { readSources } from "../lib/sources.mjs";
import { readManifest, EXAMPLE_LIMITS } from "../lib/examples.mjs";
import { softwareSourceCode } from "../lib/pages.mjs";
import { Findings, decode, inner, listFiles, readPages, tags, textOf } from "./lib.mjs";

/**
 * @param {{ path: string, url: string, html: string }[]} pages
 * @param {{ files: Set<string>, read: (path: string) => string, sources: object, config: object, readme: string, llms: string, manifest: object[] }} site
 */
export function checkMeta(pages, site) {
  const findings = new Findings("Metadata and single sources (meta.mjs)");
  const { config, sources } = site;
  const titles = new Map();
  const descriptions = new Map();
  for (const page of pages) {
    const where = page.url;
    const html = page.html;
    const notFound = page.url === "/404.html";
    if (!html.startsWith("<!DOCTYPE html>\n<html lang=\"en-US\">")) findings.fail(`${where}: no doctype or lang="en-US"`);
    const h1 = (html.match(/<h1[\s>]/gu) ?? []).length;
    if (h1 !== 1) findings.fail(`${where}: ${h1} h1 elements`);
    const title = decode(inner(html, /<title>/u, "</title>") ?? "");
    if (!title) findings.fail(`${where}: no title`);
    titles.set(title, [...(titles.get(title) ?? []), where]);
    if (title.length > 70) findings.note(`${where}: title of ${title.length} characters`);
    const meta = tags(html.slice(0, html.indexOf("</head>")), "meta");
    const links = tags(html.slice(0, html.indexOf("</head>")), "link");
    const property = (name) => meta.find((item) => item.property === name || item.name === name)?.content;
    const description = property("description");
    if (!notFound) {
      if (!description) findings.fail(`${where}: no description`);
      else {
        descriptions.set(description, [...(descriptions.get(description) ?? []), where]);
        if (decode(description).length > 160) findings.fail(`${where}: description longer than 160 characters`);
      }
      const canonical = links.filter((link) => link.rel === "canonical");
      if (canonical.length !== 1 || canonical[0].href !== config.origin + page.url) findings.fail(`${where}: canonical is not ${config.origin + page.url}`);
      if (property("og:url") !== config.origin + page.url) findings.fail(`${where}: og:url differs from the canonical address`);
      if (!property("og:description")) findings.fail(`${where}: no og:description`);
      if (property("robots")) findings.fail(`${where}: a robots meta tag on an indexed page`);
    } else if (property("robots") !== "noindex") findings.fail("/404.html: not noindex");
    if (!links.some((link) => link.rel === "sitemap" && link.href === "/sitemap.xml")) findings.fail(`${where}: no sitemap link`);
    for (const name of ["og:type", "og:site_name", "og:title", "og:image", "og:image:width", "og:image:height", "og:image:alt", "og:locale", "twitter:card"]) {
      if (!property(name)) findings.fail(`${where}: no ${name}`);
    }
    const image = property("og:image");
    if (image && (!image.startsWith(config.origin) || !site.files.has(image.slice(config.origin.length)))) findings.fail(`${where}: og:image ${image} is not a file of this site`);
    // Footer: holder, year and license from NOTICE and package.json; the version from package.json.
    const footer = inner(html, /<footer class="site">/u, "</footer>") ?? "";
    const footerText = textOf(footer);
    if (!footerText.includes(`Copyright ${sources.notice.year} ${sources.notice.holder}.`)) findings.fail(`${where}: the footer's copyright differs from NOTICE`);
    if (!footerText.includes(`Source code under the ${sources.notice.licenseName}.`) || sources.license !== "Apache-2.0") findings.fail(`${where}: the footer's license differs from NOTICE or package.json`);
    if (!footerText.includes(sources.notice.trademark) || !footerText.includes(sources.notice.dng)) findings.fail(`${where}: the footer's notices differ from NOTICE`);
    if (!footerText.includes(`${sources.packageName} ${sources.version}. This site was built from the public source at commit ${sources.shortCommit}.`)) findings.fail(`${where}: the footer's version or commit is not package.json's and the build's`);
    for (const match of textOf(html.replace(/<pre[\s\S]*?<\/pre>/gu, "")).matchAll(/@photivra\/engine (\d+\.\d+\.\d+)\b/gu)) {
      if (match[1] !== sources.version && !page.url.startsWith("/releases/")) findings.fail(`${where}: names @photivra/engine ${match[1]}; package.json is ${sources.version}`);
    }
    // Images
    const images = tags(html, "img");
    for (const img of images) {
      for (const attribute of ["width", "height", "alt"]) if (img[attribute] === undefined) findings.fail(`${where}: an image without ${attribute}`);
      if (img.loading !== "lazy" || img.decoding !== "async") findings.fail(`${where}: an image without loading="lazy" and decoding="async"`);
    }
    if (images.length > EXAMPLE_LIMITS.perPage) findings.fail(`${where}: ${images.length} images, over ${EXAMPLE_LIMITS.perPage}`);
    // Tables and code in named, focusable scroll regions
    for (const match of html.matchAll(/<pre\b([^>]*)>/gu)) {
      if (!/tabindex="0"/u.test(match[1]) || !/role="region"/u.test(match[1]) || !/aria-label="[^"]+"/u.test(match[1])) findings.fail(`${where}: a code block that is not a named, focusable region`);
    }
    const tableCount = (html.match(/<table>/gu) ?? []).length;
    const wrapped = (html.match(/<div class="scroll" tabindex="0" role="region" aria-label="[^"]+"><table>/gu) ?? []).length;
    if (tableCount !== wrapped) findings.fail(`${where}: ${tableCount - wrapped} table(s) outside a named, focusable scroll region`);
    // Structured data
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)) {
      let data;
      try {
        data = JSON.parse(block[1]);
      } catch {
        findings.fail(`${where}: structured data that is not JSON`);
        continue;
      }
      if (data["@type"] === "SoftwareSourceCode" && JSON.stringify(data) !== JSON.stringify(softwareSourceCode(config, sources))) findings.fail(`${where}: SoftwareSourceCode differs from its source files`);
      if (data["@type"] === "WebSite" && (data.name !== config.siteName || data.url !== `${config.origin}/`)) findings.fail(`${where}: WebSite data differs from site.config.json`);
      if (!["SoftwareSourceCode", "WebSite", "BreadcrumbList"].includes(data["@type"])) findings.fail(`${where}: structured data of type ${data["@type"]}`);
      for (const forbidden of ["aggregateRating", "review", "offers", "award", "interactionStatistic"]) if (forbidden in data) findings.fail(`${where}: structured data with ${forbidden}`);
    }
  }
  for (const [title, where] of titles) if (where.length > 1) findings.fail(`The title "${title}" is used ${where.length} times: ${where.slice(0, 3).join(", ")}`);
  for (const [description, where] of descriptions) if (where.length > 1) findings.fail(`The description "${description}" is used ${where.length} times: ${where.slice(0, 3).join(", ")}`);

  // Home text from the README
  const home = pages.find((page) => page.url === "/");
  if (home) {
    const readmeText = site.readme.replace(/\*\*|`/gu, "").replace(/\s+/gu, " ");
    const hero = inner(home.html, /<section class="hero"/u, "</section>") ?? "";
    for (const match of hero.matchAll(/<p class="(?:lead|ipa)">([\s\S]*?)<\/p>|<p>([\s\S]*?)<\/p>/gu)) {
      const text = textOf(match[1] ?? match[2]);
      if (!readmeText.includes(text)) findings.fail(`/: home text that is not in the README: "${text.slice(0, 80)}"`);
    }
    if (!(home.html.includes("\"@type\":\"WebSite\"") && home.html.includes("\"@type\":\"SoftwareSourceCode\""))) findings.fail("/: WebSite and SoftwareSourceCode data missing");
  }

  // Sitemap, robots.txt, CNAME, llms.txt
  const sitemap = site.read("/sitemap.xml");
  if (!sitemap.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">")) findings.fail("sitemap.xml: not a sitemaps.org 0.9 document");
  const entries = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/gu)];
  const listed = new Set(entries.map((entry) => entry[1]));
  const expected = new Set(pages.filter((page) => page.url !== "/404.html").map((page) => config.origin + page.url));
  for (const address of expected) if (!listed.has(address)) findings.fail(`sitemap.xml: ${address} is missing`);
  for (const address of listed) if (!expected.has(address)) findings.fail(`sitemap.xml: ${address} is not a page`);
  if (entries.length !== (sitemap.match(/<url>/gu) ?? []).length) findings.fail("sitemap.xml: an entry without loc and lastmod");
  for (const entry of entries) if (!/^\d{4}-\d{2}-\d{2}$/u.test(entry[2])) findings.fail(`sitemap.xml: lastmod ${entry[2]} is not a date`);
  if (site.read("/robots.txt") !== `User-agent: *\nAllow: /\nSitemap: ${config.origin}/sitemap.xml\n`) findings.fail("robots.txt: not as designed");
  if (site.read("/CNAME").trim() !== new URL(config.origin).host) findings.fail("CNAME differs from the configured origin");
  if (site.read("/llms.txt") !== site.llms) findings.fail("llms.txt is not the repository's file unchanged");

  // Example images: every file under /examples/ was produced by a manifest entry, and every one is shown.
  const exampleFiles = [...site.files].filter((path) => path.startsWith("/examples/"));
  for (const path of exampleFiles) {
    const name = path.match(/^\/examples\/([a-z0-9-]+)\.[0-9a-f]{10}\.png$/u)?.[1];
    if (!name || !site.manifest.some((example) => example.name === name)) findings.fail(`${path}: an image on the site that no manifest entry produced`);
    if (!pages.some((page) => page.html.includes(`src="${path}"`))) findings.fail(`${path}: shown on no page`);
  }
  findings.note(`${pages.length} pages; ${entries.length} sitemap entries; ${exampleFiles.length} example images`);
  return findings;
}

export function main(directory = "_site") {
  const root = new URL("../../", import.meta.url).pathname;
  const config = JSON.parse(readFileSync(join(root, "site/site.config.json"), "utf8"));
  const read = (path) => (existsSync(join(directory, path)) ? readFileSync(join(directory, path), "utf8") : "");
  const findings = checkMeta(readPages(directory), {
    files: new Set(listFiles(directory)),
    read,
    sources: readSources(root),
    config,
    readme: readFileSync(join(root, "README.md"), "utf8"),
    llms: readFileSync(join(root, "llms.txt"), "utf8"),
    manifest: readManifest(root)
  });
  findings.report();
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2]);
