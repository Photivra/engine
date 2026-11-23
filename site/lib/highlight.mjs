// SPDX-License-Identifier: Apache-2.0
// Syntax coloring of code blocks at build time (#757). highlight.js (BSD-3-Clause, a pinned development dependency of
// site/) finds the tokens; its classes are mapped to six short ones, so a page carries a few bytes per token, and the
// colors come from site.css through those classes (no inline styles: the Content-Security-Policy is unchanged).
// The output is flat: one span per run of text in one class, no nesting, and nothing but the code's own text, so
// selecting and copying a block gives the plain code.
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import { escapeHtml, decodeEntities } from "./html.mjs";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);

/** Fence labels the site colors, and the grammar for each. JavaScript examples are read with the TypeScript grammar. */
export const HIGHLIGHT_LANGUAGES = Object.freeze({
  ts: "typescript", typescript: "typescript", js: "typescript", javascript: "typescript",
  sh: "bash", bash: "bash", shell: "bash", json: "json"
});

/**
 * The short class of a highlight.js scope: `k` keyword, `s` string, `n` number (and literals and constants), `c` comment,
 * `f` function name, `t` type (and built-in names). `null` resets to plain text (the code inside a template string's
 * `${…}`); `undefined` keeps the enclosing class.
 */
export function shortClass(scope) {
  const [head, ...rest] = scope.split(" ").map((part) => part.replace(/^hljs-/u, ""));
  if (head === "subst") return null;
  if (head === "keyword" || head === "meta") return "k";
  if (head === "string" || head === "regexp") return "s";
  if (head === "number" || head === "literal") return "n";
  if (head === "comment") return "c";
  if (head === "type" || head === "built_in") return "t";
  if (head === "title") return rest.includes("function_") ? "f" : "t";
  if (head === "variable") return rest.includes("language_") ? "t" : rest.includes("constant_") ? "n" : undefined;
  return undefined;
}

/** Plain text and its short class, in order, from highlight.js's HTML (spans and escaped text only). */
function runs(html) {
  const out = [];
  const stack = [];
  const current = () => {
    for (let index = stack.length - 1; index >= 0; index--) if (stack[index] !== undefined) return stack[index];
    return null;
  };
  for (const [, open, close, text] of html.matchAll(/<span class="([^"]*)">|(<\/span>)|([^<]+)/gu)) {
    if (open !== undefined) stack.push(shortClass(open));
    else if (close !== undefined) stack.pop();
    else {
      const kind = current();
      const value = decodeEntities(text.replace(/&#x27;/gu, "'"));
      if (out.length && out.at(-1).kind === kind) out.at(-1).text += value;
      else out.push({ kind, text: value });
    }
  }
  return out;
}

/**
 * The HTML inside a code block's `<code>`: colored spans for the languages of HIGHLIGHT_LANGUAGES, escaped plain text
 * for any other (an unknown or missing language is left plain).
 */
export function highlight(text, lang) {
  const language = HIGHLIGHT_LANGUAGES[(lang ?? "").toLowerCase()];
  if (!language) return escapeHtml(text);
  const pieces = runs(hljs.highlight(text, { language, ignoreIllegals: true }).value);
  if (pieces.map((piece) => piece.text).join("") !== text) throw new Error(`highlight: the ${language} tokens do not give back the code`);
  // Blank text between two runs of one class joins them (`export const` is one span).
  const merged = [];
  for (const piece of pieces) {
    const blank = !piece.text.trim();
    const last = merged.at(-1);
    const before = merged.at(-2);
    if (blank && last?.blank) last.text += piece.text;
    else if (blank) merged.push({ kind: null, text: piece.text, blank: true });
    else if (last?.blank && before && before.kind === piece.kind) {
      merged.pop();
      before.text += last.text + piece.text;
    } else if (last && !last.blank && last.kind === piece.kind) last.text += piece.text;
    else merged.push({ kind: piece.kind, text: piece.text });
  }
  return merged.map(({ kind, text: value }) => (kind ? `<span class="${kind}">${escapeHtml(value)}</span>` : escapeHtml(value))).join("");
}
