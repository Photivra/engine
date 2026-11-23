# facade/typical-processing.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## SimulateTypicalProcessingInput

Input of `simulateTypicalProcessing`. Each stage is on with its defaults when omitted; `false` turns it off.

```ts
export interface SimulateTypicalProcessingInput {
  /** 1 to 32 identical exposures (same size, CFA, levels and color metadata), as `parseDngRawImage` or `importDngRawImage` returns. */
  frames: readonly ImportedDngRaw[];
  /** `developDngImage`'s white balance, push, tone curve, gamut handling, crop and Orientation. */
  develop?: TypicalProcessingDevelopOptions;
  /** The mean of the frames before the demosaic (default on). `false` takes exactly one frame. */
  merge?: false | { method?: "mean" };
  /** Bilateral noise reduction on linear sRGB: spatial σ in pixels (default 1, at most 64), range σ in linear units (default 0.02). */
  noiseReduction?: false | { spatialSigmaPixels?: number; rangeSigma?: number };
  /**
   * Durand & Dorsey local tone mapping: target base contrast (default 5), spatial σ as a fraction of the longer side (default 0.02),
   * range σ in log₁₀ luminance (default 0.4), and `fast` (registry entry `simulateTypicalProcessing/local-tone-mapping`).
   */
  localToneMapping?: false | { contrast?: number; spatialSigmaFraction?: number; rangeSigma?: number; fast?: boolean };
  /** Saturation gain in linear light, 0 to 4 (default 1.2; 1 leaves color as it is, 0 gives gray). */
  saturation?: false | { gain?: number };
  /** "srgb-8" (default) or "srgb-16". */
  format?: "srgb-8" | "srgb-16";
  /** Speed versus accuracy: the demosaic and WarpRectilinear as in `developDngImage`, and the local tone mapping's base layer. Default from `format`. */
  fast?: boolean;
  /** Bound on the estimated working memory of the stages (default 1 GiB). */
  maximumWorkingBytes?: number;
}
```

## TypicalProcessingDevelopOptions

The development options `simulateTypicalProcessing` passes to `developDngImage`'s chain (its other options keep their defaults).

```ts
export type TypicalProcessingDevelopOptions = Pick<DevelopDngImageOptions, "whiteBalance" | "exposurePushStops" | "toneCurve" | "toneCurveParameters" | "gamutHandling" | "crop" | "orientation">;
```

## TypicalProcessingResult

Result of `simulateTypicalProcessing`.

```ts
export interface TypicalProcessingResult {
  kind: "typical-processing";
  label: "Simulation of typical processing stages; not the processing of a specific device";
  width: number;
  height: number;
  format: "srgb-8" | "srgb-16";
  /** Interleaved sRGB-encoded RGB, row-major, as `developDngImage` returns. */
  samples: Uint8Array | Uint16Array;
  stages: readonly TypicalProcessingStage[];
  /** `applied.demosaic`: the bilinear demosaic ran (else AHD); `applied.localToneMapping`: the fast base layer ran (false when the full one ran or the stage is off). */
  fast: { requested: boolean; defaultedFrom: "request" | "format"; applied: { demosaic: boolean; localToneMapping: boolean } };
  /** `developDngImage`'s assumptions, then this function's (`typicalProcessing.*`, `fast.simulateTypicalProcessing.localToneMapping`). */
  assumptions: readonly string[];
  provenance: { kind: "approximation"; model: "simulate-typical-processing"; modelVersion: "1.0.0"; sources: readonly string[] };
}
```

## TypicalProcessingStage

One stage of a {@link TypicalProcessingResult}, in the order it ran.

```ts
export interface TypicalProcessingStage {
  stage: "merge" | "development" | "noise-reduction" | "local-tone-mapping" | "saturation" | "encoding";
  applied: boolean;
  /** The method, in words ("" for a stage that was turned off). */
  method: string;
  /** The values it ran with. */
  parameters: Readonly<Record<string, number | string | boolean>>;
}
```
