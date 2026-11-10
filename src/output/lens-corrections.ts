// SPDX-License-Identifier: Apache-2.0

/**
 * Generic lens corrections applied after capture: distortion, lateral chromatic aberration
 * (CA) and vignetting (corner darkening).
 *
 * It parses correction profiles, resolves which corrections are on for a camera state, and
 * applies them to linear RGB channels. It does not extrapolate beyond a profile and does not
 * claim to restore lost detail.
 * @see docs/DIGITAL_OPTICS_FOUNDATION.md for equations, coordinate/unit conventions, blockers and
 * support limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { calculateIlluminationVignetting, type IlluminationVignettingProfile } from "../optics/illumination-vignetting.js";
import {
  choice, finite, list, parseEvidence, parseOpticalProfileState, positive, record,
  requireSameState, textValue, type GenericOpticalEvidence, type OpticalProfileState
} from "../optics/profile-contract.js";
import { calculateInverseRadialSourcePointValue, validateRadialDistortionProfile, type LensFieldPointMm, type RadialDistortionProfile } from "../optics/radial-distortion.js";
import {
  calculateGeometricResampling, calculateGeometricSamplingPlan, parseDigitalGeometricTransform,
  prepareGeometricMapping, parseGeometricRaster, calculateValidSourceCrop, type DigitalGeometricTransform, type GeometricImageDomain,
  type GeometricRaster, type GeometricResampler, type GeometricSamplingPlan
} from "./geometric-transforms.js";
import { requireInputObject, requireInputKeys } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export type LensCorrectionChannel = "red" | "green" | "blue";
interface CorrectionComponentIdentity {
  id: string;
  version: string;
  domain: GeometricImageDomain;
  availability: "toggle" | "automatic" | "mandatory";
  defaultEnabled: boolean;
  dependencies: readonly string[];
  requiredByStabilizationModes: readonly string[];
  /** Declared remaining errors and calibration limits. They are not inferred from the optical model tier. */
  residualNote: string;
}
/** A distortion correction map, declared separately. It may deliberately leave some physical distortion in place. */
export interface GeometricLensCorrection extends CorrectionComponentIdentity {
  kind: "geometry";
  transform: DigitalGeometricTransform;
}
/** Lateral CA: shifts colour channels into register. It does not correct longitudinal CA or colour shading. */
export interface LateralCaLensCorrection extends CorrectionComponentIdentity {
  kind: "lateral-ca";
  transforms: Readonly<Record<LensCorrectionChannel, DigitalGeometricTransform>>;
}
/** Vignetting correction as a gain applied after capture. A strength below 1 deliberately leaves some falloff. Range 0..1. */
export interface IlluminationLensCorrection extends CorrectionComponentIdentity {
  kind: "peripheral-illumination";
  profile: IlluminationVignettingProfile;
  strength: number;
  /**
   * Optional (#584): the capture's radial distortion r_d = r(1 + k1ρ² + k2ρ⁴ + k3ρ⁶), whose area factor 1/det J the capture also
   * multiplied into the irradiance (det J = (1 + k1ρ_i² + k2ρ_i⁴ + k3ρ_i⁶)(1 + 3k1ρ_i² + 5k2ρ_i⁴ + 7k3ρ_i⁶) at the ideal point ρ_i that
   * the lens images to the sensor point). With it, the relative illumination corrected is E(ρ_s)/det J(ρ_i), evaluated at the
   * capture's sensor (source) point, so strength 1 flattens a flat field. It holds whether or not the distortion itself is corrected.
   * Without it the gain is 1/E alone, as before.
   */
  distortionAreaFactor?: RadialDistortionProfile;
}
export type LensCorrectionComponent = GeometricLensCorrection | LateralCaLensCorrection | IlluminationLensCorrection;
/** A correction profile for one exact lens-and-camera system. Components are listed in the order they are applied. */
export interface GenericLensCorrectionProfile {
  schemaVersion: "0.1.0";
  id: string;
  version: string;
  state: OpticalProfileState;
  evidence: GenericOpticalEvidence;
  components: readonly LensCorrectionComponent[];
}
export interface ResolvedLensCorrectionPlan {
  profile: GenericLensCorrectionProfile;
  outputKind: "raw-like" | "processed";
  selectionKind: "camera-selectable" | "reference-bypass";
  components: readonly { component: LensCorrectionComponent; enabled: boolean;
    reason: "selected" | "default" | "mandatory" | "stabilization-dependency" | "component-dependency" | "reference-bypass" }[];
  /** For now, a RAW-like intent is recorded as metadata only. */
  application: "metadata-only" | "bake-downstream";
}
function illumination(value: unknown): IlluminationVignettingProfile {
  const r = record(value, ["normalizationRadiusMm", "maximumNormalizedRadius", "coefficients"]);
  const c = record(r.coefficients, ["r2", "r4", "r6"]);
  const profile = { normalizationRadiusMm: positive(r.normalizationRadiusMm, "normalizationRadiusMm"),
    maximumNormalizedRadius: positive(r.maximumNormalizedRadius, "maximumNormalizedRadius"),
    coefficients: { r2: finite(c.r2, "r2"), r4: finite(c.r4, "r4"), r6: finite(c.r6, "r6") } };
  calculateIlluminationVignetting({ imagePointMm: { x: 0, y: 0 }, profile });
  return profile;
}
/** Strictly parses a generic correction profile. It does not extrapolate and makes no claim to restore lost detail. */
export function parseGenericLensCorrectionProfile(value: unknown): GenericLensCorrectionProfile {
  const r = record(value, ["schemaVersion", "id", "version", "state", "evidence", "components"]);
  const components = list(r.components, 16).map((value): LensCorrectionComponent => {
    const c = record(value, ["id", "version", "domain", "availability", "defaultEnabled", "dependencies",
      "requiredByStabilizationModes", "residualNote", "kind", "transform", "transforms", "profile", "strength", "distortionAreaFactor"]);
    if (typeof c.defaultEnabled !== "boolean") throw new InvalidConfigurationError("defaultEnabled must be boolean.");
    const identity = { id: textValue(c.id), version: textValue(c.version),
      domain: choice(c.domain, ["raw-channel", "reconstructed-linear", "processed-output"]),
      availability: choice(c.availability, ["toggle", "automatic", "mandatory"]), defaultEnabled: c.defaultEnabled,
      dependencies: list(c.dependencies, 16).map(textValue),
      requiredByStabilizationModes: list(c.requiredByStabilizationModes, 16).map(textValue), residualNote: textValue(c.residualNote) };
    const kind = choice(c.kind, ["geometry", "lateral-ca", "peripheral-illumination"]);
    if (kind === "geometry") {
      if (c.transforms !== undefined || c.profile !== undefined || c.strength !== undefined || c.distortionAreaFactor !== undefined) throw new InvalidScientificInputError("Extraneous geometry parameters.");
      const transform = parseDigitalGeometricTransform(c.transform);
      if (transform.domain !== identity.domain || !["distortion", "breathing"].includes(transform.purpose)) throw new InvalidScientificInputError("Geometry domain/purpose mismatch.");
      return { ...identity, kind, transform };
    }
    if (kind === "lateral-ca") {
      if (c.transform !== undefined || c.profile !== undefined || c.strength !== undefined || c.distortionAreaFactor !== undefined) throw new InvalidScientificInputError("Extraneous CA parameters.");
      const t = record(c.transforms, ["red", "green", "blue"]);
      const transforms = { red: parseDigitalGeometricTransform(t.red), green: parseDigitalGeometricTransform(t.green), blue: parseDigitalGeometricTransform(t.blue) };
      for (const transform of Object.values(transforms)) {
        if (transform.domain !== identity.domain || transform.purpose !== "lateral-ca") throw new InvalidScientificInputError("CA domain/purpose mismatch.");
      }
      return { ...identity, kind, transforms };
    }
    if (c.transform !== undefined || c.transforms !== undefined) throw new InvalidScientificInputError("Extraneous illumination geometry.");
    const strength = finite(c.strength, "strength");
    if (strength < 0 || strength > 1) throw new InvalidScientificInputError("Strength must lie in [0,1].");
    if (c.distortionAreaFactor === undefined) return { ...identity, kind, profile: illumination(c.profile), strength };
    const d = record(c.distortionAreaFactor, ["normalizationRadiusMm", "maximumNormalizedRadius", "coefficients"]), k = record(d.coefficients, ["k1", "k2", "k3"]);
    const distortionAreaFactor = { normalizationRadiusMm: positive(d.normalizationRadiusMm, "normalizationRadiusMm"), maximumNormalizedRadius: positive(d.maximumNormalizedRadius, "maximumNormalizedRadius"),
      coefficients: { k1: finite(k.k1, "k1"), k2: finite(k.k2, "k2"), k3: finite(k.k3, "k3") } };
    validateRadialDistortionProfile(distortionAreaFactor);
    return { ...identity, kind, profile: illumination(c.profile), strength, distortionAreaFactor };
  });
  const preceding = new Set<string>(), mappingIds = new Set<string>();
  for (const c of components) {
    if (preceding.has(c.id) || c.dependencies.some((id) => !preceding.has(id)) ||
        new Set(c.dependencies).size !== c.dependencies.length) throw new InvalidScientificInputError("Component IDs/dependency order must be unique and acyclic.");
    preceding.add(c.id);
    // Common and per-channel transforms need stable, distinct IDs when they are combined.
    const maps = c.kind === "geometry" ? [c.transform] : c.kind === "lateral-ca" ? Object.values(c.transforms) : [];
    for (const t of maps) {
      if (mappingIds.has(t.id)) throw new InvalidScientificInputError("Duplicate correction transform ID.");
      mappingIds.add(t.id);
    }
  }
  return { schemaVersion: choice(r.schemaVersion, ["0.1.0"]), id: textValue(r.id), version: textValue(r.version),
    state: parseOpticalProfileState(r.state), evidence: parseEvidence(r.evidence), components };
}

