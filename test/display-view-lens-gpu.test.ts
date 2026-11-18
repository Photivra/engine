// SPDX-License-Identifier: Apache-2.0
/**
 * #655 (G1): the catalogue-lens passes on the fake device (test/helpers/fake-webgpu-display-view-lens.ts, the float32 emulation of
 * src/gpu/wgsl-display-view-lens-kernel.ts) against the CPU lens signal (src/facade/display-view-lens-signal.ts) through the Quality
 * host: every component inside the result's a-priori bounds, samples within one code, flagged pixels recomputed with the reference,
 * the highlight counts the reference's, and every lattice material the reference's own. Real-device conformance:
 * test/webgpu/display-view-lens.webgpu.ts.
 */
import { describe, expect, it } from "vitest";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { compareDisplayViews, runtimeOf, SMALL_FRAME, SMALL_VIEW } from "./helpers/display-view-gpu-fixture.js";
import { APP_CHART, displayViewLensGpuFixture, renderLensOnGpu } from "./helpers/display-view-lens-gpu-fixture.js";
import { DISPLAY_VIEW_LENS_CONFORMANCE_CASE } from "../src/gpu/display-view-quality-gpu.js";
import { displayViewLensConformanceFixture } from "../src/gpu/display-view-lens-gpu.js";
import { prepareDisplayViewLensSignal } from "../src/facade/display-view-lens-signal.js";
import { displayViewSignalTables } from "../src/facade/expected-signal.js";
import { renderDisplayView } from "../src/facade/display-view.js";
import { DISPLAY_VIEW_LENS_POINT_WORDS } from "../src/gpu/wgsl-display-view-lens-kernel.js";
import { DISPLAY_VIEW_QUALITY_GROUP_WORDS } from "../src/gpu/wgsl-display-view-quality-kernel.js";
import { layeredScene } from "./helpers/chart-composite-fixtures.js";
import type { SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const base = { subjectDistanceM: 2, lens: { catalogue: "pv-50-1.2-pro", fNumber: 8 }, sensor: { pixelPitchMicrometers: 6 }, output: { ...SMALL_FRAME, format: "srgb-8" as const } };
const REGION = { ...SMALL_VIEW, region: { x: 60, y: 40, width: 48, height: 32 } };

async function expectWithinBounds(options: SimulateCaptureOptions, view = REGION, extra: Parameters<typeof renderLensOnGpu>[4] = {}, maximumBandBytes?: number): Promise<{ resolved: number; dispatches: number }> {
  const fixture = await displayViewLensGpuFixture(options, view), runtime = await runtimeOf(createFakeGpu().gpu);
  try {
    const { gpu, passes } = await renderLensOnGpu(runtime, fixture, maximumBandBytes, true, extra);
    const a = compareDisplayViews(fixture.cpu, gpu);
    expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    for (const i of gpu.flaggedPixelIndices) for (let c = 0; c < 3; c++) expect(gpu.samples[3 * i + c]).toBe(fixture.cpu.samples[3 * i + c]);
    expect(Array.from(gpu.saturated)).toEqual(Array.from(fixture.cpu.saturated));
    expect(gpu.tapsPerSite).toBe((2 * fixture.lens.lens.psf!.radius + 1) ** 2);
    return { resolved: passes.latticePointsResolved, dispatches: gpu.stageMilliseconds.siteDispatches };
  } finally { runtime.destroy(); }
}

describe("catalogue-lens passes (float32 emulation) vs the CPU lens signal", () => {
  it("pass the lens self-check: every value inside its bound, samples within one code", async () => {
    const runtime = await runtimeOf(createFakeGpu().gpu);
    expect(await DISPLAY_VIEW_LENS_CONFORMANCE_CASE.run(runtime, undefined)).toBe(true);
    runtime.destroy();
  }, scaledTimeout(120_000));

  it("the self-check's float64 reference is the CPU lens signal's sum (uniform windows on and off)", () => {
    for (const uniformWindows of [true, false]) {
      const { setup, signalInput, lens } = displayViewLensConformanceFixture(undefined), W = signalInput.nativeWidth, H = signalInput.nativeHeight;
      // The reference reads the lens setup's method when a site is read.
      (lens.lens as { uniformWindows?: boolean }).uniformWindows = uniformWindows;
      const cpu = prepareDisplayViewLensSignal(lens.lens, W, H, setup.reachSites, "the test")(signalInput);
      cpu.window(0, 0, W, H);
      let largest = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = cpu.site(x, y), b = setup.signal.site(x, y); largest = Math.max(largest, Math.abs(a - b) / a); }
      expect(largest, "uniformWindows " + uniformWindows).toBeLessThan(1e-12);
      expect((cpu as unknown as { uniformWindowSites: number }).uniformWindowSites > 0).toBe(uniformWindows);
    }
  });

  it.each<[string, SimulateCaptureOptions["scene"]]>([["the app's composite chart", APP_CHART], ["a Siemens star", { preset: "siemens-star" }],
    ["dead leaves", { preset: "dead-leaves" }], ["a material-layers scene", layeredScene(SMALL_FRAME.height / SMALL_FRAME.width)]])(
    "%s through pv-50-1.2-pro at f/8: every component inside the bounds", async (_, scene) => {
      await expectWithinBounds({ ...base, scene } as SimulateCaptureOptions);
    }, scaledTimeout(300_000));

  it("resolves the lattice points near a boundary with the reference's lookup (a Siemens star)", async () => {
    expect((await expectWithinBounds({ ...base, scene: { preset: "siemens-star" } } as SimulateCaptureOptions)).resolved).toBeGreaterThan(0);
  }, scaledTimeout(300_000));

  it("a wide lens wide open, the 2 × 2 box and the four-spot filter (16 offsets in 4 groups), on a fixed-size chart", async () => {
    await expectWithinBounds({ ...base, lens: { catalogue: "pv-16-2.8", fNumber: 2.8 }, scene: { preset: "siemens-star", cycles: 24 }, chartSize: { widthM: 1.2, surroundReflectance: 0.2 },
      sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" } } } as SimulateCaptureOptions,
    { ...SMALL_VIEW, region: { x: 0, y: 0, width: 40, height: 24 } });
  }, scaledTimeout(300_000));

  it("splits bands and site dispatches without leaving the bounds", async () => {
    const { dispatches } = await expectWithinBounds({ ...base, scene: { preset: "checkerboard", squaresAcross: 12 } } as SimulateCaptureOptions, REGION, { maximumSiteTapsPerDispatch: 64 * 81 * 8 }, 1 << 19);
    expect(dispatches).toBeGreaterThan(4);
  }, scaledTimeout(300_000));

  it("follows the CPU's uniform-window method (lens.catalogue/view-uniform-window) where the CPU takes it", async () => {
    const options = { ...base, scene: { preset: "patches", columns: 3, patches: Array.from({ length: 6 }, (_, i) => ({ patchId: "p" + i, reflectance: 0.1 + 0.12 * i })) } } as SimulateCaptureOptions;
    const fixture = await displayViewLensGpuFixture(options, REGION), lens = { ...fixture.lens.lens, uniformWindows: true };
    const factory = prepareDisplayViewLensSignal(lens, fixture.signalInput.nativeWidth, fixture.signalInput.nativeHeight, fixture.setup.reachSites, "the test");
    const signal = factory(fixture.signalInput), uniform = { ...fixture, setup: { ...fixture.setup, signal }, lens: { ...fixture.lens, lens } };
    (uniform.setup.gpu as { lens?: unknown }).lens = uniform.lens;
    const cpuSignal = factory(fixture.signalInput), cpu = await renderDisplayView({ ...uniform.setup, signal: cpuSignal });
    expect((cpuSignal as unknown as { uniformWindowSites: number }).uniformWindowSites).toBeGreaterThan(0);
    const runtime = await runtimeOf(createFakeGpu().gpu);
    try {
      const { gpu } = await renderLensOnGpu(runtime, { ...uniform, cpu });
      const a = compareDisplayViews(cpu, gpu);
      expect(a.outsideExpectedBound).toBe(0);
      expect(a.outsideVarianceBound).toBe(0);
      expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    } finally { runtime.destroy(); }
  }, scaledTimeout(300_000));

  it("every lattice material the sites read is the reference's own (a composite chart)", async () => {
    const fixture = await displayViewLensGpuFixture({ ...base, scene: APP_CHART } as SimulateCaptureOptions, REGION), { gpu, controls } = createFakeGpu();
    const runtime = await runtimeOf(gpu), device = runtime.device as unknown as { createBindGroup(d: { entries: { binding: number; resource: { buffer: { label: string; data: ArrayBuffer } } }[] }): unknown };
    const groups: { entries: { binding: number; resource: { buffer: { label: string; data: ArrayBuffer } } }[] }[] = [], create = device.createBindGroup.bind(device);
    device.createBindGroup = (d): unknown => { groups.push(d); return create(d); };
    try {
      await renderLensOnGpu(runtime, fixture);
      // The pre-integration pass's bind group: the group records (1) and the lattice it read (3).
      const points = groups.filter((g) => g.entries.length === 6 && g.entries[2]!.resource.buffer.label === "photivra-display-view-lens-members");
      expect(points.length).toBeGreaterThan(0);
      const lens = fixture.lens.lens, tables = displayViewSignalTables(fixture.signalInput), W = fixture.signalInput.nativeWidth, H = fixture.signalInput.nativeHeight, mm = lens.pitch / 1000;
      const scene = fixture.signalInput.scene as { materialAt(u: number, v: number): number };
      let checked = 0;
      for (const g of points) {
        const words = new Uint32Array(g.entries[1]!.resource.buffer.data), ints = new Int32Array(words.buffer), lattice = new Uint32Array(g.entries[3]!.resource.buffer.data);
        tables.groups.forEach((group, k) => {
          const b = k * DISPLAY_VIEW_QUALITY_GROUP_WORDS, lx0 = ints[b]!, ly0 = ints[b + 1]!, lw = words[b + 2]!, lh = words[b + 3]!, first = words[b + 4]!;
          for (let local = 0; local < lw * lh; local += 7) {
            const p = lx0 + (local % lw), q = ly0 + Math.floor(local / lw);
            const look = lens.geometry.lookOf((p + 0.5 + group.fx - W / 2) * mm, (q + 0.5 + group.fy - H / 2) * mm, 0), s = lens.distanceM / look.z;
            expect(lattice[(first + local) * DISPLAY_VIEW_LENS_POINT_WORDS]).toBe(scene.materialAt(look.x * s / lens.metresPerFrameUnit, look.y * s / lens.metresPerFrameUnit));
            checked++;
          }
        });
      }
      expect(checked).toBeGreaterThan(1000);
      expect(controls.dispatches).toBeGreaterThan(0);
    } finally { runtime.destroy(); }
  }, scaledTimeout(300_000));
});
