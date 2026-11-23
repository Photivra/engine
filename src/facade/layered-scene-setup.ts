// SPDX-License-Identifier: Apache-2.0

/**
 * The facade's wiring of layered chart scenes (#652; docs/LAYERED_SCENES.md), loaded on demand: `simulate-capture.ts` imports it
 * only for a request whose `scene.kind` is `"layered-chart"`, so default captures and views carry none of it.
 *
 * - Request: the refusals (`LAYERED_REFUSALS`, one row per option), the scene (`resolveLayeredChartScene` for
 *   the frame's aspect) and the route. One card without a back plane is a single-plane chart scene: a centred card filling the frame (width 2, height 2·aspect, no depth label) passes
 *   its own `scene` to the existing path (the same bytes as that chart), any other single card a material scene of its print; the
 *   single-plane path then applies `lens.defocus` at the card's distance. More surfaces take the layered sum.
 * - Report (`result.scene.layers`): the depth report (`layeredChartDepths`, as `calculateLayeredChartDepths`) at the frame's circle of confusion (its diagonal / 1500, the
 *   convention of the catalogue's focus scatter), and each surface's defocus kernel (the disc of `createDefocusDiscSiteKernel`, or
 *   with bokeh options the shaped kernel of `createDefocusBokehSiteKernel` on the surface's side of the focus plane, and with a
 *   cat's eye its field zones, `planDefocusBokehZones`).
 * - The layered sum's lattice (`layered-scene-signal.ts`) for the capture's and ideal reference's provider
 *   (`layered-scene-provider.ts`) and the display view's expected signal, built from the same layers, so the capture and the view
 *   agree per site within rounding. Occlusion rows: `LAYERED_OCCLUSION_SAMPLES` fast or full (registry entry
 *   `scene.layers/occlusion-samples`).
 * - 2.29.0 (wave-3 wiring):
 *   - #744: with `lens.projection`, `lens.distortion` or `lens.vignetting` the lattice takes the lens map of the facade's prepared
 *     lens geometry (`createLayeredLensMap`), the same one for the capture and the view; the capture's environment declares the same
 *     lens field mapping and vignetting. A surface's single-plane input (`signalInput`) is omitted under a lens map, so every site
 *     takes the layered sum. The view's pilot maps its planar points through `rasterFramePoint`. A fisheye is
 *     refused when the request reads a point 75° or more off the axis (`checkLayeredFisheyeFieldAngle`, owner decision). The
 *     ideal reference keeps the planar lattice (no camera effects).
 *   - #745: with `illumination`, each surface is the lit radiance scene of `layeredLitSurfaceScene`: the blend at its own frame
 *     point, as one light field over the frame's angles (an approximation: no shadows between surfaces, no falloff with depth).
 *   - #749: every surface's kernel radius is checked against the layered sum's bound before any kernel is built (the disc's
 *     512, a shaped kernel's 128).
 *   - #761: with `chartSize` the cards are placed in chart units (u = ±1 at the chart's left and right edges, at the subject
 *     distance); the far surface continues beyond the chart (no surround).
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { convolveSiteKernels, createDefocusDiscSiteKernel, defocusDiscKernelRadius, defocusDiscLimitMessage } from "../optics/defocus-disc-kernel.js";
import { defocusBokehKernelRadius, type DefocusBokehSiteKernel, type ResolvedDefocusBokehOptions } from "../optics/defocus-bokeh-kernel.js";
import type { SiteKernelFieldZones } from "./diffraction-provider.js";
import type { DisplayViewExpectedSignal, DisplayViewQueryOffset } from "./expected-signal.js";
import { loadedKit, QK_CREATE_DEFOCUS_BOKEH_SITE_KERNEL, QK_PLAN_DEFOCUS_BOKEH_ZONES, QK_SITE_DIFFRACTION_KERNEL, qualityKit } from "./on-demand-kits.js";
import { resolveCaptureIlluminant, resolvePortableCaptureIlluminant, type CaptureIlluminant, type PlanarSceneRadianceProvider, type ResolvedCallerMaterialScene,
  type ResolvedCaptureIlluminant } from "./scene-radiance.js";
import type { DiffractionLimitedPsfProfile } from "../optics/diffraction-psf-profile.js";
import type { SimulateCaptureAssumption } from "./simulate-capture.js";
import { LAYERED_CHART_LIMITS, layeredChartDepths, layeredSurfaceScene, resolveLayeredChartScene, type LayeredChartDepth, type LayeredChartScene,
  type ResolvedLayeredChartScene, type ResolvedLayeredSurface } from "./layered-chart-scene.js";
import { LAYERED_OCCLUSION_SAMPLES, createLayeredSceneLattice, createLayeredSceneSignal, type LayeredSceneLattice, type LayeredSceneLayer } from "./layered-scene-signal.js";
import { createLayeredSceneProvider } from "./layered-scene-provider.js";
import type { LayeredLayerKernel } from "./layered-edge-sum.js";
import { checkLayeredFisheyeFieldAngle, createLayeredLatticeGeometry, createLayeredLensMap, type LayeredFramePoint, type LayeredLensMap } from "./layered-lattice-geometry.js";
import { layeredLitSurfaceScene } from "./layered-surface-radiance.js";
import type { DisplayViewScene } from "./expected-signal.js";
import type { ResolvedMixedIllumination } from "./mixed-illumination.js";
import type { PreparedDefocusImageSpaceGeometry } from "./defocus-image-space-provider.js";

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };
const UNIT = /* @__PURE__ */ Float64Array.of(1);

