// SPDX-License-Identifier: Apache-2.0

/**
 * #740 (2.29.0): the body of `simulateTypicalProcessing` (typical-processing-entry.ts), loaded on demand as its own chunk. It runs the
 * stages that phone cameras commonly apply to a burst, in this order, on DNG frames (a simulated capture's `output.format: "dng"`,
 * one per `sensor.noiseSeed`, or an imported file):
 * 1. merge: the mean of the frames' linearized stage images, before the demosaic (frame-merge.ts);
 * 2. development to linear sRGB: `developDngImage`'s own chain up to its tone curve (`developDngLinear`);
 * 3. noise reduction: the bilateral filter of `createBilateralFilterTask`;
 * 4. local tone mapping: Durand & Dorsey (2002), the fast piecewise-linear base (`createDurandDorseyToneMappingTask`) or the direct
 *    bilateral base (`createDurandDorseyDirectToneMappingTask`, full quality);
 * 5. saturation: out = Y + gain·(RGB − Y) in linear light (saturation.ts);
 * 6. `developDngImage`'s tone curve, RGBTables, gamut handling, sRGB encoding and Orientation.
 * The order follows Hasinoff et al., "Burst photography for high dynamic range and low-light imaging on mobile cameras" (SIGGRAPH Asia
 * 2016, free copy from the authors: merge on the raw mosaic, then denoise, local tone mapping and color) and the survey of Delbracio et
 * al., "Mobile computational photography: a tour" (2021, arXiv:2102.09000). It is a simulation of typical stages, not the processing
 * of any device. With one frame and every stage `false` the result is `developDngImage`'s bit for bit.
 * @see docs/PROCESSING.md, "Typical processing stages".
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { developDngLinear, developedDngCrop, type DevelopDngImageOptions } from "../capture/dng-development.js";
import { developDngStageImage, type DngStageImageResult } from "../capture/dng-stage-image.js";
import type { ImportedDngRaw } from "../capture/dng-import.js";
import { requireImportedDngRaw } from "../capture/dng-raw-measurements.js";
import { addFrameSamples, finishFrameMean, requireMergeableFrames } from "../processing/frame-merge.js";
import { applySaturation } from "../processing/saturation.js";
import { createBilateralFilterTask } from "../processing/denoise.js";
import { createDurandDorseyDirectToneMappingTask, createDurandDorseyToneMappingTask, durandDorseyDirectWork, DURAND_DORSEY_DIRECT_MAXIMUM_WORK } from "../processing/tone-mapping.js";
import { luminanceWeights } from "../processing/image-ops.js";
import { PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES, PROCESSING_MAX_FRAMES, type ProcessingProvider, type ProcessingTask } from "../processing/processing-task.js";
import { fastFormatDefault, resolveFast } from "./fast-resolution.js";

/** The development options `simulateTypicalProcessing` passes to `developDngImage`'s chain (its other options keep their defaults). */
export type TypicalProcessingDevelopOptions = Pick<DevelopDngImageOptions, "whiteBalance" | "exposurePushStops" | "toneCurve" | "toneCurveParameters" | "gamutHandling" | "crop" | "orientation">;

