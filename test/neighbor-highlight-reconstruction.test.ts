// SPDX-License-Identifier: Apache-2.0
/**
 * #602 (2.22.0): highlight reconstruction from neighboring pixels (src/color/neighbor-highlight-reconstruction.ts) on synthetic
 * clipped scenes with known ground truth, in captures, and in the display view against the downsized capture.
 */
import { describe, expect, it } from "vitest";
import { NEIGHBOR_HIGHLIGHT_THRESHOLD, reconstructHighlightsFromNeighbors } from "../src/color/neighbor-highlight-reconstruction.js";
import { simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";

const GAINS = [2, 1, 1.5];
/** A synthetic white-balanced image: a bright blob of hue ρ(x, y) over a darker surround; channels clip at their white (c = 1). */
function scene(width: number, height: number, hue: (x: number, y: number) => [number, number, number]): { truth: Float64Array; clipped: Float64Array } {
  const truth = new Float64Array(3 * width * height), clipped = new Float64Array(3 * width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const d2 = ((x - width / 2) ** 2 + (y - height / 2) ** 2) / (width * width / 16), brightness = 0.6 + 2.4 * Math.exp(-d2), rho = hue(x, y);
    for (let c = 0; c < 3; c++) {
      const i = 3 * (y * width + x) + c, u = brightness * rho[c]!;
      truth[i] = u; clipped[i] = Math.min(u, GAINS[c]!);
    }
  }
  return { truth, clipped };
}
/** The mean absolute error over the clipped pixels that keep an unclipped channel (where the scale is known). */
const clippedError = (image: Float64Array, truth: Float64Array): number => {
  let e = 0, n = 0;
  for (let i = 0; i < image.length / 3; i++) {
    const clippedPixel = [0, 1, 2].some((c) => truth[3 * i + c]! / GAINS[c]! >= NEIGHBOR_HIGHLIGHT_THRESHOLD), known = [0, 1, 2].some((c) => truth[3 * i + c]! / GAINS[c]! < NEIGHBOR_HIGHLIGHT_THRESHOLD);
    if (clippedPixel && known) for (let c = 0; c < 3; c++) { e += Math.abs(image[3 * i + c]! - truth[3 * i + c]!); n++; }
  }
  return e / n;
};

describe("highlight reconstruction from neighbors (#602)", () => {
  it("rebuilds a region of constant hue exactly where a channel is unclipped, fast and full", () => {
    for (const fast of [true, false]) {
      const { truth, clipped } = scene(48, 40, () => [1.1, 0.75, 0.5]);
      const image = Float64Array.from(clipped), report = reconstructHighlightsFromNeighbors(image, 48, 40, GAINS, fast);
      expect(report.regionCount).toBe(1);
      expect(report.reconstructedPixelCount).toBeGreaterThan(50);
      for (let i = 0; i < 48 * 40; i++) {
        const unclippedChannel = [0, 1, 2].some((c) => truth[3 * i + c]! / GAINS[c]! < NEIGHBOR_HIGHLIGHT_THRESHOLD);
        if (unclippedChannel) for (let c = 0; c < 3; c++) expect(image[3 * i + c]!).toBeCloseTo(truth[3 * i + c]!, 9);
        // Never below what was recorded.
        for (let c = 0; c < 3; c++) expect(image[3 * i + c]!).toBeGreaterThanOrEqual(clipped[3 * i + c]! - 1e-12);
      }
      if (!fast) expect(report).toMatchObject({ method: "harmonic-interpolation", converged: true });
    }
  });

  it("follows a hue gradient: the harmonic fill (full) is closer to the truth than the ring mean (fast)", () => {
    const hue = (x: number): [number, number, number] => { const t = x / 64; return [1.2 - 0.5 * t, 0.7, 0.4 + 0.5 * t]; };
    const { truth, clipped } = scene(64, 48, hue);
    const fastImage = Float64Array.from(clipped), fullImage = Float64Array.from(clipped);
    reconstructHighlightsFromNeighbors(fastImage, 64, 48, GAINS, true);
    const full = reconstructHighlightsFromNeighbors(fullImage, 64, 48, GAINS, false);
    expect(full.converged).toBe(true);
    const before = clippedError(clipped, truth), fastError = clippedError(fastImage, truth), fullError = clippedError(fullImage, truth);
    expect(fastError).toBeLessThan(before);
    expect(fullError).toBeLessThan(0.5 * fastError);
  });
});

describe("captures and display views with reconstruct-neighbors (#602)", () => {
  const options: SimulateCaptureOptions = { scene: { preset: "color-patches" }, exposure: { shutterSeconds: 1 / 15 }, sensor: { pixelPitchMicrometers: 3 }, output: { width: 192, height: 128 } };
  it("rebuilds clipped highlights in a capture, reports the method, and refuses a region", async () => {
    const clip = await simulateCapture(options), neighbors = await simulateCapture({ ...options, output: { ...options.output, highlightMode: "reconstruct-neighbors" } });
    expect(neighbors.diagnostics.highlight).toMatchObject({ mode: "reconstruct-neighbors" });
    expect(neighbors.diagnostics.highlight.reconstructedPixelCount).toBeGreaterThan(0);
    expect(neighbors.assumptions.find((a) => a.id === "output.highlightMode.reconstructNeighbors")?.value).toMatchObject({ method: "ring-average", fast: true });
    expect(Array.from(neighbors.image.samples)).not.toEqual(Array.from(clip.image.samples));
    const exact = await simulateCapture({ ...options, fast: false, output: { ...options.output, highlightMode: "reconstruct-neighbors" } });
    expect(exact.assumptions.find((a) => a.id === "output.highlightMode.reconstructNeighbors")?.value).toMatchObject({ method: "harmonic-interpolation", fast: false });
    await expect(simulateCapture({ ...options, output: { ...options.output, highlightMode: "reconstruct-neighbors", region: { x: 0, y: 0, width: 32, height: 32 } } })).rejects.toThrow(/region/u);
  }, 120_000);

  it("gives the display view the downsized capture's means, fast and full", async () => {
    const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
    const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
    for (const fast of [true, false]) {
      const request: SimulateCaptureOptions = { ...options, fast, output: { ...options.output, highlightMode: "reconstruct-neighbors" } };
      const capture = await simulateCapture({ ...request, output: { ...request.output, format: "srgb-16" } });
      const { result, internals } = await simulateDisplayViewWithInternals(request, { width: 24, height: 16, format: "srgb-16" });
      expect(result.assumptions.find((a) => a.id === "view.rendering")?.value).toMatchObject({ highlightMode: "reconstruct-neighbors", fast });
      let worst = 0;
      for (const k of [0, 1, 2]) {
        let reference = 0, expected = 0;
        for (let i = 0; i < 192 * 128; i++) reference += decode(capture.image.samples[3 * i + k]!) / (192 * 128);
        for (let i = 0; i < 24 * 16; i++) expected += internals.expected[3 * i + k]! / (24 * 16);
        expect(Math.abs(encode8(expected) - encode8(reference))).toBeLessThan(0.25);
        for (let j = 0; j < 16; j++) for (let i = 0; i < 24; i++) {
          let r = 0;
          for (let y = j * 8; y < j * 8 + 8; y++) for (let x = i * 8; x < i * 8 + 8; x++) r += decode(capture.image.samples[3 * (y * 192 + x) + k]!) / 64;
          worst = Math.max(worst, Math.abs(encode8(internals.expected[3 * (j * 24 + i) + k]!) - encode8(r)));
        }
      }
      // Measured 2026-11-11: 2.1 codes fast (as the clip mode's 2.1: the capture's own noise) and 4.4 full (the capture's noisy
      // Dirichlet values against the view's noise-free ones).
      expect(worst).toBeLessThan(fast ? 3 : 5);
    }
    // Not on the GPU in 2.22.0: a prepared view falls back to the CPU reference, labeled.
    const view = await simulateDisplayView({ ...options, output: { ...options.output, highlightMode: "reconstruct-neighbors" } }, { width: 8, height: 6 });
    expect(view.image.samples.length).toBe(8 * 6 * 3);
  }, 240_000);
});
