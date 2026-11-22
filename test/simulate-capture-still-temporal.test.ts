// SPDX-License-Identifier: Apache-2.0
/*
 * #729: sensor.temporalSampleCount on a still request (no camera rotation, moving subject, flash or exposure build-up). Every
 * temporal midpoint reads the same scene, so the request renders with one: the same RAW and samples, the scene queries of one
 * sample, and no refusal from the per-site query limit.
 */
import { describe, expect, it } from "vitest";
import { simulateCapture, simulateDisplayView, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const scene = { kind: "reflectance-function" as const, sceneId: "f", evaluate: ({ u, v }: { u: number; v: number }): number => 0.2 + 0.1 * Math.sin(40 * u) * Math.cos(31 * v) };
const request = (temporalSampleCount: number | undefined, extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions =>
  ({ scene, output: { width: 32, height: 24 }, ...extra, sensor: { ...extra.sensor, ...(temporalSampleCount ? { temporalSampleCount } : {}) } });
const assumption = (r: { assumptions: readonly { id: string; kind: string; value: unknown }[] }, id: string): { kind: string; value: unknown } | undefined => r.assumptions.find((a) => a.id === id);

describe("a still request renders with one temporal sample (#729)", () => {
  it("keeps the RAW and samples of one sample and makes its provider evaluations, for any count asked for", async () => {
    for (const fast of [true, false]) {
      const one = await simulateCapture(request(undefined, { fast }));
      for (const n of [3, 64]) {
        const many: SimulateCaptureResult = await simulateCapture(request(n, { fast }));
        expect(many.raw.codes).toEqual(one.raw.codes);
        expect(many.image.samples).toEqual(one.image.samples);
        // Before #729: n times as many.
        expect(many.diagnostics.providerEvaluationCount).toBe(one.diagnostics.providerEvaluationCount);
        expect(assumption(many, "sensor.temporalSampleCount")).toMatchObject({ kind: "model", value: { requested: n, used: 1 } });
        expect(many.diagnostics.options).toContain("sensor.temporalSampleCount");
      }
    }
  }, scaledTimeout(60_000));

  it("renders a box aperture with a four-spot filter at 100 samples, which the per-site query limit refused", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 48, height: 32 }, fast: false,
      sensor: { pixelAperture: { kind: "box", samplesPerAxis: 4 }, antiAliasing: { kind: "four-spot" } } };
    const one = await simulateCapture(options), many = await simulateCapture({ ...options, sensor: { ...options.sensor, temporalSampleCount: 100 } });
    expect(many.raw.codes).toEqual(one.raw.codes);
  }, scaledTimeout(60_000));

  it("applies to the display view too", async () => {
    const one = await simulateDisplayView(request(undefined), { width: 16, height: 12 }), many = await simulateDisplayView(request(16), { width: 16, height: 12 });
    expect(many.image.samples).toEqual(one.image.samples);
    expect(assumption(many, "sensor.temporalSampleCount")).toMatchObject({ value: { requested: 16, used: 1 } });
  }, scaledTimeout(60_000));

  it("keeps the count of a rotating request", async () => {
    const motion = { angularVelocityRadPerSec: { yaw: 0.05 } };
    const two = await simulateCapture(request(2, { motion, output: { width: 16, height: 12 } })), four = await simulateCapture(request(4, { motion, output: { width: 16, height: 12 } }));
    expect(four.diagnostics.providerEvaluationCount).toBe(2 * two.diagnostics.providerEvaluationCount);
    expect(assumption(four, "sensor.temporalSampleCount")).toBeUndefined();
    expect(four.raw.codes).not.toEqual(two.raw.codes);
  }, scaledTimeout(60_000));
});
