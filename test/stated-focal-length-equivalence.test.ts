// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  calculateEquivalentFocalLength35Mm, calculateImagingAreaFromFocalLength35Mm, calculateSensorEquivalence, calculateSensorEquivalenceFromFocalLength35Mm,
  InvalidConfigurationError, InvalidScientificInputError
} from "../src/index.js";

/*
 * 2.25.0 (#619): the imaging area and sensor equivalence implied by a file's FocalLength and FocalLengthIn35mmFilm. The checks are
 * analytical: the forward 35 mm equivalence of the derived area returns the stated value, the true area of a known format lies inside
 * the interval its rounded 35 mm value gives, and the interval's ends are F35 ± 0.5 mm.
 */

const phone = { focalLengthMm: 6.2, focalLength35MmEquivalentMm: 27, imageWidthPixels: 4032, imageHeightPixels: 3024 };

describe("calculateImagingAreaFromFocalLength35Mm (2.25.0, #619)", () => {
  it("inverts the engine's diagonal 35 mm equivalence", () => {
    const r = calculateImagingAreaFromFocalLength35Mm(phone);
    const v = r.value;
    expect(v.cropFactor).toBeCloseTo(27 / 6.2, 12);
    expect(v.imagingArea.widthMm / v.imagingArea.heightMm).toBeCloseTo(4 / 3, 12);
    expect(Math.hypot(v.imagingArea.widthMm, v.imagingArea.heightMm)).toBeCloseTo(v.diagonalMm, 12);
    const forward = calculateEquivalentFocalLength35Mm({ focalLengthMm: 6.2, activeImagingArea: v.imagingArea }).value;
    expect(forward.equivalentFocalLength35Mm).toBeCloseTo(27, 10);
    expect(v.imagingArea.widthMm).toBeCloseTo(7.948, 3);
    expect(v.imagingArea.heightMm).toBeCloseTo(5.961, 3);
    expect(v.focalLength35MmInterval).toEqual({ minimum: 26.5, maximum: 27.5 });
    expect(v.cropFactorInterval.minimum).toBeCloseTo(26.5 / 6.2, 12);
    expect(v.cropFactorInterval.maximum).toBeCloseTo(27.5 / 6.2, 12);
    expect(v.cropFactorRelativeHalfWidth).toBeCloseTo(0.5 / 27, 12);
    expect(v.imagingAreaInterval.largest.widthMm).toBeGreaterThan(v.imagingArea.widthMm);
    expect(v.imagingAreaInterval.smallest.widthMm).toBeLessThan(v.imagingArea.widthMm);
    expect(v.exactness).toBe("approximation");
    expect(v.basis.kind).toBe("focal-length-in-35mm-film");
    expect(v.basis.statement).toMatch(/nearest 1 mm, so it lies within ±0\.5 mm/u);
    expect(r.provenance.kind).toBe("approximation");
  });

  it("contains the true area of known formats inside the interval of their rounded 35 mm value", () => {
    // A 36 × 24 mm frame, a 23.5 × 15.6 mm frame, a 17.3 × 13 mm frame and a 6.17 × 4.55 mm frame, at several focal lengths.
    for (const sensor of [{ widthMm: 36, heightMm: 24 }, { widthMm: 23.5, heightMm: 15.6 }, { widthMm: 17.3, heightMm: 13 }, { widthMm: 6.17, heightMm: 4.55 }]) {
      for (const f of [4.3, 12, 18, 23, 50, 85, 200]) {
        const truth = calculateEquivalentFocalLength35Mm({ focalLengthMm: f, activeImagingArea: sensor }).value;
        const stated = Math.round(truth.equivalentFocalLength35Mm);
        const v = calculateImagingAreaFromFocalLength35Mm({ focalLengthMm: f, focalLength35MmEquivalentMm: stated, imageWidthPixels: sensor.widthMm * 100,
          imageHeightPixels: sensor.heightMm * 100 }).value;
        expect(truth.cropFactor35Mm).toBeGreaterThanOrEqual(v.cropFactorInterval.minimum - 1e-12);
        expect(truth.cropFactor35Mm).toBeLessThanOrEqual(v.cropFactorInterval.maximum + 1e-12);
        expect(sensor.widthMm).toBeGreaterThanOrEqual(v.imagingAreaInterval.smallest.widthMm - 1e-9);
        expect(sensor.widthMm).toBeLessThanOrEqual(v.imagingAreaInterval.largest.widthMm + 1e-9);
      }
    }
  });

  it("is exact when the 35 mm value is stated exactly, and takes another resolution", () => {
    const exact = calculateImagingAreaFromFocalLength35Mm({ ...phone, focalLength35MmResolutionMm: 0 });
    expect(exact.value.exactness).toBe("exact");
    expect(exact.value.cropFactorInterval.minimum).toBe(exact.value.cropFactorInterval.maximum);
    expect(exact.value.basis.statement).toMatch(/taken as exact/u);
    expect(exact.provenance.kind).toBe("calculated");
    const coarse = calculateImagingAreaFromFocalLength35Mm({ ...phone, focalLength35MmResolutionMm: 2 }).value;
    expect(coarse.focalLength35MmInterval).toEqual({ minimum: 26, maximum: 28 });
    // Orientation does not change the crop factor; width and height swap.
    const portrait = calculateImagingAreaFromFocalLength35Mm({ ...phone, imageWidthPixels: 3024, imageHeightPixels: 4032 }).value;
    expect(portrait.cropFactor).toBe(calculateImagingAreaFromFocalLength35Mm(phone).value.cropFactor);
    expect(portrait.imagingArea.widthMm).toBeCloseTo(calculateImagingAreaFromFocalLength35Mm(phone).value.imagingArea.heightMm, 12);
  });

  it("rejects invalid input", () => {
    const bad = (patch: Record<string, unknown>, error: new (...args: never[]) => Error): void => {
      expect(() => calculateImagingAreaFromFocalLength35Mm({ ...phone, ...patch } as never)).toThrow(error);
    };
    bad({ focalLengthMm: 0 }, InvalidScientificInputError); bad({ focalLength35MmEquivalentMm: Number.NaN }, InvalidScientificInputError);
    bad({ imageWidthPixels: -1 }, InvalidScientificInputError); bad({ imageHeightPixels: Infinity }, InvalidScientificInputError);
    bad({ focalLength35MmResolutionMm: -1 }, InvalidScientificInputError); bad({ focalLength35MmEquivalentMm: 0.5 }, InvalidScientificInputError);
    bad({ focalLengthMm: 1e-320, focalLength35MmEquivalentMm: 1e300 }, InvalidScientificInputError);
    bad({ fNumber: 2 }, InvalidConfigurationError);
  });
});

