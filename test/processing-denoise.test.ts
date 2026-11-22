// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createBilateralFilterTask, createNonLocalMeansTask, createSyntheticFilmGrainTask, createUnsharpMaskTask, InvalidConfigurationError,
  InvalidScientificInputError, InvalidScientificResultError, SYNTHETIC_FILM_GRAIN_STREAM_ID, type ProcessingRgbImage } from "../src/index.js";
import { gaussian, mulberry32, rgbImage, runTask } from "./helpers/processing-fixture.js";

const W = 40, H = 24, SIGMA = 0.05;
/** Step edge (0.2 | 0.8) plus seeded Gaussian noise σ = 0.05. */
function noisyStep(seed = 1): { clean: ProcessingRgbImage; noisy: ProcessingRgbImage } {
  const random = mulberry32(seed), clean = rgbImage(W, H, (x) => (x < W / 2 ? 0.2 : 0.8));
  return { clean, noisy: rgbImage(W, H, (x, y, c) => clean.data[3 * (y * W + x) + c]! + SIGMA * gaussian(random)) };
}
function stats(data: Float32Array, clean: Float32Array, xs: (x: number) => boolean): { bias: number; rms: number } {
  let s = 0, s2 = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (xs(x)) for (let c = 0; c < 3; c++) {
    const e = data[3 * (y * W + x) + c]! - clean[3 * (y * W + x) + c]!; s += e; s2 += e * e; n++;
  }
  return { bias: s / n, rms: Math.sqrt(s2 / n) };
}

describe("edge-preserving denoising", () => {
  it("bilateral and non-local means cut flat-region noise and keep the step edge", async () => {
    const { clean, noisy } = noisyStep();
    const before = stats(noisy.data, clean.data, () => true).rms;
    expect(before).toBeCloseTo(SIGMA, 2);
    const bilateral = await runTask((p) => createBilateralFilterTask({ image: noisy, spatialSigmaPixels: 2, rangeSigma: 0.15 }, p));
    const nlm = await runTask((p) => createNonLocalMeansTask({ image: noisy, filteringParameter: 0.4 * SIGMA * 3, noiseStandardDeviation: SIGMA,
      patchRadius: 1, searchRadius: 5 }, p));
    for (const out of [bilateral, nlm]) {
      expect(stats(out.data, clean.data, (x) => x < 16 || x >= 24).rms).toBeLessThan(before / 2.5);
      // Edge columns keep their side: no blur across the 0.6 step.
      expect(Math.abs(stats(out.data, clean.data, (x) => x === 19 || x === 20).bias)).toBeLessThan(0.02);
      expect(stats(out.data, clean.data, (x) => x === 19 || x === 20).rms).toBeLessThan(before);
    }
    const flat = rgbImage(9, 9, () => 0.3);
    const unchanged = await runTask((p) => createNonLocalMeansTask({ image: flat, filteringParameter: 0.1 }, p));
    for (const v of unchanged.data) expect(v).toBeCloseTo(0.3, 6);
    expect(() => createNonLocalMeansTask({ image: flat, filteringParameter: 0 }, { yieldControl: async () => {} })).toThrow(InvalidScientificInputError);
    expect(() => createBilateralFilterTask({ image: flat, spatialSigmaPixels: 1, rangeSigma: 1, extra: 1 } as never, { yieldControl: async () => {} }))
      .toThrow(InvalidConfigurationError);
  });
});

describe("unsharp mask", () => {
  it("leaves constants unchanged and amplifies a sinusoid by 1 + a(1 − e^(−2π²σ²f²))", async () => {
    const flat = await runTask((p) => createUnsharpMaskTask({ image: rgbImage(8, 8, () => 0.4), radiusSigmaPixels: 1.5, amount: 1 }, p));
    for (const v of flat.data) expect(v).toBeCloseTo(0.4, 6);
    const f = 1 / 16, sigma = 1.5, amount = 0.8, N = 64;
    const image = rgbImage(N, 4, (x) => 0.5 + 0.1 * Math.cos(2 * Math.PI * f * x));
    const out = await runTask((p) => createUnsharpMaskTask({ image, radiusSigmaPixels: sigma, amount }, p));
    const gain = 1 + amount * (1 - Math.exp(-2 * Math.PI ** 2 * sigma ** 2 * f ** 2));
    // The reflect-101 border is symmetric about x = 0 for a cosine, so the left part follows the analytic gain.
    for (let x = 0; x < 48; x++) expect(out.data[3 * (2 * N + x)]! - 0.5).toBeCloseTo(0.1 * gain * Math.cos(2 * Math.PI * f * x), 3);
    const thresholded = await runTask((p) => createUnsharpMaskTask({ image, radiusSigmaPixels: sigma, amount, threshold: 1 }, p));
    expect(Array.from(thresholded.data)).toEqual(Array.from(image.data));
  });
});

