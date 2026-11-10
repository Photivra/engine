// SPDX-License-Identifier: Apache-2.0

/**
 * Host side of the `webgpu-f32` chart-radiance stage (#277): per-material value tables in float64 (the
 * reference's own operations), preset constants, banded dispatch, readback, and host recomputation of
 * flagged points with the reference. The float64 reference is `calculateChartRadianceBatch`
 * (facade/chart-radiance-batch.ts). Internal; the public entry point is the image-kernel accelerator.
 */
import { createHostYieldGate } from "../capture/host-yield-cadence.js";
import { calculateChartRadianceBatchPlan, type ChartRadianceBatchInput, type ChartRadianceBatchPlan } from "../facade/chart-radiance-batch.js";
import { calculatePointGridCenters } from "../facade/chart-scenes.js";
import { ImageKernelExecutionError, webGpuExecution, type ImageKernelExecution } from "./image-kernel-execution.js";
import type { ChartRadianceResult } from "./image-kernel-accelerator.js";
import { BUFFER_USAGE, GpuResourceScope, linearDispatch, runComputePass, type WebGpuRuntime, throwIfAborted as checkAbort } from "./webgpu-runtime.js";
import { CHART_PRESET_CODE, CHART_RADIANCE_WGSL, CHART_WORKGROUP_SIZE } from "./wgsl-chart-kernel.js";
import { chartMaterialTable, evaluateChartCompositeOnGpu, integrateChartQueries, type ChartSceneUploads } from "./chart-composite-gpu.js";

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;
type YieldControl = ((signal: AbortSignal) => Promise<void>) | undefined;

/** Frame-unit magnitude limit for GPU points. */
export const CHART_GPU_MAXIMUM_COORDINATE = 2 ** 20;

export async function evaluateChartRadianceOnCpu(input: ChartRadianceBatchInput, abort: AbortController, yieldControl: YieldControl,
  execution: ImageKernelExecution): Promise<ChartRadianceResult> {
  const plan = calculateChartRadianceBatchPlan(input), points = input.points.slice(), indices = input.wavelengthIndices?.slice();
  const values = new Float64Array(plan.queryCount * plan.columns), gate = createHostYieldGate();
  for (let q = 0; q < plan.queryCount; q++) {
    for (let c = 0; c < plan.columns; c++) values[q * plan.columns + c] = plan.queryValue(points, indices, q, c);
    if ((q & 0xffff) === 0xffff) {
      checkAbort(abort.signal);
      if (yieldControl && gate.due()) { await yieldControl(abort.signal); gate.restart(); }
    }
  }
  checkAbort(abort.signal);
  return { plan, values, columns: plan.columns, execution, hostRecomputedQueryIndices: new Uint32Array(0) };
}

/**
 * The preset code of a chart the preset kernel (wgsl-chart-kernel.ts) classifies, or undefined. That kernel covers
 * the eight 2.0 presets as plain charts (a Siemens star only with the bar profile). Everything else, the 2.3
 * elements, the sine star, `composite` charts and `material-layers` scenes, runs on the composite kernel (#477,
 * chart-composite-gpu.ts). @internal
 */
export function chartGpuPresetCode(plan: ChartRadianceBatchPlan): number | undefined {
  const preset = plan.chart.preset;
  if (plan.layers || !Object.prototype.hasOwnProperty.call(CHART_PRESET_CODE, preset) || plan.chart.parameters.profile === "sine") return undefined;
  return CHART_PRESET_CODE[preset as keyof typeof CHART_PRESET_CODE];
}

/** Preset constants (uniform words 3–5 and floats 8–15) and the auxiliary table. @internal */
export function chartGpuConstants(plan: ChartRadianceBatchPlan): { ints: [number, number, number]; floats: number[]; aux: Float32Array<ArrayBuffer> } {
  const chart = plan.chart, p = chart.parameters as Record<string, number>, aspect = chart.aspect;
  switch (chart.preset) {
    case "uniform": return { ints: [0, 0, 0], floats: [], aux: new Float32Array(1) };
    case "slanted-edge": {
      // The same float64 constants as resolveChartScene.
      const t = p.angleDegrees! * Math.PI / 180;
      return { ints: [0, 0, 0], floats: [Math.cos(t), Math.sin(t)], aux: new Float32Array(1) };
    }
    case "siemens-star": {
      const cycles = p.cycles!, r = p.radiusFraction! * aspect, aux = new Float32Array(2 * (2 * cycles + 1));
      // Sector boundaries: phase·2·cycles = k  ⇔  θ = π(k/cycles − 1).
      for (let k = 0; k <= 2 * cycles; k++) { const b = Math.PI * (k / cycles - 1); aux[2 * k] = Math.cos(b); aux[2 * k + 1] = Math.sin(b); }
      return { ints: [cycles, 0, 0], floats: [r * r], aux };
    }
    case "step-wedge": return { ints: [p.steps!, 0, 0], floats: [p.steps! / 2], aux: new Float32Array(1) };
    case "grey-ramp": return { ints: [1024, 0, 0], floats: [512], aux: new Float32Array(1) };
    case "checkerboard": return { ints: [0, 0, 0], floats: [p.squaresAcross! / 2, aspect], aux: new Float32Array(1) };
    case "point-grid": {
      const columns = p.columns!, rows = p.rows!, centers = calculatePointGridCenters({ columns, rows, aspect });
      return { ints: [columns, rows, 0], floats: [columns / 2, aspect, rows / (2 * aspect), p.radius! * p.radius!],
        aux: Float32Array.from(centers.flatMap(c => [c.u, c.v])) };
    }
    case "patches": {
      const columns = p.columns!, rows = p.rows!, count = (chart.parameters.patchIds as readonly string[]).length;
      return { ints: [columns, rows, count], floats: [columns / 2, aspect, rows / (2 * aspect), p.gapFraction! / 2, 1 - p.gapFraction! / 2],
        aux: new Float32Array(1) };
    }
    default: throw new ImageKernelExecutionError("unsupported-on-backend", "webgpu-f32 classifies the eight 2.0 chart presets; use cpu-reference for " + chart.preset + ".");
  }
}

