// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { GENERIC_LENS_CATALOGUE, resolveGenericLens } from "../src/equipment/generic-lens-catalogue.js";
import { calculateInverseRadialSourcePointValue, validateRadialDistortionProfile, type ValidatedRadialProfile } from "../src/optics/radial-distortion.js";
import { calculateInverseRadialSourcePointNewton, undistortedImagePointNewton } from "../src/optics/radial-distortion-newton.js";
import { prepareEnvironmentLensFieldMapping, undistortedImagePoint } from "../src/optics/sensor-environment-query.js";

/*
 * #655 step 4: the display view's Newton inverse of the radial distortion polynomial against the capture's bisection
 * (radial-distortion.ts). The 2.27.0 plan's bound: the root within 4 ULP of the bisection's over 10⁶ radii per catalogue
 * profile (measured with RADII=1000000; this test runs a seeded subset).
 */

const RADII = Number(process.env.RADII ?? 20000);
const scratch = new Float64Array(2), words = new BigInt64Array(scratch.buffer);
/** Distance in doubles between two non-negative finite values. */
function ulps(a: number, b: number): number { scratch[0] = a; scratch[1] = b; const d = words[0]! - words[1]!; return Number(d < 0n ? -d : d); }
/** A seeded uniform generator (mulberry32). */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const profiles: [string, ValidatedRadialProfile][] = GENERIC_LENS_CATALOGUE.map((lens) => [lens.lensId,
  validateRadialDistortionProfile(resolveGenericLens({ lensId: lens.lensId, activeImagingArea: { widthMm: 36, heightMm: 24 }, fNumber: undefined, focusDistanceM: undefined } as never).character.distortion.profile)]);
// Two generic profiles with every coefficient set (barrel and pincushion).
profiles.push(["k1 k2 k3 barrel", validateRadialDistortionProfile({ normalizationRadiusMm: 0.25, maximumNormalizedRadius: 1, coefficients: { k1: -0.2, k2: 0.02, k3: -0.001 } })]);
profiles.push(["k1 k2 k3 pincushion", validateRadialDistortionProfile({ normalizationRadiusMm: 21.6, maximumNormalizedRadius: 1.3, coefficients: { k1: 0.08, k2: -0.01, k3: 0.002 } })]);

describe("radial distortion inverse by Newton steps (#655)", () => {
  it("is within 4 ULP of the bisection's root, and its point and scale come from that root, on every catalogue profile", () => {
    let largest = 0, exact = 0, total = 0;
    for (const [id, profile] of profiles) {
      const next = random(655 + total), mmMax = profile.maximumMappedNormalizedRadius * profile.normalizationRadiusMm;
      for (let i = 0; i < RADII; i++, total++) {
        // Radii over the whole mapped range (and some near the centre), at a random angle.
        const radius = (i % 10 === 0 ? next() ** 6 : next()) * mmMax, angle = next() * 2 * Math.PI, point = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
        const bisection = calculateInverseRadialSourcePointValue(point, profile, "p"), newton = calculateInverseRadialSourcePointNewton(point, profile, "p");
        const distance = ulps(newton.sourceNormalizedRadius, bisection.sourceNormalizedRadius);
        if (distance > largest) largest = distance;
        if (distance === 0) exact++;
        if (distance > 4) throw new Error(id + ": " + distance + " ULP at radius " + radius);
        expect(newton.distortedNormalizedRadius).toBe(bisection.distortedNormalizedRadius);
        if (distance === 0) { expect(newton.sourceImagePointMm).toEqual(bisection.sourceImagePointMm); expect(newton.radialScaleAtSource).toBe(bisection.radialScaleAtSource); }
      }
    }
    if (process.env.RADII) process.stdout.write("radial Newton: " + profiles.length + " profiles × " + RADII + " radii, largest " + largest + " ULP, identical " + exact + " of " + total + "\n");
    expect(largest).toBeLessThanOrEqual(4);
    // Where the forward map is monotonic in floating point the bracket is the bisection's: nearly every radius is identical.
    expect(exact / total).toBeGreaterThan(0.999);
  }, RADII * 400);

  it("takes the bisection's own result at the centre, the boundary, an identity profile and for invalid points", () => {
    const [, profile] = profiles[0]!, boundary = profile.maximumMappedNormalizedRadius * profile.normalizationRadiusMm;
    for (const point of [{ x: 0, y: 0 }, { x: boundary, y: 0 }, { x: 0, y: -boundary }, { x: 1e-30, y: 0 }])
      expect(calculateInverseRadialSourcePointNewton(point, profile, "p")).toEqual(calculateInverseRadialSourcePointValue(point, profile, "p"));
    const identity = validateRadialDistortionProfile({ normalizationRadiusMm: 1, maximumNormalizedRadius: 1, coefficients: { k1: 0, k2: 0, k3: 0 } });
    expect(calculateInverseRadialSourcePointNewton({ x: 0.3, y: 0.4 }, identity, "p")).toEqual(calculateInverseRadialSourcePointValue({ x: 0.3, y: 0.4 }, identity, "p"));
    expect(() => calculateInverseRadialSourcePointNewton({ x: 2 * boundary, y: 0 }, profile, "p")).toThrow(/outside the mapped radial distortion profile/u);
    expect(() => calculateInverseRadialSourcePointNewton({ x: Number.NaN, y: 0 }, profile, "p")).toThrow();
  });

  it("gives undistortedImagePoint's ideal point and area factor (Brown-Conrady and no distortion unchanged)", () => {
    const radial = prepareEnvironmentLensFieldMapping({ projectionModel: "rectilinear", distortion: { kind: "radial", profile: { normalizationRadiusMm: 0.25, maximumNormalizedRadius: 1,
      coefficients: { k1: -0.2, k2: 0.02, k3: 0 } } }, radiometricAreaCorrection: "inverse-distortion-jacobian" });
    const decentred = prepareEnvironmentLensFieldMapping({ projectionModel: "rectilinear", distortion: { kind: "brown-conrady", profile: { normalizationRadiusMm: 0.25,
      maximumNormalizedRadius: 1, coefficients: { k1: 0.05, k2: 0, k3: 0, p1: 0.02, p2: -0.01 } } }, radiometricAreaCorrection: "inverse-distortion-jacobian" });
    const next = random(7);
    for (let i = 0; i < 2000; i++) {
      const point = { x: (next() - 0.5) * 0.28, y: (next() - 0.5) * 0.28 }, reference = undistortedImagePoint(radial, point), newton = undistortedImagePointNewton(radial, point);
      expect(Math.abs(newton.ideal.x - reference.ideal.x)).toBeLessThanOrEqual(8 * Number.EPSILON * Math.abs(reference.ideal.x));
      expect(Math.abs(newton.distortionAreaFactor - reference.distortionAreaFactor)).toBeLessThanOrEqual(1e-14 * reference.distortionAreaFactor);
      expect(undistortedImagePointNewton(decentred, point)).toEqual(undistortedImagePoint(decentred, point));
    }
  });
});
