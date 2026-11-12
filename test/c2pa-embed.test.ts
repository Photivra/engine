// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { crc32, inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { bindC2paManifestStore, setC2paManifestStore, calculateC2paDataHash, parseC2paManifestStore, serializePngImage, createPhotographicExportPair, parseDngRawImage, InvalidConfigurationError,
  C2PA_ALGORITHMIC_MEDIA_SOURCE_TYPE, type PhotographicExportPair } from "../src/index.js";
import { loadPhotographicExportInput } from "./helpers/photographic-export-fixture.js";
import { writeTiff, packBits, rationalPairs } from "./helpers/dng-test-writer.js";

/**
 * 2.22.0 integration (#598 with #165): the DNG import names every rendering tag that is present and not applied, so a bound
 * file reads the same as the original apart from that one added assumption about the store tag (checked here, then removed).
 */
function withoutStoreAssumption<T extends { assumptions: readonly string[] }>(parsed: T): T {
  expect(parsed.assumptions.filter((a) => /52545/u.test(a))).toEqual(["dngImport.notApplied: JUMBF (C2PA) (52545) is present and not applied."]);
  return { ...parsed, assumptions: parsed.assumptions.filter((a) => !/52545/u.test(a)) };
}

/**
 * Test-only C2PA Manifest Store framing (C2PA 2.4 §11.1.4.2, ISO 19566-5 boxes): a 'jumb' superbox with a 'jumd' description
 * box (C2PA UUID, toggles 0x03, label "c2pa") and one child superbox of `fill` bytes. The content is not a real manifest: the
 * engine checks only the framing, and signing is out of scope. `fill` makes placeholder and signed stores of the same size.
 */
function store(total: number, fill = 0): Uint8Array {
  const out = new Uint8Array(total), v = new DataView(out.buffer);
  v.setUint32(0, total); out.set([0x6a, 0x75, 0x6d, 0x62], 4);
  v.setUint32(8, 30); out.set([0x6a, 0x75, 0x6d, 0x64], 12);
  out.set([0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71, 0x03, 0x63, 0x32, 0x70, 0x61, 0], 16);
  v.setUint32(38, total - 38); out.set([0x6a, 0x75, 0x6d, 0x62], 42);
  out.fill(fill, 46);
  return out;
}
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const without = (b: Uint8Array, ranges: readonly { start: number; length: number }[]): Uint8Array => {
  const parts: number[] = []; let from = 0;
  for (const r of [...ranges, { start: b.length, length: 0 }]) { parts.push(...b.subarray(from, r.start)); from = r.start + r.length; }
  return Uint8Array.from(parts);
};
/** Walks a JPEG (ITU-T T.81 B.1.1): marker segments up to SOS, then entropy-coded data to EOI. Returns the markers in order. */
function jpegMarkers(b: Uint8Array): number[] {
  expect([b[0], b[1]]).toEqual([0xff, 0xd8]);
  const markers: number[] = []; let at = 2;
  for (;;) {
    expect(b[at]).toBe(0xff);
    const m = b[at + 1]!; markers.push(m);
    const end = at + 2 + (b[at + 2]! << 8 | b[at + 3]!);
    expect(end).toBeLessThanOrEqual(b.length);
    at = end;
    if (m === 0xda) break;
  }
  // Entropy-coded data: 0xFF is followed only by a stuffed 0x00 or a restart marker, until EOI ends the file.
  for (; at < b.length - 2; at++) if (b[at] === 0xff) expect(b[at + 1] === 0 || (b[at + 1]! >= 0xd0 && b[at + 1]! <= 0xd7)).toBe(true);
  expect([b[b.length - 2], b[b.length - 1]]).toEqual([0xff, 0xd9]);
  return markers;
}
/** Main-IFD entries of a little- or big-endian TIFF. */
function ifd0(b: Uint8Array): { tag: number; type: number; count: number; value: number; at: number }[] {
  const le = b[0] === 0x49, v = new DataView(b.buffer, b.byteOffset, b.byteLength), off = v.getUint32(4, le);
  return Array.from({ length: v.getUint16(off, le) }, (_, i) => {
    const at = off + 2 + i * 12;
    return { tag: v.getUint16(at, le), type: v.getUint16(at + 2, le), count: v.getUint32(at + 4, le), value: v.getUint32(at + 8, le), at };
  });
}
const rejects = (f: () => unknown, pattern: RegExp): void => { expect(f).toThrow(InvalidConfigurationError); expect(f).toThrow(pattern); };

