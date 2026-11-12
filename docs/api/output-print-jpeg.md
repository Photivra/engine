# output/print-jpeg.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## composePrintJpegStrips

Joins the strips of a 1:1 Print JPEG (`createPrintJpegStrip`), covering the image top to bottom in order, into its file:
the same bytes `createPrintJpegTask` writes for the plan and the same source pixels. No source is read, so the output's
`providerReads` is 0.

```ts
export function composePrintJpegStrips(input:PrintJpegInput,strips:readonly PrintJpegStrip[]):PrintJpegOutput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createPrintJpegStrip

Codes rows of a 1:1 Print JPEG (output size equal to the crop) apart from the rows before them, so a large file's strips
can be written on separate workers. `strip.y` is a multiple of 8 and `strip.height` a multiple of 8 unless the strip ends at
the image's bottom; `strip.samples` are those crop rows' 8-bit sRGB RGB, crop-wide. `composePrintJpegStrips` joins strips that
cover the image, in order, into the bytes `createPrintJpegTask` writes for the same plan and source pixels.

```ts
export function createPrintJpegStrip(input:PrintJpegInput,strip:PrintJpegStripInput):PrintJpegStrip;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createPrintJpegTask

Creates the export task. Filtering weights each source pixel by its exact area overlap, after decoding the declared 8-bit SDR source.

```ts
export function createPrintJpegTask(input:PrintJpegInput,provider:PrintJpegProvider):PrintJpegTask;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parsePrintJpegInput

Validates the input only. Source detail, perception and printer suitability are checked by separate APIs.

```ts
export function parsePrintJpegInput(input:PrintJpegInput):PrintJpegInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PRINT_JPEG_LIMITS

Admission limits. `maximumPixels` is the default source limit; a request may raise it with its own
`maximumPixels`, up to `ceilingPixels`. A raised limit raises the `maximumEncodedBytes` ceiling in proportion
(256 000 000 bytes per 24 000 000 source pixels).

```ts
PRINT_JPEG_LIMITS=Object.freeze({maximumPixels:24_000_000,ceilingPixels:FULL_RESOLUTION_CEILING_PIXELS,maximumDimension:16_384,
  maximumEncodedBytes:256_000_000,maximumProviderReads:1_000_000})
```

## PRINT_JPEG_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PRINT_JPEG_SCHEMA_VERSION="0.2.0" as const
```

## PrintJpegInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintJpegInput {
  source:PrintJpegSource;
  /** Integer crop in the oriented output source image, not in sensor or CFA (colour filter array) coordinates. */
  crop:RasterRect;
  outputWidth:number;outputHeight:number;
  quantizationStep:number;
  maximumEncodedBytes:number;
  /**
   * Maximum provider `readTile` calls. The task reads each crop pixel exactly once, in tiles of at most
   * 256 x 32 pixels aligned to the crop origin, so it needs ceil(crop.height/32) x ceil(crop.width/256)
   * reads; a smaller budget fails before the first read.
   */
  maximumProviderReads:number;
  /**
   * Optional physical print density in pixels per inch (1..65535) from the caller's print plan. When present,
   * EXIF IFD0 records XResolution = YResolution = this value as a RATIONAL with ResolutionUnit = 2 (inches),
   * and JFIF APP0 records units = 1 with the nearest integer density (JFIF density fields are uint16).
   * When omitted no physical size is claimed: JFIF keeps units = 0 with a 1:1 aspect ratio. Exif 2.32 makes
   * the IFD0 resolution tags mandatory and says an unknown resolution "shall" be recorded as 72 dpi, so IFD0
   * carries 72/1 with ResolutionUnit = 2; that is the standard's unknown-resolution marker, not a print size.
   */
  pixelsPerInch?:number;
  /**
   * Optional opt-in source pixel limit for large images: an integer from 1 to `PRINT_JPEG_LIMITS.ceilingPixels`.
   * Default `PRINT_JPEG_LIMITS.maximumPixels` (24 000 000). When given it is recorded in the XMP export plan, like the
   * other admission budgets; the image data are unchanged.
   */
  maximumPixels?:number;
}
```

## PrintJpegOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintJpegOutput {
  schemaVersion:typeof PRINT_JPEG_SCHEMA_VERSION;
  input:PrintJpegInput;
  mediaType:"image/jpeg";
  bytes:Uint8Array;
  iccProfileVersion:typeof SRGB_ICC_PROFILE_VERSION;
  width:number;height:number;
  resampling:"exact-area-average-in-decoded-linear-light";
  sourceStage:"post-SDR-8-bit-quantization";
  digitalUpscalingApplied:false;
  sourceBytesVerified:false;
  /** Provider calls made: ceil(crop.height/32) x ceil(crop.width/256) tiles, each crop pixel read once. */
  providerReads:number;
  /** Byte behaviour of the baseline encoder that produced `bytes`. */
  encoderId:typeof EXPORT_JPEG_ENCODER_ID;
}
```

## PrintJpegProvider

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintJpegProvider {
  readTile(request:Readonly<PrintJpegTileRequest>,signal:AbortSignal):Promise<PrintJpegTile>;
  yieldControl(signal:AbortSignal):Promise<void>;
}
```

## PrintJpegSource

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintJpegSource {
  captureId:string;imageStateId:string;artifactId:string;sha256:string;
  width:number;height:number;
  encoding:"encoded-srgb-8-rgb";
}
```

## PrintJpegStrip

A strip of a 1:1 Print JPEG's coded blocks (`createPrintJpegStrip`), for `composePrintJpegStrips`.

```ts
export interface PrintJpegStrip {readonly y:number;readonly height:number;readonly width:number;readonly quantizationStep:number;readonly bits:JpegStripBits}
```

## PrintJpegStripInput

Rows of a 1:1 Print JPEG for `createPrintJpegStrip`: crop rows `y` to `y + height` (relative to the crop), crop-wide RGB.

```ts
export interface PrintJpegStripInput {y:number;height:number;samples:Uint8Array}
```

## PrintJpegTask

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintJpegTask {
  readonly state:NativeRawTaskState;
  run():Promise<void>;cancel():void;dispose():void;takeOutput():PrintJpegOutput;
}
```

## PrintJpegTile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintJpegTile extends PrintJpegTileRequest {samples:Uint8Array}
```

## PrintJpegTileRequest

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintJpegTileRequest {source:PrintJpegSource;x:number;y:number;width:number;height:number}
```
