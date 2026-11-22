// SPDX-License-Identifier: Apache-2.0

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvalidConfigurationError, calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, evaluateSrgbDecoding, simulateCapture,
  type SimulateCaptureOptions, type SimulateCaptureResult, type SimulateCaptureSensorAntiAliasing } from "../src/index.js";
import { createDiffractedPlanarProvider } from "../src/facade/diffraction-provider.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";

/** Mean false colour of a neutral chart: |R − G| + |B − G| per pixel, in 8-bit codes. */
const falseColour = (samples: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 3) sum += Math.abs(samples[i]! - samples[i + 1]!) + Math.abs(samples[i + 2]! - samples[i + 1]!);
  return sum / (samples.length / 3);
};
/** Star modulation (p95 − p5)/(p95 + p5) of the linear luminance on a circle of the given radius about the centre of an S × S image. */
const starModulation = (samples: ArrayLike<number>, size: number, radius: number): number => {
  const y = (x: number, j: number): number => { const i = 3 * (j * size + x);
    return 0.2126 * evaluateSrgbDecoding(samples[i]! / 255) + 0.7152 * evaluateSrgbDecoding(samples[i + 1]! / 255) + 0.0722 * evaluateSrgbDecoding(samples[i + 2]! / 255); };
  const values = Array.from({ length: 1440 }, (_, k) => {
    const px = size / 2 - 0.5 + radius * Math.cos(2 * Math.PI * k / 1440), py = size / 2 - 0.5 + radius * Math.sin(2 * Math.PI * k / 1440);
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    return (1 - fx) * (1 - fy) * y(x0, y0) + fx * (1 - fy) * y(x0 + 1, y0) + (1 - fx) * fy * y(x0, y0 + 1) + fx * fy * y(x0 + 1, y0 + 1);
  }).sort((a, b) => a - b);
  const lo = values[Math.floor(0.05 * values.length)]!, hi = values[Math.floor(0.95 * values.length)]!;
  return (hi - lo) / (hi + lo);
};

