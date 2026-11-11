// SPDX-License-Identifier: Apache-2.0

/**
 * Adjustable sensor characteristics for `simulateCapture` (#555) and the capture's noise figure (#535): the request
 * options that replace a camera body's sensor values one at a time, the readout they give, and the calculated dynamic
 * range and mid-grey signal-to-noise ratio the result reports.
 *
 * Everything here works on the body's declared readout regimes, so it applies to a generic tier and to a caller's
 * preset record alike, and a later sensor profile (#554) can supply the same options as data.
 * @see docs/QUICK_START.md, "Sensor characteristics (#555)", for the options, the equations and their sources.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputObject } from "../core/record-validation.js";
import { calculateSiteEffectiveSaturationCode } from "../capture/raw-white-level.js";
import { parseSensorReadoutConversionProfile, type SensorReadoutConversionProfile, type SensorReadoutConversionRegime } from "./raw-readout.js";
import type { SensorFixedPatternNoiseProfile } from "./fixed-pattern-noise.js";

/**
 * #555: sensor characteristics a capture can set one at a time (`simulateCapture({ sensor })`). Each is off by default: an
 * omitted field keeps the camera body's value, and a request with none of them is byte-identical to one before 2.20.0.
 * Every value set is listed in the result's `assumptions`.
 */
export interface SimulateCaptureSensorCharacteristics {
  /**
   * Peak external quantum efficiency of the green channel (its value at 555 nm), 0.05–0.9. Default 0.5, the facade's
   * idealized sensor. Every channel's EQE curve is multiplied by `peakQuantumEfficiency / 0.5`, so the curves keep their
   * shape (and the colour matrix is unchanged) and the collected charge scales in proportion.
   */
  peakQuantumEfficiency?: number;
  /**
   * Full-well capacity: the charge, e⁻, that reaches the RAW white level at base ISO. Default: the body's base-ISO saturation
   * at 6 µm, scaled by the pixel area (the `sensor.isoAreaNormalization` approximation). `link` `"pixel-area"` (default)
   * scales `electrons`, the full well at `referencePixelPitchMicrometers` (default 6), by (pitch / reference)²; `"none"`
   * uses `electrons` at any pitch. The result is 100 e⁻ to 1e10 e⁻.
   */
  fullWell?: { electrons: number; link?: "pixel-area" | "none"; referencePixelPitchMicrometers?: number };
  /**
   * Read noise, RMS e⁻ (0–100), of the low and the high conversion gain, and the dual-gain switch: the ISO setting from
   * which the high conversion gain is used (any ISO from 100; above the body's highest ISO, the low gain is used throughout).
   * An omitted field keeps the body's value. Needs readout regimes that declare their exposure index (the tiers do).
   */
  readNoise?: { lowGainElectrons?: number; highGainElectrons?: number; highGainFromIso?: number };
  /** Readout time, s (1e-6 to 1): the rolling shutter's top-to-bottom skew. Default: the body's (tiers 8, 15 and 30 ms). */
  readoutSeconds?: number;
  /**
   * ADC bit depth: 12, 14 or 16. Default: the body's (consumer 12, the others 14). The black level scales with the code range
   * (×2^Δbits), and the conversion gain follows so the same charge reaches the same fraction of the range.
   */
  adcBitDepth?: 12 | 14 | 16;
  /**
   * Opt-in (advanced): the body's synthetic fixed-pattern noise profile (PRNU, DSNU, hot pixels, row and column offsets; EMVA
   * 1288 Release 4.0 non-uniformities), the same pattern in every capture. Default false. Not in `simulateDisplayView`.
   */
  fixedPatternNoise?: boolean;
}

/** The option keys of {@link SimulateCaptureSensorCharacteristics}, in `sensor`. */
export const SENSOR_CHARACTERISTIC_KEYS = ["peakQuantumEfficiency", "fullWell", "readNoise", "readoutSeconds", "adcBitDepth", "fixedPatternNoise"] as const;

