// SPDX-License-Identifier: Apache-2.0

/**
 * Browser-safe reader of the capture metadata in JPEG and HEIC/HEIF files, from their headers only: no pixel data is decoded.
 *
 * It returns the Exif capture settings (the same fields and rules as the DNG import's `exif`), make, model, Software,
 * Orientation and the image size, and a list of the extra images and annotations the file declares, by type and size: the
 * Exif thumbnail, JPEG Multi-Picture Format entries, HEIF auxiliary images (auxC types such as depth, alpha, mattes and HDR gain
 * maps), HEIF thumbnails and derived tone-map items, and gain-map, depth and embedded-image markers in XMP.
 *
 * Written independently from free specifications: ITU-T T.81 (JPEG markers), Exif 2.32 (CIPA DC-008-2019: APP1, the IFD
 * structure and tags; Exif 3.0, CIPA DC-008-2023, for the UTF-8 type), CIPA DC-007-2009 (Multi-Picture Format), Adobe XMP
 * Specification Part 3 (APP1 and extended XMP), ISO/IEC 14496-12 (ISO base media file format boxes: ftyp, meta, hdlr, pitm,
 * iinf/infe, iloc, iref, iprp/ipco/ipma, idat), the HEIF item properties (ispe, auxC, irot, imir) and the tmap gain-map item as
 * the freely published AVIF specification v1.2.0 (Alliance for Open Media) uses them, the Android Ultra HDR format v1.1 (the ISO
 * 21496-1 APP2 identifier), and the published XMP namespaces listed in {@link PHOTO_METADATA_XMP_NAMESPACES}. No third-party
 * reader source was used; THIRD_PARTY.md lists the sources.
 *
 * Input is untrusted. Every offset, length, count and box size is checked against the bytes before it is read; there is no
 * recursion (the box and IFD levels read are fixed), every loop is bounded by {@link PHOTO_METADATA_LIMITS}, and nothing larger
 * than {@link PHOTO_METADATA_LIMITS}.maximumItemDataBytes is copied. A malformed or truncated part is named in `assumptions`
 * and skipped; only input that is not a JPEG or HEIF file fails, with `InvalidConfigurationError`. The bytes may be a prefix of
 * the file (the first few hundred kilobytes usually hold every header); what lies beyond them is reported as truncated.
 *
 * Never read: maker notes, the GPS IFD, the Interoperability IFD, and XMP property values other than the container item
 * semantics and lengths listed below.
 * @see docs/IMPORT_AND_PNG.md, "JPEG and HEIF metadata", for the fields, limits and what is not read.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputKeys } from "../core/record-validation.js";
import { resolveExifCaptureFields, type ExifCaptureFields } from "./exif-capture-fields.js";

export const PHOTO_METADATA_SCHEMA_VERSION = "1.0.0" as const;
/** The bounds every read is checked against. */
export const PHOTO_METADATA_LIMITS = /* @__PURE__ */ Object.freeze({
  /** JPEG marker segments walked per image (the primary and each Multi-Picture Format entry). */
  maximumJpegSegments: 4096,
  /** Boxes walked per HEIF box level. */
  maximumBoxes: 4096,
  /** HEIF items, references and property associations read. */
  maximumItems: 4096,
  /** Entries in one Exif or MPF IFD. */
  maximumIfdEntries: 1024,
  /** Multi-Picture Format entries read. */
  maximumMpfEntries: 64,
  /** Bytes copied for one HEIF Exif or XMP item, or an assembled extended XMP packet. */
  maximumItemDataBytes: 4_194_304,
  /** XMP namespaces returned per packet. */
  maximumXmpNamespaces: 256
});

/**
 * Published XMP namespaces the reader classifies, with the kind of annotation each declares. Any other namespace is still
 * listed in `xmpNamespaces`.
 */
export const PHOTO_METADATA_XMP_NAMESPACES: Readonly<Record<string, "gain-map" | "depth-map" | "embedded-image" | "container">> = /* @__PURE__ */ Object.freeze({
  /** Adobe gain map (hdrgm), as Android Ultra HDR also uses it. */
  "http://ns.adobe.com/hdr-gain-map/1.0/": "gain-map",
  /** Google depth map (GDepth). */
  "http://ns.google.com/photos/1.0/depthmap/": "depth-map",
  /** Google Dynamic Depth depth map. */
  "http://ns.google.com/photos/dd/1.0/depthmap/": "depth-map",
  /** Google embedded image (GImage). */
  "http://ns.google.com/photos/1.0/image/": "embedded-image",
  /** Google container (Container:Directory), whose items are read for their Semantic and Length. */
  "http://ns.google.com/photos/1.0/container/": "container"
});
const CONTAINER_ITEM_NAMESPACE = "http://ns.google.com/photos/1.0/container/item/";
/** The APP2 identifier of ISO 21496-1 gain-map metadata in a JPEG. */
const ISO_21496_APP2 = "urn:iso:std:iso:ts:21496:-1\0";

export interface PhotoMetadataInput {
  /** The file, or a prefix of it that holds the headers. */
  bytes: Uint8Array;
}

/** The Exif block's capture settings ({@link ExifCaptureFields}, as the DNG import returns them) and its IFD 0 identity tags. */
export interface PhotoExif extends ExifCaptureFields {
  /** Make (0x010F), or null. */
  make: string | null;
  /** Model (0x0110), or null. */
  model: string | null;
  /** Software (0x0131), or null. */
  software: string | null;
  /** Orientation (0x0112), 1..8, or null when absent or out of range. */
  orientation: number | null;
}

/** What an extra image is. */
export type PhotoExtraImageKind = "thumbnail" | "large-thumbnail" | "gain-map" | "tone-mapped" | "depth" | "disparity" | "alpha" | "matte" | "panorama-frame"
  | "multi-angle-frame" | "other";

