// SPDX-License-Identifier: Apache-2.0

/**
 * Responsivity photocurrent: converts light power to detector current using responsivity in amperes
 * per watt (A/W).
 *
 * For each wavelength bin, current = responsivity × radiant power; the bins are summed. The result is
 * the steady (quasi-static) current magnitude at the detector terminals. The electrical bias and load
 * conditions under which the responsivity applies are explicit. This is not EQE, an electron rate, a
 * transimpedance voltage or RAW. Fast-changing current needs a separate time-dependent detector model.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { stringifyCanonicalJson } from "../core/canonical-json.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  parseSensorColorSamplingProfile,
  type SensorColorSamplingProfile
} from "./color-sampling.js";
import type {
  SensorResponseApplicationCompatibilityAssessment
} from "./response-application-compatibility.js";
import type {
  SensorResponseOperatingRangeAssessment
} from "./response-operating-range.js";
import {
  createSensorSpectralResponseChannelBinding,
  requireCurrentSensorSpectralResponseChannelBinding,
  parseSensorSpectralResponseProfile,
  resolveParsedSensorSpectralResponseAtWavelength,
  type ResolvedSensorSpectralResponse,
  type SensorSpectralResponseProfile,
  type SensorSpectralResponseScientificStatus,
  type SensorSpectralResponseUncertainty
} from "./spectral-response.js";
import type {
  SensorSpatioSpectralIrradianceReduction,
  SensorSpatioSpectralWavelengthReduction
} from "./spatio-spectral-reduction.js";
import { requireInputObject, requireInputKeys, rejectUnknownVariantFields, requireConfigRecord as requireRecord, requireConfigString as requireNonEmptyString, requireConfigPositiveFinite as requirePositiveFiniteConfiguration, requireInputNonNegativeFinite as requireNonNegativeFiniteInput, requireInputPositiveFinite as requirePositiveFiniteInput, requireInputNonNegativeSafeInteger as requireSafeNonNegativeInteger } from "../core/record-validation.js";
import { addCompensated, approximatelyEqual } from "../core/shared-helpers.js";
import { parseReferenceConditionPolicy as parseConditionPolicy } from "./response-application-compatibility.js";
import { parseUncertainty } from "./response-operating-range.js";


export type SensorResponsivityBiasCondition =
  | {
      kind: "zero-bias-photovoltaic";
    }
  | {
      kind: "reverse-biased";
      magnitudeVolts: number;
    };

export type SensorResponsivityReadoutLoadCondition =
  | {
      kind: "virtual-ground-current-readout";
    }
  | {
      kind: "finite-input-impedance";
      inputImpedanceOhms: number;
    };

export interface SensorResponsivityElectricalConditions {
  bias: SensorResponsivityBiasCondition;
  readoutLoad:
    SensorResponsivityReadoutLoadCondition;
}

export type SensorResponsivityElectricalConditionPolicy =
  | {
      kind: "exact-match-required";
    }
  | {
      kind: "assume-compatible";
      limitation: string;
      evidence: readonly EvidenceProvenance[];
    };

export interface SensorResponsivityElectricalApplicabilityProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  responseApplicationProfileId: string;
  spectralResponseProfileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  outputMeaning:
    "detector-terminal-photocurrent-magnitude";
  referenceConditions:
    SensorResponsivityElectricalConditions;
  conditionPolicy:
    SensorResponsivityElectricalConditionPolicy;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  evidence: readonly EvidenceProvenance[];
}

export interface CalculateSensorResponsivityPhotocurrentInput {
  reduction:
    SensorSpatioSpectralIrradianceReduction;
  compatibility:
    SensorResponseApplicationCompatibilityAssessment;
  operatingRange:
    SensorResponseOperatingRangeAssessment;
  colorSamplingProfile:
    SensorColorSamplingProfile;
  spectralResponseProfile:
    SensorSpectralResponseProfile;
  electricalApplicabilityProfile:
    SensorResponsivityElectricalApplicabilityProfile;
  operatingElectricalConditions:
    SensorResponsivityElectricalConditions;
}

export interface SensorResponsivityWavelengthCurrentContribution {
  spectralSampleIndex: number;
  wavelengthNanometers: number;
  wavelengthMeasureNanometers: number;
  geometricApertureIncidentSpectralFluxWattsPerNanometer:
    number;
  radiantPowerContributionWatts: number;
  spectralResponsivityAmperesPerWatt:
    number;
  responseInterpolationUsed: boolean;
  photocurrentMagnitudeContributionAmperes:
    number;
}

export interface SensorResponsivityPhotocurrent {
  colorSamplingProfileId: string;
  responseProfileId: string;
  responseApplicationProfileId: string;
  operatingRangeProfileId: string;
  electricalApplicabilityProfileId:
    string;
  /** The exact source colour site. Results produced by the engine fill this in. */
  site?: {
    x: number;
    y: number;
  };
  channelId: string;
  sourceResponseKind:
    "effective-spectral-responsivity";
  responseScope:
    SensorSpatioSpectralIrradianceReduction["responseScope"];
  responseReferencePlane:
    SensorResponseApplicationCompatibilityAssessment["requiredSourcePlane"];
  wavelengthBasis:
    SensorSpatioSpectralIrradianceReduction["wavelengthBasis"];
  wavelengthRangeNanometers:
    SensorSpatioSpectralIrradianceReduction["wavelengthRangeNanometers"];
  electricalReferenceConditions:
    SensorResponsivityElectricalConditions;
  operatingElectricalConditions:
    SensorResponsivityElectricalConditions;
  electricalConditionPolicy:
    SensorResponsivityElectricalConditionPolicy;
  electricalCompatibility:
    | "exact-match"
    | "assumed-compatible";
  spectralNodeCount: number;
  perWavelength:
    readonly SensorResponsivityWavelengthCurrentContribution[];
  photocurrentMagnitudeAmperes: number;
  currentSignConvention:
    "magnitude-only-no-circuit-polarity";
  summationMethod:
    "kahan-compensated";
  responseApplicationPerformed: true;
  spectralResponsivityApplied: true;
  quantumEfficiencyApplied: false;
  photonRateCalculated: false;
  electronRateCalculated: false;
  currentCalculated: true;
  chargeCalculated: false;
  temporalResponseModel:
    "quasi-static-steady-state-only";
  detectorBandwidthModeled: false;
  transimpedanceGainApplied: false;
  voltageCalculated: false;
  temporalIntegrationApplied: false;
  exposureDurationApplied: false;
  saturationAssessed: false;
  readoutElectronicsLinearityAssessed:
    false;
  shotNoiseApplied: false;
  readNoiseApplied: false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  responseUncertaintyPropagated: false;
  electricalApplicabilityUncertaintyPropagated:
    false;
  quadratureConvergenceErrorEstimated:
    false;
  componentEvidence: {
    electricalApplicability:
      readonly EvidenceProvenance[];
    electricalConditionAssumption:
      readonly EvidenceProvenance[];
  };
}

