// SPDX-License-Identifier: Apache-2.0

/**
 * Internal WebGPU device handling for the image-kernel accelerator: getting the adapter and device,
 * limits, tracking device loss, racing work against abort and loss, error scopes, banded buffers and
 * cleanup. Not exported from the package root. WebGPU types never appear in the published type
 * declarations, so consumers do not need WebGPU typings.
 */
import { ImageKernelExecutionError, type ImageKernelAdapterDescription, type ImageKernelFallbackReason } from "./image-kernel-execution.js";

/** WebGPU spec constants (GPUBufferUsage, GPUMapMode), defined here so no global is needed at import time. */
export const BUFFER_USAGE = /* @__PURE__ */ Object.freeze({ MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, UNIFORM: 0x0040, STORAGE: 0x0080 });
const MAP_MODE_READ = 0x0001;

/** Minimum per-binding storage this backend requires (the WebGPU default is 128 MiB). */
export const WEBGPU_MINIMUM_STORAGE_BINDING_BYTES = 16 * 1024 * 1024;
/** Upper limit requested from the adapter, so one band never asks for more than this per binding. */
export const WEBGPU_REQUESTED_STORAGE_BINDING_BYTES = 1024 * 1024 * 1024;

export interface WebGpuRuntime {
  readonly device: GPUDevice;
  /** #481: the adapter's `info`, or null when the implementation has none. */
  readonly adapter: ImageKernelAdapterDescription | null;
  readonly maximumStorageBindingBytes: number;
  readonly maximumWorkgroupsPerDimension: number;
  /** Set once `device.lost` settles; every later wait rejects with `device-lost`. */
  isLost(): boolean;
  /** Races a GPU promise with device loss and the operation's abort signal. */
  guard<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T>;
  destroy(): void;
}

export type WebGpuAcquisition = { runtime: WebGpuRuntime } | { failure: ImageKernelFallbackReason; message: string };

function hostIsLittleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

export function abortedError(): ImageKernelExecutionError {
  return new ImageKernelExecutionError("aborted", "Image-kernel execution was aborted; no output is available.");
}
/** Throws `abortedError()` when the signal has aborted. */
export function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortedError(); }

/** Rejects when the signal aborts; the returned cleanup removes the listener. */
function abortRace(signal: AbortSignal | undefined): { promise: Promise<never>; cleanup: () => void } {
  if (!signal) return { promise: new Promise<never>(() => undefined), cleanup: () => undefined };
  let cleanup = (): void => undefined;
  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) { reject(abortedError()); return; }
    const listener = (): void => reject(abortedError());
    signal.addEventListener("abort", listener, { once: true });
    cleanup = (): void => signal.removeEventListener("abort", listener);
  });
  promise.catch(() => undefined);
  return { promise, cleanup };
}

/**
 * Requests a device with high limits from `gpu` (normally `navigator.gpu`). It does not throw when
 * WebGPU is unavailable; the caller decides whether to fall back to the CPU or fail. An abort during
 * acquisition does throw.
 */
