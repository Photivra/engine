// SPDX-License-Identifier: Apache-2.0

/**
 * Effective RAW white (saturation) level: the code at which a native site is fully saturated. This
 * is the engine's only source for it. RAW development scales by it, and DNG writes it as `WhiteLevel`.
 *
 * The readout model (`simulateSensorRawCode`) does this, in order: clips charge at physical capacity,
 * adds read noise, clips at the pre-ADC threshold (in electron equivalents), converts with the system
 * conversion gain, adds the black pedestal, adds any declared ADC integral non-linearity (INL), rounds,
 * limits to the ADC code range, applies any post-ADC digital gain about black, rounds again and clamps
 * at the digital saturation code. So a signal at the lower of the two electron thresholds encodes to
 *
 *   I = B + min(C, P)/G,   A = min(Amax, round(I + INL(I))),   W = min(D, round((A − B)·d + B))
 *
 * where C is physical charge capacity (e⁻), P the pre-ADC saturation (e⁻ equivalent), G the system
 * conversion gain (e⁻/DN), B the black level code, INL the optional piecewise-linear integral
 * non-linearity offset (codes), Amax the ADC maximum code, d the optional post-ADC digital gain (1 when
 * omitted) and D the digital saturation code. With d = 1 and no INL, W = min(D, round(B + min(C, P)/G)).
 * This is the "fully saturated encoding level" of DNG 1.7 `WhiteLevel` (Adobe DNG Specification
 * 1.7.1.0, tag 50717) and the saturation point of EMVA 1288 Release 4.0 (signal at which the camera
 * saturates). Read noise added after physical clipping can push individual clipped codes slightly
 * above or below W, so development also uses the per-site saturation flags.
 * @see docs/PHOTOGRAPHIC_EXPORT.md
 */
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { parseEvidenceList } from "../core/evidence-provenance.js";
import { rejectUnknownFields, requireInputKeys, requireInputObject } from "../core/record-validation.js";
import type { SensorReadoutConversionProfile } from "../sensor/raw-readout.js";

/** Readout fields the white level depends on; a `SensorRawCodeSample` satisfies this shape. */
export interface EffectiveSaturationReadout {
  physicalChargeCapacityElectrons: number;
  preAdcSaturationElectronEquivalent: number;
  systemConversionGainElectronsPerCode: number;
  blackLevelCode: number;
  digitalSaturationCode: number;
  /** ADC code-range maximum (2^bits − 1), when known. */
  adcMaximumCode?: number;
  /** Post-ADC digital gain d ≥ 1; omitted means 1. */
  digitalGain?: number;
  /** Declared ADC integral non-linearity, the readout regime's `adc.integralNonLinearity`. */
  integralNonLinearity?: { kind: "piecewise-linear-code-offset"; knots: readonly { code: number; offsetCodes: number }[] };
}
/** Piecewise-linear INL offset at continuous input code `code`. Beyond the end points it stays constant. */
function inlOffset(inl: EffectiveSaturationReadout["integralNonLinearity"], code: number): number {
  if (inl === undefined) return 0;
  const knots = inl.knots, first = knots[0], last = knots[knots.length-1];
  if (!first || !last) throw new InvalidConfigurationError("ADC integral non-linearity requires knots.");
  if (code <= first.code) return first.offsetCodes;
  if (code >= last.code) return last.offsetCodes;
  let low = 0, high = knots.length-1;
  while (high-low > 1) { const middle = (low+high) >> 1; if (knots[middle]!.code <= code) low = middle; else high = middle; }
  const a = knots[low]!, b = knots[high]!;
  return a.offsetCodes+(code-a.code)/(b.code-a.code)*(b.offsetCodes-a.offsetCodes);
}

/** Fields of `EffectiveSaturationReadout`. */
const EFFECTIVE_SATURATION_READOUT_FIELDS = ["physicalChargeCapacityElectrons", "preAdcSaturationElectronEquivalent",
  "systemConversionGainElectronsPerCode", "blackLevelCode", "digitalSaturationCode", "adcMaximumCode", "digitalGain",
  "integralNonLinearity"] as const;
/**
 * The other fields of a `SensorRawCodeSample` (the result of `simulateSensorRawCode`). The white level
 * does not read them, but a whole sample is accepted as input, so they are known fields too.
 */
