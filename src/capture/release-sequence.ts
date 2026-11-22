// SPDX-License-Identifier: Apache-2.0

/**
 * Shutter-release sequences for stills (single, burst, self-timer, bracketing), scheduled as logical exposures, and
 * cancelling a sequence part-way.
 *
 * This only schedules exposures; how the sensor captures each one is handled elsewhere. Render speed
 * or frame rate is never used as capture timing.
 * @see docs/SIMULATED_CAPTURE.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { InvalidScientificInputError } from "../core/validation.js";
import {
  MAXIMUM_LOGICAL_FRAMES_PER_SEQUENCE,
  parseGenericReleaseCapabilityProfile,
  type GenericExposureBracketAxis,
  type GenericReleaseCapabilityProfile
} from "../equipment/release-capabilities.js";
import type {
  ResolvedGenericEquipmentExposureCapabilities,
  ResolvedNumericSettingGrid
} from "../equipment/exposure-capabilities.js";
import {
  parseFocusPlane,
  type FocusPlane
} from "../optics/focus-state.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { rejectUnknownFields, rejectUnknownVariantFields, requireInputObject, requireInputKeys, requireTrimmedConfigString as requireNonEmptyString, requireInputFinite as requireFinite, requireInputFiniteAboveZero as requirePositiveFinite, requireInputFiniteAtLeastZero as requireNonNegativeFinite } from "../core/record-validation.js";
import { deepFreeze, cloneJson } from "../core/shared-helpers.js";

export const RELEASE_SEQUENCE_VERSION =
  "0.1.0" as const;

export type ReleaseAutomationState =
  | "manual"
  | "locked"
  | "continuous";

export interface ReleaseBaseCaptureState {
  exposure: {
    aperture: number;
    shutterSeconds: number;
    iso: number;
  };
  focus: FocusPlane;
  whiteBalanceStateId?: string;
  automation: {
    ae: ReleaseAutomationState;
    af: ReleaseAutomationState;
    awb: ReleaseAutomationState;
  };
}

export type ReleaseDrivePolicy =
  | {
      kind: "single";
    }
  | {
      kind: "burst";
      frameCount: number;
    }
  | {
      kind: "self-timer";
      delaySeconds: number;
      frameCount: number;
    };

export type ReleaseBracketPolicy =
  | {
      kind: "none";
    }
  | {
      kind: "exposure";
      axis:
        GenericExposureBracketAxis;
      offsetsStops:
        readonly number[];
    }
  | {
      kind: "focus";
      focusStates:
        readonly FocusPlane[];
    };

export interface ResolveReleaseSequenceInput {
  sequenceId: string;
  releaseRequestTimeSeconds: number;
  sequenceSeedUint32: number;
  drive: ReleaseDrivePolicy;
  bracket: ReleaseBracketPolicy;
  requestedCadenceFps?: number;
  baseState:
    ReleaseBaseCaptureState;
  releaseCapabilities:
    GenericReleaseCapabilityProfile;
  exposureCapabilities:
    ResolvedGenericEquipmentExposureCapabilities;
}

export type ReleaseTimingConstraint =
  | "requested-cadence"
  | "body-maximum-cadence"
  | "exposure-duration"
  | "minimum-inter-frame-gap";

export interface ResolvedReleaseFrame {
  sequenceId: string;
  frameIndex: number;
  releaseFrameId: string;
  exposureStartTimeSeconds: number;
  exposureEndTimeSeconds: number;
  sceneTimeSecondsFromSequenceStart:
    number;
  startIntervalFromPreviousSeconds:
    number | null;
  timingConstraints:
    readonly ReleaseTimingConstraint[];
  stochasticSeedUint32: number;
  exposure: {
    aperture: number;
    shutterSeconds: number;
    iso: number;
  };
  focus: FocusPlane;
  exposureBracketOffsetStops?:
    number;
  /**
   * #680: the offset the frame's setting realizes, present only when the exact setting `base × 2^offset` was not on a
   * discrete setting grid and the nearest grid value (within 1/12 stop) was taken instead: log₂(setting ÷ base) for
   * shutter and ISO, 2·log₂(base ÷ setting) for the f-number.
   */
  exposureBracketRealizedOffsetStops?:
    number;
  automation:
    ReleaseBaseCaptureState["automation"];
  whiteBalanceStateId?: string;
}

