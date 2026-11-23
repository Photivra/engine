// SPDX-License-Identifier: Apache-2.0

/**
 * `simulateCapture`'s `lens.defocus` out of focus together with a lens field mapping (`lens.projection`,
 * `lens.distortion`), `lens.vignetting` or camera rotation (#548): the geometric defocus disc applied in image space,
 * on the site lattice of the sensor, instead of on the scene plane.
 *
 * Why the object-space path does not apply. `createDiffractedPlanarProvider` convolves the scene radiance on the plane
 * lattice that the sites see through one linear map (a still, rectilinear, distortion-free camera with the same
 * radiance-to-irradiance factor everywhere). A projection, a distortion or a rotation makes the map from sensor points
 * to plane points non-linear (or time-dependent), and vignetting makes the factor vary over the field, so the disc on
 * the plane is no longer the disc on the sensor.
 *
 * The image-space model. The environment PSF quadrature (`calculateSensorPsfIrradianceQuadrature`, the per-tap path
 * `lens.diffraction` falls back to) defines a sensor-plane PSF K as
 *   E(q, λ, t) = Σ_k K(k)·F(s_k)·C·L(D_t(s_k), λ),
 * with s_k = q + k·p the tap source points on the sensor (p the site pitch), D_t the scene ray of a sensor point at
 * time t (inverse distortion, the declared projection, the camera rotation at t), F = T·A the field factor (vignetting
 * throughput T, applied once before the PSF spreads the light, and the distortion area factor A = 1/det J) and C the
 * paraxial radiance-to-irradiance factor π/(4·N_w²), the same everywhere. With K the defocus disc sampled on the site
 * lattice (`createDefocusDiscSiteKernel`), every source point of a site-centre query is another lattice point, so
 *   E(q, λ, t) = C·G_t(q, λ),  G_t = K ⊛ (F·L∘D_t) sampled on the lattice,
 * the same sum in a different floating-point order. This provider computes G_t once per spectral node and time on the
 * sensor lattice (in row bands, as the diffraction provider does) and answers the query of lattice point q at time t with
 * G_t(q, λ) / F(q); the environment multiplies by F(q)·C again, so each site gets C·G_t(q, λ). For the still,
 * rectilinear, distortion-free camera without vignetting it is the object-space convolution (F = 1 and D linear).
 *
 * The lattices. As in the diffraction provider, a pixel aperture or anti-aliasing spots add query offsets; each distinct
 * fractional offset gets its own shifted lattice of sensor points, and every tap of a query on one lattice is on the same
 * lattice. A query is located on its lattice by mapping its scene ray back to the sensor (camera rotation inverted at the
 * request's time, the forward projection, the forward distortion), within 1e-4 site; a query that lands on no lattice point
 * is refused rather than approximated.
 *
 * Time. With camera rotation each environment temporal midpoint is a still camera, so the disc is applied to that
 * instant's image in that instant's frame: one G_t per distinct request time, cached per band. Without rotation the image
 * does not depend on time and one G is kept. #640: under a rolling shutter each row's instants differ, so the facade asks for bands
 * of one row (each row's G_t at its own instants).
 *
 * What is approximate is the disc itself (`lens.defocus` labels it; the facade records the field-variation bounds of
 * each combination), not this evaluation of it.
 *
 * #761, #762: in-focus `lens.diffraction` with camera rotation, a moving subject, a lens mapping or vignetting, where the lattice
 * taps' quadrature (#565: one scene query per tap, each read at its lattice point) would pass the environment's 100000 queries per
 * site, takes each node's diffraction kernel as K here (`diffractionPsf`): the same terms, summed in another order. Its kept bands
 * are bounded (`capacityBytes`, 64 MiB): the band height falls to fit, down to one row, and a window whose one-row bands do not fit
 * is refused with the numbers.
 */

// #564: a defocus kernel above 64 sites (`largeKernel`) takes the run lattice of large-defocus-lattice.ts instead of the bands:
// the samples F·L at the same lattice points, convolved by runs in fixed tiles, then divided by each queried point's own F.
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { hypot3 } from "../core/portable-math.js";
import { isInternalSceneRadianceEvaluator, markInternalSceneRadianceEvaluator, registerInternalRadianceAccess } from "../core/internal-radiance-evaluator.js";
import type { SceneRadianceEvaluationRequest, SceneRadianceEvaluationResult } from "../schema/scene-radiance.js";
import { insideRadialImageCircle, lensProjectionDirectionValue, lensProjectionImagePointValue, type LensProjectionModel } from "../camera/lens-projection.js";
import { applyPhysicalCameraRotation, resolveProjectionDistanceMm, shakenAngularVelocity, type CameraAngularVelocityRadPerSec } from "../motion/camera-rotation.js";
import { prepareIlluminationVignettingThroughput, type IlluminationVignettingProfile } from "../optics/illumination-vignetting.js";
import { distortedImagePoint, undistortedImagePoint, type PreparedEnvironmentLensFieldMapping } from "../optics/sensor-environment-query.js";
import { checkedSiteKernel, createZonedGather, gatherInterior, kernelTaps, type SiteKernelFieldZones } from "./diffraction-provider.js";
import { siteDiffractionKernel } from "../optics/site-diffraction-kernel.js";
import type { PlanarSceneRadianceProvider } from "./scene-radiance.js";
import { LARGE_DEFOCUS_CACHE_BYTES, createLargeDefocusNodeLattice, type LargeDefocusKernel, type LargeDefocusNodeLattice } from "./large-defocus-lattice.js";

