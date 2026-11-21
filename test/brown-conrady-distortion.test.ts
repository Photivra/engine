// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateBrownConradyDistortionMapping,
  calculateInverseBrownConradyDistortionMapping,
  calculateRadialDistortionMapping,
  type BrownConradyDistortionProfile
} from "../src/index.js";
import { brownConradyForwardValue, brownConradyInverseValue, validateBrownConradyDistortionProfile } from "../src/optics/brown-conrady-distortion.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const PROFILE: BrownConradyDistortionProfile = {
  normalizationRadiusMm: 20,
  maximumNormalizedRadius: 1,
  coefficients: { k1: -0.08, k2: 0.01, k3: 0, p1: 0.002, p2: -0.0015 }
};

function rotate(p: { x: number; y: number }, a: number): { x: number; y: number } {
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

describe("Brown-Conrady radial + tangential distortion", () => {
  it("matches the closed-form equations at an off-centre point", () => {
    const point = { x: 8, y: -5 };
    const { k1, k2, k3, p1, p2 } = PROFILE.coefficients;
    const x = 8 / 20;
    const y = -5 / 20;
    const r2 = x * x + y * y;
    const s = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 ** 3;
    const xd = x * s + 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const yd = y * s + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    const result = calculateBrownConradyDistortionMapping({ imagePointMm: point, profile: PROFILE });
    expect(result.value.mappedImagePointMm.x).toBeCloseTo(xd * 20, 13);
    expect(result.value.mappedImagePointMm.y).toBeCloseTo(yd * 20, 13);
    expect(result.provenance.kind).toBe("approximation");
  });

  it("reduces exactly to the radial model when p1 = p2 = 0", () => {
    const radialProfile = { normalizationRadiusMm: 20, maximumNormalizedRadius: 1, coefficients: { k1: -0.08, k2: 0.01, k3: 0.002 } };
    const bc = { ...radialProfile, coefficients: { ...radialProfile.coefficients, p1: 0, p2: 0 } };
    for (const point of [{ x: 3, y: 4 }, { x: -12, y: 7 }, { x: 0, y: -19 }]) {
      const a = calculateBrownConradyDistortionMapping({ imagePointMm: point, profile: bc }).value.mappedImagePointMm;
      const b = calculateRadialDistortionMapping({ imagePointMm: point, profile: radialProfile }).value.mappedImagePointMm;
      expect(a.x).toBeCloseTo(b.x, 13);
      expect(a.y).toBeCloseTo(b.y, 13);
    }
  });

  it("keeps the optical axis fixed and has an analytic Jacobian matching finite differences", () => {
    expect(calculateBrownConradyDistortionMapping({ imagePointMm: { x: 0, y: 0 }, profile: PROFILE }).value.mappedImagePointMm).toEqual({ x: 0, y: 0 });
    const p = { x: 6, y: 9 };
    const h = 1e-5;
    const f = (q: { x: number; y: number }): { x: number; y: number } => calculateBrownConradyDistortionMapping({ imagePointMm: q, profile: PROFILE }).value.mappedImagePointMm;
    const fx1 = f({ x: p.x + h, y: p.y });
    const fx0 = f({ x: p.x - h, y: p.y });
    const fy1 = f({ x: p.x, y: p.y + h });
    const fy0 = f({ x: p.x, y: p.y - h });
    const a = (fx1.x - fx0.x) / (2 * h);
    const c = (fx1.y - fx0.y) / (2 * h);
    const b = (fy1.x - fy0.x) / (2 * h);
    const d = (fy1.y - fy0.y) / (2 * h);
    expect(calculateBrownConradyDistortionMapping({ imagePointMm: p, profile: PROFILE }).value.jacobianDeterminant).toBeCloseTo(a * d - b * c, 8);
  });

  it("is rotation-covariant when (p2, p1) rotates with the image, for all four orientations", () => {
    const point = { x: 7, y: 3 };
    const base = calculateBrownConradyDistortionMapping({ imagePointMm: point, profile: PROFILE }).value.mappedImagePointMm;
    const pVector = { x: PROFILE.coefficients.p2, y: PROFILE.coefficients.p1 };
    for (const turns of [0, 1, 2, 3]) {
      const a = (turns * Math.PI) / 2;
      const rp = rotate(pVector, a);
      const profile = { ...PROFILE, coefficients: { ...PROFILE.coefficients, p2: rp.x, p1: rp.y } };
      const mapped = calculateBrownConradyDistortionMapping({ imagePointMm: rotate(point, a), profile }).value.mappedImagePointMm;
      const expected = rotate(base, a);
      expect(mapped.x).toBeCloseTo(expected.x, 12);
      expect(mapped.y).toBeCloseTo(expected.y, 12);
    }
  });

  it("round-trips forward and inverse over the envelope, including off-centre and boundary points", () => {
    for (let ring = 0; ring <= 8; ring += 1) {
      for (let k = 0; k < 12; k += 1) {
        const rho = ((20 * ring) / 8) * (1 - 1e-12);
        const phi = (2 * Math.PI * k) / 12 + 0.1;
        const point = { x: rho * Math.cos(phi), y: rho * Math.sin(phi) };
        const forward = calculateBrownConradyDistortionMapping({ imagePointMm: point, profile: PROFILE }).value;
        const inverse = calculateInverseBrownConradyDistortionMapping({ distortedImagePointMm: forward.mappedImagePointMm, profile: PROFILE }).value;
        expect(inverse.sourceImagePointMm.x).toBeCloseTo(point.x, 10);
        expect(inverse.sourceImagePointMm.y).toBeCloseTo(point.y, 10);
        expect(inverse.residualMm).toBeLessThan(1e-10);
      }
    }
  });

  it("rejects destinations outside the mapped envelope", () => {
    expect(() => calculateInverseBrownConradyDistortionMapping({ distortedImagePointMm: { x: 40, y: 0 }, profile: PROFILE })).toThrow(/envelope/);
    expect(() => calculateBrownConradyDistortionMapping({ imagePointMm: { x: 21, y: 0 }, profile: PROFILE })).toThrow(/maximumNormalizedRadius/);
  });

  it("inverts points near the envelope edge of a profile with tangential terms (#724)", () => {
    // Accepted profile (minimum Jacobian 0.158). Before 2.28.0 the inverse threw for this point (normalized radius 1.194 < 1.2) and for
    // 40 of the 2,160 points of the grid below: Newton, seeded with the target, converged to a second preimage outside the disc.
    const tangential: BrownConradyDistortionProfile = { normalizationRadiusMm: 10, maximumNormalizedRadius: 1.2, coefficients: { k1: 0.1, k2: 0, k3: -0.05, p1: 0.03, p2: 0 } };
    const source = { x: 5.605490459663536, y: 10.542394258735586 };
    const target = calculateBrownConradyDistortionMapping({ imagePointMm: source, profile: tangential }).value.mappedImagePointMm;
    expect(target).toEqual({ x: 5.947100966689037, y: 11.612560980138827 });
    const inverse = calculateInverseBrownConradyDistortionMapping({ distortedImagePointMm: target, profile: tangential }).value;
    expect(Math.hypot(inverse.sourceImagePointMm.x - source.x, inverse.sourceImagePointMm.y - source.y)).toBeLessThan(1e-11);
    const roundTrip = (profile: BrownConradyDistortionProfile, rings: number, azimuths: number): number => {
      const validated = validateBrownConradyDistortionProfile(profile), max = profile.maximumNormalizedRadius * profile.normalizationRadiusMm;
      let worst = 0;
      for (let ring = 1; ring <= rings; ring += 1) for (let a = 0; a < azimuths; a += 1) {
        const f = 0.1 + (0.899 * (ring - 1)) / Math.max(1, rings - 1), t = (2 * Math.PI * (a + 0.5)) / azimuths;
        const point = { x: f * max * Math.cos(t), y: f * max * Math.sin(t) };
        const back = brownConradyInverseValue(validated, brownConradyForwardValue(validated, point).mappedImagePointMm);
        worst = Math.max(worst, Math.hypot(back.x - point.x, back.y - point.y) / max);
      }
      return worst;
    };
    expect(roundTrip(tangential, 10, 216)).toBeLessThan(1e-11);
    // A seeded set of accepted profiles, |k| ≤ 0.3, |p| ≤ 0.05, maximum radius 1 to 1.25 (2.27.0: 3.6 % of such profiles had failing points).
    let state = 12345;
    const random = (): number => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
    let tested = 0;
    while (tested < 40) {
      const profile: BrownConradyDistortionProfile = { normalizationRadiusMm: 1, maximumNormalizedRadius: 1 + 0.25 * random(), coefficients: {
        k1: 0.6 * random() - 0.3, k2: 0.6 * random() - 0.3, k3: 0.6 * random() - 0.3, p1: 0.1 * random() - 0.05, p2: 0.1 * random() - 0.05 } };
      try { validateBrownConradyDistortionProfile(profile); } catch { continue; }
      tested += 1;
      expect(roundTrip(profile, 4, 48)).toBeLessThan(1e-11);
    }
    // A target truly outside the mapped envelope still throws.
    const edge = calculateBrownConradyDistortionMapping({ imagePointMm: { x: 0, y: 12 }, profile: tangential }).value.mappedImagePointMm;
    expect(() => calculateInverseBrownConradyDistortionMapping({ distortedImagePointMm: { x: edge.x * 1.01, y: edge.y * 1.01 }, profile: tangential })).toThrow(/envelope/);
  }, scaledTimeout(30_000));

  it("maps boundary points forward, back and forward again (optics-13)", () => {
    // Before 2.28.0 this exact-boundary point's inverse threw (Newton stopped at a residual of 1.06e-12, 1e-12 outside the disc), and the
    // inverse of other boundary points returned a radius 1-2 ulp above the maximum, which the forward mapping refused.
    const profile: BrownConradyDistortionProfile = { normalizationRadiusMm: 1, maximumNormalizedRadius: 1.0973557890974917, coefficients: {
      k1: -0.05656120041385293, k2: -0.02830175799317658, k3: 0.01600713630517324, p1: -0.016287238905206322, p2: 0.01310403035953641 } };
    const validated = validateBrownConradyDistortionProfile(profile);
    const check = (point: { x: number; y: number }): void => {
      const mapped = brownConradyForwardValue(validated, point).mappedImagePointMm, back = brownConradyInverseValue(validated, mapped);
      expect(Math.hypot(back.x, back.y)).toBeLessThanOrEqual(profile.maximumNormalizedRadius);
      expect(Math.hypot(back.x - point.x, back.y - point.y)).toBeLessThan(1e-11);
      expect(() => brownConradyForwardValue(validated, back)).not.toThrow();
    };
    check({ x: 0.6725330676440149, y: -0.8671153330388695 });
    for (let a = 0; a < 10_000; a += 1) {
      const t = (2 * Math.PI * a) / 10_000, point = { x: profile.maximumNormalizedRadius * Math.cos(t), y: profile.maximumNormalizedRadius * Math.sin(t) };
      while (Math.hypot(point.x, point.y) > profile.maximumNormalizedRadius) { point.x *= 1 - 2 ** -53; point.y *= 1 - 2 ** -53; }
      check(point);
    }
  }, scaledTimeout(30_000));

  it("rejects profiles that fold (non-positive Jacobian) or whose radial part is non-monotonic", () => {
    // Large tangential terms fold the map near the envelope edge.
    expect(() => calculateBrownConradyDistortionMapping({
      imagePointMm: { x: 1, y: 1 },
      profile: { ...PROFILE, coefficients: { k1: 0, k2: 0, k3: 0, p1: 0.4, p2: 0 } }
    })).toThrow(/Jacobian/);
    // The radial validator is reused unchanged.
    expect(() => calculateBrownConradyDistortionMapping({
      imagePointMm: { x: 1, y: 1 },
      profile: { ...PROFILE, coefficients: { k1: -0.5, k2: 0, k3: 0, p1: 0, p2: 0 } }
    })).toThrow(/monotonic/);
  });

  it("fails closed on malformed input", () => {
    expect(() => calculateBrownConradyDistortionMapping(null as never)).toThrow(/object/);
    expect(() => calculateBrownConradyDistortionMapping({ imagePointMm: { x: 0, y: 0 }, profile: null as never })).toThrow(/object/);
    expect(() => calculateBrownConradyDistortionMapping({ imagePointMm: { x: 0, y: 0 }, profile: { ...PROFILE, coefficients: { ...PROFILE.coefficients, p1: Number.NaN } } })).toThrow(/p1/);
    expect(() => calculateInverseBrownConradyDistortionMapping({ distortedImagePointMm: { x: "1", y: 0 } as never, profile: PROFILE })).toThrow(/finite/);
  });
});
