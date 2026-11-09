// SPDX-License-Identifier: Apache-2.0

/**
 * Scene radiance over an exposure window, in two steps.
 *
 * 1. Plan: list the times (nodes) at which a scene-radiance provider (a renderer or other
 *    source of scene light) must report radiance during one local exposure window.
 * 2. Reduce: combine the provider's per-wavelength results over that window.
 *
 * Each returned sample must match its planned node, time and result identity exactly.
 * Uncertainty stays per node and is not combined, because no correlation or independence
 * is assumed.
 * @see docs/SCENE_RADIANCE_AND_ILLUMINATION.md for equations, coordinate/unit conventions, blockers
 * and support limits.
 */

import { InvalidScientificInputError, requirePositiveInteger } from "../core/validation.js";
import type { RasterPoint } from "../output/capture-geometry.js";
import {
  parseSceneRadianceEvaluationRequest,
  parseSceneRadianceEvaluationResult,
  type SceneRadianceEvaluationRequest,
  type SceneRadianceEvaluationResult
} from "./scene-radiance.js";
import type {
  ResolvedCaptureModeTiming
} from "../sensor/capture-mode-timing.js";
import { requireInputKeys, requireTrimmedConfigString as requireNonEmptyString } from "../core/record-validation.js";
import { sameSite as samePoint } from "../core/shared-helpers.js";

export const SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION =
  "0.1.0" as const;

export interface SceneRadianceTemporalQuery {
  providerProfileId: string;
  sceneId: string;
  illuminationProfileId: string;
  materialResponseProfileId: string;
  target:
    SceneRadianceEvaluationRequest["target"];
  wavelengthNanometers: number;
  wavelengthBasis:
    SceneRadianceEvaluationRequest["wavelengthBasis"];
}

export interface CreateSceneRadianceTemporalSamplingPlanInput {
  planId: string;
  timing:
    ResolvedCaptureModeTiming;
  destinationPointNative:
    RasterPoint;
  temporalSampleCount: number;
  query:
    SceneRadianceTemporalQuery;
}

export interface SceneRadianceTemporalSamplingNode {
  nodeId: string;
  expectedResultSampleId: string;
  temporalSampleIndex: number;
  localExposurePhase: number;
  captureTimeSecondsFromReference:
    number;
  normalizedTimeWeight: number;
  timeMeasureSeconds: number;
}

export interface SceneRadianceTemporalSamplingPlan {
  version:
    typeof SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION;
  planId: string;
  timeReference:
    "first-opening-boundary-phase";
  timingProfileIdentity: {
    profileId: string;
    profileVersion: string;
    captureModeId: string;
  };
  destinationPointNative:
    RasterPoint;
  localExposureWindow: {
    startSecondsFromCaptureReference:
      number;
    endSecondsFromCaptureReference:
      number;
    durationSeconds: number;
  };
  temporalSampleCount: number;
  quadratureScheme:
    "uniform-midpoint";
  query:
    SceneRadianceTemporalQuery;
  nodes:
    readonly SceneRadianceTemporalSamplingNode[];
  providerMustEvaluateAtNodeCaptureTime:
    true;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
}

export interface SceneRadianceTemporalEvaluatedSample {
  nodeId: string;
  captureTimeSecondsFromReference:
    number;
  result:
    SceneRadianceEvaluationResult;
}

export interface ReduceSceneRadianceTemporalSamplesInput {
  plan:
    SceneRadianceTemporalSamplingPlan;
  samples:
    readonly SceneRadianceTemporalEvaluatedSample[];
}

export interface ReducedSceneRadianceTemporalExposure {
  version:
    typeof SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION;
  planId: string;
  timeReference:
    "first-opening-boundary-phase";
  localExposureWindow:
    SceneRadianceTemporalSamplingPlan["localExposureWindow"];
  temporalSampleCount: number;
  quadratureScheme:
    "uniform-midpoint";
  providerProfileId: string;
  sceneId: string;
  wavelengthNanometers: number;
  wavelengthBasis:
    SceneRadianceEvaluationRequest["wavelengthBasis"];
  quantity:
    "outgoing-spectral-radiance";
  averageSpectralRadianceWattsPerSquareMeterSteradianNanometer:
    number;
  integratedSpectralRadianceWattSecondsPerSquareMeterSteradianNanometer:
    number;
  nodes: readonly {
    nodeId: string;
    captureTimeSecondsFromReference:
      number;
    normalizedTimeWeight: number;
    timeMeasureSeconds: number;
    spectralRadianceWattsPerSquareMeterSteradianNanometer:
      number;
    evidence:
      SceneRadianceEvaluationResult["evidence"];
    uncertainty:
      SceneRadianceEvaluationResult["uncertainty"];
  }[];
  scientificStatus: "approximation";
  uncertaintyPropagation:
    "not-propagated";
  uncertaintyLimitation: string;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
}

