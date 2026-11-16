// SPDX-License-Identifier: Apache-2.0

/**
 * Fixed-pattern noise (FPN): the part of sensor noise that stays the same from shot to shot for one
 * physical sensor. It covers photo-response non-uniformity (PRNU), dark-signal non-uniformity (DSNU),
 * hot pixels and row and column readout offsets, as defined in EMVA Standard 1288 Release 4.0 (spatial
 * non-uniformity of the photo response and of the dark signal).
 *
 * The pattern is deterministic. It is seeded from an explicit sensor-instance seed and absolute
 * colour-sampling site coordinates, never from the per-capture noise seed, so the same sensor shows
 * the same pattern in every capture.
 *
 * Application points in the readout chain (see raw-readout.ts):
 * - PRNU multiplies the expected photo charge before photo shot-noise sampling;
 * - DSNU and hot pixels multiply the population-mean dark-current expectation before dark shot-noise
 *   sampling, so their excess charge scales with exposure duration and with the declared
 *   temperature model of the dark-current profile;
 * - row and column offsets are input-referred electron offsets added with read noise, before the
 *   pre-ADC threshold.
 *
 * The dark-current model itself stays a population mean; this module is a separate spatial model that
 * must be attached explicitly. Values are declared by the caller (or are synthetic preset values).
 * Nothing here is a measured calibration.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { parseEvidenceList, type EvidenceBackedFact, type EvidenceProvenance } from "../core/evidence-provenance.js";
import { requireAllowlistedRecord, requirePublicOpaqueId, requireInputKeys } from "../core/record-validation.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  createDeterministicUniformStream,
  deriveSensorFixedPatternSeedUint32,
  sampleDeterministicStandardNormal,
  SENSOR_FIXED_PATTERN_COLUMN_STREAM_ID,
  SENSOR_FIXED_PATTERN_DSNU_STREAM_ID,
  SENSOR_FIXED_PATTERN_HOT_PIXEL_STREAM_ID,
  SENSOR_FIXED_PATTERN_PRNU_STREAM_ID,
  SENSOR_FIXED_PATTERN_ROW_STREAM_ID
} from "./stochastic-seed.js";

export const SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION = "0.1.0" as const;
/** Versioned identity of the pattern-generation equations and seed schedule. */
export const SENSOR_FIXED_PATTERN_NOISE_MODEL = /* @__PURE__ */ Object.freeze({ id: "photivra-sensor-fixed-pattern", version: "1.0.0" } as const);

/**
 * Explicit fixed-pattern parameters for one sensor instance. Every component is required; a zero
 * standard deviation, fraction or RMS disables that component.
 */
export interface SensorFixedPatternNoiseProfile {
  schemaVersion: typeof SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  /** The colour-sampling grid whose absolute site coordinates index the pattern. */
  colorSamplingProfileId: string;
  scientificStatus: "approximation";
  /** Identifies the physical sensor. Independent of every per-capture noise seed. */
  sensorInstanceSeedUint32: number;
  /** EMVA 1288 PRNU: spatial standard deviation of the photo response divided by its mean. */
  photoResponseNonUniformity: { relativeStandardDeviation: EvidenceBackedFact<number> };
  /** Spatial standard deviation of the dark-current rate divided by the population-mean rate. */
  darkSignalNonUniformity: { relativeStandardDeviation: EvidenceBackedFact<number> };
  /** Fraction of sites whose dark-current rate is the population mean times the multiplier. */
  hotPixels: { siteFraction: EvidenceBackedFact<number>; darkCurrentMultiplier: EvidenceBackedFact<number> };
  /** Fixed readout offset per row, in input-referred electrons, normally distributed with zero mean. */
  rowOffset: { rmsElectrons: EvidenceBackedFact<number> };
  /** Fixed readout offset per column, in input-referred electrons, normally distributed with zero mean. */
  columnOffset: { rmsElectrons: EvidenceBackedFact<number> };
  patternDistribution: "normal-factors-truncated-at-zero";
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

/** The deterministic pattern values of one colour-sampling site. */
export interface SensorFixedPatternSiteValues {
  profileId: string;
  modelId: typeof SENSOR_FIXED_PATTERN_NOISE_MODEL.id;
  modelVersion: typeof SENSOR_FIXED_PATTERN_NOISE_MODEL.version;
  site: { x: number; y: number };
  /** Multiplies the expected photo charge (1 = no PRNU); never negative. */
  photoResponseGainFactor: number;
  /** Multiplies the population-mean dark expectation (1 = no DSNU); never negative. */
  darkCurrentFactor: number;
  hotPixel: boolean;
  rowOffsetElectrons: number;
  columnOffsetElectrons: number;
  /** rowOffsetElectrons + columnOffsetElectrons, added at readout. */
  readoutOffsetElectrons: number;
}

const FACT_KEYS = ["value", "evidence"];

function fact(value: unknown, path: string, maximum: number, minimum = 0): EvidenceBackedFact<number> {
  const record = requireAllowlistedRecord(value, FACT_KEYS, path + " must be an evidence-backed fact.");
  const v = record.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v < minimum || v > maximum) {
    throw new InvalidConfigurationError(path + ".value must be finite from " + minimum + " through " + maximum + ".");
  }
  return { value: v, evidence: parseEvidenceList(record.evidence, path + ".evidence") };
}

