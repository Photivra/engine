// SPDX-License-Identifier: Apache-2.0

/**
 * The layered sum's geometry (2.29.0 groups L0 and LG; the model is in `layered-scene-signal.ts`): the site lattice and its
 * lattice groups, the frame point and field factor of a lattice point, each card's edges near a lattice point, and the surface a
 * lattice point sees alone. Nothing here reads a scene or a spectrum.
 *
 * Coordinates.
 * - Frame units (u right, v up; the frame is 2 wide), the units of every surface's rectangle and scene. Frame units are angles,
 *   so the chief ray of a lattice point meets every surface at the same frame point.
 * - A lattice group is an opaque handle for one lattice frame: today a fractional shift (fx, fy) in [0, 1) of the native
 *   site lattice (a pixel-aperture node or an anti-aliasing spot of the expected signal); lattice point (p, q) of a group is
 *   site (p, q) shifted by (fx, fy). Groups are registered on first use and keep their index. #746 (group LM) extends the
 *   handle to (fx, fy, instant): a moving camera's instant is part of the group, so no function here takes an instant, and
 *   everything keyed by group (rectangles, tiles) is keyed by instant with it.
 * - Continuous lattice coordinates (X right, Y down) of a group: lattice point (p, q) is at (X, Y) = (p, q), the sensor point
 *   (X + ½ + fx − W/2, Y + ½ + fy − H/2) sites from the raster's centre. The ray through lattice point (x, y) and pupil point P
 *   (pupil-radius units, native axes) meets surface j's image at (x − ρ_j·Px, y − ρ_j·Py), ρ_j the surface's signed blur radius in
 *   sites: defocus and occlusion stay on the sensor's lattice, as the single-plane image-space path (#548) has them.
 *
 * The planar map (no `lensMap`, `frameScale` 1). The still, rectilinear, distortion-free camera: frame point
 * u = (X + ½ + fx − W/2)·g, v = −(Y + ½ + fy − H/2)·g, g = 2 / outputWidth frame units per site (the facade's lattice formula,
 * `latticeU`/`latticeV`), field factor 1, and each card is an axis-aligned rectangle, the same at every lattice point: its edges
 * are the box form [X0, Y0, X1, Y1] (`planar` is true; the layered GPU path reads the box from `edges` as uniforms). These
 * expressions are L0's, bit for bit (test/layered-scene-seams.test.ts).
 *
 * A lens map (#744: `lensMap`, or a `frameScale` other than 1). The lattice point's sensor point goes through the lens
 * ({@link LayeredLensMap}: inverse distortion, then the projection) to a field direction, which is one frame point on every
 * surface; the frame point is that point divided by `frameScale` (1 today; #748's focus breathing). The field factor is the
 * vignetting throughput times the distortion area factor, and 0 where the point sees no scene (at 90° and beyond, or outside a
 * fisheye's image circle, where the ray looks backward): the lattice's tile fill multiplies each surface's radiance by it
 * (`LayeredFramePoint.factor`, L0's seam), as the catalogue and image-space signals take F·L at each tap point.
 *   In image space a card's edge is a curve. Near a lattice point each edge (u = u0, u = u1, v = v0, v = v1 of the card's
 *   rectangle) is taken as its tangent line at its point nearest the lattice point (two Newton steps along the map's gradient,
 *   central differences of a quarter site; an edge farther than twice the card's box by the tangent map at the point, on the side
 *   the map at the box's four corners confirms, takes that tangent map's line with deviation 0), so each
 *   card is four half-planes n·Z + c ≥ 0 (unit normals, c in sites) and a pupil row's open part on it is still one exact interval.
 *   This is an approximation of second order in the edge's curvature over the point's reach. It is measured at every lattice
 *   point: the true edge's offset from the line (the map's level difference over its own derivative along the normal there) at the
 *   two ends and the middle of
 *   the line's span across the box the card's rays and kernel taps reach, a parabola through them, its largest value, times 1.25,
 *   kept with the
 *   half-plane as its deviation d in sites. {@link layeredBoxRelation} widens each half-plane by d, so its 0 and 1 stay certain for
 *   the curved card. Where an edge that crosses a point's reach deviates by more than {@link LAYERED_EDGE_CURVATURE_TOLERANCE_SITES},
 *   the visibility takes each kernel tap's pupil region with the tangents at that region's own footprint instead, split in four
 *   until each piece is within the tolerance (`layered-visibility.ts`, `rowsHold`).
 *   Fisheyes: the wiring refuses a layered request that reads any point 75° or more off the axis
 *   ({@link checkLayeredFisheyeFieldAngle}; owner decision), so the rule below applies only to lens maps used without that check.
 *   At the horizon (an approximation, labeled: the scene is not defined there). A ray whose point on a surface sees no scene ends
 *   there, dark. A lattice point whose whole reach box sees no scene has no card (every value it reads is 0); one whose box
 *   straddles the horizon has no tangent map to trust, so its rows do not hold and each tap's region takes its own tangents, a
 *   region whose footprint on a card sees no scene ending on that card.
 *
 * Interface for the later 2.29.0 groups (each change must keep this module's values bit for bit where it does not apply):
 * - {@link LayeredLatticeGeometry.framePoint}`(group, p, q, out)`: the frame point (u, v) of a lattice point and its field
 *   factor. #746 (group LM) applies the camera rotation of the group's instant. `latticeU`/`latticeV` stay the separable planar
 *   form for the lattice's own callers (the capture's provider does not use them: it inverts the planar formula, or the lens map,
 *   in its own `keyOf`). {@link LayeredLatticeGeometry.rasterFramePoint} maps the renderer's planar pilot point through the lens.
 * - {@link LayeredLatticeGeometry.edges}`(group, p, q)`: per surface (nearest first), the card's edges near lattice point (p, q)
 *   in the group's continuous lattice coordinates, or null for the far surface: the box form on the planar map, half-planes
 *   with a lens map ({@link LayeredCardEdges}; opaque: read them through {@link layeredBoxRelation} and the visibility rows). The
 *   last point's arrays are kept (memoized per (group, p, q)) and stay valid until a call for another point.
 * - {@link layeredBoxRelation}: a box against a card: 0 outside and 1 inside (both certain), 2 maybe across an edge.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/** Most lattice groups of one lattice; also the key spacing of the per-surface tiles (key = surface·this + group). */
