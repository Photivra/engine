# exposure/exposure-mode-resolver.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AperturePriorityAutoIsoExposureModeResolution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type AperturePriorityAutoIsoExposureModeResolution =
  | {
      resolverVersion:
        typeof EXPOSURE_MODE_RESOLVER_VERSION;
      mode:
        "aperture-priority";
      status: "resolved";
      axisOwnership: {
        aperture: "manual";
        shutter: "automatic";
        iso: "automatic";
      };
      targetId: string;
      targetSourceMeterSnapshot:
        ExposureMeterTarget["sourceMeterSnapshot"];
      referenceExposure:
        RelativeExposureControlAnchor;
      manualAperture: number;
      policy:
        AperturePriorityAutoIsoPolicy;
      baselineIso: number;
      idealShutterAtBaselineIsoSeconds:
        number;
      preferredShutterSeconds:
        number;
      afterMaximumIsoFallbackUsed:
        boolean;
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
        iso: number;
      };
      shutterResolution: {
        kind:
          | "continuous"
          | "discrete";
        quantized: boolean;
        clamped:
          | false
          | "minimum"
          | "maximum";
        selectionPolicy:
          | "not-longer-than-target"
          | "nearest-log2-shorter-on-tie";
      };
      isoResolution:
        PriorityAutoIsoResolutionCommon["isoResolution"];
      idealIsoBeforeConstraints: number;
      targetResidual:
        Extract<
          ExposureTargetResidual,
          { status: "resolved" }
        >;
      apertureMutatedByResolver: false;
      shutterResolvedByResolver: true;
      isoResolvedByResolver: true;
      exposureCompensationAppliedByResolver:
        false;
      meterRecomputedByResolver: false;
      flashPolicyApplied: false;
      safetyShiftApplied: false;
    }
  | {
      resolverVersion:
        typeof EXPOSURE_MODE_RESOLVER_VERSION;
      mode:
        "aperture-priority";
      status: "blocked";
      axisOwnership: {
        aperture: "manual";
        shutter: "automatic";
        iso: "automatic";
      };
      targetId: string;
      targetSourceMeterSnapshot:
        ExposureMeterTarget["sourceMeterSnapshot"];
      referenceExposure:
        RelativeExposureControlAnchor;
      manualAperture: number;
      policy:
        AperturePriorityAutoIsoPolicy;
      resolvedSettings: {
        aperture: number;
      };
      blocker:
        | "auto-iso-unsupported"
        | "auto-iso-unknown"
        | "target-no-signal";
      targetResidual: {
        status:
          "target-unresolved";
        state:
          "target-unresolved";
        reason:
          | "no-signal-target"
          | "auto-iso-unavailable";
      };
      apertureMutatedByResolver: false;
      exposureCompensationAppliedByResolver:
        false;
      meterRecomputedByResolver: false;
      flashPolicyApplied: false;
      safetyShiftApplied: false;
    };
```

## AperturePriorityAutoIsoPolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AperturePriorityAutoIsoPolicy
  extends AutoIsoBaselinePolicy {
  kind:
    "minimum-iso-until-slowest-preferred-shutter";
  slowestPreferredShutterSeconds:
    number;
  shutterSelectionPolicy:
    "not-longer-than-target";
  afterMaximumIso:
    | "allow-slower-shutter"
    | "hold-preferred-shutter";
}
```

## AperturePriorityExposureModeResolution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type AperturePriorityExposureModeResolution =
  | (AperturePriorityExposureResolutionBase & {
      status: "resolved";
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
        iso: number;
      };
      idealShutterSecondsBeforeConstraints:
        number;
      shutterResolution: {
        kind:
          | "continuous"
          | "discrete";
        quantizationPolicy:
          "nearest-log2-shorter-on-tie";
        quantized: boolean;
        clamped:
          | false
          | "minimum"
          | "maximum";
      };
      targetResidual: {
        status: "resolved";
        state:
          | "matched"
          | "under-target"
          | "over-target";
        targetExposureStops: number;
        achievedExposureStops: number;
        residualStops: number;
        limitingConstraint:
          ExposureResolutionConstraint;
      };
    })
  | (AperturePriorityExposureResolutionBase & {
      status: "blocked";
      resolvedSettings: {
        aperture: number;
        iso: number;
      };
      idealShutterSecondsBeforeConstraints:
        null;
      blocker: "target-no-signal";
      targetResidual: {
        status: "target-unresolved";
        state: "target-unresolved";
        reason: "no-signal-target";
      };
    });
