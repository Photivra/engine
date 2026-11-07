# optics/lens-psf-kernels.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS

At most this many wavelengths per call: 400, the finest spectral sampling of `simulateCapture` (1 nm over 380–780 nm),
as `DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS.maximumWavelengths` (64 before 2.15.0). The work is linear in the count.

```ts
LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS = 400
```

## LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION = "0.1.0" as const
```

## LensPsfConvolutionKernels

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensPsfConvolutionKernels {
  schemaVersion: typeof LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION;
  kernelRadius: number;
  patchWidth: number;
  patchHeight: number;
  patchColumns: number;
  patchRows: number;
  /** `[patchRow][patchColumn][v + r][u + r]`, ready for `IrradianceConvolutionInput.kernels`. */
  kernels: Float64Array;
  /** True when every tap landed on one integer displacement (no bilinear splatting). */
  exactSiteSampling: boolean;
  maximumKernelSum: number;
  /** Per patch, row-major: the field point used and the weight-averaged relative pupil throughput (not applied). */
  patches: readonly { fieldPointMm: { x: number; y: number }; relativePupilThroughputFactor: number; interpolated: boolean }[];
}
```

## LensPsfConvolutionKernelsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensPsfConvolutionKernelsInput {
  schemaVersion: typeof LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION;
  /** The optical state, as for `resolveLensSampledPsf`, without the field point and wavelength. */
  psf: Omit<ResolveLensSampledPsfInput, "fieldPointMm" | "wavelengthNm">;
  /** One or more wavelengths with non-negative weights (at least one positive). */
  spectralWeights: readonly { wavelengthNm: number; weight: number }[];
  /** The convolution grid: sites, their pitch, and the optical axis in site units (site centres at i + 0.5). */
  grid: { width: number; height: number; sitePitchMicrometers: { x: number; y: number }; opticalAxisSite: { x: number; y: number } };
  /** Patch size in sites; the last row and column of patches may be partial. */
  patchWidth: number;
  patchHeight: number;
  /** Kernel radius to use; omitted, the smallest radius that holds every tap. A radius too small to hold the PSF is rejected. */
  kernelRadius?: number;
}
```

## resolveLensPsfConvolutionKernels

Builds the per-patch convolution kernels from a sampled lens PSF profile.

```ts
export function resolveLensPsfConvolutionKernels(input: LensPsfConvolutionKernelsInput): CalculationResult<LensPsfConvolutionKernels>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
