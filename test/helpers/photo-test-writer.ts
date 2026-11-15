// SPDX-License-Identifier: Apache-2.0

/**
 * Test-only synthetic JPEG and HEIF header writers for the photo metadata tests. Written from ITU-T T.81 (markers), Exif 2.32
 * (APP1), CIPA DC-007-2009 (MPF), Adobe XMP Part 3 and ISO/IEC 14496-12 (boxes); never imported by `src/`. The files carry no
 * real image data: the scan is a few filler bytes, and HEIF items point at placeholder bytes.
 */

import { writeTiff, type IfdSpec, type TagSpec } from "./dng-test-writer.js";

export const ascii = (s: string): number[] => [...new TextEncoder().encode(s), 0];
const enc = (s: string): number[] => [...new TextEncoder().encode(s)];
const be16 = (v: number): number[] => [v >>> 8 & 255, v & 255];
const be32 = (v: number): number[] => [v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255];

/** An Exif block (TIFF header first): IFD 0 tags, an Exif IFD and an optional IFD 1 thumbnail. */
export function exifBlock(little: boolean, ifd0: TagSpec[], exif: TagSpec[] | null, thumbnail?: { jpeg: Uint8Array; tags?: TagSpec[] }): Uint8Array {
  const chain: IfdSpec[] = [{ tags: ifd0, ...(exif ? { exifIfd: { tags: exif } } : {}) }];
  if (thumbnail) chain.push({ tags: [{ id: 259, type: 3, values: [6] }, ...(thumbnail.tags ?? [])], chunks: { offsetTag: 513, countTag: 514, data: [thumbnail.jpeg] } });
  return writeTiff(little, chain);
}

/** One marker segment: FF marker, length, payload. */
export function segment(marker: number, payload: readonly number[] | Uint8Array): number[] {
  return [0xff, marker, ...be16(payload.length + 2), ...payload];
}
export const exifSegment = (block: Uint8Array): number[] => segment(0xe1, [...enc("Exif"), 0, 0, ...block]);
export const xmpSegment = (packet: string): number[] => segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), ...enc(packet)]);
/** Extended XMP chunks (Adobe XMP Part 3): GUID, full length, offset, data. */
export function extendedXmpSegments(packet: string, guid: string, chunkSize: number): number[] {
  const bytes = enc(packet), out: number[] = [];
  for (let at = 0; at < bytes.length; at += chunkSize) {
    out.push(...segment(0xe1, [...ascii("http://ns.adobe.com/xmp/extension/"), ...enc(guid.padEnd(32, "0").slice(0, 32)), ...be32(bytes.length), ...be32(at), ...bytes.slice(at, at + chunkSize)]));
  }
  return out;
}
/** A baseline frame header (SOF0) for a width × height, 3-component image. */
export const sof0 = (width: number, height: number): number[] => segment(0xc0, [8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
/** SOI, the segments, SOF0, a scan header and filler scan bytes, EOI. */
export function jpeg(width: number, height: number, segments: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), ...sof0(width, height), ...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0x56, 0xff, 0x00, 0x78, 0xff, 0xd9]);
}

/** An APP2 MPF segment's payload with the given entries (attribute, size, offset), the TIFF in `little` order. */
export function mpfPayload(little: boolean, entries: { attribute: number; size: number; offset: number }[]): number[] {
  const entryBytes: number[] = [];
  const put32 = (v: number): void => { const b = be32(v); entryBytes.push(...(little ? b.reverse() : b)); };
  for (const e of entries) { put32(e.attribute); put32(e.size); put32(e.offset); entryBytes.push(0, 0, 0, 0); }
  const tiff = writeTiff(little, [{ tags: [{ id: 0xb000, type: 7, values: enc("0100") }, { id: 0xb001, type: 4, values: [entries.length] }, { id: 0xb002, type: 7, values: entryBytes }] }]);
  return [...enc("MPF"), 0, ...tiff];
}
/**
 * A Multi-Picture Format file: the primary JPEG (its APP2 MPF segment first after SOI) followed by the secondary JPEGs. The MPF
 * offsets are relative to the MPF TIFF header, as CIPA DC-007-2009 defines them.
 */
export function multiPicture(little: boolean, primary: { width: number; height: number; segments: number[][] }, secondary: { attribute: number; jpeg: Uint8Array }[],
  primaryAttribute = 0x20030000): Uint8Array {
  const build = (offsets: number[], primarySize: number): Uint8Array => {
    const entries = [{ attribute: primaryAttribute, size: primarySize, offset: 0 }, ...secondary.map((s, i) => ({ attribute: s.attribute, size: s.jpeg.length, offset: offsets[i]! }))];
    return jpeg(primary.width, primary.height, [segment(0xe2, mpfPayload(little, entries)), ...primary.segments]);
  };
  const first = build(secondary.map(() => 0), 0);
  const base = 2 + 4 + 4; // SOI, APP2 marker and length, "MPF\0"
  const offsets: number[] = [];
  let at = first.length;
  for (const s of secondary) { offsets.push(at - base); at += s.jpeg.length; }
  const head = build(offsets, first.length);
  return Uint8Array.from([...head, ...secondary.flatMap((s) => [...s.jpeg])]);
}