/** One extra image the file declares. Its pixels are not decoded. */
export interface PhotoExtraImage {
  /**
   * Where it is declared: the Exif IFD 1 thumbnail, a Multi-Picture Format entry, a HEIF auxiliary image (auxC), a HEIF
   * thumbnail (a thmb reference), a HEIF tone-map derived item (tmap, ISO 21496-1) or its gain-map input, or another HEIF
   * image item that is not the primary image or one of its tiles.
   */
  source: "exif-thumbnail" | "jpeg-mpf" | "heif-auxiliary" | "heif-thumbnail" | "heif-tone-map" | "heif-gain-map-input" | "heif-image";
  kind: PhotoExtraImageKind;
  /**
   * How `kind` was decided: "specification" (a code or URN the format's specification defines), "name" (words in a maker's
   * auxiliary-type URN, such as "hdrgainmap" or "matte"), "xmp" (a published namespace in the image's own XMP) or "none" (kind
   * is "other").
   */
  kindBasis: "specification" | "name" | "xmp" | "none";
  /** The declared type as stored: the auxC URN, the MPF type code ("0x020002"), the HEIF item type ("hvc1", "tmap") or "jpeg". */
  type: string;
  width: number | null;
  height: number | null;
  /** Stored bytes (the MPF entry size, the thumbnail length or the HEIF item's extents), or null when not stated. */
  bytes: number | null;
}

/** A marker in the metadata that declares a rendition or a map, without its data being read. */
export interface PhotoAnnotation {
  /**
   * "gain-map", "depth-map" or "embedded-image" (a namespace of {@link PHOTO_METADATA_XMP_NAMESPACES}, or ISO 21496-1 gain-map
   * metadata in a JPEG APP2 segment), or "container-item" (one item of a Google container directory).
   */
  kind: "gain-map" | "depth-map" | "embedded-image" | "container-item";
  source: "xmp" | "jpeg-app2-iso-21496-1";
  /** The XMP namespace, or null for the APP2 segment. */
  namespace: string | null;
  /** A container item's Semantic ("Primary", "GainMap", ...), or null. */
  label: string | null;
  /** A container item's Length in bytes, or the APP2 segment's size, or null. */
  bytes: number | null;
  /** Index into `extraImages` of the image whose metadata holds the marker, or null for the primary image. */
  image: number | null;
}

export interface PhotoMetadata {
  schemaVersion: typeof PHOTO_METADATA_SCHEMA_VERSION;
  format: "jpeg" | "heif";
  /** HEIF: the ftyp major brand then the compatible brands; empty for a JPEG. */
  brands: string[];
  /** The primary image's stored size (JPEG frame header; HEIF ispe of the primary item), before any rotation, or null. */
  width: number | null;
  height: number | null;
  /**
   * HEIF only: the primary item's transformative properties, which a HEIF reader applies for display: irot (anticlockwise
   * rotation, degrees) and imir (0 mirrors about a vertical axis, 1 about a horizontal axis), or null when absent. An Exif
   * Orientation in a HEIF file is returned in `exif` as stored.
   */
  heifRotationDegrees: 0 | 90 | 180 | 270 | null;
  heifMirrorAxis: 0 | 1 | null;
  /** The primary image's Exif block, or null when the file has none (or it could not be read; see `assumptions`). */
  exif: PhotoExif | null;
  /** XMP namespaces declared by the primary image's XMP, sorted. */
  xmpNamespaces: string[];
  extraImages: PhotoExtraImage[];
  annotations: PhotoAnnotation[];
  /** What was skipped: malformed or truncated parts, ignored tags, data beyond the supplied bytes. */
  assumptions: string[];
}

const L = PHOTO_METADATA_LIMITS;
class Skip extends Error {}
/** Thrown inside a part that is then skipped and named in `assumptions`. */
function skip(message: string): never { throw new Skip(message); }
const text = (bytes: Uint8Array, start: number, end: number): string => {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]!);
  return s;
};
const utf8 = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: false }).decode(bytes);
const u16be = (b: Uint8Array, o: number): number => b[o]! << 8 | b[o + 1]!;
const u32be = (b: Uint8Array, o: number): number => (b[o]! << 24 | b[o + 1]! << 16 | b[o + 2]! << 8 | b[o + 3]!) >>> 0;
const hex6 = (code: number): string => "0x" + code.toString(16).padStart(6, "0");

// ---------------------------------------------------------------- TIFF structure (Exif and MPF)

const TYPE_SIZES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 129: 1 };
interface TiffEntry { type: number; count: number; at: number }
interface Tiff { little: boolean; bytes: Uint8Array; u16(o: number): number; u32(o: number): number; ifd(offset: number): { entries: Map<number, TiffEntry>; next: number } }

/** A bounded TIFF reader over one block (an Exif APP1 payload, a HEIF Exif item or an MPF segment). */
function tiff(bytes: Uint8Array): Tiff {
  if (bytes.length < 8) skip("the TIFF header is truncated");
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) skip("missing TIFF byte-order mark");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number): number => view.getUint16(o, little), u32 = (o: number): number => view.getUint32(o, little);
  if (u16(2) !== 42) skip("missing TIFF magic number");
  return {
    little, bytes, u16, u32,
    ifd(offset: number): { entries: Map<number, TiffEntry>; next: number } {
      if (offset < 8 || offset + 2 > bytes.length) skip("IFD offset out of range");
      const count = u16(offset);
      if (count > L.maximumIfdEntries) skip("IFD has " + count + " entries (at most " + L.maximumIfdEntries + ")");
      const end = offset + 2 + count * 12;
      if (end > bytes.length) skip("IFD exceeds the block");
      const entries = new Map<number, TiffEntry>();
      for (let i = 0; i < count; i++) {
        const p = offset + 2 + i * 12, id = u16(p), type = u16(p + 2), c = u32(p + 4), size = TYPE_SIZES[type];
        if (size === undefined || entries.has(id)) continue; // TIFF 6.0: readers skip fields of unknown type; the first duplicate wins.
        const bytesNeeded = size * c, at = bytesNeeded <= 4 ? p + 8 : u32(p + 8);
        entries.set(id, { type, count: c, at: at + bytesNeeded > bytes.length ? -1 : at });
      }
      return { entries, next: end + 4 <= bytes.length ? u32(end) : 0 };
    }
  };
}
/** The entry's values; a malformed entry is a Skip. */
function tiffNumbers(t: Tiff, e: TiffEntry, maximumCount: number, types: readonly number[]): number[] {
  if (!types.includes(e.type)) skip("unsupported field type " + e.type);
  if (e.count > maximumCount) skip("count " + e.count + " exceeds " + maximumCount);
  if (e.at < 0) skip("value exceeds the block");
  const view = new DataView(t.bytes.buffer, t.bytes.byteOffset, t.bytes.byteLength), out: number[] = [];
  for (let i = 0; i < e.count; i++) {
    let v: number;
    switch (e.type) {
      case 3: v = t.u16(e.at + 2 * i); break;
      case 4: case 13: v = t.u32(e.at + 4 * i); break;
      case 5: case 10: {
        const num = e.type === 5 ? t.u32(e.at + 8 * i) : view.getInt32(e.at + 8 * i, t.little), den = e.type === 5 ? t.u32(e.at + 8 * i + 4) : view.getInt32(e.at + 8 * i + 4, t.little);
        if (den === 0) skip("rational with zero denominator");
        v = num / den; break;
      }
      case 8: v = view.getInt16(e.at + 2 * i, t.little); break;
      case 9: v = view.getInt32(e.at + 4 * i, t.little); break;
      default: v = t.bytes[e.at + i]!; // BYTE, UNDEFINED (types 1 and 7; the only others accepted by any caller)
    }
    out.push(v);
  }
  return out;
}

