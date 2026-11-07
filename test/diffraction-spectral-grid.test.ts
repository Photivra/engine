// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CHART_SCENE_PRESETS, DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS, InvalidConfigurationError, LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS,
  createDiffractionLimitedPsfProfile, prepareDisplayView, resolveLensPsfConvolutionKernels, simulateCapture, simulateDisplayView, simulateIdealReference,
  type ChartScene, type SimulateCaptureOptions } from "../src/index.js";
import { clearSiteDiffractionKernelCache, registerDiffractionPsfKey, siteDiffractionKernel, siteDiffractionKernelCacheState } from "../src/optics/site-diffraction-kernel.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, renderOnGpuQuality, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.15.0 regression (owner report, 2026-11-06, from the app): the color chart with lens.diffraction failed with
 * "wavelengthsNm must list 1 to 64 wavelengths." The app renders the `color-patches` chart with sensor.spectralStepNanometers 5,
 * as docs/COLOR_PATCHES.md recommends for color work. The sensor quadrature then has 80 spectral nodes over 380–780 nm, and
 * lens.diffraction builds one Airy kernel per node (createDiffractionLimitedPsfProfile), which refused more than 64. So every
 * step under 6.25 nm failed with diffraction, on every scene, in simulateCapture, the display view and the ideal reference.
 * The limit is now 400, the node count of the finest allowed step (1 nm), and each node keeps its own exact kernel.
 */

