# optics/depth-of-field.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateDefocusCircle

Calculates the geometric defocus-circle diameter at the sensor plane for a
subject plane away from the selected focus plane, using the stable closed
form c = f^2 |s - d| / (N d (s - f)) (model 1.1.0).

```ts
export function calculateDefocusCircle(
  input: CalculateDefocusCircleInput
): CalculationResult<DefocusCircle>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateDefocusCircleInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateDefocusCircleInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /** F-number. */
  aperture: number;
  /** Focus-plane distance from the lens plane in metres. */
  focusDistanceM: number;
  /** Subject-plane distance from the lens plane in metres. */
  subjectDistanceM: number;
}
```

## calculateDepthOfField

Calculates exact thin-lens depth-of-field limits. With hyperfocal
distance H = f^2/(Nc) + f and focus distance s, the near limit is
s(H - f)/(H + s - 2f) and the far limit is s(H - f)/(H - s), which is
infinite (`null`) when s >= H. At both limits the geometric defocus circle
from {@link calculateDefocusCircle} equals the supplied circle of confusion.
The circle of confusion must be smaller than the aperture diameter f/N;
otherwise the near limit would fall inside the focal length.

The model is geometric. It does not include diffraction, aberrations,
focus breathing, pupil magnification or macro (high-magnification) effects.

```ts
export function calculateDepthOfField(
  input: CalculateDepthOfFieldInput
): CalculationResult<DepthOfField>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateDepthOfFieldInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateDepthOfFieldInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /** F-number. */
  aperture: number;
  /** Focus distance from the lens plane in metres. */
  focusDistanceM: number;
  /** Acceptable circle of confusion diameter in millimetres. */
  circleOfConfusionMm: number;
}
```

## DefocusCircle

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DefocusCircle {
  /** Geometric blur-circle diameter at the sensor plane in millimetres. */
  diameterMm: number;
}
```

## DepthOfField

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DepthOfField {
  hyperfocalDistanceM: number;
  nearLimitM: number;
  /** Null represents an infinite far limit. */
  farLimitM: number | null;
  /** Null represents infinite total depth of field. */
  totalDepthOfFieldM: number | null;
}
```