export const LAYERED_LATTICE_GROUP_LIMIT = 4096;

/**
 * With a lens map: the largest deviation, in sites, of a card's edge from its tangent half-plane within a lattice point's reach
 * for which the visibility rows take the point's tangent map; beyond it each kernel tap's region takes its own (see the module
 * comment). 1/32 site moves a blurred edge by at most 1/32 site.
 */
export const LAYERED_EDGE_CURVATURE_TOLERANCE_SITES = 1 / 32;

/**
 * A lattice point's frame point, frame units (u right, v up), and its field factor: the surface radiance there is multiplied
 * by `factor` (1 on the planar map; 0 leaves the point dark without reading the scene).
 */
export interface LayeredFramePoint { u: number; v: number; factor: number }

/**
 * A card's edges near a lattice point, in a group's continuous lattice coordinates (X right, Y down). Read only and opaque: use
 * {@link layeredBoxRelation} and the visibility rows. On the planar map the four axis-aligned half-planes X ≥ X0, Y ≥ Y0, X ≤ X1,
 * Y ≤ Y1 of its rectangle, as [X0, Y0, X1, Y1] (4 values; the layered GPU path reads this box); with a lens map four half-planes
 * a·X + b·Y + c ≥ 0 with unit normals and each one's deviation d in sites, as [a, b, c, d] × 4 (16 values).
 */
export type LayeredCardEdges = Float64Array;

/**
 * The lens's map of a sensor point to its frame point (#744), for a still camera. Sensor points are in sites from the raster's
 * centre (+x right, +y down). {@link createLayeredLensMap} builds it from the facade's prepared lens geometry.
 */
export interface LayeredLensMap {
  /**
   * The frame point (frame units, u right, v up) and field factor (vignetting throughput × distortion area factor) of sensor
   * point (x, y), into `out` (returned); factor 0 where the point sees no scene (u and v are then unused).
   */
  framePointOf(x: number, y: number, out: LayeredFramePoint): LayeredFramePoint;
  /** The sensor point (sites from the centre) whose ray looks in direction `look` (unit, toward the scene), or undefined. */
  sensorPointOf(look: { x: number; y: number; z: number }): { x: number; y: number } | undefined;
  /** A direction at or beyond 90° sees no scene (zero radiance) instead of failing: catalogue fisheyes (#588). */
  readonly zeroBeyondHorizon: boolean;
}

/** What the geometry reads of each surface (nearest first; the last is the far surface, rect null). */
export interface LayeredGeometryLayer {
  /** The surface's rectangle in frame units; null for the far surface. */
  readonly rect: { u0: number; v0: number; u1: number; v1: number } | null;
  /** Signed blur radius ρ = σ·c/2 in sites (+ behind the focus plane). */
  readonly blurRadiusSites: number;
  /** Its defocus kernel (radius in sites), or null in focus. */
  readonly kernel: { readonly radius: number } | null;
}

