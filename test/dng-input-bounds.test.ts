// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  parseDngRawImage, importDngRawImage, developDngStageImage, estimateDngRawNoise, applyDngOpcodes, parseDngOpcodeList, serializeRewrittenDng, InvalidConfigurationError,
  type DngOpcode, type DngStageImage
} from "../src/index.js";
import { opcodeList, BigEndianBytes, encodeTestPng } from "./helpers/phone-dng-fixtures.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.28.0: bounds on DNG import, development and rewrite inputs whose cost or memory the file controls (opcode counts, strip
 * tables, semantic masks), and domain errors for malformed tags. Every file is synthetic and built here.
 */

/** A value of one TIFF tag: integers by type, or raw bytes. */
interface Tag { id: number; type: number; values?: ArrayLike<number>; bytes?: Uint8Array }
const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8, 11: 4, 12: 8 };

/**
 * A little-endian TIFF writer that lets strip offsets point anywhere (blobs are placed first and their offsets returned), so
 * tables can alias one block of bytes. IFDs are written children first; `ifd` returns the directory's offset.
 */
class Tiff {
  private out = new Uint8Array(1 << 16); private length = 8;
  private grow(n: number): void { if (this.length + n > this.out.length) { const next = new Uint8Array(Math.max(this.out.length * 2, this.length + n)); next.set(this.out); this.out = next; } }
  private align(): void { if (this.length % 2) { this.grow(1); this.length++; } }
  blob(bytes: Uint8Array): number { this.align(); this.grow(bytes.length); const at = this.length; this.out.set(bytes, at); this.length += bytes.length; return at; }
  private encode(t: Tag): Uint8Array {
    if (t.bytes) return t.bytes;
    const values = t.values ?? [], size = SIZES[t.type]!, count = t.type === 5 || t.type === 10 ? values.length / 2 : values.length;
    const data = new Uint8Array(count * size), view = new DataView(data.buffer);
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      switch (t.type) {
        case 1: case 2: case 7: data[i] = v; break;
        case 3: view.setUint16(i * 2, v, true); break;
        case 4: case 5: view.setUint32(i * 4, v, true); break;
        case 10: view.setInt32(i * 4, v, true); break;
        case 11: view.setFloat32(i * 4, v, true); break;
        case 12: view.setFloat64(i * 8, v, true); break;
      }
    }
    return data;
  }
  ifd(tags: Tag[]): number {
    const sorted = [...tags].sort((a, b) => a.id - b.id), payloads = sorted.map((t) => this.encode(t));
    const external = payloads.map((p) => p.length > 4 ? this.blob(p) : -1);
    this.align(); this.grow(2 + sorted.length * 12 + 4);
    const at = this.length, view = new DataView(this.out.buffer);
    view.setUint16(at, sorted.length, true);
    sorted.forEach((t, i) => {
      const p = at + 2 + i * 12, count = payloads[i]!.length / SIZES[t.type]!;
      view.setUint16(p, t.id, true); view.setUint16(p + 2, t.type, true); view.setUint32(p + 4, count, true);
      if (external[i]! >= 0) view.setUint32(p + 8, external[i]!, true); else this.out.set(payloads[i]!, p + 8);
    });
    view.setUint32(at + 2 + sorted.length * 12, 0, true);
    this.length += 2 + sorted.length * 12 + 4;
    return at;
  }
  finish(first: number): Uint8Array {
    const bytes = this.out.slice(0, this.length);
    bytes.set([0x49, 0x49, 42, 0]); new DataView(bytes.buffer).setUint32(4, first, true);
    return bytes;
  }
}
const ascii = (s: string): number[] => [...new TextEncoder().encode(s), 0];
const DNG_VERSION: Tag = { id: 50706, type: 1, values: [1, 7, 1, 0] };
/** Tags of a 16-bit single-plane CFA (RGGB) raw image, without its strip tables. */
function cfaTags(width: number, height: number, extra: Tag[] = []): Tag[] {
  return [{ id: 254, type: 4, values: [0] }, { id: 256, type: 4, values: [width] }, { id: 257, type: 4, values: [height] }, { id: 258, type: 3, values: [16] },
    { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [32803] }, { id: 277, type: 3, values: [1] }, { id: 33421, type: 3, values: [2, 2] },
    { id: 33422, type: 1, values: [0, 1, 1, 2] }, { id: 50717, type: 4, values: [65535] }, ...extra];
}
const strips = (offsets: ArrayLike<number>, counts: ArrayLike<number>): Tag[] => [{ id: 273, type: 4, values: offsets }, { id: 279, type: 4, values: counts }];
/** A small valid CFA DNG (one strip), with extra tags in the raw IFD and in IFD 0. */
function smallDng(width: number, height: number, raw: Tag[] = [], ifd0: Tag[] = []): Uint8Array {
  const t = new Tiff(), data = new Uint8Array(width * height * 2);
  for (let i = 0; i < width * height; i++) { const v = 1000 + (i * 997) % 30000; data[2 * i] = v & 255; data[2 * i + 1] = v >> 8; }
  const at = t.blob(data);
  return t.finish(t.ifd([...cfaTags(width, height, [{ id: 278, type: 4, values: [height] }, ...strips([at], [data.length]), ...raw]), DNG_VERSION, ...ifd0]));
}
const filled = (n: number, v: number): number[] => Array<number>(n).fill(v);