interface CompensatedSum {
  sum: number;
  correction: number;
}

function parseElectricalConditions(
  value: unknown,
  path: string
): SensorResponsivityElectricalConditions {
  const record = requireRecord(
    value,
    path, ["bias", "readoutLoad"]
  );
  const bias = requireRecord(
    record.bias,
    path + ".bias", null
  );
  rejectUnknownVariantFields(bias, "kind", { "zero-bias-photovoltaic": ["kind"], "reverse-biased": ["kind", "magnitudeVolts"] }, path + ".bias");
  const readoutLoad = requireRecord(
    record.readoutLoad,
    path + ".readoutLoad", null
  );
  rejectUnknownVariantFields(readoutLoad, "kind", { "virtual-ground-current-readout": ["kind"], "finite-input-impedance": ["kind", "inputImpedanceOhms"] }, path + ".readoutLoad");

  const parsedBias:
    SensorResponsivityBiasCondition =
      bias.kind ===
      "zero-bias-photovoltaic"
        ? {
            kind:
              "zero-bias-photovoltaic"
          }
        : bias.kind ===
          "reverse-biased"
          ? {
              kind:
                "reverse-biased",
              magnitudeVolts:
                requirePositiveFiniteConfiguration(
                  bias.magnitudeVolts,
                  path +
                    ".bias.magnitudeVolts"
                )
            }
          : ((): never => {
              throw new InvalidConfigurationError(
                path +
                  ".bias.kind is invalid."
              );
            })();

  const parsedReadout:
    SensorResponsivityReadoutLoadCondition =
      readoutLoad.kind ===
      "virtual-ground-current-readout"
        ? {
            kind:
              "virtual-ground-current-readout"
          }
        : readoutLoad.kind ===
          "finite-input-impedance"
          ? {
              kind:
                "finite-input-impedance",
              inputImpedanceOhms:
                requirePositiveFiniteConfiguration(
                  readoutLoad
                    .inputImpedanceOhms,
                  path +
                    ".readoutLoad.inputImpedanceOhms"
                )
            }
          : ((): never => {
              throw new InvalidConfigurationError(
                path +
                  ".readoutLoad.kind is invalid."
              );
            })();

  return {
    bias: parsedBias,
    readoutLoad: parsedReadout
  };
}

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The profile states the electrical bias and load conditions under which an A/W responsivity applies.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseSensorResponsivityElectricalApplicabilityProfile(
  value: unknown
): SensorResponsivityElectricalApplicabilityProfile {
  const record = requireRecord(
    value,
    "sensorResponsivityElectricalApplicability", ["schemaVersion", "outputMeaning", "scientificStatus", "uncertainty", "profileId", "responseApplicationProfileId", "spectralResponseProfileId", "colorSamplingProfileId", "channelId", "referenceConditions", "conditionPolicy", "evidence"]
  );

  if (
    record.schemaVersion !== "0.1.0"
  ) {
    throw new InvalidConfigurationError(
      'sensorResponsivityElectricalApplicability.schemaVersion must be "0.1.0".'
    );
  }
  if (
    record.outputMeaning !==
    "detector-terminal-photocurrent-magnitude"
  ) {
    throw new InvalidConfigurationError(
      "sensorResponsivityElectricalApplicability.outputMeaning is invalid."
    );
  }
  if (
    record.scientificStatus !==
      "calibrated" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      "sensorResponsivityElectricalApplicability.scientificStatus is invalid."
    );
  }

  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      "sensorResponsivityElectricalApplicability.uncertainty"
    );

  if (
    record.scientificStatus ===
      "calibrated" &&
    uncertainty.kind ===
      "not-quantified"
  ) {
    throw new InvalidConfigurationError(
      "A calibrated electrical applicability profile must declare quantified relative uncertainty."
    );
  }

  return {
    schemaVersion: "0.1.0",
    profileId:
      requireNonEmptyString(
        record.profileId,
        "sensorResponsivityElectricalApplicability.profileId"
      ),
    responseApplicationProfileId:
      requireNonEmptyString(
        record
          .responseApplicationProfileId,
        "sensorResponsivityElectricalApplicability.responseApplicationProfileId"
      ),
    spectralResponseProfileId:
      requireNonEmptyString(
        record
          .spectralResponseProfileId,
        "sensorResponsivityElectricalApplicability.spectralResponseProfileId"
      ),
    colorSamplingProfileId:
      requireNonEmptyString(
        record.colorSamplingProfileId,
        "sensorResponsivityElectricalApplicability.colorSamplingProfileId"
      ),
    channelId:
      requireNonEmptyString(
        record.channelId,
        "sensorResponsivityElectricalApplicability.channelId"
      ),
    outputMeaning:
      "detector-terminal-photocurrent-magnitude",
    referenceConditions:
      parseElectricalConditions(
        record.referenceConditions,
        "sensorResponsivityElectricalApplicability.referenceConditions"
      ),
    conditionPolicy:
      parseConditionPolicy(
        record.conditionPolicy,
        "sensorResponsivityElectricalApplicability.conditionPolicy"
      ),
    scientificStatus:
      record.scientificStatus,
    uncertainty,
    evidence:
      parseEvidenceList(
        record.evidence,
        "sensorResponsivityElectricalApplicability.evidence"
      )
  };
}

