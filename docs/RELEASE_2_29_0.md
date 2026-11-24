# 2.29.0 release

> **Published November 23, 2026 (23:28 UTC).** The `v2.29.0` tag is on `a9ce205` (`main` after #802); npm publishing ran
> from the tag ([Publication](#publication)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.29.0`, with `ENGINE_API_VERSION = "2.29.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **The issues:**
  - layered chart scenes through a lens, under mixed light, with a catalogue lens, focus scatter and breathing, camera motion,
    larger blur at card edges, faster whole-frame captures and on the GPU (#741, #744–#751), tap to focus (#747), the
    in-focus mask (#752) and the kernel radius bound (#764);
  - `simulateTypicalProcessing` (#740) and false color with noise (#743);
  - full-quality motion with diffraction and the anti-aliasing filter in captures (#761, #762) and display views (#767);
  - faster full-quality catalogue-lens and mixed-light frames (#760) and the rolling-shutter defocus region (#711);
  - smaller bundles (#658, #765) and the low-severity fixes of #730, #738, #742, #753 and #786;
  - tests, shard weights and the documentation site (#742, #755, #756, #757, #758).
- **Why a minor version:**
  - 16 new root exports, 2,117 → 2,133 (runtime exports 725 → 730), new options and result fields and one new fast method
    (`simulateTypicalProcessing/local-tone-mapping`). Nothing is removed from the root and no export changes kind.
  - Some outputs, report fields and refusals change ([Default and output changes](#default-and-output-changes)).
- **Capture-worker sizes:** fast worker 338,820 B (limit 338,900 B); on demand 51,743 B (limit 52,000 B); no limit raised;
  new rows for the new chunks and the #765 calculation bundles ([Sizes](#sizes)). #658's 49,400 B target is not met and #658 stays open.

## Scope

The `e229-int` branch is cut from `main` at `783f38f` (2.28.0 and its publication record). Each group built on its own branch
from `e229-int` at the start of its wave and was merged without rebasing (`git log --first-parent 783f38f..e229-I`), following
the plan (`docs/plans/2.29.0.md` on the `plan-2.29.0` branch, and its #767 addendum on `plan-2.29.0-767`).

| Wave | Change | Issues | Merge |
| --- | --- | --- | --- |
| 1 | WGSL blankspace, shared helpers, the program-line and detail-limit bundles, ties, the rotation quadrature | #658, #765, #753 | `fcaab42` |
| 1 | Shard weights re-recorded, the offset-expansion test back in coverage, the `combined` locks removed | #742, #755 | `cb54795` |
| 1 | The rolling lens blocks' memo, two-row frames | #711, #730 | `077c474` |
| 1 | Layered queries and the kernel radius bound; the layered sum's seams | #747, #752, #764 | `8a9261c`, `1e74d1b` |
| 1 | False color with noise; typical processing | #743, #740 | `0845374`, `80cabfc` |
| 1 | Facade findings, Auto ISO's whole-stop list, sensor and optics fixes, temperatures | #730, #738, #742, #753 | `36edd9a` |
| 1 | Site: color patch names, syntax coloring, icon files | #756, #757, #758 | `08b3839` |
| 2 | Catalogue PSF in one batch, the veil's frame mean, tap-major radiance kernels | #760, #730 | `1e20119` |
| 2 | Motion with diffraction and the four-spot filter at full quality | #761, #762, #730 | `94f4862` |
| 2 | Layered mixed light, lens map and edge runs at module level | #744, #745, #749, #750 | `89ff311`, `b332dab`, `db3bc9e` |
| 3 | Wiring: layered scenes through a lens, mixed light, large blur, `chartSize`, the focus mask, the surface at a pixel | #744, #745, #747, #749, #752, #761 | `1af159e` |
| 3 | Layered motion, catalogue kernels and GPU passes at module level | #746, #741, #748, #750 | `0e4d7a6`, `6f6595e`, `4f36fed` |
| 4 | Wiring: the catalogue lens, focus, camera motion and the GPU route; the tabulated layered capture | #741, #746, #748, #750, #751 | `099c96f` |
| 4 | Display views with motion, diffraction and the filter | #767 | `d6c26b8` |
| 2–4 | Savings: WGSL interpolation lines and joined lines, untagged literals, shared helpers; null and `{}` options | #658, #760, #761, #786 | `ed66726`, `fb993c9` |
| 5 | Integration: root exports, registry, changelog, docs, bundle rows, shard weights, version surfaces, this record | — | this branch |

Held back (owner decision 2, the fast row's room): `facade-04` (#800), `facade-05`, `facade-06` and `facade-07` of #730. Not in this
release: #737 (WebAssembly research).

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.29.0, by area, with the migration list first. The changes are
documented in [LAYERED_SCENES.md](LAYERED_SCENES.md), [DISPLAY_VIEW.md](DISPLAY_VIEW.md), [LENS_CATALOGUE.md](LENS_CATALOGUE.md),
[PROCESSING.md](PROCESSING.md), [QUICK_START.md](QUICK_START.md), [USAGE.md](USAGE.md), [WEBGPU.md](WEBGPU.md),
[API_STYLE.md](API_STYLE.md) ("Exact and fast modes") and the generated [API reference](API_REFERENCE.md).

## New exports

16 root exports (5 runtime, 11 types), counted from `docs/api/exports.json` against the `v2.28.0` tag's; nothing is removed
and no existing export changes kind.

| Runtime exports | Types | Issue |
| --- | --- | --- |
| `simulateTypicalProcessing` | `SimulateTypicalProcessingInput`, `TypicalProcessingDevelopOptions`, `TypicalProcessingResult`, `TypicalProcessingStage` | #740 |
| `calculateLayeredChartSurfaceAt`, `calculateLayeredChartSurfaceAtPixel` | `LayeredChartSurfaceAt`, `LayeredChartSurfaceAtPixelInput` | #747 |
| `calculateLayeredChartKernelRadii` | `LayeredChartKernelRadius` | #764 |
| — | `DisplayViewFocusMask` | #752 |
| `calculateIdealLensDetailLimit` | `CalculateIdealLensDetailLimitInput` | #765 |
| — | `FalseColorNoise`, `FalseColorStatistics` | #743 |

**New options and fields:** `measure.noise` and `result.noise` (#743), the view's `focusMask` and `view.focusMask` (#752),
`LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites` (#764), new fields of the `scene.layers` assumption for #741, #744, #745 and
#748 (`lensMap`, `illumination`, `chartUnitsPerFrameUnit`, `catalogue`), and `"layered-sum"` as the scene of the
`raw.expectedSignal` assumption of a tabulated layered capture (#751).

## Default and output changes

The full list is the changelog's "Output and behavior changes (migration)" under 2.29.0: layered requests that render instead of
being refused and the new layered refusals; the layered kernel bounds (512 and 128 sites) and their `lens.defocus:` messages;
the layered run sum and the tabulated layered capture (rule 3, the seam locks re-recorded); #748's framing under focus
scatter; #741 without a per-wavelength axial-color blur; #746's 16 midpoints at 0.95 % of the local swing; #767's
`lens.diffraction` execution label in views; #786's refused `{}` and `null` options; the ISO, shutter and aperture ties
(`foundation-05`); `calculateProgramLine` with a non-integer `ev100` identical across Node versions (some non-integer `ev100`: last-digit moves of the luminance and what follows from it, on every Node version); #738's whole-stop list; `sensor-03`, `sensor-04`, `optics-22`, `optics-26`; temperatures at or below
absolute zero (#742); and the facade items of #730.

## Sizes

Measured on the capture worker's shape (`test/capture-bundle.test.ts`) with rolldown 1.2.14, Node 26, gzip level 9. No limit
is raised; the new rows' limits are their measurements rounded up to the next 100 B (owner decision 3).

| Row | 2.28.0 | 2.29.0 | Limit |
| --- | --- | --- | --- |
| fast worker | 338,840 B | **338,820 B** | 338,900 B |
| on demand | 51,977 B | **51,743 B** | 52,000 B |
| export kit | 10,395 B | **10,393 B** | 10,400 B |
| lens passes | 10,200 B | **9,919 B** | 10,200 B |
| false-color body; entry delta | 5,094 B; 348 B | **5,094 B; 355 B** | 5,100 B; 400 B |
| false-color noise (new) | — | **3,572 B** | 3,600 B |
| layered chunk (new) | — | **22,962 B** | 23,000 B |
| layered GPU chunk (new) | — | **8,331 B** | 8,400 B |
| typical processing: body; entry delta (new) | — | **17,889 B; 1,331 B** | 17,900 B; 1,400 B |
| `calculateProgramLine` (new row) | 24,838 B | **14,500 B** | 14,600 B |
| `calculateIdealLensDetailLimit`; `calculateDetailLimit` (new rows) | —; 10,200 B | **4,954 B; 10,299 B** | 5,000 B; 10,300 B |

## Benchmarks

`docs/benchmarks/2026-11-23-figure-batch-2.28.0-2.29.0.json` records #760's pair runs of the #670 set's catalogue-768 and
mixed-light parts on a shared machine: `fast: false` catalogue-768 39.81 → 18.94 CPU s (2.1×), mixed light 33.97 → 19.46 CPU s
(1.7×), samples equal in every pair. Times are host-dependent; the benchmark is informational and not run by CI.

## Known limits

- #741: no axial color as a per-wavelength blur (the go/no-go failed; #799); a shaped kernel's energy at card
  edges is within 6.0 % on a uniform scene with a strong spherical aberration (#799).
- #744: a layered request with a fisheye is refused where it reads a point 75° or more off the axis (#797).
- #746: 16 temporal midpoints are 0.95 % of the local swing from 64 stills on a moving edge.
- #748: a layered request with focus scatter keeps the requested focus's framing.
- #750: the GPU takes layered views on the planar map only.
- #760: 2.1× and 1.7× against the plan's 4× estimate; #760 stays open.
- #767: coarse moving-subject views with diffraction at `fast: false` are slow (#798).
- #658: the on-demand target of 49,400 B is not met.

## Local runs on the integration branch

On one machine (Apple M5 Pro, macOS 27.2.1, Node 26.13.1), one heavy process at a time, November 23, 2026, on the integration
tree (`e229-I`). The CPU runs are of the tree after the release review's fixes; the GPU runs are of ebfb513 with this record's
version surfaces and documents not yet committed (the review's fixes change no shader text: the minified WGSL files are byte for
byte the same size, 275,084 B):

| Run | Result | Duration |
| --- | --- | --- |
| `npm run check:static` (lint, typecheck, license, header, identity and browser-surface gates) | passed | 15 s |
| `npx vitest run` (the whole suite) | 516 files passed, 1 skipped; 5,332 tests passed, 2 skipped (the two opt-in tests) | 247 s |
| `npm run coverage` | the same counts; statements 96.20 %, branches 92.86 %, functions 98.54 %, lines 97.88 % (thresholds 90/80/90/90) | 585 s |
| `npm run test:webgpu` (SwiftShader, Chromium headless) | 213 of 213 in 9 files, the layered file 8 of 8 | 1,393 s |
| `npm run test:webgpu:hardware` (Apple M5 Pro, WebGPU on Metal, Chrome 158) | 213 of 213 in 9 files ([hardware record](WEBGPU_DEVICES.md)) | 646 s |
| `npm run build`, `npm run pack:check`, `npm run release:consumer-check`, `npm run docs:check` | passed (54 WGSL literals minified; 1,349 packed files; 187 typed doc snippets) | — |
| The CI hash-lock set (macOS job's files) and the layered seam locks | 10 files, 95 tests passed | 7 s |
| The CI tool tests, `scripts/test-gates.mjs` and the site's tests, build and checks | passed | — |

The preview acceptance (`accept:gpu:hardware`) was not run for this release.

## Release gates

1. **GitHub CI** on the exact commit that is tagged (CI and WebGPU). Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.29.0` (AGENTS.md rule 3).

Update the release branch to `main`'s tip before its last CI run and do not merge anything else first: a pull request's proofs
count only when its head tree is `main`'s tree after the squash.

## Before the tag

- [x] The hardware GPU run, recorded in [WEBGPU_DEVICES.md](WEBGPU_DEVICES.md) (#658's shader text and #750's layered passes):
  213 of 213 on ebfb513, and 213 of 213 again on the release commit a9ce205.
- [x] The release review of the whole diff and its fixes.
- [x] The WebGPU conformance run on the release commit (all three parts; the publish workflow's `WebGPU conformance proofs` job
  requires them): #802's run on the tree of `a9ce205`, and `main`'s run on `a9ce205` ([Publication](#publication)).
- [x] The owner's approval to tag `v2.29.0` (AGENTS.md rule 3).
- [x] After publication:
  - [x] npm version, dist-tag, integrity and provenance verified;
  - [x] GitHub release notes published;
  - [x] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.29.0` (annotated, `77761d7`) → `a9ce2056f9de171efc39a376499ac3e041968711` (#802 on `main`), created 23:17:14 UTC. #802's head `a8b5e04` has the same tree as `a9ce205`; its CI ([run 45281263921](https://github.com/Photivra/engine/actions/runs/45281263921)), WebGPU ([45281263593](https://github.com/Photivra/engine/actions/runs/45281263593)), native performance ([45281263794](https://github.com/Photivra/engine/actions/runs/45281263794)) and Pages ([45281263817](https://github.com/Photivra/engine/actions/runs/45281263817)) runs passed before the merge, each on attempt 1. `main` on `a9ce205`: CI [45285722477](https://github.com/Photivra/engine/actions/runs/45285722477), WebGPU [45285722306](https://github.com/Photivra/engine/actions/runs/45285722306), Pages [45285722513](https://github.com/Photivra/engine/actions/runs/45285722513) and native performance [45285722533](https://github.com/Photivra/engine/actions/runs/45285722533) passed |
| Hardware GPU run | The owner's `test:webgpu:hardware` on the release commit `a9ce205` before the tag (Apple M5 Pro, `apple` / `metal-3`, the installed Chrome, headless, hardware adapter required): 213 of 213 passed in 9 files, `softwareAdapter: false` in every report, 648 s ([WEBGPU_DEVICES.md](WEBGPU_DEVICES.md)) |
| Publish workflow | [Publish npm run 45287478138](https://github.com/Photivra/engine/actions/runs/45287478138), attempt 1 (started 23:17:18 UTC): the `WebGPU conformance proofs` job and the coverage gate passed; publish job 23:19:52 to 23:20:06 UTC; the run finished at 23:20:07 UTC |
| npm | `@photivra/engine@2.29.0`, dist-tag `latest`, registry time 23:28:16 UTC, November 23, 2026; npm accepted the upload at 23:20:04 UTC and reported the package as being processed |
| Integrity | `sha512-V7zz15eA59B5V5hlTmV0xMYUVDCQ+ZcZLrJacqSUXMpG7m2zr4cgg69V4cQDS9Kibic5qrLwdIgRhU+KsG2WLg==` (shasum `0f6e4b95a4adf4fa68133a7603fccb9512934499`, 1,349 files) |
| Provenance | SLSA provenance v1 attestation, recorded in the Sigstore transparency log (log index 4059990160) |
| GitHub release | [`v2.29.0`](https://github.com/Photivra/engine/releases/tag/v2.29.0), "@photivra/engine 2.29.0", the changelog's summary of 2.29.0, published 23:42:10 UTC |
| Documentation site | The Pages run on the push of `a9ce205` ([45285722513](https://github.com/Photivra/engine/actions/runs/45285722513)) built and checked the site and deployed nothing: the changelog still read as prepared. The Pages run after the publish ([45287898461](https://github.com/Photivra/engine/actions/runs/45287898461)) built, checked and deployed the site |