const SENSOR_RAW_CODE_SAMPLE_FIELDS = ["readoutProfileId", "regimeId", "samplingProfileId", "completenessProfileId",
  "capacityProfileId", "colorSamplingProfileId", "channelId", "site", "bindingId", "chargeSeedUint32", "readNoiseSeedUint32",
  "realizedStoredElectronEquivalentCountBeforePhysicalCapacity", "electronEquivalentAfterPhysicalScalarSaturation",
  "physicalScalarSaturationApplied", "overflowElectronEquivalentDiagnostic", "bloomingModeled", "electronicReadNoiseComponents",
  "totalElectronicReadNoiseElectrons", "fixedPatternNoiseProfileId", "fixedPatternReadoutOffsetElectrons",
  "electronEquivalentAfterReadNoise", "electronEquivalentAfterPreAdcSaturation", "preAdcSaturationApplied", "codeBeforeQuantization",
  "adcIntegralNonLinearityOffsetCodes", "adcCodeBeforeDigitalGain", "quantizedCodeBeforeDigitalClamp", "adcBitDepth", "rawCode",
  "digitalSaturationApplied", "lowerCodeClampApplied", "adcTransfer", "physicalSaturationApplied", "electronicReadNoiseApplied",
  "conversionGainApplied", "adcQuantizationApplied", "rawCodeValueProduced", "isoUsedToInferRegime",
  "deterministicSeededRealization"] as const;
const ACCEPTED_READOUT_FIELDS: readonly string[] = [...EFFECTIVE_SATURATION_READOUT_FIELDS, ...SENSOR_RAW_CODE_SAMPLE_FIELDS];

/**
 * W as documented above; throws unless B < W ≤ D. Ties round up, matching the ADC.
 *
 * Accepts an `EffectiveSaturationReadout` or a whole `SensorRawCodeSample`, optionally with the
 * regime's `integralNonLinearity`. From 2.0.0 any other field is rejected with
 * `InvalidConfigurationError`, and the `integralNonLinearity` record and its knots are checked too.
 */
export function calculateEffectiveSaturationCode(readout: EffectiveSaturationReadout): number {
  requireInputKeys(readout, "calculateEffectiveSaturationCode", ACCEPTED_READOUT_FIELDS);
  const inl: unknown = readout.integralNonLinearity;
  if (inl !== undefined) {
    requireInputObject(inl, "calculateEffectiveSaturationCode input.integralNonLinearity");
    rejectUnknownFields(inl as object, ["kind", "knots", "evidence"], "calculateEffectiveSaturationCode input.integralNonLinearity");
    // capture-31: the knots are checked as the readout-profile parser checks them (kind, a dense list of 1 to 4096 finite
    // knots with strictly increasing codes); the end points are not required here because adcMaximumCode is optional.
    const name = "calculateEffectiveSaturationCode input.integralNonLinearity";
    if ((inl as { kind?: unknown }).kind !== "piecewise-linear-code-offset") throw new InvalidConfigurationError(name + '.kind must be "piecewise-linear-code-offset".');
    const knots = (inl as { knots?: unknown }).knots;
    if (!Array.isArray(knots) || knots.length < 1 || knots.length > 4096) throw new InvalidConfigurationError(name + ".knots must contain 1 through 4096 knots.");
    for (let index = 0; index < knots.length; index++) {
      const path = `${name}.knots[${index}]`, knot: unknown = knots[index];
      requireInputObject(knot, path);
      rejectUnknownFields(knot as object, ["code", "offsetCodes"], path);
      const { code, offsetCodes } = knot as { code: unknown; offsetCodes: unknown };
      if (typeof code !== "number" || !Number.isFinite(code) || typeof offsetCodes !== "number" || !Number.isFinite(offsetCodes))
        throw new InvalidConfigurationError(path + " must hold a finite code and offsetCodes.");
      if (index > 0 && !(code > (knots[index - 1] as { code: number }).code)) throw new InvalidConfigurationError(name + ".knots must have strictly increasing codes.");
    }
    const inlEvidence = (inl as { evidence?: unknown }).evidence;
    if (inlEvidence !== undefined) parseEvidenceList(inlEvidence, "calculateEffectiveSaturationCode input.integralNonLinearity.evidence");
  }
  if (readout.adcMaximumCode !== undefined && !Number.isSafeInteger(readout.adcMaximumCode))
    throw new InvalidConfigurationError("calculateEffectiveSaturationCode input.adcMaximumCode must be a safe integer.");
  return computeEffectiveSaturationCode(readout);
}

