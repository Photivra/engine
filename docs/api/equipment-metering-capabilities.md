# equipment/metering-capabilities.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## assessExposureMeteringProfileCompatibility

Checks whether one engine metering profile is selectable on a generic body.

The metering profile stays the single source of its calibration and target
policy. They are never copied into equipment capability metadata.

```ts
export function assessExposureMeteringProfileCompatibility(
  input:
    AssessExposureMeteringProfileCompatibilityInput
): MeteringCapabilityCompatibilityAssessment;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## AssessExposureMeteringProfileCompatibilityInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AssessExposureMeteringProfileCompatibilityInput {
  bodyCapabilities:
    GenericBodyMeteringCapabilityProfile;
  meteringProfile:
    ExposureMeteringProfile;
}
```

## GENERIC_BODY_METERING_CAPABILITY_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
GENERIC_BODY_METERING_CAPABILITY_SCHEMA_VERSION =
  "0.1.0" as const
```

## GenericBodyMeteringCapabilityProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericBodyMeteringCapabilityProfile {
  schemaVersion:
    typeof GENERIC_BODY_METERING_CAPABILITY_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  evidence: readonly EvidenceProvenance[];
  supportedMeteringProfiles:
    readonly GenericSupportedMeteringProfile[];
  spotFocusPointLinkage: {
    availability: GenericCapabilityAvailability;
    evidence: readonly EvidenceProvenance[];
  };
}
```

## GenericSupportedMeteringProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericSupportedMeteringProfile {
  meteringProfileId: string;
  policyKind: ExposureMeteringPolicy["kind"];
  evidence: readonly EvidenceProvenance[];
}
```

## MeteringCapabilityCompatibilityAssessment

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface MeteringCapabilityCompatibilityAssessment {
  schemaVersion:
    typeof GENERIC_BODY_METERING_CAPABILITY_SCHEMA_VERSION;
  status: "compatible" | "blocked";
  bodyProfile: {
    profileId: string;
    profileVersion: string;
  };
  meteringProfile: {
    profileId: string;
    policyKind: ExposureMeteringPolicy["kind"];
  };
  targetPolicyOwnership: "metering-profile";
  targetCalibrationDuplicatedInEquipmentProfile: false;
  spotFocusPointLinkageAvailability:
    GenericCapabilityAvailability;
  blockers:
    readonly MeteringCapabilityCompatibilityBlocker[];
}
```

## MeteringCapabilityCompatibilityBlocker

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type MeteringCapabilityCompatibilityBlocker =
  | "metering-profile-unsupported"
  | "metering-policy-mismatch";
```

## parseGenericBodyMeteringCapabilityProfile

Parses generic body metering capability metadata.

This profile declares which of the engine's metering profiles and modes a
generic body can select. It deliberately does not copy target or
calibration values from those metering profiles.

```ts
export function parseGenericBodyMeteringCapabilityProfile(
  value: unknown
): GenericBodyMeteringCapabilityProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
