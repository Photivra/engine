# sensor/spatial-sampling-quadrature.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorSpatialSamplingQuadrature

Builds the deterministic spatial sample points (quadrature nodes) for one CFA
(colour filter array) site.

It combines:

1. the site's geometric light-sensitive aperture (from sampling-aperture); and
2. the anti-aliasing (AA) point-splitting kernel (from optical-stack).

The aperture is integrated with a grid of evenly spaced midpoints (a
tensor-product midpoint rule). If an AA component moves light by +delta on
the sensor, a destination point samples the light field before AA at
destination − delta. Working backwards like this means the shift is never
applied twice.

The destination site's CFA channel applies to every node. The pre-AA source
point is a position in the light field, not another CFA site, so a shifted
source point never changes the destination channel.

Nodes whose pre-AA source point falls outside the active imaging area are
kept. They are neither clamped nor dropped (and weights are not
renormalized). The renderer or light-field provider decides how to cover them.

Normalized weights approximate a spatial average. Square-micrometre measures
approximate a geometric area integral. Neither includes throughput, QE,
photon conversion, microlenses, diffusion, crosstalk or integration over time.

```ts
export function calculateSensorSpatialSamplingQuadrature(
  input: CalculateSensorSpatialSamplingQuadratureInput
): CalculationResult<SensorSpatialSamplingQuadrature>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorSpatialSamplingQuadratureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorSpatialSamplingQuadratureInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
  colorSamplingProfile: SensorColorSamplingProfile;
  colorSamplingBindingProfile: NativeEffectiveRasterColorSamplingBindingProfile;
  samplingApertureProfile: SensorSamplingApertureProfile;
  opticalStackProfile: SensorOpticalStackProfile;
  site: NativeColorSamplingSiteIndex;
  /** Number of midpoint cells across the geometric aperture width. */
  spatialSampleCountX: number;
  /** Number of midpoint cells across the geometric aperture height. */
  spatialSampleCountY: number;
}
```

## SensorSpatialSamplingQuadrature

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpatialSamplingQuadrature {
  coordinateSystem: "native-sensor-physical";
  colorSamplingProfileId?: string;
  samplingApertureProfileId?: string;
  opticalStackProfileId?: string;
  site: NativeColorSamplingSiteIndex;
  channelId: string;
  quadratureScheme:
    "tensor-product-uniform-midpoint";
  outputMeaning:
    "pre-aa-optical-field-spatial-quadrature-nodes";
  spatialSampleCountX: number;
  spatialSampleCountY: number;
  antiAliasingComponentCount: number;
  totalNodeCount: number;
  geometricApertureAreaSquareMicrometers: number;
  nominalSiteCellAreaSquareMicrometers?: number;
  geometricSensitiveAreaFractionOfLatticeCell?: number;
  normalizedSpatialWeightSum: number;
  combinedAreaMeasureSumSquareMicrometers: number;
  preAntiAliasingSourceOutsideImagingAreaNodeCount: number;
  sourcePointRule:
    "pre-aa-source-equals-destination-minus-aa-offset";
  destinationCfaChannelAppliesToAllNodes: true;
  cfaReassignmentBySourceCoordinate: false;
  sourceCoveragePolicy: "not-applied";
  nodes: readonly SensorSpatialSamplingQuadratureNode[];
  /**
   * Fixed statements of what this result does not include.
   */
  opticalFieldValuesIncluded: false;
  radianceIncluded: false;
  photonsIncluded: false;
  electronsIncluded: false;
  spectralResponseIncluded: false;
  quantumEfficiencyIncluded: false;
  opticalThroughputIncluded: false;
  microlensResponseIncluded: false;
  chargeDiffusionIncluded: false;
  electricalCrosstalkIncluded: false;
  temporalIntegrationIncluded: false;
  rawSampleValueIncluded: false;
  reconstructedPixelValueIncluded: false;
  geometricAreaMeasureIsRadiometricCollectionArea: false;
  componentEvidence: {
    samplingApertureProfile: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
    samplingApertureLattice: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
    geometricSensitiveAperture: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
    opticalStackProfile: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
    antiAliasingResponse: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
  };
}
```

## SensorSpatialSamplingQuadratureNode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpatialSamplingQuadratureNode {
  antiAliasingComponentIndex: number;
  apertureSampleXIndex: number;
  apertureSampleYIndex: number;
  /**
   * Destination point inside the geometric sensitive aperture, after the
   * declared AA point splitting.
   *
   * Native sensor physical coordinates, in millimetres from the optical axis.
   */
  destinationAperturePointMm: {
    x: number;
    y: number;
  };
  /**
   * How far the declared AA component moves light on the sensor plane.
   *
   * +X right, +Y down; micrometres.
   */
  antiAliasingOffsetMicrometers: {
    x: number;
    y: number;
  };
  /**
   * The point in the light field before AA that lands on
   * destinationAperturePointMm through this split component:
   *
   * source = destination - AA offset
   */
  preAntiAliasingSourcePointMm: {
    x: number;
    y: number;
  };
  /**
   * Whether the pre-AA source point is inside the active physical imaging
   * area. False is not an error; downstream code decides how to handle valid
   * light from outside the active sampling area.
   */
  preAntiAliasingSourceInsideImagingArea: boolean;
  /** Dimensionless midpoint weight for the aperture-area average. */
  normalizedApertureWeight: number;
  /** Dimensionless normalized weight from the AA split component. */
  normalizedAntiAliasingWeight: number;
  /**
   * Product of the two weights (dimensionless), used to average a light field
   * over the site with this quadrature.
   */
  combinedNormalizedSpatialWeight: number;
  /**
   * Geometric area this aperture midpoint stands for, before the AA component
   * weight is applied. Units: square micrometres.
   */
  apertureAreaMeasureSquareMicrometers: number;
  /**
   * Geometric area multiplied by the (dimensionless) AA component weight.
   * Units are still square micrometres.
   *
   * This is not an effective light-collection area.
   */
  combinedAreaMeasureSquareMicrometers: number;
}
```
