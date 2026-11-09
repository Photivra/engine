// SPDX-License-Identifier: Apache-2.0

/**
 * Combines the wavelength coverage of several spectral inputs (light source, filters, sensor
 * response) before they are multiplied and integrated.
 *
 * Continuous spectra (values per nanometre) and discrete lines (narrow emission lines treated as
 * delta functions) are handled separately, because they integrate differently. This module
 * describes wavelength ranges and interpolation breakpoints only, not spectral values.
 * @see docs/SCENE_RADIANCE_AND_ILLUMINATION.md for equations, coordinate/unit conventions, blockers
 * and support limits.
 */

import { InvalidConfigurationError } from "./configuration-error.js";
import {
  parseSpectralWavelengthBasis,
  parseSpectralWavelengthRangeNanometers,
  type SpectralWavelengthBasis,
  type SpectralWavelengthRangeNanometers
} from "./spectral.js";
import { requireInputKeys, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigPositiveFinite as requirePositiveFinite, requireConfigNonNegativeFinite as requireNonNegativeFinite } from "./record-validation.js";


export type ResolvedSpectralWavelengthBasis =
  Exclude<SpectralWavelengthBasis, "unspecified">;

export type SpectralCoverageParticipantRole =
  | "illumination-source"
  | "scene-radiance"
  | "material-response"
  | "optical-transmission"
  | "sensor-response"
  | "other";

export interface SpectralCoverageParticipant {
  participantId: string;
  role: SpectralCoverageParticipantRole;
  wavelengthBasis:
    ResolvedSpectralWavelengthBasis;
  wavelengthRangeNanometers:
    SpectralWavelengthRangeNanometers;
  /**
   * Internal piecewise-continuous breakpoints. Range endpoints are carried
   * separately and must not be duplicated here.
   */
  breakpointsNanometers:
    readonly number[];
}

export interface ComposeSpectralCoverageInput {
  participants:
    readonly SpectralCoverageParticipant[];
}

export interface SpectralCoverageComposition {
  wavelengthBasis:
    ResolvedSpectralWavelengthBasis;
  commonWavelengthRangeNanometers:
    SpectralWavelengthRangeNanometers;
  /**
   * Common-range endpoints plus every participant breakpoint that falls
   * strictly inside the common overlap.
   */
  segmentBoundariesNanometers:
    readonly number[];
  participantIds: readonly string[];
  participantRoles:
    readonly SpectralCoverageParticipantRole[];
  continuousCoverageIntersectionEstablished:
    true;
  breakpointUnionEstablished: true;
  responseValuesApplied: false;
  spectralDensityIntegrated: false;
  discreteLinesIncluded: false;
  airVacuumConversionPerformed: false;
}

export interface NormalizedDiscreteSpectralLine {
  lineId: string;
  wavelengthNanometers: number;
  normalizedIntegratedWeight: number;
}

export interface NormalizedDiscreteSpectralLineDistribution {
  wavelengthBasis:
    ResolvedSpectralWavelengthBasis;
  lineModel: "delta-like-integrated";
  normalization:
    "sum-normalized-integrated-weight-to-one";
  lines:
    readonly NormalizedDiscreteSpectralLine[];
}

export type DiscreteSpectralLineQuantityUnit =
  | "relative"
  | "W/sr"
  | "W/m^2"
  | "W/m^2/sr";

export interface DiscreteSpectralLineMeasureEntry {
  lineId: string;
  wavelengthNanometers: number;
  integratedQuantity: number;
}

export interface DiscreteSpectralLineMeasure {
  wavelengthBasis:
    ResolvedSpectralWavelengthBasis;
  quantityUnit:
    DiscreteSpectralLineQuantityUnit;
  lineModel: "delta-like-integrated";
  lines:
    readonly DiscreteSpectralLineMeasureEntry[];
  continuousSpectralDensityAssumed: false;
  wavelengthMeasureMultiplicationRequired:
    false;
}

export interface IntegratedDiscreteSpectralLineMeasure {
  wavelengthBasis:
    ResolvedSpectralWavelengthBasis;
  quantityUnit:
    DiscreteSpectralLineQuantityUnit;
  integratedQuantity: number;
  lineCount: number;
  continuousQuadratureApplied: false;
  wavelengthMeasureMultiplicationApplied:
    false;
}

function parseResolvedBasis(
  value: unknown,
  path: string
): ResolvedSpectralWavelengthBasis {
  const basis =
    parseSpectralWavelengthBasis(
      value,
      path
    );
  if (basis === "unspecified") {
    throw new InvalidConfigurationError(
      path +
        " must be air or vacuum for spectral composition."
    );
  }
  return basis;
}

