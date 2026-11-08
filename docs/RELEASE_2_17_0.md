# 2.17.0 release

> **Prepared November 7, 2026; not published.** npm publishing runs only from the owner's `v2.17.0` tag ([Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.17.0`, with `ENGINE_API_VERSION = "2.17.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:**
  - 27 new root exports (1,810 → 1,837; runtime exports 614 → 623).
  - New opt-in options. Requests that 2.16.0 refused now render: discs above 64 sites, and the display view with lens options.
  - Nothing is removed or changed incompatibly, and no default changes.
- **Why now:** the owner chose #549, #553 and the display view's lens character for 2.17.0 (owner, 2026-11-07), with #564 for the large discs. The app pins it in its next release.

## Scope

No pull request has merged since `v2.16.0` (`4fa2268`). This pull request integrates four part branches, each merged `--no-ff` in this order:

| Change | Issue | Part branch |
| --- | --- | --- |
| Defocus discs up to a kernel radius of 512 sites by exact run-length prefix sums (changes `src/gpu`: a refusal above 64) | #564 | `e217-large-defocus` (`df506e1`) |
| Bokeh character: `lens.defocus.blades`, `sphericalAberration`, `catsEye`; `calculateDefocusBokehKernel` | #553 | `e217-bokeh` (`de36f0b`) |
| The display view with lens projection, distortion, vignetting and rotation (CPU) | #563 | `e217-display-lens` (`8de841a`) |
| The generic lens catalogue, 30 lenses | #549 | `e217-lens-catalogue` (`9f233d6`) |
| Integration, each lens's `summary`, 2.17.0 release preparation: version, changelog, this record | all four | this pull request |

#564 branched from `main` at `4fa2268`; the other three from `release-2.16.0` at `e71b264`, whose tree is `4fa2268`'s (both `da738f1`). Git's merge base for those three is `v2.15.0`, so the two copies of 2.16.0 met as spurious conflicts. Every conflicted file was merged again three ways against 2.16.0 to leave only the parts' real conflicts. Every auto-merged file was checked against that 2.16.0-based merge, and all were identical.

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.17.0.

## API

New root exports (27):

| Exports | Kind | Issue |
| --- | --- | --- |
| `calculateDefocusBokehKernel`, `DEFOCUS_BOKEH_MAXIMUM_BLADES` | runtime | #553 |
| `CalculateDefocusBokehKernelInput`, `DefocusBokehKernel`, `DefocusBokehOptions`, `DefocusBokehBlades`, `DefocusBokehSphericalAberration`, `DefocusBokehCatsEye`, `DefocusBokehClippingAperture` | type | #553 |
| `GENERIC_LENS_CATALOGUE`, `GENERIC_LENS_IDS`, `GENERIC_LENS_SET_BASELINES`, `resolveGenericLens`, `simulateGenericLensFocusError`, `createGenericLensCorrectionProfile`, `GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM` | runtime | #549 |
| `GenericLensCatalogueEntry`, `GenericLensSet`, `GenericLensKind`, `GenericLensCharacterValues`, `GenericLensAdjustments`, `GenericLensCharacter`, `ResolvedGenericLens`, `ResolveGenericLensInput`, `SimulateGenericLensFocusErrorInput`, `GenericLensFocusError`, `CreateGenericLensCorrectionProfileInput` | type | #549 |

9 + 18 = 27, and 1,810 + 27 = 1,837, the count the regenerated reference reports ("1837 root symbols across 196 modules"; `docs/api/exports.json`: 623 runtime, 1,214 type).

Changed contracts, all additive:

