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
  "package-lock.json"
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

const violations = [];

async function checkFile(file) {
  const content = await readFile(file, "utf8");
  for (const token of LEGACY_TOKENS) {
    if (content.includes(token)) {
      violations.push(`${file}: contains legacy project identifier ${JSON.stringify(token)}`);
    }
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

if (violations.length > 0) {
  throw new Error(
    ["Photivra identity check failed:", ...violations.map((v) => `- ${v}`)].join("\n")
  );
}

stdout.write("Photivra identity check passed; no legacy project identifiers or private hosts found.\n");
