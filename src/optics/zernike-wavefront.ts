// SPDX-License-Identifier: Apache-2.0

/**
 * Describes lens aberrations as a wavefront, for the complex-pupil PSF (point-spread function)
 * reference.
 *
 * This module builds the declared pupil grid: relative amplitude plus optical path difference (OPD)
 * in micrometres. calculateLensComplexPupilPsf() uses that grid unchanged. This module does no light
 * propagation itself.
 *
 * Zernike polynomials use Noll's single index j >= 1 and Noll's normalisation (Noll 1976, JOSA
 * 66:207):
 * - m = 0: Z_j = sqrt(n + 1) R_n^0(rho)
 * - m != 0: Z_j = sqrt(2 (n + 1)) R_n^|m|(rho) cos(m theta) for even j, or sin(m theta) for odd j
 * So each term has an RMS of 1 over the unit disk. The RMS wavefront error of sum_j c_j Z_j (piston
 * excluded) is sqrt(sum_{j>=2} c_j^2). The radial polynomial R_n^m is the standard one in Noll's
 * nomenclature (Mathar, arXiv:0809.2368, eq. 1, free). Also see: Born & Wolf, Principles of Optics,
 * 7th ed., sec. 9.2 and app. VII.
 *
 * Primary (Seidel) aberrations use the wave-aberration expansion in normalised field height H and
 * normalised pupil coordinates (rho, phi), phi measured from the field direction (Hopkins 1950,
 * Wave Theory of Aberrations; Wyant & Creath 1992, Applied Optics and Optical Engineering XI ch. 1):
 *   W = W020 rho^2 + W111 H rho cos(phi) + W040 rho^4 + W131 H rho^3 cos(phi)
 *     + W222 H^2 rho^2 cos^2(phi) + W220 H^2 rho^2 + W311 H^3 rho cos(phi).
 *
 * Paraxial defocus: an image-plane defocus dz at working f-number N gives W020 = dz / (8 N^2)
 * (Wyant & Creath 1992, Applied Optics and Optical Engineering XI ch. 1, eq. 18, free author copy.
 * Also see: Goodman, Introduction to Fourier Optics, 3rd ed., sec. 6.4; Mahajan, Optical Imaging and
 * Aberrations Part I, sec. 3.4). That is a Zernike Z4 coefficient of W020 / (2 sqrt 3).
 *
 * Marechal/Mahajan approximation: Strehl ratio ~ exp(-(2 pi sigma / lambda)^2) for a small RMS
 * wavefront error sigma (Marechal 1947; Mahajan 1982 JOSA 72:1258; free: Wyant & Creath 1992,
 * ch. 1, eq. 67). It is an approximation, valid
 * roughly for Strehl ratios above 0.3.
 *
 * Pupil coordinates are in metric units, aligned with the image plane (+X right, +Y up). theta is
 * measured counter-clockwise from +X.
 * @see docs/PSF_FOUNDATION.md for the equations, units, coordinate conventions, known blockers and
 * support limits.
 */

import {
  approximationResult,
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite
} from "../core/validation.js";
import type { LensComplexPupilGrid } from "./complex-pupil-psf.js";
import { requireInputKeys, requireNamedFinite as requireFinite } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

/** Largest supported Noll index (radial order n <= 10). */
export const ZERNIKE_MAXIMUM_NOLL_INDEX = 66;
/** Largest odd pupil grid width: 63 x 63 = 3969 samples, within the complex-pupil 4096 limit. */
export const ZERNIKE_PUPIL_MAXIMUM_SAMPLES_ACROSS = 63;

export interface ZernikeOrder {
  nollIndex: number;
  /** Radial order n. */
  radialOrder: number;
  /** Signed azimuthal frequency m. Positive means cos(m theta); negative means sin(|m| theta). */
  azimuthalFrequency: number;
}

export interface ZernikeCoefficient {
  nollIndex: number;
  /** Coefficient of the unit-RMS Noll polynomial, in micrometres of optical path difference. */
  coefficientMicrometers: number;
}

/** Peak Seidel wave-aberration coefficients in micrometres of optical path difference. */
export interface SeidelWavefrontCoefficients {
  /** Defocus rho^2. */
  w020Micrometers?: number;
  /** Tilt H rho cos(phi). */
  w111Micrometers?: number;
  /** Spherical aberration rho^4. */
  w040Micrometers?: number;
  /** Coma H rho^3 cos(phi). */
  w131Micrometers?: number;
  /** Astigmatism H^2 rho^2 cos^2(phi). */
  w222Micrometers?: number;
  /** Field curvature H^2 rho^2. */
  w220Micrometers?: number;
  /** Distortion H^3 rho cos(phi). */
  w311Micrometers?: number;
}

