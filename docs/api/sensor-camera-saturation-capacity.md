# sensor/camera-saturation-capacity.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## assessSensorCameraSaturationCapacity

Compares the expected photo signal (dark-corrected) with the camera's declared saturation
capacity. Dark charge is not added, and no hardware clamp is identified.

This compares expected values only. It does not make up codes beyond saturation.

```ts
export function assessSensorCameraSaturationCapacity(
  input:
    AssessSensorCameraSaturationCapacityInput
): CalculationResult<SensorCameraSaturationCapacityAssessment>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## AssessSensorCameraSaturationCapacityInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AssessSensorCameraSaturationCapacityInput {
  accumulatedCharge:
    SensorAccumulatedChargeComposition;
  saturationProfile:
    SensorCameraSaturationCapacityProfile;
  operatingStateId: string;
  operatingTemperatureC: number;
}
```

## parseSensorCameraSaturationCapacityProfile

Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
missing required fields and inconsistent scientific data are rejected.

Camera saturation capacity is a limit on the dark-corrected photo signal, in electron
equivalents. It is not the physical charge storage capacity or the ADC maximum, and does not
identify which hardware stage limits it.

```ts
export function parseSensorCameraSaturationCapacityProfile(
  value: unknown
): SensorCameraSaturationCapacityProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SensorCameraSaturationCapacityAssessment

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorCameraSaturationCapacityAssessment {
  saturationProfileId: string;
  completenessProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  operatingStateId: string;
  operatingTemperatureC: number;
  capacityMeaning:
    "camera-signal-saturation-capacity-electrons";
  signalDomain:
    "dark-corrected-photo-generated-electron-equivalent";
  cameraSignalSaturationCapacityElectrons:
    number;
  expectedPhotoSignalElectronCount:
    number;
  totalExpectedStoredElectronCountDiagnostic:
    number;
  totalStoredChargeUsedForCameraSaturationComparison:
    false;
  expectedSignalToCameraSaturationRatio:
    number;
  expectedSignalHeadroomElectrons:
    number;
  expectedCameraSignalCapacityStatus:
    | "below-capacity"
    | "at-capacity"
    | "above-capacity";
  expectedPhotoSignalExceedsCameraCapacity:
    boolean;
  cameraSaturationCapacityAssessmentPerformed:
    true;
  assessmentMeaning:
    "expected-dark-corrected-photo-signal-vs-camera-saturation-capacity";
  physicalChargeCapacityUsed:
    false;
  limitingSaturationMechanismResolved:
    false;
  analogClippingThresholdModeled:
    false;
  digitalClippingThresholdModeled:
    false;
  adcMaximumCodeUsed:
    false;
  actualStochasticSaturationStateKnown:
    false;
  stochasticSaturationProbabilityAssessed:
    false;
  outputSignalAfterSaturationCalculated:
    false;
  clampApplied: false;
  physicalStoredChargeModified:
    false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  saturationCapacityUncertaintyPropagated:
    false;
  photoSignalUncertaintyPropagated:
    false;
  componentEvidence: {
    saturationCapacity:
      readonly EvidenceProvenance[];
    measurementMethod:
      readonly EvidenceProvenance[];
    operatingState:
      readonly EvidenceProvenance[];
    siteApproximation:
      readonly EvidenceProvenance[];
    temperatureApproximation:
      readonly EvidenceProvenance[];
    chargeCompleteness:
      SensorAccumulatedChargeComposition["componentEvidence"]["completeness"];
  };
}
```

## SensorCameraSaturationCapacityProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorCameraSaturationCapacityProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  capacityMeaning:
    "camera-signal-saturation-capacity-electrons";
  signalDomain:
    "dark-corrected-photo-generated-electron-equivalent";
  saturationCapacityElectrons: number;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  evidence:
    readonly EvidenceProvenance[];
  measurementMethodId: string;
  measurementMethodEvidence:
    readonly EvidenceProvenance[];
  siteApplicability:
    SensorCameraSaturationSiteApplicability;
  operatingState: {
    stateId: string;
    evidence:
      readonly EvidenceProvenance[];
  };
  temperatureApplicability:
    SensorCameraSaturationTemperatureApplicability;
}
```

## SensorCameraSaturationSiteApplicability

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorCameraSaturationSiteApplicability =
  | {
      kind: "exact-site";
      site: {
        x: number;
        y: number;
      };
    }
  | {
      kind:
        "channel-population-mean-approximation";
      limitation: string;
      evidence:
        readonly EvidenceProvenance[];
    };
```

## SensorCameraSaturationTemperatureApplicability

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorCameraSaturationTemperatureApplicability =
  | {
      kind:
        "exact-reference-temperature";
      temperatureC: number;
    }
  | {
      kind: "not-modeled";
      limitation: string;
      evidence:
        readonly EvidenceProvenance[];
    };
```
