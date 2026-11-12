# exposure/flash.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createHighSpeedSyncIlluminationOverlay

Registers a resolved high-speed-sync burst as a temporal illumination overlay: a rectangular
waveform over [0, D]. Each line then collects the burst over its own local exposure window.

```ts
export function createHighSpeedSyncIlluminationOverlay(
  input: Omit<CreateManualFlashIlluminationOverlayInput, "resolvedSync"> & { resolvedSync: ResolvedHighSpeedFlashSync }
): ManualFlashIlluminationOverlay;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createManualFlashIlluminationOverlay

Builds a temporal illumination overlay from the resolved manual pulse. The identity of the base
ambient light source is kept.

Manual flash is a relative light pulse added on top of the scene light, timed on the capture's
opening-reference clock. Ordinary front- or rear-curtain sync needs a real interval when the whole
frame is open at once. High-speed sync (HSS), TTL and flash metering are not handled here. Source
brightness, optical transport and sensor integration have their own contracts.

```ts
export function createManualFlashIlluminationOverlay(
  input:
    CreateManualFlashIlluminationOverlayInput
): ManualFlashIlluminationOverlay;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateManualFlashIlluminationOverlayInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateManualFlashIlluminationOverlayInput {
  baseIlluminationProfile:
    SceneIlluminationProfile;
  baseTemporalProfile?:
    SceneIlluminationTemporalProfile;
  flashProfile:
    ManualFlashProfile;
  resolvedSync:
    FlashOverlaySyncRegistration;
  illuminationProfileId: string;
  temporalProfileId: string;
}
```

## FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION

Sync-capability schema that may declare high-speed sync (a fast pulse train that acts as continuous light).

```ts
FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION =
  "0.2.0" as const
```

## FLASH_SYNC_CAPABILITY_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
FLASH_SYNC_CAPABILITY_SCHEMA_VERSION =
  "0.1.0" as const
```

## FlashOverlaySyncRegistration

Fields of a resolved sync (ordinary or HSS) needed to register a flash overlay.

```ts
export type FlashOverlaySyncRegistration = Pick<
  ResolvedManualFlashSync,
  | "flashEnabled"
  | "flashProfileId"
  | "flashProfileVersion"
  | "sourceId"
  | "waveformTimeZeroSecondsFromCaptureReference"
  | "evidence"
>;
```

## FlashSyncCapabilityProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FlashSyncCapabilityProfile {
  schemaVersion:
    | typeof FLASH_SYNC_CAPABILITY_SCHEMA_VERSION
    | typeof FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  captureModeId: string;
  timingProfileId: string;
  supportedOrdinarySyncModes:
    readonly ManualFlashSyncMode[];
  /** Schema 0.1.0 is always false; schema 0.2.0 may declare HSS with {@link highSpeedSync}. */
  highSpeedSyncSupported: boolean;
  /** Present exactly when highSpeedSyncSupported is true (schema 0.2.0). */
  highSpeedSync?: {
    /**
     * η: energy of one full-power high-speed-sync burst, as a fraction of one full-power ordinary
     * pulse, in (0, 1]. The caller declares it from evidence (capacitor and thermal limits). It is
     * never inferred.
     */
    burstEnergyFractionOfFullPulse: number;
    evidence: readonly EvidenceProvenance[];
  };
  ordinarySyncRequiresWholeActiveFrameSimultaneouslyExposed:
    true;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## HIGH_SPEED_SYNC_MODEL

Model identity of the pulsed quasi-continuous high-speed-sync burst.

```ts
HIGH_SPEED_SYNC_MODEL = Object.freeze({
  id: "flash-hss-quasi-continuous-burst",
  version: "1.0.0"
} as const)
```

