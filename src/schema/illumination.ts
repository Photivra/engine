// SPDX-License-Identifier: Apache-2.0

/**
 * Scene illumination profiles: the light sources in a scene, independent of any renderer.
 *
 * A profile describes sources only. It does not compute the light leaving surfaces
 * (outgoing scene radiance), material response, visibility or indirect light, and on its
 * own it does not justify photon or electron counts downstream.
 * @see docs/SCENE_RADIANCE_AND_ILLUMINATION.md for equations, coordinate/unit conventions, blockers
 * and support limits.
 */

import { rejectUnknownFields, rejectUnknownVariantFields, requireFixedFieldsWhenPresent, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, parseConfigScientificStatus as parseScientificStatus, requireConfigFiniteNumber as requireFinite, parseConfigLimitations as parseLimitations, requireConfigFraction as requireFraction, requireConfigNumberAtLeastZero as requireNonNegativeFinite, requireConfigNumberAboveZero as requirePositiveFinite } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import {
  parseSpectralWavelengthBasis,
  type SpectralWavelengthBasis
} from "../core/spectral.js";
import {
  parseNormalizedDiscreteSpectralLineDistribution,
  type NormalizedDiscreteSpectralLineDistribution
} from "../core/spectral-composition.js";
import type { Vector3 } from "./scene.js";

export const SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION = "0.1.0" as const;

export type SceneIlluminationSourceFamily =
  | "point"
  | "spot"
  | "area"
  | "directional"
  | "environment";

export type SceneIlluminationScientificStatus =
  | "calibrated"
  | "approximation";

export type SceneIlluminationUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };

export type SceneIlluminationSourceGeometry =
  | {
      kind: "point-position";
      positionM: Vector3;
    }
  | {
      kind: "scene-object-binding";
      sceneObjectId: string;
    }
  | {
      kind: "spot";
      origin:
        | {
            kind: "point-position";
            positionM: Vector3;
          }
        | {
            kind: "scene-object-binding";
            sceneObjectId: string;
          };
      directionUnitVector: Vector3;
      outerConeAngleDegrees: number;
    }
  | {
      kind: "directional";
      directionUnitVector: Vector3;
    }
  | {
      kind: "environment";
    };

export type SceneIlluminationMagnitude =
  | {
      kind: "relative-linear-scale";
      scale: number;
      scientificStatus: "approximation";
      limitation: string;
    }
  | {
      kind: "radiant-intensity";
      wattsPerSteradian: number;
      scientificStatus: SceneIlluminationScientificStatus;
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
    }
  | {
      kind: "surface-radiance";
      wattsPerSquareMeterSteradian: number;
      scientificStatus: SceneIlluminationScientificStatus;
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
    }
  | {
      kind: "reference-plane-irradiance";
      wattsPerSquareMeter: number;
      referencePlaneId: string;
      scientificStatus: SceneIlluminationScientificStatus;
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
    };

export interface SceneIlluminationRelativeSpectrumSample {
  wavelengthNanometers: number;
  relativeDensityPerNanometer: number;
}

export type SceneIlluminationSpectrum =
  | {
      kind: "unresolved";
      limitation: string;
    }
  | {
      kind: "rgb-preview-approximation";
      colorSpace: "linear-srgb";
      red: number;
      green: number;
      blue: number;
      limitation: string;
    }
  | {
      kind: "blackbody-temperature-approximation";
      temperatureKelvin: number;
      limitation: string;
    }
  | {
      kind: "continuous-relative-spectrum";
      spectrumId: string;
      wavelengthUnit: "nm";
      wavelengthBasis: SpectralWavelengthBasis;
      interpolation: "piecewise-linear";
      outsideRangeBehavior: "fail-closed";
      normalization: "arbitrary-relative-scale";
      scientificStatus:
        | "calibrated-relative-shape"
        | "approximation";
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
      samples:
        readonly SceneIlluminationRelativeSpectrumSample[];
    }
  | {
      kind: "discrete-relative-lines";
      spectrumId: string;
      wavelengthUnit: "nm";
      scientificStatus:
        | "calibrated-relative-lines"
        | "approximation";
      uncertainty: SceneIlluminationUncertainty;
      evidence: readonly EvidenceProvenance[];
      distribution:
        NormalizedDiscreteSpectralLineDistribution;
    };

