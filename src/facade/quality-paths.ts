// SPDX-License-Identifier: Apache-2.0

/**
 * 2.22.0 (#594): the optional preload of the engine's on-demand full-quality code. The Quality paths load automatically at the
 * first request that needs them; this loads them ahead of time, so that request does not wait for the download.
 */

import { ImageKernelExecutionError } from "../gpu/image-kernel-execution.js";
import { optInKit, qualityKit } from "./on-demand-kits.js";

let pending: Promise<void> | null = null;

/**
 * Loads the engine's on-demand full-quality code now instead of at the first request that needs it (#594): the CPU Quality kit
 * (diffraction, the capture's AHD demosaic, `lens.defocus` beyond the geometric disc, the image-space provider of lens projection,
 * distortion and vignetting, the display view's coupled tone, reconstruct and desaturation steps, the neighbor highlight
 * reconstruction), the opt-in kit (`sensor.profile`, `illumination`, `motion.subject`) and the display view's GPU full-quality code
 * (the Quality passes behind `prepareDisplayView(…, { gpu: "auto" | "require" })`), together with the GPU session it builds on.
 *
 * Optional: without it, the first request that needs the code loads it. Safe to call at any time and from any number of places:
 * concurrent calls share one load, and a call after it loaded resolves at once and loads nothing. It changes no result. If the
 * load fails (for example a chunk download error) the promise rejects with `ImageKernelExecutionError` reason
 * `quality-code-unavailable`; nothing is remembered, so a later call or request tries again, and a render in the meantime runs
 * the CPU reference, labelled with that reason. A bundler that splits dynamic imports keeps this code out of the first load
 * whether or not this function is imported.
 *
 * @example
 * ```ts
 * import { prepareQualityPaths } from "@photivra/engine";
 * // The user opened Export, where full-quality renders follow: fetch their code while they choose a format.
 * void prepareQualityPaths().catch(() => undefined); // a failed preload is retried by the render that needs the code
 * ```
 */
export function prepareQualityPaths(): Promise<void> {
  if (!pending) {
    const load: Promise<void> = Promise.all([qualityKit.load(), optInKit.load(),
      import("../gpu/display-view-gpu-renderer.js").then((renderer) => renderer.prepareDisplayViewQualityGpu())]).then(() => undefined, (error: unknown) => {
      if (error instanceof ImageKernelExecutionError) throw error;
      throw new ImageKernelExecutionError("quality-code-unavailable", "the engine's full-quality code could not be loaded: " + (error instanceof Error ? error.message : String(error)));
    });
    pending = load;
    load.catch(() => { if (pending === load) pending = null; });
  }
  return pending;
}
