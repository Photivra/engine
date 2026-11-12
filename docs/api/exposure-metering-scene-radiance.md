# exposure/metering-scene-radiance.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createSceneRadianceDerivedExposureMeteringSampleSet

Builds a set of relative pre-exposure meter samples tied to one validated
scene-radiance provider context.

The caller or renderer still supplies the relative sample values. This
bridge only checks identity and timing. It does not convert spectral
radiance into luminance, and it does not define a calibrated meter spectral
response.

```ts
export function createSceneRadianceDerivedExposureMeteringSampleSet(
  input:
    CreateSceneRadianceDerivedExposureMeteringSampleSetInput
): SceneRadianceDerivedExposureMeteringSampleSet;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateSceneRadianceDerivedExposureMeteringSampleSetInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateSceneRadianceDerivedExposureMeteringSampleSetInput {
  measurementId: string;
  sceneStateId: string;
  providerProfile:
    SceneRadianceProviderProfile;
  illuminationProfile:
    SceneIlluminationProfile;
  materialResponseProfile:
    SceneMaterialResponseProfile;
  illuminationTemporalProfile?:
    SceneIlluminationTemporalProfile;
  captureTimeSecondsFromReference?: number;
  captureGeometry:
    ResolvedCaptureGeometry;
  derivationProfile:
    SceneRadianceMeteringDerivationProfile;
  samples:
    readonly ExposureMeteringZoneSample[];
}
```

## parseSceneRadianceMeteringDerivationProfile

Parses the declared approximation that turns renderer or provider scene data
into the single relative linear values the meter uses.

The profile does not support any claim of calibrated luminance or of a
spectral-to-photometric conversion.

```ts
export function parseSceneRadianceMeteringDerivationProfile(
  value: unknown
): SceneRadianceMeteringDerivationProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION =
  "0.1.0" as const
```

## SceneRadianceDerivedExposureMeteringSampleSet

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneRadianceDerivedExposureMeteringSampleSet
  extends ExposureMeteringSampleSet {
  sourceContext:
    SceneRadianceMeteringSourceContext;
}
```

## SceneRadianceMeteringDerivationProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneRadianceMeteringDerivationProfile {
  schemaVersion:
    typeof SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION;
  derivationId: string;
  scientificStatus: "approximation";
  method:
    "renderer-provided-pre-exposure-relative-reduction";
  spectralWeighting:
    "not-calibrated";
  evidence: readonly EvidenceProvenance[];
  limitation: string;
}
```

## SceneRadianceMeteringSourceContext

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneRadianceMeteringSourceContext {
  kind:
    "scene-radiance-provider-derived-relative";
  sceneId: string;
  sceneStateId: string;
  providerProfileId: string;
  illuminationProfileId: string;
  materialResponseProfileId: string;
  derivationProfileId: string;
  providerScientificStatus:
    SceneRadianceProviderProfile["scientificStatus"];
  materialResponseFidelity:
    ReturnType<
      typeof assessSceneMaterialResponseFidelity
    >;
  temporal:
    SceneRadianceMeteringTemporalContext;
  spectralReductionCalibrated: false;
  calibratedLuminanceClaimAuthorized:
    false;
  calibratedSceneRadianceClaimAuthorized:
    false;
}
```

## SceneRadianceMeteringTemporalContext

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneRadianceMeteringTemporalContext =
  | {
      kind: "time-invariant";
    }
  | {
      kind:
        "registered-time-varying";
      illuminationTemporalProfileId:
        string;
      timeReference:
        "first-opening-boundary-phase";
      captureTimeSecondsFromReference:
        number;
    };
```
