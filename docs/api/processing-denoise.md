# processing/denoise.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## BilateralFilterInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BilateralFilterInput {
  image: ProcessingRgbImage;
  spatialSigmaPixels: number;
  /** Range σ in the units of the image values. */
  rangeSigma: number;
  maximumWorkingBytes?: number;
}
```

## createBilateralFilterTask

Brute-force bilateral filter (window radius ⌈3σ_s⌉, reflect-101 borders).

```ts
export function createBilateralFilterTask(input: BilateralFilterInput, provider: ProcessingProvider): ProcessingTask<ProcessedRgbImage>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createNonLocalMeansTask

Non-local means (Buades, Coll & Morel 2005), offset-major with box-filtered patch distances.

```ts
export function createNonLocalMeansTask(input: NonLocalMeansInput, provider: ProcessingProvider): ProcessingTask<ProcessedRgbImage>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createSyntheticFilmGrainTask

Adds deterministic synthetic grain:
1. Unit-variance Gaussian white noise per pixel. It is seeded by the absolute pixel index, so tiling
   never changes it.
2. Optionally blurred by a Gaussian with σ = grain size, then renormalized to unit variance.
3. Scaled by a(v) = intensity·2√(v(1 − v)): zero at black and white, `intensity` at mid-grey.
4. Clipped to [0, 1].
It is labelled synthetic and aesthetic. It is never a film model.

```ts
export function createSyntheticFilmGrainTask(input: SyntheticFilmGrainInput, provider: ProcessingProvider): ProcessingTask<SyntheticFilmGrainOutput>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createUnsharpMaskTask

Unsharp masking: in + amount·(in − G_σ ⊗ in) where the detail exceeds the threshold.

```ts
export function createUnsharpMaskTask(input: UnsharpMaskInput, provider: ProcessingProvider): ProcessingTask<ProcessedRgbImage>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## NonLocalMeansInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NonLocalMeansInput {
  image: ProcessingRgbImage;
  /** Filtering parameter h (image units). */
  filteringParameter: number;
  /** Known noise standard deviation σ (image units); default 0. */
  noiseStandardDeviation?: number;
  /** Patch radius f (patch (2f+1)²); default 1. */
  patchRadius?: number;
  /** Search-window radius r ((2r+1)² candidates); default 5. */
  searchRadius?: number;
  maximumWorkingBytes?: number;
}
```

## ProcessedRgbImage

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProcessedRgbImage extends ProcessingRgbImage {
  provenance: ProcessingProvenance;
}
```

## SYNTHETIC_FILM_GRAIN_STREAM_ID

Random-stream id for synthetic grain. Different from every RAW charge, read-noise and fixed-pattern stream.

```ts
SYNTHETIC_FILM_GRAIN_STREAM_ID = 64 as const
```

## SyntheticFilmGrainInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SyntheticFilmGrainInput {
  /** Display-referred (encoded) RGB with values in [0, 1]. */
  image: ProcessingRgbImage;
  /** uint32 seed; equal seeds reproduce the grain exactly. */
  seedUint32: number;
  /** Grain standard deviation at mid-grey (value 0.5), in encoded units. */
  intensity: number;
  /** Spatial correlation σ of the grain in pixels; 0 = per-pixel white grain. Default 0.7. */
  grainSizePixels?: number;
  /** `monochrome` (default) adds one grain field to all channels; `per-channel` uses three. */
  mode?: "monochrome" | "per-channel";
  maximumWorkingBytes?: number;
}
```

## SyntheticFilmGrainOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SyntheticFilmGrainOutput extends ProcessedRgbImage {
  /** Always true: the grain is an aesthetic texture, not a physical film model. */
  syntheticAesthetic: true;
  physicalFilmModel: false;
  clippedSampleCount: number;
}
```

## UnsharpMaskInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface UnsharpMaskInput {
  image: ProcessingRgbImage;
  radiusSigmaPixels: number;
  amount: number;
  /** Detail magnitude below which a component is left unchanged; default 0. */
  threshold?: number;
  maximumWorkingBytes?: number;
}
```