/** One RMS noise component of the mid-grey figure, e⁻ (input-referred). */
export interface SimulateCaptureNoiseComponents {
  /** Photon shot noise √S (Poisson). */
  photonShot: number;
  /** Read noise of the capture's readout regime. */
  read: number;
  /** Dark-current shot noise √(D·t), D = 1 e⁻/s at 20 °C. */
  darkCurrent: number;
  /** ADC quantization, one code (and one more after a digital gain) as a uniform 1/12 code² variance, in e⁻. */
  quantization: number;
  /** With `sensor.fixedPatternNoise`: √((PRNU·S)² + (DSNU·D·t)² + row² + column²), hot pixels excluded; a spatial, not temporal, noise. */
  fixedPattern?: number;
  /** √ of the sum of the squares. */
  total: number;
}

/**
 * #555, #535: the capture's sensor characteristics as used, and the figures calculated from them (reported, not settable).
 * Model figures from the engine's own noise model, not measurements.
 */
export interface SimulateCaptureSensorReport {
  pixelPitchMicrometers: number;
  /** The green channel's peak EQE (at 555 nm). */
  peakQuantumEfficiency: number;
  /** Full-well capacity, e⁻: the base-ISO saturation charge (`sensor.capacityElectrons`). */
  fullWellElectrons: number;
  /** Read noise, RMS e⁻, of each conversion gain, and the ISO from which the high gain is used (null: one gain throughout). */
  readNoise: { lowGainElectrons: number; highGainElectrons: number; highGainFromIso: number | null };
  /** The body's rolling readout skew, s (null when it declares no rolling readout). */
  readoutSeconds: number | null;
  /** ADC bit depth of the capture's readout regime. */
  adcBitDepth: number;
  fixedPatternNoise: boolean;
  /**
   * Engineering dynamic range at the capture's ISO, stops: log₂(S_sat / σ_floor), with S_sat the charge at the RAW white
   * level (full well over the analog gain, limited by the charge capacity and the ADC range) and σ_floor the read noise and
   * ADC quantization added in quadrature (the temporal dark noise of EMVA 1288 Release 4.0 without dark current). An ideal
   * noiseless readout is limited by the ADC alone: log₂((white − black)·√12) for unit digital gain.
   */
  dynamicRangeStops: number;
  /** The same per ISO setting of the body, in its order. */
  dynamicRangeByIso: readonly { iso: number; stops: number }[];
  /**
   * #535: the expected signal-to-noise ratio of an 18 % Lambertian grey patch under the request's illuminant and illuminance
   * at the capture's exposure, ISO and sensor, on the green channel next to the optical axis (no vignetting, PSF or motion).
   * `snr` = S/σ_total and `snrDecibels` = 20·log₁₀(snr). `clipped`: S is at or above the white level, where the RAW clips and
   * the figure no longer describes the image. Computed only when the request resolves to exact (`fast: false`, the default for
   * DNG, JPEG and PNG exports; omitted for a fast request).
   */
  midGrey?: SimulateCaptureMidGreyFigure;
  /**
   * #595 (2.22.0): the same figures for one of the body's native photosites, whatever pitch the capture renders (the fields above
   * are the as-rendered site's). The native pitch is a generic tier's (or a caller preset's) declared 6 µm reference, or a sensor
   * profile's own photosite; the request's sensor characteristics apply as they would at that pitch. Exact arithmetic under the
   * engine's model (model figures, not measurements); see docs/QUICK_START.md, "Native-pixel dynamic range (#595)".
   */
  native: SimulateCaptureNativeSensorReport;
}

/** #535: the mid-grey noise figure of {@link SimulateCaptureSensorReport.midGrey}. */
export interface SimulateCaptureMidGreyFigure { reflectance: 0.18; channel: "green"; signalElectrons: number; noiseElectrons: SimulateCaptureNoiseComponents; snr: number; snrDecibels: number; clipped: boolean }

