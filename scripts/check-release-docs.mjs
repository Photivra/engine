// SPDX-License-Identifier: Apache-2.0

/** Check root-reference drift, repository/package navigation and explicit example dependencies. */
import ts from "typescript";
import process from "node:process";
import console from "node:console";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { anchors } from "./lib/anchors.mjs";

/** The repository's web address from `package.json`'s `repository.url` (#694: never a literal, so a rename cannot blind the check). */
export function repositoryWebUrl(repositoryUrl) {
  return repositoryUrl.replace(/^git\+/u, "").replace(/\.git$/u, "");
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Checks every Markdown link of `files` (repository-relative paths): relative links, fragment-only links and absolute
 * links to this repository's `main` (`/blob/main/` for files, `/tree/main/` for directories) must name an existing
 * file, and a fragment on a Markdown file must name one of its headings (scripts/lib/anchors.mjs). Other absolute
 * links are not followed. Throws "Missing navigation" or "Missing heading"; returns the counts.
 * @param {string[]} files
 * @param {(path: string) => string} read
 * @param {(path: string) => boolean} exists
 * @param {string} repository The repository's web address, for example https://github.com/Photivra/engine
 */
export function checkLinks(files, read, exists, repository) {
  const absolute = new RegExp(`^${escapeRegExp(repository)}/(blob|tree)/main/(.+)$`, "iu");
  let links = 0, repositoryLinks = 0;
  for (const path of files) {
    const source = read(path);
    const prose = source.replace(/```[\s\S]*?```/gu, "");
    for (const m of prose.matchAll(/\]\(([^\s)]+)\)/gu)) {
      let destination = m[1];
      const repositoryLink = destination.match(absolute);
      if (repositoryLink) destination = repositoryLink[2];
      else if (/^(?:https?:|mailto:)/u.test(destination)) continue;
      const [file, fragment] = destination.split("#");
      const target = repositoryLink ? posix.normalize(file) : file ? posix.join(dirname(path), file) : path;
      if (!exists(target)) throw new Error(`Missing navigation: ${path} -> ${m[1]}`);
      if (fragment && target.endsWith(".md") && !anchors(read(target)).has(decodeURIComponent(fragment))) {
        throw new Error(`Missing heading: ${path} -> ${m[1]}`);
      }
      links++;
      if (repositoryLink) repositoryLinks++;
    }
  }
  // #694: the check must not go blind again. Documents that link to the repository by its address must have had those links resolved.
  if (repositoryLinks === 0 && files.some((path) => read(path).includes(`${repository}/blob/main/`))) {
    throw new Error(`No absolute link to ${repository} was resolved, although the documents contain such links: the link pattern no longer matches.`);
  }
  return { links, repositoryLinks };
}

function main() {
  execFileSync(process.execPath, ["scripts/generate-api-reference.mjs", "--check"], { stdio: "inherit" });
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const citation = readFileSync("CITATION.cff", "utf8");
  if (lock.version !== pkg.version || lock.packages[""].version !== pkg.version || !citation.includes(`version: "${pkg.version}"`)) throw new Error("Distribution/lock/citation version drift");
  const sourceVersion = readFileSync("src/core/version.ts", "utf8").match(/ENGINE_API_VERSION = "([^"]+)"/u)?.[1];
  if (sourceVersion !== pkg.version) throw new Error("Package/root API version drift");
  const manifest = JSON.parse(readFileSync("docs/api/exports.json", "utf8"));
  if (manifest.packageVersion !== pkg.version || manifest.engineApiVersion !== pkg.version) throw new Error("Aligned release/API identity drift");
  const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split("\n");
  const docs = tracked.filter(p => p.endsWith(".md") && !p.startsWith(".release-"));
  const { links, repositoryLinks } = checkLinks(docs, (path) => readFileSync(path, "utf8"), existsSync, repositoryWebUrl(pkg.repository.url));
  const fragments = JSON.parse(readFileSync("docs/validation/documentation-fragments.json", "utf8"));
  const config = ts.readConfigFile("tsconfig.build.json", ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ".");
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker(), root = program.getSourceFile("src/index.ts");
  const exported = new Set(checker.getExportsOfModule(checker.getSymbolAtLocation(root)).map(s => s.name));
  let complete = 0, partial = 0;
  for (const path of ["README.md", ...docs.filter(p => /^docs\/[^/]+\.md$/u.test(p))]) {
    if (path === "docs/API_REFERENCE.md") continue;
    const text = readFileSync(path, "utf8"); let block = 0;
    for (const match of text.matchAll(/```(?:ts|typescript|js|javascript)\n([\s\S]*?)\n```/gu)) {
      const index = block++, code = match[1];
      if (!code.includes("@photivra/engine")) continue;
      const sf = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
      for (const statement of sf.statements) {
        if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === "@photivra/engine") {
          for (const element of statement.importClause?.namedBindings?.elements ?? []) {
            if (!exported.has(element.propertyName?.text ?? element.name.text)) throw new Error(`Unexported example symbol in ${path}: ${element.name.text}`);
          }
        }
      }
      const fragment = fragments.find(f => f.file === path && f.block === index);
      if (fragment) {
        const prefix = text.slice(Math.max(0, match.index - 600), match.index);
        if (!prefix.includes("Composition fragment: requires previously validated bindings") || fragment.bindings.some(b => !prefix.includes("`" + b + "`"))) throw new Error(`Unstated fragment prerequisites: ${path} block ${index}`);
        partial++;
      } else complete++;
    }
  }
  console.log(`Docs checked: ${docs.length} Markdown files, ${links} repository/local links (${repositoryLinks} of them absolute links to the repository), ${complete} complete importing examples and ${partial} explicit fragments.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
