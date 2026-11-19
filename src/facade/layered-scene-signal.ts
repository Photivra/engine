// SPDX-License-Identifier: Apache-2.0

/**
 * The layered sum of #652 (layered chart scenes): the spectral radiance each site lattice point receives from several
 * opaque, fronto-parallel surfaces at different depths seen through a thin lens, with occlusion in both directions, and the
 * display view's expected signal built on it. The capture's provider (`layered-scene-provider.ts`) reads the same lattice
 * values, so capture and view form the same sum.
 *
 * Model (geometric optics, a thin lens focused at s; distributed ray tracing's thin-lens camera: Cook, Porter and Carpenter,
 * "Distributed ray tracing", SIGGRAPH 1984; Pharr, Jakob and Humphreys, Physically Based Rendering, 4th ed., §5.2.3, free
 * online; survey: Barsky and Kosloff, "Algorithms for rendering depth of field effects in computer graphics", 2008). The ray
 * through image point p and pupil point P (pupil-radius units, native axes) meets the surface at depth d at p − ρ_d·P on the
 * site lattice, with ρ_d = σ·c_d/2 the signed blur radius (c_d = f²·|s − d|/(N·d·(s − f)), `calculateDefocusCircle`, in sites;
 * σ = +1 behind the focus plane, −1 in front of it): frame units are angles, so the chief ray's point is the same lattice point
 * at every depth. The irradiance at p is the mean over the pupil of the radiance of the first surface each ray meets.
 *
 * Evaluation on the lattice. Surface k's defocus kernel D_k (the disc of `createDefocusDiscSiteKernel`, a shaped kernel, or a
 * cat's-eye zone's kernel: the PSF on the site lattice, light from s landing at s + t with weight D_k(t)) stands for the pupil:
 * tap t is the pupil region P ∈ cell(t)/ρ_k (the whole pupil for a kernel of radius 0). The spectral radiance at lattice point p is
 *   S(p)[n] = Σ_k Σ_t D_k(t)·V_k(p, t)·L_k(p − t)[n],
 * with V_k(p, t) the share of tap t's pupil region whose rays hit surface k (inside its rectangle; the far surface has none)
 * and pass every nearer card (a rectangle test per card, since cards are axis-aligned rectangles). V is 0 or 1 when the
 * region's ray boxes are inside or outside the rectangles. Otherwise the region is integrated in rows of Py: along a row the
 * open part is exact (the pupil's chord, minus or within each rectangle's interval in Px, since each card edge is a line of
 * constant Px or Py in the pupil); the rows are split at every card edge's Py, so within a segment only the chord changes, and
 * there are n rows per site of the widest footprint the region's rays have on a card they cross, at least n per region
 * (n = `occlusionSamples`: 4 fast, 16 full; midpoints, each row weighted by its height). The fast and full counts differ by more
 * than the equivalence tolerance, so both are kept (the 2.27.0 plan's owner decision 4). The ray map is the aberration-free
 * linear one at every surface (with a shaped kernel, V is the share of the disc's rays in the tap's region).
 *
 * - A lattice point whose rays all reach one surface (no card edge within any surface's blur, `surfaceOf`) has V = 1 on that
 *   surface and 0 elsewhere: S is that surface's single-plane sum. A site whose lattice points all see one surface takes that
 *   surface's existing single-plane path (`createDisplayViewExpectedSignal` of its `signalInput`), so a scene of one surface is
 *   today's render bit for bit; other sites ("edge sites") take the sum above.
 * - Sites read S on each lattice group (a fractional query offset) as the expected signal does: μ_c(x) = Σ_o w_o Σ_n A_c(λ_n)·
 *   Σ_s K_n(s)·S(x + o − s)[n], with K_n each node's diffraction kernel (a unit tap without diffraction), the "diffraction
 *   convolved with the disc" approximation of the single-plane path applied per layer.
 *
 * Caches (rule 1 of the 2.27.0 plan). Spectral lattice tiles (`spectral-lattice-tiles.ts`) hold, per surface and lattice group,
 * each lattice point's spectral radiance L_k at the nodes, and per lattice group S at the nodes: spectra at lattice points,
 * never a channel response summed over the spectrum, nothing keyed by material or level. Every site integrates its spectra
 * against its own channel response when it is read. Every value depends only on its lattice point, so regions and parts
 * equal the whole view bit for bit and tiles dropped and recomputed have the same bits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES } from "../optics/site-kernel-runs.js";
import { createDisplayViewExpectedSignal, type DisplayViewExpectedSignal, type DisplayViewExpectedSignalInput, type DisplayViewQueryOffset,
  type DisplayViewScene } from "./expected-signal.js";
import type { SiteKernelFieldZones } from "./diffraction-provider.js";
import { createSpectralLatticeTiles, type SpectralLatticeTiles } from "./spectral-lattice-tiles.js";

/** Occlusion rows per site of a pupil region's widest footprint: the fast and full methods (registry entry `scene.layers/occlusion-samples`). */
export const LAYERED_OCCLUSION_SAMPLES = /* @__PURE__ */ Object.freeze({ fast: 4, full: 16 });
/** Largest defocus kernel radius of a surface in a scene of more than one surface (edge sites sum it directly). */
export const LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES = DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES;

