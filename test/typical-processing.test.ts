// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createBilateralFilterTask, createDurandDorseyToneMappingTask, developDngImage, InvalidConfigurationError, InvalidScientificInputError, parseDngRawImage,
  simulateCapture, type DevelopDngImageOptions, type ImportedDngRaw, type ProcessingTask } from "../src/index.js";
import { simulateTypicalProcessing, type SimulateTypicalProcessingInput } from "../src/facade/typical-processing-entry.js";
import { developDngLinear } from "../src/capture/dng-development.js";
import { createDurandDorseyDirectToneMappingTask, DURAND_DORSEY_DIRECT_MAXIMUM_WORK } from "../src/processing/tone-mapping.js";
import { meanOfFrames } from "../src/processing/frame-merge.js";
import { applySaturation } from "../src/processing/saturation.js";
import { luminanceWeights } from "../src/processing/image-ops.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #740 (2.29.0): simulateTypicalProcessing. Inputs are engine-written DNGs of synthetic chart scenes (96 × 64) and synthetic
 * images; no photo is used. The direct bilateral runs only on images of at most 96 × 64.
 */

const provider = { yieldControl: async (): Promise<void> => {} };
const OFF = { merge: false, noiseReduction: false, localToneMapping: false, saturation: false } as const;
const run = async <T>(task: ProcessingTask<T>): Promise<T> => { await task.run(); return task.takeOutput(); };

const charts = new Map<number, ImportedDngRaw>();
async function chart(seed = 3): Promise<ImportedDngRaw> {
  const hit = charts.get(seed);
  if (hit) return hit;
  const c = await simulateCapture({ scene: { preset: "color-patches" }, sensor: { noiseSeed: seed }, output: { width: 96, height: 64, format: "dng" } });
  const raw = parseDngRawImage({ bytes: c.image.dng! });
  charts.set(seed, raw);
  return raw;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Poisson draw of mean λ (Knuth's product of uniforms; λ ≤ 500). */
function poisson(lambda: number, random: () => number): number {
  const limit = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= random(); } while (p > limit);
  return k - 1;
}

describe("simulateTypicalProcessing: the plain side (#740)", () => {
  it("equals developDngImage bit for bit with one frame and every stage off", async () => {
    const raw = await chart();
    const cases: [string, ImportedDngRaw, DevelopDngImageOptions, SimulateTypicalProcessingInput["develop"]][] = [
      ["fast srgb-8", raw, {}, {}],
      ["exact srgb-16", raw, { fast: false, format: "srgb-16" }, {}],
      ["push, baseline, orientation 6, Standard look", { ...raw, orientation: 6, baselineExposure: 0.5 },
        { exposurePushStops: 0.7, toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 } },
        { exposurePushStops: 0.7, toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 } }],
      ["kelvin, active area, desaturate", raw, { whiteBalance: { kelvin: 4300 }, crop: "active-area", gamutHandling: "desaturate-to-luminance" },
        { whiteBalance: { kelvin: 4300 }, crop: "active-area", gamutHandling: "desaturate-to-luminance" }]
    ];
    for (const [name, input, options, develop] of cases) {
      const plain = await developDngImage(input, options);
      const typical = await simulateTypicalProcessing({ frames: [input], ...OFF, develop: develop!, ...(options.format ? { format: options.format } : {}),
        ...(options.fast === undefined ? {} : { fast: options.fast }) }, provider);
      expect(typical.samples, name).toEqual(plain.samples);
      expect([typical.width, typical.height], name).toEqual([plain.width, plain.height]);
      expect(typical.stages.filter((s) => s.applied).map((s) => s.stage), name).toEqual(["development", "encoding"]);
      expect(typical.assumptions.slice(0, plain.assumptions.length), name).toEqual(plain.assumptions);
    }
  }, scaledTimeout(120_000));

  it("labels the result and reports the fast choices", async () => {
    const raw = await chart();
    const fast = await simulateTypicalProcessing({ frames: [raw] }, provider);
    expect(fast).toMatchObject({ kind: "typical-processing", label: "Simulation of typical processing stages; not the processing of a specific device", width: 96, height: 64, format: "srgb-8",
      fast: { requested: true, defaultedFrom: "format", applied: { demosaic: true, localToneMapping: true } } });
    expect(fast.stages.map((s) => [s.stage, s.applied])).toEqual([["merge", true], ["development", true], ["noise-reduction", true], ["local-tone-mapping", true], ["saturation", true], ["encoding", true]]);
    expect(fast.assumptions.some((a) => a.startsWith("fast.simulateTypicalProcessing.localToneMapping:"))).toBe(true);
    expect(fast.provenance.sources.length).toBeGreaterThanOrEqual(5);
    const exact = await simulateTypicalProcessing({ frames: [raw], fast: false, format: "srgb-16" }, provider);
    expect(exact.fast).toEqual({ requested: false, defaultedFrom: "request", applied: { demosaic: false, localToneMapping: false } });
    expect(exact.stages[1]!.parameters.demosaic).toBe("ahd");
    const mixed = await simulateTypicalProcessing({ frames: [raw], fast: false, localToneMapping: { fast: true } }, provider);
    expect(mixed.fast.applied).toEqual({ demosaic: false, localToneMapping: true });
    // Every sample is a valid code: the result is finite.
    for (const r of [fast, exact, mixed]) expect(r.samples.length).toBe(96 * 64 * 3);
  }, scaledTimeout(120_000));
});

