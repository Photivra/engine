// SPDX-License-Identifier: Apache-2.0

/**
 * EQE electron rate: converts the light power reaching a sensor site into a photon rate and an
 * expected electron rate, using the sensor's EQE (external quantum efficiency, the fraction of
 * incident photons that produce a collected electron).
 *
 * The response is applied at each wavelength node. One broadband-average QE is never applied to the
 * total power. Outputs are rates per second; integrating over the exposure time happens later.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import type {
  EvidenceProvenance
} from "../core/evidence-provenance.js";
import { stringifyCanonicalJson } from "../core/canonical-json.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  calculatePhotonEnergyFromWavelength,
  type AirRefractiveIndexConditionPolicy,
  type AirRefractiveIndexReferenceConditions,
  type SourcedAirPhaseRefractiveIndex
} from "./photon-energy.js";
import type {
  SensorResponseApplicationCompatibilityAssessment
} from "./response-application-compatibility.js";
import type {
  SensorResponseOperatingRangeAssessment
} from "./response-operating-range.js";
import {
  parseSensorColorSamplingProfile,
  type SensorColorSamplingProfile
} from "./color-sampling.js";
import {
  createSensorSpectralResponseChannelBinding,
  requireCurrentSensorSpectralResponseChannelBinding,
  parseSensorSpectralResponseProfile,
  resolveParsedSensorSpectralResponseAtWavelength,
  type ResolvedSensorSpectralResponseValue,
  type SensorSpectralResponseProfile
} from "./spectral-response.js";
import type {
  SensorSpatioSpectralIrradianceReduction,
  SensorSpatioSpectralWavelengthReduction
} from "./spatio-spectral-reduction.js";
import { requireInputObject, requireInputKeys, requireInputNonNegativeFinite as requireNonNegativeFinite, requireInputPositiveFinite as requirePositiveFinite, requireInputNonNegativeSafeInteger as requireSafeNonNegativeInteger } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { addCompensated } from "../core/shared-helpers.js";

const REDUCTION_TOLERANCE = 1e-10;

export interface SensorEqeAirRefractiveIndexSample {
  spectralSampleIndex: number;
  refractiveIndex:
    SourcedAirPhaseRefractiveIndex;
}

export interface SensorEqeAirPhotonEnergyContext {
  samples:
    readonly SensorEqeAirRefractiveIndexSample[];
  operatingConditions?:
    AirRefractiveIndexReferenceConditions;
  conditionPolicy:
    AirRefractiveIndexConditionPolicy;
}

export interface CalculateSensorEqeElectronRateInput {
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
  airPhotonEnergyContext?:
    SensorEqeAirPhotonEnergyContext;
}

export interface SensorEqeWavelengthRateContribution {
  spectralSampleIndex: number;
  wavelengthNanometers: number;
  wavelengthMeasureNanometers: number;
  geometricApertureIncidentSpectralFluxWattsPerNanometer:
    number;
  radiantPowerContributionWatts: number;
  vacuumWavelengthNanometers: number;
  photonEnergyJoules: number;
  wavelengthConversion:
    | "vacuum-identity"
    | "air-to-vacuum-via-phase-refractive-index";
  phaseRefractiveIndexUsed?: number;
  airConditionCompatibility?:
    | "exact-match"
    | "assumed-compatible";
  airRefractiveIndexEvidence?:
    readonly EvidenceProvenance[];
  incidentPhotonRatePerSecond: number;
  effectiveExternalQuantumEfficiency: number;
  responseComposition:
    | "direct-effective-response"
    | "channel-filter-transmittance-times-detector-eqe";
  channelFilterTransmittance?: number;
  detectorExternalQuantumEfficiency?: number;
  responseInterpolationUsed: boolean;
  expectedGeneratedElectronRatePerSecond:
    number;
}

export interface SensorEqeElectronRate {
  colorSamplingProfileId: string;
  responseProfileId: string;
  responseApplicationProfileId: string;
  operatingRangeProfileId: string;
  /** The exact source colour site. Results produced by the engine fill this in. */
  site?: {
    x: number;
    y: number;
  };
  channelId: string;
  sourceResponseKind:
    | "effective-external-quantum-efficiency"
    | "separable-channel-filter-and-detector-eqe";
  responseScope:
    SensorSpatioSpectralIrradianceReduction["responseScope"];
  responseReferencePlane:
    SensorResponseApplicationCompatibilityAssessment["requiredSourcePlane"];
  wavelengthBasis:
    SensorSpatioSpectralIrradianceReduction["wavelengthBasis"];
  wavelengthRangeNanometers:
    SensorSpatioSpectralIrradianceReduction["wavelengthRangeNanometers"];
  spectralNodeCount: number;
  perWavelength:
    readonly SensorEqeWavelengthRateContribution[];
  incidentPhotonRatePerSecond: number;
  expectedGeneratedElectronRatePerSecond:
    number;
  summationMethod:
    "kahan-compensated";
  responseApplicationPerformed: true;
  quantumEfficiencyApplied: true;
  spectralResponsivityApplied: false;
  channelFilterTransmissionApplied:
    boolean;
  photonRateCalculated: true;
  electronRateCalculated: true;
  photonCountCalculated: false;
  electronCountCalculated: false;
  currentCalculated: false;
  temporalIntegrationApplied: false;
  exposureDurationApplied: false;
  saturationAssessed: false;
  shotNoiseApplied: false;
  readNoiseApplied: false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  responseUncertaintyPropagated: false;
  photonEnergyUncertaintyPropagated: false;
  quadratureConvergenceErrorEstimated:
    false;
}

