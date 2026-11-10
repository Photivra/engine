// SPDX-License-Identifier: Apache-2.0

/**
 * The composite-chart and mask-layer material module of the GPU display view (#491): the Speed kernel's `material_at`
 * (the seam of #478, `DisplayViewGpuMaterialModule`) built from the composite chart kernel's classification (#477,
 * `wgsl-chart-composite-kernel.ts`: `material()`, its bound arithmetic and double-float32), so that composite charts,
 * every 2.3 element as a plain chart, the sine-profile Siemens star and declared `material-layers` scenes render on the
 * GPU. The scene's packed records (`packChartScene`) are uploaded once per renderer and reused across a view's parts,
 * as the composite kernel reuses them per accelerator; the device probe of the composite kernel gates the module.
 *
 * **The query point.** The Speed kernel hands the module p = fl(fl(x + c)·scale) per axis: the site coordinate x plus the
 * offset constant c = 0.5 + o − W/2 (`DISPLAY_VIEW_AUX.offsets`), times the frame-units-per-site scale rounded once to
 * float32, so p carries up to 2E relative error (E = 2⁻²³) against the reference's float64 query point. The composite
 * kernel's chirp decisions (the zone plate's phase, the stars' sector cross products) need the point to about 2⁻⁴⁰; fed
 * p directly they would flag most of a 64-cycle sine star. The module therefore **recovers the exact lattice point**: it
 * knows the offsets c_o (uploaded as float32 hi + lo pairs) and the scale (hi + lo), divides p by the scale's high part
 * (within 6E·|s| of s = x + c_o), picks the offset whose c_o puts the quotient nearest an integer x, and re-forms the point
 * in double-float32 as (x + c_o)·scale from the exact integer and the float64 constants. The host admits a lattice only
 * when the recovery is unambiguous: the distinct fractional parts of the offsets (mod 1) lie more than four tolerances
 * apart, the tolerance being 8E·max|s| + 2⁻¹²; a point whose residual exceeds the tolerance on the device is flagged.
 * The recovered point differs from the exact (x + c_o)·g by at most about 2⁻⁴⁶ relative (two double-float32 operations
 * and the split constants' 2⁻⁴⁸), inside the composite kernel's own allowance for a point (DW = 2⁻⁴⁰ relative in `bd`).
 * The reference's own float64 query point differs from the exact lattice value by its float64 rounding only: measured at
 * most 5.6·10⁻¹⁶ absolute over every site and offset of the #491 fixtures, and checked by the host at the frame's four
 * corners within 2⁻⁴⁸·(|p| + 1); that is inside the composite kernel's 10⁻¹⁴ slack for the reference's rounding. So the
 * composite kernel's bounds and SAFETY factor (4) apply unchanged, and the module's point error is far inside the Speed
 * kernel's contract (≤ 2E + 10⁻¹⁴): no Speed bound term changes.
 *
 * **A fixed-size chart** (`chartSize`): the reference maps the frame point to chart-local units, cu = (u·m)/h with m the
 * metres per frame unit and h the chart's half width, and returns the surround material outside |cu| ≤ 1, |cv| ≤ aspect.
 * The module multiplies the recovered point by k = m/h (hi + lo) in double-float32 and tests the chart rectangle in bound
 * arithmetic (flagging points within their bound of its edge); the surround is the materials table's last entry.
 */
