# motion/capture-rotation-inverse-mapping.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCaptureRotationInverseMappings

Calculates an instantaneous inverse capture-scan mapping for still world
rays under pure camera rotation.

The destination point on the native sensor sets the local exposure timing.
At a chosen phase within that local window, the captured image-plane ray is
mapped back analytically to the reference image plane at the first
opening-boundary phase.

No iterative solve is needed. Once the destination and local capture time
are known, pure rotation under this constant-axis model has an analytic
inverse.

This is not a renderer for a finite exposure, and it does not integrate
blur. Sensor data-readout timing is deliberately not used; exposure
boundaries are the only timing source.

```ts
export function calculateCaptureRotationInverseMappings(
  input: CalculateCaptureRotationInverseMappingsInput
): CalculationResult<CaptureRotationInverseMappings>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateCaptureRotationInverseMappingsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateCaptureRotationInverseMappingsInput
  extends CalculateCaptureExposureWindowsInput {
  imagingArea: SensorImagingArea;
  focalLengthMm: number;
  focusDistanceM?: number;
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  /**
   * Where in each point's local exposure interval to evaluate the
   * instantaneous mapping, as a fraction.
   *
   * 0 = local exposure start, 0.5 = local midpoint, 1 = local exposure end.
   * A phase is required because a finite exposure has no single sharp
   * geometry.
   */
  localExposurePhase: number;
  /**
   * Physical capture orientation. It is used only to rotate the reported
   * native inverse displacement (in samples) into oriented-capture
   * coordinates. It does not change the native exposure schedule.
   */
  orientation: CaptureOrientation;
  samplePointsNative: readonly RasterPoint[];
}
```

## CaptureRotationInverseMappings

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureRotationInverseMappings {
  timeReference: "first-opening-boundary-phase";
  referenceTimeSecondsFromCaptureReference: 0;
  mappingMeaning:
    "instantaneous-destination-to-exposure-start-reference-ray";
  orientation: CaptureOrientation;
  localExposurePhase: number;
  imagingArea: SensorImagingArea;
  activeCaptureRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  samples: readonly CaptureRotationInverseMappingSample[];
  componentProvenance: {
    exposureWindows: CalculationProvenance;
    sensorGeometry: CalculationProvenance;
    inverseCameraRotation: CalculationProvenance;
  };
}
```

## CaptureRotationInverseMappingSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureRotationInverseMappingSample {
  destinationPointNative: RasterPoint;
  destinationImagePointMm: ImagePlanePointMm;
  localExposureWindow: {
    startSecondsFromCaptureReference: number;
    endSecondsFromCaptureReference: number;
    durationSeconds: number;
  };
  localExposurePhase: number;
  captureTimeSecondsFromReference: number;
  /**
   * The same still world ray on the reference image plane at exposure start.
   * It may lie outside the active capture area; it is deliberately not
   * clamped.
   */
  referenceImagePointMm: ImagePlanePointMm;
  inverseDisplacementImagePlaneMm: {
    x: number;
    y: number;
    distance: number;
  };
  /**
   * Reference minus destination displacement, in continuous native effective
   * raster samples (+X right, +Y down).
   */
  inverseDisplacementNativeSamples: RasterVector & {
    distance: number;
  };
  /**
   * The same displacement after physical capture orientation.
   */
  inverseDisplacementOrientedSamples: RasterVector & {
    distance: number;
  };
}
```
