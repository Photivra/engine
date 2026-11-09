// SPDX-License-Identifier: Apache-2.0

/**
 * Contracts for scene-radiance providers: the renderer or other code that reports how much
 * light leaves a scene point toward the camera.
 *
 * It covers material-response metadata, provider capability profiles, single evaluation
 * requests and results, and identity checks between them. The engine validates this data
 * but does not compute scene radiance itself.
 * @see docs/SCENE_RADIANCE_AND_ILLUMINATION.md for equations, coordinate/unit conventions, blockers
 * and support limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import {
  parseSpectralWavelengthBasis,
  parseSpectralWavelengthRangeNanometers,
  type SpectralWavelengthBasis,
  type SpectralWavelengthRangeNanometers
} from "../core/spectral.js";
import type {
  SceneIlluminationProfile
} from "./illumination.js";
import type {
  SceneIlluminationTemporalProfile
} from "./illumination-temporal.js";
import type { Vector3 } from "./scene.js";
import { requireInputObject, requireInputArray, requireInputKeys, rejectUnknownVariantFields, UNCERTAINTY_VARIANT_FIELDS, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigFiniteNumber as requireFinite, parseConfigLimitations as parseLimitations, requireConfigFraction as requireFraction, requireConfigNumberAtLeastZero as requireNonNegativeFinite } from "../core/record-validation.js";
import { hypot3 } from "../core/portable-math.js";
import { parseVector3 } from "./illumination.js";

type UnknownRecord = Record<string, unknown>;

export const SCENE_MATERIAL_RESPONSE_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;
export const SCENE_RADIANCE_PROVIDER_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;
export const SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION =
  "0.1.0" as const;

export type SceneRadianceScientificStatus =
  | "calibrated"
  | "approximation";

export type SceneRadianceUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };

export interface SceneRadianceDataArtifactReference {
  id: string;
  checksumSha256: string;
}

export type SceneMaterialResponseRepresentation =
  | {
      kind: "unresolved";
      limitation: string;
    }
  | {
      kind: "rgb-pbr-approximation";
      colorSpace: "linear-srgb";
      baseColor: {
        red: number;
        green: number;
        blue: number;
      };
      metallic: number;
      roughness: number;
      limitation: string;
    }
  | {
      kind: "spectral-wavelength-preserving-data";
      dataArtifact:
        SceneRadianceDataArtifactReference;
      wavelengthBasis:
        SpectralWavelengthBasis;
      wavelengthRangeNanometers:
        SpectralWavelengthRangeNanometers;
      scatteringModel:
        "provider-defined-wavelength-preserving";
      scientificStatus:
        SceneRadianceScientificStatus;
      uncertainty:
        SceneRadianceUncertainty;
      wavelengthChangingBehaviorModeled: false;
      emissionModeled: false;
    };

export interface SceneMaterialResponseDefinition {
  materialResponseId: string;
  evidence: readonly EvidenceProvenance[];
  representation:
    SceneMaterialResponseRepresentation;
}

export interface SceneMaterialResponseProfile {
  schemaVersion:
    typeof SCENE_MATERIAL_RESPONSE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  sceneId: string;
  evidence: readonly EvidenceProvenance[];
  materials:
    readonly SceneMaterialResponseDefinition[];
  fluorescenceModeled: false;
  volumetricMaterialTransportModeled: false;
  polarizationModeled: false;
}

export type SceneMaterialResponseFidelity =
  | "spectral-data"
  | "rgb-pbr-approximation"
  | "mixed"
  | "unresolved";

export type SceneRadianceProviderSpectralFidelity =
  | "wavelength-resolved"
  | "rgb-derived-approximation";

export type SceneRadianceProviderVisibilityFidelity =
  | "resolved"
  | "approximation"
  | "not-modeled";

export type SceneRadianceProviderTransportFidelity =
  | "resolved"
  | "approximation"
  | "not-modeled";

export interface SceneRadianceProviderProfile {
  schemaVersion:
    typeof SCENE_RADIANCE_PROVIDER_PROFILE_SCHEMA_VERSION;
  profileId: string;
  sceneId: string;
  illuminationProfileId: string;
  illuminationTemporalProfileId?: string;
  materialResponseProfileId: string;
  outputQuantity:
    "outgoing-spectral-radiance";
  outputUnit:
    "W/m^2/sr/nm";
  scientificStatus: "approximation";
  uncertainty: SceneRadianceUncertainty;
  fidelity: {
    spectral:
      SceneRadianceProviderSpectralFidelity;
    material:
      SceneMaterialResponseFidelity;
    visibility:
      SceneRadianceProviderVisibilityFidelity;
    directTransport:
      SceneRadianceProviderTransportFidelity;
    indirectTransport:
      SceneRadianceProviderTransportFidelity;
  };
  wavelengthChangingTransportModeled: false;
  volumetricTransportModeled: false;
  polarizationModeled: false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export type SceneRadianceEvaluationTarget =
  | {
      kind: "surface-point";
      sceneObjectId: string;
      materialResponseId: string;
      positionM: Vector3;
      outgoingDirectionUnitVector: Vector3;
    }
  | {
      kind: "environment-direction";
      outgoingDirectionUnitVector: Vector3;
    };

export interface SceneRadianceEvaluationRequest {
  schemaVersion:
    typeof SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION;
  sampleId: string;
  providerProfileId: string;
  sceneId: string;
  illuminationProfileId: string;
  materialResponseProfileId: string;
  target: SceneRadianceEvaluationTarget;
  timeSecondsFromExposureStart: number;
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<SpectralWavelengthBasis, "unspecified">;
}

export interface SceneRadianceEvaluationResult {
  schemaVersion:
    typeof SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION;
  sampleId: string;
  providerProfileId: string;
  sceneId: string;
  wavelengthNanometers: number;
  wavelengthBasis:
    Exclude<SpectralWavelengthBasis, "unspecified">;
  quantity:
    "outgoing-spectral-radiance";
  unit: "W/m^2/sr/nm";
  spectralRadianceWattsPerSquareMeterSteradianNanometer:
    number;
  scientificStatus: "approximation";
  uncertainty: SceneRadianceUncertainty;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface ValidateSceneRadianceEvaluationBindingsInput {
  providerProfile: SceneRadianceProviderProfile;
  illuminationProfile: SceneIlluminationProfile;
  illuminationTemporalProfile?:
    SceneIlluminationTemporalProfile;
  materialResponseProfile:
    SceneMaterialResponseProfile;
  request: SceneRadianceEvaluationRequest;
  result: SceneRadianceEvaluationResult;
}

export interface SceneRadianceEvaluationBindingAssessment {
  providerBindingsMatched: true;
  requestResultIdentityMatched: true;
  materialResponseFidelity:
    SceneMaterialResponseFidelity;
  temporalIlluminationProfileBound:
    boolean;
  calibratedRadianceClaimAuthorized: false;
  sensorPlaneIrradianceCalculated: false;
  opticsApplied: false;
  photonsCalculated: false;
}

function parseUnitDirection(
  value: unknown,
  path: string
): Vector3 {
  const vector = parseVector3(value, path);
  const length = hypot3(
    vector.x,
    vector.y,
    vector.z
  );
  if (
    !Number.isFinite(length) ||
    Math.abs(length - 1) > 1e-9
  ) {
    throw new InvalidConfigurationError(
      path +
        " must be a unit-length direction vector."
    );
  }
  return vector;
}

function parseUncertainty(
  value: unknown,
  path: string
): SceneRadianceUncertainty {
  const record = requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", UNCERTAINTY_VARIANT_FIELDS, path);
  if (record.kind === "relative") {
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

function parseArtifact(
  value: unknown,
  path: string
): SceneRadianceDataArtifactReference {
  const record = requireRecord(value, path, ["checksumSha256", "id"]);
  const checksumSha256 =
    requireNonEmptyString(
      record.checksumSha256,
      path + ".checksumSha256"
    );
  if (
    !/^[a-f0-9]{64}$/iu.test(
      checksumSha256
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        ".checksumSha256 must be a 64-character SHA-256 hex digest."
    );
  }
  return {
    id: requireNonEmptyString(
      record.id,
      path + ".id"
    ),
    checksumSha256:
      checksumSha256.toLowerCase()
  };
}

function parseMaterialRepresentation(
  value: unknown,
  path: string
): SceneMaterialResponseRepresentation {
  const record = requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", {
    unresolved: ["kind", "limitation"],
    "rgb-pbr-approximation": ["kind", "colorSpace", "baseColor", "metallic", "roughness", "limitation"],
    "spectral-wavelength-preserving-data": ["kind", "dataArtifact", "wavelengthBasis", "wavelengthRangeNanometers", "scatteringModel",
      "scientificStatus", "uncertainty", "wavelengthChangingBehaviorModeled", "emissionModeled"]
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
    "rgb-pbr-approximation"
  ) {
    if (record.colorSpace !== "linear-srgb") {
      throw new InvalidConfigurationError(
        path +
          '.colorSpace must be "linear-srgb".'
      );
    }
    const baseColor = requireRecord(
      record.baseColor,
      path + ".baseColor", ["red", "green", "blue"]
    );
    return {
      kind: "rgb-pbr-approximation",
      colorSpace: "linear-srgb",
      baseColor: {
        red: requireFraction(
          baseColor.red,
          path + ".baseColor.red"
        ),
        green: requireFraction(
          baseColor.green,
          path + ".baseColor.green"
        ),
        blue: requireFraction(
          baseColor.blue,
          path + ".baseColor.blue"
        )
      },
      metallic: requireFraction(
        record.metallic,
        path + ".metallic"
      ),
      roughness: requireFraction(
        record.roughness,
        path + ".roughness"
      ),
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      )
    };
  }

  if (
    record.kind !==
    "spectral-wavelength-preserving-data"
  ) {
    throw new InvalidConfigurationError(
      path + ".kind is invalid."
    );
  }

  if (
    record.scatteringModel !==
    "provider-defined-wavelength-preserving"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.scatteringModel must be "provider-defined-wavelength-preserving".'
    );
  }
  if (
    record.scientificStatus !==
      "calibrated" &&
    record.scientificStatus !==
      "approximation"
  ) {
    throw new InvalidConfigurationError(
      path + ".scientificStatus is invalid."
    );
  }
  const scientificStatus =
    record.scientificStatus;
  const wavelengthBasis =
    parseSpectralWavelengthBasis(
      record.wavelengthBasis,
      path + ".wavelengthBasis"
    );
  const uncertainty = parseUncertainty(
    record.uncertainty,
    path + ".uncertainty"
  );
  if (
    scientificStatus === "calibrated" &&
    wavelengthBasis === "unspecified"
  ) {
    throw new InvalidConfigurationError(
      path +
        " calibrated spectral material data requires an air or vacuum wavelength basis."
    );
  }
  if (
    scientificStatus === "calibrated" &&
    uncertainty.kind !== "relative"
  ) {
    throw new InvalidConfigurationError(
      path +
        " calibrated spectral material data requires quantified relative uncertainty."
    );
  }
  if (
    record.wavelengthChangingBehaviorModeled !==
    false
  ) {
    throw new InvalidConfigurationError(
      path +
        ".wavelengthChangingBehaviorModeled must be false in schema 0.1.0."
    );
  }
  if (record.emissionModeled !== false) {
    throw new InvalidConfigurationError(
      path +
        ".emissionModeled must be false in schema 0.1.0."
    );
  }

  return {
    kind:
      "spectral-wavelength-preserving-data",
    dataArtifact: parseArtifact(
      record.dataArtifact,
      path + ".dataArtifact"
    ),
    wavelengthBasis,
    wavelengthRangeNanometers:
      parseSpectralWavelengthRangeNanometers(
        record.wavelengthRangeNanometers,
        path + ".wavelengthRangeNanometers"
      ),
    scatteringModel:
      "provider-defined-wavelength-preserving",
    scientificStatus,
    uncertainty,
    wavelengthChangingBehaviorModeled:
      false,
    emissionModeled: false
  };
}

/**
 * Parses material-response metadata used by a scene-radiance provider.
 *
 * RGB or PBR (physically based rendering) material data is always an approximation.
 * Spectral data is a per-wavelength provider input. It does not itself compute a BSDF
 * (how a surface scatters light), scene radiance, fluorescence, emission, volumetric
 * effects or polarization.
 */
