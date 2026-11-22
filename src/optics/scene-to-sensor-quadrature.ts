// SPDX-License-Identifier: Apache-2.0

/**
 * Runs the existing paraxial scene-to-sensor optical bridge at every requested sample node.
 *
 * Before it returns physical samples in W/m²/nm, it checks that the node identities, grid coverage
 * and provider bindings match exactly. Image coordinates come from the spatial plan, so a caller
 * cannot attach a field-throughput result computed at a different point.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { parseSceneIlluminationProfile } from "../schema/illumination.js";
import { parseSceneIlluminationTemporalProfile } from "../schema/illumination-temporal.js";
import { parseSceneMaterialResponseProfile, parseSceneRadianceProviderProfile,
  parseSceneRadianceEvaluationRequest, parseSceneRadianceEvaluationResult,
  validateSceneRadianceEvaluationBindings, type ValidateSceneRadianceEvaluationBindingsInput } from "../schema/scene-radiance.js";
import { bindSensorSpatioSpectralSamples, reduceSensorSpatioSpectralIrradiance,
  type ReduceSensorSpatioSpectralIrradianceInput, type SensorSpatioSpectralNodeIdentity } from "../sensor/spatio-spectral-reduction.js";
import { sensorSpatialQuadratureNodeIdentityKey } from "../sensor/spatial-sample-reduction.js";
import { calculateSceneRadianceToSensorIrradiance, type CalculateSceneRadianceToSensorIrradianceInput } from "./scene-to-sensor-irradiance.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";

/**
 * One declared scene query and its result, for one exact spatial and wavelength node before the
 * anti-aliasing (AA) filter.
 */
export interface SceneSensorQuadratureSample {
  node: SensorSpatioSpectralNodeIdentity;
  sceneRadianceRequest: CalculateSceneRadianceToSensorIrradianceInput["sceneRadianceRequest"];
  sceneRadianceResult: CalculateSceneRadianceToSensorIrradianceInput["sceneRadianceResult"];
  fieldThroughput: CalculateSceneRadianceToSensorIrradianceInput["fieldThroughput"];
}

/** Static point-sample bridge. PSF blur and motion over time are handled elsewhere. */
export interface CalculateSceneToSensorIrradianceQuadratureInput {
  spatialQuadrature: ReduceSensorSpatioSpectralIrradianceInput["spatialQuadrature"];
  spectralQuadrature: ReduceSensorSpatioSpectralIrradianceInput["spectralQuadrature"];
  /** Provider, illumination and material identities with their evidence. Parsed before use. */
  sceneBindings: Omit<ValidateSceneRadianceEvaluationBindingsInput, "request" | "result">;
  /** One declared lens/focus/filter state shared by every node. */
  optics: Omit<CalculateSceneRadianceToSensorIrradianceInput,
    "sceneRadianceRequest" | "sceneRadianceResult" | "imagePointMm" | "fieldThroughput">;
  /** One non-negative instant shared by all queries. This is not an integral over the exposure. */
  timeSecondsFromExposureStart: number;
  /** Every combination of the grid axes, with a unique scene sampleId per node. */
  samples: readonly SceneSensorQuadratureSample[];
}

export interface SceneToSensorIrradianceQuadrature {
  sourcePlane: "sensor-package-incident";
  outputMeaning: "pre-sensor-stack-pre-aa-irradiance-quadrature";
  sourceTargetProjectionVerified: false;
  sceneProviderExecutionVerified: false;
  psfRedistributionApplied: false;
  temporalIntegrationApplied: false;
  irradianceSamples: ReduceSensorSpatioSpectralIrradianceInput["sampleValues"];
  reduction: ReturnType<typeof reduceSensorSpatioSpectralIrradiance>;
  samples: readonly {
    node: SensorSpatioSpectralNodeIdentity;
    /** Physical source coordinate, in mm, before the anti-aliasing filter spreads it. */
    preAntiAliasingSourcePointMm: { x: number; y: number };
    /** The provider's declared target and time. This is not a verified ray intersection. */
    request: SceneSensorQuadratureSample["sceneRadianceRequest"];
    result: SceneSensorQuadratureSample["sceneRadianceResult"];
    bindings: ReturnType<typeof validateSceneRadianceEvaluationBindings>;
    optics: ReturnType<typeof calculateSceneRadianceToSensorIrradiance>;
  }[];
}

/**
 * Runs the existing paraxial optical bridge at every requested node.
 *
 * Before it returns physical W/m²/nm samples, it checks that node identities,
 * grid coverage and provider bindings match exactly. Image coordinates come
 * from the spatial plan, so a caller cannot attach a field-throughput result
 * computed at a different point.
 */
