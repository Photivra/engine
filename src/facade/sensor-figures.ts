// SPDX-License-Identifier: Apache-2.0

/**
 * #615: a sensor's figures on their own: engineering and EMVA 1288 dynamic range, the per-photosite noise and the mid-grey
 * signal-to-noise ratio, for a sensor profile (built-in or a caller's record) or a generic tier at an ISO. They are the
 * figures `simulateCapture` reports in `result.sensor.native`, computed by the capture itself on the smallest request that
 * produces them (a 2 × 2 uniform grey card at the standard exposure), so they are the capture's sensor model by construction.
 * @see docs/USAGE.md, "Sensor figures (#615)".
 */

import { calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { requirePositiveFinite } from "../core/validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import type { GenericEquipmentTier } from "../equipment/generic-tier-assets.js";
import type { SensorProfile } from "../equipment/sensor-profile-body.js";
import type { SimulateCaptureMidGreyFigure, SimulateCaptureNativeSensorReport, SimulateCaptureSensorCharacteristics, SimulateCaptureSensorReport } from "../sensor/sensor-characteristics.js";
import { FACADE_EXPOSURE_ANCHOR } from "./program-exposure.js";
import { SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX, simulateCapture } from "./simulate-capture.js";

export interface CalculateSensorFiguresInput {
  /** A sensor profile record (`SENSOR_PROFILES`, `resolveSensorProfile(id)` or a caller's modified copy), checked strictly as in a capture. */
  profile?: SensorProfile;
  /** Generic tier whose body is used (and whose sensor, without a profile). Default "professional". */
  camera?: GenericEquipmentTier;
  /** Sensor characteristics (#555) that override the profile's or the tier's one at a time, as in `simulateCapture`'s `sensor`. */
  characteristics?: Pick<SimulateCaptureSensorCharacteristics, "peakQuantumEfficiency" | "fullWell" | "readNoise" | "adcBitDepth">;
  /** ISO setting: one of the sensor's ISO settings. */
  iso: number;
}

export interface SensorFigures {
  iso: number;
  /** The photosite pitch, µm (a profile's own; a tier's 6 µm reference). */
  pixelPitchMicrometers: number;
  /** The green channel's peak EQE. */
  peakQuantumEfficiency: number;
  /** Full-well capacity of one photosite, e⁻. */
  fullWellElectrons: number;
  /** ADC bit depth at the ISO. */
  adcBitDepth: number;
  /** Read noise of each conversion gain, RMS e⁻, and the ISO from which the high gain is used (null: one gain). */
  readNoise: SimulateCaptureSensorReport["readNoise"];
  /** Read noise of one photosite at the ISO, RMS e⁻. */
  readNoiseElectrons: number;
  /**
   * Engineering dynamic range at the ISO, stops: log₂(S_sat / σ_floor), S_sat the charge at the RAW white level and σ_floor the
   * read noise and ADC quantization in quadrature (as `result.sensor.native.dynamicRangeStops`).
   */
  dynamicRangeStops: number;
  /** The same for every ISO setting of the sensor. */
  dynamicRangeByIso: readonly { iso: number; stops: number }[];
  /** EMVA 1288 Release 4.0 (§2.7, Eq. 26–28): absolute sensitivity threshold, dynamic range and saturation capacity per area. */
  emva1288: SimulateCaptureNativeSensorReport["emva1288"];
  /**
   * With a profile: the dynamic range of its whole frame (pixelsWide × pixelsHigh photosites) resampled to 8 million pixels,
   * DR + ½·log₂(photosites / 8e6), as `result.sensor.native.normalized8Megapixel` (a convention, not EMVA 1288). Null for a tier.
   */
  normalized8Megapixel: { referencePixels: 8_000_000; framePhotosites: number; dynamicRangeStops: number; emva1288DynamicRangeStops: number } | null;
  /**
   * The mid-grey figure: an 18 % grey card at the standard exposure for the ISO (focal-plane exposure H = 10/S, CIPA
   * DC-004-2020 §3.2), green channel, one photosite: signal, each noise component (shot, read, dark current at 1/125 s,
   * quantization) and their total (the per-pixel noise), SNR and SNR in dB.
   */
  midGrey: SimulateCaptureMidGreyFigure;
  /** The capture request's exposure: f/8, 1/125 s, the ISO, and the illuminance that gives the grey card the standard exposure. */
  exposure: { fNumber: number; shutterSeconds: number; illuminanceLux: number; /** The capture's default illuminant, K. */ illuminantKelvin: number };
}

/**
 * A sensor's figures at an ISO (#615), without setting up a capture: engineering and EMVA 1288 dynamic range (and per ISO),
 * the per-photosite read noise, and the mid-grey signal, noise components and SNR at the standard exposure.
 *
 * The figures are computed by `simulateCapture`'s own sensor model: this function runs the capture on a 2 × 2 uniform grey card
 * at f/8, 1/125 s and the illuminance that gives it the standard exposure H = 10/S (exact, `fast: false`) and returns its
 * `result.sensor.native` figures, so a capture of the same profile and ISO reports the same values (tested). The mid-grey
 * charge comes from the capture's spectral chain (the default 6500 K illuminant, the tier lens's transmission and the
 * sensor's EQE). Model figures from the engine's noise model, not measurements of a camera. It takes a few milliseconds.
 *
 * @param input A sensor profile or tier, optional sensor characteristics, and the ISO.
 * @returns The sensor figures.
 */
export async function calculateSensorFigures(input: CalculateSensorFiguresInput): Promise<CalculationResult<SensorFigures>> {
  requireInputKeys(input, "calculateSensorFigures", ["profile", "camera", "characteristics", "iso"]);
  requirePositiveFinite("iso", input.iso);
  if (input.characteristics !== undefined) {
    requireInputObject(input.characteristics, "characteristics");
    requireInputKeys(input.characteristics, "characteristics", ["peakQuantumEfficiency", "fullWell", "readNoise", "adcBitDepth"]);
  }
  if (input.camera !== undefined && input.camera !== "consumer" && input.camera !== "prosumer" && input.camera !== "professional") {
    throw new InvalidConfigurationError('camera must be "consumer", "prosumer" or "professional".');
  }
  const anchor = FACADE_EXPOSURE_ANCHOR, iso = input.iso;
  // An 18 % grey card at E lux has L = 0.18·E/π; at f/8 and 1/125 s the default illuminance gives it H = 10/S at ISO 100, so E·100/S does at S.
  const illuminanceLux = SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX * anchor.iso / iso;
  const result = await simulateCapture({ ...(input.camera === undefined ? {} : { camera: input.camera }), scene: { preset: "uniform" }, output: { width: 2, height: 2 }, fast: false,
    illuminanceLux, sensor: { ...(input.characteristics ?? {}), ...(input.profile === undefined ? {} : { profile: input.profile }) }, lens: { fNumber: anchor.fNumber },
    exposure: { mode: "manual", iso, shutterSeconds: anchor.shutterSeconds, metering: "grey-card" } });
  const sensor = result.sensor, native = sensor.native, profile = input.profile;
  const frame = profile ? profile.pixelsWide * profile.pixelsHigh : undefined, normalization = frame === undefined ? 0 : 0.5 * Math.log2(frame / 8e6);
  return calculatedResult(
    { iso, pixelPitchMicrometers: native.pixelPitchMicrometers, peakQuantumEfficiency: sensor.peakQuantumEfficiency, fullWellElectrons: native.fullWellElectrons,
      adcBitDepth: sensor.adcBitDepth, readNoise: sensor.readNoise, readNoiseElectrons: native.readNoiseElectrons, dynamicRangeStops: native.dynamicRangeStops,
      dynamicRangeByIso: native.dynamicRangeByIso, emva1288: native.emva1288,
      normalized8Megapixel: frame === undefined ? null : { referencePixels: 8e6, framePhotosites: frame, dynamicRangeStops: native.dynamicRangeStops + normalization,
        emva1288DynamicRangeStops: native.emva1288.dynamicRangeStops + normalization },
      midGrey: native.midGrey!,
      exposure: { fNumber: anchor.fNumber, shutterSeconds: anchor.shutterSeconds, illuminanceLux, illuminantKelvin: 6500 } },
    "sensor-figures",
    "1.0.0",
    [
      "Model figures from simulateCapture's sensor and noise model (result.sensor.native), not measurements of a camera.",
      "Mid-grey: an 18 % Lambertian grey card at the standard exposure H = 10/S (CIPA DC-004-2020 §3.2), green channel, one photosite, the default 6500 K illuminant.",
      "Dynamic range: log2 of the white-level charge over the read and quantization noise; EMVA 1288 Release 4.0 Eq. 26–28 alongside."
    ]
  );
}
