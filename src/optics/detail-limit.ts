// SPDX-License-Identifier: Apache-2.0

/**
 * Which limits detail for given settings: the lens (diffraction at this f-number, aberrations, defocus) or the sensor's pixel
 * pitch (#575, for the app's Learn section).
 *
 * Model (`detail-limit` 1.0.0; the decision rule is an approximation, see below):
 * - **Optics.** The incoherent optical transfer function of a uniformly lit circular pupil carrying the wavefront W (in waves)
 *   is the normalized autocorrelation of the pupil function P = exp(i·2π·W):
 *   OTF(s) = (1/π)∫∫ P(ρ + s·e)·P*(ρ − s·e) d²ρ over the overlap of the two unit discs, s = ν/ν_c, ν_c = 1/(λ·N_w), N_w the
 *   working f-number (thin-lens image distance / pupil diameter). With W = 0 it is the diffraction-limited
 *   (2/π)(acos s − s√(1 − s²)) (MIT OpenCourseWare 2.71 Optics, Spring 2009, lectures 21–22, free; also see Goodman,
 *   Introduction to Fourier Optics, 4th ed., §7.3–7.4). The integral is evaluated by Gauss–Legendre quadrature on a smooth
 *   parametrisation of the overlap (√ edge removed), with node counts that grow with the phase variation; MTF = |OTF|.
 * - **Wavefront.** `lens.ideal`: none. `lens.catalogue`: the lens's resolved Seidel terms (`resolveGenericLens`, the same
 *   expansion as its PSF: Hopkins 1950; Wyant & Creath 1992, Applied Optics and Optical Engineering XI ch. 1, free author copy)
 *   at the field height H, with axial color at the wavelength. Defocus of a subject away from the focus distance adds
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

import type { CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { resolveGenericLens } from "../equipment/generic-lens-catalogue.js";
import { genericLensDispersion } from "../equipment/generic-lens-dispersion.js";
import { detailLimitOf, idealLensFocalLength, parseDetailLimitSettings, type DetailLimitWavefront } from "./detail-limit-ideal.js";

// #765 (2.29.0): the arithmetic and the ideal-lens branch are detail-limit-ideal.ts, which has no catalogue import.
export { calculateIdealLensDetailLimit, DETAIL_LIMIT_LIMITS, detailLimitOpticsMtf, type CalculateIdealLensDetailLimitInput, type DetailLimitWavefront } from "./detail-limit-ideal.js";

/** A lens with no aberrations (diffraction only). */
export interface DetailLimitIdealLens {
  kind: "ideal";
  /** Physical focal length in millimeters (for the working f-number and the defocus of a subject off the focus distance). */
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
   * Focus and subject distances from the lens in meters. Omitted: focused at infinity, subject in focus. `subjectDistanceM`
   * omitted: the subject is at the focus distance.
   */
  focus?: { focusDistanceM: number; subjectDistanceM?: number };
  /** Field height as a fraction of the half-diagonal, 0 (center, default) to 1 (corner). Only aberrations depend on it. */
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
  /** MTF50 for detail along the radius from the image center (tangential), cycles/mm. */
  tangentialMtf50CyclesPerMm: number;
  /** MTF50 for detail across the radius (sagittal), cycles/mm. Equal to the tangential value at the center. */
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
  /** Bayer only: 1/(4p), the Nyquist frequency of the red and blue sites. Null without a color filter array. */
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
  const settings = parseDetailLimitSettings(input, "calculateDetailLimit");
  const lens = input.lens;
  requireInputObject(lens, "lens");
  const wavefront: DetailLimitWavefront = { defocus: 0, spherical: 0, coma: 0, astigmatism: 0, fieldCurvature: 0 };
  let focalLengthMm: number;
  if (lens.kind === "ideal") {
    focalLengthMm = idealLensFocalLength(lens);
  } else if (lens.kind === "catalogue") {
    requireInputKeys(lens, "lens", ["kind", "lensId"]);
    const { focusDistanceM, fieldPosition, wavelengthNm } = settings;
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
  return detailLimitOf(input, settings, wavefront, focalLengthMm);
}
