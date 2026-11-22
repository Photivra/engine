// SPDX-License-Identifier: Apache-2.0

/**
 * Image-domain denoising, sharpening and synthetic film grain on linear or developed RGB:
 * - Bilateral filter (Tomasi & Manduchi, ICCV 1998): Gaussian spatial and Gaussian range weights,
 *   range distance Euclidean over the three channels of the supplied data.
 * - Non-local means (Buades, Coll & Morel, CVPR 2005): weights exp(−max(d² − 2σ², 0)/h²), where d² is
 *   the mean squared difference of (2f+1)² patches over all channels. This is the uniform-patch form
 *   with the known-noise offset from Buades et al., IPOL 2011; σ = 0 gives the 2005 form with a
 *   uniform patch kernel. The centre pixel gets the largest weight in its search window.
 * - Unsharp masking: out = in + amount·(in − G_σ ⊗ in) where |in − G_σ ⊗ in| > threshold.
 * - Synthetic film grain: an aesthetic, deterministic, signal-dependent texture. It is NOT a physical
 *   film model (no silver-halide grain statistics, dye clouds or film characteristic curve).
 * Noise in linear RAW-derived data depends on the signal level, but these filters use one global set of
 * parameters.
 * @see docs/PROCESSING.md for equations, sources and limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { createDeterministicUniformStream, deriveNativeSiteStreamSeedUint32, sampleDeterministicStandardNormal } from "../sensor/stochastic-seed.js";
import { convolveRows, convolveSeparable, gaussianKernel, reflect } from "./image-ops.js";
import {
  createProcessingTask, finiteRows, maximumWorkingBytes, optionalFiniteIn, optionalIntegerIn, processingProvenance, requireEnum, requireFiniteIn, requireFiniteOutput,
  requireImage, requireOptions,
  type ProcessingBody, type ProcessingProvenance, type ProcessingProvider, type ProcessingRgbImage, type ProcessingTask
} from "./processing-task.js";

export interface ProcessedRgbImage extends ProcessingRgbImage {
  provenance: ProcessingProvenance;
}

export interface BilateralFilterInput {
  image: ProcessingRgbImage;
  spatialSigmaPixels: number;
  /** Range σ in the units of the image values. */
  rangeSigma: number;
  maximumWorkingBytes?: number;
}

/** Brute-force bilateral filter (window radius ⌈3σ_s⌉, reflect-101 borders). */
export function createBilateralFilterTask(input: BilateralFilterInput, provider: ProcessingProvider): ProcessingTask<ProcessedRgbImage> {
  const r = requireOptions(input, ["image", "spatialSigmaPixels", "rangeSigma", "maximumWorkingBytes"], "createBilateralFilterTask input");
  const image = requireImage(r.image, "image"), sigmaS = requireFiniteIn(r.spatialSigmaPixels, "spatialSigmaPixels", 0, 64, true);
  const sigmaR = requireFiniteIn(r.rangeSigma, "rangeSigma", 0, 1e30, true), W = image.width, H = image.height, rad = Math.ceil(3 * sigmaS);
  const spatial = new Float64Array((2 * rad + 1) ** 2);
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) spatial[(dy + rad) * (2 * rad + 1) + dx + rad] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS));
  return createProcessingTask({
    provider, totalTileCount: 2 * H, estimatedWorkingBytes: W * H * 12, maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<ProcessedRgbImage> {
      yield* finiteRows(image.data, W, H, 3, "image");
      const d = image.data, out = new Float32Array(3 * W * H), k = 1 / (2 * sigmaR * sigmaR);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = 3 * (y * W + x), r0 = d[i]!, g0 = d[i + 1]!, b0 = d[i + 2]!;
          let ws = 0, sr = 0, sg = 0, sb = 0;
          for (let dy = -rad; dy <= rad; dy++) {
            const row = reflect(y + dy, H) * W;
            for (let dx = -rad; dx <= rad; dx++) {
              const j = 3 * (row + reflect(x + dx, W)), R = d[j]!, G = d[j + 1]!, B = d[j + 2]!;
              const w = spatial[(dy + rad) * (2 * rad + 1) + dx + rad]! * Math.exp(-((R - r0) ** 2 + (G - g0) ** 2 + (B - b0) ** 2) * k);
              ws += w; sr += w * R; sg += w * G; sb += w * B;
            }
          }
          out[i] = sr / ws; out[i + 1] = sg / ws; out[i + 2] = sb / ws;
        }
        requireFiniteOutput(out, 3 * y * W, 3 * (y + 1) * W, "Bilateral filter (rangeSigma)");
        yield;
      }
      return { width: W, height: H, data: out, provenance: processingProvenance("denoise-bilateral-tomasi-manduchi-1998", [
        "Gaussian spatial (sigma " + sigmaS + " px, radius " + rad + ") times Gaussian range weight on Euclidean RGB distance (sigma " + sigmaR + ").",
        "Range distance in the supplied data's units, not CIELAB; reflect-101 borders; one global parameter set (noise is not modelled per pixel)."]) };
    }
  });
}