export interface SceneIlluminationSource {
  sourceId: string;
  family: SceneIlluminationSourceFamily;
  enabled: boolean;
  geometry: SceneIlluminationSourceGeometry;
  magnitude: SceneIlluminationMagnitude;
  spectrum: SceneIlluminationSpectrum;
  temporalBehavior: {
    kind: "time-invariant";
  };
  evidence: readonly EvidenceProvenance[];
  limitations?: readonly string[];
}

export interface SceneIlluminationProfile {
  schemaVersion:
    typeof SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION;
  profileId: string;
  sceneId: string;
  evidence: readonly EvidenceProvenance[];
  sources: readonly SceneIlluminationSource[];
  sceneRadianceCalculated: false;
  materialResponseApplied: false;
  visibilityEvaluated: false;
  indirectTransportEvaluated: false;
  fluorescenceModeled: false;
  volumetricTransportModeled: false;
  polarizationModeled: false;
}

function requireBoolean(
  value: unknown,
  path: string
): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidConfigurationError(
      path + " must be a boolean."
    );
  }
  return value;
}

export function parseVector3(
  value: unknown,
  path: string
): Vector3 {
  const record = requireRecord(value, path, ["x", "y", "z"]);
  return {
    x: requireFinite(record.x, path + ".x"),
    y: requireFinite(record.y, path + ".y"),
    z: requireFinite(record.z, path + ".z")
  };
}

function parseDirectionUnitVector(
  value: unknown,
  path: string
): Vector3 {
  const vector = parseVector3(value, path);
  const magnitude = Math.hypot(
    vector.x,
    vector.y,
    vector.z
  );
  if (
    !Number.isFinite(magnitude) ||
    Math.abs(magnitude - 1) > 1e-9
  ) {
    throw new InvalidConfigurationError(
      path + " must be a unit-length direction vector."
    );
  }
  return vector;
}

