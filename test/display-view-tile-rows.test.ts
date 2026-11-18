// SPDX-License-Identifier: Apache-2.0
/**
 * #653, quality chart renders: defocused and long-lens frames. Every step forms the same sums in another order (one path, no
 * flag; docs/plans rule 3), so each is held to the equivalence test of rule 4 (test/helpers/view-equivalence.ts):
 *
 * - The pre-integrated spectral radiance B(s)[n] = Σ_o w_o·L(o, s)(λ_n) at native site positions, then (2R + 1)² taps of it per
 *   site and the site's own channel response: the in-focus tiles of the regrouped defocus (#612), all three channels from one
 *   channel-free sum, with uniform windows taking one material's spectrum; and the per-tap sum of in-focus sites (#643).
 *   Per-site electrons within 1e-9 relative of the per-material sums on the three frames of #653 (the composite chart, the
 *   Quality options) and on the fine-detail scene of #612.
 * - Rows on demand: output tiles and in-focus tiles compute only the rows a render reads. Every value is the same bits
 *   whatever is read first, and a region equals the same pixels of a larger one.
 * - `regroupedDefocusCheaper` (#642) with the new costs: on the side of 1 of the measured time ratio for regions of 4 × 2 to
 *   100 × 50 display pixels (8 native sites per pixel).
 */
import { describe, expect, it } from "vitest";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createDisplayViewExpectedSignal, regroupedDefocusCheaper, type DisplayViewExpectedSignalInput } from "../src/facade/expected-signal.js";
import { NATIVE_RAW_LIMITS, prepareDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { expectRegionEqualsWhole, expectSiteElectronsEquivalent } from "./helpers/view-equivalence.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

type Frame = "near" | "far" | "200mm";
/** The app's composite chart (scripts/lib/display-view-app-request.mjs), loaded at run time (a script module without types). */
const appChart = async (): Promise<SimulateCaptureOptions["scene"]> =>
  ((await import(new URL("../scripts/lib/display-view-app-request.mjs", import.meta.url).href)) as { APP_CHART: SimulateCaptureOptions["scene"] }).APP_CHART;
/** The frames of #653 (scripts/benchmark-display-view-cases.mjs, group 653): the Quality options on a 6000 × 4000 sensor of 6 µm sites. */
const frame = async (which: Frame): Promise<SimulateCaptureOptions> => {
  const lens = which === "200mm" ? { prime: 200, fNumber: 8 } : { prime: 50, fNumber: 2, focusDistanceM: which === "near" ? 1.6 : 2.5, defocus: { model: "geometric-disc" as const } };
  return { scene: await appChart(), subjectDistanceM: 2, lens: { ...lens, diffraction: "circular-aperture" },
    exposure: { mode: "manual", iso: 100, shutterSeconds: (1 / 125) * (lens.fNumber / 8) ** 2 },
    sensor: { pixelPitchMicrometers: 6, antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } },
    output: { width: 6000, height: 4000, format: "srgb-8", demosaic: "ahd", maximumPixels: NATIVE_RAW_LIMITS.ceilingPixels } };
};
/** A band of the 768 × 512 view (7.8 native sites per display pixel). */
const band = (y: number, rows: number, width = 40, x = 360): { width: number; height: number; region: { x: number; y: number; width: number; height: number } } =>
  ({ width: 768, height: 512, region: { x, y, width, height: rows } });
const defocusOf = (result: { assumptions: readonly { id: string; value: unknown }[] }): Record<string, unknown> | undefined =>
  result.assumptions.find((a) => a.id === "view.defocus")?.value as Record<string, unknown> | undefined;

