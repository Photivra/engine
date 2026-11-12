// SPDX-License-Identifier: Apache-2.0
// This product includes DNG technology under license by Adobe.

/**
 * #598, #600: DNG opcode lists (OpcodeList1/2/3, tags 51008, 51009, 51022), read and applied to an imported DNG's image at the
 * stage the list belongs to. Written from the Adobe DNG Specification, chapter "Opcode List Processing" (opcodes added in 1.3.0.0).
 * The 1.7.1.0 PDF could not be retrieved while this was written (HTTP 403); the parameter layouts and the details marked
 * "(SDK)" were checked against the DNG SDK 1.7.1 source (dng_misc_opcodes, dng_gain_map, dng_lens_correction, dng_bad_pixels) and
 * must be checked against the PDF (#600).
 *
 * A list is big-endian whatever the file's byte order: a LONG count, then per opcode a LONG id, the four-byte DNG version that
 * introduced it, LONG flags (bit 0 optional, bit 1 may be skipped for previews) and the LONG byte count of its parameters.
 *
 * Stage images hold normalized values: stage 1 is the stored raw codes / 65535; stage 2 is the linearized image (ActiveArea,
 * black-subtracted, divided by white − black, clipped to 0..1); stage 3 the demosaiced one (the same as stage 2 for LinearRaw). Pixel
 * (row, column) sits at integer coordinates; a relative position u maps to the pixel coordinate u·width (SDK: Lerp over the bounds).
 *
 * Applied: WarpRectilinear (1), FixVignetteRadial (3), FixBadPixelsConstant (4), FixBadPixelsList (5), MapTable (7),
 * MapPolynomial (8), GainMap (9), DeltaPerRow (10), DeltaPerColumn (11), ScalePerRow (12), ScalePerColumn (13). Others (WarpFisheye 2,
 * TrimBounds 6, WarpRectilinear2 14 and unknown ids) are reported in the assumptions, never applied and never a failure.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/** The rectangle, plane range and pitch an area-based opcode acts on (stage pixel coordinates, bottom and right exclusive). */
export interface DngOpcodeArea { top: number; left: number; bottom: number; right: number; plane: number; planes: number; rowPitch: number; colPitch: number }
/** Opcode parameters, by opcode. */
export type DngOpcodeParameters =
  | { opcode: "WarpRectilinear"; planes: { radial: [number, number, number, number]; tangential: [number, number] }[]; centerX: number; centerY: number }
  | { opcode: "FixVignetteRadial"; coefficients: [number, number, number, number, number]; centerX: number; centerY: number }
  | { opcode: "FixBadPixelsConstant"; constant: number; bayerPhase: number }
  | { opcode: "FixBadPixelsList"; bayerPhase: number; points: [number, number][]; rects: [number, number, number, number][] }
  | { opcode: "MapTable"; area: DngOpcodeArea; table: Uint16Array }
  | { opcode: "MapPolynomial"; area: DngOpcodeArea; coefficients: number[] }
  | { opcode: "GainMap"; area: DngOpcodeArea; pointsV: number; pointsH: number; spacingV: number; spacingH: number; originV: number; originH: number; mapPlanes: number; gains: Float32Array }
  | { opcode: "DeltaPerRow" | "DeltaPerColumn" | "ScalePerRow" | "ScalePerColumn"; area: DngOpcodeArea; values: Float32Array };
export interface DngOpcode {
  id: number;
  /** The specification's name, or "Unknown". */
  name: string;
  dngVersion: [number, number, number, number];
  /** Flag bit 0: a reader may skip it. */
  optional: boolean;
  /** Flag bit 1: may be skipped for preview-quality rendering. */
  previewSkip: boolean;
  /** Decoded parameters of an applied opcode; null for one this reader does not apply. */
  parameters: DngOpcodeParameters | null;
}
/** A stage image: interleaved (row, column, plane), normalized values. */
export interface DngStageImage { width: number; height: number; planes: number; data: Float32Array }
/** Options of {@link applyDngOpcodes}. */
export interface ApplyDngOpcodesOptions {
  /** 1, 2 or 3: the list's stage (for the report). */
  stage: 1 | 2 | 3;
  /**
   * WarpRectilinear resampling: false (full quality) uses cubic convolution (Keys, a = −0.75, the DNG SDK's kernel); true uses
   * bilinear interpolation (fast). Registered as "dngImport.warpRectilinear" in SIMULATE_CAPTURE_FAST_METHODS.
   */
  fast: boolean;
  /** 1, or 0.5 for a half-size image: pixel-coordinate parameters are scaled; pitched areas and bad pixels are then not applied. */
  scale?: 1 | 0.5;
}

