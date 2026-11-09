// SPDX-License-Identifier: Apache-2.0

/**
 * Focus control: manual focus (MF), single autofocus (AF-S) and continuous autofocus (AF-C), focus
 * lock, and the focus-priority or release-priority check before the shutter fires.
 *
 * Focus is always a distance along the optical axis (a focus plane) or infinity, never a distance
 * on screen. The focus "actuator" is ideal: it focuses on the target observations it is given. It
 * does not model a real AF sensor, a focus-ring scale or how long focusing takes. Losing a target,
 * reacquiring it, locking focus and the release-priority decision are separate state changes.
 * @see docs/SIMULATED_CAPTURE.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  parseFocusPlane,
  type FocusPlane
} from "../optics/focus-state.js";
import { requireInputObject, requireInputKeys, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireTrimmedConfigString as requireScientificNonEmptyString, requireInputNonNegativeFinite as requireScientificNonNegativeFinite, requireInputPositiveFinite as requireScientificPositiveFinite, parseConfigLimitations as parseLimitations } from "../core/record-validation.js";
import { deepFreeze, cloneJson } from "../core/shared-helpers.js";

export const FOCUS_CONTROL_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;
export const FOCUS_CONTROL_STATE_VERSION =
  "0.1.0" as const;

export type FocusControlMode =
  | "manual"
  | "single-af"
  | "continuous-af";

export type FocusAcquisitionState =
  | "idle"
  | "acquiring"
  | "acquired"
  | "target-lost"
  | "locked";

export type FocusReleasePriority =
  | "focus-priority"
  | "release-priority"
  | "balanced";

export type FocusTargetLossReason =
  | "occluded"
  | "out-of-frame"
  | "identity-lost"
  | "outside-focus-area";

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

interface FocusTargetObservationBase {
  targetId: string;
  focusAreaId?: string;
  observedAtSeconds: number;
}

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

/**
 * Immutable focus-controller state for MF, AF-S or AF-C.
 *
 * The resolved focus is a finite distance along the optical axis in metres, or infinity.
 * Acquisition, loss, reacquisition and lock records explain why a target can be used. The
 * focus-release check is separate from shutter sequencing. The ideal actuator does not model
 * real AF accuracy or the physical time focusing takes.
 */
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

export interface SetManualFocusStateInput {
  state:
    FocusControlState;
  stateId: string;
  focus:
    FocusPlane;
  eventTimeSeconds: number;
  commandId?: string;
}

export type FocusTargetControlEvent =
  | "acquire"
  | "update";

export interface ResolveFocusTargetObservationInput {
  state:
    FocusControlState;
  stateId: string;
  event:
    FocusTargetControlEvent;
  observation:
    FocusTargetObservation;
}

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

export interface SetFocusLockInput {
  state:
    FocusControlState;
  stateId: string;
  locked: boolean;
  eventTimeSeconds: number;
}

export interface AssessFocusReleaseGateInput {
  state:
    FocusControlState;
  profile:
    FocusControlProfile;
  priority:
    FocusReleasePriority;
}

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

const FOCUS_MODES =
  new Set<FocusControlMode>([
    "manual",
    "single-af",
    "continuous-af"
  ]);

const RELEASE_PRIORITIES =
  new Set<FocusReleasePriority>([
    "focus-priority",
    "release-priority",
    "balanced"
  ]);

const TARGET_LOSS_REASONS =
  new Set<FocusTargetLossReason>([
    "occluded",
    "out-of-frame",
    "identity-lost",
    "outside-focus-area"
  ]);

function parseUniqueEnumList<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<T>
): readonly T[] {
  if (
    !Array.isArray(value) ||
    value.length === 0
  ) {
    throw new InvalidConfigurationError(
      path +
        " must be a non-empty array."
    );
  }
  const parsed =
    value.map((entry, index) => {
      if (
        typeof entry !==
          "string" ||
        !allowed.has(entry as T)
      ) {
        throw new InvalidConfigurationError(
          path +
            "[" +
            index +
            "] is invalid."
        );
      }
      return entry as T;
    });
  if (
    new Set(parsed).size !==
    parsed.length
  ) {
    throw new InvalidConfigurationError(
      path +
        " must not contain duplicates."
    );
  }
  return parsed;
}

