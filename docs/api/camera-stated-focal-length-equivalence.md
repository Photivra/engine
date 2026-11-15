# camera/stated-focal-length-equivalence.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateImagingAreaFromFocalLength35Mm

The imaging area (and diagonal crop factor) that a file's FocalLength and FocalLengthIn35mmFilm imply, with the interval the
35 mm value's rounding allows and the basis used.

Example: 6.2 mm stated as 27 mm on a 4:3 image gives crop factor 4.35 (4.27–4.44, ±1.9 %) and about 7.95 × 5.96 mm (7.80 × 5.85 to
8.10 × 6.07 mm).

```ts
export function calculateImagingAreaFromFocalLength35Mm(input: CalculateImagingAreaFromFocalLength35MmInput): CalculationResult<ImagingAreaFromFocalLength35Mm>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateImagingAreaFromFocalLength35MmInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateImagingAreaFromFocalLength35MmInput {
  /** The lens's real focal length (Exif FocalLength), mm. */
  focalLengthMm: number;
  /** The stated 35 mm-equivalent focal length (Exif FocalLengthIn35mmFilm), mm. */
  focalLength35MmEquivalentMm: number;
  /** The recorded image's width and height, pixels (stored or oriented; only their ratio is used, square pixels assumed). */
  imageWidthPixels: number;
  imageHeightPixels: number;
  /**
   * The step the 35 mm value was stated to, mm: the true value is taken to lie within ± half of it. Default 1, Exif's whole-number
   * tag; 0 when the value is known exactly.
   */
  focalLength35MmResolutionMm?: number;
}
```

## calculateSensorEquivalenceFromFocalLength35Mm

Sensor equivalence from a file's statements: the imaging area from FocalLength and FocalLengthIn35mmFilm
({@link calculateImagingAreaFromFocalLength35Mm}), then `calculateSensorEquivalence` with the file's focal length and f-number,
plus each quantity's interval from the 35 mm value's rounding.

Example: 6.2 mm f/1.8 stated as 27 mm on a 4:3 image gives an equivalent f-number of about f/7.84 (f/7.69–f/7.98) and −4.19
stops of total light (−4.24 to −4.14) against full frame.

```ts
export function calculateSensorEquivalenceFromFocalLength35Mm(
  input: CalculateSensorEquivalenceFromFocalLength35MmInput
): CalculationResult<SensorEquivalenceFromFocalLength35Mm>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorEquivalenceFromFocalLength35MmInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorEquivalenceFromFocalLength35MmInput extends CalculateImagingAreaFromFocalLength35MmInput {
  /** f-number on the lens (Exif FNumber). */
  fNumber: number;
  /** Format to compare against. Defaults to the 36 × 24 mm frame. */
  reference?: SensorImagingArea;
}
```

## ImagingAreaFromFocalLength35Mm

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImagingAreaFromFocalLength35Mm {
  /** The imaging area at the stated value. */
  imagingArea: SensorImagingArea;
  /** The imaging areas at the ends of the 35 mm value's interval (the largest at its lower end). */
  imagingAreaInterval: { smallest: SensorImagingArea; largest: SensorImagingArea };
  /** The area's diagonal at the stated value, mm. */
  diagonalMm: number;
  /** Diagonal crop factor F35 / f at the stated value. */
  cropFactor: number;
  cropFactorInterval: StatedValueInterval;
  /** (maximum − minimum) / (2 · cropFactor): the crop factor's relative uncertainty from the rounding; the same for the diagonal. */
  cropFactorRelativeHalfWidth: number;
  /** The 35 mm values that round to the stated one. */
  focalLength35MmInterval: StatedValueInterval;
  /** "exact" only when the resolution is 0; otherwise "approximation". */
  exactness: EquivalenceExactness;
  basis: {
    kind: "focal-length-in-35mm-film";
    /** Plain statement of the basis, its rounding and its assumptions. */
    statement: string;
  };
}
```

## SensorEquivalenceFromFocalLength35Mm

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorEquivalenceFromFocalLength35Mm {
  /** The imaging area derived from the stated focal lengths. */
  derivedImagingArea: ImagingAreaFromFocalLength35Mm;
  /** `calculateSensorEquivalence` on the area at the stated value, with its per-quantity basis. */
  equivalence: SensorEquivalence;
  /** The same quantities over the 35 mm value's interval (from the largest and smallest areas). */
  intervals: {
    cropFactor: StatedValueInterval;
    equivalentFocalLengthMm: StatedValueInterval;
    equivalentFNumber: StatedValueInterval;
    areaRatio: StatedValueInterval;
    totalLightDifferenceStops: StatedValueInterval;
  };
}
```

## StatedValueInterval

A closed interval.

```ts
export interface StatedValueInterval { minimum: number; maximum: number }
```
