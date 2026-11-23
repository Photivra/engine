// SPDX-License-Identifier: Apache-2.0
// The page list: every page of the site from its single source (docs/design/engine-site.md, sections 3 and 4).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { headingSlug } from "../../scripts/lib/anchors.mjs";
import { loadDocument, renderTokens, renderInline, newRenderState, firstParagraph, plainInline, codeIndicesIn } from "./markdown.mjs";
import { splitChangelog, statusLine } from "./changelog.mjs";
import { LinkMap } from "./links.mjs";
import { highlight } from "./highlight.mjs";
import { escapeHtml, fill, firstSentence, cut, plural, longDate } from "./html.mjs";
import { breadcrumbs, documentLayout, linkList, pager } from "./templates.mjs";
import { searchBody, countPhrase } from "./search.mjs";
import { EXAMPLE_LIMITS } from "./examples.mjs";

const KIND_ORDER = ["Function", "Class", "Constant", "Type"];

/**
 * Builds every page (body HTML and metadata) without writing anything.
 * @param {{ root: string, config: object, sources: object, examples: object[], assets: Record<string, string>, placeholders: object }} site
 * @returns {{ pages: object[], links: LinkMap, searchIndex: object }}
 */
export function buildPages(site) {
  const { root, config, sources } = site;
  const read = (path) => readFileSync(join(root, path), "utf8");
  const links = new LinkMap({ root, repository: sources.repository });
  const pages = [];
  const version = sources.version;
  const values = { version, node: sources.nodeRange, exports: sources.exportsManifest.exports.length.toLocaleString("en-US"), modules: 0 };

  // ---- Load every source and register its addresses before any page is rendered.
  const documents = config.documents.map((entry) => ({ ...entry, doc: loadDocument(entry.source, read(entry.source)) }));
  for (const entry of documents) {
    const fragments = new Map();
    if (entry.splitAt === "h2") {
      const preambleIds = new Set(entry.doc.headings.filter((h) => h.depth === 1).map((h) => h.id));
      for (const id of preambleIds) fragments.set(id, entry.url);
      for (const section of entry.doc.sections) {
        const url = `${entry.url}${section.id}/`;
        section.url = url;
        fragments.set(section.id, url);
        for (const token of section.tokens) collectIds(token, (id) => fragments.set(id, `${url}#${id}`));
      }
    } else {
      for (const heading of entry.doc.headings) fragments.set(heading.id, heading.depth === 1 ? entry.url : `${entry.url}#${heading.id}`);
    }
    links.publish(entry.source, entry.url, fragments);
  }

  const readme = loadDocument("README.md", read("README.md"));
  const homeEnd = readme.tokens.findIndex((token) => token.type === "heading" && token.depth >= 2);
  if (homeEnd < 0 || readme.tokens[homeEnd].depth !== 3) throw new Error("README.md: the home page text ends at the first ### heading, which is missing");
  links.publish("README.md", "/", new Map(readme.headings.map((h, index) => [h.id, index === 0 ? "/" : null])));

  const nodeSupport = loadDocument("NODE_SUPPORT.md", read("NODE_SUPPORT.md"));
  links.publish("NODE_SUPPORT.md", "/install/", new Map(nodeSupport.headings.map((h) => [h.id, `/install/#${h.id}`])));
  const thirdParty = loadDocument("THIRD_PARTY.md", read("THIRD_PARTY.md"));
  links.publish("THIRD_PARTY.md", "/third-party/", new Map(thirdParty.headings.map((h) => [h.id, h.depth === 1 ? "/third-party/" : `/third-party/#${h.id}`])));
  links.publish("LICENSE", "/license/");
  links.publish("NOTICE", "/notices/");
  links.publish("llms.txt", "/llms.txt");

  // API: one page per module of exports.json; a page in docs/api without exports is an orphan and fails the build (ci-09).
  const modules = apiModules(root, sources.exportsManifest, read);
  values.modules = modules.length;
  for (const module of modules) {
    links.publish(`docs/api/${module.id}.md`, module.url, new Map(module.doc.headings.map((h) => [h.id, h.depth === 1 ? module.url : `${module.url}#${h.id}`])));
  }
  const reference = loadDocument("docs/API_REFERENCE.md", read("docs/API_REFERENCE.md"));
  const referenceFragments = new Map();
  for (const heading of reference.headings) {
    const module = modules.find((m) => headingSlug(m.path) === heading.id);
    referenceFragments.set(heading.id, heading.depth === 1 ? "/api/" : module ? module.url : `/api/#${heading.id}`);
  }
  links.publish("docs/API_REFERENCE.md", "/api/", referenceFragments);

  const changelogDoc = loadDocument("CHANGELOG.md", read("CHANGELOG.md"));
  const changelog = splitChangelog(changelogDoc);
  const historyUrl = "/releases/engine-api-history/";
  const changelogFragments = new Map([[changelogDoc.headings[0].id, "/releases/"]]);
  for (const release of changelog.releases) {
    release.url = `/releases/${release.version}/`;
    changelogFragments.set(release.id, release.url);
    for (const token of release.section.tokens) collectIds(token, (id) => changelogFragments.set(id, `${release.url}#${id}`));
  }
  for (const section of changelog.history) {
    changelogFragments.set(section.id, `${historyUrl}#${section.id}`);
    for (const token of section.tokens) collectIds(token, (id) => changelogFragments.set(id, `${historyUrl}#${id}`));
  }
  for (const section of changelog.unreleased) {
    changelogFragments.set(section.id, null);
    for (const token of section.tokens) collectIds(token, (id) => changelogFragments.set(id, null));
  }
  links.publish("CHANGELOG.md", "/releases/", changelogFragments);

  const examplesByBlock = new Map(site.examples.map((example) => [`${example.file}#${example.block}`, example]));
  const usedExamples = new Set();
  const figuresFor = (path, counter) => (index) => {
    const example = examplesByBlock.get(`${path}#${index}`);
    if (!example) return undefined;
    usedExamples.add(example.name);
    counter.count++;
    return figure(example, sources, site);
  };

  const sourceLink = (path) => `<div class="meta"><span>${escapeHtml(sources.packageName)} ${escapeHtml(version)}</span><a href="${escapeHtml(`${sources.repository}/blob/main/${path}`)}">Source of this page on GitHub</a></div>`;
  const tocOf = (tokens, depth, base = "") => tokens.filter((token) => token.type === "heading" && token.depth === depth)
    .map((token) => ({ href: `${base}#${token._id}`, label: plainInline(token.tokens) }));
  const exampleHref = (example) => {
    const entry = documents.find((d) => d.source === example.file);
    if (!entry) throw new Error(`Example ${example.name}: ${example.file} is not a published guide`);
    const section = entry.doc.sections.find((s) => codeIndicesIn(s.tokens).includes(example.block));
    if (!section) return entry.url;
    return entry.splitAt ? section.url : `${entry.url}#${section.id}`;
  };

  // ---- Home
  const homeTokens = readme.tokens.slice(0, homeEnd);
  const title = homeTokens.find((token) => token.type === "heading" && token.depth === 1);
  const paragraphs = homeTokens.filter((token) => token.type === "paragraph");
  const list = homeTokens.find((token) => token.type === "list");
  const pronunciation = paragraphs.find((token) => /^\*\*Pronunciation/u.test(token.raw));
  const lead = paragraphs[0];
  const afterList = paragraphs.filter((token) => homeTokens.indexOf(token) > homeTokens.indexOf(list));
  const principles = afterList[0];
  if (!title || !lead || !pronunciation || !list || !principles) throw new Error("README.md: the opening must hold a title, a lead sentence, the pronunciation, the capability list and the principles paragraph");
  const quickStart = readme.sections.find((section) => section.title === "Quick start");
  const install = quickStart?.tokens.find((token) => token.type === "code" && token.lang === "sh");
  const firstExample = quickStart?.tokens.find((token) => token.type === "code" && token.lang === "ts");
  if (!install || !firstExample) throw new Error("README.md: the Quick start section must hold the install command and a first example");
  const installCommand = `npm install ${sources.packageName}@${version}`;
  if (install.text.trim() !== installCommand) throw new Error(`README.md's install command is "${install.text.trim()}"; package.json gives "${installCommand}"`);
  const inline = (tokens) => renderTokens([{ type: "paragraph", tokens, raw: "", text: "" }], { from: "README.md", links }).replace(/^<p>|<\/p>\n?$/gu, "");
  const homeExample = site.examples.find((example) => example.home);
  const homeConfig = config.pages.home;
  const versionLine = `Version ${version} · ${sources.license} · ${sources.nodePhrase} and browsers · no network calls, no API key`;
  const homeBody = `<div class="wrap">
<section class="hero" aria-labelledby="${escapeHtml(title._id)}">
<div>
<h1 id="${escapeHtml(title._id)}">${inline(title.tokens)}</h1>
<p class="ipa">${escapeHtml(plainInline(pronunciation.tokens))}</p>
<p class="lead">${inline(lead.tokens)}</p>
<p>${inline(principles.tokens)}</p>
<div class="actions"><a class="button" href="/quick-start/">Quick start</a><a class="button quiet" href="/api/">API reference</a></div>
<p class="small muted">${escapeHtml(versionLine)}</p>
</div>
<div>
<pre class="code" tabindex="0" role="region" aria-label="Install command"><code>${highlight(installCommand, "sh")}</code></pre>
<pre class="code" tabindex="0" role="region" aria-label="Example: simulate a capture"><code>${highlight(firstExample.text, firstExample.lang)}</code></pre>
</div>
</section>
</div>
<section class="band" aria-labelledby="covers"><div class="wrap">
<h2 id="covers">${escapeHtml(homeConfig.coversHeading)}</h2>
<ul class="covers">${list.items.map((item) => `<li>${escapeHtml(item.text.replace(/[;.]$/u, ""))}</li>`).join("")}</ul>
</div></section>
<section class="band" aria-labelledby="documentation"><div class="wrap">
<h2 id="documentation">${escapeHtml(homeConfig.documentationHeading)}</h2>
<div class="cols four">
${homeConfig.cards.map((card) => `<div class="card"><h3><a href="${escapeHtml(card.href)}">${escapeHtml(card.label)}</a></h3><p class="small">${renderInline(fill(card.text, values), { from: "site/site.config.json", links })}</p></div>`).join("\n")}
</div>
</div></section>
${homeExample ? `<section class="band" aria-labelledby="rendered"><div class="wrap">
<div class="cols two">
<div>
<h2 id="rendered">${escapeHtml(homeConfig.renderedHeading)}</h2>
<p>${renderInline(fill(homeConfig.renderedText, values), { from: "site/site.config.json", links })}</p>
<p><a href="${escapeHtml(exampleHref(homeExample))}">${escapeHtml(homeExample.homeLink)}</a></p>
</div>
${figure(homeExample, sources, site, { home: true })}
</div>
</div></section>` : ""}`;
  pages.push({
    url: "/",
    kind: "home",
    title: homeConfig.title,
    description: `${sources.citation.abstract} ${homeConfig.descriptionSuffix}`,
    section: "home",
    body: homeBody,
    structuredData: [
      { "@context": "https://schema.org", "@type": "WebSite", name: config.siteName, url: `${config.origin}/` },
      softwareSourceCode(config, sources)
    ],
    homeText: [plainInline(lead.tokens), plainInline(principles.tokens), plainInline(pronunciation.tokens), ...list.items.map((item) => item.text.replace(/[;.]$/u, ""))]
  });

  // ---- Install
  {
    const page = config.pages.install;
    const state = newRenderState();
    const article = `${breadcrumbs([{ label: page.heading }])}
<h1>${escapeHtml(page.heading)}</h1>
<p>${escapeHtml(page.intro)}</p>
<pre class="code" tabindex="0" role="region" aria-label="Install command"><code>${highlight(installCommand, "sh")}</code></pre>
${renderTokens(nodeSupport.tokens, { from: "NODE_SUPPORT.md", links, shift: 1, state })}
${sourceLink("NODE_SUPPORT.md")}`;
    const body = documentLayout({ side: "", article, toc: tocOf(nodeSupport.tokens, 2).map((item) => item) });
    pages.push({ url: "/install/", kind: "install", title: page.title, description: fill(page.description, values), section: "install", body,
      breadcrumbs: [{ label: page.heading }] });
  }

  // ---- Quick start and guides
  const guideNav = (current, entry, sectionUrl) => {
    const docs = documents.map((d) => ({ href: d.url, label: d.name }));
    let html = `<nav class="side" aria-label="Guides"><h2>Guides</h2>${linkList([{ href: "/guides/", label: "All guides" }, ...docs], current)}`;
    if (entry?.splitAt) {
      html += `<div class="side-sections"><h2>${escapeHtml(entry.name)}: sections</h2>${linkList(entry.doc.sections.map((s) => ({ href: s.url, label: s.title })), sectionUrl)}</div>`;
    }
    return `${html}</nav>`;
  };
  const crumbsFor = (entry, extra) => {
    const base = entry.section === "guides" ? [{ label: "Guides", href: "/guides/" }] : [];
    return [...base, ...(extra ? [{ label: entry.name, href: entry.url }, extra] : [{ label: entry.name }])];
  };
  const guideIndex = [];
  for (const entry of documents) {
    const doc = entry.doc;
    const docTitle = doc.title ?? entry.name;
    const titleSuffix = entry.section === "guides" ? " · Guides · Photivra engine" : " · Photivra engine";
    const intro = firstParagraph(doc.preamble);
    guideIndex.push({ entry, title: docTitle, sentence: intro ? firstSentence(intro, 400) : "" });
    if (entry.splitAt === "h2") {
      const crumbs = crumbsFor(entry);
      const counter = { count: 0 };
      const state = newRenderState();
      const article = `${breadcrumbs(crumbs)}
${renderTokens(doc.preamble, { from: entry.source, links, state, figures: figuresFor(entry.source, counter) })}
${sourceLink(entry.source)}
<h2 id="sections-of-this-page">Sections</h2>
<ol class="contents">${doc.sections.map((s) => `<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a></li>`).join("")}</ol>
${pager(undefined, { href: doc.sections[0].url, label: doc.sections[0].title })}`;
      pages.push({ url: entry.url, kind: "guide-contents", title: `${docTitle}${titleSuffix}`, description: intro ? firstSentence(intro) : `${docTitle}: contents.`,
        section: entry.section, body: documentLayout({ side: guideNav(entry.url, entry), article }), breadcrumbs: crumbs, figures: counter.count, source: entry.source });
      doc.sections.forEach((section, index) => {
        const sectionCrumbs = crumbsFor(entry, { label: section.title });
        const sectionCounter = { count: 0 };
        const sectionState = newRenderState();
        const body = renderTokens([section.heading, ...section.tokens], { from: entry.source, links, shift: -1, state: sectionState, figures: figuresFor(entry.source, sectionCounter) });
        const previous = index === 0 ? { href: entry.url, label: `${entry.name}: contents` } : { href: doc.sections[index - 1].url, label: doc.sections[index - 1].title };
        const next = doc.sections[index + 1] ? { href: doc.sections[index + 1].url, label: doc.sections[index + 1].title } : undefined;
        const first = firstParagraph(section.tokens);
        const article = `${breadcrumbs(sectionCrumbs)}
${body}
${pager(previous, next)}`;
        pages.push({
          url: section.url,
          kind: "guide-section",
          title: `${section.title} · ${entry.name} · Photivra engine`,
          description: first ? firstSentence(first) : `${section.title}: a section of ${docTitle} for ${sources.packageName}.`,
          descriptionPrefix: section.title,
          section: entry.section,
          body: documentLayout({ side: guideNav(entry.url, entry, section.url), article, toc: tocOf(section.tokens, 3) }),
          breadcrumbs: sectionCrumbs,
          figures: sectionCounter.count,
          source: entry.source,
          codeBlocks: codeIndicesIn(section.tokens)
        });
      });
    } else {
      const crumbs = crumbsFor(entry);
      const counter = { count: 0 };
      const state = newRenderState();
      const article = `${breadcrumbs(crumbs)}
${renderTokens(doc.tokens, { from: entry.source, links, state, figures: figuresFor(entry.source, counter) })}
${sourceLink(entry.source)}`;
      pages.push({ url: entry.url, kind: "guide", title: `${docTitle}${titleSuffix}`, description: intro ? firstSentence(intro) : `${docTitle}.`,
        section: entry.section, body: documentLayout({ side: guideNav(entry.url, entry), article, toc: tocOf(doc.tokens, 2) }), breadcrumbs: crumbs,
        figures: counter.count, source: entry.source });
    }
  }
  {
    const page = config.pages.guides;
    const article = `${breadcrumbs([{ label: page.heading }])}
<h1>${escapeHtml(page.heading)}</h1>
<p>${escapeHtml(page.intro)}</p>
<ul class="entries">${guideIndex.map((guide) => `<li><h2 class="text-lg"><a href="${escapeHtml(guide.entry.url)}">${escapeHtml(guide.title)}</a></h2>${guide.sentence ? `<p>${escapeHtml(guide.sentence)}</p>` : ""}</li>`).join("\n")}</ul>`;
    pages.push({ url: "/guides/", kind: "guides-index", title: page.title, description: fill(page.description, values), section: "guides",
      body: documentLayout({ side: guideNav("/guides/"), article }), breadcrumbs: [{ label: page.heading }] });
  }

  // ---- API
  const areas = [...new Set(modules.map((m) => m.area))].sort();
  const apiSide = (current) => `<nav class="side" aria-label="API modules"><h2 class="sr-only">API modules</h2>${linkList([{ href: "/api/", label: "API index and task index" }], current?.url ?? "/api/")}
${areas.map((area) => {
    const inArea = modules.filter((m) => m.area === area);
    const open = current?.area === area;
    return `<details${open ? " open" : ""}><summary>${escapeHtml(area)}<span class="count">${inArea.length}</span></summary>${open ? linkList(inArea.map((m) => ({ href: m.url, label: m.file })), current.url) : `<p class="small muted"><a href="/api/#${escapeHtml(area)}">${escapeHtml(area)} modules on the API index</a></p>`}</details>`;
  }).join("\n")}</nav>`;
  for (const module of modules) {
    const inArea = modules.filter((m) => m.area === module.area);
    const index = inArea.indexOf(module);
    const crumbs = [{ label: "API", href: "/api/" }, { label: module.area, href: `/api/#${module.area}` }, { label: module.file }];
    const state = newRenderState();
    const body = renderTokens(module.doc.tokens, { from: `docs/api/${module.id}.md`, links, state, exportKinds: module.kinds, codeLabel: (lang) => (lang === "ts" ? "Declaration" : "Code") });
    const [h1, ...rest] = body.split(/(?<=<\/h1>\n)/u);
    const meta = `<div class="meta"><span>${escapeHtml(sources.packageName)} ${escapeHtml(version)}</span><span>${escapeHtml(module.counts)}</span><a href="${escapeHtml(`${sources.repository}/blob/main/${module.source}`)}">Source on GitHub</a></div>`;
    const article = `${breadcrumbs(crumbs)}
${h1}${meta}
${rest.join("")}
${pager(inArea[index - 1] && { href: inArea[index - 1].url, label: inArea[index - 1].path }, inArea[index + 1] && { href: inArea[index + 1].url, label: inArea[index + 1].path })}`;
    const functions = module.exports.filter((e) => e.label === "Function").map((e) => e.name);
    const named = (functions.length ? functions : module.exports.map((e) => e.name)).slice(0, 3);
    pages.push({
      url: module.url,
      kind: "api-module",
      title: `${module.path} · API · Photivra engine`,
      description: cut(`${module.path}: ${module.counts} of ${sources.packageName}, including ${named.join(", ")}.`, 160),
      section: "api",
      body: documentLayout({ side: apiSide(module), article, toc: module.exports.map((e) => ({ href: `#${e.id}`, html: `<code>${escapeHtml(e.name)}</code>`, label: e.name })) }),
      breadcrumbs: crumbs,
      source: `docs/api/${module.id}.md`
    });
  }
  const taskSection = reference.sections.find((section) => section.id === "task-index");
  if (!taskSection) throw new Error("docs/API_REFERENCE.md has no Task index section");
  const taskTable = taskSection.tokens.find((token) => token.type === "table");
  const tasks = taskTable.rows.map((row) => ({
    label: plainInline(row[0].tokens),
    href: "/api/#task-index",
    functions: row[1].tokens.filter((token) => token.type === "link").map((token) => plainInline(token.tokens))
  }));
  {
    const page = config.pages.api;
    const state = newRenderState();
    const preamble = renderTokens(reference.preamble.filter((token) => token.type !== "heading"), { from: "docs/API_REFERENCE.md", links, state });
    const taskHtml = renderTokens([taskSection.heading, ...taskSection.tokens], { from: "docs/API_REFERENCE.md", links, state });
    const areaHtml = areas.map((area) => {
      const inArea = modules.filter((m) => m.area === area);
      const exportCount = inArea.reduce((sum, m) => sum + m.exports.length, 0);
      return `<h3 id="${escapeHtml(area)}">${escapeHtml(area)} <span class="muted small">${plural(inArea.length, "module")}, ${plural(exportCount, "export")}</span></h3>
<ul class="entries">${inArea.map((m) => `<li><a href="${escapeHtml(m.url)}"><code>${escapeHtml(m.path)}</code></a><p class="small muted">${escapeHtml(m.counts)}</p></li>`).join("")}</ul>`;
    }).join("\n");
    const article = `${breadcrumbs([{ label: page.heading }])}
<h1>${escapeHtml(page.heading)}</h1>
<div class="meta"><span>${escapeHtml(sources.packageName)} ${escapeHtml(version)}</span><span>${plural(sources.exportsManifest.exports.length, "root export")} in ${plural(modules.length, "module")}</span><a href="/search/">Search every export</a></div>
${preamble}
${taskHtml}
<h2 id="modules-by-area">${escapeHtml(page.areasHeading)}</h2>
${areaHtml}`;
    pages.push({ url: "/api/", kind: "api-index", title: page.title, description: fill(page.description, values), section: "api",
      body: documentLayout({ side: apiSide(undefined), article, toc: [{ href: "#task-index", label: "Task index" }, ...areas.map((area) => ({ href: `#${area}`, label: area }))] }),
      breadcrumbs: [{ label: page.heading }], structuredData: [softwareSourceCode(config, sources)] });
  }

  // ---- Search
  const searchIndex = {
    tasks,
    exports: modules.flatMap((m) => m.exports.map((e) => ({ name: e.name, kind: e.label, href: `${m.url}#${e.id}`, module: m.path }))),
    modules: modules.map((m) => ({ path: m.path, href: m.url, counts: m.counts })),
    sections: documents.flatMap((entry) => entry.doc.sections.map((section) => ({
      title: section.title,
      href: entry.splitAt ? section.url : `${entry.url}#${section.id}`,
      document: entry.name
    })))
  };
  {
    const page = config.pages.search;
    pages.push({ url: "/search/", kind: "search", title: page.title, description: page.description, section: "search",
      body: searchBody(searchIndex, page), script: site.assets["search.js"], breadcrumbs: [{ label: page.heading }] });
  }

  // ---- Releases
  const releasesConfig = config.pages.releases;
  const releases = changelog.releases;
  for (const release of releases) {
    if (release.version === sources.publishedVersion) release.published = release.tagged = true;
  }
  if (sources.publishedVersion && !releases.some((release) => release.version === sources.publishedVersion)) {
    throw new Error(`SITE_PUBLISHED_VERSION is ${sources.publishedVersion} but CHANGELOG.md has no section for it`);
  }
  const releaseSide = (current) => `<nav class="side" aria-label="Releases"><h2>Releases</h2>${linkList([
    { href: "/releases/", label: `All ${releases.length} versions` },
    ...releases.slice(0, 12).map((r) => ({ href: r.url, label: r.version })),
    { href: historyUrl, label: "Engine API history" }
  ], current)}</nav>`;
  releases.forEach((release, index) => {
    const crumbs = [{ label: "Releases", href: "/releases/" }, { label: release.version }];
    const status = statusLine(release, sources.publishedVersion, longDate);
    const state = newRenderState();
    const recordPath = releaseRecord(root, release.version);
    const more = [
      recordPath && `<li><a href="${escapeHtml(`${sources.repository}/blob/main/${recordPath}`)}">Release record for ${escapeHtml(release.version)} on GitHub</a></li>`,
      release.tagged && `<li><a href="${escapeHtml(`${sources.repository}/releases/tag/v${release.version}`)}">Tag v${escapeHtml(release.version)} on GitHub</a></li>`,
      release.published && `<li><a href="${escapeHtml(`https://www.npmjs.com/package/${sources.packageName}/v/${release.version}`)}">Version ${escapeHtml(release.version)} on npm</a></li>`
    ].filter(Boolean);
    const content = renderTokens(release.section.tokens, { from: "CHANGELOG.md", links, shift: -1, state });
    const article = `${breadcrumbs(crumbs)}
<h1 id="${escapeHtml(release.id)}">${escapeHtml(release.version)}</h1>
<div class="meta">${status ? `<span>${escapeHtml(status)}</span>` : ""}${release.version === version ? "<span>Current release</span>" : ""}</div>
${release.published ? `<pre class="code" tabindex="0" role="region" aria-label="Install command"><code>${highlight(`npm install ${sources.packageName}@${release.version}`, "sh")}</code></pre>\n` : ""}${content}
${more.length ? `<h2 id="more-about-this-release">More about this release</h2>\n<ul>${more.join("")}</ul>` : ""}
${pager(releases[index - 1] && { href: releases[index - 1].url, label: releases[index - 1].version }, releases[index + 1] ? { href: releases[index + 1].url, label: releases[index + 1].version } : { href: historyUrl, label: "engine API history" }, ["Newer", "Older"])}`;
    pages.push({
      url: release.url,
      kind: "release",
      title: `${release.version} · Release notes · Photivra engine`,
      description: `Release notes for ${sources.packageName} ${release.version}${status ? `, ${status[0].toLowerCase()}${status.slice(1)}` : ""}.`,
      section: "releases",
      body: documentLayout({ side: releaseSide(release.url), article, toc: tocOf(release.section.tokens, 3) }),
      breadcrumbs: crumbs
    });
  });
  {
    const crumbs = [{ label: "Releases", href: "/releases/" }, { label: "Engine API history" }];
    const state = newRenderState();
    const content = changelog.history.map((section) => renderTokens([section.heading, ...section.tokens], { from: "CHANGELOG.md", links, state })).join("\n");
    const article = `${breadcrumbs(crumbs)}
<h1>${escapeHtml(releasesConfig.historyTitle)}</h1>
${content}
${pager(releases.at(-1) && { href: releases.at(-1).url, label: releases.at(-1).version }, undefined, ["Newer", "Older"])}`;
    pages.push({ url: historyUrl, kind: "release", title: `Engine API history · Release notes · Photivra engine`, description: releasesConfig.historyDescription,
      section: "releases", body: documentLayout({ side: releaseSide(historyUrl), article, toc: changelog.history.map((s) => ({ href: `#${s.id}`, label: s.title })) }), breadcrumbs: crumbs });
  }
  {
    const article = `${breadcrumbs([{ label: releasesConfig.heading }])}
<h1>${escapeHtml(releasesConfig.heading)}</h1>
<p>${plural(releases.length, "version")} of ${escapeHtml(sources.packageName)}, newest first, from <a href="${escapeHtml(`${sources.repository}/blob/main/CHANGELOG.md`)}">the changelog</a>.</p>
<ul class="entries">${releases.map((release) => {
      const status = statusLine(release, sources.publishedVersion, longDate);
      return `<li><a href="${escapeHtml(release.url)}">${escapeHtml(release.version)}</a>${status ? ` <span class="muted small">${escapeHtml(status)}</span>` : ""}</li>`;
    }).join("")}
<li><a href="${historyUrl}">${escapeHtml(releasesConfig.historyTitle)}</a></li></ul>`;
    pages.push({ url: "/releases/", kind: "releases-index", title: releasesConfig.title, description: releasesConfig.description, section: "releases",
      body: documentLayout({ side: releaseSide("/releases/"), article }), breadcrumbs: [{ label: releasesConfig.heading }] });
  }

  // ---- License, notices, third party
  for (const [key, path, url] of [["license", "LICENSE", "/license/"], ["notices", "NOTICE", "/notices/"]]) {
    const page = config.pages[key];
    const article = `${breadcrumbs([{ label: page.heading }])}
<h1>${escapeHtml(page.heading)}</h1>
<div class="meta"><a href="${escapeHtml(`${sources.repository}/blob/main/${path}`)}">${escapeHtml(path)} on GitHub</a></div>
<pre class="text" tabindex="0" role="region" aria-label="${escapeHtml(path)}"><code>${escapeHtml(read(path).replace(/\s+$/u, ""))}</code></pre>`;
    pages.push({ url, kind: key, title: page.title, description: page.description, section: key, body: documentLayout({ side: "", article }),
      breadcrumbs: [{ label: page.heading }] });
  }
  {
    const page = config.pages.thirdParty;
    const state = newRenderState();
    const crumbs = [{ label: thirdParty.title }];
    const article = `${breadcrumbs(crumbs)}
${renderTokens(thirdParty.tokens, { from: "THIRD_PARTY.md", links, state })}
${sourceLink("THIRD_PARTY.md")}`;
    pages.push({ url: "/third-party/", kind: "third-party", title: page.title, description: page.description, section: "third-party",
      body: documentLayout({ side: "", article, toc: tocOf(thirdParty.tokens, 2) }), breadcrumbs: crumbs });
  }

  // ---- Not found
  {
    const page = config.pages.notFound;
    const doc = loadDocument("site/content/404.md", fill(read("site/content/404.md"), values));
    const [heading, ...rest] = doc.tokens;
    const state = newRenderState();
    const body = `<div class="wrap searchpage">
<h1>${escapeHtml(plainInline(heading.tokens))}</h1>
${renderTokens(rest, { from: "site/content/404.md", links, state }).replace("<p>", "<p class=\"lead\">")}
<form class="bigsearch" role="search" aria-label="Search the documentation from this page" action="/search/" method="get"><label class="sr-only" for="sq">Search the API and guides</label><input type="search" id="sq" name="q" autocomplete="off" spellcheck="false"><button type="submit">Search</button></form>
<h2>Where to go</h2>
<ul class="entries">
<li><a href="/">Home</a></li>
<li><a href="/quick-start/">Quick start</a></li>
<li><a href="/guides/">Guides</a></li>
<li><a href="/api/">API reference</a></li>
<li><a href="/search/">Index of every export, module and guide section</a></li>
<li><a href="/releases/">Release notes</a></li>
</ul>
</div>`;
    pages.push({ url: "/404.html", kind: "not-found", title: page.title, description: undefined, section: "not-found", body, noindex: true });
  }

  // ---- Checks on the page list itself
  for (const page of pages) {
    if ((page.figures ?? 0) > EXAMPLE_LIMITS.perPage) throw new Error(`${page.url}: ${page.figures} example images, over ${EXAMPLE_LIMITS.perPage}`);
  }
  const unusedExamples = site.examples.filter((example) => !usedExamples.has(example.name));
  if (unusedExamples.length) throw new Error(`Examples whose block is on no page: ${unusedExamples.map((example) => example.name).join(", ")}`);
  makeDescriptionsUnique(pages);
  return { pages, links, searchIndex, documents, modules, changelog };
}

