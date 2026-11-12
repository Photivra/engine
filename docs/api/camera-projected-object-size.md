# camera/projected-object-size.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateProjectedObjectSize

Calculates the projected size of a flat object that faces the camera
(fronto-parallel).

Without focusDistanceM, it uses ideal pinhole projection with the nominal
focal length. With focusDistanceM, it projects onto the ideal thin-lens
sensor plane for that focus distance.

```ts
export function calculateProjectedObjectSize(
  input: CalculateProjectedObjectSizeInput
): CalculationResult<ProjectedObjectSize>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateProjectedObjectSizeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateProjectedObjectSizeInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /** Object width in metres. */
  objectWidthM: number;
  /** Object height in metres. */
  objectHeightM: number;
  /** Object-plane distance from the camera in metres. */
  distanceM: number;
  /** Optional focus distance in metres for focus-aware sensor-plane projection. */
  focusDistanceM?: number;
  /** Optional sensor pixel pitch in micrometres. */
  pixelPitchMicrometers?: number;
}
```

## ProjectedObjectSize

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProjectedObjectSize {
  widthMm: number;
  heightMm: number;
  projectionDistanceMm: number;
  widthPixels?: number;
  heightPixels?: number;
}
```
