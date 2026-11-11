// SPDX-License-Identifier: Apache-2.0

/**
 * 2.22.0 (#594): loads the CPU on-demand code, once per realm: the Quality kit (src/facade/quality-kit.ts) and the opt-in kit
 * (src/facade/opt-in-kit.ts). A request loads a kit where it is parsed, before it uses any of its code, and then calls it
 * synchronously, so results are those of a static import. Concurrent loads share one import; a failed load is not remembered,
 * so the next request (or `prepareQualityPaths()`) tries again. A failed load rejects with `ImageKernelExecutionError` reason
 * `quality-code-unavailable`, as the GPU Quality code's does; the CPU has no other path, so the request fails with it.
 */

import { ImageKernelExecutionError } from "../core/execution-error.js";

export type QualityKit = typeof import("./quality-kit.js");
export type OptInKit = typeof import("./opt-in-kit.js");

/** One kit's loader: `load()` imports it once (single flight, retried after a failure); `loaded` is the module once imported. */
interface KitLoader<T> { loaded: T | undefined; load(): Promise<T> }
function kitLoader<T>(name: string, importer: () => Promise<T>): KitLoader<T> {
  let pending: Promise<T> | null = null;
  const kit: KitLoader<T> = {
    loaded: undefined,
    load(): Promise<T> {
      if (kit.loaded) return Promise.resolve(kit.loaded);
      pending ??= importer().then((module) => (kit.loaded = module), (error: unknown) => {
        pending = null;
        throw new ImageKernelExecutionError("quality-code-unavailable", "the engine's " + name + " code could not be loaded: " + (error instanceof Error ? error.message : String(error)));
      });
      return pending;
    }
  };
  return kit;
}

/** The CPU full-quality code (#594). */
export const qualityKit: KitLoader<QualityKit> = kitLoader("full-quality", () => import("./quality-kit.js"));
/** The opt-in features' code (#594). */
export const optInKit: KitLoader<OptInKit> = kitLoader("opt-in feature", () => import("./opt-in-kit.js"));

/** A kit the request loaded where it was parsed (an engine error if a code path uses it without loading it first). */
export function loadedKit<T>(kit: KitLoader<T>): T {
  if (!kit.loaded) throw new ImageKernelExecutionError("quality-code-unavailable", "on-demand code was used before it was loaded (an engine defect; #594).");
  return kit.loaded;
}