function parseRole(
  value: unknown,
  path: string
): SpectralCoverageParticipantRole {
  if (
    value !== "illumination-source" &&
    value !== "scene-radiance" &&
    value !== "material-response" &&
    value !== "optical-transmission" &&
    value !== "sensor-response" &&
    value !== "other"
  ) {
    throw new InvalidConfigurationError(
      path + " is invalid."
    );
  }
  return value;
}

function parseBreakpoints(
  value: unknown,
  range:
    SpectralWavelengthRangeNanometers,
  path: string
): readonly number[] {
  if (!Array.isArray(value)) {
    throw new InvalidConfigurationError(
      path + " must be an array."
    );
  }

  let previous =
    Number.NEGATIVE_INFINITY;
  return value.map((entry, index) => {
    const breakpoint =
      requirePositiveFinite(
        entry,
        path + "[" + index + "]"
      );
    if (
      breakpoint <= range.minimum ||
      breakpoint >= range.maximum
    ) {
      throw new InvalidConfigurationError(
        path +
          " values must lie strictly inside the participant wavelength range."
      );
    }
    if (breakpoint <= previous) {
      throw new InvalidConfigurationError(
        path +
          " must be strictly increasing with no duplicates."
      );
    }
    previous = breakpoint;
    return breakpoint;
  });
}

/**
 * Parses the wavelength coverage of one continuous spectral input.
 *
 * It describes only the wavelength range (support) and interpolation breakpoints. It
 * carries no spectral values, transmission, response, radiance or uncertainty.
 */
export function parseSpectralCoverageParticipant(
  value: unknown,
  path = "spectralCoverageParticipant"
): SpectralCoverageParticipant {
  const record = requireRecord(
    value,
    path, ["wavelengthRangeNanometers", "participantId", "role", "wavelengthBasis", "breakpointsNanometers"]
  );
  const range =
    parseSpectralWavelengthRangeNanometers(
      record.wavelengthRangeNanometers,
      path +
        ".wavelengthRangeNanometers"
    );
  return {
    participantId:
      requireNonEmptyString(
        record.participantId,
        path + ".participantId"
      ),
    role: parseRole(
      record.role,
      path + ".role"
    ),
    wavelengthBasis:
      parseResolvedBasis(
        record.wavelengthBasis,
        path + ".wavelengthBasis"
      ),
    wavelengthRangeNanometers:
      range,
    breakpointsNanometers:
      parseBreakpoints(
        record.breakpointsNanometers,
        range,
        path +
          ".breakpointsNanometers"
      )
  };
}

/**
 * Finds the wavelength range that all continuous inputs share, and collects every
 * interpolation breakpoint inside it.
 *
 * Air and vacuum wavelengths are never converted implicitly. Discrete lines are not
 * accepted here: a delta-like line is integrated differently from a continuous
 * per-nanometre density.
 */
export function composeSpectralCoverage(
  input: ComposeSpectralCoverageInput
): SpectralCoverageComposition {
  requireInputKeys(input, "composeSpectralCoverage", ["participants"]);
  if (
    !Array.isArray(input.participants) ||
    input.participants.length === 0
  ) {
    throw new InvalidConfigurationError(
      "participants must be a non-empty array."
    );
  }

  const participants =
    input.participants.map(
      (entry, index) =>
        parseSpectralCoverageParticipant(
          entry,
          "participants[" +
            index +
            "]"
        )
    );
  const participantIds =
    participants.map(
      (entry) => entry.participantId
    );
  if (
    new Set(participantIds).size !==
    participantIds.length
  ) {
    throw new InvalidConfigurationError(
      "participants[].participantId must not contain duplicates."
    );
  }

  const wavelengthBasis =
    participants[0]!
      .wavelengthBasis;
  if (
    participants.some(
      (entry) =>
        entry.wavelengthBasis !==
        wavelengthBasis
    )
  ) {
    throw new InvalidConfigurationError(
      "All spectral-coverage participants must use the same resolved wavelengthBasis; air/vacuum conversion is not implicit."
    );
  }

  const minimum = Math.max(
    ...participants.map(
      (entry) =>
        entry
          .wavelengthRangeNanometers
          .minimum
    )
  );
  const maximum = Math.min(
    ...participants.map(
      (entry) =>
        entry
          .wavelengthRangeNanometers
          .maximum
    )
  );
  if (!(minimum < maximum)) {
    throw new InvalidConfigurationError(
      "Spectral-coverage participants do not share a non-empty wavelength interval."
    );
  }

  const boundaries =
    new Set<number>([
      minimum,
      maximum
    ]);
  for (const participant of participants) {
    for (
      const breakpoint of
      participant.breakpointsNanometers
    ) {
      if (
        breakpoint > minimum &&
        breakpoint < maximum
      ) {
        boundaries.add(breakpoint);
      }
    }
  }

  return {
    wavelengthBasis,
    commonWavelengthRangeNanometers: {
      minimum,
      maximum
    },
    segmentBoundariesNanometers:
      [...boundaries].sort(
        (a, b) => a - b
      ),
    participantIds,
    participantRoles:
      participants.map(
        (entry) => entry.role
      ),
    continuousCoverageIntersectionEstablished:
      true,
    breakpointUnionEstablished: true,
    responseValuesApplied: false,
    spectralDensityIntegrated: false,
    discreteLinesIncluded: false,
    airVacuumConversionPerformed: false
  };
}

