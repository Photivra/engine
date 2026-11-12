# sensor/dark-current.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorDarkCurrentCharge

Evaluates the declared dark-current rate at the sensor temperature and integrates it over the exact
local exposure of the photo signal.

The rate is a population mean, an approximation. Hot pixels and DCNU (dark-current non-uniformity)
are not modelled. No universal doubling-temperature law is assumed.

```ts
export function calculateSensorDarkCurrentCharge(
  input: Omit<CalculateSensorDarkCurrentChargeInput, "exposure"> & { exposure: SensorEqeExposureIntegration }
): CalculationResult<SensorDarkCurrentCharge>;
```

```ts
export function calculateSensorDarkCurrentCharge(
  input: Omit<CalculateSensorDarkCurrentChargeInput, "exposure"> & { exposure: SensorEqeTemporalPhotoSignal }
): CalculationResult<SensorTemporalDarkCurrentCharge>;
```

```ts
export function calculateSensorDarkCurrentCharge(
  input: CalculateSensorDarkCurrentChargeInput<SensorEqePhotoExposure>
): CalculationResult<SensorPhotoDarkCurrentCharge>;
```

```ts
export function calculateSensorDarkCurrentCharge(
  input:
    CalculateSensorDarkCurrentChargeInput<SensorEqePhotoExposure>
): CalculationResult<SensorPhotoDarkCurrentCharge>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorDarkCurrentChargeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorDarkCurrentChargeInput<Exposure extends SensorEqePhotoExposure = SensorEqeExposureIntegration> {
  exposure:
    Exposure;
  darkCurrentProfile:
    SensorDarkCurrentProfile;
  operatingTemperatureC: number;
}
```

## parseSensorDarkCurrentProfile

Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
missing required fields and inconsistent scientific data are rejected.

The profile declares the dark-current rate (before compensation) against temperature, at an exact
temperature or as samples. Interpolation (log-linear, or the legacy linear rule) is allowed only
within the declared range. No universal doubling-temperature law is assumed.

```ts
export function parseSensorDarkCurrentProfile(
  value: unknown
): SensorDarkCurrentProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SensorDarkCurrentCharge

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorDarkCurrentCharge {
  darkCurrentProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  stationarityProfileId: string;
  temporalIntegrationId?: never;
  timeReference:
    "first-opening-boundary-phase";
  startOffsetSecondsFromOpeningReference:
    number;
  endOffsetSecondsFromOpeningReference:
    number;
  operatingTemperatureC: number;
  temperatureModel:
    SensorDarkCurrentTemperatureModel["kind"];
  temperatureInterpolationUsed:
    boolean;
  darkCurrentElectronsPerSecond:
    number;
  localExposureDurationSeconds:
    number;
  expectedDarkElectronCount:
    number;
  countMeaning:
    "expected-thermally-generated-electrons";
  expectationValueOnly: true;
  integerDarkElectronCountSampled:
    false;
  darkShotNoiseApplied: false;
  darkCurrentCompensationApplied:
    false;
  spatialDarkCurrentNonuniformityModeled:
    boolean;
  photoSignalIncluded: false;
  otherChargeIncluded: false;
  physicalFullWellAssessmentAuthorized:
    false;
  saturationAssessed: false;
  componentEvidence: {
    darkCurrent:
      readonly EvidenceProvenance[];
    siteApproximation:
      readonly EvidenceProvenance[];
    exposure:
      SensorEqeExposureIntegration["componentEvidence"];
  };
}
```

## SensorDarkCurrentProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorDarkCurrentProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  evidence: readonly EvidenceProvenance[];
  chargeMeaning:
    "pre-compensation-thermally-generated-electrons";
  siteApplicability:
    SensorDarkCurrentSiteApplicability;
  temperatureModel:
    SensorDarkCurrentTemperatureModel;
  darkCurrentCompensationIncluded: false;
  spatialDarkCurrentNonuniformityModeled:
    boolean;
}
```

## SensorDarkCurrentSiteApplicability

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorDarkCurrentSiteApplicability =
  | {
      kind: "exact-site";
      site: {
        x: number;
        y: number;
      };
    }
  | {
      kind:
        "uniform-site-mean-approximation";
      limitation: string;
      evidence:
        readonly EvidenceProvenance[];
    };
```

## SensorDarkCurrentTemperatureModel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorDarkCurrentTemperatureModel =
  | {
      kind:
        "fixed-reference-temperature";
      referenceTemperatureC: number;
      darkCurrentElectronsPerSecond:
        number;
    }
  | {
      /** Legacy interpolation, linear in rate. Between samples of an exponential curve it gives values that are too high. */
      kind:
        "piecewise-linear-temperature-table";
      interpolation: "piecewise-linear";
      outsideRangeBehavior:
        "fail-closed";
      samples: readonly {
        temperatureC: number;
        darkCurrentElectronsPerSecond:
          number;
      }[];
    }
  | {
      /**
       * Linear interpolation of ln(rate) between neighbouring samples. That makes the rate exponential
       * in temperature within each interval, matching the roughly exponential (Arrhenius, or
       * "doubling temperature") behaviour of thermally generated dark current. Rates must be strictly
       * positive. No single doubling temperature is imposed; each interval follows its own two samples.
       */
      kind:
        "log-linear-temperature-table";
      interpolation: "log-linear";
      outsideRangeBehavior:
        "fail-closed";
      samples: readonly {
        temperatureC: number;
        darkCurrentElectronsPerSecond:
          number;
      }[];
    };
```

## SensorPhotoDarkCurrentCharge

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorPhotoDarkCurrentCharge = SensorDarkCurrentCharge | SensorTemporalDarkCurrentCharge;
```

## SensorTemporalDarkCurrentCharge

Dark charge for the exact same time-resolved photo event. It has no stationarity ID.

```ts
export type SensorTemporalDarkCurrentCharge = Omit<SensorDarkCurrentCharge, "stationarityProfileId" | "temporalIntegrationId" | "componentEvidence"> & {
  stationarityProfileId?: never;
  temporalIntegrationId: string;
  componentEvidence: Omit<SensorDarkCurrentCharge["componentEvidence"], "exposure"> & { exposure: SensorEqeTemporalPhotoSignal["componentEvidence"] };
};
```
