// SPDX-License-Identifier: Apache-2.0
// Builds the engine documentation site into _site/ (docs/design/engine-site.md, section 14; build plan in #669).
//
//   npm run build --prefix site                      # into _site/
//   node site/build.mjs --out <dir>                  # into another directory (the reproducibility check)
//   node site/build.mjs --previous-sitemap <file>    # also list addresses of that sitemap that are gone
//
// Needs the engine built at the repository root (npm ci && npm run build) for the rendered examples.
// Environment: SITE_PUBLISHED_VERSION (set by the workflow after a successful npm publish), SITE_COMMIT and
// SITE_COMMIT_DATE (default: from git).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readSources } from "./lib/sources.mjs";
import { runExamples } from "./lib/examples.mjs";
import { buildPages } from "./lib/pages.mjs";
import { layout } from "./lib/templates.mjs";
import { fill } from "./lib/html.mjs";

const siteDir = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(siteDir, "..");

/** Hashed asset name: `/assets/<name>.<first 10 hex of SHA-256>.<ext>`. */
export function hashedName(name, bytes) {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  const extension = extname(name);
  return `/assets/${basename(name, extension)}.${hash}${extension}`;
}

/** The output file of a page address. */
export function outputFile(url) {
  if (url.endsWith(".html")) return url.slice(1);
  return `${url.slice(1)}index.html`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function build({ out = join(root, "_site"), previousSitemap, log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const config = JSON.parse(readFileSync(join(siteDir, "site.config.json"), "utf8"));
  const sources = readSources(root);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const write = (path, data) => {
    const file = join(out, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  };

  // Assets with a content hash in their name; the few that keep a fixed name.
  const assets = {};
  for (const name of ["search.js", "icon.svg", "fonts/inter-400.woff2", "fonts/inter-600-700.woff2"]) {
    const bytes = readFileSync(join(siteDir, "assets", name));
    assets[name] = hashedName(basename(name), bytes);
    write(assets[name], bytes);
  }
  for (const [from, to] of [["favicon.ico", "favicon.ico"], ["apple-touch-icon.png", "apple-touch-icon.png"], ["social.png", "social.png"], ["fonts/OFL.txt", "assets/fonts/OFL.txt"]]) {
    const target = join(out, to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(siteDir, "assets", from), target);
  }
  copyFileSync(join(root, "llms.txt"), join(out, "llms.txt"));

  // Rendered examples, run with the engine built from this commit.
  const examples = await runExamples(root, join(siteDir, ".cache", `examples-${process.pid}`), sources.version, log);
  rmSync(join(siteDir, ".cache", `examples-${process.pid}`), { recursive: true, force: true });
  const exampleUrls = {};
  for (const example of examples) {
    exampleUrls[example.name] = `/examples/${example.name}.${example.hash}.png`;
    write(exampleUrls[example.name], example.png);
  }

  const placeholders = { repository: sources.repository, package: sources.packageName, citationUrl: sources.citation.url };
  const site = {
    root, config, sources, examples, assets, exampleUrls, placeholders,
    socialAlt: fill(config.social.alt, { abstract: sources.citation.abstract })
  };
  const { pages, links } = buildPages(site);

  // Pages first, then the Tailwind CLI over the templates, then the CSS file's hash written into every page.
  const html = pages.map((page) => ({ page, text: layout(site, page) }));
  const css = compileCss(assets);
  const cssName = hashedName("site.css", css);
  write(cssName, css);
  for (const { page, text } of html) write(outputFile(page.url), text.replace("<link rel=\"stylesheet\" href=\"/assets/site.css\">", `<link rel="stylesheet" href="${cssName}">`));

  // Sitemap, robots.txt and the custom-domain file, from the one page list.
  const indexed = pages.filter((page) => !page.noindex);
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexed.map((page) => `<url><loc>${config.origin}${page.url}</loc><lastmod>${sources.commitDate}</lastmod></url>`).join("\n")}
</urlset>
`);
  write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${config.origin}/sitemap.xml\n`);
  write("CNAME", `${new URL(config.origin).host}\n`);

  if (previousSitemap) {
    const before = [...readFileSync(previousSitemap, "utf8").matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
    const now = new Set(indexed.map((page) => config.origin + page.url));
    const gone = before.filter((address) => !now.has(address));
    log(gone.length ? `Addresses of the previous sitemap that are gone (renamed or removed):\n${gone.map((address) => `  ${address}`).join("\n")}` : "No address of the previous sitemap is gone.");
  }
  log(`Built ${pages.length} pages (${indexed.length} in the sitemap), ${examples.length} examples, CSS ${css.length} bytes, into ${out}.`);
  log(`Links to other sites in rendered documents (listed, never fetched): ${links.external.size}.`);
  return { pages, out };
}

function compileCss(assets) {
  const work = mkdtempSync(join(tmpdir(), "site-css-"));
  try {
    const output = join(work, "site.css");
    execFileSync(process.execPath, [join(siteDir, "node_modules/@tailwindcss/cli/dist/index.mjs"), "-i", join(siteDir, "styles/site.css"), "-o", output, "--minify"],
      { cwd: siteDir, stdio: ["ignore", "ignore", "pipe"] });
    let css = readFileSync(output, "utf8");
    for (const name of ["fonts/inter-400.woff2", "fonts/inter-600-700.woff2"]) {
      const placeholder = `/assets/${name}`;
      if (!css.includes(placeholder)) throw new Error(`The compiled CSS does not name ${placeholder}`);
      css = css.replaceAll(placeholder, assets[name]);
    }
    return Buffer.from(css);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}` || resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const out = argument("--out");
  await build({ out: out ? resolve(out) : undefined, previousSitemap: argument("--previous-sitemap") });
}
