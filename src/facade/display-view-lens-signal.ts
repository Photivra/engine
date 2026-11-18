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
 * Each zone's kernels (#655: the PSF alone, `zoneKernels`) are resolved when a site of the zone is first read and kept across prepared
 * views by content in a least-recently-used cache of at most 32 MiB; a site reads them through the pre-integrated pass below. The zones are the
 * view's fast method for `lens.catalogue` (2.20.0); its exact method (`fast: false`) passes `zones` = max(W, H), one site per zone,
 * the capture's own PSF at each site centre (much slower).
 *
 * Large defocus kernels (#564, `input.largeKernel`, radius above 64 sites). The image-space disc D is the same at every lattice
 * group, spectral node and temporal midpoint, so it commutes with those sums as in the rectilinear signal (`expected-signal.ts`):
 * μ_c(x) = Σ_s D(s)·E_c(x − s), with E_c(x) the sum above through the in-focus kernels (each node's diffraction kernel, or a unit
 * tap) at site position x for channel c, whatever x's own channel. E is computed in fixed 64-site tiles (all three channels, each
 * group's lattice points mapped once per tile and midpoint), and D ⊛ E_c by runs (`site-kernel-runs.ts`) in fixed 128-site tiles,
 * each site taking its own channel: every value depends only on its site, so regions and parts equal the whole view.
 *
 * #651: the regrouped defocus below 64 sites too (the facade's cost choice, {@link regroupedLensDefocusCheaper}), and under a rolling
 * shutter, where each scan line has its own instants, by line blocks (`display-view-lens-regroup.ts`): rows by rows (the full method)
 * or rows grouped into bands that share their middle row's instants (the fast method, `rollingBands`).
 *
 * #655: with a catalogue lens's field-dependent PSF each site is Σ_n A_c(λ_n)·Σ_t K_{z,n}(t)·B(x − t)[n], K_{z,n} its zone's PSF at node n
 * and B(p)[n] = Σ_o w_o·F(p + o)·L(p + o)[n] the spectral radiance of lattice point p pre-integrated over the query offsets (pixel-aperture
 * nodes and filter spots) with each point's field factor: one kernel pass of (2R + 1)² taps per site instead of one per lattice group,
 * and no per-material sums. The same sum regrouped. B is spectral radiance (no channel response), kept per lattice point and
 * temporal midpoint in a ring as the lattice points are; the zone kernels are the PSF alone, kept across prepared views by content
 * ({@link DISPLAY_VIEW_LENS_ZONE_CACHE_BYTES}). The fast method `uniformWindows` takes a site whose every tap reads one material as
 * Σ_n L_m(λ_n)·A_c(λ_n)·(F̄₀·S_n + ∇F̄·M_n + ½ Σ H_ij·M_ij,n) (F̄ = Σ_o w_o·F(· + o) to second order about the site, its derivatives by
 * central differences of the neighbouring lattice points; S_n, M_n and M_ij,n the zone kernel's sum, first and second moments at node n,
 * the PSF alone), see {@link DisplayViewLensSetup.uniformWindows}.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { createSiteKernelRunsLattice, type SiteKernelRunsRowPattern } from "../optics/site-kernel-runs.js";
import type { PreparedDefocusImageSpaceGeometry } from "./defocus-image-space-provider.js";
import { resolveLensSampledPsfKernel, type ResolveLensSampledPsfInput } from "../optics/lens-psf-profile.js";
import { createMaterialSums, displayViewSignalTables, materialSpectrumSignal, type DisplayViewExpectedSignal, type DisplayViewExpectedSignalInput } from "./expected-signal.js";
import { createRollingRegroupedLensSignal, regroupedLensDefocusCheaper, rollingLensBands, rollingScanLines, type RollingLensBands } from "./display-view-lens-regroup.js";

export { regroupedLensDefocusCheaper, rollingLensBands, rollingScanLines, type RollingLensBands } from "./display-view-lens-regroup.js";
/** #655 step 4: the view's lens geometry takes the Newton inverse of a radial distortion (`prepareDefocusImageSpaceGeometry`'s `undistort`). */
export { undistortedImagePointNewton } from "../optics/radial-distortion-newton.js";

/** #569: field zones along the native raster's longer side. */
export const DISPLAY_VIEW_LENS_PSF_ZONES = 64;

/**
 * #655: one field zone's PSF on the site lattice, the PSF alone (no channel response, no scene). `perNode[n]` holds (2R + 1)² taps
 * row-major in the view's orientation: tap (u, v), u, v ∈ [−R, R], at (v + R)·(2R + 1) + u + R, reads the source at native site
 * (x − u, y − v) for output site (x, y). `sums[n]` = Σ_t K_n(t); `momentX[n]` = Σ_t K_n(t)·(−u) and `momentY[n]` = Σ_t K_n(t)·(−v),
 * the first moments of the source offsets (for the first-order field factor of the uniform windows).
 */
export interface DisplayViewLensZoneKernels {
  readonly perNode: readonly Float64Array[];
  readonly sums: Float64Array;
  readonly momentX: Float64Array;
  readonly momentY: Float64Array;
  /** Second moments: Σ_t K_n(t)·u², Σ_t K_n(t)·v² and Σ_t K_n(t)·u·v. */
  readonly momentXX: Float64Array;
  readonly momentYY: Float64Array;
  readonly momentXY: Float64Array;
}

/** #569: a field-dependent PSF for the display view (see the module comment). */
export interface DisplayViewLensPsf {
  /** Kernel radius and zone side, in sites. */
  readonly radius: number;
  readonly zoneSites: number;
  /** Zones per row and per column of the native raster (zone z covers sites [zx·Z, zx·Z + Z) × [zy·Z, zy·Z + Z), z = zy·zonesX + zx). */
  readonly zonesX: number;
  readonly zonesY: number;
  /** The zone of native site (x, y). */
  zoneOf(x: number, y: number): number;
  /** The kernels at the frame centre's zone, for the expected-signal input's lattice groups and reach. */
  axisKernels(wavelengthsNm: readonly number[]): { radius: number; perNode: Float64Array[] };
  /**
   * #655: zone `zone`'s PSF at each spectral node, kept across prepared views by content (least recently used first, at most
   * {@link DISPLAY_VIEW_LENS_ZONE_CACHE_BYTES}); a zone dropped and resolved again has the same bits. For the CPU lens signal and the
   * GPU's lens pass, which upload the zones a band reads.
   */
  zoneKernels(zone: number, wavelengthsNm: readonly number[]): DisplayViewLensZoneKernels;
}

/** #655 step 5: bytes of zone PSF kernels kept across prepared views (all lenses and views together). */
export const DISPLAY_VIEW_LENS_ZONE_CACHE_BYTES = 32 * 1048576;
const zoneCache = new Map<string, DisplayViewLensZoneKernels>();
let zoneCacheBytes = 0, zoneResolves = 0, zoneHits = 0, nextContentId = 1;
/** Content signatures seen recently → their id in the zone cache's keys (at most 16 kept; an evicted one gets a new id). */
const contentIds = new Map<string, number>();
const wavelengthKeys = new WeakMap<readonly number[], string>();

/** Internal test hook: zone kernels resolved and found in the cross-view cache so far, and the bytes held. */
export function displayViewLensZoneCacheState(): { resolves: number; hits: number; bytes: number; zones: number } {
  return { resolves: zoneResolves, hits: zoneHits, bytes: zoneCacheBytes, zones: zoneCache.size };
}
/** Internal test hook: forgets the zone kernels kept across views. */
export function clearDisplayViewLensZoneCache(): void { zoneCache.clear(); zoneCacheBytes = 0; }

/** Every number of the PSF resolver input, the kernel radius, the raster, the pitch and the zone count, as one string. */
function contentSignature(psf: unknown, R: number, W: number, H: number, pitch: number, zones: number): string | undefined {
  try {
    return JSON.stringify([psf, R, W, H, pitch, zones], (_, value: unknown) => (ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) :
      typeof value === "number" && !Number.isFinite(value) ? String(value) : value));
  } catch { return undefined; }
}

