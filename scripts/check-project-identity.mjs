// SPDX-License-Identifier: Apache-2.0

// Identity gate (AGENTS.md, rule 4).
//
// Usage: node scripts/check-project-identity.mjs [--dir <directory>]
//
// Without arguments it reads every file git tracks or would track (`git ls-files --cached --others --exclude-standard`)
// that is text, and checks package.json's links. With --dir it reads every text file under that directory instead, for
// generated output that git ignores, such as the built documentation site (`--dir _site`, #669).

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process, { argv, stdout } from "node:process";
import { pathToFileURL } from "node:url";

/** Files that are not text, by extension; any other file is skipped only when its first 8 kB hold a NUL byte (#696). */
const BINARY_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".dng", ".icc", ".pdf", ".gz", ".jxl", ".woff2", ".ico"]);

const LEGACY_TOKENS = [
  "Exposure" + " Forge",
  "exposure" + "-forge",
  "EXPOSURE" + "_FORGE"
];

// Private test deployments must never be named in this public repository: any host name in which a label contains
// "staging" fails the check. The word on its own is fine (WebGPU "staging buffers", `staging.length` in code): a host
// needs a dot after that label and either a further label and a top-level domain of two or more letters
// (a host under any domain), or one of the listed domains. #696: before 2.28.0 only the listed
// domains counted.
const PRIVATE_HOST = new RegExp(
  "\\b(?:[a-z0-9-]+\\.)*[a-z0-9-]*" + "staging" + "[a-z0-9-]*(?:(?:\\.[a-z0-9-]+)+\\.[a-z]{2,}|\\.(?:com|dev|app|net|org|io))\\b",
  "i"
);

// #627: the repository was renamed to Photivra/engine (2026-11-12). Links to the former name
// (the organization followed by the old repository name) must not come back.
const FORMER_REPOSITORY = new RegExp("\\bPhotivra/" + "photivra\\b", "i");
const REPOSITORY_URL = "https://github.com/Photivra/engine";

// Validation records hold file names only: an absolute local path (a home or temporary directory) names the machine
// and user that wrote it.
const LOCAL_PATH = /(?<=^|["'`\s(=])(?:\/Users\/|\/home\/|\/private\/tmp\/|\/tmp\/)[^\s"'`)]*/;

/** The violations in one file's text. */
export function identityViolations(file, content) {
  const violations = [];
  for (const token of LEGACY_TOKENS) {
    if (content.includes(token)) {
      violations.push(`${file}: contains legacy project identifier ${JSON.stringify(token)}`);
    }
  }
  const former = content.match(FORMER_REPOSITORY);
  if (former) {
    violations.push(`${file}: links to the former repository name ${JSON.stringify(former[0])}; use Photivra/engine`);
  }
  const local = file.replaceAll("\\", "/").startsWith("docs/validation/") ? content.match(LOCAL_PATH) : null;
  if (local) {
    violations.push(`${file}: holds an absolute local path ${JSON.stringify(local[0])}; record the file name only`);
  }
  const host = content.match(PRIVATE_HOST);
  if (host) {
    violations.push(`${file}: names a private test deployment host ${JSON.stringify(host[0])}`);
  }
  return violations;
}

/** Whether a file is read as text: not a known binary type and no NUL byte in its first 8 kB. */
export function isText(file, bytes) {
  if (BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
  return !bytes.subarray(0, 8192).includes(0);
}

async function listDirectory(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)).sort();
}

async function main(args) {
  const dirIndex = args.indexOf("--dir");
  const directory = dirIndex >= 0 ? args[dirIndex + 1] : undefined;
  if (dirIndex >= 0 && !directory) throw new Error("--dir needs a directory");
  const files = directory
    ? await listDirectory(directory)
    : execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const violations = [];
  let scanned = 0;
  for (const file of files) {
    let bytes;
    try {
      bytes = await readFile(file);
    } catch (error) {
      if (error.code === "ENOENT") continue; // deleted in the working tree but still in the index
      throw error;
    }
    if (!isText(file, bytes)) continue;
    scanned++;
    violations.push(...identityViolations(file, bytes.toString("utf8")));
  }

  if (!directory) {
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
  }

  if (violations.length > 0) {
    throw new Error(
      ["Photivra identity check failed:", ...violations.map((v) => `- ${v}`)].join("\n")
    );
  }

  stdout.write(`Photivra identity check passed for ${scanned} text files${directory ? ` under ${directory}` : ""}; no legacy project identifiers, former repository links, private hosts or local paths in validation records found.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(argv.slice(2));