describe("DNG opcode lists: bounded work and finite results (2.28.0)", () => {
  const stage = (width: number, height: number): DngStageImage => ({ width, height, planes: 1, data: Float32Array.from({ length: width * height }, (_, i) => ((i * 7919) % 1000) / 1000) });
  const badPixels = (rects: [number, number, number, number][], points: [number, number][] = []): DngOpcode[] =>
    [{ id: 5, name: "FixBadPixelsList", dngVersion: [1, 3, 0, 0], optional: false, previewSkip: false, parameters: { opcode: "FixBadPixelsList", bayerPhase: 0, points, rects } }];

  it("marks many FixBadPixelsList rectangles in one pass with the same result as one", () => {
    const one = stage(256, 256), many = stage(256, 256);
    applyDngOpcodes(one, badPixels([[0, 0, 0xffffffff, 0xffffffff]]), { stage: 1, fast: true });
    const start = performance.now();
    applyDngOpcodes(many, badPixels(Array.from({ length: 20_000 }, () => [0, 0, 0xffffffff, 0xffffffff] as [number, number, number, number])), { stage: 1, fast: true });
    expect(Array.from(many.data)).toEqual(Array.from(one.data));
    // Informational: one pass is far below the 20,000 image passes the rectangles used to cost.
    expect(performance.now() - start).toBeLessThan(scaledTimeout(1_000));
  });

  it("marks overlapping, touching, empty and out-of-image rectangles exactly as a direct loop does", () => {
    const width = 23, height = 17, next = ((s: number) => (): number => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; })(0x2280);
    for (let trial = 0; trial < 40; trial++) {
      const rects = Array.from({ length: 1 + Math.floor(next() * 6) }, (): [number, number, number, number] => {
        const t = Math.floor(next() * 22), l = Math.floor(next() * 28), pick = next();
        return pick < 0.15 ? [t, l, t, l + 3] : pick < 0.3 ? [t, l, 0xffffffff, 0xffffffff] : [t, l, t + Math.floor(next() * 8), l + Math.floor(next() * 8)];
      });
      const points = Array.from({ length: Math.floor(next() * 3) }, (): [number, number] => [Math.floor(next() * 20), Math.floor(next() * 26)]);
      // Reference: the bad-pixel set by a direct loop, applied through one rectangle per bad pixel.
      const reference: [number, number, number, number][] = [];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
        if (rects.some(([t, l, b, r]) => y >= t && y < b && x >= l && x < r)) reference.push([y, x, y + 1, x + 1]);
      const a = stage(width, height), b = stage(width, height);
      applyDngOpcodes(a, badPixels(rects, points), { stage: 1, fast: true });
      applyDngOpcodes(b, badPixels(reference, points), { stage: 1, fast: true });
      expect(Array.from(a.data)).toEqual(Array.from(b.data));
    }
  });

  it("applies at most 64 opcodes per list and reports the rest", () => {
    const identity = new BigEndianBytes().u32(1).f64(1).f64(0).f64(0).f64(0).f64(0).f64(0).f64(0.5).f64(0.5).bytes;
    const list = parseDngOpcodeList(Uint8Array.from(opcodeList(Array.from({ length: 65 }, () => ({ id: 1, params: identity })))));
    const image = stage(16, 12), notes = applyDngOpcodes(image, list, { stage: 3, fast: true });
    expect(notes.filter((n) => n.includes(" applied (")).length).toBe(64);
    expect(notes[64]).toBe("OpcodeList3 WarpRectilinear (1) not applied: the list holds more than 64 applied opcodes.");
    // Unsupported opcodes do not count toward the 64.
    const mixed = parseDngOpcodeList(Uint8Array.from(opcodeList([{ id: 2, params: [] }, ...Array.from({ length: 64 }, () => ({ id: 1, params: identity }))])));
    expect(applyDngOpcodes(stage(16, 12), mixed, { stage: 3, fast: true }).filter((n) => n.includes(" applied (")).length).toBe(64);
  });

  it("refuses huge vignette and warp coefficients in a file and keeps hand-built ones finite", () => {
    const vignette = new BigEndianBytes().f64(1e308).f64(1e308).f64(1e308).f64(1e308).f64(1e308).f64(0.5).f64(0.5).bytes;
    const warp = new BigEndianBytes().u32(1).f64(1e308).f64(1e308).f64(1e308).f64(1e308).f64(0).f64(0).f64(0.5).f64(0.5).bytes;
    for (const params of [{ id: 3, params: vignette }, { id: 1, params: warp }]) {
      const list = opcodeList([params]);
      expect(() => parseDngOpcodeList(Uint8Array.from(list))).toThrow(InvalidConfigurationError);
      const dng = parseDngRawImage({ bytes: smallDng(8, 8, [{ id: 51009, type: 7, values: list }]) });
      expect(dng.opcodeList2).toBeNull();
      expect(dng.assumptions.some((a) => a.startsWith("dngImport.ignored: OpcodeList2 is malformed"))).toBe(true);
      expect(developDngStageImage(dng).data.every(Number.isFinite)).toBe(true);
    }
    // Within the limit the list is applied as before.
    const sane = new BigEndianBytes().f64(-0.3).f64(0.1).f64(0).f64(0).f64(0).f64(0.5).f64(0.5).bytes;
    expect(parseDngOpcodeList(Uint8Array.from(opcodeList([{ id: 3, params: sane }])))[0]!.parameters).toMatchObject({ opcode: "FixVignetteRadial" });
    // applyDngOpcodes with hand-built parameters: NaN never reaches the image.
    const op = (parameters: DngOpcode["parameters"]): DngOpcode[] => [{ id: 0, name: "x", dngVersion: [1, 3, 0, 0], optional: false, previewSkip: false, parameters }];
    for (const parameters of [{ opcode: "FixVignetteRadial", coefficients: [1e308, 1e308, 1e308, 1e308, 1e308], centerX: 0.5, centerY: 0.5 },
      { opcode: "WarpRectilinear", planes: [{ radial: [1e308, 1e308, 1e308, 1e308], tangential: [0, 0] }], centerX: 0.5, centerY: 0.5 },
      { opcode: "WarpRectilinear", planes: [{ radial: [NaN, 0, 0, 0], tangential: [0, 0] }], centerX: 0.5, centerY: 0.5 }] as DngOpcode["parameters"][]) {
      for (const fast of [true, false]) {
        const image = stage(8, 8);
        applyDngOpcodes(image, op(parameters), { stage: 2, fast });
        expect(image.data.every(Number.isFinite)).toBe(true);
      }
    }
  });
});

