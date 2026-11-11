// SPDX-License-Identifier: Apache-2.0
/**
 * Fixtures and metrics of the GPU display view (Speed, #478): a request rendered by the CPU reference with its setup and
 * expected-signal input exposed, the material module chosen as the renderer chooses it (the chart-preset module, or the
 * composite module of #491), the GPU render on a WebGPU runtime, and the per-pixel comparison in ΔE2000 (CIELAB under the
 * capture colour model's D65 white) and noise-σ units.
 */
import { resolveCaptureColorModel } from "../../src/color/capture-color.js";
import { cielabOfXyz, deltaE2000 } from "../../src/color/color-difference.js";
import { simulateDisplayViewWithInternals } from "../../src/facade/simulate-display-view.js";
import type { SimulateCaptureOptions, SimulateDisplayViewOptions } from "../../src/index.js";
import { createDisplayViewMaterialModules, type DisplayViewMaterialModules } from "../../src/gpu/display-view-composite-material-module.js";
import { renderDisplayViewSpeedOnGpu, type DisplayViewSpeedGpuInput, type DisplayViewSpeedGpuResult } from "../../src/gpu/display-view-speed-gpu.js";
import { qualityMaterialModule, renderDisplayViewQualityOnGpu, type DisplayViewQualityGpuResult } from "../../src/gpu/display-view-quality-gpu.js";
import { acquireWebGpuRuntime, createComputePipeline, type WebGpuRuntime } from "../../src/gpu/webgpu-runtime.js";
import { createDisplayViewExpectedSignal, renderDisplayView, type DisplayViewExpectedSignal, type DisplayViewRenderResult, type DisplayViewSetup } from "../../src/facade/display-view.js";

/** A CPU display view of a request and the inputs of its GPU render (the material module is built per runtime in `renderOnGpu`). */
export interface DisplayViewGpuFixture { cpu: DisplayViewRenderResult; input: Omit<DisplayViewSpeedGpuInput, "material">; viewWidth: number; viewHeight: number }

/** The small 3:2 frame of the unit tests: 600 × 400 real pixels of 6 µm, shown at 2.96 real pixels per display pixel. */
export const SMALL_FRAME = { width: 600, height: 400 };
export const SMALL_VIEW = { width: 203, height: 135 };

/** Renders the CPU reference of `options` at `view` and keeps the GPU inputs (the setup carries the resolved scene in `setup.gpu`). */
export async function displayViewGpuFixture(options: SimulateCaptureOptions, view: SimulateDisplayViewOptions): Promise<DisplayViewGpuFixture> {
  const { internals, setup, signalInput } = await simulateDisplayViewWithInternals(options, view);
  return { cpu: internals, input: { setup, signalInput }, viewWidth: view.width, viewHeight: view.height };
}

/** A runtime on a `navigator.gpu`-shaped object (the fake device in unit tests). */
export async function runtimeOf(gpu: unknown): Promise<WebGpuRuntime> {
  const acquired = await acquireWebGpuRuntime(gpu, undefined, undefined);
  if ("failure" in acquired) throw new Error("no runtime: " + acquired.failure);
  return acquired.runtime;
}

const moduleSources = new WeakMap<WebGpuRuntime, DisplayViewMaterialModules>();
/** The material modules of a runtime, as the renderer keeps them (one source per runtime: the probe once, scene records uploaded once). */
export function materialModulesOf(runtime: WebGpuRuntime): DisplayViewMaterialModules {
  let source = moduleSources.get(runtime);
  if (!source) { source = createDisplayViewMaterialModules(runtime, (label, code) => createComputePipeline(runtime, label, code, undefined)); moduleSources.set(runtime, source); }
  return source;
}
/** The material module the renderer would build for a setup's scene on the runtime. */
export async function materialModuleOf(runtime: WebGpuRuntime, setup: DisplayViewSetup): Promise<DisplayViewSpeedGpuInput["material"]> {
  return materialModulesOf(runtime).moduleFor(setup.gpu!, new AbortController().signal);
}

/** Renders the fixture's input on the runtime (the host path with its full result; the contract adapter is tested through prepareDisplayView). */
export async function renderOnGpu(runtime: WebGpuRuntime, fixture: DisplayViewGpuFixture, maximumBandBytes = 64 * 1024 * 1024, recomputeFlagged = true): Promise<DisplayViewSpeedGpuResult> {
  const material = await materialModuleOf(runtime, fixture.input.setup);
  return await renderDisplayViewSpeedOnGpu(runtime, maximumBandBytes, { ...fixture.input, material, recomputeFlagged }, new AbortController(), undefined,
    (label, code) => createComputePipeline(runtime, label, code, undefined));
}

