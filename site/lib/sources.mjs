// SPDX-License-Identifier: Apache-2.0
// Facts the site reads from the repository's own files: nothing here is typed by hand (docs/design/engine-site.md, rule 4).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/** A small reader for the subset of YAML that CITATION.cff uses: top-level scalars, lists of scalars and lists of maps. */
export function parseCitation(text) {
  const result = {};
  let key = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/u, "");
    if (!line || line.startsWith("#")) continue;
    const top = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/u);
    if (top) {
      key = top[1];
      result[key] = top[2] === "" ? [] : unquote(top[2]);
      continue;
    }
    const item = line.match(/^\s+-\s+(?:([A-Za-z][\w-]*):\s*)?(.*)$/u);
    if (item && key && Array.isArray(result[key])) {
      result[key].push(item[1] ? { [item[1]]: unquote(item[2]) } : unquote(item[2]));
      continue;
    }
    const field = line.match(/^\s+([A-Za-z][\w-]*):\s*(.*)$/u);
    if (field && key && Array.isArray(result[key]) && typeof result[key].at(-1) === "object") {
      result[key].at(-1)[field[1]] = unquote(field[2]);
      continue;
    }
    throw new Error(`CITATION.cff: a line the site's reader does not understand: ${JSON.stringify(line)}`);
  }
  return result;
}

function unquote(value) {
  const match = value.match(/^"(.*)"$/u);
  return match ? match[1].replace(/\\"/gu, "\"") : value;
}

/** Holder, year and the sentences the footer and structured data use, from NOTICE. */
export function parseNotice(text) {
  const copyright = text.match(/^Copyright (\d{4}) (.+)$/mu);
  if (!copyright) throw new Error("NOTICE: no \"Copyright <year> <holder>\" line");
  const prose = text.split(/\n{2,}/u).map((paragraph) => paragraph.replace(/\s+/gu, " ").trim());
  const sentence = (pattern, name) => {
    for (const paragraph of prose) {
      const found = paragraph.match(pattern);
      if (found) return found[0];
    }
    throw new Error(`NOTICE: the ${name} sentence is missing`);
  };
  const licenseSentence = sentence(/Source code in this repository is made available under the ([^.]+?, Version \d+\.\d+)\./u, "license");
  return {
    year: copyright[1],
    holder: copyright[2].trim(),
    licenseName: licenseSentence.match(/under the (.+)\.$/u)[1],
    trademark: sentence(/Photivra trade names[^.]*\./u, "trademark"),
    dng: sentence(/This product includes DNG technology[^.]*\./u, "DNG")
  };
}

/** The platform phrase of llms.txt's first paragraph, which the home page's version line follows. */
export function parseLlmsPlatform(text) {
  const found = text.match(/runs in browsers and (Node [\d.]+ or later), makes no network calls and needs no API key/u);
  if (!found) throw new Error("llms.txt: the sentence on browsers, Node, network calls and API keys is missing");
  return { node: found[1] };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Everything the templates need from the repository, read once. */
export function readSources(root) {
  const read = (path) => readFileSync(join(root, path), "utf8");
  const pkg = JSON.parse(read("package.json"));
  const citation = parseCitation(read("CITATION.cff"));
  const notice = parseNotice(read("NOTICE"));
  const llms = parseLlmsPlatform(read("llms.txt"));
  const exportsManifest = JSON.parse(read("docs/api/exports.json"));
  const repository = pkg.repository.url.replace(/^git\+/u, "").replace(/\.git$/u, "");
  const commit = process.env.SITE_COMMIT ?? git(root, ["rev-parse", "HEAD"]);
  const commitDate = process.env.SITE_COMMIT_DATE ?? git(root, ["log", "-1", "--format=%cs", commit]);
  const nodeMinimum = pkg.engines?.node?.match(/^>=(\d+)\.(\d+)\.\d+$/u);
  if (!nodeMinimum) throw new Error(`package.json: engines.node ${JSON.stringify(pkg.engines?.node)} is not of the form >=x.y.z`);
  if (llms.node !== `Node ${nodeMinimum[1]}.${nodeMinimum[2]} or later`) {
    throw new Error(`llms.txt says "${llms.node}" but package.json's engines.node is ${pkg.engines.node}`);
  }
  if (exportsManifest.packageVersion !== pkg.version) throw new Error("docs/api/exports.json is not for package.json's version");
  return {
    pkg,
    version: pkg.version,
    packageName: pkg.name,
    license: pkg.license,
    nodeRange: pkg.engines.node,
    nodePhrase: llms.node,
    repository,
    citation,
    notice,
    exportsManifest,
    commit,
    shortCommit: commit.slice(0, 7),
    commitDate,
    publishedVersion: process.env.SITE_PUBLISHED_VERSION || undefined
  };
}
