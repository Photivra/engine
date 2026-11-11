// SPDX-License-Identifier: Apache-2.0

/**
 * Test-only encoders for the phone DNG import tests (#598, #600): a baseline (sequential DCT) JPEG encoder written from ITU-T T.81,
 * a minimal lossless JPEG XL encoder written from ISO/IEC 18181-1 (modular mode, one group, the zero predictor, prefix codes), and
 * DNG opcode-list and profile-tag byte writers from the DNG 1.7.1.0 specification. Never imported by `src/`.
 */

/** Little-endian-first bit writer (JPEG XL packs bits LSB first). */
class LsbBits {
  bytes: number[] = []; private acc = 0; private n = 0;
  put(value: number, count: number): void {
    for (let i = 0; i < count; i++) { this.acc |= ((Math.floor(value / 2 ** i)) & 1) << this.n; if (++this.n === 8) { this.bytes.push(this.acc); this.acc = 0; this.n = 0; } }
  }
  pad(): void { while (this.n) this.put(0, 1); }
  u32(value: number, d: readonly (readonly [number, number])[]): void {
    for (let s = 0; s < 4; s++) {
      const [bits, offset] = d[s]!;
      if (bits === 0 ? value === offset : value >= offset && value - offset < 2 ** bits) { this.put(s, 2); if (bits) this.put(value - offset, bits); return; }
    }
    throw new Error("U32 value out of range: " + value);
  }
}

/**
 * A lossless JPEG XL codestream (ISO/IEC 18181-1:2022): SizeHeader, ImageMetadata (integer samples of `bits` bits, no XYB,
 * grey or RGB with a linear transfer function and sRGB primaries/D65), one modular frame of one group (at most 256 × 256) with no
 * transforms, an MA tree of one leaf with the zero predictor, and residuals coded with a hybrid-uint configuration (split exponent
 * 4) and a 32-symbol prefix code of uniform length 5. Samples are interleaved (pixel, channel).
 */
export function encodeLosslessJxl(o: { width: number; height: number; channels: 1 | 3; bits: number; samples: ArrayLike<number> }): Uint8Array {
  if (o.width > 256 || o.height > 256) throw new Error("one group only");
  const w = new LsbBits(), size = [[9, 1], [13, 1], [18, 1], [30, 1]] as const, en = (v: number): void => w.u32(v, [[0, 0], [0, 1], [4, 2], [6, 18]]);
  w.put(0xff, 8); w.put(0x0a, 8);
  w.put(0, 1); w.u32(o.height, size); w.put(0, 3); w.u32(o.width, size);
  w.put(0, 1); w.put(0, 1); w.put(0, 1); w.u32(o.bits, [[0, 8], [0, 10], [0, 12], [6, 1]]);
  w.put(o.bits < 16 ? 1 : 0, 1); // modular_16bit_buffers
  w.u32(0, [[0, 0], [0, 1], [4, 2], [12, 1]]); w.put(0, 1); // no extra channels, xyb_encoded false
  w.put(0, 1); w.put(0, 1); en(o.channels === 1 ? 1 : 0); en(1); if (o.channels !== 1) en(1); w.put(0, 1); en(8); en(1);
  w.put(0, 2); w.put(1, 1); w.pad();
  // FrameHeader: regular, modular, no flags, no YCbCr, upsampling 1, group size 256, one pass, full frame, replace, last, no name,
  // restoration filters off (gab 0, epf 0).
  w.put(0, 1); w.put(0, 2); w.put(1, 2); w.put(0, 2); w.put(0, 1); w.put(0, 2); w.put(1, 2); w.put(0, 2); w.put(0, 1); w.put(0, 2); w.put(1, 1);
  w.put(0, 2); w.put(0, 1); w.put(0, 1); w.put(0, 2); w.put(0, 2); w.put(0, 2);
  const s = new LsbBits();
  s.put(1, 1); s.put(0, 1); s.put(0, 1); s.put(1, 1); s.put(0, 2); // LfChannelDequantization default; no global tree; GroupHeader
  s.put(0, 1); s.put(1, 1); s.put(0, 2); s.put(1, 1); s.put(4, 4); s.put(0, 3); s.put(0, 3); s.put(0, 1); // tree: one symbol
  s.put(0, 1); s.put(1, 1); s.put(4, 4); s.put(0, 3); s.put(0, 3); s.put(1, 1); s.put(4, 4); s.put(15, 4); // data: 32 symbols
  s.put(0, 2);
  for (const sym of [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15]) { if (sym === 5) s.put(7, 4); else s.put(0, 2); }
  const rev5 = (v: number): number => ((v & 1) << 4) | ((v & 2) << 2) | (v & 4) | ((v & 8) >> 2) | ((v & 16) >> 4);
  for (let c = 0; c < o.channels; c++) for (let i = 0; i < o.width * o.height; i++) {
    const v = 2 * o.samples[i * o.channels + c]!;
    if (v < 16) s.put(rev5(v), 5);
    else { const k = 31 - Math.clz32(v); s.put(rev5(16 + k - 4), 5); s.put(v - 2 ** k, k); }
  }
  s.pad();
  w.put(0, 1); w.pad(); w.u32(s.bytes.length, [[10, 0], [14, 1024], [22, 17408], [30, 4211712]]); w.pad();
  for (const b of s.bytes) w.put(b, 8);
  return Uint8Array.from(w.bytes);
}

