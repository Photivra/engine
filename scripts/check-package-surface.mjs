// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { platform, stdout } from "node:process";
import { declaredDependencyFields } from "./lib/dependency-fields.mjs";

const packageJson = JSON.parse(
  await readFile("package.json", "utf8")
);

const failures = [];
const fail = (message) => failures.push(message);

if (packageJson.scripts?.["start:poc-api"] !== undefined) {
  fail("Published package metadata must not advertise the repository-only POC API as an npm script.");
}

// npm runs these on install/pack/publish; the published manifest must declare none, because
// they would reference repository-only files (scripts/, src/, tsconfig) that are not shipped.
const LIFECYCLE_SCRIPTS = [
  "preinstall", "install", "postinstall", "prepare", "preprepare", "postprepare",
  "prepack", "postpack", "prepublish", "prepublishOnly", "publish", "postpublish",
  "dependencies", "preuninstall", "uninstall", "postuninstall"
];
for (const name of LIFECYCLE_SCRIPTS) {
  if (packageJson.scripts?.[name] !== undefined) fail(`Published manifest must not declare the "${name}" lifecycle script.`);
}

// Exact export map: the root scientific surface (ESM types/import plus a "default" condition so
// require(esm) consumers resolve it) and the manifest itself. No deep imports.
const expectedExports = JSON.stringify({
  ".": { types: "./dist/index.d.ts", import: "./dist/index.js", default: "./dist/index.js" },
  "./package.json": "./package.json"
});
if (JSON.stringify(packageJson.exports) !== expectedExports) {
  fail(`Published package exports must be exactly ${expectedExports}; found ${JSON.stringify(packageJson.exports)}`);
}

// #659: the package has no runtime dependency, so nothing it ships can bring WebAssembly (or anything else) along.
for (const field of declaredDependencyFields(packageJson)) {
  fail(`Published manifest must not declare ${field} (#659: the engine has no runtime dependency).`);
}

const raw = execFileSync(
  platform === "win32" ? "npm.cmd" : "npm",
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  }
);

const pack = JSON.parse(raw);
const entry = pack[0];
if (entry === undefined || !Array.isArray(entry.files)) {
  throw new Error("npm pack dry run did not return a file manifest.");
}

const paths = entry.files.map((file) => file.path);
const packedPaths = new Set(paths);

// Everything outside dist/ must be one of these user-facing files. Validation evidence,
// benchmarks, release/audit records and agent/governance files stay in the repository.
const USER_FILES = new Set([
  "package.json", "README.md", "LICENSE", "NOTICE", "CHANGELOG.md", "CITATION.cff",
  "SECURITY.md", "NODE_SUPPORT.md", "THIRD_PARTY.md", "llms.txt", "docs/USAGE.md", "docs/QUICK_START.md",
  "docs/AGENT_GUIDE.md", "docs/API_REFERENCE.md"
]);
const USER_DIRECTORIES = ["docs/api/", "docs/examples/"];
for (const path of paths) {
  if (path.startsWith("dist/")) continue;
  if (!USER_FILES.has(path) && !USER_DIRECTORIES.some((prefix) => path.startsWith(prefix))) {
    fail(`Published package contains a non-user file: ${path}`);
  }
}
for (const path of paths) {
  if (/\.wasm$/iu.test(path)) fail(`Published package contains a WebAssembly file: ${path} (#659).`);
}
for (const required of [...USER_FILES, "dist/index.js", "dist/index.d.ts"]) {
  if (!packedPaths.has(required)) fail(`Published package is missing required file: ${required}`);
}

const forbidden = paths.filter(
  (path) =>
    path.startsWith("dist/api/") ||
    path.startsWith("src/") ||
    path.startsWith("test/") ||
    path.startsWith("scripts/") ||
    path.startsWith(".githooks/")
);
for (const path of forbidden) fail(`Published package contains repository-only file: ${path}`);

const relativeSpecifiers = (text) =>
  [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/gu)].map((match) => match[1]);

// Runtime graph: every packed module is reachable from dist/index.js and every import is packed.
const reachable = new Set();
const pending = ["dist/index.js"];
while (pending.length > 0) {
  const path = pending.pop();
  if (reachable.has(path)) continue;
  reachable.add(path);
  if (!packedPaths.has(path)) {
    fail(`Root export graph references an unpacked module: ${path}`);
    continue;
  }
  for (const specifier of relativeSpecifiers(await readFile(path, "utf8"))) {
    pending.push(posix.normalize(posix.join(posix.dirname(path), specifier)));
  }
}
for (const path of paths) {
  if (path.startsWith("dist/") && path.endsWith(".js") && !reachable.has(path)) {
    fail(`Published package contains a module unreachable from the root export: ${path}`);
  }
}

// Declaration graph: every packed .d.ts import resolves to a packed declaration, and every
// reachable runtime module ships its declaration.
for (const path of paths.filter((p) => p.endsWith(".d.ts"))) {
  for (const specifier of relativeSpecifiers(await readFile(path, "utf8"))) {
    const target = posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.js$/u, ".d.ts");
    if (!packedPaths.has(target)) fail(`Declaration ${path} references an unpacked declaration: ${target}`);
  }
}
for (const path of reachable) {
  if (!packedPaths.has(path.replace(/\.js$/u, ".d.ts"))) fail(`Reachable module lacks a packed declaration: ${path}`);
}

// Source maps must be usable without the unshipped src/: sources are inlined, and declaration
// maps (which cannot embed sources) are not shipped.
for (const path of paths) {
  if (path.endsWith(".d.ts.map")) {
    fail(`Published package contains a declaration map pointing at unshipped sources: ${path}`);
  } else if (path.endsWith(".js.map")) {
    const map = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(map.sources) || !Array.isArray(map.sourcesContent) ||
        map.sourcesContent.length !== map.sources.length ||
        map.sourcesContent.some((content) => typeof content !== "string" || content.length === 0)) {
      fail(`Source map lacks inline sourcesContent for every source: ${path}`);
    }
  }
}

// Relative Markdown links inside the package must resolve inside the package; repository-only
// targets use absolute GitHub URLs (validated by docs:check).
// Known coordinator-owned exception: CHANGELOG.md links docs/NATIVE_RAW_AND_PRINT.md relatively.
// Remove this entry once that link is made absolute.
const LINK_EXCEPTIONS = new Set();
for (const path of paths.filter((p) => p.endsWith(".md"))) {
  const prose = (await readFile(path, "utf8")).replace(/```[\s\S]*?```/gu, "");
  for (const match of prose.matchAll(/\]\(([^\s)]+)\)/gu)) {
    const destination = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/iu.test(destination)) continue;
    const target = posix.normalize(posix.join(posix.dirname(path), destination.split("#")[0]));
    if (!packedPaths.has(target) && !LINK_EXCEPTIONS.has(`${path} -> ${destination}`)) {
      fail(`Packed Markdown ${path} links to an unpacked file: ${destination}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(["Package surface check failed:", ...failures.map((message) => `- ${message}`)].join("\n"));
}

stdout.write(
  `Package surface check passed: ${paths.length} files, ${entry.size} bytes packed, ${entry.unpackedSize} unpacked; ` +
  `root export plus ./package.json; ${reachable.size} reachable modules; inline-source maps; no lifecycle scripts; local POC API excluded.\n`
);