export interface ResolvedReleaseSequence {
  version:
    typeof RELEASE_SEQUENCE_VERSION;
  sequenceId: string;
  status: "scheduled";
  releaseRequestTimeSeconds: number;
  selfTimerDelaySeconds: number;
  requestedCadenceFps:
    number | null;
  capabilityMaximumCadenceFps:
    number;
  minimumInterFrameGapSeconds:
    number;
  requestedFrameCount: number;
  actualFrameCount: number;
  sequenceSeedUint32: number;
  baseStateSnapshot:
    ReleaseBaseCaptureState;
  frames:
    readonly ResolvedReleaseFrame[];
  sensorCaptureModeOwnership:
    "separate-logical-capture-contract";
  whiteBalanceBracketingPhysicalCaptures:
    false;
  preReleaseCaptureModeled:
    false;
  bufferMediaThermalSlowdownModeled:
    false;
}

export interface CancelReleaseSequenceInput {
  sequence:
    ResolvedReleaseSequence;
  completedFrameCount: number;
  cancelledAtSeconds: number;
}

export interface CancelledReleaseSequence {
  version:
    typeof RELEASE_SEQUENCE_VERSION;
  sequenceId: string;
  status: "cancelled";
  cancelledAtSeconds: number;
  completedFrameCount: number;
  omittedFrameCount: number;
  completedFrames:
    readonly ResolvedReleaseFrame[];
  sourceSequenceFrameCount: number;
  sourceSequenceUnmodified: true;
}

function requirePositiveSafeInteger(
  value: number,
  path: string
): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new InvalidScientificInputError(
      path +
        " must be a positive safe integer."
    );
  }
  return value;
}

function requireUint32(
  value: number,
  path: string
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0xffff_ffff
  ) {
    throw new InvalidScientificInputError(
      path +
        " must be an unsigned 32-bit integer."
    );
  }
  return value;
}

function hashFrameSeed(
  sequenceSeedUint32: number,
  frameIndex: number
): number {
  let hash = 0x811c9dc5;
  const text =
    sequenceSeedUint32.toString(10) +
    ":" +
    frameIndex.toString(10);
  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(
      hash,
      0x01000193
    ) >>> 0;
  }
  return hash >>> 0;
}

function includesDriveMode(
  capabilities:
    GenericReleaseCapabilityProfile,
  drive:
    ReleaseDrivePolicy["kind"]
): boolean {
  return capabilities
    .supportedDriveModes
    .value.includes(drive);
}

function driveFrameCount(
  drive: ReleaseDrivePolicy
): number {
  if (drive.kind === "single") {
    return 1;
  }
  return requirePositiveSafeInteger(
    drive.frameCount,
    "drive.frameCount"
  );
}

function bracketFrameCount(
  bracket:
    ReleaseBracketPolicy
): number | null {
  if (bracket.kind === "none") {
    return null;
  }
  const count =
    bracket.kind === "exposure"
      ? bracket.offsetsStops.length
      : bracket.focusStates.length;
  if (count <= 0) {
    throw new InvalidScientificInputError(
      "Bracket sequences must contain at least one frame."
    );
  }
  return count;
}

function resolveFrameCount(
  drive: ReleaseDrivePolicy,
  bracket:
    ReleaseBracketPolicy
): number {
  const driveCount =
    driveFrameCount(drive);
  const bracketCount =
    bracketFrameCount(bracket);
  if (Math.max(driveCount, bracketCount ?? 0) > MAXIMUM_LOGICAL_FRAMES_PER_SEQUENCE) {
    throw new InvalidScientificInputError(
      "A release sequence holds at most " + MAXIMUM_LOGICAL_FRAMES_PER_SEQUENCE + " frames (an engine limit)."
    );
  }

  if (bracketCount === null) {
    return driveCount;
  }

  if (drive.kind === "burst") {
    throw new InvalidScientificInputError(
      "Schema 0.1.0 does not combine burst drive with bracketing; choose one multi-frame policy explicitly."
    );
  }

  if (
    drive.kind === "self-timer" &&
    driveCount !== bracketCount
  ) {
    throw new InvalidScientificInputError(
      "Self-timer frameCount must match the bracket frame count."
    );
  }

  return bracketCount;
}

