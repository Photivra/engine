// SPDX-License-Identifier: Apache-2.0

/**
 * A faster ("lean") per-site optical executor for createNativeEnvironmentRawTask, added in 2.0 for
 * performance. It skips only per-site re-validation and result-envelope building that can be proven
 * redundant, and nothing else:
 *
 * - A site whose environment is strictly equal (plain data, same keys in the same order, Object.is leaves) to
 *   an earlier fully validated "template" site except for the two index-bound fields (temporalIntegrationId and
 *   sensor.spatialSampling.site), and whose colour-sampling site has the same CFA phase, passes every
 *   site-independent check exactly as the template did. Only the site-dependent work is recomputed: aperture
 *   geometry and its bounds, the local exposure window, field throughput, aperture rays, query projection and
 *   provider requests, with the same arithmetic in the same order as the full planner.
 * - Execution replays the same callbacks with the same frozen requests, validates every provider result with
 *   the same parser, and evaluates the photon/charge-rate arithmetic of the full chain (scene-to-sensor
 *   acceptance, spatio-spectral reduction, operating range, EQE electron rate, Kahan sums, temporal midpoint
 *   sums) in the same floating-point operation order.
 * - Every data-dependent check of the full chain is still evaluated. When one fails, or anything is unexpected,
 *   the lean path hands the exact same inputs to the full engine function, which then throws its own error (or
 *   returns its own value). Planning falls back before any callback. Execution falls back at the step whose check
 *   failed. So callbacks, errors and their order are unchanged.
 * - Each template verifies itself: its own site is planned by both planners and executed by the full executor,
 *   and the lean results must be bit-identical (Object.is) before any other site uses the template. A mismatch
 *   disables the template and its sites run the full path.
 *
 * Sampled PSFs (point-spread functions) and lens field mappings are covered as well (2.0). A sampled-PSF site
 * resolves its kernels with the full resolver's own code (resolveLensSampledPsfKernel), places the taps with the
 * shared sensorPsfSourcePoint and sums each node's taps in kernel order, as calculateSensorPsfIrradianceQuadrature
 * does. Its per-instant checks run after that instant's callbacks; when one fails, the full quadrature runs on the
 * site's full plan and decides. A lens-mapped site builds each query with calculateMappedSensorEnvironmentRadianceQuery
 * itself and applies the distortion area factor once, after the tap's pupil sum.
 * @see docs/NATIVE_RAW_AND_PRINT.md for the invariance argument and limits.
 */

import type { SimulateEnvironmentSensorRawFrameInput } from "./environment-raw-producer.js";
import type { planEnvironmentSensorPhotoSignal, executeEnvironmentSensorPhotoSignal, EnvironmentRadianceEvaluator,
  EnvironmentApertureRadianceEvaluator } from "../sensor/environment-photo-signal.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { hypot3 } from "../core/portable-math.js";
import { apertureRadianceQuery } from "../sensor/environment-photo-signal.js";
import type { SensorEqeTemporalPhotoSignal } from "../sensor/temporal-photo-signal.js";
import { createSensorEqeTemporalPhotoSignal } from "../sensor/temporal-photo-signal.js";
import { isDeeplyFrozen, type InternalRadianceAccess } from "../core/internal-radiance-evaluator.js";
import { parseSceneRadianceEvaluationResult, parseSceneRadianceEvaluationResultWithValidatedRecords, validateSceneRadianceEvaluationBindings, type ValidatedSceneRadianceRecords,
  type SceneRadianceEvaluationRequest, type SceneRadianceEvaluationResult } from "../schema/scene-radiance.js";
import { calculateSceneRadianceToSensorIrradiance } from "../optics/scene-to-sensor-irradiance.js";
import { calculateMappedSensorEnvironmentRadianceQuery, prepareEnvironmentLensFieldMapping,
  type PreparedEnvironmentLensFieldMapping } from "../optics/sensor-environment-query.js";
import { calculateSensorPsfIrradianceQuadrature } from "../optics/sensor-psf-quadrature.js";
import { sensorPsfSourcePoint } from "../optics/sensor-psf-support.js";
import { resolveLensSampledPsf, resolveLensSampledPsfKernel, type ResolveLensSampledPsfInput } from "../optics/lens-psf-profile.js";
import { sensorApertureRayValues, type IdealCircularPupil, type SensorApertureRay } from "../optics/sensor-aperture-rays.js";
import { parseFocusPlane } from "../optics/focus-state.js";
import { calculateIlluminationVignetting } from "../optics/illumination-vignetting.js";
import { applyPhysicalCameraRotation, resolveProjectionDistanceMm } from "../motion/camera-rotation.js";
import { prepareCaptureExposureWindowSampler } from "../sensor/exposure-window.js";
import { apertureFitAllowanceMicrometers } from "../sensor/sampling-aperture.js";
import { isPublicOpaqueId } from "../core/record-validation.js";
import { freezeOwnedData } from "../core/owned-data.js";
import { composeNativeEnvironmentSensorSite } from "./native-environment-optical-stage.js";
import { calculateNativeRawSite, parseNativeRawProducerSite, type NativeRawProducerFrameContext,
  type SensorRawProducerSiteInput } from "./sensor-raw-producer.js";
import type { NativeRawLeanOutput, NativeRawLeanSensorHook } from "./native-raw.js";
import { calculateSiteEffectiveSaturationCode } from "./raw-white-level.js";
import { adcTransfer, resolveSensorReadoutRegime, samplePoisson, type ResolvedSensorReadoutRegime } from "../sensor/raw-readout.js";
import { createResettableUniformStream, deriveNativeSiteStreamSeedUint32, sampleDeterministicStandardNormal,
  NATIVE_SITE_CHARGE_STREAM_ID, NATIVE_SITE_READ_NOISE_STREAM_ID } from "../sensor/stochastic-seed.js";
import { evaluateParsedFixedPatternSite, type SensorFixedPatternNoiseProfile } from "../sensor/fixed-pattern-noise.js";

type Site = SimulateEnvironmentSensorRawFrameInput["sites"][number];
type Env = Site["environment"];
type FullPlan = ReturnType<typeof planEnvironmentSensorPhotoSignal>;
type FullResult = ReturnType<typeof executeEnvironmentSensorPhotoSignal>;
type Rec = Record<string, unknown>;
type FieldThroughput = FullPlan["instants"][number]["groups"][number]["taps"][number]["fieldThroughput"];

/** Most distinct templates kept for one capture event. Any further distinct sites just run the full path. */
const MAXIMUM_TEMPLATES = 64;
const SQUARE_MICROMETERS_TO_SQUARE_METERS = 1e-12;
const REDUCTION_TOLERANCE = 1e-10;

/** Disables the lean executor process-wide (internal; tests compare both paths). */
let leanDisabled = false;
/** Internal counters of lean work (tests assert the lean path actually runs). Not exported from the package. */
export const nativeEnvironmentLeanStatistics = { plannedSites: 0, executedSites: 0, sensorSites: 0, psfFallbacks: 0, keySites: 0 };
export function setNativeEnvironmentLeanExecutionEnabled(enabled: boolean): void { leanDisabled = !enabled; }

export function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
/**
 * Strict structural equality of engine-owned structured-clone output: Object.is leaves (0 and -0 differ), plain
 * records with the same own keys in the same order, dense arrays without extra properties. Anything else is equal
 * only by reference. `memo` remembers subtrees already proven equal (both sides are engine-owned and unmutated).
 */
function sameData(a: unknown, b: unknown, memo: WeakMap<object, object>): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (memo.get(a) === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || Object.getPrototypeOf(a) !== Array.prototype || Object.getPrototypeOf(b) !== Array.prototype) return false;
    const length = a.length;
    if (length !== b.length) return false;
    for (let i = 0; i < length; i++) if (!(i in a) || !(i in b) || !sameData(a[i], b[i], memo)) return false;
    if (Object.keys(a).length !== length || Object.keys(b).length !== length) return false;
  } else {
    if (Array.isArray(b) || !isPlainRecord(a) || !isPlainRecord(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (!sameKeysExcept(a as Rec, b as Rec, undefined, memo)) return false;
  }
  memo.set(a, b);
  return true;
}
/** Same own keys in the same order and equal values, except `skip` (compared by the caller). */
function sameKeysExcept(a: Rec, b: Rec, skip: string | undefined, memo: WeakMap<object, object>): boolean {
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length || Object.getOwnPropertySymbols(a).length !== 0 || Object.getOwnPropertySymbols(b).length !== 0) return false;
  for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
  for (let i = 0; i < ak.length; i++) {
    const key = ak[i]!;
    if (key !== skip && !sameData(a[key], b[key], memo)) return false;
  }
  return true;
}
function plainChild(value: unknown, key: string): Rec | undefined {
  const child = typeof value === "object" && value !== null ? (value as Rec)[key] : undefined;
  return typeof child === "object" && child !== null && !Array.isArray(child) && isPlainRecord(child) ? child as Rec : undefined;
}
/** Environment equality except temporalIntegrationId and sensor.spatialSampling.site (index-bound, checked per site). */
function environmentMatches(e: Env, t: Env, memo: WeakMap<object, object>): boolean {
  const er = e as unknown as Rec, tr = t as unknown as Rec;
  if (typeof er !== "object" || er === null || !isPlainRecord(er)) return false;
  const es = plainChild(er, "sensor"), ts = plainChild(tr, "sensor"), ess = plainChild(es, "spatialSampling"), tss = plainChild(ts, "spatialSampling");
  if (!es || !ts || !ess || !tss) return false;
  return environmentShallow(er, tr, memo);
}
/** Top level and sensor compared key by key so only the two index-bound fields are skipped. */
function environmentShallow(er: Rec, tr: Rec, memo: WeakMap<object, object>): boolean {
  const ek = Object.keys(er), tk = Object.keys(tr);
  if (ek.length !== tk.length || Object.getOwnPropertySymbols(er).length !== 0) return false;
  for (let i = 0; i < ek.length; i++) if (ek[i] !== tk[i]) return false;
  for (const key of ek) {
    if (key === "temporalIntegrationId") continue;
    if (key === "sensor") {
      const es = er.sensor as Rec, ts = tr.sensor as Rec, sk = Object.keys(es), tsk = Object.keys(ts);
      if (sk.length !== tsk.length || Object.getOwnPropertySymbols(es).length !== 0) return false;
      for (let i = 0; i < sk.length; i++) if (sk[i] !== tsk[i]) return false;
      for (const sensorKey of sk) {
        if (sensorKey === "spatialSampling") {
          if (!sameKeysExcept(es.spatialSampling as Rec, ts.spatialSampling as Rec, "site", memo)) return false;
        } else if (!sameData(es[sensorKey], ts[sensorKey], memo)) return false;
      }
    } else if (!sameData(er[key], tr[key], memo)) return false;
  }
  return true;
}

