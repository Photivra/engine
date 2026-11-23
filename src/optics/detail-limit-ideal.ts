// SPDX-License-Identifier: Apache-2.0

/**
 * The detail limit's arithmetic and its ideal-lens branch (#765, 2.29.0): everything of `calculateDetailLimit` except the catalogue
 * lens, so `calculateIdealLensDetailLimit` bundles without the lens catalogue. `detail-limit.ts` adds the catalogue branch and
 * calls the same code, so both functions return the same result for an ideal lens. The model, its sources and its limits are
 * described in `detail-limit.ts`.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError, requirePositiveFinite, requirePositiveInteger } from "../core/validation.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import type { CalculateDetailLimitInput, DetailLimit, DetailLimitedBy, DetailLimitIdealLens, DetailLimitingFactor } from "./detail-limit.js";

/** Version of the `detail-limit` model. */
const DETAIL_LIMIT_MODEL_VERSION = "1.0.0" as const;

/**
 * Limits of `calculateDetailLimit`: the wavelength range and the largest wavefront (sum of the magnitudes of its terms, in
 * waves) whose transfer function is integrated. Beyond it the blur is geometric and the quadrature would grow without
 * bound; use `calculateDefocusCircle` for such a blur.
 */
export const DETAIL_LIMIT_LIMITS = /* @__PURE__ */ Object.freeze({ minimumWavelengthNm: 380, maximumWavelengthNm: 780, maximumWavefrontWaves: 64 });

/** The Maréchal criterion: RMS wavefront error λ/14 (Strehl ratio ≈ 0.8), below which a lens counts as diffraction-limited. */
const MARECHAL_RMS_WAVES = 1 / 14;

const BASIS: DetailLimit["basis"] = /* @__PURE__ */ Object.freeze({
  optics: Object.freeze({ kind: "exact", statement: "Scalar incoherent OTF of a circular pupil carrying the stated wavefront at one wavelength " +
    "(numerical quadrature, converged to about 1e-9). The wavefront itself is exact for lens.ideal (none) and an approximation for lens.catalogue." }),
  sampling: Object.freeze({ kind: "exact", statement: "Nyquist frequencies of the pixel lattice and of a Bayer filter's color lattices; pixel aperture " +
    "MTF of an ideal square site with fill factor 1 (an idealisation: no microlens, crosstalk or optical low-pass filter)." }),
  system: Object.freeze({ kind: "approximation", statement: "Optics MTF × pixel aperture MTF. Demosaicing, sharpening, noise, motion and aliasing are excluded." }),
  limitedBy: Object.freeze({ kind: "approximation", statement: "The sensor limits when the optics MTF50 reaches the Nyquist frequency 1/(2p); otherwise " +
    "the lens, through diffraction when the RMS wavefront error is within λ/14 (Maréchal), else aberrations or defocus, whichever RMS is larger." })
});

/** Gauss–Legendre nodes and weights on [0, 1] (Golub–Welsch by Newton on the Legendre recurrence), cached by count. */
const GL_CACHE = new Map<number, { x: Float64Array; w: Float64Array }>();
function gaussLegendreUnit(n: number): { x: Float64Array; w: Float64Array } {
  let rule = GL_CACHE.get(n);
  if (rule) return rule;
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      const pn = n === 1 ? z : p1, pm = n === 1 ? 1 : p0;
      dp = n * (z * pn - pm) / (z * z - 1);
      const step = pn / dp;
      z -= step;
      if (Math.abs(step) < 1e-15) break;
    }
    x[i] = (1 - z) / 2;
    w[i] = 1 / ((1 - z * z) * dp * dp);
  }
  rule = { x, w };
  GL_CACHE.set(n, rule);
  return rule;
}

/** @internal Seidel and defocus terms of the wavefront in waves at the wavelength, field along +y. */
export interface DetailLimitWavefront { defocus: number; spherical: number; coma: number; astigmatism: number; fieldCurvature: number }

function wavefrontWaves(w: DetailLimitWavefront, px: number, py: number): number {
  const r2 = px * px + py * py;
  return (w.defocus + w.fieldCurvature) * r2 + w.spherical * r2 * r2 + w.coma * r2 * py + w.astigmatism * py * py;
}

