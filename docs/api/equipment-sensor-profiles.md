# equipment/sensor-profiles.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## resolveSensorProfile

The profile with this id; a clear error listing the ids otherwise.

```ts
export function resolveSensorProfile(id: unknown): SensorProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SENSOR_PROFILE_IDS

The profile ids, in catalogue order.

```ts
SENSOR_PROFILE_IDS: readonly string[] = Object.freeze(SENSOR_PROFILES.map((p) => p.id))
```

## SENSOR_PROFILE_ISO_ANCHOR

The engine's ISO anchor (see the module comment): white charge 60 000 e⁻ at ISO 100, 36 µm², QE 0.5.

```ts
SENSOR_PROFILE_ISO_ANCHOR = Object.freeze({ iso: 100, fullWellElectrons: 60000, pixelAreaSquareMicrometers: 36, peakQuantumEfficiency: .5 })
```

## SENSOR_PROFILES

The catalogue, in the issue's order. Frozen.

```ts
SENSOR_PROFILES: readonly SensorProfile[] = Object.freeze(([
  { id: "full-frame-24mp-bsi-2020s", name: "Full frame 24 MP BSI, 2020s", marketTag: "consumer", architecture: "back-illuminated",
    sensorWidthMm: 36.07, sensorHeightMm: 24.01, pixelsWide: 6072, pixelsHigh: 4042, pixelPitchMicrometers: 5.94, peakQuantumEfficiency: .8,
    fullWellElectrons: 100000, readNoise: { lowGainElectrons: 6.4, highGainElectrons: 1.1, highGainFromIso: 500 }, highGainFullWellElectrons: 20000,
    adcBitDepth: 14, baseIso: 100, maximumIso: 51200, maximumAnalogGain: 64, readoutSeconds: .05, fixedPattern: BSI,
    goodFor: ["landscape", "portrait", "travel"], description: "Large pixels and a deep full well for wide dynamic range at base ISO; a moderate readout shows some rolling-shutter skew.",
    provenance: { ...sourced("S1", "pixels", "pixelPitchMicrometers", "peakQuantumEfficiency", "fullWellElectrons", "readNoise", "adcBitDepth"),
      sensorSize: "derived", architecture: "published S1", highGainFromIso: "derived S1", highGainFullWellElectrons: "derived", baseIso: "derived" } },
  { id: "full-frame-45mp-stacked-2020s", name: "Full frame 45 MP stacked, 2020s", marketTag: "professional", architecture: "stacked",
    sensorWidthMm: 36, sensorHeightMm: 24, pixelsWide: 8256, pixelsHigh: 5504, pixelPitchMicrometers: 4.36, peakQuantumEfficiency: .8,
    fullWellElectrons: 69000, readNoise: { lowGainElectrons: 3.5, highGainElectrons: 1.5, highGainFromIso: 250 }, highGainFullWellElectrons: 22080,
    adcBitDepth: 14, baseIso: 80, maximumIso: 25600, maximumAnalogGain: 64, readoutSeconds: .005, fixedPattern: BSI,
    goodFor: ["landscape", "studio", "wildlife"], description: "High resolution with a fast stacked readout: fine detail for landscape and studio work, little rolling-shutter skew for action.",
    provenance: { pixelPitchMicrometers: "derived", fullWellElectrons: "design (S2 scaled by pixel area)", readNoise: "design (S2)", highGainFromIso: "design (S2)",
      highGainFullWellElectrons: "derived", baseIso: "derived" } },
  { id: "full-frame-24mp-stacked-sports-2020s", name: "Full frame 24 MP stacked (sports), 2020s", marketTag: "professional", architecture: "stacked",
    sensorWidthMm: 36, sensorHeightMm: 24, pixelsWide: 6000, pixelsHigh: 4000, pixelPitchMicrometers: 6, peakQuantumEfficiency: .8,
    fullWellElectrons: 80000, readNoise: { lowGainElectrons: 3, highGainElectrons: 1, highGainFromIso: 400 }, highGainFullWellElectrons: 25000,
    adcBitDepth: 14, baseIso: 125, maximumIso: 102400, maximumAnalogGain: 64, readoutSeconds: .0025, fixedPattern: BSI,
    goodFor: ["sports", "wildlife", "journalism"], description: "The fastest readout and low high-gain read noise: almost no rolling-shutter skew and clean high ISO, at a moderate resolution.",
    provenance: { pixelPitchMicrometers: "derived", highGainFullWellElectrons: "derived", baseIso: "derived" } },
  { id: "full-frame-24mp-fsi-2010s", name: "Full frame 24 MP front-illuminated, 2010s", marketTag: "professional", architecture: "front-illuminated",
    sensorWidthMm: 36.01, sensorHeightMm: 24.07, pixelsWide: 6032, pixelsHigh: 4032, pixelPitchMicrometers: 5.97, peakQuantumEfficiency: .53,
    fullWellElectrons: 76000, readNoise: { lowGainElectrons: 4, highGainElectrons: 4, highGainFromIso: null }, highGainFullWellElectrons: null,
    adcBitDepth: 14, baseIso: 80, maximumIso: 25600, maximumAnalogGain: 64, readoutSeconds: .08, fixedPattern: FSI,
    goodFor: ["portrait", "landscape", "journalism"], description: "An older professional sensor: lower QE and one conversion gain, so a modern consumer BSI sensor beats it at high ISO; slow readout.",
    provenance: { ...sourced("S3", "pixels", "pixelPitchMicrometers", "peakQuantumEfficiency", "fullWellElectrons", "adcBitDepth"),
      sensorSize: "derived", architecture: "derived S4", baseIso: "derived" } },
  { id: "aps-c-24mp-fsi-2020s", name: "APS-C 24 MP front-illuminated, 2020s", marketTag: "consumer", architecture: "front-illuminated",
    sensorWidthMm: 23.55, sensorHeightMm: 15.73, pixelsWide: 6024, pixelsHigh: 4024, pixelPitchMicrometers: 3.91, peakQuantumEfficiency: .55,
    fullWellElectrons: 36000, readNoise: { lowGainElectrons: 2.7, highGainElectrons: 2.7, highGainFromIso: null }, highGainFullWellElectrons: null,
    adcBitDepth: 14, baseIso: 80, maximumIso: 25600, maximumAnalogGain: 64, readoutSeconds: .06, fixedPattern: FSI,
    goodFor: ["travel", "family", "learning"], description: "A smaller, front-illuminated sensor: less light per pixel, a slower readout and more rolling-shutter skew.",
    provenance: { ...sourced("S5", "pixels", "pixelPitchMicrometers", "architecture", "fullWellElectrons", "readNoise", "adcBitDepth"), sensorSize: "derived", baseIso: "derived" } },
  { id: "aps-c-26mp-bsi-2020s", name: "APS-C 26 MP BSI, 2020s", marketTag: "professional", architecture: "back-illuminated",
    sensorWidthMm: 23.49, sensorHeightMm: 15.7, pixelsWide: 6248, pixelsHigh: 4176, pixelPitchMicrometers: 3.76, peakQuantumEfficiency: .8,
    fullWellElectrons: 50000, readNoise: { lowGainElectrons: 3.3, highGainElectrons: 1, highGainFromIso: 250 }, highGainFullWellElectrons: 16000,
    adcBitDepth: 14, baseIso: 80, maximumIso: 25600, maximumAnalogGain: 64, readoutSeconds: .025, fixedPattern: BSI,
    goodFor: ["wildlife", "sports", "travel"], description: "A BSI APS-C sensor with dual conversion gain whose readout beats the consumer full-frame profile's.",
    provenance: { ...sourced("S6", "pixels", "pixelPitchMicrometers", "peakQuantumEfficiency", "fullWellElectrons", "readNoise"), sensorSize: "derived",
      architecture: "published S6", highGainFromIso: "design (S7)", highGainFullWellElectrons: "derived", baseIso: "derived" } },
  { id: "medium-format-100mp-bsi-16bit", name: "Medium format 100 MP BSI, 16-bit", marketTag: "professional", architecture: "back-illuminated",
    sensorWidthMm: 43.856, sensorHeightMm: 32.9, pixelsWide: 11656, pixelsHigh: 8750, pixelPitchMicrometers: 3.76, peakQuantumEfficiency: .8,
    fullWellElectrons: 50300, readNoise: { lowGainElectrons: 3.3, highGainElectrons: 1, highGainFromIso: 250 }, highGainFullWellElectrons: 16096,
    adcBitDepth: 16, baseIso: 80, maximumIso: 12800, maximumAnalogGain: 64, readoutSeconds: .25, fixedPattern: BSI,
    goodFor: ["studio", "landscape", "portrait"], description: "A large sensor with 100 MP and a 16-bit RAW; a slow readout makes its electronic shutter unsuited to motion.",
    provenance: { ...sourced("S7", "pixels", "pixelPitchMicrometers", "sensorSize", "fullWellElectrons", "readNoise", "adcBitDepth"), architecture: "published S8",
      highGainFromIso: "derived S7", highGainFullWellElectrons: "derived", baseIso: "derived" } },
  { id: "phone-50mp-stacked", name: "Phone, large, 50 MP stacked", marketTag: "consumer", architecture: "stacked",
    sensorWidthMm: 9.844, sensorHeightMm: 7.431, pixelsWide: 8192, pixelsHigh: 6144, pixelPitchMicrometers: 1.197, peakQuantumEfficiency: .75,
    fullWellElectrons: 8600, readNoise: { lowGainElectrons: 3, highGainElectrons: 1.4, highGainFromIso: 160 }, highGainFullWellElectrons: 2150,
    adcBitDepth: 12, baseIso: 40, maximumIso: 6400, maximumAnalogGain: 64, readoutSeconds: 1 / 30,
    fixedPattern: { prnu: .008, dsnu: .3, hotPixelFraction: 2e-4, hotPixelMultiplier: 50, rowElectrons: .2, columnElectrons: .2 },
    goodFor: ["everyday", "travel", "family"], description: "A large phone sensor: tiny pixels with a small full well, so less dynamic range and more noise per pixel; simulated as a single frame (no multi-frame stacking).",
    provenance: { ...sourced("S9", "pixels", "pixelPitchMicrometers", "sensorSize", "architecture", "adcBitDepth"), fullWellElectrons: "design (S10 scaled by pixel area)",
      readNoise: "high gain published S10, low gain design", highGainFullWellElectrons: "derived", readoutSeconds: "derived S9 (1 / full-resolution frame rate)",
      fixedPattern: "PRNU, row and column published S10; the rest design", baseIso: "derived" } }
] satisfies SensorProfile[]).map((p) => Object.freeze(p)))
```

## SensorProfile

One sensor profile. Every number is per photosite unless stated; see `provenance` for each value's kind.

```ts
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
  /**
   * Each value's kind and source key (S1–S10, docs/SENSOR_PROFILES.md "Sources"); a value not listed is a design value.
   * For example `fullWellElectrons: "published S1"` or `baseIso: "derived"`.
   */
  provenance: Readonly<Partial<Record<keyof SensorProfile | "sensorSize" | "pixels" | "highGainFromIso", string>>>;
}
```

## SensorProfileValueKind

How a profile value was obtained: copied from a source, calculated from sourced values, or Photivra's design value.

```ts
export type SensorProfileValueKind = "published" | "derived" | "design";
```
