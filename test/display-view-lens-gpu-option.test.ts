// SPDX-License-Identifier: Apache-2.0
/**
 * #661: a catalogue-lens view through the public API (`prepareDisplayView` with `gpu: "auto" | "require"`) on the fake device: a still
 * rectilinear catalogue view in field zones renders on the GPU lens passes (before #661 no public request reached them); camera
 * rotation, `fast: false`, a fisheye and `flare` run the CPU reference with their reason; `require` throws for them. With the #708
 * review's two lens cases: an aborted render does not end the shared lens self-check a concurrent render waits for (#675), and a lens
 * kernel the device refuses after the self-check falls back under `auto`, labelled `gpu-validation` (#692).
 */
import { afterEach, describe, expect, it } from "vitest";
import { prepareDisplayView, type DisplayViewResult, type SimulateCaptureOptions } from "../src/index.js";
import { setDisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.js";
import { displayViewGpuRendererFactory } from "../src/gpu/display-view-gpu-renderer.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_FRAME, SMALL_VIEW } from "./helpers/display-view-gpu-fixture.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const still = { scene: { preset: "siemens-star" }, subjectDistanceM: 2, lens: { catalogue: "pv-50-1.2-pro", fNumber: 8 }, sensor: { pixelPitchMicrometers: 6 },
  output: { ...SMALL_FRAME, format: "srgb-8" } } as SimulateCaptureOptions;
const region = (x: number, y: number): typeof SMALL_VIEW & { region: { x: number; y: number; width: number; height: number } } => ({ ...SMALL_VIEW, region: { x, y, width: 16, height: 12 } });
const execution = (result: DisplayViewResult): DisplayViewResult["diagnostics"]["fast"]["execution"] => result.diagnostics.fast.execution;
const reason = async (promise: Promise<unknown>): Promise<string> => promise.then(() => "resolved", (error: unknown) => (error as { reason?: string }).reason ?? (error as Error).name);

describe("catalogue-lens display views through prepareDisplayView (#661)", () => {
  afterEach(() => { setDisplayViewGpuRendererFactory(displayViewGpuRendererFactory); });

  it("a still catalogue-lens view renders on webgpu-f32 under auto, equal to the CPU reference within one code", async () => {
    const prepared = await prepareDisplayView(still, { gpu: "auto", gpuDevice: createFakeGpu().gpu }), cpu = await prepareDisplayView(still, { gpu: "off" });
    const view = region(90, 60), [gpu, reference] = [await prepared.render(view), await cpu.render(view)];
    expect(execution(gpu)).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, conformance: { passed: true } });
    let largest = 0;
    for (let i = 0; i < gpu.image.samples.length; i++) largest = Math.max(largest, Math.abs(gpu.image.samples[i]! - reference.image.samples[i]!));
    expect(largest).toBeLessThanOrEqual(1);
    prepared.dispose(); cpu.dispose();
  }, scaledTimeout(180_000));

  // #685 on the GPU: with several query offsets the lens passes map every offset through the lens; view.execution says so.
  it("a box-aperture catalogue view on webgpu-f32 reports the GPU's offset mapping in view.execution", async () => {
    const offsetMapping = (result: DisplayViewResult): unknown => (result.assumptions.find((a) => a.id === "view.execution")?.value as { offsetMapping?: unknown } | undefined)?.offsetMapping;
    const box = { ...still, sensor: { pixelPitchMicrometers: 6, pixelAperture: "box" } } as SimulateCaptureOptions;
    const prepared = await prepareDisplayView(box, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    const result = await prepared.render(region(90, 60));
    expect(execution(result).backend).toBe("webgpu-f32");
    expect(offsetMapping(result)).toBe("lens-mapping-per-offset");
    expect((result.assumptions.find((a) => a.id === "view.lensPsf")?.value as { offsetMapping?: unknown }).offsetMapping).toBe("second-order-expansion");
    const plain = await prepareDisplayView(still, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    const one = await plain.render(region(90, 60));
    expect(execution(one).backend).toBe("webgpu-f32");
    expect(offsetMapping(one)).toBeUndefined();
    prepared.dispose(); plain.dispose();
  }, scaledTimeout(180_000));

  const refused: [string, SimulateCaptureOptions, RegExp][] = [
    ["camera rotation", { ...still, motion: { angularVelocityRadPerSec: { pitch: 0.2, yaw: 0.5, roll: 3 } }, sensor: { pixelPitchMicrometers: 6, temporalSampleCount: 3 } } as SimulateCaptureOptions, /rotation/u],
    ["fast: false (the PSF at every site)", { ...still, fast: false } as SimulateCaptureOptions, /field zones|fast: false/u],
    ["a fisheye catalogue lens", { ...still, lens: { catalogue: "pv-15-2.8-fisheye-pro", fNumber: 2.8 } } as SimulateCaptureOptions, /fisheye/u],
    ["lens.catalogue.flare", { ...still, lens: { catalogue: { kind: "pv-50-1.2-pro", flare: true }, fNumber: 8 } } as SimulateCaptureOptions, /flare/u]
  ];
  it.each(refused)("%s: the CPU reference under auto, with its reason; require throws", async (_name, options, why) => {
    const prepared = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    const result = await prepared.render(region(90, 60));
    expect(execution(result)).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
    expect(execution(result).limitations.join(" ")).toMatch(why);
    prepared.dispose();
    expect(await reason(prepareDisplayView(options, { gpu: "require", gpuDevice: createFakeGpu().gpu }))).toBe("unsupported-on-backend");
  }, scaledTimeout(180_000));

  // #675 with a lens: the lens case runs in the shared on-demand check under the session's signal, so aborting the render that
  // started it (here as the Quality host loads, before the lens chunk) does not fail a concurrent render.
  it("an aborted render does not end the lens self-check a concurrent render waits for (#675)", async () => {
    const fake = createFakeGpu(), prepared = await prepareDisplayView(still, { gpu: "auto", gpuDevice: fake.gpu }), controller = new AbortController();
    fake.controls.beforeDispatch = (count): void => { if (count === 3) controller.abort(); };
    const a = prepared.render(region(90, 60), { signal: controller.signal }), b = prepared.render(region(20, 20));
    expect(await reason(a)).not.toBe("resolved");
    expect(execution(await b)).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, conformance: { passed: true } });
    expect(execution(await prepared.render(region(20, 20))).backend).toBe("webgpu-f32");
    prepared.dispose();
  }, scaledTimeout(180_000));

  // #692 with a lens: a pipeline the device refuses (from the k-th dispatch on) is a CPU fallback under auto. gpu-04 (#702): the
  // device and lens self-checks build every pipeline this view renders with (one cache per device), so a refusal during them is
  // conformance-failed, and after them the render compiles nothing and runs on the GPU.
  it("a lens kernel the device refuses during the self-check falls back under auto (conformance-failed); after it the render reuses the checked pipelines (#692, gpu-04)", async () => {
    const reference = (await (await prepareDisplayView(still, { gpu: "off" })).render(region(90, 60))).image.samples, outcomes = new Set<string>();
    for (const k of [24, 28, 30, 31, 34]) for (const gpu of ["auto", "require"] as const) {
      const fake = createFakeGpu();
      fake.controls.beforeDispatch = (count): void => { if (count === k) fake.controls.failPipeline = true; };
      const prepared = await prepareDisplayView(still, { gpu, gpuDevice: fake.gpu });
      if (gpu === "require") expect(["conformance-failed", "resolved"]).toContain(await reason(prepared.render(region(90, 60))));
      else {
        const result = await prepared.render(region(90, 60)), e = execution(result);
        if (e.backend === "cpu-reference") {
          expect(e.fallbackReason).toBe("conformance-failed");
          expect(Array.from(result.image.samples)).toEqual(Array.from(reference));
        }
        outcomes.add(e.fallbackReason ?? e.backend);
      }
      prepared.dispose();
    }
    expect([...outcomes].sort()).toEqual(["conformance-failed", "webgpu-f32"]);
  }, scaledTimeout(600_000));
});
