// SPDX-License-Identifier: Apache-2.0

/**
 * The facade's wiring of layered chart scenes (#652; docs/LAYERED_SCENES.md), loaded on demand: `simulate-capture.ts` imports it
 * only for a request whose `scene.kind` is `"layered-chart"`, so default captures and views carry none of it.
 *
 * - Request: the 2.27.0 refusals, the scene (`resolveLayeredChartScene` for the frame's aspect) and the route. One card without a
 *   back plane is a single-plane chart scene: a centred card filling the frame (width 2, height 2·aspect, no depth label) passes
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
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { convolveSiteKernels, createDefocusDiscSiteKernel } from "../optics/defocus-disc-kernel.js";
import type { DefocusBokehSiteKernel, ResolvedDefocusBokehOptions } from "../optics/defocus-bokeh-kernel.js";
import type { SiteKernelFieldZones } from "./diffraction-provider.js";
import type { DisplayViewExpectedSignal, DisplayViewQueryOffset } from "./expected-signal.js";
import { loadedKit, qualityKit } from "./on-demand-kits.js";
import type { PlanarSceneRadianceProvider, ResolvedCallerMaterialScene } from "./scene-radiance.js";
import type { DiffractionLimitedPsfProfile } from "../optics/diffraction-psf-profile.js";
import type { SimulateCaptureAssumption } from "./simulate-capture.js";
import { layeredChartDepths, layeredSurfaceScene, resolveLayeredChartScene, type LayeredChartDepth, type LayeredChartScene,
  type ResolvedLayeredChartScene } from "./layered-chart-scene.js";
import { LAYERED_OCCLUSION_SAMPLES, createLayeredSceneLattice, createLayeredSceneSignal, type LayeredSceneLattice, type LayeredSceneLayer } from "./layered-scene-signal.js";
import { createLayeredSceneProvider } from "./layered-scene-provider.js";

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
}

/** One surface's kernel: the disc or shaped kernel (null in focus) and, with a cat's eye, its field zones. */
interface SurfaceKernel { kernel: { radius: number; weights: Float64Array } | null; zones?: SiteKernelFieldZones }

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

/** The options layered scenes refuse in 2.27.0: [request path, present, reason]. */
function refusals(top: Record<string, unknown>, lens: Record<string, unknown>): [string, boolean, string][] {
  const motion = typeof top.motion === "object" && top.motion !== null ? Object.keys(top.motion) : [];
  return [
    ["motion" + (motion.length > 0 ? "." + motion[0] : ""), top.motion !== undefined && motion.length > 0, "each surface's defocus and occlusion are rendered for a still camera and scene"],
    ["lens.projection other than \"rectilinear\"", lens.projection !== undefined && lens.projection !== "rectilinear", "the layered sum maps every surface through the rectilinear lens"],
    ["lens.distortion", lens.distortion !== undefined, "the layered sum maps every surface through the distortion-free lens"],
    ["lens.vignetting", lens.vignetting !== undefined, "the layered sum takes one radiance-to-irradiance factor over the field"],
    ["lens.catalogue", lens.catalogue !== undefined, "a catalogue lens has its own distortion, vignetting and PSF"],
    ["lens.pupilSampling", lens.pupilSampling !== undefined, "the layered sum renders the defocus and occlusion of each surface itself"],
    ["lens.psf", lens.psf !== undefined, "a caller PSF declares its own defocus"],
    ["chartSize", top.chartSize !== undefined, "cards are placed in frame units, each at its own size"],
    ["illumination (mixed lighting)", top.illumination !== undefined, "every surface is lit by the one illuminant"]];
}

