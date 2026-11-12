# sensor/spectral-response.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## EffectiveSensorResponseScope

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type EffectiveSensorResponseScope =
  | "site-incident-effective-channel-response"
  | "sensor-package-incident-effective-channel-response";
```

## parseSensorSpectralResponseProfile

Parses wavelength-dependent response data for sensor channels. Responses are
never guessed from channel names or the CFA type.

An embedded multi-point curve needs evidence that the data is reusable or
owned by Photivra. A public reference without reuse permission can support
metadata, but does not by itself allow copying numeric curve data into the engine.

```ts
export function parseSensorSpectralResponseProfile(
  value: unknown
): SensorSpectralResponseProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedSensorSpectralResponse

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedSensorSpectralResponse {
  profileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  sourceResponseKind:
    SensorSpectralChannelResponse["kind"];
  responseScope:
    SensorSpectralChannelResponse["responseScope"];
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  wavelengthNanometers: number;
  wavelengthBasis: SpectralWavelengthBasis;
  wavelengthBasisResolved: boolean;
  declaredWavelengthRangeNanometers: {
    minimum: number;
    maximum: number;
  };
  interpolation:
    "piecewise-linear";
  interpolationUsed: boolean;
  outsideRangeBehavior:
    "fail-closed";
  response:
    ResolvedSensorSpectralResponseValue;
  referenceConditions?:
    SensorSpectralReferenceConditions;
  conditionDependenceModeled: false;
  fieldAngleDependenceModeled: false;
  temperatureDependenceModeled: false;
  polarizationDependenceModeled: false;
  spectralIrradianceIntegrated: false;
  wavelengthIntegrationPerformed: false;
  qeResponsivityConversionPerformed: false;
  photonsCalculated: false;
  electronsCalculated: false;
  rawCodeValueProduced: false;
  componentEvidence: {
    profile: readonly EvidenceProvenance[];
    channel: readonly EvidenceProvenance[];
    curves:
      readonly (readonly EvidenceProvenance[])[];
  };
}
```

## ResolvedSensorSpectralResponseValue

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ResolvedSensorSpectralResponseValue =
  | {
      kind:
        "effective-external-quantum-efficiency";
      externalQuantumEfficiency: number;
      composition:
        | "direct-effective-response"
        | "channel-filter-transmittance-times-detector-eqe";
      channelFilterTransmittance?: number;
      detectorExternalQuantumEfficiency?: number;
    }
  | {
      kind:
        "effective-spectral-responsivity";
      amperesPerWatt: number;
      composition:
        "direct-effective-response";
    };
```

## resolveSensorSpectralResponseAtWavelength

Public spectral-response lookup for untrusted, unparsed profiles.

The profiles are parsed here, once. Internal code that has already parsed
both profiles can call resolveParsedSensorSpectralResponseAtWavelength, to
avoid parsing them again for every wavelength node.

```ts
export function resolveSensorSpectralResponseAtWavelength(
  input:
    ResolveSensorSpectralResponseAtWavelengthInput
): CalculationResult<ResolvedSensorSpectralResponse>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveSensorSpectralResponseAtWavelengthInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveSensorSpectralResponseAtWavelengthInput {
  colorSamplingProfile:
    SensorColorSamplingProfile;
  spectralResponseProfile:
    SensorSpectralResponseProfile;
  channelId: string;
  wavelengthNanometers: number;
  wavelengthBasis: SpectralWavelengthBasis;
}
```

## SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT

Current channel-binding format. v2 (package 2.0.0) serializes the parsed channel with sorted keys.
v1 (package 1.5.0 and earlier) used the unparsed channel's JSON in insertion order; it is rejected
with an explicit version error instead of being compared.

```ts
SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT =
  "photivra-spectral-channel-response-canonical-json-v2" as const
```

## SensorSpectralChannelResponse

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorSpectralChannelResponse =
  | (SensorSpectralChannelResponseBase & {
      kind:
        "effective-external-quantum-efficiency";
      responseScope:
        EffectiveSensorResponseScope;
      externalQuantumEfficiency:
        SpectralFractionCurve;
    })
  | (SensorSpectralChannelResponseBase & {
      kind:
        "effective-spectral-responsivity";
      responseScope:
        EffectiveSensorResponseScope;
      spectralResponsivity:
        SpectralResponsivityCurve;
    })
  | (SensorSpectralChannelResponseBase & {
      kind:
        "separable-channel-filter-and-detector-eqe";
      responseScope:
        "site-incident-channel-filter-times-detector-eqe";
      combinationRule: "multiply";
      channelFilterTransmittance:
        SpectralFractionCurve;
      detectorExternalQuantumEfficiency:
        SpectralFractionCurve;
    });
```

## SensorSpectralReferenceConditions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpectralReferenceConditions {
  temperatureC?: number;
  incidenceAngleDegreesFromNormal?: number;
  polarization?:
    | "unpolarized"
    | "unspecified";
}
```

## SensorSpectralResponseChannelBinding

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpectralResponseChannelBinding {
  format:
    typeof SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT;
  canonicalJson: string;
}
```

## SensorSpectralResponseProfile

Versioned response data for the channels of one exact colour-sampling profile.
Each channel declares an effective EQE, an effective A/W response, or separate
filter and detector EQE curves, with its sampled range, interpolation and an
explicit wavelength basis (air or vacuum). Reference conditions, evidence and
uncertainty each keep their own validity. Names such as red, green or blue
never fill in a missing curve or justify extrapolation.

```ts
export interface SensorSpectralResponseProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  colorSamplingProfileId: string;
  evidence: readonly EvidenceProvenance[];
  channels:
    readonly SensorSpectralChannelResponse[];
}
```

## SensorSpectralResponseScientificStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorSpectralResponseScientificStatus =
  | "calibrated"
  | "approximation";
```

## SensorSpectralResponseUncertainty

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorSpectralResponseUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };
```

## SpectralFractionCurve

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SpectralFractionCurve
  extends SpectralCurveBase {
  samples: readonly SpectralFractionSample[];
}
```

## SpectralFractionSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SpectralFractionSample
  extends SpectralWavelengthSample {
  value: number;
}
```

## SpectralResponsivityCurve

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SpectralResponsivityCurve
  extends SpectralCurveBase {
  samples: readonly SpectralResponsivitySample[];
}
```

## SpectralResponsivitySample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SpectralResponsivitySample
  extends SpectralWavelengthSample {
  amperesPerWatt: number;
}
```
