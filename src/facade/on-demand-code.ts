// SPDX-License-Identifier: Apache-2.0

/**
 * Internal (#594; `facade-18` in #730): on-demand engine code that fails to load (a missing chunk, a network error) rejects with
 * `ImageKernelExecutionError` reason `quality-code-unavailable`, the error docs/RELEASE_2_22_0.md documents, on every path that
 * loads code on demand; the import is retried at the next call.
 */

import { ImageKernelExecutionError } from "../core/execution-error.js";

/** Imports on-demand code `name` with `importer`, turning a failed load into the documented error. */
export function loadOnDemandCode<T>(name: string, importer: () => Promise<T>): Promise<T> {
  return importer().catch((error: unknown) => {
    throw new ImageKernelExecutionError("quality-code-unavailable", "the engine's " + name + " code could not be loaded: " + (error instanceof Error ? error.message : String(error)));
  });
}
