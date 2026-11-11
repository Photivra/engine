// SPDX-License-Identifier: Apache-2.0

/**
 * Size-limited decoder for 8-bit sequential DCT JPEG (ITU-T T.81 | ISO/IEC 10918-1, processes 1 and 2: SOF0 baseline and SOF1
 * extended sequential with Huffman coding), the variant DNG uses for Compression = 34892 ("lossy JPEG", DNG 1.4.0.0) strips and
 * tiles. Written independently from the published standard, with no third-party decoder source. Browser-safe: plain typed arrays.
 *
 * Decoding follows T.81 Annex F (Huffman decoding F.2.2, DC prediction, run-length AC decoding, restart intervals F.2.2.5) and the
 * inverse DCT of A.3.3, evaluated directly in double precision with the correctly rounded cosine table `JPEG_DCT_COSINES`, then
 * rounded half away from zero, level-shifted by 128 and clamped to 0..255 (A.3.1). DCT decoders may differ by one code from each
 * other (T.81 leaves the IDCT accuracy to ITU-T T.83 compliance limits); this one is deterministic.
 *
 * Subsampled components are interpolated linearly to full size with centred sample siting (T.871, JFIF: chroma samples sit at the
 * centre of the luma samples they cover), so a 2:1 factor uses the weights 3/4 and 1/4. Three-component data is converted from
 * YCbCr to RGB with the T.871 equations unless the stream says it is RGB: an APP14 "Adobe" segment with transform 0, or, without
 * JFIF or APP14 segments, component identifiers "R", "G", "B" (the conventions ITU-T T.872 describes). Four components are
 * returned as stored.
 *
 * Supported: precision 8, 1..4 components with sampling factors 1..4, interleaved and non-interleaved sequential scans, DRI restart
 * intervals, 8- and 16-bit quantization tables, tables defined in a separate abbreviated stream (DNG JPEGTables). Rejected:
 * progressive, hierarchical, lossless and arithmetic-coded frames, 12-bit precision, truncated data.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { JPEG_DCT_COSINES } from "./export-jpeg.js";

/** Decoded samples, interleaved by component within each line (line, x, component), 0..255. */
export interface LossyJpegImage {
  width: number;
  height: number;
  components: number;
  /** "ycbcr-to-rgb" when three YCbCr components were converted to RGB; "none" otherwise. */
  colorTransform: "ycbcr-to-rgb" | "none";
  samples: Uint8Array;
}
export interface LossyJpegLimits {
  /** Largest width x height x components accepted, checked before any sample buffer is allocated. */
  maximumSamples: number;
  /** An abbreviated table-specification stream (SOI, DQT/DHT, EOI) read before `bytes`, as DNG's JPEGTables tag (347) supplies. */
  tables?: Uint8Array;
}

interface Huffman { maxCode: Int32Array; valPtr: Int32Array; minCode: Int32Array; values: Uint8Array }
interface Component { id: number; h: number; v: number; tq: number; blocksWide: number; blocksHigh: number; plane: Uint8Array; previousDc: number; dc?: Huffman | undefined; ac?: Huffman | undefined }
function fail(message: string): never { throw new InvalidConfigurationError("Lossy JPEG: " + message); }

const ZIGZAG = /* @__PURE__ */ ((): Int32Array => {
  const z = new Int32Array(64);
  for (let d = 0, i = 0; d <= 14; d++) {
    const points: number[] = [];
    for (let y = 0; y < 8; y++) { const x = d - y; if (x >= 0 && x < 8) points.push(y * 8 + x); }
    for (const p of d % 2 === 0 ? points.reverse() : points) z[i++] = p;
  }
  return z;
})();

/** T.81 Annex C code generation and F.2.2.3 decoder tables. */
function buildHuffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const maxCode = new Int32Array(18).fill(-1), minCode = new Int32Array(17), valPtr = new Int32Array(17);
  let code = 0, k = 0;
  for (let length = 1; length <= 16; length++) {
    const n = counts[length - 1]!;
    if (n) { valPtr[length] = k; minCode[length] = code; code += n; k += n; maxCode[length] = code - 1; }
    if (code > (1 << length)) fail("over-subscribed Huffman table.");
    code <<= 1;
  }
  maxCode[17] = 0x7fffffff;
  return { maxCode, minCode, valPtr, values };
}

