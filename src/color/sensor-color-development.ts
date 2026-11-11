// SPDX-License-Identifier: Apache-2.0

/**
 * RAW colour development: turns normalized sensor RGB into linear sRGB, using a declared D65 camera
 * profile. Internal.
 *
 * The caller is responsible for the profile's evidence, for binding it to the CFA (colour filter
 * array) and colour basis, and for applying white balance (WB) only once. Only validated 3×3 matrices
 * are accepted, and their declared determinant and inverse bounds are kept.
 *
 * Development model (`sensor-color-development` 2.0.0). The input c is the normalized camera
 * channels: black level subtracted, divided by the effective white level and clipped at 1 per site,
 * all earlier in the pipeline.
 *
 *   b = highlight(diag(g)·c),   linear sRGB = X · M · diag(w) · b
 *
 * Where:
 * - M is the profile's camera→XYZ matrix and X is the XYZ→linear-sRGB matrix.
 * - w = M⁻¹·XYZ(D65), normalized to green. These are the camera-neutral coordinates of D65
 *   (DNG 1.7 "camera neutral").
 * - The WB gains g map the scene white to equal channel values. diag(w) then maps equal channel values
 *   to D65, for any invertible M. So a grey card lit by the gains' illuminant comes out neutral,
 *   whether or not M is white-normalized.
 * - Without a resolved WB intent, g = 1/w, and development reduces to X·M·c (a D65 scene white).
 * - The camera neutral of the scene white, written to DNG `AsShotNeutral`, is g_green/g.
 * This module does not chromatically adapt the scene, infer calibration, change geometry or write
 * container metadata.
 *
 * Highlight handling (after each site is clipped at the sensor white level):
 * - `clip` (default): every WB-scaled channel is clipped at the smallest gain. That is the level at
 *   which the least-amplified channel saturates, so fully clipped pixels stay neutral. This is the
 *   documented default of dcraw (`-H 0`, "clip all highlights to solid white") and of most raw
 *   converters.
 * - `reconstruct`: a desaturation blend defined by this engine. Let s be the largest normalized
 *   channel. The weight t = clamp((s − 0.8)/0.2, 0, 1) blends the unclipped WB result u toward the
 *   neutral n = max_k min(u_k, g_min): b = (1 − t)·u + t·n. Below 0.8 of white, colour is unchanged
 *   and unclipped; at white it is neutral. This approximation follows the idea of highlight
 *   desaturation (Guo, Cheng & Hu, "Correcting over-exposure in photographs", CVPR 2010). It does not
 *   recover the clipped scene signal.
 * @see docs/PHOTOGRAPHIC_EXPORT.md and docs/NATIVE_RAW_AND_PRINT.md for equations and limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { resolveCaptureColorModel } from "./capture-color.js";

type Matrix = readonly (readonly number[])[];
export const SENSOR_COLOR_DEVELOPMENT_MODEL = /* @__PURE__ */ Object.freeze({ id: "sensor-color-development", version: "2.0.0" } as const);
/** RAW development highlight policy; see the module notes. */
export type RawHighlightMode = "clip" | "reconstruct";
/** Normalized channel level where `reconstruct` starts blending toward neutral. */
export const RAW_HIGHLIGHT_RECONSTRUCTION_START = 0.8;
/** Profiles whose camera neutral is within this relative distance of [1,1,1] are white-normalized. */
const WHITE_NORMALIZED_TOLERANCE = 1e-12;

