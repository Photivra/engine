// SPDX-License-Identifier: Apache-2.0

/**
 * Host side of the display view's Speed path on the GPU (#478): the support check, the float64 tables (site table,
 * overlaps over the scale, axis sums over the squared scale, 1/Σw²), banded dispatch of
 * `DISPLAY_VIEW_SPEED_KERNEL_WGSL`, and the finishing the CPU reference does after its per-sample loop: the output
 * quantization term, the seeded noise draw, the Cholesky factor, the clipped-normal centre, the sRGB encode and the
 * rounding, all with the reference's own float64 functions. So the noise draw is bit-identical to the CPU's, and only
 * the expected value and the covariance carry the float32 bound.
 *
 * The float64 reference is `renderDisplayView` (facade/display-view.ts) on the exact-area-mean path without
 * diffraction, with the bilinear demosaic and chart materials. Internal: not exported from the package. The
 * material lookup per query point is a module the caller supplies (`DisplayViewGpuMaterialModule`, the seam of
 * #477); `display-view-chart-material-module.ts` provides one for the eight 2.0 chart presets and
 * `display-view-composite-material-module.ts` (#491) one for composite charts, the 2.3 elements and `material-layers` scenes.
 */
import { DISPLAY_VIEW_NOISE_STREAM_ID, axisSums, clipCentre, createDisplayViewExpectedSignal, displayViewDecidedSaturation, overlaps, quantizationVariance, renderDisplayView, type AxisSums, type DisplayViewRenderResult, type DisplayViewSetup } from "../facade/display-view.js";
import type { DisplayViewExpectedSignalInput } from "../facade/expected-signal.js";
import { resolvePortableChartScene } from "../facade/chart-scenes.js";
import { setDisplayViewGpuRendererFactory, type DisplayViewGpuConformanceCase, type DisplayViewGpuPart, type DisplayViewGpuRenderOutput, type DisplayViewGpuRenderer,
  type DisplayViewGpuRendererFactory, type DisplayViewGpuRequest, type DisplayViewGpuRuntimeHandle } from "../facade/display-view-gpu.js";
import { createDisplayViewMaterialModules } from "./display-view-composite-material-module.js";
import { chartPresetMaterialModule } from "./display-view-chart-material-module.js";
import { encodeSrgbComponentPortable } from "../color/srgb-transfer.js";
import { createDeterministicUniformStream, deriveNativeSiteStreamSeedUint32, samplePortableStandardNormal } from "../sensor/stochastic-seed.js";
import { createHostYieldGate } from "../capture/host-yield-cadence.js";
import { ImageKernelExecutionError, WEBGPU_F32_UNIT_ROUNDOFF, webGpuExecution, type ChartCompositeProbeRecord, type ImageKernelExecution, type ImageKernelRelativeErrorBound } from "./image-kernel-execution.js";
import { BUFFER_USAGE, GpuResourceScope, abortedError, createComputePipeline, linearDispatch, runComputePass, type WebGpuRuntime, throwIfAborted as checkAbort } from "./webgpu-runtime.js";
import { DISPLAY_VIEW_AUX, DISPLAY_VIEW_FLAG_WORDS, DISPLAY_VIEW_GEOMETRY_STRIDE, DISPLAY_VIEW_GPU_MAXIMUM_OFFSETS, DISPLAY_VIEW_GPU_MAXIMUM_PIXELS_PER_AXIS,
  DISPLAY_VIEW_OUTPUT_FLOATS, DISPLAY_VIEW_PARAM_WORDS, DISPLAY_VIEW_REINHARD_MEAN_U, DISPLAY_VIEW_REINHARD_VARIANCE_U, DISPLAY_VIEW_WORKGROUP_SIZE,
  assembleDisplayViewSpeedWgsl } from "./wgsl-display-view-speed-kernel.js";
import { footprintShape, bilinearKernels, offsetCount } from "./display-view-quality-gpu.js";

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;
type YieldControl = ((signal: AbortSignal) => Promise<void>) | undefined;

/** One WGSL rounding of + − × in either direction (W3C WGSL "Floating Point Accuracy"; #471, #487): twice the binary32 unit roundoff. */
const E = 2 * WEBGPU_F32_UNIT_ROUNDOFF;
/** Higham's γ_k with E in place of u. */
const gammaE = (k: number): number => k * E / (1 - k * E);
/** Every reported bound is doubled, as the sensor stage doubles its margins. */
const MARGIN = 2;
/** Table values above this are outside the float32 domain. */
const FLOAT32_SAFE_MAGNITUDE = 2 ** 120;
/** Roundings of the expected value's multiplicative chain (docs/WEBGPU.md, "Display view (Speed)"): site 9, readout 2, demosaic 4, WB 2, matrix 4, weights 3, up to 35 additions, 5 spare. */
const MEAN_ROUNDINGS = 64;
/** Roundings of the variance chain: the squares double the readout, demosaic, WB and matrix counts. */
const VARIANCE_ROUNDINGS = 80;
/** The reference's own float64 rounding of its chains, relative. */
const CPU_RELATIVE = 2 ** -40;
/**
 * #496: the host's output quantization term q(m) = s(e)²·Δ²/12 (`quantizationVariance`, s the sRGB EOTF's slope at the encoded
 * mean e) is evaluated at the GPU's mean, so it moves with the mean's error: dq/dm = 2·s′(e)·Δ²/12 (de/dm = 1/s), with
 * s′(e) = (2.4/1.055)·(1.4/1.055)·((e + 0.055)/1.055)^0.4 ≤ 3.02 on [0, 1] and 0 on the linear segment and outside [0, 1];
 * q is non-decreasing in m, with a jump of (s₊² − s₋²)·Δ²/12 ≤ 2.1·10⁻⁴·Δ²/12 at the segment join (linear m = 0.0031308).
 * The Quality kernel's constants (#479).
 */
const QUANTIZATION_SLOPE = 6.04, QUANTIZATION_JOIN_JUMP = 2.1e-4, QUANTIZATION_JOIN = 0.0031308;
/** Workgroups per band are limited by the output buffer: DISPLAY_VIEW_OUTPUT_FLOATS floats plus the flag words (#533: three) per display pixel. */
const BYTES_PER_PIXEL = 4 * DISPLAY_VIEW_OUTPUT_FLOATS + 4 * DISPLAY_VIEW_FLAG_WORDS;

