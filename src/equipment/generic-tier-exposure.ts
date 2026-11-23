// SPDX-License-Identifier: Apache-2.0

/**
 * The generic tiers' exposure profiles (#765, 2.29.0): each body's exposure capabilities and meters and each tier lens's exposure
 * capabilities. `generic-tier-assets.ts` builds its presets' exposure side with these functions, and a calculation that needs
 * only the exposure side (`calculateProgramLine`) reads `genericTierExposure()`, built by the same functions, so it bundles without the tiers' readout, ISO gain, stabilization,
 * white balance and other profiles. Synthetic educational design values, as the rest of the tier assets.
 */
import type { EvidenceBackedFact, EvidenceProvenance } from "../core/evidence-provenance.js";
import { freezeOwnedData } from "../core/owned-data.js";
import { parseGenericBodyExposureCapabilityProfile, parseGenericLensExposureCapabilityProfile,
  type GenericBodyExposureCapabilityProfile, type GenericLensExposureCapabilityProfile } from "./exposure-capabilities.js";
import { parseExposureMeteringProfile, type ExposureMeteringProfile } from "../exposure/metering.js";
import { GENERIC_THIRD_STOP_ISO_SETTINGS, GENERIC_WHOLE_STOP_ISO_SETTINGS } from "./generic-iso-settings.js";

export type GenericEquipmentTier = "consumer" | "prosumer" | "professional";
/**
 * The exact versions of the generic tier presets (no "latest" alias). 2.1.0 (2.14, round 5) adds the third-stop ISO
 * settings; 2.0.0 is kept, whole-stop, so saved selections and records of it still resolve to exactly what they named.
 */
export type GenericTierPresetVersion = "2.0.0" | "2.1.0";
export interface GenericVersionedAsset<T> { assetId: string; assetVersion: string; profile: T }

// #682: frozen where defined; every tier profile, and every capture's `provenance.evidence`, references these records.
export const GENERIC_TIER_EVIDENCE: readonly EvidenceProvenance[] = /* @__PURE__ */ Object.freeze([/* @__PURE__ */ Object.freeze({ sourceOrigin: "photivra",
  sourceReference: "photivra:generic-tier-assets-v1", reuseStatus: "photivra-owned" } as const)]);
export const GENERIC_TIER_LIMITATIONS: readonly string[] = /* @__PURE__ */ Object.freeze(["Synthetic educational design values; no named camera/lens calibration or population ranking."]);

