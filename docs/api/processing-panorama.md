# processing/panorama.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createPanoramaTask

Stitches frames with known rotations onto a cylindrical or equirectangular canvas.

```ts
export function createPanoramaTask(input: PanoramaInput, provider: ProcessingProvider): ProcessingTask<PanoramaOutput>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PanoramaCanvas

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PanoramaCanvas {
  projection: "equirectangular" | "cylindrical";
  width: number;
  height: number;
  /** [min, max] longitude θ in radians across the canvas columns (left → right). */
  longitudeRangeRad: readonly [number, number];
  /** [min, max] latitude φ in radians (bottom → top); cylindrical rows are linear in tan φ. */
  latitudeRangeRad: readonly [number, number];
}
```

## PanoramaFrame

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PanoramaFrame {
  image: ProcessingRgbImage;
  /** Rectilinear focal length in pixels (same pixel pitch on both axes). */
  focalLengthPixels: number;
  /** Principal point in pixel coordinates (pixel centres at i + 0.5); default the image centre. */
  principalPointPixels?: { x: number; y: number };
  /** Camera rotation relative to the reference camera: pitch/yaw/roll radians, engine sign convention. */
  rotationRad: { pitch: number; yaw: number; roll: number };
}
```

## PanoramaInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PanoramaInput {
  frames: readonly PanoramaFrame[];
  canvas: PanoramaCanvas;
  /** Default `feather`. */
  blending?: "feather" | "multi-band";
  /** Default `gain` (Brown & Lowe 2007); `none` keeps frame intensities. */
  exposureCompensation?: "none" | "gain";
  /** Normalized intensity noise σ_N; default 0.04 (≈ 10/255, the published 8-bit value). */
  gainNoiseSigma?: number;
  /** Gain prior σ_g; default 0.1. */
  gainPriorSigma?: number;
  /** Multi-band pyramid levels; default min(4, auto). Coarse bands wider than the frame overlap mix
   * low frequencies that were normalized differently, so keep 2^(levels−1) well below the overlap width. */
  pyramidLevels?: number;
  maximumWorkingBytes?: number;
}
```

## PanoramaOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PanoramaOutput extends ProcessingRgbImage {
  /** Number of frames covering each canvas pixel; 0 = uncovered (value 0). */
  coverage: Uint8Array;
  /** Gain applied to each frame (1 when compensation is off). */
  gains: readonly number[];
  provenance: ProcessingProvenance;
}
```
