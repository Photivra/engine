// SPDX-License-Identifier: Apache-2.0
/**
 * 2.24.0 (owner decision 2026-11-12): two sample counts follow the speed-versus-accuracy flag. The box pixel aperture's default
 * samples per axis are 4 on fast requests and 8 on exact ones (the exports, the ideal reference, `fast: false`, the box record's own
 * `fast: false`); the default temporal midpoints under camera rotation or subject motion are 8 fast and 16 exact. An explicit value
 * always wins and adds no `diagnostics.fast.applied` key; the fast defaults report `true` there.
 */
import { describe, expect, it } from "vitest";
import { simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const value = (r: { assumptions: readonly { id: string; value: unknown }[] }, id: string): unknown => r.assumptions.find((a) => a.id === id)?.value;
const boxSamples = (r: { assumptions: readonly { id: string; value: unknown }[] }): number => (value(r, "sensor.pixelAperture") as { samplesPerAxis: number }).samplesPerAxis;

describe("the box aperture's default samples per axis (2.24.0)", () => {
  const options: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 8, height: 6 }, sensor: { spectralStepNanometers: 100, pixelAperture: "box" } };

  it("takes 4 on fast requests and 8 on exact ones, and reports the fast default", async () => {
    const fast = await simulateCapture(options), exact = await simulateCapture({ ...options, fast: false });
    const dng = await simulateCapture({ ...options, output: { ...options.output, format: "dng" } });
    expect(boxSamples(fast)).toBe(4);
    expect(fast.diagnostics.fast).toMatchObject({ requested: true, applied: { "sensor.pixelAperture.box": true }, assurance: "approximation-with-a-priori-bound" });
    for (const r of [exact, dng]) {
      expect(boxSamples(r)).toBe(8);
      expect(r.diagnostics.fast).toMatchObject({ requested: false, applied: { "sensor.pixelAperture.box": false }, assurance: "engine-reference" });
    }
    // The box record's own flag overrides the request's.
    const recordExact = await simulateCapture({ ...options, sensor: { spectralStepNanometers: 100, pixelAperture: { kind: "box", fast: false } } });
    expect(boxSamples(recordExact)).toBe(8);
    expect(recordExact.raw.codes).toEqual(exact.raw.codes);
    const recordFast = await simulateCapture({ ...options, fast: false, sensor: { spectralStepNanometers: 100, pixelAperture: { kind: "box", fast: true } } });
    expect(boxSamples(recordFast)).toBe(4);
    expect(recordFast.raw.codes).toEqual(fast.raw.codes);
    // The display view (fast by default) takes 4 too.
    const view = await simulateDisplayView(options, { width: 4, height: 3 });
    expect(boxSamples(view)).toBe(4);
    expect(view.diagnostics.fast.applied).toMatchObject({ "sensor.pixelAperture.box": true });
  }, scaledTimeout(60_000));

  it("keeps an explicit samplesPerAxis on both paths", async () => {
    for (const fast of [true, false]) {
      const r = await simulateCapture({ ...options, fast, sensor: { spectralStepNanometers: 100, pixelAperture: { kind: "box", samplesPerAxis: 3 } } });
      expect(boxSamples(r), String(fast)).toBe(3);
      expect(r.diagnostics.fast.applied["sensor.pixelAperture.box"], String(fast)).toBe(false);
    }
  }, scaledTimeout(60_000));
});

describe("the default temporal midpoints under motion (2.24.0)", () => {
  const rotating: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 8, height: 6 }, sensor: { spectralStepNanometers: 100 },
    motion: { angularVelocityRadPerSec: { yaw: 0.02 } } };

  it("takes 8 on fast requests and 16 on exact ones under camera rotation, and reports the fast default", async () => {
    const fast = await simulateCapture(rotating), exact = await simulateCapture({ ...rotating, fast: false });
    const dng = await simulateCapture({ ...rotating, output: { ...rotating.output, format: "dng" } });
    expect(value(fast, "sensor.temporalSampleCount")).toBe(8);
    expect(fast.diagnostics.fast).toMatchObject({ requested: true, applied: { "sensor.temporalSampleCount": true }, assurance: "approximation-with-a-priori-bound" });
    for (const r of [exact, dng]) {
      expect(value(r, "sensor.temporalSampleCount")).toBe(16);
      expect(r.diagnostics.fast).toMatchObject({ requested: false, applied: { "sensor.temporalSampleCount": false }, assurance: "engine-reference" });
    }
    const view = await simulateDisplayView(rotating, { width: 4, height: 3 });
    expect(value(view, "sensor.temporalSampleCount")).toBe(8);
  }, scaledTimeout(60_000));

  it("takes 16 under subject motion on an exact request", async () => {
    // A long streak (many sites), so the subject's own fast method (#551) does not reduce the count.
    const subject: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 8, height: 6 }, sensor: { spectralStepNanometers: 100 },
      motion: { subject: { velocityMPerSec: { x: 2 } } }, exposure: { mode: "manual", iso: 400, shutterSeconds: 1 / 15 } };
    const exact = await simulateCapture({ ...subject, fast: false }), fast = await simulateCapture(subject);
    expect(value(exact, "sensor.temporalSampleCount")).toBe(16);
    expect(exact.diagnostics.fast.applied).toMatchObject({ "motion.subject": false, "sensor.temporalSampleCount": false });
    expect(value(fast, "sensor.temporalSampleCount")).toBe(8);
    expect(fast.diagnostics.fast.applied).toMatchObject({ "sensor.temporalSampleCount": true });
  }, scaledTimeout(60_000));

  it("keeps an explicit count and adds no key; a still scene makes no choice", async () => {
    for (const fast of [true, false]) {
      const r = await simulateCapture({ ...rotating, fast, sensor: { spectralStepNanometers: 100, temporalSampleCount: 4 } });
      expect(value(r, "sensor.temporalSampleCount"), String(fast)).toBeUndefined();
      expect(r.diagnostics.fast.applied["sensor.temporalSampleCount"], String(fast)).toBeUndefined();
    }
    const still = await simulateCapture({ scene: { preset: "siemens-star" }, output: { width: 8, height: 6 }, sensor: { spectralStepNanometers: 100 }, fast: false });
    expect(value(still, "sensor.temporalSampleCount")).toBe(1);
    expect(still.diagnostics.fast.applied["sensor.temporalSampleCount"]).toBeUndefined();
  }, scaledTimeout(60_000));
});
