# 2.21.0 release

> **Prepared November 10, 2026; not published.** npm publishing runs only from the owner's `v2.21.0` tag ([Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.21.0`, with `ENGINE_API_VERSION = "2.21.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **One release for two waves:** the owner chose on November 10, 2026 to ship the 2.21.0 parts and the 2.22.0 parts together as 2.21.0. #590 (sample counts by format, whose first case is the spiky-light 5 nm step) and #591 (the channel-response helper) move to the next release.
- **Why a minor version:**
  - 41 new root exports (1,890 → 1,931; runtime exports 637 → 654).
  - New options: `sensor.profile` (#554), the `image-plane` scene (#581), `motion.subject` (#551), `illumination` (#550), `fit: { kind: "contain" }` (#365), `channelDispersion` on `createGenericLensCorrectionProfile` (#589) and `calculateLateralColorFringe` (#580). New functions: `simulateExposureBuildUp` (#534), `calculateChannelEffectiveDispersion` (#589), `calculateLateralColorFringe` (#580), the representative light sources (#557), `resolveSensorProfile` and `prepareImagePlaneScenes`.
  - Some rendered results change as model corrections or design choices, listed with their way back in [Default changes](#default-changes). Nothing is removed. One type widens: `PrintPlanInput.fit` is the union `PrintFit` (#365).

## Scope

This pull request integrates nine part branches, merged `--no-ff` in this order after `release-2.20.0` (merged first only to join the squashed 2.20.0 history to the parts' history; its tree equals `main`'s):

| Change | Issue | Part branch |
| --- | --- | --- |
| Chart scenes: each site's signal integrated from the material spectrum, on every render path | design choice (owner, 2026-11-09) | `e221-chart-signals` (`5adf10f`) |
| Catalogue lenses read PSF quadrature taps at lattice points; per-tap points as the fast method under rolling-shutter rotation | #588 | `e221-588` (`c198dc0`) |
| Catalogue lateral color measured in RAW; centroid-aligned PSF kernels; each channel's effective dispersion | #589 | `e221-589` (`9b6395e`) |
| Sensor profile catalogue, phone lenses, catalogue lenses framed on the profile's sensor | #554 | `e221-554` (`4bc2ca3`) |
| Image-plane scene: a photo as a flat print | #581 | `e221-581` (`0b595d2`) |
| Exposure build-up, with subject motion and mixed lighting merged in | #534, #551, #550 | `e222-534` (`d39f9cf`) |
| Lateral color as a fringe width | #580 | `e222-580` (`5ce0025`) |
| Representative light-source spectra designed by Photivra | #557 | `e222-557` (`3e4fba2`) |
| Print planner contain fit with borders | #365 | `e222-365` (`65efdcd`) |
| Integration: conflict resolutions, the speed-versus-accuracy scheme on the new choices, the size pass, 2.21.0 preparation | all | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.21.0.

## Default changes

See the CHANGELOG's "Default changes (migration)" table. In short: chart signals are integrated from the material spectrum per site (the same samples but for rounding; Quality paths slower, as the owner accepted); catalogue PSF kernels carry the PSF's own centroid (#589); catalogue-lens ties resolve on the lattice, with `lens.catalogue`'s `fast` choosing per-tap points under rolling-shutter rotation (#588); `output.lensCorrections` and the DNG lens-correction opcodes use the capture's own channel dispersion (#589); `PrintPlanInput.fit` is a union (#365). Requests that use none of the new options and no catalogue lens off the axis keep their 2.20.0 bytes, apart from the chart-signal rounding.

## Integration of the parts

- **Conflicts:** `CHANGELOG.md` (every part's block kept), the generated API reference (regenerated), `THIRD_PARTY.md`, `docs/USAGE.md`, `llms.txt`, `src/index.ts` and `test/root-export-input-errors.test.ts` (both sides kept); code conflicts below.
- **#588 on 2.20.0's scheme:** the branch was built before the scheme and kept its own format default. Its rolling-shutter choice now resolves through `resolveFast(catalogueFast, fastTop)` and `markFast`, so `diagnostics.fast.requested` is the resolved top-level value with `defaultedFrom` (the owner's 2.20.0 rule) and PNG counts as an export. #565's lattice provider for `lens.diffraction` and #588's for `lens.catalogue` are one branch (the catalogue never combines with `lens.diffraction`), with one assumption method name, `per-tap-source-points`. The registry gains `lens.catalogue/rolling-shutter-taps`.
- **#589 with #587:** 2.20.0's DNG lens-correction opcodes reproduce `output.lensCorrections` exactly (tested). #589 moved the developed correction to the capture's own channel dispersion, so the opcodes take the same dispersion (computed once per capture, reported in both assumptions). #589's centroid alignment and #567's field-varying bokeh kernels combine in the PSF builder.
- **#581 on the chart design-around:** the Speed kernel's `scene_value` adapter for chart materials integrates the material's spectrum in the kernel (`material_signal`, recomputed when the material or channel changes) instead of #581's per-material table, so chart bytes are those of the design-around. The image-plane module keeps its own `scene_value` (each pixel's signals integrated from its reconstructed spectrum, owner-approved) and binds the surround's three channel signals as the kernel's binding 3. The surround's signals are now integrated from its spectrum, 0.18·W(λ), like a pixel's, on the CPU and GPU, instead of the reflectance times the white integral. #581's Quality passes use the design-around's gather layout.
- **#534 (with #551 and #550):** the lattice provider of #565 and #588 reads the moving scene, time-dependent with `motion.subject`, and a moving subject under a rolling shutter takes the per-tap fast choice for either lens; the image-space provider's per-node sampler (shared by #588) takes the time; the display view's lens signal integrates each material's spectrum at #551's times; the tabulated expected-signal path takes mixed light, chart materials and image-plane prints, not a moving subject. Mixed light over an image-plane print is refused, because the print's pixel signals are integrated under one illuminant.
- **#580:** takes an optional `channelDispersion` from #589's `calculateChannelEffectiveDispersion` (owner decision) and is re-measured against #589's RAW centroid measure: 0.232 px for *PV 24 1.4 Pro* (RAW 0.22 px) and 0.797 px for *PV 24 1.8* (RAW 0.80 px) at the corner region's center at 6 µm.
- **#554 with #567:** #567's bokeh-value test covers the phone lenses; the 24 mm phone lens has the consumer construction's cat's eye, and as a fixed-aperture lens it cannot be stopped down, so only its open area is checked. The profile tests ask for `fast: false`, because 2.20.0 computes `result.sensor.midGrey` only on exact requests.
- **CI capacity (owner-approved):** this release's suite is about 28 % longer (CI test legs 2,612 → 3,350 s), and three of 2.20.0's four coverage shards reached the 20-minute job limit. Coverage now runs as six time-balanced shards in `ci.yml` and `publish.yml` (the `coverage gate` job still merges them and enforces the thresholds on the whole suite), the five chart cases of `display-view-quality-gpu.test.ts` run from their own file, and `test/shard-weights.json` is re-estimated from this pull request's CI times. No test was removed and no job limit was raised.
- **Design-around check:** no render path of the merged tree forms a per-material or per-node channel value table, or a white-integral shortcut (searched for the removed tables and checked in the conflict resolutions above). The owner-approved per-pixel signals of an image-plane print are integrated from each pixel's spectrum.

## Sizes

The app's capture-worker shape (`test/capture-bundle.test.ts`: every chunk of `NATIVE_RAW_LIMITS`, `prepareDisplayView`, `serializeSimulatedCaptureDngFromParts`, `simulateCapture`, `simulateIdealReference`; rolldown 1.2.9, minified ESM, gzip level 9):

| Tree | Total gzip |
| --- | --- |
| 2.20.0 (`991f8a3`) | 355,994 B (limit 356,000 B) |
| All nine parts merged | 365,164 B (+9,170 B) |
| **This pull request**, after the size pass (−1,469 B) | **363,695 B** (entry 283,129 B; catalogue chunk 13,184 B; GPU session chunk 55,175 B) |
| Limit | **363,700 B** (2.20.0: 356,000 B; raised by the remaining overage, 7,695 B, rounded up to the next 100 B, under the owner's rule for this release) |

**The size pass (results unchanged).** Two of the parts loaded small modules on demand: #554's profile parser and body builder and #550's mixed-illumination module. As lazy chunks they made the bundler move the modules they share with the capture entry (configuration errors, validation, calculation results, evidence, the illuminants, the PSF profile, the seed streams and the color matching functions) into four shared chunks of their own, which cost more than the code they kept out of the entry. As static imports, the worker is 1,469 B smaller and the display view's addition is measured as before. The profile catalogue itself stays out of the worker (#554, tested). Other shapes were measured and not kept: lazy chunks that take their imports from the facade (−1,410 B, but the display-view bundle still split), and only the profile parser static (about −1,640 B, with the display view's minified budget exceeded by about 400 B). The growth is the parts' own code: #550's blends and point sources, #534's build-up stage, #551's moving scene, #554's profiles and framing, #581's dispatch, #588's and #589's catalogue code, and the design-around's in-kernel integration in the GPU chunk.

The display view's addition to a capture bundle: 46,270 B minified and 18,327 B gzip (2.20.0: 45,992 B and 18,188 B; budgets 46,500 B and 18,550 B, unchanged).

## Local gates

On the integrated tree (`a71b7c8`, tree `bf109eb`; Apple M5 Pro, Node.js 24.19.0), one run through the shared lock:

- `npm run check:static` (lint, typecheck, licence, licence-header, identity and browser-surface gates): passed. `npm run check:licenses`: "Dependency license policy passed: Apache-2.0=15, BlueOak-1.0.0=1, BSD-2-Clause=6, BSD-3-Clause=2, ISC=7, MIT=125, MPL-2.0=12" (no new dependency).
- `npm run coverage`: 382 files passed (1 skipped), 4,392 tests passed (2 skipped); coverage 96.02 % statements, 92.51 % branches, 98.71 % functions, 97.47 % lines (thresholds met); 9.4 min. Every hash lock passes. `test/shard-weights.json` keeps 2.20.0's CI times and takes this run's times scaled by 2.11 (2.20.0's median CI/local ratio) for the 9 new files and the 46 files whose scaled time exceeds 1.5 times the recorded one (mostly the display-view and catalogue files the chart design-around and #581 slowed).
- `npm run build`: passed (24 WGSL literals minified). `npm run docs:check`: passed (363 Markdown files, 161 importing examples).
- `npm run pack:check` and `npm run release:consumer-check` first failed on documentation only: three links from packed guides to unpacked pages (#550's and #554's) and three doc examples (#554's, written before 2.20.0 made `result.sensor.midGrey` an exact-request figure, and one missing import). After the fix: pack:check passed (1,065 files), and the consumer check passed (161 strict typed and running doc snippets).
- **WebGPU on SwiftShader** (`PHOTIVRA_WEBGPU_REQUIRED=1 npm run test:webgpu`, Playwright Chromium 1243 headless, adapter `google` / `swiftshader`, fallback adapter): 4 files, 179 tests passed, 11.5 min, including the chart design-around's Speed and Quality kernels, #581's image-plane module and Quality passes and the defocus cases. Software adapter: no GPU performance claim.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.21.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] The nine part branches merged into this pull request.
- [x] Version surfaces aligned at 2.21.0 (`npm run release:prepare -- 2.21.0`). Root exports 1,931.
- [x] 2.20.0 recorded as published ([2.20.0 release record](RELEASE_2_20_0.md#publication)).
- [x] `src/gpu` changed: the SwiftShader WebGPU suite run locally ([Local gates](#local-gates)) and on this pull request's CI.
- [x] The capture-worker size limit settled: one pass for savings, then raised to 363,700 B under the owner's rule for this release ([Sizes](#sizes)).
- [ ] Green CI on this pull request, then on `main` after merge.
- [ ] The owner's approval to tag `v2.21.0`.
- [ ] The `v2.21.0` tag on the `main` commit that merges this record.
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.

## For the owner

Decided by the owner and applied here: the two waves ship as one release; one pass for savings, then the worker limit raised by the remaining overage; #580 takes #589's dispersion and is re-measured against RAW; the chart design-around on every render path. Integration choices that the owner may want to review are listed in the pull request's report: the DNG opcodes' move to the capture's own channel dispersion, the refusal of mixed light over an image-plane print, and the two static imports of the size pass.
