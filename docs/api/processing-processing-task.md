# processing/processing-task.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES

Default working-memory bound when `maximumWorkingBytes` is omitted (1 GiB).

```ts
PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES = 1 << 30
```

## PROCESSING_MAX_FRAMES

Largest number of input frames (brackets, focus slices, panorama frames).

```ts
PROCESSING_MAX_FRAMES = 32
```

## PROCESSING_MAX_PIXELS

Largest image (pixels per frame) any processing operator accepts.

```ts
PROCESSING_MAX_PIXELS = 1 << 26
```

## PROCESSING_MODEL_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PROCESSING_MODEL_VERSION = "1.0.0" as const
```

## ProcessingLinearColorSpace

Linear RGB encodings the colour-aware operators accept (all D65).

```ts
export type ProcessingLinearColorSpace = "linear-srgb-d65" | "linear-display-p3-d65" | "linear-rec2020-d65";
```

## ProcessingProvenance

Result provenance of a processing operator; processing outputs are never calibrated.

```ts
export interface ProcessingProvenance extends CalculationProvenance {
  kind: "approximation";
  assumptions: readonly string[];
}
```

## ProcessingProvider

Host hooks, the same shape as the native task providers.

```ts
export interface ProcessingProvider {
  /** Must yield to the host event loop, allowing cancellation/input events between rows. */
  yieldControl(signal: AbortSignal): Promise<void>;
  /** Optional observer called after each processed row of each pass; cannot change output. */
  onProgress?(progress: NativeTaskProgress): void;
}
```

## ProcessingRgbImage

Interleaved RGB image: `data[(y·width + x)·3 + c]`, row-major, +Y down.

```ts
export interface ProcessingRgbImage {
  width: number;
  height: number;
  data: Float32Array;
}
```

## ProcessingTask

Single-use cancellable processing task.

```ts
export interface ProcessingTask<T> {
  readonly state: ProcessingTaskState;
  /** Rows processed so far across every pass. */
  readonly completedTileCount: number;
  /** Total rows of every pass; known before `run()`. */
  readonly totalTileCount: number;
  /** Upper estimate of typed-array bytes allocated by the task, including its output. */
  readonly estimatedWorkingBytes: number;
  run(): Promise<void>;
  cancel(): void;
  dispose(): void;
  takeOutput(): T;
}
```

## ProcessingTaskState

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ProcessingTaskState = "ready" | "running" | "completed" | "cancelled" | "failed" | "disposed" | "transferred";
```
