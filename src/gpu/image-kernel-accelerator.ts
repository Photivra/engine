// SPDX-License-Identifier: Apache-2.0

/**
 * Optional image-kernel accelerator (#277). One object runs work on the execution backend the caller
 * asks for.
 * - `cpu-reference` uses the unchanged float64 engine code.
 * - `webgpu-f32` runs the project's own WGSL (WebGPU shader) kernels for the heaviest per-pixel loops.
 *   Every result is labelled as a float32 approximation, with an error bound worked out in advance.
 * A requested WebGPU backend falls back to the CPU only if the caller chose
 * `fallback: "cpu-reference"`. The result label then names the backend that actually ran, and why.
 * The simple form `{ webgpu: true | false }` chooses the backend with one boolean, and `setWebGpuEnabled(false)`
 * (webgpu-switch.ts) keeps the whole realm on the CPU whatever callers ask. See docs/WEBGPU.md.
 */
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { getWebGpuEnabled } from "./webgpu-switch.js";
import { InvalidScientificResultError } from "../core/validation.js";
import { requireAllowlistedRecord } from "../core/record-validation.js";
import { createHostYieldGate } from "../capture/host-yield-cadence.js";
import { checkNativeRawIntegrity, createNativeRawDevelopmentTask, prepareNativeRawDevelopment, takeNativeRawOwnership,
  type NativeRawDevelopmentInput, type NativeRawDevelopmentOutput, type NativeRawDevelopmentProvider, type RawHighlightDiagnostics } from "../capture/native-raw-development.js";
import type { NativeRawOutput } from "../capture/native-raw.js";
import { resolveCaptureColorModel } from "../color/capture-color.js";
import { RAW_HIGHLIGHT_RECONSTRUCTION_START } from "../color/sensor-color-development.js";
import { transformOrientedRasterPointToNative } from "../output/capture-geometry.js";
import type { SdrRenderingProfile, SdrRenderingResult } from "../output/sdr-rendering.js";
import { calculateNativeCaptureSdrPlan, createNativeCaptureSdrTask, sdrOutputEncoding, validateNativeCaptureSdrTile, NATIVE_CAPTURE_SDR_LIMITS,
  type NativeCaptureSdrInput, type NativeCaptureSdrOutput, type NativeCaptureSdrProvider, type NativeCaptureSdrTileRequest } from "../output/native-capture-sdr.js";
import { convolveIrradianceRows, calculateIrradianceConvolutionPlan, type IrradianceConvolutionInput, type IrradianceConvolutionPlan } from "../optics/irradiance-convolution.js";
import { ImageKernelExecutionError, cpuExecution, float32Gamma, integerCodeBound, webGpuExecution, type ImageKernelAdapterDescription,
  type ImageKernelBackend, type ImageKernelExecution, type ImageKernelFallbackReason, type ImageKernelRelativeErrorBound } from "./image-kernel-execution.js";
import { BUFFER_USAGE, GpuResourceScope, abortedError, acquireWebGpuRuntime, createComputePipeline, linearDispatch, runComputePass,
  type WebGpuRuntime } from "./webgpu-runtime.js";
import { CONVOLUTION_WORKGROUP_EDGE, IRRADIANCE_CONVOLUTION_WGSL, LINEAR_WORKGROUP_SIZE, RAW_DEVELOPMENT_WGSL, SDR_COUNTER, SDR_COUNTER_SLOTS,
  SDR_LUMINANCE_WGSL, SDR_TONE_MODE, SDR_WGSL } from "./wgsl-kernels.js";
import type { PackedSensorRawInput, PackedSensorRawResult } from "../capture/packed-sensor-raw.js";
import { simulateSensorRawOnCpu, simulateSensorRawOnGpu } from "./sensor-stage-gpu.js";
import { calculateTemporalExposureSumPlan, type TemporalExposureSumInput, type TemporalExposureSumPlan } from "../motion/temporal-exposure-sum.js";
import { sumTemporalExposureOnCpu, sumTemporalExposureOnGpu } from "./temporal-sum-gpu.js";
import type { ChartRadianceBatchInput, ChartRadianceBatchPlan } from "../facade/chart-radiance-batch.js";
import { evaluateChartRadianceOnCpu, evaluateChartRadianceOnGpu } from "./chart-radiance-gpu.js";
import { ChartSceneUploads } from "./chart-composite-gpu.js";

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

export interface AcceleratedPackedSensorRawResult extends PackedSensorRawResult {
  execution: ImageKernelExecution;
  /**
   * Region-relative indices of the flagged sites, ascending (empty for `cpu-reference`). Every other site
   * equals the reference; recomputing these sites with the reference makes the whole region bit-identical.
   */
  flaggedSiteIndices: Uint32Array;
}
export interface TemporalExposureSumResult {
  plan: TemporalExposureSumPlan;
  /** Float64 for `cpu-reference`, float32 for `webgpu-f32`; row-major, same grid as the input. */
  values: Float64Array | Float32Array;
  execution: ImageKernelExecution;
}

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
export interface ImageKernelRunOptions {
  signal?: AbortSignal;
  /** Yields to the host event loop between CPU reference chunks and GPU bands. Convolution, sensor and temporal stages; tasks keep their own yields. */
  yieldControl?: (signal: AbortSignal) => Promise<void>;
}
export type ImageKernelAcceleratorState = "ready" | "lost" | "disposed";
export interface AcceleratedNativeCaptureSdrOutput extends NativeCaptureSdrOutput { execution: ImageKernelExecution }
export interface AcceleratedNativeRawDevelopmentOutput extends NativeRawDevelopmentOutput { execution: ImageKernelExecution }
export interface IrradianceConvolutionResult {
  plan: IrradianceConvolutionPlan;
  /** Float64 for `cpu-reference`, float32 for `webgpu-f32`; row-major, same grid as the input. */
  values: Float64Array | Float32Array;
  /** Float64 sums of the input and output samples. Their difference is the amount lost across the grid edge. */
  inputSum: number;
  outputSum: number;
  execution: ImageKernelExecution;
}
/** Runs one operation at a time. dispose() releases the device and every buffer. */
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

const DEFAULT_BAND_BYTES = 64 * 1024 * 1024;
const MINIMUM_BAND_BYTES = 4096;
/** Limit on multiply-adds per convolution dispatch, to stay clear of the GPU watchdog timeout. */
const MAXIMUM_CONVOLUTION_TAPS_PER_DISPATCH = 2 ** 30;
/** Inputs whose float64 product with the rendering scale exceeds this are outside the float32 domain. */
const FLOAT32_SAFE_MAGNITUDE = 2 ** 120;
const FLOAT32_SUBNORMAL_LIMIT = 2 ** -126;
const NO_COUNTERS = (): number[] => new Array<number>(SDR_COUNTER_SLOTS).fill(0);

