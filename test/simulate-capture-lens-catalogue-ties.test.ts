// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, simulateCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { createCatalogueLensSignal, setCatalogueLensSignalTestHook, type CatalogueLensSignalInput } from "../src/facade/catalogue-lens-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #588: with `lens.catalogue` the capture's exact method (the environment PSF quadrature) formed each tap's source point from its
 * own site's arithmetic, so on a Siemens star, whose sector boundaries pass through lattice points (the diagonals through a
 * symmetric frame's centre, the vertical spokes through an odd frame's centre column), a tap exactly on a boundary could resolve
 * to the other material than on the lattice (the fast method's, the display view's and #548's lattice formula). The quadrature
 * now reads each tap's source at its lattice point (#548's image-space provider with a one-tap kernel, as #565 does for
 * lens.diffraction), so a tie resolves the same way on every path.
 *
 * The lattice reading here is the fast method's own sum with every site's kernels resolved exactly (`exactKernels`, the test
 * hook): the exact method's sum on the lattice formula, through the same sensor stage. Its tap points are those of the default fast
 * method (the field-grid blend changes only the kernels), so the RAW equality shows both methods read the lattice. The fisheye's
 * frame reaches beyond its 180° image circle, where both read zero radiance (beyond the horizon).
 */

afterEach(() => setCatalogueLensSignalTestHook(undefined));

const options = (lens: string, fNumber: number, width: number, height: number): SimulateCaptureOptions => ({ scene: { preset: "siemens-star" }, subjectDistanceM: 3,
  output: { width, height }, sensor: { pixelPitchMicrometers: 60, spectralStepNanometers: 50 }, lens: { catalogue: lens, fNumber },
  exposure: { mode: "manual", shutterSeconds: (fNumber / 8) ** 2 / 125, iso: 100 } });
const electrons = (environment: unknown, evaluateRadiance: unknown): number => (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never)
  .value as unknown as { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;

describe("lens.catalogue resolves chart-boundary ties as the lattice does (#588)", () => {
  // A field-varying rectilinear lens wide open and a circular fisheye; a symmetric frame and an odd-width one.
  for (const [lens, fNumber] of [["pv-24-1.8", 1.8], ["pv-8-3.5-fisheye-pro", 3.5]] as const) for (const [width, height] of [[20, 14], [21, 14]] as const) {
    it(`${lens}, a ${width} × ${height} Siemens star: the exact method's RAW is the lattice reading's, and the per-tap points differ at ties`, async () => {
      const o = options(lens, fNumber, width, height);
      const exact = await simulateCapture(o);
      let input: CatalogueLensSignalInput | undefined;
      setCatalogueLensSignalTestHook({ exactKernels: true, onInput: (given) => { input ??= given; } });
      const lattice = await simulateCapture({ ...o, fast: true });
      setCatalogueLensSignalTestHook(undefined);
      expect(exact.diagnostics.fast.applied["lens.catalogue"]).toBe(false);
      expect(lattice.diagnostics.fast.applied["lens.catalogue"]).toBe(true);
      expect(Array.from(exact.raw.codes)).toEqual(Array.from(lattice.raw.codes));
      // The case has ties: each site's expected electrons with every tap at its own site's point (the plain provider, zero beyond
      // the horizon as the capture's) against the lattice reading. They agree to rounding except where a tap lies on a boundary.
      const r: SimulateCaptureResult = exact, signal = createCatalogueLensSignal({ ...input!, exactKernels: true });
      const plain = createPlanarSceneRadianceProvider({ scene: o.scene as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: r.scene.illuminant.illuminanceLux,
        distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: r.scene.framedHeightM / r.scene.framedWidthM, sceneId: "facade-scene", providerProfileId: "facade-provider" });
      const perTap = (request: { target: { outgoingDirectionUnitVector: { z: number } } }): unknown => {
        if (request.target.outgoingDirectionUnitVector.z < 0) return plain.evaluateRadiance(request as never);
        const forward = plain.evaluateRadiance({ ...request, target: { ...request.target, outgoingDirectionUnitVector: { x: 0, y: 0, z: -1 } } } as never);
        return { ...forward, spectralRadianceWattsPerSquareMeterSteradianNanometer: 0 };
      };
      let ties = 0, largest = 0, agree = 0;
      for (let i = 0; i < input!.nativeWidth * input!.nativeHeight; i++) {
        const x = i % input!.nativeWidth, y = Math.floor(i / input!.nativeWidth), reference = signal.site(x, y), value = electrons(r.request.siteInput(i).environment, perTap);
        const difference = Math.abs(value - reference) / Math.max(reference, 1e-300);
        if (difference > 1e-6) { ties++; largest = Math.max(largest, difference); } else agree = Math.max(agree, difference);
      }
      expect(ties).toBeGreaterThan(0);
      expect(largest).toBeGreaterThan(1e-3);
      expect(agree).toBeLessThan(1e-9);
    }, scaledTimeout(120_000));
  }
});
