# capture/focus-control.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## assessFocusReleaseGate

Reports whether the shutter may be released under the focus-priority or release-priority
policy. It does not operate the shutter.

```ts
export function assessFocusReleaseGate(
  input:
    AssessFocusReleaseGateInput
): FocusReleaseGateAssessment;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## AssessFocusReleaseGateInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AssessFocusReleaseGateInput {
  state:
    FocusControlState;
  profile:
    FocusControlProfile;
  priority:
    FocusReleasePriority;
}
```

## createFocusControlState

Creates the initial ideal focus-controller state from a profile, a focus plane and a public
state ID.

```ts
export function createFocusControlState(
  input:
    CreateFocusControlStateInput
): FocusControlState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateFocusControlStateInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateFocusControlStateInput {
  stateId: string;
  profile:
    FocusControlProfile;
  mode:
    FocusControlMode;
  initialFocus:
    FocusPlane;
  initialTimeSeconds?: number;
}
```

## FOCUS_CONTROL_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
FOCUS_CONTROL_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## FOCUS_CONTROL_STATE_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
FOCUS_CONTROL_STATE_VERSION =
  "0.1.0" as const
```

## FocusAcquisitionState

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FocusAcquisitionState =
  | "idle"
  | "acquiring"
  | "acquired"
  | "target-lost"
  | "locked";
```

## FocusControlMode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FocusControlMode =
  | "manual"
  | "single-af"
  | "continuous-af";
```

## FocusControlProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FocusControlProfile {
  schemaVersion:
    typeof FOCUS_CONTROL_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  supportedModes:
    readonly FocusControlMode[];
  actuator: {
    kind: "ideal-instantaneous";
    evidence:
      readonly EvidenceProvenance[];
  };
  continuousTargetLossPolicy:
    "hold-last-focus-require-explicit-reacquisition";
  supportedReleasePriorities:
    readonly FocusReleasePriority[];
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## FocusControlState

Immutable focus-controller state for MF, AF-S or AF-C.

The resolved focus is a finite distance along the optical axis in metres, or infinity.
Acquisition, loss, reacquisition and lock records explain why a target can be used. The
focus-release check is separate from shutter sequencing. The ideal actuator does not model
real AF accuracy or the physical time focusing takes.

```ts
export interface FocusControlState {
  version:
    typeof FOCUS_CONTROL_STATE_VERSION;
  stateId: string;
  sourceProfile: {
    profileId: string;
    profileVersion: string;
  };
  profileLimitations:
    readonly string[];
  mode:
    FocusControlMode;
  acquisitionState:
    FocusAcquisitionState;
  focus:
    FocusPlane;
  activeTargetId?: string;
  activeFocusAreaId?: string;
  lastEventTimeSeconds: number;
  focusResolvedAtSeconds:
    number;
  locked: boolean;
  lock?: {
    lockedAtSeconds: number;
    resumeAcquisitionState:
      Exclude<
        FocusAcquisitionState,
        "locked"
      >;
  };
  actuatorModel:
    "ideal-instantaneous";
  continuousTargetLossPolicy:
    "hold-last-focus-require-explicit-reacquisition";
  exposureModified: false;
  meteringModified: false;
  whiteBalanceModified: false;
  subjectTrackingRecognitionModeled:
    false;
  rendererCoordinatesConsumed:
    false;
  limitations:
    readonly string[];
}
```

## FocusReleaseGateAssessment

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FocusReleaseGateAssessment {
  priority:
    FocusReleasePriority;
  releaseAuthorized: boolean;
  reason:
    | "manual-focus-state"
    | "focus-acquired"
    | "focus-locked"
    | "release-priority-bypasses-focus-gate"
    | "focus-not-acquired"
    | "balanced-policy-not-modeled";
  requiresProfileSpecificBalancedPolicy:
    boolean;
  opticalFocusModified: false;
  exposureModified: false;
}
```

## FocusReleasePriority

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FocusReleasePriority =
  | "focus-priority"
  | "release-priority"
  | "balanced";
```

## FocusTargetControlEvent

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FocusTargetControlEvent =
  | "acquire"
  | "update";
```

## FocusTargetLossReason

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FocusTargetLossReason =
  | "occluded"
  | "out-of-frame"
  | "identity-lost"
  | "outside-focus-area";
```

## FocusTargetObservation

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FocusTargetObservation =
  | (FocusTargetObservationBase & {
      kind: "finite-surface";
      /**
       * Distance along the camera's optical axis (the same convention as
       * FocusPlane), not the renderer's ray length to the point.
       */
      longitudinalDistanceM: number;
    })
  | (FocusTargetObservationBase & {
      kind:
        "infinity-environment";
    })
  | (FocusTargetObservationBase & {
      kind: "unavailable";
      reason:
        FocusTargetLossReason;
    });
```

## FocusTargetResolution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FocusTargetResolution {
  state:
    FocusControlState;
  targetObservationApplied:
    boolean;
  focusChanged: boolean;
  acquisitionEvent:
    FocusTargetControlEvent;
  actuatorModel:
    "ideal-instantaneous";
  silentRetargetingPerformed:
    false;
}
```

## parseFocusControlProfile

Validates an untrusted focus-control profile and returns it normalized. Unknown enum values,
missing required fields and inconsistent scientific data are rejected.

Focus is a distance along the optical axis or infinity, never a distance on screen. The ideal
actuator focuses on the target observations it is given. It does not model a real AF sensor, a
focus-ring scale or focusing time.

```ts
export function parseFocusControlProfile(
  value: unknown
): FocusControlProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveFocusTargetObservation

Applies one target observation (target available or lost) under the selected AF-S or AF-C
policy, and records whether the target was acquired or reacquired.

The ideal actuator focuses on the observation as given. Target loss, reacquisition, focus
lock and release priority are separate state changes.

```ts
export function resolveFocusTargetObservation(
  input:
    ResolveFocusTargetObservationInput
): FocusTargetResolution;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveFocusTargetObservationInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveFocusTargetObservationInput {
  state:
    FocusControlState;
  stateId: string;
  event:
    FocusTargetControlEvent;
  observation:
    FocusTargetObservation;
}
```

## setFocusLock

Locks or unlocks focus. The physical focus plane does not change.

```ts
export function setFocusLock(
  input:
    SetFocusLockInput
): FocusControlState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SetFocusLockInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SetFocusLockInput {
  state:
    FocusControlState;
  stateId: string;
  locked: boolean;
  eventTimeSeconds: number;
}
```

## setManualFocusState

Returns the state after manually focusing on the given finite or infinity plane. No lens
actuator or focus-ring conversion is modelled.

```ts
export function setManualFocusState(
  input:
    SetManualFocusStateInput
): FocusControlState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SetManualFocusStateInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SetManualFocusStateInput {
  state:
    FocusControlState;
  stateId: string;
  focus:
    FocusPlane;
  eventTimeSeconds: number;
  commandId?: string;
}
```
