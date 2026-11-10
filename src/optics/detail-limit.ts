// SPDX-License-Identifier: Apache-2.0

/**
 * Which limits detail for given settings: the lens (diffraction at this f-number, aberrations, defocus) or the sensor's pixel
 * pitch (#575, for the app's Learn section).
 *
 * Model (`detail-limit` 1.0.0; the decision rule is an approximation, see below):
 * - **Optics.** The incoherent optical transfer function of a uniformly lit circular pupil carrying the wavefront W (in waves)
 *   is the normalised autocorrelation of the pupil function P = exp(i·2π·W):
 *   OTF(s) = (1/π)∫∫ P(ρ + s·e)·P*(ρ − s·e) d²ρ over the overlap of the two unit discs, s = ν/ν_c, ν_c = 1/(λ·N_w), N_w the
 *   working f-number (thin-lens image distance / pupil diameter). With W = 0 it is the diffraction-limited
 *   (2/π)(acos s − s√(1 − s²)) (MIT OpenCourseWare 2.71 Optics, Spring 2009, lectures 21–22, free; also see Goodman,
 *   Introduction to Fourier Optics, 4th ed., §7.3–7.4). The integral is evaluated by Gauss–Legendre quadrature on a smooth
 *   parametrisation of the overlap (√ edge removed), with node counts that grow with the phase variation; MTF = |OTF|.
 * - **Wavefront.** `lens.ideal`: none. `lens.catalogue`: the lens's resolved Seidel terms (`resolveGenericLens`, the same
 *   expansion as its PSF: Hopkins 1950; Wyant & Creath 1992, Applied Optics and Optical Engineering XI ch. 1, free author copy)
 *   at the field height H, with axial colour at the wavelength. Defocus of a subject away from the focus distance adds
 *   W020 = dz/(8·N_w²), dz = sensor minus image distance (thin lens; `calculateDefocusWavefront`, Wyant & Creath eq. 18).
 * - **Sampling.** Nyquist frequency 1/(2p) for pixel pitch p (exact for the lattice); a Bayer filter's red and blue sites
 *   repeat every 2p, so their Nyquist frequency is 1/(4p), while its green sites still sample rows and columns up to 1/(2p).
 *   Pixel aperture MTF |sinc(ν·p)| for a square, fully sensitive site (fill factor 1, an idealisation).
 * - **Decision (approximation).** The sensor limits when the optics still pass at least 50 % contrast at the Nyquist
 *   frequency (optics MTF50 ≥ 1/(2p)): a denser sensor would record finer detail. Otherwise the lens limits, and the cause is
 *   diffraction when the wavefront error is within the Maréchal criterion (RMS ≤ λ/14, Strehl ≈ 0.8; Wyant & Creath 1992
 *   eq. 67), else aberrations or defocus, whichever has the larger RMS wavefront error.
 * @see docs/PHYSICS_FOUNDATION.md "Which limits detail: the lens or the sensor" for the equations, exactness and limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError, requirePositiveFinite, requirePositiveInteger } from "../core/validation.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { genericLensDispersion, resolveGenericLens } from "../equipment/generic-lens-catalogue.js";

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

/** A lens with no aberrations (diffraction only). */
export interface DetailLimitIdealLens {
  kind: "ideal";
  /** Physical focal length in millimetres (for the working f-number and the defocus of a subject off the focus distance). */
  focalLengthMm: number;
}

/** A generic catalogue lens (`GENERIC_LENS_IDS`), resolved for the sensor as `resolveGenericLens` does. */
export interface DetailLimitCatalogueLens {
  kind: "catalogue";
  lensId: string;
}