const NAMES = ["Unknown", "WarpRectilinear", "WarpFisheye", "FixVignetteRadial", "FixBadPixelsConstant", "FixBadPixelsList", "TrimBounds", "MapTable",
  "MapPolynomial", "GainMap", "DeltaPerRow", "DeltaPerColumn", "ScalePerRow", "ScalePerColumn", "WarpRectilinear2"] as const;
function fail(message: string): never { throw new InvalidConfigurationError("DNG opcodes: " + message); }

/** Parses an opcode list (the tag's bytes). Every count and length is checked against the bytes before allocation. */
export function parseDngOpcodeList(bytes: Uint8Array): DngOpcode[] {
  if (!(bytes instanceof Uint8Array)) fail("the list must be a Uint8Array.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = bytes.length;
  if (n < 4) fail("the list is too short.");
  const count = view.getUint32(0);
  if (count > 4096 || count * 16 > n - 4) fail("the opcode count exceeds the list.");
  const out: DngOpcode[] = [];
  let p = 4;
  for (let k = 0; k < count; k++) {
    if (p + 16 > n) fail("an opcode header exceeds the list.");
    const id = view.getUint32(p), flags = view.getUint32(p + 8), length = view.getUint32(p + 12), start = p + 16;
    if (length > n - start) fail("opcode parameters exceed the list.");
    const name = id < NAMES.length ? NAMES[id]! : "Unknown";
    out.push({ id, name, dngVersion: [bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!], optional: (flags & 1) === 1, previewSkip: (flags & 2) === 2,
      parameters: parseParameters(id, new DataView(bytes.buffer, bytes.byteOffset + start, length)) });
    p = start + length;
  }
  return out;
}

function parseParameters(id: number, v: DataView): DngOpcodeParameters | null {
  const size = v.byteLength;
  const need = (bytes: number): void => { if (bytes !== size) fail("opcode " + id + " has " + size + " parameter bytes, expected " + bytes + "."); };
  const finite = (x: number): number => { if (!Number.isFinite(x)) fail("non-finite opcode parameter."); return x; };
  const area = (): DngOpcodeArea => {
    if (size < 32) fail("area opcode parameters are too short.");
    const [top, left, bottom, right, plane, planes, rowPitch, colPitch] = [0, 4, 8, 12, 16, 20, 24, 28].map((o) => v.getUint32(o)) as [number, number, number, number, number, number, number, number];
    if (bottom < top || right < left || planes < 1 || rowPitch < 1 || colPitch < 1) fail("invalid opcode area.");
    return { top, left, bottom, right, plane, planes, rowPitch, colPitch };
  };
  switch (id) {
    case 1: {
      if (size < 4) fail("WarpRectilinear parameters are too short.");
      const planes = v.getUint32(0);
      if (planes < 1 || planes > 4) fail("WarpRectilinear needs 1 to 4 planes.");
      need(4 + planes * 48 + 16);
      const list = Array.from({ length: planes }, (_, i) => {
        const at = 4 + i * 48, d = (j: number): number => finite(v.getFloat64(at + j * 8));
        return { radial: [d(0), d(1), d(2), d(3)] as [number, number, number, number], tangential: [d(4), d(5)] as [number, number] };
      });
      const centerX = finite(v.getFloat64(4 + planes * 48)), centerY = finite(v.getFloat64(12 + planes * 48));
      if (!(centerX >= 0 && centerX <= 1 && centerY >= 0 && centerY <= 1)) fail("WarpRectilinear's centre must be within the image.");
      return { opcode: "WarpRectilinear", planes: list, centerX, centerY };
    }
    case 3: {
      need(56);
      const d = (j: number): number => finite(v.getFloat64(j * 8));
      const centerX = d(5), centerY = d(6);
      if (!(centerX >= 0 && centerX <= 1 && centerY >= 0 && centerY <= 1)) fail("FixVignetteRadial's centre must be within the image.");
      return { opcode: "FixVignetteRadial", coefficients: [d(0), d(1), d(2), d(3), d(4)], centerX, centerY };
    }
    case 4: {
      need(8);
      const bayerPhase = v.getUint32(4);
      if (bayerPhase > 3) fail("BayerPhase must be 0 to 3.");
      return { opcode: "FixBadPixelsConstant", constant: v.getUint32(0), bayerPhase };
    }
    case 5: {
      if (size < 12) fail("FixBadPixelsList parameters are too short.");
      const bayerPhase = v.getUint32(0), pointCount = v.getUint32(4), rectCount = v.getUint32(8);
      if (bayerPhase > 3) fail("BayerPhase must be 0 to 3.");
      if (pointCount > (size - 12) / 8 || rectCount > (size - 12) / 16) fail("bad-pixel counts exceed the parameters.");
      need(12 + pointCount * 8 + rectCount * 16);
      const points = Array.from({ length: pointCount }, (_, i): [number, number] => [v.getUint32(12 + i * 8), v.getUint32(16 + i * 8)]);
      const base = 12 + pointCount * 8;
      const rects = Array.from({ length: rectCount }, (_, i): [number, number, number, number] => [0, 4, 8, 12].map((o) => v.getUint32(base + i * 16 + o)) as [number, number, number, number]);
      return { opcode: "FixBadPixelsList", bayerPhase, points, rects };
    }
    case 7: {
      const a = area();
      if (size < 36) fail("MapTable parameters are too short.");
      const n = v.getUint32(32);
      if (n < 1 || n > 65536) fail("MapTable size must be 1 to 65536.");
      need(36 + n * 2);
      const table = new Uint16Array(n);
      for (let i = 0; i < n; i++) table[i] = v.getUint16(36 + i * 2);
      return { opcode: "MapTable", area: a, table };
    }
    case 8: {
      const a = area();
      if (size < 36) fail("MapPolynomial parameters are too short.");
      const degree = v.getUint32(32);
      if (degree > 8) fail("MapPolynomial degree must be at most 8.");
      need(36 + (degree + 1) * 8);
      return { opcode: "MapPolynomial", area: a, coefficients: Array.from({ length: degree + 1 }, (_, i) => finite(v.getFloat64(36 + i * 8))) };
    }
    case 9: {
      const a = area();
      if (size < 76) fail("GainMap parameters are too short.");
      const pointsV = v.getUint32(32), pointsH = v.getUint32(36), spacingV = finite(v.getFloat64(40)), spacingH = finite(v.getFloat64(48));
      const originV = finite(v.getFloat64(56)), originH = finite(v.getFloat64(64)), mapPlanes = v.getUint32(72);
      if (pointsV < 1 || pointsH < 1 || mapPlanes < 1 || pointsV * pointsH * mapPlanes > (size - 76) / 4 || !(spacingV > 0 && spacingH > 0)) fail("invalid GainMap.");
      need(76 + pointsV * pointsH * mapPlanes * 4);
      const gains = new Float32Array(pointsV * pointsH * mapPlanes);
      for (let i = 0; i < gains.length; i++) gains[i] = finite(v.getFloat32(76 + i * 4));
      return { opcode: "GainMap", area: a, pointsV, pointsH, spacingV, spacingH, originV, originH, mapPlanes, gains };
    }
    case 10: case 11: case 12: case 13: {
      const a = area();
      if (size < 36) fail("per-row or per-column opcode parameters are too short.");
      const n = v.getUint32(32);
      if (n > (size - 36) / 4) fail("per-row or per-column count exceeds the parameters.");
      need(36 + n * 4);
      const values = new Float32Array(n);
      for (let i = 0; i < n; i++) values[i] = finite(v.getFloat32(36 + i * 4));
      return { opcode: (["DeltaPerRow", "DeltaPerColumn", "ScalePerRow", "ScalePerColumn"] as const)[id - 10]!, area: a, values };
    }
    default: return null;
  }
}

/** Keys's cubic convolution kernel with a = −0.75 (the DNG SDK's `dng_resample_bicubic`). */
function cubic(x: number): number {
  const a = -0.75; x = Math.abs(x);
  return x >= 2 ? 0 : x >= 1 ? ((a * x - 5 * a) * x + 8 * a) * x - 4 * a : ((a + 2) * x - (a + 3)) * x * x + 1;
}

/**
 * Applies an opcode list to a stage image in place (WarpRectilinear returns a new buffer in `image.data`). Returns one assumption
 * per opcode: what was applied, or why it was not.
 */
export function applyDngOpcodes(image: DngStageImage, opcodes: readonly DngOpcode[], options: ApplyDngOpcodesOptions): string[] {
  if (image === null || typeof image !== "object" || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || !Number.isSafeInteger(image.planes))
    fail("applyDngOpcodes takes a stage image { width, height, planes, data }.");
  if (!Array.isArray(opcodes)) fail("applyDngOpcodes takes a parsed opcode list (parseDngOpcodeList).");
  if (options === null || typeof options !== "object") fail("applyDngOpcodes takes options with the list's stage.");
  const { width, height, planes } = image, scale = options.scale ?? 1, notes: string[] = [];
  if (!(image.data instanceof Float32Array) || image.data.length !== width * height * planes) fail("the stage image's data does not match its size.");
  const label = (op: DngOpcode): string => "OpcodeList" + options.stage + " " + op.name + " (" + op.id + ")";
  for (const op of opcodes) {
    const p = op.parameters;
    if (!p) { notes.push(label(op) + " not applied: not supported" + (op.optional ? " (optional)." : " (marked required by the file).")); continue; }
    if (scale !== 1 && (p.opcode === "FixBadPixelsConstant" || p.opcode === "FixBadPixelsList")) { notes.push(label(op) + " not applied: a half-size image has no single raw pixels."); continue; }
    if ((p.opcode === "FixBadPixelsConstant" || p.opcode === "FixBadPixelsList") && planes !== 1) { notes.push(label(op) + " not applied: bad-pixel opcodes act on single-plane CFA data."); continue; }
    if ("area" in p && scale !== 1 && (p.area.rowPitch > 1 || p.area.colPitch > 1)) { notes.push(label(op) + " not applied: a pitched area cannot be scaled to a half-size image."); continue; }
    switch (p.opcode) {
      case "MapTable": case "MapPolynomial": case "DeltaPerRow": case "DeltaPerColumn": case "ScalePerRow": case "ScalePerColumn": case "GainMap":
        applyArea(image, p, scale); break;
      case "FixVignetteRadial": applyVignette(image, p); break;
      case "WarpRectilinear":
        if (p.planes.length !== 1 && p.planes.length !== planes) { notes.push(label(op) + " not applied: its plane count does not match the image."); continue; }
        image.data = warp(image, p, options.fast); break;
      case "FixBadPixelsConstant": case "FixBadPixelsList": fixBadPixels(image, p); break;
    }
    notes.push(label(op) + " applied" + (p.opcode === "WarpRectilinear" ? (options.fast ? " (bilinear resampling, fast)." : " (cubic convolution, a = −0.75).") : "."));
  }
  return notes;
}

type AreaParameters = Extract<DngOpcodeParameters, { area: DngOpcodeArea }>;
function applyArea(image: DngStageImage, p: AreaParameters, scale: number): void {
  const { width, height, planes, data } = image, a = p.area;
  const top = Math.floor(a.top * scale), left = Math.floor(a.left * scale), bottom = Math.min(height, Math.ceil(a.bottom * scale)), right = Math.min(width, Math.ceil(a.right * scale));
  const lastPlane = Math.min(planes, a.plane + a.planes);
  const clip = (x: number): number => x < 0 ? 0 : x > 1 ? 1 : x;
  for (let plane = a.plane; plane < lastPlane; plane++) for (let row = top, ri = 0; row < bottom; row += a.rowPitch, ri++) {
    for (let col = left, ci = 0; col < right; col += a.colPitch, ci++) {
      const i = (row * width + col) * planes + plane, x = data[i]!;
      switch (p.opcode) {
        case "MapTable": { const t = p.table, index = Math.round(clip(x) * 65535); data[i] = t[Math.min(index, t.length - 1)]! / 65535; break; }
        case "MapPolynomial": { let y = 0; for (let k = p.coefficients.length - 1; k >= 0; k--) y = y * clip(x) + p.coefficients[k]!; data[i] = clip(y); break; }
        // SDK: the per-row/column tables have one entry per pitched row or column; an index beyond the table leaves the value.
        case "DeltaPerRow": if (ri < p.values.length) data[i] = clip(x + p.values[ri]!); break;
        case "DeltaPerColumn": if (ci < p.values.length) data[i] = clip(x + p.values[ci]!); break;
        case "ScalePerRow": if (ri < p.values.length) data[i] = clip(x * p.values[ri]!); break;
        case "ScalePerColumn": if (ci < p.values.length) data[i] = clip(x * p.values[ci]!); break;
        case "GainMap": data[i] = Math.min(Math.max(x, 0) * gainAt(p, (row + 0.5) / height, (col + 0.5) / width, Math.min(plane, p.mapPlanes - 1)), 1); break;
      }
    }
  }
}

/**
 * The GainMap gain at a relative position (pixel centre over the image), bilinear between map points, held at the edges (SDK
 * `dng_gain_map_interpolator`). Map point (i, j) is at relative position origin + spacing·(i, j).
 */
function gainAt(p: Extract<DngOpcodeParameters, { opcode: "GainMap" }>, v: number, h: number, plane: number): number {
  const axis = (rel: number, origin: number, spacing: number, points: number): [number, number, number] => {
    const f = (rel - origin) / spacing;
    if (!(f > 0)) return [0, 0, 0];
    if (f >= points - 1) return [points - 1, points - 1, 0];
    const i = Math.floor(f);
    return [i, i + 1, f - i];
  };
  const [r0, r1, fr] = axis(v, p.originV, p.spacingV, p.pointsV), [c0, c1, fc] = axis(h, p.originH, p.spacingH, p.pointsH);
  const g = (r: number, c: number): number => p.gains[(r * p.pointsH + c) * p.mapPlanes + plane]!;
  const top = g(r0, c0) + (g(r0, c1) - g(r0, c0)) * fc, bottom = g(r1, c0) + (g(r1, c1) - g(r1, c0)) * fc;
  return top + (bottom - top) * fr;
}

/** Centre in pixel coordinates and the normalization radius: the largest distance from the centre to an image corner (SDK). */
function geometry(image: DngStageImage, centerX: number, centerY: number): { cx: number; cy: number; radius: number } {
  const cx = centerX * image.width, cy = centerY * image.height;
  return { cx, cy, radius: Math.max(Math.hypot(cx, cy), Math.hypot(image.width - cx, cy), Math.hypot(cx, image.height - cy), Math.hypot(image.width - cx, image.height - cy)) };
}

function applyVignette(image: DngStageImage, p: Extract<DngOpcodeParameters, { opcode: "FixVignetteRadial" }>): void {
  const { width, height, planes, data } = image, { cx, cy, radius } = geometry(image, p.centerX, p.centerY), k = p.coefficients;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const r2 = ((col - cx) ** 2 + (row - cy) ** 2) / (radius * radius);
    const gain = 1 + r2 * (k[0] + r2 * (k[1] + r2 * (k[2] + r2 * (k[3] + r2 * k[4]))));
    for (let c = 0; c < planes; c++) { const i = (row * width + col) * planes + c; data[i] = Math.min(Math.max(data[i]! * gain, 0), 1); }
  }
}

