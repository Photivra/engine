// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, simulateCapture, simulateExposureBuildUp, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

// #534: fractions of one exposure as one accumulating process.
const T = 1 / 500;
const request = (extra: Partial<SimulateCaptureOptions> = {}, sensor: SimulateCaptureOptions["sensor"] = {}, size = 32): SimulateCaptureOptions => ({
  scene: { preset: "uniform" }, sensor: { spectralStepNanometers: 100, noiseSeed: 11, ...sensor }, output: { width: size, height: size },
  exposure: { mode: "manual", shutterSeconds: T, iso: 800 }, fast: false, ...extra });
/** Black-subtracted codes of the green sites ((x + y) odd) of the native raster. */
function green(r: SimulateCaptureResult): Float64Array {
  const width = Math.round(Math.sqrt(r.raw.codes.length)), out: number[] = [];
  for (let i = 0; i < r.raw.codes.length; i++) if ((i % width + Math.floor(i / width)) % 2 === 1) out.push(r.raw.codes[i]! - r.raw.blackLevels[i]!);
  return Float64Array.from(out);
}
const mean = (v: Float64Array): number => v.reduce((a, b) => a + b, 0) / v.length;
const covariance = (a: Float64Array, b: Float64Array): number => {
  const ma = mean(a), mb = mean(b);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - ma) * (b[i]! - mb);
  return sum / (a.length - 1);
};

