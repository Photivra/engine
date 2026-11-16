// SPDX-License-Identifier: Apache-2.0
/**
 * #612: the cost of a defocused Quality display view must not grow with the number of distinct chart materials its kernel
 * windows read. From 2.21.0 each site's signal is integrated from the spectra of the materials its taps read (per-material sums,
 * `createMaterialSums`); 2.21.0–2.24.0 found a material's sums by a search of the materials the site had read so far, so a window
 * over fine chart detail cost about the square of its distinct materials read (on one test chart's f/16 view focused behind
 * it, 28 times 2.20.0's CPU time for the same pixels).
 *
 * The guards are relative timings in one process (the minimum of several repeats, so a loaded machine slows both sides),
 * with bounds between the regression's ratios and the fixed code's (Apple M5 Pro, Node 26, machine heavily loaded):
 * - `createMaterialSums`: one add per material over 8,192 distinct materials against 8,192 adds to one material. Fixed code
 *   3.1–3.5×, the search (2.24.0) 301–612×; bound 25×. Its value is also checked against the definition, bit for bit.
 * - A defocused Quality view (diffraction, four-spot filter, AHD; a disc of about 33 sites across) of a material scene whose
 *   every lattice point can be its own material (4,096 materials) against the same view of a two-material scene with the
 *   same material changes. Fixed code 2.2×, 2.24.0 11.7×; bound 5×.
 * The view's values are locked by the display-view defocus and hash-lock tests, which this change passes unchanged.
 */
import { describe, expect, it } from "vitest";
import { createMaterialSums } from "../src/facade/expected-signal.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import type { SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const minimumOf = async (repeats: number, run: () => unknown): Promise<number> => {
  let best = Infinity;
  for (let r = 0; r < repeats; r++) { const t0 = performance.now(); await run(); best = Math.min(best, performance.now() - t0); }
  return best;
};

describe("defocused display-view cost (#612)", () => {
  it("finds a material's sums in constant time: many distinct materials cost about what one material costs", async () => {
    const nodes = 20, M = 8192;
    const spectra = Array.from({ length: M }, (_, m) => Float64Array.from({ length: nodes }, (_, n) => 1 + ((m * 31 + n * 7) % 13) / 13));
    const k = Float64Array.from({ length: M * nodes }, (_, i) => 1 + (i % 17) / 17);
    const acc = createMaterialSums(nodes, spectra);
    const distinct = (): number => { acc.reset(); for (let t = 0; t < M; t++) acc.add(t, k, t * nodes); return acc.value(); };
    const single = (): number => { acc.reset(); for (let t = 0; t < M; t++) acc.add(0, k, t * nodes); return acc.value(); };
    // The definition: Σ_t Σ_n L_m(t)(n)·k(t, n), the materials in the order of their first tap.
    let expected = 0;
    for (let t = 0; t < M; t++) { let v = 0; for (let n = 0; n < nodes; n++) v += spectra[t]![n]! * k[t * nodes + n]!; expected += v; }
    expect(distinct()).toBe(expected);
    for (let i = 0; i < 3; i++) { distinct(); single(); }
    const many = await minimumOf(7, distinct), one = await minimumOf(7, single);
    expect(many / one).toBeLessThan(25);
  }, scaledTimeout(60_000));

  it("renders a defocused Quality view of fine material detail within a small factor of a two-material view", async () => {
    const W = 6000, H = 4000, g = 2 / W, materials = 4096;
    const fine = (u: number, v: number): number => {
      const x = Math.floor(u / g), y = Math.floor(v / g);
      return (((x * 73856093) ^ (y * 19349663)) >>> 0) % materials;
    };
    const base = (materialAt: (p: { u: number; v: number }) => number, list: readonly number[]): SimulateCaptureOptions => ({
      scene: { kind: "material-function" as const, sceneId: `cost-${list.length}`, materials: list, materialAt },
      subjectDistanceM: 2, exposure: { mode: "manual" as const, iso: 100, shutterSeconds: 1 / 30 },
      sensor: { pixelPitchMicrometers: 6, antiAliasing: { kind: "four-spot" as const } },
      output: { width: W, height: H, maximumPixels: W * H * 2, demosaic: "ahd" as const },
      lens: { prime: 50, fNumber: 2.8, focusDistanceM: 1.4, diffraction: "circular-aperture" as const, defocus: { model: "geometric-disc" as const } } });
    const reflectances = Array.from({ length: materials }, (_, m) => 0.05 + 0.9 * m / (materials - 1));
    const busy = base((p) => fine(p.u, p.v), reflectances), plain = base((p) => (fine(p.u, p.v) & 1), [0.05, 0.95]);
    const view = { width: 750, height: 500, samplesPerAxis: 1, region: { x: 369, y: 247, width: 12, height: 6 } };
    const render = async (request: SimulateCaptureOptions): Promise<ArrayLike<number>> => (await simulateDisplayViewWithInternals(request, view)).internals.expected;
    const first = await render(busy);
    expect(Array.from(first).every((value) => Number.isFinite(value))).toBe(true);
    const many = await minimumOf(3, () => render(busy)), two = await minimumOf(3, () => render(plain));
    expect(many / two).toBeLessThan(5);
  }, scaledTimeout(600_000));
});
