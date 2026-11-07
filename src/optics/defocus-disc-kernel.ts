// SPDX-License-Identifier: Apache-2.0

/**
 * The geometric defocus disc of a flat scene, sampled on the square site lattice, for
 * `lens.defocus: { model: "geometric-disc" }` (#492). Internal except for the radius cap
 * {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES} and the pre-check {@link calculateDefocusDiscKernelRadius}, which are
 * root exports (#532), so a caller can check a request against the cap before rendering.
 *
 * Model. For a scene plane at the subject distance d and a thin lens focused at s, an ideal uniform circular pupil
 * spreads every in-focus image point into a uniform disc of diameter c = f²·|s − d| / (N·d·(s − f)) on the sensor
 * (`calculateDefocusCircle`, thin-lens model 1.1.0; geometric optics, no diffraction or aberrations). The defocused
 * image of the plane is therefore the in-focus image convolved with that disc: one fixed, wavelength-independent
 * kernel. It is an approximation (geometric optics, ideal uniform circular pupil, no vignetting of the pupil).
 *
 * Sampling. The disc of diameter c/p sites (p the site pitch) is centred on a site centre. The weight of the site at
 * offset (i, j) is the exact area of the disc inside that site's square cell [i − ½, i + ½] × [j − ½, j + ½], divided
 * by the area of the disc. The area of a disc inside a rectangle is a signed sum over the rectangle's four corners of
 * the area Q(x, y) of the disc inside the quadrant [0, x] × [0, y] (inclusion–exclusion), and for x, y ≥ 0 with
 * x, y clamped to the radius r
 *   Q = x·y                                                when x² + y² ≤ r²,
 *   Q = ½·(x_a·y + x·y_a + r²·(arcsin(x/r) − arcsin(x_a/r)))  otherwise,
 * with x_a = √(r² − y²) and y_a = √(r² − x²) the arc's crossings of the quadrant's edges: the rectangle left of the
 * crossing plus the area under the arc, ∫ √(r² − t²) dt = ½·(t·√(r² − t²) + r²·arcsin(t/r)) (elementary geometry
 * and calculus; NIST DLMF 4.24.1 for the arcsine, free). The arcsine difference is the angle between the two arc
 * points, evaluated as arcsin((x·y − x_a·y_a)/r²) (the sine of a difference). Q is extended to negative x or y as an
 * odd function.
 *
 * Determinism. Only correctly rounded operations and `portableAsin` are used, so the weights are the same bits in
 * every JavaScript engine. One octant (0 ≤ j ≤ i) is computed and mirrored, so the kernel has the exact 8-fold
 * symmetry of the disc and the square lattice. The weights are divided by their float64 sum, then the centre weight
 * takes up the remaining rounding, so their exact sum is 1 within half a unit in the last place of the centre weight.
 *
 * Limits. The window is (2R + 1)² sites with R = ⌈r − ½⌉ (0 when r ≤ ½: a disc inside one cell is the identity, a
 * valid kernel). R is capped at {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES}; past it the call fails, naming the
 * cap and the radius asked for, instead of clipping the disc.
 */

import { calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { portableAsin } from "../core/portable-math.js";
import { requireInputKeys } from "../core/record-validation.js";
import { InvalidScientificInputError, requirePositiveFinite } from "../core/validation.js";
import { calculateDefocusCircle } from "./depth-of-field.js";

/**
 * Largest kernel radius in sites of `lens.defocus: { model: "geometric-disc" }`, R ≤ 64: a disc of at most 129 sites
 * across (a 129 × 129 window, 16 641 taps per site; the diffraction kernels stop at 32). `simulateCapture`,
 * `simulateDisplayView` and `prepareDisplayView` refuse a request whose disc needs more, and never clip the disc; check a
 * request first with {@link calculateDefocusDiscKernelRadius}.
 *
 * Set from the cost measured in the capture (#492, step 2a; docs/QUICK_START.md, "Optics"): the capture's time grows with
 * R² at every site the disc sees an edge from, and a 0.7 MP Siemens star took 0.37 s in focus, 2.9 s at R = 32, 4.7 s at
 * R = 41 and 11.6 s at R = 64 (Node, one thread). 64 keeps the issue's 1.4 µm example (50 mm f/2.8, subject 2 m, focus
 * 1.6 m: R = 41) with room for larger blurs, at a cost the caller chooses and the docs state; past it the call fails.
 */
export const DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES = 64;

/** Whether a kernel radius is within {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES}: the one test the renderer and the pre-check share. */
function isWithinDefocusDiscKernelLimit(radius: number): boolean {
  return radius <= DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES;
}

/** The disc sampled on the site lattice. */
export interface DefocusDiscSiteKernel {
  /** Disc diameter in sites (c / pitch). */
  readonly diameterSites: number;
  /** Kernel radius R in sites: the window is (2R + 1) × (2R + 1). */
  readonly radius: number;
  /** Window side, 2R + 1. */
  readonly width: number;
  /** Row-major weights, index (j + R)·width + (i + R) for the site offset (i, j); their row-major float64 sum is 1. */
  readonly weights: Float64Array;
}

/** Kernel radius in sites for a disc of `diameterSites`: the cells [i − ½, i + ½] the disc reaches with positive area. */
export function defocusDiscKernelRadius(diameterSites: number): number {
  requireDiameter(diameterSites);
  const r = diameterSites / 2;
  return r <= 0.5 ? 0 : Math.ceil(r - 0.5);
}

/**
 * {@link defocusDiscKernelRadius}, failing with `InvalidScientificInputError` (naming the cap and the radius asked for)
 * when it exceeds {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES}. The disc is never clipped to fit.
 */
export function requireDefocusDiscKernelRadius(diameterSites: number): number {
  const radius = defocusDiscKernelRadius(diameterSites);
  if (!isWithinDefocusDiscKernelLimit(radius))
    throw new InvalidScientificInputError("The defocus disc of " + diameterSites + " sites needs a kernel radius of " + radius +
      " sites; the limit is " + DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES + " sites (DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES).");
  return radius;
}

function requireDiameter(diameterSites: number): void {
  if (typeof diameterSites !== "number" || !Number.isFinite(diameterSites) || diameterSites < 0)
    throw new InvalidScientificInputError("The defocus disc diameter must be a finite number of sites, zero or more.");
}

/** Area of the disc of radius r (centred at the origin) inside [0, x] × [0, y], for x, y ≥ 0. */
function quadrantArea(x: number, y: number, r: number): number {
  if (x > r) x = r;
  if (y > r) y = r;
  if (x * x + y * y <= r * r) return x * y;
  const xa = Math.sqrt((r - y) * (r + y)), ya = Math.sqrt((r - x) * (r + x));
  // arcsin(x/r) − arcsin(x_a/r) is the angle between the arc points (x_a, y) and (x, y_a), whose sine is (x·y − x_a·y_a)/r².
  return 0.5 * (xa * y + x * ya + r * r * portableAsin(Math.min(1, (x * y - xa * ya) / (r * r))));
}
/** {@link quadrantArea} extended as an odd function of x and of y. */
function signedQuadrantArea(x: number, y: number, r: number): number {
  const q = quadrantArea(x < 0 ? -x : x, y < 0 ? -y : y, r);
  return (x < 0) !== (y < 0) ? -q : q;
}
/**
 * Area of the disc inside the cell [i − ½, i + ½] × [j − ½, j + ½], for i ≥ j ≥ 0. Exactly 0 when the cell's point nearest
 * the centre lies on or outside the circle. Otherwise the four corner terms are up to r² in size, so the difference
 * carries an absolute rounding error of a few r²·2^-53 (below 10^-11 at the radius cap, under 10^-15 of the disc's area);
 * a cell that barely touches the disc can come out a rounding error below zero and is set to 0.
 */
function cellArea(i: number, j: number, r: number): number {
  const x0 = i - 0.5, x1 = i + 0.5, y0 = j - 0.5, y1 = j + 0.5;
  const nx = i === 0 ? 0 : x0, ny = j === 0 ? 0 : y0;
  if (nx * nx + ny * ny >= r * r) return 0;
  const area = (signedQuadrantArea(x1, y1, r) - signedQuadrantArea(x0, y1, r)) - (signedQuadrantArea(x1, y0, r) - signedQuadrantArea(x0, y0, r));
  return area > 0 ? area : 0;
}

/**
 * The defocus disc of `diameterSites` (c / pitch) sampled on the site lattice, or null for a zero diameter (in focus:
 * callers apply no kernel). Fails with `InvalidScientificInputError` for a negative or non-finite diameter, and when
 * the kernel radius exceeds {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES}.
 */
export function createDefocusDiscSiteKernel(diameterSites: number): DefocusDiscSiteKernel | null {
  const radius = requireDefocusDiscKernelRadius(diameterSites);
  if (diameterSites === 0) return null;
  const r = diameterSites / 2, width = 2 * radius + 1, weights = new Float64Array(width * width);
  // One octant, mirrored into the eight symmetric cells.
  for (let i = 0; i <= radius; i++) for (let j = 0; j <= i; j++) {
    const a = cellArea(i, j, r);
    for (const [u, v] of [[i, j], [j, i]] as const) for (const su of u === 0 ? [1] : [1, -1]) for (const sv of v === 0 ? [1] : [1, -1])
      weights[(sv * v + radius) * width + su * u + radius] = a;
  }
  normalize(weights, (width * width - 1) / 2);
  return { diameterSites, radius, width, weights };
}

/**
 * Divides by the float64 sum, then sets the centre weight to 1 minus the exact sum of the others (accumulated as a
 * double-double with Knuth's TwoSum), rounded once. The exact real sum of the weights is then 1 within half a unit in
 * the last place of the centre weight. (No float64 summation order can promise exactly 1: a one-ulp change of one weight
 * can move a rounded sum from just below 1 to just above it.)
 */
function normalize(weights: Float64Array, centre: number): void {
  let total = 0;
  for (let k = 0; k < weights.length; k++) total += weights[k]!;
  for (let k = 0; k < weights.length; k++) weights[k]! /= total;
  let hi = 0, lo = 0;
  for (let k = 0; k < weights.length; k++) {
    if (k === centre) continue;
    const w = weights[k]!, s = hi + w, b = s - hi;
    lo += (hi - (s - b)) + (w - b);
    hi = s;
  }
  // 1 − (hi + lo): TwoSum of 1 and −hi, then the low parts.
  const s = 1 - hi, b = s - 1, e = (1 - (s - b)) + (-hi - b);
  weights[centre] = s + (e - lo);
}

/** The geometric defocus disc of one request, in micrometres and in sites. */
export interface ResolvedDefocusDisc {
  /** Blur-circle diameter c at the sensor, µm (`calculateDefocusCircle`, thin-lens model 1.1.0). */
  readonly diameterMicrometers: number;
  /** c / pitch. */
  readonly diameterSites: number;
  /** Kernel radius R in sites (0 when c = 0). */
  readonly kernelRadiusSites: number;
}

/**
 * Resolves the defocus disc for a thin lens focused at `focusDistanceM` imaging a plane at `subjectDistanceM`, on a
 * lattice of `pitchMicrometers`. Exactly zero when the two distances are equal. It does not check the radius cap.
 */
export function resolveDefocusDisc(input: { focalLengthMm: number; aperture: number; focusDistanceM: number; subjectDistanceM: number;
  pitchMicrometers: number }): ResolvedDefocusDisc {
  const { pitchMicrometers, ...circle } = input;
  if (!Number.isFinite(pitchMicrometers) || pitchMicrometers <= 0) throw new InvalidScientificInputError("pitchMicrometers must be a positive finite number.");
  const diameterMicrometers = calculateDefocusCircle(circle).value.diameterMm * 1000;
  const diameterSites = diameterMicrometers / pitchMicrometers;
  return { diameterMicrometers, diameterSites, kernelRadiusSites: defocusDiscKernelRadius(diameterSites) };
}

export interface CalculateDefocusDiscKernelRadiusInput {
  /** Lens focal length in millimetres (`lens.focalLengthMm`). */
  focalLengthMm: number;
  /** F-number the capture uses: `lens.fNumber`, or in an automatic exposure mode the resolved `exposure.settings.fNumber`. */
  aperture: number;
  /** Focus-plane distance from the lens plane in metres (`lens.focusDistanceM`; `simulateCapture` defaults it to the subject distance). */
  focusDistanceM: number;
  /** Scene-plane distance from the lens plane in metres (`subjectDistanceM`). */
  subjectDistanceM: number;
  /** Sensor site pitch in micrometres (`sensor.pixelPitchMicrometers`), the lattice the disc is sampled on. */
  pixelPitchMicrometers: number;
}

export interface DefocusDiscKernelRadius {
  /** Geometric blur-circle diameter c at the sensor in micrometres (`calculateDefocusCircle`, thin-lens model 1.1.0); 0 in focus. */
  diameterMicrometers: number;
  /** c / pixel pitch: the disc's diameter in sites. */
  diameterSites: number;
  /** Kernel radius R in sites the renderer needs for this disc, ⌈c / (2·pitch) − ½⌉ (0 for a disc inside one site, and in focus). */
  kernelRadiusSites: number;
  /** {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES}, 64. */
  maximumKernelRadiusSites: number;
  /** Largest disc diameter in sites within the limit, 2·64 + 1 = 129: within the limit exactly when `diameterSites` ≤ 129. */
  maximumDiameterSites: number;
  /** True when `kernelRadiusSites` ≤ `maximumKernelRadiusSites`: `lens.defocus` renders the request; false: it refuses it. */
  withinLimit: boolean;
  /** How far past the limit the kernel radius is, max(0, R − 64) sites; 0 when within the limit. */
  excessKernelRadiusSites: number;
}

/**
 * Checks, before rendering, whether `lens.defocus: { model: "geometric-disc" }` can render a request: the geometric
 * defocus disc's diameter on the site lattice, the kernel radius it needs, and whether that radius is within
 * {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES} (#532). Pure and cheap: no kernel is built and nothing is rendered.
 *
 * It runs the same resolution and the same limit test as `simulateCapture`, `simulateDisplayView` and `prepareDisplayView`
 * (the blur circle c = f²·|s − d| / (N·d·(s − f)) of `calculateDefocusCircle`, thin-lens model 1.1.0, divided by the pitch),
 * so for the same focal length, f-number, distances and pitch a request they refuse for its defocus size has
 * `withinLimit: false`, and one they accept has `withinLimit: true`. Pass the values the capture uses: in an automatic
 * exposure mode that is the resolved f-number. The limit applies to the disc alone; with `lens.diffraction` the combined
 * kernel (diffraction radius plus defocus radius, at most 32 + 64 sites) has no further limit. Other reasons a capture
 * refuses `lens.defocus` out of focus (pupil sampling, a caller PSF, camera rotation with a rolling shutter, a vignetting or
 * distortion profile that does not reach the kernel's radius beyond the frame, and in the display view a projection,
 * distortion, vignetting or rotation) are not checked here.
 *
 * The blur circle is a geometric thin-lens approximation for an ideal uniform circular pupil (no diffraction, aberrations
 * or pupil vignetting). Inputs follow `calculateDefocusCircle`: all positive and finite, both distances beyond the focal
 * length; invalid values fail with `InvalidScientificInputError`, unknown fields with `InvalidConfigurationError`.
 *
 * @param input Lens, f-number, focus and subject distances, and the sensor's site pitch.
 * @returns The disc and its kernel radius, the limit, and whether the request is within it and by how much it is not.
 */
export function calculateDefocusDiscKernelRadius(input: CalculateDefocusDiscKernelRadiusInput): CalculationResult<DefocusDiscKernelRadius> {
  requireInputKeys(input, "calculateDefocusDiscKernelRadius", ["focalLengthMm", "aperture", "focusDistanceM", "subjectDistanceM", "pixelPitchMicrometers"]);
  requirePositiveFinite("pixelPitchMicrometers", input.pixelPitchMicrometers);
  const disc = resolveDefocusDisc({ focalLengthMm: input.focalLengthMm, aperture: input.aperture, focusDistanceM: input.focusDistanceM,
    subjectDistanceM: input.subjectDistanceM, pitchMicrometers: input.pixelPitchMicrometers });
  const withinLimit = isWithinDefocusDiscKernelLimit(disc.kernelRadiusSites);
  return calculatedResult({
    diameterMicrometers: disc.diameterMicrometers,
    diameterSites: disc.diameterSites,
    kernelRadiusSites: disc.kernelRadiusSites,
    maximumKernelRadiusSites: DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES,
    maximumDiameterSites: 2 * DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES + 1,
    withinLimit,
    excessKernelRadiusSites: withinLimit ? 0 : disc.kernelRadiusSites - DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES
  }, "defocus-disc-kernel-radius", "1.0.0", [
    "Geometric thin-lens blur circle of an ideal uniform circular pupil (thin-lens-defocus-circle 1.1.0), an approximation",
    "The disc and limit test lens.defocus { model: \"geometric-disc\" } applies in simulateCapture and the display view",
    "Only the defocus size limit is checked"
  ]);
}

/**
 * The full 2-D convolution of two square site kernels (row-major, radii `radiusA` and `radiusB`): a kernel of radius
 * radiusA + radiusB with out(t) = Σ_s a(s)·b(t − s), each output summed over the taps of `a` in row-major order (zero taps
 * of either kernel skipped, which adds exact zeros only). Used for lens.defocus with lens.diffraction (#492): each spectral
 * node's diffraction kernel convolved with the defocus disc. That combination is an approximation: the defocused wave PSF
 * of a circular pupil is not exactly the in-focus Airy pattern convolved with the geometric disc. Both inputs here are
 * centred and non-negative, so the result is too; its sum is the product of the inputs' sums up to rounding.
 */
export function convolveSiteKernels(a: Float64Array, radiusA: number, b: Float64Array, radiusB: number): Float64Array {
  const wa = 2 * radiusA + 1, wb = 2 * radiusB + 1, radius = radiusA + radiusB, width = 2 * radius + 1;
  if (a.length !== wa * wa || b.length !== wb * wb) throw new InvalidScientificInputError("Site kernels must be (2R + 1)² taps.");
  const out = new Float64Array(width * width);
  // Non-zero taps of b, as (row, column, weight).
  const bRows: number[] = [], bColumns: number[] = [], bWeights: number[] = [];
  for (let j = 0; j < wb; j++) for (let i = 0; i < wb; i++) { const w = b[j * wb + i]!; if (w !== 0) { bRows.push(j); bColumns.push(i); bWeights.push(w); } }
  for (let sj = 0; sj < wa; sj++) for (let si = 0; si < wa; si++) {
    const w = a[sj * wa + si]!;
    if (w === 0) continue;
    for (let k = 0; k < bWeights.length; k++) {
      const index = (sj + bRows[k]!) * width + si + bColumns[k]!;
      out[index] = out[index]! + w * bWeights[k]!;
    }
  }
  return out;
}
