// SPDX-License-Identifier: Apache-2.0

/**
 * Photo signal for one sensor site from a scene-radiance provider (the "environment"): asks the
 * provider for radiance along each sampled direction, then applies optics and the sensor response.
 *
 * Work is split into a plan and an execution step. Planning checks spatial, spectral and temporal
 * coverage and builds an internal plan before any provider code runs. Each query gives an explicit
 * scene direction, a wavelength (air or vacuum) and a time in seconds from the shutter's opening
 * reference. Optical throughput, an optional local PSF (point-spread function) and the EQE (external
 * quantum efficiency) response then give the expected photo signal. Calling the provider does not
 * verify its light transport, visibility or calibration.
 * @see docs/ENVIRONMENT_RAW_CAPTURE.md for equations, coordinate/unit conventions, blockers and
 * support limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { freezeOwnedData } from "../core/owned-data.js";
import { requirePublicOpaqueId, requireInputKeys } from "../core/record-validation.js";
import { parseEvidenceList, type EvidenceProvenance } from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { parseSceneIlluminationProfile } from "../schema/illumination.js";
import { parseSceneIlluminationTemporalProfile } from "../schema/illumination-temporal.js";
import { parseSceneMaterialResponseProfile, parseSceneRadianceProviderProfile, parseSceneRadianceEvaluationResult,
  parseSceneRadianceEvaluationResultWithValidatedRecords, validateSceneRadianceEvaluationBindings, validateSceneRadianceRequestResultBindings,
  type SceneRadianceEvaluationRequest, type SceneRadianceEvaluationResult, type ValidatedSceneRadianceRecords } from "../schema/scene-radiance.js";
import { calculateMappedSensorEnvironmentRadianceQuery, calculateSensorEnvironmentRadianceQuery, prepareEnvironmentLensFieldMapping,
  type CalculateSensorEnvironmentRadianceQueryInput, type EnvironmentLensFieldMapping } from "../optics/sensor-environment-query.js";
import { calculateSceneRadianceToSensorIrradiance, prepareSceneRadianceToSensorIrradianceValue,
  type CalculateSceneRadianceToSensorIrradianceInput } from "../optics/scene-to-sensor-irradiance.js";
import { isDeeplyFrozen } from "../core/internal-radiance-evaluator.js";
import { calculateSensorPsfIrradianceQuadrature, type CalculateSensorPsfIrradianceQuadratureInput } from "../optics/sensor-psf-quadrature.js";
import { calculateIlluminationVignetting, type IlluminationVignettingProfile } from "../optics/illumination-vignetting.js";
import { calculateSensorApertureRays, type IdealCircularPupil, type SensorApertureRay } from "../optics/sensor-aperture-rays.js";
import { shakenAngularVelocity } from "../motion/camera-rotation.js";
import { sensorPsfSourcePoint } from "../optics/sensor-psf-support.js";
import { markEngineOwnedLensSampledPsfProfile, resolveLensSampledPsf } from "../optics/lens-psf-profile.js";
import { calculateSensorSpatialSamplingQuadrature } from "./spatial-sampling-quadrature.js";
import { calculateSensorSpectralQuadrature } from "./spectral-quadrature.js";
import { resolveNativeEffectiveRasterColorSamplingBinding } from "./capture-color-sampling-binding.js";
import { calculateCaptureExposureWindows } from "./exposure-window.js";
import { createSensorEqeTemporalPhotoSignal } from "./temporal-photo-signal.js";
import type { CalculateSensorEqeTemporalExposureInput } from "./eqe-temporal-exposure.js";
import type { CalculateSceneToSensorIrradianceQuadratureInput } from "../optics/scene-to-sensor-quadrature.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

/** Caller-supplied synchronous radiance function, run locally. Calling it does not prove its light transport is physical. */
export type EnvironmentRadianceEvaluator = (request: Readonly<SceneRadianceEvaluationRequest>) => SceneRadianceEvaluationResult;
export type EnvironmentApertureRadianceEvaluator = (request: Readonly<SceneRadianceEvaluationRequest>, apertureRay: Readonly<SensorApertureRay>) => SceneRadianceEvaluationResult;
export interface CalculateEnvironmentSensorPhotoSignalInput {
  temporalIntegrationId: string;
  sensor: Omit<CalculateSensorEqeTemporalExposureInput, "samples">;
  sceneBindings: CalculateSceneToSensorIrradianceQuadratureInput["sceneBindings"];
  optics: Omit<CalculateSceneRadianceToSensorIrradianceInput,
    "sceneRadianceRequest" | "sceneRadianceResult" | "imagePointMm" | "fieldThroughput">;
  motion: Pick<CalculateSensorEnvironmentRadianceQueryInput,
    "angularVelocityRadPerSec" | "timeReference" | "environmentDirectionConvention"> & {
    /** @internal #641: a hand-shake trajectory added to the rotation (`shakenAngularVelocity`); set by `simulateCapture`'s `motion.handheld`. */
    handShake?: readonly number[];
  };
  temporalSampleCount: number;
  /** Optional ideal circular pupil, for geometric depth of field (DOF) and visibility. Cannot be combined with a sampled PSF. */
  pupil?: IdealCircularPupil;
  /**
   * Optional lens field mapping (added in 2.0): a projection model and radial or Brown-Conrady
   * distortion for the scene-ray query. Its distortion area factor is applied to irradiance exactly
   * once. If omitted, the ideal rectilinear, distortion-free path is unchanged. Cannot be combined
   * with `pupil`.
   */
  lensFieldMapping?: EnvironmentLensFieldMapping;
  /** Explicit attenuation across the field (such as vignetting), applied once before the PSF spreads the light. */
  fieldThroughput: { kind: "unity"; evidence: readonly EvidenceProvenance[]; limitation: string } | {
    kind: "radial-illumination-vignetting"; profile: IlluminationVignettingProfile;
    evidence: readonly EvidenceProvenance[]; limitation: string;
  };
  psf: { kind: "not-applied"; evidence: readonly EvidenceProvenance[]; limitation: string } | {
    kind: "sampled-local";
    configuration: Pick<CalculateSensorPsfIrradianceQuadratureInput, "psf" | "psfWavelengthBasis" | "spatialModel">;
  };
  evaluateRadiance: EnvironmentRadianceEvaluator;
  /** Required with `pupil`: rays start at different points on the aperture, so a direction-only function cannot be used. */
  evaluateApertureRadiance?: EnvironmentApertureRadianceEvaluator;
}
export interface EnvironmentSensorPhotoSignal {
  sourceTargetProjectionCalculated: true;
  providerCallbackExecuted: true;
  providerTransportVerified: false;
  sceneVisibilityCalculated: false;
  productionPlanActivated: false;
  providerEvaluationCount: number;
  sourcePlane: "sensor-package-incident";
  fieldThroughputEvidence: readonly EvidenceProvenance[];
  fieldThroughputLimitation: string;
  psfOmission: { evidence: readonly EvidenceProvenance[]; limitation: string } | null;
  psfRedistributionApplied: boolean;
  pupilIntegrationApplied: boolean;
  pupilIntegrationProfile: IdealCircularPupil | null;
  photo: ReturnType<typeof createSensorEqeTemporalPhotoSignal>;
  instants: readonly {
    temporalSampleIndex: number;
    timeSecondsFromOpeningReference: number;
    psf: ReturnType<typeof calculateSensorPsfIrradianceQuadrature> | null;
    evaluations: readonly {
      query: ReturnType<typeof calculateSensorEnvironmentRadianceQuery>;
      result: SceneRadianceEvaluationResult;
      bindings: ReturnType<typeof validateSceneRadianceEvaluationBindings>;
      optics: ReturnType<typeof calculateSceneRadianceToSensorIrradiance>;
      apertureRay?: SensorApertureRay;
      apertureRequest?: SceneRadianceEvaluationRequest;
    }[];
  }[];
}

