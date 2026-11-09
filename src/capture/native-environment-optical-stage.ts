// SPDX-License-Identifier: Apache-2.0

/**
 * Keeps (retains) the result of the optical stage of a native environment capture, so the sensor stage
 * can be re-run with new post-optics settings without calling the radiance callbacks again.
 *
 * Optical stage: scene radiance → optics, PSF (point-spread function) and pupil → expected photo signal
 * via EQE (external quantum efficiency). Sensor stage: dark charge → charge realization → readout.
 *
 * Reuse is exact, not approximate: the sensor stage receives a photo signal whose every number is the
 * float64 value the optical stage produced, and the same charge/noise/ADC code runs on it. Reuse is
 * refused unless the capture's optical binding and every site's environment input are strictly equal
 * to those the stage was produced from.
 * @see docs/NATIVE_RAW_AND_PRINT.md for the invariance analysis, memory bound and limits.
 */

import { createNativeRawTask, type NativeRawInput, type NativeRawPlan, type NativeRawTileRequest } from "./native-raw.js";
import type { SimulateEnvironmentSensorRawFrameInput } from "./environment-raw-producer.js";
import type { SensorRawProducerSiteInput } from "./sensor-raw-producer.js";
import { parseSensorEqeTemporalPhotoSignal, type SensorEqeTemporalPhotoSignal } from "../sensor/temporal-photo-signal.js";
import { calculateSensorDarkCurrentCharge } from "../sensor/dark-current.js";
import { requireAllowlistedRecord } from "../core/record-validation.js";
import { stringifyCanonicalJson } from "../core/canonical-json.js";
import { freezeOwnedData } from "../core/owned-data.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { isPlainRecord } from "./native-environment-lean.js";

type EnvironmentSite = SimulateEnvironmentSensorRawFrameInput["sites"][number];
type SiteEnvironment = EnvironmentSite["environment"];

/**
 * Fixed retention limits. The per-site footprint of a retained optical stage is
 * `fixedBytesPerSite + bytesPerTemporalSamplePerSite × temporalSampleCount` bytes of typed-array storage;
 * distinct environment and photo templates (each about one site's input size) are capped separately.
 */
export const NATIVE_ENVIRONMENT_OPTICAL_STAGE_LIMITS = /* @__PURE__ */ Object.freeze({
  /** Two one-byte template indices plus seven float64 values (site x/y, window start/end/duration, photon/electron counts). */
  fixedBytesPerSite: 58,
  /** Three float64 values per temporal midpoint: time, incident-photon rate, generated-electron rate. */
  bytesPerTemporalSamplePerSite: 24,
  /** Distinct per-site environment inputs once the site index and integration ID are removed. */
  maximumEnvironmentTemplates: 256,
  /** Distinct photo-signal identity/evidence records once per-site numbers are removed. */
  maximumPhotoTemplates: 256
});

/** Optional request on NativeEnvironmentRawInput to keep the optical stage. The byte budget covers the typed-array storage described by the limits. */
export interface NativeEnvironmentOpticalStageRetention {
  maximumRetainedBytes: number;
}

/**
 * Opaque, engine-owned optical-stage result. It is valid only for captures whose optical binding and every
 * site's environment input are strictly equal to those that produced it. dispose() zeroes and releases the
 * storage; a disposed stage refuses every later use.
 */
export interface NativeEnvironmentOpticalStage {
  readonly kind: "native-environment-optical-stage";
  readonly pixelCount: number;
  readonly temporalSampleCount: number;
  /** Typed-array bytes held: pixelCount × (fixedBytesPerSite + bytesPerTemporalSamplePerSite × temporalSampleCount). */
  readonly retainedBytes: number;
  /** Radiance callbacks the producing task executed; reuse executes none. */
  readonly providerEvaluationCount: number;
  readonly disposed: boolean;
  dispose(): void;
}