```

## AutoIsoBaselinePolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AutoIsoBaselinePolicy {
  isoBaseline: "minimum-selectable";
  isoQuantizationPolicy:
    "nearest-log2-lower-on-tie";
  /** #505: optional photographer-set Auto ISO limits inside the body's Auto ISO range. */
  autoIsoLimits?: AutoIsoLimits;
}
```

## AutoIsoLimits

#505: the photographer's Auto ISO limits, a policy choice kept separate from what the body allows
(`capabilities.iso.autoIsoMinimum`/`autoIsoMaximum`, else the ISO range). Cameras let the
photographer cap Auto ISO, and some also raise its floor (for example the Nikon D850's "maximum
sensitivity", Fujifilm's per-preset default and maximum sensitivity, and Panasonic's separate upper
and lower Auto ISO limits; makers' manuals, see docs/USAGE.md).

Both values are ISO settings: inside the body's Auto ISO range and, on a discrete ISO grid, one of
its values, with `minimum` at most `maximum`. Anything else fails with
`InvalidScientificInputError`; the engine never clips a limit silently. When a limit is strictly
inside the body's range and the ISO is held there, the limiting constraint is `user-iso-maximum` or
`user-iso-minimum`; a limit equal to the body's bound adds nothing, and the body's `iso-maximum` or
`iso-minimum` is reported.

```ts
export interface AutoIsoLimits {
  /** The highest ISO Auto ISO may choose. */
  maximum: number;
  /** The lowest ISO Auto ISO may choose, and so its baseline. Default: the body's Auto ISO minimum. */
  minimum?: number;
}
```

## EXPOSURE_MODE_RESOLVER_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
EXPOSURE_MODE_RESOLVER_VERSION =
  "0.5.0" as const
```

## ExposureResolutionConstraint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureResolutionConstraint =
  | "none"
  | "iso-minimum"
  | "iso-maximum"
  | "user-iso-minimum"
  | "user-iso-maximum"
  | "iso-grid-quantization"
  | "shutter-minimum"
  | "shutter-maximum"
  | "shutter-grid-quantization"
  | "aperture-widest"
  | "aperture-narrowest"
  | "aperture-grid-quantization";
```

## ExposureTargetResidual

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureTargetResidual =
  | {
      status: "resolved";
      state:
        | "matched"
        | "under-target"
        | "over-target";
      targetExposureStops: number;
      achievedExposureStops: number;
      residualStops: number;
      limitingConstraint:
        ExposureResolutionConstraint;
    }
  | {
      status:
        "target-unresolved";
      state:
        "target-unresolved";
      reason:
        "no-signal-target";
    };
```

## ExposureTargetResidualState

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureTargetResidualState =
  | "matched"
  | "under-target"
  | "over-target"
  | "target-unresolved";
```

## FullAutoExposureModeResolution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type FullAutoExposureModeResolution =
  | (ProgramExposureResolutionBase & {
      mode:
        "full-auto-exposure";
      status: "resolved";
      axisOwnership: {
        aperture: "automatic";
        shutter: "automatic";
        iso: "automatic";
      };
      policy:
        FullAutoExposurePolicy;
      baselineIso: number;
      idealIsoBeforeConstraints:
        number;
      isoResolution:
        PriorityAutoIsoResolutionCommon["isoResolution"];
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
        iso: number;
      };
      targetResidual:
        Extract<
          ExposureTargetResidual,
          { status: "resolved" }
        >;
      autofocusResolved: false;
      whiteBalanceResolved: false;
      flashResolved: false;
      driveResolved: false;
      sceneRecognitionResolved: false;
      stabilizationPolicyResolved:
        false;
    })
  | {
      resolverVersion:
        typeof EXPOSURE_MODE_RESOLVER_VERSION;
      mode:
        "full-auto-exposure";
      status: "blocked";
      axisOwnership: {
        aperture: "automatic";
        shutter: "automatic";
        iso: "automatic";
      };
      policy:
        FullAutoExposurePolicy;
      targetId: string;
      targetSourceMeterSnapshot:
        ExposureMeterTarget["sourceMeterSnapshot"];
      referenceExposure:
        RelativeExposureControlAnchor;
      blocker:
        | "target-no-signal"
        | "auto-iso-unsupported"
        | "auto-iso-unknown";
      targetResidual: {
        status: "target-unresolved";
        state: "target-unresolved";
        reason:
          | "no-signal-target"
          | "auto-iso-unavailable";
      };
      exposureCompensationAppliedByResolver:
        false;
      meterRecomputedByResolver: false;
      flashPolicyApplied: false;
      safetyShiftApplied: false;
      autofocusResolved: false;
      whiteBalanceResolved: false;
      flashResolved: false;
      driveResolved: false;
      sceneRecognitionResolved: false;
      stabilizationPolicyResolved:
        false;
    };
