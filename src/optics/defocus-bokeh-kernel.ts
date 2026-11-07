// SPDX-License-Identifier: Apache-2.0

/**
 * Bokeh character (#553): the defocus kernel of `lens.defocus` shaped by the lens, instead of the uniform disc of an ideal
 * circular pupil. Three opt-in parts, each off by default (without them `lens.defocus` keeps the exact disc of
 * `createDefocusDiscSiteKernel`, byte for byte):
 *
 * - **Aperture blades** (`blades`): the opening is a regular polygon of `count` straight blades
 *   (`calculateIdealApertureGeometry`'s vertex convention, `firstBladeEdgeAngleDegrees`), or with `curvature` κ in (0, 1]
 *   rounded blades: each edge an arc of radius 1/κ (circumradius units) through the edge's two vertices, so κ = 1 is the
 *   circumscribed circle. At or below `circularAtOrBelowFNumber` the blades are open and the opening is the circle.
 *   The opening is scaled to the area of the circle of diameter f/N (equal-area convention): the f-number keeps its
 *   meaning for light throughput, which the capture applies elsewhere (π/(4·N_w²)), and the kernel's support has the
 *   disc's area.
 * - **Cat's eye** (`catsEye`): mechanical vignetting, the model of `calculateMechanicalVignetting` (Greivenkamp, OPTI-502
 *   course notes, University of Arizona, sec. 10, free; also see Kingslake, Lens Design Fundamentals, sec. 6.4). Each
 *   clipping aperture (a barrel or element rim referred to the entrance-pupil plane) is a circle of `radiusMm`, shifted by
 *   `shiftPerTanFieldMm`·tan θ toward the field point; the open pupil is the opening intersected with every circle. It
 *   depends on the field point, so the capture applies it per field zone (see `defocus-image-space-provider.ts`). The light
 *   it removes is not applied by the kernel (the kernel has unit sum, a shape only): declare the illumination falloff with
 *   `lens.vignetting`, as for any field throughput; `openAreaRatio` reports the open fraction.
 * - **Spherical aberration** (`sphericalAberration`): primary (Seidel) spherical aberration W = W040·ρ⁴ of the working
 *   pupil (ρ the pupil radius normalized to the pupil of f/N), given as W040 in µm at a reference f-number N₀ and scaled
 *   to the working f-number as W040·(N₀/N)⁴ (the pupil coordinate of a fixed lens shrinks with the stop). Its transverse
 *   ray aberration at the image is ε(ρ) = −(R/r_p)·∂W/∂ρ = −8·N·W040·ρ³ for R/r_p = 2N (Wyant & Creath 1992, "Basic
 *   Wavefront Aberration Theory for Optical Metrology", Applied Optics and Optical Engineering XI, §II.A and eq. 31, free).
 *
 * The ray map. A geometric (ray-optics) defocused image of a point is the pupil projected onto the sensor: the ray through
 * pupil point P = ρ·p̂ (pupil-radius units) lands at displacement
 *   y(P) = (σ·c/2 + b·ρ²)·P,  b = 8·N·W040(N)/pitch (sites),
 * from the chief ray, with c the thin-lens blur diameter in sites (`calculateDefocusCircle`, the marginal ray of the
 * aberration-free lens) and σ = +1 for a scene point behind the focus plane, −1 in front of it. Rays from behind the
 * focus plane cross before the sensor, those from in front have not crossed yet, so the two blurs are the same pupil
 * turned through 180° relative to each other, and spherical aberration adds to the defocus on one side and subtracts on
 * the other: with undercorrected spherical aberration (W040 > 0) the blur behind the focus plane is soft-edged and the
 * blur in front bright-rimmed (H. H. Nasse, "Depth of Field and Bokeh", Carl Zeiss Camera Lens Division, 2010, free; the
 * ray density follows from the map: for a circular pupil the image intensity at r = |σc/2·ρ + bρ³| is
 * proportional to 1/(|σc/2 + bρ²|·|σc/2 + 3bρ²|)). The convention of this module, used for `firstBladeEdgeAngleDegrees` and
 * the cat's-eye shift: shapes are declared as the blur of a point behind the focus plane appears in the output image
 * (+X right, +Y up), and the field tangent (tan θ along the field azimuth) is in the same frame.
 *
 * Sampling on the site lattice. As for the disc, a site's weight is the fraction of the blur's light inside that site's
 * square cell [i − ½, i + ½] × [j − ½, j + ½].
 * - Without spherical aberration the blur is uniform over the projected open pupil, a convex polygon (circles and blade
 *   arcs are polygons of 1024 sides, scaled to their true area; the boundary then lies within 5e-6 of the radius of the true
 *   curve), and each weight is the exact area of the polygon inside the cell (convex clipping and the shoelace formula),
 *   divided by the polygon's area: method `"exact-polygon-cell-area"`.
 * - With spherical aberration the intensity is not uniform (and has a caustic when |b| > c/6 on the bright-rimmed side), so
 *   the pupil is sampled on a square grid of step h ≤ 1/64, fine enough that neighbouring rays land at most 1/8 site apart,
 *   each grid cell's row segment weighted by its exact overlap with the open pupil's chord, and every ray binned into the
 *   site cell it lands in: method `"pupil-ray-binning"`, a quadrature with an error of the order of the ray spacing at the
 *   cells the blur's edge or caustic crosses.
 * Every step uses correctly rounded operations and the engine's portable trigonometry, so the weights are the same bits in
 * every JavaScript engine, and they are normalized as the disc's are (exact sum 1 within half an ulp of the largest weight,
 * which takes up the rounding instead of the centre: off axis the cat's eye can leave the centre cell empty).
 *
 * What it is: a geometric approximation (no diffraction of the defocused wave, an ideal thin lens with an aberration-free
 * pupil apart from the declared primary spherical aberration, referred to the paraxial focus, and an exit pupil of the same
 * shape and orientation as the entrance pupil). Not modelled: onion rings (aspherical-element texture), higher-order or
 * field-dependent aberrations, colour (the kernel is the same at every wavelength) and the depth-dependent change of the
 * cat's eye with the subject distance.
 */

import { calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { portableAsin, portableCosTwoPi, portableSinTwoPi } from "../core/portable-math.js";
import { requireAllowlistedRecord, requireInputKeys } from "../core/record-validation.js";
import { InvalidScientificInputError, requirePositiveFinite } from "../core/validation.js";
import { DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES, normalizeSiteKernel, resolveDefocusDisc, type DefocusDiscSiteKernel } from "./defocus-disc-kernel.js";

/** Largest blade count of `lens.defocus.blades` (and of {@link DefocusBokehBlades}). */
export const DEFOCUS_BOKEH_MAXIMUM_BLADES = 32;
/** Largest number of field zones across the frame's long side for the cat's eye (`catsEye.fieldZonesAcrossLongSide`). */
export const DEFOCUS_BOKEH_MAXIMUM_FIELD_ZONES = 32;
/** Default field zones across the long side. */
export const DEFOCUS_BOKEH_DEFAULT_FIELD_ZONES = 8;
/** Sides of the polygon that stands for a circle (and of all blade arcs together). */
const CURVE_SIDES = 1024;
/** Largest number of clipping apertures (as `calculateMechanicalVignetting`). */
const MAXIMUM_CLIPPING_APERTURES = 8;

/** Aperture blades: a regular polygon, optionally with rounded blades and open at wide f-numbers. */
export interface DefocusBokehBlades {
  /** Number of diaphragm blades, 3 to {@link DEFOCUS_BOKEH_MAXIMUM_BLADES}. */
  count: number;
  /** Rotation of the first blade edge, degrees counter-clockwise (`calculateIdealApertureGeometry`'s convention). Default 0. */
  firstBladeEdgeAngleDegrees?: number;
  /** Blade roundness κ in [0, 1]: each edge is an arc of radius 1/κ circumradii (0: straight blades, 1: a circle). Default 0. */
  curvature?: number;
  /** At or below this f-number the blades are open and the opening is circular (the lens's widest aperture). Default: never. */
  circularAtOrBelowFNumber?: number;
}

/** Primary (Seidel) spherical aberration W = W040·ρ⁴, given at a reference f-number. */
export interface DefocusBokehSphericalAberration {
  /** W040 in µm of optical path at the pupil edge of `atFNumber`; positive = undercorrected (marginal rays focus short). */
  w040Micrometers: number;
  /** The f-number at which `w040Micrometers` is given; the working value is W040·(atFNumber/N)⁴. */
  atFNumber: number;
}

/** One clipping aperture of the cat's eye, as `MechanicalVignettingAperture` of `calculateMechanicalVignetting`. */
export interface DefocusBokehClippingAperture {
  /** Aperture radius referred to the entrance-pupil plane, mm. */
  radiusMm: number;
  /** Shift of its projected centre per unit tan(field angle), mm, toward the field point when positive. */
  shiftPerTanFieldMm: number;
}

/** Mechanical vignetting (cat's eye): the open pupil clipped by each aperture at the field point. */
export interface DefocusBokehCatsEye {
  /** One through eight clipping apertures. */
  apertures: readonly DefocusBokehClippingAperture[];
  /**
   * `lens.defocus` only: zones across the frame's long side (1 to {@link DEFOCUS_BOKEH_MAXIMUM_FIELD_ZONES}, default
   * {@link DEFOCUS_BOKEH_DEFAULT_FIELD_ZONES}); square zones, each with the kernel of its centre's field point.
   */
  fieldZonesAcrossLongSide?: number;
}

/** The bokeh options of `lens.defocus` (#553), each off when omitted; a lens catalogue entry can carry them as they are. */
export interface DefocusBokehOptions {
  blades?: DefocusBokehBlades;
  sphericalAberration?: DefocusBokehSphericalAberration;
  catsEye?: DefocusBokehCatsEye;
}

/** Validated {@link DefocusBokehOptions}: a copy with defaults filled in. */
export interface ResolvedDefocusBokehOptions {
  blades?: Required<Omit<DefocusBokehBlades, "circularAtOrBelowFNumber">> & { circularAtOrBelowFNumber: number | null };
  sphericalAberration?: DefocusBokehSphericalAberration;
  catsEye?: { apertures: readonly DefocusBokehClippingAperture[]; fieldZonesAcrossLongSide: number };
}

function finiteIn(name: string, value: unknown, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high)
    throw new InvalidScientificInputError(name + " must be a finite number from " + low + " to " + high + ".");
  return value;
}
function integerIn(name: string, value: unknown, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high)
    throw new InvalidScientificInputError(name + " must be an integer from " + low + " to " + high + ".");
  return value;
}

