// SPDX-License-Identifier: Apache-2.0

/**
 * Internal (#394 step 2, not exported from the package): the native RAW of an engine-built planar scene (a chart preset or a
 * caller material scene, still camera, rectilinear, no distortion, vignetting, pupil rays or caller PSF) from tabulated
 * expected electrons instead of the per-site environment chain.
 *
 * Each site's expected photo electrons come from the display view's tabulated expected signal (`createDisplayViewExpectedSignal`):
 * the same sum over pixel-aperture nodes, anti-aliasing spots, diffraction taps and spectral nodes as the environment chain,
 * formed in another order, so the value differs from the chain's only in the last bits. The sensor stage is the native one:
 * dark charge, both Poisson draws, read noise and the ADC with the site's own seeds (`createVerifiedNativeSiteReadout`). A
 * site whose expected electrons differ in the last bit can therefore, rarely, draw a different integer; the statistics are
 * unchanged.
 *
 * Verification at run time: one site of each CFA phase runs the full chain (planning, the evaluator's callbacks, composition,
 * parsing and `calculateNativeRawSite`): the region's top-left 2 × 2 block or, with `frameChecks` (#733), the frame's top-left block
 * and the block at its centre, so the outcome is the same for the whole frame and every region of it. Its readout template must reproduce that site bit for bit, and its tabulated
 * electrons must agree with the chain's within `TABULATED_RELATIVE_TOLERANCE`; otherwise the caller runs the environment task.
 * #453: the chain's photo signal comes from `executeEngineOwnedEnvironmentPhotoSignal`, the same operations and values as
 * `executeEnvironmentSensorPhotoSignal` for these engine-built records, without re-validating records that cannot have changed.
 */

import type { EnvironmentRadianceEvaluator } from "../sensor/environment-photo-signal.js";
import { executeEngineOwnedEnvironmentPhotoSignal, executeEnvironmentSensorPhotoSignal } from "../sensor/environment-photo-signal.js";
import { isInternalSceneRadianceEvaluator } from "../core/internal-radiance-evaluator.js";
import { calculateCaptureExposureWindows, prepareCaptureExposureWindowSampler } from "../sensor/exposure-window.js";
import { createEnvironmentRawFrameCanonicalMemo, planEnvironmentRawSite, type SimulateEnvironmentSensorRawFrameInput } from "./environment-raw-producer.js";
import { admitNativeEnvironmentInput, type NativeEnvironmentRawInput } from "./native-environment-raw.js";
import { composeNativeEnvironmentSensorSite } from "./native-environment-optical-stage.js";
import { calculateNativeRawSite, parseNativeRawProducerSite } from "./sensor-raw-producer.js";
import { calculateSiteEffectiveSaturationCode, createPhaseWhiteLevelAccumulator } from "./raw-white-level.js";
import { EXPOSURE_BUILD_UP_STAGES } from "./exposure-build-up-stage.js";
import { createVerifiedNativeSiteReadout, type NativeSiteReadout } from "./native-environment-lean.js";
import type { NativeRawOutput } from "./native-raw.js";

/** Largest relative difference between a verification site's tabulated and chain electrons: rounding only (a few ulps of each term). */
export const TABULATED_RELATIVE_TOLERANCE = 1e-9;
/** Rows per expected-signal cache window. */
const BAND_ROWS = 32;
/** Host-yield budget in milliseconds (the native task's cadence); the task also yields after its last row. */
const YIELD_MS = 8;

/** Internal counters (tests assert how many verification sites ran the chain per call; four, one per CFA phase). */
export const tabulatedVerificationStatistics = { chainExecutions: 0 };

/**
 * Internal test hook (never set by the engine): `fullPhoto` also runs each verification site through
 * `executeEnvironmentSensorPhotoSignal` (with the uncounted evaluator) and hands both photo signals to the test;
 * `tabulatedElectrons` replaces the tabulated electrons the gate compares, to show that a wrong fast path is rejected.
 */
export interface TabulatedVerificationTestHook {
  fullPhoto?(engineOwned: unknown, full: unknown): void;
  tabulatedElectrons?(value: number, x: number, y: number): number;
}
let testHook: TabulatedVerificationTestHook | undefined;
export function setTabulatedVerificationTestHook(hook: TabulatedVerificationTestHook | undefined): void { testHook = hook; }

let tabulatedDisabled = false;
/** Disables the tabulated path process-wide (internal; tests of the environment path itself turn it off). */
export function setTabulatedNativeRawEnabled(enabled: boolean): void { tabulatedDisabled = !enabled; }

