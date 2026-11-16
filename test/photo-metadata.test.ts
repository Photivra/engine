// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  parsePhotoMetadata, parseDngRawImage, InvalidConfigurationError, PHOTO_METADATA_LIMITS, PHOTO_METADATA_SCHEMA_VERSION, serializePngImage, type PhotoMetadata
} from "../src/index.js";
import { pngCrc32 } from "../src/output/png-encoder.js";
import { writeTiff, packBits, type TagSpec } from "./helpers/dng-test-writer.js";
import {
  ascii, auxC, box, exifBlock, exifSegment, extendedXmpSegments, fullBox, heif, imir, irot, ispe, jpeg, mpfPayload, multiPicture, segment, xmpSegment, type HeifSpec
} from "./helpers/photo-test-writer.js";

/*
 * 2.25.0 (#617): the JPEG and HEIF metadata reader. Every file here is synthetic, built by test/helpers/photo-test-writer.ts from
 * the format specifications; no photo is used. Vendor-style auxiliary URNs use the reserved "example" namespace.
 */

const RATIONAL = 5;
const IFD0: TagSpec[] = [{ id: 271, type: 2, values: ascii("Example Make") }, { id: 272, type: 2, values: ascii("Example Model") },
  { id: 274, type: 3, values: [6] }, { id: 305, type: 2, values: ascii("1.2.3") }];
const EXIF: TagSpec[] = [{ id: 33434, type: RATIONAL, values: [1, 120] }, { id: 33437, type: RATIONAL, values: [18, 10] }, { id: 34855, type: 3, values: [64] },
  { id: 34864, type: 3, values: [2] }, { id: 34866, type: 4, values: [64] }, { id: 37386, type: RATIONAL, values: [62, 10] }, { id: 41989, type: 3, values: [27] },
  { id: 41988, type: RATIONAL, values: [200, 100] }, { id: 42080, type: 3, values: [2] }, { id: 42081, type: 3, values: [6, 4] },
  { id: 41486, type: RATIONAL, values: [4000, 1] }, { id: 41487, type: RATIONAL, values: [4000, 1] }, { id: 41488, type: 3, values: [3] },
  { id: 40962, type: 4, values: [4032] }, { id: 40963, type: 4, values: [3024] }, { id: 37396, type: 3, values: [2016, 1512, 400, 300] },
  // #648: SubjectDistance 3.5 m and SubjectDistanceRange "close view".
  { id: 37382, type: RATIONAL, values: [350, 100] }, { id: 41996, type: 3, values: [2] }];
const EXPECTED_EXIF = {
  make: "Example Make", model: "Example Model", software: "1.2.3", orientation: 6,
  exposureTimeSeconds: 1 / 120, fNumber: 1.8, focalLengthMillimeters: 6.2, focalLengthIn35mmFilmMillimeters: 27, digitalZoomRatio: 2,
  focalPlaneResolution: { x: 4000, y: 4000, unit: "centimeter", unitStated: true, pixelsPerMillimeterX: 400, pixelsPerMillimeterY: 400 },
  pixelDimensions: { width: 4032, height: 3024 }, photographicSensitivity: 64, sensitivityType: 2, standardOutputSensitivity: null, recommendedExposureIndex: 64,
  isoSpeed: null, iso: 64, isoSource: "recommended-exposure-index", compositeImage: 2, compositeSourceImages: { total: 6, used: 4 },
  subjectArea: { kind: "rectangle", x: 2016, y: 1512, width: 400, height: 300 }, subjectDistanceMeters: 3.5, subjectDistanceRange: "close-view"
};
const GAIN_MAP_XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"/></rdf:RDF></x:xmpmeta>';
const CONTAINER_XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description ' +
  'xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/">' +
  '<Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/></rdf:li>' +
  '<rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="321"/></rdf:li>' +
  '<rdf:li rdf:parseType="Resource"><Container:Item><Item:Semantic>Depth</Item:Semantic><Item:Length>99</Item:Length></Container:Item></rdf:li>' +
  '</rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>';
const DEPTH_XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description xmlns:GDepth="http://ns.google.com/photos/1.0/depthmap/" xmlns:GImage="http://ns.google.com/photos/1.0/image/" GDepth:Format="RangeInverse"/></x:xmpmeta>';

/** A 16 × 12 CFA DNG with these Exif IFD tags (and IFD 0 tags). */
function minimalDng(exif: TagSpec[], ifd0: TagSpec[] = []): Uint8Array {
  const width = 16, height = 12, codes = new Uint16Array(width * height);
  return writeTiff(true, [{
    tags: [{ id: 254, type: 4, values: [0] }, { id: 256, type: 4, values: [width] }, { id: 257, type: 4, values: [height] }, { id: 258, type: 3, values: [16] },
      { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [32803] }, { id: 277, type: 3, values: [1] }, { id: 278, type: 4, values: [height] },
      { id: 33421, type: 3, values: [2, 2] }, { id: 33422, type: 1, values: [0, 1, 1, 2] }, { id: 50706, type: 1, values: [1, 6, 0, 0] }, ...ifd0],
    chunks: { offsetTag: 273, countTag: 279, data: [packBits(codes, width, 16, true)] }, exifIfd: { tags: exif }
  }]);
}
const thumbnailJpeg = jpeg(160, 120, []);
function phoneJpeg(little = true): Uint8Array {
  const gainMap = jpeg(1008, 756, [xmpSegment(GAIN_MAP_XMP)]), disparity = jpeg(640, 480, []);
  return multiPicture(little, {
    width: 4032, height: 3024,
    segments: [exifSegment(exifBlock(little, IFD0, EXIF, { jpeg: thumbnailJpeg })), xmpSegment(CONTAINER_XMP), extendedXmpSegments(DEPTH_XMP, "A".repeat(32), 40),
      segment(0xe2, [...ascii("urn:iso:std:iso:ts:21496:-1"), 0, 0, 1, 2, 3])]
  }, [{ attribute: 0x000000, jpeg: gainMap }, { attribute: 0x020002, jpeg: disparity }]);
}

