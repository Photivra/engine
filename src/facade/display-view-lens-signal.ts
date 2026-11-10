// SPDX-License-Identifier: Apache-2.0

/**
 * The display view's expected signal with a lens field mapping (`lens.projection`, `lens.distortion`), `lens.vignetting` or
 * camera rotation (#563), in focus and with `lens.defocus` out of focus. Loaded on demand (a dynamic import in `runCapture`),
 * so a display view without these options, and a bundle that never asks for them, does not load it.
 *
 * What it computes. The capture's environment chain forms, for site (i, j) of CFA channel c,
 *   μ_c(i, j) = Σ_o w_o · (1/T) Σ_t Σ_λ A_c(λ) Σ_k K_λ(k) · F(s) · L(D_t(s), λ),   s = q_o(i, j) − k·p,
 * with q_o the query point of offset o (pixel-aperture node minus anti-aliasing split), K_λ the site kernel (diffraction, the
 * defocus disc or both; a single unit tap without them), D_t the scene ray of sensor point s at temporal midpoint t (inverse
 * distortion, the declared projection, the camera rotation at t), F = T·A its field factor (vignetting throughput × distortion
 * area factor) and A_c(λ) the electrons per unit spectral radiance on the axis (the display view's channel response, ideal
 * optics). In focus with a kernel this is the environment PSF quadrature (the field factor applied once at the source point,
 * before the PSF spreads the light); out of focus it is #548's image-space disc, the same sum in another order
 * (`defocus-image-space-provider.ts`); without a kernel it is the environment's own per-query sum. Only the scene access changes:
 * the readout, the estimators, the demosaic and the development run unchanged on these site values.
 *
 * Scene points. Without a kernel each query point is formed with the environment's own arithmetic (the site centre, aperture node
 * and split offset of `native-environment-lean.ts`), then `lookOf` (the environment's mapping, rotation and field factor,
 * #548) and the planar provider's plane-point arithmetic, so a point exactly on a chart boundary resolves as in the capture.
 * With a kernel the sources are the site lattice of each fractional offset, with #548's lattice formula. Kernels, materials and
 * per-material sums are the display view's own tables (`displayViewSignalTables`), shared with the rectilinear path.
 *
 * Caches (memory only, never values): site values in a ring of native rows across windows, and with a kernel each lattice
 * point's material (or radiance at each node) and field factor per lattice group and temporal midpoint, in a two-dimensional
 * ring tagged with the point, sized from the window and capped at LATTICE_CACHE_LIMIT entries (beyond it, points are
 * evaluated as they are read).
 *
 * Field-dependent PSF (#569, `lens.catalogue`; {@link createDisplayViewLensPsf}). The capture's environment PSF quadrature resolves the
 * catalogue lens's sampled PSF at each query point's own field position. The view cuts the native raster into square zones of
 * Z = ⌈max(W, H) / DISPLAY_VIEW_LENS_PSF_ZONES⌉ sites (one site on frames of at most that many sites a side) and every site of a zone
 * takes the PSF the capture's own resolver gives at the zone's centre, at each spectral node (an approximation: the PSF's change
 * across half a zone). A profile kernel's rows run with image +Y (up) and its tap (i, j) reads (x − (i − c)·p, y + (j − c)·p) in
 * native coordinates (`sensorPsfSourcePoint`), so the view's kernel (reading in(x − t)) is the profile kernel flipped vertically.
 * Each zone's combined kernels are the expected signal's own tables (`buildTables`) with the zone's kernels, built when a site of
 * the zone is first read and kept per input in a least-recently-used cache of at most 64 MB (at least four zones). The zones are the
 * view's fast method for `lens.catalogue` (2.20.0); its exact method (`fast: false`) passes `zones` = max(W, H), one site per zone,
 * the capture's own PSF at each site centre (much slower).
 *
 * Large defocus kernels (#564, `input.largeKernel`, radius above 64 sites). The image-space disc D is the same at every lattice
 * group, spectral node and temporal midpoint, so it commutes with those sums as in the rectilinear signal (`expected-signal.ts`):
 * μ_c(x) = Σ_s D(s)·E_c(x − s), with E_c(x) the sum above through the in-focus kernels (each node's diffraction kernel, or a unit
 * tap) at site position x for channel c, whatever x's own channel. E is computed in fixed 64-site tiles (all three channels, each
 * group's lattice points mapped once per tile and midpoint), and D ⊛ E_c by runs (`site-kernel-runs.ts`) in fixed 128-site tiles,
 * each site taking its own channel: every value depends only on its site, so regions and parts equal the whole view.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { createSiteKernelRunsLattice, type SiteKernelRunsRowPattern } from "../optics/site-kernel-runs.js";
import type { PreparedDefocusImageSpaceGeometry } from "./defocus-image-space-provider.js";
import { resolveLensSampledPsfKernel, type ResolveLensSampledPsfInput } from "../optics/lens-psf-profile.js";
import { buildTables, createMaterialSums, displayViewSignalTables, materialSpectrumSignal, type DisplayViewExpectedSignal, type DisplayViewExpectedSignalInput, type GroupTables } from "./expected-signal.js";

/** #569: field zones along the native raster's longer side. */
export const DISPLAY_VIEW_LENS_PSF_ZONES = 64;

