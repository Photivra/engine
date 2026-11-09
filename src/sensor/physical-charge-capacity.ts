// SPDX-License-Identifier: Apache-2.0

/**
 * Physical charge capacity (full-well capacity): the most electrons a sensor site can physically
 * store, and a check of the expected charge against it.
 *
 * The capacity is the total stored-electron limit given by a specific source, for a specific site,
 * operating state and temperature. The check compares the complete expected charge with it. It does
 * not clip random (noise) realizations and does not model overflow or blooming. Camera saturation
 * capacity and ADC or readout thresholds are separate limits.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type {
  SensorPhotoAccumulatedChargeComposition as SensorAccumulatedChargeComposition
} from "./accumulated-charge.js";
import type {
  SensorSpectralResponseScientificStatus,
  SensorSpectralResponseUncertainty
} from "./spectral-response.js";
import { requireInputObject, requireInputKeys, rejectUnknownVariantFields, requireConfigRecord as requireRecord, requireConfigFinite as requireFinite, requireConfigString as requireNonEmptyString, requireInputNonNegativeFinite as requireNonNegativeFiniteInput, requireConfigNonNegativeSafeInteger as requireSiteIndex, requireConfigFiniteAboveZero as requirePositiveFinite } from "../core/record-validation.js";
import { sameSite } from "../core/shared-helpers.js";
import { parseUncertainty } from "./camera-saturation-capacity.js";

export type SensorPhysicalChargeCapacitySiteApplicability =
  | {
      kind: "exact-site";
      site: {
        x: number;
        y: number;
      };
    }
  | {
      kind:
        "uniform-site-capacity-approximation";
      limitation: string;
      evidence:
        readonly EvidenceProvenance[];
    };

export type SensorPhysicalChargeCapacityTemperatureApplicability =
  | {
      kind:
        "exact-reference-temperature";
      temperatureC: number;
    }
  | {
      kind: "not-modeled";
      limitation: string;
      evidence:
        readonly EvidenceProvenance[];
    };

export interface SensorPhysicalChargeCapacityProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  capacityMeaning:
    "physical-charge-storage-capacity-electrons";
  capacityElectrons: number;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  evidence:
    readonly EvidenceProvenance[];
  siteApplicability:
    SensorPhysicalChargeCapacitySiteApplicability;
  operatingState: {
    stateId: string;
    evidence:
      readonly EvidenceProvenance[];
  };
  temperatureApplicability:
    SensorPhysicalChargeCapacityTemperatureApplicability;
}

export interface AssessSensorPhysicalChargeCapacityInput {
  accumulatedCharge:
    SensorAccumulatedChargeComposition;
  capacityProfile:
    SensorPhysicalChargeCapacityProfile;
  operatingStateId: string;
  operatingTemperatureC: number;
}

export interface SensorPhysicalChargeCapacityAssessment {
  capacityProfileId: string;
  completenessProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  operatingStateId: string;
  operatingTemperatureC: number;
  capacityMeaning:
    "physical-charge-storage-capacity-electrons";
  physicalChargeCapacityElectrons:
    number;
  totalExpectedStoredElectronCount:
    number;
  expectedChargeToCapacityRatio:
    number;
  expectedChargeHeadroomElectrons:
    number;
  expectedChargeCapacityStatus:
    | "below-capacity"
    | "at-capacity"
    | "above-capacity";
  expectedChargeExceedsCapacity:
    boolean;
  physicalChargeCapacityAssessmentPerformed:
    true;
  assessmentMeaning:
    "expected-charge-vs-physical-storage-capacity";
  actualStochasticSaturationStateKnown:
    false;
  stochasticSaturationProbabilityAssessed:
    false;
  storedChargeAfterPhysicalSaturationCalculated:
    false;
  overflowChargeCalculated: false;
  bloomingModeled: false;
  clampApplied: false;
  cameraSaturationAssessmentAuthorized:
    false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  capacityUncertaintyPropagated:
    false;
  accumulatedChargeUncertaintyPropagated:
    false;
  componentEvidence: {
    capacity:
      readonly EvidenceProvenance[];
    operatingState:
      readonly EvidenceProvenance[];
    siteApproximation:
      readonly EvidenceProvenance[];
    temperatureApproximation:
      readonly EvidenceProvenance[];
    chargeCompleteness:
      SensorAccumulatedChargeComposition["componentEvidence"]["completeness"];
  };
}

function parseSiteApplicability(
  value: unknown
): SensorPhysicalChargeCapacitySiteApplicability {
  const record = requireRecord(
    value,
    "sensorPhysicalChargeCapacity.siteApplicability", null
  );
  rejectUnknownVariantFields(record, "kind", { "exact-site": ["kind", "site"], "uniform-site-capacity-approximation": ["kind", "limitation", "evidence"] }, "sensorPhysicalChargeCapacity.siteApplicability");
  if (record.kind === "exact-site") {
    const site = requireRecord(
      record.site,
      "sensorPhysicalChargeCapacity.siteApplicability.site", ["x", "y"]
    );
    return {
      kind: "exact-site",
      site: {
        x: requireSiteIndex(
          site.x,
          "sensorPhysicalChargeCapacity.siteApplicability.site.x"
        ),
        y: requireSiteIndex(
          site.y,
          "sensorPhysicalChargeCapacity.siteApplicability.site.y"
        )
      }
    };
  }
  if (
    record.kind ===
      "uniform-site-capacity-approximation"
  ) {
    return {
      kind:
        "uniform-site-capacity-approximation",
      limitation:
        requireNonEmptyString(
          record.limitation,
          "sensorPhysicalChargeCapacity.siteApplicability.limitation"
        ),
      evidence: parseEvidenceList(
        record.evidence,
        "sensorPhysicalChargeCapacity.siteApplicability.evidence"
      )
    };
  }
  throw new InvalidConfigurationError(
    "sensorPhysicalChargeCapacity.siteApplicability.kind is invalid."
  );
}

function parseTemperatureApplicability(
  value: unknown
): SensorPhysicalChargeCapacityTemperatureApplicability {
  const record = requireRecord(
    value,
    "sensorPhysicalChargeCapacity.temperatureApplicability", null
  );
  rejectUnknownVariantFields(record, "kind", { "exact-reference-temperature": ["kind", "temperatureC"], "not-modeled": ["kind", "limitation", "evidence"] }, "sensorPhysicalChargeCapacity.temperatureApplicability");
  if (
    record.kind ===
      "exact-reference-temperature"
  ) {
    return {
      kind:
        "exact-reference-temperature",
      temperatureC:
        requireFinite(
          record.temperatureC,
          "sensorPhysicalChargeCapacity.temperatureApplicability.temperatureC"
        )
    };
  }
  if (record.kind === "not-modeled") {
    return {
      kind: "not-modeled",
      limitation:
        requireNonEmptyString(
          record.limitation,
          "sensorPhysicalChargeCapacity.temperatureApplicability.limitation"
        ),
      evidence: parseEvidenceList(
        record.evidence,
        "sensorPhysicalChargeCapacity.temperatureApplicability.evidence"
      )
    };
  }
  throw new InvalidConfigurationError(
    "sensorPhysicalChargeCapacity.temperatureApplicability.kind is invalid."
  );
}

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The capacity is a total stored-electron limit from a specific source, tied to a site, operating
 * state and temperature. Camera saturation capacity and ADC or readout thresholds are separate.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseSensorPhysicalChargeCapacityProfile(
  value: unknown
): SensorPhysicalChargeCapacityProfile {
  const record = requireRecord(
    value,
    "sensorPhysicalChargeCapacity", ["schemaVersion", "capacityMeaning", "scientificStatus", "uncertainty", "siteApplicability", "temperatureApplicability", "operatingState", "profileId", "colorSamplingProfileId", "channelId", "capacityElectrons", "evidence"]
  );
  if (
    record.schemaVersion !== "0.1.0"
  ) {
    throw new InvalidConfigurationError(
      'sensorPhysicalChargeCapacity.schemaVersion must be "0.1.0".'
    );
  }
  if (
    record.capacityMeaning !==
      "physical-charge-storage-capacity-electrons"
  ) {
    throw new InvalidConfigurationError(
      "sensorPhysicalChargeCapacity.capacityMeaning is invalid."
    );
  }
  if (
    record.scientificStatus !==
      "calibrated" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      "sensorPhysicalChargeCapacity.scientificStatus is invalid."
    );
  }

  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      "sensorPhysicalChargeCapacity.uncertainty"
    );
  if (
    record.scientificStatus ===
      "calibrated" &&
    uncertainty.kind ===
      "not-quantified"
  ) {
    throw new InvalidConfigurationError(
      "A calibrated physical charge-capacity profile must declare quantified relative uncertainty."
    );
  }

  const siteApplicability =
    parseSiteApplicability(
      record.siteApplicability
    );
  const temperatureApplicability =
    parseTemperatureApplicability(
      record.temperatureApplicability
    );

  if (
    siteApplicability.kind ===
      "uniform-site-capacity-approximation" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      "Uniform site charge capacity must remain an approximation."
    );
  }
  if (
    temperatureApplicability.kind ===
      "not-modeled" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      "A capacity with unmodeled temperature dependence must remain an approximation."
    );
  }

  const state =
    requireRecord(
      record.operatingState,
      "sensorPhysicalChargeCapacity.operatingState", ["stateId", "evidence"]
    );

  return {
    schemaVersion: "0.1.0",
    profileId:
      requireNonEmptyString(
        record.profileId,
        "sensorPhysicalChargeCapacity.profileId"
      ),
    colorSamplingProfileId:
      requireNonEmptyString(
        record.colorSamplingProfileId,
        "sensorPhysicalChargeCapacity.colorSamplingProfileId"
      ),
    channelId:
      requireNonEmptyString(
        record.channelId,
        "sensorPhysicalChargeCapacity.channelId"
      ),
    capacityMeaning:
      "physical-charge-storage-capacity-electrons",
    capacityElectrons:
      requirePositiveFinite(
        record.capacityElectrons,
        "sensorPhysicalChargeCapacity.capacityElectrons"
      ),
    scientificStatus:
      record.scientificStatus,
    uncertainty,
    evidence: parseEvidenceList(
      record.evidence,
      "sensorPhysicalChargeCapacity.evidence"
    ),
    siteApplicability,
    operatingState: {
      stateId:
        requireNonEmptyString(
          state.stateId,
          "sensorPhysicalChargeCapacity.operatingState.stateId"
        ),
      evidence: parseEvidenceList(
        state.evidence,
        "sensorPhysicalChargeCapacity.operatingState.evidence"
      )
    },
    temperatureApplicability
  };
}

function validateCharge(
  charge:
    SensorAccumulatedChargeComposition
): number {
  requireInputObject(charge, "charge input");
  if (
    charge
      .physicalFullWellAssessmentAuthorized !==
      true ||
    charge.saturationAssessed !==
      false ||
    charge.bloomingModeled !== false ||
    charge.accumulatedChargeCompleteness !==
      "complete-for-physical-storage-capacity-assessment"
  ) {
    throw new InvalidScientificInputError(
      "Physical capacity assessment requires an unsaturated complete stored-electron composition."
    );
  }
  return requireNonNegativeFiniteInput(
    charge.totalExpectedStoredElectronCount,
    "accumulatedCharge.totalExpectedStoredElectronCount"
  );
}

/**
 * Compares the complete expected stored electrons with the physical capacity that applies, and
 * reports the remaining headroom in expected electrons. Non-linear storage is not simulated.
 *
 * It does not clip random realizations and does not model overflow or blooming.
 * @param input - The input; see `AssessSensorPhysicalChargeCapacityInput` for its fields, units and coordinates.
 * @returns The assessment. Read its structured blockers before acting on an authorization.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function assessSensorPhysicalChargeCapacity(
  input:
    AssessSensorPhysicalChargeCapacityInput
): CalculationResult<SensorPhysicalChargeCapacityAssessment> {
  requireInputKeys(input, "assessSensorPhysicalChargeCapacity", ["accumulatedCharge", "capacityProfile", "operatingStateId", "operatingTemperatureC"]);
  const totalExpectedStoredElectronCount =
    validateCharge(
      input.accumulatedCharge
    );
  const profile =
    parseSensorPhysicalChargeCapacityProfile(
      input.capacityProfile
    );

  if (
    profile.colorSamplingProfileId !==
      input.accumulatedCharge
        .colorSamplingProfileId ||
    profile.channelId !==
      input.accumulatedCharge.channelId
  ) {
    throw new InvalidScientificInputError(
      "Physical charge-capacity profile color/channel identity must match the accumulated charge."
    );
  }
  if (
    profile.siteApplicability.kind ===
      "exact-site" &&
    !sameSite(
      profile.siteApplicability.site,
      input.accumulatedCharge.site
    )
  ) {
    throw new InvalidScientificInputError(
      "Exact-site physical charge capacity does not apply to the accumulated-charge site."
    );
  }
  if (
    typeof input.operatingStateId !==
      "string" ||
    input.operatingStateId.trim().length ===
      0 ||
    input.operatingStateId !==
      profile.operatingState.stateId
  ) {
    throw new InvalidScientificInputError(
      "operatingStateId must exactly match the physical charge-capacity calibration state."
    );
  }
  if (
    typeof input.operatingTemperatureC !==
      "number" ||
    !Number.isFinite(
      input.operatingTemperatureC
    )
  ) {
    throw new InvalidScientificInputError(
      "operatingTemperatureC must be finite."
    );
  }
  if (
    profile.temperatureApplicability.kind ===
      "exact-reference-temperature" &&
    input.operatingTemperatureC !==
      profile.temperatureApplicability
        .temperatureC
  ) {
    throw new InvalidScientificInputError(
      "operatingTemperatureC must exactly match the physical charge-capacity reference temperature."
    );
  }

  const capacity =
    profile.capacityElectrons;
  const ratio =
    totalExpectedStoredElectronCount /
    capacity;
  const headroom =
    capacity -
    totalExpectedStoredElectronCount;
  if (
    !Number.isFinite(ratio) ||
    !Number.isFinite(headroom)
  ) {
    throw new InvalidScientificInputError(
      "Physical charge-capacity comparison must remain finite."
    );
  }

  const status =
    totalExpectedStoredElectronCount <
      capacity
      ? "below-capacity"
      : totalExpectedStoredElectronCount ===
          capacity
        ? "at-capacity"
        : "above-capacity";

  const result:
    SensorPhysicalChargeCapacityAssessment = {
      capacityProfileId:
        profile.profileId,
      completenessProfileId:
        input.accumulatedCharge
          .completenessProfileId,
      colorSamplingProfileId:
        input.accumulatedCharge
          .colorSamplingProfileId,
      channelId:
        input.accumulatedCharge.channelId,
      site: {
        ...input.accumulatedCharge.site
      },
      bindingId:
        input.accumulatedCharge.bindingId,
      operatingStateId:
        input.operatingStateId,
      operatingTemperatureC:
        input.operatingTemperatureC,
      capacityMeaning:
        "physical-charge-storage-capacity-electrons",
      physicalChargeCapacityElectrons:
        capacity,
      totalExpectedStoredElectronCount,
      expectedChargeToCapacityRatio:
        ratio,
      expectedChargeHeadroomElectrons:
        headroom,
      expectedChargeCapacityStatus:
        status,
      expectedChargeExceedsCapacity:
        status === "above-capacity",
      physicalChargeCapacityAssessmentPerformed:
        true,
      assessmentMeaning:
        "expected-charge-vs-physical-storage-capacity",
      actualStochasticSaturationStateKnown:
        false,
      stochasticSaturationProbabilityAssessed:
        false,
      storedChargeAfterPhysicalSaturationCalculated:
        false,
      overflowChargeCalculated: false,
      bloomingModeled: false,
      clampApplied: false,
      cameraSaturationAssessmentAuthorized:
        false,
      adcQuantizationApplied: false,
      rawCodeValueProduced: false,
      capacityUncertaintyPropagated:
        false,
      accumulatedChargeUncertaintyPropagated:
        false,
      componentEvidence: {
        capacity:
          profile.evidence,
        operatingState:
          profile.operatingState
            .evidence,
        siteApproximation:
          profile.siteApplicability.kind ===
            "uniform-site-capacity-approximation"
            ? profile
                .siteApplicability
                .evidence
            : [],
        temperatureApproximation:
          profile.temperatureApplicability.kind ===
            "not-modeled"
            ? profile
                .temperatureApplicability
                .evidence
            : [],
        chargeCompleteness:
          input.accumulatedCharge
            .componentEvidence
            .completeness
      }
    };

  return approximationResult(
    result,
    "sensor-physical-charge-capacity-assessment",
    "1.0.0",
    [
      "The capacity is a source-specific physical charge-storage limit in electrons, not EMVA camera saturation capacity and not an ADC/digital clipping threshold.",
      "The comparison uses total expected stored electrons after evidence-backed charge completeness. It does not claim a stochastic realization is certainly below or above capacity.",
      "Expected charge below capacity does not rule out stochastic saturation; expected charge above capacity indicates the unsaturated linear expectation exceeds the declared physical storage limit.",
      "No clamp is applied and stored charge after physical saturation is not calculated because the nonlinear overflow/recombination behavior is not modeled.",
      "Blooming direction, neighbor redistribution and anti-blooming behavior require a separate spatial charge-transfer model and are not inferred from excess expected charge.",
      "The operating-state identifier is an exact calibration-state key; Photivra does not infer physical capacity from ISO, gain labels, capture mode names or adjacent specifications.",
      "A capacity that is uniform across sites or has unmodeled temperature dependence remains an explicit approximation.",
      "Capacity and accumulated-charge uncertainties are preserved upstream but are not propagated into a saturation probability or confidence interval by this version.",
      "Camera/analog/digital saturation remains a separate downstream response-chain contract."
    ]
  );
}