export interface NonLocalMeansInput {
  image: ProcessingRgbImage;
  /** Filtering parameter h (image units). */
  filteringParameter: number;
  /** Known noise standard deviation σ (image units); default 0. */
  noiseStandardDeviation?: number;
  /** Patch radius f (patch (2f+1)²); default 1. */
  patchRadius?: number;
  /** Search-window radius r ((2r+1)² candidates); default 5. */
  searchRadius?: number;
  maximumWorkingBytes?: number;
}

/** Non-local means (Buades, Coll & Morel 2005), offset-major with box-filtered patch distances. */
export function createNonLocalMeansTask(input: NonLocalMeansInput, provider: ProcessingProvider): ProcessingTask<ProcessedRgbImage> {
  const r = requireOptions(input, ["image", "filteringParameter", "noiseStandardDeviation", "patchRadius", "searchRadius", "maximumWorkingBytes"],
    "createNonLocalMeansTask input");
  const image = requireImage(r.image, "image"), h = requireFiniteIn(r.filteringParameter, "filteringParameter", 0, 1e30, true);
  const sigma = optionalFiniteIn(r.noiseStandardDeviation, 0, "noiseStandardDeviation", 0, 1e30);
  const f = optionalIntegerIn(r.patchRadius, 1, "patchRadius", 0, 16), sr = optionalIntegerIn(r.searchRadius, 5, "searchRadius", 1, 32);
  const W = image.width, H = image.height, n = W * H, offsets = (2 * sr + 1) ** 2 - 1;
  const box = new Float64Array(2 * f + 1).fill(1 / (2 * f + 1));
  return createProcessingTask({
    provider, totalTileCount: H + offsets * (2 * H + convolveRows(H)) + H, estimatedWorkingBytes: n * (12 + 4 * 5 + 12),
    maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<ProcessedRgbImage> {
      yield* finiteRows(image.data, W, H, 3, "image");
      const d = image.data, acc = new Float32Array(3 * n), wsum = new Float32Array(n), wmax = new Float32Array(n);
      const diff = new Float32Array(n), tmp = new Float32Array(n), dist = new Float32Array(n), inv = 1 / (h * h), offset2 = 2 * sigma * sigma;
      for (let oy = -sr; oy <= sr; oy++) for (let ox = -sr; ox <= sr; ox++) {
        if (ox === 0 && oy === 0) continue;
        for (let y = 0; y < H; y++) {
          const yy = reflect(y + oy, H) * W;
          for (let x = 0; x < W; x++) {
            const i = 3 * (y * W + x), j = 3 * (yy + reflect(x + ox, W));
            diff[y * W + x] = ((d[i]! - d[j]!) ** 2 + (d[i + 1]! - d[j + 1]!) ** 2 + (d[i + 2]! - d[j + 2]!) ** 2) / 3;
          }
          yield;
        }
        yield* convolveSeparable(diff, W, H, 1, box, tmp, dist);
        for (let y = 0; y < H; y++) {
          const yy = reflect(y + oy, H) * W;
          for (let x = 0; x < W; x++) {
            const p = y * W + x, j = 3 * (yy + reflect(x + ox, W)), w = Math.exp(-Math.max(dist[p]! - offset2, 0) * inv);
            acc[3 * p] = acc[3 * p]! + w * d[j]!; acc[3 * p + 1] = acc[3 * p + 1]! + w * d[j + 1]!; acc[3 * p + 2] = acc[3 * p + 2]! + w * d[j + 2]!;
            wsum[p] = wsum[p]! + w; if (w > wmax[p]!) wmax[p] = w;
          }
          yield;
        }
      }
      const out = new Float32Array(3 * n);
      for (let y = 0; y < H; y++) {
        for (let p = y * W; p < (y + 1) * W; p++) {
          const wc = wmax[p]!, total = wsum[p]! + wc;
          for (let c = 0; c < 3; c++) out[3 * p + c] = total > 0 ? (acc[3 * p + c]! + wc * d[3 * p + c]!) / total : d[3 * p + c]!;
        }
        yield;
      }
      return { width: W, height: H, data: out, provenance: processingProvenance("denoise-non-local-means-buades-2005", [
        "Weights exp(-max(d^2 - 2 sigma^2, 0)/h^2); d^2 = mean squared difference over a uniform (2f+1)^2 patch and all channels.",
        "Search window (2r+1)^2 with reflect-101 borders; centre weight = largest other weight.",
        "One global h and sigma; signal-dependent RAW noise needs a variance-stabilizing transform not applied here."]) };
    }
  });
}

