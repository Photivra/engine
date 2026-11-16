// SPDX-License-Identifier: Apache-2.0

/**
 * The JPEG and PNG writers of the caller's text metadata (2.4, #388), split from `text-metadata.ts` in 2.26.0 (owner decision
 * 2026-11-16, "Move export code out") so the capture worker loads them with the export kit only for JPEG or PNG output. The bytes
 * are unchanged; the specifications and validation are described in `text-metadata.ts`.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { pngCrc32 } from "./png-encoder.js";
import { encoder, FIELDS, JPEG_XMP_MAXIMUM_PACKET_BYTES, parseOutputTextMetadata, pngKeyword, XMP_IDENTIFIER, xmpTextMetadataDescription, xmpTextMetadataPacket,
  type OutputTextMetadata } from "./text-metadata.js";

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function segment(marker: number, payload: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255), payload]);
}
function startsWith(bytes: Uint8Array, offset: number, prefix: Uint8Array): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[offset + i] !== prefix[i]) return false;
  return true;
}

/** The checked metadata of a root writer: an object of the given fields, `metadata` in the messages. */
function requireTextMetadata(value: unknown, writer: string): Readonly<OutputTextMetadata> {
  if (value === undefined) throw new InvalidConfigurationError(writer + " metadata must be an object.");
  return parseOutputTextMetadata(value, writer + " metadata")!;
}

/**
 * Returns a copy of a baseline JPEG with the text fields added: merged into its XMP APP1 packet (or a new packet
 * after the last leading APPn segment when it has none), plus a COM segment for `comment`. Every other byte,
 * including the entropy-coded data, is unchanged. Reads marker segments only up to SOS. The engine's own
 * `output.metadata` path calls this function, so for the same JPEG and text the bytes are the same.
 *
 * Root export (#388). `metadata` is checked as `output.metadata` is (see the module notes); a JPEG without SOI,
 * a malformed or truncated segment before SOS, an XMP APP1 segment after a non-APPn segment, an XMP packet that is
 * not UTF-8 or has no `rdf:RDF`, or text that makes the packet larger than one APP1 segment fails with
 * `InvalidConfigurationError`. The input is not changed.
 * @param jpeg A baseline JPEG stream, for example `createPrintJpegTask`'s or `composePrintJpegStrips`'s bytes.
 * @param metadata The text: at least one of description, software, copyright and comment.
 * @returns A new array holding the JPEG with the text.
 */
export function addJpegTextMetadata(jpeg: Uint8Array, metadata: Readonly<OutputTextMetadata>): Uint8Array {
  if (!(jpeg instanceof Uint8Array)) throw new InvalidConfigurationError("addJpegTextMetadata jpeg must be a Uint8Array.");
  const text = requireTextMetadata(metadata, "addJpegTextMetadata");
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new InvalidConfigurationError("JPEG text metadata needs a JPEG stream starting with SOI.");
  const identifier = encoder.encode(XMP_IDENTIFIER);
  let offset = 2, xmp: { start: number; end: number } | undefined, appEnd = 2, inLeadingApps = true;
  for (;;) {
    if (offset + 4 > jpeg.length || jpeg[offset] !== 0xff) throw new InvalidConfigurationError("JPEG text metadata found a malformed marker segment.");
    const marker = jpeg[offset + 1]!;
    if (marker === 0xda) break;
    // Before SOS every marker has a length (T.81 B.1.1.4): SOI, EOI, RSTm, TEM and fill bytes there are malformed.
    const length = (jpeg[offset + 2]! << 8) | jpeg[offset + 3]!;
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9) || length < 2) throw new InvalidConfigurationError("JPEG text metadata found a malformed marker segment.");
    const end = offset + 2 + length;
    if (end > jpeg.length) throw new InvalidConfigurationError("JPEG text metadata found a truncated marker segment.");
    if (marker === 0xe1 && !xmp && startsWith(jpeg, offset + 4, identifier)) {
      // The packet is rewritten in place, so it must lie in the leading APPn run that the COM segment follows.
      if (!inLeadingApps) throw new InvalidConfigurationError("JPEG text metadata found an XMP APP1 segment after a non-APPn segment.");
      xmp = { start: offset, end };
    }
    if (inLeadingApps && marker >= 0xe0 && marker <= 0xef) appEnd = end; else inLeadingApps = false;
    offset = end;
  }
  const description = xmpTextMetadataDescription(text);
  let xmpPacket: Uint8Array;
  if (xmp) {
    let packet: string;
    try { packet = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(jpeg.subarray(xmp.start + 4 + identifier.length, xmp.end)); }
    catch { throw new InvalidConfigurationError("JPEG text metadata found an XMP packet that is not valid UTF-8."); }
    const close = packet.lastIndexOf("</rdf:RDF>");
    if (close < 0) throw new InvalidConfigurationError("JPEG text metadata found an XMP packet without rdf:RDF.");
    xmpPacket = encoder.encode(packet.slice(0, close) + description + packet.slice(close));
  } else xmpPacket = xmpTextMetadataPacket(text);
  if (xmpPacket.length > JPEG_XMP_MAXIMUM_PACKET_BYTES) throw new InvalidConfigurationError("The text metadata makes the JPEG XMP packet " + xmpPacket.length + " bytes; one APP1 segment holds at most " + JPEG_XMP_MAXIMUM_PACKET_BYTES + ".");
  const xmpSegment = segment(0xe1, concat([identifier, xmpPacket]));
  const com = text.comment === undefined ? new Uint8Array(0) : segment(0xfe, encoder.encode(text.comment));
  if (xmp) return concat([jpeg.subarray(0, xmp.start), xmpSegment, jpeg.subarray(xmp.end, appEnd), com, jpeg.subarray(appEnd)]);
  return concat([jpeg.subarray(0, appEnd), xmpSegment, com, jpeg.subarray(appEnd)]);
}

