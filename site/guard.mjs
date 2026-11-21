// SPDX-License-Identifier: Apache-2.0
// The publication guard (docs/design/engine-site.md, 14.3): a push to main or a manual run deploys only when the changelog's
// newest section is package.json's version and is marked published, so the site never shows a version that is not on npm.
// It reads only the repository and calls no registry. Prints `deploy=true|false` and the reason, and appends `deploy=` to
// $GITHUB_OUTPUT and the reason to $GITHUB_STEP_SUMMARY when they are set. It never fails: it decides.
//
//   node site/guard.mjs
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";
import { loadDocument } from "./lib/markdown.mjs";
import { publicationGuard } from "./lib/changelog.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const version = JSON.parse(read("package.json")).version;
const { deploy, reason } = publicationGuard(loadDocument("CHANGELOG.md", read("CHANGELOG.md")), version);
process.stdout.write(`Publication guard: ${deploy ? "deploy" : "no deploy"}: ${reason}.\ndeploy=${deploy}\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${deploy}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Publication guard: ${deploy ? "the site is deployed" : "nothing is deployed"}: ${reason}.\n`);
