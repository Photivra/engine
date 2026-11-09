// SPDX-License-Identifier: Apache-2.0

/**
 * Explicit focus state: a finite focus distance, or infinity.
 *
 * The parser reads the state from untrusted JSON. Missing or unknown focus is rejected; it is never
 * read as infinity.
 *
 * The image-distance function uses the existing Gaussian thin-lens calculation for finite focus, so
 * its numbers and provenance are unchanged. Infinity focus gives exactly the nominal focal length,
 * with a limiting magnification of zero.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requirePositiveFinite } from "../core/validation.js";
import {
  calculateThinLensImageDistance,
  type ThinLensImageDistance
} from "./thin-lens.js";
import { requireInputKeys, requireConfigRecord as requireRecord } from "../core/record-validation.js";

/**
 * Explicit ideal focus-plane state.
 *
 * A finite distance is measured along the camera's optical axis, from the
 * ideal lens principal plane to the object plane. Infinity is a named state.
 * It is never stored as JavaScript Infinity or as a made-up large distance.
 */
export type FocusPlane =
  | {
      kind: "finite";
      distanceM: number;
    }
  | {
      kind: "infinity";
    };

export interface CalculateFocusPlaneImageDistanceInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /** Explicit finite or infinity focus-plane state. */
  focus: FocusPlane;
}

/**
 * Parses an explicit focus-plane state from untrusted JSON.
 *
 * Missing or unknown focus is rejected. It is never read as infinity.
 */
export function parseFocusPlane(value: unknown): FocusPlane {
  const record = requireRecord(value, "focusPlane", ["kind", "distanceM"]);

  if (record.kind === "infinity") {
    if (record.distanceM !== undefined) {
      throw new InvalidConfigurationError(
        "focusPlane infinity state must not include distanceM."
      );
    }
    return {
      kind: "infinity"
    };
  }

  if (record.kind === "finite") {
    if (
      typeof record.distanceM !== "number" ||
      !Number.isFinite(record.distanceM) ||
      record.distanceM <= 0
    ) {
      throw new InvalidConfigurationError(
        "focusPlane.distanceM must be a finite number greater than zero."
      );
    }
    return {
      kind: "finite",
      distanceM: record.distanceM
    };
  }

  throw new InvalidConfigurationError(
    'focusPlane.kind must be "finite" or "infinity".'
  );
}

/**
 * Calculates the ideal image-plane distance for an explicit focus state.
 *
 * Finite focus uses the existing Gaussian thin-lens calculation, so its
 * numbers and provenance are unchanged. Infinity focus gives exactly the
 * nominal focal length, with a limiting magnification of zero.
 */
export function calculateFocusPlaneImageDistance(
  input: CalculateFocusPlaneImageDistanceInput
): CalculationResult<ThinLensImageDistance> {
  requireInputKeys(input, "calculateFocusPlaneImageDistance", ["focalLengthMm", "focus"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);

  const focus = parseFocusPlane(input.focus);

  if (focus.kind === "finite") {
    return calculateThinLensImageDistance({
      focalLengthMm: input.focalLengthMm,
      objectDistanceM: focus.distanceM
    });
  }

  return calculatedResult(
    {
      imageDistanceMm: input.focalLengthMm,
      magnification: 0,
      infinityProjectionScale: 1
    },
    "ideal-infinity-focus-image-distance",
    "1.0.0",
    [
      "Paraxial ideal-lens infinity-focus boundary",
      "Image distance equals nominal focal length at optical infinity",
      "Infinity is represented semantically rather than by a non-finite or fabricated distance"
    ]
  );
}
