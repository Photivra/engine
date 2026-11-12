# 2.8.0 release candidate

> **Published October 25, 2026.** The owner tagged `v2.8.0` on `9089cab` (#413), the `main` commit after this record's `500a9ae` (#412), after `main` CI on that commit had passed, and published the GitHub release. npm publishing ran from the tag. The published package therefore also includes #413 (display view: a sample's terms written in place, about 7 % faster, the same values); its changelog lists #413 under "Unreleased", and the repository changelog now lists it under 2.8.0.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.8.0`, with `ENGINE_API_VERSION = "2.8.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:**
  - full-resolution captures of chart presets and caller material scenes take a new RAW path that gives the same bytes much faster, with a new assumption and a different evaluation count in their metadata;
  - display views whose display pixels cover at most 25 real pixels take the exact area mean, a deliberate change of their values.

  Root exports are unchanged (1,727 names).
- **Why now:** the Photivra app renders full-resolution exports (`simulateCapture` regions on every worker) and the sharp preview at device pixels (the display view). On 2.7.0 a 24 MP Speed JPEG export took 38.7 minutes on four browser workers (Photivra/apps#92). On this candidate the whole 24 MP frame takes 36.5 s as a JPEG on one Node thread.
- **Owner decisions (October 24–25, 2026):**
  - "Let's go ahead and do the improvements and measure at the very end", and "Go ahead" with the rounding-only RAW path (#394 step 2): rounding-only differences count as matching, so only the fast code stays.
  - "Run it now": the 155-case display-view validation before this request.
  - "Release 2.8.0, #379 later": the Quality noise model moves to 2.9.0 after its quick fix measured worse.
- **What this release does not claim:**
  - The timings are from the host named below, one run each; they are not a promise for every device.
  - The tabulated RAW path's electrons differ from the environment chain's in the last bits. A site could, rarely, draw a different integer; on every request tested none did, but this is not proven for every request.
  - The display view remains an estimate of the resized capture, labelled `kind: "display-view"`, with the known Quality noise limit ([Known limit](#known-limit-quality-noise-at-small-footprints-379)).

## Scope

| Change | Public surface | Kind |
| --- | --- | --- |
| Display view: exact area mean where a display pixel covers at most 25 real pixels (#408, issue #393) | `simulateDisplayView`, `prepareDisplayView` | Changed values for those views; others unchanged |
| Captures: engine-built tiles without a copy, key taps for chart and material scenes (#409, issue #394 step 1) | `simulateCapture`, `simulateIdealReference` | Performance; same values |
| Captures: tabulated expected electrons for chart and material scenes (#410, issue #394 step 2) | `simulateCapture` | Performance; same bytes on every request tested; new assumption, lower evaluation count |
| 2.8.0 display view validation record (#411) | — | Documentation |
| Version 2.8.0, changelog and this record; removal of two stray files from #406 (`fp-270.err`, `fp-270.txt`) | — | Release preparation |

Merge commits:
- #408 `122d476`
- #409 `ea9d86a`
- #410 `de77074`
- #411 `6630d95`

Open engine issues with no merged code are not part of this release: #379 (moved to 2.9.0), #388, #391, #392 items 2–3, and #395–#400.

## What changed, with evidence

Unless stated otherwise: one thread on a 4-vCPU Linux container (Intel Xeon 2.80 GHz), Node 24.21.0, built `dist`, one run each; a 24 MP full frame (6000 × 4000 at 6 µm), 50 mm at f/8, a 2 × 2 box pixel aperture, ISO 100.

### Captures: key taps and engine-built tiles (#409)

**What changed:**
- The native environment no longer `structuredClone`s the site records that `simulateCapture` builds for each tile.
- A verified lean template of a chart preset or caller material scene plans its taps as the key the engine-built evaluator would read (a material, or a convolved lattice site with diffraction) and takes each radiance from that key.

**Why the values cannot change:** the radiance of such an evaluator is a pure function of the key and the wavelength, and each template must reproduce its own site's evaluations bit for bit before its sites use keys. All hash locks and facade fingerprints were unchanged.

| 512 × 512 centre region | 2.7.0 | After #409 |
| --- | --- | --- |
| Siemens star, Speed | 31.7 s | 6.5 s |
| Siemens star, Quality options | 135.2 s | 37.5 s |
| As a caller material scene, Speed | 58.6 s | 7.1 s |
| As a caller material scene, Quality options | 252.9 s | 40.4 s |

### Captures: tabulated expected electrons (#410)

**What changed:** for a chart preset or caller material scene with a still, rectilinear, distortion-free camera, each native site's expected photo electrons come from the display view's tabulated expected signal, and the native sensor stage (dark charge, Poisson draws, read noise, ADC) runs with each site's own seeds.

**Verification at run time:** one site of each CFA phase runs the full chain. Its readout must be reproduced bit for bit and its electrons must agree within 1e-9 relative; otherwise the capture takes the environment path.

**Measured equality against the environment path:**

| Case | Native sites | Differing RAW codes | Differing samples |
| --- | --- | --- | --- |
| Dead leaves, Speed, 1024² region | 1,052,676 | 0 | 0 |
| Caller material scene, Speed, 1024² region | 1,052,676 | 0 | 0 |
| Siemens star, Quality options, 512² region | 272,484 | 0 | 0 |

The verification sites agreed within 2 × 10⁻¹⁵ relative.

| 512 × 512 centre region | After #409 | After #410 |
| --- | --- | --- |
| Siemens star, Speed | 6.5 s | 0.6 s |
| Siemens star, Quality options | 37.5 s | 2.8 s |
| As a caller material scene, Speed | 7.1 s | 0.7 s |
| As a caller material scene, Quality options | 40.4 s | 3.0 s |

Whole 24 MP frame, one thread: 28.2 s as sRGB (RAW 24.2 s, development 3.9 s), 36.5 s as a JPEG (encoding 11.2 s), 75.7 s as a Quality PNG.

### Display view: exact area mean (#408)

**What changed:** where a display pixel covers at most 25 real pixels (and at most K²), every real pixel it touches is evaluated once with its exact overlap weight, so the expected value has no sampling error. The limit of 25 is where the exact path stops being cheaper than the stratified estimator (measured on 8-row strips of a 24 MP view: within run-to-run spread up to 25 real pixels per display pixel, 1.5–2.4× slower at 144). Coarser views keep the stratified estimator and their bytes. The `view.estimation` assumption names the method.

**Measured:**
- On the app's 2028 × 1352 view's 8-row strips (2.96 × 2.96 real pixels per display pixel), Speed 0.97–1.04 s → 0.77–0.85 s against 2.7.0.
- A test checks that half- and 2/3-size views equal the overlap-weighted means of the frame-size view's per-pixel expected values within 1e-12 relative.

**Validation (October 25, [record](validation/display-view-2026-10-25/README.md)):**
- 145 of 155 cases are identical to the 2.6.0 record.
- The 10 cases on the exact path (the 12 MP phone at 800 pixels wide) are the same or better against every limit: the Siemens star's expected-value RMS fell from 1.78 to 1.35 codes and its SSIM rose from 0.9931 to 0.9966.
- The one known miss remains, case 138 (#379).

### Known limit: Quality noise at small footprints (#379)

Unchanged from 2.6.0. With `output.demosaic: "ahd"` the display view's noise has too much colour where a display pixel covers few sensor pixels; case 138 is 1.165 against the 1.15 limit. The exact covariance through AHD's two linear candidates was measured on October 25 and is worse (1.351), because AHD's direction choice reacts to the noise ([measurement](https://github.com/Photivra/engine/issues/379#issuecomment-6394140950)). The remaining fix, a Monte Carlo model of the real AHD output's noise covariance, moves to 2.9.0 by the owner's decision of October 25, 2026. Speed (bilinear) is exact; the Photivra site offers Speed only.

## Compatibility

- **Fingerprint against `v2.7.0`** (24 results, engine version normalized; bytes and metadata hashed separately):
  - **Bytes identical in all 24:** samples, RAW codes and encoded files of 18 `simulateCapture` requests (chart presets, spectral patches, a composite with a fixed-size chart, both caller function forms and a material scene, PNG 16-bit, JPEG, DNG, auto and Kelvin white balance, rolling shutter, a region, diffraction, the Quality options, vignetting and camera rotation), 3 `simulateIdealReference` and 3 `simulateDisplayView` results.
  - **Metadata identical in 23** apart from the two documented changes below. The exception is the display view at 2 × 2 real pixels per display pixel, whose `view.estimation` assumption and sample diagnostics change with the exact area mean (its bytes happen to be the same).
- **Documented metadata changes for captures on the tabulated path:**
  - a `raw.expectedSignal` assumption names the method, the verification and its tolerance;
  - `diagnostics.providerEvaluationCount` counts the verification sites' evaluator calls and the table's scene lookups (for example 9,360 → 552 for a 24 × 16 slanted edge).

  Captures that do not qualify (caller reflectance or radiance functions, vignetting, rotation, projection or distortion, pupil sampling, caller PSFs) are unchanged, metadata included.
- **Auto white balance** keeps the tabulated RAW instead of rendering it again; its codes do not depend on the intent, and the 2.0.0 hash lock's auto-white-balance JPEG keeps its bytes.
- **Display view values change** for views whose display pixels cover at most 25 real pixels. Coarser views keep their bytes.
- **Hash locks:** the 2.0.0 lock's byte digests are unchanged; its assumption and diagnostics digests were re-recorded for the two documented changes (#410). Two of the six display-view locks and both memo locks were re-recorded for the exact area mean (#408).
- **Root exports:** 1,727, none added or removed. `diagnostics.providerEvaluationCount` keeps its type.
- **Internal modules:** `src/facade/expected-signal.ts`, `src/facade/expected-signal-setup.ts` and `src/capture/native-environment-tabulated.ts` are new; `admitNativeEnvironmentInput` became an internal export. Deep imports are not a supported surface. Capture-only bundles still leave out the display view (issue #380 test).

## Rights and licensing

No third-party code, data, constants or dependencies are added. The changes reuse the engine's own models (the display view's expected signal, the native sensor stage) in other places and cache values the engine already computes. `package-lock.json` changes only the version fields.

## Privacy and security

No network, persistence or telemetry is added. The new state is per call and holds only numbers computed from the request: the key-tap radiance tables (per template, per material and spectral node), the tabulated signal's cache windows (at most 2²² entries) and the RAW arrays the environment task already allocated. A caller material scene's `materialAt` is still validated on every call; where it throws during key planning, the full path throws the same error.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green. Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] The 2.8.0 changes merged with their changelog entries (#408, #409, #410, #411).
- [x] Version surfaces aligned at 2.8.0 (`npm run release:prepare -- 2.8.0`). Root exports unchanged at 1,727.
- [x] Fingerprint against `v2.7.0`: bytes identical in all 24 results; metadata as documented above.
- [x] The 155-case display-view validation on `de77074` (#411).
- [x] Owner's review of this record.
- [x] Green CI on this pull request (#412), then on `main` after merge. The tagged commit is `9089cab` (#413, merged after this record): `main` CI run 965 on it passed before the tag.
- [x] **The owner's explicit approval to tag `v2.8.0`.** The owner tagged it and published the release.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.8.0` → `9089cab5cb2e9205ef3bc3dea55e5113e2b6a7bb` (#413), after `main` CI on that commit passed ([CI run 965](https://github.com/Photivra/engine/actions/runs/40171081256)) |
| GitHub release | [@photivra/engine 2.8.0](https://github.com/Photivra/engine/releases/tag/v2.8.0), published 11:57:52 UTC |
| Publish workflow | [Publish npm run 25](https://github.com/Photivra/engine/actions/runs/40191055098): its verify and publish jobs passed (completed 12:13:18 UTC) |
| npm | `@photivra/engine@2.8.0`, dist-tag `latest`, registry time 12:14:54 UTC |
| Integrity | `sha512-7+Wqp1pBv5NMkSaS27x15phE9LcOGY57EcYywtlxxf+XHlwBTlR9mJVLVTigfTxQ5cJYZ39yaW8be4oZeckVXw==` (shasum `b81bdd56620d2194dea4fc5429c03c26019370b0`, 855 files), the same as the publish log |
| Provenance | Signed provenance statement from GitHub Actions for the tag, published to the Sigstore transparency log ([log index 3460764630](https://search.sigstore.dev/?logIndex=3460764630)); the registry lists an attestation for 2.8.0 |
