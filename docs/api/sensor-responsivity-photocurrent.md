# sensor/responsivity-photocurrent.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorResponsivityPhotocurrent

Sums responsivity (A/W) × radiant power over wavelength bins to get the steady current magnitude,
under explicit electrical conditions.

This is not EQE, an electron rate, a transimpedance voltage or RAW. Fast-changing current needs a
separate time-dependent detector model.

```ts
export function calculateSensorResponsivityPhotocurrent(
  input:
    CalculateSensorResponsivityPhotocurrentInput
): CalculationResult<SensorResponsivityPhotocurrent>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorResponsivityPhotocurrentInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorResponsivityPhotocurrentInput {
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
  electricalApplicabilityProfile:
    SensorResponsivityElectricalApplicabilityProfile;
  operatingElectricalConditions:
    SensorResponsivityElectricalConditions;
}
```

## parseSensorResponsivityElectricalApplicabilityProfile

Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
missing required fields and inconsistent scientific data are rejected.

The profile states the electrical bias and load conditions under which an A/W responsivity applies.

```ts
export function parseSensorResponsivityElectricalApplicabilityProfile(
  value: unknown
): SensorResponsivityElectricalApplicabilityProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SensorResponsivityBiasCondition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorResponsivityBiasCondition =
  | {
      kind: "zero-bias-photovoltaic";
    }
  | {
      kind: "reverse-biased";
      magnitudeVolts: number;
    };
```

## SensorResponsivityElectricalApplicabilityProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorResponsivityElectricalApplicabilityProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  responseApplicationProfileId: string;
  spectralResponseProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  outputMeaning:
    "detector-terminal-photocurrent-magnitude";
  referenceConditions:
    SensorResponsivityElectricalConditions;
  conditionPolicy:
    SensorResponsivityElectricalConditionPolicy;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  evidence: readonly EvidenceProvenance[];
}
```

## SensorResponsivityElectricalConditionPolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorResponsivityElectricalConditionPolicy =
  | {
      kind: "exact-match-required";
    }
  | {
      kind: "assume-compatible";
      limitation: string;
      evidence: readonly EvidenceProvenance[];
    };
```

## SensorResponsivityElectricalConditions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorResponsivityElectricalConditions {
  bias: SensorResponsivityBiasCondition;
  readoutLoad:
    SensorResponsivityReadoutLoadCondition;
}
```

## SensorResponsivityPhotocurrent

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorResponsivityPhotocurrent {
  colorSamplingProfileId: string;
  responseProfileId: string;
  responseApplicationProfileId: string;
  operatingRangeProfileId: string;
  electricalApplicabilityProfileId:
    string;
  /** The exact source colour site. Results produced by the engine fill this in. */
  site?: {
    x: number;
    y: number;
  };
  channelId: string;
  sourceResponseKind:
    "effective-spectral-responsivity";
  responseScope:
    SensorSpatioSpectralIrradianceReduction["responseScope"];
  responseReferencePlane:
    SensorResponseApplicationCompatibilityAssessment["requiredSourcePlane"];
  wavelengthBasis:
    SensorSpatioSpectralIrradianceReduction["wavelengthBasis"];
  wavelengthRangeNanometers:
    SensorSpatioSpectralIrradianceReduction["wavelengthRangeNanometers"];
  electricalReferenceConditions:
    SensorResponsivityElectricalConditions;
  operatingElectricalConditions:
    SensorResponsivityElectricalConditions;
  electricalConditionPolicy:
    SensorResponsivityElectricalConditionPolicy;
  electricalCompatibility:
    | "exact-match"
    | "assumed-compatible";
  spectralNodeCount: number;
  perWavelength:
    readonly SensorResponsivityWavelengthCurrentContribution[];
  photocurrentMagnitudeAmperes: number;
  currentSignConvention:
    "magnitude-only-no-circuit-polarity";
  summationMethod:
    "kahan-compensated";
  responseApplicationPerformed: true;
  spectralResponsivityApplied: true;
  quantumEfficiencyApplied: false;
  photonRateCalculated: false;
  electronRateCalculated: false;
  currentCalculated: true;
  chargeCalculated: false;
  temporalResponseModel:
    "quasi-static-steady-state-only";
  detectorBandwidthModeled: false;
  transimpedanceGainApplied: false;
  voltageCalculated: false;
  temporalIntegrationApplied: false;
  exposureDurationApplied: false;
  saturationAssessed: false;
  readoutElectronicsLinearityAssessed:
    false;
  shotNoiseApplied: false;
  readNoiseApplied: false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  responseUncertaintyPropagated: false;
  electricalApplicabilityUncertaintyPropagated:
    false;
  quadratureConvergenceErrorEstimated:
    false;
  componentEvidence: {
    electricalApplicability:
      readonly EvidenceProvenance[];
    electricalConditionAssumption:
      readonly EvidenceProvenance[];
  };
}
```

## SensorResponsivityReadoutLoadCondition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorResponsivityReadoutLoadCondition =
  | {
      kind: "virtual-ground-current-readout";
    }
  | {
      kind: "finite-input-impedance";
      inputImpedanceOhms: number;
    };
```

## SensorResponsivityWavelengthCurrentContribution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorResponsivityWavelengthCurrentContribution {
  spectralSampleIndex: number;
  wavelengthNanometers: number;
  wavelengthMeasureNanometers: number;
  geometricApertureIncidentSpectralFluxWattsPerNanometer:
    number;
  radiantPowerContributionWatts: number;
  spectralResponsivityAmperesPerWatt:
    number;
  responseInterpolationUsed: boolean;
  photocurrentMagnitudeContributionAmperes:
    number;
}
```