function runOptions(value: ImageKernelRunOptions | undefined): ImageKernelRunOptions {
  if (value === undefined) return {};
  const r = requireAllowlistedRecord(value, ["signal", "yieldControl"], "Invalid image-kernel run options.");
  if ((r.signal !== undefined && (typeof r.signal !== "object" || r.signal === null || typeof (r.signal as AbortSignal).aborted !== "boolean")) ||
      (r.yieldControl !== undefined && typeof r.yieldControl !== "function")) {
    throw new InvalidConfigurationError("Invalid image-kernel run options.");
  }
  return value;
}

/** Links an optional caller signal to an internal controller; `dispose` removes the listener. */
function linkedAbort(signal: AbortSignal | undefined): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  if (!signal) return { controller, dispose: () => undefined };
  if (signal.aborted) { controller.abort(); return { controller, dispose: () => undefined }; }
  const listener = (): void => controller.abort();
  signal.addEventListener("abort", listener, { once: true });
  return { controller, dispose: (): void => signal.removeEventListener("abort", listener) };
}

/** Requests a backend. Never swaps backends silently: a fallback must be set in the options and is shown in every result label. */
export async function createImageKernelAccelerator(options: ImageKernelAcceleratorOptions): Promise<ImageKernelAccelerator> {
  const r = requireAllowlistedRecord(options, ["webgpu", "backend", "fallback", "gpu", "powerPreference", "maximumBandBytes", "signal"],
    "Invalid image-kernel accelerator options.");
  if (r.webgpu !== undefined && (typeof r.webgpu !== "boolean" || r.backend !== undefined)) {
    throw new InvalidConfigurationError("Invalid image-kernel accelerator options: webgpu must be a boolean, and excludes backend.");
  }
  // The boolean form resolves to the explicit form; everything below sees only backend and fallback.
  const backend = r.webgpu === undefined ? r.backend : r.webgpu ? "webgpu-f32" : "cpu-reference";
  const fallback = r.fallback ?? (r.webgpu === true ? "cpu-reference" : undefined);
  if ((backend !== "cpu-reference" && backend !== "webgpu-f32") ||
      (backend === "webgpu-f32" && fallback !== "cpu-reference" && fallback !== "fail") ||
      (backend === "cpu-reference" && fallback !== undefined) ||
      (r.powerPreference !== undefined && r.powerPreference !== "low-power" && r.powerPreference !== "high-performance") ||
      (r.maximumBandBytes !== undefined && (typeof r.maximumBandBytes !== "number" || !Number.isSafeInteger(r.maximumBandBytes) ||
        r.maximumBandBytes < MINIMUM_BAND_BYTES)) ||
      (r.signal !== undefined && (typeof r.signal !== "object" || r.signal === null || typeof (r.signal as AbortSignal).aborted !== "boolean"))) {
    throw new InvalidConfigurationError("Invalid image-kernel accelerator options: backend, explicit WebGPU fallback, power preference or band size.");
  }
  const requested = backend;
  if (requested === "cpu-reference") return createAccelerator(requested, null, null, DEFAULT_BAND_BYTES);
  if (!getWebGpuEnabled()) {
    // The realm's switch (setWebGpuEnabled(false)) is honoured before any adapter is requested.
    const message = "WebGPU is switched off in this realm (setWebGpuEnabled(false)).";
    if (fallback === "fail") throw new ImageKernelExecutionError("webgpu-disabled", message);
    return createAccelerator(requested, "webgpu-disabled", null, DEFAULT_BAND_BYTES);
  }
  const gpu = "gpu" in r ? r.gpu : (globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu;
  const acquired = await acquireWebGpuRuntime(gpu, options.powerPreference, options.signal);
  if ("failure" in acquired) {
    if (fallback === "fail") throw new ImageKernelExecutionError(acquired.failure, acquired.message);
    return createAccelerator(requested, acquired.failure, null, DEFAULT_BAND_BYTES);
  }
  const runtime = acquired.runtime;
  const band = Math.min(options.maximumBandBytes ?? DEFAULT_BAND_BYTES, runtime.maximumStorageBindingBytes);
  return createAccelerator(requested, null, runtime, band);
}

/** The runtime behind each accelerator this module created (#481: a prepared display view shares an accelerator's device through it). */
const RUNTIMES = new WeakMap<ImageKernelAccelerator, WebGpuRuntime | null>();
/**
 * Internal (#481, not exported from the package): the WebGPU runtime (`WebGpuRuntime`, typed `unknown` here so no WebGPU type reaches
 * the published declarations) of an accelerator created by {@link createImageKernelAccelerator}, null for one on the CPU
 * reference, or undefined when `value` is not such an accelerator.
 */
export function acceleratorRuntime(value: unknown): unknown {
  return typeof value === "object" && value !== null ? RUNTIMES.get(value as ImageKernelAccelerator) : undefined;
}
/**
 * Internal (#481, not exported from the package): runs the `webgpu-f32` convolution on a runtime (`WebGpuRuntime`, passed as
 * `unknown` to keep WebGPU types out of the published declarations), for the display view's run-time conformance self-check.
 * Pipelines are compiled per call; `signal` aborts the run.
 */
export async function convolveIrradianceOnRuntime(runtime: unknown, input: IrradianceConvolutionInput, signal: AbortSignal | undefined): Promise<IrradianceConvolutionResult> {
  const gpu = runtime as WebGpuRuntime, plan = calculateIrradianceConvolutionPlan(input), link = linkedAbort(signal);
  try {
    return await convolveOnGpu(gpu, 1 << 20, plan, input, link.controller, undefined, (label, code) => createComputePipeline(gpu, label, code, link.controller.signal));
  } finally { link.dispose(); }
}

function createAccelerator(requested: ImageKernelBackend, fallbackReason: ImageKernelFallbackReason | null,
  runtime: WebGpuRuntime | null, bandBytes: number): ImageKernelAccelerator {
  let disposed = false, busy = false;
  const pipelines = new Map<string, Promise<GPUComputePipeline>>();
  // #477: a scene's chart records are uploaded once and reused by later calls (a prepared view's parts).
  const chartUploads = runtime ? new ChartSceneUploads(runtime) : null;
  const backend: ImageKernelBackend = runtime ? "webgpu-f32" : "cpu-reference";
  function state(): ImageKernelAcceleratorState { return disposed ? "disposed" : runtime?.isLost() ? "lost" : "ready"; }
  function pipeline(gpu: WebGpuRuntime, label: string, code: string, signal: AbortSignal): Promise<GPUComputePipeline> {
    let pending = pipelines.get(label);
    if (!pending) {
      pending = createComputePipeline(gpu, label, code, undefined);
      pipelines.set(label, pending);
      pending.catch(() => pipelines.delete(label));
    }
    return gpu.guard(pending, signal);
  }
  /** Runs one operation at a time, and turns aborts, disposal and device loss into domain errors. */
  async function operate<T>(signal: AbortSignal | undefined, body: (abort: AbortController) => Promise<T>): Promise<T> {
    if (disposed) throw new ImageKernelExecutionError("disposed", "The image-kernel accelerator was disposed.");
    if (runtime?.isLost()) throw new ImageKernelExecutionError("device-lost", "The WebGPU device was lost; create a new accelerator.");
    if (busy) throw new ImageKernelExecutionError("busy", "The image-kernel accelerator runs one operation at a time.");
    busy = true;
    const link = linkedAbort(signal);
    try {
      if (link.controller.signal.aborted) throw abortedError();
      return await body(link.controller);
    } catch (error) {
      link.controller.abort();
      if (disposed) throw new ImageKernelExecutionError("disposed", "The image-kernel accelerator was disposed; no output is available.");
      if (signal?.aborted && !(error instanceof ImageKernelExecutionError && error.reason === "device-lost")) throw abortedError();
      throw error;
    } finally {
      link.dispose();
      busy = false;
    }
  }
  const cpuLabel = (): ImageKernelExecution => cpuExecution(requested, fallbackReason);
  const accelerator: ImageKernelAccelerator = {
    backend, requestedBackend: requested, fallbackReason, adapter: runtime?.adapter ?? null,
    get state(): ImageKernelAcceleratorState { return state(); },
    async renderNativeCaptureSdr(input, provider, options): Promise<AcceleratedNativeCaptureSdrOutput> {
      const run = runOptions(options);
      return operate(run.signal, async (abort) => {
        if (!runtime) {
          const task = createNativeCaptureSdrTask(input, provider);
          const cancel = (): void => task.cancel();
          abort.signal.addEventListener("abort", cancel, { once: true });
          try { await task.run(); return { ...task.takeOutput(), execution: cpuLabel() }; }
          finally { abort.signal.removeEventListener("abort", cancel); task.dispose(); }
        }
        return renderSdrOnGpu(runtime, bandBytes, input, provider, abort, (label, code) => pipeline(runtime, label, code, abort.signal));
      });
    },
    async developNativeRaw(input, provider, options): Promise<AcceleratedNativeRawDevelopmentOutput> {
      const run = runOptions(options);
      return operate(run.signal, async (abort) => {
        if (!runtime) {
          const task = createNativeRawDevelopmentTask(input, provider);
          const cancel = (): void => task.cancel();
          abort.signal.addEventListener("abort", cancel, { once: true });
          try { await task.run(); return { ...task.takeOutput(), execution: cpuLabel() }; }
          finally { abort.signal.removeEventListener("abort", cancel); task.dispose(); }
        }
        return developRawOnGpu(runtime, bandBytes, input, provider, abort, (label, code) => pipeline(runtime, label, code, abort.signal));
      });
    },
    async convolveIrradiance(input, options): Promise<IrradianceConvolutionResult> {
      const run = runOptions(options);
      return operate(run.signal, async (abort) => {
        const plan = calculateIrradianceConvolutionPlan(input);
        if (!runtime) return convolveOnCpu(plan, input, abort, run.yieldControl, cpuLabel());
        return convolveOnGpu(runtime, bandBytes, plan, input, abort, run.yieldControl,
          (label, code) => pipeline(runtime, label, code, abort.signal));
      });
    },
    async simulateSensorRaw(input, options): Promise<AcceleratedPackedSensorRawResult> {
      const run = runOptions(options);
      return operate(run.signal, async (abort) => {
        if (!runtime) return simulateSensorRawOnCpu(input, abort, run.yieldControl, cpuLabel());
        return simulateSensorRawOnGpu(runtime, bandBytes, input, abort, run.yieldControl, (label, code) => pipeline(runtime, label, code, abort.signal));
      });
    },
    async sumTemporalExposure(input, options): Promise<TemporalExposureSumResult> {
      const run = runOptions(options);
      return operate(run.signal, async (abort) => {
        const plan = calculateTemporalExposureSumPlan(input);
        if (!runtime) return sumTemporalExposureOnCpu(plan, input, abort, run.yieldControl, cpuLabel());
        return sumTemporalExposureOnGpu(runtime, bandBytes, plan, input, abort, run.yieldControl,
          (label, code) => pipeline(runtime, label, code, abort.signal));
      });
    },
    async evaluateChartRadiance(input, options): Promise<ChartRadianceResult> {
      const run = runOptions(options);
      return operate(run.signal, async (abort) => {
        if (!runtime) return evaluateChartRadianceOnCpu(input, abort, run.yieldControl, cpuLabel());
        // #477: the chart stage consults the realm's switch on every call; off, the reference runs and the label says so.
        if (!getWebGpuEnabled()) return evaluateChartRadianceOnCpu(input, abort, run.yieldControl, cpuExecution(requested, "webgpu-disabled"));
        return evaluateChartRadianceOnGpu(runtime, bandBytes, input, abort, run.yieldControl, (label, code) => pipeline(runtime, label, code, abort.signal), chartUploads!);
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pipelines.clear();
      chartUploads?.release();
      runtime?.destroy();
    }
  };
  RUNTIMES.set(accelerator, runtime);
  return accelerator;
}

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;

export function checkAbort(abort: AbortController): void {
  if (abort.signal.aborted) throw abortedError();
}

function sumOf(values: Float32Array | Float64Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]!;
  return sum;
}

async function convolveOnCpu(plan: IrradianceConvolutionPlan, input: IrradianceConvolutionInput, abort: AbortController,
  yieldControl: ImageKernelRunOptions["yieldControl"], execution: ImageKernelExecution): Promise<IrradianceConvolutionResult> {
  // Snapshot so a caller mutation during host yields cannot change the reference.
  const samples = input.samples.slice(), kernels = input.kernels.slice();
  const values = new Float64Array(plan.width * plan.height);
  const rowsPerChunk = Math.max(1, Math.floor(2_000_000 / Math.max(1, plan.width * plan.tapCount)));
  const gate = createHostYieldGate();
  for (let y = 0; y < plan.height; y += rowsPerChunk) {
    checkAbort(abort);
    const end = Math.min(plan.height, y + rowsPerChunk);
    convolveIrradianceRows(plan, samples, kernels, y, end, values.subarray(y * plan.width, end * plan.width));
    if (yieldControl && gate.due()) { await yieldControl(abort.signal); gate.restart(); }
  }
  checkAbort(abort);
  return { plan, values, inputSum: sumOf(samples), outputSum: sumOf(values), execution };
}

async function convolveOnGpu(runtime: WebGpuRuntime, bandBytes: number, plan: IrradianceConvolutionPlan, input: IrradianceConvolutionInput,
  abort: AbortController, yieldControl: ImageKernelRunOptions["yieldControl"], pipelines: PipelineSource): Promise<IrradianceConvolutionResult> {
  const { width, height, kernelRadius: r, tapCount } = plan;
  const samples = new Float32Array(input.samples), kernels = new Float32Array(input.kernels), inputSum = sumOf(input.samples);
  const errorBound = irradianceConvolutionErrorBound(plan, input.kernels);
  if (kernels.byteLength > runtime.maximumStorageBindingBytes) {
    throw new ImageKernelExecutionError("insufficient-limits", "PSF kernels exceed the device's storage binding limit.");
  }
  const rowBytes = width * 4;
  let rows = Math.min(height, Math.floor(bandBytes / rowBytes) - 2 * r, Math.floor(MAXIMUM_CONVOLUTION_TAPS_PER_DISPATCH / (width * tapCount)));
  if (rows < 1) {
    if ((1 + 2 * r) * rowBytes > runtime.maximumStorageBindingBytes) {
      throw new ImageKernelExecutionError("insufficient-limits", "One convolution band exceeds the device's storage binding limit.");
    }
    rows = 1;
  }
  const values = new Float32Array(width * height);
  const pipeline = await pipelines("photivra-irradiance-convolution", IRRADIANCE_CONVOLUTION_WGSL);
  const scope = new GpuResourceScope(runtime);
  try {
    const kernelBuffer = scope.upload("photivra-psf-kernels", kernels, BUFFER_USAGE.STORAGE);
    const gate = createHostYieldGate();
    for (let y0 = 0; y0 < height; y0 += rows) {
      checkAbort(abort);
      const y1 = Math.min(height, y0 + rows), in0 = Math.max(0, y0 - r), in1 = Math.min(height, y1 + r);
      const params = new Uint32Array([width, height, r, 2 * r + 1, plan.patchWidth, plan.patchHeight, plan.patchColumns, plan.patchRows,
        y0, y1 - y0, in0, tapCount]);
      // Per-band scope: every buffer of the band, its readback included, is destroyed before the next band.
      const bandScope = new GpuResourceScope(runtime);
      try {
        const band = bandScope.upload("photivra-irradiance-band", samples.subarray(in0 * width, in1 * width), BUFFER_USAGE.STORAGE);
        const result = bandScope.buffer("photivra-irradiance-result", (y1 - y0) * rowBytes, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const uniform = bandScope.upload("photivra-irradiance-params", params, BUFFER_USAGE.UNIFORM);
        const bindGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: band } },
          { binding: 2, resource: { buffer: kernelBuffer } }, { binding: 3, resource: { buffer: result } }] });
        const groups: [number, number] = [Math.ceil(width / CONVOLUTION_WORKGROUP_EDGE), Math.ceil((y1 - y0) / CONVOLUTION_WORKGROUP_EDGE)];
        const [data] = await runComputePass(runtime, bandScope, pipeline, bindGroup, groups, [{ buffer: result, bytes: (y1 - y0) * rowBytes }], abort.signal);
        values.set(new Float32Array(data!, 0, (y1 - y0) * width), y0 * width);
      } finally {
        bandScope.release();
      }
      if (yieldControl && gate.due()) { await yieldControl(abort.signal); gate.restart(); }
    }
  } finally {
    scope.release();
  }
  checkAbort(abort);
  const execution = webGpuExecution(errorBound, 0);
  return { plan, values, inputSum, outputSum: sumOf(values), execution };
}

