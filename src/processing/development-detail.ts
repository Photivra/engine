// SPDX-License-Identifier: Apache-2.0

/**
 * Development detail stages (#552), both opt-in and off by default:
 *
 * - **Diffraction correction**: a bounded, regularized (Wiener–Tikhonov) deconvolution of the developed linear RGB with the
 *   diffraction OTF of an ideal circular pupil at the capture's working f-number. The OTF is zero beyond the cut-off
 *   f_c = 1/(λ·N_w), so detail beyond it never reached the sensor; the filter's design gain there is 0 and it cannot, and
 *   does not claim to, restore it.
 * - **Sharpening**: an unsharp mask (radius, amount, threshold) on the display-encoded values, after the tone curve and
 *   gamut handling and before quantization. It raises edge contrast and creates halos; it adds no optical detail.
 *
 * Development order with these stages: (exposure gain) → demosaic → colour and white balance → diffraction correction
 * (linear) → rendering exposure and tone curve → gamut handling → sRGB transfer → unsharp mask → quantization (encode).
 *
 * Image edges are handled by clamping (edge pixels repeated). Both stages work on a whole in-memory image.
 * @see docs/DIGITAL_OPTICS_FOUNDATION.md for the equations, sources, trade-offs and limits.
 */

import { encodeSrgbComponent } from "../color/srgb-transfer.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificResultError } from "../core/validation.js";
import { prepareSdrPixelTone, type SdrRenderingProfile } from "../output/sdr-rendering.js";

/** Version of the `development-detail` model (diffraction correction and unsharp mask). */
export const DEVELOPMENT_DETAIL_MODEL_VERSION = "0.1.0" as const;

/** Unsharp mask settings: Gaussian standard deviation in output pixels, gain on the detail signal, and threshold in encoded units [0, 1]. */
export interface UnsharpMaskSettings { radiusPixels: number; amount: number; threshold: number }
/** Diffraction correction settings: design wavelength, Wiener noise-to-signal regularization, gain bound and FIR radius in pixels. */
export interface DiffractionCorrectionSettings { wavelengthNm: number; regularization: number; maximumGain: number; kernelRadiusPixels: number }

/** Accepted ranges. Bounds are engineering limits on cost and on noise gain, not quality recommendations. */
export const DEVELOPMENT_DETAIL_LIMITS = /* @__PURE__ */ Object.freeze({
  maximumUnsharpRadiusPixels: 8, maximumUnsharpAmount: 5,
  minimumWavelengthNm: 380, maximumWavelengthNm: 780,
  minimumRegularization: 1e-4, maximumRegularization: 1,
  maximumGain: 10, maximumKernelRadiusPixels: 16
});

/** Third dark ring of the Airy pattern, in units of λ·N (j₁,₃/π, j₁,₃ = 10.1734681…). */
const AIRY_THIRD_ZERO_PER_LAMBDA_N = 10.173468135062722 / Math.PI;

function finiteIn(value: unknown, name: string, minimum: number, maximum: number, minimumExclusive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimumExclusive ? value <= minimum : value < minimum) || value > maximum) {
    throw new InvalidConfigurationError(name + " must be a finite number in " + (minimumExclusive ? "(" : "[") + minimum + ", " + maximum + "].");
  }
  return value;
}