describe("parsePhotoMetadata: JPEG (2.25.0, #617)", () => {
  it("reads the Exif capture fields, the thumbnail, MPF entries, XMP markers and ISO 21496-1 metadata", () => {
    for (const little of [true, false]) {
      const meta = parsePhotoMetadata({ bytes: phoneJpeg(little) });
      expect(meta.schemaVersion).toBe(PHOTO_METADATA_SCHEMA_VERSION);
      expect(meta).toMatchObject({ format: "jpeg", brands: [], width: 4032, height: 3024, heifRotationDegrees: null, heifMirrorAxis: null });
      expect(meta.exif).toEqual(EXPECTED_EXIF);
      expect(meta.extraImages).toEqual([
        { source: "exif-thumbnail", kind: "thumbnail", kindBasis: "specification", type: "jpeg", width: 160, height: 120, bytes: thumbnailJpeg.length },
        { source: "jpeg-mpf", kind: "gain-map", kindBasis: "xmp", type: "0x000000", width: 1008, height: 756, bytes: expect.any(Number) },
        { source: "jpeg-mpf", kind: "disparity", kindBasis: "specification", type: "0x020002", width: 640, height: 480, bytes: expect.any(Number) }]);
      expect(meta.xmpNamespaces).toEqual(["adobe:ns:meta/", "http://ns.adobe.com/hdr-gain-map/1.0/", "http://ns.google.com/photos/1.0/container/",
        "http://ns.google.com/photos/1.0/container/item/", "http://ns.google.com/photos/1.0/depthmap/", "http://ns.google.com/photos/1.0/image/",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#"]);
      expect(meta.annotations).toEqual([
        { kind: "gain-map", source: "xmp", namespace: "http://ns.adobe.com/hdr-gain-map/1.0/", label: null, bytes: null, image: null },
        { kind: "container-item", source: "xmp", namespace: "http://ns.google.com/photos/1.0/container/item/", label: "Primary", bytes: null, image: null },
        { kind: "gain-map", source: "xmp", namespace: "http://ns.google.com/photos/1.0/container/item/", label: "GainMap", bytes: 321, image: null },
        { kind: "container-item", source: "xmp", namespace: "http://ns.google.com/photos/1.0/container/item/", label: "Depth", bytes: 99, image: null },
        { kind: "depth-map", source: "xmp", namespace: "http://ns.google.com/photos/1.0/depthmap/", label: null, bytes: null, image: null },
        { kind: "embedded-image", source: "xmp", namespace: "http://ns.google.com/photos/1.0/image/", label: null, bytes: null, image: null },
        { kind: "gain-map", source: "jpeg-app2-iso-21496-1", namespace: null, label: null, bytes: 5, image: null },
        { kind: "gain-map", source: "xmp", namespace: "http://ns.adobe.com/hdr-gain-map/1.0/", label: null, bytes: null, image: 1 }]);
      expect(meta.assumptions).toEqual([]);
    }
  });

  it("returns the Exif fields the DNG import returns for the same tags", () => {
    const tags = EXIF.filter((t) => t.id !== 37396);
    const fromJpeg = parsePhotoMetadata({ bytes: jpeg(16, 12, [exifSegment(exifBlock(true, IFD0, tags))]) }).exif!;
    const dng = parseDngRawImage({ bytes: minimalDng(tags, IFD0.filter((t) => t.id !== 274)) });
    const { make, model, software, orientation, ...capture } = fromJpeg;
    expect(dng.exif).toEqual(capture);
    expect({ make: dng.make, model: dng.model, software: dng.software }).toEqual({ make, model, software });
    expect(orientation).toBe(6);
  });

  it("applies the Exif rules: unknown 35 mm value, digital zoom not used, default unit, malformed and out-of-range tags", () => {
    const read = (exif: TagSpec[], ifd0: TagSpec[] = []): PhotoMetadata => parsePhotoMetadata({ bytes: jpeg(8, 8, [exifSegment(exifBlock(false, ifd0, exif))]) });
    const unknown = read([{ id: 41989, type: 3, values: [0] }, { id: 41988, type: RATIONAL, values: [0, 100] }, { id: 41486, type: RATIONAL, values: [2540, 1] },
      { id: 41487, type: RATIONAL, values: [5080, 1] }]);
    expect(unknown.exif).toMatchObject({ focalLengthIn35mmFilmMillimeters: null, digitalZoomRatio: 1,
      focalPlaneResolution: { x: 2540, y: 5080, unit: "inch", unitStated: false, pixelsPerMillimeterX: 100, pixelsPerMillimeterY: 200 } });
    const noUnit = read([{ id: 41486, type: RATIONAL, values: [1, 1] }, { id: 41487, type: RATIONAL, values: [1, 1] }, { id: 41488, type: 3, values: [1] }]);
    expect(noUnit.exif!.focalPlaneResolution).toEqual({ x: 1, y: 1, unit: "none", unitStated: true, pixelsPerMillimeterX: null, pixelsPerMillimeterY: null });
    const bad = read([{ id: 41988, type: RATIONAL, values: [1, 2] }, { id: 41486, type: RATIONAL, values: [1, 1] }, { id: 41487, type: RATIONAL, values: [1, 1] },
      { id: 41488, type: 3, values: [4] }, { id: 33437, type: RATIONAL, values: [1, 0] }, { id: 33434, type: 3, values: [1] }, { id: 34855, type: 3, values: [65535] },
      { id: 37386, type: RATIONAL, values: [0, 1] }, { id: 40962, type: 4, values: [100] }], [{ id: 274, type: 3, values: [9] }, { id: 271, type: 4, values: [1] }, { id: 272, type: 2, values: Array(5000).fill(65) }]);
    expect(bad.exif).toMatchObject({ digitalZoomRatio: null, focalPlaneResolution: null, fNumber: null, exposureTimeSeconds: null, iso: null, focalLengthMillimeters: null,
      pixelDimensions: null, orientation: null, make: null, model: null });
    const notes = bad.assumptions.join("\n");
    for (const pattern of [/DigitalZoomRatio is 0\.5/u, /FocalPlaneResolutionUnit 4/u, /FNumber is malformed/u, /ExposureTime is malformed/u, /65535 or more/u,
      /FocalLength is 0/u, /Orientation 9/u, /Make is malformed/u, /Model is malformed/u]) expect(notes).toMatch(pattern);
  });

  it("reads a JPEG without metadata, fill bytes, restart and padding markers, and reports truncation", () => {
    const plain = parsePhotoMetadata({ bytes: jpeg(33, 17, []) });
    expect(plain).toMatchObject({ width: 33, height: 17, exif: null, extraImages: [], annotations: [], assumptions: [], xmpNamespaces: [] });
    const filled = Uint8Array.from([0xff, 0xd8, 0xff, 0xff, 0xff, 0x01, ...segment(0xfe, [1, 2]), 0xff, 0xd0, ...jpeg(5, 6, []).subarray(2)]);
    expect(parsePhotoMetadata({ bytes: filled })).toMatchObject({ width: 5, height: 6, assumptions: [] });
    const full = phoneJpeg();
    const cut = parsePhotoMetadata({ bytes: full.subarray(0, 300) });
    expect(cut.assumptions.join("\n")).toMatch(/extends beyond the supplied bytes/u);
    const head = parsePhotoMetadata({ bytes: full.subarray(0, full.length - 30) });
    expect(head.exif).toEqual(EXPECTED_EXIF);
    expect(head.assumptions.join("\n")).toMatch(/Multi-Picture Format entry 3/u);
    const noScan = parsePhotoMetadata({ bytes: Uint8Array.from([0xff, 0xd8, 0xff, ...segment(0xfe, [1]).slice(1)]) });
    expect(noScan.assumptions.join("\n")).toMatch(/ends before its first scan/u);
    const junk = parsePhotoMetadata({ bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xfe, 0, 3, 1, 0x00, 0x00, 0, 0, 0]) });
    expect(junk.assumptions.join("\n")).toMatch(/byte other than a marker/u);
    const zero = parsePhotoMetadata({ bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xfe, 0, 1, 0, 0, 0, 0]) });
    expect(zero.assumptions.join("\n")).toMatch(/segment of length 1/u);
  });

  it("names malformed Exif, MPF and extended XMP parts and skips them", () => {
    const loop = exifBlock(true, IFD0, EXIF);
    new DataView(loop.buffer).setUint32(4, 0x7fffffff, true);
    expect(parsePhotoMetadata({ bytes: jpeg(4, 4, [exifSegment(loop)]) }).assumptions.join("\n")).toMatch(/Exif block is malformed/u);
    // Exif IFD pointer aimed back at IFD 0: an aliased IFD.
    const alias = exifBlock(true, [{ id: 34665, type: 4, values: [8] }], null);
    expect(parsePhotoMetadata({ bytes: jpeg(4, 4, [exifSegment(alias)]) }).assumptions.join("\n")).toMatch(/Exif IFD is malformed.*aliased/u);
    const badMagic = Uint8Array.from([73, 73, 43, 0, 8, 0, 0, 0]), badOrder = Uint8Array.from([1, 2, 42, 0, 8, 0, 0, 0]);
    for (const block of [badMagic, badOrder, Uint8Array.of(73, 73)]) expect(parsePhotoMetadata({ bytes: jpeg(4, 4, [exifSegment(block)]) }).exif).toBeNull();
    const huge = Uint8Array.from([73, 73, 42, 0, 8, 0, 0, 0, 0xff, 0xff, 0, 0]);
    expect(parsePhotoMetadata({ bytes: jpeg(4, 4, [exifSegment(huge)]) }).assumptions.join("\n")).toMatch(/65535 entries/u);
    const mpf = (payload: number[]): PhotoMetadata => parsePhotoMetadata({ bytes: jpeg(4, 4, [segment(0xe2, [...ascii("MPF").slice(0, 3), 0, ...payload])]) });
    const entries = (n: number, type = 7): number[] => [...writeTiff(false, [{ tags: [{ id: 0xb002, type, values: Array<number>(n).fill(0) }] }])];
    expect(mpf(entries(17)).assumptions.join("\n")).toMatch(/not a multiple of 16/u);
    expect(mpf(entries(16 * 65)).assumptions.join("\n")).toMatch(/65 entries/u);
    expect(mpf([...writeTiff(false, [{ tags: [{ id: 0xb001, type: 4, values: [1] }] }])]).extraImages).toEqual([]);
    const offsets = (offset: number): PhotoMetadata => parsePhotoMetadata({ bytes: jpeg(4, 4, [segment(0xe2, mpfPayload(true,
      [{ attribute: 0x20030000, size: 9, offset: 0 }, { attribute: 0x010001, size: 9, offset }]))]) });
    expect(offsets(0).assumptions.join("\n")).toMatch(/has offset 0 but is not the first entry/u);
    expect(offsets(2).assumptions.join("\n")).toMatch(/does not start with a JPEG SOI marker/u);
    expect(offsets(2).extraImages).toEqual([{ source: "jpeg-mpf", kind: "large-thumbnail", kindBasis: "specification", type: "0x010001", width: null, height: null, bytes: 9 }]);
    const big = PHOTO_METADATA_LIMITS.maximumItemDataBytes + 1;
    const oversized = segment(0xe1, [...ascii("http://ns.adobe.com/xmp/extension/"), ...Array<number>(32).fill(65), big >>> 24 & 255, big >>> 16 & 255, big >>> 8 & 255, big & 255, 0, 0, 0, 0, 1]);
    expect(parsePhotoMetadata({ bytes: jpeg(4, 4, [oversized]) }).assumptions.join("\n")).toMatch(/extended XMP packet .* is larger/u);
    const partial = extendedXmpSegments(DEPTH_XMP, "B".repeat(32), 40).slice(0, 4 + 35 + 32 + 8 + 40);
    expect(parsePhotoMetadata({ bytes: jpeg(4, 4, [partial]) }).assumptions.join("\n")).toMatch(/extended XMP packet is incomplete/u);
  });

  it("limits XMP namespaces and container items", () => {
    const many = '<x xmlns:a="' + Array.from({ length: 300 }, (_, i) => 'urn:example:' + i + '" xmlns:n' + i + '="').join("") + 'urn:example:last"/>';
    const meta = parsePhotoMetadata({ bytes: jpeg(4, 4, [xmpSegment(many)]) });
    expect(meta.xmpNamespaces).toHaveLength(PHOTO_METADATA_LIMITS.maximumXmpNamespaces);
    expect(meta.assumptions.join("\n")).toMatch(/more than 256 namespaces/u);
    const items = '<x xmlns:I.x="http://ns.google.com/photos/1.0/container/item/">' + Array.from({ length: 80 }, () => '<c I.x:Semantic="GainMap" I.x:Length="12x"/>').join("") +
      '<c I.x:Semantic="bad value"/></x>';
    const listed = parsePhotoMetadata({ bytes: jpeg(4, 4, [xmpSegment(items)]) }).annotations;
    expect(listed).toHaveLength(PHOTO_METADATA_LIMITS.maximumMpfEntries);
    expect(listed[0]).toEqual({ kind: "gain-map", source: "xmp", namespace: "http://ns.google.com/photos/1.0/container/item/", label: "GainMap", bytes: null, image: null });
  });
});

