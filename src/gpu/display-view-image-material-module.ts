// SPDX-License-Identifier: Apache-2.0

/**
 * The image-plane module of the GPU display view (#581): the Speed kernel's `scene_value` (the seam of #478 and #491,
 * `DisplayViewGpuMaterialModule`) for an image-plane print, so that a photo renders on the device like a chart.
 *
 * **What the reference computes** at a query point (expected-signal.ts, the direct path's `signalAt`): the print-local point
 * cu = u·m/h, cv = v·m/h (outside |cu| ≤ 1, |cv| ≤ aspect the surround: its reflectance times the neutral signal N_c); the
 * pixel coordinates X = (cu + 1)·W/2, Y = (aspect − cv)·H/(2·aspect); then the bilinear weights of the four nearest pixel
 * centers (clamped to the edge) times each pixel's channel signal S_j,c = ρ_black·N_c + (ρ_white − ρ_black)·Σ_k w_jk·T_k,c (its
 * eight lattice nodes' table values, `ResolvedImagePlaneScene.pixelValue`), or the nearest pixel's.
 *
 * **On the device.** The host computes every pixel's S_j,c in float64 and rounds it once to float32 (one buffer, 3 values per
 * pixel, uploaded once per scene and kept while the renderer lives). The module recovers the exact lattice point from the
 * kernel's float32 point as the composite module does (`LATTICE_POINT_WGSL`, about 2⁻⁴⁶ relative), forms cu, cv, X and Y
 * in double-float32 and decides the print's edge in the composite kernel's bound arithmetic (a point within its bound of the
 * edge is flagged: the display pixel is recomputed on the host). Per axis it splits s = X − ½ into its integer part n and
 * fraction f exactly (double-float32), rounds the smaller of f and 1 − f once to float32 and forms the other as 1 minus it, so
 * each weight carries at most 2E relative error (E = 2⁻²³) besides the point's own error. The point's error moves weight
 * between neighbors: with δ the bound of |X_gpu − X_ref| in pixels (4·(2⁻⁴⁰·(|X| + 1)) + 4·10⁻¹⁴·W/2·k: the recovery, the
 * double-float32 steps and the reference's own float64 rounding of its query point, generously), the value moves by at most
 * (δx + δy)·2·max S, and the point is flagged when that exceeds E times the value. So an unflagged value carries a relative
 * error only: S's rounding 1, the weights 2 + 2, the two products and two sums 4, the flag's budget 1, that is 10 roundings
 * beyond the table lookup's one (`extraSiteRoundings`), added to the Speed kernel's chains (docs/WEBGPU.md, "Display view (Speed)").
 * `nearest` takes the pixel under the point, flagging a point within its bound of a pixel edge (`bfloor`). All S are
 * non-negative (non-negative responses, illuminant and spectra), so the weighted sums need no cancellation term.
 *
 * The surround's three channel signals are the kernel's site table (so the kernel's binding 3 stays in use).
 */

import { ImageKernelExecutionError } from "./image-kernel-execution.js";
import { BUFFER_USAGE, GpuResourceScope, type WebGpuRuntime } from "./webgpu-runtime.js";
import { dwSplit } from "./chart-composite-gpu.js";
import type { ChartCompositeProductPath } from "./wgsl-chart-composite-kernel.js";
import { displayViewModuleCommonWgsl, displayViewLatticeConstants, LATTICE_BINDINGS_WGSL, LATTICE_POINT_WGSL } from "./display-view-composite-material-module.js";
import type { DisplayViewGpuMaterialModule } from "./display-view-speed-gpu.js";
import { createDisplayViewExpectedSignal, renderDisplayView, type DisplayViewGpuSetup, type DisplayViewSetup } from "../facade/display-view.js";
import type { DisplayViewExpectedSignalInput } from "../facade/expected-signal.js";
import type { ImagePlaneSignalScene } from "../facade/scene-radiance.js";
import { imagePlaneSupport } from "../facade/image-plane-support.js";
import { conformanceVerdict, renderDisplayViewSpeedOnGpu } from "./display-view-speed-gpu.js";
import { bilinearKernels } from "./display-view-quality-gpu.js";
import { ChartCompositeProbeError, probeChartCompositeDevice } from "./chart-composite-gpu.js";
import { abortedError, createComputePipeline } from "./webgpu-runtime.js";