function wavefrontMagnitude(w: DetailLimitWavefront): number {
  return Math.abs(w.defocus) + Math.abs(w.spherical) + Math.abs(w.coma) + Math.abs(w.astigmatism) + Math.abs(w.fieldCurvature);
}

/**
 * RMS of the wavefront over the unit disc with piston and tilt removed (tilt only moves the image, so the MTF and the Strehl
 * ratio do not depend on it; Wyant & Creath 1992, sec. on RMS wavefront error). Gauss–Legendre in ρ² and the midpoint rule in
 * angle, exact for these polynomials.
 */
function rmsWaves(w: DetailLimitWavefront): number {
  const radial = gaussLegendreUnit(8), angles = 16;
  let mean = 0, square = 0, tiltX = 0, tiltY = 0;
  for (let i = 0; i < radial.x.length; i++) {
    const rho = Math.sqrt(radial.x[i]!);
    for (let j = 0; j < angles; j++) {
      const t = 2 * Math.PI * (j + 0.5) / angles, x = rho * Math.cos(t), y = rho * Math.sin(t);
      const value = wavefrontWaves(w, x, y), weight = radial.w[i]! / angles;
      mean += weight * value;
      square += weight * value * value;
      tiltX += weight * value * x;
      tiltY += weight * value * y;
    }
  }
  // Least-squares tilt c·x has c = <W x>/<x²> with <x²> = 1/4, and removes c²/4 of the variance (x is orthogonal to piston).
  return Math.sqrt(Math.max(0, square - mean * mean - 4 * (tiltX * tiltX + tiltY * tiltY)));
}

/** Diffraction-limited MTF (2/π)(acos s − s√(1 − s²)), 0 from s = 1. */
function diffractionMtf(s: number): number {
  return s >= 1 ? 0 : (2 / Math.PI) * (Math.acos(s) - s * Math.sqrt(1 - s * s));
}

/**
 * @internal |OTF| at normalized frequency s (0 ≤ s < 1) along the pupil's x axis (`tangential` false) or y axis (true). The overlap
 * |ρ ± s·e| ≤ 1 is |a| ≤ 1 − s, |b| ≤ √(1 − (|a| + s)²) in coordinates (a along e, b across); |a| = (1 − s)(1 − τ²) removes
 * the square-root edge, so the integrand is smooth in τ and in b/b_max.
 */
export function detailLimitOpticsMtf(w: DetailLimitWavefront, s: number, tangential: boolean, nodeScale = 1): number {
  const magnitude = wavefrontMagnitude(w);
  if (s >= 1) return 0;
  if (magnitude === 0) return diffractionMtf(s);
  // The phase difference W(ρ + s e) − W(ρ − s e) varies by at most about 8·s·magnitude waves over the overlap.
  const cycles = 8 * s * magnitude, n = Math.ceil(nodeScale * Math.min(1200, 12 + Math.ceil(2.2 * cycles)));
  const rule = gaussLegendreUnit(n), half = 1 - s;
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const tau = rule.x[i]!, a = half * (1 - tau * tau), da = 2 * half * tau * rule.w[i]!;
    const bMax = Math.sqrt(Math.max(0, (1 - a - s) * (1 + a + s)));
    for (const sign of [1, -1]) {
      const along = sign * a;
      for (let j = 0; j < n; j++) {
        const b = bMax * (2 * rule.x[j]! - 1), weight = da * 2 * bMax * rule.w[j]!;
        const phase = tangential
          ? wavefrontWaves(w, b, along + s) - wavefrontWaves(w, b, along - s)
          : wavefrontWaves(w, along + s, b) - wavefrontWaves(w, along - s, b);
        re += weight * Math.cos(2 * Math.PI * phase);
        im += weight * Math.sin(2 * Math.PI * phase);
      }
    }
  }
  return Math.min(1, Math.hypot(re, im) / Math.PI);
}

/** Smallest s in (0, 1) where f(s) ≤ 0.5: a scan from 0 with the given step (finite, > 0), then bisection. */
function firstHalfCrossing(f: (s: number) => number, step: number): number {
  if (!(step > 0 && step <= 1)) throw new InvalidScientificInputError("Invalid detail-limit scan step.");
  let lo = 0;
  // The scan reaches 1 within ⌈1/step⌉ steps; the bound only guards the loop.
  for (let s = step, k = 0, steps = 2 * Math.ceil(1 / step) + 2; k < steps; s += step, k++) {
    const hi = Math.min(s, 1);
    if (f(hi) <= 0.5) {
      let a = lo, b = hi;
      for (let it = 0; it < 60 && b - a > 1e-13 * b; it++) { const m = (a + b) / 2; if (f(m) <= 0.5) b = m; else a = m; }
      return (a + b) / 2;
    }
    if (hi >= 1) return 1;
    lo = hi;
  }
  return 1;
}

