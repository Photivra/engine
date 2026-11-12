// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it } from "vitest";

import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, prepareDisplayView, prepareQualityPaths, serializeSimulatedCaptureDngFromParts, simulateCapture,
  type SimulateCaptureDngPart, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { createDiffractedPlanarProvider } from "../src/facade/diffraction-provider.js";
import { createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import { createDisplayViewExpectedSignal, type DisplayViewExpectedSignalInput } from "../src/facade/expected-signal.js";
import { convolveSiteKernels, createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import { siteKernelRuns } from "../src/optics/site-kernel-runs.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";
import { displayViewQualityGpuUnsupportedReason } from "../src/gpu/display-view-quality-gpu.js";
import { displayViewSpeedGpuUnsupportedReason } from "../src/gpu/display-view-speed-gpu.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #564: defocus kernels above the direct radius (64 sites) are convolved by runs. The runs are the direct gather regrouped,
 * so each path (object-space and image-space providers, the tabulated expected signal) is compared with the direct gather of
 * the same disc on the same scene, and the whole capture with the analytic edge-spread function, the environment path,
 * regions and DNG parts. Requests at or below 64 sites keep the direct gather (their hash locks hold elsewhere).
 */

const defocus = { model: "geometric-disc" } as const;
type DefocusValue = { diameterSites: number; kernelRadiusSites: number; execution: string; convolution?: string };
const defocusOf = (r: SimulateCaptureResult): DefocusValue => r.assumptions.find((a) => a.id === "lens.defocus")!.value as DefocusValue;

/** A small Gaussian-like diffraction stand-in of radius 2 (unit sum), the same at every node: only the order of application is tested. */
function smallKernel(): Float64Array {
  const w = new Float64Array(25);
  let sum = 0;
  for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const value = Math.exp(-(u * u + v * v) / 2); w[(v + 2) * 5 + u + 2] = value; sum += value; }
  for (let k = 0; k < 25; k++) w[k]! /= sum;
  return w;
}

/** A Siemens-star-like radiance scene with sharp sectors and a mild spectral slope (frame units). */
const star = (u: number, v: number, nm: number): number => ((Math.floor((Math.atan2(v, u) + Math.PI) / (Math.PI / 8)) % 2 === 0 ? 0.9 : 0.05) * (1 + (nm - 550) / 1000));
const planar = (radianceAt: (u: number, v: number, nm: number) => number): never => ({ sceneId: "s", providerProfileId: "p", radianceAt,
  evaluateRadiance: () => ({}), evaluateApertureRadiance: () => { throw new Error("unused"); } }) as never;

function worstRelative(a: (i: number, j: number) => number, b: (i: number, j: number) => number, points: readonly (readonly [number, number])[]): number {
  let worst = 0;
  for (const [i, j] of points) { const x = a(i, j), y = b(i, j); worst = Math.max(worst, Math.abs(x - y) / Math.max(Math.abs(y), 1e-300)); }
  return worst;
}

describe("the run convolution equals the direct gather of the same disc on each path (#564)", () => {
  // #594: the providers below are called directly; a capture loads their on-demand code where it parses the request.
  beforeAll(() => prepareQualityPaths());
  const disc = createDefocusDiscSiteKernel(141.3)!, R = disc.radius, runs = siteKernelRuns(disc.weights, R), W = 40, H = 30, wavelengthsNm = [500, 600];
  const points = Array.from({ length: 60 }, (_, k) => [(k * 7) % W, (k * 11) % H] as const);

  it("object-space provider, alone and with a diffraction kernel after the disc", () => {
    expect(R).toBe(71);
    const common = { base: planar(star), wavelengthsNm, nativeWidth: W, nativeHeight: H, outputWidth: W, sitePitchMicrometers: 6, distanceM: 2, metresPerFrameUnit: 0.01 };
    const g = 2 / W, valueOf = (provider: ReturnType<typeof createDiffractedPlanarProvider>, nm: number) => (i: number, j: number): number => {
      // The ray that the provider maps to lattice point (i, j): plane point (u, v) at distance 2 m.
      const u = (i + 0.5 - W / 2) * g, v = -(j + 0.5 - H / 2) * g, x = u * 0.01, y = v * 0.01, length = Math.hypot(x, y, 2);
      return provider.evaluateRadiance({ target: { outgoingDirectionUnitVector: { x: -x / length, y: -y / length, z: -2 / length } }, wavelengthNanometers: nm } as never)
        .spectralRadianceWattsPerSquareMeterSteradianNanometer;
    };
    const direct = createDiffractedPlanarProvider({ ...common, siteKernels: () => disc.weights, kernelRadius: R });
    const large = createDiffractedPlanarProvider({ ...common, siteKernels: () => disc.weights, kernelRadius: R, largeKernel: { runs } });
    for (const nm of wavelengthsNm) expect(worstRelative(valueOf(large, nm), valueOf(direct, nm), points)).toBeLessThan(1e-12);
    const k = smallKernel(), combined = convolveSiteKernels(k, 2, disc.weights, R);
    const directD = createDiffractedPlanarProvider({ ...common, siteKernels: () => combined, kernelRadius: R + 2 });
    const largeD = createDiffractedPlanarProvider({ ...common, siteKernels: () => combined, kernelRadius: R + 2, largeKernel: { runs, diffraction: { radius: 2, kernelAt: () => k } } });
    expect(worstRelative(valueOf(largeD, 600), valueOf(directD, 600), points)).toBeLessThan(1e-12);
  });

  it("image-space provider with vignetting (the samples carry each point's field factor)", () => {
    const geometry = prepareDefocusImageSpaceGeometry({ focalLengthMm: 50, focusDistanceM: 1.8, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 },
      vignetting: { normalizationRadiusMm: 2, maximumNormalizedRadius: 1, coefficients: { r2: -0.3, r4: 0, r6: 0 } } as never });
    const common = { base: planar(star), geometry, wavelengthsNm, nativeWidth: W, nativeHeight: H, sitePitchMicrometers: 6, distanceM: 2, metresPerFrameUnit: 0.01, siteKernels: (): Float64Array => disc.weights, kernelRadius: R };
    const direct = createDefocusImageSpaceProvider(common), large = createDefocusImageSpaceProvider({ ...common, largeKernel: { runs } });
    const valueOf = (provider: typeof direct) => (i: number, j: number): number => {
      const look = geometry.lookOf((i + 0.5 - W / 2) * 0.006, (j + 0.5 - H / 2) * 0.006, 0);
      return provider.evaluateRadiance({ target: { outgoingDirectionUnitVector: { x: -look.x, y: -look.y, z: -look.z } }, wavelengthNanometers: 500, timeSecondsFromExposureStart: 0 } as never)
        .spectralRadianceWattsPerSquareMeterSteradianNanometer;
    };
    expect(worstRelative(valueOf(large), valueOf(direct), points)).toBeLessThan(1e-12);
  });

  it("tabulated expected signal: the disc after each channel's in-focus signal equals the combined kernels, with and without diffraction", () => {
    const nodes = wavelengthsNm.length, white = Float64Array.from([1.2, 0.9]);
    const scene = { kind: "materials" as const, materialAt: (u: number, v: number): number => (Math.floor((Math.atan2(v, u) + Math.PI) / (Math.PI / 8)) % 2 === 0 ? 0 : (u > 0.3 ? 2 : 1)),
      materials: [{ neutral: 0.9 }, { neutral: 0.05 }, { radiance: Float64Array.from([0.3, 0.6]) }], whiteRadiance: white };
    const base: Omit<DisplayViewExpectedSignalInput, "kernels"> = { nativeWidth: W, nativeHeight: H, outputWidth: W, wavelengthsNm,
      electronsPerRadiance: [Float64Array.from([0.1, 2]), Float64Array.from([1, 1]), Float64Array.from([2, 0.1])],
      offsets: [{ x: -0.25, y: -0.25, weight: 0.25 }, { x: 0.25, y: -0.25, weight: 0.25 }, { x: -0.25, y: 0.25, weight: 0.25 }, { x: 0.25, y: 0.25, weight: 0.25 }],
      scene, channelAt: (x, y) => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2)) };
    const unit = Float64Array.of(1), k = smallKernel();
    const cases: [DisplayViewExpectedSignalInput, DisplayViewExpectedSignalInput][] = [
      [{ ...base, kernels: { radius: R, perNode: Array.from({ length: nodes }, () => disc.weights) } }, { ...base, kernels: { radius: 0, perNode: [unit, unit] }, largeKernel: runs }],
      [{ ...base, kernels: { radius: R + 2, perNode: Array.from({ length: nodes }, () => convolveSiteKernels(k, 2, disc.weights, R)) } },
        { ...base, kernels: { radius: 2, perNode: [k, k] }, largeKernel: runs }]
    ];
    for (const [directInput, largeInput] of cases) {
      const direct = createDisplayViewExpectedSignal(directInput), large = createDisplayViewExpectedSignal(largeInput);
      // Relative to each site: the prefix differences carry a few ulps of the tile row's prefix, so dark sites next to bright
      // ones see the largest relative difference (still within 1e-12).
      expect(worstRelative((i, j) => large.site(i, j), (i, j) => direct.site(i, j), points)).toBeLessThan(1e-12);
      // A second signal of the same input reads the kept tiles: the same values, no new lookups.
      const again = createDisplayViewExpectedSignal(largeInput);
      expect(again.site(3, 4)).toBe(large.site(3, 4));
      expect(again.lookups).toBe(0);
      expect(large.uniformMaterial).toBe(-1);
    }
  });
});