const colorChart = (step: number, extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions => ({
  scene: { preset: "color-patches" }, ...extra, lens: { diffraction: "circular-aperture", ...extra.lens },
  sensor: { ...extra.sensor, spectralStepNanometers: step }, output: { width: 36, height: 30, ...extra.output } });

/** The spectral nodes of the capture's diffraction profile. */
const nodesOf = (r: Awaited<ReturnType<typeof simulateCapture>>): readonly number[] => r.request.diffraction!.profile.wavelengths.map((w) => w.wavelengthNm);

describe("lens.diffraction at every spectral step (2.15.0)", () => {
  it("renders the color chart with diffraction at the app's 5 nm step, with one kernel per spectral node", async () => {
    const r = await simulateCapture(colorChart(5));
    const nodes = nodesOf(r);
    expect(nodes).toHaveLength(80);
    expect(nodes[0]).toBeCloseTo(382.5, 9);
    expect(nodes[79]).toBeCloseTo(777.5, 9);
    expect(r.request.diffraction!.execution).toBe("object-space-convolution");
    for (const v of r.image.samples) expect(Number.isFinite(v)).toBe(true);
    // The display view and the ideal reference take the same request.
    const view = await simulateDisplayView(colorChart(5), { width: 12, height: 10 });
    expect(view.image.width).toBe(12);
    const prepared = await prepareDisplayView(colorChart(5));
    expect(prepared).toBeDefined();
    const ideal = await simulateIdealReference(colorChart(5));
    expect(ideal.image.width).toBe(36);
  }, scaledTimeout(120_000));

  it("covers the finest step: 1 nm gives 400 nodes, exactly the limit", async () => {
    expect(DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS.maximumWavelengths).toBe(400);
    expect(LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS).toBe(400);
    for (const step of [1, 1.001, 1.5, 2.5, 6, 6.25, 6.3, 20, 100]) {
      const r = await simulateCapture(colorChart(step, { output: { width: 8, height: 6 } }));
      expect(nodesOf(r), "step " + step).toHaveLength(Math.ceil(400 / step));
    }
  }, scaledTimeout(240_000));

  it("diffracts each node with its own wavelength: the kernels equal one-wavelength profiles bit for bit", async () => {
    const r = await simulateCapture(colorChart(5, { output: { width: 8, height: 6 } }));
    const d = r.request.diffraction!, nodes = nodesOf(r), R = d.profile.kernelRadiusSamples, pitch = d.profile.samplePitchMicrometers;
    const input = { aperture: "circular" as const, focalLengthMm: d.psf.configuration.psf.focalLengthMm, apertureFNumber: d.psf.configuration.psf.apertureFNumber,
      focus: d.psf.configuration.psf.focus as { kind: "finite"; distanceM: number }, samplePitchMicrometers: pitch, kernelRadiusSamples: R,
      fieldHalfExtentMm: { x: 1, y: 1 }, profileId: "single" };
    for (const index of [0, 13, 40, 79]) {
      const nm = nodes[index]!;
      const single = createDiffractionLimitedPsfProfile({ ...input, wavelengthsNm: [nm] }).value;
      expect(d.profile.wavelengths[index]).toEqual(single.wavelengths[0]);
      const node = d.profile.profile.nodes.find((n) => n.coordinate.wavelengthNm === nm)!;
      expect(Array.from(node.kernel.normalizedIntensity)).toEqual(Array.from(single.profile.nodes[0]!.kernel.normalizedIntensity));
    }
    // Neighbouring nodes differ (the Airy pattern scales with λ), so no node borrows another's kernel.
    expect(d.profile.wavelengths[0]!.centreSampleFraction).toBeGreaterThan(d.profile.wavelengths[79]!.centreSampleFraction);
  }, scaledTimeout(60_000));

  /** A valid scene of each built-in chart preset, plus a caller radiance function and a caller material scene. */
  const scenes: [string, SimulateCaptureOptions["scene"]][] = [
    ...CHART_SCENE_PRESETS.map((preset): [string, SimulateCaptureOptions["scene"]] => [preset, (preset === "composite" ?
      { preset, elements: [{ scene: { preset: "color-patches" }, centerU: -0.4, centerV: 0, width: 0.7, height: 0.6 }, { scene: { preset: "zone-plate" }, centerU: 0.4, centerV: 0, width: 0.7, height: 0.7 }] } :
      preset === "patches" ? { preset, patches: [{ patchId: "a", reflectance: 0.05 }, { patchId: "b", reflectance: { kind: "color-patch", patchId: "red" } }], columns: 2 } :
        { preset }) as ChartScene]),
    ["radiance-function", { kind: "radiance-function", sceneId: "grid-radiance", evaluate: ({ u }: { u: number }): number => (u > 0 ? 0.03 : 0.01) }],
    ["material-function", { kind: "material-function", sceneId: "grid-material", materials: [{ kind: "color-patch", patchId: "red" }, 0.5], materialAt: (u: number) => (u > 0 ? 0 : 1) }]
  ] as [string, SimulateCaptureOptions["scene"]][];
  for (const tabulated of [true, false]) {
    it("renders every built-in chart and caller scene with diffraction at the 1 nm and 5 nm steps (" + (tabulated ? "tabulated RAW" : "per-site environment") + ")", async () => {
      setTabulatedNativeRawEnabled(tabulated);
      try {
        for (const [name, scene] of scenes) for (const step of [1, 5]) {
          const r = await simulateCapture({ scene, lens: { diffraction: "circular-aperture" }, sensor: { spectralStepNanometers: step }, output: { width: 8, height: 6 } });
          expect(nodesOf(r), name + " " + step).toHaveLength(400 / step);
        }
      } finally { setTabulatedNativeRawEnabled(true); }
    }, scaledTimeout(600_000));
  }

  // Every option that changes how diffraction is executed: object-space convolution with an anti-aliasing filter, a box pixel aperture,
  // AHD, a region, an explicit radius, a defocus disc; and the per-tap environment quadrature (camera rotation).
  const options: [string, Partial<SimulateCaptureOptions>, "object-space-convolution" | "environment-psf-quadrature"][] = [
    ["four-spot anti-aliasing, 2 × 2 box aperture, AHD", { sensor: { antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } },
      output: { width: 12, height: 10, demosaic: "ahd" } }, "object-space-convolution"],
    ["a region", { output: { width: 12, height: 10, region: { x: 2, y: 2, width: 4, height: 4 } } }, "object-space-convolution"],
    ["kernelRadiusSamples 12 at f/16", { lens: { fNumber: 16, diffraction: { kind: "circular-aperture", kernelRadiusSamples: 12 } } }, "object-space-convolution"],
    ["fast kernels", { lens: { diffraction: { kind: "circular-aperture", fast: true } } }, "object-space-convolution"],
    ["lens.defocus out of focus", { lens: { focusDistanceM: 2, defocus: { model: "geometric-disc" } } }, "object-space-convolution"],
    ["camera rotation (per-tap quadrature)", { motion: { angularVelocityRadPerSec: { yaw: 0.01 } }, sensor: { temporalSampleCount: 2 }, output: { width: 4, height: 4 } },
      "environment-psf-quadrature"]
  ];
  for (const [name, extra, execution] of options) {
    it("renders the color chart at 5 nm with diffraction and " + name, async () => {
      const r = await simulateCapture(colorChart(5, extra));
      expect(nodesOf(r)).toHaveLength(80);
      expect(r.request.diffraction!.execution).toBe(execution);
      if (execution === "object-space-convolution") {
        // The display view takes the same options except a region (it renders the whole frame) and camera rotation (refused, off the lattice).
        const output = { ...extra.output };
        delete output.region;
        const view = await simulateDisplayView(colorChart(5, { ...extra, output }), { width: 4, height: 4 });
        expect(view.image.width).toBe(4);
      }
    }, scaledTimeout(240_000));
  }
});

