// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createDurandDorseyToneMappingTask, createExposureFusionTask, createReinhardGlobalToneMappingTask, InvalidConfigurationError,
  InvalidScientificInputError, InvalidScientificResultError, type DurandDorseyToneMappingOutput } from "../src/index.js";
import { gaussianPyramid, laplacianPyramid, collapse, reflect } from "../src/processing/image-ops.js";
import { mulberry32, psnr, rgbImage, runTask } from "./helpers/processing-fixture.js";

const Y = [0.2126390058715102, 0.7151686787677559, 0.0721923153607337];
const lum = (d: Float32Array, i: number): number => Y[0]! * d[3 * i]! + Y[1]! * d[3 * i + 1]! + Y[2]! * d[3 * i + 2]!;
function drain<T>(g: Generator<void, T, void>): T { for (;;) { const s = g.next(); if (s.done === true) return s.value; } }

describe("Laplacian pyramid primitives", () => {
  it("collapse(laplacian(I)) reconstructs I and a constant stays constant at every Gaussian level", () => {
    const random = mulberry32(5), data = Float32Array.from({ length: 13 * 7 * 3 }, () => random());
    const out = drain(collapse(drain(laplacianPyramid(data, 13, 7, 3, 4))));
    for (let i = 0; i < data.length; i++) expect(out[i]).toBeCloseTo(data[i]!, 5);
    const g = drain(gaussianPyramid(new Float32Array(9 * 5).fill(0.7), 9, 5, 1, 4));
    for (const level of g.levels) for (const v of level) expect(v).toBeCloseTo(0.7, 6);
    expect(g.sizes).toEqual([{ width: 9, height: 5 }, { width: 5, height: 3 }, { width: 3, height: 2 }, { width: 2, height: 1 }]);
  });
});

describe("Reinhard 2002 global operator", () => {
  it("matches the published formula with explicit key and white and preserves chromaticity", async () => {
    const image = rgbImage(2, 1, (x, _y, c) => (x === 0 ? [0.5, 1, 2] : [10, 20, 40])[c]!);
    const out = await runTask((p) => createReinhardGlobalToneMappingTask({ image, inputColorSpace: "linear-srgb-d65", key: 0.18, whiteLuminance: 1.5 }, p));
    const l = [lum(image.data, 0), lum(image.data, 1)], avg = Math.exp((Math.log(1e-6 + l[0]!) + Math.log(1e-6 + l[1]!)) / 2);
    expect(out.logAverageLuminance).toBeCloseTo(avg, 9);
    for (let i = 0; i < 2; i++) {
      const L = 0.18 * l[i]! / avg, ld = L * (1 + L / 2.25) / (1 + L);
      expect(lum(out.data, i)).toBeCloseTo(ld, 5);
      expect(out.data[3 * i]! / out.data[3 * i + 1]!).toBeCloseTo(image.data[3 * i]! / image.data[3 * i + 1]!, 5);
    }
    const uniform = await runTask((p) => createReinhardGlobalToneMappingTask({ image: rgbImage(3, 3, () => 4), inputColorSpace: "linear-rec2020-d65" }, p));
    // Default white = the largest scaled luminance, so a uniform image maps exactly to white.
    for (const v of uniform.data) expect(v).toBeCloseTo(1, 5);
    expect(() => createReinhardGlobalToneMappingTask({ image, inputColorSpace: "srgb" as "linear-srgb-d65" }, { yieldControl: async () => {} }))
      .toThrow(InvalidConfigurationError);
    expect(() => createReinhardGlobalToneMappingTask({ image, inputColorSpace: "linear-srgb-d65", key: 0 }, { yieldControl: async () => {} }))
      .toThrow(InvalidScientificInputError);
  });
});