/** Internal plan, shared with the full-frame composer, so all work is bounded before any callback runs. */
interface EnvironmentPhotoPlan {
  owned: Omit<CalculateEnvironmentSensorPhotoSignalInput, "evaluateRadiance" | "evaluateApertureRadiance">;
  sceneBindings: CalculateSceneToSensorIrradianceQuadratureInput["sceneBindings"];
  fieldThroughputEvidence: readonly EvidenceProvenance[];
  spatialQuadrature: ReturnType<typeof calculateSensorSpatialSamplingQuadrature>["value"];
  spectralQuadrature: ReturnType<typeof calculateSensorSpectralQuadrature>["value"];
  count: number;
  focus: CalculateSensorEnvironmentRadianceQueryInput["focus"];
  instants: { temporalSampleIndex: number; time: number; groups: {
    node: CalculateSensorPsfIrradianceQuadratureInput["samples"][number]["node"];
    taps: { kernelSampleX: number; kernelSampleY: number; point: { x: number; y: number };
      /** Deep-frozen provider request of the planned query (the same object as query.value.request). */
      request: SceneRadianceEvaluationRequest;
      /** The planned query's image-plane source point (the same object as query.value.sourcePointImagePlaneMm). */
      sourcePointImagePlaneMm: { x: number; y: number };
      /** The complete query result. Kept only by "full" plans, whose per-evaluation records include it. */
      query?: ReturnType<typeof calculateSensorEnvironmentRadianceQuery>;
      apertureRays?: readonly SensorApertureRay[];
      /** 1 / det(d distorted / d ideal), the change in area from distortion. Present only with a lens field mapping. */
      distortionAreaFactor?: number;
      fieldThroughput: CalculateSceneRadianceToSensorIrradianceInput["fieldThroughput"] }[];
  }[] }[];
}
/**
 * Builds an internal execution plan covering all optical, spatial, spectral and temporal sampling,
 * without calling any provider code.
 *
 * Coverage is checked completely before any supplied radiance function runs. Each query gives an
 * explicit scene direction, a wavelength (air or vacuum) and seconds from the opening reference.
 * @param input - The photo-signal input without its radiance functions; see
 *   `CalculateEnvironmentSensorPhotoSignalInput`.
 * @param ownership - Internal. "copy" (default) makes a structured clone of the input. "engine-owned"
 * uses the input as the plan's own data without cloning again. Only engine callers that already hold a
 * private structured clone, never shown to supplied code and never changed afterwards, may pass it.
 * @param retention - Internal. "full" (default) keeps every planned query result for "full" execution
 * records. "photo-only" keeps only each query's frozen request and image-plane point, which is all that
 * photo-only execution reads. Every query is still computed and validated at plan time, so limit checks
 * and errors are unchanged.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function planEnvironmentSensorPhotoSignal(input: Omit<CalculateEnvironmentSensorPhotoSignalInput, "evaluateRadiance" | "evaluateApertureRadiance">,
  ownership: "copy" | "engine-owned" = "copy", retention: "full" | "photo-only" = "full"): EnvironmentPhotoPlan {
  const owned = ownership === "engine-owned" ? input : structuredClone(input);
  requirePublicOpaqueId(owned.temporalIntegrationId, "Environment integration requires a public identity.");
  if (!Number.isSafeInteger(owned.temporalSampleCount) || owned.temporalSampleCount < 1 || owned.temporalSampleCount > 256 ||
    owned.sensor?.responseApplication.sourcePlane.value !== "sensor-package-incident" ||
    (owned.fieldThroughput?.kind !== "unity" && owned.fieldThroughput?.kind !== "radial-illumination-vignetting") || typeof owned.fieldThroughput.limitation !== "string" || !owned.fieldThroughput.limitation.trim()) {
    throw new InvalidScientificInputError("Environment exposure requires package-incident response, 1..256 midpoints and explicit supported field throughput.");
  }
  if (owned.fieldThroughput.kind === "radial-illumination-vignetting" &&
    (typeof owned.fieldThroughput.profile !== "object" || owned.fieldThroughput.profile === null ||
      typeof owned.fieldThroughput.profile.coefficients !== "object" || owned.fieldThroughput.profile.coefficients === null)) {
    throw new InvalidScientificInputError("Radial throughput requires a declared profile and coefficients.");
  }
  const fieldThroughputEvidence = parseEvidenceList(owned.fieldThroughput.evidence, "environmentFieldThroughput.evidence");
  const sceneBindings = { providerProfile: parseSceneRadianceProviderProfile(owned.sceneBindings.providerProfile),
    illuminationProfile: parseSceneIlluminationProfile(owned.sceneBindings.illuminationProfile),
    materialResponseProfile: parseSceneMaterialResponseProfile(owned.sceneBindings.materialResponseProfile),
    ...(owned.sceneBindings.illuminationTemporalProfile === undefined ? {} : {
      illuminationTemporalProfile: parseSceneIlluminationTemporalProfile(owned.sceneBindings.illuminationTemporalProfile) }) };
  if (sceneBindings.providerProfile.fidelity.spectral !== "wavelength-resolved") throw new InvalidScientificInputError("Environment exposure requires wavelength-resolved provider fidelity.");
  const sensor = owned.sensor;
  const nativeRaster = sensor.localExposure.exposureWindowInput.nativeRaster;
  const binding = resolveNativeEffectiveRasterColorSamplingBinding({ nativeRaster, colorSamplingProfile: sensor.colorSamplingProfile,
    bindingProfile: sensor.localExposure.bindingProfile });
  if (binding.relationshipMeaning !== "one-native-effective-sample-to-one-color-site") throw new InvalidScientificInputError("Environment exposure requires explicit one-to-one native/color timing.");
  const spatialQuadrature = calculateSensorSpatialSamplingQuadrature({ ...sensor.spatialSampling, nativeRaster,
    colorSamplingProfile: sensor.colorSamplingProfile, colorSamplingBindingProfile: sensor.localExposure.bindingProfile }).value;
  const spectralQuadrature = calculateSensorSpectralQuadrature({ ...sensor.spectralSampling,
    colorSamplingProfile: sensor.colorSamplingProfile, spectralResponseProfile: sensor.spectralResponseProfile }).value;
  if (spectralQuadrature.wavelengthBasis === "unspecified") throw new InvalidScientificInputError("Environment spectral basis must be explicit.");
  const wavelengthBasis = spectralQuadrature.wavelengthBasis;
  const site = sensor.spatialSampling.site;
  const window = calculateCaptureExposureWindows({ ...sensor.localExposure.exposureWindowInput,
    samplePointsNative: [{ x: site.x+.5, y: site.y+.5 }] }).value.samples[0]!;
  const focus = owned.optics.focus.kind === "infinity-focus" ? { kind: "infinity" as const } :
    owned.optics.focus.kind === "ideal-symmetric-thin-lens" ? { kind: "finite" as const, distanceM: owned.optics.focus.objectDistanceM } :
    owned.optics.focus.focus.kind === "infinity" ? { kind: "infinity" as const } : { kind: "finite" as const, distanceM: owned.optics.focus.focus.objectDistanceM };
  if (owned.psf.kind === "not-applied") {
    parseEvidenceList(owned.psf.evidence, "environmentPsfOmission.evidence");
    if (typeof owned.psf.limitation !== "string" || !owned.psf.limitation.trim()) throw new InvalidScientificInputError("PSF omission needs an explicit limitation.");
  } else if (owned.psf.kind !== "sampled-local") throw new InvalidConfigurationError("Unknown environment PSF selection.");
  if (owned.psf.kind === "sampled-local") {
    const p = owned.psf.configuration.psf;
    // The profile belongs only to this plan, so its parse can be cached across nodes and time instants.
    markEngineOwnedLensSampledPsfProfile(p.profile);
    if (p.focalLengthMm !== owned.optics.focalLengthMm || p.apertureFNumber !== owned.optics.nominalFNumber ||
      p.focus.kind !== focus.kind || (p.focus.kind === "finite" && focus.kind === "finite" && p.focus.distanceM !== focus.distanceM)) {
      throw new InvalidScientificInputError("PSF and optical focal/aperture/focus state must match exactly.");
    }
  }
  if (owned.pupil !== undefined && owned.psf.kind !== "not-applied") throw new InvalidScientificInputError("Ideal pupil integration cannot mix with a sampled PSF; geometric defocus would be ambiguous.");
  const lensMapping = owned.lensFieldMapping === undefined ? undefined : prepareEnvironmentLensFieldMapping(owned.lensFieldMapping);
  if (lensMapping !== undefined && owned.pupil !== undefined) {
    throw new InvalidScientificInputError("Ideal pupil rays use the rectilinear distortion-free projection and cannot combine with a lens field mapping.");
  }
  const pupilCount = owned.pupil === undefined ? 1 : calculateSensorApertureRays({sourcePointNativeSensorMm:{x:0,y:0},
    focalLengthMm:owned.optics.focalLengthMm,nominalFNumber:owned.optics.nominalFNumber,focus,pupil:owned.pupil,
    angularVelocityRadPerSec:shakenAngularVelocity(owned.motion.angularVelocityRadPerSec,owned.motion.handShake,window.startOffsetSecondsFromOpeningReference),timeSecondsFromOpeningReference:window.startOffsetSecondsFromOpeningReference}).value.rays.length;
  let count = 0;
  const nodes = spectralQuadrature.nodes.flatMap(spectral => spatialQuadrature.nodes.map(spatial => {
    const node = { spatialNode: { antiAliasingComponentIndex: spatial.antiAliasingComponentIndex,
      apertureSampleXIndex: spatial.apertureSampleXIndex, apertureSampleYIndex: spatial.apertureSampleYIndex },
      spectralSampleIndex: spectral.spectralSampleIndex, wavelengthNanometers: spectral.wavelengthNanometers };
    const destination = spatial.preAntiAliasingSourcePointMm;
    const resolved = owned.psf.kind === "sampled-local" ? resolveLensSampledPsf({ ...owned.psf.configuration.psf,
      wavelengthNm: spectral.wavelengthNanometers, fieldPointMm: { x: destination.x, y: -destination.y } }) : null;
    const kernel = resolved?.value.kernel;
    const taps = kernel ? kernel.widthSamples*kernel.heightSamples : 1;
    count += taps*owned.temporalSampleCount*pupilCount;
    if (count > 100000) throw new InvalidScientificInputError("Environment exposure exceeds the 100000-provider-evaluation budget.");
    const points = Array.from({ length: taps }, (_, i) => ({ kernelSampleX: kernel ? i%kernel.widthSamples : 0,
      kernelSampleY: kernel ? Math.floor(i/kernel.widthSamples) : 0,
      point: kernel ? sensorPsfSourcePoint(destination, kernel, i%kernel.widthSamples, Math.floor(i/kernel.widthSamples)) : { ...destination } }));
    return { node, points: points.map(p => ({ ...p, fieldThroughput: owned.fieldThroughput.kind === "unity"
      ? { kind: "unity" as const }
      : { kind: "illumination-vignetting-result" as const, result: calculateIlluminationVignetting({
        imagePointMm: { x: p.point.x, y: -p.point.y }, profile: owned.fieldThroughput.profile }).value } })) };
  }));
  const measure = window.localExposureDurationSeconds/owned.temporalSampleCount;
  let previous = -Infinity;
  const instants = Array.from({ length: owned.temporalSampleCount }, (_, temporalSampleIndex) => {
    const time = window.startOffsetSecondsFromOpeningReference+(temporalSampleIndex+.5)*measure;
    if (!(time > window.startOffsetSecondsFromOpeningReference && time > previous && time < window.endOffsetSecondsFromOpeningReference)) throw new InvalidScientificInputError("Local midpoints must be representable and strictly ordered.");
    previous = time;
    // #641: the rotation at this instant, with the hand-shake trajectory (if any) folded into the velocity.
    const { handShake, ...motion } = owned.motion, angularVelocityRadPerSec = shakenAngularVelocity(motion.angularVelocityRadPerSec, handShake, time);
    const groups = nodes.map((n, ni) => ({ node: n.node, taps: n.points.map((p, pi) => {
      const apertureRays = owned.pupil === undefined ? undefined : calculateSensorApertureRays({sourcePointNativeSensorMm:p.point,
        focalLengthMm:owned.optics.focalLengthMm,nominalFNumber:owned.optics.nominalFNumber,focus,pupil:owned.pupil,
        angularVelocityRadPerSec,timeSecondsFromOpeningReference:time}).value.rays;
      const queryInput: CalculateSensorEnvironmentRadianceQueryInput = { ...motion, angularVelocityRadPerSec, sourcePointNativeSensorMm: p.point,
        focalLengthMm: owned.optics.focalLengthMm, focus, timeSecondsFromOpeningReference: time,
        request: { schemaVersion: "0.1.0", sampleId: `${owned.temporalIntegrationId}-t${temporalSampleIndex}-n${ni}-p${pi}`,
          providerProfileId: sceneBindings.providerProfile.profileId, sceneId: sceneBindings.providerProfile.sceneId,
          illuminationProfileId: sceneBindings.illuminationProfile.profileId, materialResponseProfileId: sceneBindings.materialResponseProfile.profileId,
          wavelengthNanometers: n.node.wavelengthNanometers, wavelengthBasis } };
      const query = freezePlannedRequest(lensMapping === undefined ? calculateSensorEnvironmentRadianceQuery(queryInput)
        : calculateMappedSensorEnvironmentRadianceQuery(queryInput, lensMapping));
      const areaFactor = query.value.lensFieldMapping?.distortionAreaFactor;
      // Photo-only plans drop the query result (projection, diagnostics) once it is validated (a 2.0 memory saving).
      return { ...p, ...(apertureRays === undefined ? {} : { apertureRays }),
        ...(areaFactor === undefined ? {} : { distortionAreaFactor: areaFactor }), request: query.value.request,
        sourcePointImagePlaneMm: query.value.sourcePointImagePlaneMm, ...(retention === "full" ? { query } : {}) };
    }) }));
    // Validate PSF evidence/basis/support before supplied code is invoked.
    if (owned.psf.kind === "sampled-local") calculateSensorPsfIrradianceQuadrature({ ...owned.psf.configuration,
      spatialQuadrature, spectralQuadrature, timeSecondsFromOpeningReference: time,
      inputMeaning: "pre-psf-pre-sensor-stack-pre-aa-spectral-irradiance", samples: groups.map(g => ({ node: g.node,
        sourceSamples: g.taps.map(t => ({ kernelSampleX: t.kernelSampleX, kernelSampleY: t.kernelSampleY,
          sourcePointNativeSensorMm: t.point, timeSecondsFromOpeningReference: time, spectralIrradianceWattsPerSquareMeterPerNanometer: 0 })) })) });
    return { temporalSampleIndex, time, groups };
  });
  return { owned, sceneBindings, fieldThroughputEvidence, spatialQuadrature, spectralQuadrature, instants, count, focus };
}

/** Aperture queries already built for a batched provider, keyed by the planned ray; each is used once. */
const PREBUILT_APERTURE_QUERIES = new WeakMap<object, { base: object; request: SceneRadianceEvaluationRequest; apertureRay: SensorApertureRay }>();