/**
 * The material lookup of a GPU display view (the seam of #477, GPU chart radiance for the composite chart and label
 * masks). `wgsl` defines `fn material_at(p: vec2<f32>) -> u32` (the material index of frame point p: u right, v up, the
 * same index space as the scene's `materialAt`) and declares `var<private> material_uncertain: bool`, which it sets to
 * true when p lies within its a-priori bound of a material boundary; the display pixel is then recomputed on the host
 * with the reference. The point p carries a relative error of at most 2E + 10⁻¹⁴ (E = 2⁻²³) against the reference's float64
 * query point (two float32 roundings of (x + c)·scale), which the module's bounds must cover. The module may use the
 * kernel's constants `E` (2⁻²³) and `SLACK` (10⁻¹⁴) and declares its buffers in @group(1); `bindings` are their
 * contents: `data` is uploaded once per render, `buffer` is a buffer the module already holds on the device (#491: scene
 * records uploaded once per renderer and reused across a view's parts).
 */
export interface DisplayViewGpuMaterialModule {
  /** Names the module in the pipeline cache; two modules with different `wgsl` need different ids. */
  readonly id: string;
  readonly wgsl: string;
  /** The composite module's device probe record (the product path it chose); absent for the chart-preset module. */
  readonly compositeProbe?: ChartCompositeProbeRecord;
  readonly bindings: readonly ({ binding: number; kind: "uniform" | "storage"; data: ArrayBufferView<ArrayBuffer>; buffer?: undefined } |
    { binding: number; kind: "uniform" | "storage"; buffer: GPUBuffer; data?: undefined })[];
  /**
   * #581: a module that defines `scene_value` itself (the image-plane module) states the roundings its value carries beyond the
   * table lookup's one, added to the mean's and (doubled) the variance's chains; and it gives the site table the kernel binds.
   */
  readonly extraSiteRoundings?: number;
  readonly siteTable?: Float32Array<ArrayBuffer>;
}

/** What a GPU render of a display view needs: the reference's own setup and expected-signal input, plus the material module. */
export interface DisplayViewSpeedGpuInput {
  /** The render's setup, as `renderDisplayView` receives it (`setup.signal` is used only to recompute flagged pixels). */
  setup: DisplayViewSetup;
  /** The expected signal's input (the offsets, the materials table and the query points). */
  signalInput: DisplayViewExpectedSignalInput;
  material: DisplayViewGpuMaterialModule;
  /** Recompute flagged display pixels (a query point within its bound of a material boundary) with the reference. Default true. */
  recomputeFlagged?: boolean;
}

/** A GPU display view of one region: the reference's result fields plus the execution label, the bounds and the flagged pixels. */
export interface DisplayViewSpeedGpuResult extends DisplayViewRenderResult {
  execution: ImageKernelExecution;
  /** |E_gpu − E_cpu| ≤ relative·E_cpu + absolute for every component of every display pixel (linear light); `absolute` is the largest per-pixel term. */
  expectedValueBound: ImageKernelRelativeErrorBound;
  /** |V_gpu − V_cpu| ≤ relative·V_cpu + absolute for every variance (the covariance diagonal, linear light squared). */
  varianceBound: ImageKernelRelativeErrorBound;
  /** Per display pixel: the absolute terms of the two bounds (the clip steps' running bound, already doubled). */
  expectedValueAbsoluteBound: Float32Array;
  varianceAbsoluteBound: Float32Array;
  /** Display pixels (region row-major) whose material lookup was uncertain; equal to `hostRecomputedPixelIndices` when recomputing. */
  flaggedPixelIndices: Uint32Array;
  hostRecomputedPixelIndices: Uint32Array;
  /** #533: display pixels (not flagged) with a real pixel whose saturation the kernel left undecided; their count is the host reference's. */
  highlightRecomputedPixelIndices: Uint32Array;
}

/**
 * Why the kernel does not cover a request, or null when it does. The kernel is the Speed path: the exact area mean
 * (views where a footprint holds at most 25 real pixels and at most K², and here at most 6 per axis), no diffraction
 * kernels, chart materials, the bilinear demosaic (no AHD candidates or correction), the identity or positive Reinhard
 * tone curve, and at most 16 query offsets.
 */
export function displayViewSpeedGpuUnsupportedReason(setup: DisplayViewSetup, signalInput: DisplayViewExpectedSignalInput): string | null {
  if (signalInput.largeKernel) return "a defocus kernel radius above 64 sites (convolved by runs on the CPU, #564) is not on the GPU";
  if (signalInput.kernels) return "diffraction kernels (the Quality path) are not on the GPU";
  if (signalInput.scene.kind !== "materials" && !signalInput.scene.signalAt) return "radiance scenes (caller functions) are not on the GPU";
  if (!signalInput.queryPoint) return "the expected signal has no query points";
  if (setup.candidates || setup.ahdCorrection || setup.ahdCollect) return "AHD candidates and the low-signal correction are not on the GPU";
  if (setup.toneCurve !== "identity" && setup.toneCurve !== "positive-reinhard-per-channel") return "unsupported tone curve " + String(setup.toneCurve);
  if (signalInput.offsets.length < 1 || signalInput.offsets.length > DISPLAY_VIEW_GPU_MAXIMUM_OFFSETS) return "the kernel holds 1 to " + DISPLAY_VIEW_GPU_MAXIMUM_OFFSETS + " query offsets";
  if (setup.region.width < 1 || setup.region.height < 1) return "an empty region";
  const shape = footprintShape(setup);
  if (!shape.exact) return "the stratified estimator (footprints above 25 real pixels) is not on the GPU";
  if (shape.maximumColumns > DISPLAY_VIEW_GPU_MAXIMUM_PIXELS_PER_AXIS || shape.maximumRows > DISPLAY_VIEW_GPU_MAXIMUM_PIXELS_PER_AXIS)
    return "a footprint touches more than " + DISPLAY_VIEW_GPU_MAXIMUM_PIXELS_PER_AXIS + " real pixels along an axis";
  for (let p = 0; p < 4; p++) for (let c = 0; c < 3; c++) {
    const taps = setup.demosaic[p]?.[c];
    if (!taps || taps.length < 1 || taps.length > 4 || taps.some((t) => Math.abs(t.dx) > 1 || Math.abs(t.dy) > 1)) return "the demosaic is not the bilinear kernels (at most 4 taps within one site)";
  }
  return null;
}

