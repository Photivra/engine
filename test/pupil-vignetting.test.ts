// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateIdealApertureGeometry,
  calculateIdealPolygonDiffractionPsf,
  calculateLensComplexPupilPsf,
  calculateMechanicalVignetting,
  calculateNaturalVignetting,
  calculatePolygonPupilFraunhoferPsf,
  createWavefrontPupilGrid
} from "../src/index.js";
import { complexPupilProfileForGrid } from "./helpers/complex-pupil-profile.js";

function rotate(p: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const a = (degrees * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

describe("natural (cos^4 / finite Lambertian pupil) vignetting", () => {
  it("evaluates cos^4 of the chief-ray angle", () => {
    const result = calculateNaturalVignetting({ model: "cosine-fourth", imagePointMm: { x: 30, y: 40 }, exitPupilDistanceMm: 50 }).value;
    expect(result.chiefRayAngleRadians).toBeCloseTo(Math.PI / 4, 14);
    expect(result.relativeIllumination).toBeCloseTo(0.25, 14);
    expect(result.attenuationStops).toBeCloseTo(2, 13);
    expect(calculateNaturalVignetting({ model: "cosine-fourth", imagePointMm: { x: 0, y: 0 }, exitPupilDistanceMm: 50 }).value.relativeIllumination).toBe(1);
  });

  it("is rotationally symmetric for all four orientations, including off-axis points", () => {
    for (const model of ["cosine-fourth", "finite-lambertian-pupil"] as const) {
      const extra = model === "finite-lambertian-pupil" ? { exitPupilDiameterMm: 25 } : {};
      const base = calculateNaturalVignetting({ model, imagePointMm: { x: 12, y: 5 }, exitPupilDistanceMm: 60, ...extra }).value.relativeIllumination;
      for (const degrees of [90, 180, 270]) {
        const p = rotate({ x: 12, y: 5 }, degrees);
        expect(calculateNaturalVignetting({ model, imagePointMm: p, exitPupilDistanceMm: 60, ...extra }).value.relativeIllumination).toBeCloseTo(base, 14);
      }
    }
  });

  it("finite-pupil illumination is 1 on axis, decreases with height and tends to cos^4 for a small pupil", () => {
    let previous = 1;
    for (const h of [0, 5, 10, 20, 40]) {
      const value = calculateNaturalVignetting({ model: "finite-lambertian-pupil", imagePointMm: { x: h, y: 0 }, exitPupilDistanceMm: 50, exitPupilDiameterMm: 30 }).value.relativeIllumination;
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
    const small = calculateNaturalVignetting({ model: "finite-lambertian-pupil", imagePointMm: { x: 30, y: 0 }, exitPupilDistanceMm: 50, exitPupilDiameterMm: 1e-4 }).value;
    expect(small.relativeIllumination).toBeCloseTo(small.cosineFourthFactor, 9);
    // Independent numerical integration over the Lambertian disk: E ∝ ∫ cos^2 / d^2 ... (a = 15, z = 50, h = 20).
    const a = 15;
    const z = 50;
    const integrate = (h: number): number => {
      let sum = 0;
      const nr = 400;
      const nt = 400;
      for (let i = 0; i < nr; i += 1) {
        const r = ((i + 0.5) / nr) * a;
        for (let j = 0; j < nt; j += 1) {
          const t = (2 * Math.PI * (j + 0.5)) / nt;
          const dx = r * Math.cos(t) - h;
          const dy = r * Math.sin(t);
          const d2 = dx * dx + dy * dy + z * z;
          sum += ((z * z) / (d2 * d2)) * r;
        }
      }
      return sum;
    };
    const numeric = integrate(20) / integrate(0);
    const analytic = calculateNaturalVignetting({ model: "finite-lambertian-pupil", imagePointMm: { x: 20, y: 0 }, exitPupilDistanceMm: z, exitPupilDiameterMm: 2 * a }).value.relativeIllumination;
    expect(analytic).toBeCloseTo(numeric, 5);
  });

  it("validates inputs", () => {
    expect(() => calculateNaturalVignetting({ model: "cos3" as never, imagePointMm: { x: 0, y: 0 }, exitPupilDistanceMm: 1 })).toThrow(/model/);
    expect(() => calculateNaturalVignetting({ model: "cosine-fourth", imagePointMm: { x: 0, y: 0 }, exitPupilDistanceMm: 1, exitPupilDiameterMm: 2 })).toThrow(/omit/);
    expect(() => calculateNaturalVignetting({ model: "finite-lambertian-pupil", imagePointMm: { x: 0, y: 0 }, exitPupilDistanceMm: 1 })).toThrow(/exitPupilDiameterMm/);
    expect(() => calculateNaturalVignetting(null as never)).toThrow(/object/);
  });
});

describe("mechanical vignetting and cat's-eye pupil", () => {
  const front = { radiusMm: 7, shiftPerTanFieldMm: 30 };

  it("is unvignetted on axis and matches the exact circle-circle area off axis", () => {
    const axis = calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 0, fieldAzimuthDegrees: 0, apertures: [front] }).value;
    expect(axis.openAreaRatio).toBe(1);
    const off = calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 20, fieldAzimuthDegrees: 0, apertures: [front], boundarySamplesPerCircle: 4096 }).value;
    const d = 30 * Math.tan((20 * Math.PI) / 180);
    const r1 = 6;
    const r2 = 7;
    const exact =
      r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)) +
      r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)) -
      0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
    expect(off.areaMethod).toBe("exact-circle-circle-intersection");
    expect(off.openAreaSquareMm).toBeCloseTo(exact, 12);
    expect(off.openAreaRatio).toBeLessThan(1);
    expect(off.combinedRelativeIllumination).toBeCloseTo(off.openAreaRatio * Math.cos((20 * Math.PI) / 180) ** 4, 14);
    // The boundary polygon (vertices on the true circles) converges to the exact area.
    let polygonArea = 0;
    const poly = off.openPupilPolygonMm;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      polygonArea += (a.x * b.y - b.x * a.y) / 2;
    }
    expect(polygonArea / exact).toBeGreaterThan(0.9995);
    expect(polygonArea / exact).toBeLessThanOrEqual(1);
  });

  it("rotates the cat's-eye pupil with the field azimuth (four orientations)", () => {
    const near = { radiusMm: 7, shiftPerTanFieldMm: 15 };
    const base = calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 25, fieldAzimuthDegrees: 10, apertures: [near] }).value;
    expect(base.openPupilCentroidMm).not.toBeNull();
    for (const turn of [90, 180, 270]) {
      const rotated = calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 25, fieldAzimuthDegrees: 10 + turn, apertures: [near] }).value;
      const expected = rotate(base.openPupilCentroidMm!, turn);
      expect(rotated.openPupilCentroidMm!.x).toBeCloseTo(expected.x, 6);
      expect(rotated.openPupilCentroidMm!.y).toBeCloseTo(expected.y, 6);
      expect(rotated.openAreaRatio).toBeCloseTo(base.openAreaRatio, 14);
    }
  });

  it("forms a symmetric cat's eye from front and rear apertures and can be fully vignetted", () => {
    const both = calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 20, fieldAzimuthDegrees: 0, apertures: [{ radiusMm: 7, shiftPerTanFieldMm: 15 }, { radiusMm: 7, shiftPerTanFieldMm: -15 }], boundarySamplesPerCircle: 2048 }).value;
    expect(both.areaMethod).toBe("boundary-polygon");
    expect(both.openPupilCentroidMm!.x).toBeCloseTo(0, 9);
    expect(both.openPupilCentroidMm!.y).toBeCloseTo(0, 9);
    // Deterministic grid count of the triple-circle intersection.
    const d = 15 * Math.tan((20 * Math.PI) / 180);
    let inside = 0;
    let total = 0;
    const n = 800;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const x = -6 + (12 * (i + 0.5)) / n;
        const y = -6 + (12 * (j + 0.5)) / n;
        if (x * x + y * y > 36) continue;
        total += 1;
        if ((x - d) ** 2 + y * y <= 49 && (x + d) ** 2 + y * y <= 49) inside += 1;
      }
    }
    expect(both.openAreaRatio).toBeCloseTo(inside / total, 3);
    const blocked = calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 60, fieldAzimuthDegrees: 0, apertures: [{ radiusMm: 2, shiftPerTanFieldMm: 30 }] }).value;
    expect(blocked.openAreaRatio).toBe(0);
    expect(blocked.openPupilPolygonMm).toEqual([]);
    expect(blocked.openPupilCentroidMm).toBeNull();
  });

  it("validates inputs", () => {
    expect(() => calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 90, fieldAzimuthDegrees: 0, apertures: [front] })).toThrow(/\[0, 90\)/);
    expect(() => calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 10, fieldAzimuthDegrees: 0, apertures: [] })).toThrow(/1 through 8/);
    expect(() => calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 10, fieldAzimuthDegrees: 0, apertures: [front], boundarySamplesPerCircle: 3 })).toThrow(/16 through/);
    expect(() => calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 10, fieldAzimuthDegrees: 0, apertures: [null as never] })).toThrow(/object/);
  });
});