## MANUAL_FLASH_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
MANUAL_FLASH_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## ManualFlashIlluminationOverlay

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ManualFlashIlluminationOverlay {
  flashApplied: boolean;
  illuminationProfile:
    SceneIlluminationProfile;
  temporalProfile:
    SceneIlluminationTemporalProfile | null;
  sourceId: string;
  waveformId: string;
  timeReference:
    "first-opening-boundary-phase";
  sourceMagnitudeAppliedBySceneTransport:
    true;
  materialTransportOwnedBySceneRadiance:
    true;
  visibilityOwnedBySceneRadiance:
    true;
  indirectTransportOwnedBySceneRadiance:
    true;
  postRenderBrightnessMultiplierUsed:
    false;
  whiteBalanceModified: false;
  ambientMeteringModified: false;
  ttlMeteringIncluded: false;
  ambientTemporalBehaviorPreserved:
    true;
}
```

## ManualFlashProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ManualFlashProfile {
  schemaVersion:
    typeof MANUAL_FLASH_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  sourceTemplate:
    Omit<
      SceneIlluminationSource,
      "enabled" |
      "temporalBehavior"
    >;
  pulse:
    ManualFlashPulseProfile;
  outputControl: {
    kind:
      "relative-linear-source-scale";
    scale: number;
    flashExposureCompensationStops:
      0;
  };
  ttlModeled: false;
  highSpeedSyncModeled: false;
  recycleBehaviorModeled: false;
  redEyePreflashModeled: false;
  modelingLightModeled: false;
  afAssistModeled: false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## ManualFlashPulseProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ManualFlashPulseProfile {
  waveformId: string;
  scientificStatus: "approximation";
  supportDurationSeconds: number;
  interpolation: "piecewise-linear";
  samples:
    readonly SceneIlluminationTemporalWaveformSample[];
  normalization:
    "relative-peak-one";
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## ManualFlashSyncMode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ManualFlashSyncMode =
  | "front-curtain"
  | "rear-curtain";
```

## parseFlashSyncCapabilityProfile

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

Manual flash is a relative light pulse added on top of the scene light, timed on the capture's
opening-reference clock. Ordinary front- or rear-curtain sync needs a real interval when the whole
frame is open at once. High-speed sync (HSS), TTL and flash metering are not handled here. Source
brightness, optical transport and sensor integration have their own contracts.

```ts
export function parseFlashSyncCapabilityProfile(
  value: unknown
): FlashSyncCapabilityProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseManualFlashProfile

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

Manual flash is a relative light pulse added on top of the scene light, timed on the capture's
opening-reference clock. Ordinary front- or rear-curtain sync needs a real interval when the whole
frame is open at once. High-speed sync (HSS), TTL and flash metering are not handled here. Source
brightness, optical transport and sensor integration have their own contracts.

```ts
export function parseManualFlashProfile(
  value: unknown
): ManualFlashProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## RequestedFlashSyncMode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RequestedFlashSyncMode =
  | ManualFlashSyncMode
  | "high-speed-sync";
```

## ResolvedHighSpeedFlashSync

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedHighSpeedFlashSync extends FlashOverlaySyncRegistration {
  modelId: typeof HIGH_SPEED_SYNC_MODEL.id;
  modelVersion: typeof HIGH_SPEED_SYNC_MODEL.version;
  syncMode: "high-speed-sync";
  syncStatus: "disabled" | "high-speed-sync-resolved";
  captureModeId: string;
  timingProfileId: string;
  syncCapabilityProfileId: string;
  timeReference: "first-opening-boundary-phase";
  powerFraction: number;
  /** η from the sync capability profile. */
  burstEnergyFractionOfFullPulse: number;
  /** ∫ pulse(t) dt of the declared ordinary pulse, whose relative peak is 1 (relative multiplier · s). */
  singlePulseIntegratedRelativeSeconds: number;
  /** D: burst support covering the first line opening to the last line closing. */
  burstStartSecondsFromCaptureReference: number;
  burstEndSecondsFromCaptureReference: number;
  burstDurationSeconds: number;
  /** Local (slit) exposure durations t_e over the active frame. */
  localExposureDurationRangeSeconds: { minimum: number; maximum: number };
  /** Flash energy each line receives relative to one ordinary pulse at the same power: η·t_e/D. */
  energyFractionOfSinglePulseRange: { minimum: number; maximum: number };
  /** Effective guide-number factor relative to the same-power ordinary pulse: √(η·t_e/D). */
  guideNumberFactorRange: { minimum: number; maximum: number };
  uniformAcrossActiveFrame: boolean;
  /** The rectangular high-speed-sync burst, written as a manual pulse profile for the illumination overlay. */
  burstFlashProfile: ManualFlashProfile | null;
  releaseFrameBinding:
    | {
        sequenceId: string;
        releaseFrameId: string;
        frameIndex: number;
        sceneTimeSecondsFromSequenceStartAtBurstStart: number;
        sceneTimeSecondsFromSequenceStartAtBurstEnd: number;
      }
    | null;
  hssModeled: true;
  ttlModeled: false;
  sensorReadoutTimingUsedAsExposureTiming: false;
  limitations: readonly string[];
}
```