/** True when `value` is on a discrete grid (within 1e-12 relative) or the grid is continuous. */
function onGrid(
  value: number,
  grid:
    ResolvedNumericSettingGrid
): boolean {
  return grid.kind !==
    "discrete-values" ||
    grid.values.some(
      (candidate) =>
        Math.abs(
          candidate - value
        ) <=
        Math.max(
          1,
          Math.abs(value)
        ) *
          1e-12
    );
}

/** #680 (owner decision 2026-11-21): the largest distance, in stops, from an exact bracket setting to the grid value taken. */
const BRACKET_GRID_SNAP_STOPS = 1 / 12;

/**
 * #680: a bracketed setting not on its discrete grid becomes the grid value nearest in log₂ when that lies within
 * BRACKET_GRID_SNAP_STOPS (`stopsPerLog2` is 1 for shutter and ISO, 2 for the f-number); otherwise it is returned
 * unchanged, and the grid check refuses it as before.
 */
function snapToGrid(
  value: number,
  grid:
    ResolvedNumericSettingGrid,
  stopsPerLog2: number
): number {
  if (
    grid.kind !==
      "discrete-values" ||
    !(value > 0) ||
    onGrid(value, grid)
  ) {
    return value;
  }
  let best = value,
    distance = Infinity;
  for (const candidate of grid.values) {
    const stops =
      Math.abs(
        Math.log2(
          candidate / value
        )
      ) * stopsPerLog2;
    if (stops < distance) {
      distance = stops;
      best = candidate;
    }
  }
  return distance <=
    BRACKET_GRID_SNAP_STOPS
    ? best
    : value;
}

function validateGridSetting(
  value: number,
  minimum: number,
  maximum: number,
  grid:
    ResolvedNumericSettingGrid,
  path: string
): void {
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new InvalidScientificInputError(
      path +
        " lies outside the resolved equipment capability range."
    );
  }

  if (!onGrid(value, grid)) {
    throw new InvalidScientificInputError(
      path +
        " is not present in the resolved equipment setting grid."
    );
  }
}

function validateExposure(
  exposure:
    ReleaseBaseCaptureState["exposure"],
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities,
  path: string
): void {
  validateGridSetting(
    exposure.aperture,
    capabilities.aperture
      .widestAvailableFNumber,
    capabilities.aperture
      .narrowestAvailableFNumber,
    capabilities.aperture
      .settingGrid,
    path + ".aperture"
  );
  validateGridSetting(
    exposure.shutterSeconds,
    capabilities.shutter
      .minimumSeconds,
    capabilities.shutter
      .maximumSeconds,
    capabilities.shutter
      .settingGrid,
    path + ".shutterSeconds"
  );
  validateGridSetting(
    exposure.iso,
    capabilities.iso.minimum,
    capabilities.iso.maximum,
    capabilities.iso.settingGrid,
    path + ".iso"
  );
}

function resolveExposureBracket(
  base:
    ReleaseBaseCaptureState["exposure"],
  axis:
    GenericExposureBracketAxis,
  offsetStops: number
): ReleaseBaseCaptureState["exposure"] {
  requireFinite(
    offsetStops,
    "bracket.offsetsStops[]"
  );

  if (axis === "shutter") {
    return {
      ...base,
      shutterSeconds:
        base.shutterSeconds *
        Math.pow(2, offsetStops)
    };
  }
  if (axis === "iso") {
    return {
      ...base,
      iso:
        base.iso *
        Math.pow(2, offsetStops)
    };
  }
  return {
    ...base,
    aperture:
      base.aperture /
      Math.pow(
        2,
        offsetStops / 2
      )
  };
}

function resolveFrameState(
  input:
    ResolveReleaseSequenceInput,
  frameIndex: number
): {
  exposure:
    ReleaseBaseCaptureState["exposure"];
  focus: FocusPlane;
  exposureBracketOffsetStops?:
    number;
  exposureBracketRealizedOffsetStops?:
    number;
} {
  if (input.bracket.kind === "none") {
    return {
      exposure:
        cloneJson(
          input.baseState.exposure
        ),
      focus:
        parseFocusPlane(
          input.baseState.focus
        )
    };
  }

  if (
    input.bracket.kind ===
    "exposure"
  ) {
    const offset =
      input.bracket
        .offsetsStops[
          frameIndex
        ];
    if (offset === undefined) {
      throw new InvalidScientificInputError(
        "Exposure bracket frame index is out of range."
      );
    }
    return {
      exposure:
        resolveExposureBracket(
          input.baseState.exposure,
          input.bracket.axis,
          offset
        ),
      focus:
        parseFocusPlane(
          input.baseState.focus
        ),
      exposureBracketOffsetStops:
        offset
    };
  }

  const focus =
    input.bracket
      .focusStates[frameIndex];
  if (focus === undefined) {
    throw new InvalidScientificInputError(
      "Focus bracket frame index is out of range."
    );
  }
  return {
    exposure:
      cloneJson(
        input.baseState.exposure
      ),
    focus:
      parseFocusPlane(focus)
  };
}

