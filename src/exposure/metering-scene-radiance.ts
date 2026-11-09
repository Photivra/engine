// SPDX-License-Identifier: Apache-2.0

/**
 * Links scene radiance to metering.
 *
 * The profile parser reads the declared approximation that turns renderer or provider scene data into
 * the single relative linear values the meter uses. The profile does not support any claim of
 * calibrated luminance or of a spectral-to-photometric conversion.
 *
 * The sample-set function builds a set of relative pre-exposure meter samples tied to one validated
 * scene-radiance provider context. The caller or renderer still supplies the relative sample values.
 * This bridge only checks identity and timing. It does not convert spectral radiance into luminance,
 * and it does not define a calibrated meter spectral response.
 * @see docs/USAGE.md for the equations, units, coordinate conventions, known blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type {
  ResolvedCaptureGeometry
} from "../output/capture-geometry.js";
import {
  assessSceneMaterialResponseFidelity,
  type SceneMaterialResponseProfile,
  type SceneRadianceProviderProfile
} from "../schema/scene-radiance.js";
import type {
  SceneIlluminationProfile
} from "../schema/illumination.js";
import type {
  SceneIlluminationTemporalProfile
} from "../schema/illumination-temporal.js";
import type {
  ExposureMeteringSampleSet,
  ExposureMeteringZoneSample
} from "./metering.js";
import { requireInputKeys, requireInputObject, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireInputFinite as requireFinite } from "../core/record-validation.js";


export const SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION =
  "0.1.0" as const;

export interface SceneRadianceMeteringDerivationProfile {
  schemaVersion:
    typeof SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION;
  derivationId: string;
  scientificStatus: "approximation";
  method:
    "renderer-provided-pre-exposure-relative-reduction";
  spectralWeighting:
    "not-calibrated";
  evidence: readonly EvidenceProvenance[];
  limitation: string;
}

export type SceneRadianceMeteringTemporalContext =
  | {
      kind: "time-invariant";
    }
  | {
      kind:
        "registered-time-varying";
      illuminationTemporalProfileId:
        string;
      timeReference:
        "first-opening-boundary-phase";
      captureTimeSecondsFromReference:
        number;
    };

export interface SceneRadianceMeteringSourceContext {
  kind:
    "scene-radiance-provider-derived-relative";
  sceneId: string;
  sceneStateId: string;
  providerProfileId: string;
  illuminationProfileId: string;
  materialResponseProfileId: string;
  derivationProfileId: string;
  providerScientificStatus:
    SceneRadianceProviderProfile["scientificStatus"];
  materialResponseFidelity:
    ReturnType<
      typeof assessSceneMaterialResponseFidelity
    >;
  temporal:
    SceneRadianceMeteringTemporalContext;
  spectralReductionCalibrated: false;
  calibratedLuminanceClaimAuthorized:
    false;
  calibratedSceneRadianceClaimAuthorized:
    false;
}

export interface SceneRadianceDerivedExposureMeteringSampleSet
  extends ExposureMeteringSampleSet {
  sourceContext:
    SceneRadianceMeteringSourceContext;
}

export interface CreateSceneRadianceDerivedExposureMeteringSampleSetInput {
  measurementId: string;
  sceneStateId: string;
  providerProfile:
    SceneRadianceProviderProfile;
  illuminationProfile:
    SceneIlluminationProfile;
  materialResponseProfile:
    SceneMaterialResponseProfile;
  illuminationTemporalProfile?:
    SceneIlluminationTemporalProfile;
  captureTimeSecondsFromReference?: number;
  captureGeometry:
    ResolvedCaptureGeometry;
  derivationProfile:
    SceneRadianceMeteringDerivationProfile;
  samples:
    readonly ExposureMeteringZoneSample[];
}

/**
 * Parses the declared approximation that turns renderer or provider scene data
 * into the single relative linear values the meter uses.
 *
 * The profile does not support any claim of calibrated luminance or of a
 * spectral-to-photometric conversion.
 */
