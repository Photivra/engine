// SPDX-License-Identifier: Apache-2.0

/**
 * Exposure modes: Manual, Aperture Priority, Shutter Priority, Program and Full Auto, each with
 * manual ISO or Auto ISO where the mode allows it.
 *
 * Every exposure mode applies its control policy to one shared relative exposure equation, with an
 * explicit reference anchor. Exposure compensation is already part of the frozen meter target. Manual
 * settings are never changed. Automatic settings snap to the declared setting grids, and the result
 * reports the signed leftover (residual) stops and any limits hit. A target with zero signal cannot
 * be used to make up an exposure.
 *
 * The relative meter target is normalized by an explicit reference exposure anchor. No ISO 100 or
 * other hidden absolute calibration is assumed.
 * @see docs/USAGE.md for the equations, units, coordinate conventions, known blockers and support
 * limits.
 */

import { InvalidScientificInputError } from "../core/validation.js";
import type {
  ResolvedGenericEquipmentExposureCapabilities,
  ResolvedNumericSettingGrid
} from "../equipment/exposure-capabilities.js";
import {
  EXPOSURE_METER_TARGET_SCHEMA_VERSION,
  type ExposureMeterTarget
} from "./metering-target.js";
import {
  parseExposureProgramLineProfile,
  type ExposureProgramLineProfile
} from "./program-line.js";
import { rejectUnknownFields, requireInputKeys, requireTrimmedConfigString as requireNonEmptyString, requireInputPositiveFinite as requirePositiveFinite } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

type UnknownRecord = Record<string, unknown>;

export const EXPOSURE_MODE_RESOLVER_VERSION =
  "0.5.0" as const;

export interface RelativeExposureControlAnchor {
  aperture: number;
  shutterSeconds: number;
  iso: number;
}

/**
 * #505: the photographer's Auto ISO limits, a policy choice kept separate from what the body allows
 * (`capabilities.iso.autoIsoMinimum`/`autoIsoMaximum`, else the ISO range). Cameras let the
 * photographer cap Auto ISO, and some also raise its floor (for example the Nikon D850's "maximum
 * sensitivity", Fujifilm's per-preset default and maximum sensitivity, and Panasonic's separate upper
 * and lower Auto ISO limits; makers' manuals, see docs/USAGE.md).
 *
 * Both values are ISO settings: inside the body's Auto ISO range and, on a discrete ISO grid, one of
 * its values, with `minimum` at most `maximum`. Anything else fails with
 * `InvalidScientificInputError`; the engine never clips a limit silently. When a limit is strictly
 * inside the body's range and the ISO is held there, the limiting constraint is `user-iso-maximum` or
 * `user-iso-minimum`; a limit equal to the body's bound adds nothing, and the body's `iso-maximum` or
 * `iso-minimum` is reported.
 */
export interface AutoIsoLimits {
  /** The highest ISO Auto ISO may choose. */
  maximum: number;
  /** The lowest ISO Auto ISO may choose, and so its baseline. Default: the body's Auto ISO minimum. */
  minimum?: number;
}

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

export type ExposureTargetResidualState =
  | "matched"
  | "under-target"
  | "over-target"
  | "target-unresolved";

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

interface ManualExposureResolutionBase {
  resolverVersion:
    typeof EXPOSURE_MODE_RESOLVER_VERSION;
  mode: "manual";
  axisOwnership: {
    aperture: "manual";
    shutter: "manual";
    iso: "manual" | "automatic";
  };
  targetId: string;
  targetSourceMeterSnapshot:
    ExposureMeterTarget["sourceMeterSnapshot"];
  capabilityProfiles: {
    bodyProfileId: string;
    bodyProfileVersion: string;
    lensProfileId: string;
    lensProfileVersion: string;
  };
  selectedFocalLengthMm: number;
  referenceExposure:
    RelativeExposureControlAnchor;
  manualAperture: number;
  manualShutterSeconds: number;
  apertureMutatedByResolver: false;
  shutterMutatedByResolver: false;
  exposureCompensationAppliedByResolver:
    false;
  meterRecomputedByResolver: false;
  isoNoiseOrGainTopologyInferred: false;
  flashPolicyApplied: false;
  safetyShiftApplied: false;
}

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

interface AperturePriorityExposureResolutionBase {
  resolverVersion:
    typeof EXPOSURE_MODE_RESOLVER_VERSION;
  mode: "aperture-priority";
  axisOwnership: {
    aperture: "manual";
    shutter: "automatic";
    iso: "manual";
  };
  targetId: string;
  targetSourceMeterSnapshot:
    ExposureMeterTarget["sourceMeterSnapshot"];
  capabilityProfiles: {
    bodyProfileId: string;
    bodyProfileVersion: string;
    lensProfileId: string;
    lensProfileVersion: string;
  };
  selectedFocalLengthMm: number;
  referenceExposure:
    RelativeExposureControlAnchor;
  manualAperture: number;
  manualIso: number;
  apertureMutatedByResolver: false;
  isoMutatedByResolver: false;
  shutterResolvedByResolver: true;
  exposureCompensationAppliedByResolver:
    false;
  meterRecomputedByResolver: false;
  isoNoiseOrGainTopologyInferred: false;
  flashPolicyApplied: false;
  safetyShiftApplied: false;
}

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

export interface AutoIsoBaselinePolicy {
  isoBaseline: "minimum-selectable";
  isoQuantizationPolicy:
    "nearest-log2-lower-on-tie";
  /** #505: optional photographer-set Auto ISO limits inside the body's Auto ISO range. */
  autoIsoLimits?: AutoIsoLimits;
}

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

export interface ShutterPriorityAutoIsoPolicy
  extends AutoIsoBaselinePolicy {
  kind:
    "minimum-iso-aperture-first";
  apertureSelectionPolicy:
    "not-wider-than-target";
}

export interface ResolveAperturePriorityAutoIsoExposureModeInput {
  target: ExposureMeterTarget;
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  referenceExposure:
    RelativeExposureControlAnchor;
  manualAperture: number;
  policy: AperturePriorityAutoIsoPolicy;
}

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

interface PriorityAutoIsoResolutionCommon {
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
  idealIsoBeforeConstraints: number;
}

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

interface ShutterPriorityResolutionBase {
  resolverVersion:
    typeof EXPOSURE_MODE_RESOLVER_VERSION;
  mode: "shutter-priority";
  targetId: string;
  targetSourceMeterSnapshot:
    ExposureMeterTarget["sourceMeterSnapshot"];
  referenceExposure:
    RelativeExposureControlAnchor;
  manualShutterSeconds: number;
  shutterMutatedByResolver: false;
  apertureResolvedByResolver: true;
  exposureCompensationAppliedByResolver:
    false;
  meterRecomputedByResolver: false;
  flashPolicyApplied: false;
  safetyShiftApplied: false;
}

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

/**
 * #504: Program + Auto ISO's slowest preferred shutter, the two-axis policy of Aperture Priority + Auto
 * ISO applied to the program line. When the line asks for a longer shutter than
 * `slowestPreferredShutterSeconds`, the shutter is held there (snapped, never longer) with the line's
 * aperture, and Auto ISO makes up the rest. At the Auto ISO maximum, `afterMaximumIso` decides:
 * `"allow-slower-shutter"` lengthens the shutter toward the target, but never past the program line's
 * own shutter; `"hold-preferred-shutter"` keeps it and leaves the exposure under target.
 */
export interface ProgramSlowestPreferredShutterPolicy {
  slowestPreferredShutterSeconds: number;
  afterMaximumIso:
    | "allow-slower-shutter"
    | "hold-preferred-shutter";
}

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

export interface ResolveFullAutoExposureModeInput {
  target: ExposureMeterTarget;
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  referenceExposure:
    RelativeExposureControlAnchor;
  policy:
    FullAutoExposurePolicy;
}

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

interface ProgramExposureResolutionBase {
  resolverVersion:
    typeof EXPOSURE_MODE_RESOLVER_VERSION;
  targetId: string;
  targetSourceMeterSnapshot:
    ExposureMeterTarget["sourceMeterSnapshot"];
  referenceExposure:
    RelativeExposureControlAnchor;
  programLineSelection:
    ProgramLineSelectionDiagnostics;
  apertureResolvedByResolver: true;
  shutterResolvedByResolver: true;
  exposureCompensationAppliedByResolver:
    false;
  meterRecomputedByResolver: false;
  flashPolicyApplied: false;
  safetyShiftApplied: false;
}

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

function requireRecord(
  value: unknown,
  path: string
): UnknownRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new InvalidConfigurationError(
      path + " must be an object."
    );
  }
  return value as UnknownRecord;
}

function settingEquals(
  left: number,
  right: number
): boolean {
  const scale = Math.max(
    Math.abs(left),
    Math.abs(right),
    1
  );
  return (
    Math.abs(left - right) <=
    Number.EPSILON * 32 * scale
  );
}

function validateSettingAgainstGrid(
  value: number,
  minimum: number,
  maximum: number,
  grid: ResolvedNumericSettingGrid,
  path: string
): void {
  if (
    value < minimum ||
    value > maximum
  ) {
    throw new InvalidScientificInputError(
      path +
        " lies outside the resolved equipment capability range."
    );
  }

  if (
    grid.kind ===
    "discrete-values" &&
    !grid.values.some(
      (candidate) =>
        settingEquals(
          candidate,
          value
        )
    )
  ) {
    throw new InvalidScientificInputError(
      path +
        " is not present in the resolved discrete equipment setting grid."
    );
  }
}

function validateTarget(
  value: unknown
): ExposureMeterTarget {
  const record = requireRecord(
    value,
    "target"
  );
  if (
    record.schemaVersion !==
    EXPOSURE_METER_TARGET_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'target.schemaVersion must be "' +
        EXPOSURE_METER_TARGET_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.scientificStatus !==
      "approximation" ||
    record.inputDomain !==
      "relative-pre-exposure-linear-signal" ||
    record.intendedConsumer !==
      "exposure-mode-resolver" ||
    record.automaticExposureResolved !==
      false ||
    record.sourceMeterSnapshotPreserved !==
      true
  ) {
    throw new InvalidScientificInputError(
      "target does not satisfy the exposure-mode resolver boundary."
    );
  }

  const targetId = record.targetId;
  if (
    typeof targetId !== "string" ||
    targetId.trim().length === 0
  ) {
    throw new InvalidConfigurationError(
      "target.targetId must be a non-empty string."
    );
  }

  requireRecord(
    record.sourceMeterSnapshot,
    "target.sourceMeterSnapshot"
  );

  if (
    record.status === "resolved"
  ) {
    requirePositiveFinite(
      record
        .requiredExposureScaleToTarget,
      "target.requiredExposureScaleToTarget"
    );
    if (
      typeof record
        .exposureOffsetStopsToTarget !==
        "number" ||
      !Number.isFinite(
        record
          .exposureOffsetStopsToTarget
      )
    ) {
      throw new InvalidScientificInputError(
        "target.exposureOffsetStopsToTarget must be finite."
      );
    }
  } else if (
    record.status !== "no-signal"
  ) {
    throw new InvalidConfigurationError(
      "target.status is invalid."
    );
  }

  return value as ExposureMeterTarget;
}

function validateResolvedGrid(
  grid: ResolvedNumericSettingGrid,
  minimum: number,
  maximum: number,
  path: string
): void {
  requireRecord(grid, path);
  if (
    grid.kind ===
    "continuous-within-range"
  ) {
    return;
  }
  if (
    grid.kind !== "discrete-values" ||
    !Array.isArray(grid.values) ||
    grid.values.length === 0
  ) {
    throw new InvalidConfigurationError(
      path +
        " must be a continuous grid or a non-empty discrete-values grid."
    );
  }

  let previous =
    Number.NEGATIVE_INFINITY;
  for (
    let index = 0;
    index < grid.values.length;
    index += 1
  ) {
    const value =
      requirePositiveFinite(
        grid.values[index],
        path +
          ".values[" +
          index +
          "]"
      );
    if (value <= previous) {
      throw new InvalidScientificInputError(
        path +
          ".values must be strictly increasing with no duplicates."
      );
    }
    if (
      value < minimum ||
      value > maximum
    ) {
      throw new InvalidScientificInputError(
        path +
          ".values must stay inside the resolved capability range."
      );
    }
    previous = value;
  }
}

