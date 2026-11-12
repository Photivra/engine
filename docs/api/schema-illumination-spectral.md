# schema/illumination-spectral.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createSceneIlluminationSpectralCoverageParticipant

Converts a continuous light-source spectrum into the shared spectral coverage
type (wavelength range plus breakpoints).

Discrete-line spectra are handled separately and are never widened into
continuous breakpoints.

```ts
export function createSceneIlluminationSpectralCoverageParticipant(
  input:
    CreateSceneIlluminationSpectralCoverageParticipantInput
): SpectralCoverageParticipant;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateSceneIlluminationSpectralCoverageParticipantInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateSceneIlluminationSpectralCoverageParticipantInput {
  source: SceneIlluminationSource;
  participantId?: string;
}
```

## resolveSceneIlluminationDiscreteLineMeasure

Splits a discrete-line light source into the amount carried by each line.

Each relative line weight is a fraction of the source's declared total (integrated
over wavelength). A disabled source contributes zero. This helper does not handle
visibility, material response, light transport, outgoing scene radiance, optics or
sensor response.

```ts
export function resolveSceneIlluminationDiscreteLineMeasure(
  source:
    SceneIlluminationSource
): SceneIlluminationDiscreteLineMeasure;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SceneIlluminationDiscreteLineMeasure

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationDiscreteLineMeasure {
  sourceId: string;
  sourceFamily:
    SceneIlluminationSource["family"];
  sourceEnabled: boolean;
  spectrumId: string;
  magnitudeKind:
    SceneIlluminationSource["magnitude"]["kind"];
  magnitudeScientificStatus:
    SceneIlluminationScientificStatus;
  spectrumScientificStatus:
    "calibrated-relative-lines" |
    "approximation";
  measure: DiscreteSpectralLineMeasure;
  combinedUncertaintyCalculated: false;
  calibratedAbsoluteLineClaimAuthorized:
    false;
  materialTransportApplied: false;
  sceneRadianceCalculated: false;
}
```