describe("cat's-eye pupil as a PSF aperture", () => {
  it("reproduces the regular-polygon Fraunhofer PSF for regular-polygon vertices", () => {
    const geometry = calculateIdealApertureGeometry({ bladeCount: 6 }).value;
    const equalArea = 4;
    const unitArea = (6 * Math.sin((2 * Math.PI) / 6)) / 2;
    const circumradius = Math.sqrt((Math.PI * (equalArea / 2) ** 2) / unitArea);
    const vertices = geometry.normalizedVertices.map((v) => ({ x: v.x * circumradius + 0.7, y: v.y * circumradius - 0.3 }));
    const points = [{ x: 0, y: 0 }, { x: 3, y: 1 }, { x: -2, y: 5 }, { x: 7, y: -4 }];
    const regular = calculateIdealPolygonDiffractionPsf({ bladeCount: 6, equivalentAreaPupilDiameterMm: equalArea, pupilToImageDistanceMm: 50, wavelengthNm: 550, wavelengthBasis: "air", imagePointsMicrometers: points }).value;
    const general = calculatePolygonPupilFraunhoferPsf({ pupilVerticesMm: vertices, pupilToImageDistanceMm: 50, wavelengthNm: 550, wavelengthBasis: "air", imagePointsMicrometers: points }).value;
    expect(general.pupilAreaSquareMm).toBeCloseTo(regular.pupilAreaSquareMm, 12);
    general.samples.forEach((sample, index) => {
      expect(sample.intensityDensityPerSquareMicrometer).toBeCloseTo(regular.samples[index]!.intensityDensityPerSquareMicrometer, 10);
    });
    // Clockwise vertex order gives the same intensity.
    const reversed = calculatePolygonPupilFraunhoferPsf({ pupilVerticesMm: [...vertices].reverse(), pupilToImageDistanceMm: 50, wavelengthNm: 550, wavelengthBasis: "air", imagePointsMicrometers: points }).value;
    reversed.samples.forEach((sample, index) => expect(sample.peakNormalizedIntensity).toBeCloseTo(general.samples[index]!.peakNormalizedIntensity, 12));
  });

  it("rotates the cat's-eye PSF with the field azimuth and widens it across the narrow pupil axis", () => {
    const pupil = (azimuth: number): readonly { x: number; y: number }[] => calculateMechanicalVignetting({ entrancePupilDiameterMm: 12, fieldAngleDegrees: 25, fieldAzimuthDegrees: azimuth, apertures: [{ radiusMm: 7, shiftPerTanFieldMm: 15 }, { radiusMm: 7, shiftPerTanFieldMm: -15 }] }).value.openPupilPolygonMm;
    const samplePoints = [{ x: 2, y: 0 }, { x: 0, y: 2 }, { x: 1.5, y: 1 }];
    const psf = (azimuth: number, points: readonly { x: number; y: number }[]): number[] => calculatePolygonPupilFraunhoferPsf({ pupilVerticesMm: pupil(azimuth), pupilToImageDistanceMm: 50, wavelengthNm: 550, wavelengthBasis: "air", imagePointsMicrometers: points }).value.samples.map((s) => s.peakNormalizedIntensity);
    const base = psf(0, samplePoints);
    // Narrow along the field (x) direction -> wider PSF along x: more energy remains at (2, 0) than at (0, 2).
    expect(base[0]!).toBeGreaterThan(base[1]!);
    for (const turn of [90, 180, 270]) {
      const rotated = psf(turn, samplePoints.map((p) => rotate(p, turn)));
      rotated.forEach((value, index) => expect(value).toBeCloseTo(base[index]!, 5));
    }
  });

  it("masks a complex-pupil grid with the cat's-eye polygon", () => {
    const vignetting = calculateMechanicalVignetting({ entrancePupilDiameterMm: 12.5, fieldAngleDegrees: 20, fieldAzimuthDegrees: 0, apertures: [{ radiusMm: 7, shiftPerTanFieldMm: 30 }] }).value;
    const full = createWavefrontPupilGrid({ pupilDiameterMm: 12.5, samplesAcross: 41 }).value;
    const masked = createWavefrontPupilGrid({ pupilDiameterMm: 12.5, samplesAcross: 41, apertureMaskVerticesMm: vignetting.openPupilPolygonMm }).value;
    expect(masked.openSampleCount / full.openSampleCount).toBeCloseTo(vignetting.openAreaRatio, 1);
    const kernel = calculateLensComplexPupilPsf({ profile: complexPupilProfileForGrid(masked.grid) }).value.kernel;
    const sum = kernel.normalizedIntensity.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it("validates polygon pupil inputs", () => {
    const base = { pupilToImageDistanceMm: 50, wavelengthNm: 550, wavelengthBasis: "air" as const, imagePointsMicrometers: [{ x: 0, y: 0 }] };
    expect(() => calculatePolygonPupilFraunhoferPsf({ ...base, pupilVerticesMm: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })).toThrow(/3 through/);
    expect(() => calculatePolygonPupilFraunhoferPsf({ ...base, pupilVerticesMm: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] })).toThrow(/area/);
    expect(() => calculatePolygonPupilFraunhoferPsf({ ...base, pupilVerticesMm: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] })).toThrow(/non-zero/);
    expect(() => calculatePolygonPupilFraunhoferPsf({ ...base, wavelengthBasis: "unspecified" as never, pupilVerticesMm: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })).toThrow(/air or vacuum/);
    expect(() => calculatePolygonPupilFraunhoferPsf({ ...base, imagePointsMicrometers: [{ x: 0, y: 0, z: 1 } as never], pupilVerticesMm: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })).toThrow(/x\/y/);
    expect(() => calculatePolygonPupilFraunhoferPsf(null as never)).toThrow(/object/);
  });
});