/**
 * Validates bokeh options (unknown fields: `InvalidConfigurationError`; out-of-range values: `InvalidScientificInputError`).
 * `label` prefixes the messages (for example `"lens.defocus"`).
 */
export function resolveDefocusBokehOptions(value: unknown, label: string): ResolvedDefocusBokehOptions {
  const record = requireAllowlistedRecord(value, ["blades", "sphericalAberration", "catsEye"], label + " bokeh options must be an object.");
  const out: ResolvedDefocusBokehOptions = {};
  if (record.blades !== undefined) {
    const b = requireAllowlistedRecord(record.blades, ["count", "firstBladeEdgeAngleDegrees", "curvature", "circularAtOrBelowFNumber"], label + ".blades must be an object.");
    out.blades = {
      count: integerIn(label + ".blades.count", b.count, 3, DEFOCUS_BOKEH_MAXIMUM_BLADES),
      firstBladeEdgeAngleDegrees: b.firstBladeEdgeAngleDegrees === undefined ? 0 : finiteIn(label + ".blades.firstBladeEdgeAngleDegrees", b.firstBladeEdgeAngleDegrees, -360, 360),
      curvature: b.curvature === undefined ? 0 : finiteIn(label + ".blades.curvature", b.curvature, 0, 1),
      circularAtOrBelowFNumber: b.circularAtOrBelowFNumber === undefined ? null : finiteIn(label + ".blades.circularAtOrBelowFNumber", b.circularAtOrBelowFNumber, 0.5, 1024)
    };
  }
  if (record.sphericalAberration !== undefined) {
    const s = requireAllowlistedRecord(record.sphericalAberration, ["w040Micrometers", "atFNumber"], label + ".sphericalAberration must be an object.");
    out.sphericalAberration = { w040Micrometers: finiteIn(label + ".sphericalAberration.w040Micrometers", s.w040Micrometers, -100, 100),
      atFNumber: finiteIn(label + ".sphericalAberration.atFNumber", s.atFNumber, 0.5, 1024) };
  }
  if (record.catsEye !== undefined) {
    const c = requireAllowlistedRecord(record.catsEye, ["apertures", "fieldZonesAcrossLongSide"], label + ".catsEye must be an object.");
    if (!Array.isArray(c.apertures) || c.apertures.length < 1 || c.apertures.length > MAXIMUM_CLIPPING_APERTURES)
      throw new InvalidScientificInputError(label + ".catsEye.apertures must list 1 to " + MAXIMUM_CLIPPING_APERTURES + " clipping apertures.");
    const apertures = (c.apertures as unknown[]).map((a, k) => {
      const r = requireAllowlistedRecord(a, ["radiusMm", "shiftPerTanFieldMm"], label + ".catsEye.apertures[" + k + "] must be an object.");
      return { radiusMm: finiteIn(label + ".catsEye.apertures[" + k + "].radiusMm", r.radiusMm, 1e-6, 1e4),
        shiftPerTanFieldMm: finiteIn(label + ".catsEye.apertures[" + k + "].shiftPerTanFieldMm", r.shiftPerTanFieldMm, -1e4, 1e4) };
    });
    out.catsEye = { apertures, fieldZonesAcrossLongSide: c.fieldZonesAcrossLongSide === undefined ? DEFOCUS_BOKEH_DEFAULT_FIELD_ZONES :
      integerIn(label + ".catsEye.fieldZonesAcrossLongSide", c.fieldZonesAcrossLongSide, 1, DEFOCUS_BOKEH_MAXIMUM_FIELD_ZONES) };
  }
  return out;
}

