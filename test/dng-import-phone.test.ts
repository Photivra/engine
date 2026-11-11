// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { initSync, JxlImage } from "jxl-oxide-wasm";
import {
  parseDngRawImage, importDngRawImage, createJxlOxideDngDecoder, developDngStageImage, applyDngOpcodes, parseDngOpcodeList, InvalidConfigurationError, DNG_IMPORT_LIMITS,
  applyDngProfileGainTableMap, applyDngRgbTables, parseDngProfileGainTableMap, parseDngRgbTables
} from "../src/index.js";
import { writeTiff, type TagSpec } from "./helpers/dng-test-writer.js";
import { encodeLosslessJxl, encodeTestPng, encodeBaselineJpeg, opcodeList, areaSpec, BigEndianBytes } from "./helpers/phone-dng-fixtures.js";

// jxl-oxide-wasm (MIT OR Apache-2.0, a devDependency; THIRD_PARTY.md): the prebuilt WebAssembly decoder the owner chose (#598).
const require = createRequire(import.meta.url);
initSync({ module: readFileSync(join(dirname(require.resolve("jxl-oxide-wasm/package.json")), "jxl_oxide_wasm_bg.wasm")) });
const jxl = createJxlOxideDngDecoder({ JxlImage } as never);

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FLOAT = 11, UNDEFINED = 7;
const floatBits = (v: number): number => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v, true); return d.getUint32(0, true); };
function linearRawTags(width: number, height: number, spp: number, bits: number, compression: number, extra: TagSpec[] = []): TagSpec[] {
  return [{ id: 254, type: 4, values: [0] }, { id: 256, type: 4, values: [width] }, { id: 257, type: 4, values: [height] }, { id: 258, type: 3, values: Array<number>(spp).fill(bits) },
    { id: 259, type: 3, values: [compression] }, { id: 262, type: 3, values: [spp === 1 ? 32803 : 34892] }, { id: 277, type: 3, values: [spp] }, { id: 284, type: 3, values: [1] },
    ...(spp === 1 ? [{ id: 33421, type: 3, values: [2, 2] }, { id: 33422, type: 1, values: [0, 1, 1, 2] }] : []), ...extra];
}
const ifd0 = (extra: TagSpec[] = []): TagSpec[] => [{ id: 50706, type: 1, values: [1, 7, 1, 0] }, { id: 271, type: 2, values: [...new TextEncoder().encode("Synthetic"), 0] }, ...extra];
/** Tiles of `tw` × `tl` over a width × height × spp image (edge tiles padded with zeros), each encoded by `encode`. */
function tiles(codes: ArrayLike<number>, width: number, height: number, spp: number, tw: number, tl: number, encode: (tile: Uint16Array) => Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let ty = 0; ty < Math.ceil(height / tl); ty++) for (let tx = 0; tx < Math.ceil(width / tw); tx++) {
    const tile = new Uint16Array(tw * tl * spp);
    for (let y = 0; y < tl; y++) for (let x = 0; x < tw; x++) for (let c = 0; c < spp; c++) {
      const sx = tx * tw + x, sy = ty * tl + y;
      tile[(y * tw + x) * spp + c] = sx < width && sy < height ? codes[(sy * width + sx) * spp + c]! : 0;
    }
    out.push(encode(tile));
  }
  return out;
}
const tileTags = (tw: number, tl: number): TagSpec[] => [{ id: 322, type: 3, values: [tw] }, { id: 323, type: 3, values: [tl] }];

