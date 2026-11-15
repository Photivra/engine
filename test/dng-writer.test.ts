// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { parseDngRawImage, simulateCapture, developDngImage, rewriteDng, DNG_REWRITE_ALLOWED_TAGS, DNG_REWRITE_SCHEMA_VERSION, InvalidConfigurationError,
  type ImportedDngRaw } from "../src/index.js";
import { writeTiff, packBits, encodeLosslessJpeg, type IfdSpec, type TagSpec } from "./helpers/dng-test-writer.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.25.0 (#620): rewriteDng keeps the raw data and the development tags and writes nothing outside its allowlist. Synthetic DNGs
 * built here and the engine's own DNG export; no photo is used.
 */

const ascii = (s: string): number[] => [...new TextEncoder().encode(s), 0];
const width = 16, height = 12;
const codes = Uint16Array.from({ length: width * height }, (_, i) => 1000 + (i * 37) % 500);
/** Personal and private tags a camera may write, each with a marker string that must not appear in the output. */
const PERSONAL_MAIN: TagSpec[] = [{ id: 315, type: 2, values: ascii("ARTIST-NAME") }, { id: 33432, type: 2, values: ascii("COPYRIGHT-HOLDER") },
  { id: 700, type: 1, values: ascii("<x:xmpmeta>XMP-SECRET</x:xmpmeta>") }, { id: 33723, type: 7, values: ascii("IPTC-SECRET") },
  { id: 50735, type: 2, values: ascii("CAMERA-SERIAL-123") }, { id: 50740, type: 1, values: ascii("DNG-PRIVATE-DATA") },
  { id: 50781, type: 1, values: Array.from({ length: 16 }, (_, i) => i + 1) }, { id: 50827, type: 2, values: ascii("ORIGINAL-NAME.CR3") },
  { id: 270, type: 2, values: ascii("DESCRIPTION-TEXT") }, { id: 306, type: 2, values: ascii("2026:01:02 03:04:05") }];
const PERSONAL_EXIF: TagSpec[] = [{ id: 37500, type: 7, values: ascii("MAKER-NOTE-SECRET") }, { id: 42032, type: 2, values: ascii("OWNER-NAME") },
  { id: 42033, type: 2, values: ascii("BODY-SERIAL-456") }, { id: 42037, type: 2, values: ascii("LENS-SERIAL-789") }, { id: 42016, type: 2, values: ascii("IMAGE-UNIQUE-ID") },
  { id: 36867, type: 2, values: ascii("2026:01:02 03:04:05") }, { id: 37510, type: 7, values: ascii("USER-COMMENT") }];
const CAPTURE_EXIF: TagSpec[] = [{ id: 33434, type: 5, values: [1, 250] }, { id: 33437, type: 5, values: [28, 10] }, { id: 34855, type: 3, values: [400] },
  { id: 34864, type: 3, values: [2] }, { id: 34866, type: 4, values: [400] }, { id: 37386, type: 5, values: [35, 1] }, { id: 41989, type: 3, values: [53] },
  { id: 37380, type: 10, values: [-1, 3] }, { id: 42036, type: 2, values: ascii("Synthetic 35mm F2.8") }];
const MARKERS = ["ARTIST-NAME", "COPYRIGHT-HOLDER", "XMP-SECRET", "IPTC-SECRET", "CAMERA-SERIAL", "DNG-PRIVATE", "ORIGINAL-NAME", "DESCRIPTION-TEXT", "2026:01:02",
  "MAKER-NOTE", "OWNER-NAME", "BODY-SERIAL", "LENS-SERIAL", "IMAGE-UNIQUE", "USER-COMMENT", "GPS-AREA"];