import { ImageKernelExecutionError, WEBGPU_F32_UNIT_ROUNDOFF } from "./image-kernel-execution.js";
import { chartCompositeWgsl, type ChartCompositeProductPath } from "./wgsl-chart-composite-kernel.js";
import { chartGpuPresetCode } from "./chart-radiance-gpu.js";
import { dwSplit, packChartScene, probeChartCompositeDevice, type PackedChartScene } from "./chart-composite-gpu.js";
import type { ChartCompositeProbeRecord } from "./image-kernel-execution.js";
import { chartPresetMaterialModule } from "./display-view-chart-material-module.js";
import type { ChartRadianceBatchPlan } from "../facade/chart-radiance-batch.js";
import type { ResolvedChartScene } from "../facade/chart-scenes.js";
import type { ResolvedChartMaterialLayers } from "../facade/chart-material-layers.js";
import type { DisplayViewExpectedSignalInput } from "../facade/expected-signal.js";
import type { DisplayViewGpuSetup } from "../facade/display-view.js";
import { BUFFER_USAGE, GpuResourceScope, type WebGpuRuntime } from "./webgpu-runtime.js";
import { DISPLAY_VIEW_GPU_MAXIMUM_OFFSETS } from "./wgsl-display-view-speed-kernel.js";
import type { DisplayViewGpuMaterialModule } from "./display-view-speed-gpu.js";
import { imagePlaneSupport } from "../facade/image-plane-support.js";
import type { DisplayViewImageModules } from "./display-view-image-material-module.js";
import type { DisplayViewQualityImagePasses } from "./display-view-quality-gpu.js";

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;

/** One WGSL rounding of + − × in either direction (E = 2⁻²³). */
const E = 2 * WEBGPU_F32_UNIT_ROUNDOFF;
/** The module's id in the pipeline cache (one shader per product path for every composite scene; the scene is data): the Dekker path's. */
export const CHART_COMPOSITE_MATERIAL_MODULE_ID = "chart-composite";
/** The module's id per product path (the fma path's shader is a different pipeline). */
export function chartCompositeMaterialModuleId(path: ChartCompositeProductPath): string { return path === "dekker" ? CHART_COMPOSITE_MATERIAL_MODULE_ID : CHART_COMPOSITE_MATERIAL_MODULE_ID + "-fma"; }
/** Scenes whose records stay uploaded per renderer (the composite kernel keeps the same number per accelerator). */
const KEPT_SCENES = 4;
/** The corner check of the query-point model against the reference's own query points, relative to |p| + 1 (inside the composite kernel's 10⁻¹⁴ slack). */
const MODEL_TOLERANCE = 2 ** -48;

/** Layout of the lattice uniform (float32 / u32 words, 48 bytes) and the offsets table (one vec4 per offset: cu hi, cu lo, cv hi, cv lo). */
export const DISPLAY_VIEW_LATTICE = /* @__PURE__ */ Object.freeze({ scaleUHi: 0, scaleULo: 1, scaleVHi: 2, scaleVLo: 3, chartKHi: 4, chartKLo: 5, chartAspect: 6, tolerance: 7, offsets: 8, placed: 9, surround: 10, zero: 11, words: 12 });

/**
 * The composite kernel's classification (`material(p: vec4<f32>)` with its bound arithmetic, double-float32, cos polynomial,
 * elements and layers) renamed for the display-view kernel, its records bound at @group(1), and the lattice recovery that
 * defines `material_at(p: vec2<f32>)` (see the module comment). The constants E and SLACK come from the kernel's preamble. `path`
 * is the double-word product path the device's probe chose (default Dekker's).
 */
