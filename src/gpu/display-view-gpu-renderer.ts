// SPDX-License-Identifier: Apache-2.0

/**
 * The display view's GPU renderer (#478, #479, #481): the Speed kernel for the requests it covers and the Quality kernels for the
 * rest, behind one `DisplayViewGpuRenderer`. #594: the Quality host and its WGSL (`display-view-quality-gpu.ts`,
 * `wgsl-display-view-quality-kernel.ts`) load on demand, at the first render that takes the Quality passes, so a page that only
 * renders Speed views never downloads them. That render first runs the Quality kernels' self-check cases (the renderer's
 * `onDemandConformanceCases`); every Speed render runs only the Speed case before the device's first render. The Quality code,
 * its results and its bounds are unchanged; `prepareDisplayViewQualityGpu()` loads it ahead of time.
 *
 * #655 (G1), #661: a still catalogue-lens view (the request's `lensView`, the setup's `gpu.lens`) takes the Quality passes with the lens
 * passes of `display-view-lens-gpu.ts`, their own chunk, which the Quality host loads at the first such view, and their own self-check case.
 */

import type { DisplayViewRenderResult, DisplayViewSetup } from "../facade/display-view.js";
import { createDisplayViewMaterialModules } from "./display-view-composite-material-module.js";
import { setDisplayViewGpuRendererFactory, type DisplayViewGpuConformanceCase, type DisplayViewGpuPart, type DisplayViewGpuRenderOutput, type DisplayViewGpuRenderer,
  type DisplayViewGpuRendererFactory, type DisplayViewGpuRequest, type DisplayViewGpuRuntimeHandle, type DisplayViewLensGpuInput } from "../facade/display-view-gpu.js";
import { DISPLAY_VIEW_SPEED_CONFORMANCE_CASE, LARGE_DEFOCUS_REASON, sceneToneAndOffsetsReason, displayViewSpeedGpuSupports, displayViewSpeedGpuUnsupportedReason, renderDisplayViewSpeedOnGpu,
  type DisplayViewGpuMaterialModule } from "./display-view-speed-gpu.js";
import { ImageKernelExecutionError, type ImageKernelExecution, type ImageKernelRelativeErrorBound } from "./image-kernel-execution.js";
import { abortedError, createComputePipeline, type WebGpuRuntime } from "./webgpu-runtime.js";
import type { DisplayViewLensGpu } from "./display-view-lens-gpu.js";

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;
type YieldControl = ((signal: AbortSignal) => Promise<void>) | undefined;
/** #658: the three exports the renderer reads; a destructured import lets the chunk drop the other export names. #661: and the lens loader. */
type QualityKit = Pick<typeof import("./display-view-quality-gpu.js"), "DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES" | "qualityMaterialModule" | "renderDisplayViewQualityOnGpu" | "loadDisplayViewLensGpu">;

/** Largest lattice group count the Quality tables hold (`display-view-quality-gpu.ts`). */
const QUALITY_MAXIMUM_GROUPS = 64;

const importQualityKit = async (): Promise<QualityKit> => {
  const [DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES, qualityMaterialModule, renderDisplayViewQualityOnGpu, loadDisplayViewLensGpu] = (await import("./display-view-quality-gpu.js")).QUALITY_GPU_KIT;
  return { DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES, qualityMaterialModule, renderDisplayViewQualityOnGpu, loadDisplayViewLensGpu };
};
let loadQualityKit: () => Promise<QualityKit> = importQualityKit;
let qualityKit: Promise<QualityKit> | null = null;
/**
 * #594: loads the Quality host once (a dynamic import, its own chunk in a bundler that splits) and returns it; concurrent calls
 * share one load. A failed load rejects with `ImageKernelExecutionError` reason `quality-code-unavailable` and is not
 * remembered, so the next call (a later Quality render, or `prepareQualityPaths()`) tries again.
 */
export function prepareDisplayViewQualityGpu(): Promise<QualityKit> {
  if (!qualityKit) {
    const pending = Promise.resolve().then(loadQualityKit).catch((error: unknown) => {
      if (qualityKit === pending) qualityKit = null;
      throw new ImageKernelExecutionError("quality-code-unavailable", "GPU full-quality code did not load: " + String(error));
    });
    qualityKit = pending;
  }
  return qualityKit;
}
/** #661: the catalogue-lens passes (their chunk, through the Quality host); a failed load is `quality-code-unavailable`, and the next render loads again. */
const loadLens = (kit: QualityKit): Promise<DisplayViewLensGpu> => kit.loadDisplayViewLensGpu().catch((error: unknown) => {
  throw new ImageKernelExecutionError("quality-code-unavailable", "GPU catalogue-lens code did not load: " + String(error));
});
/** #655 (G1): the lens input of a setup (`DisplayViewGpuSetup.lens`), or undefined. */
const lensOf = (setup: DisplayViewSetup): DisplayViewLensGpuInput | undefined => (setup.gpu as { lens?: DisplayViewLensGpuInput } | undefined)?.lens;

