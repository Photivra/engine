// SPDX-License-Identifier: Apache-2.0
// This product includes DNG technology under license by Adobe.

/**
 * 2.25.0 (#620): rewrites a DNG, optionally with edited development settings, keeping its raw image data and the tags needed
 * to develop it and leaving out personal data.
 *
 * Only tags on an explicit allowlist (`DNG_REWRITE_ALLOWED_TAGS`) are written: the raw image's layout and data, the camera
 * and color-profile tags of the DNG Specification 1.7.1.0, the Exif capture settings that `ExifCaptureFields` reads (Exif 2.32,
 * CIPA DC-008-2019) and the lens description. Everything else is left out, so a tag a camera adds later is dropped too. That
 * includes GPS data, serial numbers, the owner's name, Artist and Copyright, maker notes and DNGPrivateData, XMP, IPTC,
 * ImageUniqueID and RawDataUniqueID, the original raw file and its name, dates, previews, thumbnails, depth and gain maps,
 * enhanced images and Content Credentials.
 *
 * The raw image's strips or tiles are copied byte for byte (lossless JPEG, lossy JPEG and JPEG XL data are not re-encoded),
 * and the file keeps the source's byte order, so every copied value keeps its meaning. The written file has one IFD 0 that
 * holds the raw image, an Exif IFD, and the semantic masks as SubIFDs.
 *
 * Written independently from TIFF 6.0 and the DNG Specification 1.7.1.0; no third-party writer source was used.
 * @see docs/IMPORT_AND_PNG.md, "Rewriting a DNG without personal data".
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/** Schema version of {@link RewrittenDng}. */
export const DNG_REWRITE_SCHEMA_VERSION = "1.0.0" as const;
/** Limits of {@link serializeRewrittenDng}: the IFDs visited and the source size (a TIFF offset is 32-bit). */
export const DNG_REWRITE_LIMITS = /* @__PURE__ */ Object.freeze({ defaultMaximumIfds: 64, maximumIfds: 1024, maximumBytes: 4_294_967_295 });

/**
 * The tags {@link serializeRewrittenDng} may write, by tag id, with where each is read from:
 * - `raw`: the raw image IFD (NoiseProfile and the JPEG XL tags also IFD 0, as the DNG import reads them);
 * - `camera`: IFD 0, else the raw IFD (camera-level DNG tags, as the DNG import reads them);
 * - `exif`: the Exif IFD, else IFD 0, else the raw IFD (written to the Exif IFD);
 * - `mask`: a semantic-mask IFD.
 * Any tag not listed here is not written.
 */
export const DNG_REWRITE_ALLOWED_TAGS: Readonly<Record<"raw" | "camera" | "exif" | "mask", readonly number[]>> = /* @__PURE__ */ Object.freeze({
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
});

/** Edited development settings. Each replaces the source's value; an omitted one keeps it. */
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
export interface DngRewriteInput {
  /** The source DNG file (it must have DNGVersion). */
  bytes: Uint8Array;
  edits?: DngRewriteEdits;
  /** IFDs visited (main chain, SubIFDs and the Exif IFD). Default 64, at most 1024. */
  maximumIfds?: number;
}
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

/** Raw-IFD tags that the DNG import also reads from IFD 0. */
const RAW_ELSE_IFD0 = new Set([51041, 52553, 52554, 52555]);
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4] as const;
interface Entry { type: number; count: number; at: number; size: number }
type Ifd = Map<number, Entry>;
/** A tag to write: its type, count and value bytes in the output byte order. */
interface OutTag { id: number; type: number; count: number; data: Uint8Array }
function fail(message: string): never { throw new InvalidConfigurationError("serializeRewrittenDng: " + message); }

/**
 * Rewrites a DNG with only the allowlisted tags ({@link DNG_REWRITE_ALLOWED_TAGS}) and optional edited development settings.
 * The raw image data are copied unchanged. The source is untrusted: every offset, count and IFD chain is checked against the
 * buffer and the IFD limit, and an unsupported layout fails with `InvalidConfigurationError`. The result reads back through
 * `parseDngRawImage` / `importDngRawImage` with the same codes and development settings (apart from the edits).
 */
