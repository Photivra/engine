// SPDX-License-Identifier: Apache-2.0

/**
 * Angular field of view (FOV) for a rectilinear lens.
 *
 * The symmetric FOV is 2 * atan(sensorDimension / (2 * projectionDistance)).
 * - Without focusDistanceM, projectionDistance is the nominal focal length. This keeps the older
 *   infinity-focus (pinhole) behaviour.
 * - With focusDistanceM, projectionDistance is the ideal Gaussian thin-lens image distance for that
 *   focus plane.
 * Neither mode models real-lens focus breathing or distortion.
 *
 * The module also gives an asymmetric FOV span from signed sensor-plane bounds measured from the
 * optical axis. Off-centre sensor crops need this, because the optical axis is not at the centre of
 * the kept rectangle.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite
} from "../core/validation.js";
import { calculateThinLensImageDistance } from "../optics/thin-lens.js";
import { requireInputKeys } from "../core/record-validation.js";
import {
  calculateLensProjectionFieldOfView,
  calculateLensProjectionFieldOfViewBounds,
  parseLensProjectionModel,
  type LensProjectionModel
} from "./lens-projection.js";

export interface CalculateFieldOfViewInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /** Sensor dimension corresponding to the requested field of view, in millimetres. */
  sensorDimensionMm: number;
  /**
   * Optional focus distance in metres. When supplied, the ideal thin-lens
   * image distance is used as the projection distance. Omit to preserve the
   * infinity-focus/pinhole approximation.
   */
  focusDistanceM?: number;
  /**
   * Ideal projection model. Omit it or pass `"rectilinear"` to keep the rectilinear behaviour and
   * model ids. Other models use the focal length as the mapping scale and do not accept
   * focusDistanceM.
   */
  projectionModel?: LensProjectionModel;
}

export interface CalculateFieldOfViewBoundsInput {
  /** Lens focal length in millimetres. */
  focalLengthMm: number;
  /**
   * Minimum sensor-plane coordinate in millimetres relative to the optical
   * axis. Negative values lie on the negative side of the requested axis.
   */
  minimumSensorCoordinateMm: number;
  /**
   * Maximum sensor-plane coordinate in millimetres relative to the optical
   * axis.
   */
  maximumSensorCoordinateMm: number;
  /** Optional focus distance in metres. */
  focusDistanceM?: number;
  /** Ideal projection model; omitted or `"rectilinear"` keeps the existing behaviour. */
  projectionModel?: LensProjectionModel;
}

export interface FieldOfView {
  /** Angular field of view in degrees. */
  degrees: number;
  /** Angular field of view in radians. */
  radians: number;
  /** Projection/image-plane distance used by the geometry, in millimetres. */
  projectionDistanceMm: number;
}

export interface FieldOfViewBounds {
  /** Minimum signed angular bound in degrees. */
  minimumDegrees: number;
  /** Maximum signed angular bound in degrees. */
  maximumDegrees: number;
  /** Total angular span in degrees. */
  degrees: number;
  /** Minimum signed angular bound in radians. */
  minimumRadians: number;
  /** Maximum signed angular bound in radians. */
  maximumRadians: number;
  /** Total angular span in radians. */
  radians: number;
  /** Projection/image-plane distance used by the geometry, in millimetres. */
  projectionDistanceMm: number;
}

function resolveProjectionDistance(
  focalLengthMm: number,
  focusDistanceM: number | undefined
): {
  projectionDistanceMm: number;
  focusAware: boolean;
} {
  requirePositiveFinite("focalLengthMm", focalLengthMm);

  const focusProjection =
    focusDistanceM === undefined
      ? undefined
      : calculateThinLensImageDistance({
          focalLengthMm,
          objectDistanceM: focusDistanceM
        });

  return {
    projectionDistanceMm:
      focusProjection?.value.imageDistanceMm ?? focalLengthMm,
    focusAware: focusProjection !== undefined
  };
}

/** Returns the non-rectilinear model, or undefined for the default rectilinear path. */
function nonRectilinearModel(
  input: { projectionModel?: unknown; focusDistanceM?: number }
): Exclude<LensProjectionModel, "rectilinear"> | undefined {
  if (input.projectionModel === undefined) {
    return undefined;
  }
  const model = parseLensProjectionModel(input.projectionModel);
  if (model === "rectilinear") {
    return undefined;
  }
  if (input.focusDistanceM !== undefined) {
    throw new InvalidScientificInputError(
      "focusDistanceM is supported only for the rectilinear projection; a finite-focus fisheye/equirectangular mapping scale is not modeled."
    );
  }
  return model;
}

function fieldOfViewAssumptions(focusAware: boolean): readonly string[] {
  return focusAware
    ? [
        "Ideal rectilinear paraxial thin-lens projection",
        "Sensor plane uses the thin-lens image distance for the supplied focus distance",
        "Real-lens focus breathing and distortion are not modeled"
      ]
    : [
        "Ideal rectilinear/pinhole projection",
        "Nominal focal length represents the infinity-focus projection distance"
      ];
}