/** What the setup reads from the resolved request (`runCapture`'s display-view context, built for every run). */
export interface LayeredRequestContext {
  assume: (id: string, kind: SimulateCaptureAssumption["kind"], value: unknown, explanation: string) => void;
  nativeWidth: number;
  nativeHeight: number;
  width: number;
  height: number;
  pitch: number;
  focalLengthMm: number;
  fNumber: number;
  focusDistanceM: number;
  subjectDistanceM: number;
  metresPerFrameUnit: number;
  defocusBokeh: ResolvedDefocusBokehOptions | undefined;
  diffraction: DiffractionLimitedPsfProfile | undefined;
  diffractionPsf: { configuration: { psf: unknown } } | undefined;
  queryOffsetsSites: readonly { x: number; y: number }[];
  boxSamples: number;
  irradianceScale: number;
  illuminant: { shape: { evaluate(nm: number): number } };
  provider: PlanarSceneRadianceProvider;
  axisChannelResponse(caller: string): { wavelengths: number[] };
  viewFast: { layers: boolean };
  /** #744: the facade's prepared lens geometry (still camera) with a projection, distortion or vignetting; undefined without them. */
  lensGeometry?: Pick<PreparedDefocusImageSpaceGeometry, "lookOf" | "sensorPointOf"> | undefined;
  /** #745: the request's `illumination`, resolved with an illuminant resolver (the capture's, or the view's portable one). */
  mixedIllumination?: ((resolve: (value: CaptureIlluminant) => ResolvedCaptureIlluminant) => ResolvedMixedIllumination) | undefined;
}

/** One surface's kernel: the disc or shaped kernel (null in focus) and, with a cat's eye, its field zones. */
interface SurfaceKernel { kernel: LayeredLayerKernel | null; zones?: SiteKernelFieldZones }

