// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateFieldOfView,
  calculateFocusBreathingFieldOfView,
  calculateFocusBreathingProjection,
  calculateGeometricFocusBreathing,
  calculateThinLensImageDistance
} from "../src/index.js";

describe("declared-scale focus breathing", () => {
  it("reproduces the current thin-lens projection exactly at scale 1", () => {
    const thinLens = calculateThinLensImageDistance({
      focalLengthMm: 50,
      objectDistanceM: 2
    });
    const breathing = calculateFocusBreathingProjection({
      focalLengthMm: 50,
      focusDistanceM: 2,
      breathingProjectionScale: 1
    });

    expect(breathing.value.physicalFocalLengthMm).toBe(50);
    expect(breathing.value.idealProjectionDistanceMm).toBeCloseTo(
      thinLens.value.imageDistanceMm,
      12
    );
    expect(breathing.value.effectiveProjectionDistanceMm).toBeCloseTo(
      thinLens.value.imageDistanceMm,
      12
    );
    expect(breathing.value.effectiveMagnification).toBeCloseTo(
      thinLens.value.magnification,
      12
    );
  });

  it("reproduces the current focus-aware field of view exactly at scale 1", () => {
    const current = calculateFieldOfView({
      focalLengthMm: 50,
      sensorDimensionMm: 36,
      focusDistanceM: 2
    });
    const breathing = calculateFocusBreathingFieldOfView({
      focalLengthMm: 50,
      focusDistanceM: 2,
      sensorDimensionMm: 36,
      breathingProjectionScale: 1
    });

    expect(breathing.value.idealDegrees).toBeCloseTo(
      current.value.degrees,
      12
    );
    expect(breathing.value.effectiveDegrees).toBeCloseTo(
      current.value.degrees,
      12
    );
    expect(breathing.value.deltaDegrees).toBeCloseTo(0, 12);
  });

  it("narrows framing and increases magnification for scale above 1", () => {
    const result = calculateFocusBreathingFieldOfView({
      focalLengthMm: 85,
      focusDistanceM: 3,
      sensorDimensionMm: 36,
      breathingProjectionScale: 1.08
    });

    expect(result.value.physicalFocalLengthMm).toBe(85);
    expect(result.value.effectiveProjectionDistanceMm).toBeCloseTo(
      result.value.idealProjectionDistanceMm * 1.08,
      12
    );
    expect(result.value.effectiveDegrees).toBeLessThan(
      result.value.idealDegrees
    );
    expect(result.value.deltaDegrees).toBeLessThan(0);

    const projection = calculateFocusBreathingProjection({
      focalLengthMm: 85,
      focusDistanceM: 3,
      breathingProjectionScale: 1.08
    });
    expect(projection.value.effectiveMagnification).toBeGreaterThan(
      projection.value.idealMagnification
    );
  });

  it("widens framing and reduces magnification for scale below 1", () => {
    const fieldOfView = calculateFocusBreathingFieldOfView({
      focalLengthMm: 35,
      focusDistanceM: 1.5,
      sensorDimensionMm: 24,
      breathingProjectionScale: 0.94
    });
    const projection = calculateFocusBreathingProjection({
      focalLengthMm: 35,
      focusDistanceM: 1.5,
      breathingProjectionScale: 0.94
    });

    expect(fieldOfView.value.effectiveDegrees).toBeGreaterThan(
      fieldOfView.value.idealDegrees
    );
    expect(fieldOfView.value.deltaDegrees).toBeGreaterThan(0);
    expect(projection.value.effectiveMagnification).toBeLessThan(
      projection.value.idealMagnification
    );
  });

  it("keeps physical focal length unchanged for every declared breathing scale", () => {
    for (const scale of [0.9, 1, 1.1] as const) {
      const result = calculateFocusBreathingProjection({
        focalLengthMm: 50,
        focusDistanceM: 1,
        breathingProjectionScale: scale
      });

      expect(result.value.physicalFocalLengthMm).toBe(50);
      expect(result.value.breathingProjectionScale).toBe(scale);
    }
  });

  it("does not infer a hidden breathing curve from focus distance", () => {
    const near = calculateFocusBreathingProjection({
      focalLengthMm: 50,
      focusDistanceM: 1,
      breathingProjectionScale: 1.05
    });
    const far = calculateFocusBreathingProjection({
      focalLengthMm: 50,
      focusDistanceM: 10,
      breathingProjectionScale: 1.05
    });

    expect(
      near.value.effectiveProjectionDistanceMm /
        near.value.idealProjectionDistanceMm
    ).toBeCloseTo(1.05, 12);
    expect(
      far.value.effectiveProjectionDistanceMm /
        far.value.idealProjectionDistanceMm
    ).toBeCloseTo(1.05, 12);
    expect(near.provenance.assumptions?.join(" ")).toContain(
      "supplied explicitly by the caller"
    );
  });

  it("changes FOV with sensor dimension while preserving the declared projection scale", () => {
    const fullFrame = calculateFocusBreathingFieldOfView({
      focalLengthMm: 50,
      focusDistanceM: 2,
      sensorDimensionMm: 36,
      breathingProjectionScale: 1.03
    });
    const crop = calculateFocusBreathingFieldOfView({
      focalLengthMm: 50,
      focusDistanceM: 2,
      sensorDimensionMm: 24,
      breathingProjectionScale: 1.03
    });

    expect(fullFrame.value.effectiveDegrees).toBeGreaterThan(
      crop.value.effectiveDegrees
    );
    expect(fullFrame.value.breathingProjectionScale).toBe(1.03);
    expect(crop.value.breathingProjectionScale).toBe(1.03);
    expect(fullFrame.value.effectiveProjectionDistanceMm).toBeCloseTo(
      crop.value.effectiveProjectionDistanceMm,
      12
    );
  });

  it("labels the model as an approximation rather than calibrated lens behavior", () => {
    const result = calculateFocusBreathingProjection({
      focalLengthMm: 50,
      focusDistanceM: 2,
      breathingProjectionScale: 1.02
    });

    expect(result.provenance.kind).toBe("approximation");
    expect(result.provenance.model).toBe(
      "declared-scale-focus-breathing-projection"
    );
    expect(result.provenance.assumptions?.join(" ")).toContain(
      "named-lens calibration"
    );
  });

  it("rejects non-positive breathing scales and invalid sensor dimensions", () => {
    expect(() =>
      calculateFocusBreathingProjection({
        focalLengthMm: 50,
        focusDistanceM: 2,
        breathingProjectionScale: 0
      })
    ).toThrow("breathingProjectionScale");

    expect(() =>
      calculateFocusBreathingFieldOfView({
        focalLengthMm: 50,
        focusDistanceM: 2,
        sensorDimensionMm: 0,
        breathingProjectionScale: 1
      })
    ).toThrow("sensorDimensionMm");
  });
});

describe("unit focus at a very large subject distance (optics-25, #700)", () => {
  it("returns v = f, not 0, once T^2 overflows", () => {
    for (const subjectToSensorDistanceM of [1.4e151, 1e155, 1e300]) {
      const r = calculateGeometricFocusBreathing({ focalLengthMm: 50, subjectToSensorDistanceM, sensorDimensionMm: 36, focusingMethod: "unit-focus" }).value;
      expect(r.imageDistanceMm).toBe(50);
      expect(r.fieldOfViewDegrees).toBeCloseTo(39.598, 3);
    }
    const ordinary = calculateGeometricFocusBreathing({ focalLengthMm: 50, subjectToSensorDistanceM: 1.3e151, sensorDimensionMm: 36, focusingMethod: "unit-focus" }).value;
    expect(ordinary.imageDistanceMm).toBe(50);
  });
});
