// SPDX-License-Identifier: Apache-2.0

/**
 * #595 (2.22.0): `result.sensor.native`, the sensor figures of one native photosite, in a module of its own so that it can be loaded
 * apart from the capture's default path: the same report at the native pitch, the EMVA 1288 Release 4.0 dynamic range (§2.7,
 * Eq. 26–28) and the 8 MP-normalized one (a convention). Model figures, exact arithmetic under the engine's noise model.
 * @see docs/QUICK_START.md, "Native-pixel dynamic range (#595)".
 */

import type { SensorFixedPatternNoiseProfile } from "./fixed-pattern-noise.js";
import { regimeRange, sensorReport, type NativeSensorInput, type SimulateCaptureNativeSensorReport, type SimulateCaptureSensorReport } from "./sensor-characteristics.js";

/** The native figures for a capture's report `rendered` (its regime, grey charge and dark charge). */
export function nativeSensorReport(rendered: SimulateCaptureSensorReport, regimeId: string, greyElectrons: number | undefined, darkElectrons: number, native: NativeSensorInput,
  pattern?: SensorFixedPatternNoiseProfile): SimulateCaptureNativeSensorReport {
  const base = { pixelPitchMicrometers: rendered.pixelPitchMicrometers, peakQuantumEfficiency: rendered.peakQuantumEfficiency, readoutSeconds: rendered.readoutSeconds };
  // #595: the same report at the native pitch; EMVA 1288 R4.0 Eq. (27) μ_e.min = √(σ_d² + σ_q²/K² + 1/4) + 1/2 and Eq. (28) DR = μ_e.sat / μ_e.min.
  const p0 = native.pixelPitchMicrometers, area = (p0 / base.pixelPitchMicrometers) ** 2, own = sensorReport(native.profile, regimeId, native.capacityElectrons,
      greyElectrons && greyElectrons * area, darkElectrons, { ...base, pixelPitchMicrometers: p0 }, pattern);
  const q = regimeRange(native.profile, native.profile.regimes.find((r) => r.regimeId === regimeId)!, native.capacityElectrons);
  const threshold = Math.sqrt(q.read ** 2 + q.quantization ** 2 + 0.25) + 0.5, emva = Math.log2(q.saturation / threshold), normalization = 0.5 * Math.log2(native.framePhotosites / 8e6);
  return { pixelPitchMicrometers: p0, photositesPerSite: 1 / area, fullWellElectrons: native.capacityElectrons, readNoiseElectrons: q.read, dynamicRangeStops: own.dynamicRangeStops,
    dynamicRangeByIso: own.dynamicRangeByIso, emva1288: { absoluteSensitivityThresholdElectrons: threshold, dynamicRangeStops: emva, dynamicRangeDecibels: 20 * Math.log10(2) * emva,
      saturationCapacityElectronsPerSquareMicrometer: q.saturation / (p0 * p0) },
    normalized8Megapixel: { referencePixels: 8e6, framePhotosites: native.framePhotosites, dynamicRangeStops: own.dynamicRangeStops + normalization, emva1288DynamicRangeStops: emva + normalization },
    ...(own.midGrey ? { midGrey: own.midGrey } : {}) };
}
