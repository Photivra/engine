# 2.13.0 release

> **Published October 31, 2026.** The `v2.13.0` tag is on `9c3fe85` (#530), after `main` CI on that commit had passed; npm publishing ran from the tag ([Publication](#publication)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.13.0`, with `ENGINE_API_VERSION = "2.13.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** 13 new root exports, new optional request options and new result fields, with nothing removed and no breaking change to the 2.x API: Auto ISO photographer-set limits (#505, #523) and an automatic slowest shutter (#504, #529), the illuminance at which the settings give the standard exposure (#528), and `addJpegTextMetadata` / `addPngTextMetadata` at the root (#388, #522). They are for the app's Beta camera (Photivra/apps#135, Auto ISO; Photivra/apps#124, the exposure meter) and let the app delete its copy of the text-metadata writer.
- **Results:** in 22 fingerprinted results against the published 2.12.0, every capture sample, RAW code and file (JPEG, PNG, DNG), the bilinear (Speed) display views and the ideal reference are byte-identical. The four AHD (Quality) display views change, as #457's fix intends, and each is closer to the capture than 2.12.0's ([Results against 2.12.0](#results-against-2120)).

## Scope

Every pull request merged since `v2.12.0` (`9d29475`), and this record:

| Change | Pull request |
| --- | --- |
| Diffraction provider: gather only each band's own values (#419) | #524 |
| Tests and CI: three hash locks are x64 locks, with recorded arm64 hashes (#508) | #526 |
| Print JPEG task: block samples in one reused `Uint8Array`, same bytes (#417) | #520 |
| Display view, AHD (Quality): the expected value follows AHD's choice (#457) | #527 |
| Display-view bundle size: measured and guarded (#383) | #521 |
| `exposure.standardExposureIlluminanceLux` | #528 |
| Root exports `addJpegTextMetadata` and `addPngTextMetadata` (#388) | #522 |
| Auto ISO: photographer-set limits, separate from the body's capability (#505) | #523 |
| Auto ISO: an automatic slowest shutter from the lens and hand shake (#504) | #529 |
| 2.13.0 release preparation: version, changelog, this record, and the 2.12.0 publication record | this pull request |

The full entries, with their tests and measurements, are in [CHANGELOG.md](../CHANGELOG.md) under 2.13.0.

## What changed, with evidence

### New

- **Photographer-set Auto ISO limits (#505, #523).** `autoIsoLimits: { maximum, minimum? }` (`AutoIsoLimits`) on all five Auto ISO resolvers and `exposure.autoIso.limits` in `simulateCapture`, the display view and the ideal reference. The limits narrow the body's Auto ISO range and are policy, not capability. They must be selectable ISOs inside the range; nothing is clipped. `ExposureResolutionConstraint` gains `"user-iso-maximum"` and `"user-iso-minimum"`, reported only when a limit strictly inside the body's range holds the ISO. **Tests:** `test/auto-iso-limits.test.ts` covers each resolver at both limits with the exact residual, shows that limits equal to the body's range give the same results as no limits, and checks the invalid inputs.
- **An automatic slowest shutter (#504, #529).** `estimateAutoIsoSlowestShutter()` (approximation, model `camera-shake-blur-budget-slowest-shutter` 1.0.0). It gives the exposure time at which `estimateCameraShakeBlur()`'s stabilized blur equals a blur budget, then applies a whole-stop bias. `GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC` is a labelled generic default from Xiao et al., Proc. SPIE 7250 (2009), and describes a phone, not any camera. In `simulateCapture`, `exposure.autoIso.slowestPreferredShutterSeconds` accepts `"auto"` in aperture priority and is optional in program. **Tests:** `test/auto-iso-slowest-shutter.test.ts` checks the closed form against the shake model, focal length, stabilization (2^stops), the bias, snapping and invalid inputs. `test/simulate-capture-auto-iso.test.ts` covers the facade.
- **The illuminance for the standard exposure (#528).** The capture's and the display view's `exposure` gain `standardExposureIlluminanceLux` = E·2^Δ, from the same CIPA DC-004-2020 relations as `standardExposureDeviationStops`. **Tests:** `test/exposure-standard-illuminance.test.ts` shows that re-running at the reported illuminance meters at |Δ| < 10⁻⁹ stops.
- **`addJpegTextMetadata` and `addPngTextMetadata` (#388, #522).** These are the functions `output.metadata` already calls, so a caller-encoded file gets the same bytes as a whole-frame capture with `output.metadata`. **Tests:** `test/output-text-metadata.test.ts` locks SHA-256 digests that were recorded three ways and agreed: the app's copy, `output.metadata`, and the exports.

### Fixed: the Quality (AHD) display view follows AHD's choice (#457, #527)

**Before:** the display view averaged AHD's two directional candidates at every pixel. Where fine structure decides AHD's choice, the capture takes one candidate instead. At set F's Siemens star centre (24 MP, 2028 wide), the view was 5.13 codes RMS from the capture (limit 2).

**Change:** the view runs AHD's own steps on the noise-free mosaic and takes the chosen candidate's expected value. Ties keep the average, which covers every flat neighbourhood, and the noise terms are unchanged.

**Evidence (#527):**
- set F star centre 5.13 → 0.78 codes RMS;
- the view's direction equals `createAhdDemosaicTask`'s direction map at every pixel (`test/display-view-ahd-choice.test.ts`);
- 50 of the default matrix's 75 Quality cases change, and none leaves a limit;
- three hash locks were re-recorded on Linux x64, each closer to the capture.

**Costs:**
- **CPU time:** +12–15 % on the app's Quality request.
- **Bundle size:** +3,307 B minified / +1,294 B gzip to the display view's addition.
- **GPU (Quality):** the GPU kernel still renders the average and flags the pixels where the choice matters, and the CPU recomputes them. Busy scenes therefore recompute a large share on the CPU (3–75 % of the emulation fixtures' pixels).

### Tests, measurements and speed with the same output

- **Diffraction captures (#419, #524).** Each band gathers only its own values. These are the same products, added in the same order, so the result is the same bit for bit: `Object.is` on 2,354,304 provider values, and SHA-256 on twelve captures. Measured 7.2 → 1.8 s total on a Quality function scene at 96 × 72 (Node 24.19.0, a loaded shared machine; medians).
- **Print JPEG task (#417, #520).** Each block's samples go into one reused `Uint8Array`. The files' SHA-256 equals the previous build's for nine plans. Measured ×0.91–0.96, below #417's profiled ceiling.
- **Display-view bundle size (#383, #521).** Tests and documentation only. The display view's addition is measured, and a test keeps it within a budget. Another test keeps the GPU display-view code out of a split bundle's first load. #383's 40 % reduction target is not met (CHANGELOG, "Display-view bundle size").
- **Hash locks on arm64 (#508, #526).** Tests and CI only. Three lock files assert recorded arm64 hashes on arm64 and the unchanged x64 hashes on x64.

### Results against 2.12.0

This uses the same method and script as 2.12.0's record (#519), extended with Quality display views. 22 whole results were rendered with the published `@photivra/engine@2.12.0` (npm) and with this candidate's build, on Node 24.19.0 (Apple silicon, arm64). The engine version was normalized: the 2.12.0 copy's `ENGINE_API_VERSION` was set to 2.13.0, so the DNG Software tag and the provenance match.

The 22 results:
- **The 17 results of 2.12.0's fingerprint:** 15 `simulateCapture` requests, one bilinear `simulateDisplayView` and one `simulateIdealReference`. The captures cover:
  - the step wedge, slanted edge and Siemens star;
  - manual, aperture priority, shutter priority, and program with −1 stop compensation;
  - ISO 1600;
  - JPEG, 16-bit PNG and DNG;
  - a fixed 3200 K white balance;
  - a 2856 K light at 100 lx;
  - diffraction at f/16;
  - a region;
  - AHD.
- **Five more display views at 48 × 32:**
  - the Siemens star with the bilinear demosaic (Speed);
  - the Siemens star with AHD;
  - the Siemens star with Quality options (diffraction, four-spot filter, AHD);
  - the step wedge with AHD;
  - the slanted edge with AHD.

Every typed array (100) was hashed with SHA-256. Everything else was compared as JSON, with timings removed and only the new `exposure.standardExposureIlluminanceLux` left out. 2.12.0's `isoControl` and `standardExposureDeviationStops` are compared this time.

| Results | Arrays | Other fields |
| --- | --- | --- |
| 15 captures, the ideal reference, the bilinear step-wedge and star views (18) | **identical** (96) | **identical** |
| The four AHD display views | `image.samples` **differ** (4) | only `diagnostics.sceneLookups` differs (for example 61,440 → 65,439), because the choice reads 5 sites around each pixel, as #527 records |

How much the AHD views changed, and whether they moved toward the capture, is shown below. The reference is the mean over 7 noise seeds of the 96 × 64 capture, averaged in 2 × 2 boxes to 48 × 32. This comparison is an approximation: one view realization against a 7-seed mean, at a box-filter display scale.

| View (48 × 32, 4,608 8-bit values) | Values changed | Largest change (codes) | RMS from capture mean, 2.12.0 → 2.13.0 |
| --- | --- | --- | --- |
| Siemens star, AHD | 2,289 | 175 | 25.64 → 17.07 |
| Siemens star, Quality | 2,189 | 41 | 7.47 → 5.01 |
| Step wedge, AHD | 2,631 | 17 | 3.76 → 1.05 |
| Slanted edge, AHD | 313 | 69 | 5.55 → 1.90 |

**Why the bytes change:** the AHD view now takes AHD's chosen candidate where the scene decides it (#457, #527). That is the only change in `src/` that alters output. The diffraction (#419) and print JPEG (#417) changes keep their bytes, and the new options (#504, #505) change nothing when absent. Every view moved closer to the capture.

The print JPEG task (#417) is not in this fingerprint. Its same-bytes evidence is #520's nine SHA-256 comparisons and the JPEG hash locks.

## Compatibility

- **Root exports: 1,780** (2.12.0: 1,767). These 13 are new, and none is removed or changed in name, source or kind (`docs/api/exports.json` compared with `v2.12.0`'s):
  - **Functions:** `addJpegTextMetadata`, `addPngTextMetadata` and `estimateAutoIsoSlowestShutter`.
  - **Constants:** `AUTO_ISO_SLOWEST_SHUTTER_MAXIMUM_BIAS_STOPS`, `AUTO_ISO_SLOWEST_SHUTTER_MODEL_VERSION` and `GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC`.
  - **Types:** `AutoIsoLimits`, `AutoIsoSlowestShutterBlurBudget`, `AutoIsoSlowestShutterEstimate`, `EstimateAutoIsoSlowestShutterInput`, `ProgramSlowestPreferredShutterPolicy`, `SimulateCaptureAutomaticSlowestShutterOptions` and `SimulateCaptureAutomaticSlowestShutterReport`.
- **New inputs and results only:** new optional inputs (`autoIsoLimits`, `exposure.autoIso.limits`, `"auto"` slowest shutter, `exposure.autoIso.automaticSlowestShutter`). New result fields (`exposure.standardExposureIlluminanceLux`, and `limits` and `automaticSlowestShutter` in the Auto ISO report). No field is removed or retyped.
- **One output union widens:** `ExposureResolutionConstraint` gains `"user-iso-maximum"` and `"user-iso-minimum"`, which appear only when the new limits are given. TypeScript code with an exhaustive `switch` over this type will need the two cases when it updates.
- **No default changes:** captures, RAW codes and files are the same for the same request. **Display views with `demosaic: "ahd"` change** (above). Apps that cache or compare those bytes should expect new values.

## Rights and licensing

No third-party code, data or dependencies are added. The hand-shake default cites Xiao, Farrell, Catrysse and Wandell, Proc. SPIE 7250 (2009), and Xiao et al., Proc. SPIE 6502 (2007): published numbers, used as a labelled generic default (free author copy). The standard-exposure illuminance uses CIPA DC-004-2020 (free), already the engine's exposure reference. AHD is Hirakawa & Parks (2005), already implemented by `createAhdDemosaicTask`.

## Privacy and security

No network, persistence or telemetry is added. The JPEG text writer now rejects more malformed input with a domain error (#388).

## Release gates

1. **GitHub CI** on the exact commit that is tagged (the `main` commit that merges this record), including the `webgpu conformance (SwiftShader)` job. Tag it only when its CI is green.
2. **Hardware acceptance: for the owner to decide.** Unlike 2.12.0, `src/gpu/` changed since `v2.12.0`: `display-view-quality-gpu.ts` and `wgsl-display-view-quality-kernel.ts` (#527, the `ahdChoice` flag and CPU recompute).
   - **Evidence so far:** #527 ran `npm run test:webgpu` (all four suites, 167 tests, headless Chromium on the M5 Pro's GPU), which passed, and CI runs the SwiftShader conformance job.
   - **Not yet run:** the 2.11.0-style gate on the commit to be tagged, `npm run accept:gpu:hardware -- --record …` and `npm run test:webgpu:hardware` ([Display view, Preview acceptance](DISPLAY_VIEW.md#preview-acceptance); [WebGPU, Running on hardware](WEBGPU.md#running-on-hardware)).

## Remaining release checklist

- [x] #520–#524, #526–#529 merged with their changelog entries.
- [x] Version surfaces aligned at 2.13.0 (`npm run release:prepare -- 2.13.0`). Root exports 1,780.
- [x] Fingerprint against the published 2.12.0: captures, files, bilinear views and the ideal reference identical; AHD views changed as intended and closer to the capture (above).
- [x] 2.12.0 recorded as published (`CHANGELOG.md`, `SECURITY.md`, [its record](RELEASE_2_12_0.md)). #388's changelog entry moved from 2.12.0 to 2.13.0, where it belongs: it merged after the `v2.12.0` tag and is not in the published package.
- [x] Owner's review of this record.
- [ ] Owner's decision on hardware acceptance for the `src/gpu/` change (above): the tag was made without a recorded `accept:gpu:hardware` / `test:webgpu:hardware` run on `9c3fe85`; no decision is recorded in the repository.
- [x] Green CI on this pull request, then on `main` after merge ([CI run 41247317459](https://github.com/Photivra/engine/actions/runs/41247317459) on `9c3fe85`).
- [x] **The owner's explicit approval to tag `v2.13.0`** on `9c3fe85`.
- [x] After publication: npm version, dist-tag, integrity and provenance verified ([Publication](#publication)); GitHub release notes published (`@photivra/engine 2.13.0`, 22:58:56 UTC); publication dates updated in `CHANGELOG.md`, `SECURITY.md` and this record by the 2.14.0 release preparation.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.13.0` → `9c3fe854d694447bd24c94737b65644fbaef2567` (#530), after `main` CI on that commit passed ([CI run 41247317459](https://github.com/Photivra/engine/actions/runs/41247317459)) |
| Publish workflow | [Publish npm run 32](https://github.com/Photivra/engine/actions/runs/41250139790): coverage shards (6–9 s each) and gate passed on the coverage proof, `verify` passed 22:53:05–22:55:47 UTC, `publish` passed 22:55:50–22:56:04 UTC |
| npm | `@photivra/engine@2.13.0`, dist-tag `latest`, registry time 22:58:10 UTC |
| Integrity | `sha512-PwpHapZpEEQOy3vUHAAjBxET6lZuG9LtdR462fASL6u8x2sABK6+bPkfTJ+XS+kPpG4a5V4yzqm+is3ePKGo3g==` (shasum `e7a89aa2b56730821d6c411f0bc4bf9532987376`, 908 files) |
| Provenance | The registry lists an SLSA v1 provenance attestation for 2.13.0 |
