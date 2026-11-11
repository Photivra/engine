// SPDX-License-Identifier: Apache-2.0

/**
 * Content Credentials (C2PA) export writers: the engine half of #165. The engine embeds a finished, caller-built C2PA
 * Manifest Store in a JPEG or DNG export, reports the byte ranges the data hash must exclude, optionally computes that
 * SHA-256, and writes the signed store back in place at the same length. It never builds JUMBF or COSE, holds no keys,
 * signs nothing and makes no network calls: the caller brings its own manifest builder and signer.
 *
 * Every rule cited is from the C2PA Technical Specification 2.4 (April 2026):
 *
 * - Manifest Store (§11.1.4.2): a JUMBF superbox labelled `c2pa` with JUMBF type UUID 63327061-0011-0010-8000-00AA00389B71.
 *   The engine checks only that outer framing (superbox, description box, UUID, label, child box lengths).
 * - JPEG (§A.3.1): the store is the data of APP11 marker segments (JPEG XT, ISO/IEC 18477-3), split per ISO 19566-5:2023 D.2,
 *   written in order and contiguous. Each segment carries CI = "JP", En (box instance number) and Z (packet sequence number,
 *   from 1); every continuation segment repeats the box's LBox and TBox. The split is the one the C2PA reference SDK
 *   (c2pa-rs, `jpeg_io.rs`) writes: 64,000-byte pieces of the store and En = 0x0211, so the same store gives the same bytes.
 *   The segments go after the leading run of APPn segments (JFIF APP0, Exif and XMP APP1, ICC APP2) and before the
 *   quantization tables; the specification sets no position, only contiguity.
 * - TIFF and DNG (§A.3.6): the store is the data of tag 52545 (0xCD41), type 7 (UNDEFINED), in the last IFD of the main chain.
 *   For a file with one main IFD the entry may sit in that IFD, which is where the engine puts it, in ascending tag order. The
 *   store goes at the end of the file, as the section recommends. The TIFF byte order does not apply inside the store.
 * - Data hash `c2pa.hash.data` (§18.5): the hash covers every byte except the exclusions, which are ascending and
 *   non-overlapping (§18.5.1). JPEG: one exclusion covering every C2PA APP11 segment, each FFEB marker and length field
 *   included (§18.5.3). TIFF: the store's bytes and, as §18.5.5 recommends, the 4-byte count field of its IFD entry.
 * - Multiple step processing (§10.4): the caller embeds a placeholder store whose size already allows for the signature, hashes
 *   the bound bytes, fills in the data hash and signature, and writes the final store "without changing the size". The engine
 *   enforces that last step: `setC2paManifestStore` refuses a store of any other length, so no offset in the file ever moves.
 *
 * The digital source type for an image the engine simulates is IPTC `algorithmicMedia` (owner decision on #165, 2026-11-10);
 * `C2PA_ALGORITHMIC_MEDIA_SOURCE_TYPE` holds it for the caller's `c2pa.created` action (§18.15). The engine does not write it.
 * This module is imported by nothing in the capture path, so a bundler leaves it out unless an application uses it.
 * @see docs/CONTENT_CREDENTIALS.md for the workflow, the byte layouts and what is still to be validated externally.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireAllowlistedRecord, requireInputKeys } from "../core/record-validation.js";

/** IPTC digital source type for media created purely by an algorithm (https://cv.iptc.org/newscodes/digitalsourcetype/). */
export const C2PA_ALGORITHMIC_MEDIA_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia" as const;
/** Largest manifest store the engine embeds, bytes (an engine limit, not a C2PA one). */
export const C2PA_MANIFEST_STORE_MAXIMUM_BYTES = 33_554_432;

/** A byte range of a file: `start` is a zero-based offset, `length` a byte count. */
export interface C2paByteRange { start: number; length: number }
/**
 * Where the manifest store sits in a file and which bytes the data hash excludes. Plain data: it can be kept, sent to a
 * worker or serialized, and must be passed back unchanged to `setC2paManifestStore`.
 */