/** Validates unsharp mask settings. */
export function parseUnsharpMaskSettings(value: UnsharpMaskSettings, path = "sharpening"): UnsharpMaskSettings {
  return { radiusPixels: finiteIn(value.radiusPixels, path + ".radiusPixels", 0, DEVELOPMENT_DETAIL_LIMITS.maximumUnsharpRadiusPixels, true),
    amount: finiteIn(value.amount, path + ".amount", 0, DEVELOPMENT_DETAIL_LIMITS.maximumUnsharpAmount, true),
    threshold: finiteIn(value.threshold, path + ".threshold", 0, 1) };
}
/** Validates diffraction correction settings. */
export function parseDiffractionCorrectionSettings(value: DiffractionCorrectionSettings, path = "diffractionCorrection"): DiffractionCorrectionSettings {
  const radius = value.kernelRadiusPixels;
  if (typeof radius !== "number" || !Number.isSafeInteger(radius) || radius < 1 || radius > DEVELOPMENT_DETAIL_LIMITS.maximumKernelRadiusPixels) {
    throw new InvalidConfigurationError(path + ".kernelRadiusPixels must be an integer from 1 to " + DEVELOPMENT_DETAIL_LIMITS.maximumKernelRadiusPixels + ".");
  }
  return { wavelengthNm: finiteIn(value.wavelengthNm, path + ".wavelengthNm", DEVELOPMENT_DETAIL_LIMITS.minimumWavelengthNm, DEVELOPMENT_DETAIL_LIMITS.maximumWavelengthNm),
    regularization: finiteIn(value.regularization, path + ".regularization", DEVELOPMENT_DETAIL_LIMITS.minimumRegularization, DEVELOPMENT_DETAIL_LIMITS.maximumRegularization),
    maximumGain: finiteIn(value.maximumGain, path + ".maximumGain", 1, DEVELOPMENT_DETAIL_LIMITS.maximumGain), kernelRadiusPixels: radius };
}
/** Default FIR radius: the Airy pattern's third dark ring (3.2383·λ·N_w) in pixels, rounded up, within 1..16. */
export function defaultDiffractionCorrectionRadiusPixels(workingFNumber: number, wavelengthNm: number, pixelPitchMicrometers: number): number {
  const sites = Math.ceil(AIRY_THIRD_ZERO_PER_LAMBDA_N * wavelengthNm / 1000 * workingFNumber / pixelPitchMicrometers);
  return Math.min(DEVELOPMENT_DETAIL_LIMITS.maximumKernelRadiusPixels, Math.max(1, sites));
}

/**
 * Incoherent OTF of an ideal, aberration-free circular pupil at normalized frequency s = f/f_c:
 * H(s) = (2/π)(acos s − s·√(1 − s²)) for s < 1, and 0 for s ≥ 1 (MIT OCW 2.71, lectures 21–22; Goodman, §7.3).
 */
export function circularPupilDiffractionMtf(normalizedFrequency: number): number {
  const s = Math.abs(normalizedFrequency);
  if (s >= 1) return 0;
  return 2 / Math.PI * (Math.acos(s) - s * Math.sqrt(1 - s * s));
}

/** A designed diffraction correction filter and what its response does. Frequencies are in cycles per pixel. */
export interface DiffractionCorrectionFilter {
  settings: DiffractionCorrectionSettings;
  workingFNumber: number;
  pixelPitchMicrometers: number;
  /** f_c · pitch = pitch/(λ·N_w): the diffraction cut-off. The sampling Nyquist frequency is 0.5. */
  cutoffCyclesPerPixel: number;
  /** Fraction of the Nyquist square |fx|, |fy| ≤ 0.5 lying beyond the cut-off, where the lens transmitted nothing. */
  nyquistAreaBeyondCutoffFraction: number;
  /** Largest gain of the designed (untruncated) response: min(maximumGain, max over s of H(1+α)/(H² + α)). */
  designPeakGain: number;
  /** Largest |response| of the windowed, truncated FIR over a 1/64-cycle grid of the Nyquist square. */
  responsePeakGain: number;
  /**
   * Largest |response| of the FIR at grid frequencies beyond the cut-off (null when the whole Nyquist square is inside it).
   * The design is 0 there; a non-zero value is truncation leakage that passes noise and aliased signal, never lost detail,
   * because the optics delivered no signal at those frequencies.
   */
  responseMaximumBeyondCutoff: number | null;
  /** Row-major (2R+1)² weights summing to 1; weights[(dy + R)(2R + 1) + dx + R]. */
  weights: Float64Array;
}

/**
 * Designs the bounded Wiener–Tikhonov correction. In frequency (normalized s = ρ/f_c, ρ the radial frequency):
 *   G(s) = min(maximumGain, H(s)·(1 + α)/(H(s)² + α)),   G(0) = 1, and G(s) = 0 for s ≥ 1,
 * where α is the regularization (an assumed noise-to-signal power ratio, Wiener's K). The response is sampled on an M × M
 * grid (M a power of two ≥ max(64, 4(2R + 1))), inverse transformed, truncated to the (2R + 1)² window with a radial raised
 * cosine taper and renormalized to unit sum. The achieved response is then measured, not assumed.
 */
