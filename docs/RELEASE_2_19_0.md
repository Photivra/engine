# 2.19.0 release

> **Published November 9, 2026 (19:36 UTC).** The `v2.19.0` tag is on `9c81348` (#586), after `main` CI on that commit had passed; npm publishing ran from the tag ([Publication](#publication)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.19.0`, with `ENGINE_API_VERSION = "2.19.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:**
  - 10 new root exports (1,850 → 1,860; runtime exports 626 → 631).
  - New opt-in options (`output.lensCorrections`), a new development entry point (`simulateCaptureFromParts`) and two new progress stages. Requests that 2.18.0 refused now resolve: program mode with a lens range that does not hold f/4–f/16 (#583) and a `lens.ideal` range narrower than about f/1 (#585).
  - One breaking fix, #566, which the owner decided to ship in a minor release (2026-11-07, confirmed 2026-11-09): the rotationally symmetric `LensSampledPsfProfile` interpolation no longer mirrors asymmetric kernels in y. It changes results only for caller-supplied profiles in that mode; no built-in lens uses it.
  - Nothing is removed, and no default changes.
- **Why now:** the five 2.19.0 part branches (six issues) are done; the owner chose one integration, one pull request and one release.

## Scope

No pull request has merged since `v2.18.0` (`3f9d65b`). This pull request integrates five part branches, each cut from `3f9d65b` and merged `--no-ff` in this order:

| Change | Issue | Part branch |
| --- | --- | --- |
| The rotationally symmetric sampled-PSF mode rotates kernels with the PSF quadrature's row convention (breaking fix) | #566 | `e219-566` (`1e614aa`) |
| `calculateFilteredExposureTime` and the generic 3-, 6- and 10-stop ND presets | #578 | `e219-578` (`80c8a28`) |
| Program mode limits the program line to the lens's f-number range; `lens.ideal` ranges narrower than about f/1 | #583, #585 | `e219-ideal-program` (`7509aae`) |
| `simulateCaptureFromParts`: whole-image sharpening and diffraction correction of a capture rendered in parts; row-by-row detail stages | #571 | `e219-571` (`b59592d`) |
| `output.lensCorrections`: the catalogue lens's corrections in the development | #570 | `e219-570` (`410e6b9`) |
| Integration; shared field checks (the capture-worker size); 2.19.0 release preparation | all | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.19.0.

## API

New root exports (10):

| Exports | Kind | Issue |
| --- | --- | --- |
| `calculateFilteredExposureTime`, `FILTERED_EXPOSURE_DEFAULT_WAVELENGTH_NANOMETERS`, `GENERIC_ND_FILTER_PROFILES`, `GENERIC_ND_FILTER_STOPS` | runtime | #578 |
| `CalculateFilteredExposureTimeInput`, `FilteredExposureTime`, `FilteredExposureDialSetting`, `GenericNdFilterStops` | type | #578 |
| `simulateCaptureFromParts` | runtime | #571 |
| `SimulateCaptureLensCorrections` | type | #570 |

8 + 1 + 1 = 10, and 1,850 + 10 = 1,860, the count the regenerated reference reports ("1860 root symbols across 202 modules"; `docs/api/exports.json`: 631 runtime, 1,229 type). `GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM` moved from `src/output/generic-lens-corrections.ts` to `src/output/developed-lens-corrections.ts` (same value, still a root export).

Changed contracts, all additive:

- `SimulateCaptureOptions.output` gains `lensCorrections: { distortion?, lateralColor?, vignetting? }` (#570), with `lens.catalogue`; `SIMULATE_CAPTURE_COST_OPTIONS` gains `"output.lensCorrections"`; new assumption `output.lensCorrections`.
- `SimulateCaptureProgress.stage` gains `"diffraction-correction"` and `"sharpening"` (#571), one event per output row of the whole image; the coordinator counts them as additive (code with an exhaustive `switch` over `stage` must add them).
- In program mode, a lens range that does not hold f/4–f/16 now limits the program line (assumption value: the line's nodes under the profile id `facade-generic-program-line-lens-range`) where 2.18.0 refused it (#583); the exposure anchor of a `lens.ideal` range narrower than about f/1 takes the body's shortest shutter (#585).
- The messages of the parts join read "Part k: …" and "The parts …" (were "DNG part k: …" and "The DNG parts …"), now that `simulateCaptureFromParts` shares the join (#571).

## Owner decisions

All dated 2026-11-09 unless stated.

- **#578:** generic ND presets of 3, 6 and 10 stops, where N stops means exactly 2^-N.
- **#570:** zoom to fill (the image keeps its size with no missing pixels); the vignetting correction includes the distortion's area factor (the correction profile's own vignetting component is follow-up #584); the display view refuses `output.lensCorrections` for now; the region-rectangle detail (`developedRect`, and `region.nativeRect`, `raw` and `plan` describing the developed rectangle) is accepted.
- **#583:** keep the line's 1/2000–1.024 s span; the limited line applies to `lens.prime` and `lens.catalogue` ranges too, not only `lens.ideal`.
- **#585:** fixed in 2.19.0.
- **#571 (coordinator decisions):** the name `simulateCaptureFromParts`; the extra Native performance workflow run (#571 changes `src/output/native-capture-sdr.ts`) is accepted; the two new progress stages count as additive.
- **#566:** a breaking fix, as the CHANGELOG states (decided 2026-11-07).

## Integration of the parts

- **Conflicts:** `CHANGELOG.md` (each part's block kept under one heading) and `src/facade/simulate-capture.ts`, where #570 and #571 both changed the development: #571 made the linear correction step asynchronous and row by row (`correctDiffractionInPlace`, `renderSdrWithUnsharpMaskInPlace`, one `rowProgress` helper), and #570 added the lens corrections after the diffraction correction and widened the linear-development condition to `detailRequested || lensCorrection`. The merge keeps #571's step and runs #570's corrections in it, after the diffraction correction and before the tone curve and the unsharp mask, as #570 ordered them. #583/#585 (exposure and program code) merged without conflict. `docs/USAGE.md`, `docs/validation/documentation-fragments.json` and `test/shard-weights.json` merged cleanly (`npm run docs:check` passes); the generated API reference was regenerated, not hand-merged.
- **`simulateCaptureFromParts` and `output.lensCorrections`:** the whole-frame capture applies the corrections, so the joined-parts development does too, through the same code: a new test (`test/simulate-capture-develop-parts.test.ts`) renders a catalogue lens with all three corrections and sharpening from 2 × 2 parts, rendered once without and once with the corrections, and compares samples, JPEG, RAW codes, detail and rendering diagnostics, options and the `output.lensCorrections` assumption with `simulateCapture` byte for byte. A part may keep or drop the option (a corrected region only widens its native rectangle; the RAW codes are the same). A catalogue lens takes no `lens.diffraction`, so the diffraction correction and the lens corrections never run together.
- **Progress stages:** `raw` (not for parts), `white-balance` (auto), `development`, `diffraction-correction`, `sharpening`, `jpeg`, in that order; each detail stage ends with `completedTileCount === totalTileCount`. The lens corrections run between `diffraction-correction` and `sharpening` and report no stage of their own; the test checks the order with corrections on (`development`, `sharpening`, `jpeg`). The `SimulateCaptureProgress` doc comment, the `simulateCaptureFromParts` doc comment and docs/QUICK_START.md say so.
- **Memory with lens corrections:** the corrections resample into a second developed image, so with `output.lensCorrections` #571's one-image development holds two while they run (docs/QUICK_START.md).

## Sizes

The app's capture-worker shape (`test/capture-bundle.test.ts`: every chunk of `NATIVE_RAW_LIMITS`, `prepareDisplayView`, `serializeSimulatedCaptureDngFromParts`, `simulateCapture`, `simulateIdealReference`; rolldown 1.2.9, minified ESM, gzip level 9):

| Tree | Total gzip |
| --- | --- |
| 2.18.0 (`3f9d65b`) | 351,859 B |
| #566 / #578 alone | 351,859 B (no change in the worker) |
| #583 + #585 alone | 351,990 B |
| #571 alone | 351,937 B |
| #570 alone | 353,594 B |
| All five parts merged | 353,811 B (entry 275,508 B; catalogue chunk 11,616 B) |
| **2.19.0, after sharing the duplicated helpers** | **351,775 B** (entry 273,686 B) |
| Limit | 352,000 B (unchanged; not raised) |

**The saving (2,036 B), no output change:** the domain parsers held private, textually identical copies of the same field checks: `requireRecord` in 44 modules, the trimmed non-empty-string check in 35, the finite, positive, non-negative, safe-integer, scientific-status, availability and limitations checks in 3–19 each, and `deepFreeze`, `cloneJson`, `addCompensated`, `sameSite`, `fullRect` and the GPU abort check in 3–5 each. Gzip cannot share text more than 32 KiB apart, so each far copy cost bytes. They are now one export each in `src/core/record-validation.ts`, `src/core/shared-helpers.ts` and `src/gpu/webgpu-runtime.ts` (285 copies), and 35 identical private helpers found in two modules each are exported from one and imported by the other. The copies were matched after type stripping, with their imported identifiers resolved, so every message, error class and return value is the same; no root export changes. The entry chunk dropped 18 KB minified and 1.8 KB gzip. Without the `src/gpu` part of the change the worker would measure 352,045 B, so it stays (see [GPU evidence](#gpu-evidence)). The app worker does not yet import `simulateCaptureFromParts`; with it the worker measures 351,792 B (+17 B).

The display view's addition to a capture bundle: 45,823 B minified and 18,153 B gzip (2.18.0: 45,807 B and 18,128 B; budgets 46,500 B and 18,550 B, unchanged).

## Byte identity

Every request that 2.18.0 renders, that uses none of the new options and no caller-supplied rotationally symmetric PSF profile (#566), renders byte-identically: all hash locks pass in the full suite, and #583/#585 pin SHA-256 digests of samples, RAW codes, exposure and assumptions for the requests whose program line and anchor do not change.

## Performance

From the part branches (Apple M5 Pro, Node.js 24.19.0, one thread):

- **#571** (`node scripts/benchmark-joined-development.mjs`, 24 MP, 8 parts): join and develop 1.9–2.2 s without a detail stage; 5.1–5.4 s with both detail stages, against 10.0–10.4 s for the whole `simulateCapture`. Peak memory with both stages 1,079 MiB, against 3,670 MB for the same whole capture in 2.18.0.
- **#570:** the lens corrections cost about 1.3 s per 24 MP frame on one thread.

## GPU evidence

`git diff v2.18.0 -- src/gpu` changes only how the GPU modules reach shared helpers: the abort check (`throwIfAborted`, now exported once from `webgpu-runtime.ts`), and the speed view's `footprintShape`, `bilinearKernels` and `offsetCount`, now imported from the quality view, where identical copies were. No WGSL and no dispatch changes.

The hardware gates ran on the integrated tree (`b8af756`) on the owner's Apple M5 Pro (Metal, headless Chrome 157), recorded in [WebGPU devices](WEBGPU_DEVICES.md):

- `npm run test:webgpu:hardware`: **167 of 167 passed**, product path `dekker`.
- `npm run accept:gpu:hardware`: **PASS, 26 of 26 cases** on `webgpu-f32`, every pixel within ΔE2000 1, largest ΔE2000 0.0018, the 8-bit display codes equal to the reference's ([record](validation/display-view-acceptance-m5-pro-2026-11-09-b8af756/README.md)).

## Local gates

On the integrated tree, Apple M5 Pro:

- `npm run check:static`: passed.
- `npm run coverage` on Node.js 24.19.0: 359 files passed (1 skipped), 4,201 tests passed (2 skipped); coverage 95.9 % statements, 92.3 % branches, 98.72 % functions, 97.34 % lines; 6.2 min. `test/shard-weights.json` re-recorded from this run (`scripts/record-shard-weights.mjs`): the four parts now balance to within 1 s of measured time (867 s each); with the 2.18.0 weights they spread 814–899 s, and the 2.18.0 publish run's first coverage shard took 19.9 of its 20 minutes.
- The full suite on Node.js 26.13.0: 359 files passed (1 skipped), 4,201 tests passed (2 skipped); 2.4 min.
- Every test 2.19.0 added or changed (42 tests in 6 files) took at most 10.2 % of its deadline on Node.js 26 (the slowest: #583's byte pins, 6.1 s of 60 s, and the prime and catalogue ranges, 10.7 s of 120 s).
- `npm run build`, `npm run docs:check`, `npm run pack:check` (979 files) and `npm run release:consumer-check`: passed.

## For the owner

- **The lens corrections are one uninterrupted step.** They run between the `diffraction-correction` and `sharpening` progress stages with no events and no host yield, so `signal` cannot cancel them while they run (about 1.3 s per 24 MP frame on the Mac, longer on phones). A follow-up could yield and check the signal row by row (no API change) or add a `lens-corrections` stage (additive, like #571's two).
- **Capture-worker headroom is 225 B** under the 352,000 B limit; the next option that reaches `simulateCapture` will probably need either further savings or the owner's decision on the limit.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.19.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] The five part branches merged into this pull request.
- [x] Version surfaces aligned at 2.19.0 (`npm run release:prepare -- 2.19.0`). Root exports 1,860.
- [x] 2.18.0 recorded as published ([2.18.0 release record](RELEASE_2_18_0.md#publication)).
- [ ] Packed tarball compared file by file with the published 2.18.0 (not done here: it needs the published tarball downloaded).
- [x] Green CI on this pull request, then on `main` after merge ([CI run 42678094852](https://github.com/Photivra/engine/actions/runs/42678094852) on `9c81348`).
- [x] The owner's approval to tag `v2.19.0`.
- [x] The `v2.19.0` tag on the `main` commit that merges this record (`9c81348`).
- [x] After publication:
  - [x] npm version, dist-tag, integrity and provenance verified ([Publication](#publication));
  - [x] GitHub release notes published (`@photivra/engine 2.19.0`, 19:37 UTC);
  - [x] publication dates updated in `CHANGELOG.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record (with the 2.20.0 preparation).

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.19.0` (annotated, `3e451a5`) → `9c813489dff9fe2e134f3737664a5232607cb91f` (#586), after `main` CI on that commit passed ([CI run 42678094852](https://github.com/Photivra/engine/actions/runs/42678094852)) |
| Publish workflow | [Publish npm run 42681163986](https://github.com/Photivra/engine/actions/runs/42681163986): `verify` passed 19:12:45–19:14:52 UTC, coverage shards 10.5–19.8 min and gate 1.0 min passed, `publish` passed 19:33:41–19:33:57 UTC |
| npm | `@photivra/engine@2.19.0`, dist-tag `latest`, registry time 19:36:35 UTC, November 9, 2026 |
| Integrity | `sha512-Az7esuXk6H0V7Y6DndsFLngGKguBofLFeVOAlBFFwEprXFH9JOX/KKYTFSkrXfHLLIodiBqfi9ZVDUuB0HsUxQ==` (shasum `ba2e85402ca2f2352944c0bb5f913d0173879e43`, 979 files) |
| Provenance | The registry lists an attestation for 2.19.0 |
