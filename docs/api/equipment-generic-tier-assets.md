# equipment/generic-tier-assets.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## GENERIC_THIRD_STOP_ISO_SETTINGS

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
GENERIC_THIRD_STOP_ISO_SETTINGS = Object.freeze([100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600,
  2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600] as const)
```

## GENERIC_THIRD_STOP_SHUTTER_SECONDS

The standard third-stop shutter times, seconds, from 1/8000 s to 30 s: the conventional markings of t = 2^(k/3) s
(1/8000 for 2^−13, 1/6 for 2^−8/3, 0.3 for 2^−5/3, 30 for 2^5; each within 7 % of the exact value). The generic bodies'
shutters are continuous over 1/8000–30 s and take any time as exact, so these are the values to offer in a third-stop
dial, not a restriction.

```ts
GENERIC_THIRD_STOP_SHUTTER_SECONDS = Object.freeze([1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000,
  1 / 1600, 1 / 1250, 1 / 1000, 1 / 800, 1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250, 1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40,
  1 / 30, 1 / 25, 1 / 20, 1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3.2, 4, 5, 6, 8, 10, 13,
  15, 20, 25, 30] as const)
```

## GENERIC_WHOLE_STOP_ISO_SETTINGS

Whole-stop ISO settings of the 2.0.0 bodies (each body's list stops at its maximum).

```ts
GENERIC_WHOLE_STOP_ISO_SETTINGS = Object.freeze([100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600] as const)
```

## GenericEquipmentTier

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type GenericEquipmentTier = "consumer" | "prosumer" | "professional";
```

## GenericEquipmentTierPreset

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericEquipmentTierPreset {
  tier: GenericEquipmentTier;
  label: "Consumer" | "Prosumer" | "Professional";
  presetId: string; presetVersion: GenericTierPresetVersion;
  scientificStatus: "approximation";
  evidence: readonly EvidenceProvenance[];
  body: GenericTierBodyAssets;
  lens: GenericTierLensAssets;
  tradeoffs: readonly string[];
}
```

## GenericTierBodyAssets

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericTierBodyAssets {
  exposure: GenericBodyExposureCapabilityProfile;
  iso: IsoCapabilityProfile;
  signalChain: GenericIsoSignalChainProfile;
  readout: readonly GenericVersionedAsset<SensorReadoutConversionProfile>[];
  /** Global data readout (no skew across the frame). The default timing asset. */
  readoutTiming: GenericVersionedAsset<SensorReadoutTimingDeclaration>;
  /** Optional rolling readout variant, with an explicit top-to-bottom skew across the frame. */
  rollingReadoutTiming: GenericVersionedAsset<SensorReadoutTimingDeclaration>;
  /** Optional synthetic fixed-pattern noise for this body. Never applied unless a caller attaches it. */
  fixedPatternNoise: GenericVersionedAsset<SensorFixedPatternNoiseProfile>;
  release: GenericReleaseCapabilityProfile;
  focus: FocusControlProfile;
  stabilization: StabilizationSystemProfile;
  whiteBalance: WhiteBalanceProfile;
  metering: readonly GenericVersionedAsset<ExposureMeteringProfile>[];
  meteringCapabilities: GenericBodyMeteringCapabilityProfile;
  flashSync: FlashSyncCapabilityProfile;
}
```

## GenericTierLensAssets

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericTierLensAssets {
  form: "prime";
  exposure: GenericLensExposureCapabilityProfile;
  /** Explicit synthetic coefficients, not measured calibration or a quality score. */
  matchedReference: {
    focalLengthMm: 50; aperture: 4; focusDistanceM: 5; wavelengthNm: 550;
    normalizationRadiusMm: number;
    distortionK1: number; lateralCaK1Offset: number; vignettingR2: number;
    breathingProjectionScale: number; transmission: number;
    correctionGainStrength: number; correctionCaFraction: number;
    ghostPowerFraction: number; veilPowerFraction: number;
    pupilAmplitudeByField: readonly (readonly number[])[];
    pupilOpdMicrometersByDefocus: readonly (readonly number[])[];
    pupilThroughputByField: readonly number[];
  };
  profileReferences: readonly { profileId: string; profileVersion: string }[];
  limitations: readonly string[];
}
```

## GenericTierPresetVersion

The exact versions of the generic tier presets (no "latest" alias). 2.1.0 (2.14, round 5) adds the third-stop ISO
settings; 2.0.0 is kept, whole-stop, so saved selections and records of it still resolve to exactly what they named.

```ts
export type GenericTierPresetVersion = "2.0.0" | "2.1.0";
```

## GenericVersionedAsset

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericVersionedAsset<T> { assetId: string; assetVersion: string; profile: T }
```
