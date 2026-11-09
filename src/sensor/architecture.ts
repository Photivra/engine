// SPDX-License-Identifier: Apache-2.0

/**
 * Sensor architecture: descriptive metadata about a sensor's hardware (such as CMOS or CCD, and its
 * readout capabilities), each fact backed by evidence.
 *
 * This metadata describes; it does not switch on any physics. The parser checks structure, allowed
 * values and per-field evidence. It does not check that a cited real-world claim is true.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  parseEvidenceList,
  type EvidenceBackedFact,
  type EvidenceProvenance,
  type EvidenceReuseStatus,
  type EvidenceSourceOrigin
} from "../core/evidence-provenance.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireConfigRecord as requireRecord, requireConfigRecordString as requireNonEmptyString } from "../core/record-validation.js";

type UnknownRecord = Record<string, unknown>;

export const SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION = "0.3.0" as const;
const LEGACY_SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION = "0.2.0" as const;

export type SensorTechnologyFamily = "cmos" | "ccd";

export type SensorIlluminationArchitecture = "fsi" | "bsi";

export type SensorIntegrationArchitecture =
  | "monolithic"
  | "partially-stacked"
  | "stacked";

export type SensorReadoutArchitecture = "rolling" | "global";

export type SensorColorSamplingFamily =
  | "bayer"
  | "quad-bayer"
  | "monochrome"
  | "custom-rgb-mosaic"
  | "layered-color";

export type SensorArchitectureSourceKind = EvidenceSourceOrigin;
export type SensorArchitectureReuseStatus = EvidenceReuseStatus;
export type SensorArchitectureFactProvenance = EvidenceProvenance;
export type SourcedSensorArchitectureFact<T> = EvidenceBackedFact<T>;

interface SensorArchitectureProfileBase {
  illumination?: SourcedSensorArchitectureFact<SensorIlluminationArchitecture>;
  integration?: SourcedSensorArchitectureFact<SensorIntegrationArchitecture>;
  /**
   * Readout modes the hardware supports, not the mode chosen for one capture.
   * Each capability has its own evidence, because different readout modes may
   * be documented by different sources.
   */
  readoutCapabilities?: readonly SourcedSensorArchitectureFact<SensorReadoutArchitecture>[];
  colorSamplingFamily?: SourcedSensorArchitectureFact<SensorColorSamplingFamily>;
}

/**
 * Legacy sensor-architecture schema.
 *
 * Schema 0.2.0 is still accepted and kept exactly as parsed. It has no
 * technologyFamily field; leaving it out means "unknown, not stated".
 */
export interface SensorArchitectureProfileV0_2
  extends SensorArchitectureProfileBase {
  schemaVersion: typeof LEGACY_SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION;
  technologyFamily?: never;
}

/**
 * Current descriptive metadata about the sensor hardware and its capabilities.
 *
 * An omitted property means "unknown, not stated". These fields do not switch
 * on scientific effects. No architecture value changes noise, dynamic range,
 * field of view, crop factor, exposure, readout timing or sampling unless a
 * separate downstream model explicitly uses that fact.
 */
export interface SensorArchitectureProfileV0_3
  extends SensorArchitectureProfileBase {
  schemaVersion: typeof SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION;
  /** Broad detector technology (for example CMOS or CCD) only. It never changes performance. */
  technologyFamily?: SourcedSensorArchitectureFact<SensorTechnologyFamily>;
}

export type SensorArchitectureProfile =
  | SensorArchitectureProfileV0_2
  | SensorArchitectureProfileV0_3;

const TECHNOLOGY_FAMILY_VALUES = new Set<SensorTechnologyFamily>([
  "cmos",
  "ccd"
]);

const ILLUMINATION_VALUES = new Set<SensorIlluminationArchitecture>([
  "fsi",
  "bsi"
]);

const INTEGRATION_VALUES = new Set<SensorIntegrationArchitecture>([
  "monolithic",
  "partially-stacked",
  "stacked"
]);

const READOUT_VALUES = new Set<SensorReadoutArchitecture>([
  "rolling",
  "global"
]);

