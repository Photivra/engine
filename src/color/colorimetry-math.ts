// SPDX-License-Identifier: Apache-2.0

/**
 * Shared colorimetric value types (CIE XYZ tristimulus, xy chromaticity, 3×3
 * row-major matrices) and exact linear-algebra helpers used by the colorimetry
 * modules. Pure mathematics; no colour-science constants live here.
 * @see docs/COLORIMETRY.md for equations, coordinate/unit conventions and limits.
 */

import { InvalidScientificInputError, InvalidScientificResultError } from "../core/validation.js";
import { rejectUnknownFields, requireConfigRecord } from "../core/record-validation.js";

/** Three-component vector (dimensionless unless documented otherwise). */
export type ColorVector3 = readonly [number, number, number];
/** Row-major 3×3 matrix; `m[row][column]`. Applied as `m · v` to column vectors. */
export type ColorMatrix3x3 = readonly [ColorVector3, ColorVector3, ColorVector3];

/**
 * Relative CIE XYZ tristimulus values. Units are relative (dimensionless);
 * a normalized white has `y = 1` unless a function documents another scale.
 */
export interface CieXyzTristimulus {
  x: number;
  y: number;
  z: number;
}

/** CIE 1931 (x, y) chromaticity coordinates (dimensionless). */
export interface CieXyChromaticity {
  x: number;
  y: number;
}

/** CIE 1960 UCS (u, v) chromaticity coordinates (dimensionless). */
export interface Cie1960UvChromaticity {
  u: number;
  v: number;
}

export function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidScientificInputError(path + " must be a finite number.");
  }
  return value;
}

export function requirePositiveNumber(value: unknown, path: string): number {
  const n = requireFiniteNumber(value, path);
  if (n <= 0) throw new InvalidScientificInputError(path + " must be greater than zero.");
  return n;
}

export function requireNonNegativeNumber(value: unknown, path: string): number {
  const n = requireFiniteNumber(value, path);
  if (n < 0) throw new InvalidScientificInputError(path + " must not be negative.");
  return n;
}

/** `<path> must be an object.` (the shared record check). */
export const requireRecordValue = (value: unknown, path: string): Record<string, unknown> => requireConfigRecord(value, path, null);

const XYZ_FIELDS: readonly string[] = /* @__PURE__ */ Object.freeze(["x", "y", "z"]);
const CHROMATICITY_FIELDS: readonly string[] = /* @__PURE__ */ Object.freeze(["x", "y"]);

/** Parses an XYZ tristimulus record with exactly the fields x, y and z; any other field is rejected. */
export function parseXyz(value: unknown, path: string): CieXyzTristimulus {
  const r = requireRecordValue(value, path);
  rejectUnknownFields(r, XYZ_FIELDS, path);
  return { x: requireFiniteNumber(r.x, path + ".x"), y: requireFiniteNumber(r.y, path + ".y"), z: requireFiniteNumber(r.z, path + ".z") };
}

/** Parses a white point: finite, non-negative components with Y > 0; fields other than x, y, z are rejected. */
export function parseWhiteXyz(value: unknown, path: string): CieXyzTristimulus {
  const r = requireRecordValue(value, path);
  rejectUnknownFields(r, XYZ_FIELDS, path);
  return { x: requireNonNegativeNumber(r.x, path + ".x"), y: requirePositiveNumber(r.y, path + ".y"), z: requireNonNegativeNumber(r.z, path + ".z") };
}

/** Parses a CIE 1931 xy chromaticity with exactly the fields x and y, inside the spectrum-locus triangle bound. */
export function parseChromaticity(value: unknown, path: string): CieXyChromaticity {
  const r = requireRecordValue(value, path);
  rejectUnknownFields(r, CHROMATICITY_FIELDS, path);
  const x = requireFiniteNumber(r.x, path + ".x");
  const y = requireFiniteNumber(r.y, path + ".y");
  if (x < 0 || y <= 0 || x + y > 1) {
    throw new InvalidScientificInputError(path + " must satisfy x >= 0, y > 0 and x + y <= 1.");
  }
  return { x, y };
}