describe("#653: the three frames", () => {
  for (const which of ["near", "far", "200mm"] as const) {
    it(`${which}: site electrons within 1e-9 of the per-material sums; a region equals the same pixels of a larger one`, async () => {
      const request = await frame(which), run = await simulateDisplayViewWithInternals(request, band(213, 4, 768, 0));
      // The sites under the band's middle (native rows 1664–1695), 120 columns.
      const rect = { x0: 2880, y0: 1666, x1: 3000, y1: 1690 };
      let fast: DisplayViewExpectedSignalInput;
      if (which === "200mm") {
        expect(defocusOf(run.result)).toBeUndefined();
        expect(run.signalInput.perTapSum).toBe(true);
        fast = run.signalInput;
      } else {
        expect(defocusOf(run.result)).toMatchObject({ convolution: "runs" });
        fast = run.setup.gpu!.reference!;
        expect(fast.largeKernel).toBeDefined();
        expect(fast.inFocusPerTap).toBe(true);
      }
      // Per-material sums of the combined kernels (the exact method's signal).
      const sums = createDisplayViewExpectedSignal({ ...run.signalInput, perTapSum: false });
      const r = expectSiteElectronsEquivalent(createDisplayViewExpectedSignal({ ...fast }), sums, rect);
      expect(r.differing).toBeGreaterThan(0);
      const view = await prepareDisplayView(request, { gpu: "off" });
      const whole = band(211, 8), part = band(213, 4, 20, 370);
      const a = await view.render(whole), b = await view.render(part);
      if (which !== "200mm") { expect(defocusOf(a)).toMatchObject({ convolution: "runs" }); expect(defocusOf(b)).toMatchObject({ convolution: "runs" }); }
      expectRegionEqualsWhole(a.image.samples, whole.region, b.image.samples, part.region);
    }, scaledTimeout(600_000));
  }
});

// The fine-detail scene of test/display-view-defocus-regrouped.test.ts (#612): a new material every 3 sites, 256 of them.
const W = 6000, H = 4000, g = 2 / W, MATERIALS = 256;
const fine = (p: { u: number; v: number }): number => {
  const x = Math.floor(p.u / (3 * g)), y = Math.floor(p.v / (3 * g));
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % MATERIALS;
};
const fineRequest: SimulateCaptureOptions = {
  scene: { kind: "material-function", sceneId: "regrouped-fine", materials: Array.from({ length: MATERIALS }, (_, m) => 0.05 + 0.9 * m / (MATERIALS - 1)), materialAt: fine },
  subjectDistanceM: 2, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 },
  sensor: { pixelPitchMicrometers: 6, antiAliasing: { kind: "four-spot" } },
  output: { width: W, height: H, maximumPixels: W * H * 2, demosaic: "ahd" },
  lens: { prime: 50, fNumber: 2.8, focusDistanceM: 1.4, diffraction: "circular-aperture", defocus: { model: "geometric-disc" } } };

