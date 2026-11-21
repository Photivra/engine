// SPDX-License-Identifier: Apache-2.0

/**
 * Perceptual gamut mapping into a bounded linear RGB cube [0, 1]³ by hue- and
 * lightness-preserving chroma reduction toward the neutral axis in CIE LCh(ab).
 *
 * Method, for each colour:
 * 1. Keep L* and h_ab fixed.
 * 2. Find the chroma at the gamut boundary, C_max(L*, h), by bisection.
 * 3. Compress chroma above a knee k·C_max smoothly:
 *    C′ = kC_max + (1 − k)C_max·tanh((C − kC_max)/((1 − k)C_max)).
 *    This is continuous and monotone and never reaches C_max. k = 1 means hard clipping to the
 *    boundary at constant (L*, h) ("chroma clipping").
 *
 * Sources: the binary-search chroma reduction in W3C CSS Color Module Level 4 §14, which uses OKLCh;
 * also the constant-lightness, constant-hue chroma reduction methods surveyed by Morovič (2008),
 * Color Gamut Mapping (Wiley), §10. This independent implementation uses CIELAB, to avoid extra
 * third-party matrices.
 *
 * Limits: CIELAB hue is not perceptually constant for saturated blues, so blues can shift toward
 * purple. Lightness outside [0, 100] is clipped to black or white. The result only approximates
 * perceptual preservation.
 *
 * Input XYZ must be relative to the target space's D65 white, with white Y = 1.
 * @see docs/COLORIMETRY.md for equations, coordinate/unit conventions and limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { COLORIMETRY_MODEL_VERSION } from "./color-matching-functions.js";
import { cielabOfXyz, xyzOfCielab } from "./color-difference.js";
import {
  multiplyMatrixVector,
  parseXyz,
  requireNonNegativeNumber,
  vectorToXyz,
  xyzToVector,
  type CieXyzTristimulus,
  type ColorVector3
} from "./colorimetry-math.js";
import { resolveRgbColorSpace, type RgbColorSpaceId } from "./rgb-color-spaces.js";
import { requireInputKeys } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export type GamutMappingMethod = "cielab-hue-preserving-chroma-compression";

export interface PrepareRgbGamutMappingInput {
  colorSpace: RgbColorSpaceId;
  method: GamutMappingMethod;
  /** Fraction of the boundary chroma left untouched, in [0, 1]. 1 means clip to the boundary. */
  kneeFraction: number;
}

export interface GamutMappedColor {
  /** Linear RGB in the target space, each component in [0, 1]. */
  linearRgb: ColorVector3;
  /** True when lightness or chroma was changed. */
  adjusted: boolean;
  /** Lightness was outside [0, 100] and was clipped to black or white. */
  lightnessClipped: boolean;
}

export interface PreparedRgbGamutMapping {
  colorSpace: RgbColorSpaceId;
  kneeFraction: number;
  /** Maps one XYZ colour (D65-relative, white Y = 1). */
  map(xyz: ColorVector3): GamutMappedColor;
}

const IN_GAMUT_TOLERANCE = 1e-12;
const BISECTION_STEPS = 60;
/** #684: the early-out below the knee applies below this L* (see `map`). */
const EARLY_OUT_MAXIMUM_LIGHTNESS = 85;

function inCube(rgb: ColorVector3): boolean {
  return rgb.every((v) => v >= -IN_GAMUT_TOLERANCE && v <= 1 + IN_GAMUT_TOLERANCE);
}

function clampCube(rgb: ColorVector3): ColorVector3 {
  return rgb.map((v) => Math.min(1, Math.max(0, v))) as unknown as ColorVector3;
}