export interface C2paHardBinding {
  /** `image/jpeg`, or for TIFF files `image/dng` when the main IFD has DNGVersion (50706), otherwise `image/tiff`. */
  mediaType: "image/jpeg" | "image/dng" | "image/tiff";
  /** Length of the file with the store embedded, bytes. */
  fileLength: number;
  /** The `exclusions` of the `c2pa.hash.data` assertion, ascending and non-overlapping (§18.5). */
  exclusions: readonly C2paByteRange[];
  /** JPEG: every C2PA APP11 segment, markers and length fields included. TIFF/DNG: the store's own bytes. */
  manifestRegion: C2paByteRange;
  /** Length of the JUMBF manifest store itself, bytes. A replacement store must have exactly this length. */
  manifestStoreLength: number;
}
/** A file with a manifest store embedded, and its binding. */
export interface C2paBoundFile { bytes: Uint8Array; binding: C2paHardBinding }
/** Input of `bindC2paManifestStore`. */
export interface BindC2paManifestStoreInput {
  /** A JPEG, or a TIFF-based file such as a DNG, as written by the engine's exporters. It is read, never changed. */
  file: Uint8Array;
  /**
   * The placeholder store (§10.4): a JUMBF C2PA Manifest Store sized for the final signature. For JPEG it may instead be the
   * same store already split into APP11 segments (what the C2PA reference SDK's placeholder call returns), as long as that
   * split is the one described above.
   */
  manifestStore: Uint8Array;
}
/** Input of `setC2paManifestStore`. */
export interface SetC2paManifestStoreInput {
  /** The bound file (`C2paBoundFile.bytes`). It is read, never changed. */
  file: Uint8Array;
  /** The binding `bindC2paManifestStore` returned for it. */
  binding: C2paHardBinding;
  /** The final, signed store: exactly `binding.manifestStoreLength` bytes, as JUMBF or (JPEG) in the same APP11 split. */
  manifestStore: Uint8Array;
}
/** Input of `calculateC2paDataHash`. */
export interface CalculateC2paDataHashInput {
  /** The bound file. */
  file: Uint8Array;
  /** The binding's exclusions (or any ascending, non-overlapping ranges inside the file). */
  exclusions: readonly C2paByteRange[];
}
/** SHA-256 over every byte of the file outside the exclusions, in file order (§18.5): the `hash` of `c2pa.hash.data`. */
export interface C2paDataHash { alg: "sha256"; hash: Uint8Array; hashHex: string; hashedByteCount: number }

const JUMB = 0x6a756d62, JUMD = 0x6a756d64;
const C2PA_UUID = [0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
/** c2pa-rs `MAX_JPEG_MARKER_SIZE` and its En; see the module notes. */
const JPEG_PIECE = 64_000, JPEG_EN = 0x0211;
const TIFF_C2PA_TAG = 52545;

function fail(message: string): never { throw new InvalidConfigurationError("C2PA: " + message); }
function bytesOf(value: unknown, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) fail(name + " must be a Uint8Array.");
  return value;
}
const u32be = (b: Uint8Array, p: number): number => ((b[p]! << 24) >>> 0) + (b[p + 1]! << 16) + (b[p + 2]! << 8) + b[p + 3]!;

