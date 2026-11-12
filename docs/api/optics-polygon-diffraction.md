# optics/polygon-diffraction.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CalculateIdealPolygonDiffractionInput

On-axis, in-focus scalar diffraction of one ideal regular polygon pupil.

```ts
export interface CalculateIdealPolygonDiffractionInput extends CalculateIdealApertureInput {
  /** Diameter of a circle with the SAME AREA as the physical polygon opening. */
  equivalentAreaPupilDiameterMm: number;
  /** Paraxial propagation distance from pupil to image. Never inferred from focus. */
  pupilToImageDistanceMm: number;
  /** Wavelength in the declared propagation medium. No air/vacuum conversion is applied. */
  wavelengthNm: number;
  wavelengthBasis: Exclude<SpectralWavelengthBasis, "unspecified">;
  /** Displacements from the on-axis PSF center, +X right / +Y up; at most 4096. */
  imagePointsMicrometers: readonly { x: number; y: number }[];
}
```

## calculateIdealPolygonDiffractionPsf

Calculates the continuous, single-wavelength Fraunhofer (far-field) PSF
density of an ideal regular polygon with straight edges. The pupil is
uniformly lit, has zero phase and sits on the optical axis.

The physical area is explicit. f/N may supply the equal-area diameter only
when the caller declares the nominal-area convention. Nothing else is
assumed: no phase aberration, clipping, field dependence, curved blades,
defocus or multi-wavelength behaviour.

Density = A |F/A|² / (lambda * propagationDistance)². It integrates to 1
over the infinite plane (Parseval), NOT over the supplied points. Code that
sums the samples must keep density × area and report truncation and
convergence.

```ts
export function calculateIdealPolygonDiffractionPsf(
  input: CalculateIdealPolygonDiffractionInput
): CalculationResult<IdealPolygonDiffraction>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculatePolygonPupilFraunhoferPsf

Continuous, single-wavelength Fraunhofer PSF density for any simple polygon pupil that is uniformly
lit and has zero phase (for example a cat's-eye pupil from mechanical vignetting).

It uses the same analytic edge integral as the regular-polygon model, so there is no aliasing from
a pupil grid. Moving the pupil off the axis only adds a linear phase; the intensity does not
change. Density = A |F/A|² / (lambda z)², and it integrates to 1 over the infinite plane.

```ts
export function calculatePolygonPupilFraunhoferPsf(
  input: CalculatePolygonPupilFraunhoferPsfInput
): CalculationResult<PolygonPupilFraunhoferPsf>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculatePolygonPupilFraunhoferPsfInput

On-axis scalar Fraunhofer diffraction of one arbitrary simple polygon pupil.

```ts
export interface CalculatePolygonPupilFraunhoferPsfInput {
  /**
   * Simple (non-self-intersecting) pupil polygon in pupil-plane millimetres, +X right / +Y up,
   * with 3 to 4096 vertices. For example, the cat's-eye pupil from calculateMechanicalVignetting().
   */
  pupilVerticesMm: readonly { x: number; y: number }[];
  /** Paraxial propagation distance from pupil to image. Never inferred from focus. */
  pupilToImageDistanceMm: number;
  /** Wavelength in the declared propagation medium. No air/vacuum conversion is applied. */
  wavelengthNm: number;
  wavelengthBasis: Exclude<SpectralWavelengthBasis, "unspecified">;
  /** Displacements from the PSF centre (the geometric image point), +X right / +Y up; at most 4096. */
  imagePointsMicrometers: readonly { x: number; y: number }[];
}
```

## IdealPolygonDiffraction

Samples of a continuous unit-energy PSF. This is not a normalized finite convolution kernel.

```ts
export interface IdealPolygonDiffraction {
  bladeCount: number;
  firstBladeEdgeAngleDegrees: number;
  pupilToImageDistanceMm: number;
  wavelengthNm: number;
  wavelengthBasis: Exclude<SpectralWavelengthBasis, "unspecified">;
  pupilAreaSquareMm: number;
  pupilCircumradiusMm: number;
  pupilNormalization: "equal-area-circle";
  fieldAxes: "+X right, +Y up";
  energyNormalization: "unit-integral-over-infinite-image-plane";
  throughputApplied: false;
  samples: readonly {
    imagePointMicrometers: { x: number; y: number };
    /** |F/A|². Equal to 1 at the origin. Not an energy or probability weight. */
    peakNormalizedIntensity: number;
    /** Density integrating to unity over the full image plane, in 1/µm². */
    intensityDensityPerSquareMicrometer: number;
  }[];
}
```

## PolygonPupilFraunhoferPsf

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PolygonPupilFraunhoferPsf {
  pupilAreaSquareMm: number;
  pupilToImageDistanceMm: number;
  wavelengthNm: number;
  wavelengthBasis: Exclude<SpectralWavelengthBasis, "unspecified">;
  fieldAxes: "+X right, +Y up";
  energyNormalization: "unit-integral-over-infinite-image-plane";
  throughputApplied: false;
  samples: readonly {
    imagePointMicrometers: { x: number; y: number };
    /** |F/A|²; unity at the origin. */
    peakNormalizedIntensity: number;
    /** Density integrating to unity over the full image plane, in 1/µm². */
    intensityDensityPerSquareMicrometer: number;
  }[];
}
```
