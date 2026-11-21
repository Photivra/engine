// SPDX-License-Identifier: Apache-2.0

/**
 * Sensor profiles (#554): the profile record, its strict parser and the camera-body sensor assets built from it. The
 * catalogue's data are in `sensor-profiles.ts`, which nothing in a capture imports: a caller passes a profile record
 * (`simulateCapture({ sensor: { profile: SENSOR_PROFILES[i] } })`), so a capture bundle never contains the catalogue.
 *
 * ISO rating (owner decision, 2026-11-09): each profile's base ISO is re-rated from its full well, QE and pixel area,
 * S0 = 100 · (η / 0.5) · (A / 36 µm²) · (60 000 e⁻ / FW), rounded to the nearest third-stop marking, so the RAW white at base
 * ISO is the full well and every ISO keeps the engine's anchor (the Professional tier's ISO 100: 60 000 e⁻ at the white,
 * 6 µm pixels, QE 0.5; S = 10/H, CIPA DC-004-2020 §3.2). The rounding is reported as `sensitivityOffsetStops` in the
 * `sensor.profile` assumption. The high gain's charge storage is the white charge at its switch ISO.
 * @see docs/SENSOR_PROFILES.md for every value's source or design basis.
 */

import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import { bodyAssets, type GenericTierBodyAssets, type GenericTierPresetVersion } from "./generic-tier-assets.js";

import { parseSensorProfile, SENSOR_PROFILE_ISO_MARKINGS, type SensorProfile } from "./sensor-profile-record.js";

// #646: the record, its ISO markings and its parser are in sensor-profile-record.ts (no tier assets); re-exported unchanged.
export { parseSensorProfile, SENSOR_PROFILE_ISO_MARKINGS, type SensorProfile, type SensorProfileValueKind } from "./sensor-profile-record.js";
const ISO_MARKINGS = SENSOR_PROFILE_ISO_MARKINGS;

/** The engine's ISO anchor (see the module comment): white charge 60 000 e⁻ at ISO 100, 36 µm², QE 0.5. */
export const SENSOR_PROFILE_ISO_ANCHOR = /* @__PURE__ */ Object.freeze({ iso: 100, fullWellElectrons: 60000, pixelAreaSquareMicrometers: 36, peakQuantumEfficiency: .5 });
/** The unrounded re-rated base ISO S0 = 100 · (η/0.5) · (A/36 µm²) · (60 000 e⁻ / FW). */
export function sensorProfileSaturationIso(p: Pick<SensorProfile, "peakQuantumEfficiency" | "pixelPitchMicrometers" | "fullWellElectrons">): number {
  const a = SENSOR_PROFILE_ISO_ANCHOR;
  return a.iso * p.peakQuantumEfficiency / a.peakQuantumEfficiency * p.pixelPitchMicrometers ** 2 / a.pixelAreaSquareMicrometers * a.fullWellElectrons / p.fullWellElectrons;
}

/**
 * #635: the profile's ISO settings, the third-stop markings from its base ISO to its maximum ({@link SENSOR_PROFILE_ISO_MARKINGS}): the
 * values `exposure.iso` takes with this profile, in ascending order. The record is checked as a capture checks it.
 */
export function resolveSensorProfileIsoSettings(profile: SensorProfile): readonly number[] {
  const p = parseSensorProfile(profile, "profile");
  return Object.freeze(isoSettings(p));
}
const isoSettings = (p: SensorProfile): number[] => ISO_MARKINGS.filter((iso) => iso >= p.baseIso && iso <= p.maximumIso);


/**
 * The profile's sensor assets on a camera body: the body's other capabilities are kept. `readNoiseScale` (≥ 1) multiplies both
 * read noises: √N for a site that sums N photosites (a downsized view, #554).
 */
export function sensorProfileBody(p: SensorProfile, body: GenericTierBodyAssets, version: GenericTierPresetVersion, readNoiseScale = 1): GenericTierBodyAssets {
  const evidence: readonly EvidenceProvenance[] = [{ sourceOrigin: "manufacturer", sourceReference: "photivra:sensor-profiles-v1#" + p.id, reuseStatus: "factual-reference-only",
    note: "Published specifications and open papers; other values are Photivra design values (docs/SENSOR_PROFILES.md)." }];
  const black = { 12: 256, 14: 1024, 16: 4096 }[p.adcBitDepth], n = p.readNoise;
  const built = bodyAssets(version, "photivra-sensor-profile-" + p.id, p.maximumIso, 1, 1, { bitDepth: p.adcBitDepth, blackLevelCode: black,
    saturationElectrons: p.fullWellElectrons, maximumAnalogGain: p.maximumAnalogGain, lowGainReadNoise: n.lowGainElectrons * readNoiseScale, highGainReadNoise: n.highGainElectrons * readNoiseScale,
    highGainFromIso: n.highGainFromIso ?? Infinity, highGainMaximumCharge: (p.highGainFullWellElectrons ?? p.fullWellElectrons) * (1 + 1e-12),
    prnu: p.fixedPattern.prnu, dsnu: p.fixedPattern.dsnu, hotFraction: p.fixedPattern.hotPixelFraction, hotMultiplier: p.fixedPattern.hotPixelMultiplier,
    rowRms: p.fixedPattern.rowElectrons, columnRms: p.fixedPattern.columnElectrons, instanceSeed: (0x9e3779b9 ^ (p.pixelsWide * 8191 + p.pixelsHigh)) >>> 0 },
  p.readoutSeconds, .5, .01, false, false, { isoValues: isoSettings(p), evidence,
    limitations: ["Sensor profile " + p.name + " (#554): published, derived and design values; not a camera calibration."] });
  // Only the sensor assets are taken; the placeholders above (release, stabilization …) are the body's own.
  return { ...body, exposure: built.exposure, iso: built.iso, signalChain: built.signalChain, readout: built.readout, readoutTiming: built.readoutTiming,
    rollingReadoutTiming: built.rollingReadoutTiming, fixedPatternNoise: built.fixedPatternNoise, flashSync: built.flashSync };
}
