# optics/sensor-environment-query.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorEnvironmentRadianceQuery

Builds an environment radiance request from points on the physical sensor,
using the existing focus-aware ideal projection and the analytic inverse
camera rotation.

Native Y (+Y down) is inverted explicitly. The provider direction points
opposite the look ray at exposure start. Nothing intersects the scene,
computes radiance or renders.

```ts
export function calculateSensorEnvironmentRadianceQuery(
  input: CalculateSensorEnvironmentRadianceQueryInput
): CalculationResult<SensorEnvironmentRadianceQuery>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorEnvironmentRadianceQueryInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorEnvironmentRadianceQueryInput {
  /** Optical sample point before the anti-aliasing filter or PSF. Native +X right, +Y down, in mm from the optical axis. */
  sourcePointNativeSensorMm: { x: number; y: number };
  focalLengthMm: number;
  focus: FocusPlane;
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  /** States that the moment the shutter opens is t=0 in the rotation model. */
  timeReference: "first-opening-boundary-phase";
  timeSecondsFromOpeningReference: number;
  /** The request uses the direction radiance travels: toward the camera, opposite the look ray. */
  environmentDirectionConvention: "outgoing-radiance-toward-camera";
  request: Omit<SceneRadianceEvaluationRequest, "target" | "timeSecondsFromExposureStart">;
  /** Optional 2.0 lens field mapping. Omit it for the ideal rectilinear, distortion-free query. */
  lensFieldMapping?: EnvironmentLensFieldMapping;
}
```

## EnvironmentLensFieldMapping

Lens field mapping between the physical (distorted) sensor point and the scene ray (2.0).
`radiometricAreaCorrection` states who applies the distortion area factor. The environment
photo signal multiplies irradiance by 1 / det(d distorted / d ideal) exactly once. A supplied
field-throughput profile must therefore not include it as well.

```ts
export interface EnvironmentLensFieldMapping {
  projectionModel: LensProjectionModel;
  distortion:
    | { kind: "none" }
    | { kind: "radial"; profile: RadialDistortionProfile }
    | { kind: "brown-conrady"; profile: BrownConradyDistortionProfile };
  radiometricAreaCorrection: "inverse-distortion-jacobian";
  /**
   * #549, optional: what an ideal image point outside a radial projection's image circle (for example beyond r = 2f of the
   * equisolid fisheye) does. Omitted: the query fails, as before. `"backward-ray"`: the query looks straight back (0, 0, −1),
   * a direction no forward scene answers, so a provider that treats directions beyond 90° as empty gives it zero radiance.
   */
  outsideImageCircle?: "backward-ray";
}
```

## SensorEnvironmentLensFieldMappingResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorEnvironmentLensFieldMappingResult {
  projectionModel: LensProjectionModel;
  distortionKind: "none" | "radial" | "brown-conrady";
  /** Ideal (undistorted) image-plane point, +X right / +Y up, mm. */
  idealImagePointMm: { x: number; y: number };
  /** Projection scale: thin-lens image distance at finite focus, focal length at infinity, mm. */
  projectionScaleMm: number;
  /** 1 / det(d distorted / d ideal) at this point; 1 without distortion. */
  distortionAreaFactor: number;
}
```

## SensorEnvironmentRadianceQuery

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorEnvironmentRadianceQuery {
  request: SceneRadianceEvaluationRequest;
  sourcePointNativeSensorMm: { x: number; y: number };
  sourcePointImagePlaneMm: { x: number; y: number };
  referenceLookDirectionUnitVector: { x: number; y: number; z: number };
  /** Rectilinear rotation mapping. Null when a non-rectilinear lens field mapping is used. */
  projection: ReturnType<typeof calculateInverseCameraRotationImageMapping> | null;
  /** Present only when the input declared a lens field mapping. */
  lensFieldMapping?: SensorEnvironmentLensFieldMappingResult;
  targetMeaning: "environment-direction-in-exposure-start-camera-axes";
  directionConvention: "outgoing-radiance-toward-camera";
  geometricRayProjectionCalculated: true;
  sceneIntersectionCalculated: false;
  visibilityCalculated: false;
  providerExecuted: false;
}
```
