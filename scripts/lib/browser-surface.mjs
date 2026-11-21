// SPDX-License-Identifier: Apache-2.0

/**
 * The module walk of the browser-surface gate (scripts/check-browser-surface.mjs), kept apart so it can be tested on
 * in-memory trees (test/browser-surface-gate.test.ts). #695 and `capture-12`: the walk follows dynamic `import()` as well
 * as static imports, treats every Node built-in as Node-only, refuses any non-relative specifier (the package has no
 * runtime dependencies), and a separate check names every published module the walk did not reach.
 */
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";

/**
 * Module specifiers named by static imports and re-exports, side-effect imports, `import()` (also in `typeof import()`
 * types) and `require()`, in source order. TypeScript's pre-processor reads them, so comments and strings never count.
 * An `import()` whose argument is not a literal cannot be followed by any static check.
 */
export function extractSpecifiers(source) {
  return ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName);
}

const BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith("_")));

/** Whether a specifier names a Node built-in module (`node:` prefix, or a built-in's bare name, with or without a subpath). */
export function isNodeBuiltin(specifier) {
  return specifier.startsWith("node:") || BUILTINS.has(specifier) || BUILTINS.has(specifier.split("/")[0]);
}

function resolveSourceImport(importer, specifier) {
  const resolved = path.resolve(path.dirname(importer), specifier);
  if (resolved.endsWith(".js")) return resolved.slice(0, -3) + ".ts";
  if (path.extname(resolved) === "") return resolved + ".ts";
  return resolved;
}

/**
 * Walk the source graph from `entry` (an absolute path under `sourceRoot`), reading files with `read`. Returns the
 * visited absolute paths and the violations, each naming the importing module relative to `sourceRoot`.
 */
export function walkSourceGraph(entry, { sourceRoot, read }) {
  const visited = new Set();
  const violations = [];
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!file.startsWith(sourceRoot + path.sep) && !file.startsWith(sourceRoot + "/")) {
      violations.push(`${path.relative(sourceRoot, file)} escapes the engine source root.`);
      continue;
    }
    const relative = path.relative(sourceRoot, file).replaceAll("\\", "/");
    if (relative.startsWith("api/")) {
      violations.push(`${relative} is Node-only POC API code reachable from the root package export.`);
      continue;
    }
    for (const specifier of extractSpecifiers(read(file))) {
      if (isNodeBuiltin(specifier)) {
        violations.push(`${relative} imports Node-only module "${specifier}" from the browser package graph.`);
      } else if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        violations.push(`${relative} imports package "${specifier}"; engine modules import engine modules only (relative paths).`);
      } else {
        pending.push(resolveSourceImport(file, specifier));
      }
    }
  }
  return { visited, violations };
}

function globToRegExp(glob) {
  const body = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join("[^/]*");
  return new RegExp(`^${body}(?:/.*)?$`, "u");
}

/** Whether `package.json`'s `files` entries (in order; `!` excludes, `*` within one path segment) publish `file`. */
export function isPublished(file, patterns) {
  let published = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    if (globToRegExp(negated ? pattern.slice(1) : pattern).test(file)) published = !negated;
  }
  return published;
}

/**
 * The `src/` modules (relative to `src/`, `src/api/` excepted) whose compiled `dist/` file `patterns` would publish but
 * which are not in `visited` (repository-relative paths): shipped code the gate would otherwise never read.
 */
export function unvisitedPublished(files, visited, patterns) {
  return files
    .filter((file) => file.startsWith("src/") && file.endsWith(".ts") && !file.endsWith(".d.ts") && !file.startsWith("src/api/"))
    .filter((file) => !visited.has(file) && isPublished(`dist/${file.slice(4, -3)}.js`, patterns))
    .map((file) => file.slice(4))
    .sort();
}
