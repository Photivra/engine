// SPDX-License-Identifier: Apache-2.0

/**
 * 2.28.0: the shared limits of the temporal-sample calculators (camera rotation and translation quadrature, extended-object
 * projection, stabilized capture samples). Each node is a record of its own, so the count and the product with the points are
 * checked before any node is built. Engine limits: 256 is simulateCapture's own temporal sample limit, and 256 × 256 nodes keep a
 * call's result within a few hundred MB.
 */

import { InvalidScientificInputError, requirePositiveInteger } from "../core/validation.js";

/** The most temporal samples one call takes. */
export const MAXIMUM_TEMPORAL_SAMPLE_COUNT = 256;
/** The most nodes (temporal samples × points) one call builds. */
export const MAXIMUM_TEMPORAL_NODE_COUNT = 256 * 256;

/** Checks `temporalSampleCount` (1 to 256) and its product with the point count (at most 65 536). */
export function requireTemporalSampleBudget(temporalSampleCount: number, pointCount: number, pointsName: string): void {
  requirePositiveInteger("temporalSampleCount", temporalSampleCount);
  if (temporalSampleCount > MAXIMUM_TEMPORAL_SAMPLE_COUNT) {
    throw new InvalidScientificInputError("temporalSampleCount must be at most " + MAXIMUM_TEMPORAL_SAMPLE_COUNT + ".");
  }
  if (temporalSampleCount * pointCount > MAXIMUM_TEMPORAL_NODE_COUNT) {
    throw new InvalidScientificInputError("temporalSampleCount × " + pointsName + ".length must be at most " + MAXIMUM_TEMPORAL_NODE_COUNT + ".");
  }
}