export async function acquireWebGpuRuntime(gpu: unknown, powerPreference: "low-power" | "high-performance" | undefined,
  signal: AbortSignal | undefined): Promise<WebGpuAcquisition> {
  if (!hostIsLittleEndian()) return { failure: "unsupported-platform-endianness", message: "WebGPU buffers require a little-endian host." };
  const api = gpu as Partial<GPU> | null | undefined;
  if (!api || typeof api !== "object" || typeof api.requestAdapter !== "function") {
    return { failure: "webgpu-unavailable", message: "WebGPU is not available in this runtime." };
  }
  const abort = abortRace(signal);
  try {
    let adapter: GPUAdapter | null;
    try {
      adapter = await Promise.race([api.requestAdapter(powerPreference ? { powerPreference } : undefined), abort.promise]);
    } catch (error) {
      if (error instanceof ImageKernelExecutionError) throw error;
      adapter = null;
    }
    if (!adapter) return { failure: "adapter-unavailable", message: "No WebGPU adapter is available." };
    const adapterStorage = adapter.limits.maxStorageBufferBindingSize, adapterBuffer = adapter.limits.maxBufferSize;
    if (!(adapterStorage >= WEBGPU_MINIMUM_STORAGE_BINDING_BYTES && adapterBuffer >= WEBGPU_MINIMUM_STORAGE_BINDING_BYTES)) {
      return { failure: "insufficient-limits", message: "The WebGPU adapter's storage-buffer limits are below the backend minimum." };
    }
    const storage = Math.min(adapterStorage, adapterBuffer, WEBGPU_REQUESTED_STORAGE_BINDING_BYTES);
    let device: GPUDevice, pending: Promise<GPUDevice> | undefined;
    try {
      pending = adapter.requestDevice({ label: "photivra-image-kernels",
        requiredLimits: { maxStorageBufferBindingSize: storage, maxBufferSize: storage } });
      device = await Promise.race([pending, abort.promise]);
    } catch (error) {
      if (error instanceof ImageKernelExecutionError) {
        // The abort won the race. A device that still arrives later is destroyed, so it never leaks.
        if (pending) void Promise.resolve(pending).then(late => late.destroy(), () => undefined);
        throw error;
      }
      return { failure: "device-request-failed", message: "The WebGPU device request failed." };
    }
    if (signal?.aborted) { device.destroy(); throw abortedError(); }
    return { runtime: createRuntime(device, storage, describeAdapter(adapter)) };
  } finally {
    abort.cleanup();
  }
}

/** `GPUAdapter.info` as plain strings (missing or non-string fields read as empty), or null when the adapter has no `info`. */
function describeAdapter(adapter: GPUAdapter): ImageKernelAdapterDescription | null {
  const info = (adapter as { info?: Partial<Record<keyof ImageKernelAdapterDescription, unknown>> | null }).info;
  if (!info || typeof info !== "object") return null;
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  return { vendor: text(info.vendor), architecture: text(info.architecture), device: text(info.device), description: text(info.description) };
}

function createRuntime(device: GPUDevice, storage: number, adapter: ImageKernelAdapterDescription | null): WebGpuRuntime {
  let lost = false, destroyed = false;
  let rejectLost: (error: ImageKernelExecutionError) => void = () => undefined;
  const lostPromise = new Promise<never>((_, reject) => { rejectLost = reject; });
  lostPromise.catch(() => undefined);
  void device.lost.then(() => {
    lost = true;
    rejectLost(new ImageKernelExecutionError("device-lost", "The WebGPU device was lost; no output is available."));
  });
  // Errors are collected through error scopes; this only keeps uncaptured errors out of the console.
  device.onuncapturederror = (event: GPUUncapturedErrorEvent): void => { event.preventDefault(); };
  const maximumWorkgroupsPerDimension = device.limits.maxComputeWorkgroupsPerDimension;
  return {
    device, adapter,
    maximumStorageBindingBytes: Math.min(storage, device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize),
    maximumWorkgroupsPerDimension,
    isLost: (): boolean => lost,
    async guard<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
      promise.catch(() => undefined);
      if (lost) throw new ImageKernelExecutionError("device-lost", "The WebGPU device was lost; no output is available.");
      const abort = abortRace(signal);
      try { return await Promise.race([promise, lostPromise, abort.promise]); } finally { abort.cleanup(); }
    },
    destroy(): void { if (!destroyed) { destroyed = true; device.destroy(); } }
  };
}

/** Per-operation resource scope: every buffer is destroyed when the operation settles. */
export class GpuResourceScope {
  readonly #runtime: WebGpuRuntime;
  readonly #buffers: GPUBuffer[] = [];

