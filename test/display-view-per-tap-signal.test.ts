// SPDX-License-Identifier: Apache-2.0
/**
 * #643, the display view's per-tap chart signal (a fast method in 2.26.0 and 2.27.0; on every CPU render since 2.28.0, #670 win 1). From 2.21.0 each chart site's signal is
 * integrated from its materials' spectra (no per-material channel values). 2.21.0–2.25.0 formed per-material sums of the taps' kernels
 * first (`createMaterialSums`); on a fast request the CPU reference now adds the taps in order, each integrated from its material's
 * spectrum per spectral node, which is the same sum regrouped and about 1.6–1.7 times faster on fine chart detail (a 768 × 16 band of
 * a 200 mm wall-chart frame: 7.8 s → 4.5–4.8 s CPU, the same 8-bit samples). Still integrated per site at use.
 *
 * - The fast default takes it and labels it (`view.signal`); `fast: false` keeps the per-material sums.
 * - Expected values within 1e-12 relative of the per-material sums; 8-bit samples within one code.
 * - Sites are the same through a filled window and through the lazy kernel path (bit for bit), so regions equal the whole view.
 * - Cost: the per-tap sum of mixed-material sites under 0.85 of the per-material sums' time (relative, one process).
 */
import { describe, expect, it } from "vitest";
import { createDisplayViewExpectedSignal } from "../src/facade/expected-signal.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { prepareDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const W = 1200, H = 800, g = 2 / W, MATERIALS = 256;
// Fine detail: a new material every lattice point or two, so almost every site's kernel reads several materials.
const fine = (p: { u: number; v: number }): number => {
  const x = Math.floor(p.u / (1.5 * g)), y = Math.floor(p.v / (1.5 * g));
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % MATERIALS;
};
const reflectances = Array.from({ length: MATERIALS }, (_, m) => 0.05 + 0.9 * m / (MATERIALS - 1));
const request = (fast?: boolean): SimulateCaptureOptions => ({
  scene: { kind: "material-function", sceneId: "per-tap-fine", materials: reflectances, materialAt: fine },
  subjectDistanceM: 2, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 60 },
  sensor: { pixelPitchMicrometers: 6, antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } },
  output: { width: W, height: H, demosaic: "ahd" },
  lens: { prime: 50, fNumber: 8, diffraction: "circular-aperture" },
  ...(fast === undefined ? {} : { fast }) });
const VIEW = { width: 300, height: 200, samplesPerAxis: 2, region: { x: 140, y: 90, width: 24, height: 16 } };
const signalOf = (result: { assumptions: readonly { id: string; value: unknown }[] }): unknown => result.assumptions.find((a) => a.id === "view.signal")?.value;

describe("display view: per-tap chart signal (#643)", () => {
  it("is taken with both flags (#670 win 1, 2.28.0; fast only before), equal to the per-material sums to rounding", async () => {
    const fast = await simulateDisplayViewWithInternals(request(), VIEW);
    const exact = await simulateDisplayViewWithInternals(request(false), VIEW);
    expect(signalOf(fast.result)).toEqual({ sum: "per-tap" });
    expect(signalOf(exact.result)).toEqual({ sum: "per-tap" });
    expect(fast.signalInput.perTapSum).toBe(true);
    expect(exact.signalInput.perTapSum).toBe(true);
    // The same input with the per-material sums: the expected electrons of every site agree to rounding.
    const perTap = createDisplayViewExpectedSignal(fast.signalInput), sums = createDisplayViewExpectedSignal({ ...fast.signalInput, perTapSum: false });
    let worst = 0, mixed = 0;
    for (let y = 400; y < 420; y++) for (let x = 600; x < 640; x++) {
      const a = perTap.site(x, y), b = sums.site(x, y);
      worst = Math.max(worst, Math.abs(a - b) / b);
      if (a !== b) mixed++;
    }
    expect(worst).toBeLessThan(1e-12);
    expect(mixed).toBeGreaterThan(0);
    // fast: false also turns off the quarter sampling of uniform pixels, which this scene (detail everywhere) does not use.
    const sa = fast.result.image.samples, sb = exact.result.image.samples;
    let codes = 0;
    for (let i = 0; i < sa.length; i++) codes = Math.max(codes, Math.abs(sa[i]! - sb[i]!));
    expect(codes).toBeLessThanOrEqual(1);
  }, scaledTimeout(600_000));

  it("gives a site the same value through a filled window and through the lazy kernel path", async () => {
    const { signalInput } = await simulateDisplayViewWithInternals(request(), VIEW);
    const filled = createDisplayViewExpectedSignal(signalInput), lazy = createDisplayViewExpectedSignal(signalInput);
    filled.window(590, 390, 650, 430);
    // Inside the window (filled bands), and just outside it (taps partly beyond the window cache).
    for (let y = 385; y < 435; y++) for (let x = 585; x < 655; x++) expect(filled.site(x, y)).toBe(lazy.site(x, y));
  }, scaledTimeout(600_000));

  it("renders a region of a prepared view bit for bit as the same pixels of a larger one", async () => {
    const view = await prepareDisplayView(request(), { gpu: "off" });
    const whole = await view.render({ ...VIEW, region: { x: 130, y: 80, width: 44, height: 36 } });
    const part = await view.render(VIEW);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) for (let c = 0; c < 3; c++)
      expect(part.image.samples[(y * 24 + x) * 3 + c]).toBe(whole.image.samples[((y + 10) * 44 + x + 10) * 3 + c]);
  }, scaledTimeout(600_000));

  it("sums mixed-material sites faster than the per-material sums", async () => {
    // Timing guard (relative, one process, minimum of repeats): the per-tap sum against the per-material sums of the same sites.
    const { signalInput } = await simulateDisplayViewWithInternals(request(), VIEW);
    const run = (perTapSum: boolean): number => {
      let best = Infinity;
      for (let r = 0; r < 5; r++) {
        const signal = createDisplayViewExpectedSignal({ ...signalInput, perTapSum }), t0 = performance.now();
        signal.window(500, 300, 560, 340);
        let s = 0;
        for (let y = 300; y < 340; y++) for (let x = 500; x < 560; x++) s += signal.site(x, y);
        best = Math.min(best, performance.now() - t0);
        expect(s).toBeGreaterThan(0);
      }
      return best;
    };
    run(true); run(false);
    expect(run(true) / run(false)).toBeLessThan(0.85);
  }, scaledTimeout(600_000));
});