/** Reads an Exif block (TIFF header first). The Exif IFD and IFD 1 are followed; the GPS and Interoperability IFDs are not. */
function readExif(block: Uint8Array, notes: string[]): { exif: PhotoExif; thumbnail: PhotoExtraImage | null } {
  const t = tiff(block);
  const visited = new Set<number>();
  const directory = (offset: number): { entries: Map<number, TiffEntry>; next: number } => {
    if (visited.has(offset)) skip("IFD loop or aliased IFD");
    visited.add(offset);
    return t.ifd(offset);
  };
  const ifd0 = directory(t.u32(4));
  const part = <T>(name: string, read: () => T): T | null => {
    try { return read(); } catch (error) {
      if (!(error instanceof Skip)) throw error;
      notes.push("photoMetadata.ignored: " + name + " is malformed and was ignored (" + error.message + ").");
      return null;
    }
  };
  const exifPointer = ifd0.entries.get(34665);
  const exifIfd = exifPointer ? part("Exif IFD", () => directory(tiffNumbers(t, exifPointer, 1, [4, 13])[0]!).entries) : null;
  const entry = (id: number): TiffEntry | undefined => exifIfd?.get(id) ?? ifd0.entries.get(id);
  const numbers = (id: number, name: string, types: readonly number[], count = 1): number[] | null => part(name, () => {
    const e = entry(id);
    if (!e || e.count === 0) return null;
    const v = tiffNumbers(t, e, Math.max(count, 64), types);
    if (v.some((x) => !(x >= 0))) skip(name + " must not be negative");
    return v;
  });
  const string = (id: number, name: string): string | null => part(name, () => {
    const e = ifd0.entries.get(id);
    if (!e) return null;
    if (e.type !== 2 && e.type !== 129) skip("unsupported field type " + e.type);
    if (e.count > 4096) skip("longer than 4096 bytes");
    if (e.at < 0) skip("value exceeds the block");
    let end = e.at;
    while (end < e.at + e.count && block[end] !== 0) end++;
    return utf8(block.subarray(e.at, end));
  });
  const capture = resolveExifCaptureFields({
    numbers, ignored: (message) => { notes.push("photoMetadata.ignored: " + message); }, note: (message) => { notes.push("photoMetadata.exif: " + message); }
  });
  let orientation = numbers(274, "Orientation", [3])?.[0] ?? null;
  if (orientation !== null && !(orientation >= 1 && orientation <= 8)) { notes.push("photoMetadata.ignored: Orientation " + orientation + " is not 1 to 8 and was ignored."); orientation = null; }
  const exif: PhotoExif = { make: string(271, "Make"), model: string(272, "Model"), software: string(305, "Software"), orientation, ...capture };

  // IFD 1: the thumbnail (JPEGInterchangeFormat and its length).
  const thumbnail = ifd0.next === 0 ? null : part("IFD 1 (thumbnail)", (): PhotoExtraImage | null => {
    const ifd1 = directory(ifd0.next).entries;
    const at = ifd1.get(513), length = ifd1.get(514);
    if (!at || !length) return null;
    const offset = tiffNumbers(t, at, 1, [4])[0]!, size = tiffNumbers(t, length, 1, [4])[0]!;
    const width = ifd1.get(256), height = ifd1.get(257);
    let w = width ? tiffNumbers(t, width, 1, [3, 4])[0]! : null, h = height ? tiffNumbers(t, height, 1, [3, 4])[0]! : null;
    if (offset + size > block.length) notes.push("photoMetadata.truncated: the Exif thumbnail lies beyond the Exif block; its size is not read.");
    else if (w === null || h === null) {
      const frame = jpegFrameSize(block.subarray(offset, offset + size));
      w = frame?.width ?? null; h = frame?.height ?? null;
    }
    return { source: "exif-thumbnail", kind: "thumbnail", kindBasis: "specification", type: "jpeg", width: w, height: h, bytes: size };
  });
  return { exif, thumbnail };
}

// ---------------------------------------------------------------- XMP

