# gpu/image-kernel-accelerator.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AcceleratedNativeCaptureSdrOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AcceleratedNativeCaptureSdrOutput extends NativeCaptureSdrOutput { execution: ImageKernelExecution }
```

## AcceleratedNativeRawDevelopmentOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AcceleratedNativeRawDevelopmentOutput extends NativeRawDevelopmentOutput { execution: ImageKernelExecution }
```

## AcceleratedPackedSensorRawResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AcceleratedPackedSensorRawResult extends PackedSensorRawResult {
  execution: ImageKernelExecution;
  /**
   * Region-relative indices of the flagged sites, ascending (empty for `cpu-reference`). Every other site
   * equals the reference; recomputing these sites with the reference makes the whole region bit-identical.
   */
  flaggedSiteIndices: Uint32Array;
}
```

## ChartRadianceResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ChartRadianceResult {
  plan: ChartRadianceBatchPlan;
  /** Row-major (query, column): float64 for `cpu-reference`, float32 for `webgpu-f32`. */
  values: Float64Array | Float32Array;
  columns: number;
  execution: ImageKernelExecution;
  /**
   * Queries whose float32 classification fell inside its bound, recomputed on the host with the
   * reference (then rounded to float32). Empty for `cpu-reference`.
   */
  hostRecomputedQueryIndices: Uint32Array;
}
```

## createImageKernelAccelerator

Requests a backend. Never swaps backends silently: a fallback must be set in the options and is shown in every result label.

```ts
export async function createImageKernelAccelerator(options: ImageKernelAcceleratorOptions): Promise<ImageKernelAccelerator>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## ImageKernelAccelerator

Runs one operation at a time. dispose() releases the device and every buffer.

```ts
export interface ImageKernelAccelerator {
  readonly backend: ImageKernelBackend;
  readonly requestedBackend: ImageKernelBackend;
  readonly fallbackReason: ImageKernelFallbackReason | null;
  /** #481: the adapter of a `webgpu-f32` accelerator's device (null for `cpu-reference`, or when the browser gives no `GPUAdapter.info`). */
  readonly adapter: ImageKernelAdapterDescription | null;
  readonly state: ImageKernelAcceleratorState;
  renderNativeCaptureSdr(input: NativeCaptureSdrInput, provider: NativeCaptureSdrProvider, options?: ImageKernelRunOptions): Promise<AcceleratedNativeCaptureSdrOutput>;
  /** Takes ownership of `input.raw` exactly like `createNativeRawDevelopmentTask` (the caller's arrays are detached). */
  developNativeRaw(input: NativeRawDevelopmentInput, provider: NativeRawDevelopmentProvider | ((signal: AbortSignal) => Promise<void>),
    options?: ImageKernelRunOptions): Promise<AcceleratedNativeRawDevelopmentOutput>;
  convolveIrradiance(input: IrradianceConvolutionInput, options?: ImageKernelRunOptions): Promise<IrradianceConvolutionResult>;
  /** Sensor stage on typed arrays: seeded charge, read noise and ADC to RAW codes (see `simulatePackedSensorRaw`). */
  simulateSensorRaw(input: PackedSensorRawInput, options?: ImageKernelRunOptions): Promise<AcceleratedPackedSensorRawResult>;
  /** Exposure and motion as a weighted sum of shifted frames (see `calculateTemporalExposureSum`). */
  sumTemporalExposure(input: TemporalExposureSumInput, options?: ImageKernelRunOptions): Promise<TemporalExposureSumResult>;
  /** Chart scene radiance or its spectral integral at many frame points (see `calculateChartRadianceBatch`). */
  evaluateChartRadiance(input: ChartRadianceBatchInput, options?: ImageKernelRunOptions): Promise<ChartRadianceResult>;
  dispose(): void;
}
```

## ImageKernelAcceleratorOptions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImageKernelAcceleratorOptions {
  /**
   * The one-boolean form. `true` is `backend: "webgpu-f32"` with `fallback: "cpu-reference"` unless `fallback` is given;
   * `false` is `backend: "cpu-reference"`. Give `webgpu` or `backend`, not both.
   */
  webgpu?: boolean;
  /** Requested backend. `cpu-reference` is the reference and never touches WebGPU. Required unless `webgpu` is given. */
  backend?: ImageKernelBackend;
  /** Required with `backend: "webgpu-f32"`: use the CPU reference (labelled) or fail when WebGPU cannot be acquired. */
  fallback?: "cpu-reference" | "fail";
  /** WebGPU entry point; defaults to `navigator.gpu`. Supply a worker's `navigator.gpu` explicitly if needed. */
  gpu?: unknown;
  powerPreference?: "low-power" | "high-performance";
  /** Largest single GPU band buffer in bytes (4 KiB up to the device limit); default min(64 MiB, device limit). Affects memory only, never results. */
  maximumBandBytes?: number;
  /** Aborts adapter/device acquisition. */
  signal?: AbortSignal;
}
```

## ImageKernelAcceleratorState

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ImageKernelAcceleratorState = "ready" | "lost" | "disposed";
```

## ImageKernelRunOptions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImageKernelRunOptions {
  signal?: AbortSignal;
  /** Yields to the host event loop between CPU reference chunks and GPU bands. Convolution, sensor and temporal stages; tasks keep their own yields. */
  yieldControl?: (signal: AbortSignal) => Promise<void>;
}
```

## IrradianceConvolutionResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IrradianceConvolutionResult {
  plan: IrradianceConvolutionPlan;
  /** Float64 for `cpu-reference`, float32 for `webgpu-f32`; row-major, same grid as the input. */
  values: Float64Array | Float32Array;
  /** Float64 sums of the input and output samples. Their difference is the amount lost across the grid edge. */
  inputSum: number;
  outputSum: number;
  execution: ImageKernelExecution;
}
```

## TemporalExposureSumResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface TemporalExposureSumResult {
  plan: TemporalExposureSumPlan;
  /** Float64 for `cpu-reference`, float32 for `webgpu-f32`; row-major, same grid as the input. */
  values: Float64Array | Float32Array;
  execution: ImageKernelExecution;
}
```
