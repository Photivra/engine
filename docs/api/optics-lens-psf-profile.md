# optics/lens-psf-profile.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## assessMtfOnlyPsfRenderability

Explains why MTF-only evidence cannot determine one unique renderable PSF. Returns blockers instead
of making up phase information.

A sampled lens PSF is tied to an exact generic optical state and to declared ranges of field
position, wavelength and signed defocus. Interpolation stays inside those declared ranges. It keeps
the normalized shape separate from the throughput. MTF (modulation transfer function) data alone
has no phase or spatial information, so it cannot justify rendering one unique PSF.

```ts
export function assessMtfOnlyPsfRenderability(
  profile:
    LensMtfDiagnosticProfile
): MtfOnlyPsfRenderabilityAssessment;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## LensMtfDiagnosticProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensMtfDiagnosticProfile {
  schemaVersion:
    typeof LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  opticalDomain:
    "lens-primary-optical-path-only";
  phaseInformationAvailable:
    false;
  magnitudeMeaning:
    "mtf-magnitude-only";
  fieldPointMm: {
    x: number;
    y: number;
  };
  focalLengthMm: number;
  focus: FocusPlane;
  apertureFNumber: number;
  wavelengthNm: number | null;
  samples:
    readonly LensMtfDiagnosticSample[];
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## LensMtfDiagnosticSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensMtfDiagnosticSample {
  spatialFrequencyCyclesPerMm:
    number;
  sagittalMagnitude: number;
  tangentialMagnitude: number;
}
```

## LensPsfGridAxes

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensPsfGridAxes {
  focalLengthMm:
    readonly number[];
  focusDiopters:
    readonly number[];
  apertureFNumber:
    readonly number[];
  fieldXmm:
    readonly number[];
  fieldYmm:
    readonly number[];
  wavelengthNm:
    readonly number[];
  signedDefocusImagePlaneMicrometers:
    readonly number[];
}
```

## LensPsfKernel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensPsfKernel {
  widthSamples: number;
  heightSamples: number;
  samplePitchMicrometersX: number;
  samplePitchMicrometersY: number;
  centerSampleX: number;
  centerSampleY: number;
  normalizedIntensity:
    readonly number[];
}
```

## LensPsfScientificStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type LensPsfScientificStatus =
  | "calibrated"
  | "approximation";
```

## LensPsfUncertainty

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type LensPsfUncertainty =
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

## LensSampledPsfGridCoordinate

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensSampledPsfGridCoordinate {
  focalLengthMm: number;
  focusDiopters: number;
  apertureFNumber: number;
  fieldXmm: number;
  fieldYmm: number;
  wavelengthNm: number;
  signedDefocusImagePlaneMicrometers:
    number;
}
```

## LensSampledPsfGridNode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensSampledPsfGridNode {
  nodeId: string;
  coordinate:
    LensSampledPsfGridCoordinate;
  kernel: LensPsfKernel;
  bestFocusImagePlaneOffsetMicrometers:
    number;
  relativePupilThroughputFactor:
    number;
  evidence:
    readonly EvidenceProvenance[];
  uncertainty:
    LensPsfUncertainty;
}
```

## LensSampledPsfInterpolation

Kernel interpolation between regular-grid nodes.
- `bounded-regular-grid-multilinear`: the legacy weighted sum of kernel values. Blending kernels
  whose peaks sit at different positions gives several peaks.
- `bounded-regular-grid-centroid-aligned`: each node kernel is first shifted so its intensity
  centroid sits at the weighted (interpolated) centroid. Then the same multilinear weights are
  applied. Shifted or asymmetric PSFs therefore blend into one peak at the interpolated position.
- `rotationally-symmetric-radial-field-centroid-aligned`: for a rotationally symmetric lens. Nodes
  are declared only along the +X field axis (fieldYmm = [0], fieldXmm >= 0). A query at field
  (x, y) is interpolated, with centroid alignment, at radius hypot(x, y). The kernel is then
  rotated by atan2(y, x) about its centre, with the kernel row index increasing with image +Y (the
  convention the environment PSF quadrature applies), so an asymmetric kernel points the same way
  as in the 2-D grid modes. The sample pitch must be square.
Shifts and rotations use bilinear resampling. This smooths the kernel slightly (by at most about
one sample). Samples outside the kernel are zero, and the result is renormalised to unit energy.

```ts
export type LensSampledPsfInterpolation =
  | "bounded-regular-grid-multilinear"
  | "bounded-regular-grid-centroid-aligned"
  | "rotationally-symmetric-radial-field-centroid-aligned";
