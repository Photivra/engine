# stabilization/system.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateStabilizedCaptureTemporalSamples

Feeds the residual stabilized rotation into the existing local-exposure temporal mapping. Shutter
timing is not changed, and no blur radius is invented.

The generic stabilizer takes a declared angular disturbance (camera shake) and applies a per-axis
response, latency, travel limits and a panning policy. The leftover (residual) motion feeds the
existing temporal mapping. No commercial IBIS (in-body) or OIS (optical) calibration is supplied,
no arbitrary "stops" rating is used, and body/lens coordination is never inferred.

```ts
export function calculateStabilizedCaptureTemporalSamples(
  input:
    CalculateStabilizedCaptureTemporalSamplesInput
): CalculationResult<StabilizedCaptureTemporalSamples>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateStabilizedCaptureTemporalSamplesInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateStabilizedCaptureTemporalSamplesInput {
  disturbance:
    StabilizationDisturbanceTrajectory;
  profile:
    StabilizationSystemProfile;
  captureKind:
    StabilizationCaptureKind;
  timing:
    ResolvedCaptureModeTiming;
  samplePointsNative:
    readonly RasterPoint[];
  temporalSampleCount: number;
}
```

## calculateStabilizedRotationTrajectory

Runs the declared generic per-axis controller against an explicit angular disturbance trajectory.
Returns the residual motion, with diagnostics for latency and travel limits.

The generic stabilizer takes a declared angular disturbance (camera shake) and applies a per-axis
response, latency, travel limits and a panning policy. The leftover (residual) motion feeds the
existing temporal mapping. No commercial IBIS (in-body) or OIS (optical) calibration is supplied,
no arbitrary "stops" rating is used, and body/lens coordination is never inferred.

```ts
export function calculateStabilizedRotationTrajectory(
  input:
    CalculateStabilizedRotationTrajectoryInput
): CalculationResult<StabilizedRotationTrajectory>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateStabilizedRotationTrajectoryInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateStabilizedRotationTrajectoryInput {
  disturbance:
    StabilizationDisturbanceTrajectory;
  profile:
    StabilizationSystemProfile;
  captureKind:
    StabilizationCaptureKind;
}
```

## parseStabilizationDisturbanceTrajectory

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

The generic stabilizer takes a declared angular disturbance (camera shake) and applies a per-axis
response, latency, travel limits and a panning policy. The leftover (residual) motion feeds the
existing temporal mapping. No commercial IBIS (in-body) or OIS (optical) calibration is supplied,
no arbitrary "stops" rating is used, and body/lens coordination is never inferred.

```ts
export function parseStabilizationDisturbanceTrajectory(
  value: unknown
): StabilizationDisturbanceTrajectory;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseStabilizationSystemProfile

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

The generic stabilizer takes a declared angular disturbance (camera shake) and applies a per-axis
response, latency, travel limits and a panning policy. The leftover (residual) motion feeds the
existing temporal mapping. No commercial IBIS (in-body) or OIS (optical) calibration is supplied,
no arbitrary "stops" rating is used, and body/lens coordination is never inferred.

```ts
export function parseStabilizationSystemProfile(
  value: unknown
): StabilizationSystemProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PhysicalStabilizationArchitecture

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type PhysicalStabilizationArchitecture =
  | "off"
  | "sensor-shift"
  | "lens-optical"
  | "coordinated-physical";
```

## STABILIZATION_DISTURBANCE_TRAJECTORY_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
STABILIZATION_DISTURBANCE_TRAJECTORY_VERSION =
  "0.1.0" as const
```

## STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## StabilizationAngularStateRad

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizationAngularStateRad {
  pitch: number;
  yaw: number;
  roll: number;
}
```

## StabilizationAxisResolution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizationAxisResolution {
  axis: StabilizationRotationAxis;
  disturbanceAngleRad: number;
  delayedMeasuredAngleRad: number;
  requestedCorrectionAngleRad:
    number;
  appliedCorrectionAngleRad:
    number;
  residualAngleRad: number;
  correctionGain: number;
  latencySeconds: number;
  maximumCorrectionAngleRad:
    number;
  bypassedForDeclaredPan:
    boolean;
  correctionLimitReached:
    boolean;
}
```

## StabilizationAxisResponseProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizationAxisResponseProfile {
  axis: StabilizationRotationAxis;
  correctionGain:
    EvidenceBackedFact<number>;
  latencySeconds:
    EvidenceBackedFact<number>;
  maximumCorrectionAngleRad:
    EvidenceBackedFact<number>;
}
```

## StabilizationCaptureKind

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type StabilizationCaptureKind =
  | "still"
  | "video";
```

