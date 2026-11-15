// SPDX-License-Identifier: Apache-2.0

/**
 * 2.25.0 (#625, #626): Photivra's own Standard and Flat looks as named constants, and a derived parameter set that pins a
 * look's mid-gray at an application's linear level.
 *
 * Both looks use the `naka-rushton-luminance` tone curve (src/output/sdr-rendering.ts):
 * f(L) = g(L)/g(Lw), g(L) = Lⁿ/(Lⁿ + σⁿ) (Naka & Rushton 1966; Reinhard & Devlin 2005), with contrast n, semi-saturation σ
 * and white luminance Lw. The published σ values are the ones for which f(0.18) = 0.18 (18 % linear gray is unchanged).
 *
 * Pinning: with s = σⁿ, f(m) = (1 + s·Lw⁻ⁿ)/(1 + s·m⁻ⁿ), which falls strictly as s grows (its derivative in s has the sign of
 * Lw⁻ⁿ − m⁻ⁿ < 0 for m < Lw). So f(m) = t has the single solution s = (1 − t)/(t·m⁻ⁿ − Lw⁻ⁿ), in closed form, whenever
 * 0 < t < 1 and t·m⁻ⁿ > Lw⁻ⁿ. The contrast n and white luminance Lw are kept; only σ changes. These are the engine's own
 * looks, not a camera maker's.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/** A look: the `naka-rushton-luminance` tone curve with its parameters, ready to spread into a rendering or `output` options. */
export interface NakaRushtonLook {
  readonly toneCurve: "naka-rushton-luminance";
  readonly toneCurveParameters: { readonly exponent: number; readonly semiSaturation: number; readonly whiteLuminance: number };
}

/** Photivra's Standard look: contrast 1.5, white at 8× mid-gray luminance; 18 % linear gray stays at 0.18. */
export const STANDARD_LOOK: NakaRushtonLook = /* @__PURE__ */ Object.freeze({ toneCurve: "naka-rushton-luminance" as const,
  toneCurveParameters: Object.freeze({ exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 }) });

/** Photivra's Flat look: contrast 1, white at 32; 18 % linear gray stays at 0.18. */
export const FLAT_LOOK: NakaRushtonLook = /* @__PURE__ */ Object.freeze({ toneCurve: "naka-rushton-luminance" as const,
  toneCurveParameters: Object.freeze({ exponent: 1, semiSaturation: 0.8465, whiteLuminance: 32 }) });

/** Where to pin the look's mid-gray. */
export interface PinLookMidGrayOptions {
  /** The linear relative luminance at which the application's exposure develops a mid-gray (18 %) chart, for example 0.13. */
  linearMidGray: number;
  /** The tone-mapped linear level that mid-gray should come out at; default `linearMidGray` (the same as a linear look). */
  outputLevel?: number;
}

/**
 * Derives a look whose tone curve maps `linearMidGray` to `outputLevel` (default: to itself), keeping its contrast and white
 * luminance and solving its semi-saturation in closed form (module comment). `pinLookMidGray(STANDARD_LOOK, { linearMidGray: 0.18 })`
 * gives the Standard look's own σ to within its four published decimals.
 * @throws InvalidConfigurationError when the look or a level is invalid, or no semi-saturation in (0, 64] (the renderer's range) gives the level.
 */
export function pinLookMidGray(look: NakaRushtonLook, options: PinLookMidGrayOptions): NakaRushtonLook {
  const fail = (message: string): never => { throw new InvalidConfigurationError("pinLookMidGray: " + message); };
  if (look === null || typeof look !== "object" || look.toneCurve !== "naka-rushton-luminance" || look.toneCurveParameters === null || typeof look.toneCurveParameters !== "object") {
    fail("look must be a naka-rushton-luminance look (for example STANDARD_LOOK).");
  }
  const { exponent: n, whiteLuminance: white } = look.toneCurveParameters;
  if (typeof n !== "number" || !(n >= .25 && n <= 4)) fail("the look's exponent must be from 0.25 to 4.");
  if (typeof white !== "number" || !(white > 0 && white <= 65536)) fail("the look's whiteLuminance must be in (0, 65536].");
  if (options === null || typeof options !== "object") fail("options must be { linearMidGray, outputLevel? }.");
  for (const key of Object.keys(options)) if (key !== "linearMidGray" && key !== "outputLevel") fail("unknown option " + JSON.stringify(key) + ".");
  const m = options.linearMidGray, t = options.outputLevel ?? m;
  if (typeof m !== "number" || !(m > 0 && m < white)) fail("linearMidGray must be a number in (0, whiteLuminance).");
  if (typeof t !== "number" || !(t > 0 && t < 1)) fail("outputLevel must be a number in (0, 1).");
  const denominator = t*m**-n - white**-n;
  if (!(denominator > 0)) fail("no semi-saturation maps " + m + " to " + t + " with this exponent and white luminance.");
  const sigma = ((1-t)/denominator)**(1/n);
  if (!Number.isFinite(sigma) || !(sigma > 0 && sigma <= 64)) fail("the semi-saturation that maps " + m + " to " + t + " is outside (0, 64].");
  return Object.freeze({ toneCurve: "naka-rushton-luminance" as const, toneCurveParameters: Object.freeze({ exponent: n, semiSaturation: sigma, whiteLuminance: white }) });
}
