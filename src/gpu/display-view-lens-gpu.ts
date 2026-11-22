// SPDX-License-Identifier: Apache-2.0

/**
 * Host side of the display view's catalogue-lens path on the GPU (#655, chunk G1): passes 1 and 2 of the Quality path for a still
 * camera behind a catalogue lens (`wgsl-display-view-lens-kernel.ts`), handed to the Quality host (`display-view-quality-gpu.ts`,
 * its `lens` input), which runs pass 3, the float64 finishing and the recomputation of flagged display pixels with the view's own
 * lens signal. #661: its own on-demand chunk, which the Quality host loads at the first catalogue-lens render and hands what it takes
 * (`bindDisplayViewLensHost`); it imports no module statically.
 *
 * The float64 reference is the CPU lens signal (`facade/display-view-lens-signal.ts`, `psfSite`) through `renderDisplayView`.
 * What it covers: a still camera (one instant, no rotation, no hand shake), the rectilinear projection, a radial distortion
 * polynomial (or none), a radial vignetting polynomial (or none), a catalogue lens's field-dependent PSF in zones (the fast method;
 * `fast: false` resolves the PSF at every site and stays on the CPU), no veiling glare, and a chart or `material-layers` scene
 * classified by the composite chart kernel (#477, behind its device probe). Every other lens request runs the CPU reference,
 * labelled `unsupported-on-backend` with the reason.
 *
 * Per band:
 *
 * 1. The lens lattice pass maps every lattice point through the lens in double-float32 and classifies it; the host reads the
 *    lattice back and resolves each flagged point (a point within its bound of a material boundary, or whose mapping bound exceeds
 *    the composite kernel's allowance) with the reference's own float64 lookup at the reference's own lattice point, so every
 *    material the sites read is the reference's.
 * 2. The pre-integration pass forms B and F̄ per point of the band's window.
 * 3. The zones the band's sites read are uploaded (their PSF per node and its moments: optics, no channel response), and the site
 *    pass forms each site's electrons, split over dispatches of at most the Quality host's tap budget.
 *
 * Before its first use on a lens request the host checks its model of the mapping against the reference's own geometry at the
 * frame's corners, edges and centre (within 2⁻⁴⁴ of the plane point and 10⁻¹² of the field factor, relative); a lens whose
 * geometry is not that model is refused by name.
 */

import type { DisplayViewRenderResult, DisplayViewSetup } from "../facade/display-view.js";
import type { DisplayViewGpuConformanceCase, DisplayViewGpuRuntimeHandle, DisplayViewLensGpuInput } from "../facade/display-view-gpu.js";
import type { DisplayViewExpectedSignal, DisplayViewExpectedSignalInput } from "../facade/expected-signal.js";
import type { DisplayViewLensPsf, DisplayViewLensSetup, DisplayViewLensZoneKernels } from "../facade/display-view-lens-signal.js";
import type { ResolvedChartScene } from "../facade/chart-scenes.js";
import type { ResolvedChartMaterialLayers } from "../facade/chart-material-layers.js";
import type { ChartRadianceBatchPlan } from "../facade/chart-radiance-batch.js";
import type { PackedChartScene } from "./chart-composite-gpu.js";
import type { DisplayViewQualityLensPasses } from "./display-view-quality-gpu.js";
import type { ChartCompositeProbeRecord } from "./image-kernel-execution.js";
import type { WebGpuRuntime } from "./webgpu-runtime.js";
import { DISPLAY_VIEW_LENS_NEWTON_STEPS, DISPLAY_VIEW_LENS_PARAMS, DISPLAY_VIEW_LENS_PARAM_WORDS, DISPLAY_VIEW_LENS_POINT_LIMIT, DISPLAY_VIEW_LENS_POINT_PARAM_WORDS,
  DISPLAY_VIEW_LENS_POINT_WORDS, DISPLAY_VIEW_LENS_SITE_PARAM_WORDS, displayViewLensLatticeWgsl, displayViewLensPointsWgsl, displayViewLensSitesWgsl, type DisplayViewLensWgslHost } from "./wgsl-display-view-lens-kernel.js";

/**
 * #661: what this chunk takes from the session's and the Quality host's modules, in this order. The Quality host hands them over
 * once (`bindDisplayViewLensHost`) after it has loaded this module, so this module imports none of them statically and the lens
 * chunk shares no module with the session chunk or the Quality chunk (a shared module makes the bundler split those chunks).
 */