/** Input for a post-optics re-run. `raw` may differ from the original capture only in post-optics fields. */
export interface NativeEnvironmentSensorStageInput {
  raw: NativeRawInput;
  sceneBinding: SimulateEnvironmentSensorRawFrameInput["sceneBinding"];
}
/** Supplies the same physical site inputs as the original capture. Environments must equal the retained ones exactly. */
export interface NativeEnvironmentSensorStageProvider {
  readTile(request: Readonly<NativeRawTileRequest>, signal: AbortSignal): Promise<{ captureId: string; frameId: string; x: number; y: number;
    width: number; height: number; sites: SimulateEnvironmentSensorRawFrameInput["sites"] }>;
  yieldControl(signal: AbortSignal): Promise<void>;
}

const FIXED_VALUES = 7;
const ENVIRONMENT_SHARED_KEYS = ["sceneBindings", "optics", "motion", "psf", "pupil", "fieldThroughput"] as const;

export function canonical(value: unknown): string {
  return stringifyCanonicalJson(value, { undefinedObjectProperties: "omit", nonFiniteNumberMessage: "Invalid native scene binding.",
    unsupportedValueMessage: "Invalid native scene binding." });
}

/**
 * Strict structural equality of plain data: Object.is for primitives (so 0 and -0 differ), identical own
 * key sets, arrays element by element. Anything that is not a plain record or array is unequal unless it is
 * the same reference, so an unexpected value refuses reuse instead of being treated as equal.
 */
function strictlyEqual(a: unknown, b: unknown, verified: WeakMap<object, WeakSet<object>>, skip?: ReadonlySet<string>): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (!skip && verified.get(a)?.has(b)) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!(i in a) || !(i in b) || !strictlyEqual(a[i], b[i], verified)) return false;
    }
  } else {
    if (Array.isArray(b) || !isPlainRecord(a) || !isPlainRecord(b)) return false;
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length || Object.getOwnPropertySymbols(a).length !== 0 || Object.getOwnPropertySymbols(b).length !== 0) return false;
    for (const key of ak) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (skip?.has(key)) continue;
      if (!strictlyEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], verified)) return false;
    }
  }
  if (!skip) {
    let set = verified.get(a);
    if (!set) verified.set(a, set = new WeakSet());
    set.add(b);
  }
  return true;
}

/**
 * Environment equality except the two per-site fields that are bound to the absolute native index and
 * checked separately: temporalIntegrationId and sensor.spatialSampling.site.
 */
function environmentMatches(e: SiteEnvironment, t: SiteEnvironment, verified: WeakMap<object, WeakSet<object>>): boolean {
  if (typeof e !== "object" || e === null || typeof e.sensor !== "object" || e.sensor === null ||
    typeof e.sensor.spatialSampling !== "object" || e.sensor.spatialSampling === null) return false;
  return strictlyEqual(e, t, verified, new Set(["temporalIntegrationId", "sensor"])) &&
    strictlyEqual(e.sensor, t.sensor, verified, new Set(["spatialSampling"])) &&
    strictlyEqual(e.sensor.spatialSampling, t.sensor.spatialSampling, verified, new Set(["site"]));
}

/**
 * Post-optics capture fields: noise seed/realization/model, ISO metadata, white-balance intent, adopted white,
 * capture identity, source artifact metadata and declared models. The optical stage never reads them.
 * Everything else in the normalized plan (scene state/time, geometry including orientation, focal length,
 * aperture, shutter, focus, frame/mode/CFA/binding profiles and the exposure window) is part of the binding.
 */
function opticalBinding(plan: NativeRawPlan, sceneBinding: unknown): unknown {
  const { captureId, noise, source, whiteBalanceIntent, adoptedWhiteXyz, models, exposure, ...capture } = plan.exposure;
  void captureId; void noise; void source; void whiteBalanceIntent; void adoptedWhiteXyz; void models;
  const { iso, ...opticalExposure } = exposure; void iso;
  const { capture: frameCapture, ...frame } = plan.frame; void frameCapture;
  return { capture: { ...capture, exposure: opticalExposure }, frame, exposureWindow: plan.exposureWindow ?? null, sceneBinding };
}

