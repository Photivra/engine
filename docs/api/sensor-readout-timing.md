# sensor/readout-timing.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorReadoutTiming

Resolves the sensor readout scan schedule for one capture.

Rolling readout is modelled as a uniform linear scan along one axis of the
declared active capture. The caller supplies the scan's time span (skew)
explicitly. It is never worked out from the total data-readout time, crop
size, pixel density, output resolution, sensor-architecture metadata or the
shutter mechanism.

Global readout has no skew in this model, even when a non-zero data-readout
time is declared.

Not covered: local exposure start and end times, mechanical curtain travel,
EFCS (electronic first-curtain shutter) behaviour, rolling-shutter image
distortion, flash or flicker, and motion integration.

```ts
export function calculateSensorReadoutTiming(
  input: CalculateSensorReadoutTimingInput
): CalculationResult<SensorReadoutTiming>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorReadoutTimingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorReadoutTimingInput {
  nativeRaster: NativeImageRaster;
  /**
   * Active capture rectangle, in fixed native pixel coordinates.
   *
   * Defaults to the whole native image. Timing is never worked out by scaling
   * a full-frame value to this rectangle.
   */
  activeCaptureRect?: RasterRect;
  /**
   * The shutter mechanism chosen for the capture.
   *
   * It is reported separately and does not change the sensor readout timing
   * in this model.
   */
  shutterMechanism: CaptureShutterMechanism;
  readout: SensorReadoutTimingDeclaration;
  /**
   * Optional points, in continuous native pixel coordinates measured from pixel
   * edges, to report timing for. A pixel centre is at +0.5.
   */
  samplePointsNative?: readonly RasterPoint[];
}
```

## CaptureShutterMechanism

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CaptureShutterMechanism =
  | "mechanical"
  | "electronic-first-curtain"
  | "electronic";
```

## GlobalSensorReadoutTimingDeclaration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GlobalSensorReadoutTimingDeclaration {
  readoutMode: "global";
  /**
   * Sensor data-readout time for this capture.
   *
   * It is deliberately not treated as the spatial exposure or readout skew.
   */
  captureReadoutDurationSeconds: SourcedSensorTimingSeconds;
  scanDirectionNative?: never;
  spatialSamplingSkewSeconds?: never;
}
```

## NativeSensorReadoutScanDirection

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type NativeSensorReadoutScanDirection =
  | "top-to-bottom"
  | "bottom-to-top"
  | "left-to-right"
  | "right-to-left";
```

## RollingSensorReadoutTimingDeclaration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RollingSensorReadoutTimingDeclaration {
  readoutMode: "rolling";
  /**
   * Sensor data-readout time for this capture.
   *
   * It is kept separate from the spatial skew, because a published readout time
   * and the scan's time span are not necessarily the same quantity.
   */
  captureReadoutDurationSeconds: SourcedSensorTimingSeconds;
  /**
   * Native-sensor scan direction for the selected capture mode.
   */
  scanDirectionNative: SourcedSensorReadoutFact<NativeSensorReadoutScanDirection>;
  /**
   * Time between the first and last scan positions, in the uniform linear
   * timing approximation (the readout skew).
   */
  spatialSamplingSkewSeconds: SourcedSensorTimingSeconds;
}
```

## SensorReadoutMode

The readout mode chosen for one capture.

It uses the same names as the architecture metadata, but does not claim the
hardware supports it. SensorArchitectureProfile.readoutCapabilities is
descriptive only and is not checked automatically.

```ts
export type SensorReadoutMode = SensorReadoutArchitecture;
```

## SensorReadoutTiming

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorReadoutTiming {
  readoutMode: SensorReadoutMode;
  shutterMechanism: CaptureShutterMechanism;
  nativeRaster: NativeImageRaster;
  activeCaptureRect: RasterRect;
  captureReadoutDurationSeconds: SourcedSensorTimingSeconds;
  maximumSpatialSamplingSkewSeconds: number;
  scan:
    | {
        pattern: "uniform-linear-single-axis";
        directionNative: SourcedSensorReadoutFact<NativeSensorReadoutScanDirection>;
        unitVectorNative: { x: number; y: number };
        spatialSamplingSkewSeconds: SourcedSensorTimingSeconds;
      }
    | null;
  samples: readonly SensorReadoutTimingSample[];
}
```

## SensorReadoutTimingDeclaration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorReadoutTimingDeclaration =
  | GlobalSensorReadoutTimingDeclaration
  | RollingSensorReadoutTimingDeclaration;
```

## SensorReadoutTimingSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorReadoutTimingSample {
  pointNative: RasterPoint;
  normalizedScanPosition: number | null;
  /**
   * Readout time of this point, in seconds, relative to the first scan position (0).
   *
   * It is not automatically an exposure-start time or a shutter-curtain time.
   */
  readoutPhaseOffsetSeconds: number;
}
```

## SourcedSensorReadoutFact

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SourcedSensorReadoutFact<T> = EvidenceBackedFact<T>;
```

## SourcedSensorTimingSeconds

Evidence-backed timing value with an explicit seconds unit.

```ts
export interface SourcedSensorTimingSeconds
  extends EvidenceBackedFact<number> {
  unit: "s";
}
```
