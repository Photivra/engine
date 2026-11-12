# optics/focus-state.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateFocusPlaneImageDistance

Calculates the ideal image-plane distance for an explicit focus state.

Finite focus uses the existing Gaussian thin-lens calculation, so its
numbers and provenance are unchanged. Infinity focus gives exactly the
nominal focal length, with a limiting magnification of zero.

```ts
export function calculateFocusPlaneImageDistance(
  input: CalculateFocusPlaneImageDistanceInput
): CalculationResult<ThinLensImageDistance>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateFocusPlaneImageDistanceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateFocusPlaneImageDistanceInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /** Explicit finite or infinity focus-plane state. */
  focus: FocusPlane;
}
```

## FocusPlane

Explicit ideal focus-plane state.

A finite distance is measured along the camera's optical axis, from the
ideal lens principal plane to the object plane. Infinity is a named state.
It is never stored as JavaScript Infinity or as a made-up large distance.

```ts
export type FocusPlane =
  | {
      kind: "finite";
      distanceM: number;
    }
  | {
      kind: "infinity";
    };
```

## parseFocusPlane

Parses an explicit focus-plane state from untrusted JSON.

Missing or unknown focus is rejected. It is never read as infinity.

```ts
export function parseFocusPlane(value: unknown): FocusPlane;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