/** A layered request, resolved (see the module comment). */
export interface LayeredRequest {
  /** More than one surface: the layered sum (the facade's single-plane defocus and tables are not used). */
  multi: boolean;
  resolved: ResolvedLayeredChartScene;
  /** A centred card filling the frame: its own chart scene, passed to the existing path. */
  sceneOption?: unknown;
  /** Otherwise the scene the facade renders: a material scene (the card's print, or each frame point's nearest surface). */
  callerScene?: ResolvedCallerMaterialScene;
  /** One card: its distance, where the single-plane path applies `lens.defocus`. */
  distanceM?: number;
  /** The depth report and kernels, once the f-number is resolved; records the `scene.layers` assumption and sets `scene`. */
  report(context: LayeredRequestContext): void;
  /** `result.scene.layers`, once reported. */
  scene?: { layers: LayeredChartDepth[] };
  /** The capture's raw provider: the layered sum at the environment's query points (no environment PSF). */
  provider(context: LayeredRequestContext): PlanarSceneRadianceProvider;
  /** The ideal reference's provider: the sum without diffraction, at the pixel-aperture nodes. */
  reference(context: LayeredRequestContext): PlanarSceneRadianceProvider;
  /** The display view's expected signal (a new one per render) and the reach of its largest surface kernel. */
  view(context: LayeredRequestContext, input: { wavelengths: readonly number[]; white: Float64Array; perNode: readonly [Float64Array, Float64Array, Float64Array];
    offsets: readonly DisplayViewQueryOffset[]; channelAt(x: number, y: number): number; diffraction: { radius: number; perNode: readonly Float64Array[] } | undefined }):
    { reach: number; signal(): DisplayViewExpectedSignal };
}

type RequestPart = Record<string, unknown>;
/** The release the refusal messages name. */
const LAYERED_REFUSALS_RELEASE = "2.27.0";
/**
 * The options layered scenes refuse, one row each: the request path the message names, whether the request has the option,
 * and the reason. Rows are checked in order and the first present one fails the request. A group that makes an option render
 * removes its row and nothing else (2.29.0: wiring groups LW1 and LW2).
 */
interface LayeredRefusal {
  readonly option: string | ((top: RequestPart) => string);
  present(top: RequestPart, lens: RequestPart): boolean;
  readonly reason: string;
}
const motionKeys = (top: RequestPart): string[] => (typeof top.motion === "object" && top.motion !== null ? Object.keys(top.motion) : []);
const LAYERED_REFUSALS: readonly LayeredRefusal[] = [
  { option: (top): string => { const motion = motionKeys(top); return "motion" + (motion.length > 0 ? "." + motion[0] : ""); },
    present: (top) => top.motion !== undefined && motionKeys(top).length > 0, reason: "each surface's defocus and occlusion are rendered for a still camera and scene" },
  { option: "lens.catalogue", present: (_, lens) => lens.catalogue !== undefined, reason: "a catalogue lens has its own distortion, vignetting and PSF" },
  { option: "lens.pupilSampling", present: (_, lens) => lens.pupilSampling !== undefined, reason: "the layered sum renders the defocus and occlusion of each surface itself" },
  { option: "lens.psf", present: (_, lens) => lens.psf !== undefined, reason: "a caller PSF declares its own defocus" }];

