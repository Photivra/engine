# output/png-encoder.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## PNG_ENCODER_ID

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PNG_ENCODER_ID = "photivra-png-rgb-v1" as const
```

## PNG_ENCODER_LIMITS

Limits, checked before allocation. 100 MP (megapixels) of 16-bit RGB is about 600 MB of filtered scanlines.
`maximumPixels` is the default; a request may raise it with its own `maximumPixels`, up to `ceilingPixels`.

```ts
PNG_ENCODER_LIMITS = Object.freeze({ maximumDimension: 65535, maximumPixels: 100_000_000, ceilingPixels: FULL_RESOLUTION_CEILING_PIXELS,
  maximumIccProfileBytes: 4_000_000 })
```

## PngCicpPrimaries

ITU-T H.273 ColourPrimaries: bt709 = 1 (also sRGB), display-p3 = 12 (P3 primaries with D65 white; W3C CSS Color 4, also SMPTE EG 432-1), bt2020 = 9 (BT.2020).

```ts
export type PngCicpPrimaries = "bt709" | "display-p3" | "bt2020";
```

## PngCicpTransfer

ITU-T H.273 TransferCharacteristics: bt709 = 1, linear = 8, srgb = 13 (sRGB). PQ (16) and HLG (18) are not offered in 2.0.

```ts
export type PngCicpTransfer = "bt709" | "linear" | "srgb";
```

## PngColourEncoding

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type PngColourEncoding =
  | { kind: "srgb"; renderingIntent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric" }
  | { kind: "icc"; profileName: string; profile: Uint8Array }
  | { kind: "cicp"; primaries: PngCicpPrimaries; transfer: PngCicpTransfer; fullRange: boolean };
```

## PngContentLightLevel

Content light level in cd/m² (W3C PNG cLLI; ITU-T H.265 content light level SEI; also CTA-861.3); 0 means unknown.

```ts
export interface PngContentLightLevel {
  maximumContentLightLevelCdPerSquareMeter: number;
  maximumFrameAverageLightLevelCdPerSquareMeter: number;
}
```

## PngEncodeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PngEncodeInput {
  width: number;
  height: number;
  bitDepth: 8 | 16;
  /** Interleaved RGB code values, row-major; Uint8Array for 8-bit, Uint16Array for 16-bit. */
  samples: Uint8Array | Uint16Array;
  colourEncoding: PngColourEncoding;
  masteringDisplay?: PngMasteringDisplay;
  contentLightLevel?: PngContentLightLevel;
  /** Default "fixed-huffman". */
  compression?: "stored" | "fixed-huffman";
  /** PNG filter type 0..4 for every row, or the specification's minimum-sum-of-absolute-differences heuristic. Default "adaptive". */
  filter?: "none" | "sub" | "up" | "average" | "paeth" | "adaptive";
  /**
   * Optional opt-in pixel limit: an integer from 1 to `PNG_ENCODER_LIMITS.ceilingPixels`. Default
   * `PNG_ENCODER_LIMITS.maximumPixels` (100 000 000). It does not change the encoded bytes.
   */
  maximumPixels?: number;
}
```

## PngMasteringDisplay

Mastering display colour volume (W3C PNG mDCV; ITU-T H.265 Annex D SEI; also SMPTE ST 2086): CIE 1931 xy chromaticities and luminance in cd/m².

```ts
export interface PngMasteringDisplay {
  redXy: readonly [number, number];
  greenXy: readonly [number, number];
  blueXy: readonly [number, number];
  whiteXy: readonly [number, number];
  maximumLuminanceCdPerSquareMeter: number;
  minimumLuminanceCdPerSquareMeter: number;
}
```

## serializePngImage

Encode an RGB still image as PNG (colour type 2, no interlace). Samples are written unchanged; 16-bit
samples are stored big-endian as PNG requires. Throws `InvalidConfigurationError` for any invalid or
inconsistent field before allocating the scanline buffer.

```ts
export function serializePngImage(input: PngEncodeInput): Uint8Array;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
