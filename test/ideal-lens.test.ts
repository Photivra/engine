// SPDX-License-Identifier: Apache-2.0
/**
 * #576: `lens.ideal`, an ideal lens at a physical focal length and any f-number within IDEAL_LENS_LIMITS, in `simulateCapture` and
 * the display view, on full frame (36 × 24 mm) and APS-C (23.5 × 15.6 mm), both at 5 µm (7200 × 4800 and 4700 × 3120 sites).
 */
import { describe, expect, it } from "vitest";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { IDEAL_LENS_LIMITS, InvalidConfigurationError, calculateDefocusCircle, simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const recorded = (result: { assumptions: readonly { id: string; value: unknown }[] }, id: string): Record<string, unknown> =>
  result.assumptions.find((a) => a.id === id)!.value as Record<string, unknown>;
/** Disc edge-spread function: the fraction of a disc of radius r beyond a line at signed distance t from its centre (circular-segment area). */
function discEdgeSpread(t: number, r: number): number {
  if (t <= -r) return 0;
  if (t >= r) return 1;
  return 0.5 + (t * Math.sqrt(r * r - t * t) + r * r * Math.asin(t / r)) / (Math.PI * r * r);
}

const PITCH = 5, SENSORS = [{ name: "full frame", width: 7200, height: 4800 }, { name: "APS-C 23.5 × 15.6 mm", width: 4700, height: 3120 }] as const;
const F = 50, N = 1.8, SUBJECT = 3, FOCUS = 2.5, LO = 0.1, HI = 0.5;
/** A vertical edge through the frame's centre (a site-cell boundary), as in test/display-view-defocus.test.mjs. */
function edgeRequest(sensor: typeof SENSORS[number], lens: NonNullable<SimulateCaptureOptions["lens"]>): SimulateCaptureOptions {
  const g = 2 / sensor.width;
  return { scene: { kind: "material-function", sceneId: "edge", materials: [LO, HI], materialAt: (p) => (p.u / g > 0 ? 1 : 0) }, subjectDistanceM: SUBJECT,
    exposure: { mode: "manual", iso: 100, shutterSeconds: (1 / 125) * (N / 8) ** 2 }, sensor: { pixelPitchMicrometers: PITCH },
    output: { width: sensor.width, height: sensor.height, maximumPixels: sensor.width * sensor.height * 2 }, lens } as SimulateCaptureOptions;
}

describe("lens.ideal (#576)", () => {
  /*
   * 50 mm f/1.8 focused at d = 2.5 m, the edge at s = 3 m: c = f²·|s − d| / (N·s·(d − f)) = 94.5 µm (18.9 sites at 5 µm) on both sensors (a physical
   * lens: the blur in mm does not depend on the sensor). The display view of the defocused edge equals the view of a scene whose reflectance is
   * the disc's closed-form edge-spread function with that radius, to rounding (the axis-aligned edge on a cell boundary is exact on the lattice);
   * the capture of the defocused edge equals the capture of that closed-form scene at the same seed. Measured: views within 2.2e-14 (linear),
   * captures byte-identical, on both sensors. (Both are rendered at the same focus distance, which sets the image distance and so the framing.)
   */
  it("renders 50 mm f/1.8 on full frame and APS-C with the blur of calculateDefocusCircle, in the capture and the display view", async () => {
    const circle = calculateDefocusCircle({ focalLengthMm: F, aperture: N, focusDistanceM: FOCUS, subjectDistanceM: SUBJECT }).value.diameterMm;
    expect(circle * 1000).toBeCloseTo(94.48, 2);
    for (const sensor of SENSORS) {
      const lens = { ideal: { focalLengthMm: F }, fNumber: N, focusDistanceM: FOCUS, defocus: { model: "geometric-disc" as const } };
      const blurredRequest = edgeRequest(sensor, lens);
      const r = circle * 1000 / PITCH / 2, g = 2 / sensor.width;
      const closedRequest = { ...edgeRequest(sensor, { ideal: { focalLengthMm: F }, fNumber: N, focusDistanceM: FOCUS }),
        scene: { kind: "reflectance-function", sceneId: "edge-esf", evaluate: (p: { u: number }) => LO + (HI - LO) * discEdgeSpread(p.u / g, r) } } as SimulateCaptureOptions;
      const view = { width: sensor.width, height: sensor.height, region: { x: sensor.width / 2 - 24, y: sensor.height / 2 - 8, width: 48, height: 16 } };
      const blurred = await simulateDisplayViewWithInternals(blurredRequest, view);
      expect(recorded(blurred.result, "lens.ideal"), sensor.name).toEqual({ lensId: "ideal-50mm", focalLengthMm: 50 });
      const disc = recorded(blurred.result, "lens.defocus");
      expect(disc.diameterMicrometers as number, sensor.name).toBeCloseTo(circle * 1000, 9);
      expect(disc.diameterSites as number, sensor.name).toBeCloseTo(2 * r, 9);
      expect(blurred.result.exposure.settings.fNumber).toBe(N);
      const closed = await simulateDisplayViewWithInternals(closedRequest, view);
      let worst = 0, swing = 0;
      for (let i = 0; i < blurred.internals.expected.length; i++) {
        worst = Math.max(worst, Math.abs(blurred.internals.expected[i]! - closed.internals.expected[i]!));
        swing = Math.max(swing, Math.abs(blurred.internals.expected[i]! - blurred.internals.expected[i % 3]!));
      }
      expect(worst, sensor.name).toBeLessThan(1e-13);
      expect(swing, sensor.name).toBeGreaterThan(0.05); // the edge is in the region and blurred across it

      const region = { x: sensor.width / 2 - 24, y: sensor.height / 2 - 4, width: 48, height: 8 };
      const capture = await simulateCapture({ ...blurredRequest, output: { ...blurredRequest.output, region } });
      const reference = await simulateCapture({ ...closedRequest, output: { ...closedRequest.output, region } });
      expect(recorded(capture, "lens.defocus").diameterSites as number).toBeCloseTo(2 * r, 9);
      let maxCode = 0, changed = 0;
      for (let i = 0; i < capture.image.samples.length; i++) {
        const d = Math.abs(capture.image.samples[i]! - reference.image.samples[i]!);
        maxCode = Math.max(maxCode, d);
        if (d > 0) changed++;
      }
      expect(maxCode, sensor.name).toBe(0);
      expect(changed, sensor.name).toBe(0);
    }
  }, scaledTimeout(240_000));

  it("is the same lens on both sensors, unlike the generic prime of the same full-frame-equivalent focal length", async () => {
    const base = { scene: { preset: "uniform" as const }, sensor: { pixelPitchMicrometers: 300 }, subjectDistanceM: SUBJECT };
    // 120 × 80 and 78 × 52 at 300 µm: whole-frame views of 36 × 24 mm and 23.4 × 15.6 mm (close to APS-C).
    const ff = await simulateCapture({ ...base, output: { width: 120, height: 80 }, lens: { ideal: { focalLengthMm: F }, fNumber: N, focusDistanceM: FOCUS, defocus: { model: "geometric-disc" } } });
    const aps = await simulateCapture({ ...base, output: { width: 78, height: 52 }, lens: { ideal: { focalLengthMm: F }, fNumber: N, focusDistanceM: FOCUS, defocus: { model: "geometric-disc" } } });
    expect(recorded(aps, "lens.defocus").diameterMicrometers).toBe(recorded(ff, "lens.defocus").diameterMicrometers);
    const prime = await simulateCapture({ ...base, output: { width: 78, height: 52 }, lens: { prime: 50, fNumber: N, focusDistanceM: FOCUS, defocus: { model: "geometric-disc" } } });
    expect(recorded(prime, "lens.prime").focalLengthMm as number).toBeLessThan(33);
    expect(recorded(prime, "lens.defocus").diameterMicrometers as number).toBeLessThan(recorded(aps, "lens.defocus").diameterMicrometers as number);
  }, scaledTimeout(60_000));

  it("renders the same pixels as the tier lens and the generic prime at the same focal length and f-number", async () => {
    const scene = { preset: "slanted-edge" as const }, defocus = { model: "geometric-disc" as const };
    for (const extra of [{}, { focusDistanceM: 3, defocus }, { diffraction: "circular-aperture" as const }]) {
      const tier = await simulateCapture({ scene, lens: { focalLengthMm: 50, fNumber: 4, ...extra } });
      const ideal = await simulateCapture({ scene, lens: { ideal: { focalLengthMm: 50 }, fNumber: 4, ...extra } });
      expect(Buffer.from(ideal.image.samples).equals(Buffer.from(tier.image.samples))).toBe(true);
    }
    // The 50 mm-equivalent prime on a 36 × 24 mm frame (120 × 80 at 300 µm) is 50 mm; f/1.8 is inside its range.
    const whole = { scene, sensor: { pixelPitchMicrometers: 300 }, output: { width: 120, height: 80 } };
    const prime = await simulateCapture({ ...whole, lens: { prime: 50, fNumber: 1.8, focusDistanceM: 3, defocus } });
    const ideal = await simulateCapture({ ...whole, lens: { ideal: { focalLengthMm: 50 }, fNumber: 1.8, focusDistanceM: 3, defocus } });
    expect(Buffer.from(ideal.image.samples).equals(Buffer.from(prime.image.samples))).toBe(true);
    expect(recorded(ideal, "lens.defocus")).toEqual(recorded(prime, "lens.defocus"));
  }, scaledTimeout(60_000));

  it("takes any f-number within IDEAL_LENS_LIMITS, in every exposure mode and the display view", async () => {
    expect(IDEAL_LENS_LIMITS).toEqual({ focalLengthMm: { minimum: 1, maximum: 4000 }, fNumber: { minimum: 0.5, maximum: 128 } });
    expect(Object.isFrozen(IDEAL_LENS_LIMITS) && Object.isFrozen(IDEAL_LENS_LIMITS.fNumber)).toBe(true);
    const base = { scene: { preset: "uniform" as const }, output: { width: 16, height: 16 } };
    for (const fNumber of [0.5, 0.95, 1.2, 2.8, 64, 128]) {
      const capture = await simulateCapture({ ...base, lens: { ideal: { focalLengthMm: 8 }, fNumber }, exposure: { mode: "aperture-priority" } });
      expect(capture.exposure.settings.fNumber).toBe(fNumber);
    }
    for (const focalLengthMm of [1, 15, 100, 4000]) {
      const capture = await simulateCapture({ ...base, subjectDistanceM: 10, lens: { ideal: { focalLengthMm }, fNumber: 2 } });
      expect(recorded(capture, "lens.ideal")).toEqual({ lensId: "ideal-" + focalLengthMm + "mm", focalLengthMm });
    }
    for (const mode of ["shutter-priority", "program"] as const) {
      const capture = await simulateCapture({ ...base, lens: { ideal: { focalLengthMm: 50 } }, exposure: { mode } });
      expect(capture.exposure.settings.fNumber).toBeGreaterThanOrEqual(0.5);
      expect(capture.exposure.settings.fNumber).toBeLessThanOrEqual(128);
    }
    const view = await simulateDisplayView({ ...base, lens: { ideal: { focalLengthMm: 100 }, fNumber: 1.2 } }, { width: 8, height: 8 });
    expect(recorded(view, "lens.ideal")).toEqual({ lensId: "ideal-100mm", focalLengthMm: 100 });
    expect(view.exposure.settings.fNumber).toBe(1.2);
  }, scaledTimeout(60_000));

  it("refuses values beyond the bounds and other lens choices by name", async () => {
    const base = { scene: { preset: "uniform" as const }, output: { width: 8, height: 8 } };
    const refuses = async (lens: unknown, message: string): Promise<void> => {
      await expect(simulateCapture({ ...base, lens } as SimulateCaptureOptions)).rejects.toThrow(InvalidConfigurationError);
      await expect(simulateCapture({ ...base, lens } as SimulateCaptureOptions)).rejects.toThrow(message);
    };
    await refuses({ ideal: { focalLengthMm: 50 }, fNumber: 0.45 }, "lens.fNumber 0.45 is outside the ideal-50mm range f/0.5–f/128.");
    await refuses({ ideal: { focalLengthMm: 50 }, fNumber: 180 }, "outside the ideal-50mm range");
    for (const focalLengthMm of [0.5, 4001, Number.NaN, Infinity, "50", undefined])
      await refuses({ ideal: { focalLengthMm } }, "lens.ideal.focalLengthMm must be 1–4000 mm (IDEAL_LENS_LIMITS).");
    await refuses({ ideal: { focalLengthMm: 50, fNumber: 2 } }, "lens.ideal");
    await refuses({ ideal: 50 }, "lens.ideal");
    for (const other of [{ prime: 50 }, { catalogue: "pv-50-1.8" }, { focalLengthMm: 50 }])
      await refuses({ ideal: { focalLengthMm: 50 }, ...other }, "lens.ideal cannot be combined with lens." + Object.keys(other)[0] + ".");
    await refuses({ ideal: { focalLengthMm: 4000 } }, "subjectDistanceM must exceed twice the focal length.");
  });
});