/** Checks the outer framing of a C2PA Manifest Store (§11.1.4.2, ISO 19566-5 boxes); the manifests inside are the caller's. */
function checkStore(store: Uint8Array): Uint8Array {
  if (store.length < 8 + 8 + 16 + 1 + 5 || store.length > C2PA_MANIFEST_STORE_MAXIMUM_BYTES) fail("manifest store size is outside 38 B to 32 MiB.");
  if (u32be(store, 0) !== store.length || u32be(store, 4) !== JUMB) fail("manifest store must be one JUMBF superbox ('jumb') whose LBox is its whole length.");
  let at = 8, first = true;
  while (at < store.length) {
    if (at + 8 > store.length) fail("manifest store has a truncated child box.");
    const size = u32be(store, at);
    if (size < 8 || at + size > store.length) fail("manifest store has a child box with an unsupported or out-of-range LBox.");
    if (first) {
      // JUMBF description box: TYPE (16-byte UUID), TOGGLES, then the null-terminated label when toggle bit 0x02 is set.
      if (u32be(store, at + 4) !== JUMD || size < 8 + 16 + 1 + 5) fail("manifest store must start with a JUMBF description box ('jumd').");
      if (C2PA_UUID.some((v, i) => store[at + 8 + i] !== v)) fail("manifest store's JUMBF type is not the C2PA UUID 63327061-0011-0010-8000-00AA00389B71.");
      if ((store[at + 24]! & 0x02) === 0 || [0x63, 0x32, 0x70, 0x61, 0].some((v, i) => store[at + 25 + i] !== v)) fail("manifest store's label must be 'c2pa'.");
      first = false;
    }
    at += size;
  }
  if (first) fail("manifest store has no description box.");
  return store;
}

// ---- JPEG (§A.3.1, §18.5.3) ----

/** The APP11 segments for a store (ISO 19566-5 D.2), split as the reference SDK splits them. */
function jpegSegments(store: Uint8Array): Uint8Array {
  const pieces = Math.ceil(store.length / JPEG_PIECE);
  const out = new Uint8Array(pieces * 12 + (pieces - 1) * 8 + store.length);
  let at = 0;
  for (let i = 0; i < pieces; i++) {
    const piece = store.subarray(i * JPEG_PIECE, Math.min(store.length, (i + 1) * JPEG_PIECE)), lp = 2 + 8 + (i ? 8 : 0) + piece.length;
    out.set([0xff, 0xeb, lp >> 8, lp & 255, 0x4a, 0x50, JPEG_EN >> 8, JPEG_EN & 255, (i + 1) >>> 24, ((i + 1) >> 16) & 255, ((i + 1) >> 8) & 255, (i + 1) & 255], at);
    at += 12;
    if (i) { out.set(store.subarray(0, 8), at); at += 8; }
    out.set(piece, at); at += piece.length;
  }
  return out;
}
/** The store carried by C2PA APP11 segments at `start` (exactly `length` bytes of segments), checked to be in the canonical split. */
function jpegStoreAt(bytes: Uint8Array, start: number, length: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let at = start, header: Uint8Array | undefined, total = 0;
  while (at < start + length) {
    if (at + 12 > start + length || bytes[at] !== 0xff || bytes[at + 1] !== 0xeb) fail("expected a C2PA APP11 segment.");
    const end = at + 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
    if (end > start + length || bytes[at + 4] !== 0x4a || bytes[at + 5] !== 0x50 || ((bytes[at + 6]! << 8) | bytes[at + 7]!) !== JPEG_EN || u32be(bytes, at + 8) !== parts.length + 1)
      fail("APP11 segments are not one contiguous C2PA sequence (CI 'JP', En 0x0211, Z from 1).");
    let data = at + 12;
    if (parts.length) {
      if (end < data + 8 || bytes.subarray(data, data + 8).some((v, i) => v !== header![i])) fail("APP11 continuation does not repeat the box's LBox and TBox.");
      data += 8;
    } else header = bytes.slice(data, data + 8);
    parts.push(bytes.subarray(data, end)); total += end - data; at = end;
  }
  const store = new Uint8Array(total);
  parts.reduce((offset, p) => (store.set(p, offset), offset + p.length), 0);
  checkStore(store);
  const canonical = jpegSegments(store);
  if (canonical.length !== length || canonical.some((v, i) => v !== bytes[start + i])) fail("APP11 segments are not split as 64,000-byte pieces.");
  return store;
}
/** Store bytes as JUMBF, or (`jpeg`) as already-split APP11 segments; returns the JUMBF. */
function storeFrom(value: Uint8Array, jpeg: boolean): Uint8Array {
  return jpeg && value[0] === 0xff && value[1] === 0xeb ? jpegStoreAt(value, 0, value.length) : checkStore(value);
}
interface JpegLayout { insertAt: number; c2pa: C2paByteRange | null }
/** Walks a JPEG's marker segments up to SOS (ITU-T T.81 B.1.1): where the leading APPn run ends, and any C2PA APP11 run. */
function jpegLayout(bytes: Uint8Array): JpegLayout {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("file is neither a JPEG nor a TIFF.");
  let at = 2, insertAt = -1, c2pa: C2paByteRange | null = null;
  for (;;) {
    if (at + 4 > bytes.length || bytes[at] !== 0xff) fail("JPEG marker structure is malformed before the scan.");
    const marker = bytes[at + 1]!;
    if (marker === 0xda) break;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) fail("JPEG has an unexpected marker before the scan.");
    const end = at + 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
    if (end - at < 4 || end > bytes.length) fail("JPEG segment length runs past the file.");
    if (insertAt < 0 && (marker < 0xe0 || marker > 0xef)) insertAt = at;
    if (marker === 0xeb && end - at >= 6 && bytes[at + 4] === 0x4a && bytes[at + 5] === 0x50) {
      if (c2pa && c2pa.start + c2pa.length !== at) fail("JPEG already has JUMBF APP11 segments that are not one contiguous run.");
      c2pa = { start: c2pa ? c2pa.start : at, length: end - (c2pa ? c2pa.start : at) };
    }
    at = end;
  }
  return { insertAt: insertAt < 0 ? at : insertAt, c2pa };
}