/**
 * Decides which corrections apply for a camera state. It accounts for per-component settings,
 * explicit dependencies between components, RAW intent and the educational "corrections off" bypass.
 */
export function resolveLensCorrectionPlan(input: {
  profile: GenericLensCorrectionProfile; state: OpticalProfileState;
  selections: Readonly<Record<string, "on" | "off" | "auto">>;
  outputKind: "raw-like" | "processed"; selectionKind: "camera-selectable" | "reference-bypass";
}): CalculationResult<ResolvedLensCorrectionPlan> {
  requireInputKeys(input, "resolveLensCorrectionPlan", ["profile", "state", "selections", "outputKind", "selectionKind"]);
  const profile = parseGenericLensCorrectionProfile(input.profile);
  requireSameState(profile.state, input.state);
  const outputKind = choice(input.outputKind, ["raw-like", "processed"]);
  const selectionKind = choice(input.selectionKind, ["camera-selectable", "reference-bypass"]);
  const selections = record(input.selections, profile.components.map((c) => c.id));
  const components: ResolvedLensCorrectionPlan["components"][number][] = profile.components.map((c): ResolvedLensCorrectionPlan["components"][number] => {
    const selection = choice(selections[c.id] ?? "auto", ["on", "off", "auto"]);
    if (selectionKind === "reference-bypass") return { component: c, enabled: false, reason: "reference-bypass" };
    const stabilization = c.requiredByStabilizationModes.includes(profile.state.stabilizationMode);
    if (c.availability === "mandatory" && selection === "off") throw new InvalidScientificInputError("Mandatory correction cannot be disabled as a camera setting; use reference-bypass.");
    if (c.availability === "automatic" && selection !== "auto") throw new InvalidScientificInputError("Automatic correction has no camera toggle.");
    return { component: c, enabled: c.availability === "mandatory" || stabilization || (selection === "auto" ? c.defaultEnabled : selection === "on"),
      reason: c.availability === "mandatory" ? "mandatory" : stabilization ? "stabilization-dependency" : selection === "auto" ? "default" : "selected" };
  });
  for (const entry of [...components].reverse()) if (entry.enabled) for (const id of entry.component.dependencies) {
    const dependency = components.find((c) => c.component.id === id)!;
    dependency.enabled = true; dependency.reason = "component-dependency";
  }
  return approximationResult({ profile, outputKind, selectionKind, components,
    application: outputKind === "raw-like" ? "metadata-only" : "bake-downstream" },
  "generic-camera-lens-correction-plan", "0.1.0", [profile.evidence.basis, profile.evidence.residualNote,
    "Corrections occur after the same physical capture; tier is not a correction-strength input",
    "Raw-like output preserves intent without baking corrections; color shading, axial CA and restoration remain unsupported"]);
}

