# 2.14.1 release

> **Published November 3, 2026.** The `v2.14.1` tag is on `4044ee4` (#546), after `main` CI on that commit had passed; npm publishing ran from the tag ([Publication](#publication)).

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
- [x] Green CI on this pull request, then on `main` after merge ([CI run 41680898274](https://github.com/Photivra/engine/actions/runs/41680898274) on `4044ee4`: `main smoke` passed).
- [x] The owner's approval to tag `v2.14.1`: the tag push that ran the publish workflow is the owner's (`bshack`); no separate written approval is recorded in the repository.
- [x] The `v2.14.1` tag on the `main` commit that merges this record (`4044ee4`).
- [x] After publication: npm version, dist-tag, integrity and provenance verified ([Publication](#publication)); GitHub release notes published (`@photivra/engine 2.14.1`, November 3, 2026, 17:49:32 UTC); publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record (#400's docs pull request).

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.14.1` → `4044ee41cf462a37b3a7639fa52f832844fac56c` (#546), after `main` CI on that commit passed ([CI run 41680898274](https://github.com/Photivra/engine/actions/runs/41680898274)) |
| Publish workflow | [Publish npm run 34](https://github.com/Photivra/engine/actions/runs/41684374081): coverage shards 5.5–14.6 min and gate 1.1 min passed, `verify` passed 17:27:14–17:29:57 UTC, `publish` passed 17:43:04–17:43:32 UTC |
| npm | `@photivra/engine@2.14.1`, dist-tag `latest`, registry time 17:45:36 UTC |
| Integrity | `sha512-DUFJJArUnOwVH/rMR7aGGOYLzbRMr9ErkgUhNT9T+YdkL6CGnF1T6uCkgGTtwYMCkw4csWaMf3ZEnVGs3PV/ww==` (shasum `10b34ace3ed8c8a14a84316f1178efcb0f11ee60`, 912 files), the same as a local `npm pack` of `4044ee4` (Node 24.19.0, November 6, 2026) |
| Provenance | The registry lists an SLSA v1 provenance attestation for 2.14.1 |
