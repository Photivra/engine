// SPDX-License-Identifier: Apache-2.0

/**
 * #481: the device handling behind `prepareDisplayView(request, { gpu: "auto" | "require", gpuDevice })`. Loaded on demand by
 * `simulate-display-view.ts`, so the GPU code stays out of bundles that never ask for it. One session per prepared view:
 *
 * - the realm's switch (`setWebGpuEnabled(false)`) vetoes before anything else: `"auto"` falls back with `webgpu-disabled`,
 *   `"require"` throws it;
 * - with no renderer registered (the engine registers its renderer, the Speed and Quality kernels of #478 and #479, when this module
 *   loads; a caller may replace it or set null) no device is requested: `unsupported-on-backend`;
 * - the device is the handle's (`gpuDevice`: an `ImageKernelAccelerator`'s device, shared and left to its owner, or a WebGPU
 *   entry point to acquire from), or acquired from `navigator.gpu` and owned by the session; the accelerator's acquisition
 *   reasons apply, and the request's `signal` aborts the acquisition;
 * - the renderer must support the request, else `unsupported-on-backend`; a render the renderer refuses only when rendering
 *   (`unsupported-on-backend` thrown by `render`: a coarse view, a device that fails the composite chart probe, #491) runs the
 *   CPU reference for that render with the same label, and so does a render whose tables or bands exceed the device's limits
 *   (`insufficient-limits` thrown by `render`: #492, a large defocus kernel's table on a scene of many materials);
 * - before the first GPU render on the device a short conformance self-check runs once (single-flight): the built-in cases run
 *   the existing `webgpu-f32` convolution kernel against the float64 reference within its a-priori bound, then the renderer's own
 *   cases; a failure keeps the whole view on the CPU, labelled `conformance-failed`, with the adapter recorded;
 * - GPU renders of one session run one at a time on the device (the accelerator's single flight; later renders wait);
 * - a lost device falls back to the CPU for that render and every later one, labelled `device-lost`; `dispose()` releases an
 *   owned device, and later renders run on the CPU labelled `disposed`.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { getWebGpuEnabled } from "../gpu/webgpu-switch.js";
import { acquireWebGpuRuntime, type WebGpuRuntime } from "../gpu/webgpu-runtime.js";
import { ImageKernelExecutionError, WEBGPU_F32_LIMITATIONS, type ChartCompositeProbeRecord, type ImageKernelAdapterDescription } from "../gpu/image-kernel-execution.js";
import { acceleratorRuntime, convolveIrradianceOnRuntime } from "../gpu/image-kernel-accelerator.js";
import { calculateIrradianceConvolutionPlan, convolveIrradianceRows, type IrradianceConvolutionInput } from "../optics/irradiance-convolution.js";
import type { DisplayViewRenderResult, DisplayViewSetup } from "./display-view.js";
import { displayViewGpuRendererFactory as engineDisplayViewGpuRendererFactory } from "../gpu/display-view-quality-gpu.js";
import { cpuDisplayViewExecution, displayViewGpuRendererFactory, setDisplayViewGpuRendererFactory, type DisplayViewExecution, type DisplayViewGpuConformance, type DisplayViewGpuConformanceCase,
  type DisplayViewGpuFallbackReason, type DisplayViewGpuRenderer, type DisplayViewGpuRequest, type ParsedPrepareDisplayViewOptions } from "./display-view-gpu.js";

// #478, #479: the engine's own renderer, the display view's Speed and Quality kernels behind one renderer
// (`src/gpu/display-view-quality-gpu.ts`), is registered when this module loads (that is, when a prepared view first asks for the
// GPU) unless a caller registered a renderer before; a test that needs "no renderer" sets the factory to null.
if (displayViewGpuRendererFactory() === null) setDisplayViewGpuRendererFactory(engineDisplayViewGpuRendererFactory);

/** Internal: the GPU side of one prepared view. */
export interface DisplayViewGpuSession {
  /** Renders `setup` on the GPU when the session can, else through `cpu`; the label says which ran. */
  render(setup: DisplayViewSetup, signal: AbortSignal | undefined, cpu: () => Promise<DisplayViewRenderResult>): Promise<{ rendered: DisplayViewRenderResult; execution: DisplayViewExecution }>;
  dispose(): void;
}

/** A session that renders every view on the CPU with one fixed reason. */
function cpuSession(options: ParsedPrepareDisplayViewOptions, reason: DisplayViewGpuFallbackReason, detail: string, adapter: ImageKernelAdapterDescription | null,
  conformance: DisplayViewGpuConformance | null): DisplayViewGpuSession {
  const execution = cpuDisplayViewExecution(options.gpu, reason, adapter, conformance, detail);
  return { async render(_setup, _signal, cpu): Promise<{ rendered: DisplayViewRenderResult; execution: DisplayViewExecution }> { return { rendered: await cpu(), execution }; },
    dispose(): void { /* nothing acquired */ } };
}