export type DisplayViewLensHost = readonly [
  renderQuality: typeof import("./display-view-quality-gpu.js").renderDisplayViewQualityOnGpu,
  wgslHost: DisplayViewLensWgslHost,
  DISPLAY_VIEW_LATTICE: typeof import("./display-view-composite-material-module.js").DISPLAY_VIEW_LATTICE,
  dwSplit: typeof import("./chart-composite-gpu.js").dwSplit,
  packChartScene: typeof import("./chart-composite-gpu.js").packChartScene,
  CONFORMANCE_FRAME: typeof import("./display-view-speed-gpu.js").CONFORMANCE_FRAME,
  conformanceChannelAt: typeof import("./display-view-speed-gpu.js").conformanceChannelAt,
  conformanceChart: typeof import("./display-view-speed-gpu.js").conformanceChart,
  conformanceResponses: typeof import("./display-view-speed-gpu.js").conformanceResponses,
  conformanceSetup: typeof import("./display-view-speed-gpu.js").conformanceSetup,
  conformanceVerdict: typeof import("./display-view-speed-gpu.js").conformanceVerdict,
  withConformanceAbort: typeof import("./display-view-speed-gpu.js").withConformanceAbort,
  ImageKernelExecutionError: typeof import("./image-kernel-execution.js").ImageKernelExecutionError,
  BUFFER_USAGE: typeof import("./webgpu-runtime.js").BUFFER_USAGE,
  GpuResourceScope: typeof import("./webgpu-runtime.js").GpuResourceScope,
  linearDispatch: typeof import("./webgpu-runtime.js").linearDispatch,
  runComputePass: typeof import("./webgpu-runtime.js").runComputePass,
  throwIfAborted: typeof import("./webgpu-runtime.js").throwIfAborted,
  renderDisplayView: typeof import("../facade/display-view.js").renderDisplayView,
  displayViewSignalTables: typeof import("../facade/expected-signal.js").displayViewSignalTables,
  prepareEnvironmentLensFieldMapping: typeof import("../optics/sensor-environment-query.js").prepareEnvironmentLensFieldMapping,
];
let renderQuality: DisplayViewLensHost[0];
let wgslHost: DisplayViewLensHost[1];
let DISPLAY_VIEW_LATTICE: DisplayViewLensHost[2];
let dwSplit: DisplayViewLensHost[3];
let packChartScene: DisplayViewLensHost[4];
let CONFORMANCE_FRAME: DisplayViewLensHost[5];
let conformanceChannelAt: DisplayViewLensHost[6];
let conformanceChart: DisplayViewLensHost[7];
let conformanceResponses: DisplayViewLensHost[8];
let conformanceSetup: DisplayViewLensHost[9];
let conformanceVerdict: DisplayViewLensHost[10];
let withConformanceAbort: DisplayViewLensHost[11];
let ImageKernelExecutionError: DisplayViewLensHost[12];
let BUFFER_USAGE: DisplayViewLensHost[13];
let GpuResourceScope: DisplayViewLensHost[14];
let linearDispatch: DisplayViewLensHost[15];
let runComputePass: DisplayViewLensHost[16];
let throwIfAborted: DisplayViewLensHost[17];
let renderDisplayView: DisplayViewLensHost[18];
let displayViewSignalTables: DisplayViewLensHost[19];
let prepareEnvironmentLensFieldMapping: DisplayViewLensHost[20];
type GpuResourceScope = InstanceType<DisplayViewLensHost[14]>;
/** #661: this module's two entry points, once the host's values are bound. */
export interface DisplayViewLensGpu { createDisplayViewLensPasses: typeof createDisplayViewLensPasses; displayViewLensConformanceCase: typeof displayViewLensConformanceCase }
/** #661: binds the host's values (see `DisplayViewLensHost`) and returns this module's two entry points. */
export function bindDisplayViewLensHost(host: DisplayViewLensHost): DisplayViewLensGpu {
  [renderQuality, wgslHost, DISPLAY_VIEW_LATTICE, dwSplit, packChartScene, CONFORMANCE_FRAME, conformanceChannelAt, conformanceChart, conformanceResponses, conformanceSetup, conformanceVerdict, withConformanceAbort, ImageKernelExecutionError, BUFFER_USAGE, GpuResourceScope, linearDispatch, runComputePass, throwIfAborted, renderDisplayView, displayViewSignalTables,
    prepareEnvironmentLensFieldMapping] = host;
  return { createDisplayViewLensPasses, displayViewLensConformanceCase };
}

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;

/**
 * One WGSL rounding of + − × (E = 2⁻²³): `2 * WEBGPU_F32_UNIT_ROUNDOFF` of image-kernel-execution.ts, written out so this chunk imports
 * nothing of the session's (#661; test/display-view-lens-gpu.test.ts checks that the two are equal).
 */
export const DISPLAY_VIEW_LENS_ROUNDING = 2 ** -23;
const E = DISPLAY_VIEW_LENS_ROUNDING;
const FLOAT32_SAFE_MAGNITUDE = 2 ** 120, FLOAT32_MINIMUM_NORMAL = 2 ** -126;
/** The model check's tolerances against the reference's geometry: the plane point (relative to |p| + 1) and the field factor (relative). */
const MODEL_POINT_TOLERANCE = 2 ** -44, MODEL_FACTOR_TOLERANCE = 1e-12;
/** Largest PSF radius the lens site pass takes (the Quality kernels' cap). */
const MAXIMUM_RADIUS = 96;

/** The lens model the kernels evaluate, from the request's raw geometry (float64; see the module comment). */
interface LensModel {
  radial: boolean; k1: number; k2: number; k3: number; invRn2: number; tMax: number;
  vignetting: boolean; invRv2: number; v2: number; v4: number; v6: number;
  /** Plane units per ideal image millimetre: D/(p_d·m). */
  kappa: number;
}

/** Why the lens passes do not cover a lens request, or null (the facts a render can check; see the module comment). */
export function displayViewLensGpuUnsupportedReason(setup: DisplayViewSetup, input: DisplayViewLensGpuInput): string | null {
  const { lens, geometry } = input, signalInput = setup.gpu?.signalInput, psf = lens.psf;
  if (!signalInput) return "the setup carries no GPU inputs";
  if (!psf || !signalInput.kernels) return "a lens without a catalogue lens's PSF (lens.projection, lens.distortion, lens.vignetting alone) runs on the CPU";
  if (psf.zoneSites === 1 && Math.max(signalInput.nativeWidth, signalInput.nativeHeight) > 64) return "the PSF at every site (lens.catalogue with fast: false) runs on the CPU; the GPU takes the field zones";
  if (psf.radius !== signalInput.kernels.radius || psf.radius < 0 || psf.radius > MAXIMUM_RADIUS) return "a PSF radius above " + MAXIMUM_RADIUS + " sites, or one that differs from the view's kernels";
  if (lens.times.length !== 1 || lens.timesAt || geometry.handShake !== undefined || geometry.angularVelocityRadPerSec.pitch !== 0 || geometry.angularVelocityRadPerSec.yaw !== 0 ||
    geometry.angularVelocityRadPerSec.roll !== 0) return "camera rotation, hand shake or motion (more than one instant) runs on the CPU";
  if (lens.veil) return "lens.catalogue.flare (the veiling glare) runs on the CPU";
  if (lens.zeroBeyondHorizon) return "a fisheye catalogue lens runs on the CPU";
  const mapping = geometry.lensMapping;
  if (mapping && ((mapping.mapping.projectionModel ?? "rectilinear") !== "rectilinear" || mapping.brownConrady !== undefined || mapping.mapping.outsideImageCircle === "backward-ray"))
    return "a projection other than rectilinear, or a Brown–Conrady distortion, runs on the CPU";
  if (signalInput.largeKernel) return "a defocus kernel convolved by runs runs on the CPU";
  if (signalInput.scene.kind !== "materials" || (signalInput.scene as { image?: unknown }).image) return "the lens passes classify chart and material-layers scenes";
  if (!setup.gpu!.chart && !setup.gpu!.layers) return "the lens passes classify engine charts and declared material-layers scenes";
  const at = signalInput.channelAt;
  if (at(0, 0) !== 0 || at(1, 0) !== 1 || at(0, 1) !== 1 || at(1, 1) !== 2) return "the site pass reads the RGGB mosaic";
  return null;
}

