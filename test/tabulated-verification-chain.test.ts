// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { CHART_SCENE_PRESETS, InvalidConfigurationError, createPlanarSceneRadianceProvider, simulateCapture, type ChartScene, type SimulateCaptureOptions,
  type SimulateCaptureResult } from "../src/index.js";
import { setTabulatedNativeRawEnabled, setTabulatedVerificationTestHook, tabulatedVerificationStatistics } from "../src/capture/native-environment-tabulated.js";
import { calculateIrradianceConvolution, createIrradianceConvolutionInteriorRunner, createIrradianceConvolutionRunner } from "../src/optics/irradiance-convolution.js";
import { createDiffractedPlanarProvider } from "../src/facade/diffraction-provider.js";
import { CHART_PRESET_SCENES } from "./helpers/chart-radiance-fixtures.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #453: the tabulated RAW path's four verification sites (one per CFA phase) run the chain through
 * executeEngineOwnedEnvironmentPhotoSignal, which skips re-validating engine-built records, and the diffraction provider fills
 * its convolution lattices from one material lookup per point and validates a band's convolutions once. Neither may change a
 * value, and the verification must still reject a wrong tabulated signal.
 */
afterEach(() => { setTabulatedVerificationTestHook(undefined); setTabulatedNativeRawEnabled(true); });

/** Undefined when a and b are the same data bit for bit (Object.is leaves, same keys in the same order); else the first differing path. */
function firstDifference(a: unknown, b: unknown, path = "value"): string | undefined {
  if (Object.is(a, b)) return undefined;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return path;
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.join("\u0000") !== bk.join("\u0000")) return path + " (keys)";
  for (const key of ak) {
    const d = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path + "." + key);
    if (d !== undefined) return d;
  }
  return undefined;
}

const method = (r: SimulateCaptureResult): unknown => (r.assumptions.find((a) => a.id === "raw.expectedSignal")?.value as { method?: string } | undefined)?.method;
const ramp = (a: number, b: number): { kind: "tabulated"; samples: { wavelengthNanometers: number; value: number }[] } =>
  ({ kind: "tabulated", samples: [380, 480, 580, 680, 780].map((w, i) => ({ wavelengthNanometers: w, value: a + (b - a) * i / 4 })) });
const materialScene = { kind: "material-function" as const, sceneId: "test-453-materials", materials: [0.2, ramp(0.1, 0.8), 0.85],
  materialAt: ({ u, v }: { u: number; v: number }): number => (u * u + v * v < 0.2 ? 2 : u > 0.05 * v ? 1 : 0) };

const CAPTURES: [string, SimulateCaptureOptions][] = [
  ["siemens-star, Speed", { scene: { preset: "siemens-star" }, output: { width: 48, height: 32 } }],
  ["zone-plate, Quality (diffraction, four-spot, box 2, AHD)", { scene: { preset: "zone-plate" }, lens: { fNumber: 11, diffraction: "circular-aperture" },
    sensor: { antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: 48, height: 32, demosaic: "ahd" } }],
  ["material scene with a spectral material, chart size and diffraction", { scene: materialScene, chartSize: { widthM: 0.3 }, subjectDistanceM: 2,
    lens: { diffraction: "circular-aperture" }, sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: 48, height: 32 } }],
  ["patches with spectra, rolling shutter, region", { scene: CHART_PRESET_SCENES.find(([name]) => name === "patches")![1], motion: { shutter: "rolling" },
    lens: { fNumber: 8, diffraction: "circular-aperture" }, output: { width: 64, height: 48, region: { x: 21, y: 13, width: 16, height: 12 } } }],
  ["slanted-edge, ISO 3200 (saturated), 1.4 µm", { scene: { preset: "slanted-edge" }, exposure: { mode: "manual", iso: 3200, shutterSeconds: 1 / 30 },
    sensor: { pixelPitchMicrometers: 1.4 }, lens: { diffraction: "circular-aperture" }, output: { width: 48, height: 32 } }]
];

