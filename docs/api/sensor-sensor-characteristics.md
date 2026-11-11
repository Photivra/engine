# sensor/sensor-characteristics.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## SimulateCaptureMidGreyFigure

#535: the mid-grey noise figure of {@link SimulateCaptureSensorReport.midGrey}.

```ts
export interface SimulateCaptureMidGreyFigure { reflectance: 0.18; channel: "green"; signalElectrons: number; noiseElectrons: SimulateCaptureNoiseComponents; snr: number; snrDecibels: number; clipped: boolean }
```

## SimulateCaptureNativeSensorReport

#595: {@link SimulateCaptureSensorReport.native}, the figures of one native photosite.

```ts
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
```

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
   * Read noise, RMS e⁻ (0–100), of each rendered site (2.22.0: on a tier above its 6 µm photosite a site sums N photosites and this
   * is the site's value, the photosite's being that over √N; with `sensor.profile` it is per photosite and the site takes it ×√N), of
   * the low and the high conversion gain, and the dual-gain switch: the ISO setting from
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
```
