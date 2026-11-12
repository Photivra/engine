# 2.24.0 release

> **Prepared November 12, 2026; not published.** npm publishing runs only from the owner's `v2.24.0` tag ([Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.24.0`, with `ENGINE_API_VERSION = "2.24.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **One engine issue and two owner decisions:** the #607 research's "go" items for imported DNGs (NoiseProfile and Exif import, RAW clipping and noise, the RAW what-if with a cited dual-gain switch list that is empty, full color development), and two sample counts whose defaults follow the speed/accuracy flag. Also CI headroom and the external Content Credentials validation (#165).
- **Why a minor version:**
  - 28 new root exports, 1,981 → 2,009 (runtime exports 672 → 681), and new fields on the DNG import result (schema 1.2.0). Nothing is removed or changed in type.
  - Exact requests with the box pixel aperture or with motion take more samples by default ([Default changes](#default-changes)).

## Scope

This pull request is cut from `14203b7` (`v2.23.0`) and carries:

| Change | Issues | Source |
| --- | --- | --- |
| DNG NoiseProfile and Exif import, `calculateDngRawClipping`, `estimateDngRawNoise`, `assessDngRawWhatIf`/`simulateDngRawWhatIf`, `developDngImage`; the cited dual-gain switch list (`DNG_GAIN_SWITCH_CATALOG`, empty) and the denoised-file threshold 0.85 | #607 | `e224-build` (`3520c3f`): its two commits `ceac715` and `3520c3f` |
| `sensor.pixelAperture` and `sensor.temporalSampleCount` defaults follow the speed/accuracy flag | — (owner decision 2026-11-12) | this pull request |
| CI headroom: shard weights from CI times, a coverage shard of its own for the longest test file, two per-test deadlines | — (owner decision 2026-11-12) | this pull request |
| docs/CONTENT_CREDENTIALS.md: the DNG layout against c2pa-rs, and the c2patool validation | #165 | this pull request |
| 2.24.0 preparation: version surfaces, the 2.24.0 changelog entry, the 2.23.0 publication record | — | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.24.0. The #607 functions are documented in [IMPORT_AND_PNG.md](IMPORT_AND_PNG.md) and the API reference pages `docs/api/capture-dng-*.md`.

## Default changes

1. **`sensor.pixelAperture: "box"` takes 8 samples per axis on exact requests** (DNG, JPEG, PNG, the ideal reference, `fast: false`, or the box record's own `fast: false`) and 4 on fast ones (sRGB samples, the display view), as before. The fast default reports `diagnostics.fast.applied["sensor.pixelAperture.box"]: true`. Way back: `{ kind: "box", samplesPerAxis: 4 }`.
2. **The default temporal midpoints with camera rotation or subject motion are 16 on exact requests** and 8 on fast ones, as before. `sensor.temporalSampleCount` is a new key of `SIMULATE_CAPTURE_FAST_OPTIONS` (top-level flag only). Way back: `sensor.temporalSampleCount: 8`.

An explicit value always wins. Requests without the box aperture or motion, and fast requests, keep their 2.23.0 bytes.

### Measured

Error of the default counts (this tree, Apple M5 Pro, Node.js 24.19.0; RMS of the normalized sRGB-16 samples at 384 × 256, largest difference in parentheses):

| Default | Scene | Fast | Exact | Finer reference |
| --- | --- | --- | --- | --- |
| Box pixel aperture (ideal reference) | Siemens star | 6.1 × 10⁻³ (0.11) at 4 | 1.9 × 10⁻³ (0.036) at 8 | 16 × 16 |
| | dead leaves | 2.0 × 10⁻³ (0.034) | 7.3 × 10⁻⁴ (0.014) | |
| | slanted edge | 7.9 × 10⁻⁴ (0.042) | 2.4 × 10⁻⁴ (0.012) | |
| Temporal midpoints (`simulateCapture`, yaw 0.05 and pitch 0.02 rad/s, 1/15 s, 1,000 lux, one noise seed) | Siemens star | 3.1 × 10⁻² (0.43) at 8 | 1.7 × 10⁻² (0.45) at 16 | 64 (32: 8.7 × 10⁻³) |
| | dead leaves | 1.0 × 10⁻² (0.15) | 6.1 × 10⁻³ (0.071) | (32: 3.3 × 10⁻³) |
| | slanted edge | 3.8 × 10⁻³ (0.079) | 2.4 × 10⁻³ (0.038) | (32: 8.9 × 10⁻⁴) |

The temporal figures include the seeded noise's response to the changed expected values (the ideal reference has no motion).

Cost on exact requests (384 × 256 DNG of the Siemens star, median of three runs; moving cases one run each):

| Request | 2.23.0 default | 2.24.0 exact default | 2.24.0 fast default (sRGB-8) |
| --- | --- | --- | --- |
| `pixelAperture: "box"` | 78 ms (4 × 4) | 197 ms (8 × 8) | 74 ms (4 × 4) |
| camera rotation (yaw 0.05, pitch 0.02 rad/s, 1/15 s) | 1.40 s (8) | 2.03 s (16) | 1.45 s (8) |

The 2.22.0 measurement (#590, its own scenes): pixel aperture RMS 1.75 × 10⁻² / 4.1 × 10⁻³ / 1.25 × 10⁻² at 4 against 6.1 × 10⁻³ / 1.1 × 10⁻³ / 2.1 × 10⁻³ at 8, 90 ms against 242 ms for a 384 × 256 DNG; temporal 0.125 / 0.18 at 8 against 0.074 / 0.096 at 16, 25.9 s against 51.3 s for a moving 384 × 256 DNG.

## Integration

- **How #607 was brought in.** `e224-build` was built on a 2.22.0-era base (its merge base with `main` is `e3aa535`, 2.21.0), so its two own commits (`ceac715`, `3520c3f`) were cherry-picked onto `14203b7`. The only conflict was `CHANGELOG.md`: the 2.24.0 section is placed above `main`'s 2.23.0 section, and the branch's copy of the 2.22.0 heading is dropped (`main`'s published one is kept). `main`'s 2.23.0 content is unchanged.
- **#607 sizes.** The branch's size line was measured on the 2.22.0-era tree with the source WGSL; it now says only that no #607 module reaches the worker shape. The release's rows are below.
- **Sample-count defaults.** The resolver is the existing one (`resolveFast`): the box's default follows its record's `fast`, else the request's; the temporal default follows the request's. `test/fast-flag-convention.test.ts` lists the box as an option with a fast method and the temporal count as a top-level-only option.
- **Design-around check:** the #607 measurements and the what-if work per site from the file's own codes and NoiseProfile at use; the sample-count change only changes quadrature node counts. No table keyed by channel signal levels is added.

## Sizes

The app's capture-worker shape (`test/capture-bundle.test.ts`: `NATIVE_RAW_LIMITS`, `prepareDisplayView`, `serializeSimulatedCaptureDngFromParts`, `simulateCapture`, `simulateIdealReference`; rolldown 1.2.9, minified ESM with the shipped WGSL, gzip level 9).

| Tree | Fast worker | On demand | All chunks |
| --- | --- | --- | --- |
| 2.23.0 (the 2.23.0 record) | 333,322 B | 45,110 B | 378,432 B |
| **This pull request** | **333,444 B** (+122) | **45,110 B** (0) | 378,554 B |
| Limits (unchanged) | 337,500 B | 47,000 B | — |

The fast worker grows 122 B (the two defaults' resolution in `simulateCapture`); the on-demand chunks are unchanged (GPU Quality 16,514 B, CPU Quality kit 18,563 B, GPU coupled steps 5,865 B, opt-in kit 4,168 B). No limit is changed. The display view's added-size budget test passes unchanged.

## Local gates

On this tree (Apple M5 Pro, Node.js 24.19.0), one run each:

- The full test suite (`vitest run`): 4,530 tests; 4,528 passed and two failed on the new defaults (`test/ideal-reference.test.ts` expected 4 box samples on the ideal reference, `test/simulate-capture-subject-motion.test.ts` 8 exact midpoints). Both now check the new defaults and pass, with the changed files and the release-document tests (17 files, 238 tests).
- `npm run check:static`, `npm run build`, `npm run docs:check` and `npm run pack:check`: passed (`docs:check`: 381 Markdown files; `pack:check`: 1,153 files). The CI tool tests (`node --test .github/test-ci-tools.mjs .github/test-node-ci-roles.mjs`): passed.
- **CI headroom (owner decision 2026-11-12).**
  - `test/shard-weights.json` is re-recorded from the CI times of #608's last run (43174074697, all ten coverage shards passed, 410 files). On that run the shards' file time ranged 1,310–2,554 s (job times 503–946 s), because the weights came from an earlier run.
  - `test/display-view-neighbors-gpu.test.ts` (863 s on that run, 1,041 s on the run before; one test, the whole view's CPU reference with the full rule, about 40 s locally without coverage) is listed under the weights file's new `alone` key and gets a coverage shard of its own (`test/helpers/weighted-shard-sequencer.ts`, coverage runs only; tested in `test/weighted-shard-sequencer.test.ts`). The other nine shards carry about 2,116 s of file time each by the recorded weights. The Node test parts are split as before (the file takes about 40 s there).
  - **First CI run of this pull request** ([run 43241402441](https://github.com/Photivra/engine/actions/runs/43241402441)): every check passed except `coverage shard (3/10)`, which reached the 20-minute limit (no test failed; it held `test/simulate-capture-lens-catalogue.test.ts`, 827 s under coverage on #608's run, with the two display-view catalogue files and `test/large-defocus.test.ts`). The shard with the region-order file alone took 15.5 minutes (876 s for the file). Changes: `test/simulate-capture-lens-catalogue.test.ts` is split by test into two files with the same eleven tests (sharpness, coma and lateral color stay; distortion, vignetting, the fisheyes and the options move to `test/simulate-capture-lens-catalogue-2.test.ts`; the chart helpers to `test/helpers/lens-catalogue-charts.ts`), weighted 512 s and 315 s from the per-test times; and the weights take that run's CI times for the 367 files of its nine finished shards. By the weights each of the other nine shards now carries about 1,813 s of file time.
  - `test/binomial-sample.test.ts`: `scaledTimeout(60_000)` per test (the 10,000,000-trial case took up to 7 s under coverage, and a test part on Node 22.13.0 hit the 5 s default once). `test/display-view-coupled-gpu-reconstruct.test.ts`: `scaledTimeout(900_000)` (561 s under coverage; its 300 s deadline ran out once on a Node 22.13.0 test part).
  - The exact-path default changes do not lengthen the suite: its box and moving cases pass explicit counts. A full local run took 3,219 s of file time on 2.23.0 and 3,071 s on this tree; no test was more than 1.4× slower except one defocus emulation case (3.2 → 14.3 s, run-to-run variation: 3 s in a run of that file alone).
  - No test was removed and no job time limit was raised.

## Pending (after release)

- **Phone sample DNGs (#598):** unchanged from 2.22.0.
- **Dual-gain switch points (#607):** `DNG_GAIN_SWITCH_CATALOG` ships empty (owner decision); a higher-ISO what-if needs the caller's `highGainFromIso` until a cited entry is added.
- **A device-side harmonic fill (#605):** unchanged from 2.23.0.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.24.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] #607 brought onto `14203b7`.
- [x] Version surfaces aligned at 2.24.0 (`npm run release:prepare -- 2.24.0`). Root exports 2,009.
- [x] 2.23.0 recorded as published ([2.23.0 release record](RELEASE_2_23_0.md#publication)).
- [x] The worker rows measured ([Sizes](#sizes)); no limit raised.
- [ ] Green CI on this pull request, then on `main` after merge.
- [ ] The owner's approval to tag `v2.24.0`.
- [ ] The `v2.24.0` tag on the `main` commit that merges this record.
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.

## For the owner

Decided by the owner and applied here: #607's go items with an empty dual-gain switch list and the 0.85 threshold, no fast flag for the measurements and the what-if; the two sample counts follow the flag; the CI headroom items. Choices the owner may want to review: the box's default follows its own record's `fast` as well as the request's (as the other record flags do), while the temporal default follows only the request's flag (it has no record; a `motion.subject` record's `fast` still controls #551's shorter count); `SIMULATE_CAPTURE_BOX_APERTURE_DEFAULT_SAMPLES` stays 4 (the fast default) and the exact default 8 is not a new root export; the longest coverage file gets a shard of its own within the ten shards rather than an eleventh shard.
