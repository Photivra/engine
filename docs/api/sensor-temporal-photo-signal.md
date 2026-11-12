# sensor/temporal-photo-signal.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createSensorEqeTemporalPhotoSignal

Re-evaluates the physical input at every time, then commits a compact photo
signal. Detailed per-step evidence and uncertainty stay in the returned
exposure diagnostics. This does not show that a renderer or source actually ran.

```ts
export function createSensorEqeTemporalPhotoSignal(input: {
  temporalIntegrationId: string;
  exposure: CalculateSensorEqeTemporalExposureInput;
}): CalculationResult<{ photoSignal: SensorEqeTemporalPhotoSignal; exposure: ReturnType<typeof calculateSensorEqeTemporalExposure> }>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSensorEqeTemporalPhotoSignal

Parses a time-resolved photo signal and recomputes its midpoint sums exactly. Declarations do not prove the source is correct.

```ts
export function parseSensorEqeTemporalPhotoSignal(value: unknown): SensorEqeTemporalPhotoSignal;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SensorEqePhotoExposure

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorEqePhotoExposure = SensorEqeExposureIntegration | SensorEqeTemporalPhotoSignal;
```

## SensorEqeTemporalPhotoSignal

Compact expected photo signal, before any processing. Being tied to a time window is not evidence that the light was constant.

```ts
export interface SensorEqeTemporalPhotoSignal extends Omit<SensorEqeExposureIntegration,
  "kind" | "stationarityProfileId" | "stationarityStatus" | "integrationMethod" | "timeStationarityEstablished" |
  "timeVaryingSignalIntegrated" | "incidentPhotonRatePerSecond" | "expectedGeneratedElectronRatePerSecond" | "componentEvidence"> {
  kind: "eqe-temporal-photo-signal";
  temporalIntegrationId: string;
  stationarityProfileId?: never;
  integrationMethod: "uniform-midpoint-rate-quadrature";
  timeStationarityEstablished: false;
  timeVaryingSignalIntegrated: true;
  temporalSamples: readonly {
    timeSecondsFromOpeningReference: number;
    incidentPhotonRatePerSecond: number;
    expectedGeneratedElectronRatePerSecond: number;
  }[];
  componentEvidence: {
    temporalResponse: readonly EvidenceProvenance[];
    exposureBinding: SensorEqeExposureIntegration["componentEvidence"]["exposureBinding"];
  };
}
```