/** Multiply in declared row order: ((0 + m0·v0) + m1·v1) + m2·v2. */
function multiply(m: Matrix, values: readonly number[]): number[] {
  return m.map((row) => row.reduce((sum, v, i) => sum+v*values[i]!, 0));
}
/** Accepts validated 3×3 matrices only, and keeps their declared determinant and inverse bounds. */
export function invertSensorColorMatrix(m: Matrix): number[][] {
  const [a,b,c,d,e,f,g,h,i]=m.flat() as number[], det=a!*(e!*i!-f!*h!)-b!*(d!*i!-f!*g!)+c!*(d!*h!-e!*g!);
  if (!Number.isFinite(det) || Math.abs(det)<1e-9) throw new InvalidConfigurationError("Export color matrix is singular or outside supported conditioning.");
  const result=[[e!*i!-f!*h!,c!*h!-b!*i!,b!*f!-c!*e!],[f!*g!-d!*i!,a!*i!-c!*g!,c!*d!-a!*f!],[d!*h!-e!*g!,b!*g!-a!*h!,a!*e!-b!*d!]].map((r) => r.map((v) => v/det));
  if (result.flat().some((v) => !Number.isFinite(v) || Math.abs(v)>100)) throw new InvalidConfigurationError("Export inverse color matrix exceeds supported range.");
  return result;
}

/** Camera coordinates of the declared D65 white (not normalized). The caller decides container policy. */
export function sensorColorReferenceWhite(xyzToCamera: Matrix): number[] {
  const white = resolveCaptureColorModel().referenceWhiteXyz;
  return multiply(xyzToCamera, [white.x, 1, white.z]);
}

/** Per-pixel highlight/WB counters accumulated by {@link SensorColorDevelopment.developInto}. */
export interface SensorColorDevelopmentCounts { whiteBalanceClippedSampleCount: number; reconstructedPixelCount: number }

export interface SensorColorDevelopment {
  referenceWhiteXyz: { x: number; y: 1; z: number };
  /** Green-normalized camera-neutral coordinates of D65 (exactly [1,1,1] for white-normalized profiles). */
  cameraNeutralD65: readonly number[];
  /** Applied channel gains: the resolved WB gains, or 1/cameraNeutralD65 when WB is not required. */
  appliedGains: readonly number[];
  /** Green-normalized camera neutral of the assumed scene white: g_green/g (DNG AsShotNeutral). */
  asShotNeutral: readonly number[];
  /** X·M·diag(w) rows, applied as two products in the documented order. */
  cameraToXyz: readonly (readonly number[])[];
  highlightMode: RawHighlightMode;
  /** Develops one normalized camera pixel into out[offset..offset+2] (linear sRGB/D65); updates counts. */
  developInto(c0: number, c1: number, c2: number, out: Float64Array | number[], offset: number, counts: SensorColorDevelopmentCounts): void;
  /**
   * #602: the colour step alone, X·M·diag(w)·b, for white-balanced values b that a whole-image highlight step already formed
   * (`highlightMode: "reconstruct-neighbors"`); the same products and order as the end of developInto.
   */
  developWhiteBalancedInto(b0: number, b1: number, b2: number, out: Float64Array | number[], offset: number): void;
  /** Convenience array form of developInto (counts discarded). */
  develop(values: readonly number[]): number[];
}

/**
 * Internal development of validated, normalized sensor RGB with a declared D65 profile.
 * `gains` is the resolved WB intent, or null when WB is not required. Both the packed native path and
 * the bounded reference path use the returned operator, so there is one implementation.
 */