interface SpatialNode { xPhase: number; yPhase: number; aaX: number; aaY: number }
interface ExecutionConstants {
  /** Per spatial node: combined normalized weight and geometric area measure in m². */
  weight: Float64Array; areaSquareMeters: Float64Array;
  /** Per spectral node: dλ (wavelength step), photon energy and effective EQE, exactly as the template's full chain used them. */
  measure: Float64Array; photonEnergy: Float64Array; eqe: Float64Array;
  /** Per spectral node: scene-to-sensor acceptance before field throughput. */
  acceptance: Float64Array;
  rangeKind: "power" | "irradiance"; rangeMinimum: number; rangeMaximum: number; perBin: boolean;
  photo: SensorEqeTemporalPhotoSignal;
}
interface Template {
  environment: Env;
  phase: number;
  /** True until the template's plan constants are derived and self-checked. */
  disabled: boolean;
  consts?: PlanConstants;
  /** The lean plan of the template's own site, shown equal to its full plan. */
  selfPlan?: LeanEnvironmentPlan | undefined;
  execution?: ExecutionConstants;
  /** undefined until the template site executed through the full path. */
  executionVerified?: boolean;
  /**
   * #394: true when an engine-built evaluator's key lookup reproduced every radiance of the template's own full execution; its
   * sites are then planned as key taps and their radiances taken from the lookup instead of the evaluator (tabulated keys, chart
   * materials, from `radiance`: per key, per spectral node, NaN until first needed).
   */
  keyMode?: boolean;
  radiance?: Float64Array[];
}
interface PlanConstants {
  spectralCount: number; spatialCount: number; temporalCount: number; pupilCount: number; count: number;
  /** Per group (spectral × spatial node): its number of taps (1 without a sampled PSF). */
  tapCounts: readonly number[];
  /** Start of each group in an instant's flat tap list, plus the total at the end. */
  tapOffsets: readonly number[];
  /** The template's sampled-PSF resolver input (its engine-owned, frozen profile), without wavelength and field point. */
  psf?: Omit<ResolveLensSampledPsfInput, "wavelengthNm" | "fieldPointMm">;
  /** The template's validated lens field mapping. */
  lensMapping?: PreparedEnvironmentLensFieldMapping;
  wavelengths: Float64Array;
  nodes: readonly FullPlan["instants"][number]["groups"][number]["node"][];
  spatial: SpatialNode[];
  geometry: { firstX: number; firstY: number; pitchX: number; pitchY: number; offsetX: number; offsetY: number;
    widthUm: number; heightUm: number; imagingWidthMm: number; imagingHeightMm: number };
  sampler: ReturnType<typeof prepareCaptureExposureWindowSampler>;
  projectionDistanceMm: number;
  focus: FullPlan["focus"];
  /** The focus plane as calculateSensorApertureRays parses it. */
  parsedFocus: ReturnType<typeof parseFocusPlane>;
  requestBase: { providerProfileId: string; sceneId: string; illuminationProfileId: string; materialResponseProfileId: string; wavelengthBasis: string };
  sceneBindings: FullPlan["sceneBindings"];
}
interface LeanTap {
  /** The provider request; absent for a key tap (#394), whose radiance comes from the evaluator's key lookup. */
  request?: SceneRadianceEvaluationRequest;
  /** #394: the key (chart material or lattice site) the request would read (key taps only). */
  key?: number;
  sourcePointImagePlaneMm: { x: number; y: number };
  fieldThroughput: FieldThroughput;
  fieldFactor: number;
  fieldValid: boolean;
  apertureRays?: readonly SensorApertureRay[];
  /** 1 / det(d distorted / d ideal), applied once after the tap's pupil sum. Present only with a lens field mapping. */
  distortionAreaFactor?: number;
}
/** A lean site plan. `owned` and `count` mirror the full plan fields the native task reads. */
export interface LeanEnvironmentPlan {
  readonly lean: true;
  readonly template: Template;
  readonly index: number;
  readonly owned: Env;
  readonly count: number;
  readonly site: { x: number; y: number };
  readonly start: number; readonly end: number; readonly duration: number;
  /**
   * Per instant, every tap in one flat list: group by group (spectral-major, spatial-minor), each group's taps in kernel
   * order. Group gi holds taps tapOffsets[gi] to tapOffsets[gi + 1] - 1 of its template's plan constants.
   */
  readonly instants: readonly { time: number; taps: readonly LeanTap[] }[];
  /** Per group: the resolved PSF kernel weights. Present only with a sampled PSF. */
  readonly kernels?: readonly (readonly number[])[];
  /** #394: true when the taps are key taps (no requests). */
  readonly keyTaps?: true;
}
export function isLeanEnvironmentPlan(plan: unknown): plan is LeanEnvironmentPlan {
  return typeof plan === "object" && plan !== null && (plan as { lean?: unknown }).lean === true;
}

export interface NativeEnvironmentLeanFrame {
  frameId: string;
  nativeWidth: number;
  nativeHeight: number;
  repeatWidth: number;
  repeatHeight: number;
  /** True only when native sites and colour-sampling sites map one to one, with the same top-left origin (identity mapping). */
  identityBinding: boolean;
}

/** Per-event lean executor state. Templates and memos live only for one native task. */
export interface NativeEnvironmentLeanExecutor {
  /**
   * Classifies a planned site. Returns a lean plan when it matches a verified template; "candidate" when it
   * should be planned in full with "full" retention and offered to admitCandidate; or undefined (plan it in
   * full, keeping only the photo signal).
   */
  plan(environment: Env, index: number): LeanEnvironmentPlan | "candidate" | undefined;
  /** Registers a fully planned ("full" retention) candidate; never throws. */
  admitCandidate(environment: Env, index: number, plan: FullPlan): void;
  /** True when this index is an accepted candidate. Its full execution must use "full" retention and be verified. */
  isCandidate(index: number): boolean;
  /** Verifies a candidate's full execution (full retention) against the lean arithmetic; never throws. */
  verifyCandidate(index: number, plan: FullPlan, result: FullResult): void;
  /**
   * Executes a lean plan. Returns the photo signal, or undefined when the template could not be verified; the
   * caller then plans and executes this site in full. `fullPlan` builds the site's full plan without callbacks;
   * it is called only when a sampled-PSF check fails and the full PSF quadrature must decide.
   */
  execute(plan: LeanEnvironmentPlan, evaluate: EnvironmentRadianceEvaluator,
    aperture: EnvironmentApertureRadianceEvaluator | undefined, fullPlan: () => FullPlan, internalEvaluator?: boolean,
    countEvaluations?: (count: number) => void): SensorEqeTemporalPhotoSignal | undefined;
}

function siteOf(environment: Env): { x: unknown; y: unknown } | undefined {
  const site = plainChild(plainChild(plainChild(environment, "sensor"), "spatialSampling"), "site");
  return site as { x: unknown; y: unknown } | undefined;
}

/**
 * Plans the site-dependent parts with the full planner's arithmetic. Returns undefined on any doubt, and the caller plans in full.
 * With `access` (#394: a verified key-mode template, no pupil or lens mapping), each tap keeps the key its request would read
 * instead of the request.
 */
