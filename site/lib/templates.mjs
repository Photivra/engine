// SPDX-License-Identifier: Apache-2.0
// The page layout: head, header, navigation, footer (docs/design/engine-site.md, sections 5, 8, 10, 12 and 13).
import { escapeHtml, fill } from "./html.mjs";

export const CSP = "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'";
export const CSP_SEARCH = `${CSP}; script-src 'self'`;

/** JSON for a `<script type="application/ld+json">` block: `<` is escaped so the text can never close the element. */
export function jsonLd(value) {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

/**
 * One complete page.
 * @param {object} site Shared facts (sources, config, asset names).
 * @param {object} page { url, title, description, section, body, breadcrumbs?, structuredData?, script?, noindex? }
 */
export function layout(site, page) {
  const canonical = page.noindex ? "" : `<link rel="canonical" href="${escapeHtml(site.config.origin + page.url)}">\n`;
  const ogUrl = page.noindex ? "" : `<meta property="og:url" content="${escapeHtml(site.config.origin + page.url)}">\n`;
  const data = [...(page.structuredData ?? [])];
  if (page.breadcrumbs?.length) data.push(breadcrumbData(site, page));
  const social = site.config.social;
  const head = `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${page.script ? CSP_SEARCH : CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#111214">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(page.title)}</title>
${page.description ? `<meta name="description" content="${escapeHtml(page.description)}">\n` : ""}${page.noindex ? "<meta name=\"robots\" content=\"noindex\">\n" : ""}${canonical}<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="${site.assets["icon.svg"]}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="${site.assets["fonts/inter-400.woff2"]}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(site.config.siteName)}">
<meta property="og:title" content="${escapeHtml(page.title)}">
${page.description ? `<meta property="og:description" content="${escapeHtml(page.description)}">\n` : ""}${ogUrl}<meta property="og:image" content="${escapeHtml(site.config.origin + social.image)}">
<meta property="og:image:width" content="${social.width}">
<meta property="og:image:height" content="${social.height}">
<meta property="og:image:alt" content="${escapeHtml(site.socialAlt)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
${data.map((item) => `<script type="application/ld+json">${jsonLd(item)}</script>`).join("\n")}${data.length ? "\n" : ""}</head>`;
  return `${head}
<body>
<a class="skip" href="#main">Skip to content</a>
${header(site, page)}
<main id="main" tabindex="-1">
${page.body}
</main>
${footer(site)}
${page.script ? `<script type="module" src="${page.script}"></script>\n` : ""}</body>
</html>
`;
}

function header(site, page) {
  const links = site.config.nav.map((item) => {
    const href = fill(item.href, site.placeholders);
    const current = href === page.url ? " aria-current=\"page\"" : item.section && item.section === page.section ? " aria-current=\"true\"" : "";
    return `<li><a href="${escapeHtml(href)}"${current}>${escapeHtml(item.label)}</a></li>`;
  }).join("");
  return `<header class="site"><div class="wrap bar">
<a class="brand" href="/"><span class="name">Photivra</span> <span class="sub">engine</span></a>
<nav class="primary" aria-label="Site"><ul>${links}</ul></nav>
<form class="search" role="search" aria-label="Search the documentation" action="/search/" method="get"><label class="sr-only" for="q">Search the API and guides</label><input type="search" id="q" name="q" placeholder="Search" autocomplete="off" spellcheck="false"><button type="submit">Search</button></form>
</div></header>`;
}

function footer(site) {
  const { sources } = site;
  const links = site.config.footer.links.map((item) => `<li><a href="${escapeHtml(fill(item.href, site.placeholders))}">${escapeHtml(item.label)}</a></li>`).join("");
  return `<footer class="site"><div class="wrap">
<ul>${links}</ul>
<p>${escapeHtml(sources.packageName)} ${escapeHtml(sources.version)}. This site was built from the public source at commit <a href="${escapeHtml(`${sources.repository}/commit/${sources.commit}`)}">${escapeHtml(sources.shortCommit)}</a>. ${escapeHtml(site.config.footer.privacy)}</p>
<p>Copyright ${escapeHtml(sources.notice.year)} ${escapeHtml(sources.notice.holder)}. Source code under the <a href="/license/">${escapeHtml(sources.notice.licenseName)}</a>. ${escapeHtml(sources.notice.trademark)} ${escapeHtml(sources.notice.dng)}</p>
</div></footer>`;
}

function breadcrumbData(site, page) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: page.breadcrumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      ...(crumb.href ? { item: site.config.origin + crumb.href } : { item: site.config.origin + page.url })
    }))
  };
}

/** The visible breadcrumb; the last item is the current page. */
export function breadcrumbs(items) {
  const list = items.map((item, index) => (index === items.length - 1
    ? `<li aria-current="page">${escapeHtml(item.label)}</li>`
    : `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a></li>`)).join("");
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${list}</ol></nav>`;
}

/** A list of links for a side column; `current` marks the current page. */
export function linkList(items, current) {
  return `<ul>${items.map((item) => `<li><a href="${escapeHtml(item.href)}"${item.href === current ? " aria-current=\"page\"" : ""}>${item.html ?? escapeHtml(item.label)}</a></li>`).join("")}</ul>`;
}

/** The three-column document layout: side navigation, article, "On this page". */
export function documentLayout({ side, article, toc }) {
  const tocHtml = toc?.length
    ? `<nav class="side toc" aria-label="On this page"><h2>On this page</h2>${linkList(toc)}</nav>`
    : "";
  return `<div class="wrap doc${tocHtml ? " with-toc" : ""}${side ? "" : " no-side"}">
${side ?? ""}
<article class="prose">
${article}
</article>
${tocHtml}
</div>`;
}

/** Previous and next links at the foot of a page. */
export function pager(previous, next, words = ["Previous", "Next"]) {
  if (!previous && !next) return "";
  const link = (item, word, rel) => (item ? `<a href="${escapeHtml(item.href)}" rel="${rel}">${word}: ${escapeHtml(item.label)}</a>` : "<span></span>");
  return `<nav class="pager" aria-label="Previous and next">${link(previous, words[0], "prev")}${link(next, words[1], "next")}</nav>`;
}