/** Rows of native sites per band; bands kept per time. Banding changes memory only, never values. */
const BAND_ROWS = 32;
const CACHED_BANDS = 2;
const LATTICE_TOLERANCE_SITES = 1e-4;

/** The camera geometry the environment uses for each site query (the same options as the site inputs). */
export interface DefocusImageSpaceGeometry {
  focalLengthMm: number;
  focusDistanceM: number;
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  /** #641: the site inputs' hand-shake trajectory (`motion.handShake`), added to the rotation. */
  handShake?: readonly number[];
  /** The site inputs' `lensFieldMapping`, prepared; omitted for the ideal rectilinear, distortion-free mapping. */
  lensMapping?: PreparedEnvironmentLensFieldMapping;
  /** The site inputs' radial-illumination-vignetting profile; omitted for unity field throughput. */
  vignetting?: IlluminationVignettingProfile;
  /**
   * #655: the display view's inverse of the lens mapping's distortion (`undistortedImagePointNewton`); omitted: `undistortedImagePoint`, the
   * capture's. #685: called with a third argument `out`; a result of undefined means the ideal x and y, the area factor and the point's
   * radius Math.hypot(x, y) are in out[0..3].
   */
  undistort?: (prepared: PreparedEnvironmentLensFieldMapping, imagePointMm: { x: number; y: number }, out: Float64Array) =>
    { ideal: { x: number; y: number }; distortionAreaFactor: number } | undefined;
}

/** Internal: the scene ray and field factor of sensor points, and the sensor point of a scene ray, for one geometry. */
export interface PreparedDefocusImageSpaceGeometry {
  /**
   * The unit look direction (toward the scene, reference camera axes at exposure start) of native sensor point (x, y) mm
   * (+X right, +Y down) at time t, and its field factor F = T·A (vignetting throughput × distortion area factor).
   */
  lookOf(xMm: number, yMm: number, timeSeconds: number): { x: number; y: number; z: number; factor: number };
  /** The native sensor point (mm, +Y down) whose scene ray at time t is the look direction; undefined outside the mapping. */
  sensorPointOf(look: { x: number; y: number; z: number }, timeSeconds: number): { x: number; y: number } | undefined;
  /** True with camera rotation: the ray of a sensor point depends on time. */
  timeDependent: boolean;
}