export interface LayeredGeometryInput {
  nativeWidth: number;
  nativeHeight: number;
  /** Frame output width: g = 2 / outputWidth frame units per site. */
  outputWidth: number;
  layers: readonly LayeredGeometryLayer[];
  /** #744: the lens's map of sensor points to frame points; omitted for the planar map (see the module comment). */
  lensMap?: LayeredLensMap | undefined;
  /** #744, for #748's focus breathing: the image's scale; a frame point is the map's point divided by it. Default 1. */
  frameScale?: number | undefined;
  /**
   * #744, with a lens map: how far beyond the raster's outer site centres the lattice's readers reach, in sites (the signal's
   * `reach`: the query offsets and the diffraction kernel). Lattice points farther out than this plus the surfaces' reach and the
   * edges' sample box (`lensReachSites`) are dark without being mapped: the fixed tiles' far corners, which feed no read value.
   * Default 0.
   */
  marginSites?: number | undefined;
}

/** The layered sum's geometry (see the module comment). */
export interface LayeredLatticeGeometry {
  /** Surfaces, nearest first. */
  readonly surfaces: number;
  /** True on the planar map: each card's edges are its box [X0, Y0, X1, Y1], the same at every lattice point of a group. */
  readonly planar: boolean;
  /** The lens map, or undefined without one (the capture's provider keys its queries through it). */
  readonly lensMap: LayeredLensMap | undefined;
  /** The image's scale (`frameScale`, 1 by default): a frame point is the map's point divided by it. */
  readonly frameScale: number;
  /**
   * With a lens map: the sites beyond the raster's outer site centres at which the map is read (`marginSites` plus the edges' sample
   * box and one); the map must cover them. 0 on the planar map.
   */
  readonly lensReachSites: number;
  /** Each surface's signed blur radius ρ in sites: the ray map's scale at its depth. */
  readonly blurRadiusSites: readonly number[];
  /** Each surface's reach: every ray of a lattice point and every kernel tap it reads lie within this many sites of it on that surface. */
  readonly reachSites: readonly number[];
  /** The lattice group (an opaque frame handle) of a fractional shift (fx, fy) in [0, 1), registered on first use (shifts within 1e-9 are one group). */
  groupOf(fx: number, fy: number): number;
  readonly groups: readonly { fx: number; fy: number }[];
  /** Frame point and field factor of lattice point (p, q) of a group, into `out` (returned). */
  framePoint(group: number, p: number, q: number, out: LayeredFramePoint): LayeredFramePoint;
  /** The planar frame u of lattice column p of a group, and v of row q (the facade's lattice formula; not the lens map's). */
  latticeU(group: number, p: number): number;
  latticeV(group: number, q: number): number;
  /**
   * The frame point and field factor of the renderer's planar raster point (u, v) (its pilot point: sensor point (u/g, −v/g)
   * sites from the centre) through the lens map; (u, v) and 1 on the planar map.
   */
  rasterFramePoint(u: number, v: number, out: LayeredFramePoint): LayeredFramePoint;
  /** Per surface, its card's edges near lattice point (p, q) of a group, or null for the far surface (valid until the next call for another point). */
  edges(group: number, p: number, q: number): readonly (LayeredCardEdges | null)[];
  /**
   * Card k's edges near continuous lattice point (x, y) of a group, the map's tangent taken at (x, y) and the deviation over a box
   * of half-size h, into `out` (16 values; returned). With a lens map only (the visibility's per-tap regions): where (x, y) or its
   * tangent's difference steps see no scene the card takes every ray there (they end dark: its radiance is 0). On the planar map
   * the box, as `edges` gives it.
   */
  edgesNear(group: number, k: number, x: number, y: number, h: number, out: Float64Array): LayeredCardEdges;
  /**
   * The one surface every ray and tap of lattice point (p, q) of a group reaches, or −1 when some of them meet a card edge
   * (conservative: −1 can also mean one surface).
   */
  surfaceOf(group: number, p: number, q: number): number;
  /** The same for every lattice point within `reach` sites of native site (x, y), on the unshifted lattice. */
  siteSurface(x: number, y: number, reach: number): number;
  /** The first surface along the chief ray of frame point (u, v). */
  chiefSurface(u: number, v: number): number;
}

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };
const GROUP_TOLERANCE = 1e-9;

/**
 * A box [x0, x1] × [y0, y1] against a card's edges: 0 outside, 1 inside (both certain, closed cards), 2 maybe across an edge.
 * With a lens map each half-plane is widened by its deviation, so 0 and 1 hold for the curved card too.
 */
export const layeredBoxRelation = (r: LayeredCardEdges, x0: number, y0: number, x1: number, y1: number): number =>
  r.length === 4 ? x1 < r[0]! || x0 > r[2]! || y1 < r[1]! || y0 > r[3]! ? 0 : x0 >= r[0]! && x1 <= r[2]! && y0 >= r[1]! && y1 <= r[3]! ? 1 : 2 :
    halfPlaneBoxRelation(r, x0, y0, x1, y1);

