// SPDX-License-Identifier: Apache-2.0
/**
 * #685 (2.28.0): the per-point lens mapping `lookOf` of `prepareDefocusImageSpaceGeometry` without the work a still camera does
 * not need, bit for bit:
 * - a still camera takes its ray without the rotation (applyPhysicalCameraRotation returns a copy of its vector for a zero
 *   displacement): compared with the same geometry given a hand-shake trajectory of zero amplitude, which takes the rotation's
 *   branch and is still at every instant;
 * - the display view's Newton inverse of a radial distortion writes its results to a reused array, and the vignetting throughput
 *   takes that inverse's radius of the point (`atRadius`): compared with the same inverse called without `out`, whose objects
 *   take the throughput's own `Math.hypot`.
 * Every field is compared with Object.is, and points that fail must fail with the same message.
 */
import { describe, expect, it } from "vitest";
import { prepareDefocusImageSpaceGeometry, type DefocusImageSpaceGeometry, type PreparedDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import { prepareIlluminationVignettingThroughput } from "../src/optics/illumination-vignetting.js";
import { undistortedImagePointNewton } from "../src/optics/radial-distortion-newton.js";
import { prepareEnvironmentLensFieldMapping, type PreparedEnvironmentLensFieldMapping } from "../src/optics/sensor-environment-query.js";
import type { LensProjectionModel } from "../src/camera/lens-projection.js";

const HALF_DIAGONAL = 21.633307652783937;
const VIGNETTING = { normalizationRadiusMm: HALF_DIAGONAL, maximumNormalizedRadius: 1.0023077985713384, coefficients: { r2: -0.3065093752749457, r4: 0.023486999282859373, r6: 0 } };
const mapping = (projectionModel: LensProjectionModel, k1: number): PreparedEnvironmentLensFieldMapping => prepareEnvironmentLensFieldMapping({ projectionModel, radiometricAreaCorrection: "inverse-distortion-jacobian",
  ...(projectionModel === "rectilinear" ? {} : { outsideImageCircle: "backward-ray" }),
  distortion: { kind: "radial", profile: { normalizationRadiusMm: HALF_DIAGONAL, maximumNormalizedRadius: 1.0153911260681159, coefficients: { k1, k2: k1 / 10, k3: 0 } } } });
const still = { focalLengthMm: 50, focusDistanceM: 2, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 } };
/** The 6000 × 4000 raster of 6 µm sites: lattice points with the 2 × 2 box's quarter-site shifts, random points, and points past the profiles. */
function points(count: number): [number, number][] {
  let seed = 12345;
  const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32, out: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const s = [0, 0.25, 0.75][i % 3]!;
    out.push([(Math.floor(next() * 6000) + 0.5 + s - 3000) * 0.006, (Math.floor(next() * 4000) + 0.5 + s - 2000) * 0.006]);
  }
  for (let i = 0; i < count / 4; i++) out.push([(next() - 0.5) * 37, (next() - 0.5) * 25]);
  out.push([0, 0], [-0, -0], [1e-12, 0], [0, -1e-9], [18.2, 12.2], [-18.3, 12.3], [21.9, 0], [22.5, 0], [NaN, 0], [0, NaN], [Infinity, 1], [1, -Infinity], [1e-300, 1e-300], [5e-324, 0]);
  return out;
}
/** Points whose lookOf differs between the two geometries (bits or error message); and how many failed in both. */
function compare(a: PreparedDefocusImageSpaceGeometry, b: PreparedDefocusImageSpaceGeometry, list: readonly [number, number][]): { different: number; failed: number } {
  let different = 0, failed = 0;
  const run = (g: PreparedDefocusImageSpaceGeometry, x: number, y: number): { x: number; y: number; z: number; factor: number } | string => {
    try { return g.lookOf(x, y, 0); } catch (error) { return (error as Error).message; }
  };
  for (const [x, y] of list) {
    const p = run(a, x, y), q = run(b, x, y);
    if (typeof p === "string" || typeof q === "string") { failed++; if (p !== q) different++; continue; }
    if (!(Object.is(p.x, q.x) && Object.is(p.y, q.y) && Object.is(p.z, q.z) && Object.is(p.factor, q.factor))) different++;
  }
  return { different, failed };
}
const CASES: [string, LensProjectionModel, number | null, boolean][] = [["rectilinear, no distortion", "rectilinear", null, true], ["rectilinear, barrel", "rectilinear", -0.003, true],
  ["rectilinear, strong barrel, no vignetting", "rectilinear", -0.2, false], ["rectilinear, pincushion", "rectilinear", 0.05, true],
  ["equisolid-angle fisheye, barrel", "fisheye-equisolid-angle", -0.02, true]];