interface XmpSummary { namespaces: string[]; annotations: Omit<PhotoAnnotation, "image">[] }
/** Namespace declarations and the classified markers of one XMP packet. No XML is parsed; only bounded patterns are matched. */
function readXmp(packet: string, notes: string[]): XmpSummary {
  const namespaces = new Map<string, string>(); // uri -> first prefix
  const prefixes = new Map<string, string>();
  for (const m of packet.matchAll(/xmlns:([A-Za-z_][\w.-]{0,63})\s*=\s*["']([^"'<>]{1,512})["']/gu)) {
    if (namespaces.size >= L.maximumXmpNamespaces) { notes.push("photoMetadata.xmp: more than " + L.maximumXmpNamespaces + " namespaces; the rest are not listed."); break; }
    if (!namespaces.has(m[2]!)) namespaces.set(m[2]!, m[1]!);
    prefixes.set(m[1]!, m[2]!);
  }
  const annotations: Omit<PhotoAnnotation, "image">[] = [];
  for (const [uri, kind] of Object.entries(PHOTO_METADATA_XMP_NAMESPACES)) {
    if (namespaces.has(uri) && kind !== "container") annotations.push({ kind, source: "xmp", namespace: uri, label: null, bytes: null });
  }
  // Container items: <Container:Item Item:Semantic="GainMap" Item:Length="1234" .../> (attribute or element form).
  const itemPrefixes = [...prefixes].filter(([, uri]) => uri === CONTAINER_ITEM_NAMESPACE).map(([prefix]) => prefix);
  for (const prefix of itemPrefixes) {
    const name = prefix.replace(/[.]/gu, "\\.");
    const property = (field: string): RegExp => new RegExp("(?<![\\w./-])" + name + ":" + field + "\\s*(?:=\\s*[\"']([^\"'<>]{0,64})[\"']|>([^<]{0,64})<)", "gu");
    const semantics = [...packet.matchAll(property("Semantic"))].slice(0, L.maximumMpfEntries);
    semantics.forEach((m, i) => {
      const semantic = (m[1] ?? m[2] ?? "").trim();
      if (!/^[\w-]{1,64}$/u.test(semantic)) return;
      // The item's own properties lie between its Semantic and the next item's.
      const span = packet.slice(m.index, semantics[i + 1]?.index ?? Math.min(packet.length, m.index + 4096));
      const length = property("Length").exec(span), stated = length ? (length[1] ?? length[2] ?? "").trim() : "";
      annotations.push({ kind: semantic === "GainMap" ? "gain-map" : "container-item", source: "xmp", namespace: CONTAINER_ITEM_NAMESPACE, label: semantic,
        bytes: /^\d{1,12}$/u.test(stated) ? Number(stated) : null });
    });
  }
  return { namespaces: [...namespaces.keys()].sort(), annotations };
}

// ---------------------------------------------------------------- JPEG

interface JpegHeaders {
  width: number | null; height: number | null;
  exif: Uint8Array | null; xmp: string | null;
  extended: Map<string, { full: number; chunks: [number, Uint8Array][] }>;
  mpf: { base: number; data: Uint8Array } | null;
  iso21496: number | null;
}
/** Walks one JPEG's marker segments up to the first scan. `start` must be at SOI. */
function jpegHeaders(bytes: Uint8Array, start: number, notes: string[], label: string): JpegHeaders {
  const out: JpegHeaders = { width: null, height: null, exif: null, xmp: null, extended: new Map(), mpf: null, iso21496: null };
  const n = bytes.length;
  let p = start + 2, segments = 0;
  for (;;) {
    while (p < n && bytes[p] === 0xff && bytes[p + 1] === 0xff) p++; // fill bytes (T.81 B.1.1.2)
    if (p + 4 > n) { notes.push("photoMetadata.truncated: " + label + " ends before its first scan."); break; }
    if (bytes[p] !== 0xff) { notes.push("photoMetadata.ignored: " + label + " has a byte other than a marker at offset " + p + "; the rest of its headers were not read."); break; }
    const marker = bytes[p + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // start of scan or end of image: every header has been read
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { p += 2; continue; }
    if (++segments > L.maximumJpegSegments) { notes.push("photoMetadata.ignored: " + label + " has more than " + L.maximumJpegSegments + " marker segments; the rest were not read."); break; }
    const length = u16be(bytes, p + 2), body = p + 4, end = p + 2 + length;
    if (length < 2) { notes.push("photoMetadata.ignored: " + label + " has a marker segment of length " + length + "; the rest of its headers were not read."); break; }
    if (end > n) { notes.push("photoMetadata.truncated: " + label + "'s marker 0x" + marker.toString(16) + " segment extends beyond the supplied bytes."); break; }
    const startsWith = (s: string): boolean => end - body >= s.length && text(bytes, body, body + s.length) === s;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && out.width === null && length >= 7) {
      const h = u16be(bytes, body + 1), w = u16be(bytes, body + 3);
      out.height = h > 0 ? h : null; out.width = w > 0 ? w : null;
    } else if (marker === 0xe1 && out.exif === null && startsWith("Exif\0")) {
      out.exif = bytes.subarray(body + 6, end);
    } else if (marker === 0xe1 && out.xmp === null && startsWith("http://ns.adobe.com/xap/1.0/\0")) {
      out.xmp = utf8(bytes.subarray(body + 29, end));
    } else if (marker === 0xe1 && startsWith("http://ns.adobe.com/xmp/extension/\0") && end - body >= 35 + 40) {
      const guid = text(bytes, body + 35, body + 67), full = u32be(bytes, body + 67), offset = u32be(bytes, body + 71);
      const entry = out.extended.get(guid) ?? { full, chunks: [] };
      if (out.extended.size < 4 && entry.chunks.length < 1024) { entry.chunks.push([offset, bytes.subarray(body + 75, end)]); out.extended.set(guid, entry); }
    } else if (marker === 0xe2 && out.mpf === null && startsWith("MPF\0")) {
      out.mpf = { base: body + 4, data: bytes.subarray(body + 4, end) };
    } else if (marker === 0xe2 && out.iso21496 === null && startsWith(ISO_21496_APP2)) {
      out.iso21496 = end - body - ISO_21496_APP2.length;
    }
    p = end;
  }
  return out;
}
/** The frame size of a JPEG held in `bytes`, or null. */
function jpegFrameSize(bytes: Uint8Array): { width: number | null; height: number | null } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const h = jpegHeaders(bytes, 0, [], "");
  return { width: h.width, height: h.height };
}
/** Assembles the extended XMP packet (Adobe XMP Part 3, 1.1.3.1) when every byte is present. */
function extendedXmp(headers: JpegHeaders, notes: string[]): string | null {
  for (const [, { full, chunks }] of headers.extended) {
    if (full > L.maximumItemDataBytes) { notes.push("photoMetadata.ignored: the extended XMP packet (" + full + " bytes) is larger than " + L.maximumItemDataBytes + " bytes and was not read."); continue; }
    const packet = new Uint8Array(full), filled = new Uint8Array(full);
    for (const [offset, data] of chunks) {
      if (offset + data.length > full) continue;
      packet.set(data, offset); filled.fill(1, offset, offset + data.length);
    }
    if (filled.includes(0)) { notes.push("photoMetadata.truncated: the extended XMP packet is incomplete and was not read."); continue; }
    return utf8(packet);
  }
  return null;
}