describe("synthetic film grain", () => {
  it("is deterministic, labelled synthetic, mid-tone weighted and spatially correlated by grain size", async () => {
    const grey = rgbImage(64, 64, () => 0.5), seed = 1234;
    const a = await runTask((p) => createSyntheticFilmGrainTask({ image: grey, seedUint32: seed, intensity: 0.04, grainSizePixels: 0 }, p));
    const b = await runTask((p) => createSyntheticFilmGrainTask({ image: grey, seedUint32: seed, intensity: 0.04, grainSizePixels: 0 }, p));
    const c = await runTask((p) => createSyntheticFilmGrainTask({ image: grey, seedUint32: seed + 1, intensity: 0.04, grainSizePixels: 0 }, p));
    expect(Array.from(a.data)).toEqual(Array.from(b.data)); expect(Array.from(a.data)).not.toEqual(Array.from(c.data));
    expect(a.syntheticAesthetic).toBe(true); expect(a.physicalFilmModel).toBe(false); expect(SYNTHETIC_FILM_GRAIN_STREAM_ID).toBe(64);
    expect(a.provenance.assumptions[0]).toMatch(/not a physical film/u);
    const moments = (d: Float32Array): { mean: number; sd: number; correlation: number } => { let s = 0, s2 = 0, lag = 0; for (let i = 0; i < d.length; i += 3) { const v = d[i]! - 0.5; s += v; s2 += v * v; if (i + 3 < d.length) lag += v * (d[i + 3]! - 0.5); }
      const n = d.length / 3; return { mean: s / n, sd: Math.sqrt(s2 / n), correlation: lag / s2 }; };
    const white = moments(a.data);
    expect(Math.abs(white.mean)).toBeLessThan(0.002); expect(white.sd).toBeGreaterThan(0.037); expect(white.sd).toBeLessThan(0.043);
    expect(Math.abs(white.correlation)).toBeLessThan(0.05);
    const coarse = moments((await runTask((p) => createSyntheticFilmGrainTask({ image: grey, seedUint32: seed, intensity: 0.04, grainSizePixels: 2 }, p))).data);
    expect(coarse.sd).toBeGreaterThan(0.03); expect(coarse.correlation).toBeGreaterThan(0.8);
    // Monochrome grain is shared by the channels; black and white carry no grain.
    expect(a.data[0]).toBe(a.data[1]);
    const ends = await runTask((p) => createSyntheticFilmGrainTask({ image: rgbImage(2, 1, (x) => x), seedUint32: 1, intensity: 0.5 }, p));
    expect(Array.from(ends.data)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(() => createSyntheticFilmGrainTask({ image: grey, seedUint32: -1, intensity: 0.1 }, { yieldControl: async () => {} })).toThrow(InvalidConfigurationError);
  });
});

describe("non-finite results (capture-10, #698)", () => {
  it("the bilateral filter with a range sigma whose 1/(2 sigma^2) overflows and an unsharp mask that overflows float32 fail closed", async () => {
    const image = rgbImage(6, 4, (x, y, c) => 0.1 * (x + y + c));
    await expect(runTask((p) => createBilateralFilterTask({ image, spatialSigmaPixels: 1, rangeSigma: 1e-200 }, p))).rejects.toThrow(InvalidScientificResultError);
    const edge = rgbImage(6, 4, (x) => (x < 3 ? 0 : 3e38));
    await expect(runTask((p) => createUnsharpMaskTask({ image: edge, radiusSigmaPixels: 1, amount: 100 }, p))).rejects.toThrow(InvalidScientificResultError);
  });
});