describe("tabulated RAW verification sites (#453)", () => {
  it("run the chain four times per call, and the engine-owned chain gives the full executor's photo signal bit for bit", async () => {
    for (const [name, options] of CAPTURES) {
      const pairs: [unknown, unknown][] = [];
      setTabulatedVerificationTestHook({ fullPhoto: (engineOwned, full) => pairs.push([engineOwned, full]) });
      const before = tabulatedVerificationStatistics.chainExecutions;
      const result = await simulateCapture(options);
      expect(method(result), name).toBe("per-site-integrated-electrons");
      expect(tabulatedVerificationStatistics.chainExecutions - before, name).toBe(4);
      expect(pairs.length, name).toBe(4);
      for (const [engineOwned, full] of pairs) expect(firstDifference(engineOwned, full), name).toBeUndefined();
    }
  }, scaledTimeout(300_000));

  it("run no chain where the tabulated path does not apply", async () => {
    const before = tabulatedVerificationStatistics.chainExecutions;
    const result = await simulateCapture({ scene: { kind: "radiance-function", sceneId: "test-453-radiance", evaluate: ({ u }: { u: number }): number => (u > 0 ? 0.02 : 0.005) },
      lens: { diffraction: "circular-aperture" }, output: { width: 24, height: 16 } });
    expect(method(result)).toBeUndefined();
    expect(tabulatedVerificationStatistics.chainExecutions).toBe(before);
  }, scaledTimeout(120_000));

  it("reject a deliberately wrong tabulated signal and fall back to the environment path's output", async () => {
    const options = CAPTURES[1]![1];
    setTabulatedNativeRawEnabled(false);
    const chain = await simulateCapture(options);
    setTabulatedNativeRawEnabled(true);
    // One CFA phase off by 1e-6 relative (1000 × the tolerance): verification fails and the environment task runs.
    setTabulatedVerificationTestHook({ tabulatedElectrons: (value, x, y) => ((x & 1) === 1 && (y & 1) === 1 ? value * (1 + 1e-6) : value) });
    const rejected = await simulateCapture(options);
    expect(method(rejected)).toBeUndefined();
    expect(Array.from(rejected.raw.codes)).toEqual(Array.from(chain.raw.codes));
    expect(Array.from(rejected.image.samples)).toEqual(Array.from(chain.image.samples));
    // A change inside the rounding tolerance still passes.
    setTabulatedVerificationTestHook({ tabulatedElectrons: (value) => value * (1 + 1e-12) });
    expect(method(await simulateCapture(options))).toBe("per-site-integrated-electrons");
  }, scaledTimeout(300_000));
});

/** One scene per chart preset, with spectral materials where the preset takes them. */
function presetScenes(): [string, ChartScene][] {
  const fixtures = new Map(CHART_PRESET_SCENES);
  const scenes: [string, ChartScene][] = CHART_SCENE_PRESETS.map((preset) => [preset, preset === "composite" ? { preset: "composite", background: { preset: "uniform", reflectance: ramp(0.3, 0.6) },
    elements: [{ scene: CHART_PRESET_SCENES.find(([name]) => name === "patches")![1], centerU: -0.4, centerV: 0.1, width: 0.6, height: 0.4 },
      { scene: { preset: "siemens-star", cycles: 12 }, centerU: 0.4, centerV: -0.1, width: 0.5, height: 0.5, mask: "ellipse" }] } as ChartScene :
    fixtures.get(preset) ?? { preset } as ChartScene]);
  expect(scenes.map(([name]) => name)).toEqual([...CHART_SCENE_PRESETS]);
  return scenes;
}

