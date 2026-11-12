# sensor/radiometry-readiness.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## assessRadiometryReadiness

Checks whether the declared prerequisites are enough for a nominal photon
estimate and, separately, for a calibrated photon claim.

It does not switch on composed photon or noise output.

```ts
export function assessRadiometryReadiness(
  profile: RadiometryReadinessProfile
): RadiometryReadinessAssessment;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalibrationArtifactReference

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalibrationArtifactReference {
  id: string;
  checksumSha256: string;
}
```

## ExposureIntegrationRequirement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureIntegrationRequirement =
  | (RadiometryRequirementBase & {
      requirement: "exposure-integration";
      integrationModel: "uniform-boxcar";
    })
  | (RadiometryRequirementBase & {
      requirement: "exposure-integration";
      integrationModel: "documented-shutter-function";
      dataArtifact: CalibrationArtifactReference;
    });
```

## OpticalTransmissionRequirement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type OpticalTransmissionRequirement =
  | (RadiometryRequirementBase & {
      requirement: "optical-transmission";
      representation: "spectral-data";
      dataArtifact: CalibrationArtifactReference;
    })
  | (RadiometryRequirementBase & {
      requirement: "optical-transmission";
      representation: "t-stop-approximation";
      tStop: number;
    });
```

## parseRadiometryReadinessProfile

Parses untrusted metadata about radiometry prerequisites.

It checks structure and provenance. It cannot prove that a cited calibration
or evidence claim is scientifically true.

```ts
export function parseRadiometryReadinessProfile(
  value: unknown
): RadiometryReadinessProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PhotositeCollectionAreaRequirement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type PhotositeCollectionAreaRequirement =
  | (RadiometryRequirementBase & {
      requirement: "photosite-collection-area";
      areaModel: "effective-collection-area";
      effectiveCollectionAreaSquareMicrometers: number;
    })
  | (RadiometryRequirementBase & {
      requirement: "photosite-collection-area";
      areaModel: "geometric-area-times-fill-factor";
      geometricCellAreaSquareMicrometers: number;
      fillFactor: number;
    });
```

## PupilVignettingRequirement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type PupilVignettingRequirement =
  | (RadiometryRequirementBase & {
      requirement: "pupil-vignetting";
      representation: "spatial-data";
      dataArtifact: CalibrationArtifactReference;
    })
  | (RadiometryRequirementBase & {
      requirement: "pupil-vignetting";
      representation: "documented-approximation";
    });
```

## RadiometryReadinessAssessment

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RadiometryReadinessAssessment {
  status: "not-ready" | "approximate-only" | "calibrated-ready";
  nominalPhotonEstimateReady: boolean;
  calibratedPhotonClaimReady: boolean;
  missingRequirements: readonly RadiometryRequirementId[];
  approximateRequirements: readonly RadiometryRequirementId[];
  unquantifiedUncertaintyRequirements: readonly RadiometryRequirementId[];
  /**
   * Always false: this assessment never switches on composed photon or noise
   * output by itself. Doing so is a separate, explicit later decision.
   */
  composedPhotonOutputEnabled: false;
}
```

## RadiometryReadinessProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RadiometryReadinessProfile {
  schemaVersion: "0.1.0";
  components: readonly RadiometryRequirement[];
}
```

## RadiometryRequirement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RadiometryRequirement =
  | SceneSpectralRadianceRequirement
  | OpticalTransmissionRequirement
  | PupilVignettingRequirement
  | PhotositeCollectionAreaRequirement
  | ExposureIntegrationRequirement
  | SensorResponseRequirement;
```

## RadiometryRequirementId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RadiometryRequirementId =
  | "scene-spectral-radiance"
  | "optical-transmission"
  | "pupil-vignetting"
  | "photosite-collection-area"
  | "exposure-integration"
  | "sensor-response";
```

## RadiometryScientificStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RadiometryScientificStatus =
  | "calibrated"
  | "approximation";
```

## RadiometryUncertaintyDeclaration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RadiometryUncertaintyDeclaration =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "absolute";
      plusMinus: number;
      unit: string;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };
```

## SceneSpectralRadianceRequirement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneSpectralRadianceRequirement
  extends RadiometryRequirementBase {
  requirement: "scene-spectral-radiance";
  representation:
    | "spectral-data"
    | "documented-spectral-approximation";
  dataArtifact: CalibrationArtifactReference;
}
```

## SensorResponseRequirement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorResponseRequirement =
  | (RadiometryRequirementBase & {
      requirement: "sensor-response";
      responseRepresentation: "spectral-quantum-efficiency";
      dataArtifact: CalibrationArtifactReference;
    })
  | (RadiometryRequirementBase & {
      requirement: "sensor-response";
      responseRepresentation: "effective-qe-approximation";
      effectiveQuantumEfficiency: number;
    });
```