/**
 * WarpRectilinear: for destination pixel (x, y), normalized offsets dx = (x − cx)/m, dy = (y − cy)/m, r² = dx² + dy²; the source
 * is the centre plus m·[(dx, dy)·(kr0 + kr1r² + kr2r⁴ + kr3r⁶) + (kt1(r² + 2dx²) + 2kt0·dx·dy, kt0(r² + 2dy²) + 2kt1·dx·dy)],
 * held within the image (SDK `dng_filter_warp`, `EvaluateTangential`). One parameter set applies to every plane, or one per plane.
 */
function warp(image: DngStageImage, p: Extract<DngOpcodeParameters, { opcode: "WarpRectilinear" }>, fast: boolean): Float32Array {
  const { width, height, planes, data } = image, { cx, cy, radius } = geometry(image, p.centerX, p.centerY), out = new Float32Array(data.length);
  const sample = (plane: number, x: number, y: number): number => data[(Math.min(Math.max(y, 0), height - 1) * width + Math.min(Math.max(x, 0), width - 1)) * planes + plane]!;
  for (let plane = 0; plane < planes; plane++) {
    const { radial: [k0, k1, k2, k3], tangential: [t0, t1] } = p.planes[p.planes.length === 1 ? 0 : plane]!;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dx = (x - cx) / radius, dy = (y - cy) / radius, r2 = dx * dx + dy * dy, ratio = k0 + r2 * (k1 + r2 * (k2 + r2 * k3));
      const sx = Math.min(Math.max(cx + radius * (dx * ratio + t1 * (r2 + 2 * dx * dx) + 2 * t0 * dx * dy), 0), width - 1);
      const sy = Math.min(Math.max(cy + radius * (dy * ratio + t0 * (r2 + 2 * dy * dy) + 2 * t1 * dx * dy), 0), height - 1);
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      let value = 0;
      if (fast) value = (sample(plane, ix, iy) * (1 - fx) + sample(plane, ix + 1, iy) * fx) * (1 - fy) + (sample(plane, ix, iy + 1) * (1 - fx) + sample(plane, ix + 1, iy + 1) * fx) * fy;
      else for (let j = -1; j <= 2; j++) { const wy = cubic(j - fy); for (let i = -1; i <= 2; i++) value += wy * cubic(i - fx) * sample(plane, ix + i, iy + j); }
      out[(y * width + x) * planes + plane] = Math.min(Math.max(value, 0), 1);
    }
  }
  return out;
}