function geometry(t: Template, k: PlanConstants, frame: NativeEnvironmentLeanFrame, environment: Env, index: number,
  access?: InternalRadianceAccess): LeanEnvironmentPlan | undefined {
  try {
    const x = index % frame.nativeWidth, y = Math.floor(index / frame.nativeWidth), site = siteOf(environment);
    // Object.is: a -0 coordinate would flow into the full path's outputs, so it takes the full path.
    if (!site || !Object.is(site.x, x) || !Object.is(site.y, y) || !isPublicOpaqueId(environment.temporalIntegrationId)) return undefined;
    const g = k.geometry;
    // resolveSensorSamplingAperture: per-site aperture centre and bounds.
    const siteCenterFromTopLeftX = g.firstX + x * g.pitchX, siteCenterFromTopLeftY = g.firstY + y * g.pitchY;
    const apertureCenterFromTopLeftX = siteCenterFromTopLeftX + g.offsetX, apertureCenterFromTopLeftY = siteCenterFromTopLeftY + g.offsetY;
    const imagingWidthMicrometers = g.imagingWidthMm * 1000, imagingHeightMicrometers = g.imagingHeightMm * 1000;
    const allowanceX = apertureFitAllowanceMicrometers(imagingWidthMicrometers), allowanceY = apertureFitAllowanceMicrometers(imagingHeightMicrometers);
    if (apertureCenterFromTopLeftX - g.widthUm / 2 < -allowanceX || apertureCenterFromTopLeftY - g.heightUm / 2 < -allowanceY ||
      apertureCenterFromTopLeftX + g.widthUm / 2 > imagingWidthMicrometers + allowanceX ||
      apertureCenterFromTopLeftY + g.heightUm / 2 > imagingHeightMicrometers + allowanceY) return undefined;
    const centerX = -g.imagingWidthMm / 2 + apertureCenterFromTopLeftX / 1000, centerY = -g.imagingHeightMm / 2 + apertureCenterFromTopLeftY / 1000;
    // calculateSensorSpatialSamplingQuadrature: midpoint grid nodes minus the anti-aliasing (AA) offset.
    const widthMm = g.widthUm / 1000, heightMm = g.heightUm / 1000;
    const leftMm = centerX - widthMm / 2, topMm = centerY - heightMm / 2;
    const sources: { x: number; y: number }[] = [];
    for (const node of k.spatial) {
      const source = { x: (leftMm + node.xPhase * widthMm) - node.aaX, y: (topMm + node.yPhase * heightMm) - node.aaY };
      if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) return undefined;
      sources.push(source);
    }
    const window = k.sampler({ x: x + .5, y: y + .5 });
    const start = window.startOffsetSecondsFromOpeningReference, end = window.endOffsetSecondsFromOpeningReference;
    const duration = window.localExposureDurationSeconds;
    const e = environment as unknown as Rec, optics = e.optics as Rec, motion = e.motion as Rec;
    const focalLengthMm = optics.focalLengthMm as number, nominalFNumber = optics.nominalFNumber as number;
    const omega = motion.angularVelocityRadPerSec as { pitch: number; yaw: number; roll: number };
    // The pupil, f-number and focus were validated by the template's full planning (they are site-independent); the ray
    // arithmetic and its rotation and forward-hemisphere checks run per site through calculateSensorApertureRays' own code.
    const pupil = e.pupil as IdealCircularPupil | undefined;
    if (pupil !== undefined && sensorApertureRayValues({ sourcePointNativeSensorMm: { x: 0, y: 0 }, focalLengthMm, nominalFNumber,
      angularVelocityRadPerSec: omega, timeSecondsFromOpeningReference: start }, pupil, k.parsedFocus).rays.length !== k.pupilCount) return undefined;
    // Field throughput at a planned point, as the full planner computes it.
    const field = e.fieldThroughput as Rec;
    const fieldAt = (point: { x: number; y: number }): { value: FieldThroughput; factor: number; valid: boolean } => {
      if (field.kind === "unity") return { value: { kind: "unity" }, factor: 1, valid: true };
      const result = calculateIlluminationVignetting({ imagePointMm: { x: point.x, y: -point.y },
        profile: field.profile as Parameters<typeof calculateIlluminationVignetting>[0]["profile"] }).value;
      const imagePoint = { x: point.x, y: -point.y };
      const scale = Math.max(1, Math.abs(imagePoint.x), Math.abs(imagePoint.y), Math.abs(result.imagePointMm.x), Math.abs(result.imagePointMm.y));
      const tolerance = Number.EPSILON * 64 * scale, factor = result.linearThroughputFactor;
      const valid = !(Math.abs(result.imagePointMm.x - imagePoint.x) > tolerance || Math.abs(result.imagePointMm.y - imagePoint.y) > tolerance) &&
        Number.isFinite(factor) && factor > 0 && factor <= 1;
      return { value: { kind: "illumination-vignetting-result", result }, factor, valid };
    };
    // Tap points per group (spectral-major, spatial-minor). Without a PSF a group has one tap at its destination
    // (one field throughput per spatial node, shared by its spectral nodes). With a sampled PSF the kernel is resolved
    // at the destination and the taps sit at sensorPsfSourcePoint offsets, as in the full planner.
    const S = k.spectralCount, P = k.spatialCount;
    const tapPoints: (readonly { x: number; y: number }[])[] = [], tapFields: (readonly ReturnType<typeof fieldAt>[])[] = [];
    const kernels: (readonly number[])[] = [];
    // Without a PSF, the single tap of group gi is the destination sources[gi % P] (no per-group arrays are built).
    const destinationFields = k.psf === undefined ? sources.map(fieldAt) : undefined;
    if (k.psf !== undefined) for (let s = 0; s < S; s++) for (let p = 0; p < P; p++) {
      const destination = sources[p]!, gi = s * P + p;
      const kernel = resolveLensSampledPsfKernel({ ...k.psf, wavelengthNm: k.wavelengths[s]!, fieldPointMm: { x: destination.x, y: -destination.y } });
      const n = kernel.widthSamples * kernel.heightSamples, weights = kernel.normalizedIntensity;
      if (n !== k.tapCounts[gi] || weights.length !== n) return undefined;
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) {
        const point = sensorPsfSourcePoint(destination, kernel, i % kernel.widthSamples, Math.floor(i / kernel.widthSamples));
        // A non-finite kernel weight or tap point would fail the full planner's result checks: plan this site in full.
        if (!Number.isFinite(weights[i]!) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
        points.push(point);
      }
      tapPoints.push(points);
      tapFields.push(points.map(fieldAt));
      kernels.push(weights);
    }
    const measure = duration / k.temporalCount;
    let previous = -Infinity;
    const instants: { time: number; taps: LeanTap[] }[] = [];
    const pd = k.projectionDistanceMm, base = k.requestBase, id = environment.temporalIntegrationId;
    for (let ti = 0; ti < k.temporalCount; ti++) {
      const time = start + (ti + .5) * measure;
      if (!(time > start && time > previous && time < end)) return undefined;
      previous = time;
      if (!Number.isFinite(time) || time < 0) return undefined;
      const displacement = { pitch: omega.pitch * time, yaw: omega.yaw * time, roll: omega.roll * time };
      const taps: LeanTap[] = [];
      for (let gi = 0; gi < S * P; gi++) {
        // #394: without a PSF a key tap depends only on its spatial node (same point, direction, field and key at
        // every spectral node), so groups after the first spectral node share the first one's tap.
        if (access !== undefined && destinationFields !== undefined && gi >= P) { taps.push(taps[gi % P]!); continue; }
        const s = Math.floor(gi / P), points = destinationFields === undefined ? tapPoints[gi]! : undefined;
        const tapCount = points === undefined ? 1 : points.length;
        for (let pi = 0; pi < tapCount; pi++) {
          const point = points === undefined ? sources[gi % P]! : points[pi]!, sampleId = access === undefined ? `${id}-t${ti}-n${gi}-p${pi}` : "";
          const apertureRays = pupil === undefined ? undefined : sensorApertureRayValues({ sourcePointNativeSensorMm: point, focalLengthMm,
            nominalFNumber, angularVelocityRadPerSec: omega, timeSecondsFromOpeningReference: time }, pupil, k.parsedFocus).rays;
          let request: SceneRadianceEvaluationRequest | undefined, key: number | undefined, imagePointMm: { x: number; y: number }, distortionAreaFactor: number | undefined;
          if (k.lensMapping !== undefined) {
            if (access !== undefined) return undefined;
            // The full planner's own mapped query, with the same input; only its result envelope is not kept.
            const query = calculateMappedSensorEnvironmentRadianceQuery({ ...(motion as unknown as Pick<Parameters<typeof calculateMappedSensorEnvironmentRadianceQuery>[0],
              "angularVelocityRadPerSec" | "timeReference" | "environmentDirectionConvention">), sourcePointNativeSensorMm: point, focalLengthMm, focus: k.focus,
            timeSecondsFromOpeningReference: time, request: { schemaVersion: "0.1.0", sampleId, providerProfileId: base.providerProfileId, sceneId: base.sceneId,
              illuminationProfileId: base.illuminationProfileId, materialResponseProfileId: base.materialResponseProfileId, wavelengthNanometers: k.wavelengths[s]!,
              wavelengthBasis: base.wavelengthBasis as SceneRadianceEvaluationRequest["wavelengthBasis"] } }, k.lensMapping).value;
            request = freezeOwnedData(query.request);
            imagePointMm = query.sourcePointImagePlaneMm;
            distortionAreaFactor = query.lensFieldMapping?.distortionAreaFactor;
            if (distortionAreaFactor === undefined) return undefined;
          } else {
            // calculateSensorEnvironmentRadianceQuery with calculateInverseCameraRotationImageMapping.
            imagePointMm = { x: point.x, y: -point.y };
            if (!Number.isFinite(imagePointMm.x) || !Number.isFinite(imagePointMm.y)) return undefined;
            const reference = applyPhysicalCameraRotation({ x: imagePointMm.x / pd, y: imagePointMm.y / pd, z: 1 }, displacement, "camera-to-reference");
            if (!Number.isFinite(reference.z) || reference.z <= 0) return undefined;
            const rx = pd * (reference.x / reference.z), ry = pd * (reference.y / reference.z);
            const length = hypot3(rx, ry, pd);
            const ray = { x: rx / length, y: ry / length, z: pd / length };
            // Build the parseSceneRadianceEvaluationRequest output directly. Every other field is a template constant already
            // parsed for the template site. The sample ID is a public opaque ID (trimming cannot change it) and the time is
            // checked above. So only parseUnitDirection's unit-direction check depends on this site.
            const direction = { x: -ray.x, y: -ray.y, z: -ray.z };
            if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y) || !Number.isFinite(direction.z)) return undefined;
            const norm = hypot3(direction.x, direction.y, direction.z);
            if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-9) return undefined;
            // #394: the key the evaluator would read for this request (undefined where it would throw: the full path decides).
            if (access !== undefined) {
              key = access.keyOfDirection(direction, time);
              if (key === undefined) return undefined;
            } else request = Object.freeze({ schemaVersion: "0.1.0" as const, sampleId, providerProfileId: base.providerProfileId,
              sceneId: base.sceneId, illuminationProfileId: base.illuminationProfileId, materialResponseProfileId: base.materialResponseProfileId,
              target: Object.freeze({ kind: "environment-direction" as const, outgoingDirectionUnitVector: Object.freeze(direction) }),
              timeSecondsFromExposureStart: time, wavelengthNanometers: k.wavelengths[s]!,
              wavelengthBasis: base.wavelengthBasis as SceneRadianceEvaluationRequest["wavelengthBasis"] });
          }
          const f = destinationFields === undefined ? tapFields[gi]![pi]! : destinationFields[gi % P]!;
          // Built without object spread (cheaper per tap); optional fields are added only when present.
          const leanTap: LeanTap = { sourcePointImagePlaneMm: imagePointMm, fieldThroughput: f.value, fieldFactor: f.factor, fieldValid: f.valid };
          if (request !== undefined) leanTap.request = request; else leanTap.key = key!;
          if (apertureRays !== undefined) leanTap.apertureRays = apertureRays;
          if (distortionAreaFactor !== undefined) leanTap.distortionAreaFactor = distortionAreaFactor;
          taps.push(leanTap);
        }
      }
      instants.push({ time, taps });
    }
    return { lean: true, template: t, index, owned: environment, count: k.count, site: { x, y }, start, end, duration, instants,
      ...(k.psf === undefined ? {} : { kernels }), ...(access === undefined ? {} : { keyTaps: true as const }) };
  } catch {
    return undefined;
  }
}

/** Lean photo-signal arithmetic over values[ti][s*P+p]. Returns undefined when any data-dependent check fails. */
function photo(k: PlanConstants, c: ExecutionConstants, values: readonly Float64Array[], environment: Env, site: { x: number; y: number },
  start: number, end: number, duration: number, times: readonly number[]): SensorEqeTemporalPhotoSignal | undefined {
  const S = k.spectralCount, P = k.spatialCount, T = k.temporalCount;
  const photonRates = new Float64Array(T), electronRates = new Float64Array(T);
  const flux = new Float64Array(S), contribution = new Float64Array(S), averageContribution = new Float64Array(S);
  for (let ti = 0; ti < T; ti++) {
    const v = values[ti]!;
    // reduceSensorSpatioSpectralIrradiance
    let integratedAverage = 0, integratedFlux = 0;
    for (let s = 0; s < S; s++) {
      let average = 0, geometric = 0;
      for (let p = 0; p < P; p++) {
        const value = v[s * P + p]!;
        average += value * c.weight[p]!;
        geometric += value * c.areaSquareMeters[p]!;
        if (!Number.isFinite(average) || !Number.isFinite(geometric)) return undefined;
      }
      const averageTerm = average * c.measure[s]!, fluxTerm = geometric * c.measure[s]!;
      integratedAverage += averageTerm; integratedFlux += fluxTerm;
      if (!Number.isFinite(integratedAverage) || !Number.isFinite(integratedFlux)) return undefined;
      flux[s] = geometric; contribution[s] = fluxTerm; averageContribution[s] = averageTerm;
    }
    // assessSensorResponseOperatingRange: selected metric and per-bin values inside the calibrated range.
    const metric = c.rangeKind === "power" ? integratedFlux : integratedAverage;
    if (!Number.isFinite(metric) || metric < 0 || metric < c.rangeMinimum || metric > c.rangeMaximum) return undefined;
    if (c.perBin) for (let s = 0; s < S; s++) {
      const value = c.rangeKind === "power" ? contribution[s]! : averageContribution[s]!;
      if (!Number.isFinite(value) || value < 0 || value < c.rangeMinimum || value > c.rangeMaximum) return undefined;
    }
    // calculateSensorEqeElectronRate: reduction node checks, compensated power, then per-node rates.
    let powerSum = 0, powerCorrection = 0;
    for (let s = 0; s < S; s++) {
      const expected = flux[s]! * c.measure[s]!;
      if (!Number.isFinite(flux[s]!) || flux[s]! < 0 || !Number.isFinite(contribution[s]!) || contribution[s]! < 0 ||
        !Number.isFinite(expected) || !approximatelyEqual(contribution[s]!, expected)) return undefined;
      const adjusted = contribution[s]! - powerCorrection, next = powerSum + adjusted;
      powerCorrection = (next - powerSum) - adjusted; powerSum = next;
    }
    if (!(Number.isFinite(integratedFlux) && integratedFlux >= 0) || !approximatelyEqual(powerSum, integratedFlux)) return undefined;
    let photonSum = 0, photonCorrection = 0, electronSum = 0, electronCorrection = 0;
    for (let s = 0; s < S; s++) {
      const radiantPower = flux[s]! * c.measure[s]!;
      const photonRate = radiantPower / c.photonEnergy[s]!;
      const electronRate = photonRate * c.eqe[s]!;
      if (!Number.isFinite(radiantPower) || !Number.isFinite(photonRate) || !Number.isFinite(electronRate)) return undefined;
      const adjustedPhotons = photonRate - photonCorrection, nextPhotons = photonSum + adjustedPhotons;
      photonCorrection = (nextPhotons - photonSum) - adjustedPhotons; photonSum = nextPhotons;
      const adjustedElectrons = electronRate - electronCorrection, nextElectrons = electronSum + adjustedElectrons;
      electronCorrection = (nextElectrons - electronSum) - adjustedElectrons; electronSum = nextElectrons;
    }
    if (!Number.isFinite(photonSum) || !Number.isFinite(electronSum)) return undefined;
    photonRates[ti] = photonSum; electronRates[ti] = electronSum;
  }
  // sumTemporalEqeRateExpectations with the binding's seconds-valued measure.
  const measure = duration / T;
  let photons = 0, electrons = 0, photonCorrection = 0, electronCorrection = 0;
  for (let ti = 0; ti < T; ti++) {
    const p = photonRates[ti]! * measure, e = electronRates[ti]! * measure;
    const ap = p - photonCorrection, np = photons + ap; photonCorrection = (np - photons) - ap; photons = np;
    const ae = e - electronCorrection, ne = electrons + ae; electronCorrection = (ne - electrons) - ae; electrons = ne;
  }
  // parseSensorEqeTemporalPhotoSignal: finite non-negative rates, EQE domain and finite counts.
  for (let ti = 0; ti < T; ti++) {
    const pr = photonRates[ti]!, er = electronRates[ti]!;
    if (!Number.isFinite(pr) || pr < 0 || !Number.isFinite(er) || er < 0 || er > pr) return undefined;
  }
  if (!Number.isFinite(photons) || photons < 0 || !Number.isFinite(electrons) || electrons < 0) return undefined;
  const temporalSamples: object[] = [];
  for (let ti = 0; ti < T; ti++) temporalSamples.push(Object.freeze({ timeSecondsFromOpeningReference: times[ti]!,
    incidentPhotonRatePerSecond: photonRates[ti]!, expectedGeneratedElectronRatePerSecond: electronRates[ti]! }));
  return Object.freeze({ ...c.photo, temporalIntegrationId: environment.temporalIntegrationId, site: Object.freeze({ x: site.x, y: site.y }),
    startOffsetSecondsFromOpeningReference: start, endOffsetSecondsFromOpeningReference: end, localExposureDurationSeconds: duration,
    expectedIncidentPhotonCount: photons, expectedGeneratedElectronCount: electrons, temporalSamples: Object.freeze(temporalSamples) }) as SensorEqeTemporalPhotoSignal;
}

