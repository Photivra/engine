// SPDX-License-Identifier: Apache-2.0
// #743: simulateFalseColor with measure.noise: the demosaic and the noise against the noise-free full-color reference.
import { afterEach, describe, expect, it } from "vitest";
import { createDisplayViewExpectedSignal } from "../src/facade/display-view.js";
import { falseColorNoiseTestHook } from "../src/facade/false-color-noise.js";
import { prepareDisplayView, preparedDisplayViewParts } from "../src/facade/simulate-display-view.js";
import { simulateCapture, simulateFalseColor, type SimulateCaptureOptions } from "../src/index.js";

type Scene = SimulateCaptureOptions["scene"];
type Raw = Awaited<ReturnType<typeof simulateCapture>>["raw"];
const grating = (f: number, level = 0.4, amplitude = 0.3): Scene => ({ kind: "reflectance-function", sceneId: "grating-" + f + "-" + level,
  evaluate: (p: { u: number }) => level + amplitude * Math.sin(2 * Math.PI * f * 32 * p.u) }) as Scene;
const colored = { kind: "reflectance-function", sceneId: "flat-colored", evaluate: (p: { wavelengthNanometers: number }) => 0.3 + 0.2 * Math.sin(p.wavelengthNanometers / 50) } as Scene;
const request = (scene: Scene, demosaic: "bilinear" | "ahd" = "bilinear", extra: Record<string, unknown> = {}): SimulateCaptureOptions =>
  ({ scene, ...extra, output: { width: 64, height: 64, demosaic } }) as SimulateCaptureOptions;
const manual = (shutterSeconds: number, iso = 100): Record<string, unknown> => ({ exposure: { mode: "manual", shutterSeconds, iso } });

/** The a*b* standard deviation of a uniform patch predicted from the per-channel variances: the development linearized at the patch (central differences). */
async function predictedChromaDeviation(options: SimulateCaptureOptions): Promise<number> {
  const [parts] = preparedDisplayViewParts(await prepareDisplayView({ ...options, fast: false }, { gpu: "off" }), "test");
  const run = { started: 0, viewStarted: 0, checkAbort: (): void => {}, yieldControl: (): Promise<void> => Promise.resolve() };
  const { setup } = parts.setupOf({ width: parts.context.width, height: parts.context.height, samplesPerAxis: 1, bitDepth: 8, format: "srgb-8" }, run);
  const factory = parts.context.lens ?? createDisplayViewExpectedSignal, X = setup.margin + 32, Y = setup.margin + 32;
  const electrons = [0, 1, 2].map((c) => { const s = factory({ ...setup.gpu!.reference!, channelAt: () => c }, 8); s.window(X, Y, X + 1, Y + 1); return s.site(X, Y); });
  // The view's readout moments: k²·(e + dark) for the charge, plus read noise and ADC quantization.
  const mean = electrons.map((e, c) => setup.readout[c]!.perElectron * (e + setup.readout[c]!.darkElectrons));
  const variance = electrons.map((e, c) => { const q = setup.readout[c]!; return q.perElectron ** 2 * (e + q.darkElectrons) + q.constantVariance; });
  const ab = (v: number[]): number[] => {
    const c = v.map((x, k) => Math.min(setup.gains[k]! * x, setup.clipLevel)), M = setup.matrix;
    const rgb = M.map((row) => { let y = row[0]! * c[0]! + row[1]! * c[1]! + row[2]! * c[2]!; if (setup.toneCurve === "positive-reinhard-per-channel") y = y > 0 ? y / (1 + y) : 0; return Math.min(1, Math.max(0, y)); });
    const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const [fx, fy, fz] = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]].map((w) => f((w[0]! * rgb[0]! + w[1]! * rgb[1]! + w[2]! * rgb[2]!) / (w[0]! + w[1]! + w[2]!)));
    return [500 * (fx! - fy!), 200 * (fy! - fz!)];
  };
  let sum = 0;
  for (let c = 0; c < 3; c++) {
    const h = 1e-6 * mean[c]!, up = [...mean], down = [...mean];
    up[c]! += h; down[c]! -= h;
    const a = ab(up), b = ab(down);
    for (let k = 0; k < 2; k++) sum += ((a[k]! - b[k]!) / (2 * h)) ** 2 * variance[c]!;
  }
  return Math.sqrt(sum);
}