/** A HEIF file like a phone's: a 2 × 1 grid primary with two tiles, a thumbnail, auxiliary images, a tone map and Exif and XMP items. */
function phoneHeif(overrides: Partial<HeifSpec> = {}): HeifSpec {
  const exif = exifBlock(false, IFD0, EXIF);
  return {
    primary: 1,
    properties: [ispe(4032, 3024), ispe(2016, 3024), irot(1), imir(1), ispe(320, 240), auxC("urn:mpeg:mpegB:cicp:systems:auxiliary:depth"), ispe(1008, 756),
      auxC("urn:example:photo:aux:hdrgainmap"), auxC("urn:example:photo:aux:portraitmatte"), auxC("urn:example:aux:other"), auxC("urn:mpeg:hevc:2015:auxid:1"),
      auxC("urn:example:aux:disparitymap"), auxC("urn:example:aux:depthdata"), auxC("urn:example:aux:alphaplane")],
    items: [
      { id: 1, type: "grid", properties: [1, 3, 4], data: [0, 0, 0, 1, 0x0f, 0xc0, 0x0b, 0xd0], inIdat: true },
      { id: 2, type: "hvc1", properties: [2], data: [1, 2, 3] }, { id: 3, type: "hvc1", properties: [2], data: [4, 5, 6] },
      { id: 4, type: "hvc1", properties: [5], data: [7, 8] },
      { id: 5, type: "hvc1", properties: [6, 7], data: [9] }, { id: 6, type: "hvc1", properties: [8, 7], data: [10, 11] },
      { id: 7, type: "hvc1", properties: [9, 7], data: [12] }, { id: 8, type: "hvc1", properties: [10, 5], data: [13] },
      { id: 9, type: "hvc1", properties: [11, 5], data: [14] }, { id: 10, type: "hvc1", properties: [12], data: [15] }, { id: 11, type: "hvc1", properties: [13] },
      { id: 12, type: "hvc1", properties: [14] },
      { id: 13, type: "tmap", properties: [1], data: [0, 1] }, { id: 14, type: "hvc1", properties: [7], data: [16, 17, 18] },
      { id: 20, type: "Exif", data: [0, 0, 0, 6, ...ascii("Exif"), 0, ...exif] },
      { id: 21, type: "mime", contentType: "application/rdf+xml", data: [...new TextEncoder().encode(GAIN_MAP_XMP)] },
      { id: 22, type: "mime", contentType: "application/rdf+xml", data: [...new TextEncoder().encode(DEPTH_XMP)] },
      { id: 23, type: "mime", contentType: "application/rdf+xml", data: [...new TextEncoder().encode(CONTAINER_XMP)] },
      { id: 24, type: "uri ", data: [1] }
    ],
    references: [{ type: "dimg", from: 1, to: [2, 3] }, { type: "thmb", from: 4, to: [1] }, { type: "auxl", from: 5, to: [1] }, { type: "cdsc", from: 20, to: [1] },
      { type: "cdsc", from: 21, to: [1] }, { type: "cdsc", from: 22, to: [5] }, { type: "cdsc", from: 23, to: [99] }, { type: "dimg", from: 13, to: [1, 14] }],
    ...overrides
  };
}