describe("#653: the regrouped and combined inputs of the fine-detail scene", () => {
  /** The regrouped input (`setup.gpu.reference` of a render that takes it), the combined one, and the radii. */
  const inputs = async (): Promise<{ regrouped: DisplayViewExpectedSignalInput; combined: DisplayViewExpectedSignalInput; Rc: number; Rf: number; N: number }> => {
    const run = await simulateDisplayViewWithInternals(fineRequest, { width: 750, height: 500, samplesPerAxis: 2, region: { x: 355, y: 240, width: 40, height: 20 } });
    const value = defocusOf(run.result)!;
    expect(value.convolution).toBe("runs");
    return { regrouped: run.setup.gpu!.reference!, combined: run.signalInput, Rc: value.kernelRadiusSites as number, Rf: value.diffractionKernelRadiusSites as number,
      N: run.signalInput.wavelengthsNm.length };
  };

  it("gives every site the same bits whatever rows are read first, with and without windows", async () => {
    const { regrouped, combined } = await inputs();
    const x0 = 2950, y0 = 1950, w = 70, h = 40;
    for (const input of [regrouped, combined]) {
      // Fresh state for each read (the regrouped tiles are kept per input object; a copy starts empty).
      const forward = createDisplayViewExpectedSignal({ ...input }), backward = createDisplayViewExpectedSignal({ ...input }), windowed = createDisplayViewExpectedSignal({ ...input });
      const a: number[] = [], b: number[] = [], c: number[] = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) a.push(forward.site(x, y));
      for (let y = y0 + h - 1; y >= y0; y--) for (let x = x0 + w - 1; x >= x0; x--) b.push(backward.site(x, y));
      // Windows of 10 × 10 sites, bottom row of windows first.
      const values = new Map<number, number>();
      for (let wy = y0 + h - 10; wy >= y0; wy -= 10) for (let wx = x0; wx < x0 + w; wx += 10) {
        windowed.window(wx - 3, wy - 3, wx + 13, wy + 13);
        for (let y = wy; y < wy + 10; y++) for (let x = wx; x < wx + 10; x++) values.set(y * W + x, windowed.site(x, y));
      }
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) c.push(values.get(y * W + x)!);
      expect(b.reverse()).toEqual(a);
      expect(c).toEqual(a);
    }
    // The two inputs agree within the tolerance.
    expectSiteElectronsEquivalent(createDisplayViewExpectedSignal({ ...regrouped }), createDisplayViewExpectedSignal({ ...combined, perTapSum: false }), { x0, y0, x1: x0 + w, y1: y0 + 20 });
  }, scaledTimeout(600_000));

  it("chooses the regrouped defocus on the side of 1 of the measured cost, for regions of 4 × 2 to 100 × 50 pixels (#642)", async () => {
    const { regrouped, combined, Rc, Rf, N } = await inputs();
    /** The fastest of two reads of `count` sites spread over the rectangle (all of them when count is w·h), from a fresh state. */
    const time = (input: DisplayViewExpectedSignalInput, x0: number, y0: number, w: number, h: number, stride: number): number => {
      let best = Infinity;
      for (let r = 0; r < 2; r++) {
        const t0 = performance.now(), signal = createDisplayViewExpectedSignal({ ...input }, w);
        signal.window(x0, y0, x0 + w, y0 + h);
        let sum = 0;
        for (let y = y0; y < y0 + h; y += stride) for (let x = x0; x < x0 + w; x += stride) sum += signal.site(x, y);
        best = Math.min(best, performance.now() - t0);
        expect(sum).toBeGreaterThan(0);
      }
      return best;
    };
    const rows: string[] = [];
    for (const [pw, ph, stride] of [[4, 2, 1], [10, 5, 1], [20, 10, 1], [40, 20, 1], [40, 20, 3], [100, 50, 2], [100, 50, 4], [4, 2, 8], [10, 5, 12], [40, 20, 8], [40, 20, 24], [100, 50, 8], [100, 50, 40]] as const) {
      // The region's native footprint (8 sites per pixel) and a reach of 13 sites on each side, as the facade's input to the model.
      const w = pw * 8 + 26, h = ph * 8 + 26, x0 = 2900 - (w >> 1), y0 = 1950 - (h >> 1);
      const sites = Math.ceil(w / stride) * Math.ceil(h / stride), cheaper = regroupedDefocusCheaper(w, h, sites, Rc, Rf, N);
      const ratio = time(regrouped, x0, y0, w, h, stride) / time(combined, x0, y0, w, h, stride);
      rows.push(`${pw}×${ph} stride ${stride}: ${sites} sites, model ${cheaper ? "regrouped" : "combined"}, measured ratio ${ratio.toFixed(2)}`);
      // On the model's side of 1, with a margin for timing noise on a loaded machine.
      if (cheaper) expect(ratio, rows.join("; ")).toBeLessThan(1.25); else expect(ratio, rows.join("; ")).toBeGreaterThan(0.8);
    }
    // Both choices were exercised (measured on a loaded 18-core machine: ratios 0.06–0.51 where the model takes the regrouped path,
    // 1.56–6.03 where it keeps the combined kernels).
    expect(rows.some((r) => r.includes("model regrouped"))).toBe(true);
    expect(rows.some((r) => r.includes("model combined"))).toBe(true);
  }, scaledTimeout(1_200_000));
});
