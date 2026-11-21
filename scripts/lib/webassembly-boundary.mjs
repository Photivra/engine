// SPDX-License-Identifier: Apache-2.0

/**
 * #659: WebAssembly stays limited to the opt-in JPEG XL decoder, which the application loads and passes in
 * (`createJxlOxideDngDecoder`; THIRD_PARTY.md, "JPEG XL (2.22.0)"). No engine module may import, fetch, compile or
 * instantiate WebAssembly. `findWebAssemblyUse` reads a module with the TypeScript parser, so comments never count and
 * string contents are judged as strings. It reports:
 * - the identifier `WebAssembly` (`WebAssembly.instantiate`, `globalThis.WebAssembly`, a property of that name);
 * - a string or template-literal part naming WebAssembly, a `.wasm` file or the `application/wasm` media type;
 * - a module specifier that is not a relative engine module (read as scripts/lib/browser-surface.mjs reads them), which is how
 *   `import … from "jxl-oxide-wasm"` and `await import("jxl-oxide-wasm")` fail; `node:` is allowed with `allowNodeBuiltins`,
 *   for the repository-only src/api/.
 * Run by `npm run check:browser-surface` on every file under src/ and by test/webassembly-boundary.test.ts.
 */
import ts from "typescript";
import { importedModules } from "./browser-surface.mjs";

/** The src/ files (relative to src/) whose text may mention WebAssembly at all, comments included. */
export const WEBASSEMBLY_MENTION_ALLOWLIST = ["capture/jpeg-xl-tiles.ts"];

const NAMES_WEBASSEMBLY = /(?:^|[^A-Za-z])WebAssembly(?:[^A-Za-z]|$)|\.wasm(?:\b|$)|application\/wasm/u;

/** Whether a text mentions WebAssembly anywhere, comments included (for the mention allowlist). */
export function mentionsWebAssembly(text) {
  return /wasm|webassembly/iu.test(text);
}

/** The uses of WebAssembly in one module's text, as `line N: …` strings; empty when there is none. */
export function findWebAssemblyUse(text, { allowNodeBuiltins = false } = {}) {
  const file = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits = [];
  const line = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === "WebAssembly") {
      hits.push(`line ${line(node)}: identifier WebAssembly`);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      NAMES_WEBASSEMBLY.test(node.text)
    ) {
      hits.push(`line ${line(node)}: string names WebAssembly: ${JSON.stringify(node.text)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const { specifier, pos } of importedModules(text)) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) continue;
    if (allowNodeBuiltins && specifier.startsWith("node:")) continue;
    hits.push(`line ${file.getLineAndCharacterOfPosition(pos).line + 1}: imports "${specifier}", which is not a relative engine module`);
  }
  return hits;
}