describe("parsePhotoMetadata: HEIF (2.25.0, #617)", () => {
  it("reads the primary size and transforms, the Exif item, auxiliary images, thumbnail, tone map and XMP items", () => {
    const meta = parsePhotoMetadata({ bytes: heif(phoneHeif()) });
    expect(meta).toMatchObject({ format: "heif", brands: ["heic", "mif1", "heic"], width: 4032, height: 3024, heifRotationDegrees: 90, heifMirrorAxis: 1 });
    expect(meta.exif).toEqual(EXPECTED_EXIF);
    expect(meta.extraImages).toEqual([
      { source: "heif-thumbnail", kind: "thumbnail", kindBasis: "specification", type: "hvc1", width: 320, height: 240, bytes: 2 },
      { source: "heif-auxiliary", kind: "depth", kindBasis: "specification", type: "urn:mpeg:mpegB:cicp:systems:auxiliary:depth", width: 1008, height: 756, bytes: 1 },
      { source: "heif-auxiliary", kind: "gain-map", kindBasis: "name", type: "urn:example:photo:aux:hdrgainmap", width: 1008, height: 756, bytes: 2 },
      { source: "heif-auxiliary", kind: "matte", kindBasis: "name", type: "urn:example:photo:aux:portraitmatte", width: 1008, height: 756, bytes: 1 },
      { source: "heif-auxiliary", kind: "other", kindBasis: "none", type: "urn:example:aux:other", width: 320, height: 240, bytes: 1 },
      { source: "heif-auxiliary", kind: "alpha", kindBasis: "specification", type: "urn:mpeg:hevc:2015:auxid:1", width: 320, height: 240, bytes: 1 },
      { source: "heif-auxiliary", kind: "disparity", kindBasis: "name", type: "urn:example:aux:disparitymap", width: null, height: null, bytes: 1 },
      { source: "heif-auxiliary", kind: "depth", kindBasis: "name", type: "urn:example:aux:depthdata", width: null, height: null, bytes: null },
      { source: "heif-auxiliary", kind: "alpha", kindBasis: "name", type: "urn:example:aux:alphaplane", width: null, height: null, bytes: null },
      { source: "heif-tone-map", kind: "tone-mapped", kindBasis: "specification", type: "tmap", width: 4032, height: 3024, bytes: 2 },
      { source: "heif-gain-map-input", kind: "gain-map", kindBasis: "specification", type: "hvc1", width: 1008, height: 756, bytes: 3 }]);
    expect(meta.xmpNamespaces).toEqual(["adobe:ns:meta/", "http://ns.adobe.com/hdr-gain-map/1.0/", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"]);
    expect(meta.annotations).toEqual([
      { kind: "gain-map", source: "xmp", namespace: "http://ns.adobe.com/hdr-gain-map/1.0/", label: null, bytes: null, image: null },
      { kind: "depth-map", source: "xmp", namespace: "http://ns.google.com/photos/1.0/depthmap/", label: null, bytes: null, image: 1 },
      { kind: "embedded-image", source: "xmp", namespace: "http://ns.google.com/photos/1.0/image/", label: null, bytes: null, image: 1 }]);
    expect(meta.assumptions).toEqual([]);
  });

  it("reads iloc versions 0 and 2, ipma version 1 with 16-bit indices, an Exif item with a direct TIFF offset and a 64-bit box size", () => {
    const exif = exifBlock(true, IFD0, EXIF);
    const spec = phoneHeif({ ilocVersion: 2, ipma: { version: 1, flags: 1 } });
    spec.items = spec.items.map((i) => (i.id === 20 ? { ...i, data: [0, 0, 0, 0, ...exif] } : i));
    expect(parsePhotoMetadata({ bytes: heif(spec) })).toMatchObject({ width: 4032, height: 3024, exif: EXPECTED_EXIF, assumptions: [] });
    const v0 = phoneHeif({ ilocVersion: 0 });
    v0.items = v0.items.map((i) => ({ ...i, inIdat: false }));
    expect(parsePhotoMetadata({ bytes: heif(v0) })).toMatchObject({ exif: EXPECTED_EXIF, assumptions: [] });
    // A free box with a 64-bit size before meta, and a final box of size 0 (to the end of the file).
    const file = heif(phoneHeif({ brands: ["avif", "mif1"] }));
    const ftypEnd = new DataView(file.buffer).getUint32(0);
    const large = [0, 0, 0, 1, ...new TextEncoder().encode("free"), 0, 0, 0, 0, 0, 0, 0, 20, 9, 9, 9, 9];
    const shifted = Uint8Array.from([...file.subarray(0, ftypEnd), ...large, ...file.subarray(ftypEnd)]);
    const moved = parsePhotoMetadata({ bytes: shifted });
    expect(moved.brands).toEqual(["avif", "mif1"]);
    // The iloc offsets now point 20 bytes early (item data is misread), but the boxes still parse.
    expect(moved.width).toBe(4032);
    expectWellFormed(moved);
  });

  it("reports missing and truncated parts without failing", () => {
    const full = heif(phoneHeif({ trailing: 4096 }));
    const mdat = full.findIndex((_, i) => full[i] === 0x6d && full[i + 1] === 0x64 && full[i + 2] === 0x61 && full[i + 3] === 0x74);
    const meta = parsePhotoMetadata({ bytes: full.subarray(0, mdat + 30) });
    expect(meta.width).toBe(4032);
    expect(meta.assumptions.join("\n")).toMatch(/item lies beyond the supplied bytes/u);
    const metaCut = parsePhotoMetadata({ bytes: full.subarray(0, 200) });
    expect(metaCut.assumptions).toEqual(["photoMetadata.truncated: the meta box extends beyond the supplied bytes; nothing was read."]);
    const onlyFtyp = Uint8Array.from(box("ftyp", [...new TextEncoder().encode("mif1")], [0, 0, 0, 0]));
    expect(parsePhotoMetadata({ bytes: onlyFtyp }).assumptions).toEqual(["photoMetadata.truncated: no meta box within the supplied bytes; nothing was read."]);
    const noPrimary = heif({ ...phoneHeif(), primary: 77 });
    expect(parsePhotoMetadata({ bytes: noPrimary })).toMatchObject({ width: null, heifRotationDegrees: null });
    const edits = phoneHeif();
    edits.items = edits.items.map((i) => (i.id === 20 ? { ...i, data: [0, 0, 0, 0, 1] } : i.id === 21 ? { id: 21, type: "mime", contentType: "application/rdf+xml" } : i));
    const notes = parsePhotoMetadata({ bytes: heif(edits) }).assumptions.join("\n");
    expect(notes).toMatch(/Exif item is malformed/u);
    expect(notes).toMatch(/XMP item has no iloc entry/u);
  });

  it("rejects input that is not a JPEG or HEIF file, and unknown fields", () => {
    const reject = (input: unknown): void => { expect(() => parsePhotoMetadata(input as never)).toThrow(InvalidConfigurationError); };
    reject({ bytes: new Uint8Array(0) }); reject({ bytes: Uint8Array.of(0xff, 0xd8) }); reject({ bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) });
    reject({ bytes: Uint8Array.from(box("ftyp", [...new TextEncoder().encode("mp42")], [0, 0, 0, 0], [...new TextEncoder().encode("isom")])) });
    reject({ bytes: Uint8Array.from([0, 0, 0, 4, ...new TextEncoder().encode("ftyp"), 0, 0, 0, 0, 0, 0, 0, 0]) });
    reject({ bytes: [0xff, 0xd8, 0xff] }); reject({ bytes: jpeg(1, 1, []), maximumBytes: 1 }); reject(null);
    expect(() => parsePhotoMetadata({ bytes: Uint8Array.from(box("ftyp", [...new TextEncoder().encode("mp42")], [0, 0, 0, 0])) })).toThrow(/names no HEIF brand/u);
  });
});

/** xorshift32, fixed seed. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x1_0000_0000; };
}
function expectWellFormed(meta: PhotoMetadata): void {
  // Every number in the result is finite; every image size is a non-negative integer.
  JSON.stringify(meta, (_, v: unknown) => { if (typeof v === "number") expect(Number.isFinite(v)).toBe(true); return v; });
  for (const image of meta.extraImages) for (const v of [image.width, image.height, image.bytes]) if (v !== null) expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
  for (const a of meta.annotations) if (a.image !== null) expect(a.image).toBeLessThan(meta.extraImages.length);
}

describe("parsePhotoMetadata: hostile input (fixed-seed fuzz and properties)", () => {
  it("returns well-formed metadata or a domain error for every mutation, within bounded time", () => {
    const next = random(0x617);
    for (const valid of [phoneJpeg(), phoneJpeg(false), heif(phoneHeif()), heif(phoneHeif({ ilocVersion: 2, ipma: { version: 1, flags: 1 } }))]) {
      expectWellFormed(parsePhotoMetadata({ bytes: valid }));
      let parsed = 0;
      const started = performance.now();
      for (let n = 0; n < 2500; n++) {
        const mutated = valid.slice(), edits = 1 + Math.floor(next() * 6);
        for (let e = 0; e < edits; e++) {
          const at = Math.floor(next() * mutated.length), r = next();
          // Single bytes, and 32-bit values aimed at sizes, counts and offsets.
          if (r < 0.7) mutated[at] = Math.floor(next() * 256);
          else mutated.set([0xff, 0xff, 0xff, 0xff].map((b) => (next() < 0.5 ? b : Math.floor(next() * 256))).slice(0, mutated.length - at), at);
        }
        const bytes = next() < 0.15 ? mutated.subarray(0, Math.floor(next() * mutated.length)) : mutated;
        try { expectWellFormed(parsePhotoMetadata({ bytes })); parsed++; } catch (error) { expect(error).toBeInstanceOf(InvalidConfigurationError); }
      }
      expect(parsed).toBeGreaterThan(1000);
      expect(performance.now() - started).toBeLessThan(30_000);
    }
  }, 120_000);

  it("reads every prefix of a file without failing once the format is recognised (truncation property)", () => {
    for (const file of [phoneJpeg(), heif(phoneHeif())]) {
      const full = parsePhotoMetadata({ bytes: file });
      for (let length = file[0] === 0xff ? 3 : new DataView(file.buffer).getUint32(0); length <= file.length; length += 7) {
        const meta = parsePhotoMetadata({ bytes: file.subarray(0, length) });
        expectWellFormed(meta);
        // A prefix never states more than the whole file.
        expect(meta.extraImages.length).toBeLessThanOrEqual(full.extraImages.length);
        if (meta.exif) expect(meta.exif).toEqual(full.exif);
      }
    }
  }, 120_000);

  it("bounds hostile structures: IFD and box loops, huge counts and sizes, deep or long lists", () => {
    // HEIF iloc claiming 2^32 − 1 entries, iinf with many items, iref with a huge count, a 64-bit box size beyond the file.
    const meta = (children: number[]): Uint8Array => Uint8Array.from([...box("ftyp", [...new TextEncoder().encode("heic")], [0, 0, 0, 0]), ...fullBox("meta", 0, 0, children)]);
    const notes = (bytes: Uint8Array): string => parsePhotoMetadata({ bytes }).assumptions.join("\n");
    expect(notes(meta(fullBox("iloc", 2, 0, [0x44, 0], [0xff, 0xff, 0xff, 0xff])))).toMatch(/iloc box is malformed .*4294967295 entries/u);
    expect(notes(meta(fullBox("iref", 0, 0, box("dimg", [0, 1, 0xff, 0xff]))))).toMatch(/iref box is malformed/u);
    // Zero-size iloc fields: 4096 items claiming 65535 extents each would take no bytes at all.
    const zeroSized = fullBox("iloc", 1, 0, [0x00, 0], [0x10, 0], ...Array.from({ length: 4096 }, (_, i) => [i >>> 8 & 255, i & 255, 0, 0, 0, 0, 0xff, 0xff]));
    expect(notes(meta(zeroSized))).toMatch(/more than 16384 extents/u);
    expect(notes(meta(fullBox("iloc", 1, 0, [0x33, 0], [0, 1], [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0])))).toMatch(/not 0, 4 or 8/u);
    expect(notes(meta(fullBox("iloc", 1, 0, [0x88, 0], [0, 1], [0, 1, 0, 0, 0, 0, 0, 1], Array<number>(16).fill(0xff))))).toMatch(/64-bit value too large/u);
    expect(notes(meta([...fullBox("iinf", 0, 0, [0, 1], fullBox("infe", 2, 0, [0, 1, 0, 0], [...new TextEncoder().encode("hvc1")], [65, 66]))]))).toMatch(/iinf box is malformed.*terminator/u);
    expect(notes(meta(box("iprp", fullBox("ipma", 0, 0, [0, 0, 0, 1, 0, 1, 200]))))).toMatch(/iprp box is malformed/u);
    const manyItems = fullBox("iinf", 0, 0, [0xff, 0xff], ...Array.from({ length: PHOTO_METADATA_LIMITS.maximumItems + 1 }, (_, i) => fullBox("infe", 2, 0, [i >>> 8 & 255, i & 255, 0, 0], [...new TextEncoder().encode("hvc1")], [0])));
    expect(notes(meta(manyItems))).toMatch(/more than 4096 (items|boxes)/u);
    const manyBoxes = Array.from({ length: PHOTO_METADATA_LIMITS.maximumBoxes + 1 }, () => box("free")).flat();
    expect(notes(meta(manyBoxes))).toMatch(/more than 4096 boxes/u);
    expect(notes(meta([0, 0, 0, 1, ...new TextEncoder().encode("free"), 0xff, 0xff, 0, 0, 0, 0, 0, 0]))).toMatch(/pitm/u);
    expect(notes(meta([0, 0, 0, 1, ...new TextEncoder().encode("free"), 0, 0]))).toMatch(/cut short/u);
    expect(notes(meta([0, 0, 0, 3, ...new TextEncoder().encode("free")]))).toMatch(/has size 3/u);
    expect(notes(meta(fullBox("iloc", 1, 0, [0x44, 0], [0, 1], [0, 20, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1])))).toMatch(/pitm/u);
    // JPEG with more marker segments than the limit.
    const segments = Array.from({ length: PHOTO_METADATA_LIMITS.maximumJpegSegments + 1 }, () => segment(0xfe, [0]));
    expect(parsePhotoMetadata({ bytes: jpeg(1, 1, segments) }).assumptions.join("\n")).toMatch(/more than 4096 marker segments/u);
    // An Exif thumbnail whose offset lies beyond the block, and a thumbnail without a size.
    const block = exifBlock(true, IFD0, null, { jpeg: thumbnailJpeg, tags: [{ id: 256, type: 3, values: [10] }, { id: 257, type: 3, values: [8] }] });
    expect(parsePhotoMetadata({ bytes: jpeg(4, 4, [exifSegment(block)]) }).extraImages[0]).toMatchObject({ width: 10, height: 8 });
    const beyond = writeTiff(true, [{ tags: IFD0 }, { tags: [{ id: 513, type: 4, values: [100_000] }, { id: 514, type: 4, values: [10] }] }]);
    expect(parsePhotoMetadata({ bytes: jpeg(4, 4, [exifSegment(beyond)]) }).assumptions.join("\n")).toMatch(/thumbnail lies beyond the Exif block/u);
  });
});

describe("parsePhotoMetadata: item data methods", () => {
  it("names unsupported construction methods and an absent idat box", () => {
    const spec = phoneHeif();
    const file = heif(spec);
    // Flip the grid item's construction method (idat, 1) to 2 (item offset): find iloc and patch its first entry.
    const at = ((): number => { for (let i = 0; i + 4 < file.length; i++) if (file[i] === 0x69 && file[i + 1] === 0x6c && file[i + 2] === 0x6f && file[i + 3] === 0x63) return i; return -1; })();
    expect(at).toBeGreaterThan(0);
    const patched = file.slice();
    // iloc body: version/flags (4), sizes (2), count (2), then item 1: id (2), method (2).
    const exifEntry = ((): number => { const view = new DataView(patched.buffer); let q = at + 4 + 4 + 2 + 2; for (;;) { const id = view.getUint16(q); if (id === 20) return q; q += 2 + 2 + 2 + 2 + 8; } })();
    patched[exifEntry + 3] = 2;
    expect(parsePhotoMetadata({ bytes: patched }).assumptions.join("\n")).toMatch(/construction method 2/u);
    patched[exifEntry + 3] = 1;
    const withoutIdat = heif({ ...spec, items: spec.items.map((i) => ({ ...i, inIdat: false })) }).slice();
    const at2 = ((): number => { for (let i = 0; i + 4 < withoutIdat.length; i++) if (withoutIdat[i] === 0x69 && withoutIdat[i + 1] === 0x6c && withoutIdat[i + 2] === 0x6f && withoutIdat[i + 3] === 0x63) return i; return -1; })();
    const view = new DataView(withoutIdat.buffer);
    let q = at2 + 4 + 4 + 2 + 2;
    while (view.getUint16(q) !== 20) q += 16;
    withoutIdat[q + 3] = 1;
    expect(parsePhotoMetadata({ bytes: withoutIdat }).assumptions.join("\n")).toMatch(/idat box that is absent/u);
  });
});

// ---------------------------------------------------------------- 2.26.0

/** A PNG chunk: length, type, data and the CRC-32 of the type and data (PNG specification, third edition, §5.3). */
function pngChunk(type: string, data: ArrayLike<number>, crc?: number): number[] {
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0)), body = Uint8Array.from(data), out = new Uint8Array(12 + body.length), view = new DataView(out.buffer);
  view.setUint32(0, body.length); out.set(typeBytes, 4); out.set(body, 8); view.setUint32(8 + body.length, crc ?? pngCrc32(body, pngCrc32(typeBytes)));
  return [...out];
}
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ihdr = (width: number, height: number): number[] => pngChunk("IHDR", [...[width, height].flatMap((v) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]), 8, 2, 0, 0, 0]);
/** A PNG whose IDAT holds bytes that are not a valid zlib stream: the reader must never decode them. */
const idat = pngChunk("IDAT", [0xde, 0xad, 0xbe, 0xef, 1, 2, 3]);
const png = (...chunks: number[][]): Uint8Array => Uint8Array.from([...PNG_SIGNATURE, ...chunks.flat()]);
const iend = pngChunk("IEND", []);

