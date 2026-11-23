// SPDX-License-Identifier: Apache-2.0
/**
 * #761, #762: camera motion or a moving subject with `lens.diffraction`, the four-spot filter and a 2 × 2 box at full quality. The
 * lattice taps' quadrature (#565: one scene query per kernel tap, each read at its site-lattice point) needs 16 midpoints × 21 nodes ×
 * 4 spots × 4 box nodes × 81 or more taps per site, past the environment's bound of 100000; such a request was refused. The scene
 * provider now sums the taps on the site lattice at each instant (defocus-image-space-provider.ts, the diffraction kernels as its
 * site kernels), so a site asks only 5376 queries: the same terms in another order. The provider's kept bands are bounded (64 MiB).
 * Also #730 facade-19 (the refusal names its factors), facade-12 (zone kernels built once per band) and facade-14 (the image-space
 * provider's values do not depend on the window).
 */
import { describe, expect, it, vi } from "vitest";
import type { DefocusImageSpaceProviderInput } from "../src/facade/defocus-image-space-provider.js";

const captured = vi.hoisted(() => ({ calls: [] as { input: unknown; provider: unknown }[] }));
vi.mock("../src/facade/defocus-image-space-provider.js", async (importOriginal): Promise<typeof import("../src/facade/defocus-image-space-provider.js")> => {
  const actual = await importOriginal<typeof import("../src/facade/defocus-image-space-provider.js")>();
  return { ...actual, createDefocusImageSpaceProvider: (input): ReturnType<typeof actual.createDefocusImageSpaceProvider> => { const provider = actual.createDefocusImageSpaceProvider(input); captured.calls.push({ input, provider }); return provider; } };
});

import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, simulateCapture, simulateDisplayView, type PlanarSceneRadianceProvider, type SimulateCaptureOptions,
  type SimulateCaptureResult } from "../src/index.js";
import { createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import { createDiffractedPlanarProvider, createZonedGather } from "../src/facade/diffraction-provider.js";
import { internalRadianceAccess, markInternalSceneRadianceEvaluator } from "../src/core/internal-radiance-evaluator.js";
import { createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

type Input = DefocusImageSpaceProviderInput;
const electrons = (environment: unknown, evaluateRadiance: unknown): number => (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never)
  .value as unknown as { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
const filter = { antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } } as const;
const request = (o: { fNumber?: number; pitch?: number; shutterSeconds?: number; motion: SimulateCaptureOptions["motion"]; sensor?: object; width?: number; height?: number }): SimulateCaptureOptions => ({
  scene: { preset: "slanted-edge" }, subjectDistanceM: 2, lens: { prime: 50, fNumber: o.fNumber ?? 8, diffraction: "circular-aperture" },
  sensor: { pixelPitchMicrometers: o.pitch ?? 6, ...filter, ...o.sensor }, exposure: { mode: "manual", iso: 100, shutterSeconds: o.shutterSeconds ?? 1 / 15 },
  output: { width: o.width ?? 20, height: o.height ?? 14 }, ...(o.motion ? { motion: o.motion } : {}), fast: false } as SimulateCaptureOptions);
const yaw = { angularVelocityRadPerSec: { yaw: 0.02 } }, subject = { subject: { velocityMPerSec: { x: 0.5 } } };
const execution = (r: SimulateCaptureResult): unknown => (r.assumptions.find((a) => a.id === "lens.diffraction")!.value as { execution: string }).execution;
/** The last image-space provider the facade built for the lattice taps (#565, `latticeTaps`) or for the new path (`diffractionPsf`). */
const latticeCall = (diffractionPsf: boolean): { input: Input; provider: PlanarSceneRadianceProvider } =>
  captured.calls.filter((c) => ((c.input as Input).diffractionPsf !== undefined) === diffractionPsf).at(-1) as { input: Input; provider: PlanarSceneRadianceProvider };

/** The whole frame's RAW codes and samples under a region's rectangles. */
function expectRegionOfWhole(whole: SimulateCaptureResult, part: SimulateCaptureResult, region: { x: number; y: number; width: number; height: number }, width: number): void {
  const rect = part.region!.nativeRect, nativeWidth = whole.plan.exposure.geometry.nativeRaster.pixelWidth, codes: number[] = [], samples: number[] = [];
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) codes.push(whole.raw.codes[(rect.y + y) * nativeWidth + rect.x + x]!);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width * 3; x++) samples.push(whole.image.samples[((region.y + y) * width + region.x) * 3 + x]!);
  expect(Array.from(part.raw.codes)).toEqual(codes);
  expect(Array.from(part.image.samples)).toEqual(samples);
}