const LINE_WEIGHT_TOLERANCE = 1e-9;

/**
 * Parses a normalized set of discrete spectral lines (each treated as a delta function).
 *
 * Each weight is the fraction of the total carried by that line. It is not a
 * per-nanometre density sample. The weights must sum to one.
 */
export function parseNormalizedDiscreteSpectralLineDistribution(
  value: unknown,
  path =
    "discreteSpectralLineDistribution"
): NormalizedDiscreteSpectralLineDistribution {
  const record = requireRecord(
    value,
    path, ["lineModel", "normalization", "lines", "wavelengthBasis"]
  );
  if (
    record.lineModel !==
    "delta-like-integrated"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.lineModel must be "delta-like-integrated".'
    );
  }
  if (
    record.normalization !==
    "sum-normalized-integrated-weight-to-one"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.normalization must be "sum-normalized-integrated-weight-to-one".'
    );
  }
  if (
    !Array.isArray(record.lines) ||
    record.lines.length === 0
  ) {
    throw new InvalidConfigurationError(
      path +
        ".lines must be a non-empty array."
    );
  }

  const wavelengthBasis =
    parseResolvedBasis(
      record.wavelengthBasis,
      path + ".wavelengthBasis"
    );
  let previousWavelength =
    Number.NEGATIVE_INFINITY;
  const lineIds: string[] = [];
  let weightSum = 0;

  const lines = record.lines.map(
    (entry, index) => {
      const linePath =
        path + ".lines[" +
        index +
        "]";
      const line = requireRecord(
        entry,
        linePath, ["lineId", "wavelengthNanometers", "normalizedIntegratedWeight"]
      );
      const lineId =
        requireNonEmptyString(
          line.lineId,
          linePath + ".lineId"
        );
      const wavelengthNanometers =
        requirePositiveFinite(
          line.wavelengthNanometers,
          linePath +
            ".wavelengthNanometers"
        );
      if (
        wavelengthNanometers <=
        previousWavelength
      ) {
        throw new InvalidConfigurationError(
          path +
            ".lines wavelengths must be strictly increasing with no duplicates."
        );
      }
      previousWavelength =
        wavelengthNanometers;
      const normalizedIntegratedWeight =
        requirePositiveFinite(
          line.normalizedIntegratedWeight,
          linePath +
            ".normalizedIntegratedWeight"
        );
      lineIds.push(lineId);
      weightSum +=
        normalizedIntegratedWeight;
      return {
        lineId,
        wavelengthNanometers,
        normalizedIntegratedWeight
      };
    }
  );

  if (
    new Set(lineIds).size !==
    lineIds.length
  ) {
    throw new InvalidConfigurationError(
      path +
        ".lines[].lineId must not contain duplicates."
    );
  }
  if (
    !Number.isFinite(weightSum) ||
    Math.abs(weightSum - 1) >
      LINE_WEIGHT_TOLERANCE
  ) {
    throw new InvalidConfigurationError(
      path +
        ".lines normalizedIntegratedWeight values must sum to 1."
    );
  }

  return {
    wavelengthBasis,
    lineModel:
      "delta-like-integrated",
    normalization:
      "sum-normalized-integrated-weight-to-one",
    lines
  };
}

function parseQuantityUnit(
  value: unknown,
  path: string
): DiscreteSpectralLineQuantityUnit {
  if (
    value !== "relative" &&
    value !== "W/sr" &&
    value !== "W/m^2" &&
    value !== "W/m^2/sr"
  ) {
    throw new InvalidConfigurationError(
      path + " is invalid."
    );
  }
  return value;
}

export interface DistributeIntegratedQuantityAcrossDiscreteLinesInput {
  distribution:
    NormalizedDiscreteSpectralLineDistribution;
  totalIntegratedQuantity: number;
  quantityUnit:
    DiscreteSpectralLineQuantityUnit;
}