// ---- TIFF and DNG (§A.3.6, §18.5.5) ----

const TIFF_TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
/** Tags whose values are file offsets (StripOffsets, TileOffsets, JPEGInterchangeFormat) or IFD offsets (SubIFDs, Exif, GPS, Interoperability). */
const OFFSET_TAGS = new Set([273, 324, 513]), IFD_TAGS = new Set([330, 34665, 34853, 40965]);
/** Tags that may hold absolute offsets inside opaque data (MakerNote, DNGPrivateData): moving the file under them is unsafe. */
const OPAQUE_OFFSET_TAGS = new Set([37500, 50740]);
interface TiffReader { le: boolean; u16(p: number): number; u32(p: number): number }
function tiffReader(bytes: Uint8Array): TiffReader {
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!le && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) fail("file is neither a JPEG nor a TIFF.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r: TiffReader = {
    le,
    u16: (p) => (p < 0 || p + 2 > bytes.length ? fail("TIFF structure runs past the file.") : view.getUint16(p, le)),
    u32: (p) => (p < 0 || p + 4 > bytes.length ? fail("TIFF structure runs past the file.") : view.getUint32(p, le))
  };
  if (bytes.length < 8 || r.u16(2) !== 42) fail("only classic TIFF (not BigTIFF) is supported.");
  return r;
}
interface TiffMain { ifd: number; count: number; entries: { tag: number; at: number }[]; dng: boolean }
function tiffMain(bytes: Uint8Array, r: TiffReader): TiffMain {
  const ifd = r.u32(4), count = r.u16(ifd);
  if (count === 0 || r.u32(ifd + 2 + count * 12) !== 0) fail("TIFF must have exactly one main IFD (no IFD chain).");
  const entries = Array.from({ length: count }, (_, i) => ({ tag: r.u16(ifd + 2 + i * 12), at: ifd + 2 + i * 12 }));
  if (entries.some((e, i) => i > 0 && e.tag <= entries[i - 1]!.tag)) fail("TIFF main IFD entries are not in ascending tag order.");
  return { ifd, count, entries, dng: entries.some((e) => e.tag === 50706) };
}
/** Every 2- or 4-byte field holding a file offset, in the main IFD and every sub-IFD it points to (TIFF 6.0 §2; Exif 2.32 §4.6.3). */
function tiffOffsetFields(bytes: Uint8Array, r: TiffReader, main: number): Map<number, 2 | 4> {
  const fields = new Map<number, 2 | 4>(), seen = new Set<number>();
  const walk = (ifd: number, sub: boolean): void => {
    if (seen.has(ifd) || seen.size >= 64) fail("TIFF IFDs loop or are too many.");
    seen.add(ifd);
    const n = r.u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12, tag = r.u16(e), type = r.u16(e + 2), count = r.u32(e + 4), unit = TIFF_TYPE_SIZE[type];
      if (!unit) fail("TIFF entry has an unknown field type.");
      if (OPAQUE_OFFSET_TAGS.has(tag)) fail("TIFF has a MakerNote or DNGPrivateData, whose inner offsets cannot be moved safely.");
      const size = unit * count;
      if (!Number.isSafeInteger(size)) fail("TIFF entry is too large.");
      const value = size > 4 ? r.u32(e + 8) : e + 8;
      if (value + size > bytes.length) fail("TIFF entry data runs past the file.");
      if (size > 4) fields.set(e + 8, 4);
      if (OFFSET_TAGS.has(tag) || IFD_TAGS.has(tag)) {
        if (!(type === 3 && !IFD_TAGS.has(tag)) && type !== 4 && type !== 13) fail("TIFF offset tag has an unexpected type.");
        for (let k = 0; k < count; k++) {
          fields.set(value + k * unit, unit as 2 | 4);
          if (IFD_TAGS.has(tag)) walk(unit === 4 ? r.u32(value + k * 4) : r.u16(value + k * 2), true);
        }
      }
    }
    const next = ifd + 2 + n * 12;
    if (sub && r.u32(next) !== 0) { fields.set(next, 4); walk(r.u32(next), true); }
  };
  walk(main, false);
  return fields;
}
function bindTiff(file: Uint8Array, store: Uint8Array): C2paBoundFile {
  const r = tiffReader(file), main = tiffMain(file, r);
  if (main.entries.some((e) => e.tag === TIFF_C2PA_TAG)) fail("TIFF already has a C2PA manifest store (tag 52545); this adds the first one only.");
  const fields = tiffOffsetFields(file, r, main.ifd);
  // The new entry goes at its ascending place in the main IFD; every byte from there on moves 12 bytes, and every offset to
  // such a byte moves with it. 12 keeps every 2- and 4-byte alignment, and nothing before the insertion point moves.
  const index = main.entries.findIndex((e) => e.tag > TIFF_C2PA_TAG), insertAt = main.ifd + 2 + (index < 0 ? main.count : index) * 12;
  const storeStart = (file.length + 12 + 3) & ~3;
  if (storeStart + store.length > 0xffffffff) fail("TIFF with the store would exceed 4 GiB.");
  const out = new Uint8Array(storeStart + store.length), view = new DataView(out.buffer), le = r.le;
  out.set(file.subarray(0, insertAt));
  out.set(file.subarray(insertAt), insertAt + 12);
  view.setUint16(main.ifd, main.count + 1, le);
  view.setUint16(insertAt, TIFF_C2PA_TAG, le); view.setUint16(insertAt + 2, 7, le);
  view.setUint32(insertAt + 4, store.length, le); view.setUint32(insertAt + 8, storeStart, le);
  for (const [at, size] of fields) {
    const to = at >= insertAt ? at + 12 : at, value = size === 4 ? r.u32(at) : r.u16(at);
    if (value < insertAt) continue;
    if (size === 2) { if (value + 12 > 65535) fail("a SHORT offset would overflow."); view.setUint16(to, value + 12, le); } else view.setUint32(to, value + 12, le);
  }
  out.set(store, storeStart);
  const count = { start: insertAt + 4, length: 4 }, region = { start: storeStart, length: store.length };
  return { bytes: out, binding: { mediaType: main.dng ? "image/dng" : "image/tiff", fileLength: out.length, exclusions: [count, region], manifestRegion: region, manifestStoreLength: store.length } };
}
/** The C2PA entry of a bound TIFF: where its count field is and where its store is. */
function tiffStoreEntry(file: Uint8Array): { count: number; region: C2paByteRange } {
  const r = tiffReader(file), entry = tiffMain(file, r).entries.find((e) => e.tag === TIFF_C2PA_TAG);
  if (!entry || r.u16(entry.at + 2) !== 7) fail("TIFF has no C2PA manifest store entry (tag 52545, type 7).");
  const length = r.u32(entry.at + 4), start = r.u32(entry.at + 8);
  if (length <= 4 || start + length > file.length) fail("TIFF C2PA entry points outside the file.");
  return { count: entry.at + 4, region: { start, length } };
}

