// SPDX-License-Identifier: Apache-2.0
// Every check of section 15 over the built site, in order, each reported on its own; exits non-zero if any fails.
// The workflow runs each as its own step instead, so a failing check is named in the run.
//
//   npm run check --prefix site               # over _site/
//   node site/checks/run-all.mjs <dir> [--no-browser]
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : `${root}_site`;
const steps = [
  ["requests", [`${here}requests.mjs`, directory]],
  ["links", [`${here}links.mjs`, directory]],
  ["meta", [`${here}meta.mjs`, directory]],
  ["budgets", [`${here}budgets.mjs`, directory]],
  ["fonts", [`${here}fonts.mjs`, directory]],
  ["html", [`${here}html.mjs`, directory]],
  ["identity", [`${root}scripts/check-project-identity.mjs`, "--dir", directory]],
  ...(process.argv.includes("--no-browser") ? [] : [["browser", [`${here}browser.mjs`, directory]], ["lighthouse", [`${here}lighthouse.mjs`, directory]]])
];
const failed = [];
for (const [name, args] of steps) {
  process.stdout.write(`\n> site check: ${name}\n`);
  try {
    execFileSync(process.execPath, args, { stdio: "inherit", cwd: root });
  } catch {
    failed.push(name);
  }
}
if (failed.length) {
  process.stderr.write(`\nSite checks failed: ${failed.join(", ")}\n`);
  process.exitCode = 1;
} else process.stdout.write(`\nAll ${steps.length} site checks passed.\n`);
