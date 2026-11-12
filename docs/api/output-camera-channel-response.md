# output/camera-channel-response.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCameraChannelResponse

#591: the camera's channel response on its spectral grid and, with `illuminant`, each channel's effective dispersion (pass it
as `channelDispersion` to `calculateLateralColorFringe` or `createGenericLensCorrectionProfile`). Strict input. A labelled
approximation: the facade's synthetic colorimetric sensor, not a measured one.

```ts
export function calculateCameraChannelResponse(input: CalculateCameraChannelResponseInput = {}): CalculationResult<CameraChannelResponse>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateCameraChannelResponseInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateCameraChannelResponseInput {
  /**
   * The capture's `sensor.profile` record (a `SensorProfile`, for example `resolveSensorProfile(id)`): only its
   * `peakQuantumEfficiency` is read, the one field that changes the channels. Omitted: a tier body (peak QE 0.5).
   */
  sensorProfile?: Pick<SensorProfile, "peakQuantumEfficiency">;
  /** Peak quantum efficiency in (0, 1] (as `sensor.peakQuantumEfficiency`); wins over the profile's. */
  peakQuantumEfficiency?: number;
  /**
   * The capture's `sensor.spectralStepNanometers`, 1–100. Default 5: the calculator runs at full quality, and a spiky light
   * needs the fine grid. Pass the capture's step to reproduce a capture's channels.
   */
  spectralStepNanometers?: number;
  /** A `simulateCapture` illuminant: when given, the result also carries each channel's effective dispersion under it. */
  illuminant?: CaptureIlluminant;
}
```

## CameraChannelResponse

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CameraChannelResponse {
  /** The capture's midpoint nodes, nm, increasing. */
  wavelengthsNm: number[];
  /** Electrons per joule of incident light at each node, per channel: EQE_c(λ)·λ/(h·c). */
  red: number[];
  green: number[];
  blue: number[];
  /** With `illuminant`: D̄_c, as `calculateChannelEffectiveDispersion` returns for these channels; else null. */
  channelDispersion: ChannelDispersion | null;
}
```
