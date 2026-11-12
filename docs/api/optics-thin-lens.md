# optics/thin-lens.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateThinLensImageDistance

Calculates Gaussian thin-lens image distance:

1/f = 1/s + 1/v

where f is focal length, s is object distance, and v is image distance.

This is a paraxial (small-angle) ideal-lens model. It does not model
real-lens focus breathing, pupil magnification, principal-plane movement
or aberrations.

```ts
export function calculateThinLensImageDistance(
  input: CalculateThinLensImageDistanceInput
): CalculationResult<ThinLensImageDistance>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateThinLensImageDistanceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateThinLensImageDistanceInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /** Object/focus-plane distance from the lens principal plane in metres. */
  objectDistanceM: number;
}
```

## ThinLensImageDistance

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ThinLensImageDistance {
  /** Image/sensor-plane distance from the lens principal plane in millimetres. */
  imageDistanceMm: number;
  /** Absolute paraxial magnification at the supplied object distance. */
  magnification: number;
  /**
   * Image-distance scale relative to the infinity-focus approximation f.
   * Values approach 1 as object distance becomes large.
   */
  infinityProjectionScale: number;
}
```
