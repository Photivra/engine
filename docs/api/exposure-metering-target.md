# exposure/metering-target.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createExposureMeterTargetFromMeteringResult

Freezes one metering result into a stable relative exposure target, for
camera-control logic to use.

The target copies the meter snapshot by value. Later changes to the scene or
light do not change it. This is what the engine provides for AE lock
(auto-exposure lock).

```ts
export function createExposureMeterTargetFromMeteringResult(
  input:
    CreateExposureMeterTargetInput
): ExposureMeterTarget;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateExposureMeterTargetInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateExposureMeterTargetInput {
  targetId: string;
  meterResult:
    ExposureMeterTargetSourceResult;
}
```

## EXPOSURE_METER_TARGET_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
EXPOSURE_METER_TARGET_SCHEMA_VERSION =
  "0.1.0" as const
```

## ExposureMeterSnapshotIdentity

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExposureMeterSnapshotIdentity {
  sourceKind:
    ExposureMeterTargetSourceKind;
  measurementId: string;
  sceneStateId: string;
  meteringProfileId: string;
}
```

## ExposureMeterTarget

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureMeterTarget =
  | (ExposureMeterTargetBase & {
      status: "resolved";
      baseRequiredExposureScaleToTarget:
        number;
      baseExposureOffsetStopsToTarget:
        number;
      requiredExposureScaleToTarget:
        number;
      exposureOffsetStopsToTarget:
        number;
    })
  | (ExposureMeterTargetBase & {
      status: "no-signal";
      baseRequiredExposureScaleResolved:
        false;
      baseExposureOffsetStopsResolved:
        false;
      requiredExposureScaleResolved:
        false;
      exposureOffsetStopsResolved:
        false;
    });
```

## ExposureMeterTargetSourceKind

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureMeterTargetSourceKind =
  | "spatial-metering-result"
  | "temporal-metering-result";
```

## ExposureMeterTargetSourceResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureMeterTargetSourceResult =
  | ExposureMeteringResult
  | SceneRadianceTemporalExposureMeteringResult;
```

## setExposureCompensationOnMeterTarget

Sets an absolute exposure-compensation value on a frozen meter target.

Compensation is always worked out again from the base target without
compensation, so repeated UI updates cannot build up floating-point or
control drift. Positive compensation asks for more exposure.

```ts
export function setExposureCompensationOnMeterTarget(
  input:
    SetExposureCompensationOnMeterTargetInput
): ExposureMeterTarget;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SetExposureCompensationOnMeterTargetInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SetExposureCompensationOnMeterTargetInput {
  targetId: string;
  baseTarget: ExposureMeterTarget;
  exposureCompensationStops: number;
}
```
