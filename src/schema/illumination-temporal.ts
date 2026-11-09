// SPDX-License-Identifier: Apache-2.0

/**
 * Time-varying light sources, such as flicker or a pulsed light.
 *
 * A temporal profile sits on top of an existing illumination profile. Each binding multiplies
 * one source by a relative waveform over time. The base source magnitude and spectrum still
 * apply, and sources with no binding stay constant. This module parses the profile, evaluates
 * a waveform at one capture time, and integrates it over an exposure window.
 * @see docs/SCENE_RADIANCE_AND_ILLUMINATION.md for equations, coordinate/unit conventions, blockers
 * and support limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import {
  InvalidScientificInputError,
  requirePositiveInteger
} from "../core/validation.js";
import type {
  CaptureExposureWindows
} from "../sensor/exposure-window.js";
import type {
  SceneIlluminationProfile,
  SceneIlluminationUncertainty
} from "./illumination.js";
import { requireInputKeys, rejectUnknownVariantFields, requireFixedFieldsWhenPresent, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigFinite as requireFinite, parseConfigScientificStatus as parseScientificStatus, requireConfigFiniteAboveZero as requirePositiveFinite, requireConfigFiniteAtLeastZero as requireNonNegativeFinite } from "../core/record-validation.js";
import { parseUncertainty } from "../optics/lens-psf-profile.js";
import { positiveModulo } from "../optics/complex-pupil-psf.js";

export const SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;

export type SceneIlluminationTemporalScientificStatus =
  | "calibrated"
  | "approximation";

export interface SceneIlluminationTemporalWaveformSample {
  timeSecondsFromWaveformReference: number;
  relativeMagnitudeMultiplier: number;
}

interface SceneIlluminationTemporalWaveformBase {
  waveformId: string;
  timeUnit: "s";
  scientificStatus:
    SceneIlluminationTemporalScientificStatus;
  uncertainty: SceneIlluminationUncertainty;
  evidence: readonly EvidenceProvenance[];
  interpolation: "piecewise-linear";
  samples:
    readonly SceneIlluminationTemporalWaveformSample[];
}

export type SceneIlluminationTemporalWaveform =
  | (SceneIlluminationTemporalWaveformBase & {
      kind:
        "aperiodic-relative-multiplier";
      outsideSupportBehavior: "zero";
    })
  | (SceneIlluminationTemporalWaveformBase & {
      kind:
        "periodic-relative-multiplier";
      periodSeconds: number;
      endpointContinuityRequired: true;
    });

export type SceneIlluminationTemporalRegistrationUncertainty =
  | {
      kind: "absolute-seconds";
      plusMinusSeconds: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };

export interface SceneIlluminationTemporalSourceBinding {
  bindingId: string;
  sourceId: string;
  waveformId: string;
  captureTimeReference:
    "first-opening-boundary-phase";
  /**
   * The capture time at which the waveform's own t=0 falls.
   *
   * waveformTime = captureTime - waveformTimeZeroSecondsFromCaptureReference
   */
  waveformTimeZeroSecondsFromCaptureReference:
    number;
  scientificStatus:
    SceneIlluminationTemporalScientificStatus;
  timingUncertainty:
    SceneIlluminationTemporalRegistrationUncertainty;
  evidence: readonly EvidenceProvenance[];
}

export interface SceneIlluminationTemporalProfile {
  schemaVersion:
    typeof SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION;
  profileId: string;
  sceneId: string;
  illuminationProfileId: string;
  evidence: readonly EvidenceProvenance[];
  waveforms:
    readonly SceneIlluminationTemporalWaveform[];
  sourceBindings:
    readonly SceneIlluminationTemporalSourceBinding[];
  baseIlluminationProfileRemainsAuthoritative:
    true;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
  automaticExposurePolicyIncluded: false;
}

