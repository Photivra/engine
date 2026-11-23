# equipment/generic-tier-exposure.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## GenericEquipmentTier

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type GenericEquipmentTier = "consumer" | "prosumer" | "professional";
```

## GenericTierPresetVersion

The exact versions of the generic tier presets (no "latest" alias). 2.1.0 (2.14, round 5) adds the third-stop ISO
settings; 2.0.0 is kept, whole-stop, so saved selections and records of it still resolve to exactly what they named.

```ts
export type GenericTierPresetVersion = "2.0.0" | "2.1.0";
```

## GenericVersionedAsset

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericVersionedAsset<T> { assetId: string; assetVersion: string; profile: T }
```