export interface CalculateDetailLimitInput {
  /** Active imaging area and horizontal pixel count; pitch = widthMm / pixelWidth. */
  sensor: {
    widthMm: number;
    heightMm: number;
    pixelWidth: number;
    /** Default `"bayer"`. `"none"`: every site records full detail (a monochrome sensor). */
    colorFilterArray?: "bayer" | "none";
  };
  lens: DetailLimitIdealLens | DetailLimitCatalogueLens;
  /** f-number set on the lens. */
  fNumber: number;
  /**
   * Focus and subject distances from the lens in metres. Omitted: focused at infinity, subject in focus. `subjectDistanceM`
   * omitted: the subject is at the focus distance.
   */
  focus?: { focusDistanceM: number; subjectDistanceM?: number };
  /** Field height as a fraction of the half-diagonal, 0 (centre, default) to 1 (corner). Only aberrations depend on it. */
  fieldPosition?: number;
  /** Wavelength in nanometres, 380–780. Default 550. */
  wavelengthNm?: number;
}

/** Which component limits detail. */
export type DetailLimitedBy = "lens" | "sensor";
/** What limits it: the lens's diffraction, aberrations or defocus, or the sensor's pixel pitch. */
export type DetailLimitingFactor = "diffraction" | "aberrations" | "defocus" | "pixel-pitch";

export interface DetailLimitOptics {
  /** Working f-number N_w = N·v/f (thin-lens image distance v; N at infinity focus). */
  workingFNumber: number;
  /** Diffraction cut-off 1/(λ·N_w) in cycles/mm: no optics passes detail beyond it. */
  cutoffCyclesPerMm: number;
  /** Frequency where the optics' MTF falls to 0.5, the lower of the two directions, cycles/mm. */
  mtf50CyclesPerMm: number;
  /** MTF50 for detail along the radius from the image centre (tangential), cycles/mm. */
  tangentialMtf50CyclesPerMm: number;
  /** MTF50 for detail across the radius (sagittal), cycles/mm. Equal to the tangential value at the centre. */
  sagittalMtf50CyclesPerMm: number;
  /** MTF50 of an aberration-free lens in focus at the same working f-number (0.40397·cut-off), cycles/mm. */
  diffractionMtf50CyclesPerMm: number;
  /** Optics MTF at the sensor's Nyquist frequency (lower direction). */
  mtfAtNyquist: number;
  /** RMS wavefront error in waves at the wavelength: of the aberrations, of the defocus, and of both together. */
  rmsWavefrontErrorWaves: { aberrations: number; defocus: number; total: number };
  /** Whether the total RMS wavefront error is within the Maréchal criterion λ/14. */
  withinMarechalCriterion: boolean;
  /** Geometric blur-circle diameter of the defocus on the sensor, mm (0 in focus). */
  defocusBlurDiameterMm: number;
}

export interface DetailLimitSampling {
  colorFilterArray: "bayer" | "none";
  /** Pixel pitch in micrometres: widthMm / pixelWidth. */
  pixelPitchMicrometers: number;
  /** 1/(2p), cycles/mm: the finest detail the pixel grid records without aliasing (Bayer green sites too, along rows and columns). */
  nyquistCyclesPerMm: number;
  /** Bayer only: 1/(4p), the Nyquist frequency of the red and blue sites. Null without a colour filter array. */
  redBlueNyquistCyclesPerMm: number | null;
  /** Pixel aperture MTF at the Nyquist frequency: sinc(1/2) = 2/π. */
  pixelApertureMtfAtNyquist: number;
  /** Frequency where the pixel aperture MTF falls to 0.5 (0.60335/p), cycles/mm: beyond the Nyquist frequency. */
  pixelApertureMtf50CyclesPerMm: number;
}

export interface DetailLimitSystem {
  /** MTF50 of optics × pixel aperture (lower direction), cycles/mm. Detail above the Nyquist frequency aliases. */
  mtf50CyclesPerMm: number;
  /** The same in line pairs per picture height (cycles/mm × heightMm). */
  mtf50LinePairsPerPictureHeight: number;
  /** System MTF at the Nyquist frequency (lower direction). */
  mtfAtNyquist: number;
}

/** Whether a quantity is exact under its stated conditions or an approximation. */
export interface DetailLimitBasis { kind: "exact" | "approximation"; statement: string }

