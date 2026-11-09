// SPDX-License-Identifier: Apache-2.0

/**
 * ISO signal chain: picks the explicit readout regime (gain, read noise, clipping) that belongs to the
 * selected ISO and capture mode.
 *
 * Gain and noise are never derived from the ISO number itself; each regime is declared. Photons and
 * photo or dark shot noise are computed earlier in the chain. Generic tier labels do not calibrate or
 * rank real cameras.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  parseIsoCapabilityProfile,
  resolveIsoCapability,
  type IsoCapabilityProfile,
  type RequestedIsoSetting,
  type ResolvedIsoCapability
} from "../equipment/iso-capabilities.js";
import {
  parseSensorReadoutConversionProfile,
  resolveSensorReadoutRegime,
  type ResolvedSensorReadoutRegime,
  type SensorReadoutConversionProfile
} from "./raw-readout.js";
import { requireInputKeys, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigPositiveFinite as requirePositiveFinite, parseConfigLimitations as parseLimitations } from "../core/record-validation.js";

export const GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;
export const GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION =
  "0.1.0" as const;

export interface GenericIsoStandardRegimeBand {
  minimumExposureIndex: number;
  maximumExposureIndex: number;
  readoutRegimeId: string;
}

export interface GenericIsoExpandedRegimeBinding {
  expandedSettingId: string;
  readoutRegimeId: string;
}

export interface GenericIsoCaptureModeSignalChainBinding {
  captureModeId: string;
  standardRegimeBands:
    readonly GenericIsoStandardRegimeBand[];
  expandedRegimeBindings:
    readonly GenericIsoExpandedRegimeBinding[];
  evidence:
    readonly EvidenceProvenance[];
}

export interface GenericIsoSignalChainProfile {
  schemaVersion:
    typeof GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  isoCapabilityProfileId: string;
  readoutProfileId: string;
  behaviorMeaning:
    "iso-state-selects-explicit-readout-regime-not-noise-equation";
  captureModeBindings:
    readonly GenericIsoCaptureModeSignalChainBinding[];
  photonShotNoiseOwnedUpstream:
    true;
  processedImageBehaviorIncluded:
    false;
  fixedPatternNoiseModeled:
    false;
  lowSignalColorDegradationModeled:
    false;
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface ResolveGenericIsoSignalChainInput {
  profile:
    GenericIsoSignalChainProfile;
  isoCapability:
    IsoCapabilityProfile;
  requestedIsoSetting:
    RequestedIsoSetting;
  captureModeId: string;
  readoutProfile:
    SensorReadoutConversionProfile;
}

export interface ResolvedGenericIsoSignalChain {
  profileId: string;
  profileVersion: string;
  scientificStatus:
    "approximation";
  captureModeId: string;
  iso:
    ResolvedIsoCapability;
  readout:
    ResolvedSensorReadoutRegime;
  regimeSelectionReason:
    | "standard-exposure-index-band"
    | "expanded-setting-binding";
  capturedPhotonExpectationModified:
    false;
  photonShotNoiseStatisticsModified:
    false;
  sensorGeometryModified: false;
  processedImageBehaviorApplied:
    false;
  fixedPatternNoiseApplied:
    false;
  lowSignalColorDegradationApplied:
    false;
  isoUsedAsDirectNoiseEquation:
    false;
  exactCommercialCameraBehaviorClaimed:
    false;
}

export type GenericIsoSignalChainPreset =
  | "good"
  | "better"
  | "best";

export interface GenericIsoSignalChainPresetCatalog {
  schemaVersion:
    typeof GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION;
  catalogId: string;
  catalogVersion: string;
  entries: readonly {
    preset:
      GenericIsoSignalChainPreset;
    signalChainProfileId:
      string;
    evidence:
      readonly EvidenceProvenance[];
  }[];
  performanceOrderingClaimed:
    false;
  realCameraRankingClaimed:
    false;
}

function parseStandardBand(
  value: unknown,
  path: string
): GenericIsoStandardRegimeBand {
  const record =
    requireRecord(value, path, ["minimumExposureIndex", "maximumExposureIndex", "readoutRegimeId"]);
  const minimumExposureIndex =
    requirePositiveFinite(
      record.minimumExposureIndex,
      path +
        ".minimumExposureIndex"
    );
  const maximumExposureIndex =
    requirePositiveFinite(
      record.maximumExposureIndex,
      path +
        ".maximumExposureIndex"
    );
  if (
    minimumExposureIndex >
    maximumExposureIndex
  ) {
    throw new InvalidConfigurationError(
      path +
        ".minimumExposureIndex must be less than or equal to maximumExposureIndex."
    );
  }
  return {
    minimumExposureIndex,
    maximumExposureIndex,
    readoutRegimeId:
      requireNonEmptyString(
        record.readoutRegimeId,
        path +
          ".readoutRegimeId"
      )
  };
}

function parseCaptureModeBinding(
  value: unknown,
  path: string
): GenericIsoCaptureModeSignalChainBinding {
  const record =
    requireRecord(value, path, ["standardRegimeBands", "expandedRegimeBindings", "captureModeId", "evidence"]);
  if (
    !Array.isArray(
      record.standardRegimeBands
    ) ||
    record.standardRegimeBands
      .length === 0
  ) {
    throw new InvalidConfigurationError(
      path +
        ".standardRegimeBands must be a non-empty array."
    );
  }
  const bands =
    record.standardRegimeBands.map(
      (entry, index) =>
        parseStandardBand(
          entry,
          path +
            ".standardRegimeBands[" +
            index +
            "]"
        )
    ).sort(
      (a, b) =>
        a.minimumExposureIndex -
        b.minimumExposureIndex
    );
  for (
    let index = 1;
    index < bands.length;
    index += 1
  ) {
    const prior =
      bands[index - 1]!;
    const current =
      bands[index]!;
    if (
      current.minimumExposureIndex <=
      prior.maximumExposureIndex
    ) {
      throw new InvalidConfigurationError(
        path +
          ".standardRegimeBands must not overlap."
      );
    }
  }

  if (
    !Array.isArray(
      record.expandedRegimeBindings
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        ".expandedRegimeBindings must be an array."
    );
  }
  const expandedRegimeBindings =
    record.expandedRegimeBindings.map(
      (entry, index) => {
        const entryPath =
          path +
          ".expandedRegimeBindings[" +
          index +
          "]";
        const binding =
          requireRecord(
            entry,
            entryPath, ["expandedSettingId", "readoutRegimeId"]
          );
        return {
          expandedSettingId:
            requireNonEmptyString(
              binding.expandedSettingId,
              entryPath +
                ".expandedSettingId"
            ),
          readoutRegimeId:
            requireNonEmptyString(
              binding.readoutRegimeId,
              entryPath +
                ".readoutRegimeId"
            )
        };
      }
    );
  const expandedIds =
    expandedRegimeBindings.map(
      (entry) =>
        entry.expandedSettingId
    );
  if (
    new Set(expandedIds).size !==
    expandedIds.length
  ) {
    throw new InvalidConfigurationError(
      path +
        ".expandedRegimeBindings must not contain duplicate expandedSettingId values."
    );
  }

  return {
    captureModeId:
      requireNonEmptyString(
        record.captureModeId,
        path + ".captureModeId"
      ),
    standardRegimeBands:
      bands,
    expandedRegimeBindings,
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
  };
}

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The profile binds each ISO and capture-mode state to an explicit readout regime, whose gain,
 * read noise and clipping are declared separately.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseGenericIsoSignalChainProfile(
  value: unknown
): GenericIsoSignalChainProfile {
  const record =
    requireRecord(
      value,
      "genericIsoSignalChainProfile", ["schemaVersion", "scientificStatus", "behaviorMeaning", "photonShotNoiseOwnedUpstream", "processedImageBehaviorIncluded", "fixedPatternNoiseModeled", "lowSignalColorDegradationModeled", "captureModeBindings", "profileId", "profileVersion", "isoCapabilityProfileId", "readoutProfileId", "evidence", "limitations"]
    );
  if (
    record.schemaVersion !==
    GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'genericIsoSignalChainProfile.schemaVersion must be "' +
        GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      'genericIsoSignalChainProfile.scientificStatus must be "approximation".'
    );
  }
  if (
    record.behaviorMeaning !==
    "iso-state-selects-explicit-readout-regime-not-noise-equation"
  ) {
    throw new InvalidConfigurationError(
      "genericIsoSignalChainProfile.behaviorMeaning is invalid."
    );
  }
  if (
    record.photonShotNoiseOwnedUpstream !==
      true ||
    record.processedImageBehaviorIncluded !==
      false ||
    record.fixedPatternNoiseModeled !==
      false ||
    record.lowSignalColorDegradationModeled !==
      false
  ) {
    throw new InvalidConfigurationError(
      "genericIsoSignalChainProfile domain-ownership flags are invalid."
    );
  }
  if (
    !Array.isArray(
      record.captureModeBindings
    ) ||
    record.captureModeBindings
      .length === 0
  ) {
    throw new InvalidConfigurationError(
      "genericIsoSignalChainProfile.captureModeBindings must be a non-empty array."
    );
  }
  const captureModeBindings =
    record.captureModeBindings.map(
      (entry, index) =>
        parseCaptureModeBinding(
          entry,
          "genericIsoSignalChainProfile.captureModeBindings[" +
            index +
            "]"
        )
    );
  const modeIds =
    captureModeBindings.map(
      (entry) =>
        entry.captureModeId
    );
  if (
    new Set(modeIds).size !==
    modeIds.length
  ) {
    throw new InvalidConfigurationError(
      "genericIsoSignalChainProfile.captureModeBindings must not contain duplicate captureModeId values."
    );
  }

  return {
    schemaVersion:
      GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "genericIsoSignalChainProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "genericIsoSignalChainProfile.profileVersion"
      ),
    scientificStatus:
      "approximation",
    isoCapabilityProfileId:
      requireNonEmptyString(
        record.isoCapabilityProfileId,
        "genericIsoSignalChainProfile.isoCapabilityProfileId"
      ),
    readoutProfileId:
      requireNonEmptyString(
        record.readoutProfileId,
        "genericIsoSignalChainProfile.readoutProfileId"
      ),
    behaviorMeaning:
      "iso-state-selects-explicit-readout-regime-not-noise-equation",
    captureModeBindings,
    photonShotNoiseOwnedUpstream:
      true,
    processedImageBehaviorIncluded:
      false,
    fixedPatternNoiseModeled:
      false,
    lowSignalColorDegradationModeled:
      false,
    evidence:
      parseEvidenceList(
        record.evidence,
        "genericIsoSignalChainProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "genericIsoSignalChainProfile.limitations"
      )
  };
}

function regimeIdForIso(
  binding:
    GenericIsoCaptureModeSignalChainBinding,
  iso:
    ResolvedIsoCapability
): {
  regimeId: string;
  reason:
    ResolvedGenericIsoSignalChain["regimeSelectionReason"];
} {
  if (
    iso.setting.kind ===
    "expanded"
  ) {
    const expandedSettingId =
      iso.setting.settingId;
    const expanded =
      binding
        .expandedRegimeBindings
        .find(
          (entry) =>
            entry
              .expandedSettingId ===
            expandedSettingId
        );
    if (expanded === undefined) {
      throw new InvalidScientificInputError(
        "Expanded ISO setting has no signal-chain regime binding for the selected capture mode."
      );
    }
    return {
      regimeId:
        expanded
          .readoutRegimeId,
      reason:
        "expanded-setting-binding"
    };
  }

  const matches =
    binding
      .standardRegimeBands
      .filter(
        (band) =>
          iso
            .reportedExposureIndex >=
            band
              .minimumExposureIndex &&
          iso
            .reportedExposureIndex <=
            band
              .maximumExposureIndex
      );
  if (matches.length !== 1) {
    throw new InvalidScientificInputError(
      "Standard ISO setting must match exactly one signal-chain regime band."
    );
  }
  return {
    regimeId:
      matches[0]!
        .readoutRegimeId,
    reason:
      "standard-exposure-index-band"
  };
}

/**
 * Picks the explicit readout regime bound to the resolved ISO and capture-mode state. Gain and noise
 * are never derived from the ISO number.
 * @param input - The input; see `ResolveGenericIsoSignalChainInput` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function resolveGenericIsoSignalChain(
  input:
    ResolveGenericIsoSignalChainInput
): ResolvedGenericIsoSignalChain {
  requireInputKeys(input, "resolveGenericIsoSignalChain", ["profile", "isoCapability", "requestedIsoSetting", "captureModeId", "readoutProfile"]);
  const profile =
    parseGenericIsoSignalChainProfile(
      input.profile
    );
  const isoCapability =
    parseIsoCapabilityProfile(
      input.isoCapability
    );
  const readoutProfile =
    parseSensorReadoutConversionProfile(
      input.readoutProfile
    );

  if (
    profile.isoCapabilityProfileId !==
    isoCapability.profileId
  ) {
    throw new InvalidScientificInputError(
      "Signal-chain profile isoCapabilityProfileId must match the supplied ISO capability profile."
    );
  }
  if (
    profile.readoutProfileId !==
    readoutProfile.profileId
  ) {
    throw new InvalidScientificInputError(
      "Signal-chain profile readoutProfileId must match the supplied sensor readout profile."
    );
  }
  if (
    typeof input.captureModeId !==
      "string" ||
    input.captureModeId.trim()
      .length === 0
  ) {
    throw new InvalidConfigurationError(
      "captureModeId must be a non-empty string."
    );
  }

  const binding =
    profile.captureModeBindings.find(
      (entry) =>
        entry.captureModeId ===
        input.captureModeId
    );
  if (binding === undefined) {
    throw new InvalidScientificInputError(
      "Signal-chain profile has no binding for the selected capture mode."
    );
  }

  const iso =
    resolveIsoCapability({
      profile:
        isoCapability,
      setting:
        input
          .requestedIsoSetting,
      captureModeId:
        input.captureModeId
    });
  const regime =
    regimeIdForIso(
      binding,
      iso
    );
  const readout =
    resolveSensorReadoutRegime({
      profile:
        readoutProfile,
      regimeId:
        regime.regimeId
    });
  const gain =
    readout.regime
      .exposureIndexGain;
  if (
    gain !== undefined &&
    gain.exposureIndex !==
      iso.reportedExposureIndex
  ) {
    throw new InvalidScientificInputError(
      "The bound readout regime declares an ISO-gain derivation for a different exposure index."
    );
  }

  return {
    profileId:
      profile.profileId,
    profileVersion:
      profile.profileVersion,
    scientificStatus:
      "approximation",
    captureModeId:
      input.captureModeId,
    iso,
    readout,
    regimeSelectionReason:
      regime.reason,
    capturedPhotonExpectationModified:
      false,
    photonShotNoiseStatisticsModified:
      false,
    sensorGeometryModified:
      false,
    processedImageBehaviorApplied:
      false,
    fixedPatternNoiseApplied:
      false,
    lowSignalColorDegradationApplied:
      false,
    isoUsedAsDirectNoiseEquation:
      false,
    exactCommercialCameraBehaviorClaimed:
      false
  };
}

const PRESETS =
  new Set<GenericIsoSignalChainPreset>([
    "good",
    "better",
    "best"
  ]);

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * Generic tier labels in the catalogue do not calibrate or rank real cameras.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseGenericIsoSignalChainPresetCatalog(
  value: unknown
): GenericIsoSignalChainPresetCatalog {
  const record =
    requireRecord(
      value,
      "genericIsoSignalChainPresetCatalog", ["schemaVersion", "performanceOrderingClaimed", "realCameraRankingClaimed", "entries", "catalogId", "catalogVersion"]
    );
  if (
    record.schemaVersion !==
    GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'genericIsoSignalChainPresetCatalog.schemaVersion must be "' +
        GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.performanceOrderingClaimed !==
      false ||
    record.realCameraRankingClaimed !==
      false
  ) {
    throw new InvalidConfigurationError(
      "Generic ISO preset catalog must not claim physical performance ordering or real-camera ranking."
    );
  }
  if (
    !Array.isArray(
      record.entries
    ) ||
    record.entries.length !== 3
  ) {
    throw new InvalidConfigurationError(
      "Generic ISO preset catalog must contain exactly Good, Better, and Best entries."
    );
  }

  const entries =
    record.entries.map(
      (entry, index) => {
        const path =
          "genericIsoSignalChainPresetCatalog.entries[" +
          index +
          "]";
        const parsed =
          requireRecord(
            entry,
            path, ["preset", "signalChainProfileId", "evidence"]
          );
        if (
          typeof parsed.preset !==
            "string" ||
          !PRESETS.has(
            parsed.preset as
              GenericIsoSignalChainPreset
          )
        ) {
          throw new InvalidConfigurationError(
            path +
              ".preset is invalid."
          );
        }
        return {
          preset:
            parsed.preset as
              GenericIsoSignalChainPreset,
          signalChainProfileId:
            requireNonEmptyString(
              parsed
                .signalChainProfileId,
              path +
                ".signalChainProfileId"
            ),
          evidence:
            parseEvidenceList(
              parsed.evidence,
              path + ".evidence"
            )
        };
      }
    );

  const presets =
    entries.map(
      (entry) =>
        entry.preset
    );
  if (
    new Set(presets).size !==
      3
  ) {
    throw new InvalidConfigurationError(
      "Generic ISO preset catalog must contain each Good, Better, and Best preset exactly once."
    );
  }

  return {
    schemaVersion:
      GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION,
    catalogId:
      requireNonEmptyString(
        record.catalogId,
        "genericIsoSignalChainPresetCatalog.catalogId"
      ),
    catalogVersion:
      requireNonEmptyString(
        record.catalogVersion,
        "genericIsoSignalChainPresetCatalog.catalogVersion"
      ),
    entries,
    performanceOrderingClaimed:
      false,
    realCameraRankingClaimed:
      false
  };
}

/**
 * Picks a generic preset from the catalogue and returns the signal-chain profile it uses. It makes
 * no claim of manufacturer calibration.
 *
 * Generic tier labels do not calibrate or rank real cameras.
 * @param input - The preset catalogue and the chosen preset.
 * @returns The preset and its signal-chain profile ID. `performanceOrderingClaimed` and
 *   `realCameraRankingClaimed` are always false. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function resolveGenericIsoSignalChainPreset(
  input: {
    catalog:
      GenericIsoSignalChainPresetCatalog;
    preset:
      GenericIsoSignalChainPreset;
  }
): {
  preset:
    GenericIsoSignalChainPreset;
  signalChainProfileId:
    string;
  performanceOrderingClaimed:
    false;
  realCameraRankingClaimed:
    false;
} {
  requireInputKeys(input, "resolveGenericIsoSignalChainPreset", ["catalog", "preset"]);
  const catalog =
    parseGenericIsoSignalChainPresetCatalog(
      input.catalog
    );
  if (
    !PRESETS.has(
      input.preset
    )
  ) {
    throw new InvalidConfigurationError(
      "preset must be good, better, or best."
    );
  }
  const entry =
    catalog.entries.find(
      (candidate) =>
        candidate.preset ===
        input.preset
    )!;

  return {
    preset:
      input.preset,
    signalChainProfileId:
      entry
        .signalChainProfileId,
    performanceOrderingClaimed:
      false,
    realCameraRankingClaimed:
      false
  };
}