/**
 * Applies a gain after capture and reports the variance before clipping. It does not rewrite
 * the photon or SNR (signal-to-noise ratio) history of the capture. The gain is T^(−strength), T the relative illumination at
 * `imagePointMm`: E(ρ) of the component's profile, divided by det J(ρ_i) when the component has a `distortionAreaFactor` (#584;
 * then `imagePointMm` is the capture's sensor point, where the capture applied both).
 */
export function calculatePeripheralIlluminationCorrection(input: {
  component: IlluminationLensCorrection; imagePointMm: LensFieldPointMm;
  signal: number; noiseVariance: number; clippingLevel: number;
}): CalculationResult<{ gain: number; signalBeforeClipping: number; signal: number; noiseVarianceBeforeClipping: number; clipped: boolean }> {
  requireInputKeys(input, "calculatePeripheralIlluminationCorrection", ["component", "imagePointMm", "signal", "noiseVariance", "clippingLevel"]);
  const component = input.component;
  requireInputObject(component, "component input");
  if (component.kind !== "peripheral-illumination" || component.strength < 0 || component.strength > 1 || !Number.isFinite(component.strength)) throw new InvalidScientificInputError("Invalid illumination component.");
  const signal = finite(input.signal, "signal"), variance = finite(input.noiseVariance, "noiseVariance");
  const level = positive(input.clippingLevel, "clippingLevel");
  if (variance < 0) throw new InvalidScientificInputError("Variance must be nonnegative.");
  let throughput = calculateIlluminationVignetting({ imagePointMm: input.imagePointMm, profile: component.profile }).value.linearThroughputFactor;
  if (component.distortionAreaFactor !== undefined) {
    const { k1, k2, k3 } = component.distortionAreaFactor.coefficients;
    const p2 = calculateInverseRadialSourcePointValue(input.imagePointMm, validateRadialDistortionProfile(component.distortionAreaFactor), "imagePointMm").sourceNormalizedRadius ** 2;
    throughput /= (1 + p2 * (k1 + p2 * (k2 + p2 * k3))) * (1 + p2 * (3 * k1 + p2 * (5 * k2 + p2 * 7 * k3)));
  }
  const gain = throughput**(-component.strength), before = signal*gain;
  return approximationResult({ gain, signalBeforeClipping: before, signal: Math.min(level, before),
    noiseVarianceBeforeClipping: variance*gain*gain, clipped: before > level },
    "post-capture-peripheral-illumination-gain", "0.1.0", ["Variance describes pre-clip samples only", "Gain does not increase captured photons or restore sensor SNR"]);
}

