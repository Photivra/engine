# capture/sensor-raw-frame.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createSensorRawFrame

Commits native RAW samples and capture metadata. No demosaicing, WB, tone mapping or file packing.

```ts
export function createSensorRawFrame(input: SensorRawFrameInput): SensorRawFrame;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSensorRawFrameInput

Checks that every native site has one sample, within limits, and that CFA, mode, site and code identities match exactly. No I/O.

```ts
export function parseSensorRawFrameInput(value: unknown): SensorRawFrameInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SENSOR_RAW_FRAME_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SENSOR_RAW_FRAME_SCHEMA_VERSION = "0.1.0" as const
```

## SensorRawFrame

Immutable attached RAW frame. Passing the structural checks does not prove the producer was correct or that the data is DNG-compatible.

```ts
export interface SensorRawFrame extends SensorRawFrameInput {
  schemaVersion: typeof SENSOR_RAW_FRAME_SCHEMA_VERSION;
  sampleDomain: "native-cfa-raw-code";
  sampleOrder: "native-row-major";
  producerBinding: "caller-declared-capture-attachment";
  reconstructionApplied: false;
  renderingApplied: false;
  nativePixelWidth: number;
  nativePixelHeight: number;
}
```

## SensorRawFrameInput

Declares that native CFA samples from the sensor model belong to a committed photographic capture.

```ts
export interface SensorRawFrameInput {
  frameId: string;
  capture: SimulatedCapture;
  modeId: string;
  captureModeProfile: CaptureModeProfile;
  colorSamplingProfile: SensorColorSamplingProfile;
  bindingProfile: NativeEffectiveRasterColorSamplingBindingProfile;
  containerBitDepth: 16;
  /** Exactly one sample per native site, row-major. Not processed RGB with a mask applied. */
  samples: readonly SensorRawCaptureSample[];
}
```
