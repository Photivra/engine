# schema/scene-radiance-temporal.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createSceneRadianceTemporalSamplingPlan

Plans the times (nodes) at which a scene-radiance provider must report radiance
during one local exposure window. Works with any renderer or provider.

Capture time is a separate field, not the older request field
timeSecondsFromExposureStart. Providers must evaluate radiance at
node.captureTimeSecondsFromReference, measured from the first opening boundary.

```ts
export function createSceneRadianceTemporalSamplingPlan(
  input:
    CreateSceneRadianceTemporalSamplingPlanInput
): SceneRadianceTemporalSamplingPlan;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateSceneRadianceTemporalSamplingPlanInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateSceneRadianceTemporalSamplingPlanInput {
  planId: string;
  timing:
    ResolvedCaptureModeTiming;
  destinationPointNative:
    RasterPoint;
  temporalSampleCount: number;
  query:
    SceneRadianceTemporalQuery;
}
```

## ReducedSceneRadianceTemporalExposure

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ReducedSceneRadianceTemporalExposure {
  version:
    typeof SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION;
  planId: string;
  timeReference:
    "first-opening-boundary-phase";
  localExposureWindow:
    SceneRadianceTemporalSamplingPlan["localExposureWindow"];
  temporalSampleCount: number;
  quadratureScheme:
    "uniform-midpoint";
  providerProfileId: string;
  sceneId: string;
  wavelengthNanometers: number;
  wavelengthBasis:
    SceneRadianceEvaluationRequest["wavelengthBasis"];
  quantity:
    "outgoing-spectral-radiance";
  averageSpectralRadianceWattsPerSquareMeterSteradianNanometer:
    number;
  integratedSpectralRadianceWattSecondsPerSquareMeterSteradianNanometer:
    number;
  nodes: readonly {
    nodeId: string;
    captureTimeSecondsFromReference:
      number;
    normalizedTimeWeight: number;
    timeMeasureSeconds: number;
    spectralRadianceWattsPerSquareMeterSteradianNanometer:
      number;
    evidence:
      SceneRadianceEvaluationResult["evidence"];
    uncertainty:
      SceneRadianceEvaluationResult["uncertainty"];
  }[];
  scientificStatus: "approximation";
  uncertaintyPropagation:
    "not-propagated";
  uncertaintyLimitation: string;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
}
```

## reduceSceneRadianceTemporalSamples

Combines the provider's per-wavelength scene radiance over the local exposure window.

Each sample must match its planned node, time and result identity exactly.
Uncertainty stays per node and is not combined, because no correlation or
independence is assumed.

```ts
export function reduceSceneRadianceTemporalSamples(
  input:
    ReduceSceneRadianceTemporalSamplesInput
): ReducedSceneRadianceTemporalExposure;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ReduceSceneRadianceTemporalSamplesInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ReduceSceneRadianceTemporalSamplesInput {
  plan:
    SceneRadianceTemporalSamplingPlan;
  samples:
    readonly SceneRadianceTemporalEvaluatedSample[];
}
```

## SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION =
  "0.1.0" as const
```

## SceneRadianceTemporalEvaluatedSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneRadianceTemporalEvaluatedSample {
  nodeId: string;
  captureTimeSecondsFromReference:
    number;
  result:
    SceneRadianceEvaluationResult;
}
```

## SceneRadianceTemporalQuery

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneRadianceTemporalQuery {
  providerProfileId: string;
  sceneId: string;
  illuminationProfileId: string;
  materialResponseProfileId: string;
  target:
    SceneRadianceEvaluationRequest["target"];
  wavelengthNanometers: number;
  wavelengthBasis:
    SceneRadianceEvaluationRequest["wavelengthBasis"];
}
```

## SceneRadianceTemporalSamplingNode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneRadianceTemporalSamplingNode {
  nodeId: string;
  expectedResultSampleId: string;
  temporalSampleIndex: number;
  localExposurePhase: number;
  captureTimeSecondsFromReference:
    number;
  normalizedTimeWeight: number;
  timeMeasureSeconds: number;
}
```

## SceneRadianceTemporalSamplingPlan

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneRadianceTemporalSamplingPlan {
  version:
    typeof SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION;
  planId: string;
  timeReference:
    "first-opening-boundary-phase";
  timingProfileIdentity: {
    profileId: string;
    profileVersion: string;
    captureModeId: string;
  };
  destinationPointNative:
    RasterPoint;
  localExposureWindow: {
    startSecondsFromCaptureReference:
      number;
    endSecondsFromCaptureReference:
      number;
    durationSeconds: number;
  };
  temporalSampleCount: number;
  quadratureScheme:
    "uniform-midpoint";
  query:
    SceneRadianceTemporalQuery;
  nodes:
    readonly SceneRadianceTemporalSamplingNode[];
  providerMustEvaluateAtNodeCaptureTime:
    true;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
}
```