// ---- Convex polygons, as flat [x0, y0, x1, y1, …] arrays, counter-clockwise. ----

type Polygon = number[];

function polygonArea(p: Polygon): number {
  let twice = 0;
  for (let k = 0, n = p.length; k < n; k += 2) {
    const k2 = k + 2 === n ? 0 : k + 2;
    twice += p[k]! * p[k2 + 1]! - p[k2]! * p[k + 1]!;
  }
  return Math.abs(twice) / 2;
}

/** Sutherland–Hodgman: the part of `p` where a·x + b·y ≤ c (one half-plane). */
function clipHalfPlane(p: Polygon, a: number, b: number, c: number): Polygon {
  const out: Polygon = [], n = p.length;
  if (n === 0) return out;
  let px = p[n - 2]!, py = p[n - 1]!, pd = a * px + b * py - c;
  for (let k = 0; k < n; k += 2) {
    const x = p[k]!, y = p[k + 1]!, d = a * x + b * y - c;
    if (d <= 0) {
      if (pd > 0) { const t = pd / (pd - d); out.push(px + t * (x - px), py + t * (y - py)); }
      out.push(x, y);
    } else if (pd <= 0) { const t = pd / (pd - d); out.push(px + t * (x - px), py + t * (y - py)); }
    px = x; py = y; pd = d;
  }
  return out;
}

/** The part of convex `p` inside convex counter-clockwise `clip` (each clip edge a half-plane). */
function clipConvex(p: Polygon, clip: Polygon): Polygon {
  let out = p;
  for (let k = 0, n = clip.length; k < n && out.length > 0; k += 2) {
    const k2 = k + 2 === n ? 0 : k + 2, ax = clip[k]!, ay = clip[k + 1]!, ex = clip[k2]! - ax, ey = clip[k2 + 1]! - ay;
    // Inside (left of the edge): ex·(y − ay) − ey·(x − ax) ≥ 0, i.e. ey·x − ex·y ≤ ey·ax − ex·ay.
    out = clipHalfPlane(out, ey, -ex, ey * ax - ex * ay);
  }
  return out;
}

/** The unit circle as a regular polygon of {@link CURVE_SIDES} sides, scaled to the circle's area π (built once). */
let unitCircle: Polygon | undefined;
function unitCirclePolygon(): Polygon {
  if (unitCircle) return unitCircle;
  const p: Polygon = [];
  for (let k = 0; k < CURVE_SIDES; k++) p.push(portableCosTwoPi(k / CURVE_SIDES), portableSinTwoPi(k / CURVE_SIDES));
  unitCircle = scaled(p, Math.sqrt(Math.PI / polygonArea(p)));
  return unitCircle;
}
function scaled(p: Polygon, s: number): Polygon { return p.map((v) => v * s); }

