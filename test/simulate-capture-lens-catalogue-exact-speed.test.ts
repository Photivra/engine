// SPDX-License-Identifier: Apache-2.0
/**
 * #633: the exact catalogue PSF path (the environment PSF quadrature, `lens.catalogue` with `fast: false`) without its per-tap result
 * envelopes. The lean executor maps each tap point once per instant for all spectral nodes and, with an engine-built evaluator, reads its
 * radiance by key; the template site of each CFA phase checks both against the full planner and executor bit for bit. So the RAW and the
 * image must equal the full path's (the lean executor switched off) bit for bit, and the exact path's time is guarded against the fast one.
 */
import { afterEach, describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions } from "../src/index.js";
import { nativeEnvironmentLeanStatistics, setNativeEnvironmentLeanExecutionEnabled } from "../src/capture/native-environment-lean.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

afterEach(() => setNativeEnvironmentLeanExecutionEnabled(true));

const frame = (id: string, fNumber: number, W: number, region: { x: number; y: number; width: number; height: number }, extra: Partial<SimulateCaptureOptions> = {},
  scene: SimulateCaptureOptions["scene"] = { preset: "siemens-star" }): SimulateCaptureOptions => ({ scene, subjectDistanceM: 5, fast: false,
  output: { width: W, height: W * 2 / 3, format: "srgb-16", maximumPixels: 2 ** 27, region }, sensor: { pixelPitchMicrometers: 36000 / W, spectralStepNanometers: 40 },
  lens: { catalogue: id, fNumber }, exposure: { mode: "manual", shutterSeconds: (fNumber / 8) ** 2 / 125, iso: 100 }, ...extra });
const cpuSeconds = async (options: SimulateCaptureOptions): Promise<number> => {
  const start = process.cpuUsage();
  await simulateCapture(options);
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1e6;
};

describe("the exact catalogue PSF without per-tap envelopes (#633)", () => {
  it("gives the full path's RAW and image bit for bit: rectilinear, fisheye inside and outside its circle, defocus, rotation", async () => {
    const cases: [string, SimulateCaptureOptions][] = [
      ["PV 50 1.8 at f/8, 6 µm", frame("pv-50-1.8", 8, 6000, { x: 2996, y: 996, width: 8, height: 8 })],
      ["PV 24 1.8 wide open, corner", frame("pv-24-1.8", 1.8, 1500, { x: 1490, y: 0, width: 8, height: 6 }, {}, { preset: "dead-leaves" })],
      ["PV 8 3.5 fisheye across its circle", frame("pv-8-3.5-fisheye-pro", 3.5, 192, { x: 20, y: 0, width: 8, height: 6 }, {}, { preset: "checkerboard", squaresAcross: 16 })],
      ["PV 50 1.8 with lens.defocus", { ...frame("pv-50-1.8", 4, 384, { x: 188, y: 124, width: 8, height: 8 }), subjectDistanceM: 2,
        lens: { catalogue: "pv-50-1.8", fNumber: 4, focusDistanceM: 1.8, defocus: { model: "geometric-disc" } } }],
      ["PV 35 1.8 with camera rotation", frame("pv-35-1.8", 2.8, 384, { x: 188, y: 124, width: 6, height: 6 }, { motion: { angularVelocityRadPerSec: { pitch: 0.02, yaw: -0.03, roll: 0.01 } },
        sensor: { pixelPitchMicrometers: 36000 / 384, spectralStepNanometers: 40, temporalSampleCount: 2 } })]
    ];
    for (const [name, options] of cases) {
      const before = { ...nativeEnvironmentLeanStatistics };
      const lean = await simulateCapture(options);
      const planned = nativeEnvironmentLeanStatistics.plannedSites - before.plannedSites, keyed = nativeEnvironmentLeanStatistics.keySites - before.keySites;
      setNativeEnvironmentLeanExecutionEnabled(false);
      const full = await simulateCapture(options);
      setNativeEnvironmentLeanExecutionEnabled(true);
      expect(lean.diagnostics.fast.applied["lens.catalogue"], name).toBe(false);
      expect(Array.from(lean.raw.codes), name).toEqual(Array.from(full.raw.codes));
      expect(Array.from(lean.image.samples), name).toEqual(Array.from(full.image.samples));
      // The lean planner took the sites (the templates' own sites run in full), as key taps where every tap has a key (a tap beyond the
      // fisheye's horizon has none: its site keeps request taps).
      expect(planned, name).toBeGreaterThan(0);
      if (!name.includes("fisheye")) expect(keyed, name).toBeGreaterThan(0);
    }
  }, scaledTimeout(900_000));

  it("timing guard: the exact path stays within its measured multiple of the fast path (CPU time, back to back)", async () => {
    // A 16 × 16 region of a 24 MP frame through PV 50 1.8 at f/8 (the issue's case at a quarter of its side). Measured November 15, 2026
    // on a heavily loaded machine (load average about 215, CPU time of this process): exact 5.6–6.0 s before #633 and 1.3–1.4 s after.
    const exact = frame("pv-50-1.8", 8, 6000, { x: 2992, y: 992, width: 16, height: 16 });
    const fast = { ...exact, fast: true };
    await simulateCapture(fast);
    const fastSeconds = await cpuSeconds(fast), exactSeconds = await cpuSeconds(exact);
    expect(exactSeconds / fastSeconds).toBeLessThan(EXACT_OVER_FAST_LIMIT);
  }, scaledTimeout(600_000));
});

/** The guard: the measured ratio of the exact to the fast CPU time (see the test), with room for load; before #633 it was far above. */
const EXACT_OVER_FAST_LIMIT = 40;