/**
 * Internal: the frozen provider request and frozen private ray copy of one ideal-pupil query (sample ID suffix "-a"
 * and the pupil index, reversed ray direction). If prebuildApertureRadianceQuery already built this query for a batch,
 * the same objects are returned once, so the batch and the executor share them; otherwise new ones are built.
 */
export function apertureRadianceQuery(base: SceneRadianceEvaluationRequest, ray: SensorApertureRay):
  { request: SceneRadianceEvaluationRequest; apertureRay: SensorApertureRay } {
  const prebuilt = PREBUILT_APERTURE_QUERIES.get(ray);
  if (prebuilt !== undefined && prebuilt.base === base) {
    PREBUILT_APERTURE_QUERIES.delete(ray);
    return { request: prebuilt.request, apertureRay: prebuilt.apertureRay };
  }
  return { request: freezeOwnedData({ ...base, sampleId: base.sampleId+"-a"+ray.pupilSampleIndex,
    target: { kind: "environment-direction" as const, outgoingDirectionUnitVector: {
      x: -ray.directionUnitVector.x, y: -ray.directionUnitVector.y, z: -ray.directionUnitVector.z } } }),
  apertureRay: freezeOwnedData(copyRay(ray)) };
}
/**
 * A private copy of an engine-computed ray: plain records of numbers, copied key by key in the same order, so it
 * equals what structuredClone returns for this data (a 2.0 performance change: structuredClone dominated pupil runs).
 */
