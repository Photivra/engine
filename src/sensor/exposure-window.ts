// SPDX-License-Identifier: Apache-2.0

/**
 * Exposure windows: when each point on the sensor starts and stops collecting light.
 *
 * The shutter has an opening boundary and a closing boundary, each with its own schedule. With a
 * rolling or curtain shutter the boundaries sweep across the sensor, so each point has its own
 * (local) window. Times are seconds from the first opening boundary. That is deliberately not the
 * same as the camera-rotation API's global "exposure start"; a later layer must link the two
 * explicitly.
 *
 * The mechanism records whether each boundary is mechanical or electronic, but supplies no sweep
 * duration or direction. Every timing value and direction for a non-simultaneous boundary is declared
 * by the caller, with evidence. Only simultaneous boundaries and a uniform linear sweep along one
 * native sensor axis are supported. Not modelled: curtain acceleration, segmented or non-linear
 * electronic schedules, flash or flicker, rolling-shutter image distortion, shutter shock, and
 * EFCS (electronic first-curtain shutter) effects on the pupil or bokeh.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  parseEvidenceList,
  type EvidenceBackedFact
} from "../core/evidence-provenance.js";
import {
  InvalidScientificInputError,
  requirePositiveInteger
} from "../core/validation.js";
import type {
  RasterPoint,
  RasterRect,
  RasterVector
} from "../output/capture-geometry.js";
import type { NativeImageRaster } from "./sensor-geometry.js";
import type {
  CaptureShutterMechanism,
  NativeSensorReadoutScanDirection,
  SourcedSensorTimingSeconds
} from "./readout-timing.js";
import { requireInputObject, requireInputKeys, requireConfigRecord as requireRecord } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { fullRect } from "../core/shared-helpers.js";

export type CaptureExposureBoundaryActuator = "mechanical" | "electronic";

export type SourcedCaptureTimingSeconds = SourcedSensorTimingSeconds;

export type SourcedCaptureBoundaryDirection =
  EvidenceBackedFact<NativeSensorReadoutScanDirection>;

export interface SimultaneousExposureBoundarySchedule {
  kind: "simultaneous";
  directionNative?: never;
  traversalDurationSeconds?: never;
}

export interface UniformLinearExposureBoundarySchedule {
  kind: "uniform-linear-native-scan";
  directionNative: SourcedCaptureBoundaryDirection;
  traversalDurationSeconds: SourcedCaptureTimingSeconds;
}

export type ExposureBoundarySchedule =
  | SimultaneousExposureBoundarySchedule
  | UniformLinearExposureBoundarySchedule;

export interface CalculateCaptureExposureWindowsInput {
  nativeRaster: NativeImageRaster;
  /**
   * Active capture rectangle, in fixed native pixel coordinates.
   *
   * Defaults to the whole native image. Sweep timing is never worked out by
   * scaling a full-frame timing value to this rectangle.
   */
  activeCaptureRect?: RasterRect;
  shutterMechanism: CaptureShutterMechanism;
  /**
   * Nominal time between the opening and closing reference points (phase zero).
   *
   * A point's local exposure can differ from this when the opening and closing
   * boundaries sweep differently across the sensor.
   */
  nominalExposureDurationSeconds: SourcedCaptureTimingSeconds;
  opening: ExposureBoundarySchedule;
  closing: ExposureBoundarySchedule;
  /**
   * Optional points, in continuous native pixel coordinates measured from pixel
   * edges, to report windows for. A pixel centre is at +0.5.
   */
  samplePointsNative?: readonly RasterPoint[];
}

export interface ResolvedCaptureExposureBoundary {
  actuator: CaptureExposureBoundaryActuator;
  schedule:
    | {
        kind: "simultaneous";
      }
    | {
        kind: "uniform-linear-native-scan";
        directionNative: SourcedCaptureBoundaryDirection;
        unitVectorNative: RasterVector;
        traversalDurationSeconds: SourcedCaptureTimingSeconds;
      };
}

export interface CaptureExposureWindowSample {
  pointNative: RasterPoint;
  openingNormalizedScanPosition: number | null;
  closingNormalizedScanPosition: number | null;
  /**
   * Seconds from the first opening boundary.
   */
  startOffsetSecondsFromOpeningReference: number;
  /**
   * Seconds from the first opening boundary.
   */
  endOffsetSecondsFromOpeningReference: number;
  localExposureDurationSeconds: number;
}

export interface CaptureExposureWindows {
  shutterMechanism: CaptureShutterMechanism;
  timeReference: "first-opening-boundary-phase";
  nativeRaster: NativeImageRaster;
  activeCaptureRect: RasterRect;
  nominalExposureDurationSeconds: SourcedCaptureTimingSeconds;
  opening: ResolvedCaptureExposureBoundary;
  closing: ResolvedCaptureExposureBoundary;
  localExposureDurationRangeSeconds: {
    minimum: number;
    maximum: number;
  };
  samples: readonly CaptureExposureWindowSample[];
}