/**
 * Validates an untrusted focus-control profile and returns it normalized. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * Focus is a distance along the optical axis or infinity, never a distance on screen. The ideal
 * actuator focuses on the target observations it is given. It does not model a real AF sensor, a
 * focus-ring scale or focusing time.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The validated profile. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseFocusControlProfile(
  value: unknown
): FocusControlProfile {
  const record =
    requireRecord(
      value,
      "focusControlProfile", ["schemaVersion", "scientificStatus", "actuator", "continuousTargetLossPolicy", "profileId", "profileVersion", "supportedModes", "supportedReleasePriorities", "evidence", "limitations"]
    );

  if (
    record.schemaVersion !==
    FOCUS_CONTROL_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'focusControlProfile.schemaVersion must be "' +
        FOCUS_CONTROL_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      'focusControlProfile.scientificStatus must be "approximation".'
    );
  }

  const actuator =
    requireRecord(
      record.actuator,
      "focusControlProfile.actuator", ["kind", "evidence"]
    );
  if (
    actuator.kind !==
    "ideal-instantaneous"
  ) {
    throw new InvalidConfigurationError(
      'focusControlProfile.actuator.kind must be "ideal-instantaneous" in schema 0.1.0.'
    );
  }
  if (
    record
      .continuousTargetLossPolicy !==
    "hold-last-focus-require-explicit-reacquisition"
  ) {
    throw new InvalidConfigurationError(
      'focusControlProfile.continuousTargetLossPolicy must be "hold-last-focus-require-explicit-reacquisition".'
    );
  }

  return {
    schemaVersion:
      FOCUS_CONTROL_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "focusControlProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "focusControlProfile.profileVersion"
      ),
    scientificStatus:
      "approximation",
    supportedModes:
      parseUniqueEnumList(
        record.supportedModes,
        "focusControlProfile.supportedModes",
        FOCUS_MODES
      ),
    actuator: {
      kind:
        "ideal-instantaneous",
      evidence:
        parseEvidenceList(
          actuator.evidence,
          "focusControlProfile.actuator.evidence"
        )
    },
    continuousTargetLossPolicy:
      "hold-last-focus-require-explicit-reacquisition",
    supportedReleasePriorities:
      parseUniqueEnumList(
        record
          .supportedReleasePriorities,
        "focusControlProfile.supportedReleasePriorities",
        RELEASE_PRIORITIES
      ),
    evidence:
      parseEvidenceList(
        record.evidence,
        "focusControlProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "focusControlProfile.limitations"
      )
  };
}

function immutableState(
  state:
    FocusControlState
): FocusControlState {
  return deepFreeze(
    cloneJson(state)
  );
}

function stateBase(
  stateId: string,
  profile:
    FocusControlProfile,
  mode:
    FocusControlMode,
  focus:
    FocusPlane,
  acquisitionState:
    FocusAcquisitionState,
  eventTimeSeconds: number,
  focusResolvedAtSeconds:
    number,
  activeTargetId?:
    string,
  activeFocusAreaId?:
    string,
  lock?:
    FocusControlState["lock"]
): FocusControlState {
  return immutableState({
    version:
      FOCUS_CONTROL_STATE_VERSION,
    stateId:
      requireScientificNonEmptyString(
        stateId,
        "stateId"
      ),
    sourceProfile: {
      profileId:
        profile.profileId,
      profileVersion:
        profile.profileVersion
    },
    profileLimitations: [
      ...profile.limitations
    ],
    mode,
    acquisitionState,
    focus:
      parseFocusPlane(focus),
    ...(activeTargetId ===
    undefined
      ? {}
      : {
          activeTargetId
        }),
    ...(activeFocusAreaId ===
    undefined
      ? {}
      : {
          activeFocusAreaId
        }),
    lastEventTimeSeconds:
      eventTimeSeconds,
    focusResolvedAtSeconds,
    locked:
      acquisitionState ===
      "locked",
    ...(lock === undefined
      ? {}
      : {
          lock
        }),
    actuatorModel:
      "ideal-instantaneous",
    continuousTargetLossPolicy:
      profile
        .continuousTargetLossPolicy,
    exposureModified: false,
    meteringModified: false,
    whiteBalanceModified:
      false,
    subjectTrackingRecognitionModeled:
      false,
    rendererCoordinatesConsumed:
      false,
    limitations: [
      ...profile.limitations,
      "Focus target observations use longitudinal camera-space/conjugate distance, not renderer ray length.",
      "Ideal instantaneous focus actuation is an approximation and does not represent commercial AF speed, error, hunting, recognition, or low-light behavior.",
      "Focus control does not modify exposure, metering, white balance, or scene illumination."
    ]
  });
}

function requireSupportedMode(
  profile:
    FocusControlProfile,
  mode:
    FocusControlMode
): void {
  if (
    !profile.supportedModes
      .includes(mode)
  ) {
    throw new InvalidScientificInputError(
      "Selected focus-control mode is not supported by the profile."
    );
  }
}

function requireMonotonicEventTime(
  current:
    FocusControlState,
  eventTimeSeconds: number
): number {
  const parsed =
    requireScientificNonNegativeFinite(
      eventTimeSeconds,
      "eventTimeSeconds"
    );
  if (
    parsed <
    current.lastEventTimeSeconds
  ) {
    throw new InvalidScientificInputError(
      "Focus-control event time must not move backward."
    );
  }
  return parsed;
}

function verifyStateProfile(
  state:
    FocusControlState,
  profile:
    FocusControlProfile
): void {
  if (
    state.sourceProfile
      .profileId !==
      profile.profileId ||
    state.sourceProfile
      .profileVersion !==
      profile.profileVersion
  ) {
    throw new InvalidScientificInputError(
      "Focus-control state/profile identity does not match."
    );
  }
}

/**
 * Creates the initial ideal focus-controller state from a profile, a focus plane and a public
 * state ID.
 * @param input - New state ID, profile, focus mode, initial focus plane and optional start time.
 * @returns The initial state. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function createFocusControlState(
  input:
    CreateFocusControlStateInput
): FocusControlState {
  requireInputKeys(input, "createFocusControlState", ["stateId", "profile", "mode", "initialFocus", "initialTimeSeconds"]);
  const profile =
    parseFocusControlProfile(
      input.profile
    );
  requireSupportedMode(
    profile,
    input.mode
  );
  const time =
    input.initialTimeSeconds ===
    undefined
      ? 0
      : requireScientificNonNegativeFinite(
          input.initialTimeSeconds,
          "initialTimeSeconds"
        );

  return stateBase(
    input.stateId,
    profile,
    input.mode,
    input.initialFocus,
    "idle",
    time,
    time
  );
}

function stateProfileView(
  state:
    FocusControlState
): FocusControlProfile {
  return {
    schemaVersion:
      FOCUS_CONTROL_PROFILE_SCHEMA_VERSION,
    profileId:
      state.sourceProfile
        .profileId,
    profileVersion:
      state.sourceProfile
        .profileVersion,
    scientificStatus:
      "approximation",
    supportedModes: [
      state.mode
    ],
    actuator: {
      kind:
        "ideal-instantaneous",
      evidence: []
    },
    continuousTargetLossPolicy:
      state
        .continuousTargetLossPolicy,
    supportedReleasePriorities: [
      "focus-priority",
      "release-priority",
      "balanced"
    ],
    evidence: [],
    limitations:
      state.profileLimitations
  };
}

/**
 * Returns the state after manually focusing on the given finite or infinity plane. No lens
 * actuator or focus-ring conversion is modelled.
 * @param input - Current state, new state ID, new focus plane and event time.
 * @returns The new state. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function setManualFocusState(
  input:
    SetManualFocusStateInput
): FocusControlState {
  requireInputKeys(input, "setManualFocusState", ["state", "stateId", "focus", "eventTimeSeconds", "commandId"]);
  requireInputObject(input.state, "state");
  if (
    input.state.mode !==
    "manual"
  ) {
    throw new InvalidScientificInputError(
      "setManualFocusState requires manual focus mode."
    );
  }
  if (input.state.locked) {
    throw new InvalidScientificInputError(
      "Manual focus cannot change while focus lock is active."
    );
  }
  if (
    input.commandId !==
    undefined
  ) {
    requireScientificNonEmptyString(
      input.commandId,
      "commandId"
    );
  }
  const time =
    requireMonotonicEventTime(
      input.state,
      input.eventTimeSeconds
    );

  return stateBase(
    input.stateId,
    stateProfileView(
      input.state
    ),
    "manual",
    input.focus,
    "idle",
    time,
    time
  );
}

function parseObservation(
  observation:
    FocusTargetObservation
): FocusTargetObservation {
  const targetId =
    requireScientificNonEmptyString(
      observation.targetId,
      "observation.targetId"
    );
  const observedAtSeconds =
    requireScientificNonNegativeFinite(
      observation
        .observedAtSeconds,
      "observation.observedAtSeconds"
    );
  const focusAreaId =
    observation.focusAreaId ===
    undefined
      ? undefined
      : requireScientificNonEmptyString(
          observation.focusAreaId,
          "observation.focusAreaId"
        );

  if (
    observation.kind ===
    "finite-surface"
  ) {
    return {
      kind: "finite-surface",
      targetId,
      ...(focusAreaId ===
      undefined
        ? {}
        : {
            focusAreaId
          }),
      observedAtSeconds,
      longitudinalDistanceM:
        requireScientificPositiveFinite(
          observation
            .longitudinalDistanceM,
          "observation.longitudinalDistanceM"
        )
    };
  }

  if (
    observation.kind ===
    "infinity-environment"
  ) {
    return {
      kind:
        "infinity-environment",
      targetId,
      ...(focusAreaId ===
      undefined
        ? {}
        : {
            focusAreaId
          }),
      observedAtSeconds
    };
  }

  if (
    observation.kind ===
      "unavailable" &&
    TARGET_LOSS_REASONS.has(
      observation.reason
    )
  ) {
    return {
      kind: "unavailable",
      targetId,
      ...(focusAreaId ===
      undefined
        ? {}
        : {
            focusAreaId
          }),
      observedAtSeconds,
      reason:
        observation.reason
    };
  }

  throw new InvalidConfigurationError(
    "observation.kind/reason is invalid."
  );
}

function focusFromObservation(
  observation:
    Exclude<
      FocusTargetObservation,
      {
        kind: "unavailable";
      }
    >
): FocusPlane {
  if (
    observation.kind ===
    "infinity-environment"
  ) {
    return {
      kind: "infinity"
    };
  }
  return {
    kind: "finite",
    distanceM:
      observation
        .longitudinalDistanceM
  };
}

function focusEquals(
  a: FocusPlane,
  b: FocusPlane
): boolean {
  if (
    a.kind !== b.kind
  ) {
    return false;
  }
  if (
    a.kind === "infinity" ||
    b.kind === "infinity"
  ) {
    return true;
  }
  return (
    a.distanceM ===
    b.distanceM
  );
}

function stateFromResolvedTarget(
  input:
    ResolveFocusTargetObservationInput,
  observation:
    Exclude<
      FocusTargetObservation,
      {
        kind: "unavailable";
      }
    >
): FocusTargetResolution {
  const focus =
    focusFromObservation(
      observation
    );
  const state =
    stateBase(
      input.stateId,
      stateProfileView(
        input.state
      ),
      input.state.mode,
      focus,
      "acquired",
      observation
        .observedAtSeconds,
      observation
        .observedAtSeconds,
      observation.targetId,
      observation.focusAreaId
    );
  return {
    state,
    targetObservationApplied:
      true,
    focusChanged:
      !focusEquals(
        input.state.focus,
        focus
      ),
    acquisitionEvent:
      input.event,
    actuatorModel:
      "ideal-instantaneous",
    silentRetargetingPerformed:
      false
  };
}

function unchangedResolution(
  input:
    ResolveFocusTargetObservationInput
): FocusTargetResolution {
  return {
    state: input.state,
    targetObservationApplied:
      false,
    focusChanged: false,
    acquisitionEvent:
      input.event,
    actuatorModel:
      "ideal-instantaneous",
    silentRetargetingPerformed:
      false
  };
}

/**
 * Applies one target observation (target available or lost) under the selected AF-S or AF-C
 * policy, and records whether the target was acquired or reacquired.
 *
 * The ideal actuator focuses on the observation as given. Target loss, reacquisition, focus
 * lock and release priority are separate state changes.
 * @param input - Current state, new state ID, control event and target observation.
 * @returns The resolution and new state. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function resolveFocusTargetObservation(
  input:
    ResolveFocusTargetObservationInput
): FocusTargetResolution {
  requireInputKeys(input, "resolveFocusTargetObservation", ["state", "stateId", "event", "observation"]);
  if (
    input.event !== "acquire" &&
    input.event !== "update"
  ) {
    throw new InvalidConfigurationError(
      'Focus target event must be "acquire" or "update".'
    );
  }
  if (
    input.state.mode ===
    "manual"
  ) {
    throw new InvalidScientificInputError(
      "Manual focus does not automatically consume autofocus target observations."
    );
  }

  const observation =
    parseObservation(
      input.observation
    );
  requireMonotonicEventTime(
    input.state,
    observation
      .observedAtSeconds
  );

  if (input.state.locked) {
    return unchangedResolution(
      input
    );
  }

  if (
    input.state.mode ===
    "single-af"
  ) {
    if (
      input.event ===
        "update" &&
      input.state
        .acquisitionState ===
        "acquired"
    ) {
      return unchangedResolution(
        input
      );
    }
    if (
      input.event !==
      "acquire"
    ) {
      throw new InvalidScientificInputError(
        "Single AF requires an explicit acquire event before target updates."
      );
    }
    if (
      observation.kind ===
      "unavailable"
    ) {
      const state =
        stateBase(
          input.stateId,
          stateProfileView(
            input.state
          ),
          "single-af",
          input.state.focus,
          "target-lost",
          observation
            .observedAtSeconds,
          input.state
            .focusResolvedAtSeconds,
          observation.targetId,
          observation.focusAreaId
        );
      return {
        state,
        targetObservationApplied:
          true,
        focusChanged: false,
        acquisitionEvent:
          input.event,
        actuatorModel:
          "ideal-instantaneous",
        silentRetargetingPerformed:
          false
      };
    }
    return stateFromResolvedTarget(
      input,
      observation
    );
  }

  if (
    input.event ===
    "update"
  ) {
    if (
      input.state
        .activeTargetId ===
      undefined
    ) {
      throw new InvalidScientificInputError(
        "Continuous AF requires an explicit acquire event before updates."
      );
    }
    if (
      observation.targetId !==
      input.state
        .activeTargetId
    ) {
      throw new InvalidScientificInputError(
        "Continuous AF update targetId must match the active target; silent retargeting is not permitted."
      );
    }
    if (
      input.state
        .acquisitionState ===
      "target-lost"
    ) {
      throw new InvalidScientificInputError(
        "Continuous AF target loss requires an explicit acquire event before reacquisition."
      );
    }
  }

  if (
    observation.kind ===
    "unavailable"
  ) {
    const state =
      stateBase(
        input.stateId,
        stateProfileView(
          input.state
        ),
        "continuous-af",
        input.state.focus,
        "target-lost",
        observation
          .observedAtSeconds,
        input.state
          .focusResolvedAtSeconds,
        observation.targetId,
        observation.focusAreaId
      );
    return {
      state,
      targetObservationApplied:
        true,
      focusChanged: false,
      acquisitionEvent:
        input.event,
      actuatorModel:
        "ideal-instantaneous",
      silentRetargetingPerformed:
        false
    };
  }

  return stateFromResolvedTarget(
    input,
    observation
  );
}

/**
 * Locks or unlocks focus. The physical focus plane does not change.
 * @param input - Current state, new state ID, lock setting and event time.
 * @returns The new state. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function setFocusLock(
  input:
    SetFocusLockInput
): FocusControlState {
  requireInputKeys(input, "setFocusLock", ["state", "stateId", "locked", "eventTimeSeconds"]);
  const time =
    requireMonotonicEventTime(
      input.state,
      input.eventTimeSeconds
    );

  if (input.locked) {
    if (input.state.locked) {
      return input.state;
    }
    return stateBase(
      input.stateId,
      stateProfileView(
        input.state
      ),
      input.state.mode,
      input.state.focus,
      "locked",
      time,
      input.state
        .focusResolvedAtSeconds,
      input.state
        .activeTargetId,
      input.state
        .activeFocusAreaId,
      {
        lockedAtSeconds:
          time,
        resumeAcquisitionState:
          input.state
            .acquisitionState as Exclude<
              FocusAcquisitionState,
              "locked"
            >
      }
    );
  }

  if (!input.state.locked) {
    return input.state;
  }
  const resume =
    input.state.lock
      ?.resumeAcquisitionState;
  if (resume === undefined) {
    throw new InvalidScientificInputError(
      "Locked focus state is missing its resume acquisition state."
    );
  }

  return stateBase(
    input.stateId,
    stateProfileView(
      input.state
    ),
    input.state.mode,
    input.state.focus,
    resume,
    time,
    input.state
      .focusResolvedAtSeconds,
    input.state
      .activeTargetId,
    input.state
      .activeFocusAreaId
  );
}

/**
 * Reports whether the shutter may be released under the focus-priority or release-priority
 * policy. It does not operate the shutter.
 * @param input - Current state, profile and release priority.
 * @returns The assessment. Read its structured blockers before acting on an authorization.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function assessFocusReleaseGate(
  input:
    AssessFocusReleaseGateInput
): FocusReleaseGateAssessment {
  requireInputKeys(input, "assessFocusReleaseGate", ["state", "profile", "priority"]);
  const profile =
    parseFocusControlProfile(
      input.profile
    );
  verifyStateProfile(
    input.state,
    profile
  );

  if (
    !profile
      .supportedReleasePriorities
      .includes(
        input.priority
      )
  ) {
    throw new InvalidScientificInputError(
      "Selected focus/release priority is not supported by the profile."
    );
  }

  if (
    input.priority ===
    "release-priority"
  ) {
    return {
      priority:
        input.priority,
      releaseAuthorized: true,
      reason:
        "release-priority-bypasses-focus-gate",
      requiresProfileSpecificBalancedPolicy:
        false,
      opticalFocusModified:
        false,
      exposureModified:
        false
    };
  }

  if (
    input.priority ===
    "balanced"
  ) {
    return {
      priority:
        input.priority,
      releaseAuthorized:
        false,
      reason:
        "balanced-policy-not-modeled",
      requiresProfileSpecificBalancedPolicy:
        true,
      opticalFocusModified:
        false,
      exposureModified:
        false
    };
  }

  if (
    input.state.mode ===
    "manual"
  ) {
    return {
      priority:
        input.priority,
      releaseAuthorized: true,
      reason:
        "manual-focus-state",
      requiresProfileSpecificBalancedPolicy:
        false,
      opticalFocusModified:
        false,
      exposureModified:
        false
    };
  }

  if (
    input.state
      .acquisitionState ===
    "locked"
  ) {
    return {
      priority:
        input.priority,
      releaseAuthorized: true,
      reason:
        "focus-locked",
      requiresProfileSpecificBalancedPolicy:
        false,
      opticalFocusModified:
        false,
      exposureModified:
        false
    };
  }

  if (
    input.state
      .acquisitionState ===
    "acquired"
  ) {
    return {
      priority:
        input.priority,
      releaseAuthorized: true,
      reason:
        "focus-acquired",
      requiresProfileSpecificBalancedPolicy:
        false,
      opticalFocusModified:
        false,
      exposureModified:
        false
    };
  }

  return {
    priority:
      input.priority,
    releaseAuthorized: false,
    reason:
      "focus-not-acquired",
    requiresProfileSpecificBalancedPolicy:
      false,
    opticalFocusModified:
      false,
    exposureModified:
      false
  };
}
