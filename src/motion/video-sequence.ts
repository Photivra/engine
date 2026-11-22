// SPDX-License-Identifier: Apache-2.0

/**
 * Video frame sequences. Builds a deterministic sequence of frames from the "video" optical capture
 * state (frameRateHz) and a shutter angle.
 *
 * Each frame is an ordinary ResolvedReleaseFrame, so the production capture snapshot and
 * image-formation plan use it unchanged. An optional electronic rolling shutter gives every frame the
 * same line-by-line exposure offsets. Frame timing, seeds and schedules depend only on the inputs and
 * the absolute frame index. They never depend on how the sequence is split into chunks, or on
 * earlier frames.
 * @see docs/MOTION_AND_SIGNAL.md#video-frame-sequences for equations, conventions and limits.
 */

import { parseEvidenceList, type EvidenceProvenance } from "../core/evidence-provenance.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { rejectUnknownFields, requireInputObject, requirePublicOpaqueId, requireInputKeys } from "../core/record-validation.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type { ReleaseAutomationState, ResolvedReleaseFrame } from "../capture/release-sequence.js";
import { parseFocusPlane, type FocusPlane } from "../optics/focus-state.js";
import { parseOpticalProfileState, type OpticalProfileState } from "../optics/profile-contract.js";
import {
  resolveElectronicRollingShutterExposureSchedule,
  ELECTRONIC_ROLLING_SHUTTER_MODEL,
  createRollingShutterCaptureExposureSchedule,
  type ElectronicRollingShutterExposureSchedule
} from "../sensor/readout-exposure-linkage.js";
import type { RollingSensorReadoutTimingDeclaration } from "../sensor/readout-timing.js";
import { deriveNativeSiteStreamSeedUint32 } from "../sensor/stochastic-seed.js";

export const VIDEO_FRAME_SEQUENCE_VERSION = "1.0.0" as const;
/** Stream identifier ("VIDF"). Keeps per-frame video seeds separate from per-site noise streams. */
export const VIDEO_FRAME_SEED_STREAM_ID = 0x56494446 as const;
/** Maximum frames per call. Resolve longer clips in chunks using firstFrameIndex. */
export const VIDEO_FRAME_SEQUENCE_MAXIMUM_FRAMES = 100_000 as const;

function requireFrameRate(frameRateHz: number): number {
  if (typeof frameRateHz !== "number" || !Number.isFinite(frameRateHz) || frameRateHz <= 0) {
    throw new InvalidScientificInputError("frameRateHz must be a finite number greater than zero.");
  }
  return frameRateHz;
}

const REPRESENTABLE = "The shutter-angle timing is not representable as a finite, positive duration at this frame rate.";

function requireShutterAngle(shutterAngleDegrees: number): number {
  if (typeof shutterAngleDegrees !== "number" || !Number.isFinite(shutterAngleDegrees) ||
    shutterAngleDegrees <= 0 || shutterAngleDegrees > 360) {
    throw new InvalidScientificInputError("shutterAngleDegrees must lie in (0, 360].");
  }
  return shutterAngleDegrees;
}

/**
 * Exposure time for a shutter angle (as on a rotary film-camera shutter): t = (angle / 360) / frameRateHz.
 * A 180° angle exposes for half of each frame period.
 */
export function calculateShutterAngleExposureSeconds(frameRateHz: number, shutterAngleDegrees: number): number {
  const exposureSeconds = requireShutterAngle(shutterAngleDegrees) / 360 / requireFrameRate(frameRateHz);
  // sensor-18: an extreme accepted rate can overflow to Infinity or underflow to a zero-length exposure.
  if (!(exposureSeconds > 0 && exposureSeconds < Infinity)) throw new InvalidScientificInputError(REPRESENTABLE);
  return exposureSeconds;
}