export interface DetailLimit {
  /** The lens or the sensor. */
  limitedBy: DetailLimitedBy;
  /** Diffraction, aberrations or defocus (the lens), or the pixel pitch (the sensor). */
  limitingFactor: DetailLimitingFactor;
  /** Optics MTF50 / Nyquist frequency: at least 1 when the sensor limits. */
  opticsToNyquistRatio: number;
  fNumber: number;
  wavelengthNm: number;
  /** Physical focal length used (the catalogue lens's on this sensor), mm. */
  focalLengthMm: number;
  fieldPosition: number;
  optics: DetailLimitOptics;
  sampling: DetailLimitSampling;
  system: DetailLimitSystem;
  /**
   * The f-number at which an aberration-free lens in focus has its MTF50 at the Nyquist frequency (2·p·0.40397/λ at
   * infinity focus): from it on, diffraction limits detail on this sensor whatever the lens.
   */
  diffractionLimitedFNumber: number;
  basis: Readonly<Record<"optics" | "sampling" | "system" | "limitedBy", DetailLimitBasis>>;
}

const BASIS: DetailLimit["basis"] = /* @__PURE__ */ Object.freeze({
  optics: Object.freeze({ kind: "exact", statement: "Scalar incoherent OTF of a circular pupil carrying the stated wavefront at one wavelength " +
    "(numerical quadrature, converged to about 1e-9). The wavefront itself is exact for lens.ideal (none) and an approximation for lens.catalogue." }),
  sampling: Object.freeze({ kind: "exact", statement: "Nyquist frequencies of the pixel lattice and of a Bayer filter's colour lattices; pixel aperture " +
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
 * @internal |OTF| at normalised frequency s (0 ≤ s < 1) along the pupil's x axis (`tangential` false) or y axis (true). The overlap
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

/** Smallest s in (0, 1) where f(s) ≤ 0.5: a scan from 0 with the given step, then bisection. */
function firstHalfCrossing(f: (s: number) => number, step: number): number {
  let lo = 0;
  for (let s = step; ; s += step) {
    const hi = Math.min(s, 1);
    if (f(hi) <= 0.5) {
      let a = lo, b = hi;
      for (let it = 0; it < 60 && b - a > 1e-13 * b; it++) { const m = (a + b) / 2; if (f(m) <= 0.5) b = m; else a = m; }
      return (a + b) / 2;
    }
    if (hi >= 1) return 1;
    lo = hi;
  }
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

/** Thin-lens image distance in mm of an object at d metres, or f at infinity (d = null). */
function imageDistanceMm(focalLengthMm: number, distanceM: number | null, label: string): number {
  if (distanceM === null) return focalLengthMm;
  const d = distanceM * 1000;
  if (!(d > focalLengthMm)) throw new InvalidScientificInputError(`${label} must be greater than the focal length (${focalLengthMm} mm).`);
  return (focalLengthMm * d) / (d - focalLengthMm);
}

/**
 * Which limits detail for given settings: the lens (diffraction at this f-number, aberrations, defocus) or the sensor's pixel
 * pitch. Returns the optics' resolution (MTF50 and the diffraction cut-off, cycles/mm), the sampling's (Nyquist frequency
 * and, with a Bayer filter, the red and blue sites'), the system MTF50 (optics × pixel aperture), the f-number from which
 * diffraction limits on this sensor, and which one limits.
 *
 * The sensor limits when the optics still pass 50 % contrast at the Nyquist frequency 1/(2p); otherwise the lens does,
 * through diffraction when its wavefront error is within the Maréchal criterion (RMS ≤ λ/14), else through aberrations or
 * defocus. The optics MTF is the exact scalar OTF of the stated wavefront at one wavelength; the decision rule and the
 * catalogue lenses' wavefronts are approximations.
 *
 * Example: an ideal 50 mm lens at f/22 on a 36 × 24 mm, 6000-pixel-wide sensor (6 µm) is limited by diffraction (optics
 * MTF50 ≈ 33 cycles/mm against a Nyquist frequency of ≈ 83); at f/4 the pixel pitch limits.
 *
 * @param input Sensor, lens, f-number, and optional focus, field position and wavelength.
 * @returns The resolution of the optics and of the sampling, and which limits detail.
 */
export function calculateDetailLimit(input: CalculateDetailLimitInput): CalculationResult<DetailLimit> {
  requireInputKeys(input, "calculateDetailLimit", ["sensor", "lens", "fNumber", "focus", "fieldPosition", "wavelengthNm"]);
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
    throw new InvalidScientificInputError("fieldPosition must be a number from 0 (centre) through 1 (corner).");
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

  const lens = input.lens;
  requireInputObject(lens, "lens");
  const wavefront: DetailLimitWavefront = { defocus: 0, spherical: 0, coma: 0, astigmatism: 0, fieldCurvature: 0 };
  let focalLengthMm: number;
  if (lens.kind === "ideal") {
    requireInputKeys(lens, "lens", ["kind", "focalLengthMm"]);
    requirePositiveFinite("lens.focalLengthMm", lens.focalLengthMm);
    focalLengthMm = lens.focalLengthMm;
  } else if (lens.kind === "catalogue") {
    requireInputKeys(lens, "lens", ["kind", "lensId"]);
    const resolved = resolveGenericLens({ lensId: lens.lensId, activeImagingArea: { widthMm: input.sensor.widthMm, heightMm: input.sensor.heightMm },
      fNumber: input.fNumber, ...(focusDistanceM === null ? {} : { focusDistanceM }) });
    focalLengthMm = resolved.focalLengthMm;
    // Waves at 550 nm (the catalogue's design wavelength) → waves at λ: OPD is fixed, so scale by 550/λ.
    const a = resolved.character.aberrations, H = fieldPosition, scale = 550 / wavelengthNm;
    wavefront.defocus = scale * (a.balancingDefocusWaves + a.axialColorWaves * genericLensDispersion(wavelengthNm));
    wavefront.spherical = scale * a.sphericalWaves;
    wavefront.coma = scale * a.comaWaves * H;
    wavefront.astigmatism = scale * a.astigmatismWaves * H * H;
    wavefront.fieldCurvature = scale * a.fieldCurvatureWaves * H * H;
  } else {
    throw new InvalidConfigurationError("lens.kind must be \"ideal\" or \"catalogue\".");
  }

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
  if (magnitude > DETAIL_LIMIT_LIMITS.maximumWavefrontWaves) {
    throw new InvalidScientificInputError(`The wavefront (${magnitude.toPrecision(3)} waves, defocus blur ${defocusBlurDiameterMm.toPrecision(3)} mm) exceeds ` +
      `${DETAIL_LIMIT_LIMITS.maximumWavefrontWaves} waves: the blur is geometric; use calculateDefocusCircle for it.`);
  }

  const pitchMm = input.sensor.widthMm / input.sensor.pixelWidth, cutoff = 1 / (lambdaMm * workingFNumber), nyquist = 1 / (2 * pitchMm);
  const step = Math.min(1 / 128, 1 / (32 * Math.max(1, magnitude)));
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
      "Scalar, incoherent, monochromatic imaging at one wavelength (default 550 nm); lateral colour excluded.",
      "Uniformly lit circular pupil; thin-lens working f-number and defocus.",
      "Pixel aperture: ideal square site with fill factor 1; no optical low-pass filter, microlens or crosstalk.",
      "A Bayer filter's red and blue sites have half the Nyquist frequency; demosaicing is not modelled.",
      "Decision rule: the sensor limits when the optics MTF50 reaches the Nyquist frequency; diffraction when the RMS wavefront error is within λ/14 (Maréchal).",
      "Catalogue lenses are generic Photivra designs (labelled approximations), not measured products."
    ]
  );
}