function copyRay(ray: SensorApertureRay): SensorApertureRay {
  const copy = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return value;
    if (Array.isArray(value)) return value.map(copy);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = copy((value as Record<string, unknown>)[key]);
    return out;
  };
  return copy(ray) as SensorApertureRay;
}
/** Internal: builds a pupil query for a batched provider and keeps it for the executor's apertureRadianceQuery call. */
export function prebuildApertureRadianceQuery(base: SceneRadianceEvaluationRequest, ray: SensorApertureRay):
  { request: SceneRadianceEvaluationRequest; apertureRay: SensorApertureRay } {
  PREBUILT_APERTURE_QUERIES.delete(ray);
  const query = apertureRadianceQuery(base, ray);
  PREBUILT_APERTURE_QUERIES.set(ray, { base, ...query });
  return query;
}

/** Deep-freezes a planned provider request once, so execution can hand the same immutable request to supplied code. */
function freezePlannedRequest<T extends { value: { request: object } }>(query: T): T {
  freezeOwnedData(query.value.request);
  return query;
}

/**
 * Internal: runs a completed, bounded plan. On failure nothing partial is returned.
 * With retention "full" (default), every per-evaluation record is kept in value.instants[].evaluations.
 * With "photo-only", those lists are empty, for engine callers that read only value.photo. Photo values
 * are identical either way.
 */