/** The temporal photo-signal input the full executor builds from these irradiance values (a PSF quadrature's nodes are equal plain data). */
function fullPhotoInput(k: PlanConstants, values: readonly Float64Array[], environment: Env, times: readonly number[]): Parameters<typeof createSensorEqeTemporalPhotoSignal>[0] {
  return { temporalIntegrationId: environment.temporalIntegrationId, exposure: { ...environment.sensor, samples: values.map((v, ti) => ({
    temporalSampleIndex: ti, timeSecondsFromOpeningReference: times[ti]!,
    irradianceSamples: k.nodes.map((node, gi) => ({ node: structuredClone(node), spectralIrradianceWattsPerSquareMeterPerNanometer: v[gi]! })) })) } };
}

/** Derives a template's plan constants from its full plan; throws when anything is outside the lean scope. */
function planConstants(environment: Env, plan: FullPlan): PlanConstants {
  const e = environment as unknown as Rec, sensor = e.sensor as Rec, spatial = sensor.spatialSampling as Rec;
  const apertureProfile = spatial.samplingApertureProfile as Rec;
  const aperture = apertureProfile.geometricSensitiveAperture as Rec, lattice = apertureProfile.siteCenterLattice as Rec;
  const first = lattice.firstSiteCenterFromImagingAreaTopLeftMicrometers as { x: number; y: number };
  const offset = aperture.centerOffsetFromSiteCenterMicrometers as { x: number; y: number };
  const imaging = spatial.imagingArea as { widthMm: number; heightMm: number };
  const spatialNodes = plan.spatialQuadrature.nodes, spectralNodes = plan.spectralQuadrature.nodes;
  const countX = spatial.spatialSampleCountX as number, countY = spatial.spatialSampleCountY as number;
  const S = spectralNodes.length, P = spatialNodes.length, T = plan.instants.length, groups = plan.instants[0]!.groups;
  const tapCounts = groups.map(group => group.taps.length), taps = tapCounts.reduce((sum, n) => sum + n, 0);
  const pupilCount = plan.count / (taps * T);
  const psf = e.psf as Rec, sampled = psf.kind === "sampled-local";
  if (!Number.isSafeInteger(pupilCount) || pupilCount < 1 || groups.length !== S * P || (!sampled && psf.kind !== "not-applied") ||
    (sampled && pupilCount !== 1) || (!sampled && tapCounts.some(n => n !== 1)) ||
    plan.instants.some(i => i.groups.length !== S * P || i.groups.some((g, gi) => g.taps.length !== tapCounts[gi]))) {
    throw new Error("outside lean scope");
  }
  const configuration = sampled ? (psf.configuration as Rec).psf as Omit<ResolveLensSampledPsfInput, "wavelengthNm" | "fieldPointMm"> : undefined;
  return {
    spectralCount: S, spatialCount: P, temporalCount: T, pupilCount, count: plan.count, tapCounts,
    tapOffsets: tapCounts.reduce((offsets: number[], n) => { offsets.push(offsets[offsets.length - 1]! + n); return offsets; }, [0]),
    ...(configuration === undefined ? {} : { psf: { profile: configuration.profile, focalLengthMm: configuration.focalLengthMm, focus: configuration.focus,
      apertureFNumber: configuration.apertureFNumber, signedDefocusImagePlaneMicrometers: configuration.signedDefocusImagePlaneMicrometers } }),
    ...("lensFieldMapping" in e ? { lensMapping: prepareEnvironmentLensFieldMapping(e.lensFieldMapping) } : {}),
    wavelengths: Float64Array.from(spectralNodes, n => n.wavelengthNanometers),
    nodes: groups.map(group => freezeOwnedData(structuredClone(group.node))),
    spatial: spatialNodes.map(n => ({ xPhase: (n.apertureSampleXIndex + 0.5) / countX, yPhase: (n.apertureSampleYIndex + 0.5) / countY,
      aaX: n.antiAliasingOffsetMicrometers.x / 1000, aaY: n.antiAliasingOffsetMicrometers.y / 1000 })),
    geometry: { firstX: first.x, firstY: first.y, pitchX: lattice.pitchXMicrometers as number, pitchY: lattice.pitchYMicrometers as number,
      offsetX: offset.x, offsetY: offset.y, widthUm: aperture.widthMicrometers as number, heightUm: aperture.heightMicrometers as number,
      imagingWidthMm: imaging.widthMm, imagingHeightMm: imaging.heightMm },
    sampler: prepareCaptureExposureWindowSampler((sensor.localExposure as Rec).exposureWindowInput as Parameters<typeof prepareCaptureExposureWindowSampler>[0]),
    projectionDistanceMm: resolveProjectionDistanceMm((e.optics as Rec).focalLengthMm as number,
      plan.focus.kind === "finite" ? plan.focus.distanceM : undefined).projectionDistanceMm,
    focus: plan.focus,
    parsedFocus: parseFocusPlane(plan.focus),
    requestBase: { providerProfileId: plan.sceneBindings.providerProfile.profileId, sceneId: plan.sceneBindings.providerProfile.sceneId,
      illuminationProfileId: plan.sceneBindings.illuminationProfile.profileId, materialResponseProfileId: plan.sceneBindings.materialResponseProfile.profileId,
      wavelengthBasis: plan.spectralQuadrature.wavelengthBasis },
    sceneBindings: plan.sceneBindings
  };
}

/** The lean planner must reproduce the template site's full plan bit for bit, including each resolved PSF kernel. */
function planReproduced(lean: LeanEnvironmentPlan | undefined, plan: FullPlan, k: PlanConstants): boolean {
  if (!lean || lean.count !== plan.count || lean.instants.length !== plan.instants.length || (lean.kernels !== undefined) !== (k.psf !== undefined)) return false;
  const check = new WeakMap<object, object>();
  for (let ti = 0; ti < plan.instants.length; ti++) {
    const full = plan.instants[ti]!, mine = lean.instants[ti]!;
    if (!Object.is(full.time, mine.time) || full.temporalSampleIndex !== ti || full.groups.length !== k.tapCounts.length ||
      mine.taps.length !== k.tapOffsets[k.tapCounts.length]) return false;
    for (let gi = 0; gi < full.groups.length; gi++) {
      const fullTaps = full.groups[gi]!.taps, first = k.tapOffsets[gi]!;
      if (fullTaps.length !== k.tapCounts[gi] || !sameData(full.groups[gi]!.node, k.nodes[gi], check)) return false;
      for (let pi = 0; pi < fullTaps.length; pi++) {
        const fullTap = fullTaps[pi]!, tap = mine.taps[first + pi]!;
        if (!Object.isFrozen(fullTap.request) || !Object.isFrozen(tap.request) || !sameData(fullTap.request, tap.request, check) ||
          !sameData(fullTap.sourcePointImagePlaneMm, tap.sourcePointImagePlaneMm, check) ||
          !sameData(fullTap.fieldThroughput, tap.fieldThroughput, check) || !sameData(fullTap.apertureRays, tap.apertureRays, check) ||
          !Object.is(fullTap.distortionAreaFactor, tap.distortionAreaFactor)) return false;
      }
    }
  }
  if (k.psf !== undefined) {
    // Each kernel must equal the public resolver's kernel for the template site's destination and wavelength.
    const S = k.spectralCount, P = k.spatialCount;
    for (let gi = 0; gi < S * P; gi++) {
      const destination = plan.spatialQuadrature.nodes[gi % P]!.preAntiAliasingSourcePointMm;
      const kernel = resolveLensSampledPsf({ ...k.psf, wavelengthNm: k.wavelengths[Math.floor(gi / P)]!,
        fieldPointMm: { x: destination.x, y: -destination.y } }).value.kernel;
      if (!sameData(kernel.normalizedIntensity, lean.kernels![gi], check)) return false;
    }
  }
  return true;
}

/** Sum of a PSF group's taps in kernel order, the same expression calculateSensorPsfIrradianceQuadrature reduces. */
function psfSum(kernel: readonly number[], values: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum = sum + kernel[i]! * values[i]!;
  return sum;
}

/**
 * True when every data-dependent check calculateSensorPsfIrradianceQuadrature makes on one instant passes: finite,
 * non-negative tap irradiances, finite weighted sums, and the finite partial sums of its spatio-spectral reduction
 * (in the reduction's node order). When false, the full quadrature runs and decides.
 */
function psfChecksPass(k: PlanConstants, c: ExecutionConstants, taps: readonly Float64Array[], v: Float64Array): boolean {
  for (const values of taps) for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i]!) || values[i]! < 0) return false;
  const S = k.spectralCount, P = k.spatialCount;
  let integratedAverage = 0, integratedFlux = 0;
  for (let s = 0; s < S; s++) {
    let average = 0, geometric = 0;
    for (let p = 0; p < P; p++) {
      const value = v[s * P + p]!;
      if (!Number.isFinite(value) || value < 0) return false;
      average += value * c.weight[p]!;
      geometric += value * c.areaSquareMeters[p]!;
      if (!Number.isFinite(average) || !Number.isFinite(geometric)) return false;
    }
    integratedAverage += average * c.measure[s]!; integratedFlux += geometric * c.measure[s]!;
    if (!Number.isFinite(integratedAverage) || !Number.isFinite(integratedFlux)) return false;
  }
  return true;
}