describe("lookOf of a still camera (#685)", () => {
  it.each(CASES)("%s: equals the rotation's branch at zero displacement", (_name, model, k1, vignetting) => {
    const geometry: DefocusImageSpaceGeometry = { ...still, ...(k1 === null ? {} : { lensMapping: mapping(model, k1) }), ...(vignetting ? { vignetting: VIGNETTING } : {}) };
    for (const undistort of [undefined, undistortedImagePointNewton]) {
      const options = { ...geometry, ...(undistort ? { undistort } : {}) };
      const fast = prepareDefocusImageSpaceGeometry(options), general = prepareDefocusImageSpaceGeometry({ ...options, handShake: [0, 0, 1, 0] });
      expect(fast.timeDependent).toBe(false);
      expect(general.timeDependent).toBe(true);
      const result = compare(fast, general, points(8000));
      expect(result.different).toBe(0);
      expect(result.failed).toBeGreaterThan(0);
    }
  });
});

describe("the Newton inverse without allocation and the throughput from its radius (#685)", () => {
  it.each(CASES.filter((c) => c[2] !== null))("%s: equals the inverse's objects and the throughput's own radius", (_name, model, k1, vignetting) => {
    const geometry = { ...still, lensMapping: mapping(model, k1!), ...(vignetting ? { vignetting: VIGNETTING } : {}) };
    const into = prepareDefocusImageSpaceGeometry({ ...geometry, undistort: undistortedImagePointNewton });
    const objects = prepareDefocusImageSpaceGeometry({ ...geometry, undistort: (prepared, point) => undistortedImagePointNewton(prepared, point) });
    expect(compare(into, objects, points(8000)).different).toBe(0);
    // Rotating as well (the rotation's branch at each instant).
    const omega = { pitch: 0.01, yaw: -0.02, roll: 0.003 };
    const a = prepareDefocusImageSpaceGeometry({ ...geometry, angularVelocityRadPerSec: omega, undistort: undistortedImagePointNewton });
    const b = prepareDefocusImageSpaceGeometry({ ...geometry, angularVelocityRadPerSec: omega, undistort: (prepared, point) => undistortedImagePointNewton(prepared, point) });
    for (const t of [0, 0.004]) {
      const list = points(2000);
      let different = 0;
      for (const [x, y] of list) {
        let p: unknown, q: unknown;
        try { p = a.lookOf(x, y, t); } catch (error) { p = (error as Error).message; }
        try { q = b.lookOf(x, y, t); } catch (error) { q = (error as Error).message; }
        if (typeof p === "string" || typeof q === "string" ? p !== q : !(["x", "y", "z", "factor"] as const).every((k) => Object.is((p as Record<string, number>)[k], (q as Record<string, number>)[k]))) different++;
      }
      expect(different).toBe(0);
    }
  });

  it("writes the inverse to out only where the Newton method applies", () => {
    const prepared = mapping("rectilinear", -0.003), out = new Float64Array(4).fill(-1);
    expect(undistortedImagePointNewton(prepared, { x: 3, y: -4 }, out)).toBeUndefined();
    const { ideal, distortionAreaFactor } = undistortedImagePointNewton(prepared, { x: 3, y: -4 });
    expect(Array.from(out)).toEqual([ideal.x, ideal.y, distortionAreaFactor, 5]);
    // The centre takes the bisection: the result is returned and out is left alone.
    out.fill(-1);
    expect(undistortedImagePointNewton(prepared, { x: 0, y: 0 }, out)).toEqual(undistortedImagePointNewton(prepared, { x: 0, y: 0 }));
    expect(Array.from(out)).toEqual([-1, -1, -1, -1]);
  });

  it("atRadius is the throughput at a point of that radius", () => {
    const at = prepareIlluminationVignettingThroughput(VIGNETTING);
    let seed = 7;
    const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 10_000; i++) {
      const x = (next() - 0.5) * 36, y = (next() - 0.5) * 24;
      expect(Object.is(at.atRadius(Math.hypot(x, y)), at({ x, y: -y }))).toBe(true);
    }
    expect(() => at.atRadius(HALF_DIAGONAL * 1.01)).toThrow(/outside the illumination vignetting profile/u);
  });
});
