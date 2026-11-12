# optics/focus-breathing.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateFocusBreathingFieldOfView

Calculates the one-axis field of view under the declared-scale
focus-breathing model, and reports the ideal thin-lens field of view for
comparison.

A breathingProjectionScale of 1 reproduces the focus-aware thin-lens field
of view exactly.

```ts
export function calculateFocusBreathingFieldOfView(
  input: CalculateFocusBreathingFieldOfViewInput
): CalculationResult<FocusBreathingFieldOfView>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateFocusBreathingFieldOfViewInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateFocusBreathingFieldOfViewInput
  extends CalculateFocusBreathingProjectionInput {
  /** Sensor/capture dimension corresponding to the requested FOV, in millimetres. */
  sensorDimensionMm: number;
}
```

## calculateFocusBreathingProjection

Applies a caller-declared focus-breathing projection scale to the ideal
Gaussian thin-lens projection for one focus state.

Photivra does not guess the scale from focal length, focus distance, lens
identity or marketing data. A scale of 1 keeps the thin-lens projection
exactly.

This is a generic approximation of how projection and magnification change
with focus. It is not a calibrated real-lens model. The physical focal
length is never changed and stays authoritative.

```ts
export function calculateFocusBreathingProjection(
  input: CalculateFocusBreathingProjectionInput
): CalculationResult<FocusBreathingProjection>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateFocusBreathingProjectionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateFocusBreathingProjectionInput {
  /** Physical lens focal length in millimetres. This value is never rewritten. */
  focalLengthMm: number;
  /** Selected focus distance in metres. */
  focusDistanceM: number;
  /**
   * Caller-declared projection scale for this focus state, relative to the
   * ideal thin-lens image distance.
   *
   * 1 means no breathing beyond the thin-lens model. Values above 1 narrow the
   * framing (more magnification). Values below 1 widen it (less
   * magnification).
   */
  breathingProjectionScale: number;
}
```

## calculateGeometricFocusBreathing

Focus breathing derived from ideal focusing geometry, instead of a declared scale.

- unit-focus: the whole lens moves. u + v = L - hiatus and 1/u + 1/v = 1/f, so
  v = (T - sqrt(T^2 - 4 f T)) / 2, where T = L - hiatus >= 4 f. The field narrows as v grows.
- fixed-image-distance-internal-focus: an idealised internal-focus lens keeps the rear principal
  plane at v = f_infinity and shortens its focal length to f' = u v / (u + v). The angular field
  at the rear nodal point then stays the same, and the magnification is f_infinity / u.
Both use paraxial Gaussian optics with the nodal points at the principal planes (unit pupil
magnification; Greivenkamp, OPTI-502 course notes, University of Arizona, sec. 3 and 5, free. Also
see: Kingslake & Johnson, Lens Design Fundamentals, 2nd ed., ch. 3; Ray, Applied Photographic
Optics, 3rd ed., ch. 9 and 14). Real internal-focus lenses also move their pupils and
principal planes, so modelling their breathing needs a calibrated profile.

```ts
export function calculateGeometricFocusBreathing(
  input: CalculateGeometricFocusBreathingInput
): CalculationResult<GeometricFocusBreathing>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateGeometricFocusBreathingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateGeometricFocusBreathingInput {
  /** Focal length at infinity focus, mm. */
  focalLengthMm: number;
  /**
   * Photographic focus distance measured from the subject plane to the sensor (image) plane, in
   * metres, as marked on lens distance scales.
   */
  subjectToSensorDistanceM: number;
  /** Sensor/capture dimension along the axis of interest, mm. */
  sensorDimensionMm: number;
  focusingMethod: GeometricFocusingMethod;
  /**
   * Signed distance between the front and rear principal planes (the "hiatus"), in mm. Default 0
   * (thin lens). The subject-to-sensor distance is u + hiatus + v.
   */
  principalPlaneSeparationMm?: number;
}
```

## FocusBreathingFieldOfView

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FocusBreathingFieldOfView {
  physicalFocalLengthMm: number;
  focusDistanceM: number;
  sensorDimensionMm: number;
  breathingProjectionScale: number;
  idealProjectionDistanceMm: number;
  effectiveProjectionDistanceMm: number;
  idealDegrees: number;
  effectiveDegrees: number;
  deltaDegrees: number;
}
```

## FocusBreathingProjection

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FocusBreathingProjection {
  /** Authoritative physical focal length supplied by the caller. */
  physicalFocalLengthMm: number;
  focusDistanceM: number;
  /** Ideal Gaussian thin-lens image distance before breathing adjustment. */
  idealProjectionDistanceMm: number;
  /**
   * Effective projection distance used by the generic breathing model.
   *
   * This is a projection (magnification) parameter. It does not replace the
   * physical focal length.
   */
  effectiveProjectionDistanceMm: number;
  /** Caller-declared scale relative to ideal thin-lens projection. */
  breathingProjectionScale: number;
  /** Ideal Gaussian thin-lens magnification at the selected focus distance. */
  idealMagnification: number;
  /** Generic breathing-adjusted magnification. */
  effectiveMagnification: number;
}
```

## GeometricFocusBreathing

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GeometricFocusBreathing {
  focusingMethod: GeometricFocusingMethod;
  infinityFocalLengthMm: number;
  /** Focal length of the focused system (changes only for internal focus), mm. */
  effectiveFocalLengthMm: number;
  /** Subject distance from the front principal plane, mm. */
  objectDistanceMm: number;
  /** Rear principal plane to sensor distance (projection distance), mm. */
  imageDistanceMm: number;
  /** Lateral magnification v / u. */
  magnification: number;
  /** v / f_infinity: framing scale relative to infinity focus. */
  projectionScaleRelativeToInfinity: number;
  /**
   * v divided by the ideal thin-lens image distance, at objectDistanceMm, of a lens with the same
   * infinity focal length. Exactly 1 for unit focus. You can pass it as breathingProjectionScale to
   * calculateFocusBreathingProjection() with focusDistanceM = objectDistanceMm / 1000.
   */
  equivalentBreathingProjectionScale: number;
  fieldOfViewDegrees: number;
  infinityFieldOfViewDegrees: number;
  deltaDegrees: number;
}
```

## GeometricFocusingMethod

Ideal focusing geometry for {@link calculateGeometricFocusBreathing}.

```ts
export type GeometricFocusingMethod =
  | "unit-focus"
  | "fixed-image-distance-internal-focus";
```