export function parseSceneMaterialResponseProfile(
  value: unknown
): SceneMaterialResponseProfile {
  const record = requireRecord(
    value,
    "sceneMaterialResponseProfile", ["schemaVersion", "materials", "fluorescenceModeled", "volumetricMaterialTransportModeled", "polarizationModeled", "profileId", "sceneId", "evidence"]
  );
  if (
    record.schemaVersion !==
    SCENE_MATERIAL_RESPONSE_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sceneMaterialResponseProfile.schemaVersion must be "' +
        SCENE_MATERIAL_RESPONSE_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (!Array.isArray(record.materials)) {
    throw new InvalidConfigurationError(
      "sceneMaterialResponseProfile.materials must be an array."
    );
  }

  const materials = record.materials.map(
    (entry, index) => {
      const path =
        "sceneMaterialResponseProfile.materials[" +
        index +
        "]";
      const material = requireRecord(
        entry,
        path, ["materialResponseId", "evidence", "representation"]
      );
      return {
        materialResponseId:
          requireNonEmptyString(
            material.materialResponseId,
            path + ".materialResponseId"
          ),
        evidence: parseEvidenceList(
          material.evidence,
          path + ".evidence"
        ),
        representation:
          parseMaterialRepresentation(
            material.representation,
            path + ".representation"
          )
      };
    }
  );
  const ids = materials.map(
    (entry) => entry.materialResponseId
  );
  if (new Set(ids).size !== ids.length) {
    throw new InvalidConfigurationError(
      "sceneMaterialResponseProfile.materials[].materialResponseId must not contain duplicates."
    );
  }

  if (record.fluorescenceModeled !== false) {
    throw new InvalidConfigurationError(
      "sceneMaterialResponseProfile.fluorescenceModeled must be false in schema 0.1.0."
    );
  }
  if (
    record.volumetricMaterialTransportModeled !==
    false
  ) {
    throw new InvalidConfigurationError(
      "sceneMaterialResponseProfile.volumetricMaterialTransportModeled must be false in schema 0.1.0."
    );
  }
  if (record.polarizationModeled !== false) {
    throw new InvalidConfigurationError(
      "sceneMaterialResponseProfile.polarizationModeled must be false in schema 0.1.0."
    );
  }

  return {
    schemaVersion:
      SCENE_MATERIAL_RESPONSE_PROFILE_SCHEMA_VERSION,
    profileId: requireNonEmptyString(
      record.profileId,
      "sceneMaterialResponseProfile.profileId"
    ),
    sceneId: requireNonEmptyString(
      record.sceneId,
      "sceneMaterialResponseProfile.sceneId"
    ),
    evidence: parseEvidenceList(
      record.evidence,
      "sceneMaterialResponseProfile.evidence"
    ),
    materials,
    fluorescenceModeled: false,
    volumetricMaterialTransportModeled:
      false,
    polarizationModeled: false
  };
}

/**
 * Returns the material fidelity a profile supports, choosing the lower level when in doubt.
 */
export function assessSceneMaterialResponseFidelity(
  profile: SceneMaterialResponseProfile
): SceneMaterialResponseFidelity {
  requireInputObject(profile, "assessSceneMaterialResponseFidelity input");
  // 2.0.0: the whole profile is validated, so an unknown field at any level is rejected.
  parseSceneMaterialResponseProfile(profile);
  requireInputArray(profile.materials, "profile.materials");
  if (
    profile.materials.some(
      (entry) =>
        entry.representation.kind ===
        "unresolved"
    )
  ) {
    return "unresolved";
  }

  const kinds = new Set(
    profile.materials.map(
      (entry) => entry.representation.kind
    )
  );
  if (
    kinds.size === 0 ||
    kinds.has("unresolved")
  ) {
    return "unresolved";
  }
  if (
    kinds.size === 1 &&
    kinds.has(
      "spectral-wavelength-preserving-data"
    )
  ) {
    return "spectral-data";
  }
  if (
    kinds.size === 1 &&
    kinds.has("rgb-pbr-approximation")
  ) {
    return "rgb-pbr-approximation";
  }
  return "mixed";
}

function parseProviderFidelity(
  value: unknown,
  path: string
): SceneRadianceProviderProfile["fidelity"] {
  const record = requireRecord(value, path, ["spectral", "material", "visibility", "directTransport", "indirectTransport"]);
  const spectral = record.spectral;
  if (
    spectral !== "wavelength-resolved" &&
    spectral !==
      "rgb-derived-approximation"
  ) {
    throw new InvalidConfigurationError(
      path + ".spectral is invalid."
    );
  }
  const material = record.material;
  if (
    material !== "spectral-data" &&
    material !== "rgb-pbr-approximation" &&
    material !== "mixed" &&
    material !== "unresolved"
  ) {
    throw new InvalidConfigurationError(
      path + ".material is invalid."
    );
  }
  const parseVisibility = (
    candidate: unknown,
    candidatePath: string
  ): SceneRadianceProviderVisibilityFidelity => {
    if (
      candidate !== "resolved" &&
      candidate !== "approximation" &&
      candidate !== "not-modeled"
    ) {
      throw new InvalidConfigurationError(
        candidatePath + " is invalid."
      );
    }
    return candidate;
  };
  const parseTransport = (
    candidate: unknown,
    candidatePath: string
  ): SceneRadianceProviderTransportFidelity => {
    if (
      candidate !== "resolved" &&
      candidate !== "approximation" &&
      candidate !== "not-modeled"
    ) {
      throw new InvalidConfigurationError(
        candidatePath + " is invalid."
      );
    }
    return candidate;
  };

  return {
    spectral,
    material,
    visibility: parseVisibility(
      record.visibility,
      path + ".visibility"
    ),
    directTransport: parseTransport(
      record.directTransport,
      path + ".directTransport"
    ),
    indirectTransport: parseTransport(
      record.indirectTransport,
      path + ".indirectTransport"
    )
  };
}

/**
 * Parses a provider's declaration of what it can do (its profile). Works with any renderer.
 *
 * Schema 0.1.0 is approximation-only by design. A provider may use calibrated inputs,
 * but this contract cannot support a claim of calibrated outgoing radiance. That needs
 * later work on complete spectral and light-transport models.
 */
export function parseSceneRadianceProviderProfile(
  value: unknown
): SceneRadianceProviderProfile {
  const record = requireRecord(
    value,
    "sceneRadianceProviderProfile", ["schemaVersion", "outputQuantity", "outputUnit", "scientificStatus", "wavelengthChangingTransportModeled", "volumetricTransportModeled", "polarizationModeled", "profileId", "sceneId", "illuminationProfileId", "illuminationTemporalProfileId", "materialResponseProfileId", "uncertainty", "fidelity", "evidence", "limitations"]
  );
  if (
    record.schemaVersion !==
    SCENE_RADIANCE_PROVIDER_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceProviderProfile.schemaVersion must be "' +
        SCENE_RADIANCE_PROVIDER_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.outputQuantity !==
    "outgoing-spectral-radiance"
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceProviderProfile.outputQuantity must be "outgoing-spectral-radiance".'
    );
  }
  if (record.outputUnit !== "W/m^2/sr/nm") {
    throw new InvalidConfigurationError(
      'sceneRadianceProviderProfile.outputUnit must be "W/m^2/sr/nm".'
    );
  }
  if (
    record.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceProviderProfile.scientificStatus must be "approximation" in schema 0.1.0.'
    );
  }
  if (
    record.wavelengthChangingTransportModeled !==
    false ||
    record.volumetricTransportModeled !==
    false ||
    record.polarizationModeled !== false
  ) {
    throw new InvalidConfigurationError(
      "sceneRadianceProviderProfile wavelength-changing, volumetric, and polarization transport flags must all be false in schema 0.1.0."
    );
  }

  return {
    schemaVersion:
      SCENE_RADIANCE_PROVIDER_PROFILE_SCHEMA_VERSION,
    profileId: requireNonEmptyString(
      record.profileId,
      "sceneRadianceProviderProfile.profileId"
    ),
    sceneId: requireNonEmptyString(
      record.sceneId,
      "sceneRadianceProviderProfile.sceneId"
    ),
    illuminationProfileId:
      requireNonEmptyString(
        record.illuminationProfileId,
        "sceneRadianceProviderProfile.illuminationProfileId"
      ),
    ...(record.illuminationTemporalProfileId ===
    undefined
      ? {}
      : {
          illuminationTemporalProfileId:
            requireNonEmptyString(
              record.illuminationTemporalProfileId,
              "sceneRadianceProviderProfile.illuminationTemporalProfileId"
            )
        }),
    materialResponseProfileId:
      requireNonEmptyString(
        record.materialResponseProfileId,
        "sceneRadianceProviderProfile.materialResponseProfileId"
      ),
    outputQuantity:
      "outgoing-spectral-radiance",
    outputUnit: "W/m^2/sr/nm",
    scientificStatus: "approximation",
    uncertainty: parseUncertainty(
      record.uncertainty,
      "sceneRadianceProviderProfile.uncertainty"
    ),
    fidelity: parseProviderFidelity(
      record.fidelity,
      "sceneRadianceProviderProfile.fidelity"
    ),
    wavelengthChangingTransportModeled:
      false,
    volumetricTransportModeled: false,
    polarizationModeled: false,
    evidence: parseEvidenceList(
      record.evidence,
      "sceneRadianceProviderProfile.evidence"
    ),
    limitations: parseLimitations(
      record.limitations,
      "sceneRadianceProviderProfile.limitations"
    )
  };
}

