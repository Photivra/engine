# 2.26.0 release

> **Published November 16, 2026 (22:03 UTC).** The `v2.26.0` tag is on `94f56f3` (`main` after #650), after `main` CI on that commit had passed; npm publishing ran from the tag ([Publication](#publication)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.26.0`, with `ENGINE_API_VERSION = "2.26.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **The issues of milestone 2.26.0 (#639–#643, #645–#648):**
  - a flash light with power, falloff and an ambient mix;
  - camera rotation under a rolling shutter in the display view, and with `lens.defocus` in captures;
  - a bounded, seeded hand-shake trajectory and `motion.handheld`;
  - the PNG `eXIf` chunk and Exif SubjectDistance and SubjectDistanceRange in the metadata readers;
  - thin-lens framing without the lens catalogue and the sensor profiles;
  - lower display-view render cost.
- **Also:** the capture worker's JPEG and PNG writers load as an on-demand export kit.
- **Why a minor version:**
  - 15 new root exports, 2,081 → 2,096 (runtime exports 708 → 716), new options and new result fields. Nothing is removed or changed in kind.
  - Two display-view fast defaults change (#642, #643; [Default changes](#default-changes)).
- **Capture-worker sizes (two owner decisions, 2026-11-16):** the export code moved to its own measured row, and the on-demand limit was raised to 49,400 B ([Sizes](#sizes)).

## Scope

The `release-2.26.0` integration branch is cut from `f323ebb` (`main` at the `v2.25.0` tag). Each part was built on its own branch from that commit and merged with `git merge --signoff`, without rebasing.

| Change | Issues | Source |
| --- | --- | --- |
| `illumination.flash`: guide number, candela-seconds or lux-seconds, power fraction, position and illuminant; flash alone takes 1/125 s in the automatic modes | #639 | `0f62e9c`, `0159eee` (`e226-flash`) |
| Rolling shutter with camera rotation in the display view and with `lens.defocus` out of focus in captures | #640 | `6fb8990` (`e226-motion`) |
| `motion.handheld: { seed, stabilizationStops }`, `createHandShakeTrajectory`, `calculateHandShakeAngularDisplacement`, `calculateHandShakeRmsDisplacement` | #641 | `6fb8990` (`e226-motion`) |
| Display view: per-render defocus choice, per-tap chart signal, kept reconstruct-chain results; coverage shard 1 back to 20 minutes | #642, #643, #645 | `aff97d3`, `3649fae` (`e226-perf`) |
| `calculateThinLensSubjectDistanceForFraming`, `calculateThinLensChartFraming`; the sensor-profile record in its own module | #646 | `1c2a073` (`e226-framing`) |
| `parsePhotoMetadata` reads PNG (`eXIf`, IHDR) | #647 | `18df5e6` (`e226-metadata`) |
| `subjectDistanceMeters`, `subjectDistanceRange` in `ExifCaptureFields` (photo reader and DNG import) | #648 | `18df5e6` (`e226-metadata`) |
| Merges, flash refusing `motion.handheld` (with a test) | — | `f61546c`, `838c939`, `1f16b5f`, `9a7d056` |
| The export kit and its measured row | — (owner decision 2026-11-16) | `17883db` |
| Packed guides link the flash section by URL (`pack:check`) | — | `157ef1a` |
| On-demand limit 49,400 B | — (owner decision 2026-11-16) | `e84c6c1` |
| 2.26.0 preparation: version surfaces, the changelog heading, this record, the 2.25.0 publication record | — | this branch |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.26.0, one section per issue. The new functions and options are documented in:
- [USAGE.md](USAGE.md) ("Hand shake", "A flash in a capture");
- [MIXED_ILLUMINATION.md](MIXED_ILLUMINATION.md) ("Flash");
- [IMPORT_AND_PNG.md](IMPORT_AND_PNG.md) ("PNG eXIf");
- [DISPLAY_VIEW.md](DISPLAY_VIEW.md);
- the generated [API reference](API_REFERENCE.md).

## New exports

15 root exports (8 runtime, 7 types); nothing is removed and no existing export changes kind.

| Issues | Runtime exports | Types |
| --- | --- | --- |
| #639 | — | `MixedIlluminationFlash` |
| #641 | `createHandShakeTrajectory`, `calculateHandShakeAngularDisplacement`, `calculateHandShakeRmsDisplacement`, `HAND_SHAKE_MODEL_VERSION`, `HAND_SHAKE_RMS_ANGULAR_SPEED_RAD_PER_SEC`, `HAND_SHAKE_MAXIMUM_STABILIZATION_STOPS` | `HandShakeOptions`, `HandShakeComponent`, `HandShakeTrajectory`, `CalculateHandShakeInput` |
| #646 | `calculateThinLensSubjectDistanceForFraming`, `calculateThinLensChartFraming` | `ThinLensSubjectDistanceForFramingInput`, `ThinLensChartFramingInput` |

**New options and fields on existing functions:**
- `illumination.flash` (#639) and `motion.handheld` (#641) in `simulateCapture`, `simulateIdealReference`, `simulateDisplayView` and `prepareDisplayView`.
- `PHOTO_METADATA_LIMITS.maximumPngChunks` and `format: "png"` (#647).
- `subjectDistanceMeters` and `subjectDistanceRange` in `ExifCaptureFields`, so also in `PhotoExif` and `ImportedDngExif` (#648).
- `ExifTagLookup.rational` (#648).

`addJpegTextMetadata` and `addPngTextMetadata` are now re-exported from `output/text-metadata-writers.ts`. Their root names and bytes are unchanged.

## Default changes

1. **The CPU display view sums a chart site's kernel taps per tap on fast requests (#643, `chart.signal/view-per-tap`).**
   - It no longer forms per-material sums first. This is the same sum regrouped, integrated per site at use.
   - Samples of the hash-locked views are unchanged. Expected values are within 1.5·10⁻¹⁴ relative and noise standard deviations within 1.6·10⁻¹³ relative of 2.25.0. Four hash locks were re-recorded on x64 and arm64.
   - Way back: `fast: false`.
2. **The regrouped defocus of #612 is chosen per render from its operation count, region size included (#642).**
   - A region of a few pixels keeps the combined kernels. Renders on the two paths agree within 1e-9 relative and one 8-bit code.
   - Way back: `fast: false`.
3. **Requests that were refused now render:**
   - camera rotation with `motion.shutter: "rolling"` in the display view (#640);
   - `lens.defocus` out of focus with camera rotation and a rolling shutter in captures (#640);
   - PNG input to `parsePhotoMetadata` (#647).
4. **New fields in Exif results (#648):** code that compares a whole `ExifCaptureFields` record sees two more fields, both `null` when the tags are absent.

Requests without these options or combinations keep their 2.25.0 bytes:
- the export tests and hashes pass unchanged with the export kit;
- `test/display-view.test.ts` holds the hash locks.

## Integration

- **Flash and motion (#639, #641).** The flash pulse freezes motion at one instant, so a flash refuses camera rotation, `motion.subject` and `motion.handheld` alike, in captures and the display view (`test/capture-flash.test.ts`).
- **Hash locks after the merges.** The four locks #642/#643 re-recorded were checked on the merged tree, built to `dist`, with Node 24.1.0 (x64 under Rosetta) and Node 22.13.0 (arm64). All eight cases equal the part's recorded results on both architectures.
- **Design-around check.** None of these changes adds a table keyed by channel signal levels:
  - the hand-shake trajectory is folded into each instant's rotation on every render path;
  - a rolling-shutter site reads the scene at its own window's midpoints;
  - the flash lights each site as a point source;
  - the per-tap chart sum integrates each tap's material spectrum at every spectral node.

## Sizes

Measured on the app's capture-worker shape (`test/capture-bundle.test.ts`):
- root exports `NATIVE_RAW_LIMITS`, `prepareDisplayView`, `serializeSimulatedCaptureDngFromParts`, `simulateCapture` and `simulateIdealReference`;
- rolldown 1.2.9, minified ESM with the shipped WGSL, gzip level 9.

| Tree | Fast worker | On demand | Export kit |
| --- | --- | --- | --- |
| 2.25.0 (`f323ebb`) | 338,894 B | 47,366 B | (in the fast worker) |
| All parts merged (`9a7d056`) | 340,300 B | 49,357 B | (in the fast worker) |
| **This branch**, with the export kit | **331,482 B** | **49,382 B** | **10,403 B** |
| Limits | 338,900 B (unchanged) | 49,400 B (47,400 B before) | 10,500 B (new) |

- **Where the growth is.** Contributions measured on each part before the merges:
  - #641's hand-shake model and #639's flash code in the opt-in kit;
  - #640's per-site rolling-shutter times and the per-instant rotation helper in the first load;
  - #642/#643's cost model and per-tap sum;
  - #645's kept chain results.
- **Owner decision 1 (2026-11-16, "Move export code out").** The JPEG and PNG writers are one on-demand chunk, `src/facade/export-kit.ts`: the print JPEG encoder, the export JPEG coder, the PNG encoder, and the JPEG and PNG text-metadata writers. It loads where `simulateCapture` parses `output.format` "jpeg" or "png".
  - It is measured as its own row with its own limit (its measurement rounded up to the next 100 B), not in the on-demand Quality row.
  - The split costs 1,585 B in all, because the kit compresses without the entry's dictionary and imports shared bindings.
  - **First-export cost:** one chunk of 27,555 B minified (10,400 B gzip). Importing it from `dist` in Node took 14–18 ms locally.
  - `test/export-kit-cold-load.test.ts` checks that a cold JPEG or PNG export loads the kit once and matches a warm export byte for byte.
- **Owner decision 2 (2026-11-16, "Raise to 49,400 B").** The on-demand limit is the measurement rounded up to the next 100 B. Headroom left: fast 7,418 B, on demand 18 B, export 97 B.

## Local gates

Run on this tree (Apple M5 Pro, Node.js 26.13.1, a shared machine):
- `npm run prepush`: lint, typecheck, licence, SPDX-header, identity, browser-surface, and generated docs and navigation; passed.
- `npm run pack:check` and `npm run docs:check`: passed.
- The full test suite (`vitest run`), once: 440 files passed and 1 skipped; 4,680 tests passed and 2 skipped. The capture-bundle rows pass within the limits.

Coverage and the WebGPU suite run on CI.

## Known limits

- **Rolling shutter with rotation (#640).** Refused:
  - a defocus kernel above 64 sites radius (its whole-frame run lattices are one per instant);
  - `motion.subject` with a rolling shutter, out of focus and in the display view.
- **Hand shake (#641).** The trajectory is a labelled approximation of a generic photographer, calibrated to cited points and not to a person or a camera:
  - 4.39 °/s RMS (a 100 g phone held in two hands), roll zero;
  - sway near 0.7–5.6 Hz and tremor at 8–12 Hz.
  - The split over the components and the level it settles at (near 1°) are modelling choices.
  - Stabilization scales the trajectory by 2^−stops, which matches CIPA's stop rating only while the motion is linear.
- **Flash (#639).** Refused with any motion. TTL flash and high-speed sync are not modelled.
- **PNG metadata (#647).** XMP in a PNG (an `iTXt` chunk) is not read; only the first `eXIf` is.
- **Export kit.** The first JPEG or PNG export in a worker loads one more chunk; a failed load fails that request with `quality-code-unavailable`, and the next request tries again.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.26.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] #639–#643 and #645–#648 merged into `release-2.26.0` on `f323ebb`.
- [x] Version surfaces aligned at 2.26.0 (`npm run release:prepare -- 2.26.0`). Root exports 2,096.
- [x] 2.25.0 recorded as published ([2.25.0 release record](RELEASE_2_25_0.md#publication)).
- [x] The worker rows measured ([Sizes](#sizes)); the export row and the on-demand limit set by owner decisions (2026-11-16).
- [x] Green CI on the pull request (the full suite, coverage and WebGPU), then on `main` after merge.
- [x] The owner's approval to tag `v2.26.0`.
- [x] The `v2.26.0` tag on `94f56f3` ([Publication](#publication)).
- [x] After publication:
  - [x] npm version, dist-tag and integrity verified;
  - [x] GitHub release notes published;
  - [x] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record (with 2.27.0's preparation).

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.26.0` (annotated, `973d477`) → `94f56f31327beb4e1168484f347690c5d237e1ee` (#650 on `main`), after `main` CI on that commit passed ([CI run 43947249803](https://github.com/Photivra/engine/actions/runs/43947249803); WebGPU [43947249883](https://github.com/Photivra/engine/actions/runs/43947249883)) |
| Publish workflow | [Publish npm run 43964842015](https://github.com/Photivra/engine/actions/runs/43964842015): passed, started 21:54:54 UTC |
| npm | `@photivra/engine@2.26.0`, dist-tag `latest`, registry time 22:03:20 UTC, November 16, 2026 |
| Integrity | `sha512-246tb1hsYngT9S3jn/NgiD9MCfj+gBNs0yerOMU+idcWgYitBjA6vDNRFiYJsNBs4lUqMJVeV+qSSCHCkPycbQ==` (shasum `04969f0a4357275350b7ec56902745c6922dc738`, 1,234 files) |
| GitHub release | [`v2.26.0`](https://github.com/Photivra/engine/releases/tag/v2.26.0), published 23:44:16 UTC |

## For the owner

**Decided by the owner and applied here:**
- the export kit as its own measured row;
- the on-demand limit of 49,400 B.

**Choices the owner may want to review:**
- the per-tap chart sum (#643) and the per-render defocus choice (#642) are fast defaults whose way back is `fast: false`;
- the hand-shake model keeps the engine's generic 4.39 °/s rate, so its 1/3 s displacement (about 1° RMS) is larger than a published compact-camera example (a few tenths of a degree).
