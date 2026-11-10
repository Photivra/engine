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

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import { bodyAssets, GENERIC_THIRD_STOP_ISO_SETTINGS, type GenericTierBodyAssets, type GenericTierPresetVersion } from "./generic-tier-assets.js";

/** How a profile value was obtained: copied from a source, calculated from sourced values, or Photivra's design value. */
export type SensorProfileValueKind = "published" | "derived" | "design";

/** One sensor profile. Every number is per photosite unless stated; see `provenance` for each value's kind. */
export interface SensorProfile {
  id: string;
  /** Format, resolution, architecture and era; no maker or product name. */
  name: string;
  /** A market category, not a specification: it is a label and changes nothing. */
  marketTag: "consumer" | "professional";
  architecture: "front-illuminated" | "back-illuminated" | "stacked";
  sensorWidthMm: number; sensorHeightMm: number;
  pixelsWide: number; pixelsHigh: number;
  pixelPitchMicrometers: number;
  /** The green channel's peak EQE (#555 `peakQuantumEfficiency`). */
  peakQuantumEfficiency: number;
  /** Full-well capacity, e⁻: the charge at the RAW white level at base ISO. */
  fullWellElectrons: number;
  /** Read noise, RMS e⁻; `highGainFromIso` null for one conversion gain throughout. */
  readNoise: { lowGainElectrons: number; highGainElectrons: number; highGainFromIso: number | null };
  /** Charge storage limit of the high conversion gain, e⁻ (null without one): full well × base ISO / switch ISO. */
  highGainFullWellElectrons: number | null;
  adcBitDepth: 12 | 14 | 16;
  /** Re-rated base ISO (see the module comment) and the highest ISO setting. */
  baseIso: number; maximumIso: number;
  /** Largest analog gain relative to base ISO; above it the gain is digital. */
  maximumAnalogGain: number;
  /** Rolling readout, s: the top-to-bottom skew with `motion.shutter: "rolling"`. */
  readoutSeconds: number;
  /** Fixed-pattern noise used with `sensor.fixedPatternNoise` (EMVA 1288 Release 4.0 non-uniformities). */
  fixedPattern: { prnu: number; dsnu: number; hotPixelFraction: number; hotPixelMultiplier: number; rowElectrons: number; columnElectrons: number };
  /** What the profile is good for (text only). */
  goodFor: readonly string[];
  description: string;
  /** "phone": the profile takes only the catalogue's phone lenses (`lens.catalogue`), which need it. */
  fixedLenses: "phone" | null;
  /**
   * Each value's kind and source key (S1–S10, docs/SENSOR_PROFILES.md "Sources"); a value not listed is a design value.
   * For example `fullWellElectrons: "published S1"` or `baseIso: "derived"`.
   */
  provenance: Readonly<Partial<Record<keyof SensorProfile | "sensorSize" | "pixels" | "highGainFromIso", string>>>;
}

/** Third-stop ISO markings from ISO 32 to 102 400 (S = 100·2^(k/3), rounded; the tiers' list in the middle): a profile's ISO settings. */
export const SENSOR_PROFILE_ISO_MARKINGS: readonly number[] = /* @__PURE__ */ Object.freeze([32, 40, 50, 64, 80, ...GENERIC_THIRD_STOP_ISO_SETTINGS, 32000, 40000, 51200, 64000, 80000, 102400]);
const ISO_MARKINGS = SENSOR_PROFILE_ISO_MARKINGS;

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };
const isoMarking = (v: unknown): boolean => ISO_MARKINGS.includes(v as number);
type Spec = readonly [number, number] | readonly unknown[] | "text" | "texts" | "kinds" | { readonly [key: string]: Spec } | ((v: unknown) => boolean);
const FRACTION = [0, 1] as const, ELECTRONS = [0, 100] as const;
/** The record's fields: [minimum, maximum] (a number), a list of the values allowed, text, or a nested record. */
const SCHEMA: { readonly [key: string]: Spec } = { id: "text", name: "text", marketTag: ["consumer", "professional"], architecture: ["front-illuminated", "back-illuminated", "stacked"],
  sensorWidthMm: [1, 100], sensorHeightMm: [1, 100], pixelsWide: [1, 1e5], pixelsHigh: [1, 1e5], pixelPitchMicrometers: [0.5, 100], peakQuantumEfficiency: [0.05, 0.9],
  fullWellElectrons: [100, 1e10], readNoise: { lowGainElectrons: ELECTRONS, highGainElectrons: ELECTRONS, highGainFromIso: (v) => v === null || isoMarking(v) },
  highGainFullWellElectrons: (v) => v === null || typeof v === "number" && v >= 1 && v <= 1e10, adcBitDepth: [12, 14, 16], baseIso: isoMarking, maximumIso: isoMarking,
  maximumAnalogGain: [1, 1024], readoutSeconds: [1e-6, 1], fixedPattern: { prnu: FRACTION, dsnu: [0, 100], hotPixelFraction: FRACTION, hotPixelMultiplier: [1, 1e4],
    rowElectrons: ELECTRONS, columnElectrons: ELECTRONS }, goodFor: "texts", description: "text", fixedLenses: [null, "phone"], provenance: "kinds" };