/** The site table: Σ_λ A_c(λ)·L_m(λ) per material and channel in float64 (the reference's `materialSignalDirect`), rounded once to float32. */
function siteTable(signalInput: DisplayViewExpectedSignalInput): Float32Array<ArrayBuffer> {
  const scene = signalInput.scene as Extract<DisplayViewExpectedSignalInput["scene"], { kind: "materials" }>, A = signalInput.electronsPerRadiance, nodes = signalInput.wavelengthsNm.length;
  const neutral = [0, 1, 2].map((c) => { let s = 0; for (let n = 0; n < nodes; n++) s += A[c]![n]! * scene.whiteRadiance[n]!; return s; });
  const table = new Float32Array(scene.materials.length * 3);
  scene.materials.forEach((m, index) => {
    for (let c = 0; c < 3; c++) {
      let value: number;
      if ("neutral" in m) value = m.neutral * neutral[c]!;
      else { value = 0; for (let n = 0; n < nodes; n++) value += A[c]![n]! * m.radiance[n]!; }
      if (!(Math.abs(value) <= FLOAT32_SAFE_MAGNITUDE)) throw new ImageKernelExecutionError("unsupported-float32-domain", "A material's channel signal exceeds the float32 domain.");
      table[index * 3 + c] = value;
    }
  });
  return table;
}

/**
 * The query-point scale and offsets: the reference's query point of offset o at site (x, y) is, up to its own float64
 * rounding, (x + 0.5 + o_x − W/2)·g and −(y + 0.5 + o_y − H/2)·g with g = 2/outputWidth frame units per site. The scale
 * is taken from the reference's own query points (two sites a frame apart, divided in float64), so a request whose
 * geometry differs is caught by the check against the reference at four corners (within 2^-40 relative).
 */
export function queryGeometry(signalInput: DisplayViewExpectedSignalInput): { scaleU: number; scaleV: number; offsetU: Float64Array; offsetV: Float64Array } {
  const W = signalInput.nativeWidth, H = signalInput.nativeHeight, point = new Float64Array(2), query = signalInput.queryPoint!;
  const x1 = W - 1, y1 = H - 1;
  query(0, 0, 0, point); const u0 = point[0]!, v0 = point[1]!;
  query(x1, 0, 0, point); const u1 = point[0]!;
  query(0, y1, 0, point); const v1 = point[1]!;
  const scaleU = (u1 - u0) / x1, scaleV = (v1 - v0) / y1;
  const offsetU = new Float64Array(signalInput.offsets.length), offsetV = new Float64Array(signalInput.offsets.length);
  for (let o = 0; o < signalInput.offsets.length; o++) {
    const offset = signalInput.offsets[o]!;
    offsetU[o] = 0.5 + offset.x - W / 2; offsetV[o] = 0.5 + offset.y - H / 2;
    // The model (x + c)·scale against the reference at the corners: a geometry the model does not describe is refused.
    for (const [x, y] of [[0, 0], [x1, 0], [0, y1], [x1, y1]] as const) {
      query(x, y, o, point);
      const mu = (x + offsetU[o]!) * scaleU, mv = (y + offsetV[o]!) * scaleV;
      if (!(Math.abs(mu - point[0]!) <= 2 ** -40 * (Math.abs(point[0]!) + 1) && Math.abs(mv - point[1]!) <= 2 ** -40 * (Math.abs(point[1]!) + 1)))
        throw new ImageKernelExecutionError("unsupported-on-backend", "The request's query points are not a rectilinear site lattice; use cpu-reference.");
    }
  }
  return { scaleU, scaleV, offsetU, offsetV };
}

/** Gauss–Legendre nodes and weights on [−1, 1], 16 points, by the reference's own construction (display-view.ts). */
export function gaussLegendre16(): { x: Float64Array; w: Float64Array } {
  const n = 16, x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = n * (z * p1 - p0) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x[i] = z; w[i] = 2 / ((1 - z * z) * dp * dp);
  }
  return { x, w };
}

/** One axis record of the geometry buffer: first real pixel, count, overlaps over the scale, axis sums over the squared scale. */
export function axisRecord(geometry: Float32Array, at: number, start: number, end: number, limit: number, margin: number, scale: number): void {
  const { first, w } = overlaps(start, end, limit), sums = axisSums(start, end, limit, margin), scale2 = scale * scale;
  const words = new Int32Array(geometry.buffer, geometry.byteOffset, geometry.length);
  words[at] = first; words[at + 1] = w.length;
  for (let i = 0; i < w.length; i++) geometry[at + 2 + i] = w[i]! / scale;
  const order: (keyof AxisSums)[] = ["bEven", "bOdd", "ppEven", "ppOdd", "qqEven", "qqOdd", "pqEven", "pqOdd", "ww"];
  order.forEach((key, i) => { geometry[at + 8 + i] = sums[key] / scale2; });
}

/** The uniform parameters and the aux table of a render. */
function constants(setup: DisplayViewSetup, signalInput: DisplayViewExpectedSignalInput): { params: ArrayBuffer; aux: Float32Array<ArrayBuffer> } {
  const params = new ArrayBuffer(4 * DISPLAY_VIEW_PARAM_WORDS), words = new Uint32Array(params), floats = new Float32Array(params);
  words[2] = setup.region.width; words[3] = setup.region.x; words[4] = setup.region.y; words[5] = setup.margin; words[6] = setup.nativeWidth; words[7] = setup.nativeHeight;
  words[8] = setup.region.width; words[9] = setup.toneCurve === "positive-reinhard-per-channel" ? 1 : 0; words[10] = signalInput.offsets.length;
  for (let c = 0; c < 3; c++) { floats[12 + c] = setup.readout[c]!.perElectron; floats[16 + c] = setup.readout[c]!.darkElectrons; floats[20 + c] = setup.readout[c]!.constantVariance; floats[24 + c] = setup.gains[c]!; }
  floats[15] = 8.5 * 8.5; floats[19] = setup.clipLevel;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) floats[28 + r * 3 + c] = setup.matrix[r]![c]!;
  const geometry = queryGeometry(signalInput);
  floats[37] = geometry.scaleU; floats[38] = geometry.scaleV;
  const aux = new Float32Array(DISPLAY_VIEW_AUX.size);
  for (let o = 0; o < signalInput.offsets.length; o++) { aux[DISPLAY_VIEW_AUX.offsets + 4 * o] = geometry.offsetU[o]!; aux[DISPLAY_VIEW_AUX.offsets + 4 * o + 1] = geometry.offsetV[o]!; aux[DISPLAY_VIEW_AUX.offsets + 4 * o + 2] = signalInput.offsets[o]!.weight; }
  for (let p = 0; p < 4; p++) for (let c = 0; c < 3; c++) {
    const taps = setup.demosaic[p]![c]!, base = DISPLAY_VIEW_AUX.taps + (p * 3 + c) * 16;
    let w2 = 0;
    taps.forEach((t, i) => { aux[base + 4 * i] = t.dx; aux[base + 4 * i + 1] = t.dy; aux[base + 4 * i + 2] = t.weight; w2 += t.weight * t.weight; });
    aux[DISPLAY_VIEW_AUX.inverseW2 + p * 3 + c] = 1 / w2;
  }
  const gl = gaussLegendre16();
  aux.set(gl.x, DISPLAY_VIEW_AUX.gaussLegendre); aux.set(gl.w, DISPLAY_VIEW_AUX.gaussLegendre + 16);
  return { params, aux };
}

