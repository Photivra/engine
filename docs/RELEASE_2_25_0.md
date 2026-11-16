# 2.25.0 release

> **Published November 16, 2026 (17:47 UTC).** The `v2.25.0` tag is on `f323ebb` (`main` after #634 and #644), after `main` CI on that commit had passed; npm publishing ran from the tag ([Publication](#publication)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.25.0`, with `ENGINE_API_VERSION = "2.25.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **26 engine issues (#612–#633 and #635–#638, milestone 2.25.0):** standalone helpers (equivalent ISO, program line, sensor figures, exposure helpers); a JPEG and HEIC/HEIF metadata reader, more DNG import fields and sensor equivalence from a stated 35 mm focal length; a DNG writer, a JPEG Exif writer and a half-size DNG preview; a front-of-lens filter in captures and the display view; look constants and a pinned mid-gray; catalogue-lens work (fisheye chart framing, veiling glare and focus breathing, diffraction correction, the box aperture's fast method, a faster exact PSF, lens corrections and sharpening in the display view); faster defocused display views; a second review of the dual-gain switch points; the repository-link check; and sensor-profile work (each profile's ISO list, framing the phone lenses before a capture, the fixed pattern on downsized views, and the full well's reference with a profile).
- **Why a minor version:**
  - 72 new root exports, 2,009 → 2,081 (runtime exports 681 → 708), new options and new fields on the DNG import result (schema 1.2.0 → 1.3.0). Nothing is removed or changed in type.
  - Some fast requests take a new method by default, and a linked full well with a sensor profile is read at the profile's photosite ([Default changes](#default-changes)).
- **Size limits raised (owner decision 2026-11-16):** the capture worker's fast row to 338,900 B and its on-demand row to 47,400 B ([Sizes](#sizes)).

## Scope

This pull request is cut from `fa15176` (`main` after `v2.24.0`, #610 and #611) and carries the `release-2.25.0` integration branch:

| Change | Issues | Source |
| --- | --- | --- |
| Defocused display views: the material kernel sums found in constant time (bit-identical); the regrouped defocus disc as the view's fast default | #612 | `c942bd5`, `b78d098` (`e225-defocus-fast`) |
| `calculateFormatEquivalentIso`, `calculateProgramLine`, `calculateSensorFigures`, `calculateSunnySixteenExposure`, `calculateStandardExposure`, `calculateFreezeShutterSpeed`, `SUNNY_SIXTEEN_CONDITIONS`, `NAMED_LIGHT_LEVELS` | #613–#616 | `244ec64` (`e225-helpers`) |
| `parsePhotoMetadata` (JPEG and HEIC/HEIF headers), DNG import fields (schema 1.3.0), `calculateImagingAreaFromFocalLength35Mm` and `calculateSensorEquivalenceFromFocalLength35Mm` | #617–#619 | `211ec12` (`e225-metadata`) |
| `serializeRewrittenDng` (DNG writer with a tag allowlist) | #620 | `90c8566` (`e225-w620`, via `e225-writers`) |
| `setJpegExifCaptureSettings`, `resolveJpegExifCaptureSettings`; `STANDARD_LOOK`, `FLAT_LOOK`, `resolveMidGrayPinnedLook`; the gain-switch source review (catalog still empty) | #621, #623, #625, #626 | `fc70ff3` (`e225-writers`) |
| `developDngImage(raw, { size: "half" })` | #622 | `2a83bc4` (`e225-w622`, via `e225-writers`) |
| `lens.filter` (front-of-lens filters) in captures, the ideal reference and the display view | #624 | `941bfb3` (`e225-w624`, via `e225-writers`) |
| `npm run check:identity` fails on links to the repository's former name | #627 | `9bd4e82` (`e225-writers`) |
| Display view `output.lensCorrections` and `output.sharpening`; the catalogue fast method with the box pixel aperture; the faster exact catalogue PSF | #628, #629, #633 | `2b8fcae` (`e225-lens-render`) |
| `output.diffractionCorrection` with `lens.catalogue` | #630 | `2c81281` |
| Catalogue fisheye chart framing; opt-in veiling glare and focus breathing | #631, #632 | `e445b6b`, `13d57a3` |
| Renames before release (no published name changes); root-export test classification | — | `fe9e7dc`, `39833c2` |
| Capture-worker size limits raised | — (owner decision 2026-11-16) | `8939cfa` |
| `SENSOR_PROFILE_ISO_MARKINGS`, `resolveSensorProfileIsoSettings`; `calculateSensorProfileFrame` and `sensorProfile` in the framing helpers; the fixed pattern on downsized views; the full well's reference and density note with a profile | #635–#638 | `e225-sensors` |
| 2.25.0 preparation: version surfaces (`26ac438`), the 2.25.0 changelog heading, this record, the 2.24.0 publication record | — | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.25.0, one section per issue. The new functions are documented in [USAGE.md](USAGE.md), [IMPORT_AND_PNG.md](IMPORT_AND_PNG.md), [LENS_CATALOGUE.md](LENS_CATALOGUE.md), [DISPLAY_VIEW.md](DISPLAY_VIEW.md) and the generated [API reference](API_REFERENCE.md).

## New exports

72 root exports (27 runtime, 45 types); nothing is removed and no existing export changes kind.

| Issues | Runtime exports | Types |
| --- | --- | --- |
| #613–#616 | `calculateFormatEquivalentIso`, `calculateProgramLine`, `calculateSensorFigures`, `calculateSunnySixteenExposure`, `calculateStandardExposure`, `calculateFreezeShutterSpeed`, `SUNNY_SIXTEEN_CONDITIONS`, `NAMED_LIGHT_LEVELS` | their inputs and results, `ProgramLineNode`, `ProgramLineSelection`, `NamedLightLevel`, `NamedLightLevelRecord`, `SunnySixteenCondition` |
| #617–#619 | `parsePhotoMetadata`, `PHOTO_METADATA_SCHEMA_VERSION`, `PHOTO_METADATA_LIMITS`, `PHOTO_METADATA_XMP_NAMESPACES`, `calculateImagingAreaFromFocalLength35Mm`, `calculateSensorEquivalenceFromFocalLength35Mm` | `PhotoMetadata`, `PhotoMetadataInput`, `PhotoExif`, `PhotoExtraImage`, `PhotoExtraImageKind`, `PhotoAnnotation`, `ExifCaptureFields`, `ExifSubjectArea`, `ExifFocalPlaneResolution`, `ImportedDngEnhancedImage`, `StatedValueInterval` and the two functions' inputs and results |
| #620 | `serializeRewrittenDng`, `DNG_REWRITE_SCHEMA_VERSION`, `DNG_REWRITE_LIMITS`, `DNG_REWRITE_ALLOWED_TAGS` | `DngRewriteInput`, `DngRewriteEdits`, `RewrittenDng` |
| #621 | `setJpegExifCaptureSettings`, `resolveJpegExifCaptureSettings`, `JPEG_EXIF_CAPTURE_SETTING_KEYS` | `JpegExifCaptureSettings`, `JpegExifDateTaken` |
| #624 | — | `SimulateCaptureLensFilterReport` |
| #625, #626 | `STANDARD_LOOK`, `FLAT_LOOK`, `resolveMidGrayPinnedLook` | `NakaRushtonLook`, `PinLookMidGrayOptions` |
| #631 | — | `SubjectFramingCatalogueLens`, `SubjectFramingLens` |
| #635, #636 | `SENSOR_PROFILE_ISO_MARKINGS`, `resolveSensorProfileIsoSettings`, `calculateSensorProfileFrame` | `CalculateSensorProfileFrameInput`, `SensorProfileFrame`, `SubjectFramingSensorProfile` |

`ImportedDngExif` and `ImportedDngSubjectArea` are now aliases of `ExifCaptureFields` and `ExifSubjectArea` (the same shape, with four new fields). New options on existing functions: `lens.filter` (#624), `lens.catalogue.flare` and `breathing` (#632), `catalogue` in the framing helpers (#631), `size` in `developDngImage` (#622), and `output.lensCorrections`, `output.sharpening` in the display view (#628) and `output.diffractionCorrection` with `lens.catalogue` (#630), which were refused before; `sensorProfile` in `calculateSubjectDistanceForFraming` and `calculateChartFraming` (#636); `sensor.fixedPatternNoise` on a sensor profile's downsized view (#637), refused before.

### Renames before release

Three functions added in this release were renamed into the documented verb families ([API_STYLE.md](API_STYLE.md), "Public function verb families") before any of them was published, so no published name changes: `pinLookMidGray` → `resolveMidGrayPinnedLook`, `rewriteDng` → `serializeRewrittenDng`, `jpegExifCaptureSettingsFromFields` → `resolveJpegExifCaptureSettings` (`fe9e7dc`). The `DNG_REWRITE_*` constants and the `DngRewrite*` and `PinLookMidGrayOptions` types keep their names.

## Default changes

1. **Defocused display views on the CPU regroup a wide defocus disc (#612, `lens.defocus/view-regrouped`).** On a fast request (the display view's default), a plain geometric disc much wider than the diffraction kernel ((2R_c + 1)² > 4·(2R_f + 1)²) is applied after each channel's in-focus signal at any radius (2.24.0 did so only at a combined radius above 64 sites). Defocus of a plane is the same at every spectral node, so this is the same sum regrouped; only rounding differs (expected electrons within 10⁻⁹ relative, samples within one code; on the measured Guide regions the samples are identical). `fast: false`, the GPU, shaped bokeh kernels and the lens path keep the combined kernels. Way back: `fast: false` (which also selects the other exact methods).
2. **Fast catalogue-lens captures with the box pixel aperture take the field-grid method (#629).** 2.24.0 ran the exact method for `lens.catalogue` with `sensor.pixelAperture` "box"; the fast method now folds the box into the scene before the PSF taps, with one blended kernel per site for its N² nodes (measured against each node's own exact kernel: at most 8.3 × 10⁻⁴ of the peak; [LENS_CATALOGUE.md](LENS_CATALOGUE.md), "The box pixel aperture"). Exact requests are unchanged. Way back: `lens: { catalogue: { kind, fast: false } }`.
3. **A fisheye capture's chart report is the projected coverage (#631, a correction).** `result.scene.chart` with `chartSize` reported the thin-lens coverage through a catalogue fisheye; it now reports the coverage through the equisolid projection and distortion (1 m chart at 1 m on full frame through *PV 15 2.8 Fisheye Pro*: 41.1 % of the width, not 42.3 %). The image is unchanged. No way back (the old figure was wrong).
4. **The new half-size DNG preview defaults to the fast method (#622, `developDngImage/size.half`).** `size` itself defaults to `"full"`, which is byte for byte 2.24.0's development. With `size: "half"`, `"srgb-8"` and `"srgb-16"` bin each 2 × 2 CFA repeat into one pixel by default; `fast: false` averages the full-size exact development over 2 × 2 blocks in linear light. The binned preview is an approximation for viewing (Siemens star 99th percentile 0.72 in linear light against the exact half size, at its aliased center); save at full size.

5. **A linked full well with a sensor profile is the profile's photosite's (#638, a correction).** `sensor.fullWell` with `sensor.profile` and the default `link: "pixel-area"` was read at a 6 µm reference photosite: the medium-format profile's own 50,300 e⁻ gave a 19,753 e⁻ photosite and a RAW signal 1.79 times higher (`sensitivityOffsetStops` 1.35; the phone profile's own 8,600 e⁻: 342 e⁻, +4.65 stops). `referencePixelPitchMicrometers` now defaults to the profile's own pitch, so the profile's own full well changes nothing. The "unusual for the pitch" note uses the photosite's charge per µm². Tiers are unchanged. Way back: `referencePixelPitchMicrometers: 6`.

Every request without these options or combinations keeps its 2.24.0 bytes; `test/lens-catalogue-optics-pins.test.ts` and `test/program-line-lens-range.test.ts` check SHA-256 pins recorded before the changes, and `test/dng-development-half.test.ts` checks the full-size development against 2.24.0-era digests; `test/sensor-profile-pins.test.ts` pins profile and tier captures without #637 and #638's options (digests recorded on `087dc6f3`).

## Integration

- **How the issues were brought in.** Each group was built on its own branch from `release-2.25.0` and merged back into it; the branch's base is `fa15176` (`main`), so no cherry-pick was needed and `main`'s 2.24.0 content is unchanged. The writers group (`e225-writers`) merged `e225-w620`, `e225-w622` and `e225-w624` first; the lens-render group (`e225-lens-render`) merged the release branch before it was merged.
- **Root export counts.** The changelog's per-group counts add up: 21 (#617–#619), 25 (#613–#616), 18 (#620–#626) and 2 (#631), 66 in all.
- **An accidental file.** A worktree's `node_modules` symlink had been committed on the lens-render branch; `a0c7b39` removes it and ignores `node_modules` links.
- **Sensor profiles (#635–#638).** Built on `e225-sensors` from `release-2.25.0` at `087dc6f3`.
- **Design-around check:** the filter (#624) multiplies the lens transmission per wavelength and each site integrates through it; the veiling glare (#632) and the regrouped defocus (#612) integrate each site with its own channel response; the half-size preview (#622) bins per-site sums; the summed fixed pattern (#637) draws each site's values once from the summed statistics. No table keyed by channel signal levels is added.

## Sizes

The app's capture-worker shape (`test/capture-bundle.test.ts`: `NATIVE_RAW_LIMITS`, `prepareDisplayView`, `serializeSimulatedCaptureDngFromParts`, `simulateCapture`, `simulateIdealReference`; rolldown 1.2.9, minified ESM with the shipped WGSL, gzip level 9).

| Tree | Fast worker | On demand | All chunks |
| --- | --- | --- | --- |
| 2.24.0 (the 2.24.0 record) | 333,444 B | 45,110 B | 378,554 B |
| **This pull request** (measured on `8939cfa`) | **338,815 B** (+5,371) | **47,358 B** (+2,248) | 386,173 B |
| With #635–#638 (`e225-sensors`) | **338,890 B** (+75) | **47,366 B** (+8) | 386,256 B |
| Limits | 338,900 B (337,500 B before) | 47,400 B (47,000 B before) | — |

- **Where the growth is.** #624's `parseFrontOfLensFilterProfile` in the first load (+618 B fast; the rest of the filter is in the opt-in kit); #628's display-view correction and sharpening hook and #631/#632's framing, glare and breathing code. The display view's correction and sharpening code is in the opt-in kit and takes the renderer's functions as arguments, so the kit never imports the renderer. The new standalone helpers, readers and writers are not in the worker.
- **The limits (owner decision 2026-11-16).** With #628–#633 alone the worker measured 337,486 B and 46,952 B (14 B and 48 B under the old limits); merged with #631/#632 it measured 338,815 B and 47,358 B. The owner approved raising both limits to those measurements rounded up to the next 100 B: 338,900 B and 47,400 B (`test/capture-bundle.test.ts`, docs/DISPLAY_VIEW.md). Headroom left: 85 B and 42 B.
- **#635–#638 within the limits.** The ISO list (#635) adds 8 B on demand (the body builder uses the same list function); the frame function (#636) replaces the capture's inline frame code; the framing helpers and `calculateSensorProfileFrame` are not in the worker. The summed fixed pattern (#637) and the full well's reference and density note (#638) are in the first load (+159 B and +9 B); four refusal messages were shortened to make room (`lens.defocus` with a rolling shutter, `simulateIdealReference`'s output formats, `output.region` with diffraction correction or sharpening, `lens.catalogue` with lens options), each keeping the request it names and its remedy. Headroom left: 10 B and 34 B; the limits are unchanged.

## Local gates

On this tree (Apple M5 Pro, Node.js 26.13.1, a heavily loaded machine, load average 225–860 from other jobs), one run each:

- `npm run check:static` (lint, typecheck, licence, SPDX-header, identity and browser-surface gates), `npm run build`, `npm run docs:check` (391 Markdown files, 3,609 links, 175 importing examples) and `npm run pack:check` (1,207 files): passed. `node scripts/generate-api-reference.mjs`: no change (2,075 root symbols across 238 modules).
- `npm run release:consumer-check`: the first run stopped when one packed example (`docs/DISPLAY_VIEW.md`, block 0) passed the script's 30 s per-example limit under the load; with that limit raised locally (not committed) every check passed (175 typed and running doc snippets, the quick-start, simulate-capture and production consumers) in 616 s.
- Release, size and export tests (`test/release-sequence.test.ts`, `test/capture-bundle.test.ts`, `test/root-export-input-errors.test.ts`, `test/fast-flag-convention.test.ts`, `test/on-demand-kits.test.ts`, `test/production-capture-release-binding.test.ts`, `test/release-capabilities-rejections.test.ts`): 7 files, 90 tests passed; the worker rows are within the raised limits.
- Not run locally: the full test suite (`vitest run`, 431 files) and `npm run coverage`. They run on this pull request's CI (the Node legs, the ten coverage shards and the WebGPU suite).

## Known limits

- **Dual-gain switch points (#623):** `DNG_GAIN_SWITCH_CATALOG` is still empty. The second review found one stated switch point (the Blackmagic Pocket Cinema Camera manual: ISO 1,250 and above use the second native ISO), but the Make and Model tags of those cameras could not be checked on a public file, so no entry was added ([THIRD_PARTY.md](../THIRD_PARTY.md), "Dual-gain switch points"). A higher-ISO what-if still needs the caller's `highGainFromIso`.
- **Ghosts are not rendered (#632):** the catalogue gives a ghost's power, but not its position, size, shape or color; the `lens.catalogue.flare` assumption says so. The veiling glare needs a still camera and a chart or material scene under uniform light, and `breathing` is not available with `motion.subject`.
- **Display view (#628):** `output.diffractionCorrection` is still refused, and so is the vignetting correction with `highlightMode` `"reconstruct"`/`"reconstruct-neighbors"` or `gamutHandling: "desaturate-to-luminance"`. Lens corrections and sharpening run on the CPU (`gpu: "auto"` falls back). The sharpened view's noise reads about 12 % high at 1:1 (the noise gain treats pixels as independent).
- **Diffraction correction with catalogue lenses (#630):** inverts the diffraction of the lens's uniform circular pupil only, not its aberrations.
- **Half-size preview (#622):** binned red and blue sit half a site off center (largest differences at patch edges and aliased detail); the stage image still runs at full size.
- **Photo metadata (#617):** headers only; no pixels are decoded, and maker notes and GPS data are never read.

## Pending (after release)

- **Phone sample DNGs (#598):** unchanged from 2.22.0.
- **Dual-gain switch points (#623):** an entry for the Blackmagic cameras once a file confirms their tag strings.
- **A device-side harmonic fill (#605):** unchanged from 2.23.0.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.25.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] #612–#633 merged into `release-2.25.0` on `fa15176`.
- [x] Version surfaces aligned at 2.25.0 (`npm run release:prepare -- 2.25.0`). Root exports 2,075.
- [x] 2.24.0 recorded as published ([2.24.0 release record](RELEASE_2_24_0.md#publication)).
- [x] The worker rows measured ([Sizes](#sizes)); limits raised by owner decision (2026-11-16).
- [x] Green CI on this pull request, then on `main` ([CI run 43916774347](https://github.com/Photivra/engine/actions/runs/43916774347) on `f323ebb`).
- [x] The owner's approval to tag `v2.25.0`.
- [x] The `v2.25.0` tag on `f323ebb` ([Publication](#publication)).
- [x] After publication:
  - [x] npm version, dist-tag, integrity and provenance verified;
  - [x] GitHub release notes published;
  - [x] publication dates updated in `CHANGELOG.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record (in the 2.26.0 preparation).
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.25.0` (annotated, `3430151`) → `f323ebb3684fa8c5ccdb152a0236c6b96cb61847` (#644 on `main` after #634), after `main` CI on that commit passed ([CI run 43916774347](https://github.com/Photivra/engine/actions/runs/43916774347); WebGPU [43916775631](https://github.com/Photivra/engine/actions/runs/43916775631)) |
| Publish workflow | [Publish npm run 43917325798](https://github.com/Photivra/engine/actions/runs/43917325798): passed, started 17:42:15 UTC |
| npm | `@photivra/engine@2.25.0`, dist-tag `latest`, registry time 17:47:42 UTC, November 16, 2026 |
| Integrity | `sha512-sfc94fz9FMCViZqAsBiV3ZU7XEUm0egLsb1G7jjZ4ImyI8BXvlRH6MbOQW9nkcXjv6OS1bXOCoJRAMLILzMVGQ==` (shasum `50177dae8fad2b0035625af55abb88e028c4ca37`, 1,211 files) |
| Provenance | The registry lists an attestation (SLSA v1) for 2.25.0 |
| GitHub release | [`v2.25.0`](https://github.com/Photivra/engine/releases/tag/v2.25.0), published 17:45:33 UTC |

## For the owner

Decided by the owner and applied here: the raised capture-worker limits (338,900 B and 47,400 B); the gain-switch catalog stays empty without a verifiable entry. Choices the owner may want to review: the regrouped defocus (#612) and the box aperture's catalogue fast method (#629) are fast defaults whose only way back is the request's or the lens record's `fast: false`; the half-size preview (#622) takes the binned fast method by default for sRGB output; ghosts are reported and not rendered (#632).
