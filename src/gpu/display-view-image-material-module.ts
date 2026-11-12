// SPDX-License-Identifier: Apache-2.0

/**
 * The image-plane module of the GPU display view (#581): the Speed kernel's `scene_value` (the seam of #478 and #491,
 * `DisplayViewGpuMaterialModule`) for an image-plane print, so that a photo renders on the device like a chart.
 *
 * **What the reference computes** at a query point (expected-signal.ts, the direct path's `signalAt`): the print-local point
 * cu = u·m/h, cv = v·m/h (outside |cu| ≤ 1, |cv| ≤ aspect the surround: its reflectance times the neutral signal N_c); the
 * pixel coordinates X = (cu + 1)·W/2, Y = (aspect − cv)·H/(2·aspect); then the bilinear weights of the four nearest pixel
 * centers (clamped to the edge) times each pixel's channel signal S_j,c = Σ_n A_c(λ_n)·ρ_j(λ_n)·W_n, integrated from the pixel's
 * reconstructed spectrum ρ_j (its cell's eight node spectra blended, then the paper; `ResolvedImagePlaneScene.pixelSignals`), or
 * the nearest pixel's. No per-channel values of the lattice nodes are formed.
 *
 * **On the device.** The host computes every pixel's S_j,c in float64 and rounds it once to float32 (3 values per pixel). When
 * they fit one storage binding they are uploaded once per scene and kept on the device while the renderer lives; otherwise each
 * band of a render builds and uploads only its rows. Either way they are built and written 4 MiB of rows at a time, so the host
 * never holds more than that of S (owner decision 2026-11-09; the bytes are those of the whole array). The module recovers the exact lattice point from the
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
 * The surround's three channel signals, integrated from its spectrum (its reflectance times the white radiance at each node) like
 * a pixel's, are the kernel's binding 3 (`spectral_table`, which this module does not otherwise use).
 */

import { ImageKernelExecutionError, type ChartCompositeProbeRecord } from "./image-kernel-execution.js";
import { BUFFER_USAGE, GpuResourceScope, type WebGpuRuntime } from "./webgpu-runtime.js";
import { dwSplit } from "./chart-composite-gpu.js";
import type { ChartCompositeProductPath } from "./wgsl-chart-composite-kernel.js";
import { displayViewModuleCommonWgsl, displayViewLatticeConstants, LATTICE_BINDINGS_WGSL, LATTICE_POINT_WGSL } from "./display-view-composite-material-module.js";
import type { DisplayViewGpuMaterialModule } from "./display-view-speed-gpu.js";
import { renderDisplayView, type DisplayViewGpuSetup } from "../facade/display-view.js";
import type { DisplayViewExpectedSignalInput } from "../facade/expected-signal.js";
import { resolveCaptureIlluminant, type ImagePlaneSignalScene } from "../facade/scene-radiance.js";
import { resolveMixedIllumination } from "../facade/mixed-illumination.js";
import { imagePlaneSupport } from "../facade/image-plane-support.js";
import { CONFORMANCE_FRAME, conformanceChannelAt, conformanceResponses, conformanceSetup, conformanceVerdict, renderDisplayViewSpeedOnGpu, withConformanceAbort } from "./display-view-speed-gpu.js";
import { renderDisplayViewQualityOnGpu, type DisplayViewQualityImagePasses } from "./display-view-quality-gpu.js";
import { imagePlaneQualityPasses } from "./display-view-image-quality.js";
import { ChartCompositeProbeError, probeChartCompositeDevice } from "./chart-composite-gpu.js";
import { createComputePipeline } from "./webgpu-runtime.js";

/** The module's id per product path. */
export function imagePlaneMaterialModuleId(path: ChartCompositeProductPath): string { return path === "dekker" ? "image-plane" : "image-plane-fma"; }
/** Roundings of the module's value beyond the table lookup's one (see the module comment). */
export const IMAGE_PLANE_EXTRA_SITE_ROUNDINGS = 10;
/** Layout of the photo uniform (float32 / u32 words, 64 bytes). */
export const IMAGE_PLANE_PARAMS = /* @__PURE__ */ Object.freeze({ width: 0, height: 1, nearest: 2, row0: 3, halfWHi: 4, halfWLo: 5, halfHHi: 6, halfHLo: 7, aspectHi: 8, aspectLo: 9,
  slackX: 10, slackY: 11, words: 16 });
