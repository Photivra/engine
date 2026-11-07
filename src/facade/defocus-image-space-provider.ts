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
 * does not depend on time and one G is kept. The facade refuses rotation with a rolling shutter (each row's instants differ).
 *
 * What is approximate is the disc itself (`lens.defocus` labels it; the facade records the field-variation bounds of
 * each combination), not this evaluation of it.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { hypot3 } from "../core/portable-math.js";
import { isInternalSceneRadianceEvaluator, markInternalSceneRadianceEvaluator, registerInternalRadianceAccess } from "../core/internal-radiance-evaluator.js";
import type { SceneRadianceEvaluationRequest, SceneRadianceEvaluationResult } from "../schema/scene-radiance.js";
import { lensProjectionDirectionValue, lensProjectionImagePointValue, type LensProjectionModel } from "../camera/lens-projection.js";
import { applyPhysicalCameraRotation, resolveProjectionDistanceMm, type CameraAngularVelocityRadPerSec } from "../motion/camera-rotation.js";
import { calculateIlluminationVignetting, type IlluminationVignettingProfile } from "../optics/illumination-vignetting.js";
import { distortedImagePoint, undistortedImagePoint, type PreparedEnvironmentLensFieldMapping } from "../optics/sensor-environment-query.js";
import { checkedSiteKernel, gatherInterior, kernelTaps } from "./diffraction-provider.js";
import type { PlanarSceneRadianceProvider } from "./scene-radiance.js";

/** Rows of native sites per band; bands kept per time. Banding changes memory only, never values. */
const BAND_ROWS = 32;
const CACHED_BANDS = 2;
const LATTICE_TOLERANCE_SITES = 1e-4;

/** The camera geometry the environment uses for each site query (the same options as the site inputs). */
export interface DefocusImageSpaceGeometry {
  focalLengthMm: number;
  focusDistanceM: number;
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  /** The site inputs' `lensFieldMapping`, prepared; omitted for the ideal rectilinear, distortion-free mapping. */
  lensMapping?: PreparedEnvironmentLensFieldMapping;
  /** The site inputs' radial-illumination-vignetting profile; omitted for unity field throughput. */
  vignetting?: IlluminationVignettingProfile;
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
  const { focalLengthMm, focusDistanceM, angularVelocityRadPerSec: omega, lensMapping, vignetting } = geometry;
  // The projection scale: the thin-lens image distance at the finite focus, for every projection model (the environment's).
  const pd = resolveProjectionDistanceMm(focalLengthMm, focusDistanceM).projectionDistanceMm;
  const model: LensProjectionModel = lensMapping?.mapping.projectionModel ?? "rectilinear";
  const timeDependent = omega.pitch !== 0 || omega.yaw !== 0 || omega.roll !== 0;
  const displacement = (t: number): { pitch: number; yaw: number; roll: number } =>
    timeDependent ? { pitch: omega.pitch * t, yaw: omega.yaw * t, roll: omega.roll * t } : { pitch: 0, yaw: 0, roll: 0 };
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
  return {
    timeDependent,
    lookOf(xMm, yMm, t): { x: number; y: number; z: number; factor: number } {
      const image = { x: xMm, y: -yMm };
      const { ideal, distortionAreaFactor } = lensMapping ? undistortedImagePoint(lensMapping, image) : { ideal: image, distortionAreaFactor: 1 };
      let lx: number, ly: number, lz: number;
      if (model === "rectilinear") {
        // calculateInverseCameraRotationImageMapping: the captured ray (x/pd, y/pd, 1) in reference axes, projected at pd.
        const reference = applyPhysicalCameraRotation({ x: ideal.x / pd, y: ideal.y / pd, z: 1 }, displacement(t), "camera-to-reference");
        if (!(reference.z > 0)) throw new InvalidConfigurationError("lens.defocus: a lattice point's ray points to or behind the reference camera plane.");
        lx = pd * (reference.x / reference.z); ly = pd * (reference.y / reference.z); lz = pd;
      } else {
        const reference = applyPhysicalCameraRotation(lensProjectionDirectionValue(model, pd, ideal.x, ideal.y), displacement(t), "camera-to-reference");
        lx = reference.x; ly = reference.y; lz = reference.z;
      }
      const length = hypot3(lx, ly, lz);
      const throughput = vignetting ? calculateIlluminationVignetting({ imagePointMm: image, profile: vignetting }).value.linearThroughputFactor : 1;
      return { x: lx / length, y: ly / length, z: lz / length, factor: throughput * distortionAreaFactor };
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
  siteKernels: (wavelengthNm: number) => Float64Array;
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
  /** Most distinct request times kept per band (the temporal sample count). Default 1. */
  timesPerBand?: number;
  /** Called with the duration in ms of each band convolution (diagnostics only). */
  onConvolution?: (milliseconds: number) => void;
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
  const kernels = wavelengthsNm.map((nm) => checkedSiteKernel(input.siteKernels(nm), R));
  const taps = kernels.map((kernel) => kernelTaps(kernel, R, gridWidth));
  const sharedKernel = kernels.every((kernel) => kernel === kernels[0]);
  const scale = input.metresPerFrameUnit, distance = input.distanceM;
  const materialAt = base.chartMaterialAt?.bind(base), materialRadiance = base.materialRadiance?.bind(base);
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  // Lattice point (li, lj) of shift s, as a native sensor point in mm (+Y down): site centre plus the shift.
  const xMmOf = (li: number, s: { x: number }): number => (li - M + 0.5 + s.x - W / 2) * mmPerSite;
  const yMmOf = (lj: number, s: { y: number }): number => (lj - M + 0.5 + s.y - H / 2) * mmPerSite;
  // Bands per time (LRU over (time, band)): values[shift][node] holds G_t / F at the band's own lattice points.
  const cache = new Map<string, Float64Array[][]>();
  const capacity = CACHED_BANDS * Math.max(1, input.timesPerBand ?? 1);
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
    const y0 = ly0 + b * BAND_ROWS, rows = Math.min(BAND_ROWS, ly1 - y0), gridHeight = rows + 2 * R, size = gridWidth * gridHeight;
    const values = shifts.map((shift) => {
      // Each grid point's field factor and plane point (or material), shared by the spectral nodes.
      const factor = new Float64Array(size), u = new Float64Array(size), v = new Float64Array(size);
      const material = materialAt && materialRadiance ? new Int32Array(size) : undefined;
      for (let gy = 0; gy < gridHeight; gy++) {
        const yMm = yMmOf(y0 + gy - R, shift);
        for (let gx = 0; gx < gridWidth; gx++) {
          const k = gy * gridWidth + gx, look = geometry.lookOf(xMmOf(lx0 + gx - R, shift), yMm, time);
          if (!(look.z > 0)) throw new InvalidConfigurationError("lens.defocus: a lattice point's ray does not point toward the scene plane.");
          // The base provider's own plane-point arithmetic for the outgoing direction −look.
          const t = distance / look.z;
          factor[k] = look.factor; u[k] = look.x * t / scale; v[k] = look.y * t / scale;
          if (material) material[k] = materialAt!(u[k]!, v[k]!);
        }
      }
      // The band's own lattice points' factors, to answer each query with G / F.
      const own = new Float64Array(rows * NW);
      for (let y = 0; y < rows; y++) for (let x = 0; x < NW; x++) own[y * NW + x] = factor[(y + R) * gridWidth + x + R]!;
      // One kernel for every node (the disc without diffraction) and fewer materials than nodes: the convolution is linear, so
      // G_λ = Σ_m L_m(λ)·(K ⊛ F·[material = m]); one convolution per material instead of one per node, the same sum regrouped.
      if (material && sharedKernel) {
        const present = [...new Set(material)];
        if (present.length < wavelengthsNm.length) {
          const perMaterial = present.map((m) => {
            const samples = new Float64Array(size);
            for (let k = 0; k < size; k++) if (material[k] === m) samples[k] = factor[k]!;
            return gatherInterior(samples, taps[0]!, gridWidth, NW, rows, R);
          });
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
      }
      return wavelengthsNm.map((nm, w) => {
        const samples = new Float64Array(size);
        if (material) {
          const radiance = new Map<number, number>();
          for (let k = 0; k < size; k++) {
            const m = material[k]!;
            let value = radiance.get(m);
            if (value === undefined) { value = materialRadiance!(m, nm); radiance.set(m, value); }
            samples[k] = factor[k]! * value;
          }
        } else for (let k = 0; k < size; k++) samples[k] = factor[k]! * base.radianceAt(u[k]!, v[k]!, nm);
        const gathered = gatherInterior(samples, taps[w]!, gridWidth, NW, rows, R);
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
  function valueOf(key: number, t: number, nm: number): number {
    const w = index.get(nm);
    if (w === undefined) throw new InvalidConfigurationError("Defocus query is off the sensor site lattice; the image-space convolution does not apply.");
    const li = key % LW, rest = (key - li) / LW, lj = rest % LH, s = (rest - lj) / LH;
    return band(Math.floor((lj - ly0) / BAND_ROWS), t)[s]![w]![((lj - ly0) % BAND_ROWS) * NW + li - lx0]!;
  }
  function blurredAt(look: { x: number; y: number; z: number }, time: number, nm: number): number {
    const t = geometry.timeDependent ? time : 0, key = keyOf(look, t);
    if (key === undefined) throw new InvalidConfigurationError("Defocus query is off the sensor site lattice; the image-space convolution does not apply.");
    return valueOf(key, t, nm);
  }
  const baseEvaluate = base.evaluateRadiance;
  const evaluateRadiance = (request: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult => {
    const result = baseEvaluate.call(base, request), o = (request.target as { outgoingDirectionUnitVector: { x: number; y: number; z: number } }).outgoingDirectionUnitVector;
    return { ...result, spectralRadianceWattsPerSquareMeterSteradianNanometer: blurredAt({ x: -o.x, y: -o.y, z: -o.z }, request.timeSecondsFromExposureStart, request.wavelengthNanometers) };
  };
  // The result is the base result with only its radiance replaced, so an engine-built base evaluator keeps its mark. Its radiance is
  // a pure function of the lattice key (and, with rotation, the request time) and the wavelength, so the lean executor may read it by
  // key, as for the diffraction provider.
  if (isInternalSceneRadianceEvaluator(baseEvaluate)) {
    markInternalSceneRadianceEvaluator(evaluateRadiance);
    // With rotation the key also carries the request time, as an index into the distinct times seen (one per temporal midpoint).
    const times: number[] = [], timeIndex = new Map<number, number>(), latticeKeys = shifts.length * LH * LW;
    registerInternalRadianceAccess(evaluateRadiance, {
      tabulated: false,
      keyOfDirection(o, time): number | undefined {
        const t = geometry.timeDependent ? time : 0, key = keyOf({ x: -o.x, y: -o.y, z: -o.z }, t);
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
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec; temporalMidpointsSeconds: readonly number[]; diameterSites: number;
  discAt: (subjectDistanceM: number) => number }): DefocusFieldVariation {
  const { geometry, lensMapping, pitchMicrometers: pitch, nativeWidth: W, nativeHeight: H, subjectDistanceM: d, diameterSites, discAt } = input;
  const G = 9, points: { x: number; y: number }[] = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) points.push({ x: (i / (G - 1) - 0.5) * W * pitch / 1000, y: (j / (G - 1) - 0.5) * H * pitch / 1000 });
  let rotation: number | null = null;
  if (geometry.timeDependent) {
    rotation = 0;
    const omega = input.angularVelocityRadPerSec;
    for (const t of input.temporalMidpointsSeconds) {
      // The camera's optical axis at t in the reference axes; a scene point's axial depth in the rotated camera is P·axis.
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
