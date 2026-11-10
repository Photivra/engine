# Generic equipment tier reference assets

> **Release context.** This page was written for package 1.2.0 (root API 1.2.0) and has not been re-reviewed for later releases. The [changelog](../CHANGELOG.md) describes the current release. Model and subsystem version numbers on this page, and any dated records, are separate from the package version. See also the [developer guide](DEVELOPERS.md) and the [1.2.0 release contract](RELEASE_1_2_0.md).

`resolveGenericEquipmentTierCatalog({ presetVersion: "2.0.0" })` returns three immutable camera-body and lens reference bundles: Consumer, Prosumer and Professional.

What they are: synthetic, educational approximations owned by Photivra, with unquantified physical uncertainty. What they are not: measured calibration, emulation of a commercial camera, or a universal ranking of real equipment.

**How tiers work.**

- The tier is just a key into the catalog. Scientific functions use the ordinary explicit profiles; no "tier multiplier" appears in any equation.
- Sensor format, native raster and capture geometry are still supplied by the caller.
- All three initial lenses are 50 mm primes with the same f/4–f/16 aperture range. Prime versus zoom, and focal range, are separate asset properties, not part of what a tier means.
- This first catalog has no zoom, macro, optical stabilisation (OIS) or variable-focal-length lenses.

## Exact selection and reference binding

```ts
import {
  createGenericEquipmentTierSelection,
  parseGenericEquipmentTierSelection,
  resolveGenericEquipmentTierLensProfiles
} from "@photivra/engine";

const selection = createGenericEquipmentTierSelection({
  presetVersion: "2.0.0",
  bodyTier: "consumer",
  lensTier: "professional"
});
const saved = parseGenericEquipmentTierSelection(
  JSON.parse(JSON.stringify(selection))
);
const profiles = resolveGenericEquipmentTierLensProfiles({
  selection: saved,
  state: {
    bodyId: "photivra-consumer-body", bodyVersion: "2.0.0",
    lensId: "photivra-professional-prime", lensVersion: "2.0.0",
    focalLengthMm: 50, aperture: 4, focusDistanceM: 5,
    captureMode: "still", frameRateHz: 0, stabilizationMode: "off",
    outputWidth: 600, outputHeight: 400
  }
});
```

**Selecting.** If you omit `lensTier`, the lens tier matches the body tier. All nine body/lens pairings are allowed through the equipment capability resolver.

**Saved selections.** The strict saved-selection parser binds:

- exact IDs;
- the preset version;
- every profile reference, including version numbers on wrappers for subsystems whose native profile has no version field.

Unknown fields, missing references, changed versions and a `latest` alias all fail. The parser returns the canonical immutable selection. Output dimensions must be explicit and valid; they do not choose a sensor size. This module does not change the POC (proof-of-concept simulation API) or the production plan.

**Optical profiles.** The optical resolver supports only the explicit still/reference acquisition state shown above.

- The aperture capability does not allow extrapolating optical data beyond f/4.
- Still stabilisation must be off for this optical slice.

It provides:

- radial distortion and lateral chromatic aberration (CA) maps per channel. The CA map already includes the common radial base; do not apply that base twice.
- normalised illumination vignetting, a separate breathing projection scale, and a synthetic flat 540–560 nm transmission reference;
- nine scalar Fraunhofer complex-pupil slices: centre, mid-field (10, 6 mm) and corner (18, 12 mm), each at signed image-plane defocus −20, 0 and +20 µm;
- a 550 nm (vacuum) ghost and veil profile for a clean lens, and separately declared geometry, CA and gain correction components for reconstructed linear images.

**About the pupil data.** The 5×5 pupil grids and OPD (optical path difference) arrays are independently written discrete reference responses, tagged to these exact contexts.

