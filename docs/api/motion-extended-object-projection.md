# motion/extended-object-projection.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCaptureExtendedObjectTemporalProjection

Evaluates extended-object projection at deterministic midpoint time samples
inside each point's local exposure window (from the capture exposure
schedule).

```ts
export function calculateCaptureExtendedObjectTemporalProjection(
  input:
    CalculateCaptureExtendedObjectTemporalProjectionInput
): CalculationResult<CaptureExtendedObjectTemporalProjection>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateCaptureExtendedObjectTemporalProjectionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateCaptureExtendedObjectTemporalProjectionInput {
  objectId: string;
  timing:
    ResolvedCaptureModeTiming;
  focalLengthMm: number;
  focusDistanceM?: number;
  objectTranslationVelocityMps:
    Vector3;
  cameraTranslationVelocityMps:
    Vector3;
  temporalSampleCount: number;
  points:
    readonly CaptureExtendedObjectMetricPoint[];
  frontoparallelPlane?:
    ExtendedObjectFrontoparallelPlaneDeclaration;
}
```

## calculateExtendedObjectProjectionTrajectory

Evaluates multiple explicit metric points on one rigidly translating object
at deterministic physical times.

This is geometry only. It does not build a blur kernel, decide visibility,
integrate radiance, deform the object, rotate the camera or apply a
universal scale.

```ts
export function calculateExtendedObjectProjectionTrajectory(
  input:
    CalculateExtendedObjectProjectionTrajectoryInput
): CalculationResult<ExtendedObjectProjectionTrajectory>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateExtendedObjectProjectionTrajectoryInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateExtendedObjectProjectionTrajectoryInput {
  objectId: string;
  focalLengthMm: number;
  focusDistanceM?: number;
  objectTranslationVelocityMps:
    Vector3;
  cameraTranslationVelocityMps:
    Vector3;
  sampleTimesSecondsFromReference:
    readonly number[];
  points:
    readonly ExtendedObjectMetricPoint[];
  frontoparallelPlane?:
    ExtendedObjectFrontoparallelPlaneDeclaration;
}
```

## CaptureExtendedObjectMetricPoint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureExtendedObjectMetricPoint
  extends ExtendedObjectMetricPoint {
  /**
   * Native destination point. It selects the local exposure window (from the
   * capture exposure schedule) for this object point.
   */
  destinationPointNative:
    RasterPoint;
}
```

## CaptureExtendedObjectPointTrajectory

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureExtendedObjectPointTrajectory {
  pointId: string;
  destinationPointNative:
    RasterPoint;
  referencePositionCameraM:
    Vector3;
  referenceImagePointMm: {
    x: number;
    y: number;
  };
  localExposureWindow: {
    startSecondsFromCaptureReference:
      number;
    endSecondsFromCaptureReference:
      number;
    durationSeconds: number;
  };
  nodes:
    readonly CaptureExtendedObjectTemporalNode[];
}
```

## CaptureExtendedObjectTemporalNode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureExtendedObjectTemporalNode
  extends ExtendedObjectProjectionNode {
  localExposurePhase: number;
  normalizedTimeWeight: number;
  timeMeasureSeconds: number;
}
```

## CaptureExtendedObjectTemporalProjection

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureExtendedObjectTemporalProjection {
  objectId: string;
  timeReference:
    "first-opening-boundary-phase";
  timingProfileIdentity: {
    profileId: string;
    profileVersion: string;
    captureModeId: string;
  };
  projectionDistanceMm: number;
  temporalSampleCount: number;
  objectTranslationVelocityMps:
    Vector3;
  cameraTranslationVelocityMps:
    Vector3;
  relativeTranslationVelocityMps:
    Vector3;
  rigidTranslationOnly: true;
  pointTrajectories:
    readonly CaptureExtendedObjectPointTrajectory[];
  planarMagnificationDiagnosticAvailable:
    boolean;
  metricSceneDepthRequired: true;
  oneGlobalHomographyAuthorized:
    false;
  oneGlobalScaleAuthorizedForArbitrary3dGeometry:
    false;
  cameraRotationComposed: false;
  visibilityOcclusionModeled: false;
  deformationModeled: false;
  accelerationModeled: false;
  blurKernelCalculated: false;
  radianceIntegrated: false;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
  timeVaryingDefocusMayBeRequired:
    boolean;
}
```

## ExtendedObjectFrontoparallelPlaneDeclaration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExtendedObjectFrontoparallelPlaneDeclaration {
  kind: "fronto-parallel-planar-patch";
  referenceDepthM: number;
}
```

## ExtendedObjectMetricPoint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExtendedObjectMetricPoint {
  pointId: string;
  /**
   * Point in camera space, in metres, at the shared reference phase.
   *
   * +X right, +Y up, +Z forward/away from the camera.
   */
  positionCameraM: Vector3;
}
```

## ExtendedObjectPlanarMagnificationDiagnostic

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExtendedObjectPlanarMagnificationDiagnostic {
  geometry:
    "declared-fronto-parallel-planar-patch";
  referenceDepthM: number;
  uniformScaleAuthorizedWithinDeclaredPatch:
    true;
  scaleByTime:
    readonly {
      sampleIndex: number;
      timeSecondsFromReference:
        number;
      scaleFromReference: number;
    }[];
  lateralRigidTranslationDoesNotChangePatchScale:
    true;
  notAuthorizedForArbitrary3dGeometry:
    true;
}
```

## ExtendedObjectPointProjectionTrajectory

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExtendedObjectPointProjectionTrajectory {
  pointId: string;
  referencePositionCameraM:
    Vector3;
  referenceImagePointMm: {
    x: number;
    y: number;
  };
  nodes:
    readonly ExtendedObjectProjectionNode[];
}
```

## ExtendedObjectProjectionNode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExtendedObjectProjectionNode {
  sampleIndex: number;
  timeSecondsFromReference: number;
  relativePositionCameraM:
    Vector3;
  mappedImagePointMm: {
    x: number;
    y: number;
  };
  deltaFromReferenceImagePlaneMm: {
    x: number;
    y: number;
    distance: number;
  };
  depthM: number;
  planarMagnificationScaleFromReference:
    number | null;
}
```

## ExtendedObjectProjectionTrajectory

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExtendedObjectProjectionTrajectory {
  objectId: string;
  timeReference:
    "caller-declared-common-reference-phase";
  projectionDistanceMm: number;
  objectTranslationVelocityMps:
    Vector3;
  cameraTranslationVelocityMps:
    Vector3;
  relativeTranslationVelocityMps:
    Vector3;
  rigidTranslationOnly: true;
  pointTrajectories:
    readonly ExtendedObjectPointProjectionTrajectory[];
  planarMagnificationDiagnostic:
    ExtendedObjectPlanarMagnificationDiagnostic | null;
  metricSceneDepthRequired: true;
  oneGlobalHomographyAuthorized:
    false;
  oneGlobalScaleAuthorizedForArbitrary3dGeometry:
    false;
  cameraRotationComposed: false;
  visibilityOcclusionModeled: false;
  deformationModeled: false;
  accelerationModeled: false;
  blurKernelCalculated: false;
  radianceIntegrated: false;
  timeVaryingDefocusMayBeRequired:
    boolean;
}
```
