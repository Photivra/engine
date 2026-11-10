// SPDX-License-Identifier: Apache-2.0

/**
 * Exposure build-up (#534): fractions of one exposure, read out as it accumulates.
 * @see docs/QUICK_START.md, "Exposure build-up".
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { EXPOSURE_BUILD_UP_STAGES, type ExposureBuildUpStage } from "../capture/exposure-build-up-stage.js";
import { sampleBinomial } from "../sensor/binomial-sample.js";
import { createResettableUniformStream, deriveNativeSiteStreamSeedUint32, NATIVE_SITE_READ_NOISE_STREAM_ID } from "../sensor/stochastic-seed.js";
import { runCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "./simulate-capture.js";

/** The most fractions one build-up takes. */
export const EXPOSURE_BUILD_UP_MAXIMUM_FRACTIONS = 64;
/**
 * The first stream ID of the build-up's per-site random streams (`deriveNativeSiteStreamSeedUint32`): fraction j's photo split,
 * dark split and readout use streams base + 3j, + 3j + 1 and + 3j + 2 (j = 0 … 63). The whole exposure keeps the ordinary
 * streams 0 (charge) and 1 (read noise).
 */
export const EXPOSURE_BUILD_UP_STREAM_BASE = 0x42550000;

/** The build-up to render with {@link simulateExposureBuildUp}. */
export interface SimulateExposureBuildUpOptions {
  /**
   * Fractions of `exposure.shutterSeconds` to read out, strictly increasing, each above 0 and at most 1 (1 to 64 of them), for
   * example `[0.2, 0.4, 0.6, 0.8, 1]`. A fraction of 1 is the whole exposure: `simulateCapture` of the request.
   */
  fractions: readonly number[];
}

/** One readout of a build-up. */
export interface SimulateExposureBuildUpFrame {
  /** The fraction of the exposure collected. */
  fraction: number;
  /** fraction × the request's shutter time, in s. */
  elapsedSeconds: number;
  /**
   * The fraction developed as its own photo. At fraction 1 it is `simulateCapture(options)` itself, byte for byte. Below 1 it is
   * the result of the fraction's capture (manual, the whole exposure's f-number and ISO, shutter fraction·t: its `image`, `raw`,
   * `plan` and `request`), with the build-up's counts, the `exposure.buildUp` assumption, and the whole exposure's `exposure` and
   * `sensor` reports (the camera's settings and noise figure, not the elapsed part's).
   */
  result: SimulateCaptureResult;
}

/** The readouts of {@link simulateExposureBuildUp}, in the order of `fractions`. */
export interface SimulateExposureBuildUpResult {
  /** The whole exposure's shutter time, in s. */
  shutterSeconds: number;
  frames: readonly SimulateExposureBuildUpFrame[];
}

function fail(message: string): never { throw new InvalidConfigurationError(message); }

/** One render's per-site record: its expected photo and dark means and the counts its readout used. */
interface SiteRecord { photoMean: Float64Array; darkMean: Float64Array; photo: Float64Array; dark: Float64Array; written: Uint8Array; count: number }
function siteRecord(): SiteRecord {
  return { photoMean: new Float64Array(0), darkMean: new Float64Array(0), photo: new Float64Array(0), dark: new Float64Array(0), written: new Uint8Array(0), count: 0 };
}
/** Records site `index` (growing the arrays as needed; a site computed twice writes the same values again). */
function record(r: SiteRecord, index: number, photoMean: number, darkMean: number, photo: number, dark: number): void {
  if (index >= r.written.length) {
    const size = Math.max(1024, 2 * r.written.length, index + 1);
    const grow = (a: Float64Array): Float64Array => { const b = new Float64Array(size); b.set(a); return b; };
    r.photoMean = grow(r.photoMean); r.darkMean = grow(r.darkMean); r.photo = grow(r.photo); r.dark = grow(r.dark);
    const w = new Uint8Array(size); w.set(r.written); r.written = w;
  }
  if (!r.written[index]) { r.written[index] = 1; r.count++; }
  r.photoMean[index] = photoMean; r.darkMean[index] = darkMean; r.photo[index] = photo; r.dark[index] = dark;
}