/** #569: a field-dependent PSF for the display view (see the module comment). */
export interface DisplayViewLensPsf {
  /** Kernel radius and zone side, in sites. */
  readonly radius: number;
  readonly zoneSites: number;
  /** The kernels at the frame centre's zone, for the expected-signal input's lattice groups and reach. */
  axisKernels(wavelengthsNm: readonly number[]): { radius: number; perNode: Float64Array[] };
  /** The combined kernels of the zone of native site (x, y), for an input whose kernels are the axis kernels. */
  tables(input: DisplayViewExpectedSignalInput): (x: number, y: number) => readonly GroupTables[];
}

/**
 * #569: the field-dependent PSF of a display view from the sampled PSF the capture resolves (everything but the field point and wavelength),
 * of kernel radius R, on the W × H native raster of `pitch` µm.
 */
export function createDisplayViewLensPsf(psf: Omit<ResolveLensSampledPsfInput, "fieldPointMm" | "wavelengthNm">, R: number, W: number, H: number, pitch: number,
  zones = DISPLAY_VIEW_LENS_PSF_ZONES): DisplayViewLensPsf {
  const Z = Math.ceil(Math.max(W, H) / zones), zonesX = Math.ceil(W / Z), w = 2 * R + 1;
  const zoneOf = (x: number, y: number): number => Math.floor(y / Z) * zonesX + Math.floor(x / Z);
  const kernelsOf = (zone: number, wavelengthsNm: readonly number[]): Float64Array[] => {
    // The zone's centre in sites from the top-left corner (an edge zone may be narrower), in image millimetres (+Y up).
    const zx = zone % zonesX, zy = (zone - zx) / zonesX, fieldPointMm = { x: ((zx * Z + Math.min(W, zx * Z + Z)) / 2 - W / 2) * pitch / 1000,
      y: (H / 2 - (zy * Z + Math.min(H, zy * Z + Z)) / 2) * pitch / 1000 };
    return wavelengthsNm.map((wavelengthNm) => {
      // Every node of the engine-built profile has the same (2R + 1)² window, so every resolved kernel has it too.
      const values = resolveLensSampledPsfKernel({ ...psf, fieldPointMm, wavelengthNm } as ResolveLensSampledPsfInput).normalizedIntensity, out = new Float64Array(w * w);
      for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) out[(w - 1 - j) * w + i] = values[j * w + i]!;
      return out;
    });
  };
  const caches = new WeakMap<DisplayViewExpectedSignalInput, (x: number, y: number) => readonly GroupTables[]>();
  return { radius: R, zoneSites: Z,
    axisKernels: (wavelengthsNm) => ({ radius: R, perNode: kernelsOf(zoneOf(W >> 1, H >> 1), wavelengthsNm) }),
    tables(input): (x: number, y: number) => readonly GroupTables[] {
      let read = caches.get(input);
      if (read) return read;
      const cache = new Map<number, readonly GroupTables[]>();
      let kept = 0, last = -1, lastTables: readonly GroupTables[] = [];
      read = (x, y): readonly GroupTables[] => {
        const zone = zoneOf(x, y);
        if (zone === last) return lastTables;
        let tables = cache.get(zone);
        if (tables) cache.delete(zone);
        else {
          tables = buildTables({ ...input, kernels: { radius: R, perNode: kernelsOf(zone, input.wavelengthsNm) } }).groups;
          // Zones kept: at least 4, and at most 64 MB of them (every zone's tables have the same size).
          kept ||= Math.max(4, (1 << 23) / tables.reduce((n, g) => n + g.cw * g.ch * (g.nodeKernels.length * input.wavelengthsNm.length + g.perNode.flat().length), 0));
          if (cache.size >= kept) cache.delete(cache.keys().next().value!);
        }
        cache.set(zone, tables); last = zone; lastTables = tables;
        return tables;
      };
      caches.set(input, read);
      return read;
    } };
}

