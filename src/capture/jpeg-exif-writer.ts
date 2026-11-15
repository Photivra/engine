// SPDX-License-Identifier: Apache-2.0

/**
 * 2.25.0 (#621): writes a JPEG's Exif block from an allowlist of capture settings. The settings mirror the shared Exif
 * capture fields (src/capture/exif-capture-fields.ts): the same names for the same tags, so `parsePhotoMetadata` and the DNG
 * import read back what was written, plus the exposure bias, white balance, date taken and Software.
 *
 * Only the tags below are written (Exif 2.32, CIPA DC-008-2019; tag ids and types from its Tables 4–5), together with the
 * mandatory tags of a compressed primary image that `packExportJpegExif` adds (resolution 72 dpi meaning "unknown",
 * YCbCrPositioning, ExifVersion, FlashpixVersion, ComponentsConfiguration, ColorSpace sRGB, PixelX/YDimension):
 * - IFD 0: Orientation (274), Software (305);
 * - Exif IFD: ExposureTime (33434), FNumber (33437), PhotographicSensitivity (34855), SensitivityType (34864) = 2
 *   (recommended exposure index) with RecommendedExposureIndex (34866), as the engine's own exports write ISO;
 *   DateTimeOriginal (36867), OffsetTimeOriginal (36881), SubSecTimeOriginal (37521), ExposureBiasValue (37380), FocalLength
 *   (37386), WhiteBalance (41987), FocalLengthIn35mmFilm (41989).
 * Every existing Exif APP1 segment of the JPEG is replaced, so nothing from an earlier Exif block (make, model, serial numbers,
 * GPS, maker notes, thumbnails) is carried over. Other segments (JFIF, XMP, ICC profile) and the image data are unchanged.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireAllowlistedRecord } from "../core/record-validation.js";
import type { ExifCaptureFields } from "./exif-capture-fields.js";
import { exportTiffAscii, exportTiffNumbers, exportTiffRationals, packExportJpegExif, type ExportTiffTag } from "./export-tiff.js";

/** The date and time a photo was taken, as the camera's local clock states it. */
export interface JpegExifDateTaken {
  /** Local date and time, "YYYY-MM-DDTHH:MM:SS" with optional fractional seconds (".123"; written as SubSecTimeOriginal). */
  local: string;
  /** The local clock's offset from UTC, "+HH:MM" or "-HH:MM" (OffsetTimeOriginal); omitted when unknown. */
  offset?: string;
}

/**
 * The capture settings a JPEG's Exif block can carry. Each is optional; an omitted or null setting writes no tag. The names
 * match {@link ExifCaptureFields} where the tags are the same.
 */
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

/** The setting names `setJpegExifCaptureSettings` accepts; anything else is refused. */
export const JPEG_EXIF_CAPTURE_SETTING_KEYS: readonly (keyof JpegExifCaptureSettings)[] = /* @__PURE__ */ Object.freeze(["exposureTimeSeconds", "fNumber", "iso",
  "focalLengthMillimeters", "focalLengthIn35mmFilmMillimeters", "exposureBiasEv", "whiteBalance", "dateTaken", "software", "orientation"] as const);

function fail(message: string): never { throw new InvalidConfigurationError("setJpegExifCaptureSettings: " + message); }

/** A RATIONAL or SRATIONAL with the smallest of a few exact denominators, else the shared power-of-ten fraction. */
function rational(id: number, signed: boolean, value: number): ExportTiffTag {
  const exact = (n: number, d: number): ExportTiffTag => {
    const data = new Uint8Array(8), view = new DataView(data.buffer);
    if (signed) view.setInt32(0, n, true); else view.setUint32(0, n, true);
    view.setUint32(4, d, true);
    return { id, type: signed ? 10 : 5, count: 1, data };
  };
  if (!signed && value > 0 && value < 1) {
    const reciprocal = Math.round(1/value);
    if (reciprocal <= 4294967295 && Math.abs(1/reciprocal - value) <= 1e-12*value) return exact(1, reciprocal);
  }
  for (const d of [1, 2, 3, 6, 10, 100]) {
    const n = Math.round(value*d);
    if (Math.abs(n/d - value) <= 1e-12*Math.max(1, Math.abs(value)) && Math.abs(n) <= 2147483647) return exact(n, d);
  }
  return exportTiffRationals(id, signed, [value]);
}

function positive(value: unknown, name: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0) || value > maximum) fail(name + " must be a positive number up to " + maximum + ".");
  return value;
}

