# sensor/constant-rate-temporal-integration.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## IntegrateStationarySensorRateInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IntegrateStationarySensorRateInput {
  rate:
    SensorInstantaneousRateResult;
  exposureBinding:
    SensorRateLocalExposureBinding;
  stationarityProfile:
    SensorRateTemporalStationarityProfile;
}
```

## integrateStationarySensorRateOverLocalExposure

Integrates one response rate, declared constant, over its exact local
exposure window.

This is the constant-rate approximation only. It does not sample or
integrate a time-varying signal. EQE rates give expected photons and
electrons; A/W rates give coulombs. Counts stay fractional.

```ts
export function integrateStationarySensorRateOverLocalExposure(
  input:
    IntegrateStationarySensorRateInput
): CalculationResult<SensorStationaryRateExposureIntegration>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSensorRateTemporalStationarityProfile

Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
missing required fields and inconsistent scientific data are rejected.

The profile declares that a rate is constant (stationary) for an exact site and local shutter
interval, which is what allows rate × duration.

```ts
export function parseSensorRateTemporalStationarityProfile(
  value: unknown
): SensorRateTemporalStationarityProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SensorEqeExposureIntegration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorEqeExposureIntegration
  extends SensorTemporalIntegrationCommon {
  kind: "eqe-expected-counts";
  incidentPhotonRatePerSecond: number;
  expectedGeneratedElectronRatePerSecond:
    number;
  expectedIncidentPhotonCount: number;
  expectedGeneratedElectronCount:
    number;
  countsAreExpectationValues: true;
  integerPhotonCountSampled: false;
  integerElectronCountSampled: false;
  chargeCalculated: false;
  currentCalculated: false;
}
```

## SensorRateStationarityStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorRateStationarityStatus =
  | "established"
  | "approximation";
```

## SensorRateTemporalStationarityProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorRateTemporalStationarityProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  rateDomain:
    SensorRateLocalExposureBinding["rateDomain"];
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  localExposureWindow: {
    timeReference:
      "first-opening-boundary-phase";
    startOffsetSecondsFromOpeningReference:
      number;
    endOffsetSecondsFromOpeningReference:
      number;
  };
  stationarityMeaning:
    "reported-rate-constant-through-bound-local-exposure";
  status:
    SensorRateStationarityStatus;
  evidence: readonly EvidenceProvenance[];
  limitation?: string;
}
```

## SensorResponsivityExposureIntegration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorResponsivityExposureIntegration
  extends SensorTemporalIntegrationCommon {
  kind:
    "responsivity-photocurrent-charge";
  photocurrentMagnitudeAmperes: number;
  photochargeMagnitudeCoulombs:
    number;
  currentSignConvention:
    "magnitude-only-no-circuit-polarity";
  chargeSignConvention:
    "magnitude-only-no-carrier-or-circuit-polarity";
  carrierCountInferred: false;
  electronCountCalculated: false;
  photonCountCalculated: false;
  detectorBandwidthModeled: false;
}
```

## SensorStationaryRateExposureIntegration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorStationaryRateExposureIntegration =
  | SensorEqeExposureIntegration
  | SensorResponsivityExposureIntegration;
```
