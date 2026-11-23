// SPDX-License-Identifier: Apache-2.0
// #711: the rolling-shutter lens signal's row blocks share the in-focus columns two neighbouring blocks of one band both read
// (read at the same instants, so the same values bit for bit), and a site's block is found without reordering the block cache on
// every change of block. Values are unchanged: a block's in-focus value at a position does not depend on the rectangle it came from.
import { describe, expect, it } from "vitest";
import { simulateDisplayView } from "../src/index.js";
import { createRollingRegroupedLensSignal, LENS_ROW_SEGMENT } from "../src/facade/display-view-lens-regroup.js";
import type { DisplayViewExpectedSignalInput } from "../src/facade/expected-signal.js";
import { siteKernelRuns } from "../src/optics/site-kernel-runs.js";

const D = 11, W = 1000, H = 60, BAND = 9;
function disc(R: number): Float64Array {
  const k = new Float64Array((2 * R + 1) ** 2);
  let sum = 0;
  for (let v = -R, t = 0; v <= R; v++) for (let u = -R; u <= R; u++, t++) if (u * u + v * v <= R * R) { k[t] = 1; sum++; }
  for (let t = 0; t < k.length; t++) k[t]! /= sum;
  return k;
}

type Blocks = ReturnType<typeof createRollingRegroupedLensSignal>;
function signal(bandRows = BAND): { s: Blocks; sites: () => number } {
  let sites = 0;
  const input = { nativeWidth: W, nativeHeight: H, largeKernel: siteKernelRuns(disc(D), D), kernels: { radius: 0, perNode: [] },
    channelAt: (x: number, y: number) => (x & 1) + (y & 1) } as unknown as DisplayViewExpectedSignalInput;
  const s = createRollingRegroupedLensSignal({ input, bandRows, instantsOfRow: (y) => [y * 1e-3, y * 1e-3 + 5e-4],
    inFocus(x0, y0, w, h, instants, channels): Float64Array[] {
      sites += w * h;
      return [0, 1, 2].map((c) => {
        const out = new Float64Array(w * h);
        if ((channels & (1 << c)) === 0) return out;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
          out[y * w + x] = 1.5 + Math.sin(0.31 * (x0 + x) + 0.17 * (y0 + y) + c + instants[0]! * 40) + 1e-3 * Math.cos(1.7 * (x0 + x) * (y0 + y));
        return out;
      });
    }, lookups: () => 0, pilot: () => 0 });
  return { s, sites: () => sites };
}

describe("rolling lens signal row blocks (#711)", () => {
  it("computes the in-focus columns two blocks of a band share once", () => {
    const { s, sites } = signal();
    const blocks = 4;
    for (let x = 0; x < blocks * LENS_ROW_SEGMENT; x++) s.site(x, 0);
    // Before: (128 + 2D) columns per block. Now 128 + 2D for the first and 128 for each next one.
    expect(sites()).toBe((blocks * LENS_ROW_SEGMENT + 2 * D) * (BAND + 2 * D));
    expect(s.blocksComputed).toBe(blocks);
  });
  it("gives the same values whatever order the blocks are computed in", () => {
    const left = signal(), right = signal(), a: number[] = [], b: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a.push(left.s.site(x, y));
    // Right to left, bottom to top: no block finds its left neighbour, so every block computes its own in-focus rectangle.
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) b.push(right.s.site(x, y));
    b.reverse();
    expect(a).toEqual(b);
    expect(right.sites()).toBeGreaterThan(left.sites());
  });
  it("gives the same values when the reads alternate between blocks of two bands and two columns", () => {
    const one = signal(), two = signal(), a: number[] = [], b: number[] = [];
    for (let y = 0; y < 2 * BAND; y++) for (let x = 0; x < 3 * LENS_ROW_SEGMENT; x++) a.push(one.s.site(x, y));
    const at = new Map<number, number>();
    for (let x = 0; x < 3 * LENS_ROW_SEGMENT; x++) for (const y of Array.from({ length: 2 * BAND }, (_, i) => i)) {
      at.set(y * W + x, two.s.site(x, y));
      if (x > 0) two.s.site(x - 1, (y + BAND) % (2 * BAND));
    }
    for (let y = 0; y < 2 * BAND; y++) for (let x = 0; x < 3 * LENS_ROW_SEGMENT; x++) b.push(at.get(y * W + x)!);
    expect(a).toEqual(b);
  });
  it("keeps one band per block under the full method (bandRows 1)", () => {
    const { s, sites } = signal(1);
    for (let x = 0; x < 2 * LENS_ROW_SEGMENT; x++) s.site(x, 5);
    expect(sites()).toBe((2 * LENS_ROW_SEGMENT + 2 * D) * (1 + 2 * D));
  });
  it("reports its sites as cached, so the view may replay a real pixel read again", () => {
    const { s, sites } = signal();
    expect(s.cachesSites).toBe(true);
    const first = s.site(5, 3), read = sites();
    expect(s.site(5, 3)).toBe(first);
    expect(sites()).toBe(read);
  });
});

describe("rolling lens view of a two-row frame (#730 facade-17)", () => {
  // The band height's start value compared a row with the row below it; with two rows, row 1 had none (a TypeError before 2.29.0).
  for (const fast of [true, false]) it(`renders with fast: ${fast}`, async () => {
    const view = await simulateDisplayView({ scene: { preset: "siemens-star" }, lens: { fNumber: 4, focusDistanceM: 4.6, defocus: { model: "geometric-disc" } },
      motion: { shutter: "rolling", angularVelocityRadPerSec: { yaw: 0.2 } }, output: { width: 64, height: 2, borderHandling: "mirror" }, fast }, { width: 64, height: 2 });
    expect(view.image.width * view.image.height).toBe(128);
    expect(Array.from(view.image.samples).every((v) => Number.isFinite(v))).toBe(true);
  });
});