/**
 * A-priori float32 bound for every convolution output (all terms are non-negative):
 * |v_f32 − v_ref| ≤ (γ_{T+3} + 2^-40)·v_ref + 2T·2^-126 + 2·S_max·Σ_t max_p w_{p,t}·[0 < w_{p,t} < 2^-126].
 * The last term covers weights below the float32 normal range: the host conversion may round them to zero or
 * a subnormal (|f32(w) − w| ≤ w) and the GPU may flush them, so their whole product w·s (s ≤ S_max) is at risk,
 * with a factor 2 for the conversion and the later roundings. It is zero when no such weight exists.
 */
export function irradianceConvolutionErrorBound(plan: IrradianceConvolutionPlan, kernels: Float32Array | Float64Array): ImageKernelRelativeErrorBound {
  const { tapCount } = plan, patches = kernels.length / tapCount;
  let atRisk = 0;
  for (let t = 0; t < tapCount; t++) {
    let largest = 0;
    for (let p = 0; p < patches; p++) {
      const w = kernels[p * tapCount + t]!;
      if (w < FLOAT32_SUBNORMAL_LIMIT && w > largest) largest = w;
    }
    atRisk += largest;
  }
  return { kind: "relative-to-reference", relative: float32Gamma(tapCount + 3) + 2 ** -40,
    absolute: 2 * tapCount * FLOAT32_SUBNORMAL_LIMIT + 2 * plan.maximumSampleMagnitude * atRisk };
}

