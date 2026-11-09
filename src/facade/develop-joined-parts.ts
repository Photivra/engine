// SPDX-License-Identifier: Apache-2.0

/**
 * Develop joined parts (#571): the whole-image development steps of a capture whose RAW was rendered in parts.
 * @see docs/QUICK_START.md, "Developing a capture rendered in parts".
 */

import { runCapture, type SimulateCaptureDngPart, type SimulateCaptureOptions, type SimulateCaptureResult } from "./simulate-capture.js";

/**
 * Develops the whole frame of `options` from the packed RAW of region renders of the same request (#571), so a capture can
 * render its RAW in parallel parts and still take the development steps that filter across the whole image:
 * `output.diffractionCorrection` and `output.sharpening`, which a region render refuses. The parts are joined exactly as
 * {@link serializeSimulatedCaptureDngFromParts} joins them (they must cover every native site and agree where they overlap),
 * and the joined RAW is the whole render's RAW, so the result's `image` (samples and JPEG or PNG bytes), `raw` codes and
 * `plan` are those of `simulateCapture(options)`, bit for bit.
 *
 * `options` is the whole request (no `output.region`), with the development options it should have; render the parts with
 * the same request plus `output.region`, without `output.diffractionCorrection`, `output.sharpening` and `output.dng`, and with a
 * fixed white balance in place of `"auto"` (none of these change the RAW codes; auto white balance is measured here over the
 * joined frame). Any `output.format` serves for a part.
 *
 * `onProgress` reports the `white-balance` (with auto white balance), `development`, `diffraction-correction`, `sharpening` and
 * `jpeg` stages, the detail stages once per output row, so a host can show "Applying sharpening to the whole image".
 * No `raw` stage is reported: no RAW is rendered. What differs from the whole render's result: `diagnostics.providerEvaluationCount`
 * is 0, `diagnostics.timingsMs` are this call's, `diagnostics.fast` and the `raw.*` assumptions of how the RAW was rendered are
 * not repeated (they are in the parts' results), and a `parts` assumption records the join.
 * @returns The capture result of `options`, developed from the joined RAW.
 */
export async function simulateCaptureFromParts(options: SimulateCaptureOptions, parts: readonly SimulateCaptureDngPart[]): Promise<SimulateCaptureResult> {
  return await runCapture(options, "develop-from-parts", parts) as SimulateCaptureResult;
}