/**
 * Identity string for parsed plain data that ignores key order, so records with
 * the same content compare equal whatever order their properties were added in.
 */
function canonicalJson(
  value: unknown
): string {
  if (value === undefined) return "undefined";
  return stringifyCanonicalJson(value, {
    undefinedObjectProperties: "omit",
    nonFiniteNumberMessage:
      "A/W photocurrent identity data must contain finite numbers.",
    unsupportedValueMessage:
      "A/W photocurrent identity data must be plain JSON data."
  });
}


function electricalConditionsMatch(
  reference:
    SensorResponsivityElectricalConditions,
  operating:
    SensorResponsivityElectricalConditions
): boolean {
  return (
    canonicalJson(reference) ===
    canonicalJson(operating)
  );
}

function validateAuthorizationChain(
  reduction:
    SensorSpatioSpectralIrradianceReduction,
  compatibility:
    SensorResponseApplicationCompatibilityAssessment,
  operatingRange:
    SensorResponseOperatingRangeAssessment
): void {
  requireInputObject(reduction, "reduction input");
  if (
    reduction.outputMeaning !==
      "pre-response-spatio-spectral-radiometric-reduction" ||
    reduction
      .spectralResponseApplicationPerformed !==
      false ||
    reduction
      .spectralResponsivityApplied !==
      false ||
    reduction.temporalIntegrationApplied !==
      false
  ) {
    throw new InvalidScientificInputError(
      "reduction must remain pre-response and pre-temporal before A/W photocurrent conversion."
    );
  }

  if (
    !compatibility
      .structuralCompatibilityEstablished ||
    compatibility.compatibilityStatus ===
      "blocked" ||
    compatibility.blockers.length !== 0 ||
    !compatibility.sourcePlaneMatched ||
    compatibility.requiredSignalPath !==
      "radiant-power-to-current"
  ) {
    throw new InvalidScientificInputError(
      "compatibility must establish a non-blocked radiant-power-to-current response path."
    );
  }

  if (
    compatibility
      .spectralResponseProfileId !==
      reduction.responseProfileId ||
    compatibility.colorSamplingProfileId !==
      reduction.colorSamplingProfileId ||
    compatibility.channelId !==
      reduction.channelId ||
    compatibility.responseScope !==
      reduction.responseScope
  ) {
    throw new InvalidScientificInputError(
      "compatibility identities must exactly match the reduction."
    );
  }

  if (
    !operatingRange
      .operatingRangeCompatibilityAssessed ||
    !operatingRange
      .instantaneousResponseRangeCompatible ||
    !operatingRange
      .responseRateConversionAuthorized ||
    operatingRange.status === "blocked" ||
    operatingRange.blockers.length !== 0 ||
    operatingRange.requiredSignalPath !==
      "radiant-power-to-current" ||
    operatingRange
      .responseApplicationPerformed !==
      false ||
    operatingRange
      .currentConversionPerformed !== false ||
    operatingRange
      .temporalIntegrationAuthorized !== false ||
    !operatingRange
      .spectralNodeRangeCompatibilityAssessed ||
    operatingRange
      .spectralInputModel.kind !==
      "per-spectral-bin" ||
    operatingRange
      .spatialLinearityModel.kind !==
      "linear-superposition-over-geometric-aperture"
  ) {
    throw new InvalidScientificInputError(
      "operatingRange must authorize a clean per-bin radiant-power-to-current path."
    );
  }

  if (
    operatingRange
      .spectralResponseProfileId !==
      reduction.responseProfileId ||
    operatingRange
      .colorSamplingProfileId !==
      reduction.colorSamplingProfileId ||
    operatingRange.channelId !==
      reduction.channelId ||
    operatingRange
      .responseApplicationProfileId !==
      compatibility.applicationProfileId
  ) {
    throw new InvalidScientificInputError(
      "operatingRange identities must exactly match the reduction and compatibility assessment."
    );
  }
}