export interface SeidelFieldPosition {
  /** Normalised field height H in [0, 1]. */
  normalizedFieldHeight: number;
  /** Image-plane direction of the field point, degrees counter-clockwise from +X. */
  fieldAzimuthDegrees: number;
}

export interface CreateWavefrontPupilGridInput {
  /** Pupil diameter in mm; rho = 1 at radius pupilDiameterMm / 2. */
  pupilDiameterMm: number;
  /** Odd number of samples across the pupil diameter, from 3 to 63. */
  samplesAcross: number;
  zernikeCoefficients?: readonly ZernikeCoefficient[];
  seidelCoefficients?: SeidelWavefrontCoefficients;
  /** Required when any field-dependent Seidel coefficient is non-zero. */
  seidelField?: SeidelFieldPosition;
  /**
   * Optional additional aperture mask: a simple polygon in pupil-plane mm (for example the
   * cat's-eye pupil from calculateMechanicalVignetting). Samples outside it get zero amplitude.
   */
  apertureMaskVerticesMm?: readonly { x: number; y: number }[];
}

export interface WavefrontPupilGrid {
  /** Grid for LensComplexPupilProfile.grid. Amplitude is 1 inside and 0 outside; OPD is in micrometres. */
  grid: LensComplexPupilGrid;
  pupilDiameterMm: number;
  /** Number of samples with non-zero amplitude. */
  openSampleCount: number;
  /** sqrt(sum c_j^2, j >= 2): RMS of the Zernike terms alone over the continuous unit disk. */
  zernikeRmsMicrometers: number;
  /** RMS of the sampled OPD over open samples, with piston removed (all terms). */
  sampledRmsMicrometers: number;
  /** Peak-to-valley of the sampled OPD over open samples. */
  sampledPeakToValleyMicrometers: number;
}

export interface CalculateDefocusWavefrontInput {
  /** Signed image-plane defocus, sensor minus image distance, in micrometres. */
  signedDefocusImagePlaneMicrometers: number;
  /** Image-side working f-number (image distance / pupil diameter). */
  workingFNumber: number;
}

export interface DefocusWavefront {
  signedDefocusImagePlaneMicrometers: number;
  workingFNumber: number;
  /** Peak defocus coefficient W020 = dz / (8 N^2), micrometres. */
  w020Micrometers: number;
  /** Equivalent Noll Z4 coefficient W020 / (2 sqrt 3), micrometres (equals the RMS). */
  zernikeZ4Micrometers: number;
}

export interface EstimateMarechalStrehlRatioInput {
  rmsWavefrontErrorMicrometers: number;
  wavelengthNm: number;
}

function requireNollIndex(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > ZERNIKE_MAXIMUM_NOLL_INDEX
  ) {
    throw new InvalidScientificInputError(
      `nollIndex must be an integer from 1 through ${ZERNIKE_MAXIMUM_NOLL_INDEX}.`
    );
  }
  return value;
}

/** Converts a Noll index to radial order n and signed azimuthal frequency m (Noll 1976). */
export function resolveZernikeNollOrder(nollIndex: number): ZernikeOrder {
  const j = requireNollIndex(nollIndex);
  let n = 0;
  while (((n + 1) * (n + 2)) / 2 < j) {
    n += 1;
  }
  // Position within radial order n; |m| increases with it, two indices per non-zero |m|.
  const k = j - (n * (n + 1)) / 2 - 1;
  const absoluteM =
    n % 2 === 0 ? 2 * Math.floor((k + 1) / 2) : 2 * Math.floor(k / 2) + 1;
  return {
    nollIndex: j,
    radialOrder: n,
    azimuthalFrequency:
      absoluteM === 0 ? 0 : j % 2 === 0 ? absoluteM : -absoluteM
  };
}

function factorial(value: number): number {
  let result = 1;
  for (let k = 2; k <= value; k += 1) result *= k;
  return result;
}

