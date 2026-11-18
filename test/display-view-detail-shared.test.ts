// SPDX-License-Identifier: Apache-2.0
/**
 * #649: the display view with lens corrections and sharpening renders its passes in bands of rows that share one per-call site store
 * and one per-call store of real pixels' recorded terms, skips the view-size passes that the sharpening discards and draws no noise
 * for the passes whose samples are not used. Every step forms the same values from the same operands, so the samples, expected values
 * and noise are those of 2.26.0: these hashes were recorded on 2.26.0 (94f56f3) before the change, on x64 (Node 24.1.0 under
 * Rosetta 2) and on arm64 (Node 26.13.1), the same on both (#508), and hold unchanged after it, with the default bands and with bands
 * of a few rows. The scene-lookup, sample and site-evaluation counts are left out: they count the work done, which the change reduces.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createDisplayViewCallStore, createDisplayViewSiteStore, displayViewDetailBand } from "../src/facade/display-view-detail.js";
import type { DisplayViewExpectedSignal } from "../src/facade/display-view.js";
import type { SimulateCaptureOptions, SimulateDisplayViewOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { hashLockOnThisArchitecture } from "./helpers/architecture-hash-locks.js";

const W = 192, H = 128, all = { distortion: true, lateralColor: true, vignetting: true }, sharpening = { radiusPixels: 1, amount: 1 };
const request = (output: SimulateCaptureOptions["output"], fast = true): SimulateCaptureOptions => ({ scene: { preset: "slanted-edge", angleDegrees: 20 }, subjectDistanceM: 2,
  lens: { catalogue: "pv-24-1.8", fNumber: 1.8 }, fast, sensor: { pixelPitchMicrometers: 36000 / W, spectralStepNanometers: 40 }, output: { width: W, height: H, ...output },
  exposure: { mode: "manual", shutterSeconds: 1 / 2000, iso: 100 } });
/** 8, 2 and 1 real pixels per display pixel per axis. */
const views: Record<string, SimulateDisplayViewOptions> = { "8x": { width: 24, height: 16 }, "2x": { width: 96, height: 64 }, "1x": { width: W, height: H } };
const requests: Record<string, SimulateCaptureOptions["output"]> = { plain: {}, corrections: { lensCorrections: all }, sharpening: { sharpening }, both: { lensCorrections: all, sharpening } };

async function digest(options: SimulateCaptureOptions, view: SimulateDisplayViewOptions): Promise<string> {
  const { result, internals } = await simulateDisplayViewWithInternals(options, view), hash = createHash("sha256");
  for (const a of [result.image.samples, internals.expected, internals.noiseStd, internals.saturated]) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  hash.update(JSON.stringify([internals.saturatedPixelCount, internals.detailPixelCount, internals.uniformPixelCount, internals.estimation, result.diagnostics.highlight]));
  return hash.digest("hex");
}

/** [case, x64 lock]; the arm64 hash of a lock whose bytes differ there is in ARM64_HASHES (none: every case is the same on both). */
const LOCKS: readonly [string, string][] = [
  ["plain-8x", "e200a280a3b49a5250f22f788904cd74bca4701754e92ec15f3785e3778c22cb"],
  ["plain-2x", "98f05df83f563c26205a354b49cbe46aaeb0c7eb982f432579fbb0286af78dd0"],
  ["plain-1x", "0e275b477afedc52dae60398dadaf8cd1671a195946dcb0adee30c353e455897"],
  ["corrections-8x", "78c5ad4191f67079ea9cb5bab5893ece13022956c56f67074a049ab0005c295a"],
  ["corrections-2x", "fa221390737cc97b3b589d86ec38944132f57a8364b21c473fdc95071a28d1f3"],
  ["corrections-1x", "fc16b6b2958a16a9fff7b9536d400356e87e2e10dae1c7a7678b2722212839f1"],
  ["sharpening-8x", "f4563fdf9f3ac932a04c049a250fe53eb8a5db43ceed60d81b583973493dd830"],
  ["sharpening-2x", "5c146af2e894046440a47a36c46080c98ea74f682785410c1b23e15e787b2d07"],
  ["sharpening-1x", "b79987ed8f3ab943546a6cb51f5c8cea76679b7aad15bb5cb580d0baca1a3509"],
  ["both-8x", "b2a205be720df35e90aac80d793a4c7c208e9763fcfaa7d8bde7ff8c88b6ab4d"],
  ["both-2x", "e235dcd696155a0913036c73e1868f26111b2ae5bf22b027f5350cf5bb737dc4"],
  ["both-1x", "8a680a628f5003c979a5eca55366d33be8eea0e29c06c3d2147b2dfb60c93b2f"],
  ["corrections-exact-8x", "a5fbf8bf436620bd0d47d08a00714f3abd430c59bb5d760a5200993d7f477b46"],
  ["both-exact-2x", "841551eeb368f9face62a71a0db84fd823a85727d194522882e99af3740c6b52"],
  ["both-ahd-2x", "9e3c2f5aaf2cd05a808a7cf26ab37fb02d427a4360c9dab487e5ddae99f4f121"],
  ["both-region-2x", "21fd9ac7ff8ad77672136c56e982eb846ece63edf79c9fd52fb2df09edb00fae"],
  ["neighbors-2x", "2bb593d6697d67b5deed95d6252ca423b517866afcb674887d6fcd069a91302a"],
];
const ARM64_HASHES: Readonly<Record<string, string>> = {
};
type Case = [SimulateCaptureOptions, SimulateDisplayViewOptions];
const CASES: Record<string, Case> = {};
for (const [r, output] of Object.entries(requests)) for (const [v, view] of Object.entries(views)) CASES[r + "-" + v] = [request(output), view];
CASES["corrections-exact-8x"] = [request({ lensCorrections: all }, false), views["8x"]!];
CASES["both-exact-2x"] = [request({ lensCorrections: all, sharpening }, false), views["2x"]!];
CASES["both-ahd-2x"] = [request({ lensCorrections: all, sharpening, demosaic: "ahd" }), views["2x"]!];
CASES["both-region-2x"] = [request({ lensCorrections: all, sharpening }), { ...views["2x"]!, region: { x: 37, y: 9, width: 41, height: 30 } }];
CASES["neighbors-2x"] = [request({ lensCorrections: { distortion: true, lateralColor: true }, highlightMode: "reconstruct-neighbors" }), views["2x"]!];

