// SPDX-License-Identifier: Apache-2.0

/**
 * Response operating range: checks that the light input is inside the range where the measured
 * sensor response is valid (linear within a declared criterion).
 *
 * It keeps incident power and irradiance distinct, and respects wavelength coverage, reference
 * conditions and the declared non-linearity criterion. Converting each spectral bin needs that bin to
 * be in range and needs spatial linear superposition (the response to a sum of inputs is the sum of
 * the responses). A valid average must not hide a part of the aperture that is too bright.
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
  SensorResponseApplicationCompatibilityAssessment,
  SensorResponseReferenceConditionPolicy,
  SensorResponseSignalPath
} from "./response-application-compatibility.js";
import type {
  SensorSpectralReferenceConditions,
  SensorSpectralResponseScientificStatus,
  SensorSpectralResponseUncertainty,
  SpectralWavelengthBasis
} from "./spectral-response.js";
import type {
  SensorSpatioSpectralIrradianceReduction
} from "./spatio-spectral-reduction.js";
import { requireInputObject, requireInputKeys, rejectUnknownVariantFields, UNCERTAINTY_VARIANT_FIELDS, requireConfigRecord as requireRecord, requireConfigString as requireNonEmptyString, requireConfigPositiveFinite as requirePositiveFinite, requireConfigNonNegativeFinite as requireFiniteNonNegative } from "../core/record-validation.js";
import { parseReferenceConditionPolicy, conditionsMatch } from "./response-application-compatibility.js";

export type SensorResponseOperatingInputRange =
  | {
      kind:
        "wavelength-integrated-geometric-aperture-radiant-power";
      unit: "W";
      minimumInclusive: number;
      maximumInclusive: number;
    }
  | {
      kind:
        "wavelength-integrated-spatial-average-irradiance";
      unit: "W/m^2";
      minimumInclusive: number;
      maximumInclusive: number;
    };

export interface SensorResponseOperatingWavelengthApplicability {
  wavelengthBasis:
    Exclude<SpectralWavelengthBasis, "unspecified">;
  minimumNanometers: number;
  maximumNanometers: number;
  containment:
    "requested-range-must-be-contained";
}

export interface SensorResponseLinearityCriterion {
  maximumAbsoluteRelativeDeviation: number;
}

export type SensorResponseOperatingSpectralInputModel =
  | {
      kind: "broadband-integrated-only";
    }
  | {
      kind: "per-spectral-bin";
      maximumBinWidthNanometers: number;
      scientificStatus:
        SensorSpectralResponseScientificStatus;
      evidence: readonly EvidenceProvenance[];
      limitation?: string;
    };

export type SensorResponseOperatingSpatialLinearityModel =
  | {
      kind:
        "linear-superposition-over-geometric-aperture";
      scientificStatus:
        SensorSpectralResponseScientificStatus;
      evidence: readonly EvidenceProvenance[];
      limitation?: string;
    }
  | {
      kind: "not-established";
      limitation: string;
    };

export interface SensorResponseOperatingRangeProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  responseApplicationProfileId: string;
  spectralResponseProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  evidence: readonly EvidenceProvenance[];
  inputRange:
    SensorResponseOperatingInputRange;
  wavelengthApplicability:
    SensorResponseOperatingWavelengthApplicability;
  linearityCriterion:
    SensorResponseLinearityCriterion;
  /**
   * Optional for backward compatibility. If omitted, it parses as "not
   * established", which blocks new response-rate conversions.
   */
  spatialLinearityModel?:
    SensorResponseOperatingSpatialLinearityModel;
  /**
   * Optional for backward compatibility. If omitted, the calibration only
   * establishes an operating range for broadband (wavelength-integrated) input,
   * and cannot allow wavelength-by-wavelength response conversion.
   */
  spectralInputModel?:
    SensorResponseOperatingSpectralInputModel;
  referenceConditions?:
    SensorSpectralReferenceConditions;
  referenceConditionPolicy:
    SensorResponseReferenceConditionPolicy;
}

export interface AssessSensorResponseOperatingRangeInput {
  reduction:
    SensorSpatioSpectralIrradianceReduction;
  compatibility:
    SensorResponseApplicationCompatibilityAssessment;
  operatingRangeProfile:
    SensorResponseOperatingRangeProfile;
}

