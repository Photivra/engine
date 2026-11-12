# equipment/exposure-capabilities.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## FocalLengthFNumberSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FocalLengthFNumberSample {
  focalLengthMm: number;
  fNumber: number;
}
```

## GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION =
  "0.1.0" as const
```

## GenericBodyExposureCapabilityProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericBodyExposureCapabilityProfile {
  schemaVersion:
    typeof GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  evidence: readonly EvidenceProvenance[];
  shutter: {
    durationSecondsRange:
      EvidenceBackedFact<
        NumericCapabilityRange
      >;
    settingGrid: NumericSettingGrid;
  };
  iso: {
    range:
      EvidenceBackedFact<
        NumericCapabilityRange
      >;
    settingGrid: NumericSettingGrid;
    autoIso:
      EvidenceBackedFact<
        GenericCapabilityAvailability
      >;
  };
}
```

## GenericCapabilityAvailability

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type GenericCapabilityAvailability =
  | "supported"
  | "unsupported"
  | "unknown";
```

## GenericLensExposureCapabilityProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericLensExposureCapabilityProfile {
  schemaVersion:
    typeof GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  evidence: readonly EvidenceProvenance[];
  focalLengthMmRange:
    EvidenceBackedFact<
      NumericCapabilityRange
    >;
  aperture: {
    widestAvailableFNumber:
      WidestAvailableFNumberCapability;
    narrowestAvailableFNumber:
      EvidenceBackedFact<number>;
    settingGrid: NumericSettingGrid;
  };
}
```

## NumericCapabilityRange

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NumericCapabilityRange {
  minimum: number;
  maximum: number;
}
```

## NumericSettingGrid

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type NumericSettingGrid =
  | {
      kind: "continuous-within-range";
    }
  | {
      kind: "discrete-values";
      values:
        EvidenceBackedFact<
          readonly number[]
        >;
    };
```

## parseGenericBodyExposureCapabilityProfile

Parses a generic Photivra body exposure-capability profile.

This is capability metadata only. ISO values say nothing about how noise or
gain is implemented. Shutter-duration capability does not imply a
particular shutter mechanism or sensor-readout schedule.

```ts
export function parseGenericBodyExposureCapabilityProfile(
  value: unknown
): GenericBodyExposureCapabilityProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseGenericLensExposureCapabilityProfile

Parses a generic Photivra lens exposure-capability profile.

"Widest" means the smallest available f-number. This avoids the ambiguous
phrases "minimum aperture" and "maximum aperture".

```ts
export function parseGenericLensExposureCapabilityProfile(
  value: unknown
): GenericLensExposureCapabilityProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedGenericEquipmentExposureCapabilities

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedGenericEquipmentExposureCapabilities {
  schemaVersion:
    typeof GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION;
  scientificStatus: "approximation";
  bodyProfile: {
    profileId: string;
    profileVersion: string;
  };
  lensProfile: {
    profileId: string;
    profileVersion: string;
  };
  selectedFocalLengthMm: number;
  aperture: {
    widestAvailableFNumber: number;
    narrowestAvailableFNumber: number;
    settingGrid:
      ResolvedNumericSettingGrid;
  };
  shutter: {
    minimumSeconds: number;
    maximumSeconds: number;
    settingGrid:
      ResolvedNumericSettingGrid;
  };
  iso: {
    minimum: number;
    maximum: number;
    settingGrid:
      ResolvedNumericSettingGrid;
    autoIsoAvailability:
      GenericCapabilityAvailability;
    /**
     * Optional bounds that apply only to Auto ISO. Manual ISO still uses the
     * minimum, the maximum and the complete standard setting grid.
     */
    autoIsoMinimum?: number;
    autoIsoMaximum?: number;
  };
  sourceProfilesMutated: false;
  exactNamedEquipmentEmulationClaimed:
    false;
}
```

## ResolvedNumericSettingGrid

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ResolvedNumericSettingGrid =
  | {
      kind: "continuous-within-range";
    }
  | {
      kind: "discrete-values";
      values: readonly number[];
    };
```

## resolveGenericEquipmentExposureCapabilities

Resolves the exposure-relevant capability subset for one generic body+lens
combination at one selected focal length.

The source profiles are not changed. This resolver does not choose exposure
settings. It only provides the range of available settings (the capability
envelope) that the exposure-mode resolvers use.

```ts
export function resolveGenericEquipmentExposureCapabilities(
  input:
    ResolveGenericEquipmentExposureCapabilitiesInput
): ResolvedGenericEquipmentExposureCapabilities;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveGenericEquipmentExposureCapabilitiesInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveGenericEquipmentExposureCapabilitiesInput {
  bodyProfile:
    GenericBodyExposureCapabilityProfile;
  lensProfile:
    GenericLensExposureCapabilityProfile;
  selectedFocalLengthMm: number;
}
```

## WidestAvailableFNumberCapability

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type WidestAvailableFNumberCapability =
  | {
      kind: "constant";
      fNumber:
        EvidenceBackedFact<number>;
    }
  | {
      kind:
        "piecewise-linear-by-focal-length";
      samples:
        EvidenceBackedFact<
          readonly FocalLengthFNumberSample[]
        >;
    };
```