describe("simulateTypicalProcessing: the stages (#740)", () => {
  it("merges a burst: N identical frames give the one frame's result bit for bit", async () => {
    const raw = await chart();
    const one = await simulateTypicalProcessing({ frames: [raw], localToneMapping: false }, provider);
    const four = await simulateTypicalProcessing({ frames: [raw, raw, raw, raw], localToneMapping: false }, provider);
    expect(four.samples).toEqual(one.samples);
    expect(four.stages[0]!.parameters).toEqual({ frames: 4 });
  }, scaledTimeout(120_000));

  it("divides the noise variance by N for N = 2, 4, 8, 16 seeded Poisson frames (within 5 %), and keeps the mean within 1e-6", () => {
    const samples = 128 * 128, lambda = 100, scale = 1 / 400;
    for (const n of [2, 4, 8, 16]) {
      const random = mulberry32(1000 + n), frames: Float32Array[] = [];
      for (let k = 0; k < n; k++) frames.push(Float32Array.from({ length: samples }, () => poisson(lambda, random) * scale));
      const merged = meanOfFrames(frames);
      let all = 0;
      for (const f of frames) for (const v of f) all += v;
      let mean = 0;
      for (const v of merged) mean += v;
      mean /= samples;
      expect(Math.abs(mean - all / (n * samples)), "N = " + n).toBeLessThan(1e-6);
      let variance = 0;
      for (const v of merged) variance += (v - mean) ** 2;
      variance /= samples - 1;
      // Poisson: Var = λ per frame, so the mean of N frames has λ·scale²/N.
      expect(variance / (lambda * scale * scale / n), "N = " + n).toBeGreaterThan(0.95);
      expect(variance / (lambda * scale * scale / n), "N = " + n).toBeLessThan(1.05);
    }
    // One frame is its own mean, bit for bit.
    const single = Float32Array.from({ length: 64 }, (_, i) => Math.fround(i / 7));
    expect(meanOfFrames([single])).toEqual(single);
  });

  it("lowers the noise of a simulated burst of four seeds to about a quarter of the variance", async () => {
    const frames = await Promise.all([3, 4, 5, 6, 7, 8, 9, 10].map(chart));
    const options = { noiseReduction: false, localToneMapping: false, saturation: false, format: "srgb-16" } as const;
    const develop = (f: ImportedDngRaw[]): Promise<{ samples: Uint8Array | Uint16Array }> => simulateTypicalProcessing({ frames: f, ...options }, provider);
    // The variance of the difference of two results of independent seeds: the scene cancels, twice the noise variance remains.
    const variance = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
      return sum / a.length;
    };
    const one = variance((await develop([frames[0]!])).samples, (await develop([frames[4]!])).samples);
    const four = variance((await develop(frames.slice(0, 4))).samples, (await develop(frames.slice(4))).samples);
    expect(four / one).toBeGreaterThan(0.18);
    expect(four / one).toBeLessThan(0.32);
  }, scaledTimeout(120_000));

  it("runs the noise reduction and the local tone mapping as their standalone tasks, bit for bit", async () => {
    const raw = { ...(await chart()), baselineExposure: 0.25 };
    for (const fast of [true, false]) {
      const develop = async (): Promise<Awaited<ReturnType<typeof developDngLinear>>> => {
        const d = await developDngLinear(raw, { format: "srgb-16", fast });
        for (let i = 0; i < d.linear.length; i++) d.linear[i] = d.linear[i]! * d.scale;
        return d;
      };
      const image = (d: { width: number; height: number; linear: Float32Array }): { width: number; height: number; data: Float32Array } => ({ width: d.width, height: d.height, data: d.linear });
      // Noise reduction alone.
      const nrOnly = await simulateTypicalProcessing({ frames: [raw], format: "srgb-16", fast, localToneMapping: false, saturation: false, noiseReduction: { spatialSigmaPixels: 1.5, rangeSigma: 0.05 } }, provider);
      const d1 = await develop();
      const filtered = await run(createBilateralFilterTask({ image: image(d1), spatialSigmaPixels: 1.5, rangeSigma: 0.05 }, provider));
      expect(nrOnly.samples, "noise reduction, fast " + fast).toEqual(d1.finish(filtered.data, 1).samples);
      // Local tone mapping alone (fast base on a fast request, the direct base on an exact one).
      const ltmOnly = await simulateTypicalProcessing({ frames: [raw], format: "srgb-16", fast, noiseReduction: false, saturation: false, localToneMapping: { contrast: 8, rangeSigma: 0.3 } }, provider);
      const d2 = await develop(), options = { image: image(d2), inputColorSpace: "linear-srgb-d65", spatialSigmaPixels: 0.02 * 96, rangeSigmaLog10: 0.3, targetContrast: 8 } as const;
      const mapped = await run(fast ? createDurandDorseyToneMappingTask(options, provider) : createDurandDorseyDirectToneMappingTask(options, provider));
      expect(ltmOnly.samples, "local tone mapping, fast " + fast).toEqual(d2.finish(mapped.data, 1).samples);
    }
  }, scaledTimeout(120_000));

  it("applies the saturation gain: gain 1 is the identity, gain 0 gives Y, neutrals keep their value and luminance holds within 1e-12", () => {
    const w = luminanceWeights("linear-srgb-d65"), random = mulberry32(7), n = 4096;
    const base = Float64Array.from({ length: 3 * n }, () => 1.5 * random());
    for (let p = 0; p < 64; p++) base[3 * p + 1] = base[3 * p + 2] = base[3 * p]!; // neutrals
    const lum = (d: ArrayLike<number>, p: number): number => w[0] * d[3 * p]! + w[1] * d[3 * p + 1]! + w[2] * d[3 * p + 2]!;
    const same = base.slice();
    applySaturation(same, n, 1, w);
    expect(same).toEqual(base);
    const f32 = Float32Array.from(base), f32Copy = f32.slice();
    applySaturation(f32, n, 1, w);
    expect(f32).toEqual(f32Copy);
    const gray = base.slice();
    applySaturation(gray, n, 0, w);
    for (let p = 0; p < n; p++) {
      expect(gray[3 * p]).toBe(gray[3 * p + 1]);
      expect(gray[3 * p + 1]).toBe(gray[3 * p + 2]);
      expect(Math.abs(gray[3 * p]! - lum(base, p))).toBeLessThan(1e-12);
    }
    for (const gain of [0, 0.5, 1.2, 2, 4]) {
      const out = base.slice();
      applySaturation(out, n, gain, w);
      for (let p = 0; p < 64; p++) for (let c = 0; c < 3; c++) expect(out[3 * p + c], "neutral, gain " + gain).toBe(base[3 * p + c]);
      let worst = 0;
      for (let p = 0; p < n; p++) worst = Math.max(worst, Math.abs(lum(out, p) - lum(base, p)));
      expect(worst, "gain " + gain).toBeLessThan(1e-12);
    }
  });
});