export type SensorResponseOperatingRangeBlocker =
  | "structural-compatibility-not-established"
  | "response-application-profile-id-mismatch"
  | "spectral-response-profile-id-mismatch"
  | "color-sampling-profile-id-mismatch"
  | "channel-id-mismatch"
  | "wavelength-basis-unresolved"
  | "wavelength-basis-mismatch"
  | "wavelength-range-outside-linearity-applicability"
  | "input-below-linearity-range"
  | "input-above-linearity-range"
  | "spectral-bin-width-outside-linearity-applicability"
  | "spectral-bin-input-below-linearity-range"
  | "spectral-bin-input-above-linearity-range"
  | "spatial-linearity-superposition-not-established"
  | "operating-conditions-not-declared"
  | "linearity-operating-conditions-mismatch";

export interface SensorResponseOperatingRangeAssessment {
  operatingRangeProfileId: string;
  responseApplicationProfileId: string;
  spectralResponseProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  requiredSignalPath:
    SensorResponseSignalPath;
  inputRange:
    SensorResponseOperatingInputRange;
  evaluatedInput: {
    kind:
      SensorResponseOperatingInputRange["kind"];
    unit:
      SensorResponseOperatingInputRange["unit"];
    value: number;
  };
  wavelengthApplicability:
    SensorResponseOperatingWavelengthApplicability;
  evaluatedWavelengthRangeNanometers: {
    minimum: number;
    maximum: number;
  };
  linearityCriterion:
    SensorResponseLinearityCriterion;
  spectralInputModel:
    SensorResponseOperatingSpectralInputModel;
  evaluatedSpectralNodeInputs?:
    readonly {
      spectralSampleIndex: number;
      wavelengthNanometers: number;
      wavelengthMeasureNanometers: number;
      kind:
        SensorResponseOperatingInputRange["kind"];
      unit:
        SensorResponseOperatingInputRange["unit"];
      value: number;
    }[];
  spectralNodeRangeCompatibilityAssessed:
    boolean;
  spatialLinearityModel:
    SensorResponseOperatingSpatialLinearityModel;
  referenceConditionPolicy:
    SensorResponseReferenceConditionPolicy;
  referenceConditions?:
    SensorSpectralReferenceConditions;
  operatingConditions?:
    SensorSpectralReferenceConditions;
  operatingRangeCompatibilityAssessed: true;
  instantaneousResponseRangeCompatible: boolean;
  status:
    | "broadband-range-compatible"
    | "broadband-range-compatible-approximation"
    | "rate-conversion-authorized"
    | "rate-conversion-authorized-approximation"
    | "blocked";
  blockers:
    readonly SensorResponseOperatingRangeBlocker[];
  responseRateConversionAuthorized: boolean;
  responseApplicationPerformed: false;
  temporalIntegrationAuthorized: false;
  exposureDomainLinearityAssessed: false;
  accumulatedChargeLinearityAssessed: false;
  saturationAssessed: false;
  photonConversionPerformed: false;
  electronConversionPerformed: false;
  currentConversionPerformed: false;
  componentEvidence: {
    operatingRange:
      readonly EvidenceProvenance[];
    referenceConditionAssumption:
      readonly EvidenceProvenance[];
    spatialLinearity:
      readonly EvidenceProvenance[];
    structuralCompatibility:
      SensorResponseApplicationCompatibilityAssessment["componentEvidence"];
  };
}

