// SPDX-License-Identifier: Apache-2.0

/**
 * Spatial sampling quadrature: the sample points (nodes) and weights used to average light over one
 * sensor site.
 *
 * It combines the site's geometric light-sensitive aperture (sampling-aperture) with the anti-aliasing
 * (AA) point-splitting kernel (optical-stack). The aperture is integrated with a grid of evenly spaced
 * midpoints. If an AA component moves light by +delta on the sensor, a destination point samples the
 * light field before AA at destination − delta, so the shift is never applied twice. Normalized weights
 * give a spatial average; square-micrometre measures give a geometric area integral. Neither includes
 * throughput, QE (quantum efficiency), photon conversion, microlenses, diffusion, crosstalk or
 * integration over time.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveInteger
} from "../core/validation.js";
import type {
  NativeEffectiveRasterColorSamplingBindingProfile
} from "./capture-color-sampling-binding.js";
import type {
  NativeColorSamplingSiteIndex,
  SensorColorSamplingProfile
} from "./color-sampling.js";
import {
  resolveAntiAliasingSpatialKernel,
  type SensorOpticalStackProfile
} from "./optical-stack.js";
import {
  resolveSensorSamplingAperture,
  type SensorSamplingApertureProfile
} from "./sampling-aperture.js";
import type {
  NativeImageRaster,
  SensorImagingArea
} from "./sensor-geometry.js";
import { requireInputKeys } from "../core/record-validation.js";
import { midpointPhase as midpointCoordinate } from "../motion/capture-rotation-temporal-quadrature.js";

const MAX_SPATIAL_QUADRATURE_NODES = 100_000;

export interface CalculateSensorSpatialSamplingQuadratureInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
  colorSamplingProfile: SensorColorSamplingProfile;
  colorSamplingBindingProfile: NativeEffectiveRasterColorSamplingBindingProfile;
  samplingApertureProfile: SensorSamplingApertureProfile;
  opticalStackProfile: SensorOpticalStackProfile;
  site: NativeColorSamplingSiteIndex;
  /** Number of midpoint cells across the geometric aperture width. */
  spatialSampleCountX: number;
  /** Number of midpoint cells across the geometric aperture height. */
  spatialSampleCountY: number;
}

export interface SensorSpatialSamplingQuadratureNode {
  antiAliasingComponentIndex: number;
  apertureSampleXIndex: number;
  apertureSampleYIndex: number;
  /**
   * Destination point inside the geometric sensitive aperture, after the
   * declared AA point splitting.
   *
   * Native sensor physical coordinates, in millimetres from the optical axis.
   */
  destinationAperturePointMm: {
    x: number;
    y: number;
  };
  /**
   * How far the declared AA component moves light on the sensor plane.
   *
   * +X right, +Y down; micrometres.
   */
  antiAliasingOffsetMicrometers: {
    x: number;
    y: number;
  };
  /**
   * The point in the light field before AA that lands on
   * destinationAperturePointMm through this split component:
   *
   * source = destination - AA offset
   */
  preAntiAliasingSourcePointMm: {
    x: number;
    y: number;
  };
  /**
   * Whether the pre-AA source point is inside the active physical imaging
   * area. False is not an error; downstream code decides how to handle valid
   * light from outside the active sampling area.
   */
  preAntiAliasingSourceInsideImagingArea: boolean;
  /** Dimensionless midpoint weight for the aperture-area average. */
  normalizedApertureWeight: number;
  /** Dimensionless normalized weight from the AA split component. */
  normalizedAntiAliasingWeight: number;
  /**
   * Product of the two weights (dimensionless), used to average a light field
   * over the site with this quadrature.
   */
  combinedNormalizedSpatialWeight: number;
  /**
   * Geometric area this aperture midpoint stands for, before the AA component
   * weight is applied. Units: square micrometres.
   */
  apertureAreaMeasureSquareMicrometers: number;
  /**
   * Geometric area multiplied by the (dimensionless) AA component weight.
   * Units are still square micrometres.
   *
   * This is not an effective light-collection area.
   */
  combinedAreaMeasureSquareMicrometers: number;
}

