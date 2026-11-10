// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { GENERIC_LENS_CATALOGUE, prepareDisplayView, resolveGenericLens, simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { exposure, differences, fullFrame, sceneEvaluator } from "./helpers/display-view-lens-catalogue.js";

/*
 * #569: the display view with lens.catalogue (src/facade/display-view-lens-signal.ts, createDisplayViewLensPsf). As for #563
 * (test/display-view-lens.test.ts), the reference is the capture's own environment record of each site (its catalogue PSF, resolved at
 * the site's own point by the environment PSF quadrature, its distortion, projection and vignetting), evaluated with the capture's scene.
 *
 * Tolerances. On frames of at most DISPLAY_VIEW_LENS_PSF_ZONES sites per side every zone is one site, so each site reads the PSF the
 * capture resolves at its centre: agreement to 1e-12 relative (rounding) with the point aperture. With the 2 × 2 box and the four-spot
 * filter the capture resolves the PSF at each query's own point, a fraction of a site away (2.5e-3 relative at most in the case below, out of focus). On a whole
 * 6 µm full frame (94-site zones) the zone approximation leaves at most 1 % per site and 3e-4 on average over the sampled sites
 * (measured: 0.66 % and 1.2e-4 at most over the lenses below, at dead-leaves edges, where the PSF's change matters most).
 */

