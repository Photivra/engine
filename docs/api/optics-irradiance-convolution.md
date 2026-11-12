# optics/irradiance-convolution.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateIrradianceConvolution

Synchronous float64 reference for bounded grids. Use the image-kernel accelerator for large grids.

```ts
export function calculateIrradianceConvolution(input: IrradianceConvolutionInput): { plan: IrradianceConvolutionPlan; values: Float64Array };
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateIrradianceConvolutionPlan

Validates the request and returns its plan. Every sample and weight is checked once.

```ts
export function calculateIrradianceConvolutionPlan(input: IrradianceConvolutionInput): IrradianceConvolutionPlan;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## IRRADIANCE_CONVOLUTION_LIMITS

`maximumPixels` is the default grid limit; a request may raise it with its own `maximumPixels`, up to `ceilingPixels`.

```ts
IRRADIANCE_CONVOLUTION_LIMITS = Object.freeze({
  maximumPixels: 24_000_000,
  ceilingPixels: FULL_RESOLUTION_CEILING_PIXELS,
  maximumDimension: 16_384,
  maximumKernelRadius: 32,
  maximumPatchCount: 4_096,
  maximumKernelWeights: 4_194_304,
  /** A kernel may lose energy (vignetting, transmission) but may not create it, beyond rounding slack. */
  maximumKernelSum: 1 + 2 ** -20,
  /** Inputs larger than this are rejected so that float32 execution cannot overflow. */
  maximumSampleMagnitude: 2 ** 100
})
```

## IRRADIANCE_CONVOLUTION_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
IRRADIANCE_CONVOLUTION_SCHEMA_VERSION = "0.1.0" as const
```

## IrradianceConvolutionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IrradianceConvolutionInput {
  schemaVersion: typeof IRRADIANCE_CONVOLUTION_SCHEMA_VERSION;
  width: number;
  height: number;
  /** Row-major samples. Finite, non-negative, linear and additive (for example irradiance, or expected photons per site). */
  samples: Float32Array | Float64Array;
  /** Kernel half-width in grid sites. Each kernel is (2r+1)×(2r+1). */
  kernelRadius: number;
  /** Patch size in grid sites. The last row and column of patches may be partial. */
  patchWidth: number;
  patchHeight: number;
  /**
   * Finite non-negative weights, `[patchRow][patchColumn][v + r][u + r]`, one kernel per patch in
   * row-major patch order. Each kernel sums to at most 1 (+2^-20 rounding slack).
   */
  kernels: Float32Array | Float64Array;
  boundary: "zero-outside-grid";
  /**
   * Optional opt-in grid limit for large images: an integer from 1 to `IRRADIANCE_CONVOLUTION_LIMITS.ceilingPixels`.
   * Default `IRRADIANCE_CONVOLUTION_LIMITS.maximumPixels` (24 000 000). It does not change the result.
   */
  maximumPixels?: number;
}
```

## IrradianceConvolutionPlan

Validated, immutable geometry of a convolution request. Sample arrays are borrowed, not copied.

```ts
export interface IrradianceConvolutionPlan {
  width: number;
  height: number;
  kernelRadius: number;
  kernelSize: number;
  tapCount: number;
  patchWidth: number;
  patchHeight: number;
  patchColumns: number;
  patchRows: number;
  /** Largest kernel sum and largest input magnitude. The float32 error bound uses them. */
  maximumKernelSum: number;
  maximumSampleMagnitude: number;
}
```
