# optics/detail-limit.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateDetailLimit

Which limits detail for given settings: the lens (diffraction at this f-number, aberrations, defocus) or the sensor's pixel
pitch. Returns the optics' resolution (MTF50 and the diffraction cut-off, cycles/mm), the sampling's (Nyquist frequency
and, with a Bayer filter, the red and blue sites'), the system MTF50 (optics × pixel aperture), the f-number from which
diffraction limits on this sensor, and which one limits.

The sensor limits when the optics still pass 50 % contrast at the Nyquist frequency 1/(2p); otherwise the lens does,
through diffraction when its wavefront error is within the Maréchal criterion (RMS ≤ λ/14), else through aberrations or
defocus. The optics MTF is the exact scalar OTF of the stated wavefront at one wavelength; the decision rule and the
catalogue lenses' wavefronts are approximations.

Example: an ideal 50 mm lens at f/22 on a 36 × 24 mm, 6000-pixel-wide sensor (6 µm) is limited by diffraction (optics
MTF50 ≈ 33 cycles/mm against a Nyquist frequency of ≈ 83); at f/4 the pixel pitch limits.

```ts
export function calculateDetailLimit(input: CalculateDetailLimitInput): CalculationResult<DetailLimit>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateDetailLimitInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateDetailLimitInput {
  /** Active imaging area and horizontal pixel count; pitch = widthMm / pixelWidth. */
  sensor: {
    widthMm: number;
    heightMm: number;
    pixelWidth: number;
    /** Default `"bayer"`. `"none"`: every site records full detail (a monochrome sensor). */
    colorFilterArray?: "bayer" | "none";
  };
  lens: DetailLimitIdealLens | DetailLimitCatalogueLens;
  /** f-number set on the lens. */
  fNumber: number;
  /**
   * Focus and subject distances from the lens in meters. Omitted: focused at infinity, subject in focus. `subjectDistanceM`
   * omitted: the subject is at the focus distance.
   */
  focus?: { focusDistanceM: number; subjectDistanceM?: number };
  /** Field height as a fraction of the half-diagonal, 0 (center, default) to 1 (corner). Only aberrations depend on it. */
  fieldPosition?: number;
  /** Wavelength in nanometres, 380–780. Default 550. */
  wavelengthNm?: number;
}
```

## DETAIL_LIMIT_LIMITS

Limits of `calculateDetailLimit`: the wavelength range and the largest wavefront (sum of the magnitudes of its terms, in
waves) whose transfer function is integrated. Beyond it the blur is geometric and the quadrature would grow without
bound; use `calculateDefocusCircle` for such a blur.

```ts
DETAIL_LIMIT_LIMITS = Object.freeze({ minimumWavelengthNm: 380, maximumWavelengthNm: 780, maximumWavefrontWaves: 64 })
```

## DetailLimit

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DetailLimit {
  /** The lens or the sensor. */
  limitedBy: DetailLimitedBy;
  /** Diffraction, aberrations or defocus (the lens), or the pixel pitch (the sensor). */
  limitingFactor: DetailLimitingFactor;
  /** Optics MTF50 / Nyquist frequency: at least 1 when the sensor limits. */
  opticsToNyquistRatio: number;
  fNumber: number;
  wavelengthNm: number;
  /** Physical focal length used (the catalogue lens's on this sensor), mm. */
  focalLengthMm: number;
  fieldPosition: number;
  optics: DetailLimitOptics;
  sampling: DetailLimitSampling;
  system: DetailLimitSystem;
  /**
   * The f-number at which an aberration-free lens in focus has its MTF50 at the Nyquist frequency (2·p·0.40397/λ at
   * infinity focus): from it on, diffraction limits detail on this sensor whatever the lens.
   */
  diffractionLimitedFNumber: number;
  basis: Readonly<Record<"optics" | "sampling" | "system" | "limitedBy", DetailLimitBasis>>;
}
```

## DetailLimitBasis

Whether a quantity is exact under its stated conditions or an approximation.

```ts
export interface DetailLimitBasis { kind: "exact" | "approximation"; statement: string }
```

## DetailLimitCatalogueLens

A generic catalogue lens (`GENERIC_LENS_IDS`), resolved for the sensor as `resolveGenericLens` does.

```ts
export interface DetailLimitCatalogueLens {
  kind: "catalogue";
  lensId: string;
}
```

## DetailLimitedBy

Which component limits detail.

```ts
export type DetailLimitedBy = "lens" | "sensor";
```

## DetailLimitIdealLens

A lens with no aberrations (diffraction only).

```ts
export interface DetailLimitIdealLens {
  kind: "ideal";
  /** Physical focal length in millimeters (for the working f-number and the defocus of a subject off the focus distance). */
  focalLengthMm: number;
}
```

## DetailLimitingFactor

What limits it: the lens's diffraction, aberrations or defocus, or the sensor's pixel pitch.

```ts
export type DetailLimitingFactor = "diffraction" | "aberrations" | "defocus" | "pixel-pitch";
```

## DetailLimitOptics

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DetailLimitOptics {
  /** Working f-number N_w = N·v/f (thin-lens image distance v; N at infinity focus). */
  workingFNumber: number;
  /** Diffraction cut-off 1/(λ·N_w) in cycles/mm: no optics passes detail beyond it. */
  cutoffCyclesPerMm: number;
  /** Frequency where the optics' MTF falls to 0.5, the lower of the two directions, cycles/mm. */
  mtf50CyclesPerMm: number;
  /** MTF50 for detail along the radius from the image center (tangential), cycles/mm. */
  tangentialMtf50CyclesPerMm: number;
  /** MTF50 for detail across the radius (sagittal), cycles/mm. Equal to the tangential value at the center. */
  sagittalMtf50CyclesPerMm: number;
  /** MTF50 of an aberration-free lens in focus at the same working f-number (0.40397·cut-off), cycles/mm. */
  diffractionMtf50CyclesPerMm: number;
  /** Optics MTF at the sensor's Nyquist frequency (lower direction). */
  mtfAtNyquist: number;
  /** RMS wavefront error in waves at the wavelength: of the aberrations, of the defocus, and of both together. */
  rmsWavefrontErrorWaves: { aberrations: number; defocus: number; total: number };
  /** Whether the total RMS wavefront error is within the Maréchal criterion λ/14. */
  withinMarechalCriterion: boolean;
  /** Geometric blur-circle diameter of the defocus on the sensor, mm (0 in focus). */
  defocusBlurDiameterMm: number;
}
```

## DetailLimitSampling

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DetailLimitSampling {
  colorFilterArray: "bayer" | "none";
  /** Pixel pitch in micrometres: widthMm / pixelWidth. */
  pixelPitchMicrometers: number;
  /** 1/(2p), cycles/mm: the finest detail the pixel grid records without aliasing (Bayer green sites too, along rows and columns). */
  nyquistCyclesPerMm: number;
  /** Bayer only: 1/(4p), the Nyquist frequency of the red and blue sites. Null without a color filter array. */
  redBlueNyquistCyclesPerMm: number | null;
  /** Pixel aperture MTF at the Nyquist frequency: sinc(1/2) = 2/π. */
  pixelApertureMtfAtNyquist: number;
  /** Frequency where the pixel aperture MTF falls to 0.5 (0.60335/p), cycles/mm: beyond the Nyquist frequency. */
  pixelApertureMtf50CyclesPerMm: number;
}
```

## DetailLimitSystem

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DetailLimitSystem {
  /** MTF50 of optics × pixel aperture (lower direction), cycles/mm. Detail above the Nyquist frequency aliases. */
  mtf50CyclesPerMm: number;
  /** The same in line pairs per picture height (cycles/mm × heightMm). */
  mtf50LinePairsPerPictureHeight: number;
  /** System MTF at the Nyquist frequency (lower direction). */
  mtfAtNyquist: number;
}
```
