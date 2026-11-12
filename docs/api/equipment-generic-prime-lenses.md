# equipment/generic-prime-lenses.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateGenericPrimeMinimumFocusDistanceM

Minimum focus distance of a generic prime of physical focal length `focalLengthMm`: max(0.10 m, f·(1 + 1/0.15)).

```ts
export function calculateGenericPrimeMinimumFocusDistanceM(focalLengthMm: number): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM

Full-frame-equivalent focal lengths of the generic prime family, mm.

```ts
GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM = Object.freeze([10, 12, 14, 16, 20, 24, 28, 35, 40, 50, 85, 105, 135, 200, 300, 400, 500, 600, 800, 1200] as const)
```

## GENERIC_PRIME_MINIMUM_FOCUS

Minimum focus rule: the object distance at this magnification, but at least `minimumDistanceM`.

```ts
GENERIC_PRIME_MINIMUM_FOCUS = Object.freeze({ magnification: 0.15, minimumDistanceM: 0.1 })
```

## GENERIC_PRIME_THIRD_STOP_F_NUMBERS

The marked third-stop f-numbers (the conventional rounded values of N = 2^(k/6), k = 0, 1, …), from f/1 to f/32.
A lens's `fNumbers` are those within its range; any f-number inside the range is accepted.

```ts
GENERIC_PRIME_THIRD_STOP_F_NUMBERS = Object.freeze([1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11,
  13, 14, 16, 18, 20, 22, 25, 29, 32] as const)
```

## GenericPrimeEquivalentFocalLengthMm

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type GenericPrimeEquivalentFocalLengthMm = typeof GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM[number];
```

## GenericPrimeLens

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericPrimeLens {
  /** Public opaque id, for example "generic-prime-50mm-equivalent". */
  lensId: string;
  equivalentFocalLengthMm: GenericPrimeEquivalentFocalLengthMm;
  /** Physical focal length for this sensor: equivalent ÷ crop factor. */
  focalLengthMm: number;
  /** Diagonal crop factor of the sensor (36 × 24 mm = 1). */
  cropFactor35Mm: number;
  /** Widest aperture (smallest f-number) and narrowest aperture. */
  widestFNumber: number;
  narrowestFNumber: number;
  /** The marked third-stop f-numbers within the range. */
  fNumbers: readonly number[];
  /** max(0.10 m, f·(1 + 1/0.15)), metres from the lens (thin lens). */
  minimumFocusDistanceM: number;
  /** Magnification at the minimum focus distance, f/(d − f). */
  maximumMagnification: number;
  scientificStatus: "approximation";
  limitations: readonly string[];
}
```

## resolveGenericPrimeLens

Resolves a generic prime for a sensor: its actual focal length, f-number range, marked f-numbers and minimum focus.
`activeImagingArea` is the sensor's active capture area in millimetres.

```ts
export function resolveGenericPrimeLens(input: { equivalentFocalLengthMm: number; activeImagingArea: { widthMm: number; heightMm: number } }): GenericPrimeLens;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
