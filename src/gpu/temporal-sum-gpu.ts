// SPDX-License-Identifier: Apache-2.0

/**
 * `webgpu-f32` and CPU-reference execution of the temporal exposure sum (#277, step 3). The equation
 * and summation order are those of `sumTemporalExposureRows` (motion/temporal-exposure-sum.ts).
 * Internal; the public entry point is the image-kernel accelerator.
 */
import { createHostYieldGate } from "../capture/host-yield-cadence.js";
import { sumTemporalExposureRows, type TemporalExposureSumInput, type TemporalExposureSumPlan } from "../motion/temporal-exposure-sum.js";
import { ImageKernelExecutionError, float32Gamma, webGpuExecution, type ImageKernelExecution, type ImageKernelRelativeErrorBound } from "./image-kernel-execution.js";
import { BUFFER_USAGE, GpuResourceScope, abortedError, runComputePass, type WebGpuRuntime } from "./webgpu-runtime.js";
import type { TemporalExposureSumResult } from "./image-kernel-accelerator.js";

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;
type YieldControl = ((signal: AbortSignal) => Promise<void>) | undefined;

export const TEMPORAL_WORKGROUP_EDGE = 16;
const MAXIMUM_TAPS_PER_DISPATCH = 2 ** 30;
const FLOAT32_SUBNORMAL_LIMIT = 2 ** -126;

/**
 * A-priori float32 bound for every output (all terms are non-negative): each term carries at most K + 7
 * roundings (sample, bilinear weight and their product, three inner additions, row weight and its
 * product, K − 1 outer additions), so |v_f32 − v_ref| ≤ (γ_{K+8} + 2^-40)·v_ref + K·(8·w_max + 2)·2^-126 + R.
 * The 2^-40 covers the float64 reference's own rounding; the 2^-126 term covers subnormal flush-to-zero of
 * samples, products and sums. R covers weights below the float32 normal range, which the host conversion may round
 * to zero or a subnormal (|f32(w) − w| ≤ w) and the GPU may flush, putting their whole term at risk:
 * R = 2·S_max·Σ_k (max_y ρ_k(y) + w_max·Σ_j β_{k,j}), where ρ_k(y) and β_{k,j} are the row and bilinear weights in
 * (0, 2^-126) (zero otherwise) and the factor 2 covers the conversion and the later roundings. R = 0 when no such
 * weight exists.
 */
export function temporalExposureSumErrorBound(plan: TemporalExposureSumPlan, rowWeights: Float32Array | Float64Array): ImageKernelRelativeErrorBound {
  const tiny = (w: number): number => (w < FLOAT32_SUBNORMAL_LIMIT ? w : 0);
  let atRisk = 0;
  for (let k = 0; k < plan.nodeCount; k++) {
    let largestRow = 0;
    for (let y = 0; y < plan.height; y++) largestRow = Math.max(largestRow, tiny(rowWeights[k * plan.height + y]!));
    atRisk += largestRow + plan.maximumWeight * plan.nodes[k]!.weights.reduce((sum, b) => sum + tiny(b), 0);
  }
  return { kind: "relative-to-reference", relative: float32Gamma(plan.nodeCount + 8) + 2 ** -40,
    absolute: plan.nodeCount * (8 * plan.maximumWeight + 2) * FLOAT32_SUBNORMAL_LIMIT + 2 * plan.maximumSampleMagnitude * atRisk };
}

export const TEMPORAL_SUM_WGSL = /* wgsl */ `
struct Params { width: u32, height: u32, nodes: u32, out_row0: u32, out_rows: u32, in_row0: u32, pad0: u32, pad1: u32 };
struct Node { ox: i32, oy: i32, pad0: i32, pad1: i32, b: vec4<f32> };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read> nodes: array<Node>;
@group(0) @binding(3) var<storage, read> weights: array<f32>;
@group(0) @binding(4) var<storage, read_write> result: array<f32>;
fn sample(sx: i32, sy: i32) -> f32 { return source[u32(sy - i32(params.in_row0)) * params.width + u32(sx)]; }
@compute @workgroup_size(${TEMPORAL_WORKGROUP_EDGE}, ${TEMPORAL_WORKGROUP_EDGE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let local_y = gid.y;
  if (gid.x >= params.width || local_y >= params.out_rows) { return; }
  let y = i32(params.out_row0 + local_y);
  let w = i32(params.width);
  let h = i32(params.height);
  var sum = 0.0;
  for (var k = 0u; k < params.nodes; k = k + 1u) {
    let node = nodes[k];
    let sx = x + node.ox;
    let sy = y + node.oy;
    let left = sx >= 0 && sx < w;
    let right = sx + 1 >= 0 && sx + 1 < w;
    let top = sy >= 0 && sy < h;
    let bottom = sy + 1 >= 0 && sy + 1 < h;
    var inner = 0.0;
    if (top && left) { inner = inner + node.b.x * sample(sx, sy); }
    if (top && right) { inner = inner + node.b.y * sample(sx + 1, sy); }
    if (bottom && left) { inner = inner + node.b.z * sample(sx, sy + 1); }
    if (bottom && right) { inner = inner + node.b.w * sample(sx + 1, sy + 1); }
    sum = sum + weights[k * params.out_rows + local_y] * inner;
  }
  result[local_y * params.width + gid.x] = sum;
}
`;

