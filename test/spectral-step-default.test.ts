// SPDX-License-Identifier: Apache-2.0
/**
 * #590 (2.22.0): the default spectral step follows the light and the request's quality. κ and R(20) of the representative sources
 * (#557) and the smooth ones as measured in #590; 5 nm on exact requests (the exports, fast: false) under a spiky light, 20 nm on
 * fast ones with the spikiness assumption, 20 nm under smooth lights (unchanged), and an explicit step always wins.
 */
import { describe, expect, it } from "vitest";
import { createRepresentativeLightSourceIlluminant, simulateCapture, simulateDisplayView, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { resolveCaptureIlluminant } from "../src/facade/scene-radiance.js";
import { SPECTRAL_SPIKINESS_THRESHOLD, spectralSpikiness } from "../src/color/spectral-spikiness.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const FLUORESCENT = createRepresentativeLightSourceIlluminant({ sourceId: "tri-phosphor-fluorescent-4000k" });
const value = (r: { assumptions: readonly { id: string; value: unknown }[] }, id: string): unknown => r.assumptions.find((a) => a.id === id)?.value;
const mean = (r: SimulateCaptureResult): number[] => { const s = r.image.samples, m = [0, 0, 0]; for (let i = 0; i < s.length; i++) m[i % 3]! += s[i]! / (s.length / 3); return m; };

describe("the spectral step's default (#590)", () => {
  it("measures κ and R(20) as #590 did: the four representative sources are spiky, Planck and CIE A are not", () => {
    const r20 = (light: Parameters<typeof resolveCaptureIlluminant>[0]): number => { const shape = resolveCaptureIlluminant(light).shape; return 400 * spectralSpikiness((nm) => shape.evaluate(nm)) / 24; };
    const sources = { "tri-phosphor-fluorescent-4000k": 0.835, "white-led-low-rendering-4000k": 0.0384, "white-led-high-rendering-4000k": 0.0306, "warm-white-led-2700k": 0.0167 } as const;
    for (const [sourceId, expected] of Object.entries(sources)) {
      const r = r20(createRepresentativeLightSourceIlluminant({ sourceId: sourceId as keyof typeof sources }));
      expect(r, sourceId).toBeCloseTo(expected, expected > 0.1 ? 2 : 3);
      expect(r).toBeGreaterThan(SPECTRAL_SPIKINESS_THRESHOLD);
    }
    for (const smooth of [{ kind: "cie-a" as const }, { kind: "planckian" as const, temperatureKelvin: 2700 }, { kind: "planckian" as const, temperatureKelvin: 6500 }]) expect(r20(smooth)).toBeLessThan(3.1e-4);
    // A flat spectrum has no second difference.
    expect(spectralSpikiness(() => 1)).toBe(0);
  });

  it("takes 5 nm on exact requests under a spiky light and 20 nm on fast ones, noting it; an explicit step wins", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "uniform", reflectance: 0.9 }, illuminant: FLUORESCENT, illuminanceLux: 500, output: { width: 8, height: 8 } };
    const dng = await simulateCapture({ ...options, output: { ...options.output, format: "dng" } }), fast = await simulateCapture(options), exact = await simulateCapture({ ...options, fast: false });
    expect(value(dng, "sensor.spectralStepNanometers")).toBe(5);
    expect(value(dng, "sensor.spectralSpikiness")).toMatchObject({ stepNanometers: 5, fast: false, threshold: 0.01 });
    expect(value(exact, "sensor.spectralStepNanometers")).toBe(5);
    expect(value(fast, "sensor.spectralStepNanometers")).toBe(20);
    expect((value(fast, "sensor.spectralSpikiness") as { r20: number }).r20).toBeCloseTo(0.835, 2);
    // The fast method reports in diagnostics.fast like the other fast approximations; the exact requests report false; an explicit
    // step or a smooth light makes no choice and adds no key.
    expect(fast.diagnostics.fast).toMatchObject({ requested: true, applied: { "sensor.spectralStepNanometers": true }, assurance: "approximation-with-a-priori-bound" });
    for (const r of [dng, exact]) expect(r.diagnostics.fast).toMatchObject({ requested: false, applied: { "sensor.spectralStepNanometers": false }, assurance: "engine-reference" });
    const view = await simulateDisplayView(options, { width: 4, height: 4 });
    expect(value(view, "sensor.spectralStepNanometers")).toBe(20);
    expect(view.diagnostics.fast.applied).toMatchObject({ "sensor.spectralStepNanometers": true });
    const explicit = await simulateCapture({ ...options, sensor: { spectralStepNanometers: 10 }, fast: false });
    expect(explicit.assumptions.find((a) => a.id === "sensor.spectralStepNanometers")).toBeUndefined();
    expect(value(explicit, "sensor.spectralSpikiness")).toBeUndefined();
    expect(explicit.diagnostics.fast.applied["sensor.spectralStepNanometers"]).toBeUndefined();
    // Mixed light: spiky when any source is.
    const mixed = await simulateCapture({ scene: options.scene, output: { width: 8, height: 8 }, fast: false,
      illumination: { sources: [{ illuminant: { kind: "cie-a" }, illuminanceLux: 300 }, { illuminant: FLUORESCENT, illuminanceLux: 500 }], blend: { kind: "radial", radius: 1 } } });
    expect(value(mixed, "sensor.spectralStepNanometers")).toBe(5);
  }, scaledTimeout(60_000));

  it("keeps 20 nm and no new assumption under a smooth light", async () => {
    const r = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 8, height: 8, format: "dng" } });
    expect(value(r, "sensor.spectralStepNanometers")).toBe(20);
    expect(value(r, "sensor.spectralSpikiness")).toBeUndefined();
    expect(r.diagnostics.fast.applied["sensor.spectralStepNanometers"]).toBeUndefined();
  }, scaledTimeout(60_000));

  it("brings an exact white under the fluorescent source to the fine-step value", async () => {
    // White balance fixed, so the image's mean follows the quadrature.
    const options: SimulateCaptureOptions = { scene: { preset: "uniform", reflectance: 0.9 }, illuminant: FLUORESCENT, illuminanceLux: 500, fast: false,
      output: { width: 32, height: 32, format: "srgb-16", whiteBalance: { kelvin: 4000 } }, sensor: { noiseSeed: 2 } };
    const [defaulted, fine, coarse] = await Promise.all([simulateCapture(options), simulateCapture({ ...options, sensor: { noiseSeed: 2, spectralStepNanometers: 1 } }),
      simulateCapture({ ...options, sensor: { noiseSeed: 2, spectralStepNanometers: 20 } })]);
    const a = mean(defaulted), b = mean(fine), c = mean(coarse);
    const worst = (x: number[]): number => Math.max(...x.map((v, i) => Math.abs(v / b[i]! - 1)));
    // Measured: 5 nm within 0.34 % of 1 nm (the seeded noise of differing expected values included); 20 nm 70 % off in one channel.
    expect(worst(a)).toBeLessThan(0.01);
    expect(worst(c)).toBeGreaterThan(0.3);
  }, scaledTimeout(120_000));
});
