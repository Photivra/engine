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

/*
 * #588, owner decision: with camera rotation under `motion.shutter: "rolling"` every row has its own instants, so reading the lattice
 * costs a band per instant. There the per-tap points are `lens.catalogue`'s fast choice (the field-grid method never runs with
 * rotation) and the lattice reading its full method: the record's `fast`, else the top-level `fast`, else fast except for a DNG, JPEG
 * or PNG. `diagnostics.fast.applied["lens.catalogue"]` is true where the per-tap points ran, with the `fast.lens.catalogue` assumption.
 */
describe("lens.catalogue with rotation under a rolling shutter: the per-tap points are the fast choice (#588)", () => {
  const rolling = (scene: "siemens-star" | "dead-leaves", lens = "pv-24-1.8", extra: { fast?: boolean; record?: boolean; format?: "dng" | "jpeg" | "png" } = {}): SimulateCaptureOptions => ({
    scene: { preset: scene }, subjectDistanceM: 3, output: { width: 21, height: 14, ...(extra.format ? { format: extra.format } : {}) },
    sensor: { pixelPitchMicrometers: 60, spectralStepNanometers: 80, temporalSampleCount: 2 }, motion: { angularVelocityRadPerSec: { pitch: 0.02 }, shutter: "rolling" },
    lens: { catalogue: extra.record === undefined ? lens : { kind: lens, fast: extra.record }, fNumber: lens === "pv-24-1.8" ? 1.8 : 3.5 },
    exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 }, ...(extra.fast === undefined ? {} : { fast: extra.fast }) });
  const ranFast = (r: SimulateCaptureResult): boolean | undefined => r.diagnostics.fast.applied["lens.catalogue"];

  it("defaults to the per-tap points on screen and to the lattice for a DNG, JPEG or PNG; an explicit fast wins and is reported", async () => {
    const screen = await simulateCapture(rolling("siemens-star")), full = await simulateCapture(rolling("siemens-star", undefined, { record: false }));
    expect(screen.diagnostics.fast).toEqual({ requested: false, applied: { "lens.catalogue": true }, assurance: "approximation-with-a-priori-bound" });
    expect((screen.assumptions.find((a) => a.id === "fast.lens.catalogue")!.value as { method: string }).method).toBe("per-tap-points");
    expect(full.diagnostics.fast).toEqual({ requested: false, applied: { "lens.catalogue": false }, assurance: "engine-reference" });
    expect(full.assumptions.some((a) => a.id === "fast.lens.catalogue")).toBe(false);
    // A pitch rotation keeps the odd frame's centre column on the star's vertical spokes: ties, where the two readings differ.
    expect(Array.from(full.raw.codes)).not.toEqual(Array.from(screen.raw.codes));
    const cases: [Parameters<typeof rolling>[2], boolean][] = [[{ format: "dng" }, false], [{ format: "jpeg" }, false], [{ format: "png" }, false],
      [{ format: "dng", record: true }, true], [{ format: "dng", fast: true }, true], [{ fast: false }, false], [{ fast: true, record: false }, false], [{ fast: false, record: true }, true]];
    for (const [extra, fast] of cases) {
      const r = await simulateCapture(rolling("siemens-star", undefined, extra));
      expect(ranFast(r), JSON.stringify(extra)).toBe(fast);
      expect(Array.from(r.raw.codes), JSON.stringify(extra)).toEqual(Array.from((fast ? screen : full).raw.codes));
    }
  }, scaledTimeout(240_000));

  it("changes nothing but ties: dead leaves give the same RAW either way, also through a fisheye beyond its horizon", async () => {
    for (const lens of ["pv-24-1.8", "pv-8-3.5-fisheye-pro"]) {
      const fast = await simulateCapture(rolling("dead-leaves", lens, { record: true })), full = await simulateCapture(rolling("dead-leaves", lens, { record: false }));
      expect([ranFast(fast), ranFast(full)], lens).toEqual([true, false]);
      expect(Array.from(full.raw.codes), lens).toEqual(Array.from(fast.raw.codes));
    }
  }, scaledTimeout(240_000));
});