function limitations(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new InvalidConfigurationError("sensorFixedPatternNoise.limitations must be an array of non-empty strings.");
  }
  if (new Set(value).size !== value.length) {
    throw new InvalidConfigurationError("sensorFixedPatternNoise.limitations must not contain duplicates.");
  }
  return value.map((entry: string) => entry.trim());
}

/**
 * Validates an untrusted fixed-pattern noise profile. Unknown keys, out-of-range parameters and
 * missing evidence are rejected. The PRNU and DSNU relative standard deviations are limited to 0.5
 * and 5, and the hot-pixel multiplier to 1–1e6.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The validated profile.
 * @see docs/MOTION_AND_SIGNAL.md for the model and its sources.
 */
export function parseSensorFixedPatternNoiseProfile(value: unknown): SensorFixedPatternNoiseProfile {
  const r = requireAllowlistedRecord(value, ["schemaVersion", "profileId", "colorSamplingProfileId", "scientificStatus",
    "sensorInstanceSeedUint32", "photoResponseNonUniformity", "darkSignalNonUniformity", "hotPixels", "rowOffset", "columnOffset",
    "patternDistribution", "evidence", "limitations"], "Invalid sensor fixed-pattern noise profile fields.");
  if (r.schemaVersion !== SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION) {
    throw new InvalidConfigurationError('sensorFixedPatternNoise.schemaVersion must be "' + SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION + '".');
  }
  if (r.scientificStatus !== "approximation") {
    throw new InvalidConfigurationError('sensorFixedPatternNoise.scientificStatus must be "approximation".');
  }
  if (r.patternDistribution !== "normal-factors-truncated-at-zero") {
    throw new InvalidConfigurationError('sensorFixedPatternNoise.patternDistribution must be "normal-factors-truncated-at-zero".');
  }
  const seed = r.sensorInstanceSeedUint32;
  if (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new InvalidConfigurationError("sensorFixedPatternNoise.sensorInstanceSeedUint32 must be an unsigned 32-bit integer.");
  }
  const prnu = requireAllowlistedRecord(r.photoResponseNonUniformity, ["relativeStandardDeviation"], "Invalid PRNU fields.");
  const dsnu = requireAllowlistedRecord(r.darkSignalNonUniformity, ["relativeStandardDeviation"], "Invalid DSNU fields.");
  const hot = requireAllowlistedRecord(r.hotPixels, ["siteFraction", "darkCurrentMultiplier"], "Invalid hot-pixel fields.");
  const row = requireAllowlistedRecord(r.rowOffset, ["rmsElectrons"], "Invalid row-offset fields.");
  const column = requireAllowlistedRecord(r.columnOffset, ["rmsElectrons"], "Invalid column-offset fields.");
  return {
    schemaVersion: SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION,
    profileId: requirePublicOpaqueId(r.profileId, "sensorFixedPatternNoise.profileId must be a public opaque identifier."),
    colorSamplingProfileId: requirePublicOpaqueId(r.colorSamplingProfileId, "sensorFixedPatternNoise.colorSamplingProfileId must be a public opaque identifier."),
    scientificStatus: "approximation",
    sensorInstanceSeedUint32: seed,
    photoResponseNonUniformity: { relativeStandardDeviation: fact(prnu.relativeStandardDeviation, "photoResponseNonUniformity.relativeStandardDeviation", 0.5) },
    darkSignalNonUniformity: { relativeStandardDeviation: fact(dsnu.relativeStandardDeviation, "darkSignalNonUniformity.relativeStandardDeviation", 5) },
    hotPixels: { siteFraction: fact(hot.siteFraction, "hotPixels.siteFraction", 1),
      darkCurrentMultiplier: fact(hot.darkCurrentMultiplier, "hotPixels.darkCurrentMultiplier", 1e6, 1) },
    rowOffset: { rmsElectrons: fact(row.rmsElectrons, "rowOffset.rmsElectrons", 1e6) },
    columnOffset: { rmsElectrons: fact(column.rmsElectrons, "columnOffset.rmsElectrons", 1e6) },
    patternDistribution: "normal-factors-truncated-at-zero",
    evidence: parseEvidenceList(r.evidence, "sensorFixedPatternNoise.evidence"),
    limitations: limitations(r.limitations)
  };
}

