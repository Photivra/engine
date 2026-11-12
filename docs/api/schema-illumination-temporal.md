# schema/illumination-temporal.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## evaluateSceneIlluminationTemporalMultiplier

Returns one registered source's time-varying multiplier at one capture time.

Capture time is in seconds from the first opening boundary of the exposure. Sensor
readout timing is never used in place of capture time.

```ts
export function evaluateSceneIlluminationTemporalMultiplier(
  input:
    EvaluateSceneIlluminationTemporalMultiplierInput
): SceneIlluminationTemporalMultiplierEvaluation;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EvaluateSceneIlluminationTemporalMultiplierInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EvaluateSceneIlluminationTemporalMultiplierInput {
  illuminationProfile:
    SceneIlluminationProfile;
  temporalProfile:
    SceneIlluminationTemporalProfile;
  sourceId: string;
  captureTimeSecondsFromReference: number;
}
```

## IntegrateSceneIlluminationTemporalMultiplierInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IntegrateSceneIlluminationTemporalMultiplierInput {
  illuminationProfile:
    SceneIlluminationProfile;
  temporalProfile:
    SceneIlluminationTemporalProfile;
  sourceId: string;
  exposureWindows: CaptureExposureWindows;
  sampleIndex: number;
  temporalSampleCount: number;
}
```

## integrateSceneIlluminationTemporalMultiplierOverExposureWindow

Integrates one source's time-varying multiplier over one local exposure window
(from sensor/exposure-window), using the deterministic midpoint rule.

It integrates only the relative modulation over time. It does not apply source
magnitude, scene light transport, optics, sensor response or metering policy.

```ts
export function integrateSceneIlluminationTemporalMultiplierOverExposureWindow(
  input:
    IntegrateSceneIlluminationTemporalMultiplierInput
): SceneIlluminationTemporalExposureIntegration;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSceneIlluminationTemporalProfile

Parses a time-varying illumination profile that sits on top of one existing
illumination profile.

The base source magnitude and spectrum still apply. Each binding multiplies one
source by one relative waveform over time. Sources with no binding stay constant.

```ts
export function parseSceneIlluminationTemporalProfile(
  value: unknown
): SceneIlluminationTemporalProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## SceneIlluminationTemporalExposureIntegration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationTemporalExposureIntegration {
  sourceId: string;
  sourceEnabled: boolean;
  temporalProfileId: string;
  bindingId: string;
  waveformId: string;
  timeReference:
    "first-opening-boundary-phase";
  localExposureWindow: {
    startSecondsFromCaptureReference: number;
    endSecondsFromCaptureReference: number;
    durationSeconds: number;
  };
  quadratureScheme: "uniform-midpoint";
  temporalSampleCount: number;
  nodes:
    readonly SceneIlluminationTemporalIntegrationNode[];
  averageRelativeMagnitudeMultiplier:
    number;
  integratedRelativeMagnitudeSeconds:
    number;
  averageEffectiveRelativeMagnitudeMultiplier:
    number;
  integratedEffectiveRelativeMagnitudeSeconds:
    number;
  sourceMagnitudeApplied: false;
  materialTransportApplied: false;
  sceneRadianceCalculated: false;
  sensorReadoutTimingUsed: false;
  automaticExposureResolved: false;
  convergenceErrorEstimated: false;
}
```

## SceneIlluminationTemporalIntegrationNode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationTemporalIntegrationNode {
  temporalSampleIndex: number;
  localExposurePhase: number;
  captureTimeSecondsFromReference: number;
  waveformTimeSecondsFromWaveformReference:
    number;
  relativeMagnitudeMultiplier: number;
  effectiveRelativeMagnitudeMultiplier:
    number;
  normalizedTimeWeight: number;
  timeMeasureSeconds: number;
}
```

## SceneIlluminationTemporalMultiplierEvaluation

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationTemporalMultiplierEvaluation {
  sourceId: string;
  sourceEnabled: boolean;
  temporalProfileId: string;
  bindingId: string;
  waveformId: string;
  captureTimeReference:
    "first-opening-boundary-phase";
  captureTimeSecondsFromReference: number;
  waveformTimeSecondsFromWaveformReference:
    number;
  waveformKind:
    SceneIlluminationTemporalWaveform["kind"];
  relativeMagnitudeMultiplier: number;
  effectiveRelativeMagnitudeMultiplier:
    number;
  sourceMagnitudeApplied: false;
  materialTransportApplied: false;
  sceneRadianceCalculated: false;
  sensorReadoutTimingUsed: false;
  automaticExposureResolved: false;
}
```

## SceneIlluminationTemporalProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationTemporalProfile {
  schemaVersion:
    typeof SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION;
  profileId: string;
  sceneId: string;
  illuminationProfileId: string;
  evidence: readonly EvidenceProvenance[];
  waveforms:
    readonly SceneIlluminationTemporalWaveform[];
  sourceBindings:
    readonly SceneIlluminationTemporalSourceBinding[];
  baseIlluminationProfileRemainsAuthoritative:
    true;
  sensorReadoutTimingUsedAsExposureTiming:
    false;
  automaticExposurePolicyIncluded: false;
}
```

## SceneIlluminationTemporalRegistrationUncertainty

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneIlluminationTemporalRegistrationUncertainty =
  | {
      kind: "absolute-seconds";
      plusMinusSeconds: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };
```

## SceneIlluminationTemporalScientificStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneIlluminationTemporalScientificStatus =
  | "calibrated"
  | "approximation";
```

## SceneIlluminationTemporalSourceBinding

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationTemporalSourceBinding {
  bindingId: string;
  sourceId: string;
  waveformId: string;
  captureTimeReference:
    "first-opening-boundary-phase";
  /**
   * The capture time at which the waveform's own t=0 falls.
   *
   * waveformTime = captureTime - waveformTimeZeroSecondsFromCaptureReference
   */
  waveformTimeZeroSecondsFromCaptureReference:
    number;
  scientificStatus:
    SceneIlluminationTemporalScientificStatus;
  timingUncertainty:
    SceneIlluminationTemporalRegistrationUncertainty;
  evidence: readonly EvidenceProvenance[];
}
```

## SceneIlluminationTemporalWaveform

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SceneIlluminationTemporalWaveform =
  | (SceneIlluminationTemporalWaveformBase & {
      kind:
        "aperiodic-relative-multiplier";
      outsideSupportBehavior: "zero";
    })
  | (SceneIlluminationTemporalWaveformBase & {
      kind:
        "periodic-relative-multiplier";
      periodSeconds: number;
      endpointContinuityRequired: true;
    });
```

## SceneIlluminationTemporalWaveformSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SceneIlluminationTemporalWaveformSample {
  timeSecondsFromWaveformReference: number;
  relativeMagnitudeMultiplier: number;
}
```
