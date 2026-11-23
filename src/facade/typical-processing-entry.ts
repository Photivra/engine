// SPDX-License-Identifier: Apache-2.0

/**
 * #740 (2.29.0): `simulateTypicalProcessing`, a stub that loads its body (typical-processing.ts) with a dynamic import, once per realm,
 * so a bundle that does not import this function carries none of it and one that does loads the stages only when they are first asked for.
 */

import { ImageKernelExecutionError } from "../core/execution-error.js";
import { createHostYield } from "./host-yield.js";
import type { ProcessingProvider } from "../processing/processing-task.js";
import type { SimulateTypicalProcessingInput, TypicalProcessingResult } from "./typical-processing.js";

export type { SimulateTypicalProcessingInput, TypicalProcessingDevelopOptions, TypicalProcessingResult, TypicalProcessingStage } from "./typical-processing.js";

let body: Promise<typeof import("./typical-processing.js")> | null = null;

/**
 * #740: phone-style processing of a burst of DNG frames, as a simulation of typical stages (not of a specific device): the mean of the
 * frames before the demosaic, `developDngImage`'s development to linear sRGB, bilateral noise reduction, Durand–Dorsey local tone
 * mapping and a saturation gain in linear light, then `developDngImage`'s tone curve and sRGB encoding. Each stage is on with its
 * defaults unless set to `false`; with one frame and every stage `false` the result equals `developDngImage`'s bit for bit (the
 * plain side of a side-by-side). A simulated capture enters as its DNG (`output.format: "dng"`, one capture per `sensor.noiseSeed`
 * for a burst). `fast` follows the format default (fast for "srgb-8" and "srgb-16"); `fast: false` or `localToneMapping.fast: false`
 * runs the direct bilateral base, refused above 2 · 10¹¹ tap evaluations. Asynchronous; `provider` (default: the host yield) is the
 * processing tasks' `{ yieldControl, onProgress? }`. Its code loads on demand.
 * @see docs/PROCESSING.md, "Typical processing stages".
 */
export async function simulateTypicalProcessing(input: SimulateTypicalProcessingInput, provider?: ProcessingProvider): Promise<TypicalProcessingResult> {
  body ??= import("./typical-processing.js").catch((error: unknown) => {
    body = null;
    throw new ImageKernelExecutionError("quality-code-unavailable", "the engine's typical-processing code could not be loaded: " + (error instanceof Error ? error.message : String(error)));
  });
  const { runTypicalProcessing } = await body;
  const host = provider ?? { yieldControl: createHostYield().yieldControl };
  return await runTypicalProcessing(input, host);
}
