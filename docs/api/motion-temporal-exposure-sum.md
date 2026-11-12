# motion/temporal-exposure-sum.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateTemporalExposureSum

Synchronous float64 reference for bounded grids. Use the image-kernel accelerator for large grids.

```ts
export function calculateTemporalExposureSum(input: TemporalExposureSumInput): { plan: TemporalExposureSumPlan; values: Float64Array };
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateTemporalExposureSumPlan

Validates the request (every value once) and returns its plan.

```ts
export function calculateTemporalExposureSumPlan(input: TemporalExposureSumInput): TemporalExposureSumPlan;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## TEMPORAL_EXPOSURE_SUM_LIMITS

`maximumPixels` is the default grid limit; a request may raise it with its own `maximumPixels`, up to `ceilingPixels`.

```ts
TEMPORAL_EXPOSURE_SUM_LIMITS = Object.freeze({
  maximumPixels: 24_000_000,
  ceilingPixels: FULL_RESOLUTION_CEILING_PIXELS,
  maximumDimension: 16_384,
  maximumTemporalSamples: 256,
  maximumDisplacementSites: 4_096,
  maximumRowWeights: 4_194_304,
  /** Keeps every float32 partial sum finite: 256 · 2^16 · 2^100 < 2^128. */
  maximumSampleMagnitude: 2 ** 100,
  maximumWeight: 2 ** 16
})
```

## TEMPORAL_EXPOSURE_SUM_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
TEMPORAL_EXPOSURE_SUM_SCHEMA_VERSION = "0.1.0" as const
```

## TemporalExposureSumInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface TemporalExposureSumInput {
  schemaVersion: typeof TEMPORAL_EXPOSURE_SUM_SCHEMA_VERSION;
  width: number;
  height: number;
  /** Row-major rate samples E₀ at site centres. Finite, non-negative, linear and additive (irradiance, photon or electron rate). */
  samples: Float32Array | Float64Array;
  /** Image displacement at each temporal node in grid sites, interleaved (dx₀, dy₀, dx₁, dy₁, …); +x right, +y down. */
  displacements: Float64Array;
  /** Quadrature weights `[k][row]` (nodes × height), finite and non-negative, for example seconds of each row's window near t_k. */
  rowWeights: Float32Array | Float64Array;
  boundary: "zero-outside-grid";
  /**
   * Optional opt-in grid limit for large images: an integer from 1 to `TEMPORAL_EXPOSURE_SUM_LIMITS.ceilingPixels`.
   * Default `TEMPORAL_EXPOSURE_SUM_LIMITS.maximumPixels` (24 000 000). It does not change the result.
   */
  maximumPixels?: number;
}
```

## TemporalExposureSumNode

One temporal node: integer source offset of the top-left tap and the four bilinear weights (float64).

```ts
export interface TemporalExposureSumNode {
  offsetX: number;
  offsetY: number;
  weights: readonly [number, number, number, number];
}
```

## TemporalExposureSumPlan

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface TemporalExposureSumPlan {
  width: number;
  height: number;
  nodeCount: number;
  nodes: readonly TemporalExposureSumNode[];
  maximumSampleMagnitude: number;
  /** Largest Σ_k w_k(y) over rows; the operator's weight sum for error composition. */
  maximumRowWeightSum: number;
  maximumWeight: number;
  /** True when every displacement is a whole number of sites (no interpolation). */
  integerDisplacements: boolean;
}
```
