# 2.4.1 release candidate

> **Published October 18, 2026.** The owner tagged `v2.4.1` on `c729958` and published the GitHub release; npm publishing ran from the tag. See [Publication](#publication). `v2.4.0` stays tagged and released on GitHub but was never published to npm. The record below is kept as the release request it was.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.4.1`, with `ENGINE_API_VERSION = "2.4.1"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a patch version:** 2.4.1 carries the 2.4.0 contents unchanged. 2.4.0 was tagged and released on GitHub but never reached npm. The Publish npm workflow only publishes a tag that points at current `main`, and `main` now includes #346, so the `v2.4.0` tag can no longer pass; moving a published tag would rewrite a release. The same contents therefore ship under the next patch number. No root export is added or removed (1,714 symbols), and no input that 2.4.0 accepted is rejected.
- **Why now:** applications are waiting for the 2.4.0 text metadata on npm. The owner chose this path on October 18, 2026, after the Publish npm workflow for `v2.4.0` timed out twice: raise the workflow's time limit (#346), then prepare 2.4.1 with the same contents for the owner to tag.
- **What this release does not claim:** anything beyond the [2.4.0 release request](RELEASE_2_4_0.md). The engine writes the caller's text as given; it does not check that a description is true or that a rights statement is valid.

## Scope

| Change | Public surface | Kind |
| --- | --- | --- |
| The 2.4.0 contents: caller text metadata in JPEG, PNG and DNG files (`output.metadata`, `serializeNativeRawDng` `textMetadata`, `OutputTextMetadata`), merged in #344 and prepared in #345 | As in [2.4.0](RELEASE_2_4_0.md) | Unchanged from 2.4.0 |
| Publish npm verify job limit raised from 10 to 25 minutes (#346) | None (repository workflow) | Release tooling fix |
| Version 2.4.1, changelog and this record | — | Release preparation |

The feature, its specifications and its tests are described in the [2.4.0 release request](RELEASE_2_4_0.md); none of it changes here.

## Why 2.4.0 never reached npm

The owner tagged `v2.4.0` on `d5221f7` and published the GitHub release. [Publish npm run 39124378595](https://github.com/Photivra/engine/actions/runs/39124378595) was cancelled on attempt 1 and on the owner's re-run (attempt 2): in both, the `verify` job reached `timeout-minutes: 10` during the coverage gate, so the `publish` job was skipped and nothing was uploaded. npm still serves 2.3.0 as `latest`.

| Publish npm run | Release | Coverage gate | Whole verify job | Result |
| --- | --- | --- | --- | --- |
| [39087857249](https://github.com/Photivra/engine/actions/runs/39087857249) | 2.2.1 | 8m09s | 9m20s | passed |
| [39093409802](https://github.com/Photivra/engine/actions/runs/39093409802) | 2.3.0 | 8m18s | 9m33s | passed |
| [39124378595](https://github.com/Photivra/engine/actions/runs/39124378595), attempt 1 | 2.4.0 | still running at 9m38s | cancelled at 10m16s | timed out |
| [39124378595](https://github.com/Photivra/engine/actions/runs/39124378595), attempt 2 | 2.4.0 | still running at 9m41s | cancelled at 10m16s | timed out |

The same coverage gate took 11m36s in CI on `d5221f7` ([CI run 39102186373](https://github.com/Photivra/engine/actions/runs/39102186373), `verify (lts/*)`), so the job needed about 13 minutes. #346 raised the limit to 25 minutes and changed nothing else in the release workflow: admission (protected refs, tag equal to the package version and to current `main`), static gates, coverage, build, documentation, packed-consumer acceptance, package dry run, tarball hashing and the publish job are as before.

`v2.4.0` stays a tag and a GitHub release that never reached npm. It is not moved or deleted.

## Evidence that the contents are unchanged

- **Source.** `git diff v2.4.0` on this candidate changes, under `src/`, only `ENGINE_API_VERSION` in `src/core/version.ts`. Outside `src/`: the version fields of `package.json` and `package-lock.json`, `CITATION.cff`, the version and release-record mentions in `README.md` and `docs/DEVELOPERS.md`, the regenerated `docs/api` version lines, `CHANGELOG.md`, this record, and the publish workflow change from #346.
- **Build.** `npm run build` on this candidate and on `v2.4.0` gives identical `dist/` trees apart from `dist/core/version.js`, its `.d.ts` and its source map, which differ only in the version string.
- **Results.** A fingerprint of 15 default-path results matched `v2.4.0` and `v2.3.0` byte for byte once the engine version is normalized: 12 `simulateCapture` requests (JPEG with fixed and automatic white balance, 8-bit and Display P3 16-bit PNG, `srgb-8`, `srgb-16` with mirror borders, a dated DNG, a DNG with AHD, caller patches, a fixed-size composite with zone-plate and ellipse-masked dead-leaves elements, diffraction with the box aperture, and a dead-leaves region) and 3 `simulateIdealReference` requests (PNG, fixed-size composite, `srgb-16`). Each covers the whole result: samples, RAW codes, encoded bytes, assumptions, plan, request, exposure, scene digest, diagnostics (timings zeroed) and provenance. The engine version appeared 41 times in each run and was the only difference.
- **Hash locks.** Every existing lock passes unchanged, including the 2.0.0 lock in `test/simulate-capture-optics.test.ts`, the `simulate-capture-integration` locks and the 2.3.0 file locks in `test/output-text-metadata.test.ts`. The two locks that cover a DNG write the Software tag's engine version ("Photivra 2.4.1", same length) back to their locked name before hashing, as #345 set up, so the version bump needs no test change.
- **Root exports.** The regenerated `docs/api/exports.json` lists the same 1,714 root symbols as `v2.4.0`.

## Compatibility

- **Unchanged:** every public API, schema, input and output of 2.4.0. Captures record engine version 2.4.1 instead of 2.4.0.
- **For callers on 2.3.0:** the same as upgrading to 2.4.0. Without `output.metadata` every output is byte-identical to 2.3.0 apart from the recorded engine version.

## Rights and licensing

No third-party code, data or constants added. No dependency change: `package.json` and `package-lock.json` change only in their version fields. The 2.4.0 rights review applies unchanged.

## Privacy and security

No change from 2.4.0: no network, persistence or telemetry. The workflow change only lengthens a job time limit; it grants no new permission and adds no step.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green. Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] Publish workflow time limit raised (#346).
- [x] Version surfaces aligned at 2.4.1 (`npm run release:prepare -- 2.4.1`); API reference regenerated (1,714 root symbols; none added or removed).
- [x] Owner's review of this record.
- [x] Green CI on this pull request (#347), then on `main` after merge ([CI run 875](https://github.com/Photivra/engine/actions/runs/39130356165) on `c729958`).
- [x] **The owner's explicit approval to tag `v2.4.1`.** The owner tagged `v2.4.1` on `c729958`; `v2.4.0` is unchanged (tagged and released on GitHub, never published to npm).
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record. The owner chose not to edit the `v2.4.0` GitHub release note; the `CHANGELOG.md` entry for 2.4.0 points to 2.4.1.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.4.1` → `c72995883872b9c7cd5784a3f1a681a9581c50cd` (#347) |
| Publish workflow | [Publish npm run 21](https://github.com/Photivra/engine/actions/runs/39132344634), passed (completed 13:47:13 UTC); the provenance was signed at 13:47 UTC and the registry records publication at 13:48 UTC |
| npm | `@photivra/engine@2.4.1`, dist-tag `latest`; 2.4.0 is not on npm |
| Integrity | `sha512-kcp/3z/UdKq8WkybrVkmSdBYQc2wqKz+qOgPE/XuKuNyHOb51paQhmPsQmgx8d9t6kBrVyUdMCx2AoKpQgOLUA==` (shasum `61537bd4a9d07d6248f05b6d6e42614dcd3f554a`) |
| Provenance | Signed SLSA provenance for `c729958` from `.github/workflows/publish.yml` at `refs/tags/v2.4.1` (Publish npm run 21), published to the Sigstore transparency log (log index 3312050251); `npm audit signatures` verifies the registry signature and the attestation |
| Tarball contents | Byte-identical (same shasum and integrity, 836 files) to `npm pack` of a clean local build of `v2.4.1` (checked October 18, 2026) |
| GitHub release | [@photivra/engine 2.4.1](https://github.com/Photivra/engine/releases/tag/v2.4.1) |