/** Input of `simulateTypicalProcessing`. Each stage is on with its defaults when omitted; `false` turns it off. */
export interface SimulateTypicalProcessingInput {
  /** 1 to 32 identical exposures (same size, CFA, levels and color metadata), as `parseDngRawImage` or `importDngRawImage` returns. */
  frames: readonly ImportedDngRaw[];
  /** `developDngImage`'s white balance, push, tone curve, gamut handling, crop and Orientation. */
  develop?: TypicalProcessingDevelopOptions;
  /** The mean of the frames before the demosaic (default on). `false` takes exactly one frame. */
  merge?: false | { method?: "mean" };
  /** Bilateral noise reduction on linear sRGB: spatial σ in pixels (default 1, at most 64), range σ in linear units (default 0.02). */
  noiseReduction?: false | { spatialSigmaPixels?: number; rangeSigma?: number };
  /**
   * Durand & Dorsey local tone mapping: target base contrast (default 5), spatial σ as a fraction of the longer side (default 0.02),
   * range σ in log₁₀ luminance (default 0.4), and `fast` (registry entry `simulateTypicalProcessing/local-tone-mapping`).
   */
  localToneMapping?: false | { contrast?: number; spatialSigmaFraction?: number; rangeSigma?: number; fast?: boolean };
  /** Saturation gain in linear light, 0 to 4 (default 1.2; 1 leaves color as it is, 0 gives gray). */
  saturation?: false | { gain?: number };
  /** "srgb-8" (default) or "srgb-16". */
  format?: "srgb-8" | "srgb-16";
  /** Speed versus accuracy: the demosaic and WarpRectilinear as in `developDngImage`, and the local tone mapping's base layer. Default from `format`. */
  fast?: boolean;
  /** Bound on the estimated working memory of the stages (default 1 GiB). */
  maximumWorkingBytes?: number;
}

/** One stage of a {@link TypicalProcessingResult}, in the order it ran. */
export interface TypicalProcessingStage {
  stage: "merge" | "development" | "noise-reduction" | "local-tone-mapping" | "saturation" | "encoding";
  applied: boolean;
  /** The method, in words ("" for a stage that was turned off). */
  method: string;
  /** The values it ran with. */
  parameters: Readonly<Record<string, number | string | boolean>>;
}

/** Result of `simulateTypicalProcessing`. */
export interface TypicalProcessingResult {
  kind: "typical-processing";
  label: "Simulation of typical processing stages; not the processing of a specific device";
  width: number;
  height: number;
  format: "srgb-8" | "srgb-16";
  /** Interleaved sRGB-encoded RGB, row-major, as `developDngImage` returns. */
  samples: Uint8Array | Uint16Array;
  stages: readonly TypicalProcessingStage[];
  /** `applied.demosaic`: the bilinear demosaic ran (else AHD); `applied.localToneMapping`: the fast base layer ran (false when the full one ran or the stage is off). */
  fast: { requested: boolean; defaultedFrom: "request" | "format"; applied: { demosaic: boolean; localToneMapping: boolean } };
  /** `developDngImage`'s assumptions, then this function's (`typicalProcessing.*`, `fast.simulateTypicalProcessing.localToneMapping`). */
  assumptions: readonly string[];
  provenance: { kind: "approximation"; model: "simulate-typical-processing"; modelVersion: "1.0.0"; sources: readonly string[] };
}

const LABEL = "Simulation of typical processing stages; not the processing of a specific device";
const KEYS = ["frames", "develop", "merge", "noiseReduction", "localToneMapping", "saturation", "format", "fast", "maximumWorkingBytes"];
const DEVELOP_KEYS = ["whiteBalance", "exposurePushStops", "toneCurve", "toneCurveParameters", "gamutHandling", "crop", "orientation"];
const SOURCES = [
  "Hasinoff et al. (2016), Burst photography for high dynamic range and low-light imaging on mobile cameras, ACM TOG 35(6) (stage order; merge before the demosaic)",
  "Delbracio et al. (2021), Mobile computational photography: a tour, arXiv:2102.09000 (stage order)",
  "Tomasi & Manduchi (1998), Bilateral filtering for gray and color images, ICCV (noise reduction)",
  "Durand & Dorsey (2002), Fast bilateral filtering for the display of high-dynamic-range images, ACM TOG 21(3) (local tone mapping)",
  "Haeberli (1993), Matrix operations for image processing, Grafica Obscura (saturation)"
] as const;

function fail(message: string): never { throw new InvalidConfigurationError("simulateTypicalProcessing: " + message); }

function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path + " must be false or an object.");
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail("unknown option " + JSON.stringify(path + "." + key) + ".");
  return value as Record<string, unknown>;
}

