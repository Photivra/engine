// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub-style heading ids of a Markdown file, shared by `docs:check` (scripts/check-release-docs.mjs) and the
 * documentation site's generator (site/lib/markdown.mjs), so a fragment link that works on GitHub works on the site
 * (#669; #709, gaps 3 and 4). Lines inside fenced code blocks are not headings.
 */

/** The id GitHub gives a heading: lower case, back-ticks and asterisks dropped, punctuation removed, spaces to hyphens. */
export function headingSlug(text) {
  return text.toLowerCase().replace(/[`*]/gu, "").replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s/gu, "-");
}

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/u;
const HEADING = /^(#{1,6})\s+(.+)$/u;

/**
 * Every ATX heading outside fenced code, in document order, with its level, its source text and its id. A repeated id
 * gets `-1`, `-2` and so on, as on GitHub.
 * @param {string} markdown
 * @returns {{ level: number, text: string, id: string, line: number }[]}
 */
export function headings(markdown) {
  const found = [];
  const used = new Map();
  let fence = null;
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\r$/u, "");
    const marker = line.match(FENCE);
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === "") fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const heading = line.match(HEADING);
    if (!heading) continue;
    const base = headingSlug(heading[2]);
    const occurrence = used.get(base) ?? 0;
    used.set(base, occurrence + 1);
    found.push({ level: heading[1].length, text: heading[2], id: base + (occurrence ? `-${occurrence}` : ""), line: index + 1 });
  }
  return found;
}

/** The set of heading ids of a Markdown file (fragment targets). */
export function anchors(markdown) {
  return new Set(headings(markdown).map((heading) => heading.id));
}
