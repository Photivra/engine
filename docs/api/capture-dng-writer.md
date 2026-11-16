# capture/dng-writer.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## DNG_REWRITE_ALLOWED_TAGS

The tags {@link serializeRewrittenDng} may write, by tag id, with where each is read from:
- `raw`: the raw image IFD (NoiseProfile and the JPEG XL tags also IFD 0, as the DNG import reads them);
- `camera`: IFD 0, else the raw IFD (camera-level DNG tags, as the DNG import reads them);
- `exif`: the Exif IFD, else IFD 0, else the raw IFD (written to the Exif IFD);
- `mask`: a semantic-mask IFD.
Any tag not listed here is not written.

```ts
DNG_REWRITE_ALLOWED_TAGS: Readonly<Record<"raw" | "camera" | "exif" | "mask", readonly number[]>> = Object.freeze({
  // Layout and data of the raw image (TIFF 6.0, TIFF/EP, DNG 1.7.1.0 "Raw IFD" tags).
  raw: Object.freeze([256, 257, 258, 259, 262, 277, 278, 284, 322, 323, 339, 347, 33421, 33422, 50710, 50711, 50712, 50713, 50714, 50715, 50716, 50717,
    50718, 50719, 50720, 50733, 50737, 50738, 50780, 50829, 50830, 50975, 51008, 51009, 51022, 51041, 52525, 52547, 52553, 52554, 52555]),
  // DNG versions, make and model, orientation and the color profile (DNG 1.7.1.0 "IFD 0" tags).
  camera: Object.freeze([271, 272, 274, 305, 50706, 50707, 50708, 50721, 50722, 50723, 50724, 50725, 50726, 50727, 50728, 50729, 50730, 50731, 50732, 50734,
    50778, 50779, 50879, 50931, 50932, 50936, 50937, 50938, 50939, 50940, 50941, 50964, 50965, 50981, 50982, 51107, 51108, 51109, 51110, 51125,
    52529, 52531, 52532, 52533, 52534, 52535, 52543, 52544, 52551, 52552]),
  // Exif capture settings (the tags ExifCaptureFields reads), ExposureBiasValue, and the lens's specification, make and model.
  exif: Object.freeze([33434, 33437, 34855, 34864, 34865, 34866, 34867, 36864, 37380, 37386, 37396, 40962, 40963, 41486, 41487, 41488, 41988, 41989,
    42034, 42035, 42036, 42080, 42081]),
  // Semantic masks (DNG 1.6): layout, data, SemanticName, SemanticInstanceID and MaskSubArea.
  mask: Object.freeze([256, 257, 258, 259, 262, 277, 278, 284, 322, 323, 339, 347, 52526, 52528, 52536])
})
```

## DNG_REWRITE_LIMITS

Limits of {@link serializeRewrittenDng}: the IFDs visited and the source size (a TIFF offset is 32-bit).

```ts
DNG_REWRITE_LIMITS = Object.freeze({ defaultMaximumIfds: 64, maximumIfds: 1024, maximumBytes: 4_294_967_295 })
```

## DNG_REWRITE_SCHEMA_VERSION

Schema version of {@link RewrittenDng}.

```ts
DNG_REWRITE_SCHEMA_VERSION = "1.0.0" as const
```

## DngRewriteEdits

Edited development settings. Each replaces the source's value; an omitted one keeps it.

```ts
export interface DngRewriteEdits {
  /** AsShotNeutral (50728): one positive value per color plane. Replaces AsShotWhiteXY, which is then left out. */
  asShotNeutral?: readonly number[];
  /** AsShotWhiteXY (50729): the white point as a CIE xy chromaticity. Replaces AsShotNeutral, which is then left out. */
  asShotWhiteXy?: { x: number; y: number };
  /**
   * BaselineExposure (50730), stops, from −10 to 10: written as the total, and BaselineExposureOffset (51109) is left out, so
   * the import's `baselineExposure` (their sum) reads back this value.
   */
  baselineExposure?: number;
  /** DefaultCropOrigin and DefaultCropSize (50719, 50720), relative to the active area's top-left, inside the active area. */
  defaultCrop?: { x: number; y: number; width: number; height: number };
  /** Orientation (274), 1 to 8. */
  orientation?: number;
}
```

## DngRewriteInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRewriteInput {
  /** The source DNG file (it must have DNGVersion). */
  bytes: Uint8Array;
  edits?: DngRewriteEdits;
  /** IFDs visited (main chain, SubIFDs and the Exif IFD). Default 64, at most 1024. */
  maximumIfds?: number;
}
```

## RewrittenDng

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RewrittenDng {
  schemaVersion: typeof DNG_REWRITE_SCHEMA_VERSION;
  mediaType: "image/dng";
  bytes: Uint8Array;
  /** The source's byte order, kept. */
  byteOrder: "little-endian" | "big-endian";
  /** Tag ids written, by directory. */
  writtenTags: { ifd0: number[]; exif: number[]; masks: number[] };
  /** Tag ids present in the source's image, Exif and GPS directories that were not written (values never returned). */
  omittedTags: number[];
  /** Source images not written (previews, thumbnails, depth, gain-map and enhanced images), by NewSubFileType. */
  omittedImages: { newSubFileType: number; width: number; height: number }[];
  /** Semantic masks written. */
  maskCount: number;
}
```

## serializeRewrittenDng

Rewrites a DNG with only the allowlisted tags ({@link DNG_REWRITE_ALLOWED_TAGS}) and optional edited development settings.
The raw image data are copied unchanged. The source is untrusted: every offset, count and IFD chain is checked against the
buffer and the IFD limit, and an unsupported layout fails with `InvalidConfigurationError`. The result reads back through
`parseDngRawImage` / `importDngRawImage` with the same codes and development settings (apart from the edits).

```ts
export function serializeRewrittenDng(input: DngRewriteInput): RewrittenDng;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
