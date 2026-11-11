// SPDX-License-Identifier: Apache-2.0
// This product includes DNG technology under license by Adobe.

/**
 * #598: the two DNG 1.6/1.7 rendering tags phones write that change the developed image: ProfileGainTableMap (52525, raw IFD) or
 * ProfileGainTableMap2 (52544, IFD 0; it supersedes the first), a spatially varying gain (a local tone map), and RGBTables (52543,
 * DNG 1.6), masked 3D colour look tables. Both act on the file's own developed values (owner, 2026-11-10), not on sensor signals.
 *
 * Written from the Adobe DNG Specification 1.6/1.7 descriptions of these tags. The 1.7.1.0 PDF could not be retrieved while this was
 * written (HTTP 403); the byte layouts and the evaluation order were checked against the DNG SDK 1.7.1 source (dng_gain_map.cpp
 * `GetStream`, dng_reference.cpp `RefBaselineProfileGainTableMap`, `RefRGBtoRGBTable3D`, `RefMaskedRGBTables32`, dng_render.cpp) and
 * must be checked against the PDF. Both tags are read in the file's byte order (the SDK reads them from the file stream; only opcode
 * lists are big-endian by definition).
 *
 * Where they go in a development (SDK `dng_render`): camera RGB → white balance → linear ProPhoto (RIMM, D50) RGB with 1 the
 * clipping white → ProfileGainTableMap → BaselineExposure → look table → tone curve → RGBTables → output colour space.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/** A parsed ProfileGainTableMap(2): N gains at each of V × H map points, decoded to 32-bit floats. */
export interface DngProfileGainTableMap {
  /** 1 for ProfileGainTableMap (52525), 2 for ProfileGainTableMap2 (52544). */
  version: 1 | 2;
  pointsV: number; pointsH: number; spacingV: number; spacingH: number; originV: number; originH: number;
  /** MapPointsN: the table length at each map point. */
  tablePoints: number;
  /** MapInputWeights for red, green, blue, min(R,G,B) and max(R,G,B). */
  inputWeights: [number, number, number, number, number];
  /** PGTM2: the weight's gamma (1 for version 1). */
  gamma: number;
  /** Gains, row-major (v, h, table point). */
  gains: Float32Array;
}
/** One table of RGBTables: a 3D table of `divisions`³ RGB samples (16-bit, 65535 = 1). */
export interface DngRgbTable {
  /** TableSemanticName: the semantic mask it applies within; "" for the background table (the whole image). */
  semanticName: string;
  divisions: number;
  gamma: "linear" | "srgb" | "1.8" | "2.2" | "rec2020";
  primaries: "srgb" | "adobe-rgb" | "display-p3" | "rec2020" | "prophoto";
  gamut: "clip" | "extend";
  /** RGB per node, red slowest then green then blue, length divisions³ × 3. */
  samples: Uint16Array;
}
export interface DngRgbTables { compositeMethod: "weighted-sum" | "sequential"; tables: DngRgbTable[] }
/** An RGB image, interleaved (row, column, channel). */
export interface DngRgbImage { width: number; height: number; data: Float32Array }

function fail(message: string): never { throw new InvalidConfigurationError("DNG profile maps: " + message); }
class Reader {
  p = 0; private v: DataView;
  constructor(private b: Uint8Array, private little: boolean) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  need(n: number): void { if (this.p + n > this.b.length) fail("the tag's data is truncated."); }
  u8(): number { this.need(1); return this.b[this.p++]!; }
  u16(): number { this.need(2); const x = this.v.getUint16(this.p, this.little); this.p += 2; return x; }
  u32(): number { this.need(4); const x = this.v.getUint32(this.p, this.little); this.p += 4; return x; }
  f32(): number { this.need(4); const x = this.v.getFloat32(this.p, this.little); this.p += 4; if (!Number.isFinite(x)) fail("non-finite value."); return x; }
  f64(): number { this.need(8); const x = this.v.getFloat64(this.p, this.little); this.p += 8; if (!Number.isFinite(x)) fail("non-finite value."); return x; }
  bytes(n: number): Uint8Array { this.need(n); const x = this.b.subarray(this.p, this.p + n); this.p += n; return x; }
}

