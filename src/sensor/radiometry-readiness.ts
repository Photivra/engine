// SPDX-License-Identifier: Apache-2.0

/**
 * Radiometry readiness: checks whether the declared prerequisites are enough for a nominal photon
 * estimate and, separately, for a calibrated photon claim.
 *
 * The parser checks structure and provenance. It cannot prove that a cited calibration or evidence
 * claim is true. Passing this check does not switch on composed photon or noise output.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { rejectUnknownVariantFields, UNCERTAINTY_VARIANT_FIELDS, requireConfigRecord as requireRecord, requireConfigRecordString as requireString } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requirePositiveNumber } from "../schema/validation.js";

type UnknownRecord = Record<string, unknown>;

export type RadiometryRequirementId =
  | "scene-spectral-radiance"
  | "optical-transmission"
  | "pupil-vignetting"
  | "photosite-collection-area"
  | "exposure-integration"
  | "sensor-response";

export type RadiometryScientificStatus =
  | "calibrated"
  | "approximation";

export type RadiometryUncertaintyDeclaration =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "absolute";
      plusMinus: number;
      unit: string;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };

export interface CalibrationArtifactReference {
  id: string;
  checksumSha256: string;
}

interface RadiometryRequirementBase {
  requirement: RadiometryRequirementId;
  scientificStatus: RadiometryScientificStatus;
  modelId: string;
  modelVersion: string;
  evidence: readonly EvidenceProvenance[];
  uncertainty: RadiometryUncertaintyDeclaration;
}

export interface SceneSpectralRadianceRequirement
  extends RadiometryRequirementBase {
  requirement: "scene-spectral-radiance";
  representation:
    | "spectral-data"
    | "documented-spectral-approximation";
  dataArtifact: CalibrationArtifactReference;
}

export type OpticalTransmissionRequirement =
  | (RadiometryRequirementBase & {
      requirement: "optical-transmission";
      representation: "spectral-data";
      dataArtifact: CalibrationArtifactReference;
    })
  | (RadiometryRequirementBase & {
      requirement: "optical-transmission";
      representation: "t-stop-approximation";
      tStop: number;
    });

export type PupilVignettingRequirement =
  | (RadiometryRequirementBase & {
      requirement: "pupil-vignetting";
      representation: "spatial-data";
      dataArtifact: CalibrationArtifactReference;
    })
  | (RadiometryRequirementBase & {
      requirement: "pupil-vignetting";
      representation: "documented-approximation";
    });

export type PhotositeCollectionAreaRequirement =
  | (RadiometryRequirementBase & {
      requirement: "photosite-collection-area";
      areaModel: "effective-collection-area";
      effectiveCollectionAreaSquareMicrometers: number;
    })
  | (RadiometryRequirementBase & {
      requirement: "photosite-collection-area";
      areaModel: "geometric-area-times-fill-factor";
      geometricCellAreaSquareMicrometers: number;
      fillFactor: number;
    });

export type ExposureIntegrationRequirement =
  | (RadiometryRequirementBase & {
      requirement: "exposure-integration";
      integrationModel: "uniform-boxcar";
    })
  | (RadiometryRequirementBase & {
      requirement: "exposure-integration";
      integrationModel: "documented-shutter-function";
      dataArtifact: CalibrationArtifactReference;
    });

export type SensorResponseRequirement =
  | (RadiometryRequirementBase & {
      requirement: "sensor-response";
      responseRepresentation: "spectral-quantum-efficiency";
      dataArtifact: CalibrationArtifactReference;
    })
  | (RadiometryRequirementBase & {
      requirement: "sensor-response";
      responseRepresentation: "effective-qe-approximation";
      effectiveQuantumEfficiency: number;
    });

export type RadiometryRequirement =
  | SceneSpectralRadianceRequirement
  | OpticalTransmissionRequirement
  | PupilVignettingRequirement
  | PhotositeCollectionAreaRequirement
  | ExposureIntegrationRequirement
  | SensorResponseRequirement;

export interface RadiometryReadinessProfile {
  schemaVersion: "0.1.0";
  components: readonly RadiometryRequirement[];
}

export interface RadiometryReadinessAssessment {
  status: "not-ready" | "approximate-only" | "calibrated-ready";
  nominalPhotonEstimateReady: boolean;
  calibratedPhotonClaimReady: boolean;
  missingRequirements: readonly RadiometryRequirementId[];
  approximateRequirements: readonly RadiometryRequirementId[];
  unquantifiedUncertaintyRequirements: readonly RadiometryRequirementId[];
  /**
   * Always false: this assessment never switches on composed photon or noise
   * output by itself. Doing so is a separate, explicit later decision.
   */
  composedPhotonOutputEnabled: false;
}