/**
 * #569: the field-dependent PSF of a display view from the sampled PSF the capture resolves (everything but the field point and wavelength),
 * of kernel radius R, on the W × H native raster of `pitch` µm.
 */
export function createDisplayViewLensPsf(psf: Omit<ResolveLensSampledPsfInput, "fieldPointMm" | "wavelengthNm">, R: number, W: number, H: number, pitch: number,
  zones = DISPLAY_VIEW_LENS_PSF_ZONES): DisplayViewLensPsf {
  const Z = Math.ceil(Math.max(W, H) / zones), zonesX = Math.ceil(W / Z), zonesY = Math.ceil(H / Z), w = 2 * R + 1;
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
  const signature = contentSignature(psf, R, W, H, pitch, zones);
  let id = signature === undefined ? undefined : contentIds.get(signature);
  if (signature !== undefined) {
    if (id === undefined) { id = nextContentId++; if (contentIds.size >= 16) contentIds.delete(contentIds.keys().next().value!); }
    else contentIds.delete(signature);
    contentIds.set(signature, id);
  }
  // A view whose PSF cannot be signed keeps its zones under its own id (shared by nothing else).
  const prefix = (id ?? -(nextContentId++)) + ":";
  let last = -1, lastWavelengths: readonly number[] | undefined, lastKernels: DisplayViewLensZoneKernels | undefined;
  return { radius: R, zoneSites: Z, zonesX, zonesY, zoneOf,
    axisKernels: (wavelengthsNm) => ({ radius: R, perNode: kernelsOf(zoneOf(W >> 1, H >> 1), wavelengthsNm) }),
    zoneKernels(zone, wavelengthsNm): DisplayViewLensZoneKernels {
      if (zone === last && wavelengthsNm === lastWavelengths) return lastKernels!;
      let wl = wavelengthKeys.get(wavelengthsNm);
      if (wl === undefined) { wl = wavelengthsNm.join(","); wavelengthKeys.set(wavelengthsNm, wl); }
      const key = prefix + zone + ":" + wl;
      let kernels = zoneCache.get(key);
      if (kernels) { zoneCache.delete(key); zoneCache.set(key, kernels); zoneHits++; }
      else {
        const perNode = kernelsOf(zone, wavelengthsNm), nodes = perNode.length;
        const sums = new Float64Array(nodes), momentX = new Float64Array(nodes), momentY = new Float64Array(nodes);
        const momentXX = new Float64Array(nodes), momentYY = new Float64Array(nodes), momentXY = new Float64Array(nodes);
        for (let n = 0; n < nodes; n++) {
          const k = perNode[n]!;
          let s = 0, mx = 0, my = 0, mxx = 0, myy = 0, mxy = 0;
          for (let v = -R, t = 0; v <= R; v++) for (let u = -R; u <= R; u++, t++) {
            const w = k[t]!; s += w; mx += w * -u; my += w * -v; mxx += w * u * u; myy += w * v * v; mxy += w * u * v;
          }
          sums[n] = s; momentX[n] = mx; momentY[n] = my; momentXX[n] = mxx; momentYY[n] = myy; momentXY[n] = mxy;
        }
        kernels = Object.freeze({ perNode: Object.freeze(perNode), sums, momentX, momentY, momentXX, momentYY, momentXY });
        zoneResolves++;
        const bytes = nodes * (w * w + 6) * 8;
        zoneCache.set(key, kernels); zoneCacheBytes += bytes;
        while (zoneCacheBytes > DISPLAY_VIEW_LENS_ZONE_CACHE_BYTES && zoneCache.size > 1) {
          const [oldest, dropped] = zoneCache.entries().next().value!;
          zoneCache.delete(oldest); zoneCacheBytes -= dropped.perNode.length * (dropped.perNode[0]!.length + 6) * 8;
        }
      }
      last = zone; lastWavelengths = wavelengthsNm; lastKernels = kernels;
      return kernels;
    } };
}

