// SPDX-License-Identifier: Apache-2.0

/**
 * The layered sum's geometry (2.29.0 group L0; the model is in `layered-scene-signal.ts`): the site lattice and its lattice
 * groups, the frame point of a lattice point, each card's edges near a lattice point, and the surface a lattice point sees
 * alone. Nothing here reads a scene or a spectrum.
 *
 * Coordinates.
 * - Frame units (u right, v up; the frame is 2 wide), the units of every surface's rectangle and scene. Frame units are angles,
 *   so the chief ray of a lattice point meets every surface at the same frame point.
 * - A lattice group is an opaque handle for one lattice frame: today a fractional shift (fx, fy) in [0, 1) of the native
 *   site lattice (a pixel-aperture node or an anti-aliasing spot of the expected signal); lattice point (p, q) of a group is
 *   site (p, q) shifted by (fx, fy). Groups are registered on first use and keep their index. #746 (group LM) extends the
 *   handle to (fx, fy, instant): a moving camera's instant is part of the group, so no function here takes an instant, and
 *   everything keyed by group (rectangles, tiles) is keyed by instant with it.
 * - Continuous lattice coordinates (X right, Y down) of a group: X = u/g − ½ + W/2 − fx, Y = −v/g − ½ + H/2 − fy, with
 *   g = 2 / outputWidth frame units per site. Lattice point (p, q) is at (X, Y) = (p, q). The ray through lattice point (x, y)
 *   and pupil point P (pupil-radius units, native axes) meets surface j at (x − ρ_j·Px, y − ρ_j·Py), ρ_j the surface's signed
 *   blur radius in sites.
 *
 * Interface for the later 2.29.0 groups (each change must keep this module's values bit for bit where it does not apply):
 * - {@link LayeredLatticeGeometry.framePoint}`(group, p, q, out)`: the frame point (u, v) of a lattice point and its field
 *   factor. Today the planar, rectilinear map (the facade's lattice formula, the same expressions as `latticeU` and
 *   `latticeV`) with factor 1. #744 (group LG) maps the lattice point's sensor point through the lens (inverse distortion,
 *   then the projection), takes a frame scale (1 today; #748's breathing) and sets the factor (vignetting throughput ×
 *   distortion area factor; 0 where the point sees no scene, as beyond a fisheye's 90°); #746 (group LM) applies the camera
 *   rotation of the group's instant. `latticeU`/`latticeV` stay the separable planar form for the lattice's own callers (the
 *   capture's provider does not use them: it inverts the planar formula in its own `keyOf`).
 * - {@link LayeredLatticeGeometry.edges}`(group, p, q)`: per surface (nearest first), the card's edges near lattice point (p, q)
 *   as half-planes in the group's continuous lattice coordinates, or null for the far surface. Today every card is an
 *   axis-aligned rectangle, the same at every point, given as its four half-planes X ≥ X0, Y ≥ Y0, X ≤ X1, Y ≤ Y1 in the box form
 *   [X0, Y0, X1, Y1] ({@link LayeredCardEdges}). #744 (group LG) gives each edge's tangent line at the point (a curved edge in
 *   image space) and generalizes the type; the visibility rows (`layered-visibility.ts`) and the edge sum
 *   (`layered-edge-sum.ts`) read cards only through this function, so the change stays in these two modules.
 * - {@link layeredBoxRelation}: a box against a card (outside, inside, across), closed rectangles.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/** Most lattice groups of one lattice; also the key spacing of the per-surface tiles (key = surface·this + group). */
export const LAYERED_LATTICE_GROUP_LIMIT = 4096;

/**
 * A lattice point's frame point, frame units (u right, v up), and its field factor: the surface radiance there is multiplied
 * by `factor` (1 today; 0 leaves the point dark without reading the scene).
 */
export interface LayeredFramePoint { u: number; v: number; factor: number }

/**
 * A card's edges near a lattice point, in a group's continuous lattice coordinates (X right, Y down): today the four
 * axis-aligned half-planes X ≥ X0, Y ≥ Y0, X ≤ X1, Y ≤ Y1 of its rectangle, as [X0, Y0, X1, Y1]. Read only.
 */
export type LayeredCardEdges = Float64Array;

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
}

