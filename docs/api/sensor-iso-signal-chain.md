# sensor/iso-signal-chain.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION =
  "0.1.0" as const
```

## GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## GenericIsoCaptureModeSignalChainBinding

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericIsoCaptureModeSignalChainBinding {
  captureModeId: string;
  standardRegimeBands:
    readonly GenericIsoStandardRegimeBand[];
  expandedRegimeBindings:
    readonly GenericIsoExpandedRegimeBinding[];
  evidence:
    readonly EvidenceProvenance[];
}
```

## GenericIsoExpandedRegimeBinding

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericIsoExpandedRegimeBinding {
  expandedSettingId: string;
  readoutRegimeId: string;
}
```

## GenericIsoSignalChainPreset

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type GenericIsoSignalChainPreset =
  | "good"
  | "better"
  | "best";
```

## GenericIsoSignalChainPresetCatalog

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericIsoSignalChainPresetCatalog {
  schemaVersion:
    typeof GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION;
  catalogId: string;
  catalogVersion: string;
  entries: readonly {
    preset:
      GenericIsoSignalChainPreset;
    signalChainProfileId:
      string;
    evidence:
      readonly EvidenceProvenance[];
  }[];
  performanceOrderingClaimed:
    false;
  realCameraRankingClaimed:
    false;
}
```

## GenericIsoSignalChainProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericIsoSignalChainProfile {
  schemaVersion:
    typeof GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  isoCapabilityProfileId: string;
  readoutProfileId: string;
  behaviorMeaning:
    "iso-state-selects-explicit-readout-regime-not-noise-equation";
  captureModeBindings:
    readonly GenericIsoCaptureModeSignalChainBinding[];
  photonShotNoiseOwnedUpstream:
    true;
  processedImageBehaviorIncluded:
    false;
  fixedPatternNoiseModeled:
    false;
  lowSignalColorDegradationModeled:
    false;
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## GenericIsoStandardRegimeBand

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericIsoStandardRegimeBand {
  minimumExposureIndex: number;
  maximumExposureIndex: number;
  readoutRegimeId: string;
}
```

## parseGenericIsoSignalChainPresetCatalog

Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
missing required fields and inconsistent scientific data are rejected.

Generic tier labels in the catalogue do not calibrate or rank real cameras.

```ts
export function parseGenericIsoSignalChainPresetCatalog(
  value: unknown
): GenericIsoSignalChainPresetCatalog;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseGenericIsoSignalChainProfile

Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
missing required fields and inconsistent scientific data are rejected.

The profile binds each ISO and capture-mode state to an explicit readout regime, whose gain,
read noise and clipping are declared separately.

```ts
export function parseGenericIsoSignalChainProfile(
  value: unknown
): GenericIsoSignalChainProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedGenericIsoSignalChain

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedGenericIsoSignalChain {
  profileId: string;
  profileVersion: string;
  scientificStatus:
    "approximation";
  captureModeId: string;
  iso:
    ResolvedIsoCapability;
  readout:
    ResolvedSensorReadoutRegime;
  regimeSelectionReason:
    | "standard-exposure-index-band"
    | "expanded-setting-binding";
  capturedPhotonExpectationModified:
    false;
  photonShotNoiseStatisticsModified:
    false;
  sensorGeometryModified: false;
  processedImageBehaviorApplied:
    false;
  fixedPatternNoiseApplied:
    false;
  lowSignalColorDegradationApplied:
    false;
  isoUsedAsDirectNoiseEquation:
    false;
  exactCommercialCameraBehaviorClaimed:
    false;
}
```

## resolveGenericIsoSignalChain

Picks the explicit readout regime bound to the resolved ISO and capture-mode state. Gain and noise
are never derived from the ISO number.

```ts
export function resolveGenericIsoSignalChain(
  input:
    ResolveGenericIsoSignalChainInput
): ResolvedGenericIsoSignalChain;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveGenericIsoSignalChainInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveGenericIsoSignalChainInput {
  profile:
    GenericIsoSignalChainProfile;
  isoCapability:
    IsoCapabilityProfile;
  requestedIsoSetting:
    RequestedIsoSetting;
  captureModeId: string;
  readoutProfile:
    SensorReadoutConversionProfile;
}
```

## resolveGenericIsoSignalChainPreset

Picks a generic preset from the catalogue and returns the signal-chain profile it uses. It makes
no claim of manufacturer calibration.

Generic tier labels do not calibrate or rank real cameras.

```ts
export function resolveGenericIsoSignalChainPreset(
  input: {
    catalog:
      GenericIsoSignalChainPresetCatalog;
    preset:
      GenericIsoSignalChainPreset;
  }
): {
  preset:
    GenericIsoSignalChainPreset;
  signalChainProfileId:
    string;
  performanceOrderingClaimed:
    false;
  realCameraRankingClaimed:
    false;
};
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
