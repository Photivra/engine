// SPDX-License-Identifier: Apache-2.0

/**
 * Response application compatibility: checks that a measured sensor response can be applied to this
 * light input.
 *
 * It checks the exact profile and channel, the plane where the input light is measured (source
 * plane), the area the response refers to, spatial uniformity and the reference conditions of the
 * measurement. Passing this check alone does not allow converting light to signal. The per-bin
 * operating-range check and the EQE or A/W conversion are separate steps.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type {
  SensorSpectralReferenceConditions,
  SensorSpectralResponseScientificStatus
} from "./spectral-response.js";
import type {
  SensorSpatioSpectralIrradianceReduction
} from "./spatio-spectral-reduction.js";
import { requireInputObject, requireInputKeys, rejectUnknownVariantFields, requireConfigRecord as requireRecord, requireConfigString as requireNonEmptyString, requireConfigPositiveFinite as requirePositiveFinite } from "../core/record-validation.js";

const AREA_TOLERANCE = 1e-10;

export type SensorResponseSourcePlane =
  | "sensor-package-incident"
  | "site-incident";

export type SensorResponseIncidentAreaBasis =
  | {
      kind: "geometric-sensitive-aperture";
      areaSquareMicrometers: number;
    }
  | {
      kind: "full-site-cell";
      areaSquareMicrometers: number;
    }
  | {
      kind: "effective-collection-area";
      areaSquareMicrometers: number;
    };

export type SensorResponseSpatialModel =
  | {
      kind:
        "uniform-over-geometric-sensitive-aperture";
      scientificStatus:
        SensorSpectralResponseScientificStatus;
      evidence: readonly EvidenceProvenance[];
      limitation?: string;
    }
  | {
      kind: "not-established";
      limitation: string;
    };

export type SensorResponseReferenceConditionPolicy =
  | {
      kind: "exact-match-required";
    }
  | {
      kind: "assume-compatible";
      limitation: string;
      evidence: readonly EvidenceProvenance[];
    };

export interface SensorResponseApplicationProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  spectralResponseProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  samplingApertureProfileId: string;
  opticalStackProfileId: string;
  evidence: readonly EvidenceProvenance[];
  incidentAreaBasis:
    SensorResponseIncidentAreaBasis;
  spatialResponseModel:
    SensorResponseSpatialModel;
  referenceConditionPolicy:
    SensorResponseReferenceConditionPolicy;
}

export interface SourcedSensorResponseSourcePlane {
  value: SensorResponseSourcePlane;
  evidence: readonly EvidenceProvenance[];
}

export interface AssessSensorResponseApplicationCompatibilityInput {
  reduction:
    SensorSpatioSpectralIrradianceReduction;
  applicationProfile:
    SensorResponseApplicationProfile;
  sourcePlane:
    SourcedSensorResponseSourcePlane;
  operatingConditions?:
    SensorSpectralReferenceConditions;
}

export type SensorResponseApplicationCompatibilityBlocker =
  | "spectral-response-profile-id-mismatch"
  | "color-sampling-profile-id-mismatch"
  | "channel-id-mismatch"
  | "sampling-aperture-profile-id-missing"
  | "sampling-aperture-profile-id-mismatch"
  | "optical-stack-profile-id-missing"
  | "optical-stack-profile-id-mismatch"
  | "source-plane-mismatch"
  | "wavelength-basis-unresolved"
  | "incident-area-basis-not-currently-integrated"
  | "incident-area-mismatch"
  | "spatial-response-uniformity-not-established"
  | "response-reference-conditions-not-declared"
  | "operating-conditions-not-declared"
  | "operating-conditions-mismatch";

export type SensorResponseSignalPath =
  | "photon-rate-to-electrons"
  | "radiant-power-to-current";

export interface SensorResponseApplicationCompatibilityAssessment {
  applicationProfileId: string;
  spectralResponseProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  responseScope:
    SensorSpatioSpectralIrradianceReduction["responseScope"];
  requiredSourcePlane:
    SensorResponseSourcePlane;
  suppliedSourcePlane:
    SensorResponseSourcePlane;
  sourcePlaneMatched: boolean;
  responseIncidentAreaBasis:
    SensorResponseIncidentAreaBasis;
  currentlyIntegratedAreaBasis:
    "geometric-sensitive-aperture";
  geometricApertureAreaSquareMicrometers:
    number;
  nominalSiteCellAreaSquareMicrometers?:
    number;
  spatialResponseModel:
    SensorResponseSpatialModel;
  referenceConditionPolicy:
    SensorResponseReferenceConditionPolicy;
  responseReferenceConditions?:
    SensorSpectralReferenceConditions;
  operatingConditions?:
    SensorSpectralReferenceConditions;
  structuralCompatibilityEstablished:
    boolean;
  compatibilityStatus:
    | "compatible"
    | "compatible-approximation"
    | "blocked";
  blockers:
    readonly SensorResponseApplicationCompatibilityBlocker[];
  requiredSignalPath:
    SensorResponseSignalPath;
  quantifiedResponseUncertaintyAvailable:
    boolean;
  responseApplicationPerformed: false;
  signalConversionAuthorized: false;
  temporalIntegrationAuthorized: false;
  photonConversionPerformed: false;
  electronConversionPerformed: false;
  currentConversionPerformed: false;
  operatingRangeCompatibilityAssessed: false;
  spatiallyVaryingResponseSupported: false;
  componentEvidence: {
    applicationProfile:
      readonly EvidenceProvenance[];
    sourcePlane:
      readonly EvidenceProvenance[];
    spatialResponse:
      readonly EvidenceProvenance[];
    referenceConditionAssumption:
      readonly EvidenceProvenance[];
    response:
      SensorSpatioSpectralIrradianceReduction["componentEvidence"]["spectral"];
  };
}

function parseIncidentAreaBasis(
  value: unknown,
  path: string
): SensorResponseIncidentAreaBasis {
  const record =
    requireRecord(value, path, ["areaSquareMicrometers", "kind"]);
  const areaSquareMicrometers =
    requirePositiveFinite(
      record.areaSquareMicrometers,
      path + ".areaSquareMicrometers"
    );

  if (
    record.kind !==
      "geometric-sensitive-aperture" &&
    record.kind !== "full-site-cell" &&
    record.kind !==
      "effective-collection-area"
  ) {
    throw new InvalidConfigurationError(
      path + ".kind is invalid."
    );
  }

  return {
    kind: record.kind,
    areaSquareMicrometers
  };
}

function parseSpatialResponseModel(
  value: unknown,
  path: string
): SensorResponseSpatialModel {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", { "not-established": ["kind", "limitation"], "uniform-over-geometric-sensitive-aperture": ["kind", "scientificStatus", "evidence", "limitation"] }, path);

  if (
    record.kind === "not-established"
  ) {
    return {
      kind: "not-established",
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      )
    };
  }

  if (
    record.kind !==
    "uniform-over-geometric-sensitive-aperture"
  ) {
    throw new InvalidConfigurationError(
      path + ".kind is invalid."
    );
  }

  if (
    record.scientificStatus !==
      "calibrated" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      path +
        ".scientificStatus is invalid."
    );
  }

  const limitation =
    record.limitation === undefined
      ? undefined
      : requireNonEmptyString(
          record.limitation,
          path + ".limitation"
        );

  if (
    record.scientificStatus ===
      "approximation" &&
    limitation === undefined
  ) {
    throw new InvalidConfigurationError(
      path +
        ".limitation is required for an approximation."
    );
  }

  return {
    kind:
      "uniform-over-geometric-sensitive-aperture",
    scientificStatus:
      record.scientificStatus,
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    ),
    ...(limitation === undefined
      ? {}
      : { limitation })
  };
}

export function parseReferenceConditionPolicy(
  value: unknown,
  path: string
): SensorResponseReferenceConditionPolicy {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", { "exact-match-required": ["kind"], "assume-compatible": ["kind", "limitation", "evidence"] }, path);

  if (
    record.kind ===
    "exact-match-required"
  ) {
    return {
      kind: "exact-match-required"
    };
  }

  if (
    record.kind === "assume-compatible"
  ) {
    return {
      kind: "assume-compatible",
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      ),
      evidence: parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The profile states the source plane, incident-area basis, spatial uniformity and reference
 * conditions under which a response applies.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseSensorResponseApplicationProfile(
  value: unknown
): SensorResponseApplicationProfile {
  const record = requireRecord(
    value,
    "sensorResponseApplication", ["schemaVersion", "profileId", "spectralResponseProfileId", "colorSamplingProfileId", "channelId", "samplingApertureProfileId", "opticalStackProfileId", "evidence", "incidentAreaBasis", "spatialResponseModel", "referenceConditionPolicy"]
  );

  if (
    record.schemaVersion !== "0.1.0"
  ) {
    throw new InvalidConfigurationError(
      'sensorResponseApplication.schemaVersion must be "0.1.0".'
    );
  }

  return {
    schemaVersion: "0.1.0",
    profileId: requireNonEmptyString(
      record.profileId,
      "sensorResponseApplication.profileId"
    ),
    spectralResponseProfileId:
      requireNonEmptyString(
        record.spectralResponseProfileId,
        "sensorResponseApplication.spectralResponseProfileId"
      ),
    colorSamplingProfileId:
      requireNonEmptyString(
        record.colorSamplingProfileId,
        "sensorResponseApplication.colorSamplingProfileId"
      ),
    channelId: requireNonEmptyString(
      record.channelId,
      "sensorResponseApplication.channelId"
    ),
    samplingApertureProfileId:
      requireNonEmptyString(
        record.samplingApertureProfileId,
        "sensorResponseApplication.samplingApertureProfileId"
      ),
    opticalStackProfileId:
      requireNonEmptyString(
        record.opticalStackProfileId,
        "sensorResponseApplication.opticalStackProfileId"
      ),
    evidence: parseEvidenceList(
      record.evidence,
      "sensorResponseApplication.evidence"
    ),
    incidentAreaBasis:
      parseIncidentAreaBasis(
        record.incidentAreaBasis,
        "sensorResponseApplication.incidentAreaBasis"
      ),
    spatialResponseModel:
      parseSpatialResponseModel(
        record.spatialResponseModel,
        "sensorResponseApplication.spatialResponseModel"
      ),
    referenceConditionPolicy:
      parseReferenceConditionPolicy(
        record.referenceConditionPolicy,
        "sensorResponseApplication.referenceConditionPolicy"
      )
  };
}

function parseSourcePlane(
  value:
    SourcedSensorResponseSourcePlane
): SourcedSensorResponseSourcePlane {
  const record = requireRecord(
    value,
    "sourcePlane", ["value", "evidence"]
  );
  if (
    record.value !==
      "sensor-package-incident" &&
    record.value !== "site-incident"
  ) {
    throw new InvalidConfigurationError(
      "sourcePlane.value is invalid."
    );
  }
  return {
    value: record.value,
    evidence: parseEvidenceList(
      record.evidence,
      "sourcePlane.evidence"
    )
  };
}

function requiredSourcePlane(
  scope:
    SensorSpatioSpectralIrradianceReduction["responseScope"]
): SensorResponseSourcePlane {
  return scope ===
    "sensor-package-incident-effective-channel-response"
    ? "sensor-package-incident"
    : "site-incident";
}

function approximatelyEqual(
  actual: number,
  expected: number
): boolean {
  const scale = Math.max(
    1,
    Math.abs(actual),
    Math.abs(expected)
  );
  return (
    Math.abs(actual - expected) <=
    AREA_TOLERANCE * scale
  );
}

export function conditionsMatch(
  reference:
    SensorSpectralReferenceConditions,
  operating:
    SensorSpectralReferenceConditions
): boolean {
  if (
    reference.temperatureC !==
      undefined &&
    operating.temperatureC !==
      reference.temperatureC
  ) {
    return false;
  }
  if (
    reference
      .incidenceAngleDegreesFromNormal !==
      undefined &&
    operating
      .incidenceAngleDegreesFromNormal !==
      reference
        .incidenceAngleDegreesFromNormal
  ) {
    return false;
  }
  if (
    reference.polarization !==
      undefined &&
    operating.polarization !==
      reference.polarization
  ) {
    return false;
  }
  return true;
}

function validateReductionBoundary(
  reduction:
    SensorSpatioSpectralIrradianceReduction
): number {
  requireInputObject(reduction, "reduction input");
  if (
    reduction.outputMeaning !==
      "pre-response-spatio-spectral-radiometric-reduction" ||
    reduction
      .spectralResponseApplicationPerformed !==
      false ||
    reduction.quantumEfficiencyApplied !==
      false ||
    reduction.spectralResponsivityApplied !==
      false ||
    reduction.temporalIntegrationApplied !==
      false
  ) {
    throw new InvalidScientificInputError(
      "reduction must remain a pre-response, pre-temporal spatio-spectral result."
    );
  }

  if (
    typeof reduction
      .geometricApertureAreaSquareMicrometers !==
      "number" ||
    !Number.isFinite(
      reduction
        .geometricApertureAreaSquareMicrometers
    ) ||
    reduction
      .geometricApertureAreaSquareMicrometers <=
      0
  ) {
    throw new InvalidScientificInputError(
      "reduction.geometricApertureAreaSquareMicrometers is required and must be positive."
    );
  }

  return reduction
    .geometricApertureAreaSquareMicrometers;
}

/**
 * Checks whether the source plane, area, profile, channel and reference conditions allow the
 * selected way of applying the response.
 *
 * Passing this alone does not allow converting light to signal. The per-bin operating-range check
 * and the EQE or A/W conversion are separate steps.
 * @param input - The input; see `AssessSensorResponseApplicationCompatibilityInput` for its fields, units and coordinates.
 * @returns The assessment. Read its structured blockers before acting on an authorization.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function assessSensorResponseApplicationCompatibility(
  input:
    AssessSensorResponseApplicationCompatibilityInput
): CalculationResult<SensorResponseApplicationCompatibilityAssessment> {
  requireInputKeys(input, "assessSensorResponseApplicationCompatibility", ["reduction", "applicationProfile", "sourcePlane", "operatingConditions"]);
  const geometricArea =
    validateReductionBoundary(
      input.reduction
    );
  const profile =
    parseSensorResponseApplicationProfile(
      input.applicationProfile
    );
  const sourcePlane =
    parseSourcePlane(input.sourcePlane);
  const blockers:
    SensorResponseApplicationCompatibilityBlocker[] =
      [];

  if (
    profile.spectralResponseProfileId !==
    input.reduction.responseProfileId
  ) {
    blockers.push(
      "spectral-response-profile-id-mismatch"
    );
  }
  if (
    profile.colorSamplingProfileId !==
    input.reduction
      .colorSamplingProfileId
  ) {
    blockers.push(
      "color-sampling-profile-id-mismatch"
    );
  }
  if (
    profile.channelId !==
    input.reduction.channelId
  ) {
    blockers.push(
      "channel-id-mismatch"
    );
  }

  const samplingApertureProfileId =
    input.reduction
      .samplingApertureProfileId;
  if (
    samplingApertureProfileId ===
    undefined
  ) {
    blockers.push(
      "sampling-aperture-profile-id-missing"
    );
  } else if (
    samplingApertureProfileId !==
    profile.samplingApertureProfileId
  ) {
    blockers.push(
      "sampling-aperture-profile-id-mismatch"
    );
  }

  const opticalStackProfileId =
    input.reduction
      .opticalStackProfileId;
  if (
    opticalStackProfileId === undefined
  ) {
    blockers.push(
      "optical-stack-profile-id-missing"
    );
  } else if (
    opticalStackProfileId !==
    profile.opticalStackProfileId
  ) {
    blockers.push(
      "optical-stack-profile-id-mismatch"
    );
  }

  const requiredPlane =
    requiredSourcePlane(
      input.reduction.responseScope
    );
  const sourcePlaneMatched =
    sourcePlane.value === requiredPlane;
  if (!sourcePlaneMatched) {
    blockers.push(
      "source-plane-mismatch"
    );
  }

  if (
    !input.reduction
      .wavelengthBasisResolved
  ) {
    blockers.push(
      "wavelength-basis-unresolved"
    );
  }

  if (
    profile.incidentAreaBasis.kind !==
    "geometric-sensitive-aperture"
  ) {
    blockers.push(
      "incident-area-basis-not-currently-integrated"
    );
  } else if (
    !approximatelyEqual(
      profile.incidentAreaBasis
        .areaSquareMicrometers,
      geometricArea
    )
  ) {
    blockers.push(
      "incident-area-mismatch"
    );
  }

  if (
    profile.spatialResponseModel.kind ===
    "not-established"
  ) {
    blockers.push(
      "spatial-response-uniformity-not-established"
    );
  }

  if (
    profile.referenceConditionPolicy.kind ===
    "exact-match-required"
  ) {
    const referenceConditions =
      input.reduction
        .responseReferenceConditions;
    if (
      referenceConditions === undefined
    ) {
      blockers.push(
        "response-reference-conditions-not-declared"
      );
    } else if (
      input.operatingConditions ===
      undefined
    ) {
      blockers.push(
        "operating-conditions-not-declared"
      );
    } else if (
      !conditionsMatch(
        referenceConditions,
        input.operatingConditions
      )
    ) {
      blockers.push(
        "operating-conditions-mismatch"
      );
    }
  }

  const structurallyCompatible =
    blockers.length === 0;

  const approximation =
    input.reduction
      .responseScientificStatus ===
      "approximation" ||
    (
      profile.spatialResponseModel.kind ===
        "uniform-over-geometric-sensitive-aperture" &&
      profile.spatialResponseModel
        .scientificStatus ===
        "approximation"
    ) ||
    profile.referenceConditionPolicy.kind ===
      "assume-compatible";

  const compatibilityStatus =
    structurallyCompatible
      ? approximation
        ? "compatible-approximation"
        : "compatible"
      : "blocked";

  const spatialEvidence =
    profile.spatialResponseModel.kind ===
      "uniform-over-geometric-sensitive-aperture"
      ? profile.spatialResponseModel.evidence
      : [];
  const referenceConditionEvidence =
    profile.referenceConditionPolicy.kind ===
      "assume-compatible"
      ? profile.referenceConditionPolicy
          .evidence
      : [];

  return calculatedResult(
    {
      applicationProfileId:
        profile.profileId,
      spectralResponseProfileId:
        input.reduction
          .responseProfileId,
      colorSamplingProfileId:
        input.reduction
          .colorSamplingProfileId,
      channelId:
        input.reduction.channelId,
      responseScope:
        input.reduction.responseScope,
      requiredSourcePlane:
        requiredPlane,
      suppliedSourcePlane:
        sourcePlane.value,
      sourcePlaneMatched,
      responseIncidentAreaBasis:
        profile.incidentAreaBasis,
      currentlyIntegratedAreaBasis:
        "geometric-sensitive-aperture",
      geometricApertureAreaSquareMicrometers:
        geometricArea,
      ...(input.reduction
        .nominalSiteCellAreaSquareMicrometers ===
      undefined
        ? {}
        : {
            nominalSiteCellAreaSquareMicrometers:
              input.reduction
                .nominalSiteCellAreaSquareMicrometers
          }),
      spatialResponseModel:
        profile.spatialResponseModel,
      referenceConditionPolicy:
        profile.referenceConditionPolicy,
      ...(input.reduction
        .responseReferenceConditions ===
      undefined
        ? {}
        : {
            responseReferenceConditions:
              input.reduction
                .responseReferenceConditions
          }),
      ...(input.operatingConditions ===
      undefined
        ? {}
        : {
            operatingConditions:
              input.operatingConditions
          }),
      structuralCompatibilityEstablished:
        structurallyCompatible,
      compatibilityStatus,
      blockers,
      requiredSignalPath:
        input.reduction
          .sourceResponseKind ===
        "effective-spectral-responsivity"
          ? "radiant-power-to-current"
          : "photon-rate-to-electrons",
      quantifiedResponseUncertaintyAvailable:
        input.reduction
          .responseUncertainty.kind ===
        "relative",
      responseApplicationPerformed:
        false,
      signalConversionAuthorized:
        false,
      temporalIntegrationAuthorized:
        false,
      photonConversionPerformed:
        false,
      electronConversionPerformed:
        false,
      currentConversionPerformed:
        false,
      operatingRangeCompatibilityAssessed:
        false,
      spatiallyVaryingResponseSupported:
        false,
      componentEvidence: {
        applicationProfile:
          profile.evidence,
        sourcePlane:
          sourcePlane.evidence,
        spatialResponse:
          spatialEvidence,
        referenceConditionAssumption:
          referenceConditionEvidence,
        response:
          input.reduction
            .componentEvidence.spectral
      }
    },
    "sensor-response-application-compatibility",
    "1.0.0",
    [
      "This result is a structural compatibility gate only; it never authorizes or performs sensor-response signal conversion.",
      "Response reference plane is derived from responseScope. Package-incident and site-incident inputs are not interchangeable.",
      "The current spatio-spectral reducer integrates the geometric sensitive aperture only. Full-site-cell and effective-collection-area response normalizations remain blocked until matching radiometric integrations exist.",
      "A scalar wavelength-only response may be applied after spatial reduction only when uniform/separable response over the integrated geometric aperture is explicitly established or declared as an approximation.",
      "Exact reference-condition matching is required when that policy is selected because temperature, incidence-angle and polarization dependence are not modeled.",
      "An unresolved wavelength basis is incompatible with physical response application.",
      "Typical total-pixel QE definitions can include fill factor and microlens effects; they must not be applied to geometric-sensitive-aperture flux unless the response normalization explicitly matches that area basis.",
      "Response linearity/dynamic-range validity is not assessed by this gate and remains required before a future conversion can claim calibrated applicability.",
      "EQE/filter×EQE responses require a future photon-rate→electron path; A/W responsivity requires a separate radiant-power→current path.",
      "Temporal integration, photons/electrons/current, noise, saturation, ADC/RAW conversion and reconstruction remain downstream."
    ]
  );
}