function validateReductionNodes(
  reduction:
    SensorSpatioSpectralIrradianceReduction
): readonly SensorSpatioSpectralWavelengthReduction[] {
  if (
    !Array.isArray(
      reduction.perWavelength
    ) ||
    !Number.isSafeInteger(
      reduction.spectralNodeCount
    ) ||
    reduction.spectralNodeCount <= 0 ||
    reduction.perWavelength.length !==
      reduction.spectralNodeCount
  ) {
    throw new InvalidScientificInputError(
      "reduction.perWavelength must contain exactly spectralNodeCount entries."
    );
  }

  let priorWavelength =
    Number.NEGATIVE_INFINITY;
  let normalizedWeightSum = 0;
  const totalPower:
    CompensatedSum = {
      sum: 0,
      correction: 0
    };

  reduction.perWavelength.forEach(
    (node, arrayIndex) => {
      const sampleIndex =
        requireSafeNonNegativeInteger(
          node.spectralSampleIndex,
          "reduction.perWavelength[" +
            arrayIndex +
            "].spectralSampleIndex"
        );
      if (sampleIndex !== arrayIndex) {
        throw new InvalidScientificInputError(
          "reduction spectralSampleIndex values must form the exact contiguous range 0..spectralNodeCount-1."
        );
      }

      const wavelength =
        requirePositiveFiniteInput(
          node.wavelengthNanometers,
          "reduction.perWavelength[" +
            arrayIndex +
            "].wavelengthNanometers"
        );
      if (
        wavelength <= priorWavelength
      ) {
        throw new InvalidScientificInputError(
          "reduction wavelength nodes must be strictly increasing."
        );
      }
      priorWavelength = wavelength;

      const measure =
        requirePositiveFiniteInput(
          node.wavelengthMeasureNanometers,
          "reduction.perWavelength[" +
            arrayIndex +
            "].wavelengthMeasureNanometers"
        );
      const normalizedWeight =
        requirePositiveFiniteInput(
          node.normalizedWavelengthWeight,
          "reduction.perWavelength[" +
            arrayIndex +
            "].normalizedWavelengthWeight"
        );
      const fluxDensity =
        requireNonNegativeFiniteInput(
          node
            .geometricApertureIncidentSpectralFluxWattsPerNanometer,
          "reduction.perWavelength[" +
            arrayIndex +
            "].geometricApertureIncidentSpectralFluxWattsPerNanometer"
        );
      const power =
        requireNonNegativeFiniteInput(
          node
            .wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts,
          "reduction.perWavelength[" +
            arrayIndex +
            "].wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts"
        );
      const expected =
        fluxDensity * measure;
      if (
        !Number.isFinite(expected) ||
        !approximatelyEqual(
          power,
          expected
        )
      ) {
        throw new InvalidScientificInputError(
          "reduction per-wavelength radiant-power contribution must equal spectral flux density × d-lambda."
        );
      }

      normalizedWeightSum +=
        normalizedWeight;
      addCompensated(
        totalPower,
        power
      );
    }
  );

  if (
    !Number.isFinite(
      normalizedWeightSum
    ) ||
    !approximatelyEqual(
      normalizedWeightSum,
      1
    )
  ) {
    throw new InvalidScientificInputError(
      "reduction normalized wavelength weights must sum to 1."
    );
  }

  const reductionPower =
    requireNonNegativeFiniteInput(
      reduction
        .wavelengthIntegratedGeometricApertureIncidentFluxWatts,
      "reduction.wavelengthIntegratedGeometricApertureIncidentFluxWatts"
    );
  if (
    !approximatelyEqual(
      totalPower.sum,
      reductionPower
    )
  ) {
    throw new InvalidScientificInputError(
      "reduction total geometric-aperture radiant power must match the per-wavelength sum."
    );
  }

  return reduction.perWavelength;
}