/**
 * The white-level calculation without the field checks, for engine-internal per-site calls whose
 * readout the engine produced itself. Not a root export.
 */
export function computeEffectiveSaturationCode(readout: EffectiveSaturationReadout): number {
  requireInputObject(readout, "Effective RAW white-level readout");
  const c = readout.physicalChargeCapacityElectrons, p = readout.preAdcSaturationElectronEquivalent,
    g = readout.systemConversionGainElectronsPerCode, b = readout.blackLevelCode, d = readout.digitalSaturationCode;
  const gain = readout.digitalGain ?? 1, adcMaximum = readout.adcMaximumCode ?? Infinity;
  if (![c, p, g].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0) ||
      !Number.isSafeInteger(b) || !Number.isSafeInteger(d) || b < 0 || d <= b || d > 65535 ||
      typeof gain !== "number" || !Number.isFinite(gain) || gain < 1 || !(adcMaximum > b)) {
    throw new InvalidConfigurationError("Effective RAW white level requires positive finite capacity, gain and a valid code span.");
  }
  const input = b + Math.min(c, p)/g, adc = Math.min(adcMaximum, Math.round(input + inlOffset(readout.integralNonLinearity, input)));
  const code = Math.min(d, gain === 1 ? adc : Math.round((adc-b)*gain + b));
  if (!(code > b)) throw new InvalidConfigurationError("Effective RAW white level must exceed the black level.");
  return code;
}

/**
 * White level of one simulated site: its readout sample (capacity, thresholds, gain, black, ADC maximum,
 * digital gain) plus the selected regime's declared INL, which the sample records only at its own code.
 */
export function calculateSiteEffectiveSaturationCode(readout: EffectiveSaturationReadout,
  readoutProfile: Pick<SensorReadoutConversionProfile, "regimes">, regimeId: string): number {
  const regime = readoutProfile.regimes.find((r) => r.regimeId === regimeId);
  if (!regime) throw new InvalidConfigurationError("Effective RAW white level requires the selected readout regime.");
  const inl = regime.adc.integralNonLinearity;
  return computeEffectiveSaturationCode(inl === undefined ? readout : { ...readout, integralNonLinearity: inl });
}

/** Index of the absolute native CFA repeat phase of row-major native index `i`. */
export function nativeCfaPhaseIndex(index: number, nativeWidth: number, repeatWidth: number, repeatHeight: number): number {
  const x = index % nativeWidth, y = (index - x)/nativeWidth;
  return (y % repeatHeight)*repeatWidth + x % repeatWidth;
}

/**
 * Collects the white level per CFA phase for packed native RAW. White level depends only on readout
 * and capacity settings, so it is stored once per absolute CFA phase (indexed
 * `phaseY*repeatWidth+phaseX`, like the reconstruction phase table) instead of per pixel. If sites in
 * one phase disagree, it throws.
 */
export function createPhaseWhiteLevelAccumulator(nativeWidth: number, repeatWidth: number, repeatHeight: number): {
  record(index: number, code: number): void; finish(): Uint16Array;
  /** The codes recorded so far, 0 for a phase with no site yet (a partition); merge them with recordPhase. */
  partial(): Uint16Array;
  /** Records one phase's code from a partition (0 means none). The same rule as record applies. */
  recordPhase(phase: number, code: number): void;
} {
  const codes = new Uint16Array(repeatWidth*repeatHeight);
  return {
    record(index: number, code: number): void {
      const phase = nativeCfaPhaseIndex(index, nativeWidth, repeatWidth, repeatHeight), current = codes[phase]!;
      if (current === 0) codes[phase] = code;
      else if (current !== code) throw new InvalidConfigurationError("Native RAW requires one effective white level per CFA phase.");
    },
    finish(): Uint16Array {
      if (codes.includes(0)) throw new InvalidConfigurationError("Every CFA phase requires an effective white level.");
      return codes;
    },
    partial(): Uint16Array {
      return codes.slice();
    },
    recordPhase(phase: number, code: number): void {
      if (code === 0) return;
      const current = codes[phase]!;
      if (current === 0) codes[phase] = code;
      else if (current !== code) throw new InvalidConfigurationError("Native RAW requires one effective white level per CFA phase.");
    }
  };
}
