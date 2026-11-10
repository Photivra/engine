// SPDX-License-Identifier: Apache-2.0

/**
 * #481: how a prepared display view chooses between a WebGPU preview renderer and the CPU reference, and how a render labels
 * which ran. This module holds the option, the label and the renderer contract and imports nothing from the GPU code, so a
 * bundle that never asks for the GPU (`gpu: "off"`, the default) does not contain it; the device handling lives in
 * `display-view-gpu-session.ts`, loaded on demand by `prepareDisplayView` when `gpu` is `"auto"` or `"require"`.
 *
 * The vocabulary is the image-kernel accelerator's (`createImageKernelAccelerator`, docs/WEBGPU.md): `"auto"` is
 * `backend: "webgpu-f32"` with `fallback: "cpu-reference"`, `"require"` is `fallback: "fail"`, `"off"` is
 * `backend: "cpu-reference"`. The render's `diagnostics.fast.execution` names the backend that ran, the fallback reason and the
 * bound in the fields of `ImageKernelExecution`, plus the adapter and the run-time conformance check.
 *
 * No GPU display-view renderer exists yet (#478, #479): until one registers itself through {@link setDisplayViewGpuRendererFactory},
 * `"auto"` runs the CPU reference labelled `unsupported-on-backend` without touching a device, and `"require"` fails with that reason.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { ChartCompositeProbeRecord, ImageKernelAdapterDescription, ImageKernelBackend, ImageKernelExecution, ImageKernelFallbackReason } from "../gpu/image-kernel-execution.js";
import type { DisplayViewRenderResult, DisplayViewSetup } from "./display-view.js";
import type { SimulateCaptureFastReport } from "./simulate-capture.js";

/**
 * 2.11 (#481): whether a prepared display view may render on the GPU. `"off"` (the default) is the CPU reference, today's
 * behaviour byte for byte. `"auto"` renders on WebGPU when a conforming device is available and the request is supported, and
 * otherwise runs the CPU reference and says why. `"require"` fails instead of falling back. In the accelerator's words: `"auto"`
 * is `backend: "webgpu-f32"` with `fallback: "cpu-reference"`, `"require"` is `fallback: "fail"`, `"off"` is `backend: "cpu-reference"`.
 */
export type DisplayViewGpuMode = "off" | "auto" | "require";

/** 2.11 (#481): the second argument of `prepareDisplayView`. */
export interface PrepareDisplayViewOptions {
  /** See {@link DisplayViewGpuMode}. Default `"off"`. */
  gpu?: DisplayViewGpuMode;
  /**
   * Where the device comes from, with `gpu: "auto"` or `"require"`: a WebGPU entry point (a worker's `navigator.gpu`), or an
   * `ImageKernelAccelerator` whose device the view shares (the accelerator keeps ownership; `dispose()` of the prepared view
   * leaves it alone). Without it the engine acquires a device from `globalThis.navigator.gpu` and owns it until `dispose()`.
   * Refused with `gpu: "off"`.
   */
  gpuDevice?: unknown;
}

/** The parsed form of {@link PrepareDisplayViewOptions}. @internal */
export interface ParsedPrepareDisplayViewOptions { gpu: DisplayViewGpuMode; gpuDevice: unknown }

/** Internal: validates the second argument of `prepareDisplayView`. */
export function parsePrepareDisplayViewOptions(value: unknown): ParsedPrepareDisplayViewOptions {
  if (value === undefined) return { gpu: "off", gpuDevice: undefined };
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidConfigurationError("prepareDisplayView options must be an object { gpu, gpuDevice }.");
  for (const key of Object.keys(value)) if (key !== "gpu" && key !== "gpuDevice") throw new InvalidConfigurationError("Unknown prepareDisplayView options field: " + key + ".");
  const { gpu, gpuDevice } = value as Record<string, unknown>;
  const mode: DisplayViewGpuMode = gpu === undefined ? "off" : gpu as DisplayViewGpuMode;
  if (mode !== "off" && mode !== "auto" && mode !== "require") throw new InvalidConfigurationError("prepareDisplayView options.gpu must be \"off\", \"auto\" or \"require\".");
  if (gpuDevice !== undefined && (typeof gpuDevice !== "object" || gpuDevice === null)) throw new InvalidConfigurationError("prepareDisplayView options.gpuDevice must be a WebGPU entry point (navigator.gpu) or an ImageKernelAccelerator.");
  if (gpuDevice !== undefined && mode === "off") throw new InvalidConfigurationError("prepareDisplayView options.gpuDevice needs gpu \"auto\" or \"require\".");
  return { gpu: mode, gpuDevice };
}

