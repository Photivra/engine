// SPDX-License-Identifier: Apache-2.0

/**
 * Time samples (temporal quadrature nodes) across each destination point's local exposure, for a
 * rotating camera. The samples are deterministic.
 *
 * The first model uses an equal-width midpoint rule. Every node calls
 * calculateCaptureRotationInverseMappings(), so the instantaneous geometry has a single
 * implementation.
 *
 * No radiance is evaluated here. Two weights are returned:
 * - normalizedTimeWeight: for a time average, assuming a uniform response over time.
 * - timeMeasureSeconds: the local dt, for a time integral.
 * Neither weight includes shutter transmission, scene flicker, sensor response, radiometric
 * calibration or any other throughput term.
 *
 * No numerical integration error estimate is reported, on purpose. Geometry alone cannot tell the
 * error in a scene-radiance integral. A renderer that needs evidence of convergence can compare
 * results for increasing sample counts in its own radiance domain.
 * @see docs/MOTION_AND_SIGNAL.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  approximationResult,
  type CalculationProvenance,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveInteger
} from "../core/validation.js";
import type { RasterPoint, RasterVector } from "../output/capture-geometry.js";
import type { ImagePlanePointMm } from "./camera-rotation.js";
import {
  calculateCaptureRotationInverseMappings,
  type CalculateCaptureRotationInverseMappingsInput
} from "./capture-rotation-inverse-mapping.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export interface CalculateCaptureRotationTemporalQuadratureInput
  extends Omit<
    CalculateCaptureRotationInverseMappingsInput,
    "localExposurePhase"
  > {
  /**
   * Number of time samples (quadrature nodes) per local exposure interval.
   * Nodes follow the uniform midpoint rule.
   */
  temporalSampleCount: number;
}

export interface CaptureRotationTemporalQuadratureNode {
  temporalSampleIndex: number;
  /**
   * Normalized phase in the local exposure interval, strictly inside (0, 1).
   */
  localExposurePhase: number;
  captureTimeSecondsFromReference: number;
  /**
   * Dimensionless weight for approximating the time average of a quantity,
   * assuming a uniform response over time.
   */
  normalizedTimeWeight: number;
  /**
   * Quadrature measure in seconds, for approximating a time integral.
   *
   * This is a measure of time only. It is not shutter transmission,
   * radiometric throughput, photon count, sensor response or scene radiance.
   */
  timeMeasureSeconds: number;
  referenceImagePointMm: ImagePlanePointMm;
  inverseDisplacementImagePlaneMm: {
    x: number;
    y: number;
    distance: number;
  };
  inverseDisplacementNativeSamples: RasterVector & {
    distance: number;
  };
  inverseDisplacementOrientedSamples: RasterVector & {
    distance: number;
  };
}

export interface CaptureRotationTemporalQuadraturePoint {
  destinationPointNative: RasterPoint;
  destinationImagePointMm: ImagePlanePointMm;
  localExposureWindow: {
    startSecondsFromCaptureReference: number;
    endSecondsFromCaptureReference: number;
    durationSeconds: number;
  };
  nodes: readonly CaptureRotationTemporalQuadratureNode[];
}

export interface CaptureRotationTemporalQuadrature {
  timeReference: "first-opening-boundary-phase";
  quadratureScheme: "uniform-midpoint";
  temporalResponseModel: "uniform-over-local-exposure";
  temporalSampleCount: number;
  /**
   * The quadrature returns geometry and temporal measure only. It does not
   * integrate radiance or produce a blur kernel.
   */
  outputMeaning: "temporal-geometry-quadrature-nodes";
  points: readonly CaptureRotationTemporalQuadraturePoint[];
  componentProvenance: {
    instantaneousInverseMapping: CalculationProvenance;
  };
}

export function midpointPhase(index: number, sampleCount: number): number {
  return (index + 0.5) / sampleCount;
}

/**
 * Builds deterministic time samples (temporal quadrature nodes) for a
 * rotating camera, across each destination point's local exposure interval.
 *
 * The first model uses an equal-width midpoint rule. Every node calls
 * calculateCaptureRotationInverseMappings(), so the instantaneous geometry
 * has a single implementation.
 *
 * No radiance is evaluated here. normalizedTimeWeight is for a time average,
 * assuming a uniform response over time. timeMeasureSeconds is the local dt
 * for a time integral. Neither weight includes shutter transmission, scene
 * flicker, sensor response, radiometric calibration or any other throughput
 * term.
 *
 * No numerical integration error estimate is reported, on purpose. Geometry
 * alone cannot tell the error in a scene-radiance integral. A renderer that
 * needs evidence of convergence can compare results for increasing sample
 * counts in its own radiance domain.
 */
