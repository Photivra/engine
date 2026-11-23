// SPDX-License-Identifier: Apache-2.0
/**
 * #750 (2.29.0, group LGPU): the layered GPU display view's fixtures, shared by test/display-view-layered-gpu.test.ts (the fake
 * device) and test/webgpu/display-view-layered.webgpu.ts (a real device): small layered scenes (test/helpers/layered-scene-fixtures.ts)
 * as display-view setups with the CPU layered signal, and the named cases both suites render.
 */
import { RESPONSE, WAVELENGTHS, bayer, fixture, signalInputOf, type Fixture, type SurfaceSpec } from "./layered-scene-fixtures.js";
import { renderDisplayView, type DisplayViewRenderResult, type DisplayViewSetup } from "../../src/facade/display-view.js";
import type { DisplayViewExpectedSignalInput } from "../../src/facade/expected-signal.js";
import { createLayeredSceneLattice, createLayeredSceneSignal, type LayeredSceneLayer } from "../../src/facade/layered-scene-signal.js";
import { bilinearKernels } from "../../src/gpu/display-view-speed-gpu.js";
import { createComputePipeline, type WebGpuRuntime } from "../../src/gpu/webgpu-runtime.js";
import { renderDisplayViewLayeredOnGpu } from "../../src/gpu/display-view-layered-gpu.js";
import { createDefocusDiscSiteKernel } from "../../src/optics/defocus-disc-kernel.js";

export /** A layered view of a fixture (native W × H, one site of margin, the view at about a third of the frame) with the CPU layered signal. */
function layeredView(f: Fixture, specs: readonly SurfaceSpec[], options: { samples?: number; view?: [number, number]; region?: DisplayViewSetup["region"]; layers?: LayeredSceneLayer[] } = {}):
  { setup: DisplayViewSetup; layers: LayeredSceneLayer[] } {
  const input = signalInputOf(f, specs, options.samples ?? 4);
  if (options.layers) input.layers = options.layers;
  const lattice = createLayeredSceneLattice(input), signal = createLayeredSceneSignal(input, lattice), layers = [...input.layers];
  const [viewWidth, viewHeight] = options.view ?? [Math.round((f.W - 2) / 3), Math.round((f.H - 2) / 3)];
  const signalInput: DisplayViewExpectedSignalInput = { nativeWidth: f.W, nativeHeight: f.H, outputWidth: f.W, wavelengthsNm: WAVELENGTHS, electronsPerRadiance: RESPONSE, offsets: f.offsets,
    channelAt: bayer, scene: layers[0]!.scene, ...(f.diffraction ? { kernels: f.diffraction } : {}) };
  const readout = { perElectron: 1 / 3000, darkElectrons: 0.07, constantVariance: 2.5e-7 };
  const reach = Math.max(...layers.map((l) => (l.kernel ? l.kernel.radius : 0))) + (f.diffraction ? f.diffraction.radius : 0) + 3;
  const setup: DisplayViewSetup = { frameWidth: f.W - 2, frameHeight: f.H - 2, margin: 1, nativeWidth: f.W, nativeHeight: f.H, viewWidth, viewHeight,
    region: options.region ?? { x: 0, y: 0, width: viewWidth, height: viewHeight }, samplesPerAxis: 16, reachSites: reach, bitDepth: 8, seed: 750, signal,
    readout: [readout, readout, readout], demosaic: bilinearKernels(), gains: [1.1, 1, 1.6], clipLevel: 1, matrix: [[3.08, -1.54, -0.54], [-0.92, 1.88, 0.045], [0.053, -0.2, 1.15]],
    toneCurve: "identity", yieldControl: async (): Promise<void> => undefined, checkAbort: (): void => undefined,
    gpu: { signalInput, chart: null, layered: { layers } } as NonNullable<DisplayViewSetup["gpu"]> };
  return { setup, layers };
}

export const checker = (u: number, v: number): number => ((Math.floor(u * 7) + Math.floor(v * 7)) & 1);
/** Two cards and a back plane: one in front of the focus plane, one behind it, each a two-material checker. */
export const CARDS: SurfaceSpec[] = [
  { rect: { u0: -0.75, v0: -0.3, u1: 0.1, v1: 0.35 }, rho: -2.6, reflectances: [0.85, 0.2], materialAt: checker },
  { rect: { u0: -0.25, v0: -0.45, u1: 0.65, v1: 0.2 }, rho: 1.7, reflectances: [0.1, 0.6], materialAt: checker },
  { rect: null, rho: 3.3, reflectances: [0.45, 0.3], materialAt: (u) => (u > 0.2 ? 1 : 0) }];


/** A shaped kernel of radius R: weights rising by 15 % per site of radius inside the disc, normalized. */
export function shapedKernel(R: number): { radius: number; weights: Float64Array; shaped: true } {
  const side = 2 * R + 1, weights = new Float64Array(side * side);
  let sum = 0;
  for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) { const r2 = u * u + v * v, w = r2 <= (R + 0.5) ** 2 ? 1 + 0.15 * Math.round(Math.sqrt(r2)) : 0; weights[(v + R) * side + u + R] = w; sum += w; }
  for (let t = 0; t < weights.length; t++) weights[t] = weights[t]! / sum;
  return { radius: R, weights, shaped: true };
}

