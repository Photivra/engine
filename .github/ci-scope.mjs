// SPDX-License-Identifier: Apache-2.0
// Decides whether a change needs the test suite (Photivra/engine#510).
//
//   node .github/ci-scope.mjs <base-commit> [<head-commit>]
//
// It compares the two trees (no merge base or history needed): the pull request's test merge
// against its first parent, or a merge-queue commit against the queue's base, which counts
// every change queued ahead of it as well.
//
// Prints `tests=true` or `tests=false` (and appends it to $GITHUB_OUTPUT when set).
// `tests=false` only when every changed path is a Markdown file outside src/, test/,
// scripts/ and .github/, and no file under test/ or a Vitest config that uses the file
// system names its path outside a comment (the published src/ is browser-safe and reads no files), or is under
// site/ or docs/design/ (the documentation site and its design, #669).
// Anything else, an empty diff or a git error, gives `tests=true`: the rule fails
// towards running the tests. A docs-only change still runs the static, documentation,
// packed-consumer, package and licence gates, which read the Markdown.
import console from "node:console";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const testReaders = ["test"];
const testConfigs = /^vitest(\..+)?\.config\.ts$/;
const codeDirectories = /^(src|test|scripts|\.github)\//;
const fileSystem = /node:fs|from "fs|from 'fs|require\(["']fs|\bfs\./;
// #669 (#709, gap 2): the documentation site's sources and the design figures are no part of the engine and no test reads
// them; pages.yml builds and checks the site.
const siteOnly = /^(site|docs\/design)\//;

// A reader's text without its comments (ci-10 in #703): a path named only in a comment is not read. Strings are kept whole,
// so `//` inside a string (a URL) starts no comment. A text this misreads keeps more of itself, never less, except
// between a `//` or `/*` outside a string and the end of that comment.
const commentOrString = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
export function withoutComments(text) {
  return text.replace(commentOrString, (match, string) => string ?? (match.startsWith("/*") ? " " : ""));
}

export function docsOnlyReason(changed, readerTexts) {
  if (changed.length === 0) return "no changed files were found";
  for (const path of changed) {
    if (siteOnly.test(path)) continue;
    if (!path.endsWith(".md")) return `${path} is not Markdown`;
    if (codeDirectories.test(path)) return `${path} is under a code directory`;
    const reader = readerTexts.find(({ text }) => withoutComments(text).includes(path));
    if (reader) return `${path} is read by ${reader.file}`;
  }
  return undefined;
}

function listFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function readerTexts() {
  const files = [
    ...testReaders.flatMap(listFiles),
    ...readdirSync(".").filter((name) => testConfigs.test(name))
  ];
  return files.map((file) => ({ file, text: readFileSync(file, "utf8") })).filter(({ text }) => fileSystem.test(text));
}

function main([base, head = "HEAD"]) {
  let reason;
  try {
    if (!base) throw new Error("no base commit given");
    const changed = execFileSync("git", ["diff", "--name-only", "--no-renames", base, head], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    console.log(`Changed files (${changed.length}):\n${changed.map((path) => `  ${path}`).join("\n")}`);
    reason = docsOnlyReason(changed, readerTexts());
  } catch (error) {
    reason = `the change could not be classified (${error.message})`;
  }
  const tests = reason !== undefined;
  console.log(tests ? `Tests run: ${reason}.` : "Docs-only change: the test suite is skipped; every other gate runs.");
  console.log(`tests=${tests}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tests=${tests}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