```

## FullAutoExposurePolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FullAutoExposurePolicy {
  kind:
    "generic-program-line-minimum-iso";
  programLine:
    ExposureProgramLineProfile;
  isoBaseline:
    "minimum-selectable";
  isoQuantizationPolicy:
    "nearest-log2-lower-on-tie";
  /** #505: optional photographer-set Auto ISO limits inside the body's Auto ISO range. */
  autoIsoLimits?: AutoIsoLimits;
}
```

## ManualExposureModeResolution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ManualExposureModeResolution =
  | (ManualExposureResolutionBase & {
      status: "resolved";
      isoControl: "manual";
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
        iso: number;
      };
      idealIsoBeforeConstraints:
        null;
      isoResolution: {
        kind: "manual-preserved";
        quantized: false;
        clamped: false;
      };
      targetResidual:
        ExposureTargetResidual;
    })
  | (ManualExposureResolutionBase & {
      status: "resolved";
      isoControl: "automatic";
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
        iso: number;
      };
      idealIsoBeforeConstraints:
        number;
      isoResolution: {
        kind:
          | "continuous"
          | "discrete";
        quantizationPolicy:
          "nearest-log2-lower-on-tie";
        quantized: boolean;
        clamped:
          | false
          | "minimum"
          | "maximum";
      };
      targetResidual: {
        status: "resolved";
        state:
          | "matched"
          | "under-target"
          | "over-target";
        targetExposureStops: number;
        achievedExposureStops: number;
        residualStops: number;
        limitingConstraint:
          ExposureResolutionConstraint;
      };
    })
  | (ManualExposureResolutionBase & {
      status: "blocked";
      isoControl: "automatic";
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
      };
      idealIsoBeforeConstraints:
        null;
      blocker:
        | "auto-iso-unsupported"
        | "auto-iso-unknown"
        | "target-no-signal";
      targetResidual: {
        status:
          "target-unresolved";
        state:
          "target-unresolved";
        reason:
          "no-signal-target" |
          "auto-iso-unavailable";
      };
    });
```

## ManualIsoControl

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ManualIsoControl =
  | {
      kind: "manual";
      iso: number;
    }
  | {
      kind: "automatic";
      quantizationPolicy:
        "nearest-log2-lower-on-tie";
      /** #505: optional photographer-set Auto ISO limits inside the body's Auto ISO range. */
      autoIsoLimits?: AutoIsoLimits;
    };
```

