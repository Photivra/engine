# facade/sensor-figures.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorFigures

A sensor's figures at an ISO (#615), without setting up a capture: engineering and EMVA 1288 dynamic range (and per ISO),
the per-photosite read noise, and the mid-grey signal, noise components and SNR at the standard exposure.

The figures are computed by `simulateCapture`'s own sensor model: this function runs the capture on a 2 × 2 uniform grey card
at f/8, 1/125 s and the illuminance that gives it the standard exposure H = 10/S (exact, `fast: false`) and returns its
`result.sensor.native` figures, so a capture of the same profile and ISO reports the same values (tested). The mid-grey
charge comes from the capture's spectral chain (the default 6500 K illuminant, the tier lens's transmission and the
sensor's EQE). Model figures from the engine's noise model, not measurements of a camera. It takes a few milliseconds.

```ts
export async function calculateSensorFigures(input: CalculateSensorFiguresInput): Promise<CalculationResult<SensorFigures>>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## CalculateSensorFiguresInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## SensorFigures

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```
