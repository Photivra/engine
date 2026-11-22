// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { calculateIdealPolygonDiffractionPsf, calculateAiryDisk, calculatePolygonPupilFraunhoferPsf, InvalidConfigurationError, InvalidScientificInputError } from "../src/index.js";
import type { CalculateIdealPolygonDiffractionInput } from "../src/index.js";

const base: CalculateIdealPolygonDiffractionInput = {
  bladeCount: 4,
  firstBladeEdgeAngleDegrees: 0,
  equivalentAreaPupilDiameterMm: 10,
  pupilToImageDistanceMm: 50,
  wavelengthNm: 550,
  wavelengthBasis: "air",
  imagePointsMicrometers: [{ x: 0, y: 0 }]
};
function sinc(x: number): number { return x === 0 ? 1 : Math.sin(x) / x; }
function sample(x: number, y: number, overrides: Partial<CalculateIdealPolygonDiffractionInput> = {}): number {
  return calculateIdealPolygonDiffractionPsf({ ...base, ...overrides,
    imagePointsMicrometers: [{ x, y }] }).value.samples[0]!.peakNormalizedIntensity;
}
// Independent circle Fourier integral: 2J1(z)/z, computed by its power series.
function circularIntensity(z: number): number {
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 40; k += 1) {
    term *= -(z * z / 4) / (k * (k + 1));
    sum += term;
  }
  return sum * sum;
}

