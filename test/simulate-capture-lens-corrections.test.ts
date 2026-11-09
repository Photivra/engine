// SPDX-License-Identifier: Apache-2.0

/**
 * #570: `output.lensCorrections`, the catalogue lens's generic correction profile on the developed JPEG and samples. Each
 * correction switches on alone; regions and parts are byte-identical to the whole frame; the DNG is never corrected; the kernel
 * agrees with `calculateLensCorrectedCapture`; and #552's trade-offs (corner detail, corner noise) are measured through the option.
 */
import { describe, expect, it } from "vitest";
import {
  calculateLensCorrectedCapture, createGenericLensCorrectionProfile, InvalidConfigurationError, resolveGenericLens, resolveLensCorrectionPlan,
  simulateCapture, simulateDisplayView, simulateIdealReference, type GeometricRaster, type SimulateCaptureOptions, type SimulateCaptureResult
} from "../src/index.js";
import { genericLensDispersion } from "../src/equipment/generic-lens-catalogue.js";
import { applyDevelopedLensCorrection, prepareDevelopedLensCorrection } from "../src/output/developed-lens-corrections.js";
import { resampler } from "./optics-group-fixtures.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

type Output = NonNullable<SimulateCaptureOptions["output"]>;
const ALL = { distortion: true, lateralColor: true, vignetting: true };
/** A whole 36 × 24 mm frame W pixels wide through a catalogue lens (fast method), 16-bit samples. */
function frame(lensId: string, fNumber: number, W: number, scene: SimulateCaptureOptions["scene"], output: Partial<Output> = {}, shutterSeconds = 1 / 4000): SimulateCaptureOptions {
  return { scene, subjectDistanceM: 5, fast: true, lens: { catalogue: lensId, fNumber }, exposure: { mode: "manual", shutterSeconds, iso: 100 },
    sensor: { pixelPitchMicrometers: 36000 / W, spectralStepNanometers: 50 }, output: { width: W, height: W * 2 / 3, format: "srgb-16", ...output } };
}
const flat = { preset: "uniform" as const, reflectance: 0.5 };
const checks = { preset: "checkerboard" as const, squaresAcross: 24, darkReflectance: 0.1, lightReflectance: 0.8 };
const lensAssumption = (r: SimulateCaptureResult): Record<string, unknown> | undefined =>
  r.assumptions.find((a) => a.id === "output.lensCorrections")?.value as Record<string, unknown> | undefined;
/** sRGB EOTF (W3C CSS Color 4) of a 16-bit code. */
const linear = (code: number): number => { const v = code / 65535; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** Linear green samples of a W-wide image over a square patch. */
function patch(r: SimulateCaptureResult, x0: number, y0: number, n: number): number[] {
  const out: number[] = [];
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) out.push(linear(r.image.samples[(y * r.image.width + x) * 3 + 1]!));
  return out;
}
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const std = (v: number[]): number => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };

describe("output.lensCorrections (#570)", { timeout: scaledTimeout(60_000) }, () => {
  it("switches each correction on separately; all off (or omitted) leaves the development unchanged", async () => {
    const run = (lensCorrections?: Output["lensCorrections"]): Promise<SimulateCaptureResult> =>
      simulateCapture(frame("pv-16-2.8", 2.8, 48, checks, lensCorrections ? { lensCorrections } : {}));
    const [none, off, distortion, lateralColor, vignetting, all] = await Promise.all([run(), run({ distortion: false, lateralColor: false, vignetting: false }),
      run({ distortion: true }), run({ lateralColor: true }), run({ vignetting: true }), run(ALL)]);
    expect(Array.from(off.image.samples)).toEqual(Array.from(none.image.samples));
    expect(lensAssumption(off)).toBeUndefined();
    expect(off.provenance.composedContracts).toContain("createNativeRawDevelopmentTask");
    expect(off.diagnostics.options).not.toContain("output.lensCorrections");
    const images = [none, distortion, lateralColor, vignetting, all].map((r) => Array.from(r.image.samples).join(","));
    expect(new Set(images).size).toBe(5);
    expect(lensAssumption(distortion)).toMatchObject({ distortion: true, lateralColor: false, vignetting: false, k1: -0.045, channelScales: { red: 1, green: 1, blue: 1 }, cornerStops: null });
    expect(lensAssumption(vignetting)).toMatchObject({ k1: 0, cornerStops: 2.16, magnification: 1 });
    expect(all.diagnostics.options).toContain("output.lensCorrections");
    expect(all.provenance.composedContracts).toContain("createGenericLensCorrectionProfile (developed linear colour)");
    expect(all.assumptions.find((a) => a.id === "output.developmentOrder")!.value).toEqual(["demosaic", "colour and white balance", "lens corrections (linear)",
      "rendering exposure and tone curve", "gamut handling", "transfer function", "quantization"]);
    // Vignetting alone moves no pixel: the frame's centre keeps its value to rounding (gain 1 there), the RAW is the same capture.
    expect(Array.from(vignetting.raw.codes)).toEqual(Array.from(none.raw.codes));
  });

  it("applies the lens's own profile: the same k1, channel scales and vignetting as createGenericLensCorrectionProfile", async () => {
    const W = 48, area = { widthMm: 36, heightMm: 24 }, lens = resolveGenericLens({ lensId: "pv-300-5.6", activeImagingArea: area, fNumber: 5.6 });
    const r = await simulateCapture(frame("pv-300-5.6", 5.6, W, flat, { lensCorrections: ALL }));
    const profile = createGenericLensCorrectionProfile({ lensId: "pv-300-5.6", activeImagingArea: area, state: { bodyId: "b", bodyVersion: "1", lensId: "pv-300-5.6", lensVersion: "1",
      focalLengthMm: lens.focalLengthMm, aperture: 5.6, focusDistanceM: 5, captureMode: "still", outputWidth: W, outputHeight: 32, frameRateHz: 0, stabilizationMode: "off" } });
    const [d, ca, v] = profile.components as [any, any, any]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const a = lensAssumption(r)! as { k1: number; channelScales: Record<string, number>; cornerStops: number; magnification: number };
    expect(a.k1).toBe(d.transform.profile.coefficients.k1);
    for (const c of ["red", "green", "blue"]) expect(a.channelScales[c]).toBe(ca.transforms[c].matrix[0]);
    const b = 1 - 2 ** (-a.cornerStops / 2);
    expect(v.profile.coefficients).toEqual({ r2: -2 * b, r4: b * b, r6: 0 });
    // Pincushion correction reads outside the frame at the corners, so the image is magnified to fill it.
    expect(a.magnification).toBeGreaterThan(1.01);
    expect(a.magnification).toBeLessThan(1.03);
  });

  it("agrees with calculateLensCorrectedCapture where that executor has full support", () => {
    const W = 40, H = 30, pitchMm = 0.9, area = { widthMm: W * pitchMm, heightMm: H * pitchMm };
    const lens = resolveGenericLens({ lensId: "pv-16-2.8", activeImagingArea: area, fNumber: 2.8 });
    const state = { bodyId: "b", bodyVersion: "1", lensId: "pv-16-2.8", lensVersion: "1", focalLengthMm: lens.focalLengthMm, aperture: 2.8, focusDistanceM: 5,
      captureMode: "still" as const, outputWidth: W, outputHeight: H, frameRateHz: 0, stabilizationMode: "off" };
    const profile = createGenericLensCorrectionProfile({ lensId: "pv-16-2.8", activeImagingArea: area, state });
    const raster: GeometricRaster = { width: W, height: H, centerMm: { x: 0, y: 0 }, pitchMm };
    const channels = { red: [] as number[], green: [] as number[], blue: [] as number[] }, rgb = new Float64Array(W * H * 3);
    for (let i = 0; i < W * H; i++) (["red", "green", "blue"] as const).forEach((c, k) => {
      const value = 0.3 + 0.2 * Math.sin(0.7 * (i % W) + k) * Math.cos(0.5 * Math.floor(i / W)); channels[c].push(value); rgb[i * 3 + k] = value;
    });
    const plan = resolveLensCorrectionPlan({ profile, state, selections: { vignetting: "off" }, outputKind: "processed", selectionKind: "camera-selectable" }).value;
    const reference = calculateLensCorrectedCapture({ plan, capture: { state, captureId: "c", noiseRealizationId: "n", timeSeconds: 0, raster, channels },
      destinationRaster: raster, resampler, physicalProjectionDistanceMm: 16, clippingLevel: 10 }).value;
    const c = { ...prepareDevelopedLensCorrection(lens, { distortion: true, lateralColor: true, vignetting: false }, W, H, pitchMm, genericLensDispersion), fill: 1 };
    const frameRect = { x: 0, y: 0, width: W, height: H }, ours = applyDevelopedLensCorrection(c, rgb, frameRect, frameRect, null);
    let compared = 0;
    for (let i = 0; i < W * H; i++) (["red", "green", "blue"] as const).forEach((ch, k) => {
      const expected = reference.channels[ch][i];
      if (expected === null || expected === undefined) return;
      expect(Math.abs(ours[i * 3 + k]! - expected)).toBeLessThan(1e-12);
      compared++;
    });
    expect(compared).toBeGreaterThan(W * H * 3 * 0.8);
  });

  it("keeps regions and parts byte-identical to the whole frame (barrel, pincushion with fill, AHD PNG)", async () => {
    const cases: [string, SimulateCaptureOptions][] = [
      ["PV 16 2.8 (barrel)", frame("pv-16-2.8", 2.8, 48, checks, { lensCorrections: ALL })],
      ["PV 300 5.6 (pincushion, magnified to fill)", frame("pv-300-5.6", 5.6, 48, checks, { lensCorrections: ALL })],
      ["PV 24 1.8, AHD, 16-bit PNG, vignetting and lateral colour", frame("pv-24-1.8", 1.8, 48, checks, { demosaic: "ahd", format: "png", bitDepth: 16,
        lensCorrections: { lateralColor: true, vignetting: true } })]
    ];
    for (const [name, options] of cases) {
      const whole = await simulateCapture(options), W = 48, H = 32, samples = new Array<number>(W * H * 3).fill(-1);
      const tiles = [{ x: 0, y: 0, width: 17, height: 11 }, { x: 17, y: 0, width: 31, height: 11 }, { x: 0, y: 11, width: 25, height: 21 }, { x: 25, y: 11, width: 23, height: 21 }];
      const parts = await Promise.all(tiles.map((region) => simulateCapture({ ...options, output: { ...options.output, region } })));
      parts.forEach((r, k) => {
        const region = tiles[k]!;
        expect(r.region, name).toMatchObject({ ...region, frameWidth: W, frameHeight: H });
        expect([r.image.width, r.image.height], name).toEqual([region.width, region.height]);
        for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width * 3; x++) samples[((region.y + y) * W + region.x) * 3 + x] = r.image.samples[y * region.width * 3 + x]!;
      });
      expect(samples, name).toEqual(Array.from(whole.image.samples));
      // A part develops the frame pixels its corrected pixels read: more than the part itself.
      const developed = lensAssumption(parts[0]!)!.developedRect as { width: number; height: number };
      expect(developed.width * developed.height, name).toBeGreaterThan(17 * 11);
    }
  }, scaledTimeout(120_000));

  it("never corrects the DNG: the same bytes with and without the corrections, while the samples change", async () => {
    const [plain, corrected] = await Promise.all([simulateCapture(frame("pv-16-2.8", 2.8, 48, checks, { format: "dng" })),
      simulateCapture(frame("pv-16-2.8", 2.8, 48, checks, { format: "dng", lensCorrections: ALL }))]);
    expect(Array.from(corrected.image.dng!)).toEqual(Array.from(plain.image.dng!));
    expect(Array.from(corrected.raw.codes)).toEqual(Array.from(plain.raw.codes));
    expect(Array.from(corrected.image.samples)).not.toEqual(Array.from(plain.image.samples));
    expect(lensAssumption(corrected)!.dng).toBe("uncorrected");
  });

  it("refuses requests it cannot honour, by name", async () => {
    const base = frame("pv-50-1.8", 4, 48, flat);
    await expect(simulateCapture({ ...base, lens: { fNumber: 4 }, output: { ...base.output, lensCorrections: ALL } })).rejects.toThrow(/output.lensCorrections needs lens.catalogue/);
    await expect(simulateCapture({ ...base, output: { ...base.output, lensCorrections: { distortion: "yes" as never } } })).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateCapture({ ...base, output: { ...base.output, lensCorrections: { sharpen: true } as never } })).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateIdealReference({ ...base, output: { ...base.output, lensCorrections: ALL } })).rejects.toThrow(/simulateIdealReference does not take output.lensCorrections/);
    await expect(simulateDisplayView({ ...base, output: { ...base.output, lensCorrections: ALL } }, { width: 16, height: 16 })).rejects.toThrow(/does not support output.lensCorrections/);
  });
});