/**
 * 2.11 (#481): why a display view that asked for the GPU (`gpu: "auto"`) ran the CPU reference. The accelerator's acquisition
 * reasons, plus: `unsupported-on-backend` (no GPU display-view renderer exists in this version, or it does not support the
 * request), `conformance-failed` (the device failed the run-time self-check before the view's first GPU render), `device-lost`
 * (the device was lost; the rest of the view runs on the CPU) and `disposed` (the prepared view was disposed).
 */
export type DisplayViewGpuFallbackReason = ImageKernelFallbackReason | "unsupported-on-backend" | "conformance-failed" | "device-lost" | "disposed";

/** 2.11 (#481): the run-time conformance self-check of a device, run once before the view's first GPU render. */
export interface DisplayViewGpuConformance {
  /** The ids of the cases run, in order (the built-in image-kernel cases, then the renderer's own). */
  cases: readonly string[];
  passed: boolean;
  /** The first case that failed, or null. */
  failedCase: string | null;
  /** What the failed case reported, or null. */
  detail: string | null;
}

/**
 * 2.11 (#481): where a display view's render ran, in the words of the image-kernel execution record (`ImageKernelExecution`):
 * `backend` names the path that ran (`cpu-reference`, the float64 engine reference, or `webgpu-f32`, a float32 approximation
 * within `errorBound`), `requestedBackend` what `gpu` asked for, and `fallbackReason` why a request for the GPU ran the CPU.
 * `adapter` describes the device's adapter whenever one was involved, also when the view then fell back; `conformance` is
 * the device's self-check once it has run. A CPU render keeps `assurance: "engine-reference"` and `fast: false`.
 */
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

/** 2.11 (#481): `diagnostics.fast` of a display view: the capture's report plus where the render ran. */
export interface DisplayViewFastReport extends SimulateCaptureFastReport {
  /** Where this render ran (see {@link DisplayViewExecution}). `assurance` above follows it. */
  execution: DisplayViewExecution;
}

const CPU_LIMITATIONS = /* @__PURE__ */ Object.freeze(["Float64 engine reference execution; results are the reference by definition"]);

/** Internal: the execution record of a display view rendered on the CPU reference. `requested` names what `gpu` asked for. */
export function cpuDisplayViewExecution(gpu: DisplayViewGpuMode, fallbackReason: DisplayViewGpuFallbackReason | null, adapter: ImageKernelAdapterDescription | null,
  conformance: DisplayViewGpuConformance | null, detail?: string, compositeProbe: ChartCompositeProbeRecord | null = null): DisplayViewExecution {
  const requestedBackend: ImageKernelBackend = gpu === "off" ? "cpu-reference" : "webgpu-f32";
  const limitations = detail === undefined ? CPU_LIMITATIONS : Object.freeze([...CPU_LIMITATIONS, "WebGPU was requested (gpu: \"" + gpu + "\") and the CPU reference ran: " + detail]);
  return Object.freeze({ gpu, backend: "cpu-reference", requestedBackend, fallbackReason, arithmetic: "float64", assurance: "engine-reference", fast: false,
    bitIdenticalToReference: true, errorBound: null, diagnosticsExact: true, diagnosticUncertaintySampleCount: 0, limitations, adapter, conformance, compositeProbe });
}

// ---------------------------------------------------------------------------------------------------------------
// The renderer contract (#478 implements it; until then the only implementation is a test fake).

/**
 * Internal (#481): the device a renderer or conformance case runs on. It is the engine's `WebGpuRuntime` object
 * (`src/gpu/webgpu-runtime.ts`: `device`, `guard`, `destroy` and the rest), seen here through its WebGPU-free members only so
 * that no WebGPU type reaches the published declarations (docs/WEBGPU.md); a renderer in the engine casts it to `WebGpuRuntime`.
 */
export interface DisplayViewGpuRuntimeHandle {
  readonly adapter: ImageKernelAdapterDescription | null;
  readonly maximumStorageBindingBytes: number;
  readonly maximumWorkgroupsPerDimension: number;
  isLost(): boolean;
}

