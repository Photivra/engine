# facade/exposure-build-up.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## EXPOSURE_BUILD_UP_MAXIMUM_FRACTIONS

The most fractions one build-up takes.

```ts
EXPOSURE_BUILD_UP_MAXIMUM_FRACTIONS = 64
```

## EXPOSURE_BUILD_UP_STREAM_BASE

The first stream ID of the build-up's per-site random streams (`deriveNativeSiteStreamSeedUint32`): fraction j's photo split,
dark split and readout use streams base + 3j, + 3j + 1 and + 3j + 2 (j = 0 … 63). The whole exposure keeps the ordinary
streams 0 (charge) and 1 (read noise).

```ts
EXPOSURE_BUILD_UP_STREAM_BASE = 0x42550000
```

## simulateExposureBuildUp

Renders fractions of one exposure as one accumulating process (#534), the way a camera's live readout of a long exposure
would show the light building up. Each fraction is read out and developed as its own photo.

The model: photon and dark-charge arrivals are Poisson processes (photon shot noise: EMVA 1288 Release 4.0, section 2, free).
Given a Poisson process's count n at t, its arrival times are n independent uniform times on [0, t], so its count at s < t is
Binomial(n, s/t) (R. G. Gallager, Discrete Stochastic Processes, chapter 2, section 2.5, MIT OpenCourseWare 6.262, free). The whole exposure's photo and dark counts at each site are its ordinary draws, with its ordinary seeds. Going down the
fractions f₁ < … < fₘ, each count is split by a binomial draw: N(fⱼ) ~ Binomial(N(fⱼ₊₁), fⱼ / fⱼ₊₁). So each fraction's counts are Poisson with mean fⱼ times the whole
exposure's (the mean and variance of a single exposure of fⱼ·t), they never decrease from one fraction to the next, and the
covariance of two fractions' counts is the earlier one's mean: the later count is the earlier one plus an independent
increment. Fixed-pattern noise (PRNU, DSNU, hot pixels, offsets) is the sensor's own and the same in every fraction. Each
fraction's charge is clipped at the full well (`sensor.fullWell`), then read once: its own read noise (the regime's
components, dual gain as the ISO selects), pre-ADC and ADC saturation and quantization at the ADC bit depth. The fraction at
1 is `simulateCapture(options)`, byte for byte.

Every fraction renders the whole request again (the same exposure resolution, metering, ISO, lens, framing, `fast` and white
balance; `"auto"` white balance is measured on each fraction, as its own photo), so it costs one capture per fraction. The
whole exposure's expected signal is scaled by the fraction, which equals a capture of fⱼ·t only for a signal constant over
the exposure: a still camera (no `motion.angularVelocityRadPerSec`) and the facade's static scenes. Exact or fast: the
request's own `fast` (and the format default) applies to every fraction; this function adds no fast method, so with
`fast: false` (the calculator's setting) every fraction is the exact capture's.

Formats: "srgb-8" and "srgb-16" (sample arrays to show). A fraction's JPEG, PNG or DNG would carry the whole exposure's
metadata, so those formats are refused. A fraction's realization depends on the whole `fractions` list (each step of the
chain has its own streams); the same request and list always give the same frames.

```ts
export async function simulateExposureBuildUp(options: SimulateCaptureOptions, buildUp: SimulateExposureBuildUpOptions): Promise<SimulateExposureBuildUpResult>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## SimulateExposureBuildUpFrame

One readout of a build-up.

```ts
export interface SimulateExposureBuildUpFrame {
  /** The fraction of the exposure collected. */
  fraction: number;
  /** fraction × the request's shutter time, in s. */
  elapsedSeconds: number;
  /**
   * The fraction developed as its own photo. At fraction 1 it is `simulateCapture(options)` itself, byte for byte. Below 1 its
   * `image` and `raw` codes are the fraction's readout and development, and the `exposure.buildUp` assumption records the fraction;
   * every report of the request (`exposure`, with the shutter time and how it was chosen, `sensor`, with the mid-gray noise figure,
   * `plan`, `request`) describes the whole exposure, the camera's settings, not the elapsed part.
   */
  result: SimulateCaptureResult;
}
```

## SimulateExposureBuildUpOptions

The build-up to render with {@link simulateExposureBuildUp}.

```ts
export interface SimulateExposureBuildUpOptions {
  /**
   * Fractions of `exposure.shutterSeconds` to read out, strictly increasing, each above 0 and at most 1 (1 to 64 of them), for
   * example `[0.2, 0.4, 0.6, 0.8, 1]`. A fraction of 1 is the whole exposure: `simulateCapture` of the request.
   */
  fractions: readonly number[];
}
```

## SimulateExposureBuildUpResult

The readouts of {@link simulateExposureBuildUp}, in the order of `fractions`.

```ts
export interface SimulateExposureBuildUpResult {
  /** The whole exposure's shutter time, in s. */
  shutterSeconds: number;
  frames: readonly SimulateExposureBuildUpFrame[];
}
```
