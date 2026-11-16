// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";

const ROOT_FILES = [
  "AGENTS.md",
  "CHANGELOG.md",
  "CITATION.cff",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "THIRD_PARTY.md",
  "NOTICE",
  "package.json",
  "package-lock.json",
  "llms.txt"
];

const ROOT_DIRS = [".github", "docs", "src", "test", "scripts"];
const TEXT_EXTENSIONS = new Set([".md", ".ts", ".json", ".yml", ".yaml", ".mjs"]);
const LEGACY_TOKENS = [
  "Exposure" + " Forge",
  "exposure" + "-forge",
  "EXPOSURE" + "_FORGE"
];

// Private test deployments must never be named in this public repository: any host name
// that contains "staging" (for example a staging subdomain) fails the check. The word on its
// own is fine (WebGPU "staging buffers" use it).
const PRIVATE_HOST = new RegExp(
  "\\b[a-z0-9-]*" + "staging" + "[a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:com|dev|app|net|org|io|pages\\.dev|workers\\.dev)\\b",
  "i"
);

// #627: the repository was renamed to Photivra/engine (2026-11-12). Links to the former name
// (the organization followed by the old repository name) must not come back.
const FORMER_REPOSITORY = new RegExp("\\bPhotivra/" + "photivra\\b", "i");
const REPOSITORY_URL = "https://github.com/Photivra/engine";

const violations = [];

async function checkFile(file) {
  const content = await readFile(file, "utf8");
  for (const token of LEGACY_TOKENS) {
    if (content.includes(token)) {
      violations.push(`${file}: contains legacy project identifier ${JSON.stringify(token)}`);
    }
  }
  const former = content.match(FORMER_REPOSITORY);
  if (former) {
    violations.push(`${file}: links to the former repository name ${JSON.stringify(former[0])}; use Photivra/engine`);
  }
  const host = content.match(PRIVATE_HOST);
  if (host) {
    violations.push(`${file}: names a private test deployment host ${JSON.stringify(host[0])}`);
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXTENSIONS.has(path.extname(fullPath))) continue;
    await checkFile(fullPath);
  }
}

for (const file of ROOT_FILES) {
  await checkFile(file);
}
for (const directory of ROOT_DIRS) {
  await walk(directory);
}

// The published package's links must name the repository exactly.
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const expectedLinks = [
  ["repository.url", manifest.repository?.url, `git+${REPOSITORY_URL}.git`],
  ["bugs.url", manifest.bugs?.url, `${REPOSITORY_URL}/issues`],
  ["homepage", manifest.homepage, `${REPOSITORY_URL}#readme`]
];
for (const [field, actual, expected] of expectedLinks) {
  if (actual !== expected) {
    violations.push(`package.json: ${field} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
  }
}

if (violations.length > 0) {
  throw new Error(
    ["Photivra identity check failed:", ...violations.map((v) => `- ${v}`)].join("\n")
  );
}

stdout.write("Photivra identity check passed; no legacy project identifiers, former repository links or private hosts found.\n");