/** The module's id per product path. */
export function imagePlaneMaterialModuleId(path: ChartCompositeProductPath): string { return path === "dekker" ? "image-plane" : "image-plane-fma"; }
/** Roundings of the module's value beyond the table lookup's one (see the module comment). */
export const IMAGE_PLANE_EXTRA_SITE_ROUNDINGS = 10;
/** Layout of the photo uniform (float32 / u32 words, 64 bytes). */
export const IMAGE_PLANE_PARAMS = /* @__PURE__ */ Object.freeze({ width: 0, height: 1, nearest: 2, halfWHi: 4, halfWLo: 5, halfHHi: 6, halfHLo: 7, aspectHi: 8, aspectLo: 9,
  slackX: 10, slackY: 11, words: 16 });
/** Table values above this are outside the float32 domain. */
const FLOAT32_SAFE_MAGNITUDE = 2 ** 120;
/** Scenes whose pixel signals stay uploaded per renderer. */
const KEPT_SCENES = 2;

/** The module's WGSL with one product path (see the module comment). */
export function imagePlaneMaterialWgsl(path: ChartCompositeProductPath = "dekker"): string {
  return `${displayViewModuleCommonWgsl(path)}
@group(1) @binding(0) var<storage, read> photo_signal: array<f32>;
struct PhotoParams {
  width: u32, height: u32, nearest: u32, pad0: u32,
  half_w_hi: f32, half_w_lo: f32, half_h_hi: f32, half_h_lo: f32,
  aspect_hi: f32, aspect_lo: f32, slack_x: f32, slack_y: f32,
  pad1: f32, pad2: f32, pad3: f32, pad4: f32,
};
@group(1) @binding(1) var<uniform> photo: PhotoParams;
${LATTICE_BINDINGS_WGSL}
${LATTICE_POINT_WGSL}
// The point's error bound in pixels along one axis (see the module comment).
fn pixel_slack(x: D, slack: f32) -> f32 { return 4.0 * (DW * (abs(x.h) + 1.0)) + 4.0 * slack; }
// One axis of the bilinear weights: the pixel pair (clamped to the edge) and the weights of s = X − 1/2.
struct Axis { i0: u32, i1: u32, w0: f32, w1: f32 }
fn bilinear_axis(s: D, n: u32) -> Axis {
  var f0 = floor(s.h);
  if (f0 == s.h && s.l < 0.0) { f0 = f0 - 1.0; }
  let frac = d_sub(s, D(f0, 0.0));
  let comp = d_sub(D(ob(f0 + 1.0), 0.0), s);
  var w0 = 0.0; var w1 = 0.0;
  if (frac.h <= 0.5) { w1 = ob(frac.h + frac.l); w0 = ob(1.0 - w1); } else { w0 = ob(comp.h + comp.l); w1 = ob(1.0 - w0); }
  let last = i32(n) - 1;
  return Axis(u32(clamp(i32(f0), 0, last)), u32(clamp(i32(f0) + 1, 0, last)), w0, w1);
}
fn photo_at(i: u32, j: u32, c: u32) -> f32 { return photo_signal[(j * photo.width + i) * 3u + c]; }
fn scene_value(p: vec2<f32>, c: u32) -> f32 {
  let k = D(lattice.chart_k_hi, lattice.chart_k_lo);
  let u = d_mul(lattice_point(p.x, D(lattice.scale_u_hi, lattice.scale_u_lo), 0u), k);
  let v = d_mul(lattice_point(p.y, D(lattice.scale_v_hi, lattice.scale_v_lo), 1u), k);
  let aspect = D(photo.aspect_hi, photo.aspect_lo);
  if (!(le(babs(bd(u)), bx(1.0)) && le(babs(bd(v)), bd(aspect)))) { return site_table[c]; }
  let x = d_mul(d_add(u, D(1.0, 0.0)), D(photo.half_w_hi, photo.half_w_lo));
  let y = d_mul(d_sub(aspect, v), D(photo.half_h_hi, photo.half_h_lo));
  if (photo.nearest != 0u) {
    let last_x = f32(photo.width - 1u);
    let last_y = f32(photo.height - 1u);
    let i = u32(clamp(bfloor(bd(x), 1.0, last_x), 0.0, last_x));
    let j = u32(clamp(bfloor(bd(y), 1.0, last_y), 0.0, last_y));
    return photo_at(i, j, c);
  }
  let ax = bilinear_axis(d_sub(x, D(0.5, 0.0)), photo.width);
  let ay = bilinear_axis(d_sub(y, D(0.5, 0.0)), photo.height);
  let s00 = photo_at(ax.i0, ay.i0, c);
  let s10 = photo_at(ax.i1, ay.i0, c);
  let s01 = photo_at(ax.i0, ay.i1, c);
  let s11 = photo_at(ax.i1, ay.i1, c);
  let value = ob(ob(ay.w0 * ob(ob(ax.w0 * s00) + ob(ax.w1 * s10))) + ob(ay.w1 * ob(ob(ax.w0 * s01) + ob(ax.w1 * s11))));
  let largest = max(max(s00, s10), max(s01, s11));
  let moved = (pixel_slack(x, photo.slack_x) + pixel_slack(y, photo.slack_y)) * 2.0 * largest;
  if (!(moved <= E * value)) { material_uncertain = true; }
  return value;
}
`;
}