/** #595: {@link SimulateCaptureSensorReport.native}, the figures of one native photosite. */
export interface SimulateCaptureNativeSensorReport {
  /** The native photosite pitch, µm (tiers: 6; a profile: its own). */
  pixelPitchMicrometers: number;
  /** N = (rendered pitch / native pitch)²: the photosites one rendered site stands for (below 1, a site smaller than a photosite). */
  photositesPerSite: number;
  /** Full-well capacity of one photosite, e⁻. */
  fullWellElectrons: number;
  /** Read noise of one photosite at the capture's ISO, RMS e⁻ (the capture's readout regime). */
  readNoiseElectrons: number;
  /** Engineering dynamic range of one photosite at the capture's ISO, stops (the definition of `dynamicRangeStops`). */
  dynamicRangeStops: number;
  /** The same per ISO setting of the body. */
  dynamicRangeByIso: readonly { iso: number; stops: number }[];
  /**
   * EMVA 1288 Release 4.0 (§2.7, Eq. 26–28) at the capture's ISO: the absolute sensitivity threshold μ_e.min = √(σ_d² + σ_q² + 1/4) + 1/2
   * (σ_d the read noise, dark current excluded; σ_q the quantization noise in e⁻), DR = μ_e.sat / μ_e.min in stops and dB, and the
   * saturation capacity per area μ_e.sat / p² (Table 2).
   */
  emva1288: { absoluteSensitivityThresholdElectrons: number; dynamicRangeStops: number; dynamicRangeDecibels: number; saturationCapacityElectronsPerSquareMicrometer: number };
  /**
   * A convention, not part of EMVA 1288: the dynamic range of the whole frame's native photosites resampled to 8 million output
   * pixels, each summing framePhotosites / 8e6 photosites with their read noise (EMVA 1288 R4.0 §6.4, binning):
   * DR + ½·log₂(framePhotosites / 8e6), for the engineering and the EMVA figure. No ADC limit is applied to the sum.
   */
  normalized8Megapixel: { referencePixels: 8_000_000; framePhotosites: number; dynamicRangeStops: number; emva1288DynamicRangeStops: number };
  /** The mid-grey figure for one photosite (its charge (native/rendered pitch)² of the site's), present when `midGrey` is. */
  midGrey?: SimulateCaptureMidGreyFigure;
}

/** #595: what {@link sensorReport} needs for the native figures: the readout as characterized at the native pitch. */
export interface NativeSensorInput { profile: SensorReadoutConversionProfile; capacityElectrons: number; pixelPitchMicrometers: number; framePhotosites: number }

/** The request's characteristics, range-checked, with the EQE scale peakQuantumEfficiency / 0.5. */
export type ParsedSensorCharacteristics = SimulateCaptureSensorCharacteristics & { qeScale: number };

/**
 * A field's check: [minimum, maximum] (a number), the values allowed, 0 (a nested record) or a predicate. #554 shares the checker
 * with the sensor profile parser.
 */
export type FieldRange = readonly [number, number] | readonly unknown[] | 0 | ((value: unknown) => boolean);
/** Accepted ranges (design limits) and values of each characteristic, by path below `sensor`. */
const RANGES: Readonly<Record<string, FieldRange>> = { peakQuantumEfficiency: [0.05, 0.9], fullWell: 0, "fullWell.electrons": [100, 1e10],
  "fullWell.link": ["pixel-area", "none"], "fullWell.referencePixelPitchMicrometers": [0.5, 1000], readNoise: 0, "readNoise.lowGainElectrons": [0, 100],
  "readNoise.highGainElectrons": [0, 100], "readNoise.highGainFromIso": [100, 1e7], readoutSeconds: [1e-6, 1], adcBitDepth: [12, 14, 16], fixedPatternNoise: [true, false] };
function fail(message: string): never { throw new InvalidConfigurationError(message); }
/**
 * Checks `keys` of `record` against `ranges` (by path below `root`; nested records by "a.b"). An undefined field is skipped, or
 * with `required` refused, and with `required` every field `ranges` lists at that level is checked.
 */