export function parseSceneRadianceMeteringDerivationProfile(
  value: unknown
): SceneRadianceMeteringDerivationProfile {
  const record = requireRecord(
    value,
    "sceneRadianceMeteringDerivationProfile", ["schemaVersion", "scientificStatus", "method", "spectralWeighting", "derivationId", "evidence", "limitation"]
  );

  if (
    record.schemaVersion !==
    SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceMeteringDerivationProfile.schemaVersion must be "' +
        SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceMeteringDerivationProfile.scientificStatus must be "approximation" in schema 0.1.0.'
    );
  }
  if (
    record.method !==
    "renderer-provided-pre-exposure-relative-reduction"
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceMeteringDerivationProfile.method must be "renderer-provided-pre-exposure-relative-reduction".'
    );
  }
  if (
    record.spectralWeighting !==
    "not-calibrated"
  ) {
    throw new InvalidConfigurationError(
      'sceneRadianceMeteringDerivationProfile.spectralWeighting must be "not-calibrated" in schema 0.1.0.'
    );
  }

  return {
    schemaVersion:
      SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION,
    derivationId:
      requireNonEmptyString(
        record.derivationId,
        "sceneRadianceMeteringDerivationProfile.derivationId"
      ),
    scientificStatus: "approximation",
    method:
      "renderer-provided-pre-exposure-relative-reduction",
    spectralWeighting:
      "not-calibrated",
    evidence: parseEvidenceList(
      record.evidence,
      "sceneRadianceMeteringDerivationProfile.evidence"
    ),
    limitation:
      requireNonEmptyString(
        record.limitation,
        "sceneRadianceMeteringDerivationProfile.limitation"
      )
  };
}

function validateProviderContext(
  input:
    CreateSceneRadianceDerivedExposureMeteringSampleSetInput
): ReturnType<
  typeof assessSceneMaterialResponseFidelity
> {
  const {
    providerProfile,
    illuminationProfile,
    illuminationTemporalProfile,
    materialResponseProfile
  } = input;
  requireInputObject(providerProfile, "providerProfile");
  requireInputObject(providerProfile.fidelity, "providerProfile.fidelity");
  requireInputObject(illuminationProfile, "illuminationProfile");
  requireInputObject(materialResponseProfile, "materialResponseProfile");
  if (illuminationTemporalProfile !== undefined) requireInputObject(illuminationTemporalProfile, "illuminationTemporalProfile");

  if (
    providerProfile.sceneId !==
    illuminationProfile.sceneId
  ) {
    throw new InvalidScientificInputError(
      "Provider and illumination profiles must reference the same sceneId."
    );
  }
  if (
    providerProfile.sceneId !==
    materialResponseProfile.sceneId
  ) {
    throw new InvalidScientificInputError(
      "Provider and material-response profiles must reference the same sceneId."
    );
  }
  if (
    providerProfile.illuminationProfileId !==
    illuminationProfile.profileId
  ) {
    throw new InvalidScientificInputError(
      "Provider illuminationProfileId must match the supplied illumination profile."
    );
  }
  if (
    providerProfile.materialResponseProfileId !==
    materialResponseProfile.profileId
  ) {
    throw new InvalidScientificInputError(
      "Provider materialResponseProfileId must match the supplied material-response profile."
    );
  }

  const materialResponseFidelity =
    assessSceneMaterialResponseFidelity(
      materialResponseProfile
    );
  if (
    providerProfile.fidelity.material !==
    materialResponseFidelity
  ) {
    throw new InvalidScientificInputError(
      "Provider material fidelity must match the supplied material-response profile."
    );
  }

  if (
    providerProfile
      .illuminationTemporalProfileId ===
    undefined
  ) {
    if (
      illuminationTemporalProfile !==
      undefined
    ) {
      throw new InvalidScientificInputError(
        "A temporal illumination profile was supplied but the provider profile does not bind one."
      );
    }
    if (
      input
        .captureTimeSecondsFromReference !==
      undefined
    ) {
      throw new InvalidScientificInputError(
        "captureTimeSecondsFromReference must be omitted for a time-invariant provider context."
      );
    }
    return materialResponseFidelity;
  }

  if (
    illuminationTemporalProfile ===
    undefined
  ) {
    throw new InvalidScientificInputError(
      "Provider illuminationTemporalProfileId requires the matching temporal illumination profile."
    );
  }
  if (
    providerProfile
      .illuminationTemporalProfileId !==
    illuminationTemporalProfile.profileId
  ) {
    throw new InvalidScientificInputError(
      "Provider illuminationTemporalProfileId must match the supplied temporal illumination profile."
    );
  }
  if (
    providerProfile.sceneId !==
    illuminationTemporalProfile.sceneId
  ) {
    throw new InvalidScientificInputError(
      "Provider and temporal illumination profiles must reference the same sceneId."
    );
  }
  if (
    providerProfile
      .illuminationProfileId !==
    illuminationTemporalProfile
      .illuminationProfileId
  ) {
    throw new InvalidScientificInputError(
      "Temporal illumination profile must bind the provider's illuminationProfileId."
    );
  }

  if (!Array.isArray(illuminationProfile.sources) || !Array.isArray(illuminationTemporalProfile.sourceBindings)) {
    throw new InvalidConfigurationError("illuminationProfile.sources and illuminationTemporalProfile.sourceBindings must be arrays.");
  }
  illuminationProfile.sources.forEach((entry, index) => requireInputObject(entry, "illuminationProfile.sources[" + index + "]"));
  illuminationTemporalProfile.sourceBindings.forEach((entry, index) => requireInputObject(entry, "illuminationTemporalProfile.sourceBindings[" + index + "]"));
  const knownSourceIds =
    new Set(
      illuminationProfile.sources.map(
        (entry) => entry.sourceId
      )
    );
  for (
    const binding of
    illuminationTemporalProfile
      .sourceBindings
  ) {
    if (
      !knownSourceIds.has(
        binding.sourceId
      )
    ) {
      throw new InvalidScientificInputError(
        "Temporal illumination source binding references a sourceId that is not declared by the illumination profile."
      );
    }
  }
  if (
    input
      .captureTimeSecondsFromReference ===
    undefined
  ) {
    throw new InvalidScientificInputError(
      "Time-varying scene-radiance metering requires an explicit captureTimeSecondsFromReference."
    );
  }
  requireFinite(
    input.captureTimeSecondsFromReference,
    "captureTimeSecondsFromReference"
  );

  return materialResponseFidelity;
}