/** The a-priori relative bounds of the expected value and the variance (docs/WEBGPU.md, "Display view (Speed)"), doubled. */
export function displayViewSpeedGpuRelativeBounds(toneCurve: DisplayViewSetup["toneCurve"], extraSiteRoundings = 0): { mean: number; variance: number } {
  const reinhard = toneCurve === "positive-reinhard-per-channel";
  return { mean: MARGIN * (gammaE(MEAN_ROUNDINGS + extraSiteRoundings) + CPU_RELATIVE + (reinhard ? DISPLAY_VIEW_REINHARD_MEAN_U * E : 0)),
    variance: MARGIN * (gammaE(VARIANCE_ROUNDINGS + 2 * extraSiteRoundings) + CPU_RELATIVE + (reinhard ? DISPLAY_VIEW_REINHARD_VARIANCE_U * E : 0)) };
}

/**
 * The reference's finishing of one display pixel from its linear-light moments (display-view.ts, after the sample loop):
 * the output quantization term, the seeded noise draw (`sensor.noiseSeed`, the display pixel's view index, stream 33),
 * the Cholesky factor, the clipped-normal centre, the sRGB encode and the rounding; the same functions, so the draw and
 * every operation after the moments are the CPU's. `moments` holds m0 m1 m2 v00 v11 v22 c01 c02 c12 (the variances
 * without the quantization term); `pixels` is Σ_j (w_j/A)².
 */
export function finishDisplayViewPixel(moments: ArrayLike<number>, pixels: number, seed: number, index: number, step: number, maximum: number,
  samples: Uint8Array | Uint16Array, expected: Float64Array, noiseStd: Float64Array, o: number): void {
  const mean0 = moments[0]!, mean1 = moments[1]!, mean2 = moments[2]!;
  const q0 = quantizationVariance(mean0, step), q1 = quantizationVariance(mean1, step), q2 = quantizationVariance(mean2, step);
  const v00 = moments[3]! + pixels * q0, v11 = moments[4]! + pixels * q1, v22 = moments[5]! + pixels * q2, v01 = moments[6]!, v02 = moments[7]!, v12 = moments[8]!;
  const noise = createDeterministicUniformStream(deriveNativeSiteStreamSeedUint32(seed, index, DISPLAY_VIEW_NOISE_STREAM_ID));
  const z0 = samplePortableStandardNormal(noise), z1 = samplePortableStandardNormal(noise), z2 = samplePortableStandardNormal(noise);
  const l00 = Math.sqrt(Math.max(0, v00)), l10 = l00 > 0 ? v01 / l00 : 0, l20 = l00 > 0 ? v02 / l00 : 0;
  const l11 = Math.sqrt(Math.max(0, v11 - l10 * l10)), l21 = l11 > 0 ? (v12 - l20 * l10) / l11 : 0;
  const l22 = Math.sqrt(Math.max(0, v22 - l20 * l20 - l21 * l21));
  const n0 = clipCentre(mean0, v00) + l00 * z0, n1 = clipCentre(mean1, v11) + l10 * z0 + l11 * z1, n2 = clipCentre(mean2, v22) + l20 * z0 + l21 * z1 + l22 * z2;
  samples[o] = Math.round(encodeSrgbComponentPortable(n0 < 0 ? 0 : n0 > 1 ? 1 : n0) * maximum);
  samples[o + 1] = Math.round(encodeSrgbComponentPortable(n1 < 0 ? 0 : n1 > 1 ? 1 : n1) * maximum);
  samples[o + 2] = Math.round(encodeSrgbComponentPortable(n2 < 0 ? 0 : n2 > 1 ? 1 : n2) * maximum);
  expected[o] = mean0; expected[o + 1] = mean1; expected[o + 2] = mean2;
  noiseStd[o] = Math.sqrt(Math.max(0, v00)); noiseStd[o + 1] = Math.sqrt(Math.max(0, v11)); noiseStd[o + 2] = Math.sqrt(Math.max(0, v22));
}

/**
 * #496: how far the host's quantization term Σ(w/A)²·q(m) of a display pixel can move when each component's mean carries the
 * bound relative·|m| + absolute (see QUANTIZATION_SLOPE), the largest over the three components, doubled. Added to the pixel's
 * absolute variance bound; it changes no computed value.
 */
export function displayViewSpeedQuantizationBound(moments: ArrayLike<number>, relative: number, absolute: number, pixels: number, step: number): number {
  let largest = 0;
  for (let c = 0; c < 3; c++) {
    const m = moments[c]!, bound = relative * Math.abs(m) + absolute;
    largest = Math.max(largest, QUANTIZATION_SLOPE * bound + (m - bound <= QUANTIZATION_JOIN && m + bound >= QUANTIZATION_JOIN ? QUANTIZATION_JOIN_JUMP : 0));
  }
  return MARGIN * pixels * largest * step * step / 12;
}

/**
 * Renders the display pixels `indices` (ascending, region row-major) with the reference, a run of consecutive pixels along a row
 * as one region (#457: AHD's choice flags stretches near edges): a region render is byte-identical to the same pixels of the whole
 * view, so each pixel equals its one-pixel render, and a run's counts are the sums of its pixels'.
 */