describe("display view lens corrections and sharpening share their sites and pixels across passes (#649)", () => {
  it("keeps the 2.26.0 samples, expected values and noise", async () => {
    if (process.env.RECORD_DETAIL_HASHES === "1") {
      for (const [name, c] of Object.entries(CASES)) console.log(JSON.stringify([name, await digest(...c)]));
      return;
    }
    expect(LOCKS.map(([name]) => name).sort()).toEqual(Object.keys(CASES).sort());
    const pixels = displayViewDetailBand.pixels;
    try {
      // The default bands (one band for these views), then bands of a few rows (2,000 real pixels: 1 to 10 display rows).
      for (const band of [pixels, 2000]) {
        displayViewDetailBand.pixels = band;
        for (const [name, lock] of LOCKS) expect(await digest(...CASES[name]!), name + " " + band).toBe(hashLockOnThisArchitecture(lock, ARM64_HASHES));
      }
    } finally { displayViewDetailBand.pixels = pixels; }
  }, scaledTimeout(900_000));

  it("keeps each site's or real pixel's record until its tile is the least recently used one over the budget", () => {
    // Tiles of 4 × 4 sites, 2 values and a flag per site: 16·8·3 = 384 B per tile; a budget of 800 B holds two tiles.
    const store = createDisplayViewCallStore(2, 800), value = (x: number, y: number): number => x * 1000 + y;
    const write = (x: number, y: number): void => { expect(store.find(x, y, 2)).toBe(false); store.records[store.offset] = value(x, y); store.records[store.offset + 1] = -x; store.filled(); };
    const held = (x: number, y: number): boolean => store.find(x, y, 2) && store.records[store.offset] === value(x, y) && store.records[store.offset + 1] === -x;
    write(1, 1); write(2, 3); write(5, 0);
    expect([held(1, 1), held(2, 3), held(5, 0), held(3, 3)]).toEqual([true, true, true, false]);
    // Tile (0, 0) is the most recent after the reads above (held(3, 3) is in it), so a third tile drops tile (1, 0).
    write(9, 9);
    expect([held(9, 9), held(1, 1)]).toEqual([true, true]);
    // Tile (1, 0) comes back empty and drops tile (2, 2), now the least recently used.
    expect([held(5, 0), held(1, 1), held(9, 9)]).toEqual([false, true, false]);
    // Another record size starts over.
    expect(store.find(1, 1, 3)).toBe(false);
  });

  it("reads each site through the signal once per call, and again where materials become tracked", () => {
    let reads = 0, tracked = false;
    const signal = { window() { /* none */ }, site(x: number, y: number) { reads++; return x + y / 8; }, pilot: () => 0, lookups: 7, get uniformMaterial() { return tracked ? 3 : -1; },
      get tracksMaterial() { return tracked; }, cachesSites: true, marksReads: false, markReads() { /* none */ } } as DisplayViewExpectedSignal;
    const store = createDisplayViewSiteStore(signal);
    expect([store.site(3, 4), store.site(3, 4), store.site(70, 1), store.site(3, 4)]).toEqual([3.5, 3.5, 70.125, 3.5]);
    expect(reads).toBe(2);
    expect([store.lookups, store.cachesSites, store.marksReads, store.tracksMaterial, store.uniformMaterial]).toEqual([7, true, false, false, -1]);
    tracked = true;
    expect(store.site(3, 4)).toBe(3.5);
    expect([reads, store.uniformMaterial]).toEqual([3, 3]);
    expect(store.site(3, 4)).toBe(3.5);
    expect([reads, store.uniformMaterial]).toEqual([3, 3]);
  });
});
