// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  LENS_PROJECTION_MODELS,
  calculateFieldOfView,
  calculateFieldOfViewBounds,
  calculateLensProjectionDirection,
  calculateLensProjectionFieldOfView,
  calculateLensProjectionFieldOfViewBounds,
  calculateLensProjectionImagePoint,
  parseLensProjectionModel,
  type LensProjectionModel
} from "../src/index.js";

const RADIAL: readonly Exclude<LensProjectionModel, "equirectangular">[] = [
  "rectilinear",
  "fisheye-equidistant",
  "fisheye-equisolid-angle",
  "fisheye-stereographic",
  "fisheye-orthographic"
];

function directionFromAngles(theta: number, azimuth: number): { x: number; y: number; z: number } {
  return {
    x: Math.sin(theta) * Math.cos(azimuth),
    y: Math.sin(theta) * Math.sin(azimuth),
    z: Math.cos(theta)
  };
}

describe("ideal lens projection mapping functions", () => {
  it("matches the analytic mapping function of every radial model", () => {
    const f = 10;
    const theta = 0.7;
    const expected: Record<string, number> = {
      rectilinear: f * Math.tan(theta),
      "fisheye-equidistant": f * theta,
      "fisheye-equisolid-angle": 2 * f * Math.sin(theta / 2),
      "fisheye-stereographic": 2 * f * Math.tan(theta / 2),
      "fisheye-orthographic": f * Math.sin(theta)
    };
    for (const model of RADIAL) {
      const result = calculateLensProjectionImagePoint({
        projectionModel: model,
        focalLengthMm: f,
        direction: directionFromAngles(theta, 0)
      });
      expect(result.value.imageRadiusMm).toBeCloseTo(expected[model]!, 12);
      expect(result.value.imagePointMm.y).toBeCloseTo(0, 12);
      expect(result.value.fieldAngleRadians).toBeCloseTo(theta, 14);
      expect(result.provenance.model).toBe(`${model}-lens-projection`);
    }
  });

  it("agrees with every model to first order near the axis (r ~ f theta)", () => {
    for (const model of RADIAL) {
      const r = calculateLensProjectionImagePoint({
        projectionModel: model,
        focalLengthMm: 20,
        direction: directionFromAngles(1e-6, 0.3)
      }).value.imageRadiusMm;
      expect(r / (20 * 1e-6)).toBeCloseTo(1, 9);
    }
  });

  it("round-trips direction -> image -> direction for every model, including off-axis azimuths", () => {
    for (const model of LENS_PROJECTION_MODELS) {
      for (const theta of [0, 0.2, 0.9, 1.4]) {
        for (const azimuth of [0, 0.5, Math.PI / 2, 2.2, Math.PI, -1.1]) {
          const direction = directionFromAngles(theta, azimuth);
          if (model === "equirectangular" && Math.abs(direction.x) < 1e-12 && Math.abs(direction.z) < 1e-12) continue;
          const image = calculateLensProjectionImagePoint({ projectionModel: model, focalLengthMm: 8, direction });
          const back = calculateLensProjectionDirection({
            projectionModel: model,
            focalLengthMm: 8,
            imagePointMm: image.value.imagePointMm
          }).value.direction;
          expect(back.x).toBeCloseTo(direction.x, 12);
          expect(back.y).toBeCloseTo(direction.y, 12);
          expect(back.z).toBeCloseTo(direction.z, 12);
        }
      }
    }
  });

  it("maps fisheye directions beyond 90 degrees (equidistant, equisolid, stereographic)", () => {
    const theta = 2.5;
    for (const model of ["fisheye-equidistant", "fisheye-equisolid-angle", "fisheye-stereographic"] as const) {
      const image = calculateLensProjectionImagePoint({ projectionModel: model, focalLengthMm: 5, direction: directionFromAngles(theta, 1) });
      const back = calculateLensProjectionDirection({ projectionModel: model, focalLengthMm: 5, imagePointMm: image.value.imagePointMm });
      expect(back.value.fieldAngleRadians).toBeCloseTo(theta, 12);
    }
    expect(() => calculateLensProjectionImagePoint({ projectionModel: "rectilinear", focalLengthMm: 5, direction: { x: 1, y: 0, z: 0 } })).toThrow(/domain/);
    expect(() => calculateLensProjectionImagePoint({ projectionModel: "fisheye-orthographic", focalLengthMm: 5, direction: { x: 1, y: 0, z: -0.1 } })).toThrow(/domain/);
    expect(() => calculateLensProjectionImagePoint({ projectionModel: "fisheye-equidistant", focalLengthMm: 5, direction: { x: 0, y: 0, z: -1 } })).toThrow(/domain/);
    // The orthographic horizon (90 degrees) is attainable and maps to r = f.
    expect(calculateLensProjectionImagePoint({ projectionModel: "fisheye-orthographic", focalLengthMm: 5, direction: { x: 0, y: 1, z: 0 } }).value.imagePointMm.y).toBeCloseTo(5, 14);
  });

  it("is rotation-covariant about the optical axis for all four orientations (radial models)", () => {
    for (const model of RADIAL) {
      const base = directionFromAngles(0.6, 0.35);
      const p0 = calculateLensProjectionImagePoint({ projectionModel: model, focalLengthMm: 12, direction: base }).value.imagePointMm;
      for (const quarterTurns of [1, 2, 3]) {
        const a = (quarterTurns * Math.PI) / 2;
        const rotated = {
          x: base.x * Math.cos(a) - base.y * Math.sin(a),
          y: base.x * Math.sin(a) + base.y * Math.cos(a),
          z: base.z
        };
        const p = calculateLensProjectionImagePoint({ projectionModel: model, focalLengthMm: 12, direction: rotated }).value.imagePointMm;
        expect(p.x).toBeCloseTo(p0.x * Math.cos(a) - p0.y * Math.sin(a), 12);
        expect(p.y).toBeCloseTo(p0.x * Math.sin(a) + p0.y * Math.cos(a), 12);
      }
    }
  });

  it("maps yaw to a horizontal translation for equirectangular", () => {
    const f = 3;
    const base = { x: 0.3, y: 0.4, z: 0.8 };
    const p0 = calculateLensProjectionImagePoint({ projectionModel: "equirectangular", focalLengthMm: f, direction: base }).value.imagePointMm;
    const yaw = 0.5;
    const yawed = {
      x: base.x * Math.cos(yaw) + base.z * Math.sin(yaw),
      y: base.y,
      z: -base.x * Math.sin(yaw) + base.z * Math.cos(yaw)
    };
    const p = calculateLensProjectionImagePoint({ projectionModel: "equirectangular", focalLengthMm: f, direction: yawed }).value.imagePointMm;
    expect(p.x - p0.x).toBeCloseTo(f * yaw, 12);
    expect(p.y).toBeCloseTo(p0.y, 14);
    expect(() => calculateLensProjectionImagePoint({ projectionModel: "equirectangular", focalLengthMm: f, direction: { x: 0, y: 1, z: 0 } })).toThrow(/poles/);
    expect(() => calculateLensProjectionDirection({ projectionModel: "equirectangular", focalLengthMm: f, imagePointMm: { x: 0, y: 5 } })).toThrow(/domain/);
  });

  it("computes analytic fields of view and rejects sensors larger than the image circle", () => {
    expect(calculateLensProjectionFieldOfView({ projectionModel: "fisheye-equidistant", focalLengthMm: 8, sensorDimensionMm: 24 }).value.radians).toBeCloseTo(3, 14);
    expect(calculateLensProjectionFieldOfView({ projectionModel: "fisheye-equisolid-angle", focalLengthMm: 8, sensorDimensionMm: 16 }).value.radians).toBeCloseTo(4 * Math.asin(0.5), 14);
    expect(calculateLensProjectionFieldOfView({ projectionModel: "fisheye-stereographic", focalLengthMm: 8, sensorDimensionMm: 32 }).value.degrees).toBeCloseTo(180, 12);
    expect(calculateLensProjectionFieldOfView({ projectionModel: "fisheye-orthographic", focalLengthMm: 8, sensorDimensionMm: 16 }).value.degrees).toBeCloseTo(180, 12);
    expect(calculateLensProjectionFieldOfView({ projectionModel: "equirectangular", focalLengthMm: 10, sensorDimensionMm: 20 * Math.PI }).value.degrees).toBeCloseTo(360, 12);
    expect(() => calculateLensProjectionFieldOfView({ projectionModel: "fisheye-orthographic", focalLengthMm: 8, sensorDimensionMm: 16.01 })).toThrow(/image circle/);
    expect(() => calculateLensProjectionFieldOfView({ projectionModel: "fisheye-equisolid-angle", focalLengthMm: 8, sensorDimensionMm: 32 })).toThrow(/image circle/);
    expect(() => calculateLensProjectionFieldOfView({ projectionModel: "equirectangular", focalLengthMm: 1, sensorDimensionMm: 7 })).toThrow(/360/);
  });

  it("splits an off-centre crop into consistent signed bounds", () => {
    for (const model of LENS_PROJECTION_MODELS) {
      const bounds = calculateLensProjectionFieldOfViewBounds({ projectionModel: model, focalLengthMm: 10, minimumSensorCoordinateMm: -3, maximumSensorCoordinateMm: 7 }).value;
      const symmetric = calculateLensProjectionFieldOfView({ projectionModel: model, focalLengthMm: 10, sensorDimensionMm: 6 }).value;
      expect(-bounds.minimumRadians).toBeCloseTo(symmetric.radians / 2, 14);
      expect(bounds.radians).toBeCloseTo(bounds.maximumRadians - bounds.minimumRadians, 15);
      expect(bounds.maximumRadians).toBeGreaterThan(-bounds.minimumRadians);
    }
    expect(() => calculateLensProjectionFieldOfViewBounds({ projectionModel: "rectilinear", focalLengthMm: 10, minimumSensorCoordinateMm: 1, maximumSensorCoordinateMm: 1 })).toThrow();
  });

  it("keeps the rectilinear field-of-view API unchanged by default and dispatches the discriminator", () => {
    const legacy = calculateFieldOfView({ focalLengthMm: 50, sensorDimensionMm: 36 });
    const explicit = calculateFieldOfView({ focalLengthMm: 50, sensorDimensionMm: 36, projectionModel: "rectilinear" });
    expect(explicit).toEqual(legacy);
    expect(legacy.provenance.model).toBe("rectilinear-field-of-view");
    expect(legacy.value.degrees).toBeCloseTo(39.597752709, 8);
    expect(calculateLensProjectionFieldOfView({ projectionModel: "rectilinear", focalLengthMm: 50, sensorDimensionMm: 36 }).value.radians).toBeCloseTo(legacy.value.radians, 15);

    const fisheye = calculateFieldOfView({ focalLengthMm: 8, sensorDimensionMm: 24, projectionModel: "fisheye-equidistant" });
    expect(fisheye.value.radians).toBeCloseTo(3, 14);
    expect(fisheye.provenance.model).toBe("fisheye-equidistant-field-of-view");
    expect(Object.keys(fisheye.value).sort()).toEqual(["degrees", "projectionDistanceMm", "radians"]);
    expect(() => calculateFieldOfView({ focalLengthMm: 8, sensorDimensionMm: 24, projectionModel: "fisheye-equidistant", focusDistanceM: 1 })).toThrow(/rectilinear/);
    expect(() => calculateFieldOfView({ focalLengthMm: 8, sensorDimensionMm: 24, projectionModel: "barrel" as never })).toThrow(/projectionModel/);

    const bounds = calculateFieldOfViewBounds({ focalLengthMm: 8, minimumSensorCoordinateMm: -4, maximumSensorCoordinateMm: 8, projectionModel: "fisheye-equidistant" });
    expect(bounds.value.radians).toBeCloseTo(1.5, 14);
    expect(Object.keys(bounds.value)).not.toContain("projectionModel");
    expect(calculateFieldOfViewBounds({ focalLengthMm: 8, minimumSensorCoordinateMm: -4, maximumSensorCoordinateMm: 8, projectionModel: "rectilinear" })).toEqual(
      calculateFieldOfViewBounds({ focalLengthMm: 8, minimumSensorCoordinateMm: -4, maximumSensorCoordinateMm: 8 })
    );
  });

  it("fails closed on malformed input", () => {
    expect(() => parseLensProjectionModel("fisheye")).toThrow(/projectionModel/);
    expect(() => calculateLensProjectionImagePoint(null as never)).toThrow(/object/);
    expect(() => calculateLensProjectionImagePoint({ projectionModel: "rectilinear", focalLengthMm: 1, direction: { x: 0, y: 0, z: 0 } })).toThrow(/non-zero/);
    expect(() => calculateLensProjectionImagePoint({ projectionModel: "rectilinear", focalLengthMm: 0, direction: { x: 0, y: 0, z: 1 } })).toThrow();
    expect(() => calculateLensProjectionDirection({ projectionModel: "rectilinear", focalLengthMm: 1, imagePointMm: { x: Number.NaN, y: 0 } })).toThrow(/finite/);
  });
});

