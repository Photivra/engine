// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, simulateCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { createDiffractedPlanarProvider } from "../src/facade/diffraction-provider.js";
import { createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #565: with lens.diffraction in focus, a lens option (here an identity lens.vignetting profile, every coefficient 0) sends the capture
 * through the environment PSF quadrature, while the request without it takes the object-space convolution, which reads the scene on the
 * site lattice. The quadrature formed each tap's source point from its own site, so on a Siemens star, whose sector boundaries pass
 * through lattice points (the diagonals through a symmetric frame's centre, the vertical through an odd frame's centre column), a source
 * point exactly on a boundary could resolve to the other material: 3 % apart next to the centre of a 20 × 14 star at f/11. The quadrature now
 * reads each tap's source at the lattice point's own plane point (#548's lattice formula), so a tie resolves the same way on both paths.
 */

const flat = { normalizationRadiusMm: 0.25, maximumNormalizedRadius: 1, coefficients: { r2: 0, r4: 0, r6: 0 } };
const electrons = (environment: unknown, evaluateRadiance: unknown): number => (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never)
  .value as unknown as { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;

describe("in-focus lens.diffraction resolves chart-boundary ties as the lattice does (#565)", () => {
  // A symmetric frame (the star's diagonals through lattice points) and an odd-width one (its vertical spokes through the centre column).
  for (const [width, height] of [[20, 14], [21, 14]] as const) {
    it(`a ${width} × ${height} Siemens star: an identity vignetting profile gives the same expected electrons at every site, and the same RAW`, async () => {
      const options: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width, height }, lens: { fNumber: 11, diffraction: "circular-aperture" },
        sensor: { spectralStepNanometers: 40 } };
      const plain = await simulateCapture(options), identity = await simulateCapture({ ...options, lens: { ...options.lens, vignetting: flat } });
      expect(plain.request.diffraction!.execution).toBe("object-space-convolution");
      expect(identity.request.diffraction!.execution).toBe("environment-psf-quadrature");
      expect(Array.from(identity.raw.codes)).toEqual(Array.from(plain.raw.codes));
      // Each site's expected electrons: the plain capture's object-space provider, against the identity capture's own site record (with the
      // PSF and the profile) evaluated per tap through the lattice reader the capture gives the quadrature.
      const native = plain.raw.plan.exposure.geometry.nativeRaster, d = plain.request.diffraction!, r: SimulateCaptureResult = plain;
      const sharp = createPlanarSceneRadianceProvider({ scene: options.scene as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: r.scene.illuminant.illuminanceLux,
        distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: r.scene.framedHeightM / r.scene.framedWidthM, sceneId: "facade-scene", providerProfileId: "facade-provider" });
      const common = { base: sharp, wavelengthsNm: d.profile.profile.axes.wavelengthNm, nativeWidth: native.pixelWidth, nativeHeight: native.pixelHeight, sitePitchMicrometers: 6,
        distanceM: r.scene.distanceM, metresPerFrameUnit: r.scene.framedWidthM / 2 };
      const diffracted = createDiffractedPlanarProvider({ ...common, psf: d.psf.configuration.psf, kernelRadius: d.profile.kernelRadiusSamples, outputWidth: width });
      const R = d.profile.kernelRadiusSamples;
      const lattice = createDefocusImageSpaceProvider({ ...common, geometry: prepareDefocusImageSpaceGeometry({ focalLengthMm: (identity.request.siteInput(0).environment as unknown as { optics: { focalLengthMm: number } }).optics.focalLengthMm, focusDistanceM: r.scene.distanceM,
        angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 }, vignetting: flat }), siteKernels: () => new Float64Array([1]), kernelRadius: 0,
      queryOffsetsSites: [{ x: 0, y: 0 }, { x: R, y: R }] });
      let largest = 0;
      for (let i = 0; i < native.pixelWidth * native.pixelHeight; i++) {
        const reference = electrons(plain.request.siteInput(i).environment, diffracted.evaluateRadiance.bind(diffracted));
        const value = electrons(identity.request.siteInput(i).environment, lattice.evaluateRadiance.bind(lattice));
        largest = Math.max(largest, Math.abs(value - reference) / reference);
      }
      expect(largest).toBeLessThan(1e-9);
    }, scaledTimeout(120_000));
  }
});

describe("lens.diffraction.rollingShutterLatticeTaps: the lattice reading under a rolling shutter with camera rotation (#565)", () => {
  const options = (scene: "siemens-star" | "dead-leaves", rollingShutterLatticeTaps?: boolean, format?: "dng" | "jpeg"): SimulateCaptureOptions => ({ scene: { preset: scene },
    output: { width: 13, height: 8, ...(format ? { format } : {}) }, motion: { angularVelocityRadPerSec: { pitch: 0.02 }, shutter: "rolling" }, sensor: { spectralStepNanometers: 80, temporalSampleCount: 2 },
    lens: { fNumber: 11, diffraction: rollingShutterLatticeTaps === undefined ? "circular-aperture" : { kind: "circular-aperture", rollingShutterLatticeTaps } } });
  const assumption = (r: SimulateCaptureResult): unknown => r.assumptions.find((a) => a.id === "lens.diffraction.rollingShutterLatticeTaps")?.value;

  it("is off by default (per-tap points), on by default for a DNG or JPEG, and an explicit value wins", async () => {
    const off = await simulateCapture(options("siemens-star")), on = await simulateCapture(options("siemens-star", true));
    const dng = await simulateCapture(options("siemens-star", undefined, "dng")), dngOff = await simulateCapture(options("siemens-star", false, "dng"));
    const jpeg = await simulateCapture(options("siemens-star", undefined, "jpeg"));
    expect(off.request.diffraction!.execution).toBe("environment-psf-quadrature");
    expect([off, on, dng, dngOff, jpeg].map(assumption)).toEqual([false, true, true, false, true]);
    // A pitch rotation keeps the odd frame's centre column on the star's vertical spokes (u = 0 on the lattice): ties, where the two
    // readings differ; a DNG or JPEG takes the lattice one.
    expect(Array.from(on.raw.codes)).not.toEqual(Array.from(off.raw.codes));
    expect(Array.from(dng.raw.codes)).toEqual(Array.from(on.raw.codes));
    expect(Array.from(dngOff.raw.codes)).toEqual(Array.from(off.raw.codes));
    expect(Array.from(jpeg.raw.codes)).toEqual(Array.from(on.raw.codes));
  }, scaledTimeout(120_000));

  it("changes nothing but ties: dead leaves give the same RAW either way", async () => {
    const off = await simulateCapture(options("dead-leaves", false)), on = await simulateCapture(options("dead-leaves", true));
    expect(Array.from(on.raw.codes)).toEqual(Array.from(off.raw.codes));
  }, scaledTimeout(120_000));
});
