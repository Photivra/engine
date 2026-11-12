// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, simulateIdealReference, simulateCapture, type SimulateCaptureOptions } from "../src/index.js";

const mean = (a: ArrayLike<number>, channel = 1): number => { let s = 0, n = 0; for (let i = channel; i < a.length; i += 3) { s += a[i]!; n++; } return s / n; };

describe("simulateIdealReference (2.3)", () => {
  it("matches the capture's exposure: a uniform patch renders at the capture's mean level", async () => {
    for (const extra of [{}, { exposure: { shutterSeconds: 1 / 60, iso: 200 } }, { lens: { fNumber: 4 } }, { illuminant: "cie-a" as const, output: { width: 24, height: 16, whiteBalance: { kelvin: 4000 } } },
      { sensor: { pixelPitchMicrometers: 3 } }, { output: { width: 24, height: 16, toneCurve: "positive-reinhard-per-channel" as const } }] as Partial<SimulateCaptureOptions>[]) {
      const options: SimulateCaptureOptions = { scene: { preset: "uniform" }, output: { width: 24, height: 16 }, ...extra } as SimulateCaptureOptions;
      const capture = await simulateCapture(options), reference = await simulateIdealReference(options);
      for (const c of [0, 1, 2]) expect(Math.abs(mean(reference.image.samples, c) - mean(capture.image.samples, c))).toBeLessThan(1);
      expect(new Set(reference.image.samples).size).toBeLessThanOrEqual(3); // noise-free: one colour
    }
  }, 120_000);

  it("is labelled, deterministic and reports its conventions", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "slanted-edge" }, output: { width: 32, height: 24 } };
    const a = await simulateIdealReference(options), b = await simulateIdealReference(options);
    expect(a.kind).toBe("ideal-reference");
    expect(a.label).toMatch(/not a capture/u);
    expect(Array.from(a.image.samples)).toEqual(Array.from(b.image.samples));
    expect(a).not.toHaveProperty("raw");
    const ids = a.assumptions.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["reference.kind", "reference.excludes", "reference.exposure", "reference.sampling"]));
    expect(a.assumptions.find((x) => x.id === "reference.exposure")!.value).toMatchObject({ convention: "exposure-matched", fNumber: 8, iso: 100 });
    expect(a.scene.sourceSha256).toBe((await simulateCapture(options)).scene.sourceSha256);
    // Point sampling: two levels only (a sharp edge); the box aperture averages the pixels the edge crosses.
    expect(new Set(Array.from({ length: 32 * 24 }, (_, i) => a.image.samples[3 * i + 1])).size).toBe(2);
    const box = await simulateIdealReference({ ...options, sensor: { pixelAperture: "box" } });
    expect(new Set(Array.from({ length: 32 * 24 }, (_, i) => box.image.samples[3 * i + 1])).size).toBeGreaterThan(4);
    // 2.24.0: the ideal reference is an exact request, so the box takes 8 samples per axis by default.
    expect(box.assumptions.find((x) => x.id === "reference.sampling")!.value).toEqual({ kind: "box", samplesPerAxis: 8 });
  }, 60_000);

  it("uses the capture's framing, chart size and region, and caller functions", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "composite", background: { preset: "line-grid" }, elements: [{ scene: { preset: "zone-plate" }, centerU: 0, centerV: 0, width: 1, height: 1, mask: "ellipse" }] },
      chartSize: { widthM: 0.3, surroundReflectance: 0.05 }, subjectDistanceM: 40, output: { width: 40, height: 30, format: "png", colorEncoding: "display-p3" } };
    const whole = await simulateIdealReference(options);
    expect(whole.image.png).toBeInstanceOf(Uint8Array);
    expect(whole.scene.chart?.frameWidthFraction).toBeCloseTo(0.3 / whole.scene.framedWidthM, 12);
    const region = { x: 7, y: 5, width: 11, height: 9 }, crop = await simulateIdealReference({ ...options, output: { ...options.output, region } });
    expect(crop.region).toMatchObject({ ...region, frameWidth: 40, frameHeight: 30 });
    for (let y = 0; y < 9; y++) for (let x = 0; x < 33; x++) expect(crop.image.samples[y * 33 + x]).toBe(whole.image.samples[((y + 5) * 40 + 7) * 3 + x]);
    // The surround and corner match the capture's level.
    const capture = await simulateCapture(options);
    expect(Math.abs(whole.image.samples[1]! - mean(Array.from(capture.image.samples).slice(0, 3 * 4)))).toBeLessThan(3);
    const fn = await simulateIdealReference({ scene: { kind: "reflectance-function", sceneId: "split", evaluate: (p) => (p.u < 0 ? 0.1 : 0.7) }, output: { width: 8, height: 4 } });
    expect(fn.image.samples[1]!).toBeLessThan(fn.image.samples[3 * 7 + 1]!);
  }, 60_000);

  it("refuses formats and settings it cannot reproduce", async () => {
    for (const output of [{ format: "dng" }, { format: "jpeg" }, { whiteBalance: "auto" }] as const)
      await expect(simulateIdealReference({ scene: { preset: "uniform" }, output: { width: 8, height: 8, ...output } })).rejects.toThrow(InvalidConfigurationError);
  });
});