describe("simulateCapture sensor.antiAliasing (2.1)", () => {
  // The environment path itself is under test (#394: chart captures otherwise take the tabulated RAW path).
  beforeAll(() => setTabulatedNativeRawEnabled(false));
  afterAll(() => setTabulatedNativeRawEnabled(true));
  it("maps the presets onto the engine's point-splitting optical stack and records the assumption", async () => {
    const r = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4 }, sensor: { antiAliasing: { kind: "four-spot" } } });
    const stack = (r.request.siteInput(0).environment as unknown as { sensor: { spatialSampling: { opticalStackProfile: { profileId: string;
      effectiveAntiAliasingSpatialResponse: { kind: string; components: { offsetMicrometers: { x: number; y: number }; normalizedWeight: number }[] } } } } })
      .sensor.spatialSampling.opticalStackProfile;
    expect(stack.profileId).toBe("facade-aa");
    expect(stack.effectiveAntiAliasingSpatialResponse.kind).toBe("normalized-point-splitting-kernel");
    expect(stack.effectiveAntiAliasingSpatialResponse.components).toEqual([[-3, -3], [3, -3], [-3, 3], [3, 3]]
      .map(([x, y]) => ({ offsetMicrometers: { x, y }, normalizedWeight: 0.25 })));
    const record = r.assumptions.find((a) => a.id === "sensor.antiAliasing")!;
    expect(record.kind).toBe("model");
    expect(record.value).toMatchObject({ kind: "four-spot", separationSites: 1, separationMicrometers: 6 });
    expect(r.provenance.composedContracts).toContain("resolveAntiAliasingSpatialKernel");
    const plain = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4 } });
    expect(r.diagnostics.providerEvaluationCount).toBe(4 * plain.diagnostics.providerEvaluationCount);
    expect(plain.assumptions.some((a) => a.id === "sensor.antiAliasing")).toBe(false);
    // A flat field is unchanged in expectation: the split only moves light.
    const mean = (s: ArrayLike<number>): number => { let t = 0; for (let i = 0; i < s.length; i++) t += s[i]!; return t / s.length; };
    expect(Math.abs(mean(r.image.samples) - mean(plain.image.samples))).toBeLessThan(1.5);

    const two = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4 }, sensor: { antiAliasing: { kind: "two-spot", axis: "vertical", separationSites: 0.5 } } });
    expect((two.assumptions.find((a) => a.id === "sensor.antiAliasing")!.value as { components: unknown }).components)
      .toEqual([{ offsetMicrometers: { x: 0, y: -1.5 }, normalizedWeight: 0.5 }, { offsetMicrometers: { x: 0, y: 1.5 }, normalizedWeight: 0.5 }]);
    const custom: SimulateCaptureSensorAntiAliasing = { kind: "point-splitting", components: [{ offsetMicrometers: { x: 0, y: 0 }, normalizedWeight: 0.5 },
      { offsetMicrometers: { x: 6, y: 0 }, normalizedWeight: 0.5 }] };
    const c = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4 }, sensor: { antiAliasing: custom } });
    expect(c.diagnostics.providerEvaluationCount).toBe(2 * plain.diagnostics.providerEvaluationCount);
  });

  it("rejects malformed filters", async () => {
    const c = (x: number, w: number): { offsetMicrometers: { x: number; y: number }; normalizedWeight: number } => ({ offsetMicrometers: { x, y: 0 }, normalizedWeight: w });
    for (const antiAliasing of [null, "four-spot", { kind: "three-spot" }, { kind: "four-spot", separationSites: 0 }, { kind: "four-spot", separationSites: -1 },
      { kind: "four-spot", separationSites: 4.5 }, { kind: "four-spot", separationSites: Number.NaN }, { kind: "four-spot", axis: "horizontal" },
      { kind: "two-spot" }, { kind: "two-spot", axis: "diagonal" }, { kind: "point-splitting" }, { kind: "point-splitting", components: [] },
      { kind: "point-splitting", components: [c(0, 0.5), c(1, 0.4)] }, { kind: "point-splitting", components: [c(0, 1.5), c(1, -0.5)] },
      { kind: "point-splitting", components: [c(0, 0.5), c(25, 0.5)] }, { kind: "point-splitting", components: Array.from({ length: 17 }, () => c(0, 1 / 17)) },
      { kind: "point-splitting", components: [{ offsetMicrometers: { x: 0 }, normalizedWeight: 1 }] }, { kind: "point-splitting", components: [c(0, 1)], separationSites: 1 }]) {
      await expect(simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4 }, sensor: { antiAliasing: antiAliasing as never } }))
        .rejects.toThrow(InvalidConfigurationError);
    }
  });

  it("reduces false colour and above-Nyquist modulation on the Siemens star and slanted edge, alone and with diffraction and AHD", async () => {
    const run = (preset: "siemens-star" | "slanted-edge", extra: { aa?: boolean; diffraction?: boolean; ahd?: boolean }): Promise<SimulateCaptureResult> => simulateCapture({ scene: { preset },
      output: { width: 32, height: 32, ...(extra.ahd ? { demosaic: "ahd" as const } : {}) }, lens: { fNumber: 8, ...(extra.diffraction ? { diffraction: "circular-aperture" as const } : {}) },
      ...(extra.aa ? { sensor: { antiAliasing: { kind: "four-spot" as const } } } : {}) });
    for (const preset of ["siemens-star", "slanted-edge"] as const) {
      for (const base of [{}, { diffraction: true }, { ahd: true }, { diffraction: true, ahd: true }]) {
        const off = await run(preset, base), on = await run(preset, { ...base, aa: true });
        // Measured at 32 × 32 (docs/RELEASE_2_1_0.md): the star keeps 20–30 % and the edge 62–74 % of the false colour without the filter.
        expect(falseColour(on.image.samples)).toBeLessThan((preset === "siemens-star" ? 0.4 : 0.8) * falseColour(off.image.samples));
        // Near Nyquist (r = 12 px: 36 cycles, 2.09 px period) the filter's MTF |cos(π·f·d)| is close to zero.
        if (preset === "siemens-star") expect(starModulation(on.image.samples, 32, 12)).toBeLessThan(0.8 * starModulation(off.image.samples, 32, 12));
      }
    }
  }, scaledTimeout(60_000));
});