function validateOperatingRangeNodeBinding(
  reduction:
    SensorSpatioSpectralIrradianceReduction,
  nodes:
    readonly SensorSpatioSpectralWavelengthReduction[],
  operatingRange:
    SensorResponseOperatingRangeAssessment
): void {
  const evaluated =
    operatingRange
      .evaluatedSpectralNodeInputs;

  if (
    evaluated === undefined ||
    evaluated.length !== nodes.length
  ) {
    throw new InvalidScientificInputError(
      "operatingRange must carry one evaluated spectral-node input per reduction wavelength node."
    );
  }

  if (
    operatingRange
      .evaluatedWavelengthRangeNanometers
      .minimum !==
      reduction.wavelengthRangeNanometers
        .minimum ||
    operatingRange
      .evaluatedWavelengthRangeNanometers
      .maximum !==
      reduction.wavelengthRangeNanometers
        .maximum
  ) {
    throw new InvalidScientificInputError(
      "operatingRange wavelength range must exactly match the reduction."
    );
  }

  evaluated.forEach(
    (entry, index) => {
      const node = nodes[index]!;
      if (
        entry.spectralSampleIndex !==
          node.spectralSampleIndex ||
        entry.wavelengthNanometers !==
          node.wavelengthNanometers ||
        entry.wavelengthMeasureNanometers !==
          node.wavelengthMeasureNanometers
      ) {
        throw new InvalidScientificInputError(
          "operatingRange spectral-node identities must exactly match the reduction."
        );
      }

      const expected =
        operatingRange.inputRange.kind ===
          "wavelength-integrated-geometric-aperture-radiant-power"
          ? node
              .wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts
          : node
              .wavelengthIntegratedSpatialAverageContributionWattsPerSquareMeter;

      if (
        entry.kind !==
          operatingRange.inputRange.kind ||
        entry.unit !==
          operatingRange.inputRange.unit ||
        !approximatelyEqual(
          entry.value,
          expected
        )
      ) {
        throw new InvalidScientificInputError(
          "operatingRange spectral-node values must match the reduction values in the calibrated input domain."
        );
      }
    }
  );
}

