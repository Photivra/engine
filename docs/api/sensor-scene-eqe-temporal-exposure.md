# sensor/scene-eqe-temporal-exposure.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSceneSensorEqeTemporalExposure

Runs declared scene radiance through paraxial optics and the instantaneous EQE
response at every exact local shutter midpoint time. Light is never averaged
before the response checks. No projection, renderer, PSF, charge, noise or
production stage runs.

```ts
export function calculateSceneSensorEqeTemporalExposure(
  input: CalculateSceneSensorEqeTemporalExposureInput
): CalculationResult<SceneSensorEqeTemporalExposure>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSceneSensorEqeTemporalExposureInput

Input: declared physical scene radiance at every spatial position, wavelength and local shutter midpoint time.

```ts
export interface CalculateSceneSensorEqeTemporalExposureInput {
  /** One destination site, its response and one local shutter event. No constant-rate declaration is needed. */
  sensor: Omit<CalculateSensorEqeTemporalExposureInput, "samples">;
  sceneBindings: CalculateSceneToSensorIrradianceQuadratureInput["sceneBindings"];
  optics: CalculateSceneToSensorIrradianceQuadratureInput["optics"];
  /** States that scene query times are seconds from the shutter's first opening boundary. */
  timeReference: "first-opening-boundary-phase";
  samples: readonly {
    temporalSampleIndex: number;
    timeSecondsFromOpeningReference: number;
    sceneSamples: CalculateSceneToSensorIrradianceQuadratureInput["samples"];
  }[];
}
```

## SceneSensorEqeTemporalExposure

Result. The optical and sensor results each keep their own approximation labels and evidence.

```ts
export interface SceneSensorEqeTemporalExposure {
  sourcePlane: "sensor-package-incident";
  sourceTargetProjectionVerified: false;
  sceneProviderExecutionVerified: false;
  psfRedistributionApplied: false;
  opticalSamples: readonly {
    temporalSampleIndex: number;
    timeSecondsFromOpeningReference: number;
    optics: ReturnType<typeof calculateSceneToSensorIrradianceQuadrature>;
  }[];
  exposure: ReturnType<typeof calculateSensorEqeTemporalExposure>;
}
```