/** The kernels' lens model from the raw geometry and the lens setup (κ from the reference's own geometry; see `modelCheck`). */
function lensModel(input: DisplayViewLensGpuInput): LensModel {
  const { lens, geometry } = input, radial = geometry.lensMapping?.radial, vignetting = geometry.vignetting;
  const model: LensModel = { radial: radial !== undefined, k1: radial?.coefficients.k1 ?? 0, k2: radial?.coefficients.k2 ?? 0, k3: radial?.coefficients.k3 ?? 0,
    invRn2: radial ? 1 / (radial.normalizationRadiusMm * radial.normalizationRadiusMm) : 0, tMax: radial ? radial.maximumNormalizedRadius * radial.maximumNormalizedRadius : 0,
    vignetting: vignetting !== undefined, invRv2: vignetting ? 1 / (vignetting.normalizationRadiusMm * vignetting.normalizationRadiusMm) : 0,
    v2: vignetting?.coefficients.r2 ?? 0, v4: vignetting?.coefficients.r4 ?? 0, v6: vignetting?.coefficients.r6 ?? 0, kappa: 0 };
  // The projection distance from the reference's own ray near the axis: look.x/look.z = x_ideal/p_d for the rectilinear projection.
  const x = lens.pitch / 1000, look = lens.geometry.lookOf(x, 0, 0), ideal = modelIdeal(model, x, 0);
  const projectionMm = ideal.x * look.z / look.x;
  model.kappa = lens.distanceM / (projectionMm * lens.metresPerFrameUnit);
  return model;
}

/** s(t) = 1 + k1·t + k2·t² + k3·t³. */
const scaleOf = (m: LensModel, t: number): number => 1 + t * (m.k1 + t * (m.k2 + t * m.k3));
/** The ideal image point (+Y up) of sensor point (x, y) mm (+Y down) and the root t = r², in float64 (the kernels' model). */
function modelIdeal(m: LensModel, xMm: number, yMm: number): { x: number; y: number; t: number; s: number } {
  const ix = xMm, iy = -yMm;
  if (!m.radial) return { x: ix, y: iy, t: 0, s: 1 };
  const d2 = (ix * ix + iy * iy) * m.invRn2;
  if (!(d2 > 0)) return { x: ix, y: iy, t: 0, s: 1 };
  let t = d2 / scaleOf(m, d2) ** 2;
  for (let k = 0; k < 40; k++) {
    const s = scaleOf(m, t), h = t * s * s - d2, slope = s * (s + 2 * t * (m.k1 + t * (2 * m.k2 + 3 * m.k3 * t))), next = t - h / slope;
    if (Math.abs(next - t) <= 1e-17 * t) { t = next; break; }
    t = next;
  }
  const s = scaleOf(m, t);
  return { x: ix / s, y: iy / s, t, s };
}
/** The kernels' model in float64: the plane point and the field factor of sensor point (x, y) mm. */
function modelPoint(m: LensModel, xMm: number, yMm: number): { u: number; v: number; factor: number } {
  const ideal = modelIdeal(m, xMm, yMm), t = ideal.t;
  const area = m.radial ? 1 / (ideal.s * (1 + t * (3 * m.k1 + t * (5 * m.k2 + 7 * m.k3 * t)))) : 1;
  const r2 = (xMm * xMm + yMm * yMm) * m.invRv2, throughput = m.vignetting ? 1 + r2 * (m.v2 + r2 * (m.v4 + r2 * m.v6)) : 1;
  return { u: ideal.x * m.kappa, v: ideal.y * m.kappa, factor: throughput * area };
}
/** The reference's plane point and field factor of sensor point (x, y) mm (the lens signal's `map`, operation for operation). */
function referencePoint(lens: DisplayViewLensSetup, xMm: number, yMm: number): { u: number; v: number; factor: number } {
  const look = lens.geometry.lookOf(xMm, yMm, 0), s = lens.distanceM / look.z;
  return { u: look.x * s / lens.metresPerFrameUnit, v: look.y * s / lens.metresPerFrameUnit, factor: look.factor };
}
/**
 * Checks the model against the reference's geometry at the corners, edge midpoints and centre of the farthest lattice point the
 * view reads, and at two interior points; returns why it disagrees, or null.
 */
function modelCheck(m: LensModel, lens: DisplayViewLensSetup, W: number, H: number, reach: number): string | null {
  const mm = lens.pitch / 1000, xs = [-(W / 2 + reach), -W / 7, 0, W / 3, W / 2 + reach], ys = [-(H / 2 + reach), -H / 5, 0, H / 4, H / 2 + reach];
  for (const sx of xs) for (const sy of ys) {
    const x = sx * mm, y = sy * mm, model = modelPoint(m, x, y);
    let reference: ReturnType<typeof referencePoint>;
    try { reference = referencePoint(lens, x, y); } catch { return "the reference geometry fails at a point the view reads"; }
    if (!(Math.abs(model.u - reference.u) <= MODEL_POINT_TOLERANCE * (Math.abs(reference.u) + 1) && Math.abs(model.v - reference.v) <= MODEL_POINT_TOLERANCE * (Math.abs(reference.v) + 1) &&
      Math.abs(model.factor - reference.factor) <= MODEL_FACTOR_TOLERANCE * reference.factor))
      return "the lens geometry is not the still rectilinear radial model the lens passes evaluate (within 2^-44 at (" + x + ", " + y + ") mm)";
  }
  return null;
}

/** The lens lattice uniform (`LensParams`) for a model. */
function lensParams(m: LensModel, pitch: number, total: number, groups: number): Uint32Array<ArrayBuffer> {
  const words = new Uint32Array(DISPLAY_VIEW_LENS_PARAM_WORDS), floats = new Float32Array(words.buffer), P = DISPLAY_VIEW_LENS_PARAMS;
  const put = (hi: number, value: number): void => { const [h, l] = dwSplit(value); floats[hi] = h; floats[hi + 1] = l; };
  words[P.total] = total; words[P.groups] = groups; words[P.radial] = m.radial ? 1 : 0; words[P.vignetting] = m.vignetting ? 1 : 0;
  put(P.mmHi, pitch / 1000); put(P.invRn2Hi, m.invRn2); put(P.k1Hi, m.k1); put(P.k2Hi, m.k2); put(P.k3Hi, m.k3); put(P.kappaHi, m.kappa);
  floats[P.tMax] = m.tMax; floats[P.invRv2] = m.invRv2; floats[P.v2] = m.v2; floats[P.v4] = m.v4; floats[P.v6] = m.v6; floats[P.pointLimit] = DISPLAY_VIEW_LENS_POINT_LIMIT;
  words[P.steps] = DISPLAY_VIEW_LENS_NEWTON_STEPS;
  return words;
}

