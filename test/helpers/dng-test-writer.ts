// SPDX-License-Identifier: Apache-2.0

/**
 * Test-only synthetic DNG/TIFF-EP and lossless JPEG writers for the DNG import tests. Written directly from
 * TIFF 6.0, the DNG 1.7.1.0 specification and ITU-T T.81 Annex H; never imported by `src/`.
 */

export interface TagSpec { id: number; type: number; values: readonly number[] }
export interface IfdSpec {
  tags: TagSpec[];
  /** Strip or tile payloads; offsets/counts are written to `offsetTag`/`countTag` (273/279 or 324/325). */
  chunks?: { offsetTag: number; countTag: number; data: Uint8Array[] };
  subIfds?: IfdSpec[];
  /** 2.24.0: an Exif IFD, written as its own directory and pointed to by tag 34665. */
  exifIfd?: IfdSpec;
}
const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

/** Rational encoding helper: values are [numerator, denominator, ...] pairs. */
export function rationalPairs(values: readonly number[], denominator = 10000): number[] {
  return values.flatMap((v) => [Math.round(v * denominator), denominator]);
}

/** Serialize IFD0 (and an optional chain) with nested SubIFDs. Value arrays for type 5/10 are num/den pairs. */
export function writeTiff(little: boolean, chain: IfdSpec[]): Uint8Array {
  const out: number[] = [];
  const put16 = (o: number, v: number): void => { if (little) { out[o] = v & 255; out[o + 1] = v >>> 8 & 255; } else { out[o] = v >>> 8 & 255; out[o + 1] = v & 255; } };
  const put32 = (o: number, v: number): void => { for (let i = 0; i < 4; i++) out[o + (little ? i : 3 - i)] = (v >>> (8 * i)) & 255; };
  const align = (): void => { while (out.length % 4) out.push(0); };
  out.push(...(little ? [73, 73, 42, 0] : [77, 77, 0, 42]), 0, 0, 0, 0);
  const value = (type: number, values: readonly number[]): number[] => {
    const bytes: number[] = [];
    const push = (v: number, size: number): void => { for (let i = 0; i < size; i++) bytes.push(little ? (v >>> (8 * i)) & 255 : (v >>> (8 * (size - 1 - i))) & 255); };
    const size = SIZES[type]!, n = type === 5 || type === 10 ? 4 : size;
    if (type === 11 || type === 12) {
      // FLOAT and DOUBLE: IEEE 754 in the file byte order.
      for (const v of values) {
        const view = new DataView(new ArrayBuffer(size));
        if (type === 11) view.setFloat32(0, v, little); else view.setFloat64(0, v, little);
        for (let i = 0; i < size; i++) bytes.push(view.getUint8(i));
      }
      return bytes;
    }
    for (const v of values) push(v | 0, n);
    return bytes;
  };
  const writeIfd = (spec: IfdSpec): number => {
    const subOffsets = (spec.subIfds ?? []).map((s) => writeIfd(s));
    const exifOffset = spec.exifIfd ? writeIfd(spec.exifIfd) : -1;
    const chunkOffsets = (spec.chunks?.data ?? []).map((d) => { align(); const at = out.length; out.push(...d); return at; });
    const tags = [...spec.tags];
    if (spec.chunks) tags.push({ id: spec.chunks.offsetTag, type: 4, values: chunkOffsets }, { id: spec.chunks.countTag, type: 4, values: spec.chunks.data.map((d) => d.length) });
    if (subOffsets.length) tags.push({ id: 330, type: 4, values: subOffsets });
    if (exifOffset >= 0) tags.push({ id: 34665, type: 4, values: [exifOffset] });
    tags.sort((a, b) => a.id - b.id);
    const payloads = tags.map((t) => value(t.type, t.values));
    const external = payloads.map((p) => { if (p.length <= 4) return -1; align(); const at = out.length; out.push(...p); return at; });
    align();
    const at = out.length;
    out.push(...Array<number>(2 + tags.length * 12 + 4).fill(0));
    put16(at, tags.length);
    tags.forEach((t, i) => {
      const p = at + 2 + i * 12, count = t.type === 5 || t.type === 10 ? t.values.length / 2 : t.values.length;
      put16(p, t.id); put16(p + 2, t.type); put32(p + 4, count);
      if (external[i]! >= 0) put32(p + 8, external[i]!); else payloads[i]!.forEach((b, k) => { out[p + 8 + k] = b; });
    });
    return at;
  };
  const offsets = chain.map((spec) => writeIfd(spec));
  put32(4, offsets[0]!);
  // Link the main chain: next-IFD pointer follows each directory's entries.
  offsets.forEach((o, i) => {
    const count = little ? out[o]! | out[o + 1]! << 8 : out[o]! << 8 | out[o + 1]!;
    put32(o + 2 + count * 12, offsets[i + 1] ?? 0);
  });
  return Uint8Array.from(out);
}