/** Validates and resolves a layered request (see the module comment). */
export function resolveLayeredRequest(input: { top: Record<string, unknown>; lens: Record<string, unknown>; aspect: number; displayView: boolean;
  /** #761: the resolved `chartSize` (validated by the facade), and the frame's metres per frame unit at the subject distance. */
  chartSize?: { widthM: number; heightM: number } | undefined; metresPerFrameUnit?: number }): LayeredRequest {
  const { top, lens, chartSize } = input;
  for (const refusal of LAYERED_REFUSALS) if (refusal.present(top, lens)) {
    const option = typeof refusal.option === "string" ? refusal.option : refusal.option(top);
    fail("scene.kind \"layered-chart\" does not support " + option + " in " + LAYERED_REFUSALS_RELEASE + ": " + refusal.reason + ". Omit it, or use a single-plane scene.");
  }
  if (chartSize) {
    if ((top.chartSize as RequestPart).surroundReflectance !== undefined)
      fail("chartSize.surroundReflectance does not apply to a layered chart scene: its far surface continues beyond the chart. Omit it.");
    if (top.illumination !== undefined) fail("scene.kind \"layered-chart\" does not support illumination with chartSize in 2.29.0: the light's blend would be placed in chart " +
      "units while the scene's metering reads the frame. Omit one of them.");
  }
  // #761: chart units per frame unit (1 without chartSize): the scene is resolved in chart units (u = ±1 at the chart's left and right
  // edges), and each surface is read at frame point (u, v) as chart point (c·u, c·v); its rectangle in frame units is divided by c.
  const c = chartSize ? input.metresPerFrameUnit! / (chartSize.widthM / 2) : 1;
  const scene = top.scene as LayeredChartScene, resolved = resolveLayeredChartScene({ scene, aspect: chartSize ? chartSize.heightM / chartSize.widthM : input.aspect });
  const surfaces = c === 1 ? resolved.surfaces : resolved.surfaces.map((s): ResolvedLayeredSurface => ({ ...s, rect: s.rect && { u0: s.rect.u0 / c, v0: s.rect.v0 / c, u1: s.rect.u1 / c, v1: s.rect.v1 / c },
    materialAt: (u, v) => s.materialAt(u * c, v * c) }));
  const fisheye = lens.projection !== undefined && lens.projection !== "rectilinear";
  const defocus = lens.defocus as { catsEye?: unknown } | undefined;
  if (resolved.singlePlane && input.displayView && defocus?.catsEye !== undefined)
    fail("simulateDisplayView does not support lens.defocus.catsEye for a layered scene of one card without a back plane: it renders on the single-plane path, whose tables hold " +
      "one kernel. Add a back plane (the layered sum renders the cat's eye), or use simulateCapture.");
  // The frame point's nearest surface (the chief ray's): the facade's metering, white balance and pilot read it.
  const offsets: number[] = [];
  let count = 0;
  for (const s of surfaces) { offsets.push(count); count += s.materials.length; }
  const materialAt = (point: { u: number; v: number }): number => {
    const { u, v } = point;
    for (let k = 0; k < surfaces.length; k++) {
      const r = surfaces[k]!.rect;
      if (r === null || (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1)) return offsets[k]! + surfaces[k]!.materialAt(u, v);
    }
    return 0;
  };
  const materials = surfaces.flatMap((s) => s.materials);
  const callerScene = Object.freeze({ kind: "material-function" as const, sceneId: "layered-chart", materialAt, materials: Object.freeze(materials),
    materialInputs: Object.freeze(materials.map(() => ({}))), digestForm: { kind: "layered-chart", scene } }) as unknown as ResolvedCallerMaterialScene;
  let kernels: SurfaceKernel[] | undefined, depths: LayeredChartDepth[] | undefined;
  const request: LayeredRequest = {
    multi: !resolved.singlePlane, resolved,
    ...(resolved.singlePlane ? { distanceM: surfaces[0]!.distanceM } : {}),
    ...(c === 1 && singlePlaneChart(scene, input.aspect) ? { sceneOption: scene.cards[0]!.scene } : { callerScene }),
    report(context) {
      const { width, height, pitch, focalLengthMm, fNumber, focusDistanceM } = context;
      const circleOfConfusionMm = Math.hypot(width, height) * pitch / 1000 / 1500;
      depths = layeredChartDepths(resolved, { focalLengthMm, aperture: fNumber, focusDistanceM, circleOfConfusionMm, pixelPitchMicrometers: pitch });
      // The single-plane route resolves lens.defocus itself (a "model" record); only the layered sum records the implied default.
      if (lens.defocus === undefined && request.multi) context.assume("lens.defocus", "default", { model: "geometric-disc" },
        "A layered chart scene implies lens.defocus { model: \"geometric-disc\" }: each surface is blurred by the thin-lens disc of its own distance.");
      if (request.multi) kernels = surfaceKernels(context, depths);
      const fast = context.viewFast.layers, samples = LAYERED_OCCLUSION_SAMPLES[fast ? "fast" : "full"], mapped = !!context.lensGeometry, lit = top.illumination !== undefined;
      context.assume("scene.layers", "model", { surfaces: depths.length, circleOfConfusionMm, execution: request.multi ? "layered-sum" : "single-plane",
        ...(request.multi ? { occlusionSamples: samples, fast, kernelRadiusSites: kernels!.map((k) => (k.kernel ? k.kernel.radius : 0)), catsEye: kernels!.some((k) => k.zones !== undefined),
          ...(mapped ? { lensMap: true } : {}), ...(lit ? { illumination: "blend-at-each-frame-point" } : {}) } : {}), ...(c === 1 ? {} : { chartUnitsPerFrameUnit: c }) },
      "Layered chart scene (#652, docs/LAYERED_SCENES.md): " + (request.multi ?
        "opaque fronto-parallel cards in front of " + (surfaces[surfaces.length - 1]!.kind === "back-plane" ? "a back plane" : "the farthest card") + ", seen through a thin lens (geometric optics). " +
        "Each surface is blurred by its own kernel at its distance (the disc, or the shaped kernel of the bokeh options), and each kernel tap's pupil region counts only the share of its rays " +
        "that reach the surface past every nearer card, integrated in rows (exact along each row; " + samples + " rows per site of footprint" +
        (fast ? ", the fast method; fast: false takes " + LAYERED_OCCLUSION_SAMPLES.full + ")." : ", the full method)." ) +
        (mapped ? " #744: the sum is on the sensor's site lattice through the lens's projection, distortion and vignetting (each lattice point's frame point and field factor), each card " +
          "edge taken as its tangent line near the point (an approximation of second order in its curvature); every site takes the sum." :
          " Sites whose lattice points all see one surface take that surface's single-plane sum.") +
        (lit ? " #745: each surface point is lit by the illumination's blend and point sources at its own frame point, one light field over the frame's angles " +
          "(an approximation: no shadows between surfaces, no falloff with depth)." : "") +
        " Every site integrates its spectra against its own channel response; with lens.diffraction " +
        "each node's diffraction kernel follows the sum (the single-plane path's approximation, per layer). No light scattered between surfaces; flat, opaque Lambertian cards." :
        "one card without a back plane is a single-plane chart scene, rendered on the single-plane path at the card's distance.") +
      (c === 1 ? "" : " #761: chartSize places the cards in chart units (±1 at the chart's left and right edges at the subject distance); the far surface continues beyond the chart.") +
      " scene.layers reports each surface's distance, blur diameter and whether it lies within the depth of field at the circle of confusion of the frame's diagonal / 1500.");
      request.scene = { layers: depths };
    },
    provider(context) {
      const wavelengths = context.axisChannelResponse("simulateCapture").wavelengths;
      return providerOf(context, lattice(context, wavelengths, whiteOf(context, wavelengths), diffractionOf(context, wavelengths), context.queryOffsetsSites, true,
        context.mixedIllumination?.(resolveCaptureIlluminant)), wavelengths, context.queryOffsetsSites);
    },
    reference(context) {
      const wavelengths = context.axisChannelResponse("simulateIdealReference").wavelengths, n = context.boxSamples;
      const nodes = Array.from({ length: n * n }, (_, i) => ({ x: (i % n + 0.5) / n - 0.5, y: (Math.floor(i / n) + 0.5) / n - 0.5 }));
      // The ideal reference has no camera effects: the planar lattice, without the lens map.
      return providerOf(context, lattice(context, wavelengths, whiteOf(context, wavelengths), undefined, nodes, false, context.mixedIllumination?.(resolveCaptureIlluminant)), wavelengths, nodes);
    },
    view(context, input) {
      const light = context.mixedIllumination?.(resolvePortableCaptureIlluminant), layers = layersOf(context, input.wavelengths, input.white, input.diffraction, light, input);
      const latticeInput = { ...latticeInputOf(context, input.wavelengths, layers, input.diffraction, input.offsets, true), offsets: input.offsets,
        electronsPerRadiance: input.perNode, channelAt: input.channelAt };
      return { reach: Math.max(0, ...kernels!.map((k) => (k.kernel ? k.kernel.radius : 0))), signal: (): DisplayViewExpectedSignal => {
        const signal = createLayeredSceneSignal(latticeInput, createLayeredSceneLattice(latticeInput)), geometry = signal.lattice.parts.geometry;
        // #744: the renderer's pilot point is a planar raster point; through a lens map it reads the frame point the lens maps it to.
        if (!geometry.planar) {
          const pilot = signal.pilot, at: LayeredFramePoint = { u: 0, v: 0, factor: 1 };
          signal.pilot = (u, v): number => { const p = geometry.rasterFramePoint(u, v, at); return p.factor === 0 ? -1 : pilot(p.u, p.v); };
        }
        return signal;
      } };
    }
  };
  /** #744: the lens map of the facade's lens geometry (one per request; the capture's and the view's are the same map). */
  let lensMap: LayeredLensMap | undefined;
  function lensMapOf(context: LayeredRequestContext): LayeredLensMap | undefined {
    return context.lensGeometry && (lensMap ??= createLayeredLensMap({ geometry: context.lensGeometry, pitchMicrometers: context.pitch, distanceM: context.subjectDistanceM,
      metresPerFrameUnit: context.metresPerFrameUnit }));
  }
  /** Surface k's scene at the spectral nodes: its print under the illuminant (`white`), or (#745) lit by `light`; read in frame units (#761). */
  function sceneOf(context: LayeredRequestContext, k: number, wavelengths: readonly number[], white: Float64Array, light: ResolvedMixedIllumination | undefined): DisplayViewScene {
    const shape = { wavelengthsNm: wavelengths, siteFrameUnits: 2 / context.width * c, metresPerFrameUnit: context.metresPerFrameUnit / c, referenceDistanceM: context.subjectDistanceM };
    const surface = resolved.surfaces[k]!, scene: DisplayViewScene = light ? layeredLitSurfaceScene(surface, { ...shape, illumination: light }) :
      layeredSurfaceScene(surface, { ...shape, whiteRadiance: white });
    if (c === 1) return scene;
    if (scene.kind === "materials") return { ...scene, materialAt: (u, v) => scene.materialAt(u * c, v * c) };
    return { kind: "radiance", radianceAt: (u, v, nm) => scene.radianceAt(u * c, v * c, nm), radianceSpectrumAt: (u, v, w, out) => scene.radianceSpectrumAt!(u * c, v * c, w, out) };
  }
  /**
   * The layers at the spectral nodes; with `view`, each surface's single-plane input for the sites that see it alone (omitted under a
   * lens map, where each surface's single-plane signal would not read the lens: every site then takes the sum).
   */
  function layersOf(context: LayeredRequestContext, wavelengths: readonly number[], white: Float64Array, diffraction: { radius: number; perNode: readonly Float64Array[] } | undefined,
    light: ResolvedMixedIllumination | undefined, view?: Parameters<LayeredRequest["view"]>[1]): LayeredSceneLayer[] {
    const { nativeWidth, nativeHeight, width } = context, single = view && !context.lensGeometry;
    return surfaces.map((surface, k): LayeredSceneLayer => {
      const scene = sceneOf(context, k, wavelengths, white, light);
      const { kernel, zones } = kernels![k]!, R = kernel ? kernel.radius : 0, Rd = diffraction ? diffraction.radius : 0;
      // In focus a unit tap (or the diffraction kernels), so the single-plane input reads the lattice formula as the sum does.
      const perNode = single ? wavelengths.map((_, n) => (diffraction && kernel ? convolveSiteKernels(diffraction.perNode[n]!, Rd, kernel.weights, R) : diffraction ? diffraction.perNode[n]! :
        kernel ? kernel.weights : UNIT)) : [];
      return { rect: surface.rect, blurRadiusSites: depths![k]!.signedBlurRadiusSites, scene, kernel, ...(zones ? { zones } : {}),
        ...(single ? { signalInput: { nativeWidth, nativeHeight, outputWidth: width, wavelengthsNm: wavelengths, electronsPerRadiance: view.perNode, offsets: view.offsets,
          kernels: { radius: R + Rd, perNode }, scene, channelAt: view.channelAt } } : {}) };
    });
  }
  /**
   * The lattice's input. With `mapped` and a lens geometry (#744): the lens map, and as `marginSites` the reach of the readers beyond the
   * raster's outer site centres (the query offsets and the diffraction kernel); a fisheye is checked against the 75° limit there.
   */
  function latticeInputOf(context: LayeredRequestContext, wavelengths: readonly number[], layers: LayeredSceneLayer[], diffraction: { radius: number; perNode: readonly Float64Array[] } | undefined,
    offsets: readonly { x: number; y: number }[], mapped: boolean): Parameters<typeof createLayeredSceneLattice>[0] {
    const map = mapped ? lensMapOf(context) : undefined;
    const input: Parameters<typeof createLayeredSceneLattice>[0] = { nativeWidth: context.nativeWidth, nativeHeight: context.nativeHeight, outputWidth: context.width, wavelengthsNm: wavelengths, layers,
      occlusionSamples: LAYERED_OCCLUSION_SAMPLES[context.viewFast.layers ? "fast" : "full"], ...(diffraction ? { diffraction } : {}),
      ...(map ? { lensMap: map, marginSites: Math.ceil(Math.max(0, ...offsets.map((o) => Math.max(Math.abs(o.x), Math.abs(o.y))))) + 1 + (diffraction ? diffraction.radius : 0) } : {}) };
    // A point outside a caller fisheye's image circle has no ray (the projection fails there): it counts as looking backward.
    const geometry = context.lensGeometry!, backward = { x: 0, y: 0, z: -1 };
    if (map && fisheye) checkLayeredFisheyeFieldAngle({ geometry: { lookOf: (x, y, t) => { try { return geometry.lookOf(x, y, t); } catch { return backward; } } }, pitchMicrometers: context.pitch, nativeWidth: context.nativeWidth, nativeHeight: context.nativeHeight,
      reachSites: createLayeredLatticeGeometry(input).lensReachSites });
    return input;
  }
  function lattice(context: LayeredRequestContext, wavelengths: readonly number[], white: Float64Array, diffraction: { radius: number; perNode: readonly Float64Array[] } | undefined,
    offsets: readonly { x: number; y: number }[], mapped: boolean, light: ResolvedMixedIllumination | undefined): LayeredSceneLattice {
    return createLayeredSceneLattice(latticeInputOf(context, wavelengths, layersOf(context, wavelengths, white, diffraction, light), diffraction, offsets, mapped));
  }
  return request;
}

