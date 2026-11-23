// SPDX-License-Identifier: Apache-2.0
/**
 * #767: the display view with camera motion or a moving subject, `lens.diffraction`, the four-spot filter and a 2 × 2 box. The view's
 * lens signal (display-view-lens-signal.ts) already sums each site's kernel taps on the site lattice; it was refused by the capture's
 * per-tap count. Since #767 the capture's lattice flag (#761) also holds for a view, so the view counts its queries as the capture does,
 * without the taps, and reports `execution: "image-space-convolution"` where the taps pass 100000.
 *
 * Part 3 of 3 (regions, combinations, refusals and the estimate). One file in 2.29.0's group V, split at integration for the per-file coverage budget; the
 * requests are in test/helpers/display-view-motion-diffraction-cases.ts, and the cases and bounds are unchanged.
 */
import { describe, expect, it } from "vitest";
import { estimateDisplayViewRender, prepareDisplayView, simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { defocus, execution, handheld, request, subject, yaw, type Request } from "./helpers/display-view-motion-diffraction-cases.js";

describe("the display view with motion, lens.diffraction and the anti-aliasing filter (#767)", () => {
  it("is region-identical and the same when prepared: yaw, a moving subject and rolling yaw, fast and full", async () => {
    for (const fast of [true, false]) for (const o of [{ motion: yaw }, { motion: subject }, { motion: { ...yaw, shutter: "rolling" as const }, shutterSeconds: 1 / 60 }]) {
      const options = request({ ...o, width: 48, height: 32, fast }), whole = await simulateDisplayView(options, { width: 16, height: 12 }), prepared = await prepareDisplayView(options);
      try {
        const part = await prepared.render({ width: 16, height: 12, region: { x: 5, y: 3, width: 6, height: 5 } }), expected: number[] = [];
        for (let y = 3; y < 8; y++) for (let x = 5 * 3; x < 11 * 3; x++) expected.push(whole.image.samples[y * 16 * 3 + x]!);
        expect(Array.from(part.image.samples)).toEqual(expected);
        expect(Array.from((await prepared.render({ width: 16, height: 12 })).image.samples)).toEqual(Array.from(whole.image.samples));
      } finally { prepared.dispose(); }
    }
  }, scaledTimeout(120_000));

  it("renders each combination, fast and full, on the CPU reference, with the capture's execution label", async () => {
    const vignetting = { vignetting: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { r2: -0.3, r4: 0, r6: 0 } } };
    const cases: [string, Request][] = [
      ["yaw", { motion: yaw }], ["hand shake", { motion: handheld }], ["moving subject", { motion: subject }], ["panned subject", { motion: { ...yaw, ...subject } }],
      ["rolling yaw", { motion: { ...yaw, shutter: "rolling" }, shutterSeconds: 1 / 60 }], ["yaw, lens.defocus", { motion: yaw, lens: defocus }],
      ["yaw, AHD", { motion: yaw, output: { demosaic: "ahd" } }], ["still, vignetting, f/16 on 4 µm", { pitch: 4, fNumber: 16, lens: vignetting }]];
    const labels: string[] = [];
    for (const fast of [true, false]) for (const [name, o] of cases) {
      const prepared = await prepareDisplayView(request({ ...o, width: 48, height: 32, fast }));
      try {
        const s = estimateDisplayViewRender(prepared, { width: 24, height: 16 }).signal, result = await prepared.render({ width: 24, height: 16 });
        expect(result.image.samples.length, name).toBe(24 * 16 * 3);
        expect(result.diagnostics.fast.execution.backend, name).toBe("cpu-reference");
        // Temporal samples × spectral nodes × filter spots × box nodes × taps.
        const label = execution(result);
        expect(label, name).toBe(s.queryOffsets * s.spectralNodes * s.temporalMidpoints * s.tapsPerSite > 1e5 ? "image-space-convolution" : "environment-psf-quadrature");
        labels.push(label);
      } finally { prepared.dispose(); }
    }
    // Under 100000 taps on a fast request only: the moving subject (3 midpoints) and the still camera (one instant).
    expect(labels.filter((l) => l === "environment-psf-quadrature").length).toBe(2);
  }, scaledTimeout(120_000));

  it("keeps the refusals: a catalogue lens with motion and the filter, motion.subject under a rolling shutter or rotating, and a count over the bound without the taps", async () => {
    const view = { width: 24, height: 16 }, catalogue = { ...request({ motion: yaw, width: 48, height: 32, fast: false }), lens: { catalogue: "pv-50-1.8", fNumber: 8 } } as SimulateCaptureOptions;
    const catalogueText = "These options need 435456 scene queries per site (temporal samples × spectral nodes × pupil rays × filter spots × pixel-aperture nodes × PSF taps: 16 × 21 × 1 × 4 × 4 × 81)";
    await expect(simulateCapture(catalogue)).rejects.toThrow(catalogueText);
    await expect(simulateDisplayView(catalogue, view)).rejects.toThrow(catalogueText);
    const sideways = /^simulateDisplayView does not support motion.subject with a rolling shutter or angularVelocityRadPerSec/u;
    await expect(simulateDisplayView(request({ motion: { ...subject, shutter: "rolling" }, width: 48, height: 32 }), view)).rejects.toThrow(sideways);
    await expect(simulateDisplayView(request({ motion: { subject: { angularVelocityRadPerSec: 1 } }, width: 48, height: 32 }), view)).rejects.toThrow(sideways);
    // 128 temporal samples at a 5 nm step: the same sentence for the capture and the view, the taps' factor 1.
    const count = request({ motion: yaw, sensor: { temporalSampleCount: 128, spectralStepNanometers: 5 }, width: 48, height: 32 });
    const countText = "These options need 165888 scene queries per site (temporal samples × spectral nodes × pupil rays × filter spots × pixel-aperture nodes × PSF taps: 128 × 81 × 1 × 4 × 4 × 1); the environment admits at most 100000.";
    await expect(simulateCapture(count)).rejects.toThrow(countText);
    await expect(simulateDisplayView(count, view)).rejects.toThrow(countText);
  }, scaledTimeout(60_000));

  it("estimates the render: taps at 16 midpoints, and site counts that bracket the render's diagnostics", async () => {
    const prepared = await prepareDisplayView(request({ motion: yaw, width: 48, height: 32, fast: false })), view = { width: 24, height: 16 };
    try {
      const estimate = estimateDisplayViewRender(prepared, view), d = (await prepared.render(view)).diagnostics;
      expect(estimate.signal.method).toBe("taps");
      expect(estimate.signal.temporalMidpoints).toBe(16);
      expect(d.sampleCount).toBeGreaterThanOrEqual(estimate.sampleCount.minimum);
      expect(d.sampleCount).toBeLessThanOrEqual(estimate.sampleCount.maximum);
      expect(d.siteEvaluations).toBeGreaterThanOrEqual(estimate.siteEvaluations.minimum);
      expect(d.siteEvaluations).toBeLessThanOrEqual(estimate.siteEvaluations.maximum);
    } finally { prepared.dispose(); }
  }, scaledTimeout(60_000));
});