/** A PNG (W3C PNG 3rd edition) of 8- or 16-bit grey or RGB samples, stored (uncompressed) deflate blocks, filter type 0. */
export function encodeTestPng(o: { width: number; height: number; channels: 1 | 3; depth: 8 | 16; samples: ArrayLike<number> }): Uint8Array {
  const raw: number[] = [];
  for (let y = 0; y < o.height; y++) {
    raw.push(0);
    for (let x = 0; x < o.width * o.channels; x++) { const v = o.samples[y * o.width * o.channels + x]!; if (o.depth === 16) raw.push(v >> 8, v & 255); else raw.push(v); }
  }
  const z: number[] = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const block = raw.slice(i, i + 65535), last = i + 65535 >= raw.length ? 1 : 0;
    z.push(last, block.length & 255, block.length >> 8, ~block.length & 255, (~block.length >> 8) & 255, ...block);
  }
  let a = 1, b = 0; for (const v of raw) { a = (a + v) % 65521; b = (b + a) % 65521; }
  z.push(b >> 8, b & 255, a >> 8, a & 255);
  const chunk = (type: string, data: number[]): number[] => {
    const body = [...type].map((c) => c.charCodeAt(0)).concat(data);
    let crc = ~0;
    for (const v of body) { crc ^= v; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    crc = ~crc >>> 0;
    const n = data.length;
    return [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255, ...body, crc >>> 24, (crc >> 16) & 255, (crc >> 8) & 255, crc & 255];
  };
  const be32 = (v: number): number[] => [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", [...be32(o.width), ...be32(o.height), o.depth, o.channels === 1 ? 0 : 2, 0, 0, 0]), ...chunk("IDAT", z), ...chunk("IEND", [])]);
}

/** MSB-first bit writer with JPEG 0xFF00 stuffing. */
class JpegBits {
  bytes: number[] = []; private acc = 0; private n = 0;
  put(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) { this.acc = (this.acc << 1) | ((value >> i) & 1); if (++this.n === 8) { this.bytes.push(this.acc); if (this.acc === 0xff) this.bytes.push(0); this.acc = 0; this.n = 0; } }
  }
  flush(): void { while (this.n) this.put(1, 1); }
}

export interface BaselineJpegOptions {
  width: number; height: number;
  /** Per component: identifier and sampling factors. Samples are interleaved per pixel and coded as given (no colour transform). */
  components: { id: number; h: number; v: number }[];
  samples: ArrayLike<number>;
  /** Uniform quantization step (1 keeps the round trip within about one code). */
  step: number;
  restartInterval?: number;
  /** Segments to add after SOI (for example JFIF or Adobe APP14). */
  app?: number[][];
  /** Return the tables (DQT, DHT) as a separate abbreviated stream, as DNG JPEGTables. */
  separateTables?: boolean;
  /** One scan per component (non-interleaved) instead of one interleaved scan. */
  scanPerComponent?: boolean;
}