export function serializeRewrittenDng(input: DngRewriteInput): RewrittenDng {
  if (input === null || typeof input !== "object") fail("input must be an object.");
  for (const key of Object.keys(input)) if (!["bytes", "edits", "maximumIfds"].includes(key)) fail("unknown input field " + JSON.stringify(key) + ".");
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array)) fail("bytes must be a Uint8Array.");
  if (bytes.length > DNG_REWRITE_LIMITS.maximumBytes) fail("the file exceeds 4 GiB.");
  const maximumIfds = input.maximumIfds ?? DNG_REWRITE_LIMITS.defaultMaximumIfds;
  if (!Number.isSafeInteger(maximumIfds) || maximumIfds < 1 || maximumIfds > DNG_REWRITE_LIMITS.maximumIfds) fail("maximumIfds must be an integer from 1 to 1024.");
  const n = bytes.length;
  if (n < 8) fail("file is too short.");
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) fail("missing TIFF byte-order mark.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number): number => view.getUint16(o, little), u32 = (o: number): number => view.getUint32(o, little);
  if (u16(2) !== 42) fail("missing TIFF magic number (BigTIFF is not supported).");

  // Walk the IFD chain and SubIFDs, bounded, as the DNG import does.
  const visited = new Set<number>(), ifds: Ifd[] = [];
  const readIfd = (offset: number): { ifd: Ifd; next: number } => {
    if (offset < 8 || offset % 2 !== 0 || offset + 2 > n) fail("IFD offset out of range.");
    if (visited.has(offset)) fail("IFD loop or aliased IFD.");
    if (visited.size >= maximumIfds) fail("too many IFDs.");
    visited.add(offset);
    const count = u16(offset), end = offset + 2 + count * 12;
    if (count === 0 || end + 4 > n) fail("IFD exceeds the file.");
    const ifd: Ifd = new Map();
    for (let i = 0; i < count; i++) {
      const p = offset + 2 + i * 12, id = u16(p), type = u16(p + 2), c = u32(p + 4);
      if (ifd.has(id)) fail("duplicate tag in one IFD.");
      if (type < 1 || type > 13) continue;
      const size = TYPE_SIZES[type]! * c, at = size <= 4 ? p + 8 : u32(p + 8);
      if (at + size > n) fail("tag value exceeds the file.");
      ifd.set(id, { type, count: c, at, size });
    }
    return { ifd, next: u32(end) };
  };
  const walk = (offset: number, depth: number): void => {
    for (let next = offset; next !== 0;) {
      const { ifd, next: following } = readIfd(next);
      ifds.push(ifd);
      const sub = ifd.get(330);
      if (sub) {
        if (depth >= 3) fail("SubIFD nesting is too deep.");
        if ((sub.type !== 4 && sub.type !== 13) || sub.count > maximumIfds) fail("invalid SubIFDs tag.");
        for (let i = 0; i < sub.count; i++) walk(u32(sub.at + i * 4), depth + 1);
      }
      next = following;
    }
  };
  walk(u32(4), 0);
  if (ifds.length === 0) fail("the file has no IFD.");
  const ints = (e: Entry | undefined, maximumCount = 4096): number[] | null => {
    if (!e) return null;
    if (e.type !== 3 && e.type !== 4 && e.type !== 1 && e.type !== 13) fail("an integer tag has an unsupported field type.");
    if (e.count > maximumCount) fail("tag count exceeds its expected size.");
    const out: number[] = [];
    for (let i = 0; i < e.count; i++) out.push(e.type === 1 ? bytes[e.at + i]! : e.type === 3 ? u16(e.at + i * 2) : u32(e.at + i * 4));
    return out;
  };
  const one = (ifd: Ifd, id: number, fallback: number): number => {
    const e = ifd.get(id);
    if (e && e.count !== 1) fail("tag " + id + " must have one value.");
    return ints(e)?.[0] ?? fallback;
  };

  const ifd0 = ifds[0]!;
  if (!ifd0.has(50706)) fail("the file has no DNGVersion; only DNG files are rewritten.");
  const raw = ifds.find((ifd) => one(ifd, 254, 0) === 0 && [32803, 34892].includes(one(ifd, 262, -1)));
  if (!raw) fail("no primary CFA or LinearRaw image IFD.");
  const masks = ifds.filter((ifd) => one(ifd, 254, 0) === 0x10004 && one(ifd, 262, 0) === 52527);
  let exifIfd: Ifd | null = null;
  const exifPointer = ifd0.get(34665);
  if (exifPointer) {
    const at = ints(exifPointer);
    if (!at || at.length !== 1) fail("invalid Exif IFD pointer.");
    exifIfd = readIfd(at[0]!).ifd;
  }
  let gpsIfd: Ifd | null = null;
  const gpsPointer = ifd0.get(34853);
  if (gpsPointer) {
    // Read only to list its tags as omitted; nothing from it is written.
    const at = ints(gpsPointer);
    try { gpsIfd = at && at.length === 1 ? readIfd(at[0]!).ifd : null; } catch (error) { if (!(error instanceof InvalidConfigurationError)) throw error; }
  }

  // Color planes and the active area, for validating the edits.
  const planeColors = ints(raw.get(50710));
  const colorPlanes = one(raw, 262, 0) === 32803 ? (planeColors?.length ?? 3) : one(raw, 277, 1);
  const width = one(raw, 256, 0), height = one(raw, 257, 0), area = ints(raw.get(50829)) ?? [0, 0, height, width];
  if (width < 1 || height < 1 || area.length !== 4 || area[0]! >= area[2]! || area[1]! >= area[3]! || area[2]! > height || area[3]! > width) fail("invalid image size or ActiveArea.");
  const activeWidth = area[3]! - area[1]!, activeHeight = area[2]! - area[0]!;

  const enc = createEncoder(little), edits = parseEdits(input.edits, colorPlanes, activeWidth, activeHeight, enc);
  // Tags to copy are chosen first and copied only after the size check below.
  let copied = 0;
  const select = (ids: readonly number[], lookup: (id: number) => Entry | undefined): [number, Entry][] => {
    const out: [number, Entry][] = [];
    for (const id of ids) { const e = lookup(id); if (e) { out.push([id, e]); copied += e.size; } }
    return out;
  };
  const copy = (picked: [number, Entry][]): OutTag[] => picked.map(([id, e]) => ({ id, type: e.type, count: e.count, data: bytes.slice(e.at, e.at + e.size) }));
  const replaced = new Set(edits.map((t) => t.id)), removed = new Set<number>();
  if (input.edits?.asShotNeutral) removed.add(50729);
  if (input.edits?.asShotWhiteXy) removed.add(50728);
  if (input.edits?.baselineExposure !== undefined) removed.add(51109);
  if (input.edits?.defaultCrop) { removed.add(50719); removed.add(50720); }
  const mainPicked = [
    ...select(DNG_REWRITE_ALLOWED_TAGS.raw.filter((id) => !replaced.has(id) && !removed.has(id)), (id) => raw.get(id) ?? (RAW_ELSE_IFD0.has(id) ? ifd0.get(id) : undefined)),
    ...select(DNG_REWRITE_ALLOWED_TAGS.camera.filter((id) => !replaced.has(id) && !removed.has(id)), (id) => ifd0.get(id) ?? raw.get(id))
  ];
  const exifPicked = select(DNG_REWRITE_ALLOWED_TAGS.exif, (id) => exifIfd?.get(id) ?? ifd0.get(id) ?? raw.get(id));

  /**
   * The strips or tiles of an image IFD, bounded by the file. The tables must hold one entry per strip (RowsPerStrip rows) or per
   * tile of the grid, as the DNG import requires, so the written file reads back.
   */
  const ranges: [number, number][] = [];
  const chunksOf = (ifd: Ifd): { tiled: boolean; data: Uint8Array[] } => {
    const tiled = ifd.has(324), w = one(ifd, 256, 0), h = one(ifd, 257, 0);
    const tileWidth = tiled ? one(ifd, 322, 0) : w, tileLength = tiled ? one(ifd, 323, 0) : Math.min(h, one(ifd, 278, 0xffffffff));
    if (w < 1 || h < 1 || tileWidth < 1 || tileLength < 1) fail("invalid image, strip or tile size.");
    const count = Math.ceil(w / tileWidth) * Math.ceil(h / tileLength);
    const offsets = ints(ifd.get(tiled ? 324 : 273), count), counts = ints(ifd.get(tiled ? 325 : 279), count);
    if (!offsets || !counts || offsets.length !== count || counts.length !== count) fail("strip or tile tables do not match the image layout.");
    return { tiled, data: offsets.map((o, i) => {
      if (o + counts[i]! > n) fail("strip or tile data exceeds the file.");
      if (counts[i]! > 0) ranges.push([o, o + counts[i]!]);
      return bytes.subarray(o, o + counts[i]!);
    }) };
  };
  const mainChunks = chunksOf(raw);
  const maskPicked = masks.map((m) => ({ picked: select(DNG_REWRITE_ALLOWED_TAGS.mask, (id) => m.get(id)), chunks: chunksOf(m) }));
  // No two strips or tiles (of the raw image and the masks) may share bytes.
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i]![0] < ranges[i - 1]![1]) fail("strips or tiles overlap.");
  // 2.28.0: each copied value and each strip or tile has its own bytes in a file, so together they fit in it; more means tags
  // share bytes, and the rewrite would copy them once per tag.
  let total = copied;
  for (const [start, end] of ranges) total += end - start;
  if (total > n) fail("tag values and strip or tile data add up to more than the file: tags share bytes.");
  const main: OutTag[] = [...copy(mainPicked), ...edits, enc.long(254, [0])];
  const exif = copy(exifPicked);
  if (exif.length && !exif.some((t) => t.id === 36864)) exif.push({ id: 36864, type: 7, count: 4, data: new TextEncoder().encode("0232") });
  const maskSpecs = maskPicked.map((m) => ({ tags: [...copy(m.picked), enc.long(254, [0x10004])], chunks: m.chunks }));
  const out = pack(little, { tags: main, chunks: mainChunks }, exif, maskSpecs);

  const written = new Set([...main, ...exif, ...maskSpecs.flatMap((m) => m.tags)].map((t) => t.id));
  const omitted = new Set<number>();
  for (const ifd of [...ifds.filter((d) => d === ifd0 || d === raw || masks.includes(d)), ...(exifIfd ? [exifIfd] : []), ...(gpsIfd ? [gpsIfd] : [])])
    for (const id of ifd.keys()) if (!written.has(id) && ![273, 279, 324, 325, 330, 34665, 254].includes(id)) omitted.add(id);
  const omittedImages = ifds.filter((d) => d !== raw && !masks.includes(d)).map((d) => ({ newSubFileType: one(d, 254, 0), width: one(d, 256, 0), height: one(d, 257, 0) }));
  const sorted = (tags: readonly OutTag[]): number[] => tags.map((t) => t.id).sort((a, b) => a - b);
  return {
    schemaVersion: DNG_REWRITE_SCHEMA_VERSION, mediaType: "image/dng", bytes: out, byteOrder: little ? "little-endian" : "big-endian",
    writtenTags: { ifd0: [...new Set([...sorted(main), ...[273, 279, 324, 325].filter((id) => raw.has(id)), ...(exif.length ? [34665] : []), ...(masks.length ? [330] : [])])].sort((a, b) => a - b),
      exif: sorted(exif), masks: [...new Set(maskSpecs.flatMap((m) => sorted(m.tags)))].sort((a, b) => a - b) },
    omittedTags: [...omitted].sort((a, b) => a - b), omittedImages, maskCount: masks.length
  };
}