describe("diffraction lattice fill from materials (#453, option b)", () => {
  const wavelengths = [380, 412.5, 555, 600, 699.9, 780];
  const lattice = (aspect: number): [number, number][] => {
    const points: [number, number][] = [];
    for (let j = 0; j <= 60; j++) for (let i = 0; i <= 90; i++) points.push([-1.3 + 2.6 * i / 90, aspect * (-1.3 + 2.6 * j / 60)]);
    return points;
  };
  const common = { illuminant: { kind: "planckian" as const, temperatureKelvin: 5000 }, illuminanceLux: 10_000, distanceM: 2, framedWidthM: 1, sceneId: "s", providerProfileId: "p" };

  it("radianceAt equals materialRadiance(chartMaterialAt) bit for bit for every chart preset, with and without a fixed-size surround, and for material scenes", () => {
    const cases: [string, Parameters<typeof createPlanarSceneRadianceProvider>[0]][] = [];
    for (const [name, scene] of presetScenes()) {
      cases.push([name, { ...common, scene, aspect: 2 / 3 }]);
      cases.push([name + " with chartSize", { ...common, scene, aspect: 2 / 3, chartSize: { widthM: 0.6, heightM: 0.4, surroundReflectance: 0.3 } }]);
    }
    cases.push(["material scene", { ...common, scene: materialScene, aspect: 2 / 3 }]);
    cases.push(["material scene with chartSize", { ...common, scene: materialScene, aspect: 2 / 3, chartSize: { widthM: 0.5 } }]);
    for (const [name, input] of cases) {
      const provider = createPlanarSceneRadianceProvider(input);
      expect(provider.chartMaterialAt, name).toBeTypeOf("function");
      let mismatches = 0;
      for (const [u, v] of lattice(2 / 3)) {
        const m = provider.chartMaterialAt!(u, v);
        for (const nm of wavelengths) if (!Object.is(provider.radianceAt(u, v, nm), provider.materialRadiance!(m, nm))) mismatches++;
      }
      expect(mismatches, name).toBe(0);
    }
  });

  it("gives the radianceAt fill's convolved values bit for bit", async () => {
    const r = await simulateCapture({ scene: { preset: "siemens-star" }, lens: { fNumber: 8, diffraction: "circular-aperture" }, output: { width: 4, height: 4 } });
    const d = r.request.diffraction!, R = d.profile.kernelRadiusSamples, nodes = d.profile.profile.axes.wavelengthNm.filter((_: number, i: number) => i % 7 === 0);
    const W = 66, H = 46, outputWidth = 64, metresPerFrameUnit = 0.5, distanceM = 2;
    const offsets = [{ x: -0.75, y: -0.75 }, { x: 0.25, y: -0.75 }, { x: -0.75, y: 0.25 }, { x: 0.25, y: 0.25 }, { x: 0, y: 0 }];
    const window = { x: 20, y: 30, width: 14, height: 9 };
    for (const scene of [CHART_PRESET_SCENES.find(([name]) => name === "patches")![1], materialScene, { preset: "zone-plate" } as ChartScene]) {
      const base = createPlanarSceneRadianceProvider({ ...common, scene, distanceM, framedWidthM: 2 * metresPerFrameUnit, aspect: H / W, chartSize: { widthM: 0.7 } });
      const make = (b: typeof base): ReturnType<typeof createDiffractedPlanarProvider> => createDiffractedPlanarProvider({ base: b, psf: d.psf.configuration.psf, wavelengthsNm: nodes, kernelRadius: R, nativeWidth: W, nativeHeight: H,
        outputWidth, sitePitchMicrometers: 6, distanceM, metresPerFrameUnit, queryOffsetsSites: offsets, window });
      // Without material access the provider fills each lattice point and node with radianceAt (the earlier method).
      const fromMaterials = make(base), fromRadianceAt = make({ ...base, chartMaterialAt: undefined, materialRadiance: undefined } as unknown as typeof base);
      let compared = 0;
      for (let j = window.y; j < window.y + window.height; j++) for (let i = window.x; i < window.x + window.width; i++) for (const o of offsets) for (const nm of nodes) {
        const g = 2 / outputWidth, u = (i + 0.5 + o.x - W / 2) * g, v = -(j + 0.5 + o.y - H / 2) * g, x = -u * metresPerFrameUnit, y = -v * metresPerFrameUnit, n = Math.hypot(x, y, distanceM);
        const request = { schemaVersion: "0.1.0", sampleId: "q", sceneId: "s", providerProfileId: "p", wavelengthNanometers: nm, wavelengthBasis: "resolved-wavelength",
          target: { kind: "environment-direction", outgoingDirectionUnitVector: { x: x / n, y: y / n, z: -distanceM / n } } } as never;
        expect(Object.is(fromMaterials.evaluateRadiance(request).spectralRadianceWattsPerSquareMeterSteradianNanometer,
          fromRadianceAt.evaluateRadiance(request).spectralRadianceWattsPerSquareMeterSteradianNanometer)).toBe(true);
        compared++;
      }
      expect(compared).toBe(window.width * window.height * offsets.length * nodes.length);
    }
  }, scaledTimeout(120_000));
});

describe("createIrradianceConvolutionRunner (#453)", () => {
  const geometry = { schemaVersion: "0.1.0" as const, width: 9, height: 7, kernelRadius: 2, patchWidth: 9, patchHeight: 7, boundary: "zero-outside-grid" as const };
  const kernel = (seed: number): Float64Array => { const k = Float64Array.from({ length: 25 }, (_, i) => ((i * 7 + seed) % 11) + 1); const sum = k.reduce((a, b) => a + b, 0); return k.map((w) => w / sum); };
  const samples = (seed: number): Float64Array => Float64Array.from({ length: 63 }, (_, i) => Math.abs(Math.sin(i * 1.7 + seed)) * 3.5);

  it("gives calculateIrradianceConvolution's values bit for bit on every call", () => {
    const run = createIrradianceConvolutionRunner(geometry);
    for (let s = 0; s < 6; s++) {
      const expected = calculateIrradianceConvolution({ ...geometry, samples: samples(s), kernels: kernel(s) }).values;
      expect(Array.from(run(samples(s), kernel(s))).every((v, i) => Object.is(v, expected[i]))).toBe(true);
    }
  });

  it("still checks every later call's arrays with the full validation's messages", () => {
    const run = createIrradianceConvolutionRunner(geometry);
    run(samples(0), kernel(0));
    const negative = samples(1); negative[5] = -1;
    const nan = kernel(1); nan[3] = NaN;
    const energy = kernel(1); energy[0]! += 0.5;
    for (const [s, k] of [[negative, kernel(1)], [samples(1), nan], [samples(1), energy], [samples(1).subarray(1), kernel(1)], [samples(1), new Float64Array(24)]] as const) {
      let expected = "";
      try { calculateIrradianceConvolution({ ...geometry, samples: s, kernels: k }); } catch (error) { expected = (error as Error).message; }
      expect(expected).not.toBe("");
      expect(() => run(s, k)).toThrow(InvalidConfigurationError);
      expect(() => run(s, k)).toThrow(expected);
    }
  });
});