/** IEEE 754 binary16 to a number. */
function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
}

/**
 * Parses ProfileGainTableMap (version 1) or ProfileGainTableMap2 (version 2). Layout: MapPointsV, MapPointsH (LONG), MapSpacingV,
 * MapSpacingH, MapOriginV, MapOriginH (DOUBLE), MapPointsN (LONG), MapInputWeights (5 FLOAT); version 2 adds DataType (LONG: 0 uint8,
 * 1 uint16, 2 float16, 3 float32), Gamma, GainMin, GainMax (FLOAT); then the gains. Integer gains are GainMin + (x/max)·(GainMax −
 * GainMin). A single map point on an axis has spacing 1 and origin 0 (SDK).
 */
export function parseDngProfileGainTableMap(bytes: Uint8Array, littleEndian: boolean, version: 1 | 2): DngProfileGainTableMap {
  const r = new Reader(bytes, littleEndian);
  const pointsV = r.u32(), pointsH = r.u32();
  let spacingV = r.f64(), spacingH = r.f64(), originV = r.f64(), originH = r.f64();
  const tablePoints = r.u32(), inputWeights = [r.f32(), r.f32(), r.f32(), r.f32(), r.f32()] as [number, number, number, number, number];
  let dataType = 3, gamma = 1, gainMin = 1, gainMax = 1;
  if (version === 2) {
    dataType = r.u32(); gamma = r.f32(); gainMin = r.f32(); gainMax = r.f32();
    if (dataType > 3) fail("unsupported ProfileGainTableMap2 DataType.");
    if (!(gamma >= 0.1 && gamma <= 10)) fail("ProfileGainTableMap2 gamma is out of range.");
  }
  if (pointsV === 1) { spacingV = 1; originV = 0; }
  if (pointsH === 1) { spacingH = 1; originH = 0; }
  if (pointsV < 1 || pointsH < 1 || tablePoints < 1 || !(spacingV > 0 && spacingH > 0)) fail("invalid ProfileGainTableMap.");
  const count = pointsV * pointsH * tablePoints, size = [1, 2, 2, 4][dataType]!;
  if (count > 1 << 24 || count * size > bytes.length - r.p) fail("the ProfileGainTableMap gains exceed the tag.");
  const gains = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = dataType === 3 ? r.f32() : dataType === 2 ? half(r.u16()) : dataType === 1 ? gainMin + r.u16() / 65535 * (gainMax - gainMin) : gainMin + r.u8() / 255 * (gainMax - gainMin);
    if (!(x >= 0 && x <= 1e4)) fail("a ProfileGainTableMap gain is out of range.");
    gains[i] = x;
  }
  return { version, pointsV, pointsH, spacingV, spacingH, originV, originH, tablePoints, inputWeights, gamma, gains };
}

const GAMMAS = ["linear", "srgb", "1.8", "2.2", "rec2020"] as const;
const PRIMARIES = ["srgb", "adobe-rgb", "display-p3", "rec2020", "prophoto"] as const;
/**
 * Parses RGBTables (52543): table count (LONG, at most 20; 0 means none), CompositeMethod (LONG: 0 weighted sum, 1 sequential), then
 * per table LengthTableSemanticName (SHORT), the name's bytes, Divisions, PixelType (0 uint8, 1 uint16, 2 float32), GammaEncoding
 * (0 linear, 1 sRGB, 2 γ 1.8, 3 γ 2.2, 4 Rec. 2020), ColorPrimaries (0 sRGB, 1 Adobe RGB, 2 P3, 3 Rec. 2020, 4 ProPhoto) and
 * GamutExtension (0 clip, 1 extend), each a BYTE, then Divisions³ RGB samples (uint8 scaled by 256, float scaled by 65535).
 */