/** The full executor's PSF quadrature for one instant of a site's full plan, with the given tap irradiances. Throws its own errors. */
function fullPsfInstant(plan: FullPlan, ti: number, taps: readonly Float64Array[]): Float64Array {
  nativeEnvironmentLeanStatistics.psfFallbacks++;
  const instant = plan.instants[ti]!, owned = plan.owned;
  if (owned.psf.kind !== "sampled-local") throw new InvalidConfigurationError("Lean PSF fallback requires a sampled-PSF plan.");
  const psf = calculateSensorPsfIrradianceQuadrature({ ...owned.psf.configuration, spatialQuadrature: plan.spatialQuadrature,
    spectralQuadrature: plan.spectralQuadrature, timeSecondsFromOpeningReference: instant.time,
    inputMeaning: "pre-psf-pre-sensor-stack-pre-aa-spectral-irradiance", samples: instant.groups.map((group, gi) => ({ node: group.node,
      sourceSamples: group.taps.map((tap, pi) => ({ kernelSampleX: tap.kernelSampleX, kernelSampleY: tap.kernelSampleY, sourcePointNativeSensorMm: tap.point,
        timeSecondsFromOpeningReference: instant.time, spectralIrradianceWattsPerSquareMeterPerNanometer: taps[gi]![pi]! })) })) });
  return Float64Array.from(psf.value.irradianceSamples, sample => sample.spectralIrradianceWattsPerSquareMeterPerNanometer);
}

/** Derives execution constants from the template site's full execution ("full" retention) and checks them. Returns undefined on a mismatch. */
function executionConstants(k: PlanConstants, environment: Env, plan: FullPlan, result: FullResult, self: LeanEnvironmentPlan): ExecutionConstants | undefined {
  const S = k.spectralCount, P = k.spatialCount, T = k.temporalCount;
  const value = result.value, stages = value.photo.value.exposure.value.samples[0]!.stages;
  const spatial = stages.spatialQuadrature.value.nodes, spectral = stages.spectralQuadrature.value.nodes;
  const rate = stages.electronRate.value.perWavelength, range = stages.operatingRange.value;
  if (spatial.length !== P || spectral.length !== S || rate.length !== S || value.instants.length !== T) return undefined;
  for (let s = 0; s < S; s++) if (rate[s]!.spectralSampleIndex !== s || spectral[s]!.spectralSampleIndex !== s) return undefined;
  const c: ExecutionConstants = {
    weight: Float64Array.from(spatial, n => n.combinedNormalizedSpatialWeight),
    areaSquareMeters: Float64Array.from(spatial, n => n.combinedAreaMeasureSquareMicrometers * SQUARE_MICROMETERS_TO_SQUARE_METERS),
    measure: Float64Array.from(spectral, n => n.wavelengthMeasureNanometers),
    photonEnergy: Float64Array.from(rate, n => n.photonEnergyJoules), eqe: Float64Array.from(rate, n => n.effectiveExternalQuantumEfficiency),
    acceptance: new Float64Array(S).fill(NaN),
    rangeKind: range.inputRange.kind === "wavelength-integrated-geometric-aperture-radiant-power" ? "power" : "irradiance",
    rangeMinimum: range.inputRange.minimumInclusive, rangeMaximum: range.inputRange.maximumInclusive,
    perBin: range.spectralInputModel.kind === "per-spectral-bin", photo: value.photo.value.photoSignal
  };
  // Acceptance before field throughput per wavelength, and every evaluation's irradiance, must reproduce exactly.
  // With a PSF, each group's kernel-weighted sum must equal the full quadrature's node irradiance.
  const values: Float64Array[] = [];
  const check = new WeakMap<object, object>();
  for (let ti = 0; ti < T; ti++) {
    const evaluations = value.instants[ti]!.evaluations, v = new Float64Array(S * P), psf = value.instants[ti]!.psf;
    if ((psf !== null) !== (k.psf !== undefined)) return undefined;
    let next = 0;
    for (let gi = 0; gi < S * P; gi++) {
      const s = Math.floor(gi / P), taps = plan.instants[ti]!.groups[gi]!.taps, tapValues = new Float64Array(taps.length);
      for (let pi = 0; pi < taps.length; pi++) {
        const request = taps[pi]!.request;
        let integrated = 0;
        for (let r = 0; r < k.pupilCount; r++) {
          const evaluation = evaluations[next++];
          if (!evaluation) return undefined;
          const o = evaluation.optics.value;
          let a = o.transmissionPath === "spectral-transmission" ? o.paraxialGeometricAcceptanceSolidAngleSteradians * (o.spectralTransmissionFactor as number)
            : Math.PI / (4 * (o.effectiveWorkingTStop as number) * (o.effectiveWorkingTStop as number));
          a *= o.frontOfLensFilterTransmissionFactor;
          if (Number.isNaN(c.acceptance[s]!)) c.acceptance[s] = a; else if (!Object.is(c.acceptance[s], a)) return undefined;
          const acceptance = c.acceptance[s]! * o.fieldThroughputFactor;
          const irradiance = evaluation.result.spectralRadianceWattsPerSquareMeterSteradianNanometer * acceptance;
          if (!Object.is(acceptance, o.effectiveAcceptanceAfterTransmissionAndFieldSteradians) ||
            !Object.is(irradiance, o.sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer) ||
            evaluation.result.sampleId !== request.sampleId + (evaluation.apertureRay ? "-a" + evaluation.apertureRay.pupilSampleIndex : "")) return undefined;
          integrated += irradiance * (evaluation.apertureRay?.weight ?? 1);
        }
        const factor = taps[pi]!.distortionAreaFactor;
        if (factor !== undefined) integrated *= factor;
        tapValues[pi] = integrated;
      }
      if (psf === null) v[gi] = tapValues[0]!;
      else {
        const sample = psf.value.irradianceSamples[gi];
        v[gi] = psfSum(self.kernels![gi]!, tapValues);
        if (!sample || !Object.is(v[gi], sample.spectralIrradianceWattsPerSquareMeterPerNanometer) || !sameData(sample.node, k.nodes[gi], check)) return undefined;
      }
    }
    if (next !== evaluations.length) return undefined;
    values.push(v);
  }
  if (c.acceptance.some(Number.isNaN)) return undefined;
  const full = value.photo.value.photoSignal;
  const mine = photo(k, c, values, environment, full.site, full.startOffsetSecondsFromOpeningReference,
    full.endOffsetSecondsFromOpeningReference, full.localExposureDurationSeconds, plan.instants.map(i => i.time));
  return mine && sameData(mine, full, new WeakMap()) ? c : undefined;
}

/** #394: the evaluator's radiance for a key at spectral node s (tabulated keys from the template's table, computed once). */
function keyRadiance(t: Template, k: PlanConstants, access: InternalRadianceAccess, key: number, s: number): number {
  // Untabulated keys (lattice sites) are read from the evaluator's own lookup on each use.
  if (!access.tabulated) return access.radianceOfKey(key, k.wavelengths[s]!);
  const table = t.radiance!, row = table[key] ??= new Float64Array(k.spectralCount).fill(NaN);
  let value = row[s]!;
  if (Number.isNaN(value)) { value = access.radianceOfKey(key, k.wavelengths[s]!); row[s] = value; }
  return value;
}

/**
 * #394: true when the key taps of the template's own site give, tap by tap in callback order, exactly the radiance of each
 * evaluation of its full execution. Only then do its sites take radiances from the key lookup.
 */
function keyModeReproduced(t: Template, k: PlanConstants, access: InternalRadianceAccess, self: LeanEnvironmentPlan | undefined,
  result: FullResult): boolean {
  if (!self || self.keyTaps !== true || k.pupilCount !== 1 || self.instants.length !== result.value.instants.length) return false;
  const S = k.spectralCount, P = k.spatialCount;
  for (let ti = 0; ti < self.instants.length; ti++) {
    const evaluations = result.value.instants[ti]!.evaluations, taps = self.instants[ti]!.taps;
    if (evaluations.length !== taps.length) return false;
    for (let gi = 0; gi < S * P; gi++) for (let i = k.tapOffsets[gi]!; i < k.tapOffsets[gi + 1]!; i++) {
      const key = taps[i]!.key;
      if (key === undefined || !Object.is(keyRadiance(t, k, access, key, Math.floor(gi / P)),
        evaluations[i]!.result.spectralRadianceWattsPerSquareMeterSteradianNanometer)) return false;
    }
  }
  return true;
}

/**
 * Creates the per-event lean executor. With `access` (#394: the key lookup of an engine-built evaluator), a template whose own
 * site verifies it plans its sites as key taps and takes their radiances from the lookup.
 */
