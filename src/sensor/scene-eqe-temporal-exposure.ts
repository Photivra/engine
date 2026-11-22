// SPDX-License-Identifier: Apache-2.0

/**
 * Photo signal for one site over one exposure, starting from declared scene radiance: paraxial
 * (small-angle) optics, then the EQE (external quantum efficiency) response, at every exact local
 * shutter midpoint time.
 *
 * Light is never averaged before the response checks. No projection, renderer, PSF (point-spread
 * function), charge, noise or production stage runs.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { calculateSceneToSensorIrradianceQuadrature,
  type CalculateSceneToSensorIrradianceQuadratureInput } from "../optics/scene-to-sensor-quadrature.js";
import { calculateSensorEqeTemporalExposure, type CalculateSensorEqeTemporalExposureInput } from "./eqe-temporal-exposure.js";
import { calculateSensorSpatialSamplingQuadrature } from "./spatial-sampling-quadrature.js";
import { calculateSensorSpectralQuadrature } from "./spectral-quadrature.js";
import { bindSensorTemporalSamples } from "./temporal-sample-binding.js";
import { requireInputKeys } from "../core/record-validation.js";

/** Input: declared physical scene radiance at every spatial position, wavelength and local shutter midpoint time. */
export interface CalculateSceneSensorEqeTemporalExposureInput {
  /** One destination site, its response and one local shutter event. No constant-rate declaration is needed. */
  sensor: Omit<CalculateSensorEqeTemporalExposureInput, "samples">;
  sceneBindings: CalculateSceneToSensorIrradianceQuadratureInput["sceneBindings"];
  optics: CalculateSceneToSensorIrradianceQuadratureInput["optics"];
  /** States that scene query times are seconds from the shutter's first opening boundary. */
  timeReference: "first-opening-boundary-phase";
  samples: readonly {
    temporalSampleIndex: number;
    timeSecondsFromOpeningReference: number;
    sceneSamples: CalculateSceneToSensorIrradianceQuadratureInput["samples"];
  }[];
}

/** Result. The optical and sensor results each keep their own approximation labels and evidence. */
export interface SceneSensorEqeTemporalExposure {
  sourcePlane: "sensor-package-incident";
  sourceTargetProjectionVerified: false;
  sceneProviderExecutionVerified: false;
  psfRedistributionApplied: false;
  opticalSamples: readonly {
    temporalSampleIndex: number;
    timeSecondsFromOpeningReference: number;
    optics: ReturnType<typeof calculateSceneToSensorIrradianceQuadrature>;
  }[];
  exposure: ReturnType<typeof calculateSensorEqeTemporalExposure>;
}

/**
 * Runs declared scene radiance through paraxial optics and the instantaneous EQE
 * response at every exact local shutter midpoint time. Light is never averaged
 * before the response checks. No projection, renderer, PSF, charge, noise or
 * production stage runs.
 */
export function calculateSceneSensorEqeTemporalExposure(
  input: CalculateSceneSensorEqeTemporalExposureInput
): CalculationResult<SceneSensorEqeTemporalExposure> {
  requireInputKeys(input, "calculateSceneSensorEqeTemporalExposure", ["sensor", "sceneBindings", "optics", "timeReference", "samples"]);
  if (input.timeReference !== "first-opening-boundary-phase") {
    throw new InvalidScientificInputError("Scene samples must use the explicit first-opening-boundary-phase time reference.");
  }
  if (input.sensor?.responseApplication.sourcePlane.value !== "sensor-package-incident") {
    throw new InvalidScientificInputError("Scene optical output requires a sensor-package-incident response application.");
  }
  // Check the total declared work against its limit before any per-instant optical calculation.
  const ordered = bindSensorTemporalSamples(input.samples, sample => sample.sceneSamples);
  const spatialQuadrature = calculateSensorSpatialSamplingQuadrature({ ...input.sensor.spatialSampling,
    colorSamplingProfile: input.sensor.colorSamplingProfile,
    colorSamplingBindingProfile: input.sensor.localExposure.bindingProfile,
    nativeRaster: input.sensor.localExposure.exposureWindowInput.nativeRaster }).value;
  const spectralQuadrature = calculateSensorSpectralQuadrature({ ...input.sensor.spectralSampling,
    colorSamplingProfile: input.sensor.colorSamplingProfile,
    spectralResponseProfile: input.sensor.spectralResponseProfile }).value;
  const sampleIds = new Set<string>();
  const opticalSamples = ordered.map(sample => {
    const optics = calculateSceneToSensorIrradianceQuadrature({ spatialQuadrature, spectralQuadrature,
      sceneBindings: input.sceneBindings, optics: input.optics,
      timeSecondsFromExposureStart: sample.timeSecondsFromOpeningReference, samples: sample.sceneSamples });
    for (const node of optics.value.samples) {
      if (sampleIds.has(node.request.sampleId)) {
        throw new InvalidScientificInputError("Scene sampleId must be unique across the complete temporal quadrature.");
      }
      sampleIds.add(node.request.sampleId);
    }
    return { temporalSampleIndex: sample.temporalSampleIndex,
      timeSecondsFromOpeningReference: sample.timeSecondsFromOpeningReference, optics };
  });
  const exposure = calculateSensorEqeTemporalExposure({ ...input.sensor,
    samples: opticalSamples.map(sample => ({ temporalSampleIndex: sample.temporalSampleIndex,
      timeSecondsFromOpeningReference: sample.timeSecondsFromOpeningReference,
      irradianceSamples: sample.optics.value.irradianceSamples })) });
  return approximationResult({ sourcePlane: "sensor-package-incident", sourceTargetProjectionVerified: false,
    sceneProviderExecutionVerified: false, psfRedistributionApplied: false, opticalSamples, exposure
  }, "scene-sensor-eqe-temporal-exposure", "0.1.0", [
    "Scene targets, visibility and provider transport remain declared; projection and PSF execution are not verified.",
    "Paraxial optical irradiance and EQE validity are evaluated independently at each local shutter midpoint.",
    "Child uncertainties are not combined; no quadrature convergence bound or production activation is asserted."
  ]);
}
