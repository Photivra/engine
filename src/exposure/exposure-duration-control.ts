// SPDX-License-Identifier: Apache-2.0

/**
 * Shutter-duration control. Turns a control setting (a timed value, Bulb or Time) into a concrete,
 * positive elapsed duration, before the physical exposure is integrated.
 *
 * Bulb and Time are only control behaviours. Neither implies a shutter mechanism, an exposure-boundary
 * layout, a tripod, a stabilization state, long-exposure noise reduction (NR) or a temperature model.
 *
 * The binding function puts a resolved duration into the capture exposure-window input. The existing
 * shutter mechanism and opening/closing schedules are left as they are. Only the nominal duration, in
 * seconds, is supplied.
 * @see docs/USAGE.md for the equations, units, coordinate conventions, known blockers and support
 * limits.
 */

import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type {
  CalculateCaptureExposureWindowsInput
} from "../sensor/exposure-window.js";
import { requireInputObject, requireInputKeys, requireInputFinite as requireFiniteSeconds, requireInputFiniteAboveZero as requirePositiveSeconds } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export const EXPOSURE_DURATION_CONTROL_VERSION =
  "0.1.0" as const;

export type ExposureDurationControl =
  | {
      kind: "fixed-duration";
      durationSeconds: number;
    }
  | {
      kind: "bulb";
      timeReference:
        "control-monotonic-seconds";
      pressSeconds: number;
      releaseSeconds?: number;
    }
  | {
      kind: "time";
      timeReference:
        "control-monotonic-seconds";
      startSeconds: number;
      stopSeconds?: number;
    };

interface ExposureDurationControlResolutionBase {
  version:
    typeof EXPOSURE_DURATION_CONTROL_VERSION;
  controlKind:
    ExposureDurationControl["kind"];
  shutterMechanismInferred: false;
  exposureBoundaryTopologyInferred:
    false;
  tripodSupportInferred: false;
  stabilizationStateInferred: false;
  longExposureNoiseReductionInferred:
    false;
  sensorTemperatureBehaviorInferred:
    false;
}

export type ExposureDurationControlResolution =
  | (ExposureDurationControlResolutionBase & {
      status: "resolved";
      durationSeconds: number;
      physicalExposureIntegrationAuthorized:
        true;
    })
  | (ExposureDurationControlResolutionBase & {
      status: "active";
      durationSeconds: null;
      physicalExposureIntegrationAuthorized:
        false;
      waitingFor:
        | "bulb-release"
        | "time-stop";
    });

export interface BindResolvedExposureDurationToCaptureExposureInput {
  resolution:
    Extract<
      ExposureDurationControlResolution,
      { status: "resolved" }
    >;
  durationEvidence:
    readonly EvidenceProvenance[];
  exposureWindowInput:
    Omit<
      CalculateCaptureExposureWindowsInput,
      "nominalExposureDurationSeconds"
    >;
}

function resolved(
  kind: ExposureDurationControl["kind"],
  durationSeconds: number
): Extract<
  ExposureDurationControlResolution,
  { status: "resolved" }
> {
  return {
    version:
      EXPOSURE_DURATION_CONTROL_VERSION,
    controlKind: kind,
    status: "resolved",
    durationSeconds,
    physicalExposureIntegrationAuthorized:
      true,
    shutterMechanismInferred: false,
    exposureBoundaryTopologyInferred:
      false,
    tripodSupportInferred: false,
    stabilizationStateInferred: false,
    longExposureNoiseReductionInferred:
      false,
    sensorTemperatureBehaviorInferred:
      false
  };
}

function active(
  kind: "bulb" | "time"
): Extract<
  ExposureDurationControlResolution,
  { status: "active" }
> {
  return {
    version:
      EXPOSURE_DURATION_CONTROL_VERSION,
    controlKind: kind,
    status: "active",
    durationSeconds: null,
    physicalExposureIntegrationAuthorized:
      false,
    waitingFor:
      kind === "bulb"
        ? "bulb-release"
        : "time-stop",
    shutterMechanismInferred: false,
    exposureBoundaryTopologyInferred:
      false,
    tripodSupportInferred: false,
    stabilizationStateInferred: false,
    longExposureNoiseReductionInferred:
      false,
    sensorTemperatureBehaviorInferred:
      false
  };
}

