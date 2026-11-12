# output/print-plan.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculatePrintPlan

Finds the smallest file, at the exact native aspect ratio, that meets the declared sampling and lab constraints.
The angular guidance is an approximate rule of thumb; the geometry itself is calculated exactly. A common criterion,
one arcminute per pixel, is normal (20/20) visual acuity under optimal conditions: the minimum angle of resolution of an
ideal eye is about 1 minute of arc, and 20/20 letters are built from elements that each subtend 1 arcmin (Z. Alomar, K. D. Bojikian, "Visual Acuity Testing in Adults", EyeWiki, American Academy of Ophthalmology,
https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults, last edited June 16, 2026).
Some viewers resolve finer detail and many resolve coarser, so it stays a rule of thumb, and the criterion is the caller's.
It does not assess source detail, perceived quality, file writing or available resources.

```ts
export function calculatePrintPlan(value: PrintPlanInput): CalculationResult<PrintPlan>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculatePrintSizeLimit

Calculates the largest print size under the stated conditions. Lab constraints need individual plans,
so this size query reports them as unsupported rather than ignoring them.
As in `calculatePrintPlan`, an angular criterion is an approximate rule of thumb: one arcminute per pixel is normal
(20/20) acuity under optimal conditions, which some viewers exceed and many do not (Z. Alomar, K. D. Bojikian, "Visual Acuity Testing in Adults", EyeWiki, American Academy of Ophthalmology,
https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults, last edited June 16, 2026).

```ts
export function calculatePrintSizeLimit(value: PrintSizeLimitInput): CalculationResult<PrintSizeLimit>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parsePrintPlanInput

Validates and copies an untrusted print request. It never assumes the source is native if that is not declared.

```ts
export function parsePrintPlanInput(value: unknown): PrintPlanInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PrintContainLayout

The layout of a `contain` fit, in millimetres. The printed image itself is the plan's `printedImageMm`.

```ts
export interface PrintContainLayout {
  /** The paper as placed: after the quarter turn when `paperRotated`. */
  paperMm: { width: number; height: number };
  paperRotated: boolean;
  /** Unprinted border on each side of the centered image; zero when the paper has the image's aspect ratio. */
  bordersMm: { left: number; right: number; top: number; bottom: number };
}
```

## PrintedImageSize

The flat printed image area. It excludes paper margins, borders and canvas wraps.
With a `contain` fit it is instead the paper, or the printable area of it, that the image is fitted inside.

```ts
export interface PrintedImageSize { width: number; height: number; unit: PrintLength["unit"] }
```

## PrintFit

How the printed image relates to `printedImage`.
- `confirmed-native-aspect`: `printedImage` is the printed image itself and must already have the native aspect ratio,
 within the stated relative error.
- `contain`: `printedImage` is the paper. The image keeps the native aspect ratio and is scaled to the largest size that
 fits inside it, centered; the rest is unprinted border. `match-image` turns the paper a quarter turn when its
 orientation (portrait or landscape) differs from the image's; `as-given` keeps it. Layout only: nothing is cropped or resampled.

```ts
export type PrintFit =
  | { kind: "confirmed-native-aspect"; maximumRelativeAspectError: number }
  | { kind: "contain"; paperOrientation: "as-given" | "match-image" };
```

## PrintLength

A physical length. Not to be confused with image pixels or printer dots.

```ts
export interface PrintLength { value: number; unit: "mm" | "cm" | "inches" | "m" }
```

## PrintNativeSource

The declared native source geometry. Not a preview or a resampled pixel count.

```ts
export type PrintNativeSource =
  | { kind: "native-retained"; captureId: string; geometry: ResolveCaptureGeometryInput }
  | { kind: "unavailable"; reason: "missing-native-raster" | "unverified-native-identity" };
```

## PrintPlan

A plan, valid only under its stated conditions. A null recommendation never means it is fine to upscale.

```ts
export interface PrintPlan {
  engineApiVersion: string;
  input: PrintPlanInput;
  status: "ready" | "insufficient-native-pixels" | "provider-conflict" | "crop-confirmation-required" | "cannot-assess" | "unsupported";
  nativePixelSufficiency: "sufficient" | "insufficient" | "cannot-assess";
  reasons: string[];
  printedImageMm: { width: number; height: number } | null;
  viewingDistanceMm: number | null;
  guidance: CalculationResult<{ derivedPixelsPerInch: number; maximumPixelPitchMm: number; maximumArcminutesPerPixel: number | null }> | null;
  relativeAspectError: number | null;
  native: PrintRasterSampling | null;
  minimumSamplingRaster: RasterDimensions | null;
  recommended: PrintRasterSampling | null;
  resamplingScale: { x: number; y: number } | null;
  alternatives: { maximumImageMmAtCurrentDistance: { width: number; height: number }; minimumViewingDistanceMmAtCurrentSize: number | null } | null;
  capturedDetailAssessment: "unassessed";
  deliveryAssessment: "unassessed";
  /** Present only with a `contain` fit; null when the native raster is unknown. */
  contain?: PrintContainLayout | null;
}
```

## PrintPlanInput

Plan input. The output keeps the exact native aspect ratio; the allowed physical aspect error is explicit and reported.

```ts
export interface PrintPlanInput {
  source: PrintNativeSource;
  printedImage: PrintedImageSize;
  viewingDistance: PrintLength;
  sampling: PrintSamplingCriterion;
  fit: PrintFit;
  provider?: PrintProviderConstraints;
}
```

## PrintProviderConstraints

Print lab requirements supplied by the caller. There is no vendor catalogue and no guarantee of what a lab will accept.

```ts
export interface PrintProviderConstraints {
  minimumRaster?: RasterDimensions;
  exactRaster?: RasterDimensions;
  minimumPpi?: number;
  exactPpi?: number;
}
```

## PrintRasterSampling

Pixel density and angular pixel pitch for each axis. The angles are pure geometry, not a measure of visual acuity.

```ts
export interface PrintRasterSampling {
  raster: RasterDimensions;
  pixelsPerInch: { x: number; y: number };
  angularPixelPitchArcminutes: { x: number; y: number };
}
```

## PrintSamplingCriterion

How to choose pixel density: one of three angular criteria at the viewing distance, or a manual PPI (pixels per inch), which gives a different kind of plan.

```ts
export type PrintSamplingCriterion =
  | { kind: "angular-pixel-pitch"; maximumArcminutesPerPixel: number }
  | { kind: "angular-stroke"; strokeWidthArcminutes: number; samplesPerStroke: number }
  | { kind: "angular-line-pair"; periodArcminutes: number; samplesPerPeriod: number }
  | { kind: "manual-ppi"; pixelsPerInch: number };
```

## PrintSizeLimit

Result of the size query. A status says "unbounded" rather than using Infinity. "no-positive-size" is a valid answer, not an input error.

```ts
export interface PrintSizeLimit {
  engineApiVersion: string;
  status: "finite" | "unbounded" | "no-positive-size" | "cannot-assess" | "unsupported";
  maximumImageMm: { width: number; height: number } | null;
  reasons: string[];
  referencePlan: PrintPlan;
  /** Present only with a `contain` fit: the paper that holds `maximumImageMm` with the same layout (borders scale with it). */
  maximumPaperMm?: { width: number; height: number } | null;
}
```

## PrintSizeLimitInput

Input for the largest-print-size query. It keeps the reference plan's aspect ratio and criterion.
With proportional viewing, the reference viewing distance scales with the image size.

```ts
export interface PrintSizeLimitInput {
  plan: PrintPlanInput;
  viewingDistancePolicy: "fixed" | "proportional-to-image-size";
}
```
