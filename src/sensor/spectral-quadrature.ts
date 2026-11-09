// SPDX-License-Identifier: Apache-2.0

/**
 * Spectral quadrature: the wavelength sample points (nodes) and step widths used to integrate light
 * over wavelength for one sensor response channel.
 *
 * Each node is the midpoint of a wavelength interval, with its width dλ in nanometres. The intervals
 * stay inside the range the response supports. Lining nodes up with curve breakpoints does not prove
 * the integral has converged. Discrete (delta-like) emission lines need their own integration and are
 * never silently widened into continuous bins.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type {
  SpectralWavelengthBasis,
  SpectralWavelengthRangeNanometers
} from "../core/spectral.js";
import {
  parseSensorColorSamplingProfile,
  type SensorColorSamplingProfile
} from "./color-sampling.js";
import {
  createSensorSpectralResponseChannelBinding,
  parseSensorSpectralResponseProfile,
  resolveSensorSpectralResponseAtWavelength,
  type SensorSpectralReferenceConditions,
  type SensorSpectralResponseProfile,
  type SensorSpectralResponseScientificStatus,
  type SensorSpectralResponseUncertainty
} from "./spectral-response.js";
import { requireInputKeys, requireInputPositiveFinite as requirePositiveFinite, requireInputNonNegativeSafeInteger as requireNonNegativeSafeInteger } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { responseCurves } from "./spectral-coverage.js";

const MAX_SPECTRAL_QUADRATURE_NODES = 100_000;

export type SensorSpectralWavelengthRangeNanometers =
  SpectralWavelengthRangeNanometers;

export interface CalculateSensorSpectralQuadratureInput {
  colorSamplingProfile: SensorColorSamplingProfile;
  spectralResponseProfile: SensorSpectralResponseProfile;
  channelId: string;
  wavelengthBasis: SpectralWavelengthBasis;
  /**
   * Wavelength interval to sample. It is checked only against the range the
   * sensor response supports, not against scene-spectrum or optical-transmission
   * coverage.
   */
  wavelengthRangeNanometers:
    SensorSpectralWavelengthRangeNanometers;
  /**
   * Strict upper limit on the width of each midpoint subinterval.
   *
   * Response breakpoints and any additional breakpoints split the requested
   * range first. Each segment is then subdivided until every subinterval is
   * no wider than this value.
   */
  maximumSubintervalWidthNanometers: number;
  /**
   * Optional strictly increasing wavelength breakpoints from other continuous
   * spectral inputs, such as the interpolation points of a scene spectrum or of
   * optical transmission. Values must be strictly inside the requested range.
   *
   * Passing them does not claim those other inputs are available or valid over
   * the requested range.
   */
  additionalBreakpointsNanometers?:
    readonly number[];
}

export interface SensorSpectralQuadratureNode {
  spectralSampleIndex: number;
  segmentIndex: number;
  subdivisionIndex: number;
  segmentSubdivisionCount: number;
  /**
   * Midpoint wavelength for this subinterval. Units: nm in wavelengthBasis.
   */
  wavelengthNanometers: number;
  /**
   * dλ (wavelength width) this node stands for. Units: nm.
   *
   * It is only a wavelength width. It is not response-weighted throughput,
   * a photon count, radiant energy, current or a dimensionless probability.
   */
  wavelengthMeasureNanometers: number;
  /**
   * The wavelength width divided by the requested range width (dimensionless).
   *
   * Useful for averages, but it is not a sensor-response weight.
   */
  normalizedWavelengthWeight: number;
}

