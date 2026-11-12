# exposure/metering-temporal.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## meterSceneRadianceTemporalExposure

Meters a declared weighted time average of relative pre-exposure samples
derived from scene radiance.

Each time sample must already be bound to one temporal illumination profile
and one capture time, measured from the first opening-boundary phase. Each
time sample is metered spatially first, with the same declared profile. The
resulting single values are then combined linearly using normalized time
weights that the caller declares.

```ts
export function meterSceneRadianceTemporalExposure(
  input:
    MeterSceneRadianceTemporalExposureInput
): CalculationResult<
  SceneRadianceTemporalExposureMeteringResult
>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## MeterSceneRadianceTemporalExposureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface MeterSceneRadianceTemporalExposureInput {
  temporalMeasurementId: string;
  profile: ExposureMeteringProfile;
  policy: {
    kind: "weighted-time-average";
    timeReference:
      "first-opening-boundary-phase";
  };
  temporalSamples:
    readonly SceneRadianceTemporalMeteringSample[];
}
```

## SceneRadianceTemporalExposureMeteringResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneRadianceTemporalExposureMeteringResult =
  | (SceneRadianceTemporalExposureMeteringResultBase & {
      status: "resolved";
      requiredExposureScaleToTarget:
        number;
      exposureOffsetStopsToTarget:
        number;
    })
  | (SceneRadianceTemporalExposureMeteringResultBase & {
      status: "no-signal";
      requiredExposureScaleResolved:
        false;
      exposureOffsetStopsResolved:
        false;
    });
```

## SceneRadianceTemporalMeteringSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneRadianceTemporalMeteringSample {
  normalizedTimeWeight: number;
  sampleSet:
    SceneRadianceDerivedExposureMeteringSampleSet;
}
```