/** The scene behind a lens render's GPU setup: the chart the composite kernel classifies, its layers and materials, and its key. */
function sceneOf(setup: DisplayViewSetup): { chart: ResolvedChartScene; layers: ResolvedChartMaterialLayers | null; materials: ResolvedChartScene["materials"]; key: object } {
  const gpu = setup.gpu!;
  if (gpu.layers) return { chart: gpu.layers.chart, layers: gpu.layers, materials: gpu.layers.materials, key: gpu.layers };
  return { chart: gpu.chart!, layers: null, materials: gpu.chart!.materials, key: gpu.chart! };
}
const packedScenes = new WeakMap<object, PackedChartScene>();
/** #661: the composite kernel's device probe of the renderer (`DisplayViewMaterialModules.probe`: once per device, single flight). */
type CompositeProbe = (signal: AbortSignal) => Promise<ChartCompositeProbeRecord>;

/** Float32 copies of non-negative float64 tables, refused outside the float32 domain (a nonzero value below the normal range included). */
function float32Table(values: ArrayLike<number>, what: string): Float32Array<ArrayBuffer> {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!(v >= 0 && v <= FLOAT32_SAFE_MAGNITUDE) || (v > 0 && v < FLOAT32_MINIMUM_NORMAL)) throw new ImageKernelExecutionError("unsupported-float32-domain", what + " are outside the float32 domain.");
    out[i] = v;
  }
  return out;
}

/** What the lens passes of a render report beyond the Quality host's result. */
export interface DisplayViewLensPassesRecord {
  /** The composite kernel's device probe (its product path runs the lens lattice pass). */
  probe: ChartCompositeProbeRecord;
  /** Lattice points the lens lattice pass flagged and the host resolved with the reference's own lookup, over the render. */
  readonly latticePointsResolved: number;
  /** Zones uploaded over the render's bands. */
  readonly zonesUploaded: number;
}

/**
 * The lens passes of one render (see the module comment), or an `unsupported-on-backend` error naming why the request is not
 * covered.
 */