- They are not an inferred continuous lens model, and not a calibrated prediction at arbitrary defocus.
- Since engine 2.0.0, the PSF evaluator zero-pads each grid to 2S−1 samples per axis (9×9 for a full 5-sample disk), so the resulting kernels are alias-free.
- No interpolation is offered.
- The normalised PSF shape has energy one; relative pupil throughput stays separate.
- Pupil clipping and illumination falloff are separate contributions with separate owners. How to compose both together in production is not defined here.
- These assets do not implement longitudinal CA (LoCA), spectral bokeh, onion-ring bokeh, texture rendering or measured MTF.

**About correction.** Correction transforms keep the established destination-to-source meaning.

- Applying the common radial transform and then the per-channel offset is a generic approximate compensation. It does not claim to be the exact inverse of the combined optical CA map.
- Gain correction is partial, and amplifies sampled noise.
- Correction never recreates photons, updates metering, regenerates noise or changes the physical capture history.
- The caller must provide any required source prefiltering. A resampler declaration is a promise, not proof that prefiltering was done.

## Curated declarations and tradeoffs

| Explicit body declaration | Consumer | Prosumer | Professional |
| --- | --- | --- | --- |
| Maximum standard exposure index | 6400 | 12800 | 25600 |
| Maximum declared cadence (fps) | 4 | 8 | 12 |
| Maximum logical sequence frames | 8 | 16 | 24 |
| ADC bit depth / black level / white (codes) | 12 / 256 / 4095 | 14 / 1024 / 16383 | 14 / 1024 / 16383 |
| Base-ISO saturation signal Q₀ (electrons at ADC white) | 20000 | 40000 | 60000 |
| Electrons per code at ISO 100 | 5.21 | 2.60 | 3.91 |
| Maximum analog gain (digital gain above) | 32× (ISO 6400 adds 2× digital) | 64× (ISO 12800 adds 2×) | 128× (ISO 25600 adds 2×) |
| Low-conversion-gain RMS read noise, ISO 100–400 (electrons) | 6 | 3 | 2 |
| High-conversion-gain RMS read noise, ISO ≥ 800 (electrons) | 2.5 | 1.4 | 1.1 |
| High-conversion-gain storage limit (electrons) | 6000 | 12000 | 16000 |
| Data readout duration (seconds) | 0.030 | 0.015 | 0.008 |
| Rolling variant top-to-bottom skew (seconds) | 0.030 | 0.015 | 0.008 |
| Opt-in fixed pattern: PRNU / DSNU / hot fraction × multiplier | 1% / 30% / 2e-4 × 50 | 0.6% / 20% / 1e-4 × 40 | 0.4% / 15% / 5e-5 × 30 |
| Opt-in fixed pattern: row / column offset RMS (electrons) | 0.6 / 0.4 | 0.3 / 0.2 | 0.15 / 0.1 |
| Pitch/yaw/roll stabilization gain | 0.35 | 0.65 | 0.85 |
| Continuous AF mode | unavailable | available | available |
| Highlight-weighted meter/ambience AWB | unavailable | available | available |

**Preset version 2.1.0** (2.14, current) is 2.0.0 with third-stop ISO settings on every body: 100, 125, 160, 200 … up to the body's maximum (`GENERIC_THIRD_STOP_ISO_SETTINGS`, the rounded values of 100·2^(k/3), each within 2 %). Each setting has its own readout regime from the same gain model. Nothing else changes, and `resolveGenericEquipmentTierCatalog({ presetVersion: "2.0.0" })` still returns 2.0.0 exactly as before (its manifest pin is unchanged), so saved 2.0.0 selections and records keep resolving to what they named; `GENERIC_EQUIPMENT_TIER_PRESET_VERSIONS` lists both. `simulateCapture`'s tier ids use 2.1.0: a whole-stop request gives the same samples, RAW codes and files as the 2.0.0 record of the tier, and only the reported profile and preset versions read 2.1.0. Auto ISO steps in whole stops by default (`exposure.autoIso.isoSteps`), so its choices are unchanged.

