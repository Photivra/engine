# 2.8.1 release candidate

> **Published October 25, 2026.** The owner tagged `v2.8.1` on `93b5ca1` (#421) after `main` CI on that commit had passed, and published the GitHub release. npm publishing ran from the tag.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.8.1`, with `ENGINE_API_VERSION = "2.8.1"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a patch version:** no API, behaviour or value changes. It fixes a 2.8.0 slowdown before a chart or material capture's first RAW tile, and it writes JPEGs faster.
- **Same results:** all 24 fingerprinted results equal 2.8.0's, with only the engine version normalized. That covers the bytes, metadata, assumptions and provider evaluation counts.

## Scope

| Change | Pull request |
| --- | --- |
| Captures: the tabulated path's verification on a 2 × 2 diffraction window; channel responses and site kernels kept | #415 |
| JPEG writing: direct 1:1 Print JPEG path; the eight DCT sums of a column in one pass | #416 |

Out of scope: the Quality display-view noise limit (#379, for 2.9.0) is unchanged from 2.8.0.

## What changed, with evidence

### Captures: a short start again (#415)

**Cause:** in 2.8.0, the tabulated path's four verification sites ran the full chain through a diffraction convolution windowed to the whole render. Its first band therefore convolved the full width before any RAW tile. A Quality preview of the 5.6 mm phone sensor at 768 pixels and f/32 took 24 s to reach that tile, against 0.55 s on 2.7.0.

**Change:**
- The verification uses a convolution windowed to its own 2 × 2 block, which gives bit-identical values under the window contract of 2.6.
- The whole-render convolution is built only when the environment path runs.
- The per-channel spectral responses are planned once per channel and kept across calls.
- Each wavelength's site diffraction kernel is resolved once per PSF record.

**Measured** in Node, one thread, using the app's requests tiled as the app renders them:

| Request | 2.7.0 | 2.8.0 | 2.8.1 |
| --- | --- | --- | --- |
| 48-pixel quick frame, Speed / Quality | 1.3 / 8.3 s | 0.87 / 5.5 s | 0.70 / 4.6 s |
| 384-pixel capture, Speed / Quality | 43.9 / 193 s | 3.0 / 9.3 s | 1.1 / 2.4 s |
| 768-pixel capture, Speed / Quality | 185 / 796 s | 11.5 / 23.4 s | 3.3 / 5.6 s |
| 384-pixel Quality capture, 5.6 mm phone sensor, f/32 | 267 s | 25.4 s | 3.9 s |

**Values:** a new test checks that a capture with warm caches, made after another request, equals the same capture from a fresh module. All hash locks pass.

### JPEG writing about 3× faster (#416)

**Change:**
- At 1:1, each Print JPEG output pixel is one source pixel with weight exactly 1, so its sample comes from a 256-entry table.
- The encoder sums the eight DCT coefficients of a column in one pass, with the same products in the same order.

**Measured:** a 24 MP JPEG is written in 5.0 s instead of 15.2 s (Node, one thread). The files' SHA-256 is identical to 2.8.0's for five test images of 9 × 7 to 6000 × 4000 pixels, and all JPEG hash locks pass.

## Compatibility

- Root exports are unchanged (1,727).
- No option, default, schema or result field changes.

## Rights and licensing

No third-party code, data, constants or dependencies are added.

## Privacy and security

No network, persistence or telemetry is added. The new caches hold only numbers computed from requests:
- channel responses, at most 8 entries;
- diffraction kernels, held while their PSF record lives;
- the verification's small convolution window.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green. Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] The 2.8.1 changes merged with their changelog entries (#415, #416).
- [x] Version surfaces aligned at 2.8.1 (`npm run release:prepare -- 2.8.1`). Root exports unchanged at 1,727.
- [x] Fingerprint against `v2.8.0`: all 24 results identical, with only the engine version normalized.
- [x] Owner's review of this record.
- [x] Green CI on this pull request (#421), then on `main` after merge (CI run 973 and native performance on `93b5ca1` passed before the tag).
- [x] **The owner's explicit approval to tag `v2.8.1`.** The owner tagged it and published the release.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.8.1` → `93b5ca1223b4e9c3df7ac6a38c3dd2b03c5a711e` (#421), after `main` CI on that commit passed ([CI run 973](https://github.com/Photivra/engine/actions/runs/40209424181)) |
| GitHub release | [@photivra/engine 2.8.1](https://github.com/Photivra/engine/releases/tag/v2.8.1), published 16:22:17 UTC |
| Publish workflow | [Publish npm run 26](https://github.com/Photivra/engine/actions/runs/40211350182): its verify and publish jobs passed (completed 16:29:31 UTC) |
| npm | `@photivra/engine@2.8.1`, dist-tag `latest`, registry time 16:31:36 UTC |
| Integrity | `sha512-m5Kw8Y49sDRW45nfycfQjV/qOxIhEByt8sZZFv1Ql+WtgfnvDniWQ8wcoGfVqGnd6le4DvLsbUMeRgg46AKilA==` (shasum `3548f01418079a9f7fea67b4701efe8dfe72faf3`, 858 files), the same as the publish log and as a local pack of `93b5ca1` |
| Provenance | Signed provenance statement from GitHub Actions for the tag, published to the Sigstore transparency log ([log index 3463185553](https://search.sigstore.dev/?logIndex=3463185553)); the registry lists an attestation for 2.8.1 |
