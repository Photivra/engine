# facade/false-color.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## FalseColorNoise

#743: `result.noise`, the color error with noise, each measure against the noise-free full-color reference.

```ts
export interface FalseColorNoise {
  /** The noise seed of the capture the noisy mosaic comes from. */
  seed: number;
  /** The capture's noisy mosaic (the RAW `simulateCapture` returns at `fast: false` and this seed), demosaiced and developed: demosaic and noise together. */
  withNoise: FalseColorStatistics;
  /** A full-color sensor with noise (each site's three channels drawn independently, through the capture's readout chain), developed without a demosaic: chroma noise alone. */
  noiseOnly: FalseColorStatistics;
  /** The noise-free measure: `chromaDifference` itself. */
  demosaicOnly: FalseColorStatistics;
  /** With `measure.map`: each measure's map (`demosaicOnly` is `result.map`). */
  maps?: { withNoise: NonNullable<FalseColorResult["map"]>; noiseOnly: NonNullable<FalseColorResult["map"]>; demosaicOnly: NonNullable<FalseColorResult["map"]> };
  /** With `measure.images`: the developed images of `withNoise` and `noiseOnly` (sRGB 8-bit RGBA); the reference is `result.images.reference`. */
  images?: { withNoise: Uint8ClampedArray; noiseOnly: Uint8ClampedArray };
  /** Wall-clock milliseconds: the three capture runs (with the extra planes' expected signal), the measure and the whole call. */
  timingsMs: { captures: number; measure: number; total: number };
}
```

## FalseColorResult

Result of `simulateFalseColor`: the demosaic's color error per output pixel, summarized. Not a capture.

```ts
export interface FalseColorResult {
  kind: "false-color";
  label: string;
  facadeVersion: string;
  engineApiVersion: string;
  /** The measured rectangle, in output pixels. */
  width: number;
  height: number;
  region?: { x: number; y: number; width: number; height: number; frameWidth: number; frameHeight: number };
  demosaic: "bilinear" | "ahd";
  /** d = √((a*₁ − a*₂)² + (b*₁ − b*₂)²) per pixel, summarized; the percentiles from a histogram of resolution 0.01 (each the upper edge of its bin, at most the maximum). */
  chromaDifference: {
    pixelCount: number; mean: number; rootMeanSquare: number; median: number; percentile95: number; percentile99: number;
    maximum: number; maximumAt: { x: number; y: number };
    fractionAbove: readonly { threshold: number; fraction: number }[];
  };
  /** Mean CIE 1976 ΔE*ab (lightness included), for context. */
  colorDifference: { meanDeltaE76: number };
  /** Mean CIELAB chroma C*ab of each image: tells a neutral scene from a colored one. */
  meanChroma: { capture: number; reference: number };
  /** `measure.map`: d per pixel (row-major) and a gray image of min(1, d / maximum), sRGB-encoded, alpha 255. */
  map?: { width: number; height: number; maximum: number; values: Float32Array; rgba: Uint8ClampedArray };
  /** `measure.images`: the capture-side and reference images, developed, sRGB 8-bit RGBA. */
  images?: { capture: Uint8ClampedArray; reference: Uint8ClampedArray };
  exposure: DisplayViewResult["exposure"];
  scene: DisplayViewResult["scene"];
  diagnostics: { siteEvaluations: number; sceneLookups: number; timingsMs: { signal: number; measure: number; total: number } };
  provenance: { scientificStatus: "approximation"; cameraPresetId: string; cameraPresetVersion: string; evidence: readonly EvidenceProvenance[]; composedContracts: readonly string[];
    limitations: readonly string[] };
  /** #743: with `measure.noise`, the measures with noise. */
  noise?: FalseColorNoise;
  /** The request's assumptions, then `falseColor.reference`, `falseColor.capture` and `falseColor.metric` (and `falseColor.noise` with `measure.noise`). */
  assumptions: readonly SimulateCaptureAssumption[];
}
```

## FalseColorStatistics

One statistics block of the a*b* difference (`chromaDifference` and each measure of `noise`).

```ts
export type FalseColorStatistics = FalseColorResult["chromaDifference"];
```

## SimulateFalseColorOptions

Measurement options of {@link FalseColorResult} (the second argument of `simulateFalseColor`).

```ts
export interface SimulateFalseColorOptions {
  /** Output-pixel rectangle of the frame to measure. Default: the whole frame. Its values equal the same pixels of the whole frame bit for bit. */
  region?: { x: number; y: number; width: number; height: number };
  /** Up to 8 strictly increasing CIELAB a*b* differences in (0, 200] for `chromaDifference.fractionAbove`. Default [1, 2, 5] (reporting levels; no claim about visibility). */
  thresholds?: readonly number[];
  /** `true` or `{ maximum }`: also return the per-pixel map. `maximum` (default 20, in (0, 200]) is the difference shown as white. */
  map?: boolean | { maximum?: number };
  /** Also return the two developed images (sRGB 8-bit RGBA). Default false. */
  images?: boolean;
  /**
   * #743 (2.29.0): `true` or `{ seed }`: also measure with noise (`result.noise`). `seed` (uint32) replaces `sensor.noiseSeed` for the
   * capture the noisy mosaic comes from. Default off: without it the result is that of 2.28.0, bit for bit.
   */
  noise?: true | { seed?: number };
}
```