/** MPF type codes (CIPA DC-007-2009, Table 4). */
const MPF_TYPES: Readonly<Record<number, PhotoExtraImageKind>> = { 0x030000: "other", 0x010001: "large-thumbnail", 0x010002: "large-thumbnail",
  0x020001: "panorama-frame", 0x020002: "disparity", 0x020003: "multi-angle-frame" };

function readJpeg(bytes: Uint8Array, out: PhotoMetadata): void {
  const notes = out.assumptions;
  const headers = jpegHeaders(bytes, 0, notes, "the JPEG");
  out.width = headers.width; out.height = headers.height;
  const addXmp = (packet: string | null, image: number | null, primary: boolean): void => {
    if (packet === null) return;
    const x = readXmp(packet, notes);
    if (primary) out.xmpNamespaces = [...new Set([...out.xmpNamespaces, ...x.namespaces])].sort();
    for (const a of x.annotations) out.annotations.push({ ...a, image });
  };
  if (headers.exif) {
    const read = attempt(notes, "the Exif block", () => readExif(headers.exif!, notes));
    if (read) { out.exif = read.exif; if (read.thumbnail) out.extraImages.push(read.thumbnail); }
  }
  addXmp(headers.xmp, null, true);
  addXmp(extendedXmp(headers, notes), null, true);
  if (headers.iso21496 !== null) out.annotations.push({ kind: "gain-map", source: "jpeg-app2-iso-21496-1", namespace: null, label: null, bytes: headers.iso21496, image: null });
  if (headers.mpf) {
    const mpf = headers.mpf;
    attempt(notes, "the Multi-Picture Format index", () => {
      const t = tiff(mpf.data), index = t.ifd(t.u32(4)).entries;
      const entries = index.get(0xb002);
      if (!entries) return;
      if (entries.type !== 7 || entries.count % 16 !== 0) skip("MPEntry is not a multiple of 16 bytes");
      const count = entries.count / 16;
      if (count > L.maximumMpfEntries) skip(count + " entries (at most " + L.maximumMpfEntries + ")");
      if (entries.at < 0) skip("MPEntry exceeds the segment");
      for (let i = 0; i < count; i++) {
        const at = entries.at + 16 * i, attribute = t.u32(at), size = t.u32(at + 4), offset = t.u32(at + 8), code = attribute & 0xffffff;
        if (offset === 0 && i === 0) continue; // the first entry is the primary image (offset 0, the file itself)
        const kind = MPF_TYPES[code];
        const image: PhotoExtraImage = { source: "jpeg-mpf", kind: kind ?? "other", kindBasis: kind && kind !== "other" ? "specification" : "none", type: hex6(code),
          width: null, height: null, bytes: size };
        const index = out.extraImages.push(image) - 1, start = mpf.base + offset;
        if (offset === 0) { notes.push("photoMetadata.ignored: Multi-Picture Format entry " + (i + 1) + " has offset 0 but is not the first entry; its size is not read."); continue; }
        if (start + 2 > bytes.length) { notes.push("photoMetadata.truncated: Multi-Picture Format entry " + (i + 1) + " lies beyond the supplied bytes; its size is not read."); continue; }
        if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) { notes.push("photoMetadata.ignored: Multi-Picture Format entry " + (i + 1) + " does not start with a JPEG SOI marker."); continue; }
        const own = jpegHeaders(bytes.subarray(0, Math.min(bytes.length, start + size)), start, notes, "Multi-Picture Format entry " + (i + 1));
        image.width = own.width; image.height = own.height;
        const before = out.annotations.length;
        addXmp(own.xmp, index, false);
        if (own.iso21496 !== null) out.annotations.push({ kind: "gain-map", source: "jpeg-app2-iso-21496-1", namespace: null, label: null, bytes: own.iso21496, image: index });
        if (image.kind === "other" && out.annotations.slice(before).some((a) => a.kind === "gain-map")) { image.kind = "gain-map"; image.kindBasis = "xmp"; }
      }
    });
  }
}
/** Runs one part; a Skip is named in `assumptions` and the part is left out. */
function attempt<T>(notes: string[], name: string, read: () => T): T | null {
  try { return read(); } catch (error) {
    if (!(error instanceof Skip)) throw error;
    notes.push("photoMetadata.ignored: " + name + " is malformed and was not read (" + error.message + ").");
    return null;
  }
}

// ---------------------------------------------------------------- HEIF

