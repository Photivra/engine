# capture/dng-import.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## DNG_IMPORT_LIMITS

Upper bound for `maximumPixels`: 200 MP (megapixels) of 16-bit codes is 400 MB. `maximumBytes` bounds the estimated peak memory
of the import (default 1 GiB, at most 4 GiB).

```ts
DNG_IMPORT_LIMITS = Object.freeze({ defaultMaximumPixels: 64_000_000, maximumPixels: 200_000_000, defaultMaximumIfds: 64, maximumIfds: 1024,
  defaultMaximumBytes: 1_073_741_824, maximumBytes: 4_294_967_296 })
```

## DNG_IMPORT_SCHEMA_VERSION

1.1.0 (2.22.0): lossy JPEG and JPEG XL raw data, opcode lists, profile maps, semantic masks, `scale`, `assumptions`.

```ts
DNG_IMPORT_SCHEMA_VERSION = "1.1.0" as const
```

## DngImportAsyncInput

{@link importDngRawImage}'s input: {@link DngImportInput} plus the JPEG XL decoder a 52546 file needs.

```ts
export interface DngImportAsyncInput extends DngImportInput {
  /** Decodes one JPEG XL strip or tile to PNG (`createJxlOxideDngDecoder`). Needed only for JPEG XL raw data or masks. */
  jpegXlDecoder?: DngJpegXlDecoder;
}
```

## DngImportInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngImportInput {
  bytes: Uint8Array;
  /** Pixel-count limit (width x height), checked before any decode allocation. Default 64 000 000, at most 200 000 000. */
  maximumPixels?: number;
  /** Total IFDs (main chain plus SubIFDs) visited. Default 64, at most 1024. */
  maximumIfds?: number;
  /**
   * Estimated peak memory of the import, bytes (the codes, the largest strip or tile's decode buffers and its decoder's working
   * memory; see docs/IMPORT_AND_PNG.md, "Memory"), checked before any image allocation. Default 1 073 741 824 (1 GiB), at most 4 GiB.
   */
  maximumBytes?: number;
  /**
   * "half": a half-size preview of a LinearRaw image, each output pixel the rounded mean of a 2 × 2 block of stored codes, decoded
   * strip by strip (a quarter of the codes' memory). Areas, crops and black-level deltas are halved; CFA images are refused.
   * Default "full".
   */
  size?: "full" | "half";
}
```

## importDngRawImage

{@link parseDngRawImage} for every supported compression, JPEG XL included: each JPEG XL strip or tile goes to `jpegXlDecoder` in
turn (one at a time, so only one tile's decoder memory is held), and its PNG is read at the DNG's bit depth (jpeg-xl-tiles.ts).

```ts
export async function importDngRawImage(input: DngImportAsyncInput): Promise<ImportedDngRaw>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## ImportedDngBlackLevel

Black level (the code for zero light) pattern, from BlackLevel, BlackLevelRepeatDim and BlackLevelDeltaH/V. Origin is the active-area top-left.

```ts
export interface ImportedDngBlackLevel {
  repeatRows: number;
  repeatColumns: number;
  /** Row-column-sample order, length repeatRows x repeatColumns x samplesPerPixel. */
  values: number[];
  /** Per active-area column offset, or null when absent (all zeros). */
  deltaH: number[] | null;
  /** Per active-area row offset, or null when absent (all zeros). */
  deltaV: number[] | null;
}
```

## ImportedDngCfa

Repeating CFA pattern. Its origin is the top-left corner of `activeArea` (DNG 1.7.1.0, PhotometricInterpretation).

```ts
export interface ImportedDngCfa {
  repeatRows: number;
  repeatColumns: number;
  /** Row-major plane indices into `planeColors`, length repeatRows x repeatColumns. */
  pattern: number[];
  /** CFAPlaneColor: 0 red, 1 green, 2 blue, 3 cyan, 4 magenta, 5 yellow, 6 white. Default [0, 1, 2]. */
  planeColors: number[];
}
```