function rawIfd(little: boolean, compression: 1 | 7, extra: TagSpec[] = []): IfdSpec {
  const data = compression === 1 ? packBits(codes, width, 16, little) : encodeLosslessJpeg(codes, { width, height, components: 1, precision: 16, predictor: 1 });
  return {
    tags: [{ id: 254, type: 4, values: [0] }, { id: 256, type: 4, values: [width] }, { id: 257, type: 4, values: [height] }, { id: 258, type: 3, values: [16] },
      { id: 259, type: 3, values: [compression] }, { id: 262, type: 3, values: [32803] }, { id: 277, type: 3, values: [1] }, { id: 278, type: 4, values: [height] },
      { id: 33421, type: 3, values: [2, 2] }, { id: 33422, type: 1, values: [0, 1, 1, 2] }, { id: 50714, type: 4, values: [512] }, { id: 50717, type: 4, values: [16383] },
      { id: 50829, type: 4, values: [0, 0, height, width] }, { id: 50719, type: 4, values: [1, 1] }, { id: 50720, type: 4, values: [14, 10] },
      { id: 51041, type: 12, values: [2e-5, 1e-7] }, ...extra],
    chunks: { offsetTag: 273, countTag: 279, data: [data] }
  };
}
const MATRIX = [0.9, -0.3, -0.1, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6];
/** A DNG with a preview in IFD 0, the raw image and a semantic mask as SubIFDs, an Exif IFD and a GPS IFD. */
function sourceDng(little = true, compression: 1 | 7 = 1): Uint8Array {
  const mask: IfdSpec = { tags: [{ id: 254, type: 4, values: [0x10004] }, { id: 256, type: 4, values: [8] }, { id: 257, type: 4, values: [4] }, { id: 258, type: 3, values: [8] },
    { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [52527] }, { id: 277, type: 3, values: [1] }, { id: 52526, type: 2, values: ascii("Sky") }],
  chunks: { offsetTag: 273, countTag: 279, data: [Uint8Array.from({ length: 32 }, (_, i) => i * 8)] } };
  const gps: IfdSpec = { tags: [{ id: 0, type: 1, values: [2, 3, 0, 0] }, { id: 2, type: 5, values: [51, 1, 30, 1, 0, 1] }, { id: 28, type: 7, values: ascii("GPS-AREA") }] };
  const tiff = writeTiff(little, [{
    tags: [{ id: 254, type: 4, values: [1] }, { id: 256, type: 4, values: [4] }, { id: 257, type: 4, values: [3] }, { id: 258, type: 3, values: [8, 8, 8] },
      { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [2] }, { id: 277, type: 3, values: [3] },
      { id: 271, type: 2, values: ascii("Synthetic") }, { id: 272, type: 2, values: ascii("Model 1") }, { id: 274, type: 3, values: [6] }, { id: 305, type: 2, values: ascii("Firmware 1.0") },
      { id: 50706, type: 1, values: [1, 6, 0, 0] }, { id: 50707, type: 1, values: [1, 4, 0, 0] }, { id: 50708, type: 2, values: ascii("Synthetic Model 1") },
      { id: 50721, type: 10, values: MATRIX.flatMap((v) => [Math.round(v * 10000), 10000]) }, { id: 50778, type: 3, values: [21] },
      { id: 50728, type: 5, values: [5000, 10000, 10000, 10000, 6000, 10000] }, { id: 50730, type: 10, values: [1, 2] }, { id: 51109, type: 10, values: [1, 4] },
      ...PERSONAL_MAIN],
    chunks: { offsetTag: 273, countTag: 279, data: [new Uint8Array(36).fill(200)] },
    subIfds: [rawIfd(little, compression), mask],
    exifIfd: { tags: [...CAPTURE_EXIF, ...PERSONAL_EXIF] }
  }]);
  return appendGps(tiff, little, gps);
}
/** Appends a GPS IFD and points IFD 0's GPSInfo (34853) tag at it, by rewriting IFD 0 with one more entry at the end of the file. */
function appendGps(tiff: Uint8Array, little: boolean, gps: IfdSpec): Uint8Array {
  // Build the GPS IFD as its own TIFF and copy its directory and values, rebasing offsets.
  const g = writeTiff(little, [gps]), gv = new DataView(g.buffer), base = tiff.length + (4 - tiff.length % 4) % 4;
  const gAt = gv.getUint32(4, little), out = new Uint8Array(base + g.length + 2 + 64 * 12 + 4 + 64), v = new DataView(out.buffer);
  out.set(tiff); out.set(g, base);
  const count = gv.getUint16(gAt, little);
  for (let i = 0; i < count; i++) {
    const p = base + gAt + 2 + i * 12, type = v.getUint16(p + 2, little), c = v.getUint32(p + 4, little), size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4][type]! * c;
    if (size > 4) v.setUint32(p + 8, v.getUint32(p + 8, little) + base, little);
  }
  // Copy IFD 0 with one more entry (34853) to the end, and point the header at it.
  const ifd0 = v.getUint32(4, little), n0 = v.getUint16(ifd0, little), at = base + g.length + (4 - g.length % 4) % 4;
  const entries: Uint8Array[] = [];
  for (let i = 0; i < n0; i++) entries.push(out.slice(ifd0 + 2 + i * 12, ifd0 + 14 + i * 12));
  const e = new Uint8Array(12), ev = new DataView(e.buffer);
  ev.setUint16(0, 34853, little); ev.setUint16(2, 4, little); ev.setUint32(4, 1, little); ev.setUint32(8, base + gAt, little);
  entries.push(e);
  entries.sort((a, b) => new DataView(a.buffer).getUint16(0, little) - new DataView(b.buffer).getUint16(0, little));
  v.setUint16(at, entries.length, little);
  entries.forEach((x, i) => out.set(x, at + 2 + i * 12));
  v.setUint32(at + 2 + entries.length * 12, 0, little);
  v.setUint32(4, at, little);
  return out.subarray(0, at + 2 + entries.length * 12 + 4);
}
const text = (b: Uint8Array): string => new TextDecoder("latin1").decode(b);
/** Every development-relevant field of an import, for comparing a source with its rewrite. */
function development(raw: ImportedDngRaw): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...raw };
  delete rest.codes; delete rest.assumptions; delete rest.rawDataUniqueId; delete rest.semanticMasks;
  return { ...rest, codes: Array.from(raw.codes), masks: raw.semanticMasks.map((m) => ({ ...m, data: Array.from(m.data) })) };
}