export function checkFieldRanges(record: Record<string, unknown>, keys: readonly string[], prefix: string, ranges: Readonly<Record<string, FieldRange>> = RANGES, root = "sensor.", required = false): void {
  const all = required ? [...new Set([...keys, ...Object.keys(ranges).filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes(".")).map((k) => k.slice(prefix.length))])] : keys;
  for (const key of all) {
    const path = prefix + key, value = record[key], range = ranges[path];
    if (value === undefined && !required) continue;
    if (range === undefined) fail("Unknown " + (root + prefix).slice(0, -1) + " field: " + key + ".");
    if (value === undefined) fail(root + path + " is required.");
    if (range === 0) {
      requireInputObject(value, root + path);
      checkFieldRanges(value as Record<string, unknown>, Object.keys(value as object), path + ".", ranges, root, required);
    } else if (typeof range === "function") {
      if (!range(value)) fail(root + path + " is invalid.");
    } else {
      const choice = range.length > 2 || typeof range[0] !== "number", [minimum, maximum] = range as readonly [number, number];
      if (choice ? !(range as readonly unknown[]).includes(value) : typeof value !== "number" || !(value >= minimum && value <= maximum)) {
        fail(root + path + " must be " + (choice ? range.map(String).join(" or ") : "a number from " + minimum + " to " + maximum) + ".");
      }
    }
  }
}

/** Checks the characteristics of the request's `sensor` record (its other keys already checked); undefined when it sets none. */
export function parseSensorCharacteristics(sensor: Record<string, unknown>): ParsedSensorCharacteristics | undefined {
  if (!SENSOR_CHARACTERISTIC_KEYS.some((key) => sensor[key] !== undefined)) return undefined;
  checkFieldRanges(sensor, SENSOR_CHARACTERISTIC_KEYS, "");
  const c = sensor as SimulateCaptureSensorCharacteristics, fullWell = c.fullWell;
  if (fullWell && fullWell.electrons === undefined) fail("sensor.fullWell.electrons is required.");
  if (fullWell?.link === "none" && fullWell.referencePixelPitchMicrometers !== undefined) fail("sensor.fullWell.referencePixelPitchMicrometers applies only to link \"pixel-area\".");
  return { ...c, qeScale: (c.peakQuantumEfficiency ?? 0.5) / 0.5 };
}

const noiseOf = (regime: SensorReadoutConversionRegime): number => Math.hypot(...regime.readNoiseComponents.map((c) => c.rmsElectrons.value));
/** The body's dual-gain read noise: the base regime's, and the first high-conversion-gain regime's with its ISO (none: the low gain throughout). */
export function declaredReadNoise(profile: SensorReadoutConversionProfile): SimulateCaptureSensorReport["readNoise"] {
  const regimes = profile.regimes, high = regimes.find((r) => r.exposureIndexGain?.conversionGainMode === "high-conversion-gain"), low = noiseOf(regimes[0]!);
  return { lowGainElectrons: low, highGainElectrons: high ? noiseOf(high) : low, highGainFromIso: high ? high.exposureIndexGain!.exposureIndex : null };
}

/**
 * The readout profile with the characteristics applied: every regime's charge-domain transfer (system conversion gain,
 * e⁻ per code, and pre-ADC saturation, e⁻ equivalent) multiplied by `chargeScale`, so a full well `chargeScale` times the
 * body's reaches the same white code; with `adcBitDepth`, the black level ×2^Δbits (rounded), the saturation code 2^bits − 1
 * and the conversion gain over the new code span; with `readNoise`, one electronic read-noise component per regime, the high
 * conversion gain's from `highGainFromIso`; otherwise every read-noise component times `readNoiseScale` (#599: √N for a site that sums N
 * photosites, as the sensor-profile path does). Codes per unit charge of the base regime otherwise, digital gain and the ISO
 * selection are unchanged. Re-checked by the readout parser. With nothing to change, the profile itself.
 */