describe("DNG import: strip tables, masks and tag counts (2.28.0)", () => {
  it("imports a file with 200,000 one-row strips", () => {
    const t = new Tiff(), row = t.blob(Uint8Array.of(0x34, 0x12)), n = 200_000;
    const bytes = t.finish(t.ifd([...cfaTags(1, n, [{ id: 278, type: 4, values: [1] }, ...strips(filled(n, row), filled(n, 2))]), DNG_VERSION]));
    const dng = parseDngRawImage({ bytes });
    expect(dng.codes.length).toBe(n);
    expect(dng.codes.every((v) => v === 0x1234)).toBe(true);
  });

  /** An 8 × 8 CFA DNG with `count` semantic masks of size × size 8-bit pixels whose one-row strips all alias one row. */
  function maskedDng(count: number, size: number): Uint8Array {
    const t = new Tiff(), row = t.blob(Uint8Array.from({ length: size }, (_, i) => i % 256));
    const data = t.blob(new Uint8Array(128));
    const masks = Array.from({ length: count }, (_, k) => t.ifd([{ id: 254, type: 4, values: [0x10004] }, { id: 256, type: 4, values: [size] }, { id: 257, type: 4, values: [size] },
      { id: 258, type: 3, values: [8] }, { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [52527] }, { id: 277, type: 3, values: [1] }, { id: 278, type: 4, values: [1] },
      ...strips(filled(size, row), filled(size, size)), { id: 52526, type: 2, values: ascii("Mask" + k) }]));
    return t.finish(t.ifd([...cfaTags(8, 8, [{ id: 278, type: 4, values: [8] }, ...strips([data], [128])]), DNG_VERSION, { id: 330, type: 4, values: masks }]));
  }

  it("counts semantic masks in maximumBytes", async () => {
    const bytes = maskedDng(8, 512);
    expect(() => parseDngRawImage({ bytes, maximumBytes: 1_048_576 })).toThrow(/maximumBytes/u);
    await expect(importDngRawImage({ bytes, maximumBytes: 1_048_576 })).rejects.toThrow(/maximumBytes/u);
    for (const dng of [parseDngRawImage({ bytes }), await importDngRawImage({ bytes })]) {
      expect(dng.semanticMasks.map((m) => m.name)).toEqual(Array.from({ length: 8 }, (_, k) => "Mask" + k));
      for (const m of dng.semanticMasks) {
        expect([m.width, m.height, m.data.length]).toEqual([512, 512, 512 * 512]);
        expect(m.data[512 * 7 + 300]).toBe(Math.fround(Math.min(1, (300 % 256) * (1 / 255))));
      }
    }
    // A file without masks keeps its estimate (8 × 8 codes and one strip: 512 bytes).
    expect(parseDngRawImage({ bytes: smallDng(8, 8), maximumBytes: 1024 }).codes.length).toBe(64);
  });

  it("checks the masks' memory from their layout, before reading their strip tables", async () => {
    // Masks whose strip offsets point past the end of the file: over maximumBytes the import refuses on memory without reading
    // a table (it used to build every mask's strip list first); within it the strips are refused as before.
    const t = new Tiff(), data = t.blob(new Uint8Array(128)), size = 4096;
    const masks = Array.from({ length: 4 }, (_, k) => t.ifd([{ id: 254, type: 4, values: [0x10004] }, { id: 256, type: 4, values: [1] }, { id: 257, type: 4, values: [size] },
      { id: 258, type: 3, values: [8] }, { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [52527] }, { id: 277, type: 3, values: [1] }, { id: 278, type: 4, values: [1] },
      ...strips(filled(size, 0x7fffffff), filled(size, 1)), { id: 52526, type: 2, values: ascii("Mask" + k) }]));
    const bytes = t.finish(t.ifd([...cfaTags(8, 8, [{ id: 278, type: 4, values: [8] }, ...strips([data], [128])]), DNG_VERSION, { id: 330, type: 4, values: masks }]));
    expect(() => parseDngRawImage({ bytes, maximumBytes: 16_384 })).toThrow(/maximumBytes/u);
    await expect(importDngRawImage({ bytes, maximumBytes: 16_384 })).rejects.toThrow(/maximumBytes/u);
    expect(() => parseDngRawImage({ bytes })).toThrow(/exceeds the file/u);
    // A table whose length does not match the mask's layout is still refused before any allocation.
    const u = new Tiff(), at = u.blob(new Uint8Array(128));
    const short = u.ifd([{ id: 254, type: 4, values: [0x10004] }, { id: 256, type: 4, values: [1] }, { id: 257, type: 4, values: [8] }, { id: 258, type: 3, values: [8] },
      { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [52527] }, { id: 277, type: 3, values: [1] }, { id: 278, type: 4, values: [1] }, ...strips(filled(7, at), filled(7, 1))]);
    const mismatched = u.finish(u.ifd([...cfaTags(8, 8, [{ id: 278, type: 4, values: [8] }, ...strips([at], [128])]), DNG_VERSION, { id: 330, type: 4, values: [short] }]));
    expect(() => parseDngRawImage({ bytes: mismatched })).toThrow(/do not match the image layout/u);
  });

  it("refuses a tag that must hold one value and holds none", () => {
    const zero = (id: number): Tag => ({ id, type: 3, values: [] });
    expect(() => parseDngRawImage({ bytes: smallDng(8, 8, [], [zero(274)]) })).toThrow(InvalidConfigurationError);
    expect(() => parseDngRawImage({ bytes: smallDng(8, 8, [], [zero(274)]) })).toThrow(/tag 274/u);
    expect(() => parseDngRawImage({ bytes: smallDng(8, 8, [], [zero(50778)]) })).toThrow(/tag 50778/u);
    const t = new Tiff(), at = t.blob(new Uint8Array(128));
    const noWidth = t.finish(t.ifd([...cfaTags(8, 8).filter((x) => x.id !== 256), { id: 256, type: 4, values: [] }, ...strips([at], [128]), DNG_VERSION]));
    expect(() => parseDngRawImage({ bytes: noWidth })).toThrow(/tag 256/u);
    expect(parseDngRawImage({ bytes: smallDng(8, 8, [], [{ id: 274, type: 3, values: [6] }]) }).orientation).toBe(6);
  });

  it("refuses a decoded JPEG XL tile PNG with a malformed or missing IHDR", async () => {
    const t = new Tiff(), at = t.blob(Uint8Array.of(0xff, 0x0a, 0, 0));
    const bytes = t.finish(t.ifd([...cfaTags(4, 4).map((x) => x.id === 259 ? { id: 259, type: 3, values: [52546] } : x), { id: 278, type: 4, values: [4] }, ...strips([at], [4]), DNG_VERSION]));
    const png = encodeTestPng({ width: 4, height: 4, channels: 1, depth: 16, samples: new Uint16Array(16) });
    const iend = png.length - 12, chunk = (type: string): number[] => [0, 0, 0, 0, ...[...type].map((c) => c.charCodeAt(0)), 0, 0, 0, 0];
    const late = Uint8Array.from([...png.subarray(0, iend), ...chunk("IHDR")]);
    const none = Uint8Array.from([...png.subarray(0, 8), ...chunk("tEXt"), ...png.subarray(33)]);
    await expect(importDngRawImage({ bytes, jpegXlDecoder: () => png })).resolves.toMatchObject({ width: 4, height: 4 });
    await expect(importDngRawImage({ bytes, jpegXlDecoder: () => late })).rejects.toThrow(InvalidConfigurationError);
    await expect(importDngRawImage({ bytes, jpegXlDecoder: () => none })).rejects.toThrow(/no IHDR/u);
    // A decoder's own exception is reported as a domain error that keeps it as its cause.
    const own = new Error("corrupt codestream");
    const failed = await importDngRawImage({ bytes, jpegXlDecoder: () => { throw own; } }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(InvalidConfigurationError);
    expect((failed as Error).message).toBe("DNG import: the JPEG XL decoder could not decode a strip or tile.");
    expect((failed as Error).cause).toBe(own);
    const rejected = await importDngRawImage({ bytes, jpegXlDecoder: () => Promise.reject(new RangeError("x")) }).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(InvalidConfigurationError);
  });
});

describe("serializeRewrittenDng: layout checks (2.28.0)", () => {
  it("refuses strip tables that do not match the image layout or that overlap", () => {
    const t = new Tiff(), block = t.blob(new Uint8Array(50_000)), n = 4000;
    const aliased = t.finish(t.ifd([...cfaTags(8, 8, [{ id: 278, type: 4, values: [8] }, ...strips(filled(n, block), filled(n, 50_000))]), DNG_VERSION]));
    expect(() => serializeRewrittenDng({ bytes: aliased })).toThrow(InvalidConfigurationError);
    const u = new Tiff(), data = u.blob(new Uint8Array(128));
    const overlapping = u.finish(u.ifd([...cfaTags(8, 8, [{ id: 278, type: 4, values: [4] }, ...strips([data, data + 32], [64, 64])]), DNG_VERSION]));
    expect(() => serializeRewrittenDng({ bytes: overlapping })).toThrow(/overlap/u);
    expect(() => parseDngRawImage({ bytes: overlapping })).not.toThrow();
  });

  it("refuses copied tag values that share bytes, before copying them", () => {
    // Every allow-listed camera tag of IFD 0 points at one 64 kB block: the rewrite would copy it once per tag.
    const t = new Tiff(), block = t.blob(new Uint8Array(65_536)), data = t.blob(new Uint8Array(128));
    const camera = [50721, 50722, 50723, 50724, 50725, 50726, 50938, 50939, 50940, 50982];
    const file = t.finish(t.ifd([...cfaTags(8, 8, [{ id: 278, type: 4, values: [8] }, ...strips([data], [128])]), DNG_VERSION]));
    const bytes = file.slice(), view = new DataView(bytes.buffer), ifd = view.getUint32(4, true), n = view.getUint16(ifd, true);
    // A new IFD 0 at the end of the file: the original entries plus the shared ones.
    const entries = Array.from({ length: n }, (_, i) => bytes.slice(ifd + 2 + i * 12, ifd + 14 + i * 12));
    const shared = camera.map((id) => { const e = new Uint8Array(12), v = new DataView(e.buffer); v.setUint16(0, id, true); v.setUint16(2, 7, true); v.setUint32(4, 65_536, true); v.setUint32(8, block, true); return e; });
    const all = [...entries, ...shared].sort((a, b) => new DataView(a.buffer).getUint16(0, true) - new DataView(b.buffer).getUint16(0, true));
    const grown = new Uint8Array(bytes.length + 2 + all.length * 12 + 4), g = new DataView(grown.buffer);
    grown.set(bytes); g.setUint32(4, bytes.length, true); g.setUint16(bytes.length, all.length, true);
    all.forEach((e, i) => grown.set(e, bytes.length + 2 + i * 12));
    expect(() => serializeRewrittenDng({ bytes: grown })).toThrow(/share bytes/u);
    // The same tags with their own bytes are written as before.
    const u = new Tiff(), at = u.blob(new Uint8Array(128));
    const distinct = u.finish(u.ifd([...cfaTags(8, 8, [{ id: 278, type: 4, values: [8] }, ...strips([at], [128])]), DNG_VERSION,
      ...camera.map((id) => ({ id, type: 7, bytes: new Uint8Array(4_096) }))]));
    expect(serializeRewrittenDng({ bytes: distinct }).writtenTags.ifd0).toEqual(expect.arrayContaining(camera));
  });

  it("still rewrites valid multi-strip and tiled files that read back with the same codes", () => {
    const codes = Uint16Array.from({ length: 16 * 12 }, (_, i) => 1000 + (i * 37) % 500), le = (values: ArrayLike<number>): Uint8Array => {
      const out = new Uint8Array(values.length * 2); for (let i = 0; i < values.length; i++) { out[2 * i] = values[i]! & 255; out[2 * i + 1] = values[i]! >> 8; } return out;
    };
    const t = new Tiff(), parts = [0, 1, 2].map((k) => t.blob(le(codes.subarray(k * 64, (k + 1) * 64))));
    const striped = t.finish(t.ifd([...cfaTags(16, 12, [{ id: 278, type: 4, values: [4] }, ...strips(parts, [128, 128, 128])]), DNG_VERSION]));
    const u = new Tiff(), tile = (tx: number, ty: number): Uint16Array => Uint16Array.from({ length: 64 }, (_, i) => codes[(ty * 8 + Math.floor(i / 8)) * 16 + tx * 8 + (i % 8)] ?? 0);
    const tiles = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => u.blob(le(tile(x!, y!))));
    const tiled = u.finish(u.ifd([...cfaTags(16, 12, [{ id: 322, type: 3, values: [8] }, { id: 323, type: 3, values: [8] }, { id: 324, type: 4, values: tiles }, { id: 325, type: 4, values: filled(4, 128) }]), DNG_VERSION]));
    for (const bytes of [striped, tiled]) {
      expect(Array.from(parseDngRawImage({ bytes }).codes)).toEqual(Array.from(codes));
      expect(Array.from(parseDngRawImage({ bytes: serializeRewrittenDng({ bytes }).bytes }).codes)).toEqual(Array.from(codes));
    }
  });

  it("refuses a header whose first IFD offset is 0, and every mutation gives a result or a domain error (fixed-seed fuzz)", () => {
    expect(() => serializeRewrittenDng({ bytes: Uint8Array.of(0x49, 0x49, 0x2a, 0, 0, 0, 0, 0) })).toThrow(InvalidConfigurationError);
    expect(() => parseDngRawImage({ bytes: Uint8Array.of(0x49, 0x49, 0x2a, 0, 0, 0, 0, 0) })).toThrow(InvalidConfigurationError);
    const valid = smallDng(16, 8, [], [{ id: 274, type: 3, values: [1] }]);
    let s = 0x2281;
    const next = (): number => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    let written = 0;
    for (let k = 0; k < 2000; k++) {
      const mutated = valid.slice();
      for (let e = 1 + Math.floor(next() * 4); e > 0; e--) mutated[Math.floor(next() * mutated.length)] = Math.floor(next() * 256);
      const cut = next() < 0.1 ? mutated.subarray(0, Math.floor(next() * mutated.length)) : mutated;
      try { serializeRewrittenDng({ bytes: cut }); written++; }
      catch (error) { expect(error).toBeInstanceOf(InvalidConfigurationError); }
    }
    expect(written).toBeGreaterThan(0);
  });
});