/** Validates the target space once and returns a reusable per-colour mapper. */
export function prepareRgbGamutMapping(input: PrepareRgbGamutMappingInput): PreparedRgbGamutMapping {
  requireInputKeys(input, "prepareRgbGamutMapping", ["colorSpace", "method", "kneeFraction"]);
  if (input.method !== "cielab-hue-preserving-chroma-compression") throw new InvalidConfigurationError("method is not supported.");
  const k = requireNonNegativeNumber(input.kneeFraction, "kneeFraction");
  if (k > 1) throw new InvalidScientificInputError("kneeFraction must lie in [0, 1].");
  const space = resolveRgbColorSpace(input.colorSpace).value;
  const white = space.whiteXyz;
  const toRgb = (lStar: number, a: number, b: number): ColorVector3 =>
    multiplyMatrixVector(space.xyzToRgb, xyzToVector(xyzOfCielab({ lStar, aStar: a, bStar: b }, white)));
  return Object.freeze({
    colorSpace: space.id,
    kneeFraction: k,
    map(xyzInput: ColorVector3): GamutMappedColor {
      const xyz: CieXyzTristimulus = parseXyz(vectorToXyz(xyzInput), "xyz");
      const rgb = multiplyMatrixVector(space.xyzToRgb, xyzInput);
      const lab = cielabOfXyz(xyz, white);
      if (!(lab.lStar > 0)) return { linearRgb: [0, 0, 0], adjusted: !rgb.every((v) => v === 0), lightnessClipped: true };
      if (lab.lStar >= 100) {
        return { linearRgb: [1, 1, 1], adjusted: !rgb.every((v) => Math.abs(v - 1) <= IN_GAMUT_TOLERANCE), lightnessClipped: lab.lStar > 100 };
      }
      const chroma = Math.hypot(lab.aStar, lab.bStar);
      const inside = inCube(rgb);
      if (chroma === 0 || (inside && k === 1)) return { linearRgb: clampCube(rgb), adjusted: false, lightnessClipped: false };
      const ua = lab.aStar / chroma, ub = lab.bStar / chroma;
      // #684: an in-gamut colour whose ray is inside the cube a little beyond chroma / k lies below the knee, which the search
      // below finds only after its 56–59 boundary evaluations; it is returned unchanged, as the search returns it. Exact where the
      // ray's in-cube part is one interval from the neutral axis (then the search never moves its outer end below the probe, so
      // C_max > chroma / k): measured below L* = EARLY_OUT_MAXIMUM_LIGHTNESS for the three spaces (test/gamut-mapping-early-out.test.ts),
      // not near the yellow cusp. The chroma floor keeps the probe's margin above the search's resolution (C_max ≤ 600 / 2^60).
      if (inside && k > 0 && lab.lStar < EARLY_OUT_MAXIMUM_LIGHTNESS && chroma > 1e-6) {
        const probe = chroma / k * (1 + 1e-9);
        if (inCube(toRgb(lab.lStar, ua * probe, ub * probe))) return { linearRgb: clampCube(rgb), adjusted: false, lightnessClipped: false };
      }
      // Find the boundary chroma at constant L* and h by bisection. The neutral point is inside the cube.
      let lo = 0, hi = chroma;
      if (inside) {
        hi = Math.max(chroma, 1);
        while (inCube(toRgb(lab.lStar, ua * hi, ub * hi)) && hi < 1e4) hi *= 2;
      }
      for (let i = 0; i < BISECTION_STEPS; i++) {
        const mid = (lo + hi) / 2;
        if (inCube(toRgb(lab.lStar, ua * mid, ub * mid))) lo = mid; else hi = mid;
      }
      const cMax = lo;
      const knee = k * cMax;
      let mapped = chroma;
      if (chroma > knee) {
        mapped = k === 1 || cMax === 0 ? cMax : knee + (1 - k) * cMax * Math.tanh((chroma - knee) / ((1 - k) * cMax));
        mapped = Math.min(mapped, cMax);
      }
      if (mapped === chroma && inside) return { linearRgb: clampCube(rgb), adjusted: false, lightnessClipped: false };
      return { linearRgb: clampCube(toRgb(lab.lStar, ua * mapped, ub * mapped)), adjusted: true, lightnessClipped: false };
    }
  });
}

/** Maps one D65-relative XYZ colour into a target RGB gamut (see module notes). */
export function calculateGamutMappedColor(input: PrepareRgbGamutMappingInput & { xyz: CieXyzTristimulus }): CalculationResult<GamutMappedColor> {
  requireInputKeys(input, "calculateGamutMappedColor", ["colorSpace", "method", "kneeFraction", "xyz"]);
  const xyz = parseXyz(input.xyz, "xyz");
  const value = prepareRgbGamutMapping({ colorSpace: input.colorSpace, method: input.method, kneeFraction: input.kneeFraction }).map(xyzToVector(xyz));
  return approximationResult(value, "gamut-mapping-cielab-chroma-compression", COLORIMETRY_MODEL_VERSION, [
    "Constant CIELAB L* and hue; chroma reduced toward the neutral axis with a tanh knee",
    "CIELAB hue is not perceptually constant for saturated blues; lightness outside [0, 100] is clipped"
  ]);
}
