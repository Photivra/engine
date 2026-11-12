# capture/lossless-jpeg.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## LosslessJpegImage

Decoded lossless JPEG samples, interleaved by component within each line (line, x, component).

```ts
export interface LosslessJpegImage {
  /** Samples per line (X in the frame header). */
  width: number;
  /** Lines (Y in the frame header). */
  height: number;
  components: number;
  /** Sample precision P in bits, 2..16. */
  precision: number;
  predictor: number;
  pointTransform: number;
  samples: Uint16Array;
}
```

## LosslessJpegLimits

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LosslessJpegLimits {
  /** Largest width x height x components accepted. Checked before output is allocated. */
  maximumSamples: number;
  /**
   * DNG files with DNGVersion below 1.1.0.0 store 16 extra bits after the SSSS = 16 difference category
   * (DNG 1.7.1.0 specification, Compatibility Issue 2). Standard streams store none.
   */
  legacySixteenBitDifference?: boolean;
}
```

## parseLosslessJpeg

Decodes one lossless JPEG stream. Every length, count and table index is checked against the
buffer. Output is allocated only after the declared size passes `limits.maximumSamples`.

```ts
export function parseLosslessJpeg(bytes: Uint8Array, limits: LosslessJpegLimits): LosslessJpegImage;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
