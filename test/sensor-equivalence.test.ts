// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  InvalidConfigurationError,
  InvalidScientificInputError,
  calculateBlurShareOfFrame,
  calculateDefocusCircle,
  calculateEquivalentFocalLength35Mm,
  calculateFieldOfView,
  calculateSensorEquivalence
} from "../src/index.js";

const APS_C = { widthMm: 23.5, heightMm: 15.6 };
const FULL_FRAME = { widthMm: 36, heightMm: 24 };

describe("calculateSensorEquivalence", () => {
  it("matches the hand-checked 50 mm f/2 on 23.5 × 15.6 mm (≈ 77 mm f/3.1)", () => {
    // Hand check: k = √(36² + 24²) / √(23.5² + 15.6²) = √(1872 / 795.61) = 1.53392…
    const result = calculateSensorEquivalence({ sensor: APS_C, focalLengthMm: 50, fNumber: 2 });
    const value = result.value;
    expect(value.cropFactor).toBeCloseTo(1.5339203377, 9);
    expect(value.equivalentFocalLengthMm).toBeCloseTo(76.696016885, 8);
    expect(Math.round(value.equivalentFocalLengthMm)).toBe(77);
    expect(value.equivalentFNumber).toBeCloseTo(3.0678406754, 9);
    expect(Math.round(value.equivalentFNumber * 10) / 10).toBe(3.1);
    expect(value.exposureFNumber).toBe(2);
    expect(value.entrancePupilDiameterMm).toBe(25);
    // Same entrance pupil on the equivalent lens.
    expect(value.equivalentFocalLengthMm / value.equivalentFNumber).toBeCloseTo(25, 12);
    // Area: 23.5 × 15.6 / 864 = 366.6 / 864.
    expect(value.areaRatio).toBeCloseTo(0.42430555556, 10);
    expect(value.totalLightDifferenceStops).toBeCloseTo(-1.2368245265, 9);
    expect(value.fieldOfView.horizontalDegrees).toBeCloseTo(26.449102384, 8);
    expect(value.fieldOfView.verticalDegrees).toBeCloseTo(17.733352088, 8);
    expect(value.fieldOfView.diagonalDegrees).toBeCloseTo(31.503866623, 8);
    expect(value.sensorDiagonalMm).toBeCloseTo(Math.sqrt(795.61), 12);
    expect(value.referenceDiagonalMm).toBeCloseTo(Math.sqrt(1872), 12);
    expect(value.reference).toEqual(FULL_FRAME);
    expect(result.provenance.kind).toBe("approximation");
    expect(result.provenance.model).toBe("sensor-equivalence");
  });

  it("matches a 4/3-type 17.3 × 13 mm sensor (crop ≈ 2.0, about two stops less total light)", () => {
    const value = calculateSensorEquivalence({ sensor: { widthMm: 17.3, heightMm: 13 }, focalLengthMm: 25, fNumber: 1.4 }).value;
    expect(value.cropFactor).toBeCloseTo(1.9993806297, 9);
    expect(value.equivalentFocalLengthMm).toBeCloseTo(49.98451574, 7);
    expect(value.equivalentFNumber).toBeCloseTo(2.79913288, 7);
    expect(value.areaRatio).toBeCloseTo(0.26030092593, 10);
    expect(value.totalLightDifferenceStops).toBeCloseTo(-1.9417476513, 9);
  });

  it("is the identity on the reference format", () => {
    const value = calculateSensorEquivalence({ sensor: FULL_FRAME, focalLengthMm: 85, fNumber: 1.8 }).value;
    expect(value.cropFactor).toBe(1);
    expect(value.equivalentFocalLengthMm).toBe(85);
    expect(value.equivalentFNumber).toBe(1.8);
    expect(value.areaRatio).toBe(1);
    expect(value.totalLightDifferenceStops).toBe(0);
  });

  it("is bit-identical to the existing 35 mm crop factor and field of view", () => {
    const equivalence = calculateSensorEquivalence({ sensor: APS_C, focalLengthMm: 35, fNumber: 2.8 }).value;
    const focal = calculateEquivalentFocalLength35Mm({ focalLengthMm: 35, activeImagingArea: APS_C }).value;
    expect(equivalence.cropFactor).toBe(focal.cropFactor35Mm);
    expect(equivalence.equivalentFocalLengthMm).toBe(focal.equivalentFocalLength35Mm);
    expect(equivalence.fieldOfView.horizontalDegrees).toBe(calculateFieldOfView({ focalLengthMm: 35, sensorDimensionMm: 23.5 }).value.degrees);
    expect(equivalence.fieldOfView.verticalDegrees).toBe(calculateFieldOfView({ focalLengthMm: 35, sensorDimensionMm: 15.6 }).value.degrees);
  });

  it("compares against a caller reference (full frame on APS-C terms gives crop below 1)", () => {
    const value = calculateSensorEquivalence({ sensor: FULL_FRAME, reference: APS_C, focalLengthMm: 50, fNumber: 2 }).value;
    expect(value.cropFactor).toBeCloseTo(1 / 1.5339203377, 9);
    expect(value.areaRatio).toBeCloseTo(864 / 366.6, 10);
    expect(value.totalLightDifferenceStops).toBeCloseTo(1.2368245265, 9);
  });

  it("states exact or approximated for every quantity, with the equivalent f-number an approximation", () => {
    const { basis } = calculateSensorEquivalence({ sensor: APS_C, focalLengthMm: 50, fNumber: 2 }).value;
    expect(Object.keys(basis).sort()).toEqual([
      "areaRatio", "cropFactor", "entrancePupilDiameterMm", "equivalentFNumber", "equivalentFocalLengthMm",
      "exposureFNumber", "fieldOfView", "totalLightDifferenceStops"
    ]);
    expect(basis.equivalentFNumber.kind).toBe("approximation");
    expect(basis.equivalentFNumber.statement).toContain("does not set exposure");
    for (const key of ["cropFactor", "equivalentFocalLengthMm", "exposureFNumber", "entrancePupilDiameterMm", "areaRatio",
      "totalLightDifferenceStops", "fieldOfView"] as const) {
      expect(basis[key].kind, key).toBe("exact");
    }
    expect(Object.isFrozen(basis)).toBe(true);
  });

  it("gives the same background-blur share when focus is far, and states the close-focus departure", () => {
    // Thin-lens check of the approximation: blur of a background at 50 m, focus at 3 m (s ≫ f).
    const { cropFactor, equivalentFocalLengthMm, equivalentFNumber } =
      calculateSensorEquivalence({ sensor: APS_C, focalLengthMm: 50, fNumber: 2 }).value;
    const shareOn = (focalLengthMm: number, fNumber: number, focusM: number, diagonal: number): number =>
      calculateDefocusCircle({ focalLengthMm, aperture: fNumber, focusDistanceM: focusM, subjectDistanceM: 50 }).value.diameterMm / diagonal;
    const apsDiagonal = Math.hypot(23.5, 15.6), ffDiagonal = Math.hypot(36, 24);
    const far = shareOn(50, 2, 3, apsDiagonal) / shareOn(equivalentFocalLengthMm, equivalentFNumber, 3, ffDiagonal);
    expect(Math.abs(far - 1)).toBeLessThan(0.01);
    // Exact thin-lens factor from the basis statement: k·N·(s − f)/(s − k·f) makes the shares equal.
    const s = 300, f = 50;
    const exactN = cropFactor * 2 * (s - f) / (s - cropFactor * f);
    const close = shareOn(50, 2, 0.3, apsDiagonal) / shareOn(equivalentFocalLengthMm, exactN, 0.3, ffDiagonal);
    expect(close).toBeCloseTo(1, 10);
  });

  it("rejects bad input with domain errors", () => {
    expect(() => calculateSensorEquivalence({ sensor: APS_C, focalLengthMm: 0, fNumber: 2 })).toThrow(InvalidScientificInputError);
    expect(() => calculateSensorEquivalence({ sensor: APS_C, focalLengthMm: 50, fNumber: Number.NaN })).toThrow(InvalidScientificInputError);
    expect(() => calculateSensorEquivalence({ sensor: { widthMm: -1, heightMm: 2 }, focalLengthMm: 50, fNumber: 2 }))
      .toThrow(InvalidScientificInputError);
    expect(() => calculateSensorEquivalence({ sensor: APS_C, focalLengthMm: 50, fNumber: 2, extra: 1 } as never))
      .toThrow(new InvalidConfigurationError('calculateSensorEquivalence input has unknown field "extra".'));
    expect(() => calculateSensorEquivalence({ sensor: { widthMm: 1, heightMm: 1, depthMm: 1 }, focalLengthMm: 50, fNumber: 2 } as never))
      .toThrow(InvalidConfigurationError);
    expect(() => calculateSensorEquivalence({ sensor: { widthMm: 1e-300, heightMm: 1e-300 }, reference: { widthMm: 1e300, heightMm: 1e300 },
      focalLengthMm: 50, fNumber: 2 })).toThrow(InvalidScientificInputError);
  });

  it("stays finite for very large or small dimensions", () => {
    const value = calculateSensorEquivalence({ sensor: { widthMm: 1e200, heightMm: 1e200 }, reference: { widthMm: 2e200, heightMm: 2e200 },
      focalLengthMm: 50, fNumber: 2 }).value;
    expect(value.cropFactor).toBeCloseTo(2, 12);
    expect(value.areaRatio).toBeCloseTo(0.25, 12);
  });
});

