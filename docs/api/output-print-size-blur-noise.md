# output/print-size-blur-noise.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculatePrintSizeLimitWithBlurAndNoise

Calculates the largest print, at a fixed viewing distance, at which the capture still looks sharp and clean, and names
the factor that limits it: pixels, blur or noise. An approximation throughout; the equations are exact under its model.

With θ the criterion angle, d the viewing distance, s = 2 d tan(θ/2) the length θ covers on the print, N_w the raster
width in pixels, b the blur diameter in pixels and SNR_px the per-pixel SNR (print width W, height in proportion):
- pixels: a print pixel (W / N_w) may cover at most s, so W ≤ N_w·s (as `calculatePrintPlan` with
 `angular-pixel-pitch`, before its whole-pixel rounding);
- blur: the blur on the print (b·W / N_w) may cover at most s, so W ≤ N_w·s / b: the criterion of an acceptable circle
 of confusion with the eye's resolution as the limit;
- noise: the eye averages the (W / N_w) wide pixels inside s, so the visible SNR is SNR_px·(N_w·s / W) while a pixel is
 smaller than s (the mean of n independent values has 1/√n of their standard deviation); W ≤ N_w·s·SNR_px / SNR_min,
 and noise never limits when SNR_px ≥ SNR_min.
One arcminute is normal (20/20) acuity under optimal conditions (Z. Alomar, K. D. Bojikian, "Visual Acuity Testing in
Adults", EyeWiki, American Academy of Ophthalmology, https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults, last edited
June 16, 2026); the SNR threshold has no default and is the caller's. Blur parts add in root-sum-square, which is exact
for Gaussian spots (variances of independent displacements add: C. M. Grinstead, J. L. Snell, "Introduction to
Probability", 2nd rev. ed., AMS 1997, sec. 6.2, free under the GNU FDL) and an approximation for discs and Airy patterns.

```ts
export function calculatePrintSizeLimitWithBlurAndNoise(value: PrintSizeLimitWithBlurAndNoiseInput): CalculationResult<PrintSizeLimitWithBlurAndNoise>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PrintBlurInput

The capture's blur at the sensor plane, as blur-spot diameters in millimetres.
`components` combines the parts by root-sum-square (an approximation, see the docs); `measured-total` is one measured diameter.
A zero component is allowed and means that part is left out. Engine helpers give the parts: `calculateDefocusCircle` (defocus),
`calculateAiryDisk` (diffraction, micrometres), `calculateProjectedMotionBlur` (motion length).

```ts
export type PrintBlurInput =
  | { kind: "components"; lensMm?: number; defocusMm?: number; diffractionMm?: number; motionMm?: number }
  | { kind: "measured-total"; diameterMm: number };
```

## PrintImageMm

A print size in millimetres at the raster's aspect ratio.

```ts
export interface PrintImageMm { width: number; height: number }
```

## PrintNoiseInput

The noise of one pixel of the printed raster, for the tone the caller cares about (for example mid-gray).
`shot-and-read-noise` uses the engine's noise model (`calculateSignalToNoise`: Poisson shot noise plus RMS read noise);
`pixel-snr` is a per-pixel signal-to-noise ratio the caller already has.

```ts
export type PrintNoiseInput =
  | { kind: "shot-and-read-noise"; signalElectrons: number; readNoiseElectrons: number }
  | { kind: "pixel-snr"; snrLinear: number };
```

## PrintSharpCleanCriterion

What "looks sharp and clean" means: the smallest angle the viewer resolves, and the lowest signal-to-noise ratio the viewer
accepts after the eye averages over that angle. Both are the caller's choice; one arcminute is normal (20/20) acuity.

```ts
export interface PrintSharpCleanCriterion {
  kind: "visual-resolution";
  arcminutes: number;
  minimumVisibleSnr: number;
}
```

## PrintSizeLimitWithBlurAndNoise

Result. Each factor's own limit is the largest print it allows on its own; null means that factor never limits.
`limitingFactor` names the smallest; on a tie the order is pixels, blur, noise.

```ts
export interface PrintSizeLimitWithBlurAndNoise {
  engineApiVersion: string;
  status: "finite" | "no-positive-size";
  limitingFactor: "pixels" | "blur" | "noise";
  maximumImageMm: PrintImageMm;
  limits: { pixels: PrintImageMm; blur: PrintImageMm | null; noise: PrintImageMm | null };
  viewingDistanceMm: number;
  /** The criterion angle as a length on the print at the viewing distance: 2 d tan(θ/2). */
  resolvedSpotMm: number;
  blur: { diameterMm: number; diameterPixels: number; largestComponent: "lens" | "defocus" | "diffraction" | "motion" | "measured-total" | null };
  noise: { pixelSnr: number; visibleSnrAtMaximum: number };
}
```

## PrintSizeLimitWithBlurAndNoiseInput

Input. The raster is the retained image that is printed (after any crop), with square pixels; `pixelPitchMm` is the
sensor length one of those pixels covers. The print keeps the raster's aspect ratio. The viewing distance is fixed.

```ts
export interface PrintSizeLimitWithBlurAndNoiseInput {
  raster: RasterDimensions;
  pixelPitchMm: number;
  viewingDistance: PrintLength;
  criterion: PrintSharpCleanCriterion;
  blur: PrintBlurInput;
  noise: PrintNoiseInput;
}
```
