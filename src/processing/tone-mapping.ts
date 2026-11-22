// SPDX-License-Identifier: Apache-2.0

/**
 * HDR → SDR tone-mapping operators, and exposure fusion. Each is a named rendering choice (an
 * approximation), not a perceptual or display-calibrated model:
 * - Reinhard et al. 2002 global photographic operator: log-average key, L = a·L_w/L̄_w,
 *   L_d = L(1 + L/L_white²)/(1 + L); colour by the luminance ratio L_d/L_w (chromaticity-preserving).
 * - Durand & Dorsey 2002 local operator: base = bilateral(log₁₀ L), detail = log₁₀ L − base,
 *   output log = base·c + detail − max(base)·c with c = log₁₀(contrast)/(max(base) − min(base)); the
 *   bilateral filter uses the paper's piecewise-linear acceleration with spatial downsampling.
 * - Mertens, Kautz & Van Reeth 2007 exposure fusion of display-referred frames: per-pixel weight
 *   W = C^ωc·S^ωs·E^ωe from Laplacian contrast, RGB standard deviation and well-exposedness
 *   exp(−(v − 0.5)²/(2·0.2²)), normalized across frames and blended with Laplacian pyramids
 *   (Burt & Adelson 1983).
 * The HDR operators output display-referred linear RGB in the input primaries; encode it with the SDR
 * rendering functions. Fusion output stays in the (encoded) domain of its inputs.
 * @see docs/PROCESSING.md for equations, sources and limits.
 */

import { InvalidScientificInputError, InvalidScientificResultError } from "../core/validation.js";
import {
  autoLevels, collapse, collapseRows, convolveRows, convolveSeparable, gaussianKernel, gaussianPyramid, gaussianPyramidRows, laplacianPyramid,
  laplacianPyramidRows, luminanceWeights, pyramidBytes, reflect
} from "./image-ops.js";
import {
  createProcessingTask, finiteRows, maximumWorkingBytes, requireFiniteOutput, optionalFiniteIn, optionalIntegerIn, processingProvenance, requireEnum, requireImage,
  requireImageList, requireOptions,
  type ProcessingBody, type ProcessingLinearColorSpace, type ProcessingProvenance, type ProcessingProvider, type ProcessingRgbImage, type ProcessingTask
} from "./processing-task.js";

const SPACES = ["linear-srgb-d65", "linear-display-p3-d65", "linear-rec2020-d65"] as const;

export interface ToneMappedImage extends ProcessingRgbImage {
  /** Output components above 1 (left unclipped for the downstream gamut/encoding stage). */
  aboveOneSampleCount: number;
  provenance: ProcessingProvenance;
}

export interface ReinhardGlobalToneMappingInput {
  image: ProcessingRgbImage;
  inputColorSpace: ProcessingLinearColorSpace;
  /** Key value a; default 0.18. */
  key?: number;
  /** Smallest scaled luminance mapped to white; default the largest scaled luminance. */
  whiteLuminance?: number;
  /** δ in the log-average exp(mean(log(δ + L_w))); default 1e-6. */
  logAverageDelta?: number;
  maximumWorkingBytes?: number;
}

export interface ReinhardGlobalToneMappingOutput extends ToneMappedImage {
  logAverageLuminance: number;
  whiteLuminance: number;
}