- `DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES` is 512 (was 64); `calculateDefocusDiscKernelRadius` (model 1.1.0) gains `convolution` (#564).
- `SimulateCaptureOptions.lens.defocus` gains `blades`, `sphericalAberration` and `catsEye` (#553); `lens` gains `catalogue` and `focusScatter` (#549); `EnvironmentLensFieldMapping` gains the optional `outsideImageCircle` (#549).
- The `lens.defocus` and `view.defocus` assumptions gain `convolution: "runs"` above 64 sites (#564); `lens.defocus` gains `bokeh` with bokeh options (#553).
- `GenericLensCatalogueEntry` and `ResolvedGenericLens` carry `summary` (this pull request).
- `simulateDisplayView` and `prepareDisplayView` accept `lens.projection`, `lens.distortion`, `lens.vignetting` and global-shutter rotation (#563).
- `DisplayViewGpuRequest` (internal) gains `largeDefocus` (#564) and `lens` (#563).

## Integration of the parts

- **The defocus kernel is `siteKernel ?? disc`.** The display view takes the capture's shaped kernel when there is one; the capture's kernel is the bokeh axis kernel or the disc. So a blade-shaped kernel above 64 sites takes #564's run path in both. The `lens.defocus` record's `convolution: "runs"` follows the applied kernel's radius. Tested: a 7-blade kernel of radius 85 by runs equals its direct gather within 1e-12 relative (3,002 reads per output against 29,241 taps), and the capture and view label it (`test/defocus-integration-2-17.test.ts`).
- **Refusals in the short form.** The shaped kernel's cap is #564's 512 sites, refused with `defocusDiscLimitMessage`: `lens.defocus: The blur circle is 31.4 mm (5,241 sites) across; the engine renders at most 1,025 sites (DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES).` The run path's refusal, which had no `lens.defocus:` prefix, now reads `lens.defocus: this blur needs 157,644 reads per site; above a kernel radius of 64 sites the limit is 16,641. Reduce the spherical aberration or the defocus.` The catalogue's own refusal no longer wraps the short message in a second sentence.
- **Large cat's eye: refused.** #564's large path takes one kernel per request, and the cat's eye needs one per field zone. Extending the tiled run convolution per zone was not small, since it would need a zoned source per tile and new tests of seams across tiles, so a cat's eye above a kernel radius of 64 sites is refused: `lens.defocus.catsEye: the blur needs a kernel radius of 179 sites; with a cat's eye the limit is 64 sites (129 across). Reduce the defocus or omit catsEye.` Documented in docs/QUICK_START.md ("Bokeh character" and "Large defocus discs").
- **The catalogue and bokeh.** The catalogue's combined defocus limit of 16 sites stays as built. `lens.catalogue` with `blades`, `sphericalAberration` or `catsEye` is now refused by name; the merged parts validated these options and then dropped them silently. Feeding the catalogue's spherical aberration and character into bokeh is a follow-up, [#567](https://github.com/Photivra/photivra/issues/567), not a 2.17.0 feature.
- **The display view with lens character and a large disc (a defect the merge would have shipped).** #563's lens signal read only the combined kernels, while #564 puts a disc above 64 sites in `largeKernel` and leaves a unit tap in the kernels, so a lens view above 64 sites would have rendered **without the blur**. The lens signal now does what #564's rectilinear signal does. It computes E_c, each channel's in-focus sum through the lens (diffraction kernels or a unit tap, each source point's field factor), in fixed 64-site tiles, then applies D ⊛ E_c by runs in fixed 128-site tiles. Test: one request with radial distortion, vignetting, the box aperture and a disc of radius 179. Every site's expected electrons equal the capture's image-space provider within 1e-9 relative, regions equal the whole view, and `gpu: "auto"` renders on the labelled CPU reference.
- **Fixed tiles against lens profiles (also found in that test).** #564's image-space run tiles are fixed 64-site tiles, so their sources reach up to a tile beyond the reach #548 checks a distortion profile against. The capture threw "outside the mapped radial distortion profile" for a profile sized to the stated reach. Lattice points beyond the reach feed no queried value, so they are now 0 and never mapped. The own-factor tiles and the lens signal's in-focus tiles are bounded the same way. Queried values are the same sums; only the prefix sums' rounding can differ, within the run path's stated accuracy. These requests are new in 2.17.0.
- **The lens reach** passed to the display view's profile check uses the shaped kernel's radius when there is one (the disc's otherwise, as before).
- **Conflicts resolved:** the provider inputs in `diffraction-provider.ts` and `defocus-image-space-provider.ts` take #564's `largeKernel` and #553's `fieldZones`. `simulate-capture.ts` merges the imports, the `lens.defocus` record (#564's message and `convolution` with #553's `bokeh`), the provider calls, `DisplayViewRunContext` (#553's `siteKernel`, #563's `lens`) and the bokeh block after #563's `lensGeometry`. `simulate-display-view.ts` merges the `view.defocus` assumption (#553's shaped-kernel labels, #564's `convolution`, #563's wording) and the GPU request. The rest are the CHANGELOG, `docs/QUICK_START.md`, `docs/DISPLAY_VIEW.md`, `docs/api/optics-defocus-disc-kernel.md`, `src/optics/defocus-disc-kernel.ts` (#564's limit message and #553's exported `normalizeSiteKernel`) and `src/facade/display-view-gpu.ts`.
- **Tests changed to the integrated limits, not loosened.** #553's two limit tests expected "limit is 64 sites". They now expect the exact new messages: one past 512 sites with the disc's short form, one between 64 and 512 for spherical aberration on the run path. #564's run-refusal test matches the full new message.

## Lens summaries (owner's addition)

Each catalogue lens has `summary`, at most 40 characters of plain US English, written from its adjustments and its stated reason, for example *PV 100 2.8 Macro Pro*: "Flat field to 1:1; strong breathing", *PV 50 1.8*: "Simple, well-corrected normal lens". No summary claims a bokeh quality, because the catalogue renders a plain disc. The test checks the length and spelling of every summary. It also checks each claim against the lens's adjustments: barrel needs a negative distortion and pincushion a positive one; "coma" needs coma above 1 and "low coma" below 1; axial or lateral color needs that adjustment above 1; a fisheye summary needs a fisheye. The summaries are in docs/LENS_CATALOGUE.md's table. The catalogue is loaded on demand, and the display-view bundle did not grow (below).

**Resolved profiles reach past the corner (app report).** `resolveGenericLens`'s distortion and vignetting profiles stopped at the half-diagonal (21.633 mm on full frame), while the display view and the capture read slightly past the outer site centres (21.637 mm), so both refused even PV 50 1.8's own profiles. They now reach 1.25 of the half-diagonal; the distortion's range is widened for barrel lenses. The coefficients, and so every value inside the frame, are unchanged. Tests: both 50 mm lenses' own profiles render in `simulateDisplayView` and `simulateCapture`, and every lens's vignetting stays positive and its distortion monotonic over the reach.

## Sizes

The display view's addition to a capture bundle (`test/capture-bundle.test.ts`'s measurement: rolldown, minified ESM, gzip level 9), measured on each tree with the same bundler:

| Tree | Minified | gzip |
| --- | --- | --- |
| 2.16.0 (`4fa2268`) | 46,380 B | 18,540 B |
| #564 alone | 46,465 B | 18,544 B |
| #553 alone | 45,756 B | 18,129 B |
| #563 alone | 46,341 B | 18,527 B |
| #549 alone | 46,366 B | 18,498 B |
| **2.17.0 (this pull request)** | **45,791 B** | **18,159 B** |
| Budget (unchanged) | 46,500 B | 18,550 B |

The merge fits with 709 B and 391 B to spare. Most of the margin comes from #553's own saving, which carried through the merge. No budget was raised and no lazy-loading change was needed. #563's lens module and #549's catalogue stay separate chunks loaded on demand.

## Byte identity

Every request that 2.16.0 renders and that uses none of the new options renders byte-identically: all hash locks pass in `npm run check`. Discs at or below 64 sites keep the direct convolution and their records. The integration's changes touch only the paths new in 2.17.0: discs and shaped kernels above 64 sites, the lens signal, and the catalogue with bokeh options.

## GPU evidence

`git diff v2.16.0 -- src/gpu` is not empty: #564 adds a refusal of discs above 64 sites to `src/gpu/display-view-quality-gpu.ts` and `src/gpu/display-view-speed-gpu.ts` (no kernel or WGSL change). The hardware gate therefore applies. On the integrated tree, commit `ae0f8f4`, on the owner's MacBook Pro (Mac17,8, Apple M5 Pro), macOS 27.2, Node.js 24.19.0, Chrome 157 headless:

| Suite | Adapter | Result |
| --- | --- | --- |
| `npm run test:webgpu:hardware` | `apple` / `metal-3`, `softwareAdapter: false`, `isFallbackAdapter: false` | **167 of 167 passed**, every value inside its bound; composite probe product path `dekker`. Informational timings at 1024 × 768, CPU vs GPU ms: convolution r7 361 vs 7.8, SDR 20.0 vs 15.6, RAW development 76.6 vs 35.3 |
| `npm run accept:gpu:hardware` | `apple` / `metal-3` | **PASS, 26 of 26 cases**: 100.00 % of pixels within ΔE2000 1 in every case, largest ΔE2000 0.0018, largest \|Δ\|/σ 0.002, the 8-bit display codes equal to the reference's in every pixel |
| Large disc with `gpu: "auto"` (`scripts/accept-large-disc-gpu-fallback.mjs`) | `apple` / `metal-3` | A Siemens star with a disc of kernel radius 179 renders on `cpu-reference`, labelled `unsupported-on-backend`: "the GPU display-view renderer "photivra-display-view" does not support this request: a defocus kernel radius above 64 sites (convolved by runs on the CPU, #564) is not on the GPU". The same request in focus runs on `webgpu-f32` |

The rows are in [docs/WEBGPU_DEVICES.md](WEBGPU_DEVICES.md#runs) (the two rows on `ae0f8f4`); the acceptance record, with the large-disc lines, is [display-view-acceptance-m5-pro-2026-11-07-ae0f8f4](validation/display-view-acceptance-m5-pro-2026-11-07-ae0f8f4/README.md). The browser and Node CPU references differ exactly as in 2.16.0's run (for example the app chart in Speed: 2,347,043 pixels, ΔE2000 0.0402 at most; the Siemens star up to 43.3, #471), information only. The commits after `ae0f8f4` change no `src/gpu` file and nothing the GPU renders.

## Same package

The candidate's packed tarball (`npm pack`, 949 files) was compared file by file with the published `@photivra/engine@2.16.0` tarball (919 files; shasum `e6c721121ad458e75531dbcd7551d8ae8916210d`, the registry's).

**Added (30):** `dist/equipment/generic-lens-catalogue.*`, `dist/facade/generic-lens-capture.*`, `dist/optics/generic-lens-psf.*`, `dist/output/generic-lens-corrections.*` (#549); `dist/optics/defocus-bokeh-kernel.*`, `dist/facade/defocus-bokeh-zones.*` (#553); `dist/optics/site-kernel-runs.*`, `dist/facade/large-defocus-lattice.*` (#564); `dist/facade/display-view-lens-signal.*` (#563), 3 files each; and `docs/api/equipment-generic-lens-catalogue.md`, `docs/api/optics-defocus-bokeh-kernel.md`, `docs/api/output-generic-lens-corrections.md`. **Removed:** none.

**Changed:**

| Files | Difference |
| --- | --- |
| `dist/facade/simulate-capture.*`, `dist/facade/simulate-display-view.*`, `dist/facade/expected-signal*.*`, `dist/facade/diffraction-provider.*`, `dist/facade/defocus-image-space-provider.*`, `dist/optics/defocus-disc-kernel.*` | the four parts and the integration |
| `dist/gpu/display-view-quality-gpu.*`, `dist/gpu/display-view-speed-gpu.*`, `dist/facade/display-view-gpu*.*` | #564's refusal of large discs; #563's `lens` request flag |
| `dist/camera/lens-projection.*`, `dist/facade/scene-radiance.*`, `dist/optics/sensor-environment-query.*`, `docs/api/optics-sensor-environment-query.md`, `docs/AGENT_GUIDE.md`, `llms.txt` | #549 (the fisheye's image circle, `outsideImageCircle`) |
| `dist/optics/illumination-vignetting.*` | #563 (`prepareIlluminationVignettingThroughput`, internal) |
| `docs/QUICK_START.md`, `docs/USAGE.md`, `docs/api/facade-simulate-capture.md`, `docs/api/optics-defocus-disc-kernel.md` | the four parts and the integration |
| `THIRD_PARTY.md` | the 2.17 parts' cited methods |
| `SECURITY.md` | the current release, 2.16.0 |
| `CHANGELOG.md`, `README.md`, `CITATION.cff` | the 2.17.0 entry and version |
| `package.json`, `dist/core/version.*`, `dist/index.*`, `docs/API_REFERENCE.md`, `docs/api/core-version.md`, `docs/api/exports.json` | the version and the new exports |

## The app's bundle (app report)

The app (Photivra/apps at `97ee309`, its own `npm run build` and `check:bundle`) was built against the published 2.15.0 and 2.16.0 tarballs and this release's tarball:

| Engine | App total JS (gzip) | Over the app's 512,000 B budget by | The app's worker imports, every chunk (engine bundle, gzip) |
| --- | --- | --- | --- |
| 2.15.0 | 498.6 KiB (about 510,570 B) | within | 311,439 B |
| 2.16.0 | 521,974 B | 9,974 B | 323,428 B |
| 2.17.0 (`ae0f8f4`) | 546,294 B | 34,294 B | 347,775 B |

- **The cause is the new options' code, not broken tree-shaking or splitting.** The engine bundle of exactly the app's worker imports (`NATIVE_RAW_LIMITS`, `prepareDisplayView`, `serializeSimulatedCaptureDngFromParts`, `simulateCapture`, `simulateIdealReference`) grows by the same amounts as the app. Unused root exports (`calculateDefocusBokehKernel`, `createGenericLensCorrectionProfile`, `calculateDefocusDiscKernelRadius`) are absent from it. The largest additions (minified, before gzip) are reached by `simulateCapture` at run time, because options are chosen at run time: in 2.16.0, #548's image-space provider (17 KB) and #552's development detail (15 KB); in 2.17.0, the catalogue data and PSF (43 KB, lazy), the lens signal (19 KB, lazy), `simulateCapture`'s option handling (+24 KB), the bokeh kernel (13 KB) and the run convolution (10 KB).
- **The worker chunk's +65 KB is mostly a move.** The app's `capture.worker` chunk grew from 221,075 B to 286,252 B. But the three chunks the bundler used to split out (the display-view GPU host 41,390 B, text metadata 15,114 B, pixel limits 3,670 B; all static imports of the worker) are now inside it, and six lazy chunks appeared (about 19 KB, mostly the catalogue and the lens signal). The total grows by 24,320 B.
- **No behaviour-neutral change in the engine recovers 34 KB.** Lazy-loading more option code would shrink the worker's first load but not the app's total, which counts every chunk. **This needs the owner's decision** on the app's budget or on which engine features the app takes; no budget was raised.
- **A guard against silent growth:** `test/capture-bundle.test.ts` bundles that import shape and checks the total of every chunk against 348,000 B gzip, today's 347,775 B plus a few hundred bytes. A change that grows the app's worker fails in the engine first. Raising it is the owner's decision.

## For the owner

- **#566, decided:** fixed in 2.18.0 as a breaking fix with an orientation test (owner, 2026-11-07); labelled P1. 2.17.0 leaves the behaviour as is.
- **The app's total JavaScript budget (512,000 B gzip) does not fit 2.16.0 or 2.17.0** (below, "The app's bundle"). The engine cannot recover 34,294 B without removing features. This needs your decision on the app's budget, or on which engine features the app takes.
- **Follow-ups filed:** #565 (bug: in-focus diffraction PSF quadrature at chart-boundary ties, 12,663 against 3,560 e⁻ on a 20 × 14 Siemens star with an identity vignetting profile) and #567 (enhancement: catalogue character into bokeh).
- `THIRD_PARTY.md` records the methods the 2.17 parts cite (summed-area tables, Crow 1984 and Heckbert 1986; the bokeh and catalogue optics references). No public-record patent check is recorded for them; they are left for your review with the others.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.17.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] The four part branches merged into this pull request.
- [x] Version surfaces aligned at 2.17.0 (`npm run release:prepare -- 2.17.0`). Root exports 1,837.
- [x] Packed tarball compared with the published 2.16.0 (above).
- [x] WebGPU hardware gate on the integrated tree (above).
- [ ] Green CI on this pull request, then on `main` after merge.
- [ ] The owner's approval to tag `v2.17.0`.
- [ ] The `v2.17.0` tag on the `main` commit that merges this record.
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.
