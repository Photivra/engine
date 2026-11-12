# camera/equivalent-focal-length.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateEquivalentFocalLength35Mm

Calculates the conventional 35 mm-equivalent focal length from the physical
focal length and the diagonal of the active capture area.

The physical focal length is not changed. It stays the optical input for
projection and depth-of-field calculations. Focus distance and later digital
or output crops are deliberately left out of this conventional equivalence.

```ts
export function calculateEquivalentFocalLength35Mm(
  input: CalculateEquivalentFocalLength35MmInput
): CalculationResult<EquivalentFocalLength35Mm>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateEquivalentFocalLength35MmInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateEquivalentFocalLength35MmInput {
  /** Physical optical focal length in millimetres. */
  focalLengthMm: number;
  /** Effective physical active-capture imaging area. */
  activeImagingArea: SensorImagingArea;
}
```

## EquivalentFocalLength35Mm

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EquivalentFocalLength35Mm {
  /** Physical optical focal length supplied by the caller. */
  actualFocalLengthMm: number;
  /** Conventional diagonal-based 35 mm-equivalent focal length. */
  equivalentFocalLength35Mm: number;
  /** Diagonal crop factor of the active physical capture area. */
  cropFactor35Mm: number;
  /** Physical active-capture diagonal in millimetres. */
  activeImagingAreaDiagonalMm: number;
  /** Declares the equivalence convention used by this result. */
  basis: "diagonal";
}
```