describe("simulateTypicalProcessing: fast and full local tone mapping (#740)", () => {
  /** Three scenes, 64 × 64 linear sRGB: the chart's developed image, a 100:1 edge with texture, a four-decade ramp with fine detail. */
  async function scenes(): Promise<[string, { width: number; height: number; data: Float32Array }][]> {
    const d = await developDngLinear(await chart(), { format: "srgb-16", fast: true }), chartImage = new Float32Array(64 * 64 * 3);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) for (let c = 0; c < 3; c++) chartImage[3 * (y * 64 + x) + c] = d.linear[3 * (y * 96 + x + 16) + c]!;
    const random = mulberry32(11), make = (f: (x: number, y: number) => number): Float32Array => {
      const out = new Float32Array(64 * 64 * 3);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const v = f(x, y); out.set([v, 0.9 * v, 0.8 * v], 3 * (y * 64 + x)); }
      return out;
    };
    return [
      ["chart", { width: 64, height: 64, data: chartImage }],
      ["edge", { width: 64, height: 64, data: make((x, y) => (x + 0.3 * y > 30 ? 1 : 0.01) * (1 + 0.2 * random())) }],
      ["ramp", { width: 64, height: 64, data: make((x, y) => 10 ** (-3 + 4 * x / 63) * (1 + 0.1 * Math.sin(y)) ) }]
    ];
  }

  /*
   * Measured on this tree (the bound docs/PROCESSING.md states): largest base difference in log10 and largest relative output
   * luminance difference, at spatial sigma 2.56 px (no downsampling) and 8 px (downsampling 2): chart 0.0095 and 0.0044, 0.0162 and
   * 0.0352; edge 0.00007 and 0.0001, 0.0209 and 0.0323; ramp 0.0008 and 0.0014, 0.0274 and 0.0630.
   */
  it("keeps the fast base within 0.03 log10 of the direct one, and the outputs within 7 % in luminance, on three scenes", async () => {
    const w = luminanceWeights("linear-srgb-d65");
    for (const [name, image] of await scenes()) for (const sigma of [2.56, 8]) {
      const options = { image, inputColorSpace: "linear-srgb-d65", spatialSigmaPixels: sigma, rangeSigmaLog10: 0.4 } as const;
      const fast = await run(createDurandDorseyToneMappingTask(options, provider)), full = await run(createDurandDorseyDirectToneMappingTask(options, provider));
      let base = 0, out = 0;
      for (let i = 0; i < 64 * 64; i++) {
        if (full.baseLog10[i]! > -Infinity) base = Math.max(base, Math.abs(fast.baseLog10[i]! - full.baseLog10[i]!));
        const lf = w[0] * fast.data[3 * i]! + w[1] * fast.data[3 * i + 1]! + w[2] * fast.data[3 * i + 2]!;
        const lx = w[0] * full.data[3 * i]! + w[1] * full.data[3 * i + 1]! + w[2] * full.data[3 * i + 2]!;
        if (lx > 0) out = Math.max(out, Math.abs(lf / lx - 1));
      }
      expect(base, name + ", sigma " + sigma + ": base").toBeLessThan(0.03);
      expect(out, name + ", sigma " + sigma + ": output").toBeLessThan(0.07);
      for (const v of full.data) expect(Number.isFinite(v)).toBe(true);
    }
  }, scaledTimeout(120_000));

  it("refuses the direct base above 2e11 tap evaluations before allocating, naming the option that lowers it", async () => {
    expect(DURAND_DORSEY_DIRECT_MAXIMUM_WORK).toBe(2e11);
    const image = { width: 64, height: 64, data: new Float32Array(64 * 64 * 3).fill(0.5) };
    expect(() => createDurandDorseyDirectToneMappingTask({ image, inputColorSpace: "linear-srgb-d65", spatialSigmaPixels: 1e4 }, provider)).toThrow(/tap evaluations/u);
    // A 2000 × 2000 frame at the default spatial sigma (40 px, window radius 120): 4·10⁶ · 241² ≈ 2.3·10¹¹.
    const small = await chart(), side = 2000;
    const big: ImportedDngRaw = { ...small, width: side, height: side, codes: new Uint16Array(side * side), activeArea: { x: 0, y: 0, width: side, height: side },
      defaultCrop: { x: 0, y: 0, width: side, height: side }, opcodeList1: null, opcodeList2: null, opcodeList3: null };
    await expect(simulateTypicalProcessing({ frames: [big], fast: false }, provider)).rejects.toThrow(/spatialSigmaFraction.*localToneMapping\.fast: true/u);
    await expect(simulateTypicalProcessing({ frames: [big], fast: false, localToneMapping: { spatialSigmaFraction: 0.01 }, maximumWorkingBytes: 1000 }, provider))
      .rejects.toThrow(/maximumWorkingBytes/u);
  }, scaledTimeout(120_000));
});