/**
 * A baseline JPEG (T.81 SOF0, Huffman) with a directly computed forward DCT (A.3.3), a uniform quantization step and uniform
 * Huffman codes: DC categories 0–11 as 4-bit codes, the 162 AC (run, size) symbols as 8-bit codes.
 */
export function encodeBaselineJpeg(o: BaselineJpegOptions): { jpeg: Uint8Array; tables?: Uint8Array } {
  const nf = o.components.length, hMax = Math.max(...o.components.map((c) => c.h)), vMax = Math.max(...o.components.map((c) => c.v));
  const mcusWide = Math.ceil(o.width / (8 * hMax)), mcusHigh = Math.ceil(o.height / (8 * vMax));
  const seg = (marker: number, body: number[]): number[] => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  const acSymbols = [0x00, 0xf0]; for (let r = 0; r < 16; r++) for (let s = 1; s <= 10; s++) acSymbols.push(r * 16 + s);
  const counts = (n: number, len: number): number[] => Array.from({ length: 16 }, (_, i) => i === len - 1 ? n : 0);
  const dqt = seg(0xdb, [0, ...Array<number>(64).fill(o.step)]);
  const dht = seg(0xc4, [0x00, ...counts(12, 4), ...Array.from({ length: 12 }, (_, i) => i), 0x10, ...counts(162, 8), ...acSymbols]);
  const acCode = new Map(acSymbols.map((s, i) => [s, i]));
  // Component planes, edge-replicated to whole MCUs (each component's own subsampled grid: block averages of the full image).
  const planes = o.components.map((c, ci) => {
    const pw = mcusWide * c.h * 8, ph = mcusHigh * c.v * 8, fx = hMax / c.h, fy = vMax / c.v, plane = new Float64Array(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      let sum = 0, n = 0;
      for (let dy = 0; dy < fy; dy++) for (let dx = 0; dx < fx; dx++) {
        const sx = Math.min(x * fx + dx, o.width - 1), sy = Math.min(y * fy + dy, o.height - 1);
        sum += o.samples[(sy * o.width + sx) * nf + ci]!; n++;
      }
      plane[y * pw + x] = sum / n;
    }
    return { plane, pw };
  });
  const zig: number[] = [];
  for (let d = 0; d <= 14; d++) { const p: number[] = []; for (let y = 0; y < 8; y++) { const x = d - y; if (x >= 0 && x < 8) p.push(y * 8 + x); } zig.push(...(d % 2 === 0 ? p.reverse() : p)); }
  const cat = (v: number): number => v === 0 ? 0 : 32 - Math.clz32(Math.abs(v));
  const scanBits = (list: number[]): number[] => {
    const bits = new JpegBits(), prev = new Array<number>(nf).fill(0);
    const single = list.length === 1 ? o.components[list[0]!]! : undefined;
    const uw = single ? Math.ceil(Math.ceil(o.width * single.h / hMax) / 8) : mcusWide, uh = single ? Math.ceil(Math.ceil(o.height * single.v / vMax) / 8) : mcusHigh;
    const block = (ci: number, bx: number, by: number): void => {
      const { plane, pw } = planes[ci]!, coef = new Array<number>(64);
      for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
        let sum = 0;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += (plane[(by * 8 + y) * pw + bx * 8 + x]! - 128) * Math.cos((2 * x + 1) * u * Math.PI / 16) * Math.cos((2 * y + 1) * v * Math.PI / 16);
        coef[v * 8 + u] = Math.round(sum / 4 * (u ? 1 : Math.SQRT1_2) * (v ? 1 : Math.SQRT1_2) / o.step);
      }
      const diff = coef[0]! - prev[ci]!; prev[ci] = coef[0]!;
      const dc = cat(diff); bits.put(dc, 4); if (dc) bits.put(diff >= 0 ? diff : diff + (1 << dc) - 1, dc);
      let run = 0;
      for (let k = 1; k < 64; k++) {
        const v = coef[zig[k]!]!;
        if (v === 0) { run++; continue; }
        while (run > 15) { bits.put(acCode.get(0xf0)!, 8); run -= 16; }
        const s = cat(v); bits.put(acCode.get(run * 16 + s)!, 8); bits.put(v >= 0 ? v : v + (1 << s) - 1, s); run = 0;
      }
      if (run) bits.put(acCode.get(0)!, 8);
    };
    const out: number[] = [];
    for (let m = 0, r = 0; m < uw * uh; m++) {
      if (o.restartInterval && m > 0 && m % o.restartInterval === 0) { bits.flush(); out.push(...bits.bytes, 0xff, 0xd0 | (r++ & 7)); bits.bytes = []; prev.fill(0); }
      const mx = m % uw, my = Math.floor(m / uw);
      if (single) block(list[0]!, mx, my);
      else for (const ci of list) { const c = o.components[ci]!; for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(ci, mx * c.h + h, my * c.v + v); }
    }
    bits.flush(); out.push(...bits.bytes);
    return out;
  };
  const sof = seg(0xc0, [8, o.height >> 8, o.height & 255, o.width >> 8, o.width & 255, nf, ...o.components.flatMap((c) => [c.id, c.h * 16 + c.v, 0])]);
  const sos = (list: number[]): number[] => seg(0xda, [list.length, ...list.flatMap((ci) => [o.components[ci]!.id, 0x00]), 0, 63, 0]);
  const scans = o.scanPerComponent ? o.components.map((_, i) => [i]) : [o.components.map((_, i) => i)];
  const body = [...sof, ...(o.restartInterval ? seg(0xdd, [o.restartInterval >> 8, o.restartInterval & 255]) : []), ...scans.flatMap((l) => [...sos(l), ...scanBits(l)])];
  const head = [0xff, 0xd8, ...(o.app ?? []).flat()];
  if (o.separateTables) return { jpeg: Uint8Array.from([...head, ...body, 0xff, 0xd9]), tables: Uint8Array.from([0xff, 0xd8, ...dqt, ...dht, 0xff, 0xd9]) };
  return { jpeg: Uint8Array.from([...head, ...dqt, ...dht, ...body, 0xff, 0xd9]) };
}