const COLOR_SAMPLING_VALUES = new Set<SensorColorSamplingFamily>([
  "bayer",
  "quad-bayer",
  "monochrome",
  "custom-rgb-mosaic",
  "layered-color"
]);

function parseScalarFact<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<T>
): SourcedSensorArchitectureFact<T> {
  const record = requireRecord(value, path, ["value", "evidence"]);
  const factValue = requireNonEmptyString(record, "value", path);
  if (!allowed.has(factValue as T)) {
    throw new InvalidConfigurationError(`${path}.value is invalid.`);
  }

  return {
    value: factValue as T,
    evidence: parseEvidenceList(record.evidence, `${path}.evidence`)
  };
}

function parseReadoutCapabilities(
  value: unknown,
  path: string
): readonly SourcedSensorArchitectureFact<SensorReadoutArchitecture>[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidConfigurationError(
      `${path} must be a non-empty array.`
    );
  }

  const parsed = value.map((entry, index) =>
    parseScalarFact(
      entry,
      `${path}[${index}]`,
      READOUT_VALUES
    )
  );

  const values = parsed.map((fact) => fact.value);
  if (new Set(values).size !== values.length) {
    throw new InvalidConfigurationError(
      `${path} must not contain duplicate capability values.`
    );
  }

  return parsed;
}

function parseSharedArchitectureFields(
  profile: UnknownRecord
): SensorArchitectureProfileBase {
  return {
    ...(profile.illumination === undefined
      ? {}
      : {
          illumination: parseScalarFact(
            profile.illumination,
            "sensorArchitecture.illumination",
            ILLUMINATION_VALUES
          )
        }),
    ...(profile.integration === undefined
      ? {}
      : {
          integration: parseScalarFact(
            profile.integration,
            "sensorArchitecture.integration",
            INTEGRATION_VALUES
          )
        }),
    ...(profile.readoutCapabilities === undefined
      ? {}
      : {
          readoutCapabilities: parseReadoutCapabilities(
            profile.readoutCapabilities,
            "sensorArchitecture.readoutCapabilities"
          )
        }),
    ...(profile.colorSamplingFamily === undefined
      ? {}
      : {
          colorSamplingFamily: parseScalarFact(
            profile.colorSamplingFamily,
            "sensorArchitecture.colorSamplingFamily",
            COLOR_SAMPLING_VALUES
          )
        })
  };
}

/**
 * Parses untrusted descriptive sensor-architecture metadata.
 *
 * Schema 0.2.0 is still accepted and returns a 0.2.0 profile with the same
 * meaning. Schema 0.3.0 adds an optional, evidence-backed technology family
 * (CMOS or CCD). Leave out facts you do not know rather than guessing them.
 *
 * The parser checks structure, allowed values and per-field evidence only. It
 * does not check that a cited real-world claim is true, and the technology
 * family does not switch on any hidden physics.
 *
 * @param value Unknown external data.
 * @returns Validated sensor architecture profile preserving input schema identity.
 */
export function parseSensorArchitectureProfile(
  value: unknown
): SensorArchitectureProfile {
  const profile = requireRecord(value, "sensorArchitecture", ["illumination", "integration", "readoutCapabilities", "colorSamplingFamily", "schemaVersion", "technologyFamily"]);
  const shared = parseSharedArchitectureFields(profile);

  if (
    profile.schemaVersion ===
    LEGACY_SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION
  ) {
    if (profile.technologyFamily !== undefined) {
      throw new InvalidConfigurationError(
        "sensorArchitecture schema 0.2.0 does not support technologyFamily; use schema 0.3.0."
      );
    }

    return {
      schemaVersion: LEGACY_SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION,
      ...shared
    };
  }

  if (profile.schemaVersion === SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION) {
    return {
      schemaVersion: SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION,
      ...shared,
      ...(profile.technologyFamily === undefined
        ? {}
        : {
            technologyFamily: parseScalarFact(
              profile.technologyFamily,
              "sensorArchitecture.technologyFamily",
              TECHNOLOGY_FAMILY_VALUES
            )
          })
    };
  }

  throw new InvalidConfigurationError(
    'sensorArchitecture.schemaVersion must be "0.2.0" or "0.3.0".'
  );
}