/**
 * The aperture opening in pupil-radius units (the circle of f/N has radius 1), scaled to area π: a circle, a regular
 * polygon (vertex k at turn ¼·(firstEdge/90 − 1) + (k + ½)/n, `calculateIdealApertureGeometry`'s convention) or rounded blades.
 */
function openingPolygon(blades: ResolvedDefocusBokehOptions["blades"], fNumber: number): Polygon {
  if (!blades || blades.curvature === 1 || (blades.circularAtOrBelowFNumber !== null && fNumber <= blades.circularAtOrBelowFNumber)) return unitCirclePolygon();
  const n = blades.count, first = blades.firstBladeEdgeAngleDegrees / 360 - 0.25 + 0.5 / n, p: Polygon = [];
  if (blades.curvature === 0) {
    for (let k = 0; k < n; k++) p.push(portableCosTwoPi(first + k / n), portableSinTwoPi(first + k / n));
  } else {
    // Edge k runs from vertex k to vertex k + 1; its normal is at turn first + (k + ½)/n. The arc of radius ρ_b = 1/κ through both
    // vertices has its centre on the normal at hc − √(ρ_b² − hs²) (hc = cos(π/n), hs = sin(π/n)) and spans ±α, sin α = hs·κ.
    const rb = 1 / blades.curvature, hs = portableSinTwoPi(0.5 / n), hc = portableCosTwoPi(0.5 / n);
    const centre = hc - Math.sqrt((rb - hs) * (rb + hs)), alphaTurns = portableAsin(Math.min(1, hs * blades.curvature)) / (2 * Math.PI);
    const perEdge = Math.max(2, Math.ceil(CURVE_SIDES / n));
    for (let k = 0; k < n; k++) {
      const normal = first + (k + 0.5) / n, cx = centre * portableCosTwoPi(normal), cy = centre * portableSinTwoPi(normal);
      for (let m = 0; m < perEdge; m++) {
        const u = normal - alphaTurns + 2 * alphaTurns * (m / perEdge);
        p.push(cx + rb * portableCosTwoPi(u), cy + rb * portableSinTwoPi(u));
      }
    }
  }
  return scaled(p, Math.sqrt(Math.PI / polygonArea(p)));
}

/** The open pupil: the opening clipped by each cat's-eye circle at field tangent t (pupil-radius units). */
function openPupil(options: ResolvedDefocusBokehOptions, fNumber: number, pupilRadiusMm: number, field: { x: number; y: number }): { polygon: Polygon; openAreaRatio: number } {
  const opening = openingPolygon(options.blades, fNumber), full = polygonArea(opening);
  let open = opening;
  if (options.catsEye) for (const a of options.catsEye.apertures) {
    const r = a.radiusMm / pupilRadiusMm, s = a.shiftPerTanFieldMm / pupilRadiusMm, circle = unitCirclePolygon(), cx = s * field.x, cy = s * field.y;
    const c: Polygon = [];
    for (let k = 0; k < circle.length; k += 2) c.push(cx + r * circle[k]!, cy + r * circle[k + 1]!);
    open = clipConvex(open, c);
  }
  return { polygon: open, openAreaRatio: open === opening ? 1 : polygonArea(open) / full };
}

/** Internal: the open-area ratio of the pupil at a field point (1 without a cat's eye), without building a kernel. */
export function openPupilAreaRatio(options: ResolvedDefocusBokehOptions, fNumber: number, focalLengthMm: number, field: { x: number; y: number }): number {
  return openPupil(options, fNumber, focalLengthMm / fNumber / 2, field).openAreaRatio;
}

/** Exact area of convex `p` (native site units, +Y down) inside each cell of the (2R + 1)² window. */
function polygonCellAreas(p: Polygon, R: number): Float64Array {
  const width = 2 * R + 1, out = new Float64Array(width * width);
  for (let j = -R; j <= R; j++) {
    const strip = clipHalfPlane(clipHalfPlane(p, 0, -1, -(j - 0.5)), 0, 1, j + 0.5);
    if (strip.length < 6) continue;
    let xmin = Infinity, xmax = -Infinity;
    for (let k = 0; k < strip.length; k += 2) { xmin = Math.min(xmin, strip[k]!); xmax = Math.max(xmax, strip[k]!); }
    const i0 = Math.max(-R, Math.ceil(xmin - 0.5)), i1 = Math.min(R, Math.floor(xmax + 0.5));
    for (let i = i0; i <= i1; i++) {
      const cell = clipHalfPlane(clipHalfPlane(strip, -1, 0, -(i - 0.5)), 1, 0, i + 0.5);
      if (cell.length >= 6) out[(j + R) * width + i + R] = polygonArea(cell);
    }
  }
  return out;
}