export interface EvaluateSceneIlluminationTemporalMultiplierInput {
  illuminationProfile:
    SceneIlluminationProfile;
  temporalProfile:
    SceneIlluminationTemporalProfile;
  sourceId: string;
  captureTimeSecondsFromReference: number;
}

export interface SceneIlluminationTemporalMultiplierEvaluation {
  sourceId: string;
  sourceEnabled: boolean;
  temporalProfileId: string;
  bindingId: string;
  waveformId: string;
  captureTimeReference:
    "first-opening-boundary-phase";
  captureTimeSecondsFromReference: number;
  waveformTimeSecondsFromWaveformReference:
    number;
  waveformKind:
    SceneIlluminationTemporalWaveform["kind"];
  relativeMagnitudeMultiplier: number;
  effectiveRelativeMagnitudeMultiplier:
    number;
  sourceMagnitudeApplied: false;
  materialTransportApplied: false;
  sceneRadianceCalculated: false;
  sensorReadoutTimingUsed: false;
  automaticExposureResolved: false;
}

export interface IntegrateSceneIlluminationTemporalMultiplierInput {
  illuminationProfile:
    SceneIlluminationProfile;
  temporalProfile:
    SceneIlluminationTemporalProfile;
  sourceId: string;
  exposureWindows: CaptureExposureWindows;
  sampleIndex: number;
  temporalSampleCount: number;
}

export interface SceneIlluminationTemporalIntegrationNode {
  temporalSampleIndex: number;
  localExposurePhase: number;
  captureTimeSecondsFromReference: number;
  waveformTimeSecondsFromWaveformReference:
    number;
  relativeMagnitudeMultiplier: number;
  effectiveRelativeMagnitudeMultiplier:
    number;
  normalizedTimeWeight: number;
  timeMeasureSeconds: number;
}

export interface SceneIlluminationTemporalExposureIntegration {
  sourceId: string;
  sourceEnabled: boolean;
  temporalProfileId: string;
  bindingId: string;
  waveformId: string;
  timeReference:
    "first-opening-boundary-phase";
  localExposureWindow: {
    startSecondsFromCaptureReference: number;
    endSecondsFromCaptureReference: number;
    durationSeconds: number;
  };
  quadratureScheme: "uniform-midpoint";
  temporalSampleCount: number;
  nodes:
    readonly SceneIlluminationTemporalIntegrationNode[];
  averageRelativeMagnitudeMultiplier:
    number;
  integratedRelativeMagnitudeSeconds:
    number;
  averageEffectiveRelativeMagnitudeMultiplier:
    number;
  integratedEffectiveRelativeMagnitudeSeconds:
    number;
  sourceMagnitudeApplied: false;
  materialTransportApplied: false;
  sceneRadianceCalculated: false;
  sensorReadoutTimingUsed: false;
  automaticExposureResolved: false;
  convergenceErrorEstimated: false;
}

function requireReusableNumericEvidence(
  value: unknown,
  path: string
): readonly EvidenceProvenance[] {
  const evidence = parseEvidenceList(
    value,
    path
  );
  if (
    !evidence.some(
      (entry) =>
        entry.reuseStatus ===
          "reusable-data" ||
        entry.reuseStatus ===
          "photivra-owned"
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        " must contain reusable-data or photivra-owned evidence because the waveform embeds reusable numeric data."
    );
  }
  return evidence;
}