const SHUTTER_MECHANISMS = new Set<CaptureShutterMechanism>([
  "mechanical",
  "electronic-first-curtain",
  "electronic"
]);

const SCAN_DIRECTIONS = new Set<NativeSensorReadoutScanDirection>([
  "top-to-bottom",
  "bottom-to-top",
  "left-to-right",
  "right-to-left"
]);

const BOUNDARY_KINDS = new Set<ExposureBoundarySchedule["kind"]>([
  "simultaneous",
  "uniform-linear-native-scan"
]);

export function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidScientificInputError(
      name + " must be a non-negative safe integer."
    );
  }
}

export function requirePositiveFinite(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new InvalidScientificInputError(
      name + " must be a finite number greater than zero."
    );
  }
  return value;
}

/** Parses a sourced duration in seconds (`{ unit: "s", value, evidence }`). Not a root export. */
export function parseSecondsFact(
  value: unknown,
  path: string
): SourcedCaptureTimingSeconds {
  const record = requireRecord(value, path, ["unit", "value", "evidence"]);
  if (record.unit !== "s") {
    throw new InvalidConfigurationError(path + '.unit must be "s".');
  }

  return {
    value: requirePositiveFinite(path + ".value", record.value),
    unit: "s",
    evidence: parseEvidenceList(record.evidence, path + ".evidence")
  };
}

function parseDirectionFact(
  value: unknown,
  path: string
): SourcedCaptureBoundaryDirection {
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

/** Parses one exposure boundary schedule (opening or closing). Not a root export. */
export function parseBoundarySchedule(
  value: unknown,
  path: string
): ExposureBoundarySchedule {
  // unitVectorNative is the derived field of a resolved schedule; it may be passed back if it matches.
  const record = requireRecord(value, path, ["kind", "directionNative", "traversalDurationSeconds", "unitVectorNative"]);
  if (
    typeof record.kind !== "string" ||
    !BOUNDARY_KINDS.has(record.kind as ExposureBoundarySchedule["kind"])
  ) {
    throw new InvalidConfigurationError(path + ".kind is invalid.");
  }

  if (record.kind === "simultaneous") {
    if (record.directionNative !== undefined) {
      throw new InvalidScientificInputError(
        path + ".directionNative must be omitted for a simultaneous boundary."
      );
    }
    if (record.traversalDurationSeconds !== undefined) {
      throw new InvalidScientificInputError(
        path +
          ".traversalDurationSeconds must be omitted for a simultaneous boundary."
      );
    }
    if (record.unitVectorNative !== undefined) {
      throw new InvalidScientificInputError(
        path + ".unitVectorNative must be omitted for a simultaneous boundary."
      );
    }

    return { kind: "simultaneous" };
  }

  const directionNative = parseDirectionFact(
    record.directionNative,
    path + ".directionNative"
  );
  if (record.unitVectorNative !== undefined) {
    const supplied = requireRecord(record.unitVectorNative, path + ".unitVectorNative", ["x", "y"]);
    const derived = scanVector(directionNative.value);
    if (supplied.x !== derived.x || supplied.y !== derived.y) {
      throw new InvalidConfigurationError(path + ".unitVectorNative must match directionNative.");
    }
  }
  return {
    kind: "uniform-linear-native-scan",
    directionNative,
    traversalDurationSeconds: parseSecondsFact(
      record.traversalDurationSeconds,
      path + ".traversalDurationSeconds"
    )
  };
}

export function validateNativeRaster(raster: NativeImageRaster): void {
  requireInputObject(raster, "raster input");
  requirePositiveInteger("nativeRaster.pixelWidth", raster.pixelWidth);
  requirePositiveInteger("nativeRaster.pixelHeight", raster.pixelHeight);
}

export function validateActiveCaptureRect(
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

export function validateShutterMechanism(
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
  path: string
): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new InvalidScientificInputError(
      path + " coordinates must be finite."
    );
  }

  if (
    point.x < rect.x ||
    point.x > rect.x + rect.width ||
    point.y < rect.y ||
    point.y > rect.y + rect.height
  ) {
    throw new InvalidScientificInputError(
      path + " must lie within activeCaptureRect edge-coordinate bounds."
    );
  }
}

export function scanVector(
  direction: NativeSensorReadoutScanDirection
): RasterVector {
  switch (direction) {
    case "top-to-bottom":
      return { x: 0, y: 1 };
    case "bottom-to-top":
      return { x: 0, y: -1 };
    case "left-to-right":
      return { x: 1, y: 0 };
    case "right-to-left":
      return { x: -1, y: 0 };
  }
}