/** `"require"` throws the reason; `"auto"` gets a CPU session labelled with it. */
function fallBack(options: ParsedPrepareDisplayViewOptions, reason: DisplayViewGpuFallbackReason, detail: string, adapter: ImageKernelAdapterDescription | null = null,
  conformance: DisplayViewGpuConformance | null = null): DisplayViewGpuSession {
  if (options.gpu === "require") throw requireError(reason, detail);
  return cpuSession(options, reason, detail, adapter, conformance);
}
/**
 * The error `"require"` throws instead of falling back. Every display-view fallback reason is also a failure reason of the accelerator's
 * error. A refusal by the composite chart probe carries its record as `probe` (the structured detail of the message).
 */
function requireError(reason: DisplayViewGpuFallbackReason, detail: string, probe: ChartCompositeProbeRecord | null = null): ImageKernelExecutionError {
  const error = new ImageKernelExecutionError(reason, "prepareDisplayView with gpu \"require\": " + detail);
  if (probe) Object.defineProperty(error, "probe", { value: probe, enumerable: true });
  return error;
}
/** The composite chart probe's record on a refusal (`ChartCompositeProbeError.probe`), or null. */
function probeOf(error: unknown): ChartCompositeProbeRecord | null {
  const probe = (error as { probe?: unknown }).probe;
  return typeof probe === "object" && probe !== null ? probe as ChartCompositeProbeRecord : null;
}

/** True for an object shaped like an `ImageKernelAccelerator` (the handle form that shares a device). */
function isAccelerator(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { convolveIrradiance?: unknown }).convolveIrradiance === "function" &&
    typeof (value as { backend?: unknown }).backend === "string";
}

/**
 * Internal (#481): opens the GPU session of a prepared view, or throws (`"require"`) when the GPU cannot be used. Called only
 * for `gpu: "auto" | "require"`.
 */