function parseRegistrationUncertainty(
  value: unknown,
  path: string
): SceneIlluminationTemporalRegistrationUncertainty {
  const record = requireRecord(
    value,
    path, null
  );
  rejectUnknownVariantFields(record, "kind", { "absolute-seconds": ["kind", "plusMinusSeconds", "basis"], "not-quantified": ["kind", "limitation"] }, path);
  if (
    record.kind ===
    "absolute-seconds"
  ) {
    return {
      kind: "absolute-seconds",
      plusMinusSeconds:
        requireNonNegativeFinite(
          record.plusMinusSeconds,
          path +
            ".plusMinusSeconds"
        ),
      basis: requireNonEmptyString(
        record.basis,
        path + ".basis"
      )
    };
  }
  if (record.kind === "not-quantified") {
    return {
      kind: "not-quantified",
      limitation:
        requireNonEmptyString(
          record.limitation,
          path + ".limitation"
        )
    };
  }
  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseWaveformSamples(
  value: unknown,
  path: string
): readonly SceneIlluminationTemporalWaveformSample[] {
  if (
    !Array.isArray(value) ||
    value.length < 2
  ) {
    throw new InvalidConfigurationError(
      path +
        " must contain at least two samples."
    );
  }

  let previous =
    Number.NEGATIVE_INFINITY;
  return value.map((entry, index) => {
    const samplePath =
      path + "[" + index + "]";
    const sample = requireRecord(
      entry,
      samplePath, ["timeSecondsFromWaveformReference", "relativeMagnitudeMultiplier"]
    );
    const time =
      requireNonNegativeFinite(
        sample
          .timeSecondsFromWaveformReference,
        samplePath +
          ".timeSecondsFromWaveformReference"
      );
    if (time <= previous) {
      throw new InvalidConfigurationError(
        path +
          " times must be strictly increasing."
      );
    }
    previous = time;
    return {
      timeSecondsFromWaveformReference:
        time,
      relativeMagnitudeMultiplier:
        requireNonNegativeFinite(
          sample
            .relativeMagnitudeMultiplier,
          samplePath +
            ".relativeMagnitudeMultiplier"
        )
    };
  });
}

const WAVEFORM_BASE_FIELDS = ["kind", "waveformId", "timeUnit", "scientificStatus", "uncertainty", "evidence", "interpolation", "samples"] as const;

function parseWaveform(
  value: unknown,
  path: string
): SceneIlluminationTemporalWaveform {
  const record = requireRecord(
    value,
    path, null
  );
  rejectUnknownVariantFields(record, "kind", {
    "aperiodic-relative-multiplier": [...WAVEFORM_BASE_FIELDS, "outsideSupportBehavior"],
    "periodic-relative-multiplier": [...WAVEFORM_BASE_FIELDS, "periodSeconds", "endpointContinuityRequired"]
  }, path);
  if (record.timeUnit !== "s") {
    throw new InvalidConfigurationError(
      path + '.timeUnit must be "s".'
    );
  }
  if (
    record.interpolation !==
    "piecewise-linear"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.interpolation must be "piecewise-linear".'
    );
  }

  const waveformId =
    requireNonEmptyString(
      record.waveformId,
      path + ".waveformId"
    );
  const scientificStatus =
    parseScientificStatus(
      record.scientificStatus,
      path + ".scientificStatus"
    );
  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      path + ".uncertainty"
    );
  if (
    scientificStatus === "calibrated" &&
    uncertainty.kind !== "relative"
  ) {
    throw new InvalidConfigurationError(
      path +
        " calibrated waveform data requires quantified relative uncertainty."
    );
  }
  const evidence =
    requireReusableNumericEvidence(
      record.evidence,
      path + ".evidence"
    );
  const samples =
    parseWaveformSamples(
      record.samples,
      path + ".samples"
    );

  if (
    samples[0]!
      .timeSecondsFromWaveformReference !==
    0
  ) {
    throw new InvalidConfigurationError(
      path +
        ".samples must begin at waveform-local t=0."
    );
  }

  if (
    record.kind ===
    "aperiodic-relative-multiplier"
  ) {
    if (
      record.outsideSupportBehavior !==
      "zero"
    ) {
      throw new InvalidConfigurationError(
        path +
          '.outsideSupportBehavior must be "zero".'
      );
    }
    return {
      kind:
        "aperiodic-relative-multiplier",
      waveformId,
      timeUnit: "s",
      scientificStatus,
      uncertainty,
      evidence,
      interpolation:
        "piecewise-linear",
      samples,
      outsideSupportBehavior:
        "zero"
    };
  }

  if (
    record.kind ===
    "periodic-relative-multiplier"
  ) {
    const periodSeconds =
      requirePositiveFinite(
        record.periodSeconds,
        path + ".periodSeconds"
      );
    const last =
      samples[samples.length - 1]!;
    if (
      last
        .timeSecondsFromWaveformReference !==
      periodSeconds
    ) {
      throw new InvalidConfigurationError(
        path +
          ".samples must end exactly at periodSeconds."
      );
    }
    if (
      samples[0]!
        .relativeMagnitudeMultiplier !==
      last.relativeMagnitudeMultiplier
    ) {
      throw new InvalidConfigurationError(
        path +
          " periodic endpoint multipliers must match."
      );
    }
    if (
      record.endpointContinuityRequired !==
      true
    ) {
      throw new InvalidConfigurationError(
        path +
          ".endpointContinuityRequired must be true."
      );
    }
    return {
      kind:
        "periodic-relative-multiplier",
      waveformId,
      timeUnit: "s",
      scientificStatus,
      uncertainty,
      evidence,
      interpolation:
        "piecewise-linear",
      samples,
      periodSeconds,
      endpointContinuityRequired:
        true
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseSourceBinding(
  value: unknown,
  path: string
): SceneIlluminationTemporalSourceBinding {
  const record = requireRecord(
    value,
    path, ["captureTimeReference", "scientificStatus", "timingUncertainty", "bindingId", "sourceId", "waveformId", "waveformTimeZeroSecondsFromCaptureReference", "evidence"]
  );
  if (
    record.captureTimeReference !==
    "first-opening-boundary-phase"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.captureTimeReference must be "first-opening-boundary-phase".'
    );
  }

  const scientificStatus =
    parseScientificStatus(
      record.scientificStatus,
      path + ".scientificStatus"
    );
  const timingUncertainty =
    parseRegistrationUncertainty(
      record.timingUncertainty,
      path + ".timingUncertainty"
    );
  if (
    scientificStatus === "calibrated" &&
    timingUncertainty.kind !==
      "absolute-seconds"
  ) {
    throw new InvalidConfigurationError(
      path +
        " calibrated waveform registration requires quantified absolute timing uncertainty."
    );
  }

  return {
    bindingId:
      requireNonEmptyString(
        record.bindingId,
        path + ".bindingId"
      ),
    sourceId:
      requireNonEmptyString(
        record.sourceId,
        path + ".sourceId"
      ),
    waveformId:
      requireNonEmptyString(
        record.waveformId,
        path + ".waveformId"
      ),
    captureTimeReference:
      "first-opening-boundary-phase",
    waveformTimeZeroSecondsFromCaptureReference:
      requireFinite(
        record
          .waveformTimeZeroSecondsFromCaptureReference,
        path +
          ".waveformTimeZeroSecondsFromCaptureReference"
      ),
    scientificStatus,
    timingUncertainty,
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    )
  };
}