function number(value: unknown, fallback: number, path: string, min: number, max: number, exclusiveMin: boolean): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || (exclusiveMin ? !(value > min) : !(value >= min)) || !(value <= max)) {
    fail(path + " must be a number in " + (exclusiveMin ? "(" : "[") + min + ", " + max + "].");
  }
  return value;
}

/** A stage's record: `false` (off), else its fields (an omitted stage is on with its defaults). */
function stageRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> | false {
  if (value === false) return false;
  return value === undefined ? {} : record(value, keys, path);
}

async function runTask<T>(task: ProcessingTask<T>): Promise<T> {
  await task.run();
  return task.takeOutput();
}

/** The body of `simulateTypicalProcessing` (see the module comment). */
export async function runTypicalProcessing(input: SimulateTypicalProcessingInput, provider: ProcessingProvider): Promise<TypicalProcessingResult> {
  const top = record(input, KEYS, "input");
  const frames = top.frames as readonly ImportedDngRaw[];
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > PROCESSING_MAX_FRAMES) fail("frames must hold 1 to " + PROCESSING_MAX_FRAMES + " DNG frames.");
  for (const frame of frames) requireImportedDngRaw(frame, "simulateTypicalProcessing");
  const develop = top.develop === undefined ? {} : record(top.develop, DEVELOP_KEYS, "develop") as TypicalProcessingDevelopOptions;
  const format = top.format ?? "srgb-8";
  if (format !== "srgb-8" && format !== "srgb-16") fail('format must be "srgb-8" or "srgb-16".');
  if (top.fast !== undefined && typeof top.fast !== "boolean") fail("fast must be a boolean.");
  const fast = resolveFast(top.fast as boolean | undefined, fastFormatDefault(format, "capture"));
  const maximumWorkingBytes = top.maximumWorkingBytes === undefined ? PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES : top.maximumWorkingBytes;
  if (typeof maximumWorkingBytes !== "number" || !Number.isSafeInteger(maximumWorkingBytes) || maximumWorkingBytes < 1) fail("maximumWorkingBytes must be a positive integer.");

  const merge = stageRecord(top.merge, ["method"], "merge");
  if (merge && merge.method !== undefined && merge.method !== "mean") fail('merge.method must be "mean".');
  if (!merge && frames.length !== 1) fail("merge: false takes exactly one frame.");
  const nr = stageRecord(top.noiseReduction, ["spatialSigmaPixels", "rangeSigma"], "noiseReduction");
  const nrSigma = nr ? number(nr.spatialSigmaPixels, 1, "noiseReduction.spatialSigmaPixels", 0, 64, true) : 0;
  const nrRange = nr ? number(nr.rangeSigma, 0.02, "noiseReduction.rangeSigma", 0, 1e30, true) : 0;
  const ltm = stageRecord(top.localToneMapping, ["contrast", "spatialSigmaFraction", "rangeSigma", "fast"], "localToneMapping");
  if (ltm && ltm.fast !== undefined && typeof ltm.fast !== "boolean") fail("localToneMapping.fast must be a boolean.");
  const ltmFast = ltm ? resolveFast(ltm.fast as boolean | undefined, fast) : false;
  const ltmContrast = ltm ? number(ltm.contrast, 5, "localToneMapping.contrast", 1, 1e12, true) : 0;
  const ltmFraction = ltm ? number(ltm.spatialSigmaFraction, 0.02, "localToneMapping.spatialSigmaFraction", 0, 1, true) : 0;
  const ltmRange = ltm ? number(ltm.rangeSigma, 0.4, "localToneMapping.rangeSigma", 0, 100, true) : 0;
  const sat = stageRecord(top.saturation, ["gain"], "saturation");
  const gain = sat ? number(sat.gain, 1.2, "saturation.gain", 0, 4, false) : 1;
  if (frames.length > 1) requireMergeableFrames(frames, "simulateTypicalProcessing");

  // Sizes before anything is allocated: the stage image (the active area) and the cropped output.
  const raw = frames[0]!, a = raw.activeArea, planes = raw.samplesPerPixel;
  const sw = Math.min(raw.width - Math.floor(a.x), Math.ceil(a.width)), sh = Math.min(raw.height - Math.floor(a.y), Math.ceil(a.height));
  const cropped = developedDngCrop(raw, sw, sh, develop.crop ?? "default");
  const width = Math.max(0, cropped.width), height = Math.max(0, cropped.height), pixels = width * height, stageSamples = sw * sh * planes;
  const ltmSigma = Math.max(0.5, ltmFraction * Math.max(width, height));
  if (ltm && !ltmFast) {
    const work = durandDorseyDirectWork(width, height, ltmSigma);
    if (!(work <= DURAND_DORSEY_DIRECT_MAXIMUM_WORK)) {
      throw new InvalidConfigurationError("simulateTypicalProcessing: the full-quality local tone mapping (the direct bilateral base) needs " + work + " tap evaluations (" + width + " × " +
        height + " pixels, spatial sigma " + ltmSigma + " px, window radius " + Math.ceil(3 * ltmSigma) + "), more than its bound of " + DURAND_DORSEY_DIRECT_MAXIMUM_WORK +
        "; lower localToneMapping.spatialSigmaFraction (the window shrinks with its square) or set localToneMapping.fast: true.");
    }
  }
  // Working memory, estimated per phase (each phase's buffers; the largest phase bounds the run). The demosaic's own scratch is not counted.
  const phases = [
    frames.length > 1 ? stageSamples * (8 + 4 + 4) : stageSamples * 4,
    stageSamples * 4 + sw * sh * 12 + pixels * 12,
    nr ? pixels * 24 : 0,
    ltm ? pixels * (12 + 20) : 0,
    pixels * 12 + pixels * (format === "srgb-8" ? 6 : 12)
  ];
  const estimate = Math.max(...phases);
  if (estimate > maximumWorkingBytes) fail("the estimated working memory (" + estimate + " bytes) exceeds maximumWorkingBytes (" + maximumWorkingBytes + ").");

  // 1. Merge: the mean of the frames' stage images, one frame held at a time.
  const signal = new AbortController().signal, assumptions: string[] = [];
  const stageOptions = { format, fast } as const;
  let merged: DngStageImageResult;
  if (frames.length === 1) merged = developDngStageImage(raw, stageOptions);
  else {
    let sum: Float64Array | null = null, first: DngStageImageResult | null = null;
    for (const frame of frames) {
      const stage = developDngStageImage(frame, stageOptions);
      sum ??= new Float64Array(stage.data.length);
      addFrameSamples(sum, stage.data);
      first ??= stage;
      await provider.yieldControl(signal);
    }
    merged = { ...first!, data: finishFrameMean(sum!, frames.length) };
    assumptions.push("typicalProcessing.merge: the mean of " + frames.length + " frames' stage images (each normalized and clipped to 0..1 by its black and white levels), sample by sample, before the demosaic; " +
      "the frames are taken as registered (no alignment, no outlier rejection), so motion between frames averages into blur. The clip at 0 biases the mean of the darkest samples upward.");
  }

  // 2. Development to linear sRGB (developDngImage's chain, with the merged stage image).
  const developed = await developDngLinear(raw, { ...develop, format, fast }, (options) => {
    if (options.format !== format || options.fast !== fast || options.opcodes !== undefined) throw new InvalidScientificInputError("simulateTypicalProcessing: the stage image options disagree.");
    return merged;
  });
  if (developed.width !== width || developed.height !== height) throw new InvalidScientificInputError("simulateTypicalProcessing: the developed size differs from its estimate.");
  await provider.yieldControl(signal);
  let linear = developed.linear, scale = developed.scale;
  const processing = nr !== false || ltm !== false || (sat !== false && gain !== 1);
  if (processing && scale !== 1) {
    // BaselineExposure and the push are applied before the stages (they belong to the development), in float32.
    for (let i = 0; i < linear.length; i++) linear[i] = linear[i]! * scale;
    scale = 1;
  }
  const image = (): { width: number; height: number; data: Float32Array } => ({ width, height, data: linear });

  // 3. Noise reduction.
  if (nr) linear = (await runTask(createBilateralFilterTask({ image: image(), spatialSigmaPixels: nrSigma, rangeSigma: nrRange, maximumWorkingBytes }, provider))).data;
  // 4. Local tone mapping.
  if (ltm) {
    const options = { image: image(), inputColorSpace: "linear-srgb-d65", spatialSigmaPixels: ltmSigma, rangeSigmaLog10: ltmRange, targetContrast: ltmContrast, maximumWorkingBytes } as const;
    linear = (await runTask(ltmFast ? createDurandDorseyToneMappingTask(options, provider) : createDurandDorseyDirectToneMappingTask(options, provider))).data;
    assumptions.push("fast.simulateTypicalProcessing.localToneMapping: " + (ltmFast
      ? "the base layer by Durand and Dorsey's piecewise-linear bilateral filter with spatial downsampling (fast); the full method filters every pixel's window directly (localToneMapping.fast: false)."
      : "the base layer by the direct bilateral filter over each pixel's window of radius " + Math.ceil(3 * ltmSigma) + " (full quality)."));
    assumptions.push("typicalProcessing.localToneMapping: the operator maps the largest base value to luminance 1, so BaselineExposure and the push do not change its output level.");
  }
  // 5. Saturation.
  if (sat && gain !== 1) applySaturation(linear, pixels, gain, luminanceWeights("linear-srgb-d65"));
  // 6. Tone curve, gamut handling, encoding and Orientation.
  const out = developed.finish(linear, scale);
  if (processing) assumptions.push("typicalProcessing.stages: noise reduction, local tone mapping and saturation act on linear sRGB (D65) after BaselineExposure and the push, before the tone curve; " +
    "each uses one global parameter set (no per-pixel noise model, no scene analysis).");

  const stage = (name: TypicalProcessingStage["stage"], applied: boolean, method: string, parameters: TypicalProcessingStage["parameters"]): TypicalProcessingStage =>
    ({ stage: name, applied, method: applied ? method : "", parameters: applied ? parameters : {} });
  return {
    kind: "typical-processing", label: LABEL, width: out.width, height: out.height, format, samples: out.samples,
    stages: [
      stage("merge", merge !== false, "mean of the stage images before the demosaic", { frames: frames.length }),
      stage("development", true, developed.demosaic === "ahd" ? "AHD demosaic, DNG color to linear sRGB" : developed.demosaic === "bilinear" ? "bilinear demosaic, DNG color to linear sRGB" : "DNG color to linear sRGB",
        { demosaic: developed.demosaic, exposureScale: developed.scale }),
      stage("noise-reduction", nr !== false, "bilateral filter (Tomasi and Manduchi 1998)", { spatialSigmaPixels: nrSigma, rangeSigma: nrRange }),
      stage("local-tone-mapping", ltm !== false, ltmFast ? "Durand and Dorsey 2002, piecewise-linear bilateral base (fast)" : "Durand and Dorsey 2002, direct bilateral base (full quality)",
        { contrast: ltmContrast, spatialSigmaPixels: ltmSigma, rangeSigmaLog10: ltmRange, fast: ltmFast }),
      stage("saturation", sat !== false, "Y + gain·(RGB − Y) in linear sRGB", { gain }),
      stage("encoding", true, "developDngImage's tone curve, gamut handling and sRGB encoding", { toneCurve: develop.toneCurve ?? "identity", gamutHandling: develop.gamutHandling ?? "clip-components" })
    ],
    fast: { requested: fast, defaultedFrom: top.fast === undefined ? "format" : "request", applied: { demosaic: developed.demosaic === "bilinear", localToneMapping: ltm !== false && ltmFast } },
    assumptions: [...out.assumptions, ...assumptions],
    provenance: { kind: "approximation", model: "simulate-typical-processing", modelVersion: "1.0.0", sources: SOURCES }
  };
}