describe("motion with lens.diffraction, the four-spot filter and a box at full quality (#761, #762)", () => {
  it("renders the issues' requests: camera yaw at 1/15 s and 1/60 s, a moving subject at f/8 and f/16 (4 µm), and rolling yaw; a region is the whole frame's pixels", async () => {
    const cases: [string, SimulateCaptureOptions, number][] = [
      ["yaw 1/15 s", request({ motion: yaw }), 4],
      ["yaw 1/60 s", request({ motion: yaw, shutterSeconds: 1 / 60 }), 4],
      ["subject f/8, 4 µm", request({ motion: subject, pitch: 4 }), 5],
      ["subject f/16, 4 µm", request({ motion: subject, pitch: 4, fNumber: 16 }), 10],
      ["rolling yaw 1/60 s", request({ motion: { ...yaw, shutter: "rolling" }, shutterSeconds: 1 / 60 }), 4]];
    const region = { x: 7, y: 5, width: 6, height: 4 };
    for (const [name, options, radius] of cases) {
      const whole = await simulateCapture(options), native = whole.plan.exposure.geometry.nativeRaster;
      expect(execution(whole), name).toBe("image-space-convolution");
      expect(whole.request.diffraction!.execution, name).toBe("image-space-convolution");
      expect(whole.request.diffraction!.profile.kernelRadiusSamples, name).toBe(radius);
      expect((whole.request.siteInput(0).environment as unknown as { psf: { kind: string } }).psf.kind, name).toBe("not-applied");
      // At most 16 midpoints × 21 nodes × 4 spots × 4 box nodes per site (a channel may take fewer nodes), no taps.
      expect(whole.diagnostics.providerEvaluationCount, name).toBeLessThanOrEqual(native.pixelWidth * native.pixelHeight * 16 * 21 * 4 * 4);
      expect(whole.diagnostics.providerEvaluationCount, name).toBeGreaterThan(native.pixelWidth * native.pixelHeight * 16 * 4 * 4);
      expect(latticeCall(true).input.bandRows, name).toBe(name.startsWith("rolling") ? 1 : undefined);
      expectRegionOfWhole(whole, await simulateCapture({ ...options, output: { ...options.output, region } }), region, 20);
    }
  }, scaledTimeout(240_000));

  it("equals the lattice taps' quadrature per site within 1e-9 on requests both paths render (camera yaw and a moving subject, 2 midpoints)", async () => {
    for (const motion of [yaw, subject] as SimulateCaptureOptions["motion"][]) {
      // 2 midpoints × 11 nodes × 4 × 4 × 81 = 28512 queries per site: the quadrature (the bound is 100000); 16 midpoints: 228096.
      captured.calls.length = 0;
      const quadrature = await simulateCapture(request({ motion, sensor: { temporalSampleCount: 2, spectralStepNanometers: 40 }, width: 8, height: 6 }));
      expect(quadrature.request.diffraction!.execution).toBe("environment-psf-quadrature");
      const facadeLattice = latticeCall(false), q = facadeLattice.input;
      // The same request with 16 midpoints takes the new path: its provider's inputs are the quadrature's lattice with the diffraction kernels.
      const sixteen = await simulateCapture(request({ motion, sensor: { spectralStepNanometers: 40 }, width: 8, height: 6 })), next = latticeCall(true).input, d = quadrature.request.diffraction!, R = d.profile.kernelRadiusSamples;
      expect(q.latticeTaps).toBe(true);
      expect(next.queryOffsetsSites).toEqual(q.queryOffsetsSites);
      expect([next.kernelRadius, q.kernelRadius]).toEqual([R, R]);
      expect(next.wavelengthsNm).toEqual(q.wavelengthsNm);
      expect(next.diffractionPsf).toEqual(d.psf.configuration.psf);
      // The new path's provider on the quadrature request's scene and geometry; the reference reads the environment's own PSF taps.
      const lattice = createDefocusImageSpaceProvider({ ...next, base: q.base, geometry: q.geometry, timesPerBand: 2 });
      const noPsf = (sixteen.request.siteInput(0).environment as unknown as { psf: unknown }).psf, native = quadrature.plan.exposure.geometry.nativeRaster;
      let largest = 0;
      // Every fifth site: all four CFA phases, the frame's edges and its centre.
      for (let i = 0; i < native.pixelWidth * native.pixelHeight; i += 5) {
        const environment = quadrature.request.siteInput(i).environment;
        const reference = electrons(environment, facadeLattice.provider.evaluateRadiance.bind(facadeLattice.provider));
        const value = electrons({ ...environment, psf: noPsf }, lattice.evaluateRadiance.bind(lattice));
        largest = Math.max(largest, Math.abs(value - reference) / reference);
      }
      expect(largest).toBeLessThan(1e-9);
    }
  }, scaledTimeout(240_000));

  it("gives the object-space RAW for a still camera through an identity vignetting profile (f/16, 4 µm: 177744 queries per site before)", async () => {
    const flat = { normalizationRadiusMm: 0.25, maximumNormalizedRadius: 1, coefficients: { r2: 0, r4: 0, r6: 0 } };
    const plain = request({ motion: undefined, pitch: 4, fNumber: 16 }), identity = { ...plain, lens: { ...plain.lens, vignetting: flat } } as SimulateCaptureOptions;
    const a = await simulateCapture(plain), b = await simulateCapture(identity);
    expect(execution(a)).toBe("object-space-convolution");
    expect(execution(b)).toBe("image-space-convolution");
    expect(Array.from(b.raw.codes)).toEqual(Array.from(a.raw.codes));
    expect(Array.from(b.image.samples)).toEqual(Array.from(a.image.samples));
  }, scaledTimeout(120_000));

  it("renders a subject at rest as the still scene (#688)", async () => {
    const still = await simulateCapture(request({ motion: undefined, pitch: 4 })), rest = await simulateCapture(request({ motion: { subject: { velocityMPerSec: {} } }, pitch: 4 }));
    expect(Array.from(rest.raw.codes)).toEqual(Array.from(still.raw.codes));
  }, scaledTimeout(60_000));

  it("refuses with the factors (facade-19): a catalogue lens with motion and the filter, a capture without the filter, and the view (rendered since #767); and a band that does not fit", async () => {
    await expect(simulateCapture({ ...request({ motion: yaw }), lens: { catalogue: "pv-50-1.8", fNumber: 8 } } as SimulateCaptureOptions)).rejects.toThrow(
      "These options need 435456 scene queries per site (temporal samples × spectral nodes × pupil rays × filter spots × pixel-aperture nodes × PSF taps: 16 × 21 × 1 × 4 × 4 × 81); the environment admits at most 100000.");
    const issue = { scene: { preset: "slanted-edge" }, sensor: { pixelAperture: { kind: "box", samplesPerAxis: 16 }, temporalSampleCount: 256 }, motion: { angularVelocityRadPerSec: { yaw: 0.01 } },
      output: { width: 4, height: 4 } } as SimulateCaptureOptions;
    await expect(simulateCapture(issue)).rejects.toThrow("These options need 1376256 scene queries per site (temporal samples × spectral nodes × pupil rays × filter spots × pixel-aperture nodes × PSF taps: 256 × 21 × 1 × 1 × 256 × 1); the environment admits at most 100000.");
    // The display view does not query per site: without the filter it renders as before; with it, since #767, it counts as the capture does
    // (the taps summed on the site lattice), so the yaw request renders (test/display-view-motion-diffraction-lattice-1.test.ts to -3).
    const view = { ...issue, sensor: { ...issue.sensor, temporalSampleCount: 32 }, output: { width: 48, height: 32 } } as SimulateCaptureOptions;
    await expect(simulateCapture(view)).rejects.toThrow("These options need 172032 scene queries per site");
    await expect(simulateDisplayView(view, { width: 24, height: 16 })).resolves.toBeDefined();
    await expect(simulateDisplayView({ ...request({ motion: yaw, width: 48, height: 32 }) }, { width: 24, height: 16 })).resolves.toBeDefined();
    // 80 nodes × 16 instants × 4 shifts × a 484-site lattice row × 4 rows kept: 76 MiB.
    await expect(simulateCapture(request({ motion: yaw, sensor: { spectralStepNanometers: 5 }, width: 480, height: 4 }))).rejects.toThrow(
      /^The image-space convolution keeps 76 MiB for one row of sites \(80 spectral nodes × 16 instants × 4 lattice shifts × 484 sites × 4 rows, and one row's grid\); the limit is 64 MiB\. Render a narrower output\.region\.$/);
  }, scaledTimeout(120_000));
});

describe("the image-space provider's band budget (#761)", () => {
  it("lowers the band height to fit, down to one row, and the values do not change", () => {
    const { base, geometry, common } = fixture(6);
    const kernel = createDefocusDiscSiteKernel(5)!, input: Input = { ...common, base, geometry, siteKernels: () => kernel.weights, kernelRadius: kernel.radius,
      queryOffsetsSites: [{ x: 0, y: 0 }, { x: -0.75, y: 0.25 }, { x: 0.5, y: 0 }], timesPerBand: 3, timeDependentScene: true, materialCount: 6 };
    const read = (p: PlanarSceneRadianceProvider): number[] => valuesOf(p, geometry, common, [0, 1e-3, 2e-3]);
    const reference = read(createDefocusImageSpaceProvider(input));
    // One row: 3 shifts × 20 nodes × 98 lattice columns × 8 bytes × 3 instants × 4 rows kept, and one row's grid at 40 bytes a point.
    const r = kernel.radius, oneRow = 3 * 20 * 98 * 8 * 3 * 4 + (98 + 2 * r) * (1 + 2 * r) * 40;
    for (const capacityBytes of [2 ** 26, 2 ** 21, 2 ** 20, oneRow]) expect(read(createDefocusImageSpaceProvider({ ...input, capacityBytes }))).toEqual(reference);
    expect(() => createDefocusImageSpaceProvider({ ...input, capacityBytes: oneRow - 1 })).toThrow(
      "The image-space convolution keeps 1 MiB for one row of sites (20 spectral nodes × 3 instants × 3 lattice shifts × 98 sites × 4 rows, and one row's grid); the limit is " + (oneRow - 1) / 1048576 + " MiB.");
  });
});

/**
 * A 96 × 64 material scene of `count` vertical stripes 2.4 sites wide (the plane about as wide as the frame sees), its vignetting geometry and
 * the provider's common inputs. Before facade-14, its 8 × 6 window differed from the whole raster in 612 of 960 values with 40 materials (the
 * window regrouped by material, the whole raster did not) and in 70 with 6 (another order of the materials), by at most 6.5e-16 relative.
 */
function fixture(count: number): { base: PlanarSceneRadianceProvider; geometry: ReturnType<typeof prepareDefocusImageSpaceGeometry>; common: Omit<Input, "base" | "geometry" | "siteKernels" | "kernelRadius"> } {
  const W = 96, H = 64, g = 2 / W;
  const base = createPlanarSceneRadianceProvider({ scene: { kind: "material-function", sceneId: "stripes-" + count, materials: Array.from({ length: count }, (_, m) => 0.05 + 0.9 * m / Math.max(1, count - 1)),
    materialAt: (p: { u: number }) => Math.floor(p.u / (2.4 * g) + 1000) % count } as never,
  illuminant: { kind: "planckian", temperatureKelvin: 5000 }, illuminanceLux: 1000, distanceM: 2, framedWidthM: 0.0224, aspect: H / W, sceneId: "s", providerProfileId: "p" });
  markInternalSceneRadianceEvaluator(base.evaluateRadiance);
  const geometry = prepareDefocusImageSpaceGeometry({ focalLengthMm: 50, focusDistanceM: 1.8, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 },
    vignetting: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { r2: -0.3, r4: 0, r6: 0 } } });
  return { base, geometry, common: { wavelengthsNm: Array.from({ length: 20 }, (_, i) => 400 + 20 * i), nativeWidth: W, nativeHeight: H, sitePitchMicrometers: 6, distanceM: 2, metresPerFrameUnit: 0.0112 } };
}

