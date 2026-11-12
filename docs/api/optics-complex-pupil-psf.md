# optics/complex-pupil-psf.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateLensComplexPupilPsf

Evaluates a declared complex pupil with explicit amplitude, phase and sampling support. Returns the
normalized PSF shape, and the pupil throughput as a separate quantity.

The complex pupil is evaluated by summing the declared amplitude and phase over a bounded, regular
pupil grid. The PSF shape is normalized separately from the pupil throughput. A single blur radius
cannot stand in for coherent phase, pupil energy, or the wavelength and field range where the
profile applies. Numeric profiles need provenance showing the data is owned or reusable.

```ts
export function calculateLensComplexPupilPsf(
  input:
    CalculateLensComplexPupilPsfInput
): CalculationResult<LensComplexPupilPsf>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateLensComplexPupilPsfInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateLensComplexPupilPsfInput {
  profile:
    LensComplexPupilProfile;
  /** Physical propagation distance from pupil to image, in mm. If omitted, the
   * nominal focal-plane reference is used. At finite focus the caller must
   * resolve the supported principal-plane geometry; profile metadata does not. */
  propagationDistanceMm?: number;
}
```

## LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## LensComplexPupilGrid

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensComplexPupilGrid {
  widthSamples: number;
  heightSamples: number;
  pupilSamplePitchMmX: number;
  pupilSamplePitchMmY: number;
  centerSampleX: number;
  centerSampleY: number;
  relativeAmplitude:
    readonly number[];
  opticalPathDifferenceMicrometers:
    readonly number[];
}
```

## LensComplexPupilProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensComplexPupilProfile {
  schemaVersion:
    typeof LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus:
    LensPsfScientificStatus;
  opticalDomain:
    "lens-primary-optical-path-only";
  representation:
    "complex-pupil-amplitude-plus-opd";
  pupilCoordinateSystem:
    "pupil-plane-metric-aligned-to-image-plane";
  imageFieldAxes:
    "+X right, +Y up";
  amplitudeMeaning:
    "relative-complex-pupil-amplitude-shape";
  wavefrontMeaning:
    "optical-path-difference-micrometers";
  throughputOwnership:
    "separate-relative-pupil-throughput-factor";
  kernelEnergyNormalization:
    "unit-energy-shape";
  propagationModel:
    "scalar-fraunhofer-discrete-reference";
  context: {
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
  };
  responseIncludes: {
    diffraction: true;
    aberration: boolean;
    defocus: boolean;
    pupilClippingShape:
      boolean;
  };
  relativePupilThroughputFactor:
    number;
  grid: LensComplexPupilGrid;
  sensorOpticalStackIncluded:
    false;
  sensorSamplingIncluded:
    false;
  reconstructionIncluded:
    false;
  strayLightIncluded: false;
  evidence:
    readonly EvidenceProvenance[];
  uncertainty:
    LensPsfUncertainty;
  limitations: readonly string[];
}
```

## LensComplexPupilPsf

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensComplexPupilPsf {
  propagationDistanceMm: number;
  propagationDistanceSource: "explicit" | "nominal-focal-plane-reference";
  profileId: string;
  profileVersion: string;
  scientificStatus:
    LensPsfScientificStatus;
  context:
    LensComplexPupilProfile["context"];
  kernel: LensPsfKernel;
  /** Nyquist sampling diagnostics and the applied zero padding. */
  sampling: LensComplexPupilPsfSampling;
  relativePupilThroughputFactor:
    number;
  throughputOwnership:
    "separate-relative-pupil-throughput-factor";
  diffractionAndAberrationJointlyEvaluated:
    true;
  pupilClippingShapeIncluded:
    boolean;
  pupilClippingThroughputAppliedToKernel:
    false;
  scalarFraunhoferReference:
    true;
  full2dOrientationPreserved:
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
  componentEvidence: {
    pupilProfile:
      readonly EvidenceProvenance[];
  };
  uncertainty:
    LensPsfUncertainty;
}
```

## LensComplexPupilPsfSampling

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensComplexPupilPsfSampling {
  criterion: "discrete-intensity-alias-free-goodman-q-above-2";
  /** Number of pupil samples spanned by non-zero amplitude, per axis. */
  pupilSupportSamplesX: number;
  pupilSupportSamplesY: number;
  /**
   * Sampled pupil diameter D = (support samples - 1) x pupil pitch: the
   * centre-to-centre span of the outermost non-zero samples, in millimetres.
   */
  pupilSupportDiameterMmX: number;
  pupilSupportDiameterMmY: number;
  /**
   * Widest support allowed by the declared f-number at the resolved propagation distance:
   * propagationDistanceMm / apertureFNumber, in millimetres. For the nominal focal-plane reference
   * this is focalLengthMm / apertureFNumber.
   */
  declaredPupilDiameterMm: number;
  /** Declared pupil grid size before zero padding. */
  pupilGridWidthSamples: number;
  pupilGridHeightSamples: number;
  /** DFT size after zero padding; equals the output kernel size. */
  transformWidthSamples: number;
  transformHeightSamples: number;
  zeroPaddingApplied: boolean;
  /**
   * Achieved Goodman sampling factor Q = lambda*(z/D)/imagePitch =
   * transform samples / (support samples - 1). Always greater than 2. Null
   * when the support is a single sample on that axis (no finite diameter).
   */
  samplingFactorQX: number | null;
  samplingFactorQY: number | null;
}
```

## parseLensComplexPupilProfile

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

The complex pupil is evaluated by summing the declared amplitude and phase over a bounded, regular
pupil grid. The PSF shape is normalized separately from the pupil throughput. A single blur radius
cannot stand in for coherent phase, pupil energy, or the wavelength and field range where the
profile applies. Numeric profiles need provenance showing the data is owned or reusable.

```ts
export function parseLensComplexPupilProfile(
  value: unknown
): LensComplexPupilProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