describe("parsePhotoMetadata: PNG eXIf (2.26.0, #647)", () => {
  it("reads the eXIf chunk before or after IDAT, in either byte order, and the IHDR size, without decoding IDAT", () => {
    for (const little of [true, false]) {
      const exif = pngChunk("eXIf", exifBlock(little, IFD0, EXIF));
      for (const bytes of [png(ihdr(4032, 3024), exif, idat, iend), png(ihdr(4032, 3024), idat, exif, iend)]) {
        const meta = parsePhotoMetadata({ bytes });
        expect(meta).toMatchObject({ format: "png", brands: [], width: 4032, height: 3024, heifRotationDegrees: null, xmpNamespaces: [], extraImages: [], assumptions: [] });
        expect(meta.exif).toEqual(EXPECTED_EXIF);
      }
    }
    // The Exif thumbnail is listed as for a JPEG.
    const withThumbnail = parsePhotoMetadata({ bytes: png(ihdr(8, 8), pngChunk("eXIf", exifBlock(true, IFD0, EXIF, { jpeg: thumbnailJpeg })), idat, iend) });
    expect(withThumbnail.extraImages).toEqual([{ source: "exif-thumbnail", kind: "thumbnail", kindBasis: "specification", type: "jpeg", width: 160, height: 120, bytes: thumbnailJpeg.length }]);
  });

  it("reads a PNG without eXIf (and the engine's own encoder's PNG) as size only", () => {
    expect(parsePhotoMetadata({ bytes: png(ihdr(3, 2), idat, iend) })).toMatchObject({ format: "png", width: 3, height: 2, exif: null, assumptions: [] });
    const encoded = serializePngImage({ width: 5, height: 4, bitDepth: 8, samples: new Uint8Array(60), colourEncoding: { kind: "srgb", renderingIntent: "perceptual" } });
    expect(parsePhotoMetadata({ bytes: encoded })).toMatchObject({ format: "png", width: 5, height: 4, exif: null, assumptions: [] });
  });

  it("names malformed and truncated chunks in assumptions and keeps what it could read", () => {
    const block = exifBlock(true, IFD0, EXIF), notes = (bytes: Uint8Array): string => parsePhotoMetadata({ bytes }).assumptions.join("\n");
    // A CRC mismatch skips the chunk.
    const badCrc = parsePhotoMetadata({ bytes: png(ihdr(8, 8), pngChunk("eXIf", block, 0x12345678), idat, iend) });
    expect(badCrc.exif).toBeNull();
    expect(badCrc.width).toBe(8);
    expect(badCrc.assumptions.join("\n")).toMatch(/PNG eXIf chunk is malformed and was not read \(CRC mismatch\)/u);
    // The JPEG identifier before the TIFF header is stepped over and reported.
    const identified = parsePhotoMetadata({ bytes: png(ihdr(8, 8), pngChunk("eXIf", [0x45, 0x78, 0x69, 0x66, 0, 0, ...block]), idat, iend) });
    expect(identified.exif).toEqual(EXPECTED_EXIF);
    expect(identified.assumptions.join("\n")).toMatch(/was stepped over/u);
    // A second eXIf is not read.
    const second = parsePhotoMetadata({ bytes: png(ihdr(8, 8), pngChunk("eXIf", block), pngChunk("eXIf", exifBlock(true, [], [{ id: 33437, type: RATIONAL, values: [4, 1] }])), idat, iend) });
    expect(second.exif).toEqual(EXPECTED_EXIF);
    expect(second.assumptions.join("\n")).toMatch(/a second PNG eXIf chunk/u);
    // A chunk past the supplied bytes, and bytes that end before IEND.
    const full = png(ihdr(8, 8), idat, pngChunk("eXIf", block), iend);
    expect(parsePhotoMetadata({ bytes: full.subarray(0, full.length - 30) }).exif).toBeNull();
    expect(notes(full.subarray(0, full.length - 30))).toMatch(/PNG eXIf chunk lies beyond the supplied bytes/u);
    expect(notes(png(ihdr(8, 8), idat))).toMatch(/end before the PNG IEND chunk/u);
    expect(notes(png(ihdr(8, 8), idat).subarray(0, 8 + 25 + 10))).toMatch(/chunks beyond byte 33 lie beyond the supplied bytes; an eXIf chunk there would not be read/u);
    expect(notes(png(ihdr(8, 8), idat).subarray(0, 8 + 25 + 4))).toMatch(/a PNG chunk header lies beyond the supplied bytes/u);
    // A length above 2^31 − 1, a type that is not four letters, a short eXIf, a bad IHDR and a first chunk that is not IHDR.
    const huge = png(ihdr(8, 8), [0x80, 0, 0, 0, 0x65, 0x58, 0x49, 0x66]);
    expect(notes(huge)).toMatch(/is malformed \(length above 2\^31 − 1\)/u);
    expect(notes(png(ihdr(8, 8), pngChunk("e1If", block), iend))).toMatch(/type is not four letters/u);
    expect(notes(png(ihdr(8, 8), pngChunk("eXIf", [0x49, 0x49]), iend))).toMatch(/shorter than a TIFF header/u);
    expect(parsePhotoMetadata({ bytes: png(pngChunk("IHDR", [0, 0, 0, 0, 0, 0, 0, 1, 8, 2, 0, 0, 0]), iend) }).width).toBeNull();
    expect(notes(png(pngChunk("eXIf", block), iend))).toMatch(/first PNG chunk is eXIf, not IHDR/u);
    // An eXIf whose IFD offsets point outside it is read as far as it goes, as a JPEG's Exif is.
    const broken = Uint8Array.from(block); broken[4] = 0xff; broken[5] = 0xff;
    expect(parsePhotoMetadata({ bytes: png(ihdr(8, 8), pngChunk("eXIf", broken), iend) }).exif).toBeNull();
    // The chunk count is bounded.
    const many = png(ihdr(1, 1), ...Array.from({ length: PHOTO_METADATA_LIMITS.maximumPngChunks + 1 }, () => pngChunk("tEXt", [])), iend);
    expect(notes(many)).toMatch(/more than 4096 chunks/u);
    expect(() => parsePhotoMetadata({ bytes: Uint8Array.from(PNG_SIGNATURE.slice(0, 7)) })).toThrow(InvalidConfigurationError);
  });
});