export async function recomputeRuns(setup: DisplayViewSetup, signalInput: DisplayViewExpectedSignalInput, indices: readonly number[], abort: AbortController,
  take: (first: number, run: number, part: DisplayViewRenderResult) => void): Promise<void> {
  const region = setup.region;
  let reference: DisplayViewSetup["signal"] | undefined;
  for (let r = 0; r < indices.length;) {
    checkAbort(abort.signal);
    const first = indices[r]!, rx = first % region.width, ry = (first - rx) / region.width;
    let run = 1;
    while (r + run < indices.length && indices[r + run] === first + run && rx + run < region.width) run++;
    take(first, run, await renderDisplayView({ ...setup, signal: reference ??= createDisplayViewExpectedSignal(signalInput), region: { x: region.x + rx, y: region.y + ry, width: run, height: 1 } }));
    r += run;
  }
}

/** Renders one region of a Speed display view on the GPU (see the module comment). */
export async function renderDisplayViewSpeedOnGpu(runtime: WebGpuRuntime, bandBytes: number, input: DisplayViewSpeedGpuInput, abort: AbortController,
  yieldControl: YieldControl, pipelines: PipelineSource): Promise<DisplayViewSpeedGpuResult> {
  const { setup, signalInput, material } = input;
  const reason = displayViewSpeedGpuUnsupportedReason(setup, signalInput);
  if (reason) throw new ImageKernelExecutionError("unsupported-on-backend", "webgpu-f32 display view (Speed): " + reason + "; use cpu-reference.");
  const { region, margin } = setup, shape = footprintShape(setup), table = material.siteTable ?? siteTable(signalInput), { params, aux } = constants(setup, signalInput);
  const stride = DISPLAY_VIEW_GEOMETRY_STRIDE, geometry = new Float32Array((region.width + region.height) * stride);
  const columnSums: AxisSums[] = [], rowSums: AxisSums[] = [];
  for (let i = 0; i < region.width; i++) { axisRecord(geometry, i * stride, (region.x + i) * shape.sx, (region.x + i + 1) * shape.sx, setup.frameWidth, margin, shape.sx); columnSums.push(axisSums((region.x + i) * shape.sx, (region.x + i + 1) * shape.sx, setup.frameWidth, margin)); }
  for (let j = 0; j < region.height; j++) { axisRecord(geometry, (region.width + j) * stride, (region.y + j) * shape.sy, (region.y + j + 1) * shape.sy, setup.frameHeight, margin, shape.sy); rowSums.push(axisSums((region.y + j) * shape.sy, (region.y + j + 1) * shape.sy, setup.frameHeight, margin)); }
  const area = shape.sx * shape.sy, pixelCount = region.width * region.height;
  const rows = Math.max(1, Math.min(region.height, Math.floor(bandBytes / (region.width * BYTES_PER_PIXEL))));
  if (Math.max(rows * region.width * 4 * DISPLAY_VIEW_OUTPUT_FLOATS, geometry.byteLength, table.byteLength) > runtime.maximumStorageBindingBytes)
    throw new ImageKernelExecutionError("insufficient-limits", "One display-view band exceeds the device's storage binding limit.");
  const pipeline = await pipelines("photivra-display-view-speed:" + material.id, assembleDisplayViewSpeedWgsl(material.wgsl));
  const moments = new Float32Array(pixelCount * DISPLAY_VIEW_OUTPUT_FLOATS), flagged: number[] = [], flagWords = new Uint32Array(pixelCount * DISPLAY_VIEW_FLAG_WORDS);
  const words = new Uint32Array(params);
  const scope = new GpuResourceScope(runtime);
  try {
    const auxBuffer = scope.upload("photivra-display-view-aux", aux, BUFFER_USAGE.STORAGE);
    const geometryBuffer = scope.upload("photivra-display-view-geometry", geometry, BUFFER_USAGE.STORAGE);
    const tableBuffer = scope.upload("photivra-display-view-table", table, BUFFER_USAGE.STORAGE);
    const materialEntries = material.bindings.map((b) => ({ binding: b.binding, resource: { buffer: b.buffer ?? scope.upload("photivra-display-view-material-" + b.binding, b.data, b.kind === "uniform" ? BUFFER_USAGE.UNIFORM : BUFFER_USAGE.STORAGE) } }));
    const materialGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: materialEntries });
    const gate = createHostYieldGate();
    for (let row0 = 0; row0 < region.height; row0 += rows) {
      checkAbort(abort.signal);
      const row1 = Math.min(region.height, row0 + rows), count = (row1 - row0) * region.width, first = row0 * region.width;
      words[0] = count; words[1] = row0;
      const band = new GpuResourceScope(runtime);
      try {
        const out = band.buffer("photivra-display-view-moments", count * 4 * DISPLAY_VIEW_OUTPUT_FLOATS, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const flagBuffer = band.buffer("photivra-display-view-flags", count * 4 * DISPLAY_VIEW_FLAG_WORDS, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const uniform = band.upload("photivra-display-view-params", new Uint8Array(params), BUFFER_USAGE.UNIFORM);
        const bindGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: auxBuffer } }, { binding: 2, resource: { buffer: geometryBuffer } },
          { binding: 3, resource: { buffer: tableBuffer } }, { binding: 4, resource: { buffer: out } }, { binding: 5, resource: { buffer: flagBuffer } }] });
        const [data, flagData] = await runComputePass(runtime, band, pipeline, [bindGroup, materialGroup], linearDispatch(count, DISPLAY_VIEW_WORKGROUP_SIZE, runtime.maximumWorkgroupsPerDimension),
          [{ buffer: out, bytes: count * 4 * DISPLAY_VIEW_OUTPUT_FLOATS }, { buffer: flagBuffer, bytes: count * 4 * DISPLAY_VIEW_FLAG_WORDS }], abort.signal);
        moments.set(new Float32Array(data!, 0, count * DISPLAY_VIEW_OUTPUT_FLOATS), first * DISPLAY_VIEW_OUTPUT_FLOATS);
        const bandFlags = new Uint32Array(flagData!, 0, count * DISPLAY_VIEW_FLAG_WORDS);
        flagWords.set(bandFlags, first * DISPLAY_VIEW_FLAG_WORDS);
        for (let i = 0; i < count; i++) {
          let flag = (bandFlags[DISPLAY_VIEW_FLAG_WORDS * i]! & 1) !== 0;
          for (let k = 0; k < DISPLAY_VIEW_OUTPUT_FLOATS && !flag; k++) if (!Number.isFinite(moments[(first + i) * DISPLAY_VIEW_OUTPUT_FLOATS + k]!)) flag = true;
          if (flag) flagged.push(first + i);
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
  // The reference's finishing per display pixel (float64).
  const maximum = setup.bitDepth === 8 ? 255 : 65535, step = 1 / maximum;
  const samples = setup.bitDepth === 8 ? new Uint8Array(pixelCount * 3) : new Uint16Array(pixelCount * 3);
  const expected = new Float64Array(pixelCount * 3), noiseStd = new Float64Array(pixelCount * 3), saturated = new Float64Array(pixelCount);
  const meanBound = new Float32Array(pixelCount), varianceBound = new Float32Array(pixelCount);
  let largestMean = 0, largestVariance = 0, sampleCount = 0, siteCount = 0;
  const counts = new Int32Array(geometry.buffer), relative = displayViewSpeedGpuRelativeBounds(setup.toneCurve, material.extraSiteRoundings ?? 0);
  // #533: each display pixel's saturated-pixel share from the kernel's mask (the reference's arithmetic, exact where it decided).
  const columnOverlaps = Array.from({ length: region.width }, (_, i) => overlaps((region.x + i) * shape.sx, (region.x + i + 1) * shape.sx, setup.frameWidth));
  for (let ry = 0, i = 0; ry < region.height; ry++) {
    const rowOverlaps = overlaps((region.y + ry) * shape.sy, (region.y + ry + 1) * shape.sy, setup.frameHeight);
    for (let rx = 0; rx < region.width; rx++, i++) saturated[i] = displayViewDecidedSaturation(columnOverlaps[rx]!, rowOverlaps, area, flagWords[DISPLAY_VIEW_FLAG_WORDS * i + 1]!, flagWords[DISPLAY_VIEW_FLAG_WORDS * i + 2]!);
  }
  for (let ry = 0, i = 0; ry < region.height; ry++) {
    const rowWw = rowSums[ry]!.ww, ny = counts[(region.width + ry) * stride + 1]!;
    for (let rx = 0; rx < region.width; rx++, i++) {
      const pixels = columnSums[rx]!.ww * rowWw / (area * area), vy = region.y + ry, vx = region.x + rx, o = i * DISPLAY_VIEW_OUTPUT_FLOATS;
      finishDisplayViewPixel(moments.subarray(o, o + 9), pixels, setup.seed, vy * setup.viewWidth + vx, step, maximum, samples, expected, noiseStd, i * 3);
      meanBound[i] = MARGIN * moments[o + 9]!; varianceBound[i] = MARGIN * moments[o + 10]! + displayViewSpeedQuantizationBound(moments.subarray(o, o + 3), relative.mean, meanBound[i]!, pixels, step);
      largestMean = Math.max(largestMean, meanBound[i]!); largestVariance = Math.max(largestVariance, varianceBound[i]!);
      const nx = counts[rx * stride + 1]!;
      sampleCount += nx * ny; siteCount += (nx + 2) * (ny + 2);
    }
  }
  // Flagged display pixels: the reference's own pixel (a one-pixel region render is byte-identical to the whole view's pixel).
  const recomputed: number[] = [], highlights: number[] = [];
  // #533: unflagged display pixels with an undecided real pixel take the reference's count only (their samples stay the kernel's).
  const undecided: number[] = [], isFlagged = new Uint8Array(pixelCount);
  for (const i of flagged) isFlagged[i] = 1;
  for (let i = 0; i < pixelCount; i++) if (isFlagged[i] === 0 && (flagWords[DISPLAY_VIEW_FLAG_WORDS * i]! & 2) !== 0) undecided.push(i);
  if (input.recomputeFlagged !== false) {
    await recomputeRuns(setup, signalInput, flagged, abort, (first, run, part) => {
      samples.set(part.samples, first * 3); expected.set(part.expected, first * 3); noiseStd.set(part.noiseStd, first * 3); saturated.set(part.saturated, first);
      for (let k = 0; k < run; k++) { meanBound[first + k] = 0; varianceBound[first + k] = 0; recomputed.push(first + k); }
    });
    await recomputeRuns(setup, signalInput, undecided, abort, (first, run, part) => { for (let k = 0; k < run; k++) { saturated[first + k] = part.saturated[k]!; highlights.push(first + k); } });
  }
  let saturatedPixelCount = 0;
  for (let i = 0; i < pixelCount; i++) saturatedPixelCount += saturated[i]!;
  const expectedValueBound: ImageKernelRelativeErrorBound = { kind: "relative-to-reference", relative: relative.mean, absolute: largestMean };
  const uncertain = flagged.length - recomputed.length + undecided.length - highlights.length;
  return { samples, expected, noiseStd, sampleCount, siteCount, detailPixelCount: pixelCount, uniformPixelCount: 0, ahdCorrectedPixelCount: 0, estimation: "exact-area-mean", saturated, saturatedPixelCount,
    execution: webGpuExecution(expectedValueBound, uncertain), expectedValueBound,
    varianceBound: { kind: "relative-to-reference", relative: relative.variance, absolute: largestVariance },
    expectedValueAbsoluteBound: meanBound, varianceAbsoluteBound: varianceBound,
    flaggedPixelIndices: Uint32Array.from(flagged), hostRecomputedPixelIndices: Uint32Array.from(recomputed), highlightRecomputedPixelIndices: Uint32Array.from(highlights) };
}