/**
 * Turns a shutter-duration control setting into a concrete, positive elapsed
 * duration, before the physical exposure is integrated.
 *
 * Bulb and Time are only control behaviours. Neither implies a shutter
 * mechanism, an exposure-boundary layout, a tripod, a stabilization state,
 * long-exposure noise reduction (NR) or a temperature model.
 */
export function resolveExposureDurationControl(
  control: ExposureDurationControl
): ExposureDurationControlResolution {
  requireInputKeys(control, "resolveExposureDurationControl", ["kind", "durationSeconds", "timeReference", "pressSeconds", "releaseSeconds", "startSeconds", "stopSeconds"]);

  if (
    control.kind ===
    "fixed-duration"
  ) {
    return resolved(
      "fixed-duration",
      requirePositiveSeconds(
        control.durationSeconds,
        "control.durationSeconds"
      )
    );
  }

  if (
    control.kind === "bulb"
  ) {
    if (
      control.timeReference !==
      "control-monotonic-seconds"
    ) {
      throw new InvalidConfigurationError(
        'Bulb control timeReference must be "control-monotonic-seconds".'
      );
    }
    const start =
      requireFiniteSeconds(
        control.pressSeconds,
        "control.pressSeconds"
      );
    if (
      control.releaseSeconds ===
      undefined
    ) {
      return active("bulb");
    }
    const stop =
      requireFiniteSeconds(
        control.releaseSeconds,
        "control.releaseSeconds"
      );
    const duration = stop - start;
    if (duration <= 0) {
      throw new InvalidScientificInputError(
        "Bulb releaseSeconds must be greater than pressSeconds."
      );
    }
    return resolved(
      "bulb",
      duration
    );
  }

  if (
    control.kind === "time"
  ) {
    if (
      control.timeReference !==
      "control-monotonic-seconds"
    ) {
      throw new InvalidConfigurationError(
        'Time control timeReference must be "control-monotonic-seconds".'
      );
    }
    const start =
      requireFiniteSeconds(
        control.startSeconds,
        "control.startSeconds"
      );
    if (
      control.stopSeconds ===
      undefined
    ) {
      return active("time");
    }
    const stop =
      requireFiniteSeconds(
        control.stopSeconds,
        "control.stopSeconds"
      );
    const duration = stop - start;
    if (duration <= 0) {
      throw new InvalidScientificInputError(
        "Time stopSeconds must be greater than startSeconds."
      );
    }
    return resolved(
      "time",
      duration
    );
  }

  throw new InvalidConfigurationError(
    "control.kind is invalid."
  );
}

/**
 * Puts a resolved duration into the capture exposure-window input.
 *
 * The existing shutter mechanism and opening/closing schedules are left as
 * they are. Only the nominal duration, in seconds, is supplied.
 */
export function bindResolvedExposureDurationToCaptureExposureInput(
  input:
    BindResolvedExposureDurationToCaptureExposureInput
): CalculateCaptureExposureWindowsInput {
  requireInputKeys(input, "bindResolvedExposureDurationToCaptureExposureInput", ["resolution", "durationEvidence", "exposureWindowInput"]);
  const resolution =
    input.resolution;

  requireInputObject(resolution, "resolution input");
  if (
    resolution.version !==
      EXPOSURE_DURATION_CONTROL_VERSION ||
    resolution.status !==
      "resolved" ||
    resolution
      .physicalExposureIntegrationAuthorized !==
      true
  ) {
    throw new InvalidScientificInputError(
      "resolution must be a resolved exposure-duration control result authorized for physical integration."
    );
  }

  const durationSeconds =
    requirePositiveSeconds(
      resolution.durationSeconds,
      "resolution.durationSeconds"
    );

  if (
    resolution.shutterMechanismInferred !==
      false ||
    resolution
      .exposureBoundaryTopologyInferred !==
      false ||
    resolution.tripodSupportInferred !==
      false ||
    resolution
      .stabilizationStateInferred !==
      false ||
    resolution
      .longExposureNoiseReductionInferred !==
      false ||
    resolution
      .sensorTemperatureBehaviorInferred !==
      false
  ) {
    throw new InvalidScientificInputError(
      "Resolved exposure duration must not carry inferred downstream camera/long-exposure state."
    );
  }

  return {
    ...input.exposureWindowInput,
    nominalExposureDurationSeconds: {
      value: durationSeconds,
      unit: "s",
      evidence: parseEvidenceList(
        input.durationEvidence,
        "durationEvidence"
      )
    }
  };
}
