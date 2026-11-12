# equipment/iso-capabilities.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## bindIsoCapabilityToExposureCapabilities

Combines the detailed ISO/EI capability profile with the numeric capability
envelope that the exposure-mode resolvers use.

The existing equipment capability must match the profile's global standard
ISO range and grid exactly. A capture-mode policy backed by evidence may
narrow the standard manual range for that mode. Auto ISO may be narrower
still. Expanded settings (such as L and H) stay outside the resolvers'
ordinary numeric ISO grid; use resolveIsoCapability() for them.

```ts
export function bindIsoCapabilityToExposureCapabilities(
  input:
    BindIsoCapabilityToExposureCapabilitiesInput
): BoundIsoExposureCapabilities;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## BindIsoCapabilityToExposureCapabilitiesInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BindIsoCapabilityToExposureCapabilitiesInput {
  isoCapabilityProfile:
    IsoCapabilityProfile;
  equipmentCapabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  captureModeId?: string;
}
```

## BoundIsoExposureCapabilities

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BoundIsoExposureCapabilities {
  isoCapabilityProfileId: string;
  isoCapabilityProfileVersion: string;
  captureModeId: string | null;
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  expandedSettingsExcludedFromNumericExposureGrid:
    true;
  physicalGainInferred: false;
  readNoiseInferred: false;
}
```

## ISO_CAPABILITY_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
ISO_CAPABILITY_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## IsoAutoIsoCapability

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type IsoAutoIsoCapability =
  | {
      availability: "supported";
      standardExposureIndexRange:
        IsoExposureIndexRange;
      evidence: readonly EvidenceProvenance[];
    }
  | {
      availability:
        | "unsupported"
        | "unknown";
      evidence: readonly EvidenceProvenance[];
    };
```

## IsoCapabilityAvailability

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type IsoCapabilityAvailability =
  | "supported"
  | "unsupported"
  | "unknown";
```

## IsoCapabilityProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IsoCapabilityProfile {
  schemaVersion:
    typeof ISO_CAPABILITY_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  capabilityMeaning:
    "reported-exposure-index-capability-not-physical-gain";
  standard: {
    exposureIndexRange:
      IsoExposureIndexRange;
    settingGrid:
      IsoStandardSettingGrid;
  };
  expandedSettings:
    readonly IsoExpandedSetting[];
  autoIso:
    IsoAutoIsoCapability;
  captureModePolicies:
    readonly IsoCaptureModePolicy[];
  evidence:
    readonly EvidenceProvenance[];
}
```

## IsoCaptureModePolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IsoCaptureModePolicy {
  captureModeId: string;
  standardExposureIndexRange:
    IsoExposureIndexRange;
  expandedSettingIds:
    readonly string[];
  autoIso:
    IsoAutoIsoCapability;
  evidence: readonly EvidenceProvenance[];
}
```

## IsoExpandedSetting

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IsoExpandedSetting {
  settingId: string;
  label: string;
  direction: "low" | "high";
  exposureIndexEquivalent: number;
  autoIsoEligible: boolean;
  evidence: readonly EvidenceProvenance[];
}
```

## IsoExposureIndexRange

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IsoExposureIndexRange {
  minimum: number;
  maximum: number;
}
```

## IsoStandardSettingGrid

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type IsoStandardSettingGrid =
  | {
      kind: "continuous-within-range";
    }
  | {
      kind: "discrete-values";
      values: readonly number[];
    };
```

## parseIsoCapabilityProfile

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

ISO is an exposure-index (EI) control setting. It does not create photons and says nothing about
read noise. Standard and expanded settings, limits per capture mode, and whether Auto ISO is
available are all stated explicitly. If availability is unknown, automatic control is not allowed.

```ts
export function parseIsoCapabilityProfile(
  value: unknown
): IsoCapabilityProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## RequestedIsoSetting

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RequestedIsoSetting =
  | {
      kind: "standard";
      exposureIndex: number;
    }
  | {
      kind: "expanded";
      settingId: string;
    };
```

## ResolvedIsoCapability

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedIsoCapability {
  profileId: string;
  profileVersion: string;
  captureModeId: string | null;
  setting:
    | {
        kind: "standard";
        exposureIndex: number;
      }
    | {
        kind: "expanded";
        settingId: string;
        label: string;
        direction:
          "low" | "high";
        exposureIndexEquivalent:
          number;
      };
  reportedExposureIndex: number;
  expandedSetting: boolean;
  autoIsoEligible:
    boolean;
  standardExposureIndexRange:
    IsoExposureIndexRange;
  standardSettingGrid:
    IsoStandardSettingGrid;
  autoIso:
    IsoAutoIsoCapability;
  capturedPhotonExpectationModified:
    false;
  photonShotNoiseStatisticsModified:
    false;
  physicalGainInferred:
    false;
  conversionGainInferred:
    false;
  readNoiseInferred: false;
  saturationInferred: false;
  exactCommercialCameraBehaviorClaimed:
    false;
}
```

## resolveIsoCapability

Resolves one standard, expanded or Auto ISO request against what the profile and capture mode
declare as available. Reports "unavailable" or "unknown" explicitly.

ISO is an exposure-index (EI) control setting. It does not create photons and says nothing about
read noise. Standard and expanded settings, limits per capture mode, and whether Auto ISO is
available are all stated explicitly. If availability is unknown, automatic control is not allowed.

```ts
export function resolveIsoCapability(
  input:
    ResolveIsoCapabilityInput
): ResolvedIsoCapability;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveIsoCapabilityInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveIsoCapabilityInput {
  profile:
    IsoCapabilityProfile;
  setting:
    RequestedIsoSetting;
  captureModeId?: string;
}
```