/**
 * Why the Speed renderer does not support a prepared request (`DisplayViewGpuRenderer.supports`), or true. It covers every
 * engine chart (the 2.0 presets through `display-view-chart-material-module.ts`; composites, the 2.3 elements, the sine star
 * and fixed-size charts through the composite module, #491) and declared `material-layers` scenes, never a caller scene
 * function, without AHD or diffraction, with the identity or Reinhard tone curve and at most 16 query offsets; whether a
 * view's footprints take the exact area mean, and whether the device passes the composite kernel's probe, is known only per
 * render (`displayViewSpeedGpuUnsupportedReason`, `createDisplayViewMaterialModules`).
 */
export function displayViewSpeedGpuSupports(request: DisplayViewGpuRequest): true | string {
  if (request.ahd) return "AHD (the Quality demosaic) is not on the GPU";
  if (request.diffraction) return "diffraction (the Quality optics) is not on the GPU";
  return sceneToneAndOffsetsReason(request, DISPLAY_VIEW_GPU_MAXIMUM_OFFSETS);
}
/** Why the GPU's material lookup, tone curves or query-offset table do not cover a request (shared by the Speed and Quality support checks), or true. */
export function sceneToneAndOffsetsReason(request: DisplayViewGpuRequest, maximumOffsets: number): true | string {
  if (request.scene !== "chart" && request.scene !== "material-layers" && request.scene !== "image-plane") return "the scene is a caller " + request.scene + "; the GPU material lookup covers engine charts and declared material-layers scenes (describe the scene as material-layers)";
  if (request.toneCurve !== "identity" && request.toneCurve !== "positive-reinhard-per-channel") return "unsupported tone curve " + String(request.toneCurve);
  if (offsetCount(request) > maximumOffsets) return "more than " + maximumOffsets + " query offsets per site";
  return true;
}

