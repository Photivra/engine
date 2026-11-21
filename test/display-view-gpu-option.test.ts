// SPDX-License-Identifier: Apache-2.0
/**
 * #481: `prepareDisplayView(request, { gpu, gpuDevice })` chooses the GPU or the CPU reference and labels which ran. No GPU
 * display-view renderer exists yet (#478), so a fake renderer (the CPU result, or a perturbed one, with a declared bound) and the
 * fake WebGPU device of the accelerator tests exercise the choice, the realm's veto, the handle forms, the run-time conformance
 * self-check, the fallback on device loss, disposal, single flight and the label. With `gpu: "off"` the result is today's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createImageKernelAccelerator, ImageKernelExecutionError, InvalidConfigurationError, prepareDisplayView, setWebGpuEnabled, simulateDisplayView,
  type DisplayViewResult, type SimulateCaptureOptions } from "../src/index.js";
import { renderDisplayView } from "../src/facade/display-view.js";
import { setDisplayViewGpuRendererFactory, type DisplayViewGpuConformanceCase, type DisplayViewGpuPart, type DisplayViewGpuRenderer,
  type DisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.js";
import { DISPLAY_VIEW_GPU_BUILT_IN_CASES } from "../src/facade/display-view-gpu-session.js";
import { displayViewGpuRendererFactory as engineRendererFactory, setDisplayViewQualityGpuLoader } from "../src/gpu/display-view-gpu-renderer.js";
import { createFakeGpu, FAKE_ADAPTER_INFO } from "./helpers/fake-webgpu.js";
import { SMALL_FRAME, SMALL_VIEW } from "./helpers/display-view-gpu-fixture.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

const REQUEST: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, sensor: { pixelPitchMicrometers: 4 }, output: { width: 24, height: 16 } };
const VIEW = { width: 6, height: 4 };
const BOUND = { kind: "relative-to-reference" as const, relative: 2 ** -20, absolute: 0 };
const BUILT_IN_IDS = DISPLAY_VIEW_GPU_BUILT_IN_CASES.map((c) => c.id);

interface FakeRendererOptions {
  perturb?: boolean;
  supports?: true | string;
  cases?: DisplayViewGpuConformanceCase[];
  /** #594: the renderer's on-demand cases per render (null: none for this render). */
  onDemand?: (part: { setup: DisplayViewGpuPart["setup"] }) => Promise<readonly DisplayViewGpuConformanceCase[]> | null;
  /** Runs at the start of each render (to lose the device, abort, or count concurrency). */
  onRender?: (part: DisplayViewGpuPart, active: number) => Promise<void> | void;
}
/** A renderer that returns the CPU reference's result (or one sample perturbed) with a declared bound. */
function fakeRenderer(options: FakeRendererOptions = {}): { factory: DisplayViewGpuRendererFactory; renders: number; peakActive: number } {
  const state = { renders: 0, peakActive: 0, factory: (() => undefined) as unknown as DisplayViewGpuRendererFactory };
  let active = 0;
  state.factory = (): DisplayViewGpuRenderer => ({
    id: "test-fake",
    supports: () => options.supports ?? true,
    ...(options.cases ? { conformanceCases: options.cases } : {}),
    ...(options.onDemand ? { onDemandConformanceCases: (setup: DisplayViewGpuPart["setup"]) => options.onDemand!({ setup }) } : {}),
    async render(part): Promise<ReturnType<DisplayViewGpuRenderer["render"]> extends Promise<infer T> ? T : never> {
      state.renders++; active++; state.peakActive = Math.max(state.peakActive, active);
      try {
        await options.onRender?.(part, active);
        const result = await renderDisplayView(part.setup);
        if (!options.perturb) return { ...result, errorBound: BOUND };
        const samples = result.samples.slice();
        samples[0] = samples[0]! ^ 1;
        return { ...result, samples, errorBound: BOUND };
      } finally { active--; }
    }
  });
  return state;
}
/** A conformance case that waits until released and rejects with `aborted` when the signal it was given aborts (#675). */
function gatedCase(id: string): { case: DisplayViewGpuConformanceCase; started: Promise<void>; release: () => void; signals: (AbortSignal | undefined)[] } {
  const signals: (AbortSignal | undefined)[] = [];
  let release = (): void => undefined, markStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { started, release: () => release(), signals, case: { id, async run(_runtime, signal): Promise<true> {
    signals.push(signal);
    markStarted();
    await new Promise<void>((resolve, reject) => {
      const aborted = (): void => reject(new ImageKernelExecutionError("aborted", "aborted"));
      if (signal?.aborted) { aborted(); return; }
      signal?.addEventListener("abort", aborted, { once: true });
      void gate.then(resolve);
    });
    return true;
  } } };
}
async function reason(promise: Promise<unknown>): Promise<string> {
  return promise.then(() => "resolved", (error: unknown) => (error instanceof ImageKernelExecutionError ? error.reason : (error as Error).name));
}
/** The result without its timings and label, as plain data. */
function comparable(result: DisplayViewResult): unknown {
  const diagnostics: Partial<DisplayViewResult["diagnostics"]> = { ...result.diagnostics };
  delete diagnostics.timingsMs;
  return { ...result, image: { ...result.image, samples: Array.from(result.image.samples) }, diagnostics };
}

