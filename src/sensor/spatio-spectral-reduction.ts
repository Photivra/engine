// SPDX-License-Identifier: Apache-2.0

/**
 * Spatio-spectral reduction: integrates spectral irradiance on the sensor over one site's area and
 * over wavelength, giving the incident light power on the site's geometric aperture.
 *
 * It stops before the sensor response: QE (quantum efficiency), A/W responsivity and colour-filter
 * transmission are applied in later steps.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  sensorSpatialQuadratureNodeIdentityKey,
  validateSensorSpatialSamplingQuadrature,
  type SensorSpatialQuadratureNodeIdentity
} from "./spatial-sample-reduction.js";
import type {
  SensorSpatialSamplingQuadrature
} from "./spatial-sampling-quadrature.js";
import {
  validateSensorSpectralQuadrature,
  type SensorSpectralQuadrature,
  type SensorSpectralQuadratureNode
} from "./spectral-quadrature.js";
import { requireInputKeys, requireInputNonNegativeFinite as requireNonNegativeFinite, requireInputNonNegativeSafeInteger as requireSafeNonNegativeInteger } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

const SQUARE_MICROMETERS_TO_SQUARE_METERS = 1e-12;
const MAX_SPATIO_SPECTRAL_SAMPLE_VALUES = 100_000;

export interface SensorSpatioSpectralNodeIdentity {
  spatialNode: SensorSpatialQuadratureNodeIdentity;
  spectralSampleIndex: number;
  wavelengthNanometers: number;
}

export interface SensorSpatioSpectralIrradianceSample {
  node: SensorSpatioSpectralNodeIdentity;
  /**
   * Spectral irradiance at the spatial node's preAntiAliasingSourcePointMm
   * and this spectral node's wavelength.
   *
   * Units: W/m^2/nm.
   */
  spectralIrradianceWattsPerSquareMeterPerNanometer: number;
}

export interface ReduceSensorSpatioSpectralIrradianceInput {
  spatialQuadrature: SensorSpatialSamplingQuadrature;
  spectralQuadrature: SensorSpectralQuadrature;
  /**
   * Exactly one E_lambda(x,y) value, with its node identity, for every
   * combination of spatial node and spectral node.
   *
   * Order does not matter; the node identity does.
   */
  sampleValues: readonly SensorSpatioSpectralIrradianceSample[];
}

export interface SensorSpatioSpectralWavelengthReduction {
  spectralSampleIndex: number;
  wavelengthNanometers: number;
  wavelengthMeasureNanometers: number;
  normalizedWavelengthWeight: number;
  /**
   * Spatially reduced spectral irradiance at this wavelength.
   * Units: W/m^2/nm.
   */
  normalizedSpatialAverageSpectralIrradianceWattsPerSquareMeterPerNanometer:
    number;
  /**
   * Spectral radiant flux reaching the geometric sensitive aperture, after the
   * declared normalized AA spreading. Units: W/nm.
   *
   * This uses geometric area, not an established light-collection area.
   */
  geometricApertureIncidentSpectralFluxWattsPerNanometer: number;
  /**
   * Contribution to the wavelength-integrated spatial average.
   * Units: W/m^2.
   */
  wavelengthIntegratedSpatialAverageContributionWattsPerSquareMeter: number;
  /**
   * Contribution to wavelength-integrated geometric-aperture incident flux.
   * Units: W.
   */
  wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts: number;
}