export async function evaluateChartRadianceOnGpu(runtime: WebGpuRuntime, bandBytes: number, input: ChartRadianceBatchInput, abort: AbortController,
  yieldControl: YieldControl, pipelines: PipelineSource, uploads: ChartSceneUploads): Promise<ChartRadianceResult> {
  const plan = calculateChartRadianceBatchPlan(input), points = input.points.slice(), indices = input.wavelengthIndices?.slice();
  const presetCode = chartGpuPresetCode(plan);
  if (presetCode === undefined) return evaluateChartCompositeOnGpu(runtime, bandBytes, plan, input.scene, points, indices, abort, yieldControl, pipelines, uploads);
  for (let i = 0; i < points.length; i++) {
    if (Math.abs(points[i]!) > CHART_GPU_MAXIMUM_COORDINATE) throw new ImageKernelExecutionError("unsupported-float32-domain", "Chart points beyond 2^20 frame units are outside the float32 domain.");
  }
  const { ints, floats, aux } = chartGpuConstants(plan), table = chartMaterialTable(plan), radianceMode = plan.mode === "radiance";
  const columns = plan.columns, stride = radianceMode ? plan.wavelengthsNanometers.length : columns, count = plan.queryCount;
  const bytesPerQuery = 8 + 4 * columns + 4 + 4;
  const rows = Math.max(1, Math.floor(bandBytes / bytesPerQuery));
  if (Math.max(table.byteLength, aux.byteLength, Math.min(rows, count) * 4 * columns) > runtime.maximumStorageBindingBytes) {
    throw new ImageKernelExecutionError("insufficient-limits", "Chart tables or bands exceed the device's storage binding limit.");
  }
  const params = new ArrayBuffer(64), words = new Uint32Array(params), f = new Float32Array(params);
  words[1] = stride; words[2] = presetCode; words[3] = ints[0]; words[4] = ints[1]; words[5] = ints[2]; words[6] = radianceMode ? 1 : 0;
  f.set(floats, 8);
  const pipeline = await pipelines("photivra-chart-radiance", CHART_RADIANCE_WGSL);
  const values = new Float32Array(count * columns), recomputed: number[] = [];
  const scope = new GpuResourceScope(runtime);
  try {
    const tableBuffer = scope.upload("photivra-chart-table", table, BUFFER_USAGE.STORAGE);
    const auxBuffer = scope.upload("photivra-chart-aux", aux, BUFFER_USAGE.STORAGE);
    const gate = createHostYieldGate();
    for (let first = 0; first < count; first += rows) {
      checkAbort(abort.signal);
      const n = Math.min(rows, count - first);
      words[0] = n;
      const band = new GpuResourceScope(runtime);
      try {
        const pointBuffer = band.upload("photivra-chart-points", new Float32Array(points.subarray(2 * first, 2 * (first + n))), BUFFER_USAGE.STORAGE);
        const selectors = band.upload("photivra-chart-selectors", indices ? Uint32Array.from(indices.subarray(first, first + n)) : new Uint32Array(1), BUFFER_USAGE.STORAGE);
        const out = band.buffer("photivra-chart-values", n * 4 * columns, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const flagBuffer = band.buffer("photivra-chart-flags", n * 4, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const uniform = band.upload("photivra-chart-params", new Uint8Array(params), BUFFER_USAGE.UNIFORM);
        const bindGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: pointBuffer } }, { binding: 2, resource: { buffer: tableBuffer } },
          { binding: 3, resource: { buffer: auxBuffer } }, { binding: 4, resource: { buffer: selectors } }, { binding: 5, resource: { buffer: out } },
          { binding: 6, resource: { buffer: flagBuffer } }] });
        const [valueData, flagData] = await runComputePass(runtime, band, pipeline, bindGroup, linearDispatch(n, CHART_WORKGROUP_SIZE, runtime.maximumWorkgroupsPerDimension),
          [{ buffer: out, bytes: n * 4 * columns }, { buffer: flagBuffer, bytes: n * 4 }], abort.signal);
        values.set(new Float32Array(valueData!, 0, n * columns), first * columns);
        const bandFlags = new Uint32Array(flagData!, 0, n);
        for (let i = 0; i < n; i++) {
          let recompute = bandFlags[i] !== 0;
          for (let c = 0; c < columns && !recompute; c++) if (!Number.isFinite(values[(first + i) * columns + c]!)) recompute = true;
          if (recompute) recomputed.push(first + i);
        }
      } finally {
        band.release();
      }
      if (yieldControl && gate.due()) { await yieldControl(abort.signal); gate.restart(); }
    }
  } finally {
    scope.release();
  }
  checkAbort(abort.signal);
  // Spectral integrals: each query's material spectrum against the channel weights, when it is read (2.21.0).
  integrateChartQueries(plan, values, recomputed);
  // Flagged points (and any whose material spectrum failed): the reference's own value, rounded once to float32.
  for (const q of recomputed) for (let c = 0; c < columns; c++) values[q * columns + c] = plan.queryValue(points, indices, q, c);
  const execution = webGpuExecution({ kind: "relative-to-reference", relative: 2 ** -24, absolute: 2 ** -126 }, 0);
  return { plan, values, columns, execution, hostRecomputedQueryIndices: Uint32Array.from(recomputed) };
}
