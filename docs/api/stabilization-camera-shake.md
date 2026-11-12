# stabilization/camera-shake.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CameraShakeBlurSample

How far a still world point on the optical axis moves in the image during
the exposure, in image-plane axes (+X right, +Y up). For a single axis it
equals the deltaMm from calculateCameraRotationImageMapping() at the
optical axis.

```ts
export interface CameraShakeBlurSample {
  /** +X-right image displacement in millimetres: +d·tan(yaw·t). */
  deltaXmm: number;
  /** +Y-up image displacement in millimetres: -d·tan(pitch·t). */
  deltaYmm: number;
  distanceMm: number;
  distancePixels?: number;
  deltaXPixels?: number;
  deltaYPixels?: number;
}
```

## CameraShakeEstimate

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CameraShakeEstimate {
  residualMotionFactor: number;
  projectionDistanceMm: number;
  unstabilized: CameraShakeBlurSample;
  stabilized: CameraShakeBlurSample;
}
```

## estimateCameraShakeBlur

Estimates blur on the sensor from a simple handheld-shake profile, where
the camera turns at a constant angular velocity. An optional stabilization
rating reduces that motion.

With focusDistanceM, angular motion is projected using the ideal thin-lens
sensor distance, like the other focus-aware projection functions. Without
it, the nominal focal length is used, which keeps the older approximation.

The optical projection is physically calculated. But turning a
stabilization rating in stops into residual angular motion by 2^-stops is
an educational approximation. It is not a CIPA DC-011 measurement or a
real-camera rating.

Each axis's rotation during the exposure must stay below a quarter turn
(π/2 rad).

```ts
export function estimateCameraShakeBlur(
  input: EstimateCameraShakeBlurInput
): CalculationResult<CameraShakeEstimate>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EstimateCameraShakeBlurInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EstimateCameraShakeBlurInput {
  focalLengthMm: number;
  shutterSeconds: number;
  /**
   * Constant camera angular velocity in radians per second. Signs follow the
   * same physical right-hand rule as calculateCameraRotationImageMapping().
   * The camera axes are +X right, +Y up, +Z forward (a left-handed basis).
   * - Positive yaw turns the optical axis left and moves still image content
   *   toward +X.
   * - Positive pitch tilts the optical axis up and moves still image content
   *   toward -Y.
   */
  angularVelocityRadPerSec: {
    yaw: number;
    pitch: number;
  };
  stabilizationStopsEquivalent: number;
  /** Optional focus distance in metres for focus-aware sensor-plane projection. */
  focusDistanceM?: number;
  pixelPitchMicrometers?: number;
}
```
