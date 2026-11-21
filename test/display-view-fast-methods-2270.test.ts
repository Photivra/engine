// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions, type SimulateDisplayViewOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { lastDisplayViewLensSetup } from "../src/facade/display-view-lens-signal.js";
import { prepareDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import type { undistortedImagePoint } from "../src/optics/sensor-environment-query.js";
import { SIMULATE_CAPTURE_FAST_METHODS } from "../src/facade/fast-methods.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.27.0: the facade's choice of the new fast methods (docs/API_STYLE.md, "Exact and fast modes"): the fast method by default for the
 * display view, the full method with fast: false, and the option record's own flag over the top-level one. The methods themselves are
 * tested in test/display-view-lens-regrouped.test.ts (#651) and test/display-view-lens-catalogue-regrouped-1.test.ts and -2.test.ts (#655).
 */

type Value = Record<string, unknown>;
const assumption = (r: { assumptions: readonly { id: string; value: unknown }[] }, id: string): Value | undefined => r.assumptions.find((a) => a.id === id)?.value as Value | undefined;

describe("motion.shutter.rolling/view-row-bands (#651)", () => {
  // Rotation under a rolling shutter with a defocus disc of radius 11 (50 mm f/4 focused at 1.4 m, subject at 2 m, 6 µm sites).
  const options: SimulateCaptureOptions = { scene: { preset: "siemens-star", cycles: 12 }, subjectDistanceM: 2, output: { width: 48, height: 32 }, sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 80 },
    exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 }, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.4, defocus: { model: "geometric-disc" } },
    motion: { angularVelocityRadPerSec: { yaw: 0.001 }, shutter: "rolling", rollingShutterSkewSeconds: 0.004 } };
  const view: SimulateDisplayViewOptions = { width: 24, height: 16 };

  it("groups rows into bands by default and reads each row at its own instants with fast: false", async () => {
    const fast = await simulateDisplayViewWithInternals(options, view);
    expect(lastDisplayViewLensSetup()!.lens.rollingBands).toBe(true);
    const bands = assumption(fast.result, "view.defocus")!.rollingBands as { rows: number; shiftSites: number };
    expect(bands.rows).toBeGreaterThan(1);
    expect(bands.shiftSites).toBeGreaterThan(0);
    expect(bands.shiftSites).toBeLessThanOrEqual(1 / 128);
    expect(assumption(fast.result, "view.defocus")).toMatchObject({ convolution: "runs", fast: "defocus-after-in-focus-signal" });
    const exact = await simulateDisplayViewWithInternals({ ...options, fast: false }, view);
    expect(lastDisplayViewLensSetup()!.lens.rollingBands).toBe(false);
    // The full method is the tap sum regrouped by rows (the same sum), so it is taken with fast: false too, without a fast label.
    const value = assumption(exact.result, "view.defocus")!;
    expect(value).toMatchObject({ convolution: "runs", rollingBands: { rows: 1, shiftSites: 0 } });
    expect(value.fast).toBeUndefined();
    // The two differ by the bands' shift only.
    for (let i = 0; i < fast.result.image.samples.length; i++) expect(Math.abs(fast.result.image.samples[i]! - exact.result.image.samples[i]!)).toBeLessThanOrEqual(1);
  }, scaledTimeout(120_000));

  it("is in the registry with its resolver and report", () => {
    expect(SIMULATE_CAPTURE_FAST_METHODS.find((e) => e.id === "motion.shutter.rolling/view-row-bands")).toMatchObject({ override: "fast", report: { assumption: "view.defocus" } });
  });
});

describe("lens.catalogue/view-uniform-window (#655)", () => {
  const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, subjectDistanceM: 2, output: { width: 40, height: 26 }, sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 40 },
    exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 }, lens: { catalogue: "pv-24-1.8", fNumber: 2.8 } };
  const view: SimulateDisplayViewOptions = { width: 20, height: 13 };
  const windows = async (request: SimulateCaptureOptions): Promise<{ on: boolean; reported: unknown; applied: boolean | undefined }> => {
    const { result } = await simulateDisplayViewWithInternals(request, view);
    return { on: lastDisplayViewLensSetup()!.lens.uniformWindows === true, reported: assumption(result, "view.lensPsf")!.uniformWindows, applied: result.diagnostics.fast.applied["lens.catalogue"] };
  };

  it("takes the uniform windows by default, every tap with fast: false, and follows lens.catalogue's own flag", async () => {
    expect(await windows(options)).toEqual({ on: true, reported: "field-factor-second-order", applied: true });
    expect(await windows({ ...options, fast: false })).toMatchObject({ on: false, reported: null });
    expect(await windows({ ...options, lens: { catalogue: { kind: "pv-24-1.8", fast: false }, fNumber: 2.8 } })).toMatchObject({ on: false, reported: null });
    expect(await windows({ ...options, fast: false, lens: { catalogue: { kind: "pv-24-1.8", fast: true }, fNumber: 2.8 } })).toMatchObject({ on: true, reported: "field-factor-second-order", applied: true });
  }, scaledTimeout(120_000));

  it("is not taken for a radiance scene (no materials)", async () => {
    const rings: SimulateCaptureOptions = { ...options, scene: { kind: "reflectance-function", sceneId: "rings", evaluate: (p: { u: number; v: number }): number => 0.4 + 0.3 * Math.cos(40 * Math.hypot(p.u, p.v)) } };
    expect(await windows(rings)).toMatchObject({ on: false, reported: null });
  }, scaledTimeout(120_000));

  it("leaves exports on the full methods (a DNG capture with the same request has no display-view lens signal)", async () => {
    const capture = await simulateCapture({ ...options, output: { ...options.output, format: "dng" } });
    expect(capture.diagnostics.fast.requested).toBe(false);
    expect(capture.assumptions.some((a) => a.id === "view.lensPsf")).toBe(false);
  }, scaledTimeout(120_000));
});

describe("#655 step 4: the view's lens geometry takes the Newton inverse", () => {
  it("passes undistort to the geometry, which uses it for every lattice point", () => {
    const lensMapping = { mapping: { projectionModel: "rectilinear" } } as never;
    let calls = 0;
    const undistort: typeof undistortedImagePoint = (_mapping, image) => { calls++; return { ideal: image, distortionAreaFactor: 1 } as ReturnType<typeof undistortedImagePoint>; };
    const geometry = prepareDefocusImageSpaceGeometry({ focalLengthMm: 50, focusDistanceM: 2, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 }, lensMapping, undistort } as never);
    geometry.lookOf(1, 1, 0);
    expect(calls).toBe(1);
  });
});