## ImportedDngRaw

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImportedDngRaw {
  schemaVersion: typeof DNG_IMPORT_SCHEMA_VERSION;
  byteOrder: "little-endian" | "big-endian";
  /** DNGVersion bytes, or null for a TIFF-EP file without DNG tags. */
  dngVersion: [number, number, number, number] | null;
  make: string | null;
  model: string | null;
  uniqueCameraModel: string | null;
  /** TIFF/Exif Orientation 1..8 (default 1). Codes are returned in stored, not oriented, order. */
  orientation: number;
  width: number;
  height: number;
  samplesPerPixel: number;
  bitsPerSample: number;
  compression: "uncompressed" | "lossless-jpeg" | "lossy-jpeg" | "jpeg-xl";
  /**
   * True when the raw data went through a lossy coder: lossy JPEG always; JPEG XL when JXLDistance (52553) is above 0 or absent
   * (the file then does not say it is lossless).
   */
  lossySource: boolean;
  /** 1, or 0.5 for a `size: "half"` preview (every geometry field is already halved). */
  scale: 1 | 0.5;
  photometricInterpretation: "cfa" | "linear-raw";
  /** Stored raw codes, row-major then sample, length width x height x samplesPerPixel. */
  codes: Uint16Array;
  cfa: ImportedDngCfa | null;
  /** LinearizationTable when present; not applied to `codes`. */
  linearizationTable: Uint16Array | null;
  blackLevel: ImportedDngBlackLevel;
  /** WhiteLevel per sample (default 2^bitsPerSample − 1). */
  whiteLevel: number[];
  /** ActiveArea as a rectangle (default the whole image). */
  activeArea: ImportedDngRect;
  /** DefaultCropOrigin/Size relative to the active-area origin; may be fractional (RATIONAL). */
  defaultCrop: ImportedDngRect;
  /** XYZ → camera (reference) matrices, row-major colorPlanes x 3, or null. */
  colorMatrix1: number[] | null;
  colorMatrix2: number[] | null;
  /** CalibrationIlluminant1/2 (Exif LightSource code), or null when absent. */
  calibrationIlluminant1: number | null;
  calibrationIlluminant2: number | null;
  /** AsShotNeutral in camera (reference) coordinates, or null. */
  asShotNeutral: number[] | null;
  /** RawDataUniqueID as 32 lowercase hex digits, or null. */
  rawDataUniqueId: string | null;
  /** ForwardMatrix1/2 (white-balanced camera → XYZ D50), row-major 3 x colorPlanes, or null. */
  forwardMatrix1: number[] | null;
  forwardMatrix2: number[] | null;
  /** BaselineExposure plus BaselineExposureOffset (stops), or null when neither is present. */
  baselineExposure: number | null;
  /** OpcodeList1/2/3 (raw IFD), parsed but not applied (`developDngStageImage` applies them), or null when absent. */
  opcodeList1: DngOpcode[] | null;
  opcodeList2: DngOpcode[] | null;
  opcodeList3: DngOpcode[] | null;
  /** ProfileGainTableMap2 (IFD 0), else ProfileGainTableMap (raw IFD), or null; applied by `applyDngProfileGainTableMap`. */
  profileGainTableMap: DngProfileGainTableMap | null;
  /** RGBTables (IFD 0), or null; applied by `applyDngRgbTables`. */
  rgbTables: DngRgbTables | null;
  /** Decoded semantic masks, for `applyDngRgbTables`. */
  semanticMasks: ImportedDngSemanticMask[];
  /** What the import did not do: tags present but not returned or applied, masks not decoded, lossy sources, inferred layouts. */
  assumptions: string[];
}
```

## ImportedDngRect

Half-open raster rectangle in stored-image pixel coordinates (+X right, +Y down).

```ts
export interface ImportedDngRect { x: number; y: number; width: number; height: number }
```

## ImportedDngSemanticMask

A decoded semantic mask (DNG 1.6 SemanticName, NewSubFileType 0x10004, PhotometricInterpretation 52527).

```ts
export interface ImportedDngSemanticMask {
  name: string;
  /** SemanticInstanceID, or null. */
  instanceId: string | null;
  width: number;
  height: number;
  /** Mask values 0..1 (code / (2^bits − 1)), row-major. */
  data: Float32Array;
}
```

## parseDngRawImage

Parse one DNG or TIFF-EP file and decode its primary CFA or LinearRaw image (the first IFD with NewSubFileType 0 and
PhotometricInterpretation 32803 or 34892, in IFD-chain then SubIFD order), synchronously.

Supported raw data: Compression 1 at 8..16 bits/sample (8 bits as bytes, 16 bits in the file byte order, other depths packed
MSB-first with byte-aligned rows, per DNG BitsPerSample), Compression 7 lossless Huffman JPEG (T.81 Annex H) and Compression 34892
8-bit lossy JPEG (T.81 sequential DCT), in strips or tiles, chunky planar configuration only. JPEG XL (52546) needs
{@link importDngRawImage}; a JPEG XL semantic mask is skipped here and named in `assumptions`.

```ts
export function parseDngRawImage(input: DngImportInput): ImportedDngRaw;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