export interface SensorSpatioSpectralIrradianceReduction {
  colorSamplingProfileId: string;
  samplingApertureProfileId?: string;
  opticalStackProfileId?: string;
  site: {
    x: number;
    y: number;
  };
  channelId: string;
  responseProfileId: string;
  sourceResponseKind:
    SensorSpectralQuadrature["sourceResponseKind"];
  responseScope:
    SensorSpectralQuadrature["responseScope"];
  responseScientificStatus:
    SensorSpectralQuadrature["responseScientificStatus"];
  responseUncertainty:
    SensorSpectralQuadrature["responseUncertainty"];
  responseChannelBinding?:
    SensorSpectralQuadrature["responseChannelBinding"];
  responseReferenceConditions?:
    SensorSpectralQuadrature["responseReferenceConditions"];
  wavelengthBasis:
    SensorSpectralQuadrature["wavelengthBasis"];
  wavelengthBasisResolved: boolean;
  wavelengthRangeNanometers:
    SensorSpectralQuadrature["wavelengthRangeNanometers"];
  responseDeclaredWavelengthRangeNanometers:
    SensorSpectralQuadrature["responseDeclaredWavelengthRangeNanometers"];
  outputMeaning:
    "pre-response-spatio-spectral-radiometric-reduction";
  inputValueDomain: {
    kind: "radiometric-spectral-irradiance";
    unit: "W/m^2/nm";
    semantic:
      "pre-aa-pre-response-sensor-plane-spectral-irradiance";
  };
  spatialNodeCount: number;
  spectralNodeCount: number;
  combinedSampleCount: number;
  sourceValuesMatchedBy:
    "spatial-node-identity-plus-spectral-sample-index-and-wavelength";
  sourceValuesSuppliedForAllCombinedNodes: true;
  outsideImagingAreaSourceValuesRequired: boolean;
  geometricApertureAreaSquareMicrometers?: number;
  nominalSiteCellAreaSquareMicrometers?: number;
  geometricSensitiveAreaFractionOfLatticeCell?: number;
  perWavelength:
    readonly SensorSpatioSpectralWavelengthReduction[];
  /**
   * Integral over the requested wavelength interval of the spatially averaged
   * spectral irradiance. Units: W/m^2.
   */
  wavelengthIntegratedSpatialAverageIrradianceWattsPerSquareMeter:
    number;
  /**
   * Integral over the requested wavelength interval and the geometric
   * aperture area. Units: W.
   *
   * This is the incident radiant flux before the sensor response, over the
   * declared wavelength interval. It is not collected power or generated charge.
   */
  wavelengthIntegratedGeometricApertureIncidentFluxWatts:
    number;
  spatialIntegrationApplied: true;
  wavelengthIntegrationApplied: true;
  spectralResponsePlanUsedForWavelengthSupport: true;
  spectralResponseApplicationPerformed: false;
  responseScopeMatchedToSourcePlane: false;
  quantumEfficiencyApplied: false;
  spectralResponsivityApplied: false;
  channelFilterTransmissionApplied: false;
  opticalTransmissionAppliedByReducer: false;
  radiometricCollectionAreaEstablished: false;
  temporalIntegrationApplied: false;
  exposureDurationApplied: false;
  photonsCalculated: false;
  electronsCalculated: false;
  currentCalculated: false;
  shotNoiseApplied: false;
  readNoiseApplied: false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  demosaicOrReconstructionApplied: false;
  convergenceErrorEstimated: false;
  componentEvidence: {
    spatial:
      SensorSpatialSamplingQuadrature["componentEvidence"];
    spectral:
      SensorSpectralQuadrature["componentEvidence"];
  };
}

function sampleKey(
  spatialNode:
    SensorSpatialQuadratureNodeIdentity,
  spectralSampleIndex: number
): string {
  return (
    sensorSpatialQuadratureNodeIdentityKey(
      spatialNode
    ) +
    "|" +
    spectralSampleIndex
  );
}

