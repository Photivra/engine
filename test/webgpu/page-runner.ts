// SPDX-License-Identifier: Apache-2.0
/**
 * Browser half of `npm run test:webgpu`: runs the `webgpu-f32` backend (and, for timing only, the CPU
 * reference) on payloads built by the Node driver. All comparison against the reference happens in Node.
 */
import { calculateChartRadianceBatch, createImageKernelAccelerator, ImageKernelExecutionError, type ImageKernelAccelerator, type IrradianceConvolutionInput,
  type NativeCaptureSdrInput, type NativeCaptureSdrProvider, type NativeCaptureSdrTile, type NativeCaptureSdrTileRequest,
  type NativeRawDevelopmentInput, type PackedSensorRawInput, type TemporalExposureSumInput, type ChartRadianceBatchInput } from "../../src/index.js";
import { decodeTransport, encodeTransport } from "./codec.js";
import { displayViewGpuFixture, renderOnGpu, renderOnGpuQuality, timeCpuStages } from "../helpers/display-view-gpu-fixture.js";
import { DISPLAY_VIEW_SPEED_CONFORMANCE_CASE } from "../../src/gpu/display-view-speed-gpu.js";
import { DISPLAY_VIEW_QUALITY_CONFORMANCE_CASE, DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE } from "../../src/gpu/display-view-quality-gpu.js";
import { acquireWebGpuRuntime, createComputePipeline, type WebGpuRuntime } from "../../src/gpu/webgpu-runtime.js";
import { ChartCompositeProbeError, ChartSceneUploads, evaluateChartCompositeOnGpu, probeChartCompositeDevice } from "../../src/gpu/chart-composite-gpu.js";
import { chartCompositeMaterialWgsl } from "../../src/gpu/display-view-composite-material-module.js";
import { assembleDisplayViewSpeedWgsl } from "../../src/gpu/wgsl-display-view-speed-kernel.js";
import { assembleDisplayViewQualityLatticeWgsl } from "../../src/gpu/wgsl-display-view-quality-kernel.js";
import type { ChartCompositeProductPath } from "../../src/gpu/wgsl-chart-composite-kernel.js";
import { runImagePlaneConformance } from "../../src/gpu/display-view-image-material-module.js";
import { calculateChartRadianceBatchPlan, prepareImagePlaneScenes, type ChartCompositeProbeRecord } from "../../src/index.js";
import type { SimulateCaptureOptions, SimulateDisplayViewOptions } from "../../src/index.js";

interface RunRequest<T> { input: T; maximumBandBytes?: number; timeCpu?: boolean; repeat?: number; reference?: boolean }

export async function simulateSensor(payload: string): Promise<string> {
  const request = decodeTransport<RunRequest<PackedSensorRawInput>>(payload);
  const gpu = await timed("webgpu-f32", request.maximumBandBytes, request.repeat ?? 1, a => a.simulateSensorRaw(request.input));
  const cpu = request.timeCpu ? await timed("cpu-reference", undefined, 1, a => a.simulateSensorRaw(request.input)) : null;
  return encodeTransport({ codes: gpu.result.codes, diagnostics: gpu.result.diagnostics, execution: gpu.result.execution,
    flaggedSiteIndices: gpu.result.flaggedSiteIndices, gpuMilliseconds: gpu.milliseconds, cpuMilliseconds: cpu?.milliseconds ?? null });
}

export async function chartRadiance(payload: string): Promise<string> {
  const request = decodeTransport<RunRequest<ChartRadianceBatchInput>>(payload);
  const gpu = await timed("webgpu-f32", request.maximumBandBytes, request.repeat ?? 1, a => a.evaluateChartRadiance(request.input));
  // The float64 reference of this realm, on request: flagged points are recomputed here, with this realm's Math functions.
  const reference = request.reference ? calculateChartRadianceBatch(request.input).values : null;
  return encodeTransport({ values: gpu.result.values, execution: gpu.result.execution, hostRecomputedQueryIndices: gpu.result.hostRecomputedQueryIndices, reference });
}