/** Table values above this are outside the float32 domain. */
const FLOAT32_SAFE_MAGNITUDE = 2 ** 120;
/** Host bytes of pixel signals built per write (whole uploads and bands). */
const UPLOAD_CHUNK_BYTES = 4 << 20;
/** Scenes whose pixel signals stay uploaded per renderer. */
const KEPT_SCENES = 2;

/** The module's WGSL with one product path (see the module comment). */
export function imagePlaneMaterialWgsl(path: ChartCompositeProductPath = "dekker"): string {
  return `${displayViewModuleCommonWgsl(path)}
@group(1) @binding(0) var<storage, read> photo_signal: array<f32>;
struct PhotoParams {
  width: u32, height: u32, nearest: u32, row0: u32,
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
fn photo_at(i: u32, j: u32, c: u32) -> f32 { return photo_signal[((j - photo.row0) * photo.width + i) * 3u + c]; }
fn scene_value(p: vec2<f32>, c: u32) -> f32 {
  let k = D(lattice.chart_k_hi, lattice.chart_k_lo);
  let u = d_mul(lattice_point(p.x, D(lattice.scale_u_hi, lattice.scale_u_lo), 0u), k);
  let v = d_mul(lattice_point(p.y, D(lattice.scale_v_hi, lattice.scale_v_lo), 1u), k);
  let aspect = D(photo.aspect_hi, photo.aspect_lo);
  if (!(le(babs(bd(u)), bx(1.0)) && le(babs(bd(v)), bd(aspect)))) { return spectral_table[c]; }
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
  moduleFor(gpu: DisplayViewGpuSetup, signal: AbortSignal): Promise<DisplayViewGpuMaterialModule>;
  /** The setup's module without the self-check (the self-check itself uses it). */
  build(gpu: DisplayViewGpuSetup, path: ChartCompositeProductPath): DisplayViewGpuMaterialModule;
  /** #581: the print's Quality passes 1 and 2 (src/gpu/display-view-image-quality.ts), after the same self-check. */
  qualityPasses(gpu: DisplayViewGpuSetup, signal: AbortSignal): Promise<DisplayViewQualityImagePasses>;
  release(): void;
}

/**
 * The image-plane modules of a renderer; `probe` is the composite module's device probe (single flight), whose double-word product
 * path the module's double-float32 takes.
 */
export function createDisplayViewImageModules(runtime: WebGpuRuntime, probe: (signal: AbortSignal) => Promise<ChartCompositeProbeRecord>): DisplayViewImageModules {
  const uploads: UploadedImage[] = [], wgsl = new Map<ChartCompositeProductPath, string>();
  // Pixel rows [j0, j1)'s channel signals, built on demand so that the host holds one chunk or band (#581): each pixel's signals
  // integrated from its reconstructed spectrum (`pixelSignals`, the reference's own float64 values), rounded once.
  const pixel = new Float64Array(3);
  const rowsOf = (image: ImagePlaneSignalScene["image"], j0: number, j1: number): Float32Array<ArrayBuffer> => {
    const { scene, nodes } = image, values = new Float32Array((j1 - j0) * scene.width * 3);
    for (let j = j0 * scene.width, o = 0; j < j1 * scene.width; j++) {
      scene.pixelSignals(j, nodes, pixel, 0);
      for (let c = 0; c < 3; c++) {
        const value = pixel[c]!;
        if (!(value >= 0 && value <= FLOAT32_SAFE_MAGNITUDE)) throw new ImageKernelExecutionError("unsupported-float32-domain", "A pixel's channel signal is outside the float32 domain.");
        values[o++] = value;
      }
    }
    return values;
  };
  // Rows [a, b)'s signals written to `buffer` (whose first row is `base`), built UPLOAD_CHUNK_BYTES of rows at a time.
  const fill = (buffer: GPUBuffer, image: ImagePlaneSignalScene["image"], a: number, b: number, base: number): void => {
    const rowBytes = image.scene.width * 12, chunk = Math.max(1, Math.floor(UPLOAD_CHUNK_BYTES / rowBytes));
    for (let j = a; j < b; j += chunk) { const rows = rowsOf(image, j, Math.min(b, j + chunk)); runtime.device.queue.writeBuffer(buffer, (j - base) * rowBytes, rows.buffer, 0, rows.byteLength); }
  };
  const rowsBuffer = (scope: GpuResourceScope, label: string, image: ImagePlaneSignalScene["image"], j0: number, j1: number): GPUBuffer => {
    const buffer = scope.buffer(label, (j1 - j0) * image.scene.width * 12, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST);
    fill(buffer, image, j0, j1, j0);
    return buffer;
  };
  // The latest band's rows stay on the device until the next band: the rows the two share are copied there on the device, and
  // only the others are built on the host (the same bytes; the host still holds one chunk at most).
  let lastBand: { image: object; j0: number; j1: number; scope: GpuResourceScope; buffer: GPUBuffer } | null = null;
  const bandBuffer = (image: ImagePlaneSignalScene["image"], j0: number, j1: number): GPUBuffer => {
    const rowBytes = image.scene.width * 12, scope = new GpuResourceScope(runtime), last = lastBand?.image === image ? lastBand : null;
    try {
      const buffer = scope.buffer("photivra-display-view-image-signal-band", (j1 - j0) * rowBytes, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST | BUFFER_USAGE.COPY_SRC);
      const o0 = last ? Math.max(j0, last.j0) : j0, o1 = last ? Math.min(j1, last.j1) : j0;
      if (o1 > o0) {
        const encoder = runtime.device.createCommandEncoder({ label: "photivra-display-view-image-band-rows" });
        encoder.copyBufferToBuffer(last!.buffer, (o0 - last!.j0) * rowBytes, buffer, (o0 - j0) * rowBytes, (o1 - o0) * rowBytes);
        runtime.device.queue.submit([encoder.finish()]);
        fill(buffer, image, j0, o0, j0); fill(buffer, image, o1, j1, j0);
      } else fill(buffer, image, j0, j1, j0);
      lastBand?.scope.release();
      lastBand = { image, j0, j1, scope, buffer };
      return buffer;
    } catch (error) { scope.release(); throw error; }
  };
  const upload = (image: ImagePlaneSignalScene["image"]): UploadedImage => {
    const key = image as object, index = uploads.findIndex((e) => e.key === key);
    if (index >= 0) { const [entry] = uploads.splice(index, 1); uploads.push(entry!); return entry!; }
    const scope = new GpuResourceScope(runtime);
    let buffer: GPUBuffer;
    try { buffer = rowsBuffer(scope, "photivra-display-view-image-signal", image, 0, image.scene.height); } catch (error) { scope.release(); throw error; }
    const entry: UploadedImage = { key, scope, buffer, surround: Float32Array.from(image.surround) };
    uploads.push(entry);
    while (uploads.length > KEPT_SCENES) uploads.shift()!.scope.release();
    return entry;
  };
  let checked: Promise<true | string> | null = null;
  const build = (gpu: DisplayViewGpuSetup, path: ChartCompositeProductPath): DisplayViewGpuMaterialModule => {
      const image = imagePlaneOf(gpu);
      if (!image || !gpu.placement) throw new ImageKernelExecutionError("unsupported-on-backend", "The setup carries no image-plane print and placement; use cpu-reference.");
      const scene = image.scene, lattice = displayViewLatticeConstants(gpu.signalInput, gpu.placement, 0), rowBytes = scene.width * 12, banded = scene.height * rowBytes > runtime.maximumStorageBindingBytes;
      const params = new ArrayBuffer(4 * IMAGE_PLANE_PARAMS.words), words = new Uint32Array(params), floats = new Float32Array(params), P = IMAGE_PLANE_PARAMS;
      words[P.width] = scene.width; words[P.height] = scene.height; words[P.nearest] = scene.interpolation === "nearest" ? 1 : 0;
      const halfW = scene.width / 2, halfH = scene.height / (2 * scene.aspect);
      [floats[P.halfWHi], floats[P.halfWLo]] = dwSplit(halfW); [floats[P.halfHHi], floats[P.halfHLo]] = dwSplit(halfH); [floats[P.aspectHi], floats[P.aspectLo]] = dwSplit(scene.aspect);
      // The reference's float64 query point carries up to 10⁻¹⁴ frame units (the composite kernel's slack) times the pixels per frame unit.
      floats[P.slackX] = 1e-14 * gpu.placement.chartUnitsPerFrameUnit * halfW; floats[P.slackY] = 1e-14 * gpu.placement.chartUnitsPerFrameUnit * halfH;
      let code = wgsl.get(path);
      if (code === undefined) { code = imagePlaneMaterialWgsl(path); wgsl.set(path, code); }
      const base = { id: imagePlaneMaterialModuleId(path), wgsl: code, extraSiteRoundings: IMAGE_PLANE_EXTRA_SITE_ROUNDINGS, siteTable: Float32Array.from(image.surround) };
      if (!banded) {
        const uploaded = upload(image);
        return { ...base, bindings: [{ binding: 0, kind: "storage", buffer: uploaded.buffer }, { binding: 1, kind: "uniform", data: new Uint8Array(params) },
          { binding: 2, kind: "uniform", data: new Uint8Array(lattice.params) }, { binding: 3, kind: "storage", data: lattice.offsets }] };
      }
      // A photo larger than one binding: per band the pixel rows its native site rows reach. The print-local v of site row y and
      // query offset o is (y + c_o)·scale_v·k; the photo row is (aspect − v)·H/(2·aspect), plus two rows of margin either side.
      const offsetsV = Array.from({ length: lattice.offsets.length / 4 }, (_, o) => lattice.offsets[4 * o + 2]! + lattice.offsets[4 * o + 3]!);
      const rowOf = (y: number, c: number): number => (scene.aspect - (y + c) * lattice.scaleV * gpu.placement!.chartUnitsPerFrameUnit) * halfH;
      const rate = Math.abs(lattice.scaleV) * gpu.placement.chartUnitsPerFrameUnit * halfH, maximumRows = Math.floor(runtime.maximumStorageBindingBytes / rowBytes);
      return { ...base, bindings: [],
        bandRows: (sitesPerDisplayRow: number): number => Math.max(1, Math.floor(((maximumRows - 6) / rate - 6) / sitesPerDisplayRow)),
        band(scope, layout, y0, y1): GPUBindGroup {
          let low = Infinity, high = -Infinity;
          for (const y of [y0, y1]) for (const c of offsetsV) { const r = rowOf(y, c); low = Math.min(low, r); high = Math.max(high, r); }
          const j0 = Math.max(0, Math.min(scene.height - 1, Math.floor(low) - 2)), j1 = Math.max(j0, Math.min(scene.height - 1, Math.floor(high) + 2));
          if ((j1 - j0 + 1) * rowBytes > runtime.maximumStorageBindingBytes) throw new ImageKernelExecutionError("insufficient-limits", "A band's pixel signals exceed the device's storage binding limit.");
          const bandParams = params.slice(0);
          new Uint32Array(bandParams)[P.row0] = j0;
          return runtime.device.createBindGroup({ layout, entries: [
            { binding: 0, resource: { buffer: bandBuffer(image, j0, j1 + 1) } },
            { binding: 1, resource: { buffer: scope.upload("photivra-display-view-image-params", new Uint8Array(bandParams), BUFFER_USAGE.UNIFORM) } },
            { binding: 2, resource: { buffer: scope.upload("photivra-display-view-image-lattice", new Uint8Array(lattice.params), BUFFER_USAGE.UNIFORM) } },
            { binding: 3, resource: { buffer: scope.upload("photivra-display-view-image-offsets", lattice.offsets, BUFFER_USAGE.STORAGE) } }] });
        } };
  };
  // The module's self-check, once per runtime (single flight; a failure is retried on the next photo).
  const check = async (): Promise<void> => {
    checked ??= runImagePlaneConformance(runtime, undefined).catch((error: unknown) => { checked = null; throw error; });
    const verdict = await checked;
    if (verdict !== true) { checked = null; throw new ImageKernelExecutionError("unsupported-on-backend", "The image-plane module failed its self-check on this device: " + verdict); }
  };
  return {
    async moduleFor(gpu, signal): Promise<DisplayViewGpuMaterialModule> { const path = (await probe(signal)).productPath ?? "dekker"; await check(); return build(gpu, path); },
    async qualityPasses(gpu, signal): Promise<DisplayViewQualityImagePasses> { const path = (await probe(signal)).productPath ?? "dekker"; await check(); return imagePlaneQualityPasses(runtime, gpu, path); },
    build,
    release(): void { for (const entry of uploads.splice(0)) entry.scope.release(); lastBand?.scope.release(); lastBand = null; }
  };
}

/**
 * #581's run-time self-check of the module, run on a device's first photo: a 12 × 8 photo (a color ramp with hard edges, every
 * lattice cell's corner colors among its pixels) printed at 0.8 of the frame's width on the 18 % surround of a 38 × 26 frame shown
 * at 13 × 9, the GPU against `renderDisplayView` within the a-priori bounds, every flagged pixel recomputed: the Speed kernel with
 * the 2 × 2 box, then the Quality passes with the four-spot filter's 16 offsets and synthetic radius-1 kernels at three nodes, and
 * (#597) the same passes under mixed light (a three-source gradient with a hard edge and a point source).
 * A device that fails the double-float32 probe refuses photos (unsupported-on-backend, as composite charts), so the check passes
 * there without keeping the device's charts off the GPU.
 */
export async function runImagePlaneConformance(handle: unknown, signal: AbortSignal | undefined): Promise<true | string> {
  const runtime = handle as WebGpuRuntime, support = imagePlaneSupport();
  if (!support) return true;
  const { nativeWidth, nativeHeight, frameWidth, nodes } = CONFORMANCE_FRAME, g = 2 / frameWidth;
  const width = 12, height = 8, data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) data[(y * width + x) * 3 + c] = [(x * 23) % 256, (y * 37 + x * 5) % 256, x < 6 ? 255 - y * 30 : 10][c]!;
  const printWidth = 1.6, aspect = height / width, k = 2 / printWidth, surround = 0.18, placement = { chartUnitsPerFrameUnit: k, aspect };
  const scene = await support.resolveImagePlaneScene({ kind: "image-plane", sceneId: "conformance", image: { width, height, channels: 3, encoding: "srgb-8", data } }, aspect);
  const white = Float64Array.of(0.5, 0.9, 0.7), A = conformanceResponses(1);
  // The print's radiance as the provider forms it: the print-local point, the surround outside, times the white radiance at the node.
  const radianceAt = (u: number, v: number, nm: number): number => {
    const cu = u * k, cv = v * k;
    return (Math.abs(cu) <= 1 && Math.abs(cv) <= aspect ? scene.reflectanceAt(cu, cv, nm) : surround) * white[nodes.indexOf(nm)]!;
  };
  const printScene = scene.signalScene(nodes, A, white, radianceAt, k, 1, surround), readout = { perElectron: 1 / 60000, darkElectrons: 0.07, constantVariance: 1.5e-9 };
  const speedOffsets = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].map(([x, y]) => ({ x: x!, y: y!, weight: 0.25 }));
  const speedInput: DisplayViewExpectedSignalInput = { nativeWidth, nativeHeight, outputWidth: frameWidth, wavelengthsNm: nodes, electronsPerRadiance: A, offsets: speedOffsets, scene: printScene,
    channelAt: conformanceChannelAt, queryPoint: (x, y, o, out) => { out[0] = (x + 0.5 + speedOffsets[o]!.x - nativeWidth / 2) * g; out[1] = -(y + 0.5 + speedOffsets[o]!.y - nativeHeight / 2) * g; } };
  const speed = conformanceSetup(speedInput, readout, 581, 2, signal, { gpu: { signalInput: speedInput, chart: null, placement } });
  const qualityOffsets: { x: number; y: number; weight: number }[] = [];
  for (const [nx, ny] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] as const) for (const [ax, ay] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) qualityOffsets.push({ x: nx - ax, y: ny - ay, weight: 1 / 16 });
  const kernel = (sigma: number): Float64Array => { const w = Float64Array.from({ length: 9 }, (_, t) => Math.exp(-0.5 * (((t % 3) - 1) ** 2 + (Math.floor(t / 3) - 1) ** 2) / (sigma * sigma))); const sum = w.reduce((a, b) => a + b, 0); return w.map((v) => v / sum); };
  const qualityInput: DisplayViewExpectedSignalInput = { nativeWidth, nativeHeight, outputWidth: frameWidth, wavelengthsNm: nodes, electronsPerRadiance: A, offsets: qualityOffsets,
    kernels: { radius: 1, perNode: [kernel(0.6), kernel(0.7), kernel(0.8)] }, scene: printScene, channelAt: conformanceChannelAt };
  const quality = conformanceSetup(qualityInput, readout, 582, 5, signal, { gpu: { signalInput: qualityInput, chart: null, placement } });
  // #597: the same Quality case under mixed light: a gradient of three sources with a hard edge (equal stops) across the print, and a
  // point source over its upper left, the reference's irradiance from the same parts in float64.
  const day = { kind: "planckian" as const, temperatureKelvin: 6500 }, lamp = { kind: "cie-a" as const };
  const light = resolveMixedIllumination({ sources: [{ illuminant: day, illuminanceLux: 1.2e5 }, { illuminant: lamp, illuminanceLux: 8e4 }, { illuminant: day, illuminanceLux: 3e4 }],
    blend: { kind: "linear-gradient", from: { u: -0.9, v: 0.1 }, to: { u: 0.8, v: -0.2 }, stops: [0, 0.45, 0.45] },
    points: [{ illuminant: lamp, position: { xM: -0.3, yM: 0.2, heightM: 0.35 }, intensity: { illuminanceLux: 6e4, distanceM: 0.35 } }] }, resolveCaptureIlluminant);
  // The print's half width is 1 m here (print-local units are metres), so the point sources read the print-local point.
  const litIrradiance = (cu: number, cv: number, nm: number): number => light.irradianceAt(cu, cv, cu, cv, nm);
  const litRadianceAt = (u: number, v: number, nm: number): number => {
    const cu = u * k, cv = v * k;
    return (Math.abs(cu) <= 1 && Math.abs(cv) <= aspect ? scene.reflectanceAt(cu, cv, nm) : surround) * litIrradiance(cu, cv, nm) / Math.PI;
  };
  const litInput: DisplayViewExpectedSignalInput = { ...qualityInput, scene: scene.signalScene(nodes, A, white, litRadianceAt, k, 1, surround, light) };
  const lit = conformanceSetup(litInput, readout, 597, 5, signal, { gpu: { signalInput: litInput, chart: null, placement } });
  const [speedReference, qualityReference, litReference] = [await renderDisplayView(speed), await renderDisplayView(quality), await renderDisplayView(lit)];
  const images = createDisplayViewImageModules(runtime, (s) => probeChartCompositeDevice(runtime, (label, code) => createComputePipeline(runtime, label, code, s), s));
  try {
    return await withConformanceAbort(runtime, signal, async (abort, pipelines) => {
      let path: "dekker" | "fma";
      try { path = (await probeChartCompositeDevice(runtime, pipelines, abort.signal)).productPath ?? "dekker"; } catch (error) {
        if (error instanceof ChartCompositeProbeError) return true;
        throw error;
      }
      const verdict = conformanceVerdict(speedReference, await renderDisplayViewSpeedOnGpu(runtime, 1 << 20, { setup: speed, signalInput: speedInput, material: images.build(speed.gpu!, path) }, abort, undefined, pipelines));
      if (verdict !== true) return "Speed: " + verdict;
      const gpu = await renderDisplayViewQualityOnGpu(runtime, 1 << 20, { setup: quality, signalInput: qualityInput, material: { id: "image-plane", wgsl: "", bindings: [] },
        image: imagePlaneQualityPasses(runtime, quality.gpu!, path) }, abort, undefined, pipelines);
      const qualityVerdict = conformanceVerdict(qualityReference, gpu);
      if (qualityVerdict !== true) return "Quality: " + qualityVerdict;
      const litGpu = await renderDisplayViewQualityOnGpu(runtime, 1 << 20, { setup: lit, signalInput: litInput, material: { id: "image-plane", wgsl: "", bindings: [] },
        image: imagePlaneQualityPasses(runtime, lit.gpu!, path) }, abort, undefined, pipelines);
      const litVerdict = conformanceVerdict(litReference, litGpu);
      return litVerdict === true ? true : "Quality under mixed light: " + litVerdict;
    });
  } finally { images.release(); }
}
