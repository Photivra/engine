// SPDX-License-Identifier: Apache-2.0

/**
 * Instantaneous inverse mapping for a rotating camera whose sensor exposes different points at
 * different times (for example a rolling shutter). Applies to still world rays under pure camera
 * rotation.
 *
 * The destination point on the native sensor sets the local exposure timing. At a chosen phase within
 * that local window, the captured image-plane ray is mapped back analytically to the reference image
 * plane at the first opening-boundary phase (when the shutter starts to open). No iterative solve is
 * needed: once the destination and local capture time are known, pure rotation under this
 * constant-axis model has an analytic inverse.
 *
 * This is not a renderer for a finite exposure, and it does not integrate blur. Sensor data-readout
 * timing is deliberately not used; exposure boundaries are the only timing source.
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
import {
  mapOrientedPhysicalUvToImagePlanePoint,
  resolveCaptureGeometry,
  transformNativeRasterVectorToOriented,
  type CaptureOrientation,
  type RasterPoint,
  type RasterVector
} from "../output/capture-geometry.js";
import {
  calculateCaptureExposureWindows,
  type CalculateCaptureExposureWindowsInput,
  type CaptureExposureWindowSample
} from "../sensor/exposure-window.js";
import {
  calculateSensorGeometryMetrics,
  type SensorImagingArea
} from "../sensor/sensor-geometry.js";
import {
  calculateInverseCameraRotationImageMapping,
  type CameraAngularVelocityRadPerSec,
  type ImagePlanePointMm
} from "./camera-rotation.js";
import { requireInputObject, requireInputKeys } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export interface CalculateCaptureRotationInverseMappingsInput
  extends CalculateCaptureExposureWindowsInput {
  imagingArea: SensorImagingArea;
  focalLengthMm: number;
  focusDistanceM?: number;
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  /**
   * Where in each point's local exposure interval to evaluate the
   * instantaneous mapping, as a fraction.
   *
   * 0 = local exposure start, 0.5 = local midpoint, 1 = local exposure end.
   * A phase is required because a finite exposure has no single sharp
   * geometry.
   */
  localExposurePhase: number;
  /**
   * Physical capture orientation. It is used only to rotate the reported
   * native inverse displacement (in samples) into oriented-capture
   * coordinates. It does not change the native exposure schedule.
   */
  orientation: CaptureOrientation;
  samplePointsNative: readonly RasterPoint[];
}

export interface CaptureRotationInverseMappingSample {
  destinationPointNative: RasterPoint;
  destinationImagePointMm: ImagePlanePointMm;
  localExposureWindow: {
    startSecondsFromCaptureReference: number;
    endSecondsFromCaptureReference: number;
    durationSeconds: number;
  };
  localExposurePhase: number;
  captureTimeSecondsFromReference: number;
  /**
   * The same still world ray on the reference image plane at exposure start.
   * It may lie outside the active capture area; it is deliberately not
   * clamped.
   */
  referenceImagePointMm: ImagePlanePointMm;
  inverseDisplacementImagePlaneMm: {
    x: number;
    y: number;
    distance: number;
  };
  /**
   * Reference minus destination displacement, in continuous native effective
   * raster samples (+X right, +Y down).
   */
  inverseDisplacementNativeSamples: RasterVector & {
    distance: number;
  };
  /**
   * The same displacement after physical capture orientation.
   */
  inverseDisplacementOrientedSamples: RasterVector & {
    distance: number;
  };
}

export interface CaptureRotationInverseMappings {
  timeReference: "first-opening-boundary-phase";
  referenceTimeSecondsFromCaptureReference: 0;
  mappingMeaning:
    "instantaneous-destination-to-exposure-start-reference-ray";
  orientation: CaptureOrientation;
  localExposurePhase: number;
  imagingArea: SensorImagingArea;
  activeCaptureRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  samples: readonly CaptureRotationInverseMappingSample[];
  componentProvenance: {
    exposureWindows: CalculationProvenance;
    sensorGeometry: CalculationProvenance;
    inverseCameraRotation: CalculationProvenance;
  };
}