/** The composite kernel's text renamed for a display-view module: its flag is `material_uncertain`, its barrier word `lattice.zero`. */
function renameForDisplayView(code: string): string {
  return code.replace(/^const SLACK: f32 = [^\n]*\n/mu, "").replace(/\bflagged\b/gu, "material_uncertain").replace(/\bmargin\(/gu, "bmargin(").replace(/\bparams\.zero\b/gu, "lattice.zero");
}
/**
 * #581: the composite kernel's common part (double-float32 with its rounding barrier, the bound arithmetic, `bfloor`) renamed for a
 * display-view module (shared by the composite and the image-plane modules); the kernel's preamble gives E and SLACK.
 */
export function displayViewModuleCommonWgsl(path: ChartCompositeProductPath): string {
  const source = chartCompositeWgsl(path);
  const commonStart = source.indexOf("const DW: f32"), commonEnd = source.indexOf("struct Params");
  if (commonStart < 0 || commonEnd < commonStart) throw new ImageKernelExecutionError("gpu-validation", "The composite chart kernel's material functions were not found.");
  return renameForDisplayView(source.slice(commonStart, commonEnd));
}
/** The lattice uniform and the offsets table of a display-view module (@group(1) bindings 2 and 3; `DISPLAY_VIEW_LATTICE`). */
export const LATTICE_BINDINGS_WGSL = `struct LatticeParams {
  scale_u_hi: f32, scale_u_lo: f32, scale_v_hi: f32, scale_v_lo: f32,
  chart_k_hi: f32, chart_k_lo: f32, chart_aspect: f32, tolerance: f32,
  offsets: u32, placed: u32, surround: u32, zero: u32,
};
@group(1) @binding(2) var<uniform> lattice: LatticeParams;
@group(1) @binding(3) var<storage, read> lattice_offsets: array<vec4<f32>>;`;
/** The exact lattice point recovery (see the module comment), shared by the composite and the image-plane modules. */
export const LATTICE_POINT_WGSL = `// The exact lattice point of one axis from the kernel's p = fl(fl(x + c)·scale): the offset whose constant c puts p/scale
// nearest an integer x, then (x + c)·scale in double-float32 from the exact integer and the float64 constants (hi + lo).
fn lattice_point(p: f32, scale: D, axis: u32) -> D {
  let rough = p / scale.h;
  var best = 3.0e38; var site = 0.0; var c_hi = 0.0; var c_lo = 0.0;
  for (var o = 0u; o < lattice.offsets; o = o + 1u) {
    let row = lattice_offsets[o];
    let hi = select(row.z, row.x, axis == 0u);
    let lo = select(row.w, row.y, axis == 0u);
    let d = rough - hi;
    let n = round(d);
    let r = abs(d - n);
    if (r < best) { best = r; site = n; c_hi = hi; c_lo = lo; }
  }
  if (!(best <= lattice.tolerance)) { material_uncertain = true; }
  return d_mul(d_add(D(site, 0.0), D(c_hi, c_lo)), scale);
}`;
export function chartCompositeMaterialWgsl(path: ChartCompositeProductPath = "dekker"): string {
  const source = chartCompositeWgsl(path), bodyStart = source.indexOf("const SEGMENT_BOX"), bodyEnd = source.indexOf("@compute");
  if (bodyStart < 0 || bodyEnd < bodyStart) throw new ImageKernelExecutionError("gpu-validation", "The composite chart kernel's material functions were not found.");
  return `${displayViewModuleCommonWgsl(path)}
@group(1) @binding(0) var<storage, read> af: array<f32>;
@group(1) @binding(1) var<storage, read> ai: array<u32>;
${LATTICE_BINDINGS_WGSL}
${renameForDisplayView(source.slice(bodyStart, bodyEnd))}
${LATTICE_POINT_WGSL}
fn material_at(p: vec2<f32>) -> u32 {
  var u = lattice_point(p.x, D(lattice.scale_u_hi, lattice.scale_u_lo), 0u);
  var v = lattice_point(p.y, D(lattice.scale_v_hi, lattice.scale_v_lo), 1u);
  if (lattice.placed != 0u) {
    let k = D(lattice.chart_k_hi, lattice.chart_k_lo);
    u = d_mul(u, k); v = d_mul(v, k);
    if (!(le(babs(bd(u)), bx(1.0)) && le(babs(bd(v)), bc(lattice.chart_aspect)))) { return lattice.surround; }
  }
  return material(vec4<f32>(u.h, u.l, v.h, v.l));
}
`;
}

/** A fixed-size chart's placement for the module: chart-local frame units per frame unit (m/h) and the chart's aspect. */
export interface DisplayViewChartPlacement { chartUnitsPerFrameUnit: number; aspect: number }

/** The lattice constants of a render (see the module comment): the uniform words and the offsets table. */
export interface DisplayViewLatticeConstants { params: ArrayBuffer; offsets: Float32Array<ArrayBuffer>; tolerance: number; scaleU: number; scaleV: number }

/**
 * The query lattice of an expected-signal input as the module needs it, or an `unsupported-on-backend` error: the scale per
 * axis from the reference's own query points (two sites a frame apart), the model (x + c)·scale checked against the reference
 * at the frame's four corners for every offset within 2⁻⁴⁸·(|p| + 1), the offsets as hi + lo pairs, and the recovery tolerance
 * 8E·max|x + c| + 2⁻¹², which the distinct fractional parts of the offsets must clear four times over.
 */
export function displayViewLatticeConstants(signalInput: DisplayViewExpectedSignalInput, placement: DisplayViewChartPlacement | null, surroundMaterial: number): DisplayViewLatticeConstants {
  const W = signalInput.nativeWidth, H = signalInput.nativeHeight, offsets = signalInput.offsets, query = signalInput.queryPoint;
  if (!query) throw new ImageKernelExecutionError("unsupported-on-backend", "The expected signal has no query points (the Quality path); use cpu-reference.");
  if (offsets.length < 1 || offsets.length > DISPLAY_VIEW_GPU_MAXIMUM_OFFSETS) throw new ImageKernelExecutionError("unsupported-on-backend", "The kernel holds 1 to " + DISPLAY_VIEW_GPU_MAXIMUM_OFFSETS + " query offsets.");
  if (!(W >= 2 && H >= 2 && W <= 2 ** 20 && H <= 2 ** 20)) throw new ImageKernelExecutionError("unsupported-on-backend", "The native frame is outside the lattice recovery's range (2 to 2^20 sites per axis).");
  const point = new Float64Array(2), x1 = W - 1, y1 = H - 1;
  query(0, 0, 0, point); const u0 = point[0]!, v0 = point[1]!;
  query(x1, 0, 0, point); const u1 = point[0]!;
  query(0, y1, 0, point); const v1 = point[1]!;
  const scaleU = (u1 - u0) / x1, scaleV = (v1 - v0) / y1;
  if (!(Number.isFinite(scaleU) && Number.isFinite(scaleV) && scaleU !== 0 && scaleV !== 0)) throw new ImageKernelExecutionError("unsupported-on-backend", "The request's query lattice has no scale; use cpu-reference.");
  const cu = new Float64Array(offsets.length), cv = new Float64Array(offsets.length);
  let smax = 0;
  for (let o = 0; o < offsets.length; o++) {
    const offset = offsets[o]!;
    cu[o] = 0.5 + offset.x - W / 2; cv[o] = 0.5 + offset.y - H / 2;
    smax = Math.max(smax, Math.abs(cu[o]!), Math.abs(x1 + cu[o]!), Math.abs(cv[o]!), Math.abs(y1 + cv[o]!));
    for (const [x, y] of [[0, 0], [x1, 0], [0, y1], [x1, y1]] as const) {
      query(x, y, o, point);
      const mu = (x + cu[o]!) * scaleU, mv = (y + cv[o]!) * scaleV;
      if (!(Math.abs(mu - point[0]!) <= MODEL_TOLERANCE * (Math.abs(point[0]!) + 1) && Math.abs(mv - point[1]!) <= MODEL_TOLERANCE * (Math.abs(point[1]!) + 1)))
        throw new ImageKernelExecutionError("unsupported-on-backend", "The request's query points are not a rectilinear site lattice within 2^-48; use cpu-reference.");
    }
  }
  const tolerance = Math.fround(8 * E * smax + 2 ** -12);
  if (!(tolerance < 1 / 8)) throw new ImageKernelExecutionError("unsupported-on-backend", "The query lattice is too wide for the exact point recovery; use cpu-reference.");
  // Distinct fractional parts of the offsets must be told apart on the device: more than four tolerances apart, or an exact integer apart (the same lattice).
  for (const axis of [cu, cv]) {
    for (let a = 0; a < axis.length; a++) for (let b = a + 1; b < axis.length; b++) {
      const delta = axis[a]! - axis[b]!, fractional = Math.abs(delta - Math.round(delta));
      if (fractional !== 0 && !(fractional > 4 * tolerance))
        throw new ImageKernelExecutionError("unsupported-on-backend", "Two query offsets are too close (mod one site) for the exact point recovery; use cpu-reference.");
    }
  }
  const params = new ArrayBuffer(4 * DISPLAY_VIEW_LATTICE.words), floats = new Float32Array(params), words = new Uint32Array(params);
  const [suH, suL] = dwSplit(scaleU), [svH, svL] = dwSplit(scaleV);
  floats[DISPLAY_VIEW_LATTICE.scaleUHi] = suH; floats[DISPLAY_VIEW_LATTICE.scaleULo] = suL; floats[DISPLAY_VIEW_LATTICE.scaleVHi] = svH; floats[DISPLAY_VIEW_LATTICE.scaleVLo] = svL;
  if (placement) {
    const [kH, kL] = dwSplit(placement.chartUnitsPerFrameUnit);
    if (!(Number.isFinite(kH) && kH > 0 && Number.isFinite(placement.aspect) && placement.aspect > 0)) throw new ImageKernelExecutionError("unsupported-on-backend", "The chart placement is not finite.");
    floats[DISPLAY_VIEW_LATTICE.chartKHi] = kH; floats[DISPLAY_VIEW_LATTICE.chartKLo] = kL; floats[DISPLAY_VIEW_LATTICE.chartAspect] = placement.aspect;
  }
  floats[DISPLAY_VIEW_LATTICE.tolerance] = tolerance;
  words[DISPLAY_VIEW_LATTICE.offsets] = offsets.length; words[DISPLAY_VIEW_LATTICE.placed] = placement ? 1 : 0; words[DISPLAY_VIEW_LATTICE.surround] = surroundMaterial;
  words[DISPLAY_VIEW_LATTICE.zero] = 0; // the rounding barrier's zero (`lattice.zero`)
  const table = new Float32Array(4 * offsets.length);
  for (let o = 0; o < offsets.length; o++) {
    const [uH, uL] = dwSplit(cu[o]!), [vH, vL] = dwSplit(cv[o]!);
    table[4 * o] = uH; table[4 * o + 1] = uL; table[4 * o + 2] = vH; table[4 * o + 3] = vL;
  }
  return { params, offsets: table, tolerance, scaleU, scaleV };
}

/** The resolved scene behind a GPU setup: the chart whose geometry is packed, the layers (or null) and the materials the kernel indexes. */
function sceneOf(gpu: DisplayViewGpuSetup): { chart: ResolvedChartScene; layers: ResolvedChartMaterialLayers | null; materials: ResolvedChartScene["materials"]; key: object } {
  if (gpu.layers) return { chart: gpu.layers.chart, layers: gpu.layers, materials: gpu.layers.materials, key: gpu.layers };
  if (gpu.chart) return { chart: gpu.chart, layers: null, materials: gpu.chart.materials, key: gpu.chart };
  throw new ImageKernelExecutionError("unsupported-on-backend", "The GPU material lookup covers chart presets, composite charts and declared material-layers scenes; a caller scene function runs on cpu-reference (describe it as material-layers).");
}

interface UploadedRecords { key: object; scope: GpuResourceScope; af: GPUBuffer; ai: GPUBuffer; packed: PackedChartScene }

/**
 * The material modules of one display-view renderer (one device): the chart-preset module for the eight 2.0 presets filling
 * the frame, the composite module for everything else the chart kernels classify. The composite module's device probe runs
 * once per renderer (single flight; a refusal is retried on the next render), its scene records are uploaded once per scene
 * and the four most recent kept until `release()`.
 */
export interface DisplayViewMaterialModules {
  /** The module of a setup's scene, or an `unsupported-on-backend` error (a caller function scene, a failed probe, a materials mismatch). */
  moduleFor(gpu: DisplayViewGpuSetup, signal: AbortSignal): Promise<DisplayViewGpuMaterialModule>;
  /** #581: an image-plane print's Quality passes (after `prepareImagePlaneScenes()`), or an `unsupported-on-backend` error. */
  imagePasses(gpu: DisplayViewGpuSetup, signal: AbortSignal): Promise<DisplayViewQualityImagePasses>;
  /** Uploaded scenes (for tests). */
  readonly uploadedScenes: number;
  release(): void;
}

export function createDisplayViewMaterialModules(runtime: WebGpuRuntime, pipelines: PipelineSource): DisplayViewMaterialModules {
  const presets = new WeakMap<ResolvedChartScene, DisplayViewGpuMaterialModule>(), uploads: UploadedRecords[] = [];
  // #581: image-plane prints (their double-float32 arithmetic is the composite kernel's, so the same probe gates them), through the
  // module prepareImagePlaneScenes() loaded; created on the first photo.
  let images: DisplayViewImageModules | undefined;
  // A photo reaches the GPU only after the request was resolved, so the module is enabled.
  const imageModules = async (): Promise<DisplayViewImageModules> => images ??= (await imagePlaneSupport()!.loadGpuModule()).createDisplayViewImageModules(runtime, probe) as DisplayViewImageModules;
  let probed: Promise<ChartCompositeProbeRecord> | null = null;
  const wgsl = new Map<ChartCompositeProductPath, string>();
  const probe = (signal: AbortSignal): Promise<ChartCompositeProbeRecord> => {
    probed ??= probeChartCompositeDevice(runtime, pipelines, signal).catch((error: unknown) => { probed = null; throw error; });
    return probed;
  };
  const records = (scene: ReturnType<typeof sceneOf>): UploadedRecords => {
    const index = uploads.findIndex((e) => e.key === scene.key);
    if (index >= 0) { const [entry] = uploads.splice(index, 1); uploads.push(entry!); return entry!; }
    // packChartScene reads the plan's chart, layers and materials only.
    const packed = packChartScene({ chart: scene.chart, layers: scene.layers, materials: scene.materials } as unknown as ChartRadianceBatchPlan);
    if (Math.max(packed.af.byteLength, packed.ai.byteLength) > runtime.maximumStorageBindingBytes) throw new ImageKernelExecutionError("insufficient-limits", "Chart records exceed the device's storage binding limit.");
    const scope = new GpuResourceScope(runtime);
    const entry: UploadedRecords = { key: scene.key, scope, af: scope.upload("photivra-display-view-chart-floats", packed.af, BUFFER_USAGE.STORAGE), ai: scope.upload("photivra-display-view-chart-records", packed.ai, BUFFER_USAGE.STORAGE), packed };
    uploads.push(entry);
    while (uploads.length > KEPT_SCENES) uploads.shift()!.scope.release();
    return entry;
  };
  return {
    async moduleFor(gpu, signal): Promise<DisplayViewGpuMaterialModule> {
      if ((gpu.signalInput.scene as { image?: unknown }).image) return await (await imageModules()).moduleFor(gpu, signal);
      const scene = sceneOf(gpu), placement = gpu.placement ?? null, signalInput = gpu.signalInput;
      const tableMaterials = signalInput.scene.kind === "materials" ? signalInput.scene.materials.length : -1;
      if (tableMaterials !== scene.materials.length + (placement ? 1 : 0))
        throw new ImageKernelExecutionError("unsupported-on-backend", "The expected signal's materials do not match the scene's (" + tableMaterials + " against " + scene.materials.length + (placement ? " plus the surround" : "") + "); use cpu-reference.");
      if (!scene.layers && !placement && chartGpuPresetCode({ chart: scene.chart } as unknown as ChartRadianceBatchPlan) !== undefined) {
        let module = presets.get(scene.chart);
        if (!module) { module = chartPresetMaterialModule(scene.chart); presets.set(scene.chart, module); }
        return module;
      }
      const record = await probe(signal), path = record.productPath ?? "dekker";
      const lattice = displayViewLatticeConstants(signalInput, placement, scene.materials.length), uploaded = records(scene);
      let code = wgsl.get(path);
      if (code === undefined) { code = chartCompositeMaterialWgsl(path); wgsl.set(path, code); }
      return { id: chartCompositeMaterialModuleId(path), wgsl: code, compositeProbe: record, bindings: [
        { binding: 0, kind: "storage", buffer: uploaded.af }, { binding: 1, kind: "storage", buffer: uploaded.ai },
        { binding: 2, kind: "uniform", data: new Uint8Array(lattice.params) }, { binding: 3, kind: "storage", data: lattice.offsets }] };
    },
    async imagePasses(gpu, signal): Promise<DisplayViewQualityImagePasses> { return await (await imageModules()).qualityPasses(gpu, signal); },
    get uploadedScenes(): number { return uploads.length; },
    release(): void { for (const entry of uploads.splice(0)) entry.scope.release(); images?.release(); }
  };
}