/** Fixed flags the parser writes; a parsed profile may carry them back in unchanged. */
const TEMPORAL_PROFILE_FIXED_FIELDS = {
  baseIlluminationProfileRemainsAuthoritative: true, sensorReadoutTimingUsedAsExposureTiming: false,
  automaticExposurePolicyIncluded: false
} as const;

/**
 * Parses a time-varying illumination profile that sits on top of one existing
 * illumination profile.
 *
 * The base source magnitude and spectrum still apply. Each binding multiplies one
 * source by one relative waveform over time. Sources with no binding stay constant.
 */
export function parseSceneIlluminationTemporalProfile(
  value: unknown
): SceneIlluminationTemporalProfile {
  const record = requireRecord(
    value,
    "sceneIlluminationTemporalProfile", ["schemaVersion", "waveforms", "sourceBindings", "profileId", "sceneId", "illuminationProfileId", "evidence", ...Object.keys(TEMPORAL_PROFILE_FIXED_FIELDS)]
  );
  requireFixedFieldsWhenPresent(record, TEMPORAL_PROFILE_FIXED_FIELDS, "sceneIlluminationTemporalProfile");
  if (
    record.schemaVersion !==
    SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sceneIlluminationTemporalProfile.schemaVersion must be "' +
        SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (!Array.isArray(record.waveforms)) {
    throw new InvalidConfigurationError(
      "sceneIlluminationTemporalProfile.waveforms must be an array."
    );
  }
  if (
    !Array.isArray(record.sourceBindings)
  ) {
    throw new InvalidConfigurationError(
      "sceneIlluminationTemporalProfile.sourceBindings must be an array."
    );
  }

  const waveforms =
    record.waveforms.map(
      (entry, index) =>
        parseWaveform(
          entry,
          "sceneIlluminationTemporalProfile.waveforms[" +
            index +
            "]"
        )
    );
  const waveformIds =
    waveforms.map(
      (entry) => entry.waveformId
    );
  if (
    new Set(waveformIds).size !==
    waveformIds.length
  ) {
    throw new InvalidConfigurationError(
      "sceneIlluminationTemporalProfile.waveforms[].waveformId must not contain duplicates."
    );
  }

  const sourceBindings =
    record.sourceBindings.map(
      (entry, index) =>
        parseSourceBinding(
          entry,
          "sceneIlluminationTemporalProfile.sourceBindings[" +
            index +
            "]"
        )
    );
  const bindingIds =
    sourceBindings.map(
      (entry) => entry.bindingId
    );
  if (
    new Set(bindingIds).size !==
    bindingIds.length
  ) {
    throw new InvalidConfigurationError(
      "sceneIlluminationTemporalProfile.sourceBindings[].bindingId must not contain duplicates."
    );
  }
  const sourceIds =
    sourceBindings.map(
      (entry) => entry.sourceId
    );
  if (
    new Set(sourceIds).size !==
    sourceIds.length
  ) {
    throw new InvalidConfigurationError(
      "sceneIlluminationTemporalProfile supports at most one temporal binding per sourceId in schema 0.1.0."
    );
  }
  const waveformIdSet =
    new Set(waveformIds);
  for (const binding of sourceBindings) {
    if (
      !waveformIdSet.has(
        binding.waveformId
      )
    ) {
      throw new InvalidConfigurationError(
        "sceneIlluminationTemporalProfile source binding references an unknown waveformId."
      );
    }
  }

  return {
    schemaVersion:
      SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "sceneIlluminationTemporalProfile.profileId"
      ),
    sceneId:
      requireNonEmptyString(
        record.sceneId,
        "sceneIlluminationTemporalProfile.sceneId"
      ),
    illuminationProfileId:
      requireNonEmptyString(
        record.illuminationProfileId,
        "sceneIlluminationTemporalProfile.illuminationProfileId"
      ),
    evidence: parseEvidenceList(
      record.evidence,
      "sceneIlluminationTemporalProfile.evidence"
    ),
    waveforms,
    sourceBindings,
    baseIlluminationProfileRemainsAuthoritative:
      true,
    sensorReadoutTimingUsedAsExposureTiming:
      false,
    automaticExposurePolicyIncluded:
      false
  };
}

