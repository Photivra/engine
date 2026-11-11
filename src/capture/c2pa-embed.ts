// SPDX-License-Identifier: Apache-2.0

/**
 * Content Credentials (C2PA) export writers: the engine half of #165. The engine embeds a finished, caller-built C2PA
 * Manifest Store in a JPEG, PNG or DNG export, reports the byte ranges the data hash must exclude, optionally computes that
 * SHA-256, writes the signed store back in place at the same length, and finds an existing store in a file. It never builds
 * JUMBF or COSE, verifies no signature, holds no keys and makes no network calls: the caller brings its own manifest builder,
 * signer and validator.
 *
 * Every rule cited is from the C2PA Technical Specification 2.4 (April 2026):
 *
 * - Manifest Store (§11.1.4.2): a JUMBF superbox labelled `c2pa` with JUMBF type UUID 63327061-0011-0010-8000-00AA00389B71.
 *   The engine checks only that outer framing (superbox, description box, UUID, label, child box lengths).
 * - JPEG (§A.3.1): the store is the data of APP11 marker segments (JPEG XT, ISO/IEC 18477-3), split per ISO 19566-5:2023 D.2,
 *   written in order and contiguous. Each segment carries CI = "JP", En (box instance number) and Z (packet sequence number,
 *   from 1); every continuation segment repeats the box's LBox and TBox. The engine writes what the C2PA reference SDK
 *   (c2pa-rs, `jpeg_io.rs`) writes, owner decision on #165: 64,000-byte pieces of the store, En = 0x0211, and the segments
 *   right after the last APP0 segment, or right after SOI when there is none.
 * - PNG (§A.3.2): the store is the data of one ancillary, private, not-safe-to-copy chunk 'caBX' (PNG 3rd edition §4.7.2), which
 *   should precede IDAT. As c2pa-rs (`png_io.rs`) does, the engine puts it right after IHDR.
 * - TIFF and DNG (§A.3.6): the store is the data of tag 52545 (0xCD41), type 7 (UNDEFINED), in the last IFD of the main chain.
 *   For a file with one main IFD the entry may sit in that IFD, which is where the engine puts it, in ascending tag order. The
 *   store goes at the end of the file, as the section recommends. The TIFF byte order does not apply inside the store.
 * - Data hash `c2pa.hash.data` (§18.5): the hash covers every byte except the exclusions, which are ascending and
 *   non-overlapping (§18.5.1). JPEG: one exclusion covering every C2PA APP11 segment, each FFEB marker and length field
 *   included (§18.5.3). PNG: one exclusion covering the whole caBX chunk: its Length and type (§18.5.4), its data, and its CRC,
 *   which changes with the data (c2pa-rs excludes the same 12 + n bytes). TIFF: the store's bytes and, as §18.5.5 recommends,
 *   the 4-byte count field of its IFD entry.
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
import { pngCrc32 } from "../output/png-encoder.js";

/** IPTC digital source type for media created purely by an algorithm (https://cv.iptc.org/newscodes/digitalsourcetype/). */
export const C2PA_ALGORITHMIC_MEDIA_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia" as const;
/** Largest manifest store the engine embeds or reads, bytes (an engine limit, not a C2PA one). */
export const C2PA_MANIFEST_STORE_MAXIMUM_BYTES = 33_554_432;

/** A byte range of a file: `start` is a zero-based offset, `length` a byte count. */
export interface C2paByteRange { start: number; length: number }
/**
 * Where the manifest store sits in a file and which bytes the data hash excludes. Plain data: it can be kept, sent to a
 * worker or serialized, and must be passed back unchanged to `setC2paManifestStore`.
 */