export async function sumTemporal(payload: string): Promise<string> {
  const request = decodeTransport<RunRequest<TemporalExposureSumInput>>(payload);
  const gpu = await timed("webgpu-f32", request.maximumBandBytes, request.repeat ?? 1, a => a.sumTemporalExposure(request.input));
  const cpu = request.timeCpu ? await timed("cpu-reference", undefined, 1, a => a.sumTemporalExposure(request.input)) : null;
  return encodeTransport({ values: gpu.result.values, execution: gpu.result.execution, gpuMilliseconds: gpu.milliseconds, cpuMilliseconds: cpu?.milliseconds ?? null });
}

/**
 * Timing workload for `npm run bench:webgpu`, built in the page so no large payload crosses the DevTools
 * socket: one width×height frame through the temporal sum (8 nodes), the convolution (radius 7) and the
 * sensor stage. Each GPU stage is timed on its second run (warm pipelines, upload and readback included);
 * CPU reference timings only on request. The adapter is reported so a software adapter is visible.
 */
export async function timeStages(payload: string): Promise<string> {
  const { width, height, timeCpu, readoutProfile } = decodeTransport<{ width: number; height: number; timeCpu: boolean;
    readoutProfile: PackedSensorRawInput["readoutProfile"] }>(payload);
  const count = width * height, rate = new Float64Array(count);
  for (let i = 0; i < count; i++) rate[i] = 1000 + 900 * Math.sin(i * 0.37) * Math.cos(Math.floor(i / width) * 0.21);
  const nodes = 8, displacements = new Float64Array(2 * nodes), rowWeights = new Float64Array(nodes * height).fill(1 / 1000);
  for (let k = 0; k < nodes; k++) { displacements[2 * k] = 0.7 * k; displacements[2 * k + 1] = -0.3 * k; }
  const temporal: TemporalExposureSumInput = { schemaVersion: "0.1.0", width, height, samples: rate, displacements, rowWeights, boundary: "zero-outside-grid" };
  const r = 7, size = 2 * r + 1, patch = Math.min(256, width, height), patches = Math.ceil(width / patch) * Math.ceil(height / patch);
  const convolution: IrradianceConvolutionInput = { schemaVersion: "0.1.0", width, height, kernelRadius: r, patchWidth: patch, patchHeight: patch,
    boundary: "zero-outside-grid", samples: rate, kernels: new Float64Array(patches * size * size).fill(0.999 / (size * size)) };
  const sensor: PackedSensorRawInput = { schemaVersion: "0.1.0", nativeWidth: width, nativeHeight: height, region: { x: 0, y: 0, width, height },
    captureSeedUint32: 7, photoElectrons: rate.map(v => v * 12), darkElectrons: new Float64Array(count).fill(3), physicalChargeCapacityElectrons: 50_000,
    readoutProfile, regimeId: "base" };
  const stages: Record<string, { gpuMilliseconds: number; cpuMilliseconds: number | null }> = {};
  const run = async (name: string, body: (a: ImageKernelAccelerator) => Promise<unknown>): Promise<void> => {
    const gpu = await timed("webgpu-f32", undefined, 2, body);
    const cpu = timeCpu ? await timed("cpu-reference", undefined, 1, body) : null;
    stages[name] = { gpuMilliseconds: gpu.milliseconds, cpuMilliseconds: cpu?.milliseconds ?? null };
  };
  await run("temporalSum8Nodes", a => a.sumTemporalExposure(temporal));
  await run("convolutionRadius7", a => a.convolveIrradiance(convolution));
  await run("sensorStage", a => a.simulateSensorRaw(sensor));
  return encodeTransport({ adapter: (await probe()).adapter, width, height, megapixels: count / 1e6, stages });
}