describe("Durand & Dorsey 2002 bilateral operator", () => {
  it("compresses a 4-decade step to the target base contrast while keeping local detail", async () => {
    const W = 64, H = 32;
    const texture = (x: number, y: number): number => 1 + 0.1 * Math.sin(1.7 * x) * Math.cos(1.3 * y);
    const image = rgbImage(W, H, (x, y) => (x < W / 2 ? 0.01 : 100) * texture(x, y));
    const out = await runTask((p) => createDurandDorseyToneMappingTask({ image, inputColorSpace: "linear-srgb-d65", spatialSigmaPixels: 3, downsampleFactor: 1 }, p));
    const at = (x: number, y: number): number => lum(out.data, y * W + x);
    // Base (away from the step) ratio ≈ 5 instead of 10⁴; local texture ratio within a half is unchanged.
    expect(at(48, 16) / at(16, 16) / (texture(48, 16) / texture(16, 16))).toBeGreaterThan(4.5);
    expect(at(48, 16) / at(16, 16) / (texture(48, 16) / texture(16, 16))).toBeLessThan(5.5);
    expect(at(10, 10) / at(11, 10)).toBeCloseTo(texture(10, 10) / texture(11, 10), 2);
    expect(at(50, 20) / at(51, 20)).toBeCloseTo(texture(50, 20) / texture(51, 20), 2);
    expect(Math.max(...Array.from(out.baseLog10, (b) => b * out.compressionFactor)) - out.compressionFactor * Math.max(...out.baseLog10)).toBeCloseTo(0, 6);
  });

  it("fast piecewise-linear bilateral base stays within 0.03 log10 of a brute-force bilateral filter", async () => {
    const W = 24, H = 20, random = mulberry32(9), sigmaS = 2, sigmaR = 0.4;
    const image = rgbImage(W, H, (x, y) => (x + y > 20 ? 30 : 0.3) * (1 + 0.2 * random()));
    const out = await runTask((p) => createDurandDorseyToneMappingTask({ image, inputColorSpace: "linear-srgb-d65", spatialSigmaPixels: sigmaS,
      rangeSigmaLog10: sigmaR, downsampleFactor: 1 }, p));
    const logL = Array.from({ length: W * H }, (_, i) => Math.log10(lum(image.data, i)));
    let worst = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, w = 0;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const v = logL[reflect(y + dy, H) * W + reflect(x + dx, W)]!, c = logL[y * W + x]!;
        const k = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS)) * Math.exp(-((v - c) ** 2) / (2 * sigmaR * sigmaR));
        s += k * v; w += k;
      }
      worst = Math.max(worst, Math.abs(s / w - out.baseLog10[y * W + x]!));
    }
    expect(worst).toBeLessThan(0.03);
  });

  it("excludes zero-luminance pixels: one black pixel barely changes the rest, and an all-black image stays black", async () => {
    const W = 64, H = 64;
    const ramp = (x: number): number => 10 ** (-2 + 4 * x / (W - 1));
    const run = (image: ReturnType<typeof rgbImage>, z?: number): Promise<DurandDorseyToneMappingOutput> => runTask((p) => createDurandDorseyToneMappingTask({ image, inputColorSpace: "linear-srgb-d65",
      ...(z === undefined ? {} : { downsampleFactor: z }) }, p));
    for (const z of [undefined, 4]) {
      const a = await run(rgbImage(W, H, (x) => ramp(x)), z);
      const b = await run(rgbImage(W, H, (x, y) => (x === 0 && y === H - 1 ? 0 : ramp(x))), z);
      // Before the fix the floored log10 (−30) set the range: compression factor 0.180 → 0.022.
      expect(b.compressionFactor).toBeCloseTo(a.compressionFactor, 3);
      const black = (H - 1) * W;
      expect([b.data[3 * black], b.data[3 * black + 1], b.data[3 * black + 2]]).toEqual([0, 0, 0]);
      expect(b.baseLog10[black]).toBe(-Infinity);
      let worst = 0;
      for (let i = 0; i < W * H; i++) if (i !== black) worst = Math.max(worst, Math.abs(lum(b.data, i) / lum(a.data, i) - 1));
      expect(worst).toBeLessThan(0.02);
    }
    const dark = await run(rgbImage(8, 8, () => 0));
    expect(dark.compressionFactor).toBe(1);
    expect(dark.data.every((v) => v === 0)).toBe(true);
    expect(dark.aboveOneSampleCount).toBe(0);
  });
});