export function normalizedScanPosition(
  point: RasterPoint,
  rect: RasterRect,
  direction: NativeSensorReadoutScanDirection
): number {
  switch (direction) {
    case "top-to-bottom":
      return (point.y - rect.y) / rect.height;
    case "bottom-to-top":
      return 1 - (point.y - rect.y) / rect.height;
    case "left-to-right":
      return (point.x - rect.x) / rect.width;
    case "right-to-left":
      return 1 - (point.x - rect.x) / rect.width;
  }
}

function boundaryPhase(
  point: RasterPoint,
  rect: RasterRect,
  schedule: ExposureBoundarySchedule
): {
  normalizedScanPosition: number | null;
  phaseOffsetSeconds: number;
} {
  if (schedule.kind === "simultaneous") {
    return {
      normalizedScanPosition: null,
      phaseOffsetSeconds: 0
    };
  }

  const normalized = normalizedScanPosition(
    point,
    rect,
    schedule.directionNative.value
  );

  return {
    normalizedScanPosition: normalized,
    phaseOffsetSeconds:
      normalized * schedule.traversalDurationSeconds.value
  };
}

function resolveBoundaryActuators(
  mechanism: CaptureShutterMechanism
): {
  opening: CaptureExposureBoundaryActuator;
  closing: CaptureExposureBoundaryActuator;
} {
  switch (mechanism) {
    case "mechanical":
      return {
        opening: "mechanical",
        closing: "mechanical"
      };
    case "electronic-first-curtain":
      return {
        opening: "electronic",
        closing: "mechanical"
      };
    case "electronic":
      return {
        opening: "electronic",
        closing: "electronic"
      };
  }
}

function resolveBoundary(
  actuator: CaptureExposureBoundaryActuator,
  schedule: ExposureBoundarySchedule
): ResolvedCaptureExposureBoundary {
  if (schedule.kind === "simultaneous") {
    return {
      actuator,
      schedule: {
        kind: "simultaneous"
      }
    };
  }

  return {
    actuator,
    schedule: {
      kind: "uniform-linear-native-scan",
      directionNative: schedule.directionNative,
      unitVectorNative: scanVector(schedule.directionNative.value),
      traversalDurationSeconds: schedule.traversalDurationSeconds
    }
  };
}

function createWindowSample(
  point: RasterPoint,
  rect: RasterRect,
  opening: ExposureBoundarySchedule,
  closing: ExposureBoundarySchedule,
  nominalExposureDurationSeconds: number
): CaptureExposureWindowSample {
  const openingPhase = boundaryPhase(point, rect, opening);
  const closingPhase = boundaryPhase(point, rect, closing);
  const startOffsetSecondsFromOpeningReference =
    openingPhase.phaseOffsetSeconds;
  const endOffsetSecondsFromOpeningReference =
    nominalExposureDurationSeconds + closingPhase.phaseOffsetSeconds;
  const localExposureDurationSeconds =
    endOffsetSecondsFromOpeningReference -
    startOffsetSecondsFromOpeningReference;

  return {
    pointNative: { ...point },
    openingNormalizedScanPosition:
      openingPhase.normalizedScanPosition,
    closingNormalizedScanPosition:
      closingPhase.normalizedScanPosition,
    startOffsetSecondsFromOpeningReference,
    endOffsetSecondsFromOpeningReference,
    localExposureDurationSeconds
  };
}

function activeRectCorners(rect: RasterRect): readonly RasterPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    {
      x: rect.x + rect.width,
      y: rect.y + rect.height
    }
  ];
}

/**
 * Works out each point's local exposure window from separate opening and
 * closing boundary schedules.
 *
 * Times are seconds from the first opening boundary. This is deliberately not
 * the camera-rotation API's global "exposure start"; a later layer must link the
 * two explicitly.
 *
 * The mechanism records whether each boundary is mechanical or electronic, but
 * supplies no sweep duration or direction. Every timing value and direction for
 * a non-simultaneous boundary is declared by the caller, with evidence.
 *
 * Only simultaneous boundaries and a uniform linear sweep along one native
 * sensor axis are supported. Not modelled: curtain acceleration, segmented or
 * non-linear electronic schedules, flash or flicker, rolling-shutter image
 * distortion, shutter shock, and EFCS (electronic first-curtain shutter)
 * effects on the pupil or bokeh.
 */
