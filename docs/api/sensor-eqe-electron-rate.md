# sensor/eqe-electron-rate.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorEqeElectronRate

Converts the spectral radiant power collected by the site's geometric aperture
(before the sensor response) into an incident photon rate and an expected
generated electron rate.

The response is applied at each wavelength node. One broadband-average QE is
never applied to the total power.

Integration over exposure time happens later, so all outputs are rates per
second, not photon or electron counts.

```ts
export function calculateSensorEqeElectronRate(
  input:
    CalculateSensorEqeElectronRateInput
): CalculationResult<SensorEqeElectronRate>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorEqeElectronRateInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorEqeElectronRateInput {
  reduction:
    SensorSpatioSpectralIrradianceReduction;
  compatibility:
    SensorResponseApplicationCompatibilityAssessment;
  operatingRange:
    SensorResponseOperatingRangeAssessment;
  colorSamplingProfile:
    SensorColorSamplingProfile;
  spectralResponseProfile:
    SensorSpectralResponseProfile;
  airPhotonEnergyContext?:
    SensorEqeAirPhotonEnergyContext;
}
```

## SensorEqeAirPhotonEnergyContext

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorEqeAirPhotonEnergyContext {
  samples:
    readonly SensorEqeAirRefractiveIndexSample[];
  operatingConditions?:
    AirRefractiveIndexReferenceConditions;
  conditionPolicy:
    AirRefractiveIndexConditionPolicy;
}
```

## SensorEqeAirRefractiveIndexSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorEqeAirRefractiveIndexSample {
  spectralSampleIndex: number;
  refractiveIndex:
    SourcedAirPhaseRefractiveIndex;
}
```

## SensorEqeElectronRate

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorEqeElectronRate {
  colorSamplingProfileId: string;
  responseProfileId: string;
  responseApplicationProfileId: string;
  operatingRangeProfileId: string;
  /** The exact source colour site. Results produced by the engine fill this in. */
  site?: {
    x: number;
    y: number;
  };
  channelId: string;
  sourceResponseKind:
    | "effective-external-quantum-efficiency"
    | "separable-channel-filter-and-detector-eqe";
  responseScope:
    SensorSpatioSpectralIrradianceReduction["responseScope"];
  responseReferencePlane:
    SensorResponseApplicationCompatibilityAssessment["requiredSourcePlane"];
  wavelengthBasis:
    SensorSpatioSpectralIrradianceReduction["wavelengthBasis"];
  wavelengthRangeNanometers:
    SensorSpatioSpectralIrradianceReduction["wavelengthRangeNanometers"];
  spectralNodeCount: number;
  perWavelength:
    readonly SensorEqeWavelengthRateContribution[];
  incidentPhotonRatePerSecond: number;
  expectedGeneratedElectronRatePerSecond:
    number;
  summationMethod:
    "kahan-compensated";
  responseApplicationPerformed: true;
  quantumEfficiencyApplied: true;
  spectralResponsivityApplied: false;
  channelFilterTransmissionApplied:
    boolean;
  photonRateCalculated: true;
  electronRateCalculated: true;
  photonCountCalculated: false;
  electronCountCalculated: false;
  currentCalculated: false;
  temporalIntegrationApplied: false;
  exposureDurationApplied: false;
  saturationAssessed: false;
  shotNoiseApplied: false;
  readNoiseApplied: false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  responseUncertaintyPropagated: false;
  photonEnergyUncertaintyPropagated: false;
  quadratureConvergenceErrorEstimated:
    false;
}
```

## SensorEqeWavelengthRateContribution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorEqeWavelengthRateContribution {
  spectralSampleIndex: number;
  wavelengthNanometers: number;
  wavelengthMeasureNanometers: number;
  geometricApertureIncidentSpectralFluxWattsPerNanometer:
    number;
  radiantPowerContributionWatts: number;
  vacuumWavelengthNanometers: number;
  photonEnergyJoules: number;
  wavelengthConversion:
    | "vacuum-identity"
    | "air-to-vacuum-via-phase-refractive-index";
  phaseRefractiveIndexUsed?: number;
  airConditionCompatibility?:
    | "exact-match"
    | "assumed-compatible";
  airRefractiveIndexEvidence?:
    readonly EvidenceProvenance[];
  incidentPhotonRatePerSecond: number;
  effectiveExternalQuantumEfficiency: number;
  responseComposition:
    | "direct-effective-response"
    | "channel-filter-transmittance-times-detector-eqe";
  channelFilterTransmittance?: number;
  detectorExternalQuantumEfficiency?: number;
  responseInterpolationUsed: boolean;
  expectedGeneratedElectronRatePerSecond:
    number;
}
```