// ---------------------------------------------------------------- HEIF

export const box = (type: string, ...parts: (readonly number[])[]): number[] => {
  const body = parts.flat();
  return [...be32(body.length + 8), ...enc(type), ...body];
};
export const fullBox = (type: string, version: number, flags: number, ...parts: (readonly number[])[]): number[] => box(type, [version, flags >>> 16 & 255, flags >>> 8 & 255, flags & 255], ...parts);

export interface HeifItemSpec {
  id: number;
  type: string;
  contentType?: string;
  /** Property indices (1-based into `properties`). */
  properties?: number[];
  /** Item data, placed in mdat (method 0) or idat (method 1). */
  data?: readonly number[];
  inIdat?: boolean;
}
export interface HeifSpec {
  brands?: string[];
  primary: number;
  items: HeifItemSpec[];
  properties: number[][];
  references?: { type: string; from: number; to: number[] }[];
  /** ipma version and flags (flags bit 0: 16-bit property indices). */
  ipma?: { version: number; flags: number };
  /** iloc version (1 or 2 allow idat). */
  ilocVersion?: number;
  /** Bytes appended after mdat's items (to make a long file). */
  trailing?: number;
}
export const ispe = (w: number, h: number): number[] => fullBox("ispe", 0, 0, be32(w), be32(h));
export const auxC = (urn: string): number[] => fullBox("auxC", 0, 0, ascii(urn));
export const irot = (quarterTurns: number): number[] => box("irot", [quarterTurns & 3]);
export const imir = (axis: number): number[] => box("imir", [axis & 1]);

/** A HEIF file: ftyp, meta (hdlr, pitm, iinf, iref, iprp, iloc, idat) and mdat holding the item data. */
export function heif(spec: HeifSpec): Uint8Array {
  const brands = spec.brands ?? ["heic", "mif1", "heic"];
  const ftyp = box("ftyp", enc(brands[0]!), be32(0), ...brands.slice(1).map(enc));
  const ilocVersion = spec.ilocVersion ?? 1;
  const ipma = spec.ipma ?? { version: 0, flags: 0 };
  const idatItems = spec.items.filter((i) => i.data && i.inIdat), mdatItems = spec.items.filter((i) => i.data && !i.inIdat);
  const build = (mdatStart: number): number[] => {
    const infe = spec.items.map((i) => fullBox("infe", 2, 0, be16(i.id), be16(0), enc(i.type), ascii(""), i.contentType ? ascii(i.contentType) : []));
    const iinf = fullBox("iinf", 0, 0, be16(spec.items.length), ...infe);
    const iref = spec.references ? fullBox("iref", 0, 0, ...spec.references.map((r) => box(r.type, be16(r.from), be16(r.to.length), ...r.to.map(be16)))) : [];
    const associations = spec.items.filter((i) => i.properties?.length);
    const ipmaBox = fullBox("ipma", ipma.version, ipma.flags, be32(associations.length), ...associations.map((i) => [
      ...(ipma.version < 1 ? be16(i.id) : be32(i.id)), i.properties!.length, ...i.properties!.flatMap((p) => (ipma.flags & 1 ? be16(p) : [p]))]));
    const iprp = box("iprp", box("ipco", ...spec.properties), ipmaBox);
    let mdatAt = mdatStart, idatAt = 0;
    const located = spec.items.filter((i) => i.data);
    const ilocEntries = located.map((i) => {
      const offset = i.inIdat ? idatAt : mdatAt;
      if (i.inIdat) idatAt += i.data!.length; else mdatAt += i.data!.length;
      return [...(ilocVersion < 2 ? be16(i.id) : be32(i.id)), ...(ilocVersion >= 1 ? be16(i.inIdat ? 1 : 0) : []), ...be16(0), ...be16(1), ...be32(offset), ...be32(i.data!.length)];
    });
    const iloc = fullBox("iloc", ilocVersion, 0, [0x44, 0x00], ilocVersion < 2 ? be16(located.length) : be32(located.length), ...ilocEntries);
    const idat = idatItems.length ? box("idat", ...idatItems.map((i) => i.data!)) : [];
    const meta = fullBox("meta", 0, 0, fullBox("hdlr", 0, 0, be32(0), enc("pict"), be32(0), be32(0), be32(0), [0]), fullBox("pitm", 0, 0, be16(spec.primary)), iinf, iref, iprp, iloc, idat);
    return [...ftyp, ...meta];
  };
  const head = build(0);
  const withOffsets = build(head.length + 8);
  const mdat = box("mdat", ...mdatItems.map((i) => i.data!), Array<number>(spec.trailing ?? 0).fill(0));
  return Uint8Array.from([...withOffsets, ...mdat]);
}
