// SPDX-License-Identifier: Apache-2.0
/**
 * #786: six options that read `null`, `{}` or a non-boolean `fast` as if omitted are refused with a domain error naming the option,
 * so a malformed part record cannot skip #728's fast-method check.
 */
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, serializeSimulatedCaptureDngFromParts, simulateCapture, simulateCaptureFromParts, type SimulateCaptureDngPart,
  type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const frame: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 16, height: 16 } };
const refused: [string, unknown, RegExp][] = [
  ["output.gamutHandling: null", { ...frame, output: { ...frame.output, gamutHandling: null } }, /output\.gamutHandling must be clip-components or desaturate-to-luminance/],
  ["motion.handheld.seed: null", { ...frame, motion: { handheld: { seed: null } } }, /motion\.handheld\.seed must be an integer/],
  ["motion.handheld.stabilizationStops: null", { ...frame, motion: { handheld: { stabilizationStops: null } } }, /motion\.handheld\.stabilizationStops must be a number/],
  ["motion.subject: {}", { ...frame, motion: { subject: {} } }, /motion\.subject needs velocityMPerSec or angularVelocityRadPerSec/],
  ["motion.subject: { region } only", { ...frame, motion: { subject: { region: { centerXM: 0, centerYM: 0, widthM: 0.1, heightM: 0.1 } } } },
    /motion\.subject needs velocityMPerSec or angularVelocityRadPerSec/],
  ["sensor.readNoise: {}", { ...frame, sensor: { readNoise: {} } }, /sensor\.readNoise needs lowGainElectrons, highGainElectrons or highGainFromIso/]];

describe("null, {} and non-boolean fast are refused (#786)", () => {
  it.each(refused)("refuses %s", async (_name, options, message) => {
    const run = simulateCapture(options as SimulateCaptureOptions);
    await expect(run).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateCapture(options as SimulateCaptureOptions)).rejects.toThrow(message);
  });

  it("still takes the options' valid forms", async () => {
    for (const options of [{ ...frame, output: { ...frame.output, gamutHandling: "clip-components" } }, { ...frame, motion: { handheld: { seed: 3, stabilizationStops: 2 } } },
      { ...frame, motion: { subject: { velocityMPerSec: { x: 0 } } } }, { ...frame, sensor: { readNoise: { lowGainElectrons: 2 } } }] as SimulateCaptureOptions[])
      expect((await simulateCapture(options)).raw.codes.length, JSON.stringify(options)).toBeGreaterThan(0);
  }, scaledTimeout(60_000));

  it("refuses a part whose fast or region.fast is not a boolean, in both from-parts calls", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, sensor: { pixelAperture: "box" }, output: { width: 16, height: 16, format: "dng" } };
    const parts = await Promise.all([0, 8].map(async (y) => {
      const p = await simulateCapture({ ...options, output: { width: 16, height: 16, region: { x: 0, y, width: 16, height: 8 } } });
      return { raw: p.raw, region: p.region! };
    }));
    // A fast method rendered these parts (the box aperture's fast method), so an exact join refuses them when their flags are read.
    expect(parts.every((p) => p.region.fast === true)).toBe(true);
    for (const malformed of [parts.map((p) => ({ raw: p.raw, region: { nativeRect: p.region.nativeRect }, fast: "yes" })),
      parts.map((p) => ({ raw: p.raw, region: { ...p.region, fast: "yes" } })), parts.map((p) => ({ raw: p.raw, region: { ...p.region, fast: null } })),
      parts.map((p) => ({ ...p, fast: 1 }))] as unknown as SimulateCaptureDngPart[][]) {
      await expect(serializeSimulatedCaptureDngFromParts(options, malformed)).rejects.toThrow(/Part 0: fast and region\.fast must be true or false/);
      await expect(simulateCaptureFromParts(options, malformed)).rejects.toThrow(/Part 0: fast and region\.fast must be true or false/);
    }
    await expect(serializeSimulatedCaptureDngFromParts(options, parts)).rejects.toThrow(/Part 0: a fast method rendered it/);
  }, scaledTimeout(60_000));
});
