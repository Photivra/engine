// SPDX-License-Identifier: Apache-2.0

/**
 * Scene-to-sensor optical bridge: from spectral scene radiance to the irradiance that reaches the
 * sensor.
 *
 * The profile parser validates untrusted input and returns the normalized typed contract. Unknown
 * enum values, missing required fields and incompatible scientific data are rejected here.
 *
 * The calculation applies the declared pupil acceptance and exactly one transmission or
 * field-throughput path. It returns the irradiance before the sensor stack, with conservative
 * evidence.
 *
 * The optical bridge turns outgoing scene radiance (W/m²/sr/nm) into irradiance (W/m²/nm) arriving
 * at the front of the sensor stack.
 * - Circular paraxial acceptance is pi/(4*Nworking²). At finite focus with unit pupil magnification,
 *   the working f-number is N*(1+m).
 * - Spectral transmission and an effective working T-stop are alternative paths; use one.
 * - Field throughput is applied exactly once.
 * - Sensor response and PSF (point-spread function) blur happen later in the pipeline.
 * @see docs/SCENE_SENSOR_QUADRATURE.md for the equations, units, coordinate conventions, known
 * blockers and support limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceBackedFact,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { type SpectralWavelengthBasis } from "../core/spectral.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { composeFrontOfLensFilterTransmission, type FrontOfLensFilterProfile, parseRange, parseResolvedBasis } from "./front-of-lens-filter.js";
import type { IlluminationVignetting } from "./illumination-vignetting.js";
import { calculateThinLensImageDistance } from "./thin-lens.js";
import {
  parseSceneRadianceEvaluationRequest,
  parseSceneRadianceEvaluationResult,
  type SceneRadianceEvaluationRequest,
  type SceneRadianceEvaluationResult
} from "../schema/scene-radiance.js";
import { requireInputKeys, rejectUnknownVariantFields, UNCERTAINTY_VARIANT_FIELDS, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, parseConfigScientificStatus as parseScientificStatus, requireInputPositiveFinite as requirePositiveFiniteScientific, parseConfigLimitations as parseLimitations, requireConfigFiniteAboveZero as requirePositiveFinite } from "../core/record-validation.js";
import { requireFraction } from "../color/white-balance.js";

export const SCENE_TO_SENSOR_IRRADIANCE_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;

export type OpticalBridgeScientificStatus =
  | "calibrated"
  | "approximation";

export type OpticalBridgeUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };

export interface NumericRange {
  minimum: number;
  maximum: number;
}

export type OpticalBridgeFocusApplicability =
  | {
      kind: "any";
    }
  | {
      kind: "finite-distance-range";
      objectDistanceM: NumericRange;
    };

export interface SpectralTransmissionSample {
  wavelengthNanometers: number;
  linearTransmissionFactor: number;
}

export type OpticalTransmissionModel =
  | {
      kind: "spectral-transmission";
      scientificStatus:
        OpticalBridgeScientificStatus;
      wavelengthBasis:
        Exclude<
          SpectralWavelengthBasis,
          "unspecified"
        >;
      samples:
        EvidenceBackedFact<
          readonly SpectralTransmissionSample[]
        >;
      uncertainty:
        OpticalBridgeUncertainty;
    }
  | {
      kind:
        "effective-working-t-stop-approximation";
      scientificStatus: "approximation";
      workingTStop:
        EvidenceBackedFact<number>;
      wavelengthBasis:
        Exclude<
          SpectralWavelengthBasis,
          "unspecified"
        >;
      wavelengthRangeNanometers:
        NumericRange;
      uncertainty:
        OpticalBridgeUncertainty;
      limitation: string;
    };

export interface SceneToSensorIrradianceProfile {
  schemaVersion:
    typeof SCENE_TO_SENSOR_IRRADIANCE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  lensProfileId: string;
  scientificStatus:
    OpticalBridgeScientificStatus;
  applicability: {
    focalLengthMm: NumericRange;
    nominalFNumber: NumericRange;
    focus:
      OpticalBridgeFocusApplicability;
  };
  transmission:
    OpticalTransmissionModel;
  distortionAreaMappingOwnership:
    "not-applied-by-bridge";
  psfRedistributionOwnership:
    "downstream-normalized-energy-redistribution";
  sensorOpticalStackIncluded: false;
  strayLightIncluded: false;
  polarizationModeled: false;
  wavelengthChangingBehaviorModeled: false;
  volumetricScatteringModeled: false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export type OpticalBridgeFocusContext =
  | {
      kind: "infinity-focus";
    }
  | {
      kind:
        "ideal-symmetric-thin-lens";
      objectDistanceM: number;
      pupilMagnificationAssumption:
        "unity";
    }
  | {
      kind:
        "supplied-working-f-number";
      focus:
        | {
            kind: "infinity";
          }
        | {
            kind: "finite";
            objectDistanceM: number;
          };
      workingFNumber:
        EvidenceBackedFact<number>;
      basis: string;
    };

export type OpticalBridgeFieldThroughput =
  | {
      kind: "unity";
    }
  | {
      kind:
        "illumination-vignetting-result";
      result:
        IlluminationVignetting;
    };

export interface CalculateSceneRadianceToSensorIrradianceInput {
  sceneRadianceRequest:
    SceneRadianceEvaluationRequest;
  sceneRadianceResult:
    SceneRadianceEvaluationResult;
  profile:
    SceneToSensorIrradianceProfile;
  focalLengthMm: number;
  nominalFNumber: number;
  focus:
    OpticalBridgeFocusContext;
  imagePointMm: {
    x: number;
    y: number;
  };
  fieldThroughput:
    OpticalBridgeFieldThroughput;
  frontOfLensFilters?:
    readonly FrontOfLensFilterProfile[];
}

export interface SceneToSensorIrradianceResult {
  schemaVersion:
    typeof SCENE_TO_SENSOR_IRRADIANCE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  lensProfileId: string;
  sampleId: string;
  providerProfileId: string;
  sceneId: string;
  timeSecondsFromExposureStart: number;
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  inputQuantity:
    "outgoing-spectral-radiance";
  inputUnit:
    "W/m^2/sr/nm";
  outputQuantity:
    "sensor-plane-spectral-irradiance";
  outputUnit:
    "W/m^2/nm";
  sceneSpectralRadianceWattsPerSquareMeterSteradianNanometer:
    number;
  focalLengthMm: number;
  nominalFNumber: number;
  workingFNumber: number;
  focusModel:
    OpticalBridgeFocusContext["kind"];
  paraxialGeometricAcceptanceSolidAngleSteradians:
    number;
  transmissionPath:
    OpticalTransmissionModel["kind"];
  spectralTransmissionFactor:
    number | null;
  effectiveWorkingTStop:
    number | null;
  tStopEquivalentTransmissionFactor:
    number | null;
  frontOfLensFilterCount: number;
  frontOfLensFilterTransmissionFactor:
    number;
  frontOfLensFilterAttenuationStops:
    number;
  frontOfLensFilterTransmissionAppliedExactlyOnce:
    true;
  /**
   * True when a front-of-lens linear polarizer was applied. Scene radiance is unpolarized in this
   * bridge, so a polarizer transmits (k1 + k2) / 2.
   */
  frontOfLensFilterPolarizationModeled:
    boolean;
  fieldThroughputFactor: number;
  effectiveAcceptanceAfterTransmissionAndFieldSteradians:
    number;
  sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer:
    number;
  scientificStatus: "approximation";
  sceneRadianceScientificStatus:
    SceneRadianceEvaluationResult["scientificStatus"];
  opticalProfileScientificStatus:
    OpticalBridgeScientificStatus;
  sceneRadianceUncertainty:
    SceneRadianceEvaluationResult["uncertainty"];
  opticalUncertainty:
    OpticalBridgeUncertainty;
  radianceAmplificationApplied: false;
  fieldThroughputAppliedExactlyOnce:
    true;
  universalCos4FalloffApplied: false;
  distortionAreaCorrectionApplied: false;
  psfRedistributionApplied: false;
  sensorOpticalStackApplied: false;
  cfaApplied: false;
  quantumEfficiencyApplied: false;
  spectralResponsivityApplied: false;
  strayLightApplied: false;
  polarizationModeled: false;
  wavelengthChangingBehaviorModeled:
    false;
  volumetricScatteringModeled: false;
  calibratedSensorPlaneIrradianceClaimAuthorized:
    false;
  componentEvidence: {
    sceneRadiance:
      readonly EvidenceProvenance[];
    opticalProfile:
      readonly EvidenceProvenance[];
    transmission:
      readonly EvidenceProvenance[];
    workingFNumber:
      readonly EvidenceProvenance[];
    frontOfLensFilters:
      readonly EvidenceProvenance[];
  };
  limitations:
    readonly string[];
}

