# The documentation site: engine.photivra.com

Status: **the design of the documentation site built in release 2.28.0 (issue #669), written 2026-11-21 against `main` at 99782e7 (2.27.0).** This page designs the engine's public documentation site, served by GitHub Pages at `https://engine.photivra.com/`. It is the design and build specification the site in `site/` follows; deploying it needs the owner's Pages setup ([docs/DEVELOPERS.md](../DEVELOPERS.md#documentation-site)).

The figures are listed in [engine-site.html](engine-site.html) and kept in `screens/site-*`. Site-only sentences below are drafts for the owner's wording review; everything else on the site is the repository's own text.

This design fills the places the build and delivery plan in #669 leaves to the design ("the design slots in here") and answers its design questions 4, 6 to 9 and 12 to 15. It follows that plan, the six gaps of the second review (#709) and the owner's decisions of 2026-11-19 and 2026-11-21. Where it adds to or changes the plan, section 14.1 says so.

Contents: 1. Summary · 2. Rules the site follows · 3. Structure and addresses · 4. Content and its single sources · 5. Navigation · 6. Search · 7. Rendered examples · 8. Visual design · 9. Tailwind CSS · 10. Accessibility · 11. Performance · 12. Search engines and sharing · 13. Security and privacy of the site · 14. Build and publishing · 15. Checks before every deploy · 16. Owner tasks · 17. Owner decisions · 18. Measurements and what is unverified

## 1. Summary

- **What it is.** A static documentation site for the current release of `@photivra/engine`: a home page, install, quick start, guides, a navigable API reference with search, release notes, and the license and notices. About 480 pages, all generated from files that already exist in the repository.
- **Latest release only.** The site describes one version, the one in `package.json`. Earlier versions stay readable in the package of that version and at its tag on GitHub. Versioned documentation is a later step.
- **No second copy of any text.** Every page is rendered from its one source in the repository (section 4). The only hand-written site text is short connecting copy: page titles and descriptions, card labels, the not-found page.
- **Search without a server and without an index download.** One page, `/search/`, lists every task, module, export and guide section as plain links. A small self-hosted script on that page filters the list as the reader types. Without JavaScript the same address is a complete A to Z index (section 6).
- **Pictures are engine output.** A figure in a guide is the output of the code block above it, run unchanged at build time by the engine built from the same commit, and shown as the engine wrote it: lossless, not resized, not re-encoded (section 7). No live demos in 2.28.0.
- **The sibling site's rules, adapted.** The same principles as the Photivra Nope Camera site design (`docs/design/nope-site.md` in Photivra/nope-camera): no tracking, no external requests, a Content-Security-Policy, self-hosted fonts, Tailwind CSS compiled at build, size budgets, Lighthouse floors and checks before every deploy. The one difference is the search script, which that four-page site does not need.
- **Built and published by a workflow** after each successful npm publish and on pushes to `main` that change site content. The site never gates the npm release.

## 2. Rules the site follows

1. **No tracking of any kind.** No cookies, no local or session storage, no analytics, no beacons, no fingerprinting, no embedded third-party content.
2. **No external requests.** A page load asks `engine.photivra.com` for files and nothing else. Links to other sites are plain links that a reader chooses to follow.
3. **No JavaScript unless it is essential.** One script exists, on one page: the search filter on `/search/`. It is self-hosted, loaded with `type="module"`, makes no request, stores nothing, and the page is complete without it. Every other page has no script. The one other `<script>` element allowed is the `application/ld+json` data block of section 12, which browsers do not run.
4. **Single sources.** Text that exists in the repository is rendered from that file, never retyped. A fact that exists in `package.json`, `CITATION.cff`, `NOTICE` or `docs/api/exports.json` is read from there.
5. **Only shipped, checked behavior is described.** The site adds no claim of its own about the engine: no quality statements, no comparisons, no "fastest" or "most accurate". Approximations stay labelled as the source labels them.
6. **Evidence for the site's own statements.** "No cookies", "no external requests" and "the picture is the output of this code" are true because a check fails the deploy otherwise (section 15).
7. **Names.** "Photivra" for the project (pronunciation as the README gives it), `@photivra/engine` for the package. Copyright Shackelford Creative, LLC and the Apache-2.0 license as `NOTICE` and `LICENSE` state them.
8. **US English** in site-only text, `lang="en-US"`. Rendered documents and quoted engine text keep their published spelling, and license names are written as published.
9. **Public and sanitized.** The site and its sources name no private deployment of any Photivra app (AGENTS.md, rule 4); the identity gate runs over the built output too.
10. **The README stays the repository's front door** for 2.28.0 and is not edited for the site. Shortening it to link here is later work.

## 3. Structure and addresses

Every page address ends in a slash and is that page's one canonical address. Directory-style output (`…/index.html`) as the build plan sets out.

| Address | Page | Count | In the sitemap |
| --- | --- | --- | --- |
| `/` | Home | 1 | Yes |
| `/install/` | Install and Node support | 1 | Yes |
| `/quick-start/`, `/quick-start/<section>/` | Quick start: contents, then one page for each `##` section | 1 + 23 | Yes |
| `/guides/` | Guides index | 1 | Yes |
| `/guides/usage/`, `/guides/usage/<section>/` | Usage guide: contents and one page for each `##` section | 1 + 108 | Yes |
| `/guides/display-view/`, `/guides/display-view/<section>/` | Display view: contents and sections | 1 + 19 | Yes |
| `/guides/layered-scenes/` | Layered chart scenes, one page | 1 | Yes |
| `/guides/<name>/` | Six further guides, if decision 7 is accepted | 6 | Yes |
| `/api/` | API index: task index, then modules by area | 1 | Yes |
| `/api/<module>/` | One page per module, for example `/api/optics-depth-of-field/` | 246 | Yes |
| `/search/` | Search, and the full index | 1 | Yes |
| `/releases/` | Release notes index, newest first | 1 | Yes |
| `/releases/<version>/` | One page per changelog section, for example `/releases/2.27.0/` | 66 | Yes |
| `/license/`, `/notices/`, `/third-party/` | `LICENSE`, `NOTICE`, `THIRD_PARTY.md` | 3 | Yes |
| `/404.html` | Not found | 1 | No (`noindex`) |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt` | Generated or copied at build | | |
| `/assets/…`, `/examples/…` | Hashed CSS, fonts, the search script, icons; rendered example images | | |

Rules for addresses:

- **Module pages** use the API generator's own page id (the file name under `docs/api/`). An export's address is its module page plus the fragment GitHub would give its heading: `/api/optics-depth-of-field/#calculatedepthoffield`.
- **Section pages** of a split document use the heading's GitHub anchor id as the path segment, from the shared `anchors()` module (#709, gap 3), so `docs/USAGE.md#depth-of-field-and-defocus` becomes `/guides/usage/depth-of-field-and-defocus/`. A fragment that pointed at a deeper heading becomes the section page plus that fragment. Two sections of one document with the same id get `-1`, `-2` as on GitHub.
- **Areas** (the first path segment of a module's source: `camera`, `capture`, `color` and so on, 18 today) are anchors on the API index (`/api/#optics`), not pages.
- **Query strings.** `/search/?q=…` is the only address that takes one. Its canonical address is `/search/`.
- **Renames.** GitHub Pages has no redirects. When a module or section is renamed, its old address returns the not-found page, which says so and offers search (figure `site-404`). The build prints the list of addresses that existed in the previous deployment's sitemap and are gone, when that sitemap is given to it, so a rename is seen in review. Stable redirects belong with versioned documentation.

Why the long documents are split: `docs/USAGE.md` is 394 kB of Markdown in 108 sections, `docs/QUICK_START.md` 215 kB in 23 and `docs/DISPLAY_VIEW.md` 181 kB in 19. As single pages they would be far over any page budget (section 11) and hard to move around in on a phone. Split at `##`, the largest section is about 22 kB compressed and the median under 2 kB. `docs/LAYERED_SCENES.md` (17 kB) and the other guides stay single pages. The page map carries the `splitAt: "h2"` flag the build plan describes.

## 4. Content and its single sources

| Page | Source | How it reaches the page | What the site adds |
| --- | --- | --- | --- |
| Home | `README.md` from its first line to the first `###` heading (the lead sentence, pronunciation, the capability list, the paragraph on units and provenance); the install command and first example from the README's "Quick start" section | Extracted by heading boundaries; the build fails if a boundary is missing | Four link cards, section headings, one rendered example with its link |
| Install | `NODE_SUPPORT.md`; the package name, version and `engines.node` from `package.json` | Rendered; the install command is assembled from `package.json` | A one-line introduction |
| Quick start | `docs/QUICK_START.md` | Rendered, split at `##` | Contents page, previous and next links |
| Guides | `docs/USAGE.md`, `docs/DISPLAY_VIEW.md`, `docs/LAYERED_SCENES.md` (and the six of decision 7) | Rendered; the first two split at `##` | The guides index: each guide's title and first sentence, read from the guide |
| API index | `docs/api/exports.json` grouped by source directory; the "Task index" table of `docs/API_REFERENCE.md` | Generated | Area headings with module and export counts |
| API module pages | `docs/api/<id>.md`, as committed (the site build does not run the API generator) | Rendered as they are | A "Function" or "Type" label beside each export heading, from `exports.json`; the "On this page" list |
| Search | `exports.json`, the task index, the page list and every guide heading | Generated | The form and the script (section 6) |
| Release notes | `CHANGELOG.md`, cut at each `##` heading | Rendered, one page per version | Status line parsed from the heading; links to the release record, tag and npm version when each exists |
| License, notices, third party | `LICENSE` and `NOTICE` as preformatted text; `THIRD_PARTY.md` rendered | Rendered | Nothing |
| Footer | `package.json` (`version`, `license`), `NOTICE` (holder, year, the trademark sentence, the DNG sentence), the commit being built | Assembled; a test compares the result with the sources | The sentence about cookies, requests and the search script |
| Not found | `site/content/404.md` | Template | |

Rules:

- **Site-only Markdown** lives in `site/content/` and is written with repository-relative links like every other document, so `docs:check` reads and checks it and the generator rewrites the links (#709, gap 1).
- **Links** are rewritten as the build plan sets out: a link to a published file becomes the site address (with the fragment mapped through the split), any other repository link becomes its GitHub address, and a link to a missing file fails the build.
- **Release records** (`docs/RELEASE_*.md`) are not republished. A release page links to its record on GitHub when the file exists (owner decision, 2026-11-21).
- **What stays on GitHub.** Every document not listed above. `docs/DEVELOPERS.md`, linked from every API page, opens on GitHub.
- **The version shown** anywhere on the site is `package.json`'s. A check compares it with `exports.json`'s `packageVersion` and, when examples are rendered, with the engine's own `ENGINE_API_VERSION`.
- **`docs/DEVELOPERS.md`** gains a short "Site" section and its paragraph on documentation hosting is rewritten, as the build plan lists.

### 4.1 Site-only text (drafts)

Home, under the README's own sentences:

> **Documentation.** Quick start: `simulateCapture()`: inputs, defaults, chart presets and output formats. Guides: usage by area, the display view and layered chart scenes, with examples rendered by the engine. API reference: 2,110 root exports in 246 modules, with a task index and search. Release notes: every version from the changelog. The current release is 2.27.0.
>
> **Rendered by the engine.** The pictures in the guides are not illustrations. Each one is the output of the code block above it, run unchanged by `@photivra/engine` 2.27.0 when this site was built.

The numbers and the version in that copy are computed at build. The line under the two buttons ("Version 2.27.0 · Apache-2.0 · Node 22.13 or later and browsers · no network calls, no API key") is assembled from `package.json` and from the first paragraph of `llms.txt`, whose wording it follows.

Footer:

> @photivra/engine 2.27.0. This site was built from the public source at commit *(short commit, linked)*. It sets no cookies and loads nothing from other sites. The only script is the filter on the search page.
>
> Copyright 2026 Shackelford Creative, LLC. Source code under the Apache License, Version 2.0. Photivra trade names, trademarks and logos are owned by Shackelford Creative, LLC. This product includes DNG technology under license by Adobe.

Not found:

> **Page not found.** There is no page at this address. The documentation describes the current release only, @photivra/engine 2.27.0. A page for a module or guide section that was renamed or removed is no longer here.

Search page, when the script has not run:

> Filtering as you type needs JavaScript, which is off or has not loaded. Everything is still here: this page lists every task, module, export and guide section. Use the links below or your browser's Find.

## 5. Navigation

Figures: `site-home`, `site-api`, `site-guide`, `site-release` and their phone captures.

- **Header, on every page:** the name ("Photivra" with "engine" beside it, linking home), six links (Install, Quick start, Guides, API, Releases, GitHub) and the search field. The current section's link has `aria-current="page"` and a heavier underline. The header is not sticky, so it never covers a focused element.
- **On a phone** the same header wraps: the links take two rows and the search field a row of its own. There is no menu button, so nothing is hidden behind a control that would need a script, and nothing is repeated in the markup.
- **Section navigation** (the left column from 64rem; a bordered block above the article below that width):
  - API pages: a link to the API index, then the 18 areas as `<details>` elements with their module counts. The current area is open and lists its modules; the current module is marked. Other areas are closed and hold no links, so the block costs little on each of the 246 pages; each area's modules are one click away on the API index.
  - Guides and quick start: the guides list; on a section page, the document's sections with the current one marked.
  - Release notes: the twelve newest versions, then a link to the full list.
- **"On this page"** (a right column from 80rem; hidden below it, where the headings are close at hand): the page's `##` headings. On API pages that is the module's exports.
- **Breadcrumbs** above each title: `API / optics / depth-of-field.ts`, `Guides / Usage / Depth of field and defocus`, `Releases / 2.27.0`.
- **Previous and next** links at the foot of every module page (within its area), section page and release page.
- **Footer:** License, Notices, Third-party material, Security policy (on GitHub), Source on GitHub, Package on npm; then the two paragraphs of section 4.1.
- **API index** (`/api/`): the version line, the task index table from `docs/API_REFERENCE.md`, then one `##` section per area with its modules, each with its counts of functions and types. The 2,620-row export table of `API_REFERENCE.md` is not reproduced there; the full list of exports is the search page.
- **Wide content.** Every table and every code block sits in a scroll container that is focusable (`tabindex="0"`), has `role="region"` and a name, so wide content scrolls inside its own box and the page never scrolls sideways. This is markup the generator emits, as the build plan notes.

## 6. Search

Figures: `site-search`, `site-search-phone`, `site-search-index`.

### 6.1 The options

| | A. No search | B. Prebuilt index file and a script | C. One index page and a filter script | D. A search library or service |
| --- | --- | --- | --- | --- |
| How it works | Readers use the API index and the browser's Find | The build writes a JSON index; a script on every page fetches it and shows results in a panel | The build writes one HTML page listing everything; a script on that page hides the rows that do not match | A third-party library, or a hosted search |
| Without JavaScript | Works | No search at all, unless a second, plain index page is built as well | The same page, complete, as an A to Z index | None |
| Requests | None | One `fetch` of the index on first use | None beyond the page | A service breaks rule 2; a library is one more dependency tree |
| Script | None | On every page; panel, focus handling and keyboard support to write and test | On one page; no panel, the results are the page's own links | Largest |
| Data kept twice | No | Yes: the index file repeats what the fallback page lists | No | Yes |
| Fit with the checks | | The static check in the build plan fails any shipped script that contains `fetch(`; it would need an exception | Passes unchanged: no `fetch`, no storage, no cookie | |

**Chosen: C.** The approved scope asks for search, and 2,110 exports in 246 modules are too many to find by browsing, so A does not meet it. C gives search with the least script, on one page, with no request and no duplicated data, and its no-script state is not a fallback built on the side: it is the same document. B's only advantage is results without leaving the page, which does not justify a script on every page.

### 6.2 The page

`/search/` holds, in this order: the title, the form (one field named `q`, a "Search" button, a one-line hint), a status line, and four lists:

1. **Tasks:** the rows of the task index (16 today), each linking to its place on the API index and naming its functions.
2. **Exports:** all 2,110, alphabetical under letter headings, each row a link to the export's heading on its module page, with "Function" or "Type" and the module path.
3. **Modules:** all 246, each with its counts.
4. **Guide sections:** every `##` heading of the quick start and the guides, each with its document's name.

Above the lists is a row of links to each list, and above the exports a row of letters. The page's HTML is the index; nothing else is downloaded. Measured from `exports.json`, the export rows are about 418 kB of HTML and 48 kB gzip (35 kB Brotli); the page's budget is in section 11.

**The header's search field** on every other page is a plain `GET` form to `/search/`. It needs no script: submitting it opens `/search/?q=…`.

### 6.3 The script

One file, `assets/search.<hash>.js`, referenced only from `/search/` as `<script type="module" src="…">` at the end of `body`. Hand-written, no dependency, at most 6 kB before compression.

- **On load** it reads `q` from the address, puts it in the field and filters. It removes the "needs JavaScript" notice.
- **On input** (debounced by one animation frame) it filters and updates the address with `history.replaceState`, so a filtered view can be shared and the Back button is not filled with keystrokes.
- **Matching.** The query is lower-cased and split on spaces; every term must occur in the row's text (name, kind, module path, or heading and document name). Case is ignored.
- **Order within each list.** An exact name first; then a name that starts with the query; then a match at the start of a word inside a camel-case or hyphenated name (`depth` in `calculateDepthOfField`); then any other match. Ties: functions before types, then alphabetical. Rows are moved, not rebuilt, so every result is the page's own link.
- **What is shown.** Lists with no match are hidden together with their headings and the letter headings. The first 50 matches of each list are shown, with a "Show all *n*" button when there are more. An empty query restores the full index.
- **Status.** A `role="status"` line states the result after each filter: "10 matches for “depth”: 1 task, 5 exports, 1 module and 3 guide sections." or "No matches for “…”. Check the spelling, or browse the API index." It is polite, so a screen reader announces it once typing pauses.
- **No keyboard shortcut,** no autofocus, no combobox. The field is an ordinary search field and the results are ordinary lists of links, in the tab order, so nothing needs custom key handling (WCAG 2.1.4 and 2.4.3 hold by construction).
- **What it never does:** no `fetch`, no `XMLHttpRequest`, no storage, no cookie, no timer beyond the one frame. The static request check enforces this.
- **Testing.** The matching and ordering function is a pure module with unit tests (`node --test`). The browser pass of section 15 types a query and checks the status text, the visible rows and the address.

### 6.4 What search does not cover in 2.28.0

- The body text of guides and of API descriptions. Search matches names and headings. Full-text search would need an index of several megabytes or a server; the names and headings are what a reader of an API reference types.
- Release notes. They are reached from the releases index; version numbers are not useful search terms here.
- Synonyms and spelling correction.

## 7. Rendered examples

Figure: `site-guide` (and the last band of `site-home`). The picture in both is a real render by 2.27.0.

### 7.1 The rule

**A figure is the output of the code block directly above it, run unchanged, by the engine built from the commit the site is built from.** The site shows no picture of engine output that was made any other way: no screenshots, no illustrations, no images committed by hand.

### 7.2 How a figure is declared

A small manifest, `site/examples/examples.json`, lists the examples. Each entry names a fenced block the way `docs/validation/documentation-fragments.json` already does, plus what to show:

| Field | Meaning |
| --- | --- |
| `file`, `block` | The Markdown file and the index of its fenced `ts` block |
| `result` | The name of the binding in that block that holds the capture result |
| `alt` | The picture's alternative text, written by a person; it describes what is visible and claims nothing more |
| `facts` (optional) | Which parts of the result to print under the picture, from a fixed list: `exposure.settings`, `scene.layers`, the number of `assumptions` |

The code is not copied into the manifest or into a script file. The build takes the block from the guide, transpiles it the way the documentation check compiles guide blocks, runs it, and reads the named binding. The page shows the guide's code block as always, and the figure follows it.

### 7.3 What the build does with each example

1. Builds the engine from the same commit (`npm ci --ignore-scripts` and `npm run build` at the repository root) and checks that its `ENGINE_API_VERSION` equals `package.json`'s version.
2. Runs the block. Whatever the block states is what runs: its size, its format, its `fast` setting. The build adds no option and changes none.
3. Requires the result to carry a PNG (`output.format: "png"`), which the engine writes itself with `serializePngImage`. If the block asks for sRGB samples instead, the build encodes those exact samples with the same engine function and the caption says so. PNG and the other export formats take the engine's exact methods by default (`docs/QUICK_START.md`, "Inputs and defaults", the `fast` row), so a figure is a full-quality render unless its code says otherwise, and then the code above it shows that.
4. Writes the file to `/examples/<page>-<heading>.<hash>.png` and the figure into the page: the image with its true `width` and `height`, the caption, the facts table, and a link to the file.
5. Fails the build if a block throws, if the named binding is missing, if a file is over its budget, or if a second run gives different bytes.

**No image tooling.** The build has no image library and never resizes or re-encodes. One file per example, at the size the code asks for. The layout scales it down on a narrow screen (`max-width: 100%`); it is never scaled up beyond its pixels. There is no `srcset`: a second size would have to be either a resampled copy, which is not the engine's output, or a second capture at another resolution, which is a different picture (different sampling of the scene). Decision 4 covers this reading of the "responsive images" requirement.

**The caption** is assembled from the result, never typed: "Output of the code above. Run unchanged by @photivra/engine 2.27.0 when this site was built, then written with `output.format: "png"`: 600 × 400, 8-bit sRGB, lossless, 267 kB. The picture is not resized or re-encoded." No render time is printed, because it differs between runs and the build must be reproducible.

**Small outputs.** A block whose image is under 240 pixels wide (the ten-line capture writes 16 × 16) gets the facts table without a picture.

### 7.4 Budgets for examples

| Item | Budget |
| --- | --- |
| One example image | 400 kB |
| Example images on one page | 3, all `loading="lazy"` and `decoding="async"` |
| Examples in 2.28.0 | 12 at most |
| All example images | 4 MB |
| Render time, one example, on the workflow's runner | 10 s |
| Render time, all examples, one build | 90 s (the reproducibility check builds twice) |

Measured on 2026-11-21 with 2.27.0 (section 18): the layered-chart block of `docs/LAYERED_SCENES.md`, "Using it", runs unchanged in 3.0 s and writes a 267 kB PNG at 600 × 400; chart presets at 720 × 480 take 0.2 to 0.3 s and write 480 to 503 kB, which is over the image budget, so those need a smaller size in their code. Lossless files of noisy images are large because noise does not compress. That is the cost of showing the engine's pixels as they are, and the reason for the limit of three per page.

### 7.5 Which examples

For 2.28.0, start with blocks that already write a picture of a useful size, without editing any document that is packed into the npm package (`docs/USAGE.md`, `docs/QUICK_START.md`): the layered-chart block above is the first. Further examples are chosen by the builder from the documented blocks and listed in the pull request with their measured size and time. A guide may gain a new block to carry a figure; that is a documentation change reviewed like any other.

### 7.6 Live demos

**Recommended: not in 2.28.0.** A live demo runs the engine in the reader's browser. It would need the engine bundle on the site (a second build product with its own size limit), a worker so a render does not block input, a form with validation, a script budget of a different order from the search filter's, and a wider Content-Security-Policy. It would also be the only part of the site that is an application rather than a document, with its own accessibility work. The rendered examples already show real output with the code that made it, and the code runs as written after `npm install`. If demos are wanted later, they belong on one page of their own (`/playground/`) with a separate design, budget and policy, leaving every other page as it is.

## 8. Visual design

### 8.1 The look

A reference document: text first, one neutral palette, no decoration. The same tokens and type as the Photivra Nope Camera site, so the two sites read as one family, without that site's black hero or the app's teal mark, which belong to the app. There is no logo in this repository and the design draws none: the name is set in type. Light or dark follows the reader's setting. No gradient, no illustration, no animation.

### 8.2 Tokens

Defined once in the Tailwind theme (section 9) as CSS variables that change with `prefers-color-scheme`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `ground` | `#FFFFFF` | `#111113` | Page background |
| `surface` | `#F2F2F7` | `#1C1C1E` | Code blocks, inline code, cards, the current item in a list |
| `ink` | `#1C1C1E` | `#F2F2F7` | Text, links, filled buttons |
| `muted` | `#5F5F64` | `#AEAEB2` | Secondary text, labels |
| `rule` | `#D1D1D6` | `#3A3A3C` | Hairlines (decoration only) |
| `control` | `#6E6E73` | `#8E8E93` | Borders of the search field, outline buttons and the kind labels |
| `focus` | `#1C1C1E` | `#40C8E0` | Focus outline |

- Six of the seven are the sibling site's values. The dark ground is `#111113` rather than black: these are long pages of text and code, and the app's black ground is a camera screen's, not a document's. `control` is new: a form field's border must reach 3:1 (WCAG 1.4.11), which `rule` does not.
- **No accent color.** Links are the text color, underlined; they never depend on color. In navigation lists, where every item is a link, the underline appears on hover and focus and the current item is marked by weight and a `surface` background as well as `aria-current`.
- **Code is not colored.** No syntax highlighting in 2.28.0: it would add a dependency to approve and several times the markup to each of 2,366 `ts` blocks. Code is set in the monospace stack on `surface`.
- "Function" and "Type" are words in a small outlined label, not colors.

### 8.3 Type

| Role | Family | Size | Weight |
| --- | --- | --- | --- |
| Page title (`h1`) | Inter | 2 to 2.75rem, by window width | 700 |
| `h2` | Inter | 1.5rem | 700 |
| `h3` | Inter | 1.1875rem | 600 |
| Lead paragraph (home, not found) | Inter | 1.25rem | 400 |
| Body | Inter | 1.0625rem, line height 1.55, lines at most 46rem | 400 |
| Small, tables, side navigation | Inter | 0.9375rem; the footer 0.875rem | 400 |
| Code, export names | System monospace stack | 0.875em of its context | 400 |

- **Inter** (SIL Open Font License 1.1), self-hosted, weights 400, 600 and 700 in two WOFF2 files (regular, and one file for 600 to 700), subset to the characters the built pages use. The content includes `µ`, `×`, `·`, `—`, `≤`, `→`, Greek letters, superscripts such as `⁻¹⁴` and the IPA of the pronunciation line. Characters outside the subset fall back to the system font through the stack; the builder confirms which of these Inter covers when making the subset (section 18).
- **Code uses the reader's system monospace font** (`ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`). No file, nothing to subset or license, and code is the largest share of the reference.
- Sizes are in `rem`, so the reader's text size is respected.
- The font files are committed finished, as the build plan requires (no font tooling in the build), with the license text beside them. Decision 8 covers the font and its record.

### 8.4 Space, shape and layout

- Tailwind's default spacing scale. Section padding 48 px, 32 px on a phone. Radii 6, 8 and 12 px.
- Content at most 82rem wide. A document page is three columns from 80rem (navigation 15rem, article at most 46rem, "On this page" 13rem), two from 64rem, one below. Side margins 24 px, 16 px on a phone.
- Breakpoints: 48rem, 64rem, 80rem.
- Every link in the header, footer and letter row, every button and the search field is at least 44 px high.
- The side navigation is sticky from 64rem and scrolls within itself; it never overlaps the article.
- Print: the header links, the search form, the side columns and the footer links are removed; the article prints black on white with link addresses after the link text.

### 8.5 Figures

| Figure | Shows |
| --- | --- |
| `site-home`, `site-home-dark`, `site-home-phone` | Home: light and dark at 1280 px, dark at 390 px |
| `site-api`, `site-api-dark`, `site-api-phone` | A module page (`optics/depth-of-field.ts`), top of the page |
| `site-search`, `site-search-phone` | Search with results for "depth" |
| `site-search-index` | The same address before the script runs, or without it: the notice and the index |
| `site-guide`, `site-guide-dark`, `site-guide-phone` | Layered chart scenes with its rendered example and facts table |
| `site-release`, `site-release-phone` | The release notes page for 2.27.0 |
| `site-404`, `site-404-phone` | Not found |

The figures are self-contained HTML (inline CSS, no scripts, no external requests) with PNG captures. The captures set text in Inter. No font file is committed with this design, so the HTML files use Inter when it is installed and the system font otherwise. Their CSS is hand-written to show the result; the build produces the same result from Tailwind classes. All text and numbers in them come from the repository at 2.27.0; `site-example-layered-chart.png` is the engine's own output for the code shown. Each figure was also loaded at 320 px wide with no sideways scrolling.

## 9. Tailwind CSS

Owner's decision (2026-11-19): Tailwind CSS, compiled at build time with a pinned CLI; one small, minified, content-hashed file holding only the classes in use; never the CDN or a runtime script.

- **Packages:** `tailwindcss` and `@tailwindcss/cli` at one exact version in `site/package.json` (development dependencies; the build plan's table records the versions current on 2026-11-20). Installed with `npm ci --ignore-scripts`.
- **Configuration in CSS.** `site/styles/site.css` holds `@import "tailwindcss"`, the theme, and the sources to scan: the templates and the rendered HTML in `_site/`. No JavaScript configuration file.
- **The theme is the token table.** Colors are CSS variables set for light and, under `prefers-color-scheme: dark`, for dark, and exposed as theme colors (`bg-ground`, `bg-surface`, `text-ink`, `text-muted`, `border-rule`, `border-control`, `outline-focus`). Pages therefore need almost no `dark:` classes. The font families, the type sizes of 8.3 and the three radii are theme values. Spacing is the default scale.
- **Rendered Markdown** is styled by a small set of hand-written rules in the same file (a `prose` component: headings, paragraphs, lists, tables, block quotes, code, task lists), not by the `@tailwindcss/typography` plugin. The Markdown here is a small, known subset, so the rules are short, and the plugin would be one more dependency to approve.
- **No inline styles.** The pages carry no `style` attribute and no inline `<style>`, so the Content-Security-Policy needs no `'unsafe-inline'`.
- **Variants used:** `focus-visible:`, `motion-safe:` (for any motion ever added), `print:`, `forced-colors:`, and the three breakpoints.
- **Preflight** is kept. The output keeps Tailwind's license banner.
- **Order in the build:** pages are rendered, then the CLI runs over them, then the file is hashed and its name written into every page, then the checks run, as the owner's comment requires.

## 10. Accessibility

The target is WCAG 2.2 level AA. The site states no conformance claim; this section is what the build must meet and what the checks look for.

- **Structure:** one `h1` per page; headings in order, none skipped (the split of long documents keeps each section's `##` as the page's `h1` and promotes nothing else, so the deeper headings are renumbered one level up consistently); `header`, `main`, `footer` landmarks; each `nav` named ("Site", "API modules", "Guides", "Releases", "Breadcrumb", "On this page"); the search forms have `role="search"`.
- **Skip link:** the first focusable element, "Skip to content", visible when focused, targeting `main`.
- **Keyboard:** everything is a link, a button, a form field, a `<details>` summary or a focusable scroll region, in reading order. No custom widget, no keyboard trap, no shortcut keys.
- **Visible focus:** a 3 px outline, offset 3 px, in the `focus` token on `:focus-visible`; never removed. 17.0:1 on the light ground and 9.5:1 on the dark.
- **Focus not obscured** (2.4.11): the header is not sticky and the sticky side column sits beside the article, not over it.
- **Target size** (2.5.8): interactive controls outside running text are at least 44 px high; links inside text are exempt as inline targets.
- **Contrast,** computed from the tokens:

  | Pair | Light | Dark | Needs |
  | --- | --- | --- | --- |
  | `ink` on `ground` | 17.0:1 | 16.9:1 | 4.5:1 |
  | `muted` on `ground` | 6.3:1 | 8.5:1 | 4.5:1 |
  | `ink` on `surface` | 15.2:1 | 15.2:1 | 4.5:1 |
  | `muted` on `surface` | 5.7:1 | 7.7:1 | 4.5:1 |
  | `control` on `ground` (field and button borders) | 5.1:1 | 5.8:1 | 3:1 |
  | `control` on `surface` | 4.5:1 | 5.2:1 | 3:1 |
  | `focus` on `ground` | 17.0:1 | 9.5:1 | 3:1 |
  | Button text (`ground` on `ink`) | 17.0:1 | 16.9:1 | 4.5:1 |

  `rule` hairlines are decoration and carry no information.
- **Tables:** header cells with `scope`; a caption (visually hidden where the heading above already names the table); each in a named, focusable scroll region.
- **Code blocks:** each in a named, focusable scroll region ("Declaration", "Example code"), so a keyboard user can scroll a long line.
- **Images:** every example image has alternative text written for it in the manifest, saying what is visible. The facts table under it gives the numbers as text. No decorative images.
- **Search:** a labelled field; results announced through a polite status line; results are plain links in document order (section 6.3). The page is fully usable with the script off.
- **Text size and reflow:** no sideways scrolling of the page at 320 px wide or at 200% and 400% zoom; long export names break (`overflow-wrap: anywhere`); wide tables and code scroll inside their own regions, which is the exception 1.4.10 allows for content that needs two dimensions. Text spacing may be overridden without loss.
- **Motion:** none. No transitions, no smooth scrolling.
- **Themes:** `prefers-color-scheme` decides; `<meta name="color-scheme" content="light dark">`. `forced-colors` is honored: system colors replace the tokens, the focus outline stays, and the current navigation item gets an outline because its background would be lost.
- **Language:** `lang="en-US"` on every page.
- **Link text** says where the link goes ("Source on GitHub", "Release record for 2.27.0 on GitHub"). Links open in the same tab.
- **Checks:** the automated pass of section 15 in both themes, and a manual pass per template before the first publication and after any layout change: a screen reader in two browsers, keyboard only, 200% and 400% zoom, 320 px, both themes, forced colors, print preview. The result is recorded with the pull request. An automated pass does not replace it.

## 11. Performance

**Budgets** (bytes as transferred with gzip, which is what the checks measure; the build fails over them). All are estimates from the measurements in section 18 until the first build measures real pages, and are then set in `site/checks/budgets.json`.

| Item | Budget |
| --- | --- |
| HTML, home | 10 kB |
| HTML, a module page, a guide or quick-start page, a release page | 40 kB (the largest sources today compress to 22 to 26 kB as Markdown; the median page is under 3 kB) |
| HTML, API index | 20 kB |
| HTML, search page | 70 kB |
| HTML, not found; license; notices | 8 kB each |
| CSS, the one file | 12 kB |
| Fonts | 2 files, 60 kB together |
| JavaScript, search page | 1 file, 2.5 kB |
| JavaScript, every other page | 0 |
| Icons | 6 kB |
| **First view of any page** (HTML, CSS, fonts, icon) | **120 kB** |
| **First view of the home page** | **90 kB** |
| Example images | Section 7.4; never in the first view |
| The social image (not loaded by pages) | 120 kB |
| Requests to other hosts | 0 |

**Targets,** on a mid-range phone on a slow 4G profile: Largest Contentful Paint under 2.5 s, Cumulative Layout Shift under 0.1, Interaction to Next Paint under 200 ms.

**Lighthouse floors,** the sibling site's: performance 95, accessibility 100, best practices 95, SEO 100; mobile profile, three runs, the median; run locally in the workflow on one page of each template and on the heaviest page of each kind (decision 10).

**How:**

- No script blocks rendering anywhere. The search script is a module at the end of one page.
- One CSS file, minified, only the classes in use, content-hashed.
- **Fonts:** two subset WOFF2 files, `font-display: swap`, the regular weight preloaded. The fallback font is given `size-adjust`, `ascent-override` and `descent-override` so the swap moves nothing. Code needs no font file.
- **The largest element of a first view is text** on every page. Example images come after the code they belong to, are lazily loaded, and have `width` and `height` set, so nothing shifts.
- **Search stays fast** because it filters at most about 2,500 short strings already in memory and only toggles and moves existing rows; the first 50 matches per list are shown.
- Every asset name carries a content hash, so a page never mixes old and new files.
- **A limit of the host:** GitHub Pages sets the cache lifetime and a site cannot change response headers. The owner accepted that lifetime (2026-11-21). The hashes are still right, and a tool's "cache policy" note is expected.
- **Field data:** with no analytics there is none. The workflow enforces what produces good results (budgets, set dimensions, no blocking script) and the browser pass records layout shift per template in the lab.

## 12. Search engines and sharing

- **Titles** (unique, at most 60 characters where the name allows) and **descriptions** (unique, at most 160 characters):

  | Page | `<title>` | Meta description |
  | --- | --- | --- |
  | Home | Photivra engine: the science of photography in TypeScript | The abstract in `CITATION.cff`, then "Apache-2.0, for browsers and Node." |
  | Install | Install · Photivra engine | "Install @photivra/engine *version* from npm. Node *engines.node* and current browsers." |
  | Quick start, guides (single page or contents) | *Document title* · Guides · Photivra engine | The document's first sentence, cut at a word boundary |
  | A section page | *Section heading* · *Document title* · Photivra engine | The section's first sentence, cut at a word boundary; the heading is prefixed when two would otherwise be equal |
  | API index | API reference · Photivra engine | "Every root export of @photivra/engine *version*: *n* exports in *m* modules, with a task index." |
  | A module page | *module path* · API · Photivra engine | "*module path*: *n* functions and *m* types of @photivra/engine, including *the first three functions*." |
  | Search | Search · Photivra engine | "Find an export, module, task or guide section of @photivra/engine." |
  | Releases index | Release notes · Photivra engine | "Every version of @photivra/engine, newest first." |
  | A release page | *version* · Release notes · Photivra engine | "Release notes for @photivra/engine *version*, *status and date from the changelog heading*." |
  | License, notices, third party | *Name* · Photivra engine | One sentence each, in `site.config.json` |
  | Not found | Page not found · Photivra engine | None; `noindex` |

  The check for uniqueness runs over the whole page list.
- **Canonical:** `<link rel="canonical">` on every page: HTTPS, the configured origin, the trailing slash, no query string.
- **Sitemap:** `sitemap.xml` (sitemaps.org 0.9) with every page except `404.html`, each with `lastmod` set to the date of the commit being built (owner decision, 2026-11-21). **`robots.txt`:** `User-agent: *`, `Allow: /`, `Sitemap: https://engine.photivra.com/sitemap.xml`. `<link rel="sitemap" type="application/xml" href="/sitemap.xml">` on every page. All generated from the one page list.
- **Open Graph and the large-image card** on every page: `og:type` (`website`), `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image` with width, height and alternative text, `og:locale` (`en_US`), and `twitter:card` set to `summary_large_image`. These are read by a service when someone shares a link; they cause no request from a reader's browser.
- **The social image:** one self-hosted PNG, 1200 × 630, type only: "Photivra", the abstract from `CITATION.cff` and `@photivra/engine`, in Inter on the dark ground. No logo, no rendered example. Committed finished (decision 11).
- **Structured data** (JSON-LD). Every value is read from a file; nothing is typed into a template.
  - `WebSite` on the home page: `name`, `url`.
  - `SoftwareSourceCode` on the home page and the API index:

    | Property | Value | Read from |
    | --- | --- | --- |
    | `name` | Photivra | `CITATION.cff`, `title` |
    | `alternateName` | @photivra/engine | `package.json`, `name` |
    | `description` | The abstract | `CITATION.cff`, `abstract` |
    | `version` | 2.27.0 | `package.json`, `version` |
    | `codeRepository` | The repository address | `CITATION.cff`, `repository-code` |
    | `license` | `https://spdx.org/licenses/Apache-2.0` | `package.json`, `license` |
    | `programmingLanguage` | TypeScript | `site.config.json`; the one constant |
    | `runtimePlatform` | Node.js >=22.13.0 | `package.json`, `engines.node` |
    | `keywords` | The keyword list | `CITATION.cff`, `keywords` |
    | `author` | A `Person` with the names given | `CITATION.cff`, `authors` |
    | `copyrightHolder`, `copyrightYear` | An `Organization` named Shackelford Creative, LLC; 2026 | `NOTICE` |
    | `url` | The site's origin | `site.config.json` |
    | `dateModified` | The date of the commit being built | The build |

  - `BreadcrumbList` on every inner page, the same items as the visible breadcrumb.
  - **Never:** ratings, reviews, download or star counts, awards, an `offers` block, or any property with no source file. The check compares every value with its source.
- **Icons:** `favicon.ico` (32 px), an SVG icon and a 180 px touch icon, self-hosted. No web app manifest: the site is not an installable app. The artwork is decision 11.
- **`/llms.txt`:** the repository's `llms.txt`, served unchanged (decision 14).
- **Headings and links:** one `h1` per page; descriptive link text; `lang="en-US"`.

## 13. Security and privacy of the site

- **Content-Security-Policy,** by `<meta http-equiv>` as the first element after the character set on every page:

  `default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'`

  On `/search/` only, `script-src 'self'` is added. Everywhere else there is no `script-src`, so scripts fall under `default-src 'none'`. No `'unsafe-inline'` anywhere.
- **`<meta name="referrer" content="no-referrer">`,** so a site the reader goes to is not told which page they came from.
- **What a meta tag cannot do:** `frame-ancestors`, reporting and `sandbox` work only as response headers, and GitHub Pages does not let a site set headers. The only form is the search field, which sends its text to the site's own search page and nowhere else.
- **The search query** appears in the address of `/search/?q=…`. It is sent to the host as part of that request, like any page address, and to no one else; `no-referrer` keeps it out of outbound links. The script stores nothing.
- **External links.** Templates may link only to a short list the check enforces: the repository and its tags on `github.com`, the package on `npmjs.com`, and the license's SPDX address in structured data. Links inside rendered documents (source citations, standards) are the documents' own; the build lists them in its log and never fetches them.
- **No embedded media, no iframes, no `mailto:` links, no forms other than search.**
- **DNS only, no proxy** in front of the site, for the same reason as on the sibling site: a proxy is a second party that sees every reader and can alter pages. The owner accepted the host's cache lifetime, so nothing calls for one.
- **What the host does:** GitHub receives the reader's IP address with each request and logs it for security. The site says nothing more about it than the footer's sentence; this is a documentation site with no privacy page of its own.
- **Dependencies:** exact versions, a committed lockfile, `npm ci --ignore-scripts`; the license gate reads the site's lockfile as well (build plan, step 3). The owner approves the dependency tree once the lockfile exists (2026-11-21).

## 14. Build and publishing

The generator, its layout under `site/`, the page head, the sitemap, the link rewriting, the reproducible build and the workflow are as the build and delivery plan in #669 describes them, with the six gaps of #709 closed. This section records only what the design fixes or adds.

### 14.1 Additions and changes to the build plan

| # | Change | Why |
| --- | --- | --- |
| 1 | `site/lib/search.mjs` writes the search page; `site/assets/search.js` is the one script; `site/test/` tests its matching function | Section 6 |
| 2 | `site/examples/examples.json` and `site/lib/examples.mjs`; the build job installs and builds the engine at the repository root before the site build | Section 7. The plan's "the root install is not needed" no longer holds |
| 3 | The pull-request trigger's `paths` gain `src/**`, `llms.txt` and the shared `anchors` module | An engine change can break an example; it must fail on the pull request, not after a release (decision 13) |
| 4 | A publication guard on deployments from `main` (14.3) | So the site never shows a version that is not on npm |
| 5 | Lighthouse as one more site development dependency, run against the loopback server | The floors of section 11 (decision 10) |
| 6 | Budgets are measured with gzip, not Brotli | To be confirmed against what the host serves (section 18); gzip is the larger, so the budget is safe either way |
| 7 | No `CNAME` file question is reopened: the plan's file and its check stay | |
| 8 | The static request check gains: `script-src` appears only on `/search/`; the one script holds no `fetch`, `XMLHttpRequest`, storage or cookie access; no page other than `/search/` has a `<script>` that is not `application/ld+json` | Section 2, rule 3 |
| 9 | `html-validate`, `axe-core`, Tailwind and `marked` as the plan lists them; no syntax highlighter, no typography plugin, no image or font tooling | Sections 8 and 9 |

Closing the #709 gaps in design terms: site-only Markdown uses repository-relative links (gap 1); a change confined to `site/**` or `docs/design/**` runs no engine tests once the scope rule exists (gap 2); heading ids come from the shared `anchors()` module, which skips fenced code, and the parity test is stated against that module (gaps 3 and 4); the Pages check is not a required check (gap 5); the `workflow_run` deployment is guarded as in 14.2 (gap 6).

### 14.2 The workflow

`.github/workflows/pages.yml`, GitHub-hosted runner, every action pinned by commit SHA, `contents: read` at workflow level, `pages: write` and `id-token: write` on the deploy job only, no secrets.

| Trigger | Builds | Deploys |
| --- | --- | --- |
| `pull_request` touching the `paths` list | The pull request's merge commit | Never. The built site is uploaded as an ordinary artifact kept one day, for review |
| `workflow_run` of the npm publish workflow, `completed` | `github.event.workflow_run.head_sha`, only after checking that the conclusion is `success`, the event is `push` and the run's repository is this one | Yes |
| `push` to `main` touching site content (`site/**`, `docs/**`, `README.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE`, `THIRD_PARTY.md`, `NODE_SUPPORT.md`, `package.json`, `llms.txt`) | The pushed commit | Only if the publication guard passes |
| `workflow_dispatch` | `main` | Only if the publication guard passes |

- **The site does not gate the npm release** (owner decision): it deploys after a publish has succeeded. If the site build fails then, the package is out, the previous site stays up, the run is red, and the fix is deployed from `main`.
- **The Pages check is not required** on pull requests, since the workflow is path-filtered (#709, gap 5).
- One deployment at a time; a running deployment is not cancelled. Pull-request runs use their own group and cancel their predecessors.
- **No preview deployment.** Nothing unreleased is published anywhere.
- The `github-pages` environment allows deployments from `main` and from `v*` tags only (owner task).

**Build job, in order:** check out; Node as the publish workflow pins it, with the support-policy guard; install and build the engine at the root (for the examples); `npm ci --ignore-scripts --prefix site`; the deploy decision (14.3; after the site install, because the guard uses the site's Markdown parser); the generator's unit tests; the site build (pages, examples, search page, then the Tailwind CLI, then hashing); the same build into a second directory and a byte comparison; each check of section 15 as its own step; upload the artifact.

### 14.3 The publication guard

The site describes the version in `package.json` and prints its install command. Between the merge of a release's pull request and its publication, `main` holds a version that is not on npm yet, and the changelog's newest heading says so ("unreleased" or "prepared"). A deployment from `main` in that window would tell readers to install a version that does not exist.

- **Rule:** a `push` or manual run deploys only if the newest changelog section's version equals `package.json`'s version and its status begins with "published". Otherwise the run builds and checks, deploys nothing, and its summary says why.
- **The release itself** is deployed by the `workflow_run` trigger, where the successful publish is the proof. At that commit the changelog heading still reads as prepared, so that build is told the published version by the workflow and shows that one version's status as "Published", with no date. The date appears when the publication record lands on `main` and the changelog states it; that push passes the guard and redeploys.
- The guard reads only the repository. It makes no call to the npm registry.

### 14.4 Order of work

As the build plan's order, with the design applied at its step 3. Prerequisites stay as #709 states them: the identity-gate and `docs:check` fixes before the generator's tests are written, and the orphan-page fix before the first deployment. The first deployment is a manual run by the owner after the settings of section 16 are in place.

## 15. Checks before every deploy

All run on the built `_site/` on the runner, against a server on `127.0.0.1` where a browser is needed. None calls an outside service; the only network use is installing the pinned tools. The table of checks in the build plan stands; these are the additions the design brings and the values it sets.

| Check | What fails it | Tool |
| --- | --- | --- |
| The site's promises | Any `<script>` outside `/search/` other than `application/ld+json`; more than one script file; a script over its budget or containing `fetch(`, `XMLHttpRequest`, `sendBeacon`, `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie`; any `on…` attribute; any `style` attribute or inline `<style>`; a missing or different Content-Security-Policy; a template link to a host not on the list of section 13; a form other than the search form; an iframe, `object` or `embed` | `site/checks/requests.mjs` |
| A real page load | Any request to another host, any cookie, any storage write, any console error or policy violation, on every page | The browser pass |
| Search | With the script: a query from a fixed list gives the expected first result, count and status text, and the address carries the query. Without it: every export in `exports.json`, every module, every task and every guide heading is a link on the page, and each link resolves | The browser pass; `site/checks/links.mjs` |
| Examples | A block that throws; a missing binding; an engine version different from `package.json`'s; an image over 400 kB; more than three on a page; an image element without `width`, `height`, `alt`, `loading="lazy"`; a second build with different bytes; an image file on the site that no manifest entry produced | `site/lib/examples.mjs`; the reproducibility step; `site/checks/meta.mjs` |
| Single sources | The footer's holder, year and license differing from `NOTICE` and `package.json`; a version anywhere on the site differing from `package.json`; home text that is not in the README; structured-data values differing from their source files; a title or description used twice | `site/checks/meta.mjs` |
| HTML | Validation errors | `html-validate` |
| Links | A broken internal link or fragment; a missing file; `http:` anywhere. External links are listed, never fetched | `site/checks/links.mjs` |
| Search engines | The build plan's list: one `h1`, `lang`, canonical, sitemap contents, `robots.txt`, `noindex` on the not-found page only, Open Graph tags and image | `site/checks/meta.mjs` |
| Accessibility | Any WCAG 2.0, 2.1 or 2.2 A or AA violation in light and dark; the first focusable element not the skip link; a focused control without a visible outline; sideways scrolling at 320 px or 640 px; a table or code block outside a named, focusable scroll region; a running animation | `axe-core` in the browser pass |
| Size | Any budget of sections 7.4 and 11 | `site/checks/budgets.mjs` |
| Lighthouse | A score under the floor on a sampled page | Lighthouse, run locally |
| Identity | A private host name or legacy identifier in the built output | The repository's identity gate, run over `_site/` |
| Publication guard | Not a failure: it decides whether the deploy job runs (14.3) | The workflow |

The browser pass covers every page for requests, reflow and focus. If the full accessibility rule set over about 480 pages in two themes takes more than ten minutes, it runs on one page of each template and on the heaviest page of each kind, as the build plan allows. Each hand-written check gets a passing and a failing fixture.

## 16. Owner tasks

One time, in this order. Each is production infrastructure under AGENTS.md, rule 3, and none is done by an agent.

1. **Verify the domain for the organization** in GitHub's Pages settings (a TXT record GitHub names), so no other account can claim it.
2. **DNS:** a `CNAME` record, name `engine`, target the organization's Pages host (`photivra.github.io`), DNS only, not proxied. No wildcard record. If the domain has CAA records, they must allow the certificate authority GitHub Pages uses.
3. **Repository settings, Pages:** source "GitHub Actions"; custom domain `engine.photivra.com`; after the DNS check and the certificate, turn on **Enforce HTTPS**.
4. **Repository settings, Environments, `github-pages`:** allow deployments from `main` and from `v*` tags only.
5. **Review and approve** the site's dependency tree once `site/package-lock.json` exists, the font files and their license record, and the license-scan allowlist entries the new files need.
6. **Provide or approve** the icon and social image (decision 11).
7. **Run the workflow by hand** for the first publication. Then: open the home page, a module page, the search page and a guide; check the browser's network inspector shows only `engine.photivra.com`; read the response headers of a page and an asset (status, cache lifetime, encoding, HTTPS redirect); open `/sitemap.xml` and `/robots.txt`; do the manual accessibility pass on the live site.

After that a release needs nothing more for the site: the publish workflow's success deploys it. The repository's developer guide gains these steps in the pull request that builds the site.

## 17. Owner decisions

Each as it was proposed, with the recommendation; the site in `site/` is built to the recommendations. Decisions already made on 2026-11-19 and 2026-11-21 are not repeated.

1. **Accept this design as the site for 2.28.0.** Recommended.
2. **JavaScript: one self-hosted script, only on `/search/`, at most 2.5 kB compressed; none anywhere else** (no theme switch, no menu button, no copy buttons). Recommended. The alternative with no script at all leaves search to the browser's Find on the index page.
3. **Search design C:** one index page that the script filters, with the header field as a plain form to it; names and headings only, no full-text search. Recommended over a prebuilt index file fetched by a script on every page.
4. **Rendered examples are the engine's own PNG, lossless, at the size the code states, one file each, never resized or re-encoded, at most 400 kB and three per page.** Recommended. This reads "responsive images" as a fluid layout with set dimensions and lazy loading, without `srcset`. The alternative is to show the engine's JPEG at a stated quantization step (about 230 kB for the same picture at step 8) and link the PNG; smaller, but the picture on the page is then a lossy version.
5. **Live demos: not in 2.28.0;** a separate page with its own design later, if wanted. Recommended.
6. **Split the usage guide, the quick start and the display-view guide into one page per `##` section,** with a contents page each. Recommended; as single pages they are several times over the page budget.
7. **Publish six more guides** beside the three the ticket names: Agent guide, Color patches, Image-plane scene, Mixed lighting and flash, Light sources, Content Credentials. Recommended: `llms.txt` already presents them as starting points, each is one line in the page map, and without them links from the published guides to these documents leave the site.
8. **Typeface: Inter, self-hosted (two subset files), with the system monospace font for code.** Recommended, for one look across the two sites. It adds font files and a license record for the owner's review; recording it in `THIRD_PARTY.md` edits a file that is packed into the npm package, which the pull request must name. The alternative is the system font stack: no files, nothing to record, and a first view about 50 kB smaller.
9. **No syntax highlighting and no accent color in 2.28.0.** Recommended.
10. **Lighthouse in the workflow as one more site development dependency, with the sibling site's floors** (performance 95, accessibility 100, best practices 95, SEO 100). Recommended. The alternative is to run it by hand after each deployment.
11. **Icon and social image.** There is no logo in this repository. Recommended: a type-only social image (the name, the abstract and the package name) and, until a Photivra mark is provided, an icon that is the letter "P" in Inter Bold on the dark ground. The owner may instead supply the brand's mark for both.
12. **The publication guard** (14.3): a push to `main` deploys only when the changelog's newest section is marked published and matches `package.json`; the release deployment shows "Published" without a date until the record lands. Recommended.
13. **Run the Pages workflow on pull requests that change `src/**`,** so an engine change that breaks a rendered example fails before the release. Recommended; it adds a few minutes to those pull requests and is not a required check.
14. **Serve the repository's `llms.txt` unchanged at `/llms.txt`.** Recommended.
15. **`/.well-known/security.txt`:** not yet. `SECURITY.md` says private vulnerability reporting was not enabled as of October 11, 2026, and the file needs a working private contact. Recommended: add it in the release after that is enabled; until then the footer links to the security policy.
16. **Home page text is taken from the README's opening** by heading boundaries. Recommended. It means the README's first section must keep its lead sentence, capability list and principles paragraph when the README is shortened later.
17. **A footer link to `https://photivra.com`** (the address in `CITATION.cff`), as the sibling site has. Recommended; not drawn in the figures.
18. **Require the owner's approval on the `github-pages` environment for each deployment.** Not recommended: deployments already follow an owner-approved publish or a merge to `main`, and the guard covers the window between them.

## 18. Measurements and what is unverified

Measured on 2026-11-21 from `main` at 99782e7 (2.27.0), on an Apple silicon laptop with Node 26.13.1; rely on ratios and byte counts, not on absolute times.

| What | Result |
| --- | --- |
| Exports, modules, areas | 2,110 exports (722 runtime, 1,388 types) in 246 modules in 18 source directories (`docs/api/exports.json`) |
| Search rows for all exports, as HTML | 418 kB; 48 kB gzip; 35 kB Brotli |
| `docs/USAGE.md` | 394 kB, 108 `##` sections; largest section 11 kB gzip, median 1.3 kB |
| `docs/QUICK_START.md` | 215 kB, 23 sections; largest ("Optics") 18 kB gzip |
| `docs/DISPLAY_VIEW.md` | 181 kB, 19 sections; largest 22 kB gzip |
| API module pages | Largest (`facade-simulate-capture.md`) 71 kB, 23 kB gzip; median 4.7 kB, 1.7 kB gzip |
| Changelog sections | 66; largest (2.0.0) 66 kB, 26 kB gzip |
| The figures' own CSS | 2.6 kB gzip (hand-written; Tailwind's output with Preflight will be larger) |
| Layered-chart block of `docs/LAYERED_SCENES.md`, run unchanged, PNG | 600 × 400, 267 kB, 3.0 s |
| The same scene at 720 × 480 and 1440 × 960, PNG | 374 kB in 3.6 s; 1.37 MB in 13.4 s |
| `color-patches` and `siemens-star` presets at 720 × 480, PNG | 480 kB and 503 kB, 0.2 to 0.3 s each |
| The same scene as JPEG at 720 × 480, quantization steps 2, 4, 8, 16 | 522, 290, 232, 178 kB |
| Two runs of one capture | Identical bytes (SHA-256) |
| Contrast ratios of section 10 | Computed from the token values with the WCAG relative-luminance formula |
| Reflow | Each figure loaded at 320 px and 390 px wide with no sideways scrolling |

**Unverified,** to confirm when the site is built or first published; none is stated on the site as fact until then:

- Every budget in section 11. They are set from Markdown sizes and from the figures, not from built pages.
- Render times on the workflow's runner, and that an example's bytes are the same there as on another machine. The check requires two builds on the runner to agree; it does not require agreement across platforms.
- Which compression GitHub Pages applies, and its cache lifetime.
- Which of the content's less common characters (IPA, superscripts, Greek, arrows) Inter contains, and the subset files' real sizes.
- That every block chosen as an example runs unchanged when extracted; only the layered-chart block was run here.
- That a browser does not apply `script-src` to an `application/ld+json` data block. The page-load check shows it, since a policy violation fails the build.
- That `frame-ancestors`, reporting and `sandbox` are ignored in a meta Content-Security-Policy (recalled from the specification, not re-read).
- Lighthouse scores for these templates; the floors are the sibling site's, not measurements.
- The search script's size and its filter time on a low-end phone; the 2.5 kB budget and the 200 ms target are design limits, checked at build and by hand.
- Current versions and licenses of the tools; the build plan's table records what the registry declared on 2026-11-20, and each license is read when the lockfile is made.
- The Pages and DNS behavior described in section 16, which follows the build plan and the sibling site's design, not a fresh reading of GitHub's documentation.
