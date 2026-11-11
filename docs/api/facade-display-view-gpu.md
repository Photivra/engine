# facade/display-view-gpu.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## DisplayViewExecution

2.11 (#481): where a display view's render ran, in the words of the image-kernel execution record (`ImageKernelExecution`):
`backend` names the path that ran (`cpu-reference`, the float64 engine reference, or `webgpu-f32`, a float32 approximation
within `errorBound`), `requestedBackend` what `gpu` asked for, and `fallbackReason` why a request for the GPU ran the CPU.
`adapter` describes the device's adapter whenever one was involved, also when the view then fell back; `conformance` is
the device's self-check once it has run. A CPU render keeps `assurance: "engine-reference"` and `fast: false`.

```ts
export interface DisplayViewExecution extends Omit<ImageKernelExecution, "fallbackReason"> {
  /** The `gpu` option the view was prepared with. */
  gpu: DisplayViewGpuMode;
  fallbackReason: DisplayViewGpuFallbackReason | null;
  adapter: ImageKernelAdapterDescription | null;
  conformance: DisplayViewGpuConformance | null;
  /**
   * 2.11: the composite chart kernel's device probe when this render needed it (composite charts, the 2.3 elements and
   * `material-layers` scenes): the device class and the product path the kernel ran with, or, on a refusal (`fallbackReason`
   * `unsupported-on-backend`), why. Null when the render did not run the probe (the 2.0 presets, `gpu: "off"`).
   */
  compositeProbe: ChartCompositeProbeRecord | null;
}
```

## DisplayViewFastReport

2.11 (#481): `diagnostics.fast` of a display view: the capture's report plus where the render ran.

```ts
export interface DisplayViewFastReport extends SimulateCaptureFastReport {
  /** Where this render ran (see {@link DisplayViewExecution}). `assurance` above follows it. */
  execution: DisplayViewExecution;
}
```

## DisplayViewGpuConformance

2.11 (#481): the run-time conformance self-check of a device, run once before the view's first GPU render.

```ts
export interface DisplayViewGpuConformance {
  /** The ids of the cases run, in order (the built-in image-kernel cases, then the renderer's own). */
  cases: readonly string[];
  passed: boolean;
  /** The first case that failed, or null. */
  failedCase: string | null;
  /** What the failed case reported, or null. */
  detail: string | null;
}
```

## DisplayViewGpuFallbackReason

2.11 (#481): why a display view that asked for the GPU (`gpu: "auto"`) ran the CPU reference. The accelerator's acquisition
reasons, plus: `unsupported-on-backend` (no GPU display-view renderer exists in this version, or it does not support the
request), `conformance-failed` (the device failed the run-time self-check before the view's first GPU render), `device-lost`
(the device was lost; the rest of the view runs on the CPU) and `disposed` (the prepared view was disposed). 2.22.0 (#594):
`quality-code-unavailable` (the on-demand GPU full-quality code could not be loaded; that render runs the CPU reference, and
the next render that needs the code tries to load it again).

```ts
export type DisplayViewGpuFallbackReason = ImageKernelFallbackReason | "unsupported-on-backend" | "conformance-failed" | "device-lost" | "disposed" |
  "quality-code-unavailable";
```

## DisplayViewGpuMode

2.11 (#481): whether a prepared display view may render on the GPU. `"off"` (the default) is the CPU reference, today's
behaviour byte for byte. `"auto"` renders on WebGPU when a conforming device is available and the request is supported, and
otherwise runs the CPU reference and says why. `"require"` fails instead of falling back. In the accelerator's words: `"auto"`
is `backend: "webgpu-f32"` with `fallback: "cpu-reference"`, `"require"` is `fallback: "fail"`, `"off"` is `backend: "cpu-reference"`.

```ts
export type DisplayViewGpuMode = "off" | "auto" | "require";
```

## PrepareDisplayViewOptions

2.11 (#481): the second argument of `prepareDisplayView`.

```ts
export interface PrepareDisplayViewOptions {
  /**
   * See {@link DisplayViewGpuMode}. 2.20.0: default `"auto"` when the request resolves to fast (`fast` omitted or true: the
   * display view's default) and `"off"` when it is exact (`fast: false`); an explicit value wins.
   */
  gpu?: DisplayViewGpuMode;
  /**
   * Where the device comes from, with `gpu: "auto"` or `"require"`: a WebGPU entry point (a worker's `navigator.gpu`), or an
   * `ImageKernelAccelerator` whose device the view shares (the accelerator keeps ownership; `dispose()` of the prepared view
   * leaves it alone). Without it the engine acquires a device from `globalThis.navigator.gpu` and owns it until `dispose()`.
   * Refused when `gpu` is or defaults to `"off"`.
   */
  gpuDevice?: unknown;
}
```