export interface UnsharpMaskInput {
  image: ProcessingRgbImage;
  radiusSigmaPixels: number;
  amount: number;
  /** Detail magnitude below which a component is left unchanged; default 0. */
  threshold?: number;
  maximumWorkingBytes?: number;
}

/** Unsharp masking: in + amount·(in − G_σ ⊗ in) where the detail exceeds the threshold. */
export function createUnsharpMaskTask(input: UnsharpMaskInput, provider: ProcessingProvider): ProcessingTask<ProcessedRgbImage> {
  const r = requireOptions(input, ["image", "radiusSigmaPixels", "amount", "threshold", "maximumWorkingBytes"], "createUnsharpMaskTask input");
  const image = requireImage(r.image, "image"), sigma = requireFiniteIn(r.radiusSigmaPixels, "radiusSigmaPixels", 0, 256, true);
  const amount = requireFiniteIn(r.amount, "amount", 0, 100), threshold = optionalFiniteIn(r.threshold, 0, "threshold", 0, 1e30);
  const W = image.width, H = image.height, kernel = gaussianKernel(sigma);
  return createProcessingTask({
    provider, totalTileCount: H + convolveRows(H) + H, estimatedWorkingBytes: W * H * 36, maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<ProcessedRgbImage> {
      yield* finiteRows(image.data, W, H, 3, "image");
      const d = image.data, blur = new Float32Array(d.length), tmp = new Float32Array(d.length), out = new Float32Array(d.length);
      yield* convolveSeparable(d, W, H, 3, kernel, tmp, blur);
      for (let y = 0; y < H; y++) {
        for (let i = 3 * y * W; i < 3 * (y + 1) * W; i++) {
          const detail = d[i]! - blur[i]!;
          out[i] = Math.abs(detail) > threshold ? d[i]! + amount * detail : d[i]!;
        }
        requireFiniteOutput(out, 3 * y * W, 3 * (y + 1) * W, "Unsharp mask (amount)");
        yield;
      }
      return { width: W, height: H, data: out, provenance: processingProvenance("sharpen-unsharp-mask", [
        "out = in + amount (in - G_sigma * in) per component where |in - G_sigma * in| > threshold; sigma " + sigma + " px, reflect-101 borders.",
        "Output is not clipped; overshoot (halo) at edges is inherent to unsharp masking."]) };
    }
  });
}

/** Random-stream id for synthetic grain. Different from every RAW charge, read-noise and fixed-pattern stream. */
export const SYNTHETIC_FILM_GRAIN_STREAM_ID = 64 as const;

export interface SyntheticFilmGrainInput {
  /** Display-referred (encoded) RGB with values in [0, 1]. */
  image: ProcessingRgbImage;
  /** uint32 seed; equal seeds reproduce the grain exactly. */
  seedUint32: number;
  /** Grain standard deviation at mid-grey (value 0.5), in encoded units. */
  intensity: number;
  /** Spatial correlation σ of the grain in pixels; 0 = per-pixel white grain. Default 0.7. */
  grainSizePixels?: number;
  /** `monochrome` (default) adds one grain field to all channels; `per-channel` uses three. */
  mode?: "monochrome" | "per-channel";
  maximumWorkingBytes?: number;
}

