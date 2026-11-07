// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, serializeSimulatedCaptureDngFromParts, simulateCapture,
  type SimulateCaptureDngPart, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { createDiffractedPlanarProvider } from "../src/facade/diffraction-provider.js";
import { createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { labelLayer } from "./helpers/chart-composite-fixtures.js";

/** A declared material-layers scene (#491, the app's chart form): a Siemens star under the label mask layer. */
const layeredScene = (aspect: number): SimulateCaptureOptions["scene"] =>
  ({ kind: "material-layers", sceneId: "test:defocus-layers", chart: { preset: "siemens-star", cycles: 16 }, layers: [labelLayer(aspect)] }) as SimulateCaptureOptions["scene"];

/*
 * #492 step 2a: lens.defocus out of focus in the capture, as an object-space convolution of the scene radiance on the
 * site lattice (alone, or combined per spectral node with lens.diffraction).
 */

const defocus = { model: "geometric-disc" } as const;
type DefocusValue = { diameterSites: number; kernelRadiusSites: number; execution: string; combinedWithDiffraction: boolean };
const defocusOf = (r: SimulateCaptureResult): DefocusValue => r.assumptions.find((a) => a.id === "lens.defocus")!.value as DefocusValue;

/** Area fraction of a disc of radius r (sites) on the side x < d of a line at signed distance d from its centre (circular segment). */
function segmentFraction(d: number, r: number): number {
  if (d >= r) return 1;
  if (d <= -r) return 0;
  return 0.5 + (d * Math.sqrt(r * r - d * d) + r * r * Math.asin(d / r)) / (Math.PI * r * r);
}

/** Expected photo electrons of one site's environment record with the given evaluators (the environment chain, noise-free). */
function electrons(environment: unknown, evaluators: object): number {
  return (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), ...evaluators } as never).value as unknown as
    { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
}

/** The facade's planar provider for a chart request (the same scene, framing and illuminant as the capture). */
function sharpProvider(r: SimulateCaptureResult, scene: SimulateCaptureOptions["scene"], aspect: number): ReturnType<typeof createPlanarSceneRadianceProvider> {
  return createPlanarSceneRadianceProvider({ scene: scene as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: r.scene.illuminant.illuminanceLux,
    distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect, sceneId: "facade-scene", providerProfileId: "facade-provider" });
}

/** Every spectral node the facade's environment can query (1 nm grid over 380–780 nm covers the sensor quadrature midpoints used here). */
function defocusedProvider(r: SimulateCaptureResult, sharp: ReturnType<typeof sharpProvider>, outputWidth: number, wavelengthsNm: number[]): ReturnType<typeof createDiffractedPlanarProvider> {
  const native = r.raw.plan.exposure.geometry.nativeRaster, kernel = createDefocusDiscSiteKernel(defocusOf(r).diameterSites)!;
  return createDiffractedPlanarProvider({ base: sharp, siteKernels: () => kernel.weights, wavelengthsNm, kernelRadius: kernel.radius, nativeWidth: native.pixelWidth,
    nativeHeight: native.pixelHeight, outputWidth, sitePitchMicrometers: 6, distanceM: r.scene.distanceM, metresPerFrameUnit: r.scene.framedWidthM / 2 });
}

