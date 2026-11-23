// SPDX-License-Identifier: Apache-2.0

/**
 * #739 (2.28.0): `simulateFalseColor`, a stub that loads its body (false-color.ts) with a dynamic import, once per realm, and passes it
 * the facade functions it uses, so the body's chunk imports nothing and a bundle that does not import this function carries none of it.
 * #743 (2.29.0): with `measure.noise` it also loads the noise measure (false-color-noise.ts, a second on-demand chunk that imports
 * nothing either) and passes it the body's function, the same dependencies and the capture functions the noise measure uses.
 */

import { ENGINE_API_VERSION } from "../core/version.js";
import { ImageKernelExecutionError } from "../core/execution-error.js";
import { InvalidScientificResultError } from "../core/validation.js";
import { portableCbrt } from "../core/portable-math.js";
import { encodeSrgbComponentPortable } from "../color/srgb-transfer.js";
import { samplePoisson } from "../sensor/raw-readout.js";
import { createResettableUniformStream, deriveNativeSiteStreamSeedUint32 } from "../sensor/stochastic-seed.js";
import { EXPOSURE_BUILD_UP_STAGES } from "../capture/exposure-build-up-stage.js";
import { allowKeys, fail, FACADE_EVIDENCE, runCapture, SIMULATE_CAPTURE_FACADE_VERSION, type SimulateCaptureOptions } from "./simulate-capture.js";
import { prepareDisplayView, preparedDisplayViewParts } from "./simulate-display-view.js";
import { createAhdDirectionPlane, createDisplayViewExpectedSignal } from "./display-view.js";
import { createHostYield } from "./host-yield.js";
import type { FalseColorDeps, FalseColorResult, SimulateFalseColorOptions } from "./false-color.js";

export type { FalseColorNoise, FalseColorResult, FalseColorStatistics, SimulateFalseColorOptions } from "./false-color.js";

/** Limits of {@link SimulateFalseColorOptions}: at most 8 thresholds, differences in (0, 200]. */
export const SIMULATE_FALSE_COLOR_LIMITS: { readonly maximumThresholds: 8; readonly maximumDifference: 200 } = Object.freeze({ maximumThresholds: 8, maximumDifference: 200 });

let body: Promise<typeof import("./false-color.js")> | null = null;

/**
 * #739: the false color a demosaic produces for a capture request: its color error per output pixel against a full-color sensor
 * reading of the same capture (each site's expected electrons with all three channel responses, through the same optics, filter,
 * pixel aperture and exposure), both noise-free and developed alike, in CIELAB a*b* (see {@link FalseColorResult}). It takes the
 * request `simulateCapture` takes, always at full quality (`fast: false`, on the CPU; `fast: true`, top-level or on an option record
 * such as `lens.diffraction`, is refused), and refuses what changes color after the
 * demosaic or has no expected-signal path (luminance tone curves, highlight reconstruction, `desaturate-to-luminance`,
 * `output.lensCorrections`, `output.sharpening`, `output.diffractionCorrection`, `output.region` (use `measure.region`), JPEG, PNG and
 * DNG output, `whiteBalance: "auto"`, `lens.pupilSampling`, a caller `lens.psf`, `lens.defocus.catsEye`, `sensor.fixedPatternNoise`,
 * layered chart scenes). With `measure.noise` (#743) it also measures the capture's noisy mosaic demosaiced (`noise.withNoise`) and a
 * full-color sensor with noise (`noise.noiseOnly`) against the same reference; the noisy mosaic is the RAW of `simulateCapture` at
 * `fast: false` and the measure's seed. Asynchronous; it yields to the host and honors `options.signal`. Its code loads on demand.
 * @see docs/QUICK_START.md, "False color (2.28)".
 */
export async function simulateFalseColor(options: SimulateCaptureOptions, measure?: SimulateFalseColorOptions): Promise<FalseColorResult> {
  // One handler for both chunks; a failed load is retried on the next call.
  const unavailable = (error: unknown): never => {
    body = null;
    throw new ImageKernelExecutionError("quality-code-unavailable", "the engine's false-color code could not be loaded: " + (error instanceof Error ? error.message : String(error)));
  };
  body ??= import("./false-color.js").catch(unavailable);
  const { measureFalseColor } = await body;
  const deps: FalseColorDeps = {
    prepareDisplayView: (o, p) => prepareDisplayView(o, p),
    parts: (prepared) => preparedDisplayViewParts(prepared, "simulateFalseColor")[0] as unknown as ReturnType<FalseColorDeps["parts"]>,
    createSignal: createDisplayViewExpectedSignal, createAhdDirectionPlane, allowKeys, fail,
    failResult: (message) => { throw new InvalidScientificResultError(message); },
    cbrt: portableCbrt, encodeSrgb: encodeSrgbComponentPortable, yieldControl: createHostYield().yieldControl,
    now: () => globalThis.performance?.now() ?? Date.now(),
    versions: { facade: SIMULATE_CAPTURE_FACADE_VERSION, engine: ENGINE_API_VERSION }, evidence: FACADE_EVIDENCE
  };
  return await (measure?.noise ? (await import("./false-color-noise.js").catch(unavailable)).measureFalseColorNoise(options, measure, deps, measureFalseColor,
    runCapture, EXPOSURE_BUILD_UP_STAGES, samplePoisson, createResettableUniformStream, deriveNativeSiteStreamSeedUint32) : measureFalseColor(options, measure, deps));
}