/** Internal: prepares {@link PreparedDefocusImageSpaceGeometry} with the environment's own conventions and arithmetic. */
export function prepareDefocusImageSpaceGeometry(geometry: DefocusImageSpaceGeometry): PreparedDefocusImageSpaceGeometry {
  const { focalLengthMm, focusDistanceM, angularVelocityRadPerSec: omega, handShake, lensMapping, vignetting } = geometry, undistort = geometry.undistort ?? undistortedImagePoint;
  // The projection scale: the thin-lens image distance at the finite focus, for every projection model (the environment's).
  const pd = resolveProjectionDistanceMm(focalLengthMm, focusDistanceM).projectionDistanceMm;
  const model: LensProjectionModel = lensMapping?.mapping.projectionModel ?? "rectilinear";
  // #569: with "backward-ray" (catalogue fisheyes), a point outside the image circle looks straight back, as the environment's mapped query does.
  const backward = lensMapping?.mapping.outsideImageCircle === "backward-ray";
  const timeDependent = omega.pitch !== 0 || omega.yaw !== 0 || omega.roll !== 0 || handShake !== undefined;
  // calculateIlluminationVignetting's throughput with the profile validated once (#563: the same numbers, without a result envelope per point).
  const throughputAt = vignetting ? prepareIlluminationVignettingThroughput(vignetting) : undefined;
  // #641: the environment's displacement, the (shaken) velocity at t times t.
  const displacement = (t: number): { pitch: number; yaw: number; roll: number } => {
    const w = shakenAngularVelocity(omega, handShake, t);
    return timeDependent ? { pitch: w.pitch * t, yaw: w.yaw * t, roll: w.roll * t } : { pitch: 0, yaw: 0, roll: 0 };
  };
  // The reference-to-camera rotation at the last time asked, as a matrix (its columns: the rotated basis vectors), so a lattice
  // lookup costs no trigonometry; the rotation is linear, so this equals rotating the vector, up to rounding.
  let matrixTime = NaN, m: number[] = [];
  const toCamera = (v: { x: number; y: number; z: number }, t: number): { x: number; y: number; z: number } => {
    if (t !== matrixTime) {
      const d = displacement(t), ex = applyPhysicalCameraRotation({ x: 1, y: 0, z: 0 }, d, "reference-to-camera"),
        ey = applyPhysicalCameraRotation({ x: 0, y: 1, z: 0 }, d, "reference-to-camera"), ez = applyPhysicalCameraRotation({ x: 0, y: 0, z: 1 }, d, "reference-to-camera");
      m = [ex.x, ey.x, ez.x, ex.y, ey.y, ez.y, ex.z, ey.z, ez.z];
      matrixTime = t;
    }
    return { x: m[0]! * v.x + m[1]! * v.y + m[2]! * v.z, y: m[3]! * v.x + m[4]! * v.y + m[5]! * v.z, z: m[6]! * v.x + m[7]! * v.y + m[8]! * v.z };
  };
  // #685: a still camera's rotation is the identity (applyPhysicalCameraRotation returns a copy of its vector), so the ray is
  // taken as it is, without the displacement, its Math.hypot and the copy; the same values.
  const toReference = (v: { x: number; y: number; z: number }, t: number): { x: number; y: number; z: number } =>
    timeDependent ? applyPhysicalCameraRotation(v, displacement(t), "camera-to-reference") : v;
  // #685: the non-allocating inverse's outputs (ideal x and y, area factor, the point's Math.hypot), read before the next call.
  const inverse = new Float64Array(4);
  return {
    timeDependent,
    lookOf(xMm, yMm, t): { x: number; y: number; z: number; factor: number } {
      const image = { x: xMm, y: -yMm };
      const u = lensMapping ? undistort(lensMapping, image, inverse) : { ideal: image, distortionAreaFactor: 1 };
      const ix = u ? u.ideal.x : inverse[0]!, iy = u ? u.ideal.y : inverse[1]!;
      let lx: number, ly: number, lz: number;
      if (model === "rectilinear") {
        // calculateInverseCameraRotationImageMapping: the captured ray (x/pd, y/pd, 1) in reference axes, projected at pd.
        const reference = toReference({ x: ix / pd, y: iy / pd, z: 1 }, t);
        if (!(reference.z > 0)) throw new InvalidConfigurationError("lens.defocus: a lattice point's ray points to or behind the reference camera plane.");
        lx = pd * (reference.x / reference.z); ly = pd * (reference.y / reference.z); lz = pd;
      } else {
        const reference = toReference(backward && !insideRadialImageCircle(model, pd, Math.hypot(ix, iy)) ? { x: 0, y: 0, z: -1 } : lensProjectionDirectionValue(model, pd, ix, iy), t);
        lx = reference.x; ly = reference.y; lz = reference.z;
      }
      const length = hypot3(lx, ly, lz);
      // #685: from the Newton inverse, the throughput takes its radius of the same point (Math.hypot(x, −y), finite): one hypot per point.
      const throughput = throughputAt ? (u ? throughputAt(image) : throughputAt.atRadius(inverse[3]!)) : 1;
      return { x: lx / length, y: ly / length, z: lz / length, factor: throughput * (u ? u.distortionAreaFactor : inverse[2]!) };
    },
    sensorPointOf(look, t): { x: number; y: number } | undefined {
      try {
        const c = timeDependent ? toCamera(look, t) : look;
        let ideal: { x: number; y: number };
        if (model === "rectilinear") {
          if (!(c.z > 0)) return undefined;
          ideal = { x: pd * (c.x / c.z), y: pd * (c.y / c.z) };
        } else ideal = lensProjectionImagePointValue(model, pd, c.x, c.y, c.z).imagePointMm;
        const image = lensMapping ? distortedImagePoint(lensMapping, ideal).pointMm : ideal;
        return Number.isFinite(image.x) && Number.isFinite(image.y) ? { x: image.x, y: -image.y } : undefined;
      } catch {
        return undefined;
      }
    }
  };
}