export async function probe(): Promise<{ available: boolean; adapter?: { vendor: string; architecture: string; isFallbackAdapter: boolean } }> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return { available: false };
  const adapter = await gpu.requestAdapter();
  if (!adapter) return { available: false };
  const info = adapter.info;
  return { available: true, adapter: { vendor: info.vendor, architecture: info.architecture,
    isFallbackAdapter: (info as GPUAdapterInfo & { isFallbackAdapter?: boolean }).isFallbackAdapter ?? false } };
}

function provider(packed: Float32Array | Float64Array, width: number): NativeCaptureSdrProvider {
  return {
    async readTile(request: NativeCaptureSdrTileRequest): Promise<NativeCaptureSdrTile> {
      const stride = request.width * 3 + 3, samples = new (packed.constructor as Float64ArrayConstructor)(stride * request.height).fill(NaN);
      for (let y = 0; y < request.height; y++) {
        samples.set(packed.subarray(((request.y + y) * width + request.x) * 3, ((request.y + y) * width + request.x + request.width) * 3), y * stride);
      }
      return { ...request, rowStrideSamples: stride, samples };
    },
    async yieldControl(): Promise<void> {}
  };
}

async function accelerator(backend: "webgpu-f32" | "cpu-reference", maximumBandBytes?: number): Promise<ImageKernelAccelerator> {
  return backend === "cpu-reference" ? createImageKernelAccelerator({ backend })
    : createImageKernelAccelerator({ backend, fallback: "fail", ...(maximumBandBytes ? { maximumBandBytes } : {}) });
}

/** Runs `body` `repeat` times on a fresh accelerator; reports the last run (warm pipelines) and its time. */
async function timed<T>(backend: "webgpu-f32" | "cpu-reference", maximumBandBytes: number | undefined, repeat: number,
  body: (a: ImageKernelAccelerator) => Promise<T>): Promise<{ result: T; milliseconds: number }> {
  const a = await accelerator(backend, maximumBandBytes);
  try {
    let result: T | undefined, milliseconds = 0;
    for (let i = 0; i < repeat; i++) { const start = performance.now(); result = await body(a); milliseconds = performance.now() - start; }
    return { result: result!, milliseconds };
  } finally { a.dispose(); }
}

export async function convolve(payload: string): Promise<string> {
  const request = decodeTransport<RunRequest<IrradianceConvolutionInput>>(payload);
  const gpu = await timed("webgpu-f32", request.maximumBandBytes, request.repeat ?? 1, a => a.convolveIrradiance(request.input));
  const cpu = request.timeCpu ? await timed("cpu-reference", undefined, 1, a => a.convolveIrradiance(request.input)) : null;
  return encodeTransport({ values: gpu.result.values, execution: gpu.result.execution, gpuMilliseconds: gpu.milliseconds, cpuMilliseconds: cpu?.milliseconds ?? null });
}

export async function renderSdr(payload: string): Promise<string> {
  const request = decodeTransport<RunRequest<{ sdr: NativeCaptureSdrInput; packed: Float32Array | Float64Array; width: number }>>(payload);
  const { sdr, packed, width } = request.input;
  const gpu = await timed("webgpu-f32", request.maximumBandBytes, request.repeat ?? 1, a => a.renderNativeCaptureSdr(sdr, provider(packed, width)));
  const cpu = request.timeCpu ? await timed("cpu-reference", undefined, 1, a => a.renderNativeCaptureSdr(sdr, provider(packed, width))) : null;
  return encodeTransport({ codes: gpu.result.integerSamples, diagnostics: gpu.result.diagnostics, execution: gpu.result.execution,
    gpuMilliseconds: gpu.milliseconds, cpuMilliseconds: cpu?.milliseconds ?? null });
}

