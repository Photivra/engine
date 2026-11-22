// SPDX-License-Identifier: Apache-2.0

/**
 * #655: a faster inverse of the radial distortion polynomial for the display view's lattice points.
 *
 * The capture inverts p_distorted = p_ideal · (1 + k1 r² + k2 r⁴ + k3 r⁶) with `calculateInverseRadialSourcePointValue`
 * (radial-distortion.ts): a bisection on the normalized radius from [0, r_max] until the bounds are adjacent doubles (about
 * 53 steps, at most 80). This module finds the same bracket with Newton's method on g(r) = r·s(r) − d, whose derivative
 * g'(r) = 1 + 3k1 r² + 5k2 r⁴ + 7k3 r⁶ is positive over the operating radius (the profile's validation requires it), so the
 * iteration converges quadratically from the start point r₀ = d / s(d) (Newton's method: Press, Teukolsky, Vetterling and
 * Flannery, *Numerical Recipes*, 3rd ed., §9.4; free to read online). It then applies the bisection's own final test: the
 * bracket is the pair of adjacent doubles (l, l⁺) with g(l) < d ≤ g(l⁺), evaluated with the same arithmetic as the
 * bisection (`mapped`, below), and the root is (l + l⁺)/2 rounded, as the bisection returns it. Where the forward map is
 * monotonic in floating point (every measured case), that is the bisection's result to the bit; a few ULP apart where it
 * is not (the test bound is 4 ULP over 10⁶ radii of each catalogue profile).
 *
 * The bisection itself is used (so the result is the capture's, bit for bit) where this method would not reach the same
 * bracket safely: the centre, an identity profile and the mapped boundary (solved directly there too), radii so small that 80
 * halvings do not reach adjacent doubles, a Newton step that leaves (0, r_max), no convergence within the step limit, or a
 * bracket more than a few doubles from the converged point. Invalid input (non-finite points, points beyond the profile) also
 * goes to the bisection, which fails with its own error.
 *
 * The start point does not depend on any other point, so each point's inverse is a function of that point alone (regions of a
 * view stay identical to the whole view). The GPU's lens pass (chunk G1) can use the same start point and a fixed step count
 * in float32.
 */

import { calculateInverseRadialSourcePointValue, type InverseRadialSourcePointValue, type LensFieldPointMm, type ValidatedRadialProfile } from "./radial-distortion.js";
import { undistortedImagePoint, type PreparedEnvironmentLensFieldMapping } from "./sensor-environment-query.js";
import { InvalidScientificInputError } from "../core/validation.js";

/** Newton steps before falling back to the bisection (quadratic convergence needs 4 to 6 from r₀ on the catalogue profiles). */
export const RADIAL_NEWTON_MAXIMUM_STEPS = 16;
/** Doubles walked from the converged point to the bracket before falling back. */
const BRACKET_WALK_LIMIT = 8;
/** The bisection's iteration count (radial-distortion.ts) and the tolerance of its mapped-radius test. */
const BISECTION_ITERATIONS = 80, MAPPED_RADIUS_TOLERANCE_ULPS = 16;

const scratch = new Float64Array(1), words = new Uint32Array(scratch.buffer), LOW = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1, HIGH = 1 - LOW;
/** The next double above a positive finite x (its bits plus one). */
function nextUp(x: number): number {
  scratch[0] = x;
  if (words[LOW] === 0xffffffff) { words[LOW] = 0; words[HIGH]! += 1; } else words[LOW]! += 1;
  return scratch[0]!;
}
/** The next double below a positive finite x (its bits minus one). */
function nextDown(x: number): number {
  scratch[0] = x;
  if (words[LOW] === 0) { words[LOW] = 0xffffffff; words[HIGH]! -= 1; } else words[LOW]! -= 1;
  return scratch[0]!;
}

/** The bisection's arithmetic (radial-distortion.ts `radialScale`, `mappedNormalizedRadius`), operation for operation. */
function scaleOf(r: number, k1: number, k2: number, k3: number): number {
  const r2 = r * r, r4 = r2 * r2, r6 = r4 * r2;
  return 1 + k1 * r2 + k2 * r4 + k3 * r6;
}

/**
 * The normalized source radius of distorted normalized radius d ∈ (0, r_max mapped), by Newton steps and the bisection's final
 * bracket test; NaN where the bisection must decide (see the module comment).
 */
export function radialInverseNewtonRadius(d: number, profile: ValidatedRadialProfile): number {
  const { k1, k2, k3 } = profile.coefficients, maxR = profile.maximumNormalizedRadius;
  // 80 halvings of [0, r_max] reach adjacent doubles only above about r_max·2⁻²⁷.
  if (!(d > maxR * 2 ** (52 - BISECTION_ITERATIONS + 1)) || !(d < profile.maximumMappedNormalizedRadius)) return NaN;
  let r = d / scaleOf(d, k1, k2, k3);
  if (!(r > 0 && r < maxR)) r = d < maxR ? d : maxR / 2;
  let converged = false;
  for (let step = 0; step < RADIAL_NEWTON_MAXIMUM_STEPS; step++) {
    const r2 = r * r, g = r * scaleOf(r, k1, k2, k3), derivative = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2 + 7 * k3 * r2 * r2 * r2;
    const next = r - (g - d) / derivative;
    if (!(next > 0 && next < maxR)) return NaN;
    if (Math.abs(next - r) <= 2 * Number.EPSILON * r) { r = next; converged = true; break; }
    r = next;
  }
  if (!converged) return NaN;
  // The bracket (l, l⁺): g(l) < d ≤ g(l⁺), walking a few doubles from the converged point.
  let lower = r, walked = 0;
  if (lower * scaleOf(lower, k1, k2, k3) >= d) {
    do { lower = nextDown(lower); if (++walked > BRACKET_WALK_LIMIT || !(lower > 0)) return NaN; } while (lower * scaleOf(lower, k1, k2, k3) >= d);
  } else {
    for (let upper = nextUp(lower); upper * scaleOf(upper, k1, k2, k3) < d; upper = nextUp(lower)) {
      lower = upper;
      if (++walked > BRACKET_WALK_LIMIT || !(lower < maxR)) return NaN;
    }
  }
  return (lower + nextUp(lower)) / 2;
}