function parsePositiveWavelengthNanometers(
  value: unknown,
  path: string
): number {
  const wavelength = requireFinite(
    value,
    path
  );
  if (wavelength <= 0) {
    throw new InvalidConfigurationError(
      path + " must be greater than zero."
    );
  }
  return wavelength;
}

function parseResolvedWavelengthBasis(
  value: unknown,
  path: string
): Exclude<
  SpectralWavelengthBasis,
  "unspecified"
> {
  const basis = parseSpectralWavelengthBasis(
    value,
    path
  );
  if (basis === "unspecified") {
    throw new InvalidConfigurationError(
      path +
        " must be air or vacuum for outgoing spectral radiance."
    );
  }
  return basis;
}

function parseEvaluationTarget(
  value: unknown,
  path: string
): SceneRadianceEvaluationTarget {
  const record = requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", {
    "surface-point": ["kind", "sceneObjectId", "materialResponseId", "positionM", "outgoingDirectionUnitVector"],
    "environment-direction": ["kind", "outgoingDirectionUnitVector"]
  }, path);
  if (record.kind === "surface-point") {
    return {
      kind: "surface-point",
      sceneObjectId: requireNonEmptyString(
        record.sceneObjectId,
        path + ".sceneObjectId"
      ),
      materialResponseId:
        requireNonEmptyString(
          record.materialResponseId,
          path + ".materialResponseId"
        ),
      positionM: parseVector3(
        record.positionM,
        path + ".positionM"
      ),
      outgoingDirectionUnitVector:
        parseUnitDirection(
          record.outgoingDirectionUnitVector,
          path +
            ".outgoingDirectionUnitVector"
        )
    };
  }
  if (
    record.kind ===
    "environment-direction"
  ) {
    return {
      kind: "environment-direction",
      outgoingDirectionUnitVector:
        parseUnitDirection(
          record.outgoingDirectionUnitVector,
          path +
            ".outgoingDirectionUnitVector"
        )
    };
  }
  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

