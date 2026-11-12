# output/subject-framing-crop.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSubjectFramingCrop

Calculates the crop (keeping the aspect ratio) that makes a subject fill a
requested fraction of the frame height.

It assumes the crop can be centred or moved freely, with enough room around
the subject. It does not check the subject's position against the image edges.

```ts
export function calculateSubjectFramingCrop(
  input: CalculateSubjectFramingCropInput
): CalculationResult<SubjectFramingCrop>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSubjectFramingCropInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSubjectFramingCropInput {
  /** Source image width in pixels. */
  pixelWidth: number;
  /** Source image height in pixels. */
  pixelHeight: number;
  /** Projected subject height in source-image pixels. */
  subjectHeightPixels: number;
  /** Desired subject height as a fraction of output frame height, >0 and <=1. */
  targetSubjectHeightFraction: number;
}
```

## SubjectFramingCrop

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SubjectFramingCrop {
  cropFactor: number;
  pixelWidth: number;
  pixelHeight: number;
  megapixels: number;
  /**
   * Actual subject height divided by cropped frame height.
   * Values greater than 1 mean the subject is taller than the output frame.
   */
  subjectHeightFraction: number;
  /** Whether the projected subject exceeds the cropped frame height. */
  subjectClipped: boolean;
  /** Whether achieving the target required an additional crop. */
  cropped: boolean;
}
```
