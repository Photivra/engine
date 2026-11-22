// SPDX-License-Identifier: Apache-2.0
// The search page (docs/design/engine-site.md, section 6): one HTML page listing every task, export, module and guide
// section as plain links. Without JavaScript it is a complete A to Z index; site/assets/search.js filters it.
import { escapeHtml, plural } from "./html.mjs";

/**
 * @param {{ tasks: {label: string, href: string, functions: string[]}[], exports: {name: string, kind: string, href: string, module: string}[],
 *   modules: {path: string, href: string, counts: string}[], sections: {title: string, href: string, document: string}[] }} index
 * @param {{ heading: string, hint: string, noScript: string }} text
 */
export function searchBody(index, text) {
  const exportsByLetter = new Map();
  for (const item of [...index.exports].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.name.localeCompare(b.name))) {
    const letter = /^[a-z]/iu.test(item.name) ? item.name[0].toUpperCase() : "#";
    if (!exportsByLetter.has(letter)) exportsByLetter.set(letter, []);
    exportsByLetter.get(letter).push(item);
  }
  const letters = [...exportsByLetter.keys()];
  const row = (href, label, what, code = true) => `<li><a href="${escapeHtml(href)}">${code ? `<code>${escapeHtml(label)}</code>` : escapeHtml(label)}</a><span class="what">${what}</span></li>`;
  const tasks = index.tasks.map((task) => row(task.href, task.label, `Task index · ${task.functions.map((name) => `<code>${escapeHtml(name)}</code>`).join(", ")}`, false)).join("\n");
  const exportsHtml = letters.map((letter) => `<h3 id="letter-${letter === "#" ? "other" : letter.toLowerCase()}">${letter}</h3>
<ul class="results">
${exportsByLetter.get(letter).map((item) => row(item.href, item.name, `${item.kind} · ${escapeHtml(item.module)}`)).join("\n")}
</ul>`).join("\n");
  const modules = [...index.modules].sort((a, b) => a.path.localeCompare(b.path)).map((item) => row(item.href, item.path, `Module · ${escapeHtml(item.counts)}`)).join("\n");
  const sections = index.sections.map((item) => row(item.href, item.title, `Guide · ${escapeHtml(item.document)}`, false)).join("\n");
  const letterRow = letters.map((letter) => `<li><a href="#letter-${letter === "#" ? "other" : letter.toLowerCase()}">${letter}</a></li>`).join("");
  return `<div class="wrap searchpage">
<h1>${escapeHtml(text.heading)}</h1>
<form class="bigsearch" role="search" aria-label="Filter this index" action="/search/" method="get"><label class="sr-only" for="sq">Search the API and guides</label><input type="search" id="sq" name="q" autocomplete="off" spellcheck="false" aria-describedby="shint"><button type="submit">Search</button></form>
<p id="shint" class="small muted">${escapeHtml(text.hint)}</p>
<p id="noscript-note" class="note">${escapeHtml(text.noScript)}</p>
<p id="search-status" role="status" class="small"></p>
<nav aria-label="Lists on this page"><ul class="jumps">
<li><a href="#r-tasks">Tasks (${index.tasks.length})</a></li><li><a href="#r-exports">Exports (${index.exports.length.toLocaleString("en-US")})</a></li><li><a href="#r-modules">Modules (${index.modules.length})</a></li><li><a href="#r-sections">Guide sections (${index.sections.length})</a></li>
</ul></nav>
<section data-list="task" aria-labelledby="r-tasks">
<h2 id="r-tasks">Tasks</h2>
<ul class="results">
${tasks}
</ul>
</section>
<section data-list="export" aria-labelledby="r-exports">
<h2 id="r-exports">Exports</h2>
<nav aria-label="Exports by first letter"><ul class="letters">${letterRow}</ul></nav>
${exportsHtml}
</section>
<section data-list="module" aria-labelledby="r-modules">
<h2 id="r-modules">Modules</h2>
<ul class="results">
${modules}
</ul>
</section>
<section data-list="section" aria-labelledby="r-sections">
<h2 id="r-sections">Guide sections</h2>
<ul class="results">
${sections}
</ul>
</section>
</div>`;
}

/** "3 functions, 1 constant and 2 types". */
export function countPhrase(counts) {
  const parts = [];
  if (counts.Function) parts.push(plural(counts.Function, "function"));
  if (counts.Class) parts.push(plural(counts.Class, "class", "classes"));
  if (counts.Constant) parts.push(plural(counts.Constant, "constant"));
  if (counts.Type) parts.push(plural(counts.Type, "type"));
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
