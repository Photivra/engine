# sensor/spatial-sample-reduction.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## reduceSensorSpatialSamplingQuadrature

Combines nonnegative linear values, each tagged with its node, over a
validated sensor spatial quadrature.

It does not sample a renderer or optical model itself. Callers evaluate one
value at every node's preAntiAliasingSourcePointMm and pass the values with
their exact node identity. Order does not matter.

Two value domains are supported:

- relative-linear: a dimensionless, nonnegative stand-in for irradiance, for
  deterministic renderer and science regression tests;
- radiometric-irradiance: physical irradiance on the sensor plane in W/m^2.

The destination site's channelId is a label only. No CFA spectral
transmittance or sensitivity is applied, so do not call the output a
colour-filtered mosaic sample or a RAW value.

```ts
export function reduceSensorSpatialSamplingQuadrature(
  input: ReduceSensorSpatialSamplingQuadratureInput
): CalculationResult<SensorSpatialSampleReduction>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ReduceSensorSpatialSamplingQuadratureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ReduceSensorSpatialSamplingQuadratureInput {
  quadrature: SensorSpatialSamplingQuadrature;
  valueDomain: SensorSpatialSampleValueDomain;
  /**
   * Exactly one value per quadrature node, each with its node identity.
   *
   * Order does not matter; the node identity does.
   */
  nodeValues: readonly SensorSpatialQuadratureNodeValue[];
}
```

## SensorSpatialQuadratureNodeIdentity

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpatialQuadratureNodeIdentity {
  antiAliasingComponentIndex: number;
  apertureSampleXIndex: number;
  apertureSampleYIndex: number;
}
```

## SensorSpatialQuadratureNodeValue

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpatialQuadratureNodeValue {
  node: SensorSpatialQuadratureNodeIdentity;
  /**
   * A nonnegative, finite number in the declared value domain.
   *
   * It is evaluated at the matching node's preAntiAliasingSourcePointMm.
   */
  value: number;
}
```

## SensorSpatialSampleReduction

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpatialSampleReduction {
  site: {
    x: number;
    y: number;
  };
  /**
   * Label of the destination CFA (colour filter array) site only.
   *
   * This reducer applies no spectral filter response.
   */
  channelId: string;
  outputMeaning:
    "channel-tagged-pre-response-spatial-sample";
  valueDomain: SensorSpatialSampleValueDomain;
  nodeCount: number;
  sourceValuesMatchedBy:
    "quadrature-node-identity";
  sourceValuesSuppliedForAllNodes: true;
  outsideImagingAreaSourceValuesRequired: boolean;
  normalizedSpatialWeightSum: number;
  geometricApertureAreaSquareMicrometers: number;
  reducedValue: SensorSpatialSampleReductionValue;
  cfaSpectralFilteringApplied: false;
  channelIdIsSpectralResponse: false;
  temporalIntegrationApplied: false;
  exposureDurationApplied: false;
  quantumEfficiencyApplied: false;
  microlensResponseApplied: false;
  opticalThroughputAppliedByReducer: false;
  photonsCalculated: false;
  electronsCalculated: false;
  shotNoiseApplied: false;
  readNoiseApplied: false;
  adcQuantizationApplied: false;
  blackLevelApplied: false;
  saturationApplied: false;
  rawCodeValueProduced: false;
  demosaicOrReconstructionApplied: false;
}
```

## SensorSpatialSampleReductionValue

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorSpatialSampleReductionValue =
  | {
      kind: "relative-linear";
      unit: "relative";
      semantic:
        "nonnegative-sensor-plane-irradiance-proxy";
      /**
       * Weighted spatial average (dimensionless), in the same relative domain.
       */
      normalizedSpatialAverageRelative: number;
      /**
       * Relative value × square micrometres.
       *
       * A geometric, area-weighted diagnostic, not a radiometric power.
       */
      geometricAreaIntegralRelativeSquareMicrometers: number;
    }
  | {
      kind: "radiometric-irradiance";
      unit: "W/m^2";
      semantic: "sensor-plane-irradiance";
      /**
       * Weighted mean irradiance over the geometric aperture, after the
       * declared normalized AA spreading.
       */
      normalizedSpatialAverageIrradianceWattsPerSquareMeter: number;
      /**
       * Incident radiant flux: the supplied irradiance integrated over the
       * geometric aperture, with the declared normalized AA spreading.
       * Units: watts.
       *
       * It is before any CFA response, QE or microlens response, and excludes
       * any optical-stack throughput not already in the caller's irradiance values.
       */
      geometricApertureIncidentFluxWatts: number;
    };
```

## SensorSpatialSampleValueDomain

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorSpatialSampleValueDomain =
  | {
      kind: "relative-linear";
      unit: "relative";
      semantic:
        "nonnegative-sensor-plane-irradiance-proxy";
    }
  | {
      kind: "radiometric-irradiance";
      unit: "W/m^2";
      semantic: "sensor-plane-irradiance";
    };
```