describe("simulateCapture with a large disc (#564)", () => {
  // 50 mm f/4 on a plane at 2 m focused at 0.298 m: about 357 sites across at 6 µm, kernel radius 179 (the owner's disc size).
  const lens = { focalLengthMm: 50, fNumber: 4, focusDistanceM: 0.298, defocus };

  it("a vertical edge between lattice columns gives the exact circular-segment fraction (relative 1e-12) at radius 179", async () => {
    const scene = { preset: "slanted-edge", angleDegrees: 0 } as const;
    const options: SimulateCaptureOptions = { scene, subjectDistanceM: 2, output: { width: 32, height: 4 }, sensor: { spectralStepNanometers: 80 }, lens };
    const r = await simulateCapture(options);
    expect(defocusOf(r)).toMatchObject({ kernelRadiusSites: 179, execution: "object-space-convolution", convolution: "runs" });
    expect(r.assumptions.find((a) => a.id === "lens.defocus")!.explanation).toMatch(/convolved by runs \(#564\)/u);
    const native = r.raw.plan.exposure.geometry.nativeRaster, W = native.pixelWidth, radius = defocusOf(r).diameterSites / 2;
    const sharp = createPlanarSceneRadianceProvider({ scene: scene as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: r.scene.illuminant.illuminanceLux,
      distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: 4 / 32, sceneId: "facade-scene", providerProfileId: "facade-provider" });
    const kernel = createDefocusDiscSiteKernel(defocusOf(r).diameterSites)!;
    const blurred = createDiffractedPlanarProvider({ base: sharp, siteKernels: () => kernel.weights, wavelengthsNm: Array.from({ length: 401 }, (_, i) => 380 + i), kernelRadius: kernel.radius,
      nativeWidth: W, nativeHeight: native.pixelHeight, outputWidth: 32, sitePitchMicrometers: 6, distanceM: r.scene.distanceM, metresPerFrameUnit: r.scene.framedWidthM / 2,
      largeKernel: { runs: siteKernelRuns(kernel.weights, kernel.radius) } });
    const at = (x: number, provider: typeof sharp): number => (calculateEnvironmentSensorPhotoSignal({ ...(r.request.siteInput(2 * W + x).environment as object),
      evaluateRadiance: provider.evaluateRadiance.bind(provider) } as never).value as unknown as { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } })
      .photo.value.photoSignal.expectedGeneratedElectronCount;
    const segment = (d: number): number => d >= radius ? 1 : d <= -radius ? 0 : 0.5 + (d * Math.sqrt(radius * radius - d * d) + radius * radius * Math.asin(d / radius)) / (Math.PI * radius * radius);
    // The frame is narrower than the disc, so the light and dark levels are those of the unblurred provider at the frame's ends.
    let largest = 0;
    for (let x = 0; x < W; x++) {
      const dark = at(x % 2, sharp), light = at(W - 2 + (x % 2), sharp), expected = dark + (light - dark) * segment(x + 0.5 - W / 2);
      largest = Math.max(largest, Math.abs(at(x, blurred as never) - expected) / expected);
    }
    expect(largest).toBeLessThan(1e-12);
  }, scaledTimeout(120_000));

  it("is the same RAW on the tabulated path and the environment path, with and without diffraction and the Quality filters", async () => {
    for (const options of [
      { scene: { preset: "siemens-star" }, subjectDistanceM: 2, output: { width: 16, height: 12 }, sensor: { spectralStepNanometers: 40 }, lens },
      { scene: { preset: "siemens-star" }, subjectDistanceM: 2, output: { width: 16, height: 12 }, lens: { ...lens, diffraction: "circular-aperture" },
        sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" }, spectralStepNanometers: 40 } }
    ] as SimulateCaptureOptions[]) {
      const tabulated = await simulateCapture(options);
      setTabulatedNativeRawEnabled(false);
      let environment: SimulateCaptureResult;
      try { environment = await simulateCapture(options); } finally { setTabulatedNativeRawEnabled(true); }
      expect(defocusOf(tabulated)).toMatchObject({ kernelRadiusSites: 179, convolution: "runs" });
      expect(tabulated.assumptions.some((a) => a.id === "raw.expectedSignal")).toBe(true);
      expect(Array.from(tabulated.raw.codes)).toEqual(Array.from(environment.raw.codes));
    }
  }, scaledTimeout(240_000));

  it("regions and DNG parts equal the whole frame", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "siemens-star", cycles: 16 }, subjectDistanceM: 2, lens, sensor: { spectralStepNanometers: 40 }, output: { width: 32, height: 24 } };
    const whole = await simulateCapture(options);
    for (const region of [{ x: 10, y: 8, width: 12, height: 8 }, { x: 31, y: 0, width: 1, height: 24 }]) {
      const part = await simulateCapture({ ...options, output: { ...options.output, region } });
      const samples: number[] = [];
      for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width * 3; x++) samples.push(whole.image.samples[((region.y + y) * 32 + region.x) * 3 + x]!);
      expect(Array.from(part.image.samples)).toEqual(samples);
    }
    const dngOptions = { ...options, output: { ...options.output, format: "dng" as const } }, parts: SimulateCaptureDngPart[] = [];
    for (const [x, y] of [[0, 0], [16, 0], [0, 12], [16, 12]] as const) {
      const part = await simulateCapture({ ...options, output: { ...options.output, region: { x, y, width: 16, height: 12 } } });
      parts.push({ raw: part.raw, region: part.region! });
    }
    expect(Buffer.from((await serializeSimulatedCaptureDngFromParts(dngOptions, parts)).bytes).equals(Buffer.from((await simulateCapture(dngOptions)).image.dng!))).toBe(true);
  }, scaledTimeout(240_000));

  it("applies the large disc in image space (#548) with vignetting", async () => {
    const r = await simulateCapture({ scene: { preset: "slanted-edge" }, subjectDistanceM: 2, output: { width: 8, height: 8 }, sensor: { spectralStepNanometers: 80 },
      lens: { ...lens, focusDistanceM: 0.6, vignetting: { normalizationRadiusMm: 5, maximumNormalizedRadius: 1, coefficients: { r2: -0.3, r4: 0, r6: 0 } } } });
    expect(defocusOf(r)).toMatchObject({ execution: "image-space-convolution", convolution: "runs" });
    expect(defocusOf(r).kernelRadiusSites).toBeGreaterThan(64);
  }, scaledTimeout(120_000));
});