/** Reinhard, Stark, Shirley & Ferwerda (2002) global photographic tone reproduction. */
export function createReinhardGlobalToneMappingTask(input: ReinhardGlobalToneMappingInput, provider: ProcessingProvider): ProcessingTask<ReinhardGlobalToneMappingOutput> {
  const r = requireOptions(input, ["image", "inputColorSpace", "key", "whiteLuminance", "logAverageDelta", "maximumWorkingBytes"], "createReinhardGlobalToneMappingTask input");
  const image = requireImage(r.image, "image"), space = requireEnum(r.inputColorSpace, SPACES, "inputColorSpace");
  const key = optionalFiniteIn(r.key, 0.18, "key", 0, 1e6, true), delta = optionalFiniteIn(r.logAverageDelta, 1e-6, "logAverageDelta", 0, 1, true);
  const white = r.whiteLuminance === undefined ? undefined : optionalFiniteIn(r.whiteLuminance, 1, "whiteLuminance", 0, 1e12, true);
  const [wr, wg, wb] = luminanceWeights(space), h = image.height, stride = image.width * 3, n = image.width * h;
  return createProcessingTask({
    provider, totalTileCount: 3 * h, estimatedWorkingBytes: n * 12, maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<ReinhardGlobalToneMappingOutput> {
      yield* finiteRows(image.data, image.width, h, 3, "image");
      const d = image.data;
      let logSum = 0, maxL = 0;
      for (let y = 0; y < h; y++) {
        for (let i = y * stride; i < (y + 1) * stride; i += 3) {
          const l = Math.max(0, wr * d[i]! + wg * d[i + 1]! + wb * d[i + 2]!);
          logSum += Math.log(delta + l); maxL = Math.max(maxL, l);
        }
        yield;
      }
      const logAverage = Math.exp(logSum / n), scale = key / logAverage, lWhite = white ?? Math.max(maxL * scale, Number.MIN_VALUE);
      const out = new Float32Array(3 * n);
      let above = 0;
      for (let y = 0; y < h; y++) {
        for (let i = y * stride; i < (y + 1) * stride; i += 3) {
          const lw = wr * d[i]! + wg * d[i + 1]! + wb * d[i + 2]!;
          if (!(lw > 0)) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; continue; }
          const l = scale * lw, ld = l * (1 + l / (lWhite * lWhite)) / (1 + l), ratio = ld / lw;
          for (let c = 0; c < 3; c++) { const v = (out[i + c] = Math.max(0, d[i + c]!) * ratio); if (v > 1) above++; }
        }
        requireFiniteOutput(out, y * stride, (y + 1) * stride, "Reinhard tone mapping (whiteLuminance)");
        yield;
      }
      return { width: image.width, height: h, data: out, aboveOneSampleCount: above, logAverageLuminance: logAverage, whiteLuminance: lWhite,
        provenance: processingProvenance("tone-reinhard-2002-global", [
          "Global photographic operator L_d = L(1 + L/L_white^2)/(1 + L) with L = a L_w / exp(mean log(delta + L_w)).",
          "Colour scaled by L_d/L_w (preserves chromaticity); negative components and non-positive luminance map to 0.",
          "Display-referred linear output; no dodging-and-burning (local) variant, gamut mapping or transfer encoding."]) };
    }
  });
}

export interface DurandDorseyToneMappingInput {
  image: ProcessingRgbImage;
  inputColorSpace: ProcessingLinearColorSpace;
  /** Spatial σ in pixels; default 2% of the larger image side. */
  spatialSigmaPixels?: number;
  /** Range σ in log₁₀ luminance; default 0.4. */
  rangeSigmaLog10?: number;
  /** Target base-layer contrast ratio; default 5. */
  targetContrast?: number;
  /** Spatial downsampling factor of the fast bilateral filter; default max(1, round(σ_s/4)). */
  downsampleFactor?: number;
  maximumWorkingBytes?: number;
}

export interface DurandDorseyToneMappingOutput extends ToneMappedImage {
  /** Bilateral base layer (log₁₀ luminance) per pixel; −Infinity for pixels with luminance ≤ 0, which are excluded from the filter. */
  baseLog10: Float32Array;
  compressionFactor: number;
}

/**
 * Durand & Dorsey (2002) bilateral base/detail tone mapping. The fast bilateral filter is the paper's
 * piecewise-linear scheme:
 * 1. Place intensity nodes i_j no more than σ_r apart.
 * 2. For each node, compute J_j = (f ⊗ (g_r(I − i_j)·I)) / (f ⊗ g_r(I − i_j)) on a box-downsampled grid.
 * 3. Upsample bilinearly, then interpolate linearly between the two nodes on either side of each
 *    full-resolution intensity.
 */
