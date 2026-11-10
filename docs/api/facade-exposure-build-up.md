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

The model: photon and dark-charge arrivals at a site are Poisson processes (photon shot noise: EMVA 1288 Release 4.0,
section 2, free), with any rate over time. Given the count n over [0, t] of a Poisson process with mean Λ(t), its arrival
times are n independent times with distribution Λ(s)/Λ(t) on [0, t], so its count over [0, s] is Binomial(n, Λ(s)/Λ(t))
(R. G. Gallager, Discrete Stochastic Processes, chapter 2, sections 2.4 and 2.5, MIT OpenCourseWare 6.262, free).

The method: the whole exposure is `simulateCapture(options)` itself, with its ordinary draws and seeds. Each earlier fraction
fⱼ is a capture of the same request in manual mode at the whole exposure's resolved f-number and ISO and the shutter fⱼ·t,
so its expected signal at every site is integrated from the spectrum over the window [0, fⱼ·t] by the capture itself (the
camera rotation, `motion.subject` and mixed lighting included, and each row's own window with a rolling shutter). Its
counts are not drawn anew: going down the fractions, each site's photo and dark counts are N(fⱼ) ~ Binomial(N(fⱼ₊₁), λ(fⱼ) /
λ(fⱼ₊₁)), with λ the site's expected mean in each render (after PRNU and DSNU). So every fraction's counts are Poisson with
that fraction's own mean (the mean and variance of `simulateCapture` at fⱼ·t), they never decrease from one fraction to the
next, and two fractions' counts covary by the earlier one's mean. Fixed-pattern noise is the sensor's own and the same in
every fraction. Each fraction's charge is clipped at the full well, then read once: its own read noise (dual gain as the ISO
selects), pre-ADC and ADC saturation and quantization at the ADC bit depth.

The windows are nested, so the true means never decrease; the capture's temporal midpoint quadrature can still put an
earlier fraction's estimate above a later one's at a site (motion blur). There the split takes probability 1 (the count is
kept), and the `exposure.buildUp` assumption counts those sites (`nonMonotoneSites`): an approximation of the quadrature,
not of the binomial law. Raise `sensor.temporalSampleCount` to remove them.

Cost: one capture per fraction, plus about 64 bytes per native site for the chain. Exact or fast: the request's own `fast`
(and the format default) applies to every fraction; the build-up adds no fast method, so with `fast: false` (the calculator's
setting) every fraction is an exact capture. On screen only: formats "srgb-8" and "srgb-16" (a fraction's JPEG, PNG or DNG
is refused). A fraction's realization depends on the whole `fractions` list (each step of the chain has its own streams);
the same request and list always give the same frames.

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
   * The fraction developed as its own photo. At fraction 1 it is `simulateCapture(options)` itself, byte for byte. Below 1 it is
   * the result of the fraction's capture (manual, the whole exposure's f-number and ISO, shutter fraction·t: its `image`, `raw`,
   * `plan` and `request`), with the build-up's counts, the `exposure.buildUp` assumption, and the whole exposure's `exposure` and
   * `sensor` reports (the camera's settings and noise figure, not the elapsed part's).
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