/** The provider's value at every site centre of the 8 × 6 window at (40, 30), at each time and node (through the lean executor's access). */
function valuesOf(p: PlanarSceneRadianceProvider, geometry: ReturnType<typeof prepareDefocusImageSpaceGeometry>, common: { nativeWidth: number; nativeHeight: number; wavelengthsNm: readonly number[] },
  times: readonly number[] = [0]): number[] {
  const access = internalRadianceAccess(p.evaluateRadiance)!, out: number[] = [], mm = 6 / 1000;
  for (const t of times) for (let y = 30; y < 36; y++) for (let x = 40; x < 48; x++) {
    const look = geometry.lookOf((x + 0.5 - common.nativeWidth / 2) * mm, (y + 0.5 - common.nativeHeight / 2) * mm, t);
    const key = access.keyOfDirection({ x: -look.x, y: -look.y, z: -look.z }, t)!;
    for (const nm of common.wavelengthsNm) out.push(access.radianceOfKey(key, nm));
  }
  return out;
}

describe("#730 facade-14: the image-space provider's values do not depend on the window", () => {
  for (const count of [40, 6]) {
    it(`${count} materials, 20 nodes: an 8 × 6 window of 96 × 64 gives the whole raster's bits`, () => {
      const { base, geometry, common } = fixture(count), kernel = createDefocusDiscSiteKernel(5)!;
      const input: Input = { ...common, base, geometry, siteKernels: () => kernel.weights, kernelRadius: kernel.radius, materialCount: count };
      const whole = valuesOf(createDefocusImageSpaceProvider(input), geometry, common), part = valuesOf(createDefocusImageSpaceProvider({ ...input, window: { x: 40, y: 30, width: 8, height: 6 } }), geometry, common);
      expect(part.filter((v, i) => v !== whole[i]).length).toBe(0);
      // Regrouped by material or not, the same sum to rounding.
      const perNode = valuesOf(createDefocusImageSpaceProvider({ ...input, materialCount: undefined }), geometry, common);
      expect(Math.max(...perNode.map((v, i) => Math.abs(v - whole[i]!) / v))).toBeLessThan(1e-12);
    });
  }
});

