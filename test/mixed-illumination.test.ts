// SPDX-License-Identifier: Apache-2.0
/**
 * #550: mixed lighting. Two or more sources blended across the chart (`illumination`): validation, a uniform blend equal to one
 * illuminant, a gradient's per-region chromaticity equal to its source's, the frame center's grey card and white balance, and the
 * display view (CPU) evaluating each site as the capture does, with the GPU refused and labelled.
 */
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, calculateEnvironmentSensorPhotoSignal, prepareDisplayView, simulateCapture, simulateIdealReference,
  type CalculateEnvironmentSensorPhotoSignalInput, type MixedIllumination, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createDiffractedPlanarProvider } from "../src/facade/diffraction-provider.js";
import { resolveMixedIllumination } from "../src/facade/mixed-illumination.js";
import { estimateCie1931ColorMatchingFunctions } from "../src/color/color-matching-functions.js";
import { buildPlanarSceneRadianceProvider, requireCallerScene, resolveCaptureIlluminant } from "../src/facade/scene-radiance.js";
import { resolveChartScene, type ChartScene } from "../src/facade/chart-scenes.js";
import { setDisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

const DAY = { kind: "planckian" as const, temperatureKelvin: 6500 }, LAMP = { kind: "cie-a" as const };
const GREY: SimulateCaptureOptions = { scene: { preset: "uniform", reflectance: 0.18 }, output: { width: 32, height: 16, format: "srgb-16", whiteBalance: { kelvin: 4500 } } };
/** Window daylight on the left, the lamp on the right, crossfading over the middle half of the frame. */
const GRADIENT: MixedIllumination = { sources: [{ illuminant: DAY, illuminanceLux: 8000 }, { illuminant: LAMP, illuminanceLux: 8000 }],
  blend: { kind: "linear-gradient", from: { u: -0.5, v: 0 }, to: { u: 0.5, v: 0 } } };
/** A small lamp 0.5 m in front of the chart center, 400 cd: 1600 lux on the axis. */
const FLASH = { illuminant: { kind: "planckian" as const, temperatureKelvin: 5500 }, position: { xM: 0, yM: 0, heightM: 0.5 }, intensity: { candela: 400 } };
const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
/** Linear RGB of output pixel (x, y). */
const pixel = (samples: ArrayLike<number>, width: number, x: number, y: number): number[] => [0, 1, 2].map((c) => decode(samples[(y * width + x) * 3 + c]!));

describe("mixed illumination (#550)", () => {
  it("validates the option and refuses what it cannot light", async () => {
    const bad: [unknown, RegExp][] = [
      [{ sources: [{ illuminant: DAY, illuminanceLux: 100 }] }, /two or more sources, or a point source/],
      [{ sources: [{ illuminant: DAY, illuminanceLux: 100 }], blend: { kind: "radial", radius: 1 }, points: [FLASH] }, /blend needs two or more sources/],
      [{ points: [{ ...FLASH, position: { xM: 0, yM: 0, heightM: 0 } }] }, /heightM must be positive/],
      [{ points: [{ ...FLASH, intensity: { candela: 10, illuminanceLux: 10, distanceM: 1 } }] }, /not both/],
      [{ points: [{ ...FLASH, intensity: { illuminanceLux: 10 } }] }, /distanceM must be positive/],
      [{ points: [] }, /1 to 8 point sources/],
      [{ ...GRADIENT, extra: 1 }, /Unknown illumination field/],
      [{ ...GRADIENT, blend: { kind: "linear-gradient", from: { u: 0, v: 0 }, to: { u: 0, v: 0 } } }, /must differ/],
      [{ ...GRADIENT, blend: { ...GRADIENT.blend, stops: [0.6, 0.4] } }, /non-decreasing/],
      [{ ...GRADIENT, blend: { ...GRADIENT.blend, stops: [0] } }, /one stop per source/],
      [{ ...GRADIENT, blend: { kind: "radial", radius: 0 } }, /radius must be positive/],
      [{ ...GRADIENT, blend: { kind: "regions", regions: [{ source: 2, uMin: -1, uMax: 0, vMin: -1, vMax: 1 }], outsideSource: 0 } }, /source index/],
      [{ ...GRADIENT, blend: { kind: "regions", regions: [{ source: 1, uMin: 1, uMax: 0, vMin: -1, vMax: 1 }], outsideSource: 0 } }, /must not exceed/],
      [{ ...GRADIENT, blend: { kind: "spot" } }, /blend.kind/],
      [{ ...GRADIENT, sources: [{ illuminant: DAY, illuminanceLux: -1 }, GRADIENT.sources![1]!] }, /Illuminance/]
    ];
    for (const [illumination, message] of bad) await expect(simulateCapture({ ...GREY, illumination: illumination as MixedIllumination })).rejects.toThrow(message);
    await expect(simulateCapture({ ...GREY, illumination: GRADIENT, illuminanceLux: 1000 })).rejects.toThrow(/replaces illuminant/);
    await expect(simulateCapture({ ...GREY, scene: { kind: "radiance-function", sceneId: "glow", evaluate: () => 0.01 }, illumination: GRADIENT })).rejects.toThrow(InvalidConfigurationError);
  });

  it("a uniform blend equals the single illuminant", async () => {
    const single = await simulateCapture({ ...GREY, scene: { preset: "siemens-star", cycles: 8 }, illuminant: LAMP, illuminanceLux: 3000 });
    const blends: MixedIllumination[] = [
      // One region over the whole frame: the lamp everywhere.
      { sources: [{ illuminant: LAMP, illuminanceLux: 3000 }, { illuminant: DAY, illuminanceLux: 9000 }], blend: { kind: "regions", regions: [{ source: 0, uMin: -2, uMax: 2, vMin: -2, vMax: 2 }], outsideSource: 1 } },
      // Two identical sources crossfaded.
      { sources: [{ illuminant: LAMP, illuminanceLux: 3000 }, { illuminant: LAMP, illuminanceLux: 3000 }], blend: { kind: "radial", radius: 0.7 } }
    ];
    for (const illumination of blends) {
      const mixed = await simulateCapture({ ...GREY, scene: { preset: "siemens-star", cycles: 8 }, illumination });
      let max = 0;
      for (let i = 0; i < single.image.samples.length; i++) max = Math.max(max, Math.abs(single.image.samples[i]! - mixed.image.samples[i]!));
      // The same light; the blend's own arithmetic ρ·(k·S)/π against ρ·k·S/π differs by an ulp at most, below one 16-bit code.
      expect(max).toBeLessThanOrEqual(1);
      expect(mixed.exposure).toEqual(single.exposure);
      expect(mixed.scene.sourceSha256).not.toBe(single.scene.sourceSha256);
    }
  }, testTimeout(60_000));

  it("a gradient's ends have their source's chromaticity and its middle the mean of the two", async () => {
    const [left, right, mixed] = await Promise.all([simulateIdealReference({ ...GREY, illuminant: DAY, illuminanceLux: 8000 }),
      simulateIdealReference({ ...GREY, illuminant: LAMP, illuminanceLux: 8000 }), simulateIdealReference({ ...GREY, illumination: GRADIENT })]);
    const width = 32;
    for (const y of [0, 7, 15]) {
      // u = -1 + (x + 0.5)/16: x ≤ 7 is left of u = -0.5 (daylight alone), x ≥ 24 right of u = 0.5 (the lamp alone).
      for (const x of [0, 3, 7]) expect(mixed.image.samples.slice((y * width + x) * 3, (y * width + x) * 3 + 3)).toEqual(left.image.samples.slice((y * width + x) * 3, (y * width + x) * 3 + 3));
      for (const x of [24, 28, 31]) expect(mixed.image.samples.slice((y * width + x) * 3, (y * width + x) * 3 + 3)).toEqual(right.image.samples.slice((y * width + x) * 3, (y * width + x) * 3 + 3));
      // x = 15 is u = -1/32: weights 0.53125 daylight and 0.46875 lamp; linear before the encoding.
      const m = pixel(mixed.image.samples, width, 15, y), a = pixel(left.image.samples, width, 15, y), b = pixel(right.image.samples, width, 15, y);
      for (const c of [0, 1, 2]) expect(Math.abs(m[c]! - (0.53125 * a[c]! + 0.46875 * b[c]!))).toBeLessThan(2e-4);
    }
    // The two ends differ visibly (daylight is bluer than the lamp under the same white balance).
    const l = pixel(mixed.image.samples, width, 0, 0), r = pixel(mixed.image.samples, width, 31, 0);
    expect(l[2]! / l[0]!).toBeGreaterThan(1.5 * r[2]! / r[0]!);
  }, testTimeout(60_000));

  it("white balance and the grey card take the frame center's light", async () => {
    // A lamp pool at the center (500 lux) inside bright daylight (20 000 lux): the center's strongest source is the lamp.
    const pool: MixedIllumination = { sources: [{ illuminant: LAMP, illuminanceLux: 500 }, { illuminant: DAY, illuminanceLux: 20000 }], blend: { kind: "radial", radius: 0.8, stops: [0.25, 1] } };
    const auto: SimulateCaptureOptions = { ...GREY, scene: { preset: "step-wedge" }, exposure: { mode: "aperture-priority", metering: "grey-card" }, output: { width: 32, height: 16 } };
    const [mixed, lamp] = await Promise.all([simulateCapture({ ...auto, illumination: pool }), simulateCapture({ ...auto, illuminant: LAMP, illuminanceLux: 500 })]);
    expect(mixed.exposure.settings).toEqual(lamp.exposure.settings);
    expect(mixed.exposure.greyCardDeviationStops).toBe(lamp.exposure.greyCardDeviationStops);
    const assumption = (r: { assumptions: readonly { id: string; value: unknown }[] }, id: string): unknown => r.assumptions.find((a) => a.id === id)?.value;
    expect(assumption(mixed, "exposure.meteringCard")).toEqual({ position: { u: 0, v: 0 }, illuminanceLux: 500 });
    expect(assumption(mixed, "scene.illumination")).toMatchObject({ coordinates: "frame", center: { illuminanceLux: 500, weights: [1, 0], strongestSource: 0 } });
    expect(assumption(lamp, "scene.illumination")).toBeUndefined();
    // Scene-average metering reads the whole frame, where the daylight dominates: a faster exposure than the lamp's.
    const average = await simulateCapture({ ...auto, exposure: { mode: "aperture-priority" }, illumination: pool });
    expect(average.exposure.settings.shutterSeconds).toBeLessThan(mixed.exposure.settings.shutterSeconds);
    // "scene-illuminant" white balance under the lamp: where the lamp alone lights the chart (the center) the pixels are the lamp-lit capture's.
    const balance: SimulateCaptureOptions = { ...GREY, output: { ...GREY.output, whiteBalance: "scene-illuminant" } };
    const [balanced, lampBalanced] = await Promise.all([simulateIdealReference({ ...balance, illumination: pool }), simulateIdealReference({ ...balance, illuminant: LAMP, illuminanceLux: 500 })]);
    expect(assumption(balanced, "output.whiteBalanceSource")).toEqual({ source: 0, illuminant: "cie-a" });
    const at = (r: typeof balanced): number[] => Array.from(r.image.samples.slice((8 * 32 + 16) * 3, (8 * 32 + 16) * 3 + 3));
    expect(at(balanced)).toEqual(at(lampBalanced));
    // An explicit white balance is used as given, with no source chosen.
    expect(assumption(await simulateCapture({ ...GREY, illumination: pool }), "output.whiteBalanceSource")).toBeUndefined();
  }, testTimeout(60_000));

  it("a point source falls off as I·cos θ/d² (inverse square and Lambert's cosine law)", async () => {
    const resolved = resolveMixedIllumination({ points: [FLASH] }, resolveCaptureIlluminant);
    expect(resolved.center.illuminanceLux).toBeCloseTo(1600, 9);
    // Its luminous irradiance, 683 ∫ E ȳ dλ (1 nm trapezoid, as the illuminance scale), at plane points 0, 0.5 and 1.2 m off the axis.
    const lux = (x: number, y: number): number => {
      let sum = 0;
      for (let nm = 380; nm <= 780; nm++) sum += (nm === 380 || nm === 780 ? 0.5 : 1) * resolved.irradianceAt(0, 0, x, y, nm) * estimateCie1931ColorMatchingFunctions(nm).y;
      return 683 * sum;
    };
    for (const [x, y] of [[0, 0], [0.5, 0], [0.3, -1.2]] as const) {
      const d2 = (x - FLASH.position.xM) ** 2 + (y - FLASH.position.yM) ** 2 + FLASH.position.heightM ** 2;
      expect(lux(x, y) / (400 * FLASH.position.heightM / d2 ** 1.5)).toBeCloseTo(1, 12);
    }
    // The same lamp given by its illuminance at a reference distance: 100 lux at 2 m is 400 cd.
    const reference = resolveMixedIllumination({ points: [{ ...FLASH, intensity: { illuminanceLux: 100, distanceM: 2 } }] }, resolveCaptureIlluminant);
    expect(reference.irradianceAt(0, 0, 0.7, 0.1, 555)).toBe(resolved.irradianceAt(0, 0, 0.7, 0.1, 555));
    // In a capture (noise-free reference, fixed white balance), a uniform card's linear pixels follow cos³θ across the frame.
    const options: SimulateCaptureOptions = { ...GREY, subjectDistanceM: 2, illumination: { points: [FLASH] } };
    const capture = await simulateIdealReference(options), half = capture.scene.framedWidthM / 2;
    const center = pixel(capture.image.samples, 32, 15, 8)[1]!, centerX = (-1 + 15.5 / 16) * half, y = (0.5 - 8.5 / 16) * half;
    for (const x of [0, 7, 28]) {
      const xM = (-1 + (x + 0.5) / 16) * half, cube = (xyz: number): number => (FLASH.position.heightM / Math.hypot(xyz, y, FLASH.position.heightM)) ** 3;
      expect(pixel(capture.image.samples, 32, x, 8)[1]! / center).toBeCloseTo(cube(xM) / cube(centerX), 3);
    }
  }, testTimeout(60_000));

  it("a point source mixes with the blend; white balance and the grey card follow the frame center", async () => {
    // Dim daylight (100 lux) and the lamp (1600 lux at the center): the lamp is strongest at the center.
    const illumination: MixedIllumination = { sources: [{ illuminant: DAY, illuminanceLux: 100 }], points: [FLASH] };
    const auto: SimulateCaptureOptions = { ...GREY, exposure: { mode: "aperture-priority", metering: "grey-card" }, output: { ...GREY.output, whiteBalance: "scene-illuminant" } };
    const mixed = await simulateCapture({ ...auto, illumination });
    const value = (id: string): unknown => mixed.assumptions.find((a) => a.id === id)?.value;
    expect(value("exposure.meteringCard")).toMatchObject({ illuminanceLux: 1700 });
    expect(value("output.whiteBalanceSource")).toEqual({ source: 1, illuminant: "planckian-5500K" });
    expect(value("scene.illumination")).toMatchObject({ blend: null, center: { illuminanceLux: 1700, illuminancesLux: [100, 1600], strongestSource: 1 } });
    // The grey card's exposure is the one a uniform 1700 lux gives.
    const flat = await simulateCapture({ ...auto, illuminant: FLASH.illuminant, illuminanceLux: 1700 });
    expect(mixed.exposure.settings).toEqual(flat.exposure.settings);
  }, testTimeout(60_000));

  it("regions use chart-local coordinates with a fixed-size chart", async () => {
    // Left half of a 2 mm chart under the lamp; the rest (the right half and the surround) in daylight.
    const regions: MixedIllumination = { sources: [{ illuminant: DAY, illuminanceLux: 8000 }, { illuminant: LAMP, illuminanceLux: 8000 }],
      blend: { kind: "regions", regions: [{ source: 1, uMin: -1, uMax: -0.001, vMin: -1, vMax: 1 }], outsideSource: 0 } };
    const options: SimulateCaptureOptions = { ...GREY, chartSize: { widthM: 0.002, surroundReflectance: 0.18 } };
    const [mixed, day, lamp] = await Promise.all([simulateIdealReference({ ...options, illumination: regions }), simulateIdealReference({ ...options, illuminant: DAY, illuminanceLux: 8000 }),
      simulateIdealReference({ ...options, illuminant: LAMP, illuminanceLux: 8000 })]);
    expect(mixed.assumptions.find((a) => a.id === "scene.illumination")?.value).toMatchObject({ coordinates: "chart-local" });
    const chartFraction = mixed.scene.chart!.frameWidthFraction, width = 32, sample = (r: typeof mixed, x: number): number[] => Array.from(r.image.samples.slice((8 * width + x) * 3, (8 * width + x) * 3 + 3));
    // A pixel centre on the chart's left half, one on its right half and one on the left surround.
    const onChart = (fraction: number): number => Math.floor(width / 2 + fraction * chartFraction * width / 2);
    expect(sample(mixed, onChart(-0.5))).toEqual(sample(lamp, onChart(-0.5)));
    expect(sample(mixed, onChart(0.5))).toEqual(sample(day, onChart(0.5)));
    if (chartFraction < 0.8) expect(sample(mixed, 0)).toEqual(sample(day, 0));
  }, testTimeout(60_000));

  it("a chart under a blend takes the tabulated RAW path, verified against the chain, with the chain's image", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "color-patches" }, illumination: GRADIENT, output: { width: 48, height: 32, format: "srgb-16" } };
    const tabulated = await simulateCapture(options);
    expect(tabulated.assumptions.find((a) => a.id === "raw.expectedSignal")?.value).toMatchObject({ method: "per-site-integrated-electrons" });
    setTabulatedNativeRawEnabled(false);
    let chain: Awaited<ReturnType<typeof simulateCapture>>;
    try { chain = await simulateCapture(options); } finally { setTabulatedNativeRawEnabled(true); }
    expect(chain.assumptions.find((a) => a.id === "raw.expectedSignal")).toBeUndefined();
    // The same expected electrons summed in another order (within 1e-9 relative) and the same seeded noise: equal codes but for rare ties.
    let differing = 0;
    for (let i = 0; i < chain.image.samples.length; i++) if (Math.abs(chain.image.samples[i]! - tabulated.image.samples[i]!) > 1) differing++;
    expect(differing).toBe(0);
  }, testTimeout(60_000));

  it("the display view evaluates each site exactly as the capture does, on the CPU", async () => {
    const cases: SimulateCaptureOptions[] = [
      { scene: { preset: "siemens-star", cycles: 12 }, illumination: GRADIENT, output: { width: 24, height: 16 } },
      { scene: { preset: "patches", patches: [{ patchId: "a", reflectance: 0.7 }, { patchId: "b", reflectance: 0.2 }], columns: 2 }, chartSize: { widthM: 0.002, surroundReflectance: 0.3 },
        lens: { diffraction: "circular-aperture" }, illumination: { ...GRADIENT, blend: { kind: "radial", radius: 0.6 } }, output: { width: 20, height: 16 } },
      { scene: { kind: "reflectance-function", sceneId: "rings", evaluate: (p) => 0.4 + 0.3 * Math.cos(40 * Math.hypot(p.u, p.v)) }, sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 } },
        illumination: { ...GRADIENT, blend: { kind: "regions", regions: [{ source: 1, uMin: 0, uMax: 1, vMin: -1, vMax: 1 }], outsideSource: 0 } }, output: { width: 16, height: 12 } },
      { scene: { preset: "slanted-edge", angleDegrees: 20 }, chartSize: { widthM: 1, surroundReflectance: 0.2 }, illumination: { ...GRADIENT, points: [{ ...FLASH, position: { xM: 0.4, yM: -0.2, heightM: 0.6 } }] },
        output: { width: 20, height: 14 } }
    ];
    for (const options of cases) {
      const capture = await simulateCapture(options), { result, signal } = await simulateDisplayViewWithInternals(options, { width: 4, height: 4, samplesPerAxis: 1 });
      expect(result.assumptions.find((a) => a.id === "view.illumination")).toBeDefined();
      const env = capture.request.environmentRaw.raw.exposure.geometry, nativeWidth = env.nativeRaster.pixelWidth, nativeHeight = env.nativeRaster.pixelHeight;
      // The capture's provider: the scene under the resolved blend (the facade's own geometry), with diffraction its object-space convolution.
      const light = resolveMixedIllumination(options.illumination, resolveCaptureIlluminant), size = options.chartSize, framedWidthM = capture.scene.framedWidthM;
      const aspect = capture.scene.framedHeightM / framedWidthM, heightM = size ? size.heightM ?? size.widthM * aspect : 0;
      const scene = "kind" in options.scene ? requireCallerScene(options.scene) : resolveChartScene({ scene: options.scene as ChartScene, aspect: size ? heightM / size.widthM : aspect });
      const base = buildPlanarSceneRadianceProvider({ scene, sceneId: "facade-scene", providerProfileId: "facade-provider", illuminant: light.sources[0]!.illuminant, irradianceScale: 1,
        geometry: { distanceM: capture.scene.distanceM, metresPerFrameUnit: framedWidthM / 2, ...(size ? { chart: { widthM: size.widthM, heightM, surroundReflectance: size.surroundReflectance! } } : {}) },
        evidence: [{ sourceOrigin: "photivra", sourceReference: "photivra:test", reuseStatus: "photivra-owned" }], limitations: [], irradianceAt: light.irradianceAt });
      const d = capture.request.diffraction;
      const provider = d ? createDiffractedPlanarProvider({ base, psf: d.psf.configuration.psf, wavelengthsNm: d.profile.profile.axes.wavelengthNm, kernelRadius: d.profile.kernelRadiusSamples,
        nativeWidth, nativeHeight, outputWidth: options.output!.width!, sitePitchMicrometers: 6, distanceM: capture.scene.distanceM, metresPerFrameUnit: framedWidthM / 2,
        ...(typeof options.sensor?.pixelAperture === "object" ? { queryOffsetsSites: [-0.25, 0.25].flatMap((y) => [-0.25, 0.25].map((x) => ({ x, y }))) } : {}) }) : base;
      for (let k = 0; k < 24; k++) {
        const index = (k * 7919 + 13) % (nativeWidth * nativeHeight), x = index % nativeWidth, y = Math.floor(index / nativeWidth);
        const environment = capture.request.siteInput(index).environment as unknown as Record<string, unknown>;
        const engine = (calculateEnvironmentSensorPhotoSignal({ ...environment, evaluateRadiance: provider.evaluateRadiance } as unknown as CalculateEnvironmentSensorPhotoSignalInput).value as unknown as { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } })
          .photo.value.photoSignal.expectedGeneratedElectronCount;
        // The view's portable illuminant formulas differ from the capture's by a few ulps (docs/DISPLAY_VIEW.md).
        expect(Math.abs(signal.site(x, y) - engine)).toBeLessThanOrEqual(1e-9 * engine + 1e-12);
      }
    }
  }, testTimeout(120_000));

  it("the GPU refuses mixed illumination with its reason and no device", async () => {
    const previous = setDisplayViewGpuRendererFactory(() => ({ id: "fake", supports: (): true => true, render: (): never => { throw new Error("not reached"); } }));
    try {
      const options: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, illumination: GRADIENT, output: { width: 24, height: 16 } };
      const { gpu } = createFakeGpu();
      const view = await (await prepareDisplayView(options, { gpu: "auto", gpuDevice: gpu })).render({ width: 12, height: 8 });
      expect(view.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
      expect(JSON.stringify(view.diagnostics.fast.execution)).toMatch(/mixed illumination \(#550\)/);
      await expect(prepareDisplayView(options, { gpu: "require", gpuDevice: gpu })).rejects.toThrow(/mixed illumination/);
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, testTimeout(60_000));
});
