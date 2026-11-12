# exposure/metering.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateHighlightPriorityPlacementSignal

Relative signal at which a highlight-priority profile places its highlight
percentile: `saturationRelativeSignal * 2^-headroomStops`.

```ts
export function calculateHighlightPriorityPlacementSignal(
  saturationRelativeSignal: number,
  headroomStops: number
): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EXPOSURE_METERING_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
EXPOSURE_METERING_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## ExposureMeteringPolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureMeteringPolicy =
  | {
      kind: "multi-zone-uniform";
    }
  | {
      kind: "center-weighted-radial";
      edgeWeight: number;
      exponent: number;
    }
  | {
      kind: "spot";
      centerOrientedCaptureUv:
        NormalizedRasterUv;
      radiusFractionOfCaptureDiagonal:
        number;
    }
  | {
      /**
       * Weighted average that emphasises highlights (unchanged since 1.x).
       * Brighter samples get the weight `minimumWeightFraction + (1 -
       * minimumWeightFraction) * (signal / maximum)^exponent`. The weighted mean
       * is then placed at the profile target.
       *
       * This is NOT highlight protection. No sample is placed relative to
       * saturation. In a mostly mid-grey scene with a small bright area, it
       * underexposes the mid-tones compared with uniform metering, yet does not
       * guarantee headroom. Use `highlight-priority` to keep highlights below
       * saturation.
       */
      kind: "highlight-weighted";
      minimumWeightFraction: number;
      exponent: number;
    }
  | {
      /**
       * Highlight-priority placement. The area-weighted `highlightPercentile`
       * quantile of the relative pre-exposure signal is placed `headroomStops`
       * below `saturationRelativeSignal`. The profile target must state that
       * placement exactly: `targetRelativeSignal = saturationRelativeSignal *
       * 2^-headroomStops` (see {@link calculateHighlightPriorityPlacementSignal}).
       */
      kind: "highlight-priority";
      /** Area-weighted quantile in (0, 1]; 1 places the brightest sample. */
      highlightPercentile: number;
      /** Relative pre-exposure signal at which the declared output saturates. */
      saturationRelativeSignal: number;
      /** Non-negative headroom in stops between the placed highlight and saturation. */
      headroomStops: number;
    };
```

## ExposureMeteringProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExposureMeteringProfile {
  schemaVersion:
    typeof EXPOSURE_METERING_PROFILE_SCHEMA_VERSION;
  profileId: string;
  scientificStatus: "approximation";
  inputDomain:
    "relative-pre-exposure-linear-signal";
  captureRegion:
    "oriented-active-capture";
  policy: ExposureMeteringPolicy;
  target: {
    kind: "relative-signal-reference";
    targetRelativeSignal: number;
    evidence: readonly EvidenceProvenance[];
  };
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## ExposureMeteringResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureMeteringResult =
  | (ExposureMeteringResultBase & {
      status: "resolved";
      requiredExposureScaleToTarget:
        number;
      exposureOffsetStopsToTarget:
        number;
    })
  | (ExposureMeteringResultBase & {
      status: "no-signal";
      requiredExposureScaleResolved:
        false;
      exposureOffsetStopsResolved:
        false;
    });
```

## ExposureMeteringSampleSet

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExposureMeteringSampleSet {
  measurementId: string;
  sceneStateId: string;
  inputDomain:
    "relative-pre-exposure-linear-signal";
  captureRegion:
    "oriented-active-capture";
  captureGeometry:
    ResolvedCaptureGeometry;
  processingState: {
    exposureSettingsApplied: false;
    whiteBalanceApplied: false;
    toneMappingApplied: false;
    displayGammaApplied: false;
    sharpeningApplied: false;
  };
  samples:
    readonly ExposureMeteringZoneSample[];
}
```

## ExposureMeteringZoneSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExposureMeteringZoneSample {
  sampleId: string;
  positionOrientedCaptureUv:
    NormalizedRasterUv;
  relativeLinearSignal: number;
  areaWeight: number;
}
```

## HighlightPriorityMeteringDiagnostics

Diagnostics reported only for the highlight-priority policy.

```ts
export interface HighlightPriorityMeteringDiagnostics {
  highlightPercentile: number;
  /** Lower area-weighted quantile (inverse empirical CDF) of the samples. */
  percentileRelativeSignal: number;
  saturationRelativeSignal: number;
  headroomStops: number;
  placementRelativeSignal: number;
  quantileDefinition:
    "area-weighted-lower-quantile-inverse-empirical-cdf";
}
```

## meterRelativeExposure

Meters relative pre-exposure linear signal over the actual active capture
frame, in its capture orientation.

This first contract is an educational, relative approximation. It
deliberately ignores the final output crop, display and tone mapping,
exposure compensation and the choice of automatic exposure settings.

```ts
export function meterRelativeExposure(
  input:
    MeterRelativeExposureInput
): CalculationResult<ExposureMeteringResult>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## MeterRelativeExposureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface MeterRelativeExposureInput {
  profile: ExposureMeteringProfile;
  sampleSet: ExposureMeteringSampleSet;
}
```

## parseExposureMeteringProfile

Parses one generic relative exposure-metering profile.

Schema 0.1.0 is an approximation only. It works on relative linear signal
measured before the exposure. It deliberately does not claim luminance,
spectral radiance, sensor-plane irradiance or any manufacturer's meter
calibration.

```ts
export function parseExposureMeteringProfile(
  value: unknown
): ExposureMeteringProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