export async function createDisplayViewLensPasses(runtime: WebGpuRuntime, setup: DisplayViewSetup, input: DisplayViewLensGpuInput, pipelines: PipelineSource,
  probeDevice: CompositeProbe, signal: AbortSignal): Promise<DisplayViewQualityLensPasses & DisplayViewLensPassesRecord> {
  const refuse = (reason: string): never => { throw new ImageKernelExecutionError("unsupported-on-backend", "webgpu-f32 display view (catalogue lens): " + reason + "; use cpu-reference."); };
  const reason = displayViewLensGpuUnsupportedReason(setup, input);
  if (reason) refuse(reason);
  const signalInput = setup.gpu!.signalInput as DisplayViewExpectedSignalInput & { scene: Extract<DisplayViewExpectedSignalInput["scene"], { kind: "materials" }> };
  const lens = input.lens, psf = lens.psf!, W = signalInput.nativeWidth, H = signalInput.nativeHeight, R = psf.radius, w = 2 * R + 1, taps = w * w;
  const tables = displayViewSignalTables(signalInput), N = signalInput.wavelengthsNm.length, spectra = tables.spectra;
  if (N < 1 || N > wgslHost[4]) refuse("the site pass integrates 1 to " + wgslHost[4] + " spectral nodes");
  // The model and its check against the reference's geometry, over the farthest lattice point the view reads.
  let reachOffsets = 0;
  for (const g of tables.groups) for (const member of g.members) reachOffsets = Math.max(reachOffsets, Math.abs(member.ix + g.fx), Math.abs(member.iy + g.fy));
  let model: LensModel;
  try { model = lensModel(input); } catch { return refuse("the reference geometry fails near the axis"); }
  if (!(Number.isFinite(model.kappa) && model.kappa > 0)) refuse("the plane scale is not finite");
  const mismatch = modelCheck(model, lens, W, H, R + reachOffsets + 1);
  if (mismatch) refuse(mismatch);
  // The scene: the composite kernel's records and the materials table (the surround last for a fixed-size chart).
  const scene = sceneOf(setup), placement = setup.gpu!.placement ?? null;
  if (signalInput.scene.materials.length !== scene.materials.length + (placement ? 1 : 0) || spectra.length !== signalInput.scene.materials.length)
    refuse("the expected signal's materials do not match the scene's");
  let packed = packedScenes.get(scene.key);
  if (!packed) {
    try { packed = packChartScene({ chart: scene.chart, layers: scene.layers, materials: scene.materials } as unknown as ChartRadianceBatchPlan); }
    catch (error) { return refuse("the composite chart kernel does not classify this chart (" + String((error as Error).message) + ")"); }
    packedScenes.set(scene.key, packed);
  }
  if (Math.max(packed.af.byteLength, packed.ai.byteLength) > runtime.maximumStorageBindingBytes) throw new ImageKernelExecutionError("insufficient-limits", "Chart records exceed the device's storage binding limit.");
  const probe = await probeDevice(signal), path = probe.productPath ?? "dekker";
  const latticeWords = new Uint32Array(DISPLAY_VIEW_LATTICE.words), latticeFloats = new Float32Array(latticeWords.buffer);
  if (placement) {
    const [kH, kL] = dwSplit(placement.chartUnitsPerFrameUnit);
    if (!(Number.isFinite(kH) && kH > 0 && Number.isFinite(placement.aspect) && placement.aspect > 0)) refuse("the chart placement is not finite");
    latticeFloats[DISPLAY_VIEW_LATTICE.chartKHi] = kH; latticeFloats[DISPLAY_VIEW_LATTICE.chartKLo] = kL; latticeFloats[DISPLAY_VIEW_LATTICE.chartAspect] = placement.aspect;
  }
  latticeWords[DISPLAY_VIEW_LATTICE.placed] = placement ? 1 : 0; latticeWords[DISPLAY_VIEW_LATTICE.surround] = scene.materials.length; latticeWords[DISPLAY_VIEW_LATTICE.zero] = 0;
  // The members (group, integer offset, weight) in the reference's order, the spectra and the channel responses per node.
  const memberRows: number[] = [];
  tables.groups.forEach((g, index) => { for (const member of g.members) memberRows.push(index, member.ix, member.iy, member.weight); });
  const members = Float32Array.from(memberRows), memberCount = memberRows.length / 4;
  const spectrumTable = float32Table(spectra.flatMap((L) => Array.from(L)), "the material spectra");
  const responses = float32Table([...signalInput.electronsPerRadiance[0], ...signalInput.electronsPerRadiance[1], ...signalInput.electronsPerRadiance[2]], "the channel responses");
  let largestResponse = 0, largestSpectrum = 0;
  for (const a of responses) largestResponse = Math.max(largestResponse, a);
  for (const l of spectrumTable) largestSpectrum = Math.max(largestSpectrum, l);
  const gamma = (taps + memberCount + 8) * E;
  const latticePipeline = await pipelines("photivra-display-view-lens-lattice:" + path, displayViewLensLatticeWgsl(wgslHost, path));
  const pointsPipeline = await pipelines("photivra-display-view-lens-points", displayViewLensPointsWgsl(wgslHost));
  const sitesPipeline = await pipelines("photivra-display-view-lens-sites", displayViewLensSitesWgsl(wgslHost));
  const mmPerSite = lens.pitch / 1000, Z = psf.zoneSites, uniformWindows = lens.uniformWindows === true && R >= 1;
  const pointFloats = N + 3;
  const record = { probe, latticePointsResolved: 0, zonesUploaded: 0 };
  return {
    probe,
    get latticePointsResolved(): number { return record.latticePointsResolved; },
    get zonesUploaded(): number { return record.zonesUploaded; },
    siteGamma: gamma,
    latticeWords: DISPLAY_VIEW_LENS_POINT_WORDS,
    tapsPerSite: taps,
    recompute: recomputeLensRuns,
    bandBytes(siteW: number, siteH: number): number {
      const zones = (Math.ceil(siteW / Z) + 1) * (Math.ceil(siteH / Z) + 1);
      return (siteW + 2 * R) * (siteH + 2 * R) * pointFloats * 4 + zones * N * (taps + 6) * 4;
    },
    async runBand(band, b, abortSignal): Promise<{ latticeMs: number; sitesMs: number; dispatches: number; resolved: number }> {
      const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
      let t0 = now();
      // Pass 1: the lens lattice, read back for the host's resolution of its flagged points.
      const records = new GpuResourceScope(runtime);
      let latticeBuffer: GPUBuffer, resolved: number;
      try {
        const af = records.upload("photivra-display-view-lens-chart-floats", packed.af, BUFFER_USAGE.STORAGE), ai = records.upload("photivra-display-view-lens-chart-records", packed.ai, BUFFER_USAGE.STORAGE);
        const latticeUniform = records.upload("photivra-display-view-lens-chart-lattice", latticeWords, BUFFER_USAGE.UNIFORM);
        const params = band.upload("photivra-display-view-lens-params", lensParams(model, lens.pitch, b.latticeTotal, tables.groups.length), BUFFER_USAGE.UNIFORM);
        latticeBuffer = band.buffer("photivra-display-view-lens-lattice", b.latticeTotal * 4 * DISPLAY_VIEW_LENS_POINT_WORDS, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const group0 = runtime.device.createBindGroup({ layout: latticePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: b.groupBuffer } }, { binding: 2, resource: { buffer: latticeBuffer } }] });
        const group1 = runtime.device.createBindGroup({ layout: latticePipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: af } }, { binding: 1, resource: { buffer: ai } },
          { binding: 2, resource: { buffer: latticeUniform } }] });
        const [data] = await runComputePass(runtime, band, latticePipeline, [group0, group1], linearDispatch(b.latticeTotal, wgslHost[5], runtime.maximumWorkgroupsPerDimension),
          [{ buffer: latticeBuffer, bytes: b.latticeTotal * 4 * DISPLAY_VIEW_LENS_POINT_WORDS }], abortSignal);
        const lattice = new Uint32Array(data!, 0, b.latticeTotal * DISPLAY_VIEW_LENS_POINT_WORDS);
        resolved = resolveFlagged(lattice, b.groupWords, wgslHost[3], tables.groups, signalInput, lens, mmPerSite);
        if (resolved > 0) latticeBuffer = band.upload("photivra-display-view-lens-lattice-resolved", lattice, BUFFER_USAGE.STORAGE);
      } finally { records.release(); }
      record.latticePointsResolved += resolved;
      const latticeMs = now() - t0;
      throwIfAborted(abortSignal);
      t0 = now();
      // Pass 1b: the pre-integrated points of the band's window (its sites widened by the PSF radius).
      const bx0 = b.siteX0 - R, by0 = b.siteY0 - R, bw = b.siteW + 2 * R, bh = b.siteH + 2 * R, pointTotal = bw * bh;
      const pointWords = new Uint32Array(DISPLAY_VIEW_LENS_POINT_PARAM_WORDS), pointInts = new Int32Array(pointWords.buffer);
      pointInts[0] = bx0; pointInts[1] = by0; pointWords[2] = bw; pointWords[3] = pointTotal; pointWords[4] = memberCount; pointWords[5] = N;
      const points = band.buffer("photivra-display-view-lens-points", pointTotal * pointFloats * 4, BUFFER_USAGE.STORAGE);
      const pointsGroup = runtime.device.createBindGroup({ layout: pointsPipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: band.upload("photivra-display-view-lens-point-params", pointWords, BUFFER_USAGE.UNIFORM) } }, { binding: 1, resource: { buffer: b.groupBuffer } },
        { binding: 2, resource: { buffer: band.upload("photivra-display-view-lens-members", members, BUFFER_USAGE.STORAGE) } }, { binding: 3, resource: { buffer: latticeBuffer } },
        { binding: 4, resource: { buffer: band.upload("photivra-display-view-lens-spectra", spectrumTable, BUFFER_USAGE.STORAGE) } }, { binding: 5, resource: { buffer: points } }] });
      await runComputePass(runtime, band, pointsPipeline, pointsGroup, linearDispatch(pointTotal, wgslHost[5], runtime.maximumWorkgroupsPerDimension), [], abortSignal);
      // The zones the band's sites read: their PSF per node (node-major, taps in the view's order) and its moments.
      const zx0 = Math.floor(b.siteX0 / Z), zx1 = Math.floor((b.siteX0 + b.siteW - 1) / Z), zy0 = Math.floor(b.siteY0 / Z), zy1 = Math.floor((b.siteY0 + b.siteH - 1) / Z);
      const zonesX = zx1 - zx0 + 1, slots = zonesX * (zy1 - zy0 + 1);
      const kernels = new Float32Array(slots * N * taps), moments = new Float32Array(slots * 6 * N);
      let tinyKernels = 0;
      for (let zy = zy0; zy <= zy1; zy++) for (let zx = zx0; zx <= zx1; zx++) {
        const slot = (zy - zy0) * zonesX + (zx - zx0), zone: DisplayViewLensZoneKernels = psf.zoneKernels(zy * psf.zonesX + zx, signalInput.wavelengthsNm);
        let tiny = 0;
        for (let n = 0; n < N; n++) {
          const k = zone.perNode[n]!, at = (slot * N + n) * taps;
          for (let t = 0; t < taps; t++) {
            const value = k[t]!;
            if (!(value >= 0 && value <= FLOAT32_SAFE_MAGNITUDE)) refuse("a PSF kernel value outside the float32 domain");
            kernels[at + t] = value;
            if (value > 0 && value < 2 * FLOAT32_MINIMUM_NORMAL) tiny += value * largestSpectrum * largestResponse;
          }
          const m = [zone.sums[n]!, zone.momentX[n]!, zone.momentY[n]!, zone.momentXX[n]!, zone.momentYY[n]!, zone.momentXY[n]!];
          for (let j = 0; j < 6; j++) moments[slot * 6 * N + j * N + n] = m[j]!;
        }
        tinyKernels = Math.max(tinyKernels, tiny);
      }
      record.zonesUploaded += slots;
      // What a device that flushes below the float32 normal range can drop from a site: the kernel values in that range and one
      // smallest normal per product and partial sum (float64, rounded up).
      const tinyMass = Math.max(FLOAT32_MINIMUM_NORMAL, Math.fround((tinyKernels + (taps + memberCount + 4) * N * FLOAT32_MINIMUM_NORMAL * (1 + largestResponse)) * (1 + 4 * E)));
      const siteWords = new Uint32Array(DISPLAY_VIEW_LENS_SITE_PARAM_WORDS), siteInts = new Int32Array(siteWords.buffer), siteFloats = new Float32Array(siteWords.buffer);
      siteWords[0] = R; siteWords[1] = taps; siteWords[2] = Z; siteWords[3] = zx0; siteWords[4] = zy0; siteWords[5] = zonesX; siteInts[6] = bx0; siteInts[7] = by0;
      siteWords[8] = bw; siteWords[9] = uniformWindows ? 1 : 0; siteWords[10] = memberCount; siteFloats[11] = gamma;
      void bh;
      const siteUniform = band.upload("photivra-display-view-lens-site-params", siteWords, BUFFER_USAGE.UNIFORM);
      const kernelBuffer = band.upload("photivra-display-view-lens-kernels", kernels, BUFFER_USAGE.STORAGE), momentBuffer = band.upload("photivra-display-view-lens-moments", moments, BUFFER_USAGE.STORAGE);
      const responseBuffer = band.upload("photivra-display-view-lens-responses", responses, BUFFER_USAGE.STORAGE), spectrumBuffer = band.upload("photivra-display-view-lens-site-spectra", spectrumTable, BUFFER_USAGE.STORAGE);
      // Pass 2: the sites, in chunks of whole workgroups whose taps stay within the tap budget per dispatch.
      const siteTotal = b.siteW * b.siteH, perDispatch = Math.max(wgslHost[5], Math.floor(b.maximumSiteTapsPerDispatch / Math.max(1, taps) / wgslHost[5]) * wgslHost[5]);
      let dispatches = 0;
      for (let first = 0; first < siteTotal; first += perDispatch) {
        throwIfAborted(abortSignal);
        const count = Math.min(perDispatch, siteTotal - first), chunk = new GpuResourceScope(runtime);
        try {
          const bytes = b.sitesParams(count, first);
          new Float32Array(bytes.buffer)[52] = tinyMass;
          const group = runtime.device.createBindGroup({ layout: sitesPipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: chunk.upload("photivra-display-view-lens-sites-params", bytes, BUFFER_USAGE.UNIFORM) } }, { binding: 1, resource: { buffer: siteUniform } },
            { binding: 2, resource: { buffer: points } }, { binding: 3, resource: { buffer: kernelBuffer } }, { binding: 4, resource: { buffer: momentBuffer } },
            { binding: 5, resource: { buffer: b.siteBuffer } }, { binding: 6, resource: { buffer: responseBuffer } }, { binding: 7, resource: { buffer: spectrumBuffer } }] });
          await runComputePass(runtime, chunk, sitesPipeline, group, linearDispatch(count, wgslHost[5], runtime.maximumWorkgroupsPerDimension), [], abortSignal);
          const queue = runtime.device.queue as { onSubmittedWorkDone?: () => Promise<undefined> };
          if (typeof queue.onSubmittedWorkDone === "function") await runtime.guard(queue.onSubmittedWorkDone(), abortSignal);
        } finally { chunk.release(); }
        dispatches++;
      }
      return { latticeMs, sitesMs: now() - t0, dispatches, resolved };
    }
  };
}

