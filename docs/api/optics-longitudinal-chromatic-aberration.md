# optics/longitudinal-chromatic-aberration.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCauchyRefractiveIndex

Two-term Cauchy refractive index fitted to n_d and V_d. Valid as an approximation over
360-830 nm only.

```ts
export function calculateCauchyRefractiveIndex(input: {
  refractiveIndexD: number;
  abbeNumberD: number;
  wavelengthNm: number;
}): CalculationResult<{ refractiveIndex: number }>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateLongitudinalChromaticFocus

Wavelength-dependent focus for one wavelength: focal length, image distance, signed defocus at
a sensor focused at the reference wavelength, geometric blur and the defocus wavefront.

```ts
export function calculateLongitudinalChromaticFocus(
  input: CalculateLongitudinalChromaticFocusInput
): CalculationResult<LongitudinalChromaticFocus>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateLongitudinalChromaticFocusInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateLongitudinalChromaticFocusInput {
  /** Focal length at the reference wavelength, in mm. */
  focalLengthMm: number;
  /** Wavelength at which the sensor is focused, in nm. */
  referenceWavelengthNm: number;
  /** Wavelength to evaluate, in nm (same wavelength basis as the dispersion data). */
  wavelengthNm: number;
  /** Nominal f-number at the reference wavelength (entrance-pupil diameter = f / N). */
  apertureFNumber: number;
  /** Focus (object) distance at the reference wavelength, metres from the principal plane. */
  focusDistanceM: number;
  /** Subject distance in metres; defaults to focusDistanceM. */
  subjectDistanceM?: number;
  dispersion: LongitudinalChromaticDispersion;
}
```

## FRAUNHOFER_C_LINE_NM

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
FRAUNHOFER_C_LINE_NM = 656.2725
```

## FRAUNHOFER_D_LINE_NM

Fraunhofer spectral-line wavelengths in nm (SCHOTT TIE-29 table; also ISO 7944 reference wavelengths).

```ts
FRAUNHOFER_D_LINE_NM = 587.5618
```

## FRAUNHOFER_F_LINE_NM

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
FRAUNHOFER_F_LINE_NM = 486.1327
```

## LongitudinalChromaticDispersion

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type LongitudinalChromaticDispersion =
  | {
      kind: "thin-singlet-abbe";
      /** Refractive index at the d line. */
      refractiveIndexD: number;
      /** Abbe number V_d = (n_d - 1) / (n_F - n_C). */
      abbeNumberD: number;
    }
  | {
      kind: "declared-focal-shift";
      /** Strictly increasing wavelengths; shift is f(lambda) - f_nominal in micrometres. */
      samples: readonly {
        wavelengthNm: number;
        focalLengthShiftMicrometers: number;
      }[];
    };
```

## LongitudinalChromaticFocus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LongitudinalChromaticFocus {
  wavelengthNm: number;
  referenceWavelengthNm: number;
  focalLengthAtWavelengthMm: number;
  /** f(lambda) - f(reference), micrometres. */
  focalShiftMicrometers: number;
  /** Sensor plane distance (reference-wavelength image of the focus plane), mm. */
  sensorImageDistanceMm: number;
  /** Image distance of the subject at this wavelength, mm. */
  imageDistanceAtWavelengthMm: number;
  /** Sensor minus image distance, micrometres. */
  signedDefocusImagePlaneMicrometers: number;
  /** Geometric thin-lens blur-circle diameter at the sensor, mm. */
  geometricBlurDiameterMm: number;
  /** Image-side working f-number v(lambda) / D. */
  workingFNumberAtWavelength: number;
  /** Defocus wave aberration W020 for the complex-pupil PSF, micrometres. */
  w020Micrometers: number;
  /** Equivalent Noll Z4 coefficient, micrometres. */
  zernikeZ4Micrometers: number;
}
```