describe("display view with lens.catalogue (#569)", () => {
  it("a whole 6 µm full frame (94-site zones): within 1 % per site and 3e-4 on average of the capture", async () => {
    const cases: [string, number, number][] = [["pv-24-1.8", 1.8, 3], ["pv-16-2.8", 2.8, 3], ["pv-100-2.8-macro-pro", 22, 0.2], ["pv-8-3.5-fisheye-pro", 3.5, 3]];
    for (const [lensId, fNumber, subjectDistanceM] of cases) {
      const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, output: fullFrame(6), sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 80 }, subjectDistanceM, exposure,
        lens: { catalogue: lensId, fNumber } };
      const capture = await simulateCapture({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 2, height: 2 } } });
      const { signal, result } = await simulateDisplayViewWithInternals(options, { width: 12, height: 8, samplesPerAxis: 1 });
      expect((result.assumptions.find((a) => a.id === "view.lensPsf")!.value as { zoneSites: number }).zoneSites).toBe(94);
      const d = differences(capture, signal, sceneEvaluator(options, capture), 6, 300);
      expect(d.largest, lensId).toBeLessThan(0.01);
      expect(d.mean, lensId).toBeLessThan(3e-4);
    }
  }, scaledTimeout(300_000));

  it("every one of the 30 lenses renders at its widest and narrowest f-number at its close focus, each site near the capture's", async () => {
    // #554: the three phone lenses need the phone sensor profile; test/sensor-profiles.test.ts renders them.
    const lenses = GENERIC_LENS_CATALOGUE.filter((lens) => lens.set !== "phone");
    expect(lenses).toHaveLength(30);
    for (const lens of lenses) {
      const resolved = resolveGenericLens({ lensId: lens.lensId, activeImagingArea: { widthMm: 36, heightMm: 24 } });
      for (const fNumber of [resolved.widestFNumber, resolved.narrowestFNumber]) {
        const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, output: fullFrame(12), sensor: { pixelPitchMicrometers: 12, spectralStepNanometers: 80 },
          subjectDistanceM: resolved.minimumFocusDistanceM, exposure: { ...exposure, shutterSeconds: (fNumber / 8) ** 2 / 125 }, lens: { catalogue: lens.lensId, fNumber } };
        const capture = await simulateCapture({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 2, height: 2 } } });
        const { signal, result } = await simulateDisplayViewWithInternals(options, { width: 6, height: 4, samplesPerAxis: 1 });
        const name = lens.lensId + " f/" + fNumber;
        expect(result.exposure.settings.fNumber, name).toBe(fNumber);
        expect(result.scene.distanceM, name).toBe(resolved.minimumFocusDistanceM);
        expect(result.image.samples.every((v) => Number.isFinite(v)), name).toBe(true);
        expect(differences(capture, signal, sceneEvaluator(options, capture), 12, 12).largest, name).toBeLessThan(0.01);
      }
    }
  }, scaledTimeout(600_000));

  it("matches the box-downsized capture: an edge through the consumer 24 mm wide open, with lateral colour and vignetting", async () => {
    const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
    const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
    const options: SimulateCaptureOptions = { scene: { preset: "slanted-edge", angleDegrees: 20 }, subjectDistanceM: 2, lens: { catalogue: "pv-24-1.8", fNumber: 1.8 },
      sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 40 }, output: { width: 192, height: 128 }, exposure: { mode: "manual", shutterSeconds: 1 / 2000, iso: 100 } };
    const capture = await simulateCapture({ ...options, output: { ...options.output, format: "srgb-16" } });
    const { internals, result } = await simulateDisplayViewWithInternals(options, { width: 24, height: 16, samplesPerAxis: 16 });
    expect((result.assumptions.find((a) => a.id === "view.lensPsf")!.value as { zoneSites: number }).zoneSites).toBe(4);
    let sq = 0, max = 0;
    for (let j = 0; j < 16; j++) for (let i = 0; i < 24; i++) for (let k = 0; k < 3; k++) {
      let reference = 0;
      for (let y = 8 * j; y < 8 * j + 8; y++) for (let x = 8 * i; x < 8 * i + 8; x++) reference += decode(capture.image.samples[(y * 192 + x) * 3 + k]!) / 64;
      const difference = encode8(internals.expected[(j * 24 + i) * 3 + k]!) - encode8(reference);
      sq += difference * difference; max = Math.max(max, Math.abs(difference));
    }
    // The thresholds of the rectilinear slanted-edge test (test/display-view.test.ts); the reference keeps its own noise.
    expect(Math.sqrt(sq / (16 * 24 * 3))).toBeLessThan(0.6);
    expect(max).toBeLessThan(3);
  }, scaledTimeout(240_000));

  it("regions equal the whole view, prepared renders equal simulateDisplayView, and the GPU modes fall back to the CPU, labelled", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "siemens-star", cycles: 16 }, output: { width: 240, height: 160 }, sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box", samplesPerAxis: 2 } },
      subjectDistanceM: 3, exposure, lens: { catalogue: "pv-16-2.8", fNumber: 2.8 } };
    const view = { width: 60, height: 40 };
    const whole = await simulateDisplayView(options, view);
    expect(whole.assumptions.some((a) => a.id === "view.lensPsf")).toBe(true);
    const region = await simulateDisplayView(options, { ...view, region: { x: 13, y: 9, width: 20, height: 14 } });
    for (let y = 0; y < 14; y++) for (let x = 0; x < 20; x++) for (let k = 0; k < 3; k++)
      expect(region.image.samples[(y * 20 + x) * 3 + k]).toBe(whole.image.samples[((y + 9) * 60 + x + 13) * 3 + k]);
    const prepared = await prepareDisplayView(options, { gpu: "auto" });
    const rendered = await prepared.render(view);
    expect(Array.from(rendered.image.samples)).toEqual(Array.from(whole.image.samples));
    expect(rendered.diagnostics.fast.execution.backend).toBe("cpu-reference");
    expect(rendered.diagnostics.fast.execution.fallbackReason).toBe("unsupported-on-backend");
    prepared.dispose();
  }, scaledTimeout(240_000));

  it("refuses what the capture refuses: settings outside the lens's range and closer than its close focus", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, output: { width: 240, height: 160 }, sensor: { pixelPitchMicrometers: 6 }, subjectDistanceM: 3, exposure };
    await expect(simulateDisplayView({ ...options, lens: { catalogue: "pv-50-1.8", fNumber: 1.4 } }, { width: 12, height: 8 })).rejects.toThrow(/outside the PV 50 1.8 range/);
    await expect(simulateDisplayView({ ...options, subjectDistanceM: 0.05, lens: { catalogue: "pv-50-1.8", fNumber: 2 } }, { width: 12, height: 8 })).rejects.toThrow(/focuses no closer than/);
    await expect(simulateDisplayView({ ...options, lens: { catalogue: "pv-50-1.8", diffraction: "circular-aperture" } }, { width: 12, height: 8 })).rejects.toThrow(/cannot be combined with lens.diffraction/);
  }, scaledTimeout(60_000));
});
