// SPDX-License-Identifier: Apache-2.0
// The characters the built pages set in Inter (text outside code, which uses the system monospace font) must be in the
// subset's character list, site/assets/fonts/charset.txt, or on its list of characters Inter does not have (they fall back
// to the system font by design, docs/design/engine-site.md 8.3). A new character fails here: add it to charset.txt and run
// site/tools/make-fonts.py.
//
//   node site/checks/fonts.mjs [_site] [--list]
import { readFileSync } from "node:fs";
import process from "node:process";
import { Findings, decode, readPages } from "./lib.mjs";

/** The code points of charset.txt: `{ subset, fallback }`; lines under "# Not in Inter" are fallback characters. */
export function parseCharset(text) {
  const subset = new Set();
  const fallback = new Set();
  let target = subset;
  for (const raw of text.split("\n")) {
    if (/^#\s*Not in Inter/iu.test(raw)) target = fallback;
    const line = raw.split("#", 1)[0].trim();
    if (!line) continue;
    for (const item of line.split(/\s+/u)) {
      const [first, last] = item.replace(/U\+/giu, "").split("-");
      const start = parseInt(first, 16);
      const end = last ? parseInt(last, 16) : start;
      for (let point = start; point <= end; point++) target.add(point);
    }
  }
  return { subset, fallback };
}

/** Every character set in the text face on the pages: visible text and attribute text a reader sees, without code. */
export function textCharacters(pages) {
  const used = new Map();
  for (const page of pages) {
    const body = page.html.slice(page.html.indexOf("<body>"))
      .replace(/<(pre|code|script|style)\b[\s\S]*?<\/\1>/gu, " ")
      .replace(/<[^>]*>/gu, " ");
    const placeholders = [...page.html.matchAll(/(?:placeholder|value)="([^"]*)"/gu)].map((match) => match[1]).join(" ");
    for (const character of decode(`${body} ${placeholders}`)) {
      const point = character.codePointAt(0);
      if (point < 0x20) continue;
      if (!used.has(point)) used.set(point, page.url);
    }
  }
  return used;
}

export function checkFonts(pages, charset) {
  const findings = new Findings("Font subset (fonts.mjs)");
  const { subset, fallback } = parseCharset(charset);
  const used = textCharacters(pages);
  for (const [point, url] of [...used].sort((a, b) => a[0] - b[0])) {
    if (!subset.has(point) && !fallback.has(point)) findings.fail(`U+${point.toString(16).toUpperCase().padStart(4, "0")} ${String.fromCodePoint(point)} (first on ${url}) is not in site/assets/fonts/charset.txt`);
  }
  findings.note(`${used.size} characters in the text face; subset ${subset.size}, of which unused ${[...subset].filter((point) => !used.has(point)).length}; fallback ${fallback.size}`);
  return { findings, used };
}

export function main(directory = "_site") {
  const charset = readFileSync(new URL("../assets/fonts/charset.txt", import.meta.url), "utf8");
  const { findings, used } = checkFonts(readPages(directory), charset);
  if (process.argv.includes("--list")) process.stdout.write(`${[...used.keys()].sort((a, b) => a - b).map((point) => `U+${point.toString(16).toUpperCase().padStart(4, "0")}`).join("\n")}\n`);
  findings.report();
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2]);