export interface TabulatedNativeRawInput {
  input: NativeEnvironmentRawInput;
  /** Native rectangle to render (region rendering); absent: the whole raster. */
  region?: { x: number; y: number; width: number; height: number } | undefined;
  /** The engine-built site record of a native index (the facade's `siteInput`). */
  siteInput(index: number): SimulateEnvironmentSensorRawFrameInput["sites"][number];
  /** The evaluator the environment task would use (for the verification sites). */
  evaluateRadiance: EnvironmentRadianceEvaluator;
  /** Expected photo electrons of native sites (`createDisplayViewExpectedSignal`). */
  electrons: { window(x0: number, y0: number, x1: number, y1: number): void; site(x: number, y: number): number; readonly lookups: number };
  /**
   * #632: a per-site change of the expected electrons after the verification (the catalogue lens's veiling glare): the verification
   * compares the chain with `electrons.site`, and every site's readout takes `adjust(electrons.site(x, y), x, y)`.
   */
  adjust?: ((electrons: number, x: number, y: number) => number) | undefined;
  /** Called once per native tile-equivalent (progress), as the environment task reads its tiles. */
  onTile?: () => void;
  tileWidth: number;
  /**
   * #568: the largest relative difference the verification accepts (default `TABULATED_RELATIVE_TOLERANCE`): a fast method that
   * approximates the chain (`lens.catalogue`'s field-grid PSF) passes its own measured bound.
   */
  relativeTolerance?: number;
  /**
   * #733: verify at the whole frame's top-left 2 × 2 block and at the block at its centre (x, y = the even sites nearest below
   * half the raster), not at the region's own block, each block through the evaluator this returns for its top-left site. A fast
   * method whose check depends on where it reads (`lens.catalogue`'s field grid) then takes one outcome for a frame and all its regions.
   */
  frameChecks?: (x: number, y: number) => EnvironmentRadianceEvaluator;
  yieldControl(): Promise<void>;
  checkAbort(): void;
}

export interface TabulatedNativeRawResult {
  raw: NativeRawOutput;
  /** Evaluator callbacks of the verification sites plus the tabulated signal's scene lookups. */
  providerEvaluationCount: number;
  /** Largest relative difference between tabulated and chain electrons over the verification sites. */
  verificationRelativeDifference: number;
}

/**
 * #449: the local exposure duration shared by every site of `region`, or undefined when the sampler must run per site. With
 * simultaneous opening and closing boundaries both boundary phases are 0 at every point (exposure-window.ts, boundaryPhase), so
 * each site's duration is the nominal one the sampler gives at the region's first site. The sampler's only other per-point step
 * is its check that the point lies in the active capture rectangle; the region's first and last site centres bound every other
 * centre, so when both pass every site passes. When either throws, the per-site path runs (and throws where it did).
 */
export function simultaneousExposureDuration(schedule: { opening: unknown; closing: unknown }, sampler: (point: { x: number; y: number }) => { localExposureDurationSeconds: number },
  region: { x: number; y: number; width: number; height: number }): number | undefined {
  if ((schedule.opening as { kind?: unknown }).kind !== "simultaneous" || (schedule.closing as { kind?: unknown }).kind !== "simultaneous") return undefined;
  try {
    const first = sampler({ x: region.x + 0.5, y: region.y + 0.5 }).localExposureDurationSeconds;
    const last = sampler({ x: region.x + region.width - 0.5, y: region.y + region.height - 0.5 }).localExposureDurationSeconds;
    return Object.is(first, last) ? first : undefined;
  } catch {
    return undefined;
  }
}