/** Renders the fixture's input with the Quality kernels (#479). */
export async function renderOnGpuQuality(runtime: WebGpuRuntime, fixture: DisplayViewGpuFixture, maximumBandBytes = 64 * 1024 * 1024, recomputeFlagged = true): Promise<DisplayViewQualityGpuResult> {
  // The material module as the renderer builds it for a Quality render (the composite module reads the lattice groups with diffraction).
  // #581: an image-plane print brings its own passes 1 and 2, as the renderer gives them.
  const gpu = fixture.input.setup.gpu!, modules = materialModulesOf(runtime), signal = new AbortController().signal;
  const image = (gpu.signalInput.scene as { image?: unknown }).image ? await modules.imagePasses(gpu, signal) : undefined;
  const material = image ? { id: "image-plane", wgsl: "", bindings: [] } : await qualityMaterialModule(modules, gpu, signal);
  return await renderDisplayViewQualityOnGpu(runtime, maximumBandBytes, { ...fixture.input, material, recomputeFlagged, ...(image ? { image } : {}) }, new AbortController(), undefined,
    (label, code) => createComputePipeline(runtime, label, code, undefined));
}

/**
 * #479: the CPU reference's stages on a fixture, timed in this realm (one thread): `fullMs` a warm render (tables, kernels and
 * first-render costs paid); `signalMs` the expected signal of every native site the region reads, through one window of the
 * reference's own signal (its rings, filled bands and one-material sums); `restMs` the render with the signal answered from those
 * precomputed values and their one-material flags (everything after the expected signal: the demosaic candidates, development,
 * covariance, residual and choice variance, with the reference's one-material replay); and `statesMs` the cold render's
 * extra time over the warm one (2.22.0: there are no correction states, so this is first-render cost only). `restBitIdentical` checks that the split
 * render equals the warm render. Wall-clock milliseconds on this host.
 */
export async function timeCpuStages(fixture: DisplayViewGpuFixture): Promise<{ fullMs: number; restMs: number; signalMs: number; statesMs: number; restBitIdentical: boolean }> {
  const setup = fixture.input.setup, input = fixture.input.signalInput, now = (): number => performance.now();
  let t = now();
  await renderDisplayView({ ...setup, signal: createDisplayViewExpectedSignal(input) });
  const coldMs = now() - t;
  t = now();
  const full = await renderDisplayView({ ...setup, signal: createDisplayViewExpectedSignal(input) });
  const fullMs = now() - t;
  // Every native site the region's footprints and reach read, from one window of the reference's own signal.
  const sx = setup.frameWidth / setup.viewWidth, sy = setup.frameHeight / setup.viewHeight, reach = 3, r = setup.region;
  const x0 = Math.max(0, Math.floor(r.x * sx) + setup.margin - reach), x1 = Math.min(setup.nativeWidth - 1, Math.ceil((r.x + r.width) * sx) + setup.margin + reach);
  const y0 = Math.max(0, Math.floor(r.y * sy) + setup.margin - reach), y1 = Math.min(setup.nativeHeight - 1, Math.ceil((r.y + r.height) * sy) + setup.margin + reach);
  const W = x1 - x0 + 1, values = new Float64Array(W * (y1 - y0 + 1)), materials = new Int32Array(values.length), inner = createDisplayViewExpectedSignal(input);
  t = now();
  inner.window(x0, y0, x1 + 1, y1 + 1);
  const tracked = inner.tracksMaterial;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const at = (y - y0) * W + x - x0; values[at] = inner.site(x, y); materials[at] = tracked ? inner.uniformMaterial : -1; }
  const signalMs = now() - t;
  let last = -1;
  const site = (x: number, y: number): number => {
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { const at = (y - y0) * W + x - x0; last = materials[at]!; return values[at]!; }
    const v = inner.site(x, y); last = -1; return v;
  };
  const memo: DisplayViewExpectedSignal = { window: () => undefined, site, pilot: (u, v) => inner.pilot(u, v), get lookups() { return 0; }, get uniformMaterial() { return last; },
    tracksMaterial: tracked, cachesSites: false, marksReads: false, markReads: () => undefined };
  t = now();
  const rest = await renderDisplayView({ ...setup, signal: memo });
  const restMs = now() - t;
  let identical = true;
  for (let i = 0; i < full.expected.length && identical; i++) if (full.expected[i] !== rest.expected[i]) identical = false;
  return { fullMs, restMs, signalMs, statesMs: Math.max(0, coldMs - fullMs), restBitIdentical: identical };
}