function radialPolynomial(n: number, m: number, rho: number): number {
  let sum = 0;
  for (let k = 0; k <= (n - m) / 2; k += 1) {
    const coefficient =
      ((k % 2 === 0 ? 1 : -1) * factorial(n - k)) /
      (factorial(k) * factorial((n + m) / 2 - k) * factorial((n - m) / 2 - k));
    sum += coefficient * rho ** (n - 2 * k);
  }
  return sum;
}

/** Evaluates the unit-RMS Noll Zernike polynomial at normalised pupil polar coordinates. */
export function evaluateZernikePolynomial(
  nollIndex: number,
  normalizedRadius: number,
  azimuthRadians: number
): number {
  const order = resolveZernikeNollOrder(nollIndex);
  const rho = requireFinite("normalizedRadius", normalizedRadius);
  const theta = requireFinite("azimuthRadians", azimuthRadians);
  if (rho < 0 || rho > 1 + 1e-12) {
    throw new InvalidScientificInputError(
      "normalizedRadius must lie in [0, 1]."
    );
  }
  const n = order.radialOrder;
  const m = Math.abs(order.azimuthalFrequency);
  const radial = radialPolynomial(n, m, Math.min(1, rho));
  if (m === 0) {
    return Math.sqrt(n + 1) * radial;
  }
  const angular =
    order.azimuthalFrequency > 0 ? Math.cos(m * theta) : Math.sin(m * theta);
  return Math.sqrt(2 * (n + 1)) * radial * angular;
}

function parseZernike(
  value: readonly ZernikeCoefficient[] | undefined
): ZernikeCoefficient[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new InvalidConfigurationError("zernikeCoefficients must be an array.");
  }
  const seen = new Set<number>();
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new InvalidConfigurationError(`zernikeCoefficients[${index}] must be an object.`);
    }
    const nollIndex = requireNollIndex(entry.nollIndex);
    if (seen.has(nollIndex)) {
      throw new InvalidScientificInputError("zernikeCoefficients must not repeat a nollIndex.");
    }
    seen.add(nollIndex);
    return {
      nollIndex,
      coefficientMicrometers: requireFinite(
        `zernikeCoefficients[${index}].coefficientMicrometers`,
        entry.coefficientMicrometers
      )
    };
  });
}

const SEIDEL_KEYS = [
  "w020Micrometers",
  "w111Micrometers",
  "w040Micrometers",
  "w131Micrometers",
  "w222Micrometers",
  "w220Micrometers",
  "w311Micrometers"
] as const;

function parseSeidel(
  value: SeidelWavefrontCoefficients | undefined
): Required<SeidelWavefrontCoefficients> {
  const result = {
    w020Micrometers: 0,
    w111Micrometers: 0,
    w040Micrometers: 0,
    w131Micrometers: 0,
    w222Micrometers: 0,
    w220Micrometers: 0,
    w311Micrometers: 0
  };
  if (value === undefined) return result;
  if (typeof value !== "object" || value === null) {
    throw new InvalidConfigurationError("seidelCoefficients must be an object.");
  }
  for (const key of Object.keys(value)) {
    if (!(SEIDEL_KEYS as readonly string[]).includes(key)) {
      throw new InvalidConfigurationError(`seidelCoefficients.${key} is not supported.`);
    }
  }
  for (const key of SEIDEL_KEYS) {
    if (value[key] !== undefined) {
      result[key] = requireFinite(`seidelCoefficients.${key}`, value[key]);
    }
  }
  return result;
}

function pointInPolygon(
  x: number,
  y: number,
  vertices: readonly { x: number; y: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const a = vertices[i]!;
    const b = vertices[j]!;
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function parseMask(
  value: readonly { x: number; y: number }[] | undefined
): readonly { x: number; y: number }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 3 || value.length > 4096) {
    throw new InvalidScientificInputError(
      "apertureMaskVerticesMm must contain 3 through 4096 vertices."
    );
  }
  return value.map((vertex, index) => {
    if (typeof vertex !== "object" || vertex === null) {
      throw new InvalidConfigurationError(`apertureMaskVerticesMm[${index}] must be an object.`);
    }
    return {
      x: requireFinite(`apertureMaskVerticesMm[${index}].x`, vertex.x),
      y: requireFinite(`apertureMaskVerticesMm[${index}].y`, vertex.y)
    };
  });
}

/**
 * Builds a complex-pupil grid: a circular pupil, an optional polygon mask, and an OPD from Zernike
 * coefficients, Seidel coefficients or both. If every coefficient is zero, the OPD is exactly zero,
 * so the PSF equals the existing aberration-free circular-pupil reference.
 */