/** Pack row-major samples MSB-first at `bits` per sample with byte-aligned rows (DNG BitsPerSample rule). */
export function packBits(samples: ArrayLike<number>, rowSamples: number, bits: number, little: boolean): Uint8Array {
  const rows = samples.length / rowSamples, rowBytes = Math.ceil(rowSamples * bits / 8), out = new Uint8Array(rowBytes * rows);
  for (let y = 0; y < rows; y++) for (let i = 0; i < rowSamples; i++) {
    const v = samples[y * rowSamples + i]!;
    if (bits === 8) out[y * rowBytes + i] = v;
    else if (bits === 16) { const o = y * rowBytes + i * 2; out[o] = little ? v & 255 : v >> 8; out[o + 1] = little ? v >> 8 : v & 255; }
    else for (let k = 0; k < bits; k++) {
      const bit = i * bits + k;
      if ((v >> (bits - 1 - k)) & 1) out[y * rowBytes + (bit >> 3)]! |= 0x80 >> (bit & 7);
    }
  }
  return out;
}

export interface LosslessJpegEncodeOptions {
  width: number; height: number; components: number; precision: number; predictor: number;
  pointTransform?: number; restartInterval?: number; legacySixteenBitDifference?: boolean;
  /** Extra segments inserted before SOF3 (e.g. an APP or COM segment). */
  extraSegments?: Uint8Array[];
}
/** Huffman code lengths per category 0..16 (Kraft sum < 1); two tables so components can use different ones. */
const TABLES = [
  [2, 3, 3, 3, 3, 3, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
  [3, 2, 2, 3, 4, 5, 6, 8, 8, 8, 9, 9, 10, 10, 10, 10, 10]
] as const;

/** Straightforward T.81 Annex H encoder: canonical Huffman codes, modulo-2^16 differences, byte stuffing. */
export function encodeLosslessJpeg(samples: ArrayLike<number>, o: LosslessJpegEncodeOptions): Uint8Array {
  const { width, height, components: nf, precision, predictor } = o, pt = o.pointTransform ?? 0, ri = o.restartInterval ?? 0;
  const out: number[] = [0xff, 0xd8];
  const segment = (marker: number, payload: number[]): void => { out.push(0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload); };
  const codes = TABLES.map((lengths) => {
    const order = lengths.map((l, s) => [l, s] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const result: { code: number; length: number }[] = []; let code = 0, previous = order[0]![0];
    for (const [length, symbol] of order) { code <<= length - previous; previous = length; result[symbol] = { code, length }; code++; }
    const bits = Array<number>(16).fill(0); for (const l of lengths) bits[l - 1]!++;
    return { result, bits, values: order.map(([, s]) => s) };
  });
  for (const extra of o.extraSegments ?? []) out.push(...extra);
  for (let t = 0; t < 2; t++) segment(0xc4, [t, ...codes[t]!.bits, ...codes[t]!.values]);
  segment(0xc3, [precision, height >> 8, height & 255, width >> 8, width & 255, nf, ...Array.from({ length: nf }, (_, c) => [c + 1, 0x11, 0]).flat()]);
  if (ri) segment(0xdd, [ri >> 8, ri & 255]);
  segment(0xda, [nf, ...Array.from({ length: nf }, (_, c) => [c + 1, (c % 2) << 4]).flat(), predictor, 0, pt]);
  let acc = 0, nbits = 0;
  const emit = (value: number, count: number): void => {
    for (let i = count - 1; i >= 0; i--) {
      acc = (acc << 1) | ((value >> i) & 1); nbits++;
      if (nbits === 8) { out.push(acc); if (acc === 255) out.push(0); acc = 0; nbits = 0; }
    }
  };
  const flush = (): void => { if (nbits) emit((1 << (8 - nbits)) - 1, 8 - nbits); };
  const v = (y: number, x: number, c: number): number => samples[(y * width + x) * nf + c]! >> pt;
  let first = 0, restarts = 0;
  for (let y = 0; y < height; y++) {
    if (ri && y > 0 && (y * width) % ri === 0) { flush(); out.push(0xff, 0xd0 | (restarts++ & 7)); first = y; }
    for (let x = 0; x < width; x++) for (let c = 0; c < nf; c++) {
      let px: number;
      if (y === first) px = x === 0 ? 1 << (precision - pt - 1) : v(y, x - 1, c);
      else if (x === 0) px = v(y - 1, x, c);
      else {
        const ra = v(y, x - 1, c), rb = v(y - 1, x, c), rc = v(y - 1, x - 1, c);
        px = [0, ra, rb, rc, ra + rb - rc, ra + ((rb - rc) >> 1), rb + ((ra - rc) >> 1), (ra + rb) >> 1][predictor]!;
      }
      let diff = ((v(y, x, c) - px) % 65536 + 65536) % 65536;
      if (diff >= 32768) diff -= 65536;
      const size = diff === -32768 ? 16 : diff === 0 ? 0 : Math.floor(Math.log2(Math.abs(diff))) + 1;
      const code = codes[c % 2]!.result[size]!;
      emit(code.code, code.length);
      if (size === 16) { if (o.legacySixteenBitDifference) emit(0x8000, 16); }
      else if (size) emit(diff > 0 ? diff : diff + (1 << size) - 1, size);
    }
  }
  flush();
  out.push(0xff, 0xd9);
  return Uint8Array.from(out);
}