/** The index of the largest weight (the first on ties), which takes up the normalization's rounding: the centre may be empty off axis. */
function largestIndex(weights: Float64Array): number {
  let best = 0;
  for (let k = 1; k < weights.length; k++) if (weights[k]! > weights[best]!) best = k;
  return best;
}

function radiusOfExtent(extent: number): number { return extent <= 0.5 ? 0 : Math.ceil(extent - 0.5); }

function requireRadius(radius: number, what: string): number {
  if (radius > DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES)
    throw new InvalidScientificInputError("The shaped defocus kernel (" + what + ") needs a kernel radius of " + radius + " sites; the limit is " +
      DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES + " sites (DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES).");
  return radius;
}

/** The shaped kernel on the site lattice, with what shaped it. */
export interface DefocusBokehSiteKernel extends DefocusDiscSiteKernel {
  /** Open pupil area / unclipped opening area at this field point (1 without a cat's eye). */
  openAreaRatio: number;
  /** "exact-polygon-cell-area" without spherical aberration, "pupil-ray-binning" with it. */
  method: "exact-polygon-cell-area" | "pupil-ray-binning";
  /** Rays binned (pupil-ray-binning), else 0. */
  raySamples: number;
  /** b = 8·N·W040(N) / pitch, the transverse spherical aberration of the marginal ray in sites (0 without it). */
  sphericalAberrationSites: number;
}

export interface DefocusBokehKernelParameters {
  /** Thin-lens blur diameter c in sites (> 0). */
  diameterSites: number;
  /** +1: scene plane behind the focus plane (subject farther than focus); −1: in front of it. */
  side: 1 | -1;
  fNumber: number;
  focalLengthMm: number;
  pitchMicrometers: number;
  options: ResolvedDefocusBokehOptions;
  /** Field tangent tan θ·(cos φ, sin φ) in output-image axes (+X right, +Y up); only the cat's eye reads it. Default on axis. */
  field?: { x: number; y: number };
}