export function calculateCaptureExposureWindows(
  input: CalculateCaptureExposureWindowsInput
): CalculationResult<CaptureExposureWindows> {
  requireInputKeys(input, "calculateCaptureExposureWindows", ["nativeRaster", "activeCaptureRect", "shutterMechanism", "nominalExposureDurationSeconds", "opening", "closing", "samplePointsNative"]);
  validateNativeRaster(input.nativeRaster);
  validateShutterMechanism(input.shutterMechanism);

  const nominalExposureDurationSeconds = parseSecondsFact(
    input.nominalExposureDurationSeconds,
    "nominalExposureDurationSeconds"
  );
  const opening = parseBoundarySchedule(input.opening, "opening");
  const closing = parseBoundarySchedule(input.closing, "closing");

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

  const cornerSamples = activeRectCorners(activeCaptureRect).map(
    (point) =>
      createWindowSample(
        point,
        activeCaptureRect,
        opening,
        closing,
        nominalExposureDurationSeconds.value
      )
  );

  const localDurations = cornerSamples.map(
    (sample) => sample.localExposureDurationSeconds
  );
  const minimumLocalExposureDurationSeconds = Math.min(...localDurations);
  const maximumLocalExposureDurationSeconds = Math.max(...localDurations);

  if (
    !Number.isFinite(minimumLocalExposureDurationSeconds) ||
    minimumLocalExposureDurationSeconds <= 0
  ) {
    throw new InvalidScientificInputError(
      "The declared opening/closing schedules produce a zero or negative local exposure duration somewhere within activeCaptureRect."
    );
  }

  const samples = (input.samplePointsNative ?? []).map((point, index) => {
    validatePointWithinActiveCapture(
      point,
      activeCaptureRect,
      "samplePointsNative[" + index + "]"
    );

    return createWindowSample(
      point,
      activeCaptureRect,
      opening,
      closing,
      nominalExposureDurationSeconds.value
    );
  });

  const actuators = resolveBoundaryActuators(input.shutterMechanism);

  return approximationResult(
    {
      shutterMechanism: input.shutterMechanism,
      timeReference: "first-opening-boundary-phase",
      nativeRaster: { ...input.nativeRaster },
      activeCaptureRect: { ...activeCaptureRect },
      nominalExposureDurationSeconds,
      opening: resolveBoundary(actuators.opening, opening),
      closing: resolveBoundary(actuators.closing, closing),
      localExposureDurationRangeSeconds: {
        minimum: minimumLocalExposureDurationSeconds,
        maximum: maximumLocalExposureDurationSeconds
      },
      samples
    },
    "capture-exposure-window-schedule",
    "1.0.0",
    [
      "Time is reported in seconds from the first opening-boundary phase, not from a universal local exposure-start event.",
      "Nominal exposure duration, opening traversal, and closing traversal are independent declared quantities.",
      "Mechanical, electronic-first-curtain, and electronic mechanisms determine boundary actuator categories only; they do not supply timing or direction.",
      "Uniform-linear scan boundaries are an explicit approximation over continuous effective native-raster coordinates and do not assert one raster row/column equals one physical curtain line, photodiode row, or hardware readout line.",
      "Opening and closing directions and traversal durations are independent and may produce spatially varying local exposure duration.",
      "The complete active rectangle is validated using the extrema of the affine boundary schedules, so unsampled invalid corners cannot pass.",
      "Active-capture timing is caller-declared and is not inferred by scaling full-frame timing from crop dimensions.",
      "Physical camera orientation and digital output crop/resolution remain downstream of the invariant native timing schedule.",
      "Sensor readout timing remains a separate contract; this model does not automatically equate a sensor readout phase with an exposure boundary.",
      "This model does not include curtain acceleration, segmented/nonlinear electronic timing, rolling-shutter image distortion, motion integration, flash/flicker interaction, shutter shock, or EFCS-specific pupil/bokeh behavior."
    ]
  );
}

/**
 * Internal, for the faster ("lean") native environment executor (a 2.0 performance change). It checks a
 * schedule once with every check of calculateCaptureExposureWindows, then returns a per-point sampler that
 * uses the same point validation and the same createWindowSample arithmetic. So each sampled window is
 * identical to what calculateCaptureExposureWindows returns for that point. Not exported from the package.
 */
export function prepareCaptureExposureWindowSampler(
  input: Omit<CalculateCaptureExposureWindowsInput, "samplePointsNative">
): (point: RasterPoint) => CaptureExposureWindowSample {
  const admitted = calculateCaptureExposureWindows({ ...input, samplePointsNative: [] }).value;
  const rect = { ...admitted.activeCaptureRect };
  const opening = parseBoundarySchedule(input.opening, "opening");
  const closing = parseBoundarySchedule(input.closing, "closing");
  const nominal = admitted.nominalExposureDurationSeconds.value;
  return (point) => {
    validatePointWithinActiveCapture(point, rect, "samplePointsNative[0]");
    return createWindowSample(point, rect, opening, closing, nominal);
  };
}