/** Inverse of {@link calculateShutterAngleExposureSeconds}: angle = 360 · frameRateHz · t. */
export function calculateShutterAngleFromExposureSeconds(frameRateHz: number, exposureSeconds: number): number {
  if (typeof exposureSeconds !== "number" || !Number.isFinite(exposureSeconds) || exposureSeconds <= 0) {
    throw new InvalidScientificInputError("exposureSeconds must be a finite number greater than zero.");
  }
  const angle = 360 * requireFrameRate(frameRateHz) * exposureSeconds;
  if (angle > 360 * (1 + 1e-12)) {
    throw new InvalidScientificInputError("Exposure longer than one frame period has no shutter angle.");
  }
  if (!(angle > 0)) throw new InvalidScientificInputError(REPRESENTABLE);
  return Math.min(360, angle);
}

export interface ShutterAngleRuleAssessment {
  frameRateHz: number;
  shutterAngleDegrees: number;
  exposureSeconds: number;
  /** 1 / (2 · frameRateHz): the 180° convention. */
  conventionExposureSeconds: number;
  /** log2(exposure / convention): negative is shorter (crisper, more staccato) motion. */
  deviationStops: number;
  classification: "matches-180-degree-convention" | "shorter-than-convention" | "longer-than-convention";
  /** The 180° rule is a cinematographic convention for motion-blur appearance, not a physical law. */
  conventionNotPhysics: true;
}

/**
 * Compares a shutter angle with the 180° cinematographic convention (exposure = half the frame
 * period). Within a relative 1e-9 the angle "matches". Otherwise the signed deviation is reported.
 */
export function assessShutterAngleRule(frameRateHz: number, shutterAngleDegrees: number): ShutterAngleRuleAssessment {
  const exposureSeconds = calculateShutterAngleExposureSeconds(frameRateHz, shutterAngleDegrees);
  const conventionExposureSeconds = 1 / (2 * frameRateHz);
  const ratio = exposureSeconds / conventionExposureSeconds, deviationStops = Math.log2(ratio);
  if (!(conventionExposureSeconds > 0 && conventionExposureSeconds < Infinity && Number.isFinite(deviationStops))) throw new InvalidScientificInputError(REPRESENTABLE);
  return {
    frameRateHz, shutterAngleDegrees, exposureSeconds, conventionExposureSeconds,
    deviationStops,
    classification: Math.abs(ratio - 1) <= 1e-9 ? "matches-180-degree-convention"
      : ratio < 1 ? "shorter-than-convention" : "longer-than-convention",
    conventionNotPhysics: true
  };
}

export interface ResolveVideoFrameSequenceInput {
  sequenceId: string;
  /** Exact optical capture state. captureMode must be "video", with a positive frameRateHz. */
  opticalState: OpticalProfileState;
  /** Shutter angle in (0, 360]; exposure = angle / 360 / frameRateHz. */
  shutterAngleDegrees: number;
  /** Absolute index of the first frame to resolve (default 0). */
  firstFrameIndex?: number;
  frameCount: number;
  sequenceSeedUint32: number;
  iso: number;
  /** Defaults to the optical state's finite focus distance. */
  focus?: FocusPlane;
  automation: { ae: ReleaseAutomationState; af: ReleaseAutomationState; awb: ReleaseAutomationState };
  whiteBalanceStateId?: string;
  /** Evidence for the commanded frame rate and shutter-angle timing. Used for the exposure fact. */
  timingEvidence: readonly EvidenceProvenance[];
  /** Optional electronic rolling shutter applied identically to every frame. */
  rollingShutter?: {
    readout: RollingSensorReadoutTimingDeclaration;
    linkageEvidence: readonly EvidenceProvenance[];
  };
}