export function createNativeEnvironmentLeanExecutor(frame: NativeEnvironmentLeanFrame, access?: InternalRadianceAccess): NativeEnvironmentLeanExecutor {
  const templates: Template[] = [];
  const candidates = new Map<number, Template>();
  const memo = new WeakMap<object, object>();
  const enabled = !leanDisabled && frame.identityBinding && frame.repeatWidth > 0 && frame.repeatHeight > 0;
  const phaseOf = (index: number): number => {
    const x = index % frame.nativeWidth, y = Math.floor(index / frame.nativeWidth);
    return (y % frame.repeatHeight) * frame.repeatWidth + (x % frame.repeatWidth);
  };
  // 2.6: results of an engine-built evaluator (isInternalSceneRadianceEvaluator) reuse the parsed uncertainty, evidence
  // and limitations of the first such result that passed the full parse, when they are the same deep-frozen objects.
  let validatedRecords: ValidatedSceneRadianceRecords | undefined;
  const parseInternalResult = (value: unknown): SceneRadianceEvaluationResult => {
    if (validatedRecords) return parseSceneRadianceEvaluationResultWithValidatedRecords(value, validatedRecords);
    const parsed = parseSceneRadianceEvaluationResult(value), record = value as Rec;
    if (isDeeplyFrozen(record.uncertainty) && isDeeplyFrozen(record.evidence) && isDeeplyFrozen(record.limitations)) {
      validatedRecords = { uncertainty: record.uncertainty, evidence: record.evidence, limitations: record.limitations, parsed };
    }
    return parsed;
  };
  return {
    plan(environment, index): LeanEnvironmentPlan | "candidate" | undefined {
      if (!enabled) return undefined;
      const phase = phaseOf(index);
      let t: Template | undefined;
      try {
        for (const template of templates) if (template.phase === phase && environmentMatches(environment, template.environment, memo)) { t = template; break; }
      } catch {
        return undefined;
      }
      if (!t) return templates.length < MAXIMUM_TEMPLATES ? "candidate" : undefined;
      if (t.disabled || !t.consts || t.executionVerified === false) return undefined;
      const leanPlan = geometry(t, t.consts, frame, environment, index, t.keyMode === true ? access : undefined);
      if (leanPlan) nativeEnvironmentLeanStatistics.plannedSites++;
      return leanPlan;
    },
    admitCandidate(environment, index, plan): void {
      const template: Template = { environment, phase: phaseOf(index), disabled: true };
      templates.push(template);
      candidates.set(index, template);
      try {
        const k = planConstants(environment, plan), self = geometry(template, k, frame, environment, index);
        if (!planReproduced(self, plan, k)) return;
        template.consts = k;
        template.selfPlan = self!;
        template.disabled = false;
      } catch {
        // An ineligible template leaves its sites on the full path.
      }
    },
    isCandidate(index): boolean { return candidates.has(index); },
    verifyCandidate(index, plan, result): void {
      const t = candidates.get(index);
      if (!t) return;
      candidates.delete(index);
      t.executionVerified = false;
      try {
        if (t.disabled || !t.consts || !t.selfPlan) return;
        const c = executionConstants(t.consts, t.environment, plan, result, t.selfPlan);
        t.selfPlan = undefined;
        if (!c) return;
        t.execution = c;
        t.executionVerified = true;
        // #394: key taps need no pupil and no lens mapping (the evaluator then reads one plane point per tap).
        if (access !== undefined && t.consts.lensMapping === undefined && (t.environment as unknown as Rec).pupil === undefined) {
          t.radiance = [];
          t.keyMode = keyModeReproduced(t, t.consts, access, geometry(t, t.consts, frame, t.environment, index, access), result);
          if (!t.keyMode) delete t.radiance;
        }
      } catch {
        // Unverified: sites of this template run the full path.
      }
    },
    execute(plan, evaluate, aperture, fullPlan, internalEvaluator = false, countEvaluations): SensorEqeTemporalPhotoSignal | undefined {
      const t = plan.template, c = t.execution, k = t.consts;
      if (t.executionVerified !== true || !c || !k) return undefined;
      const environment = plan.owned, optics = (environment as unknown as Rec).optics;
      const S = k.spectralCount, P = k.spatialCount, kernels = plan.kernels;
      if (plan.keyTaps === true) {
        // #394: every tap's radiance from the evaluator's key lookup, with tapIrradiance's arithmetic. A tap that would
        // need the full irradiance function returns undefined before anything is counted: the caller runs the site in full.
        if (t.keyMode !== true || !access || !countEvaluations) return undefined;
        const values: Float64Array[] = [], times: number[] = [], instantTaps: Float64Array[][] = [];
        for (const instant of plan.instants) {
          const v = new Float64Array(S * P), tapValues: Float64Array[] = [];
          if (kernels === undefined) {
            // One tap per group.
            for (let gi = 0; gi < S * P; gi++) {
              const tap = instant.taps[gi]!, s = Math.floor(gi / P);
              const irradiance = keyRadiance(t, k, access, tap.key!, s) * (c.acceptance[s]! * tap.fieldFactor);
              if (!tap.fieldValid || !Number.isFinite(irradiance) || irradiance < 0) return undefined;
              let integrated = 0;
              integrated += irradiance * 1;
              v[gi] = integrated;
            }
            values.push(v);
            times.push(instant.time);
            continue;
          }
          for (let gi = 0; gi < S * P; gi++) {
            const first = k.tapOffsets[gi]!, s = Math.floor(gi / P), groupValues = new Float64Array(k.tapOffsets[gi + 1]! - first);
            for (let pi = 0; pi < groupValues.length; pi++) {
              const tap = instant.taps[first + pi]!;
              const irradiance = keyRadiance(t, k, access, tap.key!, s) * (c.acceptance[s]! * tap.fieldFactor);
              if (!tap.fieldValid || !Number.isFinite(irradiance) || irradiance < 0) return undefined;
              let integrated = 0;
              integrated += irradiance * 1;
              groupValues[pi] = integrated;
            }
            tapValues.push(groupValues);
            v[gi] = kernels === undefined ? groupValues[0]! : psfSum(kernels[gi]!, groupValues);
          }
          values.push(v);
          instantTaps.push(tapValues);
          times.push(instant.time);
        }
        // The evaluations the full path would count (and its abort check), then the PSF checks after each instant's taps.
        countEvaluations(plan.count);
        let full: FullPlan | undefined;
        if (kernels !== undefined) for (let ti = 0; ti < values.length; ti++) {
          if (!psfChecksPass(k, c, instantTaps[ti]!, values[ti]!)) values[ti] = fullPsfInstant(full ??= fullPlan(), ti, instantTaps[ti]!);
        }
        nativeEnvironmentLeanStatistics.executedSites++;
        nativeEnvironmentLeanStatistics.keySites++;
        return photo(k, c, values, environment, plan.site, plan.start, plan.end, plan.duration, times) ??
          createSensorEqeTemporalPhotoSignal(fullPhotoInput(k, values, environment, times)).value.photoSignal;
      }
      /** One tap: its callbacks in order, each result validated, the pupil sum, then the distortion area factor once. */
      const tapIrradiance = (leanTap: LeanTap, s: number): number => {
        const tap = leanTap as LeanTap & { request: SceneRadianceEvaluationRequest };
        let integrated = 0;
        const support: readonly (SensorApertureRay | undefined)[] = tap.apertureRays ?? [undefined];
        for (const ray of support) {
          const query = ray === undefined ? undefined : apertureRadianceQuery(tap.request, ray);
          const request = query === undefined ? tap.request : query.request, apertureRay = query?.apertureRay;
          const result = apertureRay === undefined ? (internalEvaluator ? parseInternalResult(evaluate(request)) : parseSceneRadianceEvaluationResult(evaluate(request))) :
            parseSceneRadianceEvaluationResult(aperture!(request, apertureRay));
          if (result.sampleId !== request.sampleId || result.providerProfileId !== request.providerProfileId || result.sceneId !== request.sceneId ||
            result.wavelengthNanometers !== request.wavelengthNanometers || result.wavelengthBasis !== request.wavelengthBasis) {
            validateSceneRadianceEvaluationBindings({ ...k.sceneBindings, request, result });
          }
          let irradiance = result.spectralRadianceWattsPerSquareMeterSteradianNanometer * (c.acceptance[s]! * tap.fieldFactor);
          if (!tap.fieldValid || !Number.isFinite(irradiance) || irradiance < 0) {
            irradiance = calculateSceneRadianceToSensorIrradiance({ ...(optics as Parameters<typeof calculateSceneRadianceToSensorIrradiance>[0]),
              sceneRadianceRequest: request, sceneRadianceResult: result, imagePointMm: tap.sourcePointImagePlaneMm,
              fieldThroughput: tap.fieldThroughput }).value.sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer;
          }
          integrated += irradiance * (ray?.weight ?? 1);
        }
        // Distortion squeezes or stretches the ideal image; irradiance scales by 1/det once, as in the full executor.
        if (tap.distortionAreaFactor !== undefined) integrated *= tap.distortionAreaFactor;
        return integrated;
      };
      const values: Float64Array[] = [], times: number[] = [];
      let full: FullPlan | undefined;
      for (let ti = 0; ti < plan.instants.length; ti++) {
        const instant = plan.instants[ti]!;
        let v: Float64Array = new Float64Array(S * P);
        if (kernels === undefined) {
          // One tap per group, so the flat list is indexed by group.
          for (let gi = 0; gi < S * P; gi++) v[gi] = tapIrradiance(instant.taps[gi]!, Math.floor(gi / P));
        } else {
          const tapValues: Float64Array[] = [];
          for (let gi = 0; gi < S * P; gi++) {
            const first = k.tapOffsets[gi]!, s = Math.floor(gi / P), groupValues = new Float64Array(k.tapOffsets[gi + 1]! - first);
            for (let pi = 0; pi < groupValues.length; pi++) groupValues[pi] = tapIrradiance(instant.taps[first + pi]!, s);
            tapValues.push(groupValues);
            v[gi] = psfSum(kernels[gi]!, groupValues);
          }
          // The full executor runs its PSF quadrature (and its checks) here, after this instant's callbacks. When a check
          // fails, run that quadrature on the site's full plan (built without callbacks): it throws its own error or decides.
          if (!psfChecksPass(k, c, tapValues, v)) v = fullPsfInstant(full ??= fullPlan(), ti, tapValues);
        }
        values.push(v);
        times.push(instant.time);
      }
      nativeEnvironmentLeanStatistics.executedSites++;
      return photo(k, c, values, environment, plan.site, plan.start, plan.end, plan.duration, times) ??
        createSensorEqeTemporalPhotoSignal(fullPhotoInput(k, values, environment, times)).value.photoSignal;
    }
  };
}

function approximatelyEqual(actual: number, expected: number): boolean {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  return Math.abs(actual - expected) <= REDUCTION_TOLERANCE * scale;
}

/** Photo-signal fields that vary per site; every other field is template-level. */
const PHOTO_SITE_FIELDS: ReadonlySet<string> = new Set(["temporalIntegrationId", "site", "startOffsetSecondsFromOpeningReference",
  "endOffsetSecondsFromOpeningReference", "localExposureDurationSeconds", "expectedIncidentPhotonCount", "expectedGeneratedElectronCount", "temporalSamples"]);
const SITE_ONLY: ReadonlySet<string> = new Set(["site"]);
const SITE_APPLICABILITY: ReadonlySet<string> = new Set(["siteApplicability"]);
const COMPLETENESS: ReadonlySet<string> = new Set(["completenessProfile"]);
const CAPACITY: ReadonlySet<string> = new Set(["capacityProfile"]);
const COMPLETENESS_SITE_FIELDS: ReadonlySet<string> = new Set(["site", "startOffsetSecondsFromOpeningReference", "endOffsetSecondsFromOpeningReference"]);

/** Same own keys in the same order; values strictly equal except `skip` keys (compared by the caller). */
function sameRecordExcept(a: unknown, b: unknown, skip: ReadonlySet<string>, memo: WeakMap<object, object>): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) || Array.isArray(b) ||
    !isPlainRecord(a) || !isPlainRecord(b)) return false;
  const ar = a as Rec, br = b as Rec, ak = Object.keys(ar), bk = Object.keys(br);
  if (ak.length !== bk.length || Object.getOwnPropertySymbols(ar).length !== 0 || Object.getOwnPropertySymbols(br).length !== 0) return false;
  for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
  for (const key of ak) if (!skip.has(key) && !sameData(ar[key], br[key], memo)) return false;
  return true;
}
/** A plain {x, y} record equal (Object.is) to the given coordinates. */
function siteSlot(value: unknown, x: number, y: number): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isPlainRecord(value)) return false;
  const keys = Object.keys(value), r = value as Rec;
  return keys.length === 2 && keys[0] === "x" && keys[1] === "y" && Object.is(r.x, x) && Object.is(r.y, y) && Object.getOwnPropertySymbols(value).length === 0;
}
/** A record whose optional `site` key (the only one skipped) holds each side's own coordinates. */
function sameWithSiteSlot(a: unknown, b: unknown, ax: number, ay: number, bx: number, by: number, memo: WeakMap<object, object>): boolean {
  if (!sameRecordExcept(a, b, SITE_ONLY, memo)) return false;
  const ar = a as Rec, br = b as Rec;
  return !("site" in ar) || (siteSlot(ar.site, ax, ay) && siteSlot(br.site, bx, by));
}

interface SensorTemplate {
  site: Site;
  photo: SensorEqeTemporalPhotoSignal;
  phase: number; x: number; y: number;
  verified: boolean;
  darkRate: number;
  capacity: number;
  readout: ResolvedSensorReadoutRegime;
  pattern: SensorFixedPatternNoiseProfile | undefined;
  whiteCode: number;
}
interface SensorHandle {
  template: SensorTemplate; site: Site; photo: SensorEqeTemporalPhotoSignal; x: number; y: number; darkE: number; total: number;
}