export function parseUncertainty(
  value: unknown,
  path: string
): SensorSpectralResponseUncertainty {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", UNCERTAINTY_VARIANT_FIELDS, path);

  if (record.kind === "relative") {
    const fraction =
      requireFiniteNonNegative(
        record.fraction,
        path + ".fraction"
      );
    return {
      kind: "relative",
      fraction,
      basis: requireNonEmptyString(
        record.basis,
        path + ".basis"
      )
    };
  }

  if (
    record.kind === "not-quantified"
  ) {
    return {
      kind: "not-quantified",
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      )
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseReferenceConditions(
  value: unknown,
  path: string
): SensorSpectralReferenceConditions {
  const record =
    requireRecord(value, path, ["temperatureC", "incidenceAngleDegreesFromNormal", "polarization"]);
  const result:
    SensorSpectralReferenceConditions =
      {};

  if (
    record.temperatureC !== undefined
  ) {
    if (
      typeof record.temperatureC !==
        "number" ||
      !Number.isFinite(
        record.temperatureC
      )
    ) {
      throw new InvalidConfigurationError(
        path +
          ".temperatureC must be finite."
      );
    }
    result.temperatureC =
      record.temperatureC;
  }

  if (
    record.incidenceAngleDegreesFromNormal !==
    undefined
  ) {
    const angle =
      record
        .incidenceAngleDegreesFromNormal;
    if (
      typeof angle !== "number" ||
      !Number.isFinite(angle) ||
      angle < 0 ||
      angle > 90
    ) {
      throw new InvalidConfigurationError(
        path +
          ".incidenceAngleDegreesFromNormal must be finite from 0 through 90."
      );
    }
    result.incidenceAngleDegreesFromNormal =
      angle;
  }

  if (
    record.polarization !== undefined
  ) {
    if (
      record.polarization !==
        "unpolarized" &&
      record.polarization !==
        "unspecified"
    ) {
      throw new InvalidConfigurationError(
        path +
          ".polarization is invalid."
      );
    }
    result.polarization =
      record.polarization;
  }

  if (
    result.temperatureC === undefined &&
    result
      .incidenceAngleDegreesFromNormal ===
      undefined &&
    result.polarization === undefined
  ) {
    throw new InvalidConfigurationError(
      path +
        " must declare at least one condition."
    );
  }

  return result;
}

function parseInputRange(
  value: unknown,
  path: string
): SensorResponseOperatingInputRange {
  const record =
    requireRecord(value, path, ["minimumInclusive", "maximumInclusive", "kind", "unit"]);

  const minimumInclusive =
    requireFiniteNonNegative(
      record.minimumInclusive,
      path + ".minimumInclusive"
    );
  const maximumInclusive =
    requirePositiveFinite(
      record.maximumInclusive,
      path + ".maximumInclusive"
    );

  if (
    minimumInclusive >=
    maximumInclusive
  ) {
    throw new InvalidConfigurationError(
      path +
        ".minimumInclusive must be less than maximumInclusive."
    );
  }

  if (
    record.kind ===
      "wavelength-integrated-geometric-aperture-radiant-power"
  ) {
    if (record.unit !== "W") {
      throw new InvalidConfigurationError(
        path +
          '.unit must be "W".'
      );
    }
    return {
      kind:
        "wavelength-integrated-geometric-aperture-radiant-power",
      unit: "W",
      minimumInclusive,
      maximumInclusive
    };
  }

  if (
    record.kind ===
      "wavelength-integrated-spatial-average-irradiance"
  ) {
    if (record.unit !== "W/m^2") {
      throw new InvalidConfigurationError(
        path +
          '.unit must be "W/m^2".'
      );
    }
    return {
      kind:
        "wavelength-integrated-spatial-average-irradiance",
      unit: "W/m^2",
      minimumInclusive,
      maximumInclusive
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseWavelengthApplicability(
  value: unknown,
  path: string
): SensorResponseOperatingWavelengthApplicability {
  const record =
    requireRecord(value, path, ["wavelengthBasis", "minimumNanometers", "maximumNanometers", "containment"]);

  if (
    record.wavelengthBasis !== "air" &&
    record.wavelengthBasis !==
      "vacuum"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.wavelengthBasis must be "air" or "vacuum".'
    );
  }

  const minimumNanometers =
    requirePositiveFinite(
      record.minimumNanometers,
      path + ".minimumNanometers"
    );
  const maximumNanometers =
    requirePositiveFinite(
      record.maximumNanometers,
      path + ".maximumNanometers"
    );

  if (
    minimumNanometers >=
    maximumNanometers
  ) {
    throw new InvalidConfigurationError(
      path +
        ".minimumNanometers must be less than maximumNanometers."
    );
  }

  if (
    record.containment !==
      "requested-range-must-be-contained"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.containment must be "requested-range-must-be-contained".'
    );
  }

  return {
    wavelengthBasis:
      record.wavelengthBasis,
    minimumNanometers,
    maximumNanometers,
    containment:
      "requested-range-must-be-contained"
  };
}

function parseLinearityCriterion(
  value: unknown,
  path: string
): SensorResponseLinearityCriterion {
  const record =
    requireRecord(value, path, ["maximumAbsoluteRelativeDeviation"]);
  const maximumAbsoluteRelativeDeviation =
    requireFiniteNonNegative(
      record
        .maximumAbsoluteRelativeDeviation,
      path +
        ".maximumAbsoluteRelativeDeviation"
    );

  if (
    maximumAbsoluteRelativeDeviation >
      1
  ) {
    throw new InvalidConfigurationError(
      path +
        ".maximumAbsoluteRelativeDeviation must be a fraction from 0 through 1."
    );
  }

  return {
    maximumAbsoluteRelativeDeviation
  };
}

function parseSpectralInputModel(
  value: unknown
): SensorResponseOperatingSpectralInputModel {
  if (value === undefined) {
    return {
      kind: "broadband-integrated-only"
    };
  }

  const record = requireRecord(
    value,
    "sensorResponseOperatingRange.spectralInputModel", null
  );
  rejectUnknownVariantFields(record, "kind", { "broadband-integrated-only": ["kind"], "per-spectral-bin": ["kind", "maximumBinWidthNanometers", "scientificStatus", "evidence", "limitation"] }, "sensorResponseOperatingRange.spectralInputModel");

  if (
    record.kind ===
      "broadband-integrated-only"
  ) {
    return {
      kind: "broadband-integrated-only"
    };
  }

  if (
    record.kind !==
      "per-spectral-bin"
  ) {
    throw new InvalidConfigurationError(
      "sensorResponseOperatingRange.spectralInputModel.kind is invalid."
    );
  }

  if (
    record.scientificStatus !==
      "calibrated" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      "sensorResponseOperatingRange.spectralInputModel.scientificStatus is invalid."
    );
  }

  const maximumBinWidthNanometers =
    requirePositiveFinite(
      record.maximumBinWidthNanometers,
      "sensorResponseOperatingRange.spectralInputModel.maximumBinWidthNanometers"
    );
  const limitation =
    record.limitation === undefined
      ? undefined
      : requireNonEmptyString(
          record.limitation,
          "sensorResponseOperatingRange.spectralInputModel.limitation"
        );

  if (
    record.scientificStatus ===
      "approximation" &&
    limitation === undefined
  ) {
    throw new InvalidConfigurationError(
      "sensorResponseOperatingRange.spectralInputModel.limitation is required for an approximation."
    );
  }

  return {
    kind: "per-spectral-bin",
    maximumBinWidthNanometers,
    scientificStatus:
      record.scientificStatus,
    evidence: parseEvidenceList(
      record.evidence,
      "sensorResponseOperatingRange.spectralInputModel.evidence"
    ),
    ...(limitation === undefined
      ? {}
      : { limitation })
  };
}

function parseSpatialLinearityModel(
  value: unknown
): SensorResponseOperatingSpatialLinearityModel {
  if (value === undefined) {
    return {
      kind: "not-established",
      limitation:
        "Spatial-distribution linear superposition was not declared."
    };
  }

  const record = requireRecord(
    value,
    "sensorResponseOperatingRange.spatialLinearityModel", null
  );
  rejectUnknownVariantFields(record, "kind", { "not-established": ["kind", "limitation"], "linear-superposition-over-geometric-aperture": ["kind", "scientificStatus", "evidence", "limitation"] }, "sensorResponseOperatingRange.spatialLinearityModel");

  if (
    record.kind === "not-established"
  ) {
    return {
      kind: "not-established",
      limitation: requireNonEmptyString(
        record.limitation,
        "sensorResponseOperatingRange.spatialLinearityModel.limitation"
      )
    };
  }

  if (
    record.kind !==
    "linear-superposition-over-geometric-aperture"
  ) {
    throw new InvalidConfigurationError(
      "sensorResponseOperatingRange.spatialLinearityModel.kind is invalid."
    );
  }

  if (
    record.scientificStatus !==
      "calibrated" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      "sensorResponseOperatingRange.spatialLinearityModel.scientificStatus is invalid."
    );
  }

  const limitation =
    record.limitation === undefined
      ? undefined
      : requireNonEmptyString(
          record.limitation,
          "sensorResponseOperatingRange.spatialLinearityModel.limitation"
        );

  if (
    record.scientificStatus ===
      "approximation" &&
    limitation === undefined
  ) {
    throw new InvalidConfigurationError(
      "sensorResponseOperatingRange.spatialLinearityModel.limitation is required for an approximation."
    );
  }

  return {
    kind:
      "linear-superposition-over-geometric-aperture",
    scientificStatus:
      record.scientificStatus,
    evidence: parseEvidenceList(
      record.evidence,
      "sensorResponseOperatingRange.spatialLinearityModel.evidence"
    ),
    ...(limitation === undefined
      ? {}
      : { limitation })
  };
}

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The profile states the input quantity (incident power or irradiance), wavelength coverage,
 * reference conditions and non-linearity criterion of the calibrated operating range.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseSensorResponseOperatingRangeProfile(
  value: unknown
): SensorResponseOperatingRangeProfile {
  const record =
    requireRecord(
      value,
      "sensorResponseOperatingRange", ["schemaVersion", "scientificStatus", "referenceConditions", "referenceConditionPolicy", "uncertainty", "profileId", "responseApplicationProfileId", "spectralResponseProfileId", "colorSamplingProfileId", "channelId", "evidence", "inputRange", "wavelengthApplicability", "linearityCriterion", "spatialLinearityModel", "spectralInputModel"]
    );

  if (
    record.schemaVersion !== "0.1.0"
  ) {
    throw new InvalidConfigurationError(
      'sensorResponseOperatingRange.schemaVersion must be "0.1.0".'
    );
  }

  if (
    record.scientificStatus !==
      "calibrated" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      "sensorResponseOperatingRange.scientificStatus is invalid."
    );
  }

  const referenceConditions =
    record.referenceConditions ===
    undefined
      ? undefined
      : parseReferenceConditions(
          record.referenceConditions,
          "sensorResponseOperatingRange.referenceConditions"
        );

  const referenceConditionPolicy =
    parseReferenceConditionPolicy(
      record.referenceConditionPolicy,
      "sensorResponseOperatingRange.referenceConditionPolicy"
    );

  if (
    referenceConditionPolicy.kind ===
      "exact-match-required" &&
    referenceConditions === undefined
  ) {
    throw new InvalidConfigurationError(
      "sensorResponseOperatingRange.referenceConditions is required when exact-match-required is selected."
    );
  }

  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      "sensorResponseOperatingRange.uncertainty"
    );

  if (
    record.scientificStatus ===
      "calibrated" &&
    uncertainty.kind ===
      "not-quantified"
  ) {
    throw new InvalidConfigurationError(
      "A calibrated sensor response operating range must declare quantified relative uncertainty."
    );
  }

  return {
    schemaVersion: "0.1.0",
    profileId: requireNonEmptyString(
      record.profileId,
      "sensorResponseOperatingRange.profileId"
    ),
    responseApplicationProfileId:
      requireNonEmptyString(
        record
          .responseApplicationProfileId,
        "sensorResponseOperatingRange.responseApplicationProfileId"
      ),
    spectralResponseProfileId:
      requireNonEmptyString(
        record
          .spectralResponseProfileId,
        "sensorResponseOperatingRange.spectralResponseProfileId"
      ),
    colorSamplingProfileId:
      requireNonEmptyString(
        record.colorSamplingProfileId,
        "sensorResponseOperatingRange.colorSamplingProfileId"
      ),
    channelId:
      requireNonEmptyString(
        record.channelId,
        "sensorResponseOperatingRange.channelId"
      ),
    scientificStatus:
      record.scientificStatus,
    uncertainty,
    evidence: parseEvidenceList(
      record.evidence,
      "sensorResponseOperatingRange.evidence"
    ),
    inputRange: parseInputRange(
      record.inputRange,
      "sensorResponseOperatingRange.inputRange"
    ),
    wavelengthApplicability:
      parseWavelengthApplicability(
        record.wavelengthApplicability,
        "sensorResponseOperatingRange.wavelengthApplicability"
      ),
    linearityCriterion:
      parseLinearityCriterion(
        record.linearityCriterion,
        "sensorResponseOperatingRange.linearityCriterion"
      ),
    spatialLinearityModel:
      parseSpatialLinearityModel(
        record.spatialLinearityModel
      ),
    spectralInputModel:
      parseSpectralInputModel(
        record.spectralInputModel
      ),
    ...(referenceConditions ===
    undefined
      ? {}
      : { referenceConditions }),
    referenceConditionPolicy
  };
}

