// SPDX-License-Identifier: Apache-2.0

/**
 * #552: the honest costs of the post-capture lens corrections, measured. Distortion correction lowers corner resolution,
 * vignetting correction raises corner noise, and lateral CA correction cannot remove longitudinal CA. (The sharpening halo
 * and the diffraction cut-off are measured in development-detail.test.ts.)
 */
import { describe, expect, it } from "vitest";
import {
  calculateLensCorrectedCapture, calculateLongitudinalChromaticFocus, calculatePeripheralIlluminationCorrection, parseGenericLensCorrectionProfile,
  resolveLensCorrectionPlan, type GenericLensCorrectionProfile, type GeometricRaster, type IlluminationLensCorrection, type LensCorrectionComponent
} from "../src/index.js";
import { evidence, resampler, state, transform } from "./optics-group-fixtures.js";

const identity = { version: "1", domain: "reconstructed-linear" as const, availability: "toggle" as const, defaultEnabled: true,
  dependencies: [] as string[], requiredByStabilizationModes: [] as string[], residualNote: "Synthetic trade-off test component." };
function correct(raster: GeometricRaster, components: LensCorrectionComponent[], channels: Record<"red" | "green" | "blue", number[]>):
  ReturnType<typeof calculateLensCorrectedCapture>["value"] {
  const s = { ...state, outputWidth: raster.width, outputHeight: raster.height };
  const profile: GenericLensCorrectionProfile = { schemaVersion: "0.1.0", id: "tradeoffs", version: "1", state: s, evidence, components };
  const plan = resolveLensCorrectionPlan({ profile, state: s, selections: {}, outputKind: "processed", selectionKind: "camera-selectable" }).value;
  return calculateLensCorrectedCapture({ plan, capture: { state: s, captureId: "c", noiseRealizationId: "n", timeSeconds: 0, raster, channels },
    destinationRaster: raster, resampler, physicalProjectionDistanceMm: 50, clippingLevel: 1e6 }).value;
}
/** Deterministic xorshift32 uniform in [0, 1). */
function uniform(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

describe("distortion correction lowers corner resolution (#552 trade-off)", () => {
  it("stretches the corners, so a source grating lands at a lower output frequency and lower modulation there", () => {
    const raster: GeometricRaster = { width: 96, height: 64, centerMm: { x: 0, y: 0 }, pitchMm: 0.01 };
    // Barrel correction: each ideal destination point reads the distorted source at a smaller radius.
    const geometry: LensCorrectionComponent = { ...identity, id: "distortion", kind: "geometry", transform: { id: "barrel", version: "1", domain: "reconstructed-linear",
      purpose: "distortion", kind: "radial", profile: { normalizationRadiusMm: Math.hypot(0.48, 0.32), maximumNormalizedRadius: 1.05, coefficients: { k1: -0.15, k2: 0, k3: 0 } } } };
    const fSource = 0.25, grating = Array.from({ length: 96 * 64 }, (_, i) => 0.5 + 0.4 * Math.cos(2 * Math.PI * fSource * (i % 96)));
    const out = correct(raster, [geometry], { red: grating, green: grating, blue: grating });
    expect(out.validSourceMask.every(Boolean)).toBe(true);
    const plan = out.samplingPlans.red!;
    /** Peak frequency and amplitude of row y over columns [x0, x0 + 16), mean removed, by a fine frequency scan. */
    function peak(y: number, x0: number): { f: number; amplitude: number; stretch: number } {
      const row = Array.from({ length: 16 }, (_, k) => out.channels.red[y * 96 + x0 + k]!), mean = row.reduce((a, b) => a + b, 0) / 16;
      let best = { f: 0, amplitude: 0 };
      for (let f = 0.1; f <= 0.35; f += 0.0005) {
        let c = 0, s = 0;
        row.forEach((v, k) => { c += (v - mean) * Math.cos(2 * Math.PI * f * k); s += (v - mean) * Math.sin(2 * Math.PI * f * k); });
        const amplitude = 2 * Math.hypot(c, s) / 16;
        if (amplitude > best.amplitude) best = { f, amplitude };
      }
      let stretch = 0;
      for (let k = 0; k < 16; k++) stretch += plan.points[y * 96 + x0 + k]!.jacobian[0] / 16;
      return { ...best, stretch };
    }
    const center = peak(32, 40), corner = peak(2, 1);
    // d(source x)/d(destination x) is below one at the corner: one output pixel covers less than one source pixel.
    expect(corner.stretch).toBeLessThan(center.stretch);
    expect(corner.stretch).toBeLessThan(0.9);
    // The grating appears at f_source · J cycles per output pixel; the finest corner detail is J · 0.5, below Nyquist.
    expect(corner.f).toBeCloseTo(fSource * corner.stretch, 2);
    expect(center.f).toBeCloseTo(fSource * center.stretch, 2);
    expect(corner.f).toBeLessThan(center.f);
    // Resampling between source pixels also lowers the modulation (bilinear interpolation is a low-pass filter).
    expect(corner.amplitude).toBeLessThan(center.amplitude);
    expect(corner.amplitude / 0.4).toBeLessThan(0.97);
  });
});

describe("vignetting correction raises corner noise (#552 trade-off)", () => {
  it("multiplies the corner noise by the gain and leaves the SNR where the capture put it", () => {
    const raster: GeometricRaster = { width: 64, height: 64, centerMm: { x: 0, y: 0 }, pitchMm: 0.1 };
    const gain: IlluminationLensCorrection = { ...identity, id: "vignetting", kind: "peripheral-illumination",
      profile: { normalizationRadiusMm: 5, maximumNormalizedRadius: 1, coefficients: { r2: -0.5, r4: 0, r6: 0 } }, strength: 1 };
    const random = uniform(552), sigma = 0.01 / Math.sqrt(3);
    // A uniformly darkened field (0.2 everywhere for simplicity) with uniform noise of standard deviation σ = 0.01/√3.
    const noisy = Array.from({ length: 64 * 64 }, () => 0.2 + 0.02 * (random() - 0.5));
    const out = correct(raster, [gain], { red: noisy, green: noisy, blue: noisy });
    // Each pixel's gain, from the correction primitive at the pixel centre (an independent evaluation of the same profile).
    const pixelGain = (i: number): number => calculatePeripheralIlluminationCorrection({ component: gain, imagePointMm: { x: ((i % 64) + 0.5 - 32) * 0.1,
      y: (32 - (Math.floor(i / 64) + 0.5)) * 0.1 }, signal: 1, noiseVariance: 0, clippingLevel: 10 }).value.gain;
    // Signal = gain · 0.2 and noise = sample − signal, so the gain gradient across a patch is not counted as noise.
    const patch = (data: readonly (number | null)[], gained: boolean, x0: number, y0: number): { mean: number; std: number } => {
      const signal: number[] = [], noise: number[] = [];
      for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) {
        const i = y * 64 + x, g = gained ? pixelGain(i) : 1;
        signal.push(0.2 * g); noise.push(data[i]! - 0.2 * g);
      }
      const mean = signal.reduce((a, b) => a + b, 0) / signal.length, noiseMean = noise.reduce((a, b) => a + b, 0) / noise.length;
      return { mean, std: Math.sqrt(noise.reduce((a, b) => a + (b - noiseMean) ** 2, 0) / noise.length) };
    };
    // The outermost ring has no full bilinear support (null), so the corner patch starts one pixel in.
    expect(out.channels.red[0]).toBeNull();
    const before = { center: patch(noisy, false, 24, 24), corner: patch(noisy, false, 1, 1) },
      after = { center: patch(out.channels.red, true, 24, 24), corner: patch(out.channels.red, true, 1, 1) };
    expect(before.corner.std / sigma).toBeCloseTo(1, 1);
    expect(before.center.std / sigma).toBeCloseTo(1, 1);
    // The corner pixel centre (0.8 px in from the edge) has gain 1/(1 − 0.5·r²); the patch averages it over a range of radii.
    const cornerGain = calculatePeripheralIlluminationCorrection({ component: gain, imagePointMm: { x: -3.15, y: 3.15 }, signal: 1, noiseVariance: 1, clippingLevel: 10 }).value;
    expect(cornerGain.gain).toBeGreaterThan(1.5);
    expect(cornerGain.noiseVarianceBeforeClipping).toBeCloseTo(cornerGain.gain ** 2, 12);
    const noiseGain = after.corner.std / before.corner.std, signalGain = after.corner.mean / before.corner.mean;
    expect(noiseGain).toBeGreaterThan(1.2);
    expect(after.center.std / before.center.std).toBeLessThan(1.05);
    expect(after.corner.std / after.center.std).toBeGreaterThan(1.2);
    // Signal and noise rise together: the corner SNR is not improved (the gain adds no photons).
    expect(noiseGain / signalGain).toBeCloseTo(1, 1);
  });
});