/**
 * Bad pixels of a Bayer image (BayerPhase 0 RGGB, 1 GRBG, 2 GBRG, 3 BGGR; green where row + column + phase + ⌊phase/2⌋ is odd) are
 * replaced by the mean of their nearest good same-colour neighbours: green first the four diagonals, then the four at distance 2,
 * then the four at (±2, ±2); red and blue the four at distance 2, then (±2, ±2) (SDK ring order). A pixel with no good neighbour
 * keeps its value. FixBadPixelsConstant marks pixels whose stored code equals the constant (in stage-1 codes, value·65535).
 */
function fixBadPixels(image: DngStageImage, p: Extract<DngOpcodeParameters, { opcode: "FixBadPixelsConstant" | "FixBadPixelsList" }>): void {
  const { width, height, data } = image, bad = new Uint8Array(width * height);
  if (p.opcode === "FixBadPixelsConstant") { for (let i = 0; i < bad.length; i++) if (Math.round(data[i]! * 65535) === p.constant) bad[i] = 1; }
  else {
    for (const [r, c] of p.points) if (r < height && c < width) bad[r * width + c] = 1;
    for (const [t, l, b, r] of p.rects) for (let y = t; y < Math.min(b, height); y++) for (let x = l; x < Math.min(r, width); x++) bad[y * width + x] = 1;
  }
  const rings = [[[-1, 1], [-1, -1], [1, -1], [1, 1]], [[-2, 0], [2, 0], [0, -2], [0, 2]], [[-2, -2], [-2, 2], [2, -2], [2, 2]]] as const;
  const source = data.slice();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!bad[y * width + x]) continue;
    const green = ((y + x + p.bayerPhase + (p.bayerPhase >> 1)) & 1) === 1;
    for (const ring of green ? rings : rings.slice(1)) {
      let total = 0, count = 0;
      for (const [dy, dx] of ring) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < height && xx >= 0 && xx < width && !bad[yy * width + xx]) { total += source[yy * width + xx]!; count++; }
      }
      if (count) { data[y * width + x] = total / count; break; }
    }
  }
}
