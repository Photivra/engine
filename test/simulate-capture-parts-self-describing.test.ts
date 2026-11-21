// SPDX-License-Identifier: Apache-2.0
/**
 * #728: a region result describes itself (`region.fast`, `region.requestKey`), so a join of parts refuses a part a fast method rendered
 * under an exact join, and parts of another request, with the documented part shape `{ raw: result.raw, region: result.region! }`.
 * Before the fix, the box-aperture and motion rows were accepted and the joined DNG differed from the whole render (969 and 918 of
 * 4,652 bytes), and parts of an ISO 800 request joined under ISO 100.
 */
import { describe, expect, it } from "vitest";
import { serializeSimulatedCaptureDngFromParts, simulateCapture, simulateCaptureFromParts, type SimulateCaptureDngPart, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const frame = (extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions =>
  ({ scene: { preset: "siemens-star" }, output: { width: 48, height: 32, format: "dng" }, ...extra });
/** The documented example: two strips rendered as regions (sRGB by the format default, so fast by default), each passed as `{ raw, region }`. */
const strips = async (options: SimulateCaptureOptions, fast?: boolean): Promise<SimulateCaptureDngPart[]> => Promise.all([0, 16].map(async (y) => {
  const p = await simulateCapture({ ...options, ...(fast === undefined ? {} : { fast }), output: { width: 48, height: 32, region: { x: 0, y, width: 48, height: 16 } } });
  return { raw: p.raw, region: p.region! };
}));

describe("parts describe themselves and a join checks them (#728)", () => {
  it("refuses parts a fast method rendered under an exact join; the same parts rendered with fast: false join to the whole render's bytes", async () => {
    for (const extra of [{ sensor: { pixelAperture: "box" as const } }, { motion: { angularVelocityRadPerSec: { yaw: 0.05 } } }] as Partial<SimulateCaptureOptions>[]) {
      const options = frame(extra), name = JSON.stringify(extra);
      const fastParts = await strips(options);
      expect(fastParts.every((p) => p.region.fast === true), name).toBe(true);
      await expect(serializeSimulatedCaptureDngFromParts(options, fastParts), name).rejects.toThrow(/Part 0: a fast method rendered it/);
      await expect(simulateCaptureFromParts(options, fastParts), name).rejects.toThrow(/Part 0: a fast method rendered it/);
      const exactParts = await strips(options, false);
      expect(exactParts.every((p) => p.region.fast === false), name).toBe(true);
      const whole = await simulateCapture(options), joined = await serializeSimulatedCaptureDngFromParts(options, exactParts);
      expect(Buffer.from(joined.bytes).equals(Buffer.from(whole.image.dng!)), name).toBe(true);
    }
  }, scaledTimeout(120_000));

  it("refuses whole sets of parts of another request (ISO, scene, pixel pitch); a part without the new fields still joins", async () => {
    const options = frame({ exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } });
    for (const other of [frame({ exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 800 } }),
      { ...options, scene: { preset: "slanted-edge" } }, { ...options, sensor: { pixelPitchMicrometers: 6 } }] as SimulateCaptureOptions[]) {
      await expect(serializeSimulatedCaptureDngFromParts(options, await strips(other)), JSON.stringify(other)).rejects.toThrow(/region.requestKey is another request's: not the same request/);
    }
    const parts = await strips(options), whole = await simulateCapture(options);
    expect(parts[0]!.region.requestKey).toMatch(/^[0-9a-f]{64}$/);
    // The key does not depend on the region, the part's format or its fast flag where no fast method applies.
    expect(new Set([...parts, ...await strips(options, false)].map((p) => p.region.requestKey)).size).toBe(1);
    const older = parts.map((p) => ({ raw: p.raw, region: { nativeRect: p.region.nativeRect } }));
    expect(Buffer.from((await serializeSimulatedCaptureDngFromParts(options, older)).bytes).equals(Buffer.from(whole.image.dng!))).toBe(true);
    expect(Buffer.from((await serializeSimulatedCaptureDngFromParts(options, parts)).bytes).equals(Buffer.from(whole.image.dng!))).toBe(true);
  }, scaledTimeout(120_000));
});