describe("#730 facade-12: field-zone kernels are built once per band and shift", () => {
  it("96 × 64 sites, zones of 12 (8 × 6 zones), 20 nodes: 48 kernels built (656 before facade-12)", () => {
    const W = 96, H = 64, R = 2, kernel = Float64Array.from({ length: 25 }, () => 1 / 25);
    let built = 0;
    const zones = { size: 12, columns: 8, rows: 6, kernelOf: (): Float64Array => { built++; return kernel; } };
    const base = createPlanarSceneRadianceProvider({ scene: { preset: "siemens-star" }, illuminant: { kind: "planckian", temperatureKelvin: 5000 }, illuminanceLux: 1000, distanceM: 2,
      framedWidthM: 0.5, aspect: H / W, sceneId: "s", providerProfileId: "p" });
    markInternalSceneRadianceEvaluator(base.evaluateRadiance);
    const wavelengthsNm = Array.from({ length: 20 }, (_, i) => 400 + 20 * i);
    const zoned = createDiffractedPlanarProvider({ base, siteKernels: () => kernel, fieldZones: zones, wavelengthsNm, kernelRadius: R, nativeWidth: W, nativeHeight: H, outputWidth: W,
      sitePitchMicrometers: 6, distanceM: 2, metresPerFrameUnit: 0.25 });
    const plain = createDiffractedPlanarProvider({ base, siteKernels: () => kernel, wavelengthsNm, kernelRadius: R, nativeWidth: W, nativeHeight: H, outputWidth: W, sitePitchMicrometers: 6,
      distanceM: 2, metresPerFrameUnit: 0.25 });
    const a = internalRadianceAccess(zoned.evaluateRadiance)!, b = internalRadianceAccess(plain.evaluateRadiance)!, g = 2 / W;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      // The plane point of site (x, y), as an outgoing direction at the plane distance (frame units of 0.25 m).
      const u = (x + 0.5 - W / 2) * g * 0.25, v = -(y + 0.5 - H / 2) * g * 0.25, n = Math.hypot(u, v, 2), o = { x: -u / n, y: -v / n, z: -2 / n };
      const ka = a.keyOfDirection(o, 0)!, kb = b.keyOfDirection(o, 0)!;
      // One kernel in every zone: the zoned gather gives gatherInterior's bits.
      for (const nm of wavelengthsNm) expect(a.radianceOfKey(ka, nm)).toBe(b.radianceOfKey(kb, nm));
    }
    expect(built).toBe(48);
  });

  it("gathers several arrays in one pass with each array's own bits", () => {
    const R = 1, gridWidth = 6 + 2 * R, rows = 4, kernelA = Float64Array.from({ length: 9 }, (_, k) => (k + 1) / 50), kernelB = Float64Array.from({ length: 9 }, (_, k) => (k === 4 ? 0.6 : 0.05));
    const zoned = createZonedGather({ size: 3, columns: 2, rows: 2, kernelOf: (z) => (z % 2 ? kernelA : kernelB) }, R, gridWidth, 6, 4, 0);
    const arrays = [0, 1, 2].map((s) => Float64Array.from({ length: gridWidth * (rows + 2 * R) }, (_, k) => ((k * 37 + s * 11) % 17) / 16));
    const together = zoned(arrays, 0, 0, 6, rows);
    arrays.forEach((samples, i) => expect(Array.from(together[i]!)).toEqual(Array.from(zoned([samples], 0, 0, 6, rows)[0]!)));
  });
});
