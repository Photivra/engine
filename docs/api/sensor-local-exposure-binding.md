# sensor/local-exposure-binding.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## bindSensorRateToLocalExposure

Links one engine-made sensor response-rate result to the local exposure
window of the same colour-sampling site.

Only a one-to-one link between native image samples and colour sites is
supported. A block binding shows which sites contribute, but not each site's
timing position within the sample. So shutter timing that varies across the
sensor is rejected rather than guessing fractional positions.

The result fixes timing only. It does not establish that the optical or
electrical rate is constant through the window, so it does not by itself
allow rate × duration integration.

```ts
export function bindSensorRateToLocalExposure(
  input:
    BindSensorRateToLocalExposureInput
): CalculationResult<SensorRateLocalExposureBinding>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## BindSensorRateToLocalExposureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BindSensorRateToLocalExposureInput {
  rate:
    SensorInstantaneousRateResult;
  colorSamplingProfile:
    SensorColorSamplingProfile;
  bindingProfile:
    NativeEffectiveRasterColorSamplingBindingProfile;
  /**
   * One capture (exposure) event. samplePointsNative is left out on purpose,
   * because this function sets it.
   */
  exposureWindowInput:
    Omit<
      CalculateCaptureExposureWindowsInput,
      "samplePointsNative"
    >;
}
```

## SensorInstantaneousRateResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorInstantaneousRateResult =
  | SensorEqeElectronRate
  | SensorResponsivityPhotocurrent;
```

## SensorRateLocalExposureBinding

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorRateLocalExposureBinding {
  rateDomain:
    | "eqe-electron-rate"
    | "responsivity-photocurrent";
  rateIdentity: {
    responseProfileId: string;
    responseApplicationProfileId: string;
    operatingRangeProfileId: string;
    electricalApplicabilityProfileId?: string;
  };
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  bindingRelationship:
    "one-native-effective-sample-to-one-color-site";
  timingCoordinateRule:
    "one-to-one-color-site-center-equals-native-effective-sample-center";
  nativeRasterPoint: {
    x: number;
    y: number;
  };
  shutterMechanism:
    CalculateCaptureExposureWindowsInput["shutterMechanism"];
  timeReference:
    "first-opening-boundary-phase";
  localExposureWindow:
    CaptureExposureWindowSample;
  localExposureDurationSeconds:
    number;
  exposureEventMeaning:
    "single-capture-local-exposure-window";
  nativeImageRasterBindingEstablished: true;
  channelAtSiteValidated: true;
  physicalPhotodiodeTimingRegistrationEstablished:
    false;
  multiFrameSequenceBindingEstablished:
    false;
  timeStationarityEstablished: false;
  constantRateTemporalIntegrationAuthorized:
    false;
  temporalIntegrationApplied: false;
  componentEvidence: {
    binding:
      readonly EvidenceProvenance[];
    colorSamplingProfile:
      readonly EvidenceProvenance[];
    nominalExposureDuration:
      readonly EvidenceProvenance[];
    openingBoundary:
      readonly EvidenceProvenance[];
    closingBoundary:
      readonly EvidenceProvenance[];
  };
}
```