/** The image-plane print behind a GPU setup's expected signal (`ImagePlaneSignalScene.image`), or undefined. */
export function imagePlaneOf(gpu: DisplayViewGpuSetup): ImagePlaneSignalScene["image"] | undefined {
  return (gpu.signalInput.scene as { image?: ImagePlaneSignalScene["image"] }).image;
}
/** The pixel signals of a scene on the device (per renderer), keyed by the signal scene's image record. */
interface UploadedImage { key: object; scope: GpuResourceScope; buffer: GPUBuffer; surround: Float32Array<ArrayBuffer> }

/** The image-plane modules of one display-view renderer: `moduleFor` builds the setup's module (its uploads kept), `release` frees them. */
export interface DisplayViewImageModules {
  /** The setup's module; the first call on a runtime runs the module's self-check (`runImagePlaneConformance`) and refuses the device if it fails. */
  moduleFor(gpu: DisplayViewGpuSetup, path: ChartCompositeProductPath): Promise<DisplayViewGpuMaterialModule>;
  /** The setup's module without the self-check (the self-check itself uses it). */
  build(gpu: DisplayViewGpuSetup, path: ChartCompositeProductPath): DisplayViewGpuMaterialModule;
  release(): void;
}

export function createDisplayViewImageModules(runtime: WebGpuRuntime): DisplayViewImageModules {
  const uploads: UploadedImage[] = [], wgsl = new Map<ChartCompositeProductPath, string>();
  const upload = (image: ImagePlaneSignalScene["image"]): UploadedImage => {
    const key = image as object, index = uploads.findIndex((e) => e.key === key);
    if (index >= 0) { const [entry] = uploads.splice(index, 1); uploads.push(entry!); return entry!; }
    const { scene, tables } = image, pixels = scene.width * scene.height;
    if (pixels * 12 > runtime.maximumStorageBindingBytes) throw new ImageKernelExecutionError("insufficient-limits", "The image's pixel signals (" + pixels * 12 + " bytes) exceed the device's storage binding limit.");
    const values = new Float32Array(pixels * 3);
    for (let j = 0; j < pixels; j++) for (let c = 0; c < 3; c++) {
      const value = scene.pixelValue(j, tables.nodes[c as 0 | 1 | 2], tables.neutral[c as 0 | 1 | 2]);
      if (!(value >= 0 && value <= FLOAT32_SAFE_MAGNITUDE)) throw new ImageKernelExecutionError("unsupported-float32-domain", "A pixel's channel signal is outside the float32 domain.");
      values[j * 3 + c] = value;
    }
    const surround = Float32Array.from(image.surround);
    const scope = new GpuResourceScope(runtime);
    const entry: UploadedImage = { key, scope, buffer: scope.upload("photivra-display-view-image-signal", values, BUFFER_USAGE.STORAGE), surround };
    uploads.push(entry);
    while (uploads.length > KEPT_SCENES) uploads.shift()!.scope.release();
    return entry;
  };
  let checked: Promise<true | string> | null = null;
  const build = (gpu: DisplayViewGpuSetup, path: ChartCompositeProductPath): DisplayViewGpuMaterialModule => {
      const image = imagePlaneOf(gpu);
      if (!image || !gpu.placement) throw new ImageKernelExecutionError("unsupported-on-backend", "The setup carries no image-plane print and placement; use cpu-reference.");
      const scene = image.scene, lattice = displayViewLatticeConstants(gpu.signalInput, gpu.placement, 0), uploaded = upload(image);
      const params = new ArrayBuffer(4 * IMAGE_PLANE_PARAMS.words), words = new Uint32Array(params), floats = new Float32Array(params), P = IMAGE_PLANE_PARAMS;
      words[P.width] = scene.width; words[P.height] = scene.height; words[P.nearest] = scene.interpolation === "nearest" ? 1 : 0;
      const halfW = scene.width / 2, halfH = scene.height / (2 * scene.aspect);
      [floats[P.halfWHi], floats[P.halfWLo]] = dwSplit(halfW); [floats[P.halfHHi], floats[P.halfHLo]] = dwSplit(halfH); [floats[P.aspectHi], floats[P.aspectLo]] = dwSplit(scene.aspect);
      // The reference's float64 query point carries up to 10⁻¹⁴ frame units (the composite kernel's slack) times the pixels per frame unit.
      floats[P.slackX] = 1e-14 * gpu.placement.chartUnitsPerFrameUnit * halfW; floats[P.slackY] = 1e-14 * gpu.placement.chartUnitsPerFrameUnit * halfH;
      let code = wgsl.get(path);
      if (code === undefined) { code = imagePlaneMaterialWgsl(path); wgsl.set(path, code); }
      return { id: imagePlaneMaterialModuleId(path), wgsl: code, extraSiteRoundings: IMAGE_PLANE_EXTRA_SITE_ROUNDINGS, siteTable: uploaded.surround, bindings: [
        { binding: 0, kind: "storage", buffer: uploaded.buffer }, { binding: 1, kind: "uniform", data: new Uint8Array(params) },
        { binding: 2, kind: "uniform", data: new Uint8Array(lattice.params) }, { binding: 3, kind: "storage", data: lattice.offsets }] };
  };
  return {
    async moduleFor(gpu, path): Promise<DisplayViewGpuMaterialModule> {
      // The module's self-check, once per runtime (single flight; a failure is retried on the next photo).
      checked ??= runImagePlaneConformance(runtime, undefined).catch((error: unknown) => { checked = null; throw error; });
      const verdict = await checked;
      if (verdict !== true) { checked = null; throw new ImageKernelExecutionError("unsupported-on-backend", "The image-plane module failed its self-check on this device: " + verdict); }
      return build(gpu, path);
    },
    build,
    release(): void { for (const entry of uploads.splice(0)) entry.scope.release(); }
  };
}