/**
 * #655 (G1): `recomputeRuns` for a lens view: the reference's pixels with the setup's own expected signal (the lens signal), whose
 * site values depend only on the site, so a run of pixels equals the whole view's.
 */
async function recomputeLensRuns(setup: DisplayViewSetup, _signalInput: DisplayViewExpectedSignalInput, indices: readonly number[], abort: AbortController,
  take: (first: number, run: number, part: DisplayViewRenderResult) => void): Promise<void> {
  const region = setup.region;
  for (let r = 0; r < indices.length;) {
    throwIfAborted(abort.signal);
    const first = indices[r]!, rx = first % region.width, ry = (first - rx) / region.width;
    let run = 1;
    while (r + run < indices.length && indices[r + run] === first + run && rx + run < region.width) run++;
    take(first, run, await renderDisplayView({ ...setup, region: { x: region.x + rx, y: region.y + ry, width: run, height: 1 } }));
    r += run;
  }
}

/**
 * Replaces every lattice point the lens lattice pass flagged (bit 31) by the reference's material at the reference's own lattice
 * point ((p + 0.5 + f − W/2)·p_mm, (q + 0.5 + f − H/2)·p_mm through the lens signal's `map` and the scene's `materialAt`); returns
 * the count. A point the reference cannot look up fails as the reference does.
 */