afterEach(() => { delete falseColorNoiseTestHook.runs; });

describe("simulateFalseColor with measure.noise (#743)", () => {
  it("keeps the noise-free result and adds the three measures", async () => {
    const options = request(grating(0.3), "ahd");
    const plain = await simulateFalseColor(options, { map: true, images: true }), noisy = await simulateFalseColor(options, { map: true, images: true, noise: true });
    expect(plain.noise).toBeUndefined();
    expect(noisy.chromaDifference).toEqual(plain.chromaDifference);
    expect(noisy.map!.values).toEqual(plain.map!.values);
    expect(noisy.images).toEqual(plain.images);
    expect(noisy.assumptions.slice(0, -1)).toEqual(plain.assumptions);
    expect(noisy.assumptions.at(-1)!.id).toBe("falseColor.noise");
    const n = noisy.noise!;
    expect(n.seed).toBe(1);
    expect(n.demosaicOnly).toEqual(plain.chromaDifference);
    expect(n.maps!.demosaicOnly.values).toEqual(plain.map!.values);
    for (const m of [n.withNoise, n.noiseOnly]) {
      expect(m.pixelCount).toBe(64 * 64);
      expect(m.fractionAbove.map((f) => f.threshold)).toEqual([1, 2, 5]);
      expect(m.mean).toBeGreaterThan(0);
    }
    for (const key of ["withNoise", "noiseOnly"] as const) {
      const map = n.maps![key];
      expect(Math.fround(n[key].maximum)).toBe(Math.max(...map.values));
      expect(n[key].mean).toBeCloseTo(map.values.reduce((t, v) => t + v, 0) / map.values.length, 4);
      expect(n.images![key]).toHaveLength(4 * 64 * 64);
    }
    // Noise moves the developed pixels: the noisy images differ from the noise-free capture side.
    expect(n.images!.withNoise).not.toEqual(plain.images!.capture);
  }, 60_000);

  it("demosaics the RAW simulateCapture returns for the request and seed, bit for bit", async () => {
    for (const [demosaic, noise] of [["bilinear", true], ["ahd", { seed: 7 }]] as const) {
      const options = request({ preset: "siemens-star" } as Scene, demosaic);
      let runs: readonly Raw[] = [];
      falseColorNoiseTestHook.runs = (r): void => { runs = r; };
      const result = await simulateFalseColor(options, { noise });
      const seed = noise === true ? 1 : noise.seed;
      expect(result.noise!.seed).toBe(seed);
      const capture = await simulateCapture({ ...options, fast: false, sensor: { noiseSeed: seed } } as SimulateCaptureOptions);
      expect(runs).toHaveLength(3);
      expect(runs[0]!.codes).toEqual(capture.raw.codes);
      expect(runs[0]!.blackLevels).toEqual(capture.raw.blackLevels);
      expect(runs[0]!.saturationFlags).toEqual(capture.raw.saturationFlags);
      expect(runs[0]!.effectiveSaturationCodes).toEqual(capture.raw.effectiveSaturationCodes);
      // The extra planes: the same readout (black and white levels), other draws of other expected electrons.
      for (const extra of runs.slice(1)) {
        expect(extra.blackLevels).toEqual(capture.raw.blackLevels);
        expect(extra.effectiveSaturationCodes).toEqual(capture.raw.effectiveSaturationCodes);
        expect(extra.codes).not.toEqual(capture.raw.codes);
      }
      expect(runs[1]!.codes).not.toEqual(runs[2]!.codes);
    }
  }, 120_000);

  it("on a uniform patch: no demosaic error, and noiseOnly's spread as the per-channel variances predict (within 5 %)", async () => {
    for (const scene of [{ preset: "uniform" } as Scene, colored]) for (const iso of [100, 3200]) {
      const options = request(scene, "bilinear", manual(0.008 * 100 / iso, iso));
      const n = (await simulateFalseColor(options, { noise: true })).noise!;
      expect(n.demosaicOnly.maximum).toBeLessThanOrEqual(1e-9);
      // Measured (arm64): 0.7 % to 0.9 % below the prediction over the 4,096 pixels.
      expect(Math.abs(n.noiseOnly.rootMeanSquare / await predictedChromaDeviation(options) - 1)).toBeLessThan(0.05);
      // Without a demosaic error the demosaiced noise is the remaining error (bilinear averages some of it out).
      expect(n.withNoise.mean).toBeGreaterThan(0);
    }
  }, 120_000);

  it("tends to the noise-free measure as the exposure rises (shot and read noise relatively lower)", async () => {
    for (const demosaic of ["bilinear", "ahd"] as const) {
      const gaps: number[] = [], spread: number[] = [];
      // A dark grating (0.12 ± 0.08) so that 16 times the exposure does not clip.
      for (const shutter of [0.004, 0.016, 0.064]) {
        const r = await simulateFalseColor(request(grating(0.25, 0.12, 0.08), demosaic, manual(shutter)), { noise: true, map: true });
        const w = r.noise!.maps!.withNoise.values, d = r.map!.values;
        gaps.push(w.reduce((t, v, i) => t + Math.abs(v - d[i]!), 0) / w.length);
        spread.push(r.noise!.noiseOnly.mean);
      }
      // Measured (arm64): bilinear 0.66, 0.54, 0.28; AHD 0.74, 0.70, 0.33 (mean per-pixel |withNoise − demosaicOnly|).
      expect(gaps[1]!).toBeLessThan(gaps[0]!);
      expect(gaps[2]!).toBeLessThan(gaps[1]!);
      expect(spread[1]!).toBeLessThan(spread[0]!);
      expect(spread[2]!).toBeLessThan(spread[1]!);
    }
  }, 120_000);

  it("gives a region the same values as the same pixels of the whole frame, bit for bit", async () => {
    for (const demosaic of ["bilinear", "ahd"] as const) {
      const options = request({ preset: "siemens-star" } as Scene, demosaic);
      const whole = await simulateFalseColor(options, { map: true, images: true, noise: true });
      const region = { x: 13, y: 21, width: 30, height: 17 };
      const part = await simulateFalseColor(options, { region, map: true, images: true, noise: true });
      for (const key of ["withNoise", "noiseOnly"] as const) for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
        const i = y * region.width + x, j = (y + region.y) * 64 + x + region.x;
        expect(part.noise!.maps![key].values[i]).toBe(whole.noise!.maps![key].values[j]);
        for (let c = 0; c < 4; c++) expect(part.noise!.images![key][4 * i + c]).toBe(whole.noise!.images![key][4 * j + c]);
      }
    }
  }, 120_000);

  it("gives identical results on two calls and refuses what it does not take", async () => {
    const options = request(grating(0.3), "ahd");
    const a = await simulateFalseColor(options, { noise: { seed: 3 }, map: true }), b = await simulateFalseColor(options, { noise: { seed: 3 }, map: true });
    expect(b.noise!.withNoise).toEqual(a.noise!.withNoise);
    expect(b.noise!.maps!.noiseOnly.values).toEqual(a.noise!.maps!.noiseOnly.values);
    const c = await simulateFalseColor(options, { noise: { seed: 4 } });
    expect(c.noise!.withNoise.mean).not.toBe(a.noise!.withNoise.mean);
    for (const [noise, message] of [["yes", /true or \{ seed \}/], [{ seed: -1 }, /seed must be an integer/], [{ seed: 1.5 }, /seed must be an integer/], [{ bogus: 1 }, /bogus/]] as const)
      await expect(simulateFalseColor(options, { noise } as never)).rejects.toThrow(message);
    await expect(simulateFalseColor({ ...options, fast: true }, { noise: true })).rejects.toThrow(/fast: true/);
    await expect(simulateFalseColor(options, { noise: true, bogus: 1 } as never)).rejects.toThrow(/bogus/);
  }, 60_000);
});
