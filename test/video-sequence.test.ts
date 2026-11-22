// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import {
  assessShutterAngleRule,
  calculateCaptureExposureWindows,
  calculateShutterAngleExposureSeconds,
  calculateShutterAngleFromExposureSeconds,
  createProductionCaptureSnapshotFromReleaseFrame,
  resolveVideoFrameSequence,
  VIDEO_FRAME_SEED_STREAM_ID,
  type OpticalProfileState,
  type ResolveVideoFrameSequenceInput,
  type RollingSensorReadoutTimingDeclaration
} from "../src/index.js";
import { deriveNativeSiteStreamSeedUint32 } from "../src/sensor/stochastic-seed.js";

const evidence = (ref: string): [{ sourceOrigin: "photivra"; sourceReference: string; reuseStatus: "photivra-owned" }] =>
  [{ sourceOrigin: "photivra", sourceReference: "test:" + ref, reuseStatus: "photivra-owned" }];

const optical = (frameRateHz = 24, captureMode: "video" | "still" = "video"): OpticalProfileState => ({ bodyId: "generic-body",
  bodyVersion: "1", lensId: "generic-50", lensVersion: "1", focalLengthMm: 50, aperture: 4, focusDistanceM: 5, captureMode,
  outputWidth: 1920, outputHeight: 1080, frameRateHz, stabilizationMode: "off" });

const readout = (skew: number): RollingSensorReadoutTimingDeclaration => ({ readoutMode: "rolling",
  captureReadoutDurationSeconds: { value: skew, unit: "s", evidence: evidence("readout") },
  scanDirectionNative: { value: "top-to-bottom", evidence: evidence("direction") },
  spatialSamplingSkewSeconds: { value: skew, unit: "s", evidence: evidence("skew") } });

const request = (overrides: Partial<ResolveVideoFrameSequenceInput> = {}): ResolveVideoFrameSequenceInput => ({
  sequenceId: "clip-1", opticalState: optical(), shutterAngleDegrees: 180, frameCount: 6, sequenceSeedUint32: 1234, iso: 400,
  automation: { ae: "locked", af: "manual", awb: "locked" }, timingEvidence: evidence("timing"), ...overrides });

describe("shutter angle", () => {
  it("maps angle and frame rate to exposure t = angle/360/f and back", () => {
    expect(calculateShutterAngleExposureSeconds(24, 180)).toBe(1/48);
    expect(calculateShutterAngleExposureSeconds(24, 360)).toBe(1/24);
    expect(calculateShutterAngleExposureSeconds(60, 90)).toBeCloseTo(1/240, 18);
    expect(calculateShutterAngleFromExposureSeconds(24, 1/50)).toBeCloseTo(172.8, 12);
    expect(calculateShutterAngleFromExposureSeconds(24, 1/24)).toBe(360);
    expect(() => calculateShutterAngleFromExposureSeconds(24, 1/20)).toThrow("longer than one frame period");
    expect(() => calculateShutterAngleExposureSeconds(24, 0)).toThrow("(0, 360]");
    expect(() => calculateShutterAngleExposureSeconds(24, 361)).toThrow("(0, 360]");
    expect(() => calculateShutterAngleExposureSeconds(0, 180)).toThrow("frameRateHz");
    expect(() => calculateShutterAngleFromExposureSeconds(24, 0)).toThrow("exposureSeconds");
  });

  it("assesses the 180-degree convention as a convention with a signed stop deviation", () => {
    expect(assessShutterAngleRule(24, 180)).toMatchObject({ classification: "matches-180-degree-convention", deviationStops: 0,
      conventionExposureSeconds: 1/48, conventionNotPhysics: true });
    const antiFlicker = assessShutterAngleRule(24, 172.8);
    expect(antiFlicker.classification).toBe("shorter-than-convention");
    expect(antiFlicker.deviationStops).toBeCloseTo(Math.log2(172.8/180), 14);
    expect(assessShutterAngleRule(30, 360)).toMatchObject({ classification: "longer-than-convention", deviationStops: 1 });
  });
});