interface OpticalStageState {
  pixelCount: number;
  nativeWidth: number;
  frameId: string;
  stride: number;
  temporalSampleCount: number;
  binding: unknown;
  values: Float64Array;
  environmentIndex: Uint8Array;
  photoIndex: Uint8Array;
  environments: SiteEnvironment[];
  photoTemplates: Record<string, unknown>[];
  providerEvaluationCount: number;
  disposed: boolean;
}
const STAGES = new WeakMap<object, OpticalStageState>();

function release(state: OpticalStageState): void {
  state.values.fill(0); state.environmentIndex.fill(0); state.photoIndex.fill(0);
  state.values = new Float64Array(0); state.environmentIndex = new Uint8Array(0); state.photoIndex = new Uint8Array(0);
  state.environments = []; state.photoTemplates = []; state.disposed = true;
}

function photoTemplate(p: SensorEqeTemporalPhotoSignal): Record<string, unknown> {
  const { temporalIntegrationId, site, startOffsetSecondsFromOpeningReference, endOffsetSecondsFromOpeningReference,
    localExposureDurationSeconds, expectedIncidentPhotonCount, expectedGeneratedElectronCount, temporalSamples, ...rest } = p;
  void temporalIntegrationId; void site; void startOffsetSecondsFromOpeningReference; void endOffsetSecondsFromOpeningReference;
  void localExposureDurationSeconds; void expectedIncidentPhotonCount; void expectedGeneratedElectronCount; void temporalSamples;
  return rest;
}

/** Shared by full acquisition and reuse so the sensor stage receives an identical site record either way. */
export function composeNativeEnvironmentSensorSite(site: Omit<EnvironmentSite, "environment">, photoSignal: SensorEqeTemporalPhotoSignal): SensorRawProducerSiteInput {
  const darkCharge = calculateSensorDarkCurrentCharge({ exposure: photoSignal, darkCurrentProfile: site.darkCurrentProfile,
    operatingTemperatureC: site.operatingTemperatureC }).value;
  return { ...site.readout, charge: { ...site.charge, photoSignal, darkCharge } } as SensorRawProducerSiteInput;
}

/** Validates the optional retention request before any provider work. */
export function parseNativeEnvironmentOpticalStageRetention(value: unknown): NativeEnvironmentOpticalStageRetention {
  const r = requireAllowlistedRecord(value, ["maximumRetainedBytes"], "Invalid optical-stage retention request.");
  if (typeof r.maximumRetainedBytes !== "number" || !Number.isSafeInteger(r.maximumRetainedBytes) || r.maximumRetainedBytes < 1) {
    throw new InvalidConfigurationError("Optical-stage retention requires a positive safe-integer byte budget.");
  }
  return { maximumRetainedBytes: r.maximumRetainedBytes };
}

/** Internal recorder used by createNativeEnvironmentRawTask when retention is requested. */
export interface NativeEnvironmentOpticalStageRecorder {
  /** Interns one planned site before any radiance callback; throws if a limit or the byte budget would be exceeded. */
  admit(index: number, environment: SiteEnvironment, sharedCanonical: string): void;
  record(index: number, photoSignal: SensorEqeTemporalPhotoSignal): void;
  finish(providerEvaluationCount: number): NativeEnvironmentOpticalStage;
  discard(): void;
}

