// SPDX-License-Identifier: Apache-2.0
/**
 * #441: the display view's site ring (exact path) and the expected signal's markReads. Regions of one prepared view, rendered
 * in any order, overlapping, adjacent or concurrently, equal separate simulateDisplayView calls byte for byte (samples,
 * expected values, noise, every diagnostic but the timings, assumptions) and the matching crop of a whole-view render; and
 * markReads leaves a window's lookup count and later reads as reading the same sites with `site` would.
 */
import { describe, expect, it } from "vitest";
import { prepareDisplayView, simulateDisplayView, type DisplayViewResult, type SimulateCaptureOptions, type SimulateDisplayViewOptions } from "../src/index.js";
import { createDisplayViewExpectedSignal, type DisplayViewExpectedSignalInput } from "../src/facade/expected-signal.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

/** The result without its timings, as plain data. */
function comparable(result: DisplayViewResult): unknown {
  const diagnostics: Partial<DisplayViewResult["diagnostics"]> = { ...result.diagnostics };
  delete diagnostics.timingsMs;
  return { ...result, image: { ...result.image, samples: Array.from(result.image.samples) }, diagnostics };
}
type Region = { x: number; y: number; width: number; height: number };
type Rendered = Awaited<ReturnType<typeof simulateDisplayViewWithInternals>>;
const arrays = ({ result, internals }: Rendered): ArrayLike<number>[] => [result.image.samples, internals.expected, internals.noiseStd];
/** Samples, expected values and noise of `region` cut from a whole-view render. */
function crop(whole: Rendered, viewWidth: number, region: Region): number[][] {
  return arrays(whole).map((a) => {
    const out: number[] = [];
    for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) for (let c = 0; c < 3; c++) out.push(a[(y * viewWidth + x) * 3 + c]!);
    return out;
  });
}
const own = (rendered: Rendered): number[][] => arrays(rendered).map((a) => Array.from(a));