describe("the display view with a large disc (#564)", () => {
  it("renders, regions equal the whole view, and the GPU request is marked for the CPU", async () => {
    const request: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, subjectDistanceM: 2, sensor: { spectralStepNanometers: 40 }, output: { width: 48, height: 32 },
      lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 0.298, defocus } };
    const prepared = await prepareDisplayView(request);
    const whole = await prepared.render({ width: 24, height: 16 }), part = await prepared.render({ width: 24, height: 16, region: { x: 8, y: 4, width: 8, height: 6 } });
    const value = whole.assumptions.find((a) => a.id === "view.defocus")!.value as { defocusKernelRadiusSites: number; convolution?: string };
    expect(value).toMatchObject({ defocusKernelRadiusSites: 179, convolution: "runs" });
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8 * 3; x++) expect(part.image.samples[y * 24 + x]).toBe(whole.image.samples[((4 + y) * 24 + 8) * 3 + x]);
  }, scaledTimeout(240_000));

  it("is refused by both GPU kernels' render-time checks (the CPU renders it, labelled)", () => {
    const signalInput = { largeKernel: siteKernelRuns(createDefocusDiscSiteKernel(141)!.weights, 70) } as unknown as DisplayViewExpectedSignalInput;
    for (const reason of [displayViewQualityGpuUnsupportedReason({} as never, signalInput), displayViewSpeedGpuUnsupportedReason({} as never, signalInput)])
      expect(reason).toMatch(/defocus kernel radius above 64 sites/u);
  });
});
