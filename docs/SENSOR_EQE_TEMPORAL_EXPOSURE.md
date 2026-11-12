# Nonstationary EQE exposure quadrature

> **Release context.** This page was written for package 1.2.0 (root API 1.2.0) and has not been re-reviewed for later releases. The [changelog](../CHANGELOG.md) describes the current release. Model and subsystem version numbers on this page, and any dated records, are separate from the package version. See also the [developer guide](DEVELOPERS.md) and the [1.2.0 release contract](RELEASE_1_2_0.md).

`calculateSensorEqeTemporalExposure()` handles light that changes during the exposure. It evaluates physical spectral irradiance at explicit local shutter midpoints, checks the sensor response at every instant, and adds up the expected photons and photoelectrons. (EQE is external quantum efficiency.)

It reuses the instantaneous steps of `calculateSensorEqeLocalExposure()`: spatial and spectral reduction, applicability, operating range, EQE, and local binding. The stationary function's arithmetic, evidence and return shape are unchanged.

## Input

The input is the same as the stationary function's, minus `irradianceSamples` and `stationarityProfile`. Instead, `samples` holds, for each time:

- `temporalSampleIndex`;
- `timeSecondsFromOpeningReference`;
- complete `irradianceSamples`.

All instants use the same site, profiles, native registration and shutter event. No stationarity profile is needed or made up. Providers supply real values for each instant; this API does not run a renderer or a motion model.

## Timing and arithmetic

**Exact sample times.** For local start `a`, duration `D` and `n` samples, sample `i` must be at exactly `a + (i + 0.5) * (D / n)`.

- Times use the authoritative shutter's `first-opening-boundary-phase` reference, including rolling offsets.
- Callers must use this same arithmetic. A different or global clock, or a stale window, fails.
- Times must be representable, inside the interval, and strictly increasing.

**Weights.** Each node has an integration measure of `D/n` seconds, and a separate dimensionless average weight of `1/n`. Only the seconds measure multiplies the instantaneous rate.

**Counts.** Expected counts are compensated sums of `photonRate_i * D/n` and `electronRate_i * D/n`. Counts keep fractional expectations.

- Spatial area, wavelength measure, response and duration are each applied once.
- The response operating range is checked separately at every time. A valid average irradiance cannot hide one invalid bright instant.
- AA (anti-aliasing) and source support, response plane, per-bin validity and photon-energy basis keep the existing fail-closed rules.
- Child records keep their evidence and uncertainty, not combined.

**Coverage.** Coverage must be complete, and is checked by index; shuffled declarations give identical canonical output. Missing, duplicate, sparse, out-of-range or mistimed samples are rejected.

**Limits.** 1–256 time samples, and at most 100,000 supplied spatial × spectral × temporal irradiance nodes in the whole request. These are reference safety limits, not claims about performance at production resolution.

## Result boundary

**A separate result kind.** The result kind is `eqe-temporal-quadrature-expected-counts`. It reports integrated photo expectations with `timeStationarityEstablished: false` and `timeVaryingSignalIntegrated: true`.

- It is **not** the existing stationary `SensorEqeExposureIntegration`.
- Dark-charge, charge and RAW consumers reject this full diagnostic record. Do not cast it, add fake stationarity fields, or relabel its kind.
- The explicit [temporal photo-signal handoff](TEMPORAL_PHOTO_RAW.md), added at root API 0.110.0, recomputes the physical input and produces a separate validated compact record.
- Dark current, completeness, physical capacity, noise, readout and RAW are still separate steps. Production gates are unchanged.

**What this does not establish.** The field samples are still declarations. This calculation does not establish:

- scene projection, visibility, PSF or transport;
- calibrated source truth;
- that the scene is stationary;
- detector bandwidth;
- quadrature convergence;
- propagated uncertainty.

The shared response state assumes the existing instantaneous EQE model applies at each moment. It does not model lag or hysteresis in the response.

**Short events.** Uniform midpoint sampling can miss short pulses or sudden changes. Either increase the number of samples and measure convergence against the actual quantity, or use a future explicit breakpoint or pulse model. No error bound is inferred from the sample count.

## Tests and versions

The tests use synthetic fields owned by Photivra, and independent SI arithmetic for photon energy, area and response.

- Constant fields match the stationary counts.
- A quadratic field shows the expected midpoint convergence.
- Rolling offsets, and an operating-range failure at a single instant, are verified.

This is mathematical regression evidence, not photographic calibration. Separate [handoff acceptance](https://github.com/Photivra/engine/blob/main/test/temporal-photo-raw.test.ts) covers nonstationary RAW and export from owned synthetic inputs.

**Versions.** This API moved the root API from 0.108.0 to **0.109.0**, with model 0.1.0. Package, POC, production, capture and RAW schemas, and noise identities, did not change. Historical replay keeps its stored root stamp and pinned paired-file hashes; new capture identities may include the new API stamp. No dependency or cost is added.

Remaining work at the time (issues #16, #178, #112): source execution, PSF, production activation, and acceptance across editors and resolutions. This step closed no umbrella issue.
