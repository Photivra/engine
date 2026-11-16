# capture/jpeg-exif-writer.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## JPEG_EXIF_CAPTURE_SETTING_KEYS

The setting names `setJpegExifCaptureSettings` accepts; anything else is refused.

```ts
JPEG_EXIF_CAPTURE_SETTING_KEYS: readonly (keyof JpegExifCaptureSettings)[] = Object.freeze(["exposureTimeSeconds", "fNumber", "iso",
  "focalLengthMillimeters", "focalLengthIn35mmFilmMillimeters", "exposureBiasEv", "whiteBalance", "dateTaken", "software", "orientation"] as const)
```

## JpegExifCaptureSettings

The capture settings a JPEG's Exif block can carry. Each is optional; an omitted or null setting writes no tag. The names
match {@link ExifCaptureFields} where the tags are the same.

```ts
export interface JpegExifCaptureSettings {
  /** ExposureTime, seconds (positive). A reciprocal of a whole number (1/250) is written exactly as 1/N. */
  exposureTimeSeconds?: number | null;
  /** FNumber (positive). */
  fNumber?: number | null;
  /** The ISO setting, a positive integer: RecommendedExposureIndex, and PhotographicSensitivity (65535 when larger). */
  iso?: number | null;
  /** FocalLength, mm (the lens's actual focal length). */
  focalLengthMillimeters?: number | null;
  /** FocalLengthIn35mmFilm, a whole number of mm from 1 to 65535. */
  focalLengthIn35mmFilmMillimeters?: number | null;
  /** ExposureBiasValue, EV (APEX), from −64 to 64. */
  exposureBiasEv?: number | null;
  /** WhiteBalance: "auto" (0) or "manual" (1). */
  whiteBalance?: "auto" | "manual" | null;
  dateTaken?: JpegExifDateTaken | null;
  /** Software (printable ASCII, at most 255 characters). */
  software?: string | null;
  /** Orientation, 1–8 (TIFF 6.0); default 1, the stored orientation. */
  orientation?: number | null;
}
```

## JpegExifDateTaken

The date and time a photo was taken, as the camera's local clock states it.

```ts
export interface JpegExifDateTaken {
  /** Local date and time, "YYYY-MM-DDTHH:MM:SS" with optional fractional seconds (".123"; written as SubSecTimeOriginal). */
  local: string;
  /** The local clock's offset from UTC, "+HH:MM" or "-HH:MM" (OffsetTimeOriginal); omitted when unknown. */
  offset?: string;
}
```

## resolveJpegExifCaptureSettings

The capture settings an Exif block or a DNG import states ({@link ExifCaptureFields}, from `parsePhotoMetadata` or
`parseDngRawImage`'s `exif`), as settings for `setJpegExifCaptureSettings`: exposure time, f-number, ISO, focal length and 35 mm
focal length only. Nothing else is read.

```ts
export function resolveJpegExifCaptureSettings(fields: Pick<ExifCaptureFields, "exposureTimeSeconds" | "fNumber" | "iso" | "focalLengthMillimeters" | "focalLengthIn35mmFilmMillimeters">): JpegExifCaptureSettings;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## setJpegExifCaptureSettings

The JPEG with its Exif block replaced by one that holds only the given capture settings (module comment): every Exif APP1
segment is removed and the new one is placed after SOI (after a leading JFIF APP0). The frame size comes from the JPEG's
frame header. The image data and every other segment are kept byte for byte.

```ts
export function setJpegExifCaptureSettings(jpeg: Uint8Array, settings: JpegExifCaptureSettings): Uint8Array;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