/** #680: the bracketed axis's setting on a discrete grid, with its realized offset when it moved (see snapToGrid). */
function snapBracketedSetting(
  state: {
    exposure:
      ReleaseBaseCaptureState["exposure"];
    exposureBracketRealizedOffsetStops?:
      number;
  },
  base:
    ReleaseBaseCaptureState["exposure"],
  axis:
    GenericExposureBracketAxis,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): void {
  const exposure = state.exposure;
  if (axis === "aperture") {
    const value = snapToGrid(exposure.aperture, capabilities.aperture.settingGrid, 2);
    if (value !== exposure.aperture) { exposure.aperture = value; state.exposureBracketRealizedOffsetStops = 2 * Math.log2(base.aperture / value); }
  } else {
    const key = axis === "iso" ? "iso" : "shutterSeconds",
      value = snapToGrid(exposure[key], (axis === "iso" ? capabilities.iso : capabilities.shutter).settingGrid, 1);
    if (value !== exposure[key]) { exposure[key] = value; state.exposureBracketRealizedOffsetStops = Math.log2(value / base[key]); }
  }
}

function validateBracketSupport(
  input:
    ResolveReleaseSequenceInput,
  capabilities:
    GenericReleaseCapabilityProfile
): void {
  if (
    input.bracket.kind ===
    "exposure"
  ) {
    if (
      capabilities
        .exposureBracketing
        .availability.value !==
      "supported"
    ) {
      throw new InvalidScientificInputError(
        "Exposure bracketing is not supported by the selected release capability profile."
      );
    }
    if (
      !capabilities
        .exposureBracketing
        .supportedAxes
        .includes(
          input.bracket.axis
        )
    ) {
      throw new InvalidScientificInputError(
        "The selected exposure-bracket axis is not supported by the release capability profile."
      );
    }
  }

  if (
    input.bracket.kind ===
      "focus" &&
    capabilities
      .focusBracketing
      .availability.value !==
      "supported"
  ) {
    throw new InvalidScientificInputError(
      "Focus bracketing is not supported by the selected release capability profile."
    );
  }
}

function resolveSelfTimerDelay(
  drive: ReleaseDrivePolicy
): number {
  if (drive.kind !== "self-timer") {
    return 0;
  }
  return requireNonNegativeFinite(
    drive.delaySeconds,
    "drive.delaySeconds"
  );
}

function resolveRequestedCadence(
  frameCount: number,
  requestedCadenceFps:
    number | undefined
): number | null {
  if (frameCount <= 1) {
    if (
      requestedCadenceFps !==
      undefined
    ) {
      requirePositiveFinite(
        requestedCadenceFps,
        "requestedCadenceFps"
      );
    }
    return null;
  }
  if (
    requestedCadenceFps ===
    undefined
  ) {
    throw new InvalidScientificInputError(
      "requestedCadenceFps is required for a multi-frame physical sequence."
    );
  }
  return requirePositiveFinite(
    requestedCadenceFps,
    "requestedCadenceFps"
  );
}

