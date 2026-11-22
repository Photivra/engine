// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process, { stdout } from "node:process";
import { pathToFileURL } from "node:url";

// site: the documentation site's generator, checks and tools (#669); its installed tools are skipped.
// test and .github: every test and CI tool (ci-15 in #703); the root's own configuration files are read too, with no
// exceptions list (owner decision 2026-11-21).
const ROOTS = ["src", "scripts", "site", "test", ".github"];
const SKIP = new Set(["node_modules", ".cache"]);
const SOURCE = /\.(?:ts|mts|cts|js|mjs|cjs)$/u;
const EXPECTED = "// SPDX-License-Identifier: Apache-2.0";

/**
 * The source files under `directory` (the repository root) that do not start with the Apache-2.0 SPDX header: every
 * TypeScript or JavaScript file under ROOTS, and those at the root itself (vitest.config.ts, eslint.config.js, ...).
 * @param {string} directory
 * @returns {Promise<string[]>} Paths relative to `directory`, with `/` separators, sorted.
 */
export async function licenseHeaderViolations(directory = ".") {
  const violations = [];
  const check = async (fullPath) => {
    if (!SOURCE.test(fullPath)) return;
    const content = await readFile(fullPath, "utf8");
    if (!content.startsWith(EXPECTED)) violations.push(path.relative(directory, fullPath).split(path.sep).join("/"));
  };
  const walk = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT" && current !== directory) return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) await walk(fullPath);
      } else if (entry.isFile()) {
        await check(fullPath);
      }
    }
  };
  for (const root of ROOTS) await walk(path.join(directory, root));
  for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isFile()) await check(path.join(directory, entry.name));
  return violations.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = await licenseHeaderViolations(".");
  if (violations.length > 0) {
    throw new Error(["SPDX license-header check failed:", ...violations.map((file) => `- ${file}`)].join("\n"));
  }
  stdout.write(`SPDX license-header check passed for ${ROOTS.join(", ")} and the root's files.\n`);
}