/** Value encoders in the output byte order. */
interface Encoder {
  long(id: number, values: readonly number[]): OutTag;
  short(id: number, values: readonly number[]): OutTag;
  /**
   * RATIONAL or SRATIONAL with the largest power-of-ten denominator (at most 10⁹) that keeps the numerator in range, as the
   * engine's TIFF writer does; the relative rounding error is at most 5 × 10⁻¹⁰ for values of 1 or more.
   */
  rational(id: number, signed: boolean, values: readonly number[]): OutTag;
}
function createEncoder(little: boolean): Encoder {
  const integers = (id: number, type: 3 | 4, values: readonly number[]): OutTag => {
    const size = type === 3 ? 2 : 4, data = new Uint8Array(values.length * size), v = new DataView(data.buffer);
    values.forEach((x, i) => { if (size === 2) v.setUint16(i * 2, x, little); else v.setUint32(i * 4, x, little); });
    return { id, type, count: values.length, data };
  };
  return {
    long: (id, values) => integers(id, 4, values),
    short: (id, values) => integers(id, 3, values),
    rational(id, signed, values): OutTag {
      const data = new Uint8Array(values.length * 8), v = new DataView(data.buffer), limit = signed ? 2147483647 : 4294967295;
      values.forEach((x, i) => {
        const den = Math.min(1e9, 10 ** Math.floor(Math.log10(limit / Math.max(1, Math.abs(x))))), num = Math.round(x * den);
        if (!Number.isFinite(x) || den < 1 || Math.abs(num) > limit || (x !== 0 && num === 0)) fail("a value is outside the range a TIFF rational can hold.");
        if (signed) v.setInt32(i * 8, num, little); else v.setUint32(i * 8, num, little);
        v.setUint32(i * 8 + 4, den, little);
      });
      return { id, type: signed ? 10 : 5, count: values.length, data };
    }
  };
}