export function characterizeReadout(profile: SensorReadoutConversionProfile, chargeScale: number, c?: ParsedSensorCharacteristics, readNoiseScale = 1): SensorReadoutConversionProfile {
  const bits = c?.adcBitDepth, n = c?.readNoise, declared = n && declaredReadNoise(profile);
  if (chargeScale === 1 && !bits && !n && readNoiseScale === 1) return profile;
  return parseSensorReadoutConversionProfile({ ...profile, regimes: profile.regimes.map((regime) => {
    const adc = regime.adc, rescale = bits !== undefined && bits !== adc.bitDepth;
    const black = rescale ? Math.round(adc.blackLevelCode * 2 ** (bits - adc.bitDepth)) : adc.blackLevelCode, saturation = rescale ? 2 ** bits - 1 : adc.digitalSaturationCode;
    const out = { ...regime, systemConversionGainElectronsPerCode: { ...regime.systemConversionGainElectronsPerCode, value: rescale ?
        regime.systemConversionGainElectronsPerCode.value * chargeScale * (adc.digitalSaturationCode - adc.blackLevelCode) / (saturation - black) : regime.systemConversionGainElectronsPerCode.value * chargeScale },
      preAdcSaturationElectronEquivalent: { ...regime.preAdcSaturationElectronEquivalent, value: regime.preAdcSaturationElectronEquivalent.value * chargeScale },
      ...(rescale ? { adc: { ...adc, bitDepth: bits, blackLevelCode: black, digitalSaturationCode: saturation } } : {}) };
    if (n) {
      const gain = regime.exposureIndexGain ?? fail("sensor.readNoise needs readout regimes that declare their exposure index.");
      const from = n.highGainFromIso ?? declared!.highGainFromIso ?? Infinity, high = gain.exposureIndex >= from;
      const value = high ? n.highGainElectrons ?? declared!.highGainElectrons : n.lowGainElectrons ?? declared!.lowGainElectrons;
      out.readNoiseComponents = [{ componentId: "electronic", rmsElectrons: { value, evidence: regime.evidence }, evidence: regime.evidence }];
      out.exposureIndexGain = { ...gain, conversionGainMode: high ? "high-conversion-gain" : "low-conversion-gain" };
    } else if (readNoiseScale !== 1) out.readNoiseComponents = regime.readNoiseComponents.map((component) => ({ ...component, rmsElectrons: { ...component.rmsElectrons, value: component.rmsElectrons.value * readNoiseScale } }));
    return out;
  }) });
}

/** Charge at the RAW white level and the read-plus-quantization floor of one regime, e⁻. */
function regimeRange(profile: SensorReadoutConversionProfile, regime: SensorReadoutConversionRegime, capacityElectrons: number): { saturation: number; quantization: number; read: number } {
  const adc = regime.adc, gain = regime.systemConversionGainElectronsPerCode.value, digitalGain = adc.digitalGain ?? 1;
  const white = calculateSiteEffectiveSaturationCode({ physicalChargeCapacityElectrons: capacityElectrons, preAdcSaturationElectronEquivalent: regime.preAdcSaturationElectronEquivalent.value,
    systemConversionGainElectronsPerCode: gain, blackLevelCode: adc.blackLevelCode, digitalSaturationCode: adc.digitalSaturationCode, adcMaximumCode: 2 ** adc.bitDepth - 1, digitalGain }, profile, regime.regimeId);
  // Output codes per electron d/G; quantization 1/12 code² of the ADC times d², plus 1/12 of the rounding after a digital gain.
  const perCode = gain / digitalGain;
  return { saturation: (white - adc.blackLevelCode) * perCode, quantization: perCode * Math.sqrt(digitalGain * digitalGain / 12 + (digitalGain === 1 ? 0 : 1 / 12)), read: noiseOf(regime) };
}

/** #595: the 8 MP output-size normalization's reference pixel count (a convention). */
const NORMALIZED_REFERENCE_PIXELS = 8_000_000;

/** The dynamic range per ISO and the mid-grey figure of one readout at one site. */
function figures(profile: SensorReadoutConversionProfile, regimeId: string, capacityElectrons: number, greyElectrons: number | undefined, darkElectrons: number, pattern?: SensorFixedPatternNoiseProfile):
  { range: ReturnType<typeof regimeRange>; dynamicRangeStops: number; dynamicRangeByIso: { iso: number; stops: number }[]; midGrey?: SimulateCaptureMidGreyFigure } {
  const stops = (r: SensorReadoutConversionRegime): number => { const q = regimeRange(profile, r, capacityElectrons); return Math.log2(q.saturation / Math.hypot(q.read, q.quantization)); };
  const regime = profile.regimes.find((r) => r.regimeId === regimeId)!, range = regimeRange(profile, regime, capacityElectrons);
  const out = { range, dynamicRangeStops: stops(regime), dynamicRangeByIso: profile.regimes.map((r) => ({ iso: r.exposureIndexGain?.exposureIndex ?? NaN, stops: stops(r) })).filter((e) => e.iso > 0) };
  if (greyElectrons === undefined) return out;
  const fixedPattern = pattern && Math.hypot(pattern.photoResponseNonUniformity.relativeStandardDeviation.value * greyElectrons,
    pattern.darkSignalNonUniformity.relativeStandardDeviation.value * darkElectrons, pattern.rowOffset.rmsElectrons.value, pattern.columnOffset.rmsElectrons.value);
  const noise = { photonShot: Math.sqrt(greyElectrons), read: range.read, darkCurrent: Math.sqrt(darkElectrons), quantization: range.quantization, ...(fixedPattern === undefined ? {} : { fixedPattern }), total: 0 };
  noise.total = Math.hypot(noise.photonShot, noise.read, noise.darkCurrent, noise.quantization, fixedPattern ?? 0);
  const snr = greyElectrons / noise.total;
  return { ...out, midGrey: { reflectance: 0.18, channel: "green", signalElectrons: greyElectrons, noiseElectrons: noise, snr, snrDecibels: 20 * Math.log10(snr || Number.MIN_VALUE), clipped: greyElectrons + darkElectrons >= range.saturation } };
}

