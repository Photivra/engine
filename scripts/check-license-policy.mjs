// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { stdout } from "node:process";

const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
const packages = lockfile.packages;

if (packages === undefined || typeof packages !== "object" || packages === null) {
  throw new Error("package-lock.json does not contain a packages map.");
}

const ALWAYS_ALLOWED = new Set([
  "Apache-2.0",
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "BlueOak-1.0.0"
]);

const violations = [];
const counts = new Map();

for (const [path, metadata] of Object.entries(packages)) {
  if (path === "") {
    continue;
  }

  if (typeof metadata !== "object" || metadata === null) {
    violations.push(`${path}: invalid package metadata`);
    continue;
  }

  const license = metadata.license;
  if (typeof license !== "string" || license.trim().length === 0) {
    violations.push(`${path}: missing license metadata`);
    continue;
  }

  counts.set(license, (counts.get(license) ?? 0) + 1);

  if (ALWAYS_ALLOWED.has(license)) {
    continue;
  }

  // An SPDX disjunction ("MIT OR Apache-2.0") lets the project choose one licence: it passes when one choice is allowed.
  const choices = license.replace(/^\((.*)\)$/u, "$1").split(" OR ");
  if (choices.length > 1 && choices.some((choice) => ALWAYS_ALLOWED.has(choice.trim()))) {
    continue;
  }

  if (license === "MPL-2.0" && metadata.dev === true) {
    continue;
  }

  violations.push(
    `${path}: license ${license} is not allowed by the current policy`
  );
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

const summary = [...counts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([license, count]) => `${license}=${count}`)
  .join(", ");

stdout.write(`Dependency license policy passed: ${summary}\n`);
