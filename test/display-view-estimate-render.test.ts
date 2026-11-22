// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { estimateDisplayViewRender, prepareDisplayView, type DisplayViewRenderEstimate, type SimulateCaptureOptions, type SimulateDisplayViewOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.28.0 (#660; planned for 2.27.0 as #651's method): estimateDisplayViewRender counts a CPU render's work without rendering. Its counts are the render's
 * diagnostics (sampleCount, siteEvaluations, detailPixelCount, uniformPixelCount) where they are exact, and bound them where the
 * samples are jittered; its methods are the ones the render's assumptions report.
 */

const lensCorrections = { distortion: true, lateralColor: true, vignetting: true };
const catalogue = { catalogue: "pv-24-1.8", fNumber: 1.8 } as const;
const fullFrame = (width: number): number => 36000 / width;
const cases: [string, SimulateCaptureOptions, SimulateDisplayViewOptions][] = [
  ["exact area mean (2 × 2 real pixels per display pixel)", { scene: { preset: "siemens-star" }, sensor: { spectralStepNanometers: 80 }, output: { width: 60, height: 40 } }, { width: 30, height: 20 }],
  ["stratified, with a region (10 × 10 real pixels per display pixel)", { scene: { preset: "dead-leaves" }, sensor: { pixelPitchMicrometers: 2, spectralStepNanometers: 80 }, output: { width: 240, height: 160 } },
    { width: 24, height: 16, region: { x: 5, y: 3, width: 11, height: 9 } }],
  ["sharpening (a view pass and a 1:1 pass)", { scene: { preset: "slanted-edge", angleDegrees: 20 }, lens: catalogue, sensor: { pixelPitchMicrometers: fullFrame(96), spectralStepNanometers: 80 },
    output: { width: 96, height: 64, sharpening: { radiusPixels: 1, amount: 1 } } }, { width: 48, height: 32 }],
  ["lens corrections with lateral colour (three passes)", { scene: { preset: "slanted-edge", angleDegrees: 20 }, lens: catalogue, sensor: { pixelPitchMicrometers: fullFrame(96), spectralStepNanometers: 80 },
    output: { width: 96, height: 64, lensCorrections } }, { width: 24, height: 16 }],
  ["AHD, the defocus regrouped and Recover", { scene: { preset: "siemens-star" }, subjectDistanceM: 2, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.4, defocus: { model: "geometric-disc" } },
    sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 80 }, output: { width: 120, height: 80, demosaic: "ahd", highlightMode: "reconstruct" } }, { width: 60, height: 40 }]
];

describe("estimateDisplayViewRender (#660)", () => {
  for (const [name, options, view] of cases) it(name, async () => {
    const prepared = await prepareDisplayView(options, { gpu: "off" });
    try {
      const estimate: DisplayViewRenderEstimate = estimateDisplayViewRender(prepared, view), result = await prepared.render(view);
      const d = result.diagnostics, value = (id: string): Record<string, unknown> | undefined => result.assumptions.find((a) => a.id === id)?.value as Record<string, unknown> | undefined;
      expect(estimate.displayPixels).toBe(result.image.width * result.image.height);
      expect(estimate.estimation).toBe(value("view.estimation")!.method);
      expect(estimate.sampleCount).toEqual({ minimum: d.sampleCount, maximum: d.sampleCount });
      expect(d.siteEvaluations).toBeGreaterThanOrEqual(estimate.siteEvaluations.minimum);
      expect(d.siteEvaluations).toBeLessThanOrEqual(estimate.siteEvaluations.maximum);
      if (estimate.estimation === "exact-area-mean-over-real-pixels") expect(estimate.siteEvaluations.maximum).toBe(d.siteEvaluations);
      expect({ detail: estimate.detailPixelCount, uniform: estimate.uniformPixelCount }).toEqual({ detail: d.detailPixelCount, uniform: d.uniformPixelCount });
      const defocus = value("view.defocus");
      expect(estimate.signal.method === "regrouped" || estimate.signal.method === "runs").toBe(defocus?.convolution === "runs");
      expect(estimate.chainPointsPerAxis).toBe((value("view.rendering")?.chainPointsPerAxis as DisplayViewRenderEstimate["chainPointsPerAxis"] | undefined) ?? null);
      const corrections = value("view.lensCorrections");
      if (corrections) expect(estimate.passes.view).toBe(corrections.passes);
      if (options.output?.sharpening) expect(estimate.passes).toEqual({ view: 1, realPixels: 1 });
      expect(estimate.nativeSites).toBeGreaterThan(0);
    } finally { prepared.dispose(); }
  }, scaledTimeout(120_000));

  it("names the methods: regrouped defocus, its disc and taps", async () => {
    const [, options, view] = cases[4]!, prepared = await prepareDisplayView(options, { gpu: "off" });
    let disc: number | null;
    try {
      const whole = estimateDisplayViewRender(prepared, view);
      disc = whole.signal.discRadiusSites;
      expect(whole.signal).toMatchObject({ method: "regrouped", kernelRadiusSites: 0, tapsPerSite: 1, temporalMidpoints: 1, rollingBandRows: null, lensPsfZoneSites: null, uniformWindows: null });
      expect(whole.signal.discRadiusSites).toBeGreaterThan(3);
      expect(whole.chainPointsPerAxis).toBe("3-or-6");
      // A region takes #642's cost choice per render, as the render does.
      const regionView = { ...view, region: { x: 30, y: 20, width: 2, height: 1 } }, small = estimateDisplayViewRender(prepared, regionView), rendered = await prepared.render(regionView);
      const defocus = rendered.assumptions.find((a) => a.id === "view.defocus")!.value as { convolution?: string };
      expect(small.signal.method === "regrouped").toBe(defocus.convolution === "runs");
    } finally { prepared.dispose(); }
    // fast: false takes the regrouped defocus too (#670 win 1, 2.28.0; the combined kernels before) and keeps the full chain rule.
    const exact = await prepareDisplayView({ ...options, fast: false });
    try {
      const estimate = estimateDisplayViewRender(exact, view);
      expect(estimate).toMatchObject({ signal: { method: "regrouped", kernelRadiusSites: 0, tapsPerSite: 1 }, chainPointsPerAxis: 16 });
      expect(estimate.signal.discRadiusSites).toBe(disc);
    } finally { exact.dispose(); }
  }, scaledTimeout(120_000));

  it("checks the view as render does", async () => {
    const prepared = await prepareDisplayView(cases[0]![1], { gpu: "off" });
    try { expect(() => estimateDisplayViewRender(prepared, { width: 0, height: 4 })).toThrow(/view.width/u); } finally { prepared.dispose(); }
  }, scaledTimeout(60_000));

  it("refuses a handle that prepareDisplayView did not return", () => {
    const handle = Object.freeze({ render: () => Promise.reject(new Error("not a view")) }) as unknown as Parameters<typeof estimateDisplayViewRender>[0];
    expect(() => estimateDisplayViewRender(handle, { width: 4, height: 4 })).toThrow("estimateDisplayViewRender needs a view returned by prepareDisplayView.");
  });
});