function parseUncertainty(
  value: unknown,
  path: string
): OpticalBridgeUncertainty {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", UNCERTAINTY_VARIANT_FIELDS, path);

  if (record.kind === "relative") {
    return {
      kind: "relative",
      fraction:
        requireFraction(
          record.fraction,
          path + ".fraction"
        ),
      basis:
        requireNonEmptyString(
          record.basis,
          path + ".basis"
        )
    };
  }

  if (
    record.kind ===
    "not-quantified"
  ) {
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

function parseReusableNumericEvidence(
  value: unknown,
  path: string
): readonly EvidenceProvenance[] {
  const evidence =
    parseEvidenceList(value, path);

  if (
    evidence.some(
      (entry) =>
        entry.reuseStatus ===
        "factual-reference-only"
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        " for numeric optical curve data must be reusable-data or photivra-owned."
    );
  }
  return evidence;
}

function parseSpectralSamples(
  value: unknown,
  path: string
): readonly SpectralTransmissionSample[] {
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
  return value.map(
    (entry, index) => {
      const samplePath =
        path +
        "[" +
        index +
        "]";
      const record =
        requireRecord(
          entry,
          samplePath, ["wavelengthNanometers", "linearTransmissionFactor"]
        );
      const wavelengthNanometers =
        requirePositiveFinite(
          record.wavelengthNanometers,
          samplePath +
            ".wavelengthNanometers"
        );
      if (
        wavelengthNanometers <=
        previous
      ) {
        throw new InvalidConfigurationError(
          path +
            " wavelengths must be strictly increasing."
        );
      }
      previous =
        wavelengthNanometers;
      return {
        wavelengthNanometers,
        linearTransmissionFactor:
          requireFraction(
            record.linearTransmissionFactor,
            samplePath +
              ".linearTransmissionFactor"
          )
      };
    }
  );
}

function parseTransmission(
  value: unknown,
  path: string
): OpticalTransmissionModel {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", {
    // workingTStop and wavelengthRangeNanometers (spectral) and samples (working T-stop) are rejected below with their own messages.
    "spectral-transmission": ["kind", "scientificStatus", "wavelengthBasis", "samples", "uncertainty", "workingTStop", "wavelengthRangeNanometers"],
    "effective-working-t-stop-approximation": ["kind", "scientificStatus", "workingTStop", "wavelengthBasis", "wavelengthRangeNanometers",
      "uncertainty", "limitation", "samples"]
  }, path);

  if (
    record.kind ===
    "spectral-transmission"
  ) {
    if (
      record.workingTStop !==
      undefined ||
      record.wavelengthRangeNanometers !==
      undefined
    ) {
      throw new InvalidConfigurationError(
        path +
          " spectral-transmission must not include T-stop-only fields."
      );
    }

    const status =
      parseScientificStatus(
        record.scientificStatus,
        path +
          ".scientificStatus"
      );
    const samplesFact =
      requireRecord(
        record.samples,
        path + ".samples", ["value", "evidence"]
      );
    const uncertainty =
      parseUncertainty(
        record.uncertainty,
        path + ".uncertainty"
      );

    if (
      status === "calibrated" &&
      uncertainty.kind !==
        "relative"
    ) {
      throw new InvalidConfigurationError(
        path +
          " calibrated spectral transmission requires quantified relative uncertainty."
      );
    }

    return {
      kind:
        "spectral-transmission",
      scientificStatus: status,
      wavelengthBasis:
        parseResolvedBasis(
          record.wavelengthBasis,
          path +
            ".wavelengthBasis"
        ),
      samples: {
        value:
          parseSpectralSamples(
            samplesFact.value,
            path +
              ".samples.value"
          ),
        evidence:
          parseReusableNumericEvidence(
            samplesFact.evidence,
            path +
              ".samples.evidence"
          )
      },
      uncertainty
    };
  }

  if (
    record.kind ===
    "effective-working-t-stop-approximation"
  ) {
    if (
      record.samples !==
      undefined
    ) {
      throw new InvalidConfigurationError(
        path +
          " T-stop approximation must not include spectral transmission samples."
      );
    }
    if (
      record.scientificStatus !==
      "approximation"
    ) {
      throw new InvalidConfigurationError(
        path +
          ' T-stop scientificStatus must be "approximation".'
      );
    }
    const workingTStopFact =
      requireRecord(
        record.workingTStop,
        path +
          ".workingTStop", ["value", "evidence"]
      );
    return {
      kind:
        "effective-working-t-stop-approximation",
      scientificStatus:
        "approximation",
      workingTStop: {
        value:
          requirePositiveFinite(
            workingTStopFact.value,
            path +
              ".workingTStop.value"
          ),
        evidence:
          parseEvidenceList(
            workingTStopFact.evidence,
            path +
              ".workingTStop.evidence"
          )
      },
      wavelengthBasis:
        parseResolvedBasis(
          record.wavelengthBasis,
          path +
            ".wavelengthBasis"
        ),
      wavelengthRangeNanometers:
        parseRange(
          record.wavelengthRangeNanometers,
          path +
            ".wavelengthRangeNanometers"
        ),
      uncertainty:
        parseUncertainty(
          record.uncertainty,
          path + ".uncertainty"
        ),
      limitation:
        requireNonEmptyString(
          record.limitation,
          path +
            ".limitation"
        )
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseFocusApplicability(
  value: unknown,
  path: string
): OpticalBridgeFocusApplicability {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", { any: ["kind"], "finite-distance-range": ["kind", "objectDistanceM"] }, path);

  if (record.kind === "any") {
    return {
      kind: "any"
    };
  }
  if (
    record.kind ===
    "finite-distance-range"
  ) {
    return {
      kind:
        "finite-distance-range",
      objectDistanceM:
        parseRange(
          record.objectDistanceM,
          path +
            ".objectDistanceM"
        )
    };
  }
  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

/**
 * Validates an untrusted scene-to-sensor profile and returns the normalized typed contract. Unknown
 * enum values, missing required fields and incompatible scientific data are rejected here.
 *
 * The optical bridge turns outgoing scene radiance (W/m²/sr/nm) into irradiance (W/m²/nm) arriving
 * at the front of the sensor stack.
 * - Circular paraxial acceptance is pi/(4*Nworking²). At finite focus with unit pupil magnification,
 *   the working f-number is N*(1+m).
 * - Spectral transmission and an effective working T-stop are alternative paths; use one.
 * - Field throughput is applied exactly once.
 * - Sensor response and PSF (point-spread function) blur happen later in the pipeline.
 * @param value - unknown. Untrusted input; TypeScript types alone are not validation.
 * @returns SceneToSensorIrradianceProfile. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function parseSceneToSensorIrradianceProfile(
  value: unknown
): SceneToSensorIrradianceProfile {
  const record =
    requireRecord(
      value,
      "sceneToSensorIrradianceProfile", ["schemaVersion", "applicability", "scientificStatus", "transmission", "distortionAreaMappingOwnership", "psfRedistributionOwnership", "sensorOpticalStackIncluded", "strayLightIncluded", "polarizationModeled", "wavelengthChangingBehaviorModeled", "volumetricScatteringModeled", "profileId", "profileVersion", "lensProfileId", "evidence", "limitations"]
    );
  if (
    record.schemaVersion !==
    SCENE_TO_SENSOR_IRRADIANCE_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sceneToSensorIrradianceProfile.schemaVersion must be "' +
        SCENE_TO_SENSOR_IRRADIANCE_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }

  const applicability =
    requireRecord(
      record.applicability,
      "sceneToSensorIrradianceProfile.applicability", ["focalLengthMm", "nominalFNumber", "focus"]
    );
  const status =
    parseScientificStatus(
      record.scientificStatus,
      "sceneToSensorIrradianceProfile.scientificStatus"
    );
  const transmission =
    parseTransmission(
      record.transmission,
      "sceneToSensorIrradianceProfile.transmission"
    );

  if (
    status === "calibrated" &&
    transmission.scientificStatus !==
      "calibrated"
  ) {
    throw new InvalidConfigurationError(
      "A calibrated optical bridge profile requires calibrated spectral transmission."
    );
  }

  if (
    record.distortionAreaMappingOwnership !==
      "not-applied-by-bridge" ||
    record.psfRedistributionOwnership !==
      "downstream-normalized-energy-redistribution" ||
    record.sensorOpticalStackIncluded !==
      false ||
    record.strayLightIncluded !==
      false ||
    record.polarizationModeled !==
      false ||
    record.wavelengthChangingBehaviorModeled !==
      false ||
    record.volumetricScatteringModeled !==
      false
  ) {
    throw new InvalidConfigurationError(
      "sceneToSensorIrradianceProfile ownership/completeness flags are invalid for schema 0.1.0."
    );
  }

  return {
    schemaVersion:
      SCENE_TO_SENSOR_IRRADIANCE_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "sceneToSensorIrradianceProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "sceneToSensorIrradianceProfile.profileVersion"
      ),
    lensProfileId:
      requireNonEmptyString(
        record.lensProfileId,
        "sceneToSensorIrradianceProfile.lensProfileId"
      ),
    scientificStatus: status,
    applicability: {
      focalLengthMm:
        parseRange(
          applicability.focalLengthMm,
          "sceneToSensorIrradianceProfile.applicability.focalLengthMm"
        ),
      nominalFNumber:
        parseRange(
          applicability.nominalFNumber,
          "sceneToSensorIrradianceProfile.applicability.nominalFNumber"
        ),
      focus:
        parseFocusApplicability(
          applicability.focus,
          "sceneToSensorIrradianceProfile.applicability.focus"
        )
    },
    transmission,
    distortionAreaMappingOwnership:
      "not-applied-by-bridge",
    psfRedistributionOwnership:
      "downstream-normalized-energy-redistribution",
    sensorOpticalStackIncluded:
      false,
    strayLightIncluded: false,
    polarizationModeled: false,
    wavelengthChangingBehaviorModeled:
      false,
    volumetricScatteringModeled:
      false,
    evidence:
      parseEvidenceList(
        record.evidence,
        "sceneToSensorIrradianceProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "sceneToSensorIrradianceProfile.limitations"
      )
  };
}

function ensureWithin(
  value: number,
  range: NumericRange,
  path: string
): void {
  if (
    value < range.minimum ||
    value > range.maximum
  ) {
    throw new InvalidScientificInputError(
      path +
        " lies outside the optical profile applicability range."
    );
  }
}

/**
 * Internal (2.6; not exported from the package): N_w / N = 1 + m for an ideal symmetric thin lens with unity pupil
 * magnification focused at `objectDistanceM`, m = v/s from `calculateThinLensImageDistance`. The irradiance bridge's
 * `ideal-symmetric-thin-lens` focus uses exactly this factor, and the framing reports derive their close-up light
 * factor 1/(1 + m)² from it, so the two cannot drift apart.
 */
export function thinLensWorkingFNumberFactor(focalLengthMm: number, objectDistanceM: number): number {
  return 1 + calculateThinLensImageDistance({ focalLengthMm, objectDistanceM }).value.magnification;
}

function workingFNumber(
  focus:
    OpticalBridgeFocusContext,
  focalLengthMm: number,
  nominalFNumber: number
): {
  value: number;
  evidence:
    readonly EvidenceProvenance[];
} {
  if (
    focus.kind === "infinity-focus"
  ) {
    return {
      value: nominalFNumber,
      evidence: []
    };
  }

  if (
    focus.kind ===
    "ideal-symmetric-thin-lens"
  ) {
    if (
      focus
        .pupilMagnificationAssumption !==
      "unity"
    ) {
      throw new InvalidScientificInputError(
        'Ideal symmetric thin-lens focus requires pupilMagnificationAssumption "unity".'
      );
    }
    return {
      value:
        nominalFNumber *
        thinLensWorkingFNumberFactor(focalLengthMm, focus.objectDistanceM),
      evidence: []
    };
  }

  if (
    focus.kind ===
    "supplied-working-f-number"
  ) {
    const value =
      requirePositiveFiniteScientific(
        focus.workingFNumber.value,
        "focus.workingFNumber.value"
      );
    return {
      value,
      evidence:
        parseEvidenceList(
          focus.workingFNumber.evidence,
          "focus.workingFNumber.evidence"
        )
    };
  }

  throw new InvalidConfigurationError(
    "focus.kind is invalid."
  );
}

function finiteFocusDistance(
  focus:
    OpticalBridgeFocusContext
): number | null {
  if (
    focus.kind ===
    "ideal-symmetric-thin-lens"
  ) {
    return requirePositiveFiniteScientific(
      focus.objectDistanceM,
      "focus.objectDistanceM"
    );
  }
  if (
    focus.kind ===
      "supplied-working-f-number" &&
    focus.focus.kind === "finite"
  ) {
    return requirePositiveFiniteScientific(
      focus.focus.objectDistanceM,
      "focus.focus.objectDistanceM"
    );
  }
  return null;
}

function interpolateTransmission(
  model:
    Extract<
      OpticalTransmissionModel,
      { kind: "spectral-transmission" }
    >,
  wavelengthNanometers: number
): number {
  const samples =
    model.samples.value;
  const first =
    samples[0]!;
  const last =
    samples[
      samples.length - 1
    ]!;

  if (
    wavelengthNanometers <
      first.wavelengthNanometers ||
    wavelengthNanometers >
      last.wavelengthNanometers
  ) {
    throw new InvalidScientificInputError(
      "Scene wavelength lies outside the spectral transmission sample range."
    );
  }

  if (
    wavelengthNanometers ===
    first.wavelengthNanometers
  ) {
    return first
      .linearTransmissionFactor;
  }

  for (
    let index = 1;
    index < samples.length;
    index += 1
  ) {
    const right =
      samples[index]!;
    if (
      wavelengthNanometers <=
      right.wavelengthNanometers
    ) {
      const left =
        samples[index - 1]!;
      if (
        wavelengthNanometers ===
        right.wavelengthNanometers
      ) {
        return right
          .linearTransmissionFactor;
      }
      const phase =
        (wavelengthNanometers -
          left.wavelengthNanometers) /
        (right.wavelengthNanometers -
          left.wavelengthNanometers);
      return (
        left
          .linearTransmissionFactor +
        phase *
          (right
              .linearTransmissionFactor -
            left
              .linearTransmissionFactor)
      );
    }
  }

  return last
    .linearTransmissionFactor;
}

function fieldFactor(
  field:
    OpticalBridgeFieldThroughput,
  imagePointMm: {
    x: number;
    y: number;
  }
): number {
  if (field.kind === "unity") {
    return 1;
  }
  if (
    field.kind ===
    "illumination-vignetting-result"
  ) {
    const result =
      field.result;
    const scale = Math.max(
      1,
      Math.abs(imagePointMm.x),
      Math.abs(imagePointMm.y),
      Math.abs(result.imagePointMm.x),
      Math.abs(result.imagePointMm.y)
    );
    const tolerance =
      Number.EPSILON *
      64 *
      scale;
    if (
      Math.abs(
        result.imagePointMm.x -
          imagePointMm.x
      ) > tolerance ||
      Math.abs(
        result.imagePointMm.y -
          imagePointMm.y
      ) > tolerance
    ) {
      throw new InvalidScientificInputError(
        "Illumination-vignetting result imagePointMm must match the optical bridge imagePointMm."
      );
    }
    const factor =
      result.linearThroughputFactor;
    if (
      !Number.isFinite(factor) ||
      factor <= 0 ||
      factor > 1
    ) {
      throw new InvalidScientificInputError(
        "Field throughput factor must be finite and in (0, 1]."
      );
    }
    return factor;
  }
  throw new InvalidConfigurationError(
    "fieldThroughput.kind is invalid."
  );
}

function validateSceneIdentity(
  request:
    SceneRadianceEvaluationRequest,
  result:
    SceneRadianceEvaluationResult
): void {
  if (
    request.sampleId !==
      result.sampleId ||
    request.providerProfileId !==
      result.providerProfileId ||
    request.sceneId !==
      result.sceneId ||
    request.wavelengthNanometers !==
      result.wavelengthNanometers ||
    request.wavelengthBasis !==
      result.wavelengthBasis
  ) {
    throw new InvalidScientificInputError(
      "Scene-radiance request/result identity must match exactly."
    );
  }
}

/**
 * The request-independent part of {@link calculateSceneRadianceToSensorIrradiance}: the profile, focal length, f-number,
 * applicability, focus and working f-number checks and the paraxial acceptance, in the public function's order.
 */
interface PreparedSceneRadianceToSensorIrradiance {
  profile: ReturnType<typeof parseSceneToSensorIrradianceProfile>;
  focalLengthMm: number;
  nominalFNumber: number;
  working: ReturnType<typeof workingFNumber>;
  workingFNumberValue: number;
  geometricAcceptance: number;
  transmission: ReturnType<typeof parseSceneToSensorIrradianceProfile>["transmission"];
}

function prepareSceneRadianceToSensorIrradiance(
  input: Pick<CalculateSceneRadianceToSensorIrradianceInput, "profile" | "focalLengthMm" | "nominalFNumber" | "focus">
): PreparedSceneRadianceToSensorIrradiance {
  const profile =
    parseSceneToSensorIrradianceProfile(
      input.profile
    );
  const focalLengthMm =
    requirePositiveFiniteScientific(
      input.focalLengthMm,
      "focalLengthMm"
    );
  const nominalFNumber =
    requirePositiveFiniteScientific(
      input.nominalFNumber,
      "nominalFNumber"
    );

  ensureWithin(
    focalLengthMm,
    profile.applicability
      .focalLengthMm,
    "focalLengthMm"
  );
  ensureWithin(
    nominalFNumber,
    profile.applicability
      .nominalFNumber,
    "nominalFNumber"
  );

  const focusDistanceM =
    finiteFocusDistance(input.focus);
  if (
    profile.applicability.focus.kind ===
      "finite-distance-range"
  ) {
    if (focusDistanceM === null) {
      throw new InvalidScientificInputError(
        "Optical profile requires a finite focus distance."
      );
    }
    ensureWithin(
      focusDistanceM,
      profile.applicability
        .focus.objectDistanceM,
      "focus object distance"
    );
  }

  const working =
    workingFNumber(
      input.focus,
      focalLengthMm,
      nominalFNumber
    );
  const workingFNumberValue =
    working.value;
  const geometricAcceptance =
    Math.PI /
    (4 *
      workingFNumberValue *
      workingFNumberValue);

  if (
    !Number.isFinite(
      geometricAcceptance
    ) ||
    geometricAcceptance <= 0
  ) {
    throw new InvalidScientificInputError(
      "Paraxial geometric acceptance must remain finite and greater than zero."
    );
  }

  const transmission =
    profile.transmission;
  return { profile, focalLengthMm, nominalFNumber, working, workingFNumberValue, geometricAcceptance, transmission };
}

interface AppliedSceneRadianceToSensorIrradiance {
  spectralTransmissionFactor: number | null;
  effectiveWorkingTStop: number | null;
  tStopEquivalentTransmissionFactor: number | null;
  effectiveAcceptance: number;
  transmissionEvidence: readonly EvidenceProvenance[];
  frontOfLensFilterCount: number;
  frontOfLensFilterPolarizationModeled: boolean;
  frontOfLensFilterTransmissionFactor: number;
  frontOfLensFilterAttenuationStops: number;
  frontOfLensFilterEvidence: readonly EvidenceProvenance[];
  frontOfLensFilterLimitations: readonly string[];
  fieldThroughputFactor: number;
  sceneRadiance: number;
  irradiance: number;
}

/**
 * The per-query part of {@link calculateSceneRadianceToSensorIrradiance}, after the request and result are parsed and their
 * identities matched: the wavelength-basis check, the transmission or T-stop path, the front-of-lens filters, the field
 * throughput and the irradiance, with the same operations in the same order.
 */
function applySceneRadianceToSensorIrradiance(
  prepared: PreparedSceneRadianceToSensorIrradiance,
  input: Pick<CalculateSceneRadianceToSensorIrradianceInput, "imagePointMm" | "fieldThroughput"> &
    { frontOfLensFilters?: readonly FrontOfLensFilterProfile[] | undefined },
  request: SceneRadianceEvaluationRequest,
  sceneResult: SceneRadianceEvaluationResult
): AppliedSceneRadianceToSensorIrradiance {
  const { workingFNumberValue, geometricAcceptance, transmission } = prepared;
  if (
    request.wavelengthBasis !==
    transmission.wavelengthBasis
  ) {
    throw new InvalidScientificInputError(
      "Scene-radiance and optical-transmission wavelength bases must match; implicit air/vacuum conversion is not performed."
    );
  }

  let spectralTransmissionFactor:
    number | null = null;
  let effectiveWorkingTStop:
    number | null = null;
  let tStopEquivalentTransmissionFactor:
    number | null = null;
  let effectiveAcceptance =
    geometricAcceptance;
  let transmissionEvidence:
    readonly EvidenceProvenance[];

  if (
    transmission.kind ===
    "spectral-transmission"
  ) {
    spectralTransmissionFactor =
      interpolateTransmission(
        transmission,
        request.wavelengthNanometers
      );
    effectiveAcceptance *=
      spectralTransmissionFactor;
    transmissionEvidence =
      transmission.samples.evidence;
  } else {
    ensureWithin(
      request.wavelengthNanometers,
      transmission
        .wavelengthRangeNanometers,
      "scene wavelength"
    );
    effectiveWorkingTStop =
      transmission.workingTStop.value;
    if (
      effectiveWorkingTStop <
      workingFNumberValue
    ) {
      throw new InvalidScientificInputError(
        "effective working T-stop must not be smaller than the geometric working f-number for a passive optical approximation."
      );
    }
    tStopEquivalentTransmissionFactor =
      (workingFNumberValue /
        effectiveWorkingTStop) **
      2;
    effectiveAcceptance =
      Math.PI /
      (4 *
        effectiveWorkingTStop *
        effectiveWorkingTStop);
    transmissionEvidence =
      transmission
        .workingTStop.evidence;
  }

  let frontOfLensFilterCount = 0;
  let frontOfLensFilterPolarizationModeled = false;
  let frontOfLensFilterTransmissionFactor = 1;
  let frontOfLensFilterAttenuationStops = 0;
  let frontOfLensFilterEvidence:
    readonly EvidenceProvenance[] = [];
  let frontOfLensFilterLimitations:
    readonly string[] = [];

  if (
    input.frontOfLensFilters !==
    undefined
  ) {
    const composed =
      composeFrontOfLensFilterTransmission({
        filters:
          input.frontOfLensFilters,
        wavelengthNanometers:
          request.wavelengthNanometers,
        wavelengthBasis:
          request.wavelengthBasis
      });
    frontOfLensFilterCount =
      composed.appliedFilterCount;
    frontOfLensFilterPolarizationModeled =
      composed.polarizationModeled;
    frontOfLensFilterTransmissionFactor =
      composed
        .combinedLinearTransmissionFactor;
    frontOfLensFilterAttenuationStops =
      composed
        .combinedAttenuationStops;
    frontOfLensFilterEvidence =
      composed.components.flatMap(
        (component) =>
          component.evidence
      );
    frontOfLensFilterLimitations =
      composed.components.flatMap(
        (component) =>
          component.limitations
      );
    effectiveAcceptance *=
      frontOfLensFilterTransmissionFactor;
  }

  const fieldThroughputFactor =
    fieldFactor(
      input.fieldThroughput,
      input.imagePointMm
    );
  effectiveAcceptance *=
    fieldThroughputFactor;

  const sceneRadiance =
    sceneResult
      .spectralRadianceWattsPerSquareMeterSteradianNanometer;
  const irradiance =
    sceneRadiance *
    effectiveAcceptance;

  if (
    !Number.isFinite(irradiance) ||
    irradiance < 0
  ) {
    throw new InvalidScientificInputError(
      "Sensor-plane spectral irradiance must remain finite and non-negative."
    );
  }

  return { spectralTransmissionFactor, effectiveWorkingTStop, tStopEquivalentTransmissionFactor, effectiveAcceptance, transmissionEvidence,
    frontOfLensFilterCount, frontOfLensFilterPolarizationModeled, frontOfLensFilterTransmissionFactor, frontOfLensFilterAttenuationStops,
    frontOfLensFilterEvidence, frontOfLensFilterLimitations, fieldThroughputFactor, sceneRadiance, irradiance };
}

/**
 * Internal (#453; not exported from the package): the sensor-plane spectral irradiance that
 * {@link calculateSceneRadianceToSensorIrradiance} returns, for repeated queries of one optical state. This call runs the
 * request-independent checks once (the public function's own code, in its order); each call of the returned function then
 * runs the public function's per-query steps on an engine-built request and a result already parsed by the caller: the identity
 * match, the wavelength-basis check, the transmission or T-stop path, the front-of-lens filters, the field throughput and
 * the finite, non-negative irradiance, with the same operations, order and errors. It skips only the re-validation of the
 * unchanged optical inputs, the re-parse of the request and result, and the result envelope.
 */
export function prepareSceneRadianceToSensorIrradianceValue(
  optics: Pick<CalculateSceneRadianceToSensorIrradianceInput, "profile" | "focalLengthMm" | "nominalFNumber" | "focus" | "frontOfLensFilters">
): (request: SceneRadianceEvaluationRequest, result: SceneRadianceEvaluationResult, imagePointMm: { x: number; y: number },
    fieldThroughput: OpticalBridgeFieldThroughput) => number {
  const prepared = prepareSceneRadianceToSensorIrradiance(optics);
  const frontOfLensFilters = optics.frontOfLensFilters;
  return (request, result, imagePointMm, fieldThroughput) => {
    validateSceneIdentity(request, result);
    return applySceneRadianceToSensorIrradiance(prepared, { imagePointMm, fieldThroughput, frontOfLensFilters }, request, result).irradiance;
  };
}

/**
 * Applies the declared pupil acceptance and exactly one transmission or field-throughput path to
 * spectral scene radiance. Returns the irradiance before the sensor stack, with conservative
 * evidence.
 *
 * The optical bridge turns outgoing scene radiance (W/m²/sr/nm) into irradiance (W/m²/nm) arriving
 * at the front of the sensor stack.
 * - Circular paraxial acceptance is pi/(4*Nworking²). At finite focus with unit pupil magnification,
 *   the working f-number is N*(1+m).
 * - Spectral transmission and an effective working T-stop are alternative paths; use one.
 * - Field throughput is applied exactly once.
 * - Sensor response and PSF (point-spread function) blur happen later in the pipeline.
 * @param input - CalculateSceneRadianceToSensorIrradianceInput. See that type for coordinates, units and profile binding.
 * @returns CalculationResult<
  SceneToSensorIrradianceResult
>. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function calculateSceneRadianceToSensorIrradiance(
  input:
    CalculateSceneRadianceToSensorIrradianceInput
): CalculationResult<
  SceneToSensorIrradianceResult
> {
  requireInputKeys(input, "calculateSceneRadianceToSensorIrradiance", ["sceneRadianceRequest", "sceneRadianceResult", "profile", "focalLengthMm", "nominalFNumber", "focus", "imagePointMm", "fieldThroughput", "frontOfLensFilters"]);
  const request =
    parseSceneRadianceEvaluationRequest(
      input.sceneRadianceRequest
    );
  const sceneResult =
    parseSceneRadianceEvaluationResult(
      input.sceneRadianceResult
    );
  validateSceneIdentity(
    request,
    sceneResult
  );

  const prepared = prepareSceneRadianceToSensorIrradiance(input);
  const { profile, focalLengthMm, nominalFNumber, working, workingFNumberValue, geometricAcceptance, transmission } = prepared;
  const { spectralTransmissionFactor, effectiveWorkingTStop, tStopEquivalentTransmissionFactor, effectiveAcceptance, transmissionEvidence,
    frontOfLensFilterCount, frontOfLensFilterPolarizationModeled, frontOfLensFilterTransmissionFactor, frontOfLensFilterAttenuationStops,
    frontOfLensFilterEvidence, frontOfLensFilterLimitations, fieldThroughputFactor, sceneRadiance, irradiance } =
    applySceneRadianceToSensorIrradiance(prepared, input, request, sceneResult);

  const limitations = [
    ...profile.limitations,
    ...frontOfLensFilterLimitations,
    "Front-of-lens filter transmission is applied outside the lens throughput path exactly once and does not change geometric working f-number.",
    "Paraxial circular-pupil acceptance uses pi/(4*N_working^2); no universal cos^4 field falloff is added.",
    "Field throughput is supplied separately and applied exactly once.",
    "Geometric distortion area-density/Jacobian correction is not applied by this bridge.",
    "PSF/diffraction energy redistribution is downstream and must preserve normalized energy apart from separately owned throughput losses.",
    "Sensor optical stack, microlens, CFA, QE/responsivity and charge conversion are downstream.",
    frontOfLensFilterPolarizationModeled
      ? "Flare, ghosting, veiling glare, scene-radiance polarization (scene light is treated as unpolarized; the front-of-lens linear polarizer transmits (k1 + k2) / 2), volumetric scattering and wavelength-changing behavior are not modeled."
      : "Flare, ghosting, veiling glare, polarization, volumetric scattering and wavelength-changing behavior are not modeled."
  ];

  return approximationResult(
    {
      schemaVersion:
        SCENE_TO_SENSOR_IRRADIANCE_PROFILE_SCHEMA_VERSION,
      profileId: profile.profileId,
      profileVersion:
        profile.profileVersion,
      lensProfileId:
        profile.lensProfileId,
      sampleId: request.sampleId,
      providerProfileId:
        request.providerProfileId,
      sceneId: request.sceneId,
      timeSecondsFromExposureStart:
        request
          .timeSecondsFromExposureStart,
      wavelengthNanometers:
        request.wavelengthNanometers,
      wavelengthBasis:
        request.wavelengthBasis,
      inputQuantity:
        "outgoing-spectral-radiance",
      inputUnit:
        "W/m^2/sr/nm",
      outputQuantity:
        "sensor-plane-spectral-irradiance",
      outputUnit: "W/m^2/nm",
      sceneSpectralRadianceWattsPerSquareMeterSteradianNanometer:
        sceneRadiance,
      focalLengthMm,
      nominalFNumber,
      workingFNumber:
        workingFNumberValue,
      focusModel: input.focus.kind,
      paraxialGeometricAcceptanceSolidAngleSteradians:
        geometricAcceptance,
      transmissionPath:
        transmission.kind,
      spectralTransmissionFactor,
      effectiveWorkingTStop,
      tStopEquivalentTransmissionFactor,
      frontOfLensFilterCount,
      frontOfLensFilterTransmissionFactor,
      frontOfLensFilterAttenuationStops,
      frontOfLensFilterTransmissionAppliedExactlyOnce:
        true,
      frontOfLensFilterPolarizationModeled,
      fieldThroughputFactor,
      effectiveAcceptanceAfterTransmissionAndFieldSteradians:
        effectiveAcceptance,
      sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer:
        irradiance,
      scientificStatus:
        "approximation",
      sceneRadianceScientificStatus:
        sceneResult.scientificStatus,
      opticalProfileScientificStatus:
        profile.scientificStatus,
      sceneRadianceUncertainty:
        sceneResult.uncertainty,
      opticalUncertainty:
        transmission.uncertainty,
      radianceAmplificationApplied:
        false,
      fieldThroughputAppliedExactlyOnce:
        true,
      universalCos4FalloffApplied:
        false,
      distortionAreaCorrectionApplied:
        false,
      psfRedistributionApplied:
        false,
      sensorOpticalStackApplied:
        false,
      cfaApplied: false,
      quantumEfficiencyApplied: false,
      spectralResponsivityApplied:
        false,
      strayLightApplied: false,
      polarizationModeled: false,
      wavelengthChangingBehaviorModeled:
        false,
      volumetricScatteringModeled:
        false,
      calibratedSensorPlaneIrradianceClaimAuthorized:
        false,
      componentEvidence: {
        sceneRadiance:
          sceneResult.evidence,
        opticalProfile:
          profile.evidence,
        transmission:
          transmissionEvidence,
        workingFNumber:
          working.evidence,
        frontOfLensFilters:
          frontOfLensFilterEvidence
      },
      limitations
    },
    "scene-radiance-to-sensor-irradiance",
    "1.1.0",
    limitations
  );
}
