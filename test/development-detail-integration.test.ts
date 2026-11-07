// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.16.0 integration of #548, #552 and #556.
 * - With output.sharpening or output.diffractionCorrection the capture develops through developLinearSrgb instead of
 *   createNativeRawDevelopmentTask. The #556 exposure push must apply on both paths, on the RAW, before the diffraction
 *   correction (so pushed sites clip at white before the deconvolution sees them).
 * - lens.defocus in image space (#548) with each new development option: development never changes the RAW.
 */

/** sRGB EOTF (W3C CSS Color 4) of a 16-bit code. */
const linear = (code: number): number => {
  const v = code / 65535;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
/** Green channel, linear light, per column: mean and standard deviation over the rows. */
function columns(r: SimulateCaptureResult, width: number, height: number): { mean: number[]; std: number[] } {
  const mean: number[] = [], std: number[] = [];
  for (let x = 0; x < width; x++) {
    let s = 0, q = 0;
    for (let y = 0; y < height; y++) { const v = linear(r.image.samples[(y * width + x) * 3 + 1]!); s += v; q += v * v; }
    mean.push(s / height); std.push(Math.sqrt(Math.max(0, q / height - (s / height) ** 2)));
  }
  return { mean, std };
}
const orderOf = (r: SimulateCaptureResult): unknown => r.assumptions.find((a) => a.id === "output.developmentOrder")?.value;

describe("development exposure push with sharpening and diffraction correction (#556 × #552)", { timeout: scaledTimeout(240_000) }, () => {
  const width = 32, height = 24;
  const base = (shutterSeconds: number, output: SimulateCaptureOptions["output"] = {}): SimulateCaptureOptions => ({
    scene: { preset: "slanted-edge", angleDegrees: 0 }, lens: { fNumber: 16, diffraction: "circular-aperture" },
    sensor: { pixelPitchMicrometers: 2, spectralStepNanometers: 20 }, exposure: { mode: "manual", iso: 100, shutterSeconds },
    output: { width, height, format: "srgb-16", ...output } });

  it("applies the same push on both development paths: an unsharp mask that changes nothing is byte-identical to the push alone", async () => {
    const pushed = await simulateCapture(base(1 / 60, { exposureCompensationStops: 2 }));
    const viaLinear = await simulateCapture(base(1 / 60, { exposureCompensationStops: 2, sharpening: { threshold: 1 } }));
    expect(pushed.provenance.composedContracts).toContain("createNativeRawDevelopmentTask");
    expect(viaLinear.provenance.composedContracts).not.toContain("createNativeRawDevelopmentTask");
    expect(viaLinear.provenance.composedContracts).toContain("native RAW development operator (linear, pre-clip)");
    expect(viaLinear.diagnostics.detail!.sharpening!.sharpenedSampleCount).toBe(0);
    expect(Array.from(viaLinear.image.samples)).toEqual(Array.from(pushed.image.samples));
    expect(viaLinear.diagnostics.highlight).toEqual(pushed.diagnostics.highlight);
    expect(viaLinear.assumptions.find((a) => a.id === "output.exposureCompensationStops")!.value).toMatchObject({ stops: 2, gain: 4 });
    // Without the push the same two requests differ by the gain: the push really ran on both.
    const plain = await simulateCapture(base(1 / 60, { sharpening: { threshold: 1 } }));
    expect(Array.from(plain.image.samples)).not.toEqual(Array.from(viaLinear.image.samples));
  });

  it("a 2-stop push of a quarter exposure, sharpened and diffraction-corrected, matches the full exposure: the push clips at white before the correction", async () => {
    const detail = { diffractionCorrection: {}, sharpening: { amount: 0.5 } };
    // 1/8 s puts the edge's bright side over white; 1/32 s (two stops less) does not reach it.
    const full = await simulateCapture(base(1 / 8, detail));
    const pushed = await simulateCapture(base(1 / 32, { ...detail, exposureCompensationStops: 2 }));
    const quarter = await simulateCapture(base(1 / 32, detail));

    // The RAW is the quarter exposure's, unclipped; the push made the clipped highlight, at the RAW, as the full exposure has it.
    expect(Array.from(pushed.raw.codes)).toEqual(Array.from(quarter.raw.codes));
    expect(quarter.diagnostics.highlight.saturatedPixelCount).toBe(0);
    const fullCount = full.diagnostics.highlight.saturatedPixelCount, pushedCount = pushed.diagnostics.highlight.saturatedPixelCount;
    expect(fullCount).toBeGreaterThan(width * height / 4);
    expect(Math.abs(pushedCount - fullCount)).toBeLessThan(0.05 * fullCount);

    // Both stages ran on the pushed image, in the reported order.
    expect(orderOf(pushed)).toEqual(["development exposure push (RAW)", "demosaic", "colour and white balance", "diffraction correction (linear)",
      "rendering exposure and tone curve", "gamut handling", "transfer function", "unsharp mask", "quantization"]);
    expect(orderOf(full)).toEqual((orderOf(pushed) as string[]).slice(1));
    expect(pushed.diagnostics.detail!.diffractionCorrection).toBeDefined();
    expect(pushed.diagnostics.detail!.sharpening!.sharpenedSampleCount).toBeGreaterThan(0);

    // Column profiles (green, linear light) agree within noise, including the corrected and sharpened edge and its ringing.
    // The push keeps the quarter exposure's relative noise (twice the full exposure's); the demosaic correlates neighbours,
    // so the effective sample count is taken as a quarter of the rows. 16-bit quantization adds at most 1e-4.
    const a = columns(full, width, height), b = columns(pushed, width, height);
    for (let x = 0; x < width; x++) {
      const standardError = Math.sqrt((a.std[x]! ** 2 + b.std[x]! ** 2) / (height / 4));
      expect(Math.abs(b.mean[x]! - a.mean[x]!)).toBeLessThan(4 * standardError + 1e-4);
    }
    // The dark side is far from white in both and the push scales it by 4 against the unpushed quarter exposure.
    const q = columns(quarter, width, height);
    expect(b.mean[2]! / q.mean[2]!).toBeGreaterThan(3.6);
    expect(b.mean[2]! / q.mean[2]!).toBeLessThan(4.4);
  });
});

describe("lens.defocus in image space with each new development option (#548 × #552, #556)", { timeout: scaledTimeout(240_000) }, () => {
  // An image-space defocus (#548): vignetting and barrel distortion, with lens.diffraction (needed by output.diffractionCorrection).
  // 1/4000 s keeps the sunlit dead-leaves scene below white, so the push and the filters are not hidden by clipping.
  const vignetting = { normalizationRadiusMm: 0.15, maximumNormalizedRadius: 1, coefficients: { r2: -0.3, r4: 0, r6: 0 } };
  const barrel = { kind: "radial", profile: { normalizationRadiusMm: 0.15, maximumNormalizedRadius: 1, coefficients: { k1: -0.2, k2: 0, k3: 0 } } };
  const width = 16, height = 12;
  const options = (output: SimulateCaptureOptions["output"] = {}): SimulateCaptureOptions => ({ scene: { preset: "dead-leaves" }, subjectDistanceM: 2,
    sensor: { spectralStepNanometers: 80 }, exposure: { mode: "manual", shutterSeconds: 1 / 4000, iso: 100 },
    lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8, defocus: { model: "geometric-disc" }, vignetting, distortion: barrel, diffraction: "circular-aperture" },
    output: { width, height, format: "srgb-16", ...output } } as SimulateCaptureOptions);
  let plainResult: Promise<SimulateCaptureResult> | undefined;
  const plain = (): Promise<SimulateCaptureResult> => (plainResult ??= simulateCapture(options()));
  const expectImageSpaceDefocus = (r: SimulateCaptureResult): void => {
    expect(r.assumptions.find((a) => a.id === "lens.defocus")!.value).toMatchObject({ execution: "image-space-convolution", combinedWithDiffraction: true,
      imageSpaceOptions: ["lens.distortion", "lens.vignetting"] });
    expect(r.request.diffraction!.execution).toBe("image-space-convolution");
  };

  it("output.exposureCompensationStops: the defocused RAW is unchanged and the developed linear light is scaled by the gain", async () => {
    const reference = await plain(), r = await simulateCapture(options({ exposureCompensationStops: 1 }));
    expectImageSpaceDefocus(r);
    expect(Array.from(r.raw.codes)).toEqual(Array.from(reference.raw.codes));
    // Demosaic, white balance and the colour matrix are linear, so below white each linear sample doubles (16-bit quantization aside).
    let compared = 0;
    for (let i = 0; i < r.image.samples.length; i++) {
      const before = linear(reference.image.samples[i]!), after = linear(r.image.samples[i]!);
      if (before < 0.002 || before > 0.45) continue;
      expect(Math.abs(after - 2 * before)).toBeLessThan(2e-3 * before + 1e-4);
      compared++;
    }
    expect(compared).toBeGreaterThan(r.image.samples.length / 2);
  });

  it("output.sharpening: the defocused RAW is unchanged and the unsharp mask adds halos", async () => {
    const reference = await plain(), r = await simulateCapture(options({ sharpening: { radiusPixels: 1, amount: 1 } }));
    expectImageSpaceDefocus(r);
    expect(Array.from(r.raw.codes)).toEqual(Array.from(reference.raw.codes));
    const s = r.diagnostics.detail!.sharpening!;
    expect(s.sharpenedSampleCount).toBeGreaterThan(0);
    expect(s.maximumIncrease).toBeGreaterThan(0);
    expect(r.diagnostics.detail!.diffractionCorrection).toBeUndefined();
    expect(Math.max(...r.image.samples)).toBeGreaterThanOrEqual(Math.max(...reference.image.samples));
    expect(Math.min(...r.image.samples)).toBeLessThanOrEqual(Math.min(...reference.image.samples));
    expect(Array.from(r.image.samples)).not.toEqual(Array.from(reference.image.samples));
  });

  it("output.diffractionCorrection: the defocused RAW is unchanged; only diffraction is inverted, and the disc is not", async () => {
    const reference = await plain(), r = await simulateCapture(options({ diffractionCorrection: {} }));
    expectImageSpaceDefocus(r);
    expect(Array.from(r.raw.codes)).toEqual(Array.from(reference.raw.codes));
    const record = r.assumptions.find((a) => a.id === "output.diffractionCorrection")!;
    expect(record.value).toMatchObject({ recoversBeyondCutoff: false, fNumber: 4 });
    expect(record.explanation).toMatch(/Not inverted: the pixel aperture, optical anti-aliasing filter, demosaic blur, defocus and aberrations/u);
    expect(r.diagnostics.detail!.diffractionCorrection).toBeDefined();
    expect(r.diagnostics.detail!.sharpening).toBeUndefined();
    // The deconvolution raises local contrast: the green channel's spread grows.
    const spread = (x: SimulateCaptureResult): number => {
      const g = Array.from({ length: width * height }, (_, i) => linear(x.image.samples[i * 3 + 1]!)), m = g.reduce((p, v) => p + v, 0) / g.length;
      return Math.sqrt(g.reduce((p, v) => p + (v - m) ** 2, 0) / g.length);
    };
    expect(spread(r)).toBeGreaterThan(spread(reference));
  });

  it("all three together: the RAW is unchanged and the order puts the push first", async () => {
    const reference = await plain();
    const r = await simulateCapture(options({ exposureCompensationStops: 1, diffractionCorrection: {}, sharpening: { amount: 0.5 } }));
    expectImageSpaceDefocus(r);
    expect(Array.from(r.raw.codes)).toEqual(Array.from(reference.raw.codes));
    expect((orderOf(r) as string[])[0]).toBe("development exposure push (RAW)");
    expect(r.diagnostics.detail!.diffractionCorrection).toBeDefined();
    expect(r.diagnostics.detail!.sharpening!.sharpenedSampleCount).toBeGreaterThan(0);
    expect(r.diagnostics.options).toEqual(expect.arrayContaining(["lens.defocus", "output.diffractionCorrection", "output.sharpening"]));
  });
});