/**
 * Parses one provider evaluation request at an explicit scene target,
 * physical time, wavelength, and outgoing direction.
 */
export function parseSceneRadianceEvaluationRequest(
  value: unknown
): SceneRadianceEvaluationRequest {
  const record = requireRecord(
    value,
    "sceneRadianceEvaluationRequest", ["schemaVersion", "sampleId", "providerProfileId", "sceneId", "illuminationProfileId", "materialResponseProfileId", "target", "timeSecondsFromExposureStart", "wavelengthNanometers", "wavelengthBasis"]
  );
  if (
    record.schemaVersion !==
    SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceEvaluationRequest.schemaVersion must be "' +
        SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION +
        '".'
    );
  }

  return {
    schemaVersion:
      SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION,
    sampleId: requireNonEmptyString(
      record.sampleId,
      "sceneRadianceEvaluationRequest.sampleId"
    ),
    providerProfileId:
      requireNonEmptyString(
        record.providerProfileId,
        "sceneRadianceEvaluationRequest.providerProfileId"
      ),
    sceneId: requireNonEmptyString(
      record.sceneId,
      "sceneRadianceEvaluationRequest.sceneId"
    ),
    illuminationProfileId:
      requireNonEmptyString(
        record.illuminationProfileId,
        "sceneRadianceEvaluationRequest.illuminationProfileId"
      ),
    materialResponseProfileId:
      requireNonEmptyString(
        record.materialResponseProfileId,
        "sceneRadianceEvaluationRequest.materialResponseProfileId"
      ),
    target: parseEvaluationTarget(
      record.target,
      "sceneRadianceEvaluationRequest.target"
    ),
    timeSecondsFromExposureStart:
      requireNonNegativeFinite(
        record.timeSecondsFromExposureStart,
        "sceneRadianceEvaluationRequest.timeSecondsFromExposureStart"
      ),
    wavelengthNanometers:
      parsePositiveWavelengthNanometers(
        record.wavelengthNanometers,
        "sceneRadianceEvaluationRequest.wavelengthNanometers"
      ),
    wavelengthBasis:
      parseResolvedWavelengthBasis(
        record.wavelengthBasis,
        "sceneRadianceEvaluationRequest.wavelengthBasis"
      )
  };
}