function wholeNumber(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(name + " must be an integer from " + minimum + " to " + maximum + ".");
  return value;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** DateTimeOriginal, SubSecTimeOriginal and OffsetTimeOriginal from a validated date. */
function dateTags(value: unknown): ExportTiffTag[] {
  const d = requireAllowlistedRecord(value, ["local", "offset"], "setJpegExifCaptureSettings: dateTaken must be { local, offset? }.");
  const match = typeof d.local === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(d.local) : null;
  if (!match) fail("dateTaken.local must be \"YYYY-MM-DDTHH:MM:SS\" with optional fractional seconds.");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (month === 2 && !leap ? 28 : DAYS_IN_MONTH[month-1]!) || hour > 23 || minute > 59 || second > 59) {
    fail("dateTaken.local is not a valid date and time.");
  }
  const tags = [exportTiffAscii(36867, (d.local as string).slice(0, 19).replaceAll("-", ":").replace("T", " "))];
  if (match[7] !== undefined) tags.push(exportTiffAscii(37521, match[7]));
  if (d.offset !== undefined) {
    const offset = typeof d.offset === "string" ? /^[+-](\d{2}):(\d{2})$/.exec(d.offset) : null;
    if (!offset || Number(offset[1]) > 14 || Number(offset[2]) > 59) fail("dateTaken.offset must be \"+HH:MM\" or \"-HH:MM\" (at most 14 hours).");
    tags.push(exportTiffAscii(36881, d.offset));
  }
  return tags;
}

/** Internal: the IFD 0 and Exif IFD tags of validated settings (allowlist only). */
export function jpegExifCaptureTags(settings: JpegExifCaptureSettings): { main: ExportTiffTag[]; exif: ExportTiffTag[] } {
  const s = requireAllowlistedRecord(settings, JPEG_EXIF_CAPTURE_SETTING_KEYS, "setJpegExifCaptureSettings: settings must be an object with only the documented keys.");
  const set = (key: string): boolean => s[key] !== undefined && s[key] !== null;
  const main: ExportTiffTag[] = [exportTiffNumbers(274, 3, [set("orientation") ? wholeNumber(s.orientation, "orientation", 1, 8) : 1])];
  if (set("software")) {
    if (typeof s.software !== "string" || s.software.length > 255 || !/^[\x20-\x7e]*$/.test(s.software)) fail("software must be printable ASCII of at most 255 characters.");
    main.push(exportTiffAscii(305, s.software));
  }
  const exif: ExportTiffTag[] = [exportTiffNumbers(40961, 3, [1])];
  if (set("exposureTimeSeconds")) exif.push(rational(33434, false, positive(s.exposureTimeSeconds, "exposureTimeSeconds", 4294967295)));
  if (set("fNumber")) exif.push(rational(33437, false, positive(s.fNumber, "fNumber", 4294967295)));
  if (set("iso")) {
    const iso = wholeNumber(s.iso, "iso", 1, 4294967295);
    exif.push(exportTiffNumbers(34855, 3, [Math.min(iso, 65535)]), exportTiffNumbers(34864, 3, [2]), exportTiffNumbers(34866, 4, [iso]));
  }
  if (set("dateTaken")) exif.push(...dateTags(s.dateTaken));
  if (set("exposureBiasEv")) {
    const bias = s.exposureBiasEv;
    if (typeof bias !== "number" || !Number.isFinite(bias) || Math.abs(bias) > 64) fail("exposureBiasEv must be a number from -64 to 64.");
    exif.push(rational(37380, true, Object.is(bias, -0) ? 0 : bias));
  }
  if (set("focalLengthMillimeters")) exif.push(rational(37386, false, positive(s.focalLengthMillimeters, "focalLengthMillimeters", 4294967295)));
  if (set("whiteBalance")) {
    if (s.whiteBalance !== "auto" && s.whiteBalance !== "manual") fail("whiteBalance must be \"auto\" or \"manual\".");
    exif.push(exportTiffNumbers(41987, 3, [s.whiteBalance === "auto" ? 0 : 1]));
  }
  if (set("focalLengthIn35mmFilmMillimeters")) exif.push(exportTiffNumbers(41989, 3, [wholeNumber(s.focalLengthIn35mmFilmMillimeters, "focalLengthIn35mmFilmMillimeters", 1, 65535)]));
  return { main, exif };
}