export interface DefocusImageSpaceProviderInput {
  base: PlanarSceneRadianceProvider;
  geometry: PreparedDefocusImageSpaceGeometry;
  /** Each spectral node's kernel on the site lattice, (2·kernelRadius + 1)² taps, row-major (the disc, or diffraction ⊛ disc). */
  siteKernels?: (wavelengthNm: number) => Float64Array;
  /** #761: instead of `siteKernels`, each node's diffraction kernel of this PSF on the site pitch (`siteDiffractionKernel`), radius `kernelRadius`. */
  diffractionPsf?: Parameters<typeof siteDiffractionKernel>[0];
  wavelengthsNm: readonly number[];
  kernelRadius: number;
  nativeWidth: number;
  nativeHeight: number;
  sitePitchMicrometers: number;
  /** Planar geometry of the base provider (plane distance and frame-unit scale), to find the plane point of a ray as it does. */
  distanceM: number;
  metresPerFrameUnit: number;
  /** Offsets of the query points from the site centres, in sites (+x right, +y down). Default: one zero offset. */
  queryOffsetsSites?: readonly { x: number; y: number }[];
  /** Region renders: the native sites that will be queried. Values are bit-identical to the whole render's. Default: the whole raster. */
  window?: { x: number; y: number; width: number; height: number };
  /** #551: the scene itself depends on time (a moving subject): each request time keeps its own image even without rotation. */
  timeDependentScene?: boolean;
  /**
   * Rows of native sites per band. Default 32. #640: 1 under a rolling shutter with rotation, where each row has its own instants and a
   * band of one instant serves one row only (the values are the same for any height).
   */
  bandRows?: number;
  /** Most distinct request times kept per band (the temporal sample count). Default 1. */
  timesPerBand?: number;
  /**
   * #761: bytes the kept bands may hold in all (every lattice shift, spectral node and instant, plus one band's grid while it is
   * built). The band height is then the largest (at most `bandRows`) that fits, down to one row; a window whose one-row bands do not
   * fit is refused with the numbers. Default: 64 MiB with `diffractionPsf`; otherwise `bandRows` as given, without a bound.
   */
  capacityBytes?: number;
  /**
   * #730 facade-14: the scene's material count (a fixed-size chart's surround included). With one kernel for every node, the
   * convolution is regrouped by material when there are fewer materials than nodes; the choice depends on the scene only, never on
   * the window. Omitted: never regrouped.
   */
  materialCount?: number | undefined;
  /** Called with the duration in ms of each band convolution (diagnostics only). */
  onConvolution?: (milliseconds: number) => void;
  /**
   * #564: a defocus kernel above the direct radius, convolved by runs in fixed tiles (`large-defocus-lattice.ts`), with each
   * node's diffraction kernel after it; used instead of `siteKernels` (`kernelRadius` is then unused).
   */
  largeKernel?: LargeDefocusKernel;
  /** #553: a field-varying kernel by zones (the cat's eye of lens.defocus), gathered instead of `siteKernels`, the same at every node. */
  fieldZones?: SiteKernelFieldZones;
  /**
   * #588, catalogue fisheyes (with the base provider's own `zeroBeyondHorizon`): a lattice point whose ray is at or beyond 90°
   * sees no scene (zero radiance), and a query in such a direction gets the base provider's zero, instead of failing.
   */
  zeroBeyondHorizon?: boolean;
}

