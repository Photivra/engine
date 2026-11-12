# optics/lateral-chromatic-aberration.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateInverseLateralChromaticAberrationMapping

Inverse-maps one distorted output point separately for the representative
red, green and blue channels.

Renderers can sample the returned per-channel ideal source points directly,
without writing their own chromatic-aberration equations.

```ts
export function calculateInverseLateralChromaticAberrationMapping(
  input: CalculateInverseLateralChromaticAberrationMappingInput
): CalculationResult<InverseLateralChromaticAberrationMapping>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateInverseLateralChromaticAberrationMappingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateInverseLateralChromaticAberrationMappingInput {
  /**
   * Distorted output image-plane point. Each channel is inverse-mapped on its
   * own to its ideal source point.
   */
  distortedImagePointMm: LensFieldPointMm;
  profile: LateralChromaticAberrationProfile;
}
```

## calculateInverseLateralChromaticAberrationMappings

Inverse-maps many distorted points at once. The shared CA profile is
resolved once, and each combined channel profile is validated once, for
the whole batch.

Each point's values match calculateInverseLateralChromaticAberrationMapping().
Provenance is reported once for the batch.

```ts
export function calculateInverseLateralChromaticAberrationMappings(
  input: CalculateInverseLateralChromaticAberrationMappingsInput
): CalculationResult<InverseLateralChromaticAberrationMappings>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateInverseLateralChromaticAberrationMappingsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateInverseLateralChromaticAberrationMappingsInput {
  /**
   * Distorted output image-plane points. The profile is resolved once for the
   * batch. Then each point is inverse-mapped separately for red, green and
   * blue.
   */
  distortedImagePointsMm: readonly LensFieldPointMm[];
  profile: LateralChromaticAberrationProfile;
}
```

## calculateLateralChromaticAberrationMapping

Calculates how far lateral chromatic aberration (CA) separates the colour
channels at one ideal image-plane point. The point goes through a shared
base distortion (green is the reference) plus extra radial coefficients for
red and blue.

This moves each channel; it is not a blur kernel.

```ts
export function calculateLateralChromaticAberrationMapping(
  input: CalculateLateralChromaticAberrationMappingInput
): CalculationResult<LateralChromaticAberrationMapping>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateLateralChromaticAberrationMappingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateLateralChromaticAberrationMappingInput {
  /** Ideal/undistorted image-plane point shared by all channels. */
  imagePointMm: LensFieldPointMm;
  profile: LateralChromaticAberrationProfile;
}
```

## ChannelSeparationVectorMm

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ChannelSeparationVectorMm {
  x: number;
  y: number;
  distance: number;
}
```

## InverseLateralChromaticAberrationChannelMapping

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface InverseLateralChromaticAberrationChannelMapping {
  sourceImagePointMm: LensFieldPointMm;
  radialScaleAtSource: number;
  combinedCoefficients: RadialDistortionCoefficients;
}
```

## InverseLateralChromaticAberrationMapping

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface InverseLateralChromaticAberrationMapping {
  direction: "distorted-output-to-channel-sources";
  referenceChannel: "green";
  distortedImagePointMm: LensFieldPointMm;
  channels: {
    red: InverseLateralChromaticAberrationChannelMapping;
    green: InverseLateralChromaticAberrationChannelMapping;
    blue: InverseLateralChromaticAberrationChannelMapping;
  };
  sourceSeparation: LateralChromaticAberrationSeparation;
}
```

## InverseLateralChromaticAberrationMappings

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface InverseLateralChromaticAberrationMappings {
  direction: "distorted-output-to-channel-sources-batch";
  referenceChannel: "green";
  mappings: readonly InverseLateralChromaticAberrationMapping[];
  pointCount: number;
}
```

## LateralChromaticAberrationChannel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type LateralChromaticAberrationChannel = "red" | "green" | "blue";
```

## LateralChromaticAberrationChannelMapping

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LateralChromaticAberrationChannelMapping {
  mappedImagePointMm: LensFieldPointMm;
  radialScale: number;
  combinedCoefficients: RadialDistortionCoefficients;
}
```

## LateralChromaticAberrationMapping

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LateralChromaticAberrationMapping {
  direction: "undistorted-to-channel-distorted";
  referenceChannel: "green";
  sourceImagePointMm: LensFieldPointMm;
  channels: {
    red: LateralChromaticAberrationChannelMapping;
    green: LateralChromaticAberrationChannelMapping;
    blue: LateralChromaticAberrationChannelMapping;
  };
  separation: LateralChromaticAberrationSeparation;
}
```

## LateralChromaticAberrationProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LateralChromaticAberrationProfile {
  /** Shared physical image-plane normalization radius in millimetres. */
  normalizationRadiusMm: number;
  /** Shared undistorted normalized-radius operating envelope. */
  maximumNormalizedRadius: number;
  /**
   * Green-reference base geometric distortion.
   *
   * Every channel includes this shared mapping. The red and blue CA terms are
   * added on top of it, so do not apply a second distortion pass.
   */
  baseDistortionCoefficients: RadialDistortionCoefficients;
  /** Additional red-channel radial coefficients relative to green. */
  redCoefficientOffset: RadialDistortionCoefficients;
  /** Additional blue-channel radial coefficients relative to green. */
  blueCoefficientOffset: RadialDistortionCoefficients;
}
```

## LateralChromaticAberrationSeparation

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LateralChromaticAberrationSeparation {
  redGreen: ChannelSeparationVectorMm;
  blueGreen: ChannelSeparationVectorMm;
  redBlue: ChannelSeparationVectorMm;
  maximumPairDistanceMm: number;
}
```