export function executeEnvironmentSensorPhotoSignal(plan: ReturnType<typeof planEnvironmentSensorPhotoSignal>, evaluate: EnvironmentRadianceEvaluator, evaluateAperture?: EnvironmentApertureRadianceEvaluator,
  retention: "full" | "photo-only" = "full"): CalculationResult<EnvironmentSensorPhotoSignal> {
  if (typeof evaluate !== "function") throw new InvalidScientificInputError("Environment radiance evaluator must be synchronous callable code.");
  const { owned } = plan;
  if (owned.pupil !== undefined && typeof evaluateAperture !== "function") throw new InvalidScientificInputError("Pupil integration requires an origin-aware aperture evaluator.");
  if (retention === "full" && plan.instants.some(instant => instant.groups.some(group => group.taps.some(tap => tap.query === undefined)))) {
    throw new InvalidScientificInputError("Full environment execution records require a full plan.");
  }
  const irradiance = [];
  const instants: EnvironmentSensorPhotoSignal["instants"][number][] = [];
  for (const instant of plan.instants) {
    const evaluations: EnvironmentSensorPhotoSignal["instants"][number]["evaluations"][number][] = [];
    const samples = instant.groups.map(group => ({ node: group.node, sourceSamples: group.taps.map(tap => {
      let integratedIrradiance = 0;
      const support: readonly (SensorApertureRay | undefined)[] = tap.apertureRays ?? [undefined];
      for (const ray of support) {
        // Planned requests are deep-frozen once at plan time (freezePlannedRequest); no per-evaluation clone.
        const query = ray === undefined ? undefined : apertureRadianceQuery(tap.request, ray);
        const request = query === undefined ? tap.request : query.request, apertureRay = query?.apertureRay;
        const result = parseSceneRadianceEvaluationResult(apertureRay === undefined ? evaluate(request) : evaluateAperture!(request,apertureRay));
        const bindings = validateSceneRadianceEvaluationBindings({ ...plan.sceneBindings, request, result });
        const optics = calculateSceneRadianceToSensorIrradiance({ ...owned.optics, sceneRadianceRequest: request,
          sceneRadianceResult: result, imagePointMm: tap.sourcePointImagePlaneMm, fieldThroughput: tap.fieldThroughput });
        if (retention === "full") evaluations.push({ query: tap.query!, result, bindings, optics,
          ...(apertureRay === undefined ? {} : {apertureRay,apertureRequest:request}) });
        integratedIrradiance += optics.value.sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer*(ray?.weight ?? 1);
      }
      if (tap.distortionAreaFactor !== undefined) {
        // Distortion squeezes or stretches the ideal image. Flux is conserved, so irradiance scales by 1/det, once.
        integratedIrradiance *= tap.distortionAreaFactor;
      }
      return { kernelSampleX: tap.kernelSampleX, kernelSampleY: tap.kernelSampleY, sourcePointNativeSensorMm: tap.point,
        timeSecondsFromOpeningReference: instant.time, spectralIrradianceWattsPerSquareMeterPerNanometer: integratedIrradiance };
    }) }));
    const psf = owned.psf.kind === "sampled-local" ? calculateSensorPsfIrradianceQuadrature({ ...owned.psf.configuration,
      spatialQuadrature: plan.spatialQuadrature, spectralQuadrature: plan.spectralQuadrature,
      timeSecondsFromOpeningReference: instant.time, inputMeaning: "pre-psf-pre-sensor-stack-pre-aa-spectral-irradiance", samples }) : null;
    irradiance.push({ temporalSampleIndex: instant.temporalSampleIndex, timeSecondsFromOpeningReference: instant.time,
      irradianceSamples: psf ? psf.value.irradianceSamples : samples.map(s => ({ node: s.node,
        spectralIrradianceWattsPerSquareMeterPerNanometer: s.sourceSamples[0]!.spectralIrradianceWattsPerSquareMeterPerNanometer })) });
    instants.push({ temporalSampleIndex: instant.temporalSampleIndex, timeSecondsFromOpeningReference: instant.time, psf, evaluations });
  }
  const photo = createSensorEqeTemporalPhotoSignal({ temporalIntegrationId: owned.temporalIntegrationId,
    exposure: { ...owned.sensor, samples: irradiance } });
  return approximationResult({ sourceTargetProjectionCalculated: true, providerCallbackExecuted: true,
    providerTransportVerified: false, sceneVisibilityCalculated: false, productionPlanActivated: false,
    providerEvaluationCount: plan.count, sourcePlane: "sensor-package-incident", fieldThroughputEvidence: plan.fieldThroughputEvidence,
    fieldThroughputLimitation: owned.fieldThroughput.limitation,
    psfOmission: owned.psf.kind === "not-applied" ? { evidence: parseEvidenceList(owned.psf.evidence, "psfOmission.evidence"), limitation: owned.psf.limitation } : null,
    psfRedistributionApplied: owned.psf.kind === "sampled-local", pupilIntegrationApplied: owned.pupil !== undefined, pupilIntegrationProfile: owned.pupil ?? null, photo, instants
  }, "environment-sensor-photo-signal", owned.lensFieldMapping === undefined ? "0.3.0" : "0.4.0", [
    "Supplied synchronous provider code was invoked at each generated environment query; physical transport and visibility are not verified.",
    "Ideal focus-aware rotation/projection, explicit evidence-bound field throughput and optional destination-local sampled PSF are bounded approximations.",
    "Optional ideal pupil rays use normalized radiance averaging; source intersections remain provider-owned and convergence is unverified.",
    "PSF pupil throughput is not applied; child uncertainty, finite-support and quadrature convergence are not combined or established.",
    ...(owned.lensFieldMapping === undefined ? [] : [
      "Lens field mapping: rays use the declared projection after inverse distortion; irradiance is multiplied once by the distortion area factor 1/det(d distorted/d ideal); field throughput and sampled PSFs remain evaluated at the physical sensor point."
    ])
  ]);
}