/** Internal: the shaped defocus kernel for one field point (see the module comment). Fails past the radius cap or when the pupil closes. */
export function createDefocusBokehSiteKernel(input: DefocusBokehKernelParameters): DefocusBokehSiteKernel {
  const { diameterSites, side, fNumber, options } = input;
  const a = diameterSites / 2, pupilRadiusMm = input.focalLengthMm / fNumber / 2, field = input.field ?? { x: 0, y: 0 };
  const sa = options.sphericalAberration;
  const q = sa ? sa.atFNumber / fNumber : 0, w040 = sa ? sa.w040Micrometers * ((q * q) * (q * q)) : 0, b = 8 * fNumber * w040 / input.pitchMicrometers;
  const { polygon, openAreaRatio } = openPupil(options, fNumber, pupilRadiusMm, field);
  if (polygon.length < 6 || openAreaRatio <= 0)
    throw new InvalidScientificInputError("lens.defocus: the cat's-eye apertures close the pupil at field tangent (" + field.x + ", " + field.y + ").");
  const s = side * a;
  if (b === 0) {
    // Uniform blur: the open pupil scaled by σ·c/2, +Y up to native +Y down.
    const image: Polygon = [];
    let extent = 0;
    for (let k = 0; k < polygon.length; k += 2) {
      const x = s * polygon[k]!, y = -s * polygon[k + 1]!;
      image.push(x, y);
      extent = Math.max(extent, Math.abs(x), Math.abs(y));
    }
    const radius = requireRadius(radiusOfExtent(extent), diameterSites + " sites across");
    const width = 2 * radius + 1, weights = polygonCellAreas(image, radius);
    normalizeSiteKernel(weights, largestIndex(weights));
    return { diameterSites, radius, width, weights, openAreaRatio, method: "exact-polygon-cell-area", raySamples: 0, sphericalAberrationSites: 0 };
  }
  // Spherical aberration: y(P) = (σc/2 + bρ²)·P, binned. The extent bound: max over ρ ≤ ρmax of |s·ρ + b·ρ³|.
  let rhoMax2 = 0, xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let k = 0; k < polygon.length; k += 2) {
    const x = polygon[k]!, y = polygon[k + 1]!;
    rhoMax2 = Math.max(rhoMax2, x * x + y * y);
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  const rhoMax = Math.sqrt(rhoMax2);
  let extent = Math.abs(s * rhoMax + b * rhoMax * rhoMax2);
  const stationary2 = -s / (3 * b);
  if (stationary2 > 0 && stationary2 < rhoMax2) { const r = Math.sqrt(stationary2); extent = Math.max(extent, Math.abs(s * r + b * r * stationary2)); }
  const radius = requireRadius(radiusOfExtent(extent), diameterSites + " sites across with " + b + " sites of spherical aberration");
  const width = 2 * radius + 1, weights = new Float64Array(width * width);
  // Pupil step: rays at most 1/8 site apart where the map is steepest (|s| + 3|b|ρ²), and at least 64 steps per pupil radius.
  const h = Math.min(1 / 64, 1 / (8 * (Math.abs(s) + 3 * Math.abs(b) * rhoMax2)));
  const rows = Math.ceil((ymax - ymin) / h), columns = Math.ceil((xmax - xmin) / h), n = polygon.length;
  let rays = 0;
  for (let r = 0; r < rows; r++) {
    const y = ymin + (r + 0.5) * h;
    let left = Infinity, right = -Infinity;
    for (let k = 0; k < n; k += 2) {
      const k2 = k + 2 === n ? 0 : k + 2, ay = polygon[k + 1]!, by = polygon[k2 + 1]!;
      if ((ay <= y && y < by) || (by <= y && y < ay)) {
        const ax = polygon[k]!, x = ax + (y - ay) * (polygon[k2]! - ax) / (by - ay);
        left = Math.min(left, x); right = Math.max(right, x);
      }
    }
    if (!(left < right)) continue;
    const m0 = Math.max(0, Math.floor((left - xmin) / h)), m1 = Math.min(columns - 1, Math.floor((right - xmin) / h));
    for (let m = m0; m <= m1; m++) {
      const x0 = xmin + m * h, x = x0 + 0.5 * h, coverage = Math.min(x0 + h, right) - Math.max(x0, left);
      if (!(coverage > 0)) continue;
      const f = s + b * (x * x + y * y);
      let i = Math.round(f * x), j = Math.round(-f * y);
      if (i > radius) i = radius; else if (i < -radius) i = -radius;
      if (j > radius) j = radius; else if (j < -radius) j = -radius;
      const index = (j + radius) * width + i + radius;
      weights[index] = weights[index]! + coverage;
      rays++;
    }
  }
  normalizeSiteKernel(weights, largestIndex(weights));
  return { diameterSites, radius, width, weights, openAreaRatio, method: "pupil-ray-binning", raySamples: rays, sphericalAberrationSites: b };
}

export interface CalculateDefocusBokehKernelInput {
  /** Lens focal length, mm. */
  focalLengthMm: number;
  /** Working f-number. */
  aperture: number;
  /** Focus-plane distance, m. */
  focusDistanceM: number;
  /** Scene-plane distance, m. */
  subjectDistanceM: number;
  /** Sensor site pitch, µm: the lattice the kernel is sampled on. */
  pixelPitchMicrometers: number;
  /** The bokeh options, as `lens.defocus` takes them (blades, sphericalAberration, catsEye). */
  bokeh: DefocusBokehOptions;
  /** Field tangent tan θ·(cos φ, sin φ) in output-image axes (+X right, +Y up); only the cat's eye reads it. Default on axis. */
  fieldTangent?: { x: number; y: number };
}

