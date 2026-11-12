# output/native-capture-sdr.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateNativeCaptureSdrPlan

Validates the input and plans the task, including its limits, without reading samples or allocating an image.

```ts
export function calculateNativeCaptureSdrPlan(input: NativeCaptureSdrInput): NativeCaptureSdrPlan;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createNativeCaptureSdrTask

Creates a single-use task. Limits are checked before any buffer is allocated or tile is read.

```ts
export function createNativeCaptureSdrTask(input: NativeCaptureSdrInput, provider: NativeCaptureSdrProvider): NativeCaptureSdrTask;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## NATIVE_CAPTURE_SDR_LIMITS

`maximumPixels` is the default pixel limit; a request may raise it with its own `maximumPixels`, up to `ceilingPixels`.

```ts
NATIVE_CAPTURE_SDR_LIMITS = Object.freeze({ maximumPixels: 24_000_000, ceilingPixels: FULL_RESOLUTION_CEILING_PIXELS,
  maximumDimension: 16_384, tileWidth: 256, tileHeight: 32, maximumTileStorageSamples: 32_768 })
```

## NATIVE_CAPTURE_SDR_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
NATIVE_CAPTURE_SDR_SCHEMA_VERSION = "0.1.0" as const
```

## NativeCaptureSdrInput

Input. The capture holds only metadata; float samples are read from external storage. Samples must already have colour and white balance applied.

```ts
export interface NativeCaptureSdrInput {
  capture: SimulatedCapture;
  sourcePlaneId: string;
  outputImageStateId: string;
  profile: SdrRenderingProfile;
  /** Limit on the size of the integer output. Checked before anything is allocated or any tile is read. */
  maximumOutputBytes: number;
  /**
   * Optional opt-in pixel limit for large captures: an integer from 1 to `NATIVE_CAPTURE_SDR_LIMITS.ceilingPixels`.
   * Default `NATIVE_CAPTURE_SDR_LIMITS.maximumPixels` (24 000 000). `maximumOutputBytes` still applies.
   */
  maximumPixels?: number;
}
```

## NativeCaptureSdrOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeCaptureSdrOutput {
  plan: NativeCaptureSdrPlan;
  /** Packed RGB codes in row-major order, owned by the caller. 16-bit codes are numbers, not bytes in a particular byte order. */
  integerSamples: Uint8Array | Uint16Array;
  diagnostics: SdrRenderingResult["diagnostics"];
  outputEncoding: SdrRenderingResult["outputEncoding"];
  displayAdaptation: SdrRenderingResult["displayAdaptation"];
}
```

## NativeCaptureSdrPlan

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeCaptureSdrPlan {
  schemaVersion: typeof NATIVE_CAPTURE_SDR_SCHEMA_VERSION;
  capture: SimulatedCapture;
  sourcePlaneId: string;
  outputImageStateId: string;
  profile: SdrRenderingProfile;
  outputBytes: number;
  /** Upper bound on the bytes held in working arrays. It is not peak JavaScript heap, GPU or process memory, and does not show that a device can run the task. */
  maximumScratchPayloadBytes: number;
  tileCount: number;
}
```

## NativeCaptureSdrProvider

Supplies tiles, one call at a time. The caller must release decoder and GPU resources when the task aborts or finishes.

```ts
export interface NativeCaptureSdrProvider {
  readTile(request: Readonly<NativeCaptureSdrTileRequest>, signal: AbortSignal): Promise<NativeCaptureSdrTile>;
  /** Must yield to the host event loop, so cancellation and input events can run between tiles. */
  yieldControl(signal: AbortSignal): Promise<void>;
  /**
   * Optional progress observer, called synchronously after each committed tile. It cannot change
   * output; an exception it throws fails the task like any other error.
   */
  onProgress?(progress: NativeTaskProgress): void;
}
```

## NativeCaptureSdrTask

A single-use task. No partial output is ever returned, and cancel or dispose stops a late result from being published.

```ts
export interface NativeCaptureSdrTask {
  readonly plan: NativeCaptureSdrPlan;
  readonly state: NativeCaptureSdrTaskState;
  readonly completedTileCount: number;
  run(): Promise<void>;
  cancel(): void;
  dispose(): void;
  /** Hands over the only copy of the output buffer, once. Dispose cannot take back a buffer already handed over. */
  takeOutput(): NativeCaptureSdrOutput;
}
```

## NativeCaptureSdrTaskState

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type NativeCaptureSdrTaskState = "ready" | "running" | "completed" | "cancelled" | "failed" | "disposed" | "transferred";
```

## NativeCaptureSdrTile

A tile returned by the provider. It belongs to this call alone; do not change or reuse it. Row padding is not image data.

```ts
export interface NativeCaptureSdrTile extends NativeCaptureSdrTileRequest {
  rowStrideSamples: number;
  samples: Float32Array | Float64Array;
}
```

## NativeCaptureSdrTileRequest

Tile request. Coordinates are absolute in the selected plane's declared pixel grid, never relative to a crop.

```ts
export interface NativeCaptureSdrTileRequest {
  captureId: string;
  sourcePlaneId: string;
  artifactId: string;
  sha256: string;
  x: number; y: number; width: number; height: number;
}
```

## NativeTaskProgress

Tile progress of a native task: `completedTileCount` of `totalTileCount` tiles are committed.

```ts
export interface NativeTaskProgress { readonly completedTileCount: number; readonly totalTileCount: number }
```
