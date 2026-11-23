// SPDX-License-Identifier: Apache-2.0
/**
 * #515: exposure.standardExposureDeviationStops, the deviation of the exposure used from the CIPA DC-004-2020 standard
 * exposure for the metered luminance, Δ = log2(N²/t) − log2(0.65·L·S/10) (S = 10/H, H = 0.65·L·t/N²). Positive is darker.
 */
import { describe, expect, it } from "vitest";
import { simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";

const small = { scene: { preset: "uniform" }, output: { width: 4, height: 4 } } as const;
const deviation = async (options: Partial<SimulateCaptureOptions>): Promise<number | null> =>
  (await simulateCapture({ ...small, ...options } as SimulateCaptureOptions)).exposure.standardExposureDeviationStops;

describe("exposure.standardExposureDeviationStops (#515)", { timeout: 60_000 }, () => {
  it("is 0 at f/8, 1/125 s, ISO 100 under the default illuminance", async () => {
    const r = await simulateCapture(small);
    // The metered luminance is the spectral quadrature of the 18 % grey (≈ 1230.77 cd/m², to about 1e-5 relative).
    expect(r.exposure.standardExposureDeviationStops).toBeCloseTo(0, 3);
    expect(r.exposure.standardExposureDeviationStops).toBeCloseTo(Math.log2(10 * 64 / (0.65 * (1 / 125) * 100 * r.exposure.meteredSceneLuminanceCdPerSquareMeter)), 12);
  });

  it("is positive when darker: +0.92 at the marked f/11, +1 at f/8√2", async () => {
    expect(Math.log2(11 ** 2 / 8 ** 2)).toBeCloseTo(0.919, 3);
    expect(await deviation({ lens: { fNumber: 11 } })).toBeCloseTo(0.919, 3);
    expect(await deviation({ lens: { fNumber: 8 * Math.SQRT2 } })).toBeCloseTo(1, 3);
  });

  it("is negative when brighter: −1.06 at the marked 1/60 s, −1 at ISO 200", async () => {
    expect(await deviation({ exposure: { shutterSeconds: 1 / 60 } })).toBeCloseTo(Math.log2(60 / 125), 3);
    expect(Math.log2(60 / 125)).toBeCloseTo(-1.059, 3);
    expect(await deviation({ exposure: { iso: 200 } })).toBeCloseTo(-1, 3);
  });

  it("reflects the exposure used in aperture priority: the compensation, and the slowest-shutter limit", async () => {
    expect(await deviation({ exposure: { mode: "aperture-priority", compensationStops: 2 / 3 } })).toBeCloseTo(-2 / 3, 3);
    expect(await deviation({ exposure: { mode: "aperture-priority" } })).toBeCloseTo(0, 3);
    // At 0.01 lux the metered shutter would be far beyond the tier's 30 s limit; the engine uses 30 s, so the result is under.
    const dark = await simulateCapture({ ...small, exposure: { mode: "aperture-priority" }, illuminanceLux: 0.01 });
    expect(dark.exposure.settings.shutterSeconds).toBe(30);
    const expected = Math.log2(10 * 64 / (0.65 * 30 * 100 * dark.exposure.meteredSceneLuminanceCdPerSquareMeter));
    expect(dark.exposure.standardExposureDeviationStops).toBeCloseTo(expected, 12);
    expect(expected).toBeGreaterThan(9);
  });

  it("is the same in the display view and null, never infinite, for a black scene", async () => {
    const options = { ...small, lens: { fNumber: 11 } } as SimulateCaptureOptions;
    const [capture, view] = await Promise.all([simulateCapture(options), simulateDisplayView(options, { width: 2, height: 2 })]);
    expect(view.exposure.standardExposureDeviationStops).toBe(capture.exposure.standardExposureDeviationStops);
    const black = await simulateCapture({ ...small, scene: { kind: "reflectance-function", sceneId: "black", evaluate: () => 0 } } as SimulateCaptureOptions);
    expect(black.exposure.meteredSceneLuminanceCdPerSquareMeter).toBe(0);
    expect(black.exposure.standardExposureDeviationStops).toBeNull();
  });
});