/** Decodes one DCT JPEG stream (see the module notes). Every length, count and table index is checked against the buffer. */
export function parseLossyJpeg(bytes: Uint8Array, limits: LossyJpegLimits): LossyJpegImage {
  if (!(bytes instanceof Uint8Array)) fail("input must be a Uint8Array.");
  if (limits === null || typeof limits !== "object" || !Number.isSafeInteger(limits.maximumSamples) || limits.maximumSamples < 1) fail("invalid sample limit.");
  if (limits.tables !== undefined && !(limits.tables instanceof Uint8Array)) fail("tables must be a Uint8Array.");
  const quant: (Float64Array | undefined)[] = [], dcTables: (Huffman | undefined)[] = [], acTables: (Huffman | undefined)[] = [];
  const state = { restart: 0, jfif: false, adobe: -1 };
  let scanned = false;
  let frame: { width: number; height: number; components: Component[]; hMax: number; vMax: number; mcusWide: number; mcusHigh: number } | undefined;

  const segments = (data: Uint8Array, tablesOnly: boolean): void => {
    const n = data.length;
    if (n < 4 || data[0] !== 0xff || data[1] !== 0xd8) fail("missing SOI marker.");
    let p = 2;
    for (;;) {
      while (p < n && data[p] === 0xff && data[p + 1] === 0xff) p++;
      if (p + 2 > n || data[p] !== 0xff) fail("malformed marker segment.");
      const marker = data[p + 1]!;
      if (marker === 0xd9) { if (tablesOnly || scanned) return; fail("no scan before EOI."); }
      if (p + 4 > n) fail("malformed marker segment.");
      const size = data[p + 2]! * 256 + data[p + 3]!, start = p + 4, end = p + 2 + size;
      if (size < 2 || end > n) fail("segment exceeds the stream.");
      if (marker === 0xdb) {
        for (let q = start; q < end;) {
          const pq = data[q]! >> 4, tq = data[q]! & 15, len = pq ? 128 : 64;
          if (pq > 1 || tq > 3 || q + 1 + len > end) fail("invalid quantization table.");
          const table = new Float64Array(64);
          for (let i = 0; i < 64; i++) {
            const v = pq ? data[q + 1 + i * 2]! * 256 + data[q + 2 + i * 2]! : data[q + 1 + i]!;
            if (v === 0) fail("zero quantization value.");
            table[ZIGZAG[i]!] = v;
          }
          quant[tq] = table; q += 1 + len;
        }
      } else if (marker === 0xc4) {
        for (let q = start; q < end;) {
          const tc = data[q]! >> 4, th = data[q]! & 15;
          if (tc > 1 || th > 3 || q + 17 > end) fail("invalid Huffman table.");
          const counts = data.subarray(q + 1, q + 17);
          let total = 0; for (const c of counts) total += c;
          if (total > 256 || q + 17 + total > end) fail("Huffman table exceeds its segment.");
          (tc ? acTables : dcTables)[th] = buildHuffman(counts, data.slice(q + 17, q + 17 + total));
          q += 17 + total;
        }
      } else if (marker === 0xdd) {
        if (size !== 4) fail("invalid restart interval.");
        state.restart = data[start]! * 256 + data[start + 1]!;
      } else if (marker === 0xe0) {
        if (size >= 7 && data[start] === 0x4a && data[start + 1] === 0x46 && data[start + 2] === 0x49 && data[start + 3] === 0x46 && data[start + 4] === 0) state.jfif = true;
      } else if (marker === 0xee) {
        if (size >= 14 && String.fromCharCode(...data.subarray(start, start + 5)) === "Adobe") state.adobe = data[start + 11]!;
      } else if (marker === 0xc0 || marker === 0xc1) {
        if (tablesOnly || frame) fail("unexpected frame header.");
        if (size < 8) fail("unsupported frame header.");
        const precision = data[start]!, height = data[start + 1]! * 256 + data[start + 2]!, width = data[start + 3]! * 256 + data[start + 4]!, nf = data[start + 5]!;
        if (precision !== 8) fail("only 8-bit precision is supported.");
        if (height < 1 || width < 1 || nf < 1 || nf > 4 || size !== 8 + 3 * nf) fail("unsupported frame header.");
        if (width * height * nf > limits.maximumSamples) fail("frame exceeds the sample limit.");
        const raw: { id: number; h: number; v: number; tq: number }[] = [];
        for (let i = 0; i < nf; i++) {
          const o = start + 6 + i * 3, h = data[o + 1]! >> 4, v = data[o + 1]! & 15, tq = data[o + 2]!;
          if (h < 1 || h > 4 || v < 1 || v > 4 || tq > 3) fail("invalid component sampling or table.");
          if (raw.some((c) => c.id === data[o])) fail("duplicate component identifier.");
          raw.push({ id: data[o]!, h, v, tq });
        }
        const hMax = Math.max(...raw.map((c) => c.h)), vMax = Math.max(...raw.map((c) => c.v));
        const mcusWide = Math.ceil(width / (8 * hMax)), mcusHigh = Math.ceil(height / (8 * vMax));
        const components = raw.map((c) => {
          const blocksWide = mcusWide * c.h, blocksHigh = mcusHigh * c.v;
          return { ...c, blocksWide, blocksHigh, plane: new Uint8Array(blocksWide * blocksHigh * 64), previousDc: 0 };
        });
        frame = { width, height, components, hMax, vMax, mcusWide, mcusHigh };
      } else if (marker === 0xda) {
        if (tablesOnly || !frame) fail("scan before frame header.");
        const ns = data[start]!;
        if (ns < 1 || ns > 4 || size !== 6 + 2 * ns) fail("invalid scan header.");
        const scan: Component[] = [];
        for (let i = 0; i < ns; i++) {
          const c = frame.components.find((x) => x.id === data[start + 1 + i * 2]);
          if (!c || scan.includes(c)) fail("scan references an unknown component.");
          const td = data[start + 2 + i * 2]! >> 4, ta = data[start + 2 + i * 2]! & 15;
          c.dc = dcTables[td]; c.ac = acTables[ta];
          if (!c.dc || !c.ac) fail("scan references an undefined Huffman table.");
          if (!quant[c.tq]) fail("component references an undefined quantization table.");
          scan.push(c);
        }
        const ss = data[start + 1 + 2 * ns]!, se = data[start + 2 + 2 * ns]!, a = data[start + 3 + 2 * ns]!;
        if (ss !== 0 || se !== 63 || a !== 0) fail("only sequential scans are supported.");
        if (scan.reduce((s, c) => s + (ns === 1 ? 1 : c.h * c.v), 0) > 10) fail("too many blocks per MCU.");
        // Further scans may follow (non-interleaved sequential); EOI ends the image.
        p = decodeScan(data, end, frame, scan, quant, state.restart);
        scanned = true;
        continue;
      } else if ((marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) || marker === 0xde) {
        fail("only sequential Huffman DCT frames (SOF0, SOF1) are supported.");
      } else if (marker === 0xcc) {
        fail("arithmetic coding is not supported.");
      } else if (marker < 0xc0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        fail("unexpected marker.");
      }
      p = end;
    }
  };
  if (limits.tables) segments(limits.tables, true);
  segments(bytes, false);
  if (!frame) fail("no image.");
  if (frame.components.some((c) => !c.dc)) fail("a component has no scan.");
  return assemble(frame, state);
}