describe("phone DNG import: JPEG XL raw data (#598)", () => {
  it("decodes lossless JPEG XL tiles bit-exactly through jxl-oxide's 16-bit PNG (LinearRaw RGB and CFA, 8, 12, 14 and 16 bits)", async () => {
    const next = random(0x598);
    for (const [spp, bits] of [[3, 16], [3, 12], [1, 14], [1, 8], [3, 8]] as const) {
      const width = 70, height = 45, codes = Uint16Array.from({ length: width * height * spp }, () => Math.floor(next() * 2 ** bits));
      codes[0] = 2 ** bits - 1;
      const data = tiles(codes, width, height, spp, 32, 32, (tile) => encodeLosslessJxl({ width: 32, height: 32, channels: spp, bits, samples: tile }));
      const bytes = writeTiff(true, [{ tags: [...linearRawTags(width, height, spp, bits, 52546, tileTags(32, 32)), ...ifd0([{ id: 52553, type: FLOAT, values: [0] }])], chunks: { offsetTag: 324, countTag: 325, data } }]);
      const dng = await importDngRawImage({ bytes, jpegXlDecoder: jxl });
      expect(dng).toMatchObject({ compression: "jpeg-xl", lossySource: false, width, height, samplesPerPixel: spp, bitsPerSample: bits });
      expect(Array.from(dng.codes)).toEqual(Array.from(codes));
      expect(() => parseDngRawImage({ bytes })).toThrow(/importDngRawImage/u);
      await expect(importDngRawImage({ bytes })).rejects.toThrow(/jpegXlDecoder/u);
    }
  }, 60_000);

  it("labels JPEG XL data lossy unless JXLDistance is 0, and refuses a decoder that loses bit depth or size", async () => {
    const width = 16, height = 16, codes = Uint16Array.from({ length: width * height }, (_, i) => i * 97 % 4096);
    const data = [encodeLosslessJxl({ width, height, channels: 1, bits: 12, samples: codes })];
    const file = (extra: TagSpec[]): Uint8Array => writeTiff(true, [{ tags: [...linearRawTags(width, height, 1, 12, 52546), ...ifd0(extra)], chunks: { offsetTag: 273, countTag: 279, data } }]);
    const unmarked = await importDngRawImage({ bytes: file([]), jpegXlDecoder: jxl });
    expect(unmarked.lossySource).toBe(true);
    expect(unmarked.assumptions.some((a) => a.includes("not marked lossless"))).toBe(true);
    const lossy = await importDngRawImage({ bytes: file([{ id: 52553, type: FLOAT, values: [floatBits(1)] }]), jpegXlDecoder: jxl });
    expect(lossy.assumptions.some((a) => a.includes("JXLDistance 1"))).toBe(true);
    const eightBit = (): Uint8Array => encodeTestPng({ width, height, channels: 1, depth: 8, samples: new Uint8Array(width * height) });
    await expect(importDngRawImage({ bytes: file([]), jpegXlDecoder: eightBit })).rejects.toThrow(/8-bit samples for a 12-bit tile/u);
    const wrongSize = (): Uint8Array => encodeTestPng({ width: 8, height, channels: 1, depth: 16, samples: new Uint16Array(8 * height) });
    await expect(importDngRawImage({ bytes: file([]), jpegXlDecoder: wrongSize })).rejects.toThrow(InvalidConfigurationError);
    await expect(importDngRawImage({ bytes: file([]), jpegXlDecoder: () => Uint8Array.of(1, 2, 3) })).rejects.toThrow(/did not return a PNG/u);
    await expect(importDngRawImage({ bytes: file([]), jpegXlDecoder: 3 as never })).rejects.toThrow(/function/u);
    // A PNG the reader writes itself (stored deflate, filter 0) reads back exactly, scaled from 16 bits.
    const png = (): Uint8Array => encodeTestPng({ width, height, channels: 1, depth: 16, samples: Array.from(codes, (v) => Math.round(v * 65535 / 4095)) });
    expect(Array.from((await importDngRawImage({ bytes: file([]), jpegXlDecoder: png })).codes)).toEqual(Array.from(codes));
  });
});