/**
 * Calculates the rectilinear angular field of view as
 * 2 * atan(sensorDimension / (2 * projectionDistance)).
 *
 * Without focusDistanceM, projectionDistance is the nominal focal length. This
 * keeps the older infinity-focus (pinhole) behaviour. With focusDistanceM,
 * projectionDistance is the ideal Gaussian thin-lens image distance for that
 * focus plane.
 *
 * Neither mode models real-lens focus breathing or distortion.
 */
export function calculateFieldOfView(
  input: CalculateFieldOfViewInput
): CalculationResult<FieldOfView> {
  requireInputKeys(input, "calculateFieldOfView", ["focalLengthMm", "sensorDimensionMm", "focusDistanceM", "projectionModel"]);
  requirePositiveFinite("sensorDimensionMm", input.sensorDimensionMm);
  const projectionModel = nonRectilinearModel(input);
  if (projectionModel !== undefined) {
    const result = calculateLensProjectionFieldOfView({
      projectionModel,
      focalLengthMm: input.focalLengthMm,
      sensorDimensionMm: input.sensorDimensionMm
    });
    const { provenance } = result;
    return calculatedResult(
      {
        radians: result.value.radians,
        degrees: result.value.degrees,
        projectionDistanceMm: result.value.projectionDistanceMm
      },
      provenance.model,
      provenance.modelVersion,
      provenance.assumptions
    );
  }

  const { projectionDistanceMm, focusAware } = resolveProjectionDistance(
    input.focalLengthMm,
    input.focusDistanceM
  );
  const radians =
    2 * Math.atan(input.sensorDimensionMm / (2 * projectionDistanceMm));

  return calculatedResult(
    {
      radians,
      degrees: (radians * 180) / Math.PI,
      projectionDistanceMm
    },
    focusAware
      ? "focus-aware-rectilinear-field-of-view"
      : "rectilinear-field-of-view",
    "1.0.0",
    fieldOfViewAssumptions(focusAware)
  );
}

/**
 * Calculates an asymmetric rectilinear field-of-view span from signed
 * sensor-plane bounds measured from the optical axis.
 *
 * Use it for off-centre sensor crops, where the optical axis is not at the
 * centre of the kept rectangle.
 */
export function calculateFieldOfViewBounds(
  input: CalculateFieldOfViewBoundsInput
): CalculationResult<FieldOfViewBounds> {
  requireInputKeys(input, "calculateFieldOfViewBounds", ["focalLengthMm", "minimumSensorCoordinateMm", "maximumSensorCoordinateMm", "focusDistanceM", "projectionModel"]);
  if (!Number.isFinite(input.minimumSensorCoordinateMm)) {
    throw new InvalidScientificInputError(
      "minimumSensorCoordinateMm must be finite."
    );
  }
  if (!Number.isFinite(input.maximumSensorCoordinateMm)) {
    throw new InvalidScientificInputError(
      "maximumSensorCoordinateMm must be finite."
    );
  }
  if (
    input.maximumSensorCoordinateMm <= input.minimumSensorCoordinateMm
  ) {
    throw new InvalidScientificInputError(
      "maximumSensorCoordinateMm must be greater than minimumSensorCoordinateMm."
    );
  }

  const projectionModel = nonRectilinearModel(input);
  if (projectionModel !== undefined) {
    const result = calculateLensProjectionFieldOfViewBounds({
      projectionModel,
      focalLengthMm: input.focalLengthMm,
      minimumSensorCoordinateMm: input.minimumSensorCoordinateMm,
      maximumSensorCoordinateMm: input.maximumSensorCoordinateMm
    });
    const { projectionModel: _model, ...value } = result.value;
    void _model;
    const { provenance } = result;
    return calculatedResult(value, provenance.model, provenance.modelVersion, provenance.assumptions);
  }

  const { projectionDistanceMm, focusAware } = resolveProjectionDistance(
    input.focalLengthMm,
    input.focusDistanceM
  );

  const minimumRadians = Math.atan(
    input.minimumSensorCoordinateMm / projectionDistanceMm
  );
  const maximumRadians = Math.atan(
    input.maximumSensorCoordinateMm / projectionDistanceMm
  );
  const radians = maximumRadians - minimumRadians;

  return calculatedResult(
    {
      minimumRadians,
      maximumRadians,
      radians,
      minimumDegrees: (minimumRadians * 180) / Math.PI,
      maximumDegrees: (maximumRadians * 180) / Math.PI,
      degrees: (radians * 180) / Math.PI,
      projectionDistanceMm
    },
    focusAware
      ? "focus-aware-asymmetric-rectilinear-field-of-view"
      : "asymmetric-rectilinear-field-of-view",
    "1.0.0",
    [
      ...fieldOfViewAssumptions(focusAware),
      "Signed sensor-plane bounds are measured relative to the optical axis."
    ]
  );
}