/**
 * Parses one outgoing spectral-radiance result from a provider.
 *
 * The number is accepted as the provider reported it. Parsing checks units, that the
 * value is finite and nonnegative, provenance and identity fields. It does not prove
 * the provider's light-transport calculation is physically correct.
 */
export function parseSceneRadianceEvaluationResult(
  value: unknown
): SceneRadianceEvaluationResult {
  const record = requireRecord(
    value,
    "sceneRadianceEvaluationResult", SCENE_RADIANCE_EVALUATION_RESULT_KEYS
  );
  return parseSceneRadianceEvaluationResultRecord(record, undefined);
}

const SCENE_RADIANCE_EVALUATION_RESULT_KEYS = ["schemaVersion", "quantity", "unit", "scientificStatus", "sampleId", "providerProfileId", "sceneId", "wavelengthNanometers", "wavelengthBasis", "spectralRadianceWattsPerSquareMeterSteradianNanometer", "uncertainty", "evidence", "limitations"] as const;

/** An earlier fully parsed result whose deep-frozen uncertainty, evidence and limitations records may be reused. */
export interface ValidatedSceneRadianceRecords {
  readonly uncertainty: unknown;
  readonly evidence: unknown;
  readonly limitations: unknown;
  readonly parsed: SceneRadianceEvaluationResult;
}