export interface SyntheticFilmGrainOutput extends ProcessedRgbImage {
  /** Always true: the grain is an aesthetic texture, not a physical film model. */
  syntheticAesthetic: true;
  physicalFilmModel: false;
  clippedSampleCount: number;
}

/**
 * Adds deterministic synthetic grain:
 * 1. Unit-variance Gaussian white noise per pixel. It is seeded by the absolute pixel index, so tiling
 *    never changes it.
 * 2. Optionally blurred by a Gaussian with σ = grain size, then renormalized to unit variance.
 * 3. Scaled by a(v) = intensity·2√(v(1 − v)): zero at black and white, `intensity` at mid-grey.
 * 4. Clipped to [0, 1].
 * It is labelled synthetic and aesthetic. It is never a film model.
 */
export function createSyntheticFilmGrainTask(input: SyntheticFilmGrainInput, provider: ProcessingProvider): ProcessingTask<SyntheticFilmGrainOutput> {
  const r = requireOptions(input, ["image", "seedUint32", "intensity", "grainSizePixels", "mode", "maximumWorkingBytes"], "createSyntheticFilmGrainTask input");
  const image = requireImage(r.image, "image");
  if (typeof r.seedUint32 !== "number" || !Number.isInteger(r.seedUint32) || r.seedUint32 < 0 || r.seedUint32 > 0xffffffff) {
    throw new InvalidConfigurationError("seedUint32 must be a uint32 integer.");
  }
  const seed = r.seedUint32, intensity = requireFiniteIn(r.intensity, "intensity", 0, 1), size = optionalFiniteIn(r.grainSizePixels, 0.7, "grainSizePixels", 0, 64);
  const mode = requireEnum(r.mode, ["monochrome", "per-channel"] as const, "mode", "monochrome"), channels = mode === "monochrome" ? 1 : 3;
  const W = image.width, H = image.height, n = W * H, kernel = gaussianKernel(size);
  let k2 = 0;
  for (const v of kernel) k2 += v * v;
  return createProcessingTask({
    provider, totalTileCount: 3 * H + convolveRows(H), estimatedWorkingBytes: n * channels * 12 + n * 12, maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<SyntheticFilmGrainOutput> {
      yield* finiteRows(image.data, W, H, 3, "image", 0);
      const noise = new Float32Array(n * channels), tmp = new Float32Array(n * channels), field = new Float32Array(n * channels);
      for (let y = 0; y < H; y++) {
        for (let p = y * W; p < (y + 1) * W; p++) {
          const stream = createDeterministicUniformStream(deriveNativeSiteStreamSeedUint32(seed, p, SYNTHETIC_FILM_GRAIN_STREAM_ID));
          for (let c = 0; c < channels; c++) noise[p * channels + c] = sampleDeterministicStandardNormal(stream);
        }
        yield;
      }
      // Blurred white noise has variance (Σk²)² for a separable kernel; dividing by Σk² restores unit variance.
      yield* convolveSeparable(noise, W, H, channels, kernel, tmp, field);
      const d = image.data, out = new Float32Array(3 * n);
      let clipped = 0;
      for (let y = 0; y < H; y++) {
        for (let p = y * W; p < (y + 1) * W; p++) for (let c = 0; c < 3; c++) {
          const v = Math.min(d[3 * p + c]!, 1), a = intensity * 2 * Math.sqrt(v * (1 - v));
          let o = v + a * field[p * channels + (channels === 1 ? 0 : c)]! / k2;
          if (o < 0) { o = 0; clipped++; } else if (o > 1) { o = 1; clipped++; }
          out[3 * p + c] = o;
        }
        yield;
      }
      return { width: W, height: H, data: out, syntheticAesthetic: true, physicalFilmModel: false, clippedSampleCount: clipped,
        provenance: processingProvenance("synthetic-aesthetic-film-grain", [
          "Synthetic aesthetic texture only: not a physical film, silver-halide or dye-cloud model.",
          "Deterministic per-pixel Gaussian noise (seed " + seed + ", stream " + SYNTHETIC_FILM_GRAIN_STREAM_ID + "), Gaussian-correlated (sigma " + size + " px), unit variance.",
          "Amplitude intensity*2*sqrt(v(1-v)) on encoded values; output clipped to [0, 1]."]) };
    }
  });
}