interface CompensatedSum {
  sum: number;
  correction: number;
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
    REDUCTION_TOLERANCE * scale
  );
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
      "EQE electron-rate identity data must contain finite numbers.",
    unsupportedValueMessage:
      "EQE electron-rate identity data must be plain JSON data."
  });
}

function requireEquivalent(
  actual: unknown,
  expected: unknown,
  message: string
): void {
  if (
    canonicalJson(actual) !==
    canonicalJson(expected)
  ) {
    throw new InvalidScientificInputError(
      message
    );
  }
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
    reduction.quantumEfficiencyApplied !==
      false ||
    reduction.temporalIntegrationApplied !==
      false
  ) {
    throw new InvalidScientificInputError(
      "reduction must remain pre-response and pre-temporal before EQE rate conversion."
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
      "photon-rate-to-electrons"
  ) {
    throw new InvalidScientificInputError(
      "compatibility must establish a non-blocked photon-rate-to-electrons response path."
    );
  }

  if (
    compatibility.spectralResponseProfileId !==
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
      "photon-rate-to-electrons" ||
    operatingRange
      .responseApplicationPerformed !==
      false ||
    operatingRange
      .photonConversionPerformed !== false ||
    operatingRange
      .electronConversionPerformed !== false ||
    operatingRange
      .temporalIntegrationAuthorized !== false
  ) {
    throw new InvalidScientificInputError(
      "operatingRange must authorize a clean photon-rate-to-electrons conversion path."
    );
  }

  if (
    !operatingRange
      .spectralNodeRangeCompatibilityAssessed ||
    operatingRange
      .spectralInputModel.kind !==
      "per-spectral-bin"
  ) {
    throw new InvalidScientificInputError(
      "operatingRange must establish per-spectral-bin input-range applicability before wavelength-dependent EQE conversion."
    );
  }

  if (
    operatingRange
      .spatialLinearityModel.kind !==
      "linear-superposition-over-geometric-aperture"
  ) {
    throw new InvalidScientificInputError(
      "operatingRange must establish linear superposition over the geometric aperture."
    );
  }

  if (
    operatingRange.spectralResponseProfileId !==
      reduction.responseProfileId ||
    operatingRange.colorSamplingProfileId !==
      reduction.colorSamplingProfileId ||
    operatingRange.channelId !==
      reduction.channelId ||
    operatingRange.responseApplicationProfileId !==
      compatibility.applicationProfileId
  ) {
    throw new InvalidScientificInputError(
      "operatingRange identities must exactly match the reduction and compatibility assessment."
    );
  }
}