function parseSamples<T extends { node: SensorSpatioSpectralNodeIdentity }, V>(
  sampleValues:
    readonly T[],
  spatialNodesByKey: ReadonlyMap<
    string,
    SensorSpatialSamplingQuadrature["nodes"][number]
  >,
  spectralNodesByIndex: ReadonlyMap<
    number,
    SensorSpectralQuadratureNode
  >,
  combinedSampleCount: number,
  valueForSample: (sample: T, sampleIndex: number) => V
): Map<string, V> {
  if (!Array.isArray(sampleValues)) {
    throw new InvalidConfigurationError(
      "sampleValues must be an array."
    );
  }
  if (
    sampleValues.length !==
    combinedSampleCount
  ) {
    throw new InvalidScientificInputError(
      "sampleValues must contain exactly one value for every spatial × spectral quadrature node."
    );
  }

  const valuesByKey =
    new Map<string, V>();

  sampleValues.forEach(
    (sample, sampleIndex) => {
      if (
        typeof sample !== "object" ||
        sample === null ||
        typeof sample.node !== "object" ||
        sample.node === null ||
        typeof sample.node.spatialNode !==
          "object" ||
        sample.node.spatialNode === null
      ) {
        throw new InvalidScientificInputError(
          "sampleValues[" +
            sampleIndex +
            "] must contain a complete spatio-spectral node identity."
        );
      }

      const spatialNode = {
        antiAliasingComponentIndex:
          requireSafeNonNegativeInteger(
            sample.node.spatialNode
              .antiAliasingComponentIndex,
            "sampleValues[" +
              sampleIndex +
              "].node.spatialNode.antiAliasingComponentIndex"
          ),
        apertureSampleXIndex:
          requireSafeNonNegativeInteger(
            sample.node.spatialNode
              .apertureSampleXIndex,
            "sampleValues[" +
              sampleIndex +
              "].node.spatialNode.apertureSampleXIndex"
          ),
        apertureSampleYIndex:
          requireSafeNonNegativeInteger(
            sample.node.spatialNode
              .apertureSampleYIndex,
            "sampleValues[" +
              sampleIndex +
              "].node.spatialNode.apertureSampleYIndex"
          )
      };
      const spatialKey =
        sensorSpatialQuadratureNodeIdentityKey(
          spatialNode
        );
      if (
        !spatialNodesByKey.has(
          spatialKey
        )
      ) {
        throw new InvalidScientificInputError(
          "sampleValues identifies a spatial node that is not present in spatialQuadrature."
        );
      }

      const spectralSampleIndex =
        requireSafeNonNegativeInteger(
          sample.node.spectralSampleIndex,
          "sampleValues[" +
            sampleIndex +
            "].node.spectralSampleIndex"
        );
      const spectralNode =
        spectralNodesByIndex.get(
          spectralSampleIndex
        );
      if (spectralNode === undefined) {
        throw new InvalidScientificInputError(
          "sampleValues identifies a spectral node that is not present in spectralQuadrature."
        );
      }

      const wavelengthNanometers =
        requireNonNegativeFinite(
          sample.node.wavelengthNanometers,
          "sampleValues[" +
            sampleIndex +
            "].node.wavelengthNanometers"
        );
      if (
        wavelengthNanometers !==
        spectralNode.wavelengthNanometers
      ) {
        throw new InvalidScientificInputError(
          "sampleValues wavelengthNanometers must exactly match the identified spectral quadrature node."
        );
      }

      const key = sampleKey(
        spatialNode,
        spectralSampleIndex
      );
      if (valuesByKey.has(key)) {
        throw new InvalidScientificInputError(
          "sampleValues contains duplicate spatio-spectral node identities."
        );
      }

      valuesByKey.set(
        key,
        valueForSample(sample, sampleIndex)
      );
    }
  );

  if (valuesByKey.size !== combinedSampleCount) {
    throw new InvalidScientificInputError("sampleValues must not contain sparse or missing node entries.");
  }
  return valuesByKey;
}

/** Internal: matches samples to their spatial × spectral nodes. Each caller still validates values and applies its own equations. */
export function bindSensorSpatioSpectralSamples<T extends { node: SensorSpatioSpectralNodeIdentity }, V>(
  input: { spatialQuadrature: SensorSpatialSamplingQuadrature; spectralQuadrature: SensorSpectralQuadrature; sampleValues: readonly T[] },
  valueForSample: (sample: T, sampleIndex: number) => V
): { spatialNodesByKey: Map<string, SensorSpatialSamplingQuadrature["nodes"][number]>;
  spectralNodesByIndex: Map<number, SensorSpectralQuadratureNode>; colorSamplingProfileId: string;
  combinedSampleCount: number; valuesByKey: Map<string, V> } {
  const spatialNodesByKey =
    validateSensorSpatialSamplingQuadrature(
      input.spatialQuadrature
    );
  const spectralNodesByIndex =
    validateSensorSpectralQuadrature(
      input.spectralQuadrature
    );

  const colorSamplingProfileId =
    input.spatialQuadrature
      .colorSamplingProfileId;
  if (
    typeof colorSamplingProfileId !==
      "string" ||
    colorSamplingProfileId.trim().length ===
      0
  ) {
    throw new InvalidScientificInputError(
      "spatialQuadrature.colorSamplingProfileId is required for spatio-spectral composition."
    );
  }
  if (
    colorSamplingProfileId !==
    input.spectralQuadrature
      .colorSamplingProfileId
  ) {
    throw new InvalidScientificInputError(
      "Spatial and spectral quadratures must reference the same colorSamplingProfileId."
    );
  }
  if (
    input.spatialQuadrature.channelId !==
    input.spectralQuadrature.channelId
  ) {
    throw new InvalidScientificInputError(
      "Spatial and spectral quadratures must reference the same exact channelId."
    );
  }

  if (
    input.spatialQuadrature.outputMeaning !==
      "pre-aa-optical-field-spatial-quadrature-nodes" ||
    input.spatialQuadrature
      .spectralResponseIncluded !== false ||
    input.spatialQuadrature
      .temporalIntegrationIncluded !== false
  ) {
    throw new InvalidScientificInputError(
      "spatialQuadrature semantics are incompatible with pre-response spatio-spectral reduction."
    );
  }

  const combinedSampleCount =
    spatialNodesByKey.size *
    spectralNodesByIndex.size;
  if (
    !Number.isSafeInteger(
      combinedSampleCount
    ) ||
    combinedSampleCount <= 0
  ) {
    throw new InvalidScientificInputError(
      "Spatial × spectral quadrature sample count must be a positive safe integer."
    );
  }
  if (
    combinedSampleCount >
    MAX_SPATIO_SPECTRAL_SAMPLE_VALUES
  ) {
    throw new InvalidScientificInputError(
      "Spatial × spectral quadrature sample count exceeds the safety limit of " +
        MAX_SPATIO_SPECTRAL_SAMPLE_VALUES +
        ". Tile/batch the evaluation instead of materializing one oversized Cartesian product."
    );
  }

  const valuesByKey =
    parseSamples(
      input.sampleValues,
      spatialNodesByKey,
      spectralNodesByIndex,
      combinedSampleCount,
      valueForSample
    );

  return { spatialNodesByKey, spectralNodesByIndex, colorSamplingProfileId, combinedSampleCount, valuesByKey };
}