describe("calculateMechanicalVignetting at tangency (optics-16, #700)", () => {
  it("returns the fully vignetted result when an aperture only touches the pupil", () => {
    for (const input of [
      { entrancePupilDiameterMm: 10, fieldAngleDegrees: 45, fieldAzimuthDegrees: 45, apertures: [{ radiusMm: 5, shiftPerTanFieldMm: 10 }] },
      { entrancePupilDiameterMm: 25, fieldAngleDegrees: 45, fieldAzimuthDegrees: 90, apertures: [{ radiusMm: 12.5, shiftPerTanFieldMm: 25 }] }
    ]) {
      const v = calculateMechanicalVignetting(input).value;
      expect(v.openAreaSquareMm).toBe(0);
      expect(v.openAreaRatio).toBe(0);
      expect(v.openPupilPolygonMm).toEqual([]);
      expect(v.openPupilCentroidMm).toBeNull();
    }
  });

  it("puts the centroid inside the pupil at internal tangency and for round-number tangent cases", () => {
    for (const samples of [17, 64, 256]) {
      const v = calculateMechanicalVignetting({ entrancePupilDiameterMm: 10, fieldAngleDegrees: 45, fieldAzimuthDegrees: 30, apertures: [{ radiusMm: 3, shiftPerTanFieldMm: 2 }], boundarySamplesPerCircle: samples }).value;
      expect(v.openAreaRatio).toBeCloseTo(0.36, 12);
      expect(Math.hypot(v.openPupilCentroidMm!.x, v.openPupilCentroidMm!.y)).toBeLessThanOrEqual(5);
    }
    for (const d of [10, 20, 25, 50]) for (const angle of [30, 45, 60]) for (const azimuth of [0, 45, 90, 135]) {
      const r = d / 2;
      const shift = d / Math.tan((angle * Math.PI) / 180);
      const v = calculateMechanicalVignetting({ entrancePupilDiameterMm: d, fieldAngleDegrees: angle, fieldAzimuthDegrees: azimuth, apertures: [{ radiusMm: r, shiftPerTanFieldMm: shift }] }).value;
      if (v.openPupilCentroidMm !== null) expect(Math.hypot(v.openPupilCentroidMm.x, v.openPupilCentroidMm.y)).toBeLessThanOrEqual(r);
    }
  });
});