export function calculateSceneToSensorIrradianceQuadrature(
  input: CalculateSceneToSensorIrradianceQuadratureInput
): CalculationResult<SceneToSensorIrradianceQuadrature> {
  requireInputKeys(input, "calculateSceneToSensorIrradianceQuadrature", ["spatialQuadrature", "spectralQuadrature", "sceneBindings", "optics", "timeSecondsFromExposureStart", "samples"]);
  if (!Number.isFinite(input.timeSecondsFromExposureStart) || input.timeSecondsFromExposureStart < 0) {
    throw new InvalidScientificInputError("Quadrature sample time must be finite and nonnegative.");
  }
  const bound = bindSensorSpatioSpectralSamples({ ...input, sampleValues: input.samples }, sample => sample);
  // 2.28.0 (#726): a missing record is a domain error, not a TypeError from a property read.
  requireInputObject(input.sceneBindings, "sceneBindings");
  const sceneBindings = {
    providerProfile: parseSceneRadianceProviderProfile(input.sceneBindings.providerProfile),
    illuminationProfile: parseSceneIlluminationProfile(input.sceneBindings.illuminationProfile),
    materialResponseProfile: parseSceneMaterialResponseProfile(input.sceneBindings.materialResponseProfile),
    ...(input.sceneBindings.illuminationTemporalProfile === undefined ? {} : {
      illuminationTemporalProfile: parseSceneIlluminationTemporalProfile(input.sceneBindings.illuminationTemporalProfile)
    })
  };
  if (sceneBindings.providerProfile.fidelity.spectral !== "wavelength-resolved") {
    throw new InvalidScientificInputError("Physical irradiance quadrature requires wavelength-resolved provider fidelity.");
  }
  const samples: SceneToSensorIrradianceQuadrature["samples"][number][] = [];
  const irradianceSamples: ReduceSensorSpatioSpectralIrradianceInput["sampleValues"][number][] = [];
  const sampleIds = new Set<string>();
  // Sort into the plan's canonical order so shuffled input gives the same diagnostics.
  for (const spectral of input.spectralQuadrature.nodes) {
    for (const spatial of input.spatialQuadrature.nodes) {
      const spatialNode = { antiAliasingComponentIndex: spatial.antiAliasingComponentIndex,
        apertureSampleXIndex: spatial.apertureSampleXIndex, apertureSampleYIndex: spatial.apertureSampleYIndex };
      const key = sensorSpatialQuadratureNodeIdentityKey(spatialNode) + "|" + spectral.spectralSampleIndex;
      const sample = bound.valuesByKey.get(key)!;
      const request = parseSceneRadianceEvaluationRequest(sample.sceneRadianceRequest);
      const result = parseSceneRadianceEvaluationResult(sample.sceneRadianceResult);
      if (request.wavelengthNanometers !== spectral.wavelengthNanometers ||
        request.wavelengthBasis !== input.spectralQuadrature.wavelengthBasis ||
        request.timeSecondsFromExposureStart !== input.timeSecondsFromExposureStart) {
        throw new InvalidScientificInputError("Scene request must match its exact quadrature wavelength, basis and time.");
      }
      if (sampleIds.has(request.sampleId)) {
        throw new InvalidScientificInputError("Each quadrature node requires its own scene sampleId.");
      }
      sampleIds.add(request.sampleId);
      const bindings = validateSceneRadianceEvaluationBindings({ ...sceneBindings, request, result });
      const optics = calculateSceneRadianceToSensorIrradiance({ ...input.optics,
        sceneRadianceRequest: request, sceneRadianceResult: result,
        imagePointMm: spatial.preAntiAliasingSourcePointMm, fieldThroughput: sample.fieldThroughput });
      const node = { spatialNode, spectralSampleIndex: spectral.spectralSampleIndex,
        wavelengthNanometers: spectral.wavelengthNanometers };
      samples.push({ node, preAntiAliasingSourcePointMm: { ...spatial.preAntiAliasingSourcePointMm }, request, result, bindings, optics });
      irradianceSamples.push({ node, spectralIrradianceWattsPerSquareMeterPerNanometer:
        optics.value.sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer });
    }
  }
  const reduction = reduceSensorSpatioSpectralIrradiance({ spatialQuadrature: input.spatialQuadrature,
    spectralQuadrature: input.spectralQuadrature, sampleValues: irradianceSamples });
  return approximationResult({ sourcePlane: "sensor-package-incident",
    outputMeaning: "pre-sensor-stack-pre-aa-irradiance-quadrature", sourceTargetProjectionVerified: false,
    sceneProviderExecutionVerified: false, psfRedistributionApplied: false, temporalIntegrationApplied: false,
    irradianceSamples, reduction, samples }, "scene-to-sensor-irradiance-quadrature", "0.1.0", [
    "Scene targets and provider radiance remain declared approximations; projection/transport are not verified.",
    "Paraxial optics is evaluated once per pre-AA node; PSF redistribution and exposure integration are not applied.",
    "Output is sensor-package-incident; downstream response scope must match that plane."
  ]);
}
