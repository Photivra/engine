# camera/field-of-view.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateFieldOfView

Calculates the rectilinear angular field of view as
2 * atan(sensorDimension / (2 * projectionDistance)).

Without focusDistanceM, projectionDistance is the nominal focal length. This
keeps the older infinity-focus (pinhole) behaviour. With focusDistanceM,
projectionDistance is the ideal Gaussian thin-lens image distance for that
focus plane.

Neither mode models real-lens focus breathing or distortion.

```ts
export function calculateFieldOfView(
  input: CalculateFieldOfViewInput
): CalculationResult<FieldOfView>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateFieldOfViewBounds

Calculates an asymmetric rectilinear field-of-view span from signed
sensor-plane bounds measured from the optical axis.

Use it for off-centre sensor crops, where the optical axis is not at the
centre of the kept rectangle.

```ts
export function calculateFieldOfViewBounds(
  input: CalculateFieldOfViewBoundsInput
): CalculationResult<FieldOfViewBounds>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateFieldOfViewBoundsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateFieldOfViewBoundsInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /**
   * Minimum sensor-plane coordinate in millimetres relative to the optical
   * axis. Negative values lie on the negative side of the requested axis.
   */
  minimumSensorCoordinateMm: number;
  /**
   * Maximum sensor-plane coordinate in millimetres relative to the optical
   * axis.
   */
  maximumSensorCoordinateMm: number;
  /** Optional focus distance in metres. */
  focusDistanceM?: number;
  /** Ideal projection model; omitted or `"rectilinear"` keeps the existing behaviour. */
  projectionModel?: LensProjectionModel;
}
```

## CalculateFieldOfViewInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateFieldOfViewInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /** Sensor dimension corresponding to the requested field of view, in millimetres. */
  sensorDimensionMm: number;
  /**
   * Optional focus distance in metres. When supplied, the ideal thin-lens
   * image distance is used as the projection distance. Omit to preserve the
   * infinity-focus/pinhole approximation.
   */
  focusDistanceM?: number;
  /**
   * Ideal projection model. Omit it or pass `"rectilinear"` to keep the rectilinear behaviour and
   * model ids. Other models use the focal length as the mapping scale and do not accept
   * focusDistanceM.
   */
  projectionModel?: LensProjectionModel;
}
```

## FieldOfView

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FieldOfView {
  /** Angular field of view in degrees. */
  degrees: number;
  /** Angular field of view in radians. */
  radians: number;
  /** Projection/image-plane distance used by the geometry, in millimetres. */
  projectionDistanceMm: number;
}
```

## FieldOfViewBounds

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FieldOfViewBounds {
  /** Minimum signed angular bound in degrees. */
  minimumDegrees: number;
  /** Maximum signed angular bound in degrees. */
  maximumDegrees: number;
  /** Total angular span in degrees. */
  degrees: number;
  /** Minimum signed angular bound in radians. */
  minimumRadians: number;
  /** Maximum signed angular bound in radians. */
  maximumRadians: number;
  /** Total angular span in radians. */
  radians: number;
  /** Projection/image-plane distance used by the geometry, in millimetres. */
  projectionDistanceMm: number;
}
```