/** Validates and resolves a layered request (see the module comment). */
export function resolveLayeredRequest(input: { top: Record<string, unknown>; lens: Record<string, unknown>; aspect: number; displayView: boolean }): LayeredRequest {
  const { top, lens, aspect } = input;
  for (const [option, present, reason] of refusals(top, lens)) if (present) fail("scene.kind \"layered-chart\" does not support " + option + " in 2.27.0: " + reason + ". Omit it, or use a single-plane scene.");
  const scene = top.scene as LayeredChartScene, resolved = resolveLayeredChartScene({ scene, aspect }), surfaces = resolved.surfaces;
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
    ...(singlePlaneChart(scene, aspect) ? { sceneOption: scene.cards[0]!.scene } : { callerScene }),
    report(context) {
      const { width, height, pitch, focalLengthMm, fNumber, focusDistanceM } = context;
      const circleOfConfusionMm = Math.hypot(width, height) * pitch / 1000 / 1500;
      depths = layeredChartDepths(resolved, { focalLengthMm, aperture: fNumber, focusDistanceM, circleOfConfusionMm, pixelPitchMicrometers: pitch });
      // The single-plane route resolves lens.defocus itself (a "model" record); only the layered sum records the implied default.
      if (lens.defocus === undefined && request.multi) context.assume("lens.defocus", "default", { model: "geometric-disc" },
        "A layered chart scene implies lens.defocus { model: \"geometric-disc\" }: each surface is blurred by the thin-lens disc of its own distance.");
      if (request.multi) kernels = surfaceKernels(context, depths);
      const fast = context.viewFast.layers, samples = LAYERED_OCCLUSION_SAMPLES[fast ? "fast" : "full"];
      context.assume("scene.layers", "model", { surfaces: depths.length, circleOfConfusionMm, execution: request.multi ? "layered-sum" : "single-plane",
        ...(request.multi ? { occlusionSamples: samples, fast, kernelRadiusSites: kernels!.map((k) => (k.kernel ? k.kernel.radius : 0)), catsEye: kernels!.some((k) => k.zones !== undefined) } : {}) },
      "Layered chart scene (#652, docs/LAYERED_SCENES.md): " + (request.multi ?
        "opaque fronto-parallel cards in front of " + (surfaces[surfaces.length - 1]!.kind === "back-plane" ? "a back plane" : "the farthest card") + ", seen through a thin lens (geometric optics). " +
        "Each surface is blurred by its own kernel at its distance (the disc, or the shaped kernel of the bokeh options), and each kernel tap's pupil region counts only the share of its rays " +
        "that reach the surface past every nearer card, integrated in rows (exact along each row; " + samples + " rows per site of footprint" +
        (fast ? ", the fast method; fast: false takes " + LAYERED_OCCLUSION_SAMPLES.full + ")." : ", the full method)." ) +
        " Sites whose lattice points all see one surface take that surface's single-plane sum. Every site integrates its spectra against its own channel response; with lens.diffraction " +
        "each node's diffraction kernel follows the sum (the single-plane path's approximation, per layer). No light scattered between surfaces; flat, opaque Lambertian cards." :
        "one card without a back plane is a single-plane chart scene, rendered on the single-plane path at the card's distance.") +
      " scene.layers reports each surface's distance, blur diameter and whether it lies within the depth of field at the circle of confusion of the frame's diagonal / 1500.");
      request.scene = { layers: depths };
    },
    provider(context) {
      const wavelengths = context.axisChannelResponse("simulateCapture").wavelengths;
      return providerOf(context, lattice(context, wavelengths, whiteOf(context, wavelengths), diffractionOf(context, wavelengths), context.viewFast.layers), wavelengths, context.queryOffsetsSites);
    },
    reference(context) {
      const wavelengths = context.axisChannelResponse("simulateIdealReference").wavelengths, n = context.boxSamples;
      const nodes = Array.from({ length: n * n }, (_, i) => ({ x: (i % n + 0.5) / n - 0.5, y: (Math.floor(i / n) + 0.5) / n - 0.5 }));
      return providerOf(context, lattice(context, wavelengths, whiteOf(context, wavelengths), undefined, context.viewFast.layers), wavelengths, nodes);
    },
    view(context, input) {
      const layers = layersOf(context, input.wavelengths, input.white, input.diffraction, input);
      const latticeInput = { ...latticeInputOf(context, input.wavelengths, layers, input.diffraction, context.viewFast.layers), offsets: input.offsets,
        electronsPerRadiance: input.perNode, channelAt: input.channelAt };
      return { reach: Math.max(0, ...kernels!.map((k) => (k.kernel ? k.kernel.radius : 0))), signal: () => createLayeredSceneSignal(latticeInput, createLayeredSceneLattice(latticeInput)) };
    }
  };
  /** The layers at the spectral nodes; with `view`, each surface's single-plane input for the sites that see it alone. */
  function layersOf(context: LayeredRequestContext, wavelengths: readonly number[], white: Float64Array, diffraction: { radius: number; perNode: readonly Float64Array[] } | undefined,
    view?: Parameters<LayeredRequest["view"]>[1]): LayeredSceneLayer[] {
    const { nativeWidth, nativeHeight, width } = context;
    return surfaces.map((surface, k): LayeredSceneLayer => {
      const scene = layeredSurfaceScene(surface, { wavelengthsNm: wavelengths, whiteRadiance: white, siteFrameUnits: 2 / width, metresPerFrameUnit: context.metresPerFrameUnit,
        referenceDistanceM: context.subjectDistanceM });
      const { kernel, zones } = kernels![k]!, R = kernel ? kernel.radius : 0, Rd = diffraction ? diffraction.radius : 0;
      // In focus a unit tap (or the diffraction kernels), so the single-plane input reads the lattice formula as the sum does.
      const perNode = wavelengths.map((_, n) => (diffraction && kernel ? convolveSiteKernels(diffraction.perNode[n]!, Rd, kernel.weights, R) : diffraction ? diffraction.perNode[n]! :
        kernel ? kernel.weights : UNIT));
      return { rect: surface.rect, blurRadiusSites: depths![k]!.signedBlurRadiusSites, scene, kernel, ...(zones ? { zones } : {}),
        ...(view ? { signalInput: { nativeWidth, nativeHeight, outputWidth: width, wavelengthsNm: wavelengths, electronsPerRadiance: view.perNode, offsets: view.offsets,
          kernels: { radius: R + Rd, perNode }, scene, channelAt: view.channelAt } } : {}) };
    });
  }
  function latticeInputOf(context: LayeredRequestContext, wavelengths: readonly number[], layers: LayeredSceneLayer[], diffraction: { radius: number; perNode: readonly Float64Array[] } | undefined,
    fast: boolean): Parameters<typeof createLayeredSceneLattice>[0] {
    return { nativeWidth: context.nativeWidth, nativeHeight: context.nativeHeight, outputWidth: context.width, wavelengthsNm: wavelengths, layers,
      occlusionSamples: LAYERED_OCCLUSION_SAMPLES[fast ? "fast" : "full"], ...(diffraction ? { diffraction } : {}) };
  }
  function lattice(context: LayeredRequestContext, wavelengths: readonly number[], white: Float64Array, diffraction: { radius: number; perNode: readonly Float64Array[] } | undefined,
    fast: boolean): LayeredSceneLattice {
    return createLayeredSceneLattice(latticeInputOf(context, wavelengths, layersOf(context, wavelengths, white, diffraction), diffraction, fast));
  }
  return request;
}