// Device-pixel views (3 × 3 real pixels per display pixel: the exact area mean, where the ring is used) of Quality requests:
// diffraction on a chart (filled windows, tracked materials) with AHD and mirror borders, the AHD low-signal correction (small
// pixels at a high ISO), and a chart without diffraction (direct windows: the ring is not used, the per-read path must give
// the same parts).
const REQUESTS: [string, SimulateCaptureOptions][] = [
  ["Quality chart, AHD, mirror borders", { scene: { preset: "siemens-star" }, lens: { fNumber: 11, diffraction: "circular-aperture" },
    sensor: { pixelPitchMicrometers: 4, pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" } },
    output: { width: 96, height: 72, demosaic: "ahd", borderHandling: "mirror" } }],
  ["Quality chart, AHD correction", { scene: { preset: "dead-leaves" }, lens: { fNumber: 8, diffraction: "circular-aperture" }, sensor: { pixelPitchMicrometers: 1.4 },
    exposure: { mode: "manual", iso: 3200, shutterSeconds: 1 / 4000 }, output: { width: 96, height: 72, demosaic: "ahd" } }],
  ["Chart without diffraction, mirror borders", { scene: { preset: "dead-leaves" }, sensor: { pixelPitchMicrometers: 3, pixelAperture: { kind: "box", samplesPerAxis: 2 } },
    output: { width: 96, height: 72, borderHandling: "mirror" } }]
];
const VIEW = { width: 32, height: 24 };
// Overlapping and adjacent parts, including every corner (mirror borders) and the frame's edges.
const REGIONS: Region[] = [
  { x: 0, y: 0, width: 9, height: 7 }, { x: 5, y: 3, width: 9, height: 7 }, { x: 9, y: 0, width: 9, height: 7 },
  { x: 23, y: 17, width: 9, height: 7 }, { x: 0, y: 17, width: 6, height: 7 }, { x: 26, y: 0, width: 6, height: 5 }, { x: 12, y: 9, width: 1, height: 1 }
];

describe("display view site ring (#441)", () => {
  it.each(REQUESTS)("%s: parts in either order and concurrently equal separate calls and the whole view", async (name, options) => {
    const wholeRender = await simulateDisplayViewWithInternals(options, VIEW), whole = wholeRender.result;
    expect(whole.assumptions.find((a) => a.id === "view.estimation")?.value).toMatchObject({ method: "exact-area-mean-over-real-pixels" });
    const separate: DisplayViewResult[] = [];
    for (const region of REGIONS) {
      const rendered = await simulateDisplayViewWithInternals(options, { ...VIEW, region });
      separate.push(rendered.result);
      // A part's samples, expected values and noise are the whole view's (its lookup count is the part's own).
      expect(own(rendered)).toEqual(crop(wholeRender, VIEW.width, region));
    }
    const prepared = await prepareDisplayView(options, { gpu: "off" });
    const forward: DisplayViewResult[] = [];
    for (const region of REGIONS) forward.push(await prepared.render({ ...VIEW, region }));
    const backward: DisplayViewResult[] = [];
    for (const region of [...REGIONS].reverse()) backward.unshift(await prepared.render({ ...VIEW, region }));
    const together = await Promise.all(REGIONS.map((region) => prepared.render({ ...VIEW, region })));
    for (let i = 0; i < REGIONS.length; i++) {
      const expected = comparable(separate[i]!);
      expect(comparable(forward[i]!)).toEqual(expected);
      expect(comparable(backward[i]!)).toEqual(expected);
      expect(comparable(together[i]!)).toEqual(expected);
    }
    // The whole view rendered from the prepared view after its parts, and a 16-bit part.
    expect(comparable(await prepared.render(VIEW))).toEqual(comparable(whole));
    const deep: SimulateDisplayViewOptions = { ...VIEW, region: REGIONS[1]!, format: "srgb-16" };
    expect(comparable(await prepared.render(deep))).toEqual(comparable(await simulateDisplayView(options, deep)));
  }, testTimeout(180_000));
});

describe("expected signal markReads (#441)", () => {
  // A 24 × 18 raster of a two-material checker chart (one neutral, one spectral), two query offsets.
  const W = 24, H = 18, nodes = [500, 600];
  const base = (kernels: boolean): DisplayViewExpectedSignalInput => ({
    nativeWidth: W, nativeHeight: H, outputWidth: W, wavelengthsNm: nodes,
    electronsPerRadiance: [Float64Array.of(1, 2), Float64Array.of(3, 1), Float64Array.of(0.5, 4)],
    offsets: [{ x: -0.25, y: 0.25, weight: 0.5 }, { x: 0.25, y: -0.25, weight: 0.5 }],
    ...(kernels ? { kernels: { radius: 1, perNode: [Float64Array.of(0, 0.1, 0, 0.1, 0.6, 0.1, 0, 0.1, 0), Float64Array.of(0.05, 0.1, 0.05, 0.1, 0.4, 0.1, 0.05, 0.1, 0.05)] } } : {}),
    scene: { kind: "materials", materialAt: (u, v) => ((Math.floor(u * 3) + Math.floor(v * 3)) & 1), materials: [{ neutral: 0.4 }, { radiance: Float64Array.of(0.2, 0.7) }], whiteRadiance: Float64Array.of(1, 1.2) },
    channelAt: (x, y) => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2)),
    ...(kernels ? {} : { queryPoint: (x: number, y: number, o: number, out: Float64Array): void => { out[0] = (x + 0.5 + (o === 0 ? -0.25 : 0.25) - W / 2) * 2 / W; out[1] = -(y + 0.5 + (o === 0 ? 0.25 : -0.25) - H / 2) * 2 / W; } })
  });
  // Windows and the sites read in each: (x, y) pairs, with repeats (as two slots at a mirror border read one site) and sites
  // outside the window.
  const windows: { box: [number, number, number, number]; sites: [number, number][] }[] = [
    { box: [0, 0, 8, 7], sites: [[1, 1], [2, 1], [1, 1], [0, 3], [7, 6], [3, 2], [9, 1]] },
    { box: [3, 1, 11, 8], sites: [[3, 2], [4, 2], [7, 6], [7, 6], [10, 7], [1, 1], [5, 5], [12, 3]] },
    { box: [6, 5, 14, 12], sites: [[7, 6], [10, 7], [13, 11], [6, 5], [6, 5], [8, 8]] }
  ];
  it("is offered only by filled windows: not without kernels (Speed), not for the lazy caches of a radiance scene", () => {
    const direct = createDisplayViewExpectedSignal(base(false)), filled = createDisplayViewExpectedSignal(base(true));
    const lazy = createDisplayViewExpectedSignal({ ...base(true), scene: { kind: "radiance", radianceAt: (u, v, nm) => 0.01 * (1.5 + Math.sin(9 * u + nm / 100) * Math.cos(7 * v)) } });
    for (const signal of [direct, filled, lazy]) signal.window(...windows[0]!.box);
    expect(direct.marksReads).toBe(false);
    expect(lazy.marksReads).toBe(false);
    expect(filled.marksReads).toBe(true);
  });
  it("filled window (diffraction): same lookups and reads as site()", () => {
    const input = base(true), reference = createDisplayViewExpectedSignal(input), marked = createDisplayViewExpectedSignal(input);
    // The values and materials a caller has kept from earlier reads (as the display view's ring does).
    const known = new Map<string, [number, number]>();
    for (const { box, sites } of windows) {
      reference.window(...box); marked.window(...box);
      expect(marked.marksReads).toBe(true);
      const xs = new Int32Array(sites.length), ys = new Int32Array(sites.length), vs = new Float64Array(sites.length), ms = new Int32Array(sites.length);
      let count = 0;
      for (const [x, y] of sites) {
        const v = reference.site(x, y), m = reference.uniformMaterial, key = `${x},${y}`, inside = x >= box[0] && x < box[2] && y >= box[1] && y < box[3];
        const kept = known.get(key);
        if (kept && inside) { expect(kept[0]).toBe(v); xs[count] = x; ys[count] = y; vs[count] = kept[0]; ms[count] = kept[1]; count++; continue; }
        expect(marked.site(x, y)).toBe(v);
        expect(marked.uniformMaterial).toBe(m);
        known.set(key, [v, m]);
      }
      marked.markReads(xs, ys, vs, ms, count);
      expect(marked.lookups).toBe(reference.lookups);
      // Later reads of the marked sites in the same window: the same values and materials, no further lookups.
      for (const [x, y] of sites) { expect(marked.site(x, y)).toBe(reference.site(x, y)); expect(marked.uniformMaterial).toBe(reference.uniformMaterial); }
      expect(marked.lookups).toBe(reference.lookups);
    }
    expect(reference.lookups).toBeGreaterThan(0);
  });
});