function requireProfileBindings(
  illuminationProfile:
    SceneIlluminationProfile,
  temporalProfile:
    SceneIlluminationTemporalProfile
): void {
  if (
    temporalProfile.sceneId !==
    illuminationProfile.sceneId
  ) {
    throw new InvalidScientificInputError(
      "Temporal illumination profile sceneId must match the illumination profile."
    );
  }
  if (
    temporalProfile
      .illuminationProfileId !==
    illuminationProfile.profileId
  ) {
    throw new InvalidScientificInputError(
      "Temporal illumination profile illuminationProfileId must match the supplied illumination profile."
    );
  }

  const knownSourceIds =
    new Set(
      illuminationProfile.sources.map(
        (entry) => entry.sourceId
      )
    );
  for (
    const binding of
    temporalProfile.sourceBindings
  ) {
    if (
      !knownSourceIds.has(
        binding.sourceId
      )
    ) {
      throw new InvalidScientificInputError(
        "Temporal illumination source binding references a sourceId that is not declared by the illumination profile."
      );
    }
  }
}

function resolveSourceAndTemporalBinding(
  illuminationProfile:
    SceneIlluminationProfile,
  temporalProfile:
    SceneIlluminationTemporalProfile,
  sourceId: string
): {
  source:
    SceneIlluminationProfile["sources"][number];
  binding:
    SceneIlluminationTemporalSourceBinding;
  waveform:
    SceneIlluminationTemporalWaveform;
} {
  requireProfileBindings(
    illuminationProfile,
    temporalProfile
  );

  const source =
    illuminationProfile.sources.find(
      (entry) =>
        entry.sourceId === sourceId
    );
  if (source === undefined) {
    throw new InvalidScientificInputError(
      "sourceId is not declared by the supplied illumination profile."
    );
  }

  const binding =
    temporalProfile.sourceBindings.find(
      (entry) =>
        entry.sourceId === sourceId
    );
  if (binding === undefined) {
    throw new InvalidScientificInputError(
      "Time-varying source evaluation requires an explicit source waveform-to-capture registration."
    );
  }

  const waveform =
    temporalProfile.waveforms.find(
      (entry) =>
        entry.waveformId ===
        binding.waveformId
    );
  if (waveform === undefined) {
    throw new InvalidScientificInputError(
      "Temporal source binding waveformId is not declared by the temporal profile."
    );
  }

  return {
    source,
    binding,
    waveform
  };
}

