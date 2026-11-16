# equipment/sensor-profile-frame.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorProfileFrame

#636: the frame `simulateCapture` renders for a sensor profile, an output size and a lens kind, the same record as its
`sensor.profileView` assumption: before a capture, for example to show a phone lens's frame and pitch or to pass the frame to the
framing helpers (which also take the profile directly, `sensorProfile`).

```ts
export function calculateSensorProfileFrame(input: CalculateSensorProfileFrameInput): CalculationResult<SensorProfileFrame>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorProfileFrameInput

#636: the input of {@link calculateSensorProfileFrame}: a capture's `sensor.profile`, output size, `sensor.pixelPitchMicrometers` and lens kind.

```ts
export interface CalculateSensorProfileFrameInput {
  /** A sensor profile record (`SENSOR_PROFILES`, `resolveSensorProfile(id)` or a caller's copy), checked as a capture checks it. */
  profile: SensorProfile;
  /** The output's width and height, pixels (`output.width`, `output.height`). */
  width: number; height: number;
  /** `sensor.pixelPitchMicrometers`, µm; default as in a capture (see {@link SensorProfileFrame}). */
  pixelPitchMicrometers?: number;
  /** True for a catalogue lens (`lens.catalogue`), which is framed on the profile's whole sensor. Default false. */
  catalogueLens?: boolean;
}
```

## SensorProfileFrame

The frame of an output on a sensor profile (`sensor.profileView`).

```ts
export interface SensorProfileFrame {
  sensorWidthMm: number; sensorHeightMm: number;
  /** The rendered frame, output × pitch, mm. */
  frameWidthMm: number; frameHeightMm: number;
  pixelPitchMicrometers: number;
  /** With the lens framed on the sensor: the sensor axis the output's aspect crops ("none" when it fills both); null otherwise. */
  croppedSensorAxis: "width" | "height" | "none" | null;
  /** N = (pitch / photosite pitch)²: the photosites one rendered site sums. */
  photositesPerSite: number;
  /** √max(1, N), the read noise's factor. */
  readNoiseScale: number;
  /** True with a catalogue lens: the lens is resolved on the whole sensor. */
  lensFramedOnSensor: boolean;
}
```