function requireReductionMetric(
  reduction:
    SensorSpatioSpectralIrradianceReduction,
  range:
    SensorResponseOperatingInputRange
): number {
  const value =
    range.kind ===
      "wavelength-integrated-geometric-aperture-radiant-power"
      ? reduction
          .wavelengthIntegratedGeometricApertureIncidentFluxWatts
      : reduction
          .wavelengthIntegratedSpatialAverageIrradianceWattsPerSquareMeter;

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new InvalidScientificInputError(
      "The selected operating-range input metric must be finite and nonnegative."
    );
  }
  return value;
}

function spectralNodeInputValue(
  entry:
    SensorSpatioSpectralIrradianceReduction["perWavelength"][number],
  range:
    SensorResponseOperatingInputRange
): number {
  const value =
    range.kind ===
      "wavelength-integrated-geometric-aperture-radiant-power"
      ? entry
          .wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts
      : entry
          .wavelengthIntegratedSpatialAverageContributionWattsPerSquareMeter;

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new InvalidScientificInputError(
      "Per-spectral-node operating-range input must be finite and nonnegative."
    );
  }
  return value;
}

function validateReductionIdentity(
  reduction:
    SensorSpatioSpectralIrradianceReduction,
  compatibility:
    SensorResponseApplicationCompatibilityAssessment
): void {
  requireInputObject(reduction, "reduction input");
  if (
    reduction.responseProfileId !==
      compatibility
        .spectralResponseProfileId ||
    reduction.colorSamplingProfileId !==
      compatibility
        .colorSamplingProfileId ||
    reduction.channelId !==
      compatibility.channelId
  ) {
    throw new InvalidScientificInputError(
      "reduction and compatibility assessment identities do not match."
    );
  }
}

