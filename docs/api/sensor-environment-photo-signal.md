# sensor/environment-photo-signal.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateEnvironmentSensorPhotoSignal

Plans, queries the provider and integrates the photo signal for one site, at the site's own midpoint sample positions.

```ts
export function calculateEnvironmentSensorPhotoSignal(input: CalculateEnvironmentSensorPhotoSignalInput): CalculationResult<EnvironmentSensorPhotoSignal>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateEnvironmentSensorPhotoSignalInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateEnvironmentSensorPhotoSignalInput {
  temporalIntegrationId: string;
  sensor: Omit<CalculateSensorEqeTemporalExposureInput, "samples">;
  sceneBindings: CalculateSceneToSensorIrradianceQuadratureInput["sceneBindings"];
  optics: Omit<CalculateSceneRadianceToSensorIrradianceInput,
    "sceneRadianceRequest" | "sceneRadianceResult" | "imagePointMm" | "fieldThroughput">;
  motion: Pick<CalculateSensorEnvironmentRadianceQueryInput,
    "angularVelocityRadPerSec" | "timeReference" | "environmentDirectionConvention">;
  temporalSampleCount: number;
  /** Optional ideal circular pupil, for geometric depth of field (DOF) and visibility. Cannot be combined with a sampled PSF. */
  pupil?: IdealCircularPupil;
  /**
   * Optional lens field mapping (added in 2.0): a projection model and radial or Brown-Conrady
   * distortion for the scene-ray query. Its distortion area factor is applied to irradiance exactly
   * once. If omitted, the ideal rectilinear, distortion-free path is unchanged. Cannot be combined
   * with `pupil`.
   */
  lensFieldMapping?: EnvironmentLensFieldMapping;
  /** Explicit attenuation across the field (such as vignetting), applied once before the PSF spreads the light. */
  fieldThroughput: { kind: "unity"; evidence: readonly EvidenceProvenance[]; limitation: string } | {
    kind: "radial-illumination-vignetting"; profile: IlluminationVignettingProfile;
    evidence: readonly EvidenceProvenance[]; limitation: string;
  };
  psf: { kind: "not-applied"; evidence: readonly EvidenceProvenance[]; limitation: string } | {
    kind: "sampled-local";
    configuration: Pick<CalculateSensorPsfIrradianceQuadratureInput, "psf" | "psfWavelengthBasis" | "spatialModel">;
  };
  evaluateRadiance: EnvironmentRadianceEvaluator;
  /** Required with `pupil`: rays start at different points on the aperture, so a direction-only function cannot be used. */
  evaluateApertureRadiance?: EnvironmentApertureRadianceEvaluator;
}
```

## EnvironmentApertureRadianceEvaluator

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type EnvironmentApertureRadianceEvaluator = (request: Readonly<SceneRadianceEvaluationRequest>, apertureRay: Readonly<SensorApertureRay>) => SceneRadianceEvaluationResult;
```

## EnvironmentRadianceEvaluator

Caller-supplied synchronous radiance function, run locally. Calling it does not prove its light transport is physical.

```ts
export type EnvironmentRadianceEvaluator = (request: Readonly<SceneRadianceEvaluationRequest>) => SceneRadianceEvaluationResult;
```

## EnvironmentSensorPhotoSignal

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EnvironmentSensorPhotoSignal {
  sourceTargetProjectionCalculated: true;
  providerCallbackExecuted: true;
  providerTransportVerified: false;
  sceneVisibilityCalculated: false;
  productionPlanActivated: false;
  providerEvaluationCount: number;
  sourcePlane: "sensor-package-incident";
  fieldThroughputEvidence: readonly EvidenceProvenance[];
  fieldThroughputLimitation: string;
  psfOmission: { evidence: readonly EvidenceProvenance[]; limitation: string } | null;
  psfRedistributionApplied: boolean;
  pupilIntegrationApplied: boolean;
  pupilIntegrationProfile: IdealCircularPupil | null;
  photo: ReturnType<typeof createSensorEqeTemporalPhotoSignal>;
  instants: readonly {
    temporalSampleIndex: number;
    timeSecondsFromOpeningReference: number;
    psf: ReturnType<typeof calculateSensorPsfIrradianceQuadrature> | null;
    evaluations: readonly {
      query: ReturnType<typeof calculateSensorEnvironmentRadianceQuery>;
      result: SceneRadianceEvaluationResult;
      bindings: ReturnType<typeof validateSceneRadianceEvaluationBindings>;
      optics: ReturnType<typeof calculateSceneRadianceToSensorIrradiance>;
      apertureRay?: SensorApertureRay;
      apertureRequest?: SceneRadianceEvaluationRequest;
    }[];
  }[];
}
```
