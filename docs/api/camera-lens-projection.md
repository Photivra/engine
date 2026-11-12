# camera/lens-projection.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateLensProjectionDirection

Inverse-maps one image-plane point to its unit camera-frame scene direction under the declared
projection model. It rejects points outside the model's image circle. For equirectangular, it
rejects points outside +/-pi longitude and +/-pi/2 latitude.

```ts
export function calculateLensProjectionDirection(
  input: CalculateLensProjectionDirectionInput
): CalculationResult<LensProjectionDirection>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateLensProjectionDirectionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateLensProjectionDirectionInput {
  projectionModel: LensProjectionModel;
  focalLengthMm: number;
  /** Image-plane point relative to the optical axis, in millimetres. */
  imagePointMm: { x: number; y: number };
}
```

## calculateLensProjectionFieldOfView

Angular field of view across a centred sensor dimension along one axis through the optical
axis: 2 * theta(d / 2) for radial models and d / f for equirectangular.

For equirectangular, the result is the longitude span for a horizontal dimension and the latitude
span for a vertical one. A sensor dimension larger than a fisheye's image circle is rejected, not
clipped.

```ts
export function calculateLensProjectionFieldOfView(
  input: CalculateLensProjectionFieldOfViewInput
): CalculationResult<LensProjectionFieldOfView>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateLensProjectionFieldOfViewBounds

Asymmetric angular span between two signed sensor coordinates on one axis through the optical
axis, for off-centre crops.

```ts
export function calculateLensProjectionFieldOfViewBounds(
  input: CalculateLensProjectionFieldOfViewBoundsInput
): CalculationResult<LensProjectionFieldOfViewBounds>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateLensProjectionFieldOfViewBoundsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateLensProjectionFieldOfViewBoundsInput {
  projectionModel: LensProjectionModel;
  focalLengthMm: number;
  /** Signed minimum sensor coordinate along one axis through the optical axis, in mm. */
  minimumSensorCoordinateMm: number;
  /** Signed maximum sensor coordinate along the same axis, in mm. */
  maximumSensorCoordinateMm: number;
}
```

## CalculateLensProjectionFieldOfViewInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateLensProjectionFieldOfViewInput {
  projectionModel: LensProjectionModel;
  focalLengthMm: number;
  /** Centred sensor/capture dimension along one axis through the optical axis, in mm. */
  sensorDimensionMm: number;
}
```

## calculateLensProjectionImagePoint

Maps one camera-frame scene direction to its ideal image-plane point under the declared
projection model.

```ts
export function calculateLensProjectionImagePoint(
  input: CalculateLensProjectionImagePointInput
): CalculationResult<LensProjectionImagePoint>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateLensProjectionImagePointInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateLensProjectionImagePointInput {
  projectionModel: LensProjectionModel;
  /**
   * Projection scale in millimetres: the focal length f of the mapping function, or for
   * equirectangular the image distance per radian.
   */
  focalLengthMm: number;
  /** Scene direction in the camera frame. Need not be normalized; must be non-zero. */
  direction: LensDirection;
}
```

## LENS_PROJECTION_MODELS

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
LENS_PROJECTION_MODELS: readonly LensProjectionModel[] =
  Object.freeze([
    "rectilinear",
    "fisheye-equidistant",
    "fisheye-equisolid-angle",
    "fisheye-stereographic",
    "fisheye-orthographic",
    "equirectangular"
  ])
```

## LensDirection

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensDirection {
  /** Camera-frame direction component, +X right. Any positive length. */
  x: number;
  /** Camera-frame direction component, +Y up. */
  y: number;
  /** Camera-frame direction component along the optical axis toward the scene. */
  z: number;
}
```

## LensProjectionDirection

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensProjectionDirection {
  projectionModel: LensProjectionModel;
  /** Unit direction in the camera frame. */
  direction: LensDirection;
  fieldAngleRadians: number;
  imageRadiusMm: number;
}
```

## LensProjectionFieldOfView

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensProjectionFieldOfView {
  projectionModel: LensProjectionModel;
  degrees: number;
  radians: number;
  /** Projection scale used by the mapping, in millimetres. */
  projectionDistanceMm: number;
}
```

## LensProjectionFieldOfViewBounds

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensProjectionFieldOfViewBounds {
  projectionModel: LensProjectionModel;
  minimumRadians: number;
  maximumRadians: number;
  radians: number;
  minimumDegrees: number;
  maximumDegrees: number;
  degrees: number;
  projectionDistanceMm: number;
}
```

## LensProjectionImagePoint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensProjectionImagePoint {
  projectionModel: LensProjectionModel;
  imagePointMm: { x: number; y: number };
  /** Angle between the direction and the optical axis, in radians. */
  fieldAngleRadians: number;
  /** Distance of the image point from the optical axis, in millimetres. */
  imageRadiusMm: number;
}
```

## LensProjectionModel

Ideal projection model discriminator. `rectilinear` is the engine default.

```ts
export type LensProjectionModel =
  | "rectilinear"
  | "fisheye-equidistant"
  | "fisheye-equisolid-angle"
  | "fisheye-stereographic"
  | "fisheye-orthographic"
  | "equirectangular";
```

## parseLensProjectionModel

Runtime parser for the projection discriminator. Rejects (fails closed on) unknown values.

```ts
export function parseLensProjectionModel(
  value: unknown
): LensProjectionModel;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## RadialLensProjectionModel

Radial (rotationally symmetric) projection models.

```ts
export type RadialLensProjectionModel = Exclude<
  LensProjectionModel,
  "equirectangular"
>;
```