/** Internal (not exported from the package): the base provider with the defocus disc applied in image space (#548). */
export function createDefocusImageSpaceProvider(input: DefocusImageSpaceProviderInput): PlanarSceneRadianceProvider {
  const { base, geometry, wavelengthsNm, nativeWidth: W, nativeHeight: H, kernelRadius: R } = input;
  const mmPerSite = input.sitePitchMicrometers / 1000;
  const index = new Map(wavelengthsNm.map((nm, i) => [nm, i]));
  const offsets = input.queryOffsetsSites ?? [{ x: 0, y: 0 }];
  const fraction = (value: number): number => { const f = value - Math.floor(value); return f > 1 - 1e-6 ? 0 : f < 1e-6 ? 0 : f; };
  const shifts: { x: number; y: number }[] = [];
  for (const o of offsets) {
    const f = { x: fraction(o.x), y: fraction(o.y) };
    if (!shifts.some((s) => Math.abs(s.x - f.x) <= 1e-6 && Math.abs(s.y - f.y) <= 1e-6)) shifts.push(f);
  }
  const M = Math.max(0, ...offsets.map((o) => Math.ceil(Math.max(Math.abs(o.x), Math.abs(o.y)) - 1e-6)));
  const LW = W + 2 * M, LH = H + 2 * M;
  const win = input.window ?? { x: 0, y: 0, width: W, height: H };
  const lx0 = Math.max(0, win.x), lx1 = Math.min(LW, win.x + win.width + 2 * M);
  const ly0 = Math.max(0, win.y), ly1 = Math.min(LH, win.y + win.height + 2 * M);
  if (!(lx0 < lx1 && ly0 < ly1)) throw new InvalidConfigurationError("Defocus window must overlap the native raster.");
  const NW = lx1 - lx0, gridWidth = NW + 2 * R;
  const large = input.largeKernel;
  const psf = input.diffractionPsf, kernels = large ? [] : wavelengthsNm.map((nm) => psf ? siteDiffractionKernel(psf, nm, input.sitePitchMicrometers, R, "Diffraction kernels must sample the site pitch exactly.") :
    checkedSiteKernel(input.siteKernels!(nm), R));
  const taps = kernels.map((kernel) => kernelTaps(kernel, R, gridWidth));
  const zonedGather = input.fieldZones ? createZonedGather(input.fieldZones, R, gridWidth, W, H, M) : undefined;
  const sharedKernel = !large && (zonedGather !== undefined || kernels.every((kernel) => kernel === kernels[0]));
  const scale = input.metresPerFrameUnit, distance = input.distanceM;
  const materialAt = base.chartMaterialAt?.bind(base), materialRadiance = base.materialRadiance?.bind(base), zeroBeyond = input.zeroBeyondHorizon === true;
  const timeDependent = geometry.timeDependent || input.timeDependentScene === true;
  // #761: with a byte budget, the tallest band (at most bandRows) whose kept bands fit: each holds shifts × nodes × rows × NW values, and
  // a site row's queries span 2M + 1 lattice rows at each of its instants (the cache's capacity below); one band's grid is built at a time.
  const times = timeDependent ? Math.max(1, input.timesPerBand ?? 1) : 1, rowBytes = shifts.length * wavelengthsNm.length * NW * 8 * times;
  const bandBytes = (rows: number): number => Math.max(CACHED_BANDS, Math.ceil((2 * M + 2) / rows)) * rows * rowBytes + gridWidth * (rows + 2 * R) * 40;
  let BAND = input.bandRows ?? BAND_ROWS;
  const capacityBytes = input.capacityBytes ?? (psf ? 64 * 1048576 : undefined);
  if (capacityBytes !== undefined) {
    while (BAND > 1 && bandBytes(BAND) > capacityBytes) BAND--;
    if (bandBytes(1) > capacityBytes) throw new InvalidConfigurationError("The image-space convolution keeps " + Math.ceil(bandBytes(1) / 1048576) + " MiB for one row of sites (" +
      wavelengthsNm.length + " spectral nodes × " + times + " instants × " + shifts.length + " lattice shifts × " + NW + " sites × " + Math.max(CACHED_BANDS, 2 * M + 2) +
      " rows, and one row's grid); the limit is " + capacityBytes / 1048576 + " MiB. Render a narrower output.region.");
  }
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  // Lattice point (li, lj) of shift s, as a native sensor point in mm (+Y down): site centre plus the shift.
  const xMmOf = (li: number, s: { x: number }): number => (li - M + 0.5 + s.x - W / 2) * mmPerSite;
  const yMmOf = (lj: number, s: { y: number }): number => (lj - M + 0.5 + s.y - H / 2) * mmPerSite;
  // Lattice point k's field factor and plane point (or material) from its sensor point; #588: beyond the horizon it keeps factor 0
  // (a zero sample at the plane's origin), and such a point is never queried (evaluateRadiance).
  function mapInto(k: number, xMm: number, yMm: number, time: number, factor: Float64Array, u: Float64Array, v: Float64Array, material: Int32Array | undefined): void {
    const look = geometry.lookOf(xMm, yMm, time);
    if (!(look.z > 0)) { if (zeroBeyond) return; throw new InvalidConfigurationError("lens.defocus: a lattice point's ray does not point toward the scene plane."); }
    // The base provider's own plane-point arithmetic for the outgoing direction −look.
    const t = distance / look.z;
    factor[k] = look.factor; u[k] = look.x * t / scale; v[k] = look.y * t / scale;
    if (material) material[k] = materialAt!(u[k]!, v[k]!);
  }
  // The samples F·L at one spectral node (a point with factor 0 gives 0).
  function samplesOf(nm: number, time: number, factor: Float64Array, u: Float64Array, v: Float64Array, material: Int32Array | undefined): Float64Array {
    const size = factor.length, samples = new Float64Array(size);
    if (material) {
      const radiance = new Map<number, number>();
      for (let k = 0; k < size; k++) {
        const m = material[k]!;
        let value = radiance.get(m);
        if (value === undefined) { value = materialRadiance!(m, nm); radiance.set(m, value); }
        samples[k] = factor[k]! * value;
      }
    } else for (let k = 0; k < size; k++) samples[k] = factor[k]! * base.radianceAt(u[k]!, v[k]!, nm, time);
    return samples;
  }
  // Every array of samples gathered with the zones (all at once), or with the shared kernel.
  const gatherAll = (samples: Float64Array[], y0: number, rows: number): Float64Array[] =>
    zonedGather ? zonedGather(samples, lx0, y0, NW, rows) : samples.map((s) => gatherInterior(s, taps[0]!, gridWidth, NW, rows, R));
  // Bands per time (LRU over (time, band)): values[shift][node] holds G_t / F at the band's own lattice points.
  const cache = new Map<string, Float64Array[][]>();
  // The bands one site row's queries span (its query offsets reach M lattice rows either way), at each of its instants.
  const capacity = Math.max(CACHED_BANDS, Math.ceil((2 * M + 2) / BAND)) * Math.max(1, input.timesPerBand ?? 1);
  // The last band read, so consecutive queries of one band skip the cache key (most queries).
  let lastBand = -1, lastTime = NaN, lastValues: Float64Array[][] | undefined;
  function band(b: number, time: number): Float64Array[][] {
    if (b === lastBand && time === lastTime) return lastValues!;
    const values = bandOf(b, time);
    lastBand = b; lastTime = time; lastValues = values;
    return values;
  }

  function bandOf(b: number, time: number): Float64Array[][] {
    const key = time + ":" + b, cached = cache.get(key);
    if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
    const started = input.onConvolution ? now() : 0;
    const y0 = ly0 + b * BAND, rows = Math.min(BAND, ly1 - y0), gridHeight = rows + 2 * R, size = gridWidth * gridHeight;
    const values = shifts.map((shift) => {
      // Each grid point's field factor and plane point (or material), shared by the spectral nodes.
      const factor = new Float64Array(size), u = new Float64Array(size), v = new Float64Array(size);
      const material = materialAt && materialRadiance ? new Int32Array(size) : undefined;
      for (let gy = 0; gy < gridHeight; gy++) {
        const yMm = yMmOf(y0 + gy - R, shift);
        for (let gx = 0; gx < gridWidth; gx++) mapInto(gy * gridWidth + gx, xMmOf(lx0 + gx - R, shift), yMm, time, factor, u, v, material);
      }
      // The band's own lattice points' factors, to answer each query with G / F.
      const own = new Float64Array(rows * NW);
      for (let y = 0; y < rows; y++) for (let x = 0; x < NW; x++) own[y * NW + x] = factor[(y + R) * gridWidth + x + R]!;
      // One kernel for every node (the disc without diffraction) and fewer materials than nodes: the convolution is linear, so
      // G_λ = Σ_m L_m(λ)·(K ⊛ F·[material = m]); one convolution per material instead of one per node, the same sum regrouped.
      // #730 facade-14: regrouped when the scene has fewer materials than nodes, and the band's materials summed in ascending index, so
      // a value's bits do not depend on the window (a material the band holds but a point's taps miss adds an exact zero).
      if (material && sharedKernel && (input.materialCount ?? Infinity) < wavelengthsNm.length) {
        const present = [...new Set(material)].sort((a, b) => a - b);
        const perMaterial = gatherAll(present.map((m) => {
          const samples = new Float64Array(size);
          for (let k = 0; k < size; k++) if (material[k] === m) samples[k] = factor[k]!;
          return samples;
        }), y0, rows);
        return wavelengthsNm.map((nm) => {
          const radiance = present.map((m) => materialRadiance!(m, nm)), out = new Float64Array(rows * NW);
          for (const value of radiance) if (!(value >= 0 && value <= 2 ** 100)) throw new InvalidConfigurationError("Irradiance samples must be finite, non-negative and within the declared magnitude.");
          for (let k = 0; k < out.length; k++) {
            let sum = 0;
            for (let i = 0; i < present.length; i++) sum += radiance[i]! * perMaterial[i]![k]!;
            out[k] = sum / own[k]!;
          }
          return out;
        });
      }
      // #730 facade-12: with field zones every node's samples are gathered together, so each zone's kernel is built once per band and shift.
      const all = zonedGather ? gatherAll(wavelengthsNm.map((nm) => samplesOf(nm, time, factor, u, v, material)), y0, rows) : undefined;
      return wavelengthsNm.map((nm, w) => {
        const gathered = all ? all[w]! : gatherInterior(samplesOf(nm, time, factor, u, v, material), taps[w]!, gridWidth, NW, rows, R);
        for (let k = 0; k < gathered.length; k++) gathered[k] = gathered[k]! / own[k]!;
        return gathered;
      });
    });
    cache.set(key, values);
    if (cache.size > capacity) cache.delete(cache.keys().next().value!);
    if (input.onConvolution) input.onConvolution(now() - started);
    return values;
  }
  /** The lattice key ((shift·LH + lj)·LW + li) of a look direction at time t, or undefined off the lattices or outside the window. */
  function keyOf(look: { x: number; y: number; z: number }, t: number): number | undefined {
    const point = geometry.sensorPointOf(look, t);
    if (point === undefined) return undefined;
    const fi = point.x / mmPerSite + W / 2 - 0.5, fj = point.y / mmPerSite + H / 2 - 0.5;
    for (let s = 0; s < shifts.length; s++) {
      const shift = shifts[s]!, i = Math.round(fi - shift.x), j = Math.round(fj - shift.y);
      if (Math.abs(fi - shift.x - i) > LATTICE_TOLERANCE_SITES || Math.abs(fj - shift.y - j) > LATTICE_TOLERANCE_SITES) continue;
      const li = i + M, lj = j + M;
      if (li < lx0 || lj < ly0 || li >= lx1 || lj >= ly1) return undefined;
      return (s * LH + lj) * LW + li;
    }
    return undefined;
  }
  function valueOf(key: number | undefined, t: number, nm: number): number {
    const w = index.get(nm);
    if (w === undefined || key === undefined) throw new InvalidConfigurationError("Defocus query is off the sensor site lattice; the image-space convolution does not apply.");
    const li = key % LW, rest = (key - li) / LW, lj = rest % LH, s = (rest - lj) / LH;
    if (large) return largeValue(s, t, w, li, lj);
    return band(Math.floor((lj - ly0) / BAND), t)[s]![w]![((lj - ly0) % BAND) * NW + li - lx0]!;
  }
  // #564: one run lattice per (time, shift) of the samples F·L at the lattice points, and the own field factors F by tile, so a
  // query is answered with (K ⊛ D ⊛ F·L) / F as on the band path.
  const largeLattices = new Map<string, { lattice: LargeDefocusNodeLattice; own: Map<number, Float64Array> }>();
  const largeLatticeCount = shifts.length * Math.max(1, input.timesPerBand ?? 1);
  // Lattice points at most `reach` beyond the lattice feed queried values: the defocus kernel's radius plus the diffraction kernel's.
  const reach = large ? large.runs.radius + (large.diffraction ? large.diffraction.radius : 0) : 0;
  function largeValue(s: number, time: number, w: number, li: number, lj: number): number {
    const key = time + ":" + s;
    let entry = largeLattices.get(key);
    if (!entry) {
      const shift = shifts[s]!;
      const lattice = createLargeDefocusNodeLattice({ kernel: large!, wavelengthsNm, capacityBytes: LARGE_DEFOCUS_CACHE_BYTES / largeLatticeCount, ...(input.onConvolution ? { onTile: input.onConvolution } : {}),
        source: (x0, y0, width, height) => {
          const size = width * height, factor = new Float64Array(size), u = new Float64Array(size), v = new Float64Array(size);
          const material = materialAt && materialRadiance ? new Int32Array(size) : undefined;
          for (let y = 0; y < height; y++) {
            const yMm = yMmOf(y0 + y, shift);
            for (let x = 0; x < width; x++) {
              // A fixed tile's source reaches past the lattice: points beyond its reach feed no queried value, so they keep factor 0
              // (sample 0) and are never mapped (the lens profiles are checked only up to the reach).
              if (x0 + x < -reach || x0 + x >= LW + reach || y0 + y < -reach || y0 + y >= LH + reach) continue;
              mapInto(y * width + x, xMmOf(x0 + x, shift), yMm, time, factor, u, v, material);
            }
          }
          return (node: number): Float64Array => samplesOf(wavelengthsNm[node]!, time, factor, u, v, material);
        } });
      entry = { lattice, own: new Map() };
      largeLattices.set(key, entry);
      if (largeLattices.size > largeLatticeCount) largeLattices.delete(largeLattices.keys().next().value!);
    }
    // The own factor of the lattice point, by 64-point tiles (kept for the request: 8 bytes per lattice point read).
    const T = 64, tx = Math.floor(li / T), ty = Math.floor(lj / T), tileKey = ty * 1048576 + tx;
    let own = entry.own.get(tileKey);
    if (!own) {
      own = new Float64Array(T * T);
      const shift = shifts[s]!;
      // Only the lattice's own points are queried; the rest of the tile is never read (and may lie beyond the lens profiles).
      for (let y = 0; y < T && ty * T + y < LH; y++) { const yMm = yMmOf(ty * T + y, shift); for (let x = 0; x < T && tx * T + x < LW; x++) own[y * T + x] = geometry.lookOf(xMmOf(tx * T + x, shift), yMm, time).factor; }
      entry.own.set(tileKey, own);
    }
    return entry.lattice.valueAt(w, li, lj) / own[(lj - ty * T) * T + li - tx * T]!;
  }
  function blurredAt(look: { x: number; y: number; z: number }, time: number, nm: number): number {
    const t = timeDependent ? time : 0;
    return valueOf(keyOf(look, t), t, nm);
  }
  const baseEvaluate = base.evaluateRadiance, internal = isInternalSceneRadianceEvaluator(baseEvaluate);
  const evaluateRadiance = (request: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult => {
    const result = baseEvaluate.call(base, request), o = (request.target as { outgoingDirectionUnitVector: { x: number; y: number; z: number } }).outgoingDirectionUnitVector;
    // #588: at or beyond the horizon the base provider's own zero.
    if (zeroBeyond && !(o.z < 0)) return result;
    const radiance = blurredAt({ x: -o.x, y: -o.y, z: -o.z }, request.timeSecondsFromExposureStart, request.wavelengthNanometers);
    // #588: an engine-built base returns a new result object per call, so its radiance is replaced in place (no copy per query).
    if (internal) { (result as { spectralRadianceWattsPerSquareMeterSteradianNanometer: number }).spectralRadianceWattsPerSquareMeterSteradianNanometer = radiance; return result; }
    return { ...result, spectralRadianceWattsPerSquareMeterSteradianNanometer: radiance };
  };
  // The result is the base result with only its radiance replaced, so an engine-built base evaluator keeps its mark. Its radiance is
  // a pure function of the lattice key (and, with rotation, the request time) and the wavelength, so the lean executor may read it by
  // key, as for the diffraction provider.
  if (internal) {
    markInternalSceneRadianceEvaluator(evaluateRadiance);
    // With rotation the key also carries the request time, as an index into the distinct times seen (one per temporal midpoint).
    const times: number[] = [], timeIndex = new Map<number, number>(), latticeKeys = shifts.length * LH * LW;
    registerInternalRadianceAccess(evaluateRadiance, {
      tabulated: false,
      keyOfDirection(o, time): number | undefined {
        // #633: at or beyond the horizon evaluateRadiance returns the base provider's own zero, not a lattice value: no key.
        if (zeroBeyond && !(o.z < 0)) return undefined;
        const t = timeDependent ? time : 0, key = keyOf({ x: -o.x, y: -o.y, z: -o.z }, t);
        if (key === undefined) return undefined;
        let index = timeIndex.get(t);
        if (index === undefined) { index = times.length; times.push(t); timeIndex.set(t, index); }
        return index * latticeKeys + key;
      },
      radianceOfKey(key, nm): number {
        const index = Math.floor(key / latticeKeys);
        return valueOf(key - index * latticeKeys, times[index]!, nm);
      }
    });
  }
  return {
    sceneId: base.sceneId, providerProfileId: base.providerProfileId, radianceAt: base.radianceAt,
    evaluateRadiance,
    evaluateApertureRadiance(): SceneRadianceEvaluationResult {
      throw new InvalidConfigurationError("Defocus by image-space convolution does not take pupil rays.");
    }
  };
}

/** Field-variation bounds of the image-space disc for one request (#548), recorded in the `lens.defocus` assumption. */
export interface DefocusFieldVariation {
  /** Sensor points the bounds were evaluated at: a grid of this many points per side over the native raster, edges included. */
  gridPointsPerSide: number;
  /**
   * Camera rotation (pitch or yaw tilts the scene plane in the camera frame): the largest change of the disc diameter, in
   * sites, between the axial depth of each scene point in the rotated camera frame and the subject distance, over the grid and
   * the rendered temporal midpoints. 0 for roll only; null without rotation.
   */
  rotationMaximumDiameterChangeSites: number | null;
  /**
   * Distortion: the largest deviation from 1 of the local scale of the distortion map (singular values of d distorted / d ideal)
   * over the grid: the relative disc-size difference to a model that blurs the ideal image and then distorts it. Null without distortion.
   */
  distortionMaximumLocalScaleDeviation: number | null;
  /**
   * A non-rectilinear projection: the largest change of the disc diameter, in sites, between the distance along each scene
   * point's ray and its axial depth (the thin-lens model uses the axial depth). Null for the rectilinear projection.
   */
  projectionMaximumDiameterChangeSites: number | null;
}

/** Internal: {@link DefocusFieldVariation} on a 9 × 9 grid of sensor points (the extremes of these smooth maps lie on the frame's edges). */
export function calculateDefocusFieldVariation(input: { geometry: PreparedDefocusImageSpaceGeometry; lensMapping?: PreparedEnvironmentLensFieldMapping;
  focalLengthMm: number; fNumber: number; focusDistanceM: number; subjectDistanceM: number; pitchMicrometers: number; nativeWidth: number; nativeHeight: number;
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec; handShake?: readonly number[] | undefined; temporalMidpointsSeconds: readonly number[]; diameterSites: number;
  discAt: (subjectDistanceM: number) => number }): DefocusFieldVariation {
  const { geometry, lensMapping, pitchMicrometers: pitch, nativeWidth: W, nativeHeight: H, subjectDistanceM: d, diameterSites, discAt } = input;
  const G = 9, points: { x: number; y: number }[] = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) points.push({ x: (i / (G - 1) - 0.5) * W * pitch / 1000, y: (j / (G - 1) - 0.5) * H * pitch / 1000 });
  let rotation: number | null = null;
  if (geometry.timeDependent) {
    rotation = 0;
    for (const t of input.temporalMidpointsSeconds) {
      // The camera's optical axis at t in the reference axes; a scene point's axial depth in the rotated camera is P·axis.
      const omega = shakenAngularVelocity(input.angularVelocityRadPerSec, input.handShake, t);
      const axis = applyPhysicalCameraRotation({ x: 0, y: 0, z: 1 }, { pitch: omega.pitch * t, yaw: omega.yaw * t, roll: omega.roll * t }, "camera-to-reference");
      for (const p of points) {
        const look = geometry.lookOf(p.x, p.y, t), reach = d / look.z;
        const depth = reach * (look.x * axis.x + look.y * axis.y + look.z * axis.z);
        rotation = Math.max(rotation, Math.abs(discAt(depth) - diameterSites));
      }
    }
  }
  let distortion: number | null = null;
  if (lensMapping && lensMapping.mapping.distortion.kind !== "none") {
    distortion = 0;
    for (const p of points) {
      const scales = distortedImagePoint(lensMapping, undistortedImagePoint(lensMapping, { x: p.x, y: -p.y }).ideal);
      distortion = Math.max(distortion, scales.largestScale - 1, 1 - scales.smallestScale);
    }
  }
  let projection: number | null = null;
  if (lensMapping && lensMapping.mapping.projectionModel !== "rectilinear") {
    projection = 0;
    for (const p of points) {
      const look = geometry.lookOf(p.x, p.y, 0);
      projection = Math.max(projection, Math.abs(discAt(d / look.z) - diameterSites));
    }
  }
  return { gridPointsPerSide: G, rotationMaximumDiameterChangeSites: rotation, distortionMaximumLocalScaleDeviation: distortion, projectionMaximumDiameterChangeSites: projection };
}
