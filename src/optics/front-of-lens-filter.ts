// SPDX-License-Identifier: Apache-2.0

/**
 * Generic filters that screw onto the front of the lens.
 *
 * Schema 0.1.0 is explicitly unbranded and unpolarized. It models only passive transmission in front
 * of the lens. It does not cover reflections between stacked filters, flare or ghosting, or filters
 * that change wavelength.
 *
 * Schema 0.2.0 adds one polarizing kind: a linear (partial) polarizer. It has a principal
 * transmittance k1, an extinction ratio k1/k2 and a transmission-axis angle. Polarization is carried
 * as linear Stokes parameters (S0, S1, S2). Filters are applied in order using the Mueller matrix of
 * a linear diattenuator (Gil, arXiv:2002.04105, eqs. 134-135, free; Malus's law: OpenStax University
 * Physics Vol. 3, sec. 1.7, free. Also see: Chipman, Handbook of Optics vol. I ch. 22, 3rd ed., 2010;
 * Goldstein, Polarized Light, 3rd ed., ch. 4-5; Born & Wolf, Principles of Optics, sec. 1.4.2):
 *   T = (k1 + k2)/2 + (k1 - k2)/2 * P * cos(2 (psi - theta))
 * Here P is the incident light's degree of linear polarization, psi its polarization angle and theta
 * the filter axis angle.
 * - For P = 1 this is Malus's law: k1 cos^2(psi - theta) + k2 sin^2(psi - theta).
 * - For unpolarized light it is (k1 + k2)/2, about half of k1.
 * Not modelled: circular polarization, retardance (for example the quarter-wave plate in a circular
 * polarizer), dependence on the angle of incidence, and depolarization.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceBackedFact,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import {
  parseSpectralWavelengthBasis,
  type SpectralWavelengthBasis
} from "../core/spectral.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputKeys, rejectUnknownVariantFields, UNCERTAINTY_VARIANT_FIELDS, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigFinite as requireFinite, parseConfigScientificStatus as parseScientificStatus, parseConfigLimitations as parseLimitations, requireConfigFiniteAboveZero as requirePositiveFinite, requireConfigFiniteAtLeastZero as requireNonNegativeFinite } from "../core/record-validation.js";

export const FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;
/** Schema that also allows the `linear-polarizer` transmission kind. */
export const FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION =
  "0.2.0" as const;

export type FrontOfLensFilterProfileSchemaVersion =
  | typeof FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION
  | typeof FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION;

/** Partially linearly polarized light: degree P in [0, 1] and polarization angle psi. */
export interface LinearPolarizationState {
  /** Degree of linear polarization P in [0, 1]; 0 is unpolarized. */
  degreeOfLinearPolarization: number;
  /** Electric-field polarization angle, degrees counter-clockwise from image +X. */
  angleDegrees: number;
}

export type FrontOfLensFilterScientificStatus =
  | "calibrated"
  | "approximation";

export type FrontOfLensFilterUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };

export interface FrontOfLensFilterSpectralSample {
  wavelengthNanometers: number;
  linearTransmissionFactor: number;
}

export type FrontOfLensFilterTransmissionModel =
  | {
      kind: "neutral-linear-transmission";
      linearTransmissionFactor:
        EvidenceBackedFact<number>;
    }
  | {
      kind: "neutral-optical-density";
      opticalDensityBase10:
        EvidenceBackedFact<number>;
    }
  | {
      kind: "spectral-transmission";
      samples:
        EvidenceBackedFact<
          readonly FrontOfLensFilterSpectralSample[]
        >;
    }
  | {
      /** Schema 0.2.0 only. Neutral (wavelength-independent) within the declared range. */
      kind: "linear-polarizer";
      /** k1: intensity transmittance for light polarized along the transmission axis, (0, 1]. */
      principalTransmittance:
        EvidenceBackedFact<number>;
      /** k1 / k2. Finite and >= 1. Use a large finite ratio for a near-ideal polarizer. */
      extinctionRatio:
        EvidenceBackedFact<number>;
      /** Transmission-axis angle as mounted, degrees counter-clockwise from image +X. */
      transmissionAxisDegrees: number;
    };

