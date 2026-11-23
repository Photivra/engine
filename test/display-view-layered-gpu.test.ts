// SPDX-License-Identifier: Apache-2.0
/**
 * #750 (2.29.0, group LGPU): the layered chart scene's display view on the GPU (src/gpu/display-view-layered-gpu.ts and its WGSL), on
 * the fake device (float32 emulation, test/helpers/fake-webgpu-display-view-layered.ts). The reference is the CPU layered signal
 * (`createLayeredSceneSignal`) through `renderDisplayView`; SwiftShader runs the same cases in test/webgpu/display-view-layered.webgpu.ts.
 */
import { describe, expect, it } from "vitest";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { WAVELENGTHS, fixture } from "./helpers/layered-scene-fixtures.js";
import { CARDS, LAYERED_GPU_CASES, layeredView, renderLayeredCase } from "./helpers/display-view-layered-gpu-fixture.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { renderDisplayView, type DisplayViewSetup } from "../src/facade/display-view.js";
import { displayViewSignalTables } from "../src/facade/expected-signal.js";
import { LAYERED_LATTICE_GROUP_LIMIT } from "../src/facade/layered-lattice-geometry.js";
import { createLayeredSceneLattice, type LayeredSceneLayer } from "../src/facade/layered-scene-signal.js";
import { openDisplayViewGpuSession } from "../src/facade/display-view-gpu-session.js";
import type { DisplayViewGpuRequest } from "../src/facade/display-view-gpu.js";
import { conformanceVerdict } from "../src/gpu/display-view-speed-gpu.js";
import type { WebGpuRuntime } from "../src/gpu/webgpu-runtime.js";
import { DISPLAY_VIEW_LAYERED_CONFORMANCE_CASE, createDisplayViewLayeredPasses, createLayeredDisplayViewGpuRenderer, displayViewLayeredGpuSupports, displayViewLayeredGpuUnsupportedReason } from "../src/gpu/display-view-layered-gpu.js";