## ProgramAutoExposureModeResolution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ProgramAutoExposureModeResolution =
  | (ProgramExposureResolutionBase & {
      mode: "program-auto";
      status: "resolved";
      axisOwnership: {
        aperture: "automatic";
        shutter: "automatic";
        iso: "manual";
      };
      isoControl: "manual";
      manualIso: number;
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
        iso: number;
      };
      targetResidual:
        Extract<
          ExposureTargetResidual,
          { status: "resolved" }
        >;
    })
  | (ProgramExposureResolutionBase & {
      mode: "program-auto";
      status: "resolved";
      axisOwnership: {
        aperture: "automatic";
        shutter: "automatic";
        iso: "automatic";
      };
      isoControl: "automatic";
      baselineIso: number;
      idealIsoBeforeConstraints:
        number;
      isoResolution:
        PriorityAutoIsoResolutionCommon["isoResolution"];
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
        iso: number;
      };
      targetResidual:
        Extract<
          ExposureTargetResidual,
          { status: "resolved" }
        >;
      /**
       * #504: present only with `isoControl.slowestPreferredShutter`. `applied` is true when the line's
       * shutter was longer than the slowest preferred shutter and was held; `afterMaximumIsoFallbackUsed`
       * when the slower-shutter fallback ran at the Auto ISO maximum. `programLineSelection` stays the
       * line's own selection.
       */
      slowestPreferredShutter?: ProgramSlowestPreferredShutterPolicy & {
        applied: boolean;
        afterMaximumIsoFallbackUsed: boolean;
      };
    })
  | {
      resolverVersion:
        typeof EXPOSURE_MODE_RESOLVER_VERSION;
      mode: "program-auto";
      status: "blocked";
      axisOwnership: {
        aperture: "automatic";
        shutter: "automatic";
        iso: "manual" | "automatic";
      };
      isoControl: "manual" | "automatic";
      targetId: string;
      targetSourceMeterSnapshot:
        ExposureMeterTarget["sourceMeterSnapshot"];
      referenceExposure:
        RelativeExposureControlAnchor;
      blocker:
        | "target-no-signal"
        | "auto-iso-unsupported"
        | "auto-iso-unknown";
      targetResidual: {
        status: "target-unresolved";
        state: "target-unresolved";
        reason:
          | "no-signal-target"
          | "auto-iso-unavailable";
      };
      exposureCompensationAppliedByResolver:
        false;
      meterRecomputedByResolver: false;
      flashPolicyApplied: false;
      safetyShiftApplied: false;
    };
```

## ProgramAutoIsoControl

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ProgramAutoIsoControl =
  | {
      kind: "manual";
      iso: number;
    }
  | {
      kind: "automatic";
      isoBaseline:
        "minimum-selectable";
      isoQuantizationPolicy:
        "nearest-log2-lower-on-tie";
      /** #505: optional photographer-set Auto ISO limits inside the body's Auto ISO range. */
      autoIsoLimits?: AutoIsoLimits;
      /**
       * #504: optionally hold the program line's shutter at or faster than a slowest preferred shutter
       * before the ISO rises (for example from `estimateAutoIsoSlowestShutter()`). Absent, the program line
       * is followed as before.
       */
      slowestPreferredShutter?: ProgramSlowestPreferredShutterPolicy;
    };
```

## ProgramLineSelectionDiagnostics

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProgramLineSelectionDiagnostics {
  profileId: string;
  profileVersion: string;
  requestedOpticalExposureStopsFromReference:
    number;
  selectedOpticalExposureStopsFromReference:
    number;
  position:
    | "within-line"
    | "below-line"
    | "above-line";
  interpolationPhase:
    number | null;
  idealAperture: number;
  idealShutterSeconds: number;
  resolvedAperture: number;
  resolvedShutterSeconds: number;
  apertureQuantized: boolean;
  shutterQuantized: boolean;
  apertureClamped:
    | false
    | "widest"
    | "narrowest";
  shutterClamped:
    | false
    | "minimum"
    | "maximum";
}
```

## ProgramSlowestPreferredShutterPolicy

#504: Program + Auto ISO's slowest preferred shutter, the two-axis policy of Aperture Priority + Auto
ISO applied to the program line. When the line asks for a longer shutter than
`slowestPreferredShutterSeconds`, the shutter is held there (snapped, never longer) with the line's
aperture, and Auto ISO makes up the rest. At the Auto ISO maximum, `afterMaximumIso` decides:
`"allow-slower-shutter"` lengthens the shutter toward the target, but never past the program line's
own shutter; `"hold-preferred-shutter"` keeps it and leaves the exposure under target.

```ts
export interface ProgramSlowestPreferredShutterPolicy {
  slowestPreferredShutterSeconds: number;
  afterMaximumIso:
    | "allow-slower-shutter"
    | "hold-preferred-shutter";
}
```

## RelativeExposureControlAnchor

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RelativeExposureControlAnchor {
  aperture: number;
  shutterSeconds: number;
  iso: number;
}
```