describe("phone DNG import: lossy JPEG raw data (#598)", () => {
  it("decodes 8-bit LinearRaw lossy JPEG tiles with shared JPEGTables and makes them linear with OpcodeList2 MapPolynomial", async () => {
    const width = 48, height = 40, rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(40 + 150 * ((i % width) / width) + 20 * c);
    let tables: Uint8Array | undefined;
    const data = tiles(rgb, width, height, 3, 32, 32, (tile) => {
      const r = encodeBaselineJpeg({ width: 32, height: 32, components: [{ id: 0x52, h: 1, v: 1 }, { id: 0x47, h: 1, v: 1 }, { id: 0x42, h: 1, v: 1 }], samples: tile, step: 1, separateTables: true });
      tables = r.tables; return r.jpeg;
    });
    // Gamma 2 coding: stored = 255·√linear, undone by linear = (stored)² (MapPolynomial coefficient c2 = 1).
    const poly = areaSpec(new BigEndianBytes(), { top: 0, left: 0, bottom: height, right: width, planes: 3 }).u32(2).f64(0).f64(0).f64(1).bytes;
    const bytes = writeTiff(true, [{ tags: [...linearRawTags(width, height, 3, 8, 34892, [...tileTags(32, 32), { id: 347, type: UNDEFINED, values: Array.from(tables!) },
      { id: 51009, type: UNDEFINED, values: opcodeList([{ id: 8, params: poly }]) }]), ...ifd0()], chunks: { offsetTag: 324, countTag: 325, data } }]);
    for (const dng of [parseDngRawImage({ bytes }), await importDngRawImage({ bytes })]) {
      expect(dng).toMatchObject({ compression: "lossy-jpeg", lossySource: true, bitsPerSample: 8 });
      let worst = 0; for (let i = 0; i < rgb.length; i++) worst = Math.max(worst, Math.abs(dng.codes[i]! - rgb[i]!));
      expect(worst).toBeLessThanOrEqual(1);
      expect(dng.assumptions.some((a) => a.startsWith("dngImport.lossySource"))).toBe(true);
      const stage = developDngStageImage(dng);
      expect(stage.stage).toBe(3);
      expect(stage.assumptions).toContain("OpcodeList2 MapPolynomial (8) applied.");
      for (const i of [0, 777, width * height - 1]) expect(stage.data[i * 3]!).toBeCloseTo((dng.codes[i * 3]! / 255) ** 2, 6);
    }
    // CFA or 16-bit lossy JPEG is not DNG.
    expect(() => parseDngRawImage({ bytes: writeTiff(true, [{ tags: [...linearRawTags(8, 8, 1, 8, 34892), ...ifd0()], chunks: { offsetTag: 273, countTag: 279, data: [Uint8Array.of(0)] } }]) })).toThrow(/8-bit LinearRaw/u);
    expect(() => parseDngRawImage({ bytes: writeTiff(true, [{ tags: [...linearRawTags(8, 8, 3, 8, 8), ...ifd0()], chunks: { offsetTag: 273, countTag: 279, data: [Uint8Array.of(0)] } }]) })).toThrow(/Compression 8 is not supported/u);
  });
});

