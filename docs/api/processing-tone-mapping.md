# processing/tone-mapping.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createDurandDorseyToneMappingTask

Durand & Dorsey (2002) bilateral base/detail tone mapping. The fast bilateral filter is the paper's
piecewise-linear scheme:
1. Place intensity nodes i_j no more than σ_r apart.
2. For each node, compute J_j = (f ⊗ (g_r(I − i_j)·I)) / (f ⊗ g_r(I − i_j)) on a box-downsampled grid.
3. Upsample bilinearly, then interpolate linearly between the two nodes on either side of each
   full-resolution intensity.

```ts
export function createDurandDorseyToneMappingTask(input: DurandDorseyToneMappingInput, provider: ProcessingProvider): ProcessingTask<DurandDorseyToneMappingOutput>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createExposureFusionTask

Mertens, Kautz & Van Reeth (2007) exposure fusion with Laplacian-pyramid blending.

```ts
export function createExposureFusionTask(input: ExposureFusionInput, provider: ProcessingProvider): ProcessingTask<ExposureFusionOutput>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createReinhardGlobalToneMappingTask

Reinhard, Stark, Shirley & Ferwerda (2002) global photographic tone reproduction.

```ts
export function createReinhardGlobalToneMappingTask(input: ReinhardGlobalToneMappingInput, provider: ProcessingProvider): ProcessingTask<ReinhardGlobalToneMappingOutput>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## DurandDorseyToneMappingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DurandDorseyToneMappingInput {
  image: ProcessingRgbImage;
  inputColorSpace: ProcessingLinearColorSpace;
  /** Spatial σ in pixels; default 2% of the larger image side. */
  spatialSigmaPixels?: number;
  /** Range σ in log₁₀ luminance; default 0.4. */
  rangeSigmaLog10?: number;
  /** Target base-layer contrast ratio; default 5. */
  targetContrast?: number;
  /** Spatial downsampling factor of the fast bilateral filter; default max(1, round(σ_s/4)). */
  downsampleFactor?: number;
  maximumWorkingBytes?: number;
}
```

## DurandDorseyToneMappingOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DurandDorseyToneMappingOutput extends ToneMappedImage {
  /** Bilateral base layer (log₁₀ luminance) per pixel; −Infinity for pixels with luminance ≤ 0, which are excluded from the filter. */
  baseLog10: Float32Array;
  compressionFactor: number;
}
```

## ExposureFusionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExposureFusionInput {
  /** Display-referred (e.g. sRGB-encoded) frames with values nominally in [0, 1]. */
  frames: readonly ProcessingRgbImage[];
  contrastExponent?: number;
  saturationExponent?: number;
  wellExposednessExponent?: number;
  /** Well-exposedness Gaussian σ; default 0.2. */
  wellExposednessSigma?: number;
  /** Pyramid levels; default down to a 1-pixel side (at most 12). */
  pyramidLevels?: number;
  maximumWorkingBytes?: number;
}
```

## ExposureFusionOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExposureFusionOutput extends ProcessingRgbImage {
  /** Components clipped to [0, 1] after collapsing the blended pyramid. */
  clippedSampleCount: number;
  provenance: ProcessingProvenance;
}
```

## ReinhardGlobalToneMappingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ReinhardGlobalToneMappingInput {
  image: ProcessingRgbImage;
  inputColorSpace: ProcessingLinearColorSpace;
  /** Key value a; default 0.18. */
  key?: number;
  /** Smallest scaled luminance mapped to white; default the largest scaled luminance. */
  whiteLuminance?: number;
  /** δ in the log-average exp(mean(log(δ + L_w))); default 1e-6. */
  logAverageDelta?: number;
  maximumWorkingBytes?: number;
}
```

## ReinhardGlobalToneMappingOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ReinhardGlobalToneMappingOutput extends ToneMappedImage {
  logAverageLuminance: number;
  whiteLuminance: number;
}
```

## ToneMappedImage

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ToneMappedImage extends ProcessingRgbImage {
  /** Output components above 1 (left unclipped for the downstream gamut/encoding stage). */
  aboveOneSampleCount: number;
  provenance: ProcessingProvenance;
}
```