## StabilizationCoordinatedAllocation

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizationCoordinatedAllocation {
  bodyFraction: number;
  lensFraction: number;
  evidence: readonly EvidenceProvenance[];
  totalCorrectionAppliedOnce:
    true;
}
```

## StabilizationDisturbanceSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizationDisturbanceSample {
  timeSecondsFromCaptureReference:
    number;
  angularDisplacementRad:
    StabilizationAngularStateRad;
}
```

## StabilizationDisturbanceTrajectory

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizationDisturbanceTrajectory {
  version:
    typeof STABILIZATION_DISTURBANCE_TRAJECTORY_VERSION;
  trajectoryId: string;
  timeReference:
    "first-opening-boundary-phase";
  samples:
    readonly StabilizationDisturbanceSample[];
  initialAngularDisplacementIsZero:
    true;
  cameraTranslationIncluded:
    false;
  subjectMotionIncluded:
    false;
  supportStateEncoded:
    false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## StabilizationPanningPolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type StabilizationPanningPolicy =
  | {
      kind: "none";
    }
  | {
      kind:
        "declared-axis-bypass";
      axis:
        StabilizationRotationAxis;
      evidence:
        readonly EvidenceProvenance[];
    };
```

## StabilizationRotationAxis

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type StabilizationRotationAxis =
  | "pitch"
  | "yaw"
  | "roll";
```

## StabilizationSystemProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizationSystemProfile {
  schemaVersion:
    typeof STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  profileKind:
    "generic-synthetic";
  scientificStatus:
    "approximation";
  architecture:
    PhysicalStabilizationArchitecture;
  captureKind:
    StabilizationCaptureKind;
  axisResponses:
    readonly StabilizationAxisResponseProfile[];
  panningPolicy:
    StabilizationPanningPolicy;
  coordinatedAllocation?:
    StabilizationCoordinatedAllocation;
  controlTransientModeled: false;
  spontaneousDriftModeled: false;
  cameraTranslationCorrectionModeled:
    false;
  digitalStabilizationIncluded:
    false;
  supportPolicyIncluded: false;
  stopRatingUsedAsDynamicResponse:
    false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## StabilizedCaptureTemporalNode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizedCaptureTemporalNode {
  temporalSampleIndex: number;
  localExposurePhase: number;
  captureTimeSecondsFromReference:
    number;
  normalizedTimeWeight: number;
  timeMeasureSeconds: number;
  stabilization:
    StabilizedRotationSample;
}
```

## StabilizedCaptureTemporalPoint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizedCaptureTemporalPoint {
  destinationPointNative:
    RasterPoint;
  localExposureWindow: {
    startSecondsFromCaptureReference:
      number;
    endSecondsFromCaptureReference:
      number;
    durationSeconds: number;
  };
  nodes:
    readonly StabilizedCaptureTemporalNode[];
}
```

## StabilizedCaptureTemporalSamples

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizedCaptureTemporalSamples {
  profileId: string;
  trajectoryId: string;
  captureModeId: string;
  timingProfileId: string;
  captureKind:
    StabilizationCaptureKind;
  architecture:
    PhysicalStabilizationArchitecture;
  timeReference:
    "first-opening-boundary-phase";
  quadratureScheme:
    "uniform-midpoint";
  temporalSampleCount: number;
  points:
    readonly StabilizedCaptureTemporalPoint[];
  sensorReadoutTimingUsedAsExposureTiming:
    false;
  supportStateConsumed: false;
  translationCorrectionModeled:
    false;
  digitalStabilizationApplied:
    false;
}
```

## StabilizedRotationSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizedRotationSample {
  timeSecondsFromCaptureReference:
    number;
  disturbanceAngularDisplacementRad:
    StabilizationAngularStateRad;
  appliedCorrectionAngularDisplacementRad:
    StabilizationAngularStateRad;
  residualAngularDisplacementRad:
    StabilizationAngularStateRad;
  axes:
    readonly StabilizationAxisResolution[];
}
```

## StabilizedRotationTrajectory

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizedRotationTrajectory {
  profileId: string;
  profileVersion: string;
  trajectoryId: string;
  architecture:
    PhysicalStabilizationArchitecture;
  captureKind:
    StabilizationCaptureKind;
  timeReference:
    "first-opening-boundary-phase";
  samples:
    readonly StabilizedRotationSample[];
  correctionModel:
    "delayed-linear-image-equivalent-angular-response";
  supportStateConsumed: false;
  translationCorrectionModeled:
    false;
  digitalStabilizationApplied:
    false;
  digitalStabilizationOwnedBy:
    "downstream-geometric-correction-composition";
  coordinatedCorrectionDoubleCounted:
    false;
  zeroDisturbanceCanCreateMotion:
    false;
}
```