describe("sensor.antiAliasing with diffraction: the object-space convolution equals the per-tap environment quadrature", () => {
  // The environment path itself is under test (#394: chart captures otherwise take the tabulated RAW path).
  beforeAll(() => setTabulatedNativeRawEnabled(false));
  afterAll(() => setTabulatedNativeRawEnabled(true));
  /*
   * An odd output (9 × 7, native 11 × 9) keeps every query lattice off the frame centre, where the slanted edge and
   * the point grid have a material boundary: with an even native size the half-site lattice of the four-spot filter
   * hits the centre exactly, and a tap there picks its material by the last bit of its coordinate, which the two paths
   * compute in different orders (point-sampling ambiguity of the scene, as for the 2.1 diffraction test).
   */
  const options = (preset: "slanted-edge" | "point-grid", antiAliasing: SimulateCaptureSensorAntiAliasing): SimulateCaptureOptions => ({ scene: { preset },
    output: { width: 9, height: 7 }, lens: { fNumber: 8, diffraction: "circular-aperture" }, sensor: { spectralStepNanometers: 80, antiAliasing } });
  // One half-site lattice (four-spot, d = 1); four lattices (d = 0.8: offsets ±0.4); two lattices (two-spot, d = 1.5: offsets ±0.75).
  const filters: SimulateCaptureSensorAntiAliasing[] = [{ kind: "four-spot" }, { kind: "four-spot", separationSites: 0.8 }, { kind: "two-spot", axis: "horizontal", separationSites: 1.5 }];

  it("gives the same expected electrons at every site (relative 1e-12; only the summation order differs)", async () => {
    for (const antiAliasing of filters) for (const preset of ["slanted-edge", "point-grid"] as const) {
      const r = await simulateCapture(options(preset, antiAliasing)), d = r.request.diffraction!;
      expect(d.execution).toBe("object-space-convolution");
      const native = r.raw.plan.exposure.geometry.nativeRaster, sharp = createPlanarSceneRadianceProvider({ scene: { preset }, illuminant: { kind: "planckian", temperatureKelvin: 6500 },
        illuminanceLux: r.scene.illuminant.illuminanceLux, distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: 7 / 9,
        sceneId: "facade-scene", providerProfileId: "facade-provider" });
      const components = (r.assumptions.find((a) => a.id === "sensor.antiAliasing")!.value as { components: { offsetMicrometers: { x: number; y: number } }[] }).components;
      const diffracted = createDiffractedPlanarProvider({ base: sharp, psf: d.psf.configuration.psf, wavelengthsNm: d.profile.profile.axes.wavelengthNm,
        kernelRadius: d.profile.kernelRadiusSamples, nativeWidth: native.pixelWidth, nativeHeight: native.pixelHeight, outputWidth: 9, sitePitchMicrometers: 6,
        distanceM: r.scene.distanceM, metresPerFrameUnit: r.scene.framedWidthM / 2, queryOffsetsSites: components.map((c) => ({ x: -c.offsetMicrometers.x / 6, y: -c.offsetMicrometers.y / 6 })) });
      const electrons = (environment: unknown, evaluate: unknown): number => (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance: evaluate } as never)
        .value as unknown as { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
      let largest = 0;
      for (let i = 0; i < native.pixelWidth * native.pixelHeight; i++) {
        const environment = r.request.siteInput(i).environment as unknown as Record<string, unknown>;
        expect((environment.psf as { kind: string }).kind).toBe("not-applied");
        const method = electrons(environment, diffracted.evaluateRadiance.bind(diffracted));
        const reference = electrons({ ...environment, psf: d.psf }, sharp.evaluateRadiance.bind(sharp));
        largest = Math.max(largest, Math.abs(method - reference) / reference);
      }
      expect(largest).toBeLessThan(1e-12);
    }
  }, scaledTimeout(120_000));

  it("gives the same RAW codes as the facade's per-tap path with the same profile and filter", async () => {
    for (const antiAliasing of filters) {
      const fast = await simulateCapture(options("slanted-edge", antiAliasing));
      const perTap = await simulateCapture({ ...options("slanted-edge", antiAliasing), lens: { fNumber: 8, psf: fast.request.diffraction!.psf } });
      expect(Array.from(perTap.raw.codes)).toEqual(Array.from(fast.raw.codes));
      // The kernel's taps per site: (2R + 1)² (#732: R follows the flag).
      expect(fast.diagnostics.providerEvaluationCount * (2 * (fast.assumptions.find((a) => a.id === "lens.diffraction")!.value as { kernelRadiusSamples: number }).kernelRadiusSamples + 1) ** 2).toBe(perTap.diagnostics.providerEvaluationCount);
    }
  }, scaledTimeout(120_000));
});
