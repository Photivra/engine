# 2.10.0 release

> **Published October 27, 2026.** The owner tagged `v2.10.0` on `ce58a3e` (#470) after `main` CI on that commit had passed, and published the GitHub release. npm publishing ran from the tag.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.10.0`, with `ENGINE_API_VERSION = "2.10.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** new root exports and request fields: the exact-or-fast flag (`fast`, `SIMULATE_CAPTURE_FAST_OPTIONS`, `SimulateCaptureFastOption`, `SimulateCaptureFastReport`, `SimulateCaptureDemosaicRecord`; #434) and the display view's AHD correction-state export and import (`serializeDisplayViewCorrectionStates`, `bindDisplayViewCorrectionStates`, `DisplayViewCorrectionStateSet`, `DisplayViewCorrectionStateKeys`, and three `PreparedDisplayView` methods; #468). Nothing is removed. `lens.diffraction`'s `aperture` key is deprecated, still accepted with the same result until 3.0.0.
- **Same results:** in all 24 fingerprinted results, every sample, RAW code and file (PNG, JPEG, DNG) equals 2.9.0's, with only the engine version normalized. The 3 `simulateIdealReference` results are identical whole. The 18 captures and 3 display views differ from 2.9.0 in one field only: the new `diagnostics.fast` report (#434). No hash lock changed.

## Scope

Every pull request merged since `v2.9.0` (`git log v2.9.0..origin/main`):

| Change | Pull request |
| --- | --- |
| Record the 2.9.0 publication (documentation only) | #439 |
| One exact-or-fast flag for every slow option (#395, stage 2); still exact; `aperture` key deprecated | #434 |
| Display view: benchmark and validation set F on a device-pixel request (#454) | #456 |
| Display view prepare: the channel response runs the sensor chain once per channel (#443) | #458 |
| AHD demosaic: interior fast path and allocation-free homogeneity loop (#448) | #459 |
| Portable three-argument `hypot3`: V8's bits in every JavaScript engine (#452) | #460 |
| Diffraction kernels kept by value: ISO, white-balance and shutter changes reuse them (#446) | #461 |
| Display view exact path: a per-render site ring (#441) | #462 |
| Capture set-up caches and a leaner tabulated RAW loop (#449, first part) | #463 |
| Display view render loop: typed and flat per-render tables (#442) | #464 |
| Expected signal: a filled window's lookup count once per group shape (#445) | #465 |
| Display view without diffraction: one-material samples replayed on the Speed path (#444) | #466 |
| Expected signal: chart-material tables kept by content across inputs (#449, second part) | #467 |
| Display view: serialize, bind, collect and compute of the AHD correction states (#447) | #468 |
| Tabulated RAW verification sites: engine-owned chain execution and material lattice fill (#453, options a and b) | #469 |

Out of scope: the Quality display-view noise limit (#379) and the Quality AHD colour error at the Siemens star's centre (#457) are unchanged from 2.9.0; see [Known issues](#known-issues). Per-frame verification (option c of #453) is not implemented, by the owner's decision.

## What changed, with evidence

The figures below are quoted from the changelog entries of each pull request. Each measurement compares the change with the build before it, in Node 24.21.0 on one thread of a 4-vCPU Xeon; browser wall time is not measured for any of them.

### One exact-or-fast flag for every slow option (#434, issue #395 stage 2)

**Change:**
- `fast?: boolean` on the `simulateCapture` request (and so on `simulateDisplayView` and `prepareDisplayView`). `false` or omitted is exact, the engine reference; `true` asks each listed option for its fast method, a measured, bounded approximation. An option's record `fast` overrides the top-level flag for that option only.
- `SIMULATE_CAPTURE_FAST_OPTIONS` lists `lens.diffraction`, `sensor.antiAliasing`, `sensor.pixelAperture.box` and `output.demosaic.ahd`. `lens.diffraction` takes `{ kind: "circular-aperture", kernelRadiusSamples?, fast? }`, `output.demosaic` takes a new record form `{ kind: "bilinear" | "ahd", fast? }`, and the `sensor.antiAliasing` and `sensor.pixelAperture` records gain `fast?`.
- Captures and display views carry `diagnostics.fast = { requested, applied, assurance }`. The WebGPU image-kernel execution record gains `fast`.

**Values:** no option has a fast method yet, so every request gives the same samples, RAW and files as before. `test/fast-flag-convention.test.ts` checks each listed option with the flag on, off and overridden, and enforces the convention in `docs/API_STYLE.md`, "Exact and fast modes".

### Display view: benchmark and validation set F on a device-pixel request (#456, issue #454)

**Change:** measurement and documentation only. `node scripts/benchmark-display-view.mjs --app` times a 2028 × 1352 view of a 24 MP, 6 µm frame in 96 × 96 parts, in Speed and Quality at f/8 and f/11. `node scripts/validate-display-view.mjs --set F` checks the view at device-pixel widths on the full-frame (2028 wide) and medium-format (4000 wide) sensors.

**Values:** Speed passes every limit of set F. Quality misses two, recorded in `docs/DISPLAY_VIEW.md` and `docs/validation/display-view-2026-10-26/`: the predicted noise is 1.13–1.20 of the reference's (#379), and at the Siemens star's centre the view's AHD result differs from the capture's by 5.1 codes RMS, at most 34 (full frame; #457). A new test checks that parts of a prepared device-pixel view equal separate `simulateDisplayView` calls, by SHA-256.

### Display view prepare: the channel response once per channel (#458, issue #443)

**Change:** the channel response ran the facade's environment chain once per spectral node and channel (63 runs on a 20 nm request); it now runs it once per channel, with unit radiance at every node. Its cache is keyed without the scene bindings, so a chart, illuminant or illuminance change reuses it.

**Values:** identical (SHA-256) to the previous build on 84 cases. `test/channel-response.test.ts` compares each node's value with the earlier one-node runs (`Object.is`).

**Measured:** `prepareDisplayView` after an aperture change 378–430 ms → 54–67 ms in Quality and 110–142 ms → 15–19 ms in Speed; after a chart change 379–435 → 34–39 ms and 108–115 → 6–7 ms.

### AHD demosaic: interior fast path (#459, issue #448)

**Change:** interior sites read their neighbours by direct index offsets instead of the reflect-101 mapping; the homogeneity loop allocates nothing per pixel. Every floating-point expression keeps its operands, order and grouping.

**Values:** `test/processing-ahd-exactness.test.ts` compares `data` and `direction` bit for bit with a copy of the previous algorithm and locks hashes recorded before the change. RAW codes, samples and PNG bytes are identical (SHA-256) for Quality captures.

**Measured:** the demosaic stage of a 1024² Quality region of a 24 MP frame 594–678 ms → 350–361 ms (−40 %). Display views, the preview and the Speed preset (bilinear) do not run this task.

### Portable three-argument `hypot3` (#460, issue #452)

**Change:** the capture's three-argument norms use an internal `hypot3`: V8's own `Math.hypot` sequence written as correctly rounded operations. On V8 (Node, Chromium) every capture, RAW code, file and display view is unchanged; on JavaScriptCore and SpiderMonkey the query points move to V8's bits where their `Math.hypot` differs. This is a portability change, not a speed-up.

**Values:** `test/portable-hypot3.test.ts` locks fixed bits in every engine and, on V8, compares `hypot3` with `Math.hypot` on 10^6 seeded triples (0 differences).

### Diffraction kernels kept by value (#461, issue #446)

**Change:** the per-node site diffraction kernels were cached by the identity of the PSF record, which the facade builds anew for every request. They are now kept by value, so an ISO, white-balance or shutter change reuses them.

**Values:** `test/site-diffraction-kernel-cache.test.ts` checks that kept and freshly resolved kernels are equal element by element (`Object.is`) and that prepares and captures after a change render the bytes of a cold run.

**Measured:** `prepareDisplayView` after an ISO change 37–45 → 9–16 ms at 6 µm f/11, 76–84 → 10–12 ms at 6 µm f/22 and 241–276 → 15–19 ms at 1.4 µm f/11.

### Display view exact path: a per-render site ring (#462, issue #441)

**Change:** with diffraction, each native site's expected electrons, chart material and readout moments are kept in a per-render ring after their first read, instead of being read again for each of the about 25 real pixels that read the site.

**Values:** identical (SHA-256) to the previous build on 224 renders; `test/display-view-site-ring.test.ts` checks overlapping and adjacent parts in both orders and concurrently.

**Measured:** Quality part medians 169–194 → 148–164 ms at f/8 and 177–187 → 154–164 ms at f/11 (−8 to −14 %); Speed, where the ring is not used, within ±3 %.

### Capture set-up caches and a leaner tabulated RAW loop (#463, issue #449 first part)

**Change:** diffraction profiles are kept across calls by the content of their input (the last 8); metering reads its colour-matching values from a table built once; the tabulated RAW loop reads a global shutter's exposure window once per region and the sensor stage's readout constants once per phase.

**Values:** RAW codes, samples, PNG and DNG bytes, diagnostics without timings and assumptions are identical (SHA-256) to the previous build; `test/capture-set-up-caches.test.ts` and `test/native-site-readout-flat.test.ts` are new.

**Measured:** the app's Quality 96 × 64 detail tile median 128 → 115 ms; the 192 × 128 box and a 1024² Quality region within ±3 %.

### Display view render loop: typed and flat tables (#464, issue #442)

**Change:** per-render readout tables are typed arrays, candidate tables are flat, and site window offsets come from two `Int32Array`s, so V8 keeps its optimized code.

**Values:** identical (SHA-256) to the previous build on the 224-render set of #441.

**Measured:** Quality part medians 148–156 → 143 ms at f/8 and 154–155 → 149–151 ms at f/11 (−3 to −8 %); Speed 84–87 → 79–81 ms at f/8 and 83–91 → 80–84 ms at f/11 (−4 to −7 %).

### Expected signal: a filled window's lookup count once per group shape (#465, issue #445)

**Change:** `diagnostics.sceneLookups` (and the capture's tabulated `providerEvaluationCount`) for a lattice group shaped like an earlier one takes that group's count.

**Values:** samples, every diagnostic (`sceneLookups` compared explicitly) and the assumptions are identical (SHA-256); `test/expected-signal-lookup-count.test.ts` compares the counts with the previous algorithm and a brute-force count.

**Measured:** Quality part medians 149–152 → 132–144 ms at f/8 and 155–158 → 138–156 ms at f/11 (−3 to −11 %); Speed unchanged.

### Display view without diffraction: one-material samples replayed (#466, issue #444)

**Change:** on the Speed path a site now records whether all its query points read one chart material, so the one-material memo applies there too. Radiance scenes are not tracked.

**Values:** identical (SHA-256) to the previous build on 120 regions of 28 requests; `test/display-view-speed-material.test.ts` locks five Speed renders to hashes recorded before the change.

**Measured:** Speed whole-view CPU, extrapolated from the sampled parts, 31.2–32.1 → 29.1–32.0 s at f/8 and 31.0–31.8 → 28.8–30.1 s at f/11 (up to −9 %). **Slower:** the Siemens-star centre part, whose samples read two materials and are never replayed: 230–342 → 246–341 ms at f/8 and 202–262 → 234–271 ms at f/11. Quality is unchanged.

### Expected signal: chart-material tables kept by content (#467, issue #449 second part)

**Change:** for chart materials and caller material scenes, the tabulated RAW path's expected-signal tables are kept by their content (every number they are built from, compared bit for bit; the last 4), so region parts and detail tiles of one request reuse them. Each call keeps its own window state.

**Values:** RAW codes, samples, PNG and DNG bytes, diagnostics without timings (including `providerEvaluationCount` and `sceneLookups`) and assumptions are identical (SHA-256) to the previous build.

**Measured:** the app's Quality 96 × 64 detail tile median 116 → 95 ms; the 192 × 128 detail box median 160 → 153 ms. The first call per settings still builds the tables.

### Display view: the AHD correction states shared between workers (#468, issue #447)

**Why:** each correction state costs 27–30 ms, and each Web Worker of an app computed the same states again: 897 states for one 48 × 48 part at the centre of the app's Quality view at 6 µm ISO 400.

**Change:** `serializeDisplayViewCorrectionStates()` returns one `{ key, gridKeys, values }` entry per cached setup (transferable typed arrays, 28 bytes per state). `bindDisplayViewCorrectionStates(entries)` adds the states a setup does not hold yet, after checking every entry; a malformed entry fails with `InvalidConfigurationError` and leaves the cache unchanged. `PreparedDisplayView` gains `correctionKey()`, `collectCorrectionStates(view)` and `computeCorrectionStates(gridKeys, { signal })`.

**Values:** renders are unchanged; 12 renders are identical (SHA-256) to the previous build, also when their states are collected, computed in two halves, exchanged and imported in reversed order.

**Measured:** the per-state cost is unchanged. No speed-up is claimed: any gain depends on the app's workers splitting and exchanging the states (Photivra/apps#113), which has to be measured in the browser.

### Tabulated RAW verification sites: less re-validation, material lattice fill (#469, issue #453)

**Why:** every tabulated `simulateCapture` call runs one site of each CFA phase through the environment chain to verify the tabulated electrons. That chain re-validated, at each of its 656 queries per site (the app's Quality request), records the engine had built and already validated.

**Change:**
- The verification runs through an internal engine-owned execution: the first query runs every check as before; later queries keep every per-query check (result values, request and result identities, wavelength basis, transmission, filters, field throughput, finite irradiance) and skip only those re-validations.
- With diffraction, for chart presets and caller material scenes the verification's convolution looks each lattice point's material up once and takes each node's value from one `materialRadiance` call per material, and the convolutions of a band share one validation of their geometry. Radiance and reflectance function scenes keep the per-point fill.

**Values:** RAW codes, samples, PNG bytes, diagnostics without timings (including `providerEvaluationCount` and `sceneLookups`) and assumptions are identical (SHA-256) to the previous build. `test/tabulated-verification-chain.test.ts` checks that each tabulated call runs the chain at exactly four sites with photo signals equal to the full executor's bit for bit, that a tabulated signal off by 10⁻⁶ relative is rejected (the capture then gives the environment path's bytes), and that the material fill equals the per-point fill bit for bit.

**Measured:** the verification span median 43.2 → 27.0 ms on the app's Quality 96 × 64 detail tile and 39.3 → 25.4 ms on the 192 × 128 detail box. Per call: the tile median 102 → 90 ms, the box 158 → 137 ms, the Speed tile 32.6 → 29.0 ms. The 1024² Quality and Speed parts are unchanged: the verification is a fixed cost per call.

## Compatibility

- Root exports: 1,742 (eight added, none removed): `SIMULATE_CAPTURE_FAST_OPTIONS`, `SimulateCaptureFastOption`, `SimulateCaptureFastReport`, `SimulateCaptureDemosaicRecord`, `serializeDisplayViewCorrectionStates`, `bindDisplayViewCorrectionStates`, `DisplayViewCorrectionStateSet` and `DisplayViewCorrectionStateKeys`.
- New optional request fields: `fast` (top level and on the four listed option records) and the `output.demosaic` record form. The string forms keep their meaning.
- New result field: `diagnostics.fast` on captures and display views; `fast` on the WebGPU image-kernel execution record.
- Deprecated: `lens.diffraction`'s `aperture` key; use `kind`. `{ aperture: "circular-aperture" }` is still accepted, with the same result, until 3.0.0; giving both is an error.
- `PreparedDisplayView` gains three methods. No default changes.

### Same results as 2.9.0

A fingerprint of 24 whole results was taken from a build of the `v2.9.0` tag (`02df403`) and from this candidate (based on `main` at `544921d`, with #469), on Node 24.21.0: 18 `simulateCapture` requests (chart presets, spectral patches, a uniform spectrum, a composite with a fixed-size chart, both caller function forms and a material scene, PNG 16-bit Display P3, JPEG, two DNGs, auto and Kelvin white balance, the tone curve, a rolling shutter, a region with diffraction, the Quality options, projection, distortion and vignetting, camera rotation, mirror borders at ISO 3200), 3 `simulateIdealReference` and 3 `simulateDisplayView` results (one with the Quality options at 2 × 2 real pixels per display pixel, one of a material scene). Typed arrays (samples, RAW codes, encoded files) were hashed with SHA-256; everything else was compared as JSON with timings zeroed. The engine version was normalized by setting the `v2.9.0` build's `ENGINE_API_VERSION` to the candidate's, so the DNG Software tag matches too.

- **Bytes identical in all 24:** samples, RAW codes and PNG, JPEG and DNG bytes.
- **Whole results identical in 3:** the 3 ideal references.
- **One field added in 21:** the 18 captures and 3 display views differ only by the new `diagnostics.fast` report, which is `requested: false`, `assurance: "engine-reference"` and every option that ran `false`. Assumptions, plans, requests, the first site input, exposure, scene digests and all other diagnostics (including `providerEvaluationCount` and `sceneLookups`) are identical.

### Two hash-lock tests changed for a two-digit minor version

The DNG Software tag reads `Photivra <version>`. Two hash locks (`test/simulate-capture-optics.test.ts`, the 2.0.0 lock; `test/output-text-metadata.test.ts`, the 2.3.0 lock) wrote the locked release's name back over the current one and required the two to have the same length. `Photivra 2.10.0` is one byte longer than `Photivra 2.0.0`, which moves every later DNG offset, so both locks failed on this candidate, as their length check intended. No lock digest changed: the locks now make their files with a separate copy of the engine whose only change is `ENGINE_API_VERSION` set to the locked release's version (`vi.doMock` of `src/core/version.ts`), and a new assertion checks that the real engine's DNG names the current version. With the version set to 2.3.1 instead of 2.3.0, the 2.3.0 lock's DNG digest fails, so the lock still detects a changed byte.

## Known issues

- **Quality display-view noise at small footprints (#379), unchanged.** With `output.demosaic: "ahd"` the display view's predicted noise has too much colour where a display pixel covers few sensor pixels; validation set F (#456) measures 1.13–1.20 of the reference's on the full-frame and medium-format sensors. Speed (bilinear) is exact.
- **Quality display view at device-pixel widths: AHD colour error at the Siemens star's centre (#457), open.** Found by validation set F: the view's noise-free image differs from the real capture by 5.1 codes RMS and up to 34 codes on the 24 MP full frame at 2028 wide (3.6 / 22 on the 100 MP medium format at 4000 wide), against the 2-code limit for the busiest pixels. Over the whole block the mean error stays within 0.27 code. The cause is the display view's AHD result and is not yet established. Captures, the 100 % detail box and exports are unaffected: they are the capture itself.

## Rights and licensing

No third-party code, data or dependencies are added. `hypot3` independently implements the operation sequence of V8's three-argument `Math.hypot`; no V8 source is vendored or copied. `THIRD_PARTY.md` records the method's origin and V8's licence (#460).

## Privacy and security

No network, persistence or telemetry is added. The new caches hold only numbers computed from requests and are bounded: diffraction profiles (the last 8), expected-signal chart tables (the last 4), and the AHD correction states (4 setups, 65,536 states each, as in a render). `bindDisplayViewCorrectionStates` validates every entry before it changes the cache.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green. Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] The 2.10.0 changes merged with their changelog entries (#434, #456, #458, #459, #460, #461, #462, #463, #464, #465, #466, #467, #468, #469).
- [x] Version surfaces aligned at 2.10.0 (`npm run release:prepare -- 2.10.0`). Root exports 1,742.
- [x] The 2.0.0 and 2.3.0 DNG hash locks made version-length independent, digests unchanged (see "Two hash-lock tests changed").
- [x] Fingerprint against `v2.9.0`: bytes identical in all 24 results; the only difference is the new `diagnostics.fast` field in the 21 captures and display views (run on `main` at `544921d`, with #469).
- [x] Owner's review of this record.
- [x] Green CI on the record pull request (#470), then on `main` after merge (CI run 1046 on `ce58a3e` passed before the tag).
- [x] **The owner's explicit approval to tag `v2.10.0`** on the `main` commit that merges this record, after its CI has passed. The owner tagged it and published the release.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.10.0` → `ce58a3e73de19b428f2be49847979ae7e4ecce37` (#470), after `main` CI on that commit passed ([CI run 1046](https://github.com/Photivra/engine/actions/runs/40437171048)) |
| GitHub release | [@photivra/engine 2.10.0](https://github.com/Photivra/engine/releases/tag/v2.10.0), published 02:44:47 UTC |
| Publish workflow | [Publish npm run 28](https://github.com/Photivra/engine/actions/runs/40440213266): passed (completed 02:52:34 UTC) |
| npm | `@photivra/engine@2.10.0`, dist-tag `latest`, registry time 02:55:11 UTC |
| Integrity | `sha512-eWxi1IIKupPBvwgZkC8hUZ+XzG3U1g49gZxbK0JUErvSA5qNAw7VjpP4Dvefxh7wAY6qdrytbtFfJ5RMHzZKYQ==` (shasum `98c7834b337c3ed204c614d10494c1f99d4f3e72`, 862 files), the same as a local pack of `ce58a3e` |
| Provenance | SLSA provenance from GitHub Actions for the tag, in the Sigstore transparency log ([log index 3502848997](https://search.sigstore.dev/?logIndex=3502848997)); the registry lists the provenance and publish attestations for 2.10.0 |
