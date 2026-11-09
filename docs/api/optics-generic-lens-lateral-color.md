# optics/generic-lens-lateral-color.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateLateralColorFringe

The red–blue image displacement of a catalogue lens at a field position on a sensor, in micrometres and pixels, from the
lens's own lateral-colour model Δr(λ) = L·R·H·D(λ) at the lens corrections' channel wavelengths (610 and 465 nm). An
approximation of a generic lens, not a measured product.

```ts
export function calculateLateralColorFringe(input: CalculateLateralColorFringeInput): CalculationResult<LateralColorFringe>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateLateralColorFringeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateLateralColorFringeInput {
  /** A catalogue id (`GENERIC_LENS_IDS`). */
  lensId: string;
  /** The sensor's active capture area, mm (the lens is scaled to it as in `resolveGenericLens`). */
  activeImagingArea: { widthMm: number; heightMm: number };
  /** The sensor's pixel pitch, µm. */
  pixelPitchMicrometers: number;
  /**
   * The field position as fractions of the frame's half-width (x, +right) and half-height (y, +up) from the optical axis, each
   * in [−1, 1]. Default `{ x: 1, y: 1 }`: the top-right corner.
   */
  fieldPosition?: { x: number; y: number };
}
```

## LateralColorDisplacement

A signed displacement of the blue image from the red one: radial (positive: blue farther from the axis) and its x and y parts.

```ts
export interface LateralColorDisplacement {
  radial: number;
  x: number;
  y: number;
}
```

## LateralColorFringe

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LateralColorFringe {
  lensId: string;
  /** The image-plane point, mm from the optical axis (+x right, +y up). */
  imagePointMm: { x: number; y: number };
  /** Field height H: the point's distance from the axis as a fraction of the half-diagonal (1 at the corner). */
  fieldHeight: number;
  /** The channel wavelengths the displacement is taken at, nm. */
  channelWavelengthsNm: { red: number; blue: number };
  /** Blue-minus-red image displacement, µm. */
  blueMinusRedMicrometers: LateralColorDisplacement;
  /** The same in pixels of the given pitch. */
  blueMinusRedPixels: LateralColorDisplacement;
  /** The fringe width: |radial| displacement, µm and pixels. */
  fringeWidthMicrometers: number;
  fringeWidthPixels: number;
  /** The lens's own F-to-C (486 to 656 nm) displacement at this point, L·R·H, µm. */
  fToCMicrometers: number;
}
```
