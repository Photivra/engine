# facade/display-view-estimate.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## DisplayViewCountRange

A count that is known exactly (`minimum === maximum`) or only bounded (stratified samples, whose real pixels follow seeded jitter).

```ts
export interface DisplayViewCountRange { minimum: number; maximum: number }
```

## DisplayViewRenderEstimate

2.28.0 (#660): what {@link estimateDisplayViewRender} returns: the counts and the methods a CPU render of the view would take.

```ts
export interface DisplayViewRenderEstimate {
  /** The region's display pixels. */
  displayPixels: number;
  /** The estimator `view.estimation` will report. */
  estimation: "exact-area-mean-over-real-pixels" | "stratified-monte-carlo-over-real-pixels";
  /** Real pixels per display pixel (scaleX · scaleY). */
  realPixelsPerDisplayPixel: number;
  /**
   * Renderer passes: `view` at the view's size (one per distinct channel map of `output.lensCorrections`, one with `output.sharpening`)
   * and `realPixels` at 1:1 (with `output.sharpening`, one per channel map).
   */
  passes: { view: number; realPixels: number };
  /** Real pixels the passes evaluate: the render's `diagnostics.sampleCount`. Exact, except for jittered samples through exact lens corrections. */
  sampleCount: DisplayViewCountRange;
  /** Demosaic site reads of those real pixels: the render's `diagnostics.siteEvaluations`. Exact on the exact area mean; bounded for stratified views. */
  siteEvaluations: DisplayViewCountRange;
  /** Display pixels sampled fully and with the uniform count (the render's `detailPixelCount` and `uniformPixelCount`; the exact area mean counts every pixel as detailed). */
  detailPixelCount: number;
  uniformPixelCount: number;
  /** Native sites of the region's footprint and its reach: the most sites the expected signal computes per pass (each at most once per pass). */
  nativeSites: number;
  /** The expected signal's work per site. */
  signal: {
    /**
     * "taps": each site sums its kernel taps; "regrouped": the in-focus signal, then the defocus disc by runs (#612, #642, #651);
     * "runs": #564's runs above 64 sites; "point": no kernel (one lattice point per query offset).
     */
    method: "taps" | "regrouped" | "runs" | "point";
    /** Radius of the kernel each site reads (the combined kernel; the in-focus kernel's when regrouped), in sites, and its taps. */
    kernelRadiusSites: number;
    tapsPerSite: number;
    /** The defocus disc's radius when regrouped or by runs (its runs per site are about 2·(2R + 1)), else null. */
    discRadiusSites: number | null;
    /** Query offsets per site (pixel-aperture nodes × filter spots), spectral nodes and temporal midpoints. */
    queryOffsets: number;
    spectralNodes: number;
    temporalMidpoints: number;
    /** #651: rows per block under a rolling shutter when regrouped (1: each row at its own instants; more: the fast row bands), else null. */
    rollingBandRows: number | null;
    /** #569, #655: the catalogue PSF's field-zone side in sites, and whether the uniform-window fast method is on; null without a catalogue lens. */
    lensPsfZoneSites: number | null;
    uniformWindows: boolean | null;
  };
  /** #656: points per axis of the development chain's rule (`view.rendering`), or null when the view has no coupled steps. */
  chainPointsPerAxis: "3-or-6" | 16 | null;
}
```

## estimateDisplayViewRender

#660: the work a CPU render of `view` by `prepared` would do, counted without rendering it (see {@link DisplayViewRenderEstimate}). A root
function, not a method of the prepared view, so a bundle that does not import it carries none of this module.

```ts
export function estimateDisplayViewRender(prepared: PreparedDisplayView, view: SimulateDisplayViewOptions): DisplayViewRenderEstimate;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
