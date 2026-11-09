// SPDX-License-Identifier: Apache-2.0

/**
 * ISO gain: builds one explicit readout regime for each ISO (exposure index) setting from declared
 * sensor parameters, so that raising ISO brightens the RAW the way a camera's programmable gain does.
 *
 * Model (exposure index S = 10 / H of CIPA DC-004-2020, free at https://www.cipa.jp/e/std/std-sec.html,
 * also specified in ISO 12232:2019; EMVA Standard 1288 Release 4.0 linear camera model,
 * where the system gain K in DN/e- multiplies the electron signal):
 *   R = S / S0                      exposure-index ratio to the base exposure index S0
 *   a = min(R, A_max)               analog (pre-ADC) gain relative to the base regime
 *   d = R / a                       post-ADC digital gain beyond the analog range
 *   g(S) = Q0 / (span * a)          electrons per code (1/K), span = digitalSaturation - black
 *   Q_preADC(S) = Q0 / a            electrons that drive the ADC to digital saturation
 * So the electrons needed to reach digital saturation are Q0 * S0 / S.
 *
 * The exposure indices of CIPA DC-004 put the reference exposure H_ref in proportion to 1/S: standard
 * output sensitivity (SOS) and REI (recommended exposure index) both use S = 10 / H (§3.2, §3.3). So a
 * correct exposure for S gives the same black-subtracted fraction of digital saturation at every S.
 *
 * Read noise in electrons is declared per conversion-gain mode, never derived from S. (With dual
 * conversion gain, the high-conversion-gain mode used at high S has lower input-referred read noise.)
 *
 * Inputs are explicit declarations; Photivra presets use synthetic teaching values. No camera
 * calibration is implied.
 * @see docs/MOTION_AND_SIGNAL.md for equations, sources and limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { parseEvidenceList, type EvidenceBackedFact, type EvidenceProvenance } from "../core/evidence-provenance.js";
import { requireAllowlistedRecord, requirePublicOpaqueId, requireConfigPositiveFinite as positive } from "../core/record-validation.js";
import { parseSensorReadoutConversionProfile, type SensorReadoutConversionRegime,
  type SensorReadoutExposureIndexGain } from "./raw-readout.js";
import type { GenericIsoStandardRegimeBand } from "./iso-signal-chain.js";
import type { SensorSpectralResponseScientificStatus } from "./spectral-response.js";

/** One conversion-gain mode, active from its minimum exposure index up to the next mode's. */
export interface IsoGainConversionGainMode {
  mode: SensorReadoutExposureIndexGain["conversionGainMode"];
  minimumExposureIndex: number;
  readNoiseRmsElectrons: EvidenceBackedFact<number>;
  /** Optional charge storage limit of this mode. Every regime's pre-ADC threshold must be at or below it. */
  maximumChargeElectrons?: EvidenceBackedFact<number>;
}