describe("phone DNG import: memory, half size and tags (#598)", () => {
  const width = 61, height = 33, spp = 3, codes = Uint16Array.from({ length: width * height * spp }, (_, i) => (i * 7919) % 65536);
  const uncompressed = (extraRaw: TagSpec[] = [], extra0: TagSpec[] = [], extraIfds: Parameters<typeof writeTiff>[1] = []): Uint8Array => {
    const strip = new Uint8Array(codes.length * 2); codes.forEach((v, i) => { strip[2 * i] = v & 255; strip[2 * i + 1] = v >> 8; });
    return writeTiff(true, [{ tags: [...linearRawTags(width, height, spp, 16, 1, [{ id: 50829, type: 3, values: [1, 2, 33, 61] }, { id: 50715, type: 10, values: Array.from({ length: 59 }, (_, i) => [i, 1]).flat() }, ...extraRaw]), ...ifd0(extra0)],
      chunks: { offsetTag: 273, countTag: 279, data: [strip] } }, ...extraIfds]);
  };

  it("checks maximumBytes before allocating and names the estimate", () => {
    expect(DNG_IMPORT_LIMITS.defaultMaximumBytes).toBe(2 ** 30);
    expect(() => parseDngRawImage({ bytes: uncompressed(), maximumBytes: 20_000 })).toThrow(/estimated .* MiB, above maximumBytes/u);
    expect(() => parseDngRawImage({ bytes: uncompressed(), maximumBytes: 2 ** 33 })).toThrow(InvalidConfigurationError);
    expect(parseDngRawImage({ bytes: uncompressed(), maximumBytes: 200_000 }).width).toBe(width);
  });

  it("decodes a half-size LinearRaw preview: rounded 2 × 2 means, halved geometry", () => {
    const full = parseDngRawImage({ bytes: uncompressed() }), half = parseDngRawImage({ bytes: uncompressed(), size: "half" });
    expect(half).toMatchObject({ width: 31, height: 17, scale: 0.5, defaultCrop: { x: 0, y: 0, width: 30.5, height: 16.5 }, activeArea: { x: 1, y: 0, width: 30, height: 17 } });
    expect(half.blackLevel.deltaH).toHaveLength(30);
    for (const [x, y, c] of [[0, 0, 0], [5, 7, 2], [30, 16, 1]] as const) {
      const xs = [2 * x, 2 * x + 1].filter((v) => v < width), ys = [2 * y, 2 * y + 1].filter((v) => v < height);
      let sum = 0; for (const yy of ys) for (const xx of xs) sum += full.codes[(yy * width + xx) * spp + c]!;
      expect(half.codes[(y * 31 + x) * spp + c]).toBe(Math.round(sum / (xs.length * ys.length)));
    }
    expect(half.assumptions.some((a) => a.startsWith("dngImport.halfSize"))).toBe(true);
    const cfa = writeTiff(true, [{ tags: [...linearRawTags(4, 4, 1, 16, 1), ...ifd0()], chunks: { offsetTag: 273, countTag: 279, data: [new Uint8Array(32)] } }]);
    expect(() => parseDngRawImage({ bytes: cfa, size: "half" })).toThrow(/LinearRaw/u);
    expect(() => parseDngRawImage({ bytes: cfa, size: "quarter" as never })).toThrow(InvalidConfigurationError);
  });

  it("reports phone tags it does not apply, and ignores malformed ones without failing", () => {
    const dng = parseDngRawImage({ bytes: uncompressed([{ id: 51009, type: UNDEFINED, values: [0, 0, 0, 9, 1] }], [{ id: 50940, type: FLOAT, values: [0, 0, floatBits(1), floatBits(1)] },
      { id: 52551, type: 4, values: [1] }, { id: 52543, type: UNDEFINED, values: [1, 0, 0, 0, 9, 0, 0, 0] }, { id: 50730, type: 10, values: [-1, 2] }]) });
    expect(dng.assumptions).toEqual(expect.arrayContaining([expect.stringContaining("ProfileToneCurve (50940)"), expect.stringContaining("ProfileDynamicRange (52551)"),
      expect.stringContaining("OpcodeList2 is malformed"), expect.stringContaining("RGBTables is malformed")]));
    expect(dng.opcodeList2).toBeNull();
    expect(dng.baselineExposure).toBe(-0.5);
  });

  it("decodes semantic masks and returns them by name", async () => {
    const mask = Uint8Array.from({ length: 8 * 4 }, (_, i) => i * 8);
    const maskIfd = { tags: [{ id: 254, type: 4, values: [0x10004] }, { id: 256, type: 4, values: [8] }, { id: 257, type: 4, values: [4] }, { id: 258, type: 3, values: [8] },
      { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [52527] }, { id: 277, type: 3, values: [1] }, { id: 52526, type: 2, values: [...new TextEncoder().encode("Sky"), 0] }], chunks: { offsetTag: 273, countTag: 279, data: [mask] } };
    for (const dng of [parseDngRawImage({ bytes: uncompressed([], [], [maskIfd]) }), await importDngRawImage({ bytes: uncompressed([], [], [maskIfd]) })]) {
      expect(dng.semanticMasks).toHaveLength(1);
      expect(dng.semanticMasks[0]).toMatchObject({ name: "Sky", instanceId: null, width: 8, height: 4 });
      expect(dng.semanticMasks[0]!.data[3]).toBeCloseTo(24 / 255, 6);
    }
  });
});