describe("estimateDngRawNoise: median selection (2.28.0)", () => {
  /** McIlroy's adversary for a median-of-three quickselect: the order of n distinct values that makes it quadratic. */
  function adversary(n: number, k: number): Int32Array {
    const gas = n, val = new Int32Array(n).fill(gas), p = Int32Array.from({ length: n }, (_, i) => i);
    let solid = 0, candidate = 0;
    const lt = (x: number, y: number): boolean => {
      if (val[x] === gas && val[y] === gas) { if (x === candidate) val[x] = solid++; else val[y] = solid++; }
      if (val[x] === gas) candidate = x; else if (val[y] === gas) candidate = y;
      return val[x]! < val[y]!;
    };
    let lo = 0, hi = n - 1;
    while (hi > lo) {
      const mid = (lo + hi) >> 1, x = p[lo]!, y = p[mid]!, z = p[hi]!;
      const pivot = lt(x, y) ? (lt(y, z) ? y : lt(x, z) ? z : x) : (lt(x, z) ? x : lt(y, z) ? z : y);
      let i = lo, j = hi;
      while (i <= j) { while (lt(p[i]!, pivot)) i++; while (lt(pivot, p[j]!)) j--; if (i <= j) { const t = p[i]!; p[i] = p[j]!; p[j] = t; i++; j--; } }
      if (k <= j) hi = j; else if (k >= i) lo = i; else break;
    }
    for (let i = 0; i < n; i++) if (val[i] === gas) val[i] = solid++;
    return val;
  }

  it("gives the exact median of an adversarially ordered plane in bounded work", () => {
    const W = 512, H = 512, n = 65_536, order = adversary(n, n >> 1);
    const file = (red: (k: number) => number): ReturnType<typeof parseDngRawImage> => {
      const t = new Tiff(), data = new Uint8Array(W * H * 2);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = y % 2 === 0 && x % 2 === 0 ? red((y / 2) * 256 + x / 2) : 1000, i = y * W + x;
        data[2 * i] = v & 255; data[2 * i + 1] = v >> 8;
      }
      const at = t.blob(data);
      return parseDngRawImage({ bytes: t.finish(t.ifd([...cfaTags(W, H, [{ id: 278, type: 4, values: [H] }, ...strips([at], [data.length])]), DNG_VERSION])) });
    };
    const raw = file((k) => order[k]!), shuffled = file((k) => (k * 40_503) % n);
    const timed = (r: typeof raw): [number, ReturnType<typeof estimateDngRawNoise>] => { const start = performance.now(), out = estimateDngRawNoise(r); return [performance.now() - start, out]; };
    timed(shuffled);
    const [plain] = timed(shuffled), [crafted, noise] = timed(raw);
    // Informational bound: the crafted order costs about as much as a plain one (it took over ten times as long before).
    expect(crafted).toBeLessThan(4 * plain + 30);
    // The red sites hold every code 0 … 65 535 once: the median is the mean of the two middle codes, normalized.
    const red = noise.planes[0]!;
    expect(red.medianSignal).toBeCloseTo((32_767.5) / 65_535, 12);
  }, scaledTimeout(60_000));
});
