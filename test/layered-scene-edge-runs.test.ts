// SPDX-License-Identifier: Apache-2.0
/**
 * 2.29.0, #749 and #750 (CPU): the layered sum by runs (`layered-edge-sum.ts`) against the direct sum of 2.28.0 (every tap on its
 * own, `method: "direct"`), the raised kernel bounds, and the accuracy table at large blur.
 *
 * 1. The run sum equals the direct sum within 1e-9 relative (rule 3 of the 2.29.0 plan) at every lattice point of small lattices
 *    with disc kernels of radius 3, 11, 29 and 64, cards on both sides of the focus plane, fast and full rows; and with shaped
 *    kernels (blades: runs; spherical aberration: no equal neighbours) and a field-zone kernel per point.
 * 2. `sumRows` (the sum tiles' fill) gives every point the bits of `sumAt`.
 * 3. The bounds: `LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites`, 512 sites for the disc and 128 for a shaped kernel.
 * 4. Occlusion edges against the brute-force aperture integration (test 3 of layered-scene-signal.test.ts) at radii 96, 128 and
 *    256: full within 0.5 % and fast within 2 % of the local swing; and energy at radius 96: flat within 0.2 % (full) and 1 % (fast).
 */
import { describe, expect, it } from "vitest";
import { LAYERED_CHART_LIMITS } from "../src/facade/layered-chart-scene.js";
import { LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES, createLayeredEdgeSum, type LayeredKernelGroup, type LayeredSurfaceTileReader } from "../src/facade/layered-edge-sum.js";
import { LAYERED_OCCLUSION_SAMPLES, createLayeredSceneLattice, type LayeredSceneLattice, type LayeredSceneSignalInput } from "../src/facade/layered-scene-signal.js";
import { createDefocusBokehSiteKernel, resolveDefocusBokehOptions } from "../src/optics/defocus-bokeh-kernel.js";
import { createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { WAVELENGTHS, WHITE, bayer, bruteForceSite, fixture, layeredSignal, signalInputOf, signalOf, type SurfaceSpec } from "./helpers/layered-scene-fixtures.js";

const { fast: FAST, full: FULL } = LAYERED_OCCLUSION_SAMPLES;
const N = WAVELENGTHS.length;
/** The key spacing of the lattice's surface tiles (surface · this + group), as `layered-scene-signal.ts` keys them. */
const SURFACE_KEYS = 4096;

/** A reader of a lattice's own surface tiles, with or without their row sums. */
function readerOf(lattice: LayeredSceneLattice, runs: boolean): LayeredSurfaceTileReader {
  const tiles = lattice.tiles.surfaces, T = tiles.tile;
  const reader: { tile: Float64Array; at: LayeredSurfaceTileReader["at"]; rowSum?: NonNullable<LayeredSurfaceTileReader["rowSum"]> } = { tile: new Float64Array(0), at(k, group, p, q) {
    const tx = Math.floor(p / T), ty = Math.floor(q / T);
    reader.tile = tiles.rows(k * SURFACE_KEYS + group, tx, ty, 0, T);
    return ((q - ty * T) * T + p - tx * T) * N;
  } };
  if (runs) reader.rowSum = (k, group, p0, p1, q, out, from, to): void => tiles.rowSum(k * SURFACE_KEYS + group, p0, p1, q, out, from, to);
  return reader;
}

/** Per surface one kernel group over all nodes, the layer's kernel (or the given per-point kernels). */
const groupsOf = (input: LayeredSceneSignalInput, perPoint?: (k: number, p: number, q: number) => Float64Array | null): LayeredKernelGroup[][] =>
  input.layers.map((l, k) => [{ nodes: { from: 0, to: N }, kernel: { radius: l.kernel ? l.kernel.radius : 0, shaped: l.kernel?.shaped,
    weightsAt: (p: number, q: number): Float64Array | null => (perPoint ? perPoint(k, p, q) : l.kernel ? l.kernel.weights : null) } }]);

/** The run sum and the direct sum at every lattice point of the raster and a margin: the worst relative difference, and counts. */
function compareSums(input: LayeredSceneSignalInput, perPoint?: (k: number, p: number, q: number) => Float64Array | null): { worst: number; edge: number; points: number; differing: number } {
  const lattice = createLayeredSceneLattice(input), { geometry, visibility } = lattice.parts, kernelGroups = groupsOf(input, perPoint);
  const runs = createLayeredEdgeSum({ geometry, visibility, surfaces: readerOf(lattice, true), kernelGroups, capacityBytes: 1 << 26 });
  const direct = createLayeredEdgeSum({ geometry, visibility, surfaces: readerOf(lattice, false), kernelGroups, capacityBytes: 1 << 26, method: "direct" });
  const a = new Float64Array(N), b = new Float64Array(N), margin = 4;
  let worst = 0, points = 0, differing = 0;
  for (const group of [lattice.groupOf(0, 0), lattice.groupOf(0.25, 0.75)])
    for (let q = -margin; q < input.nativeHeight + margin; q++) for (let p = -margin; p < input.nativeWidth + margin; p++) {
      a.fill(0); b.fill(0);
      runs.sumAt(group, p, q, a, 0); direct.sumAt(group, p, q, b, 0);
      points++;
      for (let n = 0; n < N; n++) {
        if (a[n] !== b[n]) differing++;
        if (a[n] !== b[n]) worst = Math.max(worst, Math.abs(a[n]! - b[n]!) / Math.max(Math.abs(a[n]!), Math.abs(b[n]!)));
      }
    }
  return { worst, edge: runs.edgePoints, points, differing };
}

const cardA = (u: number, v: number): number => (Math.floor(u * 9) + Math.floor(v * 7)) & 1;
const cardB = (u: number, v: number): number => (u * u + v * v < 0.04 ? 2 : u < 0.3 ? 0 : 1);
/** Two patterned cards and a back plane (as test/layered-scene-seams.test.ts), at the given signed blur radii. */
const threeSurfaces = (rhoA: number, rhoB: number, rhoBack: number): SurfaceSpec[] => [
  { rect: { u0: -0.7, u1: 0.15, v0: -0.35, v1: 0.3 }, rho: rhoA, reflectances: [0.08, 0.85], materialAt: cardA },
  { rect: { u0: -0.1, u1: 0.8, v0: -0.25, v1: 0.45 }, rho: rhoB, reflectances: [0.2, 0.55, 0.95], materialAt: cardB },
  { rect: null, rho: rhoBack, reflectances: [0.4] }];

describe("layered edge sums by runs (#749, #750): the direct sum within 1e-9", () => {
  // [largest radius, the three signed blur radii, occlusion rows, raster].
  const cases: [number, number, number, number, number, number, number][] = [
    [3, -2.6, 1.8, 3.4, FULL, 40, 28], [11, -11.3, 6.2, 9.7, FULL, 48, 32], [29, 12.4, -29.2, 20.1, FAST, 48, 32], [64, -64.2, 30.5, 41.6, FAST, 40, 24]];
  for (const [R, a, b, c, samples, W, H] of cases) it(`discs up to radius ${R}, ${samples === FULL ? "full" : "fast"}`, () => {
    const input = signalInputOf(fixture(W, H), threeSurfaces(a, b, c), samples, false);
    expect(Math.max(...input.layers.map((l) => (l.kernel ? l.kernel.radius : 0)))).toBe(R);
    const r = compareSums(input);
    expect(r.worst).toBeLessThan(1e-9);
    expect(r.edge).toBeGreaterThan(r.points / 4);
    if (R > 3) expect(r.differing).toBeGreaterThan(0);
  }, scaledTimeout(120_000));

  it("shaped kernels: blades (runs), spherical aberration (no runs) and a kernel per field zone", () => {
    const f = fixture(40, 28), specs = threeSurfaces(-9.2, 4.4, 12.6), base = signalInputOf(f, specs, FULL, false);
    for (const bokeh of [{ blades: { count: 7 } }, { sphericalAberration: { w040Micrometers: 0.8, atFNumber: 2 } }]) {
      const options = resolveDefocusBokehOptions(bokeh, "lens.defocus");
      const layers = base.layers.map((l, k) => {
        const built = createDefocusBokehSiteKernel({ diameterSites: 2 * Math.abs(specs[k]!.rho), side: specs[k]!.rho > 0 ? 1 : -1, fNumber: 2, focalLengthMm: 50, pitchMicrometers: 6, options });
        return { ...l, kernel: { radius: built.radius, weights: built.weights, shaped: true } };
      });
      const r = compareSums({ ...base, layers });
      expect(r.worst, JSON.stringify(bokeh)).toBeLessThan(1e-9);
      expect(r.differing).toBeGreaterThan(0);
    }
    // Field zones: the right half of the pupil closed right of x = 20 (a different kernel array per point).
    const clipped = base.layers.map((l) => {
      if (!l.kernel) return null;
      const w = l.kernel.weights, width = 2 * l.kernel.radius + 1, out = new Float64Array(w.length);
      let sum = 0;
      for (let j = 0; j < width; j++) for (let i = 0; i <= l.kernel.radius; i++) { out[j * width + i] = w[j * width + i]!; sum += w[j * width + i]!; }
      return out.map((x) => x / sum);
    });
    const r = compareSums(base, (k, p) => (p < 20 ? base.layers[k]!.kernel?.weights ?? null : clipped[k]!));
    expect(r.worst).toBeLessThan(1e-9);
  }, scaledTimeout(120_000));

  it("sumRows gives each point the bits of sumAt, wherever the block starts", () => {
    const input = signalInputOf(fixture(48, 32), threeSurfaces(-11.3, 6.2, 9.7), FAST, false), lattice = createLayeredSceneLattice(input), sum = lattice.parts.edgeSum;
    const group = lattice.groupOf(0.25, 0.75), one = new Float64Array(N);
    for (const [x0, y0, width, height] of [[-32, -32, 32, 32], [0, 0, 32, 32], [7, 5, 20, 3], [30, 20, 1, 1]] as const) {
      const block = new Float64Array(width * height * N);
      sum.sumRows(group, x0, y0, width, height, block);
      for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
        one.fill(0);
        sum.sumAt(group, x0 + i, y0 + j, one, 0);
        for (let n = 0; n < N; n++) expect(block[(j * width + i) * N + n]).toBe(one[n]);
      }
    }
  });
});