function requireExposurePhase(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidScientificInputError(
      "localExposurePhase must be finite and within [0, 1]."
    );
  }
}

export function requireNonEmptySamples(
  value: readonly RasterPoint[]
): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidConfigurationError(
      "samplePointsNative must be a non-empty array."
    );
  }
  value.forEach((point, index) => requireInputObject(point, "samplePointsNative[" + index + "]"));
}

export function nativePointToImagePlane(
  point: RasterPoint,
  activeCaptureRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  activePhysicalBoundsFromOpticalAxisMm: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
): ImagePlanePointMm {
  const u = (point.x - activeCaptureRect.x) / activeCaptureRect.width;
  const v = (point.y - activeCaptureRect.y) / activeCaptureRect.height;

  return mapOrientedPhysicalUvToImagePlanePoint({
    uv: { u, v },
    orientedPhysicalBoundsFromOpticalAxisMm:
      activePhysicalBoundsFromOpticalAxisMm,
    orientation: "landscape"
  });
}

function captureTimeAtPhase(
  exposure: CaptureExposureWindowSample,
  phase: number
): number {
  return (
    exposure.startOffsetSecondsFromOpeningReference +
    phase * exposure.localExposureDurationSeconds
  );
}

/**
 * Calculates an instantaneous inverse capture-scan mapping for still world
 * rays under pure camera rotation.
 *
 * The destination point on the native sensor sets the local exposure timing.
 * At a chosen phase within that local window, the captured image-plane ray is
 * mapped back analytically to the reference image plane at the first
 * opening-boundary phase.
 *
 * No iterative solve is needed. Once the destination and local capture time
 * are known, pure rotation under this constant-axis model has an analytic
 * inverse.
 *
 * This is not a renderer for a finite exposure, and it does not integrate
 * blur. Sensor data-readout timing is deliberately not used; exposure
 * boundaries are the only timing source.
 */