export function createWavefrontPupilGrid(
  input: CreateWavefrontPupilGridInput
): CalculationResult<WavefrontPupilGrid> {
  requireInputKeys(input, "createWavefrontPupilGrid", ["pupilDiameterMm", "samplesAcross", "zernikeCoefficients", "seidelCoefficients", "seidelField", "apertureMaskVerticesMm"]);
  requirePositiveFinite("pupilDiameterMm", input.pupilDiameterMm);
  const n = input.samplesAcross;
  if (
    !Number.isSafeInteger(n) ||
    n < 3 ||
    n > ZERNIKE_PUPIL_MAXIMUM_SAMPLES_ACROSS ||
    n % 2 === 0
  ) {
    throw new InvalidScientificInputError(
      `samplesAcross must be an odd integer from 3 through ${ZERNIKE_PUPIL_MAXIMUM_SAMPLES_ACROSS}.`
    );
  }
  const zernike = parseZernike(input.zernikeCoefficients);
  const seidel = parseSeidel(input.seidelCoefficients);
  const mask = parseMask(input.apertureMaskVerticesMm);
  const fieldDependent =
    seidel.w111Micrometers !== 0 ||
    seidel.w131Micrometers !== 0 ||
    seidel.w222Micrometers !== 0 ||
    seidel.w220Micrometers !== 0 ||
    seidel.w311Micrometers !== 0;
  let fieldHeight = 0;
  let fieldAzimuth = 0;
  if (input.seidelField !== undefined) {
    if (typeof input.seidelField !== "object" || input.seidelField === null) {
      throw new InvalidConfigurationError("seidelField must be an object.");
    }
    fieldHeight = requireFinite(
      "seidelField.normalizedFieldHeight",
      input.seidelField.normalizedFieldHeight
    );
    if (fieldHeight < 0 || fieldHeight > 1) {
      throw new InvalidScientificInputError(
        "seidelField.normalizedFieldHeight must lie in [0, 1]."
      );
    }
    fieldAzimuth =
      (requireFinite("seidelField.fieldAzimuthDegrees", input.seidelField.fieldAzimuthDegrees) *
        Math.PI) /
      180;
  } else if (fieldDependent) {
    throw new InvalidScientificInputError(
      "seidelField is required when a field-dependent Seidel coefficient is non-zero."
    );
  }

  const radiusMm = input.pupilDiameterMm / 2;
  const pitch = input.pupilDiameterMm / (n - 1);
  const center = (n - 1) / 2;
  const amplitude: number[] = [];
  const opd: number[] = [];
  const open: number[] = [];
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const xMm = (column - center) * pitch;
      const yMm = (row - center) * pitch;
      const rho = Math.hypot(xMm, yMm) / radiusMm;
      const inside =
        rho <= 1 + 1e-12 && (mask === undefined || pointInPolygon(xMm, yMm, mask));
      if (!inside) {
        amplitude.push(0);
        opd.push(0);
        continue;
      }
      const r = Math.min(1, rho);
      const theta = Math.atan2(yMm, xMm);
      let w = 0;
      for (const term of zernike) {
        if (term.coefficientMicrometers !== 0) {
          w += term.coefficientMicrometers * evaluateZernikePolynomial(term.nollIndex, r, theta);
        }
      }
      const cosPhi = Math.cos(theta - fieldAzimuth);
      const r2 = r * r;
      w +=
        seidel.w020Micrometers * r2 +
        seidel.w040Micrometers * r2 * r2 +
        seidel.w111Micrometers * fieldHeight * r * cosPhi +
        seidel.w131Micrometers * fieldHeight * r2 * r * cosPhi +
        seidel.w222Micrometers * fieldHeight * fieldHeight * r2 * cosPhi * cosPhi +
        seidel.w220Micrometers * fieldHeight * fieldHeight * r2 +
        seidel.w311Micrometers * fieldHeight ** 3 * r * cosPhi;
      amplitude.push(1);
      opd.push(w);
      open.push(w);
    }
  }
  if (open.length === 0) {
    throw new InvalidScientificInputError(
      "The aperture mask leaves no open pupil samples."
    );
  }
  const mean = open.reduce((sum, value) => sum + value, 0) / open.length;
  const variance =
    open.reduce((sum, value) => sum + (value - mean) ** 2, 0) / open.length;
  const zernikeRms = Math.sqrt(
    zernike
      .filter((term) => term.nollIndex >= 2)
      .reduce((sum, term) => sum + term.coefficientMicrometers ** 2, 0)
  );

  return approximationResult(
    {
      grid: {
        widthSamples: n,
        heightSamples: n,
        pupilSamplePitchMmX: pitch,
        pupilSamplePitchMmY: pitch,
        centerSampleX: center,
        centerSampleY: center,
        relativeAmplitude: amplitude,
        opticalPathDifferenceMicrometers: opd
      },
      pupilDiameterMm: input.pupilDiameterMm,
      openSampleCount: open.length,
      zernikeRmsMicrometers: zernikeRms,
      sampledRmsMicrometers: Math.sqrt(variance),
      sampledPeakToValleyMicrometers: Math.max(...open) - Math.min(...open)
    },
    "zernike-seidel-wavefront-pupil-grid",
    "1.0.0",
    [
      "Uniform unit amplitude inside the circular pupil (and inside the optional polygon mask); zero outside",
      "Noll-indexed, unit-RMS Zernike polynomials over the unit disk; Seidel terms are peak wave-aberration coefficients",
      "Pupil coordinates are metric and aligned with the image plane (+X right, +Y up)",
      "Sampled RMS differs slightly from the continuous Zernike RMS because the disk is represented by discrete samples",
      "Coefficients are caller inputs; no named-lens calibration is implied"
    ]
  );
}

