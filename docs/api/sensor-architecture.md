# sensor/architecture.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## parseSensorArchitectureProfile

Parses untrusted descriptive sensor-architecture metadata.

Schema 0.2.0 is still accepted and returns a 0.2.0 profile with the same
meaning. Schema 0.3.0 adds an optional, evidence-backed technology family
(CMOS or CCD). Leave out facts you do not know rather than guessing them.

The parser checks structure, allowed values and per-field evidence only. It
does not check that a cited real-world claim is true, and the technology
family does not switch on any hidden physics.

```ts
export function parseSensorArchitectureProfile(
  value: unknown
): SensorArchitectureProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION = "0.3.0" as const
```

## SensorArchitectureFactProvenance

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorArchitectureFactProvenance = EvidenceProvenance;
```

## SensorArchitectureProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorArchitectureProfile =
  | SensorArchitectureProfileV0_2
  | SensorArchitectureProfileV0_3;
```

## SensorArchitectureProfileV0_2

Legacy sensor-architecture schema.

Schema 0.2.0 is still accepted and kept exactly as parsed. It has no
technologyFamily field; leaving it out means "unknown, not stated".

```ts
export interface SensorArchitectureProfileV0_2
  extends SensorArchitectureProfileBase {
  schemaVersion: typeof LEGACY_SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION;
  technologyFamily?: never;
}
```

## SensorArchitectureProfileV0_3

Current descriptive metadata about the sensor hardware and its capabilities.

An omitted property means "unknown, not stated". These fields do not switch
on scientific effects. No architecture value changes noise, dynamic range,
field of view, crop factor, exposure, readout timing or sampling unless a
separate downstream model explicitly uses that fact.

```ts
export interface SensorArchitectureProfileV0_3
  extends SensorArchitectureProfileBase {
  schemaVersion: typeof SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION;
  /** Broad detector technology (for example CMOS or CCD) only. It never changes performance. */
  technologyFamily?: SourcedSensorArchitectureFact<SensorTechnologyFamily>;
}
```

## SensorArchitectureReuseStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorArchitectureReuseStatus = EvidenceReuseStatus;
```

## SensorArchitectureSourceKind

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorArchitectureSourceKind = EvidenceSourceOrigin;
```

## SensorColorSamplingFamily

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorColorSamplingFamily =
  | "bayer"
  | "quad-bayer"
  | "monochrome"
  | "custom-rgb-mosaic"
  | "layered-color";
```

## SensorIlluminationArchitecture

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorIlluminationArchitecture = "fsi" | "bsi";
```

## SensorIntegrationArchitecture

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorIntegrationArchitecture =
  | "monolithic"
  | "partially-stacked"
  | "stacked";
```

## SensorReadoutArchitecture

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorReadoutArchitecture = "rolling" | "global";
```

## SensorTechnologyFamily

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorTechnologyFamily = "cmos" | "ccd";
```

## SourcedSensorArchitectureFact

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SourcedSensorArchitectureFact<T> = EvidenceBackedFact<T>;
```
