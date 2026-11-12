# sensor/raw-reconstruction.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## BUILT_IN_BAYER_DEMOSAIC_MODEL_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
BUILT_IN_BAYER_DEMOSAIC_MODEL_VERSION = "1.0.0" as const
```

## BuiltInBayerDemosaicKernel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type BuiltInBayerDemosaicKernel = "bilinear";
```

## BuiltInBayerDemosaicProfiles

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BuiltInBayerDemosaicProfiles {
  kernel: BuiltInBayerDemosaicKernel;
  /** One profile per absolute CFA phase, row-major (`phaseY`, then `phaseX`). */
  phaseProfiles: { phaseX: number; phaseY: number; profile: SensorRawReconstructionProfile }[];
  outputChannelIds: [string, string, string];
  /** Largest |offset| of any contribution: 1 for bilinear. */
  kernelReachSites: number;
}
```

## createBuiltInBayerDemosaicProfiles

Builds the per-phase linear reconstruction profiles of the built-in bilinear Bayer demosaic kernel.

The result is the ordinary `explicit-linear-native-neighborhood` profile used by RAW frame
reconstruction, native RAW development and `createCfaPlaneReconstructionTask`; there is no special
code path. Edge pixels need either a region whose neighbourhood stays inside the frame, or mirror
border handling.

Approximation: fixed linear interpolation, not a calibrated or adaptive demosaic. Bilinear blurs
and shows "zipper" artefacts at edges. Aliasing and moiré are not modelled. The adaptive AHD method
is `createAhdDemosaicTask`.

```ts
export function createBuiltInBayerDemosaicProfiles(input: CreateBuiltInBayerDemosaicProfilesInput): CalculationResult<BuiltInBayerDemosaicProfiles>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateBuiltInBayerDemosaicProfilesInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateBuiltInBayerDemosaicProfilesInput {
  kernel: BuiltInBayerDemosaicKernel;
  /** Capture mode the RAW frame belongs to; copied into every phase profile. */
  captureModeId: string;
  /** Must be a 2×2 periodic Bayer mosaic: one red, one blue and two diagonal green sites. */
  colorSamplingProfile: SensorColorSamplingProfile;
  /** CFA channel IDs for the red, green and blue roles. This is also the output channel order. */
  channelRoles: { red: string; green: string; blue: string };
}
```

## createSensorRawCaptureSample

Commits one validated native RAW sample, with its exact site, channel and exposure event, for use
in reconstruction.

```ts
export function createSensorRawCaptureSample(
  input:
    CreateSensorRawCaptureSampleInput
): SensorRawCaptureSample;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateSensorRawCaptureSampleInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateSensorRawCaptureSampleInput {
  rawCode:
    SensorRawCodeSample;
  contributors:
    ResolvedCaptureModeColorSamplingContributors;
  /**
   * The selected readout regime's declared ADC integral non-linearity (INL), if any. The code sample
   * records INL only at its own code, but the effective white level needs it at saturation.
   */
  adcIntegralNonLinearity?:
    SensorAdcIntegralNonLinearity;
}
```

## parseSensorRawReconstructionProfile

Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
missing required fields and inconsistent scientific data are rejected.

The profile declares a normalized linear kernel for each output channel. It does not infer the
sensor's spectral primaries or calibrated colour.

```ts
export function parseSensorRawReconstructionProfile(
  value: unknown
): SensorRawReconstructionProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## RawReconstructionBorderHandling

How a reconstruction neighbourhood that leaves the native frame is handled.

```ts
export type RawReconstructionBorderHandling = "reject" | "mirror";
```

## resolveSensorRawReconstruction

Combines the supplied native samples through explicit normalized kernels, keeping CFA identity
and signed black-subtracted values.

The CFA phase is absolute; orientation and crop come later. This fixed linear reconstruction does
not infer spectral primaries or calibrated colour, and is not a general demosaic algorithm.

