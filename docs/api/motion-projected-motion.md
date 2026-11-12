# motion/projected-motion.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateProjectedMotionBlur

Calculates sensor-plane motion during an exposure using ideal rectilinear
projection and constant linear object velocity.

Without focusDistanceM, the projection distance is the nominal focal length
(the older pinhole behaviour). With focusDistanceM, it is the thin-lens
image distance for that focus.

The object's positions when the shutter opens and closes are both projected
onto the image plane, and the distance between them is measured. So
sideways motion and motion toward or away from the camera are both handled,
without a generic "subject speed" category.

```ts
export function calculateProjectedMotionBlur(
  input: CalculateProjectedMotionBlurInput
): CalculationResult<ProjectedMotionBlur>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateProjectedMotionBlurInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateProjectedMotionBlurInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /** Shutter-open duration in seconds. */
  shutterSeconds: number;
  /** Object position at shutter open, in camera-relative metres. +z is away from the camera. */
  positionM: Vector3;
  /** Constant world-space velocity during the exposure, in metres per second. */
  velocityMps: Vector3;
  /** Optional focus distance in metres for focus-aware sensor-plane projection. */
  focusDistanceM?: number;
  /** Optional sensor pixel pitch in micrometres for pixel-domain blur reporting. */
  pixelPitchMicrometers?: number;
}
```

## ProjectedMotionBlur

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProjectedMotionBlur {
  deltaXMm: number;
  deltaYMm: number;
  distanceMm: number;
  projectionDistanceMm: number;
  distancePixels?: number;
}
```