/** Sensor-site equality except the index-bound site slots and the per-site photo numbers. */
function sensorMatches(site: Site, photo: SensorEqeTemporalPhotoSignal, x: number, y: number, t: SensorTemplate, memo: WeakMap<object, object>): boolean {
  const a = site as unknown as Rec, b = t.site as unknown as Rec;
  if (typeof a !== "object" || a === null || !isPlainRecord(a)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length || Object.getOwnPropertySymbols(a).length !== 0) return false;
  for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
  for (const key of ak) {
    if (key === "environment") continue;
    if (key === "darkCurrentProfile") {
      const ad = a.darkCurrentProfile as Rec, bd = b.darkCurrentProfile as Rec;
      if (!sameRecordExcept(ad, bd, SITE_APPLICABILITY, memo) ||
        !sameWithSiteSlot(ad.siteApplicability, bd.siteApplicability, x, y, t.x, t.y, memo)) return false;
    } else if (key === "charge") {
      const ac = a.charge as Rec, bc = b.charge as Rec;
      if (!sameRecordExcept(ac, bc, COMPLETENESS, memo) || "additionalChargeComponents" in ac) return false;
      const ap = ac.completenessProfile as Rec, bp = bc.completenessProfile as Rec;
      if (!sameRecordExcept(ap, bp, COMPLETENESS_SITE_FIELDS, memo) || !siteSlot(ap.site, x, y) || !siteSlot(bp.site, t.x, t.y) ||
        ap.startOffsetSecondsFromOpeningReference !== photo.startOffsetSecondsFromOpeningReference ||
        ap.endOffsetSecondsFromOpeningReference !== photo.endOffsetSecondsFromOpeningReference) return false;
    } else if (key === "readout") {
      const ar = a.readout as Rec, br = b.readout as Rec;
      if (!sameRecordExcept(ar, br, CAPACITY, memo)) return false;
      const ac = ar.capacityProfile as Rec, bc = br.capacityProfile as Rec;
      if (!sameRecordExcept(ac, bc, SITE_APPLICABILITY, memo) ||
        !sameWithSiteSlot(ac.siteApplicability, bc.siteApplicability, x, y, t.x, t.y, memo)) return false;
    } else if (!sameData(a[key], b[key], memo)) return false;
  }
  return sameRecordExcept(photo, t.photo, PHOTO_SITE_FIELDS, memo) && siteSlot(photo.site, x, y) &&
    photo.temporalSamples.length === t.photo.temporalSamples.length;
}

/** The sensor stage of calculateNativeRawSite, in the same operation order. Returns undefined when one of its checks would throw. */
/**
 * #418: the charge and read-noise streams of the site leanSensorSite is computing, reseeded for each site. leanSensorSite is
 * synchronous and never re-entered, so one pair serves every call; reseeding sets exactly the state a new
 * createDeterministicUniformStream would start from, so every draw is unchanged.
 */
const chargeStream = createResettableUniformStream(), readNoiseStream = createResettableUniformStream();

function leanSensorSite(t: Pick<SensorTemplate, "capacity" | "readout" | "pattern" | "whiteCode">, h: Pick<SensorHandle, "photo" | "darkE" | "total" | "x" | "y">, index: number, seed: number):
  (NativeRawLeanOutput & { photoRealized: number; darkRealized: number }) | undefined {
  const ratio = h.total / t.capacity, headroom = t.capacity - h.total;
  if (!Number.isFinite(ratio) || !Number.isFinite(headroom)) return undefined;
  const pattern = t.pattern === undefined ? null : evaluateParsedFixedPatternSite(t.pattern, { x: h.x, y: h.y });
  const photoE = h.photo.expectedGeneratedElectronCount;
  const photoMean = pattern === null ? photoE : photoE * pattern.photoResponseGainFactor;
  const darkMean = pattern === null ? h.darkE : h.darkE * pattern.darkCurrentFactor;
  if (!Number.isFinite(photoMean) || photoMean < 0 || !Number.isFinite(darkMean) || darkMean < 0) return undefined;
  const random = chargeStream;
  random.reset(deriveNativeSiteStreamSeedUint32(seed, index, NATIVE_SITE_CHARGE_STREAM_ID));
  const photoRealized = samplePoisson(photoMean, random), darkRealized = samplePoisson(darkMean, random);
  const realized = photoRealized + darkRealized + 0;
  if (!Number.isFinite(realized) || realized < 0) return undefined;
  const readRandom = readNoiseStream;
  readRandom.reset(deriveNativeSiteStreamSeedUint32(seed, index, NATIVE_SITE_READ_NOISE_STREAM_ID));
  const regime = t.readout.regime, capacity = t.capacity;
  const afterPhysical = Math.min(realized, capacity), physicalSaturation = afterPhysical < realized;
  // The components' draws and their sum in one loop: the same draws, added to 0 in the same order as before (#418).
  const components = regime.readNoiseComponents;
  let totalReadNoise = 0;
  for (let k = 0; k < components.length; k++) {
    const rms = components[k]!.rmsElectrons.value;
    totalReadNoise = totalReadNoise + (rms === 0 ? 0 : sampleDeterministicStandardNormal(readRandom) * rms);
  }
  const afterReadNoise = afterPhysical + totalReadNoise + (pattern === null ? 0 : pattern.readoutOffsetElectrons);
  const threshold = regime.preAdcSaturationElectronEquivalent.value;
  const afterPreAdc = Math.min(afterReadNoise, threshold), preAdcSaturation = afterReadNoise > threshold;
  const quantized = adcTransfer(regime, t.readout.adcMaximumCode, afterPreAdc).quantized;
  const digitalSaturationCode = regime.adc.digitalSaturationCode;
  return { rawCode: Math.max(0, Math.min(quantized, digitalSaturationCode)), blackLevelCode: regime.adc.blackLevelCode, digitalSaturationCode,
    flags: Number(physicalSaturation) | Number(preAdcSaturation) << 1 | Number(quantized >= digitalSaturationCode) << 2,
    whiteCode: t.whiteCode, photoRealized, darkRealized };
}

/**
 * #449: leanSensorSite for one verified readout, with the readout regime's constants read once into flat fields, the dark
 * Poisson threshold e^(−mean) kept while the dark mean repeats, adcTransfer's arithmetic inline when there is no integral non-linearity,
 * and the outputs written into one record that every call reuses. The same operations in the same order as leanSensorSite;
 * createVerifiedNativeSiteReadout checks it against the full site as it checks leanSensorSite.
 */
interface FlatSensorStage {
  darkRate: number; capacity: number; pattern: SensorFixedPatternNoiseProfile | undefined; whiteCode: number;
  regime: ResolvedSensorReadoutRegime["regime"]; adcMaximumCode: number; inlDefined: boolean;
  gain: number; black: number; digitalGain: number | undefined; digitalSaturationCode: number; threshold: number; rms: Float64Array;
  /** The dark mean of the last site and its samplePoisson threshold e^(−mean) (used for 0 < mean < 30). */
  darkMean: number; darkThreshold: number;
  /** The reused output record: the caller reads its five fields before the next call. */
  out: NativeRawLeanOutput;
}
function flatSensorStage(t: Pick<SensorTemplate, "darkRate" | "capacity" | "readout" | "pattern" | "whiteCode">): FlatSensorStage {
  const regime = t.readout.regime;
  return { darkRate: t.darkRate, capacity: t.capacity, pattern: t.pattern, whiteCode: t.whiteCode, regime, adcMaximumCode: t.readout.adcMaximumCode,
    inlDefined: regime.adc.integralNonLinearity !== undefined, gain: regime.systemConversionGainElectronsPerCode.value, black: regime.adc.blackLevelCode,
    digitalGain: regime.adc.digitalGain, digitalSaturationCode: regime.adc.digitalSaturationCode, threshold: regime.preAdcSaturationElectronEquivalent.value,
    rms: Float64Array.from(regime.readNoiseComponents, (component) => component.rmsElectrons.value), darkMean: NaN, darkThreshold: NaN,
    out: { rawCode: 0, blackLevelCode: 0, digitalSaturationCode: 0, flags: 0, whiteCode: 0 } };
}
/** Writes the site's outputs into `f.out`; false where leanSensorSite returns undefined. */
function flatSensorSite(f: FlatSensorStage, photoE: number, darkE: number, total: number, x: number, y: number, index: number, seed: number): boolean {
  const ratio = total / f.capacity, headroom = f.capacity - total;
  if (!Number.isFinite(ratio) || !Number.isFinite(headroom)) return false;
  const pattern = f.pattern === undefined ? null : evaluateParsedFixedPatternSite(f.pattern, { x, y });
  const photoMean = pattern === null ? photoE : photoE * pattern.photoResponseGainFactor;
  const darkMean = pattern === null ? darkE : darkE * pattern.darkCurrentFactor;
  if (!Number.isFinite(photoMean) || photoMean < 0 || !Number.isFinite(darkMean) || darkMean < 0) return false;
  const random = chargeStream;
  random.reset(deriveNativeSiteStreamSeedUint32(seed, index, NATIVE_SITE_CHARGE_STREAM_ID));
  const photoRealized = samplePoisson(photoMean, random);
  let darkRealized: number;
  if (darkMean > 0 && darkMean < 30) {
    // samplePoisson's branch for 0 < mean < 30 (Knuth's product of uniforms) with its threshold Math.exp(−mean) kept while the
    // mean repeats: the same draws from the same stream. (createPoissonSampler would also do this, but it brings the
    // portable-math functions into capture-only bundles.)
    if (darkMean !== f.darkMean) { f.darkMean = darkMean; f.darkThreshold = Math.exp(-darkMean); }
    const threshold = f.darkThreshold;
    let product = 1, count = 0;
    do { count += 1; product *= random.next(); } while (product > threshold);
    darkRealized = count - 1;
  } else darkRealized = samplePoisson(darkMean, random);
  const realized = photoRealized + darkRealized + 0;
  if (!Number.isFinite(realized) || realized < 0) return false;
  const readRandom = readNoiseStream;
  readRandom.reset(deriveNativeSiteStreamSeedUint32(seed, index, NATIVE_SITE_READ_NOISE_STREAM_ID));
  const capacity = f.capacity;
  const afterPhysical = Math.min(realized, capacity), physicalSaturation = afterPhysical < realized;
  const rmsAll = f.rms;
  let totalReadNoise = 0;
  for (let k = 0; k < rmsAll.length; k++) {
    const rms = rmsAll[k]!;
    totalReadNoise = totalReadNoise + (rms === 0 ? 0 : sampleDeterministicStandardNormal(readRandom) * rms);
  }
  const afterReadNoise = afterPhysical + totalReadNoise + (pattern === null ? 0 : pattern.readoutOffsetElectrons);
  const threshold = f.threshold;
  const afterPreAdc = Math.min(afterReadNoise, threshold), preAdcSaturation = afterReadNoise > threshold;
  let quantized: number;
  if (f.inlDefined) quantized = adcTransfer(f.regime, f.adcMaximumCode, afterPreAdc).quantized;
  else {
    // adcTransfer without integral non-linearity: ideal = e/G + black, plus the zero INL offset, rounded half up (Math.round + 0),
    // then with a digital gain the ADC clamp and the gain's own rounding about the black level.
    const ideal = afterPreAdc / f.gain + f.black, quantizedAdc = Math.round(ideal + 0) + 0, digitalGain = f.digitalGain;
    if (digitalGain === undefined) quantized = quantizedAdc;
    else {
      const adcCode = Math.max(0, Math.min(quantizedAdc, f.adcMaximumCode));
      quantized = Math.round((adcCode - f.black) * digitalGain + f.black) + 0;
    }
  }
  const digitalSaturationCode = f.digitalSaturationCode, out = f.out;
  out.rawCode = Math.max(0, Math.min(quantized, digitalSaturationCode)); out.blackLevelCode = f.black; out.digitalSaturationCode = digitalSaturationCode;
  out.flags = Number(physicalSaturation) | Number(preAdcSaturation) << 1 | Number(quantized >= digitalSaturationCode) << 2;
  out.whiteCode = f.whiteCode;
  return true;
}