/** A body's exposure capabilities: shutter 1/8000–30 s (continuous) and the ISO settings from the base to `isoMax`. */
export function genericBodyExposureProfile(version: GenericTierPresetVersion, id: string, isoValues: readonly number[], isoMax: number,
  evidence: readonly EvidenceProvenance[]): GenericBodyExposureCapabilityProfile {
  const fact = <T>(value: T): EvidenceBackedFact<T> => ({ value, evidence });
  return parseGenericBodyExposureCapabilityProfile({ schemaVersion: "0.1.0", profileId: id+":exposure", profileVersion: version,
    scientificStatus: "approximation", evidence, shutter: { durationSecondsRange: fact({ minimum: 1/8000, maximum: 30 }), settingGrid: { kind: "continuous-within-range" } },
    iso: { range: fact({ minimum: isoValues[0]!, maximum: isoMax }), settingGrid: { kind: "discrete-values", values: fact(isoValues) }, autoIso: fact("supported") } });
}
/** A body's meters: the uniform multi-zone meter, and with `advancedPolicies` the highlight-weighted one; target 0.18. */
export function genericMeteringProfiles(version: GenericTierPresetVersion, id: string, advancedPolicies: boolean, evidence: readonly EvidenceProvenance[],
  limitations: readonly string[]): GenericVersionedAsset<ExposureMeteringProfile>[] {
  return [{ kind: "multi-zone-uniform" }, ...(advancedPolicies ? [{ kind: "highlight-weighted", minimumWeightFraction: .2, exponent: 2 }] : [])]
    .map((policy): GenericVersionedAsset<ExposureMeteringProfile> => ({ assetId: id+":meter:"+policy.kind, assetVersion: version,
      profile: parseExposureMeteringProfile({ schemaVersion: "0.1.0", profileId: id+":meter:"+policy.kind, scientificStatus: "approximation",
        inputDomain: "relative-pre-exposure-linear-signal", captureRegion: "oriented-active-capture", policy,
        target: { kind: "relative-signal-reference", targetRelativeSignal: .18, evidence }, evidence,
        limitations: [...limitations, "0.18 is a declared target policy, not universal scene/camera truth."] }) }));
}
/** A tier lens's exposure capabilities: a 50 mm prime, f/4–f/16, continuous. */
export function genericLensExposureProfile(version: GenericTierPresetVersion, id: string): GenericLensExposureCapabilityProfile {
  const evidence = GENERIC_TIER_EVIDENCE, fact = <T>(value: T): EvidenceBackedFact<T> => ({ value, evidence });
  return parseGenericLensExposureCapabilityProfile({ schemaVersion: "0.1.0", profileId: id+":exposure", profileVersion: version,
    scientificStatus: "approximation", evidence, focalLengthMmRange: fact({ minimum: 50, maximum: 50 }), aperture: { widestAvailableFNumber: {
      kind: "constant", fNumber: fact(4) }, narrowestAvailableFNumber: fact(16), settingGrid: { kind: "continuous-within-range" } } });
}
/** The ISO settings of a tier body: the version's list (2.0.0 whole stops, 2.1.0 third stops) up to `isoMax`. */
export function genericTierIsoValues(version: GenericTierPresetVersion, isoMax: number): number[] {
  return (version === "2.0.0" ? GENERIC_WHOLE_STOP_ISO_SETTINGS : GENERIC_THIRD_STOP_ISO_SETTINGS).filter((v) => v <= isoMax);
}

/** The exposure side of one tier: the body's exposure capabilities and meters and the lens's exposure capabilities. */
export interface GenericTierExposure {
  tier: GenericEquipmentTier;
  body: { exposure: GenericBodyExposureCapabilityProfile; metering: readonly GenericVersionedAsset<ExposureMeteringProfile>[] };
  lens: { exposure: GenericLensExposureCapabilityProfile };
}
/** The tiers' design values on the exposure side (the same as the presets of `generic-tier-assets.ts`; test/calculation-bundles.test.ts). */
export const GENERIC_TIER_EXPOSURE_DESIGN = /* @__PURE__ */ Object.freeze([
  /* @__PURE__ */ Object.freeze({ tier: "consumer", bodyId: "photivra-consumer-body", isoMax: 6400, advancedPolicies: false, lensId: "photivra-consumer-prime" }),
  /* @__PURE__ */ Object.freeze({ tier: "prosumer", bodyId: "photivra-prosumer-body", isoMax: 12800, advancedPolicies: true, lensId: "photivra-prosumer-prime" }),
  /* @__PURE__ */ Object.freeze({ tier: "professional", bodyId: "photivra-professional-body", isoMax: 25600, advancedPolicies: true, lensId: "photivra-professional-prime" })
] as const);
const built = /* @__PURE__ */ new Map<GenericTierPresetVersion, readonly GenericTierExposure[]>();
/** The exposure side of the tiers of an exact version, in tier order (consumer, prosumer, professional), deep-frozen; built on first use. */
export function genericTierExposure(version: GenericTierPresetVersion): readonly GenericTierExposure[] {
  let tiers = built.get(version);
  if (!tiers) {
    tiers = freezeOwnedData(GENERIC_TIER_EXPOSURE_DESIGN.map((d): GenericTierExposure => ({ tier: d.tier,
      body: { exposure: genericBodyExposureProfile(version, d.bodyId, genericTierIsoValues(version, d.isoMax), d.isoMax, GENERIC_TIER_EVIDENCE),
        metering: genericMeteringProfiles(version, d.bodyId, d.advancedPolicies, GENERIC_TIER_EVIDENCE, GENERIC_TIER_LIMITATIONS) },
      lens: { exposure: genericLensExposureProfile(version, d.lensId) } })));
    built.set(version, tiers);
  }
  return tiers;
}
