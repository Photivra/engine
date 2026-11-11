# 2.22.0 release

> **Prepared November 11, 2026; not published.** npm publishing runs only from the owner's `v2.22.0` tag ([Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.22.0`, with `ENGINE_API_VERSION = "2.22.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Every leftover engine issue in one release** (owner, 2026-11-10), built as six parallel part branches and integrated here.
- **Why a minor version:**
  - 50 new root exports (1,931 → 1,981; runtime exports 654 → 672). Nothing is removed; the display view's AHD correction-state API is deprecated (checked no-ops until 3.0.0).
  - New functions: phone DNG import (`importDngRawImage`, `parseLossyJpeg`, `createJxlOxideDngDecoder`), the DNG stage image and opcodes (`developDngStageImage`, `parseDngOpcodeList`, `applyDngOpcodes`, `parseDngProfileGainTableMap`, `parseDngRgbTables`, `applyDngProfileGainTableMap`, `applyDngRgbTables`), `calculateCameraChannelResponse`, the C2PA writers (`bindC2paManifestStore`, `calculateC2paDataHash`, `setC2paManifestStore`, `parseC2paManifestStore`) and `prepareQualityPaths`.
  - New options and fields: `result.sensor.native` (#595), `output.gamutHandling: "desaturate-to-luminance"` (#601), `output.highlightMode: "reconstruct-neighbors"` (#602); the display view renders the luminance tone curves and `highlightMode: "reconstruct"` (#593).
  - Some results change as model corrections or owner decisions, each listed with its way back in [Default changes](#default-changes).

## Scope

This pull request integrates six part branches, each cut from `e3aa535` (`v2.21.0`) and merged `--no-ff` in this order:

| Change | Issues | Part branch |
| --- | --- | --- |
| Phone DNG import: JPEG XL and lossy JPEG raw data, the stage image and opcodes, ProfileGainTableMap and RGBTables; the channel-response helper | #598, #600, #591 | `e222-a` (`13ba2dd`) |
| Native-photosite sensor figures; tiers' read noise per photosite; mixed lighting over a print (CPU and GPU); sample counts that follow the light and the output; the catalogue's fast grid | #595, #599, #597, #590, #603 | `e222-b` (`f69bd11`) |
| Display view: luminance tone curves, highlight reconstruction and desaturation on the CPU and GPU; neighbor highlight reconstruction | #593, #601, #602 | `e222-c` (`cf83789`) |
| The display view's AHD low-signal correction removed (owner decision); the per-site expected-signal wording | owner decision 2026-11-11, #394 wording | `e222-c2` (`5ca0ee9`) |
| Content Credentials writers (engine half): bind, hash and patch a C2PA store in JPEG, PNG and DNG; a store reader | #165 | `e222-d` (`e543b0a`) |
| The GPU Quality host on demand; `prepareQualityPaths()`; the `quality-code-unavailable` fallback; two budget rows | #594 | `e222-e1` (`c8811df`) |
| Integration: conflict resolutions, cross-part test and input fixes, the CPU on-demand split (#594, E2), 2.22.0 preparation | all | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.22.0.

## Default changes

See the CHANGELOG's "Default changes (migration)" table, which gives each change's way back. In short:

1. **Tiers' read noise is per photosite (#599, owner 2026-11-11).** Above 6 µm a site that sums N photosites takes the photosite's read noise ×√N, and `sensor.readNoise` on a tier now means one photosite's value. Way back: `sensor.readNoise` set to the 2.21.0 site value divided by √N = pitch / 6 µm.
2. **5 nm spectral step on exact requests under a spiky light (#590).** Way back: `sensor.spectralStepNanometers: 20`.
3. **The catalogue's fast grid is 4 cells on fast requests (#603)**, 10 for the measured fisheye and on exact requests. Way back: `fast: false` with `lens.catalogue: { kind, fast: true }`.
4. **Mixed lighting over an image-plane print is rendered (#597)** instead of refused.
5. **The display view's AHD has no low-signal correction** (owner decision 2026-11-11: the correction was a table of precomputed values per channel signal level, which the design-around rule does not allow, and computing it per site measured 240–1300× slower). `view.demosaic` labels the remaining bias with measured numbers. No way back; the correction-state API stays as checked no-ops until 3.0.0.
6. **Two `raw.expectedSignal` method names** describe what the paths have done since 2.21.0 (`per-site-integrated-electrons`, and its catalogue variant). Labels only.
7. **The GPU Quality self-check runs at the first Quality render** instead of the device's first render (owner, 2026-11-10). Diagnostics timing only.
8. **Full-quality and opt-in code loads on demand (#594).** A request whose code cannot load fails with `ImageKernelExecutionError` reason `quality-code-unavailable` (the GPU falls back to the CPU). Way back: `await prepareQualityPaths()` at start-up.

Requests that use none of these options, no spiky light on an exact request, no tier above 6 µm, no catalogue lens on a fast request and no AHD display view keep their 2.21.0 bytes (the hash locks pass unchanged, apart from the label re-recordings below).

## Integration of the parts

- **Conflicts:** `CHANGELOG.md` (every part's block kept, then combined into one 2.22.0 entry), `docs/API_STYLE.md` (the speed-versus-accuracy list takes every part's methods), the generated API reference (regenerated), `src/index.ts` (both sides kept), `src/facade/fast-methods.ts` (every part's registry entries), and the display view below.
- **The AHD correction's removal with #593's coupled rendering.** Both parts edited the display view's CPU setup, the GPU Quality pixel pass and its emulator. The resolution keeps the removal (no correction states, key, collect pass, state table, bitmap or threshold; the pixel pass's bindings are the five without them) and every coupled step (the rendering choice and its module, the constants after the aux table, the tone and chain moments). The removal's samples are kept exactly: the uniform AHD view's sample digest equals that of the removal alone.
- **#594's renderer move with the parts.** The GPU renderer moved to `src/gpu/display-view-gpu-renderer.ts` (E1); the correction-state store it held is dropped (C2), and B's test imports the renderer from its new module.
- **Cross-part fixes found by the merged suite** (each part branch had passed its own tests): the DNG import helpers let raw `TypeError`s escape for malformed input, now domain errors; `import`, `apply` and `develop` were not documented verb families (added to docs/API_STYLE.md with their meaning, for the owner's review); a bound DNG's import now names the C2PA store tag as present and not applied, which D's test now checks explicitly; C had dropped the tone-curve refusal from the GPU's `supports()`, restored with the two luminance curves accepted; the WGSL literal count includes C's three modules; #597's image-plane light shader named a local `common`, a WGSL reserved word that Chrome 153 refuses on a hardware adapter (renamed; a new test checks every shipped literal); B's mixed-lighting test and six 2.0.0 metadata digests take C2's method name (bytes unchanged, verified).
- **Hash locks re-recorded, each with its reason in the test:** `test/simulate-capture-optics.test.ts` (six metadata digests: the method name and explanation only; byte digests unchanged) and `test/display-view-speed-material.test.ts` (the AHD case: the removal's samples, which equal the removal alone, plus #599's explanation text). No test was weakened.
- **Design-around check:** the removal deletes the only per-channel-signal table the parts had (the AHD correction grid); no new render path forms a per-material or per-channel value table.

## Sizes

The app's capture-worker shape (`test/capture-bundle.test.ts`: `NATIVE_RAW_LIMITS`, `prepareDisplayView`, `serializeSimulatedCaptureDngFromParts`, `simulateCapture`, `simulateIdealReference`; rolldown 1.2.9, minified ESM, gzip level 9). Rows as the owner defined them for #594: *fast worker* is every chunk except the on-demand ones; *on demand* is the chunks holding the Quality and opt-in modules, found by module membership.

| Tree | Fast worker | On demand | All chunks |
| --- | --- | --- | --- |
| 2.21.0 (`e3aa535`) | 363,695 B (one all-chunk limit, 363,700 B) | — | 363,695 B |
| E1 alone (GPU Quality split, on 2.21.0) | 344,287 B (limit 344,300 B) | 20,026 B (limit 20,100 B) | 364,313 B |
| All six parts merged (C's coupled-step chunks counted as fast) | 358,680 B | 19,379 B | 378,059 B |
| **This pull request** (CPU split) | **337,373 B** | **46,940 B** | 384,313 B |
| Limits now | **337,500 B** | **47,000 B** | — |

The on-demand row is the GPU Quality host 19,364 B, the CPU Quality kit 18,249 B, the GPU coupled steps 5,159 B and the opt-in kit 4,168 B. Both limits are the measurements rounded up to the next 100 B, the owner's definition for #594's rows (owner answer 2, 2026-11-10). The fast row is under its previous limit (344,300 B), so no raise was needed; the limit is lowered to the new measurement by the same definition.

**The CPU split (E2, results unchanged).** One Quality kit (`src/facade/quality-kit.ts`) holds diffraction, the capture's AHD demosaic, `lens.defocus` beyond the geometric disc (bokeh shapes, cat's eye, the large-disc lattice, the image-space provider) and C's coupled rendering steps and neighbor highlight reconstruction, so C's separate chunks (and the shared chunks they caused) are regrouped into one. One opt-in kit (`src/facade/opt-in-kit.ts`) holds `sensor.profile`, `illumination` and `motion.subject`. Each loads once where the request is parsed and is then called synchronously, and every hash lock passes. Not moved, with the reason: the native-photosite report (#595) runs for every capture; the exposure build-up hooks are 255 B inside the RAW producers; image-plane lighting (#597) already loads with `prepareImagePlaneScenes()`; the display view's AHD candidates are inline in `display-view.ts` (a refactor first). `test/capture-bundle.test.ts` checks that each kit is one chunk reached only by the entry's dynamic import, that no kit module is in the fast worker's eager chunks, and that importing `prepareQualityPaths` keeps them on demand; `test/on-demand-kits.test.ts` checks that default requests load neither kit.

**Shape note.** The bundler now gives the entry (252,367 B) ten small chunks it shares with the kits (27,348 B, imported statically), so the first load is eleven files instead of one. The all-chunk total grows 6,254 B over the merged parts, because the chunks compress separately and name their shared bindings. portable-math's `portableExp` and `portablePow` (about 1 KB of source) sit in a shared chunk of the capture-only bundle because the Quality kit uses them.

**The display view's addition** to a capture bundle, now measured on the entry and the chunks it imports statically (before 2.22.0 these were the entry alone, so 2.21.0's figures are the same either way): **38,370 B minified and 14,123 B gzip** (2.21.0: 46,270 B and 18,327 B; C alone: 49,573 B minified; budgets 46,500 B and 18,550 B, unchanged).

## Local gates

On the integrated tree (Apple M5 Pro, Node.js 24.19.0), one run each:

- `npm run check:static` (lint, typecheck, licence, licence-header, identity and browser-surface gates): passed. `npm run check:licenses`: "Dependency license policy passed: Apache-2.0=15, BlueOak-1.0.0=1, BSD-2-Clause=6, BSD-3-Clause=2, ISC=7, MIT=125, MIT OR Apache-2.0=1, MPL-2.0=12" (the new devDependency jxl-oxide-wasm under its chosen Apache-2.0).
- `npm run coverage`: 395 files passed (1 skipped), 4,489 tests passed (2 skipped); coverage 95.81 % statements, 92.21 % branches, 98.64 % functions, 97.54 % lines (thresholds met); 8.5 min. Every hash lock passes. The first coverage run timed out one test (#602's display-view case, 54 s alone, with an unscaled 240 s deadline); its deadlines now scale for coverage like the other heavy tests'. The later WGSL rename below changes no Node result (its tests rerun).
- `npm run build`: passed (28 WGSL literals minified). `npm run docs:check`: passed (374 Markdown files, 165 importing examples). `npm run pack:check`: passed (1,134 files) after one fix (a packed guide linked to an unpacked page by a relative path). `npm run release:consumer-check`: passed (165 strict typed and running doc snippets; the packed package's on-demand imports load).
- **WebGPU, hardware** (`PHOTIVRA_WEBGPU_ADAPTER=hardware PHOTIVRA_WEBGPU_REQUIRED=1 npm run test:webgpu`, Chrome headless, adapter `apple` / `metal-3`): the first run found 12 failures, every image-plane GPU case: #597's light shader declared a local named `common`, a WGSL reserved word, which Chrome 153 refuses (the float32 emulation cannot see it). Renamed (results unchanged), with a new test that rejects reserved words in every shipped WGSL literal; the 12 cases then passed. The other 179 tests passed, including every coupled-step case (#593, #601).
- **WebGPU on SwiftShader** (`PHOTIVRA_WEBGPU_REQUIRED=1 npm run test:webgpu`, Playwright Chromium 1243 headless, adapter `google` / `swiftshader`): **the coupled-step cases fail.** The Speed kernel and the Quality pixel pass with the coupled steps (`+coupled` pipelines) do not compile on SwiftShader: after about 44 s the GPU process ends ("A valid external Instance reference no longer exists"), and every later case in that page loses its adapter. The same happens on part C's branch alone, so it is not an integration effect. Without the 14 coupled cases the suite passes: 177 tests, 11.3 min. The coupled kernels pass on the hardware adapter and on the float32 emulation (`npm test`). See [Pending](#pending-after-release).

## Pending (after release)

- **The coupled steps on SwiftShader (#593, #601):** see [Local gates](#local-gates). The CI WebGPU job runs on SwiftShader, so this pull request's WebGPU check reports it; the owner decides whether to hold the release for a kernel that compiles on SwiftShader or to ship with the hardware and emulation evidence.

- **Phone sample DNGs (#598):** the import is verified on synthetic fixtures (lossless 8–16-bit tiles round-trip bit-exactly; the lossy JPEG decoder is within one code of synthetic baseline streams at quantization step 1). The owner's iPhone ProRAW samples (lossless JPEG, JPEG XL lossless and lossy) have not been provided yet; per the owner's decision (2026-11-11) the release ships and the import is verified against them when they arrive, with a patch release if needed.
- **External C2PA validation (#165):** signed files have not been checked with the C2PA reference validator (the engine signs nothing; no validator was available offline). The writers follow C2PA 2.4 and match the reference SDK's segment and chunk placement.
- **#602 on the GPU (#605):** `highlightMode: "reconstruct-neighbors"` is refused on the GPU (`unsupported-on-backend`) and runs on the CPU.
- **A table-free AHD low-signal correction (#604):** research for a correction that integrates per site without a precomputed table.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.22.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] The six part branches merged into this pull request.
- [x] Version surfaces aligned at 2.22.0 (`npm run release:prepare -- 2.22.0`). Root exports 1,981.
- [x] 2.21.0 recorded as published ([2.21.0 release record](RELEASE_2_21_0.md#publication)).
- [ ] `src/gpu` changed: the SwiftShader WebGPU suite run locally and on this pull request's CI; the coupled-step cases fail there ([Local gates](#local-gates)); the hardware suite passes.
- [x] The worker rows settled by the owner's #594 definition ([Sizes](#sizes)); no limit raised.
- [x] `test/shard-weights.json` re-estimated from this pull request's first CI run (run 43104711989): shards 1, 2, 3 and 5's CI times; shards 4 and 6 reached the 20-minute job limit (the parts' new display-view files had no recorded time, so they weighed the median), and their 133 files take this tree's local coverage time × 1.647, the median CI/local ratio. No test was removed and no job limit was raised.
- [ ] Green CI on this pull request, then on `main` after merge.
- [ ] The owner's approval to tag `v2.22.0`.
- [ ] The `v2.22.0` tag on the `main` commit that merges this record.
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.
- [ ] After the samples arrive: #598 verified against the owner's phone DNGs.

## For the owner

Decided by the owner and applied here: every leftover engine issue in one release; the AHD correction removed with its API deprecated; read noise per photosite everywhere; #594's two rows with limits at the measurements rounded up; one Quality kit and one opt-in kit. Integration choices the owner may want to review: three new verb families (`import`, `apply`, `develop`, docs/API_STYLE.md); a CPU request whose on-demand code cannot load fails (there is no other CPU path) with `quality-code-unavailable`; the native-photosite report kept on the default path; the display-view budget measured on the eager chunks.
