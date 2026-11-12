# 2.2.0 release candidate

> **Published October 17, 2026.** The owner tagged `v2.2.0` on `bf20458` and published the GitHub release; npm publishing ran from the tag. See [Publication](#publication). The record below is kept as the release request it was.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.2.0`, with `ENGINE_API_VERSION = "2.2.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** every change is additive and opt-in, or a fix. Without the new inputs, and at the default 6 µm pixel pitch, every request, plan, RAW, image and encoded file is byte-identical to 2.1.0. No root export is removed, and no input that 2.1.0 accepted is rejected. At pitches other than 6 µm the brightness fix changes the output on purpose: 2.1.0 gave a different brightness for the same exposure depending on pixel size, which was wrong.
- **Why now:** both changes came from adding real sensor formats and resolutions to the Photivra app. About a quarter of real pixel pitches crashed `simulateCapture`, image brightness changed with pixel size, and the full-resolution stages stopped at 24 MP, below today's 100 MP sensors. The owner's rule of October 17, 2026 applies: slow or heavy features become opt-in settings with a measured cost, never omissions.
- **What this release does not claim:** calibrated accuracy for any real camera, lens or sensor. The charge capacity that follows the scaled ISO signal chain is labelled an approximation, not a full-well model. A 100 MP `simulateCapture` time is extrapolated, not measured, and browsers may fail to allocate large images.

## Scope

| PR | Change | Kind |
| --- | --- | --- |
| [#336](https://github.com/Photivra/engine/pull/336) | `simulateCapture` accepts pixel pitches that failed the aperture fit by one unit in the last place; ISO calibration no longer depends on pixel size (new assumption `sensor.isoAreaNormalization`) | Fix (byte-identical at 6 µm) |
| [#337](https://github.com/Photivra/engine/pull/337) | Opt-in pixel limits up to 2^27 on every full-resolution stage and `simulateCapture` `output.maximumPixels`; `FULL_RESOLUTION_DEFAULT_PIXELS`, `FULL_RESOLUTION_CEILING_PIXELS`, `PRINT_JPEG_LIMITS`; measured cost of large images | Additive, opt-in |
| This update | Version 2.2.0, changelog and this record | Release preparation |

Root exports grow from 1,677 to 1,680 symbols (the three constants above). Comparing the generated `docs/api/exports.json` with `v2.1.0` shows none removed.

## Fixed: pixel pitches rejected by a rounding error

**Problem.** `simulateCapture` failed with `INVALID_SCIENTIFIC_INPUT` ("Declared geometric sensitive aperture does not fit within the supplied physical imaging area") for about a quarter of real pixel pitches, for example 9.287925696594426 µm (36 mm / 3876 px).

**Cause.** The facade gives the imaging width as `n · pitch / 1000` mm. `resolveSensorSamplingAperture` converted it back to micrometres and compared it strictly with the far aperture edge `pitch/2 + (n − 1)·pitch + pitch/2`. Both are the same exact value reached by different rounded floating-point operations, and they can differ by one unit in the last place: 34 × 9.287925696594426 µm gives 315.78947368421046 µm one way and 315.7894736842105 µm the other.

**Fix.** The lattice, complete-grid and per-site fit tests allow 8 ε (about 1.8 × 10⁻¹⁵) of the imaging extent for rounding. The lean environment path uses the same internal helper. Anything larger is still rejected: tests cover a 10⁻⁹ µm excess on either side, an imaging area 10⁻¹² smaller, and a lattice a whole site too long. The public API is unchanged.

**Evidence.**

- Sweep of the app's 107 pitches (nine sensor formats at twelve resolutions) × output sizes 32, 48, 64 and 96 × margin and mirror borders × bilinear and AHD: 2.1.0 fails 373 of 1,712 cases, 2.2.0 fails none.
- `test/simulate-capture-pitch.test.ts`: the 107 app pitches plus 200 seeded random pitches in 0.5–100 µm, at four output sizes and three border cases, asserting that more than 100 cases would fail a strict comparison; real facade runs aborted after the first RAW tile at every app pitch with both borders and both demosaics.
- `test/sampling-aperture.test.ts`: the exact one-ULP regression and the oversized rejections. The new tests fail on the unfixed source.

## Fixed: image brightness depended on pixel size

**Problem.** The tier's ISO signal chain (conversion gain, saturation signal and read noise per ISO setting) and its 60 000 e⁻ charge capacity are declared for a 6 µm pixel, but the facade applied them per pixel at every pitch. Smaller pixels collect fewer electrons, so the same exposure gave a darker image. Full frame, f/8, 1/125 s, ISO 100, 18 % grey: the 8-bit sRGB mean was 49.5 at 100 MP, 101.2 at 24 MP and 255 (clipped) at 1 MP.

**Fix.** For every ISO regime the facade multiplies the system conversion gain (e⁻ per code) and the pre-ADC saturation signal by the area ratio pitch²/36 µm². Codes, black level, ADC and digital gain are unchanged; read noise (e⁻) and the synthetic dark current stay per pixel. The charge capacity follows the scaled base-ISO saturation signal, the facade's existing rule. When the pitch is not 6 µm, the new assumption `sensor.isoAreaNormalization` (kind `model`) records the reference and aperture areas, the ratio, the citations and the caveat. At 6 µm the ratio is exactly 1 and nothing changes.

### Science evidence

- **ISO rating is independent of pixel size.** Standard output sensitivity is S = 10/H, with H the focal-plane exposure in lx·s that produces the standard output (CIPA DC-004-2020, *Sensitivity of Digital Cameras*, §3.2; free at <https://www.cipa.jp/e/std/std-sec.html>). It is defined by the camera's output for a given exposure, not by any per-pixel quantity, so the same exposure at the same ISO must give the same output level at any pixel size. The facade already uses this relation for metering.
- **Signal per pixel is proportional to pixel area.** The mean number of photons collected by a pixel is μp = A·E·t/(hν), with A the pixel area, E the irradiance, t the exposure time and hν the photon energy (EMVA Standard 1288 Release 4.0 Linear, §2.1, Eq. 3; free at <https://www.emva.org/standards-technology/emva-1288/>). Holding S fixed therefore requires the electrons-per-code conversion to scale with A, which is what the facade does.
- **Consequence for noise.** A smaller pixel collects fewer electrons for the same exposure, so shot-noise SNR = √N_e falls. The measured per-pixel green standard deviation rises as pixels shrink: 0.18 codes at 29.4 µm, 0.93 at 6 µm and 1.83 at 2.9 µm.
- **Charge capacity is an approximation, labelled as such.** Scaling the capacity with area keeps the tier's ISO rating and its half stop of highlight headroom fixed; it is not a measured full-well model. Published data show full-well capacity growing with pixel size but less than in proportion to area: J. Farrell, F. Xiao and S. Kavusi, "Resolution and light sensitivity tradeoff with pixel size", *Proc. SPIE* 6069, Digital Photography II, 60690N (2006), doi:[10.1117/12.646805](https://doi.org/10.1117/12.646805), Table 1 (about 16 000 e⁻ at 2 µm and 37 500 e⁻ at 5.2 µm); T. Chen, P. Catrysse, A. El Gamal and B. Wandell, "How small should pixel size be?", *Proc. SPIE* 3965, Sensors and Camera Systems for Scientific, Industrial, and Digital Photography Applications, 451 (2000), doi:[10.1117/12.385463](https://doi.org/10.1117/12.385463), which models the photodiode capacitance as roughly linear in pixel side. A real large-pixel sensor may therefore saturate earlier, and a real small-pixel sensor would usually be given a higher base ISO. `docs/QUICK_START.md` ("ISO and pixel size") and the assumption state this.

### Measurements

Full frame (36 × 24 mm), f/8, 1/125 s, ISO 100, 18 % grey card, 8-bit sRGB mean:

| Resolution (pitch) | 2.1.0 | 2.2.0 |
| --- | --- | --- |
| 100 MP | 49.5 | 101.2 |
| 24 MP (6 µm) | 101.2 | 101.2 |
| 10 MP | error (aperture fit) | 101.2 |
| 1 MP | 255 (clipped) | 101.2 |

A 6.4 × 4.8 mm phone sensor at 100 MP (0.554 µm pitch) goes from 3.7 to 100.2, with green standard deviation 10.0 (noise about 1/pitch). The linear RAW mean is flat within 1 % from 0.554 to 30 µm. Below about 1 µm the 8-bit sRGB mean falls slightly (about 1 code at 0.55 µm) although the linear RAW mean is unchanged: strong noise passed through the concave sRGB curve lowers the mean of the encoded values.

`test/simulate-capture-pitch.test.ts` checks brightness flatness, monotone noise, the regime scaling, unchanged read noise, the recorded assumption, and that an explicit 6 µm pitch is byte-identical to the default.

## Added: opt-in limits for full-resolution images up to 2^27 pixels

**Problem.** Every full-resolution stage admitted at most 24 000 000 pixels (PNG: 100 000 000), and `simulateCapture` at most 4094 × 4094 output pixels. Current 100 MP sensors (12 252 × 8 168, 11 552 × 8 664) could not be simulated or encoded at full size.

**Change.** Each stage gains an optional input named like its limit, bounded by one ceiling of 2^27 = 134 217 728 pixels (16 384 × 8 192): `maximumPixels` on native RAW (`NATIVE_RAW_LIMITS.ceilingPixels`), native capture SDR, irradiance convolution, temporal exposure sum, Print JPEG (new `PRINT_JPEG_LIMITS`) and `serializePngImage`; `maximumRegionSites` on `simulatePackedSensorRaw`; `maximumQueries` on `calculateChartRadianceBatch`. Each value must be a safe integer from 1 to the ceiling (one strict validator, `src/core/pixel-limits.ts`). `simulateCapture` gains `output.maximumPixels`, the most native sites (output plus demosaic margin) a capture may allocate; with it each side may reach 16 384 sites. A raised native RAW limit is recorded in the plan (only when given, so default plans keep their shape) and raises the native environment whole-event query budget ceiling in proportion (2 000 000 000 per 24 000 000 pixels); a raised Print JPEG limit raises its `maximumEncodedBytes` ceiling the same way (256 000 000 bytes per 24 000 000 pixels) and is recorded in the JPEG's XMP plan. Byte budgets still apply. AHD keeps its 2^26-site limit, now checked before any work.

**Why 2^27.** It covers both 100 MP formats plus their demosaic margin with about a third to spare, and it is the size at which the pipeline's largest array, the development's interleaved float64 RGB (24 bytes per pixel), reaches 3 GiB, just under the `ArrayBuffer` limit of about 4 GiB or less in JavaScript engines.

### Measured cost of large images

One fresh Node process per stage and size (Node 24.21.0, 4-vCPU Intel Xeon 2.80 GHz, Linux, one run each, single thread), 100 MP measured on 12 252 × 8 168. Synthetic inputs; encoder times depend on content. Peak memory is peak resident memory minus the idle runtime, per pixel. Full method and every row: `docs/QUICK_START.md`, "Large images". Not a performance claim.

| Stage | 1 MP | 24 MP | 100.07 MP | Peak memory per pixel |
| --- | --- | --- | --- | --- |
| Irradiance convolution, radius 2 | 0.32 s | 6.5 s | 27.7 s | 12 B |
| Temporal exposure sum, 8 nodes | 0.56 s | 9.7 s | 42.0 s | 12 B |
| Packed sensor RAW | 0.60 s | 11.9 s | 48.2 s | 11 B |
| Chart radiance batch, one wavelength | 0.13 s | 2.6 s | 13.0 s | 17 B |
| PNG, 8-bit / 16-bit sRGB | 0.31 / 0.57 s | 2.7 / 5.1 s | 22.7 / 40.7 s | 8 / 15 B |
| Print JPEG, 1:1 | 0.84 s | 19.5 s | 69.7 s | 10 B |
| Native capture SDR, 8-bit | 0.07 s | 1.6 s | 5.8 s | 4 B |
| Native RAW DNG writer | 0.07 s | 1.7 s | 6.4 s | 17 B |
| Native RAW development to 8-bit sRGB | 0.34 s | 5.2 s | 20.5 s | 10 B |
| `simulateCapture`, default options | 129 s | — (16 MP: 1 973 s) | about 3.4 h (extrapolated) | 34 B at 16 MP |

`simulateCapture` was measured at 0.26, 1, 4 and 16 MP (133, 129, 125 and 123 s per MP, almost all per-site RAW simulation); 100 MP is extrapolated to about 12 300 s and 3.4 GB. A 100 MP noisy-data JPEG measured 255.7 MB, inside the scaled byte budget. The DNG writer's single strip is about 200 MB at 100 MP, within 32-bit TIFF offsets.

**Evidence.** `test/full-resolution-limits.test.ts` (16 tests): strict validation on every stage and the facade; default rejection and opt-in acceptance of both 100 MP rasters (metadata only, without allocating); byte budgets still enforced; budget scaling at exact boundaries; default plan shape; AHD up-front rejection; small opt-in captures byte-identical to the default in sRGB 8-bit, PNG, JPEG and DNG; one real convolution above the 24 MP default.

**Not in scope.** Processing operators (AHD, denoise, HDR) still cap at 2^26 pixels. There is no up-front query-budget check for heavy options at 100 MP (a run fails mid-way, as before). The repository-only `native-separable-emission-experimental.ts` still uses the fixed 2 × 10⁹ budget.

## Compatibility

- **Additive:** three root constants; optional inputs on nine stages and `simulateCapture` `output.maximumPixels`; an optional `maximumPixels` in native RAW plans and the JPEG XMP plan, present only when given; the assumption `sensor.isoAreaNormalization`, present only when the pitch is not 6 µm.
- **Now accepted:** pixel pitches that 2.1.0 rejected by a rounding error, and sizes above the old defaults when the caller raises a limit. No input that 2.1.0 accepted is rejected.
- **Output unchanged at the defaults:** the 2.0.0 hash lock in `test/simulate-capture-optics.test.ts` (RAW codes, every output byte, assumptions, composed contracts and diagnostics of six captures: sRGB, PNG, JPEG with auto white balance, mirror borders with 16-bit output, Display P3, DNG in program mode) and the `simulateCapture` digest baseline in `test/simulate-capture-integration.test.ts` pass unchanged. The lock already writes the engine version in the DNG Software tag ("Photivra 2.2.0", same length) back to the 2.0.0 name before hashing, so this release needs no change to it.
- **Output changed on purpose:** at pitches other than 6 µm, image brightness, noise and charge capacity follow the ISO area normalization above. An application that relied on the 2.1.0 brightness at those pitches should expect brighter (small pixels) or unclipped (large pixels) images, now consistent with the ISO setting.

## Rights and licensing

- **No third-party code, data or constants added.** The area normalization uses the engine's own tier values and a ratio of areas; the pixel limits are engine constants. The cited documents are used for relations and published facts, not copied.
- **Free sources cited:** CIPA DC-004-2020 (free translation), EMVA 1288 Release 4.0 (free). The Farrell et al. and Chen et al. SPIE papers are cited for the caveat only; no data from them enters the engine.
- **No new runtime dependency.** `package.json` and `package-lock.json` changed only in their version fields. The licence-scan CI job passed on both PRs.

## Privacy and security

No network, persistence or telemetry is added. The raised limits are opt-in, strictly validated (safe integers from 1 to 2^27) and checked before allocation, so the defaults keep their memory protection; byte budgets still apply. Large allocations may still fail in a browser with a `RangeError`; `docs/QUICK_START.md` advises running large captures in a Web Worker with a cancel signal.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record update. Tag it only when its CI is green.

- #336 and #337 each passed every CI job on their pull requests: `verify` on Node 22.13.0, lts/-1, lts/* and current (with coverage, docs and package gates on the primary leg); the licence scan; and the macOS hash locks ([CI run 849](https://github.com/Photivra/engine/actions/runs/39065881580), [CI run 851](https://github.com/Photivra/engine/actions/runs/39068891519)). Both passed CI on `main` after merge ([CI run 850](https://github.com/Photivra/engine/actions/runs/39066490000) on `c0f67e2`, [CI run 852](https://github.com/Photivra/engine/actions/runs/39069478972) on `85a08e5`, the base of this update).
- Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] All 2.2 work merged (#336, #337) with changelog entries.
- [x] Version surfaces aligned at 2.2.0 (`npm run release:prepare -- 2.2.0`); API reference regenerated.
- [x] Owner's review of this record.
- [x] Green CI on this update's pull request (#338), then on `main` after merge ([CI run 854](https://github.com/Photivra/engine/actions/runs/39070650369) on `bf20458`).
- [x] **The owner's explicit approval to tag `v2.2.0`.** The owner tagged `v2.2.0` on `bf20458`; `v2.1.0` is unchanged.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.2.0` → `bf20458d6a8b71c6a78ea765eaddcd3e5e0fe047` (#338) |
| Publish workflow | [Publish npm run 17](https://github.com/Photivra/engine/actions/runs/39076546190), passed; the provenance was signed at 22:52 UTC and the registry records publication at 22:55 UTC |
| npm | `@photivra/engine@2.2.0`, dist-tag `latest` |
| Integrity | `sha512-HsmWekS3mgwe6xQ3LQxgk9DB8nUpZqL7F2YE6jpUOK1WDmFk/ayWkdnD/Eh1lulj78nf7KtgN3zWP3tvF6dD4Q==` |
| Provenance | Signed SLSA provenance, published to the Sigstore transparency log (log index 3301918949) |
| Tarball contents | Identical, file for file, to `npm pack` of a clean local build of `v2.2.0` (checked October 17, 2026) |
| GitHub release | [@photivra/engine 2.2.0](https://github.com/Photivra/engine/releases/tag/v2.2.0) |
