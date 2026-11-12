# sensor/photon-energy.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AirRefractiveIndexConditionPolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type AirRefractiveIndexConditionPolicy =
  | {
      kind: "exact-match-required";
    }
  | {
      kind: "assume-compatible";
      limitation: string;
      evidence: readonly EvidenceProvenance[];
    };
```

## AirRefractiveIndexReferenceConditions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AirRefractiveIndexReferenceConditions {
  temperatureC: number;
  pressurePascal: number;
  relativeHumidityFraction?: number;
  carbonDioxideMoleFraction?: number;
}
```

## calculatePhotonEnergyFromWavelength

Converts a vacuum wavelength, or an air wavelength with its stated atmosphere, into optical
frequency and photon energy using the exact SI constants h and c.

An air wavelength needs a sourced phase refractive index for that exact wavelength and matching
atmosphere; λ_vacuum = n·λ_air. The index's uncertainty is kept but not automatically carried
through to the photon energy.

```ts
export function calculatePhotonEnergyFromWavelength(
  input:
    CalculatePhotonEnergyFromWavelengthInput
): CalculationResult<PhotonEnergyFromWavelength>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculatePhotonEnergyFromWavelengthInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculatePhotonEnergyFromWavelengthInput {
  wavelengthNanometers: number;
  wavelengthBasis:
    SpectralWavelengthBasis;
  airPhaseRefractiveIndex?:
    SourcedAirPhaseRefractiveIndex;
  airOperatingConditions?:
    AirRefractiveIndexReferenceConditions;
  airConditionPolicy?:
    AirRefractiveIndexConditionPolicy;
}
```

## parseSourcedAirPhaseRefractiveIndex

Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
missing required fields and inconsistent scientific data are rejected.

The index is the phase refractive index n of air at one exact wavelength, from a cited source, for
stated atmospheric conditions. It converts air to vacuum wavelength: λ_vacuum = n·λ_air.

```ts
export function parseSourcedAirPhaseRefractiveIndex(
  value: unknown
): SourcedAirPhaseRefractiveIndex;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PhotonEnergyFromWavelength

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PhotonEnergyFromWavelength {
  inputWavelengthNanometers: number;
  inputWavelengthBasis:
    Exclude<SpectralWavelengthBasis, "unspecified">;
  vacuumWavelengthNanometers: number;
  frequencyHertz: number;
  photonEnergyJoules: number;
  wavelengthConversion:
    | "vacuum-identity"
    | "air-to-vacuum-via-phase-refractive-index";
  exactSiConstants: {
    planckConstantJouleSeconds:
      6.62607015e-34;
    speedOfLightMetersPerSecond:
      299792458;
  };
  phaseRefractiveIndexUsed?: number;
  airRefractiveIndexScientificStatus?:
    SensorSpectralResponseScientificStatus;
  airRefractiveIndexUncertainty?:
    SensorSpectralResponseUncertainty;
  airRefractiveIndexReferenceConditions?:
    AirRefractiveIndexReferenceConditions;
  airRefractiveIndexEvidence?:
    readonly EvidenceProvenance[];
  airOperatingConditions?:
    AirRefractiveIndexReferenceConditions;
  airConditionPolicy?:
    AirRefractiveIndexConditionPolicy;
  airConditionCompatibility?:
    | "exact-match"
    | "assumed-compatible";
  airConditionAssumptionEvidence?:
    readonly EvidenceProvenance[];
  inputUncertaintyPropagated: false;
}
```

## SourcedAirPhaseRefractiveIndex

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SourcedAirPhaseRefractiveIndex {
  wavelengthNanometers: number;
  wavelengthBasis: "air";
  definition:
    "vacuum-wavelength-divided-by-air-wavelength";
  phaseRefractiveIndex: number;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  evidence: readonly EvidenceProvenance[];
  referenceConditions?:
    AirRefractiveIndexReferenceConditions;
}
```
