// SPDX-License-Identifier: Apache-2.0
// The site's promises, checked statically (docs/design/engine-site.md, sections 2, 13 and 15): no script except the one
// search filter, no inline style or handler, the Content-Security-Policy on every page, no resource from another host, no
// form but search, no embedded content, and template links only to the hosts on the list.
//
//   node site/checks/requests.mjs [_site]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { CSP, CSP_SEARCH } from "../lib/templates.mjs";
import { Findings, listFiles, readPages, tags, withoutArticles } from "./lib.mjs";

const FORBIDDEN_IN_SCRIPT = ["fetch(", "XMLHttpRequest", "sendBeacon", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "WebSocket", "EventSource", "importScripts", "eval(", "new Function"];
export const SCRIPT_LIMITS = { raw: 6000, gzip: 2500 };

/**
 * @param {{ path: string, url: string, html: string }[]} pages
 * @param {{ path: string, text: string }[]} scripts Every .js file of the site.
 * @param {string[]} cssFiles The text of every .css file.
 * @param {{ origin: string, allowedTemplateHosts: string[] }} config
 */
export function checkRequests(pages, scripts, cssFiles, config) {
  const findings = new Findings("Site promises (requests.mjs)");
  const origin = new URL(config.origin);
  if (scripts.length !== 1) findings.fail(`${scripts.length} script files; the site has exactly one (the search filter)`);
  for (const script of scripts) {
    if (script.text.length > SCRIPT_LIMITS.raw) findings.fail(`${script.path}: ${script.text.length} bytes, over ${SCRIPT_LIMITS.raw}`);
    const gzip = gzipSync(script.text, { level: 9 }).length;
    if (gzip > SCRIPT_LIMITS.gzip) findings.fail(`${script.path}: ${gzip} bytes gzip, over ${SCRIPT_LIMITS.gzip}`);
    for (const word of FORBIDDEN_IN_SCRIPT) if (script.text.includes(word)) findings.fail(`${script.path} contains ${word}`);
  }
  for (const css of cssFiles) {
    if (/@import\b/u.test(css)) findings.fail("The CSS has an @import");
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)/gu)) {
      if (!match[1].startsWith("/") || match[1].startsWith("//")) findings.fail(`The CSS loads ${match[1]}, not from this site`);
    }
  }
  for (const page of pages) {
    const where = page.url;
    const search = page.url === "/search/";
    if (/cdn\.tailwindcss|tailwindcss\.com/u.test(page.html)) findings.fail(`${where}: names the Tailwind CDN`);
    // Scripts
    for (const script of tags(page.html, "script")) {
      if (script.type === "application/ld+json" && script.src === undefined) continue;
      if (search && script.type === "module" && /^\/assets\/search\.[0-9a-f]{10}\.js$/u.test(script.src ?? "")) continue;
      findings.fail(`${where}: a <script> that is not the search filter or a JSON-LD block (${JSON.stringify(script)})`);
    }
    if (search && !tags(page.html, "script").some((script) => script.type === "module")) findings.fail("/search/: the search filter is missing");
    const head = page.html.slice(0, page.html.indexOf("</head>"));
    for (const script of tags(head, "script")) if (script.type !== "application/ld+json") findings.fail(`${where}: a script in the head`);
    // Inline style and handlers
    if (/<style[\s>]/iu.test(page.html)) findings.fail(`${where}: an inline <style> element`);
    for (const tag of tags(page.html, "*")) {
      for (const name of Object.keys(tag)) {
        if (name === "style") findings.fail(`${where}: a style attribute on <${tag.tagName}>`);
        if (/^on[a-z]+$/u.test(name)) findings.fail(`${where}: an event handler attribute ${name} on <${tag.tagName}>`);
      }
      if (["iframe", "object", "embed", "frame", "video", "audio", "base"].includes(tag.tagName)) findings.fail(`${where}: a <${tag.tagName}> element`);
      for (const attribute of ["src", "srcset", "poster", "data"]) {
        const value = tag[attribute];
        if (value !== undefined && !value.startsWith("/")) findings.fail(`${where}: <${tag.tagName} ${attribute}="${value}"> does not load from this site`);
      }
      if (tag.tagName === "link" && /\b(?:stylesheet|preload|icon|apple-touch-icon|modulepreload|prefetch|preconnect|dns-prefetch|manifest)\b/u.test(tag.rel ?? "") && !(tag.href ?? "").startsWith("/")) {
        findings.fail(`${where}: <link rel="${tag.rel}" href="${tag.href}"> does not load from this site`);
      }
    }
    // The Content-Security-Policy, first after the character set
    const meta = tags(head, "meta");
    if (meta[0]?.charset !== "utf-8") findings.fail(`${where}: the character set is not the first element of the head`);
    if (meta[1]?.["http-equiv"] !== "Content-Security-Policy" || meta[1].content !== (search ? CSP_SEARCH : CSP)) findings.fail(`${where}: the Content-Security-Policy is missing, not first after the character set, or different`);
    if (!meta.some((item) => item.name === "referrer" && item.content === "no-referrer")) findings.fail(`${where}: no referrer policy`);
    // Forms
    for (const form of tags(page.html, "form")) {
      if (form.role !== "search" || form.action !== "/search/" || form.method !== "get") findings.fail(`${where}: a form other than the search form`);
    }
    if (/<input\b(?![^>]*type="search")/u.test(page.html)) findings.fail(`${where}: an input other than the search field`);
    // Links in templates (outside rendered documents) only to the listed hosts
    for (const anchor of tags(withoutArticles(page.html), "a")) {
      const href = anchor.href ?? "";
      if (href.startsWith("/") || href.startsWith("#")) continue;
      let host;
      try {
        host = new URL(href).host;
      } catch {
        findings.fail(`${where}: a link that is not an address (${href})`);
        continue;
      }
      if (host !== origin.host && !config.allowedTemplateHosts.includes(host)) findings.fail(`${where}: a template link to ${host}, which is not on the list`);
    }
  }
  return findings;
}

export function main(directory = "_site", config = JSON.parse(readFileSync(new URL("../site.config.json", import.meta.url), "utf8"))) {
  const files = listFiles(directory);
  const scripts = files.filter((path) => path.endsWith(".js")).map((path) => ({ path, text: readFileSync(join(directory, path), "utf8") }));
  const css = files.filter((path) => path.endsWith(".css")).map((path) => readFileSync(join(directory, path), "utf8"));
  const findings = checkRequests(readPages(directory), scripts, css, config);
  findings.note(`${scripts.length} script file(s): ${scripts.map((script) => `${script.path} ${script.text.length} bytes, ${gzipSync(script.text, { level: 9 }).length} gzip`).join("; ")}`);
  findings.report();
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2]);