```ts
export function resolveSensorRawReconstruction(
  input:
    ResolveSensorRawReconstructionInput
): CalculationResult<SensorRawReconstructedPixel>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveSensorRawReconstructionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveSensorRawReconstructionInput {
  profile:
    SensorRawReconstructionProfile;
  colorSamplingProfile:
    SensorColorSamplingProfile;
  centerSite: {
    x: number;
    y: number;
  };
  samples:
    readonly SensorRawCaptureSample[];
}
```

## SENSOR_RAW_CAPTURE_SAMPLE_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SENSOR_RAW_CAPTURE_SAMPLE_VERSION =
  "0.1.0" as const
```

## SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## SensorRawCaptureSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorRawCaptureSample {
  version:
    typeof SENSOR_RAW_CAPTURE_SAMPLE_VERSION;
  captureModeId: string;
  modeSampleCoordinateSystem:
    "capture-mode-full-frame-effective-sample-index";
  modeSampleIndexFullFrame: {
    x: number;
    y: number;
  };
  colorSamplingProfileId: string;
  colorSamplingSite: {
    x: number;
    y: number;
  };
  channelId: string;
  rawCode: number;
  blackLevelCode: number;
  digitalSaturationCode: number;
  blackSubtractedNormalizedCode:
    number;
  /** Full-saturation code from `calculateEffectiveSaturationCode`; constant per CFA phase. */
  effectiveSaturationCode: number;
  /** Regime system conversion gain, e⁻ per code (DNG NoiseProfile input). */
  systemConversionGainElectronsPerCode: number;
  /** Total read noise in e⁻: the square root of the sum of the squared RMS components (DNG NoiseProfile input). */
  readNoiseRmsElectrons: number;
  readoutProfileId: string;
  readoutRegimeId: string;
  sourceChargeSeedUint32: number;
  sourceReadNoiseSeedUint32: number;
  physicalScalarSaturationApplied:
    boolean;
  digitalSaturationApplied:
    boolean;
  cfaPhasePreservedInNativeCoordinates:
    true;
  physicalOrientationApplied:
    false;
  outputRotationApplied:
    false;
  groupedModeCombinationApplied:
    false;
  reconstructionApplied: false;
  aliasingModeled: false;
  moireModeled: false;
}
```

## SensorRawReconstructedPixel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorRawReconstructedPixel {
  reconstructionProfileId:
    string;
  reconstructionProfileVersion:
    string;
  captureModeId: string;
  colorSamplingProfileId: string;
  centerSite: {
    x: number;
    y: number;
  };
  outputChannels:
    readonly {
      channelId: string;
      linearBlackSubtractedNormalizedValue:
        number;
      sourceContributions:
        readonly {
          site: {
            x: number;
            y: number;
          };
          sourceChannelId: string;
          weight: number;
          sourceValue: number;
        }[];
    }[];
  method:
    "explicit-linear-native-neighborhood";
  cfaAware: true;
  captureModeAware: true;
  physicalOrientationApplied:
    false;
  outputRotationApplied: false;
  sharpeningApplied: false;
  denoisingApplied: false;
  aliasingModeled: false;
  moireModeled: false;
  preSamplingOpticalTransferAdequacyEstablished:
    false;
  reconstructionDoesNotModifyRawSamples:
    true;
}
```

## SensorRawReconstructionChannelKernel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorRawReconstructionChannelKernel {
  outputChannelId: string;
  contributions:
    readonly SensorRawReconstructionKernelContribution[];
}
```

## SensorRawReconstructionKernelContribution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorRawReconstructionKernelContribution {
  offsetX: number;
  offsetY: number;
  sourceChannelId: string;
  weight: number;
}
```

## SensorRawReconstructionProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorRawReconstructionProfile {
  schemaVersion:
    typeof SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  captureModeId: string;
  colorSamplingProfileId: string;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  method:
    "explicit-linear-native-neighborhood";
  normalization:
    "weights-sum-to-one-per-output-channel";
  negativeBlackSubtractedValuesAllowed:
    true;
  kernels:
    readonly SensorRawReconstructionChannelKernel[];
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```
