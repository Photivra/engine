// SPDX-License-Identifier: Apache-2.0

/**
 * #568: the fast method of `simulateCapture`'s `lens.catalogue` (requested with `fast: true` or `lens.catalogue.fast`): each
 * native site's expected photo electrons from tables instead of the environment PSF quadrature's per-tap scene queries.
 * Loaded on demand with the catalogue (`generic-lens-capture.ts`), so a capture without a catalogue lens never loads it.
 *
 * What the exact method computes. The environment PSF quadrature forms, for site q of CFA channel c,
 *   μ_c(q) = Σ_λ A_c(λ) Σ_k K_{q,λ}(k)·F(s_k)·L(D(s_k), λ),   s_k = q + (c_x − k_x, k_y − c_y)·p,
 * with K_{q,λ} the catalogue PSF resolved at the site's own field point (`resolveLensSampledPsfKernel`: the profile's 5 × 5 field
 * nodes × 5 wavelength nodes interpolated with centroid alignment; row index k_y increases with image +Y, `sensorPsfSourcePoint`),
 * F = T·A the field factor at the tap point (vignetting throughput × distortion area factor), D the scene ray (inverse radial
 * distortion, then the rectilinear or equisolid projection at the thin-lens image distance) and A_c(λ) the electrons per unit
 * spectral radiance on the axis (the tabulated path's channel response). Every tap of a site-centre query is a lattice point.
 *
 * The approximation (the only one). Resolving K_{q,λ} at every site and spectral node is what makes the exact method slow, so the
 * fast method resolves it exactly on a field grid and blends it bilinearly between the four grid points around each site:
 *   K̃_{q,λ} = Σ_g b_g(q)·K_{g,λ}.
 * The grid subdivides each interval between the profile's field nodes into at least GRID_MINIMUM_SUBDIVISIONS cells, and into
 * more where the node kernels' intensity centroids move by more than GRID_CENTROID_STEP_SITES sites across the interval (lateral
 * colour moves the PSF across the frame; a blend of two shifted kernels is not the shifted kernel). Since the blend is linear,
 * the channel response and the material radiance fold into the grid kernels once per grid point:
 *   μ̃_c(q) = Σ_k F(s_k)·Σ_g b_g(q)·W_{g,c,m(s_k)}(k),   W_{g,c,m}(k) = Σ_λ A_c(λ)·L_m(λ)·K_{g,λ}(k),
 * so a site costs (2R + 1)² taps instead of (2R + 1)² scene queries per spectral node. Its error against the exact method is
 * bounded by ‖K̃ − K‖₁ times the brightest tap's signal; tests measure both (test/simulate-capture-lens-catalogue-fast.test.ts).
 *
 * The scene points. The mapping is the environment's (`undistortedImagePoint`, `lensProjectionDirectionValue`, the planar
 * provider's plane point), with the radial inverse solved by Newton's method instead of bisection: both converge to the same
 * root to rounding. Outside a circular fisheye's image circle (`outsideImageCircle: "backward-ray"`) and beyond the horizon the
 * scene radiance is zero, as in the capture.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { insideRadialImageCircle, lensProjectionDirectionValue } from "../camera/lens-projection.js";
import { resolveProjectionDistanceMm } from "../motion/camera-rotation.js";
import { prepareIlluminationVignettingThroughput, type IlluminationVignettingProfile } from "../optics/illumination-vignetting.js";
import { resolveLensSampledPsfKernel, type ResolveLensSampledPsfInput } from "../optics/lens-psf-profile.js";
import type { DisplayViewScene } from "./expected-signal.js";

/** Fewest grid cells between neighboring profile field nodes. */
export const CATALOGUE_FAST_GRID_MINIMUM_SUBDIVISIONS = 4;
/** Largest move of a node kernel's intensity centroid across one grid cell, in sites (sets finer grids where lateral color moves the PSF). */
export const CATALOGUE_FAST_GRID_CENTROID_STEP_SITES = 0.05;
/**
 * Largest relative difference between the fast and the exact expected electrons that the run-time verification (one site per
 * CFA phase through the exact chain, `renderTabulatedNativeRaw`) accepts; above it the capture runs the exact method.
 */
