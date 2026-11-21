// SPDX-License-Identifier: Apache-2.0
/**
 * #732 (owner decision 2026-11-21): with `lens.diffraction` and no `kernelRadiusSamples`, a request that resolves to fast takes the
 * Airy kernel window to the second dark ring at the longest spectral node (j₁,₂ = 7.0156, NIST DLMF Table 10.21.1); an exact request
 * (fast: false, "dng", "jpeg", "png") keeps the third ring, and an explicit radius always wins. The a-priori bound of the change at a
 * site, as a share of the scene contrast its CFA colour sees, is B = max over nodes of (T_fast − T_exact) / (1 − T_exact), T the
 * Airy energy outside each window.
 */
import { describe, expect, it } from "vitest";
import { simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createDisplayViewExpectedSignal } from "../src/facade/expected-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const at = (pitch: number, fNumber: number, extra: Partial<SimulateCaptureOptions> = {}, diffraction: NonNullable<SimulateCaptureOptions["lens"]>["diffraction"] = "circular-aperture"): SimulateCaptureOptions => ({
  scene: { preset: "siemens-star" }, lens: { fNumber, diffraction }, sensor: { pixelPitchMicrometers: pitch },
  output: { width: pitch === 6 ? 6000 : 4000, height: pitch === 6 ? 4000 : 3000, maximumPixels: 2 ** 25, region: { x: 1984, y: 1488, width: 8, height: 8 } }, ...extra });
const value = (r: { assumptions: readonly { id: string; value: unknown }[] }, id: string): Record<string, unknown> | undefined =>
  r.assumptions.find((a) => a.id === id)?.value as Record<string, unknown> | undefined;
const radius = (r: { assumptions: readonly { id: string; value: unknown }[] }): number => value(r, "lens.diffraction")!.kernelRadiusSamples as number;

describe("lens.diffraction: the default window follows the flag (#732)", () => {
  it("reaches the second dark ring on fast requests and the third on exact ones; an explicit radius wins", async () => {
    for (const [pitch, fNumber, third, second] of [[1.4, 8, 15, 10], [1.4, 4, 8, 5], [1.4, 16, 29, 20], [6, 8, 4, 3], [6, 16, 7, 5]] as const) {
      const fast = await simulateCapture(at(pitch, fNumber, { fast: true })), exact = await simulateCapture(at(pitch, fNumber, { fast: false }));
      expect([radius(fast), radius(exact)], `${pitch} µm f/${fNumber}`).toEqual([second, third]);
      expect(fast.diagnostics.fast.applied["lens.diffraction"]).toBe(true);
      expect(exact.diagnostics.fast.applied["lens.diffraction"]).toBe(false);
      expect(value(fast, "fast.lens.diffraction")!.window).toMatchObject({ method: "second-dark-ring", kernelRadiusSamples: second, exactKernelRadiusSamples: third });
    }
    // The format defaults: an sRGB capture is fast, a DNG, JPEG or PNG exact.
    for (const [format, expected] of [["srgb-8", 10], ["srgb-16", 10], ["dng", 15], ["jpeg", 15], ["png", 15]] as const) {
      const base = at(1.4, 8);
      expect(radius(await simulateCapture({ ...base, output: { ...base.output!, format } })), format).toBe(expected);
    }
    const explicit = await simulateCapture(at(1.4, 8, { fast: true }, { kind: "circular-aperture", kernelRadiusSamples: 15 }));
    expect(radius(explicit)).toBe(15);
    expect(explicit.diagnostics.fast.applied["lens.diffraction"]).toBe(false);
    expect(value(explicit, "fast.lens.diffraction")).toBeUndefined();
  }, scaledTimeout(300_000));

  it("keeps every native site's change within the bound, per CFA colour (1.4 µm f/8 and 6 µm f/16, Siemens star centre)", async () => {
    for (const [pitch, fNumber] of [[1.4, 8], [6, 16]] as const) {
      const W = pitch === 6 ? 6000 : 4000, H = pitch === 6 ? 4000 : 3000, view = { width: W, height: H, region: { x: W / 2 - 48, y: H / 2 - 48, width: 96, height: 96 } };
      const options = { ...at(pitch, fNumber), output: { width: W, height: H, maximumPixels: 2 ** 25 } };
      const fast = await simulateDisplayViewWithInternals(options, view), exact = await simulateDisplayViewWithInternals({ ...options, fast: false }, view);
      const bound = (value(fast.result, "fast.lens.diffraction")!.window as { bound: number }).bound;
      expect(bound).toBeGreaterThan(0);
      expect(bound).toBeLessThan(0.04);
      const a = createDisplayViewExpectedSignal(fast.signalInput), b = createDisplayViewExpectedSignal(exact.signalInput);
      const x0 = view.region.x, y0 = view.region.y, x1 = x0 + 96, y1 = y0 + 96;
      a.window(x0, y0, x1, y1); b.window(x0, y0, x1, y1);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], diff = [0, 0, 0];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const c = fast.signalInput.channelAt(x, y), e = b.site(x, y);
        lo[c] = Math.min(lo[c]!, e); hi[c] = Math.max(hi[c]!, e); diff[c] = Math.max(diff[c]!, Math.abs(a.site(x, y) - e));
      }
      for (let c = 0; c < 3; c++) expect(diff[c]!, `${pitch} µm f/${fNumber}, colour ${c}`).toBeLessThanOrEqual(bound * (hi[c]! - lo[c]!));
    }
  }, scaledTimeout(300_000));

  it("applies to display views with the default flag", async () => {
    const r = await simulateDisplayView({ ...at(1.4, 8), output: { width: 4000, height: 3000, maximumPixels: 2 ** 25 } }, { width: 400, height: 300, region: { x: 196, y: 146, width: 8, height: 8 } });
    expect(radius(r)).toBe(10);
  }, scaledTimeout(120_000));
});