export function parseDngRgbTables(bytes: Uint8Array, littleEndian: boolean): DngRgbTables | null {
  const r = new Reader(bytes, littleEndian), count = r.u32();
  if (count === 0) return null;
  if (count > 20) fail("RGBTables holds more than 20 tables.");
  const method = r.u32();
  if (method > 1) fail("invalid RGBTables CompositeMethod.");
  const tables: DngRgbTable[] = [];
  for (let t = 0; t < count; t++) {
    const nameLength = r.u16();
    let semanticName = ""; for (const b of r.bytes(nameLength)) semanticName += String.fromCharCode(b);
    const divisions = r.u8(), pixelType = r.u8(), gamma = r.u8(), primaries = r.u8(), gamut = r.u8();
    if (divisions < 2 || divisions > 32 || pixelType > 2 || gamma > 4 || primaries > 4 || gamut > 1) fail("invalid RGBTables table header.");
    const n = divisions ** 3 * 3, samples = new Uint16Array(n);
    for (let i = 0; i < n; i++) samples[i] = pixelType === 0 ? r.u8() << 8 : pixelType === 1 ? r.u16() : Math.min(65535, Math.max(0, Math.round(r.f32() * 65535)));
    tables.push({ semanticName: semanticName.replace(/\0+$/u, ""), divisions, gamma: GAMMAS[gamma]!, primaries: PRIMARIES[primaries]!, gamut: gamut ? "extend" : "clip", samples });
  }
  return { compositeMethod: method ? "sequential" : "weighted-sum", tables };
}

/** Options of {@link applyDngProfileGainTableMap}. */
export interface ApplyDngProfileGainTableMapInput {
  /** Linear ProPhoto (RIMM, D50) RGB, white-balanced, 1 = clipping white; changed in place. */
  image: DngRgbImage;
  map: DngProfileGainTableMap;
  /** BaselineExposure (stops) not yet applied to `image`: the weight is scaled by 2^stops, as the SDK does. Default 0. */
  baselineExposureStops?: number;
  /** Where `image` sits in the stage-3 (ActiveArea) image the map spans. Default: `image` is the whole stage-3 image. */
  region?: { x: number; y: number; stageWidth: number; stageHeight: number };
  /** Keep values above 1 (true) or clip to 0..1 (false, the SDR default). */
  overrange?: boolean;
}

/**
 * Applies ProfileGainTableMap(2): at each pixel the weight t = clamp(w·(R, G, B, min, max)·2^BaselineExposure, 0, 1)^γ selects a
 * gain by linear interpolation at t·N in the table (index clamped to N − 1, SDK), bilinear between map points at the pixel centre's
 * relative position (held at the map's edges); R, G and B are multiplied by it.
 */
export function applyDngProfileGainTableMap(input: ApplyDngProfileGainTableMapInput): void {
  const { image, map } = input, { width, height, data } = image;
  if (data.length !== width * height * 3) fail("the image must be interleaved RGB of its size.");
  const region = input.region ?? { x: 0, y: 0, stageWidth: width, stageHeight: height }, gainWeight = 2 ** (input.baselineExposureStops ?? 0);
  if (!Number.isFinite(gainWeight)) fail("baselineExposureStops must be finite.");
  const [w0, w1, w2, w3, w4] = map.inputWeights, n = map.tablePoints, last = n - 1;
  const entry = (v: number, h: number, k: number): number => map.gains[(v * map.pointsH + h) * n + k]!;
  for (let row = 0; row < height; row++) {
    const yMap = Math.min(Math.max(((region.y + row + 0.5) / region.stageHeight - map.originV) / map.spacingV, 0), map.pointsV - 1);
    const y0 = Math.floor(yMap), y1 = Math.min(y0 + 1, map.pointsV - 1), yf = yMap - y0;
    for (let col = 0; col < width; col++) {
      const xMap = Math.min(Math.max(((region.x + col + 0.5) / region.stageWidth - map.originH) / map.spacingH, 0), map.pointsH - 1);
      const x0 = Math.floor(xMap), x1 = Math.min(x0 + 1, map.pointsH - 1), xf = xMap - x0, i = (row * width + col) * 3;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      let t = (w0 * r + w1 * g + w2 * b + w3 * Math.min(r, g, b) + w4 * Math.max(r, g, b)) * gainWeight;
      t = Math.min(Math.max(t, 0), 1);
      if (map.gamma !== 1) t = t ** map.gamma;
      const scaled = t * n, k0 = Math.min(Math.floor(scaled), last), k1 = Math.min(k0 + 1, last), kf = scaled - k0;
      const lerp = (a: number, c: number, f: number): number => a + (c - a) * f;
      const at = (v: number, h: number): number => lerp(entry(v, h, k0), entry(v, h, k1), kf);
      const gain = lerp(lerp(at(y0, x0), at(y0, x1), xf), lerp(at(y1, x0), at(y1, x1), xf), yf);
      for (let c = 0; c < 3; c++) { const v = data[i + c]! * gain; data[i + c] = input.overrange ? v : Math.min(Math.max(v, 0), 1); }
    }
  }
}