/**
 * Renders fractions of one exposure as one accumulating process (#534), the way a camera's live readout of a long exposure
 * would show the light building up. Each fraction is read out and developed as its own photo.
 *
 * The model: photon and dark-charge arrivals at a site are Poisson processes (photon shot noise: EMVA 1288 Release 4.0,
 * section 2, free), with any rate over time. Given the count n over [0, t] of a Poisson process with mean Λ(t), its arrival
 * times are n independent times with distribution Λ(s)/Λ(t) on [0, t], so its count over [0, s] is Binomial(n, Λ(s)/Λ(t))
 * (R. G. Gallager, Discrete Stochastic Processes, chapter 2, sections 2.4 and 2.5, MIT OpenCourseWare 6.262, free).
 *
 * The method: the whole exposure is `simulateCapture(options)` itself, with its ordinary draws and seeds. Each earlier fraction
 * fⱼ is a capture of the same request in manual mode at the whole exposure's resolved f-number and ISO and the shutter fⱼ·t,
 * so its expected signal at every site is integrated from the spectrum over the window [0, fⱼ·t] by the capture itself (the
 * camera rotation, `motion.subject` and mixed lighting included, and each row's own window with a rolling shutter). Its
 * counts are not drawn anew: going down the fractions, each site's photo and dark counts are N(fⱼ) ~ Binomial(N(fⱼ₊₁), λ(fⱼ) /
 * λ(fⱼ₊₁)), with λ the site's expected mean in each render (after PRNU and DSNU). So every fraction's counts are Poisson with
 * that fraction's own mean (the mean and variance of `simulateCapture` at fⱼ·t), they never decrease from one fraction to the
 * next, and two fractions' counts covary by the earlier one's mean. Fixed-pattern noise is the sensor's own and the same in
 * every fraction. Each fraction's charge is clipped at the full well, then read once: its own read noise (dual gain as the ISO
 * selects), pre-ADC and ADC saturation and quantization at the ADC bit depth.
 *
 * The windows are nested, so the true means never decrease; the capture's temporal midpoint quadrature can still put an
 * earlier fraction's estimate above a later one's at a site (motion blur). There the split takes probability 1 (the count is
 * kept), and the `exposure.buildUp` assumption counts those sites (`nonMonotoneSites`): an approximation of the quadrature,
 * not of the binomial law. Raise `sensor.temporalSampleCount` to remove them.
 *
 * Cost: one capture per fraction, plus about 64 bytes per native site for the chain. Exact or fast: the request's own `fast`
 * (and the format default) applies to every fraction; the build-up adds no fast method, so with `fast: false` (the calculator's
 * setting) every fraction is an exact capture. On screen only: formats "srgb-8" and "srgb-16" (a fraction's JPEG, PNG or DNG
 * is refused). A fraction's realization depends on the whole `fractions` list (each step of the chain has its own streams);
 * the same request and list always give the same frames.
 * @returns One frame per fraction, in order.
 */
