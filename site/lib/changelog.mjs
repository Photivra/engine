// SPDX-License-Identifier: Apache-2.0
// Splits CHANGELOG.md at its `##` headings (build plan in #669, "Release notes"; docs/design/engine-site.md, section 4).
//
// - A section whose heading starts with a semantic version is a release: `2.26.0 — published November 16, 2026`,
//   `2.11.0 — tagged October 28, 2026; not published to npm (see 2.11.1)` or `0.2.0 - 2026-09-21`.
// - Sections before the first release (work in progress, such as "Unreleased") are not published: the site shows released
//   versions only.
// - Sections after a release that are not releases (the engine API history before 1.0.0) are kept together on one page.
// - Any other heading form fails the build.

const VERSION = /^(\d+\.\d+\.\d+)(?:\s+[—-]\s+(.+))?$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** @param {object} document CHANGELOG.md, loaded with loadDocument (site/lib/markdown.mjs). */
export function splitChangelog(document) {
  const releases = [];
  const history = [];
  const unreleased = [];
  for (const section of document.sections) {
    const match = section.title.match(VERSION);
    if (match) {
      const status = match[2] ?? "";
      releases.push({
        version: match[1],
        id: section.id,
        heading: section.title,
        status,
        date: ISO_DATE.test(status) ? status : undefined,
        published: /^published\b/iu.test(status),
        tagged: /^(?:published|tagged)\b/iu.test(status),
        section
      });
    } else if (releases.length === 0) {
      unreleased.push(section);
    } else if (/(?:engine API \d+\.\d+\.\d+|unreleased)$/iu.test(section.title) || /^Unreleased$/u.test(section.title)) {
      history.push(section);
    } else {
      throw new Error(`CHANGELOG.md: the heading "## ${section.title}" is neither a version nor an engine API history entry`);
    }
  }
  const seen = new Set();
  for (const release of releases) {
    if (seen.has(release.version)) throw new Error(`CHANGELOG.md: version ${release.version} appears twice`);
    seen.add(release.version);
  }
  return { releases, history, unreleased };
}

/**
 * The publication guard (docs/design/engine-site.md, 14.3): a push to main or a manual run deploys only when the
 * changelog's newest section is package.json's version and its status begins with "published".
 * @returns {{ deploy: boolean, reason: string }}
 */
export function publicationGuard(document, version) {
  const newest = document.sections[0];
  if (!newest) return { deploy: false, reason: "CHANGELOG.md has no sections" };
  const match = newest.title.match(VERSION);
  if (!match) return { deploy: false, reason: `the newest changelog section, "${newest.title}", is not a released version` };
  if (match[1] !== version) return { deploy: false, reason: `the newest changelog section is ${match[1]} but package.json is ${version}` };
  if (!/^published\b/iu.test(match[2] ?? "")) return { deploy: false, reason: `${version} is not marked published in the changelog ("${newest.title}")` };
  return { deploy: true, reason: `${version} is published (changelog: "${newest.title}")` };
}

/** The status line of a release page: the changelog's own words with a capital letter, or the date of a dated heading. */
export function statusLine(release, publishedVersion, longDate) {
  if (release.version === publishedVersion && !release.published) return "Published";
  if (release.date) return longDate(release.date);
  if (!release.status) return "";
  return release.status[0].toUpperCase() + release.status.slice(1);
}