const REQUIRED_REQUIREMENTS: readonly RadiometryRequirementId[] = [
  "scene-spectral-radiance",
  "optical-transmission",
  "pupil-vignetting",
  "photosite-collection-area",
  "exposure-integration",
  "sensor-response"
];

const REQUIREMENT_IDS = new Set<RadiometryRequirementId>(
  REQUIRED_REQUIREMENTS
);

const SCIENTIFIC_STATUSES = new Set<RadiometryScientificStatus>([
  "calibrated",
  "approximation"
]);

function requireFraction(
  record: UnknownRecord,
  key: string,
  path: string,
  allowZero: boolean
): number {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (allowZero ? value < 0 : value <= 0) ||
    value > 1
  ) {
    throw new InvalidConfigurationError(
      `${path}.${key} must be a finite fraction ${allowZero ? "from 0 through 1" : "greater than 0 and at most 1"}.`
    );
  }
  return value;
}

function parseArtifact(
  value: unknown,
  path: string
): CalibrationArtifactReference {
  const record = requireRecord(value, path, ["id", "checksumSha256"]);
  const id = requireString(record, "id", path);
  const checksumSha256 = requireString(
    record,
    "checksumSha256",
    path
  );
  if (!/^[a-f0-9]{64}$/iu.test(checksumSha256)) {
    throw new InvalidConfigurationError(
      `${path}.checksumSha256 must be a 64-character SHA-256 hex digest.`
    );
  }
  return { id, checksumSha256: checksumSha256.toLowerCase() };
}

function parseUncertainty(
  value: unknown,
  path: string
): RadiometryUncertaintyDeclaration {
  const record = requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", { ...UNCERTAINTY_VARIANT_FIELDS, absolute: ["kind", "plusMinus", "unit", "basis"] }, path);
  const kind = requireString(record, "kind", path);

  if (kind === "relative") {
    const fraction = record.fraction;
    if (
      typeof fraction !== "number" ||
      !Number.isFinite(fraction) ||
      fraction < 0
    ) {
      throw new InvalidConfigurationError(
        `${path}.fraction must be finite and greater than or equal to zero.`
      );
    }
    return {
      kind,
      fraction,
      basis: requireString(record, "basis", path)
    };
  }

  if (kind === "absolute") {
    const plusMinus = record.plusMinus;
    if (
      typeof plusMinus !== "number" ||
      !Number.isFinite(plusMinus) ||
      plusMinus < 0
    ) {
      throw new InvalidConfigurationError(
        `${path}.plusMinus must be finite and greater than or equal to zero.`
      );
    }
    return {
      kind,
      plusMinus,
      unit: requireString(record, "unit", path),
      basis: requireString(record, "basis", path)
    };
  }

  if (kind === "not-quantified") {
    return {
      kind,
      limitation: requireString(record, "limitation", path)
    };
  }

  throw new InvalidConfigurationError(`${path}.kind is invalid.`);
}

function parseBase(
  record: UnknownRecord,
  path: string
): Omit<RadiometryRequirementBase, "requirement"> {
  const scientificStatus = requireString(
    record,
    "scientificStatus",
    path
  );
  if (
    !SCIENTIFIC_STATUSES.has(
      scientificStatus as RadiometryScientificStatus
    )
  ) {
    throw new InvalidConfigurationError(
      `${path}.scientificStatus is invalid.`
    );
  }

  return {
    scientificStatus:
      scientificStatus as RadiometryScientificStatus,
    modelId: requireString(record, "modelId", path),
    modelVersion: requireString(record, "modelVersion", path),
    evidence: parseEvidenceList(record.evidence, `${path}.evidence`),
    uncertainty: parseUncertainty(
      record.uncertainty,
      `${path}.uncertainty`
    )
  };
}

