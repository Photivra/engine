# facade/simulate-display-view.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## PreparedDisplayView

2.7: a display-view request resolved once (`prepareDisplayView`). `render(view)` gives the same result as
`simulateDisplayView(options, view)` for the prepared options, byte for byte (samples, view, exposure, scene, diagnostics
and assumptions; only `diagnostics.timingsMs` differ, and they cover the render only), without repeating the request's
setup: use it to render one view in many regions, for example on each worker of a progressive display.

```ts
export interface PreparedDisplayView {
  /**
   * Renders a view of the prepared request. Renders may run concurrently; they share no state except read-only setup. With `gpu: "auto"`
   * or `"require"` (#481) GPU renders of one prepared view run one at a time on its device, and `diagnostics.fast.execution`
   * says whether the GPU or the CPU reference rendered the view, and why.
   */
  render(view: SimulateDisplayViewOptions, renderOptions?: PreparedDisplayViewRenderOptions): Promise<DisplayViewResult>;
  /**
   * 2.11 (#481): releases the WebGPU device the view acquired (none with `gpu: "off"`, or when `gpuDevice` gave an accelerator,
   * whose device its owner keeps). Later renders run the CPU reference labelled `fallbackReason: "disposed"` (`"auto"`) or fail
   * with that reason (`"require"`). Idempotent.
   */
  dispose(): void;
  /**
   * 2.10 (#447), deprecated in 2.22.0: was the key of this request's AHD low-signal correction states. The view has no such
   * states since 2.22.0 (docs/DISPLAY_VIEW.md, "AHD at low signal"), so this returns null for every request.
   * @deprecated Since 2.22.0: always null. Removed in 3.0.0.
   */
  correctionKey(): string | null;
  /**
   * 2.10 (#447), deprecated in 2.22.0: was the grid keys of the correction states a render of `view` read. Since 2.22.0 it checks
   * `view` as `render` does and returns `{ key: "", gridKeys }` with no grid keys, for every request; it renders nothing.
   * @deprecated Since 2.22.0: returns no grid keys. Removed in 3.0.0.
   */
  collectCorrectionStates(view: SimulateDisplayViewOptions, renderOptions?: PreparedDisplayViewRenderOptions): Promise<DisplayViewCorrectionStateKeys>;
  /**
   * 2.10 (#447), deprecated in 2.22.0: computed correction states. Since 2.22.0 it checks that `gridKeys` is an Int32Array of
   * grid keys (integers in [0, 97³)) and returns `{ key: "", gridKeys, values }` with no states, for every request; it computes nothing.
   * @deprecated Since 2.22.0: returns no states. Removed in 3.0.0.
   */
  computeCorrectionStates(gridKeys: Int32Array, renderOptions?: PreparedDisplayViewRenderOptions): Promise<DisplayViewCorrectionStateSet>;
}
```

## PreparedDisplayViewRenderOptions

Options of one {@link PreparedDisplayView} render.

```ts
export interface PreparedDisplayViewRenderOptions {
  /** Aborting cancels this render only; the promise rejects with a domain error. The request's own `signal` applies to preparing only. */
  signal?: AbortSignal;
}
```

## prepareDisplayView

2.7 (#387): resolves a {@link simulateDisplayView} request once, without a view, and returns a handle whose `render(view)`
renders its views. The setup it does once (request validation, the camera, lens, scene, chart and illuminant, the channel
responses through the environment chain, the diffraction kernels, readout moments, demosaic tables and colour matrix) costs
about 0.3–1.3 s per call on a 24 MP request; a region costs only its own pixels. Errors in the request are raised here;
errors in the view by `render`.

2.11 (#481): `prepareOptions.gpu` chooses the renderer: `"off"` is the CPU reference, today's bytes; `"auto"` renders
on WebGPU when a conforming device is available and the request is supported, else on the CPU, labelled; `"require"` fails
instead of falling back (`ImageKernelExecutionError`, acquisition failures here, later ones from `render`). 2.20.0: the default is
`"auto"` when the request resolves to fast (the view's default) and `"off"` with `fast: false`. `gpuDevice` is a
WebGPU entry point or an `ImageKernelAccelerator` whose device the view shares; without it the engine acquires one device
for the prepared view (the request's `signal` aborts the acquisition) and `dispose()` releases it. The realm's
`setWebGpuEnabled(false)` vetoes both GPU modes (`webgpu-disabled`). See docs/DISPLAY_VIEW.md, "Rendering on the GPU".

```ts
export async function prepareDisplayView(options: SimulateCaptureOptions, prepareOptions?: PrepareDisplayViewOptions): Promise<PreparedDisplayView>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## simulateDisplayView

The display view of a capture request: the image the real full-resolution capture (`simulateCapture(options)`) would
give after it is resized to `view.width` × `view.height` by area averaging in linear light, estimated at a cost that
follows the display pixels, not the capture's. Optics (lens diffraction, the anti-aliasing filter, the pixel aperture)
act at the real pixel pitch; the colour mosaic, demosaic and development are those of the real pixels; the noise is
that of the average of the real pixels, demosaic correlation included; exposure, white balance and tone are the
capture's. The result is labelled `kind: "display-view"`; it is not a capture.

```ts
export async function simulateDisplayView(options: SimulateCaptureOptions, view: SimulateDisplayViewOptions): Promise<DisplayViewResult>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.