function halfPlaneBoxRelation(r: LayeredCardEdges, x0: number, y0: number, x1: number, y1: number): number {
  let inside = true;
  for (let i = 0; i < 16; i += 4) {
    const a = r[i]!, b = r[i + 1]!, c = r[i + 2]!, d = r[i + 3]!;
    const ax0 = a * x0, ax1 = a * x1, by0 = b * y0, by1 = b * y1;
    const high = c + Math.max(ax0, ax1) + Math.max(by0, by1), low = c + Math.min(ax0, ax1) + Math.min(by0, by1);
    if (high < -d) return 0;
    if (!(low >= d)) inside = false;
  }
  return inside ? 1 : 2;
}

/** Step of the map's central differences, in sites. */
const JACOBIAN_STEP = 0.25;
/** Safety factor on the measured deviation of the tangent map (third-order terms). */
const DEVIATION_FACTOR = 1.25;
/** A card that no ray of the point can meet: a half-plane that holds nowhere (0·X + 0·Y − 1 ≥ 0), certain. */
const EMPTY = /* @__PURE__ */ Float64Array.of(0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0);
/** The same with an unknown deviation: the box relation answers "maybe" and the rows do not hold (a point at the horizon). */
const UNKNOWN = /* @__PURE__ */ Float64Array.of(0, 0, -1, Infinity, 0, 0, -1, Infinity, 0, 0, -1, Infinity, 0, 0, -1, Infinity);
/** A card that takes every ray of a tap region whose footprint sees no scene: the ray ends there, dark (1 ≥ 0 everywhere). */
const FULL = /* @__PURE__ */ Float64Array.of(0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0);

/**
 * The facade's lens geometry (`prepareDefocusImageSpaceGeometry` of `defocus-image-space-provider.ts`, a still camera at time 0)
 * as a {@link LayeredLensMap}: a sensor point's look direction and field factor, and its frame point by the base provider's own
 * plane arithmetic (as `createDefocusImageSpaceProvider` maps its lattice points). Directions at or beyond 90° have factor 0
 * with `zeroBeyondHorizon` and fail without it.
 */
export function createLayeredLensMap(input: {
  geometry: { lookOf(xMm: number, yMm: number, timeSeconds: number): { x: number; y: number; z: number; factor: number };
    sensorPointOf(look: { x: number; y: number; z: number }, timeSeconds: number): { x: number; y: number } | undefined };
  pitchMicrometers: number; distanceM: number; metresPerFrameUnit: number; zeroBeyondHorizon?: boolean | undefined;
}): LayeredLensMap {
  const { geometry, distanceM: distance, metresPerFrameUnit: scale } = input, mm = input.pitchMicrometers / 1000, zeroBeyondHorizon = input.zeroBeyondHorizon === true;
  return {
    zeroBeyondHorizon,
    framePointOf(x, y, out): LayeredFramePoint {
      const look = geometry.lookOf(x * mm, y * mm, 0);
      if (!(look.z > 0)) {
        if (!zeroBeyondHorizon) fail("Layered scene: a lattice point's ray does not point toward the scene.");
        out.u = 0; out.v = 0; out.factor = 0; return out;
      }
      const t = distance / look.z;
      out.u = look.x * t / scale; out.v = look.y * t / scale; out.factor = look.factor;
      return out;
    },
    sensorPointOf(look): { x: number; y: number } | undefined {
      const point = geometry.sensorPointOf(look, 0);
      return point && { x: point.x / mm, y: point.y / mm };
    }
  };
}

/**
 * The largest field angle, in degrees, a layered chart scene with a fisheye lens may read (owner decision, 2.29.0): 15° inside the
 * horizon. Nearer the horizon the frame coordinate (tan θ) blows up and the tangent edges are not within the layered sum's bounds.
 */
export const LAYERED_FISHEYE_MAXIMUM_FIELD_ANGLE_DEGREES = 75;

/**
 * Internal, for the wiring of a layered chart scene with a fisheye lens: fails unless every sensor point the request reads (the
 * native raster's outer site centres widened by `reachSites`, the lattice's `lensReachSites`) looks less than
 * {@link LAYERED_FISHEYE_MAXIMUM_FIELD_ANGLE_DEGREES} off the axis. The boundary of that rectangle is checked at 64 points per side
 * (the radial projections' field angle grows with the radius, so the largest is on it); a point that looks backward (outside the
 * image circle) counts as 180°. Returns the largest field angle found, in degrees.
 */
