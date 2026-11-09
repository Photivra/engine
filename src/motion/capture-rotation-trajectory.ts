// SPDX-License-Identifier: Apache-2.0

/**
 * Paths of still world rays across each point's local exposure window, for a camera that only
 * rotates.
 *
 * This links timing to geometry. It is not a finished rolling-shutter image mapping.
 * - The native sample point sets where a still world ray would land in the reference
 *   global-shutter image, at the first opening-boundary phase (when the shutter starts to open).
 * - The existing camera-rotation model is then evaluated at that point's local exposure start and
 *   end.
 *
 * Sensor data-readout timing is deliberately not used. How readout relates to exposure boundaries
 * depends on the camera and mode, and needs its own explicit contract. This function never assumes
 * one.
 *
 * A future rolling-shutter warp for renderers must solve the image mapping with time that depends on
 * capture location, and must integrate over the local exposure interval. Do not treat the endpoint
 * chord returned here as a blur kernel or as an inverse destination-to-source sampling map.
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
  requirePositiveFinite
} from "../core/validation.js";
import { resolveCaptureGeometry, type RasterPoint } from "../output/capture-geometry.js";
import {
  calculateCaptureExposureWindows,
  type CalculateCaptureExposureWindowsInput,
  type CaptureExposureWindowSample
} from "../sensor/exposure-window.js";
import type { SensorImagingArea } from "../sensor/sensor-geometry.js";
import {
  calculateCameraRotationImageMapping,
  type CameraAngularVelocityRadPerSec,
  type CameraRotationImageMapping,
  type ImagePlanePointMm
} from "./camera-rotation.js";
import { requireInputObject, requireInputKeys } from "../core/record-validation.js";
import { requireNonEmptySamples, nativePointToImagePlane as nativePointToReferenceImagePlane } from "./capture-rotation-inverse-mapping.js";

export interface CalculateCaptureRotationTrajectoriesInput
  extends CalculateCaptureExposureWindowsInput {
  /**
   * Physical photosensitive imaging area associated with nativeRaster.
   */
  imagingArea: SensorImagingArea;
  /** Physical focal length in millimetres. */
  focalLengthMm: number;
  /** Optional focus distance in metres for focus-aware projection distance. */
  focusDistanceM?: number;
  /**
   * Constant physical camera angular velocity resolved in camera axes at the
   * first opening-boundary phase.
   */
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  /**
   * Native points whose still-ray paths to evaluate. Required, and must not be
   * empty.
   */
  samplePointsNative: readonly RasterPoint[];
}

export interface CaptureRotationTrajectoryEndpoint {
  timeSecondsFromCaptureReference: number;
  mappedImagePointMm: ImagePlanePointMm;
  deltaFromReferenceMm: {
    x: number;
    y: number;
    distance: number;
  };
}

export interface CaptureRotationTrajectorySample {
  pointNative: RasterPoint;
  /**
   * Image-plane position of the stationary world ray at the capture reference
   * time (the first opening-boundary phase).
   */
  referenceImagePointMm: ImagePlanePointMm;
  localExposureWindow: {
    startSecondsFromCaptureReference: number;
    endSecondsFromCaptureReference: number;
    durationSeconds: number;
    openingNormalizedScanPosition: number | null;
    closingNormalizedScanPosition: number | null;
  };
  atLocalExposureStart: CaptureRotationTrajectoryEndpoint;
  atLocalExposureEnd: CaptureRotationTrajectoryEndpoint;
  /**
   * Chord between the two trajectory endpoints.
   *
   * This is not a blur kernel, integrated exposure, or rolling-shutter warp.
   */
  localExposureTrajectoryEndpointDeltaMm: {
    x: number;
    y: number;
    distance: number;
  };
}

export interface CaptureRotationTrajectories {
  timeReference: "first-opening-boundary-phase";
  trajectoryMeaning: "forward-stationary-reference-ray";
  imagingArea: SensorImagingArea;
  activeCaptureRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  samples: readonly CaptureRotationTrajectorySample[];
  componentProvenance: {
    exposureWindows: CalculationProvenance;
    cameraRotation: CalculationProvenance;
  };
}

function endpointFromMapping(
  mapping: CameraRotationImageMapping
): CaptureRotationTrajectoryEndpoint {
  return {
    timeSecondsFromCaptureReference:
      mapping.timeSecondsFromExposureStart,
    mappedImagePointMm: { ...mapping.mappedImagePointMm },
    deltaFromReferenceMm: { ...mapping.deltaMm }
  };
}

function trajectorySample(
  point: RasterPoint,
  exposure: CaptureExposureWindowSample,
  referenceImagePointMm: ImagePlanePointMm,
  input: CalculateCaptureRotationTrajectoriesInput
): {
  sample: CaptureRotationTrajectorySample;
  rotationProvenance: CalculationProvenance;
} {
  const common = {
    focalLengthMm: input.focalLengthMm,
    imagePointMm: referenceImagePointMm,
    angularVelocityRadPerSec: input.angularVelocityRadPerSec,
    ...(input.focusDistanceM === undefined
      ? {}
      : { focusDistanceM: input.focusDistanceM })
  };

  const start = calculateCameraRotationImageMapping({
    ...common,
    timeSecondsFromExposureStart:
      exposure.startOffsetSecondsFromOpeningReference
  });
  const end = calculateCameraRotationImageMapping({
    ...common,
    timeSecondsFromExposureStart:
      exposure.endOffsetSecondsFromOpeningReference
  });

  const endpointDeltaX =
    end.value.mappedImagePointMm.x -
    start.value.mappedImagePointMm.x;
  const endpointDeltaY =
    end.value.mappedImagePointMm.y -
    start.value.mappedImagePointMm.y;

  return {
    sample: {
      pointNative: { ...point },
      referenceImagePointMm: { ...referenceImagePointMm },
      localExposureWindow: {
        startSecondsFromCaptureReference:
          exposure.startOffsetSecondsFromOpeningReference,
        endSecondsFromCaptureReference:
          exposure.endOffsetSecondsFromOpeningReference,
        durationSeconds: exposure.localExposureDurationSeconds,
        openingNormalizedScanPosition:
          exposure.openingNormalizedScanPosition,
        closingNormalizedScanPosition:
          exposure.closingNormalizedScanPosition
      },
      atLocalExposureStart: endpointFromMapping(start.value),
      atLocalExposureEnd: endpointFromMapping(end.value),
      localExposureTrajectoryEndpointDeltaMm: {
        x: endpointDeltaX,
        y: endpointDeltaY,
        distance: Math.hypot(endpointDeltaX, endpointDeltaY)
      }
    },
    rotationProvenance: start.provenance
  };
}