  constructor(runtime: WebGpuRuntime) { this.#runtime = runtime; }

  buffer(label: string, size: number, usage: number): GPUBuffer {
    const buffer = this.#runtime.device.createBuffer({ label, size: Math.max(16, Math.ceil(size / 16) * 16), usage });
    this.#buffers.push(buffer);
    return buffer;
  }

  /** Storage buffer initialised from host data (padded to a 16-byte multiple). */
  upload(label: string, data: ArrayBufferView<ArrayBuffer>, usage: number): GPUBuffer {
    const buffer = this.buffer(label, data.byteLength, usage | BUFFER_USAGE.COPY_DST);
    if (data.byteLength > 0) this.#runtime.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
  }

  release(): void {
    for (const buffer of this.#buffers.splice(0)) buffer.destroy();
  }
}

/** Workgroup grid for a 1-D invocation count (2-D when it exceeds one dimension). */
export function linearDispatch(invocations: number, workgroupSize: number, maximumPerDimension: number): [number, number] {
  const groups = Math.max(1, Math.ceil(invocations / workgroupSize));
  const x = Math.min(groups, maximumPerDimension), y = Math.ceil(groups / x);
  if (y > maximumPerDimension) {
    throw new ImageKernelExecutionError("insufficient-limits", "Band exceeds the adapter's dispatch limits.");
  }
  return [x, y];
}

/**
 * Submits one compute pass and copies `outputs` into mappable staging buffers, then maps them. Validation
 * and out-of-memory errors are captured with error scopes and reported as domain errors.
 */
export async function runComputePass(runtime: WebGpuRuntime, scope: GpuResourceScope, pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup | readonly GPUBindGroup[], workgroups: readonly [number, number], outputs: readonly { buffer: GPUBuffer; bytes: number }[],
  signal: AbortSignal | undefined): Promise<ArrayBuffer[]> {
  const device = runtime.device;
  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("validation");
  const staging = outputs.map(({ bytes }, i) =>
    scope.buffer(`photivra-readback-${i}`, bytes, BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST));
  const encoder = device.createCommandEncoder({ label: "photivra-image-kernel" });
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  // One bind group at index 0, or several at indices 0, 1, … (the display-view kernel binds its material module at 1).
  (Array.isArray(bindGroup) ? bindGroup as readonly GPUBindGroup[] : [bindGroup as GPUBindGroup]).forEach((group, index) => pass.setBindGroup(index, group));
  pass.dispatchWorkgroups(workgroups[0], workgroups[1]);
  pass.end();
  outputs.forEach(({ buffer }, i) => encoder.copyBufferToBuffer(buffer, 0, staging[i]!, 0, staging[i]!.size));
  device.queue.submit([encoder.finish()]);
  // Pop both scopes before any await so an abort or loss never leaves the device's scope stack unbalanced.
  const validationScope = device.popErrorScope(), memoryScope = device.popErrorScope();
  const validation = await runtime.guard(validationScope, signal);
  const memory = await runtime.guard(memoryScope, signal);
  if (memory) throw new ImageKernelExecutionError("out-of-memory", "The WebGPU device ran out of memory.");
  if (validation) throw new ImageKernelExecutionError("gpu-validation", "WebGPU rejected an image-kernel command.");
  const results: ArrayBuffer[] = [];
  for (let i = 0; i < staging.length; i++) {
    const buffer = staging[i]!;
    await runtime.guard(buffer.mapAsync(MAP_MODE_READ), signal);
    results.push(buffer.getMappedRange(0, Math.ceil(outputs[i]!.bytes / 4) * 4).slice(0));
    buffer.unmap();
  }
  return results;
}

/** Compiles a compute pipeline; compilation/validation failures are domain errors. */
export async function createComputePipeline(runtime: WebGpuRuntime, label: string, code: string,
  signal: AbortSignal | undefined): Promise<GPUComputePipeline> {
  const device = runtime.device;
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ label, code });
  const pending = device.createComputePipelineAsync({ label, layout: "auto", compute: { module, entryPoint: "main" } });
  const scope = device.popErrorScope();
  let pipeline: GPUComputePipeline;
  try {
    pipeline = await runtime.guard(pending, signal);
  } catch (error) {
    if (error instanceof ImageKernelExecutionError) throw error;
    throw new ImageKernelExecutionError("gpu-validation", `WebGPU could not compile the ${label} kernel.`);
  }
  if (await runtime.guard(scope, signal)) {
    throw new ImageKernelExecutionError("gpu-validation", `WebGPU could not compile the ${label} kernel.`);
  }
  return pipeline;
}