const HEIF_BRANDS = new Set(["mif1", "mif2", "msf1", "heic", "heix", "heim", "heis", "hevc", "hevx", "avif", "avis"]);
interface Box { type: string; body: number; end: number }
/** The boxes between `start` and `end` (ISO/IEC 14496-12 §4.2), at most `maximumBoxes`; a box beyond `end` stops the walk. */
function boxes(bytes: Uint8Array, start: number, end: number, notes: string[], where: string): Box[] {
  const out: Box[] = [];
  for (let p = start; p + 8 <= end;) {
    if (out.length >= L.maximumBoxes) { notes.push("photoMetadata.ignored: " + where + " has more than " + L.maximumBoxes + " boxes; the rest were not read."); break; }
    let size = u32be(bytes, p), header = 8;
    const type = text(bytes, p + 4, p + 8);
    if (size === 1) {
      if (p + 16 > end) { notes.push("photoMetadata.truncated: a " + type + " box in " + where + " is cut short."); break; }
      const high = u32be(bytes, p + 8);
      size = high * 0x1_0000_0000 + u32be(bytes, p + 12); header = 16;
    } else if (size === 0) size = end - p;
    if (size < header) { notes.push("photoMetadata.ignored: a " + type + " box in " + where + " has size " + size + "; the rest were not read."); break; }
    if (p + size > end) {
      out.push({ type, body: p + header, end: -1 }); // known type, contents beyond the bytes
      break;
    }
    out.push({ type, body: p + header, end: p + size });
    p += size;
  }
  return out;
}
/** Big-endian unsigned integer of 0, 4 or 8 bytes (ISO/IEC 14496-12 iloc sizes) within [p, end). */
function uint(bytes: Uint8Array, p: number, size: number, end: number): number {
  if (p + size > end) skip("field beyond its box");
  if (size === 0) return 0;
  if (size === 2) return u16be(bytes, p);
  if (size === 4) return u32be(bytes, p);
  if (size === 8) {
    const value = u32be(bytes, p) * 0x1_0000_0000 + u32be(bytes, p + 4);
    if (!Number.isSafeInteger(value)) skip("64-bit value too large");
    return value;
  }
  return skip("field size " + size + " is not 0, 4 or 8");
}
const cstring = (bytes: Uint8Array, p: number, end: number): { value: string; next: number } => {
  let q = p;
  while (q < end && bytes[q] !== 0) q++;
  if (q >= end) skip("string without a terminator");
  return { value: utf8(bytes.subarray(p, q)), next: q + 1 };
};

/** auxC URNs defined by ISO/IEC 23008-12 and ISO/IEC 23091-2 (CICP alpha and depth) and the HEVC auxiliary ids 1 (alpha) and 2 (depth). */
const STANDARD_AUXILIARY: Readonly<Record<string, PhotoExtraImageKind>> = { "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha": "alpha", "urn:mpeg:mpegB:cicp:systems:auxiliary:depth": "depth",
  "urn:mpeg:hevc:2015:auxid:1": "alpha", "urn:mpeg:hevc:2015:auxid:2": "depth" };
function auxiliaryKind(urn: string): { kind: PhotoExtraImageKind; kindBasis: PhotoExtraImage["kindBasis"] } {
  const standard = STANDARD_AUXILIARY[urn];
  if (standard) return { kind: standard, kindBasis: "specification" };
  const name = (urn.split(":").pop() ?? "").toLowerCase();
  const kind: PhotoExtraImageKind | null = name.includes("gainmap") ? "gain-map" : name.includes("matte") ? "matte" : name.includes("disparity") ? "disparity"
    : name.includes("depth") ? "depth" : name.includes("alpha") ? "alpha" : null;
  return kind ? { kind, kindBasis: "name" } : { kind: "other", kindBasis: "none" };
}

interface HeifItem { id: number; type: string; contentType: string | null; width: number | null; height: number | null; auxType: string | null;
  rotation: 0 | 90 | 180 | 270 | null; mirror: 0 | 1 | null; extents: { method: number; ranges: [number, number][] } | null }
const IMAGE_ITEM_TYPES = new Set(["hvc1", "av01", "jpeg", "grid", "iden", "iovl", "tmap", "unci", "j2k1", "avc1", "vvc1", "hvt1"]);

function readHeif(bytes: Uint8Array, out: PhotoMetadata): void {
  const notes = out.assumptions, n = bytes.length;
  const top = boxes(bytes, 0, n, notes, "the file");
  const ftyp = top[0];
  if (!ftyp || ftyp.type !== "ftyp" || ftyp.end < 0 || ftyp.end - ftyp.body < 8) fail("the ftyp box is malformed or extends beyond the supplied bytes.");
  out.brands.push(text(bytes, ftyp.body, ftyp.body + 4));
  for (let p = ftyp.body + 8; p + 4 <= ftyp.end && out.brands.length < 64; p += 4) out.brands.push(text(bytes, p, p + 4));
  if (!out.brands.some((b) => HEIF_BRANDS.has(b))) fail("the ftyp box names no HEIF brand (" + out.brands.join(", ") + ").");
  const meta = top.find((b) => b.type === "meta");
  if (!meta) { notes.push("photoMetadata.truncated: no meta box within the supplied bytes; nothing was read."); return; }
  if (meta.end < 0) { notes.push("photoMetadata.truncated: the meta box extends beyond the supplied bytes; nothing was read."); return; }
  attempt(notes, "the meta box", () => readHeifMeta(bytes, meta, out));
}