/** The named cases of both suites: a fixture, its surfaces and the view's options. */
export const LAYERED_GPU_CASES: Record<string, () => { f: Fixture; specs: SurfaceSpec[]; options: Parameters<typeof layeredView>[2] & { budget?: number } }> = {
  "two cards and a back plane, sums over several dispatches": () => ({ f: fixture(40, 30), specs: CARDS, options: { budget: 2048 } }),
  "2 × 2 box, diffraction kernels, 16 occlusion rows": () => ({ f: fixture(40, 30, { box: true, diffraction: true }), specs: CARDS, options: { samples: 16 } }),
  "a card in focus and a shaped kernel on the back plane": () => {
    const f = fixture(44, 32), specs: SurfaceSpec[] = [{ ...CARDS[0]!, rho: 0 }, CARDS[1]!, CARDS[2]!];
    const layers = signalInputOf(f, specs, 4).layers.map((l, k) => (k === 2 ? { rect: l.rect, blurRadiusSites: l.blurRadiusSites, scene: l.scene, kernel: shapedKernel(4) } : l));
    return { f, specs, options: { layers } };
  },
  "a region of the view": () => ({ f: fixture(44, 32), specs: CARDS, options: { region: { x: 3, y: 2, width: 7, height: 5 } } }),
  "large blur (radius 12 behind the focus plane)": () => ({ f: fixture(56, 40), specs: [{ ...CARDS[0]!, rho: -3.5 }, { ...CARDS[1]!, rho: 6 }, { ...CARDS[2]!, rho: 12 }], options: { view: [18, 13] } })
};

/** Renders a named case on the CPU (the reference) and on `runtime`. */
export async function renderLayeredCase(runtime: WebGpuRuntime, name: string): Promise<{ cpu: DisplayViewRenderResult; gpu: Awaited<ReturnType<typeof renderDisplayViewLayeredOnGpu>> }> {
  const { f, specs, options } = LAYERED_GPU_CASES[name]!(), { setup } = layeredView(f, specs, options), cpu = await renderDisplayView(setup);
  const gpu = await renderDisplayViewLayeredOnGpu(runtime, 1 << 20, setup, new AbortController(), undefined, (label, code) => createComputePipeline(runtime, label, code, undefined),
    options.budget !== undefined ? { maximumSiteTapsPerDispatch: options.budget } : {});
  return { cpu, gpu };
}

/**
 * The timing case (#750's large blur at module level): a W × H native frame shown at a third of its size, the two cards and the back
 * plane at signed blur radii −14, 20 and 29 sites (disc kernels of radius 14 to 29), N spectral nodes from 400 to 700 nm, one query
 * offset. Returns a new setup per call (each with its own layered signal, so a render starts with no tile filled).
 */
export function layeredTimingSetup(W: number, H: number, N: number, samples = 4): () => DisplayViewSetup {
  const rhos = [-14, 20, 29], wl = Array.from({ length: N }, (_, n) => 400 + (300 * n) / Math.max(1, N - 1)), white = Float64Array.from(wl, (_, n) => 1 + 0.01 * n);
  const response = [0, 1, 2].map((c) => Float64Array.from(wl, (_, n) => 10 + 100 * Math.exp(-(((n / N) - c / 2.2 - 0.1) ** 2) * 20))) as [Float64Array, Float64Array, Float64Array];
  const offsets = [{ x: 0, y: 0, weight: 1 }];
  const layers: LayeredSceneLayer[] = CARDS.map((card, k) => {
    const disc = createDefocusDiscSiteKernel(2 * Math.abs(rhos[k]!))!, scene = { kind: "materials" as const, materialAt: card.materialAt!, materials: card.reflectances.map((r) => ({ neutral: r })), whiteRadiance: white };
    return { rect: card.rect, blurRadiusSites: rhos[k]!, scene, kernel: { radius: disc.radius, weights: disc.weights },
      signalInput: { nativeWidth: W, nativeHeight: H, outputWidth: W, wavelengthsNm: wl, electronsPerRadiance: response, offsets, kernels: { radius: disc.radius, perNode: wl.map(() => disc.weights) }, scene, channelAt: bayer } };
  });
  const input = { nativeWidth: W, nativeHeight: H, outputWidth: W, wavelengthsNm: wl, layers, occlusionSamples: samples, offsets, electronsPerRadiance: response, channelAt: bayer };
  const readout = { perElectron: 1 / 3000, darkElectrons: 0.07, constantVariance: 2.5e-7 }, vw = Math.round(W / 3), vh = Math.round(H / 3);
  return () => ({ frameWidth: W - 2, frameHeight: H - 2, margin: 1, nativeWidth: W, nativeHeight: H, viewWidth: vw, viewHeight: vh, region: { x: 0, y: 0, width: vw, height: vh },
    samplesPerAxis: 16, reachSites: 33, bitDepth: 8, seed: 750, signal: createLayeredSceneSignal(input, createLayeredSceneLattice(input)), readout: [readout, readout, readout],
    demosaic: bilinearKernels(), gains: [1.1, 1, 1.6], clipLevel: 1, matrix: [[3.08, -1.54, -0.54], [-0.92, 1.88, 0.045], [0.053, -0.2, 1.15]], toneCurve: "identity",
    yieldControl: async (): Promise<void> => undefined, checkAbort: (): void => undefined,
    gpu: { signalInput: { nativeWidth: W, nativeHeight: H, outputWidth: W, wavelengthsNm: wl, electronsPerRadiance: response, offsets, channelAt: bayer, scene: layers[0]!.scene }, chart: null,
      layered: { layers } } as NonNullable<DisplayViewSetup["gpu"]> });
}
