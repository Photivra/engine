# core/execution-error.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ImageKernelExecutionError

Domain error for getting and running a backend. Input validation still throws the engine's existing errors.

```ts
export class ImageKernelExecutionError extends Error {
  readonly code = "IMAGE_KERNEL_EXECUTION";
  readonly reason: ImageKernelFailureReason;

  constructor(reason: ImageKernelFailureReason, message: string) {
    super(message);
    this.name = "ImageKernelExecutionError";
    this.reason = reason;
  }
}
```

## ImageKernelFailureReason

Failure classes reported by {@link ImageKernelExecutionError}. `conformance-failed` (#481): a device failed the display view's
run-time self-check with `gpu: "require"`. `quality-code-unavailable` (2.22.0, #594): on-demand full-quality code could not be
loaded (for example a failed chunk download); `prepareQualityPaths()` rejects with it, a display-view render with `gpu: "require"`
fails with it (with `gpu: "auto"` it runs the CPU reference), and a CPU request whose full-quality or opt-in code does not load
fails with it (nothing is remembered: the next request tries again).

```ts
export type ImageKernelFailureReason = ImageKernelFallbackReason | "device-lost" | "out-of-memory" | "gpu-validation" |
  "aborted" | "disposed" | "busy" | "unsupported-on-backend" | "unsupported-float32-domain" | "indeterminate-float32-classification" | "conformance-failed" |
  "quality-code-unavailable";
```

## ImageKernelFallbackReason

Why a requested `webgpu-f32` backend ran the CPU reference instead. `webgpu-disabled`: `setWebGpuEnabled(false)` in this realm.

```ts
export type ImageKernelFallbackReason = "webgpu-unavailable" | "webgpu-disabled" | "adapter-unavailable" | "device-request-failed" |
  "insufficient-limits" | "unsupported-platform-endianness";
```