/**
 * #637: the pattern of a rendered site that sums n ≥ 1 photosites of a k × k block (k = √n, any real k), from the photosite's own
 * statistics, so the site's values are drawn once per site from the summed distribution:
 *
 * - PRNU and DSNU: the mean of n independent factors, σ/√n;
 * - hot pixels: a site holds at least one hot photosite with probability P = 1 − (1 − f)ⁿ; such a site's dark factor is
 *   1 + (m − 1)·f/P, its mean over the n photosites with the expected hot count given that there is one (f·n/P), so the mean dark charge is kept
 *   (an approximation: one hot state per site, with the dark factor of the expected count);
 * - row and column offsets: a site row sums k photosites in each of its k photosite rows, k·Σ rⱼ, σ_row·k^(3/2) = σ_row·n^(3/4)
 *   (columns alike), still shared along the site row (column).
 *
 * n = 1 returns the profile itself.
 */
export function sumFixedPatternSites(p: SensorFixedPatternNoiseProfile, n: number): SensorFixedPatternNoiseProfile {
  if (n === 1) return p;
  const at = (fact: EvidenceBackedFact<number>, value: number): EvidenceBackedFact<number> => ({ ...fact, value }), s = Math.sqrt(n), k = n ** 0.75;
  const f = p.hotPixels.siteFraction.value, hot = -Math.expm1(n * Math.log1p(-f)), m = p.hotPixels.darkCurrentMultiplier;
  return { ...p, photoResponseNonUniformity: { relativeStandardDeviation: at(p.photoResponseNonUniformity.relativeStandardDeviation, p.photoResponseNonUniformity.relativeStandardDeviation.value / s) },
    darkSignalNonUniformity: { relativeStandardDeviation: at(p.darkSignalNonUniformity.relativeStandardDeviation, p.darkSignalNonUniformity.relativeStandardDeviation.value / s) },
    hotPixels: { siteFraction: at(p.hotPixels.siteFraction, hot), darkCurrentMultiplier: at(m, hot > 0 ? 1 + (m.value - 1) * f / hot : m.value) },
    rowOffset: { rmsElectrons: at(p.rowOffset.rmsElectrons, p.rowOffset.rmsElectrons.value * k) }, columnOffset: { rmsElectrons: at(p.columnOffset.rmsElectrons, p.columnOffset.rmsElectrons.value * k) } };
}

function normal(seed: number, x: number, y: number, stream: number): number {
  return sampleDeterministicStandardNormal(createDeterministicUniformStream(deriveSensorFixedPatternSeedUint32(seed, x, y, stream)));
}

/**
 * Computes the fixed-pattern values of one absolute colour-sampling site.
 *
 * - PRNU gain g = max(0, 1 + σ_PRNU·z₁);
 * - hot pixel when u < f_hot, then dark factor d = m_hot; otherwise d = max(0, 1 + σ_DSNU·z₂);
 * - row offset σ_row·z(row y), column offset σ_col·z(column x), in input-referred electrons.
 *
 * Each z is a standard normal value and u a uniform value, each from its own stream hashed with
 * MurmurHash3 from (sensorInstanceSeed, x, y, stream). Row values use x = 0 and column values y = 0,
 * so a whole row or column shares one value. Cutting negative factors off at zero shifts the mean
 * factor by less than 1e-6 for σ ≤ 0.2.
 * @param input - A parsed or untrusted profile plus a nonnegative integer site.
 * @returns The site's fixed-pattern values.
 */
