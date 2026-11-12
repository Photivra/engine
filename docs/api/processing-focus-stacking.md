# processing/focus-stacking.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createFocusStackTask

Laplacian-energy focus stacking with Laplacian-pyramid blending.

```ts
export function createFocusStackTask(input: FocusStackInput, provider: ProcessingProvider): ProcessingTask<FocusStackOutput>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## FocusStackInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FocusStackInput {
  /** Registered frames of one scene, ordered by focus distance (any consistent order). */
  frames: readonly ProcessingRgbImage[];
  /** σ (pixels) of the Gaussian window averaging the squared Laplacian; default 2. */
  sharpnessSigmaPixels?: number;
  /** Pyramid levels for seam-free blending; default down to a 1-pixel side (at most 10). */
  pyramidLevels?: number;
  maximumWorkingBytes?: number;
}
```

## FocusStackOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FocusStackOutput extends ProcessingRgbImage {
  /** Index of the sharpest frame per pixel (the blending selection). */
  selectedFrameIndex: Uint8Array;
  provenance: ProcessingProvenance;
}
```