export function createNativeEnvironmentOpticalStageRecorder(plan: NativeRawPlan, sceneBinding: unknown,
  retention: NativeEnvironmentOpticalStageRetention): NativeEnvironmentOpticalStageRecorder {
  const L = NATIVE_ENVIRONMENT_OPTICAL_STAGE_LIMITS;
  const state: OpticalStageState = { pixelCount: plan.pixelCount, nativeWidth: plan.exposure.geometry.nativeRaster.pixelWidth,
    frameId: plan.frame.frameId, stride: 0, temporalSampleCount: 0, binding: freezeOwnedData(structuredClone(opticalBinding(plan, sceneBinding))),
    values: new Float64Array(0), environmentIndex: new Uint8Array(0), photoIndex: new Uint8Array(0), environments: [], photoTemplates: [],
    providerEvaluationCount: 0, disposed: false };
  const environmentKeys = new Map<string, number[]>(), photoKeys = new Map<string, number[]>(), verified = new WeakMap<object, WeakSet<object>>();
  const admitted = new Uint8Array(plan.pixelCount);
  let recorded = 0;
  function residualKey(e: SiteEnvironment, sharedCanonical: string): string {
    const rest: Record<string, unknown> = { ...e, temporalIntegrationId: undefined,
      sensor: { ...e.sensor, spatialSampling: { ...e.sensor.spatialSampling, site: undefined } } };
    for (const key of ENVIRONMENT_SHARED_KEYS) rest[key] = undefined;
    return sharedCanonical+"\u0000"+canonical(rest);
  }
  return {
    admit(index, environment, sharedCanonical): void {
      if (state.disposed) throw new InvalidConfigurationError("Optical-stage retention was released.");
      const n = environment.temporalSampleCount;
      if (state.stride === 0) {
        const bytes = plan.pixelCount*(L.fixedBytesPerSite+L.bytesPerTemporalSamplePerSite*n);
        if (!Number.isSafeInteger(bytes) || bytes > retention.maximumRetainedBytes) throw new InvalidConfigurationError("Optical-stage retention exceeds its byte budget.");
        state.temporalSampleCount = n; state.stride = FIXED_VALUES+3*n;
        state.values = new Float64Array(plan.pixelCount*state.stride);
        state.environmentIndex = new Uint8Array(plan.pixelCount); state.photoIndex = new Uint8Array(plan.pixelCount);
      } else if (n !== state.temporalSampleCount) throw new InvalidConfigurationError("Optical-stage retention requires one temporal sample count per event.");
      const key = residualKey(environment, sharedCanonical), candidates = environmentKeys.get(key) ?? [];
      let found = candidates.find(i => environmentMatches(environment, state.environments[i]!, verified));
      if (found === undefined) {
        if (state.environments.length >= L.maximumEnvironmentTemplates) throw new InvalidConfigurationError("Optical-stage retention exceeds its distinct site-environment limit.");
        found = state.environments.length;
        state.environments.push(environment);
        candidates.push(found); environmentKeys.set(key, candidates);
      }
      state.environmentIndex[index] = found; admitted[index] = 1;
    },
    record(index, p): void {
      if (state.disposed || admitted[index] !== 1) throw new InvalidConfigurationError("Optical-stage retention was released or not admitted.");
      const samples = p.temporalSamples;
      if (samples.length !== state.temporalSampleCount) throw new InvalidConfigurationError("Optical-stage temporal sample count changed.");
      const template = photoTemplate(p), key = canonical(template), candidates = photoKeys.get(key) ?? [];
      let found = candidates.find(i => strictlyEqual(template, state.photoTemplates[i]!, verified));
      if (found === undefined) {
        if (state.photoTemplates.length >= L.maximumPhotoTemplates) throw new InvalidConfigurationError("Optical-stage retention exceeds its distinct photo-identity limit.");
        found = state.photoTemplates.length;
        state.photoTemplates.push(freezeOwnedData(structuredClone(template)));
        candidates.push(found); photoKeys.set(key, candidates);
      }
      state.photoIndex[index] = found;
      const v = state.values, o = index*state.stride;
      v[o] = p.site.x; v[o+1] = p.site.y; v[o+2] = p.startOffsetSecondsFromOpeningReference; v[o+3] = p.endOffsetSecondsFromOpeningReference;
      v[o+4] = p.localExposureDurationSeconds; v[o+5] = p.expectedIncidentPhotonCount; v[o+6] = p.expectedGeneratedElectronCount;
      for (let t = 0; t < samples.length; t++) {
        const s = samples[t]!, q = o+FIXED_VALUES+3*t;
        v[q] = s.timeSecondsFromOpeningReference; v[q+1] = s.incidentPhotonRatePerSecond; v[q+2] = s.expectedGeneratedElectronRatePerSecond;
      }
      admitted[index] = 2; recorded++;
    },
    finish(providerEvaluationCount): NativeEnvironmentOpticalStage {
      if (state.disposed || recorded !== plan.pixelCount) throw new InvalidConfigurationError("Optical-stage retention is incomplete.");
      for (const environment of state.environments) freezeOwnedData(environment);
      state.providerEvaluationCount = providerEvaluationCount;
      const handle: NativeEnvironmentOpticalStage = Object.freeze({ kind: "native-environment-optical-stage" as const,
        pixelCount: state.pixelCount, temporalSampleCount: state.temporalSampleCount,
        retainedBytes: state.pixelCount*(L.fixedBytesPerSite+L.bytesPerTemporalSamplePerSite*state.temporalSampleCount),
        providerEvaluationCount, get disposed(): boolean { return state.disposed; },
        dispose(): void { if (!state.disposed) release(state); } });
      STAGES.set(handle, state);
      return handle;
    },
    discard(): void { if (!state.disposed) release(state); }
  };
}