/**
 * Builds a set of relative pre-exposure meter samples tied to one validated
 * scene-radiance provider context.
 *
 * The caller or renderer still supplies the relative sample values. This
 * bridge only checks identity and timing. It does not convert spectral
 * radiance into luminance, and it does not define a calibrated meter spectral
 * response.
 */
export function createSceneRadianceDerivedExposureMeteringSampleSet(
  input:
    CreateSceneRadianceDerivedExposureMeteringSampleSetInput
): SceneRadianceDerivedExposureMeteringSampleSet {
  requireInputKeys(input, "createSceneRadianceDerivedExposureMeteringSampleSet", ["measurementId", "sceneStateId", "providerProfile", "illuminationProfile", "materialResponseProfile", "illuminationTemporalProfile", "captureTimeSecondsFromReference", "captureGeometry", "derivationProfile", "samples"]);
  const derivationProfile =
    parseSceneRadianceMeteringDerivationProfile(
      input.derivationProfile
    );
  const materialResponseFidelity =
    validateProviderContext(input);

  if (
    typeof input.measurementId !==
      "string" ||
    input.measurementId.trim().length ===
      0
  ) {
    throw new InvalidConfigurationError(
      "measurementId must be a non-empty string."
    );
  }
  if (
    typeof input.sceneStateId !==
      "string" ||
    input.sceneStateId.trim().length ===
      0
  ) {
    throw new InvalidConfigurationError(
      "sceneStateId must be a non-empty string."
    );
  }
  if (
    !Array.isArray(input.samples) ||
    input.samples.length === 0
  ) {
    throw new InvalidConfigurationError(
      "samples must be a non-empty array."
    );
  }

  const temporal:
    SceneRadianceMeteringTemporalContext =
    input.providerProfile
      .illuminationTemporalProfileId ===
    undefined
      ? {
          kind: "time-invariant"
        }
      : {
          kind:
            "registered-time-varying",
          illuminationTemporalProfileId:
            input.providerProfile
              .illuminationTemporalProfileId,
          timeReference:
            "first-opening-boundary-phase",
          captureTimeSecondsFromReference:
            input
              .captureTimeSecondsFromReference!
        };

  return {
    measurementId:
      input.measurementId.trim(),
    sceneStateId:
      input.sceneStateId.trim(),
    inputDomain:
      "relative-pre-exposure-linear-signal",
    captureRegion:
      "oriented-active-capture",
    captureGeometry:
      input.captureGeometry,
    processingState: {
      exposureSettingsApplied: false,
      whiteBalanceApplied: false,
      toneMappingApplied: false,
      displayGammaApplied: false,
      sharpeningApplied: false
    },
    samples: input.samples,
    sourceContext: {
      kind:
        "scene-radiance-provider-derived-relative",
      sceneId:
        input.providerProfile.sceneId,
      sceneStateId:
        input.sceneStateId.trim(),
      providerProfileId:
        input.providerProfile.profileId,
      illuminationProfileId:
        input.illuminationProfile.profileId,
      materialResponseProfileId:
        input.materialResponseProfile
          .profileId,
      derivationProfileId:
        derivationProfile.derivationId,
      providerScientificStatus:
        input.providerProfile
          .scientificStatus,
      materialResponseFidelity,
      temporal,
      spectralReductionCalibrated:
        false,
      calibratedLuminanceClaimAuthorized:
        false,
      calibratedSceneRadianceClaimAuthorized:
        false
    }
  };
}