export function createDurandDorseyToneMappingTask(input: DurandDorseyToneMappingInput, provider: ProcessingProvider): ProcessingTask<DurandDorseyToneMappingOutput> {
  const r = requireOptions(input, ["image", "inputColorSpace", "spatialSigmaPixels", "rangeSigmaLog10", "targetContrast", "downsampleFactor",
    "maximumWorkingBytes"], "createDurandDorseyToneMappingTask input");
  const image = requireImage(r.image, "image"), space = requireEnum(r.inputColorSpace, SPACES, "inputColorSpace");
  const W = image.width, H = image.height, n = W * H;
  const sigmaS = optionalFiniteIn(r.spatialSigmaPixels, Math.max(0.5, 0.02 * Math.max(W, H)), "spatialSigmaPixels", 0, 1e5, true);
  const sigmaR = optionalFiniteIn(r.rangeSigmaLog10, 0.4, "rangeSigmaLog10", 0, 100, true);
  const contrast = optionalFiniteIn(r.targetContrast, 5, "targetContrast", 1, 1e12, true);
  const z = optionalIntegerIn(r.downsampleFactor, Math.max(1, Math.round(sigmaS / 4)), "downsampleFactor", 1, 1024);
  const cw = Math.ceil(W / z), ch = Math.ceil(H / z), kernel = gaussianKernel(sigmaS / z);
  const [wr, wg, wb] = luminanceWeights(space);
  // Node count depends on the data range; the plan bounds it by the float32 log₁₀ range (≈ 90 decades) and by 4096 planes,
  // and the body refuses data that would need more nodes than that (capture-11) rather than spacing them wider than σ_r.
  const maxNodes = Math.min(4096, Math.ceil(90 / sigmaR) + 2);
  const nodeRows = 2 * convolveRows(ch) + ch;
  return createProcessingTask({
    provider, totalTileCount: 4 * H + ch + maxNodes * nodeRows, estimatedWorkingBytes: n * (3 * 4 + 4 + 4) + cw * ch * 4 * 6 + maxNodes * cw * ch * 4,
    maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<DurandDorseyToneMappingOutput> {
      yield* finiteRows(image.data, W, H, 3, "image");
      const d = image.data, logL = new Float32Array(n);
      // Pixels with luminance ≤ 0 have no finite log₁₀; they are marked −∞, excluded from the filter and from the
      // ranges below, and output as 0 by the colour pass.
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x, l = wr * d[3 * i]! + wg * d[3 * i + 1]! + wb * d[3 * i + 2]!;
          logL[i] = l > 0 ? Math.log10(l) : -Infinity;
        }
        yield;
      }
      const coarse = new Float32Array(cw * ch);
      let lo = Infinity, hi = -Infinity;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          let s = 0, c = 0;
          for (let yy = y * z; yy < Math.min(H, (y + 1) * z); yy++) for (let xx = x * z; xx < Math.min(W, (x + 1) * z); xx++) {
            const v = logL[yy * W + xx]!;
            if (v > -Infinity) { s += v; c++; }
          }
          // A cell with no positive-luminance pixel is NaN and carries zero filter weight.
          const v = (coarse[y * cw + x] = c > 0 ? s / c : NaN);
          if (c > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        }
        yield;
      }
      for (let i = 0; i < n; i++) if (logL[i]! > -Infinity) { lo = Math.min(lo, logL[i]!); hi = Math.max(hi, logL[i]!); }
      if (!(hi >= lo)) { lo = 0; hi = 0; } // all-zero image
      const nodes = hi > lo ? Math.ceil((hi - lo) / sigmaR) + 1 : 1;
      if (nodes > maxNodes) throw new InvalidScientificInputError("rangeSigmaLog10 is too small for this image's luminance range (more than " + maxNodes + " intensity nodes).");
      const step = nodes > 1 ? (hi - lo) / (nodes - 1) : 0, J: Float32Array[] = [];
      const g = new Float32Array(cw * ch), hgt = new Float32Array(cw * ch), tmp = new Float32Array(cw * ch), gs = new Float32Array(cw * ch), hs = new Float32Array(cw * ch);
      for (let j = 0; j < maxNodes; j++) {
        if (j >= nodes) { for (let k = 0; k < nodeRows; k++) yield; continue; }
        const node = lo + j * step;
        for (let i = 0; i < cw * ch; i++) {
          const c = coarse[i]!;
          if (Number.isNaN(c)) { g[i] = 0; hgt[i] = 0; continue; }
          const w = Math.exp(-((c - node) ** 2) / (2 * sigmaR * sigmaR)); g[i] = w; hgt[i] = w * c;
        }
        yield* convolveSeparable(g, cw, ch, 1, kernel, tmp, gs);
        yield* convolveSeparable(hgt, cw, ch, 1, kernel, tmp, hs);
        const out = new Float32Array(cw * ch);
        for (let y = 0; y < ch; y++) {
          for (let i = y * cw; i < (y + 1) * cw; i++) out[i] = gs[i]! > 0 ? hs[i]! / gs[i]! : node;
          yield;
        }
        J.push(out);
      }
      const sample = (plane: Float32Array, x: number, y: number): number => {
        const fx = Math.min(Math.max((x + 0.5) / z - 0.5, 0), cw - 1), fy = Math.min(Math.max((y + 0.5) / z - 0.5, 0), ch - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, cw - 1), y1 = Math.min(y0 + 1, ch - 1), ax = fx - x0, ay = fy - y0;
        return (1 - ay) * ((1 - ax) * plane[y0 * cw + x0]! + ax * plane[y0 * cw + x1]!) + ay * ((1 - ax) * plane[y1 * cw + x0]! + ax * plane[y1 * cw + x1]!);
      };
      const base = new Float32Array(n);
      let bLo = Infinity, bHi = -Infinity;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x, v = logL[i]!;
          if (!(v > -Infinity)) { base[i] = -Infinity; continue; }
          let b: number;
          if (nodes === 1) b = sample(J[0]!, x, y);
          else {
            const t = Math.min(Math.max((v - lo) / step, 0), nodes - 1), j0 = Math.min(Math.floor(t), nodes - 2), a = t - j0;
            b = (1 - a) * sample(J[j0]!, x, y) + a * sample(J[j0 + 1]!, x, y);
          }
          base[i] = b; bLo = Math.min(bLo, b); bHi = Math.max(bHi, b);
        }
        yield;
      }
      if (!(bHi >= bLo)) { bLo = 0; bHi = 0; } // all-zero image
      const factor = bHi > bLo ? Math.log10(contrast) / (bHi - bLo) : 1, offset = bHi * factor, out = new Float32Array(3 * n);
      let above = 0;
      for (let y = 0; y < H; y++) {
        for (let i = y * W; i < (y + 1) * W; i++) {
          const lw = wr * d[3 * i]! + wg * d[3 * i + 1]! + wb * d[3 * i + 2]!;
          if (!(lw > 0)) { out[3 * i] = 0; out[3 * i + 1] = 0; out[3 * i + 2] = 0; continue; }
          const ratio = 10 ** (base[i]! * factor + (logL[i]! - base[i]!) - offset) / lw;
          for (let c = 0; c < 3; c++) { const v = (out[3 * i + c] = Math.max(0, d[3 * i + c]!) * ratio); if (v > 1) above++; }
        }
        requireFiniteOutput(out, 3 * y * W, 3 * (y + 1) * W, "Durand-Dorsey tone mapping");
        yield;
      }
      return { width: W, height: H, data: out, baseLog10: base, compressionFactor: factor, aboveOneSampleCount: above,
        provenance: processingProvenance("tone-durand-dorsey-2002-bilateral", [
          "Base = fast piecewise-linear bilateral filter of log10 luminance (spatial sigma " + sigmaS + " px, range sigma " + sigmaR + ", downsampling " + z + ").",
          "Base compressed to a " + contrast + ":1 contrast, detail kept, largest base mapped to luminance 1.",
          "Colour scaled by the luminance ratio; display-referred linear output without gamut mapping or transfer encoding."]) };
    }
  });
}