// ---- Public functions ----

/**
 * Embeds a placeholder C2PA Manifest Store in a JPEG or TIFF/DNG export and returns the new file with its hard binding:
 * the exclusions for `c2pa.hash.data` and where the store sits (C2PA 2.4 §A.3.1, §A.3.6, §18.5, §10.4; see the module notes).
 * The input file is not changed. Only the first store of a file can be added; a file that already has one is rejected.
 * @param input - The file and the placeholder store.
 * @returns The bound file (a new array) and its binding.
 *
 * @see docs/CONTENT_CREDENTIALS.md for the workflow and the byte layouts.
 */
export function bindC2paManifestStore(input: BindC2paManifestStoreInput): C2paBoundFile {
  requireInputKeys(input, "bindC2paManifestStore", ["file", "manifestStore"]);
  const r = input as unknown as Record<string, unknown>;
  const file = bytesOf(r.file, "file"), given = bytesOf(r.manifestStore, "manifestStore"), jpeg = file[0] === 0xff;
  const store = storeFrom(given, jpeg);
  if (!jpeg) return bindTiff(file, store);
  const layout = jpegLayout(file);
  if (layout.c2pa) fail("JPEG already has JUMBF APP11 segments; this adds the first manifest store only.");
  const segments = jpegSegments(store), out = new Uint8Array(file.length + segments.length);
  out.set(file.subarray(0, layout.insertAt)); out.set(segments, layout.insertAt); out.set(file.subarray(layout.insertAt), layout.insertAt + segments.length);
  const region = { start: layout.insertAt, length: segments.length };
  return { bytes: out, binding: { mediaType: "image/jpeg", fileLength: out.length, exclusions: [region], manifestRegion: region, manifestStoreLength: store.length } };
}