/**
 * #655 (G1): why the lens passes do not take a lens request (`request.lens`), or true: a still, rectilinear catalogue-lens view in
 * field zones without the veiling glare, then the Quality path's own scene, tone-curve and offset rules. Whether the lens's geometry
 * is the model the passes evaluate, and the frame's own limits, are known per render.
 */
export function displayViewLensGpuSupports(request: DisplayViewGpuRequest): true | string {
  const view = request.lensView;
  if (!view) return "lens.projection, lens.distortion, lens.vignetting and camera rotation run on the CPU (#563)";
  if (!view.catalogueZones) return "the GPU lens passes take a catalogue lens's PSF in field zones (lens.catalogue, the fast method); lens.projection, lens.distortion or lens.vignetting alone and fast: false run on the CPU";
  if (!view.still) return "camera rotation, hand shake and a moving subject through a catalogue lens run on the CPU";
  if (!view.rectilinear) return "a fisheye catalogue lens runs on the CPU";
  if (view.flare) return "lens.catalogue.flare runs on the CPU";
  if (request.largeDefocus) return LARGE_DEFOCUS_REASON;
  if (request.scene !== "chart" && request.scene !== "material-layers") return "the GPU lens passes classify engine charts and declared material-layers scenes";
  return displayViewQualityGpuSupports(request);
}

/**
 * Internal, for tests: replaces how the Quality host is loaded (null restores the dynamic import) and forgets a loaded one,
 * so a test can make the load fail and then succeed. Returns nothing; the engine never calls it.
 */
export function setDisplayViewQualityGpuLoader(loader: (() => Promise<QualityKit>) | null): void {
  loadQualityKit = loader ?? importQualityKit;
  qualityKit = null;
}

/**
 * Why the Quality renderer does not support a prepared request (`DisplayViewGpuRenderer.supports`), or true: engine charts and
 * declared `material-layers` scenes (the material modules of `createDisplayViewMaterialModules`, #491), the identity or Reinhard
 * tone curve and at most 64 query offsets (lattice groups). `lens.defocus` out of focus is supported (#492 step 2c: the site pass
 * gathers the disc, or each node's diffraction kernel convolved with it, up to the reference's own caps of radius 64 and 96);
 * whether a view's footprints take the exact area mean, whether the device passes the composite probe, and whether the kernel
 * table fits the device's storage binding limit, is known only per render.
 */
export function displayViewQualityGpuSupports(request: DisplayViewGpuRequest): true | string {
  return sceneToneAndOffsetsReason(request, QUALITY_MAXIMUM_GROUPS);
}

/**
 * The display view's GPU renderer on one runtime (#481's `DisplayViewGpuRenderer`): the Speed kernel for requests it covers
 * (no diffraction, no AHD, no defocus disc, at most 16 offsets) and the Quality kernels for the rest (#492: a defocused Speed
 * request too, with its bilinear demosaic). One pipeline cache per device, one set of
 * material modules (#491: chart presets, composite charts, the 2.3 elements and material-layers scenes; `dispose` releases their
 * uploaded scene records). `render` renders the part's region (`setup.gpu`
 * carries the expected signal's input and the chart; a setup without it, a coarse view or a frame the kernels do not cover
 * throws `unsupported-on-backend`), and throws `aborted` and `device-lost` as the accelerator's operations do. The Quality host
 * is loaded on demand (#594, `prepareDisplayViewQualityGpu`).
 */