export function designDiffractionCorrectionFilter(input: { workingFNumber: number; pixelPitchMicrometers: number; settings: DiffractionCorrectionSettings }): DiffractionCorrectionFilter {
  const settings = parseDiffractionCorrectionSettings(input.settings);
  const workingFNumber = finiteIn(input.workingFNumber, "workingFNumber", 0, 1e4, true), pitch = finiteIn(input.pixelPitchMicrometers, "pixelPitchMicrometers", 0, 1e4, true);
  const cutoff = pitch / (settings.wavelengthNm / 1000 * workingFNumber), alpha = settings.regularization, bound = settings.maximumGain;
  const gainAt = (rho: number): number => {
    const h = circularPupilDiffractionMtf(rho / cutoff);
    return h === 0 ? 0 : Math.min(bound, h * (1 + alpha) / (h * h + alpha));
  };
  const R = settings.kernelRadiusPixels, size = 2 * R + 1;
  let M = 64;
  while (M < 4 * size) M *= 2;
  // A(ky, x) = Σ_kx G cos(2π kx x/M); h(x, y) = (1/M²) Σ_ky cos(2π ky y/M) A(ky, x). G is even in each axis, so h is real and even.
  const cosTable = new Float64Array(M * (R + 1));
  for (let k = 0; k < M; k++) for (let x = 0; x <= R; x++) cosTable[k * (R + 1) + x] = Math.cos(2 * Math.PI * k * x / M);
  const A = new Float64Array(M * (R + 1));
  for (let ky = 0; ky < M; ky++) {
    const fy = (ky < M / 2 ? ky : ky - M) / M;
    for (let kx = 0; kx < M; kx++) {
      const fx = (kx < M / 2 ? kx : kx - M) / M, g = gainAt(Math.hypot(fx, fy));
      if (g === 0) continue;
      for (let x = 0; x <= R; x++) A[ky * (R + 1) + x]! += g * cosTable[kx * (R + 1) + x]!;
    }
  }
  const quarter = new Float64Array((R + 1) * (R + 1));
  for (let y = 0; y <= R; y++) for (let x = 0; x <= R; x++) {
    let sum = 0;
    for (let ky = 0; ky < M; ky++) sum += cosTable[ky * (R + 1) + y]! * A[ky * (R + 1) + x]!;
    const r = Math.hypot(x, y), taper = r < R + 1 ? 0.5 * (1 + Math.cos(Math.PI * r / (R + 1))) : 0;
    quarter[y * (R + 1) + x] = sum / (M * M) * taper;
  }
  const weights = new Float64Array(size * size);
  let total = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const w = quarter[Math.abs(dy) * (R + 1) + Math.abs(dx)]!;
    weights[(dy + R) * size + dx + R] = w; total += w;
  }
  if (!(total > 0) || !Number.isFinite(total)) throw new InvalidScientificResultError("Diffraction correction filter has no finite DC response.");
  for (let i = 0; i < weights.length; i++) weights[i] = weights[i]! / total;
  let designPeakGain = 0;
  for (let i = 0; i <= 4096; i++) designPeakGain = Math.max(designPeakGain, gainAt(i / 4096 * cutoff));
  let responsePeakGain = 0, beyond: number | null = null, beyondCount = 0;
  const GRID = 64;
  for (let iy = 0; iy <= GRID / 2; iy++) for (let ix = 0; ix <= GRID / 2; ix++) {
    const fx = ix / GRID, fy = iy / GRID, response = Math.abs(evaluateDiffractionCorrectionResponse(weights, R, fx, fy));
    responsePeakGain = Math.max(responsePeakGain, response);
    if (Math.hypot(fx, fy) >= cutoff) beyond = Math.max(beyond ?? 0, response);
  }
  const AREA = 256;
  for (let iy = 0; iy < AREA; iy++) for (let ix = 0; ix < AREA; ix++) if (Math.hypot((ix + 0.5) / (2 * AREA), (iy + 0.5) / (2 * AREA)) >= cutoff) beyondCount++;
  return { settings, workingFNumber, pixelPitchMicrometers: pitch, cutoffCyclesPerPixel: cutoff, nyquistAreaBeyondCutoffFraction: beyondCount / (AREA * AREA),
    designPeakGain, responsePeakGain, responseMaximumBeyondCutoff: beyond, weights };
}
/** Frequency response Σ w(x, y)·cos(2π(fx·x + fy·y)) of a centred (2R + 1)² FIR at (fx, fy) cycles per pixel. */
export function evaluateDiffractionCorrectionResponse(weights: Float64Array, radius: number, fx: number, fy: number): number {
  const size = 2 * radius + 1;
  let sum = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) sum += weights[(dy + radius) * size + dx + radius]! * Math.cos(2 * Math.PI * (fx * dx + fy * dy));
  return sum;
}

/** What the correction did to the linear samples. */
export interface DiffractionCorrectionDiagnostics {
  /** Corrected samples below 0 (ringing below black). They are clipped by the later gamut handling. */
  negativeSampleCount: number;
  /** Corrected samples above 1 (above the RAW white level). */
  aboveWhiteSampleCount: number;
}
/**
 * Applies the FIR to interleaved linear RGB (width × height × 3), each channel separately, edges clamped. Returns new samples.
 */
