// SPDX-License-Identifier: Apache-2.0

/**
 * Sensor readout timing: when each position on the sensor is read out during one capture.
 *
 * Rolling readout is modelled as a uniform linear scan along one axis of the declared active capture.
 * The caller supplies the scan's time span (skew) explicitly. It is never worked out from the total
 * data-readout time, the crop size, pixel density, output resolution, sensor-architecture metadata or
 * the shutter mechanism. Global readout has no skew in this model, even when a non-zero data-readout
 * time is declared.
 *
 * Not covered here: local exposure start and end times, mechanical curtain travel, EFCS (electronic
 * first-curtain shutter) behaviour, rolling-shutter image distortion, flash or flicker, and motion
 * integration.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import {
  parseEvidenceList,
  type EvidenceBackedFact
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError, requirePositiveInteger } from "../core/validation.js";
import type { RasterPoint, RasterRect } from "../output/capture-geometry.js";
import type { NativeImageRaster } from "./sensor-geometry.js";
import type { SensorReadoutArchitecture } from "./architecture.js";
import { requireInputKeys, requireConfigRecord as requireRecord } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { fullRect } from "../core/shared-helpers.js";
import { normalizedScanPosition, validateNativeRaster, scanVector, requirePositiveFinite, requireNonNegativeInteger } from "./exposure-window.js";

/**
 * The readout mode chosen for one capture.
 *
 * It uses the same names as the architecture metadata, but does not claim the
 * hardware supports it. SensorArchitectureProfile.readoutCapabilities is
 * descriptive only and is not checked automatically.
 */
export type SensorReadoutMode = SensorReadoutArchitecture;

export type NativeSensorReadoutScanDirection =
  | "top-to-bottom"
  | "bottom-to-top"
  | "left-to-right"
  | "right-to-left";

export type CaptureShutterMechanism =
  | "mechanical"
  | "electronic-first-curtain"
  | "electronic";

/**
 * Evidence-backed timing value with an explicit seconds unit.
 */
export interface SourcedSensorTimingSeconds
  extends EvidenceBackedFact<number> {
  unit: "s";
}

export type SourcedSensorReadoutFact<T> = EvidenceBackedFact<T>;

export interface GlobalSensorReadoutTimingDeclaration {
  readoutMode: "global";
  /**
   * Sensor data-readout time for this capture.
   *
   * It is deliberately not treated as the spatial exposure or readout skew.
   */
  captureReadoutDurationSeconds: SourcedSensorTimingSeconds;
  scanDirectionNative?: never;
  spatialSamplingSkewSeconds?: never;
}

export interface RollingSensorReadoutTimingDeclaration {
  readoutMode: "rolling";
  /**
   * Sensor data-readout time for this capture.
   *
   * It is kept separate from the spatial skew, because a published readout time
   * and the scan's time span are not necessarily the same quantity.
   */
  captureReadoutDurationSeconds: SourcedSensorTimingSeconds;
  /**
   * Native-sensor scan direction for the selected capture mode.
   */
  scanDirectionNative: SourcedSensorReadoutFact<NativeSensorReadoutScanDirection>;
  /**
   * Time between the first and last scan positions, in the uniform linear
   * timing approximation (the readout skew).
   */
  spatialSamplingSkewSeconds: SourcedSensorTimingSeconds;
}

export type SensorReadoutTimingDeclaration =
  | GlobalSensorReadoutTimingDeclaration
  | RollingSensorReadoutTimingDeclaration;

export interface CalculateSensorReadoutTimingInput {
  nativeRaster: NativeImageRaster;
  /**
   * Active capture rectangle, in fixed native pixel coordinates.
   *
   * Defaults to the whole native image. Timing is never worked out by scaling
   * a full-frame value to this rectangle.
   */
  activeCaptureRect?: RasterRect;
  /**
   * The shutter mechanism chosen for the capture.
   *
   * It is reported separately and does not change the sensor readout timing
   * in this model.
   */
  shutterMechanism: CaptureShutterMechanism;
  readout: SensorReadoutTimingDeclaration;
  /**
   * Optional points, in continuous native pixel coordinates measured from pixel
   * edges, to report timing for. A pixel centre is at +0.5.
   */
  samplePointsNative?: readonly RasterPoint[];
}

export interface SensorReadoutTimingSample {
  pointNative: RasterPoint;
  normalizedScanPosition: number | null;
  /**
   * Readout time of this point, in seconds, relative to the first scan position (0).
   *
   * It is not automatically an exposure-start time or a shutter-curtain time.
   */
  readoutPhaseOffsetSeconds: number;
}