/** Uniform values of a tone curve for the float32 kernels (see wgsl-kernels.ts, LUMINANCE_FUNCTIONS). */
interface ToneUniform { mode: number; tone: [number, number, number, number]; lum: [number, number, number, number] }

/**
 * The tone curve's kernel constants. Luminance curves run on the GPU within this float32 domain:
 * extended Reinhard with Lw ≥ 2^-20; Naka–Rushton with exponent n ≥ 1 (below 1 its ratio f(L)/L is
 * unbounded as L → 0, so no useful bound exists near L = 0), 1/g(Lw) ≤ 2^60 and σⁿ ≥ 2^-60.
 * @internal
 */
export function toneUniform(profile: Pick<SdrRenderingProfile, "toneCurve" | "toneCurveParameters">): ToneUniform {
  const [kr, kg, kb] = resolveCaptureColorModel().cameraRgbToXyz[1]! as readonly number[];
  const p = profile.toneCurveParameters;
  if (profile.toneCurve === "identity" || profile.toneCurve === "positive-reinhard-per-channel") {
    return { mode: SDR_TONE_MODE.perChannel, tone: [0, 0, 0, 0], lum: [0, 0, 0, 0] };
  }
  if (profile.toneCurve === "extended-reinhard-luminance" && p && !("exponent" in p)) {
    if (!(p.whiteLuminance >= 2 ** -20)) throw new ImageKernelExecutionError("unsupported-float32-domain", "Extended Reinhard white luminance below 2^-20 is outside the float32 domain.");
    return { mode: SDR_TONE_MODE.extendedReinhard, tone: [1 / (p.whiteLuminance * p.whiteLuminance), 0, 0, 0], lum: [kr!, kg!, kb!, 1] };
  }
  if (profile.toneCurve === "naka-rushton-luminance" && p && "exponent" in p) {
    const q = p as Extract<NonNullable<SdrRenderingProfile["toneCurveParameters"]>, { exponent: number }>, n = q.exponent, sigma = q.semiSaturation;
    if (!(n >= 1)) {
      throw new ImageKernelExecutionError("unsupported-on-backend", "webgpu-f32 implements Naka–Rushton with exponent ≥ 1; use cpu-reference below 1.");
    }
    const white = 1 / (1 + (sigma / q.whiteLuminance) ** n), sigmaN = sigma ** n;
    if (!(1 / white <= 2 ** 60 && sigmaN >= 2 ** -60)) {
      throw new ImageKernelExecutionError("unsupported-float32-domain", "Naka–Rushton parameters are outside the float32 domain.");
    }
    return { mode: SDR_TONE_MODE.nakaRushton, tone: [sigma, n, 1 / white, sigmaN], lum: [kr!, kg!, kb!, Math.max(1, n - 1)] };
  }
  throw new InvalidConfigurationError("Unsupported SDR rendering profile.");
}

