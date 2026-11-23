// SPDX-License-Identifier: Apache-2.0
// Markdown to HTML with marked: GitHub heading ids from the shared anchors module, link rewriting, named and focusable
// scroll regions for tables and code, code colored at build time (highlight.mjs), task lists without form controls, and
// raw HTML shown as text.
import { Marked } from "marked";
import { headings as sharedHeadings, headingSlug } from "../../scripts/lib/anchors.mjs";
import { escapeHtml, decodeEntities } from "./html.mjs";
import { highlight } from "./highlight.mjs";

let context = null;

const renderer = {
  heading(token) {
    const depth = Math.min(6, Math.max(1, token.depth + context.shift));
    let inner = this.parser.parseInline(token.tokens);
    const kind = token.depth === 2 ? context.exportKinds?.get(token.text) : undefined;
    if (kind) inner = `<code>${escapeHtml(token.text)}</code> <span class="kind">${kind}</span>`;
    context.lastHeading = plainInline(token.tokens);
    return `<h${depth} id="${escapeHtml(token._id)}">${inner}</h${depth}>\n`;
  },
  code(token) {
    const lang = (token.lang ?? "").split(/\s/u)[0];
    const kind = context.codeLabel(lang);
    const count = (context.regions.get(kind) ?? 0) + 1;
    context.regions.set(kind, count);
    const text = token.text.replace(/\n$/u, "");
    const figure = token._codeIndex !== undefined ? context.figures?.(token._codeIndex) ?? "" : "";
    return `<pre class="code" tabindex="0" role="region" aria-label="${escapeHtml(`${kind} ${count}`)}"><code>${highlight(text, lang)}</code></pre>\n${figure}`;
  },
  table(token) {
    context.tables++;
    const caption = `Table ${context.tables}${context.lastHeading ? ` under “${context.lastHeading}”` : ""}`;
    const align = (index) => (token.align[index] === "right" ? " class=\"num\"" : token.align[index] === "center" ? " class=\"center\"" : "");
    const head = token.header.map((cell, index) => `<th scope="col"${align(index)}>${this.parser.parseInline(cell.tokens)}</th>`).join("");
    const body = token.rows.map((row) => `<tr>${row.map((cell, index) => `<td${align(index)}>${this.parser.parseInline(cell.tokens)}</td>`).join("")}</tr>`).join("\n");
    return `<div class="scroll" tabindex="0" role="region" aria-label="${escapeHtml(caption)}"><table><caption class="sr-only">${escapeHtml(caption)}</caption>\n<thead><tr>${head}</tr></thead>\n<tbody>${body}</tbody></table></div>\n`;
  },
  link(token) {
    const href = context.link(token.href);
    return `<a href="${escapeHtml(href)}">${this.parser.parseInline(token.tokens)}</a>`;
  },
  html(token) {
    return escapeHtml(token.text);
  },
  image(token) {
    throw new Error(`${context.from}: images in Markdown are not supported by the site (${token.href})`);
  },
  checkbox({ checked }) {
    return `<span class="task${checked ? " done" : ""}" role="img" aria-label="${checked ? "Done" : "Not done"}"></span> `;
  }
};

const marked = new Marked({ gfm: true, breaks: false, renderer });

/** Plain text of inline tokens (links keep their text, code keeps its text, formatting is dropped). */
export function plainInline(tokens = []) {
  return tokens.map((token) => {
    if (token.tokens) return plainInline(token.tokens);
    if (token.type === "codespan" || token.type === "text" || token.type === "escape") return decodeEntities(token.text);
    if (token.type === "br") return " ";
    return decodeEntities(token.raw ?? "");
  }).join("");
}

/**
 * Lexes a Markdown file and annotates it: every heading gets its GitHub id from the shared anchors module (the build fails
 * if marked and that module disagree on the headings), every ts/js code block its index in the file (as
 * docs/validation/documentation-fragments.json counts them).
 */