export interface SensorReadoutTiming {
  readoutMode: SensorReadoutMode;
  shutterMechanism: CaptureShutterMechanism;
  nativeRaster: NativeImageRaster;
  activeCaptureRect: RasterRect;
  captureReadoutDurationSeconds: SourcedSensorTimingSeconds;
  maximumSpatialSamplingSkewSeconds: number;
  scan:
    | {
        pattern: "uniform-linear-single-axis";
        directionNative: SourcedSensorReadoutFact<NativeSensorReadoutScanDirection>;
        unitVectorNative: { x: number; y: number };
        spatialSamplingSkewSeconds: SourcedSensorTimingSeconds;
      }
    | null;
  samples: readonly SensorReadoutTimingSample[];
}

const READOUT_MODES = new Set<SensorReadoutMode>(["rolling", "global"]);
const SCAN_DIRECTIONS = new Set<NativeSensorReadoutScanDirection>([
  "top-to-bottom",
  "bottom-to-top",
  "left-to-right",
  "right-to-left"
]);
const SHUTTER_MECHANISMS = new Set<CaptureShutterMechanism>([
  "mechanical",
  "electronic-first-curtain",
  "electronic"
]);

function requireNonNegativeFinite(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new InvalidScientificInputError(
      name + " must be a finite number greater than or equal to zero."
    );
  }
  return value;
}

function parseSecondsFact(
  value: unknown,
  path: string,
  positive: boolean
): SourcedSensorTimingSeconds {
  const record = requireRecord(value, path, ["unit", "value", "evidence"]);
  if (record.unit !== "s") {
    throw new InvalidConfigurationError(path + '.unit must be "s".');
  }

  const seconds = positive
    ? requirePositiveFinite(path + ".value", record.value)
    : requireNonNegativeFinite(path + ".value", record.value);

  return {
    value: seconds,
    unit: "s",
    evidence: parseEvidenceList(record.evidence, path + ".evidence")
  };
}

function parseDirectionFact(
  value: unknown,
  path: string
): SourcedSensorReadoutFact<NativeSensorReadoutScanDirection> {
  const record = requireRecord(value, path, ["value", "evidence"]);
  if (
    typeof record.value !== "string" ||
    !SCAN_DIRECTIONS.has(
      record.value as NativeSensorReadoutScanDirection
    )
  ) {
    throw new InvalidConfigurationError(path + ".value is invalid.");
  }

  return {
    value: record.value as NativeSensorReadoutScanDirection,
    evidence: parseEvidenceList(record.evidence, path + ".evidence")
  };
}

function parseReadoutDeclaration(
  value: unknown
): SensorReadoutTimingDeclaration {
  const record = requireRecord(value, "readout", ["readoutMode", "captureReadoutDurationSeconds", "scanDirectionNative", "spatialSamplingSkewSeconds"]);
  if (
    typeof record.readoutMode !== "string" ||
    !READOUT_MODES.has(record.readoutMode as SensorReadoutMode)
  ) {
    throw new InvalidConfigurationError("readout.readoutMode is invalid.");
  }

  const captureReadoutDurationSeconds = parseSecondsFact(
    record.captureReadoutDurationSeconds,
    "readout.captureReadoutDurationSeconds",
    false
  );

  if (record.readoutMode === "global") {
    if (record.scanDirectionNative !== undefined) {
      throw new InvalidScientificInputError(
        "readout.scanDirectionNative must be omitted for global readout."
      );
    }
    if (record.spatialSamplingSkewSeconds !== undefined) {
      throw new InvalidScientificInputError(
        "readout.spatialSamplingSkewSeconds must be omitted for global readout."
      );
    }

    return {
      readoutMode: "global",
      captureReadoutDurationSeconds
    };
  }

  return {
    readoutMode: "rolling",
    captureReadoutDurationSeconds,
    scanDirectionNative: parseDirectionFact(
      record.scanDirectionNative,
      "readout.scanDirectionNative"
    ),
    spatialSamplingSkewSeconds: parseSecondsFact(
      record.spatialSamplingSkewSeconds,
      "readout.spatialSamplingSkewSeconds",
      true
    )
  };
}

function validateActiveCaptureRect(
  rect: RasterRect,
  raster: NativeImageRaster
): void {
  requireNonNegativeInteger("activeCaptureRect.x", rect.x);
  requireNonNegativeInteger("activeCaptureRect.y", rect.y);
  requirePositiveInteger("activeCaptureRect.width", rect.width);
  requirePositiveInteger("activeCaptureRect.height", rect.height);

  if (
    rect.x + rect.width > raster.pixelWidth ||
    rect.y + rect.height > raster.pixelHeight
  ) {
    throw new InvalidScientificInputError(
      "activeCaptureRect must fit entirely within nativeRaster."
    );
  }
}

function validateShutterMechanism(
  value: unknown
): asserts value is CaptureShutterMechanism {
  if (
    typeof value !== "string" ||
    !SHUTTER_MECHANISMS.has(value as CaptureShutterMechanism)
  ) {
    throw new InvalidConfigurationError("shutterMechanism is invalid.");
  }
}

