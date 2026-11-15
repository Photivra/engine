// SPDX-License-Identifier: Apache-2.0
/**
 * #614: calculateProgramLine gives the capture facade's program line for a lens range without a capture, and chooses the same
 * aperture and shutter as simulateCapture's program mode for the same luminance and ISO.
 */
import { describe, expect, it } from "vitest";
import { calculateProgramLine, simulateCapture, InvalidConfigurationError, InvalidScientificInputError } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const nodes = (wide?: number, narrow?: number): [number, number][] =>
  calculateProgramLine(wide === undefined ? {} : { lens: { widestFNumber: wide, narrowestFNumber: narrow! } }).value.nodes.map((n) => [n.aperture, n.shutterSeconds]);

describe("calculateProgramLine (#614)", () => {
  it("returns the facade's own line without a range and for a range that holds f/4–f/16", () => {
    const own: [number, number][] = [[16, 1 / 2000], [16, 1 / 125], [8, 1 / 125], [4, 1 / 125], [4, 128 / 125]];
    expect(nodes()).toEqual(own);
    expect(nodes(2, 22)).toEqual(own);
    const line = calculateProgramLine({ lens: { widestFNumber: 2, narrowestFNumber: 22 } }).value;
    expect(line.profileId).toBe("facade-generic-program-line");
    expect(line.limitedToLensRange).toBe(false);
    expect(line.reference).toEqual({ aperture: 8, shutterSeconds: 1 / 125, iso: 100 });
    // EV of f/8 at 1/125 s: log2(8000).
    expect(line.nodes[2]!.exposureValue).toBeCloseTo(Math.log2(8000), 12);
    expect(line.nodes[2]!.opticalExposureStopsFromReference).toBe(0);
  });

  it("limits the line to a range without f/4–f/16 (#583's example)", () => {
    expect(nodes(8, 32)).toEqual([[16, 1 / 2000], [16, 1 / 125], [8, 1 / 125], [8, 128 / 125]]);
    const line = calculateProgramLine({ lens: { widestFNumber: 8, narrowestFNumber: 32 }, iso: 400 }).value;
    expect(line.profileId).toBe("facade-generic-program-line-lens-range");
    expect(line.limitedToLensRange).toBe(true);
    expect(line.lens).toEqual({ widestFNumber: 8, narrowestFNumber: 32 });
    // At ISO 400 each node suits a scene two stops darker (EV100 = EV − log2(400/100)).
    for (const n of line.nodes) expect(n.sceneEv100).toBeCloseTo(n.exposureValue - 2, 12);
    // A fixed f/5.6 lens: one aperture throughout; the anchor moves to f/5.6 with the same N²/t (#569).
    const fixed = calculateProgramLine({ lens: { widestFNumber: 5.6, narrowestFNumber: 5.6 } }).value;
    expect(fixed.nodes.every((n) => n.aperture === 5.6)).toBe(true);
    expect(fixed.reference.aperture).toBe(5.6);
    expect(fixed.reference.shutterSeconds).toBeCloseTo((1 / 125) * (5.6 / 8) ** 2, 15);
  });

  it("chooses the line's pair for a scene EV, and reports the deviation beyond the line's ends", () => {
    // EV100 log2(8000) at ISO 100 is f/8 1/125 s, the line's middle node.
    const middle = calculateProgramLine({ ev100: Math.log2(8000) }).value.selection!;
    expect(middle.aperture).toBeCloseTo(8, 12);
    expect(middle.shutterSeconds).toBeCloseTo(1 / 125, 15);
    expect(middle.position).toBe("within-line");
    expect(Math.abs(middle.standardExposureDeviationStops)).toBeLessThan(1e-9);
    expect(middle.sceneEv100).toBeCloseTo(Math.log2(8000), 12);
    // Luminance and EV100 are the same scene: L = 10·2^EV100/65.
    const byLuminance = calculateProgramLine({ luminanceCdPerSquareMeter: 10 * 8000 / 65 }).value.selection!;
    expect([byLuminance.aperture, byLuminance.shutterSeconds]).toEqual([middle.aperture, middle.shutterSeconds]);
    // Far brighter than the line's f/16 1/2000 s end (below the line's least optical exposure): held there, overexposed (negative deviation).
    const bright = calculateProgramLine({ ev100: 22 }).value.selection!;
    expect(bright.position).toBe("below-line");
    expect([bright.aperture, bright.shutterSeconds]).toEqual([16, 1 / 2000]);
    expect(bright.standardExposureDeviationStops).toBeLessThan(-2);
  });

  it("chooses the same settings as simulateCapture's program mode", async () => {
    const cases: { lens?: { widestFNumber: number; narrowestFNumber: number }; iso: number; lux: number }[] = [
      { iso: 100, lux: 2000 }, { iso: 100, lux: 200_000 }, { iso: 400, lux: 5 },
      { lens: { widestFNumber: 8, narrowestFNumber: 32 }, iso: 100, lux: 50 },
      { lens: { widestFNumber: 8, narrowestFNumber: 32 }, iso: 200, lux: 20_000 },
      { lens: { widestFNumber: 1.4, narrowestFNumber: 16 }, iso: 800, lux: 3 },
      { lens: { widestFNumber: 0.5, narrowestFNumber: 0.9 }, iso: 100, lux: 2000 },
      { lens: { widestFNumber: 5.6, narrowestFNumber: 5.6 }, iso: 100, lux: 700 }
    ];
    for (const c of cases) {
      const capture = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 8, height: 8 }, illuminanceLux: c.lux,
        lens: { ideal: { focalLengthMm: 50, ...(c.lens ?? {}) } }, exposure: { mode: "program", iso: c.iso, metering: "grey-card" } });
      const standalone = calculateProgramLine({ ...(c.lens ? { lens: c.lens } : {}), iso: c.iso, luminanceCdPerSquareMeter: 0.18 * c.lux / Math.PI }).value.selection!;
      expect([standalone.aperture, standalone.shutterSeconds, standalone.iso], JSON.stringify(c))
        .toEqual([capture.exposure.settings.fNumber, capture.exposure.settings.shutterSeconds, capture.exposure.settings.iso]);
    }
  }, scaledTimeout(120_000));

  it("rejects invalid input with domain errors", () => {
    expect(() => calculateProgramLine({ lens: { widestFNumber: 16, narrowestFNumber: 8 } })).toThrow(InvalidScientificInputError);
    expect(() => calculateProgramLine({ lens: { widestFNumber: 0.2, narrowestFNumber: 8 } })).toThrow(InvalidScientificInputError);
    expect(() => calculateProgramLine({ camera: "pocket" as never })).toThrow(InvalidConfigurationError);
    expect(() => calculateProgramLine({ ev100: 10, luminanceCdPerSquareMeter: 100 })).toThrow(InvalidScientificInputError);
    expect(() => calculateProgramLine({ ev100: Number.NaN })).toThrow(InvalidScientificInputError);
    expect(() => calculateProgramLine({ lens: { widestFNumber: 2, narrowestFNumber: 8, maximum: 1 } as never })).toThrow(InvalidConfigurationError);
  });
});