export function applyDiffractionCorrection(rgb: Float64Array, width: number, height: number, filter: Pick<DiffractionCorrectionFilter, "weights" | "settings">):
  { samples: Float64Array; diagnostics: DiffractionCorrectionDiagnostics } {
  if (rgb.length !== width * height * 3) throw new InvalidConfigurationError("Diffraction correction raster size mismatch.");
  const R = filter.settings.kernelRadiusPixels, size = 2 * R + 1, w = filter.weights, out = new Float64Array(rgb.length);
  const xs = new Int32Array(width + 2 * R);
  for (let i = 0; i < xs.length; i++) xs[i] = Math.min(width - 1, Math.max(0, i - R)) * 3;
  let negative = 0, above = 0;
  for (let y = 0; y < height; y++) {
    const o = y * width * 3;
    for (let dy = -R; dy <= R; dy++) {
      const row = Math.min(height - 1, Math.max(0, y + dy)) * width * 3, wr = (dy + R) * size;
      for (let dx = 0; dx < size; dx++) {
        const weight = w[wr + dx]!;
        if (weight === 0) continue;
        for (let x = 0; x < width; x++) {
          const s = row + xs[x + dx]!, d = o + 3 * x;
          out[d] = out[d]! + weight * rgb[s]!; out[d + 1] = out[d + 1]! + weight * rgb[s + 1]!; out[d + 2] = out[d + 2]! + weight * rgb[s + 2]!;
        }
      }
    }
  }
  for (let i = 0; i < out.length; i++) {
    const v = out[i]!;
    if (!Number.isFinite(v)) throw new InvalidScientificResultError("Diffraction correction produced a non-finite sample.");
    if (v < 0) negative++; else if (v > 1) above++;
  }
  return { samples: out, diagnostics: { negativeSampleCount: negative, aboveWhiteSampleCount: above } };
}

/** Normalized Gaussian weights exp(−i²/(2σ²)), i = −r..r with r = ⌈3σ⌉. */
export function unsharpMaskKernel(radiusPixels: number): Float64Array {
  const r = Math.ceil(3 * radiusPixels), k = new Float64Array(2 * r + 1);
  let total = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * radiusPixels * radiusPixels)); k[i + r] = v; total += v; }
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / total;
  return k;
}
/** What the unsharp mask did. Counts are samples (one per channel). */
export interface UnsharpMaskDiagnostics {
  /** Half-width of the separable Gaussian, ⌈3σ⌉ pixels. */
  kernelRadiusPixels: number;
  /** Samples changed by the mask (|detail| ≥ threshold and detail ≠ 0). */
  sharpenedSampleCount: number;
  /** Samples left unchanged because 0 < |detail| < threshold. */
  thresholdHeldSampleCount: number;
  /** Sharpened samples clipped at 0 or 1 (the halo did not fit in the code range). */
  clippedLowSampleCount: number;
  clippedHighSampleCount: number;
  /** Largest increase and decrease amount·detail before clipping, in encoded units: the halo strength. */
  maximumIncrease: number;
  maximumDecrease: number;
}
/**
 * Unsharp mask on interleaved encoded RGB in [0, 1] (each channel separately, edges clamped):
 *   d = x − (G_σ ∗ x);   y = x + amount·d where |d| ≥ threshold, else y = x;   then y is clipped to [0, 1].
 * Returns new samples.
 */