describe("lens.defocus in the capture (#492 step 2a)", () => {
  it("renders the blur on the tabulated path, labelled as the geometric approximation with its execution", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "slanted-edge" }, subjectDistanceM: 2, output: { width: 24, height: 16 },
      lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8, defocus } };
    const blurred = await simulateCapture(options);
    const sharp = await simulateCapture({ ...options, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8 } });
    const value = defocusOf(blurred);
    expect(value).toMatchObject({ execution: "object-space-convolution", combinedWithDiffraction: false, kernelRadiusSites: 3 });
    expect(value.diameterSites).toBeCloseTo(5.952, 3);
    const explanation = blurred.assumptions.find((a) => a.id === "lens.defocus")!.explanation;
    expect(explanation).toMatch(/approximation/u);
    expect(explanation).toMatch(/Applied as an object-space convolution/u);
    expect(blurred.assumptions.find((a) => a.id === "raw.expectedSignal")!.value).toMatchObject({ method: "tabulated-expected-electrons" });
    expect(blurred.diagnostics.options).toEqual(["lens.defocus"]);
    expect(blurred.diagnostics.timingsMs.defocus).toBeGreaterThanOrEqual(0);
    expect(blurred.diagnostics.timingsMs.diffraction).toBeUndefined();
    expect((blurred.request.siteInput(0).environment as unknown as { psf: { kind: string; limitation: string } }).psf).toMatchObject({ kind: "not-applied",
      limitation: expect.stringMatching(/lens\.defocus/u) as unknown as string });
    // The blur spreads the edge: the sharp capture's mid row has a one-pixel transition, the blurred one several.
    const row = (r: SimulateCaptureResult): number[] => Array.from({ length: 24 }, (_, x) => r.image.samples[(8 * 24 + x) * 3 + 1]!);
    const transitions = (values: number[]): number => values.filter((v) => v > values[0]! + 8 && v < values[23]! - 8).length;
    expect(transitions(row(sharp))).toBeLessThanOrEqual(1);
    expect(transitions(row(blurred))).toBeGreaterThanOrEqual(3);
  });

  it("renders a material-layers scene as its callerScene, byte for byte, with defocus", async () => {
    const { resolveChartMaterialLayers } = await import("../src/facade/chart-material-layers.js");
    const scene = layeredScene(24 / 32), lens = { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8, defocus };
    const layered = await simulateCapture({ scene, subjectDistanceM: 2, lens, output: { width: 32, height: 24, format: "png" } });
    const direct = await simulateCapture({ scene: resolveChartMaterialLayers({ scene: scene as never, aspect: 24 / 32 }).callerScene as never, subjectDistanceM: 2, lens,
      output: { width: 32, height: 24, format: "png" } });
    expect(defocusOf(layered).execution).toBe("object-space-convolution");
    expect(layered.assumptions.some((a) => a.id === "raw.expectedSignal")).toBe(true);
    expect(Buffer.from(layered.image.png!).equals(Buffer.from(direct.image.png!))).toBe(true);
  }, scaledTimeout(60_000));

  it("is the same RAW on the tabulated path and the environment path (chart scenes)", async () => {
    for (const options of [
      { scene: { preset: "slanted-edge" }, subjectDistanceM: 2, output: { width: 16, height: 12 }, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8, defocus } },
      { scene: { preset: "siemens-star" }, subjectDistanceM: 2, output: { width: 16, height: 12 }, lens: { focalLengthMm: 50, fNumber: 8, focusDistanceM: 1.6, defocus, diffraction: "circular-aperture" },
        sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" }, spectralStepNanometers: 40 } }
    ] as SimulateCaptureOptions[]) {
      const tabulated = await simulateCapture(options);
      setTabulatedNativeRawEnabled(false);
      let environment: SimulateCaptureResult;
      try { environment = await simulateCapture(options); } finally { setTabulatedNativeRawEnabled(true); }
      expect(tabulated.assumptions.some((a) => a.id === "raw.expectedSignal")).toBe(true);
      expect(environment.assumptions.some((a) => a.id === "raw.expectedSignal")).toBe(false);
      expect(Array.from(tabulated.raw.codes)).toEqual(Array.from(environment.raw.codes));
    }
  }, scaledTimeout(120_000));

  it("with lens.diffraction applies each node's diffraction kernel convolved with the disc, labelled as a further approximation", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "slanted-edge" }, subjectDistanceM: 2, output: { width: 16, height: 12 },
      lens: { focalLengthMm: 50, fNumber: 16, focusDistanceM: 1.6, defocus, diffraction: "circular-aperture" } };
    const r = await simulateCapture(options);
    const value = defocusOf(r), diffraction = r.request.diffraction!;
    expect(value.combinedWithDiffraction).toBe(true);
    expect(diffraction.execution).toBe("object-space-convolution");
    expect(r.assumptions.find((a) => a.id === "lens.defocus")!.explanation).toMatch(/not exactly the in-focus Airy pattern convolved with the geometric disc/u);
    expect(r.diagnostics.options).toEqual(["lens.diffraction", "lens.defocus"]);
    expect(r.diagnostics.timingsMs.defocus).toBeGreaterThanOrEqual(0);
    expect(r.diagnostics.timingsMs.diffraction).toBeUndefined();
    // The combination differs from defocus alone and from diffraction alone.
    const alone = await simulateCapture({ ...options, lens: { focalLengthMm: 50, fNumber: 16, focusDistanceM: 1.6, defocus } });
    const diffracted = await simulateCapture({ ...options, lens: { focalLengthMm: 50, fNumber: 16, focusDistanceM: 1.6, diffraction: "circular-aperture" } });
    expect(Array.from(r.raw.codes)).not.toEqual(Array.from(alone.raw.codes));
    expect(Array.from(r.raw.codes)).not.toEqual(Array.from(diffracted.raw.codes));
  }, scaledTimeout(60_000));

  it("takes the image-space path (#548) when rotation, a field mapping or vignetting moves the scene points off the plane lattice", async () => {
    const base: SimulateCaptureOptions = { scene: { preset: "slanted-edge" }, subjectDistanceM: 2, output: { width: 8, height: 8 }, sensor: { spectralStepNanometers: 80, temporalSampleCount: 2 } };
    const lens = { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8, defocus };
    for (const extra of [{ motion: { angularVelocityRadPerSec: { yaw: 0.01 } } },
      { lens: { ...lens, distortion: { kind: "radial", profile: { normalizationRadiusMm: 0.1, maximumNormalizedRadius: 1, coefficients: { k1: -0.2, k2: 0, k3: 0 } } } } },
      { lens: { ...lens, vignetting: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { r2: -0.3, r4: 0, r6: 0 } } } }]) {
      expect(defocusOf(await simulateCapture({ ...base, lens, ...extra } as SimulateCaptureOptions)).execution).toBe("image-space-convolution");
    }
    // In focus each of them renders as without lens.defocus (test/simulate-capture-defocus-optics.test.ts covers the others).
    const rotating = { ...base, motion: { angularVelocityRadPerSec: { yaw: 0.01 } }, sensor: { temporalSampleCount: 2 } } as SimulateCaptureOptions;
    const plain = await simulateCapture({ ...rotating, lens: { focalLengthMm: 50, fNumber: 4 } });
    const focused = await simulateCapture({ ...rotating, lens: { focalLengthMm: 50, fNumber: 4, defocus } });
    expect(Array.from(focused.raw.codes)).toEqual(Array.from(plain.raw.codes));
  }, scaledTimeout(60_000));
});

