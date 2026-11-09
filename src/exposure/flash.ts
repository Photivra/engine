// SPDX-License-Identifier: Apache-2.0

/**
 * Manual flash and flash sync.
 *
 * The parsers validate untrusted input and return the normalized typed contract. Unknown enum values,
 * missing required fields and incompatible scientific data are rejected.
 *
 * Manual flash is a relative light pulse added on top of the scene light, timed on the capture's
 * opening-reference clock.
 * - Ordinary front- or rear-curtain sync needs a real interval when the whole frame is open at once.
 * - High-speed sync (HSS; schema 0.2.0 sync profiles) is separate: a near-continuous burst that
 *   covers the travelling shutter slit (resolveHighSpeedFlashSync).
 * - TTL pre-flash power and guide-number relations are in flash-ttl.ts.
 * Source brightness, optical transport and sensor integration have their own contracts.
 * @see docs/USAGE.md for the equations, units, coordinate conventions, known blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type {
  ResolvedReleaseFrame
} from "../capture/release-sequence.js";
import {
  parseSceneIlluminationProfile,
  type SceneIlluminationProfile,
  type SceneIlluminationSource
} from "../schema/illumination.js";
import {
  parseSceneIlluminationTemporalProfile,
  type SceneIlluminationTemporalProfile,
  type SceneIlluminationTemporalWaveformSample
} from "../schema/illumination-temporal.js";
import type {
  ResolvedCaptureModeTiming
} from "../sensor/capture-mode-timing.js";
import { requireInputObject, requireInputKeys, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigFinite as requireFinite, parseConfigLimitations as parseLimitations, requireConfigFiniteAboveZero as requirePositiveFinite } from "../core/record-validation.js";

export const MANUAL_FLASH_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;
export const FLASH_SYNC_CAPABILITY_SCHEMA_VERSION =
  "0.1.0" as const;
/** Sync-capability schema that may declare high-speed sync (a fast pulse train that acts as continuous light). */
export const FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION =
  "0.2.0" as const;
/** Model identity of the pulsed quasi-continuous high-speed-sync burst. */
export const HIGH_SPEED_SYNC_MODEL = /* @__PURE__ */ Object.freeze({
  id: "flash-hss-quasi-continuous-burst",
  version: "1.0.0"
} as const);

export type ManualFlashSyncMode =
  | "front-curtain"
  | "rear-curtain";

export type RequestedFlashSyncMode =
  | ManualFlashSyncMode
  | "high-speed-sync";