/** What the lens signal needs from the resolved request. */
export interface DisplayViewLensSetup {
  geometry: PreparedDefocusImageSpaceGeometry;
  /** Temporal midpoints, seconds from exposure start: (i + 0.5)·shutter/T with camera rotation, [0] without. */
  times: readonly number[];
  /** The planar provider's plane distance and frame-unit scale. */
  distanceM: number;
  metresPerFrameUnit: number;
  pitch: number;
  imagingArea: { widthMm: number; heightMm: number };
  boxSamples: number;
  /** Anti-aliasing split spots (or one zero spot), in the order of the expected signal's offsets within each aperture node. */
  spots: readonly { offsetMicrometers: { x: number; y: number } }[];
  /**
   * #569: a field-dependent lens PSF (`lens.catalogue`, {@link createDisplayViewLensPsf}): each site reads its field zone's kernels
   * instead of the input's. The input's kernels (the axis zone's) set the lattice groups and the reach; absent, every site reads them.
   */
  psf?: DisplayViewLensPsf | undefined;
  /**
   * #569 (catalogue fisheyes): a ray that does not point toward the scene plane sees no scene (zero radiance), as the capture's provider
   * with `zeroBeyondHorizon` gives it, instead of failing.
   */
  zeroBeyondHorizon?: boolean | undefined;
}

/** Largest lattice cache, in entries over all lattice groups and temporal midpoints (times the spectral nodes for radiance scenes). */
const LATTICE_CACHE_LIMIT = 1 << 22;

const pow2 = (n: number): number => { let p = 1; while (p < n) p *= 2; return p; };

/**
 * Checks that the mapping and the vignetting profile cover the farthest source point the view reads, (W/2 + reachSites, H/2 + reachSites)
 * sites from the axis at each corner (reachSites: the kernel radius plus the largest query offset, less the half site to the outer site
 * centre), and returns the factory of the view's expected signal for this request.
 */
export function prepareDisplayViewLensSignal(lens: DisplayViewLensSetup, nativeWidth: number, nativeHeight: number, reachSites: number, options: string):
  (input: DisplayViewExpectedSignalInput, spanColumns?: number) => DisplayViewExpectedSignal {
  const xMm = (nativeWidth / 2 + reachSites) * lens.pitch / 1000, yMm = (nativeHeight / 2 + reachSites) * lens.pitch / 1000;
  for (const t of lens.times) for (const [x, y] of [[-xMm, -yMm], [xMm, -yMm], [-xMm, yMm], [xMm, yMm]] as const) {
    try { if (!(lens.geometry.lookOf(x, y, t).z > 0) && !lens.zeroBeyondHorizon) throw new InvalidConfigurationError("its ray does not point toward the scene plane."); } catch (error) {
      throw new InvalidConfigurationError("simulateDisplayView with " + options + " reads the scene through the lens up to " + (reachSites + 0.5) + " sites beyond the native " +
        "raster's outer site centres (the kernel radius and the query offsets), and there (" + Math.hypot(x, y).toFixed(3) + " mm from the axis) " + (error as Error).message);
    }
  }
  return (input, spanColumns = Infinity) => createLensSignal(lens, input, spanColumns);
}

