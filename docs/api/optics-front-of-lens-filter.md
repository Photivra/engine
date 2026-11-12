# optics/front-of-lens-filter.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ComposedFrontOfLensFilterTransmission

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ComposedFrontOfLensFilterTransmission {
  schemaVersion:
    FrontOfLensFilterProfileSchemaVersion;
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  appliedFilterCount: number;
  components:
    readonly ResolvedFrontOfLensFilterTransmission[];
  combinedLinearTransmissionFactor:
    number;
  combinedAttenuationStops: number;
  scientificStatus:
    FrontOfLensFilterScientificStatus;
  uncertaintyPropagation:
    "not-propagated";
  uncertaintyLimitation: string;
  compositionModel:
    | "independent-multiplicative-unpolarized-transmission-no-inter-filter-reflections"
    | "ordered-linear-stokes-mueller-no-inter-filter-reflections";
  polarizationModeled: boolean;
  incidentPolarization: LinearPolarizationState;
  transmittedPolarization: LinearPolarizationState;
  wavelengthChangingBehaviorModeled:
    false;
  lensTransmissionIncluded: false;
  sensorOpticalStackIncluded: false;
  fieldThroughputIncluded: false;
}
```

## composeFrontOfLensFilterTransmission

Combines several passive front-of-lens filters at one wavelength, in light-path order, and keeps
each filter's identity. Without a polarizer the result is the product of the transmissions. With
one, linear Stokes parameters pass through the Mueller matrices in order.

```ts
export function composeFrontOfLensFilterTransmission(
  input:
    ComposeFrontOfLensFilterTransmissionInput
): ComposedFrontOfLensFilterTransmission;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ComposeFrontOfLensFilterTransmissionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ComposeFrontOfLensFilterTransmissionInput {
  /** Filters in light-path order (scene side first). */
  filters:
    readonly FrontOfLensFilterProfile[];
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  /** Incident scene polarization; omitted means unpolarized. */
  incidentPolarization?: LinearPolarizationState;
}
```

## FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION

Schema that also allows the `linear-polarizer` transmission kind.

```ts
FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION =
  "0.2.0" as const
```

## FrontOfLensFilterProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FrontOfLensFilterProfile {
  schemaVersion:
    FrontOfLensFilterProfileSchemaVersion;
  filterId: string;
  profileVersion: string;
  identityScope:
    "photivra-generic-unbranded";
  position: "front-of-lens";
  scientificStatus:
    FrontOfLensFilterScientificStatus;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  wavelengthRangeNanometers: {
    minimum: number;
    maximum: number;
  };
  transmission:
    FrontOfLensFilterTransmissionModel;
  uncertainty:
    FrontOfLensFilterUncertainty;
  /** True exactly when the transmission kind is `linear-polarizer` (schema 0.2.0). */
  polarizationModeled: boolean;
  wavelengthChangingBehaviorModeled:
    false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## FrontOfLensFilterProfileSchemaVersion

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FrontOfLensFilterProfileSchemaVersion =
  | typeof FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION
  | typeof FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION;
```

## FrontOfLensFilterScientificStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FrontOfLensFilterScientificStatus =
  | "calibrated"
  | "approximation";
```

## FrontOfLensFilterSpectralSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FrontOfLensFilterSpectralSample {
  wavelengthNanometers: number;
  linearTransmissionFactor: number;
}
```

## FrontOfLensFilterTransmissionModel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FrontOfLensFilterTransmissionModel =
  | {
      kind: "neutral-linear-transmission";
      linearTransmissionFactor:
        EvidenceBackedFact<number>;
    }
  | {
      kind: "neutral-optical-density";
      opticalDensityBase10:
        EvidenceBackedFact<number>;
    }
  | {
      kind: "spectral-transmission";
      samples:
        EvidenceBackedFact<
          readonly FrontOfLensFilterSpectralSample[]
        >;
    }
  | {
      /** Schema 0.2.0 only. Neutral (wavelength-independent) within the declared range. */
      kind: "linear-polarizer";
      /** k1: intensity transmittance for light polarized along the transmission axis, (0, 1]. */
      principalTransmittance:
        EvidenceBackedFact<number>;
      /** k1 / k2. Finite and >= 1. Use a large finite ratio for a near-ideal polarizer. */
      extinctionRatio:
        EvidenceBackedFact<number>;
      /** Transmission-axis angle as mounted, degrees counter-clockwise from image +X. */
      transmissionAxisDegrees: number;
    };
```

## FrontOfLensFilterUncertainty

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FrontOfLensFilterUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };
```

## LinearPolarizationState

Partially linearly polarized light: degree P in [0, 1] and polarization angle psi.

```ts
export interface LinearPolarizationState {
  /** Degree of linear polarization P in [0, 1]; 0 is unpolarized. */
  degreeOfLinearPolarization: number;
  /** Electric-field polarization angle, degrees counter-clockwise from image +X. */
  angleDegrees: number;
}
```

## parseFrontOfLensFilterProfile

Parses one generic front-of-lens transmission filter.

Schema 0.1.0 is explicitly unbranded and unpolarized. It models only
passive transmission in front of the lens. It does not cover reflections
between stacked filters, polarization, flare or ghosting, or filters that
change wavelength.

```ts
export function parseFrontOfLensFilterProfile(
  value: unknown
): FrontOfLensFilterProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedFrontOfLensFilterTransmission

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedFrontOfLensFilterTransmission {
  schemaVersion:
    FrontOfLensFilterProfileSchemaVersion;
  filterId: string;
  profileVersion: string;
  identityScope:
    "photivra-generic-unbranded";
  position: "front-of-lens";
  scientificStatus:
    FrontOfLensFilterScientificStatus;
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  transmissionKind:
    FrontOfLensFilterTransmissionModel["kind"];
  /** Intensity transmittance for the declared incident polarization. */
  linearTransmissionFactor: number;
  attenuationStops: number;
  opticalDensityBase10: number;
  polarizationModeled: boolean;
  incidentPolarization: LinearPolarizationState;
  transmittedPolarization: LinearPolarizationState;
  wavelengthChangingBehaviorModeled:
    false;
  lensTransmissionIncluded: false;
  sensorOpticalStackIncluded: false;
  fieldThroughputIncluded: false;
  uncertainty:
    FrontOfLensFilterUncertainty;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## resolveFrontOfLensFilterTransmission

Resolves one passive filter at one wavelength. Non-polarizing filters scale all Stokes
components equally, so their transmission does not depend on the incident polarization.

```ts
export function resolveFrontOfLensFilterTransmission(
  input:
    ResolveFrontOfLensFilterTransmissionInput
): ResolvedFrontOfLensFilterTransmission;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveFrontOfLensFilterTransmissionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveFrontOfLensFilterTransmissionInput {
  profile: FrontOfLensFilterProfile;
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  /** Incident polarization; omitted means unpolarized. */
  incidentPolarization?: LinearPolarizationState;
}
```