function validateCapabilities(
  value:
    ResolvedGenericEquipmentExposureCapabilities
): void {
  requireRecord(value, "capabilities");
  for (const key of ["aperture", "shutter", "iso", "bodyProfile", "lensProfile"] as const) {
    requireRecord(value[key], "capabilities." + key);
  }
  if (
    value.schemaVersion !== "0.1.0" ||
    value.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidScientificInputError(
      "capabilities do not satisfy the generic equipment exposure-capability boundary."
    );
  }
  requirePositiveFinite(
    value.selectedFocalLengthMm,
    "capabilities.selectedFocalLengthMm"
  );
  requirePositiveFinite(
    value.aperture
      .widestAvailableFNumber,
    "capabilities.aperture.widestAvailableFNumber"
  );
  requirePositiveFinite(
    value.aperture
      .narrowestAvailableFNumber,
    "capabilities.aperture.narrowestAvailableFNumber"
  );
  requirePositiveFinite(
    value.shutter.minimumSeconds,
    "capabilities.shutter.minimumSeconds"
  );
  requirePositiveFinite(
    value.shutter.maximumSeconds,
    "capabilities.shutter.maximumSeconds"
  );
  requirePositiveFinite(
    value.iso.minimum,
    "capabilities.iso.minimum"
  );
  requirePositiveFinite(
    value.iso.maximum,
    "capabilities.iso.maximum"
  );

  if (
    value.aperture
      .widestAvailableFNumber >
    value.aperture
      .narrowestAvailableFNumber
  ) {
    throw new InvalidScientificInputError(
      "capabilities aperture range is invalid."
    );
  }
  if (
    value.shutter.minimumSeconds >
    value.shutter.maximumSeconds
  ) {
    throw new InvalidScientificInputError(
      "capabilities shutter range is invalid."
    );
  }
  if (
    value.iso.minimum >
    value.iso.maximum
  ) {
    throw new InvalidScientificInputError(
      "capabilities ISO range is invalid."
    );
  }

  const hasAutoMinimum =
    value.iso.autoIsoMinimum !==
    undefined;
  const hasAutoMaximum =
    value.iso.autoIsoMaximum !==
    undefined;
  if (
    hasAutoMinimum !==
    hasAutoMaximum
  ) {
    throw new InvalidScientificInputError(
      "capabilities Auto ISO bounds must provide both minimum and maximum or neither."
    );
  }
  if (
    hasAutoMinimum &&
    hasAutoMaximum
  ) {
    const autoMinimum =
      requirePositiveFinite(
        value.iso.autoIsoMinimum,
        "capabilities.iso.autoIsoMinimum"
      );
    const autoMaximum =
      requirePositiveFinite(
        value.iso.autoIsoMaximum,
        "capabilities.iso.autoIsoMaximum"
      );
    if (
      value.iso
        .autoIsoAvailability !==
        "supported" ||
      autoMinimum >
        autoMaximum ||
      autoMinimum <
        value.iso.minimum ||
      autoMaximum >
        value.iso.maximum
    ) {
      throw new InvalidScientificInputError(
        "capabilities Auto ISO bounds must be ordered, inside the manual ISO range, and used only when Auto ISO is supported."
      );
    }
  }

  requireNonEmptyString(
    value.bodyProfile.profileId,
    "capabilities.bodyProfile.profileId"
  );
  requireNonEmptyString(
    value.bodyProfile.profileVersion,
    "capabilities.bodyProfile.profileVersion"
  );
  requireNonEmptyString(
    value.lensProfile.profileId,
    "capabilities.lensProfile.profileId"
  );
  requireNonEmptyString(
    value.lensProfile.profileVersion,
    "capabilities.lensProfile.profileVersion"
  );

  if (
    value.iso
      .autoIsoAvailability !==
      "supported" &&
    value.iso
      .autoIsoAvailability !==
      "unsupported" &&
    value.iso
      .autoIsoAvailability !==
      "unknown"
  ) {
    throw new InvalidConfigurationError(
      "capabilities.iso.autoIsoAvailability is invalid."
    );
  }

  validateResolvedGrid(
    value.aperture.settingGrid,
    value.aperture
      .widestAvailableFNumber,
    value.aperture
      .narrowestAvailableFNumber,
    "capabilities.aperture.settingGrid"
  );
  validateResolvedGrid(
    value.shutter.settingGrid,
    value.shutter.minimumSeconds,
    value.shutter.maximumSeconds,
    "capabilities.shutter.settingGrid"
  );
  validateResolvedGrid(
    value.iso.settingGrid,
    value.iso.minimum,
    value.iso.maximum,
    "capabilities.iso.settingGrid"
  );
}

function validateReferenceExposure(
  reference:
    RelativeExposureControlAnchor,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): RelativeExposureControlAnchor {
  requireRecord(reference, "referenceExposure");
  const aperture =
    requirePositiveFinite(
      reference.aperture,
      "referenceExposure.aperture"
    );
  const shutterSeconds =
    requirePositiveFinite(
      reference.shutterSeconds,
      "referenceExposure.shutterSeconds"
    );
  const iso =
    requirePositiveFinite(
      reference.iso,
      "referenceExposure.iso"
    );

  validateSettingAgainstGrid(
    aperture,
    capabilities.aperture
      .widestAvailableFNumber,
    capabilities.aperture
      .narrowestAvailableFNumber,
    capabilities.aperture
      .settingGrid,
    "referenceExposure.aperture"
  );
  validateSettingAgainstGrid(
    shutterSeconds,
    capabilities.shutter
      .minimumSeconds,
    capabilities.shutter
      .maximumSeconds,
    capabilities.shutter
      .settingGrid,
    "referenceExposure.shutterSeconds"
  );
  validateSettingAgainstGrid(
    iso,
    capabilities.iso.minimum,
    capabilities.iso.maximum,
    capabilities.iso.settingGrid,
    "referenceExposure.iso"
  );

  return {
    aperture,
    shutterSeconds,
    iso
  };
}

function opticalExposureFactor(
  aperture: number,
  shutterSeconds: number,
  reference:
    RelativeExposureControlAnchor
): number {
  const current =
    shutterSeconds /
    (aperture * aperture);
  const referenceOptical =
    reference.shutterSeconds /
    (reference.aperture *
      reference.aperture);
  const factor =
    current /
    referenceOptical;
  if (
    !Number.isFinite(factor) ||
    factor <= 0
  ) {
    throw new InvalidScientificInputError(
      "Optical exposure factor must remain finite and greater than zero."
    );
  }
  return factor;
}

function targetResidual(
  target:
    Extract<
      ExposureMeterTarget,
      { status: "resolved" }
    >,
  achievedScale: number,
  limitingConstraint:
    ExposureResolutionConstraint
): Extract<
  ExposureTargetResidual,
  { status: "resolved" }
>;
function targetResidual(
  target:
    ExposureMeterTarget,
  achievedScale: number,
  limitingConstraint:
    ExposureResolutionConstraint
): ExposureTargetResidual;
function targetResidual(
  target:
    ExposureMeterTarget,
  achievedScale: number,
  limitingConstraint:
    ExposureResolutionConstraint
): ExposureTargetResidual {
  if (
    target.status ===
    "no-signal"
  ) {
    return {
      status:
        "target-unresolved",
      state:
        "target-unresolved",
      reason: "no-signal-target"
    };
  }

  const targetScale =
    target
      .requiredExposureScaleToTarget;
  const targetStops =
    target
      .exposureOffsetStopsToTarget;
  const achievedStops =
    Math.log2(achievedScale);
  const residualStops =
    Math.log2(
      targetScale /
      achievedScale
    );

  if (
    !Number.isFinite(
      achievedStops
    ) ||
    !Number.isFinite(
      residualStops
    )
  ) {
    throw new InvalidScientificInputError(
      "Exposure target residual must remain finite."
    );
  }

  const toleranceStops =
    1e-12;
  const state =
    Math.abs(residualStops) <=
    toleranceStops
      ? "matched"
      : residualStops > 0
        ? "under-target"
        : "over-target";

  return {
    status: "resolved",
    state,
    targetExposureStops:
      targetStops,
    achievedExposureStops:
      achievedStops,
    residualStops,
    limitingConstraint
  };
}

function nearestDiscreteIso(
  idealIso: number,
  values: readonly number[]
): {
  iso: number;
  quantized: boolean;
  clamped:
    | false
    | "minimum"
    | "maximum";
  limitingConstraint:
    ExposureResolutionConstraint;
} {
  const first = values[0]!;
  const last =
    values[values.length - 1]!;

  if (idealIso < first) {
    return {
      iso: first,
      quantized: true,
      clamped: "minimum",
      limitingConstraint:
        "iso-minimum"
    };
  }
  if (idealIso > last) {
    return {
      iso: last,
      quantized: true,
      clamped: "maximum",
      limitingConstraint:
        "iso-maximum"
    };
  }

  let selected = first;
  let selectedDistance =
    Math.abs(
      Math.log2(
        idealIso / first
      )
    );

  for (
    let index = 1;
    index < values.length;
    index += 1
  ) {
    const candidate =
      values[index]!;
    const distance =
      Math.abs(
        Math.log2(
          idealIso /
          candidate
        )
      );
    if (
      distance <
        selectedDistance -
          1e-15 ||
      (Math.abs(
        distance -
          selectedDistance
      ) <= 1e-15 &&
        candidate < selected)
    ) {
      selected = candidate;
      selectedDistance =
        distance;
    }
  }

  const quantized =
    !settingEquals(
      selected,
      idealIso
    );

  return {
    iso: selected,
    quantized,
    clamped: false,
    limitingConstraint:
      quantized
        ? "iso-grid-quantization"
        : "none"
  };
}

interface EffectiveAutoIsoBounds {
  minimum: number;
  maximum: number;
  minimumConstraint:
    | "iso-minimum"
    | "user-iso-minimum";
  maximumConstraint:
    | "iso-maximum"
    | "user-iso-maximum";
}

function bodyAutoIsoBounds(
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): {
  minimum: number;
  maximum: number;
} {
  return {
    minimum:
      capabilities.iso
        .autoIsoMinimum ??
      capabilities.iso.minimum,
    maximum:
      capabilities.iso
        .autoIsoMaximum ??
      capabilities.iso.maximum
  };
}

/**
 * #505: the Auto ISO range a resolver chooses in: the body's Auto ISO range, narrowed by the
 * photographer's validated limits when given. A limit outside the body's range, or off a discrete
 * ISO grid, fails; it is never clipped.
 */