function createLensSignal(lens: DisplayViewLensSetup, input: DisplayViewExpectedSignalInput, spanColumns: number): DisplayViewExpectedSignal {
  const W = input.nativeWidth, H = input.nativeHeight, nodes = input.wavelengthsNm.length, T = lens.times.length, times = lens.times;
  const { geometry, distanceM: distance, metresPerFrameUnit: scale, pitch, imagingArea } = lens;
  const mmPerSite = pitch / 1000, scene = input.scene, offsets = input.offsets, A = input.electronsPerRadiance, channelAt = input.channelAt;
  const materials = scene.kind === "materials" ? scene : undefined, radianceAt = scene.kind === "radiance" ? scene.radianceAt : undefined;
  const { spectra, groups } = displayViewSignalTables(input), acc = createMaterialSums(nodes, spectra);
  const kernels = input.kernels, R = kernels ? kernels.radius : 0;
  /** #569: the combined kernels of the zone of site (x, y), or the input's own without a field-dependent PSF. */
  const zoneTables = lens.psf ? lens.psf.tables(input) : (): typeof groups => groups;
  let lookups = 0;
  // The plane point (frame units) and field factor of native sensor point (x, y) mm at time t: the environment's mapping (lookOf) and
  // the planar provider's own arithmetic for the outgoing direction −look.
  // #569: with zeroBeyondHorizon, a ray at or beyond 90° reads the plane's origin with a zero factor (zero radiance; `beyond` is set).
  let pu = 0, pv = 0, pf = 0, beyond = false;
  const zeroBeyond = lens.zeroBeyondHorizon === true;
  const map = (xMm: number, yMm: number, t: number): void => {
    const look = geometry.lookOf(xMm, yMm, t);
    beyond = !(look.z > 0);
    if (beyond) {
      if (!zeroBeyond || !Number.isFinite(look.z)) throw new InvalidConfigurationError("simulateDisplayView: a query ray does not point toward the scene plane.");
      pu = 0; pv = 0; pf = 0;
      return;
    }
    const s = distance / look.z;
    pu = look.x * s / scale; pv = look.y * s / scale; pf = look.factor;
  };
  const materialOf = (m: number): number => { if (spectra[m] === undefined) throw new InvalidConfigurationError("Unknown chart material."); return m; };
  // Without a kernel: the environment's query point of offset o of site (x, y) (native-environment-lean.ts, as buildExpectedSignalInput's queryPoint).
  const box = lens.boxSamples, siteWidthMm = pitch / 1000;
  const phases = offsets.map((_, o) => {
    const node = Math.floor(o / lens.spots.length), spot = lens.spots[o % lens.spots.length]!.offsetMicrometers;
    return { xPhase: (node % box + 0.5) / box, yPhase: (Math.floor(node / box) + 0.5) / box, aaX: spot.x / 1000, aaY: spot.y / 1000 };
  });
  function directSite(x: number, y: number): number {
    const c = channelAt(x, y), centerX = -imagingArea.widthMm / 2 + (pitch / 2 + x * pitch + 0) / 1000, centerY = -imagingArea.heightMm / 2 + (pitch / 2 + y * pitch + 0) / 1000;
    let total = 0;
    for (let ti = 0; ti < T; ti++) {
      let sum = 0;
      for (let o = 0; o < offsets.length; o++) {
        const node = phases[o]!;
        map((centerX - siteWidthMm / 2 + node.xPhase * siteWidthMm) - node.aaX, (centerY - siteWidthMm / 2 + node.yPhase * siteWidthMm) - node.aaY, times[ti]!);
        let value: number;
        if (materials) {
          // Integrated from the material's spectrum against the site's channel when it is read.
          value = materialSpectrumSignal(A[c]!, spectra[materials.materialAt(pu, pv)], nodes); lookups++;
        } else { value = 0; for (let n = 0; n < nodes; n++) value += A[c]![n]! * radianceAt!(pu, pv, input.wavelengthsNm[n]!); lookups += nodes; }
        sum += offsets[o]!.weight * (pf * value);
      }
      total += sum;
    }
    return total / T;
  }
  // With a kernel: lattice point (p, q) of group g at time t, #548's lattice formula, cached in a ring tagged with (p, q).
  const G = groups.length, slots = G * T, per = materials ? 1 : nodes;
  let cacheRows = 0, cacheCols = 0, tagQ = new Int32Array(0), tagP = new Int32Array(0), cacheMaterial = new Int32Array(0), cacheFactor = new Float64Array(0), cacheRadiance = new Float64Array(0);
  const radiance = new Float64Array(nodes);
  let lm = 0, lf = 0;
  function lattice(g: number, ti: number, p: number, q: number): void {
    let k = -1;
    if (cacheRows > 0) {
      k = ((g * T + ti) * cacheRows + (q & (cacheRows - 1))) * cacheCols + (p & (cacheCols - 1));
      if (tagQ[k] === q && tagP[k] === p) {
        lf = cacheFactor[k]!;
        if (materials) lm = cacheMaterial[k]!; else for (let n = 0; n < nodes; n++) radiance[n] = cacheRadiance[k * nodes + n]!;
        return;
      }
    }
    const group = groups[g]!;
    map((p + 0.5 + group.fx - W / 2) * mmPerSite, (q + 0.5 + group.fy - H / 2) * mmPerSite, times[ti]!);
    lf = pf;
    if (materials) { lm = materialOf(materials.materialAt(pu, pv)); lookups++; }
    else { for (let n = 0; n < nodes; n++) radiance[n] = radianceAt!(pu, pv, input.wavelengthsNm[n]!); lookups += nodes; }
    if (k >= 0) {
      tagQ[k] = q; tagP[k] = p; cacheFactor[k] = lf;
      if (materials) cacheMaterial[k] = lm; else for (let n = 0; n < nodes; n++) cacheRadiance[k * nodes + n] = radiance[n]!;
    }
  }
  function kernelSite(x: number, y: number): number {
    const c = channelAt(x, y), rowMask = cacheRows - 1, colMask = cacheCols - 1, zone = zoneTables(x, y);
    let total = 0;
    for (let ti = 0; ti < T; ti++) {
      let sum = 0;
      acc.reset();
      for (let g = 0; g < G; g++) {
        const group = groups[g]!, p0 = x + group.minIx - R, q0 = y + group.minIy - R, cw = group.cw, ch = group.ch, weights = zone[g]!;
        if (materials) {
          const k = weights.nodeKernels[c]!;
          for (let dy = 0, t = 0; dy < ch; dy++) {
            // The cache row of lattice row q (read inline: the common case is a hit).
            const q = q0 + dy, row = cacheRows > 0 ? ((g * T + ti) * cacheRows + (q & rowMask)) * cacheCols : -1;
            for (let dx = 0; dx < cw; dx++, t++) {
              const p = p0 + dx;
              const at = row + (p & colMask);
              if (row >= 0 && tagQ[at] === q && tagP[at] === p) { lm = cacheMaterial[at]!; lf = cacheFactor[at]!; } else lattice(g, ti, p, q);
              acc.add(lm, k, t * nodes, lf);
            }
          }
        } else for (let dy = 0, t = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++, t++) {
          lattice(g, ti, p0 + dx, q0 + dy);
          let value = 0;
          for (let n = 0; n < nodes; n++) value += weights.perNode[n]![c]![t]! * radiance[n]!;
          sum += lf * value;
        }
      }
      total += materials ? acc.value() : sum;
    }
    return total / T;
  }
  const pilotNode = input.wavelengthsNm[Math.floor(nodes / 2)]!;
  if (input.largeKernel) return createLargeLensSignal(input, inFocusLensTile, () => lookups, pilot);
  /** E_c (#564) of the native site positions [x0, x0 + T) × [y0, y0 + T) for the three channels: kernelSite's sum for each channel. */
  function inFocusLensTile(x0: number, y0: number, TS: number): Float64Array[] {
    const out = [0, 1, 2].map(() => new Float64Array(TS * TS));
    // A fixed tile reaches past the raster: positions more than the disc's radius beyond it feed no site, so they stay 0 and are never
    // mapped (the lens profiles are checked only up to the view's reach).
    const D = input.largeKernel!.radius;
    if (x0 + TS <= -D || x0 >= W + D || y0 + TS <= -D || y0 >= H + D) return out;
    if (x0 < -D || x0 + TS > W + D || y0 < -D || y0 + TS > H + D) {
      const xa = Math.max(x0, -D), xb = Math.min(x0 + TS, W + D), ya = Math.max(y0, -D), yb = Math.min(y0 + TS, H + D);
      const part = inFocusLensRect(xa, ya, xb - xa, yb - ya);
      for (let c = 0; c < 3; c++) for (let y = ya; y < yb; y++) out[c]!.set(part[c]!.subarray((y - ya) * (xb - xa), (y - ya + 1) * (xb - xa)), (y - y0) * TS + xa - x0);
      return out;
    }
    return inFocusLensRect(x0, y0, TS, TS);
  }
  /** E_c of the native site positions [x0, x0 + w) × [y0, y0 + h), row-major, for the three channels. */
  function inFocusLensRect(x0: number, y0: number, TW: number, TH: number): Float64Array[] {
    const out = [0, 1, 2].map(() => new Float64Array(TW * TH)), sum = [0, 1, 2].map(() => new Float64Array(TW * TH));
    for (let ti = 0; ti < T; ti++) {
      for (const e of sum) e.fill(0);
      for (const group of groups) {
        const cw = group.cw, ch = group.ch, gw = TW + cw - 1, gh = TH + ch - 1, p0 = x0 + group.minIx - R, q0 = y0 + group.minIy - R;
        const factor = new Float64Array(gw * gh), material = materials ? new Int32Array(gw * gh) : undefined, values = materials ? undefined : new Float64Array(gw * gh * nodes);
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
          const k = j * gw + i;
          map((p0 + i + 0.5 + group.fx - W / 2) * mmPerSite, (q0 + j + 0.5 + group.fy - H / 2) * mmPerSite, times[ti]!);
          factor[k] = pf;
          if (material) material[k] = materialOf(materials!.materialAt(pu, pv));
          else for (let n = 0; n < nodes; n++) values![k * nodes + n] = radianceAt!(pu, pv, input.wavelengthsNm[n]!);
        }
        lookups += material ? gw * gh : gw * gh * nodes;
        for (let c = 0; c < 3; c++) {
          const e = sum[c]!, kc = material ? group.nodeKernels[c]! : undefined;
          for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
            let v = 0;
            acc.reset();
            for (let dy = 0, t = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++, t++) {
              const k = (y + dy) * gw + x + dx;
              if (material) acc.add(material[k]!, kc!, t * nodes, factor[k]!);
              else { let r = 0; for (let n = 0; n < nodes; n++) r += group.perNode[n]![c]![t]! * values![k * nodes + n]!; v += factor[k]! * r; }
            }
            if (material) v = acc.value();
            e[y * TW + x] = e[y * TW + x]! + v;
          }
        }
      }
      for (let c = 0; c < 3; c++) { const o = out[c]!, e = sum[c]!; for (let k = 0; k < o.length; k++) o[k] = o[k]! + e[k]!; }
    }
    for (const o of out) for (let k = 0; k < o.length; k++) o[k] = o[k]! / T;
    return out;
  }
  // Site values persist across windows in a ring of native rows (a site's value does not depend on the window).
  let ringRows = 0, ring = new Float64Array(0), ringRowId = new Int32Array(0), ringOn = false;
  const compute = kernels ? kernelSite : directSite;
  return {
    get lookups(): number { return lookups; },
    uniformMaterial: -1,
    tracksMaterial: false,
    get cachesSites(): boolean { return ringOn; },
    marksReads: false,
    markReads(): void { /* never called: marksReads is false */ },
    window(x0: number, y0: number, x1: number, y1: number): void {
      const sw = Math.max(0, x1 - x0), sh = Math.max(0, y1 - y0);
      if (sh > 0 && ringRows < 2 * sh) {
        const rows = pow2(2 * sh);
        if (rows * W <= LATTICE_CACHE_LIMIT) { ringRows = rows; ring = new Float64Array(rows * W).fill(NaN); ringRowId = new Int32Array(rows).fill(-1); }
      }
      ringOn = sh > 0 && ringRows >= 2 * sh;
      if (!kernels || sw === 0) return;
      // The lattice rectangle the window's sites read, per group; the cache keeps two such heights and the columns the render's windows span.
      let cw = 0, ch = 0;
      for (const group of groups) { cw = Math.max(cw, group.cw); ch = Math.max(ch, group.ch); }
      const height = sh + ch - 1, width = sw + cw - 1;
      let rows = pow2(2 * height), cols = pow2(Math.min(W + 2 * (R + cw), Math.max(width, (Number.isFinite(spanColumns) ? spanColumns : W) + width)));
      if (slots * per * rows * cols > LATTICE_CACHE_LIMIT) rows = pow2(height);
      if (slots * per * rows * cols > LATTICE_CACHE_LIMIT) cols = pow2(width);
      if (slots * per * rows * cols > LATTICE_CACHE_LIMIT) { cacheRows = 0; return; }
      if (rows > cacheRows || cols > cacheCols) {
        rows = Math.max(rows, cacheRows); cols = Math.max(cols, cacheCols);
        if (slots * per * rows * cols > LATTICE_CACHE_LIMIT) { rows = pow2(height); cols = pow2(width); }
        cacheRows = rows; cacheCols = cols;
        const size = slots * rows * cols;
        tagQ = new Int32Array(size).fill(-2147483648); tagP = new Int32Array(size); cacheFactor = new Float64Array(size);
        if (materials) cacheMaterial = new Int32Array(size); else cacheRadiance = new Float64Array(size * nodes);
      }
    },
    site(x: number, y: number): number {
      if (!ringOn) return compute(x, y);
      const slot = y & (ringRows - 1), k = slot * W + x;
      if (ringRowId[slot] === y) { const v = ring[k]!; if (v === v) return v; }
      else { ringRowId[slot] = y; ring.fill(NaN, slot * W, (slot + 1) * W); }
      const v = compute(x, y);
      ring[k] = v;
      return v;
    },
    pilot
  };
  /**
   * The renderer's pilot point is a rectilinear plane point of the native raster: back to the sensor point, then through the lens at
   * every temporal midpoint. A point whose scene value differs between the instants (motion) counts as detail (NaN equals nothing).
   */
  function pilot(u: number, v: number): number {
    const g = 2 / input.outputWidth, xMm = u / g * mmPerSite, yMm = -v / g * mmPerSite;
    let first = NaN;
    try {
      for (let ti = 0; ti < T; ti++) {
        map(xMm, yMm, times[ti]!);
        const value = beyond ? -1 : materials ? materials.materialAt(pu, pv) : radianceAt!(pu, pv, pilotNode);
        lookups++;
        if (ti === 0) first = value; else if (value !== first) return NaN;
      }
    } catch { return NaN; }
    return first;
  }
}

