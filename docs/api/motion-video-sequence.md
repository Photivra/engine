# motion/video-sequence.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## assessShutterAngleRule

Compares a shutter angle with the 180° cinematographic convention (exposure = half the frame
period). Within a relative 1e-9 the angle "matches". Otherwise the signed deviation is reported.

```ts
export function assessShutterAngleRule(frameRateHz: number, shutterAngleDegrees: number): ShutterAngleRuleAssessment;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateShutterAngleExposureSeconds

Exposure time for a shutter angle (as on a rotary film-camera shutter): t = (angle / 360) / frameRateHz.
A 180° angle exposes for half of each frame period.

```ts
export function calculateShutterAngleExposureSeconds(frameRateHz: number, shutterAngleDegrees: number): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateShutterAngleFromExposureSeconds

Inverse of {@link calculateShutterAngleExposureSeconds}: angle = 360 · frameRateHz · t.

```ts
export function calculateShutterAngleFromExposureSeconds(frameRateHz: number, exposureSeconds: number): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveVideoFrameSequence

Resolves `frameCount` consecutive video frames starting at `firstFrameIndex`.

Frame k (absolute index) opens k / frameRateHz seconds after the sequence starts, and exposes for
(angle / 360) / frameRateHz. Its random seed is a MurmurHash3 of (sequence seed, k, stream id).

Every value depends only on the inputs and k. So resolving frames 0–99 at once, or as 0–49 then
50–99, gives identical frames.

With a rolling shutter, the line at normalized scan position s in frame k integrates over
[k/f + s·τ, k/f + s·τ + T]. τ must not exceed the frame period, so each line is read once per
frame.

```ts
export function resolveVideoFrameSequence(input: ResolveVideoFrameSequenceInput): VideoFrameSequence;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveVideoFrameSequenceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## ShutterAngleRuleAssessment

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## VIDEO_FRAME_SEED_STREAM_ID

Stream identifier ("VIDF"). Keeps per-frame video seeds separate from per-site noise streams.

```ts
VIDEO_FRAME_SEED_STREAM_ID = 0x56494446 as const
```

## VIDEO_FRAME_SEQUENCE_MAXIMUM_FRAMES

Maximum frames per call. Resolve longer clips in chunks using firstFrameIndex.

```ts
VIDEO_FRAME_SEQUENCE_MAXIMUM_FRAMES = 100_000 as const
```

## VIDEO_FRAME_SEQUENCE_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
VIDEO_FRAME_SEQUENCE_VERSION = "1.0.0" as const
```

## VideoFrameSequence

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```