function intervalForPreviousFrame(
  previousFrame:
    ResolvedReleaseFrame,
  requestedCadenceFps: number,
  capabilities:
    GenericReleaseCapabilityProfile
): {
  seconds: number;
  constraints:
    readonly ReleaseTimingConstraint[];
} {
  const requested =
    1 / requestedCadenceFps;
  const capability =
    1 /
    capabilities
      .maximumCadenceFps.value;
  const exposure =
    previousFrame
      .exposure.shutterSeconds;
  const gap =
    capabilities
      .minimumInterFrameGapSeconds
      .value;
  const physical =
    exposure + gap;
  const seconds =
    Math.max(
      requested,
      capability,
      physical
    );

  const tolerance =
    Math.max(1, seconds) *
    1e-12;
  const constraints:
    ReleaseTimingConstraint[] =
      [];

  if (
    Math.abs(
      seconds - requested
    ) <= tolerance
  ) {
    constraints.push(
      "requested-cadence"
    );
  }
  if (
    Math.abs(
      seconds - capability
    ) <= tolerance
  ) {
    constraints.push(
      "body-maximum-cadence"
    );
  }
  if (
    Math.abs(
      seconds - physical
    ) <= tolerance
  ) {
    constraints.push(
      "exposure-duration"
    );
    if (gap > 0) {
      constraints.push(
        "minimum-inter-frame-gap"
      );
    }
  }

  return {
    seconds,
    constraints
  };
}

const AUTOMATION_STATES: readonly string[] = ["manual", "locked", "continuous"];

/**
 * capture-20 (#698) and #720: every required sub-object is an object, the bracket is one of its three kinds with only that
 * kind's fields and a dense list, and the base state's exposure and automation have only their own fields, so a malformed
 * request fails with a domain error instead of a raw TypeError, a skipped capability check or a copied stray field.
 */
function validateSequencePolicies(
  input:
    ResolveReleaseSequenceInput
): void {
  for (const key of ["drive", "bracket", "baseState", "releaseCapabilities", "exposureCapabilities"] as const) {
    requireInputObject(input[key], key);
  }
  for (const axis of ["aperture", "shutter", "iso"] as const) {
    const capability = input.exposureCapabilities[axis];
    requireInputObject(capability, "exposureCapabilities." + axis);
    const grid = capability.settingGrid as { kind?: unknown; values?: unknown };
    requireInputObject(grid, "exposureCapabilities." + axis + ".settingGrid");
    if (grid.kind === "discrete-values" && !Array.isArray(grid.values)) {
      throw new InvalidConfigurationError("exposureCapabilities." + axis + ".settingGrid.values must be an array.");
    }
  }
  const { exposure, automation } = input.baseState;
  requireInputObject(exposure, "baseState.exposure");
  rejectUnknownFields(exposure, ["aperture", "shutterSeconds", "iso"], "baseState.exposure");
  requireInputObject(automation, "baseState.automation");
  rejectUnknownFields(automation, ["ae", "af", "awb"], "baseState.automation");
  for (const key of ["ae", "af", "awb"] as const) {
    if (!AUTOMATION_STATES.includes(automation[key])) {
      throw new InvalidConfigurationError("baseState.automation." + key + ' must be "manual", "locked" or "continuous".');
    }
  }
  const bracket = input.bracket as unknown as Readonly<Record<string, unknown>>, kind = bracket.kind;
  if (kind !== "none" && kind !== "exposure" && kind !== "focus") {
    throw new InvalidConfigurationError('bracket.kind must be "none", "exposure" or "focus".');
  }
  rejectUnknownVariantFields(bracket, "kind", { none: ["kind"], exposure: ["kind", "axis", "offsetsStops"], focus: ["kind", "focusStates"] }, "bracket");
  if (kind === "none") return;
  const field = kind === "exposure" ? "offsetsStops" : "focusStates", list = bracket[field];
  // A hole in the list leaves one index without an own key.
  if (!Array.isArray(list) || list.length !== Object.keys(list).length) {
    throw new InvalidConfigurationError("bracket." + field + " must be a dense array.");
  }
}

/**
 * Resolves one deterministic still-release sequence.
 *
 * It schedules logical exposures only; how the sensor captures each one is
 * handled elsewhere. Render speed or frame rate is never used as capture timing.
 */