/** One surface of the sum, nearest first. */
export interface LayeredSceneLayer {
  /** The surface's rectangle in frame units (u right, v up); null for the far surface (the last), which has no edge. */
  rect: { u0: number; v0: number; u1: number; v1: number } | null;
  /** Signed blur radius ρ = σ·c/2 in sites (+ behind the focus plane): the ray map's scale at this depth. */
  blurRadiusSites: number;
  /** The surface's scene at the spectral nodes, in frame units (its print continues beyond its rectangle). */
  scene: DisplayViewScene;
  /** Its defocus kernel on the site lattice, (2R + 1)² row-major weights (the PSF), or null in focus (a unit tap). */
  kernel: { radius: number; weights: Float64Array } | null;
  /** The cat's eye: field zones whose kernels (radius `kernel.radius`) replace `kernel` per lattice point. */
  zones?: SiteKernelFieldZones;
  /**
   * The surface's single-plane expected-signal input (its scene, each node's diffraction kernel convolved with its disc, or
   * unit taps in focus: always with `kernels`, so it reads the lattice formula), for the sites that see this surface only.
   * Omitted (or with `zones`): those sites take the layered sum too.
   */
  signalInput?: DisplayViewExpectedSignalInput;
}

export interface LayeredSceneLatticeInput {
  nativeWidth: number;
  nativeHeight: number;
  /** Frame output width: g = 2 / outputWidth frame units per site. */
  outputWidth: number;
  wavelengthsNm: readonly number[];
  layers: readonly LayeredSceneLayer[];
  /** Each node's in-focus diffraction kernel, (2R + 1)² row-major; omitted without diffraction. */
  diffraction?: { radius: number; perNode: readonly Float64Array[] };
  /** Occlusion rows per site of footprint ({@link LAYERED_OCCLUSION_SAMPLES}), 1 to 32. */
  occlusionSamples: number;
  /** Bytes the spectral tiles may hold in all. Default 64 MiB. */
  capacityBytes?: number;
}

/** The layered sum on the site lattice, shared by the view's signal and the capture's provider. */
export interface LayeredSceneLattice {
  readonly nodes: number;
  /** The lattice group of a fractional shift (fx, fy) in [0, 1), registered on first use. */
  groupOf(fx: number, fy: number): number;
  readonly groups: readonly { fx: number; fy: number }[];
  /**
   * The spectral radiance reaching lattice point (p, q) of a group, after each node's diffraction kernel: Σ_s K_n(s)·S(p − s)[n]
   * at each node, into `out`. The same bits for the same point, whatever was read before.
   */
  spectrumAt(group: number, p: number, q: number, out: Float64Array): void;
  /**
   * The surface every lattice point within `reach` sites of the native site (x, y) sees alone, or −1 when some of them see a
   * card edge (conservative: −1 can also mean one surface).
   */
  siteSurface(x: number, y: number, reach: number): number;
  /** The surface whose rays reach lattice point (p, q) of a group alone, or −1 at an edge. */
  surfaceOf(group: number, p: number, q: number): number;
  /** Frame point of lattice point (p, q) of a group (the facade's lattice formula). */
  latticeU(group: number, p: number): number;
  latticeV(group: number, q: number): number;
  /** The first surface along the chief ray of frame point (u, v), and its material there (or −1 for a radiance scene). */
  chiefSurface(u: number, v: number): { surface: number; material: number };
  /** Scene lookups so far (material lookups, or radiance lookups per node). */
  readonly lookups: number;
  /** Lattice points whose S was computed as an edge point (diagnostics). */
  readonly edgePoints: number;
  readonly tiles: { surfaces: SpectralLatticeTiles; sum: SpectralLatticeTiles };
}

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };
const TILE = 32;
const GROUP_TOLERANCE = 1e-9;
/** Key spacing of the per-surface tiles: key = surface·SURFACE_KEYS + group. */
const SURFACE_KEYS = 4096;
/** Most occlusion rows of one pupil region. */
const MAXIMUM_SAMPLES_PER_AXIS = 1024;