function decodeScan(data: Uint8Array, start: number, frame: { width: number; height: number; hMax: number; vMax: number; mcusWide: number; mcusHigh: number },
  scan: Component[], quant: (Float64Array | undefined)[], restartInterval: number): number {
  let p = start, buffer = 0, bits = 0, padding = 0, marker = -1;
  const fill = (): void => {
    let byte = 0;
    if (marker < 0 && p < data.length && data[p] !== 0xff) byte = data[p++]!;
    else if (marker < 0 && p + 1 < data.length && data[p] === 0xff && data[p + 1] === 0x00) { byte = 0xff; p += 2; }
    else {
      if (marker < 0 && p + 1 < data.length) marker = data[p + 1]!;
      if (++padding > 8) fail("entropy-coded data is truncated.");
    }
    buffer = ((buffer << 8) | byte) >>> 0; bits += 8;
  };
  const readBits = (count: number): number => {
    if (count === 0) return 0;
    while (bits < count) fill();
    bits -= count;
    return (buffer >>> bits) & ((1 << count) - 1);
  };
  const decode = (t: Huffman): number => {
    let code = readBits(1), len = 1;
    while (code > t.maxCode[len]!) {
      if (++len > 16) fail("invalid Huffman code.");
      code = (code << 1) | readBits(1);
    }
    const v = t.values[t.valPtr[len]! + code - t.minCode[len]!];
    if (v === undefined) fail("invalid Huffman code.");
    return v;
  };
  const extend = (v: number, s: number): number => v < (1 << (s - 1)) ? v - (1 << s) + 1 : v;
  const coefficients = new Float64Array(64), rows = new Float64Array(64), cos = JPEG_DCT_COSINES;
  const block = (c: Component, bx: number, by: number): void => {
    coefficients.fill(0);
    const t = decode(c.dc!);
    if (t > 11) fail("invalid DC difference category.");
    c.previousDc += t ? extend(readBits(t), t) : 0;
    const q = quant[c.tq]!;
    coefficients[0] = c.previousDc * q[0]!;
    for (let k = 1; k < 64;) {
      const rs = decode(c.ac!), r = rs >> 4, s = rs & 15;
      if (s === 0) { if (r === 15) { k += 16; continue; } break; }
      k += r;
      if (k > 63 || s > 10) fail("invalid AC coefficient.");
      const z = ZIGZAG[k]!;
      coefficients[z] = extend(readBits(s), s) * q[z]!;
      k++;
    }
    // A.3.3: s(y,x) = 1/4 Σ_u Σ_v C(u)C(v) S(v,u) cos((2x+1)uπ/16) cos((2y+1)vπ/16), rows (u) first, then columns (v).
    for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) sum += (u === 0 ? Math.SQRT1_2 : 1) * coefficients[v * 8 + u]! * cos[u * 8 + x]!;
      rows[v * 8 + x] = sum;
    }
    const stride = c.blocksWide * 8, base = by * 8 * stride + bx * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) sum += (v === 0 ? Math.SQRT1_2 : 1) * rows[v * 8 + x]! * cos[v * 8 + y]!;
      const value = sum / 4, rounded = value < 0 ? -Math.round(-value) : Math.round(value);
      c.plane[base + y * stride + x] = Math.min(255, Math.max(0, rounded + 128));
    }
  };
  for (const c of scan) c.previousDc = 0;
  // A single-component scan is non-interleaved: one block per MCU over the component's own (unpadded-to-MCU) block grid.
  const single = scan.length === 1 ? scan[0]! : undefined;
  const unitsWide = single ? Math.ceil(Math.ceil(frame.width * single.h / frame.hMax) / 8) : frame.mcusWide;
  const unitsHigh = single ? Math.ceil(Math.ceil(frame.height * single.v / frame.vMax) / 8) : frame.mcusHigh;
  const total = unitsWide * unitsHigh;
  for (let m = 0, restarts = 0; m < total; m++) {
    if (restartInterval && m > 0 && m % restartInterval === 0) {
      bits = 0; buffer = 0; padding = 0; marker = -1;
      if (p + 1 >= data.length || data[p] !== 0xff || data[p + 1] !== (0xd0 | (restarts & 7))) fail("missing restart marker.");
      p += 2; restarts++;
      for (const c of scan) c.previousDc = 0;
    }
    const mx = m % unitsWide, my = Math.floor(m / unitsWide);
    if (single) block(single, mx, my);
    else for (const c of scan) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(c, mx * c.h + h, my * c.v + v);
  }
  // Skip to the next marker: remaining fill bits are discarded (T.81 F.1.2.3 pads with 1-bits).
  while (p < data.length && !(data[p] === 0xff && data[p + 1] !== 0x00 && !(data[p + 1]! >= 0xd0 && data[p + 1]! <= 0xd7))) p++;
  if (p + 1 >= data.length) fail("missing EOI marker.");
  return p;
}