function exposureForPoint(
  timing:
    ResolvedCaptureModeTiming,
  point:
    RasterPoint
): ResolvedCaptureModeTiming["exposureWindows"]["samples"][number] {
  const matches =
    timing.exposureWindows.samples.filter(
      (sample) =>
        samePoint(
          sample.pointNative,
          point
        )
    );
  if (matches.length !== 1) {
    throw new InvalidScientificInputError(
      "destinationPointNative must match exactly one committed exposure-window sample."
    );
  }
  return matches[0]!;
}

function parseQuery(
  query:
    SceneRadianceTemporalQuery
): SceneRadianceTemporalQuery {
  // Reuse the scene-radiance request parser for the shared scene and spectral
  // checks. The placeholder time it needs is not copied into the returned
  // temporal query, where it would be misleading.
  const parsed =
    parseSceneRadianceEvaluationRequest({
      schemaVersion: "0.1.0",
      sampleId:
        "temporal-query-validation",
      providerProfileId:
        query.providerProfileId,
      sceneId:
        query.sceneId,
      illuminationProfileId:
        query.illuminationProfileId,
      materialResponseProfileId:
        query.materialResponseProfileId,
      target:
        query.target,
      timeSecondsFromExposureStart:
        0,
      wavelengthNanometers:
        query.wavelengthNanometers,
      wavelengthBasis:
        query.wavelengthBasis
    });

  return {
    providerProfileId:
      parsed.providerProfileId,
    sceneId:
      parsed.sceneId,
    illuminationProfileId:
      parsed.illuminationProfileId,
    materialResponseProfileId:
      parsed.materialResponseProfileId,
    target:
      parsed.target,
    wavelengthNanometers:
      parsed.wavelengthNanometers,
    wavelengthBasis:
      parsed.wavelengthBasis
  };
}

/**
 * Plans the times (nodes) at which a scene-radiance provider must report radiance
 * during one local exposure window. Works with any renderer or provider.
 *
 * Capture time is a separate field, not the older request field
 * timeSecondsFromExposureStart. Providers must evaluate radiance at
 * node.captureTimeSecondsFromReference, measured from the first opening boundary.
 */
export function createSceneRadianceTemporalSamplingPlan(
  input:
    CreateSceneRadianceTemporalSamplingPlanInput
): SceneRadianceTemporalSamplingPlan {
  requireInputKeys(input, "createSceneRadianceTemporalSamplingPlan", ["planId", "timing", "destinationPointNative", "temporalSampleCount", "query"]);
  requirePositiveInteger(
    "temporalSampleCount",
    input.temporalSampleCount
  );
  const planId =
    requireNonEmptyString(
      input.planId,
      "planId"
    );
  const query =
    parseQuery(input.query);
  const exposure =
    exposureForPoint(
      input.timing,
      input
        .destinationPointNative
    );
  const duration =
    exposure
      .localExposureDurationSeconds;

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new InvalidScientificInputError(
      "Scene-radiance temporal sampling requires a positive finite local exposure duration."
    );
  }

  const normalizedTimeWeight =
    1 /
    input.temporalSampleCount;
  const timeMeasureSeconds =
    duration /
    input.temporalSampleCount;

  const nodes =
    Array.from(
      {
        length:
          input.temporalSampleCount
      },
      (
        _,
        temporalSampleIndex
      ) => {
        const localExposurePhase =
          (temporalSampleIndex +
            0.5) /
          input.temporalSampleCount;
        const captureTime =
          exposure
            .startOffsetSecondsFromOpeningReference +
          localExposurePhase *
            duration;
        return {
          nodeId:
            planId +
            ":node:" +
            temporalSampleIndex,
          expectedResultSampleId:
            planId +
            ":radiance:" +
            temporalSampleIndex,
          temporalSampleIndex,
          localExposurePhase,
          captureTimeSecondsFromReference:
            captureTime,
          normalizedTimeWeight,
          timeMeasureSeconds
        };
      }
    );

  return {
    version:
      SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION,
    planId,
    timeReference:
      "first-opening-boundary-phase",
    timingProfileIdentity: {
      profileId:
        input.timing
          .timingProfileId,
      profileVersion:
        input.timing
          .timingProfileVersion,
      captureModeId:
        input.timing
          .captureModeId
    },
    destinationPointNative: {
      ...input
        .destinationPointNative
    },
    localExposureWindow: {
      startSecondsFromCaptureReference:
        exposure
          .startOffsetSecondsFromOpeningReference,
      endSecondsFromCaptureReference:
        exposure
          .endOffsetSecondsFromOpeningReference,
      durationSeconds:
        duration
    },
    temporalSampleCount:
      input.temporalSampleCount,
    quadratureScheme:
      "uniform-midpoint",
    query,
    nodes,
    providerMustEvaluateAtNodeCaptureTime:
      true,
    sensorReadoutTimingUsedAsExposureTiming:
      false
  };
}