/** A centred card filling the frame, without a depth label, and no back plane: the card's chart is the frame's chart. */
function singlePlaneChart(scene: LayeredChartScene, aspect: number): boolean {
  const card = scene.cards[0]!;
  return scene.cards.length === 1 && scene.backPlane === undefined && card.depthLabel !== true && card.centerU === 0 && card.centerV === 0 && card.width === 2 &&
    Math.abs(card.height - 2 * aspect) <= 1e-12 * aspect;
}

/** Each surface's kernel (see the module comment); fails for a kernel the layered sum cannot take at card edges. */
function surfaceKernels(context: LayeredRequestContext, depths: readonly LayeredChartDepth[]): SurfaceKernel[] {
  const { nativeWidth, nativeHeight, width, pitch, focalLengthMm, fNumber, focusDistanceM, defocusBokeh: options } = context;
  return depths.map((depth): SurfaceKernel => {
    const c = depth.defocusDiameterSites;
    if (!(c > 0)) return { kernel: null };
    if (!options) {
      const disc = createDefocusDiscSiteKernel(c);
      return { kernel: disc && { radius: disc.radius, weights: disc.weights } };
    }
    const side = depth.distanceM > focusDistanceM ? 1 : -1, kit = loadedKit(qualityKit);
    const build = (field?: { x: number; y: number }): DefocusBokehSiteKernel => {
      try {
        return kit.createDefocusBokehSiteKernel({ diameterSites: c, side, fNumber, focalLengthMm, pitchMicrometers: pitch, options, ...(field ? { field } : {}) });
      } catch (error) { const message = (error as Error).message; return fail(message.startsWith("lens.defocus") ? message : "lens.defocus: " + message); }
    };
    const axis = build();
    if (!options.catsEye) return { kernel: { radius: axis.radius, weights: axis.weights } };
    // The field tangent of a native point (sites from the top-left corner), output-image axes (+Y up), on the planar lattice.
    const g = 2 / width, tangent = g * context.metresPerFrameUnit / context.subjectDistanceM;
    const plan = kit.planDefocusBokehZones({ options, nativeWidth, nativeHeight, radius: axis.radius, fNumber, focalLengthMm,
      fieldOf: (x, y) => ({ x: (x - nativeWidth / 2) * tangent, y: -(y - nativeHeight / 2) * tangent }), kernelAt: build });
    if (!(plan.minimumOpenAreaRatio > 0)) fail("lens.defocus.catsEye: the clipping apertures close the pupil in part of the frame; reduce shiftPerTanFieldMm or enlarge radiusMm.");
    return { kernel: { radius: axis.radius, weights: axis.weights }, zones: plan.zones };
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
    return loadedKit(qualityKit).siteDiffractionKernel(psf, nm, context.pitch, radius, "simulateCapture: diffraction kernels must sample the site pitch exactly.");
  }) };
}
function providerOf(context: LayeredRequestContext, lattice: LayeredSceneLattice, wavelengthsNm: readonly number[], queryOffsetsSites: readonly { x: number; y: number }[]):
  PlanarSceneRadianceProvider {
  return createLayeredSceneProvider({ base: context.provider, lattice, wavelengthsNm,
    nativeWidth: context.nativeWidth, nativeHeight: context.nativeHeight, outputWidth: context.width, distanceM: context.subjectDistanceM,
    metresPerFrameUnit: context.metresPerFrameUnit, queryOffsetsSites });
}
