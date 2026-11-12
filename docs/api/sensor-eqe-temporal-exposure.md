# sensor/eqe-temporal-exposure.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorEqeTemporalExposure

Runs the response checks and EQE conversion separately at each declared
midpoint time, then sums rate × time step. This is numerical quadrature. It does
not claim the light is constant or prove convergence. Shared profile and
geometry stop rates from different sites or shutter events being mixed. No
renderer runs here.

```ts
export function calculateSensorEqeTemporalExposure(
  input: CalculateSensorEqeTemporalExposureInput
): CalculationResult<SensorEqeTemporalExposure>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorEqeTemporalExposureInput

Input: shared response, site and shutter settings, plus the light evaluated separately at each time.

```ts
export interface CalculateSensorEqeTemporalExposureInput
  extends Omit<CalculateSensorEqeLocalExposureInput, "irradianceSamples" | "stationarityProfile"> {
  /** One sample for every uniform midpoint time. Array order does not define which time a sample is. */
  samples: readonly {
    temporalSampleIndex: number;
    /** Seconds from the shutter's reference time (the first opening boundary). */
    timeSecondsFromOpeningReference: number;
    /** Irradiance in W/m²/nm at every spatial × spectral node, for this instant. */
    irradianceSamples: CalculateSensorEqeLocalExposureInput["irradianceSamples"];
  }[];
}
```

## SensorEqeTemporalExposure

Expected photo signal with light that varies over time. Kept separate from the constant-rate inputs of the RAW producer.

```ts
export interface SensorEqeTemporalExposure {
  kind: "eqe-temporal-quadrature-expected-counts";
  colorSamplingProfileId: string;
  channelId: string;
  site: { x: number; y: number };
  bindingId: string;
  timeReference: "first-opening-boundary-phase";
  startOffsetSecondsFromOpeningReference: number;
  endOffsetSecondsFromOpeningReference: number;
  localExposureDurationSeconds: number;
  expectedIncidentPhotonCount: number;
  expectedGeneratedElectronCount: number;
  integrationMethod: "uniform-midpoint-rate-quadrature";
  timeStationarityEstablished: false;
  timeVaryingSignalIntegrated: true;
  temporalIntegrationApplied: true;
  upstreamSceneAndOpticsVerified: false;
  accumulatedSignalCompleteness: "photo-signal-only";
  physicalFullWellAssessmentAuthorized: false;
  shotNoiseApplied: false;
  rawCodeValueProduced: false;
  /** Samples in canonical order, each with its time step in seconds and its own evidence. */
  samples: readonly {
    temporalSampleIndex: number;
    timeSecondsFromOpeningReference: number;
    integrationMeasureSeconds: number;
    timeAverageWeight: number;
    stages: ReturnType<typeof calculateSensorEqeLocalRate>;
  }[];
}
```
