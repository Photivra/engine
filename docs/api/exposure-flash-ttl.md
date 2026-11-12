# exposure/flash-ttl.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateFlashGuideNumber

Effective guide number GN = GN_full · √p · √(ISO/100).

The guide number relation GN = d·N follows from the inverse-square law. Light on the subject from a
point-like flash falls as 1/d², and sensor exposure falls as 1/N². So exposure stays correct while
d·N is constant (camera equation H = 0.65·L·t/N² and reference exposure H = 10/S, CIPA DC-004-2020,
free). Exposure grows linearly with emitted energy (power fraction p), and the exposure needed falls
inversely with ISO speed. So GN ∝ √p·√ISO. The engine does not model how a guide number is measured;
the caller supplies it.

```ts
export function calculateFlashGuideNumber(input: FlashGuideNumberInput): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateFlashPowerForDistance

Manual guide-number exposure: the power fraction that exposes a subject at distance d correctly.

```ts
export function calculateFlashPowerForDistance(input: FlashPowerForDistanceInput): FlashPowerForDistance;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createTtlScaledFlashProfile

Returns a copy of a manual flash profile with its relative output scaled by a resolved TTL power
fraction, ready for resolveManualFlashSync (front/rear curtain). For high-speed sync, instead pass
the unscaled profile, and pass `ttl.powerFraction` as resolveHighSpeedFlashSync's powerFraction.
That way power is applied only once.

```ts
export function createTtlScaledFlashProfile(flashProfile: ManualFlashProfile, ttl: TtlFlashExposure): ManualFlashProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## FlashGuideNumberInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FlashGuideNumberInput {
  /** Guide number at full power for ISO 100, in metres (GN = distance · f-number). */
  fullPowerGuideNumberMetersIso100: number;
  /** Output as a fraction of full power, (0, 1]. */
  powerFraction: number;
  iso: number;
}
```

## FlashPowerForDistance

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FlashPowerForDistance {
  /** p = (d·N / (GN_full·√(ISO/100)))², before clamping. */
  requiredPowerFraction: number;
  powerFraction: number;
  status: "within-range" | "clamped-at-minimum-power" | "clamped-at-full-power";
  /** log2(delivered / required) flash exposure; positive is overexposure. */
  flashExposureErrorStops: number;
  /** GN_full·√(ISO/100)/N: the farthest correctly exposed distance at full power. */
  maximumDistanceM: number;
}
```

## FlashPowerForDistanceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FlashPowerForDistanceInput {
  fullPowerGuideNumberMetersIso100: number;
  subjectDistanceM: number;
  apertureFNumber: number;
  iso: number;
  /** Lowest available power fraction, (0, 1]. */
  minimumPowerFraction: number;
}
```

## resolveTtlFlashExposure

Solves the main-flash power from a pre-flash measurement (manufacturer-independent TTL).

The meter is linear for the policies allowed here: M(a + b) = M(a) + M(b).
- The pre-flash at power p_pre adds a flash-only signal f_i = pre_i − ambient_i in each zone.
- Flash signal is proportional to emitted energy, so at main power p it adds (p/p_pre)·M(f).
- With ambient scaled to the main exposure by k, the metered total is k·A + p·F, where
  F = M(f)/p_pre.
- Setting this equal to the target T' = T·2^FEC gives p = (T' − k·A)/(F·s). Here s is the sync
  energy factor (1 for ordinary sync, η·t_e/D for high-speed sync).
- p is clamped to [p_min, 1], the guide-number range.
Highlight policies are rejected: their weights depend on the signal, so the total is no longer
linear in p.

```ts
export function resolveTtlFlashExposure(input: ResolveTtlFlashExposureInput): CalculationResult<TtlFlashExposure>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveTtlFlashExposureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveTtlFlashExposureInput {
  /** Spatially linear metering profile (multi-zone-uniform, center-weighted-radial or spot). */
  meteringProfile: ExposureMeteringProfile;
  /** Measurement-window samples with the flash off. */
  ambientSampleSet: ExposureMeteringSampleSet;
  /** The same zones and settings with the pre-flash fired. */
  preFlashSampleSet: ExposureMeteringSampleSet;
  /** Pre-flash output as a fraction of full power, (0, 1]. */
  preFlashPowerFraction: number;
  /**
   * Ratio of ambient light collected in the main exposure to that in the measurement window, at the
   * same aperture and ISO (for example t_main/t_measure). Must be ≥ 0. The flash pulse falls inside
   * both windows, so it is not scaled.
   */
  ambientScaleToMainExposure: number;
  /** Flash exposure compensation applied to the TTL target, in stops. */
  flashExposureCompensationStops: number;
  /** Lowest available main-flash power fraction, (0, 1]. */
  minimumPowerFraction: number;
  /**
   * Flash energy each line receives, relative to an ordinary pulse at the same power fraction. 1 for
   * front/rear-curtain sync; η·t_e/D for high-speed sync (see resolveHighSpeedFlashSync). Defaults to 1.
   */
  syncEnergyFactor?: number;
  /** Optional guide-number reporting. */
  guideNumber?: { fullPowerGuideNumberMetersIso100: number; iso: number; apertureFNumber: number };
}
```

## TTL_FLASH_MODEL

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
TTL_FLASH_MODEL = Object.freeze({ id: "preflash-linear-ttl", version: "1.0.0" } as const)
```

## TtlFlashExposure

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface TtlFlashExposure {
  modelId: typeof TTL_FLASH_MODEL.id;
  modelVersion: typeof TTL_FLASH_MODEL.version;
  status: "resolved" | "clamped-at-minimum-power" | "clamped-at-full-power" | "no-flash-return";
  /** Metered ambient signal in the main exposure: k·M(ambient). */
  ambientMainExposureMeteredSignal: number;
  /** Metered flash-only signal per unit full power: M(preflash − ambient)/p_pre. */
  flashMeteredSignalPerFullPower: number;
  /** T·2^FEC. */
  targetRelativeSignal: number;
  /** Unclamped solution (T' − k·A)/(F·syncEnergyFactor); null with no flash return. */
  requiredPowerFraction: number | null;
  /** Commanded main-flash power fraction (clamped); null with no flash return. */
  powerFraction: number | null;
  ambientAloneReachesTarget: boolean;
  predictedMeteredSignal: number;
  /** log2(predicted / target); 0 when the solution is within range; null when nothing is predicted. */
  predictedExposureErrorStops: number | null;
  effectiveGuideNumberMetersAtIso: number | null;
  flashRangeAtApertureM: number | null;
  preFlashInsideMainExposure: false;
  ambientMeteringModified: false;
}
```
