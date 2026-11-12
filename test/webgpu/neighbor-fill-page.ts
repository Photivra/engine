// SPDX-License-Identifier: Apache-2.0
/**
 * #605: the measurement behind the choice to upload the neighbor reconstruction's ratios rather than solve them on the GPU
 * (docs/WEBGPU.md, "Neighbor highlight reconstruction"). In the page: a square clipped region of side n in a field of smoothly
 * varying color; the CPU reference's full method (`neighborHighlightRatios`, SOR in float64 to 10⁻⁹) is timed, and the same
 * Dirichlet problem is solved on the device by red-black SOR in float32 (one dispatch per color, the optimal ω), from the
 * fast method's ring mean, with the largest difference from the reference read back at checkpoints.
 */
import { neighborHighlightRatios, NEIGHBOR_HIGHLIGHT_MARGIN } from "../../src/color/neighbor-highlight-reconstruction.js";
import { BUFFER_USAGE } from "../../src/gpu/webgpu-runtime.js";
import { decodeTransport, encodeTransport } from "./codec.js";

const SHADER = /* wgsl */ `
@group(0) @binding(0) var<uniform> p: vec4<u32>;
@group(0) @binding(1) var<storage, read_write> rho: array<f32>;
@group(0) @binding(2) var<storage, read> unknown: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
  let i = id.x + id.y * groups.x * 64u;
  let w = p.x;
  let h = p.y;
  if (i >= w * h) { return; }
  let x = i % w;
  let y = i / w;
  if (((x + y) & 1u) != p.z || unknown[i] == 0u) { return; }
  let omega = bitcast<f32>(p.w);
  var s = vec3<f32>(0.0);
  var m = 0.0;
  if (x > 0u) { let q = 3u * (i - 1u); s = s + vec3<f32>(rho[q], rho[q + 1u], rho[q + 2u]); m = m + 1.0; }
  if (x + 1u < w) { let q = 3u * (i + 1u); s = s + vec3<f32>(rho[q], rho[q + 1u], rho[q + 2u]); m = m + 1.0; }
  if (y > 0u) { let q = 3u * (i - w); s = s + vec3<f32>(rho[q], rho[q + 1u], rho[q + 2u]); m = m + 1.0; }
  if (y + 1u < h) { let q = 3u * (i + w); s = s + vec3<f32>(rho[q], rho[q + 1u], rho[q + 2u]); m = m + 1.0; }
  let o = vec3<f32>(rho[3u * i], rho[3u * i + 1u], rho[3u * i + 2u]);
  let n = o + omega * (s / m - o);
  rho[3u * i] = n.x; rho[3u * i + 1u] = n.y; rho[3u * i + 2u] = n.z;
}`;

/** One region size: the CPU's full and fast times, and the GPU's sweeps and times to each tolerance. */
export async function neighborFill(payload: string): Promise<string> {
  const { side, checkpoints } = decodeTransport<{ side: number; checkpoints: number[] }>(payload);
  const pad = NEIGHBOR_HIGHLIGHT_MARGIN + 4, W = side + 2 * pad, H = W, n = W * H;
  const clippedAt = (i: number): boolean => { const x = i % W, y = (i - x) / W; return x >= pad && x < pad + side && y >= pad && y < pad + side; };
  const valueAt = (i: number, out: Float64Array): void => {
    const x = i % W, y = (i - x) / W;
    out[0] = 0.5 + 0.3 * Math.sin(x / 7); out[1] = 0.6 + 0.2 * Math.cos(y / 5); out[2] = 0.4 + 0.2 * Math.sin((x + y) / 9);
  };
  let t = performance.now();
  const full = neighborHighlightRatios(W, H, clippedAt, valueAt, false);
  const cpuFullMs = performance.now() - t;
  t = performance.now();
  const fast = neighborHighlightRatios(W, H, clippedAt, valueAt, true);
  const cpuFastMs = performance.now() - t;
  // The unknown pixels: the clipped ones widened by the margin (the reference's regions).
  const unknown = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const x = i % W, y = (i - x) / W; if (x >= pad - NEIGHBOR_HIGHLIGHT_MARGIN && x < pad + side + NEIGHBOR_HIGHLIGHT_MARGIN && y >= pad - NEIGHBOR_HIGHLIGHT_MARGIN && y < pad + side + NEIGHBOR_HIGHLIGHT_MARGIN) unknown[i] = 1; }
  const adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter(), device = await adapter!.requestDevice();
  const module = device.createShaderModule({ code: SHADER });
  const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
  const rho = device.createBuffer({ size: 12 * n, usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.COPY_DST });
  device.queue.writeBuffer(rho, 0, Float32Array.from(fast.ratios));
  const mask = device.createBuffer({ size: 4 * n, usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST });
  device.queue.writeBuffer(mask, 0, unknown);
  const unknownSide = side + 2 * NEIGHBOR_HIGHLIGHT_MARGIN, omega = 2 / (1 + Math.sin(Math.PI / (unknownSide + 1)));
  const groups = Array.from({ length: 2 }, (_, color) => {
    const params = device.createBuffer({ size: 16, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
    const words = new Uint32Array([W, H, color, 0]); new Float32Array(words.buffer)[3] = omega;
    device.queue.writeBuffer(params, 0, words);
    return device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: rho } }, { binding: 2, resource: { buffer: mask } }] });
  });
  const staging = device.createBuffer({ size: 12 * n, usage: BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST });
  const workgroups = Math.ceil(n / 64), x = Math.min(workgroups, 65535), y = Math.ceil(workgroups / x);
  const rows: { sweeps: number; gpuMs: number; maximumDifference: number }[] = [];
  let sweeps = 0, gpuMs = 0;
  await device.queue.onSubmittedWorkDone();
  for (const target of checkpoints) {
    const encoder = device.createCommandEncoder();
    for (; sweeps < target; sweeps++) for (const group of groups) {
      const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(x, y); pass.end();
    }
    t = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    gpuMs += performance.now() - t;
    const copy = device.createCommandEncoder();
    copy.copyBufferToBuffer(rho, 0, staging, 0, 12 * n);
    device.queue.submit([copy.finish()]);
    await staging.mapAsync(1);
    const values = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    let worst = 0;
    for (let i = 0; i < n; i++) if (unknown[i]) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(values[3 * i + c]! - full.ratios[3 * i + c]!));
    rows.push({ sweeps, gpuMs, maximumDifference: worst });
  }
  device.destroy();
  return encodeTransport({ side, unknownPixels: unknownSide * unknownSide, cpuFullMs, cpuFastMs, cpuSweeps: full.iterations, omega, rows });
}