/**
 * #581's run-time self-check of the module (`display-view:speed:image-plane-13x9`): a 12 × 8 photo (a color ramp with hard edges,
 * every lattice cell's corner colors among its pixels) printed at 0.8 of the frame's width on the 18 % surround of a 38 × 26 frame
 * shown at 13 × 9, the GPU against `renderDisplayView` within the a-priori bounds, every flagged pixel recomputed. A device that
 * fails the double-float32 probe refuses photos (unsupported-on-backend, as composite charts), so the check passes there without
 * keeping the device's charts off the GPU.
 */
export async function runImagePlaneConformance(handle: unknown, signal: AbortSignal | undefined): Promise<true | string> {

  const runtime = handle as WebGpuRuntime, support = imagePlaneSupport();
  if (!support) return true;
  const nativeWidth = 40, nativeHeight = 28, margin = 1, frameWidth = 38, frameHeight = 26, g = 2 / frameWidth, nodes = [450, 550, 650];
  const width = 12, height = 8, data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) data[(y * width + x) * 3 + c] = [(x * 23) % 256, (y * 37 + x * 5) % 256, x < 6 ? 255 - y * 30 : 10][c]!;
  const printWidth = 1.6, aspect = height / width, k = 2 / printWidth, surround = 0.18;
  const scene = await support.resolveImagePlaneScene({ kind: "image-plane", sceneId: "conformance", image: { width, height, channels: 3, encoding: "srgb-8", data } }, aspect);
  const white = Float64Array.of(0.5, 0.9, 0.7), A: [Float64Array, Float64Array, Float64Array] = [Float64Array.of(9000, 30000, 4000), Float64Array.of(6000, 42000, 9000), Float64Array.of(30000, 9000, 3000)];
  const printScene = scene.signalScene(nodes, A, white, () => { throw new ImageKernelExecutionError("gpu-validation", "The self-check reads the node tables only."); }, k, 1, surround);
  const offsets = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].map(([x, y]) => ({ x: x!, y: y!, weight: 0.25 }));
  const signalInput: DisplayViewExpectedSignalInput = { nativeWidth, nativeHeight, outputWidth: frameWidth, wavelengthsNm: nodes, electronsPerRadiance: A, offsets,
    scene: printScene,
    channelAt: (x, y) => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2)),
    queryPoint: (x, y, o, out) => { out[0] = (x + 0.5 + offsets[o]!.x - nativeWidth / 2) * g; out[1] = -(y + 0.5 + offsets[o]!.y - nativeHeight / 2) * g; } };
  const readout = { perElectron: 1 / 60000, darkElectrons: 0.07, constantVariance: 1.5e-9 };
  const setup: DisplayViewSetup = { frameWidth, frameHeight, margin, nativeWidth, nativeHeight, viewWidth: 13, viewHeight: 9, region: { x: 0, y: 0, width: 13, height: 9 },
    samplesPerAxis: 16, reachSites: 2, bitDepth: 8, seed: 581, signal: createDisplayViewExpectedSignal(signalInput), readout: [readout, readout, readout], demosaic: bilinearKernels(),
    gains: [1.1, 1, 1.6], clipLevel: 1, matrix: [[3.08, -1.54, -0.54], [-0.92, 1.88, 0.045], [0.053, -0.2, 1.15]], toneCurve: "identity",
    yieldControl: async () => undefined, checkAbort: () => { if (signal?.aborted) throw abortedError(); },
    gpu: { signalInput, chart: null, placement: { chartUnitsPerFrameUnit: k, aspect } } };
  const reference = await renderDisplayView(setup);
  const abort = new AbortController(), onAbort = (): void => abort.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const images = createDisplayViewImageModules(runtime);
  try {
    if (signal?.aborted) abort.abort();
    const pipelines = (label: string, code: string): Promise<GPUComputePipeline> => createComputePipeline(runtime, label, code, abort.signal);
    // A device that fails the double-float32 probe refuses image-plane renders (unsupported-on-backend, as composite charts); the
    // self-check then has nothing of the module's to check, and must not keep the device's charts off the GPU.
    let path: "dekker" | "fma";
    try { path = (await probeChartCompositeDevice(runtime, pipelines, abort.signal)).productPath ?? "dekker"; } catch (error) {
      if (error instanceof ChartCompositeProbeError) return true;
      throw error;
    }
    const gpu = await renderDisplayViewSpeedOnGpu(runtime, 1 << 20, { setup, signalInput, material: images.build(setup.gpu!, path) }, abort, undefined, pipelines);
    return conformanceVerdict(reference, gpu);
  } finally { images.release(); signal?.removeEventListener("abort", onAbort); }
}
