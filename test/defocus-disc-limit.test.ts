// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES, InvalidConfigurationError, InvalidScientificInputError, calculateDefocusCircle,
  calculateDefocusDiscKernelRadius, prepareDisplayView, simulateCapture, simulateIdealReference, type SimulateCaptureOptions } from "../src/index.js";
import { defocusDiscKernelRadius, resolveDefocusDisc } from "../src/optics/defocus-disc-kernel.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #532: the defocus size limit and its pre-check are root exports, and the pre-check agrees with the renderer's refusal
 * at the boundary.
 */

const defocus = { model: "geometric-disc" } as const;
const lensAt = { focalLengthMm: 50, aperture: 4, subjectDistanceM: 2, pixelPitchMicrometers: 6 } as const;
const check = (focusDistanceM: number): ReturnType<typeof calculateDefocusDiscKernelRadius>["value"] =>
  calculateDefocusDiscKernelRadius({ ...lensAt, focusDistanceM }).value;

/**
 * The focus distances on either side of the limit, focused in front of a plane at 2 m (50 mm f/4, 6 µm): the blur
 * shrinks as the focus distance grows towards the subject, so bisect between a refused 0.5 m and an accepted 1.9 m to
 * two adjacent doubles.
 */
function boundaryFocusDistances(): { inside: number; outside: number } {
  let outside = 0.5, inside = 1.9;
  expect(check(outside).withinLimit).toBe(false);
  expect(check(inside).withinLimit).toBe(true);
  for (;;) {
    const mid = outside + (inside - outside) / 2;
    if (mid === outside || mid === inside) break;
    if (check(mid).withinLimit) inside = mid; else outside = mid;
  }
  return { inside, outside };
}