describe("rewriteDng (2.25.0, #620)", () => {
  it("keeps the raw codes and development tags and drops everything outside the allowlist", () => {
    for (const little of [true, false]) for (const compression of [1, 7] as const) {
      const source = sourceDng(little, compression), before = parseDngRawImage({ bytes: source });
      for (const marker of MARKERS) expect(text(source)).toContain(marker);
      const out = rewriteDng({ bytes: source });
      expect(out).toMatchObject({ schemaVersion: DNG_REWRITE_SCHEMA_VERSION, mediaType: "image/dng", byteOrder: little ? "little-endian" : "big-endian", maskCount: 1 });
      for (const marker of MARKERS) expect(text(out.bytes)).not.toContain(marker);
      const after = parseDngRawImage({ bytes: out.bytes });
      expect(development(after)).toEqual({ ...development(before), enhancedImages: [] });
      expect(after.rawDataUniqueId).toBeNull();
      expect(before.rawDataUniqueId).not.toBeNull();
      expect(after).toMatchObject({ make: "Synthetic", model: "Model 1", software: "Firmware 1.0", orientation: 6, baselineExposure: 0.75, compression: compression === 1 ? "uncompressed" : "lossless-jpeg" });
      expect(after.exif).toMatchObject({ exposureTimeSeconds: 1 / 250, fNumber: 2.8, iso: 400, focalLengthMillimeters: 35, focalLengthIn35mmFilmMillimeters: 53 });
      for (const id of [315, 33432, 700, 33723, 50735, 50740, 50781, 50827, 270, 306, 37500, 42032, 42033, 42037, 42016, 36867, 37510, 0, 2, 28]) expect(out.omittedTags).toContain(id);
      expect(out.omittedImages).toEqual([{ newSubFileType: 1, width: 4, height: 3 }]);
      expect(out.writtenTags.exif).toEqual([33434, 33437, 34855, 34864, 34866, 36864, 37380, 37386, 41989, 42036]);
      // Every written tag is on the allowlist (pointers and NewSubFileType are structural).
      const allowed = new Set([...DNG_REWRITE_ALLOWED_TAGS.raw, ...DNG_REWRITE_ALLOWED_TAGS.camera, 254, 273, 279, 324, 325, 330, 34665]);
      for (const id of out.writtenTags.ifd0) expect(allowed.has(id)).toBe(true);
      for (const id of out.writtenTags.masks) expect([...DNG_REWRITE_ALLOWED_TAGS.mask, 254, 273, 279, 324, 325].includes(id)).toBe(true);
      // Rewriting the rewrite changes nothing.
      expect(rewriteDng({ bytes: out.bytes }).bytes).toEqual(out.bytes);
    }
  });

  it("writes edited development settings", () => {
    const source = sourceDng();
    const edited = parseDngRawImage({ bytes: rewriteDng({ bytes: source, edits: { asShotNeutral: [0.4, 1, 0.7], baselineExposure: -0.5,
      defaultCrop: { x: 2, y: 2, width: 12, height: 8 }, orientation: 1 } }).bytes });
    expect(edited.asShotNeutral).toEqual([0.4, 1, 0.7]);
    expect(edited).toMatchObject({ baselineExposure: -0.5, orientation: 1, defaultCrop: { x: 2, y: 2, width: 12, height: 8 } });
    const xy = parseDngRawImage({ bytes: rewriteDng({ bytes: source, edits: { asShotWhiteXy: { x: 0.3457, y: 0.3585 }, defaultCrop: { x: 0.5, y: 1.25, width: 12.5, height: 8 } } }).bytes });
    expect(xy.asShotNeutral).toBeNull();
    expect(xy.asShotWhiteXy).toEqual({ x: 0.3457, y: 0.3585 });
    expect(xy.defaultCrop).toEqual({ x: 0.5, y: 1.25, width: 12.5, height: 8 });
    expect(Array.from(xy.codes)).toEqual(Array.from(codes));
  });

  it("refuses invalid input and edits with domain errors", () => {
    const source = sourceDng();
    const bad: [unknown, RegExp][] = [
      [null, /input must be an object/u], [{ bytes: [1, 2] }, /bytes must be a Uint8Array/u], [{ bytes: source, extra: 1 }, /unknown input field/u],
      [{ bytes: source, maximumIfds: 0 }, /maximumIfds/u], [{ bytes: source, maximumIfds: 2 }, /too many IFDs/u],
      [{ bytes: new Uint8Array(4) }, /too short/u], [{ bytes: new Uint8Array(16) }, /byte-order mark/u],
      [{ bytes: source, edits: { asShotNeutral: [1, 1] } }, /one positive value/u], [{ bytes: source, edits: { asShotNeutral: [1, 0, 1] } }, /one positive value/u],
      [{ bytes: source, edits: { asShotNeutral: [1, 1, 1], asShotWhiteXy: { x: 0.3, y: 0.3 } } }, /not both/u],
      [{ bytes: source, edits: { asShotWhiteXy: { x: 0.7, y: 0.4 } } }, /chromaticity/u], [{ bytes: source, edits: { baselineExposure: 11 } }, /-10 to 10/u],
      [{ bytes: source, edits: { defaultCrop: { x: 4, y: 0, width: 14, height: 10 } } }, /inside the active area/u],
      [{ bytes: source, edits: { orientation: 9 } }, /1 to 8/u], [{ bytes: source, edits: { gps: true } }, /unknown edits field/u]
    ];
    for (const [input, message] of bad) {
      expect(() => rewriteDng(input as never)).toThrow(InvalidConfigurationError);
      expect(() => rewriteDng(input as never)).toThrow(message);
    }
    // A TIFF without DNGVersion is not rewritten.
    const tiff = writeTiff(true, [rawIfd(true, 1)]);
    expect(() => rewriteDng({ bytes: tiff })).toThrow(/no DNGVersion/u);
    // A truncated file fails cleanly at every length.
    for (let n = 8; n < source.length; n += 97) {
      try { rewriteDng({ bytes: source.subarray(0, n) }); } catch (error) { expect(error).toBeInstanceOf(InvalidConfigurationError); }
    }
  });

  it("rewrites the engine's own DNG export: same codes, same development", async () => {
    const capture = await simulateCapture({ scene: { preset: "color-patches" }, illuminanceLux: 500, exposure: { mode: "manual", iso: 200, shutterSeconds: 1 / 30 },
      output: { width: 32, height: 32, format: "dng" } });
    const before = parseDngRawImage({ bytes: capture.image.dng! }), out = rewriteDng({ bytes: capture.image.dng! });
    expect(text(out.bytes)).not.toContain("xmpmeta");
    const after = parseDngRawImage({ bytes: out.bytes });
    expect(development(after)).toEqual(development(before));
    const a = await developDngImage(before), b = await developDngImage(after);
    expect(Array.from(b.samples)).toEqual(Array.from(a.samples));
    // An edited white balance develops differently, and as the edit says.
    const warm = parseDngRawImage({ bytes: rewriteDng({ bytes: capture.image.dng!, edits: { asShotNeutral: [0.5, 1, 0.8] } }).bytes });
    expect((await developDngImage(warm)).whiteBalance.source).toBe("as-shot-neutral");
    expect((await developDngImage(warm)).whiteBalance.cameraNeutral).toEqual([0.5, 1, 0.8]);
  }, scaledTimeout(60_000));
});