/**
 * Internal (#453; not exported from the package): the photo signal of {@link executeEnvironmentSensorPhotoSignal} with
 * retention "photo-only" (its `value.photo`), for a plan of engine-built records (planned as "engine-owned" from a record the
 * engine built, never shown to supplied code and never changed). It is the same chain with the same operations: every query of
 * the plan calls `evaluate` once with the same frozen request, in the same order; each result is parsed and its bindings and
 * identity checked; the optical bridge forms each irradiance with its own code; the taps, nodes and instants are assembled as
 * the full executor does; and `createSensorEqeTemporalPhotoSignal` forms the photo signal from the same input. So the photo
 * signal is the full executor's, value for value.
 *
 * What it skips is only re-validation of records that cannot have changed since they passed it, and records nobody reads:
 * - the first query runs the full per-query steps (full result parse, `validateSceneRadianceEvaluationBindings`,
 *   `calculateSceneRadianceToSensorIrradiance`); later queries skip the profile-to-profile binding checks and the optical
 *   bridge's re-parse of its unchanged optical inputs, request and result, keeping every per-query check
 *   (`validateSceneRadianceRequestResultBindings`, `prepareSceneRadianceToSensorIrradianceValue`), with the same messages;
 * - with `engineBuiltResults` (an evaluator marked by `markInternalSceneRadianceEvaluator`, or one returning such an
 *   evaluator's results), later results reuse the first result's parsed uncertainty, evidence and limitations when they are
 *   the same deep-frozen objects (`parseSceneRadianceEvaluationResultWithValidatedRecords`, as the lean executor does);
 * - no per-query optical result envelopes and no outer execution envelope are built.
 * Plans with ideal-pupil rays or a sampled PSF run the full executor.
 */
