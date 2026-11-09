// SPDX-License-Identifier: Apache-2.0

/**
 * Photon energy and optical frequency from wavelength, using the exact SI values of the Planck
 * constant h and the speed of light c (E = h·c / λ_vacuum).
 *
 * The formula needs the vacuum wavelength. An air wavelength is converted with
 * λ_vacuum = n·λ_air, which requires a sourced phase refractive index n of air at that exact
 * wavelength, for matching atmospheric conditions. The refractive index's uncertainty is kept, but
 * it is not automatically carried through to the photon energy.
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
  SensorSpectralResponseScientificStatus,
  SensorSpectralResponseUncertainty,
  SpectralWavelengthBasis
} from "./spectral-response.js";
import { requireInputKeys, rejectUnknownVariantFields, UNCERTAINTY_VARIANT_FIELDS, requireConfigRecord as requireRecord, requireConfigFinite as requireFinite, requireConfigFiniteAboveZero as requirePositiveFinite } from "../core/record-validation.js";

const PLANCK_CONSTANT_JOULE_SECONDS =
  6.62607015e-34;
const SPEED_OF_LIGHT_METERS_PER_SECOND =
  299_792_458;
const NANOMETERS_TO_METERS = 1e-9;

export interface AirRefractiveIndexReferenceConditions {
  temperatureC: number;
  pressurePascal: number;
  relativeHumidityFraction?: number;
  carbonDioxideMoleFraction?: number;
}

export interface SourcedAirPhaseRefractiveIndex {
  wavelengthNanometers: number;
  wavelengthBasis: "air";
  definition:
    "vacuum-wavelength-divided-by-air-wavelength";
  phaseRefractiveIndex: number;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  evidence: readonly EvidenceProvenance[];
  referenceConditions?:
    AirRefractiveIndexReferenceConditions;
}

export type AirRefractiveIndexConditionPolicy =
  | {
      kind: "exact-match-required";
    }
  | {
      kind: "assume-compatible";
      limitation: string;
      evidence: readonly EvidenceProvenance[];
    };

export interface CalculatePhotonEnergyFromWavelengthInput {
  wavelengthNanometers: number;
  wavelengthBasis:
    SpectralWavelengthBasis;
  airPhaseRefractiveIndex?:
    SourcedAirPhaseRefractiveIndex;
  airOperatingConditions?:
    AirRefractiveIndexReferenceConditions;
  airConditionPolicy?:
    AirRefractiveIndexConditionPolicy;
}

export interface PhotonEnergyFromWavelength {
  inputWavelengthNanometers: number;
  inputWavelengthBasis:
    Exclude<SpectralWavelengthBasis, "unspecified">;
  vacuumWavelengthNanometers: number;
  frequencyHertz: number;
  photonEnergyJoules: number;
  wavelengthConversion:
    | "vacuum-identity"
    | "air-to-vacuum-via-phase-refractive-index";
  exactSiConstants: {
    planckConstantJouleSeconds:
      6.62607015e-34;
    speedOfLightMetersPerSecond:
      299792458;
  };
  phaseRefractiveIndexUsed?: number;
  airRefractiveIndexScientificStatus?:
    SensorSpectralResponseScientificStatus;
  airRefractiveIndexUncertainty?:
    SensorSpectralResponseUncertainty;
  airRefractiveIndexReferenceConditions?:
    AirRefractiveIndexReferenceConditions;
  airRefractiveIndexEvidence?:
    readonly EvidenceProvenance[];
  airOperatingConditions?:
    AirRefractiveIndexReferenceConditions;
  airConditionPolicy?:
    AirRefractiveIndexConditionPolicy;
  airConditionCompatibility?:
    | "exact-match"
    | "assumed-compatible";
  airConditionAssumptionEvidence?:
    readonly EvidenceProvenance[];
  inputUncertaintyPropagated: false;
}

function requireFraction(
  value: unknown,
  path: string
): number {
  const parsed =
    requireFinite(value, path);
  if (parsed < 0 || parsed > 1) {
    throw new InvalidConfigurationError(
      path +
        " must be a fraction from 0 through 1."
    );
  }
  return parsed;
}

function parseUncertainty(
  value: unknown,
  path: string
): SensorSpectralResponseUncertainty {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", UNCERTAINTY_VARIANT_FIELDS, path);

  if (record.kind === "relative") {
    const fraction =
      requireFinite(
        record.fraction,
        path + ".fraction"
      );
    if (fraction < 0) {
      throw new InvalidConfigurationError(
        path +
          ".fraction must be greater than or equal to zero."
      );
    }
    if (
      typeof record.basis !== "string" ||
      record.basis.trim().length === 0
    ) {
      throw new InvalidConfigurationError(
        path +
          ".basis must be a non-empty string."
      );
    }
    return {
      kind: "relative",
      fraction,
      basis: record.basis
    };
  }

  if (
    record.kind === "not-quantified"
  ) {
    if (
      typeof record.limitation !==
        "string" ||
      record.limitation.trim().length ===
        0
    ) {
      throw new InvalidConfigurationError(
        path +
          ".limitation must be a non-empty string."
      );
    }
    return {
      kind: "not-quantified",
      limitation:
        record.limitation
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseReferenceConditions(
  value: unknown,
  path: string
): AirRefractiveIndexReferenceConditions {
  const record =
    requireRecord(value, path, ["temperatureC", "pressurePascal", "relativeHumidityFraction", "carbonDioxideMoleFraction"]);

  const temperatureC =
    requireFinite(
      record.temperatureC,
      path + ".temperatureC"
    );
  const pressurePascal =
    requirePositiveFinite(
      record.pressurePascal,
      path + ".pressurePascal"
    );

  const relativeHumidityFraction =
    record.relativeHumidityFraction ===
    undefined
      ? undefined
      : requireFraction(
          record.relativeHumidityFraction,
          path +
            ".relativeHumidityFraction"
        );

  const carbonDioxideMoleFraction =
    record.carbonDioxideMoleFraction ===
    undefined
      ? undefined
      : requireFraction(
          record.carbonDioxideMoleFraction,
          path +
            ".carbonDioxideMoleFraction"
        );

  return {
    temperatureC,
    pressurePascal,
    ...(relativeHumidityFraction ===
    undefined
      ? {}
      : {
          relativeHumidityFraction
        }),
    ...(carbonDioxideMoleFraction ===
    undefined
      ? {}
      : {
          carbonDioxideMoleFraction
        })
  };
}

function parseConditionPolicy(
  value: unknown
): AirRefractiveIndexConditionPolicy {
  const record = requireRecord(
    value,
    "airConditionPolicy", null
  );
  rejectUnknownVariantFields(record, "kind", { "exact-match-required": ["kind"], "assume-compatible": ["kind", "limitation", "evidence"] }, "airConditionPolicy");

  if (
    record.kind === "exact-match-required"
  ) {
    return {
      kind: "exact-match-required"
    };
  }

  if (
    record.kind === "assume-compatible"
  ) {
    if (
      typeof record.limitation !==
        "string" ||
      record.limitation.trim().length ===
        0
    ) {
      throw new InvalidConfigurationError(
        "airConditionPolicy.limitation must be a non-empty string."
      );
    }
    return {
      kind: "assume-compatible",
      limitation:
        record.limitation,
      evidence: parseEvidenceList(
        record.evidence,
        "airConditionPolicy.evidence"
      )
    };
  }

  throw new InvalidConfigurationError(
    "airConditionPolicy.kind is invalid."
  );
}

function conditionsMatch(
  reference:
    AirRefractiveIndexReferenceConditions,
  operating:
    AirRefractiveIndexReferenceConditions
): boolean {
  if (
    reference.temperatureC !==
      operating.temperatureC ||
    reference.pressurePascal !==
      operating.pressurePascal
  ) {
    return false;
  }
  if (
    reference.relativeHumidityFraction !==
      undefined &&
    reference.relativeHumidityFraction !==
      operating.relativeHumidityFraction
  ) {
    return false;
  }
  if (
    reference.carbonDioxideMoleFraction !==
      undefined &&
    reference.carbonDioxideMoleFraction !==
      operating.carbonDioxideMoleFraction
  ) {
    return false;
  }
  return true;
}

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The index is the phase refractive index n of air at one exact wavelength, from a cited source, for
 * stated atmospheric conditions. It converts air to vacuum wavelength: λ_vacuum = n·λ_air.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseSourcedAirPhaseRefractiveIndex(
  value: unknown
): SourcedAirPhaseRefractiveIndex {
  const record = requireRecord(
    value,
    "airPhaseRefractiveIndex", ["wavelengthBasis", "definition", "scientificStatus", "uncertainty", "referenceConditions", "wavelengthNanometers", "phaseRefractiveIndex", "evidence"]
  );

  if (
    record.wavelengthBasis !== "air"
  ) {
    throw new InvalidConfigurationError(
      'airPhaseRefractiveIndex.wavelengthBasis must be "air".'
    );
  }
  if (
    record.definition !==
    "vacuum-wavelength-divided-by-air-wavelength"
  ) {
    throw new InvalidConfigurationError(
      "airPhaseRefractiveIndex.definition is invalid."
    );
  }
  if (
    record.scientificStatus !==
      "calibrated" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      "airPhaseRefractiveIndex.scientificStatus is invalid."
    );
  }

  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      "airPhaseRefractiveIndex.uncertainty"
    );
  const referenceConditions =
    record.referenceConditions ===
    undefined
      ? undefined
      : parseReferenceConditions(
          record.referenceConditions,
          "airPhaseRefractiveIndex.referenceConditions"
        );

  if (
    record.scientificStatus ===
      "calibrated" &&
    uncertainty.kind ===
      "not-quantified"
  ) {
    throw new InvalidConfigurationError(
      "A calibrated air phase refractive index must declare quantified relative uncertainty."
    );
  }
  if (
    record.scientificStatus ===
      "calibrated" &&
    referenceConditions === undefined
  ) {
    throw new InvalidConfigurationError(
      "A calibrated air phase refractive index must declare temperature and pressure reference conditions."
    );
  }

  return {
    wavelengthNanometers:
      requirePositiveFinite(
        record.wavelengthNanometers,
        "airPhaseRefractiveIndex.wavelengthNanometers"
      ),
    wavelengthBasis: "air",
    definition:
      "vacuum-wavelength-divided-by-air-wavelength",
    phaseRefractiveIndex:
      requirePositiveFinite(
        record.phaseRefractiveIndex,
        "airPhaseRefractiveIndex.phaseRefractiveIndex"
      ),
    scientificStatus:
      record.scientificStatus,
    uncertainty,
    evidence: parseEvidenceList(
      record.evidence,
      "airPhaseRefractiveIndex.evidence"
    ),
    ...(referenceConditions ===
    undefined
      ? {}
      : { referenceConditions })
  };
}

/**
 * Converts a vacuum wavelength, or an air wavelength with its stated atmosphere, into optical
 * frequency and photon energy using the exact SI constants h and c.
 *
 * An air wavelength needs a sourced phase refractive index for that exact wavelength and matching
 * atmosphere; λ_vacuum = n·λ_air. The index's uncertainty is kept but not automatically carried
 * through to the photon energy.
 * @param input - The input; see `CalculatePhotonEnergyFromWavelengthInput` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function calculatePhotonEnergyFromWavelength(
  input:
    CalculatePhotonEnergyFromWavelengthInput
): CalculationResult<PhotonEnergyFromWavelength> {
  requireInputKeys(input, "calculatePhotonEnergyFromWavelength", ["wavelengthNanometers", "wavelengthBasis", "airPhaseRefractiveIndex", "airOperatingConditions", "airConditionPolicy"]);
  const wavelengthNanometers = input.wavelengthNanometers;
  // A calculation input, not a configuration record, so a bad value is a scientific-input error.
  if (typeof wavelengthNanometers !== "number" || !Number.isFinite(wavelengthNanometers)) {
    throw new InvalidScientificInputError("wavelengthNanometers must be finite.");
  }
  if (wavelengthNanometers <= 0) {
    throw new InvalidScientificInputError("wavelengthNanometers must be greater than zero.");
  }

  if (
    input.wavelengthBasis ===
      "unspecified"
  ) {
    throw new InvalidScientificInputError(
      "wavelengthBasis must be resolved to air or vacuum before photon-energy calculation."
    );
  }

  if (
    input.wavelengthBasis !== "air" &&
    input.wavelengthBasis !== "vacuum"
  ) {
    throw new InvalidConfigurationError(
      "wavelengthBasis is invalid."
    );
  }

  let vacuumWavelengthNanometers:
    number;
  let wavelengthConversion:
    PhotonEnergyFromWavelength["wavelengthConversion"];
  let parsedAir:
    SourcedAirPhaseRefractiveIndex |
    undefined;

  let parsedConditionPolicy:
    AirRefractiveIndexConditionPolicy |
    undefined;
  let parsedOperatingConditions:
    AirRefractiveIndexReferenceConditions |
    undefined;
  let airConditionCompatibility:
    PhotonEnergyFromWavelength["airConditionCompatibility"] |
    undefined;

  if (
    input.wavelengthBasis ===
      "vacuum"
  ) {
    if (
      input.airPhaseRefractiveIndex !==
        undefined ||
      input.airOperatingConditions !==
        undefined ||
      input.airConditionPolicy !==
        undefined
    ) {
      throw new InvalidScientificInputError(
        "Air refractive-index inputs must be omitted for vacuum-basis wavelengths."
      );
    }
    vacuumWavelengthNanometers =
      wavelengthNanometers;
    wavelengthConversion =
      "vacuum-identity";
  } else {
    if (
      input.airPhaseRefractiveIndex ===
      undefined
    ) {
      throw new InvalidScientificInputError(
        "airPhaseRefractiveIndex is required for air-basis photon-energy calculation."
      );
    }
    parsedAir =
      parseSourcedAirPhaseRefractiveIndex(
        input.airPhaseRefractiveIndex
      );

    if (
      parsedAir.wavelengthNanometers !==
      wavelengthNanometers
    ) {
      throw new InvalidScientificInputError(
        "airPhaseRefractiveIndex wavelength must exactly match wavelengthNanometers."
      );
    }

    if (
      input.airConditionPolicy ===
      undefined
    ) {
      throw new InvalidScientificInputError(
        "airConditionPolicy is required for air-basis photon-energy calculation."
      );
    }
    parsedConditionPolicy =
      parseConditionPolicy(
        input.airConditionPolicy
      );

    if (
      parsedConditionPolicy.kind ===
      "exact-match-required"
    ) {
      if (
        parsedAir.referenceConditions ===
        undefined
      ) {
        throw new InvalidScientificInputError(
          "Exact air-condition matching requires refractive-index reference conditions."
        );
      }
      if (
        input.airOperatingConditions ===
        undefined
      ) {
        throw new InvalidScientificInputError(
          "airOperatingConditions is required when exact air-condition matching is selected."
        );
      }
      parsedOperatingConditions =
        parseReferenceConditions(
          input.airOperatingConditions,
          "airOperatingConditions"
        );
      if (
        !conditionsMatch(
          parsedAir.referenceConditions,
          parsedOperatingConditions
        )
      ) {
        throw new InvalidScientificInputError(
          "airOperatingConditions must match the refractive-index reference conditions."
        );
      }
      airConditionCompatibility =
        "exact-match";
    } else {
      parsedOperatingConditions =
        input.airOperatingConditions ===
        undefined
          ? undefined
          : parseReferenceConditions(
              input.airOperatingConditions,
              "airOperatingConditions"
            );
      airConditionCompatibility =
        "assumed-compatible";
    }

    vacuumWavelengthNanometers =
      wavelengthNanometers *
      parsedAir.phaseRefractiveIndex;
    wavelengthConversion =
      "air-to-vacuum-via-phase-refractive-index";
  }

  const vacuumWavelengthMeters =
    vacuumWavelengthNanometers *
    NANOMETERS_TO_METERS;
  const frequencyHertz =
    SPEED_OF_LIGHT_METERS_PER_SECOND /
    vacuumWavelengthMeters;
  const photonEnergyJoules =
    PLANCK_CONSTANT_JOULE_SECONDS *
    frequencyHertz;

  if (
    !Number.isFinite(
      vacuumWavelengthNanometers
    ) ||
    !Number.isFinite(frequencyHertz) ||
    !Number.isFinite(
      photonEnergyJoules
    )
  ) {
    throw new InvalidScientificInputError(
      "Photon-energy calculation must remain finite."
    );
  }

  return calculatedResult(
    {
      inputWavelengthNanometers:
        wavelengthNanometers,
      inputWavelengthBasis:
        input.wavelengthBasis,
      vacuumWavelengthNanometers,
      frequencyHertz,
      photonEnergyJoules,
      wavelengthConversion,
      exactSiConstants: {
        planckConstantJouleSeconds:
          PLANCK_CONSTANT_JOULE_SECONDS,
        speedOfLightMetersPerSecond:
          SPEED_OF_LIGHT_METERS_PER_SECOND
      },
      ...(parsedAir === undefined
        ? {}
        : {
            phaseRefractiveIndexUsed:
              parsedAir
                .phaseRefractiveIndex,
            airRefractiveIndexScientificStatus:
              parsedAir
                .scientificStatus,
            airRefractiveIndexUncertainty:
              parsedAir.uncertainty,
            ...(parsedAir
              .referenceConditions ===
            undefined
              ? {}
              : {
                  airRefractiveIndexReferenceConditions:
                    parsedAir
                      .referenceConditions
                }),
            airRefractiveIndexEvidence:
              parsedAir.evidence,
            ...(parsedOperatingConditions ===
            undefined
              ? {}
              : {
                  airOperatingConditions:
                    parsedOperatingConditions
                }),
            ...(parsedConditionPolicy ===
            undefined
              ? {}
              : {
                  airConditionPolicy:
                    parsedConditionPolicy
                }),
            ...(airConditionCompatibility ===
            undefined
              ? {}
              : {
                  airConditionCompatibility
                }),
            ...(parsedConditionPolicy?.kind ===
            "assume-compatible"
              ? {
                  airConditionAssumptionEvidence:
                    parsedConditionPolicy
                      .evidence
                }
              : {})
          }),
      inputUncertaintyPropagated:
        false
    },
    "photon-energy-from-spectral-wavelength",
    "1.0.0",
    [
      "Planck constant h and vacuum speed of light c use their exact SI defining values.",
      "Photon energy is h times optical frequency; frequency is derived from vacuum wavelength.",
      "Vacuum-basis wavelength requires no refractive-index correction.",
      "Air-basis wavelength is converted with the phase refractive index definition n = lambda_vacuum / lambda_air at the exact requested wavelength.",
      "Air refractive index varies with wavelength and atmospheric conditions; this function never substitutes n = 1.",
      "Air-basis conversion requires either exact matching to the refractive-index reference atmosphere or an explicit evidence-backed compatibility assumption.",
      "Input refractive-index uncertainty is preserved as metadata but is not propagated into photon-energy uncertainty by this foundation.",
      "This calculation does not apply QE, calculate photon rate, generate electrons, integrate exposure time, or model saturation/noise."
    ]
  );
}