export async function developRaw(payload: string): Promise<string> {
  const request = decodeTransport<RunRequest<NativeRawDevelopmentInput>>(payload);
  // Development takes RAW ownership, so every run gets its own decoded copy.
  const fresh = (): NativeRawDevelopmentInput => decodeTransport<RunRequest<NativeRawDevelopmentInput>>(payload).input;
  const gpu = await timed("webgpu-f32", request.maximumBandBytes, request.repeat ?? 1, a => a.developNativeRaw(fresh(), async () => {}));
  const cpu = request.timeCpu ? await timed("cpu-reference", undefined, 1, a => a.developNativeRaw(fresh(), async () => {})) : null;
  return encodeTransport({ codes: gpu.result.integerSamples, diagnostics: gpu.result.diagnostics, highlight: gpu.result.highlight,
    execution: gpu.result.execution, gpuMilliseconds: gpu.milliseconds, cpuMilliseconds: cpu?.milliseconds ?? null });
}

function describe(error: unknown): string {
  return error instanceof ImageKernelExecutionError ? `${error.name}:${error.reason}` : error instanceof Error ? `${error.name}:${error.message}` : String(error);
}

/** Abort, dispose and rejection behaviour on a real device. */
export async function lifecycle(payload: string): Promise<Record<string, string>> {
  const request = decodeTransport<RunRequest<{ sdr: NativeCaptureSdrInput; packed: Float32Array | Float64Array; width: number; reject: NativeCaptureSdrInput }>>(payload);
  const { sdr, packed, width, reject } = request.input, outcomes: Record<string, string> = {};
  const a = await accelerator("webgpu-f32");
  const controller = new AbortController();
  const tiles = provider(packed, width);
  let reads = 0;
  outcomes.abort = await a.renderNativeCaptureSdr(sdr, { ...tiles, readTile: (r, s) => { if (++reads === 2) controller.abort(); return tiles.readTile(r, s); } },
    { signal: controller.signal }).then(() => "resolved", describe);
  outcomes.afterAbort = await a.renderNativeCaptureSdr(sdr, tiles).then(r => `resolved:${r.execution.backend}`, describe);
  outcomes.reject = await a.renderNativeCaptureSdr(reject, tiles).then(() => "resolved", describe);
  const pending = a.renderNativeCaptureSdr(sdr, tiles);
  outcomes.busy = await a.renderNativeCaptureSdr(sdr, tiles).then(() => "resolved", describe);
  await pending;
  const inFlight = a.renderNativeCaptureSdr(sdr, { ...tiles, readTile: (r, s) => { a.dispose(); return tiles.readTile(r, s); } });
  outcomes.disposeInFlight = await inFlight.then(() => "resolved", describe);
  outcomes.state = a.state;
  outcomes.afterDispose = await a.renderNativeCaptureSdr(sdr, tiles).then(() => "resolved", describe);
  return outcomes;
}

async function runtime(): Promise<WebGpuRuntime> {
  const acquired = await acquireWebGpuRuntime((navigator as Navigator & { gpu?: GPU }).gpu, undefined, undefined);
  if ("failure" in acquired) throw new ImageKernelExecutionError(acquired.failure, acquired.message);
  return acquired.runtime;
}

/**
 * #478: the display view's Speed kernel on the device. The page renders the CPU reference too (its bytes, for the Node driver
 * to check against its own), then the GPU render with the chart-preset material module; everything after the moments (noise
 * draw, encode) runs on the host in float64 as in the CPU path.
 */