describe("Mertens 2007 exposure fusion", () => {
  it("returns the input for identical frames and favours the well-exposed frame", async () => {
    const random = mulberry32(3), base = rgbImage(32, 24, (x, y, c) => 0.5 + 0.2 * Math.sin(0.5 * x + c) * Math.cos(0.4 * y) + 0.02 * random());
    const same = await runTask((p) => createExposureFusionTask({ frames: [base, base, base] }, p));
    for (let i = 0; i < base.data.length; i++) expect(same.data[i]).toBeCloseTo(base.data[i]!, 5);
    const dark = rgbImage(32, 24, (x, y, c) => base.data[3 * (y * 32 + x) + c]! * 0.05);
    const bright = rgbImage(32, 24, (x, y, c) => Math.min(1, base.data[3 * (y * 32 + x) + c]! * 4));
    const fused = await runTask((p) => createExposureFusionTask({ frames: [dark, base, bright] }, p));
    expect(psnr(fused.data, base.data)).toBeGreaterThan(25);
    expect(psnr(fused.data, base.data)).toBeGreaterThan(psnr(dark.data, base.data) + 10);
    expect(() => createExposureFusionTask({ frames: [base, rgbImage(2, 2, () => 0)] }, { yieldControl: async () => {} })).toThrow(InvalidConfigurationError);
  });
});

describe("non-finite results and the intensity-node cap (capture-10, capture-11, #698)", () => {
  const ramp = rgbImage(12, 4, (x, y) => 0.01 + 0.1 * (x + 12 * y));
  it("Reinhard with a tiny whiteLuminance and fusion of huge frames fail closed instead of storing Infinity or NaN", async () => {
    for (const whiteLuminance of [1e-20, 1e-200]) {
      await expect(runTask((p) => createReinhardGlobalToneMappingTask({ image: ramp, inputColorSpace: "linear-srgb-d65", whiteLuminance }, p)))
        .rejects.toThrow(InvalidScientificResultError);
    }
    const huge = rgbImage(4, 4, (x, y, c) => 1e30 * (1 + ((x + y + c) % 3)));
    await expect(runTask((p) => createExposureFusionTask({ frames: [huge, huge], contrastExponent: 16 }, p))).rejects.toThrow(InvalidScientificResultError);
  });
  it("Durand-Dorsey refuses a range sigma that needs more than 4096 nodes and its estimate covers the planes it holds", async () => {
    const wide = rgbImage(16, 16, (x, y) => 10 ** (-15 + 30 * (x + 16 * y) / 255));
    await expect(runTask((p) => createDurandDorseyToneMappingTask({ image: wide, inputColorSpace: "linear-srgb-d65", rangeSigmaLog10: 0.001 }, p)))
      .rejects.toThrow(InvalidScientificInputError);
    const narrow = rgbImage(16, 16, (x, y) => 10 ** (-1.5 + 3 * (x + 16 * y) / 255));
    const task = createDurandDorseyToneMappingTask({ image: narrow, inputColorSpace: "linear-srgb-d65", rangeSigmaLog10: 0.01 }, { yieldControl: async () => {} });
    const z = Math.max(1, Math.round(Math.max(0.5, 0.02 * 16) / 4)), cells = Math.ceil(16 / z) ** 2, planes = Math.ceil(3 / 0.01) + 1;
    expect(task.estimatedWorkingBytes).toBeGreaterThanOrEqual(planes * cells * 4);
  });
});