export interface VideoFrameSequence {
  version: typeof VIDEO_FRAME_SEQUENCE_VERSION;
  sequenceId: string;
  frameRateHz: number;
  framePeriodSeconds: number;
  shutterAngleDegrees: number;
  exposureSeconds: number;
  shutterAngleRule: ShutterAngleRuleAssessment;
  firstFrameIndex: number;
  frameCount: number;
  sequenceSeedUint32: number;
  seedDerivation: "murmur3-x86-32(sequenceSeed, absoluteFrameIndex, VIDEO_FRAME_SEED_STREAM_ID)";
  frameTimeDerivation: "absoluteFrameIndex / frameRateHz";
  /**
   * Exposure schedule for each frame. It is the same for every frame; times are relative to each
   * frame's own first-opening phase. Null when no rolling shutter is declared; the caller then
   * supplies the global schedule of its capture mode.
   */
  exposureSchedule: ReturnType<typeof createRollingShutterCaptureExposureSchedule> | null;
  rollingShutter: Pick<ElectronicRollingShutterExposureSchedule, "modelId" | "modelVersion" | "lineScanSkewSeconds" | "linkage"> | null;
  /** Ordinary release frames: pass each to createProductionCaptureSnapshotFromReleaseFrame. */
  frames: readonly ResolvedReleaseFrame[];
  limitations: readonly string[];
}

/**
 * Resolves `frameCount` consecutive video frames starting at `firstFrameIndex`.
 *
 * Frame k (absolute index) opens k / frameRateHz seconds after the sequence starts, and exposes for
 * (angle / 360) / frameRateHz. Its random seed is a MurmurHash3 of (sequence seed, k, stream id).
 *
 * Every value depends only on the inputs and k. So resolving frames 0–99 at once, or as 0–49 then
 * 50–99, gives identical frames.
 *
 * With a rolling shutter, the line at normalized scan position s in frame k integrates over
 * [k/f + s·τ, k/f + s·τ + T]. τ must not exceed the frame period, so each line is read once per
 * frame.
 */