function validatePointWithinActiveCapture(
  point: RasterPoint,
  rect: RasterRect,
  index: number
): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new InvalidScientificInputError(
      "samplePointsNative[" + index + "] coordinates must be finite."
    );
  }

  if (
    point.x < rect.x ||
    point.x > rect.x + rect.width ||
    point.y < rect.y ||
    point.y > rect.y + rect.height
  ) {
    throw new InvalidScientificInputError(
      "samplePointsNative[" +
        index +
        "] must lie within activeCaptureRect edge-coordinate bounds."
    );
  }
}

/**
 * Resolves the sensor readout scan schedule for one capture.
 *
 * Rolling readout is modelled as a uniform linear scan along one axis of the
 * declared active capture. The caller supplies the scan's time span (skew)
 * explicitly. It is never worked out from the total data-readout time, crop
 * size, pixel density, output resolution, sensor-architecture metadata or the
 * shutter mechanism.
 *
 * Global readout has no skew in this model, even when a non-zero data-readout
 * time is declared.
 *
 * Not covered: local exposure start and end times, mechanical curtain travel,
 * EFCS (electronic first-curtain shutter) behaviour, rolling-shutter image
 * distortion, flash or flicker, and motion integration.
 */
export function calculateSensorReadoutTiming(
  input: CalculateSensorReadoutTimingInput
): CalculationResult<SensorReadoutTiming> {
  requireInputKeys(input, "calculateSensorReadoutTiming", ["nativeRaster", "activeCaptureRect", "shutterMechanism", "readout", "samplePointsNative"]);
  validateNativeRaster(input.nativeRaster);
  validateShutterMechanism(input.shutterMechanism);

  const readout = parseReadoutDeclaration(input.readout);
  const activeCaptureRect =
    input.activeCaptureRect ?? fullRect(input.nativeRaster);
  validateActiveCaptureRect(activeCaptureRect, input.nativeRaster);

  if (
    input.samplePointsNative !== undefined &&
    !Array.isArray(input.samplePointsNative)
  ) {
    throw new InvalidConfigurationError(
      "samplePointsNative must be an array when supplied."
    );
  }

  const scan =
    readout.readoutMode === "rolling"
      ? {
          pattern: "uniform-linear-single-axis" as const,
          directionNative: readout.scanDirectionNative,
          unitVectorNative: scanVector(readout.scanDirectionNative.value),
          spatialSamplingSkewSeconds: readout.spatialSamplingSkewSeconds
        }
      : null;

  const samples = (input.samplePointsNative ?? []).map((point, index) => {
    validatePointWithinActiveCapture(point, activeCaptureRect, index);

    if (scan === null) {
      return {
        pointNative: { x: point.x, y: point.y },
        normalizedScanPosition: null,
        readoutPhaseOffsetSeconds: 0
      };
    }

    const normalized = normalizedScanPosition(
      point,
      activeCaptureRect,
      scan.directionNative.value
    );

    return {
      pointNative: { x: point.x, y: point.y },
      normalizedScanPosition: normalized,
      readoutPhaseOffsetSeconds:
        normalized * scan.spatialSamplingSkewSeconds.value
    };
  });

  return approximationResult(
    {
      readoutMode: readout.readoutMode,
      shutterMechanism: input.shutterMechanism,
      nativeRaster: { ...input.nativeRaster },
      activeCaptureRect: { ...activeCaptureRect },
      captureReadoutDurationSeconds:
        readout.captureReadoutDurationSeconds,
      maximumSpatialSamplingSkewSeconds:
        readout.readoutMode === "rolling"
          ? readout.spatialSamplingSkewSeconds.value
          : 0,
      scan,
      samples
    },
    "native-sensor-readout-scan-timing",
    "1.0.0",
    [
      "Native raster coordinates use top-left origin, +X right and +Y down and remain invariant under physical camera orientation.",
      "Rolling timing uses a uniform-linear single-axis approximation over continuous effective native-raster coordinates.",
      "NativeImageRaster is an effective image-sampling grid; the timing map does not assert one raster row or column equals one physical photodiode or hardware readout line.",
      "Capture data-readout duration and spatial sampling skew are independently declared facts; no equality or ordering relationship is inferred between them.",
      "Global readout has zero spatial sampling skew in this model even when capture data-readout duration is non-zero.",
      "Active-capture timing is caller-declared and is not inferred by scaling full-frame timing by crop dimensions.",
      "Physical orientation and digital output crop/resolution are downstream of this invariant native timing schedule.",
      "Shutter mechanism is reported independently and does not alter the sensor scan schedule in this foundation.",
      "The model does not represent segmented, center-out, interleaved, multi-tap or other non-uniform readout patterns.",
      "The model does not define exposure windows, shutter-curtain travel, rolling-shutter geometry distortion, flash/flicker interaction or camera/subject motion integration."
    ]
  );
}