export async function displayViewSpeed(payload: string): Promise<string> {
  await prepareImagePlaneScenes(); // #581: the image-plane cases (charts are unaffected)
  const { options, view, maximumBandBytes, recomputeFlagged, repeat } = decodeTransport<{ options: SimulateCaptureOptions; view: SimulateDisplayViewOptions; maximumBandBytes?: number;
    recomputeFlagged?: boolean; repeat?: number }>(payload);
  const fixture = await displayViewGpuFixture(options, view), device = await runtime();
  try {
    let result: Awaited<ReturnType<typeof renderOnGpu>> | undefined, milliseconds = 0;
    for (let i = 0; i < (repeat ?? 1); i++) {
      const start = performance.now();
      result = await renderOnGpu(device, fixture, maximumBandBytes, recomputeFlagged ?? true);
      milliseconds = performance.now() - start;
    }
    const gpu = result!;
    return encodeTransport({ cpu: { samples: fixture.cpu.samples, expected: fixture.cpu.expected, noiseStd: fixture.cpu.noiseStd, saturated: fixture.cpu.saturated },
      gpu: { samples: gpu.samples, expected: gpu.expected, noiseStd: gpu.noiseStd, expectedValueBound: gpu.expectedValueBound, varianceBound: gpu.varianceBound,
        expectedValueAbsoluteBound: gpu.expectedValueAbsoluteBound, varianceAbsoluteBound: gpu.varianceAbsoluteBound, saturated: gpu.saturated },
      flaggedPixelIndices: gpu.flaggedPixelIndices, hostRecomputedPixelIndices: gpu.hostRecomputedPixelIndices, highlightRecomputedPixelIndices: gpu.highlightRecomputedPixelIndices,
      execution: gpu.execution, gpuMilliseconds: milliseconds });
  } finally { device.destroy(); }
}

/** #478: the renderer's run-time self-check case on the device. */
export async function displayViewConformance(): Promise<string> {
  const device = await runtime();
  try { return encodeTransport({ outcome: await DISPLAY_VIEW_SPEED_CONFORMANCE_CASE.run(device, undefined) }); }
  finally { device.destroy(); }
}

/** #581: the image-plane module's run-time self-check case on the device. */
export async function displayViewImagePlaneConformance(): Promise<string> {
  await prepareImagePlaneScenes();
  const device = await runtime();
  try { return encodeTransport({ outcome: await runImagePlaneConformance(device, undefined) }); }
  finally { device.destroy(); }
}

/**
 * #479: the display view's Quality kernels on the device (diffraction, the four-spot filter and AHD),
 * as `displayViewSpeed`: the page's own CPU reference, the GPU render, the per-stage wall-clock milliseconds of the last run.
 */
export async function displayViewQuality(payload: string): Promise<string> {
  const { options, view, maximumBandBytes, recomputeFlagged, repeat, timeCpu } = decodeTransport<{ options: SimulateCaptureOptions; view: SimulateDisplayViewOptions; maximumBandBytes?: number;
    recomputeFlagged?: boolean; repeat?: number; timeCpu?: boolean }>(payload);
  await prepareImagePlaneScenes(); // #581: the image-plane cases (charts are unaffected)
  const fixture = await displayViewGpuFixture(options, view), device = await runtime();
  try {
    // The CPU reference's stages in this realm, on request (#479's AHD placement); then the GPU render.
    const cpuStages = timeCpu ? await timeCpuStages(fixture) : null;
    let result: Awaited<ReturnType<typeof renderOnGpuQuality>> | undefined, milliseconds = 0;
    for (let i = 0; i < (repeat ?? 1); i++) {
      const start = performance.now();
      result = await renderOnGpuQuality(device, fixture, maximumBandBytes, recomputeFlagged ?? true);
      milliseconds = performance.now() - start;
    }
    const gpu = result!;
    return encodeTransport({ cpu: { samples: fixture.cpu.samples, expected: fixture.cpu.expected, noiseStd: fixture.cpu.noiseStd,
      saturated: fixture.cpu.saturated },
      gpu: { samples: gpu.samples, expected: gpu.expected, noiseStd: gpu.noiseStd, expectedValueBound: gpu.expectedValueBound, varianceBound: gpu.varianceBound,
        expectedValueAbsoluteBound: gpu.expectedValueAbsoluteBound, varianceAbsoluteBound: gpu.varianceAbsoluteBound, saturated: gpu.saturated },
      flaggedPixelIndices: gpu.flaggedPixelIndices, hostRecomputedPixelIndices: gpu.hostRecomputedPixelIndices, highlightRecomputedPixelIndices: gpu.highlightRecomputedPixelIndices,
      execution: gpu.execution, gpuMilliseconds: milliseconds,
      stageMilliseconds: gpu.stageMilliseconds, tapsPerSite: gpu.tapsPerSite, cpuStages,
      blockedSum: gpu.blockedSum, siteSumRelativeBound: gpu.siteSumRelativeBound, latticePointsResolved: gpu.latticePointsResolved, pixelFlags: gpu.pixelFlags });
  } finally { device.destroy(); }
}