export function checkLayeredFisheyeFieldAngle(input: {
  geometry: { lookOf(xMm: number, yMm: number, timeSeconds: number): { x: number; y: number; z: number } };
  pitchMicrometers: number; nativeWidth: number; nativeHeight: number; reachSites: number;
}): number {
  const mm = input.pitchMicrometers / 1000, hx = (input.nativeWidth / 2 - 0.5 + input.reachSites) * mm, hy = (input.nativeHeight / 2 - 0.5 + input.reachSites) * mm;
  let largest = 0;
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = -1 + 2 * i / N;
    for (const [x, y] of [[t * hx, -hy], [t * hx, hy], [-hx, t * hy], [hx, t * hy]] as const) {
      const look = input.geometry.lookOf(x, y, 0), length = Math.hypot(look.x, look.y, look.z);
      largest = Math.max(largest, Math.acos(Math.max(-1, Math.min(1, look.z / length))) * 180 / Math.PI);
    }
  }
  if (!(largest < LAYERED_FISHEYE_MAXIMUM_FIELD_ANGLE_DEGREES))
    fail("Layered chart scenes with a fisheye lens render only within " + LAYERED_FISHEYE_MAXIMUM_FIELD_ANGLE_DEGREES + "° of the axis (15° inside the horizon); " +
      "this request reads points " + (largest >= 180 ? "outside the image circle" : largest.toFixed(1) + "° off the axis") +
      ". Use a longer focal length, a smaller frame or less defocus.");
  return largest;
}