describe("DNG opcodes (#598, #600)", () => {
  const W = 12, H = 10;
  const ramp = (planes: number): Float32Array => Float32Array.from({ length: W * H * planes }, (_, i) => 0.2 + 0.5 * ((Math.floor(i / planes) % W) / W) + 0.01 * (i % planes));
  const run = (ops: Parameters<typeof opcodeList>[0], planes = 1, fast = false, stage: 1 | 2 | 3 = 2): { data: Float32Array; notes: string[] } => {
    const image = { width: W, height: H, planes, data: ramp(planes) };
    const notes = applyDngOpcodes(image, parseDngOpcodeList(Uint8Array.from(opcodeList(ops))), { stage, fast });
    return { data: image.data, notes };
  };
  const area = (o: Partial<Parameters<typeof areaSpec>[1]> = {}): BigEndianBytes => areaSpec(new BigEndianBytes(), { top: 0, left: 0, bottom: H, right: W, ...o });

  it("applies MapTable, MapPolynomial, the per-row and per-column opcodes and GainMap over their areas and pitches", () => {
    const src = ramp(1);
    const table = run([{ id: 7, params: area({ top: 2, bottom: 4 }).u32(65536).raw(new BigEndianBytes().raw(Array.from({ length: 65536 }, (_, i) => [(65535 - i) >> 8, (65535 - i) & 255]).flat()).bytes).bytes }]);
    expect(table.data[2 * W + 3]).toBeCloseTo(1 - src[2 * W + 3]!, 4);
    expect(table.data[5 * W + 3]).toBe(src[5 * W + 3]);
    const poly = run([{ id: 8, params: area({ colPitch: 2 }).u32(1).f64(0.1).f64(2).bytes }]);
    expect(poly.data[4]).toBeCloseTo(Math.min(1, 0.1 + 2 * src[4]!), 6);
    expect(poly.data[5]).toBe(src[5]);
    const rows = run([{ id: 10, params: area().u32(H).raw(new BigEndianBytes().f32(0.05).f32(-0.05).f32(0).f32(0).f32(0).f32(0).f32(0).f32(0).f32(0).f32(0).bytes).bytes }]);
    expect(rows.data[1]).toBeCloseTo(src[1]! + 0.05, 6); expect(rows.data[W + 1]).toBeCloseTo(src[W + 1]! - 0.05, 6);
    const cols = run([{ id: 13, params: area().u32(W).raw(new BigEndianBytes().raw(Array.from({ length: W }, (_, i) => new BigEndianBytes().f32(i === 3 ? 0.5 : 1).bytes).flat()).bytes).bytes }]);
    expect(cols.data[3]).toBeCloseTo(src[3]! * 0.5, 6);
    // GainMap: 2 × 2 points at the corners' pixel centres region (origin 0, spacing 1): gains 1 (top) and 2 (bottom), interpolated by row.
    const gain = run([{ id: 9, params: area().u32(2).u32(2).f64(1).f64(1).f64(0).f64(0).u32(1).f32(1).f32(1).f32(2).f32(2).bytes }]);
    const y = 6, expected = 1 + (y + 0.5) / H;
    expect(gain.data[y * W + 2]).toBeCloseTo(Math.min(1, src[y * W + 2]! * expected), 6);
    expect(gain.notes).toEqual(["OpcodeList2 GainMap (9) applied."]);
  });

  it("applies WarpRectilinear with cubic (full) or bilinear (fast) resampling and FixVignetteRadial", () => {
    const warp = (kr0: number, kt = [0, 0]): number[] => new BigEndianBytes().u32(1).f64(kr0).f64(0).f64(0).f64(0).f64(kt[0]!).f64(kt[1]!).f64(0.5).f64(0.5).bytes;
    const identity = run([{ id: 1, params: warp(1) }], 3);
    expect(Array.from(identity.data)).toEqual(Array.from(ramp(3)).map((v) => Math.fround(v)));
    // kr0 = 0.5 reads each pixel from halfway to the centre: on a horizontal ramp (linear), cubic and bilinear agree exactly.
    const full = run([{ id: 1, params: warp(0.5) }], 3, false), fast = run([{ id: 1, params: warp(0.5) }], 3, true);
    expect(full.notes[0]).toContain("cubic convolution"); expect(fast.notes[0]).toContain("bilinear");
    const src = ramp(3), at = (d: Float32Array, x: number, y: number, c: number): number => d[(y * W + x) * 3 + c]!;
    const sx = 6 + (9 - 6) * 0.5;
    const expected = at(src, 7, 4, 0) + (at(src, 8, 4, 0) - at(src, 7, 4, 0)) * (sx - 7);
    expect(at(full.data, 9, 4, 0)).toBeCloseTo(expected, 5);
    expect(at(fast.data, 9, 4, 0)).toBeCloseTo(expected, 5);
    // A tangential term moves the source vertically too (here off the ramp's axis: the value stays the row's).
    expect(Number.isFinite(run([{ id: 1, params: warp(1, [0.01, 0.02]) }], 3).data[0])).toBe(true);
    // Per-plane parameters must match the image's planes.
    expect(run([{ id: 1, params: new BigEndianBytes().u32(2).raw(Array<number>(96).fill(0)).f64(0.5).f64(0.5).bytes }], 3).notes[0]).toContain("plane count");
    const vignette = run([{ id: 3, params: new BigEndianBytes().f64(0.5).f64(0).f64(0).f64(0).f64(0).f64(0.5).f64(0.5).bytes }]);
    // The corner is at r = 1: gain 1 + k0.
    expect(vignette.data[0]).toBeCloseTo(ramp(1)[0]! * 1.5, 5);
  });

  it("fixes bad pixels from the constant and the list with the nearest same-colour ring", () => {
    const image = { width: 6, height: 6, planes: 1, data: Float32Array.from({ length: 36 }, (_, i) => (i + 1) / 100) };
    image.data[2 * 6 + 2] = 1000 / 65535; // red site (BayerPhase 0) holding the constant
    image.data[2 * 6 + 3] = 0.9; // green site in the list
    const ops = parseDngOpcodeList(Uint8Array.from(opcodeList([{ id: 4, params: new BigEndianBytes().u32(1000).u32(0).bytes },
      { id: 5, params: new BigEndianBytes().u32(0).u32(1).u32(0).u32(2).u32(3).bytes }])));
    expect(applyDngOpcodes(image, ops, { stage: 1, fast: false })).toEqual(["OpcodeList1 FixBadPixelsConstant (4) applied.", "OpcodeList1 FixBadPixelsList (5) applied."]);
    const v = (r: number, c: number): number => (r * 6 + c + 1) / 100;
    expect(image.data[14]).toBeCloseTo((v(0, 2) + v(4, 2) + v(2, 0) + v(2, 4)) / 4, 6);
    expect(image.data[15]).toBeCloseTo((v(1, 2) + v(1, 4) + v(3, 2) + v(3, 4)) / 4, 6);
    const rgb = { width: 6, height: 6, planes: 3, data: new Float32Array(108) };
    expect(applyDngOpcodes(rgb, ops, { stage: 3, fast: false })[0]).toContain("single-plane CFA");
  });

  it("reports unsupported opcodes and refuses malformed lists with domain errors", () => {
    expect(run([{ id: 2, flags: 1, params: [1, 2, 3] }, { id: 99, params: [] }]).notes).toEqual(["OpcodeList2 WarpFisheye (2) not applied: not supported (optional).",
      "OpcodeList2 Unknown (99) not applied: not supported (marked required by the file)."]);
    for (const bad of [[0, 0, 0], [0, 0, 0, 1], opcodeList([{ id: 8, params: [0, 0, 0] }]), opcodeList([{ id: 1, params: new BigEndianBytes().u32(1).raw(Array<number>(48).fill(0)).f64(2).f64(0.5).bytes }])])
      expect(() => parseDngOpcodeList(Uint8Array.from(bad))).toThrow(InvalidConfigurationError);
  });

  it("develops the stage image: OpcodeList1, linearization and black/white scaling over the ActiveArea, then OpcodeList2 and 3", () => {
    const width = 8, height = 6, codes = Uint16Array.from({ length: width * height }, (_, i) => 1000 + i * 100);
    codes[3 * width + 4] = 7; // a bad red/blue site for OpcodeList1
    const strip = new Uint8Array(codes.length * 2); codes.forEach((v, i) => { strip[2 * i] = v & 255; strip[2 * i + 1] = v >> 8; });
    const list1 = opcodeList([{ id: 4, params: new BigEndianBytes().u32(7).u32(0).bytes }]);
    const list2 = opcodeList([{ id: 8, params: areaSpec(new BigEndianBytes(), { top: 0, left: 0, bottom: 4, right: 6 }).u32(1).f64(0).f64(2).bytes }]);
    const list3 = opcodeList([{ id: 1, params: new BigEndianBytes().u32(1).f64(1).f64(0).f64(0).f64(0).f64(0).f64(0).f64(0.5).f64(0.5).bytes }]);
    const bytes = writeTiff(true, [{ tags: [...linearRawTags(width, height, 1, 16, 1, [{ id: 50829, type: 3, values: [1, 1, 5, 7] }, { id: 50714, type: 3, values: [500] },
      { id: 50717, type: 4, values: [10000] }, { id: 51008, type: UNDEFINED, values: list1 }, { id: 51009, type: UNDEFINED, values: list2 }, { id: 51022, type: UNDEFINED, values: list3 }]), ...ifd0()],
    chunks: { offsetTag: 273, countTag: 279, data: [strip] } }]);
    const dng = parseDngRawImage({ bytes });
    const stage = developDngStageImage(dng);
    expect(stage).toMatchObject({ width: 6, height: 4, planes: 1, stage: 2, fast: { requested: false, defaultedFrom: "format" } });
    const lin = (v: number): number => Math.min(1, 2 * (v - 500) / 9500);
    expect(stage.data[0]).toBeCloseTo(lin(codes[width + 1]!), 4);
    // The bad site (row 3, column 4 of the stored image) was replaced by its ring mean before linearization.
    const ring = (codes[1 * width + 4]! + codes[5 * width + 4]! + codes[3 * width + 2]! + codes[3 * width + 6]!) / 4;
    expect(stage.data[2 * 6 + 3]).toBeCloseTo(lin(ring), 3);
    expect(stage.assumptions.at(-1)).toContain("OpcodeList3 not applied");
    expect(developDngStageImage(dng, { format: "srgb-8" }).fast).toEqual({ requested: true, defaultedFrom: "format" });
    expect(developDngStageImage(dng, { opcodes: false }).assumptions).toEqual(["Opcode lists not applied (opcodes: false)."]);
    expect(() => developDngStageImage(dng, { format: "tiff" as never })).toThrow(InvalidConfigurationError);
    expect(() => developDngStageImage(dng, { extra: 1 } as never)).toThrow(InvalidConfigurationError);
  });
});