/** Internal: builds the layered sum (see the module comment). Fails for an invalid layer list or a kernel that is too large. */
export function createLayeredSceneLattice(input: LayeredSceneLatticeInput): LayeredSceneLattice {
  const { nativeWidth: W, nativeHeight: H, wavelengthsNm, layers } = input, g = 2 / input.outputWidth, N = wavelengthsNm.length;
  if (!(Number.isInteger(W) && W > 0 && Number.isInteger(H) && H > 0 && input.outputWidth > 0)) fail("Layered scene: invalid raster.");
  if (!Array.isArray(layers) || layers.length < 1) fail("Layered scene: at least one surface is required.");
  const K = layers.length;
  layers.forEach((layer, k) => {
    if ((layer.rect === null) !== (k === K - 1)) fail("Layered scene: the last surface, and only it, is the far surface (rect null).");
    if (!Number.isFinite(layer.blurRadiusSites)) fail("Layered scene: blur radii must be finite.");
    const R = layer.kernel ? layer.kernel.radius : 0;
    if (layer.kernel && layer.kernel.weights.length !== (2 * R + 1) ** 2) fail("Layered scene: a kernel must have (2R + 1)² taps.");
    if (K > 1 && R > LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES)
      fail("Layered scene: a surface's blur needs a kernel radius of " + R + " sites; at card edges the layered sum takes at most " +
        LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES + ". Reduce the defocus or the f-number's aperture.");
    if (layer.zones && !layer.kernel) fail("Layered scene: field zones need the surface's axis kernel (its radius).");
    if (layer.scene.kind === "materials" && layer.scene.whiteRadiance.length !== N) fail("Layered scene: white radiance must match the spectral nodes.");
  });
  const samples = input.occlusionSamples;
  if (!Number.isInteger(samples) || samples < 1 || samples > 32) fail("Layered scene: occlusionSamples must be an integer from 1 to 32.");
  const diffraction = input.diffraction, Rd = diffraction ? diffraction.radius : 0;
  if (diffraction && (diffraction.perNode.length !== N || diffraction.perNode.some((k) => k.length !== (2 * Rd + 1) ** 2))) fail("Layered scene: one diffraction kernel per node, (2R + 1)² taps.");
  // Per surface: material spectra at the nodes (copies, as the expected signal's tables), ray-map scale and footprint half-size.
  const spectra = layers.map((layer): Float64Array[] => {
    const scene = layer.scene;
    if (scene.kind !== "materials") return [];
    const white = scene.whiteRadiance;
    return scene.materials.map((m: { neutral: number } | { radiance: Float64Array }): Float64Array => {
      if (!("neutral" in m)) return Float64Array.from(m.radiance);
      const out = new Float64Array(white.length);
      for (let n = 0; n < white.length; n++) out[n] = m.neutral * white[n]!;
      return out;
    });
  });
  const rho = layers.map((l) => l.blurRadiusSites), radius = layers.map((l) => (l.kernel ? l.kernel.radius : 0));
  // Every ray of a lattice point and every tap it reads lie within this many sites of it on surface j (blades reach past the unit circle).
  const reachOf = layers.map((_, j) => Math.max(radius[j]! + 0.5, 1.25 * Math.abs(rho[j]!) + 0.5));
  const groups: { fx: number; fy: number }[] = [];
  /** Rectangles in each group's continuous lattice coordinates: X = u/g − ½ + W/2 − fx, Y = −v/g − ½ + H/2 − fy. */
  const rects: (Float64Array | null)[][] = [];
  const toLattice = (fx: number, fy: number): (Float64Array | null)[] => layers.map((l) => l.rect === null ? null :
    Float64Array.of(l.rect.u0 / g - 0.5 + W / 2 - fx, -l.rect.v1 / g - 0.5 + H / 2 - fy, l.rect.u1 / g - 0.5 + W / 2 - fx, -l.rect.v0 / g - 0.5 + H / 2 - fy));
  const siteRects = toLattice(0, 0);
  function groupOf(fx: number, fy: number): number {
    const at = groups.findIndex((q) => Math.abs(q.fx - fx) <= GROUP_TOLERANCE && Math.abs(q.fy - fy) <= GROUP_TOLERANCE);
    if (at >= 0) return at;
    if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) fail("Layered scene: a lattice shift must be in [0, 1).");
    if (groups.length >= SURFACE_KEYS) fail("Layered scene: too many lattice groups.");
    groups.push({ fx, fy }); rects.push(toLattice(fx, fy));
    return groups.length - 1;
  }
  // The facade's lattice formula (expected-signal.ts, diffraction-provider.ts), the same expressions.
  const latticeU = (group: number, p: number): number => { const fx = groups[group]!.fx; return fx === 0 ? (p + 0.5 - W / 2) * g : (p + 0.5 + fx - W / 2) * g; };
  const latticeV = (group: number, q: number): number => { const fy = groups[group]!.fy; return fy === 0 ? -(q + 0.5 - H / 2) * g : -(q + 0.5 + fy - H / 2) * g; };
  let lookups = 0, edgePoints = 0;
  const capacity = input.capacityBytes ?? 64 * 1024 * 1024;
  // Surface radiance at the nodes per lattice point (key: surface, group).
  const surfaceTiles = createSpectralLatticeTiles({ tile: TILE, nodes: N, capacityBytes: Math.max(capacity / 2, TILE * TILE * N * 8 + TILE), fill(key, x0, y0, width, height, out) {
    const k = Math.floor(key / SURFACE_KEYS), group = key - k * SURFACE_KEYS, scene = layers[k]!.scene;
    for (let j = 0; j < height; j++) {
      const v = latticeV(group, y0 + j);
      for (let i = 0; i < width; i++) {
        const u = latticeU(group, x0 + i), at = (j * width + i) * N;
        if (scene.kind === "materials") {
          const L = spectra[k]![scene.materialAt(u, v)];
          if (L === undefined) fail("Unknown chart material.");
          out.set(L!, at); lookups++;
        } else { for (let n = 0; n < N; n++) out[at + n] = scene.radianceAt(u, v, wavelengthsNm[n]!); lookups += N; }
      }
    }
  } });
  const floorDiv = (a: number): number => Math.floor(a / TILE);
  /** Surface k's radiance at lattice point (p, q) of a group: the tile array and the offset of its first node. */
  let lastSurfaceKey = -1, lastSTX = 0, lastSTY = 0, lastSurfaceTile: Float64Array = new Float64Array(0);
  function surfaceAt(k: number, group: number, p: number, q: number): number {
    const key = k * SURFACE_KEYS + group, tx = floorDiv(p), ty = floorDiv(q);
    if (key !== lastSurfaceKey || tx !== lastSTX || ty !== lastSTY) {
      lastSurfaceTile = surfaceTiles.rows(key, tx, ty, 0, TILE); lastSurfaceKey = key; lastSTX = tx; lastSTY = ty;
    }
    return ((q - ty * TILE) * TILE + p - tx * TILE) * N;
  }
  /** 0: the box is outside the rectangle, 1: inside it, 2: across its edge. Closed rectangles. */
  const relation = (r: Float64Array, x0: number, y0: number, x1: number, y1: number): number =>
    x1 < r[0]! || x0 > r[2]! || y1 < r[1]! || y0 > r[3]! ? 0 : x0 >= r[0]! && x1 <= r[2]! && y0 >= r[1]! && y1 <= r[3]! ? 1 : 2;
  /** The one surface every ray and tap of a point (lattice coordinates x, y of a rectangle set) reaches, or −1. */
  function surfaceOfPoint(r: (Float64Array | null)[], x: number, y: number, extra: number): number {
    for (let j = 0; j < K; j++) {
      const rect = r[j]!;
      if (rect === null) return j;
      const h = reachOf[j]! + extra, s = relation(rect, x - h, y - h, x + h, y + h);
      if (s === 1) return j;
      if (s === 2) return -1;
    }
    return K - 1;
  }
  const kernelWeights = (k: number, p: number, q: number): Float64Array | null => {
    const layer = layers[k]!;
    if (!layer.kernel) return null;
    if (!layer.zones) return layer.kernel.weights;
    const z = layer.zones, zx = Math.min(z.columns - 1, Math.floor(Math.min(W - 1, Math.max(0, p)) / z.size)),
      zy = Math.min(z.rows - 1, Math.floor(Math.min(H - 1, Math.max(0, q)) / z.size));
    return zoneKernel(k, zy * z.columns + zx);
  };
  const zoneCache = new Map<number, Float64Array>();
  function zoneKernel(k: number, zone: number): Float64Array {
    const key = k * 65536 + zone;
    let w = zoneCache.get(key);
    if (!w) {
      w = layers[k]!.zones!.kernelOf(zone);
      if (w.length !== layers[k]!.kernel!.weights.length) fail("Layered scene: a zone kernel must have the surface's kernel radius.");
      zoneCache.set(key, w);
      if (zoneCache.size > 256) zoneCache.delete(zoneCache.keys().next().value!);
    }
    return w;
  }
  /**
   * V_k(p, t): the share of tap t's pupil region (P-box [a0, a1] × [b0, b1]) whose rays at (x, y) hit surface k and pass the
   * nearer cards. Rays meet surface j at (x − ρ_j·Px, y − ρ_j·Py).
   */
  function visibility(r: (Float64Array | null)[], k: number, x: number, y: number, a0: number, a1: number, b0: number, b1: number): number {
    // The widest footprint, in sites, of the region's rays on a rectangle they cross.
    let across = 0;
    const span = Math.max(a1 - a0, b1 - b0);
    for (let j = 0; j <= k; j++) {
      const rect = r[j]!;
      if (rect === null) continue;
      const s = rho[j]!, xa = x - s * a0, xb = x - s * a1, ya = y - s * b0, yb = y - s * b1;
      const rel = relation(rect, Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb));
      if (j === k ? rel === 0 : rel === 1) return 0;
      if (rel === 2) across = Math.max(across, Math.abs(s) * span, 1e-300);
    }
    if (across === 0) return 1;
    // n rows per site of that footprint (n = occlusionSamples), at least n per region.
    const m = Math.min(MAXIMUM_SAMPLES_PER_AXIS, samples * Math.max(1, Math.ceil(across - 1e-9)));
    // Rows of the region: along each row the open part is exact (the pupil's chord and each rectangle's interval in Px). The rows
    // are split at every rectangle's edge in Py, so within a segment only the chord changes, and rows are spread over the
    // segments by length (midpoints, each row weighted by its height).
    let breaks = 0;
    rowBreaks[breaks++] = b0; rowBreaks[breaks++] = b1;
    for (let j = 0; j <= k; j++) {
      const rect = r[j]!, s = rho[j]!;
      if (rect === null || s === 0) continue;
      for (const e of [(y - rect[1]!) / s, (y - rect[3]!) / s]) if (e > b0 && e < b1) rowBreaks[breaks++] = e;
    }
    const cuts = rowBreaks.subarray(0, breaks).sort();
    let kept = 0, visible = 0;
    for (let pass = 0; pass < 2 && !(kept > 0); pass++) for (let segment = 0; segment + 1 < breaks; segment++) {
      const c0 = cuts[segment]!, c1 = cuts[segment + 1]!;
      if (!(c1 > c0)) continue;
      const rows = Math.max(1, Math.round(m * (c1 - c0) / (b1 - b0))), h = (c1 - c0) / rows;
      for (let sj = 0; sj < rows; sj++) {
        const py = c0 + (sj + 0.5) * h;
        let lo = a0, hi = a1;
        if (pass === 0) {
          const w2 = 1 - py * py;
          if (!(w2 > 0)) continue;
          const w = Math.sqrt(w2);
          lo = Math.max(lo, -w); hi = Math.min(hi, w);
        }
        if (!(hi > lo)) continue;
        kept += h * (hi - lo);
        // The own rectangle: X0 ≤ x − ρ_k·Px ≤ X1 and Y0 ≤ y − ρ_k·Py ≤ Y1.
        const own = r[k]!;
        if (own !== null && !intervalOf(own, rho[k]!, x, y, py)) continue;
        if (own !== null) { lo = Math.max(lo, spanLo); hi = Math.min(hi, spanHi); if (!(hi > lo)) continue; }
        // Nearer cards remove their intervals: merge them (sorted by start) and keep what is left of [lo, hi].
        let count = 0;
        for (let j = 0; j < k; j++) if (intervalOf(r[j]!, rho[j]!, x, y, py) && spanHi > lo && spanLo < hi) { cutLo[count] = spanLo; cutHi[count] = spanHi; count++; }
        let open = hi - lo;
        if (count > 0) {
          for (let a = 1; a < count; a++) for (let b = a; b > 0 && cutLo[b - 1]! > cutLo[b]!; b--) {
            const tl = cutLo[b]!, th = cutHi[b]!; cutLo[b] = cutLo[b - 1]!; cutHi[b] = cutHi[b - 1]!; cutLo[b - 1] = tl; cutHi[b - 1] = th;
          }
          let at = lo;
          for (let c = 0; c < count; c++) {
            const cl = Math.max(cutLo[c]!, at), ch = Math.min(cutHi[c]!, hi);
            if (ch > cl) { open -= ch - cl; at = ch; }
          }
        }
        visible += h * open;
      }
    }
    return kept > 0 ? Math.min(1, Math.max(0, visible / kept)) : 0;
  }
  /** The Px interval [spanLo, spanHi] of row Py whose rays meet rectangle `rect` at scale s; false when the row misses it. */
  let spanLo = 0, spanHi = 0;
  const cutLo = new Float64Array(K), cutHi = new Float64Array(K), rowBreaks = new Float64Array(2 * K + 2);
  function intervalOf(rect: Float64Array, s: number, x: number, y: number, py: number): boolean {
    const ry = y - s * py;
    if (!(ry >= rect[1]! && ry <= rect[3]!)) return false;
    if (s === 0) { if (!(x >= rect[0]! && x <= rect[2]!)) return false; spanLo = -Infinity; spanHi = Infinity; return true; }
    const e0 = (x - rect[0]!) / s, e1 = (x - rect[2]!) / s;
    spanLo = Math.min(e0, e1); spanHi = Math.max(e0, e1);
    return true;
  }
  /** S at lattice point (p, q) of a group into out (zeroed): the layered sum, or one surface's sum away from edges. */
  function sumAt(group: number, p: number, q: number, out: Float64Array, at: number): void {
    const r = rects[group]!, x = p, y = q, single = surfaceOfPoint(r, x, y, 0);
    if (single < 0) edgePoints++;
    for (let k = single < 0 ? 0 : single; k < (single < 0 ? K : single + 1); k++) {
      const rect = r[k]!;
      if (single < 0 && rect !== null && relation(rect, x - reachOf[k]!, y - reachOf[k]!, x + reachOf[k]!, y + reachOf[k]!) === 0) continue;
      const weights = kernelWeights(k, p, q), R = weights ? radius[k]! : 0, s = rho[k]!;
      for (let tv = -R, t = 0; tv <= R; tv++) for (let tu = -R; tu <= R; tu++, t++) {
        const w = weights ? weights[t]! : 1;
        if (w === 0) continue;
        let f = w;
        if (single < 0) {
          let a0 = -1, a1 = 1, b0 = -1, b1 = 1;
          if (R > 0 && s !== 0) { a0 = (tu - 0.5) / s; a1 = (tu + 0.5) / s; b0 = (tv - 0.5) / s; b1 = (tv + 0.5) / s; if (s < 0) { [a0, a1] = [a1, a0]; [b0, b1] = [b1, b0]; } }
          const vis = visibility(r, k, x, y, a0, a1, b0, b1);
          if (vis === 0) continue;
          f = w * vis;
        }
        const o = surfaceAt(k, group, p - tu, q - tv), L = lastSurfaceTile;
        for (let n = 0; n < N; n++) out[at + n] = out[at + n]! + f * L[o + n]!;
      }
      // Every ray of this point reaches surface k or a nearer one: farther surfaces add nothing.
      if (single < 0 && rect !== null && relation(rect, x - reachOf[k]!, y - reachOf[k]!, x + reachOf[k]!, y + reachOf[k]!) === 1) break;
    }
  }
  const sumTiles = createSpectralLatticeTiles({ tile: TILE, nodes: N, capacityBytes: Math.max(capacity / 2, TILE * TILE * N * 8 + TILE), fill(group, x0, y0, width, height, out) {
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) sumAt(group, x0 + i, y0 + j, out, (j * width + i) * N);
  } });
  function spectrumAt(group: number, p: number, q: number, out: Float64Array): void {
    if (!diffraction) {
      const tx = floorDiv(p), ty = floorDiv(q), row = q - ty * TILE, tile = sumTiles.rows(group, tx, ty, row, row + 1), o = (row * TILE + p - tx * TILE) * N;
      for (let n = 0; n < N; n++) out[n] = tile[o + n]!;
      return;
    }
    out.fill(0);
    for (let sv = -Rd, s = 0; sv <= Rd; sv++) {
      const qq = q - sv, ty = floorDiv(qq), row = qq - ty * TILE;
      for (let su = -Rd; su <= Rd; su++, s++) {
        const pp = p - su, tx = floorDiv(pp), tile = sumTiles.rows(group, tx, ty, row, row + 1), o = (row * TILE + pp - tx * TILE) * N;
        for (let n = 0; n < N; n++) out[n] = out[n]! + diffraction.perNode[n]![s]! * tile[o + n]!;
      }
    }
  }
  return {
    nodes: N, groupOf, groups, spectrumAt, latticeU, latticeV,
    surfaceOf: (group, p, q) => surfaceOfPoint(rects[group]!, p, q, 0),
    siteSurface: (x, y, reach) => surfaceOfPoint(siteRects, x, y, reach),
    chiefSurface(u, v): { surface: number; material: number } {
      for (let j = 0; j < K; j++) {
        const rc = layers[j]!.rect;
        if (rc === null || (u >= rc.u0 && u <= rc.u1 && v >= rc.v0 && v <= rc.v1)) {
          const scene = layers[j]!.scene;
          return { surface: j, material: scene.kind === "materials" ? scene.materialAt(u, v) : -1 };
        }
      }
      return { surface: K - 1, material: -1 };
    },
    get lookups(): number { return lookups; },
    get edgePoints(): number { return edgePoints; },
    tiles: { surfaces: surfaceTiles, sum: sumTiles }
  };
}