/** Renders the native RAW from tabulated expected electrons, or returns undefined when verification fails (see the module comment). */
export async function renderTabulatedNativeRaw(t: TabulatedNativeRawInput): Promise<TabulatedNativeRawResult | undefined> {
  if (tabulatedDisabled) return undefined;
  const { plan, sceneBinding } = admitNativeEnvironmentInput(t.input);
  const native = plan.exposure.geometry.nativeRaster, W = native.pixelWidth, layout = plan.frame.colorSamplingProfile.layout;
  if (layout.kind !== "periodic-mosaic" || layout.repeatWidthSites !== 2 || layout.repeatHeightSites !== 2 || !plan.exposureWindow) return undefined;
  const region = t.region ?? { x: 0, y: 0, width: W, height: native.pixelHeight };
  if (region.width < 2 || region.height < 2) return undefined;
  const seed = plan.exposure.noise.seedUint32, b = EXPOSURE_BUILD_UP_STAGES.get(t.input.raw), schedule = plan.exposureWindow, memo = createEnvironmentRawFrameCanonicalMemo(plan.frame, schedule);
  let evaluations = 0, own = t.evaluateRadiance;
  const evaluate: EnvironmentRadianceEvaluator = (request) => { evaluations++; return own(request); };
  // Verification: the region's top-left 2 × 2 block (or the frame's two blocks, #733), one site per CFA phase, through the full chain.
  const readouts: NativeSiteReadout[] = [], f = t.frameChecks;
  let worst = 0;
  for (let k = 0; k < (f ? 8 : 4); k++) {
    const x = (k > 3 ? W >> 2 << 1 : f ? 0 : region.x) + (k & 1), y = (k > 3 ? native.pixelHeight >> 2 << 1 : f ? 0 : region.y) + (k >> 1 & 1), index = y * W + x, site = t.siteInput(index);
    if (f && !(k & 3)) own = f(x, y);
    // The counting wrapper returns the evaluator's own results, so they are engine-built exactly when the evaluator is.
    const engineBuiltResults = isInternalSceneRadianceEvaluator(own);
    const full = planEnvironmentRawSite(site, index, plan.frame, sceneBinding, schedule, "engine-owned", memo, "photo-only");
    // #453: the chain for these engine-built site records (the same operations and values as executeEnvironmentSensorPhotoSignal,
    // without re-validating records that have not changed; see executeEngineOwnedEnvironmentPhotoSignal).
    const photoResult = executeEngineOwnedEnvironmentPhotoSignal(full, evaluate, engineBuiltResults), photo = photoResult.value.photoSignal;
    tabulatedVerificationStatistics.chainExecutions++;
    if (testHook?.fullPhoto) testHook.fullPhoto(photoResult, executeEnvironmentSensorPhotoSignal(full, own, undefined, "photo-only").value.photo);
    const timing = calculateCaptureExposureWindows({ ...schedule, nativeRaster: native, samplePointsNative: [{ x: x + 0.5, y: y + 0.5 }] }).value.samples[0];
    const parsed = parseNativeRawProducerSite(composeNativeEnvironmentSensorSite(site, photo), index, plan.frame, timing);
    const result = calculateNativeRawSite(parsed, seed, index, b);
    const whiteCode = calculateSiteEffectiveSaturationCode(result.readout.value, parsed.readoutProfile, parsed.regimeId);
    const readout = createVerifiedNativeSiteReadout(parsed, result, whiteCode, photo, x, y, index, seed, b);
    if (!readout) return undefined;
    t.electrons.window(x, y, x + 1, y + 1);
    const chain = photo.expectedGeneratedElectronCount, tabulated = testHook?.tabulatedElectrons ? testHook.tabulatedElectrons(t.electrons.site(x, y), x, y) : t.electrons.site(x, y);
    const difference = chain === tabulated ? 0 : Math.abs(tabulated - chain) / Math.max(Math.abs(chain), Number.MIN_VALUE);
    if (!(difference <= (t.relativeTolerance ?? TABULATED_RELATIVE_TOLERANCE))) return undefined;
    worst = Math.max(worst, difference);
    readouts[(y & 1) * 2 + (x & 1)] = readout;
  }
  const length = region.width * region.height;
  const raw: NativeRawOutput = { plan, codes: new Uint16Array(length), blackLevels: new Uint16Array(length), digitalSaturationCodes: new Uint16Array(length),
    saturationFlags: new Uint8Array(length), effectiveSaturationCodes: new Uint16Array(4) };
  const white = createPhaseWhiteLevelAccumulator(W, 2, 2), sampler = prepareCaptureExposureWindowSampler({ ...schedule, nativeRaster: native });
  const tilesPerRow = Math.ceil(region.width / t.tileWidth), point = { x: 0, y: 0 };
  const constantDuration = simultaneousExposureDuration(schedule, sampler, region);
  let last = Date.now();
  for (let y0 = region.y; y0 < region.y + region.height; y0 += BAND_ROWS) {
    const y1 = Math.min(region.y + region.height, y0 + BAND_ROWS);
    t.electrons.window(region.x, y0, region.x + region.width, y1);
    for (let y = y0; y < y1; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        const index = y * W + x, at = (y - region.y) * region.width + x - region.x;
        let duration = constantDuration;
        if (duration === undefined) { point.x = x + 0.5; point.y = y + 0.5; duration = sampler(point).localExposureDurationSeconds; }
        const e = t.electrons.site(x, y), o = readouts[(y & 1) * 2 + (x & 1)]!.compute(t.adjust ? t.adjust(e, x, y) : e, duration, x, y, index, seed);
        // A check of the full path failed for this site: let the environment task decide (it throws its own error).
        if (!o) return undefined;
        raw.codes[at] = o.rawCode; raw.blackLevels[at] = o.blackLevelCode; raw.digitalSaturationCodes[at] = o.digitalSaturationCode; raw.saturationFlags[at] = o.flags;
        // The 2 × 2 phase from x and y (#721); the same check as record(index), without recovering x and y from the index.
        white.recordPhase((y & 1) * 2 + (x & 1), o.whiteCode);
      }
      for (let k = 0; k < tilesPerRow; k++) t.onTile?.();
      if (y === region.y + region.height - 1 || Date.now() - last >= YIELD_MS) { await t.yieldControl(); t.checkAbort(); last = Date.now(); }
    }
  }
  raw.effectiveSaturationCodes.set(t.region ? white.partial() : white.finish());
  return { raw, providerEvaluationCount: evaluations + t.electrons.lookups, verificationRelativeDifference: worst };
}