describe("#552's trade-offs through output.lensCorrections (#570)", { timeout: scaledTimeout(60_000) }, () => {
  it("vignetting correction flattens a flat field and raises the corner noise with the signal, leaving the SNR", async () => {
    // Two noise seeds: their difference removes the signal, so std(A − B)/√2 is the noise alone.
    const run = (seed: number, on: boolean): Promise<SimulateCaptureResult> => simulateCapture({ ...frame("pv-16-2.8", 2.8, 96, flat, on ? { lensCorrections: { vignetting: true } } : {}),
      sensor: { pixelPitchMicrometers: 375, spectralStepNanometers: 50, noiseSeed: seed } });
    const [offA, offB, onA, onB] = await Promise.all([run(1, false), run(2, false), run(1, true), run(2, true)]);
    const n = 8, corner = { x: 1, y: 1 }, center = { x: 44, y: 28 };
    const noise = (a: SimulateCaptureResult, b: SimulateCaptureResult, p: { x: number; y: number }): number => {
      const pa = patch(a, p.x, p.y, n), pb = patch(b, p.x, p.y, n);
      return std(pa.map((v, i) => v - pb[i]!)) / Math.SQRT2;
    };
    const signal = (r: SimulateCaptureResult, p: { x: number; y: number }): number => mean(patch(r, p.x, p.y, n));
    // Uncorrected, the corner patch is about 1.3 stops down; corrected, the field is flat.
    // Measured 2026-11-09: corner/centre 0.410 uncorrected and 0.9997 corrected; corner signal gain 2.44, noise gain 2.50; centre noise gain 0.99.
    expect(signal(offA, corner) / signal(offA, center)).toBeLessThan(0.45);
    expect(Math.abs(signal(onA, corner) / signal(onA, center) - 1)).toBeLessThan(0.02);
    const signalGain = signal(onA, corner) / signal(offA, corner), noiseGain = noise(onA, onB, corner) / noise(offA, offB, corner);
    expect(signalGain).toBeGreaterThan(2.2);
    expect(noiseGain).toBeGreaterThan(2.2);
    // The corner noise rises with the signal: the SNR is the uncorrected corner's (the gain adds no photons).
    expect(noiseGain / signalGain).toBeGreaterThan(0.9);
    expect(noiseGain / signalGain).toBeLessThan(1.1);
    expect(noise(onA, onB, center) / noise(offA, offB, center)).toBeLessThan(1.05);
  });

  it("distortion correction stretches the corners and lowers their detail; the centre keeps it", async () => {
    // A fine checkerboard: the mean absolute neighbour difference measures the detail per output pixel.
    const fine = { preset: "checkerboard" as const, squaresAcross: 48, darkReflectance: 0.1, lightReflectance: 0.8 };
    const run = (on: boolean): Promise<SimulateCaptureResult> => simulateCapture(frame("pv-16-2.8", 2.8, 144, fine, on ? { lensCorrections: { distortion: true } } : {}, 1 / 2000));
    const [off, on] = await Promise.all([run(false), run(true)]);
    const detail = (r: SimulateCaptureResult, x0: number, y0: number): number => {
      const n = 16, v = patch(r, x0, y0, n);
      let sum = 0, count = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x + 1 < n; x++) { sum += Math.abs(v[y * n + x + 1]! - v[y * n + x]!); count++; }
      return sum / count;
    };
    const corner = detail(on, 2, 2) / detail(off, 2, 2), center = detail(on, 64, 40) / detail(off, 64, 40);
    // Measured 2026-11-09: corner detail × 0.706, centre × 0.998.
    expect(center).toBeGreaterThan(0.97);
    expect(corner).toBeLessThan(0.9);
  });
});
