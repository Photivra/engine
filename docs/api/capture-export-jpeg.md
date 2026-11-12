# capture/export-jpeg.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## EXPORT_JPEG_ENCODER_ID

Identifies the exact byte output of the baseline encoder.

Version 2 (engine 2.0.0) uses the fixed cosine table below instead of runtime `Math.cos`, and rounds
quantized coefficients half away from zero. Compared with version 1, bytes can differ only where a
coefficient before rounding was within about one ULP (unit in the last place) of a half-integer, or
was exactly a negative half-integer. The repository's test images are unchanged.

```ts
EXPORT_JPEG_ENCODER_ID = "photivra-baseline-jpeg-444-v2" as const
```

## JpegStripBits

The entropy-coded bits of consecutive blocks of one image, coded apart from the blocks before them (`encodeJpegStrip`):
the first block's quantized coefficients (3 × 64, natural order), whose DC differences need the block before; the other
blocks' bits, unstuffed, most-significant first; and the last block's DC values, which the next strip's first block needs.

```ts
export interface JpegStripBits { first: Float64Array; bits: Uint8Array; bitLength: number; blockCount: number; lastDc: Float64Array }
```
