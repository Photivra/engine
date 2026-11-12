// SPDX-License-Identifier: Apache-2.0

/**
 * The display view's GPU renderer (#478, #479, #481): the Speed kernel for the requests it covers and the Quality kernels for the
 * rest, behind one `DisplayViewGpuRenderer`. #594: the Quality host and its WGSL (`display-view-quality-gpu.ts`,
 * `wgsl-display-view-quality-kernel.ts`) load on demand, at the first render that takes the Quality passes, so a page that only
 * renders Speed views never downloads them. That render first runs the Quality kernels' self-check cases (the renderer's
 * `onDemandConformanceCases`); every Speed render runs only the Speed case before the device's first render. The Quality code,
 * its results and its bounds are unchanged; `prepareDisplayViewQualityGpu()` loads it ahead of time.
 */

import type { DisplayViewRenderResult, DisplayViewSetup } from "../facade/display-view.js";
import { createDisplayViewMaterialModules } from "./display-view-composite-material-module.js";
import { setDisplayViewGpuRendererFactory, type DisplayViewGpuConformanceCase, type DisplayViewGpuPart, type DisplayViewGpuRenderOutput, type DisplayViewGpuRenderer,
  type DisplayViewGpuRendererFactory, type DisplayViewGpuRequest, type DisplayViewGpuRuntimeHandle } from "../facade/display-view-gpu.js";
import { DISPLAY_VIEW_SPEED_CONFORMANCE_CASE, LARGE_DEFOCUS_REASON, sceneToneAndOffsetsReason, displayViewSpeedGpuSupports, displayViewSpeedGpuUnsupportedReason, renderDisplayViewSpeedOnGpu,
  type DisplayViewGpuMaterialModule } from "./display-view-speed-gpu.js";
import { ImageKernelExecutionError, type ImageKernelExecution, type ImageKernelRelativeErrorBound } from "./image-kernel-execution.js";
import { abortedError, createComputePipeline, type WebGpuRuntime } from "./webgpu-runtime.js";

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;
type YieldControl = ((signal: AbortSignal) => Promise<void>) | undefined;
type QualityKit = typeof import("./display-view-quality-gpu.js");

/** Largest lattice group count the Quality tables hold (`display-view-quality-gpu.ts`). */
const QUALITY_MAXIMUM_GROUPS = 64;

const importQualityKit = (): Promise<QualityKit> => import("./display-view-quality-gpu.js");
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
  const pipelines = new Map<string, Promise<GPUComputePipeline>>();
  const bandBytes = options.maximumBandBytes ?? Math.min(64 * 1024 * 1024, runtime.maximumStorageBindingBytes);
  const source: PipelineSource = (label, code) => {
    let pending = pipelines.get(label);
    if (!pending) { pending = createComputePipeline(runtime, label, code, undefined); pipelines.set(label, pending); pending.catch(() => pipelines.delete(label)); }
    return pending;
  };
  // #491: one set of material modules per device for both kernels (the preset module per chart; the composite module, its probe
  // and its uploaded scene records), released by `dispose`.
  const modules = createDisplayViewMaterialModules(runtime, source);
  return {
    id: "photivra-display-view",
    supports(request: DisplayViewGpuRequest): true | string {
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
      // The routing of `render` below: a setup the Speed kernel does not cover takes the Quality passes.
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
        if (displayViewSpeedGpuUnsupportedReason(setup, signalInput) === null) {
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
