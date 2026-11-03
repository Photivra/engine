# 2.14.0 release

> **Published November 1, 2026.** The `v2.14.0` tag is on `f4b09a7` (#539), after `main` CI on that commit had passed; npm publishing ran from the tag ([Publication](#publication)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.14.0`, with `ENGINE_API_VERSION = "2.14.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** 21 new root exports, a new chart preset, a new chart reflectance form, new optional request options, new result fields and a new generic tier preset version, with nothing removed and no breaking change to the 2.x API. All are for the app's Beta:
  - Photivra's own color patches for a color test chart (#537), with Photivra names, codes and reasons, vetted against third-party color sets (#542);
  - grey-card (incident) exposure: the deviation from an 18 % grey card's standard exposure, and grey-card metering for the automatic modes (#538);
  - third-stop ISO settings (tier presets 2.1.0) and a third-stop shutter series (#541);
  - a smaller package: minified shipped shaders and pure-annotated frozen tables (#540).
- **Results:** in 22 fingerprinted results against the published 2.13.0, every typed array (100) and every other field is identical. Left out of the comparison: timings, the two new exposure fields, and the three preset and profile version fields that read 2.1.0 ([Results against 2.13.0](#results-against-2130)).

## Scope

Every pull request merged since `v2.13.0` (`9c3fe85`), and this record:

| Change | Pull request |
| --- | --- |
| Chart scenes: built-in Photivra color patches with spectral reflectance | #537 |
| Exposure: grey-card (incident) deviation and grey-card metering | #538 |
| Smaller package: minified shipped WGSL and pure-annotated frozen tables (#536) | #540 |
| Third-stop exposure grids: ISO settings (tier presets 2.1.0) and a shutter series | #541 |
| Color patches: Photivra names, codes and reasons; colors vetted against third-party sets | #542 |
| 2.14.0 release preparation: version, changelog, this record, and the 2.13.0 publication record | this pull request |

The full entries, with their tests and measurements, are in [CHANGELOG.md](../CHANGELOG.md) under 2.14.0.

## What changed, with evidence

### New

- **Color patches designed by Photivra (#537, #542).** 30 reflectance spectra in six groups:
  - a six-step flat neutral ramp;
  - strong and soft red, yellow, green, cyan, blue and magenta;
  - four skin tones;
  - six memory colors;
  - a deep orange and a deep violet near the sRGB edge.

  Each is an analytic function, a constant plus Gaussian and logistic terms on 360–830 nm, published in full in [Color patches](COLOR_PATCHES.md). Each patch has a stable id, a short code (`PV-N1` … `PV-G2`), an original name and a reason (#542). No third-party chart data, names, order, layout or spectra are used.
  - **API:** the chart reflectance `{ kind: "color-patch", patchId }`, the `color-patches` preset, `getColorPatchSet()` and `evaluateColorPatchReflectance()`.
  - **Reference CIELAB (D65, CIE 1931 2°) and sRGB:** computed by `scripts/compute-color-patch-reference.mjs`, which downloads the CIE tables, checks their SHA-256 and deletes them. Under the CIE D65 table as a caller illuminant, the render is within ΔE00 0.19 at 1 nm and 0.24 at 5 nm (`--render`, #542).
  - **Distinct from third-party colors (#542):** `scripts/check-color-patch-distinctness.mjs` checks every published color against these pinned sources, downloaded, verified by SHA-256 and discarded:
    - the CSS named colors;
    - the ColorChecker Classic's published sRGB and CIELAB;
    - RAL Classic approximate sRGB;
    - 10,386 brand colors from Simple Icons.

    No hex is equal, and every colored patch is at least ΔE00 2.15 from all of them. The neutral ramp avoids only equal hexes, so it stays within ΔE00 0.12–0.35 of the ColorChecker's neutral ramp; that is an open point for the owner. Pantone was not checked (proprietary).
  - **Tests:** `test/color-patches.test.ts`:
    - the formula and its unused clamp;
    - the neutral L* in closed form;
    - neutrality after white balance under the 6500 K Planckian and illuminant A;
    - hue order;
    - rendered CIELAB under the 6500 K Planckian;
    - digest locks of existing charts against 2.13.0.
- **Grey-card exposure (#538).** `exposure.greyCardDeviationStops` = log₂(L_ref/(0.18·E/π)), the deviation from the CIPA DC-004-2020 standard exposure of an 18 % Lambertian grey card under the request's illuminance. It is exactly 0 at the defaults and does not depend on the scene's reflectances.
  - **Metering option:** `exposure.metering: "scene-average" | "grey-card"`, defaulting to the unchanged scene meter. With `"grey-card"`, the automatic modes and Auto ISO meter that card and land on a grey-card deviation of 0, up to their steps and limits.
  - **Reporting:** the capture and the display view report both fields.
  - **Tests:** `test/exposure-grey-card.test.ts`, 11 tests.
- **Third-stop exposure grids (#541).**
  - **ISO:** the generic tier presets 2.1.0 take third-stop ISO settings, `GENERIC_THIRD_STOP_ISO_SETTINGS` = 100, 125, 160 … up to each body's maximum, each with its own readout regime. Preset 2.0.0 is kept exactly and still resolves.
  - **Auto ISO** keeps whole stops unless `exposure.autoIso.isoSteps: "third-stop"`.
  - **Shutter:** `GENERIC_THIRD_STOP_SHUTTER_SECONDS` lists 1/8000 s to 30 s.
  - **Byte identity:** whole-stop requests give the same samples, RAW codes, files, settings and assumptions as the 2.0.0 records.
  - **Tests:** `test/third-stop-settings.test.ts`.

### Changed

- **Smaller package (#540, issue #536).**
  - **Shader text:** `npm run build` strips comments and indentation from the `/* wgsl */` shader literals. It keeps every newline and every line with an interpolation, so the WGSL tokens and the engine's own shader-text anchors are unchanged, and the build fails otherwise.
  - **Pure annotations:** 110 module-level frozen tables are `/* @__PURE__ */`.
  - **Measured on the app's build:** the GPU session chunk went from 52,917 to 46,430 B gzip, and total JavaScript from 500.7 to 494.1 KiB, back under the 500 KiB budget.
  - **Same GPU output:** on the M5 Pro, `npm run test:webgpu` passed 167/167 with the minified and with the source shader text, with identical recorded values. The tests and the WebGPU suites run the minified text.

### Known

- At the default `sensor.spectralStepNanometers` (20 nm), the scene-illuminant white balance is measured on 1 nm nodes while the sensor integrates on 20 nm nodes, which leaves a small neutral cast. On the white patch it is a* 0.17 and b* 0.36 under the 6500 K Planckian, and below 0.03 with 5 nm nodes. This is unchanged from 2.13.0 and recorded in the CHANGELOG.

## Results against 2.13.0

22 whole results were rendered with the published `@photivra/engine@2.13.0` (npm tarball) and with this candidate's build (the merge of `main` `e3f23f1`), on Node 24.19.0 (Apple silicon, arm64). The engine version was normalized: the 2.13.0 copy's `ENGINE_API_VERSION` was set to 2.14.0, so the DNG Software tag and the provenance match.

The 22 results are the same set as 2.13.0's record:

- **15 `simulateCapture` requests** (96 × 64). They cover:
  - the step wedge, the slanted edge and the Siemens star;
  - manual, aperture priority, shutter priority, and program with −1 stop compensation;
  - ISO 1600;
  - JPEG, 16-bit PNG and DNG;
  - a fixed 3200 K white balance;
  - a 2856 K Planckian at 100 lx;
  - diffraction at f/16;
  - a region;
  - AHD.
- **One `simulateIdealReference`.**
- **Six `simulateDisplayView` views at 48 × 32:**
  - the Siemens star with the bilinear demosaic, twice;
  - the Siemens star with AHD;
  - the Siemens star with Quality options (diffraction, four-spot filter, AHD);
  - the step wedge with AHD;
  - the slanted edge with AHD.

Every typed array was hashed with SHA-256. Everything else was compared as JSON. Left out:
- timings;
- the new `exposure.greyCardDeviationStops` and `exposure.metering`;
- the three version fields that name preset 2.1.0 (#541): `provenance.cameraPresetVersion`, and `exposure.resolution.capabilityProfiles.bodyProfileVersion` and `lensProfileVersion`.

| Results | Arrays | Other fields |
| --- | --- | --- |
| All 22 | **identical** (100 of 100) | **identical** |

**Why nothing changes:**
- The new options change nothing when absent. With `exposure.metering` omitted, no assumption is added.
- The patch spectra are used only when a chart names them.
- Auto ISO keeps whole stops by default, and the whole-stop ISO regimes of preset 2.1.0 are those of 2.0.0.
- The shader minification changes only comments and whitespace, which WGSL treats as blankspace.

Each pull request also compared its own cases against a 2.13.0 build or the 2.0.0 records:
- #537: the app's chart layouts as captures and a display view;
- #538: four exposure modes and a display view on the app's round 4 chart;
- #541: five requests on each tier against the 2.0.0 records;
- #540: the hardware WebGPU suite with and without minification.

Requests that the fingerprint does not cover also change in their request records: `request.environmentRaw` and `request.siteInput(i)` list every readout regime of the body, now including the third-stop ISOs. #541 re-pinned six such digests in `test/simulate-capture-integration.test.ts`; none of its sample, code, flag, development or scene digests changed.

## Compatibility

- **Root exports: 1,801** (2.13.0: 1,780). These 21 are new, and none is removed or changed in name, source or kind (`docs/api/exports.json` compared with `v2.13.0`'s). Runtime exports go from 600 to 611.
  - **Functions:** `getColorPatchSet` and `evaluateColorPatchReflectance`.
  - **Constants:**
    - colors: `COLOR_PATCH_IDS`, `COLOR_PATCH_SET_ID`, `COLOR_PATCH_SET_VERSION`, `COLOR_PATCH_WAVELENGTH_RANGE_NANOMETERS`;
    - exposure: `SIMULATE_CAPTURE_METERING_MODES`;
    - grids: `GENERIC_THIRD_STOP_ISO_SETTINGS`, `GENERIC_THIRD_STOP_SHUTTER_SECONDS`, `GENERIC_WHOLE_STOP_ISO_SETTINGS` and `GENERIC_EQUIPMENT_TIER_PRESET_VERSIONS`.
  - **Types:** `ColorPatch`, `ColorPatchGroup`, `ColorPatchId`, `ColorPatchReflectance`, `ColorPatchSet`, `ColorPatchSpectralTerm`, `ColorPatchesChartScene`, `EvaluateColorPatchReflectanceInput`, `SimulateCaptureMetering` and `GenericTierPresetVersion`.
- **Inputs and results:**
  - `ChartReflectance` and `ChartElementScene` gain a member.
  - `CHART_SCENE_PRESETS` and `CHART_SCENE_DEFAULTS` gain `color-patches`.
  - New optional inputs: `exposure.metering` and `exposure.autoIso.isoSteps`.
  - The capture's and the display view's `exposure` gain `greyCardDeviationStops` and `metering`, and the Auto ISO report gains `isoSteps` when it is given.
  - No field is removed or retyped.
- **Widened unions:** code with an exhaustive `switch` over `ChartScenePresetId`, `ChartReflectance` or a preset version (`GenericTierPresetVersion`) will need the new cases.
- **Preset version:** `GENERIC_EQUIPMENT_TIER_PRESET_VERSION` is now `"2.1.0"`. `resolveGenericEquipmentTierCatalog({ presetVersion: "2.0.0" })` still returns 2.0.0, unchanged (manifest pin), so callers pinned to 2.0.0 and saved 2.0.0 selections keep working. Captures by tier id report 2.1.0.
- **No default changes:** captures, RAW codes, files, display views and assumptions are the same for the same request.

## Rights and licensing

No third-party code, data or dependencies are added to the package.

- **Color patches:** the spectra are Photivra's own design. Their reference values are computed from the CIE D65 and CIE 1931 tables at computation time only, and nothing from the tables is stored.
- **Distinctness check:** the repository-only script downloads pinned third-party color lists (CSS named colors, published ColorChecker values, RAL Classic approximations, Simple Icons brand colors; their sources and licences are in `THIRD_PARTY.md`), uses them in memory and discards them; no third-party color data is committed.
- Both uses are recorded in `THIRD_PARTY.md`.
- **Grey-card exposure:** uses CIPA DC-004-2020 (free).
- **Third-stop series:** the conventional rounded markings, checked against 2^(k/3) in the tests.
- **Shader minification:** relies on the WGSL specification's treatment of comments as blankspace.

## Privacy and security

No network, persistence or telemetry is added to the package. The two repository-only scripts (`compute-color-patch-reference.mjs`, `check-color-patch-distinctness.mjs`) download their pinned data when run, and are not packed.

## Release gates

1. **GitHub CI** on the exact commit that is tagged (the `main` commit that merges this record), including the `webgpu conformance (SwiftShader)` job. Tag it only when its CI is green.
2. **Hardware acceptance:** `src/gpu/` differs from `v2.13.0` only by `/* @__PURE__ */` comments (#540). The shader text the package ships changes by comments and whitespace only: the token stream is unchanged, and the build checks it.
   - **Hardware evidence:** #540 ran `npm run test:webgpu` on the M5 Pro's GPU with the minified and with the source text (167/167 each, identical recorded values), and CI runs the SwiftShader job on the minified text.
   - **Not run:** the 2.11.0-style hardware gate on the commit to be tagged. This is for the owner to decide, as in 2.13.0.

## Remaining release checklist

- [x] #537, #538 and #540–#542 merged with their changelog entries.
- [x] Version surfaces aligned at 2.14.0 (`npm run release:prepare -- 2.14.0`; after the merges the script reports the package already at 2.14.0, and the reference was regenerated). Root exports 1,801.
- [x] Fingerprint against the published 2.13.0: all 22 results identical (above).
- [x] 2.13.0 recorded as published (`CHANGELOG.md`, `SECURITY.md`, [its record](RELEASE_2_13_0.md)); the 2.12.0 record's release-notes item ticked.
- [x] The owner's approval to tag and release 2.14.0 (chat, November 1, 2026).
- [ ] The owner's decision on the hardware gate (above): the tag was made without a recorded `accept:gpu:hardware` / `test:webgpu:hardware` run on `f4b09a7`; no decision is recorded in the repository.
- [x] Green CI on this pull request, then on `main` after merge ([CI run 41350521752](https://github.com/Photivra/photivra/actions/runs/41350521752) on `f4b09a7`).
- [x] The `v2.14.0` tag on the `main` commit that merges this record (`f4b09a7`).
- [x] After publication: npm version, dist-tag, integrity and provenance verified ([Publication](#publication)); GitHub release notes published (`@photivra/engine 2.14.0`, November 3, 2026, 16:42:46 UTC); publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record by the 2.14.1 release preparation.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.14.0` → `f4b09a77a2c84b802543860cf5d411d3d49510c8` (#539), after `main` CI on that commit passed ([CI run 41350521752](https://github.com/Photivra/photivra/actions/runs/41350521752)) |
| Publish workflow | [Publish npm run 33](https://github.com/Photivra/photivra/actions/runs/41350544040): coverage shards (6–9 s each) and gate passed on the coverage proof, `verify` passed 21:09:37–21:11:52 UTC, `publish` passed 21:11:54–21:12:08 UTC |
| npm | `@photivra/engine@2.14.0`, dist-tag `latest`, registry time 21:14:13 UTC |
| Integrity | `sha512-J2uy/pkpOUtTqA8TDY6VhcUuqx7e/hJD3aomSx/7SAPhPr33JE0/4jnzjiXJUcrCEPjES1STs2TYNOxEgKu8ag==` (shasum `5ce429d4c9babac9cfa241377b349c60878dbe55`, 912 files) |
| Provenance | The registry lists an SLSA v1 provenance attestation for 2.14.0 |