function parseBinding(value: unknown): C2paHardBinding {
  const b = requireAllowlistedRecord(value, ["mediaType", "fileLength", "exclusions", "manifestRegion", "manifestStoreLength"], "C2PA: invalid binding.");
  const range = (v: unknown): C2paByteRange => {
    const x = requireAllowlistedRecord(v, ["start", "length"], "C2PA: invalid byte range.");
    if (!Number.isSafeInteger(x.start) || !Number.isSafeInteger(x.length) || (x.start as number) < 0 || (x.length as number) < 1) fail("byte ranges need integer start ≥ 0 and length ≥ 1.");
    return { start: x.start as number, length: x.length as number };
  };
  if (!["image/jpeg", "image/dng", "image/tiff"].includes(b.mediaType as string) || !Number.isSafeInteger(b.fileLength) || !Number.isSafeInteger(b.manifestStoreLength) || !Array.isArray(b.exclusions))
    fail("binding needs mediaType, fileLength, exclusions, manifestRegion and manifestStoreLength.");
  return { mediaType: b.mediaType as C2paHardBinding["mediaType"], fileLength: b.fileLength as number, exclusions: (b.exclusions as unknown[]).map(range),
    manifestRegion: range(b.manifestRegion), manifestStoreLength: b.manifestStoreLength as number };
}
const sameRange = (a: C2paByteRange | undefined, b: C2paByteRange): boolean => a !== undefined && a.start === b.start && a.length === b.length;

