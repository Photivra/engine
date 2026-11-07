// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, simulateCapture, simulateDisplayView, simulateIdealReference, type SimulateCaptureOptions } from "../src/index.js";
import {
  applyDiffractionCorrection, applyUnsharpMask, circularPupilDiffractionMtf, defaultDiffractionCorrectionRadiusPixels, designDiffractionCorrectionFilter,
  evaluateDiffractionCorrectionResponse, renderSdrWithUnsharpMask, unsharpMaskKernel
} from "../src/processing/development-detail.js";
import { renderSdrRunInto, type SdrPixelCounts } from "../src/output/native-capture-sdr.js";
import { prepareSdrPixelTone, type SdrRenderingProfile } from "../src/output/sdr-rendering.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/** Deterministic xorshift32 uniform in [0, 1). */
function uniform(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
/** Projection of row-major samples (one channel, stride 3) onto cos/sin at frequency f along x, over columns [x0, x1) of every row. */
function amplitudeAt(samples: Float64Array, width: number, height: number, f: number, x0: number, x1: number, channel = 0): number {
  let c = 0, s = 0, n = 0;
  for (let y = 0; y < height; y++) for (let x = x0; x < x1; x++) {
    const v = samples[(y * width + x) * 3 + channel]!;
    c += v * Math.cos(2 * Math.PI * f * x); s += v * Math.sin(2 * Math.PI * f * x); n++;
  }
  return 2 * Math.hypot(c, s) / n;
}

describe("diffraction correction (#552)", () => {
  // f/16 working, 2 µm pixels, 550 nm: f_c = 2 / (0.55 · 16) = 0.2273 cycles per pixel, well inside Nyquist (0.5).
  const settings = { wavelengthNm: 550, regularization: 0.01, maximumGain: 4, kernelRadiusPixels: defaultDiffractionCorrectionRadiusPixels(16, 550, 2) };
  const filter = designDiffractionCorrectionFilter({ workingFNumber: 16, pixelPitchMicrometers: 2, settings });

  it("uses the circular-pupil OTF and its cut-off", () => {
    expect(circularPupilDiffractionMtf(0)).toBe(1);
    expect(circularPupilDiffractionMtf(1)).toBe(0);
    expect(circularPupilDiffractionMtf(1.5)).toBe(0);
    // (2/π)(acos ½ − ½·√¾) = (2/π)(π/3 − √3/4).
    expect(circularPupilDiffractionMtf(0.5)).toBeCloseTo(2 / Math.PI * (Math.PI / 3 - Math.sqrt(3) / 4), 15);
    expect(filter.cutoffCyclesPerPixel).toBeCloseTo(2 / (0.55 * 16), 14);
    // Third dark ring 3.2383 · 0.55 · 16 / 2 = 14.25 → 15 pixels.
    expect(settings.kernelRadiusPixels).toBe(15);
    expect(filter.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
    expect(evaluateDiffractionCorrectionResponse(filter.weights, 15, 0, 0)).toBeCloseTo(1, 14);
    expect(filter.designPeakGain).toBe(4);
    expect(filter.responsePeakGain).toBeLessThanOrEqual(4.2);
  });

  it("never amplifies frequencies beyond the cut-off, where the design gain is zero", () => {
    expect(filter.responseMaximumBeyondCutoff).not.toBeNull();
    expect(filter.responseMaximumBeyondCutoff!).toBeLessThan(1);
    for (let fx = 0.24; fx <= 0.5; fx += 0.01) for (let fy = 0; fy <= 0.5; fy += 0.05) {
      expect(Math.abs(evaluateDiffractionCorrectionResponse(filter.weights, 15, fx, fy))).toBeLessThan(1);
    }
    // Inside the pass band it restores part of the attenuated contrast, bounded by the gain.
    const at = 0.125, mtf = circularPupilDiffractionMtf(at / filter.cutoffCyclesPerPixel), response = evaluateDiffractionCorrectionResponse(filter.weights, 15, at, 0);
    expect(response).toBeGreaterThan(1);
    expect(mtf * response).toBeLessThan(1);
    // A large-pixel capture whose cut-off is beyond Nyquist has no lost band inside the Nyquist square.
    const coarse = designDiffractionCorrectionFilter({ workingFNumber: 4, pixelPitchMicrometers: 6, settings: { ...settings, kernelRadiusPixels: 2 } });
    expect(coarse.responseMaximumBeyondCutoff).toBeNull();
    expect(coarse.nyquistAreaBeyondCutoffFraction).toBe(0);
    expect(filter.nyquistAreaBeyondCutoffFraction).toBeGreaterThan(0.5);
  });

  it("does not recover detail beyond the diffraction cut-off (trade-off)", () => {
    // Scene: two vertical gratings, one below the cut-off (0.125 = 0.55 f_c) and one above it (0.3125 = 1.375 f_c), amplitude 0.2 each.
    const width = 128, height = 4, a = 0.2, f1 = 16 / 128, f2 = 40 / 128;
    const original = new Float64Array(width * height * 3), blurred = new Float64Array(width * height * 3);
    const h1 = circularPupilDiffractionMtf(f1 / filter.cutoffCyclesPerPixel), h2 = circularPupilDiffractionMtf(f2 / filter.cutoffCyclesPerPixel);
    expect(h2).toBe(0);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
      original[(y * width + x) * 3 + c] = 0.5 + a * Math.cos(2 * Math.PI * f1 * x) + a * Math.cos(2 * Math.PI * f2 * x);
      // The exact diffraction image: each grating multiplied by the OTF at its frequency.
      blurred[(y * width + x) * 3 + c] = 0.5 + a * h1 * Math.cos(2 * Math.PI * f1 * x) + a * h2 * Math.cos(2 * Math.PI * f2 * x);
    }
    const corrected = applyDiffractionCorrection(blurred, width, height, filter).samples;
    // Measured away from the clamped edges, over a whole number of periods of both gratings.
    const m = (img: Float64Array, f: number): number => amplitudeAt(img, width, height, f, 32, 96);
    expect(m(original, f2)).toBeCloseTo(a, 12);
    expect(m(blurred, f2)).toBeLessThan(1e-12);
    expect(m(corrected, f2)).toBeLessThan(1e-12);
    const restored = m(corrected, f1) / a;
    expect(m(blurred, f1) / a).toBeCloseTo(h1, 10);
    expect(restored).toBeCloseTo(h1 * evaluateDiffractionCorrectionResponse(filter.weights, 15, f1, 0), 6);
    expect(restored).toBeGreaterThan(h1);
    expect(restored).toBeLessThan(1);
  });

  it("passes beyond-cut-off noise at a gain below one and amplifies in-band noise by at most the measured peak gain", () => {
    const width = 128, height = 128, random = uniform(552), noise = new Float64Array(width * height * 3);
    // Zero-mean noise (the filter is linear), so no DC leaks into the single-frequency projections.
    for (let i = 0; i < noise.length; i++) noise[i] = 0.01 * (random() - 0.5);
    const corrected = applyDiffractionCorrection(noise, width, height, filter).samples;
    const variance = (img: Float64Array): number => {
      let s = 0, s2 = 0, n = 0;
      for (let y = 20; y < height - 20; y++) for (let x = 20; x < width - 20; x++) { const v = img[(y * width + x) * 3]!; s += v; s2 += v * v; n++; }
      return s2 / n - (s / n) ** 2;
    };
    // Overall white-noise gain: below the peak, and below one here because most of the Nyquist square lies beyond the cut-off.
    const gain = Math.sqrt(variance(corrected) / variance(noise));
    expect(gain).toBeLessThan(filter.responsePeakGain);
    // In band, the noise at a frequency is amplified by the response there (row averages isolate fy = 0).
    const inBand = 0.15, ratio = amplitudeAt(corrected, width, height, inBand, 20, 108) / amplitudeAt(noise, width, height, inBand, 20, 108);
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeCloseTo(evaluateDiffractionCorrectionResponse(filter.weights, 15, inBand, 0), 0);
    for (const f of [0.3, 0.4, 0.5]) expect(amplitudeAt(corrected, width, height, f, 20, 108)).toBeLessThan(amplitudeAt(noise, width, height, f, 20, 108) * 1.05 + 1e-4);
  });

  it("rejects out-of-range settings", () => {
    for (const bad of [{ regularization: 0 }, { regularization: 2 }, { maximumGain: 0.5 }, { maximumGain: 11 }, { wavelengthNm: 300 }, { kernelRadiusPixels: 0 },
      { kernelRadiusPixels: 1.5 }, { kernelRadiusPixels: 17 }]) {
      expect(() => designDiffractionCorrectionFilter({ workingFNumber: 8, pixelPitchMicrometers: 4, settings: { ...settings, ...bad } })).toThrow(InvalidConfigurationError);
    }
    expect(() => applyDiffractionCorrection(new Float64Array(5), 1, 1, filter)).toThrow(InvalidConfigurationError);
  });
});

describe("unsharp mask (#552)", () => {
  /** A vertical step from `dark` to `light` between columns 15 and 16, in encoded units. */
  function step(dark: number, light: number, width = 32, height = 4): Float64Array {
    const out = new Float64Array(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.fill(x < width / 2 ? dark : light, (y * width + x) * 3, (y * width + x) * 3 + 3);
    return out;
  }

  it("creates halo overshoot and undershoot at an edge (trade-off), as predicted from the Gaussian", () => {
    const sigma = 1.5, amount = 1, dark = 0.3, light = 0.7, h = light - dark;
    const r = applyUnsharpMask(step(dark, light), 32, 4, { radiusPixels: sigma, amount, threshold: 0 });
    // Independent prediction at the first bright pixel: blur = dark·Σ(weights reaching the dark side) + light·(rest).
    const k = unsharpMaskKernel(sigma), half = (k.length - 1) / 2;
    let darkWeight = 0;
    for (let i = -half; i <= half; i++) if (16 + i < 16) darkWeight += k[i + half]!;
    const predictedOvershoot = amount * h * darkWeight;
    const row = Array.from({ length: 32 }, (_, x) => r.samples[(32 + x) * 3]!);
    expect(Math.max(...row) - light).toBeCloseTo(predictedOvershoot, 14);
    expect(dark - Math.min(...row)).toBeCloseTo(predictedOvershoot, 14);
    // Continuous approximation: Σ over the dark side ≈ 1 − Φ(0.5/σ) = 0.3694 for σ = 1.5.
    expect(predictedOvershoot / h).toBeCloseTo(0.3694, 2);
    expect(Math.max(...row)).toBeCloseTo(row[16]!, 15);
    // The halo spreads over the kernel reach and nowhere else.
    expect(row[16 + half + 1]).toBeCloseTo(light, 15);
    expect(row[15 - half - 1]).toBeCloseTo(dark, 15);
    expect(r.diagnostics.maximumIncrease).toBeCloseTo(predictedOvershoot, 14);
    expect(r.diagnostics.kernelRadiusPixels).toBe(5);
    expect(r.diagnostics.clippedHighSampleCount).toBe(0);
    // Overshoot that does not fit in the code range is clipped and counted.
    const clipped = applyUnsharpMask(step(0.3, 0.95), 32, 4, { radiusPixels: sigma, amount: 2, threshold: 0 });
    expect(clipped.diagnostics.clippedHighSampleCount).toBeGreaterThan(0);
    expect(Math.max(...clipped.samples)).toBe(1);
  });

  it("leaves detail below the threshold unchanged and adds nothing to flat areas", () => {
    const flat = new Float64Array(16 * 4 * 3).fill(0.4);
    for (const v of applyUnsharpMask(flat, 16, 4, { radiusPixels: 2, amount: 3, threshold: 0 }).samples) expect(v).toBeCloseTo(0.4, 14);
    const edge = step(0.4, 0.5);
    const held = applyUnsharpMask(edge, 32, 4, { radiusPixels: 1, amount: 1, threshold: 0.06 });
    expect(held.samples).toEqual(edge);
    expect(held.diagnostics.sharpenedSampleCount).toBe(0);
    expect(held.diagnostics.thresholdHeldSampleCount).toBeGreaterThan(0);
    expect(() => applyUnsharpMask(edge, 32, 4, { radiusPixels: 0, amount: 1, threshold: 0 })).toThrow(InvalidConfigurationError);
    expect(() => applyUnsharpMask(edge, 32, 4, { radiusPixels: 1, amount: 6, threshold: 0 })).toThrow(InvalidConfigurationError);
    expect(() => applyUnsharpMask(edge, 32, 4, { radiusPixels: 1, amount: 1, threshold: -0.1 })).toThrow(InvalidConfigurationError);
  });

  it("renders exactly the SDR kernel's codes when nothing is sharpened", () => {
    const profile: SdrRenderingProfile = { schemaVersion: "0.1.0", profileId: "t", profileVersion: "1", renderingExposureEv: 0.5, toneCurve: "positive-reinhard-per-channel",
      gamutHandling: "clip-components", outputDynamicRange: "sdr", transferFunction: "srgb", bitDepth: 8, rounding: "nearest-ties-up", dither: "none" };
    const width = 16, height = 8, random = uniform(7), rgb = new Float64Array(width * height * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = random() * 1.4 - 0.1;
    for (const bitDepth of [8, 16] as const) {
      const p = { ...profile, bitDepth }, expected = bitDepth === 8 ? new Uint8Array(rgb.length) : new Uint16Array(rgb.length);
      const counts: SdrPixelCounts = { negative: 0, above: 0, changed: 0, low: 0, high: 0, outOfGamut: false };
      renderSdrRunInto(rgb, 0, width * height, p, prepareSdrPixelTone(p), 2 ** p.renderingExposureEv, 2 ** bitDepth - 1, expected, 0, new Float64Array(3), counts);
      const r = renderSdrWithUnsharpMask(rgb, width, height, p, { radiusPixels: 1, amount: 1, threshold: 1 });
      expect(Array.from(r.codes)).toEqual(Array.from(expected));
      expect(r.counts).toEqual({ negative: counts.negative, above: counts.above, changed: counts.changed, low: counts.low, high: counts.high });
      expect(r.sharpening.sharpenedSampleCount).toBe(0);
    }
  });
});

describe("simulateCapture output.diffractionCorrection and output.sharpening (#552)", () => {
  const scene = { preset: "slanted-edge", angleDegrees: 0 } as const;
  const base: SimulateCaptureOptions = { scene, output: { width: 24, height: 8 } };
  const edgeRow = (samples: ArrayLike<number>, width: number, y: number): number[] => Array.from({ length: width }, (_, x) => samples[(y * width + x) * 3 + 1]!);

  it("is off by default: no detail stage, assumption, diagnostic or option", async () => {
    const r = await simulateCapture(base);
    expect(r.diagnostics.detail).toBeUndefined();
    expect(r.assumptions.some((a) => a.id.startsWith("output.sharpening") || a.id.startsWith("output.diffractionCorrection") || a.id === "output.developmentOrder")).toBe(false);
    expect(r.diagnostics.options).not.toContain("output.sharpening");
    expect(r.provenance.composedContracts).toContain("createNativeRawDevelopmentTask");
  }, scaledTimeout(60_000));

  it("develops byte-identically to the default when the unsharp mask changes nothing", async () => {
    const off = await simulateCapture(base);
    const held = await simulateCapture({ ...base, output: { ...base.output, sharpening: { threshold: 1 } } });
    expect(Array.from(held.image.samples)).toEqual(Array.from(off.image.samples));
    expect(held.diagnostics.rendering).toEqual(off.diagnostics.rendering);
    expect(held.diagnostics.detail!.sharpening!.sharpenedSampleCount).toBe(0);
    expect(held.provenance.composedContracts).toContain("renderSdrWithUnsharpMask");
  }, scaledTimeout(60_000));

  it("sharpens with halos and reports what ran", async () => {
    const off = await simulateCapture(base);
    const on = await simulateCapture({ ...base, output: { ...base.output, sharpening: { radiusPixels: 1, amount: 1 } } });
    const before = edgeRow(off.image.samples, 24, 4), after = edgeRow(on.image.samples, 24, 4);
    expect(Math.max(...after)).toBeGreaterThan(Math.max(...before));
    expect(Math.min(...after)).toBeLessThan(Math.min(...before));
    const record = on.assumptions.find((a) => a.id === "output.sharpening")!;
    expect(record.value).toMatchObject({ method: "unsharp-mask", radiusPixels: 1, amount: 1, threshold: 0, domain: "srgb-encoded", kernelRadiusPixels: 3 });
    expect(on.assumptions.find((a) => a.id === "output.sharpening.threshold")!.kind).toBe("default");
    expect(on.assumptions.find((a) => a.id === "output.developmentOrder")!.value).toEqual(["demosaic", "colour and white balance", "rendering exposure and tone curve",
      "gamut handling", "transfer function", "unsharp mask", "quantization"]);
    expect(on.diagnostics.detail!.sharpening!.maximumIncrease).toBeGreaterThan(0);
    expect(on.diagnostics.options).toContain("output.sharpening");
  }, scaledTimeout(60_000));

  it("corrects diffraction blur up to the cut-off and states the cut-off it cannot pass", async () => {
    const lens = { fNumber: 16, diffraction: "circular-aperture" as const };
    const blurred = await simulateCapture({ ...base, lens, sensor: { pixelPitchMicrometers: 2 } });
    const corrected = await simulateCapture({ ...base, lens, sensor: { pixelPitchMicrometers: 2 }, output: { ...base.output, diffractionCorrection: {} } });
    const record = corrected.assumptions.find((a) => a.id === "output.diffractionCorrection")!;
    const value = record.value as { workingFNumber: number; cutoffCyclesPerPixel: number; recoversBeyondCutoff: boolean; kernelRadiusPixels: number; responseMaximumBeyondCutoff: number };
    expect(value.workingFNumber).toBeCloseTo(16 * 5000 / 4950, 12);
    expect(value.cutoffCyclesPerPixel).toBeCloseTo(2 / (0.55 * value.workingFNumber), 12);
    expect(value.recoversBeyondCutoff).toBe(false);
    expect(value.responseMaximumBeyondCutoff).toBeLessThan(1);
    expect(record.explanation).toContain("no correction restores it");
    // Steeper edge: the 10–90 % rise of the green row spans fewer pixels.
    const rise = (row: number[]): number => {
      const lo = Math.min(...row), hi = Math.max(...row.slice(0, 20));
      const at = (level: number): number => { for (let x = 1; x < row.length; x++) if (row[x]! >= level) return x - 1 + (level - row[x - 1]!) / (row[x]! - row[x - 1]!); return NaN; };
      return at(lo + 0.9 * (hi - lo)) - at(lo + 0.1 * (hi - lo));
    };
    expect(rise(edgeRow(corrected.image.samples, 24, 4))).toBeLessThan(rise(edgeRow(blurred.image.samples, 24, 4)));
    expect(corrected.diagnostics.detail!.diffractionCorrection!.cutoffCyclesPerPixel).toBe(value.cutoffCyclesPerPixel);
    expect(corrected.diagnostics.options).toContain("output.diffractionCorrection");
  }, scaledTimeout(120_000));

  it("leaves the DNG's RAW codes unmodified", async () => {
    const lens = { fNumber: 11, diffraction: "circular-aperture" as const }, output = { ...base.output, format: "dng" as const };
    const plain = await simulateCapture({ ...base, lens, output });
    const detailed = await simulateCapture({ ...base, lens, output: { ...output, sharpening: { amount: 2 }, diffractionCorrection: { maximumGain: 3 } } });
    expect(Buffer.from(detailed.image.dng!).equals(Buffer.from(plain.image.dng!))).toBe(true);
    expect(Array.from(detailed.raw.codes)).toEqual(Array.from(plain.raw.codes));
    expect(Array.from(detailed.image.samples)).not.toEqual(Array.from(plain.image.samples));
  }, scaledTimeout(120_000));

  it("rejects unsupported combinations and values", async () => {
    const reject = (options: SimulateCaptureOptions): Promise<void> => expect(simulateCapture(options)).rejects.toThrow(InvalidConfigurationError);
    await reject({ ...base, output: { ...base.output, diffractionCorrection: {} } });
    await reject({ ...base, lens: { diffraction: "circular-aperture" }, output: { ...base.output, diffractionCorrection: {}, region: { x: 0, y: 0, width: 4, height: 4 } } });
    await reject({ ...base, output: { ...base.output, sharpening: {}, format: "png", colorEncoding: "display-p3" } });
    await reject({ ...base, output: { ...base.output, sharpening: { amount: 0 } } });
    await reject({ ...base, output: { ...base.output, sharpening: { radius: 1 } as never } });
    await reject({ ...base, lens: { diffraction: "circular-aperture" }, output: { ...base.output, diffractionCorrection: { kernelRadiusPixels: 40 } } });
    await expect(simulateIdealReference({ ...base, output: { ...base.output, sharpening: {} } })).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateDisplayView({ ...base, output: { ...base.output, sharpening: {} } }, { width: 12, height: 4 } as never)).rejects.toThrow(InvalidConfigurationError);
  }, scaledTimeout(60_000));
});