function parseEdits(edits: DngRewriteEdits | undefined, planes: number, activeWidth: number, activeHeight: number, enc: Encoder): OutTag[] {
  if (edits === undefined) return [];
  if (edits === null || typeof edits !== "object") fail("edits must be an object.");
  for (const key of Object.keys(edits)) if (!["asShotNeutral", "asShotWhiteXy", "baselineExposure", "defaultCrop", "orientation"].includes(key)) fail("unknown edits field " + JSON.stringify(key) + ".");
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const out: OutTag[] = [];
  if (edits.asShotNeutral !== undefined && edits.asShotWhiteXy !== undefined) fail("edits take asShotNeutral or asShotWhiteXy, not both.");
  if (edits.asShotNeutral !== undefined) {
    const v = edits.asShotNeutral;
    if (!Array.isArray(v) || v.length !== planes || !v.every((x) => finite(x) && x > 0 && x <= 1000)) fail("edits.asShotNeutral needs one positive value (at most 1000) per color plane (" + planes + ").");
    out.push(enc.rational(50728, false, v));
  }
  if (edits.asShotWhiteXy !== undefined) {
    const w = edits.asShotWhiteXy as { x?: unknown; y?: unknown } | null;
    if (w === null || typeof w !== "object" || Object.keys(w).some((k) => k !== "x" && k !== "y") || !finite(w.x) || !finite(w.y) || !(w.x > 0) || !(w.y > 0) || w.x + w.y >= 1) fail("edits.asShotWhiteXy must be a chromaticity { x, y } with x, y > 0 and x + y < 1.");
    out.push(enc.rational(50729, false, [w.x, w.y]));
  }
  if (edits.baselineExposure !== undefined) {
    if (!finite(edits.baselineExposure) || Math.abs(edits.baselineExposure) > 10) fail("edits.baselineExposure must be a number of stops from -10 to 10.");
    out.push(enc.rational(50730, true, [edits.baselineExposure]));
  }
  if (edits.defaultCrop !== undefined) {
    const c = edits.defaultCrop as Partial<Record<string, unknown>> | null;
    if (c === null || typeof c !== "object" || Object.keys(c).some((k) => !["x", "y", "width", "height"].includes(k))) fail("edits.defaultCrop must be { x, y, width, height }.");
    const { x, y, width, height } = c;
    if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || x < 0 || y < 0 || !(width > 0) || !(height > 0) || x + width > activeWidth || y + height > activeHeight)
      fail("edits.defaultCrop must lie inside the active area (" + activeWidth + " x " + activeHeight + ").");
    const whole = [x, y, width, height].every(Number.isInteger);
    out.push(whole ? enc.long(50719, [x, y]) : enc.rational(50719, false, [x, y]), whole ? enc.long(50720, [width, height]) : enc.rational(50720, false, [width, height]));
  }
  if (edits.orientation !== undefined) {
    if (!Number.isInteger(edits.orientation) || edits.orientation < 1 || edits.orientation > 8) fail("edits.orientation must be an integer from 1 to 8.");
    out.push(enc.short(274, [edits.orientation]));
  }
  return out;
}