/** The fixed capture identity travels with the output channels, so On/Off comparisons use the same capture. */
export interface LensCorrectionCapture {
  state: OpticalProfileState;
  captureId: string;
  noiseRealizationId: string;
  timeSeconds: number;
  raster: GeometricRaster;
  channels: Readonly<Record<LensCorrectionChannel, readonly number[]>>;
}
/** Applies bounded corrections to RGB channels that are already sampled and linear.
 * Compatible shared geometry and per-channel CA are combined, so each channel is resampled once.
 * A gain between geometry components, or incompatible domains, needs a separate staged caller.
 */
export function calculateLensCorrectedCapture(input: {
  plan: ResolvedLensCorrectionPlan; capture: LensCorrectionCapture;
  destinationRaster: GeometricRaster; resampler: GeometricResampler;
  physicalProjectionDistanceMm: number; clippingLevel: number;
}): CalculationResult<{
  captureId: string; noiseRealizationId: string; timeSeconds: number;
  application: ResolvedLensCorrectionPlan["application"];
  channels: Readonly<Record<LensCorrectionChannel, readonly (number | null)[]>>;
  samplingPlans: Partial<Record<LensCorrectionChannel, GeometricSamplingPlan>>;
  /** Area valid in every channel, before cropping. Missing colours are never made up. */
  validSourceMask: readonly boolean[];
  jointCrop: GeometricSamplingPlan["jointCrop"];
  /** Clipping events in gain stages, before the shared valid-area crop. Each stage is counted separately. */
  illuminationClippingEventCount: number;
}> {
  requireInputKeys(input, "calculateLensCorrectedCapture", ["plan", "capture", "destinationRaster", "resampler", "physicalProjectionDistanceMm", "clippingLevel"]);
  // Re-resolve the plan, which may be untrusted or changed, so callers cannot fake enabled or mandatory states.
  requireInputObject(input.plan, "plan");
  const plan = resolveLensCorrectionPlan({ profile: input.plan.profile, state: input.plan.profile.state,
    selections: Object.fromEntries(input.plan.components.filter((e) => e.component.availability === "toggle").map((e) => [e.component.id, e.enabled ? "on" : "off"])),
    outputKind: input.plan.outputKind, selectionKind: input.plan.selectionKind }).value;
  const capture = input.capture;
  requireSameState(plan.profile.state, capture.state);
  const sourceRaster = parseGeometricRaster(capture.raster);
  const destination = parseGeometricRaster(input.destinationRaster);
  if (destination.width !== plan.profile.state.outputWidth || destination.height !== plan.profile.state.outputHeight) {
    throw new InvalidScientificInputError("Destination raster differs from correction output binding.");
  }
  textValue(capture.captureId); textValue(capture.noiseRealizationId);
  if (finite(capture.timeSeconds, "timeSeconds") < 0) throw new InvalidScientificInputError("Invalid capture time.");
  const count = capture.raster.width*capture.raster.height;
  for (const channel of ["red", "green", "blue"] as const) {
    const data = list(capture.channels[channel], 65536);
    if (data.length !== count) throw new InvalidScientificInputError("Capture channel sample count mismatch.");
    data.forEach((s) => finite(s, "channel sample"));
  }
  const active = plan.components.filter((e) => e.enabled).map((e) => e.component);
  const sameLattice = sourceRaster.width === destination.width && sourceRaster.height === destination.height &&
    sourceRaster.pitchMm === destination.pitchMm && sourceRaster.centerMm.x === destination.centerMm.x &&
    sourceRaster.centerMm.y === destination.centerMm.y;
  // Disabling corrections does not disable an explicit output crop/resampling request.
  if (plan.application === "metadata-only" || (!active.length && sameLattice)) {
    return approximationResult({ captureId: capture.captureId, noiseRealizationId: capture.noiseRealizationId,
      timeSeconds: capture.timeSeconds, application: plan.application, channels: capture.channels,
      samplingPlans: {}, validSourceMask: Array<boolean>(count).fill(true), illuminationClippingEventCount: 0,
      jointCrop: { x: 0, y: 0, width: capture.raster.width, height: capture.raster.height } },
    "generic-lens-correction-capture", "0.1.0", ["Original physical capture preserved"]);
  }
  if (active.some((c) => c.domain !== "reconstructed-linear")) throw new InvalidScientificInputError("This executor requires reconstructed-linear components; other domains need separate consumers.");
  let seenGain = false;
  for (const c of active) {
    if (c.kind === "peripheral-illumination") seenGain = true;
    else if (seenGain) throw new InvalidScientificInputError("Cannot reorder geometry across a gain stage.");
  }
  const channels = {} as Record<LensCorrectionChannel, readonly (number | null)[]>;
  const samplingPlans: Partial<Record<LensCorrectionChannel, GeometricSamplingPlan>> = {};
  let illuminationClippingEventCount = 0;
  for (const channel of ["red", "green", "blue"] as const) {
    // Corrections are listed source → destination. Inverse sampling runs them in reverse.
    const transforms = active.filter((c) => c.kind !== "peripheral-illumination").reverse().map((c) =>
      c.kind === "geometry" ? c.transform : (c as LateralCaLensCorrection).transforms[channel]);
    const mapping = prepareGeometricMapping({ transforms, frameTimeSeconds: capture.timeSeconds }).value;
    const sampling = calculateGeometricSamplingPlan({ mapping, sourceRaster: capture.raster,
      destinationRaster: input.destinationRaster, resampler: input.resampler,
      physicalProjectionDistanceMm: input.physicalProjectionDistanceMm }).value;
    samplingPlans[channel] = sampling;
    let data = calculateGeometricResampling({ plan: sampling, sourceSamples: capture.channels[channel] }).value.samples;
    for (const c of active) if (c.kind === "peripheral-illumination") {
      data = data.map((signal, index): number | null => {
        if (signal === null) return null;
        const raster = input.destinationRaster, x = index%raster.width, y = Math.floor(index/raster.width);
        // #584: a gain that carries the distortion's area factor is the capture's own, so it is read at the source point.
        const corrected = calculatePeripheralIlluminationCorrection({ component: c,
          imagePointMm: c.distortionAreaFactor ? sampling.points[index]!.sourcePointMm : { x: raster.centerMm.x+(x+.5-raster.width/2)*raster.pitchMm,
            y: raster.centerMm.y-(y+.5-raster.height/2)*raster.pitchMm },
          signal, noiseVariance: 0, clippingLevel: input.clippingLevel }).value;
        if (corrected.clipped) illuminationClippingEventCount++;
        return corrected.signal;
      });
    }
    channels[channel] = data;
  }
  const mask = channels.red.map((_, i) => channels.red[i] !== null && channels.green[i] !== null && channels.blue[i] !== null);
  for (const channel of ["red", "green", "blue"] as const) channels[channel] = channels[channel].map((s, i) => mask[i] ? s : null);
  return approximationResult({ captureId: capture.captureId, noiseRealizationId: capture.noiseRealizationId,
    timeSeconds: capture.timeSeconds, application: plan.application, channels, samplingPlans, validSourceMask: mask,
    illuminationClippingEventCount,
    jointCrop: calculateValidSourceCrop(mask, destination.width, destination.height) },
  "generic-lens-correction-capture", "0.1.0", ["Input capture/noise realization remains unchanged", "Channel support intersects before output; optical blur/noise is warped, not physically repaired",
    "No production-plan composition is enabled by this standalone executor"]);
}