describe("diffraction profile and kernel limits (2.15.0)", () => {
  const base = { aperture: "circular" as const, focalLengthMm: 50, apertureFNumber: 8, focus: { kind: "infinity" as const }, samplePitchMicrometers: 6,
    kernelRadiusSamples: 3, fieldHalfExtentMm: { x: 1, y: 1 }, profileId: "grid" };
  const grid = (n: number): number[] => Array.from({ length: n }, (_, i) => 380 + (i + 0.5) * 400 / n);

  it("accepts 1 to 400 wavelengths and refuses 401 with the limit in the message", () => {
    expect(createDiffractionLimitedPsfProfile({ ...base, wavelengthsNm: grid(400) }).value.wavelengths).toHaveLength(400);
    expect(() => createDiffractionLimitedPsfProfile({ ...base, wavelengthsNm: grid(401) })).toThrow(new InvalidConfigurationError("wavelengthsNm must list 1 to 400 wavelengths."));
  });

  it("resolveLensPsfConvolutionKernels takes up to 400 spectral weights", () => {
    const p = createDiffractionLimitedPsfProfile({ ...base, wavelengthsNm: grid(400) }).value;
    const call = (weights: { wavelengthNm: number; weight: number }[]): ReturnType<typeof resolveLensPsfConvolutionKernels> => resolveLensPsfConvolutionKernels({ schemaVersion: "0.1.0",
      psf: { profile: p.profile, focalLengthMm: 50, focus: { kind: "infinity" }, apertureFNumber: 8, signedDefocusImagePlaneMicrometers: 0 }, spectralWeights: weights,
      grid: { width: 1, height: 1, sitePitchMicrometers: { x: 6, y: 6 }, opticalAxisSite: { x: 0.5, y: 0.5 } }, patchWidth: 1, patchHeight: 1, kernelRadius: 3 });
    expect(call(grid(400).map((wavelengthNm) => ({ wavelengthNm, weight: 1 }))).value.kernelRadius).toBe(3);
    expect(() => call(grid(401).map((wavelengthNm) => ({ wavelengthNm: Math.min(wavelengthNm, 779), weight: 1 })))).toThrow("spectralWeights must list 1 to 400 wavelengths.");
  });

  it("site kernels from the shared private clone equal the public per-call kernels bit for bit", () => {
    clearSiteDiffractionKernelCache();
    const input = { ...base, wavelengthsNm: grid(80) };
    const p = createDiffractionLimitedPsfProfile(input).value;
    const psf = { profile: p.profile, focalLengthMm: 50, focus: { kind: "infinity" as const }, apertureFNumber: 8, signedDefocusImagePlaneMicrometers: 0 };
    registerDiffractionPsfKey(psf, input);
    const before = siteDiffractionKernelCacheState().resolves;
    for (const nm of grid(80)) {
      const shared = siteDiffractionKernel(psf, nm, 6, 3, "inexact");
      const direct = resolveLensPsfConvolutionKernels({ schemaVersion: "0.1.0", psf, spectralWeights: [{ wavelengthNm: nm, weight: 1 }],
        grid: { width: 1, height: 1, sitePitchMicrometers: { x: 6, y: 6 }, opticalAxisSite: { x: 0.5, y: 0.5 } }, patchWidth: 1, patchHeight: 1, kernelRadius: 3 }).value.kernels;
      expect(Array.from(shared)).toEqual(Array.from(direct));
    }
    expect(siteDiffractionKernelCacheState().resolves - before).toBe(80);
    clearSiteDiffractionKernelCache();
  });
});

describe("the display view's GPU Quality kernels with 80 spectral nodes (2.15.0, float32 emulation)", () => {
  it("the color chart at 5 nm with diffraction stays inside the a-priori bounds of the CPU reference", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "color-patches" }, lens: { prime: 50, fNumber: 8, diffraction: "circular-aperture" },
      sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 5 }, output: { ...SMALL_FRAME, format: "srgb-8" } };
    const fixture = await displayViewGpuFixture(options, SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const gpu = await renderOnGpuQuality(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    runtime.destroy();
  }, scaledTimeout(900_000));
});