/**
 * Integrates supplied spectral irradiance on the sensor plane, E_lambda(x,y),
 * over every combination of an existing spatial quadrature and spectral
 * quadrature.
 *
 * Units: the density is in W/m^2/nm and wavelengthMeasureNanometers is dλ in
 * nm, so their product is in W/m^2. Do not convert dλ to metres unless the
 * density's per-nanometre unit is converted to match.
 *
 * Area integration uses the spatial quadrature's geometric area measures,
 * converted from square micrometres to square metres. The result is the
 * incident radiant flux on the geometric aperture only; geometric area is not
 * treated as an effective light-collection area.
 *
 * It deliberately stops before the sensor response. The spectral plan comes
 * from a specific response channel, so its wavelength range and breakpoints
 * fit that channel, but QE, A/W responsivity and colour-filter transmission are
 * not applied here. Matching the response's scope and source plane is a
 * separate later step.
 */
export function reduceSensorSpatioSpectralIrradiance(
  input:
    ReduceSensorSpatioSpectralIrradianceInput
): CalculationResult<SensorSpatioSpectralIrradianceReduction> {
  requireInputKeys(input, "reduceSensorSpatioSpectralIrradiance", ["spatialQuadrature", "spectralQuadrature", "sampleValues"]);
  const { spatialNodesByKey, spectralNodesByIndex, colorSamplingProfileId, combinedSampleCount, valuesByKey } =
    bindSensorSpatioSpectralSamples(input, (sample, sampleIndex) => requireNonNegativeFinite(
      sample.spectralIrradianceWattsPerSquareMeterPerNanometer,
      "sampleValues[" + sampleIndex + "].spectralIrradianceWattsPerSquareMeterPerNanometer"
    ));

  const perWavelength:
    SensorSpatioSpectralWavelengthReduction[] =
      [];
  let wavelengthIntegratedSpatialAverage = 0;
  let wavelengthIntegratedGeometricFlux = 0;

  for (
    let spectralSampleIndex = 0;
    spectralSampleIndex <
    input.spectralQuadrature.totalNodeCount;
    spectralSampleIndex += 1
  ) {
    const spectralNode =
      spectralNodesByIndex.get(
        spectralSampleIndex
      );
    if (spectralNode === undefined) {
      throw new InvalidScientificInputError(
        "spectralQuadrature is missing a validated contiguous spectral sample."
      );
    }

    let spatialAverageSpectralIrradiance = 0;
    let geometricSpectralFluxWattsPerNanometer =
      0;

    spatialNodesByKey.forEach(
      (spatialNode, spatialKey) => {
        const value =
          valuesByKey.get(
            spatialKey +
              "|" +
              spectralSampleIndex
          );
        if (value === undefined) {
          throw new InvalidScientificInputError(
            "A spatio-spectral quadrature node is missing its explicit source value."
          );
        }

        spatialAverageSpectralIrradiance +=
          value *
          spatialNode
            .combinedNormalizedSpatialWeight;
        geometricSpectralFluxWattsPerNanometer +=
          value *
          (
            spatialNode
              .combinedAreaMeasureSquareMicrometers *
            SQUARE_MICROMETERS_TO_SQUARE_METERS
          );

        if (
          !Number.isFinite(
            spatialAverageSpectralIrradiance
          ) ||
          !Number.isFinite(
            geometricSpectralFluxWattsPerNanometer
          )
        ) {
          throw new InvalidScientificInputError(
            "Reduced spatio-spectral values must remain finite."
          );
        }
      }
    );

    const spatialAverageContribution =
      spatialAverageSpectralIrradiance *
      spectralNode
        .wavelengthMeasureNanometers;
    const geometricFluxContribution =
      geometricSpectralFluxWattsPerNanometer *
      spectralNode
        .wavelengthMeasureNanometers;

    wavelengthIntegratedSpatialAverage +=
      spatialAverageContribution;
    wavelengthIntegratedGeometricFlux +=
      geometricFluxContribution;

    if (
      !Number.isFinite(
        wavelengthIntegratedSpatialAverage
      ) ||
      !Number.isFinite(
        wavelengthIntegratedGeometricFlux
      )
    ) {
      throw new InvalidScientificInputError(
        "Wavelength-integrated spatio-spectral values must remain finite."
      );
    }

    perWavelength.push({
      spectralSampleIndex,
      wavelengthNanometers:
        spectralNode.wavelengthNanometers,
      wavelengthMeasureNanometers:
        spectralNode
          .wavelengthMeasureNanometers,
      normalizedWavelengthWeight:
        spectralNode
          .normalizedWavelengthWeight,
      normalizedSpatialAverageSpectralIrradianceWattsPerSquareMeterPerNanometer:
        spatialAverageSpectralIrradiance,
      geometricApertureIncidentSpectralFluxWattsPerNanometer:
        geometricSpectralFluxWattsPerNanometer,
      wavelengthIntegratedSpatialAverageContributionWattsPerSquareMeter:
        spatialAverageContribution,
      wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts:
        geometricFluxContribution
    });
  }

  return approximationResult(
    {
      colorSamplingProfileId,
      ...(input.spatialQuadrature
        .samplingApertureProfileId ===
      undefined
        ? {}
        : {
            samplingApertureProfileId:
              input.spatialQuadrature
                .samplingApertureProfileId
          }),
      ...(input.spatialQuadrature
        .opticalStackProfileId ===
      undefined
        ? {}
        : {
            opticalStackProfileId:
              input.spatialQuadrature
                .opticalStackProfileId
          }),
      site: {
        ...input.spatialQuadrature.site
      },
      channelId:
        input.spatialQuadrature.channelId,
      responseProfileId:
        input.spectralQuadrature.profileId,
      sourceResponseKind:
        input.spectralQuadrature
          .sourceResponseKind,
      responseScope:
        input.spectralQuadrature
          .responseScope,
      responseScientificStatus:
        input.spectralQuadrature
          .responseScientificStatus,
      responseUncertainty:
        input.spectralQuadrature
          .responseUncertainty,
      ...(input.spectralQuadrature
        .responseChannelBinding ===
      undefined
        ? {}
        : {
            responseChannelBinding:
              input.spectralQuadrature
                .responseChannelBinding
          }),
      ...(input.spectralQuadrature
        .responseReferenceConditions ===
      undefined
        ? {}
        : {
            responseReferenceConditions:
              input.spectralQuadrature
                .responseReferenceConditions
          }),
      wavelengthBasis:
        input.spectralQuadrature
          .wavelengthBasis,
      wavelengthBasisResolved:
        input.spectralQuadrature
          .wavelengthBasisResolved,
      wavelengthRangeNanometers: {
        ...input.spectralQuadrature
          .wavelengthRangeNanometers
      },
      responseDeclaredWavelengthRangeNanometers:
        {
          ...input.spectralQuadrature
            .responseDeclaredWavelengthRangeNanometers
        },
      outputMeaning:
        "pre-response-spatio-spectral-radiometric-reduction",
      inputValueDomain: {
        kind:
          "radiometric-spectral-irradiance",
        unit: "W/m^2/nm",
        semantic:
          "pre-aa-pre-response-sensor-plane-spectral-irradiance"
      },
      spatialNodeCount:
        input.spatialQuadrature
          .totalNodeCount,
      spectralNodeCount:
        input.spectralQuadrature
          .totalNodeCount,
      combinedSampleCount,
      sourceValuesMatchedBy:
        "spatial-node-identity-plus-spectral-sample-index-and-wavelength",
      sourceValuesSuppliedForAllCombinedNodes:
        true,
      outsideImagingAreaSourceValuesRequired:
        input.spatialQuadrature
          .preAntiAliasingSourceOutsideImagingAreaNodeCount >
        0,
      geometricApertureAreaSquareMicrometers:
        input.spatialQuadrature
          .geometricApertureAreaSquareMicrometers,
      ...(input.spatialQuadrature
        .nominalSiteCellAreaSquareMicrometers ===
      undefined
        ? {}
        : {
            nominalSiteCellAreaSquareMicrometers:
              input.spatialQuadrature
                .nominalSiteCellAreaSquareMicrometers
          }),
      ...(input.spatialQuadrature
        .geometricSensitiveAreaFractionOfLatticeCell ===
      undefined
        ? {}
        : {
            geometricSensitiveAreaFractionOfLatticeCell:
              input.spatialQuadrature
                .geometricSensitiveAreaFractionOfLatticeCell
          }),
      perWavelength,
      wavelengthIntegratedSpatialAverageIrradianceWattsPerSquareMeter:
        wavelengthIntegratedSpatialAverage,
      wavelengthIntegratedGeometricApertureIncidentFluxWatts:
        wavelengthIntegratedGeometricFlux,
      spatialIntegrationApplied: true,
      wavelengthIntegrationApplied: true,
      spectralResponsePlanUsedForWavelengthSupport:
        true,
      spectralResponseApplicationPerformed:
        false,
      responseScopeMatchedToSourcePlane:
        false,
      quantumEfficiencyApplied: false,
      spectralResponsivityApplied: false,
      channelFilterTransmissionApplied:
        false,
      opticalTransmissionAppliedByReducer:
        false,
      radiometricCollectionAreaEstablished:
        false,
      temporalIntegrationApplied: false,
      exposureDurationApplied: false,
      photonsCalculated: false,
      electronsCalculated: false,
      currentCalculated: false,
      shotNoiseApplied: false,
      readNoiseApplied: false,
      adcQuantizationApplied: false,
      rawCodeValueProduced: false,
      demosaicOrReconstructionApplied:
        false,
      convergenceErrorEstimated: false,
      componentEvidence: {
        spatial:
          input.spatialQuadrature
            .componentEvidence,
        spectral:
          input.spectralQuadrature
            .componentEvidence
      }
    },
    "sensor-spatio-spectral-irradiance-reduction",
    "1.0.0",
    [
      "Input values are nonnegative sensor-plane spectral irradiance E_lambda(x,y) in W/m^2/nm, evaluated at every spatial pre-AA source coordinate and spectral quadrature wavelength.",
      "Spatial and spectral plans must share the exact colorSamplingProfileId and channelId; a matching channel label alone is insufficient linkage.",
      "The full Cartesian product is explicit and capped at 100,000 supplied sample values to avoid multiplicative memory blowups.",
      "Spatial normalized weights form the per-wavelength average; geometric square-micrometre area measures are converted to square metres for incident spectral flux density.",
      "Physical wavelength integration multiplies W/m^2/nm or W/nm by d-lambda in nm. No extra 1e-9 factor is applied because the spectral density is already per nanometre.",
      "The spatial AA kernel is the existing normalized throughput-free spatial redistribution; this reducer adds no omitted optical-stack or microlens throughput.",
      "The spectral quadrature's response-derived support and breakpoints are consumed, but QE, A/W responsivity and channel-filter transmission are not applied.",
      "Response scope is preserved for downstream work but is not matched to a declared source plane in this version.",
      "Geometric aperture area is not promoted to effective radiometric collection area.",
      "Temporal exposure integration, photon/electron conversion, electrical current, noise, saturation, ADC/RAW conversion and reconstruction remain separate future work.",
      "No source-independent spatio-spectral convergence/error estimate is reported; downstream integrand structure controls numerical error."
    ]
  );
}