function latin1Text(text: string): boolean {
  for (const ch of text) { const c = ch.codePointAt(0)!; if (!(c === 10 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff))) return false; }
  return true;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer), typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0));
  view.setUint32(0, data.length); out.set(typeBytes, 4); out.set(data, 8); view.setUint32(8 + data.length, pngCrc32(data, pngCrc32(typeBytes)));
  return out;
}
/** The text chunks for the given fields, in the order description, software, copyright, comment. */
export function pngTextMetadataChunks(metadata: Readonly<OutputTextMetadata>): Uint8Array[] {
  return FIELDS.filter((field) => metadata[field] !== undefined).map((field) => {
    const keyword = Uint8Array.from(pngKeyword(field), (c) => c.charCodeAt(0)), text = metadata[field]!;
    // tEXt: keyword, NUL, Latin-1 text. iTXt: keyword, NUL, compression flag 0, method 0, empty language tag, NUL, empty translated keyword, NUL, UTF-8 text.
    return latin1Text(text) ? pngChunk("tEXt", concat([keyword, Uint8Array.of(0), Uint8Array.from(text, (c) => c.charCodeAt(0))]))
      : pngChunk("iTXt", concat([keyword, Uint8Array.of(0, 0, 0, 0, 0), encoder.encode(text)]));
  });
}

/**
 * Returns a copy of a PNG with one text chunk per field inserted before the first IDAT chunk. Other chunks are
 * unchanged. The engine's own `output.metadata` path calls this function, so for the same PNG and text the bytes
 * are the same.
 *
 * Root export (#388). `metadata` is checked as `output.metadata` is (see the module notes); a file without the PNG
 * signature, or without an IDAT chunk inside its bytes, fails with `InvalidConfigurationError`. Chunk CRCs before
 * IDAT are not checked. The input is not changed.
 * @param png A PNG file, for example `serializePngImage`'s bytes.
 * @param metadata The text: at least one of description, software, copyright and comment.
 * @returns A new array holding the PNG with the text.
 */
export function addPngTextMetadata(png: Uint8Array, metadata: Readonly<OutputTextMetadata>): Uint8Array {
  if (!(png instanceof Uint8Array)) throw new InvalidConfigurationError("addPngTextMetadata png must be a Uint8Array.");
  const text = requireTextMetadata(metadata, "addPngTextMetadata");
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 8 || signature.some((b, i) => png[i] !== b)) throw new InvalidConfigurationError("PNG text metadata needs a PNG signature.");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = view.getUint32(offset), type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type === "IDAT") return concat([png.subarray(0, offset), ...pngTextMetadataChunks(text), png.subarray(offset)]);
    offset += 12 + length;
  }
  throw new InvalidConfigurationError("PNG text metadata found no IDAT chunk.");
}