/**
 * Evaluates pure-camera-rotation trajectories for stationary reference rays
 * over each point's local exposure window.
 *
 * This links timing to geometry. It is not a finished rolling-shutter image
 * mapping. The native sample point sets where a still world ray would land in
 * the reference global-shutter image at the first opening-boundary phase. The
 * existing camera-rotation model is then evaluated at that point's local
 * exposure start and end.
 *
 * Sensor data-readout timing is deliberately not used. How readout relates to
 * exposure boundaries depends on the camera and mode, and needs its own
 * explicit contract. This function never assumes one.
 *
 * A future rolling-shutter warp for renderers must solve the image mapping
 * with time that depends on capture location, and must integrate over the
 * local exposure interval. Do not treat the endpoint chord returned here as a
 * blur kernel or as an inverse destination-to-source sampling map.
 */
export function calculateCaptureRotationTrajectories(
  input: CalculateCaptureRotationTrajectoriesInput
): CalculationResult<CaptureRotationTrajectories> {
  requireInputKeys(input, "calculateCaptureRotationTrajectories", ["imagingArea", "focalLengthMm", "focusDistanceM", "angularVelocityRadPerSec", "samplePointsNative", "nativeRaster", "activeCaptureRect", "shutterMechanism", "nominalExposureDurationSeconds", "opening", "closing"]);
  requireInputObject(input.imagingArea, "imagingArea");
  requirePositiveFinite("imagingArea.widthMm", input.imagingArea.widthMm);
  requirePositiveFinite("imagingArea.heightMm", input.imagingArea.heightMm);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requireNonEmptySamples(input.samplePointsNative);

  const exposureWindows = calculateCaptureExposureWindows({
    nativeRaster: input.nativeRaster,
    ...(input.activeCaptureRect === undefined
      ? {}
      : { activeCaptureRect: input.activeCaptureRect }),
    shutterMechanism: input.shutterMechanism,
    nominalExposureDurationSeconds:
      input.nominalExposureDurationSeconds,
    opening: input.opening,
    closing: input.closing,
    samplePointsNative: input.samplePointsNative
  });

  const geometry = resolveCaptureGeometry({
    imagingArea: input.imagingArea,
    nativeRaster: input.nativeRaster,
    orientation: "landscape",
    activeCaptureRect: exposureWindows.value.activeCaptureRect
  }).value;

  const exposureByPoint = exposureWindows.value.samples;
  const samples: CaptureRotationTrajectorySample[] = [];
  let rotationProvenance: CalculationProvenance | undefined;

  input.samplePointsNative.forEach((point, index) => {
    const exposure = exposureByPoint[index];
    if (exposure === undefined) {
      throw new InvalidScientificInputError(
        "Exposure-window sample alignment failed."
      );
    }

    const referenceImagePointMm = nativePointToReferenceImagePlane(
      point,
      geometry.activeCapture.nativeRect,
      geometry.activeCapture.physicalBoundsFromOpticalAxisMm
    );

    const resolved = trajectorySample(
      point,
      exposure,
      referenceImagePointMm,
      input
    );
    samples.push(resolved.sample);
    rotationProvenance ??= resolved.rotationProvenance;
  });

  if (rotationProvenance === undefined) {
    throw new InvalidScientificInputError(
      "At least one rotation trajectory sample is required."
    );
  }

  return approximationResult(
    {
      timeReference: "first-opening-boundary-phase",
      trajectoryMeaning: "forward-stationary-reference-ray",
      imagingArea: { ...input.imagingArea },
      activeCaptureRect: {
        ...exposureWindows.value.activeCaptureRect
      },
      samples,
      componentProvenance: {
        exposureWindows: exposureWindows.provenance,
        cameraRotation: rotationProvenance
      }
    },
    "capture-rotation-exposure-trajectory",
    "1.0.0",
    [
      "The first opening-boundary phase is explicitly bound to t=0 of the low-level camera-rotation model for this composition only.",
      "Each native point identifies a stationary world ray by its reference image-plane location at the capture reference time.",
      "Local exposure start/end times come only from the capture exposure-window contract.",
      "Sensor data-readout timing does not participate and is never assumed to equal an exposure boundary.",
      "Camera angular velocity is constant and resolved in camera axes at the first opening-boundary phase.",
      "Only pure camera rotation is modeled; camera translation, scene depth parallax, subject motion, deformation and occlusion changes are excluded.",
      "The returned start/end mappings are a forward stationary-ray trajectory, not a rolling-shutter image warp.",
      "The trajectory endpoint chord is not an integrated blur kernel and may not represent the curved path between endpoints.",
      "A later inverse renderer warp must solve capture-location-dependent timing consistently rather than evaluating one forward displacement at the destination coordinate.",
      "Exposure integration over the full local interval remains future work."
    ]
  );
}