function readHeifMeta(bytes: Uint8Array, meta: Box, out: PhotoMetadata): void {
  const notes = out.assumptions;
  const kids = boxes(bytes, meta.body + 4, meta.end, notes, "the meta box").filter((b) => b.end >= 0);
  const child = (type: string): Box | undefined => kids.find((b) => b.type === type);
  const items = new Map<number, HeifItem>();
  // pitm: the primary item.
  const pitm = child("pitm");
  const primary = pitm ? (bytes[pitm.body] === 0 ? uint(bytes, pitm.body + 4, 2, pitm.end) : uint(bytes, pitm.body + 4, 4, pitm.end)) : null;
  if (primary === null) notes.push("photoMetadata.ignored: the meta box has no pitm (primary item) box.");
  // iinf / infe: item ids and types.
  const iinf = child("iinf");
  if (iinf) attempt(notes, "the iinf box", () => {
    const first = iinf.body + 4 + (bytes[iinf.body] === 0 ? 2 : 4);
    for (const infe of boxes(bytes, first, iinf.end, notes, "the iinf box")) {
      if (infe.type !== "infe" || infe.end < 0) continue;
      if (items.size >= L.maximumItems) { notes.push("photoMetadata.ignored: more than " + L.maximumItems + " items; the rest were not read."); break; }
      const version = bytes[infe.body]!;
      if (version < 2) continue; // versions 0 and 1 carry no item type
      let q = infe.body + 4;
      const id = uint(bytes, q, version === 2 ? 2 : 4, infe.end); q += (version === 2 ? 2 : 4) + 2;
      if (q + 4 > infe.end) skip("infe box too short");
      const type = text(bytes, q, q + 4); q += 4;
      const name = cstring(bytes, q, infe.end);
      const contentType = type === "mime" ? cstring(bytes, name.next, infe.end).value : null;
      if (!items.has(id)) items.set(id, { id, type, contentType, width: null, height: null, auxType: null, rotation: null, mirror: null, extents: null });
    }
  });
  // iref: references (auxl, thmb, cdsc, dimg).
  const refs: { type: string; from: number; to: number[] }[] = [];
  const iref = child("iref");
  if (iref) attempt(notes, "the iref box", () => {
    const wide = bytes[iref.body] !== 0, size = wide ? 4 : 2;
    let total = 0;
    for (const r of boxes(bytes, iref.body + 4, iref.end, notes, "the iref box")) {
      if (r.end < 0) break;
      let q = r.body;
      const from = uint(bytes, q, size, r.end); q += size;
      const count = uint(bytes, q, 2, r.end); q += 2;
      if ((total += count) > L.maximumItems) skip("more than " + L.maximumItems + " references");
      const to: number[] = [];
      for (let i = 0; i < count; i++, q += size) to.push(uint(bytes, q, size, r.end));
      refs.push({ type: r.type, from, to });
    }
  });
  // iprp: ipco properties and their ipma associations.
  const iprp = child("iprp");
  if (iprp) attempt(notes, "the iprp box", () => {
    const parts = boxes(bytes, iprp.body, iprp.end, notes, "the iprp box").filter((b) => b.end >= 0);
    const ipco = parts.find((b) => b.type === "ipco");
    const properties = ipco ? boxes(bytes, ipco.body, ipco.end, notes, "the ipco box") : [];
    let associations = 0;
    for (const ipma of parts.filter((b) => b.type === "ipma")) {
      const version = bytes[ipma.body]!, flags = bytes[ipma.body + 3]!;
      let q = ipma.body + 4;
      const count = uint(bytes, q, 4, ipma.end); q += 4;
      for (let i = 0; i < count; i++) {
        const id = uint(bytes, q, version < 1 ? 2 : 4, ipma.end); q += version < 1 ? 2 : 4;
        if (q + 1 > ipma.end) skip("ipma entry beyond its box");
        const k = bytes[q++]!;
        if ((associations += k + 1) > L.maximumItems * 4) skip("more than " + L.maximumItems * 4 + " property associations");
        for (let j = 0; j < k; j++) {
          let index: number;
          if (flags & 1) { index = uint(bytes, q, 2, ipma.end) & 0x7fff; q += 2; } else { if (q + 1 > ipma.end) skip("ipma entry beyond its box"); index = bytes[q]! & 0x7f; q += 1; }
          const property = properties[index - 1], item = items.get(id);
          if (!property || !item || property.end < 0) continue;
          if (property.type === "ispe" && property.end - property.body >= 12) { item.width = u32be(bytes, property.body + 4); item.height = u32be(bytes, property.body + 8); }
          else if (property.type === "auxC") item.auxType = cstring(bytes, property.body + 4, property.end).value;
          else if (property.type === "irot" && property.end > property.body) item.rotation = ([0, 90, 180, 270] as const)[bytes[property.body]! & 3]!;
          else if (property.type === "imir" && property.end > property.body) item.mirror = (bytes[property.body]! & 1) as 0 | 1;
        }
      }
    }
  });
  // iloc: where each item's data is (construction method 0 file offsets, 1 idat offsets).
  const iloc = child("iloc");
  if (iloc) attempt(notes, "the iloc box", () => {
    const version = bytes[iloc.body]!, end = iloc.end;
    let q = iloc.body + 4;
    if (q + 2 > end) skip("iloc box too short");
    const offsetSize = bytes[q]! >> 4, lengthSize = bytes[q]! & 15, baseSize = bytes[q + 1]! >> 4, indexSize = version >= 1 ? bytes[q + 1]! & 15 : 0;
    q += 2;
    const count = uint(bytes, q, version < 2 ? 2 : 4, end); q += version < 2 ? 2 : 4;
    if (count > L.maximumItems) skip(count + " entries (at most " + L.maximumItems + ")");
    let totalExtents = 0;
    for (let i = 0; i < count; i++) {
      const id = uint(bytes, q, version < 2 ? 2 : 4, end); q += version < 2 ? 2 : 4;
      const method = version >= 1 ? uint(bytes, q, 2, end) & 15 : 0; if (version >= 1) q += 2;
      q += 2; // data_reference_index
      const base = uint(bytes, q, baseSize, end); q += baseSize;
      const extents = uint(bytes, q, 2, end); q += 2;
      // Zero-size offset and length fields take no bytes, so the extent count is bounded explicitly.
      if ((totalExtents += extents) > L.maximumItems * 4) skip("more than " + L.maximumItems * 4 + " extents");
      const ranges: [number, number][] = [];
      for (let j = 0; j < extents; j++) {
        if (indexSize) { uint(bytes, q, indexSize, end); q += indexSize; }
        const offset = uint(bytes, q, offsetSize, end); q += offsetSize;
        const length = uint(bytes, q, lengthSize, end); q += lengthSize;
        ranges.push([base + offset, length]);
      }
      const item = items.get(id);
      if (item && !item.extents) item.extents = { method, ranges };
    }
  });
  const idat = child("idat");
  /** An item's data, copied when it has several extents; null (with a note) when it is beyond the bytes or too large. */
  const data = (item: HeifItem, what: string): Uint8Array | null => {
    const e = item.extents;
    if (!e) { notes.push("photoMetadata.ignored: the " + what + " item has no iloc entry."); return null; }
    if (e.method > 1) { notes.push("photoMetadata.ignored: the " + what + " item uses iloc construction method " + e.method + ", which is not read."); return null; }
    const source = e.method === 0 ? { start: 0, end: bytes.length } : idat ? { start: idat.body, end: idat.end } : null;
    if (!source) { notes.push("photoMetadata.ignored: the " + what + " item refers to an idat box that is absent."); return null; }
    const parts: Uint8Array[] = [];
    let total = 0;
    for (const [offset, length] of e.ranges) {
      const start = source.start + offset, size = length === 0 ? source.end - start : length;
      if (start + size > source.end || size < 0) { notes.push("photoMetadata.truncated: the " + what + " item lies beyond the supplied bytes."); return null; }
      if ((total += size) > L.maximumItemDataBytes) { notes.push("photoMetadata.ignored: the " + what + " item is larger than " + L.maximumItemDataBytes + " bytes and was not read."); return null; }
      parts.push(bytes.subarray(start, start + size));
    }
    if (parts.length === 1) return parts[0]!;
    const joined = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { joined.set(part, at); at += part.length; }
    return joined;
  };

  const primaryItem = primary === null ? undefined : items.get(primary);
  if (primaryItem) {
    out.width = primaryItem.width; out.height = primaryItem.height;
    out.heifRotationDegrees = primaryItem.rotation; out.heifMirrorAxis = primaryItem.mirror;
  }
  const describes = (item: HeifItem): number[] => refs.filter((r) => r.type === "cdsc" && r.from === item.id).flatMap((r) => r.to);
  // Exif: the item that describes the primary image, else the first Exif item.
  const exifItems = [...items.values()].filter((i) => i.type === "Exif");
  const exifItem = exifItems.find((i) => primary !== null && describes(i).includes(primary)) ?? exifItems[0];
  if (exifItem) {
    const payload = data(exifItem, "Exif");
    if (payload) attempt(notes, "the Exif item", () => {
      if (payload.length < 4) skip("shorter than its header offset");
      let start = 4 + u32be(payload, 0);
      if (start + 6 <= payload.length && text(payload, start, start + 6) === "Exif\0\0") start += 6;
      if (start > payload.length) skip("TIFF header offset beyond the item");
      const read = readExif(payload.subarray(start), notes);
      out.exif = read.exif;
      if (read.thumbnail) out.extraImages.push(read.thumbnail);
    });
  }
  // Extra images: not the primary, not a tile or input of the primary's derivation.
  const derivationInputs = new Set(refs.filter((r) => r.type === "dimg" && items.get(r.from)?.type !== "tmap").flatMap((r) => r.to));
  const toneMapInputs = refs.filter((r) => r.type === "dimg" && items.get(r.from)?.type === "tmap");
  const gainMapInputs = new Set(toneMapInputs.flatMap((r) => r.to.slice(1)));
  const thumbnails = new Set(refs.filter((r) => r.type === "thmb").map((r) => r.from));
  const indexOf = new Map<number, number>();
  for (const item of items.values()) {
    if (item.id === primary || !(IMAGE_ITEM_TYPES.has(item.type) || item.width !== null || item.auxType !== null)) continue;
    if (derivationInputs.has(item.id) && item.auxType === null && !thumbnails.has(item.id) && !gainMapInputs.has(item.id)) continue;
    const base = { type: item.auxType ?? item.type, width: item.width, height: item.height, bytes: item.extents ? item.extents.ranges.reduce((s, [, l]) => s + l, 0) : null };
    const extra: PhotoExtraImage = item.auxType !== null ? { source: "heif-auxiliary", ...auxiliaryKind(item.auxType), ...base }
      : thumbnails.has(item.id) ? { source: "heif-thumbnail", kind: "thumbnail", kindBasis: "specification", ...base }
        : item.type === "tmap" ? { source: "heif-tone-map", kind: "tone-mapped", kindBasis: "specification", ...base }
          : gainMapInputs.has(item.id) ? { source: "heif-gain-map-input", kind: "gain-map", kindBasis: "specification", ...base }
            : { source: "heif-image", kind: "other", kindBasis: "none", ...base };
    indexOf.set(item.id, out.extraImages.push(extra) - 1);
  }
  // XMP items: those that describe the primary image are the primary XMP; others annotate the extra image they describe.
  for (const item of items.values()) {
    if (item.type !== "mime" || !/^application\/rdf\+xml\b/u.test(item.contentType ?? "")) continue;
    const targets = describes(item);
    const target = targets.find((t) => t !== primary && indexOf.has(t));
    const forPrimary = targets.length === 0 || (primary !== null && targets.includes(primary));
    if (!forPrimary && target === undefined) continue;
    const payload = data(item, "XMP");
    if (!payload) continue;
    const x = readXmp(utf8(payload), notes);
    if (forPrimary) out.xmpNamespaces = [...new Set([...out.xmpNamespaces, ...x.namespaces])].sort();
    const image = forPrimary ? null : indexOf.get(target!)!;
    for (const a of x.annotations) out.annotations.push({ ...a, image });
  }
}