const text = (v: unknown): boolean => typeof v === "string" && v.length > 0 && v.length <= 400;
function check(value: unknown, schema: { readonly [key: string]: Spec }, path: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path + " must be a sensor profile record (SENSOR_PROFILES).");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!(key in schema)) fail(path + " has unknown field \"" + key + "\".");
  for (const [key, spec] of Object.entries(schema)) {
    const v = record[key], at = path + "." + key;
    if (typeof spec === "function" || typeof spec === "string" || Array.isArray(spec)) {
      const ok = typeof spec === "function" ? spec(v) : spec === "text" ? text(v) : spec === "texts" ? Array.isArray(v) && v.length <= 16 && v.every(text) :
        spec === "kinds" ? typeof v === "object" && v !== null && !Array.isArray(v) && Object.entries(v).every(([k, s]) => k.length <= 64 && text(s)) :
        typeof spec[0] === "number" && spec.length === 2 ? typeof v === "number" && v >= (spec[0] as number) && v <= (spec[1] as number) : spec.includes(v);
      if (!ok) fail(at + " is missing or out of range.");
    } else check(v, spec as { readonly [key: string]: Spec }, at);
  }
}
/**
 * The profile record checked strictly: every field present, no unknown field, each value in range, base ISO no higher than
 * the maximum, and a dual-gain switch above base ISO with its storage limit (no switch: one read noise, no storage limit).
 * Fixed-pattern magnitudes and the ISO regimes are checked again by the engine's parsers when the body is built.
 */
export function parseSensorProfile(value: unknown, path = "sensor.profile"): SensorProfile {
  check(value, SCHEMA, path);
  const p = value as SensorProfile, n = p.readNoise;
  if (!Number.isInteger(p.pixelsWide) || !Number.isInteger(p.pixelsHigh)) fail(path + ".pixelsWide and pixelsHigh must be whole numbers.");
  if (p.baseIso > p.maximumIso) fail(path + ".baseIso must not exceed maximumIso.");
  if (n.highGainFromIso === null ? p.highGainFullWellElectrons !== null || n.highGainElectrons !== n.lowGainElectrons :
    p.highGainFullWellElectrons === null || n.highGainFromIso <= p.baseIso || p.highGainFullWellElectrons > p.fullWellElectrons)
    fail(path + ": a dual-gain switch above baseIso needs highGainFullWellElectrons up to the full well; without one, equal read noises and a null storage.");
  return p;
}

/** The engine's ISO anchor (see the module comment): white charge 60 000 e⁻ at ISO 100, 36 µm², QE 0.5. */
export const SENSOR_PROFILE_ISO_ANCHOR = /* @__PURE__ */ Object.freeze({ iso: 100, fullWellElectrons: 60000, pixelAreaSquareMicrometers: 36, peakQuantumEfficiency: .5 });
/** The unrounded re-rated base ISO S0 = 100 · (η/0.5) · (A/36 µm²) · (60 000 e⁻ / FW). */
export function sensorProfileSaturationIso(p: Pick<SensorProfile, "peakQuantumEfficiency" | "pixelPitchMicrometers" | "fullWellElectrons">): number {
  const a = SENSOR_PROFILE_ISO_ANCHOR;
  return a.iso * p.peakQuantumEfficiency / a.peakQuantumEfficiency * p.pixelPitchMicrometers ** 2 / a.pixelAreaSquareMicrometers * a.fullWellElectrons / p.fullWellElectrons;
}


/** The profile's sensor assets on a camera body: the body's other capabilities are kept. */
export function sensorProfileBody(p: SensorProfile, body: GenericTierBodyAssets, version: GenericTierPresetVersion): GenericTierBodyAssets {
  const evidence: readonly EvidenceProvenance[] = [{ sourceOrigin: "manufacturer", sourceReference: "photivra:sensor-profiles-v1#" + p.id, reuseStatus: "factual-reference-only",
    note: "Published specifications and open papers (docs/SENSOR_PROFILES.md); unpublished values are Photivra design values." }];
  const black = { 12: 256, 14: 1024, 16: 4096 }[p.adcBitDepth], n = p.readNoise;
  const built = bodyAssets(version, "photivra-sensor-profile-" + p.id, p.maximumIso, 1, 1, { bitDepth: p.adcBitDepth, blackLevelCode: black,
    saturationElectrons: p.fullWellElectrons, maximumAnalogGain: p.maximumAnalogGain, lowGainReadNoise: n.lowGainElectrons, highGainReadNoise: n.highGainElectrons,
    highGainFromIso: n.highGainFromIso ?? Infinity, highGainMaximumCharge: (p.highGainFullWellElectrons ?? p.fullWellElectrons) * (1 + 1e-12),
    prnu: p.fixedPattern.prnu, dsnu: p.fixedPattern.dsnu, hotFraction: p.fixedPattern.hotPixelFraction, hotMultiplier: p.fixedPattern.hotPixelMultiplier,
    rowRms: p.fixedPattern.rowElectrons, columnRms: p.fixedPattern.columnElectrons, instanceSeed: (0x9e3779b9 ^ (p.pixelsWide * 8191 + p.pixelsHigh)) >>> 0 },
  p.readoutSeconds, .5, .01, false, false, { isoValues: ISO_MARKINGS.filter((iso) => iso >= p.baseIso && iso <= p.maximumIso), evidence,
    limitations: ["Sensor profile " + p.name + " (#554): published, derived and design values (docs/SENSOR_PROFILES.md); not a calibration of any camera."] });
  // Only the sensor assets are taken; the placeholders above (release, stabilization …) are the body's own.
  return { ...body, exposure: built.exposure, iso: built.iso, signalChain: built.signalChain, readout: built.readout, readoutTiming: built.readoutTiming,
    rollingReadoutTiming: built.rollingReadoutTiming, fixedPatternNoise: built.fixedPatternNoise, flashSync: built.flashSync };
}
