# optics/psf-foundation.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculatePsfFoundationComponents

Evaluates today's PSF-related diagnostics in one explicit context (field
position, depth, wavelength and pupil). It does not combine them into a
synthetic PSF or blur radius.

The field position is recorded even though the current defocus-circle and
circular-Airy diagnostics do not depend on it. Future field-dependent
contributions can use the same context without changing these primitives.

```ts
export function calculatePsfFoundationComponents(
  input: CalculatePsfFoundationComponentsInput
): CalculationResult<PsfFoundationComponents>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculatePsfFoundationComponentsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculatePsfFoundationComponentsInput {
  focalLengthMm: number;
  aperture: number;
  focusDistanceM: number;
  subjectDistanceM: number;
  /**
   * Image-plane field position relative to the optical axis, in millimetres.
   * +X is right and +Y is up.
   */
  fieldPointMm: LensFieldPointMm;
  /**
   * Physical image-plane radius. It is used only to normalize the field
   * position so diagnostics can be compared across cases. It is not a lens
   * calibration or a validity limit.
   */
  fieldNormalizationRadiusMm: number;
  spectralBasis: {
    kind: "monochromatic";
    wavelengthNm: number;
  };
}
```

## getPsfFoundationContract

Returns the public PSF/pupil foundation contract.

The contract lists today's diagnostics and reserves names for future
contributions. A reserved contribution is not implemented.

```ts
export function getPsfFoundationContract(): PsfFoundationContract;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PSF_FOUNDATION_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PSF_FOUNDATION_VERSION = "0.3.0" as const
```

## PsfContributionContract

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PsfContributionContract {
  id: PsfContributionId;
  status: PsfContributionStatus;
  dependsOn: readonly (
    | "field-position"
    | "focus-depth"
    | "pupil"
    | "wavelength"
  )[];
  note: string;
}
```

## PsfContributionId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type PsfContributionId =
  | "geometric-defocus-circle"
  | "circular-diffraction-first-zero"
  | "non-circular-diffraction"
  | "mechanical-pupil-clipping"
  | "field-curvature"
  | "field-dependent-aberration"
  | "field-dependent-bokeh";
```

## PsfContributionStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type PsfContributionStatus =
  | "implemented-diagnostic"
  | "implemented-framework"
  | "reserved-contract";
```

## PsfFoundationComponents

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PsfFoundationComponents {
  context: {
    field: {
      imagePointMm: LensFieldPointMm;
      radiusMm: number;
      normalizationRadiusMm: number;
      normalizedRadius: number;
    };
    depth: {
      focusDistanceM: number;
      subjectDistanceM: number;
    };
    spectralBasis: {
      kind: "monochromatic";
      wavelengthNm: number;
    };
    pupil: {
      kind: "ideal-circular-f-number-derived";
      apertureFNumber: number;
      diameterMm: number;
    };
  };
  contributions: {
    geometricDefocus: {
      id: "geometric-defocus-circle";
      diameterMm: number;
      provenance: CalculationProvenance;
    };
    circularDiffraction: {
      id: "circular-diffraction-first-zero";
      firstZeroDiameterMicrometers: number;
      provenance: CalculationProvenance;
    };
  };
  composition: {
    status: "not-composed";
    note: string;
  };
}
```

## PsfFoundationContract

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PsfFoundationContract {
  version: typeof PSF_FOUNDATION_VERSION;
  coordinateSpace: "image-plane-metric";
  fieldAxes: "+X right, +Y up";
  compositionPolicy:
    "separate-diagnostics-plus-explicit-profiled-combined-psf";
  contributions: readonly PsfContributionContract[];
  previewReferencePolicy: {
    previewMayApproximate: true;
    referenceMayUseHigherFidelity: true;
    mustPreserveContributionSemantics: true;
  };
  notes: readonly string[];
}
```