export function executeEngineOwnedEnvironmentPhotoSignal(plan: ReturnType<typeof planEnvironmentSensorPhotoSignal>, evaluate: EnvironmentRadianceEvaluator,
  engineBuiltResults: boolean): EnvironmentSensorPhotoSignal["photo"] {
  const { owned } = plan;
  if (owned.pupil !== undefined || owned.psf.kind !== "not-applied") return executeEnvironmentSensorPhotoSignal(plan, evaluate, undefined, "photo-only").value.photo;
  if (typeof evaluate !== "function") throw new InvalidScientificInputError("Environment radiance evaluator must be synchronous callable code.");
  const { providerProfile, illuminationProfile, materialResponseProfile } = plan.sceneBindings;
  let validated: ValidatedSceneRadianceRecords | undefined;
  let irradianceOf: ReturnType<typeof prepareSceneRadianceToSensorIrradianceValue> | undefined;
  const irradiance = [];
  for (const instant of plan.instants) {
    const samples = instant.groups.map(group => ({ node: group.node, sourceSamples: group.taps.map(tap => {
      let integratedIrradiance = 0;
      const request = tap.request, value = evaluate(request);
      let sensorPlane: number;
      if (irradianceOf === undefined) {
        const result = parseSceneRadianceEvaluationResult(value);
        validateSceneRadianceEvaluationBindings({ ...plan.sceneBindings, request, result });
        sensorPlane = calculateSceneRadianceToSensorIrradiance({ ...owned.optics, sceneRadianceRequest: request,
          sceneRadianceResult: result, imagePointMm: tap.sourcePointImagePlaneMm, fieldThroughput: tap.fieldThroughput }).value.sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer;
        const record = value as unknown as Record<string, unknown>;
        if (engineBuiltResults && isDeeplyFrozen(record.uncertainty) && isDeeplyFrozen(record.evidence) && isDeeplyFrozen(record.limitations)) {
          validated = { uncertainty: record.uncertainty, evidence: record.evidence, limitations: record.limitations, parsed: result };
        }
        irradianceOf = prepareSceneRadianceToSensorIrradianceValue(owned.optics);
      } else {
        const result = validated ? parseSceneRadianceEvaluationResultWithValidatedRecords(value, validated) : parseSceneRadianceEvaluationResult(value);
        validateSceneRadianceRequestResultBindings(providerProfile, illuminationProfile, materialResponseProfile, request, result);
        sensorPlane = irradianceOf(request, result, tap.sourcePointImagePlaneMm, tap.fieldThroughput);
      }
      // The full executor's sum over the tap's support (one direction, weight 1 without pupil rays).
      integratedIrradiance += sensorPlane*1;
      if (tap.distortionAreaFactor !== undefined) integratedIrradiance *= tap.distortionAreaFactor;
      return { kernelSampleX: tap.kernelSampleX, kernelSampleY: tap.kernelSampleY, sourcePointNativeSensorMm: tap.point,
        timeSecondsFromOpeningReference: instant.time, spectralIrradianceWattsPerSquareMeterPerNanometer: integratedIrradiance };
    }) }));
    irradiance.push({ temporalSampleIndex: instant.temporalSampleIndex, timeSecondsFromOpeningReference: instant.time,
      irradianceSamples: samples.map(s => ({ node: s.node,
        spectralIrradianceWattsPerSquareMeterPerNanometer: s.sourceSamples[0]!.spectralIrradianceWattsPerSquareMeterPerNanometer })) });
  }
  return createSensorEqeTemporalPhotoSignal({ temporalIntegrationId: owned.temporalIntegrationId,
    exposure: { ...owned.sensor, samples: irradiance } });
}

/** Plans, queries the provider and integrates the photo signal for one site, at the site's own midpoint sample positions. */
export function calculateEnvironmentSensorPhotoSignal(input: CalculateEnvironmentSensorPhotoSignalInput): CalculationResult<EnvironmentSensorPhotoSignal> {
  requireInputKeys(input, "calculateEnvironmentSensorPhotoSignal", ["temporalIntegrationId", "sensor", "sceneBindings", "optics", "motion", "temporalSampleCount", "pupil", "lensFieldMapping", "fieldThroughput", "psf", "evaluateRadiance", "evaluateApertureRadiance"]);
  const { evaluateRadiance, evaluateApertureRadiance, ...data } = input;
  return executeEnvironmentSensorPhotoSignal(planEnvironmentSensorPhotoSignal(data), evaluateRadiance, evaluateApertureRadiance);
}
