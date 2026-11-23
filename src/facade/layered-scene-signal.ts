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
 *
 * Modules (2.29.0, group L0: a split without a change of bits, pinned by test/layered-scene-seams.test.ts). Each holds one
 * part of the sum and states the interface the later layered groups extend:
 * - `layered-lattice-geometry.ts`: lattice groups, a lattice point's frame point (`framePoint`), each card's edges near a
 *   lattice point as half-planes (`edges`, axis-aligned today), the surface a point sees alone, the chief ray's surface;
 * - `layered-surface-radiance.ts`: a surface's spectral radiance at a frame point (`radiance`);
 * - `layered-visibility.ts`: the open Px intervals of a pupil row (`rowIntervals`), the rows' breaks and V_k (`share`);
 * - `layered-edge-sum.ts`: S at a lattice point (`sumAt`) over each surface's kernel groups `{ nodes, kernel }` (one today);
 * - this module: the validation, the tiles, the diffraction that follows the sum, the single-surface delegation and the display
 *   view's signal. Its exports are unchanged; the lattice gains `parts`, the four modules' objects.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES } from "../optics/site-kernel-runs.js";
import { createDisplayViewExpectedSignal, type DisplayViewExpectedSignal, type DisplayViewExpectedSignalInput, type DisplayViewQueryOffset,
  type DisplayViewScene } from "./expected-signal.js";
import type { SiteKernelFieldZones } from "./diffraction-provider.js";
import { createSpectralLatticeTiles, type SpectralLatticeTiles } from "./spectral-lattice-tiles.js";
import { LAYERED_LATTICE_GROUP_LIMIT, createLayeredLatticeGeometry, type LayeredFramePoint, type LayeredLatticeGeometry } from "./layered-lattice-geometry.js";
import { createLayeredSurfaceRadiance, type LayeredSurfaceRadiance } from "./layered-surface-radiance.js";
import { createLayeredVisibility, type LayeredVisibility } from "./layered-visibility.js";
import { createLayeredEdgeSum, layeredKernelGroups, type LayeredEdgeSum, type LayeredKernelGroup } from "./layered-edge-sum.js";

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
  /**
   * Per surface, its kernel groups (`layered-edge-sum.ts`): each covers spectral nodes [from, to), together [0, N) in order,
   * each of radius at most the layer's `kernel` radius (the geometry's reach and the edge bound are taken from that kernel).
   * Default: one group over all nodes with the layer's `kernel` (and `zones`), {@link layeredKernelGroups}. The single-surface
   * delegation (`signalInput`) does not read them.
   */
  kernelGroups?: readonly (readonly LayeredKernelGroup[])[];
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
  /** The modules the sum is built from (2.29.0, group L0), for the later groups and the module tests. */
  readonly parts: { geometry: LayeredLatticeGeometry; radiance: LayeredSurfaceRadiance; visibility: LayeredVisibility; edgeSum: LayeredEdgeSum };
}

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };
const TILE = 32;
const GROUP_TOLERANCE = 1e-9;
/** Key spacing of the per-surface tiles: key = surface·SURFACE_KEYS + group. */
const SURFACE_KEYS = LAYERED_LATTICE_GROUP_LIMIT;

/** Internal: builds the layered sum (see the module comment). Fails for an invalid layer list or a kernel that is too large. */
export function createLayeredSceneLattice(input: LayeredSceneLatticeInput): LayeredSceneLattice {
  const { nativeWidth: W, nativeHeight: H, wavelengthsNm, layers } = input, N = wavelengthsNm.length;
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
  const kernelGroups = input.kernelGroups ?? layeredKernelGroups(layers, W, H, N);
  if (kernelGroups.length !== K || kernelGroups.some((groups, k) => groups.length < 1 || groups.some((g, i) => g.nodes.from !== (i === 0 ? 0 : groups[i - 1]!.nodes.to) ||
    !(g.nodes.to > g.nodes.from) || !Number.isInteger(g.kernel.radius) || g.kernel.radius < 0 || g.kernel.radius > (layers[k]!.kernel ? layers[k]!.kernel!.radius : 0)) ||
    groups[groups.length - 1]!.nodes.to !== N)) fail("Layered scene: each surface's kernel groups must cover the spectral nodes in order, each within the surface's kernel radius.");
  const geometry = createLayeredLatticeGeometry(input), radiance = createLayeredSurfaceRadiance(input);
  const capacity = input.capacityBytes ?? 64 * 1024 * 1024;
  // Surface radiance at the nodes per lattice point (key: surface, group).
  const point: LayeredFramePoint = { u: 0, v: 0 };
  const surfaceTiles = createSpectralLatticeTiles({ tile: TILE, nodes: N, capacityBytes: Math.max(capacity / 2, TILE * TILE * N * 8 + TILE), fill(key, x0, y0, width, height, out) {
    const k = Math.floor(key / SURFACE_KEYS), group = key - k * SURFACE_KEYS;
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) radiance.radiance(k, geometry.framePoint(group, x0 + i, y0 + j, point), out, (j * width + i) * N);
  } });
  const floorDiv = (a: number): number => Math.floor(a / TILE);
  /** Surface k's radiance at lattice point (p, q) of a group: the tile array and the offset of its first node. */
  let lastSurfaceKey = -1, lastSTX = 0, lastSTY = 0;
  const surfaces = { tile: new Float64Array(0) as Float64Array, at(k: number, group: number, p: number, q: number): number {
    const key = k * SURFACE_KEYS + group, tx = floorDiv(p), ty = floorDiv(q);
    if (key !== lastSurfaceKey || tx !== lastSTX || ty !== lastSTY) {
      surfaces.tile = surfaceTiles.rows(key, tx, ty, 0, TILE); lastSurfaceKey = key; lastSTX = tx; lastSTY = ty;
    }
    return ((q - ty * TILE) * TILE + p - tx * TILE) * N;
  } };
  const visibility = createLayeredVisibility({ geometry, occlusionSamples: samples });
  const edgeSum = createLayeredEdgeSum({ geometry, visibility, surfaces, kernelGroups, nodes: N });
  const sumTiles = createSpectralLatticeTiles({ tile: TILE, nodes: N, capacityBytes: Math.max(capacity / 2, TILE * TILE * N * 8 + TILE), fill(group, x0, y0, width, height, out) {
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) edgeSum.sumAt(group, x0 + i, y0 + j, out, (j * width + i) * N);
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
    nodes: N, groupOf: geometry.groupOf, groups: geometry.groups, spectrumAt, latticeU: geometry.latticeU, latticeV: geometry.latticeV,
    surfaceOf: geometry.surfaceOf, siteSurface: geometry.siteSurface,
    chiefSurface(u, v): { surface: number; material: number } {
      const surface = geometry.chiefSurface(u, v);
      return { surface, material: radiance.material(surface, { u, v }) };
    },
    get lookups(): number { return radiance.lookups; },
    get edgePoints(): number { return edgeSum.edgePoints; },
    tiles: { surfaces: surfaceTiles, sum: sumTiles },
    parts: { geometry, radiance, visibility, edgeSum }
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