/** Big-endian byte writer for DNG opcode lists and profile tags (both are big-endian whatever the file's byte order). */
export class BigEndianBytes {
  bytes: number[] = [];
  u8(v: number): this { this.bytes.push(v & 255); return this; }
  u16(v: number): this { this.bytes.push((v >> 8) & 255, v & 255); return this; }
  u32(v: number): this { this.bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; }
  f32(v: number): this { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v); this.bytes.push(...new Uint8Array(d.buffer)); return this; }
  f64(v: number): this { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v); this.bytes.push(...new Uint8Array(d.buffer)); return this; }
  raw(b: ArrayLike<number>): this { for (let i = 0; i < b.length; i++) this.bytes.push(b[i]!); return this; }
}

/** One opcode: id, flags (bit 0 optional, bit 1 preview skip) and its parameter bytes. */
export interface OpcodeSpec { id: number; flags?: number; params: number[] }
/** DNG opcode list: count, then per opcode id, DNG version 1.3.0.0, flags, parameter byte count, parameters. */
export function opcodeList(ops: OpcodeSpec[]): number[] {
  const w = new BigEndianBytes().u32(ops.length);
  for (const op of ops) w.u32(op.id).u8(1).u8(3).u8(0).u8(0).u32(op.flags ?? 0).u32(op.params.length).raw(op.params);
  return w.bytes;
}
/** The area header shared by MapTable, MapPolynomial, GainMap and the per-row/column opcodes. */
export function areaSpec(w: BigEndianBytes, a: { top: number; left: number; bottom: number; right: number; plane?: number; planes?: number; rowPitch?: number; colPitch?: number }): BigEndianBytes {
  return w.u32(a.top).u32(a.left).u32(a.bottom).u32(a.right).u32(a.plane ?? 0).u32(a.planes ?? 1).u32(a.rowPitch ?? 1).u32(a.colPitch ?? 1);
}