/** What the lens signal needs from the resolved request. */
export interface DisplayViewLensSetup {
  geometry: PreparedDefocusImageSpaceGeometry;
  /** Temporal midpoints, seconds from exposure start: (i + 0.5)·shutter/T with camera rotation, [0] without. */
  times: readonly number[];
  /**
   * #640: camera rotation under a rolling shutter: native site (x, y)'s own midpoints (its exposure window's, as the environment forms
   * them), used instead of `times`. Every kernel tap of a site reads the scene at the site's instants.
   */
  timesAt?: ((x: number, y: number) => readonly number[]) | undefined;
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
  /**
   * #632 (`lens.catalogue.flare`): the veiling glare, as the capture renders it: each site's electrons become (1 − g)·μ + g·Σ_λ A_c(λ)·Ē(λ),
   * Ē the frame's mean of the field factor times the scene radiance on the site lattice (every `step`-th site per axis, from step/2).
   */
  veil?: { fraction: number; step: number } | undefined;
  /**
   * #651 step 3, the fast method `motion.shutter.rolling/view-row-bands` (with camera rotation under a rolling shutter and a defocus
   * input regrouped by runs, `largeKernel`): the rows are grouped into fixed bands of {@link RollingLensBands.rows} rows, and every row of
   * a band reads the scene at its middle row's instants (a shift of the in-focus image of at most 1/128 site within the band). Absent or
   * false: every row at its own instants (the full method, the same sum as the tap sum regrouped).
   */
  rollingBands?: boolean | undefined;
  /**
   * #655 step 6, the fast method `lens.catalogue/view-uniform-window` (a catalogue lens's PSF on a chart or material scene): a site whose
   * every kernel tap reads one material takes the field factor to second order about the site (see the module comment; measured within
   * 2.7e-8 relative of the full method on every catalogue lens). Absent or false: every tap with its own field factor.
   */
  uniformWindows?: boolean | undefined;
}

/** The lens signal factory of a prepared view: one expected signal per expected-signal input (and render). */
export interface DisplayViewLensSignalFactory {
  (input: DisplayViewExpectedSignalInput, spanColumns?: number): DisplayViewExpectedSignal;
  /**
   * #651: with camera rotation under a rolling shutter, the scan lines ("rows": each native row has its own instants; "columns"; or
   * "none") and, for rows, the fast method's band height and its largest shift (for the `view.defocus` assumption).
   */
  readonly rolling: { lines: "rows" | "columns" | "none"; bands: RollingLensBands } | undefined;
  /** Temporal midpoints per site (`times.length`), for the cost choice ({@link regroupedLensDefocusCheaper}). */
  readonly midpoints: number;
  /**
   * #651: the rows per block a regrouped input (`largeKernel`) takes under a rolling shutter that scans by rows: the fast method's band
   * height with `rollingBands`, else 1; undefined for a global shutter (the fixed tiles) or a shutter that does not scan by rows.
   */
  readonly bandRows: number | undefined;
  /**
   * #651: {@link regroupedLensDefocusCheaper} for this view's midpoints and blocks (the facade calls it per render, so the display view's
   * default bundle need not contain the cost rule).
   */
  regroupedCheaper(w: number, h: number, sites: number, combinedRadius: number, inFocusRadius: number, nodes: number): boolean;
}

/** Largest lattice cache, in entries over all lattice groups and temporal midpoints (times the spectral nodes for radiance scenes). */
const LATTICE_CACHE_LIMIT = 1 << 22;
/** #655: largest pre-integrated (B) ring, in doubles over all temporal midpoints (its spectra, material, factor and tags). */
const B_CACHE_LIMIT = 1 << 22;

const pow2 = (n: number): number => { let p = 1; while (p < n) p *= 2; return p; };

/**
 * Checks that the mapping and the vignetting profile cover the farthest source point the view reads, (W/2 + reachSites, H/2 + reachSites)
 * sites from the axis at each corner (reachSites: the kernel radius plus the largest query offset, less the half site to the outer site
 * centre), and returns the factory of the view's expected signal for this request.
 */