function autoIsoBounds(
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities,
  limits?: unknown,
  path = "autoIsoLimits"
): EffectiveAutoIsoBounds {
  const body =
    bodyAutoIsoBounds(capabilities);
  if (limits === undefined) {
    return {
      ...body,
      minimumConstraint:
        "iso-minimum",
      maximumConstraint:
        "iso-maximum"
    };
  }
  const record = requireRecord(
    limits,
    path
  );
  rejectUnknownFields(
    record,
    ["maximum", "minimum"],
    path
  );
  const check = (
    value: unknown,
    field: string
  ): number => {
    const iso =
      requirePositiveFinite(
        value,
        path + "." + field
      );
    if (
      iso < body.minimum ||
      iso > body.maximum
    ) {
      throw new InvalidScientificInputError(
        path +
          "." +
          field +
          " (ISO " +
          iso +
          ") lies outside the body's Auto ISO range, ISO " +
          body.minimum +
          " to " +
          body.maximum +
          "."
      );
    }
    const grid =
      capabilities.iso.settingGrid;
    if (
      grid.kind ===
        "discrete-values" &&
      !grid.values.some(
        (candidate) =>
          settingEquals(
            candidate,
            iso
          )
      )
    ) {
      throw new InvalidScientificInputError(
        path +
          "." +
          field +
          " (ISO " +
          iso +
          ") is not a selectable ISO of the resolved discrete ISO grid."
      );
    }
    return iso;
  };
  const maximum = check(
    record.maximum,
    "maximum"
  );
  const minimum =
    record.minimum === undefined
      ? body.minimum
      : check(
          record.minimum,
          "minimum"
        );
  if (minimum > maximum) {
    throw new InvalidScientificInputError(
      path +
        ".minimum must not exceed " +
        path +
        ".maximum."
    );
  }
  return {
    minimum,
    maximum,
    minimumConstraint:
      minimum > body.minimum &&
      !settingEquals(
        minimum,
        body.minimum
      )
        ? "user-iso-minimum"
        : "iso-minimum",
    maximumConstraint:
      maximum < body.maximum &&
      !settingEquals(
        maximum,
        body.maximum
      )
        ? "user-iso-maximum"
        : "iso-maximum"
  };
}

function resolveAutomaticIso(
  idealIso: number,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities,
  bounds: EffectiveAutoIsoBounds
): {
  iso: number;
  kind:
    | "continuous"
    | "discrete";
  quantized: boolean;
  clamped:
    | false
    | "minimum"
    | "maximum";
  limitingConstraint:
    ExposureResolutionConstraint;
} {
  const grid =
    capabilities.iso.settingGrid;

  if (
    grid.kind ===
    "discrete-values"
  ) {
    const autoValues =
      grid.values.filter(
        (value) =>
          value >= bounds.minimum &&
          value <= bounds.maximum
      );
    if (
      autoValues.length === 0
    ) {
      throw new InvalidScientificInputError(
        "Auto ISO bounds contain no selectable values from the resolved ISO grid."
      );
    }
    const discrete =
      nearestDiscreteIso(
        idealIso,
        autoValues
      );
    return {
      ...discrete,
      limitingConstraint:
        discrete.clamped ===
        "minimum"
          ? bounds.minimumConstraint
          : discrete.clamped ===
              "maximum"
            ? bounds.maximumConstraint
            : discrete.limitingConstraint,
      kind: "discrete"
    };
  }

  if (
    idealIso <
    bounds.minimum
  ) {
    return {
      iso:
        bounds.minimum,
      kind: "continuous",
      quantized: false,
      clamped: "minimum",
      limitingConstraint:
        bounds.minimumConstraint
    };
  }
  if (
    idealIso >
    bounds.maximum
  ) {
    return {
      iso:
        bounds.maximum,
      kind: "continuous",
      quantized: false,
      clamped: "maximum",
      limitingConstraint:
        bounds.maximumConstraint
    };
  }

  return {
    iso: idealIso,
    kind: "continuous",
    quantized: false,
    clamped: false,
    limitingConstraint: "none"
  };
}

function nearestDiscreteShutter(
  idealShutterSeconds: number,
  values: readonly number[]
): {
  shutterSeconds: number;
  quantized: boolean;
  clamped:
    | false
    | "minimum"
    | "maximum";
  limitingConstraint:
    ExposureResolutionConstraint;
} {
  const first = values[0]!;
  const last =
    values[values.length - 1]!;

  if (idealShutterSeconds < first) {
    return {
      shutterSeconds: first,
      quantized: true,
      clamped: "minimum",
      limitingConstraint:
        "shutter-minimum"
    };
  }
  if (idealShutterSeconds > last) {
    return {
      shutterSeconds: last,
      quantized: true,
      clamped: "maximum",
      limitingConstraint:
        "shutter-maximum"
    };
  }

  let selected = first;
  let selectedDistance =
    Math.abs(
      Math.log2(
        idealShutterSeconds /
        first
      )
    );

  for (
    let index = 1;
    index < values.length;
    index += 1
  ) {
    const candidate =
      values[index]!;
    const distance =
      Math.abs(
        Math.log2(
          idealShutterSeconds /
          candidate
        )
      );
    if (
      distance <
        selectedDistance -
          1e-15 ||
      (Math.abs(
        distance -
          selectedDistance
      ) <= 1e-15 &&
        candidate < selected)
    ) {
      selected = candidate;
      selectedDistance =
        distance;
    }
  }

  const quantized =
    !settingEquals(
      selected,
      idealShutterSeconds
    );

  return {
    shutterSeconds: selected,
    quantized,
    clamped: false,
    limitingConstraint:
      quantized
        ? "shutter-grid-quantization"
        : "none"
  };
}

function resolveAutomaticShutter(
  idealShutterSeconds: number,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): {
  shutterSeconds: number;
  kind:
    | "continuous"
    | "discrete";
  quantized: boolean;
  clamped:
    | false
    | "minimum"
    | "maximum";
  limitingConstraint:
    ExposureResolutionConstraint;
} {
  const grid =
    capabilities.shutter.settingGrid;

  if (
    grid.kind ===
    "discrete-values"
  ) {
    const discrete =
      nearestDiscreteShutter(
        idealShutterSeconds,
        grid.values
      );
    return {
      ...discrete,
      kind: "discrete"
    };
  }

  if (
    idealShutterSeconds <
    capabilities.shutter
      .minimumSeconds
  ) {
    return {
      shutterSeconds:
        capabilities.shutter
          .minimumSeconds,
      kind: "continuous",
      quantized: false,
      clamped: "minimum",
      limitingConstraint:
        "shutter-minimum"
    };
  }
  if (
    idealShutterSeconds >
    capabilities.shutter
      .maximumSeconds
  ) {
    return {
      shutterSeconds:
        capabilities.shutter
          .maximumSeconds,
      kind: "continuous",
      quantized: false,
      clamped: "maximum",
      limitingConstraint:
        "shutter-maximum"
    };
  }

  return {
    shutterSeconds:
      idealShutterSeconds,
    kind: "continuous",
    quantized: false,
    clamped: false,
    limitingConstraint: "none"
  };
}

function minimumSelectableIso(
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities,
  bounds: EffectiveAutoIsoBounds
): number {
  const grid =
    capabilities.iso.settingGrid;
  if (
    grid.kind ===
    "continuous-within-range"
  ) {
    return bounds.minimum;
  }
  const first =
    grid.values.find(
      (value) =>
        value >= bounds.minimum &&
        value <= bounds.maximum
    );
  if (first === undefined) {
    throw new InvalidScientificInputError(
      "Auto ISO bounds contain no selectable values from the resolved ISO grid."
    );
  }
  return first;
}

function selectShutterNotLongerThanTarget(
  targetSeconds: number,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): {
  shutterSeconds: number;
  kind: "continuous" | "discrete";
  quantized: boolean;
  clamped:
    | false
    | "minimum"
    | "maximum";
  limitingConstraint:
    ExposureResolutionConstraint;
} {
  const minimum =
    capabilities.shutter.minimumSeconds;
  const maximum =
    capabilities.shutter.maximumSeconds;
  const grid =
    capabilities.shutter.settingGrid;

  if (grid.kind === "continuous-within-range") {
    if (targetSeconds < minimum) {
      return {
        shutterSeconds: minimum,
        kind: "continuous",
        quantized: false,
        clamped: "minimum",
        limitingConstraint:
          "shutter-minimum"
      };
    }
    if (targetSeconds > maximum) {
      return {
        shutterSeconds: maximum,
        kind: "continuous",
        quantized: false,
        clamped: "maximum",
        limitingConstraint:
          "shutter-maximum"
      };
    }
    return {
      shutterSeconds: targetSeconds,
      kind: "continuous",
      quantized: false,
      clamped: false,
      limitingConstraint: "none"
    };
  }

  const values = grid.values;
  const first = values[0]!;
  const last = values[values.length - 1]!;

  // A grid value within settingEquals tolerance of the target counts as an
  // exact match. Floating-point error in the computed target must not push the
  // choice one grid step shorter (#272).
  const exactMatch =
    values.find(
      (candidate) =>
        settingEquals(
          candidate,
          targetSeconds
        )
    );
  if (exactMatch !== undefined) {
    return {
      shutterSeconds: exactMatch,
      kind: "discrete",
      quantized: false,
      clamped: false,
      limitingConstraint: "none"
    };
  }

  if (targetSeconds < first) {
    return {
      shutterSeconds: first,
      kind: "discrete",
      quantized: true,
      clamped: "minimum",
      limitingConstraint:
        "shutter-minimum"
    };
  }
  if (targetSeconds > last) {
    return {
      shutterSeconds: last,
      kind: "discrete",
      quantized: true,
      clamped: "maximum",
      limitingConstraint:
        "shutter-maximum"
    };
  }

  let selected = first;
  for (const candidate of values) {
    if (candidate > targetSeconds) {
      break;
    }
    selected = candidate;
  }

  const quantized =
    !settingEquals(
      selected,
      targetSeconds
    );
  return {
    shutterSeconds: selected,
    kind: "discrete",
    quantized,
    clamped: false,
    limitingConstraint:
      quantized
        ? "shutter-grid-quantization"
        : "none"
  };
}

function nearestDiscreteAperture(
  idealFNumber: number,
  values: readonly number[]
): {
  aperture: number;
  quantized: boolean;
  clamped:
    | false
    | "widest"
    | "narrowest";
  limitingConstraint:
    ExposureResolutionConstraint;
} {
  const first = values[0]!;
  const last =
    values[values.length - 1]!;

  if (idealFNumber < first) {
    return {
      aperture: first,
      quantized: true,
      clamped: "widest",
      limitingConstraint:
        "aperture-widest"
    };
  }
  if (idealFNumber > last) {
    return {
      aperture: last,
      quantized: true,
      clamped: "narrowest",
      limitingConstraint:
        "aperture-narrowest"
    };
  }

  let selected = first;
  let selectedDistance =
    Math.abs(
      Math.log2(
        idealFNumber /
        first
      )
    );

  for (
    let index = 1;
    index < values.length;
    index += 1
  ) {
    const candidate =
      values[index]!;
    const distance =
      Math.abs(
        Math.log2(
          idealFNumber /
          candidate
        )
      );
    if (
      distance <
        selectedDistance -
          1e-15 ||
      (Math.abs(
        distance -
          selectedDistance
      ) <= 1e-15 &&
        candidate > selected)
    ) {
      selected = candidate;
      selectedDistance =
        distance;
    }
  }

  const quantized =
    !settingEquals(
      selected,
      idealFNumber
    );

  return {
    aperture: selected,
    quantized,
    clamped: false,
    limitingConstraint:
      quantized
        ? "aperture-grid-quantization"
        : "none"
  };
}

function resolveAutomaticAperture(
  idealFNumber: number,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): {
  aperture: number;
  kind: "continuous" | "discrete";
  quantized: boolean;
  clamped:
    | false
    | "widest"
    | "narrowest";
  limitingConstraint:
    ExposureResolutionConstraint;
} {
  const minimum =
    capabilities.aperture
      .widestAvailableFNumber;
  const maximum =
    capabilities.aperture
      .narrowestAvailableFNumber;
  const grid =
    capabilities.aperture.settingGrid;

  if (grid.kind === "discrete-values") {
    return {
      ...nearestDiscreteAperture(
        idealFNumber,
        grid.values
      ),
      kind: "discrete"
    };
  }

  if (idealFNumber < minimum) {
    return {
      aperture: minimum,
      kind: "continuous",
      quantized: false,
      clamped: "widest",
      limitingConstraint:
        "aperture-widest"
    };
  }
  if (idealFNumber > maximum) {
    return {
      aperture: maximum,
      kind: "continuous",
      quantized: false,
      clamped: "narrowest",
      limitingConstraint:
        "aperture-narrowest"
    };
  }

  return {
    aperture: idealFNumber,
    kind: "continuous",
    quantized: false,
    clamped: false,
    limitingConstraint: "none"
  };
}

