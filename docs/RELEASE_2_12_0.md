# 2.12.0 release

> **Published October 31, 2026.** The `v2.12.0` tag is on `9d29475` (#519), after `main` CI on that commit had passed; npm publishing ran from the tag ([Publication](#publication)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.12.0`, with `ENGINE_API_VERSION = "2.12.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** new request options and result fields and two new root type exports, with no breaking change to the 2.x API: Auto ISO through the one-call API, `exposure.iso: "auto"` in every exposure mode (#516, #518), and the deviation from the standard exposure in stops, `exposure.standardExposureDeviationStops` (#515, #517). Both are for the app's Beta camera (Photivra/apps#135, Auto ISO; Photivra/apps#124, the exposure meter).
- **Same results:** in 17 fingerprinted results, every sample, RAW code and file (JPEG, PNG, DNG) equals 2.11.1's, with only the engine version normalized; every other field is equal except the two new exposure fields ([Same results](#same-results)).

## Scope

Every pull request merged since `v2.11.1` (`c90bea0`), and this record:

| Change | Pull request |
| --- | --- |
| Remove the scheduled Node support look-ahead workflow (CI only) | #513 |
| Record the 2.11.1 publication (documentation only) | #514 |
| Exposure result: the deviation from the standard exposure in stops (#515) | #517 |
| `simulateCapture` and the display view: Auto ISO in every exposure mode (#516) | #518 |
| 2.12.0 release preparation: version, changelog and this record | this pull request |

## What changed, with evidence

### Auto ISO in every exposure mode (#516, #518)

**Before:** `simulateCapture` and the display view took `exposure.iso` as a number only and always handed the exposure-mode resolvers a fixed ISO, so a caller could not ask for Auto ISO without computing exposure itself.

**Change:**
- `exposure.iso: number | "auto"` in `manual`, `aperture-priority`, `shutter-priority` and `program`, for `simulateCapture`, `simulateDisplayView`, `prepareDisplayView` and `simulateIdealReference`; the default stays ISO 100.
- `"auto"` hands the ISO to the existing resolvers' Auto ISO branches within the body's Auto ISO range: manual keeps the aperture and shutter; aperture priority uses `resolveAperturePriorityAutoIsoExposureMode` with `exposure.autoIso: { slowestPreferredShutterSeconds, afterMaximumIso? }` (the slowest preferred shutter is required; `"allow-slower-shutter"`, the default, or `"hold-preferred-shutter"`); shutter priority uses the `minimum-iso-aperture-first` policy; program raises the ISO beyond its line's end.
- The result reports `exposure.isoControl` (`"manual"` or `"automatic"`) and, with `"auto"`, `exposure.autoIso`: the ideal ISO before constraints, the Auto ISO range, `clamped`, the resolver's `limitingConstraint` and `residualStops`.
- Not included: the automatic slowest shutter (#504) and photographer-set limits (#505).

**Tests** (`test/simulate-capture-auto-iso.test.ts`, 32): the default scene gives ISO 100 in each mode; a scene three stops darker gives ISO 800, byte-identical to a manual ISO 800 capture; compensation; both limits with their constraint; both `afterMaximumIso` policies; a capture, its display views, its ideal reference and its region parts resolve the same exposure, and the parts stitch to the capture's bytes; fourteen invalid options fail with a domain error.

### The deviation from the standard exposure (#515, #517)

**Change:** the capture's and the display view's `exposure` gain `standardExposureDeviationStops`, Δ = log₂(N²/t) − log₂(0.65·L·S/10), from the two CIPA DC-004-2020 relations the engine already meters with (S = 10/H and H = 0.65·L·t/N²; docs/QUICK_START.md, "Exposure and metering"), with L the metered scene luminance. Positive is darker than the standard exposure. It is `null` when the metered luminance is 0 (a black scene, where the ratio is undefined) and finite otherwise.

**Tests** (`test/exposure-deviation.test.ts`): 0 at f/8, 1/125 s, ISO 100 under the default illuminance (|Δ| ≈ 1.2 × 10⁻⁵, the metering quadrature); +0.919 at the marked f/11; +1.000 at f/8√2; −1.059 at the marked 1/60 s; −1.000 at ISO 200; −⅔ with +⅔ stop compensation in aperture priority; a shutter limit hit at 0.01 lux; the display view equals the capture; `null` for a black scene. With Auto ISO the deviation equals the Auto ISO report's `residualStops` on an 18 % grey in manual, program and aperture priority (to 10⁻⁹; two independent computations).

### Same results

A fingerprint of 17 whole results was taken from the published `@photivra/engine@2.11.1` (npm) and from this candidate's build, on Node 24.19.0, with the engine version normalized (the 2.11.1 copy's `ENGINE_API_VERSION` set to 2.12.0, so the DNG Software tag and provenance match). The results: 15 `simulateCapture` requests (the step wedge, slanted edge and Siemens star; manual, aperture priority, shutter priority, program with −1 stop compensation; ISO 1600; JPEG, 16-bit PNG and DNG; a fixed 3200 K white balance; a 2856 K Planckian light at 100 lx in aperture priority; diffraction at f/16; a region; AHD), one `simulateDisplayView` and one `simulateIdealReference`. Every typed array (95: samples, RAW codes, encoded files) was hashed with SHA-256; everything else was compared as JSON with timings removed and the two new exposure fields left out. **All 95 arrays and all 17 remaining records are identical.**

## Compatibility

- Root exports 1,767: two new types, `SimulateCaptureAutoIsoAfterMaximum` and `SimulateCaptureAutoIsoReport`; none removed or changed incompatibly.
- `SimulateCaptureOptions.exposure.iso` widens to `number | "auto"` and gains `autoIso`. Results gain `exposure.isoControl`, `exposure.autoIso` (with Auto ISO) and `exposure.standardExposureDeviationStops`; no field is removed or retyped.
- No default changes.

## Rights and licensing

No third-party code, data, constants or dependencies are added. The deviation uses CIPA DC-004-2020 (free), already the engine's exposure reference.

## Privacy and security

No network, persistence or telemetry is added.

## Release gates

1. **GitHub CI** on the exact commit that is tagged (the `main` commit that merges this record). Tag it only when its CI is green.
2. **Hardware acceptance:** not needed for this release. `src/gpu/` is unchanged since 2.11.1 (`git diff v2.11.1 -- src/gpu` is empty); the GPU path receives only the resolved ISO, as before.

## Remaining release checklist

- [x] #517 and #518 merged with their changelog entries.
- [x] Version surfaces aligned at 2.12.0 (`npm run release:prepare -- 2.12.0`). Root exports 1,767.
- [x] Fingerprint against `v2.11.1`: bytes identical in all 17 results (above).
- [x] #514 (the 2.11.1 publication record) merged (`50dfe3e`).
- [x] Owner's review of this record.
- [x] Green CI on this pull request, then on `main` after merge ([CI run 41226055418](https://github.com/Photivra/engine/actions/runs/41226055418) on `9d29475`).
- [x] **The owner's explicit approval to tag `v2.12.0`** on `9d29475`.
- [x] After publication: npm version, dist-tag, integrity and provenance verified ([Publication](#publication)); publication dates updated in `CHANGELOG.md`, `SECURITY.md` and this record by the 2.13.0 release preparation, since `README.md` and `docs/DEVELOPERS.md` now describe 2.13.0.
- [x] GitHub release notes for `v2.12.0` (the owner's step; published as `@photivra/engine 2.12.0`, October 31, 2026, 22:15:54 UTC, after the 2.13.0 preparation).

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.12.0` → `9d2947552834f9704b9395fbe1105354e4b671f7` (#519), after `main` CI on that commit passed ([CI run 41226055418](https://github.com/Photivra/engine/actions/runs/41226055418)) |
| Publish workflow | [Publish npm run 31](https://github.com/Photivra/engine/actions/runs/41226629956): coverage shards (5–10 s each) and gate passed on the coverage proof, `verify` passed 17:52:32–17:55:15 UTC, `publish` passed 17:55:18–17:55:32 UTC |
| npm | `@photivra/engine@2.12.0`, dist-tag `latest`, registry time 18:01:40 UTC |
| Integrity | `sha512-y738czaXtoangqsD1s2FzNEaCY9SGuxQUinHbYZ2tzeHk5kcg2C1G4X+8clWURm75OOnT0w8huCTfpB4BMh7ZQ==` (shasum `93efbdb5133a546b2278f8dfe02ebe5a36178640`, 904 files) |
| Provenance | The registry lists an SLSA v1 provenance attestation for 2.12.0 |