export interface DisplayViewAgreement {
  pixels: number;
  /** ΔE2000 between the GPU and CPU expected values (linear sRGB clipped to [0, 1] → XYZ → CIELAB, D65): maximum and RMS. */
  deltaEMaximum: number; deltaERms: number;
  /** |E_gpu − E_cpu| / σ_cpu per component where σ_cpu > 0: maximum and RMS. */
  sigmaUnitsMaximum: number; sigmaUnitsRms: number;
  /** |σ_gpu − σ_cpu| / σ_cpu where σ_cpu > 0: maximum. */
  sigmaRelativeMaximum: number;
  /** Samples that differ, and the largest difference in codes. */
  differingSamples: number; largestCodeDifference: number;
  /** Components whose expected value or variance lie outside the result's a-priori bound (must be 0). */
  outsideExpectedBound: number; outsideVarianceBound: number;
  largestExpectedRatio: number; largestVarianceRatio: number;
}

/** The fields of a GPU result the comparison reads (a browser result arrives as plain data). */
export type ComparableGpuResult = Pick<DisplayViewSpeedGpuResult, "samples" | "expected" | "noiseStd" | "expectedValueBound" | "varianceBound" | "expectedValueAbsoluteBound" | "varianceAbsoluteBound">;

/** Compares a GPU render with the CPU reference per pixel and against the GPU result's own bounds. */
export function compareDisplayViews(cpu: Pick<DisplayViewRenderResult, "samples" | "expected" | "noiseStd">, gpu: ComparableGpuResult): DisplayViewAgreement {
  const model = resolveCaptureColorModel(), M = model.cameraRgbToXyz, white = model.referenceWhiteXyz, pixels = cpu.expected.length / 3;
  const lab = (e: Float64Array, o: number): ReturnType<typeof cielabOfXyz> => {
    const r = Math.min(1, Math.max(0, e[o]!)), g = Math.min(1, Math.max(0, e[o + 1]!)), b = Math.min(1, Math.max(0, e[o + 2]!));
    return cielabOfXyz({ x: M[0][0] * r + M[0][1] * g + M[0][2] * b, y: M[1][0] * r + M[1][1] * g + M[1][2] * b, z: M[2][0] * r + M[2][1] * g + M[2][2] * b }, white);
  };
  const a: DisplayViewAgreement = { pixels, deltaEMaximum: 0, deltaERms: 0, sigmaUnitsMaximum: 0, sigmaUnitsRms: 0, sigmaRelativeMaximum: 0, differingSamples: 0, largestCodeDifference: 0,
    outsideExpectedBound: 0, outsideVarianceBound: 0, largestExpectedRatio: 0, largestVarianceRatio: 0 };
  let sigmaCount = 0;
  for (let p = 0; p < pixels; p++) {
    const o = 3 * p, dE = deltaE2000(lab(cpu.expected, o), lab(gpu.expected, o));
    a.deltaEMaximum = Math.max(a.deltaEMaximum, dE); a.deltaERms += dE * dE;
    for (let c = 0; c < 3; c++) {
      const e0 = cpu.expected[o + c]!, e1 = gpu.expected[o + c]!, s0 = cpu.noiseStd[o + c]!, s1 = gpu.noiseStd[o + c]!, dE1 = Math.abs(e1 - e0);
      if (s0 > 0) {
        const units = dE1 / s0;
        a.sigmaUnitsMaximum = Math.max(a.sigmaUnitsMaximum, units); a.sigmaUnitsRms += units * units; sigmaCount++;
        a.sigmaRelativeMaximum = Math.max(a.sigmaRelativeMaximum, Math.abs(s1 - s0) / s0);
      }
      const code = Math.abs(gpu.samples[o + c]! - cpu.samples[o + c]!);
      if (code > 0) { a.differingSamples++; a.largestCodeDifference = Math.max(a.largestCodeDifference, code); }
      const expectedLimit = gpu.expectedValueBound.relative * Math.abs(e0) + gpu.expectedValueAbsoluteBound[p]!;
      const varianceLimit = gpu.varianceBound.relative * s0 * s0 + gpu.varianceAbsoluteBound[p]!;
      const dV = Math.abs(s1 * s1 - s0 * s0);
      if (expectedLimit > 0) a.largestExpectedRatio = Math.max(a.largestExpectedRatio, dE1 / expectedLimit);
      if (varianceLimit > 0) a.largestVarianceRatio = Math.max(a.largestVarianceRatio, dV / varianceLimit);
      if (dE1 > expectedLimit) a.outsideExpectedBound++;
      if (dV > varianceLimit) a.outsideVarianceBound++;
    }
  }
  a.deltaERms = Math.sqrt(a.deltaERms / pixels); a.sigmaUnitsRms = sigmaCount > 0 ? Math.sqrt(a.sigmaUnitsRms / sigmaCount) : 0;
  return a;
}