function selectApertureNotWiderThanTarget(
  idealFNumber: number,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): {
  aperture: number;
  kind: "continuous" | "discrete";
  quantized: boolean;
  clamped:
    | false
    | "widest"
    | "narrowest";
  limitingConstraint:
    ExposureResolutionConstraint;
} {
  const minimum =
    capabilities.aperture
      .widestAvailableFNumber;
  const maximum =
    capabilities.aperture
      .narrowestAvailableFNumber;
  const grid =
    capabilities.aperture.settingGrid;

  if (grid.kind === "continuous-within-range") {
    if (idealFNumber < minimum) {
      return {
        aperture: minimum,
        kind: "continuous",
        quantized: false,
        clamped: "widest",
        limitingConstraint:
          "aperture-widest"
      };
    }
    if (idealFNumber > maximum) {
      return {
        aperture: maximum,
        kind: "continuous",
        quantized: false,
        clamped: "narrowest",
        limitingConstraint:
          "aperture-narrowest"
      };
    }
    return {
      aperture: idealFNumber,
      kind: "continuous",
      quantized: false,
      clamped: false,
      limitingConstraint: "none"
    };
  }

  const values = grid.values;
  const first = values[0]!;
  const last = values[values.length - 1]!;

  // A grid value within settingEquals tolerance of the ideal counts as an
  // exact match. Floating-point error in the computed ideal must not push the
  // choice one grid step narrower (#272).
  const exactMatch =
    values.find(
      (candidate) =>
        settingEquals(
          candidate,
          idealFNumber
        )
    );
  if (exactMatch !== undefined) {
    return {
      aperture: exactMatch,
      kind: "discrete",
      quantized: false,
      clamped: false,
      limitingConstraint: "none"
    };
  }

  if (idealFNumber < first) {
    return {
      aperture: first,
      kind: "discrete",
      quantized: true,
      clamped: "widest",
      limitingConstraint:
        "aperture-widest"
    };
  }
  if (idealFNumber > last) {
    return {
      aperture: last,
      kind: "discrete",
      quantized: true,
      clamped: "narrowest",
      limitingConstraint:
        "aperture-narrowest"
    };
  }

  const selected =
    values.find(
      (candidate) =>
        candidate >= idealFNumber
    ) ?? last;
  const quantized =
    !settingEquals(
      selected,
      idealFNumber
    );

  return {
    aperture: selected,
    kind: "discrete",
    quantized,
    clamped: false,
    limitingConstraint:
      quantized
        ? "aperture-grid-quantization"
        : "none"
  };
}

function idealApertureForTarget(
  targetScale: number,
  shutterSeconds: number,
  iso: number,
  reference:
    RelativeExposureControlAnchor
): number {
  const numerator =
    reference.aperture *
    reference.aperture *
    (shutterSeconds /
      reference.shutterSeconds) *
    (iso /
      reference.iso);
  const squared =
    numerator / targetScale;
  const aperture =
    Math.sqrt(squared);
  if (
    !Number.isFinite(aperture) ||
    aperture <= 0
  ) {
    throw new InvalidScientificInputError(
      "Ideal automatic aperture must remain finite and greater than zero."
    );
  }
  return aperture;
}

function validateProgramLineForResolution(
  value: ExposureProgramLineProfile,
  referenceExposure:
    RelativeExposureControlAnchor,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): ExposureProgramLineProfile {
  const profile =
    parseExposureProgramLineProfile(
      value
    );
  const toleranceStops = 1e-9;

  for (const node of profile.nodes) {
    if (
      node.aperture <
        capabilities.aperture
          .widestAvailableFNumber ||
      node.aperture >
        capabilities.aperture
          .narrowestAvailableFNumber
    ) {
      throw new InvalidScientificInputError(
        "Program-line aperture lies outside the resolved equipment capability range."
      );
    }
    if (
      node.shutterSeconds <
        capabilities.shutter
          .minimumSeconds ||
      node.shutterSeconds >
        capabilities.shutter
          .maximumSeconds
    ) {
      throw new InvalidScientificInputError(
        "Program-line shutter duration lies outside the resolved equipment capability range."
      );
    }

    const computedStops =
      Math.log2(
        opticalExposureFactor(
          node.aperture,
          node.shutterSeconds,
          referenceExposure
        )
      );
    if (
      !Number.isFinite(computedStops) ||
      Math.abs(
        computedStops -
          node
            .opticalExposureStopsFromReference
      ) > toleranceStops
    ) {
      throw new InvalidScientificInputError(
        "Program-line node opticalExposureStopsFromReference is inconsistent with its aperture/shutter pair and the selected reference exposure."
      );
    }
  }

  return profile;
}

function selectProgramLineSettings(
  requestedOpticalStops: number,
  profile:
    ExposureProgramLineProfile,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): ProgramLineSelectionDiagnostics {
  if (!Number.isFinite(requestedOpticalStops)) {
    throw new InvalidScientificInputError(
      "Requested program-line optical exposure stops must be finite."
    );
  }

  const first = profile.nodes[0]!;
  const last =
    profile.nodes[
      profile.nodes.length - 1
    ]!;

  let position:
    | "within-line"
    | "below-line"
    | "above-line";
  let selectedStops: number;
  let interpolationPhase:
    number | null;
  let idealAperture: number;
  let idealShutterSeconds: number;

  if (
    requestedOpticalStops <=
    first
      .opticalExposureStopsFromReference
  ) {
    position =
      requestedOpticalStops <
      first
        .opticalExposureStopsFromReference
        ? "below-line"
        : "within-line";
    selectedStops =
      first
        .opticalExposureStopsFromReference;
    interpolationPhase = null;
    idealAperture = first.aperture;
    idealShutterSeconds =
      first.shutterSeconds;
  } else if (
    requestedOpticalStops >=
    last
      .opticalExposureStopsFromReference
  ) {
    position =
      requestedOpticalStops >
      last
        .opticalExposureStopsFromReference
        ? "above-line"
        : "within-line";
    selectedStops =
      last
        .opticalExposureStopsFromReference;
    interpolationPhase = null;
    idealAperture = last.aperture;
    idealShutterSeconds =
      last.shutterSeconds;
  } else {
    position = "within-line";
    let left = first;
    let right = profile.nodes[1]!;

    for (
      let index = 1;
      index < profile.nodes.length;
      index += 1
    ) {
      const candidate =
        profile.nodes[index]!;
      if (
        requestedOpticalStops <=
        candidate
          .opticalExposureStopsFromReference
      ) {
        left =
          profile.nodes[index - 1]!;
        right = candidate;
        break;
      }
    }

    const span =
      right
        .opticalExposureStopsFromReference -
      left
        .opticalExposureStopsFromReference;
    const phase =
      (requestedOpticalStops -
        left
          .opticalExposureStopsFromReference) /
      span;
    interpolationPhase = phase;
    selectedStops =
      requestedOpticalStops;

    const logAperture =
      Math.log2(left.aperture) +
      phase *
        (Math.log2(right.aperture) -
          Math.log2(left.aperture));
    const logShutter =
      Math.log2(
        left.shutterSeconds
      ) +
      phase *
        (Math.log2(
          right.shutterSeconds
        ) -
          Math.log2(
            left.shutterSeconds
          ));

    idealAperture =
      Math.pow(2, logAperture);
    idealShutterSeconds =
      Math.pow(2, logShutter);
  }

  const aperture =
    resolveAutomaticAperture(
      idealAperture,
      capabilities
    );
  const shutter =
    resolveAutomaticShutter(
      idealShutterSeconds,
      capabilities
    );

  return {
    profileId: profile.profileId,
    profileVersion:
      profile.profileVersion,
    requestedOpticalExposureStopsFromReference:
      requestedOpticalStops,
    selectedOpticalExposureStopsFromReference:
      selectedStops,
    position,
    interpolationPhase,
    idealAperture,
    idealShutterSeconds,
    resolvedAperture:
      aperture.aperture,
    resolvedShutterSeconds:
      shutter.shutterSeconds,
    apertureQuantized:
      aperture.quantized,
    shutterQuantized:
      shutter.quantized,
    apertureClamped:
      aperture.clamped,
    shutterClamped:
      shutter.clamped
  };
}

function programLineResidualConstraint(
  selection:
    ProgramLineSelectionDiagnostics
): ExposureResolutionConstraint {
  if (
    selection.apertureClamped ===
    "widest"
  ) {
    return "aperture-widest";
  }
  if (
    selection.apertureClamped ===
    "narrowest"
  ) {
    return "aperture-narrowest";
  }
  if (
    selection.shutterClamped ===
    "minimum"
  ) {
    return "shutter-minimum";
  }
  if (
    selection.shutterClamped ===
    "maximum"
  ) {
    return "shutter-maximum";
  }
  if (selection.apertureQuantized) {
    return "aperture-grid-quantization";
  }
  if (selection.shutterQuantized) {
    return "shutter-grid-quantization";
  }
  return "none";
}

/**
 * Resolves Manual exposure with either manual ISO or Auto ISO.
 *
 * The caller sets aperture and shutter; they are never changed. The relative
 * meter target is normalized by an explicit reference exposure anchor. No
 * ISO 100 or other hidden absolute calibration is assumed.
 */