/** Internal: the geometry of a layer list (validated by the caller, `createLayeredSceneLattice`). */
export function createLayeredLatticeGeometry(input: LayeredGeometryInput): LayeredLatticeGeometry {
  const { nativeWidth: W, nativeHeight: H, layers } = input, g = 2 / input.outputWidth, K = layers.length;
  const rho = layers.map((l) => l.blurRadiusSites), radius = layers.map((l) => (l.kernel ? l.kernel.radius : 0));
  // Every ray of a lattice point and every tap it reads lie within this many sites of it on surface j (blades reach past the unit circle).
  const reachOf = layers.map((_, j) => Math.max(radius[j]! + 0.5, 1.25 * Math.abs(rho[j]!) + 0.5));
  const groups: { fx: number; fy: number }[] = [];
  const frameScale = input.frameScale ?? 1;
  if (!(frameScale > 0 && Number.isFinite(frameScale))) fail("Layered scene: the frame scale must be positive and finite.");
  const lensMap = input.lensMap, planar = lensMap === undefined && frameScale === 1;
  /** Rectangles in each group's continuous lattice coordinates: X = u/g − ½ + W/2 − fx, Y = −v/g − ½ + H/2 − fy. */
  const rects: (LayeredCardEdges | null)[][] = [];
  const toLattice = (fx: number, fy: number): (LayeredCardEdges | null)[] => layers.map((l) => l.rect === null ? null :
    Float64Array.of(l.rect.u0 / g - 0.5 + W / 2 - fx, -l.rect.v1 / g - 0.5 + H / 2 - fy, l.rect.u1 / g - 0.5 + W / 2 - fx, -l.rect.v0 / g - 0.5 + H / 2 - fy));
  const siteRects = planar ? toLattice(0, 0) : [];
  function groupOf(fx: number, fy: number): number {
    const at = groups.findIndex((q) => Math.abs(q.fx - fx) <= GROUP_TOLERANCE && Math.abs(q.fy - fy) <= GROUP_TOLERANCE);
    if (at >= 0) return at;
    if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) fail("Layered scene: a lattice shift must be in [0, 1).");
    if (groups.length >= LAYERED_LATTICE_GROUP_LIMIT) fail("Layered scene: too many lattice groups.");
    groups.push({ fx, fy });
    if (planar) rects.push(toLattice(fx, fy));
    return groups.length - 1;
  }
  // The facade's lattice formula (expected-signal.ts, diffraction-provider.ts), the same expressions.
  const latticeU = (group: number, p: number): number => { const fx = groups[group]!.fx; return fx === 0 ? (p + 0.5 - W / 2) * g : (p + 0.5 + fx - W / 2) * g; };
  const latticeV = (group: number, q: number): number => { const fy = groups[group]!.fy; return fy === 0 ? -(q + 0.5 - H / 2) * g : -(q + 0.5 + fy - H / 2) * g; };
  /** The one surface every ray and tap of a point (lattice coordinates x, y of a rectangle set) reaches, or −1. */
  function surfaceOfPoint(r: readonly (LayeredCardEdges | null)[], x: number, y: number, extra: number): number {
    for (let j = 0; j < K; j++) {
      const rect = r[j]!;
      if (rect === null) return j;
      const h = reachOf[j]! + extra, s = layeredBoxRelation(rect, x - h, y - h, x + h, y + h);
      if (s === 1) return j;
      if (s === 2) return -1;
    }
    return K - 1;
  }
  function chiefSurface(u: number, v: number): number {
    for (let j = 0; j < K; j++) {
      const rc = layers[j]!.rect;
      if (rc === null || (u >= rc.u0 && u <= rc.u1 && v >= rc.v0 && v <= rc.v1)) return j;
    }
    return K - 1;
  }
  const common = { surfaces: K, blurRadiusSites: rho, reachSites: reachOf, groupOf, groups, latticeU, latticeV, chiefSurface };
  if (planar) {
    return {
      ...common, planar: true, lensMap: undefined, frameScale: 1, lensReachSites: 0,
      framePoint(group, p, q, out): LayeredFramePoint { out.u = latticeU(group, p); out.v = latticeV(group, q); out.factor = 1; return out; },
      rasterFramePoint(u, v, out): LayeredFramePoint { out.u = u; out.v = v; out.factor = 1; return out; },
      edges: (group) => rects[group]!,
      edgesNear(group, k, _x, _y, _h, out): LayeredCardEdges { const r = rects[group]![k]!; out.set(r); return out.subarray(0, 4); },
      surfaceOf: (group, p, q) => surfaceOfPoint(rects[group]!, p, q, 0),
      siteSurface: (x, y, reach) => surfaceOfPoint(siteRects, x, y, reach)
    };
  }
  // The lens map (#744). A frame scale without a lens map scales the planar map.
  const framePointOf = lensMap ? lensMap.framePointOf : (x: number, y: number, out: LayeredFramePoint): LayeredFramePoint => { out.u = x * g; out.v = -y * g; out.factor = 1; return out; };
  const at: LayeredFramePoint = { u: 0, v: 0, factor: 1 };
  /** The frame point of continuous lattice point (x, y) of shift (fx, fy) into `at`; false where it sees no scene or lies beyond the reach. */
  function mapAt(fx: number, fy: number, x: number, y: number): boolean {
    if (!(x >= -lensReach && y >= -lensReach && x <= W - 1 + lensReach && y <= H - 1 + lensReach)) { at.factor = 0; return false; }
    framePointOf(x + 0.5 + fx - W / 2, y + 0.5 + fy - H / 2, at);
    if (at.factor === 0) return false;
    if (frameScale !== 1) { at.u /= frameScale; at.v /= frameScale; }
    if (!(Number.isFinite(at.u) && Number.isFinite(at.v) && Number.isFinite(at.factor))) fail("Layered scene: the lens map gives no finite frame point at a lattice point.");
    return true;
  }
  // The box each card's deviation is measured over: the card's reach, or the farthest any kernel tap's pupil region carries a ray
  // on it (a tap of surface k reaches pupil coordinate (R_k + ½)/|ρ_k|).
  const tapPupil = Math.max(1, ...layers.map((_, k) => (radius[k]! > 0 && rho[k] !== 0 ? (radius[k]! + 0.5) / Math.abs(rho[k]!) : 1)));
  const boxOf = layers.map((_, j) => Math.max(reachOf[j]!, Math.abs(rho[j]!) * tapPupil + 0.5));
  const sampleBox = Math.max(...boxOf.slice(0, K - 1), 0.5);
  const margin = input.marginSites ?? 0;
  if (!(margin >= 0 && Number.isFinite(margin))) fail("Layered scene: the lattice margin must be non-negative and finite.");
  const lensReach = margin + Math.max(sampleBox, ...reachOf) + 1;
  // One linearization: the map's value and Jacobian at the point.
  let u0 = 0, v0 = 0, jux = 0, juy = 0, jvx = 0, jvy = 0, linearized = 0, lfx = 0, lfy = 0, lx = 0, ly = 0;
  const S = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;
  /**
   * Linearizes the map at (x, y) of shift (fx, fy). `linearized`: 1 done; 3 no tangent at the horizon (the point or a difference
   * step sees no scene, and some sample of the box of half-size h about it does); 0 the point and that box see no scene.
   */
  function linearize(fx: number, fy: number, x: number, y: number, h: number): number {
    lfx = fx; lfy = fy; lx = x; ly = y; cornersH = NaN;
    if (!mapAt(fx, fy, x, y)) {
      for (let i = 0; i < 8; i++) if (mapAt(fx, fy, x + S[i]![0] * h, y + S[i]![1] * h)) return (linearized = 3);
      return (linearized = 0);
    }
    u0 = at.u; v0 = at.v;
    if (!gradientAt(fx, fy, x, y)) return (linearized = 3);
    jux = gux; juy = guy; jvx = gvx; jvy = gvy;
    return (linearized = 1);
  }
  /** The map's Jacobian at (x, y) by central differences, into gux … gvy; false where a step sees no scene. */
  let gux = 0, guy = 0, gvx = 0, gvy = 0;
  function gradientAt(fx: number, fy: number, x: number, y: number): boolean {
    const E = JACOBIAN_STEP;
    if (!mapAt(fx, fy, x + E, y)) return false;
    let ux = at.u, vx = at.v;
    if (!mapAt(fx, fy, x - E, y)) return false;
    ux -= at.u; vx -= at.v;
    if (!mapAt(fx, fy, x, y + E)) return false;
    let uy = at.u, vy = at.v;
    if (!mapAt(fx, fy, x, y - E)) return false;
    uy -= at.u; vy -= at.v;
    gux = ux / (2 * E); gvx = vx / (2 * E); guy = uy / (2 * E); gvy = vy / (2 * E);
    return Math.hypot(gux, guy) > 0 && Math.hypot(gvx, gvy) > 0;
  }
  /**
   * One half-plane σ·(c(Z) − level) ≥ 0 of the card (c the map's u, or v with `isV`) from the last linearization, into out[o … o + 4):
   * the tangent line of the edge c = level at its point nearest the linearization point (two Newton steps along the gradient), or
   * the tangent map's line where the edge is far (beyond twice the box) or a step sees no scene; with its deviation over the box of
   * half-size h about the linearization point (Infinity where a point of the line there sees no scene).
   */
  const e9 = new Float64Array(3), cu = new Float64Array(4), cv = new Float64Array(4);
  /** The map at the four corners of the box of half-size h about the linearization point, into cu, cv (kept per h); false if one sees no scene. */
  let cornersH = NaN, cornersOk = false;
  function cornersAt(h: number): boolean {
    if (h === cornersH) return cornersOk;
    cornersH = h; cornersOk = true;
    for (let i = 0; i < 4 && cornersOk; i++) {
      cornersOk = mapAt(lfx, lfy, lx + S[i + 4]![0] * h, ly + S[i + 4]![1] * h);
      cu[i] = at.u; cv[i] = at.v;
    }
    return cornersOk;
  }
  function halfPlane(isV: boolean, level: number, sigma: number, h: number, out: Float64Array, o: number): void {
    let value = isV ? v0 : u0, gx = isV ? jvx : jux, gy = isV ? jvy : juy, tx = lx, ty = ly;
    const n0 = Math.hypot(gx, gy);
    // A far edge (beyond twice the box by the tangent map) whose side the map at the box's four corners confirms: the tangent map's
    // line, certain (deviation 0: the edge does not reach the box).
    if (Math.abs(value - level) / n0 > 2 * h + 2 && cornersAt(h)) {
      const side = sigma * (value - level) > 0;
      let same = true;
      for (let i = 0; i < 4 && same; i++) same = sigma * ((isV ? cv[i]! : cu[i]!) - level) > 0 === side;
      if (same) {
        out[o] = sigma * gx / n0; out[o + 1] = sigma * gy / n0; out[o + 2] = sigma * (value - level - gx * lx - gy * ly) / n0; out[o + 3] = 0;
        return;
      }
    }
    if (Math.abs(value - level) / n0 <= 2 * h + 2) {
      let x = lx, y = ly, vx = value, ggx = gx, ggy = gy, ok = true;
      for (let step = 0; step < 2 && ok; step++) {
        const n2 = ggx * ggx + ggy * ggy;
        x -= (vx - level) * ggx / n2; y -= (vx - level) * ggy / n2;
        ok = mapAt(lfx, lfy, x, y);
        if (ok) { vx = isV ? at.v : at.u; ok = gradientAt(lfx, lfy, x, y); }
        if (ok) { ggx = isV ? gvx : gux; ggy = isV ? gvy : guy; }
      }
      if (ok) { value = vx; gx = ggx; gy = ggy; tx = x; ty = y; }
    }
    // σ·(value + g·(Z − T) − level) ≥ 0, normalized: a·X + b·Y + c ≥ 0.
    const n = Math.hypot(gx, gy), a = sigma * gx / n, b = sigma * gy / n, c = sigma * (value - level - gx * tx - gy * ty) / n;
    out[o] = a; out[o + 1] = b; out[o + 2] = c;
    // The deviation: the true edge's offset from the line, σ·(c(Z) − level)/|g| at points Z of the line, over the span of the box
    // about the linearization point along the line (three points, a parabola through them, its largest value on the span).
    const ax = -b, ay = a, px = tx - a * (a * tx + b * ty + c), py = ty - b * (a * tx + b * ty + c);
    const along = ax * (lx - px) + ay * (ly - py), reach = h * (Math.abs(ax) + Math.abs(ay)), s0 = along - reach, s1 = along + reach;
    for (let i = 0; i < 3; i++) {
      const t = i === 0 ? s0 : i === 1 ? (s0 + s1) / 2 : s1, zx = px + ax * t, zy = py + ay * t;
      if (!mapAt(lfx, lfy, zx, zy)) { out[o + 3] = Infinity; return; }
      const here = (isV ? at.v : at.u) - level;
      // The level difference over the map's own derivative along the normal there (a quarter-site step): the offset in sites.
      if (!mapAt(lfx, lfy, zx + a * JACOBIAN_STEP, zy + b * JACOBIAN_STEP)) { out[o + 3] = Infinity; return; }
      const slope = sigma * ((isV ? at.v : at.u) - level - here) / JACOBIAN_STEP;
      if (!(slope > 0)) { out[o + 3] = Infinity; return; }
      e9[i] = sigma * here / slope;
    }
    // e(t) through the three points (t = −1, 0, 1 on the span): its extremes at the ends or the vertex.
    const e0 = e9[0]!, em = e9[1]!, e1 = e9[2]!, curvature = (e0 + e1) / 2 - em, slope = (e1 - e0) / 2;
    let m = Math.max(Math.abs(e0), Math.abs(e1));
    if (curvature !== 0) { const v = -slope / (2 * curvature); if (Math.abs(v) < 1) m = Math.max(m, Math.abs(em + slope * v + curvature * v * v)); }
    out[o + 3] = DEVIATION_FACTOR * m;
  }
  /** Card k's half-planes from the last linearization (at (x, y), over its box), deviations over a box of half-size h, into `out`. */
  function cardFrom(k: number, h: number, out: Float64Array): Float64Array {
    const rc = layers[k]!.rect!;
    if (linearized === 0) { out.set(EMPTY); return out; }
    if (linearized === 3) { out.set(UNKNOWN); return out; }
    // u ≥ u0, u ≤ u1, v ≥ v0, v ≤ v1, each the tangent line of its edge, normalized to a unit normal.
    halfPlane(false, rc.u0, 1, h, out, 0); halfPlane(false, rc.u1, -1, h, out, 4);
    halfPlane(true, rc.v0, 1, h, out, 8); halfPlane(true, rc.v1, -1, h, out, 12);
    return out;
  }
  // The edges of the last point asked (group, p, q), kept until another point is asked (share reads them once per tap).
  const memo: (LayeredCardEdges | null)[] = layers.map((l) => (l.rect === null ? null : new Float64Array(16)));
  let memoGroup = -1, memoP = NaN, memoQ = NaN;
  function edges(group: number, p: number, q: number): readonly (LayeredCardEdges | null)[] {
    if (group === memoGroup && p === memoP && q === memoQ) return memo;
    const shift = groups[group]!;
    linearize(shift.fx, shift.fy, p, q, sampleBox);
    for (let k = 0; k < K; k++) if (memo[k] !== null) cardFrom(k, boxOf[k]!, memo[k]!);
    memoGroup = group; memoP = p; memoQ = q;
    return memo;
  }
  const siteCards: (LayeredCardEdges | null)[] = layers.map((l) => (l.rect === null ? null : new Float64Array(16)));
  return {
    ...common, planar: false, lensMap, frameScale, lensReachSites: lensReach,
    framePoint(group, p, q, out): LayeredFramePoint {
      const shift = groups[group]!;
      if (mapAt(shift.fx, shift.fy, p, q)) { out.u = at.u; out.v = at.v; out.factor = at.factor; } else { out.u = 0; out.v = 0; out.factor = 0; }
      return out;
    },
    rasterFramePoint(u, v, out): LayeredFramePoint {
      framePointOf(u / g, -v / g, out);
      if (out.factor !== 0 && frameScale !== 1) { out.u /= frameScale; out.v /= frameScale; }
      return out;
    },
    edges,
    edgesNear(group, k, x, y, h, out): LayeredCardEdges {
      const shift = groups[group]!, hs = Math.max(h, 0.0625);
      // A region whose footprint centre sees no scene ends dark on this card (the surface radiance there is 0).
      if (linearize(shift.fx, shift.fy, x, y, hs) === 0 || linearized === 3) { out.set(FULL); return out; }
      return cardFrom(k, hs, out);
    },
    surfaceOf: (group, p, q) => surfaceOfPoint(edges(group, p, q), p, q, 0),
    siteSurface(x, y, reach): number {
      linearize(0, 0, x, y, sampleBox + reach);
      for (let k = 0; k < K; k++) if (siteCards[k] !== null) cardFrom(k, boxOf[k]! + reach, siteCards[k]!);
      return surfaceOfPoint(siteCards, x, y, reach);
    }
  };
}
