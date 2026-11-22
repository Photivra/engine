// SPDX-License-Identifier: Apache-2.0

// Dependency licence policy over npm lockfiles.
//
// Usage: node scripts/check-license-policy.mjs [<package-lock.json> ...]
//
// With no argument it reads the root package-lock.json. The documentation site's tools have a lockfile of their own
// (site/package-lock.json, #669), checked by a second call: `node scripts/check-license-policy.mjs site/package-lock.json`.

import { readFile } from "node:fs/promises";
import process, { argv, stdout } from "node:process";
import { pathToFileURL } from "node:url";

const ALWAYS_ALLOWED = new Set([
  "Apache-2.0",
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "BlueOak-1.0.0"
]);

/**
 * Allowed for development dependencies only: the Mozilla licence (axe-core and lightningcss) and, from 2.28.0, the zero-clause
 * BSD licence of tslib in the Tailwind CSS CLI's tree (site/package-lock.json, #669; approved by the owner on 2026-11-21).
 */
const DEV_ONLY_ALLOWED = new Set(["MPL-2.0", "0BSD"]);

/**
 * Whether one package's declared licence passes. An SPDX disjunction (OR) lets the project choose one licence, so it passes
 * when one choice is allowed; an expression with AND or WITH must be allowed as a whole (ci-11 in #703: a conjunction of two
 * disjunctions must not pass because one of its words is allowed).
 * @param {string} license
 * @param {boolean} dev
 */
export function licenseAllowed(license, dev) {
  const allowed = (identifier) => ALWAYS_ALLOWED.has(identifier) || (dev && DEV_ONLY_ALLOWED.has(identifier));
  if (allowed(license)) return true;
  if (/\b(?:AND|WITH)\b/u.test(license)) return false;
  let expression = license.trim();
  if (expression.startsWith("(") && expression.endsWith(")") && !/[()]/u.test(expression.slice(1, -1))) expression = expression.slice(1, -1);
  if (/[()]/u.test(expression)) return false;
  const choices = expression.split(" OR ").map((choice) => choice.trim());
  return choices.length > 1 && choices.some(allowed);
}

/**
 * Checks every package of one lockfile. A local link entry (`"link": true`) is checked at the package it points to.
 * @param {{ packages?: Record<string, unknown> }} lockfile
 * @param {string} name The lockfile's path, for messages.
 */
export function checkLockfile(lockfile, name) {
  const packages = lockfile.packages;
  if (packages === undefined || typeof packages !== "object" || packages === null) {
    throw new Error(`${name} does not contain a packages map.`);
  }
  const violations = [];
  const counts = new Map();
  for (const [path, metadata] of Object.entries(packages)) {
    if (path === "") continue;
    if (typeof metadata !== "object" || metadata === null) {
      violations.push(`${name}: ${path}: invalid package metadata`);
      continue;
    }
    if (metadata.link === true) {
      if (typeof metadata.resolved !== "string" || !(metadata.resolved in packages)) violations.push(`${name}: ${path}: link to a package outside the lockfile`);
      continue;
    }
    const license = metadata.license;
    if (typeof license !== "string" || license.trim().length === 0) {
      violations.push(`${name}: ${path}: missing license metadata`);
      continue;
    }
    counts.set(license, (counts.get(license) ?? 0) + 1);
    if (!licenseAllowed(license, metadata.dev === true)) violations.push(`${name}: ${path}: license ${license} is not allowed by the current policy`);
  }
  return { violations, counts };
}

async function main(files) {
  const violations = [];
  const summaries = [];
  for (const file of files) {
    const result = checkLockfile(JSON.parse(await readFile(file, "utf8")), file);
    violations.push(...result.violations);
    const summary = [...result.counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([license, count]) => `${license}=${count}`)
      .join(", ");
    summaries.push(files.length > 1 || file !== "package-lock.json" ? `${file}: ${summary}` : summary);
  }
  if (violations.length > 0) {
    throw new Error(
      [
        "Dependency license policy failed:",
        ...violations.map((violation) => `- ${violation}`),
        "Review any new license before changing the allowlist."
      ].join("\n")
    );
  }
  stdout.write(`Dependency license policy passed: ${summaries.join("; ")}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(argv.length > 2 ? argv.slice(2) : ["package-lock.json"]);
}
