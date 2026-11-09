// SPDX-License-Identifier: Apache-2.0

/**
 * Generic exposure program lines, for teaching and for products. A program line is the curve of
 * aperture/shutter pairs a camera's Program mode follows.
 *
 * A program line is control policy, not physics. Each node declares a wanted aperture/shutter pair at
 * an explicit number of stops of optical exposure, relative to the resolver's reference exposure.
 * The resolver later checks that every node is physically consistent with that reference and with
 * what the equipment can do.
 * @see docs/USAGE.md for the equations, units, coordinate conventions, known blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigFinite as requireFinite, parseConfigLimitations as parseLimitations, requireConfigFiniteAboveZero as requirePositiveFinite } from "../core/record-validation.js";

export const EXPOSURE_PROGRAM_LINE_SCHEMA_VERSION =
  "0.1.0" as const;

export interface ExposureProgramLineNode {
  nodeId: string;
  opticalExposureStopsFromReference: number;
  aperture: number;
  shutterSeconds: number;
}

export interface ExposureProgramLineProfile {
  schemaVersion:
    typeof EXPOSURE_PROGRAM_LINE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  policyKind:
    "generic-program-line";
  interpolation:
    "log2-aperture-shutter";
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
  nodes:
    readonly ExposureProgramLineNode[];
}

/**
 * Parses a generic educational/product exposure program line.
 *
 * A program line is control policy, not physics. Each node declares a wanted
 * aperture/shutter pair at an explicit number of stops of optical exposure,
 * relative to the resolver's reference exposure. The resolver later checks
 * that every node is physically consistent with that reference and with what
 * the equipment can do.
 */
export function parseExposureProgramLineProfile(
  value: unknown
): ExposureProgramLineProfile {
  const record = requireRecord(
    value,
    "exposureProgramLineProfile", ["schemaVersion", "scientificStatus", "policyKind", "interpolation", "nodes", "profileId", "profileVersion", "evidence", "limitations"]
  );

  if (
    record.schemaVersion !==
    EXPOSURE_PROGRAM_LINE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'exposureProgramLineProfile.schemaVersion must be "' +
        EXPOSURE_PROGRAM_LINE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      'exposureProgramLineProfile.scientificStatus must be "approximation".'
    );
  }
  if (
    record.policyKind !==
    "generic-program-line"
  ) {
    throw new InvalidConfigurationError(
      'exposureProgramLineProfile.policyKind must be "generic-program-line".'
    );
  }
  if (
    record.interpolation !==
    "log2-aperture-shutter"
  ) {
    throw new InvalidConfigurationError(
      'exposureProgramLineProfile.interpolation must be "log2-aperture-shutter".'
    );
  }
  if (
    !Array.isArray(record.nodes) ||
    record.nodes.length < 2
  ) {
    throw new InvalidConfigurationError(
      "exposureProgramLineProfile.nodes must contain at least two nodes."
    );
  }

  let previousStops =
    Number.NEGATIVE_INFINITY;
  const ids: string[] = [];

  const nodes = record.nodes.map(
    (entry, index) => {
      const path =
        "exposureProgramLineProfile.nodes[" +
        index +
        "]";
      const node =
        requireRecord(entry, path, ["nodeId", "opticalExposureStopsFromReference", "aperture", "shutterSeconds"]);
      const nodeId =
        requireNonEmptyString(
          node.nodeId,
          path + ".nodeId"
        );
      const stops =
        requireFinite(
          node
            .opticalExposureStopsFromReference,
          path +
            ".opticalExposureStopsFromReference"
        );
      if (stops <= previousStops) {
        throw new InvalidConfigurationError(
          "exposureProgramLineProfile.nodes opticalExposureStopsFromReference must be strictly increasing."
        );
      }
      previousStops = stops;
      ids.push(nodeId);

      return {
        nodeId,
        opticalExposureStopsFromReference:
          stops,
        aperture:
          requirePositiveFinite(
            node.aperture,
            path + ".aperture"
          ),
        shutterSeconds:
          requirePositiveFinite(
            node.shutterSeconds,
            path +
              ".shutterSeconds"
          )
      };
    }
  );

  if (
    new Set(ids).size !== ids.length
  ) {
    throw new InvalidConfigurationError(
      "exposureProgramLineProfile.nodes[].nodeId must not contain duplicates."
    );
  }

  return {
    schemaVersion:
      EXPOSURE_PROGRAM_LINE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "exposureProgramLineProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "exposureProgramLineProfile.profileVersion"
      ),
    scientificStatus:
      "approximation",
    policyKind:
      "generic-program-line",
    interpolation:
      "log2-aperture-shutter",
    evidence: parseEvidenceList(
      record.evidence,
      "exposureProgramLineProfile.evidence"
    ),
    limitations:
      parseLimitations(
        record.limitations,
        "exposureProgramLineProfile.limitations"
      ),
    nodes
  };
}