interface ImageSpec { tags: OutTag[]; chunks: { tiled: boolean; data: Uint8Array[] } }
/**
 * Lays out the file: header, IFD 0 (the raw image) and its values, the Exif IFD, the mask IFDs, then the image data, each
 * part on a 4-byte boundary. Offsets are 32-bit.
 */
function pack(little: boolean, main: ImageSpec, exif: OutTag[], masks: ImageSpec[]): Uint8Array {
  const pad = (x: number): number => (x + 3) & ~3;
  const dirSize = (tags: OutTag[]): number => 2 + tags.length * 12 + 4 + tags.reduce((s, t) => s + (t.data.length > 4 ? pad(t.data.length) : 0), 0);
  // Placeholder pointer tags, sized now and filled once the layout is known.
  const withPointers = (spec: ImageSpec, extra: OutTag[]): OutTag[] => {
    const k = spec.chunks.data.length, tiled = spec.chunks.tiled;
    return [...spec.tags, ...extra, { id: tiled ? 324 : 273, type: 4, count: k, data: new Uint8Array(k * 4) }, { id: tiled ? 325 : 279, type: 4, count: k, data: new Uint8Array(k * 4) }]
      .sort((a, b) => a.id - b.id);
  };
  const mainTags = withPointers(main, [...(exif.length ? [{ id: 34665, type: 4, count: 1, data: new Uint8Array(4) }] : []),
    ...(masks.length ? [{ id: 330, type: 4, count: masks.length, data: new Uint8Array(masks.length * 4) }] : [])]);
  const exifTags = [...exif].sort((a, b) => a.id - b.id), maskTags = masks.map((m) => withPointers(m, []));
  for (const tags of [mainTags, exifTags, ...maskTags]) if (new Set(tags.map((t) => t.id)).size !== tags.length) fail("duplicate tag in an output IFD.");
  let at = 8;
  const mainAt = at; at += dirSize(mainTags);
  const exifAt = exif.length ? at : 0; if (exif.length) at += dirSize(exifTags);
  const maskAt = maskTags.map((t) => { const o = at; at += dirSize(t); return o; });
  const place = (chunks: Uint8Array[]): number[] => chunks.map((c) => { const o = at; at = pad(at + c.length); return o; });
  const mainChunks = place(main.chunks.data), maskChunks = masks.map((m) => place(m.chunks.data));
  if (at > DNG_REWRITE_LIMITS.maximumBytes) fail("the written file would exceed 4 GiB.");
  const out = new Uint8Array(at), v = new DataView(out.buffer);
  out.set(little ? [0x49, 0x49] : [0x4d, 0x4d]); v.setUint16(2, 42, little); v.setUint32(4, mainAt, little);
  const setLongs = (tags: OutTag[], id: number, values: readonly number[]): void => {
    const t = tags.find((x) => x.id === id)!, d = new DataView(t.data.buffer);
    values.forEach((x, i) => d.setUint32(i * 4, x, little));
  };
  const fillPointers = (tags: OutTag[], spec: ImageSpec, offsets: number[]): void => {
    setLongs(tags, spec.chunks.tiled ? 324 : 273, offsets);
    setLongs(tags, spec.chunks.tiled ? 325 : 279, spec.chunks.data.map((c) => c.length));
  };
  fillPointers(mainTags, main, mainChunks);
  if (exif.length) setLongs(mainTags, 34665, [exifAt]);
  if (masks.length) setLongs(mainTags, 330, maskAt);
  masks.forEach((m, i) => fillPointers(maskTags[i]!, m, maskChunks[i]!));
  const writeDir = (offset: number, tags: OutTag[]): void => {
    v.setUint16(offset, tags.length, little);
    let data = offset + 2 + tags.length * 12 + 4;
    tags.forEach((t, i) => {
      const p = offset + 2 + i * 12;
      v.setUint16(p, t.id, little); v.setUint16(p + 2, t.type, little); v.setUint32(p + 4, t.count, little);
      if (t.data.length <= 4) out.set(t.data, p + 8);
      else { v.setUint32(p + 8, data, little); out.set(t.data, data); data += pad(t.data.length); }
    });
    v.setUint32(offset + 2 + tags.length * 12, 0, little);
  };
  writeDir(mainAt, mainTags);
  if (exif.length) writeDir(exifAt, exifTags);
  maskTags.forEach((t, i) => writeDir(maskAt[i]!, t));
  main.chunks.data.forEach((c, i) => out.set(c, mainChunks[i]!));
  masks.forEach((m, i) => m.chunks.data.forEach((c, k) => out.set(c, maskChunks[i]![k]!)));
  return out;
}