function fail(message: string): never { throw new InvalidConfigurationError("parsePhotoMetadata: " + message); }

/**
 * Reads the capture metadata of a JPEG or HEIC/HEIF file from its headers: the Exif capture settings (exposure time,
 * f-number, the ISO fields, focal length, FocalLengthIn35mmFilm, DigitalZoomRatio, CompositeImage, the focal-plane
 * resolution), make, model, Software, Orientation and the image size, and the extra images and annotations the file declares
 * (by type and size only). No pixel data is decoded, and maker notes and GPS data are never read.
 *
 * Input is untrusted: every read is bounded (see {@link PHOTO_METADATA_LIMITS}), and a malformed or truncated part is named in
 * `assumptions` and skipped.
 *
 * @param input The file's bytes, or a prefix of them that holds the headers.
 * @returns The metadata the file states; fields the file does not state are null.
 * @throws InvalidConfigurationError when the bytes are neither a JPEG nor a HEIF file, or the input has an unknown field.
 */
export function parsePhotoMetadata(input: PhotoMetadataInput): PhotoMetadata {
  requireInputKeys(input, "parsePhotoMetadata", ["bytes"]);
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array)) fail("bytes must be a Uint8Array.");
  const out: PhotoMetadata = { schemaVersion: PHOTO_METADATA_SCHEMA_VERSION, format: "jpeg", brands: [], width: null, height: null, heifRotationDegrees: null,
    heifMirrorAxis: null, exif: null, xmpNamespaces: [], extraImages: [], annotations: [], assumptions: [] };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) readJpeg(bytes, out);
  else if (bytes.length >= 16 && text(bytes, 4, 8) === "ftyp") { out.format = "heif"; readHeif(bytes, out); }
  else fail("the bytes are neither a JPEG (FF D8 FF) nor a HEIF file (an ftyp box first).");
  return out;
}