export interface C2paHardBinding {
  /** `image/jpeg`, `image/png`, or for TIFF files `image/dng` when the main IFD has DNGVersion (50706), otherwise `image/tiff`. */
  mediaType: "image/jpeg" | "image/png" | "image/dng" | "image/tiff";
  /** Length of the file with the store embedded, bytes. */
  fileLength: number;
  /** The `exclusions` of the `c2pa.hash.data` assertion, ascending and non-overlapping (§18.5). */
  exclusions: readonly C2paByteRange[];
  /** JPEG: every C2PA APP11 segment, markers and length fields included. PNG: the whole caBX chunk. TIFF/DNG: the store's own bytes. */
  manifestRegion: C2paByteRange;
  /** Length of the JUMBF manifest store itself, bytes. A replacement store must have exactly this length. */
  manifestStoreLength: number;
}
/** A file with a manifest store embedded, and its binding. */
export interface C2paBoundFile { bytes: Uint8Array; binding: C2paHardBinding }
/** A manifest store found in a file (`parseC2paManifestStore`): its binding and a copy of the store's JUMBF bytes. */
export interface C2paFoundManifestStore { binding: C2paHardBinding; manifestStore: Uint8Array }
/** Input of `bindC2paManifestStore`. */
export interface BindC2paManifestStoreInput {
  /** A JPEG, a PNG, or a TIFF-based file such as a DNG, as written by the engine's exporters. It is read, never changed. */
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
  /** The binding `bindC2paManifestStore` (or `parseC2paManifestStore`) returned for it. */
  binding: C2paHardBinding;
  /** The final, signed store: exactly `binding.manifestStoreLength` bytes, as JUMBF or (JPEG) in the same APP11 split. */
  manifestStore: Uint8Array;
}
/** Input of `parseC2paManifestStore`. */
export interface ParseC2paManifestStoreInput {
  /** A JPEG, PNG or TIFF-based file such as a DNG. It is read, never changed. */
  file: Uint8Array;
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

const JUMB = 0x6a756d62, JUMD = 0x6a756d64, CABX = 0x63614258, IHDR = 0x49484452, IEND = 0x49454e44;
const C2PA_UUID = [0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** c2pa-rs `MAX_JPEG_MARKER_SIZE` and its En; see the module notes. */
const JPEG_PIECE = 64_000, JPEG_EN = 0x0211;
const TIFF_C2PA_TAG = 52545;

function fail(message: string): never { throw new InvalidConfigurationError("C2PA: " + message); }
function bytesOf(value: unknown, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) fail(name + " must be a Uint8Array.");
  return value;
}
const u32be = (b: Uint8Array, p: number): number => ((b[p]! << 24) >>> 0) + (b[p + 1]! << 16) + (b[p + 2]! << 8) + b[p + 3]!;
const putU32be = (b: Uint8Array, p: number, v: number): void => { b.set([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255], p); };
/** True when `b` at `p` starts a JUMBF superbox whose description box has the C2PA UUID (§11.1.4.2). */
const isC2paSuperbox = (b: Uint8Array, p: number): boolean => p + 24 <= b.length && u32be(b, p + 4) === JUMB && u32be(b, p + 12) === JUMD && C2PA_UUID.every((v, i) => b[p + 16 + i] === v);

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

/**
 * A store located in a file: its binding, and where its bytes lie, in order (`pieces`; several for a JPEG). For JPEG the
 * continuation headers (`repeats`) repeat the store's first 8 bytes; for PNG `crc` is where the chunk's CRC goes.
 */
interface Located { binding: C2paHardBinding; pieces: C2paByteRange[]; repeats: number[]; crc?: number }
function gather(file: Uint8Array, at: Located): Uint8Array {
  const store = new Uint8Array(at.binding.manifestStoreLength);
  at.pieces.reduce((offset, p) => (store.set(file.subarray(p.start, p.start + p.length), offset), offset + p.length), 0);
  return checkStore(store);
}
function locatedOne(mediaType: C2paHardBinding["mediaType"], file: Uint8Array, region: C2paByteRange, store: C2paByteRange, extra?: Partial<Located>): Located {
  return { binding: { mediaType, fileLength: file.length, exclusions: [region], manifestRegion: region, manifestStoreLength: store.length }, pieces: [store], repeats: [], ...extra };
}

// ---- JPEG (§A.3.1, §18.5.3) ----

/** The APP11 segments for a store (ISO 19566-5 D.2), split as the reference SDK splits them. */
function jpegSegments(store: Uint8Array): Uint8Array {
  const pieces = Math.ceil(store.length / JPEG_PIECE);
  const out = new Uint8Array(pieces * 12 + (pieces - 1) * 8 + store.length);
  let at = 0;
  for (let i = 0; i < pieces; i++) {
    const piece = store.subarray(i * JPEG_PIECE, Math.min(store.length, (i + 1) * JPEG_PIECE)), lp = 2 + 8 + (i ? 8 : 0) + piece.length;
    out.set([0xff, 0xeb, lp >> 8, lp & 255, 0x4a, 0x50, JPEG_EN >> 8, JPEG_EN & 255], at); putU32be(out, at + 8, i + 1);
    at += 12;
    if (i) { out.set(store.subarray(0, 8), at); at += 8; }
    out.set(piece, at); at += piece.length;
  }
  return out;
}
/** A JUMBF APP11 segment (CI 'JP') at `at`: its En, Z and end, or null for any other segment. */
function app11(b: Uint8Array, at: number, end: number): { en: number; z: number } | null {
  return b[at + 1] === 0xeb && end - at >= 12 && b[at + 4] === 0x4a && b[at + 5] === 0x50 ? { en: (b[at + 6]! << 8) | b[at + 7]!, z: u32be(b, at + 8) } : null;
}
interface JpegLayout { app0End: number; located: Located | null }
/**
 * Walks a JPEG's marker segments up to SOS (ITU-T T.81 B.1.1): where the last APP0 ends, and the C2PA APP11 run if any. A run
 * starts at a JUMBF segment with Z = 1 whose box is the C2PA superbox; its continuations follow at once with the same En and
 * Z + 1 (§A.3.1). Other JUMBF APP11 segments (for example JPEG 360) are left alone.
 */
function jpegLayout(bytes: Uint8Array): JpegLayout {
  let at = 2, app0End = 2, run: { en: number; z: number; start: number; end: number; pieces: C2paByteRange[]; repeats: number[] } | null = null, done = false;
  for (;;) {
    if (at + 4 > bytes.length || bytes[at] !== 0xff) fail("JPEG marker structure is malformed before the scan.");
    const marker = bytes[at + 1]!;
    if (marker === 0xda) break;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) fail("JPEG has an unexpected marker before the scan.");
    const end = at + 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
    if (end - at < 4 || end > bytes.length) fail("JPEG segment length runs past the file.");
    if (marker === 0xe0) app0End = end;
    const box = app11(bytes, at, end);
    if (box && run && !done && box.en === run.en && run.end === at) {
      if (box.z !== run.z + 1 || end - at < 20 || bytes.subarray(at + 12, at + 20).some((v, i) => v !== bytes[run!.start + 12 + i])) fail("C2PA APP11 continuation is out of sequence or does not repeat LBox and TBox.");
      run.repeats.push(at + 12); run.pieces.push({ start: at + 20, length: end - at - 20 }); run.z++; run.end = end;
    } else if (box && box.z === 1 && isC2paSuperbox(bytes, at + 12)) {
      if (run) fail("JPEG has more than one C2PA manifest store.");
      run = { en: box.en, z: 1, start: at, end, pieces: [{ start: at + 12, length: end - at - 12 }], repeats: [] };
    } else if (box && run && box.en === run.en) fail("C2PA APP11 segments are not contiguous (§A.3.1).");
    else if (run) done = true;
    at = end;
  }
  if (!run) return { app0End, located: null };
  const region = { start: run.start, length: run.end - run.start }, length = run.pieces.reduce((s, p) => s + p.length, 0);
  return { app0End, located: { binding: { mediaType: "image/jpeg", fileLength: bytes.length, exclusions: [region], manifestRegion: region, manifestStoreLength: length },
    pieces: run.pieces, repeats: run.repeats } };
}
/** Store bytes as JUMBF, or (`jpeg`) as already-split APP11 segments in the reference split; returns the JUMBF. */
function storeFrom(value: Uint8Array, jpeg: boolean): Uint8Array {
  if (!(jpeg && value[0] === 0xff && value[1] === 0xeb)) return checkStore(value);
  // Read the segments as a JPEG would (behind a stand-in SOI and SOS), then require the reference split exactly.
  const wrapped = new Uint8Array(value.length + 6);
  wrapped.set([0xff, 0xd8]); wrapped.set(value, 2); wrapped.set([0xff, 0xda, 0, 2], value.length + 2);
  const found = jpegLayout(wrapped).located;
  if (!found || found.binding.manifestRegion.length !== value.length) fail("APP11 segments are not one contiguous C2PA sequence.");
  const store = gather(wrapped, found), canonical = jpegSegments(store);
  if (canonical.length !== value.length || canonical.some((v, i) => v !== value[i])) fail("APP11 segments are not split as 64,000-byte pieces with En 0x0211.");
  return store;
}