function resolveFlagged(lattice: Uint32Array, groupWords: Uint32Array, stride: number, groups: ReturnType<typeof displayViewSignalTables>["groups"],
  signalInput: DisplayViewExpectedSignalInput & { scene: Extract<DisplayViewExpectedSignalInput["scene"], { kind: "materials" }> }, lens: DisplayViewLensSetup, mmPerSite: number): number {
  const W = signalInput.nativeWidth, H = signalInput.nativeHeight, ints = new Int32Array(groupWords.buffer, groupWords.byteOffset, groupWords.length), materials = signalInput.scene.materials.length;
  let resolved = 0;
  groups.forEach((group, k) => {
    const base = k * stride, lx0 = ints[base]!, ly0 = ints[base + 1]!, lw = groupWords[base + 2]!, lh = groupWords[base + 3]!, first = groupWords[base + 4]!;
    for (let local = 0; local < lw * lh; local++) {
      const at = (first + local) * DISPLAY_VIEW_LENS_POINT_WORDS;
      if ((lattice[at]! >>> 31) === 0) continue;
      const p = lx0 + (local % lw), q = ly0 + Math.floor(local / lw);
      const point = referencePoint(lens, (p + 0.5 + group.fx - W / 2) * mmPerSite, (q + 0.5 + group.fy - H / 2) * mmPerSite);
      const m = signalInput.scene.materialAt(point.u, point.v);
      if (!(Number.isInteger(m) && m >= 0 && m < materials)) throw new ImageKernelExecutionError("unsupported-on-backend", "webgpu-f32 display view (catalogue lens): a lattice point has no scene material; use cpu-reference.");
      lattice[at] = m;
      if (!(Math.fround(point.factor) > 0)) throw new ImageKernelExecutionError("unsupported-float32-domain", "A lattice point's field factor is outside the float32 domain.");
      resolved++;
    }
  });
  return resolved;
}

// ---------------------------------------------------------------------------------------------------------------
// The lens passes' self-check.

/**
 * A float64 still rectilinear lens of the self-check (the model the kernels evaluate, solved to convergence): the geometry the
 * lens signal reads (`lookOf`), and the raw geometry the lens passes take.
 */
function conformanceLens(focalLengthMm: number, focusDistanceM: number, halfDiagonalMm: number): DisplayViewLensGpuInput["geometry"] & { lookOf: DisplayViewLensSetup["geometry"]["lookOf"] } {
  const lensMapping = prepareEnvironmentLensFieldMapping({ projectionModel: "rectilinear", radiometricAreaCorrection: "inverse-distortion-jacobian",
    distortion: { kind: "radial", profile: { normalizationRadiusMm: halfDiagonalMm, maximumNormalizedRadius: 1.6, coefficients: { k1: -0.06, k2: 0, k3: 0 } } } });
  const vignetting = { normalizationRadiusMm: halfDiagonalMm, maximumNormalizedRadius: 1.6, coefficients: { r2: -0.6, r4: 0.09, r6: 0 } };
  const pd = focalLengthMm * focusDistanceM * 1000 / (focusDistanceM * 1000 - focalLengthMm);
  const model: LensModel = { radial: true, k1: -0.06, k2: 0, k3: 0, invRn2: 1 / (halfDiagonalMm * halfDiagonalMm), tMax: 2.56, vignetting: true, invRv2: 1 / (halfDiagonalMm * halfDiagonalMm),
    v2: -0.6, v4: 0.09, v6: 0, kappa: 1 };
  return { focalLengthMm, focusDistanceM, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 }, lensMapping, vignetting,
    lookOf(xMm: number, yMm: number): { x: number; y: number; z: number; factor: number } {
      const point = modelPoint(model, xMm, yMm), ideal = modelIdeal(model, xMm, yMm), length = Math.hypot(ideal.x, ideal.y, pd);
      return { x: ideal.x / length, y: ideal.y / length, z: pd / length, factor: point.factor };
    } };
}

/** A field-dependent PSF of the self-check: per zone of a 2 × 2 split, a binned Gaussian per node whose width grows with the zone and the node. */
function conformancePsf(W: number, H: number, R: number, wavelengthsNm: readonly number[]): DisplayViewLensPsf {
  const Z = Math.ceil(Math.max(W, H) / 2), zonesX = Math.ceil(W / Z), zonesY = Math.ceil(H / Z), w = 2 * R + 1;
  const zoneKernels = (zone: number): DisplayViewLensZoneKernels => {
    const perNode = wavelengthsNm.map((_, n) => {
      const sigma = 0.55 + 0.12 * zone + 0.08 * n, k = new Float64Array(w * w);
      let sum = 0;
      // An asymmetric spot (a shift of 0.2 site along x in the outer zones), so the moments and the tap order matter.
      for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) { const x = u - (zone % 2) * 0.2, value = Math.exp(-0.5 * (x * x + v * v) / (sigma * sigma)); k[(v + R) * w + u + R] = value; sum += value; }
      return k.map((value) => value / sum);
    });
    const N = perNode.length, out = { perNode, sums: new Float64Array(N), momentX: new Float64Array(N), momentY: new Float64Array(N), momentXX: new Float64Array(N), momentYY: new Float64Array(N), momentXY: new Float64Array(N) };
    perNode.forEach((k, n) => {
      for (let v = -R, t = 0; v <= R; v++) for (let u = -R; u <= R; u++, t++) {
        const value = k[t]!;
        out.sums[n] = out.sums[n]! + value; out.momentX[n] = out.momentX[n]! - value * u; out.momentY[n] = out.momentY[n]! - value * v;
        out.momentXX[n] = out.momentXX[n]! + value * u * u; out.momentYY[n] = out.momentYY[n]! + value * v * v; out.momentXY[n] = out.momentXY[n]! + value * u * v;
      }
    });
    return out;
  };
  return { radius: R, zoneSites: Z, zonesX, zonesY, zoneOf: (x, y) => Math.floor(y / Z) * zonesX + Math.floor(x / Z),
    axisKernels: () => ({ radius: R, perNode: [...zoneKernels(zonesX * (zonesY >> 1) + (zonesX >> 1)).perNode] }), zoneKernels };
}

/**
 * The float64 reference of the self-check: the lens signal's sum (`psfSite` of `facade/display-view-lens-signal.ts`) written out for
 * its still lens, so this chunk need not load the lens signal: site = Σ_n A_c(λ_n)·Σ_t K_{z,n}(t)·B(x − t)[n] with
 * B(p)[n] = Σ_o w_o·F(p + o)·L_{m(p + o)}(λ_n) at the lattice points of each offset's group, and with `uniformWindows` the
 * second-order form at a site whose taps all read one material. Values depend only on the site (a region equals the whole view).
 */