function interpolateWaveform(
  samples:
    readonly SceneIlluminationTemporalWaveformSample[],
  timeSeconds: number
): number {
  const first = samples[0]!;
  const last =
    samples[samples.length - 1]!;

  if (
    timeSeconds ===
    first.timeSecondsFromWaveformReference
  ) {
    return first
      .relativeMagnitudeMultiplier;
  }
  if (
    timeSeconds ===
    last.timeSecondsFromWaveformReference
  ) {
    return last
      .relativeMagnitudeMultiplier;
  }

  for (
    let index = 1;
    index < samples.length;
    index += 1
  ) {
    const right = samples[index]!;
    if (
      timeSeconds <
      right
        .timeSecondsFromWaveformReference
    ) {
      const left =
        samples[index - 1]!;
      const span =
        right
          .timeSecondsFromWaveformReference -
        left
          .timeSecondsFromWaveformReference;
      const phase =
        (timeSeconds -
          left
            .timeSecondsFromWaveformReference) /
        span;
      return (
        left
          .relativeMagnitudeMultiplier +
        phase *
          (right
            .relativeMagnitudeMultiplier -
            left
              .relativeMagnitudeMultiplier)
      );
    }
  }

  return last
    .relativeMagnitudeMultiplier;
}

function evaluateWaveform(
  waveform:
    SceneIlluminationTemporalWaveform,
  waveformTimeSeconds: number
): number {
  if (
    waveform.kind ===
    "aperiodic-relative-multiplier"
  ) {
    const last =
      waveform.samples[
        waveform.samples.length - 1
      ]!;
    if (
      waveformTimeSeconds < 0 ||
      waveformTimeSeconds >
        last
          .timeSecondsFromWaveformReference
    ) {
      return 0;
    }
    return interpolateWaveform(
      waveform.samples,
      waveformTimeSeconds
    );
  }

  const periodicTime =
    positiveModulo(
      waveformTimeSeconds,
      waveform.periodSeconds
    );
  return interpolateWaveform(
    waveform.samples,
    periodicTime
  );
}