export function resolveManualExposureMode(
  input:
    ResolveManualExposureModeInput
): ManualExposureModeResolution {
  requireInputKeys(input, "resolveManualExposureMode", ["target", "capabilities", "referenceExposure", "manualAperture", "manualShutterSeconds", "isoControl"]);
  requireRecord(input.isoControl, "isoControl");
  const target =
    validateTarget(input.target);
  validateCapabilities(
    input.capabilities
  );

  const referenceExposure =
    validateReferenceExposure(
      input.referenceExposure,
      input.capabilities
    );

  const manualAperture =
    requirePositiveFinite(
      input.manualAperture,
      "manualAperture"
    );
  const manualShutterSeconds =
    requirePositiveFinite(
      input.manualShutterSeconds,
      "manualShutterSeconds"
    );

  validateSettingAgainstGrid(
    manualAperture,
    input.capabilities.aperture
      .widestAvailableFNumber,
    input.capabilities.aperture
      .narrowestAvailableFNumber,
    input.capabilities.aperture
      .settingGrid,
    "manualAperture"
  );
  validateSettingAgainstGrid(
    manualShutterSeconds,
    input.capabilities.shutter
      .minimumSeconds,
    input.capabilities.shutter
      .maximumSeconds,
    input.capabilities.shutter
      .settingGrid,
    "manualShutterSeconds"
  );

  const base:
    ManualExposureResolutionBase = {
    resolverVersion:
      EXPOSURE_MODE_RESOLVER_VERSION,
    mode: "manual",
    axisOwnership: {
      aperture: "manual",
      shutter: "manual",
      iso:
        input.isoControl.kind ===
        "manual"
          ? "manual"
          : "automatic"
    },
    targetId: target.targetId,
    targetSourceMeterSnapshot:
      target.sourceMeterSnapshot,
    capabilityProfiles: {
      bodyProfileId:
        input.capabilities
          .bodyProfile.profileId,
      bodyProfileVersion:
        input.capabilities
          .bodyProfile.profileVersion,
      lensProfileId:
        input.capabilities
          .lensProfile.profileId,
      lensProfileVersion:
        input.capabilities
          .lensProfile.profileVersion
    },
    selectedFocalLengthMm:
      input.capabilities
        .selectedFocalLengthMm,
    referenceExposure,
    manualAperture,
    manualShutterSeconds,
    apertureMutatedByResolver: false,
    shutterMutatedByResolver: false,
    exposureCompensationAppliedByResolver:
      false,
    meterRecomputedByResolver: false,
    isoNoiseOrGainTopologyInferred:
      false,
    flashPolicyApplied: false,
    safetyShiftApplied: false
  };

  const opticalFactor =
    opticalExposureFactor(
      manualAperture,
      manualShutterSeconds,
      referenceExposure
    );

  if (
    input.isoControl.kind !==
      "manual" &&
    input.isoControl.kind !==
      "automatic"
  ) {
    throw new InvalidConfigurationError(
      "isoControl.kind is invalid."
    );
  }
  if (
    input.isoControl.kind ===
      "automatic" &&
    input.isoControl
      .quantizationPolicy !==
      "nearest-log2-lower-on-tie"
  ) {
    throw new InvalidConfigurationError(
      'isoControl.quantizationPolicy must be "nearest-log2-lower-on-tie".'
    );
  }
  const autoBounds =
    input.isoControl.kind ===
    "automatic"
      ? autoIsoBounds(
          input.capabilities,
          input.isoControl
            .autoIsoLimits,
          "isoControl.autoIsoLimits"
        )
      : undefined;

  if (
    input.isoControl.kind ===
    "manual"
  ) {
    const manualIso =
      requirePositiveFinite(
        input.isoControl.iso,
        "isoControl.iso"
      );
    validateSettingAgainstGrid(
      manualIso,
      input.capabilities.iso.minimum,
      input.capabilities.iso.maximum,
      input.capabilities.iso.settingGrid,
      "isoControl.iso"
    );

    const achievedScale =
      opticalFactor *
      (manualIso /
        referenceExposure.iso);

    return {
      ...base,
      status: "resolved",
      isoControl: "manual",
      resolvedSettings: {
        aperture:
          manualAperture,
        shutterSeconds:
          manualShutterSeconds,
        iso: manualIso
      },
      idealIsoBeforeConstraints:
        null,
      isoResolution: {
        kind:
          "manual-preserved",
        quantized: false,
        clamped: false
      },
      targetResidual:
        targetResidual(
          target,
          achievedScale,
          "none"
        )
    };
  }

  const availability =
    input.capabilities.iso
      .autoIsoAvailability;
  if (
    availability !== "supported"
  ) {
    return {
      ...base,
      status: "blocked",
      isoControl: "automatic",
      resolvedSettings: {
        aperture:
          manualAperture,
        shutterSeconds:
          manualShutterSeconds
      },
      idealIsoBeforeConstraints:
        null,
      blocker:
        availability ===
        "unknown"
          ? "auto-iso-unknown"
          : "auto-iso-unsupported",
      targetResidual: {
        status:
          "target-unresolved",
        state:
          "target-unresolved",
        reason:
          "auto-iso-unavailable"
      }
    };
  }

  if (target.status === "no-signal") {
    return {
      ...base,
      status: "blocked",
      isoControl: "automatic",
      resolvedSettings: {
        aperture:
          manualAperture,
        shutterSeconds:
          manualShutterSeconds
      },
      idealIsoBeforeConstraints:
        null,
      blocker:
        "target-no-signal",
      targetResidual: {
        status:
          "target-unresolved",
        state:
          "target-unresolved",
        reason: "no-signal-target"
      }
    };
  }

  const idealIso =
    referenceExposure.iso *
    (target
      .requiredExposureScaleToTarget /
      opticalFactor);

  if (
    !Number.isFinite(idealIso) ||
    idealIso <= 0
  ) {
    throw new InvalidScientificInputError(
      "Ideal Auto ISO must remain finite and greater than zero."
    );
  }

  const automatic =
    resolveAutomaticIso(
      idealIso,
      input.capabilities,
      autoBounds!
    );

  const achievedScale =
    opticalFactor *
    (automatic.iso /
      referenceExposure.iso);
  const residual =
    targetResidual(
      target,
      achievedScale,
      automatic
        .limitingConstraint
    );

  return {
    ...base,
    status: "resolved",
    isoControl: "automatic",
    resolvedSettings: {
      aperture:
        manualAperture,
      shutterSeconds:
        manualShutterSeconds,
      iso: automatic.iso
    },
    idealIsoBeforeConstraints:
      idealIso,
    isoResolution: {
      kind: automatic.kind,
      quantizationPolicy:
        input.isoControl
          .quantizationPolicy,
      quantized:
        automatic.quantized,
      clamped:
        automatic.clamped
    },
    targetResidual: residual
  };
}

/**
 * Resolves Aperture Priority with manual ISO.
 *
 * The caller sets aperture and ISO. Only the shutter is automatic. The target
 * and reference use the same relative exposure model as Manual + Auto ISO; no
 * new exposure equation is added for this mode.
 */
export function resolveAperturePriorityExposureMode(
  input:
    ResolveAperturePriorityExposureModeInput
): AperturePriorityExposureModeResolution {
  requireInputKeys(input, "resolveAperturePriorityExposureMode", ["target", "capabilities", "referenceExposure", "manualAperture", "manualIso", "shutterQuantizationPolicy"]);
  const target =
    validateTarget(input.target);
  validateCapabilities(
    input.capabilities
  );

  const referenceExposure =
    validateReferenceExposure(
      input.referenceExposure,
      input.capabilities
    );

  const manualAperture =
    requirePositiveFinite(
      input.manualAperture,
      "manualAperture"
    );
  const manualIso =
    requirePositiveFinite(
      input.manualIso,
      "manualIso"
    );

  validateSettingAgainstGrid(
    manualAperture,
    input.capabilities.aperture
      .widestAvailableFNumber,
    input.capabilities.aperture
      .narrowestAvailableFNumber,
    input.capabilities.aperture
      .settingGrid,
    "manualAperture"
  );
  validateSettingAgainstGrid(
    manualIso,
    input.capabilities.iso.minimum,
    input.capabilities.iso.maximum,
    input.capabilities.iso.settingGrid,
    "manualIso"
  );

  if (
    input.shutterQuantizationPolicy !==
    "nearest-log2-shorter-on-tie"
  ) {
    throw new InvalidConfigurationError(
      'shutterQuantizationPolicy must be "nearest-log2-shorter-on-tie".'
    );
  }

  const base:
    AperturePriorityExposureResolutionBase = {
    resolverVersion:
      EXPOSURE_MODE_RESOLVER_VERSION,
    mode: "aperture-priority",
    axisOwnership: {
      aperture: "manual",
      shutter: "automatic",
      iso: "manual"
    },
    targetId: target.targetId,
    targetSourceMeterSnapshot:
      target.sourceMeterSnapshot,
    capabilityProfiles: {
      bodyProfileId:
        input.capabilities
          .bodyProfile.profileId,
      bodyProfileVersion:
        input.capabilities
          .bodyProfile.profileVersion,
      lensProfileId:
        input.capabilities
          .lensProfile.profileId,
      lensProfileVersion:
        input.capabilities
          .lensProfile.profileVersion
    },
    selectedFocalLengthMm:
      input.capabilities
        .selectedFocalLengthMm,
    referenceExposure,
    manualAperture,
    manualIso,
    apertureMutatedByResolver: false,
    isoMutatedByResolver: false,
    shutterResolvedByResolver: true,
    exposureCompensationAppliedByResolver:
      false,
    meterRecomputedByResolver: false,
    isoNoiseOrGainTopologyInferred:
      false,
    flashPolicyApplied: false,
    safetyShiftApplied: false
  };

  if (target.status === "no-signal") {
    return {
      ...base,
      status: "blocked",
      resolvedSettings: {
        aperture:
          manualAperture,
        iso: manualIso
      },
      idealShutterSecondsBeforeConstraints:
        null,
      blocker: "target-no-signal",
      targetResidual: {
        status:
          "target-unresolved",
        state:
          "target-unresolved",
        reason: "no-signal-target"
      }
    };
  }

  const fixedAxisFactorAtReferenceShutter =
    opticalExposureFactor(
      manualAperture,
      referenceExposure
        .shutterSeconds,
      referenceExposure
    ) *
    (manualIso /
      referenceExposure.iso);

  if (
    !Number.isFinite(
      fixedAxisFactorAtReferenceShutter
    ) ||
    fixedAxisFactorAtReferenceShutter <= 0
  ) {
    throw new InvalidScientificInputError(
      "Aperture Priority fixed-axis exposure factor must remain finite and greater than zero."
    );
  }

  const idealShutterSeconds =
    referenceExposure
      .shutterSeconds *
    (target
      .requiredExposureScaleToTarget /
      fixedAxisFactorAtReferenceShutter);

  if (
    !Number.isFinite(
      idealShutterSeconds
    ) ||
    idealShutterSeconds <= 0
  ) {
    throw new InvalidScientificInputError(
      "Ideal automatic shutter duration must remain finite and greater than zero."
    );
  }

  const automatic =
    resolveAutomaticShutter(
      idealShutterSeconds,
      input.capabilities
    );

  const achievedScale =
    opticalExposureFactor(
      manualAperture,
      automatic.shutterSeconds,
      referenceExposure
    ) *
    (manualIso /
      referenceExposure.iso);

  const residual =
    targetResidual(
      target,
      achievedScale,
      automatic
        .limitingConstraint
    );

  return {
    ...base,
    status: "resolved",
    resolvedSettings: {
      aperture: manualAperture,
      shutterSeconds:
        automatic.shutterSeconds,
      iso: manualIso
    },
    idealShutterSecondsBeforeConstraints:
      idealShutterSeconds,
    shutterResolution: {
      kind: automatic.kind,
      quantizationPolicy:
        input
          .shutterQuantizationPolicy,
      quantized:
        automatic.quantized,
      clamped:
        automatic.clamped
    },
    targetResidual: residual
  };
}

function validateAutoIsoAvailability(
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): "supported" | "unsupported" | "unknown" {
  return capabilities.iso.autoIsoAvailability;
}

function buildPriorityAutoIsoBlocked<
  Mode extends
    | "aperture-priority"
    | "shutter-priority",
  Settings extends
    Record<string, number>
>(
  mode: Mode,
  target: ExposureMeterTarget,
  referenceExposure:
    RelativeExposureControlAnchor,
  reason:
    | "auto-iso-unsupported"
    | "auto-iso-unknown"
    | "target-no-signal",
  resolvedSettings: Settings
): {
  resolverVersion:
    typeof EXPOSURE_MODE_RESOLVER_VERSION;
  mode: Mode;
  status: "blocked";
  targetId: string;
  targetSourceMeterSnapshot:
    ExposureMeterTarget["sourceMeterSnapshot"];
  referenceExposure:
    RelativeExposureControlAnchor;
  resolvedSettings: Settings;
  blocker:
    | "auto-iso-unsupported"
    | "auto-iso-unknown"
    | "target-no-signal";
  targetResidual: {
    status: "target-unresolved";
    state: "target-unresolved";
    reason:
      | "auto-iso-unavailable"
      | "no-signal-target";
  };
} {
  return {
    resolverVersion:
      EXPOSURE_MODE_RESOLVER_VERSION,
    mode,
    status: "blocked",
    targetId: target.targetId,
    targetSourceMeterSnapshot:
      target.sourceMeterSnapshot,
    referenceExposure,
    resolvedSettings,
    blocker: reason,
    targetResidual: {
      status: "target-unresolved",
      state: "target-unresolved",
      reason:
        reason === "target-no-signal"
          ? "no-signal-target"
          : "auto-iso-unavailable"
    }
  };
}