function validateResponseBinding(
  resolved:
    ResolvedSensorSpectralResponse,
  reduction:
    SensorSpatioSpectralIrradianceReduction
): void {
  if (
    resolved.profileId !==
      reduction.responseProfileId ||
    resolved.colorSamplingProfileId !==
      reduction.colorSamplingProfileId ||
    resolved.channelId !==
      reduction.channelId ||
    resolved.sourceResponseKind !==
      reduction.sourceResponseKind ||
    resolved.responseScope !==
      reduction.responseScope ||
    resolved.scientificStatus !==
      reduction.responseScientificStatus ||
    canonicalJson(
      resolved.uncertainty
    ) !==
      canonicalJson(
        reduction.responseUncertainty
      ) ||
    canonicalJson(
      resolved.componentEvidence
    ) !==
      canonicalJson({
        profile:
          reduction.componentEvidence
            .spectral.profile,
        channel:
          reduction.componentEvidence
            .spectral.channel,
        curves:
          reduction.componentEvidence
            .spectral.curves
      })
  ) {
    throw new InvalidScientificInputError(
      "Resolved A/W response calibration metadata/evidence must exactly match the reduction."
    );
  }
}

function validateExactResponseDataBinding(
  responseProfile:
    SensorSpectralResponseProfile,
  reduction:
    SensorSpatioSpectralIrradianceReduction
): void {
  const response =
    responseProfile.channels.find(
      (entry) =>
        entry.channelId ===
        reduction.channelId
    );
  if (reduction.responseChannelBinding !== undefined) {
    requireCurrentSensorSpectralResponseChannelBinding(
      reduction.responseChannelBinding
    );
  }
  if (
    response === undefined ||
    reduction.responseChannelBinding ===
      undefined ||
    canonicalJson(
      createSensorSpectralResponseChannelBinding(
        response
      )
    ) !==
      canonicalJson(
        reduction.responseChannelBinding
      )
  ) {
    throw new InvalidScientificInputError(
      "Supplied spectral response channel data must exactly match the response-channel binding carried by the reduction."
    );
  }
}

function validateElectricalBinding(
  profile:
    SensorResponsivityElectricalApplicabilityProfile,
  input:
    CalculateSensorResponsivityPhotocurrentInput,
  operatingElectricalConditions:
    SensorResponsivityElectricalConditions
): {
  compatibility:
    "exact-match" |
    "assumed-compatible";
  assumptionEvidence:
    readonly EvidenceProvenance[];
} {
  if (
    profile.responseApplicationProfileId !==
      input.compatibility
        .applicationProfileId ||
    profile.spectralResponseProfileId !==
      input.reduction
        .responseProfileId ||
    profile.colorSamplingProfileId !==
      input.reduction
        .colorSamplingProfileId ||
    profile.channelId !==
      input.reduction.channelId
  ) {
    throw new InvalidScientificInputError(
      "Electrical applicability profile identities must exactly match the response pipeline."
    );
  }

  if (
    profile.conditionPolicy.kind ===
      "exact-match-required"
  ) {
    if (
      !electricalConditionsMatch(
        profile.referenceConditions,
        operatingElectricalConditions
      )
    ) {
      throw new InvalidScientificInputError(
        "Operating electrical conditions must exactly match the A/W calibration reference conditions."
      );
    }
    return {
      compatibility: "exact-match",
      assumptionEvidence: []
    };
  }

  return {
    compatibility:
      "assumed-compatible",
    assumptionEvidence:
      profile.conditionPolicy.evidence
  };
}

