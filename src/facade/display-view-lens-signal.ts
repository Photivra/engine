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
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { PreparedDefocusImageSpaceGeometry } from "./defocus-image-space-provider.js";
import { displayViewSignalTables, type DisplayViewExpectedSignal, type DisplayViewExpectedSignalInput } from "./expected-signal.js";

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
    try { if (!(lens.geometry.lookOf(x, y, t).z > 0)) throw new InvalidConfigurationError("its ray does not point toward the scene plane."); } catch (error) {
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
  const { reflectance, spectralIndex, neutralDirect, spectralDirect, groups } = displayViewSignalTables(input);
  const kernels = input.kernels, R = kernels ? kernels.radius : 0;
  let lookups = 0;
  // The plane point (frame units) and field factor of native sensor point (x, y) mm at time t: the environment's mapping (lookOf) and
  // the planar provider's own arithmetic for the outgoing direction −look.
  let pu = 0, pv = 0, pf = 0;
  const map = (xMm: number, yMm: number, t: number): void => {
    const look = geometry.lookOf(xMm, yMm, t);
    if (!(look.z > 0)) throw new InvalidConfigurationError("simulateDisplayView: a query ray does not point toward the scene plane.");
    const s = distance / look.z;
    pu = look.x * s / scale; pv = look.y * s / scale; pf = look.factor;
  };
  const materialOf = (m: number): number => { if (spectralIndex[m] === undefined) throw new InvalidConfigurationError("Unknown chart material."); return m; };
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
          const m = materialOf(materials.materialAt(pu, pv)), si = spectralIndex[m]!;
          value = si < 0 ? reflectance[m]! * neutralDirect[c]! : spectralDirect[c]![si]!; lookups++;
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
    const c = channelAt(x, y), rowMask = cacheRows - 1, colMask = cacheCols - 1;
    let total = 0;
    for (let ti = 0; ti < T; ti++) {
      let sum = 0;
      for (let g = 0; g < G; g++) {
        const group = groups[g]!, p0 = x + group.minIx - R, q0 = y + group.minIy - R, cw = group.cw, ch = group.ch;
        if (materials) {
          const nk = group.neutral[c]!, sk = group.spectral[c]!;
          for (let dy = 0, t = 0; dy < ch; dy++) {
            // The cache row of lattice row q (read inline: the common case is a hit).
            const q = q0 + dy, row = cacheRows > 0 ? ((g * T + ti) * cacheRows + (q & rowMask)) * cacheCols : -1;
            for (let dx = 0; dx < cw; dx++, t++) {
              const p = p0 + dx, k = row + (p & colMask);
              if (row >= 0 && tagQ[k] === q && tagP[k] === p) { lm = cacheMaterial[k]!; lf = cacheFactor[k]!; } else lattice(g, ti, p, q);
              const si = spectralIndex[lm]!;
              sum += lf * (si < 0 ? reflectance[lm]! * nk[t]! : sk[si]![t]!);
            }
          }
        } else for (let dy = 0, t = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++, t++) {
          lattice(g, ti, p0 + dx, q0 + dy);
          let value = 0;
          for (let n = 0; n < nodes; n++) value += group.perNode[n]![c]![t]! * radiance[n]!;
          sum += lf * value;
        }
      }
      total += sum;
    }
    return total / T;
  }
  // Site values persist across windows in a ring of native rows (a site's value does not depend on the window).
  let ringRows = 0, ring = new Float64Array(0), ringRowId = new Int32Array(0), ringOn = false;
  const compute = kernels ? kernelSite : directSite;
  const pilotNode = input.wavelengthsNm[Math.floor(nodes / 2)]!;
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
    pilot(u: number, v: number): number {
      // The renderer's pilot point is a rectilinear plane point of the native raster: back to the sensor point, then through the lens at
      // every temporal midpoint. A point whose scene value differs between the instants (motion) counts as detail (NaN equals nothing).
      const g = 2 / input.outputWidth, xMm = u / g * mmPerSite, yMm = -v / g * mmPerSite;
      let first = NaN;
      try {
        for (let ti = 0; ti < T; ti++) {
          map(xMm, yMm, times[ti]!);
          const value = materials ? materials.materialAt(pu, pv) : radianceAt!(pu, pv, pilotNode);
          lookups++;
          if (ti === 0) first = value; else if (value !== first) return NaN;
        }
      } catch { return NaN; }
      return first;
    }
  };
}