/** Adds one band's counters into the run's; the luminance bound slot keeps the largest float32 value. */
function mergeCounters(counters: number[], band: Uint32Array): void {
  band.forEach((value, i) => {
    if (i === SDR_COUNTER.linearBoundBits) counters[i] = Math.max(counters[i]!, new Float32Array(new Uint32Array([value]).buffer)[0]!);
    else counters[i]! += value;
  });
}

/** Fails closed when a luminance-toned sample left the float32 domain. */
function requireLuminanceDomain(counters: readonly number[]): void {
  if (counters[SDR_COUNTER.luminanceDomain]! > 0) {
    throw new ImageKernelExecutionError("unsupported-float32-domain", "A luminance-toned sample is outside the float32 execution domain.");
  }
}

function sdrDiagnostics(counters: readonly number[], captureSaturation: SdrRenderingResult["diagnostics"]["captureSaturation"]): SdrRenderingResult["diagnostics"] {
  return { renderingNegativeSampleCount: counters[SDR_COUNTER.negative]!, renderingAboveReferenceSampleCount: counters[SDR_COUNTER.above]!,
    toneChangedSampleCount: counters[SDR_COUNTER.changed]!, gamutClippedLowSampleCount: counters[SDR_COUNTER.low]!,
    gamutClippedHighSampleCount: counters[SDR_COUNTER.high]!, captureSaturation };
}

/** Throws (fails closed) when a reject-mode gamut decision is out of range or cannot be decided in float32. */
function requireGamutDecision(reject: boolean, counters: readonly number[]): void {
  if (counters[SDR_COUNTER.outOfGamut]! > 0) throw new InvalidConfigurationError("Tone output exceeds the declared SDR gamut range.");
  if (reject && counters[SDR_COUNTER.gamutUncertain]! > 0) {
    throw new ImageKernelExecutionError("indeterminate-float32-classification",
      "Reject-out-of-range gamut handling is not decidable in float32 for at least one sample; use cpu-reference.");
  }
}

async function dispatchSdrBand(runtime: WebGpuRuntime, pipeline: GPUComputePipeline, staging: Float32Array<ArrayBuffer>, count: number,
  params: ArrayBuffer, abort: AbortController, invocations: number): Promise<{ codes: Uint32Array; counters: Uint32Array }> {
  const scope = new GpuResourceScope(runtime);
  try {
    const source = scope.upload("photivra-sdr-source", staging.subarray(0, count), BUFFER_USAGE.STORAGE);
    const codes = scope.buffer("photivra-sdr-codes", count * 4, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
    const counters = scope.upload("photivra-sdr-counters", new Uint32Array(SDR_COUNTER_SLOTS), BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
    const uniform = scope.upload("photivra-sdr-params", new Uint8Array(params), BUFFER_USAGE.UNIFORM);
    const bindGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: source } },
      { binding: 2, resource: { buffer: codes } }, { binding: 3, resource: { buffer: counters } }] });
    const [codeData, counterData] = await runComputePass(runtime, scope, pipeline, bindGroup,
      linearDispatch(invocations, LINEAR_WORKGROUP_SIZE, runtime.maximumWorkgroupsPerDimension),
      [{ buffer: codes, bytes: count * 4 }, { buffer: counters, bytes: SDR_COUNTER_SLOTS * 4 }], abort.signal);
    return { codes: new Uint32Array(codeData!, 0, count), counters: new Uint32Array(counterData!, 0, SDR_COUNTER_SLOTS) };
  } finally {
    scope.release();
  }
}