afterEach(() => { setDisplayViewGpuRendererFactory(null); setWebGpuEnabled(true); });

describe("display view GPU option (#481)", () => {
  it("validates the prepare options", async () => {
    for (const bad of [{ gpu: "on" }, { gpu: true }, { extra: 1 }, { gpu: "off", gpuDevice: {} }, { gpu: "auto", gpuDevice: 3 }, [] as unknown]) {
      await expect(prepareDisplayView(REQUEST, bad as never)).rejects.toThrow(InvalidConfigurationError);
    }
  });

  it("gpu off is the CPU reference, labelled as such, and equals simulateDisplayView byte for byte; it is the default only with fast: false (2.20.0)", async () => {
    const prepared = await prepareDisplayView({ ...REQUEST, fast: false }), explicit = await prepareDisplayView(REQUEST, { gpu: "off" });
    const direct = await simulateDisplayView(REQUEST, VIEW), fromDefault = await prepared.render(VIEW), fromOff = await explicit.render(VIEW);
    expect(comparable(fromDefault)).toEqual({ ...comparable(await simulateDisplayView({ ...REQUEST, fast: false }, VIEW)) as object });
    expect(fromDefault.diagnostics.fast.execution.gpu).toBe("off");
    expect(comparable(fromOff)).toEqual(comparable(direct));
    // The display view resolves to fast by default, so gpu defaults to "auto": without a device here, the CPU reference, labelled.
    const auto = await prepareDisplayView(REQUEST), fromAuto = await auto.render(VIEW);
    expect(fromAuto.diagnostics.fast.execution).toMatchObject({ gpu: "auto", backend: "cpu-reference" });
    expect(Array.from(fromAuto.image.samples)).toEqual(Array.from(direct.image.samples));
    auto.dispose();
    expect(direct.diagnostics.fast).toMatchObject({ requested: true, defaultedFrom: "format", assurance: "engine-reference",
      execution: { gpu: "off", backend: "cpu-reference", requestedBackend: "cpu-reference", fallbackReason: null, arithmetic: "float64", assurance: "engine-reference", fast: false,
        bitIdenticalToReference: true, errorBound: null, adapter: null, conformance: null } });
    expect(direct.assumptions.some((a) => a.id === "view.execution")).toBe(false);
    prepared.dispose(); explicit.dispose();
  }, testTimeout(60_000));

  it("without a GPU display-view renderer, auto falls back without asking for a device and require fails: unsupported-on-backend", async () => {
    // The engine registers its Speed renderer (#478) when the GPU session module loads; this case is the engine without one.
    await import("../src/facade/display-view-gpu-session.js");
    setDisplayViewGpuRendererFactory(null);
    const { gpu, controls } = createFakeGpu();
    const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: gpu });
    const result = await prepared.render(VIEW);
    expect(controls.adapterRequests).toBe(0);
    expect(result.diagnostics.fast.execution).toMatchObject({ gpu: "auto", backend: "cpu-reference", requestedBackend: "webgpu-f32", fallbackReason: "unsupported-on-backend", assurance: "engine-reference" });
    expect(result.diagnostics.fast.execution.limitations.join(" ")).toMatch(/no GPU display-view renderer/u);
    expect(comparable(result)).toEqual({ ...comparable(await simulateDisplayView(REQUEST, VIEW)) as object, diagnostics: expect.anything() });
    expect(await reason(prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: gpu }))).toBe("unsupported-on-backend");
  });

  it("the realm's switch vetoes auto (webgpu-disabled, no adapter requested) and require (throws)", async () => {
    setDisplayViewGpuRendererFactory(fakeRenderer().factory);
    const { gpu, controls } = createFakeGpu();
    setWebGpuEnabled(false);
    const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: gpu });
    expect((await prepared.render(VIEW)).diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "webgpu-disabled", adapter: null });
    expect(controls.adapterRequests).toBe(0);
    expect(await reason(prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: gpu }))).toBe("webgpu-disabled");
  });

  it("the realm's switch, turned off after a view was prepared, keeps that view's renders on the CPU until it is on again (gpu-05 in #702)", async () => {
    const fake = fakeRenderer();
    setDisplayViewGpuRendererFactory(fake.factory);
    const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    const strict = await prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: createFakeGpu().gpu });
    expect((await prepared.render(VIEW)).diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null });
    setWebGpuEnabled(false);
    const off = await prepared.render(VIEW);
    expect(off.diagnostics.fast.execution).toMatchObject({ gpu: "auto", backend: "cpu-reference", requestedBackend: "webgpu-f32", fallbackReason: "webgpu-disabled", adapter: FAKE_ADAPTER_INFO });
    expect(comparable(off)).toEqual({ ...comparable(await simulateDisplayView(REQUEST, VIEW)) as object, diagnostics: expect.anything() });
    expect(await reason(strict.render(VIEW))).toBe("webgpu-disabled");
    expect(fake.renders).toBe(1);
    setWebGpuEnabled(true);
    expect((await prepared.render(VIEW)).diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null });
    expect(fake.renders).toBe(2);
    prepared.dispose(); strict.dispose();
  });

  it("auto on a conforming device renders on the GPU: the label names webgpu-f32, its bound, the adapter and the passed self-check", async () => {
    const fake = fakeRenderer({ perturb: true });
    setDisplayViewGpuRendererFactory(fake.factory);
    const { gpu, controls } = createFakeGpu();
    const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: gpu });
    expect(controls.adapterRequests).toBe(1);
    const reference = await simulateDisplayView(REQUEST, VIEW), result = await prepared.render(VIEW);
    expect(result.diagnostics.fast).toMatchObject({ requested: true, assurance: "approximation-with-a-priori-bound",
      execution: { gpu: "auto", backend: "webgpu-f32", requestedBackend: "webgpu-f32", fallbackReason: null, arithmetic: "float32", fast: true, bitIdenticalToReference: false,
        errorBound: BOUND, adapter: FAKE_ADAPTER_INFO, conformance: { cases: BUILT_IN_IDS, passed: true, failedCase: null, detail: null } } });
    expect(result.assumptions.find((a) => a.id === "view.execution")?.value).toMatchObject({ backend: "webgpu-f32", adapter: FAKE_ADAPTER_INFO });
    // The perturbed sample shows the GPU result was used; everything else is the reference's.
    expect(result.image.samples[0]).toBe(reference.image.samples[0]! ^ 1);
    expect(Array.from(result.image.samples.subarray(1))).toEqual(Array.from(reference.image.samples.subarray(1)));
    // The self-check ran once, on the existing convolution kernel (one dispatch per case), before the first render.
    const dispatches = controls.dispatches;
    expect(dispatches).toBe(BUILT_IN_IDS.length);
    const again = await prepared.render(VIEW);
    expect(controls.dispatches).toBe(dispatches);
    expect(again.diagnostics.fast.execution.conformance).toEqual(result.diagnostics.fast.execution.conformance);
    expect(fake.renders).toBe(2);
    // dispose() releases the device the view acquired; later renders run the CPU and say so.
    prepared.dispose(); prepared.dispose();
    expect(controls.deviceDestroyCalls).toBe(1);
    expect((await prepared.render(VIEW)).diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "disposed", adapter: FAKE_ADAPTER_INFO });
  });

  it("concurrent renders of one prepared view run one at a time on the device", async () => {
    const fake = fakeRenderer({ onRender: async () => { await new Promise((resolve) => setTimeout(resolve, 2)); } });
    setDisplayViewGpuRendererFactory(fake.factory);
    const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    const results = await Promise.all([0, 1, 2].map((i) => prepared.render({ ...VIEW, region: { x: i, y: 0, width: 2, height: 4 } })));
    for (const r of results) expect(r.diagnostics.fast.execution.backend).toBe("webgpu-f32");
    expect(fake.renders).toBe(3);
    expect(fake.peakActive).toBe(1);
    prepared.dispose();
  });

  it("a failed self-check keeps the view on the CPU (conformance-failed, adapter recorded); require fails with it", async () => {
    const failing: DisplayViewGpuConformanceCase = { id: "preview:fake-case", run: async () => "the fake disagreed with the reference by 3 codes." };
    setDisplayViewGpuRendererFactory(fakeRenderer({ cases: [failing] }).factory);
    let prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    const result = await prepared.render(VIEW);
    expect(result.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "conformance-failed", assurance: "engine-reference", adapter: FAKE_ADAPTER_INFO,
      conformance: { cases: [...BUILT_IN_IDS, "preview:fake-case"], passed: false, failedCase: "preview:fake-case", detail: "the fake disagreed with the reference by 3 codes." } });
    expect(result.image.samples).toEqual((await simulateDisplayView(REQUEST, VIEW)).image.samples);
    // The check is not repeated: the second render reports the same failure.
    expect((await prepared.render(VIEW)).diagnostics.fast.execution.fallbackReason).toBe("conformance-failed");
    prepared.dispose();
    // A device that rejects the built-in convolution kernel fails the built-in case.
    setDisplayViewGpuRendererFactory(fakeRenderer().factory);
    const { gpu, controls } = createFakeGpu();
    prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: gpu });
    controls.failNextScope = "validation";
    const rejected = await prepared.render(VIEW);
    expect(rejected.diagnostics.fast.execution).toMatchObject({ fallbackReason: "conformance-failed", conformance: { passed: false, failedCase: BUILT_IN_IDS[0] } });
    expect(rejected.diagnostics.fast.execution.conformance?.detail).toMatch(/gpu-validation/u);
    prepared.dispose();
    // require: the failure is an error at the first render (acquisition succeeded).
    setDisplayViewGpuRendererFactory(fakeRenderer({ cases: [failing] }).factory);
    prepared = await prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: createFakeGpu().gpu });
    expect(await reason(prepared.render(VIEW))).toBe("conformance-failed");
    prepared.dispose();
  });

  // #594 (owner, 2026-11-10): cases of code a renderer loads on demand (the Quality kernels) run before the first render that
  // needs them, not at the device's first render; a failure there keeps that render and every later one on the CPU.
  it("on-demand cases run once, before the first render that needs them; their failure keeps the rest of the view on the CPU", async () => {
    const base: DisplayViewGpuConformanceCase = { id: "preview:base", run: async () => true };
    for (const outcome of [true, "the on-demand kernel disagreed by 2 codes."] as const) {
      let needed = false, loads = 0, runs = 0;
      const extra: DisplayViewGpuConformanceCase = { id: "preview:on-demand", run: async () => { runs++; return outcome; } };
      const fake = fakeRenderer({ cases: [base], onDemand: () => (needed ? Promise.resolve().then(() => { loads++; return [extra]; }) : null) });
      setDisplayViewGpuRendererFactory(fake.factory);
      const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      const first = await prepared.render(VIEW);
      expect(first.diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", conformance: { cases: [...BUILT_IN_IDS, "preview:base"], passed: true } });
      expect(runs).toBe(0);
      needed = true;
      const [a, b] = await Promise.all([prepared.render(VIEW), prepared.render(VIEW)]);
      expect(runs).toBe(1);
      expect(loads).toBeLessThanOrEqual(2);
      const ids = [...BUILT_IN_IDS, "preview:base", "preview:on-demand"];
      if (outcome === true) {
        for (const r of [a, b]) expect(r.diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", conformance: { cases: ids, passed: true } });
        expect(Array.from(a.image.samples)).toEqual(Array.from(first.image.samples));
      } else {
        for (const r of [a, b]) expect(r.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "conformance-failed",
          conformance: { cases: ids, passed: false, failedCase: "preview:on-demand", detail: outcome } });
        // A later render that needs no on-demand case stays on the CPU too, and nothing runs again.
        needed = false;
        expect((await prepared.render(VIEW)).diagnostics.fast.execution.fallbackReason).toBe("conformance-failed");
        expect(runs).toBe(1);
      }
      prepared.dispose();
    }
    // require: the on-demand failure is an error at the render that needs it.
    const failing: DisplayViewGpuConformanceCase = { id: "preview:on-demand", run: async () => "no." };
    setDisplayViewGpuRendererFactory(fakeRenderer({ onDemand: () => Promise.resolve([failing]) }).factory);
    const required = await prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: createFakeGpu().gpu });
    expect(await reason(required.render(VIEW))).toBe("conformance-failed");
    required.dispose();
  });

  // #594 (owner, 2026-11-10): on-demand code that does not load runs that render on the CPU, labelled; it is not sticky.
  it("on-demand code that fails to load falls back for that render, labelled quality-code-unavailable, and loads on the next request", async () => {
    let fail = true, runs = 0;
    const extra: DisplayViewGpuConformanceCase = { id: "preview:on-demand", run: async () => { runs++; return true; } };
    const unavailable = (): never => { throw new ImageKernelExecutionError("quality-code-unavailable", "the chunk did not load."); };
    const fake = fakeRenderer({ onDemand: () => Promise.resolve().then(() => (fail ? unavailable() : [extra])) });
    setDisplayViewGpuRendererFactory(fake.factory);
    const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    const failed = await prepared.render(VIEW);
    expect(failed.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "quality-code-unavailable", adapter: FAKE_ADAPTER_INFO,
      conformance: { cases: BUILT_IN_IDS, passed: true } });
    expect(failed.image.samples).toEqual((await simulateDisplayView(REQUEST, VIEW)).image.samples);
    expect(runs).toBe(0);
    fail = false;
    const loaded = await prepared.render(VIEW);
    expect(loaded.diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, conformance: { cases: [...BUILT_IN_IDS, "preview:on-demand"], passed: true } });
    expect(runs).toBe(1);
    prepared.dispose();
    // require: the failed load is an error at that render.
    fail = true;
    const required = await prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: createFakeGpu().gpu });
    expect(await reason(required.render(VIEW))).toBe("quality-code-unavailable");
    required.dispose();
  });

  it("device loss falls back to the CPU for that render and the rest of the view, labelled device-lost; require fails", async () => {
    const { gpu, controls } = createFakeGpu();
    let lose = false;
    setDisplayViewGpuRendererFactory(fakeRenderer({ onRender: () => { if (lose) { lose = false; controls.loseDevice(); throw new ImageKernelExecutionError("device-lost", "lost"); } } }).factory);
    const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: gpu });
    expect((await prepared.render(VIEW)).diagnostics.fast.execution.backend).toBe("webgpu-f32");
    lose = true;
    const during = await prepared.render(VIEW);
    expect(during.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "device-lost", adapter: FAKE_ADAPTER_INFO });
    expect(during.image.samples).toEqual((await simulateDisplayView(REQUEST, VIEW)).image.samples);
    expect((await prepared.render(VIEW)).diagnostics.fast.execution.fallbackReason).toBe("device-lost");
    prepared.dispose();
    // Loss between renders, and require.
    const second = createFakeGpu();
    const required = await prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: second.gpu });
    expect((await required.render(VIEW)).diagnostics.fast.execution.backend).toBe("webgpu-f32");
    second.controls.loseDevice();
    await Promise.resolve();
    expect(await reason(required.render(VIEW))).toBe("device-lost");
    required.dispose();
  });

  it("a render the renderer refuses only when rendering (unsupported-on-backend thrown by render) runs the CPU reference labelled, or fails under require; dispose reaches the renderer", async () => {
    let disposed = 0, refuse = true;
    const fake = fakeRenderer({ onRender: () => { if (refuse) throw new ImageKernelExecutionError("unsupported-on-backend", "the device fails the composite probe."); } });
    const factory = fake.factory;
    setDisplayViewGpuRendererFactory((runtime) => ({ ...factory(runtime), dispose: (): void => { disposed++; } }));
    const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    const fell = await prepared.render(VIEW);
    expect(fell.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend", conformance: { passed: true } });
    expect(fell.diagnostics.fast.execution.limitations.join(" ")).toMatch(/composite probe/u);
    expect(Array.from(fell.image.samples)).toEqual(Array.from((await simulateDisplayView(REQUEST, VIEW)).image.samples));
    // The next render asks the renderer again (a later request may be covered).
    refuse = false;
    expect((await prepared.render(VIEW)).diagnostics.fast.execution.backend).toBe("webgpu-f32");
    prepared.dispose();
    expect(disposed).toBe(1);
    prepared.dispose();
    expect(disposed).toBe(1);
    refuse = true;
    const required = await prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: createFakeGpu().gpu });
    expect(await reason(required.render(VIEW))).toBe("unsupported-on-backend");
    required.dispose();
  }, testTimeout(30_000));

  it("an unsupported request, a missing adapter and the handle forms", async () => {
    setDisplayViewGpuRendererFactory(fakeRenderer({ supports: "AHD is not implemented on the fake." }).factory);
    const { gpu, controls } = createFakeGpu();
    const unsupported = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: gpu });
    expect((await unsupported.render(VIEW)).diagnostics.fast.execution).toMatchObject({ fallbackReason: "unsupported-on-backend", adapter: FAKE_ADAPTER_INFO });
    expect(controls.deviceDestroyCalls).toBe(1);
    expect(await reason(prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: gpu }))).toBe("unsupported-on-backend");
    setDisplayViewGpuRendererFactory(fakeRenderer().factory);
    // No adapter: the accelerator's acquisition reason.
    const none = createFakeGpu({ adapter: "none" }).gpu;
    expect((await (await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: none })).render(VIEW)).diagnostics.fast.execution.fallbackReason).toBe("adapter-unavailable");
    expect(await reason(prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: none }))).toBe("adapter-unavailable");
    // An accelerator handle shares its device, which stays the accelerator's.
    const shared = createFakeGpu();
    const accelerator = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu: shared.gpu });
    expect(accelerator.adapter).toEqual(FAKE_ADAPTER_INFO);
    const prepared = await prepareDisplayView(REQUEST, { gpu: "require", gpuDevice: accelerator });
    expect((await prepared.render(VIEW)).diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", adapter: FAKE_ADAPTER_INFO });
    prepared.dispose();
    expect(shared.controls.deviceDestroyCalls).toBe(0);
    expect(shared.controls.adapterRequests).toBe(1);
    accelerator.dispose();
    await expect(prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: accelerator })).rejects.toThrow(InvalidConfigurationError);
    // A CPU accelerator has no device to share.
    const cpu = await createImageKernelAccelerator({ backend: "cpu-reference" });
    expect((await (await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: cpu })).render(VIEW)).diagnostics.fast.execution.fallbackReason).toBe("webgpu-unavailable");
    // Without a handle the engine asks globalThis.navigator.gpu; Node has none.
    expect((await (await prepareDisplayView(REQUEST, { gpu: "auto" })).render(VIEW)).diagnostics.fast.execution.fallbackReason).toBe("webgpu-unavailable");
  });

  // #675: the shared self-checks run under the session's signal; a render's own signal only stops that render waiting.
  it("an aborted render does not end the self-check a concurrent render waits for (device and on-demand checks)", async () => {
    for (const where of ["device", "on-demand"] as const) {
      const gated = gatedCase("preview:gated");
      setDisplayViewGpuRendererFactory(fakeRenderer(where === "device" ? { cases: [gated.case] } : { onDemand: (): Promise<DisplayViewGpuConformanceCase[]> => Promise.resolve([gated.case]) }).factory);
      const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      const controller = new AbortController();
      const aborted = prepared.render(VIEW, { signal: controller.signal }), other = prepared.render(VIEW);
      await gated.started;
      controller.abort();
      await expect(aborted, where).rejects.toThrow(InvalidConfigurationError);
      gated.release();
      const result = await other;
      expect(result.diagnostics.fast.execution, where).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, conformance: { passed: true } });
      expect(gated.signals.map((signal) => signal?.aborted), where).toEqual([false]);
      expect((await prepared.render(VIEW)).diagnostics.fast.execution.backend).toBe("webgpu-f32");
      prepared.dispose();
    }
  });

  // #675, the review's case S1: the engine's renderer on the fake device; render A is aborted while the checks run and render B,
  // started with it, is never aborted. Without diffraction A's abort lands in the device self-check (at its second dispatch);
  // with lens.diffraction it lands as the Quality self-check starts (when the Quality host is loaded for its cases).
  it("with the engine's renderer, a concurrent render that was not aborted renders on the GPU (device and Quality self-checks)", async () => {
    setDisplayViewGpuRendererFactory(engineRendererFactory);
    const region = (x: number, y: number): typeof SMALL_VIEW & { region: { x: number; y: number; width: number; height: number } } => ({ ...SMALL_VIEW, region: { x, y, width: 16, height: 12 } });
    try {
      for (const quality of [false, true]) {
        const lens = quality ? { diffraction: "circular-aperture" } : {};
        const request = { scene: { preset: "checkerboard" }, subjectDistanceM: 2, sensor: { pixelPitchMicrometers: 6 }, lens, output: { ...SMALL_FRAME, format: "srgb-8" } } as SimulateCaptureOptions;
        const fake = createFakeGpu(), prepared = await prepareDisplayView(request, { gpu: "auto", gpuDevice: fake.gpu });
        const controller = new AbortController();
        let qualityLoads = 0;
        if (quality) setDisplayViewQualityGpuLoader(() => { qualityLoads++; controller.abort(); return import("../src/gpu/display-view-quality-gpu.js"); });
        else fake.controls.beforeDispatch = (count): void => { if (count === 2) controller.abort(); };
        const a = prepared.render(region(90, 60), { signal: controller.signal }), b = prepared.render(region(20, 20));
        await expect(a).rejects.toThrow(InvalidConfigurationError);
        const result = await b;
        expect(result.diagnostics.fast.execution, "quality " + quality).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, conformance: { passed: true } });
        expect(qualityLoads).toBe(quality ? 1 : 0);
        expect((await prepared.render(region(20, 20))).diagnostics.fast.execution.backend).toBe("webgpu-f32");
        prepared.dispose();
      }
    } finally { setDisplayViewQualityGpuLoader(null); }
  }, testTimeout(120_000));

  // gpu-04 (#702): the self-check runs the very pipelines the render uses, so the first render compiles each distinct shader once.
  it("with the engine's renderer, the first render compiles each distinct shader once and the second compiles none", async () => {
    setDisplayViewGpuRendererFactory(engineRendererFactory);
    const counting = (): { gpu: unknown; labels: string[] } => {
      const fake = createFakeGpu(), labels: string[] = [];
      type Device = { createShaderModule(d: { label: string; code: string }): unknown };
      type Adapter = { requestDevice(d: unknown): Promise<Device> };
      const gpu = fake.gpu as { requestAdapter(o?: unknown): Promise<Adapter> }, requestAdapter = gpu.requestAdapter.bind(gpu);
      gpu.requestAdapter = async (o?: unknown): Promise<Adapter> => {
        const adapter = await requestAdapter(o), requestDevice = adapter.requestDevice.bind(adapter);
        adapter.requestDevice = async (d: unknown): Promise<Device> => {
          const device = await requestDevice(d), create = device.createShaderModule.bind(device);
          device.createShaderModule = (m): unknown => { labels.push(m.label); return create(m); };
          return device;
        };
        return adapter;
      };
      return { gpu, labels };
    };
    const region = (x: number, y: number): typeof SMALL_VIEW & { region: { x: number; y: number; width: number; height: number } } => ({ ...SMALL_VIEW, region: { x, y, width: 16, height: 12 } });
    // Speed: the convolution and the Speed kernel; Quality (diffraction and AHD): the convolution, the Speed kernel of the device's
    // self-check, the lattice, sites, pixels and blocked-sites kernels.
    for (const [quality, distinct] of [[false, 2], [true, 6]] as const) {
      const extra = quality ? { lens: { diffraction: "circular-aperture" }, output: { ...SMALL_FRAME, format: "srgb-8", demosaic: "ahd" } } : {};
      const request = { scene: { preset: "checkerboard" }, subjectDistanceM: 2, sensor: { pixelPitchMicrometers: 6 }, output: { ...SMALL_FRAME, format: "srgb-8" }, ...extra } as SimulateCaptureOptions;
      const c = counting(), prepared = await prepareDisplayView(request, { gpu: "auto", gpuDevice: c.gpu });
      expect((await prepared.render(region(90, 60))).diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", conformance: { passed: true } });
      expect(new Set(c.labels).size, c.labels.join(", ")).toBe(distinct);
      expect(c.labels.length, c.labels.join(", ")).toBe(distinct);
      await prepared.render(region(20, 20));
      expect(c.labels.length).toBe(distinct);
      prepared.dispose();
    }
    // Views that share an accelerator's device share its pipelines: a second chart preset's module has the same shader text, so
    // a Speed view of another preset compiles nothing (before, its label made the Speed kernel compile again).
    const c = counting(), accelerator = await createImageKernelAccelerator({ webgpu: true, gpu: c.gpu as never });
    const view = async (preset: string): Promise<void> => {
      const request = { scene: { preset }, subjectDistanceM: 2, sensor: { pixelPitchMicrometers: 6 }, output: { ...SMALL_FRAME, format: "srgb-8" } } as unknown as SimulateCaptureOptions;
      const prepared = await prepareDisplayView(request, { gpu: "auto", gpuDevice: accelerator });
      expect((await prepared.render(region(90, 60))).diagnostics.fast.execution.backend).toBe("webgpu-f32");
      prepared.dispose();
    };
    await view("checkerboard");
    expect(c.labels.length).toBe(2);
    await view("siemens-star");
    expect(c.labels.length, c.labels.join(", ")).toBe(2);
    accelerator.dispose();
  }, testTimeout(120_000));

  it("dispose() ends a running self-check; the render that waited runs the CPU reference labelled disposed, or fails under require", async () => {
    for (const gpu of ["auto", "require"] as const) for (const where of ["device", "on-demand"] as const) {
      const gated = gatedCase("preview:gated");
      setDisplayViewGpuRendererFactory(fakeRenderer(where === "device" ? { cases: [gated.case] } : { onDemand: (): Promise<DisplayViewGpuConformanceCase[]> => Promise.resolve([gated.case]) }).factory);
      const prepared = await prepareDisplayView(REQUEST, { gpu, gpuDevice: createFakeGpu().gpu });
      const pending = gpu === "auto" ? prepared.render(VIEW).then((r) => r.diagnostics.fast.execution.fallbackReason) : reason(prepared.render(VIEW));
      await gated.started;
      prepared.dispose();
      expect(gated.signals.map((signal) => signal?.aborted), where).toEqual([true]);
      expect(await pending, gpu + " " + where).toBe("disposed");
      gated.release();
    }
  });

  // #692 (owner decision 2026-11-21): the self-check does not compile every pipeline a render uses. A kernel the device refuses
  // after the check (the fake starts refusing pipelines after its k-th dispatch) runs the CPU reference under "auto", labelled
  // gpu-validation, and is not compiled again; "require" throws. The review's two scenes, a Quality view of each.
  it("a kernel that fails to compile after the self-check falls back under auto (gpu-validation, remembered) and throws under require", async () => {
    setDisplayViewGpuRendererFactory(engineRendererFactory);
    const region = { ...SMALL_VIEW, region: { x: 90, y: 60, width: 16, height: 12 } };
    for (const preset of ["dead-leaves", "checkerboard"]) {
      const request = { scene: { preset }, subjectDistanceM: 2, sensor: { pixelPitchMicrometers: 6 }, lens: { diffraction: "circular-aperture" },
        output: { ...SMALL_FRAME, format: "srgb-8", demosaic: "ahd" } } as unknown as SimulateCaptureOptions;
      const reference = (await (await prepareDisplayView(request, { gpu: "off" })).render(region)).image.samples;
      const outcomes = new Set<string>();
      for (const k of [8, 12, 16, 20, 24]) {
        for (const gpu of ["auto", "require"] as const) {
          const fake = createFakeGpu();
          fake.controls.beforeDispatch = (count): void => { if (count === k) fake.controls.failPipeline = true; };
          const prepared = await prepareDisplayView(request, { gpu, gpuDevice: fake.gpu });
          if (gpu === "require") {
            const outcome = await reason(prepared.render(region));
            expect(["conformance-failed", "gpu-validation", "resolved"], preset + " " + k).toContain(outcome);
            if (preset === "checkerboard") expect(outcome).not.toBe("gpu-validation");
          } else {
            const result = await prepared.render(region);
            const execution = result.diagnostics.fast.execution;
            // gpu-04 (#702): the self-checks build every pipeline a chart-preset view renders with, so after them a checkerboard
            // render compiles nothing and runs on the GPU; dead leaves (a composite chart) compiles its probe and lattice at render.
            if (execution.backend === "webgpu-f32") { expect(preset, String(k)).toBe("checkerboard"); outcomes.add("gpu"); prepared.dispose(); continue; }
            expect(["conformance-failed", "gpu-validation"], preset + " " + k).toContain(execution.fallbackReason);
            if (preset === "checkerboard") expect(execution.fallbackReason).toBe("conformance-failed");
            expect(Array.from(result.image.samples)).toEqual(Array.from(reference));
            outcomes.add(execution.fallbackReason!);
            if (execution.fallbackReason === "gpu-validation") {
              expect(execution.conformance?.passed).toBe(true);
              expect(execution.limitations.at(-1)).toMatch(/could not compile the photivra-/u);
              // The refused kernel is remembered: with the device accepting pipelines again the view still falls back.
              fake.controls.failPipeline = false;
              fake.controls.beforeDispatch = undefined;
              expect((await prepared.render(region)).diagnostics.fast.execution.fallbackReason).toBe("gpu-validation");
            }
          }
          prepared.dispose();
        }
      }
      expect(outcomes.has(preset === "checkerboard" ? "gpu" : "gpu-validation"), preset + " " + [...outcomes].join()).toBe(true);
    }
  }, testTimeout(300_000));

  it("a device out of memory during a render falls back for that render under auto (out-of-memory, not remembered) and throws under require", async () => {
    setDisplayViewGpuRendererFactory(fakeRenderer({ onRender: () => { throw new ImageKernelExecutionError("out-of-memory", "The WebGPU device ran out of memory."); } }).factory);
    for (const gpu of ["auto", "require"] as const) {
      const prepared = await prepareDisplayView(REQUEST, { gpu, gpuDevice: createFakeGpu().gpu });
      if (gpu === "require") expect(await reason(prepared.render(VIEW))).toBe("out-of-memory");
      else {
        const result = await prepared.render(VIEW);
        expect(result.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "out-of-memory", conformance: { passed: true } });
        expect(result.image.samples).toEqual((await simulateDisplayView(REQUEST, VIEW)).image.samples);
      }
      prepared.dispose();
    }
    // The engine renderer on the fake device: one render's out-of-memory scope, then the GPU again.
    setDisplayViewGpuRendererFactory(engineRendererFactory);
    const request = { scene: { preset: "checkerboard" }, subjectDistanceM: 2, sensor: { pixelPitchMicrometers: 6 }, output: { ...SMALL_FRAME, format: "srgb-8" } } as SimulateCaptureOptions;
    const region = { ...SMALL_VIEW, region: { x: 90, y: 60, width: 16, height: 12 } };
    const fake = createFakeGpu(), prepared = await prepareDisplayView(request, { gpu: "auto", gpuDevice: fake.gpu });
    expect((await prepared.render(region)).diagnostics.fast.execution.backend).toBe("webgpu-f32");
    fake.controls.failNextScope = "out-of-memory";
    expect((await prepared.render(region)).diagnostics.fast.execution.fallbackReason).toBe("out-of-memory");
    expect((await prepared.render(region)).diagnostics.fast.execution.backend).toBe("webgpu-f32");
    prepared.dispose();
  }, testTimeout(120_000));

  it("the render's signal aborts a GPU render with the engine's error", async () => {
    const controller = new AbortController();
    setDisplayViewGpuRendererFactory(fakeRenderer({ onRender: (part) => { controller.abort(); if (part.signal?.aborted) throw new ImageKernelExecutionError("aborted", "aborted"); } }).factory);
    const prepared = await prepareDisplayView(REQUEST, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    await expect(prepared.render(VIEW, { signal: controller.signal })).rejects.toThrow(/aborted/u);
    expect((await prepared.render(VIEW)).diagnostics.fast.execution.backend).toBe("webgpu-f32");
    prepared.dispose();
  });
});