describe("layered display view on the GPU (#750)", () => {
  it("passes its self-check on the fake device", async () => {
    const runtime = await runtimeOf(createFakeGpu().gpu);
    try { expect(await DISPLAY_VIEW_LAYERED_CONFORMANCE_CASE.run(runtime, undefined)).toBe(true); } finally { runtime.destroy(); }
  }, scaledTimeout(60_000));

  it("forms each edge point's sum from the reference's own visibility (every tap's factor is share's)", () => {
    // The spans in float64 against the reference's run sum (`edgeSum.sumAt`): equal within float64 rounding at every edge point.
    for (const f of [fixture(40, 30), fixture(40, 30, { box: true })]) {
      const { setup } = layeredView(f, CARDS);
      const lattice = (setup.signal as unknown as { lattice: ReturnType<typeof createLayeredSceneLattice> }).lattice;
      const quality = { ...setup.gpu!.signalInput, kernels: { radius: 0, perNode: WAVELENGTHS.map(() => Float64Array.of(1)) } };
      const passes = createDisplayViewLayeredPasses(null as unknown as WebGpuRuntime, setup, quality, () => Promise.reject(new Error("no pipelines")));
      const geometry = lattice.parts.geometry, layers = (setup.gpu as unknown as { layered: { layers: LayeredSceneLayer[] } }).layered.layers, N = WAVELENGTHS.length;
      const reference = new Float64Array(N), ours = new Float64Array(N);
      let edges = 0, partial = 0;
      for (const group of displayViewSignalTables(quality).groups) {
        const lg = lattice.groupOf(group.fx, group.fy);
        for (let q = -2; q < f.H + 2; q++) for (let p = -2; p < f.W + 2; p++) {
          if (geometry.surfaceOf(lg, p, q) >= 0) continue;
          edges++;
          reference.fill(0); ours.fill(0);
          lattice.parts.edgeSum.sumAt(lg, p, q, reference, 0);
          for (const span of passes.spansAt(lg, p, q)) {
            const kernel = layers[span.k]!.kernel, R = kernel ? kernel.radius : 0;
            if (span.f !== 1) partial++;
            for (let tu = span.u0; tu <= span.u1; tu++) {
              const w = kernel ? kernel.weights[(span.tv + R) * (2 * R + 1) + tu + R]! : 1, x = p - tu, y = q - span.tv, T = lattice.tiles.surfaces.tile;
              const tx = Math.floor(x / T), ty = Math.floor(y / T), tile = lattice.tiles.surfaces.tileAt(span.k * LAYERED_LATTICE_GROUP_LIMIT + lg, tx, ty), o = ((y - ty * T) * T + x - tx * T) * N;
              for (let n = 0; n < N; n++) ours[n] = ours[n]! + w * span.f * tile[o + n]!;
            }
          }
          for (let n = 0; n < N; n++) expect(Math.abs(ours[n]! - reference[n]!), `group ${lg} (${p}, ${q}) node ${n}`).toBeLessThanOrEqual(1e-12 * reference[n]! + 1e-300);
        }
      }
      expect(edges).toBeGreaterThan(100);
      expect(partial).toBeGreaterThan(10);
    }
  });

  it.each(Object.keys(LAYERED_GPU_CASES))("%s: every component inside the a-priori bounds; samples within one code", async (name) => {
    const runtime = await runtimeOf(createFakeGpu().gpu);
    try {
      const { cpu, gpu } = await renderLayeredCase(runtime, name);
      expect(conformanceVerdict(cpu, gpu)).toBe(true);
      // No lattice point is flagged (no material is decided on the device); every flagged pixel is the reference's.
      expect(gpu.latticePointsResolved).toBe(0);
      expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
      expect(gpu.layered.edgePoints).toBeGreaterThan(0);
      if (LAYERED_GPU_CASES[name]!().options.budget !== undefined) expect(gpu.layered.sumDispatches).toBeGreaterThan(2);
    } finally { runtime.destroy(); }
  }, scaledTimeout(180_000));

  it("says what it does not cover", () => {
    const request: DisplayViewGpuRequest = { ahd: false, diffraction: false, antiAliasing: false, boxSamples: 2, toneCurve: "identity", scene: "material-function", layered: true };
    expect(displayViewLayeredGpuSupports(request)).toBe(true);
    expect(displayViewLayeredGpuSupports({ ...request, lens: true })).toMatch(/lens map/u);
    expect(displayViewLayeredGpuSupports({ ...request, mixedIllumination: true })).toMatch(/mixed illumination/u);
    expect(displayViewLayeredGpuSupports({ ...request, layered: false })).toMatch(/not a layered/u);
    expect(displayViewLayeredGpuSupports({ ...request, toneCurve: "aces-filmic" as DisplayViewGpuRequest["toneCurve"] })).toMatch(/tone curve/u);
    const f = fixture(40, 30), { setup, layers } = layeredView(f, CARDS);
    expect(displayViewLayeredGpuUnsupportedReason(setup)).toBeNull();
    const withLayers = (list: unknown): DisplayViewSetup => ({ ...setup, gpu: { ...setup.gpu!, layered: list === undefined ? undefined : { layers: list } } as never });
    expect(displayViewLayeredGpuUnsupportedReason(withLayers(layers.map((l) => ({ ...l, zones: {} }))))).toMatch(/cat's eye/u);
    const wide = { radius: 97, weights: new Float64Array(195 * 195).fill(1 / (195 * 195)) };
    expect(displayViewLayeredGpuUnsupportedReason(withLayers(layers.map((l, k) => (k === 2 ? { ...l, kernel: wide } : l))))).toMatch(/above 96/u);
    expect(displayViewLayeredGpuUnsupportedReason(withLayers(undefined))).toMatch(/no layered GPU input/u);
  });

  it("is taken by the GPU session only through the request's loader (DisplayViewGpuRequest.layeredGpu)", async () => {
    const f = fixture(40, 30), { setup } = layeredView(f, CARDS), cpu = (): ReturnType<typeof renderDisplayView> => renderDisplayView(setup);
    const request: DisplayViewGpuRequest = { ahd: false, diffraction: false, antiAliasing: false, boxSamples: 1, toneCurve: "identity", scene: "material-function", layered: true };
    // Without the loader: no device is requested; the CPU renders, labelled.
    const plain = await openDisplayViewGpuSession({ gpu: "auto", gpuDevice: createFakeGpu().gpu }, request, undefined);
    const off = await plain.render(setup, undefined, cpu);
    expect(off.execution.backend).toBe("cpu-reference");
    expect(off.execution.fallbackReason).toBe("unsupported-on-backend");
    await expect(openDisplayViewGpuSession({ gpu: "require", gpuDevice: createFakeGpu().gpu }, request, undefined)).rejects.toThrow(/layered chart scenes render on the CPU/u);
    // With it: the layered renderer renders on the device, after the self-checks (Speed, Quality and the layered case).
    let loads = 0;
    const session = await openDisplayViewGpuSession({ gpu: "auto", gpuDevice: createFakeGpu().gpu }, { ...request, layeredGpu: async (base, runtime) => { loads++; return createLayeredDisplayViewGpuRenderer(base, runtime); } }, undefined);
    try {
      const on = await session.render(setup, undefined, cpu);
      expect(loads).toBe(1);
      expect(on.execution.backend).toBe("webgpu-f32");
      expect(on.execution.conformance?.cases).toContain(DISPLAY_VIEW_LAYERED_CONFORMANCE_CASE.id);
      const reference = await renderDisplayView(setup);
      for (let i = 0; i < reference.samples.length; i++) expect(Math.abs(on.rendered.samples[i]! - reference.samples[i]!)).toBeLessThanOrEqual(1);
    } finally { session.dispose(); }
    // A loader that resolves to a refusing renderer (a failed load) falls back under "auto".
    const refused = await openDisplayViewGpuSession({ gpu: "auto", gpuDevice: createFakeGpu().gpu },
      { ...request, layeredGpu: async (base) => ({ ...base, supports: (): string => "the layered GPU code did not load" }) }, undefined);
    const fallback = await refused.render(setup, undefined, cpu);
    expect(fallback.execution.backend).toBe("cpu-reference");
    expect(fallback.execution.limitations.join(" ")).toMatch(/did not load/u);
  }, scaledTimeout(180_000));
});
