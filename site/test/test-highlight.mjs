// SPDX-License-Identifier: Apache-2.0
// Build-time syntax coloring of code blocks (#757): escaping, the six short classes, plain text for other languages.
import assert from "node:assert/strict";
import test from "node:test";
import { highlight, shortClass } from "../lib/highlight.mjs";
import { decodeEntities, escapeHtml } from "../lib/html.mjs";
import { loadDocument, renderTokens } from "../lib/markdown.mjs";

/** The text a reader selects and copies: the markup without its tags. */
const plain = (html) => decodeEntities(html.replace(/<[^>]+>/gu, ""));

test("TypeScript gets the six short classes and nothing else, and copies back as the code", () => {
  const code = [
    "import { simulateCapture } from \"@photivra/engine\";",
    "// a comment with <tags> & 'quotes'",
    "export const result = await simulateCapture({ width: 64, fast: true, label: `id ${a.id}` }) as Result<number>;",
    "console.log(new Error(\"x\"), MAX_SITES, null);"
  ].join("\n");
  const html = highlight(code, "ts");
  assert.equal(plain(html), code);
  assert.deepEqual([...new Set([...html.matchAll(/<span class="([^"]*)">/gu)].map((m) => m[1]))].sort(), ["c", "f", "k", "n", "s", "t"]);
  assert.doesNotMatch(html, /style=|hljs|<span(?! class="[cfknst]">)/u);
  assert.match(html, /<span class="k">import<\/span>/u);
  assert.match(html, /<span class="k">export const<\/span>/u);
  assert.match(html, /<span class="s">&quot;@photivra\/engine&quot;<\/span>/u);
  assert.match(html, /<span class="c">\/\/ a comment with &lt;tags&gt; &amp; &#39;quotes&#39;<\/span>/u);
  assert.match(html, /<span class="f">simulateCapture<\/span>/u);
  assert.match(html, /<span class="n">64<\/span>/u);
  assert.match(html, /<span class="t">number<\/span>/u);
  // The code inside a template string's ${…} is not colored as a string.
  assert.match(html, /<span class="s">`id <\/span>\$\{a.id\}<span class="s">`<\/span>/u);
  // No nested spans.
  assert.doesNotMatch(html, /<span[^>]*>[^<]*<span/u);
});

test("shell and JSON are colored; JavaScript uses the TypeScript grammar", () => {
  assert.equal(highlight("npm install @photivra/engine # the package", "sh"), "npm install @photivra/engine <span class=\"c\"># the package</span>");
  assert.equal(highlight("{\"a\": 1, \"b\": \"x\"}", "json"), "{&quot;a&quot;: <span class=\"n\">1</span>, &quot;b&quot;: <span class=\"s\">&quot;x&quot;</span>}");
  assert.equal(highlight("const a = 1;", "js"), highlight("const a = 1;", "ts"));
});

test("an unknown or missing language is left plain and escaped as before", () => {
  for (const lang of ["text", "", undefined, "python"]) assert.equal(highlight("a <b> & \"c\"", lang), escapeHtml("a <b> & \"c\""));
});

test("the class map", () => {
  assert.equal(shortClass("hljs-keyword"), "k");
  assert.equal(shortClass("hljs-string"), "s");
  assert.equal(shortClass("hljs-number"), "n");
  assert.equal(shortClass("hljs-literal"), "n");
  assert.equal(shortClass("hljs-variable constant_"), "n");
  assert.equal(shortClass("hljs-comment"), "c");
  assert.equal(shortClass("hljs-title function_"), "f");
  assert.equal(shortClass("hljs-title function_ invoke__"), "f");
  assert.equal(shortClass("hljs-title class_"), "t");
  assert.equal(shortClass("hljs-built_in"), "t");
  assert.equal(shortClass("hljs-variable language_"), "t");
  assert.equal(shortClass("hljs-subst"), null);
  assert.equal(shortClass("hljs-attr"), undefined);
  assert.equal(shortClass("hljs-params"), undefined);
});

test("a Markdown code block renders colored inside its named, focusable region", () => {
  const doc = loadDocument("x.md", "# T\n\n```ts\nconst a = 1;\n```\n\n```text\nconst a = 1;\n```\n");
  const html = renderTokens(doc.tokens, { from: "x.md", links: { resolve: (href) => href } });
  assert.match(html, /<pre class="code" tabindex="0" role="region" aria-label="Example code 1"><code><span class="k">const<\/span> a = <span class="n">1<\/span>;<\/code><\/pre>/u);
  assert.match(html, /<pre class="code" tabindex="0" role="region" aria-label="Text 1"><code>const a = 1;<\/code><\/pre>/u);
});