/** #564: tile sides of the large-kernel lens signal (the in-focus E and the convolved sites) and the bytes each tile cache keeps. */
const LARGE_E_TILE = 64, LARGE_OUTPUT_TILE = 128, LARGE_CACHE_BYTES = 32 * 1048576;

/** #564: the lens signal with a defocus kernel above 64 sites: D ⊛ E_c by runs over the in-focus tiles (see the module comment). */
function createLargeLensSignal(input: DisplayViewExpectedSignalInput, inFocusTile: (x0: number, y0: number, T: number) => Float64Array[], lookups: () => number,
  pilot: (u: number, v: number) => number): DisplayViewExpectedSignal {
  const runs = input.largeKernel!, channelAt = input.channelAt, TE = LARGE_E_TILE;
  // At least the in-focus tiles one output tile's source spans plus one more row of them, so the next output tile of a row reuses them.
  const span = Math.ceil((LARGE_OUTPUT_TILE + 2 * runs.radius) / TE) + 1;
  const inFocus = new Map<number, Float64Array[]>(), capacity = Math.max(span * (span + 1), Math.floor(LARGE_CACHE_BYTES / (3 * TE * TE * 8)));
  const tileAt = (tx: number, ty: number): Float64Array[] => {
    const key = (ty + 1048576) * 2097152 + tx + 1048576;
    let tile = inFocus.get(key);
    if (tile) { inFocus.delete(key); inFocus.set(key, tile); }
    else {
      tile = inFocusTile(tx * TE, ty * TE, TE);
      inFocus.set(key, tile);
      if (inFocus.size > capacity) inFocus.delete(inFocus.keys().next().value!);
    }
    return tile;
  };
  // Which sites of a tile row hold channel c: the CFA's 2 × 2 period (tile origins are even).
  const phase = [0, 1].map((py) => [0, 1].map((px) => channelAt(px, py)));
  const patterns: SiteKernelRunsRowPattern[] = [0, 1, 2].map((c) => (row: number) => {
    const p = phase[row & 1]!, even = p[0] === c, odd = p[1] === c;
    return even && odd ? { start: 0, step: 1 } : even ? { start: 0, step: 2 } : odd ? { start: 1, step: 2 } : null;
  });
  const lattice = createSiteKernelRunsLattice({ runs, tile: LARGE_OUTPUT_TILE, fields: 3, capacityBytes: LARGE_CACHE_BYTES, pattern: (c) => patterns[c],
    source: (x0, y0, width, height) => (c: number): Float64Array => {
      const samples = new Float64Array(width * height);
      for (let ty = Math.floor(y0 / TE); ty * TE < y0 + height; ty++) for (let tx = Math.floor(x0 / TE); tx * TE < x0 + width; tx++) {
        const tile = tileAt(tx, ty)[c]!, ax = Math.max(x0, tx * TE), bx = Math.min(x0 + width, (tx + 1) * TE), ay = Math.max(y0, ty * TE), by = Math.min(y0 + height, (ty + 1) * TE);
        for (let y = ay; y < by; y++) samples.set(tile.subarray((y - ty * TE) * TE + ax - tx * TE, (y - ty * TE) * TE + bx - tx * TE), (y - y0) * width + ax - x0);
      }
      return samples;
    } });
  return {
    get lookups(): number { return lookups(); },
    uniformMaterial: -1,
    tracksMaterial: false,
    cachesSites: false,
    marksReads: false,
    markReads(): void { /* never called: marksReads is false */ },
    window(): void { /* the tiles are fixed and kept for the signal; a window changes nothing */ },
    site(x: number, y: number): number { return lattice.valueAt(channelAt(x, y), x, y); },
    pilot
  };
}
