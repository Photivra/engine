# schema/illumination.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## parseSceneIlluminationProfile

Parses a renderer-independent scene illumination profile.

The result describes light sources only. It does not compute outgoing scene
radiance, material response, visibility or indirect light, and on its own it
does not justify photon or electron counts downstream.

```ts
export function parseSceneIlluminationProfile(
  value: unknown
): SceneIlluminationProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION = "0.1.0" as const
```

## SceneIlluminationMagnitude

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneIlluminationMagnitude =
  | {
      kind: "relative-linear-scale";
      scale: number;
      scientificStatus: "approximation";
      limitation: string;
    }
  | {
      kind: "radiant-intensity";
      wattsPerSteradian: number;
      scientificStatus: SceneIlluminationScientificStatus;
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
    }
  | {
      kind: "surface-radiance";
      wattsPerSquareMeterSteradian: number;
      scientificStatus: SceneIlluminationScientificStatus;
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
    }
  | {
      kind: "reference-plane-irradiance";
      wattsPerSquareMeter: number;
      referencePlaneId: string;
      scientificStatus: SceneIlluminationScientificStatus;
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
    };
```

## SceneIlluminationProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationProfile {
  schemaVersion:
    typeof SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION;
  profileId: string;
  sceneId: string;
  evidence: readonly EvidenceProvenance[];
  sources: readonly SceneIlluminationSource[];
  sceneRadianceCalculated: false;
  materialResponseApplied: false;
  visibilityEvaluated: false;
  indirectTransportEvaluated: false;
  fluorescenceModeled: false;
  volumetricTransportModeled: false;
  polarizationModeled: false;
}
```

## SceneIlluminationRelativeSpectrumSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationRelativeSpectrumSample {
  wavelengthNanometers: number;
  relativeDensityPerNanometer: number;
}
```

## SceneIlluminationScientificStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneIlluminationScientificStatus =
  | "calibrated"
  | "approximation";
```

## SceneIlluminationSource

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationSource {
  sourceId: string;
  family: SceneIlluminationSourceFamily;
  enabled: boolean;
  geometry: SceneIlluminationSourceGeometry;
  magnitude: SceneIlluminationMagnitude;
  spectrum: SceneIlluminationSpectrum;
  temporalBehavior: {
    kind: "time-invariant";
  };
  evidence: readonly EvidenceProvenance[];
  limitations?: readonly string[];
}
```

## SceneIlluminationSourceFamily

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneIlluminationSourceFamily =
  | "point"
  | "spot"
  | "area"
  | "directional"
  | "environment";
```

## SceneIlluminationSourceGeometry

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneIlluminationSourceGeometry =
  | {
      kind: "point-position";
      positionM: Vector3;
    }
  | {
      kind: "scene-object-binding";
      sceneObjectId: string;
    }
  | {
      kind: "spot";
      origin:
        | {
            kind: "point-position";
            positionM: Vector3;
          }
        | {
            kind: "scene-object-binding";
            sceneObjectId: string;
          };
      directionUnitVector: Vector3;
      outerConeAngleDegrees: number;
    }
  | {
      kind: "directional";
      directionUnitVector: Vector3;
    }
  | {
      kind: "environment";
    };
```

## SceneIlluminationSpectrum

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneIlluminationSpectrum =
  | {
      kind: "unresolved";
      limitation: string;
    }
  | {
      kind: "rgb-preview-approximation";
      colorSpace: "linear-srgb";
      red: number;
      green: number;
      blue: number;
      limitation: string;
    }
  | {
      kind: "blackbody-temperature-approximation";
      temperatureKelvin: number;
      limitation: string;
    }
  | {
      kind: "continuous-relative-spectrum";
      spectrumId: string;
      wavelengthUnit: "nm";
      wavelengthBasis: SpectralWavelengthBasis;
      interpolation: "piecewise-linear";
      outsideRangeBehavior: "fail-closed";
      normalization: "arbitrary-relative-scale";
      scientificStatus:
        | "calibrated-relative-shape"
        | "approximation";
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
      samples:
        readonly SceneIlluminationRelativeSpectrumSample[];
    }
  | {
      kind: "discrete-relative-lines";
      spectrumId: string;
      wavelengthUnit: "nm";
      scientificStatus:
        | "calibrated-relative-lines"
        | "approximation";
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
      distribution:
        NormalizedDiscreteSpectralLineDistribution;
    };
```

## SceneIlluminationUncertainty

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneIlluminationUncertainty =
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