/**
 * Converts a signed paraxial image-plane defocus into the defocus wave aberration
 * W020 = dz / (8 N^2) and its Noll Z4 coefficient W020 / (2 sqrt 3).
 *
 * Sign convention: dz = sensor distance minus image distance. Positive W020 means the image lies in
 * front of the sensor. With pure defocus, the PSF intensity does not depend on the sign.
 */
export function calculateDefocusWavefront(
  input: CalculateDefocusWavefrontInput
): CalculationResult<DefocusWavefront> {
  requireInputKeys(input, "calculateDefocusWavefront", ["signedDefocusImagePlaneMicrometers", "workingFNumber"]);
  const dz = requireFinite(
    "signedDefocusImagePlaneMicrometers",
    input.signedDefocusImagePlaneMicrometers
  );
  requirePositiveFinite("workingFNumber", input.workingFNumber);
  const w020 = dz / (8 * input.workingFNumber * input.workingFNumber);
  return calculatedResult(
    {
      signedDefocusImagePlaneMicrometers: dz,
      workingFNumber: input.workingFNumber,
      w020Micrometers: w020,
      zernikeZ4Micrometers: w020 / (2 * Math.sqrt(3))
    },
    "paraxial-defocus-wavefront",
    "1.0.0",
    [
      "Paraxial (small-angle) relation between longitudinal image-plane defocus and the rho^2 wave aberration",
      "Sign convention: defocus is sensor minus image distance"
    ]
  );
}

/**
 * Marechal/Mahajan approximation of the Strehl ratio: exp(-(2 pi sigma / lambda)^2). Valid only for a
 * small RMS wavefront error (Strehl roughly above 0.3). It is not an exact PSF calculation.
 */
export function estimateMarechalStrehlRatio(
  input: EstimateMarechalStrehlRatioInput
): CalculationResult<{ strehlRatio: number; rmsWaves: number }> {
  requireInputKeys(input, "estimateMarechalStrehlRatio", ["rmsWavefrontErrorMicrometers", "wavelengthNm"]);
  const sigma = requireFinite(
    "rmsWavefrontErrorMicrometers",
    input.rmsWavefrontErrorMicrometers
  );
  if (sigma < 0) {
    throw new InvalidScientificInputError(
      "rmsWavefrontErrorMicrometers must be non-negative."
    );
  }
  requirePositiveFinite("wavelengthNm", input.wavelengthNm);
  const rmsWaves = sigma / (input.wavelengthNm / 1000);
  return approximationResult(
    {
      strehlRatio: Math.exp(-((2 * Math.PI * rmsWaves) ** 2)),
      rmsWaves
    },
    "marechal-mahajan-strehl-approximation",
    "1.0.0",
    [
      "Strehl ratio approximated as exp(-(2 pi sigma / lambda)^2) (Marechal 1947; Mahajan 1982)",
      "Valid for small RMS wavefront error, roughly Strehl above 0.3; it is not an exact PSF evaluation"
    ]
  );
}