export function calculateSensorFixedPatternSite(input: {
  profile: SensorFixedPatternNoiseProfile; site: { x: number; y: number };
}): SensorFixedPatternSiteValues {
  requireInputKeys(input, "calculateSensorFixedPatternSite", ["profile", "site"]);
  const profile = parseSensorFixedPatternNoiseProfile(input.profile);
  return evaluateParsedFixedPatternSite(profile, input.site);
}

/** Internal: the PRNU gain, dark-current factor and hot-pixel state of one site (no readout offsets). */
export function evaluateFixedPatternSiteFactors(profile: SensorFixedPatternNoiseProfile, x: number, y: number):
  { photoResponseGainFactor: number; darkCurrentFactor: number; hotPixel: boolean } {
  const seed = profile.sensorInstanceSeedUint32;
  const prnuSd = profile.photoResponseNonUniformity.relativeStandardDeviation.value;
  const dsnuSd = profile.darkSignalNonUniformity.relativeStandardDeviation.value;
  const hotFraction = profile.hotPixels.siteFraction.value;
  const photoResponseGainFactor = prnuSd === 0 ? 1 : Math.max(0, 1 + prnuSd * normal(seed, x, y, SENSOR_FIXED_PATTERN_PRNU_STREAM_ID));
  const hotPixel = hotFraction > 0 &&
    createDeterministicUniformStream(deriveSensorFixedPatternSeedUint32(seed, x, y, SENSOR_FIXED_PATTERN_HOT_PIXEL_STREAM_ID)).next() < hotFraction;
  const darkCurrentFactor = hotPixel ? profile.hotPixels.darkCurrentMultiplier.value :
    dsnuSd === 0 ? 1 : Math.max(0, 1 + dsnuSd * normal(seed, x, y, SENSOR_FIXED_PATTERN_DSNU_STREAM_ID));
  return { photoResponseGainFactor, darkCurrentFactor, hotPixel };
}

/** Internal: the fixed readout offset of row `y`, in input-referred electrons. */
export function evaluateFixedPatternRowOffset(profile: SensorFixedPatternNoiseProfile, y: number): number {
  const rms = profile.rowOffset.rmsElectrons.value;
  return rms === 0 ? 0 : rms * normal(profile.sensorInstanceSeedUint32, 0, y, SENSOR_FIXED_PATTERN_ROW_STREAM_ID);
}

/** Internal: the fixed readout offset of column `x`, in input-referred electrons. */
export function evaluateFixedPatternColumnOffset(profile: SensorFixedPatternNoiseProfile, x: number): number {
  const rms = profile.columnOffset.rmsElectrons.value;
  return rms === 0 ? 0 : rms * normal(profile.sensorInstanceSeedUint32, x, 0, SENSOR_FIXED_PATTERN_COLUMN_STREAM_ID);
}

/** Internal: the same calculation for an already parsed profile. */
export function evaluateParsedFixedPatternSite(profile: SensorFixedPatternNoiseProfile,
  site: { x: number; y: number }): SensorFixedPatternSiteValues {
  const { x, y } = site ?? {};
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x > 0xffff_ffff || y > 0xffff_ffff) {
    throw new InvalidScientificInputError("Fixed-pattern site coordinates must be nonnegative uint32 integers.");
  }
  const { photoResponseGainFactor, darkCurrentFactor, hotPixel } = evaluateFixedPatternSiteFactors(profile, x, y);
  const rowOffsetElectrons = evaluateFixedPatternRowOffset(profile, y);
  const columnOffsetElectrons = evaluateFixedPatternColumnOffset(profile, x);
  return {
    profileId: profile.profileId,
    modelId: SENSOR_FIXED_PATTERN_NOISE_MODEL.id,
    modelVersion: SENSOR_FIXED_PATTERN_NOISE_MODEL.version,
    site: { x, y },
    photoResponseGainFactor,
    darkCurrentFactor,
    hotPixel,
    rowOffsetElectrons,
    columnOffsetElectrons,
    readoutOffsetElectrons: rowOffsetElectrons + columnOffsetElectrons
  };
}