// ---- PNG (§A.3.2, §18.5.4) ----

/** Walks a PNG's chunks (PNG 3rd edition §5.3): where IHDR ends, and the caBX chunk if any. */
function pngLayout(bytes: Uint8Array): { ihdrEnd: number; located: Located | null } {
  let at = 8, ihdrEnd = -1, located: Located | null = null;
  for (;;) {
    if (at + 12 > bytes.length) fail("PNG ends before IEND.");
    const length = u32be(bytes, at), type = u32be(bytes, at + 4), end = at + 12 + length;
    if (length > 0x7fffffff || end > bytes.length) fail("PNG chunk runs past the file.");
    if (at === 8 && type !== IHDR) fail("PNG must start with IHDR.");
    if (type === IHDR) ihdrEnd = end;
    if (type === CABX) {
      if (located) fail("PNG has more than one caBX chunk.");
      located = locatedOne("image/png", bytes, { start: at, length: 12 + length }, { start: at + 8, length }, { crc: at + 8 + length });
    }
    at = end;
    if (type === IEND) return { ihdrEnd, located };
  }
}
function pngChunkCrc(file: Uint8Array, chunk: number, length: number): number { return pngCrc32(file.subarray(chunk + 4, chunk + 8 + length)); }

// ---- TIFF and DNG (§A.3.6, §18.5.5) ----

