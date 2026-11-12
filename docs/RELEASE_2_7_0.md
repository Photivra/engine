# 2.7.0 release candidate

> **Published October 24, 2026.** The owner tagged `v2.7.0` on `fabad7e` (#406) after `main` CI on that commit had passed, and published the GitHub release. npm publishing ran from the tag.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.7.0`, with `ENGINE_API_VERSION = "2.7.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:**
  - two additions: `prepareDisplayView` and caller material scenes;
  - three speed-ups that change no byte of any result.
  
  Every `simulateCapture`, `simulateIdealReference` and `simulateDisplayView` request that 2.6.0 accepted gives byte-identical results, apart from the engine version that results record. Root exports grow from 1,721 to 1,727 symbols (6 added, none removed).
- **Why now:** the Photivra app shows a sharp full-resolution preview (the display view at the frame's device pixels) and must reach it in about 10 seconds. On 2.6.0 the app's 2028 × 1352 preview took 11.2–11.9 minutes in Chromium on 4 workers (baseline recorded on Photivra/apps#97). The time went on bookkeeping around the physics, not on the physics:
  - re-evaluating the illuminant formula on every scene lookup;
  - re-reading the same real pixels' statistics and sites for every sample and every neighbouring display pixel;
  - repeating a request's setup for every region;
  - sending a chart with a printed label down the per-lookup radiance path.
- **Owner decisions (October 24, 2026):**
  - "Proceed" with the speed plan (Photivra/apps#97).
  - The site offers Speed only, with no Quality mode (Photivra/apps#99).
  - A fast/exact flag exists only where the fast method is less accurate for display and export. Where the methods match, only the fast code stays, and "rounding-only matches" (#395).
  - "Ship speed now, #379 in 2.8.0": the Quality noise fix planned for 2.7.0 moves to 2.8.0.
- **What this release does not claim:**
  - The timings are measured on the host named below and are not a promise for every device.
  - The display view remains an estimate of the resized capture, labelled `kind: "display-view"`. The known limit of its Quality noise is unchanged ([Known limit](#known-limit-quality-noise-at-small-footprints-379)).
  - A material scene's display view equals the reflectance-function form of the same scene to rounding, not bit for bit (measured bounds below).

## Scope

| Change | Public surface | Kind |
| --- | --- | --- |
| Scene illuminant evaluated once per wavelength (#401, issue #385) | Planar scene provider (captures and display views), batched chart radiance | Performance; same values |
| Display view: a sample's terms reused per real pixel (#402, issue #392 part 1) | `simulateDisplayView` | Performance; same values |
| Display view without diffraction: site values kept across display pixels (#403, issue #392 part 2) | `simulateDisplayView` | Performance; same values |
| Prepared display view (#404, issue #387) | `prepareDisplayView`, `PreparedDisplayView`, `PreparedDisplayViewRenderOptions` | Additive (new function) |
| Caller material scenes (#405, issue #386) | `scene: { kind: "material-function", … }`, `CallerMaterialScene`, `SceneMaterialPoint`, `CALLER_MATERIAL_SCENE_MAX_MATERIALS` | Additive (new scene form) |
| Version 2.7.0, changelog and this record | — | Release preparation |

Merge commits:
- #401 `f958d44`
- #402 `06302d1`
- #403 `66dc9c6`
- #404 `d97bce3`
- #405 `e7789b9`

Nothing else merged after 2.6.0 apart from #390 (CI coverage shards, repository only).

Open engine issues with no merged code are not part of this release:
- #379 (Quality noise model), moved to 2.8.0;
- #392 items 2 (with diffraction) and 3;
- #393, #394 and #395–#400 (the next speed and accuracy phases).

Root exports: the generated `docs/api/exports.json` lists 1,727 names; at `v2.6.0` it listed 1,721. The 6 added names are `prepareDisplayView`, `PreparedDisplayView`, `PreparedDisplayViewRenderOptions`, `CallerMaterialScene`, `SceneMaterialPoint` and `CALLER_MATERIAL_SCENE_MAX_MATERIALS`; none is removed.

## What changed, with evidence

The timings below are from one thread on a 4-vCPU Linux container with Node 24.21.0. The request is a 24 MP full frame (6000 × 4000 at 6 µm) at f/8 and ISO 100, with the app's All-in-one composite chart and a 2 × 2 box aperture. The region is the 2028 × 1352 display view's centre strip, rows 660–667, unless stated otherwise. Before and after use the same build otherwise, and the sample hashes are identical.

### Scene illuminant once per wavelength (#401, issue #385)

**Before:** the planar scene provider and the batched chart radiance evaluated the illuminant's spectrum on every scene lookup. That is Planck's law, CIE A or the daylight locus: two transcendental evaluations per call.

**Now:** each provider keeps a table per distinct wavelength (at most 4,096), filled with the same call. The product keeps its order, `value × irradianceScale × shape / π`.

**Why the values cannot change:** a prepared spectrum is a pure function of the wavelength, so the table returns the same double.

**Tests:** `test/tabulated-spectrum.test.ts` checks `Object.is` equality with `evaluate`, one evaluation per wavelength, the size limit and that errors pass through. All hash locks pass.

| Request | 2.6.0 | After #401 |
| --- | --- | --- |
| Caller reflectance-function scene, defaults | 15.0 / 15.2 s | 8.8 / 8.5 s |
| Same, with diffraction, four-spot filter and AHD | 185 / 174 s | 113 / 116 s |
| Chart preset, defaults / Quality options | 2.2–2.5 / 7.9–8.9 s | 2.0–2.2 / 7.4–7.6 s |

### Display view: a sample's terms reused per real pixel (#402)

At device-pixel sizes a display pixel covers a few real pixels (2.96 × 2.96 here), so its 256 samples land on each of them many times. A sample's 37 recorded terms depend only on its real pixel. They are replayed for later samples of that real pixel in the same display pixel, adding the same values to the same sums in the same order. This happens only where every site lies in the window's site cache, so no diagnostic changes.

**Tests:**
- the six display-view hash locks;
- two new locks recorded on 2.6.0 for views barely smaller than the frame;
- 120 further views hashed identically before and after: 6, 3.76 and 1.4 µm sensors; five charts and a caller scene; Speed and Quality; 20–90 % of the frame width; ISO 100 and 3200.

| Request | Before | After |
| --- | --- | --- |
| Chart preset, defaults | 2.1 / 2.2 s | 1.2 / 1.3 s |
| Chart preset, Quality options | 7.7 / 7.6 s | 3.0 / 2.9 s |
| Caller scene, defaults | 14.0 / 14.6 s | 12.5 / 13.4 s |

### Display view without diffraction: site values across display pixels (#403)

Neighbouring display pixels' cache windows overlap, so each native site was evaluated about 3.7 times. Without diffraction, site values now persist in a ring of native rows, a power of two and at least twice the window's height.

**Why `sceneLookups` is unchanged:** a ring hit adds the lookups the evaluation would have made.

**Tests:** the same 120-view grid and all hash locks hash identically.

| Request | Before (after #402) | After |
| --- | --- | --- |
| Caller scene, Speed | 12.5 / 13.4 s | 3.0 / 3.0 s |
| Chart preset, Speed | 1.2 / 1.3 s | 1.0 / 1.0 s |

### Prepared display view (#404, issue #387)

`prepareDisplayView(options)` resolves the request once and returns a handle. Its `render(view, { signal })` returns what `simulateDisplayView(options, view)` returns, byte for byte; only `diagnostics.timingsMs` differ, and they cover the render only. Renders share only read-only setup and may run concurrently. Request errors are raised when preparing; view errors and aborts are raised per render.

**Tests:** `test/display-view-prepared.test.ts` covers Speed, Quality and a caller scene with a Kelvin white balance: whole views, corner regions, 16-bit and K = 4 renders, and concurrent renders, each against separate calls. It also covers errors and cancellation.

Measured with 8 × 8 regions of the 2028 × 1352 view, four in a row:

| Request | Separate calls | Prepared |
| --- | --- | --- |
| Chart preset, defaults | 0.26–0.41 s each | 0.25 s once, then 6–7 ms |
| Caller scene, defaults | 0.24–0.43 s each | 0.21 s once, then 17–42 ms |
| Chart preset, Quality options | 0.73–0.79 s each | 0.69 s once, then 34–66 ms |
| Caller scene, Quality options | 1.27–1.52 s each | 0.73 s once, then 0.68–0.75 s |

### Caller material scenes (#405, issue #386)

`{ kind: "material-function", sceneId, materials, materialAt }` lists reflectances as chart patches take them. `materialAt` receives the plane point without a wavelength and returns a material index.

**Captures and ideal references:** the radiance at a point is the material's, in the chart's expression order, so they are byte-identical to the same scene as a reflectance function. Tested in Speed and with diffraction and AHD.

**Display view:** it takes the chart presets' material path. A scene that reproduces a preset gives the preset's bytes, expected values and lookup count.

**Against the reflectance-function form:** the same quantities are summed in another order. The owner's rule treats rounding-only differences as matching. The bound, measured over whole views of the app's chart with its maker label:

| View | Samples | Differing 8-bit samples | Max abs Δ expected (linear) | RMS Δ expected |
| --- | --- | --- | --- | --- |
| Speed 512 × 341 | 523,776 | 0 | 3.7 × 10⁻¹⁵ | 2.8 × 10⁻¹⁶ |
| Speed 1068 × 712 | 2,281,248 | 0 | 3.6 × 10⁻¹⁵ | 2.5 × 10⁻¹⁶ |

`test/material-scene.test.ts` also checks agreement within 1e-12 relative with diffraction and the four-spot filter.

| App's chart with its maker label | Reflectance function | Material scene | Chart preset (no label) |
| --- | --- | --- | --- |
| Defaults | 3.2 s | 1.15 s | 1.1 s |
| Diffraction, four-spot filter, AHD | 111 s | 3.0 s | 2.6 s |

### Known limit: Quality noise at small footprints (#379)

This is unchanged from 2.6.0. With `output.demosaic: "ahd"` the display view's noise has too much colour where a display pixel covers few sensor pixels. Case 138 is outside its limit, as documented in [the 2.6.0 record](RELEASE_2_6_0.md#known-limit-quality-noise-at-small-footprints-379). The redesign moves to 2.8.0 by the owner's decision of October 24, 2026. Speed (bilinear) is exact. The Photivra site offers Speed only.

## Compatibility

- **Additive:**
  - `prepareDisplayView` with its two types;
  - the `material-function` caller scene with `CallerMaterialScene`, `SceneMaterialPoint` and `CALLER_MATERIAL_SCENE_MAX_MATERIALS`.
  
  Root exports go from 1,721 to 1,727, none removed. `scene.preset` gains the value `"material-function"` for such scenes, and `scenePreset` widens accordingly.
- **Byte-identical for every request 2.6.0 accepted:**
  - **Fingerprint:** 18 whole results were compared, taken on this candidate and on `v2.6.0`: 12 `simulateCapture`, 3 `simulateIdealReference` and 3 `simulateDisplayView`. Samples, RAW codes and encoded bytes were hashed; assumptions, plan, request, exposure, scene digest, diagnostics (timings zeroed) and provenance were compared as JSON. They matched once the engine version was normalized. The requests cover chart presets, spectral patches, both caller function forms, PNG 16-bit, JPEG, DNG, AWB, Kelvin white balance, the tone curve, a fixed-size chart, rolling-shutter motion, regions with diffraction, and Quality options. The DNG matched byte for byte once its Software tag's version was swapped.
  - Every existing hash lock passes unchanged.
- **Internal module changes:**
  - `runCapture` accepts an internal "no view" sentinel.
  - `parseDisplayViewOption`, `allowKeys` and `resolveChartMaterial` became internal exports.
  - Deep imports are not a supported surface.

## Rights and licensing

No third-party code, data, constants or dependencies are added. The changes cache or tabulate values the engine already computes, and add API forms around existing models. `package-lock.json` changes only the version fields.

## Privacy and security

No network, persistence or telemetry is added. The new state is per call or per handle and holds only numbers computed from the request:
- the illuminant table (at most 4,096 entries per provider);
- the per-real-pixel memo (at most 65,536 slots of 37 doubles per call);
- the site ring (at most 2²² doubles per call);
- a prepared view's read-only setup.

A material scene's `materialAt` is a caller function like `evaluate`. Its indices are validated on every call, and its materials enter the scene digest.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green. Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] The 2.7.0 changes merged with their changelog entries (#401, #402, #403, #404, #405).
- [x] Version surfaces aligned at 2.7.0 (`npm run release:prepare -- 2.7.0`). API reference regenerated: 1,727 root symbols, 6 added, none removed.
- [x] Fingerprint against `v2.6.0`: 18 results identical apart from the engine version.
- [x] Owner's review of this record.
- [x] Green CI on this pull request (#406), then on `main` after merge (`main smoke` and `native performance` on `fabad7e` passed before the tag).
- [x] **The owner's explicit approval to tag `v2.7.0`.** The owner tagged it and published the release.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.7.0` → `fabad7e36bedc0c2f3466069efec88711511fdaf` (#406), after `main` CI on that commit passed |
| GitHub release | [@photivra/engine 2.7.0](https://github.com/Photivra/engine/releases/tag/v2.7.0), published 20:32:42 UTC |
| Publish workflow | [Publish npm run 24](https://github.com/Photivra/engine/actions/runs/40130257138): its verify and publish jobs passed (completed 20:47:28 UTC) |
| npm | `@photivra/engine@2.7.0`, dist-tag `latest`, registry time 20:49:34 UTC |
| Integrity | `sha512-BwN4fbDQLB5ccYfQukkwN4d2MiqNJHMPuhjDGoIeYEN2EaFng3PsGgWfKIcEOHor3w1L58hF26dZx5lR8nASBw==` (shasum `cf966e76fd9650d5437879528402671562477e3b`, 846 files), the same as the publish log |
| Provenance | Signed provenance statement from GitHub Actions for the tag, published to the Sigstore transparency log ([log index 3443308606](https://search.sigstore.dev/?logIndex=3443308606)); the registry lists an attestation for 2.7.0 |
