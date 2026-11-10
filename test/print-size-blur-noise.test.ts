// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  calculatePrintSizeLimit, calculatePrintSizeLimitWithBlurAndNoise, calculateSignalToNoise, InvalidConfigurationError,
  InvalidScientificInputError, type PrintSizeLimitWithBlurAndNoiseInput
} from "../src/index.js";

// 6000 x 4000 pixels of 4 µm (a 24 x 16 mm frame) viewed at 500 mm with a 1 arcminute criterion.
// Independent value: s = 2 · 500 · tan(π / 21600) = 0.145444105... mm (Taylor series, tan x = x + x³/3 + ...;
// x³/3 ≈ 1e-11 of x), so the pixel limit is 6000 s = 872.66... mm wide.
const S = 1000 * (Math.PI / 21600 + (Math.PI / 21600) ** 3 / 3);
function request(over: Partial<PrintSizeLimitWithBlurAndNoiseInput> = {}): PrintSizeLimitWithBlurAndNoiseInput {
  return {
    raster: { pixelWidth: 6000, pixelHeight: 4000 }, pixelPitchMm: 0.004, viewingDistance: { value: 500, unit: "mm" },
    criterion: { kind: "visual-resolution", arcminutes: 1, minimumVisibleSnr: 20 },
    blur: { kind: "components", diffractionMm: 0.002 }, noise: { kind: "pixel-snr", snrLinear: 40 }, ...over
  };
}

