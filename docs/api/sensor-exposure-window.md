# sensor/exposure-window.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCaptureExposureWindows

Works out each point's local exposure window from separate opening and
closing boundary schedules.

Times are seconds from the first opening boundary. This is deliberately not
the camera-rotation API's global "exposure start"; a later layer must link the
two explicitly.

The mechanism records whether each boundary is mechanical or electronic, but
supplies no sweep duration or direction. Every timing value and direction for
a non-simultaneous boundary is declared by the caller, with evidence.

Only simultaneous boundaries and a uniform linear sweep along one native
sensor axis are supported. Not modelled: curtain acceleration, segmented or
non-linear electronic schedules, flash or flicker, rolling-shutter image
distortion, shutter shock, and EFCS (electronic first-curtain shutter)
effects on the pupil or bokeh.

```ts
export function calculateCaptureExposureWindows(
  input: CalculateCaptureExposureWindowsInput
): CalculationResult<CaptureExposureWindows>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateCaptureExposureWindowsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateCaptureExposureWindowsInput {
  nativeRaster: NativeImageRaster;
  /**
   * Active capture rectangle, in fixed native pixel coordinates.
   *
   * Defaults to the whole native image. Sweep timing is never worked out by
   * scaling a full-frame timing value to this rectangle.
   */
  activeCaptureRect?: RasterRect;
  shutterMechanism: CaptureShutterMechanism;
  /**
   * Nominal time between the opening and closing reference points (phase zero).
   *
   * A point's local exposure can differ from this when the opening and closing
   * boundaries sweep differently across the sensor.
   */
  nominalExposureDurationSeconds: SourcedCaptureTimingSeconds;
  opening: ExposureBoundarySchedule;
  closing: ExposureBoundarySchedule;
  /**
   * Optional points, in continuous native pixel coordinates measured from pixel
   * edges, to report windows for. A pixel centre is at +0.5.
   */
  samplePointsNative?: readonly RasterPoint[];
}
```

## CaptureExposureBoundaryActuator

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CaptureExposureBoundaryActuator = "mechanical" | "electronic";
```

## CaptureExposureWindows

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureExposureWindows {
  shutterMechanism: CaptureShutterMechanism;
  timeReference: "first-opening-boundary-phase";
  nativeRaster: NativeImageRaster;
  activeCaptureRect: RasterRect;
  nominalExposureDurationSeconds: SourcedCaptureTimingSeconds;
  opening: ResolvedCaptureExposureBoundary;
  closing: ResolvedCaptureExposureBoundary;
  localExposureDurationRangeSeconds: {
    minimum: number;
    maximum: number;
  };
  samples: readonly CaptureExposureWindowSample[];
}
```

## CaptureExposureWindowSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureExposureWindowSample {
  pointNative: RasterPoint;
  openingNormalizedScanPosition: number | null;
  closingNormalizedScanPosition: number | null;
  /**
   * Seconds from the first opening boundary.
   */
  startOffsetSecondsFromOpeningReference: number;
  /**
   * Seconds from the first opening boundary.
   */
  endOffsetSecondsFromOpeningReference: number;
  localExposureDurationSeconds: number;
}
```

## ExposureBoundarySchedule

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureBoundarySchedule =
  | SimultaneousExposureBoundarySchedule
  | UniformLinearExposureBoundarySchedule;
```

## ResolvedCaptureExposureBoundary

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedCaptureExposureBoundary {
  actuator: CaptureExposureBoundaryActuator;
  schedule:
    | {
        kind: "simultaneous";
      }
    | {
        kind: "uniform-linear-native-scan";
        directionNative: SourcedCaptureBoundaryDirection;
        unitVectorNative: RasterVector;
        traversalDurationSeconds: SourcedCaptureTimingSeconds;
      };
}
```

## SimultaneousExposureBoundarySchedule

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SimultaneousExposureBoundarySchedule {
  kind: "simultaneous";
  directionNative?: never;
  traversalDurationSeconds?: never;
}
```

## SourcedCaptureBoundaryDirection

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SourcedCaptureBoundaryDirection =
  EvidenceBackedFact<NativeSensorReadoutScanDirection>;
```

## SourcedCaptureTimingSeconds

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SourcedCaptureTimingSeconds = SourcedSensorTimingSeconds;
```

## UniformLinearExposureBoundarySchedule

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface UniformLinearExposureBoundarySchedule {
  kind: "uniform-linear-native-scan";
  directionNative: SourcedCaptureBoundaryDirection;
  traversalDurationSeconds: SourcedCaptureTimingSeconds;
}
```
