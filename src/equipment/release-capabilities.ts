// SPDX-License-Identifier: Apache-2.0

/**
 * Release and drive capabilities of a generic body: what happens when the shutter button is pressed
 * (single shot, burst, self-timer, and exposure brackets).
 *
 * The first schema deliberately models only ordinary still exposures that do not overlap. Slowdown
 * from the buffer, media or heat, and pre-release capture, are not part of this profile.
 * @see docs/GENERIC_TIER_PRESETS.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceBackedFact,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import type { GenericCapabilityAvailability } from "./exposure-capabilities.js";
import { requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigPositiveFinite as requirePositiveFinite, requireConfigPositiveSafeInteger as requirePositiveSafeInteger, requireConfigNonNegativeFinite as requireNonNegativeFinite, parseConfigAvailability as parseAvailability } from "../core/record-validation.js";


export const GENERIC_RELEASE_CAPABILITY_SCHEMA_VERSION =
  "0.1.0" as const;

export type GenericReleaseDriveMode =
  | "single"
  | "burst"
  | "self-timer";

export type GenericExposureBracketAxis =
  | "shutter"
  | "iso"
  | "aperture";

export interface GenericReleaseCapabilityProfile {
  schemaVersion:
    typeof GENERIC_RELEASE_CAPABILITY_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  evidence: readonly EvidenceProvenance[];
  supportedDriveModes:
    EvidenceBackedFact<
      readonly GenericReleaseDriveMode[]
    >;
  maximumLogicalFramesPerSequence:
    EvidenceBackedFact<number>;
  maximumCadenceFps:
    EvidenceBackedFact<number>;
  minimumInterFrameGapSeconds:
    EvidenceBackedFact<number>;
  overlappingOrdinaryStillExposures:
    false;
  exposureBracketing: {
    availability:
      EvidenceBackedFact<
        GenericCapabilityAvailability
      >;
    supportedAxes:
      readonly GenericExposureBracketAxis[];
  };
  focusBracketing: {
    availability:
      EvidenceBackedFact<
        GenericCapabilityAvailability
      >;
  };
}

const DRIVE_MODES =
  new Set<GenericReleaseDriveMode>([
    "single",
    "burst",
    "self-timer"
  ]);

const BRACKET_AXES =
  new Set<GenericExposureBracketAxis>([
    "shutter",
    "iso",
    "aperture"
  ]);

function parseFact<T>(
  value: unknown,
  path: string,
  parseValue: (
    value: unknown,
    path: string
  ) => T
): EvidenceBackedFact<T> {
  const record =
    requireRecord(value, path, ["value", "evidence"]);
  return {
    value:
      parseValue(
        record.value,
        path + ".value"
      ),
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
  };
}

function parseDriveModes(
  value: unknown,
  path: string
): readonly GenericReleaseDriveMode[] {
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
        typeof entry !== "string" ||
        !DRIVE_MODES.has(
          entry as GenericReleaseDriveMode
        )
      ) {
        throw new InvalidConfigurationError(
          path +
            "[" +
            index +
            "] is invalid."
        );
      }
      return entry as GenericReleaseDriveMode;
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

function parseBracketAxes(
  value: unknown,
  path: string
): readonly GenericExposureBracketAxis[] {
  if (!Array.isArray(value)) {
    throw new InvalidConfigurationError(
      path + " must be an array."
    );
  }
  const parsed =
    value.map((entry, index) => {
      if (
        typeof entry !== "string" ||
        !BRACKET_AXES.has(
          entry as GenericExposureBracketAxis
        )
      ) {
        throw new InvalidConfigurationError(
          path +
            "[" +
            index +
            "] is invalid."
        );
      }
      return entry as GenericExposureBracketAxis;
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
 * Parses generic logical-release/drive capabilities.
 *
 * The first schema deliberately models only ordinary still exposures that do
 * not overlap. Slowdown from the buffer, media or heat, and pre-release
 * capture, are not part of this profile.
 */
export function parseGenericReleaseCapabilityProfile(
  value: unknown
): GenericReleaseCapabilityProfile {
  const record =
    requireRecord(
      value,
      "genericReleaseCapabilityProfile", ["schemaVersion", "scientificStatus", "overlappingOrdinaryStillExposures", "exposureBracketing", "focusBracketing", "profileId", "profileVersion", "evidence", "supportedDriveModes", "maximumLogicalFramesPerSequence", "maximumCadenceFps", "minimumInterFrameGapSeconds"]
    );

  if (
    record.schemaVersion !==
    GENERIC_RELEASE_CAPABILITY_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'genericReleaseCapabilityProfile.schemaVersion must be "' +
        GENERIC_RELEASE_CAPABILITY_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      'genericReleaseCapabilityProfile.scientificStatus must be "approximation".'
    );
  }
  if (
    record.overlappingOrdinaryStillExposures !==
    false
  ) {
    throw new InvalidConfigurationError(
      "genericReleaseCapabilityProfile.overlappingOrdinaryStillExposures must be false in schema 0.1.0."
    );
  }

  const exposureBracketing =
    requireRecord(
      record.exposureBracketing,
      "genericReleaseCapabilityProfile.exposureBracketing", ["availability", "supportedAxes"]
    );
  const focusBracketing =
    requireRecord(
      record.focusBracketing,
      "genericReleaseCapabilityProfile.focusBracketing", ["availability"]
    );

  const exposureAvailability =
    parseFact(
      exposureBracketing.availability,
      "genericReleaseCapabilityProfile.exposureBracketing.availability",
      parseAvailability
    );
  const axes =
    parseBracketAxes(
      exposureBracketing.supportedAxes,
      "genericReleaseCapabilityProfile.exposureBracketing.supportedAxes"
    );

  if (
    exposureAvailability.value !==
      "supported" &&
    axes.length > 0
  ) {
    throw new InvalidConfigurationError(
      "Unsupported/unknown exposure bracketing must not declare supported axes."
    );
  }

  return {
    schemaVersion:
      GENERIC_RELEASE_CAPABILITY_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "genericReleaseCapabilityProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "genericReleaseCapabilityProfile.profileVersion"
      ),
    scientificStatus:
      "approximation",
    evidence:
      parseEvidenceList(
        record.evidence,
        "genericReleaseCapabilityProfile.evidence"
      ),
    supportedDriveModes:
      parseFact(
        record.supportedDriveModes,
        "genericReleaseCapabilityProfile.supportedDriveModes",
        parseDriveModes
      ),
    maximumLogicalFramesPerSequence:
      parseFact(
        record.maximumLogicalFramesPerSequence,
        "genericReleaseCapabilityProfile.maximumLogicalFramesPerSequence",
        requirePositiveSafeInteger
      ),
    maximumCadenceFps:
      parseFact(
        record.maximumCadenceFps,
        "genericReleaseCapabilityProfile.maximumCadenceFps",
        requirePositiveFinite
      ),
    minimumInterFrameGapSeconds:
      parseFact(
        record.minimumInterFrameGapSeconds,
        "genericReleaseCapabilityProfile.minimumInterFrameGapSeconds",
        requireNonNegativeFinite
      ),
    overlappingOrdinaryStillExposures:
      false,
    exposureBracketing: {
      availability:
        exposureAvailability,
      supportedAxes: axes
    },
    focusBracketing: {
      availability:
        parseFact(
          focusBracketing.availability,
          "genericReleaseCapabilityProfile.focusBracketing.availability",
          parseAvailability
        )
    }
  };
}