export function prepareSensorColorDevelopment(cameraChannelsToXyz: Matrix, gains: readonly number[] | null,
  highlightMode: RawHighlightMode = "clip"): SensorColorDevelopment {
  if (highlightMode !== "clip" && highlightMode !== "reconstruct") throw new InvalidConfigurationError("Unsupported RAW highlight mode.");
  const model = resolveCaptureColorModel();
  const raw = sensorColorReferenceWhite(invertSensorColorMatrix(cameraChannelsToXyz));
  if (raw.some((x) => !(x > 0) || !Number.isFinite(x))) throw new InvalidConfigurationError("Reference white requires positive camera coordinates.");
  let neutral = raw.map((x) => x/raw[1]!);
  if (neutral.every((x) => Math.abs(x-1) <= WHITE_NORMALIZED_TOLERANCE)) neutral = [1, 1, 1];
  if (gains && (gains.length !== 3 || gains.some((x) => !(x > 0) || !Number.isFinite(x)))) throw new InvalidConfigurationError("White-balance gains must be positive and finite.");
  const applied = gains ? [...gains] : neutral.map((x) => 1/x);
  const asShot = applied.map((x) => applied[1]!/x), clipLevel = Math.min(...applied);
  const m = cameraChannelsToXyz.map((row) => row.map((v, i) => v*neutral[i]!)), x = model.xyzToCameraRgb;
  const m0 = m[0]!, m1 = m[1]!, m2 = m[2]!, x0 = x[0]!, x1 = x[1]!, x2 = x[2]!;
  const g0 = applied[0]!, g1 = applied[1]!, g2 = applied[2]!, reconstruct = highlightMode === "reconstruct";
  const start = RAW_HIGHLIGHT_RECONSTRUCTION_START;
  function developInto(c0: number, c1: number, c2: number, out: Float64Array | number[], offset: number, counts: SensorColorDevelopmentCounts): void {
    const u0 = c0*g0, u1 = c1*g1, u2 = c2*g2;
    let b0: number, b1: number, b2: number;
    const k0 = u0 > clipLevel ? clipLevel : u0, k1 = u1 > clipLevel ? clipLevel : u1, k2 = u2 > clipLevel ? clipLevel : u2;
    if (!reconstruct) {
      b0 = k0; b1 = k1; b2 = k2;
      counts.whiteBalanceClippedSampleCount += Number(u0 > clipLevel)+Number(u1 > clipLevel)+Number(u2 > clipLevel);
    } else {
      const s = c0 > c1 ? (c0 > c2 ? c0 : c2) : (c1 > c2 ? c1 : c2);
      if (s > start) {
        const t = s >= 1 ? 1 : (s-start)/(1-start), n = k0 > k1 ? (k0 > k2 ? k0 : k2) : (k1 > k2 ? k1 : k2);
        b0 = (1-t)*u0+t*n; b1 = (1-t)*u1+t*n; b2 = (1-t)*u2+t*n; counts.reconstructedPixelCount++;
      } else { b0 = u0; b1 = u1; b2 = u2; }
    }
    const X = ((0+m0[0]!*b0)+m0[1]!*b1)+m0[2]!*b2, Y = ((0+m1[0]!*b0)+m1[1]!*b1)+m1[2]!*b2, Z = ((0+m2[0]!*b0)+m2[1]!*b1)+m2[2]!*b2;
    out[offset] = ((0+x0[0]!*X)+x0[1]!*Y)+x0[2]!*Z;
    out[offset+1] = ((0+x1[0]!*X)+x1[1]!*Y)+x1[2]!*Z;
    out[offset+2] = ((0+x2[0]!*X)+x2[1]!*Y)+x2[2]!*Z;
  }
  function developWhiteBalancedInto(b0: number, b1: number, b2: number, out: Float64Array | number[], offset: number): void {
    const X = ((0+m0[0]!*b0)+m0[1]!*b1)+m0[2]!*b2, Y = ((0+m1[0]!*b0)+m1[1]!*b1)+m1[2]!*b2, Z = ((0+m2[0]!*b0)+m2[1]!*b1)+m2[2]!*b2;
    out[offset] = ((0+x0[0]!*X)+x0[1]!*Y)+x0[2]!*Z;
    out[offset+1] = ((0+x1[0]!*X)+x1[1]!*Y)+x1[2]!*Z;
    out[offset+2] = ((0+x2[0]!*X)+x2[1]!*Y)+x2[2]!*Z;
  }
  return {
    developWhiteBalancedInto, referenceWhiteXyz: model.referenceWhiteXyz, cameraNeutralD65: Object.freeze(neutral), appliedGains: Object.freeze(applied),
    asShotNeutral: Object.freeze(asShot), cameraToXyz: m, highlightMode, developInto,
    develop(values: readonly number[]): number[] {
      const out = [0, 0, 0]; developInto(values[0]!, values[1]!, values[2]!, out, 0, { whiteBalanceClippedSampleCount: 0, reconstructedPixelCount: 0 }); return out;
    }
  };
}