describe("simulateTypicalProcessing: refusals (#740)", () => {
  it("refuses malformed requests and frames that do not match", async () => {
    const raw = await chart();
    const refuse = async (input: unknown, kind: typeof InvalidConfigurationError | typeof InvalidScientificInputError, pattern: RegExp): Promise<void> => {
      await expect(simulateTypicalProcessing(input as SimulateTypicalProcessingInput, provider)).rejects.toThrow(kind);
      await expect(simulateTypicalProcessing(input as SimulateTypicalProcessingInput, provider)).rejects.toThrow(pattern);
    };
    await refuse({ frames: [] }, InvalidConfigurationError, /1 to 32/u);
    await refuse({ frames: [raw], extra: 1 }, InvalidConfigurationError, /unknown option/u);
    await refuse({ frames: [raw], develop: { size: "half" } }, InvalidConfigurationError, /develop\.size/u);
    await refuse({ frames: [raw, raw], merge: false }, InvalidConfigurationError, /exactly one frame/u);
    await refuse({ frames: [raw], merge: { method: "median" } }, InvalidConfigurationError, /mean/u);
    await refuse({ frames: [raw], noiseReduction: { spatialSigmaPixels: 100 } }, InvalidConfigurationError, /spatialSigmaPixels/u);
    await refuse({ frames: [raw], saturation: { gain: -1 } }, InvalidConfigurationError, /gain/u);
    await refuse({ frames: [raw], localToneMapping: { fast: "yes" } }, InvalidConfigurationError, /fast/u);
    await refuse({ frames: [raw], format: "png" }, InvalidConfigurationError, /format/u);
    await refuse({ frames: [raw, { ...raw, whiteLevel: raw.whiteLevel.map((v) => v - 1) }] }, InvalidScientificInputError, /frames\[1\] differs from frames\[0\] in whiteLevel/u);
    await refuse({ frames: [raw, { ...raw, asShotNeutral: [0.5, 1, 0.6] }] }, InvalidScientificInputError, /asShotNeutral/u);
    await refuse({ frames: [raw], maximumWorkingBytes: 10_000 }, InvalidConfigurationError, /working memory/u);
  }, scaledTimeout(120_000));
});