/**
 * The JPEG with its Exif block replaced by one that holds only the given capture settings (module comment): every Exif APP1
 * segment is removed and the new one is placed after SOI (after a leading JFIF APP0). The frame size comes from the JPEG's
 * frame header. The image data and every other segment are kept byte for byte.
 * @throws InvalidConfigurationError for a setting outside the allowlist or its range, or bytes that are not a JPEG with a frame
 * header before its first scan.
 */
export function setJpegExifCaptureSettings(jpeg: Uint8Array, settings: JpegExifCaptureSettings): Uint8Array {
  if (!(jpeg instanceof Uint8Array)) fail("jpeg must be a Uint8Array.");
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) fail("jpeg does not start with SOI.");
  const { main, exif } = jpegExifCaptureTags(settings);
  const kept: [number, number][] = [];
  let offset = 2, width = 0, height = 0, insertAfter = 2, scan = -1;
  for (let segments = 0; scan < 0; segments++) {
    if (segments > 4096) fail("too many segments before the first scan.");
    if (offset + 4 > jpeg.length || jpeg[offset] !== 0xff) fail("malformed marker segment at byte " + offset + ".");
    const marker = jpeg[offset+1]!;
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) fail("unexpected marker 0x" + marker.toString(16) + " before the first scan.");
    const length = jpeg[offset+2]! << 8 | jpeg[offset+3]!, end = offset + 2 + length;
    if (length < 2 || end > jpeg.length) fail("truncated marker segment at byte " + offset + ".");
    if (marker === 0xda) { scan = offset; break; }
    const isExif = marker === 0xe1 && length >= 8 && jpeg[offset+4] === 0x45 && jpeg[offset+5] === 0x78 && jpeg[offset+6] === 0x69 && jpeg[offset+7] === 0x66 && jpeg[offset+8] === 0 && jpeg[offset+9] === 0;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8) fail("truncated frame header.");
      height = jpeg[offset+5]! << 8 | jpeg[offset+6]!; width = jpeg[offset+7]! << 8 | jpeg[offset+8]!;
    }
    const isJfif = marker === 0xe0 && segments === 0 && length >= 7 && jpeg[offset+4] === 0x4a && jpeg[offset+5] === 0x46 && jpeg[offset+6] === 0x49 && jpeg[offset+7] === 0x46 && jpeg[offset+8] === 0;
    if (!isExif) kept.push([offset, end]);
    if (isJfif) insertAfter = end;
    offset = end;
  }
  if (width < 1 || height < 1) fail("no frame header (with a nonzero size) before the first scan.");
  const block = packExportJpegExif(main, exif, { pixelWidth: width, pixelHeight: height });
  if (block.length + 8 > 65535) fail("the Exif block exceeds one APP1 segment.");
  const app1 = new Uint8Array(block.length + 10);
  app1.set([0xff, 0xe1, (block.length + 8) >> 8, (block.length + 8) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  app1.set(block, 10);
  const parts: Uint8Array[] = [jpeg.subarray(0, 2)];
  for (const [start, end] of kept) if (end <= insertAfter) parts.push(jpeg.subarray(start, end));
  parts.push(app1);
  for (const [start, end] of kept) if (end > insertAfter) parts.push(jpeg.subarray(start, end));
  parts.push(jpeg.subarray(scan));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * The capture settings an Exif block or a DNG import states ({@link ExifCaptureFields}, from `parsePhotoMetadata` or
 * `parseDngRawImage`'s `exif`), as settings for `setJpegExifCaptureSettings`: exposure time, f-number, ISO, focal length and 35 mm
 * focal length only. Nothing else is read.
 */
export function jpegExifCaptureSettingsFromFields(fields: Pick<ExifCaptureFields, "exposureTimeSeconds" | "fNumber" | "iso" | "focalLengthMillimeters" | "focalLengthIn35mmFilmMillimeters">): JpegExifCaptureSettings {
  if (fields === null || typeof fields !== "object") throw new InvalidConfigurationError("jpegExifCaptureSettingsFromFields: fields must be ExifCaptureFields.");
  const iso = fields.iso, focal35 = fields.focalLengthIn35mmFilmMillimeters;
  return { exposureTimeSeconds: fields.exposureTimeSeconds ?? null, fNumber: fields.fNumber ?? null, focalLengthMillimeters: fields.focalLengthMillimeters ?? null,
    iso: typeof iso === "number" && Number.isSafeInteger(iso) && iso > 0 ? iso : null,
    focalLengthIn35mmFilmMillimeters: typeof focal35 === "number" && Number.isSafeInteger(focal35) && focal35 >= 1 && focal35 <= 65535 ? focal35 : null };
}
