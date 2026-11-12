# equipment/generic-tier-presets.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createGenericEquipmentTierSelection

The lens tier matches the body tier by default. Mixing tiers is a normal, supported choice.

```ts
export function createGenericEquipmentTierSelection(input: {
  presetVersion: string; bodyTier: GenericEquipmentTier; lensTier?: GenericEquipmentTier;
}): GenericEquipmentTierSelection;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## GENERIC_EQUIPMENT_TIER_PRESET_VERSION

The current preset version (2.14: 2.1.0, third-stop ISO settings).

```ts
GENERIC_EQUIPMENT_TIER_PRESET_VERSION = "2.1.0" as const
```

## GENERIC_EQUIPMENT_TIER_PRESET_VERSIONS

Every exact preset version that resolves, oldest first. A version is never retuned in place (`test/generic-tier-presets.test.ts`).

```ts
GENERIC_EQUIPMENT_TIER_PRESET_VERSIONS = Object.freeze(["2.0.0", "2.1.0"] as const)
```

## GENERIC_EQUIPMENT_TIERS

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
GENERIC_EQUIPMENT_TIERS = Object.freeze(["consumer", "prosumer", "professional"] as const)
```

## GenericEquipmentTierProfileReference

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericEquipmentTierProfileReference { profileId: string; profileVersion: string }
```

## GenericEquipmentTierSelection

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericEquipmentTierSelection {
  schemaVersion: "0.1.0"; presetVersion: GenericTierPresetVersion;
  bodyTier: GenericEquipmentTier; lensTier: GenericEquipmentTier;
  bodyPresetId: string; lensPresetId: string;
  profileReferences: readonly GenericEquipmentTierProfileReference[];
  sensorFormatSelectedByTier: false; scientificTierMultiplierApplied: false;
}
```

## parseGenericEquipmentTierSelection

On a saved simulation, rejects profile versions that are stale, missing or retuned, instead of picking today's defaults.

```ts
export function parseGenericEquipmentTierSelection(value: unknown): GenericEquipmentTierSelection;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedGenericTierLensProfiles

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedGenericTierLensProfiles {
  selection: GenericEquipmentTierSelection;
  state: OpticalProfileState;
  radial: RadialDistortionProfile;
  lateralCa: LateralChromaticAberrationProfile;
  vignetting: IlluminationVignettingProfile;
  breathingProjectionScale: number;
  transmission: SceneToSensorIrradianceProfile;
  pupils: readonly LensComplexPupilProfile[];
  stray: LensStrayLightProfile;
  correction: GenericLensCorrectionProfile;
  scientificStatus: "approximation";
}
```

## resolveGenericEquipmentTierCatalog

Catalog of exact versions. No hidden "latest" alias and no default sensor size.

```ts
export function resolveGenericEquipmentTierCatalog(input: { presetVersion: string }): readonly GenericEquipmentTierPreset[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveGenericEquipmentTierLensProfiles

Ties the finite matched-reference optical data to one exact generic selected state. Never extrapolates.

```ts
export function resolveGenericEquipmentTierLensProfiles(input: { selection: GenericEquipmentTierSelection; state: OpticalProfileState }): ResolvedGenericTierLensProfiles;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