describe("ideal polygon diffraction", () => {
  it("uses explicit equal area, continuous unit energy, and a finite origin", () => {
    const result = calculateIdealPolygonDiffractionPsf(base);
    expect(result.provenance.kind).toBe("approximation");
    expect(result.value.pupilAreaSquareMm).toBeCloseTo(25 * Math.PI, 12);
    expect(result.value.pupilCircumradiusMm).toBeCloseTo(Math.sqrt(25 * Math.PI / 2), 12);
    expect(result.value.energyNormalization).toBe("unit-integral-over-infinite-image-plane");
    expect(result.value.throughputApplied).toBe(false);
    expect(result.value.samples[0]!.peakNormalizedIntensity).toBe(1);
    expect(result.value.samples[0]!.intensityDensityPerSquareMicrometer).toBeCloseTo(
      25 * Math.PI / (0.00055 * 50) ** 2 / 1_000_000, 12);
    for (const n of [3, 4, 7, 32, 1024]) {
      for (const tiny of [1e-4, 1e-8, 1e-50, 1e-200]) {
        expect(sample(tiny, -tiny, { bladeCount: n })).toBeCloseTo(1, 6);
      }
    }
  });

  it("matches independently derived square sinc-squared diffraction including zeros", () => {
    const sideMm = Math.sqrt(25 * Math.PI);
    const scaleMicrometers = 0.00055 * 50 / sideMm * 1000;
    for (const [x, y] of [[0, 0], [0.1, 0.4], [0.5, 0], [1, 0], [2, 3], [-1.3, 0.7], [10.2, 7.4]]) {
      const expected = sinc(Math.PI * x!) ** 2 * sinc(Math.PI * y!) ** 2;
      expect(sample(x! * scaleMicrometers, y! * scaleMicrometers)).toBeCloseTo(expected, 12);
    }
  });

  it("preserves orientation, odd/even symmetry, and full rotation covariance", () => {
    for (const n of [3, 4, 5, 6, 7]) {
      for (const angle of [0, 37, 90, 180, 270, 360]) {
        const radians = angle * Math.PI / 180;
        const x = 3 * Math.cos(radians) + 2 * Math.sin(radians);
        const y = 3 * Math.sin(radians) - 2 * Math.cos(radians);
        expect(sample(x, y, { bladeCount: n, firstBladeEdgeAngleDegrees: angle }))
          .toBeCloseTo(sample(3, -2, { bladeCount: n }), 12);
      }
      expect(sample(-3, 2, { bladeCount: n })).toBeCloseTo(sample(3, -2, { bladeCount: n }), 12);
    }
  });

  it("agrees with independently integrated triangular pupil amplitude under grid refinement", () => {
    // Independently specified equal-area equilateral triangle, not production
    // geometry or the polygon boundary formula. First horizontal edge is below.
    const radius = Math.sqrt(25 * Math.PI / (3 * Math.sqrt(3) / 4));
    function reference(grid: number): number {
      let real = 0, imaginary = 0, count = 0;
      for (let iy = 0; iy < grid; iy += 1) {
        const y = -radius / 2 + (iy + 0.5) * 1.5 * radius / grid;
        const halfWidth = (radius - y) / Math.sqrt(3);
        for (let ix = 0; ix < grid; ix += 1) {
          const x = (-0.5 + (ix + 0.5) / grid) * Math.sqrt(3) * radius;
          if (Math.abs(x) > halfWidth) continue;
          const phase = 2 * Math.PI * (x * 0.003 + y * -0.002) / (0.00055 * 50);
          real += Math.cos(phase);
          imaginary -= Math.sin(phase);
          count += 1;
        }
      }
      return (real * real + imaginary * imaginary) / (count * count);
    }
    const exact = sample(3, -2, { bladeCount: 3 });
    const coarse = Math.abs(reference(40) - exact);
    const fine = Math.abs(reference(320) - exact);
    expect(fine).toBeLessThan(coarse);
    expect(fine).toBeLessThan(0.001);
  });

  it("converges with increasing blade count to circular diffraction at equal physical area", () => {
    for (const z of [1, 2, 3, 3.8317059702075125, 5]) {
      const x = z * 0.00055 * 50 / (2 * Math.PI * 5) * 1000;
      const expected = circularIntensity(z);
      const coarseError = Math.abs(sample(x, 0, { bladeCount: 8 }) - expected);
      const fineError = Math.abs(sample(x, 0, { bladeCount: 128 }) - expected);
      expect(fineError).toBeLessThan(coarseError);
      expect(fineError).toBeLessThan(1e-7);
    }
    // The legacy circular size diagnostic is neither replaced nor relabeled.
    const airy = calculateAiryDisk({ aperture: 5, wavelengthNm: 550 });
    expect(airy.provenance.model).toBe("ideal-circular-aperture-airy-disk");
  });

  it("preserves physical diffraction scale with pupil size, propagation distance, and wavelength", () => {
    const original = sample(3, -2);
    expect(sample(6, -4, { wavelengthNm: 1100 })).toBeCloseTo(original, 12);
    expect(sample(6, -4, { pupilToImageDistanceMm: 100 })).toBeCloseTo(original, 12);
    expect(sample(1.5, -1, { equivalentAreaPupilDiameterMm: 20 })).toBeCloseTo(original, 12);
    const density = calculateIdealPolygonDiffractionPsf(base).value.samples[0]!.intensityDensityPerSquareMicrometer;
    expect(calculateIdealPolygonDiffractionPsf({ ...base, wavelengthNm: 1100 })
      .value.samples[0]!.intensityDensityPerSquareMicrometer).toBeCloseTo(density / 4, 12);
  });

  it("integrates continuous density without hidden truncation renormalization and converges on refinement", () => {
    // Separable square case: a 2D symmetric square integral is the square of a
    // 1D integral. Dimensionless u = side*x/(lambda*distance).
    const scale = 0.00055 * 50 / Math.sqrt(25 * Math.PI) * 1000;
    function integrate(extent: number, step: number): number {
      let sum = 0;
      const count = Math.round(2 * extent / step);
      for (let i = 0; i < count; i += 1) {
        sum += sample((-extent + (i + 0.5) * step) * scale, 0) * step;
      }
      return sum * sum;
    }
    const coarse = integrate(8, 0.2);
    const fine = integrate(8, 0.1);
    expect(Math.abs(coarse - fine)).toBeLessThan(1e-5);
    const expanded = integrate(32, 0.1);
    expect(expanded).toBeGreaterThan(fine);
    expect(expanded).toBeLessThan(1);
    expect(expanded).toBeGreaterThan(0.99);
  });

  it("does not mutate inputs or infer fields from unsupported effects", () => {
    const input = structuredClone(base);
    expect(calculateIdealPolygonDiffractionPsf(input)).toEqual(calculateIdealPolygonDiffractionPsf(input));
    expect(input).toEqual(base);
    for (const extra of [{ fieldPointMm: { x: 1, y: 0 } }, { aberration: true }, { pupilClipping: true }]) {
      expect(() => calculateIdealPolygonDiffractionPsf({ ...base, ...extra })).toThrow(InvalidConfigurationError);
    }
  });

  it("fails closed for malformed, out-of-envelope, and non-finite scientific inputs", () => {
    for (const field of ["equivalentAreaPupilDiameterMm", "pupilToImageDistanceMm", "wavelengthNm"] as const) {
      for (const value of [0, -1, NaN, Infinity, Number.MIN_VALUE, Number.MAX_VALUE]) {
        expect(() => calculateIdealPolygonDiffractionPsf({ ...base, [field]: value })).toThrow();
      }
    }
    for (const n of [2, 1025, 3.5, NaN]) {
      expect(() => calculateIdealPolygonDiffractionPsf({ ...base, bladeCount: n })).toThrow();
    }
    for (const points of [[], [{ x: Infinity, y: 0 }], [{ x: 1e100, y: 0 }], new Array(4097).fill({ x: 0, y: 0 })]) {
      expect(() => calculateIdealPolygonDiffractionPsf({ ...base, imagePointsMicrometers: points })).toThrow();
    }
    expect(() => calculateIdealPolygonDiffractionPsf({ ...base, wavelengthBasis: "unspecified" } as unknown as CalculateIdealPolygonDiffractionInput)).toThrow();
    expect(() => calculateIdealPolygonDiffractionPsf({ ...base, firstBladeEdgeAngleDegrees: NaN })).toThrow();
    // From 2.0.0 a non-object input is a configuration error; malformed fields stay scientific-input errors.
    for (const malformed of [null, []]) {
      expect(() => calculateIdealPolygonDiffractionPsf(malformed as unknown as CalculateIdealPolygonDiffractionInput)).toThrow(InvalidConfigurationError);
    }
    for (const malformed of [{ ...base, firstBladeEdgeAngleDegrees: null },
      { ...base, imagePointsMicrometers: [null] },
      { ...base, imagePointsMicrometers: [{ x: 0, y: 0, field: 1 }] },
      { ...base, imagePointsMicrometers: new Array(1) }]) {
      expect(() => calculateIdealPolygonDiffractionPsf(malformed as unknown as CalculateIdealPolygonDiffractionInput)).toThrow(InvalidScientificInputError);
    }
  });
});

