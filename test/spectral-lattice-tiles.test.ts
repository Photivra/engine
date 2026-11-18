// SPDX-License-Identifier: Apache-2.0
/**
 * Spectral lattice tiles (2.27.0 plan, chunk S0) and the view-equivalence helper the 2.27.0 chunks share.
 *
 * - A tile holds exactly the values its fill wrote, at absolute lattice positions (negative tiles included), per key.
 * - A tile dropped by the byte budget and computed again has the same bits.
 * - Rows filled on demand equal the same rows of a whole tile, bit for bit, in any order; only missing rows are filled.
 * - The store never holds more than its capacity.
 * - The helper's comparisons: relative differences, codes, and a region against the same pixels of a whole view; and the helper on
 *   two real methods that form the same sum (#643's per-tap sum against the per-material sums) and on a region of a prepared view.
 */
import { describe, expect, it } from "vitest";
import { createDisplayViewExpectedSignal } from "../src/facade/expected-signal.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createSpectralLatticeTiles, type SpectralLatticeTilesInput } from "../src/facade/spectral-lattice-tiles.js";
import { prepareDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { compareCodes, compareRegionWithWhole, compareRelative, compareSiteElectrons, expectRegionEqualsWhole, expectSiteElectronsEquivalent,
  expectViewsEquivalent, relativeDifference } from "./helpers/view-equivalence.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const NODES = 20;
/** A spectral radiance of lattice point (x, y) at node n: a reflectance pattern times a smooth illuminant, from the position only. */
const radiance = (key: number, x: number, y: number, n: number): number => {
  const reflectance = 0.05 + 0.9 * ((((x * 73856093) ^ (y * 19349663) ^ (key * 83492791)) >>> 0) % 997) / 996;
  return reflectance * (0.6 + 0.4 * Math.sin(0.3 * n + 0.1 * key)) * Math.exp(-n / 40);
};
interface FillLog { calls: { key: number; x0: number; y0: number; width: number; height: number }[] }
function store(tile: number, capacityTiles: number, log?: FillLog): ReturnType<typeof createSpectralLatticeTiles> {
  const fill: SpectralLatticeTilesInput["fill"] = (key, x0, y0, width, height, out) => {
    log?.calls.push({ key, x0, y0, width, height });
    expect(out.length).toBe(width * height * NODES);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let n = 0; n < NODES; n++) out[(y * width + x) * NODES + n] = radiance(key, x0 + x, y0 + y, n);
  };
  return createSpectralLatticeTiles({ tile, nodes: NODES, capacityBytes: capacityTiles * (tile * tile * NODES * 8 + tile), fill });
}
const bits = (a: Float64Array): Uint8Array => new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));