export async function openDisplayViewGpuSession(options: ParsedPrepareDisplayViewOptions, request: DisplayViewGpuRequest, signal: AbortSignal | undefined): Promise<DisplayViewGpuSession> {
  if (!getWebGpuEnabled()) return fallBack(options, "webgpu-disabled", "WebGPU is switched off in this realm (setWebGpuEnabled(false)).");
  const factory = displayViewGpuRendererFactory();
  if (!factory) return fallBack(options, "unsupported-on-backend", "this version of the engine has no GPU display-view renderer (#478); no device was requested.");
  // #563: the lens signal (projection, distortion, vignetting, rotation) runs on the CPU reference only; no device is requested for it.
  if (request.lens) return fallBack(options, "unsupported-on-backend", "the GPU display-view renderers do not render lens.projection, lens.distortion, lens.vignetting or " +
    "camera rotation (#563); the CPU reference renders them. No device was requested.");
  if (request.mixedIllumination) return fallBack(options, "unsupported-on-backend", "the GPU renderers light chart materials with one illuminant; the CPU reference renders mixed illumination (#550). No device was requested.");
  let runtime: WebGpuRuntime, owned = false;
  if (isAccelerator(options.gpuDevice)) {
    const shared = acceleratorRuntime(options.gpuDevice) as WebGpuRuntime | null | undefined;
    if (shared === undefined) throw new InvalidConfigurationError("prepareDisplayView options.gpuDevice must be an accelerator created by createImageKernelAccelerator.");
    const accelerator = options.gpuDevice as { state: string; fallbackReason: DisplayViewGpuFallbackReason | null };
    if (accelerator.state === "disposed") throw new InvalidConfigurationError("prepareDisplayView options.gpuDevice is a disposed accelerator.");
    if (shared === null) return fallBack(options, accelerator.fallbackReason ?? "webgpu-unavailable", "the given accelerator runs the CPU reference and has no device.");
    if (shared.isLost()) return fallBack(options, "device-lost", "the given accelerator's device was lost.", shared.adapter);
    runtime = shared;
  } else {
    const gpu = options.gpuDevice !== undefined ? options.gpuDevice : (globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu;
    let acquired: Awaited<ReturnType<typeof acquireWebGpuRuntime>>;
    try { acquired = await acquireWebGpuRuntime(gpu, undefined, signal); }
    catch (error) {
      if (error instanceof ImageKernelExecutionError && error.reason === "aborted") throw new InvalidConfigurationError("prepareDisplayView aborted.");
      throw error;
    }
    if ("failure" in acquired) return fallBack(options, acquired.failure, acquired.message);
    runtime = acquired.runtime; owned = true;
  }
  const renderer = factory(runtime), supported = renderer.supports(request);
  if (supported !== true) {
    if (owned) runtime.destroy();
    return fallBack(options, "unsupported-on-backend", "the GPU display-view renderer \"" + renderer.id + "\" does not support this request: " + supported, runtime.adapter);
  }
  return createSession(options, runtime, owned, renderer);
}

// ---------------------------------------------------------------------------------------------------------------
// Run-time conformance self-check.

/** A fixed, seeded test image (mulberry32) for the built-in cases. */
function seededSamples(count: number, seed: number): Float64Array {
  let a = seed >>> 0;
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    out[i] = u < 0.05 ? 0 : 10 ** (u * 6 - 3);
  }
  return out;
}
/** One convolution case: normalized Gaussian kernels of width `sigma` per patch, compared with the float64 reference within the a-priori bound. */
function convolutionCase(id: string, width: number, height: number, radius: number, patchWidth: number, patchHeight: number, seed: number): DisplayViewGpuConformanceCase {
  return { id, async run(runtime, signal): Promise<true | string> {
    const size = 2 * radius + 1, taps = size * size, columns = Math.ceil(width / patchWidth), rows = Math.ceil(height / patchHeight);
    const kernels = new Float64Array(columns * rows * taps);
    for (let p = 0; p < columns * rows; p++) {
      const sigma = 0.6 + 0.4 * (p % 3), scale = 0.8 + 0.05 * p;
      let sum = 0;
      for (let v = -radius; v <= radius; v++) for (let u = -radius; u <= radius; u++) { const w = Math.exp(-0.5 * (u * u + v * v) / (sigma * sigma)); kernels[p * taps + (v + radius) * size + u + radius] = w; sum += w; }
      for (let t = 0; t < taps; t++) kernels[p * taps + t] = kernels[p * taps + t]! / sum * Math.min(1, scale);
    }
    const input: IrradianceConvolutionInput = { schemaVersion: "0.1.0", width, height, kernelRadius: radius, patchWidth, patchHeight, boundary: "zero-outside-grid",
      samples: seededSamples(width * height, seed), kernels };
    const plan = calculateIrradianceConvolutionPlan(input), reference = new Float64Array(width * height);
    convolveIrradianceRows(plan, input.samples, input.kernels, 0, height, reference);
    {
      const result = await convolveIrradianceOnRuntime(runtime, input, signal);
      const bound = result.execution.errorBound;
      if (!bound || bound.kind !== "relative-to-reference") return "the convolution reported no relative bound.";
      let worst = 0, worstIndex = -1;
      for (let i = 0; i < reference.length; i++) {
        const allowed = bound.relative * reference[i]! + bound.absolute, excess = Math.abs(result.values[i]! - reference[i]!) - allowed;
        if (excess > worst) { worst = excess; worstIndex = i; }
      }
      return worstIndex < 0 ? true : "sample " + worstIndex + " differs from the reference by " + Math.abs(result.values[worstIndex]! - reference[worstIndex]!) +
        ", more than the a-priori bound " + (bound.relative * reference[worstIndex]! + bound.absolute) + ".";
    }
  } };
}
/** The built-in cases, run on every device before its first display-view render: the existing convolution kernel on two small images. */
export const DISPLAY_VIEW_GPU_BUILT_IN_CASES: readonly DisplayViewGpuConformanceCase[] = Object.freeze([
  convolutionCase("image-kernel:convolution:16x12-r1", 16, 12, 1, 16, 12, 481),
  convolutionCase("image-kernel:convolution:32x24-r3-patches", 32, 24, 3, 16, 12, 4781)
]);

async function runConformance(runtime: WebGpuRuntime, renderer: DisplayViewGpuRenderer, signal: AbortSignal | undefined): Promise<DisplayViewGpuConformance> {
  const cases = [...DISPLAY_VIEW_GPU_BUILT_IN_CASES, ...(renderer.conformanceCases ?? [])], ids = Object.freeze(cases.map((c) => c.id));
  for (const c of cases) {
    let outcome: true | string;
    try { outcome = await c.run(runtime, signal); }
    catch (error) {
      // An abort is the caller's, not the device's; everything else the device did wrong is a failed case.
      if (error instanceof ImageKernelExecutionError && error.reason === "aborted") throw error;
      outcome = "the case threw " + (error instanceof ImageKernelExecutionError ? error.reason + ": " : "") + (error instanceof Error ? error.message : String(error));
    }
    if (outcome !== true) return Object.freeze({ cases: ids, passed: false, failedCase: c.id, detail: outcome });
  }
  return Object.freeze({ cases: ids, passed: true, failedCase: null, detail: null });
}