export interface ManualFlashPulseProfile {
  waveformId: string;
  scientificStatus: "approximation";
  supportDurationSeconds: number;
  interpolation: "piecewise-linear";
  samples:
    readonly SceneIlluminationTemporalWaveformSample[];
  normalization:
    "relative-peak-one";
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface ManualFlashProfile {
  schemaVersion:
    typeof MANUAL_FLASH_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  sourceTemplate:
    Omit<
      SceneIlluminationSource,
      "enabled" |
      "temporalBehavior"
    >;
  pulse:
    ManualFlashPulseProfile;
  outputControl: {
    kind:
      "relative-linear-source-scale";
    scale: number;
    flashExposureCompensationStops:
      0;
  };
  ttlModeled: false;
  highSpeedSyncModeled: false;
  recycleBehaviorModeled: false;
  redEyePreflashModeled: false;
  modelingLightModeled: false;
  afAssistModeled: false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface FlashSyncCapabilityProfile {
  schemaVersion:
    | typeof FLASH_SYNC_CAPABILITY_SCHEMA_VERSION
    | typeof FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  captureModeId: string;
  timingProfileId: string;
  supportedOrdinarySyncModes:
    readonly ManualFlashSyncMode[];
  /** Schema 0.1.0 is always false; schema 0.2.0 may declare HSS with {@link highSpeedSync}. */
  highSpeedSyncSupported: boolean;
  /** Present exactly when highSpeedSyncSupported is true (schema 0.2.0). */
  highSpeedSync?: {
    /**
     * η: energy of one full-power high-speed-sync burst, as a fraction of one full-power ordinary
     * pulse, in (0, 1]. The caller declares it from evidence (capacitor and thermal limits). It is
     * never inferred.
     */
    burstEnergyFractionOfFullPulse: number;
    evidence: readonly EvidenceProvenance[];
  };
  ordinarySyncRequiresWholeActiveFrameSimultaneouslyExposed:
    true;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface ResolveManualFlashSyncInput {
  flashEnabled: boolean;
  flashProfile:
    ManualFlashProfile;
  syncCapabilities:
    FlashSyncCapabilityProfile;
  timing:
    ResolvedCaptureModeTiming;
  syncMode:
    RequestedFlashSyncMode;
  releaseFrame?:
    ResolvedReleaseFrame;
}

export interface ResolvedManualFlashSync {
  flashEnabled: boolean;
  flashProfileId: string;
  flashProfileVersion: string;
  sourceId: string;
  captureModeId: string;
  timingProfileId: string;
  syncCapabilityProfileId:
    string;
  syncMode:
    RequestedFlashSyncMode;
  syncStatus:
    | "disabled"
    | "ordinary-sync-resolved";
  timeReference:
    "first-opening-boundary-phase";
  wholeActiveFrameOpenInterval:
    {
      startSecondsFromCaptureReference:
        number;
      endSecondsFromCaptureReference:
        number;
      durationSeconds: number;
    };
  pulseSupportDurationSeconds:
    number;
  pulseStartSecondsFromCaptureReference:
    number | null;
  pulseEndSecondsFromCaptureReference:
    number | null;
  waveformTimeZeroSecondsFromCaptureReference:
    number | null;
  releaseFrameBinding:
    | {
        sequenceId: string;
        releaseFrameId: string;
        frameIndex: number;
        sceneTimeSecondsFromSequenceStartAtPulseStart:
          number;
        sceneTimeSecondsFromSequenceStartAtPulseEnd:
          number;
      }
    | null;
  hssModeled: false;
  ttlModeled: false;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
  whiteBalanceModified: false;
  focusModified: false;
  exposureSettingsModified: false;
  driveModeModified: false;
  supportStateModified: false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

/** Fields of a resolved sync (ordinary or HSS) needed to register a flash overlay. */
export type FlashOverlaySyncRegistration = Pick<
  ResolvedManualFlashSync,
  | "flashEnabled"
  | "flashProfileId"
  | "flashProfileVersion"
  | "sourceId"
  | "waveformTimeZeroSecondsFromCaptureReference"
  | "evidence"
>;

export interface CreateManualFlashIlluminationOverlayInput {
  baseIlluminationProfile:
    SceneIlluminationProfile;
  baseTemporalProfile?:
    SceneIlluminationTemporalProfile;
  flashProfile:
    ManualFlashProfile;
  resolvedSync:
    FlashOverlaySyncRegistration;
  illuminationProfileId: string;
  temporalProfileId: string;
}

export interface ManualFlashIlluminationOverlay {
  flashApplied: boolean;
  illuminationProfile:
    SceneIlluminationProfile;
  temporalProfile:
    SceneIlluminationTemporalProfile | null;
  sourceId: string;
  waveformId: string;
  timeReference:
    "first-opening-boundary-phase";
  sourceMagnitudeAppliedBySceneTransport:
    true;
  materialTransportOwnedBySceneRadiance:
    true;
  visibilityOwnedBySceneRadiance:
    true;
  indirectTransportOwnedBySceneRadiance:
    true;
  postRenderBrightnessMultiplierUsed:
    false;
  whiteBalanceModified: false;
  ambientMeteringModified: false;
  ttlMeteringIncluded: false;
  ambientTemporalBehaviorPreserved:
    true;
}

const ORDINARY_SYNC_MODES =
  new Set<ManualFlashSyncMode>([
    "front-curtain",
    "rear-curtain"
  ]);

function parsePulseSamples(
  value: unknown,
  supportDurationSeconds:
    number,
  path: string
): readonly SceneIlluminationTemporalWaveformSample[] {
  if (
    !Array.isArray(value) ||
    value.length < 2
  ) {
    throw new InvalidConfigurationError(
      path +
        " must contain at least two waveform samples."
    );
  }
  const samples =
    value.map((entry, index) => {
      const samplePath =
        path +
        "[" +
        index +
        "]";
      const record =
        requireRecord(
          entry,
          samplePath, ["timeSecondsFromWaveformReference", "relativeMagnitudeMultiplier"]
        );
      const time =
        requireFinite(
          record
            .timeSecondsFromWaveformReference,
          samplePath +
            ".timeSecondsFromWaveformReference"
        );
      const magnitude =
        requireFinite(
          record
            .relativeMagnitudeMultiplier,
          samplePath +
            ".relativeMagnitudeMultiplier"
        );
      if (
        time < 0 ||
        time >
          supportDurationSeconds
      ) {
        throw new InvalidConfigurationError(
          samplePath +
            ".timeSecondsFromWaveformReference must lie within the declared pulse support."
        );
      }
      if (magnitude < 0) {
        throw new InvalidConfigurationError(
          samplePath +
            ".relativeMagnitudeMultiplier must be nonnegative."
        );
      }
      return {
        timeSecondsFromWaveformReference:
          time,
        relativeMagnitudeMultiplier:
          magnitude
      };
    });

  for (
    let index = 1;
    index < samples.length;
    index += 1
  ) {
    if (
      !(
        samples[index]!
          .timeSecondsFromWaveformReference >
        samples[index - 1]!
          .timeSecondsFromWaveformReference
      )
    ) {
      throw new InvalidConfigurationError(
        path +
          " times must be strictly increasing."
      );
    }
  }
  if (
    samples[0]!
      .timeSecondsFromWaveformReference !==
      0 ||
    samples[
      samples.length - 1
    ]!
      .timeSecondsFromWaveformReference !==
      supportDurationSeconds
  ) {
    throw new InvalidConfigurationError(
      path +
        " must start at waveform time 0 and end exactly at supportDurationSeconds."
    );
  }
  const peak =
    Math.max(
      ...samples.map(
        (sample) =>
          sample
            .relativeMagnitudeMultiplier
      )
    );
  if (
    Math.abs(peak - 1) >
    1e-12
  ) {
    throw new InvalidConfigurationError(
      path +
        " peak relative magnitude must equal one for relative-peak-one normalization."
    );
  }

  return samples;
}

function validateSourceTemplate(
  sourceTemplate:
    ManualFlashProfile["sourceTemplate"]
): ManualFlashProfile["sourceTemplate"] {
  requireInputObject(sourceTemplate, "manualFlashProfile.sourceTemplate");
  const probe =
    parseSceneIlluminationProfile({
      schemaVersion: "0.1.0",
      profileId:
        "manual-flash-source-validation",
      sceneId:
        "manual-flash-source-validation",
      evidence:
        sourceTemplate.evidence,
      sources: [{
        ...sourceTemplate,
        enabled: true,
        temporalBehavior: {
          kind:
            "time-invariant"
        }
      }],
      sceneRadianceCalculated:
        false,
      materialResponseApplied:
        false,
      visibilityEvaluated:
        false,
      indirectTransportEvaluated:
        false,
      fluorescenceModeled:
        false,
      volumetricTransportModeled:
        false,
      polarizationModeled:
        false
    });
  const source =
    probe.sources[0];
  if (source === undefined) {
    throw new InvalidConfigurationError(
      "manualFlashProfile.sourceTemplate must produce one valid illumination source."
    );
  }
  return {
    sourceId:
      source.sourceId,
    family:
      source.family,
    geometry:
      source.geometry,
    magnitude:
      source.magnitude,
    spectrum:
      source.spectrum,
    evidence:
      source.evidence,
    ...(source.limitations ===
    undefined
      ? {}
      : {
          limitations:
            source.limitations
        })
  };
}

/**
 * Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
 * missing required fields and incompatible scientific data are rejected here.
 *
 * Manual flash is a relative light pulse added on top of the scene light, timed on the capture's
 * opening-reference clock. Ordinary front- or rear-curtain sync needs a real interval when the whole
 * frame is open at once. High-speed sync (HSS), TTL and flash metering are not handled here. Source
 * brightness, optical transport and sensor integration have their own contracts.
 * @param value - unknown. Untrusted input; TypeScript types alone are not validation.
 * @returns ManualFlashProfile. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function parseManualFlashProfile(
  value: unknown
): ManualFlashProfile {
  const record =
    requireRecord(
      value,
      "manualFlashProfile", ["schemaVersion", "pulse", "outputControl", "profileId", "profileVersion", "sourceTemplate", "evidence", "limitations", "ttlModeled", "highSpeedSyncModeled", "recycleBehaviorModeled", "redEyePreflashModeled", "modelingLightModeled", "afAssistModeled"]
    );
  if (
    record.schemaVersion !==
    MANUAL_FLASH_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'manualFlashProfile.schemaVersion must be "' +
        MANUAL_FLASH_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  for (
    const [key, expected] of [
      ["ttlModeled", false],
      ["highSpeedSyncModeled", false],
      ["recycleBehaviorModeled", false],
      ["redEyePreflashModeled", false],
      ["modelingLightModeled", false],
      ["afAssistModeled", false]
    ] as const
  ) {
    if (record[key] !== expected) {
      throw new InvalidConfigurationError(
        "manualFlashProfile." +
          key +
          " must be false in schema 0.1.0."
      );
    }
  }

  const pulse =
    requireRecord(
      record.pulse,
      "manualFlashProfile.pulse", ["supportDurationSeconds", "scientificStatus", "interpolation", "normalization", "waveformId", "samples", "evidence", "limitations"]
    );
  const supportDurationSeconds =
    requirePositiveFinite(
      pulse.supportDurationSeconds,
      "manualFlashProfile.pulse.supportDurationSeconds"
    );
  if (
    pulse.scientificStatus !==
      "approximation" ||
    pulse.interpolation !==
      "piecewise-linear" ||
    pulse.normalization !==
      "relative-peak-one"
  ) {
    throw new InvalidConfigurationError(
      "manualFlashProfile.pulse scientificStatus/interpolation/normalization is invalid."
    );
  }

  const output =
    requireRecord(
      record.outputControl,
      "manualFlashProfile.outputControl", ["kind", "flashExposureCompensationStops", "scale"]
    );
  if (
    output.kind !==
      "relative-linear-source-scale" ||
    output
      .flashExposureCompensationStops !==
      0
  ) {
    throw new InvalidConfigurationError(
      "manualFlashProfile.outputControl must use relative-linear-source-scale with zero flash exposure compensation in the manual-only schema."
    );
  }

  return {
    schemaVersion:
      MANUAL_FLASH_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "manualFlashProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "manualFlashProfile.profileVersion"
      ),
    sourceTemplate:
      validateSourceTemplate(
        record.sourceTemplate as
          ManualFlashProfile["sourceTemplate"]
      ),
    pulse: {
      waveformId:
        requireNonEmptyString(
          pulse.waveformId,
          "manualFlashProfile.pulse.waveformId"
        ),
      scientificStatus:
        "approximation",
      supportDurationSeconds,
      interpolation:
        "piecewise-linear",
      samples:
        parsePulseSamples(
          pulse.samples,
          supportDurationSeconds,
          "manualFlashProfile.pulse.samples"
        ),
      normalization:
        "relative-peak-one",
      evidence:
        parseEvidenceList(
          pulse.evidence,
          "manualFlashProfile.pulse.evidence"
        ),
      limitations:
        parseLimitations(
          pulse.limitations,
          "manualFlashProfile.pulse.limitations"
        )
    },
    outputControl: {
      kind:
        "relative-linear-source-scale",
      scale:
        requirePositiveFinite(
          output.scale,
          "manualFlashProfile.outputControl.scale"
        ),
      flashExposureCompensationStops:
        0
    },
    ttlModeled: false,
    highSpeedSyncModeled: false,
    recycleBehaviorModeled:
      false,
    redEyePreflashModeled:
      false,
    modelingLightModeled:
      false,
    afAssistModeled: false,
    evidence:
      parseEvidenceList(
        record.evidence,
        "manualFlashProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "manualFlashProfile.limitations"
      )
  };
}

/**
 * Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
 * missing required fields and incompatible scientific data are rejected here.
 *
 * Manual flash is a relative light pulse added on top of the scene light, timed on the capture's
 * opening-reference clock. Ordinary front- or rear-curtain sync needs a real interval when the whole
 * frame is open at once. High-speed sync (HSS), TTL and flash metering are not handled here. Source
 * brightness, optical transport and sensor integration have their own contracts.
 * @param value - unknown. Untrusted input; TypeScript types alone are not validation.
 * @returns FlashSyncCapabilityProfile. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function parseFlashSyncCapabilityProfile(
  value: unknown
): FlashSyncCapabilityProfile {
  const record =
    requireRecord(
      value,
      "flashSyncCapabilityProfile", ["schemaVersion", "highSpeedSyncSupported", "ordinarySyncRequiresWholeActiveFrameSimultaneouslyExposed", "highSpeedSync", "supportedOrdinarySyncModes", "profileId", "profileVersion", "captureModeId", "timingProfileId", "evidence", "limitations"]
    );
  if (
    record.schemaVersion !==
      FLASH_SYNC_CAPABILITY_SCHEMA_VERSION &&
    record.schemaVersion !==
      FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'flashSyncCapabilityProfile.schemaVersion must be "' +
        FLASH_SYNC_CAPABILITY_SCHEMA_VERSION +
        '" or "' +
        FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION +
        '".'
    );
  }
  const hssSchema =
    record.schemaVersion ===
    FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION;
  if (
    (hssSchema
      ? typeof record.highSpeedSyncSupported !==
        "boolean"
      : record.highSpeedSyncSupported !==
        false) ||
    record
      .ordinarySyncRequiresWholeActiveFrameSimultaneouslyExposed !==
      true
  ) {
    throw new InvalidConfigurationError(
      "flashSyncCapabilityProfile schema 0.1.0 supports ordinary whole-frame sync only and must not claim HSS."
    );
  }
  let highSpeedSync:
    FlashSyncCapabilityProfile["highSpeedSync"];
  if (record.highSpeedSyncSupported === true) {
    const hss = requireRecord(
      record.highSpeedSync,
      "flashSyncCapabilityProfile.highSpeedSync", ["burstEnergyFractionOfFullPulse", "evidence"]
    );
    const fraction = requirePositiveFinite(
      hss.burstEnergyFractionOfFullPulse,
      "flashSyncCapabilityProfile.highSpeedSync.burstEnergyFractionOfFullPulse"
    );
    if (fraction > 1) {
      throw new InvalidConfigurationError(
        "flashSyncCapabilityProfile.highSpeedSync.burstEnergyFractionOfFullPulse must be at most 1."
      );
    }
    highSpeedSync = {
      burstEnergyFractionOfFullPulse:
        fraction,
      evidence: parseEvidenceList(
        hss.evidence,
        "flashSyncCapabilityProfile.highSpeedSync.evidence"
      )
    };
  } else if (
    record.highSpeedSync !==
    undefined
  ) {
    throw new InvalidConfigurationError(
      "flashSyncCapabilityProfile.highSpeedSync must be omitted when HSS is unsupported."
    );
  }
  if (
    !Array.isArray(
      record.supportedOrdinarySyncModes
    ) ||
    record
      .supportedOrdinarySyncModes
      .length === 0
  ) {
    throw new InvalidConfigurationError(
      "flashSyncCapabilityProfile.supportedOrdinarySyncModes must be a non-empty array."
    );
  }
  const modes =
    record
      .supportedOrdinarySyncModes
      .map((entry, index) => {
        if (
          typeof entry !==
            "string" ||
          !ORDINARY_SYNC_MODES.has(
            entry as ManualFlashSyncMode
          )
        ) {
          throw new InvalidConfigurationError(
            "flashSyncCapabilityProfile.supportedOrdinarySyncModes[" +
              index +
              "] is invalid."
          );
        }
        return entry as
          ManualFlashSyncMode;
      });
  if (
    new Set(modes).size !==
    modes.length
  ) {
    throw new InvalidConfigurationError(
      "flashSyncCapabilityProfile.supportedOrdinarySyncModes must not contain duplicates."
    );
  }

  return {
    schemaVersion: hssSchema
      ? FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION
      : FLASH_SYNC_CAPABILITY_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "flashSyncCapabilityProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "flashSyncCapabilityProfile.profileVersion"
      ),
    captureModeId:
      requireNonEmptyString(
        record.captureModeId,
        "flashSyncCapabilityProfile.captureModeId"
      ),
    timingProfileId:
      requireNonEmptyString(
        record.timingProfileId,
        "flashSyncCapabilityProfile.timingProfileId"
      ),
    supportedOrdinarySyncModes:
      modes,
    highSpeedSyncSupported:
      highSpeedSync !== undefined,
    ...(highSpeedSync === undefined
      ? {}
      : { highSpeedSync }),
    ordinarySyncRequiresWholeActiveFrameSimultaneouslyExposed:
      true,
    evidence:
      parseEvidenceList(
        record.evidence,
        "flashSyncCapabilityProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "flashSyncCapabilityProfile.limitations"
      )
  };
}

/**
 * Shape guard for the resolved capture-mode timing record read by the flash sync functions: every
 * nested object read below must be an object, so a malformed record fails with
 * InvalidConfigurationError instead of a raw TypeError. Values are checked where they are used.
 */
function requireTimingRecordShape(timing: unknown, path: string): void {
  requireInputObject(timing, path);
  const record = timing as Record<string, unknown>;
  if (!Array.isArray(record.evidence)) throw new InvalidConfigurationError(path + ".evidence must be an array.");
  requireInputObject(record.exposureWindows, path + ".exposureWindows");
  const windows = record.exposureWindows as Record<string, unknown>;
  requireInputObject(windows.nominalExposureDurationSeconds, path + ".exposureWindows.nominalExposureDurationSeconds");
  requireInputObject(windows.localExposureDurationRangeSeconds, path + ".exposureWindows.localExposureDurationRangeSeconds");
  for (const boundary of ["opening", "closing"] as const) {
    requireInputObject(windows[boundary], path + ".exposureWindows." + boundary);
    const schedule = (windows[boundary] as Record<string, unknown>).schedule;
    requireInputObject(schedule, path + ".exposureWindows." + boundary + ".schedule");
    if ((schedule as Record<string, unknown>).kind !== "simultaneous") {
      requireInputObject((schedule as Record<string, unknown>).traversalDurationSeconds, path + ".exposureWindows." + boundary + ".schedule.traversalDurationSeconds");
    }
  }
}

function wholeFrameOpenInterval(
  timing:
    ResolvedCaptureModeTiming
): {
  startSecondsFromCaptureReference:
    number;
  endSecondsFromCaptureReference:
    number;
  durationSeconds: number;
} {
  const opening =
    timing.exposureWindows.opening
      .schedule;
  const latestOpening =
    opening.kind ===
    "simultaneous"
      ? 0
      : opening
          .traversalDurationSeconds
          .value;
  const earliestClosing =
    timing.exposureWindows
      .nominalExposureDurationSeconds
      .value;
  const duration =
    earliestClosing -
    latestOpening;
  return {
    startSecondsFromCaptureReference:
      latestOpening,
    endSecondsFromCaptureReference:
      earliestClosing,
    durationSeconds:
      Math.max(0, duration)
  };
}

function validateReleaseBinding(
  release:
    ResolvedReleaseFrame,
  timing:
    ResolvedCaptureModeTiming
): void {
  requireInputObject(release, "releaseFrame");
  requireInputObject(release.exposure, "releaseFrame.exposure");
  const nominal =
    timing.exposureWindows
      .nominalExposureDurationSeconds
      .value;
  const scale =
    Math.max(
      1,
      Math.abs(nominal),
      Math.abs(
        release.exposure
          .shutterSeconds
      )
    );
  if (
    Math.abs(
      release.exposure
        .shutterSeconds -
      nominal
    ) >
    Number.EPSILON *
      16 *
      scale
  ) {
    throw new InvalidScientificInputError(
      "releaseFrame shutter duration must match the exposure duration of the capture-mode exposure-window timing."
    );
  }
}

/**
 * Places a declared ordinary flash pulse inside the actual interval when the whole frame is open, for
 * front- or rear-curtain sync. Otherwise returns a structured incompatibility.
 *
 * Manual flash is a relative light pulse added on top of the scene light, timed on the capture's
 * opening-reference clock. Ordinary front- or rear-curtain sync needs a real interval when the whole
 * frame is open at once. High-speed sync (HSS), TTL and flash metering are not handled here. Source
 * brightness, optical transport and sensor integration have their own contracts.
 * @param input - ResolveManualFlashSyncInput. See that type for coordinates, units and profile binding.
 * @returns ResolvedManualFlashSync. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function resolveManualFlashSync(
  input:
    ResolveManualFlashSyncInput
): ResolvedManualFlashSync {
  requireInputKeys(input, "resolveManualFlashSync", ["flashEnabled", "flashProfile", "syncCapabilities", "timing", "syncMode", "releaseFrame"]);
  requireTimingRecordShape(input.timing, "resolveManualFlashSync timing");
  const flash =
    parseManualFlashProfile(
      input.flashProfile
    );
  const capabilities =
    parseFlashSyncCapabilityProfile(
      input.syncCapabilities
    );

  if (
    capabilities.captureModeId !==
      input.timing.captureModeId ||
    capabilities.timingProfileId !==
      input.timing.timingProfileId
  ) {
    throw new InvalidScientificInputError(
      "Flash sync capability profile must exactly match the resolved capture-mode and timing-profile identities."
    );
  }
  if (
    input.releaseFrame !==
    undefined
  ) {
    validateReleaseBinding(
      input.releaseFrame,
      input.timing
    );
  }

  const openInterval =
    wholeFrameOpenInterval(
      input.timing
    );
  const base = {
    flashProfileId:
      flash.profileId,
    flashProfileVersion:
      flash.profileVersion,
    sourceId:
      flash.sourceTemplate.sourceId,
    captureModeId:
      input.timing.captureModeId,
    timingProfileId:
      input.timing.timingProfileId,
    syncCapabilityProfileId:
      capabilities.profileId,
    syncMode:
      input.syncMode,
    timeReference:
      "first-opening-boundary-phase" as const,
    wholeActiveFrameOpenInterval:
      openInterval,
    pulseSupportDurationSeconds:
      flash.pulse
        .supportDurationSeconds,
    hssModeled: false as const,
    ttlModeled: false as const,
    sensorReadoutTimingUsedAsExposureTiming:
      false as const,
    whiteBalanceModified:
      false as const,
    focusModified: false as const,
    exposureSettingsModified:
      false as const,
    driveModeModified:
      false as const,
    supportStateModified:
      false as const,
    evidence: [
      ...flash.evidence,
      ...capabilities.evidence,
      ...input.timing.evidence
    ],
    limitations: [
      ...flash.limitations,
      ...capabilities.limitations,
      "Ordinary flash synchronization is registered to exposure-boundary timing, never sensor data-readout timing.",
      "Schema 0.1.0 does not model HSS, TTL/preflash metering, recycle/thermal limits, red-eye preflash, modeling lights, AF-assist or branded flash protocols."
    ]
  };

  if (!input.flashEnabled) {
    return {
      flashEnabled: false,
      ...base,
      syncStatus:
        "disabled",
      pulseStartSecondsFromCaptureReference:
        null,
      pulseEndSecondsFromCaptureReference:
        null,
      waveformTimeZeroSecondsFromCaptureReference:
        null,
      releaseFrameBinding:
        null
    };
  }

  if (
    input.syncMode ===
    "high-speed-sync"
  ) {
    throw new InvalidScientificInputError(
      "High-speed sync is not an ordinary sync mode; ordinary single-pulse flash cannot be used as an HSS substitute. Use resolveHighSpeedFlashSync with an HSS-capable sync profile."
    );
  }
  if (
    !capabilities
      .supportedOrdinarySyncModes
      .includes(
        input.syncMode
      )
  ) {
    throw new InvalidScientificInputError(
      "Requested ordinary flash sync mode is not supported by the capability profile."
    );
  }
  if (
    openInterval.durationSeconds <=
      0
  ) {
    throw new InvalidScientificInputError(
      "Ordinary one-pulse flash cannot uniformly expose the active frame because the exposure-window timing has no whole-frame-open interval."
    );
  }
  if (
    flash.pulse
      .supportDurationSeconds >
    openInterval.durationSeconds
  ) {
    throw new InvalidScientificInputError(
      "Ordinary flash pulse support does not fit inside the whole-active-frame-open interval."
    );
  }

  const pulseStart =
    input.syncMode ===
    "front-curtain"
      ? openInterval
          .startSecondsFromCaptureReference
      : openInterval
          .endSecondsFromCaptureReference -
        flash.pulse
          .supportDurationSeconds;
  const pulseEnd =
    pulseStart +
    flash.pulse
      .supportDurationSeconds;

  const releaseBinding =
    input.releaseFrame ===
    undefined
      ? null
      : {
          sequenceId:
            input.releaseFrame
              .sequenceId,
          releaseFrameId:
            input.releaseFrame
              .releaseFrameId,
          frameIndex:
            input.releaseFrame
              .frameIndex,
          sceneTimeSecondsFromSequenceStartAtPulseStart:
            input.releaseFrame
              .sceneTimeSecondsFromSequenceStart +
            pulseStart,
          sceneTimeSecondsFromSequenceStartAtPulseEnd:
            input.releaseFrame
              .sceneTimeSecondsFromSequenceStart +
            pulseEnd
        };

  return {
    flashEnabled: true,
    ...base,
    syncStatus:
      "ordinary-sync-resolved",
    pulseStartSecondsFromCaptureReference:
      pulseStart,
    pulseEndSecondsFromCaptureReference:
      pulseEnd,
    waveformTimeZeroSecondsFromCaptureReference:
      pulseStart,
    releaseFrameBinding:
      releaseBinding
  };
}

function scaledFlashSource(
  flash:
    ManualFlashProfile
): SceneIlluminationSource {
  const template =
    flash.sourceTemplate;
  const magnitude =
    template.magnitude;
  if (
    magnitude.kind !==
    "relative-linear-scale"
  ) {
    throw new InvalidScientificInputError(
      "Manual flash schema 0.1.0 relative output control requires a relative-linear-scale illumination source magnitude; calibrated physical flash energy belongs to a later profile."
    );
  }

  return {
    ...template,
    magnitude: {
      ...magnitude,
      scale:
        magnitude.scale *
        flash.outputControl.scale
    },
    enabled: true,
    temporalBehavior: {
      kind:
        "time-invariant"
    }
  };
}

/**
 * Builds a temporal illumination overlay from the resolved manual pulse. The identity of the base
 * ambient light source is kept.
 *
 * Manual flash is a relative light pulse added on top of the scene light, timed on the capture's
 * opening-reference clock. Ordinary front- or rear-curtain sync needs a real interval when the whole
 * frame is open at once. High-speed sync (HSS), TTL and flash metering are not handled here. Source
 * brightness, optical transport and sensor integration have their own contracts.
 * @param input - CreateManualFlashIlluminationOverlayInput. See that type for coordinates, units and profile binding.
 * @returns ManualFlashIlluminationOverlay. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function createManualFlashIlluminationOverlay(
  input:
    CreateManualFlashIlluminationOverlayInput
): ManualFlashIlluminationOverlay {
  requireInputKeys(input, "createManualFlashIlluminationOverlay", ["baseIlluminationProfile", "baseTemporalProfile", "flashProfile", "resolvedSync", "illuminationProfileId", "temporalProfileId"]);
  const base =
    parseSceneIlluminationProfile(
      input
        .baseIlluminationProfile
    );
  const baseTemporal =
    input.baseTemporalProfile ===
    undefined
      ? null
      : parseSceneIlluminationTemporalProfile(
          input.baseTemporalProfile
        );
  if (
    baseTemporal !== null &&
    (
      baseTemporal.sceneId !==
        base.sceneId ||
      baseTemporal
        .illuminationProfileId !==
        base.profileId
    )
  ) {
    throw new InvalidScientificInputError(
      "baseTemporalProfile must exactly match the base illumination profile scene/profile identities."
    );
  }

  const flash =
    parseManualFlashProfile(
      input.flashProfile
    );
  const sync =
    input.resolvedSync;
  requireInputObject(sync, "createManualFlashIlluminationOverlay resolvedSync");
  if (!Array.isArray(sync.evidence)) throw new InvalidConfigurationError("createManualFlashIlluminationOverlay resolvedSync.evidence must be an array.");

  if (
    sync.flashProfileId !==
      flash.profileId ||
    sync.flashProfileVersion !==
      flash.profileVersion ||
    sync.sourceId !==
      flash.sourceTemplate.sourceId
  ) {
    throw new InvalidScientificInputError(
      "Resolved flash sync identity must match the manual flash profile."
    );
  }
  if (
    base.sources.some(
      (source) =>
        source.sourceId ===
        flash.sourceTemplate
          .sourceId
    )
  ) {
    throw new InvalidScientificInputError(
      "Flash sourceId must be unique within the base illumination profile."
    );
  }

  if (!sync.flashEnabled) {
    return {
      flashApplied: false,
      illuminationProfile:
        base,
      temporalProfile:
        baseTemporal,
      sourceId:
        flash.sourceTemplate
          .sourceId,
      waveformId:
        flash.pulse.waveformId,
      timeReference:
        "first-opening-boundary-phase",
      sourceMagnitudeAppliedBySceneTransport:
        true,
      materialTransportOwnedBySceneRadiance:
        true,
      visibilityOwnedBySceneRadiance:
        true,
      indirectTransportOwnedBySceneRadiance:
        true,
      postRenderBrightnessMultiplierUsed:
        false,
      whiteBalanceModified:
        false,
      ambientMeteringModified:
        false,
      ambientTemporalBehaviorPreserved:
        true,
      ttlMeteringIncluded:
        false
    };
  }
  if (
    sync
      .waveformTimeZeroSecondsFromCaptureReference ===
      null
  ) {
    throw new InvalidScientificInputError(
      "Enabled flash sync must provide an authoritative waveform time-zero registration."
    );
  }

  const flashSource =
    scaledFlashSource(
      flash
    );
  const illumination =
    parseSceneIlluminationProfile({
      ...base,
      profileId:
        requireNonEmptyString(
          input.illuminationProfileId,
          "illuminationProfileId"
        ),
      sources: [
        ...base.sources,
        flashSource
      ]
    });

  const temporal =
    parseSceneIlluminationTemporalProfile({
      schemaVersion: "0.1.0",
      profileId:
        requireNonEmptyString(
          input.temporalProfileId,
          "temporalProfileId"
        ),
      sceneId:
        illumination.sceneId,
      illuminationProfileId:
        illumination.profileId,
      evidence: [
        ...(baseTemporal?.evidence ?? []),
        ...flash.evidence,
        ...sync.evidence
      ],
      waveforms: [
        ...(baseTemporal?.waveforms ?? []),
        {
        waveformId:
          flash.pulse.waveformId,
        kind:
          "aperiodic-relative-multiplier",
        timeUnit: "s",
        scientificStatus:
          "approximation",
        uncertainty: {
          kind:
            "not-quantified",
          limitation:
            "Manual flash pulse timing/shape is an explicit approximation."
        },
        evidence:
          flash.pulse.evidence,
        interpolation:
          "piecewise-linear",
        samples:
          flash.pulse.samples,
        outsideSupportBehavior:
          "zero"
        }
      ],
      sourceBindings: [
        ...(baseTemporal?.sourceBindings ?? []),
        {
        bindingId:
          flash.profileId +
          ":sync",
        sourceId:
          flashSource.sourceId,
        waveformId:
          flash.pulse.waveformId,
        captureTimeReference:
          "first-opening-boundary-phase",
        waveformTimeZeroSecondsFromCaptureReference:
          sync
            .waveformTimeZeroSecondsFromCaptureReference,
        scientificStatus:
          "approximation",
        timingUncertainty: {
          kind:
            "not-quantified",
          limitation:
            "Schema 0.1.0 uses ideal deterministic flash trigger registration within the declared exposure-window schedule."
        },
        evidence:
          sync.evidence
        }
      ],
      baseIlluminationProfileRemainsAuthoritative:
        true,
      sensorReadoutTimingUsedAsExposureTiming:
        false,
      automaticExposurePolicyIncluded:
        false
    });

  return {
    flashApplied: true,
    illuminationProfile:
      illumination,
    temporalProfile:
      temporal,
    sourceId:
      flashSource.sourceId,
    waveformId:
      flash.pulse.waveformId,
    timeReference:
      "first-opening-boundary-phase",
    sourceMagnitudeAppliedBySceneTransport:
      true,
    materialTransportOwnedBySceneRadiance:
      true,
    visibilityOwnedBySceneRadiance:
      true,
    indirectTransportOwnedBySceneRadiance:
      true,
    postRenderBrightnessMultiplierUsed:
      false,
    whiteBalanceModified:
      false,
    ambientMeteringModified:
      false,
    ambientTemporalBehaviorPreserved:
        true,
      ttlMeteringIncluded:
      false
  };
}

export interface ResolveHighSpeedFlashSyncInput {
  flashEnabled: boolean;
  /** Ordinary full-power pulse definition; its integral defines the full-power pulse energy. */
  flashProfile: ManualFlashProfile;
  /** Schema 0.2.0 profile with highSpeedSyncSupported true. */
  syncCapabilities: FlashSyncCapabilityProfile;
  timing: ResolvedCaptureModeTiming;
  /** Commanded output as a fraction of full power, (0, 1]. */
  powerFraction: number;
  releaseFrame?: ResolvedReleaseFrame;
}

export interface ResolvedHighSpeedFlashSync extends FlashOverlaySyncRegistration {
  modelId: typeof HIGH_SPEED_SYNC_MODEL.id;
  modelVersion: typeof HIGH_SPEED_SYNC_MODEL.version;
  syncMode: "high-speed-sync";
  syncStatus: "disabled" | "high-speed-sync-resolved";
  captureModeId: string;
  timingProfileId: string;
  syncCapabilityProfileId: string;
  timeReference: "first-opening-boundary-phase";
  powerFraction: number;
  /** η from the sync capability profile. */
  burstEnergyFractionOfFullPulse: number;
  /** ∫ pulse(t) dt of the declared ordinary pulse, whose relative peak is 1 (relative multiplier · s). */
  singlePulseIntegratedRelativeSeconds: number;
  /** D: burst support covering the first line opening to the last line closing. */
  burstStartSecondsFromCaptureReference: number;
  burstEndSecondsFromCaptureReference: number;
  burstDurationSeconds: number;
  /** Local (slit) exposure durations t_e over the active frame. */
  localExposureDurationRangeSeconds: { minimum: number; maximum: number };
  /** Flash energy each line receives relative to one ordinary pulse at the same power: η·t_e/D. */
  energyFractionOfSinglePulseRange: { minimum: number; maximum: number };
  /** Effective guide-number factor relative to the same-power ordinary pulse: √(η·t_e/D). */
  guideNumberFactorRange: { minimum: number; maximum: number };
  uniformAcrossActiveFrame: boolean;
  /** The rectangular high-speed-sync burst, written as a manual pulse profile for the illumination overlay. */
  burstFlashProfile: ManualFlashProfile | null;
  releaseFrameBinding:
    | {
        sequenceId: string;
        releaseFrameId: string;
        frameIndex: number;
        sceneTimeSecondsFromSequenceStartAtBurstStart: number;
        sceneTimeSecondsFromSequenceStartAtBurstEnd: number;
      }
    | null;
  hssModeled: true;
  ttlModeled: false;
  sensorReadoutTimingUsedAsExposureTiming: false;
  limitations: readonly string[];
}

function integratePulse(samples: readonly SceneIlluminationTemporalWaveformSample[]): number {
  let area = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const a = samples[index - 1]!, b = samples[index]!;
    area += (b.timeSecondsFromWaveformReference - a.timeSecondsFromWaveformReference) *
      (a.relativeMagnitudeMultiplier + b.relativeMagnitudeMultiplier) / 2;
  }
  return area;
}

/**
 * Resolves high-speed (focal-plane) sync (HSS): a fast pulse train that acts as continuous light and
 * covers the whole travelling-slit exposure.
 *
 * At shutter speeds faster than the ordinary sync limit, the shutter's opening and closing edges
 * cross the frame as a slit, and the whole frame is never open at once. A single short pulse would
 * light only a band.
 *
 * HSS instead fires a rapid pulse train. It behaves like constant output P over the burst D, from
 * the first line opening to the last line closing. Each line collects P·t_e over its slit time t_e.
 * - The burst energy is E_burst = η·p·E_pulse. η comes from the sync profile, p is the power
 *   fraction and E_pulse is the energy of an ordinary full-power pulse.
 * - So P = E_burst/D, and each line receives η·p·E_pulse·t_e/D.
 * - Exposure ∝ GN² (inverse-square law, GN = d·N). So, relative to an ordinary pulse at the same
 *   power, the effective guide number is GN_HSS/GN = √(η·t_e/D).
 * Shortening t_e by one stop therefore costs half a stop of guide number.
 *
 * Approximations: the pulse train is treated as continuous (pulse period ≪ t_e). Recycle and thermal
 * limits are folded into η. Front/rear-curtain placement does not apply, because the burst covers
 * the whole exposure.
 * @see docs/SCENE_SENSOR_TEMPORAL_EXPOSURE.md#high-speed-sync
 */
export function resolveHighSpeedFlashSync(input: ResolveHighSpeedFlashSyncInput): ResolvedHighSpeedFlashSync {
  requireInputKeys(input, "resolveHighSpeedFlashSync", ["flashEnabled", "flashProfile", "syncCapabilities", "timing", "powerFraction", "releaseFrame"]);
  requireTimingRecordShape(input.timing, "resolveHighSpeedFlashSync timing");
  const flash = parseManualFlashProfile(input.flashProfile);
  const capabilities = parseFlashSyncCapabilityProfile(input.syncCapabilities);
  if (capabilities.captureModeId !== input.timing.captureModeId || capabilities.timingProfileId !== input.timing.timingProfileId) {
    throw new InvalidScientificInputError(
      "Flash sync capability profile must exactly match the resolved capture-mode and timing-profile identities."
    );
  }
  if (!capabilities.highSpeedSyncSupported || capabilities.highSpeedSync === undefined) {
    throw new InvalidScientificInputError("The flash sync capability profile does not declare high-speed sync.");
  }
  const power = input.powerFraction;
  if (typeof power !== "number" || !Number.isFinite(power) || power <= 0 || power > 1) {
    throw new InvalidScientificInputError("HSS powerFraction must lie in (0, 1].");
  }
  if (input.releaseFrame !== undefined) validateReleaseBinding(input.releaseFrame, input.timing);

  const windows = input.timing.exposureWindows;
  const closing = windows.closing.schedule;
  const burstEnd = windows.nominalExposureDurationSeconds.value +
    (closing.kind === "simultaneous" ? 0 : closing.traversalDurationSeconds.value);
  const eta = capabilities.highSpeedSync.burstEnergyFractionOfFullPulse;
  const local = windows.localExposureDurationRangeSeconds;
  const fraction = { minimum: eta * local.minimum / burstEnd, maximum: eta * local.maximum / burstEnd };
  const pulseEnergy = integratePulse(flash.pulse.samples);
  const burstFlashProfile: ManualFlashProfile = {
    ...flash,
    pulse: {
      ...flash.pulse,
      waveformId: flash.pulse.waveformId + "-hss-burst",
      supportDurationSeconds: burstEnd,
      samples: [
        { timeSecondsFromWaveformReference: 0, relativeMagnitudeMultiplier: 1 },
        { timeSecondsFromWaveformReference: burstEnd, relativeMagnitudeMultiplier: 1 }
      ],
      limitations: [...flash.pulse.limitations,
        "Quasi-continuous HSS burst: the pulse train is approximated by constant output over the burst support."]
    },
    outputControl: { ...flash.outputControl, scale: flash.outputControl.scale * power * eta * pulseEnergy / burstEnd }
  };
  const enabled = input.flashEnabled;
  return {
    modelId: HIGH_SPEED_SYNC_MODEL.id,
    modelVersion: HIGH_SPEED_SYNC_MODEL.version,
    flashEnabled: enabled,
    flashProfileId: flash.profileId,
    flashProfileVersion: flash.profileVersion,
    sourceId: flash.sourceTemplate.sourceId,
    syncMode: "high-speed-sync",
    syncStatus: enabled ? "high-speed-sync-resolved" : "disabled",
    captureModeId: input.timing.captureModeId,
    timingProfileId: input.timing.timingProfileId,
    syncCapabilityProfileId: capabilities.profileId,
    timeReference: "first-opening-boundary-phase",
    powerFraction: power,
    burstEnergyFractionOfFullPulse: eta,
    singlePulseIntegratedRelativeSeconds: pulseEnergy,
    burstStartSecondsFromCaptureReference: 0,
    burstEndSecondsFromCaptureReference: burstEnd,
    burstDurationSeconds: burstEnd,
    localExposureDurationRangeSeconds: { minimum: local.minimum, maximum: local.maximum },
    energyFractionOfSinglePulseRange: fraction,
    guideNumberFactorRange: { minimum: Math.sqrt(fraction.minimum), maximum: Math.sqrt(fraction.maximum) },
    uniformAcrossActiveFrame: local.minimum === local.maximum,
    burstFlashProfile: enabled ? burstFlashProfile : null,
    waveformTimeZeroSecondsFromCaptureReference: enabled ? 0 : null,
    releaseFrameBinding: !enabled || input.releaseFrame === undefined ? null : {
      sequenceId: input.releaseFrame.sequenceId,
      releaseFrameId: input.releaseFrame.releaseFrameId,
      frameIndex: input.releaseFrame.frameIndex,
      sceneTimeSecondsFromSequenceStartAtBurstStart: input.releaseFrame.sceneTimeSecondsFromSequenceStart,
      sceneTimeSecondsFromSequenceStartAtBurstEnd: input.releaseFrame.sceneTimeSecondsFromSequenceStart + burstEnd
    },
    hssModeled: true,
    ttlModeled: false,
    sensorReadoutTimingUsedAsExposureTiming: false,
    evidence: [...flash.evidence, ...capabilities.evidence, ...capabilities.highSpeedSync.evidence, ...input.timing.evidence],
    limitations: [
      ...flash.limitations,
      ...capabilities.limitations,
      "HSS burst is registered to exposure-boundary timing (first line opening to last line closing), never sensor data-readout timing.",
      "Pulse-train ripple, recycle/thermal limits beyond the declared burst energy fraction and branded flash protocols are not modeled."
    ]
  };
}

/**
 * Registers a resolved high-speed-sync burst as a temporal illumination overlay: a rectangular
 * waveform over [0, D]. Each line then collects the burst over its own local exposure window.
 */
export function createHighSpeedSyncIlluminationOverlay(
  input: Omit<CreateManualFlashIlluminationOverlayInput, "resolvedSync"> & { resolvedSync: ResolvedHighSpeedFlashSync }
): ManualFlashIlluminationOverlay {
  requireInputKeys(input, "createHighSpeedSyncIlluminationOverlay", ["baseIlluminationProfile", "baseTemporalProfile", "flashProfile", "illuminationProfileId", "temporalProfileId", "resolvedSync"]);
  requireInputObject(input.resolvedSync, "createHighSpeedSyncIlluminationOverlay resolvedSync");
  return createManualFlashIlluminationOverlay({ ...input,
    flashProfile: input.resolvedSync.burstFlashProfile ?? input.flashProfile });
}