/**
 * Internal (2.6; not exported from the package): parses a result of an engine-built evaluator
 * (`isInternalSceneRadianceEvaluator`). It runs every check of `parseSceneRadianceEvaluationResult` with the same
 * helpers, order and messages (object shape, schema version, quantity, unit, status, the three identifiers, the
 * wavelength, its basis and the radiance value) except two: the scan for unknown keys, and re-parsing uncertainty,
 * evidence and limitations when they are the very (deep-frozen) objects of `validated`, an earlier result that
 * passed the full parse. Any other result takes the full parse.
 */
export function parseSceneRadianceEvaluationResultWithValidatedRecords(
  value: unknown,
  validated: ValidatedSceneRadianceRecords
): SceneRadianceEvaluationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return parseSceneRadianceEvaluationResult(value);
  const record = value as UnknownRecord;
  if (record.uncertainty !== validated.uncertainty || record.evidence !== validated.evidence || record.limitations !== validated.limitations) {
    return parseSceneRadianceEvaluationResult(value);
  }
  return parseSceneRadianceEvaluationResultRecord(record, validated.parsed);
}

function parseSceneRadianceEvaluationResultRecord(
  record: UnknownRecord,
  validated: SceneRadianceEvaluationResult | undefined
): SceneRadianceEvaluationResult {
  if (
    record.schemaVersion !==
    SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceEvaluationResult.schemaVersion must be "' +
        SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.quantity !==
    "outgoing-spectral-radiance"
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceEvaluationResult.quantity must be "outgoing-spectral-radiance".'
    );
  }
  if (record.unit !== "W/m^2/sr/nm") {
    throw new InvalidConfigurationError(
      'sceneRadianceEvaluationResult.unit must be "W/m^2/sr/nm".'
    );
  }
  if (
    record.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceEvaluationResult.scientificStatus must be "approximation" in schema 0.1.0.'
    );
  }

  return {
    schemaVersion:
      SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION,
    sampleId: requireNonEmptyString(
      record.sampleId,
      "sceneRadianceEvaluationResult.sampleId"
    ),
    providerProfileId:
      requireNonEmptyString(
        record.providerProfileId,
        "sceneRadianceEvaluationResult.providerProfileId"
      ),
    sceneId: requireNonEmptyString(
      record.sceneId,
      "sceneRadianceEvaluationResult.sceneId"
    ),
    wavelengthNanometers:
      parsePositiveWavelengthNanometers(
        record.wavelengthNanometers,
        "sceneRadianceEvaluationResult.wavelengthNanometers"
      ),
    wavelengthBasis:
      parseResolvedWavelengthBasis(
        record.wavelengthBasis,
        "sceneRadianceEvaluationResult.wavelengthBasis"
      ),
    quantity:
      "outgoing-spectral-radiance",
    unit: "W/m^2/sr/nm",
    spectralRadianceWattsPerSquareMeterSteradianNanometer:
      requireNonNegativeFinite(
        record.spectralRadianceWattsPerSquareMeterSteradianNanometer,
        "sceneRadianceEvaluationResult.spectralRadianceWattsPerSquareMeterSteradianNanometer"
      ),
    scientificStatus: "approximation",
    uncertainty: validated ? validated.uncertainty : parseUncertainty(
      record.uncertainty,
      "sceneRadianceEvaluationResult.uncertainty"
    ),
    evidence: validated ? validated.evidence : parseEvidenceList(
      record.evidence,
      "sceneRadianceEvaluationResult.evidence"
    ),
    limitations: validated ? validated.limitations : parseLimitations(
      record.limitations,
      "sceneRadianceEvaluationResult.limitations"
    )
  };
}

