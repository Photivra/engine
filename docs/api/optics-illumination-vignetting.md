# optics/illumination-vignetting.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateIlluminationVignetting

Calculates generic illumination falloff across the image (vignetting) as a
factor that multiplies linear light.

A profile is accepted only if its relative throughput stays strictly
positive and never exceeds 1 (the value on the optical axis) anywhere in
its declared range.

```ts
export function calculateIlluminationVignetting(
  input: CalculateIlluminationVignettingInput
): CalculationResult<IlluminationVignetting>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateIlluminationVignettingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateIlluminationVignettingInput {
  /**
   * Ideal image-plane field position relative to the optical axis, in mm.
   *
   * Throughput is evaluated at this ideal field coordinate. Geometric
   * distortion is neither applied nor inverted.
   */
  imagePointMm: LensFieldPointMm;
  profile: IlluminationVignettingProfile;
}
```

## IlluminationVignetting

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IlluminationVignetting {
  imagePointMm: LensFieldPointMm;
  normalizedRadius: number;
  /**
   * Factor that multiplies scene-linear or channel-linear signal.
   *
   * 1 means no attenuation. Values must stay in (0, 1].
   */
  linearThroughputFactor: number;
  /** Positive exposure loss relative to the optical axis, in stops. */
  attenuationStops: number;
  profileMinimumThroughputFactor: number;
  profileMaximumThroughputFactor: number;
}
```

## IlluminationVignettingCoefficients

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IlluminationVignettingCoefficients {
  /** Coefficient on normalized radius squared. */
  r2: number;
  /** Coefficient on normalized radius to the fourth power. */
  r4: number;
  /** Coefficient on normalized radius to the sixth power. */
  r6: number;
}
```

## IlluminationVignettingProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IlluminationVignettingProfile {
  /** Physical image-plane radius used to normalize field position, in mm. */
  normalizationRadiusMm: number;
  /** Maximum normalized image-plane radius over which the profile is valid. */
  maximumNormalizedRadius: number;
  /**
   * Generic radial relative-illumination coefficients.
   *
   * Relative linear throughput is:
   *   1 + r2 * rho^2 + r4 * rho^4 + r6 * rho^6
   *
   * where rho is physical image-plane radius / normalizationRadiusMm.
   */
  coefficients: IlluminationVignettingCoefficients;
}
```
