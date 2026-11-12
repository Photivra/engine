# 2.11.1 release

> **Published October 31, 2026.** The owner approved the `v2.11.1` tag on `c90bea0` (#512) after `main` CI on that commit had passed; npm publishing ran from the tag ([Publication](#publication)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.11.1`, with `ENGINE_API_VERSION = "2.11.1"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why:** `@photivra/engine@2.11.0` never reached npm. The owner tagged `v2.11.0` on `6bef763` and published its GitHub release on October 28, 2026, but the npm publish run was cancelled before it published (below). npm `latest` is still 2.10.0. A tag runs the publish workflow of its own commit, so `v2.11.0` cannot publish with a fixed workflow; 2.11.1 does.
- **Why a patch version:** no API, behaviour or value change from 2.11.0. Against 2.10.0, it is 2.11.0's minor release: see the [2.11.0 release record](RELEASE_2_11_0.md) for its features, evidence, compatibility and known issues, which all apply unchanged.
- **Same package:** `src/` differs from `v2.11.0` only in `ENGINE_API_VERSION`, and the packed package has the same 904 files, differing only in version fields and release documentation ([Same package](#same-package)).

## Scope

Every pull request merged since `v2.11.0` (`git log v2.11.0..origin/main`), and this record:

| Change | Pull request |
| --- | --- |
| CI: test each tree once, balanced shards, parallel Node parts, docs-only scope; the `node` leg tests the newest stable release; publish runs coverage in four shards (#510, #508) | #511 |
| 2.11.1 release preparation: version, changelog and this record | this pull request |

## What changed, with evidence

### Why 2.11.0 did not publish

[Publish npm run 40636849817](https://github.com/Photivra/engine/actions/runs/40636849817) for `v2.11.0` passed the protected-ref, tag-equals-`main`, support-policy, install and static steps (15:03:29–15:04:36 UTC), then ran the single-job coverage gate (`npm run coverage`, the whole suite under V8 coverage on one 4-core runner) from 15:04:36 until the verify job's 25-minute limit cancelled it at 15:28:43 UTC. The `publish` job was skipped, so nothing was uploaded to npm. The suite had outgrown one job: on the pull-request CI of #509 (run 40632923165), the same coverage split into four shards took 437, 798, 480 and 523 s, 37 minutes of shard time in all. Earlier releases' single-job gate took 8–12 minutes (2.2.1 to 2.4.0, recorded in the workflow).

### The publish workflow (#511)

- `verify` keeps the ref checks, static gates, build, documentation and packed-consumer acceptance, package dry run and release tarball, with a 15-minute limit.
- Coverage runs as four `coverage shard (k/4)` jobs in parallel with `verify`, on the same Node.js line as before (24), split by measured per-file time (`test/helpers/weighted-shard-sequencer.ts`).
- `coverage gate` merges the four blob reports and enforces the thresholds of `vitest.config.ts` on the whole suite, as `ci.yml`'s required `verify (lts/*)` does; a failed or missing shard fails it.
- `publish` needs both `verify` and `coverage gate`, so the package is published only from a tree that passed every gate, as before.
- A shard skips its work only when `ci.yml` passed the whole suite under coverage on this exact tree and Node.js release (`.github/ci-proof.mjs`); otherwise it runs.

**Measured on #511's pull-request CI** ([run 41204851499](https://github.com/Photivra/engine/actions/runs/41204851499), the same split on `lts/*`, which setup-node resolved to Node 24.22.1; corrected from "26.13.0" in the prepared record): the four coverage shards took 12.9, 10.0, 9.2 and 7.3 minutes, and the merged gate 2.1 minutes. Each shard's time is its slowest single file (713, 544, 491 and 389 s), which a split by files cannot shorten. **The publish run** ([Publish npm run 30](https://github.com/Photivra/engine/actions/runs/41208610115)) ran coverage on Node 24.22.1, the same release as CI's `lts/*`, so each shard found ci.yml's coverage proof for the tagged tree (`aef5199…`, from #512's CI run 41206921252) and skipped its tests (6–9 s per shard; the gate 6 s). `verify` took 2 min 42 s and `publish` 14 s: 3 min 2 s from tag to published, against 2.11.0's cancelled 25-minute verify job. The sharded coverage path has not yet run in full inside the publish workflow; a release whose tree has no proof runs it.

### Same package

Packed with `npm pack --ignore-scripts` from a clean build of `v2.11.0` (`6bef763`) and of this candidate, Node 24.19.0, then compared file by file:

- Both packages have 904 files, with the same paths.
- Files that differ: `package.json` (`version`), `dist/core/version.js`, `version.d.ts` and `version.js.map` (`ENGINE_API_VERSION`), `docs/API_REFERENCE.md`, `docs/api/core-version.md` and `docs/api/exports.json` (the generated version), and `README.md`, `CHANGELOG.md` and `CITATION.cff` (release text and version).
- Every other file, every other compiled module included, is byte-identical.

Results are therefore 2.11.0's: the only value that changes is the engine version recorded in results and in the DNG Software tag.

## Compatibility

- Root exports are unchanged from 2.11.0 (1,765).
- No option, default, schema or result field changes from 2.11.0. Against 2.10.0, see [2.11.0, Compatibility](RELEASE_2_11_0.md#compatibility).

## Rights and licensing

No third-party code, data, constants or dependencies are added.

## Privacy and security

No network, persistence or telemetry is added to the package. The publish workflow gains read access to Actions artifacts (`actions: read`) to look up the coverage proof; publishing still uses npm trusted publishing with provenance from the tag.

## Release gates

1. **GitHub CI** on the exact commit that is tagged (the `main` commit that merges this record). Tag it only when its CI is green.
2. **Hardware acceptance:** the owner's Apple M5 Pro runs of `npm run accept:gpu:hardware` and `npm run test:webgpu:hardware` passed on `main` at `78f2731` for 2.11.0 (26 of 26 cases, 167 of 167 tests; [hardware record](WEBGPU_DEVICES.md)). `src/` at this candidate differs from `78f2731` only in `ENGINE_API_VERSION` (#509 and #511 change documentation, tests and CI), so that run covers this engine; re-running it is the owner's choice.

## Remaining release checklist

- [x] #511 merged with the fixed publish workflow (`2865835`).
- [x] Version surfaces aligned at 2.11.1 (`npm run release:prepare -- 2.11.1`). Root exports unchanged at 1,765.
- [x] Same package as `v2.11.0` apart from version fields and release documentation (above).
- [x] Owner's review of this record.
- [x] Green CI on #512, then on `main` after merge ([CI run](https://github.com/Photivra/engine/actions/runs/41208472234) on `c90bea0`: `main smoke` passed on the PR's coverage proof).
- [x] **The owner's explicit approval to tag `v2.11.1`** on `c90bea0`.
- [x] After publication: the publish run's job times recorded above; npm version, dist-tag, integrity and provenance verified ([Publication](#publication)); publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.
- [ ] GitHub release notes for `v2.11.1` (the owner's step).

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.11.1` → `c90bea0464327e5c1f515f57e8da5558794be103` (#512), after `main` CI on that commit passed ([CI run 41208472234](https://github.com/Photivra/engine/actions/runs/41208472234)) |
| Publish workflow | [Publish npm run 30](https://github.com/Photivra/engine/actions/runs/41208610115): coverage shards and gate passed on the coverage proof, `verify` passed 14:06:51–14:09:33 UTC, `publish` passed 14:09:36–14:09:50 UTC |
| npm | `@photivra/engine@2.11.1`, dist-tag `latest`, registry time 14:13:58 UTC |
| Integrity | `sha512-GGnpv2zjGFpBzcsIYviCQ5tnIMU5zhoqyI4ZPtJ+eu+rOcUOLluYyTa8GwFrAtbGMGJDN0KT6Pr61qExLFLcnw==` (shasum `8fae8e624793a183e10df90b98cf21393885171b`, 904 files), the same as the publish log and as a local pack of `c90bea0` |
| Provenance | Signed provenance statement from GitHub Actions for the tag, published to the Sigstore transparency log ([log index 3614254685](https://search.sigstore.dev/?logIndex=3614254685)); the registry lists an attestation for 2.11.1 |