export function calculateCaptureRotationTemporalQuadrature(
  input: CalculateCaptureRotationTemporalQuadratureInput
): CalculationResult<CaptureRotationTemporalQuadrature> {
  requireInputKeys(input, "calculateCaptureRotationTemporalQuadrature", ["temporalSampleCount", "imagingArea", "focalLengthMm", "focusDistanceM", "angularVelocityRadPerSec", "orientation", "samplePointsNative", "nativeRaster", "activeCaptureRect", "shutterMechanism", "nominalExposureDurationSeconds", "opening", "closing"]);
  requirePositiveInteger(
    "temporalSampleCount",
    input.temporalSampleCount
  );

  if (
    !Array.isArray(input.samplePointsNative) ||
    input.samplePointsNative.length === 0
  ) {
    throw new InvalidConfigurationError(
      "samplePointsNative must be a non-empty array."
    );
  }
  input.samplePointsNative.forEach((point, index) => requireInputObject(point, "samplePointsNative[" + index + "]"));

  const totalNodeCount =
    input.temporalSampleCount * input.samplePointsNative.length;
  if (!Number.isSafeInteger(totalNodeCount)) {
    throw new InvalidScientificInputError(
      "temporalSampleCount × samplePointsNative.length must be a safe integer."
    );
  }

  const {
    temporalSampleCount,
    ...instantaneousInput
  } = input;

  const phaseResults = Array.from(
    { length: temporalSampleCount },
    (_, temporalSampleIndex) => {
      const localExposurePhase = midpointPhase(
        temporalSampleIndex,
        temporalSampleCount
      );

      return calculateCaptureRotationInverseMappings({
        ...instantaneousInput,
        localExposurePhase
      });
    }
  );

  const firstResult = phaseResults[0];
  if (firstResult === undefined) {
    throw new InvalidScientificInputError(
      "At least one temporal quadrature node is required."
    );
  }

  const normalizedTimeWeight = 1 / temporalSampleCount;

  const points = firstResult.value.samples.map(
    (firstSample, pointIndex) => {
      const durationSeconds =
        firstSample.localExposureWindow.durationSeconds;
      const timeMeasureSeconds =
        durationSeconds / temporalSampleCount;

      const nodes = phaseResults.map(
        (phaseResult, temporalSampleIndex) => {
          const sample = phaseResult.value.samples[pointIndex];
          if (sample === undefined) {
            throw new InvalidScientificInputError(
              "Instantaneous inverse-mapping sample alignment failed."
            );
          }

          const localExposurePhase = midpointPhase(
            temporalSampleIndex,
            temporalSampleCount
          );

          return {
            temporalSampleIndex,
            localExposurePhase,
            captureTimeSecondsFromReference:
              sample.captureTimeSecondsFromReference,
            normalizedTimeWeight,
            timeMeasureSeconds,
            referenceImagePointMm: {
              ...sample.referenceImagePointMm
            },
            inverseDisplacementImagePlaneMm: {
              ...sample.inverseDisplacementImagePlaneMm
            },
            inverseDisplacementNativeSamples: {
              ...sample.inverseDisplacementNativeSamples
            },
            inverseDisplacementOrientedSamples: {
              ...sample.inverseDisplacementOrientedSamples
            }
          };
        }
      );

      return {
        destinationPointNative: {
          ...firstSample.destinationPointNative
        },
        destinationImagePointMm: {
          ...firstSample.destinationImagePointMm
        },
        localExposureWindow: {
          ...firstSample.localExposureWindow
        },
        nodes
      };
    }
  );

  return approximationResult(
    {
      timeReference: "first-opening-boundary-phase",
      quadratureScheme: "uniform-midpoint",
      temporalResponseModel: "uniform-over-local-exposure",
      temporalSampleCount,
      outputMeaning: "temporal-geometry-quadrature-nodes",
      points,
      componentProvenance: {
        instantaneousInverseMapping: firstResult.provenance
      }
    },
    "capture-rotation-temporal-quadrature",
    "1.0.0",
    [
      "Each destination native point retains its own validated local exposure interval.",
      "Temporal nodes use a deterministic equal-width midpoint rule with phases (i + 0.5) / N and therefore do not sample the exact opening/closing boundaries.",
      "Normalized temporal weights sum approximately to one and represent a uniform time-average measure only.",
      "Seconds-valued temporal measures sum approximately to the local exposure duration and represent dt only.",
      "Uniform temporal response is an explicit approximation; shutter transmission ramps, scene flicker, sensor response and radiometric throughput are not included.",
      "Every node delegates instantaneous geometry to calculateCaptureRotationInverseMappings(); no second camera-motion equation is introduced.",
      "Sensor data-readout timing and readout/exposure linkage metadata do not alter the exposure integral unless a future explicit image-formation model consumes them.",
      "Reference rays may leave the active source frame under motion and are not clamped.",
      "No radiance, photon count, blur kernel, PSF, source resampling or output pixel value is calculated.",
      "No geometry-only convergence/error estimate is reported because temporal integration error depends on the downstream radiance/visibility function as well as motion.",
      "Camera translation, scene-depth parallax, subject motion/deformation, occlusion changes, flash/flicker, shutter shock and non-uniform temporal response remain separate future work."
    ]
  );
}