function parseUncertainty(
  value: unknown,
  path: string
): SceneIlluminationUncertainty {
  const record = requireRecord(value, path, null);

  if (record.kind === "relative") {
    rejectUnknownFields(record, ["kind", "fraction", "basis"], path);
    return {
      kind: "relative",
      fraction: requireNonNegativeFinite(
        record.fraction,
        path + ".fraction"
      ),
      basis: requireNonEmptyString(
        record.basis,
        path + ".basis"
      )
    };
  }

  if (record.kind === "not-quantified") {
    rejectUnknownFields(record, ["kind", "limitation"], path);
    return {
      kind: "not-quantified",
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      )
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function validateCalibratedUncertainty(
  scientificStatus:
    SceneIlluminationScientificStatus,
  uncertainty: SceneIlluminationUncertainty,
  path: string
): void {
  if (
    scientificStatus === "calibrated" &&
    uncertainty.kind !== "relative"
  ) {
    throw new InvalidConfigurationError(
      path +
        " calibrated physical magnitude requires quantified relative uncertainty."
    );
  }
}

function parsePointOrigin(
  value: unknown,
  path: string
):
  | {
      kind: "point-position";
      positionM: Vector3;
    }
  | {
      kind: "scene-object-binding";
      sceneObjectId: string;
    } {
  const record = requireRecord(value, path, null);

  if (record.kind === "point-position") {
    rejectUnknownFields(record, ["kind", "positionM"], path);
    return {
      kind: "point-position",
      positionM: parseVector3(
        record.positionM,
        path + ".positionM"
      )
    };
  }

  if (record.kind === "scene-object-binding") {
    rejectUnknownFields(record, ["kind", "sceneObjectId"], path);
    return {
      kind: "scene-object-binding",
      sceneObjectId: requireNonEmptyString(
        record.sceneObjectId,
        path + ".sceneObjectId"
      )
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseGeometry(
  family: SceneIlluminationSourceFamily,
  value: unknown,
  path: string
): SceneIlluminationSourceGeometry {
  // The allowed fields depend on the source family; parsePointOrigin checks the point geometry.
  const record = requireRecord(value, path, null);

  if (family === "point") {
    return parsePointOrigin(record, path);
  }

  if (family === "spot") {
    if (record.kind !== "spot") {
      throw new InvalidConfigurationError(
        path + '.kind must be "spot" for a spot source.'
      );
    }
    rejectUnknownFields(record, ["kind", "origin", "directionUnitVector", "outerConeAngleDegrees"], path);
    const outerConeAngleDegrees =
      requirePositiveFinite(
        record.outerConeAngleDegrees,
        path + ".outerConeAngleDegrees"
      );
    if (outerConeAngleDegrees >= 180) {
      throw new InvalidConfigurationError(
        path +
          ".outerConeAngleDegrees must be less than 180."
      );
    }
    return {
      kind: "spot",
      origin: parsePointOrigin(
        record.origin,
        path + ".origin"
      ),
      directionUnitVector:
        parseDirectionUnitVector(
          record.directionUnitVector,
          path + ".directionUnitVector"
        ),
      outerConeAngleDegrees
    };
  }

  if (family === "area") {
    if (record.kind !== "scene-object-binding") {
      throw new InvalidConfigurationError(
        path +
          '.kind must be "scene-object-binding" for an area source so emitting geometry remains scene-owned.'
      );
    }
    rejectUnknownFields(record, ["kind", "sceneObjectId"], path);
    return {
      kind: "scene-object-binding",
      sceneObjectId: requireNonEmptyString(
        record.sceneObjectId,
        path + ".sceneObjectId"
      )
    };
  }

  if (family === "directional") {
    if (record.kind !== "directional") {
      throw new InvalidConfigurationError(
        path +
          '.kind must be "directional" for a directional source.'
      );
    }
    rejectUnknownFields(record, ["kind", "directionUnitVector"], path);
    return {
      kind: "directional",
      directionUnitVector:
        parseDirectionUnitVector(
          record.directionUnitVector,
          path + ".directionUnitVector"
        )
    };
  }

  if (record.kind !== "environment") {
    throw new InvalidConfigurationError(
      path +
        '.kind must be "environment" for an environment source.'
    );
  }
  rejectUnknownFields(record, ["kind"], path);
  return { kind: "environment" };
}

function parseMagnitude(
  family: SceneIlluminationSourceFamily,
  value: unknown,
  path: string
): SceneIlluminationMagnitude {
  const record = requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", {
    "relative-linear-scale": ["kind", "scale", "scientificStatus", "limitation"],
    "radiant-intensity": ["kind", "wattsPerSteradian", "scientificStatus", "uncertainty", "evidence"],
    "surface-radiance": ["kind", "wattsPerSquareMeterSteradian", "scientificStatus", "uncertainty", "evidence"],
    "reference-plane-irradiance": ["kind", "wattsPerSquareMeter", "referencePlaneId", "scientificStatus", "uncertainty", "evidence"]
  }, path);

  if (record.kind === "relative-linear-scale") {
    if (record.scientificStatus !== "approximation") {
      throw new InvalidConfigurationError(
        path +
          '.scientificStatus must be "approximation" for relative-linear-scale.'
      );
    }
    return {
      kind: "relative-linear-scale",
      scale: requirePositiveFinite(
        record.scale,
        path + ".scale"
      ),
      scientificStatus: "approximation",
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      )
    };
  }

  const scientificStatus =
    parseScientificStatus(
      record.scientificStatus,
      path + ".scientificStatus"
    );
  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      path + ".uncertainty"
    );
  validateCalibratedUncertainty(
    scientificStatus,
    uncertainty,
    path
  );
  const evidence = parseEvidenceList(
    record.evidence,
    path + ".evidence"
  );

  if (
    record.kind === "radiant-intensity" &&
    family === "point"
  ) {
    return {
      kind: "radiant-intensity",
      wattsPerSteradian:
        requirePositiveFinite(
          record.wattsPerSteradian,
          path + ".wattsPerSteradian"
        ),
      scientificStatus,
      uncertainty,
      evidence
    };
  }

  if (
    record.kind === "surface-radiance" &&
    family === "area"
  ) {
    return {
      kind: "surface-radiance",
      wattsPerSquareMeterSteradian:
        requirePositiveFinite(
          record.wattsPerSquareMeterSteradian,
          path +
            ".wattsPerSquareMeterSteradian"
        ),
      scientificStatus,
      uncertainty,
      evidence
    };
  }

  if (
    record.kind ===
      "reference-plane-irradiance" &&
    family === "directional"
  ) {
    return {
      kind: "reference-plane-irradiance",
      wattsPerSquareMeter:
        requirePositiveFinite(
          record.wattsPerSquareMeter,
          path + ".wattsPerSquareMeter"
        ),
      referencePlaneId:
        requireNonEmptyString(
          record.referencePlaneId,
          path + ".referencePlaneId"
        ),
      scientificStatus,
      uncertainty,
      evidence
    };
  }

  throw new InvalidConfigurationError(
    path +
      ".kind is not supported for source family " +
      family +
      "."
  );
}

function requireReusableSpectrumEvidence(
  value: unknown,
  path: string
): readonly EvidenceProvenance[] {
  const evidence = parseEvidenceList(
    value,
    path
  );
  if (
    !evidence.some(
      (entry) =>
        entry.reuseStatus ===
          "reusable-data" ||
        entry.reuseStatus ===
          "photivra-owned"
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        " must contain reusable-data or photivra-owned evidence because the spectrum embeds reusable numeric data."
    );
  }
  return evidence;
}

function parseSpectrum(
  value: unknown,
  path: string
): SceneIlluminationSpectrum {
  const record = requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", {
    unresolved: ["kind", "limitation"],
    "rgb-preview-approximation": ["kind", "colorSpace", "red", "green", "blue", "limitation"],
    "blackbody-temperature-approximation": ["kind", "temperatureKelvin", "limitation"],
    "discrete-relative-lines": ["kind", "spectrumId", "wavelengthUnit", "scientificStatus", "uncertainty", "evidence", "distribution"],
    "continuous-relative-spectrum": ["kind", "spectrumId", "wavelengthUnit", "wavelengthBasis", "interpolation", "outsideRangeBehavior",
      "normalization", "scientificStatus", "uncertainty", "evidence", "samples"]
  }, path);

  if (record.kind === "unresolved") {
    return {
      kind: "unresolved",
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      )
    };
  }

  if (
    record.kind ===
    "rgb-preview-approximation"
  ) {
    if (record.colorSpace !== "linear-srgb") {
      throw new InvalidConfigurationError(
        path +
          '.colorSpace must be "linear-srgb" for the first RGB preview approximation.'
      );
    }
    return {
      kind: "rgb-preview-approximation",
      colorSpace: "linear-srgb",
      red: requireFraction(
        record.red,
        path + ".red"
      ),
      green: requireFraction(
        record.green,
        path + ".green"
      ),
      blue: requireFraction(
        record.blue,
        path + ".blue"
      ),
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      )
    };
  }

  if (
    record.kind ===
    "blackbody-temperature-approximation"
  ) {
    return {
      kind: "blackbody-temperature-approximation",
      temperatureKelvin:
        requirePositiveFinite(
          record.temperatureKelvin,
          path + ".temperatureKelvin"
        ),
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      )
    };
  }

  if (
    record.kind ===
    "discrete-relative-lines"
  ) {
    if (record.wavelengthUnit !== "nm") {
      throw new InvalidConfigurationError(
        path + '.wavelengthUnit must be "nm".'
      );
    }
    if (
      record.scientificStatus !==
        "calibrated-relative-lines" &&
      record.scientificStatus !==
        "approximation"
    ) {
      throw new InvalidConfigurationError(
        path + ".scientificStatus is invalid."
      );
    }
    const uncertainty =
      parseUncertainty(
        record.uncertainty,
        path + ".uncertainty"
      );
    if (
      record.scientificStatus ===
        "calibrated-relative-lines" &&
      uncertainty.kind !== "relative"
    ) {
      throw new InvalidConfigurationError(
        path +
          " calibrated-relative-lines spectra require quantified relative uncertainty."
      );
    }

    return {
      kind: "discrete-relative-lines",
      spectrumId: requireNonEmptyString(
        record.spectrumId,
        path + ".spectrumId"
      ),
      wavelengthUnit: "nm",
      scientificStatus:
        record.scientificStatus,
      uncertainty,
      evidence:
        requireReusableSpectrumEvidence(
          record.evidence,
          path + ".evidence"
        ),
      distribution:
        parseNormalizedDiscreteSpectralLineDistribution(
          record.distribution,
          path + ".distribution"
        )
    };
  }

  if (
    record.kind !==
    "continuous-relative-spectrum"
  ) {
    throw new InvalidConfigurationError(
      path + ".kind is invalid."
    );
  }

  if (record.wavelengthUnit !== "nm") {
    throw new InvalidConfigurationError(
      path + '.wavelengthUnit must be "nm".'
    );
  }
  if (
    record.interpolation !==
    "piecewise-linear"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.interpolation must be "piecewise-linear".'
    );
  }
  if (
    record.outsideRangeBehavior !==
    "fail-closed"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.outsideRangeBehavior must be "fail-closed".'
    );
  }
  if (
    record.normalization !==
    "arbitrary-relative-scale"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.normalization must be "arbitrary-relative-scale".'
    );
  }
  if (
    record.scientificStatus !==
      "calibrated-relative-shape" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      path + ".scientificStatus is invalid."
    );
  }

  const wavelengthBasis =
    parseSpectralWavelengthBasis(
      record.wavelengthBasis,
      path + ".wavelengthBasis"
    );
  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      path + ".uncertainty"
    );
  if (
    record.scientificStatus ===
      "calibrated-relative-shape" &&
    wavelengthBasis === "unspecified"
  ) {
    throw new InvalidConfigurationError(
      path +
        ' calibrated-relative-shape spectra must declare wavelengthBasis "air" or "vacuum".'
    );
  }
  if (
    record.scientificStatus ===
      "calibrated-relative-shape" &&
    uncertainty.kind !== "relative"
  ) {
    throw new InvalidConfigurationError(
      path +
        " calibrated-relative-shape spectra require quantified relative uncertainty."
    );
  }

  const evidence =
    requireReusableSpectrumEvidence(
      record.evidence,
      path + ".evidence"
    );
  if (
    !Array.isArray(record.samples) ||
    record.samples.length < 2
  ) {
    throw new InvalidConfigurationError(
      path +
        ".samples must contain at least two wavelength samples."
    );
  }

  let previousWavelength =
    Number.NEGATIVE_INFINITY;
  let hasPositiveDensity = false;
  const samples = record.samples.map(
    (entry, index) => {
      const sample = requireRecord(
        entry,
        path + ".samples[" + index + "]", ["wavelengthNanometers", "relativeDensityPerNanometer"]
      );
      const wavelengthNanometers =
        requirePositiveFinite(
          sample.wavelengthNanometers,
          path +
            ".samples[" +
            index +
            "].wavelengthNanometers"
        );
      if (
        wavelengthNanometers <=
        previousWavelength
      ) {
        throw new InvalidConfigurationError(
          path +
            ".samples wavelengths must be strictly increasing."
        );
      }
      previousWavelength =
        wavelengthNanometers;
      const relativeDensityPerNanometer =
        requireNonNegativeFinite(
          sample.relativeDensityPerNanometer,
          path +
            ".samples[" +
            index +
            "].relativeDensityPerNanometer"
        );
      if (relativeDensityPerNanometer > 0) {
        hasPositiveDensity = true;
      }
      return {
        wavelengthNanometers,
        relativeDensityPerNanometer
      };
    }
  );

  if (!hasPositiveDensity) {
    throw new InvalidConfigurationError(
      path +
        ".samples must contain at least one positive relative density."
    );
  }

  return {
    kind: "continuous-relative-spectrum",
    spectrumId: requireNonEmptyString(
      record.spectrumId,
      path + ".spectrumId"
    ),
    wavelengthUnit: "nm",
    wavelengthBasis,
    interpolation: "piecewise-linear",
    outsideRangeBehavior: "fail-closed",
    normalization: "arbitrary-relative-scale",
    scientificStatus:
      record.scientificStatus,
    uncertainty,
    evidence,
    samples
  };
}