export interface DefocusBokehKernel {
  /** "behind-focus" (subject farther than focus), "in-front-of-focus", or "in-focus" (no kernel). */
  side: "behind-focus" | "in-front-of-focus" | "in-focus";
  /** Thin-lens blur diameter c, µm and sites (`calculateDefocusCircle`, thin-lens model 1.1.0). */
  diameterMicrometers: number;
  diameterSites: number;
  /** Kernel radius R and window side 2R + 1 (0 and 1 in focus). */
  kernelRadiusSites: number;
  width: number;
  /** Row-major weights, index (j + R)·width + (i + R) for site offset (i right, j down) from the chief ray; null in focus. */
  weights: Float64Array | null;
  /** Open pupil area / unclipped opening area at the field point (the cat's eye's open fraction; 1 without one). */
  openAreaRatio: number;
  method: "exact-polygon-cell-area" | "pupil-ray-binning" | "none";
  /** Transverse spherical aberration of the marginal ray at the working f-number, sites (8·N·W040(N)/pitch). */
  sphericalAberrationSites: number;
  raySamples: number;
}

/**
 * The defocus kernel of `lens.defocus` with bokeh options (#553), on the site lattice, for one field point: the same kernel
 * `simulateCapture` and the display view apply (on the field zone's centre with a cat's eye). Pure; for tests, previews and
 * lens catalogues. Fails with `InvalidScientificInputError` past {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES} (spherical
 * aberration can widen the blur beyond the disc) or when the cat's eye closes the pupil, `InvalidConfigurationError` for
 * unknown fields. A geometric approximation: see the module comment of `defocus-bokeh-kernel.ts` and docs/QUICK_START.md,
 * "Bokeh character".
 *
 * @param input Lens, f-number, distances, pitch, bokeh options and an optional field point.
 * @returns The kernel, its radius, the open-area ratio, the method and the spherical-aberration size in sites.
 */
export function calculateDefocusBokehKernel(input: CalculateDefocusBokehKernelInput): CalculationResult<DefocusBokehKernel> {
  requireInputKeys(input, "calculateDefocusBokehKernel", ["focalLengthMm", "aperture", "focusDistanceM", "subjectDistanceM", "pixelPitchMicrometers", "bokeh", "fieldTangent"]);
  requirePositiveFinite("pixelPitchMicrometers", input.pixelPitchMicrometers);
  const options = resolveDefocusBokehOptions(input.bokeh, "calculateDefocusBokehKernel");
  let field = { x: 0, y: 0 };
  if (input.fieldTangent !== undefined) {
    const f = requireAllowlistedRecord(input.fieldTangent, ["x", "y"], "fieldTangent must be { x, y }.");
    if (typeof f.x !== "number" || typeof f.y !== "number" || !Number.isFinite(f.x) || !Number.isFinite(f.y)) throw new InvalidConfigurationError("fieldTangent x and y must be finite numbers.");
    field = { x: f.x, y: f.y };
  }
  const disc = resolveDefocusDisc({ focalLengthMm: input.focalLengthMm, aperture: input.aperture, focusDistanceM: input.focusDistanceM,
    subjectDistanceM: input.subjectDistanceM, pitchMicrometers: input.pixelPitchMicrometers });
  const assumptions = ["Geometric defocus kernel shaped by the lens (#553), an approximation: thin-lens blur circle, projected open pupil, primary spherical aberration by its ray map",
    "No diffraction, onion rings, higher-order or field-dependent aberrations, or colour"];
  if (disc.diameterSites === 0) return calculatedResult({ side: "in-focus" as const, diameterMicrometers: 0, diameterSites: 0, kernelRadiusSites: 0, width: 1, weights: null,
    openAreaRatio: 1, method: "none" as const, sphericalAberrationSites: 0, raySamples: 0 }, "defocus-bokeh-kernel", "1.0.0", assumptions);
  const side = input.subjectDistanceM > input.focusDistanceM ? 1 : -1;
  const kernel = createDefocusBokehSiteKernel({ diameterSites: disc.diameterSites, side, fNumber: input.aperture, focalLengthMm: input.focalLengthMm,
    pitchMicrometers: input.pixelPitchMicrometers, options, field });
  return calculatedResult({ side: side === 1 ? "behind-focus" as const : "in-front-of-focus" as const, diameterMicrometers: disc.diameterMicrometers, diameterSites: disc.diameterSites,
    kernelRadiusSites: kernel.radius, width: kernel.width, weights: kernel.weights, openAreaRatio: kernel.openAreaRatio, method: kernel.method,
    sphericalAberrationSites: kernel.sphericalAberrationSites, raySamples: kernel.raySamples }, "defocus-bokeh-kernel", "1.0.0", assumptions);
}