## resolveAperturePriorityAutoIsoExposureMode

Aperture Priority with Auto ISO. Keeps the aperture fixed, follows the declared minimum-shutter
policy, and uses Auto ISO (within its limits) to make up the rest of the exposure.

Every exposure mode applies its control policy to one shared relative exposure equation, with an
explicit reference anchor. Exposure compensation is already part of the frozen meter target. Manual
settings are never changed. Automatic settings snap to the declared setting grids, and the result
reports the signed leftover (residual) stops and any limits hit. A target with zero signal cannot
be used to make up an exposure.

```ts
export function resolveAperturePriorityAutoIsoExposureMode(
  input:
    ResolveAperturePriorityAutoIsoExposureModeInput
): AperturePriorityAutoIsoExposureModeResolution;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveAperturePriorityAutoIsoExposureModeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveAperturePriorityAutoIsoExposureModeInput {
  target: ExposureMeterTarget;
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  referenceExposure:
    RelativeExposureControlAnchor;
  manualAperture: number;
  policy: AperturePriorityAutoIsoPolicy;
}
```

## resolveAperturePriorityExposureMode

Resolves Aperture Priority with manual ISO.

The caller sets aperture and ISO. Only the shutter is automatic. The target
and reference use the same relative exposure model as Manual + Auto ISO; no
new exposure equation is added for this mode.

```ts
export function resolveAperturePriorityExposureMode(
  input:
    ResolveAperturePriorityExposureModeInput
): AperturePriorityExposureModeResolution;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveAperturePriorityExposureModeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveAperturePriorityExposureModeInput {
  target: ExposureMeterTarget;
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  referenceExposure:
    RelativeExposureControlAnchor;
  manualAperture: number;
  manualIso: number;
  shutterQuantizationPolicy:
    "nearest-log2-shorter-on-tie";
}
```

## resolveFullAutoExposureMode

Full Auto. Chooses aperture, shutter and ISO under an explicit generic Full Auto exposure policy.
Autofocus, white balance (WB), flash, drive mode and scene recognition are not resolved.

Every exposure mode applies its control policy to one shared relative exposure equation, with an
explicit reference anchor. Exposure compensation is already part of the frozen meter target. Manual
settings are never changed. Automatic settings snap to the declared setting grids, and the result
reports the signed leftover (residual) stops and any limits hit. A target with zero signal cannot
be used to make up an exposure.

```ts
export function resolveFullAutoExposureMode(
  input:
    ResolveFullAutoExposureModeInput
): FullAutoExposureModeResolution;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveFullAutoExposureModeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveFullAutoExposureModeInput {
  target: ExposureMeterTarget;
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  referenceExposure:
    RelativeExposureControlAnchor;
  policy:
    FullAutoExposurePolicy;
}
```

## resolveManualExposureMode

Resolves Manual exposure with either manual ISO or Auto ISO.

The caller sets aperture and shutter; they are never changed. The relative
meter target is normalized by an explicit reference exposure anchor. No
ISO 100 or other hidden absolute calibration is assumed.

```ts
export function resolveManualExposureMode(
  input:
    ResolveManualExposureModeInput
): ManualExposureModeResolution;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveManualExposureModeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveManualExposureModeInput {
  target: ExposureMeterTarget;
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  referenceExposure:
    RelativeExposureControlAnchor;
  manualAperture: number;
  manualShutterSeconds: number;
  isoControl: ManualIsoControl;
}
```

## resolveProgramAutoExposureMode

Program auto exposure. Follows the declared generic program line in log2 exposure space, snaps
aperture and shutter to their grids, and can use Auto ISO for any exposure left over.

Every exposure mode applies its control policy to one shared relative exposure equation, with an
explicit reference anchor. Exposure compensation is already part of the frozen meter target. Manual
settings are never changed. Automatic settings snap to the declared setting grids, and the result
reports the signed leftover (residual) stops and any limits hit. A target with zero signal cannot
be used to make up an exposure.