export interface LayeredSceneSignalInput extends LayeredSceneLatticeInput {
  /** Query offsets of each site (pixel-aperture nodes and anti-aliasing spots) and weights, as the expected signal takes them. */
  offsets: readonly DisplayViewQueryOffset[];
  /** Per CFA channel, expected electrons per unit spectral radiance at each node. */
  electronsPerRadiance: readonly [Float64Array, Float64Array, Float64Array];
  channelAt(x: number, y: number): number;
}

/** Largest cache window of the signal, in sites; larger windows are not cached. */
const SITE_CACHE_LIMIT = 1 << 22;

/**
 * Internal: the display view's expected signal of a layered scene (see the module comment): per site, the single-plane path of
 * the one surface its lattice points see, or the layered sum. `lattice` may be shared with a capture provider of the same input.
 */
export function createLayeredSceneSignal(input: LayeredSceneSignalInput, lattice: LayeredSceneLattice = createLayeredSceneLattice(input)): DisplayViewExpectedSignal & {
  readonly edgeSites: number; readonly delegatedSites: number; readonly lattice: LayeredSceneLattice } {
  const { offsets, electronsPerRadiance: A, channelAt, layers } = input, N = input.wavelengthsNm.length;
  // Offsets grouped by fractional shift, as the expected signal groups them (buildTables).
  const frac = (v: number): number => { const f = v - Math.floor(v); return f > 1 - GROUP_TOLERANCE || f < GROUP_TOLERANCE ? 0 : f; };
  const members: { group: number; ix: number; iy: number; weight: number }[] = [];
  let reach = input.diffraction ? input.diffraction.radius : 0;
  for (const o of offsets) {
    const fx = frac(o.x), fy = frac(o.y), ix = Math.round(o.x - fx), iy = Math.round(o.y - fy);
    members.push({ group: lattice.groupOf(fx, fy), ix, iy, weight: o.weight });
    reach = Math.max(reach, Math.abs(ix) + 1 + (input.diffraction ? input.diffraction.radius : 0), Math.abs(iy) + 1 + (input.diffraction ? input.diffraction.radius : 0));
  }
  // Members in the expected signal's order: by group, then as listed.
  members.sort((a, b) => a.group - b.group);
  const delegates: (DisplayViewExpectedSignal | undefined)[] = layers.map(() => undefined);
  const delegateWindow: (boolean)[] = layers.map(() => false);
  layers.forEach((l) => { if (l.signalInput && !l.signalInput.kernels) fail("Layered scene: a surface's single-plane input must carry kernels (the lattice formula)."); });
  let window = { x0: 0, y0: 0, x1: 0, y1: 0 }, cache = new Float64Array(0), cacheWidth = 0, edgeSites = 0, delegatedSites = 0;
  const spectrum = new Float64Array(N);
  function delegate(k: number): DisplayViewExpectedSignal | undefined {
    const l = layers[k]!;
    if (!l.signalInput || l.zones) return undefined;
    let d = delegates[k];
    if (!d) d = delegates[k] = createDisplayViewExpectedSignal(l.signalInput);
    if (!delegateWindow[k]) { d.window(window.x0, window.y0, window.x1, window.y1); delegateWindow[k] = true; }
    return d;
  }
  function compute(x: number, y: number): number {
    const k = lattice.siteSurface(x, y, reach), d = k >= 0 ? delegate(k) : undefined;
    if (d) { delegatedSites++; return d.site(x, y); }
    edgeSites++;
    const a = A[channelAt(x, y)]!;
    let sum = 0;
    for (const m of members) {
      lattice.spectrumAt(m.group, x + m.ix, y + m.iy, spectrum);
      let v = 0;
      for (let n = 0; n < N; n++) v += a[n]! * spectrum[n]!;
      sum += m.weight * v;
    }
    return sum;
  }
  return {
    window(x0, y0, x1, y1): void {
      window = { x0, y0, x1, y1 };
      delegateWindow.fill(false);
      const size = (x1 - x0) * (y1 - y0);
      cacheWidth = x1 - x0;
      cache = size > 0 && size <= SITE_CACHE_LIMIT ? new Float64Array(size).fill(NaN) : new Float64Array(0);
    },
    site(x, y): number {
      const i = x - window.x0, j = y - window.y0, cached = cache.length > 0 && i >= 0 && j >= 0 && x < window.x1 && y < window.y1;
      if (cached) { const v = cache[j * cacheWidth + i]!; if (!Number.isNaN(v)) return v; }
      const v = compute(x, y);
      if (cached) cache[j * cacheWidth + i] = v;
      return v;
    },
    pilot(u, v): number {
      const chief = lattice.chiefSurface(u, v), scene = layers[chief.surface]!.scene;
      return chief.material >= 0 ? chief.surface * 65536 + chief.material : chief.surface * 65536 + (scene.kind === "radiance" ? scene.radianceAt(u, v, input.wavelengthsNm[0]!) : 0);
    },
    get lookups(): number { return lattice.lookups + delegates.reduce((s, d) => s + (d ? d.lookups : 0), 0); },
    uniformMaterial: -1,
    tracksMaterial: false,
    get cachesSites(): boolean { return cache.length > 0; },
    marksReads: false,
    markReads(): void { fail("Layered scene: markReads is not available."); },
    get edgeSites(): number { return edgeSites; },
    get delegatedSites(): number { return delegatedSites; },
    lattice
  };
}
