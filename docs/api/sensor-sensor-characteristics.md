# sensor/sensor-characteristics.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## SimulateCaptureNoiseComponents

One RMS noise component of the mid-grey figure, e⁻ (input-referred).

```ts
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
```

## SimulateCaptureSensorCharacteristics

#555: sensor characteristics a capture can set one at a time (`simulateCapture({ sensor })`). Each is off by default: an
omitted field keeps the camera body's value, and a request with none of them is byte-identical to one before 2.20.0.
Every value set is listed in the result's `assumptions`.

```ts
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
```

## SimulateCaptureSensorReport

#555, #535: the capture's sensor characteristics as used, and the figures calculated from them (reported, not settable).
Model figures from the engine's own noise model, not measurements.

```ts
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
   * the figure no longer describes the image.
   */
  midGrey: { reflectance: 0.18; channel: "green"; signalElectrons: number; noiseElectrons: SimulateCaptureNoiseComponents; snr: number; snrDecibels: number; clipped: boolean };
}
```
