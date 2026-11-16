// SPDX-License-Identifier: Apache-2.0
/** #613: the equivalent ISO for a format change, S' = k²·S with the diagonal crop factor k. */
import { describe, expect, it } from "vitest";
import { calculateFormatEquivalentIso, calculateSensorEquivalence, InvalidConfigurationError, InvalidScientificInputError } from "../src/index.js";

describe("calculateFormatEquivalentIso (#613)", () => {
  it("scales the ISO by the square of the crop factor", () => {
    const apsc = { widthMm: 23.5, heightMm: 15.6 };
    const r = calculateFormatEquivalentIso({ iso: 100, sensor: apsc });
    // k = √(36² + 24²) / √(23.5² + 15.6²), by hand.
    const k = Math.sqrt(36 ** 2 + 24 ** 2) / Math.sqrt(23.5 ** 2 + 15.6 ** 2);
    expect(r.value.cropFactor).toBeCloseTo(k, 14);
    expect(r.value.equivalentIso).toBeCloseTo(100 * k * k, 10);
    expect(r.value.equivalentIso).toBeCloseTo(235.3, 1);
    expect(r.value.stops).toBeCloseTo(2 * Math.log2(k), 12);
    expect(r.value.basis.kind).toBe("approximation");
    expect(r.provenance.kind).toBe("approximation");
    // The same crop factor as the focal-length and f-number equivalence.
    expect(r.value.cropFactor).toBe(calculateSensorEquivalence({ sensor: apsc, focalLengthMm: 50, fNumber: 2 }).value.cropFactor);
    // Crop factor 2 (Four Thirds against full frame): ISO 200 ↔ ISO 800, two stops.
    const two = calculateFormatEquivalentIso({ iso: 200, cropFactor: 2 }).value;
    expect([two.equivalentIso, two.isoRatio, two.stops]).toEqual([800, 4, 2]);
  });

  it("works toward a smaller target format", () => {
    const r = calculateFormatEquivalentIso({ iso: 400, sensor: { widthMm: 36, heightMm: 24 }, reference: { widthMm: 18, heightMm: 12 } }).value;
    expect(r.cropFactor).toBeCloseTo(0.5, 15);
    expect(r.equivalentIso).toBeCloseTo(100, 12);
    expect(r.stops).toBeCloseTo(-2, 12);
  });

  it("rejects invalid input", () => {
    expect(() => calculateFormatEquivalentIso({ iso: 100 })).toThrow(InvalidScientificInputError);
    expect(() => calculateFormatEquivalentIso({ iso: 100, cropFactor: 2, sensor: { widthMm: 36, heightMm: 24 } })).toThrow(InvalidScientificInputError);
    expect(() => calculateFormatEquivalentIso({ iso: 100, cropFactor: 2, reference: { widthMm: 36, heightMm: 24 } } as never)).toThrow(InvalidScientificInputError);
    expect(() => calculateFormatEquivalentIso({ iso: -1, cropFactor: 2 })).toThrow(InvalidScientificInputError);
    expect(() => calculateFormatEquivalentIso({ iso: 100, cropFactor: 0 })).toThrow(InvalidScientificInputError);
    expect(() => calculateFormatEquivalentIso({ iso: 100, sensor: { widthMm: 0, heightMm: 24 } })).toThrow(InvalidScientificInputError);
    expect(() => calculateFormatEquivalentIso({ iso: 1e308, cropFactor: 1e10 })).toThrow(InvalidScientificInputError);
    expect(() => calculateFormatEquivalentIso({ iso: 100, cropFactor: 2, crop: 1 } as never)).toThrow(InvalidConfigurationError);
  });
});
