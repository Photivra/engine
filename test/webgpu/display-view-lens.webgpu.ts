// SPDX-License-Identifier: Apache-2.0
/**
 * #655 (G1): real-GPU conformance of the catalogue-lens passes (`npm run test:webgpu`) against the float64 CPU lens signal: the
 * fixtures of test/display-view-lens-gpu.test.ts on the device, the lens self-check case, and the GPU time of a catalogue-lens part
 * against the same part through a prime (recorded; asserted only with PHOTIVRA_WEBGPU_REQUIRE_HARDWARE=1, where it is the release
 * gate of docs/WEBGPU_DEVICES.md: within 3× the prime's). Timings from a software adapter are recorded, not GPU performance.
 */
import { describe, expect, it } from "vitest";
import { NATIVE_RAW_LIMITS, type SimulateCaptureOptions } from "../../src/index.js";
import { SMALL_FRAME, SMALL_VIEW, compareDisplayViews } from "../helpers/display-view-gpu-fixture.js";
import { layeredScene } from "../helpers/chart-composite-fixtures.js";
import { APP_CHART } from "../helpers/display-view-lens-gpu-fixture.js";
import { useDisplayViewPage, type QualityPageResult } from "./display-view-page.js";

const { call, guard, report } = useDisplayViewPage("display-view-lens");
const base = { subjectDistanceM: 2, lens: { catalogue: "pv-50-1.2-pro", fNumber: 8 }, sensor: { pixelPitchMicrometers: 6 }, output: { ...SMALL_FRAME, format: "srgb-8" as const } };
const REGION = { ...SMALL_VIEW, region: { x: 60, y: 40, width: 48, height: 32 } };
const cases: [string, SimulateCaptureOptions, typeof REGION][] = [
  ["the app's composite chart", { ...base, scene: APP_CHART } as SimulateCaptureOptions, REGION],
  ["Siemens star", { ...base, scene: { preset: "siemens-star" } } as SimulateCaptureOptions, REGION],
  ["dead leaves", { ...base, scene: { preset: "dead-leaves" } } as SimulateCaptureOptions, REGION],
  ["material-layers scene", { ...base, scene: layeredScene(SMALL_FRAME.height / SMALL_FRAME.width) } as SimulateCaptureOptions, REGION],
  ["pv-16-2.8 wide open, 2 × 2 box, four-spot filter, fixed-size chart", { ...base, lens: { catalogue: "pv-16-2.8", fNumber: 2.8 }, scene: { preset: "siemens-star", cycles: 24 },
    chartSize: { widthM: 1.2, surroundReflectance: 0.2 }, sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" } } } as SimulateCaptureOptions,
  { ...SMALL_VIEW, region: { x: 0, y: 0, width: 40, height: 24 } }]
];

type LensPageResult = QualityPageResult & { latticePointsResolved: number; zonesUploaded: number; probe: { productPath: string | null } };

describe("webgpu-f32 catalogue-lens display view vs the float64 reference", () => {
  it.each(cases)("%s: every component inside the a-priori bounds; samples within one code; flagged pixels the reference's", async (name, options, view) => {
    if (guard()) return;
    const result = await call<LensPageResult>("displayViewLens", { options, view });
    const a = compareDisplayViews(result.cpu, result.gpu);
    expect(result.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32" });
    expect(a.outsideExpectedBound).toBe(0);
    expect(a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(Array.from(result.hostRecomputedPixelIndices)).toEqual(Array.from(result.flaggedPixelIndices));
    for (const i of result.flaggedPixelIndices) for (let c = 0; c < 3; c++) expect(result.gpu.samples[3 * i + c]).toBe(result.cpu.samples[3 * i + c]);
    expect(Array.from(result.gpu.saturated)).toEqual(Array.from(result.cpu.saturated));
    report.push({ case: "lens: " + name, pixels: a.pixels, deltaE2000Maximum: a.deltaEMaximum, sigmaUnitsMaximum: a.sigmaUnitsMaximum, differingSamples: a.differingSamples,
      flagged: result.flaggedPixelIndices.length, latticePointsResolved: result.latticePointsResolved, zonesUploaded: result.zonesUploaded, productPath: result.probe.productPath,
      largestExpectedBoundRatio: a.largestExpectedRatio, largestVarianceBoundRatio: a.largestVarianceRatio, tapsPerSite: result.tapsPerSite,
      gpuMilliseconds: result.gpuMilliseconds, stageMilliseconds: result.stageMilliseconds });
  });

  it("the lens self-check case passes on the device", async () => {
    if (guard()) return;
    expect((await call<{ outcome: true | string }>("displayViewLensConformance", {})).outcome).toBe(true);
  });

  it("times a catalogue-lens part against the same part through a prime (the 6000 × 4000 frame at 2028 × 1352, a 96 × 64 part, the point aperture)", async () => {
    if (guard()) return;
    const frame = { subjectDistanceM: 2, sensor: { pixelPitchMicrometers: 6 }, output: { width: 6000, height: 4000, format: "srgb-8" as const, maximumPixels: NATIVE_RAW_LIMITS.ceilingPixels }, scene: APP_CHART };
    const view = { width: 2028, height: 1352, region: { x: 960, y: 640, width: 96, height: 64 } };
    const timing = await call<{ catalogueMilliseconds: number; primeMilliseconds: number; catalogueRuns: number[]; primeRuns: number[] }>("displayViewLensTiming", {
      catalogue: { ...frame, lens: { catalogue: "pv-50-1.2-pro", fNumber: 8 } }, prime: { ...frame, lens: { prime: 50, fNumber: 8 } }, view, repeat: 5 });
    const ratio = timing.catalogueMilliseconds / timing.primeMilliseconds;
    report.push({ case: "lens timing: 96 × 64 part of 2028 × 1352 (6000 × 4000, point aperture)", ...timing, catalogueOverPrime: ratio });
    if (process.env.PHOTIVRA_WEBGPU_REQUIRE_HARDWARE === "1") expect(ratio).toBeLessThanOrEqual(3);
  });
});