/**
 * Distributes one wavelength-integrated quantity across normalized discrete
 * line fractions without inventing a continuous line width.
 */
export function distributeIntegratedQuantityAcrossDiscreteSpectralLines(
  input:
    DistributeIntegratedQuantityAcrossDiscreteLinesInput
): DiscreteSpectralLineMeasure {
  requireInputKeys(input, "distributeIntegratedQuantityAcrossDiscreteSpectralLines", ["distribution", "totalIntegratedQuantity", "quantityUnit"]);
  const distribution =
    parseNormalizedDiscreteSpectralLineDistribution(
      input.distribution,
      "distribution"
    );
  const totalIntegratedQuantity =
    requireNonNegativeFinite(
      input.totalIntegratedQuantity,
      "totalIntegratedQuantity"
    );
  const quantityUnit =
    parseQuantityUnit(
      input.quantityUnit,
      "quantityUnit"
    );

  return {
    wavelengthBasis:
      distribution.wavelengthBasis,
    quantityUnit,
    lineModel:
      "delta-like-integrated",
    lines:
      distribution.lines.map(
        (line) => ({
          lineId: line.lineId,
          wavelengthNanometers:
            line.wavelengthNanometers,
          integratedQuantity:
            totalIntegratedQuantity *
            line
              .normalizedIntegratedWeight
        })
      ),
    continuousSpectralDensityAssumed:
      false,
    wavelengthMeasureMultiplicationRequired:
      false
  };
}

/**
 * Integrates over discrete lines by summing their contributions, which are already
 * integrated over wavelength. No dλ (wavelength step) factor is applied.
 */
export function integrateDiscreteSpectralLineMeasure(
  measure:
    DiscreteSpectralLineMeasure
): IntegratedDiscreteSpectralLineMeasure {
  const record = requireRecord(
    measure,
    "measure", ["wavelengthBasis", "quantityUnit", "lineModel", "continuousSpectralDensityAssumed", "wavelengthMeasureMultiplicationRequired", "lines"]
  );
  const wavelengthBasis =
    parseResolvedBasis(
      record.wavelengthBasis,
      "measure.wavelengthBasis"
    );
  const quantityUnit =
    parseQuantityUnit(
      record.quantityUnit,
      "measure.quantityUnit"
    );

  if (
    record.lineModel !==
    "delta-like-integrated"
  ) {
    throw new InvalidConfigurationError(
      'measure.lineModel must be "delta-like-integrated".'
    );
  }
  if (
    record.continuousSpectralDensityAssumed !==
      false ||
    record.wavelengthMeasureMultiplicationRequired !==
      false
  ) {
    throw new InvalidConfigurationError(
      "Discrete spectral line measures must not claim continuous-density or d-lambda integration semantics."
    );
  }
  if (
    !Array.isArray(record.lines) ||
    record.lines.length === 0
  ) {
    throw new InvalidConfigurationError(
      "measure.lines must be a non-empty array."
    );
  }

  let previousWavelength =
    Number.NEGATIVE_INFINITY;
  const lineIds: string[] = [];
  let integratedQuantity = 0;

  for (
    let index = 0;
    index < record.lines.length;
    index += 1
  ) {
    const linePath =
      "measure.lines[" + index + "]";
    const line = requireRecord(
      record.lines[index],
      linePath, ["lineId", "wavelengthNanometers", "integratedQuantity"]
    );
    const lineId =
      requireNonEmptyString(
        line.lineId,
        linePath + ".lineId"
      );
    const wavelengthNanometers =
      requirePositiveFinite(
        line.wavelengthNanometers,
        linePath +
          ".wavelengthNanometers"
      );
    if (
      wavelengthNanometers <=
      previousWavelength
    ) {
      throw new InvalidConfigurationError(
        "measure.lines wavelengths must be strictly increasing with no duplicates."
      );
    }
    previousWavelength =
      wavelengthNanometers;
    lineIds.push(lineId);

    integratedQuantity +=
      requireNonNegativeFinite(
        line.integratedQuantity,
        linePath +
          ".integratedQuantity"
      );
    if (
      !Number.isFinite(
        integratedQuantity
      )
    ) {
      throw new InvalidConfigurationError(
        "Discrete spectral line integrated quantity must remain finite."
      );
    }
  }

  if (
    new Set(lineIds).size !==
    lineIds.length
  ) {
    throw new InvalidConfigurationError(
      "measure.lines[].lineId must not contain duplicates."
    );
  }

  return {
    wavelengthBasis,
    quantityUnit,
    integratedQuantity,
    lineCount: record.lines.length,
    continuousQuadratureApplied: false,
    wavelengthMeasureMultiplicationApplied:
      false
  };
}