function assemble(frame: { width: number; height: number; components: Component[]; hMax: number; vMax: number }, state: { jfif: boolean; adobe: number }): LossyJpegImage {
  const { width, height, components, hMax, vMax } = frame, nf = components.length, out = new Uint8Array(width * height * nf);
  components.forEach((c, ci) => {
    const stride = c.blocksWide * 8, cw = Math.ceil(width * c.h / hMax), ch = Math.ceil(height * c.v / vMax);
    if (c.h === hMax && c.v === vMax) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[(y * width + x) * nf + ci] = c.plane[y * stride + x]!;
      return;
    }
    // Centred linear interpolation: output sample x covers component position (x + 0.5)·h/hMax − 0.5, clamped to the samples.
    const sx = c.h / hMax, sy = c.v / vMax;
    for (let y = 0; y < height; y++) {
      const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), ch - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, ch - 1), wy = fy - y0;
      for (let x = 0; x < width; x++) {
        const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), cw - 1), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, cw - 1), wx = fx - x0;
        const a = c.plane[y0 * stride + x0]!, b = c.plane[y0 * stride + x1]!, d = c.plane[y1 * stride + x0]!, e = c.plane[y1 * stride + x1]!;
        out[(y * width + x) * nf + ci] = Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy);
      }
    }
  });
  const ids = components.map((c) => c.id), rgbIds = ids[0] === 0x52 && ids[1] === 0x47 && ids[2] === 0x42;
  const ycc = nf === 3 && (state.adobe >= 0 ? state.adobe !== 0 : state.jfif || !rgbIds);
  if (ycc) for (let i = 0; i < out.length; i += 3) {
    // T.871 §7: R = Y + 1.402 (Cr − 128), G = Y − 0.344136 (Cb − 128) − 0.714136 (Cr − 128), B = Y + 1.772 (Cb − 128).
    const y = out[i]!, cb = out[i + 1]! - 128, cr = out[i + 2]! - 128;
    out[i] = clamp8(y + 1.402 * cr); out[i + 1] = clamp8(y - 0.344136 * cb - 0.714136 * cr); out[i + 2] = clamp8(y + 1.772 * cb);
  }
  return { width, height, components: nf, colorTransform: ycc ? "ycbcr-to-rgb" : "none", samples: out };
}
function clamp8(v: number): number { return Math.min(255, Math.max(0, Math.round(v))); }
