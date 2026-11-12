# optics/pupil-vignetting.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateMechanicalVignetting

Mechanical vignetting at one field angle: the open (cat's-eye) pupil from intersecting the
entrance pupil with displaced clipping apertures, its area ratio, and cos^4 x area ratio.

```ts
export function calculateMechanicalVignetting(
  input: CalculateMechanicalVignettingInput
): CalculationResult<MechanicalVignetting>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateMechanicalVignettingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateMechanicalVignettingInput {
  /** Unclipped entrance-pupil diameter, mm. */
  entrancePupilDiameterMm: number;
  /** Object-space field angle from the optical axis, degrees, in [0, 90). */
  fieldAngleDegrees: number;
  /** Image-plane direction of the field point, degrees counter-clockwise from +X. */
  fieldAzimuthDegrees: number;
  /** One through eight clipping apertures. */
  apertures: readonly MechanicalVignettingAperture[];
  /** Boundary samples per circle for the polygon, from 16 to 4096 (default 256). */
  boundarySamplesPerCircle?: number;
}
```

## calculateNaturalVignetting

Natural (cos^4 or finite Lambertian pupil) relative illumination at one image point.

```ts
export function calculateNaturalVignetting(
  input: CalculateNaturalVignettingInput
): CalculationResult<NaturalVignetting>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateNaturalVignettingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateNaturalVignettingInput {
  model: NaturalVignettingModel;
  /** Image-plane point relative to the optical axis, mm. */
  imagePointMm: { x: number; y: number };
  /** Axial distance from the exit pupil to the image plane, mm. */
  exitPupilDistanceMm: number;
  /** Exit-pupil diameter, mm; required for finite-lambertian-pupil. */
  exitPupilDiameterMm?: number;
}
```

## MechanicalVignetting

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface MechanicalVignetting {
  fieldAngleDegrees: number;
  fieldAzimuthDegrees: number;
  entrancePupilAreaSquareMm: number;
  /** Open area in mm^2. Exact for a single aperture; the polygon area otherwise. */
  openAreaSquareMm: number;
  areaMethod: "exact-circle-circle-intersection" | "boundary-polygon";
  /** Open area / unclipped pupil area, in [0, 1]. */
  openAreaRatio: number;
  /** cos^4(field angle). */
  cosineFourthFactor: number;
  /** cos^4(theta) x openAreaRatio. */
  combinedRelativeIllumination: number;
  /** Counter-clockwise convex boundary of the open pupil (empty when fully vignetted), mm. */
  openPupilPolygonMm: readonly { x: number; y: number }[];
  /** Area centroid of the boundary polygon, mm (null when fully vignetted). */
  openPupilCentroidMm: { x: number; y: number } | null;
}
```

## MechanicalVignettingAperture

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface MechanicalVignettingAperture {
  /** Aperture radius referred to the entrance-pupil plane, mm. */
  radiusMm: number;
  /**
   * Signed shift of the aperture's projected centre per unit tan(field angle), in mm, along the
   * field azimuth. Positive means toward the field point.
   */
  shiftPerTanFieldMm: number;
}
```

## NaturalVignetting

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NaturalVignetting {
  model: NaturalVignettingModel;
  /** Image-space chief-ray angle, radians. */
  chiefRayAngleRadians: number;
  /** Relative illumination E / E(axis), in (0, 1]. */
  relativeIllumination: number;
  /** Positive exposure loss, stops. */
  attenuationStops: number;
  /** cos^4 of the chief-ray angle, reported for comparison. */
  cosineFourthFactor: number;
}
```

## NaturalVignettingModel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type NaturalVignettingModel =
  | "cosine-fourth"
  | "finite-lambertian-pupil";
```