function validateReductionSpectralNodes(
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

  let previousWavelength =
    Number.NEGATIVE_INFINITY;
  let normalizedWeightSum = 0;
  const integratedPower:
    CompensatedSum = {
      sum: 0,
      correction: 0
    };

  reduction.perWavelength.forEach(
    (entry, arrayIndex) => {
      const sampleIndex =
        requireSafeNonNegativeInteger(
          entry.spectralSampleIndex,
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
        requirePositiveFinite(
          entry.wavelengthNanometers,
          "reduction.perWavelength[" +
            arrayIndex +
            "].wavelengthNanometers"
        );
      if (
        wavelength <=
        previousWavelength
      ) {
        throw new InvalidScientificInputError(
          "reduction per-wavelength samples must be strictly increasing in wavelength."
        );
      }
      previousWavelength =
        wavelength;

      const measure =
        requirePositiveFinite(
          entry.wavelengthMeasureNanometers,
          "reduction.perWavelength[" +
            arrayIndex +
            "].wavelengthMeasureNanometers"
        );
      const normalizedWeight =
        requirePositiveFinite(
          entry.normalizedWavelengthWeight,
          "reduction.perWavelength[" +
            arrayIndex +
            "].normalizedWavelengthWeight"
        );
      const fluxDensity =
        requireNonNegativeFinite(
          entry
            .geometricApertureIncidentSpectralFluxWattsPerNanometer,
          "reduction.perWavelength[" +
            arrayIndex +
            "].geometricApertureIncidentSpectralFluxWattsPerNanometer"
        );
      const contribution =
        requireNonNegativeFinite(
          entry
            .wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts,
          "reduction.perWavelength[" +
            arrayIndex +
            "].wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts"
        );
      const expectedContribution =
        fluxDensity * measure;
      if (
        !Number.isFinite(
          expectedContribution
        ) ||
        !approximatelyEqual(
          contribution,
          expectedContribution
        )
      ) {
        throw new InvalidScientificInputError(
          "reduction per-wavelength radiant-power contribution must equal spectral flux density × d-lambda."
        );
      }

      normalizedWeightSum +=
        normalizedWeight;
      if (
        !Number.isFinite(
          normalizedWeightSum
        )
      ) {
        throw new InvalidScientificInputError(
          "reduction normalized wavelength weights must remain finite."
        );
      }
      addCompensated(
        integratedPower,
        contribution
      );
    }
  );

  if (
    !approximatelyEqual(
      normalizedWeightSum,
      1
    )
  ) {
    throw new InvalidScientificInputError(
      "reduction normalized wavelength weights must sum to 1."
    );
  }

  const totalPower =
    requireNonNegativeFinite(
      reduction
        .wavelengthIntegratedGeometricApertureIncidentFluxWatts,
      "reduction.wavelengthIntegratedGeometricApertureIncidentFluxWatts"
    );
  if (
    !approximatelyEqual(
      integratedPower.sum,
      totalPower
    )
  ) {
    throw new InvalidScientificInputError(
      "reduction total geometric-aperture radiant power must match the sum of per-wavelength contributions."
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
      "operatingRange must carry one evaluated spectral-node input for every reduction wavelength node."
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

function parseAirContext(
  reduction:
    SensorSpatioSpectralIrradianceReduction,
  nodes:
    readonly SensorSpatioSpectralWavelengthReduction[],
  context:
    SensorEqeAirPhotonEnergyContext |
    undefined
): ReadonlyMap<
  number,
  SourcedAirPhaseRefractiveIndex
> {
  if (
    reduction.wavelengthBasis ===
      "vacuum"
  ) {
    if (context !== undefined) {
      throw new InvalidScientificInputError(
        "airPhotonEnergyContext must be omitted for vacuum-basis EQE conversion."
      );
    }
    return new Map();
  }

  if (
    reduction.wavelengthBasis !== "air"
  ) {
    throw new InvalidScientificInputError(
      "EQE electron-rate conversion requires a resolved air or vacuum wavelength basis."
    );
  }

  if (
    context === undefined ||
    !Array.isArray(context.samples) ||
    context.samples.length !==
      nodes.length
  ) {
    throw new InvalidScientificInputError(
      "Air-basis EQE conversion requires exactly one refractive-index sample for every spectral node."
    );
  }

  const byIndex =
    new Map<
      number,
      SourcedAirPhaseRefractiveIndex
    >();

  context.samples.forEach(
    (entry, arrayIndex) => {
      if (
        typeof entry !== "object" ||
        entry === null
      ) {
        throw new InvalidConfigurationError(
          "airPhotonEnergyContext.samples[" +
            arrayIndex +
            "] must be an object."
        );
      }

      const spectralSampleIndex =
        requireSafeNonNegativeInteger(
          entry.spectralSampleIndex,
          "airPhotonEnergyContext.samples[" +
            arrayIndex +
            "].spectralSampleIndex"
        );
      if (
        spectralSampleIndex >=
          nodes.length ||
        byIndex.has(
          spectralSampleIndex
        )
      ) {
        throw new InvalidScientificInputError(
          "airPhotonEnergyContext must contain unique in-range spectral sample identities."
        );
      }
      byIndex.set(
        spectralSampleIndex,
        entry.refractiveIndex
      );
    }
  );

  return byIndex;
}

function responseEvidenceMatches(
  actual:
    readonly EvidenceProvenance[],
  expected:
    readonly EvidenceProvenance[]
): boolean {
  return (
    canonicalJson(actual) ===
    canonicalJson(expected)
  );
}

function validateResponseBinding(
  resolved:
    ReturnType<
      typeof resolveParsedSensorSpectralResponseAtWavelength
    >["value"],
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
      reduction.responseScientificStatus
  ) {
    throw new InvalidScientificInputError(
      "Resolved spectral response metadata must exactly match the response used to construct the reduction."
    );
  }

  requireEquivalent(
    resolved.uncertainty,
    reduction.responseUncertainty,
    "Resolved spectral response uncertainty must match the reduction."
  );

  const expectedEvidence =
    reduction.componentEvidence.spectral;
  if (
    !responseEvidenceMatches(
      resolved.componentEvidence.profile,
      expectedEvidence.profile
    ) ||
    !responseEvidenceMatches(
      resolved.componentEvidence.channel,
      expectedEvidence.channel
    ) ||
    canonicalJson(
      resolved.componentEvidence.curves
    ) !==
      canonicalJson(
        expectedEvidence.curves
      )
  ) {
    throw new InvalidScientificInputError(
      "Resolved spectral response evidence must match the calibration evidence carried by the reduction."
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

function requireEqeResponse(
  response:
    ResolvedSensorSpectralResponseValue
): Extract<
  ResolvedSensorSpectralResponseValue,
  {
    kind:
      "effective-external-quantum-efficiency";
  }
> {
  if (
    response.kind !==
    "effective-external-quantum-efficiency"
  ) {
    throw new InvalidScientificInputError(
      "EQE electron-rate conversion cannot consume A/W spectral responsivity."
    );
  }
  return response;
}

/**
 * Converts the spectral radiant power collected by the site's geometric aperture
 * (before the sensor response) into an incident photon rate and an expected
 * generated electron rate.
 *
 * The response is applied at each wavelength node. One broadband-average QE is
 * never applied to the total power.
 *
 * Integration over exposure time happens later, so all outputs are rates per
 * second, not photon or electron counts.
 */
export function calculateSensorEqeElectronRate(
  input:
    CalculateSensorEqeElectronRateInput
): CalculationResult<SensorEqeElectronRate> {
  requireInputKeys(input, "calculateSensorEqeElectronRate", ["reduction", "compatibility", "operatingRange", "colorSamplingProfile", "spectralResponseProfile", "airPhotonEnergyContext"]);
  validateAuthorizationChain(
    input.reduction,
    input.compatibility,
    input.operatingRange
  );

  if (
    input.reduction
      .sourceResponseKind ===
      "effective-spectral-responsivity"
  ) {
    throw new InvalidScientificInputError(
      "EQE electron-rate conversion requires an EQE or filter×detector-EQE response, not A/W responsivity."
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

  const nodes =
    validateReductionSpectralNodes(
      input.reduction
    );
  validateOperatingRangeNodeBinding(
    input.reduction,
    nodes,
    input.operatingRange
  );

  const airIndices =
    parseAirContext(
      input.reduction,
      nodes,
      input.airPhotonEnergyContext
    );

  const photonRateSum:
    CompensatedSum = {
      sum: 0,
      correction: 0
    };
  const electronRateSum:
    CompensatedSum = {
      sum: 0,
      correction: 0
    };
  const perWavelength:
    SensorEqeWavelengthRateContribution[] =
      [];

  let responseBindingValidated =
    false;
  let channelFilterTransmissionApplied =
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

    const eqe =
      requireEqeResponse(
        resolved.value.response
      );

    const airIndex =
      airIndices.get(
        node.spectralSampleIndex
      );
    const photonEnergy =
      calculatePhotonEnergyFromWavelength({
        wavelengthNanometers:
          node.wavelengthNanometers,
        wavelengthBasis:
          input.reduction
            .wavelengthBasis,
        ...(input.reduction
          .wavelengthBasis === "air"
          ? {
              airPhaseRefractiveIndex:
                airIndex!,
              ...(input.airPhotonEnergyContext!
                .operatingConditions ===
              undefined
                ? {}
                : {
                    airOperatingConditions:
                      input
                        .airPhotonEnergyContext!
                        .operatingConditions
                  }),
              airConditionPolicy:
                input.airPhotonEnergyContext!
                  .conditionPolicy
            }
          : {})
      }).value;

    const radiantPowerContributionWatts =
      node
        .geometricApertureIncidentSpectralFluxWattsPerNanometer *
      node.wavelengthMeasureNanometers;
    const incidentPhotonRatePerSecond =
      radiantPowerContributionWatts /
      photonEnergy.photonEnergyJoules;
    const expectedGeneratedElectronRatePerSecond =
      incidentPhotonRatePerSecond *
      eqe.externalQuantumEfficiency;

    if (
      !Number.isFinite(
        radiantPowerContributionWatts
      ) ||
      !Number.isFinite(
        incidentPhotonRatePerSecond
      ) ||
      !Number.isFinite(
        expectedGeneratedElectronRatePerSecond
      )
    ) {
      throw new InvalidScientificInputError(
        "EQE wavelength-node rate calculation must remain finite."
      );
    }

    addCompensated(
      photonRateSum,
      incidentPhotonRatePerSecond
    );
    addCompensated(
      electronRateSum,
      expectedGeneratedElectronRatePerSecond
    );

    if (
      eqe.composition ===
      "channel-filter-transmittance-times-detector-eqe"
    ) {
      channelFilterTransmissionApplied =
        true;
    }

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
      vacuumWavelengthNanometers:
        photonEnergy
          .vacuumWavelengthNanometers,
      photonEnergyJoules:
        photonEnergy
          .photonEnergyJoules,
      wavelengthConversion:
        photonEnergy
          .wavelengthConversion,
      ...(photonEnergy
        .phaseRefractiveIndexUsed ===
      undefined
        ? {}
        : {
            phaseRefractiveIndexUsed:
              photonEnergy
                .phaseRefractiveIndexUsed
          }),
      ...(photonEnergy
        .airConditionCompatibility ===
      undefined
        ? {}
        : {
            airConditionCompatibility:
              photonEnergy
                .airConditionCompatibility
          }),
      ...(photonEnergy
        .airRefractiveIndexEvidence ===
      undefined
        ? {}
        : {
            airRefractiveIndexEvidence:
              photonEnergy
                .airRefractiveIndexEvidence
          }),
      incidentPhotonRatePerSecond,
      effectiveExternalQuantumEfficiency:
        eqe.externalQuantumEfficiency,
      responseComposition:
        eqe.composition,
      ...(eqe.channelFilterTransmittance ===
      undefined
        ? {}
        : {
            channelFilterTransmittance:
              eqe.channelFilterTransmittance
          }),
      ...(eqe
        .detectorExternalQuantumEfficiency ===
      undefined
        ? {}
        : {
            detectorExternalQuantumEfficiency:
              eqe
                .detectorExternalQuantumEfficiency
          }),
      responseInterpolationUsed:
        resolved.value
          .interpolationUsed,
      expectedGeneratedElectronRatePerSecond
    });
  }

  if (
    !Number.isFinite(
      photonRateSum.sum
    ) ||
    !Number.isFinite(
      electronRateSum.sum
    )
  ) {
    throw new InvalidScientificInputError(
      "Total EQE photon/electron rates must remain finite."
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
      site: {
        ...input.reduction.site
      },
      channelId:
        input.reduction.channelId,
      sourceResponseKind:
        input.reduction
          .sourceResponseKind,
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
      spectralNodeCount:
        nodes.length,
      perWavelength,
      incidentPhotonRatePerSecond:
        photonRateSum.sum,
      expectedGeneratedElectronRatePerSecond:
        electronRateSum.sum,
      summationMethod:
        "kahan-compensated",
      responseApplicationPerformed:
        true,
      quantumEfficiencyApplied:
        true,
      spectralResponsivityApplied:
        false,
      channelFilterTransmissionApplied,
      photonRateCalculated: true,
      electronRateCalculated: true,
      photonCountCalculated: false,
      electronCountCalculated: false,
      currentCalculated: false,
      temporalIntegrationApplied:
        false,
      exposureDurationApplied: false,
      saturationAssessed: false,
      shotNoiseApplied: false,
      readNoiseApplied: false,
      adcQuantizationApplied:
        false,
      rawCodeValueProduced: false,
      responseUncertaintyPropagated:
        false,
      photonEnergyUncertaintyPropagated:
        false,
      quadratureConvergenceErrorEstimated:
        false
    },
    "sensor-eqe-electron-rate",
    "1.0.0",
    [
      "Response is evaluated independently at every wavelength quadrature node; broadband radiant power is never multiplied by an average QE.",
      "Each node converts radiant power to photon rate using photon energy hν, then applies effective external QE to obtain expected generated-electron rate.",
      "Direct effective EQE is preserved as direct response; explicitly separable channel-filter transmittance × detector EQE is multiplied only through the existing spectral-response resolver.",
      "The response calibration metadata/evidence must match the spectral evidence carried by the pre-response reduction; matching profile IDs alone is insufficient.",
      "The structural compatibility and operating-range assessments must both be non-blocked and authorize the photon-rate→electron path.",
      "Operating-range authorization must be per spectral bin, with spectral-node identities and calibrated-domain values bound back to the exact reduction used for conversion.",
      "Operating-range authorization must establish linear superposition over the geometric aperture so spatial reduction may precede response application without hiding sub-aperture nonlinear behavior.",
      "Air-basis spectral nodes require one exact-wavelength sourced phase refractive index per spectral sample plus the photon-energy atmosphere compatibility policy.",
      "Kahan compensated summation is used across wavelength nodes to reduce loss of small contributions when rates span large dynamic ranges.",
      "Outputs are instantaneous expected rates only. Exposure duration, photon/electron counts, full-well saturation, shot/read noise, ADC/RAW conversion and reconstruction remain downstream.",
      "Response/refractive-index uncertainties and quadrature convergence error are not propagated into a combined output uncertainty by this version."
    ]
  );
}
