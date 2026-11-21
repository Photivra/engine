// SPDX-License-Identifier: Apache-2.0
// Escaping and small text helpers shared by the generator's modules.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

/** Escapes text for HTML content and attribute values. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/gu, (character) => ESCAPES[character]);
}

/** Decodes the few entities marked emits in token text, so text can be escaped once. */
export function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/&amp;/gu, "&");
}

/** "1 function", "2 functions". */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

/** "a", "a and b", "a, b and c". */
export function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The first sentence of a plain-text paragraph, cut at a word boundary to at most `limit` characters. */
export function firstSentence(text, limit = 160) {
  const clean = text.replace(/\s+/gu, " ").trim();
  const sentence = clean.match(/^.+?[.!?](?=\s+[A-Z0-9(`"“]|$)/u)?.[0] ?? clean;
  return cut(sentence, limit);
}

/** Cuts text at a word boundary to at most `limit` characters, ending with an ellipsis when cut. */
export function cut(text, limit) {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > limit / 2 ? head.slice(0, space) : head).replace(/[\s,;:]+$/u, "")}…`;
}

/** A date written as in the changelog ("November 19, 2026") from an ISO date. */
export function longDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[month - 1]} ${day}, ${year}`;
}

/** Fills `{name}` placeholders from an object; an unknown name is an error. */
export function fill(template, values) {
  return template.replace(/\{(\w+)\}/gu, (whole, name) => {
    if (!(name in values)) throw new Error(`No value for {${name}} in ${JSON.stringify(template)}`);
    return String(values[name]);
  });
}
