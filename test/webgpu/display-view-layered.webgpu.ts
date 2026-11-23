// SPDX-License-Identifier: Apache-2.0
/**
 * #750 (2.29.0, group LGPU): real-GPU conformance of the layered chart scene's display view (`npm run test:webgpu`) against the
 * float64 CPU layered signal: the cases of test/display-view-layered-gpu.test.ts on the device, and the layered self-check case.
 * Timings from a software adapter are recorded, not GPU performance.
 */
import { describe, expect, it } from "vitest";
import { compareDisplayViews } from "../helpers/display-view-gpu-fixture.js";
import { LAYERED_GPU_CASES } from "../helpers/display-view-layered-gpu-fixture.js";
import { useDisplayViewPage, type QualityPageResult } from "./display-view-page.js";

const { call, guard, report } = useDisplayViewPage("display-view-layered");

type LayeredPageResult = QualityPageResult & { layered: { edgePoints: number; spans: number; shares: number; sumDispatches: number }; siteSumRelativeBound: number };

describe("webgpu-f32 layered display view vs the float64 reference", () => {
  it.each(Object.keys(LAYERED_GPU_CASES))("%s: every component inside the a-priori bounds; samples within one code; flagged pixels the reference's", async (name) => {
    if (guard()) return;
    const result = await call<LayeredPageResult>("displayViewLayered", { name });
    const a = compareDisplayViews(result.cpu, result.gpu);
    expect(result.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(Array.from(result.hostRecomputedPixelIndices)).toEqual(Array.from(result.flaggedPixelIndices));
    for (const i of result.flaggedPixelIndices) for (let c = 0; c < 3; c++) expect(result.gpu.samples[3 * i + c]).toBe(result.cpu.samples[3 * i + c]);
    expect(Array.from(result.gpu.saturated)).toEqual(Array.from(result.cpu.saturated));
    expect(result.layered.edgePoints).toBeGreaterThan(0);
    report.push({ case: "layered: " + name, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, sigmaUnitsMaximum: a.sigmaUnitsMaximum, differingSamples: a.differingSamples,
      flagged: result.flaggedPixelIndices.length, largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio,
      siteSumRelativeBound: result.siteSumRelativeBound, ...result.layered, gpuMilliseconds: result.gpuMilliseconds, stageMilliseconds: result.stageMilliseconds });
  });

  // Timed on hardware only (PHOTIVRA_WEBGPU_REQUIRE_HARDWARE=1, `npm run test:webgpu:hardware`): a software adapter would take minutes
  // for the brute-force sums and its time is not GPU performance. Recorded, not asserted.
  it.each([[480, 360, 16], [480, 360, 41]])("times a %i × %i frame with %i nodes at radii 14 to 29 on the CPU and the device", async (width, height, nodes) => {
    if (guard() || process.env.PHOTIVRA_WEBGPU_REQUIRE_HARDWARE !== "1") return;
    const timing = await call<{ cpuMilliseconds: number; gpuRuns: number[]; outsideExpectedBound: number; outsideVarianceBound: number; largestCodeDifference: number;
      stageMilliseconds: Record<string, number>; layered: Record<string, number> }>("displayViewLayeredTiming", { width, height, nodes, repeat: 3 });
    expect(timing.outsideExpectedBound).toBe(0);
    expect(timing.outsideVarianceBound).toBe(0);
    expect(timing.largestCodeDifference).toBeLessThanOrEqual(1);
    const gpu = [...timing.gpuRuns].sort((a, b) => a - b)[1]!;
    report.push({ case: `layered timing: ${width} × ${height}, ${nodes} nodes, radii 14 to 29`, cpuMilliseconds: timing.cpuMilliseconds, gpuMilliseconds: gpu, gpuRuns: timing.gpuRuns,
      cpuOverGpu: timing.cpuMilliseconds / gpu, stageMilliseconds: timing.stageMilliseconds, ...timing.layered });
  });

  it("the layered self-check case passes on the device", async () => {
    if (guard()) return;
    expect((await call<{ outcome: true | string }>("displayViewLayeredConformance", {})).outcome).toBe(true);
  });
});