describe("DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES and calculateDefocusDiscKernelRadius (#532)", () => {
  it("exports the limit of 64 sites, a disc of at most 129 sites across", () => {
    expect(DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES).toBe(64);
    expect(defocusDiscKernelRadius(129)).toBe(64);
    expect(defocusDiscKernelRadius(129 + 2 ** -45)).toBe(65);
    const atLimit = calculateDefocusDiscKernelRadius({ ...lensAt, focusDistanceM: 1.8 }).value;
    expect(atLimit.maximumKernelRadiusSites).toBe(64);
    expect(atLimit.maximumDiameterSites).toBe(129);
  });

  it("reports the same disc the capture resolves, with the closed form and the documented fields", () => {
    // 50 mm f/4 focused at 0.5 m on a plane at 2 m: c = 2500·1.5/(4·2·0.45) mm = 1041.7 µm, 173.6 sites of 6 µm, radius 87 > 64.
    const result = calculateDefocusDiscKernelRadius({ ...lensAt, focusDistanceM: 0.5 });
    const c = calculateDefocusCircle({ focalLengthMm: 50, aperture: 4, focusDistanceM: 0.5, subjectDistanceM: 2 }).value.diameterMm * 1000;
    expect(result.value).toEqual({ diameterMicrometers: c, diameterSites: c / 6, kernelRadiusSites: 87, maximumKernelRadiusSites: 64,
      maximumDiameterSites: 129, withinLimit: false, excessKernelRadiusSites: 23 });
    expect(result.value.diameterMicrometers).toBeCloseTo(2500 * 1.5 / (4 * 2 * 0.45), 9);
    expect(resolveDefocusDisc({ focalLengthMm: 50, aperture: 4, focusDistanceM: 0.5, subjectDistanceM: 2, pitchMicrometers: 6 }))
      .toEqual({ diameterMicrometers: c, diameterSites: c / 6, kernelRadiusSites: 87 });
    expect(result.provenance).toMatchObject({ model: "defocus-disc-kernel-radius", modelVersion: "1.0.0" });
    expect((result.provenance.assumptions ?? []).join(" ")).toMatch(/approximation/u);
    expect(Object.isFrozen(result.value)).toBe(true);
    // Within the limit: 1.8 m gives c = 2500·0.2/(4·2·1.75) mm = 35.7 µm, 5.95 sites, radius 3.
    expect(check(1.8)).toMatchObject({ kernelRadiusSites: 3, withinLimit: true, excessKernelRadiusSites: 0 });
    // docs/USAGE.md's example: 50 mm f/1.4 focused at 1 m on a plane at 2 m, 6 µm: 156.6 sites, radius 78, 14 over.
    expect(calculateDefocusDiscKernelRadius({ focalLengthMm: 50, aperture: 1.4, focusDistanceM: 1, subjectDistanceM: 2, pixelPitchMicrometers: 6 }).value)
      .toMatchObject({ withinLimit: false, kernelRadiusSites: 78, excessKernelRadiusSites: 14 });
  });

  it("gives radius 0 in focus, and for a disc inside one site", () => {
    expect(check(2)).toEqual({ diameterMicrometers: 0, diameterSites: 0, kernelRadiusSites: 0, maximumKernelRadiusSites: 64, maximumDiameterSites: 129,
      withinLimit: true, excessKernelRadiusSites: 0 });
    expect(check(1.999)).toMatchObject({ kernelRadiusSites: 0, withinLimit: true });
    expect(check(1.999).diameterSites).toBeGreaterThan(0);
    // Behind the subject (focused past it) the disc is measured the same way.
    expect(calculateDefocusDiscKernelRadius({ ...lensAt, focusDistanceM: 3 }).value.withinLimit).toBe(true);
  });

  it("at adjacent focus distances, agrees with simulateCapture's, the display view's and the ideal reference's accept and refuse", async () => {
    const { inside, outside } = boundaryFocusDistances();
    expect(check(inside)).toMatchObject({ kernelRadiusSites: 64, withinLimit: true, excessKernelRadiusSites: 0 });
    expect(check(inside).diameterSites).toBeLessThanOrEqual(129);
    expect(check(outside)).toMatchObject({ kernelRadiusSites: 65, withinLimit: false, excessKernelRadiusSites: 1 });
    expect(check(outside).diameterSites).toBeGreaterThan(129);

    const request = (focusDistanceM: number): SimulateCaptureOptions => ({ scene: { preset: "slanted-edge" }, subjectDistanceM: 2,
      lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM, defocus }, sensor: { pixelPitchMicrometers: 6 }, output: { width: 4, height: 4 } });
    const limit = /lens\.defocus: the blur circle is .*needs a kernel radius of 65 sites; the limit is 64 sites \(DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES\)/u;
    await expect(simulateCapture(request(outside))).rejects.toThrow(limit);
    await expect(prepareDisplayView(request(outside))).rejects.toThrow(limit);
    await expect(simulateIdealReference(request(outside))).rejects.toThrow(limit);

    const accepted = await simulateCapture(request(inside));
    expect(accepted.assumptions.find((a) => a.id === "lens.defocus")!.value).toMatchObject({ kernelRadiusSites: 64, diameterSites: check(inside).diameterSites,
      diameterMicrometers: check(inside).diameterMicrometers, execution: "object-space-convolution" });
    await expect(prepareDisplayView(request(inside))).resolves.toBeDefined();
  }, scaledTimeout(120_000));

  it("agrees in an automatic exposure mode at the resolved f-number", async () => {
    const request: SimulateCaptureOptions = { scene: { preset: "slanted-edge" }, subjectDistanceM: 2, exposure: { mode: "program" },
      lens: { focalLengthMm: 50, focusDistanceM: 1.8, defocus }, output: { width: 8, height: 8 } };
    const r = await simulateCapture(request);
    const value = r.assumptions.find((a) => a.id === "lens.defocus")!.value as { diameterSites: number; kernelRadiusSites: number };
    const pre = calculateDefocusDiscKernelRadius({ focalLengthMm: 50, aperture: r.exposure.settings.fNumber, focusDistanceM: 1.8, subjectDistanceM: 2,
      pixelPitchMicrometers: 6 }).value;
    expect(pre.diameterSites).toBe(value.diameterSites);
    expect(pre.kernelRadiusSites).toBe(value.kernelRadiusSites);
  });

  it("validates its input", () => {
    const valid = { ...lensAt, focusDistanceM: 1.8 };
    expect(() => calculateDefocusDiscKernelRadius({ ...valid, pixelPitchMm: 0.006 } as never))
      .toThrow(new InvalidConfigurationError('calculateDefocusDiscKernelRadius input has unknown field "pixelPitchMm".'));
    expect(() => calculateDefocusDiscKernelRadius(null as never)).toThrow(InvalidConfigurationError);
    for (const pixelPitchMicrometers of [0, -6, Number.NaN, Number.POSITIVE_INFINITY, undefined, "6"]) {
      expect(() => calculateDefocusDiscKernelRadius({ ...valid, pixelPitchMicrometers } as never))
        .toThrow(new InvalidScientificInputError("pixelPitchMicrometers must be a finite number greater than zero."));
    }
    for (const field of ["focalLengthMm", "aperture", "focusDistanceM", "subjectDistanceM"] as const) {
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
        expect(() => calculateDefocusDiscKernelRadius({ ...valid, [field]: bad } as never), field).toThrow(InvalidScientificInputError);
      }
    }
    expect(() => calculateDefocusDiscKernelRadius({ ...valid, focusDistanceM: 0.04 })).toThrow(/beyond the focal length/u);
    // A pitch so small that the diameter in sites is not finite fails rather than returning Infinity.
    expect(() => calculateDefocusDiscKernelRadius({ ...valid, pixelPitchMicrometers: 1e-320 })).toThrow(InvalidScientificInputError);
  });
});
