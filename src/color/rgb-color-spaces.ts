// SPDX-License-Identifier: Apache-2.0

/**
 * Wide-gamut output primitives (standalone; output wiring belongs to the SDR/export stages):
 * - RGB ↔ XYZ matrices derived numerically from primary and white chromaticities: RGB (1, 1, 1)
 *   is the white (W3C CSS Color 4 §2, free), never copied matrices. They equal the CSS Color 4
 *   sample-code matrices to about 1e-15 (test/colorimetry-output-and-camera.test.ts).
 *   sRGB / BT.709: ITU-R BT.709-6 and W3C CSS Color 4 `srgb` (also IEC 61966-2-1:1999); Display P3:
 *   P3 primaries with D65 white as specified for `display-p3` in W3C CSS Color 4 (also SMPTE EG 432-1:2010);
 *   BT.2020: ITU-R BT.2020-2. All use D65 (0.3127, 0.3290).
 * - Transfer functions: sRGB (W3C CSS Color 4; also IEC 61966-2-1; also Display P3), BT.709 OETF, BT.1886 EOTF
 *   (ITU-R BT.1886). The BT.2100 PQ and HLG transfer functions are not part of 2.0 (owner decision,
 *   2026-10-17: their patent holders offer only licence-on-request declarations; see THIRD_PARTY.md).
 * Constants are the published values of those standards.
 * @see docs/COLORIMETRY.md for equations, coordinate/unit conventions and limits.
 */

import { calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { decodeSrgbComponent, encodeSrgbComponent } from "./srgb-transfer.js";
import { COLORIMETRY_MODEL_VERSION } from "./color-matching-functions.js";
import {
  copyMatrix,
  invertMatrix3x3,
  multiplyMatrixVector,
  parseChromaticity,
  requireFiniteNumber,
  requireFiniteResult,
  requireNonNegativeNumber,
  requirePositiveNumber,
  requireRecordValue,
  xyzOfChromaticity,
  type CieXyChromaticity,
  type CieXyzTristimulus,
  type ColorMatrix3x3
} from "./colorimetry-math.js";
import { rejectUnknownFields, requireInputKeys } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

/** RGB primaries as CIE 1931 xy chromaticities. */
export interface RgbPrimaryChromaticities {
  red: CieXyChromaticity;
  green: CieXyChromaticity;
  blue: CieXyChromaticity;
}

export interface RgbToXyzMatrices {
  /** Linear RGB (white = 1, 1, 1) → XYZ with white Y = 1. */
  rgbToXyz: ColorMatrix3x3;
  xyzToRgb: ColorMatrix3x3;
  whiteXyz: CieXyzTristimulus;
}

/** Internal: derivation from primaries and white (see {@link calculateRgbToXyzMatrices}) without an envelope. */
export function rgbToXyzMatrices(primaries: RgbPrimaryChromaticities, white: CieXyChromaticity): RgbToXyzMatrices {
  const p = requireRecordValue(primaries, "primaries");
  rejectUnknownFields(p, ["red", "green", "blue"], "primaries");
  const columns = (["red", "green", "blue"] as const).map((k) => xyzOfChromaticity(parseChromaticity(p[k], "primaries." + k)));
  const basis: ColorMatrix3x3 = [
    [columns[0]!.x, columns[1]!.x, columns[2]!.x],
    [columns[0]!.y, columns[1]!.y, columns[2]!.y],
    [columns[0]!.z, columns[1]!.z, columns[2]!.z]
  ];
  const whiteXyz = xyzOfChromaticity(parseChromaticity(white, "whiteChromaticity"));
  const s = multiplyMatrixVector(invertMatrix3x3(basis, "primary matrix"), [whiteXyz.x, whiteXyz.y, whiteXyz.z]);
  if (s.some((v) => !(v > 0))) throw new InvalidScientificInputError("The white point must lie strictly inside the primary triangle.");
  const rgbToXyz = basis.map((row) => row.map((v, i) => v * s[i]!)) as unknown as ColorMatrix3x3;
  return { rgbToXyz, xyzToRgb: invertMatrix3x3(rgbToXyz, "rgbToXyz"), whiteXyz };
}

/**
 * Derives RGB ↔ XYZ matrices from primaries and white chromaticity: columns are the primaries'
 * XYZ (Y = 1) scaled so that RGB (1, 1, 1) maps to the white (W3C CSS Color 4, free; also SMPTE
 * RP 177). The derivation is written out in docs/COLORIMETRY.md.
 */
export function calculateRgbToXyzMatrices(input: { primaries: RgbPrimaryChromaticities; whiteChromaticity: CieXyChromaticity }): CalculationResult<RgbToXyzMatrices> {
  requireInputKeys(input, "calculateRgbToXyzMatrices", ["primaries", "whiteChromaticity"]);
  const value = rgbToXyzMatrices(input.primaries, input.whiteChromaticity);
  requireFiniteResult([...value.rgbToXyz.flat(), ...value.xyzToRgb.flat()], "RGB matrix derivation");
  return calculatedResult(value, "rgb-xyz-matrix-smpte-rp177", COLORIMETRY_MODEL_VERSION);
}

export type RgbColorSpaceId = "srgb" | "display-p3" | "rec709" | "rec2020";
export type RgbTransferFunctionId = "srgb" | "bt709-oetf-bt1886-eotf" | "bt2020-oetf";

export interface RgbColorSpaceDefinition extends RgbToXyzMatrices {
  id: RgbColorSpaceId;
  primaries: RgbPrimaryChromaticities;
  whiteChromaticity: CieXyChromaticity;
  /** Conventional non-linear (SDR) encoding of this space. */
  transferFunction: RgbTransferFunctionId;
  sources: readonly string[];
}

const D65_CHROMATICITY: CieXyChromaticity = /* @__PURE__ */ Object.freeze({ x: 0.3127, y: 0.3290 });
const BT709_PRIMARIES: RgbPrimaryChromaticities = { red: { x: 0.64, y: 0.33 }, green: { x: 0.30, y: 0.60 }, blue: { x: 0.15, y: 0.06 } };
const SPACES: Readonly<Record<RgbColorSpaceId, { primaries: RgbPrimaryChromaticities; transferFunction: RgbTransferFunctionId; sources: readonly string[] }>> = {
  srgb: { primaries: BT709_PRIMARIES, transferFunction: "srgb", sources: ["W3C CSS Color Module Level 4 srgb", "ITU-R BT.709-6"] },
  rec709: { primaries: BT709_PRIMARIES, transferFunction: "bt709-oetf-bt1886-eotf", sources: ["ITU-R BT.709-6", "ITU-R BT.1886"] },
  "display-p3": {
    primaries: { red: { x: 0.680, y: 0.320 }, green: { x: 0.265, y: 0.690 }, blue: { x: 0.150, y: 0.060 } },
    transferFunction: "srgb", sources: ["W3C CSS Color Module Level 4 display-p3 (P3 primaries, D65, sRGB transfer)", "ITU-T H.273 ColourPrimaries 12"]
  },
  rec2020: {
    primaries: { red: { x: 0.708, y: 0.292 }, green: { x: 0.170, y: 0.797 }, blue: { x: 0.131, y: 0.046 } },
    transferFunction: "bt2020-oetf", sources: ["ITU-R BT.2020-2"]
  }
};

/** Resolves a named RGB colour space with numerically derived matrices (all D65). */
export function resolveRgbColorSpace(id: RgbColorSpaceId): CalculationResult<RgbColorSpaceDefinition> {
  const space = typeof id === "string" && Object.hasOwn(SPACES, id) ? SPACES[id] : undefined;
  if (space === undefined) throw new InvalidConfigurationError("Unknown RGB colour space.");
  const matrices = rgbToXyzMatrices(space.primaries, D65_CHROMATICITY);
  const value: RgbColorSpaceDefinition = {
    id, primaries: JSON.parse(JSON.stringify(space.primaries)) as RgbPrimaryChromaticities, whiteChromaticity: { ...D65_CHROMATICITY },
    transferFunction: space.transferFunction, sources: [...space.sources],
    rgbToXyz: copyMatrix(matrices.rgbToXyz), xyzToRgb: copyMatrix(matrices.xyzToRgb), whiteXyz: matrices.whiteXyz
  };
  return calculatedResult(value, "rgb-color-space-" + id, COLORIMETRY_MODEL_VERSION, ["Matrices derived from primaries and D65 white so that RGB (1, 1, 1) is the white (W3C CSS Color 4)"]);
}

// ---------------------------------------------------------------- transfers

/** sRGB / Display P3 encoding (W3C CSS Color 4; also IEC 61966-2-1) of one linear component; negative values use the linear segment. */
export function evaluateSrgbEncoding(linear: number): number {
  return encodeSrgbComponent(requireFiniteNumber(linear, "linear"));
}

/** sRGB / Display P3 decoding of one non-linear component. */
export function evaluateSrgbDecoding(encoded: number): number {
  // foundation-10: a component beyond about 1e123 decodes to Infinity, which is refused.
  const linear = decodeSrgbComponent(requireFiniteNumber(encoded, "encoded"));
  requireFiniteResult([linear], "evaluateSrgbDecoding");
  return linear;
}

/**
 * ITU-R BT.709-6 / BT.2020-2 (10-bit) OETF: V = 4.5 L for L < 0.018, otherwise
 * 1.099 L^0.45 − 0.099. Scene-referred camera encoding, not a display EOTF.
 */
export function evaluateBt709Oetf(sceneLinear: number): number {
  const l = requireFiniteNumber(sceneLinear, "sceneLinear");
  return l < 0.018 ? 4.5 * l : 1.099 * l ** 0.45 - 0.099;
}

/** Inverse of the BT.709 OETF: L = V/4.5 for V < 0.081, otherwise ((V + 0.099)/1.099)^(1/0.45). */
export function evaluateBt709InverseOetf(encoded: number): number {
  const v = requireFiniteNumber(encoded, "encoded");
  return v < 4.5 * 0.018 ? v / 4.5 : ((v + 0.099) / 1.099) ** (1 / 0.45);
}

export interface Bt1886Eotf {
  whiteLuminanceCdPerSquareMeter: number;
  blackLuminanceCdPerSquareMeter: number;
  /** a = (Lw^(1/γ) − Lb^(1/γ))^γ */
  a: number;
  /** b = Lb^(1/γ) / (Lw^(1/γ) − Lb^(1/γ)) */
  b: number;
  /** L = a · max(V + b, 0)^2.4 in cd/m². */
  decode(signal: number): number;
  /** Inverse: V = (L/a)^(1/2.4) − b. */
  encode(luminanceCdPerSquareMeter: number): number;
}

/** Prepares the ITU-R BT.1886 reference EOTF (γ = 2.4) for a display's white and black luminance. */
export function prepareBt1886Eotf(input: { whiteLuminanceCdPerSquareMeter: number; blackLuminanceCdPerSquareMeter: number }): Bt1886Eotf {
  requireInputKeys(input, "prepareBt1886Eotf", ["whiteLuminanceCdPerSquareMeter", "blackLuminanceCdPerSquareMeter"]);
  const lw = requirePositiveNumber(input.whiteLuminanceCdPerSquareMeter, "whiteLuminanceCdPerSquareMeter");
  const lb = requireNonNegativeNumber(input.blackLuminanceCdPerSquareMeter, "blackLuminanceCdPerSquareMeter");
  if (!(lb < lw)) throw new InvalidScientificInputError("blackLuminanceCdPerSquareMeter must be below the white luminance.");
  const g = 2.4, root = lw ** (1 / g) - lb ** (1 / g);
  const a = root ** g, b = lb ** (1 / g) / root;
  return Object.freeze({
    whiteLuminanceCdPerSquareMeter: lw, blackLuminanceCdPerSquareMeter: lb, a, b,
    decode: (signal: number) => {
      const luminance = a * Math.max(requireFiniteNumber(signal, "signal") + b, 0) ** g;
      requireFiniteResult([luminance], "BT.1886 decode");
      return luminance;
    },
    encode: (luminance: number) => (requireNonNegativeNumber(luminance, "luminanceCdPerSquareMeter") / a) ** (1 / g) - b
  });
}