describe("layered edge sums: the bounds (#749)", () => {
  const f = fixture(16, 12);
  const input = (kernel: { radius: number; weights: Float64Array; shaped?: boolean }): LayeredSceneSignalInput => {
    const base = signalInputOf(f, [{ rect: { u0: -1, u1: 0, v0: -1, v1: 1 }, rho: 1, reflectances: [0.5] }, { rect: null, rho: 2, reflectances: [0.5] }], FAST, false);
    // The back plane's kernel replaced (its ρ stays 2 for the fixture's own disc; the sum reads the kernel given).
    return { ...base, layers: [base.layers[0]!, { ...base.layers[1]!, blurRadiusSites: kernel.radius, kernel }] };
  };
  const zeros = (R: number, shaped?: boolean): { radius: number; weights: Float64Array; shaped?: boolean } => ({ radius: R, weights: new Float64Array((2 * R + 1) ** 2), ...(shaped ? { shaped } : {}) });

  it("takes LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites: discs to 512 sites, shaped kernels to 128", () => {
    expect(LAYERED_EDGE_MAXIMUM_KERNEL_RADIUS_SITES).toBe(LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites);
    expect(LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites).toEqual({ disc: 512, shaped: 128 });
    const disc = createDefocusDiscSiteKernel(1024)!;
    expect(disc.radius).toBe(512);
    expect(() => createLayeredSceneLattice(input({ radius: 512, weights: disc.weights }))).not.toThrow();
    expect(() => createLayeredSceneLattice(input(zeros(513)))).toThrow("Layered scene: a surface's blur needs a kernel radius of 513 sites; at card edges the layered sum takes at most 512. Reduce the defocus or the f-number's aperture.");
    expect(() => createLayeredSceneLattice(input(zeros(128, true)))).not.toThrow();
    expect(() => createLayeredSceneLattice(input(zeros(129, true)))).toThrow("Layered scene: a surface's blur needs a kernel radius of 129 sites; at card edges the layered sum takes at most 128 for a shaped kernel. Reduce the defocus or the f-number's aperture.");
  });

  it("renders a disc of radius 512 at a card edge as the direct sum does", () => {
    const disc = createDefocusDiscSiteKernel(1024)!, base = input({ radius: 512, weights: disc.weights });
    const lattice = createLayeredSceneLattice(base), { geometry, visibility } = lattice.parts, kernelGroups = groupsOf(base);
    const runs = createLayeredEdgeSum({ geometry, visibility, surfaces: readerOf(lattice, true), kernelGroups, capacityBytes: 1 << 26 });
    const direct = createLayeredEdgeSum({ geometry, visibility, surfaces: readerOf(lattice, false), kernelGroups, capacityBytes: 1 << 26, method: "direct" });
    const group = lattice.groupOf(0, 0), a = new Float64Array(N), b = new Float64Array(N);
    for (const [p, q] of [[7, 6], [8, 6]] as const) {
      a.fill(0); b.fill(0);
      runs.sumAt(group, p, q, a, 0); direct.sumAt(group, p, q, b, 0);
      for (let n = 0; n < N; n++) expect(Math.abs(a[n]! - b[n]!) / b[n]!).toBeLessThan(1e-9);
    }
    expect(runs.edgePoints).toBe(2);
  }, scaledTimeout(120_000));
});