describe("lateral CA correction leaves longitudinal CA (#552 trade-off)", () => {
  it("registers the channels but cannot change their different blur", () => {
    // Declared longitudinal focal shifts (synthetic): blue focuses 40 µm long, red 30 µm short of green at 550 nm, f/2 at 3 m.
    const dispersion = { kind: "declared-focal-shift" as const, samples: [{ wavelengthNm: 450, focalLengthShiftMicrometers: 40 },
      { wavelengthNm: 550, focalLengthShiftMicrometers: 0 }, { wavelengthNm: 650, focalLengthShiftMicrometers: -30 }] };
    const pitchMm = 0.005;
    const blurPixels = { red: 650, green: 550, blue: 450 } as const;
    const radius: Record<"red" | "green" | "blue", number> = { red: 0, green: 0, blue: 0 };
    for (const channel of ["red", "green", "blue"] as const) {
      const focus = calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm: blurPixels[channel], apertureFNumber: 2,
        focusDistanceM: 3, dispersion }).value;
      radius[channel] = focus.geometricBlurDiameterMm / 2 / pitchMm;
    }
    expect(radius.green).toBe(0);
    expect(radius.blue).toBeGreaterThan(1.5);
    expect(radius.red).toBeGreaterThan(1);
    // Edge spread of a uniform blur disc of radius ρ (area left of the line x = u), point-sampled at pixel centres.
    const esf = (u: number, rho: number): number => rho === 0 ? (u < 0 ? 0 : u > 0 ? 1 : 0.5) : u <= -rho ? 0 : u >= rho ? 1 :
      (rho * rho * Math.acos(-u / rho) + u * Math.sqrt(rho * rho - u * u)) / (Math.PI * rho * rho);
    const width = 64, height = 4, raster: GeometricRaster = { width, height, centerMm: { x: 0, y: 0 }, pitchMm };
    // Lateral CA shifts the red edge 0.6 px right and the blue edge 0.4 px left of green (edge at x = 32 for green).
    const shift = { red: 0.6, green: 0, blue: -0.4 } as const;
    const image = (channel: "red" | "green" | "blue"): number[] => Array.from({ length: width * height }, (_, i) =>
      0.2 + 0.6 * esf((i % width) + 0.5 - (32 + shift[channel]), radius[channel]));
    const channels = { red: image("red"), green: image("green"), blue: image("blue") };
    const lateral: LensCorrectionComponent = { ...identity, id: "lateral-ca", kind: "lateral-ca", transforms: {
      red: { ...transform, id: "red", purpose: "lateral-ca", offsetMm: { x: shift.red * pitchMm, y: 0 } },
      green: { ...transform, id: "green", purpose: "lateral-ca" },
      blue: { ...transform, id: "blue", purpose: "lateral-ca", offsetMm: { x: shift.blue * pitchMm, y: 0 } } } };
    const out = correct(raster, [lateral], channels);
    /** Edge 50 % position and 10–90 % width of row 1 (pixel-centre coordinates, linear interpolation). */
    function edge(row: readonly (number | null)[]): { position: number; width: number } {
      const values = Array.from({ length: width }, (_, x) => row[width + x]);
      const at = (level: number): number => {
        for (let x = 1; x < width; x++) {
          const a = values[x - 1], b = values[x];
          if (a !== null && a !== undefined && b !== null && b !== undefined && a < level && b >= level) return x - 1 + 0.5 + (level - a) / (b - a);
        }
        return NaN;
      };
      return { position: at(0.5), width: at(0.2 + 0.6 * 0.9) - at(0.2 + 0.6 * 0.1) };
    }
    const before = { red: edge(channels.red), green: edge(channels.green), blue: edge(channels.blue) };
    const after = { red: edge(out.channels.red), green: edge(out.channels.green), blue: edge(out.channels.blue) };
    expect(Math.abs(before.red.position - before.green.position)).toBeGreaterThan(0.5);
    // Lateral CA is removed: the edges are registered.
    expect(Math.abs(after.red.position - after.green.position)).toBeLessThan(0.05);
    expect(Math.abs(after.blue.position - after.green.position)).toBeLessThan(0.05);
    // Longitudinal CA remains: red and blue edges stay wider than green by about as much as before.
    for (const channel of ["red", "blue"] as const) {
      const excessBefore = before[channel].width - before.green.width, excessAfter = after[channel].width - after.green.width;
      expect(excessBefore).toBeGreaterThan(0.8);
      expect(excessAfter).toBeGreaterThan(0.8 * excessBefore);
    }
    // And no correction component for it exists: a longitudinal-CA component is not a supported kind.
    expect(() => parseGenericLensCorrectionProfile({ schemaVersion: "0.1.0", id: "x", version: "1", state, evidence,
      components: [{ ...identity, id: "loca", kind: "longitudinal-ca" }] })).toThrow();
  });
});
