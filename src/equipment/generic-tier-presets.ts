// SPDX-License-Identifier: Apache-2.0

/**
 * Generic tier presets: a catalog of exact preset versions for bodies and lenses.
 *
 * There is no hidden "latest" alias and no default sensor size. By default the lens tier matches the
 * body tier, but mixing tiers is a normal, supported choice.
 * @see docs/GENERIC_TIER_PRESETS.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import { freezeOwnedData } from "../core/owned-data.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { choice, record, parseOpticalProfileState, type OpticalProfileState, type GenericOpticalEvidence } from "../optics/profile-contract.js";
import { genericTierAssets, type GenericEquipmentTier, type GenericEquipmentTierPreset, type GenericTierPresetVersion } from "./generic-tier-assets.js";
import { resolveGenericEquipmentExposureCapabilities } from "./exposure-capabilities.js";
import { parseGenericLensCorrectionProfile, type GenericLensCorrectionProfile } from "../output/lens-corrections.js";
import { parseLensStrayLightProfile, type LensStrayLightProfile } from "../optics/stray-light.js";
import { parseLensComplexPupilProfile, type LensComplexPupilProfile } from "../optics/complex-pupil-psf.js";
import { parseSceneToSensorIrradianceProfile, SCENE_TO_SENSOR_BRIDGE_SCOPE, type SceneToSensorIrradianceProfile } from "../optics/scene-to-sensor-irradiance.js";
import type { RadialDistortionProfile } from "../optics/radial-distortion.js";
import type { LateralChromaticAberrationProfile } from "../optics/lateral-chromatic-aberration.js";
import type { IlluminationVignettingProfile } from "../optics/illumination-vignetting.js";

/** The current preset version (2.14: 2.1.0, third-stop ISO settings). */
export const GENERIC_EQUIPMENT_TIER_PRESET_VERSION = "2.1.0" as const;
/** Every exact preset version that resolves, oldest first. A version is never retuned in place (`test/generic-tier-presets.test.ts`). */
export const GENERIC_EQUIPMENT_TIER_PRESET_VERSIONS = /* @__PURE__ */ Object.freeze(["2.0.0", "2.1.0"] as const);
export const GENERIC_EQUIPMENT_TIERS = /* @__PURE__ */ Object.freeze(["consumer", "prosumer", "professional"] as const);
export interface GenericEquipmentTierProfileReference { profileId: string; profileVersion: string }
export interface GenericEquipmentTierSelection {
  schemaVersion: "0.1.0"; presetVersion: GenericTierPresetVersion;
  bodyTier: GenericEquipmentTier; lensTier: GenericEquipmentTier;
  bodyPresetId: string; lensPresetId: string;
  profileReferences: readonly GenericEquipmentTierProfileReference[];
  sensorFormatSelectedByTier: false; scientificTierMultiplierApplied: false;
}
export interface ResolvedGenericTierLensProfiles {
  selection: GenericEquipmentTierSelection;
  state: OpticalProfileState;
  radial: RadialDistortionProfile;
  lateralCa: LateralChromaticAberrationProfile;
  vignetting: IlluminationVignettingProfile;
  breathingProjectionScale: number;
  transmission: SceneToSensorIrradianceProfile;
  pupils: readonly LensComplexPupilProfile[];
  stray: LensStrayLightProfile;
  correction: GenericLensCorrectionProfile;
  scientificStatus: "approximation";
}
const catalogs = new Map<GenericTierPresetVersion, readonly GenericEquipmentTierPreset[]>();
function catalogOf(version: GenericTierPresetVersion): readonly GenericEquipmentTierPreset[] {
  let catalog = catalogs.get(version);
  if (!catalog) catalogs.set(version, catalog = freezeOwnedData(genericTierAssets(version)));
  return catalog;
}
function preset(version: GenericTierPresetVersion, tier: GenericEquipmentTier): GenericEquipmentTierPreset {
  return catalogOf(version).find((p) => p.tier === tier)!;
}
function exactVersion(value: unknown): GenericTierPresetVersion {
  if (!(GENERIC_EQUIPMENT_TIER_PRESET_VERSIONS as readonly unknown[]).includes(value)) {
    throw new InvalidConfigurationError("Unknown equipment preset version; historical definitions may not silently fall back.");
  }
  return value as GenericTierPresetVersion;
}
/** Catalog of exact versions. No hidden "latest" alias and no default sensor size. */
export function resolveGenericEquipmentTierCatalog(input: { presetVersion: string }): readonly GenericEquipmentTierPreset[] {
  const r = record(input, ["presetVersion"]);
  return catalogOf(exactVersion(r.presetVersion));
}
function bodyReferences(p: GenericEquipmentTierPreset): GenericEquipmentTierProfileReference[] {
  const b = p.body;
  return [b.exposure, b.iso, b.signalChain, b.release, b.focus, b.stabilization, b.whiteBalance, b.meteringCapabilities, b.flashSync]
    .map((profile) => ({ profileId: profile.profileId, profileVersion: profile.profileVersion }))
    .concat([...b.readout, b.readoutTiming, b.rollingReadoutTiming, b.fixedPatternNoise, ...b.metering]
      .map((a) => ({ profileId: a.assetId, profileVersion: a.assetVersion })));
}
/** The lens tier matches the body tier by default. Mixing tiers is a normal, supported choice. */
export function createGenericEquipmentTierSelection(input: {
  presetVersion: string; bodyTier: GenericEquipmentTier; lensTier?: GenericEquipmentTier;
}): GenericEquipmentTierSelection {
  const r = record(input, ["presetVersion", "bodyTier", "lensTier"]);
  const presetVersion = exactVersion(r.presetVersion);
  const bodyTier = choice(r.bodyTier, GENERIC_EQUIPMENT_TIERS), lensTier = choice(r.lensTier === undefined ? bodyTier : r.lensTier, GENERIC_EQUIPMENT_TIERS);
  const body = preset(presetVersion, bodyTier), lens = preset(presetVersion, lensTier);
  return freezeOwnedData({ schemaVersion: "0.1.0", presetVersion, bodyTier, lensTier,
    bodyPresetId: body.presetId+":body", lensPresetId: lens.presetId+":lens",
    profileReferences: [...bodyReferences(body), { profileId: lens.lens.exposure.profileId, profileVersion: lens.lens.exposure.profileVersion }, ...lens.lens.profileReferences],
    sensorFormatSelectedByTier: false, scientificTierMultiplierApplied: false });
}
/** On a saved simulation, rejects profile versions that are stale, missing or retuned, instead of picking today's defaults. */
export function parseGenericEquipmentTierSelection(value: unknown): GenericEquipmentTierSelection {
  const r = record(value, ["schemaVersion", "presetVersion", "bodyTier", "lensTier", "bodyPresetId", "lensPresetId", "profileReferences",
    "sensorFormatSelectedByTier", "scientificTierMultiplierApplied"]);
  const expected = createGenericEquipmentTierSelection({ presetVersion: r.presetVersion as string,
    bodyTier: r.bodyTier as GenericEquipmentTier, lensTier: choice(r.lensTier, GENERIC_EQUIPMENT_TIERS) });
  if (r.schemaVersion !== expected.schemaVersion || r.bodyPresetId !== expected.bodyPresetId || r.lensPresetId !== expected.lensPresetId ||
      r.sensorFormatSelectedByTier !== false || r.scientificTierMultiplierApplied !== false || !Array.isArray(r.profileReferences) ||
      r.profileReferences.length !== expected.profileReferences.length) throw new InvalidConfigurationError("Saved equipment selection differs from its exact preset manifest.");
  for (let i = 0; i < expected.profileReferences.length; i++) {
    const ref = record(r.profileReferences[i], ["profileId", "profileVersion"]), actual = expected.profileReferences[i]!;
    if (ref.profileId !== actual.profileId || ref.profileVersion !== actual.profileVersion) throw new InvalidConfigurationError("Saved equipment profile reference drift.");
  }
  return expected;
}
/** Ties the finite matched-reference optical data to one exact generic selected state. Never extrapolates. */
export function resolveGenericEquipmentTierLensProfiles(input: { selection: GenericEquipmentTierSelection; state: OpticalProfileState }): ResolvedGenericTierLensProfiles {
  const request = record(input, ["selection", "state"]), selection = parseGenericEquipmentTierSelection(request.selection), state = parseOpticalProfileState(request.state);
  const b = preset(selection.presetVersion, selection.bodyTier), l = preset(selection.presetVersion, selection.lensTier), a = l.lens.matchedReference;
  if (state.bodyId !== b.body.exposure.profileId.replace(/:exposure$/, "") || state.bodyVersion !== selection.presetVersion ||
      state.lensId !== l.lens.exposure.profileId.replace(/:exposure$/, "") || state.lensVersion !== selection.presetVersion ||
      state.focalLengthMm !== a.focalLengthMm || state.aperture !== a.aperture || state.focusDistanceM !== a.focusDistanceM ||
      state.captureMode !== "still" || state.stabilizationMode !== "off") throw new InvalidConfigurationError("No optical reference slice for this exact generic system/acquisition state.");
  resolveGenericEquipmentExposureCapabilities({ bodyProfile: b.body.exposure, lensProfile: l.lens.exposure, selectedFocalLengthMm: state.focalLengthMm });
  const id = state.lensId, version = state.lensVersion, evidence = l.evidence;
  const opticalEvidence: GenericOpticalEvidence = { kind: "generic-parametric", basis: "Photivra-owned educational tier design values, not measured calibration.",
    residualNote: "Finite matched-reference approximation; no branded signature or aggregate physical error bound.", sources: evidence };
  const coeff = (k1: number): RadialDistortionProfile => ({ normalizationRadiusMm: a.normalizationRadiusMm, maximumNormalizedRadius: 1.1,
    coefficients: { k1, k2: 0, k3: 0 } });
  const radial = coeff(a.distortionK1), lateralCa: LateralChromaticAberrationProfile = { normalizationRadiusMm: a.normalizationRadiusMm,
    maximumNormalizedRadius: 1.1, baseDistortionCoefficients: radial.coefficients,
    redCoefficientOffset: { k1: a.lateralCaK1Offset, k2: 0, k3: 0 }, blueCoefficientOffset: { k1: -a.lateralCaK1Offset, k2: 0, k3: 0 } };
  const vignetting: IlluminationVignettingProfile = { normalizationRadiusMm: a.normalizationRadiusMm, maximumNormalizedRadius: 1.1,
    coefficients: { r2: a.vignettingR2, r4: 0, r6: 0 } };
  const identity = { version, domain: "reconstructed-linear" as const, availability: "toggle" as const, defaultEnabled: true,
    dependencies: [], requiredByStabilizationModes: [], residualNote: opticalEvidence.residualNote };
  const correction = parseGenericLensCorrectionProfile({ schemaVersion: "0.1.0", id: id+":correction", version, state, evidence: opticalEvidence,
    components: [{ ...identity, id: "geometry", kind: "geometry", transform: { id: id+":radial-map", version,
      domain: "reconstructed-linear", purpose: "distortion", kind: "radial", profile: radial } },
    { ...identity, id: "lateral-ca", kind: "lateral-ca", transforms: Object.fromEntries(["red", "green", "blue"].map((channel, i) => [channel, {
      id: id+":ca-map:"+channel, version, domain: "reconstructed-linear", purpose: "lateral-ca", kind: "radial",
      profile: coeff([a.lateralCaK1Offset*a.correctionCaFraction, 0, -a.lateralCaK1Offset*a.correctionCaFraction][i]!) }])) },
    { ...identity, id: "gain", kind: "peripheral-illumination", profile: vignetting, strength: a.correctionGainStrength }] });
  const stray = parseLensStrayLightProfile({ schemaVersion: "0.1.0", id: id+":stray", version, state, evidence: opticalEvidence,
    interaction: "lens-reflections", wavelengthNm: a.wavelengthNm, wavelengthBasis: "vacuum", maximumSourceAngleDegrees: 60,
    referenceEntranceAreaMm2: Math.PI*(50/4/2)**2, responses: [
      { id: "ghost", kind: "ghost", centroidMmPerDegree: [-.02,0,0,-.02], offsetMm: { x: 1, y: 0 }, sigmaMm: .5, axisPowerFraction: a.ghostPowerFraction, angularSlope: 1 },
      { id: "veil", kind: "veil", centroidMmPerDegree: [0,0,0,0], offsetMm: { x: 0, y: 0 }, sigmaMm: 10, axisPowerFraction: a.veilPowerFraction, angularSlope: 0 }] });
  const transmission = parseSceneToSensorIrradianceProfile({ schemaVersion: "0.1.0", profileId: id+":transmission", profileVersion: version, lensProfileId: id,
    scientificStatus: "approximation", applicability: { focalLengthMm: { minimum: 50, maximum: 50 }, nominalFNumber: { minimum: 4, maximum: 4 },
      focus: { kind: "finite-distance-range", objectDistanceM: { minimum: 5, maximum: 5 } } }, transmission: { kind: "spectral-transmission", scientificStatus: "approximation",
      wavelengthBasis: "vacuum", samples: { value: [{ wavelengthNanometers: 380, linearTransmissionFactor: a.transmission },
        { wavelengthNanometers: 780, linearTransmissionFactor: a.transmission }], evidence }, uncertainty: { kind: "not-quantified", limitation: "Synthetic spectrally flat reference over 380-780 nm." } },
    ...SCENE_TO_SENSOR_BRIDGE_SCOPE, evidence, limitations: l.lens.limitations });
  const pupils = [0,1,2].flatMap((field) => [-20,0,20].map((defocus, index) => parseLensComplexPupilProfile({ schemaVersion: "0.1.0",
    profileId: id+":pupil:"+field+":"+index, profileVersion: version, scientificStatus: "approximation", opticalDomain: "lens-primary-optical-path-only",
    representation: "complex-pupil-amplitude-plus-opd", pupilCoordinateSystem: "pupil-plane-metric-aligned-to-image-plane", imageFieldAxes: "+X right, +Y up",
    amplitudeMeaning: "relative-complex-pupil-amplitude-shape", wavefrontMeaning: "optical-path-difference-micrometers",
    throughputOwnership: "separate-relative-pupil-throughput-factor", kernelEnergyNormalization: "unit-energy-shape", propagationModel: "scalar-fraunhofer-discrete-reference",
    context: { focalLengthMm: 50, focus: { kind: "finite", distanceM: 5 }, apertureFNumber: 4, fieldPointMm: [{x:0,y:0},{x:10,y:6},{x:18,y:12}][field],
      wavelengthNm: 550, signedDefocusImagePlaneMicrometers: defocus }, responseIncludes: { diffraction: true, aberration: true, defocus: true, pupilClippingShape: true },
    relativePupilThroughputFactor: a.pupilThroughputByField[field], grid: { widthSamples: 5, heightSamples: 5, pupilSamplePitchMmX: 3.125, pupilSamplePitchMmY: 3.125,
      centerSampleX: 2, centerSampleY: 2, relativeAmplitude: a.pupilAmplitudeByField[field], opticalPathDifferenceMicrometers: a.pupilOpdMicrometersByDefocus[index] },
    sensorOpticalStackIncluded: false, sensorSamplingIncluded: false, reconstructionIncluded: false, strayLightIncluded: false, evidence,
    uncertainty: { kind: "not-quantified", limitation: "Coarse independently designed pupil-grid reference only." }, limitations: l.lens.limitations })));
  return freezeOwnedData({ selection, state, radial, lateralCa, vignetting, breathingProjectionScale: a.breathingProjectionScale, transmission, pupils, stray, correction,
    scientificStatus: "approximation" });
}