```

## LensSampledPsfProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensSampledPsfProfile {
  schemaVersion:
    typeof LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus:
    LensPsfScientificStatus;
  opticalDomain:
    "lens-primary-optical-path-only";
  coordinateSystem:
    "image-plane-metric";
  fieldAxes:
    "+X right, +Y up";
  kernelEnergyNormalization:
    "unit-energy-shape";
  interpolation:
    LensSampledPsfInterpolation;
  throughputOwnership:
    "separate-relative-pupil-throughput-factor";
  responseIncludes: {
    diffraction: boolean;
    aberration: boolean;
    defocus: boolean;
    pupilClippingShape:
      boolean;
  };
  sensorOpticalStackIncluded:
    false;
  sensorSamplingIncluded:
    false;
  reconstructionIncluded:
    false;
  strayLightIncluded: false;
  axes: LensPsfGridAxes;
  nodes:
    readonly LensSampledPsfGridNode[];
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## MtfOnlyPsfRenderabilityAssessment

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface MtfOnlyPsfRenderabilityAssessment {
  profileId: string;
  psfReconstructionAuthorized:
    false;
  reason:
    "mtf-magnitude-lacks-phase-and-does-not-uniquely-determine-psf";
  diagnosticUseAuthorized: true;
}
```

## parseLensMtfDiagnosticProfile

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

A sampled lens PSF is tied to an exact generic optical state and to declared ranges of field
position, wavelength and signed defocus. Interpolation stays inside those declared ranges. It keeps
the normalized shape separate from the throughput. MTF (modulation transfer function) data alone
has no phase or spatial information, so it cannot justify rendering one unique PSF.

```ts
export function parseLensMtfDiagnosticProfile(
  value: unknown
): LensMtfDiagnosticProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseLensSampledPsfProfile

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

A sampled lens PSF is tied to an exact generic optical state and to declared ranges of field
position, wavelength and signed defocus. Interpolation stays inside those declared ranges. It keeps
the normalized shape separate from the throughput. MTF (modulation transfer function) data alone
has no phase or spatial information, so it cannot justify rendering one unique PSF.

```ts
export function parseLensSampledPsfProfile(
  value: unknown
): LensSampledPsfProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedLensSampledPsf

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedLensSampledPsf {
  profileId: string;
  profileVersion: string;
  scientificStatus:
    LensPsfScientificStatus;
  resolutionStatus:
    | "exact-grid-sample"
    | "interpolated";
  coordinate:
    LensSampledPsfGridCoordinate;
  focus: FocusPlane;
  kernel: LensPsfKernel;
  bestFocusImagePlaneOffsetMicrometers:
    number;
  relativePupilThroughputFactor:
    number;
  sourceNodes:
    readonly {
      nodeId: string;
      weight: number;
      evidence:
        readonly EvidenceProvenance[];
      uncertainty:
        LensPsfUncertainty;
    }[];
  responseIncludes:
    LensSampledPsfProfile["responseIncludes"];
  throughputOwnership:
    "separate-relative-pupil-throughput-factor";
  longitudinalChromaticFocusMayVaryWithWavelength:
    true;
  fieldCurvatureMayVaryWithFieldPosition:
    true;
  geometricDistortionModified:
    false;
  lateralChromaticPositionShiftApplied:
    false;
  sensorOpticalStackIncluded:
    false;
  sensorSamplingIncluded: false;
  reconstructionIncluded: false;
  strayLightIncluded: false;
  scalarSharpnessScoreProduced:
    false;
}
```

## resolveLensSampledPsf

Resolves the sampled PSF for a declared optical state and query point. It never extrapolates and
never invents missing dimensions.

A sampled lens PSF is tied to an exact generic optical state and to declared ranges of field
position, wavelength and signed defocus. Interpolation stays inside those declared ranges. It keeps
the normalized shape separate from the throughput. MTF (modulation transfer function) data alone
has no phase or spatial information, so it cannot justify rendering one unique PSF.

```ts
export function resolveLensSampledPsf(
  input:
    ResolveLensSampledPsfInput
): CalculationResult<ResolvedLensSampledPsf>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveLensSampledPsfInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveLensSampledPsfInput {
  profile:
    LensSampledPsfProfile;
  focalLengthMm: number;
  focus: FocusPlane;
  apertureFNumber: number;
  fieldPointMm: {
    x: number;
    y: number;
  };
  wavelengthNm: number;
  signedDefocusImagePlaneMicrometers:
    number;
}
```