describe("step 8 edge cases (#700)", () => {
  it("returns frozen field-of-view envelopes for every projection model (optics-06)", () => {
    for (const projectionModel of LENS_PROJECTION_MODELS) {
      const fov = calculateFieldOfView({ focalLengthMm: 8, sensorDimensionMm: 12, projectionModel });
      expect(Object.isFrozen(fov), projectionModel).toBe(true);
      expect(Object.isFrozen(fov.value), projectionModel).toBe(true);
      expect(fov.provenance.kind).toBe("calculated");
      const bounds = calculateFieldOfViewBounds({ focalLengthMm: 8, minimumSensorCoordinateMm: -5, maximumSensorCoordinateMm: 6, projectionModel });
      expect(Object.isFrozen(bounds), projectionModel).toBe(true);
      expect(Object.isFrozen(bounds.value), projectionModel).toBe(true);
    }
    const lens = calculateLensProjectionFieldOfView({ projectionModel: "fisheye-equisolid-angle", focalLengthMm: 8, sensorDimensionMm: 20 });
    const fov = calculateFieldOfView({ focalLengthMm: 8, sensorDimensionMm: 20, projectionModel: "fisheye-equisolid-angle" });
    expect(fov.value.degrees).toBe(lens.value.degrees);
    expect(fov.provenance).toEqual(lens.provenance);
  });

  it("rejects equirectangular field-of-view bounds outside +/-180 degrees (optics-24)", () => {
    expect(() => calculateLensProjectionFieldOfViewBounds({ projectionModel: "equirectangular", focalLengthMm: 8, minimumSensorCoordinateMm: -80, maximumSensorCoordinateMm: -72 }))
      .toThrow(/180/);
    expect(() => calculateFieldOfViewBounds({ projectionModel: "equirectangular", focalLengthMm: 8, minimumSensorCoordinateMm: 100, maximumSensorCoordinateMm: 110 }))
      .toThrow(/180/);
    const full = calculateLensProjectionFieldOfViewBounds({ projectionModel: "equirectangular", focalLengthMm: 8, minimumSensorCoordinateMm: -8 * Math.PI, maximumSensorCoordinateMm: 8 * Math.PI });
    expect(full.value.radians).toBeCloseTo(2 * Math.PI, 12);
  });
});