export const CATALOGUE_FAST_VERIFICATION_TOLERANCE = 0.005;
/** Largest cache window, in lattice points; a larger window is evaluated without caching. */
const WINDOW_LIMIT = 1 << 22;
const NEWTON_ITERATIONS = 60;

export interface CatalogueLensSignalInput {
  nativeWidth: number;
  nativeHeight: number;
  /** Site pitch, µm. */
  pitch: number;
  /** The catalogue PSF's optical state (profile, focal length, focus, f-number, defocus), as the site inputs' `psf.configuration.psf`. */
  psf: Omit<ResolveLensSampledPsfInput, "fieldPointMm" | "wavelengthNm">;
  /** Spectral nodes and, per CFA channel (red, green, blue), the expected electrons per unit spectral radiance at each node. */
  wavelengthsNm: readonly number[];
  electronsPerRadiance: readonly [Float64Array, Float64Array, Float64Array];
  /** The scene's chart materials (the tabulated path's material tables). */
  scene: Extract<DisplayViewScene, { kind: "materials" }>;
  /** CFA channel index (0 red, 1 green, 2 blue) of native site (x, y). */
  channelAt(x: number, y: number): number;
  /** The radial distortion profile (r_d = r·(1 + k1ρ² + k2ρ⁴ + k3ρ⁶), ρ = r / normalizationRadiusMm); absent without distortion. */
  distortion?: { normalizationRadiusMm: number; coefficients: { k1: number; k2: number; k3: number } };
  vignetting?: IlluminationVignettingProfile;
  projection: "rectilinear" | "fisheye-equisolid-angle";
  /** True for a catalogue fisheye: a sensor point outside the image circle looks straight back and sees no scene. */
  outsideImageCircleSeesNothing: boolean;
  focalLengthMm: number;
  focusDistanceM: number;
  /** The planar provider's plane distance and frame-unit scale. */
  distanceM: number;
  metresPerFrameUnit: number;
  /** Internal test hook: resolve every site's kernels exactly (the exact method's sum, slowly) instead of blending the grid. */
  exactKernels?: boolean;
}

export interface CatalogueLensSignal {
  /** Starts a cache window of native sites [x0, x1) × [y0, y1) (see `DisplayViewExpectedSignal.window`). */
  window(x0: number, y0: number, x1: number, y1: number): void;
  /** Expected photo electrons of native site (x, y) for its own CFA channel. */
  site(x: number, y: number): number;
  /** Scene material lookups so far. */
  readonly lookups: number;
  /** Grid points per axis (columns, rows) and how many were resolved so far. */
  readonly grid: { columns: number; rows: number; resolved: number };
}

/** A kernel's intensity centroid, in samples. */
function centroid(values: readonly number[], width: number): { x: number; y: number } {
  let sum = 0, x = 0, y = 0;
  for (let i = 0; i < values.length; i++) { const v = values[i]!; sum += v; x += v * (i % width); y += v * Math.floor(i / width); }
  return { x: x / sum, y: y / sum };
}

/**
 * The grid axes: each interval between neighboring profile field nodes split into max(GRID_MINIMUM_SUBDIVISIONS,
 * ⌈Δc / GRID_CENTROID_STEP_SITES⌉) equal cells, Δc the largest centroid move between the interval's two nodes over the other
 * axis's nodes and the wavelength nodes.
 */