export function loadDocument(path, text) {
  const tokens = marked.lexer(text);
  const expected = sharedHeadings(text);
  const found = [];
  let codeIndex = 0;
  marked.walkTokens(tokens, (token) => {
    if (token.type === "heading") found.push(token);
    if (token.type === "code" && /^(ts|typescript|js|javascript)$/u.test((token.lang ?? "").split(/\s/u)[0])) token._codeIndex = codeIndex++;
  });
  if (found.length !== expected.length) {
    throw new Error(`${path}: marked finds ${found.length} headings, scripts/lib/anchors.mjs ${expected.length}`);
  }
  found.forEach((token, index) => {
    const id = expected[index].id;
    if (!id.startsWith(headingSlug(token.text)) || expected[index].level !== token.depth) {
      throw new Error(`${path}: heading ${JSON.stringify(token.text)} disagrees with scripts/lib/anchors.mjs (${expected[index].text})`);
    }
    token._id = id;
  });
  const title = tokens.find((token) => token.type === "heading" && token.depth === 1);
  const sections = [];
  const preamble = [];
  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 2) sections.push({ heading: token, id: token._id, title: plainInline(token.tokens), tokens: [] });
    else if (sections.length) sections.at(-1).tokens.push(token);
    else preamble.push(token);
  }
  return {
    path,
    text,
    tokens,
    title: title ? plainInline(title.tokens) : undefined,
    titleToken: title,
    headings: found.map((token) => ({ depth: token.depth, id: token._id, text: plainInline(token.tokens) })),
    preamble,
    sections
  };
}

/** Every heading id inside a list of tokens (nested tokens included). */
export function idsIn(tokens) {
  const ids = [];
  marked.walkTokens(tokens, (token) => {
    if (token.type === "heading") ids.push(token._id);
  });
  return ids;
}

/** Every ts/js code block index inside a list of tokens. */
export function codeIndicesIn(tokens) {
  const indices = [];
  marked.walkTokens(tokens, (token) => {
    if (token._codeIndex !== undefined) indices.push(token._codeIndex);
  });
  return indices;
}

/** The first paragraph's plain text in a list of tokens, or undefined. */
export function firstParagraph(tokens) {
  const paragraph = tokens.find((token) => token.type === "paragraph");
  return paragraph ? plainInline(paragraph.tokens) : undefined;
}

const DEFAULT_LABELS = { ts: "Example code", typescript: "Example code", js: "Example code", javascript: "Example code", sh: "Command", bash: "Command", json: "Data", text: "Text" };

/**
 * Renders block tokens to HTML.
 * @param {object[]} tokens
 * @param {{ from: string, links: import("./links.mjs").LinkMap, shift?: number, exportKinds?: Map<string, string>,
 *   codeLabel?: (lang: string) => string, figures?: (index: number) => string | undefined, state?: object }} options
 *   `state` carries the per-page counters across several calls for one page.
 */
export function renderTokens(tokens, options) {
  const state = options.state ?? newRenderState();
  context = {
    from: options.from,
    shift: options.shift ?? 0,
    exportKinds: options.exportKinds,
    codeLabel: options.codeLabel ?? ((lang) => DEFAULT_LABELS[lang] ?? "Code"),
    figures: options.figures,
    link: (href) => options.links.resolve(href, options.from),
    regions: state.regions,
    lastHeading: state.lastHeading,
    tables: state.tables
  };
  try {
    return marked.parser(tokens);
  } finally {
    state.tables = context.tables;
    state.lastHeading = context.lastHeading;
    context = null;
  }
}

/** Renders inline Markdown (a sentence of site-only text or a card label) with the same link rules. */
export function renderInline(text, options) {
  const state = newRenderState();
  context = { from: options.from, shift: 0, link: (href) => options.links.resolve(href, options.from), regions: state.regions, tables: 0, codeLabel: () => "Code" };
  try {
    return marked.parseInline(text);
  } finally {
    context = null;
  }
}

/** Fresh per-page counters for region names and table captions. */
export function newRenderState() {
  return { regions: new Map(), tables: 0, lastHeading: undefined };
}

export { marked };