/**
 * Internal: re-runs only the sensor stage (dark charge, charge realization, capacity, seeded noise and ADC) from a retained
 * optical stage. The capture may change post-optics settings only: noise seed/realization, ISO metadata, readout
 * regime/gain, charge sampling/capacity/completeness, dark-current profile and temperature, white-balance intent,
 * capture identity and tile width. Every optical input must be strictly equal, otherwise this refuses before
 * output: the capture binding is checked here, each site's environment as its tile is read.
 */
export function createSensorStageRawTask<B>(input: NativeEnvironmentSensorStageInput, opticalStage: NativeEnvironmentOpticalStage,
  provider: NativeEnvironmentSensorStageProvider, parseSceneBinding: (value: unknown) => B):
  { task: ReturnType<typeof createNativeRawTask>; sceneBinding: B } {
  const state = typeof opticalStage === "object" && opticalStage !== null ? STAGES.get(opticalStage) : undefined;
  if (!state) throw new InvalidConfigurationError("Optical-stage reuse requires an engine-produced optical stage.");
  if (state.disposed) throw new InvalidConfigurationError("Optical stage was disposed.");
  const r = requireAllowlistedRecord(input, ["raw", "sceneBinding"], "Invalid native sensor-stage input.");
  const sceneBinding = parseSceneBinding(r.sceneBinding);
  if (!provider || typeof provider.readTile !== "function" || typeof provider.yieldControl !== "function") {
    throw new InvalidConfigurationError("Sensor-stage reuse requires physical site input and host yields.");
  }
  const read = provider.readTile.bind(provider), yieldControl = provider.yieldControl.bind(provider);
  const width = state.nativeWidth, frameId = state.frameId;
  const task = createNativeRawTask(input.raw, {
    async readTile(request, signal) {
      const supplied = await read(request, signal);
      if (signal.aborted) throw new InvalidConfigurationError("Native sensor-stage acquisition aborted.");
      if (state.disposed) throw new InvalidConfigurationError("Optical stage was disposed.");
      const tile = requireAllowlistedRecord(supplied, ["captureId", "frameId", "x", "y", "width", "height", "sites"], "Invalid physical source tile.");
      for (const key of Object.keys(request) as (keyof NativeRawTileRequest)[]) if (tile[key] !== request[key]) throw new InvalidConfigurationError("Physical source tile identity mismatch.");
      if (!Array.isArray(tile.sites) || tile.sites.length !== request.width || Array.from({ length: request.width }, (_, i) => i in (tile.sites as unknown[])).includes(false)) {
        throw new InvalidConfigurationError("Physical source tile needs exact native coverage.");
      }
      // The supplied environment is only compared, in one synchronous pass, and never used: execution uses the
      // retained stage. Only the post-optics parts the sensor stage uses are cloned. The equality cache is per
      // tile, so a caller object changed between tiles is compared again.
      const tileVerified = new WeakMap<object, WeakSet<object>>();
      const suppliedSites = tile.sites as unknown[];
      const sites = structuredClone(suppliedSites.map((value, j) => {
        const site = requireAllowlistedRecord(value, ["environment", "darkCurrentProfile", "operatingTemperatureC", "charge", "readout"], "Invalid physical site input.");
        const index = request.y*width+request.x+j, e = site.environment as SiteEnvironment;
        if (typeof e !== "object" || e === null || !environmentMatches(e, state.environments[state.environmentIndex[index]!]!, tileVerified) ||
          e.temporalIntegrationId !== frameId+":native:"+index || typeof e.sensor.spatialSampling.site !== "object" || e.sensor.spatialSampling.site === null ||
          !strictlyEqual(e.sensor.spatialSampling.site, { x: index%width, y: Math.floor(index/width) }, tileVerified)) {
          throw new InvalidConfigurationError("Site environment differs from the retained optical stage; recompute the optical stage.");
        }
        return { temporalIntegrationId: e.temporalIntegrationId, darkCurrentProfile: site.darkCurrentProfile, operatingTemperatureC: site.operatingTemperatureC,
          charge: site.charge, readout: site.readout };
      })) as (Omit<EnvironmentSite, "environment"> & { temporalIntegrationId: string })[];
      const photos = sites.map((site, j) => {
        const index = request.y*width+request.x+j;
        if (site.temporalIntegrationId !== frameId+":native:"+index) {
          throw new InvalidConfigurationError("Site environment differs from the retained optical stage; recompute the optical stage.");
        }
        const v = state.values, o = index*state.stride, template = state.photoTemplates[state.photoIndex[index]!]!;
        const temporalSamples = Array.from({ length: state.temporalSampleCount }, (_, t) => {
          const q = o+FIXED_VALUES+3*t;
          return { timeSecondsFromOpeningReference: v[q]!, incidentPhotonRatePerSecond: v[q+1]!, expectedGeneratedElectronRatePerSecond: v[q+2]! };
        });
        return freezeOwnedData(parseSensorEqeTemporalPhotoSignal({ ...template, temporalIntegrationId: site.temporalIntegrationId, site: { x: v[o]!, y: v[o+1]! },
          startOffsetSecondsFromOpeningReference: v[o+2]!, endOffsetSecondsFromOpeningReference: v[o+3]!, localExposureDurationSeconds: v[o+4]!,
          expectedIncidentPhotonCount: v[o+5]!, expectedGeneratedElectronCount: v[o+6]!, temporalSamples }));
      });
      return { ...request, sites: sites.map((site, j) => composeNativeEnvironmentSensorSite(site, photos[j]!)) };
    },
    // Host yields are time-budgeted and always follow the final tile, so a stage disposed
    // while the host runs is caught here even when no further tile would be read.
    async yieldControl(signal) {
      await yieldControl(signal);
      if (state.disposed) throw new InvalidConfigurationError("Optical stage was disposed.");
    }
  });
  // The task's own accepted plan is the one compared, so nothing is planned twice and no callback has run yet.
  if (!strictlyEqual(opticalBinding(task.plan, sceneBinding), state.binding, new WeakMap())) {
    task.dispose();
    throw new InvalidConfigurationError("Optical stage does not match this capture's optical inputs; recompute the optical stage.");
  }
  return { task, sceneBinding };
}