describe("lens.defocus parts, strips, regions and DNG parts equal the whole frame (#492 step 2a)", () => {
  type Region = { x: number; y: number; width: number; height: number };
  const cases: [string, SimulateCaptureOptions][] = [
    ["defocus alone, chart (tabulated)", { scene: { preset: "siemens-star", cycles: 16 }, subjectDistanceM: 2, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8, defocus },
      output: { width: 32, height: 24 } }],
    ["defocus with diffraction and the Quality filters", { scene: { preset: "siemens-star", cycles: 16 }, subjectDistanceM: 2,
      lens: { focalLengthMm: 50, fNumber: 11, focusDistanceM: 1.7, defocus, diffraction: "circular-aperture" },
      sensor: { antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: 32, height: 24, demosaic: "ahd" } }],
    ["defocus with diffraction, a material-layers scene (the app's chart form, tabulated)", { scene: layeredScene(24 / 32), subjectDistanceM: 2,
      lens: { focalLengthMm: 50, fNumber: 8, focusDistanceM: 1.7, defocus, diffraction: "circular-aperture" },
      sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: 32, height: 24 } }],
    ["defocus alone, caller reflectance function (environment path)", { scene: { kind: "reflectance-function", sceneId: "defocus-parts", evaluate: ({ u, v }: { u: number; v: number }): number =>
      (u + 0.3 * v > 0 ? 0.6 : 0.2) } as never, subjectDistanceM: 2, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8, defocus }, output: { width: 32, height: 24 } }]
  ];
  const regions: Region[] = [{ x: 10, y: 8, width: 12, height: 8 }, { x: 0, y: 0, width: 7, height: 5 }, { x: 25, y: 19, width: 7, height: 5 },
    { x: 31, y: 0, width: 1, height: 24 }, { x: 0, y: 13, width: 32, height: 1 }];
  for (const [name, options] of cases) {
    it(name, async () => {
      const whole = await simulateCapture(options);
      expect(defocusOf(whole).execution).toBe("object-space-convolution");
      const nativeWidth = whole.plan.exposure.geometry.nativeRaster.pixelWidth;
      for (const region of regions) {
        const part = await simulateCapture({ ...options, output: { ...options.output, region } });
        const rect = part.region!.nativeRect, samples: number[] = [], codes: number[] = [];
        for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width * 3; x++) samples.push(whole.image.samples[((region.y + y) * 32 + region.x) * 3 + x]!);
        for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) codes.push(whole.raw.codes[(rect.y + y) * nativeWidth + rect.x + x]!);
        expect(Array.from(part.image.samples)).toEqual(samples);
        expect(Array.from(part.raw.codes)).toEqual(codes);
      }
      // The whole-frame DNG from 2 × 2 parts is the whole-frame DNG's bytes.
      const dngOptions = { ...options, output: { ...options.output, format: "dng" as const } };
      const parts: SimulateCaptureDngPart[] = [];
      for (const [x, y] of [[0, 0], [16, 0], [0, 12], [16, 12]] as const) {
        const part = await simulateCapture({ ...options, output: { ...options.output, region: { x, y, width: 16, height: 12 } } });
        parts.push({ raw: part.raw, region: part.region! });
      }
      const joined = await serializeSimulatedCaptureDngFromParts(dngOptions, parts);
      const direct = await simulateCapture(dngOptions);
      expect(Buffer.from(joined.bytes).equals(Buffer.from(direct.image.dng!))).toBe(true);
    }, scaledTimeout(240_000));
  }
});