/**
 * A self-check's verdict: every component of a GPU render inside its a-priori bounds against the reference, every sample within
 * one code, and (#533) the saturated-pixel count the reference's bit for bit; true, or a sentence saying where it failed.
 */
export function conformanceVerdict(reference: DisplayViewRenderResult, gpu: Pick<DisplayViewSpeedGpuResult, "samples" | "expected" | "noiseStd" | "expectedValueBound" | "varianceBound" |
  "expectedValueAbsoluteBound" | "varianceAbsoluteBound" | "saturatedPixelCount">): true | string {
  for (let i = 0; i < reference.expected.length; i++) {
    const p = Math.floor(i / 3), e0 = reference.expected[i]!, e1 = gpu.expected[i]!, v0 = reference.noiseStd[i]! * reference.noiseStd[i]!, v1 = gpu.noiseStd[i]! * gpu.noiseStd[i]!;
    const expectedLimit = gpu.expectedValueBound.relative * Math.abs(e0) + gpu.expectedValueAbsoluteBound[p]!, varianceLimit = gpu.varianceBound.relative * v0 + gpu.varianceAbsoluteBound[p]!;
    if (!(Math.abs(e1 - e0) <= expectedLimit)) return "component " + i + ": expected value " + e1 + " differs from the reference " + e0 + " by more than the a-priori bound " + expectedLimit + ".";
    if (!(Math.abs(v1 - v0) <= varianceLimit)) return "component " + i + ": variance " + v1 + " differs from the reference " + v0 + " by more than the a-priori bound " + varianceLimit + ".";
    if (Math.abs(gpu.samples[i]! - reference.samples[i]!) > 1) return "component " + i + ": sample " + gpu.samples[i] + " differs from the reference " + reference.samples[i] + " by more than one code.";
  }
  if (gpu.saturatedPixelCount !== reference.saturatedPixelCount) return "the saturated-pixel count " + gpu.saturatedPixelCount + " differs from the reference's " + reference.saturatedPixelCount + ".";
  return true;
}

/**
 * The renderer's run-time self-check (`DisplayViewGpuRenderer.conformanceCases`): a 38 × 26 checkerboard frame of 6 µm sites
 * shown at 13 × 9 (2.9 real pixels per display pixel) with the 2 × 2 box, light squares at the white clip, the GPU against
 * `renderDisplayView` within the a-priori bounds, every flagged pixel recomputed.
 */
/** The self-checks' common frame: 40 × 28 native sites (a 38 × 26 frame and a one-site margin) shown at 13 × 9, at three spectral nodes. */
export const CONFORMANCE_FRAME = /* @__PURE__ */ Object.freeze({ nativeWidth: 40, nativeHeight: 28, margin: 1, frameWidth: 38, frameHeight: 26, nodes: [450, 550, 650] });
/** The self-checks' channel responses per node (`scale` 1, or 1/10 for the low-signal correction's few electrons). */
export function conformanceResponses(scale: number): [Float64Array, Float64Array, Float64Array] {
  return [Float64Array.of(9000, 30000, 4000).map((v) => v * scale), Float64Array.of(6000, 42000, 9000).map((v) => v * scale), Float64Array.of(30000, 9000, 3000).map((v) => v * scale)];
}
/** The RGGB channel of a native site. */
export const conformanceChannelAt = (x: number, y: number): number => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2));
/** The self-checks' checkerboard and its expected-signal scene (neutral materials under a white radiance per node). */
export function conformanceChart(): { chart: ReturnType<typeof resolvePortableChartScene>; scene: DisplayViewExpectedSignalInput["scene"] } {
  const chart = resolvePortableChartScene({ scene: { preset: "checkerboard", squaresAcross: 6 }, aspect: CONFORMANCE_FRAME.frameHeight / CONFORMANCE_FRAME.frameWidth });
  return { chart, scene: { kind: "materials", materialAt: (u, v) => chart.materialAt(u, v), materials: chart.materials.map((m) => ({ neutral: m.kind === "neutral" ? m.reflectance : 0.5 })),
    whiteRadiance: Float64Array.of(0.5, 0.9, 0.7) } };
}
/** A self-check's setup around its expected-signal input: the common frame and view, the bilinear demosaic, gains, matrix and tone curve, plus `extra`. */
export function conformanceSetup(signalInput: DisplayViewExpectedSignalInput, readout: DisplayViewSetup["readout"][0], seed: number, reachSites: number, signal: AbortSignal | undefined,
  extra: Partial<DisplayViewSetup> = {}): DisplayViewSetup {
  const { frameWidth, frameHeight, margin, nativeWidth, nativeHeight } = CONFORMANCE_FRAME;
  return { frameWidth, frameHeight, margin, nativeWidth, nativeHeight, viewWidth: 13, viewHeight: 9, region: { x: 0, y: 0, width: 13, height: 9 },
    samplesPerAxis: 16, reachSites, bitDepth: 8, seed, signal: createDisplayViewExpectedSignal(signalInput), readout: [readout, readout, readout], demosaic: bilinearKernels(),
    gains: [1.1, 1, 1.6], clipLevel: 1, matrix: [[3.08, -1.54, -0.54], [-0.92, 1.88, 0.045], [0.053, -0.2, 1.15]], toneCurve: "identity",
    yieldControl: async (): Promise<void> => undefined, checkAbort: (): void => { if (signal?.aborted) throw abortedError(); }, ...extra };
}
/** Runs a self-check's GPU render with an abort controller that follows `signal`, and the device's pipelines under it. */
export async function withConformanceAbort<T>(runtime: WebGpuRuntime, signal: AbortSignal | undefined, run: (abort: AbortController, pipelines: PipelineSource) => Promise<T>): Promise<T> {
  const abort = new AbortController(), onAbort = (): void => abort.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) abort.abort();
    return await run(abort, (label, code) => createComputePipeline(runtime, label, code, abort.signal));
  } finally { signal?.removeEventListener("abort", onAbort); }
}

