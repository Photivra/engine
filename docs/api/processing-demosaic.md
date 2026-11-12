# processing/demosaic.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AhdDemosaicInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AhdDemosaicInput {
  plane: CfaMosaicPlane;
  /** CFA channel ids of the red, green and blue sites; output order is red, green, blue. */
  channelRoles: { red: string; green: string; blue: string };
  /**
   * Camera-linear RGB → CIE XYZ, used only for the homogeneity metric (in CIELAB). Default: the
   * sRGB/D65 matrix, so the plane is treated as linear sRGB for the metric. Output values are never
   * transformed.
   */
  cameraToXyz?: ColorMatrix3x3;
  maximumWorkingBytes?: number;
}
```

## AhdDemosaicOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AhdDemosaicOutput extends ProcessingRgbImage {
  /** Per pixel: 0 horizontal, 1 vertical, 2 equal homogeneity (average of both). */
  direction: Uint8Array;
  provenance: ProcessingProvenance;
}
```

## CfaMosaicPlane

A single-channel linear CFA mosaic in absolute native site coordinates (row-major, +Y down).

```ts
export interface CfaMosaicPlane {
  width: number;
  height: number;
  captureModeId: string;
  /** Periodic mosaic anchored at site (0, 0) of this plane. */
  colorSamplingProfile: SensorColorSamplingProfile;
  /** Linear values, e.g. black-subtracted normalized RAW or merged HDR radiance. */
  samples: Float32Array;
}
```

## CfaPlaneReconstructionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CfaPlaneReconstructionInput {
  plane: CfaMosaicPlane;
  phaseProfiles: readonly RawFrameReconstructionPhaseProfile[];
  /** Default `reject`: every neighbourhood must lie inside the plane. */
  borderHandling?: RawReconstructionBorderHandling;
  /** Output region in plane coordinates; default the whole plane. */
  region?: { x: number; y: number; width: number; height: number };
  maximumWorkingBytes?: number;
}
```

## CfaPlaneReconstructionOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CfaPlaneReconstructionOutput {
  width: number;
  height: number;
  region: { x: number; y: number; width: number; height: number };
  channelIds: readonly string[];
  /** Interleaved `channelIds.length` channels, row-major over the region. */
  data: Float32Array;
  borderHandling: RawReconstructionBorderHandling;
  provenance: ProcessingProvenance;
}
```

## createAhdDemosaicTask

Adaptive homogeneity-directed (AHD) demosaicing after Hirakawa & Parks, IEEE TIP 14(3), 2005:
1. green is interpolated separately along rows and columns with the 5-tap directional filter
   [−1/4, 1/2, 1/2, 1/2, −1/4] (bilinear green plus the own-channel second difference);
2. red and blue are filled from bilinearly interpolated colour differences (R−G, B−G) against each
   directional green, giving two full-colour candidates;
3. both candidates are converted to CIELAB. At each pixel, the homogeneity is the number of
   4-neighbours within adaptive luminance and chrominance tolerances ε_L, ε_C. Each tolerance is the
   smaller of the two directions' largest differences along their own direction;
4. homogeneity is summed over 3×3, and the more homogeneous candidate is chosen (a tie averages
   both).
The paper's optional iterative median step for reducing artifacts is not applied. Mirrored
(reflect-101) borders keep each site's Bayer channel. The method is non-linear: the output is not a
linear function of the mosaic.

```ts
export function createAhdDemosaicTask(input: AhdDemosaicInput, provider: ProcessingProvider): ProcessingTask<AhdDemosaicOutput>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createCfaPlaneReconstructionTask

Runs explicit linear reconstruction kernels, one per CFA phase, over a typed CFA plane.
- With `mirror` borders, a site outside the plane is read from its mirrored (reflect-101) position.
  This is accepted only if the mirrored site has the same CFA channel, which is always true for a
  2×2 Bayer pattern.
- With `reject`, out-of-plane reads throw (fail closed), like the reference resolver.
Values are linear and signed. No clamping, white balance or colour transform is applied.

```ts
export function createCfaPlaneReconstructionTask(input: CfaPlaneReconstructionInput, provider: ProcessingProvider): ProcessingTask<CfaPlaneReconstructionOutput>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