export interface CreateIsoGainReadoutRegimesInput {
  regimeIdPrefix: string;
  scientificStatus: SensorSpectralResponseScientificStatus;
  baseExposureIndex: number;
  /** Strictly increasing settings, each at least the base exposure index. */
  exposureIndices: readonly number[];
  /** Q0: electron-equivalent signal that reaches digital saturation at the base exposure index. */
  baseSaturationElectronEquivalent: EvidenceBackedFact<number>;
  /** A_max: largest analog gain relative to the base regime (>= 1). */
  maximumAnalogGain: EvidenceBackedFact<number>;
  adc: { bitDepth: number; blackLevelCode: number; digitalSaturationCode: number };
  conversionGainModes: readonly IsoGainConversionGainMode[];
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface IsoGainReadoutRegimes {
  regimes: readonly SensorReadoutConversionRegime[];
  /** One single-value band per setting, ready for a GenericIsoSignalChainProfile. */
  standardRegimeBands: readonly GenericIsoStandardRegimeBand[];
}

function positiveFact(value: unknown, path: string): EvidenceBackedFact<number> {
  const r = requireAllowlistedRecord(value, ["value", "evidence"], path + " must be an evidence-backed fact.");
  return { value: positive(r.value, path + ".value"), evidence: parseEvidenceList(r.evidence, path + ".evidence") };
}

/**
 * Builds a readout regime and signal-chain band for each exposure index (see the module comment
 * for the equations). The result is checked with the same rules as parseSensorReadoutConversionProfile.
 * Each regime carries an `exposureIndexGain` record of how it was derived.
 * @param input - The sensor parameters and ISO settings; untrusted values are validated.
 * @returns The readout regimes and bands.
 */
export function createIsoGainReadoutRegimes(input: CreateIsoGainReadoutRegimesInput): IsoGainReadoutRegimes {
  const r = requireAllowlistedRecord(input, ["regimeIdPrefix", "scientificStatus", "baseExposureIndex", "exposureIndices",
    "baseSaturationElectronEquivalent", "maximumAnalogGain", "adc", "conversionGainModes", "evidence", "limitations"],
  "Invalid ISO gain readout fields.");
  const prefix = r.regimeIdPrefix === "" ? "" : requirePublicOpaqueId(r.regimeIdPrefix, "regimeIdPrefix must be empty or a public opaque identifier.");
  const base = positive(r.baseExposureIndex, "baseExposureIndex");
  const q0 = positiveFact(r.baseSaturationElectronEquivalent, "baseSaturationElectronEquivalent");
  const aMax = positiveFact(r.maximumAnalogGain, "maximumAnalogGain");
  if (aMax.value < 1) throw new InvalidConfigurationError("maximumAnalogGain must be at least 1.");
  const evidence = parseEvidenceList(r.evidence, "evidence");
  const adc = requireAllowlistedRecord(r.adc, ["bitDepth", "blackLevelCode", "digitalSaturationCode"], "Invalid ISO gain ADC fields.");
  if (!Array.isArray(r.exposureIndices) || r.exposureIndices.length === 0 || r.exposureIndices.length > 256) {
    throw new InvalidConfigurationError("exposureIndices must contain 1 through 256 settings.");
  }
  const indices = r.exposureIndices.map((value: unknown, i: number) => positive(value, "exposureIndices[" + i + "]"));
  if (indices[0]! < base || indices.some((value, i) => i > 0 && value <= indices[i - 1]!)) {
    throw new InvalidConfigurationError("exposureIndices must strictly increase from at least the base exposure index.");
  }
  if (!Array.isArray(r.conversionGainModes) || r.conversionGainModes.length === 0 || r.conversionGainModes.length > 8) {
    throw new InvalidConfigurationError("conversionGainModes must contain 1 through 8 modes.");
  }
  const modes = r.conversionGainModes.map((value: unknown, i: number) => {
    const m = requireAllowlistedRecord(value, ["mode", "minimumExposureIndex", "readNoiseRmsElectrons", "maximumChargeElectrons"],
      "Invalid conversion-gain mode fields.");
    if (m.mode !== "single-conversion-gain" && m.mode !== "low-conversion-gain" && m.mode !== "high-conversion-gain") {
      throw new InvalidConfigurationError("conversionGainModes[" + i + "].mode is invalid.");
    }
    const noise = requireAllowlistedRecord(m.readNoiseRmsElectrons, ["value", "evidence"], "Invalid read-noise fact.");
    if (typeof noise.value !== "number" || !Number.isFinite(noise.value) || noise.value < 0) {
      throw new InvalidConfigurationError("conversionGainModes[" + i + "].readNoiseRmsElectrons.value must be finite and nonnegative.");
    }
    return { mode: m.mode as IsoGainConversionGainMode["mode"],
      minimumExposureIndex: positive(m.minimumExposureIndex, "conversionGainModes[" + i + "].minimumExposureIndex"),
      readNoiseRmsElectrons: { value: noise.value, evidence: parseEvidenceList(noise.evidence, "readNoiseRmsElectrons.evidence") },
      ...(m.maximumChargeElectrons === undefined ? {} :
        { maximumChargeElectrons: positiveFact(m.maximumChargeElectrons, "conversionGainModes[" + i + "].maximumChargeElectrons") }) };
  });
  if (modes[0]!.minimumExposureIndex !== base || modes.some((m, i) => i > 0 && m.minimumExposureIndex <= modes[i - 1]!.minimumExposureIndex)) {
    throw new InvalidConfigurationError("conversionGainModes must start at the base exposure index and strictly increase.");
  }
  const gainEvidence = [...q0.evidence, ...aMax.evidence].filter((entry, i, all) =>
    all.findIndex((other) => JSON.stringify(other) === JSON.stringify(entry)) === i);
  const black = adc.blackLevelCode as number, saturation = adc.digitalSaturationCode as number;
  const span = saturation - black;
  const regimes = indices.map((exposureIndex) => {
    const ratio = exposureIndex / base;
    const analogGain = Math.min(ratio, aMax.value);
    const digitalGain = ratio / analogGain;
    const mode = modes.filter((m) => m.minimumExposureIndex <= exposureIndex).pop()!;
    const preAdc = q0.value / analogGain;
    if (mode.maximumChargeElectrons !== undefined && preAdc > mode.maximumChargeElectrons.value) {
      throw new InvalidConfigurationError("A " + mode.mode + " regime would need more charge than its declared storage limit.");
    }
    const regimeEvidence = [...evidence];
    return {
      regimeId: prefix + "iso-" + exposureIndex,
      scientificStatus: r.scientificStatus as SensorSpectralResponseScientificStatus,
      systemConversionGainElectronsPerCode: { value: preAdc / span, evidence: gainEvidence },
      preAdcSaturationElectronEquivalent: { value: preAdc, evidence: gainEvidence },
      readNoiseComponents: [{ componentId: "electronic", rmsElectrons: mode.readNoiseRmsElectrons, evidence: mode.readNoiseRmsElectrons.evidence }],
      adc: { bitDepth: adc.bitDepth as number, blackLevelCode: black, digitalSaturationCode: saturation, transfer: "uniform-round-half-up" as const,
        ...(digitalGain === 1 ? {} : { digitalGain }) },
      exposureIndexGain: { exposureIndex, baseExposureIndex: base, analogGain, digitalGain, conversionGainMode: mode.mode, evidence: regimeEvidence },
      evidence: regimeEvidence,
      limitations: r.limitations as readonly string[]
    };
  });
  // Reuse the regime parser to check the ADC, limitations and consistency.
  const parsed = parseSensorReadoutConversionProfile({ schemaVersion: "0.1.0", profileId: prefix + "validation", colorSamplingProfileId: "validation",
    channelId: "validation", regimeSelectionOwnedBy: "explicit-upstream-camera-state-not-inferred-from-iso", regimes, evidence }).regimes;
  return { regimes: parsed, standardRegimeBands: indices.map((exposureIndex, i) => ({ minimumExposureIndex: exposureIndex,
    maximumExposureIndex: exposureIndex, readoutRegimeId: parsed[i]!.regimeId })) };
}