let lastPrepared: { lens: DisplayViewLensSetup; nativeWidth: number; nativeHeight: number } | undefined;
/** Internal test hook: the setup and raster of the lens signal prepared last (tests prepare variants of it). */
export function lastDisplayViewLensSetup(): { lens: DisplayViewLensSetup; nativeWidth: number; nativeHeight: number } | undefined { return lastPrepared; }

export function prepareDisplayViewLensSignal(lens: DisplayViewLensSetup, nativeWidth: number, nativeHeight: number, reachSites: number, options: string): DisplayViewLensSignalFactory {
  lastPrepared = { lens, nativeWidth, nativeHeight };
  const xMm = (nativeWidth / 2 + reachSites) * lens.pitch / 1000, yMm = (nativeHeight / 2 + reachSites) * lens.pitch / 1000;
  for (const [x, y] of [[-xMm, -yMm], [xMm, -yMm], [-xMm, yMm], [xMm, yMm]] as const) for (const t of lens.timesAt?.(x < 0 ? 0 : nativeWidth - 1, y < 0 ? 0 : nativeHeight - 1) ?? lens.times) {
    try { if (!(lens.geometry.lookOf(x, y, t).z > 0) && !lens.zeroBeyondHorizon) throw new InvalidConfigurationError("its ray does not point toward the scene plane."); } catch (error) {
      throw new InvalidConfigurationError("simulateDisplayView with " + options + " reads the scene through the lens up to " + (reachSites + 0.5) + " sites beyond the native " +
        "raster's outer site centres (the kernel radius and the query offsets), and there (" + Math.hypot(x, y).toFixed(3) + " mm from the axis) " + (error as Error).message);
    }
  }
  let rolling: DisplayViewLensSignalFactory["rolling"];
  if (lens.timesAt) {
    const lines = rollingScanLines(lens.timesAt, nativeWidth, nativeHeight);
    rolling = { lines, bands: lines === "rows" ? rollingLensBands(lens.geometry, lens.timesAt, nativeWidth, nativeHeight, lens.pitch) : { rows: 1, shiftSites: 0 } };
  }
  const factory = (input: DisplayViewExpectedSignalInput, spanColumns = Infinity): DisplayViewExpectedSignal => createLensSignal(lens, input, spanColumns, rolling);
  const bandRows = rolling?.lines === "rows" ? (lens.rollingBands ? rolling.bands.rows : 1) : undefined;
  const midpoints = lens.times.length;
  return Object.assign(factory, { rolling, midpoints, bandRows,
    regroupedCheaper: (w: number, h: number, sites: number, combinedRadius: number, inFocusRadius: number, nodes: number): boolean =>
      regroupedLensDefocusCheaper(w, h, sites, combinedRadius, inFocusRadius, nodes, midpoints, bandRows) });
}

