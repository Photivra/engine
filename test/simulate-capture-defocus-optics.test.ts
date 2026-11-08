// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, simulateCapture, simulateDisplayView, type SimulateCaptureOptions,
  type SimulateCaptureResult } from "../src/index.js";
import { convolveSiteKernels, createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import { createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import { prepareEnvironmentLensFieldMapping } from "../src/optics/sensor-environment-query.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #548: lens.defocus out of focus with lens.projection, lens.distortion, lens.vignetting or camera rotation. The capture applies the
 * disc in image space, on the sensor's site lattice (src/facade/defocus-image-space-provider.ts). The reference is the environment
 * PSF quadrature with the same disc as a caller sampled PSF (lens.psf): one scene query per kernel tap, through the environment's
 * own mapping, field throughput and rotation, an independent implementation of the same sum.
 */

const defocus = { model: "geometric-disc" } as const;
type FieldVariation = { gridPointsPerSide: number; rotationMaximumDiameterChangeSites: number | null; distortionMaximumLocalScaleDeviation: number | null;
  projectionMaximumDiameterChangeSites: number | null };
type DefocusValue = { diameterSites: number; kernelRadiusSites: number; execution: string; combinedWithDiffraction: boolean; imageSpaceOptions?: string[];
  fieldVariation?: FieldVariation };
const defocusOf = (r: SimulateCaptureResult): DefocusValue => r.assumptions.find((a) => a.id === "lens.defocus")!.value as DefocusValue;
type Psf = NonNullable<NonNullable<SimulateCaptureOptions["lens"]>["psf"]>;
type ProfileNodes = { nodes: { kernel: { normalizedIntensity: number[]; widthSamples: number; samplePitchMicrometersX: number; samplePitchMicrometersY: number } }[];
  responseIncludes: Record<string, boolean>; profileId: string };

/** The options without lens.defocus (and with `lens` changes merged in). */
function withoutDefocus(options: SimulateCaptureOptions, lens: Record<string, unknown> = {}): SimulateCaptureOptions {
  const copy = { ...options.lens, ...lens } as Record<string, unknown>;
  delete copy.defocus;
  return { ...options, lens: copy } as SimulateCaptureOptions;
}

/** The engine's diffraction profile for these optics (same field extent and spectral nodes), as a container for test kernels. */
async function diffractionPsf(options: SimulateCaptureOptions, kernelRadiusSamples: number | undefined): Promise<Psf> {
  const plain = withoutDefocus(options, { vignetting: undefined, projection: undefined, distortion: undefined,
    diffraction: kernelRadiusSamples === undefined ? "circular-aperture" : { kind: "circular-aperture", kernelRadiusSamples } });
  const still = { ...plain };
  delete still.motion;
  const probe = await simulateCapture(still);
  return structuredClone(probe.request.diffraction!.psf) as unknown as Psf;
}

/**
 * The defocus disc as a caller `lens.psf`: each kernel of an engine diffraction profile for the same optics replaced by the disc sampled at
 * the site pitch / `subdivision` (exact disc area per cell). Subdivision 1 is the kernel the capture applies; finer, it approaches the
 * continuous disc (the fine-grid oracle). With `diffractionRadius`, each node's diffraction kernel convolved with the disc instead.
 */
async function discPsf(options: SimulateCaptureOptions, diameterSites: number, subdivision = 1, diffractionRadius?: number): Promise<Psf> {
  const disc = createDefocusDiscSiteKernel(diameterSites * subdivision)!;
  if (diffractionRadius === undefined) {
    const psf = await diffractionPsf(options, disc.radius), profile = (psf as unknown as { configuration: { psf: { profile: ProfileNodes } } }).configuration.psf.profile;
    profile.profileId = "test-defocus-disc-" + subdivision;
    profile.responseIncludes = { ...profile.responseIncludes, diffraction: false, defocus: true };
    for (const node of profile.nodes) {
      node.kernel.normalizedIntensity = Array.from(disc.weights);
      node.kernel.samplePitchMicrometersX /= subdivision;
      node.kernel.samplePitchMicrometersY /= subdivision;
    }
    return psf;
  }
  const diffraction = await diffractionPsf(options, diffractionRadius), combined = await diffractionPsf(options, diffractionRadius + disc.radius);
  const source = (diffraction as unknown as { configuration: { psf: { profile: ProfileNodes } } }).configuration.psf.profile;
  const target = (combined as unknown as { configuration: { psf: { profile: ProfileNodes } } }).configuration.psf.profile;
  target.profileId = "test-defocus-disc-diffraction";
  target.responseIncludes = { ...target.responseIncludes, defocus: true };
  target.nodes.forEach((node, n) => {
    node.kernel.normalizedIntensity = Array.from(convolveSiteKernels(Float64Array.from(source.nodes[n]!.kernel.normalizedIntensity), diffractionRadius, disc.weights, disc.radius));
  });
  return combined;
}

/** Expected photo electrons of one site's environment record with an evaluator (the environment chain, noise-free). */
function electrons(environment: unknown, evaluateRadiance: unknown): number {
  return (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never).value as unknown as
    { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
}

const vignetting = { normalizationRadiusMm: 0.1, maximumNormalizedRadius: 1, coefficients: { r2: -0.3, r4: 0, r6: 0 } };
const barrel = { kind: "radial", profile: { normalizationRadiusMm: 0.15, maximumNormalizedRadius: 1, coefficients: { k1: -0.2, k2: 0, k3: 0 } } };
const decentred = { kind: "brown-conrady", profile: { normalizationRadiusMm: 0.15, maximumNormalizedRadius: 1, coefficients: { k1: 0.05, k2: 0, k3: 0, p1: 0.02, p2: -0.01 } } };
const scene = { preset: "dead-leaves" } as const;
const base: SimulateCaptureOptions = { scene, subjectDistanceM: 2, output: { width: 16, height: 12 }, sensor: { spectralStepNanometers: 80 },
  exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } };
const lens = { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8, defocus };
const rotation = { motion: { angularVelocityRadPerSec: { pitch: 0.2, yaw: 0.5, roll: 3 } }, sensor: { spectralStepNanometers: 80, temporalSampleCount: 2 } };
/** Each combination of #548, alone and all together. */
const cases: [string, SimulateCaptureOptions, string[]][] = [
  ["lens.vignetting", { ...base, lens: { ...lens, vignetting } } as SimulateCaptureOptions, ["lens.vignetting"]],
  ["a fisheye projection", { ...base, lens: { ...lens, projection: "fisheye-equisolid-angle" } } as SimulateCaptureOptions, ["lens.projection"]],
  ["radial distortion", { ...base, lens: { ...lens, distortion: barrel } } as SimulateCaptureOptions, ["lens.distortion"]],
  ["Brown-Conrady distortion", { ...base, lens: { ...lens, distortion: decentred } } as SimulateCaptureOptions, ["lens.distortion"]],
  ["camera rotation", { ...base, lens, ...rotation } as SimulateCaptureOptions, ["camera rotation"]],
  ["all of them", { ...base, lens: { ...lens, projection: "fisheye-equidistant", distortion: decentred, vignetting }, ...rotation } as SimulateCaptureOptions,
    ["lens.projection, lens.distortion", "lens.vignetting", "camera rotation"]]
];

describe("lens.defocus out of focus with projection, distortion, vignetting and camera rotation (#548)", () => {
  for (const [name, options, imageSpaceOptions] of cases) {
    it("with " + name + ": the image-space disc gives the RAW of the environment PSF quadrature with the same disc", async () => {
      const r = await simulateCapture(options), value = defocusOf(r);
      expect(value).toMatchObject({ execution: "image-space-convolution", combinedWithDiffraction: false, kernelRadiusSites: 3, imageSpaceOptions });
      const explanation = r.assumptions.find((a) => a.id === "lens.defocus")!.explanation;
      expect(explanation).toMatch(/approximation/u);
      expect(explanation).toMatch(/Applied as an image-space convolution \(#548/u);
      expect(r.diagnostics.options).toContain("lens.defocus");
      expect(r.diagnostics.timingsMs.defocus).toBeGreaterThan(0);
      expect((r.request.siteInput(0).environment as unknown as { psf: { kind: string; limitation: string } }).psf).toMatchObject({ kind: "not-applied",
        limitation: expect.stringMatching(/image-space convolution/u) as unknown as string });
      const reference = await simulateCapture(withoutDefocus(options, { psf: await discPsf(options, value.diameterSites) }));
      expect(Array.from(r.raw.codes)).toEqual(Array.from(reference.raw.codes));
      // The blur is there: the RAW differs from the same request in focus.
      const sharp = await simulateCapture(withoutDefocus(options, { focusDistanceM: 2 }));
      expect(Array.from(r.raw.codes)).not.toEqual(Array.from(sharp.raw.codes));
    }, scaledTimeout(120_000));
  }

  it("agrees with the environment PSF quadrature to 1e-12 per site in expected electrons (all combinations at once)", async () => {
    const options = cases[cases.length - 1]![1], r = await simulateCapture(options), value = defocusOf(r), psf = await discPsf(options, value.diameterSites);
    const sharp = createPlanarSceneRadianceProvider({ scene: scene as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: r.scene.illuminant.illuminanceLux,
      distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: 12 / 16, sceneId: "facade-scene", providerProfileId: "facade-provider" });
    const native = r.raw.plan.exposure.geometry.nativeRaster, kernel = createDefocusDiscSiteKernel(value.diameterSites)!;
    const environment0 = r.request.siteInput(0).environment as unknown as { lensFieldMapping: unknown; motion: { angularVelocityRadPerSec: { pitch: number; yaw: number; roll: number } } };
    const geometry = prepareDefocusImageSpaceGeometry({ focalLengthMm: 50, focusDistanceM: 1.8, angularVelocityRadPerSec: environment0.motion.angularVelocityRadPerSec,
      lensMapping: prepareEnvironmentLensFieldMapping(environment0.lensFieldMapping), vignetting });
    const blurred = createDefocusImageSpaceProvider({ base: sharp, geometry, siteKernels: () => kernel.weights, wavelengthsNm: Array.from({ length: 401 }, (_, i) => 380 + i),
      kernelRadius: kernel.radius, nativeWidth: native.pixelWidth, nativeHeight: native.pixelHeight, sitePitchMicrometers: 6, distanceM: r.scene.distanceM,
      metresPerFrameUnit: r.scene.framedWidthM / 2, timesPerBand: 2 });
    let largest = 0;
    for (let i = 0; i < native.pixelWidth * native.pixelHeight; i++) {
      const environment = r.request.siteInput(i).environment;
      const method = electrons(environment, blurred.evaluateRadiance.bind(blurred)), quadrature = electrons({ ...environment, psf }, sharp.evaluateRadiance.bind(sharp));
      largest = Math.max(largest, Math.abs(method - quadrature) / quadrature);
    }
    expect(largest).toBeLessThan(1e-12);
  }, scaledTimeout(120_000));

  it("against a fine-grid oracle (the disc sampled 3 times finer), the lattice error equals the rectilinear capture's", async () => {
    // docs/QUICK_START.md ("Optics") records the 5× and 3× measurements of every case; this checks the bound on two.
    const edge = { ...base, scene: { preset: "slanted-edge" } } as SimulateCaptureOptions;
    const errors: number[] = [];
    for (const options of [{ ...edge, lens }, { ...edge, lens: { ...lens, projection: "fisheye-equisolid-angle", distortion: { ...barrel, profile: { ...barrel.profile, normalizationRadiusMm: 0.25 } },
      vignetting: { ...vignetting, normalizationRadiusMm: 0.2 } } }] as SimulateCaptureOptions[]) {
      const r = await simulateCapture(options), value = defocusOf(r);
      const sharp = createPlanarSceneRadianceProvider({ scene: { preset: "slanted-edge" } as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 },
        illuminanceLux: r.scene.illuminant.illuminanceLux, distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: 12 / 16, sceneId: "facade-scene", providerProfileId: "facade-provider" });
      const lattice = await discPsf(options, value.diameterSites), fine = await discPsf(options, value.diameterSites, 3);
      const native = r.raw.plan.exposure.geometry.nativeRaster;
      let largest = 0;
      for (let i = 0; i < native.pixelWidth * native.pixelHeight; i++) {
        const environment = r.request.siteInput(i).environment, evaluate = sharp.evaluateRadiance.bind(sharp);
        const a = electrons({ ...environment, psf: lattice }, evaluate), b = electrons({ ...environment, psf: fine }, evaluate);
        largest = Math.max(largest, Math.abs(a - b) / b);
      }
      errors.push(largest);
    }
    // Measured 0.104 for both (the edge's point sampling by the lattice, as on the object-space path).
    expect(errors[0]).toBeLessThan(0.12);
    expect(Math.abs(errors[1]! - errors[0]!)).toBeLessThan(0.01);
  }, scaledTimeout(240_000));

  it("with lens.diffraction applies each node's diffraction kernel convolved with the disc in image space", async () => {
    const options = { ...base, lens: { ...lens, vignetting: { ...vignetting, normalizationRadiusMm: 0.15 }, distortion: barrel, diffraction: "circular-aperture" }, ...rotation } as SimulateCaptureOptions;
    const r = await simulateCapture(options), value = defocusOf(r);
    expect(value).toMatchObject({ execution: "image-space-convolution", combinedWithDiffraction: true });
    expect(r.request.diffraction!.execution).toBe("image-space-convolution");
    expect(r.assumptions.find((a) => a.id === "lens.diffraction")!.value).toMatchObject({ execution: "image-space-convolution" });
    expect(r.assumptions.find((a) => a.id === "lens.defocus")!.explanation).toMatch(/not exactly the Airy pattern convolved with the disc/u);
    expect(r.diagnostics.timingsMs.diffraction).toBeUndefined();
    const radius = r.request.diffraction!.profile.kernelRadiusSamples;
    const reference = await simulateCapture(withoutDefocus(options, { diffraction: undefined, psf: await discPsf(options, value.diameterSites, 1, radius) }));
    expect(Array.from(r.raw.codes)).toEqual(Array.from(reference.raw.codes));
  }, scaledTimeout(120_000));

  it("with a caller reflectance function (no materials: one convolution per spectral node) gives the environment quadrature's RAW", async () => {
    const options = { ...base, scene: { kind: "reflectance-function", sceneId: "defocus-548", evaluate: ({ u, v }: { u: number; v: number }): number =>
      0.2 + 0.5 * (u * u + 0.3 * v > 0.05 ? 1 : 0) * (0.5 + 0.5 * Math.cos(9 * u)) } as never, lens: { ...lens, vignetting, distortion: barrel }, ...rotation } as SimulateCaptureOptions;
    const r = await simulateCapture(options);
    expect(defocusOf(r).execution).toBe("image-space-convolution");
    const reference = await simulateCapture(withoutDefocus(options, { psf: await discPsf(options, defocusOf(r).diameterSites) }));
    expect(Array.from(r.raw.codes)).toEqual(Array.from(reference.raw.codes));
  }, scaledTimeout(120_000));

  it("reduces to the object-space path for the identity mapping (lens.projection \"rectilinear\", no distortion)", async () => {
    const options = { ...base, lens: { ...lens, projection: "rectilinear" }, sensor: { spectralStepNanometers: 80, antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } } } as SimulateCaptureOptions;
    const mapped = await simulateCapture(options), plain = await simulateCapture({ ...options, lens });
    expect(defocusOf(mapped).execution).toBe("image-space-convolution");
    expect(defocusOf(plain).execution).toBe("object-space-convolution");
    expect(Array.from(mapped.raw.codes)).toEqual(Array.from(plain.raw.codes));
  }, scaledTimeout(60_000));

  it("in focus, each combination is byte-identical to the request without lens.defocus", async () => {
    for (const [, options] of cases) {
      const focused = { ...options, lens: { ...options.lens, focusDistanceM: 2 } } as SimulateCaptureOptions;
      const withOption = await simulateCapture(focused), without = await simulateCapture(withoutDefocus(focused));
      expect(Array.from(withOption.raw.codes)).toEqual(Array.from(without.raw.codes));
      expect(Array.from(withOption.image.samples)).toEqual(Array.from(without.image.samples));
      expect(defocusOf(withOption).diameterSites).toBe(0);
    }
  }, scaledTimeout(120_000));

  it("records the field-variation bounds of the constant disc", async () => {
    const values = await Promise.all(cases.map(async ([, options]) => defocusOf(await simulateCapture(options)).fieldVariation!));
    const [vignetted, fisheye, radial, brownConrady, rotating, all] = values;
    expect(vignetted).toEqual({ gridPointsPerSide: 9, rotationMaximumDiameterChangeSites: null, distortionMaximumLocalScaleDeviation: null, projectionMaximumDiameterChangeSites: null });
    expect(fisheye!.projectionMaximumDiameterChangeSites).toBeGreaterThan(0);
    // Barrel k1 = −0.2: the radial scale 1 + 3·k1·ρ² departs most from 1 at the frame corner (the 9 × 9 grid's corner, 18 × 14 native sites of
    // 6 µm), by 0.6·ρ², ρ the undistorted normalized radius there: ρ·(1 − 0.2·ρ²) = the corner's radius / 0.15 mm.
    const corner = Math.hypot(18 * 3, 14 * 3) / 1000 / 0.15;
    let rho = corner;
    for (let k = 0; k < 60; k++) rho = corner / (1 - 0.2 * rho * rho);
    expect(radial!.distortionMaximumLocalScaleDeviation).toBeCloseTo(0.6 * rho * rho, 9);
    expect(brownConrady!.distortionMaximumLocalScaleDeviation).toBeGreaterThan(0);
    expect(rotating!.rotationMaximumDiameterChangeSites).toBeGreaterThan(0);
    expect(all).toMatchObject({ rotationMaximumDiameterChangeSites: expect.any(Number) as unknown as number, distortionMaximumLocalScaleDeviation: expect.any(Number) as unknown as number,
      projectionMaximumDiameterChangeSites: expect.any(Number) as unknown as number });
    // Roll alone does not tilt the plane.
    const roll = await simulateCapture({ ...base, lens, motion: { angularVelocityRadPerSec: { roll: 3 } }, sensor: { spectralStepNanometers: 80, temporalSampleCount: 2 } });
    expect(defocusOf(roll).fieldVariation!.rotationMaximumDiameterChangeSites).toBeLessThan(1e-9);
  }, scaledTimeout(120_000));

  it("refuses rotation with a rolling shutter and a vignetting profile that does not cover the disc's reach; the display view renders these options (#563)", async () => {
    await expect(simulateCapture({ ...base, lens, motion: { angularVelocityRadPerSec: { yaw: 0.5 }, shutter: "rolling" } }))
      .rejects.toThrow(/does not support lens\.defocus out of focus with camera rotation and motion\.shutter "rolling"/u);
    // In focus the same request renders.
    await expect(simulateCapture({ ...base, lens: { ...lens, focusDistanceM: 2 }, motion: { angularVelocityRadPerSec: { yaw: 0.5 }, shutter: "rolling" } })).resolves.toBeDefined();
    // The frame corner is 0.068 mm from the axis; the profile reaches 0.07 mm, the disc's reach (3 sites) does not fit.
    const short = { ...vignetting, normalizationRadiusMm: 0.07 };
    await simulateCapture({ ...base, lens: { ...lens, focusDistanceM: 2, vignetting: short } });
    await expect(simulateCapture({ ...base, lens: { ...lens, vignetting: short } })).rejects.toThrow(/reads the scene through the lens up to 3 sites beyond the frame/u);
    // #563: the display view renders them out of focus too (test/display-view-lens.test.ts checks its site values against this capture's).
    await expect(simulateDisplayView({ ...base, lens: { ...lens, vignetting } }, { width: 8, height: 6 })).resolves.toMatchObject({ kind: "display-view" });
  }, scaledTimeout(60_000));

  it("output regions are the whole frame's pixels (Quality filters, all combinations)", async () => {
    const all = cases[cases.length - 1]![1];
    const options = { ...all, lens: { ...all.lens, vignetting: { ...vignetting, normalizationRadiusMm: 0.2 } }, output: { width: 16, height: 12, demosaic: "ahd" },
      sensor: { spectralStepNanometers: 80, temporalSampleCount: 2, antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } } } as SimulateCaptureOptions;
    const whole = await simulateCapture(options), nativeWidth = whole.plan.exposure.geometry.nativeRaster.pixelWidth;
    for (const region of [{ x: 5, y: 4, width: 6, height: 4 }, { x: 0, y: 0, width: 4, height: 3 }, { x: 12, y: 9, width: 4, height: 3 }]) {
      const part = await simulateCapture({ ...options, output: { ...options.output, region } });
      const rect = part.region!.nativeRect, samples: number[] = [], codes: number[] = [];
      for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width * 3; x++) samples.push(whole.image.samples[((region.y + y) * 16 + region.x) * 3 + x]!);
      for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) codes.push(whole.raw.codes[(rect.y + y) * nativeWidth + rect.x + x]!);
      expect(Array.from(part.image.samples)).toEqual(samples);
      expect(Array.from(part.raw.codes)).toEqual(codes);
    }
  }, scaledTimeout(120_000));
});