export function resolveVideoFrameSequence(input: ResolveVideoFrameSequenceInput): VideoFrameSequence {
  requireInputKeys(input, "resolveVideoFrameSequence", ["sequenceId", "opticalState", "shutterAngleDegrees", "firstFrameIndex", "frameCount", "sequenceSeedUint32", "iso", "focus", "automation", "whiteBalanceStateId", "timingEvidence", "rollingShutter"]);
  requireInputObject(input.automation, "resolveVideoFrameSequence automation");
  rejectUnknownFields(input.automation, ["ae", "af", "awb"], "resolveVideoFrameSequence automation");
  if (input.rollingShutter !== undefined) {
    requireInputObject(input.rollingShutter, "resolveVideoFrameSequence rollingShutter");
    rejectUnknownFields(input.rollingShutter, ["readout", "linkageEvidence"], "resolveVideoFrameSequence rollingShutter");
  }
  const sequenceId = requirePublicOpaqueId(input.sequenceId, "Invalid video sequence ID.");
  const optical = parseOpticalProfileState(input.opticalState);
  if (optical.captureMode !== "video") {
    throw new InvalidConfigurationError("Video frame sequences require an optical state with captureMode \"video\".");
  }
  const frameRateHz = optical.frameRateHz;
  const shutterAngleDegrees = requireShutterAngle(input.shutterAngleDegrees);
  const exposureSeconds = calculateShutterAngleExposureSeconds(frameRateHz, shutterAngleDegrees);
  const first = input.firstFrameIndex ?? 0;
  if (!Number.isSafeInteger(first) || first < 0 || !Number.isSafeInteger(input.frameCount) || input.frameCount < 1 ||
    input.frameCount > VIDEO_FRAME_SEQUENCE_MAXIMUM_FRAMES || first + input.frameCount - 1 > 0xffffffff) {
    throw new InvalidScientificInputError("Video frames need a non-negative first index, 1–100000 frames and uint32 frame indices.");
  }
  const seed = input.sequenceSeedUint32;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new InvalidScientificInputError("sequenceSeedUint32 must be a uint32 integer.");
  }
  if (typeof input.iso !== "number" || !Number.isFinite(input.iso) || input.iso <= 0) {
    throw new InvalidScientificInputError("iso must be a finite number greater than zero.");
  }
  const timingEvidence = parseEvidenceList(input.timingEvidence, "video.timingEvidence");
  const focus = parseFocusPlane(input.focus ?? { kind: "finite", distanceM: optical.focusDistanceM });
  const automation = { ae: input.automation.ae, af: input.automation.af, awb: input.automation.awb };
  for (const state of Object.values(automation)) {
    if (state !== "manual" && state !== "locked" && state !== "continuous") {
      throw new InvalidConfigurationError("Video automation states must be manual, locked or continuous.");
    }
  }
  const whiteBalanceStateId = input.whiteBalanceStateId === undefined ? undefined
    : requirePublicOpaqueId(input.whiteBalanceStateId, "Invalid white-balance state ID.");
  const framePeriodSeconds = 1 / frameRateHz;

  let rolling: ElectronicRollingShutterExposureSchedule | null = null;
  if (input.rollingShutter !== undefined) {
    rolling = resolveElectronicRollingShutterExposureSchedule({ readout: input.rollingShutter.readout,
      nominalExposureDurationSeconds: { value: exposureSeconds, unit: "s", evidence: timingEvidence },
      linkageEvidence: input.rollingShutter.linkageEvidence });
    if (rolling.lineScanSkewSeconds > framePeriodSeconds) {
      throw new InvalidScientificInputError("Rolling-shutter line skew exceeds the video frame period; lines cannot be read once per frame.");
    }
  }

  const start = (index: number): number => index / frameRateHz;
  const frames: ResolvedReleaseFrame[] = Array.from({ length: input.frameCount }, (_, offset) => {
    const frameIndex = first + offset, exposureStartTimeSeconds = start(frameIndex);
    return {
      sequenceId,
      frameIndex,
      releaseFrameId: sequenceId + ":video:" + frameIndex,
      exposureStartTimeSeconds,
      exposureEndTimeSeconds: exposureStartTimeSeconds + exposureSeconds,
      sceneTimeSecondsFromSequenceStart: exposureStartTimeSeconds,
      startIntervalFromPreviousSeconds: frameIndex === 0 ? null : exposureStartTimeSeconds - start(frameIndex - 1),
      timingConstraints: ["requested-cadence"],
      stochasticSeedUint32: deriveNativeSiteStreamSeedUint32(seed, frameIndex, VIDEO_FRAME_SEED_STREAM_ID),
      exposure: { aperture: optical.aperture, shutterSeconds: exposureSeconds, iso: input.iso },
      focus: { ...focus },
      automation: { ...automation },
      ...(whiteBalanceStateId === undefined ? {} : { whiteBalanceStateId })
    };
  });
  const last = frames[frames.length - 1]!;
  if (!(framePeriodSeconds < Infinity && last.exposureEndTimeSeconds > last.exposureStartTimeSeconds && last.exposureEndTimeSeconds < Infinity)) {
    throw new InvalidScientificInputError(REPRESENTABLE);
  }

  return {
    version: VIDEO_FRAME_SEQUENCE_VERSION,
    sequenceId,
    frameRateHz,
    framePeriodSeconds,
    shutterAngleDegrees,
    exposureSeconds,
    shutterAngleRule: assessShutterAngleRule(frameRateHz, shutterAngleDegrees),
    firstFrameIndex: first,
    frameCount: input.frameCount,
    sequenceSeedUint32: seed,
    seedDerivation: "murmur3-x86-32(sequenceSeed, absoluteFrameIndex, VIDEO_FRAME_SEED_STREAM_ID)",
    frameTimeDerivation: "absoluteFrameIndex / frameRateHz",
    exposureSchedule: rolling === null ? null : createRollingShutterCaptureExposureSchedule(rolling),
    rollingShutter: rolling === null ? null : { modelId: ELECTRONIC_ROLLING_SHUTTER_MODEL.id,
      modelVersion: ELECTRONIC_ROLLING_SHUTTER_MODEL.version, lineScanSkewSeconds: rolling.lineScanSkewSeconds,
      linkage: rolling.linkage },
    frames,
    limitations: [
      "Frame timing is ideal: no frame-rate drift, dropped frames, variable frame rate or sensor-mode switching.",
      "Exposure follows the shutter-angle relation t = angle/360/f; automatic exposure between frames is not modeled.",
      "The 180-degree rule is reported as a cinematographic convention, not a physical requirement.",
      "Video encoding, compression, temporal noise reduction and frame interpolation are not modeled."
    ]
  };
}