**Preset version 2.0.0** (a breaking change from 1.0.0). Every sensor number above is a synthetic, educational design value (the separate sensor profile catalogue of #554, [SENSOR_PROFILES.md](SENSOR_PROFILES.md), uses published values and leaves these presets unchanged). Each was chosen to be a plausible order of magnitude for interchangeable-lens sensors. None is data from any camera.

**ISO.** ISO selects one explicit readout regime per setting (`iso-100`, `iso-200`, …) on a finite power-of-two grid. The regimes come from `createIsoGainReadoutRegimes()` (see [MOTION_AND_SIGNAL.md](MOTION_AND_SIGNAL.md#iso-gain-fixed-pattern-noise-and-dark-current-temperature-200)):

- electrons per code fall by the ISO ratio;
- the base-ISO saturation signal lands exactly on ADC white;
- a correctly exposed mid-grey keeps the same normalised RAW level at every ISO;
- read noise switches from the low- to the high-conversion-gain value at ISO 800.

Each regime records how it was derived in `exposureIndexGain`. The producer rejects a regime whose recorded ISO differs from the committed capture ISO. ISO is still not an equation for photons or noise.

**Other notes.**

- The `rollingReadoutTiming` and `fixedPatternNoise` body assets are opt-in. By default, timing is global and no fixed pattern is applied, unless a caller attaches the profile to every site.
- Lens transmission is a flat synthetic 380–780 nm spectrum (1.0.0 used 540–560 nm), so ordinary visible channel responses no longer fall outside it.
- Full-well and storage physics are not inferred from pre-ADC saturation or ADC white.
- AF uses the same ideal, instantaneous actuator for every tier. Having a mode available does not mean faster or more accurate tracking.
- Data readout duration does not establish exposure scan or flash motion geometry.
- Flash capabilities declare front- and rear-curtain ordinary sync, and no HSS (high-speed sync). Callers must check exposure-window compatibility separately.

**Lens tradeoffs.** The lens declarations deliberately include a tradeoff. Professional has less clipping and stray light, and lower radial and CA coefficients, than Prosumer. But it has more falloff at f/4 and a larger peripheral gain cost. Pupil character near and far also differs, rather than every wavefront coefficient simply getting smaller. No overall quality or bokeh score is produced.

## Acceptance boundary

`test/generic-tier-presets.test.ts` reuses the canonical shared fixture's focal length, aperture, focus, illumination wavelength and exposure time (issue #130), without changing that fixture.

- A small explicit 9×9 sampled ramp-and-noise target tests correction, using one capture and one noise identity for both Off and On. The target is a fixture for the sampled executor. It is not a radiometrically composed scene, and makes no resolution or MTF claim.
- Multidimensional pupil checks cover every declared field and defocus slice, and check passivity and energy separately.
- Every advertised ISO setting resolves to an explicit regime.
- Checks of matched angular disturbance, corner radial distortion and CA, off-frame ghost and veil, and correction Jacobians and source coverage all use the existing low-level APIs.
- The shifted output lattice exposes missing support and the joint crop, instead of extending edges.

`test/fixtures/generic-tier-assets-v1.json` pins the complete canonical manifest with SHA-256. Retuning an existing version needs a deliberate fixture change and review. An accepted retuning must introduce a new preset or profile version, while keeping the historical definitions that saved simulations need. This initial resolver recognises only 1.0.0, and rejects unavailable history without falling back.

**Acceptance history.** Initial acceptance was partial. The current preset acceptance disposition (issue #116) is in [TIER_PRESET_ACCEPTANCE.md](TIER_PRESET_ACCEPTANCE.md); issue #119 is the broader cross-tier validation. The inventory below describes that initial slice. Remaining acceptance included:

- reports on composed physical scenes and corrected images;
- envelopes for residual CA and distortion, retained FOV, stretch and edge response;
- controlled bokeh and textured backgrounds, and spectral effects where modelled;
- broader execution cases for body stabilisation, AF, drive, metering and WB;
- the applicable output paths.

There is no separate tier-specific browser approximation to compare against. The public implementation is browser-safe and uses the ordinary reference APIs. No private application acceptance is claimed.

Initial tier assets arrived at root API 0.105.0; the current root API is 1.0.1. This acceptance-only extension does not change runtime, API or asset definitions. Selection schema 0.1.0, asset version 1.0.0, the npm package, and the POC and production contracts are all versioned independently. Human review of science and provenance, and DCO certification for each contribution, are still required.

## Correction residual and sampled-edge acceptance

`test/generic-tier-correction-acceptance.test.ts` extends the cross-tier validation with the exact 1.0.0 assets. It uses a 9×9 synthetic slanted-step target with fixed alternating noise. Correction Off and On branch from one sampled capture.

**Independent predictions.** Separate calculations predict every channel sample: k1 radial arithmetic, finite-difference Jacobians, bilinear weights, and a polynomial partial-reciprocal gain. These checks measure sampled interpolation, not optical MTF or a radiometrically composed scene.

**Residuals.**

- Independent monotonic scalar bisection recovers ideal coordinates through each combined physical radial/CA map.
- Common green distortion is compensated. Sequential partial channel correction leaves a reduced, but nonzero, CA residual.
- At the bounded sample points, residual displacement must be under 0.1 mm. This is a regression envelope for synthetic definitions, not measured accuracy or a guarantee over the continuous field.

**Geometry.**

- Full 2×2 Jacobians, determinants and principal stretches are checked independently.
- A shifted lattice checks exact missing-source support and the joint valid crop.
- The envelope of retained pixel-centre rays per channel stays distinct from the captured pixel-edge FOV. The joint RGB crop cannot expand any channel's ray coverage.

No runtime, root API, schema, preset manifest, package or POC behaviour changes. This does not complete the preset and cross-tier acceptance work: physical PSF and scene composition, broader body execution, and applicable export acceptance are tracked separately.

## Body execution acceptance

`test/generic-tier-body-acceptance.test.ts` runs the exact 1.0.0 body assets through existing public APIs, using the shared fixture's matched optical and exposure state. Fifteen cases cover all three tiers:

- **Drive.** Burst times follow whichever is longer: the explicit cadence or the exposure duration. A slow shutter cannot overlap ordinary still exposures. The self-timer delay is applied once. Frame seeds are reproducible and distinct within the tested sequence. Frame-count limits and unsupported focus bracketing are rejected.
- **Autofocus.** Single AF acquires and holds; the focus-priority and release-priority gates stay separate. Consumer rejects continuous AF. Prosumer and Professional follow the same known target, and need explicit reacquisition after it is lost. The common ideal actuator says nothing about real tracking speed or recognition performance.
- **Metering.** Uniform and highlight metering use independently calculated weighted means and target ratios. They do not change with output crop, and they reject tone-mapped input.
- **Auto white balance.** Visible weighted patches, measured before WB, give independent logarithmic-strength AWB gains. Clipped samples are excluded and reported. Unsupported policies are rejected. A locked state keeps the resolved gains without changing RAW or exposure.
- **Readout.** Global data-readout declarations keep a nonzero duration with zero spatial phase skew, under all three shutter mechanisms. These tests do not establish exposure-edge scans, flash compatibility or rolling-motion behaviour.

Assets, runtime contracts and all versions are unchanged. These are bounded synthetic checks of body policy, not measured camera calibration, and not full capture, production or output acceptance. Physical scene and PSF composition, applicable export wiring, and broader stabilisation and flash acceptance are separate work.

## Readout-to-file acceptance

`test/generic-tier-output-acceptance.test.ts` binds the exact body 2.0.0 readout and signal-chain profiles to an explicitly declared, owned 2×2 Bayer, native-still test topology.

- The topology IDs are registered to the ones the assets require. Matching channel names alone is not the binding.
- Charge expectations, physical storage capacity and the ideal test colour interpretation are independent synthetic fixture contracts.
- This tiny raster is structural regression evidence. It is not a file for external-editor acceptance, and not a realistic pixel sampling model.

**What the cases verify.**

- ISO 100, 400 and 800 resolve to the regimes `iso-100`, `iso-400` and `iso-800`.
- Electrons per code fall by the ISO ratio, and read noise drops in the high-conversion-gain mode.
- Expected photons and charge, and the realised stored charge, do not change.
- Independent arithmetic (signed signal, pedestal, quantisation) predicts each RAW code.
- A regime whose recorded ISO differs from the committed capture ISO is rejected. Unsupported ISO settings are rejected upstream, in the capability resolver.
- Another case attaches the tier's fixed-pattern profile, and checks that it is deterministic, independent of the capture seed, and required on every site of a frame.

**Export.** ISO 100 and 800 are exported in all four orientations.

- Stored DNG codes match every natively produced sample.
- A downstream +1 EV change keeps the codes, the capture and noise identity, and the RAW image identity, while changing the processed pixels.
- Repeated JPEG export is deterministic.

These are real producer-to-file checks. Upstream radiometry, and verification of where the producer data came from, are still explicitly not claimed. They do not establish tier lens PSF or scene composition, calibrated colour, full production activation, or interoperability with external editors or at high resolution. Runtime, API, schema and asset versions are unchanged.

## Supported production and finite pupil scene acceptance

`test/generic-tier-production-acceptance.test.ts` runs every body/lens pairing through the plan 0.7.0 environment route, using the exact preset transmission values and the body readout and ISO profiles.

- A separately identified fixture bridge explicitly binds the selected lens's transmission to its exposure-capability profile ID. Those two IDs belong to different contracts.
- The test does not retune or overwrite the saved 1.0.0 assets.

**Inputs.** The owned 2×2 sensor registration, flat 540–560 nm EQE (external quantum efficiency), charge capacity, dark current and ideal output colour are independent approximations. None is inferred from the body tier.

**What it checks.**

- All three body selections give the same expected photo charge for a given lens.
- The lens transmission ratios independently predict the ratios of photo counts.
- Changing the ISO regime keeps photo charge the same.
- The executed RAW is preserved through processing and deterministic paired export.
- Both consumer manifests keep the same immutable executed result.
- Unsupported wavelength support and stale commitments are rejected before any provider callback.

**What production omits.** Production explicitly omits the PSF and declares unity field throughput. It does not claim to:

- compose the assets' discrete 550 nm pupil data across a continuous spectrum;
- combine pupil clipping with illumination falloff;
- execute every lens effect.

That omission is recorded as `modeled-zero`, with evidence and limitations.

**Finite pupil scene.** A separate finite, single-wavelength sampled scene evaluates all 27 exact field/defocus pupil responses.

- An independent direct phase sum predicts each normalised PSF tap.
- Controlled texture and highlight samples are summed at every tap, with metric pitch and the correct signs (+Y up on the image plane, +Y down natively).
- The same sampled physical response feeds correction Off and On, keeping the capture and noise identity, full Jacobians and retained ray coverage.

This coarse sampled scene is not measured MTF, a continuous optical model, a colour-fringing prediction or a perceptual bokeh score. No interpolation, sharpening pass, hidden quality multiplier or external data is introduced.

See the acceptance disposition for ownership of the presets (issue #116), the merged cross-tier validation (issue #119) and the scientific limits. Runtime, API, schema, asset, package and POC versions stay unchanged.

## Versioned cross-tier reports

The reviewed and merged cross-tier acceptance layer (issue #119) is [TIER_ACCEPTANCE.md](TIER_ACCEPTANCE.md). It links:

- a reproducible report across three domains;
- normative finite regression envelopes;
- explicit tradeoffs for multidimensional pupil and texture, and for crop and gain;
- matched, signed checks for stabilisation and ordinary flash.

The existing body, correction and producer-to-file acceptance remain part of that evidence. Measured calibration and unsupported optical metrics are not invented. Runtime, assets and all versions are unchanged.