async function renderSdrOnGpu(runtime: WebGpuRuntime, bandBytes: number, input: NativeCaptureSdrInput, provider: NativeCaptureSdrProvider,
  abort: AbortController, pipelines: PipelineSource): Promise<AcceleratedNativeCaptureSdrOutput> {
  const plan = calculateNativeCaptureSdrPlan(input);
  if (!provider || typeof provider.readTile !== "function" || typeof provider.yieldControl !== "function") {
    throw new InvalidConfigurationError("Native SDR requires a tile reader and event-loop yield.");
  }
  if (provider.onProgress !== undefined && typeof provider.onProgress !== "function") throw new InvalidConfigurationError("Native SDR onProgress must be a function.");
  const readTile = provider.readTile.bind(provider), yieldControl = provider.yieldControl.bind(provider), onProgress = provider.onProgress?.bind(provider);
  const tone = toneUniform(plan.profile), luminance = tone.mode !== SDR_TONE_MODE.perChannel;
  const plane = plan.capture.planes.find(p => p.id === plan.sourcePlaneId)!;
  if (plane.storage.kind === "inline-float64") throw new InvalidConfigurationError("External native source required.");
  const storage = plane.storage, profile = plan.profile, width = plane.pixelWidth, height = plane.pixelHeight;
  const scale = 2 ** profile.renderingExposureEv / plane.referenceWhiteValue, maximum = 2 ** profile.bitDepth - 1;
  const scale32 = Math.fround(scale);
  if (!(scale32 > 0 && Number.isFinite(scale32))) throw new ImageKernelExecutionError("unsupported-float32-domain", "SDR scale is outside float32.");
  const tileHeight = NATIVE_CAPTURE_SDR_LIMITS.tileHeight, rowSamples = width * 3;
  const bandRows = Math.max(tileHeight, Math.floor(bandBytes / (rowSamples * 4) / tileHeight) * tileHeight);
  if (Math.min(bandRows, height) * rowSamples * 4 > runtime.maximumStorageBindingBytes) {
    throw new ImageKernelExecutionError("insufficient-limits", "One SDR tile row exceeds the device's storage binding limit.");
  }
  const reinhard = profile.toneCurve === "positive-reinhard-per-channel", reject = profile.gamutHandling === "reject-out-of-range";
  const params = new ArrayBuffer(luminance ? 64 : 32), words = new Uint32Array(params), floats = new Float32Array(params);
  if (luminance) {
    words[1] = reject ? 1 : 0; words[2] = tone.mode; floats[4] = scale32; floats[5] = maximum; floats[6] = 2 ** -20;
    floats.set(tone.tone, 8); floats.set(tone.lum, 12);
  } else {
    words[1] = reinhard ? 1 : 0; words[2] = reject ? 1 : 0; floats[4] = scale32; floats[5] = maximum; floats[6] = 2 ** -20;
  }
  const pipeline = luminance ? await pipelines("photivra-sdr-luminance", SDR_LUMINANCE_WGSL) : await pipelines("photivra-sdr", SDR_WGSL);
  const codes = profile.bitDepth === 8 ? new Uint8Array(plan.outputBytes) : new Uint16Array(plan.outputBytes / 2);
  const staging = new Float32Array(Math.min(bandRows, height) * rowSamples);
  const counters = NO_COUNTERS();
  let hostUncertain = 0, bandStart = 0, completed = 0;
  try {
    for (let y = 0; y < height; y += tileHeight) {
      for (let x = 0; x < width; x += NATIVE_CAPTURE_SDR_LIMITS.tileWidth) {
        checkAbort(abort);
        const request: NativeCaptureSdrTileRequest = Object.freeze({ captureId: plan.capture.captureId, sourcePlaneId: plane.id,
          artifactId: storage.artifactId, sha256: storage.sha256, x, y,
          width: Math.min(NATIVE_CAPTURE_SDR_LIMITS.tileWidth, width - x), height: Math.min(tileHeight, height - y) });
        const tile = await readTile(request, abort.signal);
        checkAbort(abort);
        const { source, stride } = validateNativeCaptureSdrTile(tile, request, plane);
        completed++;
        for (let row = 0; row < request.height; row++) {
          const out = (y + row - bandStart) * rowSamples + x * 3;
          for (let i = 0, from = row * stride; i < request.width * 3; i++) {
            const s = source[from + i]!, magnitude = Math.abs(s), exposed = magnitude * scale;
            // The reference's own failure precedence first, then the float32 domain.
            if (!Number.isFinite(exposed)) throw new InvalidScientificResultError("Rendering exposure produced a non-finite sample.");
            if (magnitude > FLOAT32_SAFE_MAGNITUDE || exposed > FLOAT32_SAFE_MAGNITUDE) {
              throw new ImageKernelExecutionError("unsupported-float32-domain", "SDR sample magnitude is outside the float32 execution domain.");
            }
            if (magnitude !== 0 && magnitude < FLOAT32_SUBNORMAL_LIMIT) hostUncertain++;
            staging[out + i] = s;
          }
        }
        await yieldControl(abort.signal);
        checkAbort(abort);
      }
      const bandEnd = Math.min(height, y + tileHeight);
      if (bandEnd - bandStart >= bandRows || bandEnd === height) {
        const count = (bandEnd - bandStart) * rowSamples;
        words[0] = luminance ? count / 3 : count;
        const result = await dispatchSdrBand(runtime, pipeline, staging, count, params, abort, words[0]!);
        mergeCounters(counters, result.counters);
        requireLuminanceDomain(counters);
        requireGamutDecision(reject, counters);
        codes.set(result.codes, bandStart * rowSamples);
        bandStart = bandEnd;
        // Progress reports tiles whose codes are committed, in the reference's tile units.
        onProgress?.({ completedTileCount: completed, totalTileCount: plan.tileCount });
      }
    }
  } catch (error) {
    codes.fill(0);
    throw error;
  }
  const uncertainty = counters[SDR_COUNTER.uncertain]! + hostUncertain;
  // Per-channel linear bound: source/scale/product rounding, Reinhard add/divide, plus float64 reference slack (L ≤ 1).
  // Luminance curves: the largest per-sample bound the kernel evaluated from the a-priori formula (docs/WEBGPU.md).
  const linearBound = luminance ? counters[SDR_COUNTER.linearBoundBits]! * (1 + 2 ** -20) : float32Gamma(6);
  const execution = webGpuExecution(integerCodeBound(maximum, linearBound), uncertainty);
  return { plan, integerSamples: codes, diagnostics: sdrDiagnostics(counters, "not-consumed"), outputEncoding: sdrOutputEncoding(maximum),
    displayAdaptation: { kind: "external-platform", applied: false, displayCapabilities: "unknown" }, execution };
}

/** Integer native-site affine map of oriented output pixels, mirroring the reference's centre-point transform. */
function orientedToNativeAffine(plan: NativeRawOutput["plan"]): { ox: number; oy: number; axx: number; axy: number; ayx: number; ayy: number } {
  const g = plan.exposure.resolvedGeometry, crop = g.output.cropRect, active = g.activeCapture.nativeRect;
  const W = g.activeCapture.raster.pixelWidth, H = g.activeCapture.raster.pixelHeight, orientation = plan.exposure.geometry.orientation;
  const m = orientation === "landscape" ? { ox: crop.x, oy: crop.y, axx: 1, axy: 0, ayx: 0, ayy: 1 }
    : orientation === "portrait-clockwise" ? { ox: crop.y, oy: H - crop.x - 1, axx: 0, axy: 1, ayx: -1, ayy: 0 }
      : orientation === "landscape-inverted" ? { ox: W - crop.x - 1, oy: H - crop.y - 1, axx: -1, axy: 0, ayx: 0, ayy: -1 }
        : { ox: W - crop.y - 1, oy: crop.x, axx: 0, axy: -1, ayx: 1, ayy: 0 };
  const affine = { ...m, ox: m.ox + active.x, oy: m.oy + active.y };
  for (const [i, j] of [[0, 0], [crop.width - 1, 0], [0, crop.height - 1], [crop.width - 1, crop.height - 1]] as const) {
    const q = transformOrientedRasterPointToNative({ point: { x: crop.x + i + .5, y: crop.y + j + .5 }, nativeRaster: g.activeCapture.raster, orientation });
    if (Math.floor(q.x) + active.x !== affine.ox + affine.axx * i + affine.axy * j || Math.floor(q.y) + active.y !== affine.oy + affine.ayx * i + affine.ayy * j) {
      throw new InvalidConfigurationError("Oriented output does not map affinely onto native sites.");
    }
  }
  return affine;
}

function rowSumNorm(matrix: readonly (readonly number[])[]): number {
  return Math.max(...matrix.map(row => row.reduce((sum, v) => sum + Math.abs(v), 0)));
}

/** Inputs of the a-priori float32 forward-error bound for packed RAW development (see docs/WEBGPU.md). */
export interface RawDevelopmentBoundInput {
  maximumTaps: number; maximumWeightSum: number; maximumSiteMagnitude: number; maximumGain: number;
  reconstruct: boolean; cameraToXyzNorm: number; xyzToRgbNorm: number; scale: number;
}
/**
 * Forward-error bounds (Higham γ_k, binary32) through the development chain: channel sums → gains →
 * highlight clip/blend → camera→XYZ → XYZ→linear sRGB → rendering exposure. Returns the bound on the
 * exposed value, and the classification bands for the white-balance clip and reconstruction-start
 * decisions. Internal; exported only for unit tests.
 */