function createLensSignal(lens: DisplayViewLensSetup, input: DisplayViewExpectedSignalInput, spanColumns: number, rolling: DisplayViewLensSignalFactory["rolling"]): DisplayViewExpectedSignal {
  const W = input.nativeWidth, H = input.nativeHeight, nodes = input.wavelengthsNm.length, T = lens.times.length, timesAt = lens.timesAt ?? ((): readonly number[] => lens.times), rollingShutter = lens.timesAt !== undefined;
  // #640: the instants of the site being computed (its own under a rolling shutter); lattice points are read, and cached, at them.
  let times = lens.times;
  const { geometry, distanceM: distance, metresPerFrameUnit: scale, pitch, imagingArea } = lens;
  const mmPerSite = pitch / 1000, scene = input.scene, offsets = input.offsets, A = input.electronsPerRadiance, channelAt = input.channelAt;
  const materials = scene.kind === "materials" ? scene : undefined, radianceAt = scene.kind === "radiance" ? scene.radianceAt : undefined;
  const { spectra, groups } = displayViewSignalTables(input), acc = createMaterialSums(nodes, spectra);
  const kernels = input.kernels, R = kernels ? kernels.radius : 0, psf = lens.psf;
  if (psf && input.largeKernel) throw new InvalidConfigurationError("simulateDisplayView: a catalogue lens's PSF includes its own defocus; it is not regrouped with a defocus disc.");
  // #655: a catalogue lens's sites take the pre-integrated path (psfSite); #643 on this path (a fast request): the taps added in order.
  const usePsf = psf !== undefined && kernels !== undefined, perTap = input.perTapSum === true && materials !== undefined;
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
    times = timesAt(x, y);
    for (let ti = 0; ti < T; ti++) {
      let sum = 0;
      for (let o = 0; o < offsets.length; o++) {
        const node = phases[o]!;
        map((centerX - siteWidthMm / 2 + node.xPhase * siteWidthMm) - node.aaX, (centerY - siteWidthMm / 2 + node.yPhase * siteWidthMm) - node.aaY, times[ti]!);
        let value: number;
        if (materials) {
          // Integrated from the material's spectrum against the site's channel when it is read.
          value = materialSpectrumSignal(A[c]!, spectra[materialOf(materials.materialAt(pu, pv))], nodes); lookups++;
        } else { value = 0; for (let n = 0; n < nodes; n++) value += A[c]![n]! * radianceAt!(pu, pv, input.wavelengthsNm[n]!, times[ti]!); lookups += nodes; }
        sum += offsets[o]!.weight * (pf * value);
      }
      total += sum;
    }
    return total / T;
  }
  // With a kernel: lattice point (p, q) of group g at time t, #548's lattice formula, cached in a ring tagged with (p, q).
  const G = groups.length, slots = G * T, per = materials ? 1 : nodes;
  let cacheRows = 0, cacheCols = 0, tagQ = new Int32Array(0), tagP = new Int32Array(0), tagT = new Float64Array(0), cacheMaterial = new Int32Array(0), cacheFactor = new Float64Array(0), cacheRadiance = new Float64Array(0);
  const radiance = new Float64Array(nodes);
  let lm = 0, lf = 0;
  function lattice(g: number, ti: number, p: number, q: number): void {
    let k = -1;
    if (cacheRows > 0) {
      k = ((g * T + ti) * cacheRows + (q & (cacheRows - 1))) * cacheCols + (p & (cacheCols - 1));
      if (tagQ[k] === q && tagP[k] === p && (!rollingShutter || tagT[k] === times[ti])) {
        lf = cacheFactor[k]!;
        if (materials) lm = cacheMaterial[k]!; else for (let n = 0; n < nodes; n++) radiance[n] = cacheRadiance[k * nodes + n]!;
        return;
      }
    }
    const group = groups[g]!;
    map((p + 0.5 + group.fx - W / 2) * mmPerSite, (q + 0.5 + group.fy - H / 2) * mmPerSite, times[ti]!);
    lf = pf;
    if (materials) { lm = materialOf(materials.materialAt(pu, pv)); lookups++; }
    else { for (let n = 0; n < nodes; n++) radiance[n] = radianceAt!(pu, pv, input.wavelengthsNm[n]!, times[ti]!); lookups += nodes; }
    if (k >= 0) {
      tagQ[k] = q; tagP[k] = p; tagT[k] = times[ti]!; cacheFactor[k] = lf;
      if (materials) cacheMaterial[k] = lm; else for (let n = 0; n < nodes; n++) cacheRadiance[k * nodes + n] = radiance[n]!;
    }
  }
  function kernelSite(x: number, y: number): number {
    const c = channelAt(x, y), rowMask = cacheRows - 1, colMask = cacheCols - 1;
    let total = 0;
    times = timesAt(x, y);
    for (let ti = 0; ti < T; ti++) {
      let sum = 0;
      const time = times[ti];
      acc.reset();
      for (let g = 0; g < G; g++) {
        const group = groups[g]!, p0 = x + group.minIx - R, q0 = y + group.minIy - R, cw = group.cw, ch = group.ch;
        if (materials) {
          const k = group.nodeKernels[c]!;
          for (let dy = 0, t = 0; dy < ch; dy++) {
            // The cache row of lattice row q (read inline: the common case is a hit).
            const q = q0 + dy, row = cacheRows > 0 ? ((g * T + ti) * cacheRows + (q & rowMask)) * cacheCols : -1;
            for (let dx = 0; dx < cw; dx++, t++) {
              const p = p0 + dx;
              const at = row + (p & colMask);
              if (row >= 0 && tagQ[at] === q && tagP[at] === p && (!rollingShutter || tagT[at] === time)) { lm = cacheMaterial[at]!; lf = cacheFactor[at]!; } else lattice(g, ti, p, q);
              if (perTap) {
                // #655 step 2 (#643 with a field factor): the tap's material spectrum against its kernel per node, then its factor; taps in order.
                const L = spectra[lm]!;
                let v = 0;
                for (let n = 0, a = t * nodes; n < nodes; n++) v += L[n]! * k[a + n]!;
                sum += lf * v;
              } else acc.add(lm, k, t * nodes, lf);
            }
          }
        } else for (let dy = 0, t = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++, t++) {
          lattice(g, ti, p0 + dx, q0 + dy);
          let value = 0;
          for (let n = 0; n < nodes; n++) value += group.perNode[n]![c]![t]! * radiance[n]!;
          sum += lf * value;
        }
      }
      total += materials && !perTap ? acc.value() : sum;
    }
    return total / T;
  }
  // #655: the catalogue PSF path. B(p)[n] = Σ_o w_o·F(p + o)·L(p + o)[n] of lattice point p (the offsets' group lattice points, each
  // through `lattice`), kept per midpoint in a ring tagged with (p, q) and the instant, with the material every offset read (−1 when
  // they differ, or for radiance scenes) and F̄(p) = Σ_o w_o·F(p + o).
  const width = 2 * R + 1, taps = width * width, tapU = new Int32Array(taps), tapV = new Int32Array(taps);
  for (let t = 0; t < taps; t++) { tapU[t] = t % width - R; tapV[t] = Math.floor(t / width) - R; }
  const uniformOn = usePsf && lens.uniformWindows === true && materials !== undefined && R >= 1;
  let bRows = 0, bCols = 0, bTagQ = new Int32Array(0), bTagP = new Int32Array(0), bTagT = new Float64Array(0), bValues = new Float64Array(0), bMaterial = new Int32Array(0), bFactor = new Float64Array(0);
  const scratchB = usePsf ? new Float64Array(taps * nodes) : new Float64Array(0), scratchMaterial = new Int32Array(taps), scratchFactor = new Float64Array(taps), tapAt = new Int32Array(taps);
  let bm = -1, bf = 0, uniformSites = 0;
  // The offsets as (group, integer offset, weight), groups in order and members in order.
  const offGroup: number[] = [], offIx: number[] = [], offIy: number[] = [], offW: number[] = [];
  for (let g = 0; g < G; g++) for (const member of groups[g]!.members) { offGroup.push(g); offIx.push(member.ix); offIy.push(member.iy); offW.push(member.weight); }
  const offCount = offGroup.length;
  function bPoint(ti: number, p: number, q: number, out: Float64Array, at: number): void {
    out.fill(0, at, at + nodes);
    let m = -2, f = 0;
    for (let o = 0; o < offCount; o++) {
      lattice(offGroup[o]!, ti, p + offIx[o]!, q + offIy[o]!);
      const wf = offW[o]! * lf;
      f += wf;
      if (materials) {
        const L = spectra[lm]!;
        for (let n = 0; n < nodes; n++) out[at + n] = out[at + n]! + wf * L[n]!;
        m = m === -2 || m === lm ? lm : -1;
      } else { for (let n = 0; n < nodes; n++) out[at + n] = out[at + n]! + wf * radiance[n]!; m = -1; }
    }
    bm = m < 0 ? -1 : m; bf = f;
  }
  const centre = R * width + R;
  function psfSite(x: number, y: number): number {
    const c = channelAt(x, y), zone = psf!.zoneKernels(psf!.zoneOf(x, y), input.wavelengthsNm), Ac = A[c]!, K = zone.perNode;
    const rowMask = bRows - 1, colMask = bCols - 1;
    let total = 0;
    times = timesAt(x, y);
    for (let ti = 0; ti < T; ti++) {
      const time = times[ti]!;
      let src: Float64Array, mats: Int32Array, facs: Float64Array;
      if (bRows > 0) {
        src = bValues; mats = bMaterial; facs = bFactor;
        for (let t = 0; t < taps; t++) {
          const p = x - tapU[t]!, q = y - tapV[t]!, k = ((ti * bRows) + (q & rowMask)) * bCols + (p & colMask);
          if (!(bTagQ[k] === q && bTagP[k] === p && (!rollingShutter || bTagT[k] === time))) {
            bPoint(ti, p, q, bValues, k * nodes);
            bTagQ[k] = q; bTagP[k] = p; bTagT[k] = time; bMaterial[k] = bm; bFactor[k] = bf;
          }
          tapAt[t] = k * nodes;
        }
      } else {
        src = scratchB; mats = scratchMaterial; facs = scratchFactor;
        for (let t = 0; t < taps; t++) { bPoint(ti, x - tapU[t]!, y - tapV[t]!, scratchB, t * nodes); scratchMaterial[t] = bm; scratchFactor[t] = bf; tapAt[t] = t * nodes; }
      }
      // tapAt holds each tap's offset in src (point index × nodes); its material and factor are at the point index.
      let value = 0, uniform = uniformOn;
      if (uniform) { const m = mats[tapAt[0]! / nodes]!; if (m < 0) uniform = false; else for (let t = 1; t < taps; t++) if (mats[tapAt[t]! / nodes] !== m) { uniform = false; break; } }
      if (uniform) {
        // #655 step 6: F̄(x − t) ≈ F̄₀ + ∇F̄·d + ½·dᵀ·H·d with d = −t, the gradient and Hessian by central differences of the taps
        // next to the centre (the plan's first-order form measured 5.4e-6 at most against the full method, above its 1e-6 bound).
        const fac = (t: number): number => facs[tapAt[t]! / nodes]!;
        const L = spectra[mats[tapAt[0]! / nodes]!]!, f0 = fac(centre);
        // Taps (u, v) read F̄(x − u, y − v): tap centre − 1 reads x + 1, centre − width reads y + 1.
        const xp = fac(centre - 1), xm = fac(centre + 1), yp = fac(centre - width), ym = fac(centre + width);
        const gx = (xp - xm) / 2, gy = (yp - ym) / 2;
        const hxx = xp - 2 * f0 + xm, hyy = yp - 2 * f0 + ym, hxy = (fac(centre - width - 1) - fac(centre - width + 1) - fac(centre + width - 1) + fac(centre + width + 1)) / 4;
        for (let n = 0; n < nodes; n++) value += L[n]! * Ac[n]! * (f0 * zone.sums[n]! + gx * zone.momentX[n]! + gy * zone.momentY[n]! +
          0.5 * (hxx * zone.momentXX[n]! + hyy * zone.momentYY[n]!) + hxy * zone.momentXY[n]!);
        uniformSites++;
      } else for (let n = 0; n < nodes; n++) {
        const k = K[n]!;
        let s = 0;
        for (let t = 0; t < taps; t++) s += k[t]! * src[tapAt[t]! + n]!;
        value += Ac[n]! * s;
      }
      total += value;
    }
    return total / T;
  }
  const pilotNode = input.wavelengthsNm[Math.floor(nodes / 2)]!;
  // #632: the veil's mean radiance per node over the frame's site lattice, and each site's veil integrated with its own channel response.
  const veil = lens.veil, mean = new Float64Array(nodes);
  if (veil) {
    if (!materials) throw new InvalidConfigurationError("lens.catalogue.flare needs a chart or material scene.");
    let count = 0;
    for (let q = veil.step >> 1; q < H; q += veil.step) for (let p = veil.step >> 1; p < W; p += veil.step, count++) {
      map((p + 0.5 - W / 2) * mmPerSite, (q + 0.5 - H / 2) * mmPerSite, times[0]!);
      if (pf === 0) continue;
      const L = spectra[materialOf(materials.materialAt(pu, pv))]!;
      lookups++;
      for (let n = 0; n < nodes; n++) mean[n] = mean[n]! + pf * L[n]!;
    }
    for (let n = 0; n < nodes; n++) mean[n] = mean[n]! / count;
  }
  const veiled = <S extends DisplayViewExpectedSignal>(signal: S): S => {
    if (!veil) return signal;
    const inner = signal.site.bind(signal), g = veil.fraction;
    signal.site = (x: number, y: number): number => { const a = A[channelAt(x, y)]!; let v = 0; for (let n = 0; n < nodes; n++) v += a[n]! * mean[n]!; return (1 - g) * inner(x, y) + g * v; };
    return signal;
  };
  if (input.largeKernel) {
    if (!rollingShutter) return veiled(createLargeLensSignal(input, (x0, y0, TS) => inFocusLensTile(x0, y0, TS), () => lookups, pilot));
    // #651: under a rolling shutter by row blocks, each block's rows at one set of instants (each row's own, or its band's middle row's).
    if (!rolling || rolling.lines !== "rows")
      throw new InvalidConfigurationError("simulateDisplayView: the regrouped defocus under a rolling shutter needs a shutter that scans by rows (each native row has its own instants).");
    return veiled(createRollingRegroupedLensSignal({ input, bandRows: lens.rollingBands ? rolling.bands.rows : 1, instantsOfRow: (y) => timesAt(0, y),
      inFocus: inFocusLensRect, lookups: () => lookups, pilot }));
  }
  /** E_c (#564) of the native site positions [x0, x0 + T) × [y0, y0 + T) for the three channels: kernelSite's sum for each channel. */
  function inFocusLensTile(x0: number, y0: number, TS: number): Float64Array[] {
    const out = [0, 1, 2].map(() => new Float64Array(TS * TS));
    // A fixed tile reaches past the raster: positions more than the disc's radius beyond it feed no site, so they stay 0 and are never
    // mapped (the lens profiles are checked only up to the view's reach).
    const D = input.largeKernel!.radius;
    if (x0 + TS <= -D || x0 >= W + D || y0 + TS <= -D || y0 >= H + D) return out;
    if (x0 < -D || x0 + TS > W + D || y0 < -D || y0 + TS > H + D) {
      const xa = Math.max(x0, -D), xb = Math.min(x0 + TS, W + D), ya = Math.max(y0, -D), yb = Math.min(y0 + TS, H + D);
      const part = inFocusLensRect(xa, ya, xb - xa, yb - ya, lens.times, 7);
      for (let c = 0; c < 3; c++) for (let y = ya; y < yb; y++) out[c]!.set(part[c]!.subarray((y - ya) * (xb - xa), (y - ya + 1) * (xb - xa)), (y - y0) * TS + xa - x0);
      return out;
    }
    return inFocusLensRect(x0, y0, TS, TS, lens.times, 7);
  }
  /**
   * E_c of the native site positions [x0, x0 + w) × [y0, y0 + h), row-major, with the scene read at `instants` (their mean), for the
   * channels whose bit is set in `channels` (bit c for channel c; the others stay 0). #612 (`inFocusPerTap`): each tap integrated from its
   * material's spectrum per node and the taps added in order; otherwise per-material sums.
   */
  function inFocusLensRect(x0: number, y0: number, TW: number, TH: number, instants: readonly number[], channels: number): Float64Array[] {
    const out = [0, 1, 2].map(() => new Float64Array(TW * TH)), sum = [0, 1, 2].map(() => new Float64Array(TW * TH)), M = instants.length;
    const perTapInFocus = input.inFocusPerTap === true;
    for (let ti = 0; ti < M; ti++) {
      for (const e of sum) e.fill(0);
      for (const group of groups) {
        const cw = group.cw, ch = group.ch, gw = TW + cw - 1, gh = TH + ch - 1, p0 = x0 + group.minIx - R, q0 = y0 + group.minIy - R;
        const factor = new Float64Array(gw * gh), material = materials ? new Int32Array(gw * gh) : undefined, values = materials ? undefined : new Float64Array(gw * gh * nodes);
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
          const k = j * gw + i;
          map((p0 + i + 0.5 + group.fx - W / 2) * mmPerSite, (q0 + j + 0.5 + group.fy - H / 2) * mmPerSite, instants[ti]!);
          factor[k] = pf;
          if (material) material[k] = materialOf(materials!.materialAt(pu, pv));
          else for (let n = 0; n < nodes; n++) values![k * nodes + n] = radianceAt!(pu, pv, input.wavelengthsNm[n]!, instants[ti]!);
        }
        lookups += material ? gw * gh : gw * gh * nodes;
        for (let c = 0; c < 3; c++) {
          if ((channels & (1 << c)) === 0) continue;
          const e = sum[c]!, kc = material ? group.nodeKernels[c]! : undefined;
          for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
            let v = 0;
            if (material && perTapInFocus) {
              for (let dy = 0, t = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++, t++) {
                const k = (y + dy) * gw + x + dx, L = spectra[material[k]!]!;
                let r = 0;
                for (let n = 0, a = t * nodes; n < nodes; n++) r += L[n]! * kc![a + n]!;
                v += factor[k]! * r;
              }
            } else {
              acc.reset();
              for (let dy = 0, t = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++, t++) {
                const k = (y + dy) * gw + x + dx;
                if (material) acc.add(material[k]!, kc!, t * nodes, factor[k]!);
                else { let r = 0; for (let n = 0; n < nodes; n++) r += group.perNode[n]![c]![t]! * values![k * nodes + n]!; v += factor[k]! * r; }
              }
              if (material) v = acc.value();
            }
            e[y * TW + x] = e[y * TW + x]! + v;
          }
        }
      }
      for (let c = 0; c < 3; c++) { const o = out[c]!, e = sum[c]!; for (let k = 0; k < o.length; k++) o[k] = o[k]! + e[k]!; }
    }
    for (const o of out) for (let k = 0; k < o.length; k++) o[k] = o[k]! / M;
    return out;
  }
  // Site values persist across windows in a ring of native rows (a site's value does not depend on the window).
  let ringRows = 0, ring = new Float64Array(0), ringRowId = new Int32Array(0), ringOn = false;
  const compute = usePsf ? psfSite : kernels ? kernelSite : directSite;
  return veiled({
    get lookups(): number { return lookups; },
    /** #655: sites the uniform-window method took (diagnostics). */
    get uniformWindowSites(): number { return uniformSites; },
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
      const span = Number.isFinite(spanColumns) ? spanColumns : W;
      if (usePsf) {
        // #655: the B ring covers the window's sites and their taps, two such heights, and the columns the render's windows span.
        const height = sh + 2 * R, width = sw + 2 * R;
        let rows = pow2(2 * height), cols = pow2(Math.min(W + 4 * R + 2, Math.max(width, span + width)));
        const fits = (r: number, c: number): boolean => T * r * c * (nodes + 3) <= B_CACHE_LIMIT;
        if (!fits(rows, cols)) rows = pow2(height);
        if (!fits(rows, cols)) cols = pow2(width);
        if (!fits(rows, cols)) bRows = 0;
        else if (rows > bRows || cols > bCols) {
          rows = Math.max(rows, bRows); cols = Math.max(cols, bCols);
          if (!fits(rows, cols)) { rows = pow2(height); cols = pow2(width); }
          bRows = rows; bCols = cols;
          const size = T * rows * cols;
          bTagQ = new Int32Array(size).fill(-2147483648); bTagP = new Int32Array(size); bTagT = new Float64Array(size); bValues = new Float64Array(size * nodes);
          bMaterial = new Int32Array(size); bFactor = new Float64Array(size);
        }
        // Each group lattice point serves one B point per member: the ring below only pays for itself with several members per group.
        if (groups.every((g) => g.members.length === 1)) { cacheRows = 0; return; }
      }
      // The lattice rectangle the window's sites read, per group; the cache keeps two such heights and the columns the render's windows span.
      let cw = 0, ch = 0;
      for (const group of groups) { cw = Math.max(cw, group.cw); ch = Math.max(ch, group.ch); }
      const height = sh + ch - 1, width = sw + cw - 1;
      let rows = pow2(2 * height), cols = pow2(Math.min(W + 2 * (R + cw), Math.max(width, span + width)));
      if (slots * per * rows * cols > LATTICE_CACHE_LIMIT) rows = pow2(height);
      if (slots * per * rows * cols > LATTICE_CACHE_LIMIT) cols = pow2(width);
      if (slots * per * rows * cols > LATTICE_CACHE_LIMIT) { cacheRows = 0; return; }
      if (rows > cacheRows || cols > cacheCols) {
        rows = Math.max(rows, cacheRows); cols = Math.max(cols, cacheCols);
        if (slots * per * rows * cols > LATTICE_CACHE_LIMIT) { rows = pow2(height); cols = pow2(width); }
        cacheRows = rows; cacheCols = cols;
        const size = slots * rows * cols;
        tagQ = new Int32Array(size).fill(-2147483648); tagP = new Int32Array(size); tagT = new Float64Array(size); cacheFactor = new Float64Array(size);
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
  });
  /**
   * The renderer's pilot point is a rectilinear plane point of the native raster: back to the sensor point, then through the lens at
   * every temporal midpoint. A point whose scene value differs between the instants (motion) counts as detail (NaN equals nothing).
   */
  function pilot(u: number, v: number): number {
    const g = 2 / input.outputWidth, xMm = u / g * mmPerSite, yMm = -v / g * mmPerSite;
    let first = NaN;
    // #640: the instants of the nearest site.
    times = timesAt(Math.min(W - 1, Math.max(0, Math.floor(xMm / mmPerSite + W / 2))), Math.min(H - 1, Math.max(0, Math.floor(yMm / mmPerSite + H / 2))));
    try {
      for (let ti = 0; ti < T; ti++) {
        map(xMm, yMm, times[ti]!);
        const value = beyond ? -1 : materials ? materials.materialAt(pu, pv) : radianceAt!(pu, pv, pilotNode, times[ti]!);
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
