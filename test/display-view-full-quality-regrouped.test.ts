// SPDX-License-Identifier: Apache-2.0
/**
 * #670 win 1 (owner decision 2026-11-21): full-quality display views (`fast: false`, the flag batch figure renders use) take the
 * two exact regroupings that 2.27.0 ran only on fast requests: a chart site's kernel taps summed per tap from the pre-integrated
 * spectral radiance (#643, #653) and a wide defocus disc applied after each channel's in-focus signal, by runs (#612, #642). Both are
 * the same sums in another order; the samples of the request below are those of the per-material sums and the combined kernels,
 * and the sites agree to rounding.
 */
import { describe, expect, it } from "vitest";
import { prepareDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const chart = { preset: "siemens-star" } as const;
const base = (lens: NonNullable<SimulateCaptureOptions["lens"]>): SimulateCaptureOptions => ({ scene: chart, subjectDistanceM: 2, lens,
  sensor: { pixelPitchMicrometers: 6 }, output: { width: 1200, height: 800, format: "srgb-8" }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 } });
const view = { width: 300, height: 200, samplesPerAxis: 2, region: { x: 130, y: 90, width: 40, height: 20 } };
const assumption = (r: { assumptions: readonly { id: string; value: unknown }[] }, id: string): Record<string, unknown> | undefined =>
  r.assumptions.find((a) => a.id === id)?.value as Record<string, unknown> | undefined;

describe("full-quality display views take the exact regroupings (#670 win 1)", () => {
  it("sums a chart site's diffraction taps per tap with fast: false and reports it without a fast label", async () => {
    for (const fast of [false, true]) {
      const prepared = await prepareDisplayView({ ...base({ prime: 50, fNumber: 8, diffraction: "circular-aperture" }), fast }, { gpu: "off" });
      const r = await prepared.render(view);
      expect(assumption(r, "view.signal"), String(fast)).toEqual({ sum: "per-tap" });
    }
  }, scaledTimeout(120_000));

  it("applies a wide defocus disc after the in-focus signal with fast: false", async () => {
    // 6000 × 4000 at 6 µm, f/2 focused at 1.6 m with the chart at 2 m (the batch figure set's dof-near case): a disc of tens of sites.
    const request = { ...base({ prime: 50, fNumber: 2, focusDistanceM: 1.6, diffraction: "circular-aperture", defocus: { model: "geometric-disc" } }), fast: false };
    const prepared = await prepareDisplayView({ ...request, output: { width: 6000, height: 4000, format: "srgb-8", maximumPixels: 2 ** 25 } }, { gpu: "off" });
    const r = await prepared.render({ width: 1500, height: 1000, samplesPerAxis: 1, region: { x: 600, y: 480, width: 200, height: 24 } });
    expect(assumption(r, "view.defocus"), JSON.stringify(assumption(r, "view.defocus"))).toMatchObject({ convolution: "runs" });
    expect(assumption(r, "view.defocus")!.fast).toBeUndefined();
  }, scaledTimeout(120_000));
});
