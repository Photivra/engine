// SPDX-License-Identifier: Apache-2.0
/**
 * #594 (owner, 2026-11-10): `prepareQualityPaths()` loads the on-demand full-quality code ahead of time (single flight, idempotent,
 * retried after a failed load), and a GPU Quality render whose code does not load runs the CPU reference, labelled
 * `quality-code-unavailable`, with the CPU's bytes; the next render loads the code and runs on the GPU. The loader is replaced
 * through the renderer's test hook so a load can fail deterministically.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ImageKernelExecutionError, prepareDisplayView, prepareQualityPaths } from "../src/index.js";
import { setDisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.js";
import { registerDisplayViewGpuRenderer, setDisplayViewQualityGpuLoader } from "../src/gpu/display-view-gpu-renderer.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { QUALITY_CASES } from "./helpers/display-view-quality-cases.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

type Kit = typeof import("../src/gpu/display-view-quality-gpu.js");
let loads = 0, failNext = 0;
const loader = async (): Promise<Kit> => {
  loads++;
  if (failNext > 0) { failNext--; throw new Error("chunk download failed (test)"); }
  return import("../src/gpu/display-view-quality-gpu.js");
};
afterEach(() => { setDisplayViewQualityGpuLoader(null); setDisplayViewGpuRendererFactory(null); });

describe("on-demand full-quality code (#594)", () => {
  // One test: prepareQualityPaths remembers a successful load for the realm.
  it("prepareQualityPaths: a failed load rejects and is retried; concurrent calls share one load; later calls load nothing", async () => {
    setDisplayViewQualityGpuLoader(loader);
    loads = 0; failNext = 1;
    const failed = await prepareQualityPaths().then(() => null, (error: unknown) => error);
    expect(failed).toBeInstanceOf(ImageKernelExecutionError);
    expect((failed as ImageKernelExecutionError).reason).toBe("quality-code-unavailable");
    expect((failed as Error).message).toMatch(/chunk download failed/u);
    const [a, b] = [prepareQualityPaths(), prepareQualityPaths()];
    expect(a).toBe(b);
    await expect(a).resolves.toBeUndefined();
    expect(loads).toBe(2);
    await expect(prepareQualityPaths()).resolves.toBeUndefined();
    expect(loads).toBe(2);
  });

  it("a Quality render whose code does not load runs the CPU reference, labelled; the next render loads it and runs on the GPU", async () => {
    const previous = registerDisplayViewGpuRenderer();
    try {
      setDisplayViewQualityGpuLoader(loader);
      loads = 0; failNext = 1;
      const options = QUALITY_CASES[3]![1], view = { width: 203, height: 135, region: { x: 70, y: 50, width: 16, height: 10 } };
      const cpu = await prepareDisplayView(options, { gpu: "off" }), gpu = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      try {
        const reference = await cpu.render(view), fallen = await gpu.render(view);
        expect(fallen.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "quality-code-unavailable", assurance: "engine-reference" });
        expect(fallen.diagnostics.fast.execution.limitations.join(" ")).toMatch(/chunk download failed/u);
        expect(Array.from(fallen.image.samples)).toEqual(Array.from(reference.image.samples));
        const rendered = await gpu.render(view);
        expect(rendered.diagnostics.fast.execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null, conformance: { passed: true } });
        expect(loads).toBe(2);
      } finally { cpu.dispose(); gpu.dispose(); }
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(600_000));
});