export function rawDevelopmentErrorBounds(b: RawDevelopmentBoundInput): { exposed: number; gain: number; channel: number } {
  const C = b.maximumWeightSum * b.maximumSiteMagnitude, U = b.maximumGain * C, Bmax = Math.max(U, b.maximumGain);
  const deltaC = float32Gamma(b.maximumTaps + 2) * C + float32Gamma(1);
  const deltaU = b.maximumGain * deltaC + float32Gamma(2) * U;
  const deltaT = (deltaC + float32Gamma(3)) / (1 - RAW_HIGHLIGHT_RECONSTRUCTION_START);
  const deltaB = b.reconstruct ? 3 * deltaU + 2 * Bmax * deltaT + 2 * float32Gamma(4) * Bmax + float32Gamma(1) * b.maximumGain
    : deltaU + float32Gamma(1) * b.maximumGain;
  const deltaXyz = b.cameraToXyzNorm * (deltaB + float32Gamma(4) * Bmax);
  const deltaRgb = b.xyzToRgbNorm * (deltaXyz + float32Gamma(4) * b.cameraToXyzNorm * Bmax);
  const exposed = b.scale * (deltaRgb + float32Gamma(2) * b.xyzToRgbNorm * b.cameraToXyzNorm * Bmax);
  return { exposed, gain: deltaU + float32Gamma(1) * b.maximumGain, channel: deltaC + float32Gamma(1) };
}