export function catalogueFastGridAxes(psf: CatalogueLensSignalInput["psf"]): { x: number[]; y: number[] } {
  const profile = psf.profile, axes = profile.axes, fx = axes.fieldXmm, fy = axes.fieldYmm, wl = axes.wavelengthNm;
  const centroids = new Map<string, { x: number; y: number }>();
  for (const node of profile.nodes) {
    const c = node.coordinate;
    centroids.set(c.fieldXmm + ":" + c.fieldYmm + ":" + c.wavelengthNm, centroid(node.kernel.normalizedIntensity, node.kernel.widthSamples));
  }
  const at = (x: number, y: number, nm: number): { x: number; y: number } => {
    const c = centroids.get(x + ":" + y + ":" + nm);
    if (!c) throw new InvalidConfigurationError("lens.catalogue fast: the PSF profile lacks a field node.");
    return c;
  };
  const axis = (own: readonly number[], other: readonly number[], along: boolean): number[] => {
    const out: number[] = [];
    for (let i = 0; i + 1 < own.length; i++) {
      let move = 0;
      for (const o of other) for (const nm of wl) {
        const a = along ? at(own[i]!, o, nm) : at(o, own[i]!, nm), b = along ? at(own[i + 1]!, o, nm) : at(o, own[i + 1]!, nm);
        move = Math.max(move, Math.hypot(a.x - b.x, a.y - b.y));
      }
      const cells = Math.max(CATALOGUE_FAST_GRID_MINIMUM_SUBDIVISIONS, Math.ceil(move / CATALOGUE_FAST_GRID_CENTROID_STEP_SITES - 1e-9));
      for (let k = 0; k < cells; k++) out.push(own[i]! + (own[i + 1]! - own[i]!) * k / cells);
    }
    out.push(own[own.length - 1]!);
    return out;
  };
  return { x: axis(fx, fy, true), y: axis(fy, fx, false) };
}

/** The cell [i, i + 1] of an ascending axis holding v (clamped to the ends) and v's weight toward i + 1. */
function cellOf(axis: readonly number[], v: number): { i: number; f: number } {
  let lo = 0, hi = axis.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (axis[mid]! <= v) lo = mid; else hi = mid - 1; }
  const f = (v - axis[lo]!) / (axis[lo + 1]! - axis[lo]!);
  return { i: lo, f: Math.min(1, Math.max(0, f)) };
}

/**
 * Internal test hook (never set by the engine): `exactKernels` makes the facade's signals resolve every site's kernels exactly;
 * `onInput` receives each input the facade builds, so a test can compare the grid blend with the exact sum site by site.
 */
export interface CatalogueLensSignalTestHook { exactKernels?: boolean; onInput?(input: CatalogueLensSignalInput): void }
let testHook: CatalogueLensSignalTestHook | undefined;
export function setCatalogueLensSignalTestHook(hook: CatalogueLensSignalTestHook | undefined): void { testHook = hook; }