export async function simulateExposureBuildUp(options: SimulateCaptureOptions, buildUp: SimulateExposureBuildUpOptions): Promise<SimulateExposureBuildUpResult> {
  if (typeof buildUp !== "object" || buildUp === null || !Array.isArray(buildUp.fractions)) fail("simulateExposureBuildUp needs { fractions: number[] }.");
  for (const key of Object.keys(buildUp)) if (key !== "fractions") fail("Unknown simulateExposureBuildUp option: " + key + ".");
  const fractions = buildUp.fractions;
  if (fractions.length < 1 || fractions.length > EXPOSURE_BUILD_UP_MAXIMUM_FRACTIONS) fail("fractions takes 1 to " + EXPOSURE_BUILD_UP_MAXIMUM_FRACTIONS + " values.");
  fractions.forEach((f, j) => {
    if (typeof f !== "number" || !(f > 0 && f <= 1)) fail("Each fraction must be above 0 and at most 1.");
    if (j > 0 && !(f > fractions[j - 1]!)) fail("fractions must increase strictly.");
  });
  if (typeof options !== "object" || options === null) fail("simulateExposureBuildUp needs the capture options.");
  const format = (options.output as { format?: unknown } | undefined)?.format ?? "srgb-8";
  if (format !== "srgb-8" && format !== "srgb-16") fail("simulateExposureBuildUp renders on screen: output.format \"srgb-8\" or \"srgb-16\" (a fraction's JPEG, PNG or DNG would carry the whole exposure's metadata).");
  const seed = (options.sensor as { noiseSeed?: unknown } | undefined)?.noiseSeed ?? 1;
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) fail("sensor.noiseSeed must be an integer 0-4294967295.");

  // The whole exposure, recorded: its own draws pass through unchanged, so it is simulateCapture(options) byte for byte.
  let above = siteRecord();
  const attach = (stage: ExposureBuildUpStage) => (raw: object): void => { EXPOSURE_BUILD_UP_STAGES.set(raw, stage); };
  const recorder: ExposureBuildUpStage = { photo: 0, dark: 0, read: NATIVE_SITE_READ_NOISE_STREAM_ID,
    split(index, photoMean, darkMean, photo, dark) { recorder.photo = photo; recorder.dark = dark; record(above, index, photoMean, darkMean, photo, dark); } };
  const whole = await runCapture(options, "capture", attach(recorder)) as SimulateCaptureResult;
  const sites = whole.raw.codes.length;
  if (above.count !== sites) fail("simulateExposureBuildUp: the capture's sensor stage did not report every site (an unsupported render path).");
  const { fNumber, shutterSeconds, iso } = whole.exposure.settings;
  const results = new Map<number, SimulateCaptureResult>([[1, whole]]);

  // Down the fractions: each render's own means, its counts split from the next fraction's.
  const stream = createResettableUniformStream(), below = [...fractions].filter((f) => f < 1).reverse();
  for (const fraction of below) {
    const j = fractions.indexOf(fraction), current = siteRecord(), from = above;
    let nonMonotone = 0, kept = false;
    const split = (index: number, mean: number, upperMean: number, upper: number, which: 0 | 1): number => {
      if (upper === 0 || mean === 0) return 0;
      if (!(mean <= upperMean)) { kept = true; return upper; }
      stream.reset(deriveNativeSiteStreamSeedUint32(seed, index, EXPOSURE_BUILD_UP_STREAM_BASE + 3 * j + which));
      return sampleBinomial(upper, mean / upperMean, stream);
    };
    const stage: ExposureBuildUpStage = { photo: 0, dark: 0, read: EXPOSURE_BUILD_UP_STREAM_BASE + 3 * j + 2,
      split(index, photoMean, darkMean) {
        if (!from.written[index]) fail("simulateExposureBuildUp: a fraction rendered a site the whole exposure did not.");
        kept = false;
        stage.photo = split(index, photoMean, from.photoMean[index]!, from.photo[index]!, 0);
        stage.dark = split(index, darkMean, from.darkMean[index]!, from.dark[index]!, 1);
        if (kept && !current.written[index]) nonMonotone++;
        record(current, index, photoMean, darkMean, stage.photo, stage.dark);
      } };
    const lens = (options.lens ?? {}) as Record<string, unknown>, exposure = (options.exposure ?? {}) as Record<string, unknown>;
    const fractionOptions: SimulateCaptureOptions = { ...options, lens: { ...lens, fNumber } as NonNullable<SimulateCaptureOptions["lens"]>,
      exposure: { mode: "manual", shutterSeconds: fraction * shutterSeconds, iso, ...(exposure.metering === undefined ? {} : { metering: exposure.metering as never }) } };
    // A site computed twice in one render (a verification site, or the second pass of auto white balance) is split again with the
    // same streams: the counts are the same.
    let result: SimulateCaptureResult;
    try {
      result = await runCapture(fractionOptions, "capture", attach(stage)) as SimulateCaptureResult;
    } catch (error) {
      if (error instanceof Error && !(options.signal?.aborted)) fail("Fraction " + fraction + " (manual, " + fraction * shutterSeconds + " s): " + error.message);
      throw error;
    }
    if (current.count !== sites) fail("simulateExposureBuildUp: the fraction's sensor stage did not report every site (an unsupported render path).");
    results.set(fraction, { ...result, exposure: whole.exposure, sensor: whole.sensor, assumptions: Object.freeze([...result.assumptions, Object.freeze({
      id: "exposure.buildUp", kind: "model" as const, value: { fraction, fractions: [...fractions], elapsedSeconds: fraction * shutterSeconds, shutterSeconds, nonMonotoneSites: nonMonotone },
      explanation: "Exposure build-up (#534): this fraction's expected signal is a capture at the elapsed time (manual, the whole exposure's f-number and ISO); its photo and dark counts are " +
        "split from the next fraction's by binomial draws with p = λ(this) / λ(next) per site (the conditional law of a Poisson process), then clipped at the full well and read out " +
        "once with this fraction's own read noise. exposure and sensor describe the whole exposure. nonMonotoneSites counts sites where the quadrature put this fraction's mean " +
        "above the next one's (kept with probability 1; an approximation of the temporal quadrature)." })]) });
    above = current;
  }
  return { shutterSeconds, frames: Object.freeze(fractions.map((fraction) => ({ fraction, elapsedSeconds: fraction * shutterSeconds, result: results.get(fraction)! }))) };
}
