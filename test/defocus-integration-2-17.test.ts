// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, prepareDisplayView, simulateCapture, simulateDisplayView,
  type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createDiffractedPlanarProvider } from "../src/facade/diffraction-provider.js";
import { createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import { createDefocusBokehSiteKernel, resolveDefocusBokehOptions } from "../src/optics/defocus-bokeh-kernel.js";
import { createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import { siteKernelRuns } from "../src/optics/site-kernel-runs.js";
import { prepareEnvironmentLensFieldMapping } from "../src/optics/sensor-environment-query.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.17.0 integration of #564 (large defocus), #553 (bokeh character) and #563 (display-view lens character): a shaped kernel above
 * 64 sites takes the run path; what the run path cannot take is refused with a short lens.defocus message; and the display view's
 * lens signal applies a large disc by runs, matching the capture's image-space provider site by site.
 */

type DefocusValue = { diameterSites: number; kernelRadiusSites: number; execution?: string; convolution?: string; bokeh?: { kernelRadiusSites: number } };
const defocusOf = (r: { assumptions: readonly { id: string; value: unknown }[] }): DefocusValue => r.assumptions.find((a) => a.id === "lens.defocus")!.value as DefocusValue;

/** Expected photo electrons of one site's environment record with an evaluator (the environment chain, noise-free). */
function electrons(environment: unknown, evaluateRadiance: unknown): number {
  return (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never).value as unknown as
    { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
}
function sharpProvider(options: SimulateCaptureOptions, r: SimulateCaptureResult): ReturnType<typeof createPlanarSceneRadianceProvider> {
  return createPlanarSceneRadianceProvider({ scene: options.scene as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: r.scene.illuminant.illuminanceLux,
    distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: r.scene.framedHeightM / r.scene.framedWidthM, sceneId: "facade-scene", providerProfileId: "facade-provider" });
}

// 50 mm f/4 on a plane at 2 m focused at 0.298 m: a blur about 357 sites across at 6 µm, kernel radius 179 (#564's case).
const far = { focalLengthMm: 50, fNumber: 4, focusDistanceM: 0.298 };

describe("the display view with distortion, vignetting and a large disc (#563 with #564)", () => {
  // Profiles that reach the view's farthest source point: the native half-width plus the kernel radius, the frame's corner plus 179 sites, about 1.63 mm.
  const vignetting = { normalizationRadiusMm: 2, maximumNormalizedRadius: 1, coefficients: { r2: -0.35, r4: 0.05, r6: 0 } };
  const barrel = { kind: "radial", profile: { normalizationRadiusMm: 2, maximumNormalizedRadius: 1, coefficients: { k1: -0.2, k2: 0.02, k3: 0 } } } as const;
  const options: SimulateCaptureOptions = { scene: { preset: "siemens-star", cycles: 12 }, subjectDistanceM: 2, output: { width: 24, height: 16 },
    sensor: { spectralStepNanometers: 80, pixelAperture: { kind: "box", samplesPerAxis: 2 } }, exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 },
    lens: { ...far, defocus: { model: "geometric-disc" }, vignetting, distortion: barrel } };

  it("every site's expected electrons are those of the capture's image-space disc by runs (R 179), and the view renders on the CPU", async () => {
    const capture = await simulateCapture(options), { signal, result } = await simulateDisplayViewWithInternals(options, { width: 8, height: 6, samplesPerAxis: 1 });
    const defocus = defocusOf(capture);
    expect(defocus).toMatchObject({ kernelRadiusSites: 179, execution: "image-space-convolution", convolution: "runs" });
    expect(defocusOf(result)).toEqual(defocus);
    expect(result.assumptions.find((a) => a.id === "view.defocus")!.value).toMatchObject({ defocusKernelRadiusSites: 179, convolution: "runs" });
    // The capture's provider, built as the capture builds it: #548's geometry and #564's run lattice.
    const native = capture.raw.plan.exposure.geometry.nativeRaster, environment0 = capture.request.siteInput(0).environment as unknown as { lensFieldMapping: unknown };
    const geometry = prepareDefocusImageSpaceGeometry({ focalLengthMm: 50, focusDistanceM: far.focusDistanceM, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 },
      lensMapping: prepareEnvironmentLensFieldMapping(environment0.lensFieldMapping as never), vignetting });
    const disc = createDefocusDiscSiteKernel(defocus.diameterSites)!;
    const blurred = createDefocusImageSpaceProvider({ base: sharpProvider(options, capture), geometry, siteKernels: () => disc.weights, kernelRadius: disc.radius,
      largeKernel: { runs: siteKernelRuns(disc.weights, disc.radius) }, wavelengthsNm: Array.from({ length: 401 }, (_, i) => 380 + i),
      nativeWidth: native.pixelWidth, nativeHeight: native.pixelHeight, sitePitchMicrometers: 6, distanceM: capture.scene.distanceM, metresPerFrameUnit: capture.scene.framedWidthM / 2,
      queryOffsetsSites: [-0.25, 0.25].flatMap((y) => [-0.25, 0.25].map((x) => ({ x, y }))) });
    let largest = 0, checked = 0;
    for (let y = 0; y < native.pixelHeight; y++) for (let x = 0; x < native.pixelWidth; x++) {
      const reference = electrons(capture.request.siteInput(y * native.pixelWidth + x).environment, blurred.evaluateRadiance.bind(blurred));
      largest = Math.max(largest, Math.abs(signal.site(x, y) - reference) / reference);
      checked++;
    }
    expect(checked).toBe(native.pixelWidth * native.pixelHeight);
    expect(largest).toBeLessThan(1e-9);
    // Without the run path the view would read the in-focus signal: the disc must visibly change the site values.
    const sharp = await simulateDisplayViewWithInternals({ ...options, lens: { ...options.lens!, focusDistanceM: 2 } }, { width: 8, height: 6, samplesPerAxis: 1 });
    let changed = 0;
    for (let x = 0; x < native.pixelWidth; x++) changed = Math.max(changed, Math.abs(signal.site(x, 3) - sharp.signal.site(x, 3)) / sharp.signal.site(x, 3));
    expect(changed).toBeGreaterThan(0.05);
  }, scaledTimeout(240_000));

  it("with gpu \"auto\", falls back to the labelled CPU reference; regions equal the whole view", async () => {
    const prepared = await prepareDisplayView(options, { gpu: "auto" });
    const whole = await prepared.render({ width: 12, height: 8 }), part = await prepared.render({ width: 12, height: 8, region: { x: 4, y: 2, width: 5, height: 4 } });
    expect(whole.diagnostics.fast.execution.backend).toBe("cpu-reference");
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5 * 3; x++) expect(part.image.samples[y * 5 * 3 + x]).toBe(whole.image.samples[((2 + y) * 12 + 4) * 3 + x]);
    await prepared.dispose?.();
  }, scaledTimeout(240_000));
});