export interface FrontOfLensFilterProfile {
  schemaVersion:
    FrontOfLensFilterProfileSchemaVersion;
  filterId: string;
  profileVersion: string;
  identityScope:
    "photivra-generic-unbranded";
  position: "front-of-lens";
  scientificStatus:
    FrontOfLensFilterScientificStatus;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  wavelengthRangeNanometers: {
    minimum: number;
    maximum: number;
  };
  transmission:
    FrontOfLensFilterTransmissionModel;
  uncertainty:
    FrontOfLensFilterUncertainty;
  /** True exactly when the transmission kind is `linear-polarizer` (schema 0.2.0). */
  polarizationModeled: boolean;
  wavelengthChangingBehaviorModeled:
    false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface ResolveFrontOfLensFilterTransmissionInput {
  profile: FrontOfLensFilterProfile;
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  /** Incident polarization; omitted means unpolarized. */
  incidentPolarization?: LinearPolarizationState;
}

export interface ResolvedFrontOfLensFilterTransmission {
  schemaVersion:
    FrontOfLensFilterProfileSchemaVersion;
  filterId: string;
  profileVersion: string;
  identityScope:
    "photivra-generic-unbranded";
  position: "front-of-lens";
  scientificStatus:
    FrontOfLensFilterScientificStatus;
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  transmissionKind:
    FrontOfLensFilterTransmissionModel["kind"];
  /** Intensity transmittance for the declared incident polarization. */
  linearTransmissionFactor: number;
  attenuationStops: number;
  opticalDensityBase10: number;
  polarizationModeled: boolean;
  incidentPolarization: LinearPolarizationState;
  transmittedPolarization: LinearPolarizationState;
  wavelengthChangingBehaviorModeled:
    false;
  lensTransmissionIncluded: false;
  sensorOpticalStackIncluded: false;
  fieldThroughputIncluded: false;
  uncertainty:
    FrontOfLensFilterUncertainty;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface ComposeFrontOfLensFilterTransmissionInput {
  /** Filters in light-path order (scene side first). */
  filters:
    readonly FrontOfLensFilterProfile[];
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  /** Incident scene polarization; omitted means unpolarized. */
  incidentPolarization?: LinearPolarizationState;
}

export interface ComposedFrontOfLensFilterTransmission {
  schemaVersion:
    FrontOfLensFilterProfileSchemaVersion;
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<
      SpectralWavelengthBasis,
      "unspecified"
    >;
  appliedFilterCount: number;
  components:
    readonly ResolvedFrontOfLensFilterTransmission[];
  combinedLinearTransmissionFactor:
    number;
  combinedAttenuationStops: number;
  scientificStatus:
    FrontOfLensFilterScientificStatus;
  uncertaintyPropagation:
    "not-propagated";
  uncertaintyLimitation: string;
  compositionModel:
    | "independent-multiplicative-unpolarized-transmission-no-inter-filter-reflections"
    | "ordered-linear-stokes-mueller-no-inter-filter-reflections";
  polarizationModeled: boolean;
  incidentPolarization: LinearPolarizationState;
  transmittedPolarization: LinearPolarizationState;
  wavelengthChangingBehaviorModeled:
    false;
  lensTransmissionIncluded: false;
  sensorOpticalStackIncluded: false;
  fieldThroughputIncluded: false;
}

function requirePassiveTransmission(
  value: unknown,
  path: string
): number {
  const parsed = requirePositiveFinite(
    value,
    path
  );
  if (parsed > 1) {
    throw new InvalidConfigurationError(
      path +
        " must be less than or equal to one for a passive filter."
    );
  }
  return parsed;
}

export function parseRange(
  value: unknown,
  path: string
): {
  minimum: number;
  maximum: number;
} {
  const record = requireRecord(
    value,
    path, ["minimum", "maximum"]
  );
  const minimum =
    requirePositiveFinite(
      record.minimum,
      path + ".minimum"
    );
  const maximum =
    requirePositiveFinite(
      record.maximum,
      path + ".maximum"
    );
  if (minimum > maximum) {
    throw new InvalidConfigurationError(
      path +
        ".minimum must be less than or equal to maximum."
    );
  }
  return {
    minimum,
    maximum
  };
}

export function parseResolvedBasis(
  value: unknown,
  path: string
): Exclude<
  SpectralWavelengthBasis,
  "unspecified"
> {
  const parsed =
    parseSpectralWavelengthBasis(
      value,
      path
    );
  if (parsed === "unspecified") {
    throw new InvalidConfigurationError(
      path +
        ' must resolve to "air" or "vacuum".'
    );
  }
  return parsed;
}

function parseUncertainty(
  value: unknown,
  path: string
): FrontOfLensFilterUncertainty {
  const record = requireRecord(
    value,
    path, null
  );
  rejectUnknownVariantFields(record, "kind", UNCERTAINTY_VARIANT_FIELDS, path);

  if (record.kind === "relative") {
    const fraction =
      requireNonNegativeFinite(
        record.fraction,
        path + ".fraction"
      );
    if (fraction > 1) {
      throw new InvalidConfigurationError(
        path +
          ".fraction must be less than or equal to one."
      );
    }
    return {
      kind: "relative",
      fraction,
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
    parseEvidenceList(
      value,
      path
    );
  if (
    evidence.some(
      (entry) =>
        entry.reuseStatus ===
        "factual-reference-only"
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        " for embedded numeric filter data must be reusable-data or photivra-owned."
    );
  }
  return evidence;
}

function parseSpectralSamples(
  value: unknown,
  path: string
): readonly FrontOfLensFilterSpectralSample[] {
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
          requirePassiveTransmission(
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
  path: string,
  polarizerAllowed: boolean
): FrontOfLensFilterTransmissionModel {
  const record = requireRecord(
    value,
    path, null
  );
  rejectUnknownVariantFields(record, "kind", {
    "neutral-linear-transmission": ["kind", "linearTransmissionFactor"],
    "neutral-optical-density": ["kind", "opticalDensityBase10"],
    "spectral-transmission": ["kind", "samples"],
    "linear-polarizer": ["kind", "principalTransmittance", "extinctionRatio", "transmissionAxisDegrees"]
  }, path);

  if (record.kind === "linear-polarizer") {
    if (!polarizerAllowed) {
      throw new InvalidConfigurationError(
        path + '.kind "linear-polarizer" requires schemaVersion "' +
          FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION + '".'
      );
    }
    const principal = requireRecord(
      record.principalTransmittance,
      path + ".principalTransmittance", ["value", "evidence"]
    );
    const extinction = requireRecord(
      record.extinctionRatio,
      path + ".extinctionRatio", ["value", "evidence"]
    );
    const ratio = requireFinite(
      extinction.value,
      path + ".extinctionRatio.value"
    );
    if (ratio < 1) {
      throw new InvalidConfigurationError(
        path + ".extinctionRatio.value must be at least one."
      );
    }
    return {
      kind: "linear-polarizer",
      principalTransmittance: {
        value: requirePassiveTransmission(
          principal.value,
          path + ".principalTransmittance.value"
        ),
        evidence: parseEvidenceList(
          principal.evidence,
          path + ".principalTransmittance.evidence"
        )
      },
      extinctionRatio: {
        value: ratio,
        evidence: parseEvidenceList(
          extinction.evidence,
          path + ".extinctionRatio.evidence"
        )
      },
      transmissionAxisDegrees: requireFinite(
        record.transmissionAxisDegrees,
        path + ".transmissionAxisDegrees"
      )
    };
  }

  if (
    record.kind ===
    "neutral-linear-transmission"
  ) {
    const fact = requireRecord(
      record.linearTransmissionFactor,
      path +
        ".linearTransmissionFactor", ["value", "evidence"]
    );
    return {
      kind:
        "neutral-linear-transmission",
      linearTransmissionFactor: {
        value:
          requirePassiveTransmission(
            fact.value,
            path +
              ".linearTransmissionFactor.value"
          ),
        evidence:
          parseEvidenceList(
            fact.evidence,
            path +
              ".linearTransmissionFactor.evidence"
          )
      }
    };
  }

  if (
    record.kind ===
    "neutral-optical-density"
  ) {
    const fact = requireRecord(
      record.opticalDensityBase10,
      path +
        ".opticalDensityBase10", ["value", "evidence"]
    );
    return {
      kind:
        "neutral-optical-density",
      opticalDensityBase10: {
        value:
          requireNonNegativeFinite(
            fact.value,
            path +
              ".opticalDensityBase10.value"
          ),
        evidence:
          parseEvidenceList(
            fact.evidence,
            path +
              ".opticalDensityBase10.evidence"
          )
      }
    };
  }

  if (
    record.kind ===
    "spectral-transmission"
  ) {
    const fact = requireRecord(
      record.samples,
      path + ".samples", ["value", "evidence"]
    );
    return {
      kind:
        "spectral-transmission",
      samples: {
        value:
          parseSpectralSamples(
            fact.value,
            path +
              ".samples.value"
          ),
        evidence:
          parseReusableNumericEvidence(
            fact.evidence,
            path +
              ".samples.evidence"
          )
      }
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

/**
 * Parses one generic front-of-lens transmission filter.
 *
 * Schema 0.1.0 is explicitly unbranded and unpolarized. It models only
 * passive transmission in front of the lens. It does not cover reflections
 * between stacked filters, polarization, flare or ghosting, or filters that
 * change wavelength.
 */
export function parseFrontOfLensFilterProfile(
  value: unknown
): FrontOfLensFilterProfile {
  const record = requireRecord(
    value,
    "frontOfLensFilterProfile", ["schemaVersion", "identityScope", "position", "wavelengthChangingBehaviorModeled", "polarizationModeled", "scientificStatus", "uncertainty", "wavelengthRangeNanometers", "transmission", "filterId", "profileVersion", "wavelengthBasis", "evidence", "limitations"]
  );

  if (
    record.schemaVersion !==
      FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION &&
    record.schemaVersion !==
      FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'frontOfLensFilterProfile.schemaVersion must be "' +
        FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION +
        '" or "' +
        FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  const schemaVersion =
    record.schemaVersion as FrontOfLensFilterProfileSchemaVersion;
  if (
    record.identityScope !==
    "photivra-generic-unbranded"
  ) {
    throw new InvalidConfigurationError(
      'frontOfLensFilterProfile.identityScope must be "photivra-generic-unbranded".'
    );
  }
  if (
    record.position !==
    "front-of-lens"
  ) {
    throw new InvalidConfigurationError(
      'frontOfLensFilterProfile.position must be "front-of-lens".'
    );
  }
  if (
    record.wavelengthChangingBehaviorModeled !==
      false ||
    (schemaVersion ===
      FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION &&
      record.polarizationModeled !== false)
  ) {
    throw new InvalidConfigurationError(
      "frontOfLensFilterProfile must explicitly keep polarization and wavelength-changing behavior unmodeled in schema 0.1.0."
    );
  }

  const status =
    parseScientificStatus(
      record.scientificStatus,
      "frontOfLensFilterProfile.scientificStatus"
    );
  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      "frontOfLensFilterProfile.uncertainty"
    );

  if (
    status === "calibrated" &&
    uncertainty.kind !==
      "relative"
  ) {
    throw new InvalidConfigurationError(
      "A calibrated filter profile requires quantified relative uncertainty."
    );
  }

  const range =
    parseRange(
      record.wavelengthRangeNanometers,
      "frontOfLensFilterProfile.wavelengthRangeNanometers"
    );
  const transmission =
    parseTransmission(
      record.transmission,
      "frontOfLensFilterProfile.transmission",
      schemaVersion ===
        FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION
    );
  const polarizationModeled =
    transmission.kind === "linear-polarizer";
  if (record.polarizationModeled !== polarizationModeled) {
    throw new InvalidConfigurationError(
      "frontOfLensFilterProfile.polarizationModeled must be true exactly for a linear-polarizer transmission."
    );
  }

  if (
    transmission.kind ===
    "spectral-transmission"
  ) {
    const samples =
      transmission.samples.value;
    if (
      samples[0]!
        .wavelengthNanometers >
        range.minimum ||
      samples[
        samples.length - 1
      ]!.wavelengthNanometers <
        range.maximum
    ) {
      throw new InvalidConfigurationError(
        "Spectral filter samples must cover the declared wavelength range."
      );
    }
  }

  return {
    schemaVersion,
    filterId:
      requireNonEmptyString(
        record.filterId,
        "frontOfLensFilterProfile.filterId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "frontOfLensFilterProfile.profileVersion"
      ),
    identityScope:
      "photivra-generic-unbranded",
    position:
      "front-of-lens",
    scientificStatus:
      status,
    wavelengthBasis:
      parseResolvedBasis(
        record.wavelengthBasis,
        "frontOfLensFilterProfile.wavelengthBasis"
      ),
    wavelengthRangeNanometers:
      range,
    transmission,
    uncertainty,
    polarizationModeled,
    wavelengthChangingBehaviorModeled:
      false,
    evidence:
      parseEvidenceList(
        record.evidence,
        "frontOfLensFilterProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "frontOfLensFilterProfile.limitations"
      )
  };
}

function interpolateSpectralTransmission(
  samples:
    readonly FrontOfLensFilterSpectralSample[],
  wavelengthNanometers: number
): number {
  const first =
    samples[0]!;
  const last =
    samples[
      samples.length - 1
    ]!;

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
        samples[
          index - 1
        ]!;
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

function scientificWavelength(
  value: number
): number {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new InvalidScientificInputError(
      "wavelengthNanometers must be finite and greater than zero."
    );
  }
  return value;
}

function transmissionEvidence(
  transmission:
    FrontOfLensFilterTransmissionModel
): readonly EvidenceProvenance[] {
  if (
    transmission.kind ===
    "neutral-linear-transmission"
  ) {
    return transmission
      .linearTransmissionFactor
      .evidence;
  }
  if (
    transmission.kind ===
    "neutral-optical-density"
  ) {
    return transmission
      .opticalDensityBase10
      .evidence;
  }
  if (transmission.kind === "linear-polarizer") {
    return [
      ...transmission.principalTransmittance.evidence,
      ...transmission.extinctionRatio.evidence
    ];
  }
  return transmission
    .samples.evidence;
}

/** Linear Stokes vector (S0, S1, S2); circular S3 is not modeled. */
interface LinearStokes {
  s0: number;
  s1: number;
  s2: number;
}

const UNPOLARIZED: LinearPolarizationState = /* @__PURE__ */ Object.freeze({
  degreeOfLinearPolarization: 0,
  angleDegrees: 0
});

function parsePolarizationState(
  value: LinearPolarizationState | undefined,
  path: string
): LinearPolarizationState {
  if (value === undefined) {
    return { ...UNPOLARIZED };
  }
  if (typeof value !== "object" || value === null) {
    throw new InvalidConfigurationError(path + " must be an object.");
  }
  const degree = value.degreeOfLinearPolarization;
  const angle = value.angleDegrees;
  if (
    typeof degree !== "number" ||
    !Number.isFinite(degree) ||
    degree < 0 ||
    degree > 1
  ) {
    throw new InvalidScientificInputError(
      path + ".degreeOfLinearPolarization must lie in [0, 1]."
    );
  }
  if (typeof angle !== "number" || !Number.isFinite(angle)) {
    throw new InvalidScientificInputError(
      path + ".angleDegrees must be finite."
    );
  }
  return { degreeOfLinearPolarization: degree, angleDegrees: angle };
}

function stokesFromState(state: LinearPolarizationState): LinearStokes {
  const twice = (2 * state.angleDegrees * Math.PI) / 180;
  return {
    s0: 1,
    s1: state.degreeOfLinearPolarization * Math.cos(twice),
    s2: state.degreeOfLinearPolarization * Math.sin(twice)
  };
}

function stateFromStokes(stokes: LinearStokes): LinearPolarizationState {
  const polarized = Math.hypot(stokes.s1, stokes.s2);
  const degree = Math.min(1, polarized / stokes.s0);
  if (degree === 0) {
    return { ...UNPOLARIZED };
  }
  let angle = (Math.atan2(stokes.s2, stokes.s1) * 90) / Math.PI;
  if (angle < 0) angle += 180;
  return { degreeOfLinearPolarization: degree, angleDegrees: angle };
}

/**
 * Mueller matrix of a linear diattenuator (principal intensity transmittances k1 along the axis
 * and k2 across it, axis at theta) applied to a linear Stokes vector.
 */
function applyLinearPolarizer(
  stokes: LinearStokes,
  k1: number,
  k2: number,
  axisDegrees: number
): LinearStokes {
  const twice = (2 * axisDegrees * Math.PI) / 180;
  const c = Math.cos(twice);
  const sn = Math.sin(twice);
  const sum = (k1 + k2) / 2;
  const difference = (k1 - k2) / 2;
  const geometric = Math.sqrt(k1 * k2);
  return {
    s0: sum * stokes.s0 + difference * (c * stokes.s1 + sn * stokes.s2),
    s1:
      difference * c * stokes.s0 +
      (sum * c * c + geometric * sn * sn) * stokes.s1 +
      (sum - geometric) * c * sn * stokes.s2,
    s2:
      difference * sn * stokes.s0 +
      (sum - geometric) * c * sn * stokes.s1 +
      (sum * sn * sn + geometric * c * c) * stokes.s2
  };
}

interface ResolvedComponent {
  resolved: ResolvedFrontOfLensFilterTransmission;
  outgoing: LinearStokes;
}

function resolveComponent(
  input: ResolveFrontOfLensFilterTransmissionInput,
  incoming: LinearStokes
): ResolvedComponent {
  const profile =
    parseFrontOfLensFilterProfile(
      input.profile
    );
  const wavelength =
    scientificWavelength(
      input.wavelengthNanometers
    );

  if (
    input.wavelengthBasis !==
    profile.wavelengthBasis
  ) {
    throw new InvalidScientificInputError(
      "Filter and requested wavelength bases must match; implicit air/vacuum conversion is not performed."
    );
  }
  if (
    wavelength <
      profile
        .wavelengthRangeNanometers
        .minimum ||
    wavelength >
      profile
        .wavelengthRangeNanometers
        .maximum
  ) {
    throw new InvalidScientificInputError(
      "Requested wavelength lies outside the filter applicability range."
    );
  }

  let factor: number;
  let outgoing: LinearStokes;
  const transmission =
    profile.transmission;

  if (
    transmission.kind ===
    "linear-polarizer"
  ) {
    const k1 = transmission.principalTransmittance.value;
    const k2 = k1 / transmission.extinctionRatio.value;
    outgoing = applyLinearPolarizer(
      incoming,
      k1,
      k2,
      transmission.transmissionAxisDegrees
    );
    factor = outgoing.s0 / incoming.s0;
  } else {
    if (
      transmission.kind ===
      "neutral-linear-transmission"
    ) {
      factor =
        transmission
          .linearTransmissionFactor
          .value;
    } else if (
      transmission.kind ===
      "neutral-optical-density"
    ) {
      factor =
        Math.pow(
          10,
          -transmission
            .opticalDensityBase10
            .value
        );
    } else {
      factor =
        interpolateSpectralTransmission(
          transmission.samples.value,
          wavelength
        );
    }
    outgoing = {
      s0: incoming.s0 * factor,
      s1: incoming.s1 * factor,
      s2: incoming.s2 * factor
    };
  }

  if (
    !Number.isFinite(factor) ||
    factor <= 0 ||
    factor > 1
  ) {
    throw new InvalidScientificInputError(
      "Resolved passive filter transmission must remain finite and in (0, 1]."
    );
  }

  const attenuationStops =
    -Math.log2(factor);
  const opticalDensityBase10 =
    -Math.log10(factor);

  if (
    !Number.isFinite(
      attenuationStops
    ) ||
    !Number.isFinite(
      opticalDensityBase10
    )
  ) {
    throw new InvalidScientificInputError(
      "Resolved filter attenuation diagnostics must remain finite."
    );
  }

  const polarizer = transmission.kind === "linear-polarizer";
  return {
    outgoing,
    resolved: {
      schemaVersion:
        profile.schemaVersion,
      filterId:
        profile.filterId,
      profileVersion:
        profile.profileVersion,
      identityScope:
        "photivra-generic-unbranded",
      position:
        "front-of-lens",
      scientificStatus:
        profile.scientificStatus,
      wavelengthNanometers:
        wavelength,
      wavelengthBasis:
        input.wavelengthBasis,
      transmissionKind:
        transmission.kind,
      linearTransmissionFactor:
        factor,
      attenuationStops,
      opticalDensityBase10,
      polarizationModeled:
        polarizer,
      incidentPolarization:
        stateFromStokes(incoming),
      transmittedPolarization:
        stateFromStokes(outgoing),
      wavelengthChangingBehaviorModeled:
        false,
      lensTransmissionIncluded:
        false,
      sensorOpticalStackIncluded:
        false,
      fieldThroughputIncluded:
        false,
      uncertainty:
        profile.uncertainty,
      evidence: [
        ...profile.evidence,
        ...transmissionEvidence(
          transmission
        )
      ],
      limitations: [
        ...profile.limitations,
        "Front-of-lens transmission is independent of lens aperture geometry, focus/DOF, diffraction and sensor optical-stack response.",
        polarizer
          ? "Linear diattenuator on linear Stokes parameters; circular polarization, retardance, angle-of-incidence dependence and inter-filter reflections/flare/ghosting are not modeled."
          : "Polarization and inter-filter reflections/flare/ghosting are not modeled."
      ]
    }
  };
}

/**
 * Resolves one passive filter at one wavelength. Non-polarizing filters scale all Stokes
 * components equally, so their transmission does not depend on the incident polarization.
 */
export function resolveFrontOfLensFilterTransmission(
  input:
    ResolveFrontOfLensFilterTransmissionInput
): ResolvedFrontOfLensFilterTransmission {
  requireInputKeys(input, "resolveFrontOfLensFilterTransmission", ["profile", "wavelengthNanometers", "wavelengthBasis", "incidentPolarization"]);
  return resolveComponent(
    input,
    stokesFromState(
      parsePolarizationState(
        input.incidentPolarization,
        "incidentPolarization"
      )
    )
  ).resolved;
}

/**
 * Combines several passive front-of-lens filters at one wavelength, in light-path order, and keeps
 * each filter's identity. Without a polarizer the result is the product of the transmissions. With
 * one, linear Stokes parameters pass through the Mueller matrices in order.
 */
export function composeFrontOfLensFilterTransmission(
  input:
    ComposeFrontOfLensFilterTransmissionInput
): ComposedFrontOfLensFilterTransmission {
  requireInputKeys(input, "composeFrontOfLensFilterTransmission", ["filters", "wavelengthNanometers", "wavelengthBasis", "incidentPolarization"]);
  if (
    !Array.isArray(
      input.filters
    ) ||
    input.filters.length === 0
  ) {
    throw new InvalidConfigurationError(
      "filters must be a non-empty array."
    );
  }

  const incidentPolarization = parsePolarizationState(
    input.incidentPolarization,
    "incidentPolarization"
  );
  const incident = stokesFromState(incidentPolarization);
  let stokes = incident;
  const components: ResolvedFrontOfLensFilterTransmission[] = [];
  for (const profile of input.filters) {
    const component = resolveComponent(
      {
        profile,
        wavelengthNanometers:
          input.wavelengthNanometers,
        wavelengthBasis:
          input.wavelengthBasis
      },
      stokes
    );
    components.push(component.resolved);
    stokes = component.outgoing;
  }

  const combined = stokes.s0 / incident.s0;
  if (
    !Number.isFinite(combined) ||
    combined <= 0 ||
    combined > 1
  ) {
    throw new InvalidScientificInputError(
      "Combined passive filter transmission must remain finite and in (0, 1]."
    );
  }

  const stops =
    -Math.log2(combined);
  if (!Number.isFinite(stops)) {
    throw new InvalidScientificInputError(
      "Combined filter attenuation must remain finite."
    );
  }

  const polarizationModeled = components.some(
    (component) => component.polarizationModeled
  );
  return {
    schemaVersion: polarizationModeled
      ? FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION
      : FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION,
    wavelengthNanometers:
      scientificWavelength(
        input.wavelengthNanometers
      ),
    wavelengthBasis:
      input.wavelengthBasis,
    appliedFilterCount:
      components.length,
    components,
    combinedLinearTransmissionFactor:
      combined,
    combinedAttenuationStops:
      stops,
    scientificStatus:
      components.some(
        (component) =>
          component
            .scientificStatus ===
          "approximation"
      )
        ? "approximation"
        : "calibrated",
    uncertaintyPropagation:
      "not-propagated",
    uncertaintyLimitation:
      "Component filter uncertainties are preserved individually; aggregate numeric uncertainty is not propagated because independence/correlation is not assumed.",
    compositionModel: polarizationModeled
      ? "ordered-linear-stokes-mueller-no-inter-filter-reflections"
      : "independent-multiplicative-unpolarized-transmission-no-inter-filter-reflections",
    polarizationModeled,
    incidentPolarization,
    transmittedPolarization:
      stateFromStokes(stokes),
    wavelengthChangingBehaviorModeled:
      false,
    lensTransmissionIncluded:
      false,
    sensorOpticalStackIncluded:
      false,
    fieldThroughputIncluded:
      false
  };
}