// ------------------------------------------------------------------ exposure fusion

export interface ExposureFusionInput {
  /** Display-referred (e.g. sRGB-encoded) frames with values nominally in [0, 1]. */
  frames: readonly ProcessingRgbImage[];
  contrastExponent?: number;
  saturationExponent?: number;
  wellExposednessExponent?: number;
  /** Well-exposedness Gaussian σ; default 0.2. */
  wellExposednessSigma?: number;
  /** Pyramid levels; default down to a 1-pixel side (at most 12). */
  pyramidLevels?: number;
  maximumWorkingBytes?: number;
}

export interface ExposureFusionOutput extends ProcessingRgbImage {
  /** Components clipped to [0, 1] after collapsing the blended pyramid. */
  clippedSampleCount: number;
  provenance: ProcessingProvenance;
}

// Patent note (public record, not legal advice): standard Mertens et al. Laplacian-pyramid fusion. CyberLink
// US 8,885,976 (in force to 2034) claims a specific merged-pyramid variant that this implementation does not use;
// see THIRD_PARTY.md.
/** Mertens, Kautz & Van Reeth (2007) exposure fusion with Laplacian-pyramid blending. */
export function createExposureFusionTask(input: ExposureFusionInput, provider: ProcessingProvider): ProcessingTask<ExposureFusionOutput> {
  const r = requireOptions(input, ["frames", "contrastExponent", "saturationExponent", "wellExposednessExponent", "wellExposednessSigma",
    "pyramidLevels", "maximumWorkingBytes"], "createExposureFusionTask input");
  const frames = requireImageList(r.frames, "frames", 1), W = frames[0]!.width, H = frames[0]!.height, n = W * H, K = frames.length;
  const wc = optionalFiniteIn(r.contrastExponent, 1, "contrastExponent", 0, 16), ws = optionalFiniteIn(r.saturationExponent, 1, "saturationExponent", 0, 16);
  const we = optionalFiniteIn(r.wellExposednessExponent, 1, "wellExposednessExponent", 0, 16), sigma = optionalFiniteIn(r.wellExposednessSigma, 0.2, "wellExposednessSigma", 0, 10, true);
  const levels = optionalIntegerIn(r.pyramidLevels, autoLevels(W, H, 12), "pyramidLevels", 1, autoLevels(W, H, 32));
  const rows = K * H + H + K * (laplacianPyramidRows(W, H, levels) + gaussianPyramidRows(W, H, levels)) + collapseRows(W, H, levels) + H;
  return createProcessingTask({
    provider, totalTileCount: K * H + rows, estimatedWorkingBytes: K * n * 4 + 3 * pyramidBytes(W, H, 3, levels) + 2 * pyramidBytes(W, H, 1, levels) + n * 12,
    maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<ExposureFusionOutput> {
      for (const [k, f] of frames.entries()) yield* finiteRows(f.data, W, H, 3, "frames[" + k + "]");
      const weights = frames.map(() => new Float32Array(n)), [lr, lg, lb] = luminanceWeights("linear-srgb-d65");
      for (const [k, f] of frames.entries()) {
        const d = f.data, w = weights[k]!;
        const gray = (x: number, y: number): number => { const i = 3 * (reflect(y, H) * W + reflect(x, W)); return lr * d[i]! + lg * d[i + 1]! + lb * d[i + 2]!; };
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = y * W + x, R = d[3 * i]!, G = d[3 * i + 1]!, B = d[3 * i + 2]!;
            const c = Math.abs(gray(x - 1, y) + gray(x + 1, y) + gray(x, y - 1) + gray(x, y + 1) - 4 * gray(x, y));
            const mu = (R + G + B) / 3, s = Math.sqrt(((R - mu) ** 2 + (G - mu) ** 2 + (B - mu) ** 2) / 3);
            const e = Math.exp(-((R - 0.5) ** 2 + (G - 0.5) ** 2 + (B - 0.5) ** 2) / (2 * sigma * sigma));
            w[i] = c ** wc * s ** ws * e ** we + 1e-12;
          }
          yield;
        }
      }
      for (let y = 0; y < H; y++) {
        for (let i = y * W; i < (y + 1) * W; i++) {
          let sum = 0;
          for (const w of weights) sum += w[i]!;
          if (!(sum < Infinity)) throw new InvalidScientificResultError("Exposure fusion gives a non-finite weight; check contrastExponent, saturationExponent and wellExposednessExponent against the frame values.");
          for (const w of weights) w[i] = w[i]! / sum;
        }
        yield;
      }
      let acc: Float32Array[] | null = null, sizes: { width: number; height: number }[] = [];
      for (const [k, f] of frames.entries()) {
        const lap = yield* laplacianPyramid(f.data, W, H, 3, levels), gw = yield* gaussianPyramid(weights[k]!, W, H, 1, levels);
        sizes = lap.sizes;
        acc ??= lap.sizes.map((s) => new Float32Array(s.width * s.height * 3));
        for (let l = 0; l < levels; l++) {
          const a = acc[l]!, L = lap.levels[l]!, G = gw.levels[l]!;
          for (let i = 0; i < G.length; i++) for (let c = 0; c < 3; c++) a[3 * i + c] = a[3 * i + c]! + G[i]! * L[3 * i + c]!;
        }
      }
      const fused = yield* collapse({ levels: acc!, sizes, channels: 3 });
      let clipped = 0;
      for (let y = 0; y < H; y++) {
        requireFiniteOutput(fused, 3 * y * W, 3 * (y + 1) * W, "Exposure fusion");
        for (let i = 3 * y * W; i < 3 * (y + 1) * W; i++) {
          const v = fused[i]!;
          if (v < 0) { fused[i] = 0; clipped++; } else if (v > 1) { fused[i] = 1; clipped++; }
        }
        yield;
      }
      return { width: W, height: H, data: fused, clippedSampleCount: clipped, provenance: processingProvenance("exposure-fusion-mertens-2007", [
        "Weights: |3x3 Laplacian of Rec.709 luma|^wc * RGB std^ws * prod exp(-(v-0.5)^2/(2 sigma^2))^we, normalized per pixel.",
        "Laplacian-pyramid blending with Burt-Adelson 5-tap kernel and reflect-101 borders; output clipped to [0, 1].",
        "Display-referred blending of registered frames; not a radiance estimate."]) };
    }
  });
}