function requireEqual(
  actual: unknown,
  expected: unknown,
  message: string
): void {
  if (actual !== expected) {
    throw new InvalidConfigurationError(
      message
    );
  }
}

/**
 * Internal (#453; not exported from the package): the request and result checks of
 * {@link validateSceneRadianceEvaluationBindings} (the request against the three profiles, a surface target's material, and
 * the result against the request), with its messages and order. The profile-to-profile checks before them depend only on the
 * profiles; an engine caller that has run the full function once for these profile objects may run only this part for
 * further requests and results.
 */
export function validateSceneRadianceRequestResultBindings(
  providerProfile: ValidateSceneRadianceEvaluationBindingsInput["providerProfile"],
  illuminationProfile: ValidateSceneRadianceEvaluationBindingsInput["illuminationProfile"],
  materialResponseProfile: ValidateSceneRadianceEvaluationBindingsInput["materialResponseProfile"],
  request: ValidateSceneRadianceEvaluationBindingsInput["request"],
  result: ValidateSceneRadianceEvaluationBindingsInput["result"]
): void {
  requireEqual(
    request.providerProfileId,
    providerProfile.profileId,
    "Request providerProfileId must match the supplied provider profile."
  );
  requireEqual(
    request.sceneId,
    providerProfile.sceneId,
    "Request sceneId must match the supplied provider profile."
  );
  requireEqual(
    request.illuminationProfileId,
    illuminationProfile.profileId,
    "Request illuminationProfileId must match the supplied illumination profile."
  );
  requireEqual(
    request.materialResponseProfileId,
    materialResponseProfile.profileId,
    "Request materialResponseProfileId must match the supplied material-response profile."
  );

  if (request.target.kind === "surface-point") {
    const target = request.target;
    if (
      !materialResponseProfile.materials.some(
        (material) =>
          material.materialResponseId ===
          target.materialResponseId
      )
    ) {
      throw new InvalidConfigurationError(
        "Request surface target materialResponseId is not declared by the supplied material-response profile."
      );
    }
  }

  requireEqual(
    result.sampleId,
    request.sampleId,
    "Result sampleId must match the request."
  );
  requireEqual(
    result.providerProfileId,
    request.providerProfileId,
    "Result providerProfileId must match the request."
  );
  requireEqual(
    result.sceneId,
    request.sceneId,
    "Result sceneId must match the request."
  );
  requireEqual(
    result.wavelengthNanometers,
    request.wavelengthNanometers,
    "Result wavelengthNanometers must match the request exactly."
  );
  requireEqual(
    result.wavelengthBasis,
    request.wavelengthBasis,
    "Result wavelengthBasis must match the request."
  );
}

