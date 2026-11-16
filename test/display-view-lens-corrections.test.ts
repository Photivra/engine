// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, prepareDisplayView, simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #628: output.lensCorrections and output.sharpening in the display view (src/facade/display-view-detail.ts). The reference is the
 * definition of the view: the capture with the same options, decoded and area-averaged over each display pixel in linear light.
 * The thresholds of the rectilinear slanted-edge test (test/display-view.test.ts: 0.6-code RMS, 3 codes at most) apply where the view
 * claims them; the measured values are in docs/DISPLAY_VIEW.md ("Lens corrections and sharpening").
 */
const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
const W = 192, H = 128, all = { distortion: true, lateralColor: true, vignetting: true };
const lensRequest = (output: SimulateCaptureOptions["output"], fast: boolean): SimulateCaptureOptions => ({ scene: { preset: "slanted-edge", angleDegrees: 20 }, subjectDistanceM: 2,
  lens: { catalogue: "pv-24-1.8", fNumber: 1.8 }, fast, sensor: { pixelPitchMicrometers: 36000 / W, spectralStepNanometers: 40 }, output: { width: W, height: H, ...output },
  exposure: { mode: "manual", shutterSeconds: 1 / 2000, iso: 100 } });
const primeRequest = (output: SimulateCaptureOptions["output"], fast: boolean): SimulateCaptureOptions => ({ scene: { preset: "slanted-edge", angleDegrees: 20 }, subjectDistanceM: 2,
  lens: { prime: 50, fNumber: 8 }, fast, sensor: { pixelPitchMicrometers: 36000 / W, spectralStepNanometers: 40 }, output: { width: W, height: H, ...output },
  exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } });
/** The view's expected values against the box-downsized capture (8-bit codes): RMS and largest difference. */
async function against(options: SimulateCaptureOptions, viewWidth: number, reference?: SimulateCaptureOptions): Promise<{ rms: number; max: number; assumptions: string[] }> {
  const capture = await simulateCapture({ ...(reference ?? options), output: { ...(reference ?? options).output, format: "srgb-16" } });
  const VW = viewWidth, VH = viewWidth * H / W, s = W / VW;
  const { internals, result } = await simulateDisplayViewWithInternals(options, { width: VW, height: VH, samplesPerAxis: 16 });
  let sq = 0, max = 0;
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) for (let k = 0; k < 3; k++) {
    let r = 0;
    for (let y = s * j; y < s * j + s; y++) for (let x = s * i; x < s * i + s; x++) r += decode(capture.image.samples[(y * W + x) * 3 + k]!) / (s * s);
    const d = encode8(internals.expected[(j * VW + i) * 3 + k]!) - encode8(r);
    sq += d * d; max = Math.max(max, Math.abs(d));
  }
  return { rms: Math.sqrt(sq / (VW * VH * 3)), max, assumptions: result.assumptions.map((a) => a.id + ":" + String((a.value as { method?: string } | null)?.method)) };
}