/**
 * Aperture Priority with Auto ISO. Keeps the aperture fixed, follows the declared minimum-shutter
 * policy, and uses Auto ISO (within its limits) to make up the rest of the exposure.
 *
 * Every exposure mode applies its control policy to one shared relative exposure equation, with an
 * explicit reference anchor. Exposure compensation is already part of the frozen meter target. Manual
 * settings are never changed. Automatic settings snap to the declared setting grids, and the result
 * reports the signed leftover (residual) stops and any limits hit. A target with zero signal cannot
 * be used to make up an exposure.
 * @param input - ResolveAperturePriorityAutoIsoExposureModeInput. See that type for coordinates, units and profile binding.
 * @returns AperturePriorityAutoIsoExposureModeResolution. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function resolveAperturePriorityAutoIsoExposureMode(
  input:
    ResolveAperturePriorityAutoIsoExposureModeInput
): AperturePriorityAutoIsoExposureModeResolution {
  requireInputKeys(input, "resolveAperturePriorityAutoIsoExposureMode", ["target", "capabilities", "referenceExposure", "manualAperture", "policy"]);
  requireRecord(input.policy, "policy");
  const target = validateTarget(input.target);
  validateCapabilities(input.capabilities);
  const referenceExposure =
    validateReferenceExposure(
      input.referenceExposure,
      input.capabilities
    );
  const manualAperture =
    requirePositiveFinite(
      input.manualAperture,
      "manualAperture"
    );
  validateSettingAgainstGrid(
    manualAperture,
    input.capabilities.aperture
      .widestAvailableFNumber,
    input.capabilities.aperture
      .narrowestAvailableFNumber,
    input.capabilities.aperture
      .settingGrid,
    "manualAperture"
  );

  const policy = input.policy;
  if (
    policy.kind !==
      "minimum-iso-until-slowest-preferred-shutter" ||
    policy.isoBaseline !==
      "minimum-selectable" ||
    policy.isoQuantizationPolicy !==
      "nearest-log2-lower-on-tie" ||
    policy.shutterSelectionPolicy !==
      "not-longer-than-target" ||
    (policy.afterMaximumIso !==
      "allow-slower-shutter" &&
      policy.afterMaximumIso !==
        "hold-preferred-shutter")
  ) {
    throw new InvalidConfigurationError(
      "Aperture Priority Auto ISO policy is invalid."
    );
  }

  const slowestPreferred =
    requirePositiveFinite(
      policy.slowestPreferredShutterSeconds,
      "policy.slowestPreferredShutterSeconds"
    );
  if (
    slowestPreferred <
      input.capabilities.shutter
        .minimumSeconds ||
    slowestPreferred >
      input.capabilities.shutter
        .maximumSeconds
  ) {
    throw new InvalidScientificInputError(
      "policy.slowestPreferredShutterSeconds lies outside the resolved shutter capability range."
    );
  }
  const autoBounds =
    autoIsoBounds(
      input.capabilities,
      policy.autoIsoLimits,
      "policy.autoIsoLimits"
    );

  const availability =
    validateAutoIsoAvailability(
      input.capabilities
    );
  const commonBlocked = (
    blocker:
      | "auto-iso-unsupported"
      | "auto-iso-unknown"
      | "target-no-signal"
  ): AperturePriorityAutoIsoExposureModeResolution => {
    const raw = buildPriorityAutoIsoBlocked(
      "aperture-priority",
      target,
      referenceExposure,
      blocker,
      { aperture: manualAperture }
    );
    return {
      ...raw,
      axisOwnership: {
        aperture: "manual",
        shutter: "automatic",
        iso: "automatic"
      },
      manualAperture,
      policy,
      apertureMutatedByResolver: false,
      exposureCompensationAppliedByResolver:
        false,
      meterRecomputedByResolver: false,
      flashPolicyApplied: false,
      safetyShiftApplied: false
    };
  };

  if (availability !== "supported") {
    return commonBlocked(
      availability === "unknown"
        ? "auto-iso-unknown"
        : "auto-iso-unsupported"
    );
  }
  if (target.status === "no-signal") {
    return commonBlocked(
      "target-no-signal"
    );
  }

  const baselineIso =
    minimumSelectableIso(
      input.capabilities,
      autoBounds
    );
  const factorAtReferenceShutter =
    opticalExposureFactor(
      manualAperture,
      referenceExposure
        .shutterSeconds,
      referenceExposure
    ) *
    (baselineIso /
      referenceExposure.iso);
  const idealAtBaseline =
    referenceExposure
      .shutterSeconds *
    (target
      .requiredExposureScaleToTarget /
      factorAtReferenceShutter);
  if (
    !Number.isFinite(idealAtBaseline) ||
    idealAtBaseline <= 0
  ) {
    throw new InvalidScientificInputError(
      "Ideal Aperture Priority shutter duration at baseline ISO must remain finite and greater than zero."
    );
  }

  const desiredPreferred =
    Math.min(
      idealAtBaseline,
      slowestPreferred
    );
  let shutter =
    selectShutterNotLongerThanTarget(
      desiredPreferred,
      input.capabilities
    );

  const isoPass =
    resolveManualExposureMode({
      target,
      capabilities:
        input.capabilities,
      referenceExposure,
      manualAperture,
      manualShutterSeconds:
        shutter.shutterSeconds,
      isoControl: {
        kind: "automatic",
        quantizationPolicy:
          policy.isoQuantizationPolicy,
        ...(policy.autoIsoLimits ===
        undefined
          ? {}
          : {
              autoIsoLimits:
                policy.autoIsoLimits
            })
      }
    });

  if (
    isoPass.status !== "resolved" ||
    isoPass.isoControl !== "automatic"
  ) {
    throw new InvalidScientificInputError(
      "Aperture Priority Auto ISO could not resolve its ISO pass."
    );
  }

  let fallbackUsed = false;
  let shutterSelectionPolicy:
    | "not-longer-than-target"
    | "nearest-log2-shorter-on-tie" =
      "not-longer-than-target";

  if (
    isoPass.isoResolution.clamped ===
      "maximum" &&
    isoPass.targetResidual.state ===
      "under-target" &&
    policy.afterMaximumIso ===
      "allow-slower-shutter"
  ) {
    const maxIso =
      isoPass.resolvedSettings.iso;
    const fixedAtReference =
      opticalExposureFactor(
        manualAperture,
        referenceExposure
          .shutterSeconds,
        referenceExposure
      ) *
      (maxIso /
        referenceExposure.iso);
    const fallbackIdeal =
      referenceExposure
        .shutterSeconds *
      (target
        .requiredExposureScaleToTarget /
        fixedAtReference);
    shutter =
      resolveAutomaticShutter(
        fallbackIdeal,
        input.capabilities
      );
    fallbackUsed = true;
    shutterSelectionPolicy =
      "nearest-log2-shorter-on-tie";
    const achievedScale =
      opticalExposureFactor(
        manualAperture,
        shutter.shutterSeconds,
        referenceExposure
      ) *
      (maxIso /
        referenceExposure.iso);
    const residual =
      targetResidual(
        target,
        achievedScale,
        shutter.limitingConstraint
      );

    return {
      resolverVersion:
        EXPOSURE_MODE_RESOLVER_VERSION,
      mode: "aperture-priority",
      status: "resolved",
      axisOwnership: {
        aperture: "manual",
        shutter: "automatic",
        iso: "automatic"
      },
      targetId: target.targetId,
      targetSourceMeterSnapshot:
        target.sourceMeterSnapshot,
      referenceExposure,
      manualAperture,
      policy,
      baselineIso,
      idealShutterAtBaselineIsoSeconds:
        idealAtBaseline,
      preferredShutterSeconds:
        desiredPreferred,
      afterMaximumIsoFallbackUsed:
        fallbackUsed,
      resolvedSettings: {
        aperture: manualAperture,
        shutterSeconds:
          shutter.shutterSeconds,
        iso: maxIso
      },
      shutterResolution: {
        kind: shutter.kind,
        quantized:
          shutter.quantized,
        clamped:
          shutter.clamped,
        selectionPolicy:
          shutterSelectionPolicy
      },
      idealIsoBeforeConstraints:
        isoPass
          .idealIsoBeforeConstraints,
      isoResolution:
        isoPass.isoResolution,
      targetResidual: residual,
      apertureMutatedByResolver: false,
      shutterResolvedByResolver: true,
      isoResolvedByResolver: true,
      exposureCompensationAppliedByResolver:
        false,
      meterRecomputedByResolver: false,
      flashPolicyApplied: false,
      safetyShiftApplied: false
    };
  }

  return {
    resolverVersion:
      EXPOSURE_MODE_RESOLVER_VERSION,
    mode: "aperture-priority",
    status: "resolved",
    axisOwnership: {
      aperture: "manual",
      shutter: "automatic",
      iso: "automatic"
    },
    targetId: target.targetId,
    targetSourceMeterSnapshot:
      target.sourceMeterSnapshot,
    referenceExposure,
    manualAperture,
    policy,
    baselineIso,
    idealShutterAtBaselineIsoSeconds:
      idealAtBaseline,
    preferredShutterSeconds:
      desiredPreferred,
    afterMaximumIsoFallbackUsed:
      fallbackUsed,
    resolvedSettings:
      isoPass.resolvedSettings,
    shutterResolution: {
      kind: shutter.kind,
      quantized:
        shutter.quantized,
      clamped:
        shutter.clamped,
      selectionPolicy:
        shutterSelectionPolicy
    },
    idealIsoBeforeConstraints:
      isoPass
        .idealIsoBeforeConstraints,
    isoResolution:
      isoPass.isoResolution,
    targetResidual:
      isoPass.targetResidual,
    apertureMutatedByResolver: false,
    shutterResolvedByResolver: true,
    isoResolvedByResolver: true,
    exposureCompensationAppliedByResolver:
      false,
    meterRecomputedByResolver: false,
    flashPolicyApplied: false,
    safetyShiftApplied: false
  };
}

/**
 * Shutter Priority. Keeps the shutter fixed and chooses the aperture, plus optional Auto ISO, within
 * exactly what the equipment can do.
 *
 * Every exposure mode applies its control policy to one shared relative exposure equation, with an
 * explicit reference anchor. Exposure compensation is already part of the frozen meter target. Manual
 * settings are never changed. Automatic settings snap to the declared setting grids, and the result
 * reports the signed leftover (residual) stops and any limits hit. A target with zero signal cannot
 * be used to make up an exposure.
 * @param input - ResolveShutterPriorityExposureModeInput. See that type for coordinates, units and profile binding.
 * @returns ShutterPriorityExposureModeResolution. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function resolveShutterPriorityExposureMode(
  input:
    ResolveShutterPriorityExposureModeInput
): ShutterPriorityExposureModeResolution {
  requireInputKeys(input, "resolveShutterPriorityExposureMode", ["target", "capabilities", "referenceExposure", "manualShutterSeconds", "isoControl"]);
  requireRecord(input.isoControl, "isoControl");
  const target = validateTarget(input.target);
  validateCapabilities(input.capabilities);
  const referenceExposure =
    validateReferenceExposure(
      input.referenceExposure,
      input.capabilities
    );
  const manualShutterSeconds =
    requirePositiveFinite(
      input.manualShutterSeconds,
      "manualShutterSeconds"
    );
  validateSettingAgainstGrid(
    manualShutterSeconds,
    input.capabilities.shutter
      .minimumSeconds,
    input.capabilities.shutter
      .maximumSeconds,
    input.capabilities.shutter
      .settingGrid,
    "manualShutterSeconds"
  );

  const base: ShutterPriorityResolutionBase = {
    resolverVersion:
      EXPOSURE_MODE_RESOLVER_VERSION,
    mode: "shutter-priority",
    targetId: target.targetId,
    targetSourceMeterSnapshot:
      target.sourceMeterSnapshot,
    referenceExposure,
    manualShutterSeconds,
    shutterMutatedByResolver: false,
    apertureResolvedByResolver: true,
    exposureCompensationAppliedByResolver:
      false,
    meterRecomputedByResolver: false,
    flashPolicyApplied: false,
    safetyShiftApplied: false
  };

  if (input.isoControl.kind === "manual") {
    const manualIso =
      requirePositiveFinite(
        input.isoControl.iso,
        "isoControl.iso"
      );
    validateSettingAgainstGrid(
      manualIso,
      input.capabilities.iso.minimum,
      input.capabilities.iso.maximum,
      input.capabilities.iso.settingGrid,
      "isoControl.iso"
    );
    if (
      input.isoControl
        .apertureQuantizationPolicy !==
      "nearest-log2-narrower-on-tie"
    ) {
      throw new InvalidConfigurationError(
        'isoControl.apertureQuantizationPolicy must be "nearest-log2-narrower-on-tie".'
      );
    }
    if (target.status === "no-signal") {
      return {
        ...base,
        status: "blocked",
        axisOwnership: {
          aperture: "automatic",
          shutter: "manual",
          iso: "manual"
        },
        isoControl: "manual",
        resolvedSettings: {
          shutterSeconds:
            manualShutterSeconds
        },
        blocker: "target-no-signal",
        targetResidual: {
          status: "target-unresolved",
          state: "target-unresolved",
          reason: "no-signal-target"
        }
      };
    }

    const idealAperture =
      idealApertureForTarget(
        target
          .requiredExposureScaleToTarget,
        manualShutterSeconds,
        manualIso,
        referenceExposure
      );
    const aperture =
      resolveAutomaticAperture(
        idealAperture,
        input.capabilities
      );
    const achievedScale =
      opticalExposureFactor(
        aperture.aperture,
        manualShutterSeconds,
        referenceExposure
      ) *
      (manualIso /
        referenceExposure.iso);

    return {
      ...base,
      status: "resolved",
      axisOwnership: {
        aperture: "automatic",
        shutter: "manual",
        iso: "manual"
      },
      isoControl: "manual",
      manualIso,
      idealApertureBeforeConstraints:
        idealAperture,
      resolvedSettings: {
        aperture:
          aperture.aperture,
        shutterSeconds:
          manualShutterSeconds,
        iso: manualIso
      },
      apertureResolution: {
        kind: aperture.kind,
        quantizationPolicy:
          input.isoControl
            .apertureQuantizationPolicy,
        quantized:
          aperture.quantized,
        clamped:
          aperture.clamped
      },
      targetResidual:
        targetResidual(
          target,
          achievedScale,
          aperture
            .limitingConstraint
        )
    };
  }

  if (
    input.isoControl.kind !==
    "automatic"
  ) {
    throw new InvalidConfigurationError(
      "isoControl.kind is invalid for Shutter Priority."
    );
  }

  const policy =
    input.isoControl.policy;
  requireRecord(policy, "isoControl.policy");
  if (
    policy.kind !==
      "minimum-iso-aperture-first" ||
    policy.isoBaseline !==
      "minimum-selectable" ||
    policy.isoQuantizationPolicy !==
      "nearest-log2-lower-on-tie" ||
    policy.apertureSelectionPolicy !==
      "not-wider-than-target"
  ) {
    throw new InvalidConfigurationError(
      "Shutter Priority Auto ISO policy is invalid."
    );
  }
  const autoBounds =
    autoIsoBounds(
      input.capabilities,
      policy.autoIsoLimits,
      "isoControl.policy.autoIsoLimits"
    );

  const availability =
    validateAutoIsoAvailability(
      input.capabilities
    );
  if (
    availability !== "supported"
  ) {
    const raw = buildPriorityAutoIsoBlocked(
      "shutter-priority",
      target,
      referenceExposure,
      availability === "unknown"
        ? "auto-iso-unknown"
        : "auto-iso-unsupported",
      {
        shutterSeconds:
          manualShutterSeconds
      }
    );
    return {
      ...base,
      ...raw,
      axisOwnership: {
        aperture: "automatic",
        shutter: "manual",
        iso: "automatic"
      },
      isoControl: "automatic"
    };
  }
  if (target.status === "no-signal") {
    return {
      ...base,
      status: "blocked",
      axisOwnership: {
        aperture: "automatic",
        shutter: "manual",
        iso: "automatic"
      },
      isoControl: "automatic",
      resolvedSettings: {
        shutterSeconds:
          manualShutterSeconds
      },
      blocker: "target-no-signal",
      targetResidual: {
        status: "target-unresolved",
        state: "target-unresolved",
        reason: "no-signal-target"
      }
    };
  }

  const baselineIso =
    minimumSelectableIso(
      input.capabilities,
      autoBounds
    );
  const idealAtBaseline =
    idealApertureForTarget(
      target
        .requiredExposureScaleToTarget,
      manualShutterSeconds,
      baselineIso,
      referenceExposure
    );
  const aperture =
    selectApertureNotWiderThanTarget(
      idealAtBaseline,
      input.capabilities
    );
  const isoPass =
    resolveManualExposureMode({
      target,
      capabilities:
        input.capabilities,
      referenceExposure,
      manualAperture:
        aperture.aperture,
      manualShutterSeconds,
      isoControl: {
        kind: "automatic",
        quantizationPolicy:
          policy.isoQuantizationPolicy,
        ...(policy.autoIsoLimits ===
        undefined
          ? {}
          : {
              autoIsoLimits:
                policy.autoIsoLimits
            })
      }
    });

  if (
    isoPass.status !== "resolved" ||
    isoPass.isoControl !== "automatic"
  ) {
    throw new InvalidScientificInputError(
      "Shutter Priority Auto ISO could not resolve its ISO pass."
    );
  }

  return {
    ...base,
    status: "resolved",
    axisOwnership: {
      aperture: "automatic",
      shutter: "manual",
      iso: "automatic"
    },
    isoControl: "automatic",
    policy,
    baselineIso,
    idealApertureAtBaselineIso:
      idealAtBaseline,
    resolvedSettings:
      isoPass.resolvedSettings,
    apertureResolution: {
      kind: aperture.kind,
      quantized:
        aperture.quantized,
      clamped:
        aperture.clamped,
      selectionPolicy:
        policy.apertureSelectionPolicy
    },
    idealIsoBeforeConstraints:
      isoPass
        .idealIsoBeforeConstraints,
    isoResolution:
      isoPass.isoResolution,
    targetResidual:
      isoPass.targetResidual
  };
}

/**
 * Program auto exposure. Follows the declared generic program line in log2 exposure space, snaps
 * aperture and shutter to their grids, and can use Auto ISO for any exposure left over.
 *
 * Every exposure mode applies its control policy to one shared relative exposure equation, with an
 * explicit reference anchor. Exposure compensation is already part of the frozen meter target. Manual
 * settings are never changed. Automatic settings snap to the declared setting grids, and the result
 * reports the signed leftover (residual) stops and any limits hit. A target with zero signal cannot
 * be used to make up an exposure.
 * @param input - ResolveProgramAutoExposureModeInput. See that type for coordinates, units and profile binding.
 * @returns ProgramAutoExposureModeResolution. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function resolveProgramAutoExposureMode(
  input:
    ResolveProgramAutoExposureModeInput
): ProgramAutoExposureModeResolution {
  requireInputKeys(input, "resolveProgramAutoExposureMode", ["target", "capabilities", "referenceExposure", "programLine", "isoControl"]);
  requireRecord(input.isoControl, "isoControl");
  const target =
    validateTarget(input.target);
  validateCapabilities(
    input.capabilities
  );
  const referenceExposure =
    validateReferenceExposure(
      input.referenceExposure,
      input.capabilities
    );
  const programLine =
    validateProgramLineForResolution(
      input.programLine,
      referenceExposure,
      input.capabilities
    );

  if (
    input.isoControl.kind !==
      "manual" &&
    input.isoControl.kind !==
      "automatic"
  ) {
    throw new InvalidConfigurationError(
      "isoControl.kind is invalid for Program Auto."
    );
  }

  if (target.status === "no-signal") {
    return {
      resolverVersion:
        EXPOSURE_MODE_RESOLVER_VERSION,
      mode: "program-auto",
      status: "blocked",
      axisOwnership: {
        aperture: "automatic",
        shutter: "automatic",
        iso:
          input.isoControl.kind ===
          "manual"
            ? "manual"
            : "automatic"
      },
      isoControl:
        input.isoControl.kind,
      targetId: target.targetId,
      targetSourceMeterSnapshot:
        target.sourceMeterSnapshot,
      referenceExposure,
      blocker: "target-no-signal",
      targetResidual: {
        status: "target-unresolved",
        state: "target-unresolved",
        reason: "no-signal-target"
      },
      exposureCompensationAppliedByResolver:
        false,
      meterRecomputedByResolver:
        false,
      flashPolicyApplied: false,
      safetyShiftApplied: false
    };
  }

  if (
    input.isoControl.kind ===
    "manual"
  ) {
    const manualIso =
      requirePositiveFinite(
        input.isoControl.iso,
        "isoControl.iso"
      );
    validateSettingAgainstGrid(
      manualIso,
      input.capabilities.iso.minimum,
      input.capabilities.iso.maximum,
      input.capabilities.iso.settingGrid,
      "isoControl.iso"
    );

    const requestedOpticalStops =
      target
        .exposureOffsetStopsToTarget -
      Math.log2(
        manualIso /
          referenceExposure.iso
      );
    const selection =
      selectProgramLineSettings(
        requestedOpticalStops,
        programLine,
        input.capabilities
      );
    const achievedScale =
      opticalExposureFactor(
        selection.resolvedAperture,
        selection
          .resolvedShutterSeconds,
        referenceExposure
      ) *
      (manualIso /
        referenceExposure.iso);

    return {
      resolverVersion:
        EXPOSURE_MODE_RESOLVER_VERSION,
      mode: "program-auto",
      status: "resolved",
      axisOwnership: {
        aperture: "automatic",
        shutter: "automatic",
        iso: "manual"
      },
      isoControl: "manual",
      targetId: target.targetId,
      targetSourceMeterSnapshot:
        target.sourceMeterSnapshot,
      referenceExposure,
      programLineSelection:
        selection,
      apertureResolvedByResolver:
        true,
      shutterResolvedByResolver:
        true,
      exposureCompensationAppliedByResolver:
        false,
      meterRecomputedByResolver:
        false,
      flashPolicyApplied: false,
      safetyShiftApplied: false,
      manualIso,
      resolvedSettings: {
        aperture:
          selection
            .resolvedAperture,
        shutterSeconds:
          selection
            .resolvedShutterSeconds,
        iso: manualIso
      },
      targetResidual:
        targetResidual(
          target,
          achievedScale,
          programLineResidualConstraint(
            selection
          )
        )
    };
  }

  if (
    input.isoControl
      .isoBaseline !==
      "minimum-selectable" ||
    input.isoControl
      .isoQuantizationPolicy !==
      "nearest-log2-lower-on-tie"
  ) {
    throw new InvalidConfigurationError(
      "Program Auto ISO policy is invalid."
    );
  }
  const autoBounds =
    autoIsoBounds(
      input.capabilities,
      input.isoControl
        .autoIsoLimits,
      "isoControl.autoIsoLimits"
    );
  const holdPolicy =
    validateProgramSlowestPreferredShutter(
      input.isoControl
        .slowestPreferredShutter,
      input.capabilities
    );

  const availability =
    validateAutoIsoAvailability(
      input.capabilities
    );
  if (availability !== "supported") {
    return {
      resolverVersion:
        EXPOSURE_MODE_RESOLVER_VERSION,
      mode: "program-auto",
      status: "blocked",
      axisOwnership: {
        aperture: "automatic",
        shutter: "automatic",
        iso: "automatic"
      },
      isoControl: "automatic",
      targetId: target.targetId,
      targetSourceMeterSnapshot:
        target.sourceMeterSnapshot,
      referenceExposure,
      blocker:
        availability === "unknown"
          ? "auto-iso-unknown"
          : "auto-iso-unsupported",
      targetResidual: {
        status: "target-unresolved",
        state: "target-unresolved",
        reason:
          "auto-iso-unavailable"
      },
      exposureCompensationAppliedByResolver:
        false,
      meterRecomputedByResolver:
        false,
      flashPolicyApplied: false,
      safetyShiftApplied: false
    };
  }

  const baselineIso =
    minimumSelectableIso(
      input.capabilities,
      autoBounds
    );
  const requestedOpticalStops =
    target
      .exposureOffsetStopsToTarget -
    Math.log2(
      baselineIso /
        referenceExposure.iso
    );
  const selection =
    selectProgramLineSettings(
      requestedOpticalStops,
      programLine,
      input.capabilities
    );
  const isoControl =
    input.isoControl;
  const autoIsoPass = (
    shutterSeconds: number
  ): Extract<
    ManualExposureModeResolution,
    { status: "resolved"; isoControl: "automatic" }
  > => {
    const pass =
      resolveManualExposureMode({
        target,
        capabilities:
          input.capabilities,
        referenceExposure,
        manualAperture:
          selection.resolvedAperture,
        manualShutterSeconds:
          shutterSeconds,
        isoControl: {
          kind: "automatic",
          quantizationPolicy:
            isoControl
              .isoQuantizationPolicy,
          ...(isoControl
            .autoIsoLimits ===
          undefined
            ? {}
            : {
                autoIsoLimits:
                  isoControl
                    .autoIsoLimits
              })
        }
      });
    if (
      pass.status !== "resolved" ||
      pass.isoControl !== "automatic"
    ) {
      throw new InvalidScientificInputError(
        "Program Auto could not resolve its Auto ISO pass."
      );
    }
    return pass;
  };

  // #504: hold the line's shutter at or faster than the slowest preferred shutter before the ISO rises.
  const lineShutterSeconds =
    selection
      .resolvedShutterSeconds;
  const holdApplied =
    holdPolicy !== undefined &&
    lineShutterSeconds >
      holdPolicy
        .slowestPreferredShutterSeconds &&
    !settingEquals(
      lineShutterSeconds,
      holdPolicy
        .slowestPreferredShutterSeconds
    );
  const heldShutterSeconds =
    holdApplied
      ? selectShutterNotLongerThanTarget(
          holdPolicy!
            .slowestPreferredShutterSeconds,
          input.capabilities
        ).shutterSeconds
      : lineShutterSeconds;
  const isoPass =
    autoIsoPass(
      heldShutterSeconds
    );
  let resolvedSettings =
    isoPass.resolvedSettings;
  let residual =
    isoPass.targetResidual;
  let fallbackUsed = false;
  if (
    holdApplied &&
    holdPolicy!.afterMaximumIso ===
      "allow-slower-shutter" &&
    isoPass.isoResolution.clamped ===
      "maximum" &&
    isoPass.targetResidual.state ===
      "under-target"
  ) {
    // At the Auto ISO maximum the shutter may lengthen toward the target, but not past the line's own shutter.
    const maxIso =
      isoPass.resolvedSettings.iso;
    const atReference =
      opticalExposureFactor(
        selection.resolvedAperture,
        referenceExposure
          .shutterSeconds,
        referenceExposure
      ) *
      (maxIso /
        referenceExposure.iso);
    const idealShutter =
      referenceExposure
        .shutterSeconds *
      (target
        .requiredExposureScaleToTarget /
        atReference);
    const beyondLine =
      idealShutter >=
      lineShutterSeconds;
    const shutter =
      beyondLine
        ? {
            shutterSeconds:
              lineShutterSeconds,
            limitingConstraint:
              isoPass.targetResidual
                .limitingConstraint
          }
        : resolveAutomaticShutter(
            idealShutter,
            input.capabilities
          );
    fallbackUsed = true;
    resolvedSettings = {
      aperture:
        selection.resolvedAperture,
      shutterSeconds:
        shutter.shutterSeconds,
      iso: maxIso
    };
    residual =
      targetResidual(
        target,
        opticalExposureFactor(
          selection.resolvedAperture,
          shutter.shutterSeconds,
          referenceExposure
        ) *
          (maxIso /
            referenceExposure.iso),
        shutter.limitingConstraint
      );
  }

  return {
    resolverVersion:
      EXPOSURE_MODE_RESOLVER_VERSION,
    mode: "program-auto",
    status: "resolved",
    axisOwnership: {
      aperture: "automatic",
      shutter: "automatic",
      iso: "automatic"
    },
    isoControl: "automatic",
    targetId: target.targetId,
    targetSourceMeterSnapshot:
      target.sourceMeterSnapshot,
    referenceExposure,
    programLineSelection:
      selection,
    apertureResolvedByResolver: true,
    shutterResolvedByResolver: true,
    exposureCompensationAppliedByResolver:
      false,
    meterRecomputedByResolver: false,
    flashPolicyApplied: false,
    safetyShiftApplied: false,
    baselineIso,
    idealIsoBeforeConstraints:
      isoPass
        .idealIsoBeforeConstraints,
    isoResolution:
      isoPass.isoResolution,
    resolvedSettings,
    targetResidual: residual,
    ...(holdPolicy === undefined
      ? {}
      : {
          slowestPreferredShutter: {
            ...holdPolicy,
            applied: holdApplied,
            afterMaximumIsoFallbackUsed:
              fallbackUsed
          }
        })
  };
}

function validateProgramSlowestPreferredShutter(
  value: unknown,
  capabilities:
    ResolvedGenericEquipmentExposureCapabilities
): ProgramSlowestPreferredShutterPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = requireRecord(
    value,
    "isoControl.slowestPreferredShutter"
  );
  rejectUnknownFields(
    record,
    ["slowestPreferredShutterSeconds", "afterMaximumIso"],
    "isoControl.slowestPreferredShutter"
  );
  if (
    record.afterMaximumIso !==
      "allow-slower-shutter" &&
    record.afterMaximumIso !==
      "hold-preferred-shutter"
  ) {
    throw new InvalidConfigurationError(
      'isoControl.slowestPreferredShutter.afterMaximumIso must be "allow-slower-shutter" or "hold-preferred-shutter".'
    );
  }
  const seconds =
    requirePositiveFinite(
      record.slowestPreferredShutterSeconds,
      "isoControl.slowestPreferredShutter.slowestPreferredShutterSeconds"
    );
  if (
    seconds <
      capabilities.shutter
        .minimumSeconds ||
    seconds >
      capabilities.shutter
        .maximumSeconds
  ) {
    throw new InvalidScientificInputError(
      "isoControl.slowestPreferredShutter.slowestPreferredShutterSeconds lies outside the resolved shutter capability range."
    );
  }
  return {
    slowestPreferredShutterSeconds:
      seconds,
    afterMaximumIso:
      record.afterMaximumIso
  };
}

/**
 * Full Auto. Chooses aperture, shutter and ISO under an explicit generic Full Auto exposure policy.
 * Autofocus, white balance (WB), flash, drive mode and scene recognition are not resolved.
 *
 * Every exposure mode applies its control policy to one shared relative exposure equation, with an
 * explicit reference anchor. Exposure compensation is already part of the frozen meter target. Manual
 * settings are never changed. Automatic settings snap to the declared setting grids, and the result
 * reports the signed leftover (residual) stops and any limits hit. A target with zero signal cannot
 * be used to make up an exposure.
 * @param input - ResolveFullAutoExposureModeInput. See that type for coordinates, units and profile binding.
 * @returns FullAutoExposureModeResolution. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function resolveFullAutoExposureMode(
  input:
    ResolveFullAutoExposureModeInput
): FullAutoExposureModeResolution {
  requireInputKeys(input, "resolveFullAutoExposureMode", ["target", "capabilities", "referenceExposure", "policy"]);
  requireRecord(input.policy, "policy");
  const target =
    validateTarget(input.target);
  validateCapabilities(
    input.capabilities
  );
  const referenceExposure =
    validateReferenceExposure(
      input.referenceExposure,
      input.capabilities
    );

  if (
    input.policy.kind !==
      "generic-program-line-minimum-iso" ||
    input.policy.isoBaseline !==
      "minimum-selectable" ||
    input.policy
      .isoQuantizationPolicy !==
      "nearest-log2-lower-on-tie"
  ) {
    throw new InvalidConfigurationError(
      "Full Auto exposure policy is invalid."
    );
  }
  const autoBounds =
    autoIsoBounds(
      input.capabilities,
      input.policy.autoIsoLimits,
      "policy.autoIsoLimits"
    );

  const programLine =
    validateProgramLineForResolution(
      input.policy.programLine,
      referenceExposure,
      input.capabilities
    );

  const blocked = (
    blocker:
      | "target-no-signal"
      | "auto-iso-unsupported"
      | "auto-iso-unknown"
  ): FullAutoExposureModeResolution => ({
    resolverVersion:
      EXPOSURE_MODE_RESOLVER_VERSION,
    mode:
      "full-auto-exposure",
    status: "blocked",
    axisOwnership: {
      aperture: "automatic",
      shutter: "automatic",
      iso: "automatic"
    },
    policy: input.policy,
    targetId: target.targetId,
    targetSourceMeterSnapshot:
      target.sourceMeterSnapshot,
    referenceExposure,
    blocker,
    targetResidual: {
      status: "target-unresolved",
      state: "target-unresolved",
      reason:
        blocker ===
        "target-no-signal"
          ? "no-signal-target"
          : "auto-iso-unavailable"
    },
    exposureCompensationAppliedByResolver:
      false,
    meterRecomputedByResolver:
      false,
    flashPolicyApplied: false,
    safetyShiftApplied: false,
    autofocusResolved: false,
    whiteBalanceResolved: false,
    flashResolved: false,
    driveResolved: false,
    sceneRecognitionResolved:
      false,
    stabilizationPolicyResolved:
      false
  });

  if (target.status === "no-signal") {
    return blocked(
      "target-no-signal"
    );
  }

  const availability =
    validateAutoIsoAvailability(
      input.capabilities
    );
  if (availability !== "supported") {
    return blocked(
      availability === "unknown"
        ? "auto-iso-unknown"
        : "auto-iso-unsupported"
    );
  }

  const baselineIso =
    minimumSelectableIso(
      input.capabilities,
      autoBounds
    );
  const requestedOpticalStops =
    target
      .exposureOffsetStopsToTarget -
    Math.log2(
      baselineIso /
        referenceExposure.iso
    );
  const selection =
    selectProgramLineSettings(
      requestedOpticalStops,
      programLine,
      input.capabilities
    );
  const isoPass =
    resolveManualExposureMode({
      target,
      capabilities:
        input.capabilities,
      referenceExposure,
      manualAperture:
        selection.resolvedAperture,
      manualShutterSeconds:
        selection
          .resolvedShutterSeconds,
      isoControl: {
        kind: "automatic",
        quantizationPolicy:
          input.policy
            .isoQuantizationPolicy,
        ...(input.policy
          .autoIsoLimits ===
        undefined
          ? {}
          : {
              autoIsoLimits:
                input.policy
                  .autoIsoLimits
            })
      }
    });

  if (
    isoPass.status !== "resolved" ||
    isoPass.isoControl !== "automatic"
  ) {
    throw new InvalidScientificInputError(
      "Full Auto exposure could not resolve its Auto ISO pass."
    );
  }

  return {
    resolverVersion:
      EXPOSURE_MODE_RESOLVER_VERSION,
    mode:
      "full-auto-exposure",
    status: "resolved",
    axisOwnership: {
      aperture: "automatic",
      shutter: "automatic",
      iso: "automatic"
    },
    policy: input.policy,
    targetId: target.targetId,
    targetSourceMeterSnapshot:
      target.sourceMeterSnapshot,
    referenceExposure,
    programLineSelection:
      selection,
    apertureResolvedByResolver: true,
    shutterResolvedByResolver: true,
    exposureCompensationAppliedByResolver:
      false,
    meterRecomputedByResolver:
      false,
    flashPolicyApplied: false,
    safetyShiftApplied: false,
    baselineIso,
    idealIsoBeforeConstraints:
      isoPass
        .idealIsoBeforeConstraints,
    isoResolution:
      isoPass.isoResolution,
    resolvedSettings:
      isoPass.resolvedSettings,
    targetResidual:
      isoPass.targetResidual,
    autofocusResolved: false,
    whiteBalanceResolved: false,
    flashResolved: false,
    driveResolved: false,
    sceneRecognitionResolved:
      false,
    stabilizationPolicyResolved:
      false
  };
}