function requireApproximationStatus(
  base: Omit<RadiometryRequirementBase, "requirement">,
  path: string,
  representation: string
): void {
  if (base.scientificStatus !== "approximation") {
    throw new InvalidConfigurationError(
      `${path} uses inherently approximate representation "${representation}" and must declare scientificStatus "approximation".`
    );
  }
}

function parseRequirement(
  value: unknown,
  path: string
): RadiometryRequirement {
  const record = requireRecord(value, path, ["requirement", "scientificStatus", "modelId", "modelVersion", "evidence", "uncertainty", "representation", "dataArtifact", "tStop", "areaModel", "geometricPitchXMicrometers", "geometricPitchYMicrometers", "effectiveCollectionAreaSquareMicrometers", "geometricCellAreaSquareMicrometers", "fillFactor", "integrationModel", "responseRepresentation", "effectiveQuantumEfficiency"]);
  const requirement = requireString(record, "requirement", path);
  if (!REQUIREMENT_IDS.has(requirement as RadiometryRequirementId)) {
    throw new InvalidConfigurationError(
      `${path}.requirement is invalid.`
    );
  }

  const base = parseBase(record, path);

  if (requirement === "scene-spectral-radiance") {
    const representation = requireString(
      record,
      "representation",
      path
    );
    if (
      representation !== "spectral-data" &&
      representation !== "documented-spectral-approximation"
    ) {
      throw new InvalidConfigurationError(
        `${path}.representation is invalid.`
      );
    }
    if (representation === "documented-spectral-approximation") {
      requireApproximationStatus(base, path, representation);
    }
    return {
      requirement,
      ...base,
      representation,
      dataArtifact: parseArtifact(
        record.dataArtifact,
        `${path}.dataArtifact`
      )
    };
  }

  if (requirement === "optical-transmission") {
    const representation = requireString(
      record,
      "representation",
      path
    );
    if (representation === "spectral-data") {
      return {
        requirement,
        ...base,
        representation,
        dataArtifact: parseArtifact(
          record.dataArtifact,
          `${path}.dataArtifact`
        )
      };
    }
    if (representation === "t-stop-approximation") {
      requireApproximationStatus(base, path, representation);
      return {
        requirement,
        ...base,
        representation,
        tStop: requirePositiveNumber(record, "tStop", path)
      };
    }
    throw new InvalidConfigurationError(
      `${path}.representation is invalid.`
    );
  }

  if (requirement === "pupil-vignetting") {
    const representation = requireString(
      record,
      "representation",
      path
    );
    if (representation === "spatial-data") {
      return {
        requirement,
        ...base,
        representation,
        dataArtifact: parseArtifact(
          record.dataArtifact,
          `${path}.dataArtifact`
        )
      };
    }
    if (representation === "documented-approximation") {
      requireApproximationStatus(base, path, representation);
      return { requirement, ...base, representation };
    }
    throw new InvalidConfigurationError(
      `${path}.representation is invalid.`
    );
  }

  if (requirement === "photosite-collection-area") {
    if (
      record.areaModel === undefined &&
      (record.geometricPitchXMicrometers !== undefined ||
        record.geometricPitchYMicrometers !== undefined)
    ) {
      throw new InvalidConfigurationError(
        `${path}.areaModel is required. Geometric sample pitch alone is not a photosite collection-area model.`
      );
    }
    const areaModel = requireString(record, "areaModel", path);
    if (areaModel === "effective-collection-area") {
      return {
        requirement,
        ...base,
        areaModel,
        effectiveCollectionAreaSquareMicrometers:
          requirePositiveNumber(
            record,
            "effectiveCollectionAreaSquareMicrometers",
            path
          )
      };
    }
    if (areaModel === "geometric-area-times-fill-factor") {
      return {
        requirement,
        ...base,
        areaModel,
        geometricCellAreaSquareMicrometers:
          requirePositiveNumber(
            record,
            "geometricCellAreaSquareMicrometers",
            path
          ),
        fillFactor: requireFraction(
          record,
          "fillFactor",
          path,
          false
        )
      };
    }
    throw new InvalidConfigurationError(
      `${path}.areaModel is invalid. Geometric sample pitch alone is not a photosite collection-area model.`
    );
  }

  if (requirement === "exposure-integration") {
    const integrationModel = requireString(
      record,
      "integrationModel",
      path
    );
    if (integrationModel === "uniform-boxcar") {
      return { requirement, ...base, integrationModel };
    }
    if (integrationModel === "documented-shutter-function") {
      return {
        requirement,
        ...base,
        integrationModel,
        dataArtifact: parseArtifact(
          record.dataArtifact,
          `${path}.dataArtifact`
        )
      };
    }
    throw new InvalidConfigurationError(
      `${path}.integrationModel is invalid.`
    );
  }

  const responseRepresentation = requireString(
    record,
    "responseRepresentation",
    path
  );
  if (responseRepresentation === "spectral-quantum-efficiency") {
    return {
      requirement: "sensor-response",
      ...base,
      responseRepresentation,
      dataArtifact: parseArtifact(
        record.dataArtifact,
        `${path}.dataArtifact`
      )
    };
  }
  if (responseRepresentation === "effective-qe-approximation") {
    requireApproximationStatus(base, path, responseRepresentation);
    return {
      requirement: "sensor-response",
      ...base,
      responseRepresentation,
      effectiveQuantumEfficiency: requireFraction(
        record,
        "effectiveQuantumEfficiency",
        path,
        true
      )
    };
  }
  throw new InvalidConfigurationError(
    `${path}.responseRepresentation is invalid.`
  );
}