function parseFamily(
  value: unknown,
  path: string
): SceneIlluminationSourceFamily {
  if (
    value !== "point" &&
    value !== "spot" &&
    value !== "area" &&
    value !== "directional" &&
    value !== "environment"
  ) {
    throw new InvalidConfigurationError(
      path + " is invalid."
    );
  }
  return value;
}

/** Parses one source of a scene illumination profile (also used by record-taking helpers). Not a root export. */
export function parseSceneIlluminationSource(
  value: unknown,
  path: string
): SceneIlluminationSource {
  const record = requireRecord(value, path, ["family", "temporalBehavior", "sourceId", "enabled", "geometry", "magnitude", "spectrum", "evidence", "limitations"]);
  const family = parseFamily(
    record.family,
    path + ".family"
  );

  const temporalBehavior =
    requireRecord(
      record.temporalBehavior,
      path + ".temporalBehavior", ["kind"]
    );
  if (
    temporalBehavior.kind !==
    "time-invariant"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.temporalBehavior.kind must be "time-invariant" in schema 0.1.0.'
    );
  }

  return {
    sourceId: requireNonEmptyString(
      record.sourceId,
      path + ".sourceId"
    ),
    family,
    enabled: requireBoolean(
      record.enabled,
      path + ".enabled"
    ),
    geometry: parseGeometry(
      family,
      record.geometry,
      path + ".geometry"
    ),
    magnitude: parseMagnitude(
      family,
      record.magnitude,
      path + ".magnitude"
    ),
    spectrum: parseSpectrum(
      record.spectrum,
      path + ".spectrum"
    ),
    temporalBehavior: {
      kind: "time-invariant"
    },
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    ),
    ...(record.limitations === undefined
      ? {}
      : {
          limitations: parseLimitations(
            record.limitations,
            path + ".limitations"
          )
        })
  };
}