export interface SensorSpectralQuadrature {
  profileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  sourceResponseKind:
    SensorSpectralResponseProfile["channels"][number]["kind"];
  responseScope:
    SensorSpectralResponseProfile["channels"][number]["responseScope"];
  responseScientificStatus:
    SensorSpectralResponseScientificStatus;
  responseUncertainty:
    SensorSpectralResponseUncertainty;
  responseChannelBinding?: import("./spectral-response.js").SensorSpectralResponseChannelBinding;
  responseReferenceConditions?:
    SensorSpectralReferenceConditions;
  wavelengthBasis: SpectralWavelengthBasis;
  wavelengthBasisResolved: boolean;
  wavelengthRangeNanometers:
    SensorSpectralWavelengthRangeNanometers;
  responseDeclaredWavelengthRangeNanometers:
    SensorSpectralWavelengthRangeNanometers;
  quadratureScheme:
    "response-breakpoint-aware-bounded-midpoint";
  segmentBoundarySource:
    "requested-range-plus-response-knots-plus-optional-additional-breakpoints";
  /**
   * Sorted, unique segment boundaries, including the ends of the requested range.
   */
  segmentBoundariesNanometers:
    readonly number[];
  maximumSubintervalWidthNanometers: number;
  segmentCount: number;
  totalNodeCount: number;
  normalizedWavelengthWeightSum: number;
  wavelengthMeasureSumNanometers: number;
  nodes: readonly SensorSpectralQuadratureNode[];
  responseKnotAlignmentIncluded: true;
  componentEvidence: {
    colorSamplingProfile: readonly EvidenceProvenance[];
    profile: readonly EvidenceProvenance[];
    channel: readonly EvidenceProvenance[];
    curves:
      readonly (readonly EvidenceProvenance[])[];
  };
  /**
   * Fixed statements of what this result does not include.
   */
  responseValuesIncluded: false;
  responseApplicationPerformed: false;
  sourceSpectralValuesIncluded: false;
  spectralIrradianceIncluded: false;
  spectralPhotonIrradianceIncluded: false;
  commonSpectralCoverageValidated: false;
  continuousSpectralDensityQuadratureOnly: true;
  discreteLineSpectrumIncluded: false;
  opticalTransmissionIncludedByQuadrature: false;
  wavelengthIntegrationPerformed: false;
  spatialIntegrationPerformed: false;
  temporalIntegrationPerformed: false;
  photonsCalculated: false;
  electronsCalculated: false;
  rawCodeValueProduced: false;
  convergenceErrorEstimated: false;
}

interface ResponseCurveSupport {
  wavelengthBasis: SpectralWavelengthBasis;
  samples: readonly {
    wavelengthNanometers: number;
  }[];
  evidence: readonly EvidenceProvenance[];
}

interface SegmentPlan {
  minimum: number;
  maximum: number;
  subdivisionCount: number;
  subintervalWidthNanometers: number;
}

function channelResponse(
  profile: SensorSpectralResponseProfile,
  channelId: string
): SensorSpectralResponseProfile["channels"][number] {
  if (
    typeof channelId !== "string" ||
    channelId.trim().length === 0
  ) {
    throw new InvalidConfigurationError(
      "channelId must be a non-empty string."
    );
  }

  const response = profile.channels.find(
    (entry) => entry.channelId === channelId
  );
  if (response === undefined) {
    throw new InvalidScientificInputError(
      "No spectral response is declared for the requested channelId."
    );
  }
  return response;
}

function usableResponseRange(
  curves: readonly ResponseCurveSupport[]
): SensorSpectralWavelengthRangeNanometers {
  const minimum = Math.max(
    ...curves.map(
      (curve) =>
        curve.samples[0]!
          .wavelengthNanometers
    )
  );
  const maximum = Math.min(
    ...curves.map(
      (curve) =>
        curve.samples[
          curve.samples.length - 1
        ]!.wavelengthNanometers
    )
  );

  if (!(minimum < maximum)) {
    throw new InvalidScientificInputError(
      "Spectral-response curves do not have a usable overlapping wavelength interval."
    );
  }

  return { minimum, maximum };
}

function parseRequestedRange(
  input:
    SensorSpectralWavelengthRangeNanometers,
  usable:
    SensorSpectralWavelengthRangeNanometers
): SensorSpectralWavelengthRangeNanometers {
  if (
    typeof input !== "object" ||
    input === null
  ) {
    throw new InvalidConfigurationError(
      "wavelengthRangeNanometers must be an object."
    );
  }

  const minimum = requirePositiveFinite(
    input.minimum,
    "wavelengthRangeNanometers.minimum"
  );
  const maximum = requirePositiveFinite(
    input.maximum,
    "wavelengthRangeNanometers.maximum"
  );

  if (!(minimum < maximum)) {
    throw new InvalidScientificInputError(
      "wavelengthRangeNanometers.minimum must be less than maximum."
    );
  }

  if (
    minimum < usable.minimum ||
    maximum > usable.maximum
  ) {
    throw new InvalidScientificInputError(
      "Requested wavelength range must remain inside the usable spectral-response range; clipping, extrapolation, and implicit zero-fill are not permitted."
    );
  }

  return { minimum, maximum };
}

