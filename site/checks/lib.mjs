// SPDX-License-Identifier: Apache-2.0
// Reading the built site for the checks. The generator writes every attribute with double quotes and escapes every `<`
// in text, so these patterns read its output exactly; they are not a general HTML parser.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Every file under `directory`, as site paths ("/api/index.html"). */
export function listFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `/${relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/")}`)
    .sort();
}

/** The page address of an HTML file path. */
export function urlOf(path) {
  if (path === "/404.html") return path;
  return path.replace(/index\.html$/u, "");
}

/** Every HTML page of the built site: { path, url, html }. */
export function readPages(directory) {
  return listFiles(directory).filter((path) => path.endsWith(".html")).map((path) => ({ path, url: urlOf(path), html: readFileSync(join(directory, path), "utf8") }));
}

/** The attributes of every start tag named `tag` (or of every tag with `"*"`). */
export function tags(html, tag) {
  const pattern = tag === "*" ? /<([a-zA-Z][\w-]*)(\s[^>]*)?>/gu : new RegExp(`<(${tag})(\\s[^>]*)?>`, "giu");
  return [...html.matchAll(pattern)].map((match) => {
    const attributes = { tagName: match[1].toLowerCase() };
    for (const attribute of (match[2] ?? "").matchAll(/([^\s=/]+)(?:="([^"]*)")?/gu)) attributes[attribute[1].toLowerCase()] = attribute[2] ?? "";
    return attributes;
  });
}

/** Decodes the entities the generator writes. */
export function decode(text) {
  return text.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/&amp;/gu, "&");
}

/** The text of an HTML fragment: tags removed, entities decoded, white space collapsed. */
export function textOf(html) {
  return decode(html.replace(/<\/?(?:a|code|strong|em|b|i|abbr|sup|sub)\b[^>]*>/gu, "").replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
}

/** The inner HTML of the first element matching an opening-tag pattern up to its closing tag (no nesting of the same tag). */
export function inner(html, open, close) {
  const start = html.search(open);
  if (start < 0) return undefined;
  const from = html.indexOf(">", start) + 1;
  const end = html.indexOf(close, from);
  return end < 0 ? undefined : html.slice(from, end);
}

/** The HTML with the contents of every `<article …>…</article>` removed (template markup only). */
export function withoutArticles(html) {
  return html.replace(/<article\b[^>]*>[\s\S]*?<\/article>/gu, "<article></article>");
}

/** Collects failures; `report()` throws when there are any. */
export class Findings {
  constructor(name) {
    this.name = name;
    this.failures = [];
    this.notes = [];
  }
  fail(message) {
    this.failures.push(message);
  }
  note(message) {
    this.notes.push(message);
  }
  report(log = (line) => process.stdout.write(`${line}\n`)) {
    for (const note of this.notes) log(`  ${note}`);
    if (this.failures.length) {
      const shown = this.failures.slice(0, 50);
      throw new Error(`${this.name}: ${this.failures.length} failure(s)\n${shown.map((failure) => `- ${failure}`).join("\n")}${this.failures.length > 50 ? `\n… and ${this.failures.length - 50} more` : ""}`);
    }
    log(`${this.name}: passed`);
  }
}