export function createDisplayViewGpuRenderer(runtime: WebGpuRuntime, options: { maximumBandBytes?: number; yieldControl?: YieldControl } = {}): DisplayViewGpuRenderer {
  const bandBytes = options.maximumBandBytes ?? Math.min(64 * 1024 * 1024, runtime.maximumStorageBindingBytes);
  // The device's pipeline cache (createComputePipeline, gpu-04 in #702): shared with the self-checks, so each shader compiles once;
  // #692: a kernel the device did not compile stays failed for this device, so later renders fall back without compiling it again.
  const source: PipelineSource = (label, code) => createComputePipeline(runtime, label, code);
  // #491: one set of material modules per device for both kernels (the preset module per chart; the composite module, its probe
  // and its uploaded scene records), released by `dispose`.
  const modules = createDisplayViewMaterialModules(runtime, source);
  return {
    id: "photivra-display-view",
    supports(request: DisplayViewGpuRequest): true | string {
      if (request.lens) return displayViewLensGpuSupports(request);
      if (request.largeDefocus) return LARGE_DEFOCUS_REASON;
      // #492: out of focus the expected signal carries the defocus disc as site kernels, which only the Quality site pass gathers;
      // a Speed request then runs the Quality passes with its own bilinear demosaic (one candidate) and finishing.
      if (request.defocus) return displayViewQualityGpuSupports(request);
      const speed = displayViewSpeedGpuSupports(request);
      if (speed === true) return true;
      return displayViewQualityGpuSupports(request);
    },
    // #594 (owner, 2026-11-10): the Speed case runs before the device's first render; the Quality cases run before the first
    // render that takes the Quality passes, after their code has loaded.
    conformanceCases: [DISPLAY_VIEW_SPEED_CONFORMANCE_CASE],
    onDemandConformanceCases(setup: DisplayViewSetup): Promise<readonly DisplayViewGpuConformanceCase[]> | null {
      // The routing of `render` below: a setup the Speed kernel does not cover takes the Quality passes; #655: a lens view adds its own case.
      if (setup.gpu && lensOf(setup)) return prepareDisplayViewQualityGpu().then(async (kit) => [...kit.DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES, (await loadLens(kit)).displayViewLensConformanceCase(modules.probe)]);
      return setup.gpu && displayViewSpeedGpuUnsupportedReason(setup, setup.gpu.signalInput) !== null ? prepareDisplayViewQualityGpu().then((kit) => kit.DISPLAY_VIEW_QUALITY_CONFORMANCE_CASES) : null;
    },
    async render(part: DisplayViewGpuPart): Promise<DisplayViewGpuRenderOutput> {
      const { setup, signal } = part;
      if (!setup.gpu) throw new ImageKernelExecutionError("unsupported-on-backend", "The display-view setup carries no GPU inputs (setup.gpu); use cpu-reference.");
      const abort = new AbortController(), onAbort = (): void => abort.abort();
      if (signal?.aborted) throw abortedError();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const signalInput = setup.gpu.signalInput;
        let result: DisplayViewRenderResult & { expectedValueBound: ImageKernelRelativeErrorBound; execution: ImageKernelExecution };
        let material: DisplayViewGpuMaterialModule;
        const lensInput = lensOf(setup);
        if (lensInput) {
          // #655 (G1): the lens passes (passes 1 and 2) with the Quality host's pass 3, finishing and recomputation.
          const kit = await prepareDisplayViewQualityGpu();
          const passes = await (await loadLens(kit)).createDisplayViewLensPasses(runtime, setup, lensInput, source, modules.probe, abort.signal);
          material = { id: "catalogue-lens", wgsl: "", bindings: [], compositeProbe: passes.probe };
          result = await kit.renderDisplayViewQualityOnGpu(runtime, bandBytes, { setup, signalInput, material, lens: passes }, abort, options.yieldControl, source);
        } else if (displayViewSpeedGpuUnsupportedReason(setup, signalInput) === null) {
          material = await modules.moduleFor(setup.gpu, abort.signal);
          result = await renderDisplayViewSpeedOnGpu(runtime, bandBytes, { setup, signalInput, material }, abort, options.yieldControl, source);
        } else {
          const kit = await prepareDisplayViewQualityGpu();
          // #581: an image-plane print brings its own passes 1 and 2.
          const image = (signalInput.scene as { image?: unknown }).image ? await modules.imagePasses(setup.gpu, abort.signal) : undefined;
          material = image ? { id: "image-plane", wgsl: "", bindings: [] } : await kit.qualityMaterialModule(modules, setup.gpu, abort.signal);
          result = await kit.renderDisplayViewQualityOnGpu(runtime, bandBytes, { setup, signalInput, material, ...(image ? { image } : {}) }, abort, options.yieldControl, source);
        }
        return { samples: result.samples, expected: result.expected, noiseStd: result.noiseStd, sampleCount: result.sampleCount, siteCount: result.siteCount, detailPixelCount: result.detailPixelCount,
          uniformPixelCount: result.uniformPixelCount, estimation: result.estimation, saturated: result.saturated,
          saturatedPixelCount: result.saturatedPixelCount, errorBound: result.expectedValueBound,
          diagnosticUncertaintySampleCount: result.execution.diagnosticUncertaintySampleCount, ...(material.compositeProbe ? { compositeProbe: material.compositeProbe } : {}) };
      } finally { signal?.removeEventListener("abort", onAbort); }
    },
    dispose(): void { modules.release(); }
  };
}

/** The factory `prepareDisplayView` creates the renderer with (one per device): the Speed and Quality kernels behind one renderer. */
export const displayViewGpuRendererFactory: DisplayViewGpuRendererFactory = (handle: DisplayViewGpuRuntimeHandle) => createDisplayViewGpuRenderer(handle as WebGpuRuntime);

/** Registers the combined renderer as the display view's GPU renderer and returns the factory registered before. */
export function registerDisplayViewGpuRenderer(): DisplayViewGpuRendererFactory | null {
  return setDisplayViewGpuRendererFactory(displayViewGpuRendererFactory);
}