const TIFF_TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
/** Tags whose values are file offsets (StripOffsets, TileOffsets, JPEGInterchangeFormat) or IFD offsets (SubIFDs, Exif, GPS, Interoperability). */
const OFFSET_TAGS = new Set([273, 324, 513]), IFD_TAGS = new Set([330, 34665, 34853, 40965]);
/** Tags that may hold absolute offsets inside opaque data (MakerNote, DNGPrivateData): moving the file under them is unsafe. */
const OPAQUE_OFFSET_TAGS = new Set([37500, 50740]);
interface TiffReader { le: boolean; u16(p: number): number; u32(p: number): number }
function tiffReader(bytes: Uint8Array): TiffReader {
  const le = bytes[0] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r: TiffReader = {
    le,
    u16: (p) => (p < 0 || p + 2 > bytes.length ? fail("TIFF structure runs past the file.") : view.getUint16(p, le)),
    u32: (p) => (p < 0 || p + 4 > bytes.length ? fail("TIFF structure runs past the file.") : view.getUint32(p, le))
  };
  if (bytes.length < 8 || r.u16(2) !== 42) fail("only classic TIFF (not BigTIFF) is supported.");
  return r;
}
interface TiffIfd { ifd: number; count: number; entries: { tag: number; at: number }[] }
/** The main IFD chain (TIFF 6.0 §2), at most 64 IFDs. */
function tiffChain(r: TiffReader): TiffIfd[] {
  const chain: TiffIfd[] = [];
  for (let ifd = r.u32(4); ifd !== 0; ifd = r.u32(ifd + 2 + chain[chain.length - 1]!.count * 12)) {
    if (chain.length >= 64 || chain.some((c) => c.ifd === ifd)) fail("TIFF IFDs loop or are too many.");
    const count = r.u16(ifd);
    chain.push({ ifd, count, entries: Array.from({ length: count }, (_, i) => ({ tag: r.u16(ifd + 2 + i * 12), at: ifd + 2 + i * 12 })) });
  }
  if (chain.length === 0) fail("TIFF has no IFD.");
  return chain;
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
/** The C2PA entry of a TIFF, if any: it must be in the last IFD of the main chain (§A.3.6). */
function tiffLayout(file: Uint8Array): { r: TiffReader; chain: TiffIfd[]; located: Located | null } {
  const r = tiffReader(file), chain = tiffChain(r), dng = chain[0]!.entries.some((e) => e.tag === 50706);
  const holders = chain.filter((c) => c.entries.some((e) => e.tag === TIFF_C2PA_TAG));
  if (holders.length === 0) return { r, chain, located: null };
  const entries = holders.flatMap((c) => c.entries.filter((e) => e.tag === TIFF_C2PA_TAG));
  if (entries.length > 1 || holders[0] !== chain[chain.length - 1]) fail("TIFF C2PA entry must be one entry in the last IFD of the main chain (§A.3.6).");
  const at = entries[0]!.at, length = r.u32(at + 4), start = r.u32(at + 8);
  if (r.u16(at + 2) !== 7 || length <= 4 || start + length > file.length) fail("TIFF C2PA entry is not type 7 data inside the file.");
  // Another writer may put the store before the IFD; the exclusions are listed in ascending order either way (§18.5.1).
  const store = { start, length }, count = { start: at + 4, length: 4 };
  if (start < at + 8 && start + length > at + 4) fail("TIFF C2PA store overlaps its IFD entry.");
  return { r, chain, located: { binding: { mediaType: dng ? "image/dng" : "image/tiff", fileLength: file.length, exclusions: start < at ? [store, count] : [count, store], manifestRegion: store, manifestStoreLength: length },
    pieces: [store], repeats: [] } };
}
function bindTiff(file: Uint8Array, store: Uint8Array): C2paBoundFile {
  const { r, chain, located } = tiffLayout(file);
  if (located) fail("file already has a C2PA manifest store; this adds the first one only.");
  if (chain.length !== 1) fail("TIFF must have exactly one main IFD (no IFD chain).");
  const main = chain[0]!;
  if (main.entries.some((e, i) => i > 0 && e.tag <= main.entries[i - 1]!.tag)) fail("TIFF main IFD entries are not in ascending tag order.");
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
  return { bytes: out, binding: tiffLayout(out).located!.binding };
}

// ---- Format dispatch ----

type Format = "jpeg" | "png" | "tiff";
function formatOf(file: Uint8Array): Format {
  if (file.length >= 4 && file[0] === 0xff && file[1] === 0xd8) return "jpeg";
  if (file.length >= 8 && PNG_SIGNATURE.every((v, i) => file[i] === v)) return "png";
  if (file.length >= 8 && ((file[0] === 0x49 && file[1] === 0x49) || (file[0] === 0x4d && file[1] === 0x4d))) return "tiff";
  return fail("file is not a JPEG, PNG or TIFF.");
}
function locate(file: Uint8Array, format: Format): Located | null {
  return format === "jpeg" ? jpegLayout(file).located : format === "png" ? pngLayout(file).located : tiffLayout(file).located;
}
/** Inserts `chunk` at `at`. */
function spliced(file: Uint8Array, at: number, chunk: Uint8Array): Uint8Array {
  const out = new Uint8Array(file.length + chunk.length);
  out.set(file.subarray(0, at)); out.set(chunk, at); out.set(file.subarray(at), at + chunk.length);
  return out;
}

// ---- Public functions ----

/**
 * Embeds a placeholder C2PA Manifest Store in a JPEG, PNG or TIFF/DNG export and returns the new file with its hard binding:
 * the exclusions for `c2pa.hash.data` and where the store sits (C2PA 2.4 §A.3.1, §A.3.2, §A.3.6, §18.5, §10.4; see the module
 * notes). The input file is not changed. Only the first store of a file can be added; a file that already has one is rejected.
 * @param input - The file and the placeholder store.
 * @returns The bound file (a new array) and its binding.
 *
 * @see docs/CONTENT_CREDENTIALS.md for the workflow and the byte layouts.
 */
export function bindC2paManifestStore(input: BindC2paManifestStoreInput): C2paBoundFile {
  requireInputKeys(input, "bindC2paManifestStore", ["file", "manifestStore"]);
  const r = input as unknown as Record<string, unknown>;
  const file = bytesOf(r.file, "file"), given = bytesOf(r.manifestStore, "manifestStore"), format = formatOf(file);
  const store = storeFrom(given, format === "jpeg");
  if (format === "tiff") return bindTiff(file, store);
  let out: Uint8Array;
  if (format === "jpeg") {
    const layout = jpegLayout(file);
    if (layout.located) fail("file already has a C2PA manifest store; this adds the first one only.");
    out = spliced(file, layout.app0End, jpegSegments(store));
  } else {
    const layout = pngLayout(file);
    if (layout.located) fail("file already has a C2PA manifest store; this adds the first one only.");
    const chunk = new Uint8Array(12 + store.length);
    putU32be(chunk, 0, store.length); putU32be(chunk, 4, CABX); chunk.set(store, 8);
    putU32be(chunk, 8 + store.length, pngCrc32(chunk.subarray(4, 8 + store.length)));
    out = spliced(file, layout.ihdrEnd, chunk);
  }
  return { bytes: out, binding: locate(out, format)!.binding };
}

/**
 * Finds the C2PA Manifest Store embedded in a JPEG (APP11), PNG (caBX) or TIFF/DNG (tag 52545) and returns its location as a
 * binding (the exclusions the engine's own writer uses for that format) and a copy of the store. It checks the file's structure
 * and the store's outer framing only: it does not read the manifests, check the data hash or verify any signature. The
 * manifest's own `c2pa.hash.data` assertion is what a validator uses; this binding is what `setC2paManifestStore` needs.
 * @param input - The file.
 * @returns The store and its binding, or null when the file has none.
 *
 * @see docs/CONTENT_CREDENTIALS.md for the byte layouts.
 */
export function parseC2paManifestStore(input: ParseC2paManifestStoreInput): C2paFoundManifestStore | null {
  requireInputKeys(input, "parseC2paManifestStore", ["file"]);
  const file = bytesOf((input as unknown as Record<string, unknown>).file, "file"), found = locate(file, formatOf(file));
  if (!found) return null;
  if (found.binding.manifestStoreLength > C2PA_MANIFEST_STORE_MAXIMUM_BYTES) fail("manifest store is larger than 32 MiB.");
  return { binding: found.binding, manifestStore: gather(file, found) };
}

function parseBinding(value: unknown): C2paHardBinding {
  const b = requireAllowlistedRecord(value, ["mediaType", "fileLength", "exclusions", "manifestRegion", "manifestStoreLength"], "C2PA: invalid binding.");
  const range = (v: unknown): C2paByteRange => {
    const x = requireAllowlistedRecord(v, ["start", "length"], "C2PA: invalid byte range.");
    if (!Number.isSafeInteger(x.start) || !Number.isSafeInteger(x.length) || (x.start as number) < 0 || (x.length as number) < 1) fail("byte ranges need integer start ≥ 0 and length ≥ 1.");
    return { start: x.start as number, length: x.length as number };
  };
  if (!["image/jpeg", "image/png", "image/dng", "image/tiff"].includes(b.mediaType as string) || !Number.isSafeInteger(b.fileLength) || !Number.isSafeInteger(b.manifestStoreLength) || !Array.isArray(b.exclusions))
    fail("binding needs mediaType, fileLength, exclusions, manifestRegion and manifestStoreLength.");
  return { mediaType: b.mediaType as C2paHardBinding["mediaType"], fileLength: b.fileLength as number, exclusions: (b.exclusions as unknown[]).map(range),
    manifestRegion: range(b.manifestRegion), manifestStoreLength: b.manifestStoreLength as number };
}

/**
 * Writes the final, signed manifest store over the placeholder of a bound file (C2PA 2.4 §10.4.4). The store must have
 * exactly the placeholder's length, so the file's length, every offset and every byte outside the exclusions stay the same
 * and the data hash computed before signing still holds. The binding is checked against the file first. The new store goes
 * into the file's existing segments or chunk as they are (for PNG the chunk CRC is recomputed; it is inside the exclusion).
 * @param input - The bound file, its binding and the signed store.
 * @returns A new array: the file with the signed store.
 *
 * @see docs/CONTENT_CREDENTIALS.md for the workflow.
 */
export function setC2paManifestStore(input: SetC2paManifestStoreInput): Uint8Array {
  requireInputKeys(input, "setC2paManifestStore", ["file", "binding", "manifestStore"]);
  const r = input as unknown as Record<string, unknown>;
  const file = bytesOf(r.file, "file"), binding = parseBinding(r.binding), format = formatOf(file);
  const store = storeFrom(bytesOf(r.manifestStore, "manifestStore"), format === "jpeg");
  const found = locate(file, format);
  if (!found) fail("file has no C2PA manifest store to replace.");
  if (JSON.stringify(found.binding) !== JSON.stringify(binding)) fail("binding does not match the file's manifest store.");
  if (store.length !== binding.manifestStoreLength) fail("signed store is " + store.length + " B but the placeholder reserved " + binding.manifestStoreLength + " B; rebuild with a larger placeholder (§10.4).");
  gather(file, found);
  const out = file.slice();
  found.pieces.reduce((offset, p) => (out.set(store.subarray(offset, offset + p.length), p.start), offset + p.length), 0);
  for (const at of found.repeats) out.set(store.subarray(0, 8), at);
  if (found.crc !== undefined) putU32be(out, found.crc, pngChunkCrc(out, binding.manifestRegion.start, store.length));
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