describe("video frame sequences", () => {
  it("resolves frame k at k/f with angle exposure and Murmur3 per-frame seeds", () => {
    const sequence = resolveVideoFrameSequence(request());
    expect(sequence).toMatchObject({ frameRateHz: 24, exposureSeconds: 1/48, framePeriodSeconds: 1/24, exposureSchedule: null,
      rollingShutter: null, shutterAngleRule: { classification: "matches-180-degree-convention" } });
    sequence.frames.forEach((frame, k) => {
      expect(frame.frameIndex).toBe(k);
      expect(frame.exposureStartTimeSeconds).toBe(k/24);
      expect(frame.sceneTimeSecondsFromSequenceStart).toBe(k/24);
      expect(frame.exposureEndTimeSeconds - frame.exposureStartTimeSeconds).toBeCloseTo(1/48, 15);
      expect(frame.startIntervalFromPreviousSeconds).toBe(k === 0 ? null : k/24 - (k-1)/24);
      expect(frame.stochasticSeedUint32).toBe(deriveNativeSiteStreamSeedUint32(1234, k, VIDEO_FRAME_SEED_STREAM_ID));
      expect(frame.exposure).toEqual({ aperture: 4, shutterSeconds: 1/48, iso: 400 });
      expect(frame.focus).toEqual({ kind: "finite", distanceM: 5 });
    });
    expect(new Set(sequence.frames.map(f => f.stochasticSeedUint32)).size).toBe(6);
  });

  it("is frame-to-frame deterministic: chunked resolution equals one-shot resolution", () => {
    const all = resolveVideoFrameSequence(request({ frameCount: 10 })).frames;
    const chunks = [0, 4, 7].flatMap((first, i, starts) => resolveVideoFrameSequence(request({ firstFrameIndex: first,
      frameCount: (starts[i+1] ?? 10) - first })).frames);
    expect(chunks).toEqual(all);
    expect(resolveVideoFrameSequence(request({ frameCount: 10 }))).toEqual(resolveVideoFrameSequence(request({ frameCount: 10 })));
    expect(resolveVideoFrameSequence(request({ sequenceSeedUint32: 1235 })).frames[0]!.stochasticSeedUint32)
      .not.toBe(all[0]!.stochasticSeedUint32);
  });

  it("applies the electronic rolling shutter to every frame and feeds production capture snapshots", () => {
    const sequence = resolveVideoFrameSequence(request({ rollingShutter: { readout: readout(.02), linkageEvidence: evidence("linkage") } }));
    expect(sequence.rollingShutter).toMatchObject({ modelId: "electronic-rolling-shutter-line-reset-read", lineScanSkewSeconds: .02 });
    const schedule = sequence.exposureSchedule!;
    const windows = calculateCaptureExposureWindows({ ...schedule, nativeRaster: { pixelWidth: 4, pixelHeight: 4 },
      samplePointsNative: [{ x: 1, y: .5 }, { x: 1, y: 3.5 }] }).value.samples;
    expect(windows[1]!.startOffsetSecondsFromOpeningReference - windows[0]!.startOffsetSecondsFromOpeningReference).toBeCloseTo(.015, 15);
    const snapshots = sequence.frames.slice(0, 2).map(frame => createProductionCaptureSnapshotFromReleaseFrame({
      captureId: "clip-1-capture-" + frame.frameIndex, sceneStateId: "scene", sceneTimeSecondsFromExposureStart: 0,
      outputStateId: "output", releaseFrame: frame,
      temporalCapture: { exposureWindowInput: { ...schedule, nativeRaster: { pixelWidth: 4, pixelHeight: 4 } },
        imagingArea: { widthMm: 36, heightMm: 24 }, orientation: "landscape", readout: readout(.02),
        readoutExposureLinkage: { kind: "electronic-rolling-shutter-line-reset-read", evidence: evidence("linkage") } } }));
    expect(snapshots[1]!.releaseFrameBinding?.sceneTimeSecondsFromSequenceStart).toBe(1/24);
    expect(snapshots[0]!.stochasticSeedUint32).not.toBe(snapshots[1]!.stochasticSeedUint32);
  });

  it("fails closed for still states, oversize line skew and malformed requests", () => {
    expect(() => resolveVideoFrameSequence(request({ opticalState: optical(0, "still") }))).toThrow("captureMode \"video\"");
    expect(() => resolveVideoFrameSequence(request({ rollingShutter: { readout: readout(.05), linkageEvidence: evidence("l") } })))
      .toThrow("exceeds the video frame period");
    expect(() => resolveVideoFrameSequence(request({ frameCount: 0 }))).toThrow("1–100000 frames");
    expect(() => resolveVideoFrameSequence(request({ firstFrameIndex: -1 }))).toThrow("non-negative first index");
    expect(() => resolveVideoFrameSequence(request({ sequenceSeedUint32: 2**32 }))).toThrow("uint32");
    expect(() => resolveVideoFrameSequence(request({ iso: 0 }))).toThrow("iso");
    expect(() => resolveVideoFrameSequence(request({ automation: { ae: "auto" as never, af: "manual", awb: "locked" } }))).toThrow("automation");
    expect(() => resolveVideoFrameSequence(request({ shutterAngleDegrees: 400 }))).toThrow("(0, 360]");
    expect(resolveVideoFrameSequence(request({ whiteBalanceStateId: "wb-1", focus: { kind: "infinity" } })).frames[0])
      .toMatchObject({ whiteBalanceStateId: "wb-1", focus: { kind: "infinity" } });
  });
});

describe("extreme accepted frame rates (sensor-18, #701)", () => {
  const refused = expect.objectContaining({ name: "InvalidScientificInputError" });
  it("refuses timings that overflow, underflow or collapse to a zero-length exposure", () => {
    expect(() => calculateShutterAngleExposureSeconds(1e-320, 180)).toThrow(refused);
    expect(() => calculateShutterAngleExposureSeconds(1e300, 1e-30)).toThrow(refused);
    expect(() => calculateShutterAngleFromExposureSeconds(1e-200, 1e-200)).toThrow(refused);
    expect(() => assessShutterAngleRule(1e308, 180)).toThrow(refused);
    expect(() => assessShutterAngleRule(1e-320, 180)).toThrow(refused);
    expect(() => resolveVideoFrameSequence(request({ opticalState: optical(1e-320) }))).toThrow(refused);
    expect(() => resolveVideoFrameSequence(request({ opticalState: optical(1e300), shutterAngleDegrees: 1e-30 }))).toThrow(refused);
  });

  it("keeps ordinary rates unchanged", () => {
    expect(calculateShutterAngleExposureSeconds(24, 180)).toBe(180 / 360 / 24);
    expect(calculateShutterAngleFromExposureSeconds(24, 1 / 48)).toBe(180);
    expect(assessShutterAngleRule(24, 180).deviationStops).toBe(0);
  });
});
