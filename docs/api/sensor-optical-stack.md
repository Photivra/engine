# sensor/optical-stack.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AntiAliasingPointSplitComponent

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AntiAliasingPointSplitComponent {
  /**
   * Physical offset on the native sensor from where the light would otherwise
   * land. +X right, +Y down. Units: micrometres.
   */
  offsetMicrometers: {
    x: number;
    y: number;
  };
  /**
   * Normalized weight (dimensionless). A point-splitting kernel only describes
   * where the light goes; the stack's total throughput is not part of it.
   */
  normalizedWeight: number;
}
```

## parseSensorOpticalStackProfile

Parses descriptive sensor optical-stack metadata, plus an optional explicitly
declared anti-aliasing (AA) spatial response.

Leave out unknown facts rather than guessing them. Physical presence of a
component is separate from the net AA response, so the schema can describe
designs that cancel the AA effect without claiming the hardware is missing.

In schema 0.1.0, cover glass, filters and microlenses create no optical
effect. Thickness, refractive index, spectral transmission, angle of
acceptance, focus shift and microlens collection need later explicit models
or calibration.

```ts
export function parseSensorOpticalStackProfile(
  value: unknown
): SensorOpticalStackProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveAntiAliasingSpatialKernel

Resolves only the anti-aliasing (AA) spatial kernel.

This is not the PSF (point-spread function) of the whole optical stack. Cover
glass and filter transmission, refraction, microlens behaviour, dependence on
field position, wavelength or polarization, and total throughput are excluded.

A documented absent AA response gives a single component with weight 1 at zero
offset (no blur). An unknown response (field omitted) or one that is present
but unspecified is rejected.

```ts
export function resolveAntiAliasingSpatialKernel(
  profileInput: SensorOpticalStackProfile
): ResolvedAntiAliasingSpatialKernel;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedAntiAliasingSpatialKernel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedAntiAliasingSpatialKernel {
  profileId: string;
  effectiveResponse:
    | "absent"
    | "normalized-point-splitting-kernel";
  coordinateSystem: "native-sensor-physical";
  components: readonly AntiAliasingPointSplitComponent[];
  normalizedWeightSum: number;
  throughputIncluded: false;
  spectralTransmissionIncluded: false;
  fieldDependenceIncluded: false;
  wavelengthDependenceIncluded: false;
  polarizationDependenceIncluded: false;
  microlensResponseIncluded: false;
  coverFilterStackEffectsIncluded: false;
  wholeSensorOpticalStackResponse: false;
  provenance: {
    profile: readonly EvidenceProvenance[];
    antiAliasingResponse: readonly EvidenceProvenance[];
  };
}
```

## SensorEffectiveAntiAliasingSpatialResponse

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorEffectiveAntiAliasingSpatialResponse =
  | {
      /**
       * Documented absence (or cancellation) of deliberate AA splitting. It does
       * not mean the rest of the sensor stack has no optical effect.
       */
      kind: "absent";
      evidence: readonly EvidenceProvenance[];
    }
  | {
      /**
       * An AA effect is known to exist, but its spatial response is not
       * specified well enough to use.
       */
      kind: "present-unresolved";
      evidence: readonly EvidenceProvenance[];
    }
  | {
      /**
       * Generic approximation: each point is split into weighted copies at
       * offsets in native sensor physical coordinates.
       */
      kind: "normalized-point-splitting-kernel";
      evidence: readonly EvidenceProvenance[];
      coordinateSystem: "native-sensor-physical";
      scope:
        "field-wavelength-polarization-invariant-approximation";
      components: readonly AntiAliasingPointSplitComponent[];
    };
```

## SensorMicrolensDeclaration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorMicrolensDeclaration {
  presence: "present" | "absent";
  evidence: readonly EvidenceProvenance[];
  /**
   * Being present does not establish any model of angle, spectrum, fill factor
   * or collection efficiency.
   */
  opticalEffectModel: "unresolved";
}
```

## SensorOpticalStackComponent

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorOpticalStackComponent {
  componentId: string;
  /**
   * A component can have several roles, because one physical element can do
   * more than one optical or filtering job.
   */
  roles: readonly SensorOpticalStackComponentRole[];
  evidence: readonly EvidenceProvenance[];
}
```

## SensorOpticalStackComponentRole

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorOpticalStackComponentRole =
  | "cover-glass"
  | "infrared-cut"
  | "ultraviolet-cut"
  | "anti-reflection"
  | "birefringent-low-pass"
  | "wave-plate"
  | "other-optical-filter";
```

## SensorOpticalStackProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorOpticalStackProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  evidence: readonly EvidenceProvenance[];
  /**
   * In order from the side light enters towards the sensor.
   *
   * These components are descriptive metadata only. Their presence does not
   * create transmission, focus-shift, aberration or spectral effects.
   */
  orderedComponents?: readonly SensorOpticalStackComponent[];
  /**
   * Omitted means "unknown, not stated".
   *
   * This is separate from which components are present, so a stack can
   * contain low-pass hardware while its net AA effect is absent or cancelled.
   */
  effectiveAntiAliasingSpatialResponse?: SensorEffectiveAntiAliasingSpatialResponse;
  /**
   * Omitted means "unknown, not stated".
   */
  microlens?: SensorMicrolensDeclaration;
}
```