/**
 * Checks that a provider result matches its request and profile identities exactly.
 *
 * It never recomputes the radiance value, and never upgrades the provider's
 * approximation to calibrated radiometry.
 */
export function validateSceneRadianceEvaluationBindings(
  input:
    ValidateSceneRadianceEvaluationBindingsInput
): SceneRadianceEvaluationBindingAssessment {
  requireInputKeys(input, "validateSceneRadianceEvaluationBindings", ["providerProfile", "illuminationProfile", "illuminationTemporalProfile", "materialResponseProfile", "request", "result"]);
  const {
    providerProfile,
    illuminationProfile,
    illuminationTemporalProfile,
    materialResponseProfile,
    request,
    result
  } = input;

  requireInputObject(providerProfile, "providerProfile input");
  requireEqual(
    providerProfile.sceneId,
    illuminationProfile.sceneId,
    "Provider and illumination profiles must reference the same sceneId."
  );
  requireEqual(
    providerProfile.sceneId,
    materialResponseProfile.sceneId,
    "Provider and material-response profiles must reference the same sceneId."
  );
  requireEqual(
    providerProfile.illuminationProfileId,
    illuminationProfile.profileId,
    "Provider illuminationProfileId must match the supplied illumination profile."
  );
  requireEqual(
    providerProfile.materialResponseProfileId,
    materialResponseProfile.profileId,
    "Provider materialResponseProfileId must match the supplied material-response profile."
  );

  if (
    providerProfile
      .illuminationTemporalProfileId ===
    undefined
  ) {
    if (
      illuminationTemporalProfile !==
      undefined
    ) {
      throw new InvalidConfigurationError(
        "A temporal illumination profile was supplied but the provider profile does not bind one."
      );
    }
  } else {
    if (
      illuminationTemporalProfile ===
      undefined
    ) {
      throw new InvalidConfigurationError(
        "Provider illuminationTemporalProfileId requires the matching temporal illumination profile."
      );
    }
    requireEqual(
      providerProfile
        .illuminationTemporalProfileId,
      illuminationTemporalProfile
        .profileId,
      "Provider illuminationTemporalProfileId must match the supplied temporal illumination profile."
    );
    requireEqual(
      providerProfile.sceneId,
      illuminationTemporalProfile.sceneId,
      "Provider and temporal illumination profiles must reference the same sceneId."
    );
    requireEqual(
      providerProfile
        .illuminationProfileId,
      illuminationTemporalProfile
        .illuminationProfileId,
      "Temporal illumination profile must bind the provider's illuminationProfileId."
    );
  }

  const materialResponseFidelity =
    assessSceneMaterialResponseFidelity(
      materialResponseProfile
    );
  requireEqual(
    providerProfile.fidelity.material,
    materialResponseFidelity,
    "Provider material fidelity must match the supplied material-response profile."
  );

  validateSceneRadianceRequestResultBindings(providerProfile, illuminationProfile, materialResponseProfile, request, result);

  return {
    providerBindingsMatched: true,
    requestResultIdentityMatched: true,
    materialResponseFidelity,
    temporalIlluminationProfileBound:
      illuminationTemporalProfile !==
      undefined,
    calibratedRadianceClaimAuthorized: false,
    sensorPlaneIrradianceCalculated:
      false,
    opticsApplied: false,
    photonsCalculated: false
  };
}