describe("Exif SubjectDistance and SubjectDistanceRange (2.26.0, #648)", () => {
  const read = (tags: TagSpec[]): PhotoMetadata => parsePhotoMetadata({ bytes: jpeg(8, 8, [exifSegment(exifBlock(true, [], tags))]) });
  it("reports a stated distance in meters, 0 as \"unknown\" and 0xFFFFFFFF as \"infinity\"", () => {
    expect(read([{ id: 37382, type: RATIONAL, values: [125, 100] }]).exif!.subjectDistanceMeters).toBe(1.25);
    expect(read([{ id: 37382, type: RATIONAL, values: [0, 1] }]).exif!.subjectDistanceMeters).toBe("unknown");
    expect(read([{ id: 37382, type: RATIONAL, values: [0, 0] }]).exif!.subjectDistanceMeters).toBe("unknown");
    expect(read([{ id: 37382, type: RATIONAL, values: [0xffffffff, 1] }]).exif!.subjectDistanceMeters).toBe("infinity");
    expect(read([{ id: 37382, type: RATIONAL, values: [0xffffffff, 0] }]).exif!.subjectDistanceMeters).toBe("infinity");
    expect(read([]).exif!).toMatchObject({ subjectDistanceMeters: null, subjectDistanceRange: null });
    const zero = read([{ id: 37382, type: RATIONAL, values: [5, 0] }]);
    expect(zero.exif!.subjectDistanceMeters).toBeNull();
    expect(zero.assumptions.join("\n")).toMatch(/SubjectDistance 5\/0 has a zero denominator and was ignored/u);
    const wrongType = read([{ id: 37382, type: 4, values: [3] }]);
    expect(wrongType.exif!.subjectDistanceMeters).toBeNull();
    expect(wrongType.assumptions.join("\n")).toMatch(/SubjectDistance is malformed/u);
  });
  it("names the four SubjectDistanceRange codes and ignores the others", () => {
    for (const [code, name] of [[0, "unknown"], [1, "macro"], [2, "close-view"], [3, "distant-view"]] as const)
      expect(read([{ id: 41996, type: 3, values: [code] }]).exif!.subjectDistanceRange).toBe(name);
    const other = read([{ id: 41996, type: 3, values: [4] }]);
    expect(other.exif!.subjectDistanceRange).toBeNull();
    expect(other.assumptions.join("\n")).toMatch(/SubjectDistanceRange 4 is not defined by Exif 2.32/u);
  });
  it("reads both in the DNG import", () => {
    const dng = (tags: TagSpec[]): ReturnType<typeof parseDngRawImage>["exif"] => parseDngRawImage({ bytes: minimalDng(tags) }).exif;
    expect(dng([{ id: 37382, type: RATIONAL, values: [7, 2] }, { id: 41996, type: 3, values: [3] }])).toMatchObject({ subjectDistanceMeters: 3.5, subjectDistanceRange: "distant-view" });
    expect(dng([{ id: 37382, type: RATIONAL, values: [0, 1] }, { id: 41996, type: 3, values: [1] }])).toMatchObject({ subjectDistanceMeters: "unknown", subjectDistanceRange: "macro" });
    expect(dng([{ id: 37382, type: RATIONAL, values: [0xffffffff, 1] }])).toMatchObject({ subjectDistanceMeters: "infinity", subjectDistanceRange: null });
  });
});