describe("print size limit with blur and noise (#574)", () => {
  it("is pixel-limited for a sharp, clean capture and agrees with the pixel-only planner", () => {
    const result = calculatePrintSizeLimitWithBlurAndNoise(request()), v = result.value;
    expect(result.provenance.kind).toBe("approximation");
    expect(v.status).toBe("finite"); expect(v.limitingFactor).toBe("pixels");
    expect(v.resolvedSpotMm).toBeCloseTo(S, 12);
    expect(v.maximumImageMm.width).toBeCloseTo(6000 * S, 9); expect(v.maximumImageMm.height).toBeCloseTo(4000 * S, 9);
    // Half-pixel blur: its own limit is twice the pixel limit; SNR 40 ≥ 20, so noise never limits.
    expect(v.blur.diameterPixels).toBeCloseTo(0.5, 12); expect(v.limits.blur?.width).toBeCloseTo(2 * 6000 * S, 9);
    expect(v.limits.noise).toBeNull(); expect(v.noise.visibleSnrAtMaximum).toBe(40);
    // calculatePrintSizeLimit (fixed distance, 1 arcmin per pixel) rounds down to whole exact-ratio pixel units only.
    const pixelOnly = calculatePrintSizeLimit({ viewingDistancePolicy: "fixed", plan: {
      source: { kind: "native-retained", captureId: "c1", geometry: { imagingArea: { widthMm: 24, heightMm: 16 }, nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 }, orientation: "landscape" } },
      printedImage: { width: 300, height: 200, unit: "mm" }, viewingDistance: { value: 500, unit: "mm" },
      sampling: { kind: "angular-pixel-pitch", maximumArcminutesPerPixel: 1 }, fit: { kind: "confirmed-native-aspect", maximumRelativeAspectError: 1e-12 } } }).value;
    expect(pixelOnly.maximumImageMm?.width).toBeCloseTo(v.maximumImageMm.width, 6);
  });

  it("is blur-limited by defocus and names the largest part", () => {
    // Parts 12 µm defocus, 3 µm diffraction, 4 µm motion: root-sum-square √(144 + 9 + 16) = 13 µm = 3.25 pixels.
    const v = calculatePrintSizeLimitWithBlurAndNoise(request({ blur: { kind: "components", defocusMm: 0.012, diffractionMm: 0.003, motionMm: 0.004 } })).value;
    expect(v.limitingFactor).toBe("blur"); expect(v.blur.largestComponent).toBe("defocus");
    expect(v.blur.diameterMm).toBeCloseTo(0.013, 15); expect(v.blur.diameterPixels).toBeCloseTo(3.25, 12);
    expect(v.maximumImageMm.width).toBeCloseTo(6000 * S / 3.25, 9);
    // At that size the blur on the print covers exactly the criterion spot.
    expect(v.blur.diameterPixels * v.maximumImageMm.width / 6000).toBeCloseTo(v.resolvedSpotMm, 12);
    const measured = calculatePrintSizeLimitWithBlurAndNoise(request({ blur: { kind: "measured-total", diameterMm: 0.013 } })).value;
    expect(measured.maximumImageMm.width).toBeCloseTo(v.maximumImageMm.width, 9); expect(measured.blur.largestComponent).toBe("measured-total");
  });

  it("is noise-limited at low SNR from the engine's shot-plus-read noise model", () => {
    // 100 e⁻ and 2 e⁻ read noise: SNR = 100 / √104 ≈ 9.806; the limit is the pixel limit times 9.806 / 20.
    const v = calculatePrintSizeLimitWithBlurAndNoise(request({ noise: { kind: "shot-and-read-noise", signalElectrons: 100, readNoiseElectrons: 2 } })).value;
    const snr = 100 / Math.sqrt(104);
    expect(v.noise.pixelSnr).toBeCloseTo(snr, 12);
    expect(v.noise.pixelSnr).toBe(calculateSignalToNoise({ signalElectrons: 100, readNoiseElectrons: 2 }).value.snrLinear);
    expect(v.limitingFactor).toBe("noise"); expect(v.maximumImageMm.width).toBeCloseTo(6000 * S * snr / 20, 9);
    // The eye averages (s / print pixel)² pixels, raising the SNR by s / print pixel to exactly the threshold.
    expect(v.noise.visibleSnrAtMaximum).toBeCloseTo(20, 10);
    // Four times the signal doubles the shot-limited SNR and so roughly doubles the size.
    const brighter = calculatePrintSizeLimitWithBlurAndNoise(request({ noise: { kind: "shot-and-read-noise", signalElectrons: 400, readNoiseElectrons: 0 } })).value;
    expect(brighter.limits.noise).toBeNull();
    const shot = calculatePrintSizeLimitWithBlurAndNoise(request({ noise: { kind: "shot-and-read-noise", signalElectrons: 25, readNoiseElectrons: 0 } })).value;
    const shot4 = calculatePrintSizeLimitWithBlurAndNoise(request({ noise: { kind: "shot-and-read-noise", signalElectrons: 100, readNoiseElectrons: 0 } })).value;
    expect(shot4.maximumImageMm.width / shot.maximumImageMm.width).toBeCloseTo(2, 12);
  });

  it("scales with viewing distance and reports no positive size for zero signal", () => {
    const near = calculatePrintSizeLimitWithBlurAndNoise(request()).value;
    const far = calculatePrintSizeLimitWithBlurAndNoise(request({ viewingDistance: { value: 1, unit: "m" } })).value;
    expect(far.maximumImageMm.width / near.maximumImageMm.width).toBeCloseTo(2, 9);
    const none = calculatePrintSizeLimitWithBlurAndNoise(request({ noise: { kind: "pixel-snr", snrLinear: 0 } })).value;
    expect(none.status).toBe("no-positive-size"); expect(none.maximumImageMm.width).toBe(0); expect(none.noise.visibleSnrAtMaximum).toBe(0);
    const noBlur = calculatePrintSizeLimitWithBlurAndNoise(request({ blur: { kind: "components" } })).value;
    expect(noBlur.limits.blur).toBeNull(); expect(noBlur.blur.largestComponent).toBeNull();
  });

  it("takes a capture's own mid-gray noise figure (#535) as the pixel SNR", async () => {
    const { simulateCapture } = await import("../src/index.js");
    const midGrey = (await simulateCapture({ scene: { preset: "uniform" }, output: { width: 16, height: 16 }, exposure: { iso: 6400 }, illuminanceLux: 21480.98 / 64, fast: false })).sensor.midGrey!;
    const figure = calculatePrintSizeLimitWithBlurAndNoise(request({ noise: { kind: "capture-noise-figure", midGrey } })).value;
    const snr = calculatePrintSizeLimitWithBlurAndNoise(request({ noise: { kind: "pixel-snr", snrLinear: midGrey.snr } })).value;
    expect(figure.noise.pixelSnr).toBeCloseTo(midGrey.snr, 12);
    expect(figure.maximumImageMm.width).toBeCloseTo(snr.maximumImageMm.width, 9);
    expect(() => calculatePrintSizeLimitWithBlurAndNoise(request({ noise: { kind: "capture-noise-figure", midGrey: { ...midGrey, clipped: true } } }))).toThrow(/clipped/u);
    expect(() => calculatePrintSizeLimitWithBlurAndNoise(request({ noise: { kind: "capture-noise-figure", midGrey: undefined as never } }))).toThrow(InvalidConfigurationError);
  }, 60_000);

  it("rejects invalid input with domain errors", () => {
    const bad: unknown[] = [
      { ...request(), extra: 1 }, request({ pixelPitchMm: 0 }), request({ raster: { pixelWidth: 1.5, pixelHeight: 2 } }),
      request({ viewingDistance: { value: 1, unit: "ft" as "mm" } }), request({ criterion: { kind: "visual-resolution", arcminutes: 10800, minimumVisibleSnr: 1 } }),
      request({ criterion: { kind: "visual-resolution", arcminutes: 1, minimumVisibleSnr: 0 } }), request({ blur: { kind: "components", lensMm: -1 } }),
      request({ blur: { kind: "measured-total", diameterMm: 1, lensMm: 1 } as never }), request({ noise: { kind: "pixel-snr", snrLinear: Number.NaN } }),
      request({ noise: { kind: "shot-and-read-noise", signalElectrons: -1, readNoiseElectrons: 0 } }), request({ noise: { kind: "other" } as never }),
      request({ viewingDistance: { value: 1e306, unit: "m" } })
    ];
    for (const input of bad) {
      expect(() => calculatePrintSizeLimitWithBlurAndNoise(input as PrintSizeLimitWithBlurAndNoiseInput)).toThrow(
        expect.toSatisfy((e: unknown) => e instanceof InvalidConfigurationError || e instanceof InvalidScientificInputError));
    }
  });
});