describe("calculateBlurShareOfFrame", () => {
  it("expresses a blur circle against the frame diagonal, width and height", () => {
    const result = calculateBlurShareOfFrame({ blurCircleMm: 0.03, sensor: FULL_FRAME });
    expect(result.value.frameDiagonalMm).toBeCloseTo(Math.sqrt(1872), 12);
    expect(result.value.shareOfDiagonal).toBeCloseTo(0.00069337524528, 13);
    expect(result.value.shareOfWidth).toBeCloseTo(0.03 / 36, 15);
    expect(result.value.shareOfHeight).toBeCloseTo(0.03 / 24, 15);
    expect(result.value.print).toBeUndefined();
    expect(result.provenance.kind).toBe("calculated");
  });

  it("gives the same share for the equivalent blur on a smaller sensor", () => {
    const k = calculateSensorEquivalence({ sensor: APS_C, focalLengthMm: 50, fNumber: 2 }).value.cropFactor;
    const ff = calculateBlurShareOfFrame({ blurCircleMm: 0.03, sensor: FULL_FRAME }).value.shareOfDiagonal;
    const aps = calculateBlurShareOfFrame({ blurCircleMm: 0.03 / k, sensor: APS_C }).value.shareOfDiagonal;
    expect(aps).toBeCloseTo(ff, 15);
  });

  it("enlarges the whole frame onto a print, long side to long side", () => {
    // 300 × 200 mm print from 36 × 24 mm: enlargement 300/36 = 8.333…; 0.03 mm → 0.25 mm.
    const value = calculateBlurShareOfFrame({ blurCircleMm: 0.03, sensor: FULL_FRAME, print: { widthMm: 200, heightMm: 300 } }).value;
    expect(value.print?.enlargement).toBeCloseTo(300 / 36, 12);
    expect(value.print?.blurOnPrintMm).toBeCloseTo(0.25, 12);
    expect(value.print?.imageLongSideMm).toBeCloseTo(300, 12);
    expect(value.print?.imageShortSideMm).toBeCloseTo(200, 12);
    // A square print fits the long side; the short side leaves a border.
    const square = calculateBlurShareOfFrame({ blurCircleMm: 0.03, sensor: FULL_FRAME, print: { widthMm: 300, heightMm: 300 } }).value;
    expect(square.print?.enlargement).toBeCloseTo(300 / 36, 12);
    expect(square.print?.imageShortSideMm).toBeCloseTo(200, 12);
  });

  it("accepts zero blur and rejects bad input", () => {
    expect(calculateBlurShareOfFrame({ blurCircleMm: 0, sensor: APS_C }).value.shareOfDiagonal).toBe(0);
    expect(() => calculateBlurShareOfFrame({ blurCircleMm: -0.01, sensor: APS_C })).toThrow(InvalidScientificInputError);
    expect(() => calculateBlurShareOfFrame({ blurCircleMm: Number.POSITIVE_INFINITY, sensor: APS_C })).toThrow(InvalidScientificInputError);
    expect(() => calculateBlurShareOfFrame({ blurCircleMm: 0.01, sensor: APS_C, print: { widthMm: 0, heightMm: 10 } }))
      .toThrow(InvalidScientificInputError);
    expect(() => calculateBlurShareOfFrame({ blurCircleMm: 0.01, sensor: APS_C, dpi: 300 } as never)).toThrow(InvalidConfigurationError);
  });
});
