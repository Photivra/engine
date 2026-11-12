# optics/atmospheric-haze.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AtmosphericExtinctionModel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AtmosphericExtinctionModel {
  /** Wavelength at which the reference coefficients apply, nm. */
  referenceWavelengthNm: number;
  /** Molecular (Rayleigh) extinction coefficient at the reference wavelength, 1/m (>= 0). */
  rayleighExtinctionPerMeter: number;
  /** Aerosol extinction coefficient at the reference wavelength, 1/m (>= 0). */
  aerosolExtinctionPerMeter: number;
  /** Angstrom exponent alpha for the aerosol term (finite, typically 0-2.5). */
  angstromExponent: number;
  /** Rayleigh wavelength exponent; defaults to 4. */
  rayleighExponent?: number;
}
```

## AtmosphericHaze

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AtmosphericHaze {
  wavelengthNm: number;
  pathLengthM: number;
  rayleighExtinctionPerMeter: number;
  aerosolExtinctionPerMeter: number;
  extinctionPerMeter: number;
  opticalDepth: number;
  /** Direct transmittance t = exp(-beta d). */
  transmittance: number;
  /** L0 t. */
  attenuatedSceneRadiance: number;
  /** L_air (1 - t). */
  airlightContribution: number;
  /** L0 t + L_air (1 - t), in the input radiance unit. */
  hazedRadiance: number;
  /** Apparent contrast against the horizon divided by the intrinsic contrast: (L - L_air)/(L0 - L_air) = t. */
  contrastTransmittance: number;
}
```

## calculateAtmosphericHaze

Koschmieder haze at one wavelength: attenuated scene radiance plus airlight, with Rayleigh and
Angstrom-law aerosol extinction.

```ts
export function calculateAtmosphericHaze(
  input: CalculateAtmosphericHazeInput
): CalculationResult<AtmosphericHaze>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateAtmosphericHazeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateAtmosphericHazeInput {
  /** Line-of-sight distance through the homogeneous haze, metres (>= 0). */
  pathLengthM: number;
  /** Wavelength, nm (same basis as the extinction data). */
  wavelengthNm: number;
  /** Scene (object) radiance at zero distance, any linear radiance unit (>= 0). */
  sceneRadiance: number;
  /** Horizon/airlight radiance in the same unit (>= 0). */
  airlightRadiance: number;
  extinction: AtmosphericExtinctionModel;
}
```

## calculateExtinctionFromVisibility

Extinction coefficient from meteorological visibility with Koschmieder's relation
beta = -ln(epsilon) / V.

```ts
export function calculateExtinctionFromVisibility(
  input: CalculateExtinctionFromVisibilityInput
): CalculationResult<{ extinctionPerMeter: number; contrastThreshold: number }>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateExtinctionFromVisibilityInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateExtinctionFromVisibilityInput {
  /** Meteorological visibility, metres. */
  visibilityM: number;
  /** Contrast threshold epsilon in (0, 1); Koschmieder 0.02 by default, WMO MOR uses 0.05. */
  contrastThreshold?: number;
}
```
