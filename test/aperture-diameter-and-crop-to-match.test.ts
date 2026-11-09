// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  InvalidConfigurationError,
  InvalidScientificInputError,
  InvalidScientificResultError,
  calculateApertureDiameter,
  calculateCenteredCrop,
  calculateCropToMatchFocalLength,
  calculateSensorEquivalence
} from "../src/index.js";

describe("calculateApertureDiameter (#577)", () => {
  it("gives 25 mm for 50 mm at f/2", () => {
    const result = calculateApertureDiameter({ focalLengthMm: 50, fNumber: 2 });
    expect(result.value).toEqual({ focalLengthMm: 50, fNumber: 2, entrancePupilDiameterMm: 25 });
    expect(result.provenance).toMatchObject({ kind: "calculated", model: "aperture-diameter", modelVersion: "1.0.0" });
    expect(result.provenance.assumptions?.join(" ")).toMatch(/infinity/u);
  });

  it("is focal length ÷ f-number, and agrees with calculateSensorEquivalence", () => {
    // Hand checks: 50/4 = 12.5 (two stops: half the diameter, a quarter of the area); 85/1.4; 200/2.8.
    expect(calculateApertureDiameter({ focalLengthMm: 50, fNumber: 4 }).value.entrancePupilDiameterMm).toBe(12.5);
    expect(calculateApertureDiameter({ focalLengthMm: 85, fNumber: 1.4 }).value.entrancePupilDiameterMm).toBeCloseTo(60.714285714, 8);
    expect(calculateApertureDiameter({ focalLengthMm: 200, fNumber: 2.8 }).value.entrancePupilDiameterMm).toBeCloseTo(71.428571429, 8);
    for (const [focalLengthMm, fNumber] of [[24, 1.4], [35, 8], [600, 6.3], [4.3, 1.8]] as const) {
      expect(calculateApertureDiameter({ focalLengthMm, fNumber }).value.entrancePupilDiameterMm)
        .toBe(calculateSensorEquivalence({ sensor: { widthMm: 36, heightMm: 24 }, focalLengthMm, fNumber }).value.entrancePupilDiameterMm);
    }
  });

  it("refuses invalid input with domain errors", () => {
    for (const fNumber of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calculateApertureDiameter({ focalLengthMm: 50, fNumber })).toThrow(InvalidScientificInputError);
    }
    expect(() => calculateApertureDiameter({ focalLengthMm: 0, fNumber: 2 })).toThrow(InvalidScientificInputError);
    expect(() => calculateApertureDiameter({ focalLengthMm: 50, fNumber: 2, aperture: 2 } as never)).toThrow(InvalidConfigurationError);
    // A quotient that underflows to zero or overflows is a result error, never a 0 or Infinity in the envelope.
    expect(() => calculateApertureDiameter({ focalLengthMm: 1e-300, fNumber: 1e300 })).toThrow(InvalidScientificResultError);
    expect(() => calculateApertureDiameter({ focalLengthMm: 1e300, fNumber: 1e-300 })).toThrow(InvalidScientificResultError);
  });
});

describe("calculateCropToMatchFocalLength (#579)", () => {
  it("crops a 24 MP full-frame image at 50 mm to 6 MP to match 100 mm", () => {
    const result = calculateCropToMatchFocalLength({ focalLengthMm: 50, targetFocalLengthMm: 100, pixelWidth: 6000, pixelHeight: 4000 });
    expect(result.value).toEqual({
      focalLengthMm: 50, targetFocalLengthMm: 100, cropFactor: 2,
      pixelWidth: 3000, pixelHeight: 2000, megapixels: 6, sourceMegapixels: 24, retainedAreaFraction: 0.25
    });
    expect(result.provenance).toMatchObject({ kind: "calculated", model: "crop-to-match-focal-length", modelVersion: "1.0.0" });
    expect(result.provenance.assumptions?.join(" ")).toMatch(/close focus/u);
  });

  it("uses calculateCenteredCrop's whole-pixel crop with factor target ÷ focal length", () => {
    for (const [focalLengthMm, targetFocalLengthMm, pixelWidth, pixelHeight] of
      [[24, 70, 6000, 4000], [35, 50, 8256, 5504], [50, 85, 4000, 6000], [70, 200, 5184, 3456], [50, 50, 6000, 4000]] as const) {
      const value = calculateCropToMatchFocalLength({ focalLengthMm, targetFocalLengthMm, pixelWidth, pixelHeight }).value;
      const crop = calculateCenteredCrop({ pixelWidth, pixelHeight, cropFactor: targetFocalLengthMm / focalLengthMm }).value;
      expect(value.cropFactor).toBe(targetFocalLengthMm / focalLengthMm);
      expect([value.pixelWidth, value.pixelHeight, value.megapixels, value.retainedAreaFraction])
        .toEqual([crop.pixelWidth, crop.pixelHeight, crop.megapixels, crop.retainedAreaFraction]);
    }
    // Same focal length: no crop.
    expect(calculateCropToMatchFocalLength({ focalLengthMm: 50, targetFocalLengthMm: 50, pixelWidth: 6000, pixelHeight: 4000 }).value
      .megapixels).toBe(24);
    // 24 → 70 mm on 6000 × 4000: factor 35/12, shorter axis floor(4000·12/35) = 1371, longer round(1371·1.5) = 2057, within the cap floor(6000·12/35) = 2057.
    const wide = calculateCropToMatchFocalLength({ focalLengthMm: 24, targetFocalLengthMm: 70, pixelWidth: 6000, pixelHeight: 4000 }).value;
    expect([wide.pixelWidth, wide.pixelHeight]).toEqual([2057, 1371]);
  });

  it("refuses a shorter target and invalid input", () => {
    expect(() => calculateCropToMatchFocalLength({ focalLengthMm: 100, targetFocalLengthMm: 50, pixelWidth: 6000, pixelHeight: 4000 }))
      .toThrow(new InvalidScientificInputError("targetFocalLengthMm must be greater than or equal to focalLengthMm: a crop cannot widen the framing."));
    expect(() => calculateCropToMatchFocalLength({ focalLengthMm: 0, targetFocalLengthMm: 50, pixelWidth: 6000, pixelHeight: 4000 })).toThrow(InvalidScientificInputError);
    expect(() => calculateCropToMatchFocalLength({ focalLengthMm: 50, targetFocalLengthMm: Number.NaN, pixelWidth: 6000, pixelHeight: 4000 })).toThrow(InvalidScientificInputError);
    expect(() => calculateCropToMatchFocalLength({ focalLengthMm: 50, targetFocalLengthMm: 100, pixelWidth: 6000.5, pixelHeight: 4000 })).toThrow(InvalidScientificInputError);
    expect(() => calculateCropToMatchFocalLength({ focalLengthMm: 50, targetFocalLengthMm: 100, pixelWidth: 6000, pixelHeight: 4000, sensor: {} } as never))
      .toThrow(InvalidConfigurationError);
  });
});