/** The Kahan (compensated) total that composeSensorAccumulatedCharge computes, for photo and dark charge only. */
function chargeTotal(photoE: number, darkE: number): number {
  let sum = 0, correction = 0;
  for (const value of [photoE, darkE]) {
    const adjusted = value - correction, next = sum + adjusted;
    correction = (next - sum) - adjusted; sum = next;
  }
  return sum;
}

/** #394: the sensor stage of one CFA phase for given expected photo electrons, verified against a full site computation. */
export interface NativeSiteReadout {
  /** The site's RAW outputs for expected photo electrons `photoE` over a local exposure of `duration` seconds; undefined where a check of the full path would throw. */
  compute(photoE: number, duration: number, x: number, y: number, index: number, seed: number): NativeRawLeanOutput | undefined;
}

/**
 * #394: a sensor template from one fully parsed and computed site (`calculateNativeRawSite`), as the lean sensor stage builds
 * its templates; undefined unless the lean arithmetic reproduces that site's dark and total charge, both charge realizations,
 * its codes and its flags bit for bit. Its `compute` then gives `calculateNativeRawSite`'s outputs for any site of the same
 * readout inputs (same CFA channel, dark current, capacity, readout regime and fixed-pattern profile).
 */
export function createVerifiedNativeSiteReadout(parsed: SensorRawProducerSiteInput, result: ReturnType<typeof calculateNativeRawSite>, whiteCode: number,
  photo: SensorEqeTemporalPhotoSignal, x: number, y: number, index: number, seed: number): NativeSiteReadout | undefined {
  try {
    const readout = resolveSensorReadoutRegime({ profile: parsed.readoutProfile, regimeId: parsed.regimeId });
    const t: Pick<SensorTemplate, "darkRate" | "capacity" | "readout" | "pattern" | "whiteCode"> = { darkRate: parsed.charge.darkCharge.darkCurrentElectronsPerSecond,
      capacity: result.capacity.value.physicalChargeCapacityElectrons, readout, pattern: parsed.fixedPatternNoise, whiteCode };
    const darkE = t.darkRate * photo.localExposureDurationSeconds, total = chargeTotal(photo.expectedGeneratedElectronCount, darkE);
    const r = result.readout.value, realization = result.realization.value, out = leanSensorSite(t, { photo, darkE, total, x, y }, index, seed);
    if (!out || !Object.is(darkE, parsed.charge.darkCharge.expectedDarkElectronCount) || !Object.is(total, result.accumulatedCharge.value.totalExpectedStoredElectronCount) ||
      !Object.is(out.photoRealized, realization.photoRealizedElectronCount) || !Object.is(out.darkRealized, realization.darkRealizedElectronCount) ||
      realization.additionalComponents.length !== 0 || out.rawCode !== r.rawCode || out.blackLevelCode !== r.blackLevelCode || out.digitalSaturationCode !== r.digitalSaturationCode ||
      out.flags !== (Number(r.physicalScalarSaturationApplied) | Number(r.preAdcSaturationApplied) << 1 | Number(r.digitalSaturationApplied) << 2)) return undefined;
    // #449: the flat stage must reproduce the verification site too.
    const flat = flatSensorStage(t), fo = flat.out;
    if (!flatSensorSite(flat, photo.expectedGeneratedElectronCount, darkE, total, x, y, index, seed) || fo.rawCode !== out.rawCode || fo.blackLevelCode !== out.blackLevelCode ||
      fo.digitalSaturationCode !== out.digitalSaturationCode || fo.flags !== out.flags || fo.whiteCode !== out.whiteCode) return undefined;
    return {
      compute(photoE, duration, sx, sy, siteIndex, siteSeed): NativeRawLeanOutput | undefined {
        // The parse-phase predicates of the full path (claim()): finite non-negative dark and total charge.
        const siteDark = flat.darkRate * duration;
        if (!Number.isFinite(photoE) || photoE < 0 || !Number.isFinite(siteDark) || siteDark < 0) return undefined;
        const siteTotal = chargeTotal(photoE, siteDark);
        if (!Number.isFinite(siteTotal) || siteTotal < 0) return undefined;
        // One record for every site (#449): the caller copies the five RAW fields before its next call.
        return flatSensorSite(flat, photoE, siteDark, siteTotal, sx, sy, siteIndex, siteSeed) ? fo : undefined;
      }
    };
  } catch {
    return undefined;
  }
}

/**
 * Lean sensor stage for createNativeEnvironmentRawTask.
 *
 * claim() runs in the environment task, at the point where the full path composes the site (dark charge), and
 * evaluates every parse-phase check there. compute() runs in the native RAW task's compute phase. If any
 * compute-phase check fails, it falls back to the full parse and calculateNativeRawSite.
 */
export interface NativeEnvironmentSensorLean {
  readonly hook: NativeRawLeanSensorHook;
  /** Starts a tile: fully composed sites of the previous tile are forgotten. */
  beginTile(): void;
  /** A lean tile entry for a site matching a verified template, or undefined (compose it in full and remember it). */
  claim(site: Site, photo: SensorEqeTemporalPhotoSignal, index: number): object | undefined;
  /** Remembers a fully composed site so its full computation can become a template. */
  remember(index: number, site: Site, photo: SensorEqeTemporalPhotoSignal): void;
}

export function createNativeEnvironmentSensorLean(frame: NativeEnvironmentLeanFrame, producerFrame: NativeRawProducerFrameContext,
  nativeWindow: ((point: { x: number; y: number }) => { startOffsetSecondsFromOpeningReference: number; endOffsetSecondsFromOpeningReference: number;
    localExposureDurationSeconds: number }) | undefined): NativeEnvironmentSensorLean {
  const enabled = !leanDisabled && nativeWindow !== undefined && frame.identityBinding && frame.repeatWidth > 0 && frame.repeatHeight > 0;
  const templates: SensorTemplate[] = [], handles = new WeakMap<object, SensorHandle>(), memo = new WeakMap<object, object>();
  let pending = new Map<number, { site: Site; photo: SensorEqeTemporalPhotoSignal }>();
  const coordinates = (index: number): { x: number; y: number; phase: number } => {
    const x = index % frame.nativeWidth, y = Math.floor(index / frame.nativeWidth);
    return { x, y, phase: (y % frame.repeatHeight) * frame.repeatWidth + (x % frame.repeatWidth) };
  };
  const find = (site: Site, photo: SensorEqeTemporalPhotoSignal, x: number, y: number, phase: number): SensorTemplate | undefined => {
    for (const t of templates) if (t.phase === phase && sensorMatches(site, photo, x, y, t, memo)) return t;
    return undefined;
  };
  return {
    beginTile(): void { pending = new Map(); },
    claim(site, photo, index): object | undefined {
      if (!enabled) return undefined;
      try {
        const { x, y, phase } = coordinates(index), t = find(site, photo, x, y, phase);
        if (!t || !t.verified) return undefined;
        // Parse-phase predicates of the full path: EQE domain, dark and total charge, and the committed local window.
        const photoE = photo.expectedGeneratedElectronCount, duration = photo.localExposureDurationSeconds;
        if (!(photoE <= photo.expectedIncidentPhotonCount)) return undefined;
        const darkE = t.darkRate * duration;
        if (!Number.isFinite(darkE) || darkE < 0) return undefined;
        const total = chargeTotal(photoE, darkE);
        if (!Number.isFinite(total) || total < 0) return undefined;
        const window = nativeWindow!({ x: x + .5, y: y + .5 });
        if (photo.startOffsetSecondsFromOpeningReference !== window.startOffsetSecondsFromOpeningReference ||
          photo.endOffsetSecondsFromOpeningReference !== window.endOffsetSecondsFromOpeningReference ||
          duration !== window.localExposureDurationSeconds) return undefined;
        const marker = Object.freeze({});
        handles.set(marker, { template: t, site, photo, x, y, darkE, total });
        return marker;
      } catch {
        return undefined;
      }
    },
    remember(index, site, photo): void { if (enabled) pending.set(index, { site, photo }); },
    hook: {
      claim(site: unknown): object | undefined {
        return typeof site === "object" && site !== null && handles.has(site) ? site : undefined;
      },
      compute(handle, index, seed, timing): NativeRawLeanOutput {
        const h = handles.get(handle)!, out = leanSensorSite(h.template, h, index, seed);
        if (out) nativeEnvironmentLeanStatistics.sensorSites++;
        if (out) return { rawCode: out.rawCode, blackLevelCode: out.blackLevelCode, digitalSaturationCode: out.digitalSaturationCode, flags: out.flags, whiteCode: out.whiteCode };
        // A compute-phase check failed: the full path computes (and throws) exactly as it would have.
        const parsed = parseNativeRawProducerSite(composeNativeEnvironmentSensorSite(h.site, h.photo), index, producerFrame, timing);
        const r = calculateNativeRawSite(parsed, seed, index).readout.value;
        return { rawCode: r.rawCode, blackLevelCode: r.blackLevelCode, digitalSaturationCode: r.digitalSaturationCode,
          flags: Number(r.physicalScalarSaturationApplied) | Number(r.preAdcSaturationApplied) << 1 | Number(r.digitalSaturationApplied) << 2,
          whiteCode: calculateSiteEffectiveSaturationCode(r, parsed.readoutProfile, parsed.regimeId) };
      },
      observe(index: number, parsed: SensorRawProducerSiteInput, result: ReturnType<typeof calculateNativeRawSite>, whiteCode: number, seed: number): void {
        const entry = pending.get(index);
        pending.delete(index);
        if (!entry || templates.length >= MAXIMUM_TEMPLATES) return;
        try {
          const { x, y, phase } = coordinates(index), { site, photo } = entry;
          if (find(site, photo, x, y, phase) !== undefined) return;
          const readout = resolveSensorReadoutRegime({ profile: parsed.readoutProfile, regimeId: parsed.regimeId });
          const t: SensorTemplate = { site, photo, phase, x, y, verified: false, darkRate: parsed.charge.darkCharge.darkCurrentElectronsPerSecond,
            capacity: result.capacity.value.physicalChargeCapacityElectrons, readout, pattern: parsed.fixedPatternNoise, whiteCode };
          templates.push(t);
          // Self-check: the template matches itself and the lean arithmetic reproduces its full computation bit for bit.
          if (!sensorMatches(site, photo, x, y, t, new WeakMap())) return;
          const darkE = t.darkRate * photo.localExposureDurationSeconds, total = chargeTotal(photo.expectedGeneratedElectronCount, darkE);
          const r = result.readout.value, realization = result.realization.value;
          const out = leanSensorSite(t, { photo, darkE, total, x, y }, index, seed);
          if (!out || !Object.is(darkE, parsed.charge.darkCharge.expectedDarkElectronCount) ||
            !Object.is(total, result.accumulatedCharge.value.totalExpectedStoredElectronCount) ||
            !Object.is(out.photoRealized, realization.photoRealizedElectronCount) || !Object.is(out.darkRealized, realization.darkRealizedElectronCount) ||
            realization.additionalComponents.length !== 0 || out.rawCode !== r.rawCode || out.blackLevelCode !== r.blackLevelCode ||
            out.digitalSaturationCode !== r.digitalSaturationCode || out.flags !== (Number(r.physicalScalarSaturationApplied) |
              Number(r.preAdcSaturationApplied) << 1 | Number(r.digitalSaturationApplied) << 2)) return;
          t.verified = true;
        } catch {
          // An unverified template leaves its sites on the full path.
        }
      }
    }
  };
}