describe("ProfileGainTableMap and RGBTables (#598)", () => {
  /** Little-endian tag bytes (both tags are read in the file's byte order). */
  const le = (write: (w: DataView, p: { at: number }) => void, size: number): Uint8Array => { const b = new Uint8Array(size); write(new DataView(b.buffer), { at: 0 }); return b; };
  const pgtm = (version: 1 | 2, gains: number[], dataType = 3): Uint8Array => le((v, p) => {
    const u32 = (x: number): void => { v.setUint32(p.at, x, true); p.at += 4; }, f32 = (x: number): void => { v.setFloat32(p.at, x, true); p.at += 4; }, f64 = (x: number): void => { v.setFloat64(p.at, x, true); p.at += 8; };
    u32(1); u32(2); f64(1); f64(1); f64(0); f64(0); u32(2); [0, 1, 0, 0, 0].forEach(f32);
    if (version === 2) { u32(dataType); f32(1); f32(1); f32(3); }
    for (const g of gains) { if (dataType === 3) f32(g); else { v.setUint8(p.at, g); p.at += 1; } }
  }, 64 + (version === 2 ? 16 : 0) + gains.length * 4);

  it("parses PGTM and PGTM2 (PGTM2 wins) and applies the weight-selected, spatially interpolated gain", () => {
    const strip = new Uint8Array(4 * 2 * 3 * 2);
    const bytes = writeTiff(true, [{ tags: [...linearRawTags(4, 2, 3, 16, 1, [{ id: 52525, type: UNDEFINED, values: Array.from(pgtm(1, [1, 1, 1, 1])) }]),
      ...ifd0([{ id: 52544, type: UNDEFINED, values: Array.from(pgtm(2, [0, 255, 0, 255], 0)) }, { id: 50730, type: 10, values: [1, 1] }])], chunks: { offsetTag: 273, countTag: 279, data: [strip] } }]);
    const dng = parseDngRawImage({ bytes }), map = dng.profileGainTableMap!;
    expect(map).toMatchObject({ version: 2, pointsV: 1, pointsH: 2, tablePoints: 2, spacingV: 1, originV: 0 });
    expect(Array.from(map.gains)).toEqual([1, 3, 1, 3]);
    expect(dng.baselineExposure).toBe(1);
    // Green weight 1: t = G·2^BaselineExposure; table index t·N with N = 2 (clamped to N − 1).
    const image = { width: 2, height: 1, data: Float32Array.of(0.1, 0.1, 0.1, 0.2, 0.2, 0.2) };
    applyDngProfileGainTableMap({ image, map, baselineExposureStops: 1 });
    // Pixel 0: x_map = (0.25 − 0)/1 → between points 0 and 1 (both tables 1 → 3); t = 0.2, scaled 0.4: gain 1 + 2·0.4 = 1.8.
    expect(image.data[0]).toBeCloseTo(0.1 * 1.8, 6);
    expect(image.data[3]).toBeCloseTo(Math.min(1, 0.2 * (1 + 2 * 0.8)), 6);
    expect(() => parseDngProfileGainTableMap(Uint8Array.of(1, 2, 3), true, 1)).toThrow(InvalidConfigurationError);
  });

  const rgbTables = (tables: { name: string; samples: (r: number, g: number, b: number) => [number, number, number]; primaries?: number; gamma?: number; gamut?: number }[], method = 0): Uint8Array => {
    const out: number[] = [], u32 = (x: number): void => { out.push(x & 255, (x >> 8) & 255, (x >> 16) & 255, x >>> 24); };
    u32(tables.length); u32(method);
    for (const t of tables) {
      out.push(t.name.length & 255, t.name.length >> 8, ...new TextEncoder().encode(t.name), 3, 1, t.gamma ?? 0, t.primaries ?? 4, t.gamut ?? 0);
      for (let r = 0; r < 3; r++) for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (const v of t.samples(r / 2, g / 2, b / 2)) { const x = Math.round(v * 65535); out.push(x & 255, x >> 8); }
    }
    return Uint8Array.from(out);
  };
  const identity = (r: number, g: number, b: number): [number, number, number] => [r, g, b];
  const swap = (r: number, g: number, b: number): [number, number, number] => [b, g, r];

  it("applies an identity table without change, a channel-swap table exactly, and masked tables by weighted sum or in sequence", () => {
    const image = (): { width: number; height: number; data: Float32Array } => ({ width: 2, height: 1, data: Float32Array.of(0.2, 0.5, 0.8, 0.6, 0.3, 0.1) });
    for (const [primaries, gamma] of [[4, 0], [0, 1], [1, 3], [2, 2], [3, 4]] as [number, number][]) {
      // Tetrahedral interpolation reproduces an identity lattice exactly; with GamutExtension "extend" the part outside the table's
      // primaries is added back, so every encoding round-trips. With "clip" an out-of-gamut colour is clipped (changed).
      const tables = parseDngRgbTables(rgbTables([{ name: "", samples: identity, primaries, gamma, gamut: 1 }]), true)!;
      const img = image(); expect(applyDngRgbTables({ image: img, tables })).toEqual([]);
      for (let i = 0; i < 6; i++) expect(img.data[i]).toBeCloseTo(image().data[i]!, 4);
      if (primaries === 0) {
        const clipped = image(); applyDngRgbTables({ image: clipped, tables: parseDngRgbTables(rgbTables([{ name: "", samples: identity, primaries, gamma }]), true)! });
        expect(Math.abs(clipped.data[0]! - 0.2)).toBeGreaterThan(0.01);
      }
    }
    const swapped = image(); applyDngRgbTables({ image: swapped, tables: parseDngRgbTables(rgbTables([{ name: "", samples: swap }]), true)! });
    expect(Array.from(swapped.data).map((v) => +v.toFixed(4))).toEqual([0.8, 0.5, 0.2, 0.1, 0.3, 0.6]);
    // A "Sky" mask of 1 on the right pixel, 0 on the left: the masked swap applies only there.
    const masks = [{ name: "Sky", width: 2, height: 1, data: Float32Array.of(0, 1) }];
    for (const method of [0, 1]) {
      const img = image(), tables = parseDngRgbTables(rgbTables([{ name: "Sky", samples: swap }, { name: "Person", samples: swap }], method), true)!;
      const notes = applyDngRgbTables({ image: img, tables, masks });
      expect(tables.compositeMethod).toBe(method ? "sequential" : "weighted-sum");
      expect(notes).toEqual(['RGBTables table "Person" not applied: no semantic mask of that name.']);
      expect(Array.from(img.data).map((v) => +v.toFixed(4))).toEqual([0.2, 0.5, 0.8, 0.1, 0.3, 0.6]);
    }
    expect(parseDngRgbTables(Uint8Array.of(0, 0, 0, 0), true)).toBeNull();
    expect(() => parseDngRgbTables(Uint8Array.of(21, 0, 0, 0, 0, 0, 0, 0), true)).toThrow(InvalidConfigurationError);
  });
});