/**
 * The report: the characteristics used, the dynamic range per ISO, and the mid-grey noise figure for `greyElectrons`, the
 * green channel's expected charge from an 18 % grey patch, after a `darkElectrons` dark charge; #595: and the same for one native
 * photosite of `native` (its charge scaled by the area ratio).
 */
export function sensorReport(profile: SensorReadoutConversionProfile, regimeId: string, capacityElectrons: number, greyElectrons: number | undefined, darkElectrons: number,
  base: Pick<SimulateCaptureSensorReport, "pixelPitchMicrometers" | "peakQuantumEfficiency" | "readoutSeconds">, native: NativeSensorInput, pattern?: SensorFixedPatternNoiseProfile): SimulateCaptureSensorReport {
  const rendered = figures(profile, regimeId, capacityElectrons, greyElectrons, darkElectrons, pattern), regime = profile.regimes.find((r) => r.regimeId === regimeId)!;
  const p0 = native.pixelPitchMicrometers, area = (p0 / base.pixelPitchMicrometers) ** 2;
  const own = figures(native.profile, regimeId, native.capacityElectrons, greyElectrons === undefined ? undefined : greyElectrons * area, darkElectrons, pattern);
  // EMVA 1288 R4.0 Eq. (27): μ_e.min = √(σ_d² + σ_q²/K² + 1/4) + 1/2, and Eq. (28): DR = μ_e.sat / μ_e.min.
  const threshold = Math.sqrt(own.range.read ** 2 + own.range.quantization ** 2 + 0.25) + 0.5, emvaRatio = own.range.saturation / threshold;
  const normalization = 0.5 * Math.log2(native.framePhotosites / NORMALIZED_REFERENCE_PIXELS);
  const report: SimulateCaptureSensorReport = { ...base, fullWellElectrons: capacityElectrons, readNoise: declaredReadNoise(profile), adcBitDepth: regime.adc.bitDepth, fixedPatternNoise: !!pattern,
    dynamicRangeStops: rendered.dynamicRangeStops, dynamicRangeByIso: rendered.dynamicRangeByIso,
    native: { pixelPitchMicrometers: p0, photositesPerSite: 1 / area, fullWellElectrons: native.capacityElectrons, readNoiseElectrons: own.range.read, dynamicRangeStops: own.dynamicRangeStops,
      dynamicRangeByIso: own.dynamicRangeByIso, emva1288: { absoluteSensitivityThresholdElectrons: threshold, dynamicRangeStops: Math.log2(emvaRatio), dynamicRangeDecibels: 20 * Math.log10(emvaRatio),
        saturationCapacityElectronsPerSquareMicrometer: own.range.saturation / (p0 * p0) },
      normalized8Megapixel: { referencePixels: NORMALIZED_REFERENCE_PIXELS, framePhotosites: native.framePhotosites, dynamicRangeStops: own.dynamicRangeStops + normalization,
        emva1288DynamicRangeStops: Math.log2(emvaRatio) + normalization } } };
  if (rendered.midGrey) { report.midGrey = rendered.midGrey; report.native.midGrey = own.midGrey!; }
  return report;
}