async function developRawOnGpu(runtime: WebGpuRuntime, bandBytes: number, input: NativeRawDevelopmentInput,
  provider: NativeRawDevelopmentProvider | ((signal: AbortSignal) => Promise<void>), abort: AbortController,
  pipelines: PipelineSource): Promise<AcceleratedNativeRawDevelopmentOutput> {
  const hooks = typeof provider === "function" ? { yieldControl: provider } : provider;
  if (!hooks || typeof hooks.yieldControl !== "function" || (hooks.onProgress !== undefined && typeof hooks.onProgress !== "function")) {
    throw new InvalidConfigurationError("Development requires a host event-loop yield.");
  }
  const yieldControl = hooks.yieldControl.bind(hooks), onProgress = hooks.onProgress?.bind(hooks);
  // Run the reference's own synchronous input-limit, halo and CFA checks, then the same RAW ownership transfer.
  const v = prepareNativeRawDevelopment(input);
  const tone = toneUniform(v.profile), luminance = tone.mode !== SDR_TONE_MODE.perChannel;
  if (v.border !== "reject") {
    throw new ImageKernelExecutionError("unsupported-on-backend",
      "webgpu-f32 develops with rejected borders only; use cpu-reference for borderHandling \"mirror\".");
  }
  if (v.exposureGain !== 1) {
    throw new ImageKernelExecutionError("unsupported-on-backend",
      "webgpu-f32 develops without an exposure push only; use cpu-reference for exposureCompensationStops other than 0 (#556).");
  }
  const plan = v.plan, layout = plan.frame.colorSamplingProfile.layout, native = plan.exposure.geometry.nativeRaster;
  if (layout.kind !== "periodic-mosaic") throw new InvalidConfigurationError("Development requires periodic CFA.");
  const affine = orientedToNativeAffine(plan);
  const raw = takeNativeRawOwnership(input.raw, plan);
  const rw = layout.repeatWidthSites, rh = layout.repeatHeightSites, nativeWidth = native.pixelWidth, nativeHeight = native.pixelHeight;
  const outWidth = v.raster.pixelWidth, outHeight = v.raster.pixelHeight, profile = v.profile, development = v.development;
  const tilesPerRow = Math.ceil(outWidth / 256), totalTileCount = tilesPerRow * outHeight;
  let codes: Uint8Array | Uint16Array | null = null;
  const release = (): void => {
    raw.codes.fill(0); raw.blackLevels.fill(0); raw.digitalSaturationCodes.fill(0); raw.saturationFlags.fill(0); raw.effectiveSaturationCodes.fill(0);
    codes?.fill(0);
  };
  const scope = new GpuResourceScope(runtime);
  try {
    // Reference integrity check (bounded chunks with host yields), then the largest normalized site magnitude.
    const gate = createHostYieldGate(), rowsPerChunk = Math.max(1, Math.floor((1 << 18) / nativeWidth));
    for (let y = 0; y < nativeHeight; y += rowsPerChunk) {
      checkAbort(abort);
      checkNativeRawIntegrity(raw, nativeWidth, rw, rh, y, Math.min(nativeHeight, y + rowsPerChunk));
      if (gate.due()) { await yieldControl(abort.signal); checkAbort(abort); gate.restart(); }
    }
    const white = raw.effectiveSaturationCodes;
    // The reference's site normalization (raw-development-kernel.ts), evaluated in float64.
    const normalizedSite = (i: number, x: number, y: number): number => {
      const code = raw.codes[i]!, top = white[(y % rh) * rw + x % rw]!, black = raw.blackLevels[i]!;
      return raw.saturationFlags[i]! !== 0 || code >= top ? 1 : (code - black) / (top - black);
    };
    let maximumSiteMagnitude = 0;
    for (let y = 0, i = 0; y < nativeHeight; y++) for (let x = 0; x < nativeWidth; x++, i++) {
      const m = Math.abs(normalizedSite(i, x, y));
      if (m > maximumSiteMagnitude) maximumSiteMagnitude = m;
    }
    // CFA kernel table: phase-major, channel-minor (start, count) ranges into (offsetX, offsetY, weight) taps.
    const tapList: number[][] = [], ranges = new Uint32Array(v.phases.length * 6);
    let halo = 0, maximumTaps = 0, maximumWeightSum = 0;
    v.phases.forEach((phase, p) => phase.profile.kernels.forEach((kernel, c) => {
      ranges[(p * 3 + c) * 2] = tapList.length; ranges[(p * 3 + c) * 2 + 1] = kernel.contributions.length;
      maximumTaps = Math.max(maximumTaps, kernel.contributions.length);
      let weights = 0;
      for (const t of kernel.contributions) {
        tapList.push([t.offsetX, t.offsetY, t.weight]);
        halo = Math.max(halo, Math.abs(t.offsetX), Math.abs(t.offsetY));
        weights += Math.abs(t.weight);
      }
      maximumWeightSum = Math.max(maximumWeightSum, weights);
    }));
    const tapBuffer = new ArrayBuffer(Math.max(1, tapList.length) * 16), tapInts = new Int32Array(tapBuffer), tapFloats = new Float32Array(tapBuffer);
    tapList.forEach(([ox, oy, w], i) => { tapInts[i * 4] = ox!; tapInts[i * 4 + 1] = oy!; tapFloats[i * 4 + 2] = w!; });
    const gains = development.appliedGains, clipLevel = Math.min(...gains), M = development.cameraToXyz, X = resolveCaptureColorModel().xyzToCameraRgb;
    const reconstruct = development.highlightMode === "reconstruct";
    const scale = 2 ** profile.renderingExposureEv, maximum = 2 ** profile.bitDepth - 1;
    const bounds = rawDevelopmentErrorBounds({ maximumTaps, maximumWeightSum, maximumSiteMagnitude, maximumGain: Math.max(...gains),
      reconstruct, cameraToXyzNorm: rowSumNorm(M), xyzToRgbNorm: rowSumNorm(X), scale });
    const band = Math.fround(bounds.exposed * (1 + 2 ** -20));
    if (!Number.isFinite(band) || bounds.exposed > 1 || maximumSiteMagnitude * maximumWeightSum * Math.max(...gains) * scale > FLOAT32_SAFE_MAGNITUDE) {
      throw new ImageKernelExecutionError("unsupported-float32-domain", "Development values are outside the float32 execution domain.");
    }
    const reinhard = profile.toneCurve === "positive-reinhard-per-channel", reject = profile.gamutHandling === "reject-out-of-range";
    const params = new ArrayBuffer(256), ints = new Int32Array(params), words = new Uint32Array(params), floats = new Float32Array(params);
    words[52] = tone.mode; floats.set(tone.tone, 56); floats.set(tone.lum, 60);
    words[0] = outWidth; words[3] = reinhard ? 1 : 0; words[4] = reject ? 1 : 0; words[5] = rw; words[6] = rh;
    ints[8] = affine.ox; ints[9] = affine.oy; ints[10] = affine.axx; ints[11] = affine.axy; ints[12] = affine.ayx; ints[13] = affine.ayy;
    floats[16] = scale; floats[17] = maximum; floats[18] = band; floats[19] = Math.max(band, 2 ** -20);
    floats[20] = clipLevel; words[21] = reconstruct ? 1 : 0;
    floats[22] = Math.fround(bounds.gain * (1 + 2 ** -20)); floats[23] = Math.fround(bounds.channel * (1 + 2 ** -20));
    floats.set(gains, 24);
    for (let row = 0; row < 3; row++) { floats.set(M[row]!, 28 + row * 4); floats.set(X[row]!, 40 + row * 4); }
    const regionOf = (r0: number, r1: number): { x: number; y: number; width: number; height: number } => {
      const xs: number[] = [], ys: number[] = [];
      for (const [i, j] of [[0, r0], [outWidth - 1, r0], [0, r1 - 1], [outWidth - 1, r1 - 1]] as const) {
        xs.push(affine.ox + affine.axx * i + affine.axy * j); ys.push(affine.oy + affine.ayx * i + affine.ayy * j);
      }
      const x = Math.max(0, Math.min(...xs) - halo), y = Math.max(0, Math.min(...ys) - halo);
      return { x, y, width: Math.min(nativeWidth, Math.max(...xs) + halo + 1) - x, height: Math.min(nativeHeight, Math.max(...ys) + halo + 1) - y };
    };
    const regionBytes = (r0: number, r1: number): number => { const r = regionOf(r0, r1); return r.width * r.height * 4; };
    let bandRows = Math.max(1, Math.min(outHeight, Math.floor(bandBytes / (outWidth * 12))));
    while (bandRows > 1 && regionBytes(0, bandRows) > bandBytes) bandRows = Math.ceil(bandRows / 2);
    if (Math.max(regionBytes(0, bandRows), bandRows * outWidth * 12) > runtime.maximumStorageBindingBytes) {
      throw new ImageKernelExecutionError("insufficient-limits", "One development band exceeds the device's storage binding limit.");
    }
    const pipeline = await pipelines("photivra-raw-development", RAW_DEVELOPMENT_WGSL);
    const output = profile.bitDepth === 8 ? new Uint8Array(outWidth * outHeight * 3) : new Uint16Array(outWidth * outHeight * 3);
    codes = output;
    const counters = NO_COUNTERS();
    const taps = scope.upload("photivra-cfa-taps", new Uint8Array(tapBuffer), BUFFER_USAGE.STORAGE);
    const phaseTable = scope.upload("photivra-cfa-phases", ranges, BUFFER_USAGE.STORAGE);
    for (let r0 = 0; r0 < outHeight; r0 += bandRows) {
      checkAbort(abort);
      const r1 = Math.min(outHeight, r0 + bandRows), region = regionOf(r0, r1), count = (r1 - r0) * outWidth;
      const normalized = new Float32Array(region.width * region.height);
      for (let y = 0; y < region.height; y++) {
        for (let x = 0, i = (region.y + y) * nativeWidth + region.x; x < region.width; x++, i++) {
          normalized[y * region.width + x] = normalizedSite(i, region.x + x, region.y + y);
        }
      }
      words[1] = count; words[2] = r0; words[7] = region.width; ints[14] = region.x; ints[15] = region.y;
      const bandScope = new GpuResourceScope(runtime);
      try {
        const source = bandScope.upload("photivra-raw-normalized", normalized, BUFFER_USAGE.STORAGE);
        const out = bandScope.buffer("photivra-raw-codes", count * 12, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const counterBuffer = bandScope.upload("photivra-raw-counters", new Uint32Array(SDR_COUNTER_SLOTS), BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const uniform = bandScope.upload("photivra-raw-params", new Uint8Array(params), BUFFER_USAGE.UNIFORM);
        const bindGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: source } }, { binding: 2, resource: { buffer: taps } },
          { binding: 3, resource: { buffer: phaseTable } }, { binding: 4, resource: { buffer: out } }, { binding: 5, resource: { buffer: counterBuffer } }] });
        const [codeData, counterData] = await runComputePass(runtime, bandScope, pipeline, bindGroup,
          linearDispatch(count, LINEAR_WORKGROUP_SIZE, runtime.maximumWorkgroupsPerDimension),
          [{ buffer: out, bytes: count * 12 }, { buffer: counterBuffer, bytes: SDR_COUNTER_SLOTS * 4 }], abort.signal);
        mergeCounters(counters, new Uint32Array(counterData!, 0, SDR_COUNTER_SLOTS));
        requireLuminanceDomain(counters);
        requireGamutDecision(reject, counters);
        output.set(new Uint32Array(codeData!, 0, count * 3), r0 * outWidth * 3);
      } finally {
        bandScope.release();
      }
      onProgress?.({ completedTileCount: r1 * tilesPerRow, totalTileCount });
      await yieldControl(abort.signal);
      checkAbort(abort);
    }
    const highlight: RawHighlightDiagnostics = { mode: development.highlightMode, saturatedPixelCount: counters[SDR_COUNTER.saturatedPixels]!,
      whiteBalanceClippedSampleCount: counters[SDR_COUNTER.whiteBalanceClipped]!, reconstructedPixelCount: counters[SDR_COUNTER.reconstructedPixels]! };
    const linearBound = luminance ? counters[SDR_COUNTER.linearBoundBits]! * (1 + 2 ** -20) : bounds.exposed + float32Gamma(3);
    const execution = webGpuExecution(integerCodeBound(maximum, linearBound), counters[SDR_COUNTER.uncertain]!);
    return { raw, phaseProfiles: v.phases, colorProfile: v.color, whiteBalance: v.whiteBalance, borderHandling: v.border, width: outWidth, height: outHeight, integerSamples: output,
      diagnostics: sdrDiagnostics(counters, "consumed-in-raw-development"), highlight, outputEncoding: sdrOutputEncoding(maximum), rendering: profile,
      displayAdaptation: { kind: "external-platform", applied: false, displayCapabilities: "unknown" },
      imageDataPairing: "derived-from-exact-packed-native-raw", producerOriginVerified: false, execution };
  } catch (error) {
    release();
    throw error;
  } finally {
    scope.release();
  }
}