export function resolveReleaseSequence(
  input:
    ResolveReleaseSequenceInput
): ResolvedReleaseSequence {
  requireInputKeys(input, "resolveReleaseSequence", ["sequenceId", "releaseRequestTimeSeconds", "sequenceSeedUint32", "drive", "bracket", "requestedCadenceFps", "baseState", "releaseCapabilities", "exposureCapabilities"]);
  validateSequencePolicies(input);
  const sequenceId =
    requireNonEmptyString(
      input.sequenceId,
      "sequenceId"
    );
  const releaseRequestTime =
    requireFinite(
      input
        .releaseRequestTimeSeconds,
      "releaseRequestTimeSeconds"
    );
  const sequenceSeed =
    requireUint32(
      input.sequenceSeedUint32,
      "sequenceSeedUint32"
    );

  const releaseCapabilities =
    parseGenericReleaseCapabilityProfile(
      input.releaseCapabilities
    );

  if (
    !includesDriveMode(
      releaseCapabilities,
      input.drive.kind
    )
  ) {
    throw new InvalidScientificInputError(
      "The selected drive mode is not supported by the release capability profile."
    );
  }

  validateBracketSupport(
    input,
    releaseCapabilities
  );

  const frameCount =
    resolveFrameCount(
      input.drive,
      input.bracket
    );

  if (
    frameCount >
    releaseCapabilities
      .maximumLogicalFramesPerSequence
      .value
  ) {
    throw new InvalidScientificInputError(
      "Requested sequence frame count exceeds the release capability profile."
    );
  }

  const requestedCadenceFps =
    resolveRequestedCadence(
      frameCount,
      input.requestedCadenceFps
    );

  const selfTimerDelay =
    resolveSelfTimerDelay(
      input.drive
    );

  const baseState:
    ReleaseBaseCaptureState = {
    exposure:
      cloneJson(
        input.baseState.exposure
      ),
    focus:
      parseFocusPlane(
        input.baseState.focus
      ),
    automation:
      cloneJson(
        input.baseState.automation
      ),
    ...(input.baseState
      .whiteBalanceStateId ===
    undefined
      ? {}
      : {
          whiteBalanceStateId:
            requireNonEmptyString(
              input.baseState
                .whiteBalanceStateId,
              "baseState.whiteBalanceStateId"
            )
        })
  };

  validateExposure(
    baseState.exposure,
    input.exposureCapabilities,
    "baseState.exposure"
  );

  const frames:
    ResolvedReleaseFrame[] = [];

  for (
    let frameIndex = 0;
    frameIndex < frameCount;
    frameIndex += 1
  ) {
    const state =
      resolveFrameState(
        input,
        frameIndex
      );
    if (input.bracket.kind === "exposure") {
      snapBracketedSetting(
        state,
        baseState.exposure,
        input.bracket.axis,
        input.exposureCapabilities
      );
    }
    validateExposure(
      state.exposure,
      input.exposureCapabilities,
      "frames[" +
        frameIndex +
        "].exposure"
    );

    let exposureStartTimeSeconds:
      number;
    let startInterval:
      number | null = null;
    let timingConstraints:
      readonly ReleaseTimingConstraint[] =
        [];

    if (frameIndex === 0) {
      exposureStartTimeSeconds =
        releaseRequestTime +
        selfTimerDelay;
    } else {
      const previous =
        frames[
          frameIndex - 1
        ]!;
      if (
        requestedCadenceFps ===
        null
      ) {
        throw new InvalidScientificInputError(
          "Multi-frame sequence lost its requested cadence."
        );
      }
      const interval =
        intervalForPreviousFrame(
          previous,
          requestedCadenceFps,
          releaseCapabilities
        );
      startInterval =
        interval.seconds;
      timingConstraints =
        interval.constraints;
      exposureStartTimeSeconds =
        previous
          .exposureStartTimeSeconds +
        interval.seconds;
    }

    const exposureEndTimeSeconds =
      exposureStartTimeSeconds +
      state.exposure
        .shutterSeconds;

    if (
      !Number.isFinite(
        exposureStartTimeSeconds
      ) ||
      !Number.isFinite(
        exposureEndTimeSeconds
      )
    ) {
      throw new InvalidScientificInputError(
        "Resolved release-sequence timing must remain finite."
      );
    }
    // capture-30: at very large request times the binary64 spacing exceeds the exposure, so frames would collapse to zero
    // length or overlap; refuse rather than schedule them.
    const previousFrame = frames[frameIndex - 1];
    if (
      !(exposureEndTimeSeconds > exposureStartTimeSeconds) ||
      (previousFrame !== undefined && exposureStartTimeSeconds < previousFrame.exposureEndTimeSeconds)
    ) {
      throw new InvalidScientificInputError(
        "Resolved release-sequence timing is not representable at this request time."
      );
    }

    frames.push({
      sequenceId,
      frameIndex,
      releaseFrameId:
        sequenceId +
        ":frame:" +
        frameIndex,
      exposureStartTimeSeconds,
      exposureEndTimeSeconds,
      sceneTimeSecondsFromSequenceStart:
        exposureStartTimeSeconds -
        releaseRequestTime,
      startIntervalFromPreviousSeconds:
        startInterval,
      timingConstraints,
      stochasticSeedUint32:
        hashFrameSeed(
          sequenceSeed,
          frameIndex
        ),
      exposure:
        cloneJson(
          state.exposure
        ),
      focus:
        cloneJson(
          state.focus
        ),
      ...(state
        .exposureBracketOffsetStops ===
      undefined
        ? {}
        : {
            exposureBracketOffsetStops:
              state
                .exposureBracketOffsetStops
          }),
      ...(state
        .exposureBracketRealizedOffsetStops ===
      undefined
        ? {}
        : {
            exposureBracketRealizedOffsetStops:
              state
                .exposureBracketRealizedOffsetStops
          }),
      automation:
        cloneJson(
          baseState.automation
        ),
      ...(baseState
        .whiteBalanceStateId ===
      undefined
        ? {}
        : {
            whiteBalanceStateId:
              baseState
                .whiteBalanceStateId
          })
    });
  }

  const sequence:
    ResolvedReleaseSequence = {
    version:
      RELEASE_SEQUENCE_VERSION,
    sequenceId,
    status: "scheduled",
    releaseRequestTimeSeconds:
      releaseRequestTime,
    selfTimerDelaySeconds:
      selfTimerDelay,
    requestedCadenceFps,
    capabilityMaximumCadenceFps:
      releaseCapabilities
        .maximumCadenceFps.value,
    minimumInterFrameGapSeconds:
      releaseCapabilities
        .minimumInterFrameGapSeconds
        .value,
    requestedFrameCount:
      frameCount,
    actualFrameCount:
      frames.length,
    sequenceSeedUint32:
      sequenceSeed,
    baseStateSnapshot:
      baseState,
    frames,
    sensorCaptureModeOwnership:
      "separate-logical-capture-contract",
    whiteBalanceBracketingPhysicalCaptures:
      false,
    preReleaseCaptureModeled:
      false,
    bufferMediaThermalSlowdownModeled:
      false
  };

  return deepFreeze(
    cloneJson(sequence)
  );
}