/**
 * Returns one registered source's time-varying multiplier at one capture time.
 *
 * Capture time is in seconds from the first opening boundary of the exposure. Sensor
 * readout timing is never used in place of capture time.
 */
export function evaluateSceneIlluminationTemporalMultiplier(
  input:
    EvaluateSceneIlluminationTemporalMultiplierInput
): SceneIlluminationTemporalMultiplierEvaluation {
  requireInputKeys(input, "evaluateSceneIlluminationTemporalMultiplier", ["illuminationProfile", "temporalProfile", "sourceId", "captureTimeSecondsFromReference"]);
  if (
    typeof input.sourceId !== "string" ||
    input.sourceId.trim().length === 0
  ) {
    throw new InvalidConfigurationError(
      "sourceId must be a non-empty string."
    );
  }
  if (
    typeof input
      .captureTimeSecondsFromReference !==
      "number" ||
    !Number.isFinite(
      input
        .captureTimeSecondsFromReference
    )
  ) {
    throw new InvalidScientificInputError(
      "captureTimeSecondsFromReference must be finite."
    );
  }

  const {
    source,
    binding,
    waveform
  } =
    resolveSourceAndTemporalBinding(
      input.illuminationProfile,
      input.temporalProfile,
      input.sourceId
    );

  const waveformTimeSeconds =
    input
      .captureTimeSecondsFromReference -
    binding
      .waveformTimeZeroSecondsFromCaptureReference;
  const multiplier =
    evaluateWaveform(
      waveform,
      waveformTimeSeconds
    );

  return {
    sourceId: source.sourceId,
    sourceEnabled: source.enabled,
    temporalProfileId:
      input.temporalProfile.profileId,
    bindingId: binding.bindingId,
    waveformId: waveform.waveformId,
    captureTimeReference:
      "first-opening-boundary-phase",
    captureTimeSecondsFromReference:
      input
        .captureTimeSecondsFromReference,
    waveformTimeSecondsFromWaveformReference:
      waveformTimeSeconds,
    waveformKind: waveform.kind,
    relativeMagnitudeMultiplier:
      multiplier,
    effectiveRelativeMagnitudeMultiplier:
      source.enabled ? multiplier : 0,
    sourceMagnitudeApplied: false,
    materialTransportApplied: false,
    sceneRadianceCalculated: false,
    sensorReadoutTimingUsed: false,
    automaticExposureResolved: false
  };
}

/**
 * Integrates one source's time-varying multiplier over one local exposure window
 * (from sensor/exposure-window), using the deterministic midpoint rule.
 *
 * It integrates only the relative modulation over time. It does not apply source
 * magnitude, scene light transport, optics, sensor response or metering policy.
 */