/** #492: the defocus self-check case (blocked site sum over several dispatches) on the device. */
export async function displayViewQualityDefocusConformance(): Promise<string> {
  const device = await runtime();
  try { return encodeTransport({ outcome: await DISPLAY_VIEW_QUALITY_DEFOCUS_CONFORMANCE_CASE.run(device, undefined) }); }
  finally { device.destroy(); }
}

/** #479: the Quality self-check case on the device. */
export async function displayViewQualityConformance(): Promise<string> {
  const device = await runtime();
  try { return encodeTransport({ outcome: await DISPLAY_VIEW_QUALITY_CONFORMANCE_CASE.run(device, undefined) }); }
  finally { device.destroy(); }
}

/**
 * 2.11.0 (the M5 Pro finding): the composite chart probe on this device, its raw outputs, and the composite kernel compiled with a
 * given product path regardless of the probe's choice, evaluated on `input` (both paths compile and run here; Node checks the values).
 * Also compiles the display view's Speed and Quality-lattice shaders with the composite module of each path.
 */
export async function compositeProbe(payload: string): Promise<string> {
  const { input, path } = decodeTransport<{ input: ChartRadianceBatchInput; path: ChartCompositeProductPath }>(payload);
  const acquired = await acquireWebGpuRuntime((navigator as Navigator & { gpu?: GPU }).gpu, undefined, undefined);
  if (!("runtime" in acquired)) throw new Error(acquired.message);
  const runtime = acquired.runtime, pipelines = new Map<string, Promise<GPUComputePipeline>>();
  const source = (label: string, code: string): Promise<GPUComputePipeline> => {
    let pending = pipelines.get(label);
    if (!pending) { pending = createComputePipeline(runtime, label, code, undefined); pipelines.set(label, pending); }
    return pending;
  };
  try {
    const record = await probeChartCompositeDevice(runtime, source, new AbortController().signal).catch((error: unknown) => {
      if (error instanceof ChartCompositeProbeError) return error.probe;
      throw error;
    });
    const compiled: Record<string, boolean | string> = {};
    for (const p of ["dekker", "fma"] as const) {
      for (const [kernel, code] of [["speed", assembleDisplayViewSpeedWgsl(chartCompositeMaterialWgsl(p))], ["quality-lattice", assembleDisplayViewQualityLatticeWgsl(chartCompositeMaterialWgsl(p))]] as const) {
        compiled[kernel + ":" + p] = await createComputePipeline(runtime, "photivra-compile-check-" + kernel + "-" + p, code, undefined).then(() => true, (e: unknown) => String(e));
      }
    }
    // The kernel with the requested path: the uploads' probe is replaced by a record that names it.
    const uploads = new (class extends ChartSceneUploads { override probe(): Promise<ChartCompositeProbeRecord> { return Promise.resolve({ ...record, productPath: path }); } })(runtime);
    const plan = calculateChartRadianceBatchPlan(input);
    const result = await evaluateChartCompositeOnGpu(runtime, 64 * 1024 * 1024, plan, input.scene, input.points, input.wavelengthIndices, new AbortController(), undefined, source, uploads);
    uploads.release();
    return encodeTransport({ record, compiled, values: result.values, hostRecomputedQueryIndices: result.hostRecomputedQueryIndices, reference: calculateChartRadianceBatch(input).values });
  } finally { runtime.destroy(); }
}
