// SPDX-License-Identifier: Apache-2.0
/**
 * #612, the display view's regrouped defocus (fast method `lens.defocus/view-regrouped`). On the CPU, a disc much wider than the
 * diffraction kernel is applied after each channel's in-focus signal, by runs (#564's path above 64 sites), instead of as each
 * node's diffraction kernel convolved with it. Defocus of a plane is space-invariant and the same at every spectral node, so the
 * two are the same sum regrouped: the expected electrons agree to rounding and the samples to at most one code.
 *
 * - The fast default takes it and labels it (`view.defocus` convolution "runs", fast); `fast: false` keeps the combined kernels.
 * - Expected electrons within 1e-9 relative of the exact method's; 8-bit samples within one code.
 * - A region of a prepared view equals the same pixels of the whole view, bit for bit.
 * - A small disc beside a wide diffraction kernel keeps the combined kernels (the regrouped path would cost more).
 * - Cost: on fine material detail a 40 × 20-pixel region takes under half the exact method's time (relative, one process).
 */
import { describe, expect, it } from "vitest";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { prepareDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const W = 6000, H = 4000, g = 2 / W, MATERIALS = 256;
const fine = (p: { u: number; v: number }): number => {
  const x = Math.floor(p.u / (3 * g)), y = Math.floor(p.v / (3 * g));
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % MATERIALS;
};
const reflectances = Array.from({ length: MATERIALS }, (_, m) => 0.05 + 0.9 * m / (MATERIALS - 1));
const request = (fNumber: number, focusDistanceM: number, fast?: boolean): SimulateCaptureOptions => ({
  scene: { kind: "material-function", sceneId: "regrouped-fine", materials: reflectances, materialAt: fine },
  subjectDistanceM: 2, exposure: { mode: "manual", iso: 100, shutterSeconds: (1 / 30) * (fNumber / 2.8) ** 2 },
  sensor: { pixelPitchMicrometers: 6, antiAliasing: { kind: "four-spot" } },
  output: { width: W, height: H, maximumPixels: W * H * 2, demosaic: "ahd" },
  lens: { prime: 50, fNumber, focusDistanceM, diffraction: "circular-aperture", defocus: { model: "geometric-disc" } },
  ...(fast === undefined ? {} : { fast }) });
const VIEW = { width: 750, height: 500, samplesPerAxis: 1, region: { x: 369, y: 247, width: 12, height: 6 } };
const defocusOf = (result: { assumptions: readonly { id: string; value: unknown }[] }): Record<string, unknown> =>
  result.assumptions.find((a) => a.id === "view.defocus")!.value as Record<string, unknown>;

describe("display view: regrouped defocus (#612)", () => {
  it("is the fast default for a wide disc, equal to the combined kernels to rounding; fast: false keeps the combined kernels", async () => {
    const fast = await simulateDisplayViewWithInternals(request(2.8, 1.4), VIEW);
    const exact = await simulateDisplayViewWithInternals(request(2.8, 1.4, false), VIEW);
    expect(defocusOf(fast.result)).toMatchObject({ convolution: "runs", fast: "defocus-after-in-focus-signal" });
    expect(defocusOf(exact.result).convolution).toBeUndefined();
    expect(defocusOf(fast.result).defocusKernelRadiusSites as number).toBeGreaterThan(4 * (defocusOf(fast.result).diffractionKernelRadiusSites as number));
    // Same seed and same sample positions under both flags: compare the expected linear signal and the samples. fast: false also
    // turns off H2's quarter sampling of uniform pixels, which this scene (detail everywhere) does not use.
    const a = fast.internals.expected, b = exact.internals.expected;
    expect(a.length).toBe(b.length);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!) / Math.max(Math.abs(b[i]!), 1e-300));
    expect(worst).toBeLessThan(1e-9);
    const sa = fast.result.image.samples, sb = exact.result.image.samples;
    let codes = 0;
    for (let i = 0; i < sa.length; i++) codes = Math.max(codes, Math.abs(sa[i]! - sb[i]!));
    expect(codes).toBeLessThanOrEqual(1);
  }, scaledTimeout(600_000));

  it("renders a region of a prepared view bit for bit as the same pixels of the whole view", async () => {
    const view = await prepareDisplayView(request(2.8, 1.4), { gpu: "off" });
    const whole = await view.render({ width: 750, height: 500, samplesPerAxis: 1, region: { x: 369, y: 247, width: 8, height: 4 } });
    const part = await view.render({ width: 750, height: 500, samplesPerAxis: 1, region: { x: 371, y: 248, width: 4, height: 2 } });
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) for (let c = 0; c < 3; c++)
      expect(part.image.samples[(y * 4 + x) * 3 + c]).toBe(whole.image.samples[((y + 1) * 8 + x + 2) * 3 + c]);
  }, scaledTimeout(600_000));

  it("keeps the combined kernels for a small disc beside a wide diffraction kernel", async () => {
    const small = await simulateDisplayViewWithInternals(request(16, 2.5), { ...VIEW, region: { x: 370, y: 248, width: 4, height: 2 } });
    const value = defocusOf(small.result);
    expect(value.convolution).toBeUndefined();
    expect((2 * (value.kernelRadiusSites as number) + 1) ** 2).toBeLessThanOrEqual(4 * (2 * (value.diffractionKernelRadiusSites as number) + 1) ** 2);
  }, scaledTimeout(600_000));

  it("costs under half the exact method on fine detail", async () => {
    // A region of 40 × 20 display pixels, 2 × 2 samples: the regrouped path's in-focus tiles (all sites around the region) cost less
    // than the combined taps of the sampled sites. A tiny cold region can cost more (the tiles are fixed 128-site squares, kept per
    // prepared view); the choice is made per prepared view, so that regions stay bit-identical to the whole view.
    const region = { width: 750, height: 500, samplesPerAxis: 2, region: { x: 355, y: 240, width: 40, height: 20 } };
    const time = async (r: SimulateCaptureOptions): Promise<number> => { const t0 = performance.now(); await simulateDisplayViewWithInternals(r, region); return performance.now() - t0; };
    const fastMs = await time(request(2.8, 1.4)), exactMs = await time(request(2.8, 1.4, false));
    expect(fastMs / exactMs).toBeLessThan(0.5);
  }, scaledTimeout(1_800_000));
});