describe("lens.defocus against the analytic edge-spread function and the ray reference (#492 step 2a)", () => {
  // The environment chain is evaluated directly (noise-free expected electrons) where the test says so.
  const wavelengths = Array.from({ length: 401 }, (_, i) => 380 + i);

  it("a vertical edge between lattice columns gives the exact circular-segment fraction (relative 1e-12)", async () => {
    // Edge at u = 0 (angle 0): an even native width puts it halfway between two lattice columns, so the disc's cells left of
    // a column boundary are exactly the disc left of that line, and each site sees E_dark + (E_light − E_dark)·F.
    const scene = { preset: "slanted-edge", angleDegrees: 0 } as const;
    for (const focusDistanceM of [1.8, 1.6, 2.4]) {
      const options: SimulateCaptureOptions = { scene, subjectDistanceM: 2, output: { width: 32, height: 4 }, sensor: { spectralStepNanometers: 80 },
        lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM, defocus } };
      const r = await simulateCapture(options);
      const native = r.raw.plan.exposure.geometry.nativeRaster, W = native.pixelWidth;
      expect(W % 2).toBe(0);
      const sharp = sharpProvider(r, scene, 4 / 32), blurred = defocusedProvider(r, sharp, 32, wavelengths), radius = defocusOf(r).diameterSites / 2;
      expect(defocusOf(r).kernelRadiusSites).toBeGreaterThan(2);
      const y = 2, at = (x: number, provider: typeof sharp | typeof blurred): number => electrons(r.request.siteInput(y * W + x).environment, { evaluateRadiance: provider.evaluateRadiance.bind(provider) });
      let largest = 0;
      for (let x = 0; x < W; x++) {
        // Same CFA phase on the far left (dark) and far right (light).
        const dark = at(x % 2, sharp), light = at(W - 2 + (x % 2), sharp);
        // Light where (site − t)·x ≥ 0; the light fraction of the disc is the part left of the line at the site's offset from the edge.
        const expected = dark + (light - dark) * segmentFraction(x + 0.5 - W / 2, radius);
        largest = Math.max(largest, Math.abs(at(x, blurred) - expected) / expected);
      }
      expect(largest).toBeLessThan(1e-12);
    }
  }, scaledTimeout(60_000));

  it("a slanted-edge capture's averaged edge profile follows the disc's closed-form edge-spread function", async () => {
    // Noise averaged over many rows (a super-resolved edge profile, as in the slanted-edge method): the RAW codes of both green
    // phases, binned by the site's signed distance from the edge in quarter sites and normalized by the two plateaus, against the
    // mean of the closed-form F over the same sites (so the bin width does not enter the comparison).
    const scene = { preset: "slanted-edge", angleDegrees: 5 } as const;
    const options: SimulateCaptureOptions = { scene, subjectDistanceM: 2, output: { width: 48, height: 480 }, sensor: { spectralStepNanometers: 80 },
      lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.6, defocus }, exposure: { mode: "aperture-priority" } };
    const r = await simulateCapture(options);
    const geometry = r.raw.plan.exposure.geometry, W = geometry.nativeRaster.pixelWidth, H = geometry.nativeRaster.pixelHeight, radius = defocusOf(r).diameterSites / 2;
    expect(defocusOf(r).kernelRadiusSites).toBe(7);
    const t = 5 * Math.PI / 180, bins = new Map<number, { code: number; fraction: number; count: number }>();
    let dark = 0, darkCount = 0, light = 0, lightCount = 0;
    for (let y = 0; y < H; y++) for (let x = (y + 1) % 2; x < W; x += 2) {
      // Green sites (x + y odd). Signed distance (sites) from the edge u·cos t − v·sin t = 0, positive on the light side.
      const d = (x + 0.5 - W / 2) * Math.cos(t) + (y + 0.5 - H / 2) * Math.sin(t), code = r.raw.codes[y * W + x]! - r.raw.blackLevels[y * W + x]!;
      expect(r.raw.saturationFlags[y * W + x]).toBe(0);
      if (d < -radius - 2) { dark += code; darkCount++; } else if (d > radius + 2) { light += code; lightCount++; }
      const bin = Math.round(d * 4) / 4, entry = bins.get(bin) ?? { code: 0, fraction: 0, count: 0 };
      // The light part of a disc centred on the site: the disc beyond the line at −d, F(d).
      entry.code += code; entry.fraction += segmentFraction(d, radius); entry.count++; bins.set(bin, entry);
    }
    dark /= darkCount; light /= lightCount;
    // The plateaus are the chart's 4:1 reflectances (dark 0.15, light 0.6), up to noise.
    expect(light / dark).toBeGreaterThan(3.9);
    expect(light / dark).toBeLessThan(4.1);
    let largest = 0, compared = 0;
    for (const [d, { code, fraction, count }] of bins) {
      if (Math.abs(d) > radius + 1) continue;
      expect(count).toBeGreaterThanOrEqual(40);
      largest = Math.max(largest, Math.abs((code / count - dark) / (light - dark) - fraction / count));
      compared++;
    }
    expect(compared).toBeGreaterThan(50);
    // Measured 0.0093 of the light–dark step over 61 bins of about 80 sites (noise and the lattice's point sampling of the edge; noise seed 1).
    expect(largest).toBeLessThan(0.015);
  }, scaledTimeout(120_000));

  it("pupil-ray sampling converges toward the continuous disc integral; the lattice convolution differs from it by its point sampling of the edge", async () => {
    // Small frame, 6-site disc. Recorded (#492 step 2a; max and RMS relative difference over every native site):
    //   convolution vs continuous disc integral  0.112 / 0.026  (point aperture)
    //   rays 4×8:   vs convolution 0.151 / 0.033, vs continuous 0.089 / 0.021
    //   rays 8×16:  vs convolution 0.109 / 0.027, vs continuous 0.023 / 0.0049
    //   rays 16×16: vs convolution 0.120 / 0.027, vs continuous 0.018 / 0.0035
    const scene = { preset: "slanted-edge" } as const, ow = 16, oh = 12;
    const common = { scene, output: { width: ow, height: oh }, subjectDistanceM: 2, sensor: { spectralStepNanometers: 80 }, exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } } as const;
    const lens = { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8 };
    const def = await simulateCapture({ ...common, lens: { ...lens, defocus } });
    const native = def.raw.plan.exposure.geometry.nativeRaster, W = native.pixelWidth, H = native.pixelHeight, N = W * H, radius = defocusOf(def).diameterSites / 2;
    const sharp = sharpProvider(def, scene, oh / ow), blurred = defocusedProvider(def, sharp, ow, wavelengths);
    const conv = Array.from({ length: N }, (_, i) => electrons(def.request.siteInput(i).environment, { evaluateRadiance: blurred.evaluateRadiance.bind(blurred) }));
    const point = Array.from({ length: N }, (_, i) => electrons(def.request.siteInput(i).environment, { evaluateRadiance: sharp.evaluateRadiance.bind(sharp) }));
    // Continuous disc integral of the edge: per CFA phase, the dark and light plateaus mixed by the segment fraction.
    const t = 5 * Math.PI / 180, phase = (i: number): number => (Math.floor(i / W) % 2) * 2 + (i % W) % 2;
    const lo = [Infinity, Infinity, Infinity, Infinity], hi = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) { lo[phase(i)] = Math.min(lo[phase(i)]!, point[i]!); hi[phase(i)] = Math.max(hi[phase(i)]!, point[i]!); }
    const continuous = Array.from({ length: N }, (_, i) => {
      const d = (i % W + 0.5 - W / 2) * Math.cos(t) + (Math.floor(i / W) + 0.5 - H / 2) * Math.sin(t);
      return lo[phase(i)]! + (hi[phase(i)]! - lo[phase(i)]!) * segmentFraction(d, radius);
    });
    const stats = (values: number[], reference: number[]): { max: number; rms: number } => {
      let max = 0, ss = 0;
      for (let i = 0; i < N; i++) { const d = (values[i]! - reference[i]!) / reference[i]!; max = Math.max(max, Math.abs(d)); ss += d * d; }
      return { max, rms: Math.sqrt(ss / N) };
    };
    const convolution = stats(conv, continuous);
    expect(convolution.max).toBeLessThan(0.12);
    expect(convolution.rms).toBeLessThan(0.03);
    const rays: { max: number; rms: number }[] = [];
    for (const [radialSamples, angularSamples] of [[4, 8], [8, 16], [16, 16]] as const) {
      const ray = await simulateCapture({ ...common, lens: { ...lens, pupilSampling: { radialSamples, angularSamples } } });
      const values = Array.from({ length: N }, (_, i) => electrons(ray.request.siteInput(i).environment,
        { evaluateRadiance: sharp.evaluateRadiance.bind(sharp), evaluateApertureRadiance: sharp.evaluateApertureRadiance.bind(sharp) }));
      rays.push(stats(values, continuous));
      // Away from the edge the ray result, the convolution and the continuous integral agree.
      for (let i = 0; i < N; i++) if (Math.abs((i % W + 0.5 - W / 2) * Math.cos(t) + (Math.floor(i / W) + 0.5 - H / 2) * Math.sin(t)) > radius + 1) {
        expect(Math.abs(values[i]! - conv[i]!) / conv[i]!).toBeLessThan(1e-9);
      }
    }
    // The rays converge toward the continuous integral as they increase (RMS strictly decreasing, last below 0.5 %).
    expect(rays[1]!.rms).toBeLessThan(rays[0]!.rms);
    expect(rays[2]!.rms).toBeLessThan(rays[1]!.rms);
    expect(rays[2]!.rms).toBeLessThan(0.005);
  }, scaledTimeout(180_000));
});
