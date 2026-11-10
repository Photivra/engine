// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, ImageKernelExecutionError, prepareDisplayView, simulateCapture, simulateDisplayView,
  type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createDefocusDiscSiteKernel, convolveSiteKernels } from "../src/optics/defocus-disc-kernel.js";
import { createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import { siteDiffractionKernel } from "../src/optics/site-diffraction-kernel.js";
import { prepareEnvironmentLensFieldMapping } from "../src/optics/sensor-environment-query.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #563: the display view with lens.projection, lens.distortion, lens.vignetting and camera rotation, in focus and with lens.defocus out of
 * focus (src/facade/display-view-lens-signal.ts). As for the rectilinear view (test/display-view.test.ts, "evaluates each real site's
 * expected electrons exactly as the capture's environment chain does"), the reference is the capture's own environment record for each site,
 * evaluated with the capture's own provider: the planar scene in focus (with lens.diffraction, the environment PSF quadrature), and #548's
 * image-space provider out of focus. Everything after the site values is the display view's validated chain, unchanged.
 */

const vignetting = { normalizationRadiusMm: 0.25, maximumNormalizedRadius: 1, coefficients: { r2: -0.35, r4: 0.05, r6: 0 } };
const barrel = { kind: "radial", profile: { normalizationRadiusMm: 0.25, maximumNormalizedRadius: 1, coefficients: { k1: -0.2, k2: 0.02, k3: 0 } } } as const;
const decentred = { kind: "brown-conrady", profile: { normalizationRadiusMm: 0.25, maximumNormalizedRadius: 1, coefficients: { k1: 0.05, k2: 0, k3: 0, p1: 0.02, p2: -0.01 } } } as const;
const rotation = { motion: { angularVelocityRadPerSec: { pitch: 0.2, yaw: 0.5, roll: 3 } } };
const base: SimulateCaptureOptions = { scene: { preset: "siemens-star", cycles: 12 }, subjectDistanceM: 2, output: { width: 24, height: 16 }, sensor: { spectralStepNanometers: 80 },
  exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } };
const lens = { focalLengthMm: 50, fNumber: 4 };
const quality = { pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" } } as const;
const rings = { kind: "reflectance-function", sceneId: "rings", evaluate: (p: { u: number; v: number }): number => 0.4 + 0.3 * Math.cos(40 * Math.hypot(p.u, p.v)) } as const;

/** In focus: each option alone, with the pixel aperture and filter, with diffraction (the PSF quadrature), on a radiance scene, and all together. */
const inFocus: [string, SimulateCaptureOptions][] = [
  ["lens.vignetting", { ...base, lens: { ...lens, vignetting } }],
  ["a fisheye projection", { ...base, lens: { ...lens, projection: "fisheye-equisolid-angle" } }],
  ["radial distortion with the box aperture and four-spot filter", { ...base, lens: { ...lens, distortion: barrel }, sensor: { ...base.sensor, ...quality } }],
  ["Brown-Conrady distortion and vignetting", { ...base, scene: { preset: "slanted-edge", angleDegrees: 20 }, lens: { ...lens, distortion: decentred, vignetting } }],
  ["camera rotation", { ...base, lens, ...rotation, sensor: { ...base.sensor, temporalSampleCount: 3 } }],
  // A scene without boundaries through lattice points: the reference below evaluates the plain provider per tap, which reads each tap at its
  // own site's arithmetic; the capture reads it at the lattice point (#565, test/simulate-capture-boundary-ties.test.ts).
  ["distortion and vignetting with lens.diffraction (PSF quadrature)", { ...base, scene: { preset: "dead-leaves" }, lens: { ...lens, fNumber: 11, distortion: barrel, vignetting,
    diffraction: "circular-aperture" }, sensor: { ...base.sensor, antiAliasing: { kind: "four-spot" } }, output: { width: 14, height: 10, demosaic: "ahd" } }],
  ["a radiance scene through a fisheye and vignetting", { ...base, scene: rings, lens: { ...lens, projection: "fisheye-equidistant", vignetting } } as SimulateCaptureOptions],
  ["all of them", { ...base, lens: { ...lens, projection: "fisheye-equidistant", distortion: decentred, vignetting }, ...rotation, sensor: { ...base.sensor, ...quality, temporalSampleCount: 2 } }]
];

type Signal = Awaited<ReturnType<typeof simulateDisplayViewWithInternals>>["signal"];
/** Expected photo electrons of one site's environment record with an evaluator (the environment chain, noise-free). */
function electrons(environment: unknown, evaluateRadiance: unknown): number {
  return (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never).value as unknown as
    { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
}
function sharpProvider(options: SimulateCaptureOptions, r: SimulateCaptureResult): ReturnType<typeof createPlanarSceneRadianceProvider> {
  return createPlanarSceneRadianceProvider({ scene: options.scene as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: r.scene.illuminant.illuminanceLux,
    distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: r.scene.framedHeightM / r.scene.framedWidthM, sceneId: "facade-scene", providerProfileId: "facade-provider" });
}
/** The largest relative difference between the view's site values and the reference over every native site (every `stride`-th). */
function largestDifference(capture: SimulateCaptureResult, signal: Signal, evaluateRadiance: unknown, stride = 1): number {
  const native = capture.raw.plan.exposure.geometry.nativeRaster;
  let largest = 0;
  for (let y = 0; y < native.pixelHeight; y++) for (let x = 0; x < native.pixelWidth; x++) {
    if ((y * native.pixelWidth + x) % stride !== 0) continue;
    const reference = electrons(capture.request.siteInput(y * native.pixelWidth + x).environment, evaluateRadiance);
    largest = Math.max(largest, Math.abs(signal.site(x, y) - reference) / reference);
  }
  return largest;
}

describe("display view with lens projection, distortion, vignetting and camera rotation (#563)", () => {
  for (const [name, options] of inFocus) {
    it("in focus, with " + name + ": every site's expected electrons are the capture environment chain's", async () => {
      const capture = await simulateCapture(options), { signal, result } = await simulateDisplayViewWithInternals(options, { width: 4, height: 4, samplesPerAxis: 1 });
      const provider = sharpProvider(options, capture);
      // The PSF quadrature reference costs one environment query per tap: every third site there.
      expect(largestDifference(capture, signal, provider.evaluateRadiance.bind(provider), options.lens?.diffraction ? 3 : 1)).toBeLessThan(1e-9);
      expect(result.diagnostics.fast.execution.backend).toBe("cpu-reference");
    }, scaledTimeout(120_000));
  }

  /** Out of focus: the capture's provider is #548's image-space disc; built here as the capture builds it. */
  const outOfFocus: [string, SimulateCaptureOptions][] = [
    ["vignetting and radial distortion", { ...base, lens: { ...lens, focusDistanceM: 1.8, defocus: { model: "geometric-disc" }, vignetting, distortion: barrel }, sensor: { ...base.sensor, ...quality } }],
    ["all of them and lens.diffraction", { ...base, lens: { ...lens, fNumber: 8, focusDistanceM: 1.8, defocus: { model: "geometric-disc" }, projection: "fisheye-equidistant", distortion: decentred,
      vignetting, diffraction: "circular-aperture" }, ...rotation, sensor: { ...base.sensor, temporalSampleCount: 2 }, output: { width: 20, height: 14, demosaic: "ahd" } }]
  ];
  for (const [name, options] of outOfFocus) {
    it("out of focus, with " + name + ": every site's expected electrons are those of the capture's image-space disc (#548)", async () => {
      const capture = await simulateCapture(options), { signal, result } = await simulateDisplayViewWithInternals(options, { width: 4, height: 4, samplesPerAxis: 1 });
      const sharp = sharpProvider(options, capture), native = capture.raw.plan.exposure.geometry.nativeRaster;
      const defocus = capture.assumptions.find((a) => a.id === "lens.defocus")!.value as { diameterSites: number; execution: string; fieldVariation: unknown };
      expect(defocus.execution).toBe("image-space-convolution");
      // The view records the capture's lens.defocus assumption (execution and field-variation bounds).
      expect(result.assumptions.find((a) => a.id === "lens.defocus")!.value).toEqual(defocus);
      const environment0 = capture.request.siteInput(0).environment as unknown as { lensFieldMapping?: unknown; motion: { angularVelocityRadPerSec: { pitch: number; yaw: number; roll: number } } };
      const l = options.lens as { focalLengthMm: number; focusDistanceM: number; diffraction?: string };
      const geometry = prepareDefocusImageSpaceGeometry({ focalLengthMm: l.focalLengthMm, focusDistanceM: l.focusDistanceM, angularVelocityRadPerSec: environment0.motion.angularVelocityRadPerSec,
        ...(environment0.lensFieldMapping ? { lensMapping: prepareEnvironmentLensFieldMapping(environment0.lensFieldMapping) } : {}), vignetting });
      const disc = createDefocusDiscSiteKernel(defocus.diameterSites)!, d = capture.request.diffraction;
      const radius = d ? d.profile.kernelRadiusSamples + disc.radius : disc.radius;
      const kernelOf = (nm: number): Float64Array => d ? convolveSiteKernels(siteDiffractionKernel(d.psf.configuration.psf, nm, 6, d.profile.kernelRadiusSamples, "kernel"),
        d.profile.kernelRadiusSamples, disc.weights, disc.radius) : disc.weights;
      const offsets = options.sensor?.antiAliasing ? [-0.5, 0.5] : [0], nodes = typeof options.sensor?.pixelAperture === "object" ? [-0.25, 0.25] : [0];
      const blurred = createDefocusImageSpaceProvider({ base: sharp, geometry, siteKernels: kernelOf, wavelengthsNm: d ? d.profile.profile.axes.wavelengthNm : Array.from({ length: 401 }, (_, i) => 380 + i),
        kernelRadius: radius, nativeWidth: native.pixelWidth, nativeHeight: native.pixelHeight, sitePitchMicrometers: 6, distanceM: capture.scene.distanceM,
        metresPerFrameUnit: capture.scene.framedWidthM / 2, timesPerBand: 2,
        queryOffsetsSites: nodes.flatMap((ny) => nodes.flatMap((nx) => offsets.flatMap((ay) => offsets.map((ax) => ({ x: nx - ax, y: ny - ay }))))) });
      expect(largestDifference(capture, signal, blurred.evaluateRadiance.bind(blurred))).toBeLessThan(1e-9);
    }, scaledTimeout(180_000));
  }

  it("rounds ties on chart boundaries as the lattice does: an identity vignetting profile gives the rectilinear view's bytes", async () => {
    // With a kernel the view reads the site lattice with #548's lattice formula, as the rectilinear view, the out-of-focus capture and (#565)
    // the in-focus capture's PSF quadrature do, so a source point exactly on a chart boundary (a Siemens star's diagonals through a symmetric
    // frame's centre) resolves the same way on every path (test/simulate-capture-boundary-ties.test.ts). docs/DISPLAY_VIEW.md, "Lens
    // projection, distortion, vignetting and rotation".
    const flat = { ...vignetting, coefficients: { r2: 0, r4: 0, r6: 0 } };
    for (const options of [{ ...base, lens: { ...lens, fNumber: 11, diffraction: "circular-aperture" } }, { ...base, lens: { ...lens, focusDistanceM: 1.8, defocus: { model: "geometric-disc" } },
      sensor: { ...base.sensor, ...quality } }] as SimulateCaptureOptions[]) {
      const plain = await simulateDisplayView(options, { width: 8, height: 6 });
      const identity = await simulateDisplayView({ ...options, lens: { ...options.lens, vignetting: flat } }, { width: 8, height: 6 });
      expect(Array.from(identity.image.samples)).toEqual(Array.from(plain.image.samples));
    }
  }, scaledTimeout(60_000));

  it("matches the box-downsized capture: distortion and vignetting, in focus and out of focus", async () => {
    const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
    const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
    for (const focusDistanceM of [2, 1.6]) {
      const options: SimulateCaptureOptions = { scene: { preset: "slanted-edge" }, subjectDistanceM: 2, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM, defocus: { model: "geometric-disc" },
        distortion: { kind: "radial", profile: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { k1: -0.15, k2: 0, k3: 0 } } },
        vignetting: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { r2: -0.5, r4: 0, r6: 0 } } }, sensor: { pixelPitchMicrometers: 3 }, output: { width: 192, height: 128 } };
      const capture = await simulateCapture({ ...options, output: { ...options.output, format: "srgb-16" } });
      const { internals } = await simulateDisplayViewWithInternals(options, { width: 24, height: 16, samplesPerAxis: 16 });
      let sq = 0, max = 0;
      for (let j = 0; j < 16; j++) for (let i = 0; i < 24; i++) for (let k = 0; k < 3; k++) {
        let reference = 0;
        for (let y = 8 * j; y < 8 * j + 8; y++) for (let x = 8 * i; x < 8 * i + 8; x++) reference += decode(capture.image.samples[(y * 192 + x) * 3 + k]!) / 64;
        const difference = encode8(internals.expected[(j * 24 + i) * 3 + k]!) - encode8(reference);
        sq += difference * difference; max = Math.max(max, Math.abs(difference));
      }
      // The thresholds of the rectilinear slanted-edge test (test/display-view.test.ts); the reference keeps its own noise.
      expect(Math.sqrt(sq / (16 * 24 * 3))).toBeLessThan(0.6);
      expect(max).toBeLessThan(3);
    }
  }, scaledTimeout(120_000));

  it("is region-identical, the same when prepared, and differs from the request without the options", async () => {
    const options: SimulateCaptureOptions = { ...base, lens: { ...lens, projection: "fisheye-equisolid-angle", vignetting }, sensor: { ...base.sensor, ...quality }, output: { width: 48, height: 32 } };
    const whole = await simulateDisplayView(options, { width: 16, height: 12 });
    const prepared = await prepareDisplayView(options);
    const part = await prepared.render({ width: 16, height: 12, region: { x: 5, y: 3, width: 6, height: 5 } });
    const expected: number[] = [];
    for (let y = 3; y < 8; y++) for (let x = 5 * 3; x < 11 * 3; x++) expected.push(whole.image.samples[y * 16 * 3 + x]!);
    expect(Array.from(part.image.samples)).toEqual(expected);
    expect(Array.from((await prepared.render({ width: 16, height: 12 })).image.samples)).toEqual(Array.from(whole.image.samples));
    const plain = await simulateDisplayView({ ...options, lens }, { width: 16, height: 12 });
    expect(Array.from(plain.image.samples)).not.toEqual(Array.from(whole.image.samples));
    // A coarse view (stratified estimator, pilot through the lens) renders too.
    const coarse = await simulateDisplayView({ ...options, ...rotation }, { width: 4, height: 3 });
    expect(coarse.view.scaleX).toBe(12);
  }, scaledTimeout(60_000));

  it("keeps these requests on the CPU reference: gpu \"auto\" falls back with unsupported-on-backend before any device, \"require\" fails", async () => {
    const options: SimulateCaptureOptions = { ...base, lens: { ...lens, distortion: barrel } };
    const prepared = await prepareDisplayView(options, { gpu: "auto" });
    const execution = (await prepared.render({ width: 4, height: 4 })).diagnostics.fast.execution;
    expect(execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend", adapter: null });
    expect(execution.limitations.join(" ")).toMatch(/lens\.projection, lens\.distortion, lens\.vignetting or camera rotation \(#563\)/u);
    await expect(prepareDisplayView(options, { gpu: "require" })).rejects.toThrow(ImageKernelExecutionError);
  }, scaledTimeout(60_000));

  it("refuses rotation with a rolling shutter and a vignetting profile that does not cover the kernel's reach beyond the frame", async () => {
    await expect(simulateDisplayView({ ...base, lens, motion: { angularVelocityRadPerSec: { yaw: 0.5 }, shutter: "rolling" } }, { width: 4, height: 4 }))
      .rejects.toThrow(/simulateDisplayView does not support camera rotation with motion\.shutter "rolling"/u);
    // The outer site centres are 0.091 mm from the axis (26 × 18 native sites of 6 µm); the profile reaches 0.095 mm, the 5-site diffraction kernel does not fit.
    const short = { ...vignetting, normalizationRadiusMm: 0.095 };
    await simulateDisplayView({ ...base, lens: { ...lens, vignetting: short } }, { width: 4, height: 4 });
    await expect(simulateDisplayView({ ...base, lens: { ...lens, fNumber: 16, vignetting: short, diffraction: "circular-aperture" } }, { width: 4, height: 4 }))
      .rejects.toThrow(/reads the scene through the lens up to/u);
  }, scaledTimeout(60_000));
});
