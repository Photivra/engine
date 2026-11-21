// SPDX-License-Identifier: Apache-2.0

/**
 * Repository-only fast local gates for `npm run prepush` and the .githooks/pre-push hook.
 * Runs every gate even after a failure and reports all failures at the end. The test
 * suite, coverage, build, packed-consumer and package-surface checks stay in CI and
 * the full `npm run check` / `npm run coverage` / `npm run build` / `npm run pack:check` path.
 */
import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";

const gates = [
  ["lint", ["node_modules/eslint/bin/eslint.js", "."]],
  ["typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["licenses", ["scripts/check-license-policy.mjs"]],
  ["site tool licenses", ["scripts/check-license-policy.mjs", "site/package-lock.json"]],
  ["gate unit tests", ["--test", "scripts/test-gates.mjs"]],
  ["license headers", ["scripts/check-license-headers.mjs"]],
  ["identity", ["scripts/check-project-identity.mjs"]],
  ["browser surface", ["scripts/check-browser-surface.mjs"]],
  ["generated docs and navigation", ["scripts/check-release-docs.mjs"]]
];

const failures = [];
for (const [name, args] of gates) {
  console.log(`\n> prepush: ${name}`);
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) failures.push(result.error ? `${name} (${result.error.message})` : name);
}

if (failures.length > 0) {
  console.error(`\nprepush failed ${failures.length} of ${gates.length} gates:\n${failures.map((name) => `- ${name}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`\nprepush passed ${gates.length} gates. CI still runs tests, coverage, build and package checks.`);
}