/** The diffraction-limited MTF50 as a fraction of the cut-off: (2/π)(acos s − s√(1 − s²)) = 0.5, s ≈ 0.40397. */
function diffractionMtf50Fraction(): number {
  let a = 0, b = 1;
  for (let it = 0; it < 60; it++) { const m = (a + b) / 2; if (diffractionMtf(m) <= 0.5) b = m; else a = m; }
  return (a + b) / 2;
}

function sinc(x: number): number {
  return x === 0 ? 1 : Math.abs(Math.sin(Math.PI * x) / (Math.PI * x));
}

/** Thin-lens image distance in mm of an object at d meters, or f at infinity (d = null). */
function imageDistanceMm(focalLengthMm: number, distanceM: number | null, label: string): number {
  if (distanceM === null) return focalLengthMm;
  const d = distanceM * 1000;
  if (!(d > focalLengthMm)) throw new InvalidScientificInputError(`${label} must be greater than the focal length (${focalLengthMm} mm).`);
  return (focalLengthMm * d) / (d - focalLengthMm);
}

/** The checked settings other than the lens (`calculateDetailLimit`'s checks, in its order). */
export interface DetailLimitSettings {
  colorFilterArray: "bayer" | "none";
  wavelengthNm: number;
  fieldPosition: number;
  focusDistanceM: number | null;
  subjectDistanceM: number | null;
}

/** Checks everything but the lens; `name` is the function's name in the unknown-field message. */
export function parseDetailLimitSettings(input: CalculateDetailLimitInput, name: string): DetailLimitSettings {
  requireInputKeys(input, name, ["sensor", "lens", "fNumber", "focus", "fieldPosition", "wavelengthNm"]);
  requireInputObject(input.sensor, "sensor");
  requireInputKeys(input.sensor, "sensor", ["widthMm", "heightMm", "pixelWidth", "colorFilterArray"]);
  requirePositiveFinite("sensor.widthMm", input.sensor.widthMm);
  requirePositiveFinite("sensor.heightMm", input.sensor.heightMm);
  requirePositiveInteger("sensor.pixelWidth", input.sensor.pixelWidth);
  const cfa = input.sensor.colorFilterArray ?? "bayer";
  if (cfa !== "bayer" && cfa !== "none") throw new InvalidConfigurationError("sensor.colorFilterArray must be \"bayer\" or \"none\".");
  requirePositiveFinite("fNumber", input.fNumber);
  const wavelengthNm = input.wavelengthNm ?? 550;
  if (typeof wavelengthNm !== "number" || !(wavelengthNm >= DETAIL_LIMIT_LIMITS.minimumWavelengthNm && wavelengthNm <= DETAIL_LIMIT_LIMITS.maximumWavelengthNm)) {
    throw new InvalidScientificInputError("wavelengthNm must be a number from 380 through 780.");
  }
  const fieldPosition = input.fieldPosition ?? 0;
  if (typeof fieldPosition !== "number" || !(fieldPosition >= 0 && fieldPosition <= 1)) {
    throw new InvalidScientificInputError("fieldPosition must be a number from 0 (center) through 1 (corner).");
  }
  let focusDistanceM: number | null = null, subjectDistanceM: number | null = null;
  if (input.focus !== undefined) {
    requireInputObject(input.focus, "focus");
    requireInputKeys(input.focus, "focus", ["focusDistanceM", "subjectDistanceM"]);
    requirePositiveFinite("focus.focusDistanceM", input.focus.focusDistanceM);
    focusDistanceM = input.focus.focusDistanceM;
    if (input.focus.subjectDistanceM !== undefined) requirePositiveFinite("focus.subjectDistanceM", input.focus.subjectDistanceM);
    subjectDistanceM = input.focus.subjectDistanceM ?? focusDistanceM;
  }

  return { colorFilterArray: cfa, wavelengthNm, fieldPosition, focusDistanceM, subjectDistanceM };
}