/**
 * Parses untrusted metadata about radiometry prerequisites.
 *
 * It checks structure and provenance. It cannot prove that a cited calibration
 * or evidence claim is scientifically true.
 */
export function parseRadiometryReadinessProfile(
  value: unknown
): RadiometryReadinessProfile {
  const profile = requireRecord(value, "radiometryReadiness", ["schemaVersion", "components"]);
  if (profile.schemaVersion !== "0.1.0") {
    throw new InvalidConfigurationError(
      'radiometryReadiness.schemaVersion must be "0.1.0".'
    );
  }
  if (!Array.isArray(profile.components)) {
    throw new InvalidConfigurationError(
      "radiometryReadiness.components must be an array."
    );
  }

  const components = profile.components.map((component, index) =>
    parseRequirement(
      component,
      `radiometryReadiness.components[${index}]`
    )
  );
  const ids = components.map((component) => component.requirement);
  if (new Set(ids).size !== ids.length) {
    throw new InvalidConfigurationError(
      "radiometryReadiness.components must not contain duplicate requirement IDs."
    );
  }

  return {
    schemaVersion: "0.1.0",
    components
  };
}

/**
 * Checks whether the declared prerequisites are enough for a nominal photon
 * estimate and, separately, for a calibrated photon claim.
 *
 * It does not switch on composed photon or noise output.
 */
export function assessRadiometryReadiness(
  profile: RadiometryReadinessProfile
): RadiometryReadinessAssessment {
  const validatedProfile = parseRadiometryReadinessProfile(profile);
  const byId = new Map(
    validatedProfile.components.map((component) => [
      component.requirement,
      component
    ])
  );
  const missingRequirements = REQUIRED_REQUIREMENTS.filter(
    (requirement) => !byId.has(requirement)
  );
  const approximateRequirements = validatedProfile.components
    .filter(
      (component) =>
        component.scientificStatus === "approximation"
    )
    .map((component) => component.requirement);
  const unquantifiedUncertaintyRequirements = validatedProfile.components
    .filter(
      (component) =>
        component.uncertainty.kind === "not-quantified"
    )
    .map((component) => component.requirement);

  const nominalPhotonEstimateReady = missingRequirements.length === 0;
  const calibratedPhotonClaimReady =
    nominalPhotonEstimateReady &&
    approximateRequirements.length === 0 &&
    unquantifiedUncertaintyRequirements.length === 0;

  return {
    status: !nominalPhotonEstimateReady
      ? "not-ready"
      : calibratedPhotonClaimReady
        ? "calibrated-ready"
        : "approximate-only",
    nominalPhotonEstimateReady,
    calibratedPhotonClaimReady,
    missingRequirements,
    approximateRequirements,
    unquantifiedUncertaintyRequirements,
    composedPhotonOutputEnabled: false
  };
}
