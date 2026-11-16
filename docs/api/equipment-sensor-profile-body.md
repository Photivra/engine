# equipment/sensor-profile-body.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## resolveSensorProfileIsoSettings

#635: the profile's ISO settings, the third-stop markings from its base ISO to its maximum ({@link SENSOR_PROFILE_ISO_MARKINGS}): the
values `exposure.iso` takes with this profile, in ascending order. The record is checked as a capture checks it.

```ts
export function resolveSensorProfileIsoSettings(profile: SensorProfile): readonly number[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SENSOR_PROFILE_ISO_ANCHOR

The engine's ISO anchor (see the module comment): white charge 60 000 e⁻ at ISO 100, 36 µm², QE 0.5.

```ts
SENSOR_PROFILE_ISO_ANCHOR = Object.freeze({ iso: 100, fullWellElectrons: 60000, pixelAreaSquareMicrometers: 36, peakQuantumEfficiency: .5 })
```

## SENSOR_PROFILE_ISO_MARKINGS

Third-stop ISO markings from ISO 32 to 102 400 (S = 100·2^(k/3), rounded; the tiers' list in the middle): a profile's ISO settings.

```ts
SENSOR_PROFILE_ISO_MARKINGS: readonly number[] = Object.freeze([32, 40, 50, 64, 80, ...GENERIC_THIRD_STOP_ISO_SETTINGS, 32000, 40000, 51200, 64000, 80000, 102400])
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
  /** "phone": the profile takes only the catalogue's phone lenses (`lens.catalogue`), which need it. */
  fixedLenses: "phone" | null;
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