/** The ideal lens's focal length, checked. */
export function idealLensFocalLength(lens: DetailLimitIdealLens): number {
  requireInputKeys(lens, "lens", ["kind", "focalLengthMm"]);
  requirePositiveFinite("lens.focalLengthMm", lens.focalLengthMm);
  return lens.focalLengthMm;
}

/** The detail limit of checked settings with the lens's wavefront (waves at the wavelength) and physical focal length. */
export function detailLimitOf(input: CalculateDetailLimitInput, settings: DetailLimitSettings, wavefront: DetailLimitWavefront, focalLengthMm: number): CalculationResult<DetailLimit> {
  const { colorFilterArray: cfa, wavelengthNm, fieldPosition, focusDistanceM, subjectDistanceM } = settings;
  const lambdaMm = wavelengthNm * 1e-6;
  const sensorImageMm = imageDistanceMm(focalLengthMm, focusDistanceM, "focus.focusDistanceM");
  const subjectImageMm = imageDistanceMm(focalLengthMm, subjectDistanceM, "focus.subjectDistanceM");
  const pupilMm = focalLengthMm / input.fNumber, workingFNumber = sensorImageMm / pupilMm;
  // W020 = dz/(8 N_w²), dz = sensor minus image distance (calculateDefocusWavefront's convention), in waves.
  const defocusDz = sensorImageMm - subjectImageMm, defocusWaves = defocusDz / (8 * workingFNumber * workingFNumber) / lambdaMm;
  const defocusBlurDiameterMm = Math.abs(defocusDz) * pupilMm / subjectImageMm;
  const aberrationRms = rmsWaves(wavefront);
  wavefront.defocus += defocusWaves;
  const totalRms = rmsWaves(wavefront), defocusRms = Math.abs(defocusWaves) / (2 * Math.sqrt(3));
  const magnitude = wavefrontMagnitude(wavefront);
  // Finite but extreme inputs (a focus distance near the float range, an f-number near 0) can overflow the image geometry.
  if (![sensorImageMm, subjectImageMm, pupilMm, workingFNumber, defocusWaves, defocusBlurDiameterMm, aberrationRms, totalRms].every(Number.isFinite) || !(workingFNumber > 0)) {
    throw new InvalidScientificInputError("The focus distance and f-number give an image geometry outside the floating-point range.");
  }
  if (magnitude > DETAIL_LIMIT_LIMITS.maximumWavefrontWaves) {
    throw new InvalidScientificInputError(`The wavefront (${magnitude.toPrecision(3)} waves, defocus blur ${defocusBlurDiameterMm.toPrecision(3)} mm) exceeds ` +
      `${DETAIL_LIMIT_LIMITS.maximumWavefrontWaves} waves: the blur is geometric; use calculateDefocusCircle for it.`);
  }

  const pitchMm = input.sensor.widthMm / input.sensor.pixelWidth, cutoff = 1 / (lambdaMm * workingFNumber), nyquist = 1 / (2 * pitchMm);
  const step = Math.min(1 / 128, 1 / (32 * Math.max(1, magnitude)));
  if (!Number.isFinite(cutoff * nyquist)) throw new InvalidScientificInputError("The cut-off frequency is outside the floating-point range.");
  const symmetric = wavefront.coma === 0 && wavefront.astigmatism === 0;
  const opticsAt = (s: number, tangential: boolean): number => detailLimitOpticsMtf(wavefront, s, tangential);
  const tangential50 = firstHalfCrossing((s) => opticsAt(s, true), step) * cutoff;
  const sagittal50 = symmetric ? tangential50 : firstHalfCrossing((s) => opticsAt(s, false), step) * cutoff;
  const systemAt = (s: number, t: boolean): number => opticsAt(s, t) * sinc(s * cutoff * pitchMm);
  const systemTangential50 = firstHalfCrossing((s) => systemAt(s, true), step) * cutoff;
  const system50 = symmetric ? systemTangential50 : Math.min(systemTangential50, firstHalfCrossing((s) => systemAt(s, false), step) * cutoff);
  const sNyquist = nyquist / cutoff;
  const opticsAtNyquist = symmetric ? opticsAt(sNyquist, true) : Math.min(opticsAt(sNyquist, true), opticsAt(sNyquist, false));
  const mtf50 = Math.min(tangential50, sagittal50), fraction50 = diffractionMtf50Fraction();

  const limitedBy: DetailLimitedBy = mtf50 >= nyquist ? "sensor" : "lens";
  const limitingFactor: DetailLimitingFactor = limitedBy === "sensor" ? "pixel-pitch"
    : totalRms <= MARECHAL_RMS_WAVES ? "diffraction" : defocusRms > aberrationRms ? "defocus" : "aberrations";

  return approximationResult(
    {
      limitedBy,
      limitingFactor,
      opticsToNyquistRatio: mtf50 / nyquist,
      fNumber: input.fNumber,
      wavelengthNm,
      focalLengthMm,
      fieldPosition,
      optics: {
        workingFNumber,
        cutoffCyclesPerMm: cutoff,
        mtf50CyclesPerMm: mtf50,
        tangentialMtf50CyclesPerMm: tangential50,
        sagittalMtf50CyclesPerMm: sagittal50,
        diffractionMtf50CyclesPerMm: fraction50 * cutoff,
        mtfAtNyquist: opticsAtNyquist,
        rmsWavefrontErrorWaves: { aberrations: aberrationRms, defocus: defocusRms, total: totalRms },
        withinMarechalCriterion: totalRms <= MARECHAL_RMS_WAVES,
        defocusBlurDiameterMm
      },
      sampling: {
        colorFilterArray: cfa,
        pixelPitchMicrometers: pitchMm * 1000,
        nyquistCyclesPerMm: nyquist,
        redBlueNyquistCyclesPerMm: cfa === "bayer" ? nyquist / 2 : null,
        pixelApertureMtfAtNyquist: 2 / Math.PI,
        pixelApertureMtf50CyclesPerMm: 0.6033545923 / pitchMm
      },
      system: {
        mtf50CyclesPerMm: system50,
        mtf50LinePairsPerPictureHeight: system50 * input.sensor.heightMm,
        mtfAtNyquist: opticsAtNyquist * (2 / Math.PI)
      },
      diffractionLimitedFNumber: (2 * pitchMm * fraction50 / lambdaMm) * focalLengthMm / sensorImageMm,
      basis: BASIS
    },
    "detail-limit",
    DETAIL_LIMIT_MODEL_VERSION,
    [
      "Scalar, incoherent, monochromatic imaging at one wavelength (default 550 nm); lateral color excluded.",
      "Uniformly lit circular pupil; thin-lens working f-number and defocus.",
      "Pixel aperture: ideal square site with fill factor 1; no optical low-pass filter, microlens or crosstalk.",
      "A Bayer filter's red and blue sites have half the Nyquist frequency; demosaicing is not modeled.",
      "Decision rule: the sensor limits when the optics MTF50 reaches the Nyquist frequency; diffraction when the RMS wavefront error is within λ/14 (Maréchal).",
      "Catalogue lenses are generic Photivra designs (labeled approximations), not measured products."
    ]
  );
}