export interface SensorSpatialSamplingQuadrature {
  coordinateSystem: "native-sensor-physical";
  colorSamplingProfileId?: string;
  samplingApertureProfileId?: string;
  opticalStackProfileId?: string;
  site: NativeColorSamplingSiteIndex;
  channelId: string;
  quadratureScheme:
    "tensor-product-uniform-midpoint";
  outputMeaning:
    "pre-aa-optical-field-spatial-quadrature-nodes";
  spatialSampleCountX: number;
  spatialSampleCountY: number;
  antiAliasingComponentCount: number;
  totalNodeCount: number;
  geometricApertureAreaSquareMicrometers: number;
  nominalSiteCellAreaSquareMicrometers?: number;
  geometricSensitiveAreaFractionOfLatticeCell?: number;
  normalizedSpatialWeightSum: number;
  combinedAreaMeasureSumSquareMicrometers: number;
  preAntiAliasingSourceOutsideImagingAreaNodeCount: number;
  sourcePointRule:
    "pre-aa-source-equals-destination-minus-aa-offset";
  destinationCfaChannelAppliesToAllNodes: true;
  cfaReassignmentBySourceCoordinate: false;
  sourceCoveragePolicy: "not-applied";
  nodes: readonly SensorSpatialSamplingQuadratureNode[];
  /**
   * Fixed statements of what this result does not include.
   */
  opticalFieldValuesIncluded: false;
  radianceIncluded: false;
  photonsIncluded: false;
  electronsIncluded: false;
  spectralResponseIncluded: false;
  quantumEfficiencyIncluded: false;
  opticalThroughputIncluded: false;
  microlensResponseIncluded: false;
  chargeDiffusionIncluded: false;
  electricalCrosstalkIncluded: false;
  temporalIntegrationIncluded: false;
  rawSampleValueIncluded: false;
  reconstructedPixelValueIncluded: false;
  geometricAreaMeasureIsRadiometricCollectionArea: false;
  componentEvidence: {
    samplingApertureProfile: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
    samplingApertureLattice: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
    geometricSensitiveAperture: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
    opticalStackProfile: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
    antiAliasingResponse: readonly import("../core/evidence-provenance.js").EvidenceProvenance[];
  };
}

function insideImagingArea(
  pointMm: { x: number; y: number },
  imagingArea: SensorImagingArea
): boolean {
  const halfWidth = imagingArea.widthMm / 2;
  const halfHeight = imagingArea.heightMm / 2;

  return (
    pointMm.x >= -halfWidth &&
    pointMm.x <= halfWidth &&
    pointMm.y >= -halfHeight &&
    pointMm.y <= halfHeight
  );
}

/**
 * Builds the deterministic spatial sample points (quadrature nodes) for one CFA
 * (colour filter array) site.
 *
 * It combines:
 *
 * 1. the site's geometric light-sensitive aperture (from sampling-aperture); and
 * 2. the anti-aliasing (AA) point-splitting kernel (from optical-stack).
 *
 * The aperture is integrated with a grid of evenly spaced midpoints (a
 * tensor-product midpoint rule). If an AA component moves light by +delta on
 * the sensor, a destination point samples the light field before AA at
 * destination − delta. Working backwards like this means the shift is never
 * applied twice.
 *
 * The destination site's CFA channel applies to every node. The pre-AA source
 * point is a position in the light field, not another CFA site, so a shifted
 * source point never changes the destination channel.
 *
 * Nodes whose pre-AA source point falls outside the active imaging area are
 * kept. They are neither clamped nor dropped (and weights are not
 * renormalized). The renderer or light-field provider decides how to cover them.
 *
 * Normalized weights approximate a spatial average. Square-micrometre measures
 * approximate a geometric area integral. Neither includes throughput, QE,
 * photon conversion, microlenses, diffusion, crosstalk or integration over time.
 */