describe("calculateSensorEquivalenceFromFocalLength35Mm (2.25.0, #619)", () => {
  it("feeds the derived area into calculateSensorEquivalence and carries the rounding interval", () => {
    const r = calculateSensorEquivalenceFromFocalLength35Mm({ ...phone, fNumber: 1.8 });
    const v = r.value;
    const direct = calculateSensorEquivalence({ sensor: v.derivedImagingArea.imagingArea, focalLengthMm: 6.2, fNumber: 1.8 }).value;
    expect(v.equivalence).toEqual(direct);
    expect(v.equivalence.equivalentFocalLengthMm).toBeCloseTo(27, 10);
    expect(v.equivalence.equivalentFNumber).toBeCloseTo(7.839, 3);
    expect(v.intervals.equivalentFNumber.minimum).toBeCloseTo(1.8 * 26.5 / 6.2, 10);
    expect(v.intervals.equivalentFNumber.maximum).toBeCloseTo(1.8 * 27.5 / 6.2, 10);
    expect(v.intervals.equivalentFocalLengthMm.minimum).toBeCloseTo(26.5, 10);
    expect(v.intervals.equivalentFocalLengthMm.maximum).toBeCloseTo(27.5, 10);
    expect(v.equivalence.totalLightDifferenceStops).toBeCloseTo(-4.189, 3);
    expect(v.intervals.totalLightDifferenceStops.minimum).toBeCloseTo(-4.189 - 2 * Math.log2(27.5 / 27), 2);
    expect(v.intervals.totalLightDifferenceStops.maximum).toBeCloseTo(-4.189 + 2 * Math.log2(27 / 26.5), 2);
    for (const key of ["cropFactor", "areaRatio"] as const) expect(v.intervals[key].minimum).toBeLessThan(v.intervals[key].maximum);
    expect(v.equivalence.basis.equivalentFNumber.kind).toBe("approximation");
    expect((r.provenance.assumptions ?? []).join("\n")).toMatch(/rounding gives an interval/u);
    const exact = calculateSensorEquivalenceFromFocalLength35Mm({ ...phone, fNumber: 1.8, focalLength35MmResolutionMm: 0 });
    expect((exact.provenance.assumptions ?? []).join("\n")).toMatch(/taken as exact/u);
  });

  it("uses a given reference format and rejects bad input", () => {
    const reference = { widthMm: 23.5, heightMm: 15.6 };
    const v = calculateSensorEquivalenceFromFocalLength35Mm({ ...phone, fNumber: 1.8, reference }).value;
    expect(v.equivalence.reference).toEqual(reference);
    expect(v.equivalence.cropFactor).toBeLessThan(v.derivedImagingArea.cropFactor);
    expect(() => calculateSensorEquivalenceFromFocalLength35Mm({ ...phone, fNumber: 0 })).toThrow(InvalidScientificInputError);
    expect(() => calculateSensorEquivalenceFromFocalLength35Mm({ ...phone, fNumber: 2, extra: 1 } as never)).toThrow(InvalidConfigurationError);
  });
});
