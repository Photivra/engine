// SPDX-License-Identifier: Apache-2.0

/**
 * Optional caller-supplied text metadata for encoded images (2.4): a description, the creating software, a
 * copyright notice and a comment. The engine writes the caller's text unchanged and adds no text of its own
 * (in a DNG the description follows the existing simulated-RAW statement).
 * Independently written from these free specifications; no third-party source was used:
 *
 * - JPEG: the existing XMP packet in APP1 (Adobe XMP Specification Part 3, 2020, §1.1.3: identifier
 *   "http://ns.adobe.com/xap/1.0/" and a UTF-8 packet of at most 65 502 bytes, §1.1.3.1). The fields are added
 *   as one more top-level `rdf:Description` of the same resource (`rdf:about=""`): XMP Part 1 (2012, identical
 *   to ISO 16684-1:2011) §7.4 lets properties be "arbitrarily apportioned among the rdf:Description elements"
 *   of the single `rdf:RDF`. Mapping: `dc:description` and `dc:rights` as language alternatives with
 *   `x-default` (Part 1 §8.3), `xmp:CreatorTool` as text (Part 1 §8.4) and `exif:UserComment` as a language
 *   alternative (Part 2, 2022, §3.4, the Exif namespace). The comment is also a COM marker segment (ITU-T T.81
 *   §B.2.4.5, "the interpretation is left to the application"; written as UTF-8) after the APPn segments.
 * - PNG: one text chunk per field with the predefined keywords Description, Software, Copyright and Comment
 *   (W3C PNG Specification, Third Edition, §11.3.3.1, Table 21). `tEXt` (§11.3.3.2; printable Latin-1 plus line
 *   feed) when every character fits, otherwise an uncompressed `iTXt` (§11.3.3.4; UTF-8, empty language tag and
 *   translated keyword). The chunks go before the first IDAT, as §12.9 recommends for small text.
 * - DNG: `serializeNativeRawDng` writes the same XMP fields as a packet in TIFF tag 700 (XMP Part 3 §1.1.6,
 *   Table 13) plus the TIFF ASCII tags that XMP Part 3 §3.2.3 maps to them.
 *
 * Validation: each given field is a non-empty string of at most `OUTPUT_TEXT_METADATA_MAXIMUM_BYTES` UTF-8
 * bytes, with no unpaired UTF-16 surrogate (so it encodes to valid UTF-8 without replacement), no NUL or other
 * C0/C1 control character except line feed, and no U+FFFE/U+FFFF (not XML 1.0 characters). Line breaks are a
 * single line feed, as the PNG text chunks require.
 * 2.26.0 (owner decision 2026-11-16, "Move export code out"): the JPEG and PNG writers live in `text-metadata-writers.ts`, so the
 * capture worker loads them with the export kit (`src/facade/export-kit.ts`) only for JPEG or PNG output; the parser and the XMP
 * packet stay here (the DNG writer uses them).
 * Root exports (#388): `addJpegTextMetadata` and `addPngTextMetadata` add the text to a JPEG or PNG that the caller
 * encoded (for example a file assembled from `output.region` parts and `composePrintJpegStrips` or `serializePngImage`),
 * with the same bytes as `simulateCapture`'s `output.metadata`, which calls the same two functions.
 * @see docs/QUICK_START.md "Text metadata (2.4)".
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/** Caller-supplied text written into JPEG, PNG and DNG outputs. Every field is optional; at least one must be set. */
export interface OutputTextMetadata {
  /** What the image shows. JPEG/DNG `dc:description`, PNG Description, DNG ImageDescription (appended when ASCII). */
  description?: string;
  /** Name and version of the caller's software. JPEG/DNG `xmp:CreatorTool`, PNG Software. */
  software?: string;
  /** Rights statement. JPEG/DNG `dc:rights`; the PNG keyword and DNG tag 33432 (when ASCII) of the same name. */
  copyright?: string;
  /** Free-text comment. JPEG COM segment and `exif:UserComment`, PNG Comment, DNG `exif:UserComment`. */
  comment?: string;
}