function additionalBreakpoints(
  value: readonly number[] | undefined,
  range:
    SensorSpectralWavelengthRangeNanometers
): readonly number[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new InvalidConfigurationError(
      "additionalBreakpointsNanometers must be an array when supplied."
    );
  }
  if (
    value.length >=
    MAX_SPECTRAL_QUADRATURE_NODES
  ) {
    throw new InvalidScientificInputError(
      "additionalBreakpointsNanometers contains too many entries for the spectral quadrature safety limit."
    );
  }

  let previous =
    Number.NEGATIVE_INFINITY;

  return value.map(
    (entry, index) => {
      const wavelength =
        requirePositiveFinite(
          entry,
          "additionalBreakpointsNanometers[" +
            index +
            "]"
        );
      if (
        wavelength <= range.minimum ||
        wavelength >= range.maximum
      ) {
        throw new InvalidScientificInputError(
          "Additional spectral breakpoints must lie strictly inside the requested wavelength range."
        );
      }
      if (wavelength <= previous) {
        throw new InvalidScientificInputError(
          "additionalBreakpointsNanometers must be strictly increasing with no duplicates."
        );
      }
      previous = wavelength;
      return wavelength;
    }
  );
}

function partitionBoundaries(
  curves: readonly ResponseCurveSupport[],
  range:
    SensorSpectralWavelengthRangeNanometers,
  additional:
    readonly number[]
): readonly number[] {
  const boundaries = new Set<number>([
    range.minimum,
    range.maximum,
    ...additional
  ]);

  for (const curve of curves) {
    for (const sample of curve.samples) {
      if (
        sample.wavelengthNanometers >
          range.minimum &&
        sample.wavelengthNanometers <
          range.maximum
      ) {
        boundaries.add(
          sample.wavelengthNanometers
        );
      }
    }
  }

  return [...boundaries].sort(
    (a, b) => a - b
  );
}

function planSegments(
  boundaries: readonly number[],
  maximumSubintervalWidthNanometers: number
): {
  segments: readonly SegmentPlan[];
  totalNodeCount: number;
} {
  const segments: SegmentPlan[] = [];
  let totalNodeCount = 0;

  for (
    let segmentIndex = 0;
    segmentIndex < boundaries.length - 1;
    segmentIndex += 1
  ) {
    const minimum =
      boundaries[segmentIndex]!;
    const maximum =
      boundaries[segmentIndex + 1]!;
    const width =
      maximum - minimum;

    if (
      !Number.isFinite(width) ||
      width <= 0
    ) {
      throw new InvalidScientificInputError(
        "Spectral quadrature segment widths must be finite and greater than zero."
      );
    }

    const subdivisionCount =
      Math.ceil(
        width /
          maximumSubintervalWidthNanometers
      );

    if (
      !Number.isSafeInteger(
        subdivisionCount
      ) ||
      subdivisionCount <= 0
    ) {
      throw new InvalidScientificInputError(
        "Spectral quadrature segment subdivision count must be a positive safe integer."
      );
    }

    totalNodeCount +=
      subdivisionCount;

    if (
      !Number.isSafeInteger(
        totalNodeCount
      )
    ) {
      throw new InvalidScientificInputError(
        "Spectral quadrature node count must remain a safe integer."
      );
    }
    if (
      totalNodeCount >
      MAX_SPECTRAL_QUADRATURE_NODES
    ) {
      throw new InvalidScientificInputError(
        "Spectral quadrature node count exceeds the safety limit of " +
          MAX_SPECTRAL_QUADRATURE_NODES +
          "."
      );
    }

    segments.push({
      minimum,
      maximum,
      subdivisionCount,
      subintervalWidthNanometers:
        width / subdivisionCount
    });
  }

  if (segments.length === 0) {
    throw new InvalidScientificInputError(
      "Spectral quadrature requires at least one non-empty segment."
    );
  }

  return {
    segments,
    totalNodeCount
  };
}