describe("bokeh above 64 sites (#553 with #564)", () => {
  const pointGrid = (defocus: Record<string, unknown>): SimulateCaptureOptions => ({ scene: { preset: "point-grid", radius: 0.015, backgroundReflectance: 0.02 } as SimulateCaptureOptions["scene"],
    subjectDistanceM: 2, lens: { ...far, defocus: { model: "geometric-disc", ...defocus } as never }, sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 80 }, output: { width: 24, height: 16 } });

  it("a blade kernel takes the run path: the same sums as its direct gather, and the capture and view label it", async () => {
    const options = resolveDefocusBokehOptions({ blades: { count: 7, curvature: 0.2 } }, "test");
    const kernel = createDefocusBokehSiteKernel({ diameterSites: 160, side: 1, fNumber: 4, focalLengthMm: 50, pitchMicrometers: 6, options });
    expect(kernel.radius).toBeGreaterThan(64);
    // The interior is uniform, so the runs are cheap: a fifth of the direct gather's (2R + 1)² taps or less (3,002 against 29,241 here).
    const runs = siteKernelRuns(kernel.weights, kernel.radius);
    expect(runs.readsPerOutput).toBeLessThan(kernel.width * kernel.width / 5);
    const W = 40, H = 30, wavelengthsNm = [500, 600], g = 2 / W;
    const star = (u: number, v: number, nm: number): number => ((Math.floor((Math.atan2(v, u) + Math.PI) / (Math.PI / 8)) % 2 === 0 ? 0.9 : 0.05) * (1 + (nm - 550) / 1000));
    const base = { sceneId: "s", providerProfileId: "p", radianceAt: star, evaluateRadiance: () => ({}), evaluateApertureRadiance: () => { throw new Error("unused"); } } as never;
    const common = { base, wavelengthsNm, nativeWidth: W, nativeHeight: H, outputWidth: W, sitePitchMicrometers: 6, distanceM: 2, metresPerFrameUnit: 0.01, siteKernels: () => kernel.weights, kernelRadius: kernel.radius };
    const direct = createDiffractedPlanarProvider(common), large = createDiffractedPlanarProvider({ ...common, largeKernel: { runs } });
    const value = (provider: typeof direct, i: number, j: number): number => {
      const u = (i + 0.5 - W / 2) * g, v = -(j + 0.5 - H / 2) * g, x = u * 0.01, y = v * 0.01, length = Math.hypot(x, y, 2);
      return provider.evaluateRadiance({ target: { outgoingDirectionUnitVector: { x: -x / length, y: -y / length, z: -2 / length } }, wavelengthNanometers: 600 } as never)
        .spectralRadianceWattsPerSquareMeterSteradianNanometer;
    };
    let worst = 0;
    for (let k = 0; k < 60; k++) { const i = (k * 7) % W, j = (k * 11) % H, a = value(large, i, j), b = value(direct, i, j); worst = Math.max(worst, Math.abs(a - b) / b); }
    expect(worst).toBeLessThan(1e-12);
    // In the capture and the view: the shaped kernel above 64 sites, convolved by runs.
    const capture = await simulateCapture(pointGrid({ blades: { count: 7, curvature: 0.2 } }));
    expect(defocusOf(capture)).toMatchObject({ convolution: "runs" });
    expect(defocusOf(capture).bokeh!.kernelRadiusSites).toBeGreaterThan(64);
    const view = await simulateDisplayView(pointGrid({ blades: { count: 7, curvature: 0.2 } }), { width: 12, height: 8 });
    expect(view.assumptions.find((a) => a.id === "view.defocus")!.value).toMatchObject({ kernel: "shaped-kernel", convolution: "runs" });
  }, scaledTimeout(240_000));

  it("refuses spherical aberration past the run path's reads, and a cat's eye above 64 sites, with short lens.defocus messages", async () => {
    const reads = /^lens\.defocus: this blur needs [0-9,]+ reads per site; above a kernel radius of 64 sites the limit is 16,641\. Reduce the spherical aberration or the defocus\.$/u;
    const aberrated = pointGrid({ sphericalAberration: { w040Micrometers: 2, atFNumber: 4 } });
    await expect(simulateCapture(aberrated)).rejects.toThrow(reads);
    await expect(simulateDisplayView(aberrated, { width: 12, height: 8 })).rejects.toThrow(reads);
    await expect(simulateCapture(pointGrid({ catsEye: { apertures: [{ radiusMm: 7, shiftPerTanFieldMm: 20 }] } })))
      .rejects.toThrow(/^lens\.defocus\.catsEye: the blur needs a kernel radius of 179 sites; with a cat's eye the limit is 64 sites \(129 across\)\. Reduce the defocus or omit catsEye\.$/u);
  }, scaledTimeout(120_000));
});