/** A centred card filling the frame, without a depth label, and no back plane: the card's chart is the frame's chart. */
function singlePlaneChart(scene: LayeredChartScene, aspect: number): boolean {
  const card = scene.cards[0]!;
  return scene.cards.length === 1 && scene.backPlane === undefined && card.depthLabel !== true && card.centerU === 0 && card.centerV === 0 && card.width === 2 &&
    Math.abs(card.height - 2 * aspect) <= 1e-12 * aspect;
}

/**
 * Each surface's kernel (see the module comment). #749: every surface's kernel radius is checked against the layered sum's edge bound
 * (`LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites`: the disc's 512, a shaped kernel's 128) before any kernel is built.
 */
function surfaceKernels(context: LayeredRequestContext, depths: readonly LayeredChartDepth[]): SurfaceKernel[] {
  const { nativeWidth, nativeHeight, width, pitch, focalLengthMm, fNumber, focusDistanceM, defocusBokeh: options } = context;
  const sideOf = (depth: LayeredChartDepth): 1 | -1 => (depth.distanceM > focusDistanceM ? 1 : -1), bound = LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites;
  for (const depth of depths) {
    const c = depth.defocusDiameterSites;
    if (!(c > 0)) continue;
    if (!options) {
      if (defocusDiscKernelRadius(c) > bound.disc) fail("lens.defocus: " + defocusDiscLimitMessage(c));
      continue;
    }
    let R: number;
    try { R = defocusBokehKernelRadius({ diameterSites: c, side: sideOf(depth), fNumber, focalLengthMm, pitchMicrometers: pitch, options }); } catch (error) {
      const message = (error as Error).message; return fail(message.startsWith("lens.defocus") ? message : "lens.defocus: " + message);
    }
    if (R > bound.shaped) fail("lens.defocus: a surface's blur needs a kernel radius of " + R + " sites; at card edges the layered sum takes at most " + bound.shaped +
      " for a shaped kernel (LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites). Reduce the defocus or the f-number's aperture.");
  }
  return depths.map((depth): SurfaceKernel => {
    const c = depth.defocusDiameterSites;
    if (!(c > 0)) return { kernel: null };
    if (!options) {
      const disc = createDefocusDiscSiteKernel(c);
      return { kernel: disc && { radius: disc.radius, weights: disc.weights } };
    }
    const side = sideOf(depth), kit = loadedKit(qualityKit);
    const build = (field?: { x: number; y: number }): DefocusBokehSiteKernel => {
      try {
        return kit[QK_CREATE_DEFOCUS_BOKEH_SITE_KERNEL]({ diameterSites: c, side, fNumber, focalLengthMm, pitchMicrometers: pitch, options, ...(field ? { field } : {}) });
      } catch (error) { const message = (error as Error).message; return fail(message.startsWith("lens.defocus") ? message : "lens.defocus: " + message); }
    };
    const axis = build();
    if (!options.catsEye) return { kernel: { radius: axis.radius, weights: axis.weights, shaped: true } };
    // The field tangent of a native point (sites from the top-left corner), output-image axes (+Y up), on the planar lattice.
    const g = 2 / width, tangent = g * context.metresPerFrameUnit / context.subjectDistanceM;
    const plan = kit[QK_PLAN_DEFOCUS_BOKEH_ZONES]({ options, nativeWidth, nativeHeight, radius: axis.radius, fNumber, focalLengthMm,
      fieldOf: (x, y) => ({ x: (x - nativeWidth / 2) * tangent, y: -(y - nativeHeight / 2) * tangent }), kernelAt: build });
    if (!(plan.minimumOpenAreaRatio > 0)) fail("lens.defocus.catsEye: the clipping apertures close the pupil in part of the frame; reduce shiftPerTanFieldMm or enlarge radiusMm.");
    return { kernel: { radius: axis.radius, weights: axis.weights, shaped: true }, zones: plan.zones };
  });
}

