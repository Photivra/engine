# motion/capture-rotation-temporal-quadrature.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCaptureRotationTemporalQuadrature

Builds deterministic time samples (temporal quadrature nodes) for a
rotating camera, across each destination point's local exposure interval.

The first model uses an equal-width midpoint rule. Every node calls
calculateCaptureRotationInverseMappings(), so the instantaneous geometry
has a single implementation.

No radiance is evaluated here. normalizedTimeWeight is for a time average,
assuming a uniform response over time. timeMeasureSeconds is the local dt
for a time integral. Neither weight includes shutter transmission, scene
flicker, sensor response, radiometric calibration or any other throughput
term.

No numerical integration error estimate is reported, on purpose. Geometry
alone cannot tell the error in a scene-radiance integral. A renderer that
needs evidence of convergence can compare results for increasing sample
counts in its own radiance domain.

```ts
export function calculateCaptureRotationTemporalQuadrature(
  input: CalculateCaptureRotationTemporalQuadratureInput
): CalculationResult<CaptureRotationTemporalQuadrature>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateCaptureRotationTemporalQuadratureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateCaptureRotationTemporalQuadratureInput
  extends Omit<
    CalculateCaptureRotationInverseMappingsInput,
    "localExposurePhase"
  > {
  /**
   * Number of time samples (quadrature nodes) per local exposure interval.
   * Nodes follow the uniform midpoint rule.
   */
  temporalSampleCount: number;
}
```

## CaptureRotationTemporalQuadrature

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureRotationTemporalQuadrature {
  timeReference: "first-opening-boundary-phase";
  quadratureScheme: "uniform-midpoint";
  temporalResponseModel: "uniform-over-local-exposure";
  temporalSampleCount: number;
  /**
   * The quadrature returns geometry and temporal measure only. It does not
   * integrate radiance or produce a blur kernel.
   */
  outputMeaning: "temporal-geometry-quadrature-nodes";
  points: readonly CaptureRotationTemporalQuadraturePoint[];
  componentProvenance: {
    instantaneousInverseMapping: CalculationProvenance;
  };
}
```

## CaptureRotationTemporalQuadratureNode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureRotationTemporalQuadratureNode {
  temporalSampleIndex: number;
  /**
   * Normalized phase in the local exposure interval, strictly inside (0, 1).
   */
  localExposurePhase: number;
  captureTimeSecondsFromReference: number;
  /**
   * Dimensionless weight for approximating the time average of a quantity,
   * assuming a uniform response over time.
   */
  normalizedTimeWeight: number;
  /**
   * Quadrature measure in seconds, for approximating a time integral.
   *
   * This is a measure of time only. It is not shutter transmission,
   * radiometric throughput, photon count, sensor response or scene radiance.
   */
  timeMeasureSeconds: number;
  referenceImagePointMm: ImagePlanePointMm;
  inverseDisplacementImagePlaneMm: {
    x: number;
    y: number;
    distance: number;
  };
  inverseDisplacementNativeSamples: RasterVector & {
    distance: number;
  };
  inverseDisplacementOrientedSamples: RasterVector & {
    distance: number;
  };
}
```

## CaptureRotationTemporalQuadraturePoint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureRotationTemporalQuadraturePoint {
  destinationPointNative: RasterPoint;
  destinationImagePointMm: ImagePlanePointMm;
  localExposureWindow: {
    startSecondsFromCaptureReference: number;
    endSecondsFromCaptureReference: number;
    durationSeconds: number;
  };
  nodes: readonly CaptureRotationTemporalQuadratureNode[];
}
```