function checkAbort(abort: AbortController): void {
  if (abort.signal.aborted) throw abortedError();
}

export async function sumTemporalExposureOnCpu(plan: TemporalExposureSumPlan, input: TemporalExposureSumInput, abort: AbortController,
  yieldControl: YieldControl, execution: ImageKernelExecution): Promise<TemporalExposureSumResult> {
  const samples = input.samples.slice(), weights = input.rowWeights.slice();
  const values = new Float64Array(plan.width * plan.height);
  const rowsPerChunk = Math.max(1, Math.floor(2_000_000 / Math.max(1, plan.width * plan.nodeCount * 4))), gate = createHostYieldGate();
  for (let y = 0; y < plan.height; y += rowsPerChunk) {
    checkAbort(abort);
    const end = Math.min(plan.height, y + rowsPerChunk);
    sumTemporalExposureRows(plan, samples, weights, y, end, values.subarray(y * plan.width, end * plan.width));
    if (yieldControl && gate.due()) { await yieldControl(abort.signal); gate.restart(); }
  }
  checkAbort(abort);
  return { plan, values, execution };
}

export async function sumTemporalExposureOnGpu(runtime: WebGpuRuntime, bandBytes: number, plan: TemporalExposureSumPlan, input: TemporalExposureSumInput,
  abort: AbortController, yieldControl: YieldControl, pipelines: PipelineSource): Promise<TemporalExposureSumResult> {
  const { width, height, nodes } = plan;
  const errorBound = temporalExposureSumErrorBound(plan, input.rowWeights);
  const samples = new Float32Array(input.samples), weights = new Float32Array(input.rowWeights);
  const minimumOffset = Math.min(...nodes.map(n => n.offsetY)), maximumOffset = Math.max(...nodes.map(n => n.offsetY)) + 1;
  const span = maximumOffset - minimumOffset, rowBytes = width * 4;
  let rows = Math.min(height, Math.floor(bandBytes / rowBytes) - span, Math.floor(MAXIMUM_TAPS_PER_DISPATCH / (width * plan.nodeCount * 4)));
  if (rows < 1) {
    if ((1 + span) * rowBytes > runtime.maximumStorageBindingBytes) {
      throw new ImageKernelExecutionError("insufficient-limits", "One temporal band exceeds the device's storage binding limit.");
    }
    rows = 1;
  }
  const nodeBuffer = new ArrayBuffer(nodes.length * 32), nodeInts = new Int32Array(nodeBuffer), nodeFloats = new Float32Array(nodeBuffer);
  nodes.forEach((n, k) => { nodeInts[k * 8] = n.offsetX; nodeInts[k * 8 + 1] = n.offsetY; nodeFloats.set(n.weights, k * 8 + 4); });
  const values = new Float32Array(width * height);
  const pipeline = await pipelines("photivra-temporal-sum", TEMPORAL_SUM_WGSL);
  const scope = new GpuResourceScope(runtime);
  try {
    const nodeData = scope.upload("photivra-temporal-nodes", new Uint8Array(nodeBuffer), BUFFER_USAGE.STORAGE);
    const gate = createHostYieldGate();
    for (let y0 = 0; y0 < height; y0 += rows) {
      checkAbort(abort);
      const y1 = Math.min(height, y0 + rows), count = y1 - y0;
      const in0 = Math.max(0, Math.min(height, y0 + minimumOffset)), in1 = Math.max(in0, Math.min(height, y1 - 1 + maximumOffset + 1));
      const bandWeights = new Float32Array(nodes.length * count);
      for (let k = 0; k < nodes.length; k++) bandWeights.set(weights.subarray(k * height + y0, k * height + y1), k * count);
      const band = new GpuResourceScope(runtime);
      try {
        const source = band.upload("photivra-temporal-band", samples.subarray(in0 * width, in1 * width), BUFFER_USAGE.STORAGE);
        const rowWeights = band.upload("photivra-temporal-weights", bandWeights, BUFFER_USAGE.STORAGE);
        const result = band.buffer("photivra-temporal-result", count * rowBytes, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const uniform = band.upload("photivra-temporal-params", new Uint32Array([width, height, nodes.length, y0, count, in0, 0, 0]), BUFFER_USAGE.UNIFORM);
        const bindGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: source } }, { binding: 2, resource: { buffer: nodeData } },
          { binding: 3, resource: { buffer: rowWeights } }, { binding: 4, resource: { buffer: result } }] });
        const groups: [number, number] = [Math.ceil(width / TEMPORAL_WORKGROUP_EDGE), Math.ceil(count / TEMPORAL_WORKGROUP_EDGE)];
        const [data] = await runComputePass(runtime, band, pipeline, bindGroup, groups, [{ buffer: result, bytes: count * rowBytes }], abort.signal);
        values.set(new Float32Array(data!, 0, count * width), y0 * width);
      } finally {
        band.release();
      }
      if (yieldControl && gate.due()) { await yieldControl(abort.signal); gate.restart(); }
    }
  } finally {
    scope.release();
  }
  checkAbort(abort);
  return { plan, values, execution: webGpuExecution(errorBound, 0) };
}