export const DISPLAY_VIEW_SPEED_CONFORMANCE_CASE: DisplayViewGpuConformanceCase = { id: "display-view:speed:checkerboard-13x9", async run(handle, signal): Promise<true | string> {
  // The handle is the engine's own runtime (the contract keeps WebGPU types out of the published declarations).
  const runtime = handle as WebGpuRuntime, { nativeWidth, nativeHeight, frameWidth, nodes } = CONFORMANCE_FRAME, g = 2 / frameWidth, { chart, scene } = conformanceChart();
  const offsets = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].map(([x, y]) => ({ x: x!, y: y!, weight: 0.25 }));
  const signalInput: DisplayViewExpectedSignalInput = { nativeWidth, nativeHeight, outputWidth: frameWidth, wavelengthsNm: nodes, electronsPerRadiance: conformanceResponses(1), offsets, scene,
    channelAt: conformanceChannelAt, queryPoint: (x, y, o, out) => { out[0] = (x + 0.5 + offsets[o]!.x - nativeWidth / 2) * g; out[1] = -(y + 0.5 + offsets[o]!.y - nativeHeight / 2) * g; } };
  const setup = conformanceSetup(signalInput, { perElectron: 1 / 60000, darkElectrons: 0.07, constantVariance: 1.5e-9 }, 478, 2, signal);
  const reference = await renderDisplayView(setup);
  // #533: the verdict includes the saturated-pixel count (the light squares sit at the white clip).
  return await withConformanceAbort(runtime, signal, async (abort, pipelines) =>
    conformanceVerdict(reference, await renderDisplayViewSpeedOnGpu(runtime, 1 << 20, { setup, signalInput, material: chartPresetMaterialModule(chart) }, abort, undefined, pipelines)));
} };

/**
 * The display view's Speed renderer on one runtime (#481's `DisplayViewGpuRenderer`): one pipeline cache per device, the
 * material modules of `createDisplayViewMaterialModules` (the preset module per resolved chart, the composite module with its
 * scene records uploaded once per scene). `render` renders the part's region (`setup.gpu` carries the expected signal's input
 * and the resolved scene; a setup without it, a caller scene, a coarse view, a frame the kernel does not cover or a device
 * that fails the composite probe throws `unsupported-on-backend`), and throws `aborted` and `device-lost` as the accelerator's
 * operations do. `dispose` releases the uploaded scene records.
 */
export function createDisplayViewSpeedGpuRenderer(runtime: WebGpuRuntime, options: { maximumBandBytes?: number; yieldControl?: YieldControl } = {}): DisplayViewGpuRenderer {
  const pipelines = new Map<string, Promise<GPUComputePipeline>>();
  const bandBytes = options.maximumBandBytes ?? Math.min(64 * 1024 * 1024, runtime.maximumStorageBindingBytes);
  const source: PipelineSource = (label, code) => {
    let pending = pipelines.get(label);
    if (!pending) { pending = createComputePipeline(runtime, label, code, undefined); pipelines.set(label, pending); pending.catch(() => pipelines.delete(label)); }
    return pending;
  };
  const modules = createDisplayViewMaterialModules(runtime, source);
  return {
    id: "photivra-display-view-speed",
    supports: displayViewSpeedGpuSupports,
    conformanceCases: [DISPLAY_VIEW_SPEED_CONFORMANCE_CASE],
    async render(part: DisplayViewGpuPart): Promise<DisplayViewGpuRenderOutput> {
      const { setup, signal } = part;
      if (!setup.gpu) throw new ImageKernelExecutionError("unsupported-on-backend", "The display-view setup carries no GPU inputs (setup.gpu); use cpu-reference.");
      const abort = new AbortController(), onAbort = (): void => abort.abort();
      if (signal?.aborted) throw abortedError();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const material = await modules.moduleFor(setup.gpu, abort.signal);
        const result = await renderDisplayViewSpeedOnGpu(runtime, bandBytes, { setup, signalInput: setup.gpu.signalInput, material }, abort, options.yieldControl, source);
        return { samples: result.samples, expected: result.expected, noiseStd: result.noiseStd, sampleCount: result.sampleCount, siteCount: result.siteCount, detailPixelCount: result.detailPixelCount,
          uniformPixelCount: result.uniformPixelCount, ahdCorrectedPixelCount: result.ahdCorrectedPixelCount, estimation: result.estimation, saturated: result.saturated,
          saturatedPixelCount: result.saturatedPixelCount, errorBound: result.expectedValueBound,
          diagnosticUncertaintySampleCount: result.execution.diagnosticUncertaintySampleCount, ...(material.compositeProbe ? { compositeProbe: material.compositeProbe } : {}) };
      } finally { signal?.removeEventListener("abort", onAbort); }
    },
    dispose(): void { modules.release(); }
  };
}

/** The factory `prepareDisplayView` creates the renderer with (one per device). */
export const displayViewSpeedGpuRendererFactory: DisplayViewGpuRendererFactory = (handle: DisplayViewGpuRuntimeHandle) => createDisplayViewSpeedGpuRenderer(handle as WebGpuRuntime);

/**
 * Registers the Speed renderer as the display view's GPU renderer (`setDisplayViewGpuRendererFactory`) and returns the factory
 * registered before. Nothing registers it on import: the integration of #481 decides where the engine registers it.
 */
export function registerDisplayViewSpeedGpuRenderer(): DisplayViewGpuRendererFactory | null {
  return setDisplayViewGpuRendererFactory(displayViewSpeedGpuRendererFactory);
}