function whiteOf(context: LayeredRequestContext, wavelengths: readonly number[]): Float64Array {
  return Float64Array.from(wavelengths, (nm) => context.irradianceScale * context.illuminant.shape.evaluate(nm) / Math.PI);
}
/** Each node's in-focus diffraction kernel on the site lattice, as the capture's object-space convolution builds it. */
function diffractionOf(context: LayeredRequestContext, wavelengths: readonly number[]): { radius: number; perNode: Float64Array[] } | undefined {
  const d = context.diffraction;
  if (!d) return undefined;
  const radius = d.kernelRadiusSamples, psf = context.diffractionPsf!.configuration.psf as never;
  return { radius, perNode: wavelengths.map((nm) => {
    if (!d.profile.axes.wavelengthNm.includes(nm)) fail("simulateCapture: a spectral node has no diffraction kernel.");
    return loadedKit(qualityKit)[QK_SITE_DIFFRACTION_KERNEL](psf, nm, context.pitch, radius, "simulateCapture: diffraction kernels must sample the site pitch exactly.");
  }) };
}
function providerOf(context: LayeredRequestContext, lattice: LayeredSceneLattice, wavelengthsNm: readonly number[], queryOffsetsSites: readonly { x: number; y: number }[]):
  PlanarSceneRadianceProvider {
  return createLayeredSceneProvider({ base: context.provider, lattice, wavelengthsNm,
    nativeWidth: context.nativeWidth, nativeHeight: context.nativeHeight, outputWidth: context.width, distanceM: context.subjectDistanceM,
    metresPerFrameUnit: context.metresPerFrameUnit, queryOffsetsSites });
}