export function applyUnsharpMask(encoded: Float64Array, width: number, height: number, settings: UnsharpMaskSettings):
  { samples: Float64Array; diagnostics: UnsharpMaskDiagnostics } {
  const s = parseUnsharpMaskSettings(settings);
  if (encoded.length !== width * height * 3) throw new InvalidConfigurationError("Unsharp mask raster size mismatch.");
  const k = unsharpMaskKernel(s.radiusPixels), r = (k.length - 1) / 2, horizontal = new Float64Array(encoded.length), blurred = new Float64Array(encoded.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const d = (y * width + x) * 3;
    let a = 0, b = 0, c = 0;
    for (let i = -r; i <= r; i++) {
      const sx = (y * width + Math.min(width - 1, Math.max(0, x + i))) * 3, w = k[i + r]!;
      a += w * encoded[sx]!; b += w * encoded[sx + 1]!; c += w * encoded[sx + 2]!;
    }
    horizontal[d] = a; horizontal[d + 1] = b; horizontal[d + 2] = c;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const d = (y * width + x) * 3;
    let a = 0, b = 0, c = 0;
    for (let i = -r; i <= r; i++) {
      const sy = (Math.min(height - 1, Math.max(0, y + i)) * width + x) * 3, w = k[i + r]!;
      a += w * horizontal[sy]!; b += w * horizontal[sy + 1]!; c += w * horizontal[sy + 2]!;
    }
    blurred[d] = a; blurred[d + 1] = b; blurred[d + 2] = c;
  }
  const out = new Float64Array(encoded.length);
  let sharpened = 0, held = 0, low = 0, high = 0, increase = 0, decrease = 0;
  for (let i = 0; i < encoded.length; i++) {
    const x = encoded[i]!, detail = x - blurred[i]!;
    if (detail === 0 || Math.abs(detail) < s.threshold) { if (detail !== 0) held++; out[i] = x; continue; }
    const change = s.amount * detail;
    let v = x + change;
    sharpened++;
    if (change > increase) increase = change;
    if (-change > decrease) decrease = -change;
    if (v < 0) { v = 0; low++; } else if (v > 1) { v = 1; high++; }
    out[i] = v;
  }
  return { samples: out, diagnostics: { kernelRadiusPixels: r, sharpenedSampleCount: sharpened, thresholdHeldSampleCount: held, clippedLowSampleCount: low,
    clippedHighSampleCount: high, maximumIncrease: increase, maximumDecrease: decrease } };
}

/** SDR counters in the shape of the SDR rendering diagnostics. */
export interface DetailSdrCounts { negative: number; above: number; changed: number; low: number; high: number }
/**
 * SDR rendering with an unsharp mask between the sRGB transfer and quantization. Per pixel it runs the reference renderer's
 * operations in its order (−0 → +0, rendering exposure 2^EV with reference white 1, the shared tone operator, gamut
 * handling, sRGB transfer); the whole encoded image is then sharpened and rounded to nearest (ties up).
 */
export function renderSdrWithUnsharpMask(rgb: Float64Array, width: number, height: number, profile: SdrRenderingProfile, settings: UnsharpMaskSettings):
  { codes: Uint8Array | Uint16Array; counts: DetailSdrCounts; sharpening: UnsharpMaskDiagnostics } {
  if (rgb.length !== width * height * 3) throw new InvalidConfigurationError("SDR raster size mismatch.");
  const scale = 2 ** profile.renderingExposureEv, tone = prepareSdrPixelTone(profile), scratch = new Float64Array(3), encoded = new Float64Array(rgb.length);
  if (!Number.isFinite(scale) || scale <= 0) throw new InvalidConfigurationError("Rendering scale is unrepresentable.");
  const reject = profile.gamutHandling === "reject-out-of-range", counts: DetailSdrCounts = { negative: 0, above: 0, changed: 0, low: 0, high: 0 };
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i]!, g = rgb[i + 1]!, b = rgb[i + 2]!;
    const er = (r === 0 ? 0 : r) * scale, eg = (g === 0 ? 0 : g) * scale, eb = (b === 0 ? 0 : b) * scale;
    if (!Number.isFinite(er) || !Number.isFinite(eg) || !Number.isFinite(eb)) throw new InvalidScientificResultError("Rendering exposure produced a non-finite sample.");
    tone(er, eg, eb, scratch);
    for (let c = 0; c < 3; c++) {
      const exposed = c === 0 ? er : c === 1 ? eg : eb;
      if (exposed < 0) counts.negative++;
      if (exposed > 1) counts.above++;
      let mapped = scratch[c]!;
      if (mapped !== exposed) counts.changed++;
      if (mapped === 0) mapped = 0;
      if (mapped < 0 || mapped > 1) {
        if (reject) throw new InvalidConfigurationError("Tone output exceeds the declared SDR gamut range.");
        if (mapped < 0) { counts.low++; mapped = 0; } else { counts.high++; mapped = 1; }
      }
      encoded[i + c] = encodeSrgbComponent(mapped);
    }
  }
  const sharpened = applyUnsharpMask(encoded, width, height, settings), maximum = 2 ** profile.bitDepth - 1;
  const codes = profile.bitDepth === 8 ? new Uint8Array(rgb.length) : new Uint16Array(rgb.length);
  for (let i = 0; i < codes.length; i++) codes[i] = Math.round(sharpened.samples[i]! * maximum);
  return { codes, counts, sharpening: sharpened.diagnostics };
}