// ---------------------------------------------------------------------------------------------------------------

function createSession(options: ParsedPrepareDisplayViewOptions, runtime: WebGpuRuntime, owned: boolean, renderer: DisplayViewGpuRenderer): DisplayViewGpuSession {
  const adapter = runtime.adapter;
  let disposed = false, lost = false, conformance: DisplayViewGpuConformance | null = null, checking: Promise<DisplayViewGpuConformance> | null = null;
  /** The last GPU turn: renders queue behind it, so one dispatch runs at a time on the device. */
  let tail: Promise<unknown> = Promise.resolve();
  /** A CPU fallback label for `"auto"`; with `"require"` the same event is an error. */
  const fallback = async (reason: DisplayViewGpuFallbackReason, detail: string, cpu: () => Promise<DisplayViewRenderResult>, compositeProbe: ChartCompositeProbeRecord | null = null):
    Promise<{ rendered: DisplayViewRenderResult; execution: DisplayViewExecution }> => {
    if (options.gpu === "require") throw requireError(reason, detail, compositeProbe);
    return { rendered: await cpu(), execution: cpuDisplayViewExecution(options.gpu, reason, adapter, conformance, detail, compositeProbe) };
  };
  /** The self-check, run once per session (single flight); a failing check is remembered and never repeated. */
  function selfCheck(signal: AbortSignal | undefined): Promise<DisplayViewGpuConformance> {
    if (conformance) return Promise.resolve(conformance);
    if (!checking) {
      checking = runConformance(runtime, renderer, signal).then((result) => { conformance = result; return result; }, (error: unknown) => { checking = null; throw error; });
    }
    return checking;
  }
  function lostError(error: unknown): boolean { return (error instanceof ImageKernelExecutionError && error.reason === "device-lost") || runtime.isLost(); }
  return {
    async render(setup, signal, cpu): Promise<{ rendered: DisplayViewRenderResult; execution: DisplayViewExecution }> {
      if (disposed) return fallback("disposed", "the prepared view was disposed.", cpu);
      if (lost || runtime.isLost()) { lost = true; return fallback("device-lost", "the WebGPU device was lost; the rest of the view runs on the CPU.", cpu); }
      let check: DisplayViewGpuConformance;
      try { check = await selfCheck(signal); }
      catch (error) {
        if (lostError(error)) { lost = true; return fallback("device-lost", "the WebGPU device was lost during its conformance check.", cpu); }
        setup.checkAbort();
        throw error;
      }
      if (!check.passed) return fallback("conformance-failed", "the device failed conformance case \"" + check.failedCase + "\": " + check.detail, cpu);
      const turn = tail.then(async () => {
        if (disposed || lost || runtime.isLost()) return null;
        setup.checkAbort();
        return renderer.render({ setup, signal });
      });
      tail = turn.catch(() => undefined);
      let output: Awaited<typeof turn>;
      try { output = await turn; }
      catch (error) {
        if (lostError(error)) { lost = true; return fallback("device-lost", "the WebGPU device was lost during a render; the rest of the view runs on the CPU.", cpu); }
        setup.checkAbort();
        if (error instanceof ImageKernelExecutionError && error.reason === "unsupported-on-backend")
          return fallback("unsupported-on-backend", "the GPU display-view renderer \"" + renderer.id + "\" does not cover this render: " + error.message, cpu, probeOf(error));
        // #492: a render past the device's limits (a kernel table or band above its storage binding limit) runs the CPU reference too.
        if (error instanceof ImageKernelExecutionError && error.reason === "insufficient-limits")
          return fallback("insufficient-limits", "the device's limits do not hold this render on the GPU: " + error.message, cpu);
        throw error;
      }
      if (output === null) return this.render(setup, signal, cpu);
      const { errorBound, diagnosticUncertaintySampleCount: uncertainty = 0, compositeProbe = null, ...rendered } = output;
      const execution: DisplayViewExecution = Object.freeze({ gpu: options.gpu, backend: "webgpu-f32", requestedBackend: "webgpu-f32", fallbackReason: null, arithmetic: "float32",
        assurance: "approximation-with-a-priori-bound", fast: true, bitIdenticalToReference: false, errorBound, diagnosticsExact: uncertainty === 0,
        diagnosticUncertaintySampleCount: uncertainty, limitations: WEBGPU_F32_LIMITATIONS, adapter, conformance: check, compositeProbe });
      return { rendered, execution };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      renderer.dispose?.();
      if (owned) runtime.destroy();
    }
  };
}