function collectIds(token, add) {
  if (token.type === "heading" && token._id) add(token._id);
  for (const child of token.tokens ?? []) collectIds(child, add);
  for (const item of token.items ?? []) collectIds(item, add);
}

/** The API modules: exports.json grouped by source file, each with its committed page and the kind of each export. */
function apiModules(root, manifest, read) {
  const bySource = new Map();
  for (const item of manifest.exports) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }
  const modules = [];
  for (const [source, items] of bySource) {
    const path = source.replace(/^src\//u, "");
    const id = path.replace(/\.ts$/u, "").replace(/\//gu, "-");
    const area = path.includes("/") ? path.split("/")[0] : "root";
    const doc = loadDocument(`docs/api/${id}.md`, read(`docs/api/${id}.md`));
    const kinds = new Map();
    const exportsList = [];
    for (const item of items) {
      const heading = doc.headings.find((h) => h.depth === 2 && h.text === item.name);
      if (!heading) throw new Error(`docs/api/${id}.md has no heading for the export ${item.name}`);
      const section = doc.sections.find((s) => s.id === heading.id);
      const declaration = section.tokens.find((token) => token.type === "code")?.text ?? "";
      const label = item.kind === "type" ? "Type"
        : /^export (?:declare )?(?:async )?function\b/mu.test(declaration) ? "Function"
          : /^export (?:declare )?(?:abstract )?class\b/mu.test(declaration) ? "Class" : "Constant";
      kinds.set(item.name, label);
      exportsList.push({ name: item.name, id: heading.id, label });
    }
    exportsList.sort((a, b) => KIND_ORDER.indexOf(a.label) - KIND_ORDER.indexOf(b.label) || a.name.localeCompare(b.name));
    const counts = {};
    for (const item of exportsList) counts[item.label] = (counts[item.label] ?? 0) + 1;
    modules.push({ id, source, path, file: path.split("/").pop(), area, url: `/api/${id}/`, doc, kinds, exports: exportsList, counts: countPhrase(counts) });
  }
  modules.sort((a, b) => a.path.localeCompare(b.path));
  const pages = readdirSync(join(root, "docs/api")).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3));
  const orphans = pages.filter((name) => !modules.some((m) => m.id === name));
  if (orphans.length) throw new Error(`docs/api holds pages for no export of docs/api/exports.json: ${orphans.join(", ")} (ci-09)`);
  return modules;
}

