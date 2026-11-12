# optics/scene-to-sensor-quadrature.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSceneToSensorIrradianceQuadrature

Runs the existing paraxial optical bridge at every requested node.

Before it returns physical W/m²/nm samples, it checks that node identities,
grid coverage and provider bindings match exactly. Image coordinates come
from the spatial plan, so a caller cannot attach a field-throughput result
computed at a different point.

```ts
export function calculateSceneToSensorIrradianceQuadrature(
  input: CalculateSceneToSensorIrradianceQuadratureInput
): CalculationResult<SceneToSensorIrradianceQuadrature>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSceneToSensorIrradianceQuadratureInput

Static point-sample bridge. PSF blur and motion over time are handled elsewhere.

```ts
export interface CalculateSceneToSensorIrradianceQuadratureInput {
  spatialQuadrature: ReduceSensorSpatioSpectralIrradianceInput["spatialQuadrature"];
  spectralQuadrature: ReduceSensorSpatioSpectralIrradianceInput["spectralQuadrature"];
  /** Provider, illumination and material identities with their evidence. Parsed before use. */
  sceneBindings: Omit<ValidateSceneRadianceEvaluationBindingsInput, "request" | "result">;
  /** One declared lens/focus/filter state shared by every node. */
  optics: Omit<CalculateSceneRadianceToSensorIrradianceInput,
    "sceneRadianceRequest" | "sceneRadianceResult" | "imagePointMm" | "fieldThroughput">;
  /** One non-negative instant shared by all queries. This is not an integral over the exposure. */
  timeSecondsFromExposureStart: number;
  /** Every combination of the grid axes, with a unique scene sampleId per node. */
  samples: readonly SceneSensorQuadratureSample[];
}
```

## SceneSensorQuadratureSample

One declared scene query and its result, for one exact spatial and wavelength node before the
anti-aliasing (AA) filter.

```ts
export interface SceneSensorQuadratureSample {
  node: SensorSpatioSpectralNodeIdentity;
  sceneRadianceRequest: CalculateSceneRadianceToSensorIrradianceInput["sceneRadianceRequest"];
  sceneRadianceResult: CalculateSceneRadianceToSensorIrradianceInput["sceneRadianceResult"];
  fieldThroughput: CalculateSceneRadianceToSensorIrradianceInput["fieldThroughput"];
}
```

## SceneToSensorIrradianceQuadrature

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneToSensorIrradianceQuadrature {
  sourcePlane: "sensor-package-incident";
  outputMeaning: "pre-sensor-stack-pre-aa-irradiance-quadrature";
  sourceTargetProjectionVerified: false;
  sceneProviderExecutionVerified: false;
  psfRedistributionApplied: false;
  temporalIntegrationApplied: false;
  irradianceSamples: ReduceSensorSpatioSpectralIrradianceInput["sampleValues"];
  reduction: ReturnType<typeof reduceSensorSpatioSpectralIrradiance>;
  samples: readonly {
    node: SensorSpatioSpectralNodeIdentity;
    /** Physical source coordinate, in mm, before the anti-aliasing filter spreads it. */
    preAntiAliasingSourcePointMm: { x: number; y: number };
    /** The provider's declared target and time. This is not a verified ray intersection. */
    request: SceneSensorQuadratureSample["sceneRadianceRequest"];
    result: SceneSensorQuadratureSample["sceneRadianceResult"];
    bindings: ReturnType<typeof validateSceneRadianceEvaluationBindings>;
    optics: ReturnType<typeof calculateSceneRadianceToSensorIrradiance>;
  }[];
}
```