export function integrateSceneIlluminationTemporalMultiplierOverExposureWindow(
  input:
    IntegrateSceneIlluminationTemporalMultiplierInput
): SceneIlluminationTemporalExposureIntegration {
  requireInputKeys(input, "integrateSceneIlluminationTemporalMultiplierOverExposureWindow", ["illuminationProfile", "temporalProfile", "sourceId", "exposureWindows", "sampleIndex", "temporalSampleCount"]);
  requirePositiveInteger(
    "temporalSampleCount",
    input.temporalSampleCount
  );
  if (
    !Number.isSafeInteger(
      input.sampleIndex
    ) ||
    input.sampleIndex < 0
  ) {
    throw new InvalidScientificInputError(
      "sampleIndex must be a non-negative safe integer."
    );
  }
  if (
    input.exposureWindows
      .timeReference !==
    "first-opening-boundary-phase"
  ) {
    throw new InvalidScientificInputError(
      "Exposure windows must use the first-opening-boundary-phase time reference."
    );
  }

  const window =
    input.exposureWindows.samples[
      input.sampleIndex
    ];
  if (window === undefined) {
    throw new InvalidScientificInputError(
      "sampleIndex is outside exposureWindows.samples."
    );
  }

  const context =
    resolveSourceAndTemporalBinding(
      input.illuminationProfile,
      input.temporalProfile,
      input.sourceId
    );
  const durationSeconds =
    window.localExposureDurationSeconds;
  const normalizedTimeWeight =
    1 / input.temporalSampleCount;
  const timeMeasureSeconds =
    durationSeconds /
    input.temporalSampleCount;

  let averageMultiplier = 0;
  let integratedMultiplierSeconds =
    0;
  let averageEffectiveMultiplier =
    0;
  let integratedEffectiveMultiplierSeconds =
    0;

  const nodes = Array.from(
    {
      length:
        input.temporalSampleCount
    },
    (_, temporalSampleIndex) => {
      const localExposurePhase =
        (temporalSampleIndex + 0.5) /
        input.temporalSampleCount;
      const captureTimeSeconds =
        window
          .startOffsetSecondsFromOpeningReference +
        localExposurePhase *
          durationSeconds;
      const evaluated =
        evaluateSceneIlluminationTemporalMultiplier(
          {
            illuminationProfile:
              input.illuminationProfile,
            temporalProfile:
              input.temporalProfile,
            sourceId: input.sourceId,
            captureTimeSecondsFromReference:
              captureTimeSeconds
          }
        );

      averageMultiplier +=
        evaluated
          .relativeMagnitudeMultiplier *
        normalizedTimeWeight;
      integratedMultiplierSeconds +=
        evaluated
          .relativeMagnitudeMultiplier *
        timeMeasureSeconds;
      averageEffectiveMultiplier +=
        evaluated
          .effectiveRelativeMagnitudeMultiplier *
        normalizedTimeWeight;
      integratedEffectiveMultiplierSeconds +=
        evaluated
          .effectiveRelativeMagnitudeMultiplier *
        timeMeasureSeconds;

      return {
        temporalSampleIndex,
        localExposurePhase,
        captureTimeSecondsFromReference:
          captureTimeSeconds,
        waveformTimeSecondsFromWaveformReference:
          evaluated
            .waveformTimeSecondsFromWaveformReference,
        relativeMagnitudeMultiplier:
          evaluated
            .relativeMagnitudeMultiplier,
        effectiveRelativeMagnitudeMultiplier:
          evaluated
            .effectiveRelativeMagnitudeMultiplier,
        normalizedTimeWeight,
        timeMeasureSeconds
      };
    }
  );

  return {
    sourceId: context.source.sourceId,
    sourceEnabled:
      context.source.enabled,
    temporalProfileId:
      input.temporalProfile.profileId,
    bindingId:
      context.binding.bindingId,
    waveformId:
      context.waveform.waveformId,
    timeReference:
      "first-opening-boundary-phase",
    localExposureWindow: {
      startSecondsFromCaptureReference:
        window
          .startOffsetSecondsFromOpeningReference,
      endSecondsFromCaptureReference:
        window
          .endOffsetSecondsFromOpeningReference,
      durationSeconds
    },
    quadratureScheme:
      "uniform-midpoint",
    temporalSampleCount:
      input.temporalSampleCount,
    nodes,
    averageRelativeMagnitudeMultiplier:
      averageMultiplier,
    integratedRelativeMagnitudeSeconds:
      integratedMultiplierSeconds,
    averageEffectiveRelativeMagnitudeMultiplier:
      averageEffectiveMultiplier,
    integratedEffectiveRelativeMagnitudeSeconds:
      integratedEffectiveMultiplierSeconds,
    sourceMagnitudeApplied: false,
    materialTransportApplied: false,
    sceneRadianceCalculated: false,
    sensorReadoutTimingUsed: false,
    automaticExposureResolved: false,
    convergenceErrorEstimated: false
  };
}