/**
 * The radial scale s(r) of the source point of distorted point (x, y) mm by {@link radialInverseNewtonRadius}, with its distorted
 * radius Math.hypot(x, y) in `radius[0]` and the normalized source radius in `radius[1]`; NaN where the bisection must decide (see the module comment).
 */
function newtonScale(x: number, y: number, profile: ValidatedRadialProfile, radius: Float64Array): number {
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return NaN;
  const { k1, k2, k3 } = profile.coefficients;
  const d = (radius[0] = Math.hypot(x, y)) / profile.normalizationRadiusMm;
  if (k1 === 0 && k2 === 0 && k3 === 0) return NaN;
  // Within the mapped radius (no clamping to the boundary): the bisection's tolerance test cannot be reached from here.
  if (!(d < profile.maximumMappedNormalizedRadius - Number.EPSILON * MAPPED_RADIUS_TOLERANCE_ULPS * Math.max(1, d, profile.maximumMappedNormalizedRadius))) return NaN;
  const r = radius[1] = radialInverseNewtonRadius(d, profile);
  return r === r ? scaleOf(r, k1, k2, k3) : NaN;
}
const radiusOut = new Float64Array(2);

/**
 * `calculateInverseRadialSourcePointValue` (radial-distortion.ts) with the normalized radius from {@link radialInverseNewtonRadius}:
 * the same fields, formed with the same arithmetic from that radius, and the bisection's own result wherever the Newton method
 * does not apply.
 */
export function calculateInverseRadialSourcePointNewton(distortedImagePointMm: LensFieldPointMm, profile: ValidatedRadialProfile, pointPath: string): InverseRadialSourcePointValue {
  const { x, y } = distortedImagePointMm, scale = newtonScale(x, y, profile, radiusOut);
  if (!(scale === scale)) return calculateInverseRadialSourcePointValue(distortedImagePointMm, profile, pointPath);
  return { sourceImagePointMm: { x: x / scale, y: y / scale }, distortedNormalizedRadius: radiusOut[0]! / profile.normalizationRadiusMm, sourceNormalizedRadius: radiusOut[1]!, radialScaleAtSource: scale };
}

/**
 * `undistortedImagePoint` (sensor-environment-query.ts) with {@link calculateInverseRadialSourcePointNewton} for a radial profile:
 * the ideal image point of a physical sensor point (+X right, +Y up, mm) and the distortion area factor, with the same arithmetic.
 * Brown–Conrady and identity mappings take `undistortedImagePoint` itself.
 *
 * #685: with `out`, nothing is allocated where the Newton method applies: the ideal x and y, the area factor and the point's radius
 * Math.hypot(x, y) are written to out[0..3] and the result is undefined; elsewhere (the bisection, Brown–Conrady, identity) the
 * result is returned as without `out`.
 */
export function undistortedImagePointNewton(prepared: PreparedEnvironmentLensFieldMapping, imagePointMm: { x: number; y: number }): { ideal: { x: number; y: number }; distortionAreaFactor: number };
export function undistortedImagePointNewton(prepared: PreparedEnvironmentLensFieldMapping, imagePointMm: { x: number; y: number }, out: Float64Array):
  { ideal: { x: number; y: number }; distortionAreaFactor: number } | undefined;
export function undistortedImagePointNewton(prepared: PreparedEnvironmentLensFieldMapping, imagePointMm: { x: number; y: number }, out?: Float64Array):
  { ideal: { x: number; y: number }; distortionAreaFactor: number } | undefined {
  const radial = prepared.radial;
  if (radial === undefined) return undistortedImagePoint(prepared, imagePointMm);
  const { x, y } = imagePointMm, s = newtonScale(x, y, radial, radiusOut);
  let ix: number, iy: number;
  if (s === s) { ix = x / s; iy = y / s; } else {
    const p = calculateInverseRadialSourcePointValue(imagePointMm, radial, "sourcePointNativeSensorMm").sourceImagePointMm;
    ix = p.x; iy = p.y;
  }
  // As undistortedImagePoint: det = s (s + r ds/dr) with r ds/dr = 2 r² s'(r²).
  const { k1, k2, k3 } = radial.coefficients;
  const r2 = (ix*ix+iy*iy)/radial.normalizationRadiusMm**2;
  const scale = 1+k1*r2+k2*r2*r2+k3*r2*r2*r2;
  const radialDerivative = 1+3*k1*r2+5*k2*r2*r2+7*k3*r2*r2*r2;
  const distortionAreaFactor = 1/(scale*radialDerivative);
  if (!(distortionAreaFactor > 0) || !Number.isFinite(distortionAreaFactor)) throw new InvalidScientificInputError("Distortion area factor must remain finite and positive.");
  if (!out || !(s === s)) return { ideal: { x: ix, y: iy }, distortionAreaFactor };
  out[0] = ix; out[1] = iy; out[2] = distortionAreaFactor; out[3] = radiusOut[0]!;
  return undefined;
}