/** Largest UTF-8 length of one metadata field, in bytes. Four escaped fields still fit one JPEG APP1 segment. */
export const OUTPUT_TEXT_METADATA_MAXIMUM_BYTES = 2048;
/** @internal The fields in writing order (shared with text-metadata-writers.ts). */
export const FIELDS = ["description", "software", "copyright", "comment"] as const;
/** @internal */
export type Field = typeof FIELDS[number];
/** PNG Third Edition §11.3.3.1 Table 21 keyword for each field: the field name with an initial capital. */
/** @internal */
export const pngKeyword = (field: Field): string => field[0]!.toUpperCase() + field.slice(1);
/** @internal */
export const XMP_IDENTIFIER = "http://ns.adobe.com/xap/1.0/\0";
/** Largest XMP packet in one JPEG APP1 segment (XMP Part 3 §1.1.3.1). */
/** @internal */
export const JPEG_XMP_MAXIMUM_PACKET_BYTES = 65502;
/** @internal */
// Typed structurally so the published declarations don't name TextEncoder, which consumers compiling
// with only the ES library (no DOM types) can't resolve.
export const encoder: { encode(input: string): Uint8Array } = new TextEncoder();

/**
 * Checks caller text metadata. Returns undefined when `value` is undefined, otherwise a frozen copy with only
 * the given fields. `path` prefixes the error messages, for example "output.metadata".
 */
export function parseOutputTextMetadata(value: unknown, path: string): Readonly<OutputTextMetadata> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidConfigurationError(path + " must be an object.");
  const out: OutputTextMetadata = {};
  for (const key of Object.keys(value)) if (!(FIELDS as readonly string[]).includes(key)) throw new InvalidConfigurationError("Unknown " + path + " field: " + key + ".");
  for (const field of FIELDS) {
    const text = (value as Record<string, unknown>)[field];
    if (text === undefined) continue;
    const name = path + "." + field;
    if (typeof text !== "string" || text.length === 0) throw new InvalidConfigurationError(name + " must be a non-empty string.");
    if (/\p{Cs}/u.test(text)) throw new InvalidConfigurationError(name + " must be valid Unicode text (it has an unpaired UTF-16 surrogate).");
    if (text.includes("\0")) throw new InvalidConfigurationError(name + " must not contain NUL characters.");
    // eslint-disable-next-line no-control-regex
    if (/[\u0001-\u0009\u000b-\u001f\u007f-\u009f￾￿]/u.test(text)) throw new InvalidConfigurationError(name + " must not contain control characters other than line feed (\\n), or U+FFFE/U+FFFF.");
    const bytes = encoder.encode(text).length;
    if (bytes > OUTPUT_TEXT_METADATA_MAXIMUM_BYTES) throw new InvalidConfigurationError(name + " must be at most " + OUTPUT_TEXT_METADATA_MAXIMUM_BYTES + " UTF-8 bytes (it has " + bytes + ").");
    out[field] = text;
  }
  if (Object.keys(out).length === 0) throw new InvalidConfigurationError(path + " must set at least one of description, software, copyright or comment.");
  return Object.freeze(out);
}

function xmlText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
const alt = (text: string): string => '<rdf:Alt><rdf:li xml:lang="x-default">' + xmlText(text) + "</rdf:li></rdf:Alt>";

/** One `rdf:Description` of the current resource with the given fields, declaring only the namespaces it uses. */
export function xmpTextMetadataDescription(metadata: Readonly<OutputTextMetadata>): string {
  const dc = metadata.description !== undefined || metadata.copyright !== undefined;
  return '<rdf:Description rdf:about=""' + (dc ? ' xmlns:dc="http://purl.org/dc/elements/1.1/"' : "") +
    (metadata.software !== undefined ? ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"' : "") +
    (metadata.comment !== undefined ? ' xmlns:exif="http://ns.adobe.com/exif/1.0/"' : "") + ">" +
    (metadata.description !== undefined ? "<dc:description>" + alt(metadata.description) + "</dc:description>" : "") +
    (metadata.copyright !== undefined ? "<dc:rights>" + alt(metadata.copyright) + "</dc:rights>" : "") +
    (metadata.software !== undefined ? "<xmp:CreatorTool>" + xmlText(metadata.software) + "</xmp:CreatorTool>" : "") +
    (metadata.comment !== undefined ? "<exif:UserComment>" + alt(metadata.comment) + "</exif:UserComment>" : "") + "</rdf:Description>";
}

/** A complete XMP packet (`x:xmpmeta` wrapper, no `xpacket` processing instructions) holding only the text fields. */
export function xmpTextMetadataPacket(metadata: Readonly<OutputTextMetadata>): Uint8Array {
  return encoder.encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    xmpTextMetadataDescription(metadata) + "</rdf:RDF></x:xmpmeta>");
}
