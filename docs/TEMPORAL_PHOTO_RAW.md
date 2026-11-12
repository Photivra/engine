# Temporal EQE photo signal to native RAW

> **Release context.** This page was written for package 1.2.0 (root API 1.2.0) and has not been re-reviewed for later releases. The [changelog](../CHANGELOG.md) describes the current release. Model and subsystem version numbers on this page, and any dated records, are separate from the package version. See also the [developer guide](DEVELOPERS.md) and the [1.2.0 release contract](RELEASE_1_2_0.md).

This page explains how a photo signal whose light changed during the exposure is fed into RAW production.

Root API **0.110.0** added `createSensorEqeTemporalPhotoSignal()` and `parseSensorEqeTemporalPhotoSignal()`. The RAW producer result schema is **0.3.0**.

- The compact `eqe-temporal-photo-signal` record goes into the existing path: dark current, accumulated charge, capacity, random readout, and paired DNG/JPEG export. (EQE is external quantum efficiency.)
- The full `eqe-temporal-quadrature-expected-counts` diagnostics are a different thing. Casting or relabelling them is not an accepted handoff.

## Construction and arithmetic

**Creating the record.** Supply a public, non-personal `temporalIntegrationId`, and an `exposure` request for [`calculateSensorEqeTemporalExposure()`](SENSOR_EQE_TEMPORAL_EXPOSURE.md).

- The creator evaluates that physical input again, checking response applicability and operating range at every time sample.
- It returns an owned, frozen `photoSignal`, plus the full `exposure` child record, which keeps the evidence and the uncertainty (not combined).
- No runtime dependency, third-party code or data, or new cost is added.

**What the compact record holds.**

- the exact site, channel and binding;
- the local shutter start, end and duration;
- untreated, photo-only flags;
- 1–256 ordered samples of photon and electron rates, in s^-1, at exact uniform midpoints.

It has no stationarity ID, no constant-photo-rate field, and makes no stationarity claim.

**Parser checks.** The parser recomputes compensated sums of rate × `duration / sampleCount` (in seconds), and requires the counts to agree exactly. It rejects:

- unknown fields and sparse arrays;
- invalid public identities;
- non-finite or negative values;
- stale midpoint times;
- electron rates above photon rates;
- invalid evidence;
- substitution of sampled or processed data.

The calculator and the parser share the same accumulation code, so they cannot drift apart.

```ts
const temporal = createSensorEqeTemporalPhotoSignal({
  temporalIntegrationId: "exposure-1-site-0",
  exposure: temporalEqeInput
});
const photoSignal = temporal.value.photoSignal;
const darkCharge = calculateSensorDarkCurrentCharge({
  exposure: photoSignal, darkCurrentProfile, operatingTemperatureC
}).value;
const charge = { photoSignal, darkCharge, completenessProfile };
// Supply the same exact event for every native site before RAW production.
// simulateSensorRawFrame({ frame, sites, exposureWindow }) feeds paired export.
```

## Event and scientific boundaries

**Dark charge.**

- Temporal dark charge carries the same `temporalIntegrationId`, never a made-up stationarity ID.
- Dark current still uses the supplied fixed operating temperature, and the existing rate (exact-temperature or interpolated) times duration.
- Heating, or any temperature change during an exposure, is not integrated.

**Accumulated charge.** Requires the site, channel, binding, identity and start/end/duration to agree exactly. Completeness, additional components and physical capacity are still separate checks.

**Timing.** Both global windows and supported one-to-one rolling windows use the existing RAW timing calculation. Orientation never changes which native site owns which seed.

**What the handoff proves.** It validates arithmetic and declarations. An identity or evidence reference does not prove that the optical source ran, or that the data is authentic or calibrated.

**Model limits.**

- The instantaneous EQE model assumes it applies at each moment, with no detector lag or hysteresis.
- Midpoint samples can miss short pulses or sudden changes, and give no automatic convergence bound.
- No combined uncertainty is inferred.

Source transport, projection, PSF, production-stage activation, high-resolution execution and acceptance in external editors were separate work (issues #16, #178, #112) when this was written.

## Compatibility and acceptance

**Stationary inputs still work.** Existing stationary photo and dark inputs are still accepted, with their original result shapes, dark/charge model 1.0.0 and arithmetic.

- Narrow stationary calls keep their original TypeScript evidence shape, through overloads and default generic types.
- `ComposeSensorPhotoAccumulatedChargeInput` and `SensorPhotoAccumulatedChargeComposition` expose the broader contracts. Union inputs need normal type narrowing.

**Versions.**

- Temporal dark/charge composition uses model **1.1.0**; the compact creator model is **0.1.0**.
- Capture noise model **0.2.0**, RAW readout model **2.0.0**, the package, POC, production and RAW-frame schemas, and the random seed schedule did not change.
- New capture provenance includes the new root API stamp. Replaying historical captures, and pinned paired-file hashes, keep their stored stamp.

**Test.** [`test/temporal-photo-raw.test.ts`](https://github.com/Photivra/engine/blob/main/test/temporal-photo-raw.test.ts) independently calculates SI photoelectron counts from two different irradiance instants. It checks:

- dark and total counts;
- global and rolling events;
- deterministic RAW;
- exact DNG strip codes;
- that the JPEG comes from the same frame.

Malformed records and stale downstream bindings fail closed. The fixtures are synthetic regression data owned by Photivra, not measured camera calibration or final V1 acceptance.