/** Chromaticities (x, y) of R, G, B and the white point. */
const SPACES: Record<DngRgbTable["primaries"], number[]> = {
  srgb: [0.64, 0.33, 0.30, 0.60, 0.15, 0.06, 0.3127, 0.3290], "adobe-rgb": [0.64, 0.33, 0.21, 0.71, 0.15, 0.06, 0.3127, 0.3290],
  "display-p3": [0.680, 0.320, 0.265, 0.690, 0.150, 0.060, 0.3127, 0.3290], rec2020: [0.708, 0.292, 0.170, 0.797, 0.131, 0.046, 0.3127, 0.3290],
  prophoto: [0.7347, 0.2653, 0.1596, 0.8404, 0.0366, 0.0001, 0.3457, 0.3585]
};
type M3 = number[];
const mul = (a: M3, b: M3): M3 => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!));
function inv(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, k] = m as [number, number, number, number, number, number, number, number, number], det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  return [e * k - f * h, c * h - b * k, b * f - c * e, f * g - d * k, a * k - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d].map((x) => x / det);
}
/** RGB → XYZ (SMPTE RP 177 derivation), chromatically adapted to D50 with the Bradford transform (ICC.1 Annex E) when the white is not D50. */
function rgbToXyzD50(space: DngRgbTable["primaries"]): M3 {
  const s = SPACES[space]!, xyz = (x: number, y: number): number[] => [x / y, 1, (1 - x - y) / y];
  const cols = [0, 1, 2].map((k) => xyz(s[k * 2]!, s[k * 2 + 1]!)), white = xyz(s[6]!, s[7]!);
  const P = [0, 1, 2].flatMap((i) => cols.map((c) => c[i]!)), scale = mul(inv(P), [white[0]!, 0, 0, white[1]!, 0, 0, white[2]!, 0, 0]);
  const m = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => P[i * 3 + j]! * scale[j * 3]!));
  if (space === "prophoto") return m;
  const B = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296], d50 = xyz(0.3457, 0.3585);
  const src = mul(B, [white[0]!, 0, 0, white[1]!, 0, 0, white[2]!, 0, 0]), dst = mul(B, [d50[0]!, 0, 0, d50[1]!, 0, 0, d50[2]!, 0, 0]);
  const adapt = mul(inv(B), mul([dst[0]! / src[0]!, 0, 0, 0, dst[3]! / src[3]!, 0, 0, 0, dst[6]! / src[6]!], B));
  return mul(adapt, m);
}
/** Encode (true) or decode a table's gamma: sRGB (IEC 61966-2-1), pure powers 1.8 and 2.2, and the Rec. 2020 OETF (ITU-R BT.2020). */
function gammaCurve(kind: DngRgbTable["gamma"], x: number, encode: boolean): number {
  switch (kind) {
    case "linear": return x;
    case "1.8": return encode ? x ** (1 / 1.8) : x ** 1.8;
    case "2.2": return encode ? x ** (1 / 2.2) : x ** 2.2;
    case "srgb": return encode ? (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) : (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    case "rec2020": return encode ? (x < 0.018053968510807 ? 4.5 * x : 1.09929682680944 * x ** 0.45 - 0.09929682680944) : (x < 0.081242858298635 ? x / 4.5 : ((x + 0.09929682680944) / 1.09929682680944) ** (1 / 0.45));
  }
}

/** Options of {@link applyDngRgbTables}. */
export interface ApplyDngRgbTablesInput {
  /** ProPhoto-primaries RGB after the tone curve, 0..1; changed in place. */
  image: DngRgbImage;
  tables: DngRgbTables;
  /** Semantic masks by name (values 0..1, any size; stretched over the image with bilinear interpolation). */
  masks?: readonly { name: string; width: number; height: number; data: Float32Array }[];
}

/**
 * Applies RGBTables: each table maps ProPhoto RGB into its own primaries (clipped to 0..1, the clipped-off part kept and added back
 * when GamutExtension is "extend"), encodes it with the table's gamma, interpolates tetrahedrally in the 3D table, decodes and maps
 * back (SDK `RefRGBtoRGBTable3D`). The background table (empty name) applies to the whole image. Weighted sum: each masked table's
 * result weighted by its mask, the background (the background table's result, or the input) by 1 − min(1, Σ masks), normalized.
 * Sequential: each table in file order, blended into the running image by its mask (the background table by 1 − min(1, Σ other masks)).
 * A table whose mask is not supplied is skipped (as the SDK skips a name with no SemanticMask); the returned notes say so.
 */
export function applyDngRgbTables(input: ApplyDngRgbTablesInput): string[] {
  const { image, tables } = input, { width, height, data } = image, notes: string[] = [];
  if (data.length !== width * height * 3) fail("the image must be interleaved RGB of its size.");
  const pixels = width * height, maskOf = (name: string): Float32Array | null => {
    const m = input.masks?.find((x) => x.name === name);
    if (!m) return null;
    if (m.data.length !== m.width * m.height) fail("semantic mask " + JSON.stringify(name) + " does not match its size.");
    const out = new Float32Array(pixels);
    for (let y = 0; y < height; y++) {
      const fy = Math.min(Math.max((y + 0.5) * m.height / height - 0.5, 0), m.height - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, m.height - 1), wy = fy - y0;
      for (let x = 0; x < width; x++) {
        const fx = Math.min(Math.max((x + 0.5) * m.width / width - 0.5, 0), m.width - 1), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, m.width - 1), wx = fx - x0;
        const a = m.data[y0 * m.width + x0]!, b = m.data[y0 * m.width + x1]!, c = m.data[y1 * m.width + x0]!, d = m.data[y1 * m.width + x1]!;
        out[y * width + x] = Math.min(Math.max((a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy, 0), 1);
      }
    }
    return out;
  };
  const background = tables.tables.find((t) => t.semanticName === "");
  const masked: { table: DngRgbTable; mask: Float32Array }[] = [];
  for (const table of tables.tables) {
    if (table === background) continue;
    const mask = maskOf(table.semanticName);
    if (mask) masked.push({ table, mask }); else notes.push("RGBTables table " + JSON.stringify(table.semanticName) + " not applied: no semantic mask of that name.");
  }
  const transform = (table: DngRgbTable, rgb: Float32Array): void => applyTable(table, rgb);
  if (masked.length === 0) { if (background) transform(background, data); return notes; }
  const sum = new Float32Array(pixels);
  for (const { mask } of masked) for (let i = 0; i < pixels; i++) sum[i] = sum[i]! + mask[i]!;
  if (tables.compositeMethod === "sequential") {
    for (const table of tables.tables) {
      const mask = table === background ? Float32Array.from(sum, (s) => 1 - Math.min(1, s)) : masked.find((m) => m.table === table)?.mask;
      if (!mask) continue;
      const result = data.slice();
      transform(table, result);
      for (let i = 0; i < pixels; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = data[i * 3 + c]! + (result[i * 3 + c]! - data[i * 3 + c]!) * mask[i]!;
    }
  } else {
    const results = masked.map(({ table }) => { const r = data.slice(); transform(table, r); return r; });
    if (background) transform(background, data);
    for (let i = 0; i < pixels; i++) {
      const bg = 1 - Math.min(1, sum[i]!), norm = 1 / (sum[i]! + bg);
      for (let c = 0; c < 3; c++) {
        let v = data[i * 3 + c]! * bg;
        masked.forEach((m, k) => { v += results[k]![i * 3 + c]! * m.mask[i]!; });
        data[i * 3 + c] = v * norm;
      }
    }
  }
  return notes;
}

function applyTable(table: DngRgbTable, rgb: Float32Array): void {
  const matrix = table.primaries !== "prophoto", encode = matrix ? mul(inv(rgbToXyzD50(table.primaries)), rgbToXyzD50("prophoto")) : null, decode = encode ? inv(encode) : null;
  const extend = matrix && table.gamut === "extend", divs = table.divisions, s = table.samples, scale = divs - 1, maxIndex = divs - 2;
  const o001 = 3, o010 = 3 * divs, o100 = 3 * divs * divs, o011 = o010 + o001, o101 = o100 + o001, o110 = o100 + o010, o111 = o110 + o001;
  const pin = (x: number): number => x < 0 ? 0 : x > 1 ? 1 : x;
  for (let i = 0; i < rgb.length; i += 3) {
    let r = rgb[i]!, g = rgb[i + 1]!, b = rgb[i + 2]!, dr = 0, dg = 0, db = 0;
    if (encode) {
      const rr = encode[0]! * r + encode[1]! * g + encode[2]! * b, gg = encode[3]! * r + encode[4]! * g + encode[5]! * b, bb = encode[6]! * r + encode[7]! * g + encode[8]! * b;
      r = pin(rr); g = pin(gg); b = pin(bb);
      if (extend) { dr = rr - r; dg = gg - g; db = bb - b; }
    } else { r = pin(r); g = pin(g); b = pin(b); }
    r = gammaCurve(table.gamma, r, true); g = gammaCurve(table.gamma, g, true); b = gammaCurve(table.gamma, b, true);
    const rs = r * scale, gs = g * scale, bs = b * scale;
    const ri = Math.min(Math.floor(rs), maxIndex), gi = Math.min(Math.floor(gs), maxIndex), bi = Math.min(Math.floor(bs), maxIndex);
    const rf = rs - ri, gf = gs - gi, bf = bs - bi;
    let o1: number, o2: number, f1: number, f2: number, f3: number;
    if (gf >= rf) {
      if (bf >= gf) { o1 = o001; o2 = o011; f1 = bf; f2 = gf; f3 = rf; }
      else if (bf >= rf) { o1 = o010; o2 = o011; f1 = gf; f2 = bf; f3 = rf; }
      else { o1 = o010; o2 = o110; f1 = gf; f2 = rf; f3 = bf; }
    } else if (bf >= rf) { o1 = o001; o2 = o101; f1 = bf; f2 = rf; f3 = gf; }
    else if (bf >= gf) { o1 = o100; o2 = o101; f1 = rf; f2 = bf; f3 = gf; }
    else { o1 = o100; o2 = o110; f1 = rf; f2 = gf; f3 = bf; }
    const w0 = 1 - f1, w1 = f1 - f2, w2 = f2 - f3, base = ri * o100 + gi * o010 + bi * o001;
    const out = [0, 1, 2].map((c) => gammaCurve(table.gamma, (w0 * s[base + c]! + w1 * s[base + o1 + c]! + w2 * s[base + o2 + c]! + f3 * s[base + o111 + c]!) / 65535, false));
    let [nr, ng, nb] = out as [number, number, number];
    if (decode) {
      nr += dr; ng += dg; nb += db;
      [nr, ng, nb] = [decode[0]! * nr + decode[1]! * ng + decode[2]! * nb, decode[3]! * nr + decode[4]! * ng + decode[5]! * nb, decode[6]! * nr + decode[7]! * ng + decode[8]! * nb];
    }
    rgb[i] = pin(nr); rgb[i + 1] = pin(ng); rgb[i + 2] = pin(nb);
  }
}