function releaseRecord(root, version) {
  const [major, minor, patch] = version.split(".");
  for (const name of [`docs/RELEASE_${major}_${minor}_${patch}.md`, ...(patch === "0" ? [`docs/RELEASE_${major}_${minor}.md`] : [])]) {
    if (existsSync(join(root, name))) return name;
  }
  return undefined;
}

/** SoftwareSourceCode structured data; every value is read from a file (12). */
export function softwareSourceCode(config, sources) {
  const { citation, notice, pkg } = sources;
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: citation.title,
    alternateName: pkg.name,
    description: citation.abstract,
    version: pkg.version,
    codeRepository: citation["repository-code"],
    license: `https://spdx.org/licenses/${pkg.license}`,
    programmingLanguage: config.programmingLanguage,
    runtimePlatform: `Node.js ${pkg.engines.node}`,
    keywords: citation.keywords,
    author: citation.authors.map((author) => ({ "@type": "Person", givenName: author["given-names"], familyName: author["family-names"], name: `${author["given-names"]} ${author["family-names"]}` })),
    copyrightHolder: { "@type": "Organization", name: notice.holder },
    copyrightYear: Number(notice.year),
    url: `${config.origin}/`,
    dateModified: sources.commitDate
  };
}

/** The figure under an example's code block: the engine's PNG, its caption assembled from the result, and the facts. */
function figure(example, sources, site, { home = false } = {}) {
  const src = site.exampleUrls[example.name];
  const kb = Math.round(example.png.length / 1000);
  const where = home ? "" : "Output of the code above. ";
  const caption = home
    ? `<span class="label">${escapeHtml(example.homeLabel ?? "")}</span> ${example.width} × ${example.height}, ${kb} kB, lossless: ${escapeHtml(example.encodedBy)} when this site was built, not resized or re-encoded.${example.label ? ` ${escapeHtml(example.label)}` : ""}`
    : `<span class="label">${where}</span>Run unchanged by ${escapeHtml(sources.packageName)} ${escapeHtml(sources.version)} when this site was built, ${escapeHtml(example.encodedBy)}: ${example.width} × ${example.height}, 8-bit sRGB, lossless, ${kb} kB. The picture is not resized or re-encoded.${example.label ? ` ${escapeHtml(example.label)}` : ""} <a href="${escapeHtml(src)}">Open the PNG</a>.`;
  const image = example.picture
    ? `<img src="${escapeHtml(src)}" width="${example.width}" height="${example.height}" loading="lazy" decoding="async" alt="${escapeHtml(example.alt)}">\n`
    : "";
  const facts = home ? "" : factsHtml(example);
  return `<figure class="example">
${image}<figcaption><p>${caption}</p>
${facts}</figcaption></figure>
`;
}