/** What a prepared request asks of a GPU renderer (`supports`): the options that shape a render. */
export interface DisplayViewGpuRequest {
  ahd: boolean;
  diffraction: boolean;
  antiAliasing: boolean;
  /** Pixel-aperture samples per axis (1: centre sampling). */
  boxSamples: number;
  toneCurve: "identity" | "positive-reinhard-per-channel";
  /**
   * #492: true when `lens.defocus` needs the defocus disc (out of focus): the expected signal then carries the disc, or each
   * node's diffraction kernel convolved with it, as site kernels (#492 step 2b), which the engine's renderer gathers in its
   * Quality site pass (step 2c). Absent or false otherwise.
   */
  defocus?: boolean;
  /**
   * #564: true when the defocus kernel's radius is above 64 sites, so the expected signal convolves it by runs on the CPU
   * (`largeKernel`); no GPU renderer takes it. Absent or false otherwise.
   */
  largeDefocus?: boolean;
  /**
   * #563: true when the request has `lens.projection`, `lens.distortion`, `lens.vignetting` or camera rotation: the CPU reference
   * renders it (display-view-lens-signal.ts) and no GPU renderer is asked or device requested (`unsupported-on-backend`).
   */
  lens?: boolean;
  /** The scene's form: an engine chart, a declared `material-layers` scene (#491), or a caller function. */
  scene: "chart" | "material-layers" | "material-function" | "reflectance-function" | "radiance-function" | "image-plane";
}
/** One render of a region: the CPU renderer's own setup (tables, readout, demosaic, region, callbacks) and the render's signal. */
export interface DisplayViewGpuPart { setup: DisplayViewSetup; signal: AbortSignal | undefined }
/** What a GPU render returns: the CPU renderer's result shape plus the a-priori bound of its values against the reference. */
export interface DisplayViewGpuRenderOutput extends DisplayViewRenderResult {
  errorBound: NonNullable<ImageKernelExecution["errorBound"]>;
  /** Samples whose float32 classification fell inside its bound (0 when none). */
  diagnosticUncertaintySampleCount?: number;
  /** The composite chart kernel's device probe record, when the render used the composite material module. */
  compositeProbe?: ChartCompositeProbeRecord;
}
/** A conformance case: returns `true` when the device agrees with the reference within the case's bound, or a sentence saying how it did not. */
export interface DisplayViewGpuConformanceCase { id: string; run(runtime: DisplayViewGpuRuntimeHandle, signal: AbortSignal | undefined): Promise<true | string> }
/**
 * Internal (#481): the contract a GPU display-view renderer fulfils (#478). One instance serves one device, created by the
 * registered factory for each prepared view that acquires or shares a device. `supports` says whether the renderer covers a
 * prepared request (`true`) or why not (a sentence; the view then runs the CPU reference labelled `unsupported-on-backend`).
 * `render` renders one region on the device and must throw `ImageKernelExecutionError` with reason `device-lost` or `aborted`
 * for those two events, as the accelerator's operations do; a render that throws `unsupported-on-backend` (a request the
 * renderer finds it does not cover only when rendering) runs the CPU reference labelled with that reason, or fails with it under
 * `"require"`. `conformanceCases` are run after the built-in image-kernel cases before the device's first render; a failure keeps
 * the whole view on the CPU. `dispose` releases what the renderer holds on the device (#491: uploaded scene records); the session
 * calls it when the prepared view is disposed.
 */
export interface DisplayViewGpuRenderer {
  readonly id: string;
  supports(request: DisplayViewGpuRequest): true | string;
  render(part: DisplayViewGpuPart): Promise<DisplayViewGpuRenderOutput>;
  readonly conformanceCases?: readonly DisplayViewGpuConformanceCase[];
  dispose?(): void;
}
export type DisplayViewGpuRendererFactory = (runtime: DisplayViewGpuRuntimeHandle) => DisplayViewGpuRenderer;

let rendererFactory: DisplayViewGpuRendererFactory | null = null;
/**
 * Internal (#481): registers the renderer that `prepareDisplayView` uses for `gpu: "auto" | "require"`, and returns the one
 * registered before (null: none). #478's renderer registers itself here; tests register a fake. With none registered no device
 * is requested and every GPU request falls back (or fails) with `unsupported-on-backend`.
 */
export function setDisplayViewGpuRendererFactory(factory: DisplayViewGpuRendererFactory | null): DisplayViewGpuRendererFactory | null {
  if (factory !== null && typeof factory !== "function") throw new InvalidConfigurationError("setDisplayViewGpuRendererFactory expects a function or null.");
  const previous = rendererFactory;
  rendererFactory = factory;
  return previous;
}
/** Internal: the registered factory. */
export function displayViewGpuRendererFactory(): DisplayViewGpuRendererFactory | null { return rendererFactory; }