describe("Row and column interleave (#598)", () => {
  it("undoes RowInterleaveFactor and ColumnInterleaveFactor 2 (field by field) and reports the inferred order", () => {
    const width = 6, height = 4, image = Uint16Array.from({ length: width * height }, (_, i) => i + 1), stored = new Uint16Array(image.length);
    // Stored row s holds image row (s mod 2)·2 + ⌊s/2⌋; likewise for columns.
    for (let s = 0; s < height; s++) for (let t = 0; t < width; t++) stored[s * width + t] = image[((s % 2) * 2 + Math.floor(s / 2)) * width + (t % 3) * 2 + Math.floor(t / 3)]!;
    const strip = new Uint8Array(stored.length * 2); stored.forEach((v, i) => { strip[2 * i] = v & 255; strip[2 * i + 1] = v >> 8; });
    const bytes = writeTiff(true, [{ tags: [...linearRawTags(width, height, 1, 16, 1, [{ id: 50975, type: 3, values: [2] }, { id: 52547, type: 3, values: [2] }]), ...ifd0()], chunks: { offsetTag: 273, countTag: 279, data: [strip] } }]);
    const dng = parseDngRawImage({ bytes });
    expect(Array.from(dng.codes)).toEqual(Array.from(image));
    expect(dng.assumptions.some((a) => a.startsWith("dngImport.interleave"))).toBe(true);
  });
});
