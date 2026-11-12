# capture/lossy-jpeg.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## LossyJpegImage

Decoded samples, interleaved by component within each line (line, x, component), 0..255.

```ts
export interface LossyJpegImage {
  width: number;
  height: number;
  components: number;
  /** "ycbcr-to-rgb" when three YCbCr components were converted to RGB; "none" otherwise. */
  colorTransform: "ycbcr-to-rgb" | "none";
  samples: Uint8Array;
}
```

## LossyJpegLimits

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LossyJpegLimits {
  /** Largest width x height x components accepted, checked before any sample buffer is allocated. */
  maximumSamples: number;
  /** An abbreviated table-specification stream (SOI, DQT/DHT, EOI) read before `bytes`, as DNG's JPEGTables tag (347) supplies. */
  tables?: Uint8Array;
}
```

## parseLossyJpeg

Decodes one DCT JPEG stream (see the module notes). Every length, count and table index is checked against the buffer.

```ts
export function parseLossyJpeg(bytes: Uint8Array, limits: LossyJpegLimits): LossyJpegImage;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