export function parseMatrix3x3(value: unknown, path: string): ColorMatrix3x3 {
  if (!Array.isArray(value) || value.length !== 3) throw new InvalidScientificInputError(path + " must be a 3×3 row-major matrix.");
  return value.map((row: unknown, i) => {
    if (!Array.isArray(row) || row.length !== 3) throw new InvalidScientificInputError(path + " must be a 3×3 row-major matrix.");
    return row.map((v: unknown, j) => requireFiniteNumber(v, path + "[" + i + "][" + j + "]"));
  }) as unknown as ColorMatrix3x3;
}

export function multiplyMatrixVector(m: ColorMatrix3x3, v: ColorVector3): ColorVector3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ];
}

export function multiplyMatrices(a: ColorMatrix3x3, b: ColorMatrix3x3): ColorMatrix3x3 {
  const row = (i: 0 | 1 | 2): ColorVector3 => [
    a[i][0] * b[0][0] + a[i][1] * b[1][0] + a[i][2] * b[2][0],
    a[i][0] * b[0][1] + a[i][1] * b[1][1] + a[i][2] * b[2][1],
    a[i][0] * b[0][2] + a[i][1] * b[1][2] + a[i][2] * b[2][2]
  ];
  return [row(0), row(1), row(2)];
}

export function determinant3x3(m: ColorMatrix3x3): number {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** Exact cofactor inverse. Throws (fails closed) on a singular or non-finite result. */
export function invertMatrix3x3(m: ColorMatrix3x3, path = "matrix"): ColorMatrix3x3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = determinant3x3(m);
  const scale = Math.max(...m.flat().map(Math.abs));
  if (!Number.isFinite(det) || scale === 0 || Math.abs(det) <= 1e-12 * scale ** 3) {
    throw new InvalidScientificInputError(path + " is singular or numerically ill-conditioned.");
  }
  const inv: ColorMatrix3x3 = [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]
  ];
  if (inv.flat().some((v) => !Number.isFinite(v))) throw new InvalidScientificResultError(path + " inverse is not finite.");
  return inv;
}

export function diagonalMatrix(v: ColorVector3): ColorMatrix3x3 {
  return [[v[0], 0, 0], [0, v[1], 0], [0, 0, v[2]]];
}

export function xyzToVector(xyz: CieXyzTristimulus): ColorVector3 {
  return [xyz.x, xyz.y, xyz.z];
}

export function vectorToXyz(v: ColorVector3): CieXyzTristimulus {
  return { x: v[0], y: v[1], z: v[2] };
}

export function copyMatrix(m: ColorMatrix3x3): ColorMatrix3x3 {
  return [[...m[0]], [...m[1]], [...m[2]]] as unknown as ColorMatrix3x3;
}

export function requireFiniteResult(values: readonly number[], what: string): void {
  if (values.some((v) => !Number.isFinite(v))) throw new InvalidScientificResultError(what + " produced a non-finite value.");
}

/** XYZ → xy; requires X + Y + Z > 0. */
export function chromaticityOfXyz(xyz: CieXyzTristimulus): CieXyChromaticity {
  const sum = xyz.x + xyz.y + xyz.z;
  if (!(sum > 0) || !Number.isFinite(sum)) throw new InvalidScientificInputError("Chromaticity requires X + Y + Z > 0.");
  return { x: xyz.x / sum, y: xyz.y / sum };
}

/** xy with luminance Y → XYZ (CIE 15 Eq. 7.3 inverse). */
export function xyzOfChromaticity(xy: CieXyChromaticity, luminanceY = 1): CieXyzTristimulus {
  if (!(xy.y > 0)) throw new InvalidScientificInputError("Chromaticity y must be greater than zero.");
  return { x: (xy.x / xy.y) * luminanceY, y: luminanceY, z: ((1 - xy.x - xy.y) / xy.y) * luminanceY };
}

/** CIE 1931 xy → CIE 1960 UCS uv: u = 4x/(−2x+12y+3), v = 6y/(−2x+12y+3). */
export function uvOfChromaticity(xy: CieXyChromaticity): Cie1960UvChromaticity {
  const d = -2 * xy.x + 12 * xy.y + 3;
  return { u: (4 * xy.x) / d, v: (6 * xy.y) / d };
}

/** CIE 1960 UCS uv → CIE 1931 xy: x = 3u/(2u−8v+4), y = 2v/(2u−8v+4). */
export function chromaticityOfUv(uv: Cie1960UvChromaticity): CieXyChromaticity {
  const d = 2 * uv.u - 8 * uv.v + 4;
  return { x: (3 * uv.u) / d, y: (2 * uv.v) / d };
}
