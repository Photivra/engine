# 2.16.0 release

> **Published November 7, 2026.** The `v2.16.0` tag is on `4fa2268` (#562), after `main` CI on that commit had passed; npm publishing ran from the tag ([Publication](#publication)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.16.0`, with `ENGINE_API_VERSION = "2.16.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:**
  - 5 new root exports (1,805 → 1,810; runtime exports 613 → 614).
  - New opt-in options, and `lens.defocus` combinations that 2.15.0 refused now render (#548).
  - Nothing is removed or changed incompatibly, and no default changes.
- **Why now:** the owner chose one release for the rest of the 2.15 plan (#400, #533, #556) and the 2.16 plan (#548, #552) (owner, 2026-11-07). The app pins it in its next release after 0.59.0.

## Scope

No pull request has merged since `v2.15.0` (`0e2232f`). This pull request integrates four part branches, each merged `--no-ff`:

| Change | Issue | Part branch |
| --- | --- | --- |
| The display view reports its highlight count, `diagnostics.highlight` (changes `src/gpu`) | #533 | `e216-docs-highlights` (`3cbd18a`) |
| Docs: 2.15.0 recorded as published; display-view cost rows re-measured | #400 | `e216-docs-highlights` (`3cbd18a`) |
| Development exposure push, `output.exposureCompensationStops` | #556 | `e216-exposure-push` (`98701e6`) |
| Sharpening and diffraction correction, `output.sharpening` and `output.diffractionCorrection` | #552 | `e216-sharpen-diffcorr` (`acb3dea`) |
| `lens.defocus` out of focus with projection, distortion, vignetting and camera rotation | #548 | `e216-defocus-optics` (`8da4215`) |
| Integration: the push on both development paths; tests across the parts; 2.16.0 release preparation: version, changelog, this record | all five | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.16.0. #400 stays open after this release until the owner edits #379's "Target: 2.7.0".

## API

New root exports (5):

| Export | Kind | Issue |
| --- | --- | --- |
| `DisplayViewHighlightDiagnostics` | type | #533 |
| `NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS` | runtime (`{ minimum: -2, maximum: 5 }`) | #556 |
| `SimulateCaptureSharpening` | type | #552 |
| `SimulateCaptureDiffractionCorrection` | type | #552 |
| `SimulateCaptureDetailDiagnostics` | type | #552 |

Changed contracts, all additive:

- `DisplayViewResult.diagnostics` gains `highlight: { saturatedPixelCount, statistic: "expected-value" }` (#533).
- `simulateCapture`'s `output` gains `exposureCompensationStops` (#556), `sharpening` and `diffractionCorrection` (#552); `NativeRawDevelopmentInput` gains `exposureCompensationStops`; `SIMULATE_CAPTURE_COST_OPTIONS` gains `output.diffractionCorrection` and `output.sharpening`; `diagnostics.detail` is present only when a detail stage ran.
- `request.diffraction.execution` and the `lens.defocus` assumption gain `"image-space-convolution"`; the assumption gains `imageSpaceOptions` and `fieldVariation` (#548).
- The WebGPU accelerator's `developNativeRaw` rejects a non-zero push with `unsupported-on-backend` (#556).

## Integration of the parts

- **The push on both development paths.** With `output.sharpening` or `output.diffractionCorrection` the capture develops through `developLinearSrgb`, the native development's own linear operator, instead of `createNativeRawDevelopmentTask`. Both read the gain from `prepareNativeRawDevelopment` and apply it to the black-subtracted, white-normalized RAW, before demosaic, so a pushed site clips at white before the diffraction correction runs. `output.developmentOrder` lists `"development exposure push (RAW)"` first when a push is given (docs/DIGITAL_OPTICS_FOUNDATION.md, "Development order"; docs/QUICK_START.md).
- **Tests** (`test/development-detail-integration.test.ts`):
  - a +2-stop push with an unsharp mask that changes nothing is byte-identical to the push alone, though the two develop on different paths; removing the gain from `developLinearSrgb` fails this test and the next;
  - a +2-stop push of a quarter exposure (1/32 s), sharpened and diffraction-corrected, matches the full exposure (1/8 s) column by column within 4 standard errors, with the same clipped highlight (saturated counts within 5 %) and the quarter exposure's unclipped RAW;
  - image-space `lens.defocus` (vignetting, barrel distortion and diffraction) with `output.exposureCompensationStops`, `output.sharpening`, `output.diffractionCorrection`, and all three: the RAW is unchanged; at +1 stop each linear sample below white doubles (within 0.2 % and 16-bit quantization); the unsharp mask adds halos; the correction raises contrast and states that defocus is not inverted.
- **The highlight count and the push.** The display view's count (#533) uses the per-site readout moments, which #556 scales by the gain and its square, so a pushed view's count is formed from the pushed values (by construction; no test combines the two).
- **Bundle size.** Each part alone fitted the display view's budget in `test/capture-bundle.test.ts`; together they were 4 B gzip over (46,443 B minified, 18,554 B gzip). The budget is unchanged (owner, 2026-11-07: "Find a saving first"). The saving: the display view's per-channel readout moments are now always scaled by the push gain G, instead of branching on G = 1; x·1 = x exactly in IEEE 754, so every result is bit-identical (the hash locks pass). The addition is now 46,380 B minified and 18,540 B gzip (−63 B and −14 B), within 46,500 B and 18,550 B; +667 B and +367 B over 2.15.0's 45,713 B and 18,173 B. The GPU kernels and their inputs are unchanged.
- **Conflicts resolved:** the CHANGELOG's Unreleased sections (all entries kept, under 2.16.0), `docs/QUICK_START.md`'s option table (all three rows kept), and `output`'s allowed keys in `src/facade/simulate-capture.ts` (the union of both parts).

## Measurements

From the parts (details in the CHANGELOG entries and the docs they cite; Apple M5 Pro, Node.js 24.19.0):

- **#533:** on the app request, part medians 38–41 ms against 2.15.0's 39 ms (Speed) and 74–79 ms against 74–78 ms (Quality); the extrapolated whole view 0–4 % slower. The GPU count is the reference's bit for bit (`diagnosticsExact` stays true).
- **#556:** a +3-stop push of a 3-stop underexposure matches the normal exposure's mean within 0.4 %, with about √8 times its noise; after +5 stops a 20 e⁻ read-noise sensor is noisier than a 1 e⁻ one; a pushed 12-bit gradient shows quantization plateaus that 14 and 16 bits do not.
- **#552:** distortion correction moves a 0.25 cycle/pixel corner grating to 0.186 cycles per output pixel; vignetting correction raises corner noise ×1.29 with unchanged SNR; lateral CA correction registers edges to 0.005 px while red and blue stay 1.8–2.2 px wider (longitudinal CA); sharpening overshoots a step by 0.367·amount·h at σ = 1.5; diffraction correction leaves a grating beyond the cut-off at zero and restores one at 0.55·f_c only from 0.34 to 0.82 of its contrast.
- **#548:** RAW codes equal the environment PSF quadrature with the same disc, expected electrons within 1e-12 per site. App defaults (384 × 256 whole frame at 93.75 µm): vignetting 1.6 s out of focus (1.0 s in focus), rotation 7.5–8.8 s, fisheye 15–19 s, radial distortion 19–20 s, all four 101–124 s; out of focus without these options stays on the object-space path (0.05–0.07 s).

## GPU evidence

`git diff v2.15.0 -- src/gpu` is not empty: #533 changes the display view's Speed and Quality kernels and their hosts, and #556 adds the push refusal to `src/gpu/image-kernel-accelerator.ts`. The hardware gate therefore applies. On the integrated tree, commit `ecb1068`, on the owner's MacBook Pro (Mac17,8, Apple M5 Pro), macOS 27.2, Node.js 24.19.0:

| Suite | Adapter | Result |
| --- | --- | --- |
| `npm run test:webgpu` | SwiftShader (`google`, `softwareAdapter: true`), the CI adapter | **167 of 167 passed** (arithmetic, not a GPU) |
| `npm run test:webgpu:hardware` | `apple` / `metal-3`, `softwareAdapter: false`, `isFallbackAdapter: false` | **167 of 167 passed**, every value inside its bound; composite probe product path `dekker` |
| `npm run accept:gpu:hardware` | `apple` / `metal-3` | **PASS, 26 of 26 cases**: 100.00 % of pixels within ΔE2000 1 in every case, largest ΔE2000 0.0018, largest \|Δ\|/σ 0.002, the 8-bit display codes equal to the reference's in every pixel |

The rows are in [docs/WEBGPU_DEVICES.md](WEBGPU_DEVICES.md#runs) (the two November 7, 2026 rows); the acceptance record is [display-view-acceptance-m5-pro-2026-11-07-ecb1068](validation/display-view-acceptance-m5-pro-2026-11-07-ecb1068/README.md).

## Same package

The candidate's packed tarball (`npm pack`, 919 files) was compared file by file with a local `npm pack` of `v2.15.0` (`0e2232f`, 913 files), whose shasum `ac1cc9d9a956579809a1bf60eda7a9bc2d58ba66` equals the published `@photivra/engine@2.15.0` tarball's.

**Added:** `dist/facade/defocus-image-space-provider.*` (#548) and `dist/processing/development-detail.*` (#552), 3 files each.

**Changed:**

| Files | Difference |
| --- | --- |
| `dist/facade/display-view.*`, `dist/facade/simulate-display-view.*`, `dist/gpu/display-view-*-gpu.*`, `dist/gpu/wgsl-display-view-*-kernel.*` | #533's highlight count (CPU and GPU), and #556's gain in the display view |
| `dist/capture/native-raw-development.*`, `dist/capture/raw-development-kernel.*`, `dist/gpu/image-kernel-accelerator.*`, `docs/api/capture-native-raw-development.md` | #556 |
| `dist/capture/native-environment-lean.*`, `dist/core/internal-radiance-evaluator.*`, `dist/facade/diffraction-provider.*`, `dist/optics/defocus-disc-kernel.*`, `dist/optics/sensor-environment-query.*`, `docs/api/optics-defocus-disc-kernel.md` | #548 |
| `dist/facade/simulate-capture.*`, `docs/api/facade-simulate-capture.md`, `docs/QUICK_START.md` | #548, #552, #556 and the integration |
| `docs/USAGE.md` | #533, #556 and #400 |
| `THIRD_PARTY.md` | #552's published references |
| `SECURITY.md` | the current release, 2.15.0 (#400) |
| `CHANGELOG.md`, `README.md`, `CITATION.cff` | the 2.16.0 entry and version |
| `package.json`, `dist/core/version.*`, `dist/index.*`, `docs/API_REFERENCE.md`, `docs/api/core-version.md`, `docs/api/exports.json` | the version and the new exports |

## For the owner

- `THIRD_PARTY.md` records no public-record patent check for the unsharp mask and Wiener deconvolution (#552), both long-published methods; it is left for the owner's review with the others.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.16.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] The four part branches merged into this pull request.
- [x] Version surfaces aligned at 2.16.0 (`npm run release:prepare -- 2.16.0`). Root exports 1,810.
- [x] Packed tarball compared with the published 2.15.0 (above).
- [x] WebGPU hardware gate on the integrated tree (above).
- [x] Green CI on this pull request, then on `main` after merge ([CI run 42418921744](https://github.com/Photivra/photivra/actions/runs/42418921744) on `4fa2268`).
- [x] The owner's approval to tag `v2.16.0` ("Merge and tag when green", then approval to publish to npm, November 7, 2026).
- [x] The `v2.16.0` tag on the `main` commit that merges this record (`4fa2268`).
- [ ] After publication:
  - [x] npm version, dist-tag, integrity and provenance verified ([Publication](#publication));
  - [ ] GitHub release notes published (none for `v2.16.0` when this was checked, November 7, 2026);
  - [x] publication dates updated in `CHANGELOG.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record (with the 2.17.0 preparation).

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.16.0` → `4fa2268fb1a76fa9a146f8b5f522ac0db0684a13` (#562), after `main` CI on that commit passed ([CI run 42418921744](https://github.com/Photivra/photivra/actions/runs/42418921744)) |
| Publish workflow | [Publish npm run 42419222925](https://github.com/Photivra/photivra/actions/runs/42419222925): coverage shards 6.7–12.4 min and gate 0.8 min passed, `verify` passed 22:08:59–22:11:12 UTC, `publish` passed 22:22:17–22:22:30 UTC |
| npm | `@photivra/engine@2.16.0`, dist-tag `latest`, registry time 22:24:04 UTC |
| Integrity | `sha512-YFU3vi0tR0Xyc+6CZ7KcqmRbSatyxxLfGGk8IrnIL6/NRVKmLgNxNeX3VSFLvpzBzAwReZ0GHOr6pcW+WUkIPQ==` (shasum `e6c721121ad458e75531dbcd7551d8ae8916210d`, 919 files) |
| Provenance | The registry lists an SLSA v1 provenance attestation for 2.16.0 |