/**
 * Sums responsivity (A/W) × radiant power over wavelength bins to get the steady current magnitude,
 * under explicit electrical conditions.
 *
 * This is not EQE, an electron rate, a transimpedance voltage or RAW. Fast-changing current needs a
 * separate time-dependent detector model.
 * @param input - The input; see `CalculateSensorResponsivityPhotocurrentInput` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function calculateSensorResponsivityPhotocurrent(
  input:
    CalculateSensorResponsivityPhotocurrentInput
): CalculationResult<SensorResponsivityPhotocurrent> {
  requireInputKeys(input, "calculateSensorResponsivityPhotocurrent", ["reduction", "compatibility", "operatingRange", "colorSamplingProfile", "spectralResponseProfile", "electricalApplicabilityProfile", "operatingElectricalConditions"]);
  validateAuthorizationChain(
    input.reduction,
    input.compatibility,
    input.operatingRange
  );

  if (
    input.reduction
      .sourceResponseKind !==
      "effective-spectral-responsivity"
  ) {
    throw new InvalidScientificInputError(
      "A/W photocurrent conversion requires effective spectral responsivity, not EQE."
    );
  }

  const colorProfile =
    parseSensorColorSamplingProfile(
      input.colorSamplingProfile
    );
  const responseProfile =
    parseSensorSpectralResponseProfile(
      input.spectralResponseProfile
    );
  const electricalProfile =
    parseSensorResponsivityElectricalApplicabilityProfile(
      input.electricalApplicabilityProfile
    );

  if (
    colorProfile.profileId !==
      input.reduction
        .colorSamplingProfileId ||
    responseProfile.profileId !==
      input.reduction
        .responseProfileId ||
    responseProfile
      .colorSamplingProfileId !==
      colorProfile.profileId
  ) {
    throw new InvalidScientificInputError(
      "Supplied color/spectral response profiles must exactly match the reduction identities."
    );
  }

  validateExactResponseDataBinding(
    responseProfile,
    input.reduction
  );

  const operatingElectricalConditions =
    parseElectricalConditions(
      input.operatingElectricalConditions,
      "operatingElectricalConditions"
    );
  const electrical =
    validateElectricalBinding(
      electricalProfile,
      input,
      operatingElectricalConditions
    );
  const nodes =
    validateReductionNodes(
      input.reduction
    );
  validateOperatingRangeNodeBinding(
    input.reduction,
    nodes,
    input.operatingRange
  );

  const currentSum:
    CompensatedSum = {
      sum: 0,
      correction: 0
    };
  const perWavelength:
    SensorResponsivityWavelengthCurrentContribution[] =
      [];
  let responseBindingValidated =
    false;

  for (const node of nodes) {
    const resolved =
      resolveParsedSensorSpectralResponseAtWavelength({
        colorSamplingProfile:
          colorProfile,
        spectralResponseProfile:
          responseProfile,
        channelId:
          input.reduction.channelId,
        wavelengthNanometers:
          node.wavelengthNanometers,
        wavelengthBasis:
          input.reduction
            .wavelengthBasis
      });

    if (!responseBindingValidated) {
      validateResponseBinding(
        resolved.value,
        input.reduction
      );
      responseBindingValidated =
        true;
    }

    const responsivity =
      resolved.value.response as Extract<
        typeof resolved.value.response,
        {
          kind:
            "effective-spectral-responsivity";
        }
      >;

    const radiantPowerContributionWatts =
      node
        .geometricApertureIncidentSpectralFluxWattsPerNanometer *
      node.wavelengthMeasureNanometers;
    const photocurrentMagnitudeContributionAmperes =
      radiantPowerContributionWatts *
      responsivity.amperesPerWatt;

    if (
      !Number.isFinite(
        radiantPowerContributionWatts
      ) ||
      !Number.isFinite(
        photocurrentMagnitudeContributionAmperes
      ) ||
      photocurrentMagnitudeContributionAmperes <
        0
    ) {
      throw new InvalidScientificInputError(
        "A/W wavelength-node photocurrent calculation must remain finite and nonnegative."
      );
    }

    addCompensated(
      currentSum,
      photocurrentMagnitudeContributionAmperes
    );

    perWavelength.push({
      spectralSampleIndex:
        node.spectralSampleIndex,
      wavelengthNanometers:
        node.wavelengthNanometers,
      wavelengthMeasureNanometers:
        node.wavelengthMeasureNanometers,
      geometricApertureIncidentSpectralFluxWattsPerNanometer:
        node
          .geometricApertureIncidentSpectralFluxWattsPerNanometer,
      radiantPowerContributionWatts,
      spectralResponsivityAmperesPerWatt:
        responsivity.amperesPerWatt,
      responseInterpolationUsed:
        resolved.value
          .interpolationUsed,
      photocurrentMagnitudeContributionAmperes
    });
  }

  if (
    !Number.isFinite(
      currentSum.sum
    ) ||
    currentSum.sum < 0
  ) {
    throw new InvalidScientificInputError(
      "Total A/W photocurrent magnitude must remain finite and nonnegative."
    );
  }

  return approximationResult(
    {
      colorSamplingProfileId:
        input.reduction
          .colorSamplingProfileId,
      responseProfileId:
        input.reduction
          .responseProfileId,
      responseApplicationProfileId:
        input.compatibility
          .applicationProfileId,
      operatingRangeProfileId:
        input.operatingRange
          .operatingRangeProfileId,
      electricalApplicabilityProfileId:
        electricalProfile.profileId,
      site: {
        ...input.reduction.site
      },
      channelId:
        input.reduction.channelId,
      sourceResponseKind:
        "effective-spectral-responsivity",
      responseScope:
        input.reduction.responseScope,
      responseReferencePlane:
        input.compatibility
          .requiredSourcePlane,
      wavelengthBasis:
        input.reduction
          .wavelengthBasis,
      wavelengthRangeNanometers: {
        ...input.reduction
          .wavelengthRangeNanometers
      },
      electricalReferenceConditions:
        electricalProfile
          .referenceConditions,
      operatingElectricalConditions,
      electricalConditionPolicy:
        electricalProfile
          .conditionPolicy,
      electricalCompatibility:
        electrical.compatibility,
      spectralNodeCount:
        nodes.length,
      perWavelength,
      photocurrentMagnitudeAmperes:
        currentSum.sum,
      currentSignConvention:
        "magnitude-only-no-circuit-polarity",
      summationMethod:
        "kahan-compensated",
      responseApplicationPerformed:
        true,
      spectralResponsivityApplied:
        true,
      quantumEfficiencyApplied:
        false,
      photonRateCalculated: false,
      electronRateCalculated: false,
      currentCalculated: true,
      chargeCalculated: false,
      temporalResponseModel:
        "quasi-static-steady-state-only",
      detectorBandwidthModeled: false,
      transimpedanceGainApplied:
        false,
      voltageCalculated: false,
      temporalIntegrationApplied:
        false,
      exposureDurationApplied: false,
      saturationAssessed: false,
      readoutElectronicsLinearityAssessed:
        false,
      shotNoiseApplied: false,
      readNoiseApplied: false,
      adcQuantizationApplied:
        false,
      rawCodeValueProduced: false,
      responseUncertaintyPropagated:
        false,
      electricalApplicabilityUncertaintyPropagated:
        false,
      quadratureConvergenceErrorEstimated:
        false,
      componentEvidence: {
        electricalApplicability:
          electricalProfile.evidence,
        electricalConditionAssumption:
          electrical
            .assumptionEvidence
      }
    },
    "sensor-spectral-responsivity-photocurrent",
    "1.0.0",
    [
      "Spectral responsivity in A/W is applied independently at every wavelength quadrature node as detector-terminal photocurrent magnitude per incident radiant power.",
      "Current sign/polarity is deliberately not modeled; the result is a nonnegative photocurrent magnitude and does not imply a circuit current direction.",
      "The A/W calibration is bound to explicit detector electrical conditions. Exact-match mode requires identical bias and readout-load semantics; approximation mode requires evidence and a stated limitation.",
      "Virtual-ground current readout and finite input impedance are modeled as calibration-condition identities only; this function does not simulate amplifier circuits or prove impedance adequacy.",
      "NIST photodiode guidance shows detector/electronics/loading can affect linear operation, so transimpedance/current-readout conditions are not treated as scientifically inert.",
      "Structural compatibility, geometric-aperture linear superposition and per-spectral-bin operating-range applicability must already authorize the radiant-power→current path.",
      "Response metadata/evidence and operating-range spectral-node values are rebound to the exact reduction so matching IDs alone or stale authorization cannot enable conversion.",
      "The calculation does not use photon energy, QE, photon rate or electron rate. A/W remains a distinct current-domain response representation.",
      "No transimpedance gain or voltage conversion is performed; current-to-voltage converter gain/offset/linearity remain downstream electronics contracts.",
      "The A/W response is used only as a quasi-static steady-state power→current mapping. Detector impulse response, bandwidth, modulation-frequency response and transient settling are not modeled.",
      "Outputs are instantaneous current only. Exposure-time integration to charge, saturation, noise, ADC/RAW conversion and reconstruction remain downstream.",
      "Response/electrical uncertainties and quadrature convergence error are not propagated into a combined current uncertainty by this version."
    ]
  );
}