describe("spectral lattice tiles", () => {
  it("returns the fill's values at absolute lattice positions, per key", () => {
    const tiles = store(8, 16);
    for (const [key, tx, ty] of [[0, 0, 0], [3, -2, 5], [7, 4, -1], [0, -1, -1]] as const) {
      const values = tiles.tileAt(key, tx, ty);
      expect(values.length).toBe(8 * 8 * NODES);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) for (let n = 0; n < NODES; n++)
        expect(values[(y * 8 + x) * NODES + n]).toBe(radiance(key, tx * 8 + x, ty * 8 + y, n));
    }
    expect(tiles.tilesComputed).toBe(4);
    // A second read is served from the store.
    tiles.tileAt(3, -2, 5);
    expect(tiles.tilesComputed).toBe(4);
    expect(tiles.tile).toBe(8);
    expect(tiles.nodes).toBe(NODES);
  });

  it("computes a dropped tile again with the same bits", () => {
    const tiles = store(16, 2);
    const first = bits(tiles.tileAt(1, 3, -4));
    tiles.tileAt(1, 4, -4); tiles.tileAt(2, 3, -4);
    expect(tiles.tilesComputed).toBe(3);
    const again = tiles.tileAt(1, 3, -4);
    expect(tiles.tilesComputed).toBe(4);
    expect(bits(again)).toEqual(first);
  });

  it("fills rows on demand equal to the same rows of the whole tile, filling only missing rows", () => {
    const log: FillLog = { calls: [] }, T = 32, stride = T * NODES;
    const onDemand = store(T, 4, log), whole = store(T, 4).tileAt(5, -1, 2);
    let values = onDemand.rows(5, -1, 2, 10, 14);
    expect(log.calls).toEqual([{ key: 5, x0: -32, y0: 74, width: 32, height: 4 }]);
    // Rows not asked for are zero.
    expect(values.subarray(0, 10 * stride).every((v) => v === 0)).toBe(true);
    expect(values.subarray(14 * stride).every((v) => v === 0)).toBe(true);
    // Overlapping and out-of-order requests fill only the missing runs.
    expect(onDemand.rows(5, -1, 2, 6, 20)).toBe(values);
    expect(log.calls.slice(1)).toEqual([{ key: 5, x0: -32, y0: 70, width: 32, height: 4 }, { key: 5, x0: -32, y0: 78, width: 32, height: 6 }]);
    onDemand.rows(5, -1, 2, 0, 1);
    values = onDemand.rows(5, -1, 2, 25, 32);
    expect(onDemand.rowsComputed).toBe(4 + 10 + 1 + 7);
    for (const [r0, r1] of [[0, 1], [6, 20], [25, 32]] as const) expect(bits(values.subarray(r0 * stride, r1 * stride))).toEqual(bits(whole.subarray(r0 * stride, r1 * stride)));
    // A request inside filled rows does no work; the whole tile then fills the rest and equals the whole tile.
    const calls = log.calls.length;
    onDemand.rows(5, -1, 2, 8, 18);
    expect(log.calls.length).toBe(calls);
    expect(bits(onDemand.tileAt(5, -1, 2))).toEqual(bits(whole));
    expect(onDemand.rowsComputed).toBe(T);
    expect(onDemand.tilesComputed).toBe(1);
    // Empty ranges are allowed and fill nothing.
    onDemand.rows(5, -1, 3, 4, 4);
    expect(onDemand.rowsComputed).toBe(T);
  });

  it("keeps rows of a dropped tile only until it is dropped; computed again on demand they have the same bits", () => {
    const T = 16, stride = T * NODES, tiles = store(T, 1), reference = store(T, 1).tileAt(0, 0, 0);
    tiles.rows(0, 0, 0, 3, 9);
    tiles.rows(0, 1, 0, 0, 2);                      // drops tile (0, 0)
    const values = tiles.rows(0, 0, 0, 5, 7);       // a new tile: only rows 5–6
    expect(values.subarray(3 * stride, 5 * stride).every((v) => v === 0)).toBe(true);
    expect(bits(values.subarray(5 * stride, 7 * stride))).toEqual(bits(reference.subarray(5 * stride, 7 * stride)));
    expect(tiles.tilesComputed).toBe(3);
  });

  it("holds no more than its capacity, least recently used first", () => {
    const T = 8, tileBytes = T * T * NODES * 8 + T, tiles = store(T, 5);
    let seed = 12345;
    const next = (n: number): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
    for (let i = 0; i < 400; i++) {
      tiles.rows(next(3), next(7) - 3, next(7) - 3, 0, 1 + next(T));
      expect(tiles.bytesHeld).toBeLessThanOrEqual(5 * tileBytes);
    }
    expect(tiles.bytesHeld).toBe(5 * tileBytes);
    // The five most recently used tiles are kept: reading them again computes nothing.
    const recent = [[0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0], [0, 0, 1]] as const;
    for (const [k, x, y] of recent) tiles.tileAt(k, x, y);
    const computed = tiles.tilesComputed;
    for (const [k, x, y] of [...recent].reverse()) tiles.tileAt(k, x, y);
    expect(tiles.tilesComputed).toBe(computed);
    // After the reversed reads (0, 0, 1) is the least recently used: a sixth tile drops it and keeps (0, 0, 0).
    tiles.tileAt(9, 9, 9);
    tiles.tileAt(0, 0, 0);
    expect(tiles.tilesComputed).toBe(computed + 1);
    tiles.tileAt(0, 0, 1);
    expect(tiles.tilesComputed).toBe(computed + 2);
    tiles.clear();
    expect(tiles.bytesHeld).toBe(0);
  });

  it("leaves rows unfilled when the fill throws, and fills them on the next request", () => {
    let fail = true;
    const tiles = createSpectralLatticeTiles({ tile: 4, nodes: 2, capacityBytes: 1024, fill(key, x0, y0, width, height, out) {
      for (let i = 0; i < out.length; i++) out[i] = x0 + y0 + i;
      if (fail) throw new Error("fill failed");
    } });
    expect(() => tiles.rows(0, 0, 0, 1, 3)).toThrow("fill failed");
    expect(tiles.rowsComputed).toBe(0);
    fail = false;
    const values = tiles.tileAt(0, 0, 0);
    expect(Array.from(values.subarray(0, 8))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("refuses invalid shapes, capacities and indices", () => {
    const fill = (): void => undefined;
    expect(() => createSpectralLatticeTiles({ tile: 0, nodes: 4, capacityBytes: 1e6, fill })).toThrow(/tile/);
    expect(() => createSpectralLatticeTiles({ tile: 8, nodes: 1.5, capacityBytes: 1e6, fill })).toThrow(/nodes/);
    expect(() => createSpectralLatticeTiles({ tile: 8, nodes: 4, capacityBytes: 2048, fill })).toThrow(/at least one tile \(2056 bytes\)/);
    expect(() => createSpectralLatticeTiles({ tile: 8, nodes: 4, capacityBytes: Infinity, fill })).toThrow(/capacityBytes/);
    const tiles = createSpectralLatticeTiles({ tile: 8, nodes: 4, capacityBytes: 1e6, fill });
    expect(() => tiles.rows(0, 0, 0, 3, 2)).toThrow(/row0/);
    expect(() => tiles.rows(0, 0, 0, 0, 9)).toThrow(/row0/);
    expect(() => tiles.tileAt(0, 0.5, 0)).toThrow(/tile indices/);
    expect(() => tiles.tileAt(0, 0, 2 ** 20)).toThrow(/tile indices/);
    expect(() => tiles.tileAt(0.5, 0, 0)).toThrow(/key/);
  });
});

describe("view-equivalence helper", () => {
  it("measures relative differences of sites and values, and codes of samples", () => {
    expect(relativeDifference(0, 0)).toBe(0);
    expect(relativeDifference(1, 1 + 1e-12)).toBeCloseTo(1e-12, 14);
    expect(relativeDifference(-2, 2)).toBe(2);
    expect(relativeDifference(NaN, 1)).toBe(Infinity);
    const a = { site: (x: number, y: number): number => 100 + x + 10 * y }, b = { site: (x: number, y: number): number => (x === 3 && y === 2 ? (123) * (1 + 5e-10) : a.site(x, y)) };
    const sites = compareSiteElectrons(a, b, { x0: 0, y0: 0, x1: 5, y1: 4 });
    expect(sites).toMatchObject({ count: 20, differing: 1, worstAt: { x: 3, y: 2 } });
    expect(sites.worstRelative).toBeLessThan(1e-9);
    expectSiteElectronsEquivalent(a, b, { x0: 0, y0: 0, x1: 5, y1: 4 });
    expect(compareRelative([1, 2, 3], [1, 2, 3.3])).toMatchObject({ differing: 1, worstAt: 2 });
    expect(compareCodes([1, 2, 3], [2, 2, 1])).toMatchObject({ differing: 2, worstCodes: 2, worstAt: 2 });
    expectViewsEquivalent({ samples: [10, 20, 30], expected: [0.1, 0.2, 0.3] }, { samples: [11, 20, 30], expected: [0.1, 0.2, 0.3 * (1 + 1e-10)] });
    expect(() => expectViewsEquivalent({ samples: [10] }, { samples: [12] })).toThrow();
    expect(() => compareCodes([1], [1, 2])).toThrow(/lengths/);
  });

  it("compares a region with the same pixels of a whole view", () => {
    const wholeRegion = { x: 10, y: 20, width: 6, height: 4 }, partRegion = { x: 12, y: 21, width: 3, height: 2 };
    const whole = Array.from({ length: 6 * 4 * 3 }, (_, i) => i), part: number[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) for (let c = 0; c < 3; c++) part.push(whole[((y + 1) * 6 + x + 2) * 3 + c]!);
    expectRegionEqualsWhole(whole, wholeRegion, part, partRegion);
    part[4] = -1;
    expect(compareRegionWithWhole(whole, wholeRegion, part, partRegion)).toEqual({ pixels: 6, differing: 1, first: { x: 13, y: 21 } });
    expect(() => compareRegionWithWhole(whole, wholeRegion, part, { ...partRegion, x: 14 })).toThrow(/inside/);
  });

  it("passes two real methods that form the same sum, and a region of a prepared view against the whole view", async () => {
    // #643's pair: the per-tap sum (fast) and the per-material sums (fast: false) on fine chart detail with diffraction and a box aperture.
    const W = 1200, H = 800, g = 2 / W, MATERIALS = 64;
    const materialAt = (p: { u: number; v: number }): number => ((((Math.floor(p.u / (1.5 * g)) * 73856093) ^ (Math.floor(p.v / (1.5 * g)) * 19349663)) >>> 0) % MATERIALS);
    const request = (fast?: boolean): SimulateCaptureOptions => ({
      scene: { kind: "material-function", sceneId: "equivalence-fine", materials: Array.from({ length: MATERIALS }, (_, m) => 0.05 + 0.9 * m / (MATERIALS - 1)), materialAt },
      subjectDistanceM: 2, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 60 },
      sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: W, height: H },
      lens: { prime: 50, fNumber: 8, diffraction: "circular-aperture" }, ...(fast === undefined ? {} : { fast }) });
    const VIEW = { width: 300, height: 200, region: { x: 140, y: 90, width: 16, height: 12 } };
    const fast = await simulateDisplayViewWithInternals(request(), VIEW), exact = await simulateDisplayViewWithInternals(request(false), VIEW);
    const perTap = createDisplayViewExpectedSignal(fast.signalInput), sums = createDisplayViewExpectedSignal({ ...fast.signalInput, perTapSum: false });
    const sites = expectSiteElectronsEquivalent(perTap, sums, { x0: 560, y0: 360, x1: 600, y1: 380 });
    expect(sites.differing).toBeGreaterThan(0);
    expectViewsEquivalent({ samples: fast.result.image.samples, expected: fast.internals.expected }, { samples: exact.result.image.samples, expected: exact.internals.expected });
    // A sum that differs beyond the tolerance fails.
    const off = { site: (x: number, y: number): number => sums.site(x, y) * (x === 570 && y === 370 ? 1 + 1e-6 : 1) };
    expect(() => expectSiteElectronsEquivalent(perTap, off, { x0: 560, y0: 360, x1: 600, y1: 380 })).toThrow();
    const view = await prepareDisplayView(request(), { gpu: "off" }), wholeRegion = { x: 134, y: 84, width: 28, height: 24 };
    const whole = await view.render({ ...VIEW, region: wholeRegion }), part = await view.render(VIEW);
    expectRegionEqualsWhole(whole.image.samples, wholeRegion, part.image.samples, VIEW.region);
  }, scaledTimeout(600_000));
});