/** The layered sum's geometry (see the module comment). */
export interface LayeredLatticeGeometry {
  /** Surfaces, nearest first. */
  readonly surfaces: number;
  /** Each surface's signed blur radius ρ in sites: the ray map's scale at its depth. */
  readonly blurRadiusSites: readonly number[];
  /** Each surface's reach: every ray of a lattice point and every kernel tap it reads lie within this many sites of it on that surface. */
  readonly reachSites: readonly number[];
  /** The lattice group (an opaque frame handle) of a fractional shift (fx, fy) in [0, 1), registered on first use (shifts within 1e-9 are one group). */
  groupOf(fx: number, fy: number): number;
  readonly groups: readonly { fx: number; fy: number }[];
  /** Frame point and field factor of lattice point (p, q) of a group, into `out` (returned). */
  framePoint(group: number, p: number, q: number, out: LayeredFramePoint): LayeredFramePoint;
  /** The planar frame u of lattice column p of a group, and v of row q (the facade's lattice formula). */
  latticeU(group: number, p: number): number;
  latticeV(group: number, q: number): number;
  /** Per surface, its card's edges near lattice point (p, q) of a group, or null for the far surface. */
  edges(group: number, p: number, q: number): readonly (LayeredCardEdges | null)[];
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

/** A box [x0, x1] × [y0, y1] against a card's edges: 0 outside, 1 inside, 2 across an edge. Closed rectangles. */
export const layeredBoxRelation = (r: LayeredCardEdges, x0: number, y0: number, x1: number, y1: number): number =>
  x1 < r[0]! || x0 > r[2]! || y1 < r[1]! || y0 > r[3]! ? 0 : x0 >= r[0]! && x1 <= r[2]! && y0 >= r[1]! && y1 <= r[3]! ? 1 : 2;

/** Internal: the geometry of a layer list (validated by the caller, `createLayeredSceneLattice`). */
export function createLayeredLatticeGeometry(input: LayeredGeometryInput): LayeredLatticeGeometry {
  const { nativeWidth: W, nativeHeight: H, layers } = input, g = 2 / input.outputWidth, K = layers.length;
  const rho = layers.map((l) => l.blurRadiusSites), radius = layers.map((l) => (l.kernel ? l.kernel.radius : 0));
  // Every ray of a lattice point and every tap it reads lie within this many sites of it on surface j (blades reach past the unit circle).
  const reachOf = layers.map((_, j) => Math.max(radius[j]! + 0.5, 1.25 * Math.abs(rho[j]!) + 0.5));
  const groups: { fx: number; fy: number }[] = [];
  /** Rectangles in each group's continuous lattice coordinates: X = u/g − ½ + W/2 − fx, Y = −v/g − ½ + H/2 − fy. */
  const rects: (LayeredCardEdges | null)[][] = [];
  const toLattice = (fx: number, fy: number): (LayeredCardEdges | null)[] => layers.map((l) => l.rect === null ? null :
    Float64Array.of(l.rect.u0 / g - 0.5 + W / 2 - fx, -l.rect.v1 / g - 0.5 + H / 2 - fy, l.rect.u1 / g - 0.5 + W / 2 - fx, -l.rect.v0 / g - 0.5 + H / 2 - fy));
  const siteRects = toLattice(0, 0);
  function groupOf(fx: number, fy: number): number {
    const at = groups.findIndex((q) => Math.abs(q.fx - fx) <= GROUP_TOLERANCE && Math.abs(q.fy - fy) <= GROUP_TOLERANCE);
    if (at >= 0) return at;
    if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) fail("Layered scene: a lattice shift must be in [0, 1).");
    if (groups.length >= LAYERED_LATTICE_GROUP_LIMIT) fail("Layered scene: too many lattice groups.");
    groups.push({ fx, fy }); rects.push(toLattice(fx, fy));
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
  return {
    surfaces: K, blurRadiusSites: rho, reachSites: reachOf, groupOf, groups, latticeU, latticeV,
    framePoint(group, p, q, out): LayeredFramePoint { out.u = latticeU(group, p); out.v = latticeV(group, q); out.factor = 1; return out; },
    edges: (group) => rects[group]!,
    surfaceOf: (group, p, q) => surfaceOfPoint(rects[group]!, p, q, 0),
    siteSurface: (x, y, reach) => surfaceOfPoint(siteRects, x, y, reach),
    chiefSurface(u, v): number {
      for (let j = 0; j < K; j++) {
        const rc = layers[j]!.rect;
        if (rc === null || (u >= rc.u0 && u <= rc.u1 && v >= rc.v0 && v <= rc.v1)) return j;
      }
      return K - 1;
    }
  };
}