describe("simulateExposureBuildUp (#534)", () => {
  it("makes the last fraction byte-identical to the ordinary capture (owner decision)", async () => {
    const stripes = (p: { u: number }): number => (p.u > 0 ? 0.6 : 0.1);
    for (const options of [
      request(),
      // The environment chain's lean path (a caller function scene), fixed-pattern noise, dual gain and auto white balance.
      request({ scene: { kind: "reflectance-function", sceneId: "test:build-up", evaluate: stripes }, output: { width: 24, height: 16, whiteBalance: "auto" } },
        { fixedPatternNoise: true, readNoise: { lowGainElectrons: 5, highGainElectrons: 2, highGainFromIso: 800 } }),
      request({ output: { width: 20, height: 20, format: "srgb-16" }, exposure: { mode: "aperture-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 60 } }, fast: true })
    ]) {
      const ordinary = await simulateCapture(options), build = await simulateExposureBuildUp(options, { fractions: [0.2, 0.4, 0.6, 0.8, 1] });
      const last = build.frames[4]!;
      expect(last.fraction).toBe(1);
      expect(last.elapsedSeconds).toBe(ordinary.exposure.settings.shutterSeconds);
      expect(build.shutterSeconds).toBe(ordinary.exposure.settings.shutterSeconds);
      expect(last.result.image.samples).toEqual(ordinary.image.samples);
      for (const key of ["codes", "blackLevels", "digitalSaturationCodes", "saturationFlags", "effectiveSaturationCodes"] as const) expect(last.result.raw[key]).toEqual(ordinary.raw[key]);
      expect(last.result.assumptions.map((a) => a.id)).toEqual(ordinary.assumptions.map((a) => a.id));
      // The earlier fractions are readouts of their own, with the fraction recorded.
      expect(build.frames[1]!.result.raw.codes).not.toEqual(ordinary.raw.codes);
      expect(build.frames[1]!.result.assumptions.find((a) => a.id === "exposure.buildUp")?.value)
        .toEqual({ fraction: 0.4, fractions: [0.2, 0.4, 0.6, 0.8, 1], elapsedSeconds: 0.4 * build.shutterSeconds, shutterSeconds: build.shutterSeconds });
    }
  }, scaledTimeout(60_000));

  it("gives each fraction the mean and variance of a single exposure of that length", async () => {
    // 66 × 66 native sites: 2,178 green sites. A single capture at f·t with another seed is the reference.
    const options = request({}, {}, 64), build = await simulateExposureBuildUp(options, { fractions: [0.25, 0.5, 1] });
    for (const frame of build.frames) {
      const single = await simulateCapture({ ...options, exposure: { mode: "manual", shutterSeconds: frame.fraction * T, iso: 800 }, sensor: { ...options.sensor, noiseSeed: 99 } });
      const a = green(frame.result), b = green(single), va = covariance(a, a), vb = covariance(b, b);
      expect(mean(b)).toBeGreaterThan(50);
      expect(Math.abs(mean(a) - mean(b)), "fraction " + frame.fraction).toBeLessThan(5 * Math.sqrt((va + vb) / a.length));
      // Sample variances of 2,178 values: relative standard error √(2/n) ≈ 3 %.
      expect(Math.abs(va / vb - 1), "fraction " + frame.fraction).toBeLessThan(0.15);
    }
  }, scaledTimeout(60_000));

  it("accumulates the charge in place: never decreasing, with the increment model's covariance", async () => {
    // Without read noise each code is the clipped count over the conversion gain, rounded: it never decreases from one fraction to
    // the next, and Cov(N(s), N(t)) = Var(N(s)) for s < t (the later count is the earlier one plus an independent increment).
    const options = request({}, { readNoise: { lowGainElectrons: 0, highGainElectrons: 0 }, fixedPatternNoise: true }, 64);
    const build = await simulateExposureBuildUp(options, { fractions: [0.25, 0.5, 1] });
    const [c1, c2, c3] = build.frames.map((f) => green(f.result)) as [Float64Array, Float64Array, Float64Array];
    for (let i = 0; i < c1.length; i++) { expect(c1[i]!).toBeLessThanOrEqual(c2[i]!); expect(c2[i]!).toBeLessThanOrEqual(c3[i]!); }
    // Quantization adds about 1/12 code² to each variance and nothing to the covariance; the fixed pattern adds the same
    // (deterministic) spread to both. So Cov(c1, c2) ≈ Var(c1) and Cov(c1, c3) ≈ Var(c1); Var(c2 − c1) ≈ Var(c2) − Var(c1).
    const v1 = covariance(c1, c1), v2 = covariance(c2, c2);
    expect(v1).toBeGreaterThan(10);
    expect(Math.abs(covariance(c1, c2) / v1 - 1)).toBeLessThan(0.1);
    expect(Math.abs(covariance(c1, c3) / v1 - 1)).toBeLessThan(0.1);
    const increment = c2.map((x, i) => x - c1[i]!);
    expect(Math.abs(covariance(increment, increment) / (v2 - v1) - 1)).toBeLessThan(0.15);
  }, scaledTimeout(60_000));

  it("reads each fraction once, with its own read noise", async () => {
    // A black frame: the codes are read noise (and quantization), independent between readouts, the same spread in each.
    const options = request({ illuminanceLux: 1e-9 }, { readNoise: { lowGainElectrons: 8, highGainElectrons: 8 } }, 64);
    const build = await simulateExposureBuildUp(options, { fractions: [0.5, 1] });
    const [a, b] = build.frames.map((f) => green(f.result)) as [Float64Array, Float64Array];
    const va = covariance(a, a), vb = covariance(b, b);
    expect(va).toBeGreaterThan(1);
    expect(Math.abs(va / vb - 1)).toBeLessThan(0.15);
    expect(Math.abs(covariance(a, b) / Math.sqrt(va * vb))).toBeLessThan(5 / Math.sqrt(a.length));
  }, scaledTimeout(60_000));

  it("clips each fraction's charge at the full well", async () => {
    // At the whole exposure the mean is about three full wells; at a tenth it is about 0.3 of one.
    const probe = await simulateCapture(request());
    const fullWell = Math.round(probe.sensor.midGrey!.signalElectrons / 3);
    const build = await simulateExposureBuildUp(request({}, { fullWell: { electrons: fullWell, link: "none" } }), { fractions: [0.1, 0.5, 1] });
    // The green sites (the mid-gray figure is the green channel's): physical saturation is flag bit 0.
    const width = Math.round(Math.sqrt(probe.raw.codes.length)), sites = probe.raw.codes.length / 2;
    const physical = (r: SimulateCaptureResult): number => r.raw.saturationFlags.reduce((n, f, i) => n + ((i % width + Math.floor(i / width)) % 2 === 1 ? f & 1 : 0), 0);
    expect(physical(build.frames[0]!.result)).toBe(0);
    expect(physical(build.frames[1]!.result)).toBe(sites);
    expect(physical(build.frames[2]!.result)).toBe(sites);
    expect(green(build.frames[1]!.result)).toEqual(green(build.frames[2]!.result));
  }, scaledTimeout(60_000));

  it("reproduces its frames, without a listed whole exposure too, and refuses what it cannot render", async () => {
    const options = request({}, {}, 16);
    const a = await simulateExposureBuildUp(options, { fractions: [0.3, 0.7] }), b = await simulateExposureBuildUp(options, { fractions: [0.3, 0.7] });
    expect(a.frames.map((f) => f.fraction)).toEqual([0.3, 0.7]);
    expect(a.frames[1]!.result.raw.codes).toEqual(b.frames[1]!.result.raw.codes);
    expect(a.frames[0]!.elapsedSeconds).toBeCloseTo(0.3 * T, 15);
    // A later ordinary capture is unchanged (the fraction's stage is gone).
    expect((await simulateCapture(options)).raw.codes).toEqual((await simulateExposureBuildUp(options, { fractions: [1] })).frames[0]!.result.raw.codes);
    // Running alongside an ordinary capture and another build-up changes neither (each fraction's stage has its own realization ID).
    const [together, ordinary, other] = await Promise.all([simulateExposureBuildUp(options, { fractions: [0.3, 0.7] }), simulateCapture(options),
      simulateExposureBuildUp(options, { fractions: [0.5, 1] })]);
    expect(together.frames[0]!.result.raw.codes).toEqual(a.frames[0]!.result.raw.codes);
    expect(ordinary.raw.codes).toEqual(other.frames[1]!.result.raw.codes);
    for (const [fractions, message] of [[[], "fractions takes 1 to 64"], [[0.5, 0.5], "increase strictly"], [[0, 1], "above 0"], [[1.2], "above 0"], [[Number.NaN], "above 0"],
      [Array.from({ length: 65 }, (_, i) => (i + 1) / 65), "fractions takes 1 to 64"]] as const)
      await expect(simulateExposureBuildUp(options, { fractions: fractions as number[] })).rejects.toThrow(message);
    await expect(simulateExposureBuildUp({ ...options, output: { format: "jpeg" } }, { fractions: [1] })).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateExposureBuildUp({ ...options, motion: { angularVelocityRadPerSec: { yaw: 0.1 } } }, { fractions: [1] })).rejects.toThrow("rotating camera");
    await expect(simulateExposureBuildUp(options, { fractions: [1], extra: 1 } as never)).rejects.toThrow("Unknown simulateExposureBuildUp option");
  }, scaledTimeout(60_000));
});