describe("calculatePolygonPupilFraunhoferPsf: simple polygons only (optics-15, #700)", () => {
  const call = (pupilVerticesMm: { x: number; y: number }[]): ReturnType<typeof calculatePolygonPupilFraunhoferPsf> => calculatePolygonPupilFraunhoferPsf({
    pupilVerticesMm, pupilToImageDistanceMm: 50, wavelengthNm: 550, wavelengthBasis: "air",
    imagePointsMicrometers: [{ x: 0, y: 0 }, { x: 3, y: 1 }]
  });

  it("rejects a self-intersecting polygon", () => {
    expect(() => call([{ x: -1, y: -1 }, { x: 2, y: 2 }, { x: 2, y: -2 }, { x: -1, y: 1 }])).toThrow(InvalidScientificInputError);
    expect(() => call([{ x: -1, y: -1 }, { x: 2, y: 2 }, { x: 2, y: -2 }, { x: -1, y: 1 }])).toThrow(/simple/);
  });

  it("keeps simple polygons, convex and concave, with peak-normalized intensity at most 1", () => {
    for (const vertices of [
      [{ x: -1, y: -1 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 1, y: 0.5 }, { x: 0, y: 2 }]
    ]) {
      const result = call(vertices).value;
      for (const s of result.samples) expect(s.peakNormalizedIntensity).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
});