/**
 * Checks every declared spectral-bin input against the operating range and the superposition
 * requirement, before any instantaneous response conversion is allowed.
 *
 * Each bin must be in range, and spatial linear superposition must hold. A valid average must not
 * hide a part of the aperture that is too bright.
 * @param input - The input; see `AssessSensorResponseOperatingRangeInput` for its fields, units and coordinates.
 * @returns The assessment. Read its structured blockers before acting on an authorization.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function assessSensorResponseOperatingRange(
  input:
    AssessSensorResponseOperatingRangeInput
): CalculationResult<SensorResponseOperatingRangeAssessment> {
  requireInputKeys(input, "assessSensorResponseOperatingRange", ["reduction", "compatibility", "operatingRangeProfile"]);
  validateReductionIdentity(
    input.reduction,
    input.compatibility
  );
  const profile =
    parseSensorResponseOperatingRangeProfile(
      input.operatingRangeProfile
    );
  const blockers:
    SensorResponseOperatingRangeBlocker[] =
      [];

  if (
    !input.compatibility
      .structuralCompatibilityEstablished ||
    input.compatibility
      .compatibilityStatus === "blocked"
  ) {
    blockers.push(
      "structural-compatibility-not-established"
    );
  }

  if (
    profile.responseApplicationProfileId !==
    input.compatibility
      .applicationProfileId
  ) {
    blockers.push(
      "response-application-profile-id-mismatch"
    );
  }
  if (
    profile.spectralResponseProfileId !==
    input.reduction
      .responseProfileId
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

  if (
    !input.reduction
      .wavelengthBasisResolved
  ) {
    blockers.push(
      "wavelength-basis-unresolved"
    );
  } else if (
    input.reduction.wavelengthBasis !==
    profile.wavelengthApplicability
      .wavelengthBasis
  ) {
    blockers.push(
      "wavelength-basis-mismatch"
    );
  }

  const wavelengthRange =
    input.reduction
      .wavelengthRangeNanometers;
  if (
    wavelengthRange.minimum <
      profile.wavelengthApplicability
        .minimumNanometers ||
    wavelengthRange.maximum >
      profile.wavelengthApplicability
        .maximumNanometers
  ) {
    blockers.push(
      "wavelength-range-outside-linearity-applicability"
    );
  }

  const metricValue =
    requireReductionMetric(
      input.reduction,
      profile.inputRange
    );

  if (
    metricValue <
    profile.inputRange.minimumInclusive
  ) {
    blockers.push(
      "input-below-linearity-range"
    );
  }
  if (
    metricValue >
    profile.inputRange.maximumInclusive
  ) {
    blockers.push(
      "input-above-linearity-range"
    );
  }

  const spectralInputModel =
    profile.spectralInputModel ?? {
      kind: "broadband-integrated-only" as const
    };
  const evaluatedSpectralNodeInputs:
    {
      spectralSampleIndex: number;
      wavelengthNanometers: number;
      wavelengthMeasureNanometers: number;
      kind:
        SensorResponseOperatingInputRange["kind"];
      unit:
        SensorResponseOperatingInputRange["unit"];
      value: number;
    }[] = [];

  if (
    spectralInputModel.kind ===
      "per-spectral-bin"
  ) {
    for (
      const entry of
      input.reduction.perWavelength
    ) {
      if (
        entry.wavelengthMeasureNanometers >
        spectralInputModel
          .maximumBinWidthNanometers
      ) {
        blockers.push(
          "spectral-bin-width-outside-linearity-applicability"
        );
      }

      const value =
        spectralNodeInputValue(
          entry,
          profile.inputRange
        );
      evaluatedSpectralNodeInputs.push({
        spectralSampleIndex:
          entry.spectralSampleIndex,
        wavelengthNanometers:
          entry.wavelengthNanometers,
        wavelengthMeasureNanometers:
          entry.wavelengthMeasureNanometers,
        kind:
          profile.inputRange.kind,
        unit:
          profile.inputRange.unit,
        value
      });

      if (
        value <
        profile.inputRange
          .minimumInclusive
      ) {
        blockers.push(
          "spectral-bin-input-below-linearity-range"
        );
      }
      if (
        value >
        profile.inputRange
          .maximumInclusive
      ) {
        blockers.push(
          "spectral-bin-input-above-linearity-range"
        );
      }
    }
  }

  if (
    profile.spatialLinearityModel?.kind !==
      "linear-superposition-over-geometric-aperture"
  ) {
    blockers.push(
      "spatial-linearity-superposition-not-established"
    );
  }

  if (
    profile.referenceConditionPolicy.kind ===
      "exact-match-required"
  ) {
    const referenceConditions =
      profile.referenceConditions!;
    if (
      input.compatibility
        .operatingConditions ===
      undefined
    ) {
      blockers.push(
        "operating-conditions-not-declared"
      );
    } else if (
      !conditionsMatch(
        referenceConditions,
        input.compatibility
          .operatingConditions
      )
    ) {
      blockers.push(
        "linearity-operating-conditions-mismatch"
      );
    }
  }

  const compatible =
    blockers.length === 0;

  const approximate =
    input.compatibility
      .compatibilityStatus ===
      "compatible-approximation" ||
    profile.scientificStatus ===
      "approximation" ||
    profile.uncertainty.kind ===
      "not-quantified" ||
    (
      profile.spatialLinearityModel?.kind ===
        "linear-superposition-over-geometric-aperture" &&
      profile.spatialLinearityModel
        .scientificStatus ===
        "approximation"
    ) ||
    (
      spectralInputModel.kind ===
        "per-spectral-bin" &&
      spectralInputModel
        .scientificStatus ===
        "approximation"
    ) ||
    profile.referenceConditionPolicy.kind ===
      "assume-compatible";

  const spectralRateReady =
    compatible &&
    spectralInputModel.kind ===
      "per-spectral-bin";

  const status =
    compatible
      ? spectralRateReady
        ? approximate
          ? "rate-conversion-authorized-approximation"
          : "rate-conversion-authorized"
        : approximate
          ? "broadband-range-compatible-approximation"
          : "broadband-range-compatible"
      : "blocked";

  const referenceConditionEvidence =
    profile.referenceConditionPolicy.kind ===
      "assume-compatible"
      ? profile.referenceConditionPolicy
          .evidence
      : [];
  const spatialLinearityEvidence =
    profile.spatialLinearityModel?.kind ===
      "linear-superposition-over-geometric-aperture"
      ? profile.spatialLinearityModel.evidence
      : [];

  return calculatedResult(
    {
      operatingRangeProfileId:
        profile.profileId,
      responseApplicationProfileId:
        input.compatibility
          .applicationProfileId,
      spectralResponseProfileId:
        input.reduction
          .responseProfileId,
      colorSamplingProfileId:
        input.reduction
          .colorSamplingProfileId,
      channelId:
        input.reduction.channelId,
      requiredSignalPath:
        input.compatibility
          .requiredSignalPath,
      inputRange:
        profile.inputRange,
      evaluatedInput: {
        kind: profile.inputRange.kind,
        unit: profile.inputRange.unit,
        value: metricValue
      },
      wavelengthApplicability:
        profile.wavelengthApplicability,
      evaluatedWavelengthRangeNanometers:
        {
          ...wavelengthRange
        },
      linearityCriterion:
        profile.linearityCriterion,
      spectralInputModel,
      ...(evaluatedSpectralNodeInputs.length ===
      0
        ? {}
        : {
            evaluatedSpectralNodeInputs
          }),
      spectralNodeRangeCompatibilityAssessed:
        spectralInputModel.kind ===
        "per-spectral-bin",
      spatialLinearityModel:
        profile.spatialLinearityModel ?? {
          kind: "not-established",
          limitation:
            "Spatial-distribution linear superposition was not declared."
        },
      referenceConditionPolicy:
        profile.referenceConditionPolicy,
      ...(profile.referenceConditions ===
      undefined
        ? {}
        : {
            referenceConditions:
              profile.referenceConditions
          }),
      ...(input.compatibility
        .operatingConditions ===
      undefined
        ? {}
        : {
            operatingConditions:
              input.compatibility
                .operatingConditions
          }),
      operatingRangeCompatibilityAssessed:
        true,
      instantaneousResponseRangeCompatible:
        compatible,
      status,
      blockers,
      responseRateConversionAuthorized:
        spectralRateReady,
      responseApplicationPerformed:
        false,
      temporalIntegrationAuthorized:
        false,
      exposureDomainLinearityAssessed:
        false,
      accumulatedChargeLinearityAssessed:
        false,
      saturationAssessed: false,
      photonConversionPerformed:
        false,
      electronConversionPerformed:
        false,
      currentConversionPerformed:
        false,
      componentEvidence: {
        operatingRange:
          profile.evidence,
        referenceConditionAssumption:
          referenceConditionEvidence,
        spatialLinearity:
          spatialLinearityEvidence,
        structuralCompatibility:
          input.compatibility
            .componentEvidence
      }
    },
    "sensor-response-operating-range-assessment",
    "1.0.0",
    [
      "This gate assesses instantaneous response-law applicability only; it does not apply response or integrate exposure.",
      "The valid optical-input range is evidence-backed and must be expressed in the same wavelength-integrated power or irradiance domain produced by the pre-response reducer.",
      "Broadband-integrated range compatibility alone cannot authorize wavelength-dependent response conversion; per-spectral-bin applicability must be explicitly established and every bin must remain inside the calibrated input range.",
      "Per-spectral-bin applicability also declares a maximum supported bin width so a broad quadrature bin is not silently treated as an equivalent monochromatic calibration point.",
      "Linearity can depend on optical input level and wavelength; the reduction wavelength range must remain inside the declared applicability range.",
      "Post-spatial rate conversion additionally requires explicit linear superposition over the geometric aperture; otherwise sub-aperture illumination patterns could hide local nonlinear behavior.",
      "The maximumAbsoluteRelativeDeviation criterion documents the tolerated response nonlinearity for the declared valid range; this function does not derive that criterion from synthetic data.",
      "Reference conditions for the linearity calibration are separate from spectral-response reference conditions and must match when exact matching is required.",
      "Exposure-domain linearity, accumulated-charge saturation/full-well behavior, and downstream electronics linearity are intentionally not assessed here.",
      "A successful result authorizes only a future instantaneous rate conversion path: photon-rate→electrons for EQE/filter×EQE or radiant-power→current for A/W responsivity.",
      "Temporal integration, saturation, noise, ADC/RAW conversion and reconstruction remain downstream."
    ]
  );
}