let pair: PhotographicExportPair;
beforeAll(async () => { pair = await createPhotographicExportPair(loadPhotographicExportInput()); });

describe("C2PA in JPEG exports (C2PA 2.4 §A.3.1, §18.5.3)", () => {
  it("adds one contiguous APP11 run right after APP0, where c2pa-rs puts it, and excludes exactly it", () => {
    const jpeg = pair.jpeg.bytes, placeholder = store(500), bound = bindC2paManifestStore({ file: jpeg, manifestStore: placeholder });
    const region = bound.binding.manifestRegion;
    expect(region.start).toBe(2 + 2 + (jpeg[4]! << 8 | jpeg[5]!)); // SOI, then the end of JFIF APP0
    expect(bound.binding).toEqual({ mediaType: "image/jpeg", fileLength: jpeg.length + 512, exclusions: [region], manifestRegion: region, manifestStoreLength: 500 });
    // One segment: FFEB, Lp = 2 + CI/En/Z (8) + store, CI "JP", En 0x0211, Z 1, then the store itself.
    expect(Array.from(bound.bytes.subarray(region.start, region.start + 12))).toEqual([0xff, 0xeb, 0x01, 0xfe, 0x4a, 0x50, 0x02, 0x11, 0, 0, 0, 1]);
    expect(bound.bytes.subarray(region.start + 12, region.start + 512)).toEqual(placeholder);
    // The original file is the bound file with the excluded range taken out: no other byte moved or changed.
    expect(without(bound.bytes, bound.binding.exclusions)).toEqual(jpeg);
    expect(jpegMarkers(jpeg).slice(0, 4)).toEqual([0xe0, 0xe1, 0xe1, 0xdb]);
    expect(jpegMarkers(bound.bytes).slice(0, 5)).toEqual([0xe0, 0xeb, 0xe1, 0xe1, 0xdb]);
  });

  it("splits a large store into 64,000-byte pieces, repeating LBox and TBox (ISO 19566-5 D.2)", () => {
    const placeholder = store(150_000), bound = bindC2paManifestStore({ file: pair.jpeg.bytes, manifestStore: placeholder }), b = bound.bytes;
    const { start, length } = bound.binding.manifestRegion;
    expect(length).toBe(3 * 12 + 2 * 8 + 150_000);
    const markers = jpegMarkers(b);
    expect(markers.filter((m) => m === 0xeb)).toHaveLength(3);
    let at = start; const pieces: Uint8Array[] = [];
    for (let z = 1; z <= 3; z++) {
      const lp = b[at + 2]! << 8 | b[at + 3]!;
      expect(Array.from(b.subarray(at, at + 12))).toEqual([0xff, 0xeb, lp >> 8, lp & 255, 0x4a, 0x50, 0x02, 0x11, 0, 0, 0, z]);
      const data = at + 12 + (z > 1 ? 8 : 0);
      if (z > 1) expect(b.subarray(at + 12, at + 20)).toEqual(placeholder.subarray(0, 8));
      pieces.push(b.subarray(data, at + 2 + lp)); at += 2 + lp;
    }
    expect(pieces.map((p) => p.length)).toEqual([64_000, 64_000, 22_000]);
    expect(Uint8Array.from(pieces.flatMap((p) => [...p]))).toEqual(placeholder);
    expect(at).toBe(start + length);
    expect(without(b, bound.binding.exclusions)).toEqual(pair.jpeg.bytes);
  });

  it("writes the signed store in place at the same length, so the data hash still holds", async () => {
    const bound = bindC2paManifestStore({ file: pair.jpeg.bytes, manifestStore: store(150_000) });
    const before = await calculateC2paDataHash({ file: bound.bytes, exclusions: bound.binding.exclusions });
    const signed = setC2paManifestStore({ file: bound.bytes, binding: bound.binding, manifestStore: store(150_000, 0x5a) });
    expect(signed.length).toBe(bound.bytes.length);
    expect(without(signed, bound.binding.exclusions)).toEqual(without(bound.bytes, bound.binding.exclusions));
    expect(await calculateC2paDataHash({ file: signed, exclusions: bound.binding.exclusions })).toEqual(before);
    expect(signed).toEqual(bindC2paManifestStore({ file: pair.jpeg.bytes, manifestStore: store(150_000, 0x5a) }).bytes);
    jpegMarkers(signed);
    rejects(() => setC2paManifestStore({ file: bound.bytes, binding: bound.binding, manifestStore: store(150_001) }), /placeholder reserved 150000 B/);
  });

  it("accepts the store already split into APP11 segments, in the same split only", () => {
    const bound = bindC2paManifestStore({ file: pair.jpeg.bytes, manifestStore: store(70_000) }), r = bound.binding.manifestRegion;
    const composed = bound.bytes.slice(r.start, r.start + r.length);
    expect(bindC2paManifestStore({ file: pair.jpeg.bytes, manifestStore: composed })).toEqual(bound);
    const signed = setC2paManifestStore({ file: bound.bytes, binding: bound.binding, manifestStore: bindC2paManifestStore({ file: pair.jpeg.bytes, manifestStore: store(70_000, 7) }).bytes.slice(r.start, r.start + r.length) });
    expect(signed).toEqual(bindC2paManifestStore({ file: pair.jpeg.bytes, manifestStore: store(70_000, 7) }).bytes);
    const resplit = composed.slice(); resplit[11] = 2;
    rejects(() => bindC2paManifestStore({ file: pair.jpeg.bytes, manifestStore: resplit }), /contiguous C2PA sequence/);
  });

  it("rejects a second store and a binding that does not match the file", () => {
    const bound = bindC2paManifestStore({ file: pair.jpeg.bytes, manifestStore: store(400) });
    rejects(() => bindC2paManifestStore({ file: bound.bytes, manifestStore: store(400) }), /already has a C2PA manifest store/);
    const moved = { ...bound.binding, manifestRegion: { start: bound.binding.manifestRegion.start + 1, length: bound.binding.manifestRegion.length } };
    rejects(() => setC2paManifestStore({ file: bound.bytes, binding: moved, manifestStore: store(400) }), /does not match the file's manifest store/);
    rejects(() => setC2paManifestStore({ file: pair.jpeg.bytes, binding: bound.binding, manifestStore: store(400) }), /no C2PA manifest store to replace/);
  });
});

describe("C2PA in DNG exports (C2PA 2.4 §A.3.6, §18.5.5)", () => {
  it("adds tag 52545 (type 7) to the single main IFD with the store at the end, and the DNG reads the same", () => {
    const dng = pair.dng.bytes, placeholder = store(30_001), bound = bindC2paManifestStore({ file: dng, manifestStore: placeholder });
    const entries = ifd0(bound.bytes), c2pa = entries.find((e) => e.tag === 52545)!;
    expect(entries.map((e) => e.tag)).toEqual([...ifd0(dng).map((e) => e.tag), 52545]);
    expect(c2pa).toMatchObject({ type: 7, count: 30_001, value: (dng.length + 12 + 3) & ~3 });
    expect(c2pa.value % 4).toBe(0);
    expect(bound.bytes.length).toBe(c2pa.value + 30_001);
    expect(bound.bytes.subarray(c2pa.value)).toEqual(placeholder);
    expect(bound.binding).toEqual({ mediaType: "image/dng", fileLength: bound.bytes.length,
      exclusions: [{ start: c2pa.at + 4, length: 4 }, { start: c2pa.value, length: 30_001 }], manifestRegion: { start: c2pa.value, length: 30_001 }, manifestStoreLength: 30_001 });
    // Every tag, offset and pixel still reads the same; the store tag is the only addition.
    expect(withoutStoreAssumption(parseDngRawImage({ bytes: bound.bytes }))).toEqual(parseDngRawImage({ bytes: dng }));
  });

  it("writes the signed store in place at the same length; the hash over the bound bytes is unchanged", async () => {
    const bound = bindC2paManifestStore({ file: pair.dng.bytes, manifestStore: store(4_000) });
    const hash = await calculateC2paDataHash({ file: bound.bytes, exclusions: bound.binding.exclusions });
    expect(hash.hashHex).toBe(sha(without(bound.bytes, bound.binding.exclusions)));
    expect(hash.hashedByteCount).toBe(bound.bytes.length - 4 - 4_000);
    const signed = setC2paManifestStore({ file: bound.bytes, binding: bound.binding, manifestStore: store(4_000, 0xa5) });
    expect(signed.length).toBe(bound.bytes.length);
    expect(signed.subarray(0, bound.binding.manifestRegion.start)).toEqual(bound.bytes.subarray(0, bound.binding.manifestRegion.start));
    expect(await calculateC2paDataHash({ file: signed, exclusions: bound.binding.exclusions })).toEqual(hash);
    expect(withoutStoreAssumption(parseDngRawImage({ bytes: signed }))).toEqual(parseDngRawImage({ bytes: pair.dng.bytes }));
    rejects(() => setC2paManifestStore({ file: bound.bytes, binding: bound.binding, manifestStore: store(3_999) }), /placeholder reserved 4000 B/);
    rejects(() => setC2paManifestStore({ file: bound.bytes, binding: { ...bound.binding, exclusions: [bound.binding.manifestRegion] }, manifestStore: store(4_000) }), /does not match the file's manifest store/);
  });

  it("moves every offset after the new entry in a big-endian DNG with SubIFDs (data before and after the IFD)", () => {
    const width = 8, height = 6, codes = Uint16Array.from({ length: width * height }, (_, i) => (i * 37) % 4096);
    const raw = { tags: [{ id: 254, type: 4, values: [0] }, { id: 256, type: 4, values: [width] }, { id: 257, type: 4, values: [height] },
      { id: 258, type: 3, values: [12] }, { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [32803] }, { id: 277, type: 3, values: [1] },
      { id: 278, type: 4, values: [height] }, { id: 33421, type: 3, values: [2, 2] }, { id: 33422, type: 1, values: [0, 1, 1, 2] }],
    chunks: { offsetTag: 273, countTag: 279, data: [packBits(codes, width, 12, false)] } };
    const main = { tags: [{ id: 254, type: 4, values: [1] }, { id: 271, type: 2, values: [...new TextEncoder().encode("Synthetic"), 0] },
      { id: 50706, type: 1, values: [1, 4, 0, 0] }, { id: 50721, type: 10, values: rationalPairs([.8, -.2, -.1, -.3, 1.2, .1, 0, .1, .7]) },
      { id: 50728, type: 5, values: rationalPairs([.5, 1, .6]) }, { id: 50778, type: 3, values: [21] }], subIfds: [raw] };
    const dng = writeTiff(false, [main]), bound = bindC2paManifestStore({ file: dng, manifestStore: store(200) });
    expect(bound.binding.mediaType).toBe("image/dng");
    const before = parseDngRawImage({ bytes: dng }), after = parseDngRawImage({ bytes: bound.bytes });
    expect(withoutStoreAssumption(after)).toEqual(before);
    expect(Array.from(after.codes)).toEqual(Array.from(codes));
    const entry = ifd0(bound.bytes).find((e) => e.tag === 52545)!;
    expect(new DataView(bound.bytes.buffer).getUint32(entry.at + 4, false)).toBe(200);
  });

  it("rejects files whose layout it cannot bind safely", () => {
    const two = writeTiff(true, [{ tags: [{ id: 256, type: 4, values: [1] }] }, { tags: [{ id: 256, type: 4, values: [1] }] }]);
    rejects(() => bindC2paManifestStore({ file: two, manifestStore: store(100) }), /exactly one main IFD/);
    const maker = writeTiff(true, [{ tags: [{ id: 256, type: 4, values: [1] }, { id: 37500, type: 7, values: [1, 2, 3, 4, 5, 6] }] }]);
    rejects(() => bindC2paManifestStore({ file: maker, manifestStore: store(100) }), /MakerNote/);
    const bound = bindC2paManifestStore({ file: pair.dng.bytes, manifestStore: store(100) });
    rejects(() => bindC2paManifestStore({ file: bound.bytes, manifestStore: store(100) }), /already has a C2PA manifest store/);
    rejects(() => bindC2paManifestStore({ file: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), manifestStore: store(100) }), /not a JPEG, PNG or TIFF/);
  });
});

/** PNG chunks (PNG 3rd edition §5.3), each CRC checked with Node's own CRC-32; and the decompressed image data (IDAT, zlib). */
function pngChunks(b: Uint8Array): { types: string[]; image: Uint8Array } {
  expect(Array.from(b.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), types: string[] = [], idat: number[] = [];
  let at = 8;
  while (at < b.length) {
    const length = v.getUint32(at), type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    expect(v.getUint32(at + 8 + length)).toBe(crc32(b.subarray(at + 4, at + 8 + length)));
    if (type === "IDAT") idat.push(...b.subarray(at + 8, at + 8 + length));
    types.push(type); at += 12 + length;
  }
  expect(at).toBe(b.length);
  return { types, image: Uint8Array.from(inflateSync(Uint8Array.from(idat))) };
}
/** JPEG APP11 segments for `data` in a split other than the engine's: `piece`-byte pieces with box instance `en`. */
function foreignApp11(data: Uint8Array, piece: number, en: number): Uint8Array {
  const out: number[] = [];
  for (let i = 0, z = 1; i < data.length; i += piece, z++) {
    const body = [0x4a, 0x50, en >> 8, en & 255, 0, 0, 0, z, ...(i ? data.subarray(0, 8) : []), ...data.subarray(i, i + piece)];
    out.push(0xff, 0xeb, (body.length + 2) >> 8, (body.length + 2) & 255, ...body);
  }
  return Uint8Array.from(out);
}

describe("C2PA in PNG exports (C2PA 2.4 §A.3.2, §18.5.4)", () => {
  const png = serializePngImage({ width: 3, height: 2, bitDepth: 8, samples: Uint8Array.from({ length: 18 }, (_, i) => i * 13), colourEncoding: { kind: "srgb", renderingIntent: "perceptual" } });

  it("adds one caBX chunk right after IHDR and excludes the whole chunk; the PNG still decodes the same", () => {
    const placeholder = store(2_000), bound = bindC2paManifestStore({ file: png, manifestStore: placeholder }), b = bound.bytes;
    const ihdrEnd = 8 + 12 + 13, region = { start: ihdrEnd, length: 12 + 2_000 };
    expect(bound.binding).toEqual({ mediaType: "image/png", fileLength: png.length + 2_012, exclusions: [region], manifestRegion: region, manifestStoreLength: 2_000 });
    // Length, type 'caBX' (ancillary, private, not safe to copy: lowercase, uppercase, uppercase, uppercase), store, CRC.
    expect(new DataView(b.buffer).getUint32(ihdrEnd)).toBe(2_000);
    expect(String.fromCharCode(...b.subarray(ihdrEnd + 4, ihdrEnd + 8))).toBe("caBX");
    expect(b.subarray(ihdrEnd + 8, ihdrEnd + 2_008)).toEqual(placeholder);
    expect(without(b, bound.binding.exclusions)).toEqual(png);
    const before = pngChunks(png), after = pngChunks(b);
    expect(after.types).toEqual([before.types[0], "caBX", ...before.types.slice(1)]);
    expect(after.image).toEqual(before.image);
  });

  it("writes the signed store in place at the same length with a fresh CRC; the data hash is unchanged", async () => {
    const bound = bindC2paManifestStore({ file: png, manifestStore: store(2_000) });
    const hash = await calculateC2paDataHash({ file: bound.bytes, exclusions: bound.binding.exclusions });
    const signed = setC2paManifestStore({ file: bound.bytes, binding: bound.binding, manifestStore: store(2_000, 0x33) });
    expect(signed.length).toBe(bound.bytes.length);
    expect(signed).toEqual(bindC2paManifestStore({ file: png, manifestStore: store(2_000, 0x33) }).bytes);
    expect(await calculateC2paDataHash({ file: signed, exclusions: bound.binding.exclusions })).toEqual(hash);
    expect(pngChunks(signed).image).toEqual(pngChunks(png).image);
    rejects(() => setC2paManifestStore({ file: bound.bytes, binding: bound.binding, manifestStore: store(2_001) }), /placeholder reserved 2000 B/);
    rejects(() => bindC2paManifestStore({ file: bound.bytes, manifestStore: store(100) }), /already has a C2PA manifest store/);
  });
});

describe("Finding a C2PA manifest store in a file", () => {
  it("returns the store and the same binding the writer made, for JPEG, PNG and DNG; null when there is none", () => {
    const png = serializePngImage({ width: 1, height: 1, bitDepth: 8, samples: Uint8Array.of(1, 2, 3), colourEncoding: { kind: "srgb", renderingIntent: "perceptual" } });
    for (const file of [pair.jpeg.bytes, png, pair.dng.bytes]) {
      expect(parseC2paManifestStore({ file })).toBeNull();
      const placeholder = store(70_000, 9), bound = bindC2paManifestStore({ file, manifestStore: placeholder });
      expect(parseC2paManifestStore({ file: bound.bytes })).toEqual({ binding: bound.binding, manifestStore: placeholder });
    }
  });

  it("reads other writers' layouts and patches them in place: another JPEG split and En, a store in its own last TIFF IFD", () => {
    // JPEG: 1,000-byte pieces, En 0x0001, after the Exif and XMP segments, and a non-C2PA JUMBF APP11 (other En) before it.
    const jpeg = pair.jpeg.bytes, app0End = 4 + (jpeg[4]! << 8 | jpeg[5]!);
    let at = app0End; for (let k = 0; k < 2; k++) at += 2 + (jpeg[at + 2]! << 8 | jpeg[at + 3]!);
    const other = Uint8Array.of(0xff, 0xeb, 0, 18, 0x4a, 0x50, 0, 7, 0, 0, 0, 1, 0, 0, 0, 8, 0x6a, 0x75, 0x6d, 0x62);
    const segments = foreignApp11(store(2_500), 1_000, 1), file = Uint8Array.from([...jpeg.subarray(0, at), ...other, ...segments, ...jpeg.subarray(at)]);
    const found = parseC2paManifestStore({ file })!;
    expect(found.binding.manifestRegion).toEqual({ start: at + other.length, length: segments.length });
    expect(found.manifestStore).toEqual(store(2_500));
    const signed = setC2paManifestStore({ file, binding: found.binding, manifestStore: store(2_500, 4) });
    expect(signed).toEqual(Uint8Array.from([...jpeg.subarray(0, at), ...other, ...foreignApp11(store(2_500, 4), 1_000, 1), ...jpeg.subarray(at)]));
    // TIFF: the store as the only entry of a second main IFD (§A.3.6 allows it), data before the IFD.
    const tiff = writeTiff(true, [{ tags: [{ id: 256, type: 4, values: [1] }] }, { tags: [{ id: 52545, type: 7, values: [...store(64)] }] }]);
    const t = parseC2paManifestStore({ file: tiff })!;
    expect(t.manifestStore).toEqual(store(64));
    expect(t.binding.exclusions[0]).toEqual(t.binding.manifestRegion);
    expect(t.binding.exclusions[1]!.start).toBeGreaterThan(t.binding.manifestRegion.start);
    expect(parseC2paManifestStore({ file: setC2paManifestStore({ file: tiff, binding: t.binding, manifestStore: store(64, 1) }) })!.manifestStore).toEqual(store(64, 1));
  });

  it("rejects stores that break the format's rules", () => {
    const s = store(300), split = foreignApp11(s, 100, 5), jpeg = pair.jpeg.bytes;
    const gap = Uint8Array.from([...jpeg.subarray(0, 20), ...split.subarray(0, 112), 0xff, 0xfe, 0, 2, ...split.subarray(112), ...jpeg.subarray(20)]);
    rejects(() => parseC2paManifestStore({ file: gap }), /not contiguous/);
    const twice = Uint8Array.from([...jpeg.subarray(0, 20), ...foreignApp11(s, 400, 5), ...foreignApp11(s, 400, 6), ...jpeg.subarray(20)]);
    rejects(() => parseC2paManifestStore({ file: twice }), /more than one C2PA manifest store/);
    const png = bindC2paManifestStore({ file: serializePngImage({ width: 1, height: 1, bitDepth: 8, samples: Uint8Array.of(1, 2, 3), colourEncoding: { kind: "srgb", renderingIntent: "perceptual" } }), manifestStore: s }).bytes;
    const chunk = png.subarray(33, 33 + 312), doubled = Uint8Array.from([...png.subarray(0, 33), ...chunk, ...png.subarray(33)]);
    rejects(() => parseC2paManifestStore({ file: doubled }), /more than one caBX/);
    const misplaced = writeTiff(true, [{ tags: [{ id: 256, type: 4, values: [1] }, { id: 52545, type: 7, values: [...s] }] }, { tags: [{ id: 256, type: 4, values: [1] }] }]);
    rejects(() => parseC2paManifestStore({ file: misplaced }), /last IFD of the main chain/);
    rejects(() => parseC2paManifestStore({ file: Uint8Array.of(0, 1) }), /not a JPEG, PNG or TIFF/);
  });
});

describe("C2PA manifest store framing and the data hash", () => {
  it("rejects a store that is not a C2PA Manifest Store superbox", () => {
    const file = pair.jpeg.bytes, bad = (edit: (s: Uint8Array) => void): Uint8Array => { const s = store(200); edit(s); return s; };
    rejects(() => bindC2paManifestStore({ file, manifestStore: bad((s) => { s[3] = 199; }) }), /LBox is its whole length/);
    rejects(() => bindC2paManifestStore({ file, manifestStore: bad((s) => { s[16] = 0; }) }), /C2PA UUID/);
    rejects(() => bindC2paManifestStore({ file, manifestStore: bad((s) => { s[33] = 0x78; }) }), /label must be 'c2pa'/);
    rejects(() => bindC2paManifestStore({ file, manifestStore: bad((s) => { s[13] = 0; }) }), /description box/);
    rejects(() => bindC2paManifestStore({ file, manifestStore: bad((s) => { s[41] = 0; }) }), /child box/);
    rejects(() => bindC2paManifestStore({ file, manifestStore: store(200).subarray(0, 30) }), /38 B to 32 MiB/);
    rejects(() => bindC2paManifestStore({ file, manifestStore: [1, 2] as unknown as Uint8Array }), /Uint8Array/);
    rejects(() => bindC2paManifestStore({ file, manifestStore: store(200), extra: 1 } as never), /input has unknown field "extra"/);
  });

  it("hashes the bytes outside ascending exclusions and rejects others", async () => {
    const file = Uint8Array.from({ length: 100 }, (_, i) => i);
    const hash = await calculateC2paDataHash({ file, exclusions: [{ start: 10, length: 5 }, { start: 90, length: 10 }] });
    expect(hash).toEqual({ alg: "sha256", hash: Uint8Array.from(createHash("sha256").update(without(file, [{ start: 10, length: 5 }, { start: 90, length: 10 }])).digest()),
      hashHex: sha(without(file, [{ start: 10, length: 5 }, { start: 90, length: 10 }])), hashedByteCount: 85 });
    expect((await calculateC2paDataHash({ file, exclusions: [] })).hashHex).toBe(sha(file));
    await expect(calculateC2paDataHash({ file, exclusions: [{ start: 50, length: 5 }, { start: 10, length: 5 }] })).rejects.toThrow(/ascending/);
    await expect(calculateC2paDataHash({ file, exclusions: [{ start: 95, length: 10 }] })).rejects.toThrow(/inside the file/);
    await expect(calculateC2paDataHash({ file, exclusions: [{ start: 1, length: 0 }] })).rejects.toThrow(InvalidConfigurationError);
  });

  it("names the owner's digital source type", () => {
    expect(C2PA_ALGORITHMIC_MEDIA_SOURCE_TYPE).toBe("http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia");
  });
});

