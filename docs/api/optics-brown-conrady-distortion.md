# optics/brown-conrady-distortion.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## BrownConradyDistortionCoefficients

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BrownConradyDistortionCoefficients {
  /** Radial r^2 coefficient. */
  k1: number;
  /** Radial r^4 coefficient. */
  k2: number;
  /** Radial r^6 coefficient. */
  k3: number;
  /** Tangential (decentering) coefficient p1 (couples to y; see module equation). */
  p1: number;
  /** Tangential (decentering) coefficient p2 (couples to x; see module equation). */
  p2: number;
}
```

## BrownConradyDistortionMapping

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BrownConradyDistortionMapping {
  direction: "undistorted-to-distorted";
  sourceImagePointMm: LensFieldPointMm;
  mappedImagePointMm: LensFieldPointMm;
  sourceNormalizedRadius: number;
  /** Determinant of d(mapped)/d(source) at the source point (dimensionless area scale). */
  jacobianDeterminant: number;
  deltaMm: { x: number; y: number; distance: number };
  profileMinimumJacobianDeterminant: number;
}
```

## BrownConradyDistortionProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BrownConradyDistortionProfile {
  /** Physical image-plane radius used to normalize field position, in mm. */
  normalizationRadiusMm: number;
  /** Maximum undistorted normalized radius of the operating envelope. */
  maximumNormalizedRadius: number;
  coefficients: BrownConradyDistortionCoefficients;
}
```

## calculateBrownConradyDistortionMapping

Applies the Brown-Conrady forward mapping to one ideal image-plane point.

```ts
export function calculateBrownConradyDistortionMapping(
  input: CalculateBrownConradyDistortionMappingInput
): CalculationResult<BrownConradyDistortionMapping>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateBrownConradyDistortionMappingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateBrownConradyDistortionMappingInput {
  /** Ideal/undistorted image-plane point, in mm. */
  imagePointMm: LensFieldPointMm;
  profile: BrownConradyDistortionProfile;
}
```

## calculateInverseBrownConradyDistortionMapping

Inverse-maps one distorted image-plane point to its ideal source point, for destination-to-source
resampling. Damped Newton iteration starts from the radial-only inverse. The solution must lie
inside the declared envelope and must reproduce the distorted point within a relative tolerance of
1e-12.

```ts
export function calculateInverseBrownConradyDistortionMapping(
  input: CalculateInverseBrownConradyDistortionMappingInput
): CalculationResult<InverseBrownConradyDistortionMapping>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateInverseBrownConradyDistortionMappingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateInverseBrownConradyDistortionMappingInput {
  /** Distorted image-plane point to map back to ideal coordinates, in mm. */
  distortedImagePointMm: LensFieldPointMm;
  profile: BrownConradyDistortionProfile;
}
```

## InverseBrownConradyDistortionMapping

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface InverseBrownConradyDistortionMapping {
  direction: "distorted-to-undistorted";
  distortedImagePointMm: LensFieldPointMm;
  sourceImagePointMm: LensFieldPointMm;
  sourceNormalizedRadius: number;
  jacobianDeterminantAtSource: number;
  newtonIterations: number;
  /** Forward-mapping residual of the solved source point, in mm. */
  residualMm: number;
  deltaMm: { x: number; y: number; distance: number };
  profileMinimumJacobianDeterminant: number;
}
```
