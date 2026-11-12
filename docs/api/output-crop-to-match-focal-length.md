# output/crop-to-match-focal-length.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCropToMatchFocalLength

The centred crop that makes an image from a shorter lens match a longer lens's framing from the
same position: crop factor target ÷ focal length, and the pixels and megapixels left.

Exact for ideal rectilinear lenses focused at infinity, to whole pixels (the crop is
`calculateCenteredCrop`'s, which keeps the aspect ratio). At close focus the matching factor is
larger, F·(d − f)/(f·(d − F)) at object distance d (thin lens); that, distortion and focus
breathing are not modelled. The crop has the longer lens's framing and perspective but fewer
pixels: it records no more detail than the cropped part of the shorter lens's image.

Example: a 24 MP (6000 × 4000) image at 50 mm cropped to match 100 mm: factor 2, 3000 × 2000,
6 MP.

```ts
export function calculateCropToMatchFocalLength(
  input: CalculateCropToMatchFocalLengthInput
): CalculationResult<CropToMatchFocalLength>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateCropToMatchFocalLengthInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateCropToMatchFocalLengthInput {
  /** Focal length the image was taken with, in millimetres. */
  focalLengthMm: number;
  /** Longer focal length whose framing the crop should match, in millimetres. At least `focalLengthMm`. */
  targetFocalLengthMm: number;
  /** Image width in pixels (for example the sensor's output width). */
  pixelWidth: number;
  /** Image height in pixels. */
  pixelHeight: number;
}
```

## CropToMatchFocalLength

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CropToMatchFocalLength {
  /** Focal length supplied by the caller, in millimetres. */
  focalLengthMm: number;
  /** Target focal length supplied by the caller, in millimetres. */
  targetFocalLengthMm: number;
  /** Linear crop factor targetFocalLengthMm / focalLengthMm (1 means no crop). */
  cropFactor: number;
  /** Width left after the centred crop, in pixels (as `calculateCenteredCrop`). */
  pixelWidth: number;
  /** Height left after the centred crop, in pixels. */
  pixelHeight: number;
  /** Pixels left, in millions. */
  megapixels: number;
  /** Megapixels of the uncropped image. */
  sourceMegapixels: number;
  /** Fraction of the original pixel area retained, about 1 / cropFactor². */
  retainedAreaFraction: number;
}
```