function sameTime(
  a: number,
  b: number
): boolean {
  const scale =
    Math.max(
      1,
      Math.abs(a),
      Math.abs(b)
    );
  return (
    Math.abs(a - b) <=
    Number.EPSILON *
      16 *
      scale
  );
}

/**
 * Combines the provider's per-wavelength scene radiance over the local exposure window.
 *
 * Each sample must match its planned node, time and result identity exactly.
 * Uncertainty stays per node and is not combined, because no correlation or
 * independence is assumed.
 */
export function reduceSceneRadianceTemporalSamples(
  input:
    ReduceSceneRadianceTemporalSamplesInput
): ReducedSceneRadianceTemporalExposure {
  requireInputKeys(input, "reduceSceneRadianceTemporalSamples", ["plan", "samples"]);
  if (
    !Array.isArray(
      input.samples
    ) ||
    input.samples.length !==
      input.plan.nodes.length
  ) {
    throw new InvalidScientificInputError(
      "samples must contain exactly one result for every temporal sampling node."
    );
  }

  const byNode =
    new Map(
      input.samples.map(
        (sample) => [
          sample.nodeId,
          sample
        ] as const
      )
    );
  if (
    byNode.size !==
    input.samples.length
  ) {
    throw new InvalidScientificInputError(
      "samples must not contain duplicate nodeId values."
    );
  }

  let average = 0;
  let integrated = 0;

  const nodes =
    input.plan.nodes.map(
      (node) => {
        const supplied =
          byNode.get(
            node.nodeId
          );
        if (supplied === undefined) {
          throw new InvalidScientificInputError(
            "A temporal scene-radiance node result is missing."
          );
        }
        if (
          !Number.isFinite(
            supplied
              .captureTimeSecondsFromReference
          ) ||
          !sameTime(
            supplied
              .captureTimeSecondsFromReference,
            node
              .captureTimeSecondsFromReference
          )
        ) {
          throw new InvalidScientificInputError(
            "Temporal scene-radiance sample time must match its authoritative plan node."
          );
        }

        const result =
          parseSceneRadianceEvaluationResult(
            supplied.result
          );
        if (
          result.sampleId !==
            node.expectedResultSampleId ||
          result.providerProfileId !==
            input.plan.query
              .providerProfileId ||
          result.sceneId !==
            input.plan.query
              .sceneId ||
          result.wavelengthNanometers !==
            input.plan.query
              .wavelengthNanometers ||
          result.wavelengthBasis !==
            input.plan.query
              .wavelengthBasis
        ) {
          throw new InvalidScientificInputError(
            "Temporal scene-radiance result identity must match the plan node/query exactly."
          );
        }

        const value =
          result
            .spectralRadianceWattsPerSquareMeterSteradianNanometer;
        average +=
          value *
          node
            .normalizedTimeWeight;
        integrated +=
          value *
          node
            .timeMeasureSeconds;

        return {
          nodeId:
            node.nodeId,
          captureTimeSecondsFromReference:
            node
              .captureTimeSecondsFromReference,
          normalizedTimeWeight:
            node
              .normalizedTimeWeight,
          timeMeasureSeconds:
            node
              .timeMeasureSeconds,
          spectralRadianceWattsPerSquareMeterSteradianNanometer:
            value,
          evidence:
            result.evidence,
          uncertainty:
            result.uncertainty
        };
      }
    );

  if (
    !Number.isFinite(average) ||
    average < 0 ||
    !Number.isFinite(
      integrated
    ) ||
    integrated < 0
  ) {
    throw new InvalidScientificInputError(
      "Reduced temporal scene radiance must remain finite and non-negative."
    );
  }

  return {
    version:
      SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION,
    planId:
      input.plan.planId,
    timeReference:
      "first-opening-boundary-phase",
    localExposureWindow: {
      ...input.plan
        .localExposureWindow
    },
    temporalSampleCount:
      input.plan
        .temporalSampleCount,
    quadratureScheme:
      "uniform-midpoint",
    providerProfileId:
      input.plan.query
        .providerProfileId,
    sceneId:
      input.plan.query.sceneId,
    wavelengthNanometers:
      input.plan.query
        .wavelengthNanometers,
    wavelengthBasis:
      input.plan.query
        .wavelengthBasis,
    quantity:
      "outgoing-spectral-radiance",
    averageSpectralRadianceWattsPerSquareMeterSteradianNanometer:
      average,
    integratedSpectralRadianceWattSecondsPerSquareMeterSteradianNanometer:
      integrated,
    nodes,
    scientificStatus:
      "approximation",
    uncertaintyPropagation:
      "not-propagated",
    uncertaintyLimitation:
      "Per-node scene-radiance uncertainty is preserved; aggregate numeric uncertainty is not propagated because temporal correlation is not assumed.",
    sensorReadoutTimingUsedAsExposureTiming:
      false
  };
}