export function calculateSensorSpatialSamplingQuadrature(
  input: CalculateSensorSpatialSamplingQuadratureInput
): CalculationResult<SensorSpatialSamplingQuadrature> {
  requireInputKeys(input, "calculateSensorSpatialSamplingQuadrature", ["imagingArea", "nativeRaster", "colorSamplingProfile", "colorSamplingBindingProfile", "samplingApertureProfile", "opticalStackProfile", "site", "spatialSampleCountX", "spatialSampleCountY"]);
  requirePositiveInteger(
    "spatialSampleCountX",
    input.spatialSampleCountX
  );
  requirePositiveInteger(
    "spatialSampleCountY",
    input.spatialSampleCountY
  );

  const samplingAperture =
    resolveSensorSamplingAperture({
      imagingArea: input.imagingArea,
      nativeRaster: input.nativeRaster,
      colorSamplingProfile:
        input.colorSamplingProfile,
      colorSamplingBindingProfile:
        input.colorSamplingBindingProfile,
      samplingApertureProfile:
        input.samplingApertureProfile,
      site: input.site
    });

  const antiAliasing =
    resolveAntiAliasingSpatialKernel(
      input.opticalStackProfile
    );

  const apertureNodeCount =
    input.spatialSampleCountX *
    input.spatialSampleCountY;
  if (!Number.isSafeInteger(apertureNodeCount)) {
    throw new InvalidScientificInputError(
      "spatialSampleCountX × spatialSampleCountY must be a safe integer."
    );
  }

  const totalNodeCount =
    apertureNodeCount *
    antiAliasing.components.length;
  if (!Number.isSafeInteger(totalNodeCount)) {
    throw new InvalidScientificInputError(
      "Spatial quadrature node count must be a safe integer."
    );
  }
  if (
    totalNodeCount >
    MAX_SPATIAL_QUADRATURE_NODES
  ) {
    throw new InvalidScientificInputError(
      "Spatial quadrature node count exceeds the per-site safety limit of " +
        MAX_SPATIAL_QUADRATURE_NODES +
        ". Increase fidelity by tiling or batching downstream work rather than allocating one oversized node set."
    );
  }

  const aperture =
    samplingAperture.geometricSensitiveAperture;
  const normalizedApertureWeight =
    1 / apertureNodeCount;
  const apertureAreaMeasureSquareMicrometers =
    aperture.areaSquareMicrometers /
    apertureNodeCount;

  const apertureCenterMm =
    aperture.centerFromOpticalAxisMm;
  const widthMm =
    aperture.widthMicrometers / 1000;
  const heightMm =
    aperture.heightMicrometers / 1000;
  const leftMm =
    apertureCenterMm.x - widthMm / 2;
  const topMm =
    apertureCenterMm.y - heightMm / 2;

  const nodes: SensorSpatialSamplingQuadratureNode[] = [];
  let outsideCount = 0;

  antiAliasing.components.forEach(
    (aaComponent, antiAliasingComponentIndex) => {
      const aaOffsetMm = {
        x:
          aaComponent.offsetMicrometers.x /
          1000,
        y:
          aaComponent.offsetMicrometers.y /
          1000
      };

      for (
        let apertureSampleYIndex = 0;
        apertureSampleYIndex <
        input.spatialSampleCountY;
        apertureSampleYIndex += 1
      ) {
        const yPhase = midpointCoordinate(
          apertureSampleYIndex,
          input.spatialSampleCountY
        );
        const destinationY =
          topMm + yPhase * heightMm;

        for (
          let apertureSampleXIndex = 0;
          apertureSampleXIndex <
          input.spatialSampleCountX;
          apertureSampleXIndex += 1
        ) {
          const xPhase = midpointCoordinate(
            apertureSampleXIndex,
            input.spatialSampleCountX
          );
          const destinationX =
            leftMm + xPhase * widthMm;
          const destinationAperturePointMm = {
            x: destinationX,
            y: destinationY
          };
          const preAntiAliasingSourcePointMm = {
            x:
              destinationX -
              aaOffsetMm.x,
            y:
              destinationY -
              aaOffsetMm.y
          };
          const sourceInside = insideImagingArea(
            preAntiAliasingSourcePointMm,
            input.imagingArea
          );
          if (!sourceInside) {
            outsideCount += 1;
          }

          const combinedNormalizedSpatialWeight =
            normalizedApertureWeight *
            aaComponent.normalizedWeight;
          const combinedAreaMeasureSquareMicrometers =
            apertureAreaMeasureSquareMicrometers *
            aaComponent.normalizedWeight;

          nodes.push({
            antiAliasingComponentIndex,
            apertureSampleXIndex,
            apertureSampleYIndex,
            destinationAperturePointMm,
            antiAliasingOffsetMicrometers: {
              ...aaComponent.offsetMicrometers
            },
            preAntiAliasingSourcePointMm,
            preAntiAliasingSourceInsideImagingArea:
              sourceInside,
            normalizedApertureWeight,
            normalizedAntiAliasingWeight:
              aaComponent.normalizedWeight,
            combinedNormalizedSpatialWeight,
            apertureAreaMeasureSquareMicrometers,
            combinedAreaMeasureSquareMicrometers
          });
        }
      }
    }
  );

  const normalizedSpatialWeightSum =
    nodes.reduce(
      (sum, node) =>
        sum +
        node.combinedNormalizedSpatialWeight,
      0
    );
  const combinedAreaMeasureSumSquareMicrometers =
    nodes.reduce(
      (sum, node) =>
        sum +
        node.combinedAreaMeasureSquareMicrometers,
      0
    );

  return approximationResult(
    {
      coordinateSystem:
        "native-sensor-physical",
      colorSamplingProfileId:
        samplingAperture
          .colorSamplingProfileId,
      samplingApertureProfileId:
        samplingAperture.profileId,
      opticalStackProfileId:
        antiAliasing.profileId,
      site: {
        ...samplingAperture.site
      },
      channelId:
        samplingAperture.channelId,
      quadratureScheme:
        "tensor-product-uniform-midpoint",
      outputMeaning:
        "pre-aa-optical-field-spatial-quadrature-nodes",
      spatialSampleCountX:
        input.spatialSampleCountX,
      spatialSampleCountY:
        input.spatialSampleCountY,
      antiAliasingComponentCount:
        antiAliasing.components.length,
      totalNodeCount,
      geometricApertureAreaSquareMicrometers:
        aperture.areaSquareMicrometers,
      nominalSiteCellAreaSquareMicrometers:
        samplingAperture.lattice
          .nominalCellAreaSquareMicrometers,
      geometricSensitiveAreaFractionOfLatticeCell:
        aperture
          .geometricSensitiveAreaFractionOfLatticeCell,
      normalizedSpatialWeightSum,
      combinedAreaMeasureSumSquareMicrometers,
      preAntiAliasingSourceOutsideImagingAreaNodeCount:
        outsideCount,
      sourcePointRule:
        "pre-aa-source-equals-destination-minus-aa-offset",
      destinationCfaChannelAppliesToAllNodes:
        true,
      cfaReassignmentBySourceCoordinate:
        false,
      sourceCoveragePolicy:
        "not-applied",
      nodes,
      opticalFieldValuesIncluded: false,
      radianceIncluded: false,
      photonsIncluded: false,
      electronsIncluded: false,
      spectralResponseIncluded: false,
      quantumEfficiencyIncluded: false,
      opticalThroughputIncluded: false,
      microlensResponseIncluded: false,
      chargeDiffusionIncluded: false,
      electricalCrosstalkIncluded: false,
      temporalIntegrationIncluded: false,
      rawSampleValueIncluded: false,
      reconstructedPixelValueIncluded: false,
      geometricAreaMeasureIsRadiometricCollectionArea:
        false,
      componentEvidence: {
        samplingApertureProfile:
          samplingAperture.provenance.profile,
        samplingApertureLattice:
          samplingAperture.provenance.lattice,
        geometricSensitiveAperture:
          samplingAperture.provenance.aperture,
        opticalStackProfile:
          antiAliasing.provenance.profile,
        antiAliasingResponse:
          antiAliasing.provenance
            .antiAliasingResponse
      }
    },
    "sensor-spatial-sampling-quadrature",
    "1.0.0",
    [
      "Spatial aperture integration uses a deterministic tensor-product uniform midpoint rule.",
      "The destination sensor site's semantic CFA/color channel applies to every quadrature node; pre-AA source coordinates never reassign the destination channel.",
      "AA point-splitting is inverse-sampled: a +delta output displacement reads the pre-AA optical field at destination - delta.",
      "AA component weights and aperture midpoint weights are dimensionless normalized spatial-average weights.",
      "Square-micrometre measures are geometric integration measures only and are not effective radiometric collection area, throughput, QE, or photon count.",
      "Pre-AA source points may leave the active physical imaging area and are not clamped, dropped, or renormalized.",
      "The AA kernel remains the optical-stack foundation's field/wavelength/polarization-invariant approximation where applicable.",
      "Microlens spatial response, charge diffusion, electrical/optical crosstalk, spectral response, radiometry, temporal integration, RAW sample generation, and reconstruction remain separate future work.",
      "No geometry-only spatial quadrature error estimate is reported because downstream optical-field spatial frequency/content determines integration error."
    ]
  );
}