describe("createIrradianceConvolutionInteriorRunner (#419)", () => {
  // Grids of several sizes and radii, including r = 0, a one-value interior and the 32-site limit.
  const shapes = [[9, 7, 2], [5, 5, 2], [6, 4, 0], [11, 3, 1], [70, 67, 32], [66, 96, 32]] as const;
  const kernel = (r: number, seed: number): Float64Array => {
    const k = Float64Array.from({ length: (2 * r + 1) ** 2 }, (_, i) => ((i * 7 + seed) % 11) + 1 + Math.sin(i + seed) * 0.3);
    const sum = k.reduce((a, b) => a + b, 0);
    return k.map((w) => w / sum);
  };
  const samples = (n: number, seed: number): Float64Array => Float64Array.from({ length: n }, (_, i) => Math.abs(Math.sin(i * 1.7 + seed)) * 3.5 * (i % 13 === 0 ? 0 : 1));
  const geometryOf = (width: number, height: number, r: number): Parameters<typeof createIrradianceConvolutionInteriorRunner>[0] => ({ schemaVersion: "0.1.0" as const, width, height, kernelRadius: r, patchWidth: width, patchHeight: height,
    boundary: "zero-outside-grid" as const });

  it("gives calculateIrradianceConvolution's interior values bit for bit on every call", () => {
    for (const [width, height, r] of shapes) {
      const geometry = geometryOf(width, height, r), run = createIrradianceConvolutionInteriorRunner(geometry), innerWidth = width - 2 * r;
      for (let s = 0; s < 3; s++) {
        const full = calculateIrradianceConvolution({ ...geometry, samples: samples(width * height, s), kernels: kernel(r, s) }).values;
        const interior = run(samples(width * height, s), kernel(r, s));
        expect(interior.length).toBe(innerWidth * (height - 2 * r));
        expect(Array.from(interior).every((v, i) => Object.is(v, full[(Math.floor(i / innerWidth) + r) * width + (i % innerWidth) + r]))).toBe(true);
      }
    }
  });

  it("validates every call as the runner does, with the full validation's messages", () => {
    const geometry = geometryOf(9, 7, 2), run = createIrradianceConvolutionInteriorRunner(geometry);
    const negative = samples(63, 1); negative[5] = -1;
    const nan = kernel(2, 1); nan[3] = NaN;
    const energy = kernel(2, 1); energy[0]! += 0.5;
    const cases = [[negative, kernel(2, 1)], [samples(63, 1), nan], [samples(63, 1), energy], [samples(63, 1).subarray(1), kernel(2, 1)], [samples(63, 1), new Float64Array(24)]] as const;
    // The first call is validated in full, every later one by its own arrays.
    for (const first of [true, false]) for (const [s, k] of cases) {
      const fresh = createIrradianceConvolutionInteriorRunner(geometry);
      if (!first) fresh(samples(63, 0), kernel(2, 0));
      let expected = "";
      try { calculateIrradianceConvolution({ ...geometry, samples: s, kernels: k }); } catch (error) { expected = (error as Error).message; }
      expect(expected).not.toBe("");
      expect(() => fresh(s, k)).toThrow(InvalidConfigurationError);
      expect(() => fresh(s, k)).toThrow(expected);
    }
    expect(() => createIrradianceConvolutionInteriorRunner({ ...geometry, kernelRadius: 33 })(samples(63, 0), kernel(33, 0))).toThrow(InvalidConfigurationError);
    run(samples(63, 0), kernel(2, 0));
  });

  it("refuses several patches and a grid without an interior", () => {
    expect(() => createIrradianceConvolutionInteriorRunner({ ...geometryOf(9, 7, 2), patchWidth: 4 })(samples(63, 0), new Float64Array(75).fill(0.01)))
      .toThrow("The interior convolution needs one patch");
    expect(() => createIrradianceConvolutionInteriorRunner(geometryOf(4, 7, 2))(samples(28, 0), kernel(2, 0))).toThrow("The interior convolution needs one patch");
  });
});