describe("display view with output.lensCorrections (#628)", () => {
  it("matches the box-downsized corrected capture at 8 real pixels per display pixel, fast and exact", async () => {
    // The corrections matter here: the uncorrected view is about 26 codes RMS from the corrected capture (vignetting at the corners).
    const uncorrected = await against(lensRequest({}, true), 24, lensRequest({ lensCorrections: all }, true));
    expect(uncorrected.rms).toBeGreaterThan(10);
    const fast = await against(lensRequest({ lensCorrections: all }, true), 24);
    expect(fast.assumptions).toContain("view.lensCorrections:developed-footprint");
    // Measured: 0.16 code RMS, 2.2 at most.
    expect(fast.rms).toBeLessThan(0.6);
    expect(fast.max).toBeLessThan(3);
    const exact = await against(lensRequest({ lensCorrections: all }, false), 24);
    expect(exact.assumptions).toContain("view.lensCorrections:bilinear-sources");
    // Measured: 0.011 code RMS, 0.057 at most.
    expect(exact.rms).toBeLessThan(0.1);
    expect(exact.max).toBeLessThan(0.5);
  }, scaledTimeout(900_000));

  it("at 2 real pixels per display pixel: the exact method within a code; the fast one within its stated bound", async () => {
    // Measured: exact 0.031 code RMS and 0.18 at most; fast 0.26 code RMS and 12.1 at most, at the edge's demosaic overshoot, which the
    // capture interpolates before its tone curve clips it and the fast method reads after.
    const exact = await against(lensRequest({ lensCorrections: all }, false), 96);
    expect(exact.max).toBeLessThan(1);
    const fast = await against(lensRequest({ lensCorrections: all }, true), 96);
    expect(fast.rms).toBeLessThan(0.6);
    expect(fast.max).toBeLessThan(15);
  }, scaledTimeout(900_000));

  it("regions equal the whole view, prepared renders equal simulateDisplayView, and gpu \"auto\" renders on the CPU, labelled", async () => {
    const options = lensRequest({ lensCorrections: all, sharpening: { radiusPixels: 1, amount: 0.8 } }, true), view = { width: 48, height: 32 };
    const whole = await simulateDisplayView(options, view);
    expect(whole.assumptions.find((a) => a.id === "view.lensCorrections")!.value).toMatchObject({ passes: 3, method: "developed-footprint" });
    const region = { x: 30, y: 5, width: 11, height: 9 }, part = await simulateDisplayView(options, { ...view, region });
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let k = 0; k < 3; k++)
      expect(part.image.samples[(y * region.width + x) * 3 + k]).toBe(whole.image.samples[((region.y + y) * view.width + region.x + x) * 3 + k]);
    const prepared = await prepareDisplayView(options);
    const rendered = await prepared.render(view);
    expect(Array.from(rendered.image.samples)).toEqual(Array.from(whole.image.samples));
    expect(rendered.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
    await prepared.dispose();
    // Sharpening alone (no lens signal) also stays on the CPU, labelled.
    const sharpOnly = await prepareDisplayView(primeRequest({ sharpening: {} }, true));
    expect((await sharpOnly.render({ width: 24, height: 16 })).diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
    await sharpOnly.dispose();
  }, scaledTimeout(600_000));

  it("refuses what it does not render", async () => {
    const base = lensRequest({ lensCorrections: { vignetting: true }, highlightMode: "reconstruct" }, true);
    await expect(simulateDisplayView(base, { width: 24, height: 16 })).rejects.toThrow(/lensCorrections.vignetting with highlightMode/u);
    await expect(simulateDisplayView(lensRequest({ diffractionCorrection: {} }, true), { width: 24, height: 16 })).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateDisplayView(primeRequest({ lensCorrections: all }, true), { width: 24, height: 16 })).rejects.toThrow(/needs lens.catalogue/u);
    // Without the vignetting correction the gain is 1, so the coupled steps render.
    const reconstruct = await simulateDisplayView(lensRequest({ lensCorrections: { distortion: true }, highlightMode: "reconstruct" }, true), { width: 24, height: 16 });
    expect(reconstruct.image.samples.length).toBe(24 * 16 * 3);
  }, scaledTimeout(300_000));
});

describe("display view with output.sharpening (#628)", () => {
  it("matches the box-downsized sharpened capture at 1, 2 and 8 real pixels per display pixel", async () => {
    const sharpening = { radiusPixels: 1, amount: 1 };
    // The mask matters: the unsharpened view is 12.5 codes from the sharpened capture at 8× and 40 at 2× (at the edge).
    expect((await against(primeRequest({}, true), 24, primeRequest({ sharpening }, true))).max).toBeGreaterThan(10);
    for (const [viewWidth, fast] of [[192, true], [96, true], [24, true], [24, false]] as const) {
      const d = await against(primeRequest({ sharpening }, fast), viewWidth);
      expect(d.assumptions, String(viewWidth)).toContain("view.sharpening:real-pixel-mask");
      // Measured: at most 0.40 code at 1:1 (the reference's own noise), 0.24 at 2×, 0.054 at 8×.
      expect(d.rms, String(viewWidth)).toBeLessThan(0.1);
      expect(d.max, String(viewWidth)).toBeLessThan(1);
    }
  }, scaledTimeout(900_000));

  it("with the lens corrections, matches the corrected and sharpened capture", async () => {
    const d = await against(lensRequest({ lensCorrections: all, sharpening: { radiusPixels: 1, amount: 0.8 } }, true), 24);
    expect(d.rms).toBeLessThan(0.6);
    expect(d.max).toBeLessThan(3);
  }, scaledTimeout(600_000));
});
