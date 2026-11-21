// SPDX-License-Identifier: Apache-2.0

/**
 * Browser-surface gate: the published package must stay browser-safe (AGENTS.md, "Code").
 *
 * 1. Walk the source graph from src/index.ts, following static imports, re-exports, `import()` and `require()`; every
 *    Node built-in and every non-relative specifier fails (the package has no runtime dependencies), as does reaching
 *    src/api/ (scripts/lib/browser-surface.mjs, #695).
 * 2. Every src/ module that package.json's `files` would publish must be reached by that walk, so no loading style can
 *    hide shipped code from step 1 (`capture-12`).
 * 3. Type-check src/ (src/api/ excepted) without Node's type definitions (tsconfig.browser.json), so a Node global such
 *    as `process`, `Buffer` or `__dirname` fails here rather than in a browser.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stdout } from "node:process";
import ts from "typescript";
import { unvisitedPublished, walkSourceGraph } from "./lib/browser-surface.mjs";

const sourceRoot = path.resolve("src");
const { visited, violations } = walkSourceGraph(path.join(sourceRoot, "index.ts"), {
  sourceRoot,
  read: (file) => readFileSync(file, "utf8")
});

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src"], { encoding: "utf8" })
  .split("\n").filter(Boolean);
const reached = new Set([...visited].map((file) => path.relative(".", file).replaceAll("\\", "/")));
for (const module of unvisitedPublished(files, reached, manifest.files)) {
  violations.push(`${module} is published but not reachable from src/index.ts by any import, so this gate would not read it.`);
}

const config = ts.readConfigFile("tsconfig.browser.json", ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ".");
const program = ts.createProgram(parsed.fileNames, parsed.options);
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  const where = diagnostic.file
    ? `${path.relative(".", diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}`
    : "tsconfig.browser.json";
  violations.push(`${where} does not type-check without Node's types: ${message}`);
}

if (violations.length > 0) {
  throw new Error(["Browser package surface check failed:", ...violations.map((violation) => `- ${violation}`)].join("\n"));
}

stdout.write(
  `Browser package surface check passed across ${visited.size} reachable source modules; ` +
    `${parsed.fileNames.length} source files type-check without Node's types.\n`
);