const SPECTRAL_VALIDATION_TOLERANCE = 1e-10;

function approximatelyEqual(
  actual: number,
  expected: number,
  tolerance = SPECTRAL_VALIDATION_TOLERANCE
): boolean {
  const scale = Math.max(
    1,
    Math.abs(actual),
    Math.abs(expected)
  );
  return (
    Math.abs(actual - expected) <=
    tolerance * scale
  );
}

/**
 * Rechecks a supplied wavelength plan (node identities, coverage and widths in nanometres) before it
 * is used.
 *
 * Lining nodes up with breakpoints does not prove convergence. Discrete (delta-like) lines need their
 * own integration and are never silently widened into continuous bins.
 * @param quadrature - The input; see `SensorSpectralQuadrature` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function validateSensorSpectralQuadrature(
  quadrature: SensorSpectralQuadrature
): Map<number, SensorSpectralQuadratureNode> {
  if (
    typeof quadrature !== "object" ||
    quadrature === null ||
    !Array.isArray(quadrature.nodes)
  ) {
    throw new InvalidConfigurationError(
      "spectralQuadrature must contain a nodes array."
    );
  }

  for (const [field, value] of [
    ["profileId", quadrature.profileId],
    [
      "colorSamplingProfileId",
      quadrature.colorSamplingProfileId
    ],
    ["channelId", quadrature.channelId]
  ] as const) {
    if (
      typeof value !== "string" ||
      value.trim().length === 0
    ) {
      throw new InvalidConfigurationError(
        "spectralQuadrature." +
          field +
          " must be a non-empty string."
      );
    }
  }

  if (
    quadrature.wavelengthBasis !== "air" &&
    quadrature.wavelengthBasis !== "vacuum" &&
    quadrature.wavelengthBasis !== "unspecified"
  ) {
    throw new InvalidConfigurationError(
      "spectralQuadrature.wavelengthBasis is invalid."
    );
  }

  const rangeMinimum = requirePositiveFinite(
    quadrature.wavelengthRangeNanometers.minimum,
    "spectralQuadrature.wavelengthRangeNanometers.minimum"
  );
  const rangeMaximum = requirePositiveFinite(
    quadrature.wavelengthRangeNanometers.maximum,
    "spectralQuadrature.wavelengthRangeNanometers.maximum"
  );
  if (!(rangeMinimum < rangeMaximum)) {
    throw new InvalidScientificInputError(
      "spectralQuadrature wavelength range minimum must be less than maximum."
    );
  }

  const maximumSubintervalWidthNanometers =
    requirePositiveFinite(
      quadrature.maximumSubintervalWidthNanometers,
      "spectralQuadrature.maximumSubintervalWidthNanometers"
    );

  if (
    !Array.isArray(
      quadrature.segmentBoundariesNanometers
    ) ||
    quadrature.segmentBoundariesNanometers.length <
      2
  ) {
    throw new InvalidScientificInputError(
      "spectralQuadrature.segmentBoundariesNanometers must contain at least two boundaries."
    );
  }

  let previousBoundary =
    Number.NEGATIVE_INFINITY;
  quadrature.segmentBoundariesNanometers.forEach(
    (boundary, index) => {
      const parsed = requirePositiveFinite(
        boundary,
        "spectralQuadrature.segmentBoundariesNanometers[" +
          index +
          "]"
      );
      if (parsed <= previousBoundary) {
        throw new InvalidScientificInputError(
          "spectralQuadrature.segmentBoundariesNanometers must be strictly increasing."
        );
      }
      previousBoundary = parsed;
    }
  );

  const segmentCount =
    requireNonNegativeSafeInteger(
      quadrature.segmentCount,
      "spectralQuadrature.segmentCount"
    );
  if (
    segmentCount <= 0 ||
    segmentCount !==
      quadrature.segmentBoundariesNanometers.length -
        1
  ) {
    throw new InvalidScientificInputError(
      "spectralQuadrature.segmentCount must be positive and match the boundary count."
    );
  }

  if (
    !approximatelyEqual(
      quadrature.segmentBoundariesNanometers[0]!,
      rangeMinimum
    ) ||
    !approximatelyEqual(
      quadrature.segmentBoundariesNanometers[
        quadrature.segmentBoundariesNanometers.length -
          1
      ]!,
      rangeMaximum
    )
  ) {
    throw new InvalidScientificInputError(
      "spectralQuadrature segment boundaries must exactly span the requested wavelength range."
    );
  }

  const totalNodeCount =
    requireNonNegativeSafeInteger(
      quadrature.totalNodeCount,
      "spectralQuadrature.totalNodeCount"
    );
  if (
    totalNodeCount <= 0 ||
    totalNodeCount !== quadrature.nodes.length
  ) {
    throw new InvalidScientificInputError(
      "spectralQuadrature.totalNodeCount must be positive and exactly match spectralQuadrature.nodes.length."
    );
  }
  if (
    totalNodeCount >
    MAX_SPECTRAL_QUADRATURE_NODES
  ) {
    throw new InvalidScientificInputError(
      "spectralQuadrature.totalNodeCount exceeds the spectral quadrature safety limit."
    );
  }

  if (
    quadrature.responseApplicationPerformed !==
      false ||
    quadrature.responseValuesIncluded !== false ||
    quadrature.wavelengthIntegrationPerformed !==
      false ||
    quadrature.continuousSpectralDensityQuadratureOnly !==
      true ||
    quadrature.discreteLineSpectrumIncluded !==
      false
  ) {
    throw new InvalidScientificInputError(
      "spectralQuadrature semantics are incompatible with pre-response continuous-density composition."
    );
  }

  const span =
    rangeMaximum - rangeMinimum;
  const nodesByIndex =
    new Map<number, SensorSpectralQuadratureNode>();
  const seenSegmentSubdivisions =
    new Set<string>();
  const segmentSubdivisionCounts =
    new Map<number, number>();
  const segmentSeenCounts =
    new Map<number, number>();
  let measureSum = 0;
  let normalizedWeightSum = 0;

  quadrature.nodes.forEach(
    (node, nodeArrayIndex) => {
      const spectralSampleIndex =
        requireNonNegativeSafeInteger(
          node.spectralSampleIndex,
          "spectralQuadrature.nodes[" +
            nodeArrayIndex +
            "].spectralSampleIndex"
        );
      if (
        nodesByIndex.has(
          spectralSampleIndex
        )
      ) {
        throw new InvalidScientificInputError(
          "spectralQuadrature contains duplicate spectralSampleIndex values."
        );
      }

      const segmentIndex =
        requireNonNegativeSafeInteger(
          node.segmentIndex,
          "spectralQuadrature.nodes[" +
            nodeArrayIndex +
            "].segmentIndex"
        );
      if (segmentIndex >= segmentCount) {
        throw new InvalidScientificInputError(
          "spectralQuadrature node segmentIndex is outside the declared segment range."
        );
      }

      const subdivisionIndex =
        requireNonNegativeSafeInteger(
          node.subdivisionIndex,
          "spectralQuadrature.nodes[" +
            nodeArrayIndex +
            "].subdivisionIndex"
        );
      const segmentSubdivisionCount =
        requireNonNegativeSafeInteger(
          node.segmentSubdivisionCount,
          "spectralQuadrature.nodes[" +
            nodeArrayIndex +
            "].segmentSubdivisionCount"
        );
      if (
        segmentSubdivisionCount <= 0 ||
        subdivisionIndex >=
          segmentSubdivisionCount
      ) {
        throw new InvalidScientificInputError(
          "spectralQuadrature node subdivision identity is invalid."
        );
      }

      const priorSegmentCount =
        segmentSubdivisionCounts.get(
          segmentIndex
        );
      if (
        priorSegmentCount !== undefined &&
        priorSegmentCount !==
          segmentSubdivisionCount
      ) {
        throw new InvalidScientificInputError(
          "spectralQuadrature nodes disagree on a segment subdivision count."
        );
      }
      segmentSubdivisionCounts.set(
        segmentIndex,
        segmentSubdivisionCount
      );

      const subdivisionKey =
        segmentIndex +
        ":" +
        subdivisionIndex;
      if (
        seenSegmentSubdivisions.has(
          subdivisionKey
        )
      ) {
        throw new InvalidScientificInputError(
          "spectralQuadrature contains duplicate segment/subdivision identities."
        );
      }
      seenSegmentSubdivisions.add(
        subdivisionKey
      );
      segmentSeenCounts.set(
        segmentIndex,
        (segmentSeenCounts.get(
          segmentIndex
        ) ?? 0) + 1
      );

      const wavelengthNanometers =
        requirePositiveFinite(
          node.wavelengthNanometers,
          "spectralQuadrature.nodes[" +
            nodeArrayIndex +
            "].wavelengthNanometers"
        );
      const wavelengthMeasureNanometers =
        requirePositiveFinite(
          node.wavelengthMeasureNanometers,
          "spectralQuadrature.nodes[" +
            nodeArrayIndex +
            "].wavelengthMeasureNanometers"
        );
      const normalizedWavelengthWeight =
        requirePositiveFinite(
          node.normalizedWavelengthWeight,
          "spectralQuadrature.nodes[" +
            nodeArrayIndex +
            "].normalizedWavelengthWeight"
        );

      const segmentMinimum =
        quadrature.segmentBoundariesNanometers[
          segmentIndex
        ]!;
      const segmentMaximum =
        quadrature.segmentBoundariesNanometers[
          segmentIndex + 1
        ]!;
      const expectedMeasure =
        (segmentMaximum -
          segmentMinimum) /
        segmentSubdivisionCount;
      const expectedWavelength =
        segmentMinimum +
        (subdivisionIndex + 0.5) *
          expectedMeasure;
      const expectedNormalizedWeight =
        expectedMeasure / span;

      if (
        !approximatelyEqual(
          wavelengthMeasureNanometers,
          expectedMeasure
        ) ||
        !approximatelyEqual(
          wavelengthNanometers,
          expectedWavelength
        ) ||
        !approximatelyEqual(
          normalizedWavelengthWeight,
          expectedNormalizedWeight
        )
      ) {
        throw new InvalidScientificInputError(
          "spectralQuadrature node geometry/measure does not match its declared segment/subdivision identity."
        );
      }

      if (
        wavelengthMeasureNanometers >
          maximumSubintervalWidthNanometers &&
        !approximatelyEqual(
          wavelengthMeasureNanometers,
          maximumSubintervalWidthNanometers
        )
      ) {
        throw new InvalidScientificInputError(
          "spectralQuadrature node width exceeds maximumSubintervalWidthNanometers."
        );
      }

      measureSum +=
        wavelengthMeasureNanometers;
      normalizedWeightSum +=
        normalizedWavelengthWeight;
      if (
        !Number.isFinite(measureSum) ||
        !Number.isFinite(
          normalizedWeightSum
        )
      ) {
        throw new InvalidScientificInputError(
          "spectralQuadrature aggregate measures must remain finite."
        );
      }

      nodesByIndex.set(
        spectralSampleIndex,
        node
      );
    }
  );

  for (
    let spectralSampleIndex = 0;
    spectralSampleIndex < totalNodeCount;
    spectralSampleIndex += 1
  ) {
    if (
      !nodesByIndex.has(
        spectralSampleIndex
      )
    ) {
      throw new InvalidScientificInputError(
        "spectralQuadrature spectralSampleIndex values must form the exact contiguous range 0..totalNodeCount-1."
      );
    }
  }

  for (
    let segmentIndex = 0;
    segmentIndex < segmentCount;
    segmentIndex += 1
  ) {
    const expected =
      segmentSubdivisionCounts.get(
        segmentIndex
      );
    const seen =
      segmentSeenCounts.get(
        segmentIndex
      ) ?? 0;
    if (
      expected === undefined ||
      seen !== expected
    ) {
      throw new InvalidScientificInputError(
        "spectralQuadrature must contain every declared subdivision exactly once."
      );
    }
  }

  if (
    !approximatelyEqual(
      measureSum,
      span
    ) ||
    !approximatelyEqual(
      normalizedWeightSum,
      1
    ) ||
    !approximatelyEqual(
      quadrature.wavelengthMeasureSumNanometers,
      measureSum
    ) ||
    !approximatelyEqual(
      quadrature.normalizedWavelengthWeightSum,
      normalizedWeightSum
    )
  ) {
    throw new InvalidScientificInputError(
      "spectralQuadrature aggregate wavelength measures/weights are inconsistent."
    );
  }

  return nodesByIndex;
}

/**
 * Builds deterministic wavelength sample points for one exact sensor response
 * channel. It does not apply the response to any spectrum.
 *
 * The requested range must lie fully inside the channel's declared usable
 * range. The response curve's breakpoints, plus any caller-supplied breakpoints
 * from the source spectrum or optics, split that range into segments. Each
 * segment is then subdivided so no midpoint subinterval is wider than
 * maximumSubintervalWidthNanometers.
 *
 * wavelengthMeasureNanometers is dλ in nanometres, not a dimensionless response
 * weight. Multiply it only by a spectral density per nanometre, or convert
 * units explicitly first.
 *
 * QE and A/W responsivity are deliberately not applied. They lead to different
 * signals: QE is photon-to-electron efficiency, while A/W responsivity relates
 * incident radiant power to electrical current. A later step must also match
 * responseScope to the source plane and collection area before integrating any
 * signal.
 */
