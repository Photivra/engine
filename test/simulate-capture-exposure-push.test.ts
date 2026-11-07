// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createNativeRawDevelopmentTask, NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS, resolveGenericEquipmentTierCatalog,
  simulateCapture, simulateDisplayView, simulateIdealReference, type GenericEquipmentTierPreset, type NativeRawOutput, type SimulateCaptureOptions,
  type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #556: the development exposure push, output.exposureCompensationStops. A gain 2^stops on the black-subtracted,
 * white-normalized RAW before demosaic and white balance; the RAW and the DNG are not changed.
 */

/** sRGB EOTF (W3C CSS Color 4) of a 16-bit or 8-bit code. */
const linear = (code: number, maximum: number): number => {
  const v = code / maximum;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
/** Per-channel mean and standard deviation of the linear-light samples. */
function stats(samples: ArrayLike<number>, maximum: number): { mean: number[]; std: number[]; n: number } {
  const n = samples.length / 3, sum = [0, 0, 0], squares = [0, 0, 0];
  for (let i = 0; i < samples.length; i++) { const v = linear(samples[i]!, maximum); sum[i % 3]! += v; squares[i % 3]! += v * v; }
  const mean = sum.map((s) => s / n);
  return { mean, std: squares.map((s, c) => Math.sqrt(Math.max(0, s / n - mean[c]! ** 2))), n };
}
const base = (output: SimulateCaptureOptions["output"] = {}, exposure: SimulateCaptureOptions["exposure"] = {}): SimulateCaptureOptions =>
  ({ scene: { preset: "uniform" }, sensor: { spectralStepNanometers: 20 }, exposure, output: { width: 48, height: 48, format: "srgb-16", ...output } });

/** A copy of a tier preset with every readout regime's read noise and ADC bit depth replaced (black level and gain scaled with the depth). */
function sensorVariant(tier: "consumer" | "professional", readNoiseElectrons: number): GenericEquipmentTierPreset {
  const preset = structuredClone(resolveGenericEquipmentTierCatalog({ presetVersion: "2.1.0" }).find((p) => p.tier === tier)!) as GenericEquipmentTierPreset;
  for (const asset of preset.body.readout) {
    const profile = asset.profile as unknown as { regimes: { readNoiseComponents: { rmsElectrons: { value: number } }[] }[] };
    for (const regime of profile.regimes) regime.readNoiseComponents.forEach((component, k) => { component.rmsElectrons.value = k === 0 ? readNoiseElectrons : 0; });
  }
  return { ...preset, presetId: preset.presetId + "-read-noise-" + readNoiseElectrons };
}

describe("development exposure push (#556)", { timeout: scaledTimeout(120_000) }, () => {
  it("is off by default: 0 is byte-identical to omitting it, and only a given push is reported", async () => {
    const omitted = await simulateCapture(base()), zero = await simulateCapture(base({ exposureCompensationStops: 0 }));
    expect(Array.from(zero.image.samples)).toEqual(Array.from(omitted.image.samples));
    expect(zero.request.development).toEqual(omitted.request.development);
    expect("exposureCompensationStops" in omitted.request.development).toBe(false);
    expect(omitted.assumptions.some((a) => a.id === "output.exposureCompensationStops")).toBe(false);
    expect(zero.assumptions.find((a) => a.id === "output.exposureCompensationStops")?.value).toMatchObject({ stops: 0, gain: 1 });
    expect(NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS).toEqual({ minimum: -2, maximum: 5 });
  });

  it("rejects values outside −2 to +5 and non-numbers", async () => {
    for (const stops of [-2.01, 5.01, Number.NaN, Infinity, "1"]) {
      await expect(simulateCapture(base({ exposureCompensationStops: stops as number }))).rejects.toThrow(/exposureCompensationStops/);
    }
    for (const stops of [-2, 5, 1 / 3]) await expect(simulateCapture(base({ width: 8, height: 8, exposureCompensationStops: stops }))).resolves.toBeDefined();
  });

  it("a +3-stop push of a 3-stop underexposure matches the normal exposure's mean within noise", async () => {
    const normal = await simulateCapture(base({}, { shutterSeconds: 1 / 125 }));
    const pushed = await simulateCapture(base({ exposureCompensationStops: 3 }, { shutterSeconds: 1 / 1000 }));
    const under = await simulateCapture(base({}, { shutterSeconds: 1 / 1000 }));
    const a = stats(normal.image.samples, 65535), b = stats(pushed.image.samples, 65535), u = stats(under.image.samples, 65535);
    for (let c = 0; c < 3; c++) {
      // The demosaic correlates neighbouring pixels, so the effective sample count is taken as a quarter of the pixels.
      const standardError = Math.sqrt((a.std[c]! ** 2 + b.std[c]! ** 2) / (a.n / 4));
      expect(Math.abs(b.mean[c]! - a.mean[c]!)).toBeLessThan(4 * standardError);
      expect(Math.abs(b.mean[c]! / a.mean[c]! - 1)).toBeLessThan(0.02);
      // The unpushed underexposure is 8× darker, and the push keeps its noise: the pushed image is noisier than the normal one.
      expect(u.mean[c]! * 8 / a.mean[c]!).toBeCloseTo(1, 1);
      expect(b.std[c]!).toBeGreaterThan(1.5 * a.std[c]!);
    }
    const reported = pushed.assumptions.find((x) => x.id === "output.exposureCompensationStops")!;
    expect(reported.value).toMatchObject({ stops: 3, gain: 8, dng: null });
    // The RAW itself is the underexposed RAW.
    expect(Array.from(pushed.raw.codes)).toEqual(Array.from(under.raw.codes));
  });

  it("raised shadows are noisier on a sensor with more read noise", async () => {
    const shadow = async (readNoise: number): Promise<{ mean: number[]; std: number[] }> => stats((await simulateCapture({
      ...base({ exposureCompensationStops: 5 }, { shutterSeconds: 1 / 4000 }), camera: sensorVariant("consumer", readNoise) })).image.samples, 65535);
    const quiet = await shadow(1), noisy = await shadow(20);
    for (let c = 0; c < 3; c++) {
      expect(noisy.mean[c]! / quiet.mean[c]!).toBeCloseTo(1, 1);
      expect(noisy.std[c]!).toBeGreaterThan(1.3 * quiet.std[c]!);
    }
  });

  it("shows the ADC quantization steps of a 12-bit RAW in a pushed gradient, not those of a 14- or 16-bit RAW", async () => {
    const template = await simulateCapture(base({ width: 64, height: 8 }));
    const plan = template.raw.plan, width = plan.exposure.geometry.nativeRaster.pixelWidth, count = template.raw.codes.length;
    // A noise-free horizontal ramp of 1/19 000 of the white-minus-black span per column, quantized by an ideal ADC of each depth:
    // a code every five columns at 12 bits (span 3839), 0.8 codes per column at 14 bits (15 359) and 3.2 at 16 bits (61 439).
    // The bilinear demosaic reads the neighbouring columns, so a developed colour repeats only where four columns share a code.
    const developRamp = async (bits: 12 | 14 | 16): Promise<number[]> => {
      const black = 256 * 2 ** (bits - 12), white = 2 ** bits - 1;
      const codes = new Uint16Array(count);
      for (let i = 0; i < count; i++) codes[i] = Math.round(black + (0.001 + (i % width) / 19000) * (white - black));
      const raw: NativeRawOutput = { plan, codes, blackLevels: new Uint16Array(count).fill(black), digitalSaturationCodes: new Uint16Array(count).fill(white),
        saturationFlags: new Uint8Array(count), effectiveSaturationCodes: new Uint16Array(template.raw.effectiveSaturationCodes.length).fill(white) };
      const task = createNativeRawDevelopmentTask({ ...template.request.development, raw, exposureCompensationStops: 5 }, { yieldControl: async () => {} });
      await task.run();
      const out = task.takeOutput(), row = 4 * out.width * 3;
      return Array.from(out.integerSamples.subarray(row, row + out.width * 3));
    };
    // Adjacent pixels with the same developed colour: a plateau of a quantization step.
    const plateaus = (row: number[]): number => {
      let equal = 0;
      for (let x = 1; x < row.length / 3; x++) if (row[3 * x] === row[3 * x - 3] && row[3 * x + 1] === row[3 * x - 2] && row[3 * x + 2] === row[3 * x - 1]) equal++;
      return equal;
    };
    const twelve = plateaus(await developRamp(12)), fourteen = plateaus(await developRamp(14)), sixteen = plateaus(await developRamp(16));
    expect(twelve).toBeGreaterThan(10);
    expect(fourteen).toBe(0);
    expect(sixteen).toBe(0);
  });

  it("clips pushed highlights at white, and highlightMode reconstruct rolls them off", async () => {
    const bright = { scene: { preset: "uniform" as const, reflectance: 0.9 }, output: { width: 16, height: 16, format: "srgb-16" as const, exposureCompensationStops: 3 } };
    const clipped = await simulateCapture(bright);
    expect(clipped.diagnostics.highlight.saturatedPixelCount).toBe(16 * 16);
    expect(Math.min(...clipped.image.samples)).toBe(65535);
    const reconstructed = await simulateCapture({ ...bright, output: { ...bright.output, highlightMode: "reconstruct" } });
    expect(reconstructed.diagnostics.highlight.reconstructedPixelCount).toBe(16 * 16);
    const unpushed = await simulateCapture({ ...bright, output: { ...bright.output, exposureCompensationStops: 0 } });
    expect(unpushed.diagnostics.highlight.saturatedPixelCount).toBe(0);
  });

  it("JPEG, PNG, the developed samples, the ideal reference and the display view honour it; the DNG does not", async () => {
    const brighter = (pushed: { mean: number[] }, plain: { mean: number[] }, gain: number): void => {
      for (let c = 0; c < 3; c++) expect(pushed.mean[c]! / plain.mean[c]!).toBeCloseTo(gain, 0);
    };
    const run = (stops: number, output: SimulateCaptureOptions["output"]): Promise<SimulateCaptureResult> => simulateCapture(base({ width: 24, height: 16, ...output, exposureCompensationStops: stops }, { shutterSeconds: 1 / 1000 }));

    const jpeg0 = await run(0, { format: "jpeg" }), jpeg2 = await run(2, { format: "jpeg" });
    expect(jpeg2.image.jpeg).not.toEqual(jpeg0.image.jpeg);
    brighter(stats(jpeg2.image.samples, 255), stats(jpeg0.image.samples, 255), 4);

    const png0 = await run(0, { format: "png", bitDepth: 16 }), png2 = await run(2, { format: "png", bitDepth: 16 });
    expect(png2.image.png).not.toEqual(png0.image.png);
    brighter(stats(png2.image.samples, 65535), stats(png0.image.samples, 65535), 4);
    const wide0 = await run(0, { format: "png", bitDepth: 16, colorEncoding: "display-p3" }), wide2 = await run(2, { format: "png", bitDepth: 16, colorEncoding: "display-p3" });
    brighter(stats(wide2.image.samples, 65535), stats(wide0.image.samples, 65535), 4);
    const ahd0 = await run(0, { demosaic: "ahd" }), ahd2 = await run(2, { demosaic: "ahd" });
    brighter(stats(ahd2.image.samples, 65535), stats(ahd0.image.samples, 65535), 4);

    const dng0 = await run(0, { format: "dng" }), dng2 = await run(2, { format: "dng" });
    expect(Array.from(dng2.image.dng!)).toEqual(Array.from(dng0.image.dng!));
    brighter(stats(dng2.image.samples, 255), stats(dng0.image.samples, 255), 4);
    expect(dng2.assumptions.find((a) => a.id === "output.exposureCompensationStops")!.value).toMatchObject({ dng: "unmodified RAW (the push is a development setting)" });

    const reference0 = await simulateIdealReference(base({ width: 24, height: 16, exposureCompensationStops: 0 }, { shutterSeconds: 1 / 1000 }));
    const reference2 = await simulateIdealReference(base({ width: 24, height: 16, exposureCompensationStops: 2 }, { shutterSeconds: 1 / 1000 }));
    brighter(stats(reference2.image.samples, 65535), stats(reference0.image.samples, 65535), 4);

    const view = async (stops: number): Promise<{ mean: number[]; std: number[] }> =>
      stats((await simulateDisplayView(base({ width: 48, height: 32, exposureCompensationStops: stops }, { shutterSeconds: 1 / 1000 }), { width: 12, height: 8, format: "srgb-16" })).image.samples, 65535);
    const view0 = await view(0), view2 = await view(2);
    brighter(view2, view0, 4);
    const capture2 = stats((await run(2, { width: 48, height: 32 })).image.samples, 65535);
    for (let c = 0; c < 3; c++) expect(view2.mean[c]! / capture2.mean[c]!).toBeCloseTo(1, 1);
  });

  it("the RAW development task validates the push", async () => {
    const template = await simulateCapture(base({ width: 8, height: 8 }));
    for (const stops of [6, -3, Number.NaN, "1"]) {
      expect(() => createNativeRawDevelopmentTask({ ...template.request.development, raw: template.raw, exposureCompensationStops: stops as number },
        { yieldControl: async () => {} })).toThrow(/exposureCompensationStops/);
    }
    // A refused input leaves the RAW with the caller: ownership passes only after every check.
    expect(template.raw.codes.length).toBeGreaterThan(0);
  });
});