function conformanceSignal(lens: DisplayViewLensSetup, input: DisplayViewExpectedSignalInput): DisplayViewExpectedSignal {
  const W = input.nativeWidth, H = input.nativeHeight, N = input.wavelengthsNm.length, psf = lens.psf!, R = psf.radius, w = 2 * R + 1, mm = lens.pitch / 1000;
  const scene = input.scene as Extract<DisplayViewExpectedSignalInput["scene"], { kind: "materials" }>, { spectra, groups } = displayViewSignalTables(input);
  const point = (xMm: number, yMm: number): { m: number; f: number } => { const p = referencePoint(lens, xMm, yMm); return { m: scene.materialAt(p.u, p.v), f: p.factor }; };
  const B = (p: number, q: number): { b: Float64Array; m: number; f: number } => {
    const b = new Float64Array(N);
    let m = -2, f = 0;
    for (const g of groups) for (const member of g.members) {
      const at = point((p + member.ix + 0.5 + g.fx - W / 2) * mm, (q + member.iy + 0.5 + g.fy - H / 2) * mm), wf = member.weight * at.f, L = spectra[at.m]!;
      f += wf; m = m === -2 || m === at.m ? at.m : -1;
      for (let n = 0; n < N; n++) b[n] = b[n]! + wf * L[n]!;
    }
    return { b, m, f };
  };
  const site = (x: number, y: number): number => {
    const zone = psf.zoneKernels(psf.zoneOf(x, y), input.wavelengthsNm), A = input.electronsPerRadiance[input.channelAt(x, y)]!, taps: ReturnType<typeof B>[] = [];
    for (let t = 0; t < w * w; t++) taps.push(B(x - (t % w - R), y - (Math.floor(t / w) - R)));
    let value = 0;
    if (lens.uniformWindows && R >= 1 && taps[0]!.m >= 0 && taps.every((t) => t.m === taps[0]!.m)) {
      const c = R * w + R, fac = (t: number): number => taps[t]!.f, f0 = fac(c), xp = fac(c - 1), xm = fac(c + 1), yp = fac(c - w), ym = fac(c + w), L = spectra[taps[0]!.m]!;
      const gx = (xp - xm) / 2, gy = (yp - ym) / 2, hxx = xp - 2 * f0 + xm, hyy = yp - 2 * f0 + ym, hxy = (fac(c - w - 1) - fac(c - w + 1) - fac(c + w - 1) + fac(c + w + 1)) / 4;
      for (let n = 0; n < N; n++) value += L[n]! * A[n]! * (f0 * zone.sums[n]! + gx * zone.momentX[n]! + gy * zone.momentY[n]! + 0.5 * (hxx * zone.momentXX[n]! + hyy * zone.momentYY[n]!) + hxy * zone.momentXY[n]!);
    } else for (let n = 0; n < N; n++) { const k = zone.perNode[n]!; let s = 0; for (let t = 0; t < w * w; t++) s += k[t]! * taps[t]!.b[n]!; value += A[n]! * s; }
    return value;
  };
  const values = new Map<number, number>(), g = 2 / input.outputWidth;
  return { lookups: 0, uniformMaterial: -1, tracksMaterial: false, cachesSites: false, marksReads: false, markReads(): void { /* unused */ }, window(): void { /* every site is kept */ },
    site(x: number, y: number): number { const k = y * W + x; let v = values.get(k); if (v === undefined) { v = site(x, y); values.set(k, v); } return v; },
    pilot: (u: number, v: number): number => point(u / g * mm, -v / g * mm).m };
}

/**
 * The lens passes' run-time self-check (`DisplayViewGpuRenderer.onDemandConformanceCases` of a lens render): the self-checks'
 * 40 × 28 checkerboard frame of 6 µm sites at 13 × 9 behind a synthetic still lens (barrel distortion k1 = −0.06, vignetting
 * (1 − 0.3ρ²)², 20 mm frame half-diagonal scaled to the frame) with a 2 × 2-zone PSF of radius 2, the 2 × 2 box (four lattice
 * groups) and the uniform windows; the GPU against `renderDisplayView` with the float64 reference of the lens signal's sum
 * (`conformanceSignal`), within the a-priori bounds.
 */
/** Internal (exported for tests): the self-check's setup (its expected signal the float64 reference), expected-signal input and lens input. */
export function displayViewLensConformanceFixture(signal: AbortSignal | undefined): { setup: DisplayViewSetup; signalInput: DisplayViewExpectedSignalInput; lens: DisplayViewLensGpuInput } {
  const { nativeWidth: W, nativeHeight: H, frameWidth, nodes } = CONFORMANCE_FRAME, { chart, scene } = conformanceChart();
  const pitch = 6, halfDiagonal = Math.hypot(W, H) * pitch / 2000, R = 2;
  const geometry = conformanceLens(50, 2, halfDiagonal), psf = conformancePsf(W, H, R, nodes);
  // The plane: the rectilinear frame's width spans the frame's 2 units (metres per frame unit from the 50 mm lens at 2 m).
  const pd = 50 * 2000 / (2000 - 50), metresPerFrameUnit = (W * pitch / 2000) / pd * 2;
  const lens: DisplayViewLensSetup = { geometry: { lookOf: geometry.lookOf, sensorPointOf: () => undefined, timeDependent: false }, times: [0], distanceM: 2, metresPerFrameUnit, pitch,
    imagingArea: { widthMm: W * pitch / 1000, heightMm: H * pitch / 1000 }, boxSamples: 2, spots: [{ offsetMicrometers: { x: 0, y: 0 } }], psf, uniformWindows: true };
  const offsets = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].map(([x, y]) => ({ x: x!, y: y!, weight: 0.25 }));
  const signalInput: DisplayViewExpectedSignalInput = { nativeWidth: W, nativeHeight: H, outputWidth: frameWidth, wavelengthsNm: nodes, electronsPerRadiance: conformanceResponses(1), offsets,
    kernels: psf.axisKernels(nodes), scene, channelAt: conformanceChannelAt };
  const base = conformanceSetup(signalInput, { perElectron: 1 / 60000, darkElectrons: 0.07, constantVariance: 1.5e-9 }, 655, R + 2, signal);
  return { setup: { ...base, signal: conformanceSignal(lens, signalInput), gpu: { signalInput, chart, layers: null, placement: null } }, signalInput, lens: { lens, geometry } };
}

export function displayViewLensConformanceCase(probeDevice: CompositeProbe, render: typeof renderQuality = renderQuality): DisplayViewGpuConformanceCase {
  return { id: "display-view:lens:checkerboard-13x9-zones", async run(handle: DisplayViewGpuRuntimeHandle, signal: AbortSignal | undefined): Promise<true | string> {
    const runtime = handle as WebGpuRuntime, { setup, signalInput, lens } = displayViewLensConformanceFixture(signal);
    const reference: DisplayViewRenderResult = await renderDisplayView(setup);
    return await withConformanceAbort(runtime, signal, async (abort, pipelines) => {
      const passes = await createDisplayViewLensPasses(runtime, setup, lens, pipelines, probeDevice, abort.signal);
      const gpu = await render(runtime, 1 << 20, { setup, signalInput, material: { id: "lens", wgsl: "", bindings: [] }, lens: passes }, abort, undefined, pipelines);
      return conformanceVerdict(reference, gpu);
    });
  } };
}
