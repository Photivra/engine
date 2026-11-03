# 2.14.1 release candidate

> **Prepared November 3, 2026; not published.** Publishing runs only from the `v2.14.1` tag, after `main` CI on the tagged commit has passed, and only with the owner's explicit approval to tag (AGENTS.md rule 3; see [Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.14.1`, with `ENGINE_API_VERSION = "2.14.1"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a patch version:** docs and legal files only. The published `NOTICE` and `README.md` name Shackelford Creative, LLC as the copyright holder and the owner of the Photivra trademark, and `THIRD_PARTY.md` carries the licence audit's fixes. There is no API, behavior or value change.

## Scope

Every pull request merged since `v2.14.0` (`f4b09a7`), and this record:

| Change | Pull request |
| --- | --- |
| Docs: licence audit fixes (`THIRD_PARTY.md`, color patch sources, reviews), copyright holder Shackelford Creative, LLC | #543 |
| README: Shackelford Creative, LLC as owner of the Photivra trademark | #545 |
| 2.14.1 release preparation: version, changelog, this record, and the 2.14.0 publication record | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.14.1.

## Same package

The candidate's packed tarball (`npm pack`, 912 files, the same file list) was compared file by file with the published `@photivra/engine@2.14.0` tarball. Only these files differ:

| Files | Difference |
| --- | --- |
| `NOTICE`, `README.md`, `THIRD_PARTY.md` | the legal and docs changes of #543 and #545 |
| `CHANGELOG.md`, `SECURITY.md`, `CITATION.cff` | the 2.14.1 entry, the current release and the version |
| `package.json`, `dist/core/version.*`, `docs/API_REFERENCE.md`, `docs/api/core-version.md`, `docs/api/exports.json` | the version `2.14.0` → `2.14.1` only |
| `dist/output/print-contrast-reference.js` and its source map | the header comment only: the castleCSF MIT terms are "retained in NOTICE (the full licence text)" |

`git diff v2.14.0 -- src` is the version constant and that comment. Root exports are unchanged (1,801). `git diff v2.14.0 -- src/gpu` is empty, so no hardware gate applies.

## Release gates

1. **GitHub CI** on the exact commit that is tagged (the `main` commit that merges this record). Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.14.1` (AGENTS.md rule 3).

## Remaining release checklist

- [x] #543 and #545 merged.
- [x] Version surfaces aligned at 2.14.1 (`npm run release:prepare -- 2.14.1`). Root exports 1,801.
- [x] Packed tarball compared with the published 2.14.0 (above).
- [x] 2.14.0 recorded as published (`CHANGELOG.md`, `SECURITY.md`, [its record](RELEASE_2_14_0.md)).
- [ ] Green CI on this pull request, then on `main` after merge.
- [ ] The owner's approval to tag `v2.14.1`.
- [ ] The `v2.14.1` tag on the `main` commit that merges this record.
- [ ] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.