describe("layered edge sums: accuracy at large blur (#749)", () => {
  const f = fixture(96, 24);
  const half = (x: number): number => (x - f.W / 2) * f.g;
  for (const R of [96, 128, 256]) {
    const cases: { name: string; specs: SurfaceSpec[] }[] = [
      { name: `front edge over a far plane of radius ${R}`, specs: [{ rect: { u0: -2, u1: half(48), v0: -2, v1: 2 }, rho: -1.5, reflectances: [0.2] }, { rect: null, rho: R, reflectances: [0.9] }] },
      { name: `far edge behind a front card of radius ${R}`, specs: [{ rect: { u0: -2, u1: half(44), v0: -2, v1: 2 }, rho: -R, reflectances: [0.1] },
        { rect: { u0: half(50), u1: 2, v0: -2, v1: 2 }, rho: 0.8, reflectances: [0.95] }, { rect: null, rho: 4, reflectances: [0.4] }] }];
    for (const { name, specs } of cases) it(name + ": full within 0.5 % and fast within 2 % of the local swing", () => {
      const full = layeredSignal(f, specs, FULL), fast = layeredSignal(f, specs, FAST), y = 10;
      full.window(0, 0, f.W, f.H); fast.window(0, 0, f.W, f.H);
      const xs: number[] = [], reference: number[] = [];
      for (let x = 30; x < 66; x += 3) { xs.push(x); reference.push(bruteForceSite(f, specs, x, y)); }
      const swing = (c: number): number => { const v = xs.flatMap((x, i) => (bayer(x, y) === c ? [reference[i]!] : [])); return Math.max(...v) - Math.min(...v); };
      let worstFull = 0, worstFast = 0;
      xs.forEach((x, i) => {
        const s = swing(bayer(x, y));
        expect(s).toBeGreaterThan(0);
        worstFull = Math.max(worstFull, Math.abs(full.site(x, y) - reference[i]!) / s);
        worstFast = Math.max(worstFast, Math.abs(fast.site(x, y) - reference[i]!) / s);
      });
      expect(worstFull).toBeLessThan(0.005);
      expect(worstFast).toBeLessThan(0.02);
      expect(full.edgeSites).toBeGreaterThan(0);
    }, scaledTimeout(180_000));
  }

  const g = fixture(24, 16);
  const white: SurfaceSpec[] = [
    { rect: { u0: -0.9, u1: -0.1, v0: -0.5, v1: 0.2 }, rho: -96, reflectances: [1] },
    { rect: { u0: -0.4, u1: 0.4, v0: -0.3, v1: 0.45 }, rho: 0, reflectances: [1] },
    { rect: { u0: 0.05, u1: 0.85, v0: -0.55, v1: 0.1 }, rho: 40, reflectances: [1] },
    { rect: null, rho: 96, reflectances: [1] }];
  for (const [label, samples, bound] of [["full", FULL, 0.002], ["fast", FAST, 0.01]] as const) it("energy at radius 96, " + label + ": flat within " + bound * 100 + " %", () => {
    const signal = layeredSignal(g, white, samples);
    signal.window(0, 0, g.W, g.H);
    let worst = 0;
    for (let y = 0; y < g.H; y += 3) for (let x = 0; x < g.W; x += 3) worst = Math.max(worst, Math.abs(signal.site(x, y) / signalOf(bayer(x, y), WHITE) - 1));
    expect(signal.edgeSites).toBeGreaterThan(20);
    expect(worst).toBeLessThan(bound);
  }, scaledTimeout(180_000));
});
