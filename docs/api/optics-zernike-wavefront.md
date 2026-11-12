# optics/zernike-wavefront.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateDefocusWavefront

Converts a signed paraxial image-plane defocus into the defocus wave aberration
W020 = dz / (8 N^2) and its Noll Z4 coefficient W020 / (2 sqrt 3).

Sign convention: dz = sensor distance minus image distance. Positive W020 means the image lies in
front of the sensor. With pure defocus, the PSF intensity does not depend on the sign.

```ts
export function calculateDefocusWavefront(
  input: CalculateDefocusWavefrontInput
): CalculationResult<DefocusWavefront>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateDefocusWavefrontInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateDefocusWavefrontInput {
  /** Signed image-plane defocus, sensor minus image distance, in micrometres. */
  signedDefocusImagePlaneMicrometers: number;
  /** Image-side working f-number (image distance / pupil diameter). */
  workingFNumber: number;
}
```

## createWavefrontPupilGrid

Builds a complex-pupil grid: a circular pupil, an optional polygon mask, and an OPD from Zernike
coefficients, Seidel coefficients or both. If every coefficient is zero, the OPD is exactly zero,
so the PSF equals the existing aberration-free circular-pupil reference.

```ts
export function createWavefrontPupilGrid(
  input: CreateWavefrontPupilGridInput
): CalculationResult<WavefrontPupilGrid>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateWavefrontPupilGridInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateWavefrontPupilGridInput {
  /** Pupil diameter in mm; rho = 1 at radius pupilDiameterMm / 2. */
  pupilDiameterMm: number;
  /** Odd number of samples across the pupil diameter, from 3 to 63. */
  samplesAcross: number;
  zernikeCoefficients?: readonly ZernikeCoefficient[];
  seidelCoefficients?: SeidelWavefrontCoefficients;
  /** Required when any field-dependent Seidel coefficient is non-zero. */
  seidelField?: SeidelFieldPosition;
  /**
   * Optional additional aperture mask: a simple polygon in pupil-plane mm (for example the
   * cat's-eye pupil from calculateMechanicalVignetting). Samples outside it get zero amplitude.
   */
  apertureMaskVerticesMm?: readonly { x: number; y: number }[];
}
```

## DefocusWavefront

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DefocusWavefront {
  signedDefocusImagePlaneMicrometers: number;
  workingFNumber: number;
  /** Peak defocus coefficient W020 = dz / (8 N^2), micrometres. */
  w020Micrometers: number;
  /** Equivalent Noll Z4 coefficient W020 / (2 sqrt 3), micrometres (equals the RMS). */
  zernikeZ4Micrometers: number;
}
```

## estimateMarechalStrehlRatio

Marechal/Mahajan approximation of the Strehl ratio: exp(-(2 pi sigma / lambda)^2). Valid only for a
small RMS wavefront error (Strehl roughly above 0.3). It is not an exact PSF calculation.

```ts
export function estimateMarechalStrehlRatio(
  input: EstimateMarechalStrehlRatioInput
): CalculationResult<{ strehlRatio: number; rmsWaves: number }>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EstimateMarechalStrehlRatioInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EstimateMarechalStrehlRatioInput {
  rmsWavefrontErrorMicrometers: number;
  wavelengthNm: number;
}
```

## evaluateZernikePolynomial

Evaluates the unit-RMS Noll Zernike polynomial at normalised pupil polar coordinates.

```ts
export function evaluateZernikePolynomial(
  nollIndex: number,
  normalizedRadius: number,
  azimuthRadians: number
): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveZernikeNollOrder

Converts a Noll index to radial order n and signed azimuthal frequency m (Noll 1976).

```ts
export function resolveZernikeNollOrder(nollIndex: number): ZernikeOrder;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SeidelFieldPosition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SeidelFieldPosition {
  /** Normalised field height H in [0, 1]. */
  normalizedFieldHeight: number;
  /** Image-plane direction of the field point, degrees counter-clockwise from +X. */
  fieldAzimuthDegrees: number;
}
```

## SeidelWavefrontCoefficients

Peak Seidel wave-aberration coefficients in micrometres of optical path difference.

```ts
export interface SeidelWavefrontCoefficients {
  /** Defocus rho^2. */
  w020Micrometers?: number;
  /** Tilt H rho cos(phi). */
  w111Micrometers?: number;
  /** Spherical aberration rho^4. */
  w040Micrometers?: number;
  /** Coma H rho^3 cos(phi). */
  w131Micrometers?: number;
  /** Astigmatism H^2 rho^2 cos^2(phi). */
  w222Micrometers?: number;
  /** Field curvature H^2 rho^2. */
  w220Micrometers?: number;
  /** Distortion H^3 rho cos(phi). */
  w311Micrometers?: number;
}
```

## WavefrontPupilGrid

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface WavefrontPupilGrid {
  /** Grid for LensComplexPupilProfile.grid. Amplitude is 1 inside and 0 outside; OPD is in micrometres. */
  grid: LensComplexPupilGrid;
  pupilDiameterMm: number;
  /** Number of samples with non-zero amplitude. */
  openSampleCount: number;
  /** sqrt(sum c_j^2, j >= 2): RMS of the Zernike terms alone over the continuous unit disk. */
  zernikeRmsMicrometers: number;
  /** RMS of the sampled OPD over open samples, with piston removed (all terms). */
  sampledRmsMicrometers: number;
  /** Peak-to-valley of the sampled OPD over open samples. */
  sampledPeakToValleyMicrometers: number;
}
```

## ZERNIKE_MAXIMUM_NOLL_INDEX

Largest supported Noll index (radial order n <= 10).

```ts
ZERNIKE_MAXIMUM_NOLL_INDEX = 66
```

## ZERNIKE_PUPIL_MAXIMUM_SAMPLES_ACROSS

Largest odd pupil grid width: 63 x 63 = 3969 samples, within the complex-pupil 4096 limit.

```ts
ZERNIKE_PUPIL_MAXIMUM_SAMPLES_ACROSS = 63
```

## ZernikeCoefficient

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ZernikeCoefficient {
  nollIndex: number;
  /** Coefficient of the unit-RMS Noll polynomial, in micrometres of optical path difference. */
  coefficientMicrometers: number;
}
```

## ZernikeOrder

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ZernikeOrder {
  nollIndex: number;
  /** Radial order n. */
  radialOrder: number;
  /** Signed azimuthal frequency m. Positive means cos(m theta); negative means sin(|m| theta). */
  azimuthalFrequency: number;
}
```
