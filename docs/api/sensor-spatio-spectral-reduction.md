# sensor/spatio-spectral-reduction.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## reduceSensorSpatioSpectralIrradiance

Integrates supplied spectral irradiance on the sensor plane, E_lambda(x,y),
over every combination of an existing spatial quadrature and spectral
quadrature.

Units: the density is in W/m^2/nm and wavelengthMeasureNanometers is dλ in
nm, so their product is in W/m^2. Do not convert dλ to metres unless the
density's per-nanometre unit is converted to match.

Area integration uses the spatial quadrature's geometric area measures,
converted from square micrometres to square metres. The result is the
incident radiant flux on the geometric aperture only; geometric area is not
treated as an effective light-collection area.

It deliberately stops before the sensor response. The spectral plan comes
from a specific response channel, so its wavelength range and breakpoints
fit that channel, but QE, A/W responsivity and colour-filter transmission are
not applied here. Matching the response's scope and source plane is a
separate later step.

```ts
export function reduceSensorSpatioSpectralIrradiance(
  input:
    ReduceSensorSpatioSpectralIrradianceInput
): CalculationResult<SensorSpatioSpectralIrradianceReduction>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ReduceSensorSpatioSpectralIrradianceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ReduceSensorSpatioSpectralIrradianceInput {
  spatialQuadrature: SensorSpatialSamplingQuadrature;
  spectralQuadrature: SensorSpectralQuadrature;
  /**
   * Exactly one E_lambda(x,y) value, with its node identity, for every
   * combination of spatial node and spectral node.
   *
   * Order does not matter; the node identity does.
   */
  sampleValues: readonly SensorSpatioSpectralIrradianceSample[];
}
```

## SensorSpatioSpectralIrradianceReduction

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpatioSpectralIrradianceReduction {
  colorSamplingProfileId: string;
  samplingApertureProfileId?: string;
  opticalStackProfileId?: string;
  site: {
    x: number;
    y: number;
  };
  channelId: string;
  responseProfileId: string;
  sourceResponseKind:
    SensorSpectralQuadrature["sourceResponseKind"];
  responseScope:
    SensorSpectralQuadrature["responseScope"];
  responseScientificStatus:
    SensorSpectralQuadrature["responseScientificStatus"];
  responseUncertainty:
    SensorSpectralQuadrature["responseUncertainty"];
  responseChannelBinding?:
    SensorSpectralQuadrature["responseChannelBinding"];
  responseReferenceConditions?:
    SensorSpectralQuadrature["responseReferenceConditions"];
  wavelengthBasis:
    SensorSpectralQuadrature["wavelengthBasis"];
  wavelengthBasisResolved: boolean;
  wavelengthRangeNanometers:
    SensorSpectralQuadrature["wavelengthRangeNanometers"];
  responseDeclaredWavelengthRangeNanometers:
    SensorSpectralQuadrature["responseDeclaredWavelengthRangeNanometers"];
  outputMeaning:
    "pre-response-spatio-spectral-radiometric-reduction";
  inputValueDomain: {
    kind: "radiometric-spectral-irradiance";
    unit: "W/m^2/nm";
    semantic:
      "pre-aa-pre-response-sensor-plane-spectral-irradiance";
  };
  spatialNodeCount: number;
  spectralNodeCount: number;
  combinedSampleCount: number;
  sourceValuesMatchedBy:
    "spatial-node-identity-plus-spectral-sample-index-and-wavelength";
  sourceValuesSuppliedForAllCombinedNodes: true;
  outsideImagingAreaSourceValuesRequired: boolean;
  geometricApertureAreaSquareMicrometers?: number;
  nominalSiteCellAreaSquareMicrometers?: number;
  geometricSensitiveAreaFractionOfLatticeCell?: number;
  perWavelength:
    readonly SensorSpatioSpectralWavelengthReduction[];
  /**
   * Integral over the requested wavelength interval of the spatially averaged
   * spectral irradiance. Units: W/m^2.
   */
  wavelengthIntegratedSpatialAverageIrradianceWattsPerSquareMeter:
    number;
  /**
   * Integral over the requested wavelength interval and the geometric
   * aperture area. Units: W.
   *
   * This is the incident radiant flux before the sensor response, over the
   * declared wavelength interval. It is not collected power or generated charge.
   */
  wavelengthIntegratedGeometricApertureIncidentFluxWatts:
    number;
  spatialIntegrationApplied: true;
  wavelengthIntegrationApplied: true;
  spectralResponsePlanUsedForWavelengthSupport: true;
  spectralResponseApplicationPerformed: false;
  responseScopeMatchedToSourcePlane: false;
  quantumEfficiencyApplied: false;
  spectralResponsivityApplied: false;
  channelFilterTransmissionApplied: false;
  opticalTransmissionAppliedByReducer: false;
  radiometricCollectionAreaEstablished: false;
  temporalIntegrationApplied: false;
  exposureDurationApplied: false;
  photonsCalculated: false;
  electronsCalculated: false;
  currentCalculated: false;
  shotNoiseApplied: false;
  readNoiseApplied: false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  demosaicOrReconstructionApplied: false;
  convergenceErrorEstimated: false;
  componentEvidence: {
    spatial:
      SensorSpatialSamplingQuadrature["componentEvidence"];
    spectral:
      SensorSpectralQuadrature["componentEvidence"];
  };
}
```

## SensorSpatioSpectralIrradianceSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpatioSpectralIrradianceSample {
  node: SensorSpatioSpectralNodeIdentity;
  /**
   * Spectral irradiance at the spatial node's preAntiAliasingSourcePointMm
   * and this spectral node's wavelength.
   *
   * Units: W/m^2/nm.
   */
  spectralIrradianceWattsPerSquareMeterPerNanometer: number;
}
```

## SensorSpatioSpectralNodeIdentity

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpatioSpectralNodeIdentity {
  spatialNode: SensorSpatialQuadratureNodeIdentity;
  spectralSampleIndex: number;
  wavelengthNanometers: number;
}
```

## SensorSpatioSpectralWavelengthReduction

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpatioSpectralWavelengthReduction {
  spectralSampleIndex: number;
  wavelengthNanometers: number;
  wavelengthMeasureNanometers: number;
  normalizedWavelengthWeight: number;
  /**
   * Spatially reduced spectral irradiance at this wavelength.
   * Units: W/m^2/nm.
   */
  normalizedSpatialAverageSpectralIrradianceWattsPerSquareMeterPerNanometer:
    number;
  /**
   * Spectral radiant flux reaching the geometric sensitive aperture, after the
   * declared normalized AA spreading. Units: W/nm.
   *
   * This uses geometric area, not an established light-collection area.
   */
  geometricApertureIncidentSpectralFluxWattsPerNanometer: number;
  /**
   * Contribution to the wavelength-integrated spatial average.
   * Units: W/m^2.
   */
  wavelengthIntegratedSpatialAverageContributionWattsPerSquareMeter: number;
  /**
   * Contribution to wavelength-integrated geometric-aperture incident flux.
   * Units: W.
   */
  wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts: number;
}
```