export function calculateSensorSpectralQuadrature(
  input:
    CalculateSensorSpectralQuadratureInput
): CalculationResult<SensorSpectralQuadrature> {
  requireInputKeys(input, "calculateSensorSpectralQuadrature", ["colorSamplingProfile", "spectralResponseProfile", "channelId", "wavelengthBasis", "wavelengthRangeNanometers", "maximumSubintervalWidthNanometers", "additionalBreakpointsNanometers"]);
  const maximumSubintervalWidthNanometers =
    requirePositiveFinite(
      input.maximumSubintervalWidthNanometers,
      "maximumSubintervalWidthNanometers"
    );

  if (
    input.wavelengthBasis !== "air" &&
    input.wavelengthBasis !== "vacuum" &&
    input.wavelengthBasis !== "unspecified"
  ) {
    throw new InvalidConfigurationError(
      "wavelengthBasis is invalid."
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
  const response = channelResponse(
    responseProfile,
    input.channelId
  );
  const curves =
    responseCurves(response);

  if (
    !curves.every(
      (curve) =>
        curve.wavelengthBasis ===
        input.wavelengthBasis
    )
  ) {
    throw new InvalidScientificInputError(
      "wavelengthBasis must exactly match every response curve used by the requested channel."
    );
  }

  const usable = usableResponseRange(
    curves
  );
  const range = parseRequestedRange(
    input.wavelengthRangeNanometers,
    usable
  );
  const validationWavelength =
    range.minimum +
    (range.maximum - range.minimum) /
      2;
  const representative =
    resolveSensorSpectralResponseAtWavelength(
      {
        colorSamplingProfile:
          colorProfile,
        spectralResponseProfile:
          responseProfile,
        channelId: input.channelId,
        wavelengthNanometers:
          validationWavelength,
        wavelengthBasis:
          input.wavelengthBasis
      }
    ).value;

  const additional =
    additionalBreakpoints(
      input.additionalBreakpointsNanometers,
      range
    );
  const boundaries =
    partitionBoundaries(
      curves,
      range,
      additional
    );
  const {
    segments,
    totalNodeCount
  } = planSegments(
    boundaries,
    maximumSubintervalWidthNanometers
  );

  const totalSpan =
    range.maximum - range.minimum;
  const nodes:
    SensorSpectralQuadratureNode[] = [];
  let spectralSampleIndex = 0;

  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    const segment =
      segments[segmentIndex]!;

    for (
      let subdivisionIndex = 0;
      subdivisionIndex <
      segment.subdivisionCount;
      subdivisionIndex += 1
    ) {
      const wavelengthNanometers =
        segment.minimum +
        (subdivisionIndex + 0.5) *
          segment
            .subintervalWidthNanometers;

      nodes.push({
        spectralSampleIndex,
        segmentIndex,
        subdivisionIndex,
        segmentSubdivisionCount:
          segment.subdivisionCount,
        wavelengthNanometers,
        wavelengthMeasureNanometers:
          segment
            .subintervalWidthNanometers,
        normalizedWavelengthWeight:
          segment
            .subintervalWidthNanometers /
          totalSpan
      });

      spectralSampleIndex += 1;
    }
  }

  const normalizedWavelengthWeightSum =
    nodes.reduce(
      (sum, node) =>
        sum +
        node.normalizedWavelengthWeight,
      0
    );
  const wavelengthMeasureSumNanometers =
    nodes.reduce(
      (sum, node) =>
        sum +
        node.wavelengthMeasureNanometers,
      0
    );

  return approximationResult(
    {
      profileId:
        representative.profileId,
      colorSamplingProfileId:
        representative
          .colorSamplingProfileId,
      channelId:
        representative.channelId,
      sourceResponseKind:
        representative
          .sourceResponseKind,
      responseScope:
        representative.responseScope,
      responseScientificStatus:
        representative
          .scientificStatus,
      responseUncertainty:
        representative.uncertainty,
      responseChannelBinding:
        createSensorSpectralResponseChannelBinding(
          response
        ),
      ...(representative.referenceConditions ===
      undefined
        ? {}
        : {
            responseReferenceConditions:
              representative.referenceConditions
          }),
      wavelengthBasis:
        input.wavelengthBasis,
      wavelengthBasisResolved:
        representative
          .wavelengthBasisResolved,
      wavelengthRangeNanometers:
        range,
      responseDeclaredWavelengthRangeNanometers:
        usable,
      quadratureScheme:
        "response-breakpoint-aware-bounded-midpoint",
      segmentBoundarySource:
        "requested-range-plus-response-knots-plus-optional-additional-breakpoints",
      segmentBoundariesNanometers:
        [...boundaries],
      maximumSubintervalWidthNanometers,
      segmentCount:
        segments.length,
      totalNodeCount,
      normalizedWavelengthWeightSum,
      wavelengthMeasureSumNanometers,
      nodes,
      responseKnotAlignmentIncluded:
        true,
      componentEvidence: {
        colorSamplingProfile:
          colorProfile.evidence,
        profile:
          representative
            .componentEvidence.profile,
        channel:
          representative
            .componentEvidence.channel,
        curves:
          representative
            .componentEvidence.curves
      },
      responseValuesIncluded: false,
      responseApplicationPerformed:
        false,
      sourceSpectralValuesIncluded:
        false,
      spectralIrradianceIncluded:
        false,
      spectralPhotonIrradianceIncluded:
        false,
      commonSpectralCoverageValidated:
        false,
      continuousSpectralDensityQuadratureOnly:
        true,
      discreteLineSpectrumIncluded:
        false,
      opticalTransmissionIncludedByQuadrature:
        false,
      wavelengthIntegrationPerformed:
        false,
      spatialIntegrationPerformed:
        false,
      temporalIntegrationPerformed:
        false,
      photonsCalculated: false,
      electronsCalculated: false,
      rawCodeValueProduced: false,
      convergenceErrorEstimated: false
    },
    "sensor-spectral-quadrature",
    "1.0.0",
    [
      "The partition includes requested range edges, response-curve knots, and optional caller-supplied continuous-spectrum/optics breakpoints.",
      "Every segment uses deterministic equal-width midpoint subintervals whose width is bounded by maximumSubintervalWidthNanometers.",
      "Wavelength measures are d-lambda in nanometres and normalized wavelength weights are geometric wavelength measures only; neither is sensor-response weighting.",
      "The requested range is validated against sensor-response support only. Scene-spectrum, optical-transmission, and other spectral-factor coverage are not established by this API.",
      "The response profile, exact channel linkage, wavelength basis, response scope, and response-data provenance are validated and preserved, but response values are not applied at quadrature nodes.",
      "QE and A/W responsivity remain different physical representations and require different compatible downstream photon/power semantics.",
      "Future signal composition must match responseScope to the source plane and collection-area model so upstream transmission is not omitted or double-counted.",
      "This midpoint plan targets continuous spectral-density integration. Discrete/delta-like line spectra require a separate explicit representation rather than being approximated by hidden point masses.",
      "No source spectral values, spectral irradiance, spectral photon irradiance, optical transmission, spatial integration, temporal integration, photon/electron conversion, current calculation, or RAW output is calculated.",
      "Response-knot alignment and a bounded wavelength step do not prove convergence for arbitrary source spectra or other wavelength-dependent factors.",
      "No source-independent convergence/error estimate is reported because integration error depends on the downstream integrand."
    ]
  );
}