export function calculateCaptureRotationInverseMappings(
  input: CalculateCaptureRotationInverseMappingsInput
): CalculationResult<CaptureRotationInverseMappings> {
  requireInputKeys(input, "calculateCaptureRotationInverseMappings", ["imagingArea", "focalLengthMm", "focusDistanceM", "angularVelocityRadPerSec", "localExposurePhase", "orientation", "samplePointsNative", "nativeRaster", "activeCaptureRect", "shutterMechanism", "nominalExposureDurationSeconds", "opening", "closing"]);
  requireInputObject(input.imagingArea, "imagingArea");
  requirePositiveFinite("imagingArea.widthMm", input.imagingArea.widthMm);
  requirePositiveFinite("imagingArea.heightMm", input.imagingArea.heightMm);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requireExposurePhase(input.localExposurePhase);
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
    orientation: input.orientation,
    activeCaptureRect: exposureWindows.value.activeCaptureRect
  }).value;

  const sensorGeometry = calculateSensorGeometryMetrics({
    imagingArea: input.imagingArea,
    nativeRaster: input.nativeRaster
  });

  const pitchXmm =
    sensorGeometry.value.sampling.pitchXMicrometers / 1000;
  const pitchYmm =
    sensorGeometry.value.sampling.pitchYMicrometers / 1000;

  let inverseRotationProvenance: CalculationProvenance | undefined;
  const samples = input.samplePointsNative.map((point, index) => {
    const exposure = exposureWindows.value.samples[index];
    if (exposure === undefined) {
      throw new InvalidScientificInputError(
        "Exposure-window sample alignment failed."
      );
    }

    const destinationImagePointMm = nativePointToImagePlane(
      point,
      geometry.activeCapture.nativeRect,
      geometry.activeCapture.physicalBoundsFromOpticalAxisMm
    );
    const captureTimeSecondsFromReference = captureTimeAtPhase(
      exposure,
      input.localExposurePhase
    );

    const inverse = calculateInverseCameraRotationImageMapping({
      focalLengthMm: input.focalLengthMm,
      imagePointMm: destinationImagePointMm,
      timeSecondsFromExposureStart:
        captureTimeSecondsFromReference,
      angularVelocityRadPerSec: input.angularVelocityRadPerSec,
      ...(input.focusDistanceM === undefined
        ? {}
        : { focusDistanceM: input.focusDistanceM }),
      samplingPitchMicrometers: {
        x: sensorGeometry.value.sampling.pitchXMicrometers,
        y: sensorGeometry.value.sampling.pitchYMicrometers
      }
    });
    inverseRotationProvenance ??= inverse.provenance;

    const nativeX = inverse.value.deltaMm.x / pitchXmm;
    const nativeY = -inverse.value.deltaMm.y / pitchYmm;
    const inverseDisplacementNativeSamples = {
      x: nativeX,
      y: nativeY,
      distance: Math.hypot(nativeX, nativeY)
    };
    const orientedVector = transformNativeRasterVectorToOriented({
      vector: {
        x: inverseDisplacementNativeSamples.x,
        y: inverseDisplacementNativeSamples.y
      },
      orientation: input.orientation
    });
    const inverseDisplacementOrientedSamples = {
      ...orientedVector,
      distance: Math.hypot(orientedVector.x, orientedVector.y)
    };

    return {
      destinationPointNative: { ...point },
      destinationImagePointMm,
      localExposureWindow: {
        startSecondsFromCaptureReference:
          exposure.startOffsetSecondsFromOpeningReference,
        endSecondsFromCaptureReference:
          exposure.endOffsetSecondsFromOpeningReference,
        durationSeconds: exposure.localExposureDurationSeconds
      },
      localExposurePhase: input.localExposurePhase,
      captureTimeSecondsFromReference,
      referenceImagePointMm: {
        ...inverse.value.referenceImagePointMm
      },
      inverseDisplacementImagePlaneMm: {
        ...inverse.value.deltaMm
      },
      inverseDisplacementNativeSamples,
      inverseDisplacementOrientedSamples
    };
  });

  if (inverseRotationProvenance === undefined) {
    throw new InvalidScientificInputError(
      "At least one inverse rotation mapping sample is required."
    );
  }

  return approximationResult(
    {
      timeReference: "first-opening-boundary-phase",
      referenceTimeSecondsFromCaptureReference: 0,
      mappingMeaning:
        "instantaneous-destination-to-exposure-start-reference-ray",
      orientation: input.orientation,
      localExposurePhase: input.localExposurePhase,
      imagingArea: { ...input.imagingArea },
      activeCaptureRect: {
        ...exposureWindows.value.activeCaptureRect
      },
      samples,
      componentProvenance: {
        exposureWindows: exposureWindows.provenance,
        sensorGeometry: sensorGeometry.provenance,
        inverseCameraRotation: inverseRotationProvenance
      }
    },
    "capture-rotation-instantaneous-inverse-mapping",
    "1.0.0",
    [
      "Destination native capture location determines the local exposure window.",
      "The caller explicitly selects one phase within each local exposure interval; no midpoint or other phase is inferred.",
      "The first opening-boundary phase is the reference image time and is bound to t=0 of the camera-rotation model for this composition.",
      "Pure rotation is inverted analytically after local capture time is known; no iterative or fixed-point solver is used.",
      "Sensor data-readout timing is not an input and is not assumed to equal any exposure boundary.",
      "Reference image-plane coordinates are not clamped to the active capture and may fall outside it under motion.",
      "Native geometric sample displacement uses the full physical imaging-area/native-raster pitch and is not output-resolution dependent.",
      "Physical capture orientation rotates reported native displacement only; it does not alter native exposure timing.",
      "The mapping lives in the ideal pre-lens image plane and does not compose radial distortion, chromatic aberration, PSF, or output resampling.",
      "This is an instantaneous mapping, not finite-exposure integration or a blur kernel.",
      "Camera translation, depth parallax, subject motion, deformation, occlusion changes, flash/flicker and shutter shock are excluded.",
      "The model does not claim the global rolling/capture-scan picture-taking map is one-to-one for arbitrary motion."
    ]
  );
}