/** The input of {@link calculateIdealLensDetailLimit}: that of `calculateDetailLimit` with an ideal lens. */
export type CalculateIdealLensDetailLimitInput = Omit<CalculateDetailLimitInput, "lens"> & { lens: DetailLimitIdealLens };

/**
 * `calculateDetailLimit` for an ideal lens (`lens.kind: "ideal"`, diffraction and defocus only), from 2.29.0 (#765): the same
 * checks and the same result, in a module without the lens catalogue, so a bundle that needs only ideal lenses stays small.
 * A catalogue lens is refused; use `calculateDetailLimit` for it.
 *
 * @param input Sensor, ideal lens, f-number, and optional focus, field position and wavelength.
 * @returns The resolution of the optics and of the sampling, and which limits detail.
 */
export function calculateIdealLensDetailLimit(input: CalculateIdealLensDetailLimitInput): CalculationResult<DetailLimit> {
  const settings = parseDetailLimitSettings(input, "calculateIdealLensDetailLimit");
  const lens = input.lens;
  requireInputObject(lens, "lens");
  if (lens.kind !== "ideal") throw new InvalidConfigurationError("lens.kind must be \"ideal\"; calculateDetailLimit takes a catalogue lens.");
  return detailLimitOf(input, settings, { defocus: 0, spherical: 0, coma: 0, astigmatism: 0, fieldCurvature: 0 }, idealLensFocalLength(lens));
}