## ResolvedManualFlashSync

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedManualFlashSync {
  flashEnabled: boolean;
  flashProfileId: string;
  flashProfileVersion: string;
  sourceId: string;
  captureModeId: string;
  timingProfileId: string;
  syncCapabilityProfileId:
    string;
  syncMode:
    RequestedFlashSyncMode;
  syncStatus:
    | "disabled"
    | "ordinary-sync-resolved";
  timeReference:
    "first-opening-boundary-phase";
  wholeActiveFrameOpenInterval:
    {
      startSecondsFromCaptureReference:
        number;
      endSecondsFromCaptureReference:
        number;
      durationSeconds: number;
    };
  pulseSupportDurationSeconds:
    number;
  pulseStartSecondsFromCaptureReference:
    number | null;
  pulseEndSecondsFromCaptureReference:
    number | null;
  waveformTimeZeroSecondsFromCaptureReference:
    number | null;
  releaseFrameBinding:
    | {
        sequenceId: string;
        releaseFrameId: string;
        frameIndex: number;
        sceneTimeSecondsFromSequenceStartAtPulseStart:
          number;
        sceneTimeSecondsFromSequenceStartAtPulseEnd:
          number;
      }
    | null;
  hssModeled: false;
  ttlModeled: false;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
  whiteBalanceModified: false;
  focusModified: false;
  exposureSettingsModified: false;
  driveModeModified: false;
  supportStateModified: false;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## resolveHighSpeedFlashSync

Resolves high-speed (focal-plane) sync (HSS): a fast pulse train that acts as continuous light and
covers the whole travelling-slit exposure.

At shutter speeds faster than the ordinary sync limit, the shutter's opening and closing edges
cross the frame as a slit, and the whole frame is never open at once. A single short pulse would
light only a band.

HSS instead fires a rapid pulse train. It behaves like constant output P over the burst D, from
the first line opening to the last line closing. Each line collects P·t_e over its slit time t_e.
- The burst energy is E_burst = η·p·E_pulse. η comes from the sync profile, p is the power
  fraction and E_pulse is the energy of an ordinary full-power pulse.
- So P = E_burst/D, and each line receives η·p·E_pulse·t_e/D.
- Exposure ∝ GN² (inverse-square law, GN = d·N). So, relative to an ordinary pulse at the same
  power, the effective guide number is GN_HSS/GN = √(η·t_e/D).
Shortening t_e by one stop therefore costs half a stop of guide number.

Approximations: the pulse train is treated as continuous (pulse period ≪ t_e). Recycle and thermal
limits are folded into η. Front/rear-curtain placement does not apply, because the burst covers
the whole exposure.

```ts
export function resolveHighSpeedFlashSync(input: ResolveHighSpeedFlashSyncInput): ResolvedHighSpeedFlashSync;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveHighSpeedFlashSyncInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveHighSpeedFlashSyncInput {
  flashEnabled: boolean;
  /** Ordinary full-power pulse definition; its integral defines the full-power pulse energy. */
  flashProfile: ManualFlashProfile;
  /** Schema 0.2.0 profile with highSpeedSyncSupported true. */
  syncCapabilities: FlashSyncCapabilityProfile;
  timing: ResolvedCaptureModeTiming;
  /** Commanded output as a fraction of full power, (0, 1]. */
  powerFraction: number;
  releaseFrame?: ResolvedReleaseFrame;
}
```

## resolveManualFlashSync

Places a declared ordinary flash pulse inside the actual interval when the whole frame is open, for
front- or rear-curtain sync. Otherwise returns a structured incompatibility.

Manual flash is a relative light pulse added on top of the scene light, timed on the capture's
opening-reference clock. Ordinary front- or rear-curtain sync needs a real interval when the whole
frame is open at once. High-speed sync (HSS), TTL and flash metering are not handled here. Source
brightness, optical transport and sensor integration have their own contracts.

```ts
export function resolveManualFlashSync(
  input:
    ResolveManualFlashSyncInput
): ResolvedManualFlashSync;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveManualFlashSyncInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveManualFlashSyncInput {
  flashEnabled: boolean;
  flashProfile:
    ManualFlashProfile;
  syncCapabilities:
    FlashSyncCapabilityProfile;
  timing:
    ResolvedCaptureModeTiming;
  syncMode:
    RequestedFlashSyncMode;
  releaseFrame?:
    ResolvedReleaseFrame;
}
```