/** The fast method's expected signal (see the module comment). */
export function createCatalogueLensSignal(given: CatalogueLensSignalInput): CatalogueLensSignal {
  testHook?.onInput?.(given);
  const input = testHook?.exactKernels ? { ...given, exactKernels: true } : given;
  const { nativeWidth: W, nativeHeight: H, psf, wavelengthsNm, electronsPerRadiance: A, scene, channelAt } = input;
  const mmPerSite = input.pitch / 1000, nodes = wavelengthsNm.length;
  const first = psf.profile.nodes[0];
  if (!first) throw new InvalidConfigurationError("lens.catalogue fast: the PSF profile has no nodes.");
  const kw = first.kernel.widthSamples, kh = first.kernel.heightSamples, cx = first.kernel.centerSampleX, cy = first.kernel.centerSampleY, taps = kw * kh;
  for (const node of psf.profile.nodes) if (node.kernel.widthSamples !== kw || node.kernel.heightSamples !== kh || node.kernel.centerSampleX !== cx || node.kernel.centerSampleY !== cy)
    throw new InvalidConfigurationError("lens.catalogue fast: the PSF profile's kernels differ in size.");
  // Lattice reach of the taps around a site: x from −cx … kw − 1 − cx (as c_x − k_x), y from −cy … kh − 1 − cy.
  const reachLeft = kw - 1 - cx, reachRight = cx, reachUp = cy, reachDown = kh - 1 - cy;
  // Materials: neutral ones by reflectance (class 0, the white radiance), spectral ones by class 1 + index.
  const M = scene.materials.length, reflectance = new Float64Array(M), materialClass = new Int32Array(M);
  const spectral: Float64Array[] = [];
  scene.materials.forEach((m, index) => { if ("neutral" in m) reflectance[index] = m.neutral; else { materialClass[index] = 1 + spectral.length; spectral.push(m.radiance); } });
  const classes = 1 + spectral.length, classRadiance = [scene.whiteRadiance, ...spectral];
  const tableSize = 3 * classes * taps;
  // W_{c,m}(k) = Σ_λ A_c(λ)·L_m(λ)·K_λ(k) for the kernels of one field point.
  const foldKernels = (fieldXmm: number, fieldYmm: number): Float64Array => {
    const table = new Float64Array(tableSize);
    for (let n = 0; n < nodes; n++) {
      const kernel = resolveLensSampledPsfKernel({ ...psf, wavelengthNm: wavelengthsNm[n]!, fieldPointMm: { x: fieldXmm, y: fieldYmm } }).normalizedIntensity;
      if (kernel.length !== taps) throw new InvalidConfigurationError("lens.catalogue fast: a resolved kernel differs in size.");
      for (let c = 0; c < 3; c++) {
        const a = A[c]![n]!;
        if (a === 0) continue;
        for (let cl = 0; cl < classes; cl++) {
          const weight = a * classRadiance[cl]![n]!, base = (c * classes + cl) * taps;
          if (weight === 0) continue;
          for (let k = 0; k < taps; k++) table[base + k] = table[base + k]! + weight * kernel[k]!;
        }
      }
    }
    return table;
  };
  // The field grid, resolved lazily (a region render resolves only the grid points around it).
  const axes = catalogueFastGridAxes(psf), gx = axes.x, gy = axes.y, GX = gx.length;
  const tables: (Float64Array | undefined)[] = new Array(GX * gy.length);
  let resolved = 0;
  const tableAt = (i: number, j: number): Float64Array => {
    const k = j * GX + i;
    let t = tables[k];
    if (!t) { t = foldKernels(gx[i]!, gy[j]!); tables[k] = t; resolved++; }
    return t;
  };
  // Each native column's and row's grid cell and blend weight (field +Y up: row y sits at −(y + ½ − H/2)·p).
  const cellX = new Int32Array(W), weightX = new Float64Array(W), cellY = new Int32Array(H), weightY = new Float64Array(H);
  for (let x = 0; x < W; x++) { const c = cellOf(gx, (x + 0.5 - W / 2) * mmPerSite); cellX[x] = c.i; weightX[x] = c.f; }
  for (let y = 0; y < H; y++) { const c = cellOf(gy, -(y + 0.5 - H / 2) * mmPerSite); cellY[y] = c.i; weightY[y] = c.f; }

  // The scene point and field factor of a native sensor point (mm, +Y down); factor 0 where the scene radiance is zero.
  const pd = resolveProjectionDistanceMm(input.focalLengthMm, input.focusDistanceM).projectionDistanceMm;
  const planeScale = input.distanceM / input.metresPerFrameUnit;
  const throughputAt = input.vignetting ? prepareIlluminationVignettingThroughput(input.vignetting) : undefined;
  const distortion = input.distortion, rectilinear = input.projection === "rectilinear";
  let mu = 0, mv = 0, mf = 0;
  const map = (xMm: number, yMm: number): void => {
    const imageX = xMm, imageY = -yMm;
    let idealX = imageX, idealY = imageY, area = 1;
    if (distortion) {
      const { k1, k2, k3 } = distortion.coefficients, norm = distortion.normalizationRadiusMm, rd = Math.hypot(imageX, imageY) / norm;
      let rho = rd;
      if (rd > 0) {
        // Newton's method on ρ·s(ρ) = ρ_d (monotonic over the profile's validated range), from ρ = ρ_d.
        let converged = false;
        for (let it = 0; it < NEWTON_ITERATIONS; it++) {
          const r2 = rho * rho, value = rho * (1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2) - rd, slope = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2 + 7 * k3 * r2 * r2 * r2;
          if (!(slope > 0)) break;
          const step = value / slope;
          rho -= step;
          if (Math.abs(step) <= 4 * Number.EPSILON * rho) { converged = true; break; }
        }
        if (!converged || !(rho > 0)) throw new InvalidConfigurationError("lens.catalogue fast: the inverse distortion did not converge.");
      }
      const r2 = rho * rho, s = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2, derivative = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2 + 7 * k3 * r2 * r2 * r2;
      if (rd > 0) { idealX = imageX / s; idealY = imageY / s; }
      area = 1 / (s * derivative);
      if (!(area > 0) || !Number.isFinite(area)) throw new InvalidConfigurationError("lens.catalogue fast: the distortion area factor must stay finite and positive.");
    }
    const factor = (throughputAt ? throughputAt({ x: imageX, y: imageY }) : 1) * area;
    if (rectilinear) { mu = idealX / pd * planeScale; mv = idealY / pd * planeScale; mf = factor; return; }
    if (input.outsideImageCircleSeesNothing && !insideRadialImageCircle(input.projection, pd, Math.hypot(idealX, idealY))) { mf = 0; return; }
    const d = lensProjectionDirectionValue(input.projection, pd, idealX, idealY);
    if (!(d.z > 0)) { mf = 0; return; }
    mu = d.x * (input.distanceM / d.z) / input.metresPerFrameUnit; mv = d.y * (input.distanceM / d.z) / input.metresPerFrameUnit; mf = factor;
  };
  let lookups = 0;
  let lm = 0, lf = 0;
  /** The material and field factor of lattice point (p, q) (sites from the top-left site, the lattice formula). */
  const lattice = (p: number, q: number): void => {
    map((p + 0.5 - W / 2) * mmPerSite, (q + 0.5 - H / 2) * mmPerSite);
    lf = mf;
    if (mf === 0) { lm = 0; return; }
    const m = scene.materialAt(mu, mv);
    if (!(m >= 0 && m < M) || !Number.isInteger(m)) throw new InvalidConfigurationError("Unknown chart material.");
    lm = m; lookups++;
  };
  // The window's lattice: points [wx0, wx0 + ww) × [wy0, wy0 + wh).
  let wx0 = 0, wy0 = 0, ww = 0, wh = 0, winMaterial = new Int32Array(0), winFactor = new Float64Array(0);
  const window = (x0: number, y0: number, x1: number, y1: number): void => {
    const w = x1 - x0 + reachLeft + reachRight, h = y1 - y0 + reachUp + reachDown;
    if (!(w > 0 && h > 0) || w * h > WINDOW_LIMIT) { ww = 0; wh = 0; return; }
    wx0 = x0 - reachLeft; wy0 = y0 - reachUp; ww = w; wh = h;
    if (winMaterial.length < w * h) { winMaterial = new Int32Array(w * h); winFactor = new Float64Array(w * h); }
    for (let q = 0; q < h; q++) for (let p = 0; p < w; p++) { lattice(wx0 + p, wy0 + q); winMaterial[q * w + p] = lm; winFactor[q * w + p] = lf; }
  };
  const kernelOf = new Float64Array(tableSize);
  let cellI = -1, cellJ = -1, c00: Float64Array = kernelOf, c10: Float64Array = kernelOf, c01: Float64Array = kernelOf, c11: Float64Array = kernelOf;
  const site = (x: number, y: number): number => {
    const c = channelAt(x, y);
    let t00: Float64Array, t10: Float64Array, t01: Float64Array, t11: Float64Array, b00: number, b10: number, b01: number, b11: number;
    if (input.exactKernels) {
      kernelOf.set(foldKernels((x + 0.5 - W / 2) * mmPerSite, -(y + 0.5 - H / 2) * mmPerSite));
      t00 = t10 = t01 = t11 = kernelOf; b00 = 1; b10 = b01 = b11 = 0;
    } else {
      const i = cellX[x]!, j = cellY[y]!, fx = weightX[x]!, fy = weightY[y]!;
      // Neighboring sites share a cell: its four tables are kept from the last site.
      if (i !== cellI || j !== cellJ) { cellI = i; cellJ = j; c00 = tableAt(i, j); c10 = tableAt(i + 1, j); c01 = tableAt(i, j + 1); c11 = tableAt(i + 1, j + 1); }
      t00 = c00; t10 = c10; t01 = c01; t11 = c11;
      b00 = (1 - fx) * (1 - fy); b10 = fx * (1 - fy); b01 = (1 - fx) * fy; b11 = fx * fy;
    }
    const inside = ww > 0 && x - reachLeft >= wx0 && y - reachUp >= wy0 && x + reachRight < wx0 + ww && y + reachDown < wy0 + wh;
    const channelBase = c * classes * taps;
    let sum = 0;
    for (let ky = 0, k = 0; ky < kh; ky++) {
      const q = y + ky - cy;
      for (let kx = 0; kx < kw; kx++, k++) {
        const p = x + cx - kx;
        let m: number, f: number;
        if (inside) { const at = (q - wy0) * ww + p - wx0; m = winMaterial[at]!; f = winFactor[at]!; } else { lattice(p, q); m = lm; f = lf; }
        if (f === 0) continue;
        const cl = materialClass[m]!, at = channelBase + cl * taps + k;
        const w = b00 * t00[at]! + b10 * t10[at]! + b01 * t01[at]! + b11 * t11[at]!;
        sum += f * (cl === 0 ? reflectance[m]! * w : w);
      }
    }
    return sum;
  };
  return {
    window, site,
    get lookups(): number { return lookups; },
    get grid(): { columns: number; rows: number; resolved: number } { return { columns: GX, rows: gy.length, resolved }; }
  };
}

