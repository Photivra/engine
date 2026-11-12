// SPDX-License-Identifier: Apache-2.0
/**
 * #492: one defocus case of the GPU display view on the float32 emulation against the CPU reference, with every check of
 * test/display-view-defocus-gpu.test.ts (shared with test/display-view-defocus-gpu-extra.test.ts since 2.22.0).
 */
import { expect } from "vitest";
import { DISPLAY_VIEW_QUALITY_FLAG } from "../../src/gpu/wgsl-display-view-quality-kernel.js";
import { createFakeGpu } from "./fake-webgpu.js";
import { compareDisplayViews, displayViewGpuFixture, renderOnGpuQuality, runtimeOf } from "./display-view-gpu-fixture.js";
import { acceptanceOf } from "./display-view-acceptance-metrics.js";
import type { DefocusGpuCase } from "./display-view-defocus-gpu-fixtures.js";

/** Renders a case on the emulation, compares it with the CPU reference and checks every requirement; returns the record. */
export async function checkDefocusGpuCase(c: DefocusGpuCase): Promise<Record<string, unknown>> {
  const fixture = await displayViewGpuFixture(c.options, c.view), runtime = await runtimeOf(createFakeGpu().gpu);
  try {
    expect(fixture.input.signalInput.kernels?.radius).toBe(c.kernelRadius);
    expect(fixture.input.setup.gpu?.defocusRadius).toBeGreaterThan(0);
    const t = performance.now();
    const gpu = await renderOnGpuQuality(runtime, fixture), emulationMs = Math.round(performance.now() - t);
    const a = compareDisplayViews(fixture.cpu, gpu), region = c.view.region!, { metrics, verdict } = acceptanceOf(region.width, region.height, fixture.cpu, gpu);
    expect(gpu.blockedSum).toBe(true);
    expect(gpu.estimation).toBe("exact-area-mean");
    expect(gpu.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32", bitIdenticalToReference: false });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(a.deltaEMaximum).toBeLessThan(0.01);
    expect(a.sigmaUnitsMaximum).toBeLessThan(0.01);
    expect(verdict.pass, JSON.stringify(verdict.checks)).toBe(true);
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    // The host resolved every uncertain lattice point, so no site carries material uncertainty and no pixel is flagged for it.
    expect(gpu.pixelFlags.some((flag) => (flag & DISPLAY_VIEW_QUALITY_FLAG.materialUncertain) !== 0)).toBe(false);
    for (const i of gpu.flaggedPixelIndices) for (let k = 0; k < 3; k++) expect(gpu.expected[3 * i + k]).toBe(fixture.cpu.expected[3 * i + k]);
    return { case: c.name, kernelRadius: c.kernelRadius, tapsPerSite: gpu.tapsPerSite, siteSumRelativeBound: gpu.siteSumRelativeBound, pixels: a.pixels,
      deltaE2000Maximum: a.deltaEMaximum, deltaE2000Rms: a.deltaERms, sigmaUnitsMaximum: a.sigmaUnitsMaximum, sigmaRelativeMaximum: a.sigmaRelativeMaximum,
      differingSamples: a.differingSamples, largestCodeDifference: a.largestCodeDifference, largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio,
      expectedValueBoundAbsolute: gpu.expectedValueBound.absolute, flagged: gpu.flaggedPixelIndices.length, flaggedFraction: gpu.flaggedPixelIndices.length / a.pixels,
      acceptance: { withinFraction: metrics.withinFraction, maxDeltaE: metrics.maxDeltaE, maxSigma: metrics.maxSigma, maxCode8: metrics.maxCode8, pass: verdict.pass },
      latticePointsResolved: gpu.latticePointsResolved, siteDispatches: gpu.stageMilliseconds.siteDispatches, emulationMs };
  } finally { runtime.destroy(); }
}

