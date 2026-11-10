// SPDX-License-Identifier: Apache-2.0

/**
 * Exposure build-up (#534): fractions of one exposure, read out as it accumulates.
 * @see docs/QUICK_START.md, "Exposure build-up".
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { EXPOSURE_BUILD_UP_STAGES } from "../capture/exposure-build-up-stage.js";
import { sampleBinomial } from "../sensor/binomial-sample.js";
import { createResettableUniformStream, deriveNativeSiteStreamSeedUint32 } from "../sensor/stochastic-seed.js";
import { runCapture, simulateCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "./simulate-capture.js";

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
   * The fraction developed as its own photo. At fraction 1 it is `simulateCapture(options)` itself, byte for byte. Below 1 its
   * `image` and `raw` codes are the fraction's readout and development, and the `exposure.buildUp` assumption records the fraction;
   * every report of the request (`exposure`, with the shutter time and how it was chosen, `sensor`, with the mid-gray noise figure,
   * `plan`, `request`) describes the whole exposure, the camera's settings, not the elapsed part.
   */
  result: SimulateCaptureResult;
}

/** The readouts of {@link simulateExposureBuildUp}, in the order of `fractions`. */
export interface SimulateExposureBuildUpResult {
  /** The whole exposure's shutter time, in s. */
  shutterSeconds: number;
  frames: readonly SimulateExposureBuildUpFrame[];
}

let nextBuildUp = 0;

function fail(message: string): never { throw new InvalidConfigurationError(message); }

/**
 * Renders fractions of one exposure as one accumulating process (#534), the way a camera's live readout of a long exposure
 * would show the light building up. Each fraction is read out and developed as its own photo.
 *
 * The model: photon and dark-charge arrivals are Poisson processes (photon shot noise: EMVA 1288 Release 4.0, section 2, free).
 * Given a Poisson process's count n at t, its arrival times are n independent uniform times on [0, t], so its count at s < t is
 * Binomial(n, s/t) (R. G. Gallager, Discrete Stochastic Processes, chapter 2, section 2.5, MIT OpenCourseWare 6.262, free). The whole exposure's photo and dark counts at each site are its ordinary draws, with its ordinary seeds. Going down the
 * fractions f₁ < … < fₘ, each count is split by a binomial draw: N(fⱼ) ~ Binomial(N(fⱼ₊₁), fⱼ / fⱼ₊₁). So each fraction's counts are Poisson with mean fⱼ times the whole
 * exposure's (the mean and variance of a single exposure of fⱼ·t), they never decrease from one fraction to the next, and the
 * covariance of two fractions' counts is the earlier one's mean: the later count is the earlier one plus an independent
 * increment. Fixed-pattern noise (PRNU, DSNU, hot pixels, offsets) is the sensor's own and the same in every fraction. Each
 * fraction's charge is clipped at the full well (`sensor.fullWell`), then read once: its own read noise (the regime's
 * components, dual gain as the ISO selects), pre-ADC and ADC saturation and quantization at the ADC bit depth. The fraction at
 * 1 is `simulateCapture(options)`, byte for byte.
 *
 * Every fraction renders the whole request again (the same exposure resolution, metering, ISO, lens, framing, `fast` and white
 * balance; `"auto"` white balance is measured on each fraction, as its own photo), so it costs one capture per fraction. The
 * whole exposure's expected signal is scaled by the fraction, which equals a capture of fⱼ·t only for a signal constant over
 * the exposure: a still camera (no `motion.angularVelocityRadPerSec`) and the facade's static scenes. Exact or fast: the
 * request's own `fast` (and the format default) applies to every fraction; this function adds no fast method, so with
 * `fast: false` (the calculator's setting) every fraction is the exact capture's.
 *
 * Formats: "srgb-8" and "srgb-16" (sample arrays to show). A fraction's JPEG, PNG or DNG would carry the whole exposure's
 * metadata, so those formats are refused. A fraction's realization depends on the whole `fractions` list (each step of the
 * chain has its own streams); the same request and list always give the same frames.
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
  if (format !== "srgb-8" && format !== "srgb-16") fail("simulateExposureBuildUp renders output.format \"srgb-8\" or \"srgb-16\": a fraction's JPEG, PNG or DNG would carry the whole exposure's metadata.");
  const rotation = (options.motion as { angularVelocityRadPerSec?: Record<string, unknown> } | undefined)?.angularVelocityRadPerSec;
  if (rotation && Object.values(rotation).some((v) => v !== undefined && v !== 0))
    fail("simulateExposureBuildUp needs a signal constant over the exposure: a rotating camera (motion.angularVelocityRadPerSec) is not supported.");
  const seed = (options.sensor as { noiseSeed?: unknown } | undefined)?.noiseSeed ?? 1;
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) fail("sensor.noiseSeed must be an integer 0-4294967295.");

  // The chain's points: the fractions, then the whole exposure when it is not listed.
  const points = fractions[fractions.length - 1] === 1 ? [...fractions] : [...fractions, 1];
  const top = points.length - 1, stream = createResettableUniformStream();
  const frames: SimulateExposureBuildUpFrame[] = [];
  let shutterSeconds = NaN;
  const id = nextBuildUp++;
  for (let i = 0; i < fractions.length; i++) {
    const fraction = fractions[i]!;
    if (fraction === 1) {
      const result = await simulateCapture(options);
      shutterSeconds = result.exposure.settings.shutterSeconds;
      frames.push({ fraction, elapsedSeconds: shutterSeconds, result });
      continue;
    }
    const realizationId = "exposure-build-up-" + id + "-" + i;
    EXPOSURE_BUILD_UP_STAGES.set(realizationId, {
      read: EXPOSURE_BUILD_UP_STREAM_BASE + 3 * i + 2,
      thin(count, index, which) {
        let n = count;
        for (let j = top - 1; j >= i && n > 0; j--) {
          stream.reset(deriveNativeSiteStreamSeedUint32(seed, index, EXPOSURE_BUILD_UP_STREAM_BASE + 3 * j + which));
          n = sampleBinomial(n, points[j]! / points[j + 1]!, stream);
        }
        return n;
      }
    });
    let whole: SimulateCaptureResult;
    try {
      whole = await runCapture(options, "capture", realizationId) as SimulateCaptureResult;
    } finally {
      EXPOSURE_BUILD_UP_STAGES.delete(realizationId);
    }
    shutterSeconds = whole.exposure.settings.shutterSeconds;
    const elapsedSeconds = fraction * shutterSeconds;
    const result: SimulateCaptureResult = { ...whole, assumptions: Object.freeze([...whole.assumptions, Object.freeze({ id: "exposure.buildUp", kind: "model" as const,
        value: { fraction, fractions: [...fractions], elapsedSeconds, shutterSeconds },
        explanation: "Exposure build-up (#534): the whole exposure's photo and dark counts at each site, split down the fractions by binomial draws " +
          "(the conditional law of a Poisson process), clipped at the full well and read out once with this fraction's own read noise; exact for a signal constant over the exposure." })]) };
    frames.push({ fraction, elapsedSeconds, result });
  }
  return { shutterSeconds, frames: Object.freeze(frames) };
}