/** Fixed flags the parser writes; a parsed profile may carry them back in unchanged. */
const ILLUMINATION_PROFILE_FIXED_FIELDS = {
  sceneRadianceCalculated: false, materialResponseApplied: false, visibilityEvaluated: false,
  indirectTransportEvaluated: false, fluorescenceModeled: false, volumetricTransportModeled: false,
  polarizationModeled: false
} as const;

/**
 * Parses a renderer-independent scene illumination profile.
 *
 * The result describes light sources only. It does not compute outgoing scene
 * radiance, material response, visibility or indirect light, and on its own it
 * does not justify photon or electron counts downstream.
 */
export function parseSceneIlluminationProfile(
  value: unknown
): SceneIlluminationProfile {
  const record = requireRecord(
    value,
    "sceneIlluminationProfile", ["schemaVersion", "sources", "profileId", "sceneId", "evidence", ...Object.keys(ILLUMINATION_PROFILE_FIXED_FIELDS)]
  );
  requireFixedFieldsWhenPresent(record, ILLUMINATION_PROFILE_FIXED_FIELDS, "sceneIlluminationProfile");

  if (
    record.schemaVersion !==
    SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sceneIlluminationProfile.schemaVersion must be "' +
        SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }

  if (!Array.isArray(record.sources)) {
    throw new InvalidConfigurationError(
      "sceneIlluminationProfile.sources must be an array."
    );
  }

  const sources = record.sources.map(
    (source, index) =>
      parseSceneIlluminationSource(
        source,
        "sceneIlluminationProfile.sources[" +
          index +
          "]"
      )
  );
  const sourceIds = sources.map(
    (source) => source.sourceId
  );
  if (
    new Set(sourceIds).size !==
    sourceIds.length
  ) {
    throw new InvalidConfigurationError(
      "sceneIlluminationProfile.sources[].sourceId must not contain duplicates."
    );
  }

  return {
    schemaVersion:
      SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION,
    profileId: requireNonEmptyString(
      record.profileId,
      "sceneIlluminationProfile.profileId"
    ),
    sceneId: requireNonEmptyString(
      record.sceneId,
      "sceneIlluminationProfile.sceneId"
    ),
    evidence: parseEvidenceList(
      record.evidence,
      "sceneIlluminationProfile.evidence"
    ),
    sources,
    sceneRadianceCalculated: false,
    materialResponseApplied: false,
    visibilityEvaluated: false,
    indirectTransportEvaluated: false,
    fluorescenceModeled: false,
    volumetricTransportModeled: false,
    polarizationModeled: false
  };
}