/**
 * Returns a cancelled copy of a sequence. The original scheduled sequence is not
 * changed, and it is always clear which frames were completed and which were dropped.
 */
export function createCancelledReleaseSequence(
  input:
    CancelReleaseSequenceInput
): CancelledReleaseSequence {
  requireInputKeys(input, "createCancelledReleaseSequence", ["sequence", "completedFrameCount", "cancelledAtSeconds"]);
  // capture-32: only a scheduled sequence with a list of frames can be cancelled.
  requireInputObject(input.sequence, "sequence");
  if (input.sequence.status !== "scheduled" || !Array.isArray(input.sequence.frames) || typeof input.sequence.sequenceId !== "string") {
    throw new InvalidConfigurationError("sequence must be a scheduled release sequence (status \"scheduled\", a sequenceId and a frames array).");
  }
  const count =
    requireNonNegativeFinite(
      input.completedFrameCount,
      "completedFrameCount"
    );
  if (
    !Number.isSafeInteger(count)
  ) {
    throw new InvalidScientificInputError(
      "completedFrameCount must be a safe integer."
    );
  }
  if (
    count >
    input.sequence.frames.length
  ) {
    throw new InvalidScientificInputError(
      "completedFrameCount must not exceed the source sequence frame count."
    );
  }

  const cancelledAt =
    requireFinite(
      input.cancelledAtSeconds,
      "cancelledAtSeconds"
    );

  const result:
    CancelledReleaseSequence = {
    version:
      RELEASE_SEQUENCE_VERSION,
    sequenceId:
      input.sequence.sequenceId,
    status: "cancelled",
    cancelledAtSeconds:
      cancelledAt,
    completedFrameCount: count,
    omittedFrameCount:
      input.sequence.frames.length -
      count,
    completedFrames:
      cloneJson(
        input.sequence.frames.slice(
          0,
          count
        )
      ),
    sourceSequenceFrameCount:
      input.sequence.frames.length,
    sourceSequenceUnmodified:
      true
  };

  return deepFreeze(
    cloneJson(result)
  );
}