```ts
export function resolveProgramAutoExposureMode(
  input:
    ResolveProgramAutoExposureModeInput
): ProgramAutoExposureModeResolution;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveProgramAutoExposureModeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveProgramAutoExposureModeInput {
  target: ExposureMeterTarget;
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  referenceExposure:
    RelativeExposureControlAnchor;
  programLine:
    ExposureProgramLineProfile;
  isoControl:
    ProgramAutoIsoControl;
}
```

## resolveShutterPriorityExposureMode

Shutter Priority. Keeps the shutter fixed and chooses the aperture, plus optional Auto ISO, within
exactly what the equipment can do.

Every exposure mode applies its control policy to one shared relative exposure equation, with an
explicit reference anchor. Exposure compensation is already part of the frozen meter target. Manual
settings are never changed. Automatic settings snap to the declared setting grids, and the result
reports the signed leftover (residual) stops and any limits hit. A target with zero signal cannot
be used to make up an exposure.

```ts
export function resolveShutterPriorityExposureMode(
  input:
    ResolveShutterPriorityExposureModeInput
): ShutterPriorityExposureModeResolution;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveShutterPriorityExposureModeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveShutterPriorityExposureModeInput {
  target: ExposureMeterTarget;
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  referenceExposure:
    RelativeExposureControlAnchor;
  manualShutterSeconds: number;
  isoControl:
    | {
        kind: "manual";
        iso: number;
        apertureQuantizationPolicy:
          "nearest-log2-narrower-on-tie";
      }
    | {
        kind: "automatic";
        policy:
          ShutterPriorityAutoIsoPolicy;
      };
}
```

## ShutterPriorityAutoIsoPolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ShutterPriorityAutoIsoPolicy
  extends AutoIsoBaselinePolicy {
  kind:
    "minimum-iso-aperture-first";
  apertureSelectionPolicy:
    "not-wider-than-target";
}
```

## ShutterPriorityExposureModeResolution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ShutterPriorityExposureModeResolution =
  | (ShutterPriorityResolutionBase & {
      status: "resolved";
      axisOwnership: {
        aperture: "automatic";
        shutter: "manual";
        iso: "manual";
      };
      isoControl: "manual";
      manualIso: number;
      idealApertureBeforeConstraints:
        number;
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
        iso: number;
      };
      apertureResolution: {
        kind:
          | "continuous"
          | "discrete";
        quantizationPolicy:
          "nearest-log2-narrower-on-tie";
        quantized: boolean;
        clamped:
          | false
          | "widest"
          | "narrowest";
      };
      targetResidual:
        Extract<
          ExposureTargetResidual,
          { status: "resolved" }
        >;
    })
  | (ShutterPriorityResolutionBase & {
      status: "resolved";
      axisOwnership: {
        aperture: "automatic";
        shutter: "manual";
        iso: "automatic";
      };
      isoControl: "automatic";
      policy:
        ShutterPriorityAutoIsoPolicy;
      baselineIso: number;
      idealApertureAtBaselineIso:
        number;
      resolvedSettings: {
        aperture: number;
        shutterSeconds: number;
        iso: number;
      };
      apertureResolution: {
        kind:
          | "continuous"
          | "discrete";
        quantized: boolean;
        clamped:
          | false
          | "widest"
          | "narrowest";
        selectionPolicy:
          "not-wider-than-target";
      };
      idealIsoBeforeConstraints: number;
      isoResolution:
        PriorityAutoIsoResolutionCommon["isoResolution"];
      targetResidual:
        Extract<
          ExposureTargetResidual,
          { status: "resolved" }
        >;
    })
  | (ShutterPriorityResolutionBase & {
      status: "blocked";
      axisOwnership: {
        aperture: "automatic";
        shutter: "manual";
        iso: "manual" | "automatic";
      };
      isoControl: "manual" | "automatic";
      resolvedSettings: {
        shutterSeconds: number;
      };
      blocker:
        | "auto-iso-unsupported"
        | "auto-iso-unknown"
        | "target-no-signal";
      targetResidual: {
        status:
          "target-unresolved";
        state:
          "target-unresolved";
        reason:
          | "no-signal-target"
          | "auto-iso-unavailable";
      };
    });
```