/** The `raw.expectedSignal` and `fast.lens.catalogue` assumptions of a capture the fast method rendered (kept here, out of the capture bundle's entry). */
export function catalogueFastAssumptions(run: { columns: number; rows: number; resolved: number; verificationRelativeDifference: number }):
  { id: string; value: Record<string, unknown>; explanation: string }[] {
  const tolerance = CATALOGUE_FAST_VERIFICATION_TOLERANCE, cells = CATALOGUE_FAST_GRID_MINIMUM_SUBDIVISIONS, step = CATALOGUE_FAST_GRID_CENTROID_STEP_SITES;
  return [{ id: "raw.expectedSignal", value: { method: "tabulated-expected-electrons-catalogue-psf-field-grid", verificationSites: 4, tolerance,
    verificationRelativeDifference: run.verificationRelativeDifference },
  explanation: "Each native site's expected photo electrons are tabulated: the sum over the PSF taps of the field factor (vignetting × distortion area factor) times the " +
    "grid-blended kernel folded with the channel response and the material radiance (see fast.lens.catalogue). The sensor stage (dark charge, Poisson draws, read noise, ADC) " +
    "is the native one with each site's own seeds. One site of each CFA phase ran the exact chain (the environment PSF quadrature): its readout was reproduced bit for bit and " +
    "its electrons agreed with the fast ones within the tolerance (verificationRelativeDifference: the largest difference there)." },
  { id: "fast.lens.catalogue", value: { method: "field-grid-bilinear-psf", gridColumns: run.columns, gridRows: run.rows, gridPointsResolved: run.resolved,
    minimumSubdivisions: cells, centroidStepSites: step, verificationTolerance: tolerance },
  explanation: "Fast method (#568), an approximation of the exact one: the catalogue PSF is resolved exactly on a field grid (each interval between the profile's field nodes " +
    "split into at least " + cells + " cells, more where the node kernels' centroids move by over " + step + " site per cell), and each site takes the bilinear blend of its " +
    "four grid points' kernels instead of its own. Its error is at most the kernels' L1 difference times the brightest tap's signal; docs/LENS_CATALOGUE.md (\"Fast method\") " +
    "records it measured against the exact method. Distortion, vignetting and projection are the exact method's (the radial inverse by Newton's method, equal to rounding)." }];
}