/**
 * Writes the final, signed manifest store over the placeholder of a bound file (C2PA 2.4 §10.4.4). The store must have
 * exactly the placeholder's length, so the file's length, every offset and every byte outside the exclusions stay the same
 * and the data hash computed before signing still holds. The binding is checked against the file first.
 * @param input - The bound file, its binding and the signed store.
 * @returns A new array: the file with the signed store.
 *
 * @see docs/CONTENT_CREDENTIALS.md for the workflow.
 */
export function setC2paManifestStore(input: SetC2paManifestStoreInput): Uint8Array {
  requireInputKeys(input, "setC2paManifestStore", ["file", "binding", "manifestStore"]);
  const r = input as unknown as Record<string, unknown>;
  const file = bytesOf(r.file, "file"), binding = parseBinding(r.binding), jpeg = binding.mediaType === "image/jpeg";
  const store = storeFrom(bytesOf(r.manifestStore, "manifestStore"), jpeg);
  if (file.length !== binding.fileLength) fail("file length does not match the binding.");
  if (store.length !== binding.manifestStoreLength) fail("signed store is " + store.length + " B but the placeholder reserved " + binding.manifestStoreLength + " B; rebuild with a larger placeholder (§10.4).");
  const out = file.slice(), region = binding.manifestRegion;
  if (jpeg) {
    const found = jpegLayout(file).c2pa;
    if (!found || !sameRange(found, region) || !sameRange(binding.exclusions[0], region) || binding.exclusions.length !== 1) fail("binding does not match the JPEG's C2PA APP11 segments.");
    if (jpegStoreAt(file, region.start, region.length).length !== store.length) fail("placeholder in the file does not match the binding.");
    out.set(jpegSegments(store), region.start);
  } else {
    const found = tiffStoreEntry(file);
    if (!sameRange(found.region, region) || found.region.length !== store.length || binding.exclusions.length !== 2 ||
      !sameRange(binding.exclusions[0], { start: found.count, length: 4 }) || !sameRange(binding.exclusions[1], region)) fail("binding does not match the TIFF's C2PA entry.");
    checkStore(file.subarray(region.start, region.start + region.length));
    out.set(store, region.start);
  }
  return out;
}

/**
 * SHA-256 over every byte of a file outside the given exclusions, in file order: the value of `hash` in a `c2pa.hash.data`
 * assertion with `alg` "sha256" (C2PA 2.4 §18.5). It uses Web Crypto (`crypto.subtle`, browsers in secure contexts and
 * Node 22+). The bytes outside the exclusions are copied once into one array before hashing.
 * @param input - The file and its exclusions (ascending, non-overlapping, inside the file).
 * @returns The digest as bytes and hexadecimal, and how many bytes it covers.
 *
 * @see docs/CONTENT_CREDENTIALS.md for the workflow.
 */
export async function calculateC2paDataHash(input: CalculateC2paDataHashInput): Promise<C2paDataHash> {
  requireInputKeys(input, "calculateC2paDataHash", ["file", "exclusions"]);
  const r = input as unknown as Record<string, unknown>;
  const file = bytesOf(r.file, "file");
  if (!Array.isArray(r.exclusions)) fail("exclusions must be an array.");
  const exclusions = parseBinding({ mediaType: "image/jpeg", fileLength: 0, manifestRegion: { start: 0, length: 1 }, manifestStoreLength: 0, exclusions: r.exclusions }).exclusions;
  let end = 0, kept = file.length;
  for (const e of exclusions) {
    if (e.start < end || e.start + e.length > file.length) fail("exclusions must be ascending, non-overlapping and inside the file.");
    end = e.start + e.length; kept -= e.length;
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail("needs crypto.subtle (a secure browser context or Node 22+).");
  const data = new Uint8Array(kept);
  let from = 0, at = 0;
  for (const e of [...exclusions, { start: file.length, length: 0 }]) { data.set(file.subarray(from, e.start), at); at += e.start - from; from = e.start + e.length; }
  const hash = new Uint8Array(await subtle.digest("SHA-256", data));
  return { alg: "sha256", hash, hashHex: Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join(""), hashedByteCount: kept };
}