function shutter(seconds) {
  const reciprocal = 1 / seconds;
  return seconds < 1 && Math.abs(reciprocal - Math.round(reciprocal)) < 1e-6 ? `1/${Math.round(reciprocal)} s` : `${seconds} s`;
}

function factsHtml(example) {
  const parts = [];
  const { facts, result } = example;
  if (facts.layers) {
    const rows = facts.layers.map((layer) => `<tr><th scope="row">${layer.kind === "card" ? `Card ${layer.index}` : "Back plane"}</th><td class="num">${layer.distanceM.toFixed(3)}</td><td class="num">${layer.defocusDiameterSites.toFixed(2)}</td><td>${layer.withinDepthOfField ? "Yes" : "No"}</td></tr>`).join("");
    parts.push(`<div class="scroll" tabindex="0" role="region" aria-label="${escapeHtml(`${result}.scene.layers`)}"><table><caption class="sr-only">${escapeHtml(`${result}.scene.layers`)} for this capture</caption>
<thead><tr><th scope="col">Surface</th><th scope="col" class="num">Distance (m)</th><th scope="col" class="num">Blur diameter (sites)</th><th scope="col">Within depth of field</th></tr></thead>
<tbody>${rows}</tbody></table></div>`);
  }
  const sentences = [];
  if (facts.exposure) sentences.push(`<code>${escapeHtml(result)}.exposure.settings</code>: f/${facts.exposure.fNumber}, ${shutter(facts.exposure.shutterSeconds)}, ISO ${facts.exposure.iso}.`);
  if (facts.assumptions !== undefined) sentences.push(`The ${example.kind === "display-view" ? "display view" : "capture"} recorded ${plural(facts.assumptions, "assumption")} (<code>${escapeHtml(result)}.assumptions</code>).`);
  if (sentences.length) parts.push(`<p class="small muted">${sentences.join(" ")}</p>`);
  return parts.length ? `${parts.join("\n")}\n` : "";
}

/** Gives a section page whose description repeats another's its heading as a prefix (12). */
function makeDescriptionsUnique(pages) {
  const seen = new Map();
  for (const page of pages) {
    if (!page.description) continue;
    seen.set(page.description, (seen.get(page.description) ?? 0) + 1);
  }
  for (const page of pages) {
    if (page.description && seen.get(page.description) > 1 && page.descriptionPrefix) {
      page.description = cut(`${page.descriptionPrefix}: ${page.description}`, 160);
    }
  }
}
